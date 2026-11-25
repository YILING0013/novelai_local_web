import { getPromptCommentRanges } from './promptCommentRanges.mjs';
import { getPromptRegexRanges } from './promptTagCompletion.mjs';

/**
 * 按编辑偏好整理普通提示词，保留注释、占位符、转义字符和专用分隔符。
 * @param {string} text 用户正在编辑或粘贴的提示词。
 * @param {object} settings 逗号、下划线和段尾规则。
 * @param {Array} regexRanges 属于查询命令的范围；粘贴片段可沿用完整编辑器文本的查询上下文。
 * @returns {string} 整理后的提示词。
 */
export function formatPromptForEditing(text, settings, regexRanges = getPromptRegexRanges(text, settings.suggestionSyntax)) {
  const { normalizeCommas, replaceUnderscores, trailingComma } = settings;
  const protectedRanges = [...getPromptCommentRanges(text, true), ...regexRanges];
  for (const { index, 0: token } of text.matchAll(/\\[\s\S]|<[^<>\r\n]*(?:>|$)|__[\w./-]+__|https?:\/\/[^\s,，]+/g)) {
    protectedRanges.push({ start: index, end: index + token.length });
  }
  protectedRanges.sort((a, b) => a.start - b.start || b.end - a.end);

  const format = (fragment) => {
    if (normalizeCommas) {
      fragment = fragment.replace(/[^\S\r\n]*[,，][^\S\r\n]*/g, ', ').replace(/, (?=\r?\n)/g, ',');
    }
    if (replaceUnderscores) {
      fragment = fragment.replace(/(^|[,，\s])([a-z\d]+(?:_[a-z\d]+)+)(?=$|[,，\s])/gi,
        (_, boundary, tag) => boundary + tag.replaceAll('_', ' '));
    }
    return fragment;
  };

  let result = '';
  let offset = 0;
  for (const { start, end } of protectedRanges) {
    if (end <= offset) continue;
    if (start >= offset) result += format(text.slice(offset, start));
    result += text.slice(Math.max(offset, start), end);
    offset = end;
  }
  let tail = format(text.slice(offset));
  if (normalizeCommas) tail = tail.replace(/, $/, ',');
  if (trailingComma !== 'preserve' && tail.trim()) {
    tail = tail.replace(/(?:[,，][^\S\r\n]*)+([\t \r\n]*)$/, '$1');
    if (trailingComma === 'append' && (result + tail).trim()) tail = tail.replace(/(\s*)$/, ',$1');
  }
  return result + tail;
}
