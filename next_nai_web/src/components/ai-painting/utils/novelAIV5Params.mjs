export const NOVELAI_V5_MODEL_IDS = Object.freeze([
  'nai-diffusion-5-curated',
  'nai-diffusion-5-full',
]);

const NOVELAI_V5_MODEL_ID_SET = new Set(NOVELAI_V5_MODEL_IDS);
export const NOVELAI_V5_CHARACTER_WARNING_THRESHOLD = 25;
export const NOVELAI_V5_STANDARD_MAX_STEPS = 23;
export const NOVELAI_V5_LARGE_MAX_STEPS = 50;

export const NOVELAI_V5_DEFAULT_PARAMS = Object.freeze({
  width: 832,
  height: 1216,
  guidanceScale: 7,
  sampler: 'k_euler_ancestral',
  steps: NOVELAI_V5_STANDARD_MAX_STEPS,
  batchSize: 1,
  promptGuidanceRescale: 0,
  noiseSchedule: 'karras',
  smea: false,
  dyn: false,
  autoSmea: false,
  prefer_brownian: true,
  deliberate_euler_ancestral_bug: false,
  legacy: false,
  legacy_uc: false,
  legacy_v3_extend: false,
  use_upscale_credits: false,
  characterPositionMode: 'ai',
});

const NOVELAI_V5_UNSUPPORTED_PARAM_KEYS = Object.freeze([
  'director_reference_images',
  'director_reference_images_cached',
  'director_reference_descriptions',
  'director_reference_strength_values',
  'director_reference_secondary_strength_values',
  'director_reference_information_extracted',
  'vibeTransfer',
  'reference_image_multiple',
  'reference_information_extracted_multiple',
  'reference_strength_multiple',
  'reference_image',
  'reference_information_extracted',
  'reference_strength',
]);

const LEGACY_CHARACTER_POSITION_CENTERS = Object.freeze({
  A1: { x: 0.1, y: 0.1 }, A2: { x: 0.1, y: 0.3 }, A3: { x: 0.1, y: 0.5 }, A4: { x: 0.1, y: 0.7 }, A5: { x: 0.1, y: 0.9 },
  B1: { x: 0.3, y: 0.1 }, B2: { x: 0.3, y: 0.3 }, B3: { x: 0.3, y: 0.5 }, B4: { x: 0.3, y: 0.7 }, B5: { x: 0.3, y: 0.9 },
  C1: { x: 0.5, y: 0.1 }, C2: { x: 0.5, y: 0.3 }, C3: { x: 0.5, y: 0.5 }, C4: { x: 0.5, y: 0.7 }, C5: { x: 0.5, y: 0.9 },
  D1: { x: 0.7, y: 0.1 }, D2: { x: 0.7, y: 0.3 }, D3: { x: 0.7, y: 0.5 }, D4: { x: 0.7, y: 0.7 }, D5: { x: 0.7, y: 0.9 },
  E1: { x: 0.9, y: 0.1 }, E2: { x: 0.9, y: 0.3 }, E3: { x: 0.9, y: 0.5 }, E4: { x: 0.9, y: 0.7 }, E5: { x: 0.9, y: 0.9 },
});

const normalizeCoordinate = (value, fallback) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.round(Math.min(1, Math.max(0, numericValue)) * 1000) / 1000;
};

/**
 * 判断当前模型是否为 NovelAI V5 模型。
 *
 * @param {unknown} modelName 待判断的完整模型 ID。
 * @returns {boolean} V5 Curated 或 V5 Full 返回 true。
 */
export const isNovelAIV5Model = (modelName) => (
  NOVELAI_V5_MODEL_ID_SET.has(String(modelName || ''))
);

/**
 * 移除旧缓存或外部参数中的负向提示词预设字段。
 *
 * @param {object} params 当前参数对象。
 * @returns {object} 不包含 ucPreset 与 ucPresetId 的新对象。
 */
export const removeNovelAIUCPresetParams = (params = {}) => {
  const sanitizedParams = { ...params };
  delete sanitizedParams.ucPreset;
  delete sanitizedParams.ucPresetId;
  return sanitizedParams;
};

/**
 * 将角色中心点规范为 NovelAI 使用的 0-1 坐标。
 *
 * @param {object|undefined} center 当前角色中心点。
 * @param {string} legacyPosition 旧版 A1-E5 位置，用于迁移已有角色卡。
 * @returns {{x:number,y:number}} 保留三位小数且位于 0-1 内的坐标。
 */
export const normalizeNovelAICharacterCenter = (center, legacyPosition = 'C3') => {
  const fallback = LEGACY_CHARACTER_POSITION_CENTERS[legacyPosition]
    || LEGACY_CHARACTER_POSITION_CENTERS.C3;
  return {
    x: normalizeCoordinate(center?.x, fallback.x),
    y: normalizeCoordinate(center?.y, fallback.y),
  };
};

/**
 * 构造 NovelAI V5 的角色控制参数，临时禁用的角色不会进入请求。
 *
 * @param {Array<object>} characterTabs 当前角色卡列表。
 * @param {boolean} useCoords 是否使用用户选择的自定义坐标。
 * @returns {object} 角色提示词、正负角色描述和坐标开关。
 */
export const buildNovelAIV5CharacterControl = (characterTabs = [], useCoords = false) => {
  const activeCharacterTabs = characterTabs.filter((tab) => tab.isTemporarilyDisabled !== true);
  const normalizedCharacters = activeCharacterTabs.map((tab) => ({
    prompt: tab.prompt || '',
    uc: tab.uc || '',
    center: normalizeNovelAICharacterCenter(tab.center, tab.position),
  }));

  return {
    characterPrompts: normalizedCharacters.map((character) => ({
      prompt: character.prompt,
      uc: character.uc,
      center: character.center,
      enabled: true,
    })),
    v4_prompt_char_captions: normalizedCharacters.map((character) => ({
      char_caption: character.prompt,
      centers: [character.center],
    })),
    v4_negative_prompt_char_captions: normalizedCharacters.map((character) => ({
      char_caption: character.uc,
      centers: [character.center],
    })),
    use_coords: Boolean(useCoords),
    enabledCharacterCount: normalizedCharacters.length,
    characterTabs,
  };
};

/**
 * 删除 NovelAI V5 当前不支持的角色参考与 Vibe 参数。
 *
 * @param {object} params 当前生成参数。
 * @returns {object} V5 返回净化后的新对象，其他模型保持原对象不变。
 */
export const sanitizeNovelAIV5GenerationParams = (params = {}) => {
  if (!isNovelAIV5Model(params.model)) {
    return params;
  }

  const sanitizedParams = removeNovelAIUCPresetParams(params);
  NOVELAI_V5_UNSUPPORTED_PARAM_KEYS.forEach((key) => delete sanitizedParams[key]);
  const steps = Number(params.steps);
  if (Number.isFinite(steps)) {
    const maxSteps = params.use_upscale_credits
      ? NOVELAI_V5_LARGE_MAX_STEPS
      : NOVELAI_V5_STANDARD_MAX_STEPS;
    sanitizedParams.steps = Math.min(steps, maxSteps);
  }
  return sanitizedParams;
};
