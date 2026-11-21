import { createClientId } from '../../../../utils/browserCapabilities.mjs';
const previewFileType = 'application/x-novelai-preview-file';
let activePreview = null;

/**
 * 把预览文件关联到本页面的拖拽。Chromium 回传页内拖放时可能只保留自定义类型。
 * @param {DataTransfer} transfer 拖拽开始时可写的数据。
 * @param {File} file 与复制操作使用同一导出方式得到的文件。
 * @returns {string} 结束拖拽时用于释放文件的标识。
 */
export function writePreviewFileDrag(transfer, file) {
  const id = createClientId();
  transfer.setData(previewFileType, id);
  activePreview = { id, file };
  return id;
}

/**
 * 释放指定拖拽暂存的文件。
 * @param {string} id 拖拽开始时生成的标识。
 */
export function clearPreviewFileDrag(id) {
  if (activePreview?.id === id) activePreview = null;
}

/**
 * 判断目标是否可以接收本页预览文件或普通外部文件。
 * @param {DataTransfer|null} transfer 拖拽事件的数据。
 * @returns {boolean} 可处理时返回 true。
 */
export function hasFileDrag(transfer) {
  return Boolean(transfer?.types.includes('Files') || (activePreview && transfer?.types.includes(previewFileType)));
}

/**
 * 在 drop 中读取文件；页内拖拽仅解析当前页面持有的文件。
 * @param {DataTransfer|null} transfer drop 事件的数据。
 * @returns {File[]} 按拖入顺序排列的文件。
 */
export function readDroppedFiles(transfer) {
  if (activePreview && transfer?.getData(previewFileType) === activePreview.id) return [activePreview.file];
  return Array.from(transfer?.files || []);
}
