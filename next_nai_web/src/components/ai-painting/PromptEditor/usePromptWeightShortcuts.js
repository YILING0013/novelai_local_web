import { useEffect, useLayoutEffect, useRef } from 'react';
import { adjustPromptWeight } from './promptWeights.mjs';

/**
 * 为普通和展开编辑器提供 Shift + 滚轮、Alt + 上下键调权，保留光标或选区以便连续调整。
 * @param {object} options 输入框引用、文本、文本更新回调、默认权重格式及调整后的通知。
 * @returns {object} 调整权重函数和返回是否已处理的按键事件。
 */
export default function usePromptWeightShortcuts({ inputRef, value, onChange, defaultWeightMode, onAdjust, enabled = true }) {
  const pendingSelection = useRef(null);

  const adjustWeight = (direction) => {
    const input = inputRef.current;
    if (!enabled || !input) return false;
    const result = adjustPromptWeight(input.value, input.selectionStart, input.selectionEnd, direction, defaultWeightMode);
    if (result.text === input.value) return false;
    pendingSelection.current = result;
    onChange(result.text, result);
    onAdjust?.();
    return true;
  };

  useLayoutEffect(() => {
    const result = pendingSelection.current;
    if (result && result.text === value) {
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.setSelectionRange(result.start, result.end);
      pendingSelection.current = null;
    }
  }, [inputRef, value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onWheel = (event) => {
      if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || document.activeElement !== input) return;
      const delta = event.deltaY || event.deltaX;
      if (delta && adjustWeight(delta < 0 ? 1 : -1)) event.preventDefault();
    };
    // 原生非 passive 监听允许取消滚动，避免调权时页面跟着移动。
    input.addEventListener('wheel', onWheel, { passive: false });
    return () => input.removeEventListener('wheel', onWheel);
  });

  return {
    adjustWeight,
    onKeyDown: (event) => {
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || event.nativeEvent?.isComposing
          || !['ArrowUp', 'ArrowDown'].includes(event.key)) return false;
      if (!adjustWeight(event.key === 'ArrowUp' ? 1 : -1)) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
  };
}
