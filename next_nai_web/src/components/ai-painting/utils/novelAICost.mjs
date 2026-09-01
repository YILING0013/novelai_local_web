const BASE_PIXEL_COEFFICIENT = 2.951823174884865e-6;
const STEP_PIXEL_COEFFICIENT = 5.753298233447344e-7;
export const NOVELAI_MAX_ANLAS_PER_IMAGE = 140;

const V5_MODEL_FAMILY = new Set([
  'nai-diffusion-5-curated',
  'nai-diffusion-5-curated-inpainting',
  'nai-diffusion-5-full',
  'nai-diffusion-5-full-inpainting',
]);

/**
 * 判断一个预计成本是否应在生成按钮中展示，0 是有效成本，负值和空状态不是。
 *
 * @param {unknown} cost 预计单张 Anlas。
 * @returns {boolean} 可展示时返回 true。
 */
export const isDisplayableNovelAICost = (cost) => Number.isFinite(cost) && cost >= 0;

/**
 * 按 NovelAI 当前网页公式估算一次图像请求的 Anlas 点数。
 *
 * @param {object} options 生成尺寸、步数、模型与编辑强度。
 * @returns {number} 总点数；单张超过官方 140 点上限时返回 -3。
 */
export const calculateNovelAIImageCost = ({
  model,
  width,
  height,
  steps,
  enableSmea = false,
  enableSmeaDyn = false,
  hasImage = false,
  hasMask = false,
  strength = 1,
  inpaintImg2ImgStrength = 1,
}) => {
  const resolution = Number(width) * Number(height);
  const baseCost = Math.ceil(
    (BASE_PIXEL_COEFFICIENT * resolution)
    + (STEP_PIXEL_COEFFICIENT * resolution * Number(steps)),
  );
  const smeaFactor = enableSmea ? (enableSmeaDyn ? 1.4 : 1.2) : 1;
  const modelFactor = V5_MODEL_FAMILY.has(model) ? 1.5 : 1;
  const editStrength = hasMask
    ? Number(inpaintImg2ImgStrength ?? 1)
    : (hasImage ? Number(strength) : 1);
  const perImageCost = Math.max(
    Math.ceil(baseCost * smeaFactor * modelFactor * editStrength),
    2,
  );

  if (perImageCost > NOVELAI_MAX_ANLAS_PER_IMAGE) return -3;
  return perImageCost;
};

/**
 * 计算界面应展示的单张与连续生成预计 Anlas 消耗。
 *
 * @param {object} options 生成参数、官方订阅状态与连续生成数量。
 * @returns {{rawPerImage: number, perImage: number, total: number|null, count: number, subscriptionFree: boolean}}
 *   原始单张成本、实际单张成本、本批总成本、数量及是否命中订阅小图免费条件。
 */
export const estimateNovelAIGenerationCost = ({
  subscriptionActive = false,
  useUpscaleCredits = false,
  batchSize = 1,
  ...imageOptions
}) => {
  const rawPerImage = calculateNovelAIImageCost(imageOptions);
  const count = Math.max(1, Math.trunc(Number(batchSize)) || 1);

  if (rawPerImage === -3) {
    return {
      rawPerImage,
      perImage: -3,
      total: null,
      count,
      subscriptionFree: false,
    };
  }

  // 本地版按官方账户快照判断：有效订阅的普通小图不扣 Anlas，大图仍按公式计费。
  const subscriptionFree = subscriptionActive === true && useUpscaleCredits !== true;
  const perImage = subscriptionFree ? 0 : rawPerImage;

  return {
    rawPerImage,
    perImage,
    total: perImage * count,
    count,
    subscriptionFree,
  };
};
