/**
 * 将 NovelAI 提示词拆为带有效权重的标签，保留括号中的名称和转义逗号。
 * @param {string} prompt 原始提示词。
 * @returns {Array<{name: string, weight: number}>} 顺序与重复标签均保留的结果。
 */
export function promptTokens(prompt = '') {
  const tokens = [];
  const pieces = [];
  let text = '';
  let parentheses = 0;
  let numericWeight = 1;
  let bracketLevel = 0;
  const flushPiece = () => {
    if (text) pieces.push({ text, weight: numericWeight * 1.05 ** Math.max(-256, Math.min(256, bracketLevel)) });
    text = '';
  };
  const flushTag = () => {
    flushPiece();
    const name = pieces.map((item) => item.text).join('').trim();
    const length = pieces.reduce((sum, item) => sum + item.text.trim().length, 0);
    if (name && length) tokens.push({ name, weight: Number((pieces.reduce((sum, item) => sum + item.weight * item.text.trim().length, 0) / length).toFixed(6)) });
    pieces.length = 0;
  };
  for (let i = 0; i < prompt.length; i += 1) {
    if (prompt[i] === '\\' && i + 1 < prompt.length) { text += prompt[i + 1]; i += 1; continue; }
    if (prompt.startsWith('/*', i)) { const end = prompt.indexOf('*/', i + 2); i = end < 0 ? prompt.length : end + 1; continue; }
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)::/.exec(prompt.slice(i));
    if (numeric && !parentheses) { flushPiece(); numericWeight = Math.max(-1e6, Math.min(1e6, Number(numeric[0].slice(0, -2)))); bracketLevel = 0; i += numeric[0].length - 1; }
    else if (prompt.startsWith('::', i) && !parentheses) { flushPiece(); numericWeight = 1; bracketLevel = 0; i += 1; }
    else if (!parentheses && '{}[]'.includes(prompt[i])) { flushPiece(); bracketLevel += '{]'.includes(prompt[i]) ? 1 : -1; }
    else if (!parentheses && /[,，\n\r]/.test(prompt[i])) flushTag();
    else { if (prompt[i] === '(') parentheses += 1; if (prompt[i] === ')') parentheses = Math.max(0, parentheses - 1); text += prompt[i]; }
  }
  flushTag();
  return tokens;
}

/**
 * 对比标签增删和有效权重变化；全文由界面同时展示，顺序改动不会丢失。
 * @param {string} before 对比前提示词。
 * @param {string} after 对比后提示词。
 * @returns {object} 新增、删除和权重改变的标签。
 */
export function diffPrompts(before = '', after = '') {
  const remaining = promptTokens(before);
  const added = [];
  const changed = [];
  const unmatched = [];
  // 先抵消完全相同的重复标签，避免先遇到的改权重标签抢走后面的原值。
  for (const token of promptTokens(after)) {
    const index = remaining.findIndex((old) => old.name === token.name && old.weight === token.weight);
    if (index < 0) unmatched.push(token); else remaining.splice(index, 1);
  }
  for (const token of unmatched) {
    const index = remaining.findIndex((old) => old.name === token.name);
    if (index < 0) added.push(token);
    else { const [old] = remaining.splice(index, 1); if (old.weight !== token.weight) changed.push({ name: token.name, before: old.weight, after: token.weight }); }
  }
  return { added, removed: remaining, changed };
}

/**
 * 按词与标点生成能还原原文的行内差异，空白和 NovelAI 权重语法均不丢失。
 * @param {string} before 父节点或对照节点的原文。
 * @param {string} after 当前节点的原文。
 * @returns {Array<{kind: string, text: string}>} 相同、删除和新增片段。
 */
export function diffPromptText(before = '', after = '') {
  const tokenize = (text) => String(text).match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
  const left = tokenize(before), right = tokenize(after);
  // 两行动态规划寻找公共词序列；长提示词也不分配整张二维矩阵。
  const lengths = (a, b) => {
    let previous = new Uint32Array(b.length + 1);
    for (const word of a) {
      const current = new Uint32Array(b.length + 1);
      for (let j = 0; j < b.length; j += 1) current[j + 1] = word === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], current[j]);
      previous = current;
    }
    return previous;
  };
  const commonWords = (a, b) => {
    if (!a.length || !b.length) return [];
    if (a.length === 1) return b.includes(a[0]) ? [a[0]] : [];
    const middle = Math.floor(a.length / 2);
    const front = lengths(a.slice(0, middle), b);
    const back = lengths(a.slice(middle).reverse(), [...b].reverse());
    let split = 0;
    for (let j = 1; j <= b.length; j += 1) if (front[j] + back[b.length - j] > front[split] + back[b.length - split]) split = j;
    return [...commonWords(a.slice(0, middle), b.slice(0, split)), ...commonWords(a.slice(middle), b.slice(split))];
  };
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const common = [...left.slice(0, prefix), ...commonWords(left.slice(prefix, left.length - suffix), right.slice(prefix, right.length - suffix)), ...left.slice(left.length - suffix)];
  const result = [];
  const append = (kind, words) => {
    const text = words.join('');
    if (!text) return;
    if (result.at(-1)?.kind === kind) result[result.length - 1].text += text;
    else result.push({ kind, text });
  };
  let i = 0, j = 0;
  for (const word of common) {
    const oldIndex = left.indexOf(word, i), newIndex = right.indexOf(word, j);
    append('removed', left.slice(i, oldIndex)); append('added', right.slice(j, newIndex)); append('equal', [word]);
    i = oldIndex + 1; j = newIndex + 1;
  }
  append('removed', left.slice(i)); append('added', right.slice(j));
  return result;
}

/**
 * 按字段路径对比参数与角色数组，忽略对象属性书写顺序。
 * @param {object} before 旧参数。
 * @param {object} after 新参数。
 * @returns {Array<{path: string, before: unknown, after: unknown}>} 有实际变化的字段。
 */
export function diffParameters(before = {}, after = {}) {
  const changes = [];
  const equal = (left, right) => left === right || (left && right && typeof left === 'object' && typeof right === 'object'
    && Array.isArray(left) === Array.isArray(right) && Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key])));
  const aliases = {
    prompt: 'positivePrompt', input: 'positivePrompt', uc: 'negativePrompt', negative_prompt: 'negativePrompt', scale: 'guidanceScale', noise_schedule: 'noiseSchedule', cfg_rescale: 'promptGuidanceRescale',
    'v4_prompt.caption.base_caption': 'positivePrompt', 'v4_negative_prompt.caption.base_caption': 'negativePrompt',
    'v4_prompt.use_coords': 'use_coords', 'v4_negative_prompt.use_coords': 'use_coords', 'characterControl.use_coords': 'use_coords', 'characterControl.aiDecidePosition': 'aiDecidePosition',
  };
  const represented = (parameters, path, value) => {
    if (value === undefined) return true;
    // 导演工具的 prompt 是表情或上色指令，不是主正向提示词的别名。
    if (path === 'prompt' && ['emotion', 'colorize'].includes(parameters.req_type)) return false;
    if (aliases[path]) return Object.hasOwn(parameters, aliases[path]);
    const tabs = parameters.characterTabs;
    if (!Array.isArray(tabs)) return false;
    if (path === 'characterControl.enabledCharacterCount') return true;
    // 只隐藏规范角色中确实存在的同一字段；未知属性和额外中心点仍参与比较。
    const copiedTab = /^characterControl\.characterTabs\.(\d+)\.(.+)$/.exec(path);
    let tab = copiedTab ? tabs[Number(copiedTab[1])] : null;
    let field = copiedTab?.[2];
    const character = /^(?:characterControl\.)?(characterPrompts|v4_prompt_char_captions|v4_negative_prompt_char_captions)\.(\d+)\.(.+)$/.exec(path)
      || /^(v4_prompt|v4_negative_prompt)\.caption\.char_captions\.(\d+)\.(.+)$/.exec(path);
    if (character) {
      tab = tabs.filter((item) => item.isTemporarilyDisabled !== true)[Number(character[2])];
      field = character[3];
      if (field === 'char_caption') field = character[1].includes('negative') ? 'uc' : 'prompt';
      else if (field === 'positivePrompt') field = 'prompt';
      else if (field === 'negativePrompt' || field === 'negative_prompt') field = 'uc';
      else if (field.startsWith('centers.0.')) field = field.replace('centers.0.', 'center.');
      else if (field === 'enabled') return Boolean(tab) && value === true;
    }
    if (tab && field && (value === null || typeof value !== 'object')) {
      let current = tab;
      for (const key of field.split('.')) {
        if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return false;
        current = current[key];
      }
      return true;
    }
    // 空的角色副本没有叶子字段，规范角色数组已经表达它的含义。
    return Array.isArray(value) && value.length === 0 && /^(?:(?:characterControl\.)?(?:characterPrompts|characterTabs|v4_prompt_char_captions|v4_negative_prompt_char_captions)|v4_(?:negative_)?prompt\.caption\.char_captions)$/.test(path) && path !== 'characterTabs';
  };
  const mediaKeys = new Set(['image', 'mask', 'reference_image_multiple', 'reference_image', 'director_reference_images', 'director_reference_images_cached', 'reference_image_multiple_cached']);
  const visit = (left, right, path) => {
    if (left === right) return;
    if (/^(?:characterControl\.)?(?:characterTabs|characterPrompts)\.\d+\.colorId$/.test(path)) return;
    if (represented(before, path, left) && represented(after, path, right)) return;
    // 参考图及遮罩只报告有无变化，避免把大块图片编码放进界面。
    if (mediaKeys.has(path.split('.').at(-1)) || (typeof left === 'string' && left.startsWith('data:image/')) || (typeof right === 'string' && right.startsWith('data:image/'))) {
      if (!equal(left, right)) changes.push({ path, media: true });
      return;
    }
    const leftObject = left !== null && typeof left === 'object';
    const rightObject = right !== null && typeof right === 'object';
    if ((leftObject && rightObject && Array.isArray(left) === Array.isArray(right)) || (leftObject && right == null) || (rightObject && left == null)) {
      const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
      // 导入图与生成请求经常只有一侧含原始 caption；逐叶比较才能去重并保留未知字段。
      if (keys.size) for (const key of keys) visit(left?.[key], right?.[key], path ? `${path}.${key}` : key);
      else if (!equal(left, right)) changes.push({ path, before: left, after: right });
    } else changes.push({ path, before: left, after: right });
  };
  // 编辑快照中的参考图由图片卡片专门比较，避免重复参数和大段编码进入文本差异。
  const { positivePrompt: ignoredBefore, negativePrompt: ignoredNegativeBefore, version_context: ignoredContextBefore, editor_state: ignoredEditorBefore, ...oldParams } = before;
  const { positivePrompt: ignoredAfter, negativePrompt: ignoredNegativeAfter, version_context: ignoredContextAfter, editor_state: ignoredEditorAfter, ...newParams } = after;
  visit(oldParams, newParams, '');
  return changes;
}
