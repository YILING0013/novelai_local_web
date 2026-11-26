const normalize = value => value.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, '_');

export const DEFAULT_PROMPT_SYNTAX = Object.freeze({
  enabled: true, category: '+', exact: '=', fuzzy: '?', regex: '*',
});

/**
 * 打开词屿二进制索引，分类导航留在后台线程，数十万条词条交给 WASM 过滤与排序。
 * @param {Uint8Array} bytes 解压后的完整词库。
 * @param {Function} TagCatalog 已实例化的 WASM 词库构造器。
 * @returns {Function} 接受查询词、显示条数和语法设置的同步后台查询。
 */
export function openPromptCatalog(bytes, TagCatalog) {
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.subarray(0, 8)) !== 'CIYU-T01') throw new Error('invalid_catalog');
  const end = 12 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  const topics = JSON.parse(decoder.decode(bytes.subarray(12, end))).map(([key, parent, label, pinyin, initials], i) => {
    const shortKey = key.split('/').at(-1);
    return { key, parent, id: i + 1, label, shortKey, fields: [normalize(label), shortKey, pinyin, initials] };
  });
  const catalog = new TagCatalog(bytes.subarray(end));
  const byKey = new Map(topics.map(topic => [topic.key, topic]));
  const byLabel = new Map();
  for (const topic of topics) {
    for (const alias of new Set([topic.fields[0], topic.shortKey])) {
      if (!byLabel.has(alias)) byLabel.set(alias, []);
      byLabel.get(alias).push(topic);
    }
  }
  return (text, limit, syntax = DEFAULT_PROMPT_SYNTAX) => {
    const { category, exact, fuzzy, regex } = syntax;
    let rest = text.trim();
    let scope = 0;
    let mode = 'text';
    if (syntax.enabled && rest.startsWith(category)) {
      rest = rest.slice(category.length);
      const stops = [rest.indexOf(exact), rest.indexOf(fuzzy)].filter(i => i >= 0);
      const boundary = stops.length ? Math.min(...stops) : rest.length;
      const path = rest.slice(0, boundary).split(category);
      const listing = boundary === rest.length;
      const partial = listing ? normalize(path.pop()) : '';
      if (!listing && path.at(-1) === '') path.pop();
      const prefix = [];
      for (const part of path) {
        const name = normalize(part);
        const key = byKey.get(name) ?? (/^\d+$/.test(name) ? topics[Number(name) - 1] : null);
        const matches = key ? [key] : (byLabel.get(name) ?? []);
        const topic = matches.find(item => !scope || item.parent === scope);
        if (!topic) return [];
        scope = topic.id;
        prefix.push(part);
      }
      if (listing) {
        const matches = [];
        for (const topic of topics) {
          // 裸 + 展示一级类别；直接输入作品名时允许省略“作品 / IP”一级。
          if ((scope || !partial) && topic.parent !== scope) continue;
          const score = !partial ? 1 : topic.fields.some(s => s === partial) ? 3
            : topic.fields.some(s => s.startsWith(partial)) ? 2 : topic.fields.some(s => s.includes(partial)) ? 1 : 0;
          if (score) matches.push({ topic, score });
        }
        return matches.sort((a, b) => b.score - a.score).slice(0, limit).map(({ topic }) => {
          // 同名类别用完整分类键回填，避免下一次查询走进另一个同名作品。
          const ambiguous = byLabel.get(topic.fields[0]).length > 1;
          const usable = s => !/[,，\r\n[\]{}]/.test(s) && ![category, exact, fuzzy].some(symbol => s.includes(symbol));
          const label = !ambiguous && usable(topic.label) ? topic.label : usable(topic.key) ? topic.key : String(topic.id);
          const completion = category + [...prefix, label].join(category) + (topic.parent ? exact : category);
          return { kind: 'category', name: topic.label, translation: topic.shortKey, completion };
        });
      }
      rest = rest.slice(boundary);
    }
    if (syntax.enabled && rest.startsWith(exact)) {
      rest = rest.slice(exact.length);
      if (rest.startsWith(regex)) { mode = 'regex'; rest = rest.slice(regex.length); }
      else if (rest.startsWith(fuzzy)) { mode = 'fuzzy'; rest = rest.slice(fuzzy.length); }
    } else if (syntax.enabled && rest.startsWith(fuzzy)) {
      mode = 'fuzzy'; rest = rest.slice(fuzzy.length);
    }
    if (!rest && (!scope || mode !== 'text')) return [];
    const query = mode === 'regex' ? rest : normalize(rest);
    return JSON.parse(catalog.search(query, scope, mode, limit)).map(([name, translation]) => (
      { kind: 'tag', name, translation }
    ));
  };
}
