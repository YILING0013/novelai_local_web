import { extractExifReaderCandidates } from './ImageMetadataExtractor.js';

const encoder = new TextEncoder();
const textChunkNames = new Set(['tEXt', 'iTXt', 'zTXt']);

/**
 * 保留原 PNG 文本块，并把其他格式的生成参数转为可随 PNG 导出的文本块。
 * @param {File} file 用户导入的原图。
 * @returns {Promise<{chunks:Uint8Array[],keywords:Set<string>}>} 可加到新 PNG 的块和已保留的关键字。
 */
export async function readScrambleMetadata(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const chunks = [];
  const keywords = new Set();
  if (bytes.length >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const dataEnd = offset + 8 + view.getUint32(offset);
      const end = dataEnd + 4;
      if (end > bytes.length) break;
      const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (name === 'IEND') break;
      if (textChunkNames.has(name)) {
        const keywordEnd = bytes.subarray(offset + 8, Math.min(dataEnd, offset + 88)).indexOf(0);
        if (keywordEnd > 0) {
          keywords.add(String.fromCharCode(...bytes.subarray(offset + 8, offset + 8 + keywordEnd)));
          chunks.push(bytes.slice(offset, end));
        }
      }
      offset = end;
    }
  }

  // EXIF 和 XMP 中的生成文本可直接导入。只携带文本，避免让原 EXIF 方向再次旋转新像素。
  for (const { keyword, text } of await extractExifReaderCandidates(buffer)) {
    if (keywords.has(keyword)) continue;
    chunks.push(encodePngTextChunk(keyword, text));
    keywords.add(keyword);
  }
  return { chunks, keywords };
}

/**
 * 编码一个无压缩的 UTF-8 PNG 文本块。
 * @param {string} keyword PNG 文本关键字。
 * @param {string} text 要写入的文本。
 * @returns {Uint8Array} 包含长度、类型、UTF-8 数据和校验值的 iTXt 块。
 */
export function encodePngTextChunk(keyword, text) {
  const data = encoder.encode(`${keyword}\0\0\0\0\0${text}`);
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(encoder.encode('iTXt'), 4);
  chunk.set(data, 8);
  // PNG 的 CRC 覆盖类型和数据，长度和 CRC 字段本身不计入。
  let crc = -1;
  for (let i = 4; i < chunk.length - 4; i++) {
    crc ^= chunk[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(chunk.length - 4, ~crc);
  return chunk;
}
