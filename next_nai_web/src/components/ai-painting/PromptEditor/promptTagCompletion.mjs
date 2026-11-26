import { getPromptCommentRanges } from './promptCommentRanges.mjs';

/**
 * 检查自定义符号是否会与另一个搜索操作或提示词自身的分隔、权重、注释语法冲突。
 * @param {object} syntax 四种搜索操作及其符号。
 * @returns {string[]} 需要修改的操作名称。
 */
export function invalidPromptSyntaxSymbols(syntax) {
  const keys = ['category', 'exact', 'fuzzy', 'regex'];
  return keys.filter((key) => !/^[\p{P}\p{S}]$/u.test(syntax[key]) || /[,，:\[\]{}\/\\]/u.test(syntax[key])
    || keys.some((other) => other !== key && syntax[other] === syntax[key]));
}

const weightOpening = /^(?:[\[{]|[+-]?(?:\d+(?:\.\d+)?|\.\d+)::)\s*/;

/**
 * 找出整段提示词中作为搜索命令的正则表达式，供光标联想和编辑格式化共用。
 * @param {string} text 完整提示词。
 * @param {object} syntax 搜索开关和自定义符号。
 * @returns {Array<{start:number,body:number,end:number,segmentEnd:number}>} 命令范围及外层权重结束位置。
 */
export function getPromptRegexRanges(text, syntax) {
  if (!syntax?.enabled) return [];
  const marker = syntax.exact + syntax.regex;
  const ranges = [];
  for (let markerStart = text.indexOf(marker); markerStart >= 0;) {
    let start = markerStart;
    while (start > 0 && !/[,，\r\n]/.test(text[start - 1])) start--;
    while (/\s/.test(text[start])) start++;
    let closing = '';
    let opening;
    while ((opening = weightOpening.exec(text.slice(start, markerStart)))) {
      closing = { '[': ']', '{': '}' }[opening[0][0]] || '::';
      start += opening[0].length;
    }
    const prefix = text.slice(start, markerStart);
    const body = markerStart + marker.length;
    if (prefix && (!prefix.startsWith(syntax.category) || prefix.includes(syntax.exact) || prefix.includes(syntax.fuzzy))) {
      markerStart = text.indexOf(marker, body);
      continue;
    }

    // 字符组、次数、分组内的逗号属于表达式；最外层配对的提示词闭合符留给原词条。
    let escaped = false;
    let inClass = false;
    let depth = 0;
    let end = body;
    let suffixLength = 0;
    for (; end < text.length && !/[\r\n]/.test(text[end]); end++) {
      const char = text[end];
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (inClass) inClass = char !== ']';
      else if (char === '[') inClass = true;
      else if (depth === 0 && closing && text.startsWith(closing, end)) {
        const suffix = /^(?:(?:[\]}]|::)[^\S\r\n]*)+(?=[,，\r\n]|$)/.exec(text.slice(end));
        if (suffix) { suffixLength = suffix[0].length; break; }
      } else if (char === '(' || char === '{') depth++;
      else if (char === ')' || char === '}') depth = Math.max(0, depth - 1);
      else if (!depth && /[,，]/.test(char)) break;
    }
    const segmentEnd = end + suffixLength;
    ranges.push({ start, body, end, segmentEnd });
    markerStart = text.indexOf(marker, segmentEnd);
  }
  return ranges;
}

/**
 * 找出当前逗号或换行分段里的标签，保留空白、权重包装及后续文本。
 * @param {string} text 编辑器的完整文本。
 * @param {number} selectionStart 光标或选区的起点。
 * @param {number} selectionEnd 选区的终点；默认与光标相同。
 * @param {object} syntax 启用搜索语法时使用的类别和正则符号。
 * @returns {{start: number, end: number, query: string}|null} 标签的完整替换范围和查询词；跨标签选区、注释及随机语法不参与联想。
 */
export function getPromptTagRange(text, selectionStart, selectionEnd = selectionStart, syntax) {
  let segmentStart = selectionStart;
  let segmentEnd = selectionStart;
  while (segmentStart > 0 && !/[,，\r\n]/.test(text[segmentStart - 1])) segmentStart--;
  while (segmentEnd < text.length && !/[,，\r\n]/.test(text[segmentEnd])) segmentEnd++;
  const regex = getPromptRegexRanges(text, syntax).find(({ start, segmentEnd: end }) => selectionStart >= start && selectionEnd <= end);
  if (regex) { segmentStart = regex.start; segmentEnd = regex.segmentEnd; }
  if (selectionEnd > segmentEnd) return null;

  // 注释和随机标记可能自己包含逗号或换行，必须按全文判断所属范围。
  if (getPromptCommentRanges(text, true).some(({ start, end }) =>
    start < (regex?.body ?? segmentEnd) && end > segmentStart)) return null;
  for (const match of text.matchAll(/<ran_(?:sorting_)?id\b[^>]*(?:>|$)/g)) {
    if (match.index < segmentEnd && match.index + match[0].length > segmentStart) return null;
  }

  let start = segmentStart;
  let end = regex?.end ?? segmentEnd;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;

  // 数字权重允许负数；括号可嵌套，也可跨越多个逗号分隔的标签。
  let opening;
  while ((opening = weightOpening.exec(text.slice(start, end)))) {
    start += opening[0].length;
  }
  if (!regex) {
    let closing;
    while ((closing = text.slice(start, end).match(/\s*(?:[\]}]|::)$/))) {
      end -= closing[0].length;
    }
    if (/[\[\]{}]|::/.test(text.slice(start, end))) return null;
  }
  if (start >= end) return null;

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
