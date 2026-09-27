export const PAGE_IDS = Object.freeze({
  AI_PAINTING: 'ai-painting',
  ARTIST_REFERENCE: 'artist-reference',
  IMAGE_REFERENCE: 'image-reference',
  PROMPT_TEMPLATE: 'prompt-template',
  SETTINGS: 'settings',
});

export const PAGE_COLOR_DEFAULTS = Object.freeze({
  [PAGE_IDS.AI_PAINTING]: '#00796B',
  [PAGE_IDS.ARTIST_REFERENCE]: '#7B1FA2',
  [PAGE_IDS.IMAGE_REFERENCE]: '#1976D2',
  [PAGE_IDS.PROMPT_TEMPLATE]: '#00838F',
  [PAGE_IDS.SETTINGS]: '#E64A19',
});

export const LEGACY_PAGE_COLOR_NAMES = Object.freeze({
  [PAGE_IDS.AI_PAINTING]: ['AI 绘画'],
  [PAGE_IDS.ARTIST_REFERENCE]: ['画师串参考'],
  [PAGE_IDS.IMAGE_REFERENCE]: ['图片参考'],
  [PAGE_IDS.PROMPT_TEMPLATE]: ['提示词模板'],
  [PAGE_IDS.SETTINGS]: ['设置'],
});

/**
 * 获取稳定页面颜色存储键。
 *
 * Args:
 *   pageId: 稳定页面 ID。
 *
 * Returns:
 *   string: localStorage 使用的完整键名。
 */
export function getPageColorStorageKey(pageId) {
  return `pageColor_${pageId}`;
}

/**
 * 将旧版中文显示名颜色键迁移为稳定 ID 键。
 *
 * Args:
 *   storage: 实现 getItem/setItem/removeItem 的存储对象。
 *
 * Returns:
 *   number: 成功迁移的键数量。
 */
export function migrateLegacyPageColors(storage) {
  if (!storage) {
    return 0;
  }

  let migrated = 0;
  Object.entries(LEGACY_PAGE_COLOR_NAMES).forEach(([pageId, legacyNames]) => {
    const currentKey = getPageColorStorageKey(pageId);
    let currentValue = storage.getItem(currentKey);

    legacyNames.forEach((legacyName) => {
      const legacyKey = getPageColorStorageKey(legacyName);
      const legacyValue = storage.getItem(legacyKey);
      if (!currentValue && legacyValue) {
        storage.setItem(currentKey, legacyValue);
        currentValue = legacyValue;
        migrated += 1;
      }
      if (legacyValue !== null) {
        storage.removeItem(legacyKey);
      }
    });
  });
  return migrated;
}

/**
 * 读取页面颜色并使用页面默认颜色兜底。
 *
 * Args:
 *   storage: localStorage 风格的存储对象。
 *   pageId: 稳定页面 ID。
 *   fallback: 未保存颜色时的回退色。
 *
 * Returns:
 *   string: 页面颜色。
 */
export function readPageColor(storage, pageId, fallback = '#00796B') {
  return storage?.getItem(getPageColorStorageKey(pageId))
    || PAGE_COLOR_DEFAULTS[pageId]
    || fallback;
}
