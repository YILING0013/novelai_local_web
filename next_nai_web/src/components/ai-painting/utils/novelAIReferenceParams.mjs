const DIRECTOR_REFERENCE_MODELS = new Set([
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
]);

export const NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS = Object.freeze([
  'director_reference_images',
  'director_reference_images_cached',
  'director_reference_descriptions',
  'director_reference_strength_values',
  'director_reference_secondary_strength_values',
  'director_reference_information_extracted',
]);

const VIBE_PARAM_KEYS = [
  'vibeTransfer',
  'reference_image_multiple',
  'reference_strength_multiple',
  'reference_information_extracted_multiple',
  'reference_image',
  'reference_strength',
  'reference_information_extracted',
];

/**
 * 判断模型是否支持上传角色／精准参考图。
 * @param {string} modelName 当前模型 ID。
 * @returns {boolean} 仅 V4.5 模型支持。
 */
export const isNovelAIDirectorReferenceModel = (modelName) => (
  DIRECTOR_REFERENCE_MODELS.has(modelName)
);

/**
 * 判断当前模型和工作模式是否允许发送 Vibe。
 * @param {string} modelName 当前模型 ID。
 * @param {boolean} isInpaint 是否启用局部重绘。
 * @returns {boolean} V3 保留原有支持，V4／V4.5 仅在非重绘模式支持。
 */
export const isNovelAIVibeModel = (modelName, isInpaint = false) => (
  modelName === 'nai-diffusion-3'
  || modelName === 'nai-diffusion-furry-3'
  || (!isInpaint && [
    'nai-diffusion-4-curated-preview',
    'nai-diffusion-4-full',
    ...DIRECTOR_REFERENCE_MODELS,
  ].includes(modelName))
);

/**
 * 只从本次请求移除不支持或互斥的参考配置，保留用户面板中的原始设置。
 * @param {object} params 当前生成参数。
 * @param {boolean} isInpaint 是否启用重绘面板；其他入口按遮罩判断。
 * @returns {object} 可发送的参数副本，V4.5 角色参考与重绘可以共存。
 */
export const sanitizeNovelAIReferenceParams = (params, isInpaint = Boolean(params.imageToImage?.mask)) => {
  if (!params.model?.startsWith('nai-diffusion-')) return params;
  const result = { ...params };
  if (!isNovelAIDirectorReferenceModel(params.model)) {
    NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS.forEach((key) => delete result[key]);
  }
  const hasReference = result.director_reference_images_cached?.length > 0
    || result.director_reference_images?.length > 0;
  if (!isNovelAIVibeModel(params.model, isInpaint) || hasReference) {
    VIBE_PARAM_KEYS.forEach((key) => delete result[key]);
  }
  return result;
};
