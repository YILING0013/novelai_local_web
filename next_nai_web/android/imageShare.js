import { Capacitor, registerPlugin } from '@capacitor/core';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';
import { withTransfer } from './transport';

export const imageShare = registerPlugin('NovelAIImageShare');

/**
 * 读取经原生层验证的分享图片，保留原始字节和格式。
 * @returns {Promise<{file?: File, error?: string}>} 图片、错误码或空队列结果。
 */
export async function nextSharedImage() {
  const item = await imageShare.nextImage();
  if (!item?.id) return item || {};
  try {
    const blob = await fetchUrlAsBlob(Capacitor.convertFileSrc(item.fileUri));
    return { file: new File([blob], item.name, { type: item.mime }) };
  } catch {
    return { error: 'SHARED_IMAGE_INVALID' };
  } finally {
    await imageShare.releaseImage({ id: item.id });
  }
}

/**
 * 用系统分享面板发送应用中的原图。
 * @param {string} source 当前图片或对应原图地址。
 * @param {string} name 用户看到的文件名。
 * @param {string} title 系统分享面板标题。
 * @returns {Promise<void>} 分享面板关闭后返回。
 */
export async function shareImage(source, name, title) {
  const blob = await fetchUrlAsBlob(source);
  await withTransfer(blob, id => imageShare.shareImage({ id, name, title }));
}
