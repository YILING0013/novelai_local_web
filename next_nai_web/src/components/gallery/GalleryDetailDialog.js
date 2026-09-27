"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Dialog, Divider, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, Close, ContentCopy, DeleteOutline, DescriptionOutlined, EditOutlined, ExpandMore, ImageOutlined, PaletteOutlined, RestoreFromTrashOutlined, SaveOutlined } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 按图片 ID 加载原图、提示词和元数据，支持保存画风和独立应用各类参数。
 * @param {object} props 详情 ID、分组以及图库提供的应用、回收、另存和切图回调。
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

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setNotice('');
    setEditing(false);
    setSelectedText('');
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
      if (text && promptRef.current?.contains(selection.anchorNode) && promptRef.current?.contains(selection.focusNode)) {
        // 点击保存按钮会收起手机的文字选择工具条，仍保留刚才选定的片段。
        setSelectedText(text);
      }
    };
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  }, []);

  const save = async (changes) => {
    setBusy(true);
    setError('');
    try {
      const updated = await apiClient.updateGalleryEntry(entryId, changes);
      setEntry(updated);
      setDraft({ title: updated.title || '', prompt: updated.prompt || '', negative_prompt: updated.negative_prompt || '', style_prompt: updated.style_prompt || '', group_id: updated.group_id || '' });
      setEditing(false);
      setSelectedText('');
      setNotice(t('gallery.saved'));
      onChanged(updated);
    } catch (requestError) { setError(requestError.data?.error || requestError.message); }
    finally { setBusy(false); }
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice(t('gallery.copied')); }
    catch { setError(t('gallery.copyFailed')); }
  };

  const parameters = entry?.parameters || {};
  const title = entry?.title || entry?.filename || t('gallery.untitled');
  const trashed = Boolean(entry?.trashed_at);
  const actionBusy = busy || operationBusy;

  return <Dialog open fullScreen onClose={() => !actionBusy && onClose()} aria-labelledby="gallery-detail-title">
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 1, sm: 2 }, py: 0.75, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
      <Typography id="gallery-detail-title" variant="subtitle1" noWrap sx={{ flex: 1, minWidth: 0 }}>{title}</Typography>
      <IconButton size="small" aria-label={t('gallery.previous')} disabled={!onPrevious || actionBusy} onClick={onPrevious}><ChevronLeft /></IconButton>
      <IconButton size="small" aria-label={t('gallery.next')} disabled={!onNext || actionBusy} onClick={onNext}><ChevronRight /></IconButton>
      <IconButton aria-label={t('gallery.close')} disabled={actionBusy} onClick={onClose}><Close /></IconButton>
    </Stack>
    {loading ? <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box> : !entry ?
      <Alert severity="error" sx={{ m: 2 }}>{error}</Alert> :
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, overflow: 'hidden' }}>
        <Box sx={{ flex: { xs: '0 0 40dvh', md: '1 1 60%' }, minHeight: 0, minWidth: 0, bgcolor: '#101114', p: { xs: 0.5, md: 2 }, display: 'grid', placeItems: 'center' }}>
          {entry.url ? <Box component="img" src={entry.url} alt={title} sx={{ width: '100%', height: '100%', minHeight: 0, objectFit: 'contain' }} /> : <ImageOutlined sx={{ fontSize: 48, color: '#777' }} />}
        </Box>
        <Box sx={{ flex: { xs: 1, md: '0 0 40%' }, width: { md: 440 }, minWidth: { xs: 0, md: 340 }, minHeight: 0, display: 'flex', flexDirection: 'column', borderLeft: { md: 1 }, borderColor: 'divider' }}>
          <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1, p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
              {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
              {operationError && <Alert severity="error">{operationError}</Alert>}
              {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Typography variant="caption" color="text.secondary">{[entry.width && entry.height ? `${entry.width} × ${entry.height}` : '', entry.filename].filter(Boolean).join(' · ')}</Typography>
                {!trashed && <Tooltip title={t(editing ? 'gallery.cancelEdit' : 'gallery.editDetails')}><IconButton size="small" aria-label={t(editing ? 'gallery.cancelEdit' : 'gallery.editDetails')} disabled={busy} onClick={() => setEditing(!editing)}>{editing ? <Close fontSize="small" /> : <EditOutlined fontSize="small" />}</IconButton></Tooltip>}
              </Stack>
              {editing ? <>
                <TextField size="small" label={t('gallery.optionalTitle')} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} inputProps={{ maxLength: 200 }} />
                <TextField size="small" select label={t('gallery.group')} value={draft.group_id} onChange={(event) => setDraft({ ...draft, group_id: event.target.value })}>
                  <MenuItem value="">{t('gallery.ungrouped')}</MenuItem>
                  {groups.map((group) => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
                </TextField>
                {['style_prompt', 'prompt', 'negative_prompt'].map((field) => <TextField key={field} multiline minRows={field === 'prompt' ? 5 : 2} size="small"
                  label={t(`gallery.${field}`)} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />)}
                <Button variant="outlined" startIcon={<SaveOutlined />} disabled={busy} onClick={() => save(draft)}>{t(busy ? 'gallery.saving' : 'gallery.saveDetails')}</Button>
                <Typography variant="caption" color="text.secondary">{t('gallery.catalogEditHint')}</Typography>
              </> : <>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="subtitle2">{t('gallery.style_prompt')}</Typography>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Tooltip title={t('gallery.copyStyle')}><IconButton size="small" aria-label={t('gallery.copyStyle')} disabled={!entry.style_prompt} onClick={() => copy(entry.style_prompt)}><ContentCopy sx={{ fontSize: 17 }} /></IconButton></Tooltip>
                      <Button size="small" disabled={!entry.style_prompt || trashed} onClick={() => onApply(entry, 'style')}>{t('gallery.applyStyle')}</Button>
                    </Stack></Stack>
                  <Typography variant="body2" color={entry.style_prompt ? 'text.primary' : 'text.secondary'} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{entry.style_prompt || t('gallery.noStyle')}</Typography>
                </Box>
                <Divider />
                <Box>
                  <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="subtitle2">{t('gallery.prompt')}</Typography>
                    <Tooltip title={t('gallery.copyPrompt')}><IconButton size="small" aria-label={t('gallery.copyPrompt')} disabled={!entry.prompt} onClick={() => copy(entry.prompt)}><ContentCopy sx={{ fontSize: 17 }} /></IconButton></Tooltip></Stack>
                  <Typography ref={promptRef} tabIndex={0} variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.9, userSelect: 'text', mt: 0.5 }}>{entry.prompt || t('gallery.noPrompt')}</Typography>
                  {!trashed && <Box sx={{ mt: 1 }}>
                    <Button size="small" startIcon={<PaletteOutlined sx={{ fontSize: 17 }} />} disabled={!selectedText || busy} onClick={() => save({ style_prompt: selectedText })}>{t('gallery.saveSelectedStyle')}</Button>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{selectedText ? t('gallery.selectedText', { text: selectedText }) : t('gallery.selectStyleHint')}</Typography>
                  </Box>}
                </Box>
                {entry.negative_prompt && <Box><Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('gallery.negative_prompt')}</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{entry.negative_prompt}</Typography></Box>}
              </>}
              <Accordion disableGutters elevation={0}>
                <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2">{t('gallery.generationParameters')}</Typography></AccordionSummary>
                <AccordionDetails>
                  <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, m: 0, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, overflowWrap: 'anywhere' } }}>
                    {['model', 'seed', 'steps', 'guidanceScale', 'sampler', 'width', 'height'].filter((key) => parameters[key] !== undefined).map((key) => <React.Fragment key={key}><Typography component="dt" variant="body2">{t(`gallery.${key}`)}</Typography><Typography component="dd" variant="body2">{String(parameters[key])}</Typography></React.Fragment>)}
                  </Box>
                  <Box component="pre" sx={{ mt: 2, mb: 0, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'text.secondary' }}>{JSON.stringify(parameters, null, 2)}</Box>
                </AccordionDetails>
              </Accordion>
              {entry.metadata && Object.keys(entry.metadata).length > 0 && <Accordion disableGutters elevation={0}>
                <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2">{t('gallery.originalMetadata')}</Typography></AccordionSummary>
                <AccordionDetails><Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(entry.metadata, null, 2)}</Box></AccordionDetails>
              </Accordion>}
            </Stack>
          </Box>
          <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Stack direction="row" flexWrap="wrap" gap={0.75}>
              {trashed ? <Button size="small" disabled={actionBusy} startIcon={<RestoreFromTrashOutlined />} onClick={() => onRestore(entry)}>{t('gallery.restore')}</Button> : <>
                <Button size="small" variant="contained" disabled={!entry.prompt && !Object.keys(parameters).length} onClick={() => onApply(entry, 'parameters')}>{t('gallery.applyAll')}</Button>
                <Button size="small" variant="outlined" disabled={!entry.prompt && !entry.negative_prompt} onClick={() => onApply(entry, 'prompt')}>{t('gallery.applyPrompt')}</Button>
                <Tooltip title={t('gallery.editOrClearMetadata')}><IconButton size="small" aria-label={t('gallery.editOrClearMetadata')} onClick={() => onMetadata(entry)}><DescriptionOutlined fontSize="small" /></IconButton></Tooltip>
                <Tooltip title={t('gallery.trash')}><IconButton size="small" color="error" aria-label={t('gallery.trash')} onClick={() => onTrash(entry)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
              </>}
            </Stack>
          </Box>
        </Box>
      </Box>}
  </Dialog>;
}
