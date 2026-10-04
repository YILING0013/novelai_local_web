import { useEffect, useId, useRef, useState } from 'react';
import apiClient from '@/utils/ApiClient';
import { getPromptTagRange, insertPromptTag } from './promptTagCompletion.mjs';

/**
 * 按 textarea 的真实排版定位光标，供悬浮菜单使用；镜像仅用于测量，不参与编辑。
 * @param {HTMLTextAreaElement} input 当前输入框。
 * @param {number} position 光标在文本中的位置。
 * @returns {DOMRect} 视口内可见的光标矩形。
 */
function getCaretRect(input, position) {
  const style = getComputedStyle(input);
  const mirror = document.createElement('div');
  for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
    'padding', 'textIndent', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak']) {
    mirror.style[property] = style[property];
  }
  Object.assign(mirror.style, {
    position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
    boxSizing: 'border-box', width: `${input.clientWidth}px`,
  });
  mirror.textContent = input.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = input.value.slice(position) || '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const caret = marker.getClientRects()[0];
  const bounds = input.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight);
  const x = Math.min(bounds.right - 8, Math.max(bounds.left + 2, bounds.left + input.clientLeft + caret.left - input.scrollLeft));
  const y = Math.min(bounds.bottom - lineHeight, Math.max(bounds.top, bounds.top + input.clientTop + caret.top - input.scrollTop));
  mirror.remove();
  return new DOMRect(x, y, 0, lineHeight);
}

/**
 * 为普通和展开编辑器提供同一套联想、键盘选择和光标插入行为。
 * @param {object} options 当前文本、文本更新回调、原生 textarea 引用及启用状态。
 * @returns {object} 输入事件、候选列表和悬浮菜单所需的状态。
 */
export default function usePromptSuggestions({ value, onChange, inputRef, enabled = true }) {
  const listId = useId();
  const [context, setContext] = useState(null);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [upstreamUnavailable, setUpstreamUnavailable] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const composing = useRef(false);
  const compositionStartText = useRef(null);
  const lastInput = useRef(null);
  const requestRef = useRef(null);

  const close = () => {
    requestRef.current?.abort();
    lastInput.current = null;
    setContext(null);
    setTags([]);
    setLoading(false);
  };

  /**
   * 只接受真实插入或输入法提交；调用方需传入 onChange 的原生事件。
   * @param {HTMLTextAreaElement} input 已更新文本的输入框。
   * @param {InputEvent|CompositionEvent} nativeEvent 本次输入的原生事件。
   */
  const updateFromInput = (input, nativeEvent) => {
    const committedComposition = nativeEvent.type === 'compositionend' && nativeEvent.data
      && input.value !== compositionStartText.current;
    if (!enabled || composing.current || nativeEvent.isComposing || document.activeElement !== input
        || input.selectionStart !== input.selectionEnd
        || (!nativeEvent.inputType?.startsWith('insert') && !committedComposition)) {
      close();
      return;
    }
    const range = getPromptTagRange(input.value, input.selectionStart, input.selectionEnd);
    if (!range || (!/\p{Script=Han}/u.test(range.query) && !/[a-z0-9].*[a-z0-9]/i.test(range.query))) {
      close();
      return;
    }
    lastInput.current = `${input.value}\u0000${input.selectionStart}:${input.selectionEnd}`;
    setContext((previous) => {
      if (previous?.text === input.value && previous.start === range.start
          && previous.end === range.end && previous.query === range.query) return previous;
      // 光标或文本一变就取消旧请求，避免过期候选插进另一段提示词。
      requestRef.current?.abort();
      const position = input.selectionEnd;
      return { ...range, text: input.value, anchor: {
        contextElement: input,
        getBoundingClientRect: () => getCaretRect(input, position),
      } };
    });
  };

  useEffect(() => {
    setTags([]);
    setError(false);
    setUpstreamUnavailable(false);
    setActiveIndex(-1);
    if (!enabled || !context || context.text !== value) {
      if (!enabled) setContext(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      try {
        const data = await apiClient.getPrompt(context.query, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setTags(data.tags);
          setUpstreamUnavailable(data.upstream_status === 'unavailable');
        }
      } catch (requestError) {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [context, enabled, value]);

  const choose = (tag) => {
    const input = inputRef.current;
    if (!input || !context || input.value !== context.text) return;
    const range = getPromptTagRange(input.value, input.selectionStart, input.selectionEnd);
    if (!range || range.start !== context.start || range.end !== context.end) return;
    const result = insertPromptTag(input.value, range, tag.name);
    close();
    onChange(result.text);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.cursor, result.cursor);
    });
  };

  const open = enabled && context?.text === value && (loading || error || upstreamUnavailable || tags.length > 0);
  return {
    open: Boolean(open), anchor: context?.anchor, tags, loading, error, upstreamUnavailable,
    activeIndex, setActiveIndex, listId, choose, close, updateFromInput,
    inputProps: {
      id: `${listId}-input`,
      'aria-autocomplete': 'list',
      'aria-controls': open ? listId : undefined,
      'aria-expanded': Boolean(open),
      'aria-activedescendant': open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined,
      onFocus: close,
      onSelect: (event) => {
        const input = event.target;
        const signature = `${input.value}\u0000${input.selectionStart}:${input.selectionEnd}`;
        // React 输入后也会触发 onSelect；只有该次插入留下的折叠光标可保留建议。
        if (input.selectionStart !== input.selectionEnd || signature !== lastInput.current) close();
      },
      onPointerDown: close,
      onContextMenu: close,
      onCopy: close,
      onCut: close,
      onScroll: close,
      onBlur: close,
      onCompositionStart: (event) => {
        compositionStartText.current = event.target.value;
        composing.current = true;
        close();
      },
      onCompositionEnd: (event) => {
        composing.current = false;
        updateFromInput(event.target, event.nativeEvent);
        compositionStartText.current = null;
      },
      onKeyDown: (event) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || !open) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (tags.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          setActiveIndex((index) => event.key === 'ArrowDown'
            ? (index + 1) % tags.length
            : (index <= 0 ? tags.length - 1 : index - 1));
        } else if (tags.length && activeIndex >= 0 && (event.key === 'Enter' || event.key === 'Tab')) {
          event.preventDefault();
          choose(tags[activeIndex]);
        }
      },
    },
  };
}
