"use client";

import React, { useEffect, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Add, ArrowBack, Close, ExpandMore, History, Restore, SaveOutlined, EditOutlined } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import GalleryMetadataFields from './GalleryMetadataFields';
import VersionBlueprintCanvas from './VersionBlueprintCanvas';
import VersionSnapshotDetails from './VersionSnapshotDetails';

const editableParameters = ['model', 'seed', 'steps', 'guidanceScale', 'sampler', 'width', 'height', 'noiseSchedule', 'promptGuidanceRescale', 'characterTabs', 'use_coords'];
const emptyBlueprint = { positions: {}, edge_notes: {}, hidden_node_ids: [], groups: [] };

/**
 * 用图片蓝图管理作品分支，选择节点比较父子修改并复用其完整参数。
 * @param {object} props 入口图片、初始作品，以及关闭和复用节点的回调。
 * @returns {React.ReactElement} 包含蓝图、节点详情和版本提交的全屏工作区。
 */
export default function GalleryVersionsDialog({ open, onClose, imageIds = [], initialWorkId = null, onContinue, imageEntry = null }) {
  const { t, locale } = useI18n();
  const zh = locale !== 'en-US';
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState(null);
  const [work, setWork] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [blueprint, setBlueprint] = useState(emptyBlueprint);
  const [savedBlueprint, setSavedBlueprint] = useState(emptyBlueprint);
  const [blueprintSaving, setBlueprintSaving] = useState(false);
  const [blueprintFailed, setBlueprintFailed] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({ positivePrompt: '', negativePrompt: '' });
  const [attachImages, setAttachImages] = useState(imageIds.length > 0);
  const [candidate, setCandidate] = useState(imageEntry);
  const [revision, setRevision] = useState(0);
  const candidateId = imageIds[0] || '';
  const locked = busy || blueprintSaving;

  const chooseDraft = (parameters) => {
    setDraft({ ...parameters, positivePrompt: parameters.positivePrompt || '', negativePrompt: parameters.negativePrompt || '' });
  };

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true); setError(''); setNotice(''); setCreating(false); setBlueprintFailed(false);
    setAttachImages(Boolean(candidateId));
    Promise.all([apiClient.getWorks(), candidateId ? apiClient.getImageVersions(candidateId) : Promise.resolve({ works: [] }),
      candidateId ? apiClient.getGalleryEntry(candidateId) : Promise.resolve(null),
    ]).then(([all, linked, entry]) => {
      if (!active) return;
      setWorks(all.works); setCandidate(entry);
      setWorkId(initialWorkId || linked.works[0]?.id || null);
      setWork(null); setVersions([]); setSelectedId(''); setCompareId('');
      setTitle(entry?.title || ''); setMessage('');
      chooseDraft(entry ? { ...entry.parameters, positivePrompt: entry.prompt || '', negativePrompt: entry.negative_prompt || '' } : {});
      setRevision((value) => value + 1);
    }).catch((requestError) => { if (active) setError(requestError.data?.error || requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, initialWorkId, candidateId]);

  useEffect(() => {
    if (!open || !workId) return undefined;
    let active = true;
    setLoading(true); setError(''); setWork(null); setVersions([]);
    apiClient.getWork(workId).then((result) => {
      if (!active) return;
      const ordered = [...result.versions].sort((a, b) => a.number - b.number);
      const latest = ordered.at(-1);
      setWork(result.work); setTitle(result.work.title); setVersions(ordered);
      setBlueprint(result.blueprint || emptyBlueprint); setSavedBlueprint(result.blueprint || emptyBlueprint); setBlueprintFailed(false);
      setSelectedId(latest?.id || ''); setCompareId(latest?.parent_id || ''); setMessage('');
      setAttachImages(false); setDetailOpen(true); setRenaming(false);
      chooseDraft(latest?.parameters || {});
    }).catch((requestError) => { if (active) setError(requestError.data?.error || requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, workId, revision]);

  const selected = versions.find((version) => version.id === selectedId);
  const compared = versions.find((version) => version.id === compareId);
  const saveBlueprint = async (next) => {
    setBlueprint(next); setBlueprintSaving(true); setBlueprintFailed(false); setError('');
    try { await apiClient.updateWorkBlueprint(workId, next); setSavedBlueprint(next); }
    catch (requestError) { setBlueprintFailed(true); setError(requestError.data?.error || requestError.message); }
    finally { setBlueprintSaving(false); }
  };

  const save = async (restore = false) => {
    setBusy(true); setError(''); setNotice('');
    try {
      let result;
      if (restore) {
        result = await apiClient.createWorkVersion(workId, { parent_id: versions.at(-1).id, restore_version_id: selected.id, operation: 'restore', message: message.trim() || t('gallery.version.restoreMessage', { number: selected.number }) });
      } else {
        const images = attachImages ? imageIds : [];
        result = creating ? await apiClient.createWork({ title: title.trim(), parameters: draft, image_ids: images, message: message.trim() })
          : await apiClient.createWorkVersion(workId, { parent_id: selectedId, parameters: draft, image_ids: images, message: message.trim(), operation: 'manual' });
      }
      setCreating(false); setWorkId(result.work.id); setRevision((value) => value + 1); setAttachImages(false);
      setWorks((current) => [result.work, ...current.filter((item) => item.id !== result.work.id)]);
      setNotice(t('gallery.version.saved'));
    } catch (requestError) { setError(requestError.data?.error || requestError.message); }
    finally { setBusy(false); }
  };

  const commitEditor = <Stack spacing={1.5}>
    {creating && <TextField size="small" label={t('gallery.version.workTitle')} value={title} inputProps={{ maxLength: 200 }} onChange={(event) => setTitle(event.target.value)} />}
    {imageIds.length > 0 && <Box><FormControlLabel control={<Checkbox checked={attachImages} onChange={(_, checked) => setAttachImages(checked)} />} label={t('gallery.version.attachImages', { count: imageIds.length })} />{candidate && <Button size="small" disabled={locked} onClick={() => chooseDraft({ ...draft, ...candidate.parameters, positivePrompt: candidate.prompt || '', negativePrompt: candidate.negative_prompt || '' })}>{t('gallery.version.useImageParameters')}</Button>}</Box>}
    {['positivePrompt', 'negativePrompt'].map((field) => <TextField key={field} label={t('gallery.' + field)} size="small" multiline minRows={3} maxRows={10} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />)}
    <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}><AccordionSummary expandIcon={<ExpandMore />}>{t('gallery.generationParameters')}</AccordionSummary><AccordionDetails><GalleryMetadataFields value={Object.fromEntries(editableParameters.filter((key) => Object.hasOwn(draft, key)).map((key) => [key, draft[key]]))} onChange={(next) => setDraft({ ...draft, ...next })} allowStructure={false} disabled={locked} /><Typography variant="caption" color="text.secondary">{t('gallery.version.preservedParameters')}</Typography></AccordionDetails></Accordion>
    <TextField size="small" label={t('gallery.version.message')} value={message} inputProps={{ maxLength: 1000 }} onChange={(event) => setMessage(event.target.value)} />
    <Stack direction="row" justifyContent="flex-end" gap={1}>{creating && <Button startIcon={<ArrowBack />} disabled={locked} onClick={() => { setCreating(false); if (selected) chooseDraft(selected.parameters); setTitle(work?.title || ''); }}>{t('gallery.cancel')}</Button>}<Button startIcon={<SaveOutlined />} variant="contained" disabled={locked || blueprintFailed || (creating && !title.trim())} onClick={() => save()}>{t(busy ? 'gallery.saving' : 'gallery.version.commit')}</Button></Stack>
  </Stack>;

  return <Dialog open={open} onClose={() => !locked && !blueprintFailed && onClose()} fullScreen aria-labelledby="gallery-versions-title">
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <History color="primary" /><Box sx={{ flex: 1, minWidth: 0 }}><Typography id="gallery-versions-title" component="h2" variant="subtitle1" noWrap sx={{ fontWeight: 650 }}>{work && !creating ? work.title : (zh ? '作品蓝图' : 'Work blueprints')}</Typography><Typography variant="caption" color="text.secondary">{zh ? '图片节点 · 分支探索 · 修改对比' : 'Image nodes · Branches · Visual diffs'}</Typography></Box>
      {work && <Chip size="small" color={blueprintFailed ? 'error' : 'default'} label={blueprintSaving ? (zh ? '保存蓝图中…' : 'Saving…') : blueprintFailed ? (zh ? '蓝图未保存' : 'Unsaved') : (zh ? '蓝图已保存' : 'Saved')} />}
      <IconButton aria-label={t('gallery.close')} disabled={locked || blueprintFailed} onClick={onClose}><Close /></IconButton>
    </DialogTitle>
    <DialogContent sx={{ p: { xs: 1, md: 1.5 }, pt: '12px !important', display: 'flex', flexDirection: 'column', gap: 1.25, overflowY: { xs: 'auto', md: 'hidden' } }}>
      {error && <Alert severity="error" action={blueprintFailed ? <Stack direction="row"><Button color="inherit" onClick={() => saveBlueprint(blueprint)}>{zh ? '重试保存蓝图' : 'Retry save'}</Button><Button color="inherit" onClick={() => { setBlueprint(savedBlueprint); setBlueprintFailed(false); setError(''); }}>{zh ? '撤销未保存的布局' : 'Discard unsaved layout'}</Button></Stack> : undefined} onClose={blueprintFailed ? undefined : () => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <TextField select size="small" label={t('gallery.version.chooseWork')} value={workId || ''} disabled={locked || blueprintFailed} onChange={(event) => { setCreating(false); setWorkId(event.target.value || null); setWork(null); setVersions([]); }} sx={{ minWidth: 160, flex: 1, maxWidth: 380 }}>
          <MenuItem value="">{t('gallery.version.allWorks')}</MenuItem>{works.map((item) => <MenuItem key={item.id} value={item.id}>{item.title}</MenuItem>)}
        </TextField>
        <Button startIcon={<Add />} disabled={locked || blueprintFailed} onClick={() => { setCreating(true); setTitle(candidate?.title || ''); setMessage(''); setAttachImages(Boolean(candidateId)); chooseDraft(candidate ? { ...candidate.parameters, positivePrompt: candidate.prompt || '', negativePrompt: candidate.negative_prompt || '' } : {}); }}>{t('gallery.version.newWork')}</Button>
        {work && !creating && <><IconButton aria-label={t('gallery.version.rename')} onClick={() => setRenaming(!renaming)} disabled={locked}><EditOutlined fontSize="small" /></IconButton>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, display: { xs: 'none', md: 'block' } }}>{zh ? '选中节点即对比父节点；修改并生成或保存后形成新分支。' : 'Select a node to compare with its parent. Generate or save edits to create a new branch.'}</Typography>
          <Button size="small" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? (zh ? '收起详情' : 'Hide details') : (zh ? '节点详情' : 'Node details')}</Button></>}
      </Stack>
      {renaming && <Stack direction="row" gap={1}><TextField size="small" label={t('gallery.version.workTitle')} value={title} inputProps={{ maxLength: 200 }} onChange={(event) => setTitle(event.target.value)} /><Button disabled={locked || !title.trim()} onClick={async () => { setBusy(true); setError(''); try { await apiClient.updateWork(workId, { title: title.trim() }); setWork({ ...work, title: title.trim() }); setWorks(works.map((item) => item.id === workId ? { ...item, title: title.trim() } : item)); setRenaming(false); } catch (requestError) { setError(requestError.data?.error || requestError.message); } finally { setBusy(false); } }}>{t('gallery.saveDetails')}</Button></Stack>}
      {loading ? <Box sx={{ py: 5, textAlign: 'center' }}><CircularProgress size={28} /></Box> : <>
        {!workId && !creating && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1, overflowY: 'auto' }}>
          {!works.length && <Typography color="text.secondary">{t('gallery.version.emptyWorks')}</Typography>}
          {works.map((item) => <Button key={item.id} variant="outlined" onClick={() => setWorkId(item.id)} sx={{ minHeight: 110, gap: 1.5, textAlign: 'left', justifyContent: 'flex-start', overflowWrap: 'anywhere' }}>{item.thumbnail_url && <Box component="img" src={item.thumbnail_url} alt="" sx={{ width: 75, height: 80, objectFit: 'cover', borderRadius: 1 }} />}<Box><Typography>{item.title}</Typography><Typography variant="caption" color="text.secondary">{item.version_count} {zh ? '个节点' : 'nodes'}</Typography></Box></Button>)}
        </Box>}
        {creating && <Box sx={{ width: '100%', maxWidth: 680, alignSelf: 'center', overflowY: 'auto', p: 1 }}><Typography variant="h6" sx={{ mb: 2 }}>{t('gallery.version.newWork')}</Typography>{commitEditor}</Box>}
        {work && !creating && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: detailOpen && selected ? 'minmax(0, 1fr) 430px' : 'minmax(0, 1fr)' }, gap: 1.5, flex: { md: 1 }, minHeight: { md: 0 } }}>
          <Box sx={{ minWidth: 0, minHeight: { md: 0 }, height: { xs: 480, md: '100%' } }}><VersionBlueprintCanvas key={work.id} versions={versions} blueprint={blueprint} onBlueprintChange={saveBlueprint} selectedId={selectedId} onSelect={(id) => { setDetailOpen(true); if (id === selectedId) return; const version = versions.find((item) => item.id === id); setSelectedId(id); setCompareId(version.parent_id || ''); setMessage(''); chooseDraft(version.parameters); }} disabled={locked || blueprintFailed} /></Box>
          {selected && detailOpen && <Stack spacing={1.5} sx={{ minWidth: 0, overflowY: { md: 'auto' }, pr: { md: 0.5 }, pb: 2 }}>
            <Box sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
              <Stack direction="row" alignItems="center" gap={1}><Chip size="small" label={'v' + selected.number} /><Typography variant="body2" sx={{ flex: 1, overflowWrap: 'anywhere' }}>{selected.message || t('gallery.version.noMessage')}</Typography></Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', my: 0.75 }}>{new Date(selected.created_at).toLocaleString(locale)}{selected.parent_id ? ' · ' + (zh ? '从 v' : 'From v') + versions.find((item) => item.id === selected.parent_id)?.number : ' · ' + t('gallery.version.root')}</Typography>
              <Button fullWidth variant="contained" disabled={locked || blueprintFailed} onClick={() => onContinue(selected, work)}>{zh ? '复用此节点的全部参数' : 'Reuse all node parameters'}</Button>
              <Box sx={{ display: 'grid', gridTemplateColumns: compared ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 0.75, mt: 1.25 }}>
                {(compared ? [compared, selected] : [selected]).map((version) => <Box key={version.id} sx={{ minWidth: 0 }}><Typography variant="caption">v{version.number}</Typography>{version.images.length ? <Box sx={{ display: 'flex', overflowX: 'auto', gap: 0.5 }}>{version.images.map((image) => <Box key={image.id} component="a" href={image.url} target="_blank" rel="noopener noreferrer" aria-label={t('gallery.version.openOriginal', { number: version.number })} sx={{ display: 'block', flexShrink: 0, width: '100%' }}><Box component="img" src={image.thumbnail_url || image.url} alt={image.title || image.filename || t('gallery.untitled')} sx={{ height: 170, width: '100%', objectFit: 'contain', bgcolor: 'action.hover', borderRadius: 1 }} /></Box>)}</Box> : <Box sx={{ height: 90, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', borderRadius: 1 }}><Typography variant="caption">{t('gallery.version.promptOnly')}</Typography></Box>}</Box>)}
              </Box>
            </Box>
            <TextField select fullWidth size="small" label={t('gallery.version.compareWith')} value={compareId} onChange={(event) => setCompareId(event.target.value)}><MenuItem value="">{t('gallery.version.noCompare')}</MenuItem>{versions.filter((item) => item.id !== selectedId).map((item) => <MenuItem key={item.id} value={item.id}>{'v' + item.number + (item.id === selected.parent_id ? (zh ? ' · 父节点' : ' · Parent') : '') + ' · ' + (item.message || t('gallery.version.noMessage'))}</MenuItem>)}</TextField>
            <VersionSnapshotDetails key={selected.id + ':' + compareId} selected={selected} compared={compared} />
            <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMore />}>{t('gallery.version.commitFrom', { number: selected.number })}</AccordionSummary>
              <AccordionDetails>{commitEditor}</AccordionDetails>
            </Accordion>
            <Box><Button size="small" startIcon={<Restore />} disabled={locked || blueprintFailed} onClick={() => save(true)}>{t('gallery.version.restore')}</Button><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('gallery.version.restoreHint')}</Typography></Box>
          </Stack>}
        </Box>}
      </>}
    </DialogContent>
  </Dialog>;
}
