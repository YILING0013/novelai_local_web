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
 * 根据隐私设置用长按、悬停或点击切换同一容器里的图片。
 * @param {object} props mode 为查看方式，imageDrag 为可用的长按拖拽。
 * @returns {React.ReactElement} 位于图片上方的遮挡控件。
 */
export default function ImagePrivacyCover({ mode = 'hold', imageDrag = null, onReveal }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const timer = useRef(null);
  const revealCallback = useRef(onReveal);
  revealCallback.current = onReveal;
  useEffect(() => { if (revealed) revealCallback.current?.(); }, [revealed]);
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
    setRevealed(false);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [mode]);

  return <Box
    component="button"
    className="image-privacy-cover"
    type="button"
    aria-label={t(`painting.workspace.gallery.${{ hold: 'privacyHold', hover: 'privacyHover', toggle: 'privacyToggle' }[mode]}`)}
    aria-pressed={mode === 'toggle' ? revealed : undefined}
    data-privacy-revealed={revealed}
    draggable={Boolean(imageDrag)}
    data-preview-image-drag={imageDrag ? (imageDrag.armedMode ? 'ready' : 'idle') : undefined}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      didReveal.current = false;
      imageDrag?.onPointerDown(event, imageDrag.mode);
      if (mode === 'hold') {
        if (!imageDrag || event.pointerType === 'touch') event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }
      if (mode === 'hover' && event.pointerType === 'touch') setRevealed(true);
    }}
    onPointerEnter={() => { if (mode === 'hover') setRevealed(true); }}
    onPointerLeave={() => { if (mode !== 'toggle') stop(); }}
    onDragStart={imageDrag ? (event) => {
      imageDrag.onDragStart(event, imageDrag.mode);
      stop();
    } : undefined}
    onDragEnd={imageDrag?.onDragEnd}
    onPointerUp={(event) => {
      if (mode === 'hold' || (mode === 'hover' && event.pointerType === 'touch')) stop();
    }}
    onPointerCancel={stop}
    onLostPointerCapture={mode === 'toggle' ? undefined : stop}
    onKeyDown={(event) => {
      if (mode === 'hold' && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        if (!event.repeat) start();
      }
    }}
    onKeyUp={() => { if (mode === 'hold') stop(); }}
    onFocus={(event) => { if (mode === 'hover' && event.currentTarget.matches(':focus-visible')) setRevealed(true); }}
    onBlur={() => { if (mode !== 'toggle') stop(); }}
    onClick={(event) => {
      if (mode === 'toggle' || didReveal.current) event.stopPropagation();
      if (mode === 'toggle') setRevealed((value) => !value);
    }}
    onContextMenu={(event) => event.preventDefault()}
    sx={{
      position: 'absolute', inset: 0, zIndex: 1, border: 0, bgcolor: 'transparent',
      width: '100%', height: '100%', p: 0, cursor: revealed ? 'grabbing' : 'pointer',
      touchAction: 'pan-x pan-y', userSelect: 'none',
      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
    }}
  />;
}
