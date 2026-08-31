import { cropWorldRectToCanvas } from './exportUtils';

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

const applyStrokeToMask = ({ ctx, stroke, worldRect, width, height }) => {
  const scaleX = width / worldRect.width;
  const scaleY = height / worldRect.height;

  ctx.save();
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(stroke.size * scaleX, 1);

  if (stroke.type === 'rect') {
    const x = (stroke.rect.x - worldRect.x) * scaleX;
    const y = (stroke.rect.y - worldRect.y) * scaleY;
    const rectWidth = stroke.rect.width * scaleX;
    const rectHeight = stroke.rect.height * scaleY;
    ctx.fillRect(x, y, rectWidth, rectHeight);
    ctx.restore();
    return;
  }

  if (!stroke.points || stroke.points.length === 0) {
    ctx.restore();
    return;
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc((point.x - worldRect.x) * scaleX, (point.y - worldRect.y) * scaleY, Math.max((stroke.size * scaleX) / 2, 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  stroke.points.forEach((point, index) => {
    const x = (point.x - worldRect.x) * scaleX;
    const y = (point.y - worldRect.y) * scaleY;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
};

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

  strokes.forEach((stroke) => {
    applyStrokeToMask({
      ctx: maskCtx,
      stroke,
      worldRect,
      width: outputWidth,
      height: outputHeight,
    });
  });

  return maskCanvas;
};

export const createInpaintMaskData = (options) => {
  const maskCanvas = createInpaintMaskCanvas(options);
  const binaryMaskCanvas = createHardBinaryMaskCanvas(maskCanvas);

  return {
    canvas: binaryMaskCanvas,
    dataUrl: encodeMaskCanvasToWebpDataUrl(binaryMaskCanvas),
  };
};
