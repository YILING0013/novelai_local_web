export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const pointInRect = (point, rect) => {
  if (!point || !rect) return false;
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
};

export const getAspectRatio = (outputResolution) => {
  if (!outputResolution?.width || !outputResolution?.height) {
    return 1;
  }
  return outputResolution.width / outputResolution.height;
};

export const getRectCenter = (rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

export const fitSceneToStage = (contentBounds, stageSize, padding = 32) => {
  if (!contentBounds || !stageSize.width || !stageSize.height) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const availableWidth = Math.max(stageSize.width - padding * 2, 64);
  const availableHeight = Math.max(stageSize.height - padding * 2, 64);
  const scaleX = availableWidth / contentBounds.width;
  const scaleY = availableHeight / contentBounds.height;
  const scale = Math.min(scaleX, scaleY, 1);

  const scaledWidth = contentBounds.width * scale;
  const scaledHeight = contentBounds.height * scale;

  return {
    scale,
    offsetX: (stageSize.width - scaledWidth) / 2 - contentBounds.x * scale,
    offsetY: (stageSize.height - scaledHeight) / 2 - contentBounds.y * scale,
  };
};

export const createInitialViewportRect = (stageSize, aspectRatio = 1, options = {}) => {
  const { sceneTransform, outputResolution, contentBounds } = options;

  if (sceneTransform && outputResolution?.width && outputResolution?.height && contentBounds) {
    const width = Math.max(outputResolution.width * sceneTransform.scale, 48);
    const height = Math.max(outputResolution.height * sceneTransform.scale, 48);
    const contentCenterX = (contentBounds.x + contentBounds.width / 2) * sceneTransform.scale + sceneTransform.offsetX;
    const contentCenterY = (contentBounds.y + contentBounds.height / 2) * sceneTransform.scale + sceneTransform.offsetY;

    return {
      x: contentCenterX - width / 2,
      y: contentCenterY - height / 2,
      width,
      height,
    };
  }

  const maxWidth = stageSize.width * 0.72;
  const maxHeight = stageSize.height * 0.72;

  let width = maxWidth;
  let height = width / aspectRatio;

  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  width = clamp(width, 120, stageSize.width - 24);
  height = clamp(height, 120, stageSize.height - 24);

  return {
    x: (stageSize.width - width) / 2,
    y: (stageSize.height - height) / 2,
    width,
    height,
  };
};

export const normalizeViewportRect = (rect, stageSize, aspectRatio = 1) => {
  if (!rect) {
    return createInitialViewportRect(stageSize, aspectRatio);
  }

  const maxDimension = Math.max(stageSize.width, stageSize.height, 256) * 20;
  const width = clamp(rect.width, 48, maxDimension);
  const height = Math.max(width / aspectRatio, 48);

  return {
    x: rect.x,
    y: rect.y,
    width,
    height,
  };
};

export const moveViewportRect = (rect, deltaX, deltaY) => {
  if (!rect) return rect;

  return {
    ...rect,
    x: rect.x + deltaX,
    y: rect.y + deltaY,
  };
};

export const resizeViewportRect = (rect, factor, stageSize, aspectRatio = 1) => {
  if (!rect) return rect;

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const targetWidth = clamp(rect.width * factor, 96, Math.max(stageSize.width - 16, 96));
  const targetHeight = clamp(targetWidth / aspectRatio, 96, Math.max(stageSize.height - 16, 96));

  const nextRect = {
    x: centerX - targetWidth / 2,
    y: centerY - targetHeight / 2,
    width: targetWidth,
    height: targetHeight,
  };

  return normalizeViewportRect(nextRect, stageSize, aspectRatio);
};

export const scaleRectAroundPoint = (rect, factor, stageSize, aspectRatio = 1, anchorPoint = getRectCenter(rect)) => {
  if (!rect) return rect;

  const nextWidth = rect.width * factor;
  const nextRect = {
    x: anchorPoint.x + (rect.x - anchorPoint.x) * factor,
    y: anchorPoint.y + (rect.y - anchorPoint.y) * factor,
    width: nextWidth,
  };

  return normalizeViewportRect(nextRect, stageSize, aspectRatio);
};

export const screenToWorldPoint = (point, sceneTransform) => ({
  x: (point.x - sceneTransform.offsetX) / sceneTransform.scale,
  y: (point.y - sceneTransform.offsetY) / sceneTransform.scale,
});

export const worldToScreenPoint = (point, sceneTransform) => ({
  x: point.x * sceneTransform.scale + sceneTransform.offsetX,
  y: point.y * sceneTransform.scale + sceneTransform.offsetY,
});

export const screenRectToWorldRect = (viewportRect, sceneTransform) => {
  const topLeft = screenToWorldPoint({ x: viewportRect.x, y: viewportRect.y }, sceneTransform);
  const bottomRight = screenToWorldPoint(
    { x: viewportRect.x + viewportRect.width, y: viewportRect.y + viewportRect.height },
    sceneTransform
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
};

export const snapWorldRectToContent = (worldRect, contentBounds, tolerancePx, sceneScale) => {
  if (!worldRect || !contentBounds || !sceneScale) {
    return worldRect;
  }

  const toleranceWorld = tolerancePx / sceneScale;
  const nextRect = { ...worldRect };

  const right = worldRect.x + worldRect.width;
  const bottom = worldRect.y + worldRect.height;
  const contentRight = contentBounds.x + contentBounds.width;
  const contentBottom = contentBounds.y + contentBounds.height;

  if (Math.abs(worldRect.x - contentBounds.x) <= toleranceWorld) {
    nextRect.x = contentBounds.x;
  }
  if (Math.abs(right - contentRight) <= toleranceWorld) {
    nextRect.x = contentRight - worldRect.width;
  }
  if (Math.abs(worldRect.y - contentBounds.y) <= toleranceWorld) {
    nextRect.y = contentBounds.y;
  }
  if (Math.abs(bottom - contentBottom) <= toleranceWorld) {
    nextRect.y = contentBottom - worldRect.height;
  }

  return nextRect;
};

export const worldRectToScreenRect = (worldRect, sceneTransform) => ({
  x: worldRect.x * sceneTransform.scale + sceneTransform.offsetX,
  y: worldRect.y * sceneTransform.scale + sceneTransform.offsetY,
  width: worldRect.width * sceneTransform.scale,
  height: worldRect.height * sceneTransform.scale,
});
