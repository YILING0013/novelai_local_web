import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Popper, Snackbar, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import { getCaretRect } from './usePromptSuggestions';
import usePromptEditorSettings from './usePromptEditorSettings';
import usePromptTranslations from './usePromptTranslations';

/**
 * 外部输入框、展开编辑器和只读预览共用释义交互；点击同词关闭，编辑和滚动时收起。
 * @param {object} options 原文、预览引用、是否叠加及编辑器启用状态。
 * @returns {object} 译文、输入事件、预览事件和浮层状态。
 */
export default function usePromptTranslationPreview({ text, previewRef, overlay = false, enabled = true }) {
  const { translationEnabled, translationTarget, translationUnderline, setSetting } = usePromptEditorSettings();
  const translation = usePromptTranslations(text, { enabled: enabled && translationEnabled, targetLanguage: translationTarget });
  const [active, setActive] = useState(null);
  const pointer = useRef(null);
  const suppressSelection = useRef(false);
  const tooltipId = useId();
  const close = () => setActive(null);

  useEffect(() => {
    setActive(null);
  }, [text, enabled, translationEnabled, translationTarget, overlay]);

  useEffect(() => {
    if (!active) return;
    const handleOutside = (event) => {
      if (active.anchor.contextElement?.contains(event.target) || previewRef.current?.contains(event.target)) return;
      setActive(null);
    };
    // 页面滚动时收起，避免浮层停留在已经移走的文字上。
    const handleViewportChange = () => setActive(null);
    document.addEventListener('pointerdown', handleOutside);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [active, previewRef]);

  const showTag = (tag, anchor, pinned, toggle = false) => {
    if (!enabled || !translationEnabled || !tag || !translation.translations[tag.key]) {
      close();
      return;
    }
    const identity = `${tag.start}:${tag.end}:${tag.key}`;
    setActive((previous) => {
      if (toggle && previous?.identity === identity && previous.pinned) return null;
      if (!pinned && previous?.pinned) return previous;
      if (previous?.identity === identity && previous.pinned === pinned) {
        const oldRect = previous.anchor.getBoundingClientRect();
        const rect = anchor.getBoundingClientRect();
        if (oldRect.left === rect.left && oldRect.top === rect.top) return previous;
      }
      return { identity, ...tag, original: text.slice(tag.start, tag.end), anchor, pinned };
    });
  };

  const showSelection = (input, toggle = false) => {
    const tag = translation.tags.find(({ start, end }) => input.selectionStart >= start
      && input.selectionEnd <= end && input.selectionStart <= end);
    if (!tag) { close(); return; }
    const position = input.selectionStart;
    showTag(tag, {
      contextElement: input,
      // 多行标签的整体矩形会横跨整个输入框，直接按光标所在行定位。
      getBoundingClientRect: () => getCaretRect(input, position),
    }, true, toggle);
  };

  const showPreviewTag = (element, pinned, toggle = false, point) => {
    if (!element) { if (pinned || !active?.pinned) close(); return; }
    const tag = translation.tags.find(({ start }) => start === Number(element.dataset.previewStart));
    const rects = [...element.getClientRects()];
    const line = (point && rects.find((rect) => point.clientX >= rect.left && point.clientX <= rect.right
      && point.clientY >= rect.top && point.clientY <= rect.bottom)) || rects[0];
    if (!line) return;
    // 以正在指向的行片段为锚点，不使用跨行标签的整体包围矩形。
    const rect = new DOMRect(point ? Math.max(line.left, Math.min(line.right, point.clientX)) : line.left,
      line.top, 0, line.height);
    showTag(tag, { contextElement: element, getBoundingClientRect: () => rect }, pinned, toggle);
  };

  return {
    ...translation,
    active: enabled && translationEnabled ? active : null,
    tooltipId,
    underline: translationUnderline,
    close,
    disable: () => { setSetting('translationEnabled', false); translation.dismissError(); },
    inputProps: {
      'aria-describedby': active ? tooltipId : undefined,
      onPointerDown: (event) => {
        pointer.current = { type: event.pointerType, pending: true };
        suppressSelection.current = false;
      },
      onPointerCancel: () => { pointer.current = null; close(); },
      onClick: (event) => {
        pointer.current = { ...pointer.current, pending: false };
        suppressSelection.current = true;
        showSelection(event.currentTarget, true);
      },
      onSelect: (event) => {
        if (!pointer.current?.pending && !suppressSelection.current) showSelection(event.currentTarget);
      },
      onKeyDown: (event) => {
        if (event.defaultPrevented) return;
        suppressSelection.current = !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key);
        if (suppressSelection.current) close();
      },
      onChange: () => { suppressSelection.current = true; close(); },
      onCompositionStart: () => { suppressSelection.current = true; close(); },
      onBlur: close,
      onScroll: close,
      onMouseMove: (event) => {
        if (!overlay || pointer.current?.type === 'touch' || active?.pinned) return;
        const element = [...(previewRef.current?.querySelectorAll('[data-preview-translation]') || [])].find((tag) => (
          [...tag.getClientRects()].some((rect) => event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom)
        ));
        showPreviewTag(element, false, false, event);
      },
      onMouseLeave: () => { if (!active?.pinned) close(); },
    },
    previewProps: {
      onClick: (event) => showPreviewTag(event.target.closest('[data-preview-translation]'), true, true, event),
      onMouseMove: (event) => {
        if (!window.matchMedia('(hover: hover)').matches) return;
        showPreviewTag(event.target.closest('[data-preview-translation]'), false, false, event);
      },
      onMouseLeave: () => { if (!active?.pinned) close(); },
      onKeyDown: (event) => {
        if (event.key === 'Escape') close();
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showPreviewTag(event.target.closest('[data-preview-translation]'), true, true);
        }
      },
      onBlur: close,
    },
  };
}

/**
 * 显示编辑器共用的释义浮层及单次会话翻译失败提醒，不占用文本布局空间。
 * @param {object} props usePromptTranslationPreview 返回的交互状态。
 * @returns {React.ReactElement} 释义和短警告。
 */
export function PromptTranslationFeedback({ preview }) {
  const { t } = useI18n();
  const { active } = preview;
  return (
    <>
      <Popper id={preview.tooltipId} role="tooltip" open={Boolean(active)} anchorEl={active?.anchor} placement="top-start"
        modifiers={[
          { name: 'offset', options: { offset: [0, 8] } },
          { name: 'flip', options: { fallbackPlacements: ['bottom-start'], flipVariations: false, padding: 12 } },
          { name: 'preventOverflow', options: { padding: 12, tether: false } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 2, pointerEvents: 'none' }}>
        <Paper elevation={5}
          sx={{ px: 1.5, py: 1, maxWidth: 'min(360px, calc(100vw - 24px))', overflowWrap: 'anywhere' }}>
          <Typography variant="caption" color="text.secondary" component="div">{active?.original}</Typography>
          <Typography variant="body2">{active && preview.translations[active.key]}</Typography>
        </Paper>
      </Popper>
      <Snackbar open={preview.showError} autoHideDuration={6000} onClose={preview.dismissError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="warning" onClose={preview.dismissError}
          action={<Box sx={{ display: 'flex', whiteSpace: 'nowrap' }}>
            <Button color="inherit" size="small" onClick={preview.retry}>{t('painting.tools.promptEditor.translationRetry')}</Button>
            <Button color="inherit" size="small" onClick={preview.disable}>{t('painting.tools.promptEditor.translationDisable')}</Button>
          </Box>}>
          {t('painting.tools.promptEditor.translationFailed')}
        </Alert>
      </Snackbar>
    </>
  );
}
