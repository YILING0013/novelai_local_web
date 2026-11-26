'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import { useI18n } from '@/i18n/I18nProvider';
import { tutorialImages } from '@/content/tutorialImages.mjs';
import {
  clearPreviewFileDrag,
  writePreviewFileDrag,
} from '@/components/ai-painting/tools/ImageTools/previewImageDragData.mjs';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';

/** 在教程内展示示例文件夹。鼠标和触屏把同一份 File 交给绘图组件的 drop 入口。 */
export default function TutorialFileManager({ onKeyboardPick }) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [files, setFiles] = useState([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ghost = useRef(null);
  const dragId = useRef(null);
  const touch = useRef(null);
  useEffect(() => {
    let active = true;
    Promise.all(
      tutorialImages.map(async ({ src }) => {
        const blob = await fetchUrlAsBlob(src);
        return new File([blob], src.split('/').at(-1), { type: blob.type });
      })
    )
      .then((result) => {
        if (active) setFiles(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      clearPreviewFileDrag(dragId.current);
    };
  }, [attempt]);

  function touchTarget(event) {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    return hit?.closest('[data-drop-zone], [data-tutorial-drop="display"]') ?? null;
  }
  function endTouch() {
    if (!touch.current) return;
    touch.current.target?.dispatchEvent(
      new DragEvent('dragleave', { bubbles: true, dataTransfer: touch.current.transfer })
    );
    clearPreviewFileDrag(dragId.current);
    touch.current = null;
    ghost.current.hidden = true;
  }
  return (
    <Paper
      component="section"
      aria-label={zh ? '文件管理器' : 'File manager'}
      data-tutorial-files=""
      variant="outlined"
      sx={{ gridArea: 'files', minWidth: 0, overflow: 'hidden', alignSelf: 'start', borderRadius: 1.5 }}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={0.75}
        sx={{ px: 1.25, py: 0.65, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}
      >
        <FolderOpenOutlined fontSize="small" color="primary" />
        <Typography variant="subtitle2">{zh ? '文件管理器' : 'File manager'}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {zh ? '下载 › 示例图' : 'Downloads › Sample images'}
        </Typography>
      </Stack>
      {failed ? (
        <Button
          onClick={() => {
            setFailed(false);
            setAttempt((v) => v + 1);
          }}
        >
          {zh ? '重新加载示例文件' : 'Reload sample files'}
        </Button>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', p: 0.5, gap: 0.5 }}>
          {tutorialImages.map(({ src }, index) => {
            const file = files[index];
            return (
              <Box
                key={src}
                component="button"
                type="button"
                draggable={Boolean(file)}
                disabled={!file}
                data-sample-src={src}
                data-tour={file ? ['sampleDisplay', 'sampleHistory'][index] : undefined}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  dragId.current = writePreviewFileDrag(event.dataTransfer, file);
                  event.dataTransfer.setDragImage(event.currentTarget.querySelector('img'), 18, 16);
                }}
                onDragEnd={() => clearPreviewFileDrag(dragId.current)}
                onKeyDown={(event) => {
                  if (['Enter', ' '].includes(event.key)) {
                    event.preventDefault();
                    onKeyboardPick(file);
                  }
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === 'mouse' || !event.isPrimary || !file) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const transfer = new DataTransfer();
                  dragId.current = writePreviewFileDrag(transfer, file);
                  touch.current = { transfer, target: null };
                  Object.assign(ghost.current.style, {
                    left: event.clientX + 8 + 'px',
                    top: event.clientY + 8 + 'px',
                  });
                  ghost.current.src = src;
                  ghost.current.hidden = false;
                }}
                onPointerMove={(event) => {
                  if (!touch.current) return;
                  const next = touchTarget(event);
                  const options = {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: touch.current.transfer,
                    clientX: event.clientX,
                    clientY: event.clientY,
                  };
                  if (touch.current.target !== next)
                    touch.current.target?.dispatchEvent(new DragEvent('dragleave', options));
                  touch.current.target = next;
                  next?.dispatchEvent(new DragEvent('dragover', options));
                  Object.assign(ghost.current.style, {
                    left: Math.min(innerWidth - 58, event.clientX + 8) + 'px',
                    top: Math.min(innerHeight - 48, event.clientY + 8) + 'px',
                  });
                }}
                onPointerUp={(event) => {
                  if (!touch.current) return;
                  touchTarget(event)?.dispatchEvent(
                    new DragEvent('drop', {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer: touch.current.transfer,
                    })
                  );
                  endTouch();
                }}
                onPointerCancel={endTouch}
                onLostPointerCapture={endTouch}
                sx={{
                  border: 0,
                  borderRadius: 1,
                  bgcolor: 'transparent',
                  color: 'text.primary',
                  p: 0.5,
                  minWidth: 0,
                  cursor: 'grab',
                  touchAction: 'none',
                  userSelect: 'none',
                  '&:hover,&:focus-visible': { bgcolor: 'action.selected' },
                  '&:active': { cursor: 'grabbing' },
                }}
              >
                <Box
                  component="img"
                  src={src}
                  alt=""
                  draggable={false}
                  sx={{ width: '100%', height: { xs: 43, sm: 62 }, objectFit: 'contain', display: 'block' }}
                />
                <Typography variant="caption" noWrap component="span">
                  {src.split('/').at(-1)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
      <Box
        component="img"
        hidden
        ref={ghost}
        alt=""
        sx={{
          position: 'fixed',
          zIndex: 1600,
          width: 50,
          height: 40,
          objectFit: 'contain',
          pointerEvents: 'none',
          border: 1,
          borderColor: 'primary.main',
          bgcolor: 'background.paper',
          borderRadius: 1,
        }}
      />
    </Paper>
  );
}
