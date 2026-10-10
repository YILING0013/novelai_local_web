/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, IconButton, LinearProgress, MenuItem, Paper, Slider, Snackbar, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { AutoAwesome, Close, ContentCopy, Download, FolderOpen, ImageOutlined, InfoOutlined, Memory, PlayArrow, Refresh, Stop, UploadFile } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import { copyTextToClipboard } from '@/utils/browserCapabilities.mjs';
import { downloadUrlToFile } from '@/utils/mediaAssets';
import { PAGE_IDS } from '@/i18n/pageConfig.mjs';
import usePromptTranslations from '@/components/ai-painting/PromptEditor/usePromptTranslations';
import { getCachedPromptTranslations } from '@/components/ai-painting/PromptEditor/promptTranslation.mjs';
import inferenceMessages from './inferenceMessages';

const terminal = new Set(['completed', 'failed', 'cancelled']);

/**
 * 本地反推与放大共用上传、模型管理和任务进度，结果按用途展示。
 * @param {{kind: 'tagger'|'upscale'}} props kind 决定模型清单、参数和结果操作。
 * @returns {React.ReactElement} 连接本机 Python 后端的推理页面。
 */
export default function LocalInferencePage({ kind }) {
  const { locale } = useI18n();
  const words = inferenceMessages[locale];
  const [environment, setEnvironment] = useState(null);
  const [modelId, setModelId] = useState(kind === 'tagger' ? 'wd-swinv2-tagger-v3' : 'realesrgan-anime-6b');
  const [device, setDevice] = useState('auto');
  const [image, setImage] = useState('');
  const [imageName, setImageName] = useState('');
  const [job, setJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [general, setGeneral] = useState(0.35);
  const [character, setCharacter] = useState(0.85);
  const [scale, setScale] = useState(4);
  const [showTranslations, setShowTranslations] = useState(false);
  const [includeTranslations, setIncludeTranslations] = useState(false);
  const [visibleTags, setVisibleTags] = useState(100);
  const fileInput = useRef(null);
  const displayedJob = useRef(null);
  const initialized = useRef(false);
  const alive = useRef(true);
  const requestSequence = useRef(0);
  const uploadSequence = useRef(0);
  const running = job && !terminal.has(job.status);
  const busy = uploading || submitting || running || environment?.busy;
  const model = environment?.models.find((entry) => entry.id === modelId);
  const tags = job?.status === 'completed' ? job.result?.tags || [] : [];
  const resultImage = job?.status === 'completed' ? job.result?.image : null;
  const resultImageId = resultImage?.id;
  const prompt = tags.map(({ tag }) => tag).join(', ');
  const translation = usePromptTranslations(prompt, { enabled: showTranslations && tags.length > 0, targetLanguage: 'zh' });
  const errorText = (code) => words.errors[code] || words.errors.request;

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const data = await apiClient.request('/local/inference');
      if (!alive.current || sequence !== requestSequence.current) return;
      setEnvironment(data);
      if (!initialized.current) {
        initialized.current = true;
        setDevice(data.device);
        if (data.job?.kind === kind) {
          displayedJob.current = data.job.id;
          setModelId(data.job.model_id);
          const selected = data.models.find((entry) => entry.id === data.job.model_id);
          if (selected?.defaultThresholds) { setGeneral(selected.defaultThresholds.general); setCharacter(selected.defaultThresholds.character); }
        }
      }
      if (data.job?.id === displayedJob.current) setJob(data.job);
      return data.busy;
    } catch (requestError) {
      if (alive.current && sequence === requestSequence.current) setError(requestError.code || 'request');
    }
  }, [kind]);

  useEffect(() => {
    if (resultImageId) window.dispatchEvent(new Event('novelai:gallery-updated'));
  }, [resultImageId]);

  useEffect(() => {
    alive.current = true;
    let timer;
    const poll = async () => {
      const active = await refresh();
      if (alive.current) timer = setTimeout(poll, active ? 1500 : 5000);
    };
    void poll();
    return () => { alive.current = false; clearTimeout(timer); requestSequence.current += 1; uploadSequence.current += 1; };
  }, [refresh]);

  const chooseFile = (file) => {
    if (!file || busy) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      setError('file'); return;
    }
    const sequence = ++uploadSequence.current;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (!alive.current || sequence !== uploadSequence.current) return;
      setImage(String(reader.result)); setImageName(file.name); setError(''); setJob(null); displayedJob.current = null; setVisibleTags(100);
      setUploading(false);
    };
    reader.onerror = () => { if (alive.current && sequence === uploadSequence.current) { setUploading(false); setError('file'); } };
    reader.readAsDataURL(file);
  };

  const start = async (action) => {
    setSubmitting(true); setError('');
    try {
      const result = await apiClient.request('/local/inference/jobs', {
        method: 'POST', body: { action, model_id: modelId, device, ...(action === kind ? { image, scale, general_threshold: general, character_threshold: character } : {}) },
      });
      if (!alive.current) return;
      displayedJob.current = result.id;
      setJob(result); setVisibleTags(100);
      setEnvironment((current) => ({ ...current, busy: !terminal.has(result.status) }));
      await refresh();
    } catch (requestError) {
      if (alive.current) { setError(requestError.code || 'request'); await refresh(); }
    } finally { if (alive.current) setSubmitting(false); }
  };

  const cancel = async () => {
    try {
      setJob(await apiClient.request(`/local/inference/jobs/${job.id}/cancel`, { method: 'POST' }));
    } catch (requestError) { setError(requestError.code || 'request'); }
  };

  const release = async () => {
    setSubmitting(true);
    try { await apiClient.request('/local/inference/release', { method: 'POST' }); await refresh(); }
    catch (requestError) { setError(requestError.code || 'request'); }
    finally { setSubmitting(false); }
  };

  const translatedTags = tags.map((entry) => {
    if (!showTranslations) return entry;
    const snapshot = getCachedPromptTranslations(entry.tag, 'zh');
    let translated = entry.tag;
    let hasTranslation = false;
    for (const range of [...snapshot.tags].reverse()) {
      if (!snapshot.translations[range.key]) continue;
      translated = translated.slice(0, range.start) + snapshot.translations[range.key] + translated.slice(range.end);
      hasTranslation = true;
    }
    return { ...entry, translation: hasTranslation ? translated : '' };
  });
  const exportPrompt = translatedTags.map(({ tag, translation: translated }) => showTranslations && includeTranslations && translated
    ? `${tag} /*${translated.replace(/\s+/g, ' ').replace(/\/\*|\*\//g, '')}*/` : tag).join(', ');
  const copyPrompt = async () => {
    try { await copyTextToClipboard(exportPrompt); setNotice(words.copied); }
    catch { setError('request'); }
  };
  const applyPrompt = () => {
    window.localStorage.setItem('novelai:pending-inference-prompt', exportPrompt);
    window.dispatchEvent(new CustomEvent('novelai:inference-prompt', { detail: exportPrompt }));
    window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: PAGE_IDS.AI_PAINTING }));
    setNotice(words.applied);
  };
  const percentage = job?.total > 0 ? Math.min(100, 100 * job.completed / job.total) : null;
  const stage = job?.status === 'cancelling' ? 'cancelling' : job?.stage;

  return <Box sx={{ height: '100%', overflowY: 'auto', p: { xs: 1.5, md: 3 } }}>
    <Stack spacing={2} sx={{ maxWidth: 1440, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Typography component="h1" variant="h5" sx={{ fontWeight: 700, mr: 'auto' }}>{kind === 'tagger' ? words.taggerTitle : words.upscaleTitle}</Typography>
        <Chip size="small" icon={<Memory />} label="Python" variant="outlined" />
        <Tooltip title={words.refresh}><IconButton aria-label={words.refresh} onClick={() => { setError(''); void refresh(); }}><Refresh /></IconButton></Tooltip>
      </Stack>
      {error && <Alert severity="error" onClose={() => setError('')}>{errorText(error)}</Alert>}
      {environment && !environment.runtime.available && <Alert severity="warning">{words.missingRuntime}</Alert>}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <TextField select size="small" fullWidth label={words.model} value={model ? modelId : ''} disabled={!environment || busy} sx={{ flex: 1.5, minWidth: 0 }} onChange={(event) => {
              setModelId(event.target.value);
              const selected = environment.models.find((entry) => entry.id === event.target.value);
              if (selected?.defaultThresholds) { setGeneral(selected.defaultThresholds.general); setCharacter(selected.defaultThresholds.character); }
              displayedJob.current = null; setJob(null); setError('');
            }}>
              {(environment?.models || []).filter((entry) => entry.kind === kind).map((entry) => <MenuItem key={entry.id} value={entry.id}>{entry.name} · {entry.sizeLabel}</MenuItem>)}
            </TextField>
            <TextField select size="small" label={words.device} value={device} disabled={busy} sx={{ minWidth: { xs: '100%', md: 190 }, flex: 0.6 }} onChange={(event) => setDevice(event.target.value)}>
              <MenuItem value="auto">{words.auto}</MenuItem><MenuItem value="cpu">{words.cpu}</MenuItem>
              <MenuItem value="cuda" disabled={!environment?.runtime.providers.includes('CUDAExecutionProvider')}>{words.cuda}</MenuItem>
              <MenuItem value="directml" disabled={!environment?.runtime.providers.includes('DmlExecutionProvider')}>{words.directml}</MenuItem>
            </TextField>
          </Stack>
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            <Tooltip title={modelId.includes('pixai') ? words.fp32Help : words.modelHelp}><Chip size="small" variant="outlined" color={model?.cached ? 'success' : 'default'} label={model?.loaded ? words.modelLoaded : model?.cached ? words.modelCached : words.modelMissing} /></Tooltip>
            <Tooltip title={words.downloadHelp}><span><Button size="small" startIcon={<Download />} disabled={!model || busy} onClick={() => start('download')}>{words.download}</Button></span></Tooltip>
            <Button size="small" startIcon={<PlayArrow />} disabled={!model || busy || !environment?.runtime.available} onClick={() => start('load')}>{words.load}</Button>
            <Button size="small" disabled={busy || !environment?.models.some((entry) => entry.loaded)} onClick={release}>{words.release}</Button>
            <Tooltip title={`${words.location}: ${environment?.models_dir || '…'}`}><IconButton size="small" aria-label={words.location}><FolderOpen fontSize="small" /></IconButton></Tooltip>
            {model && <Tooltip title={`${words.source} · ${model.license}`}><IconButton component="a" href={model.sourceUrl} target="_blank" rel="noopener noreferrer" size="small" aria-label={words.source}><InfoOutlined fontSize="small" /></IconButton></Tooltip>}
          </Stack>
          {kind === 'tagger' ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 3, px: 1 }}>
            <Box><Typography variant="caption">{words.generalThreshold} · {general.toFixed(2)}</Typography><Slider size="small" aria-label={words.generalThreshold} min={0} max={1} step={0.01} value={general} disabled={busy} onChange={(_, value) => setGeneral(value)} /></Box>
            <Box><Typography variant="caption">{words.characterThreshold} · {character.toFixed(2)}</Typography><Slider size="small" aria-label={words.characterThreshold} min={0} max={1} step={0.01} value={character} disabled={busy} onChange={(_, value) => setCharacter(value)} /></Box>
          </Box> : <Stack direction="row" alignItems="center" gap={1}>
            <TextField select size="small" label={words.scale} value={scale} disabled={busy} sx={{ minWidth: 140 }} onChange={(event) => setScale(Number(event.target.value))}>{[2, 3, 4].map((value) => <MenuItem key={value} value={value}>{value}×</MenuItem>)}</TextField>
            <Tooltip title={words.upscaleHelp}><InfoOutlined fontSize="small" color="action" /></Tooltip>
          </Stack>}
        </Stack>
      </Paper>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 0.85fr) minmax(0, 1.35fr)' }, gap: 2, alignItems: 'start' }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
          <Box onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}>
            <Button fullWidth disabled={busy} onClick={() => fileInput.current?.click()} sx={{ display: 'flex', flexDirection: 'column', gap: 1, bgcolor: 'action.hover', border: '1px dashed', borderColor: 'divider', minHeight: 230, p: 1.5, textTransform: 'none' }}>
              {image ? <img src={image} alt={words.input} style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} /> : <><ImageOutlined sx={{ fontSize: 40 }} /><Typography variant="body2">{words.dropImage}</Typography></>}
            </Button>
            <input hidden ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { chooseFile(event.target.files[0]); event.target.value = ''; }} />
          </Box>
          {imageName && <Typography variant="caption" component="p" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{imageName}</Typography>}
          <Stack direction="row" gap={1} sx={{ mt: 2 }}>
            <Button startIcon={<UploadFile />} disabled={busy} onClick={() => fileInput.current?.click()}>{image ? words.changeImage : words.selectImage}</Button>
            {image && <IconButton aria-label={words.clearImage} disabled={busy} onClick={() => { setImage(''); setImageName(''); setJob(null); displayedJob.current = null; }}><Close /></IconButton>}
            <Button variant="contained" startIcon={<AutoAwesome />} sx={{ ml: 'auto' }} disabled={!image || !model || busy || !environment?.runtime.available} onClick={() => start(kind)}>{kind === 'tagger' ? words.analyze : words.upscale}</Button>
          </Stack>
          {job && <Stack spacing={1} sx={{ mt: 2 }} aria-live="polite">
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography variant="body2" sx={{ mr: 'auto' }}>{words.stages[stage] || stage}{percentage !== null && running ? ` · ${percentage.toFixed(0)}%` : ''}</Typography>
              {running && <Button color="warning" size="small" startIcon={<Stop />} disabled={job.status === 'cancelling' || job.stage === 'saving'} onClick={cancel}>{words.cancel}</Button>}
            </Stack>
            {running && <LinearProgress variant={percentage !== null ? 'determinate' : 'indeterminate'} value={percentage || 0} />}
            {job.provider && <Typography variant="caption" color="text.secondary">{job.provider.replace('ExecutionProvider', '')}</Typography>}
            {job.error_code && <Alert severity="error">{errorText(job.error_code)}</Alert>}
            {job.finished_at && <Typography variant="caption" color="text.secondary">{words.elapsed} {(job.finished_at - job.created_at).toFixed(1)} {words.seconds}</Typography>}
          </Stack>}
          {environment?.busy && !running && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{words.busy}</Typography>}
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0, minHeight: 300 }}>
          {kind === 'tagger' ? <Stack spacing={2}>
            <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
              <Typography variant="subtitle1" sx={{ mr: 'auto', fontWeight: 600 }}>{tags.length} {words.tags}</Typography>
              <Tooltip title={words.translateHelp}><FormControlLabel sx={{ mr: 0 }} control={<Switch size="small" checked={showTranslations} onChange={(_, value) => setShowTranslations(value)} />} label={<Typography variant="body2">{words.translated}</Typography>} /></Tooltip>
            </Stack>
            {translation.showError && <Alert severity="warning" action={<Button size="small" onClick={translation.retry}>{words.retry}</Button>}>{words.translationFailed}</Alert>}
            {tags.length > 0 ? <>
              <TextField multiline minRows={3} maxRows={8} fullWidth value={exportPrompt} InputProps={{ readOnly: true }} inputProps={{ 'aria-label': words.copy }} />
              <Stack direction="row" gap={1} flexWrap="wrap">
                <Button startIcon={<ContentCopy />} onClick={copyPrompt}>{words.copy}</Button><Button variant="outlined" onClick={applyPrompt}>{words.apply}</Button>
                {showTranslations && <FormControlLabel control={<Switch size="small" checked={includeTranslations} onChange={(_, value) => setIncludeTranslations(value)} />} label={<Typography variant="caption">{words.includeTranslations}</Typography>} />}
              </Stack>
              {['character', 'copyright', 'general', 'style', 'meta'].map((category) => {
                const categoryTags = translatedTags.filter((entry) => entry.category === category);
                if (!categoryTags.length) return null;
                return <Box key={category}>
                  <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>{words[category]} · {categoryTags.length}</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
                    {categoryTags.slice(0, visibleTags).map((entry) => <Box key={entry.tag} sx={{ p: 1.2, bgcolor: 'action.hover', borderRadius: 1.5, minWidth: 0 }}>
                      <Stack direction="row" gap={1} alignItems="baseline"><Typography variant="body2" sx={{ flex: 1, overflowWrap: 'anywhere' }}>{entry.tag}</Typography><Typography variant="caption" color="text.secondary">{(entry.confidence * 100).toFixed(1)}%</Typography></Stack>
                      {entry.translation && <Typography variant="caption" color="text.secondary">{entry.translation}</Typography>}
                      <LinearProgress variant="determinate" value={entry.confidence * 100} sx={{ mt: 1, height: 3, borderRadius: 1 }} />
                    </Box>)}
                  </Box>
                  {categoryTags.length > visibleTags && <Button size="small" onClick={() => setVisibleTags((value) => value + 100)}>{words.showMore}</Button>}
                </Box>;
              })}
            </> : <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>{job?.result?.tags ? words.noTags : words.noResult}</Typography>}
          </Stack> : resultImage ? <Stack spacing={2}>
            <Stack direction="row" gap={1} alignItems="center"><Typography variant="subtitle1" sx={{ mr: 'auto' }}>{resultImage.width} × {resultImage.height}</Typography><Chip size="small" label={words.saved} color="success" variant="outlined" /></Stack>
            <img src={resultImage.url} alt={words.output} style={{ maxWidth: '100%', maxHeight: 750, objectFit: 'contain' }} />
            <Stack direction="row" gap={1} flexWrap="wrap">
              <Button startIcon={<Download />} onClick={async () => { try { await downloadUrlToFile(resultImage.url, resultImage.filename); } catch { setError('request'); } }}>{words.downloadResult}</Button>
              <Button startIcon={<FolderOpen />} onClick={() => window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: PAGE_IDS.LOCAL_GALLERY }))}>{words.openGallery}</Button>
            </Stack>
          </Stack> : <Typography color="text.secondary" sx={{ py: 10, textAlign: 'center' }}>{words.noResult}</Typography>}
        </Paper>
      </Box>
    </Stack>
    <Snackbar open={Boolean(notice)} autoHideDuration={2500} onClose={() => setNotice('')} message={notice} />
  </Box>;
}
