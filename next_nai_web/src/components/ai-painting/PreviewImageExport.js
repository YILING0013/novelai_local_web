"use client";

import { useEffect, useRef, useState } from 'react';
import { Box, Button, ClickAwayListener, IconButton, Paper, Popper, Tooltip } from '@mui/material';
import { ContentCopy, Download, ExpandLess } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { downloadBlobToFile } from '@/utils/mediaAssets';
import { imageExportModes } from './tools/ImageTools/previewImageExport';
import usePreviewImageDrag from './usePreviewImageDrag';

/**
 * 显示默认导出按钮及其余方式。复制按钮长按后可用浏览器原生拖放导出同样的文件。
 * @param {object} props 导出类型、默认方式、文件读取和通知回调。
 * @returns {React.ReactElement} 图片复制或下载控件。
 */
export default function PreviewImageExport({ action, defaultMode, getFile, disabled, showText, onNotice, privacyMode }) {
  const { t } = useI18n();
  const anchor = useRef(null);
  const closeTimer = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = action === 'copy';
  const Icon = copy ? ContentCopy : Download;
  const label = (mode) => t(`painting.workspace.gallery.exportActions.${action}.${mode}`);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const reportError = (error) => {
    const key = ['invalidCustomMetadata', 'imageTooLarge'].includes(error.message)
      ? error.message : copy ? 'copyExportFailed' : 'downloadExportFailed';
    onNotice(t(`painting.workspace.gallery.${key}`), 'error');
  };
  const drag = usePreviewImageDrag({ enabled: copy && !disabled && !busy, getFile, privacyMode, onError: reportError });

  const activate = async (event, mode) => {
    if (copy && event.detail && drag.wasHeld()) return;
    setBusy(true);
    try {
      if (copy) {
        const androidCopy = window.Capacitor?.getPlatform?.() === 'android' && window.novelaiCopyImage;
        const systemClipboard = navigator.clipboard?.write && typeof ClipboardItem !== 'undefined';
        if (!androidCopy && !systemClipboard && !window.novelaiCopyImage) throw new Error('clipboardUnavailable');
        const png = getFile(mode, true);
        const supportsRaw = Boolean(androidCopy || (systemClipboard && ClipboardItem.supports?.('web image/png')));
        if (androidCopy || !systemClipboard) {
          await window.novelaiCopyImage(await png);
        } else {
          const formats = { 'image/png': png };
          if (supportsRaw) formats['web image/png'] = png;
          await Promise.all([png, navigator.clipboard.write([new ClipboardItem(formats)])]);
        }
        const limited = !supportsRaw && mode === 'custom';
        onNotice(t(`painting.workspace.gallery.${limited ? 'customClipboardUnavailable' : 'imageCopied'}`), limited ? 'warning' : 'success');
      } else {
        const file = await getFile(mode, false);
        await downloadBlobToFile(file, file.name);
      }
      setMenuOpen(false);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const showMenu = () => {
    window.clearTimeout(closeTimer.current);
    if (!disabled) setMenuOpen(true);
  };
  const closeMenu = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (!drag.isDragging()) setMenuOpen(false);
    }, 180);
  };

  const renderButton = (mode, inMenu = false) => {
    const text = label(mode);
    const Control = inMenu || showText ? Button : IconButton;
    return <Tooltip key={mode} title={!inMenu && !showText ? text : copy ? t('painting.workspace.gallery.copyDragHint') : ''}
      placement="left" disableInteractive enterDelay={500}>
      <span onPointerEnter={!inMenu ? (event) => { if (event.pointerType === 'mouse') showMenu(); } : undefined}
        style={{ display: 'inline-flex', width: inMenu ? '100%' : undefined }}>
      <Control
        size="small" aria-label={text} disabled={disabled || busy}
        {...(inMenu || showText ? { startIcon: <Icon sx={{ fontSize: 18 }} /> } : {})}
        onClick={(event) => { void activate(event, mode); }}
        draggable={copy && !disabled && !busy}
        onPointerDown={copy ? (event) => drag.onPointerDown(event, mode) : undefined}
        onDragStart={copy ? (event) => drag.onDragStart(event, mode) : undefined}
        onDragEnd={copy ? () => { if (drag.onDragEnd()) setMenuOpen(false); } : undefined}
        sx={{ justifyContent: inMenu ? 'flex-start' : undefined, whiteSpace: 'nowrap', width: inMenu ? '100%' : showText ? 'auto' : 34,
          minWidth: 0, color: 'text.secondary', cursor: copy && drag.armedMode === mode ? 'grabbing' : undefined,
          '& .MuiButton-startIcon': { mr: 0.75 } }}
      >
        {inMenu || showText ? text : <Icon sx={{ fontSize: 18 }} />}
      </Control>
      </span>
    </Tooltip>;
  };

  return <ClickAwayListener onClickAway={() => setMenuOpen(false)}>
    <Box ref={anchor} onPointerLeave={closeMenu}
      onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false); }}
      sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      {renderButton(defaultMode)}
      <IconButton size="small" aria-label={t(`painting.workspace.gallery.${action}Options`)} aria-expanded={menuOpen}
        disabled={disabled} onClick={() => {
          window.clearTimeout(closeTimer.current);
          setMenuOpen((open) => !open);
        }} sx={{ width: 22, height: 30, p: 0, color: 'text.secondary' }}>
        <ExpandLess fontSize="small" />
      </IconButton>
      <Popper anchorEl={anchor.current} open={menuOpen && !disabled} placement="top-start" sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}>
        <Paper elevation={8} role="group" aria-label={t(`painting.workspace.gallery.${action}Options`)}
          onPointerEnter={(event) => { if (event.pointerType === 'mouse') showMenu(); }} onPointerLeave={closeMenu}
          sx={{ display: 'flex', flexDirection: 'column', p: 0.5, border: '1px solid', borderColor: 'divider' }}>
          {imageExportModes.filter((mode) => mode !== defaultMode).map((mode) => renderButton(mode, true))}
        </Paper>
      </Popper>
    </Box>
  </ClickAwayListener>;
}
