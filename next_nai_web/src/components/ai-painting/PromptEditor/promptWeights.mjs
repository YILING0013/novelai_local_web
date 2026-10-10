/**
 * 调整选区或光标所在提示词的权重，保留分隔符、空白和词内括号；已有权重组按原格式调整。
 * @param {string} text 完整提示词。
 * @param {number} start 选区起点。
 * @param {number} end 选区终点。
 * @param {number} direction 加权为 1，降权为 -1。
 * @param {'numeric'|'brackets'} defaultMode 无权重文字使用的默认格式。
 * @returns {{text: string, start: number, end: number}} 更新后的文本和可继续操作的选区或光标。
 */
export function adjustPromptWeight(text, start, end, direction, defaultMode = 'numeric') {
  const caretOnly = start === end;

  const ranges = [];
  const groups = [];
  const stack = [];
  let termStart = 0;
  // 只在权重组外分词，避免将 1.2::red, blue:: 或 {red, blue} 拆坏。
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || (!stack.length && /[,，\n\r]/.test(text[index]))) {
      ranges.push({ start: termStart, end: index });
      termStart = index + 1;
      continue;
    }
    if (text[index] === '\\') { index += 1; continue; }
    if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2);
      if (caretOnly && start >= index && start < (close < 0 ? text.length + 1 : close + 2)) return { text, start, end };
      index = close < 0 ? text.length - 1 : close + 1;
      continue;
    }
    if (text.startsWith('<ran_', index)) {
      const close = text.indexOf('>', index + 5);
      if (caretOnly && start >= index && start < (close < 0 ? text.length + 1 : close + 1)) return { text, start, end };
      index = close < 0 ? text.length - 1 : close;
      continue;
    }
    const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::/.exec(text.slice(index));
    if (numeric) {
      if (!stack.length) {
        ranges.push({ start: termStart, end: index });
        termStart = index;
      }
      stack.push({ closing: '::', start: index });
      index += numeric[0].length - 1;
    } else if (text.startsWith('::', index) && stack.at(-1)?.closing === '::') {
      groups.push({ ...stack.pop(), end: index + 2 });
      if (!stack.length) {
        ranges.push({ start: termStart, end: index + 2 });
        termStart = index + 2;
      }
      index += 1;
    } else if ('{[('.includes(text[index])) {
      if (!stack.length && text[index] !== '(') {
        ranges.push({ start: termStart, end: index });
        termStart = index;
      }
      stack.push({ closing: { '{': '}', '[': ']', '(': ')' }[text[index]], start: index });
    } else if (text[index] === stack.at(-1)?.closing) {
      groups.push({ ...stack.pop(), end: index + 1 });
      if (!stack.length && text[index] !== ')') {
        ranges.push({ start: termStart, end: index + 1 });
        termStart = index + 1;
      }
    }
  }

  let updated = text;
  let selectedStart = start;
  let selectedEnd = end;
  let lengthChange = 0;
  // 从后往前替换，前面的原文坐标不会被后面的长度变化影响。
  for (const range of ranges.reverse()) {
    const raw = text.slice(range.start, range.end);
    const leading = raw.match(/^\s*/)[0].length;
    const trailing = raw.match(/\s*$/)[0].length;
    const contentStart = range.start + leading;
    const contentEnd = range.end - trailing;
    if (contentStart >= contentEnd || (caretOnly
      ? start < contentStart || start > contentEnd
      : contentStart >= end || contentEnd <= start)) continue;

    const term = text.slice(contentStart, contentEnd);
    if (term.startsWith('/*') || term.startsWith('<ran_')) continue;
    const outerGroup = groups.find((group) => group.start === contentStart && group.end === contentEnd);
    const numeric = outerGroup?.closing === '::' ? /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))::([\s\S]*)::$/.exec(term) : null;
    const bracket = outerGroup?.closing === '}' || outerGroup?.closing === ']';
    // 已有完整权重时改动外层数值/括号；新建的局部权重同样保留完整范围，方便连续调整。
    let changeStart = caretOnly || numeric || bracket ? contentStart : Math.max(contentStart, start);
    let changeEnd = caretOnly || numeric || bracket ? contentEnd : Math.min(contentEnd, end);
    while (changeStart < changeEnd && /\s/.test(text[changeStart])) changeStart += 1;
    while (changeEnd > changeStart && /\s/.test(text[changeEnd - 1])) changeEnd -= 1;
    const selected = text.slice(changeStart, changeEnd);
    if (!selected.trim()) continue;
    let replacement;
    let prefixChange;
    if (numeric) {
      const weight = Number((Number(numeric[1]) + direction / 10).toFixed(10));
      const prefix = weight === 1 ? '' : `${Number.isInteger(weight) ? weight.toFixed(1) : weight}::`;
      replacement = weight === 1 ? numeric[2] : `${prefix}${numeric[2]}::`;
      prefixChange = prefix.length - numeric[1].length - 2;
    } else if (bracket || defaultMode === 'brackets') {
      const removeLayer = bracket && (direction > 0 ? term[0] === '[' : term[0] === '{');
      replacement = removeLayer ? selected.slice(1, -1) : direction > 0 ? `{${selected}}` : `[${selected}]`;
      prefixChange = removeLayer ? -1 : 1;
    } else {
      const prefix = `${(1 + direction / 10).toFixed(1)}::`;
      replacement = `${prefix}${selected}::`;
      prefixChange = prefix.length;
    }
    updated = updated.slice(0, changeStart) + replacement + updated.slice(changeEnd);
    if (caretOnly) {
      // 前缀增减时跟随正文位置移动，仍保留单光标，下一步可继续调整同一提示词。
      const cursor = Math.max(changeStart, Math.min(changeStart + replacement.length, start + prefixChange));
      return { text: updated, start: cursor, end: cursor };
    }
    selectedStart = Math.min(selectedStart, changeStart);
    selectedEnd = Math.max(selectedEnd, changeEnd);
    lengthChange += replacement.length - (changeEnd - changeStart);
  }
  return { text: updated, start: selectedStart, end: selectedEnd + lengthChange };
}

/** 为现有公共编辑接口加权，参数及返回值与 adjustPromptWeight 相同（不含 direction）。 */
export const weightUpText = (text, start, end, defaultMode = 'numeric') => adjustPromptWeight(text, start, end, 1, defaultMode);

/** 为现有公共编辑接口降权，参数及返回值与 adjustPromptWeight 相同（不含 direction）。 */
export const weightDownText = (text, start, end, defaultMode = 'numeric') => adjustPromptWeight(text, start, end, -1, defaultMode);
