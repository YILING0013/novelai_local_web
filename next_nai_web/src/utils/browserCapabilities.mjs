import { v4 as uuidv4 } from 'uuid';

/**
 * 使用 HTTP 页面也可用的随机源创建 UUID，供生成批次与参考图标识复用。
 * @returns {string} 随机 UUID v4。
 */
export function createClientId() {
  return uuidv4({ random: crypto.getRandomValues(new Uint8Array(16)) });
}

/**
 * 复制文字；局域网 HTTP 没有 Clipboard API 时在当前对话框内选择文本复制。
 * @param {string} text 要复制的文字。
 * @returns {Promise<void>} 完成复制；浏览器拒绝时抛出错误供界面提示。
 */
export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 权限被拒绝时仍尝试浏览器的用户点击复制能力。
    }
  }

  const previousFocus = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;font-size:16px';
  // MUI 对话框会限制焦点范围，临时输入框必须放在同一对话框内。
  (previousFocus?.closest('[role="dialog"]') || document.body).appendChild(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw new Error('CLIPBOARD_COPY_FAILED');
  } finally {
    input.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
