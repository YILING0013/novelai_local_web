export const SUPPORTED_LOCALES = Object.freeze(['en-US', 'zh-CN']);
export const DEFAULT_LOCALE = 'en-US';
export const LOCALE_STORAGE_KEY = 'novelai-local.locale';

/**
 * 将任意语言值归一化为应用支持的 locale。
 *
 * Args:
 *   value: 待归一化的语言值。
 *   fallback: 无法识别时使用的回退语言。
 *
 * Returns:
 *   string: `zh-CN` 或 `en-US`。
 */
export function normalizeLocale(value, fallback = DEFAULT_LOCALE) {
  if (SUPPORTED_LOCALES.includes(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return value.trim().toLowerCase().startsWith('zh') ? 'zh-CN' : fallback;
  }

  return fallback;
}

/**
 * 按“合法存储值优先、英文兜底”的规则解析语言。
 *
 * Args:
 *   storedLocale: 从本地存储读取的语言值。
 *
 * Returns:
 *   string: 最终使用的 `zh-CN` 或 `en-US`。
 */
export function resolveLocalePreference(storedLocale) {
  return SUPPORTED_LOCALES.includes(storedLocale)
    ? storedLocale
    : DEFAULT_LOCALE;
}

/**
 * 将 localStorage 的跨标签事件转换为应用语言更新。
 *
 * Args:
 *   event: 包含 key 与 newValue 的 StorageEvent 风格对象。
 *
 * Returns:
 *   string|null: 应更新的语言；无关存储键返回 null。
 */
export function resolveLocaleStorageEvent(event) {
  if (event?.key !== LOCALE_STORAGE_KEY && event?.key !== null) {
    return null;
  }
  return resolveLocalePreference(event?.newValue);
}

/**
 * 递归合并多个语言域字典，后加入的域覆盖同路径值。
 *
 * Args:
 *   domains: 需要合并的嵌套对象列表。
 *
 * Returns:
 *   object: 合并后的新字典对象。
 */
export function mergeLocaleDomains(...domains) {
  const mergeInto = (target, source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return target;
    }

    Object.entries(source).forEach(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = mergeInto({ ...(target[key] || {}) }, value);
      } else {
        target[key] = value;
      }
    });
    return target;
  };

  return domains.reduce((merged, domain) => mergeInto(merged, domain), {});
}

/**
 * 使用点路径从嵌套字典中读取文本。
 *
 * Args:
 *   dictionary: 嵌套语言字典。
 *   key: 例如 `main.pages.settings` 的点路径。
 *
 * Returns:
 *   unknown: 命中的值；未命中时返回 undefined。
 */
export function getTranslationValue(dictionary, key) {
  if (!key || typeof key !== 'string') {
    return undefined;
  }

  return key.split('.').reduce((value, segment) => (
    value && typeof value === 'object' ? value[segment] : undefined
  ), dictionary);
}

/**
 * 将 `{name}` 形式的命名参数替换为传入值。
 *
 * Args:
 *   template: 翻译模板。
 *   params: 命名参数对象。
 *
 * Returns:
 *   string: 完成插值的文本。
 */
export function interpolateTranslation(template, params = {}) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

/**
 * 扁平化字典键，供中英文键完整性测试使用。
 *
 * Args:
 *   dictionary: 嵌套语言字典。
 *   prefix: 当前递归路径。
 *
 * Returns:
 *   string[]: 排序后的叶子键列表。
 */
export function flattenTranslationKeys(dictionary, prefix = '') {
  const keys = [];
  Object.entries(dictionary || {}).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenTranslationKeys(value, path));
    } else {
      keys.push(path);
    }
  });
  return keys.sort();
}
