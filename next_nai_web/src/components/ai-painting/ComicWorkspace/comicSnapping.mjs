import { panelBounds } from './comicDocument.mjs';

/**
 * 将切割点吸附到最近的画框边，距离相同时优先使用传入顺序靠前的画框。
 * @param {Array<object>} panels 已按顶层优先排列的可编辑画框。
 * @param {{x:number,y:number}} point 当前指针的页面坐标。
 * @param {number} threshold 最大吸附距离，由调用者从屏幕像素换算为页面坐标。
 * @returns {{panelId:string,edgeIndex:number,point:object,distance:number}|null} 最近边界及距离；范围内无边界时返回 null。
 */
export function snapComicCutPoint(panels, point, threshold) {
  let nearest = null;
  for (const panel of panels) for (let edgeIndex = 0; edgeIndex < panel.points.length; edgeIndex += 1) {
    const start = panel.points[edgeIndex], end = panel.points[(edgeIndex + 1) % panel.points.length];
    const deltaX = end.x - start.x, deltaY = end.y - start.y;
    const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / (deltaX * deltaX + deltaY * deltaY)));
    const snapped = { x: start.x + fraction * deltaX, y: start.y + fraction * deltaY };
    const distance = Math.hypot(snapped.x - point.x, snapped.y - point.y);
    if (distance <= threshold && (!nearest || distance < nearest.distance)) nearest = { panelId: panel.id, edgeIndex, point: snapped, distance };
  }
  return nearest;
}

/**
 * 找出一段鼠标轨迹真正穿过的画框边界，排除沿边滑动和只碰到顶点的情况。
 * @param {object} panel 要检查的画框。
 * @param {{x:number,y:number}} start 上一次指针的页面坐标。
 * @param {{x:number,y:number}} end 当前指针的页面坐标。
 * @returns {Array<{panelId:string,edgeIndex:number,point:object,distance:number}>} 按轨迹方向排列的交点，同一顶点只出现一次；distance 为到 start 的页面距离。
 */
export function comicCutIntersections(panel, start, end) {
  const deltaX = end.x - start.x, deltaY = end.y - start.y;
  if (!deltaX && !deltaY) return [];
  const epsilon = 0.0000001;
  const intersections = [];
  for (let edgeIndex = 0; edgeIndex < panel.points.length; edgeIndex += 1) {
    const edgeStart = panel.points[edgeIndex], edgeEnd = panel.points[(edgeIndex + 1) % panel.points.length];
    const edgeX = edgeEnd.x - edgeStart.x, edgeY = edgeEnd.y - edgeStart.y;
    const denominator = deltaX * edgeY - deltaY * edgeX;
    if (Math.abs(denominator) < epsilon) continue;
    const offsetX = edgeStart.x - start.x, offsetY = edgeStart.y - start.y;
    const along = (offsetX * edgeY - offsetY * edgeX) / denominator;
    const across = (offsetX * deltaY - offsetY * deltaX) / denominator;
    if (along < -epsilon || along > 1 + epsilon || across < -epsilon || across > 1 + epsilon) continue;
    if (across <= epsilon || across >= 1 - epsilon) {
      const vertex = across <= epsilon ? edgeIndex : (edgeIndex + 1) % panel.points.length;
      const previous = panel.points[(vertex + panel.points.length - 1) % panel.points.length], next = panel.points[(vertex + 1) % panel.points.length];
      const previousSide = deltaX * (previous.y - start.y) - deltaY * (previous.x - start.x);
      const nextSide = deltaX * (next.y - start.y) - deltaY * (next.x - start.x);
      // 顶点两侧必须分处轨迹两边，擦边或沿边滑动不会把画框切开。
      if (!(previousSide > epsilon && nextSide < -epsilon) && !(previousSide < -epsilon && nextSide > epsilon)) continue;
    }
    const point = { x: start.x + along * deltaX, y: start.y + along * deltaY };
    if (intersections.some((match) => Math.hypot(match.point.x - point.x, match.point.y - point.y) <= epsilon)) continue;
    intersections.push({ panelId: panel.id, edgeIndex, point, distance: Math.hypot(point.x - start.x, point.y - start.y) });
  }
  return intersections.sort((first, second) => first.distance - second.distance);
}

/**
 * 为顶点、边和整框拖动计算吸附位移及参考线；距离使用页面坐标，由调用者换算屏幕像素。
 * @param {object} options 起始画框、操作类型、位移、可见参考框、页面边界和吸附距离。
 * @returns {{delta:object,guides:Array}} 修正后的位移与紫色引导线端点。
 */
export function snapPanelDrag({ panel, kind, index, delta, references, bounds, threshold, shift = false }) {
  const points = panel.points;
  let adjusted = { ...delta };
  const lockedAxis = shift ? (Math.abs(delta.x) > Math.abs(delta.y) ? 'y' : 'x') : null;
  if (lockedAxis) adjusted[lockedAxis] = 0;
  const moving = kind === 'vertex' ? [points[index]] : kind === 'edge' ? [points[index], points[(index + 1) % points.length]] : points;
  const anchors = moving.map((p) => ({ x: p.x + adjusted.x, y: p.y + adjusted.y }));
  if (kind !== 'vertex') {
    const box = panelBounds(anchors);
    anchors.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const pagePoints = [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ];
  const targets = [pagePoints, ...references.map((item) => item.points)];
  const fixed = kind === 'move' ? [] : points.filter((_, i) => i !== index && (kind !== 'edge' || i !== (index + 1) % points.length));
  const targetPoints = [...fixed];
  targets.forEach((polygon) => {
    const box = panelBounds(polygon);
    targetPoints.push(...polygon, { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  });
  // 对角点及两侧顶点能推算平行四边形的缺角，拖歪后可直接吸回对称形状。
  let symmetric;
  if (kind === 'vertex' && points.length === 4) {
    const previous = points[(index + 3) % 4], next = points[(index + 1) % 4], opposite = points[(index + 2) % 4];
    symmetric = { x: previous.x + next.x - opposite.x, y: previous.y + next.y - opposite.y };
    targetPoints.push(symmetric);
  }
  const best = { x: null, y: null };
  for (const axis of ['x', 'y']) {
    if (axis === lockedAxis) continue;
    for (const anchor of anchors) for (const target of targetPoints) {
      const offset = target[axis] - anchor[axis];
      if (Math.abs(offset) <= threshold && (!best[axis] || Math.abs(offset) < Math.abs(best[axis].offset))) best[axis] = { offset, anchor, target };
    }
  }
  const guides = [];
  // 整框移动时，优先寻找同一行/列的邻框：居中留白和重复留白都可以吸附。
  if (kind === 'move') {
    const box = panelBounds(anchors);
    const boxes = references.map(panelBounds);
    for (const axis of ['x', 'y']) {
      if (axis === lockedAxis) continue;
      const other = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'width' : 'height', crossSize = axis === 'x' ? 'height' : 'width';
      const neighbors = boxes.filter((b) => Math.min(b[other] + b[crossSize], box[other] + box[crossSize]) > Math.max(b[other], box[other]));
      const before = neighbors.filter((b) => b[axis] + b[size] <= box[axis] + threshold).sort((a, b) => b[axis] + b[size] - a[axis] - a[size]);
      const after = neighbors.filter((b) => b[axis] >= box[axis] + box[size] - threshold).sort((a, b) => a[axis] - b[axis]);
      const cross = box[other] + box[crossSize] / 2;
      const measure = (from, to) => ({ a: { [axis]: from, [other]: cross }, b: { [axis]: to, [other]: cross }, measure: true });
      const candidates = [];
      if (before[0] && after[0]) {
        const end = before[0][axis] + before[0][size], start = after[0][axis];
        const gap = (start - end - box[size]) / 2;
        if (gap >= 0) candidates.push({ value: end + gap, guides: [measure(end, end + gap), measure(start - gap, start)] });
      }
      if (before.length > 1) {
        const end = before[0][axis] + before[0][size], previousEnd = before[1][axis] + before[1][size];
        const gap = before[0][axis] - previousEnd;
        if (gap >= 0) candidates.push({ value: end + gap, guides: [measure(previousEnd, before[0][axis]), measure(end, end + gap)] });
      }
      if (after.length > 1) {
        const end = after[0][axis] + after[0][size], gap = after[1][axis] - end;
        if (gap >= 0) candidates.push({ value: after[0][axis] - gap - box[size], guides: [measure(end, after[1][axis]), measure(after[0][axis] - gap, after[0][axis])] });
      }
      for (const candidate of candidates) {
        const offset = candidate.value - box[axis];
        if (Math.abs(offset) <= threshold && (!best[axis] || Math.abs(offset) < Math.abs(best[axis].offset))) best[axis] = { offset, guides: candidate.guides };
      }
    }
  }
  for (const axis of ['x', 'y']) if (best[axis]) adjusted[axis] += best[axis].offset;
  for (const axis of ['x', 'y']) {
    const match = best[axis];
    if (!match) continue;
    if (match.guides) { guides.push(...match.guides); continue; }
    const other = axis === 'x' ? 'y' : 'x';
    const cross = match.anchor[other] + (best[other]?.offset || 0);
    guides.push({ a: { [axis]: match.target[axis], [other]: Math.min(cross, match.target[other]) - threshold * 2 }, b: { [axis]: match.target[axis], [other]: Math.max(cross, match.target[other]) + threshold * 2 } });
  }
  if (kind === 'vertex' && !lockedAxis) {
    const anchor = anchors[0];
    if (symmetric && Math.hypot(anchor.x - symmetric.x, anchor.y - symmetric.y) <= threshold) {
      adjusted = { x: symmetric.x - points[index].x, y: symmetric.y - points[index].y };
      return { delta: adjusted, guides: [{ a: points[(index + 3) % 4], b: symmetric }, { a: symmetric, b: points[(index + 1) % 4] }] };
    }
    // 斜边用正交投影吸附，不能只比较外接矩形的横纵坐标。
    let nearest;
    for (const polygon of targets) for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((anchor.x - a.x) * dx + (anchor.y - a.y) * dy) / length));
      const p = { x: a.x + t * dx, y: a.y + t * dy }, distance = Math.hypot(p.x - anchor.x, p.y - anchor.y);
      if (distance <= threshold && (!nearest || distance < nearest.distance)) nearest = { p, distance, a, b };
    }
    if (nearest && ((!best.x && !best.y) || (nearest.distance < Math.hypot(best.x?.offset || 0, best.y?.offset || 0)))) {
      return { delta: { x: nearest.p.x - points[index].x, y: nearest.p.y - points[index].y }, guides: [{ a: nearest.a, b: nearest.b }] };
    }
  }
  if (lockedAxis) guides.push({ a: moving[0], b: { x: moving[0].x + adjusted.x, y: moving[0].y + adjusted.y } });
  return { delta: adjusted, guides };
}

/**
 * 旋转吸附到水平/竖直或邻框边线；按 Shift 时固定以 15 度递增。
 * @param {number} angle 当前边线的角度（度）。
 * @param {Array} references 可见参考画框。
 * @param {boolean} shift 是否强制 15 度吸附。
 * @returns {{angle:number,snapped:boolean}} 修正角度和是否显示参考线。
 */
export function snapPanelAngle(angle, references, shift = false) {
  if (shift) return { angle: Math.round(angle / 15) * 15, snapped: true };
  const targets = [0, 90];
  for (const panel of references) panel.points.forEach((p, index) => {
    const next = panel.points[(index + 1) % panel.points.length];
    targets.push(Math.atan2(next.y - p.y, next.x - p.x) * 180 / Math.PI);
  });
  let correction = 3;
  let snapped = false;
  for (const target of targets) {
    const difference = ((target - angle) % 180 + 270) % 180 - 90;
    if (Math.abs(difference) <= Math.abs(correction)) { correction = difference; snapped = true; }
  }
  return { angle: snapped ? angle + correction : angle, snapped };
}
