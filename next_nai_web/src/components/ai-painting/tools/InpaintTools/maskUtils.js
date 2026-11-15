import { cropWorldRectToCanvas } from './exportUtils';
import { createInpaintMaskGrid, drawMaskGrid } from './maskBrush';

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
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

  const baseImageData = baseContentCanvas.getContext('2d').getImageData(0, 0, outputWidth, outputHeight);
  const maskCanvas = createCanvas(outputWidth, outputHeight);
  drawMaskGrid({
    ctx: maskCanvas.getContext('2d'),
    mask: createInpaintMaskGrid(baseImageData, expandPixels, strokes, worldRect),
    worldRect: { x: 0, y: 0, width: outputWidth, height: outputHeight },
    outputWidth,
    outputHeight,
  });
  return maskCanvas;
};

/**
 * 用同一张二值蒙版生成贴回选区和请求 PNG。
 * @param {object} options 与 createInpaintMaskCanvas 相同的画布和笔迹参数。
 * @returns {object} 用于贴回的 canvas 和发送请求的 dataUrl。
 */
export const createInpaintMaskData = (options) => {
  const maskCanvas = createInpaintMaskCanvas(options);
  // 请求使用黑底白区 PNG，贴回则读取透明度以保留选区外的原图。
  const requestCanvas = createCanvas(maskCanvas.width, maskCanvas.height);
  const ctx = requestCanvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, requestCanvas.width, requestCanvas.height);
  ctx.drawImage(maskCanvas, 0, 0);

  return {
    canvas: maskCanvas,
    dataUrl: requestCanvas.toDataURL('image/png'),
  };
};
