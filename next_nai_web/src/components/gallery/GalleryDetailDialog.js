"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Dialog, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, Close, ContentCopy, DeleteOutline, DescriptionOutlined, EditOutlined, ExpandMore, ImageOutlined, PaletteOutlined, RestoreFromTrashOutlined, SaveOutlined } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import GalleryMetadataFields, { getParameterSharedPaths } from './GalleryMetadataFields';

const basicFields = ['model', 'seed', 'steps', 'guidanceScale', 'sampler', 'width', 'height'];

/**
 * 按图片 ID 展示原图、合并提示词、角色与完整可视元数据，并支持保存选段为画风。
 * @param {object} props 详情 ID、分组以及图库的应用、回收、另存和切图回调。
 * @returns {React.ReactElement} 桌面左右分栏、手机上下分栏的全屏详情。
 */
export default function GalleryDetailDialog({ entryId, groups, onClose, onChanged, onApply, onTrash, onRestore, onMetadata, onPrevious, onNext, operationError = '', operationBusy = false }) {
  const { t } = useI18n();
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [selectedText, setSelectedText] = useState('');
  const promptRef = useRef(null);
  const rolePromptRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice(''); setEditing(false); setSelectedText('');
    apiClient.getGalleryEntry(entryId).then((result) => {
      if (!active) return;
      setEntry(result);
      setDraft({ title: result.title || '', prompt: result.prompt || '', negative_prompt: result.negative_prompt || '', style_prompt: result.style_prompt || '', group_id: result.group_id || '' });
    }).catch((requestError) => { if (active) setError(requestError.data?.error || requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entryId]);

  useEffect(() => {
    const captureSelection = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      const roleSource = selection?.anchorNode?.parentElement?.closest('[data-gallery-style-source="true"]');
      const inRolePrompt = roleSource && rolePromptRef.current?.contains(roleSource) && roleSource.contains(selection.focusNode);
      if (text && ((promptRef.current?.contains(selection.anchorNode) && promptRef.current?.contains(selection.focusNode)) || inRolePrompt)) {
        // 固定在侧栏底部的确认区保留选段，手机收起文字工具条后仍能保存。
        setSelectedText(text);
      }
    };
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  }, []);

  const save = async (changes) => {
    setBusy(true); setError('');
    try {
      const updated = await apiClient.updateGalleryEntry(entryId, changes);
      setEntry(updated);
      setDraft({ title: updated.title || '', prompt: updated.prompt || '', negative_prompt: updated.negative_prompt || '', style_prompt: updated.style_prompt || '', group_id: updated.group_id || '' });
      window.getSelection()?.removeAllRanges();
      setEditing(false); setSelectedText(''); setNotice(t('gallery.saved'));
      onChanged(updated);
    } catch (requestError) { setError(requestError.data?.error || requestError.message); }
    finally { setBusy(false); }
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice(t('gallery.copied')); }
    catch { setError(t('gallery.copyFailed')); }
  };

  const parameters = entry?.parameters || {};
  const hiddenParameters = [...getParameterSharedPaths(parameters), ...basicFields.map((key) => [key])];
  const title = entry?.title || entry?.filename || t('gallery.untitled');
  const trashed = Boolean(entry?.trashed_at);
  const actionBusy = busy || operationBusy;
  const cardSx = { p: { xs: 1.5, md: 2 }, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' };
  const promptSx = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.85, userSelect: 'text', fontSize: 13.5, maxHeight: { xs: 220, md: 280 }, overflowY: 'auto' };

  return <Dialog open fullScreen onClose={() => !actionBusy && onClose()} aria-labelledby="gallery-detail-title">
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 1, sm: 2 }, py: 0.75, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
      <Typography id="gallery-detail-title" variant="subtitle1" noWrap sx={{ flex: 1, minWidth: 0 }}>{title}</Typography>
      <IconButton size="small" aria-label={t('gallery.previous')} disabled={!onPrevious || actionBusy} onClick={onPrevious}><ChevronLeft /></IconButton>
      <IconButton size="small" aria-label={t('gallery.next')} disabled={!onNext || actionBusy} onClick={onNext}><ChevronRight /></IconButton>
      <IconButton aria-label={t('gallery.close')} disabled={actionBusy} onClick={onClose}><Close /></IconButton>
    </Stack>
    {loading ? <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box> : !entry ? <Alert severity="error" sx={{ m: 2 }}>{error}</Alert> :
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, overflow: 'hidden' }}>
        <Box sx={{ flex: { xs: `0 0 ${selectedText ? '28' : '40'}dvh`, md: '1 1 60%' }, minHeight: 0, minWidth: 0, bgcolor: '#101114', p: { xs: 0.5, md: 2 }, display: 'grid', placeItems: 'center' }}>
          {entry.url ? <Box component="img" src={entry.url} alt={title} sx={{ width: '100%', height: '100%', minHeight: 0, objectFit: 'contain' }} /> : <ImageOutlined sx={{ fontSize: 48, color: '#777' }} />}
        </Box>
        <Box sx={{ flex: { xs: 1, md: '0 0 40%' }, width: { md: 460 }, minWidth: { xs: 0, md: 360 }, minHeight: 0, display: 'flex', flexDirection: 'column', borderLeft: { md: 1 }, borderColor: 'divider' }}>
          <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1, p: { xs: 1.5, md: 2 }, bgcolor: 'background.default' }}>
            <Stack spacing={1.5}>
              {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
              {operationError && <Alert severity="error">{operationError}</Alert>}
              {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
              <Box sx={cardSx}>
                <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ flex: 1 }}>{t('gallery.imageDetails')}</Typography>
                  {!trashed && <Button size="small" startIcon={editing ? <Close /> : <EditOutlined />} disabled={actionBusy} onClick={() => {
                    if (editing) setDraft({ title: entry.title || '', prompt: entry.prompt || '', negative_prompt: entry.negative_prompt || '', style_prompt: entry.style_prompt || '', group_id: entry.group_id || '' });
                    setEditing(!editing); setSelectedText('');
                  }}>{t(editing ? 'gallery.cancelEdit' : 'gallery.editDetails')}</Button>}
                </Stack>
                {editing ? <Stack spacing={1.5}>
                  <TextField size="small" label={t('gallery.optionalTitle')} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} inputProps={{ maxLength: 200 }} />
                  <TextField size="small" select label={t('gallery.group')} value={draft.group_id} onChange={(event) => setDraft({ ...draft, group_id: event.target.value })}>
                    <MenuItem value="">{t('gallery.ungrouped')}</MenuItem>{groups.map((group) => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
                  </TextField>
                </Stack> : <>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 1 }}>{entry.filename}</Typography>
                  <Stack direction="row" gap={0.75} flexWrap="wrap">
                    {entry.width && entry.height && <Chip size="small" label={`${entry.width} × ${entry.height}`} />}
                    <Chip size="small" variant="outlined" label={groups.find((group) => group.id === entry.group_id)?.name || t('gallery.ungrouped')} />
                  </Stack>
                </>}
              </Box>
              <Box sx={cardSx}>
                <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('gallery.mainPrompts')}</Typography>
                <Stack spacing={2}>
                  {['prompt', 'negative_prompt'].map((field) => <Box key={field}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t(`gallery.${field}`)}</Typography>
                      {!editing && <Tooltip title={t(field === 'prompt' ? 'gallery.copyPrompt' : 'gallery.copyNegativePrompt')}><IconButton size="small" aria-label={t(field === 'prompt' ? 'gallery.copyPrompt' : 'gallery.copyNegativePrompt')} disabled={!entry[field]} onClick={() => copy(entry[field])}><ContentCopy sx={{ fontSize: 15 }} /></IconButton></Tooltip>}
                    </Stack>
                    {editing ? <TextField fullWidth multiline minRows={field === 'prompt' ? 5 : 2} maxRows={14} size="small" label={t(`gallery.${field}`)} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />
                      : <Typography ref={field === 'prompt' ? promptRef : undefined} tabIndex={0} variant="body2" color={entry[field] ? 'text.primary' : 'text.secondary'} sx={promptSx}>{entry[field] || t('gallery.emptyPrompt')}</Typography>}
                  </Box>)}
                </Stack>
                {!trashed && !editing && <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={{ mt: 1.5, px: 1, py: 0.75, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <PaletteOutlined sx={{ fontSize: 17, mt: 0.2, color: 'primary.main' }} /><Typography variant="caption" color="text.secondary">{t('gallery.selectStyleHint')}</Typography>
                </Stack>}
              </Box>
              <Box sx={cardSx}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}><PaletteOutlined sx={{ fontSize: 18, color: 'primary.main' }} /><Typography variant="subtitle2">{t('gallery.style_prompt')}</Typography></Stack>
                  {!editing && <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Tooltip title={t('gallery.copyStyle')}><IconButton size="small" aria-label={t('gallery.copyStyle')} disabled={!entry.style_prompt} onClick={() => copy(entry.style_prompt)}><ContentCopy sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                    <Button size="small" variant="outlined" disabled={!entry.style_prompt || trashed || actionBusy} onClick={() => onApply(entry, 'style')}>{t('gallery.applyStyle')}</Button>
                  </Stack>}
                </Stack>
                {editing ? <TextField fullWidth multiline minRows={2} maxRows={8} size="small" label={t('gallery.style_prompt')} value={draft.style_prompt} onChange={(event) => setDraft({ ...draft, style_prompt: event.target.value })} />
                  : <Typography variant="body2" color={entry.style_prompt ? 'text.primary' : 'text.secondary'} sx={promptSx}>{entry.style_prompt || t('gallery.noStyle')}</Typography>}
              </Box>
              {editing && <Stack spacing={1}><Button variant="contained" startIcon={<SaveOutlined />} disabled={actionBusy} onClick={() => save(draft)}>{t(busy ? 'gallery.saving' : 'gallery.saveDetails')}</Button><Typography variant="caption" color="text.secondary">{t('gallery.catalogEditHint')}</Typography></Stack>}
              {parameters.characterTabs?.length > 0 && <Box ref={rolePromptRef} sx={cardSx}>
                <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('gallery.characterPrompts')}</Typography>
                <GalleryMetadataFields value={{ characterTabs: parameters.characterTabs }} />
              </Box>}
              <Box sx={cardSx}>
                <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('gallery.generationParameters')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                  {basicFields.filter((key) => parameters[key] !== undefined).map((key) => <Box key={key} sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1, gridColumn: key === 'model' ? '1 / -1' : undefined }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t(`gallery.${key}`)}</Typography><Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{String(parameters[key])}</Typography>
                  </Box>)}
                </Box>
              </Box>
              <Accordion disableGutters elevation={0} sx={{ ...cardSx, p: 0, '&:before': { display: 'none' } }}>
                <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="subtitle2">{t('gallery.otherParameters')}</Typography></AccordionSummary>
                <AccordionDetails><GalleryMetadataFields value={parameters} hiddenPaths={hiddenParameters} /></AccordionDetails>
              </Accordion>
              {entry.metadata_document && <Accordion disableGutters elevation={0} sx={{ ...cardSx, p: 0, '&:before': { display: 'none' } }}>
                <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="subtitle2">{t('gallery.originalMetadata')}</Typography></AccordionSummary>
                <AccordionDetails><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{t('gallery.metadataTreeHint')}</Typography>
                  <GalleryMetadataFields value={entry.metadata_document} hiddenPaths={entry.metadata_shared_paths || []} />
                </AccordionDetails>
              </Accordion>}
            </Stack>
          </Box>
          {selectedText && !trashed && !editing && <Box role="status" sx={{ flexShrink: 0, p: 1.5, borderTop: 2, borderColor: 'primary.main', bgcolor: 'background.paper', boxShadow: '0 -4px 18px rgba(0,0,0,0.08)' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="caption" color="primary" sx={{ fontWeight: 700 }}>{t('gallery.selectedStylePreview')}</Typography><IconButton size="small" aria-label={t('gallery.clearSelection')} onClick={() => { window.getSelection()?.removeAllRanges(); setSelectedText(''); }}><Close sx={{ fontSize: 17 }} /></IconButton></Stack>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', mb: 1 }}>{selectedText}</Typography>
            <Button fullWidth size="small" variant="contained" startIcon={<SaveOutlined />} disabled={actionBusy} onClick={() => save({ style_prompt: selectedText })} sx={{ minHeight: 38 }}>{t('gallery.saveSelectedStyle')}</Button>
          </Box>}
          <Box sx={{ p: 1.25, pb: 'max(10px, env(safe-area-inset-bottom))', borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Stack direction="row" flexWrap="wrap" gap={0.75}>
              {trashed ? <Button size="small" disabled={actionBusy} startIcon={<RestoreFromTrashOutlined />} onClick={() => onRestore(entry)}>{t('gallery.restore')}</Button> : <>
                <Button size="small" variant="contained" disabled={actionBusy || editing || (!entry.prompt && !Object.keys(parameters).length)} onClick={() => onApply(entry, 'parameters')}>{t('gallery.applyAll')}</Button>
                <Button size="small" variant="outlined" disabled={actionBusy || editing || (!entry.prompt && !entry.negative_prompt)} onClick={() => onApply(entry, 'prompt')}>{t('gallery.applyPrompt')}</Button>
                <Button size="small" startIcon={<DescriptionOutlined />} disabled={actionBusy || editing} onClick={() => onMetadata(entry)}>{t('gallery.metadata')}</Button>
                <Tooltip title={t('gallery.trash')}><IconButton size="small" color="error" aria-label={t('gallery.trash')} disabled={actionBusy || editing} onClick={() => onTrash(entry)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
              </>}
            </Stack>
          </Box>
        </Box>
      </Box>}
  </Dialog>;
}
