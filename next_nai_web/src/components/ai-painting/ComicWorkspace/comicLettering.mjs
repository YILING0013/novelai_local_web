import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createComicElement, fitComicTextFontSize } from './comicElements.mjs';
import { comicAIImagePlacement } from './comicAI.mjs';

/**
 * 只清理用户确认替换的识别框，保留原有气泡轮廓和原图。
 * @param {object} image 原图数据和尺寸。
 * @param {Array<object>} lines 原图坐标中的识别结果。
 * @param {object} assignments 用户为每个识别框指定的替换文字。
 * @returns {Promise<object>} 可应用的底图与独立文字，以及保留原样的复杂背景区域。
 */
export async function replaceComicImageText(image, lines, assignments) {
  const source = new Image();
  source.src = image.dataUrl;
  await source.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const blocks = [];
  for (const [index, line] of lines.entries()) {
    const replacement = assignments[index];
    if (replacement?.action !== 'replace' || !replacement.text.trim() || replacement.text.trim() === line.text) continue;
    const { x, y, width, height } = line.bounds;
    const left = x - 1;
    const top = y - 1;
    const right = x + width;
    const bottom = y + height;
    const samples = [];
    if (left >= 0 && top >= 0 && right < image.width && bottom < image.height) {
      for (let step = 1; step <= 7; step += 1) {
        const sx = x + Math.floor(width * step / 8);
        const sy = y + Math.floor(height * step / 8);
        for (const [px, py] of [[sx, top], [sx, bottom], [left, sy], [right, sy]]) {
          const offset = (py * image.width + px) * 4;
          samples.push(pixels.subarray(offset, offset + 4));
        }
      }
    }
    const rgb = samples.length ? [0, 1, 2].map((channel) => Math.round(samples.reduce((sum, pixel) => sum + pixel[channel], 0) / samples.length)) : [];
    // 彩色场景、气泡边线等复杂背景保留原样，避免用色块盖住线稿。
    const applied = samples.length > 0 && samples.every((pixel) => pixel[3] === 255
      && rgb.every((value, channel) => Math.abs(value - pixel[channel]) <= 25));
    if (applied) {
      context.fillStyle = 'rgb(' + rgb.join(',') + ')';
      context.fillRect(x, y, width, height);
    }
    blocks.push({ id: String(index), bounds: line.bounds, text: replacement.text.trim(), ocrText: line.text,
      direction: replacement.direction, dialogueId: null, needsReview: !applied, applied,
      color: (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) > 145 ? '#111111' : '#ffffff',
      fontSize: 32, confidence: line.confidence });
  }
  const base64 = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1);
  const imageBytes = Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
  const sourceHash = bytesToHex(sha256(imageBytes));
  return {
    cleanedImage: blocks.some((block) => block.applied) ? { ...image, dataUrl: canvas.toDataURL('image/png') } : image,
    result: { sourceHash, blocks, unmatchedDialogueIds: [], ocrReplacement: true },
  };
}

/**
 * 将真实图片上已安全去字的区域转换为漫画文字；参考分镜不参与坐标换算。
 * @param {object} page 接收结果的漫画页。
 * @param {number} sectionId 单页或双页中的目标区。
 * @param {object} image 实际生成图片及其原始像素尺寸。
 * @param {object} result 本地文字重建结果，未去字的待核对块不创建重复文字。
 * @returns {Array<object>} 可保存、导出和继续编辑的独立文字元素。
 */
export function buildComicLetteringElements(page, sectionId, image, result) {
  const placement = comicAIImagePlacement(page, sectionId, image);
  // 仅抹除的区域已写入干净底图，不额外创建空文字层。
  return result.blocks.filter((block) => block.applied && block.text.trim()).map((block) => {
    const bounds = block.layoutBounds || block.bounds;
    const element = createComicElement('text', {
      x: placement.x + bounds.x * placement.scale,
      y: placement.y + bounds.y * placement.scale,
      width: bounds.width * placement.scale,
      height: bounds.height * placement.scale,
    }, {
      name: block.text, text: block.text, color: block.color || '#111111',
      writingMode: block.direction, lineHeight: 1.15,
      dialogueId: block.dialogueId, comicTextBlockId: block.id,
    });
    element.fontSize = fitComicTextFontSize(element, 32 * placement.scale);
    return element;
  });
}
