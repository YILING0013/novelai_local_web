import { cropWorldRectToCanvas } from './exportUtils';
import { createMaskGrid, drawMaskGrid } from './maskBrush';

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const createHardBinaryMaskCanvas = (sourceCanvas, alphaThreshold = 1) => {
  const normalizedCanvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
  const normalizedCtx = normalizedCanvas.getContext('2d');
  const sourceCtx = sourceCanvas.getContext('2d');
  const sourceImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const normalizedImageData = normalizedCtx.createImageData(sourceCanvas.width, sourceCanvas.height);

  for (let index = 0; index < sourceImageData.data.length; index += 4) {
    const masked = sourceImageData.data[index + 3] >= alphaThreshold;

    if (masked) {
      normalizedImageData.data[index] = 255;
      normalizedImageData.data[index + 1] = 255;
      normalizedImageData.data[index + 2] = 255;
      normalizedImageData.data[index + 3] = 255;
      continue;
    }

    normalizedImageData.data[index] = 0;
    normalizedImageData.data[index + 1] = 0;
    normalizedImageData.data[index + 2] = 0;
    normalizedImageData.data[index + 3] = 0;
  }

  normalizedCtx.putImageData(normalizedImageData, 0, 0);
  return normalizedCanvas;
};

const encodeMaskCanvasToWebpDataUrl = (maskCanvas, quality = 0.5) => {
  const webpDataUrl = maskCanvas.toDataURL('image/webp', quality);

  if (webpDataUrl.startsWith('data:image/webp')) {
    return webpDataUrl;
  }

  return maskCanvas.toDataURL('image/png');
};

const dilateWhiteMask = (baseCanvas, radius) => {
  if (!radius) {
    return baseCanvas;
  }

  const expandedCanvas = createCanvas(baseCanvas.width, baseCanvas.height);
  const expandedCtx = expandedCanvas.getContext('2d');

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if ((offsetX * offsetX) + (offsetY * offsetY) > radius * radius) {
        continue;
      }
      expandedCtx.drawImage(baseCanvas, offsetX, offsetY);
    }
  }

  expandedCtx.globalCompositeOperation = 'source-over';

  return expandedCanvas;
};

/**
 * 合并自动扩图范围与用户网格笔迹，生成透明底白色蒙版。
 * @param {object} options 原图画布与坐标范围、输出尺寸、笔迹及边缘扩展像素数。
 * @returns {HTMLCanvasElement} 保留擦除结果且与生成图同尺寸的蒙版。
 */
export const createInpaintMaskCanvas = ({
  contentCanvas,
  contentBounds,
  worldRect,
  outputWidth,
  outputHeight,
  strokes,
  expandPixels = 0,
}) => {
  const baseContentCanvas = cropWorldRectToCanvas({
    contentCanvas,
    contentBounds,
    worldRect,
    outputWidth,
    outputHeight,
  });

  const baseMaskCanvas = createCanvas(outputWidth, outputHeight);
  const baseMaskCtx = baseMaskCanvas.getContext('2d');
  const baseImageData = baseContentCanvas.getContext('2d').getImageData(0, 0, outputWidth, outputHeight);
  const maskImageData = baseMaskCtx.createImageData(outputWidth, outputHeight);

  for (let index = 0; index < baseImageData.data.length; index += 4) {
    const alpha = baseImageData.data[index + 3];
    if (alpha > 0) {
      maskImageData.data[index + 3] = 0;
      continue;
    }

    maskImageData.data[index] = 255;
    maskImageData.data[index + 1] = 255;
    maskImageData.data[index + 2] = 255;
    maskImageData.data[index + 3] = 255;
  }

  baseMaskCtx.putImageData(maskImageData, 0, 0);

  const dilatedCanvas = dilateWhiteMask(baseMaskCanvas, Math.max(0, Math.round(expandPixels)));
  const maskCanvas = createCanvas(outputWidth, outputHeight);
  const maskCtx = maskCanvas.getContext('2d');
  maskCtx.drawImage(dilatedCanvas, 0, 0);

  const grid = createMaskGrid(strokes, worldRect);
  // 笔刷操作覆盖自动扩图蒙版；擦过的空白格也必须清除。
  maskCtx.globalCompositeOperation = 'destination-out';
  drawMaskGrid({ ctx: maskCtx, mask: { ...grid, data: grid.touched }, worldRect, outputWidth, outputHeight });
  maskCtx.globalCompositeOperation = 'source-over';
  drawMaskGrid({ ctx: maskCtx, mask: grid, worldRect, outputWidth, outputHeight });
  return maskCanvas;
};

/**
 * 将蒙版规范为二值透明度，显示颜色和描边不会进入请求。
 * @param {object} options 与 createInpaintMaskCanvas 相同的画布和笔迹参数。
 * @returns {object} 用于贴回的 canvas 和发送请求的 dataUrl。
 */
export const createInpaintMaskData = (options) => {
  const maskCanvas = createInpaintMaskCanvas(options);
  const binaryMaskCanvas = createHardBinaryMaskCanvas(maskCanvas);

  return {
    canvas: binaryMaskCanvas,
    dataUrl: encodeMaskCanvasToWebpDataUrl(binaryMaskCanvas),
  };
};
