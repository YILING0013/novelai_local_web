"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, Switch, Slider, TextField, MenuItem, ToggleButton, Tooltip, Typography } from '@mui/material';
import { AutoAwesome, Brush, Close, ContentCopy, DragIndicator, FileDownloadOutlined, ImageOutlined, LockOpenOutlined, PaletteOutlined, PersonOutline, Shuffle, BuildOutlined } from '@mui/icons-material';
import { saveAs } from 'file-saver';
import { alpha } from '@mui/material/styles';
import InlinePromptInput from '../../PromptEditor/InlinePromptInput';
import { MODEL_OPTIONS, SAMPLER_OPTIONS, NOISE_SCHEDULE_OPTIONS, resolveMetadataModel } from '../../utils/generationOptions';
import { DEFAULT_PAINTING_MODEL_ID } from '../../utils/modelUtils';
import { isNovelAIV5Model } from '../../utils/novelAIV5Params.mjs';
import { getImageImportOptions, normalizeImageImportParameters } from '../../utils/parameterMapping';
import { extractMetadataFromFile } from '../../utils/metadataUtils';
import { useI18n } from '@/i18n/I18nProvider';

const defaultParams = { model: DEFAULT_PAINTING_MODEL_ID, width: 1024, height: 1024, use_upscale_credits: false };
const advancedParameterLabels = {
  variety: 'variety',
  decrisp: 'decrisp',
  legacy: 'legacyCompatibility',
  legacy_uc: 'legacyPromptConditioning',
  legacy_v3_extend: 'legacyV3Extend',
  prefer_brownian: 'brownianMotion',
  deliberate_euler_ancestral_bug: 'preserveSamplerBug',
};
const advancedParameterKeys = Object.keys(advancedParameterLabels);
const parameterKeys = ['model', 'width', 'height', 'steps', 'guidanceScale', 'seed', 'sampler', 'noiseSchedule', 'smea', 'dyn', 'promptGuidanceRescale', ...advancedParameterKeys];
const actionIcons = { img2img: ImageOutlined, vibe: AutoAwesome, reference: PersonOutline, inpaint: Brush, editor: PaletteOutlined };
const defaultSelection = { positivePrompt: true, negativePrompt: true, characterTabs: true };

/**
 * 在同一个弹窗中选择图片用途，编辑并勾选要导入的提示词、角色和生成参数。
 * @param {object} props 图片文件、可用用途、元数据及导入和使用图片的回调。
 * @returns {React.ReactElement} 支持图像用途、像素混淆与元数据导入的面板。
 */
export default function MetadataDialog({ open, onClose, metadata, onApply, imageFile = null, imageActions = [], onUseImage, reading = false, params = defaultParams, allowedModels = null, restrictedAccount = false, practiceInstructions, onExerciseAction }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState('');
  const [draft, setDraft] = useState(metadata || {});
  const [selected, setSelected] = useState(defaultSelection);
  const [resultFile, setResultFile] = useState(null);
  const [resultMetadata, setResultMetadata] = useState(null);
  const [suspected, setSuspected] = useState(null);
  const [autoRepair, setAutoRepair] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [imageTask, setImageTask] = useState(null);
  const [status, setStatus] = useState(null);
  const workerRef = useRef(null);
  const nativeDrag = typeof window !== 'undefined' && window.novelaiDragImage;
  const directionRef = useRef(null);
  const exerciseRef = useRef(onExerciseAction);
  exerciseRef.current = onExerciseAction;
  const dragOrigin = useRef(null);
  const activeFile = resultFile || imageFile;
  const showTools = toolsOpen || autoRepair;
  const currentMetadata = resultFile ? (resultMetadata?.file === resultFile ? resultMetadata.metadata : null) : metadata;
  const readingMetadata = !suspected && (resultFile ? resultMetadata?.file !== resultFile : reading);

  useEffect(() => {
    setResultFile(null);
    setResultMetadata(null);
    setSuspected(null);
    setAutoRepair(false);
    setToolsOpen(false);
    setStatus(null);
    setImageTask(null);
    dragOrigin.current = null;
    if (!open || !imageFile) return undefined;

    const worker = new Worker(new URL('./imageScramble.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setImageTask('detect');
    worker.onmessage = ({ data: { blob, suspected: nextSuspected, error } }) => {
      setImageTask(null);
      if (error) {
        setStatus({ key: error, severity: 'warning' });
        return;
      }
      setSuspected(nextSuspected);
      if (!blob) {
        setAutoRepair(nextSuspected);
        return;
      }
      if (directionRef.current) exerciseRef.current?.(directionRef.current);
      directionRef.current = null;
      const stem = imageFile.name.replace(/\.[^.]+$/, '');
      setResultFile(new File([blob], `${stem}.png`, { type: 'image/png' }));
      if (!nextSuspected) {
        setAutoRepair(false);
        setToolsOpen(false);
      }
    };
    worker.onerror = () => {
      setSuspected(null);
      worker.terminate();
      setImageTask(null);
      setStatus({ key: 'imageToolFailed', severity: 'warning' });
    };
    worker.postMessage({ file: imageFile });
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, [open, imageFile]);

  useEffect(() => {
    if (!open || !resultFile || suspected) return undefined;
    let cancelled = false;
    // 从实际输出文件重读，使本次使用、导出后重新导入走同一套元数据解析。
    void extractMetadataFromFile(resultFile).then(next => {
      if (!cancelled) setResultMetadata({ file: resultFile, metadata: next });
    });
    return () => { cancelled = true; };
  }, [open, resultFile, suspected]);

  useEffect(() => {
    if (!open) return;
    const detectedModel = resolveMetadataModel(currentMetadata?.model);
    const permittedModel = detectedModel && (!allowedModels || allowedModels.includes(detectedModel)) ? detectedModel : undefined;
    setSelected({ ...defaultSelection, model: Boolean(permittedModel) });
    setDraft(currentMetadata ? normalizeImageImportParameters({ ...currentMetadata, model: permittedModel || params.model },
      { ...params, model: permittedModel || params.model }, restrictedAccount) : {});
  }, [open, activeFile, currentMetadata, params, restrictedAccount, allowedModels]);

  useEffect(() => {
    if (!open) return undefined;
    if (!activeFile) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(activeFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [open, activeFile]);

  const effectiveParams = { ...params, model: selected.model ? draft.model : params.model };
  const options = getImageImportOptions(effectiveParams, restrictedAccount);
  const modelOptions = MODEL_OPTIONS.filter(option => option.category !== 'video' && (!allowedModels || allowedModels.includes(option.value)));
  const allowedKeys = new Set(['model', ...Object.keys(options.ranges),
    ...(options.resolutions.length ? ['width', 'height'] : []),
    ...(options.novelAI ? ['sampler', 'smea', 'dyn', ...(options.medium ? [] : ['noiseSchedule'])] : []),
    ...(options.novelAI && !isNovelAIV5Model(effectiveParams.model) ? advancedParameterKeys : [])]);
  const importKeys = ['positivePrompt', 'negativePrompt', 'characterTabs', ...parameterKeys]
    .filter(key => draft[key] !== undefined && (key !== 'characterTabs' || draft[key].length > 0)
      && (!parameterKeys.includes(key) || allowedKeys.has(key)) && !(options.medium && key === 'negativePrompt'));
  const showMetadata = Boolean(!suspected && currentMetadata && importKeys.length);
  const actionItems = showTools ? ['scramble', 'unscramble'] : imageActions;
  const handleImageAction = (action) => {
    if (!showTools) {
      onUseImage(action, activeFile);
      return;
    }
    setToolsOpen(true);
    setStatus(null);
    setImageTask('transform');
    directionRef.current = action;
    workerRef.current.postMessage({ direction: action });
  };
  const copyImage = async () => {
    try {
      if (!window.novelaiCopyImage && (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')) {
        throw new Error('Image clipboard unavailable');
      }
      const png = activeFile.type === 'image/png' ? activeFile : (async () => {
        const image = await createImageBitmap(activeFile);
        try {
          const canvas = new OffscreenCanvas(image.width, image.height);
          canvas.getContext('2d').drawImage(image, 0, 0);
          return await canvas.convertToBlob({ type: 'image/png' });
        } finally {
          image.close();
        }
      })();
      if (window.novelaiCopyImage) await window.novelaiCopyImage(await png);
      else await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setStatus({ key: 'imageCopied', severity: 'success' });
    } catch {
      setStatus({ key: 'copyImageFailed', severity: 'error' });
    }
  };
  const dragImage = async (event) => {
    const origin = dragOrigin.current;
    if (!origin || !(event.buttons & 1) || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
    // 在 WebView 启动自身的拖放前交给 Windows，避免两套拖放同时捕获鼠标。
    dragOrigin.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    try {
      await nativeDrag(activeFile);
    } catch {
      setStatus({ key: 'dragImageFailed', severity: 'error' });
    }
  };
  const saveImage = async () => {
    try {
      await (window.novelaiSaveFile ?? saveAs)(activeFile, activeFile.name);
    } catch {
      setStatus({ key: 'saveImageFailed', severity: 'error' });
    }
  };
  const dragDownload = (event) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('DownloadURL', `${activeFile.type || 'application/octet-stream'}:${activeFile.name.replaceAll(':', '_')}:${preview}`);
  };
  const hasSelection = importKeys.some(key => selected[key]
    && (key !== 'characterTabs' || draft.characterTabs.some((_, index) => selected[`character_${index}`] !== false)));
  const allSelected = importKeys.every(key => selected[key]
    && (key !== 'characterTabs' || draft.characterTabs.every((_, index) => selected[`character_${index}`] !== false)));
  const toggleParameter = (key, checked) => {
    setSelected(current => ({ ...current, [key]: checked,
      ...(['width', 'height'].includes(key) ? { width: checked, height: checked } : {}),
    }));
    if (key === 'model') setDraft(current => normalizeImageImportParameters(current,
      { ...params, model: checked ? current.model : params.model }, restrictedAccount));
  };
  const updateParameter = (key, value) => {
    const model = key === 'model' ? value : effectiveParams.model;
    setDraft(current => normalizeImageImportParameters({ ...current, [key]: value }, { ...params, model }, restrictedAccount,
      ['width', 'height'].includes(key) ? key : undefined));
    if (key === 'model') setSelected(current => ({ ...current, model: true }));
  };
  const apply = () => {
    const normalized = normalizeImageImportParameters(draft, effectiveParams, restrictedAccount);
    const filtered = {};
    for (const key of importKeys) {
      if (!selected[key]) continue;
      if (key === 'characterTabs') {
        const characters = normalized.characterTabs.filter((_, index) => selected[`character_${index}`] !== false)
          .map(character => options.medium ? { ...character, uc: '' } : character);
        if (characters.length) filtered[key] = characters;
      } else filtered[key] = normalized[key];
    }
    onApply(filtered);
  };

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="image-import-title"
    PaperProps={{ sx: {
      maxWidth: showMetadata ? 980 : 520, m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' },
      height: showMetadata ? { xs: 'calc(100dvh - 24px)', sm: 'min(740px, calc(100dvh - 64px))' } : 'auto', maxHeight: 'calc(100dvh - 24px)',
      borderRadius: 3, backgroundImage: 'none', overflow: 'hidden',
      '@media (min-width: 600px) and (max-height: 500px)': { m: 1.5, width: 'calc(100% - 24px)', height: 'auto', maxHeight: 'calc(100dvh - 24px)' },
    } }}>
    <DialogTitle id="image-import-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: { xs: 2, sm: 2.5 }, pr: 6, flexShrink: 0 }}>
      <ImageOutlined color="primary" />
      <Typography component="span" sx={{ fontSize: { xs: 17, sm: 20 }, fontWeight: 600 }}>{t('painting.tools.metadata.chooseImageAction')}</Typography>
      <IconButton onClick={onClose} data-tour="dialogClose" aria-label={t('painting.tools.metadata.close')} sx={{ position: 'absolute', right: 12, top: 12 }}><Close fontSize="small" /></IconButton>
    </DialogTitle>
      {practiceInstructions}
    <DialogContent dividers sx={{
      p: { xs: 1.5, sm: 2.5 }, minHeight: 0, overflow: showMetadata ? 'hidden' : 'auto', display: 'grid', gap: { xs: 1.5, sm: 2.5 },
      gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: showMetadata && imageFile ? 'minmax(0, 0.95fr) minmax(0, 1.05fr)' : 'minmax(0, 1fr)' },
      gridTemplateRows: { xs: showMetadata && imageFile ? 'auto minmax(0, 1fr)' : 'auto', sm: showMetadata ? 'minmax(0, 1fr)' : 'auto' },
    }}>
      {preview && activeFile && <Box sx={{
        minHeight: 0, minWidth: 0, overflowY: 'auto', display: { xs: 'grid', sm: 'flex' }, flexDirection: 'column',
        gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.25, alignContent: 'start',
      }}>
        <Box sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.default', flexShrink: 0 }}>
          <Box sx={{ position: 'relative' }}>
            <Box component="img" src={preview} alt={t('painting.tools.metadata.imagePreview')} data-share-image-name={activeFile.name} draggable={false}
              sx={{ display: 'block', width: '100%', height: { xs: 'clamp(120px, 30dvh, 220px)', sm: 'clamp(140px, 38dvh, 300px)' }, objectFit: 'contain', p: 1 }} />
            <Tooltip title={t('painting.tools.metadata.imageTools')}>
              <Box component="span" sx={{ position: 'absolute', right: 8, top: 8, display: 'inline-flex' }}>
                <ToggleButton value="imageTools" data-tour="imageTools" size="small" selected={showTools} disabled={autoRepair || Boolean(imageTask)}
                  aria-label={t('painting.tools.metadata.imageTools')} onChange={() => setToolsOpen(!toolsOpen)}
                  sx={{
                    p: 0.75, bgcolor: 'background.paper',
                    '&.Mui-selected': { color: 'primary.main', borderColor: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.14) },
                    '&.Mui-selected:hover': { bgcolor: theme => alpha(theme.palette.primary.main, 0.22) },
                    '&.Mui-disabled': { color: 'action.disabled', borderColor: 'divider', bgcolor: 'background.paper' },
                  }}><BuildOutlined fontSize="small" /></ToggleButton>
              </Box>
            </Tooltip>
          </Box>
          <Box sx={{ px: 1.25, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" title={activeFile.name} noWrap sx={{ display: 'block', fontWeight: 500 }}>{activeFile.name}</Typography>
              <Typography variant="caption" color="text.secondary">{(activeFile.size / 1024 / 1024).toFixed(2)} MB</Typography>
            </Box>
            {nativeDrag ? <Tooltip title={t('painting.tools.metadata.dragImage')}>
              <IconButton size="small" aria-label={t('painting.tools.metadata.dragImage')}
                onPointerDown={event => {
                  if (event.button !== 0) return;
                  dragOrigin.current = { x: event.clientX, y: event.clientY };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={dragImage}
                onLostPointerCapture={() => { dragOrigin.current = null; }}
                sx={{ cursor: 'grab', '&:active': { cursor: 'grabbing' } }}><DragIndicator fontSize="small" /></IconButton>
            </Tooltip> : <Tooltip title={t('painting.tools.metadata.saveImage')}>
              <IconButton size="small" aria-label={t('painting.tools.metadata.saveImage')} onClick={saveImage}
                draggable={typeof window !== 'undefined' && !window.novelaiSaveFile} onDragStart={dragDownload}><FileDownloadOutlined fontSize="small" /></IconButton>
            </Tooltip>}
            <Tooltip title={t('painting.workspace.gallery.copyImage')}>
              <IconButton size="small" aria-label={t('painting.workspace.gallery.copyImage')} onClick={copyImage}><ContentCopy fontSize="small" /></IconButton>
            </Tooltip>
          </Box>
        </Box>
        {suspected && <Alert severity="warning" sx={{ py: 0 }}>
          {t('painting.tools.metadata.possibleScramble')}
          {autoRepair && resultFile && <Typography variant="body2" sx={{ mt: 0.5 }}>{t('painting.tools.metadata.scrambleDirectionTip')}</Typography>}
        </Alert>}
        {status && <Alert severity={status.severity} sx={{ py: 0 }}>{t(`painting.tools.metadata.${status.key}`)}</Alert>}
        {readingMetadata && <Typography role="status" variant="body2" color="text.secondary">{t('painting.tools.metadata.readingInformation')}</Typography>}
        {imageTask === 'transform' && <Typography role="status" variant="body2" color="text.secondary">{t('painting.tools.metadata.processingImage')}</Typography>}
        {actionItems.length > 0 && <Box data-image-purpose-actions sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {actionItems.map(action => {
            const Icon = showTools ? (action === 'scramble' ? Shuffle : LockOpenOutlined) : actionIcons[action];
            return <Button key={action} variant="outlined" size="small" startIcon={<Icon fontSize="small" />} data-tour={action} onClick={() => handleImageAction(action)}
              disabled={Boolean(imageTask) || (showTools && suspected === null)} sx={{
              flex: '1 0 auto', whiteSpace: 'nowrap', textTransform: 'none', color: 'text.primary', borderColor: 'divider',
              borderRadius: 1.5, minWidth: 0, minHeight: 32, px: 1, fontSize: 12, lineHeight: 1.4,
              '& .MuiButton-startIcon': { color: 'primary.main', mr: 0.5, ml: 0 },
              '& .MuiButton-startIcon > :nth-of-type(1)': { fontSize: 16 },
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
            }}>{t(`painting.tools.metadata.${showTools ? action : `useImage.${action}`}`)}</Button>;
          })}
        </Box>}
      </Box>}
      {showMetadata && <Box data-metadata-scroll sx={{ minHeight: 0, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain', pr: 0.75, pb: 0.5, scrollbarGutter: 'stable', '& .MuiCheckbox-root.Mui-checked': { color: theme => alpha(theme.palette.primary.main, 0.65) } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="subtitle2">{t('painting.tools.metadata.informationToImport')}</Typography>
            {importKeys.length > 0 && <Button size="small" onClick={() => setSelected({
              ...Object.fromEntries(importKeys.map(key => [key, !allSelected])),
              ...Object.fromEntries((draft.characterTabs || []).map((_, index) => [`character_${index}`, !allSelected])),
            })}>{t(allSelected ? 'painting.tools.metadata.deselectAll' : 'painting.tools.metadata.selectAll')}</Button>}
          </Stack>
          {['positivePrompt', 'negativePrompt'].filter(key => draft[key] !== undefined).map(key => <Box key={key}
            data-metadata-field={key} onClick={() => { if (!(options.medium && key === 'negativePrompt')) toggleParameter(key, !selected[key]); }}
            sx={{ p: 1.25, border: 1, borderColor: theme => selected[key] ? alpha(theme.palette.primary.main, 0.35) : theme.palette.divider, bgcolor: 'transparent', borderRadius: 2, cursor: 'pointer' }}>
            <FormControlLabel sx={{ m: 0, mb: 0.5 }} label={t(`painting.tools.notebook.${key}`)} onClick={event => event.stopPropagation()}
              control={<Checkbox size="small" disabled={options.medium && key === 'negativePrompt'} checked={Boolean(selected[key]) && !(options.medium && key === 'negativePrompt')} onChange={(_, checked) => toggleParameter(key, checked)} />} />
            <Box onClick={event => event.stopPropagation()}>
              <InlinePromptInput value={draft[key]} previewEnabled expandToContent minRows={2}
                placeholder={t(`painting.tools.notebook.${key}`)} inputProps={{ readOnly: options.medium && key === 'negativePrompt' }}
                onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, [key]: value })); }} />
            </Box>
          </Box>)}
          {draft.characterTabs?.length > 0 && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.characterInfo')}</Typography>
            <Stack spacing={1.25}>
              {draft.characterTabs.map((character, index) => {
                const checked = Boolean(selected.characterTabs) && selected[`character_${index}`] !== false;
                return <Box key={index} data-metadata-field={`character_${index}`} onClick={() => setSelected(current => ({ ...current, characterTabs: true, [`character_${index}`]: !checked }))}
                  sx={{ p: 1.25, border: 1, borderColor: theme => checked ? alpha(theme.palette.primary.main, 0.35) : theme.palette.divider, bgcolor: 'transparent', borderRadius: 2, cursor: 'pointer' }}>
                  <FormControlLabel sx={{ m: 0, mb: 1 }} label={character.name || `${t('painting.tools.metadata.importCharacters')} ${index + 1}`} onClick={event => event.stopPropagation()}
                    control={<Checkbox size="small" checked={checked} onChange={(_, nextChecked) => setSelected(current => ({ ...current, characterTabs: true, [`character_${index}`]: nextChecked }))} />} />
                  <Stack spacing={1.25}>
                    {['prompt', 'uc'].map(key => <Box key={key} onClick={event => event.stopPropagation()}>
                      <Typography variant="caption" color="text.secondary">{t(key === 'prompt' ? 'painting.tools.metadata.characterDescription' : 'painting.tools.metadata.characterNegative')}</Typography>
                      <InlinePromptInput value={character[key] || ''} previewEnabled expandToContent minRows={2}
                        placeholder={t(key === 'prompt' ? 'painting.tools.metadata.characterDescription' : 'painting.tools.metadata.characterNegative')}
                        inputProps={{ readOnly: options.medium && key === 'uc' }} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current,
                          characterTabs: current.characterTabs.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
                        })); }} />
                    </Box>)}
                    <Typography variant="caption" color="text.secondary">
                      {character.position ? (/^[A-E][1-5]$/.test(character.position) ? t(`painting.tools.metadata.positions.${character.position}`) : character.position) : t('painting.tools.metadata.positionNotSet')}
                      {character.center && ` · X: ${character.center.x} · Y: ${character.center.y}`}
                    </Typography>
                  </Stack>
                </Box>;
              })}
            </Stack>
          </Box>}
          {parameterKeys.some(key => importKeys.includes(key)) && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.basicParameters')}</Typography>
            <Stack spacing={0.75}>
              {parameterKeys.filter(key => importKeys.includes(key) && key !== 'height').map(key => {
                const size = key === 'width';
                const choices = key === 'model' ? modelOptions : key === 'sampler' ? SAMPLER_OPTIONS : key === 'noiseSchedule' ? NOISE_SCHEDULE_OPTIONS : null;
                const label = t(advancedParameterLabels[key]
                  ? `painting.workspace.parameters.${advancedParameterLabels[key]}`
                  : `painting.tools.metadata.${size ? 'size' : key}`);
                const fixed = Object.hasOwn(options.fixed, key);
                return <Box key={key} data-metadata-field={size ? 'size' : key}
                  onClick={() => toggleParameter(key, !selected[key])}
                  sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 1, pr: 1, border: 1,
                    borderColor: theme => selected[key] ? alpha(theme.palette.primary.main, 0.35) : theme.palette.divider, borderRadius: 1.5, cursor: 'pointer' }}>
                  <Checkbox size="small" checked={Boolean(selected[key])} inputProps={{ 'aria-label': t('painting.tools.metadata.selectParameter', { name: label }) }}
                    onClick={event => event.stopPropagation()} onChange={(_, checked) => toggleParameter(key, checked)} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{label}</Typography>
                  <Box sx={{ width: '58%', minWidth: 0 }} onClick={event => event.stopPropagation()}>
                    {size ? <Stack direction="row" spacing={1}>
                      {['width', 'height'].map(dimension => <TextField key={dimension} select size="small" fullWidth value={draft[dimension]}
                        label={t(`painting.tools.metadata.${dimension}`)} onChange={event => updateParameter(dimension, Number(event.target.value))}>
                        {[...new Set(options.resolutions.map(resolution => resolution[dimension === 'width' ? 0 : 1]))].sort((a, b) => a - b)
                          .map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                      </TextField>)}
                    </Stack> : choices ? <TextField select fullWidth size="small" value={draft[key]} disabled={fixed}
                      label={label} onChange={event => updateParameter(key, event.target.value)}>
                      {choices.map(option => <MenuItem key={option.value} value={option.value}>{key === 'noiseSchedule' ? t(`painting.workspace.parameters.${option.label}`) : option.label}</MenuItem>)}
                    </TextField> : typeof draft[key] === 'boolean' ? <Switch size="small" checked={draft[key]} disabled={fixed}
                      inputProps={{ 'aria-label': label }} onChange={(_, checked) => updateParameter(key, checked)} />
                    : key === 'seed' ? <TextField size="small" fullWidth value={draft[key]} type="number" label={label}
                      inputProps={{ min: options.ranges.seed.min, max: options.ranges.seed.max, step: 1 }}
                      onChange={event => updateParameter(key, event.target.value === '' ? '' : Number(event.target.value))} />
                    : <Stack direction="row" spacing={1} alignItems="center">
                      <Slider size="small" value={draft[key]} {...options.ranges[key]} disabled={fixed} aria-label={label}
                        onChange={(_, value) => updateParameter(key, value)} />
                      <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right' }}>{draft[key]}</Typography>
                    </Stack>}
                  </Box>
                </Box>;
              })}
            </Stack>
            {currentMetadata?.model && !modelOptions.some(option => option.value === resolveMetadataModel(currentMetadata.model)) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {t('painting.tools.metadata.sourceModel', { name: currentMetadata.model })}
            </Typography>}
          </Box>}
        </Stack>
      </Box>}
    </DialogContent>
    <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, gap: 1, flexShrink: 0 }}>
      <Button color="inherit" onClick={onClose}>{t('common.cancel')}</Button>
      {showMetadata && onApply && <Button variant="contained" disabled={readingMetadata || !hasSelection} onClick={apply}>{t('painting.tools.metadata.importInformation')}</Button>}
    </DialogActions>
  </Dialog>;
}
