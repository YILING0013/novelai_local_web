// 轮廓以 0..100 保存，缩放对白框时节点与控制柄一起缩放。
function node(x, y, inX = x, inY = y, outX = x, outY = y) {
  return { x, y, inX, inY, outX, outY };
}

function ellipse(cx, cy, rx, ry) {
  const k = 0.5522847498307936;
  return [
    node(cx, cy - ry, cx - rx * k, cy - ry, cx + rx * k, cy - ry),
    node(cx + rx, cy, cx + rx, cy - ry * k, cx + rx, cy + ry * k),
    node(cx, cy + ry, cx + rx * k, cy + ry, cx - rx * k, cy + ry),
    node(cx - rx, cy, cx - rx, cy + ry * k, cx - rx, cy - ry * k),
  ].map((point) => ({ ...point, smooth: true }));
}

/**
 * 取得预设对白框的闭合曲线；每次返回独立节点，供预览、导出和曲线编辑共用。
 * @param {string} presetId 对白框预设编号。
 * @returns {Array<Array<object>>} 各闭合轮廓的锚点及入、出控制柄。
 */
export function comicBalloonContours(presetId) {
  const speech = [node(25, 76, 25, 76, 9, 70), node(4, 43, 4, 58, 4, 17), node(50, 4, 24, 4, 78, 4), node(96, 43, 96, 18, 96, 69), node(46, 81, 73, 82), node(18, 96)];
  const cloud = [node(19, 20, 4, 21, 17, 8), node(44, 10, 36, 1, 56, 0), node(76, 17, 72, 5, 92, 13), node(92, 39, 101, 28, 104, 51), node(83, 70, 96, 69, 86, 88), node(54, 86, 65, 97, 40, 101), node(20, 78, 20, 91, 2, 81), node(9, 50, -2, 58, -1, 37)];
  if (presetId === 'ellipse' || presetId === 'speed-oval') return [ellipse(50, 50, 46, 45)];
  if (presetId === 'caption' || presetId === 'speed') return [[node(4, 5), node(96, 5), node(96, 95), node(4, 95)]];
  if (presetId === 'round-box') return [[
    node(15, 5, 8, 5), node(85, 5, 85, 5, 93, 5), node(96, 17, 96, 9), node(96, 68, 96, 68, 96, 76),
    node(84, 80, 92, 80), node(45, 80), node(21, 96), node(24, 80), node(15, 80, 15, 80, 8, 80), node(4, 68, 4, 76), node(4, 17, 4, 17, 4, 9),
  ]];
  if (presetId === 'cloud') return [cloud];
  if (presetId === 'thought') return [cloud.map((point) => ({ x: point.x * 0.94 + 3, y: point.y * 0.8 + 1, inX: point.inX * 0.94 + 3, inY: point.inY * 0.8 + 1, outX: point.outX * 0.94 + 3, outY: point.outY * 0.8 + 1 })), ellipse(24, 85, 7, 5), ellipse(14, 94, 3, 2.5)];
  if (['shout', 'impact', 'burst-fine', 'jagged-star'].includes(presetId)) {
    const count = presetId === 'burst-fine' ? 60 : presetId === 'jagged-star' ? 34 : presetId === 'shout' ? 28 : 18;
    return [Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count - Math.PI / 2;
      const varied = (Math.sin(index * 12.9898 + 4.1) + 1) / 2;
      const radius = index % 2 ? (presetId === 'impact' ? 0.58 : presetId === 'shout' ? 0.77 : presetId === 'burst-fine' ? 0.33 + varied * 0.2 : 0.72 + varied * 0.08) : (presetId === 'burst-fine' || presetId === 'jagged-star' ? 0.82 + varied * 0.18 : 1);
      return node(50 + Math.cos(angle) * 47 * radius, 50 + Math.sin(angle) * 46 * radius);
    })];
  }
  if (presetId === 'electric') return [[[12, 14], [29, 9], [38, 15], [53, 4], [64, 12], [85, 9], [88, 26], [97, 36], [89, 51], [95, 67], [79, 77], [56, 73], [31, 96], [38, 76], [17, 78], [13, 65], [3, 52], [12, 38], [6, 26]].map(([x, y]) => node(x, y))];
  if (presetId === 'jaggy-small') return [[
    node(19, 5, 23, 25, 28, 16), node(52, 11, 39, 15, 65, 15), node(82, 3, 72, 15, 74, 26),
    node(84, 42, 78, 34, 88, 45), node(96, 48, 94, 48, 84, 52), node(82, 91, 80, 71, 68, 87),
    node(59, 94, 65, 88, 55, 86), node(22, 94, 36, 89, 23, 74), node(5, 51, 20, 61, 23, 49),
  ]];
  if (presetId === 'jaggy-wide') return [[
    node(5, 5, 19, 22, 23, 21), node(47, 6, 33, 16, 53, 17), node(74, 5, 62, 19, 77, 14),
    node(95, 7, 88, 15, 84, 31), node(96, 50, 84, 40, 84, 62), node(96, 94, 85, 77, 81, 85),
    node(57, 95, 71, 85, 45, 85), node(5, 94, 29, 85, 19, 74), node(4, 48, 16, 58, 19, 32),
  ]];
  if (presetId === 'announcement') return [[
    node(4, 13, 11, 37, 15, 18), node(23, 15, 18, 18), node(23, 3), node(41, 16), node(77, 16, 59, 19), node(92, 4),
    node(86, 25), node(96, 24), node(89, 49, 91, 37, 90, 63), node(98, 73), node(84, 72), node(87, 96),
    node(69, 88, 75, 89, 51, 85), node(10, 94, 28, 89, 16, 71), node(3, 66), node(13, 54, 11, 60, 12, 37),
  ]];
  if (presetId === 'whisper-oval') return [ellipse(50, 50, 42, 46)];
  if (presetId === 'vibration' || presetId === 'mumble') {
    const count = presetId === 'vibration' ? 24 : 16;
    const points = Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count - Math.PI / 2;
      const radius = presetId === 'vibration' ? (index % 2 ? 0.92 : 1) : 0.96 + Math.sin(index * 2.3) * 0.045;
      return node(50 + Math.cos(angle) * (presetId === 'mumble' ? 38 : 45) * radius, 50 + Math.sin(angle) * 46 * radius);
    });
    return [points.map((point, index) => {
      const previous = points[(index + count - 1) % count], next = points[(index + 1) % count];
      return { ...node(point.x, point.y, point.x - (next.x - previous.x) / 6, point.y - (next.y - previous.y) / 6, point.x + (next.x - previous.x) / 6, point.y + (next.y - previous.y) / 6), smooth: true };
    })];
  }
  if (presetId === 'speech-right') return [speech.map((point) => ({ ...point, x: 100 - point.x, inX: 100 - point.inX, outX: 100 - point.outX }))];
  return [speech];
}

/**
 * 将一条闭合轮廓转换为三次贝塞尔路径，预览和导出使用同一份节点。
 * @param {Array<object>} contour 至少三个锚点，带绝对入、出控制柄。
 * @returns {string} SVG path 的 d 属性。
 */
export function comicBalloonPath(contour) {
  return `M ${contour[0].x} ${contour[0].y} ${contour.map((point, index) => {
    const next = contour[(index + 1) % contour.length];
    return `C ${point.outX} ${point.outY} ${next.inX} ${next.inY} ${next.x} ${next.y}`;
  }).join(' ')} Z`;
}

/**
 * 在选中节点之后拆分曲线，增加节点而不改变原轮廓。
 * @param {Array<object>} contour 原闭合轮廓，不会修改原数组。
 * @param {number} index 要拆分的曲线起点索引。
 * @returns {Array<object>} 多一个中点节点的新轮廓。
 */
export function splitComicBalloonCurve(contour, index) {
  const points = contour.map((point) => ({ ...point }));
  const start = points[index], end = points[(index + 1) % points.length];
  // De Casteljau 中点拆分保留曲线形状，同时缩短两端的控制柄。
  const a = { x: (start.x + start.outX) / 2, y: (start.y + start.outY) / 2 };
  const b = { x: (start.outX + end.inX) / 2, y: (start.outY + end.inY) / 2 };
  const c = { x: (end.inX + end.x) / 2, y: (end.inY + end.y) / 2 };
  const d = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, e = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const middle = { ...node((d.x + e.x) / 2, (d.y + e.y) / 2, d.x, d.y, e.x, e.y), smooth: true };
  start.outX = a.x; start.outY = a.y;
  end.inX = c.x; end.inY = c.y;
  points.splice(index + 1, 0, middle);
  return points;
}

/**
 * 移动曲线锚点或控制柄；移动锚点会带上两根柄，平滑节点保持两柄方向相反。
 * @param {Array<Array<object>>} contours 原轮廓，不会原地修改。
 * @param {{contour:number,node:number,handle:'anchor'|'in'|'out'}} target 要编辑的点。
 * @param {{x:number,y:number}} position 0..100 坐标；控制柄允许伸出少量边界。
 * @param {boolean} separate 是否解除平滑柄联动，供 Alt 拖动使用。
 * @returns {Array<Array<object>>} 编辑后的独立轮廓。
 */
export function moveComicBalloonPoint(contours, target, position, separate = false) {
  const anchor = target.handle === 'anchor';
  const x = Math.max(anchor ? 0 : -20, Math.min(anchor ? 100 : 120, position.x));
  const y = Math.max(anchor ? 0 : -20, Math.min(anchor ? 100 : 120, position.y));
  return contours.map((contour, contourIndex) => contourIndex !== target.contour ? contour : contour.map((point, index) => {
    if (index !== target.node) return point;
    if (anchor) return { ...point, x, y, inX: point.inX + x - point.x, inY: point.inY + y - point.y, outX: point.outX + x - point.x, outY: point.outY + y - point.y };
    const changed = { ...point, [`${target.handle}X`]: x, [`${target.handle}Y`]: y, smooth: separate ? false : point.smooth };
    if (changed.smooth) {
      const opposite = target.handle === 'in' ? 'out' : 'in';
      const length = Math.hypot(point[`${opposite}X`] - point.x, point[`${opposite}Y`] - point.y);
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance) {
        changed[`${opposite}X`] = point.x - (x - point.x) * length / distance;
        changed[`${opposite}Y`] = point.y - (y - point.y) * length / distance;
      }
    }
    return changed;
  }));
}
