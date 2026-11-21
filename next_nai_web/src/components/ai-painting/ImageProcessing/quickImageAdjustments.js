import { createClientId } from '../../../utils/browserCapabilities.mjs';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';
import { DEFAULT_ADJUSTMENTS } from './compositor/lib/model';
import { adjustedCanvas, canvasOf, loadImage } from './compositor/lib/renderer';
import { presetStorage } from './compositor/lib/adjustment-presets';
import { NOVELAI_STEALTH_KEYWORD, readStealthMetadata } from '../tools/ImageTools/ImageMetadataExtractor';
import { appendPngTextChunks, encodePngTextChunk, readScrambleMetadata, restorePngMetadataChunks } from '../tools/ImageTools/scrambleMetadata';
import { readImagePreviewSettings } from '../tools/ImageTools/previewImageExport';
import { imageLookAdjustments } from './quickImageLooks';
import { loadSignatureFont, signatureFonts } from './watermarkFonts';

export const defaultImageAdjustments = {
  adjustments: DEFAULT_ADJUSTMENTS,
  colorMatch: null,
  matchStrength: 65,
  look: 'neutral',
  lookStrength: 100,
  mosaic: { style: 'pixel', size: 8, hardness: 80, block: 2 },
  watermarks: [],
};

export const quickPresetLibrary = 'painting-single-image';

/** 读取单图处理预设，包括水印图层。
 * @returns {Promise<object[]>} 当前浏览器中的本地预设。
 */
export async function readQuickImagePresets() {
  return (await presetStorage(undefined, quickPresetLibrary)) || [];
}

/** 保存一个快捷预设，同名时更新旧预设并保留自动水印所引用的 ID。
 * @param {string} name 预设名称。
 * @param {object} settings 单图处理设置。
 * @returns {Promise<object[]>} 更新后的预设库。
 */
export function saveQuickImagePreset(name, settings) {
  return presetStorage((presets) => {
    const existing = presets.find((preset) => preset.name === name);
    const entry = { id: existing?.id || createClientId(), name, settings };
    return existing ? presets.map((preset) => preset.id === entry.id ? entry : preset) : [...presets, entry];
  }, quickPresetLibrary);
}

/** 检查预设是否有启用且能绘制的水印。
 * @param {object} settings 预设或当前图像设置。
 * @returns {boolean} 可用于自动水印时为 true。
 */
export function hasImageWatermark(settings) {
  return settings.watermarks.some((layer) => !layer.hidden && (layer.image || layer.text?.trim()));
}

/** 将图片解码到指定尺寸的画布，保留原宽高比。
 * @param {Blob} blob 原始图像。
 * @param {number} maxSide 最长边上限，默认保持原尺寸。
 * @returns {Promise<HTMLCanvasElement>} 解码后的画布。
 */
export async function imageAdjustmentSource(blob, maxSide = Infinity) {
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = canvasOf(image.width * scale, image.height * scale);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.close();
  }
}

/** 从图像中提取色彩分布，预设只保存均值和标准差。
 * @param {HTMLCanvasElement} source 参考图或当前图的画布。
 * @returns {{mean:number[],deviation:number[]}} RGB 色彩特征。
 */
export function imageColorStatistics(source) {
  const context = canvasOf(48, 48).getContext('2d');
  context.drawImage(source, 0, 0, 48, 48);
  const { data } = context.getImageData(0, 0, 48, 48);
  const sum = [0, 0, 0];
  const squared = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    total += alpha;
    for (let channel = 0; channel < 3; channel++) {
      sum[channel] += data[i + channel] * alpha;
      squared[channel] += data[i + channel] ** 2 * alpha;
    }
  }
  if (!total) return { mean: [0, 0, 0], deviation: [1, 1, 1] };
  const mean = sum.map((value) => value / total);
  return { mean, deviation: squared.map((value, channel) => Math.sqrt(Math.max(1, value / total - mean[channel] ** 2))) };
}

function applyColorMatch(source, target, amount) {
  const current = imageColorStatistics(source);
  const canvas = canvasOf(source.width, source.height);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const scales = target.deviation.map((value, channel) => Math.min(4, value / current.deviation[channel]));
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const original = pixels.data[i + channel];
      const matched = (original - current.mean[channel]) * scales[channel] + target.mean[channel];
      pixels.data[i + channel] = original + (matched - original) * amount / 100;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function applyMosaic(canvas, strokes, settings) {
  const shortSide = Math.min(canvas.width, canvas.height);
  const mask = canvasOf(canvas.width, canvas.height);
  const maskContext = mask.getContext('2d');
  const eraser = strokes.some(({ erase }) => erase) ? canvasOf(canvas.width, canvas.height) : null;
  for (const { points, size, hardness, erase } of strokes) {
    const diameter = size * shortSide / 100;
    const brush = erase ? eraser.getContext('2d') : maskContext;
    if (erase) brush.clearRect(0, 0, mask.width, mask.height);
    brush.lineWidth = diameter;
    brush.lineCap = 'round';
    brush.lineJoin = 'round';
    brush.filter = hardness < 100 ? `blur(${diameter * (100 - hardness) / 350}px)` : 'none';
    brush.beginPath();
    const [{ x, y }] = points;
    brush.moveTo(x * canvas.width, y * canvas.height);
    if (points.length === 1) {
      brush.arc(x * canvas.width, y * canvas.height, diameter / 2, 0, Math.PI * 2);
      brush.fill();
    } else {
      for (const { x, y } of points.slice(1)) brush.lineTo(x * canvas.width, y * canvas.height);
      brush.stroke();
    }
    brush.filter = 'none';
    if (erase) {
      // 先画出带羽化的笔尖，再用其透明度擦除遮罩，避免滤镜参与擦除混合。
      maskContext.globalCompositeOperation = 'destination-out';
      maskContext.drawImage(eraser, 0, 0);
      maskContext.globalCompositeOperation = 'source-over';
    }
  }
  const layer = canvasOf(canvas.width, canvas.height);
  const context = layer.getContext('2d');
  const block = Math.max(2, settings.block * shortSide / 100);
  if (settings.style === 'blur') {
    context.filter = `blur(${block * 0.8}px)`;
    context.drawImage(canvas, 0, 0);
    context.filter = 'none';
  } else {
    const tiny = canvasOf(canvas.width / block, canvas.height / block);
    tiny.getContext('2d').drawImage(canvas, 0, 0, tiny.width, tiny.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(tiny, 0, 0, layer.width, layer.height);
  }
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(mask, 0, 0);
  canvas.getContext('2d').drawImage(layer, 0, 0);
}

/** 将文字或图片水印绘制为独立透明图层，可复用在原尺寸导出与自动水印。
 * @param {number} width 输出宽度。
 * @param {number} height 输出高度。
 * @param {object[]} layers 启用的水印图层及摆放参数。
 * @returns {Promise<HTMLCanvasElement>} 已合成的透明水印。
 */
export async function renderWatermarkLayer(width, height, layers) {
  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext('2d');
  const short = Math.min(width, height);
  for (const layer of layers) {
    if (layer.hidden || (!layer.image && !layer.text?.trim())) continue;
    const image = layer.image ? await loadImage(layer.image) : null;
    const size = Math.max(1, layer.size * short / 100);
    const lines = image ? [] : layer.text.split('\n');
    const vertical = !image && layer.direction === 'vertical';
    const columns = vertical ? lines.map((line) => Array.from(new Intl.Segmenter().segment(line), ({ segment }) => segment)) : [];
    const customFont = !image && signatureFonts.find(({ family }) => family === layer.font);
    if (customFont) {
      await loadSignatureFont(layer.font);
      if (!customFont.previewFile && /\p{Script=Han}/u.test(layer.text)) await loadSignatureFont('Ma Shan Zheng');
    }
    ctx.save();
    const font = customFont ? `"${layer.font}", "Ma Shan Zheng", cursive` : layer.font;
    ctx.font = `${layer.italic ? 'italic ' : ''}${layer.weight} ${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!vertical && 'letterSpacing' in ctx) ctx.letterSpacing = `${layer.spacing * size / 100}px`;
    const lineHeight = size * 1.2;
    const glyphStep = size * (1 + layer.spacing / 100);
    const layerWidth = image ? size * (image.naturalWidth / image.naturalHeight)
      : vertical ? columns.length * lineHeight : Math.max(...lines.map((line) => ctx.measureText(line).width));
    const layerHeight = image ? size : vertical ? size + (Math.max(...columns.map((column) => column.length)) - 1) * glyphStep : lines.length * lineHeight;
    const [row, column] = layer.position.split('-');
    const marginX = layer.offsetX * short / 100;
    const marginY = layer.offsetY * short / 100;
    const x = layer.position === 'custom' ? width * layer.x : column === 'left' ? layerWidth / 2 + marginX
      : column === 'right' ? width - layerWidth / 2 - marginX : width / 2 + marginX;
    const y = layer.position === 'custom' ? height * layer.y : row === 'top' ? layerHeight / 2 + marginY
      : row === 'bottom' ? height - layerHeight / 2 - marginY : height / 2 + marginY;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.fillStyle = layer.color;
    ctx.strokeStyle = layer.outlineColor;
    ctx.lineWidth = Math.max(1, layer.outlineSize * size / 100);
    ctx.lineJoin = 'round';
    if (layer.shadow) {
      ctx.shadowColor = layer.shadowColor;
      ctx.shadowBlur = size / 5;
      ctx.shadowOffsetY = size / 12;
    }
    const drawText = (text, x, y) => {
      if (layer.outline) ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    const draw = (left, top) => {
      ctx.save();
      ctx.translate(left, top);
      ctx.rotate(layer.rotation * Math.PI / 180);
      if (image) ctx.drawImage(image, -layerWidth / 2, -layerHeight / 2, layerWidth, layerHeight);
      else if (vertical) columns.forEach((column, index) => {
        const x = ((columns.length - 1) / 2 - index) * lineHeight;
        column.forEach((glyph, row) => drawText(glyph, x, (size - layerHeight) / 2 + row * glyphStep));
      });
      else lines.forEach((line, index) => drawText(line, 0, (index - (lines.length - 1) / 2) * lineHeight));
      ctx.restore();
    };
    if (layer.tile) {
      const stepX = Math.max(layerWidth + size * 1.5, short * 0.15);
      const stepY = Math.max(layerHeight + size * 1.5, short * 0.15);
      for (let top = stepY / 2; top < height; top += stepY) {
        for (let left = stepX / 2; left < width; left += stepX) draw(left, top);
      }
    } else draw(x, y);
    ctx.restore();
  }
  return canvas;
}

/** 将单图调整、马赛克和水印合成到新画布。
 * @param {HTMLCanvasElement} source 解码的原图或预览图。
 * @param {object} settings 当前调整参数。
 * @param {object[]} strokes 只属于当前图像的马赛克笔迹。
 * @param {object|null} overlay 当前图像的遮挡贴图和坐标。
 * @returns {Promise<HTMLCanvasElement>} 合成结果。
 */
export async function renderQuickImage(source, settings, strokes = [], overlay = null) {
  const colors = settings.colorMatch && settings.matchStrength
    ? applyColorMatch(source, settings.colorMatch, settings.matchStrength) : source;
  const adjustments = imageLookAdjustments(settings.adjustments, settings.look, settings.lookStrength);
  const unadjusted = adjustments === DEFAULT_ADJUSTMENTS;
  const output = unadjusted ? canvasOf(colors.width, colors.height) : adjustedCanvas(colors, adjustments, true);
  if (unadjusted) output.getContext('2d').drawImage(colors, 0, 0);
  if (strokes.some(({ erase }) => !erase)) applyMosaic(output, strokes, settings.mosaic);
  if (overlay) {
    const context = output.getContext('2d');
    const size = overlay.size * Math.min(output.width, output.height) / 100;
    const scale = size / Math.max(overlay.image.width, overlay.image.height);
    const width = overlay.image.width * scale;
    const height = overlay.image.height * scale;
    context.save();
    context.translate(overlay.x * output.width, overlay.y * output.height);
    context.rotate(overlay.rotation * Math.PI / 180);
    context.drawImage(overlay.image, -width / 2, -height / 2, width, height);
    context.restore();
  }
  if (hasImageWatermark(settings)) {
    output.getContext('2d').drawImage(await renderWatermarkLayer(output.width, output.height, settings.watermarks), 0, 0);
  }
  return output;
}

/** 导出 PNG，保留原有公开文字块和 NovelAI 隐写生成参数。
 * @param {HTMLCanvasElement} output 合成后的完整尺寸图像。
 * @param {Blob} original 原图文件。
 * @param {HTMLCanvasElement} source 未调整的像素，用来读取隐写参数。
 * @returns {Promise<Blob>} 带原图生成参数的 PNG。
 */
export async function publishAdjustedImage(output, original, source) {
  const png = await new Promise((resolve, reject) => {
    output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('IMAGE_ADJUSTMENT_ENCODING_FAILED')), 'image/png');
  });
  const { chunks, keywords, ancillary, isPng } = await readScrambleMetadata(original, true);
  if (isPng && !keywords.has(NOVELAI_STEALTH_KEYWORD)) {
    const originalPixels = source.getContext('2d').getImageData(0, 0, source.width, source.height);
    const stealth = readStealthMetadata(originalPixels);
    if (stealth) chunks.push(encodePngTextChunk(NOVELAI_STEALTH_KEYWORD, JSON.stringify(stealth)));
  }
  return appendPngTextChunks(await restorePngMetadataChunks(png, ancillary), chunks);
}

/** 对成功生成的原图应用当前水印预设，保留原图地址和服务器交付信息。
 * @param {object} result 生成服务返回并已校验的结果。
 * @returns {Promise<object>} 成功结果，应用失败时仍保留原图。
 */
export async function applyAutomaticWatermark(result) {
  const { autoWatermarkEnabled, autoWatermarkPresetId } = readImagePreviewSettings();
  if (!autoWatermarkEnabled || !autoWatermarkPresetId) return result;
  try {
    const presets = await readQuickImagePresets();
    const preset = presets.find(({ id }) => id === autoWatermarkPresetId);
    if (!preset || !hasImageWatermark(preset.settings)) throw new Error('IMAGE_WATERMARK_PRESET_MISSING');
    const original = result.cachedBlob || await fetchUrlAsBlob(result.downloadUrl || result.imageUrl || result.image);
    const source = await imageAdjustmentSource(original);
    const output = canvasOf(source.width, source.height);
    const ctx = output.getContext('2d');
    ctx.drawImage(source, 0, 0);
    ctx.drawImage(await renderWatermarkLayer(source.width, source.height, preset.settings.watermarks), 0, 0);
    const cachedBlob = await publishAdjustedImage(output, original, source);
    const url = URL.createObjectURL(cachedBlob);
    return {
      ...result, cachedBlob, imageUrl: url, downloadUrl: url,
      originalImageUrl: result.remoteImageUrl || result.downloadUrl || result.imageUrl || result.image,
      objectUrlToRevoke: result.objectUrlToRevoke || url,
    };
  } catch {
    return { ...result, autoWatermarkFailed: true };
  }
}
