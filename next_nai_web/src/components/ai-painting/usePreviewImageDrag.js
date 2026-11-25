"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { clearPreviewFileDrag, writePreviewFileDrag } from './tools/ImageTools/previewImageDragData.mjs';

async function createDragPreview(file, privacyMode) {
  const bitmap = await createImageBitmap(file);
  try {
    const padding = 5;
    const scale = Math.min(1, 144 / bitmap.width, 112 / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width + padding * 2;
    canvas.height = height + padding * 2;
    const context = canvas.getContext('2d');
    context.beginPath();
    context.roundRect(0.5, 0.5, canvas.width - 1, canvas.height - 1, 8);
    context.fillStyle = '#232833';
    context.fill();
    context.strokeStyle = '#768397';
    context.stroke();
    context.beginPath();
    context.roundRect(padding, padding, width, height, 4);
    context.clip();
    context.imageSmoothingQuality = 'high';
    if (privacyMode) {
      // 先降采样，再模糊放大，避免拖拽预览在隐私模式下显示细节。
      const reduced = document.createElement('canvas');
      reduced.width = 6;
      reduced.height = 6;
      reduced.getContext('2d').drawImage(bitmap, 0, 0, 6, 6);
      context.filter = 'blur(12px)';
      context.drawImage(reduced, padding, padding, width, height);
    } else {
      context.drawImage(bitmap, padding, padding, width, height);
    }
    const thumbnail = new Image();
    thumbnail.src = canvas.toDataURL('image/png');
    await thumbnail.decode();
    return thumbnail;
  } finally {
    bitmap.close();
  }
}

/**
 * 让预览图、历史缩略图和复制按钮共用长按拖拽、缩略图与文件交接。
 * @param {object} options enabled 控制能否拖动，getFile 准备文件，privacyMode 控制缩略图，onError 接收错误。
 * @returns {object} 长按和拖拽事件、就绪模式与点击抑制状态。
 */
export default function usePreviewImageDrag({ enabled, getFile, privacyMode, onError }) {
  const press = useRef(null);
  const [armed, setArmed] = useState(null);
  const releasePress = useCallback(() => {
    const current = press.current;
    if (!current?.active || current.dragging) return;
    window.clearTimeout(current.timer);
    current.active = false;
    setArmed(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setArmed(null);
      return undefined;
    }
    const cancelOnMove = (event) => {
      const current = press.current;
      if (current?.active && !current.held && event.pointerId === current.pointerId
        && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 7) releasePress();
    };
    window.addEventListener('pointermove', cancelOnMove);
    window.addEventListener('pointerup', releasePress);
    window.addEventListener('pointercancel', releasePress);
    window.addEventListener('blur', releasePress);
    return () => {
      const current = press.current;
      if (current) {
        window.clearTimeout(current.timer);
        clearPreviewFileDrag(current.id);
        if (current.url) window.setTimeout(() => URL.revokeObjectURL(current.url), 60_000);
        press.current = null;
        current.active = false;
      }
      window.removeEventListener('pointermove', cancelOnMove);
      window.removeEventListener('pointerup', releasePress);
      window.removeEventListener('pointercancel', releasePress);
      window.removeEventListener('blur', releasePress);
    };
  }, [enabled, releasePress]);

  const fromSource = (source) => {
    const previous = press.current?.source;
    return previous === source || Boolean(previous && source && previous.id === source.id && previous.src === source.src);
  };
  const onPointerDown = (event, mode, source) => {
    if (!enabled || event.button !== 0 || !event.isPrimary || press.current?.dragging) return;
    releasePress();
    const current = {
      mode, source, getFile, privacyMode, active: true, held: false, dragging: false,
      x: event.clientX, y: event.clientY, pointerId: event.pointerId,
    };
    press.current = current;
    const prepared = getFile(mode, true, source).then((file) => ({ file }), (error) => ({ error }));
    current.timer = window.setTimeout(async () => {
      current.held = true;
      try {
        const { file, error } = await prepared;
        if (!current.active) return;
        if (error) throw error;
        const preview = await createDragPreview(file, current.privacyMode);
        if (!current.active) return;
        current.file = file;
        current.preview = preview;
        setArmed({ mode, itemId: source?.id });
      } catch (error) {
        if (current.active) onError(error);
      }
    }, 450);
  };

  const onDragStart = (event, mode, source) => {
    const current = press.current;
    if (!enabled || !current?.active || !current.file || current.mode !== mode || !fromSource(source)
      || current.getFile !== getFile || current.privacyMode !== privacyMode) {
      event.preventDefault();
      return;
    }
    const { dataTransfer } = event;
    const { file, preview } = current;
    current.dragging = true;
    current.url = URL.createObjectURL(file);
    // 原图元素的默认 URL 载荷会把用户带离当前页，换成实际的导出文件。
    dataTransfer.clearData();
    current.id = writePreviewFileDrag(dataTransfer, file);
    dataTransfer.effectAllowed = 'copy';
    dataTransfer.setDragImage(preview, 12, 12);
    dataTransfer.items.add(file);
    dataTransfer.setData('DownloadURL', `${file.type}:${file.name}:${current.url}`);
  };

  const onDragEnd = () => {
    const current = press.current;
    if (!current?.dragging) return false;
    clearPreviewFileDrag(current.id);
    current.dragging = false;
    releasePress();
    const { url } = current;
    current.url = null;
    // 文件管理器可能在松手后才读取完整文件。
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  };

  return { armedMode: armed?.mode, armedItemId: armed?.itemId, onPointerDown, onDragStart, onDragEnd,
    isDragging: () => Boolean(press.current?.dragging), wasHeld: (source) => Boolean(press.current?.held && fromSource(source)) };
}
