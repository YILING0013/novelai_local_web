import { useLayoutEffect, useRef } from 'react';
import { formatPromptForEditing } from './promptFormatting.mjs';
import { getPromptRegexRanges } from './promptTagCompletion.mjs';

/**
 * 在用户粘贴或完成编辑时整理提示词，避免输入过程中移动光标或改写导入的原文。
 * @param {object} settings 自动格式化偏好。
 * @param {string} value 当前编辑文本。
 * @param {Function} commit 接收整理后的文本和选区。
 * @param {Function} updateSuggestions 格式化的粘贴没有原生 input 事件，用实际光标恢复标签建议。
 * @returns {object} 普通、负面及展开编辑器共用的输入事件。
 */
export default function usePromptFormatting(settings, value, commit, updateSuggestions) {
  const original = useRef(null);
  const pasted = useRef(null);
  useLayoutEffect(() => {
    const pending = pasted.current;
    if (pending && pending.text === value) {
      pending.input.setSelectionRange(pending.cursor, pending.cursor);
      pasted.current = null;
      updateSuggestions(pending.input, { inputType: 'insertFromPaste' });
    }
  }, [value, updateSuggestions]);

  return {
    onFocus: (event) => { original.current = event.currentTarget.value; },
    onPaste: (event) => {
      if (!settings.autoFormat) return;
      const input = event.currentTarget;
      const plain = event.clipboardData.getData('text/plain');
      const before = input.value.slice(0, input.selectionStart);
      const after = input.value.slice(input.selectionEnd);
      // 只整理剪贴板内容。搜索前缀可以已经在输入框内，所以先用完整文本判定片段中的正则范围。
      const ranges = getPromptRegexRanges(before + plain + after, settings.suggestionSyntax)
        .filter(({ start, end }) => start < before.length + plain.length && end > before.length)
        .map(({ start, end }) => ({ start: Math.max(0, start - before.length), end: Math.min(plain.length, end - before.length) }));
      const part = formatPromptForEditing(plain, { ...settings, trailingComma: 'preserve' }, ranges);
      if (part === plain) return;
      event.preventDefault();
      const text = before + part + after;
      const cursor = input.selectionStart + part.length;
      if (text === input.value) {
        input.setSelectionRange(cursor, cursor);
        updateSuggestions(input, { inputType: 'insertFromPaste' });
        return;
      }
      pasted.current = { input, cursor, text };
      commit(text, { start: cursor, end: cursor });
    },
    onBlur: (event) => {
      const input = event.currentTarget;
      if (!settings.autoFormat || original.current === null || original.current === input.value) return;
      const text = formatPromptForEditing(input.value, settings);
      if (text !== input.value) commit(text, { start: text.length, end: text.length });
    },
  };
}
