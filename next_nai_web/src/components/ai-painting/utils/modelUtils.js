import {
  NOVELAI_V5_MODEL_IDS,
  isNovelAIV5Model,
} from './novelAIV5Params.mjs';

export {
  NOVELAI_V5_CHARACTER_WARNING_THRESHOLD,
  NOVELAI_V5_DEFAULT_PARAMS,
  NOVELAI_V5_LARGE_MAX_STEPS,
  NOVELAI_V5_MODEL_IDS,
  NOVELAI_V5_STANDARD_MAX_STEPS,
  buildNovelAIV5CharacterControl,
  isNovelAIV5Model,
  normalizeNovelAICharacterCenter,
  removeNovelAIUCPresetParams,
  sanitizeNovelAIV5GenerationParams,
} from './novelAIV5Params.mjs';

export const DEFAULT_PAINTING_MODEL_ID = 'nai-diffusion-4-full';

export const SUPPORTED_PAINTING_MODEL_IDS = Object.freeze([
  ...NOVELAI_V5_MODEL_IDS,
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
  'nai-diffusion-4-full',
  'nai-diffusion-4-curated-preview',
  'nai-diffusion-3',
  'nai-diffusion-furry-3',
]);

const SUPPORTED_PAINTING_MODEL_ID_SET = new Set(SUPPORTED_PAINTING_MODEL_IDS);

/**
 * 判断模型是否属于本地版支持的 NovelAI 绘图模型。
 *
 * Args:
 *   modelName: 待校验的模型 ID。
 * Returns:
 *   boolean: 模型可提交时返回 true。
 */
export const isPaintingModelAllowed = (modelName) => {
  const normalizedModel = String(modelName || '');
  return SUPPORTED_PAINTING_MODEL_ID_SET.has(normalizedModel);
};

const NOVELAI_DIRECTOR_REFERENCE_MODELS = new Set([
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
]);

export const NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS = Object.freeze([
  'director_reference_images_cached',
  'director_reference_descriptions',
  'director_reference_strength_values',
  'director_reference_secondary_strength_values',
  'director_reference_information_extracted',
]);

/**
 * 将模型 ID 规范为当前前端公开支持的绘图模型，避免旧缓存或外部参数继续提交已下线模型。
 *
 * Args:
 *   modelName: 待校验的模型 ID。
 *   fallbackModel: 校验失败时使用的回退模型 ID。
 *
 * Returns:
 *   string: 当前支持的模型 ID；输入与回退值都无效时返回默认绘图模型。
 *
 * @param {unknown} modelName - 待校验的模型 ID。
 * @param {unknown} fallbackModel - 校验失败时使用的回退模型 ID。
 * @returns {string} 当前前端支持的模型 ID。
 */
export const normalizePaintingModelId = (
  modelName,
  fallbackModel = DEFAULT_PAINTING_MODEL_ID,
) => {
  const normalizedModel = String(modelName || '');
  if (SUPPORTED_PAINTING_MODEL_ID_SET.has(normalizedModel)) {
    return normalizedModel;
  }

  const normalizedFallback = String(fallbackModel || '');
  return SUPPORTED_PAINTING_MODEL_ID_SET.has(normalizedFallback)
    ? normalizedFallback
    : DEFAULT_PAINTING_MODEL_ID;
};

/**
 * 判断模型是否支持 NovelAI 角色参考（Director Reference）。
 *
 * Args:
 *   modelName: 待判断的完整模型 ID。
 *
 * Returns:
 *   boolean: 仅 NAI Diffusion 4.5 Full 与 Curated 返回 true。
 *
 * @param {unknown} modelName - 待判断的模型 ID。
 * @returns {boolean} 返回模型是否允许角色参考。
 */
export const isNovelAIDirectorReferenceModel = (modelName) => (
  NOVELAI_DIRECTOR_REFERENCE_MODELS.has(String(modelName || ''))
);

/**
 * 判断 NovelAI 图像模型是否属于 V4 或更高版本。
 *
 * Args:
 *   modelName: NovelAI 模型名称，例如 "nai-diffusion-4-5-full"。
 *
 * Returns:
 *   当模型是 NovelAI Diffusion V4、V4.5 或后续主版本时返回 true，否则返回 false。
 */
export const isNovelAIV4OrAboveModel = (modelName) => {
  const match = String(modelName || '').match(/^nai-diffusion-(?:[a-z]+-)*(\d+)(?:-\d+)?(?:-|$)/i);

  if (!match) {
    return false;
  }

  const majorVersion = Number.parseInt(match[1], 10);
  return Number.isFinite(majorVersion) && majorVersion >= 4;
};

/**
 * 判断当前 NovelAI 模型是否支持 Vibe。
 *
 * Args:
 *   modelName: 待判断的完整模型 ID。
 *
 * Returns:
 *   boolean: 当前仅 V5 返回 false，其他 NovelAI 绘图模型返回 true。
 *
 * @param {unknown} modelName - 待判断的模型 ID。
 * @returns {boolean} 返回模型是否允许 Vibe。
 */
export const isNovelAIVibeModel = (modelName) => (
  String(modelName || '').startsWith('nai-diffusion-')
  && !isNovelAIV5Model(modelName)
);

/**
 * 按模型兼容性修正 NovelAI 的 SMEA 相关参数。
 *
 * Args:
 *   params: 当前生成参数对象。
 *
 * Returns:
 *   V4 及以上模型会返回将 smea、dyn、autoSmea 固定为 false 的新对象；其他模型返回原对象。
 */
export const normalizeNovelAISmeaParams = (params = {}) => {
  if (!isNovelAIV4OrAboveModel(params.model)) {
    return params;
  }

  // 官方 V4+ 模型不支持 SMEA / SMEA DYN，自动 SMEA 也必须同步关闭。
  return {
    ...params,
    smea: false,
    dyn: false,
    autoSmea: false,
  };
};
