"use client";

import { useEffect, useRef, useState } from 'react';
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Slider, Tooltip, Typography } from '@mui/material';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useI18n } from '@/i18n/I18nProvider';
import { fitPanelImage, panelBounds } from './comicDocument.mjs';
import messages from './comicMessages';

/** 让用户在分镜外的灰色遮罩下拖动、缩放原图，保存页面坐标下的构图。 */
export default function ComicCropDialog({ panel, onClose, onApply }) {
  const { locale } = useI18n();
  const c = messages[locale];
  const [image, setImage] = useState(panel.image);
  const [dragging, setDragging] = useState(false);
  const latestImage = useRef(panel.image);
  const svg = useRef(null);
  const drag = useRef(null);
  const animationFrame = useRef(null);
  useEffect(() => {
    latestImage.current = panel.image;
    setImage(panel.image);
    setDragging(false);
    const element = svg.current;
    return () => {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
      if (drag.current && element.hasPointerCapture(drag.current.pointerId)) element.releasePointerCapture(drag.current.pointerId);
      drag.current = null;
    };
  }, [panel.image]);
  const bounds = panelBounds(panel);
  const padding = Math.max(bounds.width, bounds.height) * 0.28;
  const view = { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
  const fit = fitPanelImage(panel, panel.image);
  const path = panel.points.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z';
  function finishDrag(event) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    setImage(latestImage.current);
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function zoom(value) {
    const current = latestImage.current;
    const scale = fit.scale * value;
    const ratio = scale / current.scale;
    const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
    latestImage.current = { ...current, scale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    setImage(latestImage.current);
  }
  return <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
    <DialogTitle>{c.cropTitle}</DialogTitle>
    <DialogContent>
      <Typography variant="caption" color="text.secondary">{c.cropTip}</Typography>
      <Box component="svg" ref={svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        aria-label={c.cropTitle} sx={{ width: '100%', height: 'min(58vh, 620px)', display: 'block', bgcolor: '#fafafa', backgroundImage: 'conic-gradient(#dedee3 25%, transparent 0 50%, #dedee3 0 75%, transparent 0)', backgroundSize: '20px 20px', touchAction: 'none', userSelect: 'none', cursor: dragging ? 'grabbing' : 'grab', mt: 1 }}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          // 原生图片拖放或文字选择会中断 pointer 流，导致拖过一次后无法继续移动。
          event.preventDefault();
          const matrix = event.currentTarget.getScreenCTM().inverse();
          drag.current = { pointerId: event.pointerId, matrix, point: new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix), image: latestImage.current };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(current.matrix);
          latestImage.current = { ...current.image, x: current.image.x + p.x - current.point.x, y: current.image.y + p.y - current.point.y };
          // 合并同一帧中的移动事件，并复用按下时的坐标变换，避免反复读取布局。
          if (animationFrame.current === null) animationFrame.current = requestAnimationFrame(() => {
            animationFrame.current = null;
            setImage(latestImage.current);
          });
        }}
        onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
        <image href={image.dataUrl} x={image.x} y={image.y} width={image.width * image.scale} height={image.height * image.scale} pointerEvents="none" />
        <path d={`M ${view.x} ${view.y} h ${view.width} v ${view.height} h ${-view.width} Z ${path}`} fill="#353545" fillOpacity="0.58" fillRule="evenodd" pointerEvents="none" />
        <path d={path} fill="none" stroke="#111" strokeWidth={Math.max(2, bounds.width / 250)} pointerEvents="none" />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
        <Typography variant="body2">{c.zoom}</Typography>
        <Slider aria-label={c.zoom} value={image.scale / fit.scale} min={0.2} max={5} step={0.01} onChange={(_, value) => zoom(value)} />
        <Tooltip title={c.center}><IconButton aria-label={c.center} onClick={() => { latestImage.current = fit; setImage(fit); }} sx={{ width: 44, height: 44, flexShrink: 0 }}><CenterFocusStrongOutlinedIcon /></IconButton></Tooltip>
      </Box>
    </DialogContent>
    <DialogActions>
      <Tooltip title={c.cancel}><IconButton aria-label={c.cancel} onClick={onClose} sx={{ width: 44, height: 44 }}><CloseIcon /></IconButton></Tooltip>
      <Tooltip title={c.apply}><IconButton aria-label={c.apply} onClick={() => onApply(latestImage.current)} sx={{ width: 44, height: 44, bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}><CheckIcon /></IconButton></Tooltip>
    </DialogActions>
  </Dialog>;
}
