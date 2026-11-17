import { NOVELAI_V5_MEDIUM_DEFAULT_PARAMS, NOVELAI_V5_STANDARD_MAX_STEPS, NOVELAI_V5_LARGE_MAX_STEPS } from './novelAIV5Params.mjs';
import { SAMPLER_OPTIONS, NOISE_SCHEDULE_OPTIONS, NOVELAI_PARAMETER_RANGES } from './generationOptions.js';
/**
 * 参数映射及处理工具函数
 */
import { isPaintingModelAllowed, DEFAULT_PAINTING_MODEL_ID } from './modelUtils.js';

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
const generateAllowedResolutions = ({
  maxProduct = MAX_PRODUCT, maxDimension = MAX_DIMENSION, minDimension = 64, step = 64,
} = {}) => {
  const allowedResolutions = [];

  for (let width = minDimension; width <= maxDimension; width += step) {
    for (let height = minDimension; height <= maxDimension; height += step) {
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
 * 按画框外接矩形匹配当前模型允许的尺寸，不改变模型、计费模式或其他生成参数。
 *
 * Args:
 *   params: 当前生成参数，包含模型和大图模式开关。
 *   bounds: 画框外接矩形的 width、height。
 *
 * Returns:
 *   object: 应更新的宽高字段，不改变用户启用的大图模式。
 */
export const getPanelResolutionParameters = (params, { width, height }) => {
  const ratio = width / height;
  const limits = {
    maxProduct: params.use_upscale_credits ? 3145728 : 1048576,
    maxDimension: params.use_upscale_credits ? 4096 : 2048,
    minDimension: 512,
  };
  let closest;
  let closestDifference = Infinity;
  let largestArea = 0;
  for (const [w, h] of generateAllowedResolutions(limits)) {
    // 对数比例误差使横竖互换后仍得到互换的尺寸；同样接近时选更清晰的尺寸。
    const difference = Math.abs(Math.log((w / h) / ratio));
    const area = w * h;
    if (difference < closestDifference - 1e-10
      || (Math.abs(difference - closestDifference) <= 1e-10 && area > largestArea)) {
      closest = [w, h]; closestDifference = difference; largestArea = area;
    }
  }
  return { width: closest[0], height: closest[1] };
};

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
  if (isPaintingModelAllowed(parsedParams.model)) uiParams.model = parsedParams.model;

  if (isPaintingModelAllowed(parsedParams.model)) {
    uiParams.model = parsedParams.model;
  }
  const useCoords = parsedParams.use_coords ?? parsedParams.v4_prompt?.use_coords;
  if (useCoords !== undefined) {
    // use_coords 表示使用人工坐标，与“由 AI 决定位置”的开关方向相反。
    uiParams.aiDecidePosition = !useCoords;
    uiParams.characterPositionMode = useCoords ? 'custom' : 'ai';
  }

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
 * @returns {{positivePrompt: string, negativePrompt: string, hasPositivePrompt: boolean, hasNegativePrompt: boolean, characterTabs: Array, hasCharacterTabs: boolean}} 提取后的提示词内容。
 */
export const extractPromptContent = (parsedParams) => {
  const result = {
    positivePrompt: '',
    negativePrompt: '',
    hasPositivePrompt: false,
    hasNegativePrompt: false,
    characterTabs: [],
    hasCharacterTabs: false
  };

  if (parsedParams.positivePrompt !== undefined) {
    result.positivePrompt = parsedParams.positivePrompt ?? '';
    result.hasPositivePrompt = true;
  }

  if (parsedParams.negativePrompt !== undefined) {
    result.negativePrompt = parsedParams.negativePrompt ?? '';
    result.hasNegativePrompt = true;
  }

  if (Array.isArray(parsedParams.characterTabs)) {
    // 显式空数组表示清空旧角色，不应再从历史元数据补回角色。
    result.hasCharacterTabs = true;
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
    if (!result.hasCharacterTabs && Array.isArray(parsedParams.v4_prompt.caption?.char_captions)) {
      result.hasCharacterTabs = true;
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

  if ((!result.hasPositivePrompt || !result.hasNegativePrompt || !result.hasCharacterTabs) && parsedParams.originalMetadata) {
    const fallbackContent = extractPromptContent(parsedParams.originalMetadata);

    if (!result.hasPositivePrompt && fallbackContent.hasPositivePrompt) {
      result.positivePrompt = fallbackContent.positivePrompt;
      result.hasPositivePrompt = true;
    }

    if (!result.hasNegativePrompt && fallbackContent.hasNegativePrompt) {
      result.negativePrompt = fallbackContent.negativePrompt;
      result.hasNegativePrompt = true;
    }

    if (!result.hasCharacterTabs && fallbackContent.hasCharacterTabs) {
      result.characterTabs = fallbackContent.characterTabs;
      result.hasCharacterTabs = true;
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
    if (parsedParams.model !== undefined && uiParams.model === undefined) {
      return false;
    }

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

    if (promptContent.hasCharacterTabs && typeof setCharacterTabsFromNote === 'function') {
      setCharacterTabsFromNote(promptContent.characterTabs);
      if (promptContent.characterTabs.length > 0 && typeof setExpandedPanels === 'function') {
        setExpandedPanels(prev => ({ ...prev, character: true }));
      }
    }

    return true;
  } catch (error) {
    console.error('应用参数时发生错误:', error);
    return false;
  }
};


/**
 * 返回当前模型与当前大图开关允许导入的控件范围；不更改页面的计费模式。
 * @param {object} params 当前模型、尺寸与大图模式。
 * @param {boolean} restrictedAccount 是否禁止大图模式。
 * @returns {object} 合法尺寸组合、数字范围和模型固定参数。
 */
export const getImageImportOptions = (params = {}, restrictedAccount = false) => {
  const model = params.model || DEFAULT_PAINTING_MODEL_ID;
  const novelAI = model.startsWith('nai-diffusion-');
  const large = Boolean(params.use_upscale_credits) && !restrictedAccount;
  const medium = model === 'nai-diffusion-5-full-medium';
  const limits = novelAI ? { maxProduct: large ? 3145728 : 1048576, maxDimension: large ? 4096 : 2048, minDimension: 512, step: 64 } : null;
  const ranges = novelAI ? { ...NOVELAI_PARAMETER_RANGES,
    steps: { min: 1, max: large ? NOVELAI_V5_LARGE_MAX_STEPS : NOVELAI_V5_STANDARD_MAX_STEPS, step: 1 } } : {};
  const fixed = novelAI && !['nai-diffusion-3', 'nai-diffusion-furry-3'].includes(model) ? { smea: false, dyn: false } : {};
  if (medium) Object.assign(fixed, NOVELAI_V5_MEDIUM_DEFAULT_PARAMS);
  let resolutions = limits ? generateAllowedResolutions(limits) : [];
  return { resolutions, ranges, fixed, medium, novelAI };
};

/**
 * 将外部图像参数对齐到页面允许的范围，尺寸修改时优先保留用户刚选的一边。
 * @param {object} metadata 可编辑的图像参数。
 * @param {object} params 实际将要使用的模型和大图开关。
 * @param {boolean} restrictedAccount 是否禁止大图模式。
 * @param {'width'|'height'|undefined} editedField 刚修改的尺寸方向。
 * @returns {object} 可供选择与导入的合法参数副本。
 */
export const normalizeImageImportParameters = (metadata, params = {}, restrictedAccount = false, editedField) => {
  const result = { ...metadata };
  const { resolutions, ranges, fixed, novelAI } = getImageImportOptions(params, restrictedAccount);
  if (resolutions.length && (result.width !== undefined || result.height !== undefined)) {
    const width = Number(result.width ?? params.width ?? 1024), height = Number(result.height ?? params.height ?? 1024);
    const candidates = editedField ? resolutions.filter(([w, h]) => (editedField === 'width' ? w === width : h === height)) : resolutions;
    let closest, difference = Infinity;
    for (const [w, h] of candidates) {
      const nextDifference = Math.abs(w - width) + Math.abs(h - height);
      if (nextDifference < difference) { closest = [w, h]; difference = nextDifference; }
    }
    [result.width, result.height] = closest;
  }
  for (const [key, { min, max, step }] of Object.entries(ranges)) {
    if (result[key] === undefined || (key === 'seed' && result[key] === '')) continue;
    const value = Number(result[key]);
    if (!Number.isFinite(value)) { delete result[key]; continue; }
    result[key] = key === 'seed' && value === -1 ? '' : Number((Math.min(max, Math.max(min, Math.round(value / step) * step))).toFixed(2));
  }
  if (novelAI && result.sampler !== undefined) {
    const sampler = mapImageParametersToUI({ sampler: result.sampler }).sampler;
    result.sampler = SAMPLER_OPTIONS.some(option => option.value === sampler) ? sampler : 'k_euler';
  }
  if (novelAI && result.noiseSchedule !== undefined && !NOISE_SCHEDULE_OPTIONS.some(option => option.value === result.noiseSchedule)) result.noiseSchedule = 'native';
  for (const [key, value] of Object.entries(fixed)) if (result[key] !== undefined) result[key] = value;
  return result;
};
