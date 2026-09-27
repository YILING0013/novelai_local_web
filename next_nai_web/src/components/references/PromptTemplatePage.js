"use client";

import React, { useEffect, useState } from 'react';
import { Add, ArrowDownward, ArrowUpward, Delete, Edit, PlayArrow } from '@mui/icons-material';
import { Alert, Box, Button, Card, CardContent, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

const STORAGE_KEY = 'novelai:prompt-templates';
const emptySegment = () => ({ id: crypto.randomUUID(), label: '', text: '', enabled: true });

/** 编辑本浏览器保存的提示词片段，并将组合结果应用到绘画。 */
export default function PromptTemplatePage() {
  const { t } = useI18n();
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ title: '', segments: [] });
  const [notice, setNotice] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(stored) || stored.some((item) => !item || typeof item.title !== 'string' || !Array.isArray(item.segments)
        || item.segments.some((part) => !part || typeof part.text !== 'string' || typeof part.label !== 'string'))) {
        throw new Error('INVALID_TEMPLATES');
      }
      setTemplates(stored);
      setLoaded(true);
    } catch { setStorageError(true); }
  }, []);

  const persist = (next) => {
    try {
      // 先写存储再更新界面，磁盘配额或权限错误时保留原来的模板。
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setTemplates(next);
      setStorageError(false);
      return true;
    } catch { setStorageError(true); return false; }
  };

  const openForm = (template = null) => {
    setEditing(template?.id || null);
    setDraft(template ? structuredClone(template) : { title: '', segments: [emptySegment()] });
    setNotice('');
    setFormOpen(true);
  };

  const save = () => {
    if (!draft.title.trim()) { setNotice(t('references.titleMissing')); return; }
    const value = {
      ...draft, id: editing || crypto.randomUUID(), title: draft.title.trim(),
      segments: draft.segments.filter((part) => part.label.trim() || part.text.trim()),
    };
    if (persist(editing ? templates.map((item) => item.id === editing ? value : item) : [value, ...templates])) {
      setFormOpen(false);
      setNotice(t('references.templateSaved'));
    }
  };

  const updatePart = (partId, changes) => setDraft((current) => ({
    ...current, segments: current.segments.map((part) => part.id === partId ? { ...part, ...changes } : part),
  }));
  const movePart = (index, delta) => setDraft((current) => {
    const segments = [...current.segments];
    [segments[index], segments[index + delta]] = [segments[index + delta], segments[index]];
    return { ...current, segments };
  });
  const compiled = draft.segments.filter((part) => part.enabled && part.text.trim()).map((part) => part.text.trim()).join(', ');
  const apply = (template) => {
    const prompt = template.segments.filter((part) => part.enabled && part.text.trim()).map((part) => part.text.trim()).join(', ');
    if (!prompt) { setNotice(t('references.emptyTemplate')); return; }
    localStorage.setItem('novelai:pending-positive-prompt', prompt);
    window.dispatchEvent(new CustomEvent('novelai:set-positive-prompt', { detail: prompt }));
    window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: 'ai-painting' }));
  };

  return <Box sx={{ height: '100%', overflow: 'auto', p: { xs: 0.5, md: 1 } }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} sx={{ mb: 2 }}>
      <Box><Typography variant="h5" fontWeight={700}>{t('references.templates')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('references.templateDescription')}</Typography></Box>
      <Button variant="contained" startIcon={<Add />} onClick={() => openForm()} disabled={!loaded}>{t('references.newTemplate')}</Button>
    </Stack>
    {storageError && <Alert severity="error" sx={{ mb: 2 }}>{t('references.storageError')}</Alert>}
    {notice && !formOpen && <Alert severity="info" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 1.5 }}>
      {templates.map((template) => <Card key={template.id} variant="outlined"><CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{template.title}</Typography>
          <Box sx={{ display: 'flex' }}>
            <Tooltip title={t('references.edit')}><IconButton aria-label={t('references.edit')} onClick={() => openForm(template)}><Edit /></IconButton></Tooltip>
            <Tooltip title={t('references.delete')}><IconButton aria-label={t('references.delete')} color="error" onClick={() => setDeleteTarget(template)}><Delete /></IconButton></Tooltip>
          </Box>
        </Stack>
        <Stack spacing={0.6} sx={{ my: 1.5 }}>{template.segments.map((part) =>
          <Stack key={part.id} direction="row" spacing={1} sx={{ opacity: part.enabled ? 1 : 0.45 }}>
            <Checkbox checked={part.enabled} disabled size="small" />
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}><b>{part.label || t('references.unnamed')}: </b>{part.text || t('references.emptyText')}</Typography>
          </Stack>)}</Stack>
        <Button variant="contained" startIcon={<PlayArrow />} onClick={() => apply(template)}>{t('references.apply')}</Button>
      </CardContent></Card>)}
    </Box>
    {loaded && !templates.length && <Alert severity="info">{t('references.templateEmpty')}</Alert>}
    <Dialog open={formOpen} onClose={() => setFormOpen(false)} fullWidth maxWidth="md">
      <DialogTitle>{t(editing ? 'references.editTemplate' : 'references.newTemplate')}</DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        {storageError && <Alert severity="error" sx={{ mb: 2 }}>{t('references.storageError')}</Alert>}
        {notice && <Alert severity="info" sx={{ mb: 2 }}>{notice}</Alert>}
        <TextField autoFocus fullWidth label={t('references.templateTitle')} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} sx={{ mb: 2 }} />
        <Stack spacing={1.5}>{draft.segments.map((part, index) => <Card key={part.id} variant="outlined"><CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="flex-start">
            <FormControlLabel control={<Checkbox checked={part.enabled} onChange={(event) => updatePart(part.id, { enabled: event.target.checked })} />} label={t('references.enabled')} />
            <TextField label={t('references.segmentName')} value={part.label} onChange={(event) => updatePart(part.id, { label: event.target.value })} sx={{ width: { xs: '100%', md: 180 }, flexShrink: 0 }} />
            <TextField label={t('references.segmentText')} value={part.text} onChange={(event) => updatePart(part.id, { text: event.target.value })} multiline minRows={2} fullWidth />
            <Stack direction="row">
              <IconButton aria-label={t('references.moveUp')} disabled={!index} onClick={() => movePart(index, -1)}><ArrowUpward /></IconButton>
              <IconButton aria-label={t('references.moveDown')} disabled={index === draft.segments.length - 1} onClick={() => movePart(index, 1)}><ArrowDownward /></IconButton>
              <IconButton aria-label={t('references.deleteSegment')} color="error" onClick={() => setDraft({ ...draft, segments: draft.segments.filter((item) => item.id !== part.id) })}><Delete /></IconButton>
            </Stack>
          </Stack>
        </CardContent></Card>)}</Stack>
        <Button startIcon={<Add />} onClick={() => setDraft({ ...draft, segments: [...draft.segments, emptySegment()] })} sx={{ mt: 1 }}>{t('references.addSegment')}</Button>
        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 2, overflowWrap: 'anywhere' }}>{t('references.preview', { text: compiled || t('references.noEnabled') })}</Typography>
      </DialogContent>
      <DialogActions><Button onClick={() => setFormOpen(false)}>{t('references.cancel')}</Button><Button variant="contained" onClick={save}>{t('references.save')}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{t('references.templateDelete')}</DialogTitle>
      <DialogContent><Typography sx={{ overflowWrap: 'anywhere' }}>{deleteTarget?.title}</Typography></DialogContent>
      <DialogActions><Button onClick={() => setDeleteTarget(null)}>{t('references.cancel')}</Button>
        <Button color="error" onClick={() => { if (persist(templates.filter((item) => item.id !== deleteTarget.id))) setDeleteTarget(null); }}>{t('references.delete')}</Button></DialogActions>
    </Dialog>
  </Box>;
}
