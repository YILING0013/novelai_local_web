const {
  normalizeExifText,
  parseMetadataCandidates,
} = require('./metadataParserCore');

let pako;
let ExifReader;
let extractChunks;
let pngChunkText;

try {
  pako = require('pako');
} catch (_error) {
  console.warn('pako 未安装，NovelAI stealth 元数据提取不可用');
}

try {
  ExifReader = require('exifreader');
} catch (_error) {
  console.warn('exifreader 未安装，标准图像元数据提取不可用');
}

try {
  extractChunks = require('png-chunks-extract');
} catch (_error) {
  console.warn('png-chunks-extract 未安装，PNG 文本块兜底提取不可用');
}

try {
  pngChunkText = require('png-chunk-text');
} catch (_error) {
  console.warn('png-chunk-text 未安装，PNG tEXt 兜底解码不可用');
}

export const NOVELAI_STEALTH_KEYWORD = 'NovelAI Stealth';

const PNG_TEXT_KEYWORDS = new Set([
  'Comment',
  'Source',
  'Software',
  'parameters',
  'UserComment',
  'ImageDescription',
  'Description',
  'prompt',
]);

const decoderCache = new Map();

/**
 * 获取指定编码的 TextDecoder。
 *
 * @param {string} encoding 文本编码名。
 * @returns {TextDecoder} 可复用的解码器。
 */
const getDecoder = (encoding = 'utf-8') => {
  if (!decoderCache.has(encoding)) {
    decoderCache.set(encoding, new TextDecoder(encoding));
  }

  return decoderCache.get(encoding);
};

/**
 * 将字节数组解码为字符串。
 *
 * @param {Uint8Array|number[]} bytes 原始字节。
 * @param {string} encoding 文本编码。
 * @returns {string} 解码后的字符串。
 */
const decodeBytes = (bytes, encoding = 'utf-8') => {
  if (!bytes || bytes.length === 0) {
    return '';
  }

  return getDecoder(encoding).decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
};

/**
 * 读取 PNG 文本块中的空字节分隔字符串。
 *
 * @param {Uint8Array} data PNG chunk 数据。
 * @param {number} start 读取起点。
 * @param {string} encoding 文本编码。
 * @returns {{value:string,next:number}} 字符串和下一个读取位置。
 */
const readNullTerminatedString = (data, start = 0, encoding = 'latin1') => {
  let end = start;
  while (end < data.length && data[end] !== 0) {
    end += 1;
  }

  return {
    value: decodeBytes(data.slice(start, end), encoding),
    next: Math.min(end + 1, data.length),
  };
};

/**
 * 解码 PNG iTXt 文本块。
 *
 * @param {Uint8Array} data PNG iTXt chunk 数据。
 * @returns {{keyword:string,text:string}|null} 解码后的文本块。
 */
const decodeITxtChunk = (data) => {
  const keyword = readNullTerminatedString(data, 0, 'latin1');
  if (!keyword.value || keyword.next + 2 > data.length) {
    return null;
  }

  const compressionFlag = data[keyword.next];
  const compressionMethod = data[keyword.next + 1];
  let cursor = keyword.next + 2;
  cursor = readNullTerminatedString(data, cursor, 'latin1').next;
  cursor = readNullTerminatedString(data, cursor, 'utf-8').next;

  let textBytes = data.slice(cursor);
  if (compressionFlag === 1) {
    if (!pako || compressionMethod !== 0) {
      return null;
    }
    textBytes = pako.inflate(textBytes);
  }

  return {
    keyword: keyword.value,
    text: decodeBytes(textBytes, 'utf-8'),
  };
};

/**
 * 解码 PNG zTXt 文本块。
 *
 * @param {Uint8Array} data PNG zTXt chunk 数据。
 * @returns {{keyword:string,text:string}|null} 解码后的文本块。
 */
const decodeZTxtChunk = (data) => {
  const keyword = readNullTerminatedString(data, 0, 'latin1');
  if (!keyword.value || keyword.next >= data.length || !pako) {
    return null;
  }

  const compressionMethod = data[keyword.next];
  if (compressionMethod !== 0) {
    return null;
  }

  const inflated = pako.inflate(data.slice(keyword.next + 1));
  return {
    keyword: keyword.value,
    text: decodeBytes(inflated, 'latin1'),
  };
};

/**
 * 解码 PNG 文本块。
 *
 * @param {{name:string,data:Uint8Array}} chunk PNG chunk。
 * @returns {{keyword:string,text:string}|null} 解码后的文本块。
 */
const decodePngTextChunk = (chunk) => {
  try {
    if (chunk.name === 'tEXt') {
      return pngChunkText ? pngChunkText.decode(chunk.data) : null;
    }
    if (chunk.name === 'iTXt') {
      return decodeITxtChunk(chunk.data);
    }
    if (chunk.name === 'zTXt') {
      return decodeZTxtChunk(chunk.data);
    }
  } catch (error) {
    console.warn(`PNG ${chunk.name} 文本块解码失败:`, error);
  }

  return null;
};

/**
 * 通过 PNG chunk 手动读取文本元数据，作为 ExifReader 的兜底。
 *
 * @param {File} file 图像文件。
 * @returns {Promise<Array<{keyword:string,text:string,source:string,weight:number}>>} 候选元数据。
 */
const extractPngChunkCandidates = async (file) => {
  if (!extractChunks || !pngChunkText || file.type !== 'image/png') {
    return [];
  }

  try {
    const buf = await file.arrayBuffer();
    const chunks = extractChunks(new Uint8Array(buf));

    return chunks
      .filter((chunk) => ['tEXt', 'iTXt', 'zTXt'].includes(chunk.name))
      .map(decodePngTextChunk)
      .filter(Boolean)
      .map((chunk) => ({
        keyword: chunk.keyword === NOVELAI_STEALTH_KEYWORD ? 'Comment' : chunk.keyword,
        text: chunk.text,
        source: `png:${chunk.keyword}`,
        weight: chunk.keyword === NOVELAI_STEALTH_KEYWORD ? 45 : chunk.keyword === 'Comment' ? 25 : 10,
      }));
  } catch (error) {
    console.warn('PNG 文本块兜底提取失败:', error);
    return [];
  }
};

/**
 * 从 ExifReader 标签对象中提取可解析文本。
 *
 * @param {unknown} tag ExifReader 标签值。
 * @returns {Array<string>} 候选文本。
 */
const extractTextsFromTag = (tag) => {
  if (tag === undefined || tag === null) {
    return [];
  }

  const values = [];
  if (typeof tag === 'string' || typeof tag === 'number' || Array.isArray(tag)) {
    values.push(normalizeExifText(tag));
  } else if (typeof tag === 'object') {
    if ('description' in tag) values.push(normalizeExifText(tag.description));
    if ('value' in tag) values.push(normalizeExifText(tag.value));
  }

  return [...new Set(values.filter(Boolean))];
};

/**
 * 判断标签名是否可能包含 AI 生成参数。
 *
 * @param {string} keyword 标签名。
 * @returns {boolean} 如果是可解析候选则返回 true。
 */
const isLikelyMetadataKey = (keyword) => {
  if (!keyword) {
    return false;
  }

  const normalized = keyword.replace(/\s*\(.+\)\s*$/, '');
  return PNG_TEXT_KEYWORDS.has(normalized);
};

/**
 * 收集 ExifReader 分组里的候选文本。
 *
 * @param {object} group 标签分组。
 * @param {string} source 来源名称。
 * @param {number} baseWeight 基础权重。
 * @returns {Array<{keyword:string,text:string,source:string,weight:number}>} 候选元数据。
 */
const collectGroupCandidates = (group, source, baseWeight) => {
  if (!group || typeof group !== 'object') {
    return [];
  }

  const candidates = [];
  Object.entries(group).forEach(([keyword, tag]) => {
    if (!isLikelyMetadataKey(keyword)) {
      return;
    }

    extractTextsFromTag(tag).forEach((text) => {
      candidates.push({
        // NovelAI 的 JPEG 使用 EXIF Software 保存 PNG Source 中的模型名称。
        keyword: source === 'exif' && keyword === 'Software' ? 'Source' : keyword.replace(/\s*\(.+\)\s*$/, ''),
        text,
        source: `${source}:${keyword}`,
        weight: baseWeight,
      });
    });
  });

  return candidates;
};

/**
 * 使用 ExifReader 读取标准 PNG/EXIF/XMP 元数据。
 *
 * @param {File|ArrayBuffer} file 图像文件或原始字节。
 * @returns {Promise<Array<{keyword:string,text:string,source:string,weight:number}>>} 候选元数据。
 */
export const extractExifReaderCandidates = async (file) => {
  if (!ExifReader) {
    return [];
  }

  try {
    const tags = await ExifReader.load(file, { expanded: true, async: true });

    return [
      ...collectGroupCandidates(tags.pngText, 'pngText', 35),
      ...collectGroupCandidates(tags.png, 'png', 30),
      ...collectGroupCandidates(tags.exif, 'exif', 25),
      ...collectGroupCandidates(tags.xmp, 'xmp', 20),
      ...collectGroupCandidates(tags.iptc, 'iptc', 15),
      ...collectGroupCandidates(tags, 'root', 10),
    ];
  } catch (error) {
    if (error?.name !== 'MetadataMissingError') {
      console.warn('ExifReader 元数据读取失败:', error);
    }
    return [];
  }
};

/**
 * 按 NovelAI 官方脚本的 alpha.T 顺序读取隐写生成参数。
 * @param {ImageData} imageData 行优先的原始 RGBA 像素。
 * @returns {object|null} 完整的隐写 JSON，未检测到时为 null。
 */
export function readStealthMetadata({ data, width, height }) {
  const magic = 'stealth_pngcomp';
  const availableBytes = Math.floor(width * height / 8);
  if (availableBytes < magic.length + 4) return null;
  let x = 0, y = 0;
  const readByte = () => {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      byte = (byte << 1) | (data[(y * width + x) * 4 + 3] & 1);
      if (++y === height) { y = 0; x++; }
    }
    return byte;
  };
  for (let i = 0; i < magic.length; i++) {
    if (readByte() !== magic.charCodeAt(i)) return null;
  }
  let bitLength = 0;
  for (let i = 0; i < 4; i++) bitLength = bitLength * 256 + readByte();
  const byteLength = bitLength / 8;
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength > availableBytes - magic.length - 4) return null;

  try {
    const gzipData = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) gzipData[i] = readByte();
    return JSON.parse(decodeBytes(pako.ungzip(gzipData), 'utf-8'));
  } catch (error) {
    console.warn('NovelAI stealth 元数据读取失败:', error);
    return null;
  }
}

/**
 * 从 data URL 的 alpha LSB 中读取 NovelAI stealth PNG metadata。
 *
 * @param {string} dataUrl 图像 data URL。
 * @returns {Promise<object|null>} stealth JSON 对象。
 */
const extractStealthMetadata = async (dataUrl) => {
  if (!pako || !dataUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    return readStealthMetadata(ctx.getImageData(0, 0, img.width, img.height));
  } catch (error) {
    console.warn('NovelAI stealth 元数据读取失败:', error);
    return null;
  }
};

/**
 * 从图像中提取 AI 生成参数元数据。
 *
 * @param {File} file 图像文件。
 * @param {string} dataUrl 图像 data URL，用于读取 stealth alpha 数据。
 * @returns {Promise<object|null>} 可应用到 UI 的参数对象，未识别时返回 null。
 */
export const extractImageMetadata = async (file, dataUrl) => {
  if (!file) {
    return null;
  }

  const candidates = [
    ...(await extractExifReaderCandidates(file)),
    ...(await extractPngChunkCandidates(file)),
  ];

  const stealthMetadata = await extractStealthMetadata(dataUrl);
  if (stealthMetadata) {
    candidates.push({
      keyword: 'Comment',
      value: stealthMetadata,
      source: 'stealth_pngcomp',
      weight: 45,
    });
  }

  return parseMetadataCandidates(candidates);
};
