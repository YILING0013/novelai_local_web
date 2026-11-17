// 主面板和图像参数导入共用同一份选项，避免显示名称或可选值不一致。
export const MODEL_OPTIONS = [
  { value: 'nai-diffusion-5-full', label: 'NAI Diffusion V5 Full (High)', descriptionKey: 'painting.workspace.parameters.modelV5Full' },
  { value: 'nai-diffusion-5-full-medium', label: 'NAI Diffusion V5 Full (Medium)', descriptionKey: 'painting.workspace.parameters.modelV5Medium' },
  { value: 'nai-diffusion-5-curated', label: 'NAI Diffusion V5 Curated', descriptionKey: 'painting.workspace.parameters.modelV5Curated' },
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion V4.5', descriptionKey: 'painting.workspace.parameters.modelV45Full' },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion V4.5 Curated', descriptionKey: 'painting.workspace.parameters.modelV45Curated' },
  { value: 'nai-diffusion-4-full', label: 'NAI Diffusion 4', descriptionKey: 'painting.workspace.parameters.modelV4Full' },
  { value: 'nai-diffusion-4-curated-preview', label: 'NAI Diffusion 4 Curated', descriptionKey: 'painting.workspace.parameters.modelV4CuratedPreview' },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion 3', descriptionKey: 'painting.workspace.parameters.modelNaiV3' },
  { value: 'nai-diffusion-furry-3', label: 'NAI Diffusion Furry 3', descriptionKey: 'painting.workspace.parameters.modelNaiFurryV3' },
].map(option => ({
  ...option, category: option.value.startsWith('nai-diffusion-') ? 'novelai'
    : option.value.startsWith('wan') ? 'video' : 'image',
}));

export const SAMPLER_OPTIONS = [
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim_v3', label: 'DDIM' },
];
export const NOISE_SCHEDULE_OPTIONS = [
  { value: 'native', label: 'noiseNative' }, { value: 'karras', label: 'noiseKarras' },
  { value: 'exponential', label: 'noiseExponential' }, { value: 'polyexponential', label: 'noisePolyexponential' },
];
export const NOVELAI_PARAMETER_RANGES = {
  guidanceScale: { min: 1, max: 20, step: 0.1 },
  promptGuidanceRescale: { min: 0, max: 1, step: 0.02 },
  seed: { min: 0, max: 4294967295, step: 1 },
};

/**
 * 将元数据中的模型 ID 或明确的模型名称对应到本版本的选项；不猜测未知哈希。
 * @param {string} value 原图记录的模型名称或 ID。
 * @returns {string|undefined} 支持的模型 ID；无法确定时返回 undefined。
 */
export function resolveMetadataModel(value) {
  if (!value) return undefined;
  const text = String(value).trim().replace(/^OpenMOSS-Team\//i, '');
  const exact = MODEL_OPTIONS.find(option => option.value.toLowerCase() === text.toLowerCase() || option.label.toLowerCase() === text.toLowerCase());
  if (exact) return exact.value;
  const normalized = text.toLowerCase().replace(/novelai|nai|diffusion|anime/g, '').replace(/[^a-z0-9.]+/g, ' ').trim();
  const version = normalized.match(/(?:^| )v?(4\.5|5|4|3)(?: |$)/)?.[1];
  let model;
  if (version === '5') model = normalized.includes('curated') ? 'nai-diffusion-5-curated'
    : normalized.includes('medium') ? 'nai-diffusion-5-full-medium' : 'nai-diffusion-5-full';
  if (version === '4.5') model = normalized.includes('curated') ? 'nai-diffusion-4-5-curated' : 'nai-diffusion-4-5-full';
  if (version === '4') model = normalized.includes('curated') ? 'nai-diffusion-4-curated-preview' : 'nai-diffusion-4-full';
  if (version === '3') model = normalized.includes('furry') ? 'nai-diffusion-furry-3' : 'nai-diffusion-3';
  // A1111 的模型版本数字不能被当成 NovelAI；只有模型来源明确时才使用上述名称映射。
  if (!/novelai|nai[ -]|^v[345](?:[ .]|$)/i.test(text)) return undefined;
  return MODEL_OPTIONS.some(option => option.value === model) ? model : undefined;
}
