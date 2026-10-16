export const SHAPES = [
  ["rect", "矩形"], ["roundRect", "圆角矩形"], ["ellipse", "椭圆"],
  ["triangle", "三角形"], ["diamond", "菱形"], ["pentagon", "五边形"],
  ["hexagon", "六边形"], ["star", "星形"], ["arrow", "箭头"],
  ["heart", "心形"], ["line", "直线"],
];
export const SHAPE_TYPES = SHAPES.map(([type]) => type);
export const DEFAULT_SHAPE_OPTIONS = {
  radius: 24, strokeWidth: 0, starPoints: 5, starInner: 45, arrowHead: 40, arrowShaft: 40,
};

/** 在给定边框内建立可编辑形状路径，描边预留半个线宽以免被边缘裁掉。
 * @param {CanvasRenderingContext2D} ctx 绘图上下文。
 * @param {object} layer 形状类型、几何参数与描边宽度。
 * @param {number} width 图层画布宽度。
 * @param {number} height 图层画布高度。
 */
export function shapePath(ctx, layer, width, height) {
  const inset = Math.min((layer.strokeWidth || 0) / 2, width / 2, height / 2);
  const w = Math.max(0.1, width - inset * 2), h = Math.max(0.1, height - inset * 2);
  const cx = width / 2, cy = height / 2;
  ctx.beginPath();
  if (layer.type === "ellipse") ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (layer.type === "line") {
    ctx.moveTo(inset, layer.lineReverse ? height - inset : inset);
    ctx.lineTo(width - inset, layer.lineReverse ? inset : height - inset);
  } else if (["triangle", "diamond", "pentagon", "hexagon", "star"].includes(layer.type)) {
    const sides = { triangle: 3, diamond: 4, pentagon: 5, hexagon: 6 }[layer.type] || layer.starPoints || 5;
    const count = layer.type === "star" ? sides * 2 : sides;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
      const radius = layer.type === "star" && i % 2 ? (layer.starInner ?? 45) / 100 : 1;
      const x = cx + Math.cos(angle) * w / 2 * radius, y = cy + Math.sin(angle) * h / 2 * radius;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  } else if (layer.type === "arrow") {
    const head = w * (layer.arrowHead ?? 40) / 100, shaft = h * (layer.arrowShaft ?? 40) / 100;
    ctx.moveTo(inset, cy - shaft / 2);
    ctx.lineTo(width - inset - head, cy - shaft / 2);
    ctx.lineTo(width - inset - head, inset);
    ctx.lineTo(width - inset, cy);
    ctx.lineTo(width - inset - head, height - inset);
    ctx.lineTo(width - inset - head, cy + shaft / 2);
    ctx.lineTo(inset, cy + shaft / 2);
    ctx.closePath();
  } else if (layer.type === "heart") {
    ctx.moveTo(cx, inset + h * 0.24);
    ctx.bezierCurveTo(inset + w * 0.18, inset - h * 0.16, inset - w * 0.15, inset + h * 0.25, cx, height - inset);
    ctx.bezierCurveTo(width + w * 0.15 - inset, inset + h * 0.25, inset + w * 0.82, inset - h * 0.16, cx, inset + h * 0.24);
    ctx.closePath();
  } else ctx.roundRect(inset, inset, w, h, Math.min(layer.radius || 0, w / 2, h / 2));
}
