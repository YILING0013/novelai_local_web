/**
 * 找出当前逗号或换行分段里的标签，保留空白、权重包装及后续文本。
 * @param {string} text 编辑器的完整文本。
 * @param {number} selectionStart 光标或选区的起点。
 * @param {number} selectionEnd 选区的终点；默认与光标相同。
 * @returns {{start: number, end: number, query: string}|null} 标签的完整替换范围和查询词；跨标签选区、注释及随机语法不参与联想。
 */
export function getPromptTagRange(text, selectionStart, selectionEnd = selectionStart) {
  let segmentStart = selectionStart;
  let segmentEnd = selectionStart;
  while (segmentStart > 0 && !/[,，\r\n]/.test(text[segmentStart - 1])) segmentStart--;
  while (segmentEnd < text.length && !/[,，\r\n]/.test(text[segmentEnd])) segmentEnd++;
  if (selectionEnd > segmentEnd) return null;

  // 注释和随机标记可能自己包含逗号或换行，必须按全文判断所属范围。
  for (const match of text.matchAll(/\/\*[\s\S]*?(?:\*\/|$)|<ran_(?:sorting_)?id\b[^>]*(?:>|$)/g)) {
    if (match.index < segmentEnd && match.index + match[0].length > segmentStart) return null;
  }

  let start = segmentStart;
  let end = segmentEnd;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;

  // 数字权重允许负数；括号可嵌套，也可跨越多个逗号分隔的标签。
  let opening;
  while ((opening = text.slice(start, end).match(/^(?:[\[{]|[+-]?(?:\d+(?:\.\d+)?|\.\d+)::)\s*/))) {
    start += opening[0].length;
  }
  let closing;
  while ((closing = text.slice(start, end).match(/\s*(?:[\]}]|::)$/))) {
    end -= closing[0].length;
  }
  if (start >= end || /[\[\]{}]|::/.test(text.slice(start, end))) return null;

  const queryStart = selectionStart === selectionEnd ? start : Math.max(start, selectionStart);
  const queryEnd = Math.min(end, selectionEnd);
  if (queryEnd <= queryStart) return null;
  const query = text.slice(queryStart, queryEnd).trim();
  return query ? { start, end, query } : null;
}

/**
 * 用选中的标签替换完整词条，把光标放到分隔符后，避免重复逗号。
 * @param {string} text 取得 range 时的完整编辑器文本。
 * @param {{start: number, end: number, query: string}} range getPromptTagRange 返回的有效范围。
 * @param {string} tag 要插入的英文标签。
 * @returns {{text: string, cursor: number}} 更新后的文本和光标位置。
 */
export function insertPromptTag(text, range, tag) {
  const before = text.slice(0, range.start) + tag;
  let separator = range.end;
  while (separator < text.length && !/[,，\r\n]/.test(text[separator])) separator++;
  const closing = text.slice(range.end, separator);
  const after = text.slice(separator);

  if (/^[,，]/.test(after)) {
    // 沿用原有中英文逗号和空白，光标不会跑到下一个标签内部。
    const spacing = after.match(/^[,，][^\S\r\n]*/)[0];
    return { text: before + closing + after, cursor: before.length + closing.length + spacing.length };
  }
  if (/^[\r\n]/.test(after)) {
    return { text: before + closing + after, cursor: before.length + closing.length };
  }

  // 逗号放在权重闭合符外面；已有尾部空白移到逗号后，不额外堆空格。
  const trailingSpace = closing.match(/\s*$/)[0];
  const completed = before + closing.slice(0, closing.length - trailingSpace.length) + ',' + (trailingSpace || ' ');
  return { text: completed, cursor: completed.length };
}
