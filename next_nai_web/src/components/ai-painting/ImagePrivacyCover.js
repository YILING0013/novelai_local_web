"use client";

import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

export const imagePrivacySx = {
  '&:has(> [data-privacy-revealed="false"]) > [data-private-image]': {
    filter: 'blur(clamp(15px, 5vw, 52px))',
    opacity: 0.5,
  },
};

/**
 * 按住后暂时显示同一容器里的图片，松手或窗口失焦立即重新遮盖。
 * @param {object} props imageDrag 为支持从预览拖出文件时的长按事件。
 * @returns {React.ReactElement} 位于图片上方的长按控件。
 */
export default function ImagePrivacyCover({ imageDrag = null }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const timer = useRef(null);
  const didReveal = useRef(false);

  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = null;
    setRevealed(false);
  };
  const start = () => {
    if (timer.current !== null) return;
    didReveal.current = false;
    timer.current = window.setTimeout(() => {
      didReveal.current = true;
      setRevealed(true);
    }, 350);
  };

  useEffect(() => {
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, []);

  return <Box
    component="button"
    className="image-privacy-cover"
    type="button"
    aria-label={t('painting.workspace.gallery.privacyHold')}
    data-privacy-revealed={revealed}
    draggable={Boolean(imageDrag)}
    data-preview-image-drag={imageDrag ? (imageDrag.armedMode ? 'ready' : 'idle') : undefined}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      if (imageDrag && event.pointerType !== 'touch') imageDrag.onPointerDown(event, imageDrag.mode);
      else event.currentTarget.setPointerCapture(event.pointerId);
      start();
    }}
    onPointerLeave={imageDrag ? stop : undefined}
    onDragStart={imageDrag ? (event) => {
      imageDrag.onDragStart(event, imageDrag.mode);
      stop();
    } : undefined}
    onDragEnd={imageDrag?.onDragEnd}
    onPointerUp={stop}
    onPointerCancel={stop}
    onLostPointerCapture={stop}
    onKeyDown={(event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) start();
      }
    }}
    onKeyUp={stop}
    onBlur={stop}
    onClick={(event) => { if (didReveal.current) event.stopPropagation(); }}
    onContextMenu={(event) => event.preventDefault()}
    sx={{
      position: 'absolute', inset: 0, zIndex: 1, border: 0, bgcolor: 'transparent',
      width: '100%', height: '100%', p: 0, cursor: revealed ? 'grabbing' : 'pointer',
      touchAction: 'pan-x pan-y', userSelect: 'none',
      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
    }}
  />;
}
