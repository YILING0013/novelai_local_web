"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment,
  Snackbar, Stack, TextField, Typography,
} from '@mui/material';
import { Add, Image as ImageIcon, Search } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import ReferenceGallery from './ReferenceGallery';

const PENDING_ARTIST_KEY = 'novelai:pending-artist-prompt';
const EMPTY_FORM = { title: '', prompt: '', files: [] };

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ data_url: reader.result, original_name: file.name });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ArtistReferencePage() {
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

  const loadEntries = async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await apiClient.getArtistThreads());
    } catch (requestError) {
      setError(requestError?.data?.message || '画师串数据加载失败，请刷新后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadEntries(); }, []);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return keyword
      ? entries.filter((entry) => `${entry.title} ${entry.prompt}`.toLowerCase().includes(keyword))
      : entries;
  }, [entries, query]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (entry) => {
    setEditing(entry);
    setForm({ title: entry.title, prompt: entry.prompt, files: [] });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) {
      setError('请输入画师串标题。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing) {
        const updated = await apiClient.updateArtistThread(editing.id, {
          title: form.title.trim(), prompt: form.prompt.trim(),
        });
        setEntries((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
        setNotice('画师串已更新。');
      } else {
        const images = await Promise.all(form.files.map(fileToDataUrl));
        const created = await apiClient.createArtistThread({
          title: form.title.trim(), prompt: form.prompt.trim(), images,
        });
        setEntries((current) => [created, ...current]);
        setNotice('画师串已新增。');
      }
      setFormOpen(false);
      setForm(EMPTY_FORM);
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.data?.error || '保存画师串失败。');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await apiClient.deleteArtistThread(deleteTarget.id);
      setEntries((current) => current.filter((entry) => entry.id !== deleteTarget.id));
      setDeleteTarget(null);
      setNotice('画师串已删除。');
    } catch (requestError) {
      setError(requestError?.data?.message || '删除画师串失败。');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); }
    catch { setError('复制失败，请在详情中选中提示词手动复制。'); return; }
    setNotice('画师串已复制。');
  };

  const apply = (value) => {
    if (!value.trim()) return;
    window.localStorage.setItem(PENDING_ARTIST_KEY, value);
    window.dispatchEvent(new CustomEvent('novelai:artist-prompt', { detail: value }));
    window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: 'ai-painting' }));
    setNotice('画师串已添加到 AI 绘画正面提示词。');
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: { xs: 0.5, md: 1 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>画师串参考</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            浏览参考作品，点击图片查看大图与画师串。
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField value={query} onChange={(event) => setQuery(event.target.value)} size="small" placeholder="搜索标题或提示词"
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
          <Button variant="contained" startIcon={<Add />} onClick={openCreate}>新增画师串</Button>
        </Stack>
      </Stack>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 360 }}><CircularProgress /></Box> : (
        <ReferenceGallery entries={visibleEntries} onEdit={openEdit} onDelete={setDeleteTarget}
          onCopy={copy} onApply={(entry) => apply(entry.prompt)} allowParameters={false} />
      )}
      {!loading && !error && visibleEntries.length === 0 && <Alert severity="info">没有找到匹配的画师串。</Alert>}

      <Dialog open={formOpen} onClose={() => !saving && setFormOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? '编辑画师串' : '新增画师串'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField autoFocus label="标题" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} inputProps={{ maxLength: 200 }} />
          <TextField label="画师串 / 提示词" value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} multiline minRows={5} />
          {!editing && <>
            <Button variant="outlined" startIcon={<ImageIcon />} onClick={() => fileInputRef.current?.click()}>
              选择参考图（可多选）
            </Button>
            <input ref={fileInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/bmp" multiple
              onChange={(event) => setForm({ ...form, files: Array.from(event.target.files || []) })} />
            {form.files.length > 0 && <Typography variant="caption" color="text.secondary">已选择 {form.files.length} 张图片</Typography>}
          </>}
          {editing && <Alert severity="info">编辑会保留现有的 {editing.images?.length || 0} 张参考图。</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} disabled={saving}>取消</Button>
          <Button variant="contained" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => !saving && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除画师串？</DialogTitle>
        <DialogContent><Typography>“{deleteTarget?.title}”及其本地参考图将被删除。</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={saving}>取消</Button>
          <Button color="error" variant="contained" onClick={remove} disabled={saving}>确认删除</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={2600} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
