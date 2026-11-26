const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const DISTANCE_TRANSFORM_INFINITY = 1e12;

const getDrawableSize = (drawable) => ({
  width: Math.max(1, Math.round(drawable?.naturalWidth || drawable?.videoWidth || drawable?.width || 1)),
  height: Math.max(1, Math.round(drawable?.naturalHeight || drawable?.videoHeight || drawable?.height || 1)),
});

const compute1dSquaredDistanceTransform = (input, size) => {
  const locations = new Int32Array(size);
  const boundaries = new Float64Array(size + 1);
  const output = new Float64Array(size);
  let activeIndex = 0;

  locations[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;

  for (let position = 1; position < size; position += 1) {
    let intersection = Number.NEGATIVE_INFINITY;

    while (activeIndex >= 0) {
      const previousPosition = locations[activeIndex];
      intersection = (
        (input[position] + (position * position)) -
        (input[previousPosition] + (previousPosition * previousPosition))
      ) / (2 * (position - previousPosition));

      if (intersection > boundaries[activeIndex]) {
        break;
      }

      activeIndex -= 1;
    }

    if (activeIndex < 0) {
      intersection = Number.NEGATIVE_INFINITY;
    }

    activeIndex += 1;
    locations[activeIndex] = position;
    boundaries[activeIndex] = intersection;
    boundaries[activeIndex + 1] = Number.POSITIVE_INFINITY;
  }

  activeIndex = 0;

  for (let position = 0; position < size; position += 1) {
    while (boundaries[activeIndex + 1] < position) {
      activeIndex += 1;
    }

    const nearestPosition = locations[activeIndex];
    const delta = position - nearestPosition;
    output[position] = (delta * delta) + input[nearestPosition];
  }

  return output;
};

const createOutwardFeatherMaskCanvas = ({ maskCanvas, featherPixels = 8 }) => {
  const { width, height } = getDrawableSize(maskCanvas);
  const normalizedMaskCanvas = createCanvas(width, height);
  const normalizedMaskCtx = normalizedMaskCanvas.getContext('2d');
  normalizedMaskCtx.drawImage(maskCanvas, 0, 0, width, height);

  if (!featherPixels) {
    return normalizedMaskCanvas;
  }

  const maskImageData = normalizedMaskCtx.getImageData(0, 0, width, height);
  const opaqueMask = new Uint8Array(width * height);
  const maxDimension = Math.max(width, height);
  const lineBuffer = new Float64Array(maxDimension);
  const squaredDistances = new Float64Array(width * height);
  const horizontalDistances = new Float64Array(width * height);

  for (let index = 0; index < opaqueMask.length; index += 1) {
    opaqueMask[index] = maskImageData.data[(index * 4) + 3] > 0 ? 1 : 0;
  }

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      lineBuffer[x] = opaqueMask[rowOffset + x] ? 0 : DISTANCE_TRANSFORM_INFINITY;
    }

    const rowDistances = compute1dSquaredDistanceTransform(lineBuffer, width);
    horizontalDistances.set(rowDistances, rowOffset);
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      lineBuffer[y] = horizontalDistances[(y * width) + x];
    }

    const columnDistances = compute1dSquaredDistanceTransform(lineBuffer, height);

    for (let y = 0; y < height; y += 1) {
      squaredDistances[(y * width) + x] = columnDistances[y];
    }
  }

  const featherMaskCanvas = createCanvas(width, height);
  const featherMaskCtx = featherMaskCanvas.getContext('2d');
  const featherMaskImageData = featherMaskCtx.createImageData(width, height);

  for (let index = 0; index < opaqueMask.length; index += 1) {
    const pixelOffset = index * 4;
    let alpha = 0;

    if (opaqueMask[index]) {
      alpha = 255;
    } else {
      const distance = Math.sqrt(squaredDistances[index]);
      if (distance < featherPixels) {
        alpha = Math.round((1 - (distance / featherPixels)) * 255);
      }
    }

    if (alpha <= 0) {
      continue;
    }

    featherMaskImageData.data[pixelOffset] = 255;
    featherMaskImageData.data[pixelOffset + 1] = 255;
    featherMaskImageData.data[pixelOffset + 2] = 255;
    featherMaskImageData.data[pixelOffset + 3] = alpha;
  }

  featherMaskCtx.putImageData(featherMaskImageData, 0, 0);
  return featherMaskCanvas;
};

const cropCanvasToBounds = (sourceCanvas, bounds) => {
  const croppedCanvas = createCanvas(bounds.width, bounds.height);
  const croppedCtx = croppedCanvas.getContext('2d');

  croppedCtx.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );

  return croppedCanvas;
};

export const createFeatheredPatchCanvas = ({ patchImage, featherPixels = 0 }) => {
  if (!patchImage) {
    return null;
  }

  const canvas = createCanvas(patchImage.width, patchImage.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(patchImage, 0, 0, canvas.width, canvas.height);

  const isObject = typeof featherPixels === 'object' && featherPixels !== null;
  const featherTop = Math.max(0, Math.round(isObject ? (featherPixels.top || 0) : featherPixels));
  const featherRight = Math.max(0, Math.round(isObject ? (featherPixels.right || 0) : featherPixels));
  const featherBottom = Math.max(0, Math.round(isObject ? (featherPixels.bottom || 0) : featherPixels));
  const featherLeft = Math.max(0, Math.round(isObject ? (featherPixels.left || 0) : featherPixels));

  if (!featherTop && !featherRight && !featherBottom && !featherLeft) {
    return canvas;
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minFactor = 1;

      if (featherTop > 0 && y < featherTop) {
        minFactor = Math.min(minFactor, y / featherTop);
      }
      if (featherBottom > 0 && y > height - 1 - featherBottom) {
        minFactor = Math.min(minFactor, (height - 1 - y) / featherBottom);
      }
      if (featherLeft > 0 && x < featherLeft) {
        minFactor = Math.min(minFactor, x / featherLeft);
      }
      if (featherRight > 0 && x > width - 1 - featherRight) {
        minFactor = Math.min(minFactor, (width - 1 - x) / featherRight);
      }

      if (minFactor >= 1) {
        continue;
      }

      const alphaIndex = ((y * width) + x) * 4 + 3;
      data[alphaIndex] = Math.round(data[alphaIndex] * Math.max(0, minFactor));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

export const loadImageElement = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

export const drawContentIntoContext = ({
  ctx,
  contentCanvas,
  contentBounds,
  worldRect,
  targetWidth,
  targetHeight,
  background = 'transparent',
}) => {
  ctx.clearRect(0, 0, targetWidth, targetHeight);

  if (background === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  if (!contentCanvas || !contentBounds) {
    return;
  }

  const scaleX = targetWidth / worldRect.width;
  const scaleY = targetHeight / worldRect.height;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    contentCanvas,
    (contentBounds.x - worldRect.x) * scaleX,
    (contentBounds.y - worldRect.y) * scaleY,
    contentBounds.width * scaleX,
    contentBounds.height * scaleY
  );
};

export const cropWorldRectToCanvas = ({
  contentCanvas,
  contentBounds,
  worldRect,
  outputWidth,
  outputHeight,
  background = 'transparent',
}) => {
  const canvas = createCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');

  drawContentIntoContext({
    ctx,
    contentCanvas,
    contentBounds,
    worldRect,
    targetWidth: canvas.width,
    targetHeight: canvas.height,
    background,
  });

  return canvas;
};

export const cropWorldRectToDataUrl = (options) => {
  const canvas = cropWorldRectToCanvas(options);
  return canvas.toDataURL('image/png');
};

export const worldRectHasVisibleContent = ({
  contentCanvas,
  contentBounds,
  worldRect,
}) => {
  if (!contentCanvas || !contentBounds || !worldRect) {
    return false;
  }

  const sampleLeft = Math.max(contentBounds.x, Math.floor(worldRect.x));
  const sampleTop = Math.max(contentBounds.y, Math.floor(worldRect.y));
  const sampleRight = Math.min(contentBounds.x + contentBounds.width, Math.ceil(worldRect.x + worldRect.width));
  const sampleBottom = Math.min(contentBounds.y + contentBounds.height, Math.ceil(worldRect.y + worldRect.height));
  const sampleWidth = sampleRight - sampleLeft;
  const sampleHeight = sampleBottom - sampleTop;

  if (sampleWidth <= 0 || sampleHeight <= 0) {
    return false;
  }

  const ctx = contentCanvas.getContext('2d');
  const imageData = ctx.getImageData(
    sampleLeft - contentBounds.x,
    sampleTop - contentBounds.y,
    sampleWidth,
    sampleHeight
  );

  for (let index = 3; index < imageData.data.length; index += 4) {
    if (imageData.data[index] > 0) {
      return true;
    }
  }

  return false;
};

export const mergePatchIntoContentCanvas = async ({
  contentCanvas,
  contentBounds,
  patchSrc,
  patchImage,
  worldRect,
  featherPixels = 0,
}) => {
  const sourcePatch = patchImage || await loadImageElement(patchSrc);
  const patchDrawable = createFeatheredPatchCanvas({
    patchImage: sourcePatch,
    featherPixels,
  });

  if (!contentCanvas || !contentBounds) {
    const nextCanvas = createCanvas(worldRect.width, worldRect.height);
    const nextCtx = nextCanvas.getContext('2d');
    nextCtx.drawImage(patchDrawable, 0, 0, nextCanvas.width, nextCanvas.height);
    return {
      canvas: nextCanvas,
      bounds: {
        x: worldRect.x,
        y: worldRect.y,
        width: worldRect.width,
        height: worldRect.height,
      },
    };
  }

  const nextBounds = {
    x: Math.min(contentBounds.x, worldRect.x),
    y: Math.min(contentBounds.y, worldRect.y),
    width: Math.max(contentBounds.x + contentBounds.width, worldRect.x + worldRect.width) - Math.min(contentBounds.x, worldRect.x),
    height: Math.max(contentBounds.y + contentBounds.height, worldRect.y + worldRect.height) - Math.min(contentBounds.y, worldRect.y),
  };

  const nextCanvas = createCanvas(nextBounds.width, nextBounds.height);
  const nextCtx = nextCanvas.getContext('2d');
  nextCtx.imageSmoothingEnabled = true;
  nextCtx.imageSmoothingQuality = 'high';

  nextCtx.drawImage(
    contentCanvas,
    contentBounds.x - nextBounds.x,
    contentBounds.y - nextBounds.y,
    contentBounds.width,
    contentBounds.height
  );

  nextCtx.drawImage(
    patchDrawable,
    worldRect.x - nextBounds.x,
    worldRect.y - nextBounds.y,
    worldRect.width,
    worldRect.height
  );

  return {
    canvas: nextCanvas,
    bounds: nextBounds,
  };
};

export const extractMaskedPatchCanvas = ({
  patchImage,
  maskCanvas,
  worldRect,
  outwardFeatherPixels = 8,
}) => {
  if (!patchImage || !maskCanvas || !worldRect) {
    return null;
  }

  const patchSize = getDrawableSize(patchImage);
  const normalizedMaskCanvas = createCanvas(patchSize.width, patchSize.height);
  const normalizedMaskCtx = normalizedMaskCanvas.getContext('2d');
  normalizedMaskCtx.drawImage(maskCanvas, 0, 0, patchSize.width, patchSize.height);

  const maskedPatchCanvas = createCanvas(patchSize.width, patchSize.height);
  const maskedPatchCtx = maskedPatchCanvas.getContext('2d');
  maskedPatchCtx.drawImage(patchImage, 0, 0, patchSize.width, patchSize.height);

  const featherMaskCanvas = createOutwardFeatherMaskCanvas({
    maskCanvas: normalizedMaskCanvas,
    featherPixels: Math.max(0, Math.round(outwardFeatherPixels)),
  });

  maskedPatchCtx.globalCompositeOperation = 'destination-in';
  maskedPatchCtx.drawImage(featherMaskCanvas, 0, 0, patchSize.width, patchSize.height);
  maskedPatchCtx.globalCompositeOperation = 'source-over';

  const alphaBounds = getCanvasAlphaBounds(maskedPatchCanvas);

  if (!alphaBounds) {
    return null;
  }

  const croppedCanvas = cropCanvasToBounds(maskedPatchCanvas, alphaBounds);
  const scaleX = worldRect.width / patchSize.width;
  const scaleY = worldRect.height / patchSize.height;

  return {
    canvas: croppedCanvas,
    worldRect: {
      x: worldRect.x + (alphaBounds.x * scaleX),
      y: worldRect.y + (alphaBounds.y * scaleY),
      width: alphaBounds.width * scaleX,
      height: alphaBounds.height * scaleY,
    },
  };
};

export const getCanvasAlphaBounds = (canvas) => {
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = imageData[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

export const exportContentCanvas = ({ contentCanvas, background = 'transparent' }) => {
  const alphaBounds = getCanvasAlphaBounds(contentCanvas);

  if (!contentCanvas || !alphaBounds) {
    return null;
  }

  const exportCanvas = createCanvas(alphaBounds.width, alphaBounds.height);
  const exportCtx = exportCanvas.getContext('2d');

  if (background === 'white') {
    exportCtx.fillStyle = '#ffffff';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  }

  exportCtx.drawImage(
    contentCanvas,
    alphaBounds.x,
    alphaBounds.y,
    alphaBounds.width,
    alphaBounds.height,
    0,
    0,
    exportCanvas.width,
    exportCanvas.height
  );

  return {
    dataUrl: exportCanvas.toDataURL('image/png'),
    width: exportCanvas.width,
    height: exportCanvas.height,
  };
};

export const dataUrlToBlob = async (dataUrl) => {
  const response = await fetch(dataUrl);
  return response.blob();
};
