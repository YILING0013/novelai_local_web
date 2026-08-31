const BASE64_MARKER = ';base64,';

export const MEDIA_ASSET_ERROR_CODES = Object.freeze({
  URL_REQUIRED: 'MEDIA_ASSET_URL_REQUIRED',
  DOWNLOAD_FAILED: 'MEDIA_ASSET_DOWNLOAD_FAILED',
  CONTENT_REQUIRED: 'MEDIA_ASSET_CONTENT_REQUIRED',
  OBJECT_URL_FAILED: 'MEDIA_ASSET_OBJECT_URL_FAILED',
});

/**
 * 创建携带稳定客户端错误码的媒体资源异常。
 *
 * Args:
 *   code: 供界面本地化的稳定错误码。
 *   details: 可选的非敏感结构化信息。
 *
 * Returns:
 *   Error: message 与 code 均为稳定错误码的异常对象。
 */
const createMediaAssetError = (code, details = {}) => {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
};

export const isObjectUrl = (value = '') => typeof value === 'string' && value.startsWith('blob:');

export const revokeObjectUrl = (value) => {
  if (typeof window === 'undefined' || !isObjectUrl(value)) {
    return;
  }

  URL.revokeObjectURL(value);
};

const decodeBase64Payload = (base64Payload) => {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return window.atob(base64Payload);
  }

  return Buffer.from(base64Payload, 'base64').toString('binary');
};

export const createBlobFromBase64 = (input, fallbackMimeType = 'image/png') => {
  if (!input) {
    return null;
  }

  let mimeType = fallbackMimeType;
  let base64Payload = input;

  if (input.startsWith('data:')) {
    const [header, payload = ''] = input.split(BASE64_MARKER);
    mimeType = header.slice(5) || fallbackMimeType;
    base64Payload = payload;
  }

  const binary = decodeBase64Payload(base64Payload);
  const byteArray = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    byteArray[index] = binary.charCodeAt(index);
  }

  return new Blob([byteArray], { type: mimeType });
};

export const createObjectUrlFromBlob = (blob) => {
  if (typeof window === 'undefined' || !blob) {
    return null;
  }

  return URL.createObjectURL(blob);
};

export const createObjectUrlFromBase64 = (input, fallbackMimeType = 'image/png') => {
  const blob = createBlobFromBase64(input, fallbackMimeType);
  return createObjectUrlFromBlob(blob);
};

export const fetchUrlAsBlob = async (url) => {
  if (!url) {
    throw createMediaAssetError(MEDIA_ASSET_ERROR_CODES.URL_REQUIRED);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw createMediaAssetError(MEDIA_ASSET_ERROR_CODES.DOWNLOAD_FAILED, {
      status: response.status,
    });
  }

  return response.blob();
};

const triggerBrowserDownload = (url, fileName) => {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
};

export const downloadBlobToFile = async (blob, fileName) => {
  if (!blob) {
    throw createMediaAssetError(MEDIA_ASSET_ERROR_CODES.CONTENT_REQUIRED);
  }

  const objectUrl = createObjectUrlFromBlob(blob);

  if (!objectUrl) {
    throw createMediaAssetError(MEDIA_ASSET_ERROR_CODES.OBJECT_URL_FAILED);
  }

  try {
    triggerBrowserDownload(objectUrl, fileName);
  } finally {
    setTimeout(() => revokeObjectUrl(objectUrl), 0);
  }
};

export const downloadUrlToFile = async (url, fileName) => {
  if (!url) {
    throw createMediaAssetError(MEDIA_ASSET_ERROR_CODES.URL_REQUIRED);
  }

  if (isObjectUrl(url) || url.startsWith('data:')) {
    triggerBrowserDownload(url, fileName);
    return;
  }

  const blob = await fetchUrlAsBlob(url);
  await downloadBlobToFile(blob, fileName);
};
