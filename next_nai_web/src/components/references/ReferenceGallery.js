"use client";

import React, { useState } from 'react';
import { Box, Button, ButtonBase, Dialog, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, Close, ContentCopy, Delete, Edit, Image as ImageIcon } from '@mui/icons-material';

export default function ReferenceGallery({ entries, onEdit, onDelete, onCopy, onApply, allowParameters = false }) {
  const [selection, setSelection] = useState(null);
  // Resolve from current records so edits and deletions never leave stale details.
  const entry = entries.find((item) => item.id === selection?.entryId);
  const images = entry?.images || [];
  const imageIndex = Math.min(selection?.imageIndex || 0, Math.max(0, images.length - 1));
  const image = images[imageIndex];
  const close = () => setSelection(null);
  const selectImage = (index) => setSelection({ entryId: entry.id, imageIndex: index });
  const act = (callback) => { close(); callback(entry); };

  return <>
    <Box aria-label="参考图片瀑布流" sx={{ columns: { xs: 2, sm: 3, lg: 4, xl: 5 }, columnGap: 1.5 }}>
      {entries.flatMap((item) => (item.images?.length ? item.images : [null]).map((picture, index) => (
        <ButtonBase key={`${item.id}-${picture?.id || index}`} aria-label={`查看 ${item.title} 第 ${index + 1} 张图片`}
          onClick={() => setSelection({ entryId: item.id, imageIndex: index })}
          sx={{ display: 'block', width: '100%', mb: 1.5, breakInside: 'avoid', borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover',
            transition: 'box-shadow .2s', '&:hover': { boxShadow: 5 }, '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.main' } }}>
          {picture ? <Box component="img" src={picture.url} alt={item.title} loading="lazy"
            sx={{ display: 'block', width: '100%', height: 'auto' }} /> :
            <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 200, p: 2 }}>
              <ImageIcon color="disabled" /><Typography variant="body2">{item.title}</Typography><Typography variant="caption">暂无图片，点击查看</Typography>
            </Stack>}
        </ButtonBase>
      )))}
    </Box>

    <Dialog open={Boolean(entry)} onClose={close} maxWidth="lg" fullWidth aria-labelledby="reference-detail-title"
      PaperProps={{ sx: { borderRadius: { xs: 2, md: 3 }, m: { xs: 1, sm: 3 }, width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' }, maxHeight: '92dvh', overflow: 'hidden' } }}>
      {entry && <Box sx={{ display: { xs: 'block', md: 'flex' }, height: { md: 'min(820px, 88dvh)' }, minHeight: 0, overflowY: { xs: 'auto', md: 'hidden' } }}>
        <Box sx={{ flex: { md: '1 1 65%' }, minWidth: 0, minHeight: { xs: 240, md: 0 }, position: 'relative', bgcolor: '#111', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 0, md: 2 } }}>
            {image ? <Box component="img" src={image.url} alt={`${entry.title} 第 ${imageIndex + 1} 张`}
              sx={{ display: 'block', width: '100%', height: { xs: 'auto', md: '100%' }, maxHeight: { xs: '58dvh', md: '100%' }, objectFit: 'contain' }} /> : <ImageIcon sx={{ color: '#aaa', fontSize: 64 }} />}
          </Box>
          {images.length > 1 && <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ p: 1, bgcolor: '#191919' }}>
            <IconButton aria-label="上一张图片" disabled={imageIndex === 0} onClick={() => selectImage(imageIndex - 1)} sx={{ color: '#fff', '&.Mui-disabled': { color: '#555' } }}><ChevronLeft /></IconButton>
            <Typography sx={{ color: '#fff' }} variant="body2">{imageIndex + 1} / {images.length}</Typography>
            <IconButton aria-label="下一张图片" disabled={imageIndex === images.length - 1} onClick={() => selectImage(imageIndex + 1)} sx={{ color: '#fff', '&.Mui-disabled': { color: '#555' } }}><ChevronRight /></IconButton>
          </Stack>}
        </Box>
        <Stack sx={{ width: { xs: '100%', md: 360 }, flexShrink: 0, minHeight: 0, bgcolor: 'background.paper' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography id="reference-detail-title" variant="h6" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{entry.title}</Typography>
            <IconButton aria-label="关闭图片详情" onClick={close}><Close /></IconButton>
          </Stack>
          <Box sx={{ p: 2.5, flex: 1, overflowY: { md: 'auto' }, minHeight: 120 }}>
            <Typography variant="overline" color="text.secondary">提示词</Typography>
            <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.9, userSelect: 'text' }}>{entry.prompt || '还没有填写提示词'}</Typography>
          </Box>
          <Stack spacing={1.5} sx={{ p: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between">
              <Button startIcon={<ContentCopy />} disabled={!entry.prompt} onClick={() => onCopy(entry.prompt)}>复制提示词</Button>
              <Box><Tooltip title="编辑"><IconButton aria-label={`编辑 ${entry.title}`} onClick={() => act(onEdit)}><Edit /></IconButton></Tooltip>
                <Tooltip title="删除"><IconButton color="error" aria-label={`删除 ${entry.title}`} onClick={() => act(onDelete)}><Delete /></IconButton></Tooltip></Box>
            </Stack>
            <Button variant="contained" fullWidth disabled={!entry.prompt && !(allowParameters && entry.parameters)} onClick={() => act(onApply)}>应用到绘画</Button>
          </Stack>
        </Stack>
      </Box>}
    </Dialog>
  </>;
}
