export const CHARACTER_NAME_MAX_LENGTH = 16;

/**
 * 将角色名称限制为界面允许的最大长度。
 *
 * @param {unknown} value 缓存或输入框中的角色名称。
 * @returns {string} 可安全编辑并且不超过 16 个字符的名称。
 */
export const normalizeCharacterName = (value) => (
  typeof value === 'string' ? value.slice(0, CHARACTER_NAME_MAX_LENGTH) : ''
);

/**
 * 获取角色卡片和位置编辑器共同使用的显示名称。
 *
 * @param {unknown} value 已保存的自定义名称。
 * @param {string} fallback 未设置名称时展示的默认名称。
 * @returns {string} 自定义名称或默认名称。
 */
export const resolveCharacterName = (value, fallback) => (
  normalizeCharacterName(value).trim() || fallback
);
