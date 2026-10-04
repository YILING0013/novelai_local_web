/**
 * 按逗号找出可以查询翻译的标签，保留原始文本位置以免预览改动空格、权重或换行。
 * @param {string} text 一段不含注释或随机标签的提示词。
 * @returns {Array<{start: number, end: number, key: string}>} 标签范围及与 CSV 对应的规范名称。
 */
export function getPreviewTagRanges(text) {
  const tags = [];
  const parts = text.matchAll(/[^,，]+/g);
  for (const part of parts) {
    const leading = part[0].match(/^(?:\s|[\[{]|[+-]?(?:\d+(?:\.\d+)?|\.\d+)::)*/)[0].length;
    const trailing = part[0].match(/(?:\s|[\]}]|::)*$/)[0].length;
    const start = part.index + leading;
    const end = part.index + part[0].length - trailing;
    if (start >= end) continue;
    const key = text.slice(start, end).replaceAll('_', ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    // 长段自然语言不可能对应词库标签，也不能让整批正常标签因接口长度限制而失败。
    if (!key || key.length > 500) continue;
    tags.push({ start, end, key });
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
