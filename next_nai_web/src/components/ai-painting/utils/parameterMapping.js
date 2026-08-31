/**
 * 参数映射及处理工具函数
 */

// 定义分辨率限制变量，默认为普通模式
let MAX_PRODUCT = 1048576; // 1024 * 1024
let MAX_DIMENSION = 2048;
export const PARAMETER_MAPPING_EVENTS = Object.freeze({
  RESOLUTION_AUTO_ADJUSTED: 'PARAMETER_RESOLUTION_AUTO_ADJUSTED',
});

/**
 * 设置大图模式
 * @param {boolean} enabled - 是否启用大图模式
 */
export const setLargeImageMode = (enabled) => {
  if (enabled) {
    MAX_PRODUCT = 3145728; // 约 4096 * 768 或 2048 * 1536
    MAX_DIMENSION = 4096;
  } else {
    MAX_PRODUCT = 1048576;
    MAX_DIMENSION = 2048;
  }
  // 重新生成允许的分辨率列表
  refreshAllowedResolutions();
};

/**
 * 生成所有允许的分辨率组合
 * @returns {Array<[number, number]>} 允许的分辨率数组
 */
const generateAllowedResolutions = () => {
  const maxProduct = MAX_PRODUCT;
  const maxValue = MAX_DIMENSION;
  const step = 64;
  const allowedResolutions = [];

  for (let width = step; width <= maxValue; width += step) {
    for (let height = step; height <= maxValue; height += step) {
      const product = width * height;
      if (product <= maxProduct) {
        allowedResolutions.push([width, height]);
        if (width !== height) {
          allowedResolutions.push([height, width]);
        }
      }
    }
  }

  return allowedResolutions;
};

// 允许的分辨率列表 (改为 let 以便更新)
export let allowedResolutionsList = [];

// 刷新分辨率列表的辅助函数
const refreshAllowedResolutions = () => {
  const newList = generateAllowedResolutions();
  // 清空原数组并推入新数据，保持引用不变
  allowedResolutionsList.length = 0;
  allowedResolutionsList.push(...newList);
};

// 初始化列表
refreshAllowedResolutions();

/**
 * 查找最接近的允许分辨率，优先保证宽高比
 * @param {number} width - 目标宽度
 * @param {number} height - 目标高度
 * @returns {[number, number]} 最接近的允许分辨率
 */
export const findClosestAllowedResolution = (width, height) => {
  // 确保宽度和高度是64的倍数
  const adjustedWidth = Math.round(width / 64) * 64;
  const adjustedHeight = Math.round(height / 64) * 64;

  // 检查此确切分辨率是否允许
  const exactMatch = allowedResolutionsList.find(res =>
    res[0] === adjustedWidth && res[1] === adjustedHeight
  );

  if (exactMatch) return exactMatch;

  // 如果不是，找到最接近的分辨率
  let closestDiff = Infinity;
  let closestRes = [1024, 1024]; // 默认回退

  for (const res of allowedResolutionsList) {
    const diff = Math.abs(res[0] - adjustedWidth) + Math.abs(res[1] - adjustedHeight);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestRes = res;
    }
  }

  return closestRes;
};

const getUniqueSortedDimensions = (values) => [...new Set(values)].sort((a, b) => a - b);

const clampToAllowedDimension = (target, allowedDimensions) => {
  if (allowedDimensions.length === 0) {
    return target;
  }

  for (let index = allowedDimensions.length - 1; index >= 0; index -= 1) {
    if (allowedDimensions[index] <= target) {
      return allowedDimensions[index];
    }
  }

  return allowedDimensions[0];
};

export const getAllowedHeightsForWidth = (width) => {
  const adjustedWidth = Math.round(width / 64) * 64;

  return getUniqueSortedDimensions(
    allowedResolutionsList
      .filter(([candidateWidth]) => candidateWidth === adjustedWidth)
      .map(([, candidateHeight]) => candidateHeight)
  );
};

export const getAllowedWidthsForHeight = (height) => {
  const adjustedHeight = Math.round(height / 64) * 64;

  return getUniqueSortedDimensions(
    allowedResolutionsList
      .filter(([, candidateHeight]) => candidateHeight === adjustedHeight)
      .map(([candidateWidth]) => candidateWidth)
  );
};

export const findAllowedResolutionWithFixedWidth = (width, currentHeight) => {
  const adjustedWidth = Math.round(width / 64) * 64;
  const adjustedHeight = Math.round(currentHeight / 64) * 64;
  const allowedHeights = getAllowedHeightsForWidth(adjustedWidth);

  if (allowedHeights.length === 0) {
    return findClosestAllowedResolution(adjustedWidth, adjustedHeight);
  }

  return [adjustedWidth, clampToAllowedDimension(adjustedHeight, allowedHeights)];
};

export const findAllowedResolutionWithFixedHeight = (currentWidth, height) => {
  const adjustedWidth = Math.round(currentWidth / 64) * 64;
  const adjustedHeight = Math.round(height / 64) * 64;
  const allowedWidths = getAllowedWidthsForHeight(adjustedHeight);

  if (allowedWidths.length === 0) {
    return findClosestAllowedResolution(adjustedWidth, adjustedHeight);
  }

  return [clampToAllowedDimension(adjustedWidth, allowedWidths), adjustedHeight];
};


/**
 * 将从图像元数据中解析出的参数映射到UI状态
 * @param {object} parsedParams - 解析后的参数
 * @returns {object} 可以在UI上使用的参数
 */
export const mapImageParametersToUI = (parsedParams) => {
  const uiParams = {};

  // 基础参数映射
  const basicMappings = {
    'steps': 'steps',
    'scale': 'guidanceScale',
    'guidanceScale': 'guidanceScale',
    'cfg_scale': 'guidanceScale',
    'guidance_scale': 'guidanceScale',
    'width': 'width',
    'height': 'height',
    'seed': 'seed',
    'sampler': 'sampler',
    'noise_schedule': 'noiseSchedule',
    'noiseSchedule': 'noiseSchedule',
    'cfg_rescale': 'promptGuidanceRescale',
    'promptGuidanceRescale': 'promptGuidanceRescale',
    'prompt_guidance_rescale': 'promptGuidanceRescale',
    'sm': 'smea',
    'smea': 'smea',
    'sm_dyn': 'dyn',
    'dyn': 'dyn',
    'variety': 'variety',
    'decrisp': 'decrisp',
    'legacy': 'legacy',
    'legacy_uc': 'legacy_uc',
    'legacy_v3_extend': 'legacy_v3_extend',
    'prefer_brownian': 'prefer_brownian',
    'deliberate_euler_ancestral_bug': 'deliberate_euler_ancestral_bug',
    'uncond_scale': 'promptGuidanceRescale'
  };

  // 应用基础参数映射
  Object.entries(basicMappings).forEach(([sourceKey, targetKey]) => {
    if (parsedParams[sourceKey] !== undefined) {
      uiParams[targetKey] = parsedParams[sourceKey];
    }
  });

  // 采样器名称映射
  const samplerMappings = {
    'k_euler_a': 'k_euler_ancestral',
    'k_lms': 'k_euler',
    'k_dpm_2': 'k_dpmpp_2m',
    'k_dpm_2_a': 'k_dpmpp_2m_sde',
    'k_heun': 'k_euler',
    'k_dpm_fast': 'k_dpmpp_sde',
    'k_dpm_adaptive': 'k_dpmpp_sde',
    'k_dpmpp_2s_a': 'k_dpmpp_2s_ancestral',
    'ddim': 'ddim_v3'
  };

  if (uiParams.sampler && samplerMappings[uiParams.sampler]) {
    uiParams.sampler = samplerMappings[uiParams.sampler];
  }

  // 噪声调度映射
  const noiseScheduleMappings = {
    'native': 'native',
    'karras': 'karras',
    'exponential': 'exponential',
    'polyexponential': 'polyexponential'
  };

  if (uiParams.noiseSchedule && noiseScheduleMappings[uiParams.noiseSchedule]) {
    uiParams.noiseSchedule = noiseScheduleMappings[uiParams.noiseSchedule];
  }

  return uiParams;
};

/**
 * 从图像元数据中提取提示词与角色控制内容，并保留显式空提示词的存在信息。
 *
 * Args:
 *   parsedParams: 已解析的图像参数或元数据对象。
 *
 * Returns:
 *   object: 提取后的正面提示词、负面提示词、字段存在标志和角色控制标签。
 *
 * @param {object} parsedParams - 已解析的图像参数或元数据。
 * @returns {{positivePrompt: string, negativePrompt: string, hasPositivePrompt: boolean, hasNegativePrompt: boolean, characterTabs: Array}} 提取后的提示词内容。
 */
export const extractPromptContent = (parsedParams) => {
  const result = {
    positivePrompt: '',
    negativePrompt: '',
    hasPositivePrompt: false,
    hasNegativePrompt: false,
    characterTabs: []
  };

  if (parsedParams.positivePrompt !== undefined) {
    result.positivePrompt = parsedParams.positivePrompt ?? '';
    result.hasPositivePrompt = true;
  }

  if (parsedParams.negativePrompt !== undefined) {
    result.negativePrompt = parsedParams.negativePrompt ?? '';
    result.hasNegativePrompt = true;
  }

  if (Array.isArray(parsedParams.characterTabs) && parsedParams.characterTabs.length > 0) {
    result.characterTabs = parsedParams.characterTabs.map((charCaption, index) => ({
      name: typeof charCaption.name === 'string' ? charCaption.name.slice(0, 16) : '',
      prompt: charCaption.prompt || charCaption.char_caption || '',
      uc: charCaption.uc || '',
      position: charCaption.position || 'C3',
      ...(charCaption.center && typeof charCaption.center === 'object'
        ? { center: charCaption.center }
        : {}),
      colorId: charCaption.colorId !== undefined ? charCaption.colorId : index % 6,
    }));
  }

  // 基础提示词
  if (!result.hasPositivePrompt && parsedParams.prompt) {
    result.positivePrompt = parsedParams.prompt;
    result.hasPositivePrompt = true;
  }

  if (!result.hasNegativePrompt && parsedParams.uc) {
    result.negativePrompt = parsedParams.uc;
    result.hasNegativePrompt = true;
  }

  // V4格式的提示词
  if (parsedParams.v4_prompt) {
    if (!result.hasPositivePrompt && parsedParams.v4_prompt.caption && parsedParams.v4_prompt.caption.base_caption) {
      result.positivePrompt = parsedParams.v4_prompt.caption.base_caption;
      result.hasPositivePrompt = true;
    }

    // 角色控制
    if (result.characterTabs.length === 0 && parsedParams.v4_prompt.caption.char_captions && parsedParams.v4_prompt.caption.char_captions.length > 0) {
      result.characterTabs = parsedParams.v4_prompt.caption.char_captions.map((charCaption, index) => ({
        name: '',
        prompt: charCaption.char_caption || '',
        uc: '',
        position: 'C3',
        ...(Array.isArray(charCaption.centers) && charCaption.centers[0]
          ? { center: charCaption.centers[0] }
          : {}),
        colorId: index % 6
      }));
    }
  }

  if (parsedParams.v4_negative_prompt) {
    if (!result.hasNegativePrompt && parsedParams.v4_negative_prompt.caption && parsedParams.v4_negative_prompt.caption.base_caption) {
      result.negativePrompt = parsedParams.v4_negative_prompt.caption.base_caption;
      result.hasNegativePrompt = true;
    }

    // 更新角色控制的负面提示词
    if (parsedParams.v4_negative_prompt.caption.char_captions && parsedParams.v4_negative_prompt.caption.char_captions.length > 0) {
      parsedParams.v4_negative_prompt.caption.char_captions.forEach((charCaption, index) => {
        if (result.characterTabs[index]) {
          result.characterTabs[index].uc = charCaption.char_caption || '';
        }
      });
    }
  }

  if ((!result.hasPositivePrompt || !result.hasNegativePrompt || result.characterTabs.length === 0) && parsedParams.originalMetadata) {
    const fallbackContent = extractPromptContent(parsedParams.originalMetadata);

    if (!result.hasPositivePrompt && fallbackContent.hasPositivePrompt) {
      result.positivePrompt = fallbackContent.positivePrompt;
      result.hasPositivePrompt = true;
    }

    if (!result.hasNegativePrompt && fallbackContent.hasNegativePrompt) {
      result.negativePrompt = fallbackContent.negativePrompt;
      result.hasNegativePrompt = true;
    }

    if (result.characterTabs.length === 0 && fallbackContent.characterTabs.length > 0) {
      result.characterTabs = fallbackContent.characterTabs;
    }
  }

  return result;
};

/**
 * 主要的参数应用函数
 * @param {object} parsedParams - 解析后的参数
 * @param {object} callbacks - 更新UI状态的回调函数集合
 */
export const applyImageParametersToUI = (parsedParams, {
  setPositivePrompt,
  setNegativePrompt,
  setCharacterTabsFromNote,
  setExpandedPanels,
  handleParamChange,
  handleBooleanParamChange,
  onResolutionChange,
  showNotification // 新增：用于显示通知的回调
} = {}) => {
  try {
    if (!parsedParams || typeof handleParamChange !== 'function') {
      return false;
    }

    // 应用UI参数
    const uiParams = mapImageParametersToUI(parsedParams);

    if (uiParams.width && uiParams.height) {
      const originalWidth = uiParams.width;
      const originalHeight = uiParams.height;
      const [newWidth, newHeight] = findClosestAllowedResolution(originalWidth, originalHeight);

      if (newWidth !== originalWidth || newHeight !== originalHeight) {
        uiParams.width = newWidth;
        uiParams.height = newHeight;
        // 如果分辨率有变，通知用户
        if (showNotification) {
          showNotification(PARAMETER_MAPPING_EVENTS.RESOLUTION_AUTO_ADJUSTED, 'info', {
            originalWidth,
            originalHeight,
            newWidth,
            newHeight,
          });
        }
      }

      if (typeof onResolutionChange === 'function') {
        onResolutionChange(uiParams.width, uiParams.height);
      }
    }

    Object.entries(uiParams).forEach(([key, value]) => {
      if ((key === 'smea' || key === 'dyn') && typeof handleBooleanParamChange === 'function') {
        handleBooleanParamChange(key, value);
        return;
      }

      handleParamChange(key, value);
    });

    // 应用提示词内容
    const promptContent = extractPromptContent(parsedParams);

    if (promptContent.hasPositivePrompt && typeof setPositivePrompt === 'function') {
      // 元数据同时切换模型时，提示词必须直接写入目标模型分仓，避免落到切换前的模型。
      setPositivePrompt(promptContent.positivePrompt, uiParams.model);
    }

    if (promptContent.hasNegativePrompt && typeof setNegativePrompt === 'function') {
      setNegativePrompt(promptContent.negativePrompt, uiParams.model);
    }

    if (promptContent.characterTabs.length > 0 && typeof setCharacterTabsFromNote === 'function') {
      setCharacterTabsFromNote(promptContent.characterTabs);
      if (typeof setExpandedPanels === 'function') {
        setExpandedPanels(prev => ({ ...prev, character: true }));
      }
    }

    return true;
  } catch (error) {
    console.error('应用参数时发生错误:', error);
    return false;
  }
};
