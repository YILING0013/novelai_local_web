"use client";

import React, { useMemo, useState } from 'react';
import { Add, ArrowDownward, ArrowUpward, Delete, Edit, PlayArrow } from '@mui/icons-material';
import { Alert, Box, Button, Card, CardContent, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';

const STORAGE_KEY = 'novelai:prompt-templates';
const PENDING_KEY = 'novelai:pending-positive-prompt';
const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const emptySegment = () => ({ id: id(), label: '', text: '', enabled: true });
const readTemplates = () => {
  try { const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
};

export default function PromptTemplatePage() {
  const [templates, setTemplates] = useState(readTemplates);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ title: '', segments: [emptySegment()] });
  const [notice, setNotice] = useState('');
  const persist = (next) => { setTemplates(next); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); };
  const openNew = () => { setEditing(null); setDraft({ title: '', segments: [emptySegment()] }); setFormOpen(true); };
  const openEdit = (template) => { setEditing(template.id); setDraft(structuredClone(template)); setFormOpen(true); };
  const close = () => { setFormOpen(false); setEditing(null); setDraft({ title: '', segments: [emptySegment()] }); };
  const save = () => {
    if (!draft.title.trim()) return setNotice('请填写模板名称。');
    const value = { ...draft, id: editing || id(), title: draft.title.trim(), segments: draft.segments.filter((part) => part.label.trim() || part.text.trim()) };
    persist(editing ? templates.map((item) => item.id === editing ? value : item) : [value, ...templates]);
    close(); setNotice('提示词模板已保存。');
  };
  const updatePart = (partId, changes) => setDraft((current) => ({ ...current, segments: current.segments.map((part) => part.id === partId ? { ...part, ...changes } : part) }));
  const movePart = (index, delta) => setDraft((current) => { const parts = [...current.segments]; const target = index + delta; if (target < 0 || target >= parts.length) return current; [parts[index], parts[target]] = [parts[target], parts[index]]; return { ...current, segments: parts }; });
  const compiled = useMemo(() => draft.segments.filter((part) => part.enabled && part.text.trim()).map((part) => part.text.trim()).join(', '), [draft.segments]);
  const apply = (template) => {
    const prompt = template.segments.filter((part) => part.enabled && part.text.trim()).map((part) => part.text.trim()).join(', ');
    if (!prompt) return setNotice('这个模板还没有启用的提示词片段。');
    window.localStorage.setItem(PENDING_KEY, prompt);
    window.dispatchEvent(new CustomEvent('novelai:set-positive-prompt', { detail: prompt }));
    window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: 'ai-painting' }));
  };

  return <Box sx={{ height: '100%', overflow: 'auto', p: { xs: .5, md: 1 } }}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
      <Box><Typography variant="h5" fontWeight={700}>提示词模板</Typography><Typography variant="body2" color="text.secondary">把一条提示词拆成多个可开关、可排序的片段，再组合应用到绘画。</Typography></Box>
      <Button variant="contained" startIcon={<Add />} onClick={openNew}>新建模板</Button>
    </Stack>
    {notice && <Alert severity="info" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 1.5 }}>
      {templates.map((template) => <Card key={template.id} variant="outlined"><CardContent>
        <Stack direction="row" justifyContent="space-between"><Typography variant="h6">{template.title}</Typography><Box><Tooltip title="编辑"><IconButton onClick={() => openEdit(template)}><Edit /></IconButton></Tooltip><Tooltip title="删除"><IconButton color="error" onClick={() => persist(templates.filter((item) => item.id !== template.id))}><Delete /></IconButton></Tooltip></Box></Stack>
        <Stack spacing={.6} sx={{ my: 1.5 }}>{template.segments.map((part) => <Stack key={part.id} direction="row" spacing={1} sx={{ opacity: part.enabled ? 1 : .45 }}><Checkbox checked={part.enabled} disabled size="small" /><Typography variant="body2"><b>{part.label || '未命名片段'}：</b>{part.text || '空'}</Typography></Stack>)}</Stack>
        <Button variant="contained" startIcon={<PlayArrow />} onClick={() => apply(template)}>应用到绘画</Button>
      </CardContent></Card>)}
    </Box>
    {!templates.length && <Alert severity="info">还没有提示词模板，点击“新建模板”开始拆分。</Alert>}

    <Dialog open={formOpen} onClose={close} fullWidth maxWidth="md">
      <DialogTitle>{editing ? '编辑提示词模板' : '新建提示词模板'}</DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}><TextField fullWidth label="模板名称" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} sx={{ mb: 2 }} />
        <Stack spacing={1.5}>{draft.segments.map((part, index) => <Card key={part.id} variant="outlined"><CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start"><FormControlLabel control={<Checkbox checked={part.enabled} onChange={(e) => updatePart(part.id, { enabled: e.target.checked })} />} label="启用" /><TextField label="片段名称" value={part.label} onChange={(e) => updatePart(part.id, { label: e.target.value })} sx={{ width: { sm: 180 } }} /><TextField label="提示词内容" value={part.text} onChange={(e) => updatePart(part.id, { text: e.target.value })} multiline minRows={2} fullWidth /><Stack direction="row"><IconButton disabled={!index} onClick={() => movePart(index, -1)}><ArrowUpward /></IconButton><IconButton disabled={index === draft.segments.length - 1} onClick={() => movePart(index, 1)}><ArrowDownward /></IconButton><IconButton color="error" onClick={() => setDraft({ ...draft, segments: draft.segments.filter((item) => item.id !== part.id) })}><Delete /></IconButton></Stack></Stack>
        </CardContent></Card>)}</Stack>
        <Button startIcon={<Add />} onClick={() => setDraft({ ...draft, segments: [...draft.segments, emptySegment()] })} sx={{ mt: 1 }}>添加片段</Button>
        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 2 }}>组合预览：{compiled || '暂无启用内容'}</Typography>
      </DialogContent><DialogActions><Button onClick={close}>取消</Button><Button variant="contained" onClick={save}>保存</Button></DialogActions>
    </Dialog>
  </Box>;
}
