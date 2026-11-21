import { gilbertCurve, looksScrambled, scramblePixels } from './imageScramble';
import { NOVELAI_STEALTH_KEYWORD, readStealthMetadata } from './ImageMetadataExtractor.js';
import { appendPngTextChunks, encodePngTextChunk, readScrambleMetadata } from './scrambleMetadata.js';

let canvas, context, curve, curveIndices, currentPixels, sourceFile, preservedMetadata;

self.onmessage = async ({ data: { file, direction, exportMode, metadataMode, customMetadata } }) => {
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
        if (exportMode) {
          const stealth = readStealthMetadata({ data: currentPixels, width, height });
          let chunks = [];
          if (metadataMode === 'preserve') {
            const { chunks: originalChunks, keywords } = await readScrambleMetadata(file);
            chunks = originalChunks;
            if (stealth && !keywords.has(NOVELAI_STEALTH_KEYWORD)) {
              chunks.push(encodePngTextChunk(NOVELAI_STEALTH_KEYWORD, JSON.stringify(stealth)));
            }
          } else {
            if (stealth) {
              // 清掉 NovelAI 写入透明度最低位的旧参数，避免像素还原后又能读出原数据。
              for (let i = 3; i < currentPixels.length; i += 4) {
                if (currentPixels[i]) currentPixels[i] |= 1;
              }
            }
            if (metadataMode === 'custom') {
              chunks = Object.entries(customMetadata).map(([key, value]) =>
                encodePngTextChunk(key, typeof value === 'string' ? value : JSON.stringify(value)));
            }
          }
          const pixels = exportMode === 'scrambled'
            ? scramblePixels(currentPixels, gilbertCurve(width, height), 'scramble')
            : currentPixels;
          context.putImageData(new ImageData(pixels, width, height), 0, 0);
          self.postMessage({ blob: appendPngTextChunks(await canvas.convertToBlob({ type: 'image/png' }), chunks) });
          return;
        }
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
    const blob = appendPngTextChunks(png, chunks);
    const suspected = looksScrambled(pixels, width, height, curve, curveIndices);
    // 继续处理内存中的像素，避免每次重排都从导出的文件重新解码。
    currentPixels = pixels;
    self.postMessage({ blob, suspected });
  } catch {
    self.postMessage({ error: 'imageToolFailed' });
  }
};
