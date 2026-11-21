import { extractImageMetadata } from '@/components/ai-painting/tools/ImageTools/ImageMetadataExtractor';

/**
 * 用图库的图片解析器读取生成参数或保留原名的元数据字段。
 * @param {Blob} blob 原图。
 * @param {string} filename 原始文件名。
 * @param {boolean} asFields 是否读取可编辑的原字段。
 * @returns {Promise<object|null>} 图片元数据。
 */
export async function readGalleryImageMetadata(blob, filename, asFields = false) {
  const url = URL.createObjectURL(blob);
  try {
    return await extractImageMetadata(new File([blob], filename, { type: blob.type }), url, asFields);
  } finally {
    URL.revokeObjectURL(url);
  }
}
