/**
 * 提取可翻译文字并保留全文位置；词库命中的完整标签不拆句号，其余文字按中英文逗号、句号拆分。
 * @param {string} text 包含权重、注释和随机标签的原始提示词。
 * @param {object} options dictionaryOnly 用于先查询完整词库标签，dictionaryTranslations 为本次可用的词库释义。
 * @returns {Array<{start: number, end: number, key: string}>} 原文范围和清理后的查询文字。
 */
export function getPreviewTagRanges(text, { dictionaryOnly = false, dictionaryTranslations = {} } = {}) {
  // 使用等长空格遮住语法，所有下标始终对应 textarea 的 UTF-16 字符位置。
  const masked = text
    .replace(/\/\*[\s\S]*?(?:\*\/|$)|<[^>]*(?:>|$)/g, (value) => ' '.repeat(value.length))
    .replace(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*::/g, (value) => ' '.repeat(value.length))
    .replace(/([([{]\s*)[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*:/g,
      (value, opening) => opening + ' '.repeat(value.length - opening.length))
    .replace(/:\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(?=[)\]}])/g, (value) => ' '.repeat(value.length))
    .replace(/::/g, '  ')
    // artist 是逗号分隔的画师标签，名字内的句号或嵌套权重不能变成新的翻译文本。
    .replace(/(^|[,，.。．])([\s\[\]{}()]*artist\s*[:：][^,，]*)/gi,
      (value, separator, artist) => separator + ' '.repeat(artist.length));
  const tags = [];
  for (const part of masked.matchAll(/[^,，]+/g)) {
    if (/^[\s\[\]{}()]*artist\s*[:：]/i.test(part[0])) continue;

    // foo_(bar) 是真实词库标签；仅去掉外层权重，保留内部用于区分角色/作品的括号。
    const first = part[0].search(/[\p{L}\p{N}_]/u);
    if (first < 0) continue;
    const inner = part[0].slice(first).replace(/[\s\]})。．.]+$/, '');
    const qualifierEnd = /[\p{L}\p{N}_]\s*\([^()]+\)/u.exec(part[0].slice(first));
    const length = Math.max(inner.length, qualifierEnd ? qualifierEnd.index + qualifierEnd[0].length : 0);
    const candidate = part[0].slice(first, first + length);
    const dictionaryKey = candidate.replace(/[^\p{L}\p{M}\p{N}\s_'’().\-]/gu, ' ')
      .replaceAll('_', ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!/\p{L}/u.test(dictionaryKey)) continue;
    if (dictionaryOnly || (Object.hasOwn(dictionaryTranslations, dictionaryKey) && dictionaryTranslations[dictionaryKey])) {
      tags.push({ start: part.index + first, end: part.index + first + length, key: dictionaryKey });
      continue;
    }

    for (const sentence of part[0].matchAll(/[^.。．]+/g)) {
      const clean = sentence[0].replace(/[^\p{L}\p{M}\p{N}\s_'’\-]/gu, (value) => ' '.repeat(value.length));
      const leading = clean.search(/[\p{L}\p{N}_]/u);
      if (leading < 0) continue;
      const trailing = clean.match(/[\s'’\-]*$/u)[0].length;
      const key = clean.slice(leading, clean.length - trailing).replaceAll('_', ' ')
        .replace(/\s+/g, ' ').trim().toLowerCase();
      if (!/\p{L}/u.test(key)) continue;
      tags.push({ start: part.index + sentence.index + leading, end: part.index + sentence.index + clean.length - trailing, key });
    }
  }
  return tags;
}

// 输入层与预览层必须共用这些排版参数；高亮只能改变颜色，不能增加字符或间距。
export const PROMPT_TEXT_STYLE = {
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
  margin: 0,
  padding: '12px',
  border: 0,
  fontFamily: '"Roboto Mono", "Noto Sans Mono", monospace',
  fontSize: '14px',
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: '24px',
  letterSpacing: 'normal',
  tabSize: 4,
  textIndent: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  overflowY: 'auto',
  overflowX: 'hidden',
  scrollbarGutter: 'stable',
};
