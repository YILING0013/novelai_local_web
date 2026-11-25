export const defaultWorkspaceShortcuts = Object.freeze({
  previousImageShortcut: 'ArrowLeft',
  nextImageShortcut: 'ArrowRight',
  deleteImageShortcut: 'Delete',
  resetViewShortcut: '',
  adjustImageShortcut: '',
  privacyShortcut: 'Ctrl+Shift+KeyH',
});

/**
 * 把按下的组合键转为稳定的存储值；保留 Tab、Esc 和普通确认键的浏览器行为。
 * @param {KeyboardEvent} event 本次按键。
 * @returns {string} 可用的快捷键，或表示无法录入的空字符串。
 */
export function getWorkspaceShortcut(event) {
  const { code, ctrlKey, altKey, shiftKey, metaKey } = event;
  if (!code || /^(Control|Alt|Shift|Meta)/.test(code) || ['Tab', 'Escape'].includes(code)) return '';
  if (!ctrlKey && !altKey && !metaKey && ['Enter', 'Space', 'Backspace'].includes(code)) return '';
  return [ctrlKey && 'Ctrl', altKey && 'Alt', shiftKey && 'Shift', metaKey && 'Meta', code].filter(Boolean).join('+');
}

/**
 * 用可读的按键名称显示保存的组合键。
 * @param {string} shortcut 已保存的组合键。
 * @returns {string} 显示给用户的按键组合。
 */
export function formatWorkspaceShortcut(shortcut) {
  return shortcut.replace(/\b(Key|Digit)(?=[A-Z0-9](?:$|\+))/g, '')
    .replace(/Arrow(Left|Right|Up|Down)/g, (_, direction) => ({ Left: '←', Right: '→', Up: '↑', Down: '↓' }[direction]));
}
