// ImageSaveUtils.js
// 图像保存和文件名生成工具类

import { downloadBlobToFile, downloadUrlToFile } from '@/utils/mediaAssets';

export const DOWNLOAD_NAMING_METHODS = [
  { value: 'seed', labelKey: 'settings.naming.seed' },
  { value: 'prompt32', labelKey: 'settings.naming.prompt32' },
  { value: 'timestamp', labelKey: 'settings.naming.timestamp' },
  { value: 'datetime', labelKey: 'settings.naming.datetime' },
  { value: 'random', labelKey: 'settings.naming.random' },
];

/**
 * 生成随机字符串
 *
 * Args:
 *   length: 随机字符串长度。
 *
 * Returns:
 *   string: 生成的随机字符串。
 */
export const generateRandomString = (length = 8) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};
  
/**
 * 格式化日期为指定格式
 *
 * Args:
 *   date: 日期对象。
 *   format: 日期格式字符串。
 *
 * Returns:
 *   string: 格式化后的日期字符串。
 */
export const formatDate = (date, format = 'yyyyMMdd_HHmmss') => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace('yyyy', year)
    .replace('MM', month)
    .replace('dd', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
};

/**
 * 清理文件名片段中的非法字符。
 *
 * Args:
 *   value: 待清理的文件名片段。
 *   fallback: 清理后为空时使用的兜底文本。
 *
 * Returns:
 *   string: 可安全用于浏览器下载文件名的片段。
 */
export const sanitizeFileNamePart = (value, fallback = 'image') => {
  const sanitized = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  return sanitized || fallback;
};

/**
 * 获取图像的正面提示词片段。
 *
 * Args:
 *   image: 图像对象，优先读取 prompt / positivePrompt / metadata.positivePrompt。
 *
 * Returns:
 *   string: 正面提示词前 32 个字符，缺失时返回空字符串。
 */
export const getPositivePromptNamePart = (image = {}) => {
  const prompt = image.prompt
    || image.positivePrompt
    || image.metadata?.positivePrompt
    || image.metadata?.prompt
    || '';

  return Array.from(String(prompt).trim()).slice(0, 32).join('');
};

const normalizeExtension = (extension = 'png') => (
  String(extension || 'png').replace(/^\./, '').toLowerCase() || 'png'
);
  
/**
 * 根据设置生成下载文件名。
 *
 * Args:
 *   image: 图像对象，包含 seed、prompt、id 等信息。
 *   imageSettings: 图像下载命名设置对象。
 *   options: 额外选项，支持 extension 与 fallbackName。
 *
 * Returns:
 *   string: 生成的文件名。
 */
export const generateFileName = (image = {}, imageSettings = {}, options = {}) => {
  const defaultSettings = {
    fileNamePrefix: 'AI_Image',
    fileNameSuffix: '',
    namingMethod: 'seed',
    randomStringLength: 8,
    includeDateInName: false,
    dateFormat: 'yyyyMMdd_HHmmss'
  };

  const settings = { ...defaultSettings, ...imageSettings };
  const fallbackName = options.fallbackName || image.seed || image.id || Math.floor(Math.random() * 1000000000);
  let coreName = '';

  // 根据命名预设生成主体，手动下载和自动下载共享同一套规则。
  switch (settings.namingMethod) {
    case 'prompt32':
      coreName = getPositivePromptNamePart(image) || fallbackName;
      break;
    case 'timestamp':
      coreName = Date.now();
      break;
    case 'datetime':
      coreName = formatDate(new Date(), 'yyyy-MM-dd_HH-mm-ss');
      break;
    case 'random':
      coreName = generateRandomString(settings.randomStringLength || 8);
      break;
    case 'seed':
    default:
      coreName = image.seed || fallbackName;
      break;
  }

  const nameParts = [
    settings.fileNamePrefix,
    coreName,
    settings.includeDateInName ? formatDate(new Date(), settings.dateFormat) : '',
    settings.fileNameSuffix,
  ]
    .map((part) => sanitizeFileNamePart(part, ''))
    .filter(Boolean);

  const extension = normalizeExtension(options.extension || (image.type === 'video' ? 'mp4' : 'png'));
  return `${nameParts.join('_') || sanitizeFileNamePart(fallbackName)}.${extension}`;
};
  
/**
 * 自动保存图像到本地。
 *
 * Args:
 *   image: 图像对象。
 *   imageSettings: 图像下载命名设置。
 *
 * Returns:
 *   Promise<boolean>: 保存成功时返回 true，失败时返回 false。
 */
export const autoSaveImage = async (image, imageSettings) => {
  try {
    const fileName = generateFileName(image, imageSettings);

    if (image.cachedBlob) {
      await downloadBlobToFile(image.cachedBlob, fileName);
    } else {
      await downloadUrlToFile(image.downloadSrc || image.originalSrc || image.src, fileName);
    }
    
    return true;
  } catch (error) {
    console.error('自动保存图像失败:', error);
    return false;
  }
};
  
/**
 * 从 localStorage 读取图像下载设置。
 *
 * Args:
 *   None.
 *
 * Returns:
 *   Object: 图像下载设置对象。
 */
export const getImageSettings = () => {
  return {
    autoSaveEnabled: localStorage.getItem('autoSaveEnabled') === 'true',
    fileNamePrefix: localStorage.getItem('fileNamePrefix') || 'AI_Image',
    fileNameSuffix: '',
    namingMethod: localStorage.getItem('namingMethod') || 'seed',
    randomStringLength: 8,
    includeDateInName: false,
    dateFormat: 'yyyyMMdd_HHmmss'
  };
};
