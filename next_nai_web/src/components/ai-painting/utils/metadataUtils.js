import { extractImageMetadata } from '../tools/ImageTools/ImageMetadataExtractor';

export const METADATA_ERROR_CODES = Object.freeze({
  IMAGE_FETCH_FAILED: 'METADATA_IMAGE_FETCH_FAILED',
});

const METADATA_KEYS = [
  'width',
  'height',
  'steps',
  'guidanceScale',
  'scale',
  'seed',
  'sampler',
  'noiseSchedule',
  'noise_schedule',
  'promptGuidanceRescale',
  'cfg_rescale',
  'positivePrompt',
  'negativePrompt',
  'prompt',
  'uc',
  'characterTabs',
  'smea',
  'sm',
  'dyn',
  'sm_dyn',
  'v4_prompt',
  'v4_negative_prompt',
];

export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/**
 * 根据文件名推断图片 MIME 类型。
 *
 * @param {string} fileName 文件名或 URL。
 * @returns {string} 可用于 File 构造的 MIME 类型。
 */
const inferImageMimeType = (fileName = '') => {
  const ext = fileName.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    bmp: 'image/bmp',
  };

  return mimeMap[ext] || 'image/png';
};

/**
 * 判断 File/Blob 是否应作为图片尝试读取。
 *
 * @param {File|Blob} file 文件对象。
 * @returns {boolean} 如果看起来是图片则返回 true。
 */
const isLikelyImageFile = (file) => {
  if (!file) {
    return false;
  }

  // 有些远端 Blob 不带 Content-Type，此时用文件名兜底判断。
  return file.type?.startsWith('image/')
    || /\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(file.name || '');
};

const dataUrlToFile = async (dataUrl, fileName = `image-${Date.now()}.png`) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || inferImageMimeType(fileName) });
};

export const hasUsableImageMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }

  return METADATA_KEYS.some((key) => {
    const value = metadata[key];

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value !== undefined && value !== null && value !== '';
  });
};

export const extractMetadataFromFile = async (file) => {
  if (!isLikelyImageFile(file)) {
    return null;
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    const metadata = await extractImageMetadata(file, dataUrl);

    return hasUsableImageMetadata(metadata) ? metadata : null;
  } catch (error) {
    console.error('读取图像元数据失败:', error);
    return null;
  }
};

export const extractMetadataFromImageSrc = async (imageSrc, fileName = `image-${Date.now()}.png`) => {
  if (!imageSrc) {
    return null;
  }

  try {
    if (imageSrc.startsWith('data:')) {
      const file = await dataUrlToFile(imageSrc, fileName);
      const metadata = await extractImageMetadata(file, imageSrc);
      return hasUsableImageMetadata(metadata) ? metadata : null;
    }

    const response = await fetch(imageSrc);
    if (!response.ok) {
      const error = new Error(METADATA_ERROR_CODES.IMAGE_FETCH_FAILED);
      error.code = METADATA_ERROR_CODES.IMAGE_FETCH_FAILED;
      throw error;
    }

    const blob = await response.blob();
    if (!blob.type?.startsWith('image/') && !/\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(fileName || imageSrc)) {
      return null;
    }

    const file = new File([blob], fileName, { type: blob.type || inferImageMimeType(fileName || imageSrc) });
    const dataUrl = await fileToDataUrl(file);
    const metadata = await extractImageMetadata(file, dataUrl);

    return hasUsableImageMetadata(metadata) ? metadata : null;
  } catch (error) {
    console.error('从图像地址读取元数据失败:', error);
    return null;
  }
};
