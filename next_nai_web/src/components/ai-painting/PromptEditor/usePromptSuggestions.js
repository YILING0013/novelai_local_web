import { useEffect, useId, useRef, useState } from 'react';
import { getPromptTagRange, insertPromptTag } from './promptTagCompletion.mjs';
import { searchPromptTags } from './searchPromptTags.mjs';

/**
 * 按 textarea 的真实排版定位光标，供悬浮菜单使用；镜像仅用于测量，不参与编辑。
 * @param {HTMLTextAreaElement} input 当前输入框。
 * @param {number} position 光标在文本中的位置。
 * @param {number} [anchorStart=position] 标签起点，建议弹窗从本行文字左侧展开。
 * @returns {DOMRect} 视口内可见的光标矩形。
 */
export function getCaretRect(input, position, anchorStart = position) {
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
  let left = caret.left;
  if (anchorStart < position) {
    const start = document.createRange();
    start.setStart(mirror.firstChild, anchorStart);
    start.setEnd(mirror.firstChild, anchorStart + 1);
    const text = start.getBoundingClientRect();
    // 标签换行后，弹窗跟随光标所在行，左缘与换行处的文字对齐。
    left = Math.abs(text.top - caret.top) < lineHeight / 2 ? text.left : parseFloat(style.paddingLeft);
  }
  const x = Math.min(bounds.right - 8, Math.max(bounds.left + 2, bounds.left + input.clientLeft + left - input.scrollLeft));
  const y = Math.min(bounds.bottom - lineHeight, Math.max(bounds.top, bounds.top + input.clientTop + caret.top - input.scrollTop));
  mirror.remove();
  return new DOMRect(x, y, 0, lineHeight);
}

/**
 * 为普通和展开编辑器提供同一套联想、键盘选择和光标插入行为。
 * @param {object} options 当前文本、文本更新回调、原生 textarea 引用及启用状态。
 * @returns {object} 输入事件、候选列表和悬浮菜单所需的状态。
 */
export default function usePromptSuggestions({ value, onChange, onChoose, inputRef, enabled, settings }) {
  const { suggestionSyntax: syntax, suggestionLimit, suggestionLayout, suggestionTextLayout } = settings;
  const listId = useId();
  const [context, setContext] = useState(null);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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

  const matchInput = (input) => {
    const { value: text, selectionStart: start, selectionEnd: end } = input;
    const range = getPromptTagRange(text, start, end, syntax);
    if (!range) {
      close();
      return;
    }
    const command = syntax.enabled && [syntax.category, syntax.exact, syntax.fuzzy].some((symbol) => range.query.startsWith(symbol));
    if (!command && !/\p{Script=Han}/u.test(range.query) && !/[a-z0-9].*[a-z0-9]/i.test(range.query)) {
      close();
      return;
    }
    // 输入法提交和 input 事件可能带来同一光标与文本，只查询一次。
    const signature = `${text}\u0000${start}:${end}`;
    if (lastInput.current === signature) return;
    lastInput.current = signature;
    requestRef.current?.abort();
    setTags([]);
    setActiveIndex(-1);
    setContext({ ...range, text, command, anchor: {
      contextElement: input, getBoundingClientRect: () => getCaretRect(input, end, range.start),
    } });
  };

  const updateFromInput = (input, nativeEvent) => {
    const committedComposition = nativeEvent.type === 'compositionend' && nativeEvent.data
      && input.value !== compositionStartText.current;
    if (enabled && !composing.current && !nativeEvent.isComposing && document.activeElement === input
        && input.selectionStart === input.selectionEnd && (/^(insert|delete)/.test(nativeEvent.inputType) || committedComposition)) {
      matchInput(input);
    } else {
      close();
    }
  };

  useEffect(() => {
    setTags([]);
    setError(null);
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
        const matches = await searchPromptTags(context.query, { limit: suggestionLimit, syntax, signal: controller.signal });
        if (!controller.signal.aborted) setTags(matches);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError.code === 'invalid_regex' ? 'invalidRegex' : 'suggestionsFailed');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 80);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [context, enabled, value, suggestionLimit, syntax]);

  const choose = (tag) => {
    const input = inputRef.current;
    if (!input || !context || input.value !== context.text) return;
    const range = getPromptTagRange(input.value, input.selectionStart, input.selectionEnd, syntax);
    if (!range || range.start !== context.start || range.end !== context.end || range.query !== context.query) return;
    const category = tag.kind === 'category';
    // 类别继续留在当前标签里供逐级查询，只有选中词条才补逗号并结束联想。
    const result = category
      ? { text: input.value.slice(0, range.start) + tag.completion + input.value.slice(range.end),
        cursor: range.start + tag.completion.length }
      : insertPromptTag(input.value, range, tag.name);
    close();
    onChange(result.text, result.cursor);
    onChoose?.(tag);
    requestAnimationFrame(() => {
      if (inputRef.current !== input || input.value !== result.text || document.activeElement !== input) return;
      input.setSelectionRange(result.cursor, result.cursor);
      if (category) matchInput(input);
    });
  };

  const open = enabled && context?.text === value && (loading || error || context?.command || tags.length > 0);
  return {
    open: Boolean(open), anchor: context?.anchor, tags, loading, error, suggestionLayout, suggestionTextLayout,
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
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || !open
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (tags.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          setActiveIndex((index) => event.key === 'ArrowDown'
            ? (index + 1) % tags.length
            : (index <= 0 ? tags.length - 1 : index - 1));
        } else if (tags.length && (event.key === 'Tab' || (event.key === 'Enter' && activeIndex >= 0))) {
          event.preventDefault();
          choose(tags[activeIndex] ?? tags[0]);
        }
      },
    },
  };
}
