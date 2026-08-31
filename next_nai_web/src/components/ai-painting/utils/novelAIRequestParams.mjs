/**
 * 构造一次 NovelAI 图像生成请求的基础参数。
 *
 * 前端的 batchSize 表示连续发起多少次请求；NovelAI 每个请求始终只生成一张图。
 *
 * @param {object} params 当前生成参数。
 * @param {boolean} isSmeaSupported 当前模型是否支持 SMEA。
 * @returns {object} 可继续附加角色控制、参考图与图生图字段的请求参数。
 */
export const buildNovelAIImageRequestParams = (params, isSmeaSupported) => ({
  model: params.model || 'nai-diffusion-3',
  positivePrompt: params.positivePrompt || '',
  negativePrompt: params.negativePrompt || '',
  scale: params.guidanceScale || 5,
  steps: params.steps || 23,
  width: params.width || 1024,
  height: params.height || 1024,
  promptGuidanceRescale: params.promptGuidanceRescale || 0.0,
  noise_schedule: params.noiseSchedule || 'native',
  seed: params.seed || Math.floor(Math.random() * 4294967295),
  sampler: params.sampler || 'k_euler',
  // V4+ 模型不支持 SMEA / SMEA DYN，请求层继续兜底，避免旧缓存值透传。
  sm: isSmeaSupported ? params.smea || false : false,
  sm_dyn: isSmeaSupported ? params.dyn || false : false,
  decrisp: params.decrisp || false,
  variety: params.variety || false,
  n_samples: 1,
  prefer_brownian: params.prefer_brownian !== undefined ? params.prefer_brownian : true,
  deliberate_euler_ancestral_bug: params.deliberate_euler_ancestral_bug || false,
  legacy: params.legacy || false,
  legacy_uc: params.legacy_uc || false,
  legacy_v3_extend: params.legacy_v3_extend || false,
  autoSmea: isSmeaSupported ? params.autoSmea || false : false,
  use_upscale_credits: params.use_upscale_credits || false,
});
