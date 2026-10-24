import { mapImageParametersToUI } from './parameterMapping.js';
import { isNovelAIV4OrAboveModel } from './modelUtils.js';

/**
 * 保存完整编辑态，保留禁用输入和 Vibe 原图/编码，排除临时凭据和重复请求图片。
 * @param {object} parameterState 参数面板当前的编辑态。
 * @param {Array<object>} vibeImages 全部 Vibe 条目，包括暂时禁用或尚未编码的条目。
 * @param {object} prompts 当前模型的原始正负提示词。
 * @returns {object} 与页面状态独立、可持久化的版本编辑态。
 */
export function createVersionEditorSnapshot(parameterState, vibeImages = [], prompts = {}) {
  const params = { ...parameterState.params };
  // 这些数组来自参考图控件，完整数据已保存在 referenceImages，避免一张图重复存三遍。
  for (const key of Object.keys(params)) {
    if (key.startsWith('director_reference_') || key.startsWith('reference_image')) delete params[key];
  }
  const referenceImages = (parameterState.referenceImages || []).map(({ displayUrl, cache_secret_key, ...image }) => {
    const result = { ...image };
    if (result.originalImage === `data:image/png;base64,${result.data}`) delete result.originalImage;
    return result;
  });
  const vibes = vibeImages.map((image) => {
    const result = { ...image };
    if (result.originalImage === result.image) delete result.originalImage;
    return result;
  });
  return JSON.parse(JSON.stringify({
    parameterState: { params, characterTabs: parameterState.characterTabs || [], referenceImages,
      imagePreview: parameterState.imagePreview || null, editedImageData: parameterState.editedImageData || null,
      directorToolParams: parameterState.directorToolParams || null, restoredMask: parameterState.restoredMask || null },
    vibeImages: vibes, positivePrompt: prompts.positivePrompt || '', negativePrompt: prompts.negativePrompt || '',
  }, (key, value) => /token|secret|password|authorization|cookie|api.?key|access.?key/i.test(key) ? undefined : value));
}

/**
 * 将不可变版本中的请求参数还原为现有参数面板的编辑态，清除上一个作品的输入。
 * @param {object} parameters 版本保存的完整参数快照。
 * @param {object} defaults 当前参数面板的默认值。
 * @returns {object} 可直接交给工作台的参数、角色、参考图片与 Vibe 编辑态。
 */
export function restoreVersionWorkspace(parameters, defaults) {
  const editor = parameters.editor_state;
  const savedState = editor?.parameterState;
  // 实际生成的种子、尺寸、模型等覆盖编辑前的值；完整输入仍从版本编辑态恢复。
  const params = { ...defaults, ...structuredClone(savedState?.params || {}), ...mapImageParametersToUI(parameters) };
  for (const key of ['strength', 'noise', 'use_upscale_credits', 'autoSmea']) {
    if (parameters[key] !== undefined) params[key] = parameters[key];
  }
  const dataUrl = (value) => value?.startsWith('data:') ? value : `data:image/png;base64,${value}`;
  // 历史快照可能保存本地缓存对象，也可能保存官方请求中的纯 Base64 数组。
  const legacyReferences = parameters.director_reference_images_cached?.length
    ? parameters.director_reference_images_cached : parameters.director_reference_images || [];
  const referenceImages = savedState?.referenceImages
    ? savedState.referenceImages.map((image) => ({ ...structuredClone(image), displayUrl: dataUrl(image.data), cache_secret_key: null }))
    : legacyReferences.map((image, index) => ({
    id: `version-reference-${index}`, data: typeof image === 'string' ? image : image.data,
    displayUrl: dataUrl(typeof image === 'string' ? image : image.data),
    type: parameters.director_reference_descriptions?.[index]?.caption?.base_caption || 'character',
    strength: parameters.director_reference_strength_values?.[index] ?? 0.6,
    fidelity: 1 - (parameters.director_reference_secondary_strength_values?.[index] ?? 0),
    disabled: false,
    // 参考图控件会为恢复的图片重新创建缓存密钥；历史不保存密钥。
    cache_secret_key: null,
  }));
  const v4 = isNovelAIV4OrAboveModel(params.model);
  const singleVibe = !v4 && !parameters.reference_image_multiple?.length && parameters.reference_image;
  const vibeImages = editor?.vibeImages
    ? editor.vibeImages.map((image) => ({ ...structuredClone(image),
      // 页面离开后没有仍在进行的编码任务，恢复时允许用户继续编码。
      ...(image.isV4Vibe && image.status === 'converting' ? { status: image.encoding ? 'converted' : 'unconverted' } : {}),
    }))
    : (singleVibe ? [singleVibe] : parameters.reference_image_multiple || []).map((image, index) => ({
    id: `version-vibe-${index}`, name: `Vibe ${index + 1}`,
    ...(v4 ? { isV4Vibe: true, status: 'converted', encoding: image } : { image: dataUrl(image) }),
    referenceStrength: (singleVibe ? parameters.reference_strength : parameters.reference_strength_multiple?.[index]) ?? 0.6,
    informationExtracted: (singleVibe ? parameters.reference_information_extracted : parameters.reference_information_extracted_multiple?.[index]) ?? 1,
  }));
  const directorToolParams = parameters.req_type ? {
    type: parameters.req_type,
    params: parameters.req_type === 'emotion' ? {
      emotion: (parameters.prompt || '').split(';; ')[0],
      prompt: (parameters.prompt || '').split(';; ').slice(1).join(';; '), defry: parameters.defry,
    } : { prompt: parameters.prompt || '', intensity: parameters.defry },
  } : (savedState?.directorToolParams ? structuredClone(savedState.directorToolParams) : null);
  return {
    parameterState: {
      params, characterTabs: structuredClone(parameters.characterTabs || savedState?.characterTabs || []), referenceImages,
      imagePreview: parameters.image ? dataUrl(parameters.image) : savedState?.imagePreview || null,
      editedImageData: savedState?.editedImageData || null, directorToolParams,
      restoredMask: parameters.mask ? {
        mask: dataUrl(parameters.mask), inpaintStrength: parameters.inpaint_strength ?? 1,
        disabledOriginalImage: Boolean(parameters.disabled_original_image),
        colorCorrect: parameters.color_correct ?? true,
      } : (savedState?.restoredMask ? structuredClone(savedState.restoredMask) : null),
    },
    positivePrompt: parameters.positivePrompt ?? parameters.prompt ?? editor?.positivePrompt ?? '',
    negativePrompt: parameters.negativePrompt ?? parameters.uc ?? editor?.negativePrompt ?? '',
    vibeImages,
  };
}
