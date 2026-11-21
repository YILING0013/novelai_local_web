import { extractExifReaderCandidates } from './ImageMetadataExtractor.js';

const encoder = new TextEncoder();
const textChunkNames = new Set(['tEXt', 'iTXt', 'zTXt']);
const standardMetadataChunks = new Set(['eXIf', 'pHYs', 'tIME']);

function* pngChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const dataEnd = offset + 8 + view.getUint32(offset);
    const end = dataEnd + 4;
    if (end > bytes.length) return;
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    yield { name, offset, dataEnd, end };
    if (name === 'IEND') return;
    offset = end;
  }
}

/**
 * 保留原 PNG 文本块，并把其他格式的生成参数转为可随 PNG 导出的文本块。
 * @param {File} file 用户导入的原图。
 * @param {boolean} includeStandard 是否同时保留原 PNG 的 EXIF、像素密度和时间信息。
 * @returns {Promise<object>} PNG 文字块、标准元数据块和已保留的关键字。
 */
export async function readScrambleMetadata(file, includeStandard = false) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const keywords = new Set();
  const ancillary = new Map();
  let isPng = false;
  for (const { name, offset, dataEnd, end } of pngChunks(bytes)) {
    isPng = true;
    if (textChunkNames.has(name)) {
      const keywordEnd = bytes.subarray(offset + 8, Math.min(dataEnd, offset + 88)).indexOf(0);
      if (keywordEnd > 0) {
        keywords.add(String.fromCharCode(...bytes.subarray(offset + 8, offset + 8 + keywordEnd)));
        chunks.push(bytes.slice(offset, end));
      }
    } else if (includeStandard && standardMetadataChunks.has(name)) {
      ancillary.set(name, bytes.slice(offset, end));
    }
  }

  // EXIF 和 XMP 中的生成文本可直接导入。只携带文本，避免让原 EXIF 方向再次旋转新像素。
  for (const { keyword, text } of await extractExifReaderCandidates(buffer)) {
    if (keywords.has(keyword)) continue;
    chunks.push(encodePngTextChunk(keyword, text));
    keywords.add(keyword);
  }
  return { chunks, keywords, ancillary, isPng };
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

/**
 * 将文本块写入 Canvas 编码后的 PNG，保留像素编码。
 * @param {Blob} png Canvas 编码出的 PNG。
 * @param {Uint8Array[]} chunks 要写入的 PNG 文本块。
 * @returns {Blob} 带文本的 PNG。
 */
export function appendPngTextChunks(png, chunks) {
  return chunks.length ? new Blob([png.slice(0, -12), ...chunks, png.slice(-12)], { type: 'image/png' }) : png;
}

/**
 * 将原 PNG 标准元数据写到像素块前，替换 Canvas 可能写入的同类块。
 * @param {Blob} png Canvas 编码后的 PNG。
 * @param {Map<string, Uint8Array>} chunks 需要保留的原图元数据。
 * @returns {Promise<Blob>} 带原图标准元数据的 PNG。
 */
export async function restorePngMetadataChunks(png, chunks) {
  if (!chunks.size) return png;
  const bytes = new Uint8Array(await png.arrayBuffer());
  const parts = [png.slice(0, 8)];
  for (const { name, offset, end } of pngChunks(bytes)) {
    if (!chunks.has(name)) parts.push(png.slice(offset, end));
    if (name === 'IHDR') parts.push(...chunks.values());
  }
  return new Blob(parts, { type: 'image/png' });
}
