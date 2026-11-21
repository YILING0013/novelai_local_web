/**
 * 按出现顺序找出最外层提示词注释；内部的结束符只关闭对应的内层注释。
 * @param {string} text 编辑器原始提示词。
 * @param {boolean} includeUnclosed 是否在编辑时将未闭合的注释标记到文本末尾。
 * @returns {Array<{start: number, end: number}>} 注释的原文范围，包含两端标记。
 */
export function getPromptCommentRanges(text, includeUnclosed = false) {
  const ranges = [];
  let start = 0;
  let depth = 0;
  for (const { 0: marker, index } of text.matchAll(/\/\*|\*\//g)) {
    if (marker === '/*') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) ranges.push({ start, end: index + 2 });
    }
  }
  if (includeUnclosed && depth > 0) ranges.push({ start, end: text.length });
  return ranges;
}
