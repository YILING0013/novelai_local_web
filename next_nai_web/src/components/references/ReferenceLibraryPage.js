"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { Add, Image as ImageIcon, Search } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import { extractImageMetadata } from '@/components/ai-painting/tools/ImageTools/ImageMetadataExtractor';
import { fileToDataUrl, hasUsableImageMetadata } from '@/components/ai-painting/utils/metadataUtils';
import ReferenceGallery from './ReferenceGallery';

const EMPTY_FORM = { title: '', prompt: '', files: [] };

/** 画师串和图片参考共用的本地增删改页面；kind 对应现有本地 API 集合。 */
export default function ReferenceLibraryPage({ kind }) {
  const { t } = useI18n();
  const isImageReference = kind === 'image-references';
  const title = t(isImageReference ? 'pages.imageReference' : 'pages.artistReference');
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiClient.getReferences(kind).then((records) => {
      if (active) setEntries(records);
    }).catch((requestError) => {
      if (active) setError(requestError.data?.error || requestError.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [kind]);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter((entry) => `${entry.title} ${entry.prompt}`.toLowerCase().includes(keyword));
  }, [entries, query]);

  const openForm = (entry = null) => {
    setEditing(entry);
    setForm(entry ? { title: entry.title, prompt: entry.prompt, files: [] } : EMPTY_FORM);
    setError('');
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { setError(t('references.titleRequired')); return; }
    setSaving(true);
    setError('');
    try {
      const body = { title: form.title.trim(), prompt: form.prompt.trim() };
      if (editing) {
        // 编辑提示词时同步已保存参数，避免应用参考后重新带回旧提示词。
        if (isImageReference && editing.parameters) {
          body.parameters = { ...editing.parameters, positivePrompt: body.prompt };
        }
        const updated = await apiClient.saveReference(kind, body, editing.id);
        setEntries((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      } else {
        body.images = await Promise.all(form.files.map(async (file) => ({
          data_url: await fileToDataUrl(file), original_name: file.name,
        })));
        // 一个参考条目共用一套参数，以第一张图片中的 NovelAI 元数据为准。
        if (isImageReference && form.files.length) {
          const metadata = await extractImageMetadata(form.files[0], body.images[0].data_url);
          if (hasUsableImageMetadata(metadata)) {
            body.prompt ||= metadata.positivePrompt || '';
            body.parameters = { ...metadata, positivePrompt: body.prompt };
          }
        }
        const created = await apiClient.saveReference(kind, body);
        setEntries((current) => [created, ...current]);
      }
      setFormOpen(false);
      setNotice(t('references.saved'));
    } catch (requestError) {
      setError(requestError.data?.error || requestError.message || t('references.saveFailed'));
    } finally { setSaving(false); }
  };

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      await apiClient.deleteReference(kind, deleteTarget.id);
      setEntries((current) => current.filter((entry) => entry.id !== deleteTarget.id));
      setDeleteTarget(null);
      setNotice(t('references.deleted'));
    } catch (requestError) { setError(requestError.data?.error || requestError.message); }
    finally { setSaving(false); }
  };

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); setNotice(t('references.copied')); }
    catch { setError(t('references.copyFailed')); }
  };

  const apply = (entry) => {
    if (isImageReference && entry.parameters) {
      const parameters = { ...entry.parameters, positivePrompt: entry.prompt };
      window.localStorage.setItem('novelai:pending-reference-parameters', JSON.stringify(parameters));
      window.dispatchEvent(new CustomEvent('novelai:reference-parameters', { detail: parameters }));
    } else if (entry.prompt.trim()) {
      window.localStorage.setItem('novelai:pending-artist-prompt', entry.prompt);
      window.dispatchEvent(new CustomEvent('novelai:artist-prompt', { detail: entry.prompt }));
    } else return;
    window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: 'ai-painting' }));
  };

  return <Box sx={{ height: '100%', overflow: 'auto', p: { xs: 0.5, md: 1 } }}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2} sx={{ mb: 2 }}>
      <Box><Typography variant="h5" fontWeight={700}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t('references.description')}</Typography></Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField value={query} onChange={(event) => setQuery(event.target.value)} size="small" placeholder={t('references.search')}
          inputProps={{ 'aria-label': t('references.search') }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
        <Button variant="contained" startIcon={<Add />} onClick={() => openForm()}>{t('references.create')}</Button>
      </Stack>
    </Stack>
    {error && !formOpen && !deleteTarget && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
    {loading ? <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 360 }}><CircularProgress /></Box> :
      <ReferenceGallery entries={visibleEntries} onEdit={openForm} onDelete={(entry) => { setError(''); setDeleteTarget(entry); }} onCopy={copy} onApply={apply} allowParameters={isImageReference} />}
    {!loading && !error && !visibleEntries.length && <Alert severity="info">{t('references.empty')}</Alert>}
    <Dialog open={formOpen} onClose={() => !saving && setFormOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>{t(editing ? 'references.edit' : 'references.create')} · {title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField autoFocus label={t('references.title')} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} inputProps={{ maxLength: 200 }} />
        <TextField label={t('references.prompt')} value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} multiline minRows={5} />
        {!editing && <>
          <Button variant="outlined" startIcon={<ImageIcon />} onClick={() => fileInputRef.current.click()}>{t('references.chooseImages')}</Button>
          <input ref={fileInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/bmp" multiple onChange={(event) => setForm({ ...form, files: Array.from(event.target.files) })} />
          {form.files.length > 0 && <Typography variant="caption">{t('references.selectedImages', { count: form.files.length })}</Typography>}
          {isImageReference && <Typography variant="caption" color="text.secondary">{t('references.metadataHint')}</Typography>}
        </>}
        {editing && <Alert severity="info">{t('references.keepImages', { count: editing.images.length })}</Alert>}
      </DialogContent>
      <DialogActions><Button onClick={() => setFormOpen(false)} disabled={saving}>{t('references.cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{t(saving ? 'references.saving' : 'references.save')}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(deleteTarget)} onClose={() => !saving && setDeleteTarget(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{t('references.deleteConfirm')}</DialogTitle>
      <DialogContent>{error && <Alert severity="error">{error}</Alert>}<Typography>{t('references.deleteBody', { title: deleteTarget?.title })}</Typography></DialogContent>
      <DialogActions><Button onClick={() => setDeleteTarget(null)} disabled={saving}>{t('references.cancel')}</Button>
        <Button color="error" variant="contained" onClick={remove} disabled={saving}>{t('references.delete')}</Button></DialogActions>
    </Dialog>
    <Snackbar open={Boolean(notice)} autoHideDuration={2600} onClose={() => setNotice('')} message={notice} />
  </Box>;
}
