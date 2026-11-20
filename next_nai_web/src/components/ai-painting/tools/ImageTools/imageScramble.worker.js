import { gilbertCurve, looksScrambled, scramblePixels } from './imageScramble';
import { NOVELAI_STEALTH_KEYWORD, readStealthMetadata } from './ImageMetadataExtractor.js';
import { encodePngTextChunk, readScrambleMetadata } from './scrambleMetadata.js';

let canvas, context, curve, curveIndices, currentPixels, sourceFile, preservedMetadata;

self.onmessage = async ({ data: { file, direction } }) => {
  try {
    if (file) {
      const bitmap = await createImageBitmap(file);
      try {
        const { width, height } = bitmap;
        // 混淆依赖精确尺寸。限制内存用量，超限时拒绝处理，不改变像素尺寸。
        if (width * height > 24_000_000) {
          self.postMessage({ error: 'imageTooLarge' });
          return;
        }
        canvas = new OffscreenCanvas(width, height);
        context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        currentPixels = context.getImageData(0, 0, width, height).data;
        curve = gilbertCurve(width, height);
        curveIndices = new Uint32Array(curve.length);
        for (let i = 0; i < curve.length; i++) curveIndices[curve[i]] = i;
        sourceFile = file;
        preservedMetadata = null;
      } finally {
        bitmap.close();
      }
      self.postMessage({ suspected: looksScrambled(currentPixels, canvas.width, canvas.height, curve, curveIndices) });
      return;
    }

    const pixels = scramblePixels(currentPixels, curve, direction);
    const { width, height } = canvas;
    preservedMetadata ??= await readScrambleMetadata(sourceFile);
    const { chunks, keywords } = preservedMetadata;
    if (!keywords.has(NOVELAI_STEALTH_KEYWORD)) {
      // 隐写信息的 alpha 位会随像素重排。另存一份完整文本，也能保留这次刚还原出来的隐写数据。
      const stealth = readStealthMetadata({ data: currentPixels, width, height })
        ?? readStealthMetadata({ data: pixels, width, height });
      if (stealth) {
        chunks.push(encodePngTextChunk(NOVELAI_STEALTH_KEYWORD, JSON.stringify(stealth)));
        keywords.add(NOVELAI_STEALTH_KEYWORD);
      }
    }
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    // Canvas 输出末尾是固定 12 字节 IEND；将文本放在 IEND 之前，像素块不需要重新编码。
    const blob = chunks.length ? new Blob([png.slice(0, -12), ...chunks, png.slice(-12)], { type: 'image/png' }) : png;
    const suspected = looksScrambled(pixels, width, height, curve, curveIndices);
    // 继续处理内存中的像素，避免每次重排都从导出的文件重新解码。
    currentPixels = pixels;
    self.postMessage({ blob, suspected });
  } catch {
    self.postMessage({ error: 'imageToolFailed' });
  }
};
