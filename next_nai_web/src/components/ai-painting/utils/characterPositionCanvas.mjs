/**
 * 将角色位置画布按图像宽高比完整放入宿主区域。
 *
 * @param {number} hostWidth 宿主区域宽度。
 * @param {number} hostHeight 宿主区域高度。
 * @param {number} imageWidth 当前生成图像宽度。
 * @param {number} imageHeight 当前生成图像高度。
 * @returns {{width:number,height:number}} 等比缩放后的画布尺寸。
 */
export const fitCharacterPositionCanvas = (
  hostWidth,
  hostHeight,
  imageWidth,
  imageHeight,
) => {
  const availableWidth = Number(hostWidth);
  const availableHeight = Number(hostHeight);
  const sourceWidth = Number(imageWidth);
  const sourceHeight = Number(imageHeight);

  if (
    !Number.isFinite(availableWidth)
    || !Number.isFinite(availableHeight)
    || !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || availableWidth <= 0
    || availableHeight <= 0
    || sourceWidth <= 0
    || sourceHeight <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
};
