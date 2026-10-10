import { downloadBlobToFile } from '../../utils/mediaAssets.js';

export const NOTE_EXPORT_INVALID_RESPONSE = 'NOTE_EXPORT_INVALID_RESPONSE';

/**
 * 校验笔记导出响应并下载 UTF-8 JSON 文件。
 *
 * Args:
 *   response: 后端 export_texts 接口响应。
 *
 * Returns:
 *   Promise<void>: 浏览器下载触发后完成。
 */
export async function downloadNotesExport(response) {
  if (!Array.isArray(response?.texts)) {
    const error = new Error(NOTE_EXPORT_INVALID_RESPONSE);
    error.code = NOTE_EXPORT_INVALID_RESPONSE;
    throw error;
  }

  const blob = new Blob(
    [JSON.stringify(response.groups === undefined ? response.texts : { texts: response.texts, groups: response.groups })],
    { type: 'application/json;charset=utf-8' },
  );
  await downloadBlobToFile(blob, 'notes_export.json');
}
