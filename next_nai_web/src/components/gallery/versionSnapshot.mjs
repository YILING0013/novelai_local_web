/**
 * 从完整编辑快照或旧版请求中读取参考图，保留预览和实际生成配置。
 * @param {object} parameters 版本参数快照。
 * @returns {Array<object>} 角色参考、Vibe、图生图与遮罩的展示条目。
 */
export function versionReferences(parameters = {}) {
  const editor = parameters.editor_state;
  const state = editor?.parameterState;
  const imageUrl = (value) => typeof value === 'string' && value ? (value.startsWith('data:') ? value : 'data:image/png;base64,' + value) : null;
  const legacyReferences = parameters.director_reference_images_cached?.length ? parameters.director_reference_images_cached : parameters.director_reference_images || [];
  const references = state?.referenceImages ?? legacyReferences.map((item, index) => ({
    data: typeof item === 'string' ? item : item.data,
    type: parameters.director_reference_descriptions?.[index]?.caption?.base_caption || 'character',
    strength: parameters.director_reference_strength_values?.[index],
    fidelity: 1 - (parameters.director_reference_secondary_strength_values?.[index] ?? 0),
  }));
  const legacyVibes = parameters.reference_image_multiple?.length ? parameters.reference_image_multiple : parameters.reference_image ? [parameters.reference_image] : [];
  const vibes = editor?.vibeImages ?? legacyVibes.map((item, index) => ({
    ...(parameters.use_v4_vibe || /nai-diffusion-[45]/.test(parameters.model || '') ? { encoding: item } : { image: item }),
    referenceStrength: parameters.reference_strength_multiple?.[index] ?? parameters.reference_strength,
    informationExtracted: parameters.reference_information_extracted_multiple?.[index] ?? parameters.reference_information_extracted,
  }));
  const items = [
    ...references.map((item, index) => ({
      key: 'reference-' + index, kind: 'reference', name: item.name || 'Reference ' + (index + 1),
      preview: imageUrl(item.originalImage || item.data), usedImage: imageUrl(item.data),
      content: imageUrl(item.data), original: imageUrl(item.originalImage || item.data),
      settings: { type: item.type, strength: item.strength, fidelity: item.fidelity, disabled: Boolean(item.disabled) },
    })),
    ...vibes.map((item, index) => ({
      key: 'vibe-' + index, kind: 'vibe', name: item.name || item.filename || 'Vibe ' + (index + 1),
      preview: imageUrl(item.originalImage || item.image || item.thumbnail), usedImage: imageUrl(item.image),
      content: item.encoding || imageUrl(item.image), original: imageUrl(item.originalImage || item.image || item.thumbnail),
      settings: { referenceStrength: item.referenceStrength, informationExtracted: item.informationExtracted,
        disabled: Boolean(item.disabled || item.isTemporarilyDisabled), encoding: Boolean(item.encoding), status: item.status },
    })),
  ];
  const input = parameters.image || state?.editedImageData || state?.imagePreview;
  const mask = parameters.mask || state?.restoredMask?.mask;
  if (input) items.push({ key: 'image', kind: 'image', name: 'Image to image', preview: imageUrl(input), content: input,
    originalUrl: imageUrl(state?.imagePreview), original: state?.imagePreview,
    settings: { strength: parameters.strength ?? state?.params?.strength, noise: parameters.noise ?? state?.params?.noise } });
  if (mask) items.push({ key: 'mask', kind: 'mask', name: 'Mask', preview: imageUrl(mask), content: mask,
    settings: { inpaint_strength: parameters.inpaint_strength ?? state?.restoredMask?.inpaintStrength,
      disabled_original_image: parameters.disabled_original_image ?? state?.restoredMask?.disabledOriginalImage,
      color_correct: parameters.color_correct ?? state?.restoredMask?.colorCorrect } });
  return items;
}

/**
 * 生成可阅读的参数视图：参考输入用卡片展示，其余状态保留逐字段比较能力。
 * @param {object} parameters 原始版本参数。
 * @returns {object} 去掉重复图像编码与编辑缓存的参数。
 */
export function visibleVersionParameters(parameters = {}) {
  const result = { ...parameters.editor_state?.parameterState?.params, ...parameters };
  const state = parameters.editor_state?.parameterState;
  if (!parameters.characterTabs && state?.characterTabs) result.characterTabs = state.characterTabs;
  if (state?.directorToolParams) result.directorToolParams = state.directorToolParams;
  for (const key of ['editor_state', 'image', 'mask', 'imageToImage', 'vibeTransfer', 'use_v4_vibe', 'reference_image',
    'reference_image_multiple', 'reference_image_multiple_cached', 'reference_strength_multiple',
    'reference_information_extracted_multiple', 'director_reference_images', 'director_reference_images_cached',
    'director_reference_descriptions', 'director_reference_strength_values', 'director_reference_secondary_strength_values',
    'director_reference_information_extracted']) delete result[key];
  return result;
}
