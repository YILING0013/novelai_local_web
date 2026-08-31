const NAI_JSON_KEYS = new Set([
  'prompt',
  'uc',
  'steps',
  'width',
  'height',
  'scale',
  'seed',
  'sampler',
  'noise_schedule',
  'cfg_rescale',
  'v4_prompt',
  'v4_negative_prompt',
]);

const VALUE_KEY_SCORE = {
  Comment: 100,
  parameters: 90,
  UserComment: 85,
  ImageDescription: 75,
  Description: 45,
  prompt: 40,
};

/**
 * 判断对象是否像 NovelAI 的参数 JSON。
 *
 * @param {unknown} value 待判断的对象。
 * @returns {boolean} 如果包含 NovelAI 常见字段则返回 true。
 */
const looksLikeNovelAIJson = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).some((key) => NAI_JSON_KEYS.has(key));
};

/**
 * 安全解析 JSON 字符串。
 *
 * @param {unknown} value 可能是 JSON 字符串的值。
 * @returns {object|null} 解析成功返回对象，否则返回 null。
 */
const tryParseJsonObject = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
};

/**
 * 将任意可用字段转换为有限数字。
 *
 * @param {unknown} value 原始字段值。
 * @returns {number|undefined} 可用数字或 undefined。
 */
const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

/**
 * 将字符串形式的布尔值归一化。
 *
 * @param {unknown} value 原始字段值。
 * @returns {boolean|undefined} 可用布尔值或 undefined。
 */
const toBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'off', '0'].includes(normalized)) {
      return false;
    }
  }

  return undefined;
};

/**
 * 把 NovelAI 的 0-1 坐标映射到项目现有的 A1-E5 位置。
 *
 * @param {number} x 横向坐标。
 * @param {number} y 纵向坐标。
 * @returns {string} 位置标记。
 */
const mapCoordinatesToPosition = (x, y) => {
  if (x === 0 && y === 0) {
    return 'C3';
  }

  const cols = ['A', 'B', 'C', 'D', 'E'];
  const rows = ['1', '2', '3', '4', '5'];
  const colIndex = Math.min(Math.max(Math.floor(x * cols.length), 0), cols.length - 1);
  const rowIndex = Math.min(Math.max(Math.floor(y * rows.length), 0), rows.length - 1);

  return cols[colIndex] + rows[rowIndex];
};

/**
 * 取出 NovelAI 角色控制中心点。
 *
 * @param {object} charCaption NovelAI 角色描述对象。
 * @returns {{x:number,y:number}|null} 可用中心点或 null。
 */
const getCharacterCenter = (charCaption) => {
  if (Array.isArray(charCaption.centers) && charCaption.centers.length > 0) {
    return charCaption.centers[0];
  }

  if (charCaption.center && typeof charCaption.center === 'object') {
    return charCaption.center;
  }

  return null;
};

/**
 * 从 NovelAI v4 caption 结构生成角色标签。
 *
 * @param {object} positiveCaption 正向角色 caption。
 * @param {object} negativeCaption 负向角色 caption。
 * @returns {Array<object>} UI 可直接使用的角色标签。
 */
const buildCharacterTabs = (positiveCaption, negativeCaption) => {
  const positiveChars = positiveCaption?.char_captions || [];
  const negativeChars = negativeCaption?.char_captions || [];

  if (!Array.isArray(positiveChars) || positiveChars.length === 0) {
    return [];
  }

  return positiveChars
    .map((charCaption, index) => {
      const center = getCharacterCenter(charCaption);
      const position = center && Number.isFinite(center.x) && Number.isFinite(center.y)
        ? mapCoordinatesToPosition(center.x, center.y)
        : 'C3';

      return {
        name: '',
        prompt: charCaption.char_caption || charCaption.prompt || '',
        uc: negativeChars[index]?.char_caption || negativeChars[index]?.uc || '',
        position,
        ...(center && Number.isFinite(center.x) && Number.isFinite(center.y)
          ? { center: { x: center.x, y: center.y } }
          : {}),
        colorId: index % 6,
      };
    })
    .filter((tab) => tab.prompt || tab.uc);
};

/**
 * 将 stealth 顶层 Comment 字符串展开成 NovelAI 参数对象。
 *
 * @param {object} jsonData 原始 JSON 对象。
 * @returns {object} 展开后的参数对象。
 */
const unwrapNovelAIComment = (jsonData) => {
  if (looksLikeNovelAIJson(jsonData)) {
    return jsonData;
  }

  const commentJson = tryParseJsonObject(jsonData?.Comment);
  if (commentJson) {
    return {
      ...commentJson,
      __outerMetadata: jsonData,
    };
  }

  return jsonData;
};

/**
 * 解析 NovelAI JSON 元数据为项目 UI 参数。
 *
 * @param {object} jsonData NovelAI 原始参数对象。
 * @returns {object|null} 解析后的 UI 参数，失败时返回 null。
 */
const parseNovelAIMetadata = (jsonData) => {
  if (!jsonData || typeof jsonData !== 'object' || Array.isArray(jsonData)) {
    return null;
  }

  const source = unwrapNovelAIComment(jsonData);
  if (!looksLikeNovelAIJson(source)) {
    return null;
  }

  const positiveCaption = source.v4_prompt?.caption;
  const negativeCaption = source.v4_negative_prompt?.caption;
  const parameters = {
    originalMetadata: jsonData,
  };

  if (source.prompt !== undefined) parameters.positivePrompt = source.prompt;
  if (source.uc !== undefined) parameters.negativePrompt = source.uc;
  if (!parameters.positivePrompt && positiveCaption?.base_caption) {
    parameters.positivePrompt = positiveCaption.base_caption;
  }
  if (!parameters.negativePrompt && negativeCaption?.base_caption) {
    parameters.negativePrompt = negativeCaption.base_caption;
  }

  const numericMappings = [
    ['steps', 'steps'],
    ['width', 'width'],
    ['height', 'height'],
    ['scale', 'guidanceScale'],
    ['cfg_rescale', 'promptGuidanceRescale'],
    ['cfgRescale', 'promptGuidanceRescale'],
    ['prompt_guidance_rescale', 'promptGuidanceRescale'],
  ];

  numericMappings.forEach(([sourceKey, targetKey]) => {
    const value = toFiniteNumber(source[sourceKey]);
    if (value !== undefined) {
      parameters[targetKey] = value;
    }
  });

  if (source.seed !== undefined && source.seed !== null && source.seed !== '') {
    parameters.seed = source.seed;
  }
  if (source.sampler !== undefined) parameters.sampler = source.sampler;
  if (source.noise_schedule !== undefined) parameters.noiseSchedule = source.noise_schedule;
  if (source.noiseSchedule !== undefined) parameters.noiseSchedule = source.noiseSchedule;

  const smea = source.sm !== undefined ? toBoolean(source.sm) : toBoolean(source.smea);
  const dyn = source.sm_dyn !== undefined ? toBoolean(source.sm_dyn) : toBoolean(source.dyn);
  if (smea !== undefined) parameters.smea = smea;
  if (dyn !== undefined) parameters.dyn = dyn;

  const characterTabs = buildCharacterTabs(positiveCaption, negativeCaption);
  if (characterTabs.length > 0) {
    parameters.characterTabs = characterTabs;
  }

  return parameters;
};

/**
 * 清理 EXIF UserComment 中常见的编码前缀和空字符。
 *
 * @param {unknown} value EXIF 原始值或描述。
 * @returns {string} 可用于解析的文本。
 */
const normalizeExifText = (value) => {
  let text = '';

  if (Array.isArray(value)) {
    text = String.fromCodePoint(...value.filter((item) => Number.isInteger(item) && item >= 0));
  } else if (value && typeof value === 'object' && 'description' in value) {
    text = normalizeExifText(value.description);
  } else if (value && typeof value === 'object' && 'value' in value) {
    text = normalizeExifText(value.value);
  } else if (value !== undefined && value !== null) {
    text = String(value);
  }

  return text
    .replace(/\u0000/g, '')
    .replace(/^(ASCII|UNICODE|JIS)\s*/i, '')
    .trim();
};

/**
 * 计算解析结果的信息量，用于多来源候选排序。
 *
 * @param {object|null} metadata 解析后的 UI 参数。
 * @returns {number} 信息量分数。
 */
const scoreMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') {
    return 0;
  }

  let score = 0;
  if (metadata.positivePrompt) score += 10;
  if (metadata.negativePrompt) score += 8;
  if (metadata.width && metadata.height) score += 8;
  ['steps', 'guidanceScale', 'seed', 'sampler', 'noiseSchedule', 'promptGuidanceRescale'].forEach((key) => {
    if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '') {
      score += 4;
    }
  });
  if (metadata.smea !== undefined) score += 2;
  if (metadata.dyn !== undefined) score += 2;
  if (Array.isArray(metadata.characterTabs) && metadata.characterTabs.length > 0) {
    score += 8 + metadata.characterTabs.length;
  }

  return score;
};

/**
 * 解析单个候选文本或对象。
 *
 * @param {{keyword?:string,text?:unknown,value?:unknown}} candidate 元数据候选。
 * @returns {object|null} 解析后的 UI 参数。
 */
const parseMetadataCandidate = (candidate) => {
  const rawValue = candidate?.text ?? candidate?.value;
  const jsonValue = typeof rawValue === 'object' && rawValue !== null
    ? rawValue
    : tryParseJsonObject(normalizeExifText(rawValue));

  // 本地版只接受 NovelAI 参数 JSON，不再兼容其它生成器的 infotext。
  const novelAIResult = jsonValue ? parseNovelAIMetadata(jsonValue) : null;
  if (novelAIResult) {
    return novelAIResult;
  }
  return null;
};

/**
 * 从多个来源候选中选出信息最完整的元数据。
 *
 * @param {Array<{keyword?:string,text?:unknown,value?:unknown,weight?:number}>} candidates 候选列表。
 * @returns {object|null} 最适合应用到 UI 的参数。
 */
const parseMetadataCandidates = (candidates) => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  let best = null;

  candidates.forEach((candidate, index) => {
    const parsed = parseMetadataCandidate(candidate);
    const metadataScore = scoreMetadata(parsed);
    if (!parsed || metadataScore === 0) {
      return;
    }

    const keyScore = VALUE_KEY_SCORE[candidate.keyword] || 0;
    const weight = candidate.weight || 0;
    const totalScore = metadataScore + keyScore + weight - index * 0.01;

    if (!best || totalScore > best.totalScore) {
      best = { parsed, totalScore };
    }
  });

  return best?.parsed || null;
};

module.exports = {
  normalizeExifText,
  parseMetadataCandidate,
  parseMetadataCandidates,
  parseNovelAIMetadata,
  scoreMetadata,
};
