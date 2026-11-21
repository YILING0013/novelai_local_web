import { tryParseJsonObject } from './metadataParserCore';

const modes = ['original', 'scrambled', 'clean', 'custom'];

export const imageExportModes = Object.freeze(modes);
export const imagePreviewSettingsKey = 'novelai:workspace-image-preview';
export const defaultImagePreviewSettings = Object.freeze({
  privacyMode: false,
  privacyShortcut: 'Ctrl+Shift+KeyH',
  privacyShortcutCustomized: false,
  copyMode: 'original',
  downloadMode: 'original',
  scrambledMetadata: 'preserve',
  customMetadata: '',
  autoWatermarkEnabled: false,
  autoWatermarkPresetId: '',
});

/**
 * 读取工作区预览和导出偏好，浏览器禁用存储时使用默认值。
 * @returns {object} 预览设置。
 */
export function readImagePreviewSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(imagePreviewSettingsKey)) || {};
    const defaults = defaultImagePreviewSettings;
    const customShortcut = typeof saved.privacyShortcut === 'string' &&
      (saved.privacyShortcutCustomized === true || !['Alt+Shift+KeyP', defaults.privacyShortcut].includes(saved.privacyShortcut));
    return {
      privacyMode: saved.privacyMode === true,
      privacyShortcut: customShortcut ? saved.privacyShortcut : defaults.privacyShortcut,
      privacyShortcutCustomized: customShortcut,
      copyMode: modes.includes(saved.copyMode) ? saved.copyMode : defaults.copyMode,
      downloadMode: modes.includes(saved.downloadMode) ? saved.downloadMode : defaults.downloadMode,
      scrambledMetadata: ['preserve', 'clean', 'custom'].includes(saved.scrambledMetadata) ? saved.scrambledMetadata : defaults.scrambledMetadata,
      customMetadata: typeof saved.customMetadata === 'string' ? saved.customMetadata : defaults.customMetadata,
      autoWatermarkEnabled: saved.autoWatermarkEnabled === true,
      autoWatermarkPresetId: typeof saved.autoWatermarkPresetId === 'string' ? saved.autoWatermarkPresetId : '',
    };
  } catch {
    return defaultImagePreviewSettings;
  }
}

/**
 * 把键盘事件转为可存储的快捷键。
 * @param {KeyboardEvent} event 键盘事件。
 * @returns {string} 含修饰键和物理按键的组合。
 */
export function getPrivacyShortcut(event) {
  const { ctrlKey, altKey, shiftKey, metaKey, code } = event;
  if (!code || /^(Control|Alt|Shift|Meta)/.test(code) || ['Escape', 'Tab', 'Enter', 'Space'].includes(code)) return '';
  if (!ctrlKey && !altKey && !metaKey && !/^F\d+$/.test(code)) return '';
  return [ctrlKey && 'Ctrl', altKey && 'Alt', shiftKey && 'Shift', metaKey && 'Meta', code].filter(Boolean).join('+');
}

/**
 * 校验自定义字段名是否符合 PNG 文本关键字限制。
 * @param {string} key 需要写入 PNG 的字段名。
 * @returns {boolean} 字段名是否有效。
 */
export function isCustomMetadataKey(key) {
  return /^[ -~]{1,79}$/.test(key) && key.trim() === key && !key.includes('  ');
}

/**
 * 用图库采用的 JSON 解析方式读取自定义字段，并检查 PNG 字段名。
 * @param {string} text 用户编辑的 JSON 对象。
 * @returns {object|null} 自定义字段，或格式错误时的 null。
 */
export function parseCustomImageMetadata(text) {
  const metadata = text.trim() ? tryParseJsonObject(text) : {};
  return metadata && Object.keys(metadata).every(isCustomMetadataKey) ? metadata : null;
}

/**
 * 将预览图按指定方式导出。剪贴板和拖动需要统一的 PNG 类型。
 * @param {Blob} blob 原始图片。
 * @param {string} mode 原图、混淆、清理或自定义。
 * @param {object} settings 自定义字段与混淆元数据策略。
 * @param {boolean} asPng 需要将原始图片也转为 PNG。
 * @returns {Promise<Blob>} 文件字节。
 */
export async function exportPreviewImage(blob, mode, settings, asPng) {
  if (mode === 'original' && (!asPng || blob.type === 'image/png')) return blob;
  const metadataMode = mode === 'scrambled' ? settings.scrambledMetadata : mode === 'original' ? 'preserve' : mode;
  const customMetadata = metadataMode === 'custom' ? parseCustomImageMetadata(settings.customMetadata) : null;
  if (metadataMode === 'custom' && !customMetadata) throw new Error('invalidCustomMetadata');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./imageScramble.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.blob) resolve(data.blob);
      else reject(new Error(data.error));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('imageToolFailed'));
    };
    worker.postMessage({ file: blob, exportMode: mode, metadataMode, customMetadata });
  });
}
