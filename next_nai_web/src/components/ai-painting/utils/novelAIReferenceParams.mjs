import { isNovelAIV5Model, NOVELAI_V5_DEFAULT_PARAMS, NOVELAI_V5_MEDIUM_MODEL_ID } from './novelAIV5Params.mjs';

const V45_REFERENCE_MODELS = new Set([
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

const V45_REFERENCE_SIZES = [[1024, 1536], [1536, 1024], [1472, 1472]];
const V5_REFERENCE_SIZES = [[1024, 1024]];
for (let longSide = 1088; longSide <= 4096; longSide += 64) {
  const shortSide = Math.floor(1048576 / longSide / 64) * 64;
  // 官网从最窄到最宽依次选取，两个宽高比一样接近时使用靠前的尺寸。
  V5_REFERENCE_SIZES.unshift([shortSide, longSide]);
  V5_REFERENCE_SIZES.push([longSide, shortSide]);
}

/**
 * 计算精确参考图的输出尺寸和居中绘制区域。V5 裁剪铺满画布，V4.5 等比留黑边。
 * @param {number} width 原图像素宽度。
 * @param {number} height 原图像素高度。
 * @param {boolean} isV5 使用 V5 的参考图尺寸。
 * @returns {object} 画布宽高、图片绘制坐标和缩放后的宽高。
 */
export function getReferenceImageLayout(width, height, isV5) {
  const sizes = isV5 ? V5_REFERENCE_SIZES : V45_REFERENCE_SIZES;
  const ratio = width / height;
  let bestDistance = Infinity;
  let target = sizes[0];
  for (const size of sizes) {
    const aspect = size[0] / size[1];
    const distance = isV5 ? Math.abs(Math.log(ratio) - Math.log(aspect)) : Math.abs(ratio - aspect);
    if (distance < bestDistance) {
      bestDistance = distance;
      target = size;
    }
  }
  const [canvasWidth, canvasHeight] = target;
  const scale = (isV5 ? Math.max : Math.min)(canvasWidth / width, canvasHeight / height);
  const drawWidth = isV5 ? Math.max(canvasWidth, Math.round(width * scale)) : width * scale;
  const drawHeight = isV5 ? Math.max(canvasHeight, Math.round(height * scale)) : height * scale;
  return {
    canvasWidth, canvasHeight, drawWidth, drawHeight,
    x: isV5 ? -Math.floor((drawWidth - canvasWidth) / 2) : (canvasWidth - drawWidth) / 2,
    y: isV5 ? -Math.floor((drawHeight - canvasHeight) / 2) : (canvasHeight - drawHeight) / 2,
  };
}

/**
 * 从启用的参考图生成同序参数数组。缓存密钥生成期间仍可发送完整图片。
 * @param {Array<object>} images 当前模型面板的参考图。
 * @param {boolean} isV5 是否使用 V5 的默认强度和固定保真度。
 * @returns {object|null} 本站生成请求的参考图字段，没有启用的参考图时返回 null。
 */
export function buildDirectorReferenceParams(images, isV5) {
  const active = images.filter((image) => !image.disabled && image.data);
  if (!active.length) return null;
  return {
    director_reference_images_cached: active.map(({ data, cache_secret_key }) => ({
      data, ...(cache_secret_key && { cache_secret_key }),
    })),
    director_reference_descriptions: active.map((image) => ({
      caption: { base_caption: image.type || (isV5 ? 'character&style' : 'character'), char_captions: [] },
      legacy_uc: false,
    })),
    director_reference_strength_values: active.map((image) => image.strength ?? (isV5 ? 1 : 0.6)),
    director_reference_secondary_strength_values: active.map((image) => isV5 ? 0 : Number((1 - (image.fidelity ?? 1)).toFixed(2))),
    director_reference_information_extracted: active.map(() => 1),
  };
}

/**
 * 读取历史请求中第 index 张参考图的类型、强度与保真度，兼容简写和官方 caption。
 * @param {object} parameters 保存的生成请求。
 * @param {number} index 参考图在同组数组中的索引。
 * @returns {object} 可在编辑器中恢复的参考设置。
 */
export function readDirectorReferenceSettings(parameters, index) {
  const isV5 = isNovelAIV5Model(parameters.model);
  const description = parameters.director_reference_descriptions?.[index];
  const type = typeof description === 'string' ? description : description?.caption?.base_caption;
  return {
    type: type || (isV5 ? 'character&style' : 'character'),
    strength: parameters.director_reference_strength_values?.[index] ?? (isV5 ? 1 : 0.6),
    ...(!isV5 && { fidelity: 1 - (parameters.director_reference_secondary_strength_values?.[index] ?? 0) }),
  };
}

/**
 * 从旧分镜或作品请求里的平行数组恢复可编辑的参考卡片。
 * @param {object} parameters 缓存对象或官方 Base64 数组所在的旧参数。
 * @returns {Array<object>} 带预览、类型、强度和保真度的参考卡片。
 */
export function restoreRequestReferenceImages(parameters) {
  const images = parameters.director_reference_images_cached?.length
    ? parameters.director_reference_images_cached : parameters.director_reference_images || [];
  return images.map((image, index) => {
    const data = typeof image === 'string' ? image : image.data;
    return {
      id: `version-reference-${index}`, data,
      displayUrl: data.startsWith('data:') ? data : `data:image/png;base64,${data}`,
      ...readDirectorReferenceSettings(parameters, index), disabled: false, cache_secret_key: null,
    };
  });
}

/**
 * 按照官网，Medium 在当前操作可以使用参考图且面板内有图片时临时使用 High。
 * @param {string} preferred 用户选择的模型。
 * @param {number} referenceCount V5 面板内的图片总数，包括暂时停用的图片。
 * @param {boolean} unavailable 当前是否为不支持精确参考的操作。
 * @returns {string} 编辑面板、报价和最终生成使用的模型 ID。
 */
export function getModelForPreciseReferences(preferred, referenceCount, unavailable) {
  return preferred === NOVELAI_V5_MEDIUM_MODEL_ID && referenceCount > 0 && !unavailable
    ? 'nai-diffusion-5-full' : preferred;
}

/**
 * 切换实际生成模型时，恢复 High 的采样设置；Medium 的固定 14 步只用于 Medium。
 * @param {object} preferred 用户的模型偏好和当前画面设置。
 * @param {string} effectiveModel 根据参考图确定的实际生成模型。
 * @returns {object} 用于编辑器、费用估计和生成的设置。
 */
export function getEffectiveReferenceParams(preferred, effectiveModel) {
  if (preferred.model === effectiveModel) return preferred;
  const { steps, sampler, promptGuidanceRescale } = preferred.v5HighSettings || NOVELAI_V5_DEFAULT_PARAMS;
  return { ...preferred, model: effectiveModel, steps, sampler, promptGuidanceRescale };
}

/**
 * 判断模型是否支持上传角色／精准参考图。
 * @param {string} modelName 当前模型 ID。
 * @param {boolean} isInpaint 本次是否使用局部重绘。
 * @returns {boolean} V4.5 支持全部模式，V5 支持文生图与图生图。
 */
export const isNovelAIDirectorReferenceModel = (modelName, isInpaint = false) => (
  V45_REFERENCE_MODELS.has(modelName) || (!isInpaint && (modelName === 'nai-diffusion-5-full' || modelName === 'nai-diffusion-5-curated'))
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
    ...V45_REFERENCE_MODELS,
  ].includes(modelName))
);

/**
 * 用当前画框或已保存分镜的编辑态计算生成模型与可发送的参考图。
 * @param {object} preferred 用户选择的模型与采样设置。
 * @param {Array<object>} images 当前模型面板内所有参考图。
 * @param {Array<object>} vibes 画框内全部 Vibe。
 * @param {boolean} inpaint 是否启用局部重绘。
 * @param {boolean} directorTool 是否使用导演工具。
 * @returns {object} 实际生成设置、启用的参考参数与 Vibe 互斥状态。
 */
export function resolveWorkspaceReferences(preferred, images, vibes, inpaint, directorTool) {
  const model = getModelForPreciseReferences(preferred.model, images.length, inpaint || directorTool);
  const params = getEffectiveReferenceParams(preferred, model);
  const hasActiveVibes = isNovelAIVibeModel(model, inpaint) && vibes.some((vibe) => !vibe.isTemporarilyDisabled);
  const referenceParams = !directorTool && !hasActiveVibes && isNovelAIDirectorReferenceModel(model, inpaint)
    ? buildDirectorReferenceParams(images, isNovelAIV5Model(model)) : null;
  return { params, referenceParams, hasActiveVibes };
}

/**
 * 只从本次请求移除不支持或互斥的参考配置，保留用户面板中的原始设置。
 * @param {object} params 当前生成参数。
 * @param {boolean} isInpaint 是否启用重绘面板；其他入口按遮罩判断。
 * @returns {object} 可发送的参数副本，V4.5 角色参考与重绘可以共存。
 */
export const sanitizeNovelAIReferenceParams = (params, isInpaint = Boolean(params.imageToImage?.mask || params.mask)) => {
  if (!params.model?.startsWith('nai-diffusion-')) return params;
  const result = { ...params };
  if (!isNovelAIDirectorReferenceModel(params.model, isInpaint)) {
    NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS.forEach((key) => delete result[key]);
  }
  const hasReference = result.director_reference_images_cached?.length > 0
    || result.director_reference_images?.length > 0;
  if (!isNovelAIVibeModel(params.model, isInpaint) || hasReference) {
    VIBE_PARAM_KEYS.forEach((key) => delete result[key]);
  }
  return result;
};
