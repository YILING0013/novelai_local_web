export const MASK_CELL_SIZE = 8;

/**
 * 创建二值蒙版，右侧和底部向上补齐为完整的 8px 格子。
 * @param {number} width 原图像素宽度。
 * @param {number} height 原图像素高度。
 * @returns {object} 画布尺寸、行列数和每格为 0 或 1 的 data。
 */
export function createMask(width, height) {
  const cols = Math.ceil(width / MASK_CELL_SIZE);
  const rows = Math.ceil(height / MASK_CELL_SIZE);
  return { x: 0, y: 0, width: cols * MASK_CELL_SIZE, height: rows * MASK_CELL_SIZE, cols, rows, data: new Uint8Array(cols * rows) };
}

/**
 * 生成实际绘制与光标共用的笔刷形状。
 * @param {number} diameter 以格为单位的直径，范围 1～65。
 * @param {boolean} square 是否使用方形笔刷。
 * @returns {object} 直径和相对落点的格子偏移 offsets。
 */
export function createBrush(diameter, square = false) {
  const offsets = [];
  const half = Math.floor(diameter / 2);
  const centerOffset = diameter % 2 === 0 ? 0.5 : 0;
  for (let y = -half; y < diameter - half; y += 1) {
    for (let x = -half; x < diameter - half; x += 1) {
      if (square || (x + centerOffset) ** 2 + (y + centerOffset) ** 2 <= diameter ** 2 / 4) offsets.push([x, y]);
    }
  }
  return { diameter, offsets };
}

/**
 * 奇数格笔刷对齐格子中心，偶数格笔刷对齐网格交点，屏幕缩放不参与计算。
 * @param {number} x 原图横坐标。
 * @param {number} y 原图纵坐标。
 * @param {number} diameter 以格为单位的笔刷直径。
 * @returns {{x:number,y:number}} 笔刷落点的网格坐标。
 */
export function snapPoint(x, y, diameter) {
  const shift = diameter % 2 === 0 ? 0.5 : 0;
  return { x: Math.floor(x / MASK_CELL_SIZE + shift), y: Math.floor(y / MASK_CELL_SIZE + shift) };
}

/**
 * 沿两个网格落点用 Bresenham 逐格盖章，快速拖动也不会断笔。
 * @param {object} mask createMask 创建的蒙版；可附加 touched 记录全部覆盖格子。
 * @param {object} from 起点网格坐标。
 * @param {object} to 终点网格坐标。
 * @param {object} brush createBrush 创建的笔刷。
 * @param {0|1} value 1 为涂抹，0 为擦除。
 * @returns {void} 直接更新蒙版数据。
 */
export function paintSegment(mask, from, to, brush, value) {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const stepX = x < to.x ? 1 : -1;
  const stepY = y < to.y ? 1 : -1;
  let error = dx - dy;
  while (true) {
    for (const [ox, oy] of brush.offsets) {
      const col = x + ox;
      const row = y + oy;
      if (col < 0 || row < 0 || col >= mask.cols || row >= mask.rows) continue;
      const index = row * mask.cols + col;
      mask.data[index] = value;
      // 擦过的空格也需要覆盖自动扩图蒙版，不能只记录从 1 变成 0 的位置。
      if (mask.touched) mask.touched[index] = 1;
    }
    if (x === to.x && y === to.y) break;
    const twiceError = 2 * error;
    if (twiceError > -dy) { error -= dy; x += stepX; }
    if (twiceError < dx) { error += dx; y += stepY; }
  }
}

/**
 * 按笔划先后顺序生成最终二值蒙版，显示和导出共用此数据。
 * @param {Array} strokes 使用原图 points、size、shape 的 path 笔划，或包含 rect 的矩形笔划。
 * @param {object} worldRect 需要绘制的原图坐标范围。
 * @returns {object} 原图坐标 x/y、8px 网格 data 和所有操作覆盖的 touched。
 */
export function createMaskGrid(strokes, worldRect) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const stroke of strokes) {
    if (stroke.type === 'rect') {
      left = Math.min(left, stroke.rect.x);
      top = Math.min(top, stroke.rect.y);
      right = Math.max(right, stroke.rect.x + stroke.rect.width);
      bottom = Math.max(bottom, stroke.rect.y + stroke.rect.height);
    } else {
      const radius = stroke.size / 2 + MASK_CELL_SIZE;
      for (const point of stroke.points) {
        left = Math.min(left, point.x - radius);
        top = Math.min(top, point.y - radius);
        right = Math.max(right, point.x + radius);
        bottom = Math.max(bottom, point.y + radius);
      }
    }
  }
  // 只创建可见笔迹范围的网格，缩小视图时不会按巨大的空白区域分配画布。
  left = Math.max(left, worldRect.x);
  top = Math.max(top, worldRect.y);
  right = Math.min(right, worldRect.x + worldRect.width);
  bottom = Math.min(bottom, worldRect.y + worldRect.height);
  if (right <= left || bottom <= top) return { ...createMask(0, 0), touched: new Uint8Array(0) };
  const originX = Math.floor(left / MASK_CELL_SIZE);
  const originY = Math.floor(top / MASK_CELL_SIZE);
  const cols = Math.ceil(right / MASK_CELL_SIZE) - originX;
  const rows = Math.ceil(bottom / MASK_CELL_SIZE) - originY;
  const mask = { ...createMask(cols * MASK_CELL_SIZE, rows * MASK_CELL_SIZE), x: originX * MASK_CELL_SIZE, y: originY * MASK_CELL_SIZE, touched: new Uint8Array(cols * rows) };
  for (const stroke of strokes) {
    const value = stroke.mode === 'erase' ? 0 : 1;
    if (stroke.type === 'rect') {
      if (!stroke.rect.width || !stroke.rect.height) continue;
      const x0 = Math.max(0, Math.floor(stroke.rect.x / MASK_CELL_SIZE) - originX);
      const y0 = Math.max(0, Math.floor(stroke.rect.y / MASK_CELL_SIZE) - originY);
      const x1 = Math.min(cols, Math.ceil((stroke.rect.x + stroke.rect.width) / MASK_CELL_SIZE) - originX);
      const y1 = Math.min(rows, Math.ceil((stroke.rect.y + stroke.rect.height) / MASK_CELL_SIZE) - originY);
      if (x1 <= x0 || y1 <= y0) continue;
      for (let row = y0; row < y1; row += 1) {
        mask.data.fill(value, row * cols + x0, row * cols + x1);
        mask.touched.fill(1, row * cols + x0, row * cols + x1);
      }
      continue;
    }
    const brush = createBrush(Math.round(stroke.size / MASK_CELL_SIZE), stroke.shape === 'square');
    let previous = null;
    for (const point of stroke.points) {
      const snapped = snapPoint(point.x, point.y, brush.diameter);
      const current = { x: snapped.x - originX, y: snapped.y - originY };
      paintSegment(mask, previous || current, current, brush, value);
      previous = current;
    }
  }
  return mask;
}

/**
 * 用最近邻显示网格；原图 2px 描边仅用于预览，不污染实际蒙版。
 * @param {object} options 目标 ctx、mask、原图 worldRect、输出宽高，可选 color/opacity/outline。
 * @returns {void} 按指定颜色绘制，保留目标画布原有的合成方式。
 */
export function drawMaskGrid({ ctx, mask, worldRect, outputWidth, outputHeight, color = '#ffffff', opacity = 1, outline = false }) {
  if (!mask.cols || !mask.rows) return;
  const units = outline ? 4 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = mask.cols * units;
  canvas.height = mask.rows * units;
  const gridCtx = canvas.getContext('2d');
  gridCtx.fillStyle = color;
  for (let row = 0; row < mask.rows; row += 1) {
    for (let col = 0; col < mask.cols; col += 1) {
      const index = row * mask.cols + col;
      if (!mask.data[index]) continue;
      const x = col * units;
      const y = row * units;
      gridCtx.globalAlpha = opacity;
      gridCtx.fillRect(x, y, units, units);
      if (!outline) continue;
      gridCtx.globalAlpha = 1;
      if (!col || !mask.data[index - 1]) gridCtx.fillRect(x, y, 1, units);
      if (col === mask.cols - 1 || !mask.data[index + 1]) gridCtx.fillRect(x + units - 1, y, 1, units);
      if (!row || !mask.data[index - mask.cols]) gridCtx.fillRect(x, y, units, 1);
      if (row === mask.rows - 1 || !mask.data[index + mask.cols]) gridCtx.fillRect(x, y + units - 1, units, 1);
    }
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const scaleX = outputWidth / worldRect.width;
  const scaleY = outputHeight / worldRect.height;
  ctx.drawImage(canvas, (mask.x - worldRect.x) * scaleX, (mask.y - worldRect.y) * scaleY, mask.width * scaleX, mask.height * scaleY);
  ctx.restore();
}

/**
 * 绘制与实际笔刷覆盖一致的格子光标，屏幕变换只影响显示。
 * @param {object} options 目标 ctx、原图 point、原图像素 size、shape、sceneTransform、颜色和擦除状态。
 * @returns {void} 绘制半透明填充及清晰的轮廓。
 */
export function drawMaskBrushCursor({ ctx, point, size, shape = 'circle', sceneTransform, color = '#ffffff', erase = false }) {
  const brush = createBrush(Math.round(size / MASK_CELL_SIZE), shape === 'square');
  const snapped = snapPoint(point.x, point.y, brush.diameter);
  const cells = new Set(brush.offsets.map(([x, y]) => `${x},${y}`));
  const { scale, offsetX, offsetY } = sceneTransform;
  ctx.save();
  ctx.translate(snapped.x * MASK_CELL_SIZE * scale + offsetX, snapped.y * MASK_CELL_SIZE * scale + offsetY);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  for (const [x, y] of brush.offsets) ctx.fillRect(x * MASK_CELL_SIZE, y * MASK_CELL_SIZE, MASK_CELL_SIZE, MASK_CELL_SIZE);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (const [x, y] of brush.offsets) {
    const px = x * MASK_CELL_SIZE;
    const py = y * MASK_CELL_SIZE;
    if (!cells.has(`${x - 1},${y}`)) { ctx.moveTo(px, py); ctx.lineTo(px, py + MASK_CELL_SIZE); }
    if (!cells.has(`${x + 1},${y}`)) { ctx.moveTo(px + MASK_CELL_SIZE, py); ctx.lineTo(px + MASK_CELL_SIZE, py + MASK_CELL_SIZE); }
    if (!cells.has(`${x},${y - 1}`)) { ctx.moveTo(px, py); ctx.lineTo(px + MASK_CELL_SIZE, py); }
    if (!cells.has(`${x},${y + 1}`)) { ctx.moveTo(px, py + MASK_CELL_SIZE); ctx.lineTo(px + MASK_CELL_SIZE, py + MASK_CELL_SIZE); }
  }
  ctx.lineJoin = 'miter';
  ctx.lineWidth = 3 / scale;
  ctx.strokeStyle = 'rgba(33,18,49,0.7)';
  ctx.stroke();
  ctx.lineWidth = 1.2 / scale;
  ctx.strokeStyle = erase ? '#ffe9b6' : '#f5e9ff';
  ctx.stroke();
  ctx.restore();
}
