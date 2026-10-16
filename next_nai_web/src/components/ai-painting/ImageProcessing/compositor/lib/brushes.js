export const DEFAULT_BRUSH = {
  size: 40, opacity: 100, hardness: 85, flow: 100, spacing: 12,
  angle: 0, roundness: 100, scatter: 0, sizeJitter: 0,
  pressureSize: false, flipX: false, flipY: false, tip: null,
};
export const BRUSH_FIELDS = [
  ["size", "笔刷大小", 1, 1000, "px"], ["opacity", "笔画不透明度", 1, 100, "%"],
  ["hardness", "圆笔硬度", 0, 100, "%"], ["flow", "笔刷流量", 1, 100, "%"],
  ["spacing", "笔尖间距", 1, 200, "%"], ["angle", "笔尖角度", -180, 180, "°"],
  ["roundness", "笔尖圆度", 5, 100, "%"], ["scatter", "笔尖散布", 0, 300, "%"],
  ["sizeJitter", "大小抖动", 0, 100, "%"],
];

const ranges = {
  size: [1, 1000], opacity: [1, 100], hardness: [0, 100], flow: [1, 100],
  spacing: [1, 200], angle: [-180, 180], roundness: [5, 100],
  scatter: [0, 300], sizeJitter: [0, 100],
};

/** 校验独立笔刷文件，只接受当前版本的数值设置和内嵌 PNG 笔尖。
 * @param {string} text 文件内容。
 * @returns {Array<object>} 可直接应用的命名笔刷预设。
 */
export function parseBrushPresets(text) {
  const file = JSON.parse(text);
  if (file.format !== "compositor-brush-presets" || file.version !== 1 ||
      !Array.isArray(file.presets) || !file.presets.length || file.presets.length > 100)
    throw new Error("不是支持的 .compbrush 笔刷文件（版本 1，最多 100 支）。");
  return file.presets.map((preset) => {
    if (typeof preset.name !== "string" || !preset.name.trim() || !preset.brush)
      throw new Error("笔刷缺少名称或设置。");
    const brush = { ...DEFAULT_BRUSH };
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = preset.brush[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
        throw new Error(`笔刷参数 ${key} 超出范围。`);
      brush[key] = value;
    }
    for (const key of ["pressureSize", "flipX", "flipY"])
      brush[key] = preset.brush[key] === true;
    if (preset.brush.tip) {
      const tip = preset.brush.tip;
      if (typeof tip.src !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(tip.src) ||
          tip.src.length > 6_000_000 || !Number.isInteger(tip.width) || !Number.isInteger(tip.height) ||
          tip.width < 1 || tip.height < 1 || tip.width > 1024 || tip.height > 1024)
        throw new Error("笔尖必须是最长边不超过 1024 px 的内嵌 PNG。");
      brush.tip = { name: String(tip.name || preset.name).slice(0, 80), src: tip.src, width: tip.width, height: tip.height };
    }
    return { name: preset.name.trim().slice(0, 80), brush };
  });
}

/** 把笔刷库编码为独立于画布文档的可携带文件。
 * @param {Array<object>} presets 命名预设，包含所有内嵌笔尖。
 * @returns {string} 版本化 JSON 文件内容。
 */
export function serializeBrushPresets(presets) {
  return JSON.stringify({ format: "compositor-brush-presets", version: 1, presets }, null, 2);
}

/** 沿真实移动距离生成印章，跨事件保留间距，避免输入频率改变笔迹浓度。
 * @param {object} stroke 本笔画的 brush、last 和 distanceUntilNext 状态。
 * @param {object} point 当前坐标与 pressure（鼠标固定为 1）。
 * @param {Function} random 生成散布与大小抖动的随机数。
 * @returns {Array<object>} 本段需要绘制的笔尖位置与尺寸。
 */
export function brushStrokeMarks(stroke, point, random = Math.random) {
  const brush = stroke.brush, marks = [];
  const spacing = Math.max(0.5, brush.size * brush.spacing / 100);
  const add = (x, y, pressure) => {
    const spread = brush.size * brush.scatter / 100;
    marks.push({
      x: x + (random() - 0.5) * spread,
      y: y + (random() - 0.5) * spread,
      size: Math.max(0.5, brush.size * (1 - random() * brush.sizeJitter / 100) *
        (brush.pressureSize ? Math.max(0.05, pressure) : 1)),
    });
  };
  if (!stroke.last) {
    add(point.x, point.y, point.pressure ?? 1);
    stroke.distanceUntilNext = spacing;
  } else {
    const from = stroke.last, distance = Math.hypot(point.x - from.x, point.y - from.y);
    let traveled = stroke.distanceUntilNext;
    for (; traveled <= distance; traveled += spacing) {
      const ratio = traveled / distance;
      add(from.x + (point.x - from.x) * ratio, from.y + (point.y - from.y) * ratio,
        (from.pressure ?? 1) + ((point.pressure ?? 1) - (from.pressure ?? 1)) * ratio);
    }
    stroke.distanceUntilNext = traveled - distance;
  }
  stroke.last = point;
  return marks;
}

/** 为一次笔画生成着色笔尖；自定义图像使用其透明度，圆笔使用硬度渐变。
 * @param {object} brush 笔刷设置。
 * @param {string} color 本次笔画的颜色。
 * @returns {Promise<HTMLCanvasElement>} 可重复盖章的笔尖画布。
 */
export async function createBrushStamp(brush, color) {
  const canvas = document.createElement("canvas");
  canvas.width = brush.tip?.width || Math.min(1024, Math.max(64, Math.ceil(brush.size)));
  canvas.height = brush.tip?.height || canvas.width;
  const ctx = canvas.getContext("2d");
  if (brush.tip) {
    const img = new Image();
    img.src = brush.tip.src;
    await img.decode();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const radius = canvas.width / 2;
    ctx.fillStyle = color;
    if (brush.hardness < 100) {
      const gradient = ctx.createRadialGradient(radius, radius, radius * brush.hardness / 100, radius, radius, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, `${color}00`);
      ctx.fillStyle = gradient;
    }
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

/** 按角度、圆度和翻转设置盖一次章，保留调用方的流量与混合模式。
 * @param {CanvasRenderingContext2D} ctx 绘画上下文。
 * @param {HTMLCanvasElement} stamp 已着色笔尖。
 * @param {object} mark 坐标与尺寸。
 * @param {object} brush 笔刷设置。
 */
export function drawBrushStamp(ctx, stamp, mark, brush) {
  const scale = mark.size / Math.max(stamp.width, stamp.height);
  const width = stamp.width * scale, height = stamp.height * scale * brush.roundness / 100;
  ctx.save();
  ctx.translate(mark.x, mark.y);
  ctx.rotate(brush.angle * Math.PI / 180);
  ctx.scale(brush.flipX ? -1 : 1, brush.flipY ? -1 : 1);
  ctx.drawImage(stamp, -width / 2, -height / 2, width, height);
  ctx.restore();
}

/** 从图片或 ABR 导入可用笔尖；ABR 只映射采样/圆形笔尖与基础设置。
 * @param {File} file 用户选择的 PNG、JPEG、WebP、BMP 或 ABR 文件。
 * @returns {Promise<{presets: Array<object>, notice: string}>} 新笔刷与兼容性说明。
 */
export async function importBrushFile(file) {
  if (file.size > 40 * 1024 * 1024) throw new Error("笔刷文件请控制在 40 MB 以内。");
  if (/\.compbrush$/i.test(file.name))
    return { presets: parseBrushPresets(await file.text()), notice: "已导入笔刷预设及内嵌笔尖。" };
  const presets = [], name = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
  if (/\.abr$/i.test(file.name)) {
    const { readAbr } = await import("ag-psd");
    let abr;
    try { abr = readAbr(new Uint8Array(await file.arrayBuffer())); }
    catch (error) { throw new Error(`无法读取 ABR：${error.message}。当前支持 v6/7/9/10，旧版 v1/2 与 16 位 RLE 不支持。`); }
    const tips = new Map(), referenced = new Set();
    for (const sample of abr.samples) {
      const canvas = document.createElement("canvas");
      canvas.width = sample.bounds.w;
      canvas.height = sample.bounds.h;
      const ctx = canvas.getContext("2d"), image = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < sample.alpha.length; i++) image.data[i * 4 + 3] = sample.alpha[i];
      ctx.putImageData(image, 0, 0);
      const scaled = document.createElement("canvas"), scale = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
      scaled.width = Math.max(1, Math.round(canvas.width * scale));
      scaled.height = Math.max(1, Math.round(canvas.height * scale));
      scaled.getContext("2d").drawImage(canvas, 0, 0, scaled.width, scaled.height);
      tips.set(sample.id, { name, src: scaled.toDataURL(), width: scaled.width, height: scaled.height });
    }
    let skipped = 0;
    for (const source of abr.brushes) {
      const shape = source.shape, tip = tips.get(shape.sampledData);
      if (shape.type !== "computed" && (shape.type !== "sampled" || !tip)) { skipped++; continue; }
      if (tip) referenced.add(shape.sampledData);
      const brush = {
        ...DEFAULT_BRUSH, tip: tip ? { ...tip, name: source.name } : null,
        size: shape.size, angle: ((shape.angle + 180) % 360 + 360) % 360 - 180,
        roundness: shape.roundness * 100, hardness: (shape.hardness ?? 1) * 100,
        spacing: shape.spacingOn ? shape.spacing * 100 : 12,
        flipX: !!shape.flipX, flipY: !!shape.flipY,
        opacity: source.toolOptions?.opacity ?? 100, flow: source.toolOptions?.flow ?? 100,
        sizeJitter: (source.shapeDynamics?.sizeDynamics.jitter ?? 0) * 100,
        pressureSize: source.shapeDynamics?.sizeDynamics.control === "pen pressure",
      };
      for (const [key, [min, max]] of Object.entries(ranges)) brush[key] = Math.max(min, Math.min(max, brush[key]));
      presets.push({ name: source.name || name, brush });
    }
    for (const [id, tip] of tips) if (!referenced.has(id))
      presets.push({ name: `${name} · 笔尖 ${presets.length + 1}`, brush: { ...DEFAULT_BRUSH, tip } });
    if (!presets.length) throw new Error("ABR 中没有可导入的采样型或圆形笔刷。");
    if (presets.length > 100) throw new Error("该 ABR 超过 100 支笔刷，请先在 Photoshop 中导出较小的笔刷组。");
    return { presets, notice: `已导入 ${presets.length} 支笔刷${skipped ? `，跳过 ${skipped} 支不支持的笔刷` : ""}。PS 纹理、双重画笔、湿边、混色与高级动态效果不还原。` };
  }
  if (!/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) throw new Error("请选择 PNG、JPEG、WebP、BMP、ABR 或 .compbrush 文件。");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas"), scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height), pixels = image.data;
  let hasTransparency = false, hasInk = false;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) { hasTransparency = true; break; }
  // 透明图片按轮廓取笔尖；白底扫描图按深浅取笔尖，白色保持透明。
  for (let i = 0; i < pixels.length; i += 4) {
    if (!hasTransparency) pixels[i + 3] = 255 - Math.round(pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722);
    if (pixels[i + 3]) hasInk = true;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
  }
  if (!hasInk) throw new Error("图片没有可绘制的笔尖：请使用带透明轮廓或白底深色图案的图片。");
  ctx.putImageData(image, 0, 0);
  presets.push({ name, brush: { ...DEFAULT_BRUSH, tip: { name, src: canvas.toDataURL(), width: canvas.width, height: canvas.height } } });
  return { presets, notice: `已按${hasTransparency ? "透明轮廓" : "黑白亮度"}导入图片笔尖，最长边保留至 1024 px。` };
}
