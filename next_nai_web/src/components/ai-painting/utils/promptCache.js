export const MODEL_PROMPT_CACHE_KEY = 'aiImagePromptsByModel_v1';

const LEGACY_POSITIVE_PROMPT_KEY = 'positivePrompt';
const LEGACY_NEGATIVE_PROMPT_KEY = 'negativePrompt';

/**
 * 获取当前浏览器可用的本地存储对象。
 *
 * Args:
 *   storage: 调用方显式传入的 Storage；测试或服务端渲染时可为空。
 *
 * Returns:
 *   Storage | null: 可用的存储对象，不可用时返回 null。
 *
 * @param {Storage|null} storage - 可选的本地存储对象。
 * @returns {Storage|null} 返回可用的 Storage。
 */
const resolveStorage = (storage) => {
  if (storage) {
    return storage;
  }
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 某些隐私模式或沙箱策略会在读取 localStorage getter 时直接抛出异常。
    return window.localStorage;
  } catch (error) {
    console.error('浏览器本地存储不可用，将使用当前会话内存缓存:', error);
    return null;
  }
};

/**
 * 校验并规范按模型保存的提示词缓存。
 *
 * Args:
 *   rawCache: 从 localStorage 解析得到的未知结构。
 *
 * Returns:
 *   object: 仅保留字符串模型 ID 与字符串正负面提示词的安全缓存。
 *
 * @param {unknown} rawCache - 待校验的缓存结构。
 * @returns {Record<string, {positivePrompt: string, negativePrompt: string}>} 返回规范后的缓存。
 */
const normalizePromptCache = (rawCache) => {
  if (!rawCache || typeof rawCache !== 'object' || Array.isArray(rawCache)) {
    return {};
  }

  return Object.entries(rawCache).reduce((result, [modelId, entry]) => {
    if (!modelId || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return result;
    }

    result[modelId] = {
      positivePrompt: typeof entry.positivePrompt === 'string' ? entry.positivePrompt : '',
      negativePrompt: typeof entry.negativePrompt === 'string' ? entry.negativePrompt : '',
    };
    return result;
  }, {});
};

/**
 * 将按模型提示词缓存写入 localStorage。
 *
 * Args:
 *   cache: 完整的模型提示词映射。
 *   storage: 可选的 Storage，缺省时使用浏览器 localStorage。
 *
 * Returns:
 *   boolean: 写入成功时返回 true；不可用或写入失败时返回 false。
 *
 * @param {Record<string, {positivePrompt: string, negativePrompt: string}>} cache - 待保存缓存。
 * @param {Storage|null} storage - 可选的存储对象。
 * @returns {boolean} 返回缓存是否写入成功。
 */
export const persistModelPromptCache = (cache, storage = null) => {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return false;
  }

  try {
    resolvedStorage.setItem(MODEL_PROMPT_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch (error) {
    console.error('保存按模型提示词缓存失败:', error);
    return false;
  }
};

/**
 * 读取按模型提示词缓存，并把旧版全局提示词迁移到当前模型。
 *
 * Args:
 *   activeModel: 页面启动时选中的完整模型 ID。
 *   storage: 可选的 Storage，缺省时使用浏览器 localStorage。
 *
 * Returns:
 *   object: 可直接用于 React 状态的模型提示词映射。
 *
 * @param {string} activeModel - 当前模型 ID。
 * @param {Storage|null} storage - 可选的存储对象。
 * @returns {Record<string, {positivePrompt: string, negativePrompt: string}>} 返回模型提示词缓存。
 */
export const loadModelPromptCache = (activeModel, storage = null) => {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return {};
  }

  let cache = {};
  try {
    const cachedValue = resolvedStorage.getItem(MODEL_PROMPT_CACHE_KEY);
    cache = cachedValue ? normalizePromptCache(JSON.parse(cachedValue)) : {};
  } catch (error) {
    console.error('读取按模型提示词缓存失败，将使用空缓存:', error);
  }

  try {
    const legacyPositive = resolvedStorage.getItem(LEGACY_POSITIVE_PROMPT_KEY);
    const legacyNegative = resolvedStorage.getItem(LEGACY_NEGATIVE_PROMPT_KEY);
    const hasLegacyPrompt = legacyPositive !== null || legacyNegative !== null;

    if (hasLegacyPrompt && activeModel && !cache[activeModel]) {
      cache = {
        ...cache,
        [activeModel]: {
          positivePrompt: legacyPositive ?? '',
          negativePrompt: legacyNegative ?? '',
        },
      };
    }

    // 只有存在有效目标模型且新缓存成功落盘后才删除旧键，避免迁移目标缺失时丢失内容。
    if (hasLegacyPrompt && activeModel && persistModelPromptCache(cache, resolvedStorage)) {
      resolvedStorage.removeItem(LEGACY_POSITIVE_PROMPT_KEY);
      resolvedStorage.removeItem(LEGACY_NEGATIVE_PROMPT_KEY);
    }
  } catch (error) {
    console.error('迁移旧版提示词缓存失败，将保留旧缓存:', error);
  }

  return cache;
};
