import { tryParseJsonObject } from './metadataParserCore';
import { defaultWorkspaceShortcuts } from './workspaceShortcuts.mjs';

const modes = ['original', 'scrambled', 'clean', 'custom'];

export const imageExportModes = Object.freeze(modes);
export const imagePreviewSettingsKey = 'novelai:workspace-image-preview';
export const imagePreviewSettingsChanged = 'novelai:workspace-image-preview-changed';
export const transparencyColors = Object.freeze({
  white: '#ffffff', gray: '#808080', green: '#008000', red: '#d32f2f', blue: '#1976d2',
});
export const transparencyBackgrounds = ['none', 'checkerboard', ...Object.keys(transparencyColors), 'custom'];
export const defaultWorkspaceInterfaceSettings = Object.freeze({
  expandedImageShortcuts: false,
  displayImageDrag: true,
  historyImageDrag: true,
  historyFollowSelection: true,
  historyImageFit: 'contain',
  centerNewGeneration: true,
  lockedGestureNavigation: true,
  transparencyBackground: 'checkerboard',
  transparencyCustomColor: '#808080',
  privacyMode: false,
  privacyScope: 'both',
  privacyReveal: 'hold',
  showAdjustmentEntry: true,
  showGalleryEntry: true,
});
export const defaultImagePreviewSettings = Object.freeze({
  ...defaultWorkspaceInterfaceSettings,
  ...defaultWorkspaceShortcuts,
  privacyShortcutCustomized: false,
  copyMode: 'original',
  downloadMode: 'original',
  scrambledMetadata: 'preserve',
  customMetadata: '',
  autoWatermarkEnabled: false,
  autoWatermarkPresetId: '',
});

/**
 * 返回透明像素下方的展示背景，原图与导出画布不写入背景色。
 * @param {object} settings 透明背景选项和自定义色。
 * @param {object} theme 当前的 MUI 主题。
 * @returns {object} 图片容器的背景样式。
 */
export function transparencyBackgroundSx(settings, theme) {
  const { transparencyBackground: background, transparencyCustomColor } = settings;
  if (background === 'none') return {};
  if (background !== 'checkerboard') {
    return { bgcolor: background === 'custom' ? transparencyCustomColor : transparencyColors[background] };
  }
  const dark = theme.palette.mode === 'dark';
  return {
    backgroundColor: dark ? '#33383e' : '#f4f4f4',
    backgroundImage: `conic-gradient(${dark ? '#424950' : '#dedede'} 25%, transparent 0 50%, ${dark ? '#424950' : '#dedede'} 0 75%, transparent 0)`,
    backgroundSize: '16px 16px',
  };
}

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
    const workspace = Object.fromEntries(Object.entries(defaultWorkspaceInterfaceSettings)
      .filter(([, value]) => typeof value === 'boolean')
      .map(([key, value]) => [key, typeof saved[key] === 'boolean' ? saved[key] : value]));
    return {
      ...workspace,
      ...Object.fromEntries(Object.entries(defaultWorkspaceShortcuts)
        .map(([key, value]) => [key, typeof saved[key] === 'string' ? saved[key] : value])),
      historyImageFit: saved.historyImageFit === 'cover' ? 'cover' : 'contain',
      transparencyBackground: transparencyBackgrounds.includes(saved.transparencyBackground)
        ? saved.transparencyBackground : defaults.transparencyBackground,
      transparencyCustomColor: /^#[\da-f]{6}$/i.test(saved.transparencyCustomColor) ? saved.transparencyCustomColor : defaults.transparencyCustomColor,
      privacyScope: ['both', 'display', 'history'].includes(saved.privacyScope) ? saved.privacyScope : defaults.privacyScope,
      privacyReveal: ['hold', 'hover', 'toggle'].includes(saved.privacyReveal) ? saved.privacyReveal : defaults.privacyReveal,
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
 * 合并改动字段并通知当前标签页，避免设置页和历史快捷设置互相覆盖。
 * @param {object} patch 这次操作修改的字段。
 * @returns {object} 保存后的完整设置。
 */
export function writeImagePreviewSettings(patch) {
  const settings = { ...readImagePreviewSettings(), ...('privacyShortcut' in patch && { privacyShortcutCustomized: true }), ...patch };
  localStorage.setItem(imagePreviewSettingsKey, JSON.stringify(settings));
  window.dispatchEvent(new Event(imagePreviewSettingsChanged));
  return settings;
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
