export const DEFAULT_HISTORY_LIMIT = 60;
export const MAX_HISTORY_LIMIT = 500;

/** 将撤销和重做合计限制在用户设定的步数内，优先保留最近的撤销记录。
 * @param {object} history 当前文档的 past、future 栈。
 * @param {number} limit 可保留的操作总数。
 * @returns {void} 直接裁剪两个历史栈。
 */
export function trimHistory(history, limit) {
  history.past.splice(0, Math.max(0, history.past.length - limit));
  const remaining = limit - history.past.length;
  // 重做栈末尾是下一步，裁掉开头才不会跳过中间操作。
  history.future.splice(0, Math.max(0, history.future.length - remaining));
}
