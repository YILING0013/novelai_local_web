import { DEFAULT_ADJUSTMENTS, localPoint } from "./model";
import { shapePath } from "./shapes";
import { adjustPixels, blendPixels, dehazePixels, detailPixels } from "./pixels";
import { applyLutPixels } from "./lut";
import { comicTextDataUrl } from "../../comicImport";

const customBlends = new Set([
  "linear-burn",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "subtract",
  "divide",
]);

const images = new Map();
const surfaces = new WeakMap();

/** 分配透明画布。
 * @param {number} width 宽。
 * @param {number} height 高。
 * @returns {HTMLCanvasElement} 离屏画布。
 */
export function canvasOf(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** 解码并缓存图片，避免重绘时重复解码。
 * @param {string} src 内嵌图片地址。
 * @returns {Promise<HTMLImageElement>} 解码后的图像。
 */
export async function loadImage(src) {
  if (!images.has(src)) {
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(src);
        reject(new Error("无法解码图片，请检查文件格式。"));
      };
      img.src = src;
    });
    images.set(src, promise);
    if (images.size > 120) images.delete(images.keys().next().value);
  }
  return images.get(src);
}

/** 用浏览器滤镜与像素算法生成调色副本，不修改原图。
 * @param {HTMLCanvasElement} source 原始图像。
 * @param {object} values 调色参数。
 * @returns {HTMLCanvasElement} 调色结果。
 */
export function adjustedCanvas(source, values) {
  const a = { ...DEFAULT_ADJUSTMENTS, ...values };
  const canvas = canvasOf(source.width, source.height),
    ctx = canvas.getContext("2d");
  ctx.filter = `brightness(${Math.pow(2, a.exposure)}) contrast(${1 + a.contrast / 100}) saturate(${1 + a.saturation / 100}) hue-rotate(${a.hue}deg) grayscale(${a.grayscale}) invert(${a.invert}) blur(${a.blur}px)`;
  ctx.drawImage(source, 0, 0);
  ctx.filter = "none";
  if (a.motion) {
    const snapshot = canvasOf(canvas.width, canvas.height);
    snapshot.getContext("2d").drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    const samples = Math.min(40, Math.ceil(a.motion) + 1),
      angle = (a.motionAngle * Math.PI) / 180;
    ctx.globalAlpha = 1 / samples;
    for (let i = 0; i < samples; i++) {
      const offset = (i / (samples - 1) - 0.5) * a.motion;
      ctx.drawImage(
        snapshot,
        Math.cos(angle) * offset,
        Math.sin(angle) * offset,
      );
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  if (
    a.brightness ||
    a.temperature ||
    a.highlights ||
    a.shadows ||
    a.whites ||
    a.blacks ||
    a.vibrance ||
    a.tint ||
    a.sharpen ||
    a.aberration ||
    a.bloom ||
    a.dehaze ||
    (a.lut && a.lutStrength) ||
    a.noise ||
    a.vignette ||
    a.black ||
    a.white !== 255 ||
    a.gamma !== 1 ||
    a.duotone ||
    Object.values(a.hsl).some((band) => band.hue || band.saturation || band.lightness) ||
    Object.values(a.grading).some((band) => band.saturation || band.lightness) ||
    [a.curve, a.curveRed, a.curveGreen, a.curveBlue].some((curve) => JSON.stringify(curve) !== "[[0,0],[255,255]]")
  ) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    dehazePixels(pixels.data, canvas.width, canvas.height, a.dehaze);
    adjustPixels(pixels.data, canvas.width, canvas.height, a);
    applyLutPixels(pixels.data, a.lut, a.lutStrength);
    detailPixels(pixels.data, canvas.width, canvas.height, a);
    if (a.bloom) {
      const highlights = canvasOf(canvas.width, canvas.height),
        highlightContext = highlights.getContext("2d"),
        bright = highlightContext.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luma = pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722;
        const weight = Math.max(0, (luma - 160) / 95);
        for (let channel = 0; channel < 3; channel++) bright.data[i + channel] = pixels.data[i + channel] * weight;
        bright.data[i + 3] = pixels.data[i + 3];
      }
      highlightContext.putImageData(bright, 0, 0);
      const glow = canvasOf(canvas.width, canvas.height), glowContext = glow.getContext("2d");
      glowContext.filter = `blur(${Math.max(2, Math.min(24, Math.max(canvas.width, canvas.height) / 90))}px)`;
      glowContext.drawImage(highlights, 0, 0);
      const blurred = glowContext.getImageData(0, 0, canvas.width, canvas.height).data;
      // 只合成颜色，不扩大透明度范围，调整层不会使透明背景变实。
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (!pixels.data[i + 3]) continue;
        const strength = (a.bloom / 100) * (blurred[i + 3] / 255);
        for (let channel = 0; channel < 3; channel++)
          pixels.data[i + channel] += blurred[i + channel] * strength * (1 - pixels.data[i + channel] / 255);
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }
  return canvas;
}

/** 按文档顺序应用绑定调整，保留源图像并按各调整项的不透明度混合。
 * @param {HTMLCanvasElement} source 目标图层的基础内容。
 * @param {object[]} adjustments 绑定到该图层的调整项，按文档图层顺序排列。
 * @returns {HTMLCanvasElement} 应用可见调整后的画布，无有效调整时返回输入。
 */
export function applyLinkedAdjustments(source, adjustments) {
  let result = source;
  for (const adjustment of adjustments) {
    if (!adjustment.visible || !adjustment.opacity) continue;
    const changed = adjustedCanvas(result, adjustment.adjustments);
    if (adjustment.opacity === 1) {
      result = changed;
      continue;
    }
    const mixed = canvasOf(result.width, result.height), ctx = mixed.getContext("2d");
    // 用预乘颜色相加，调整强度变化时半透明边缘不会越叠越实。
    ctx.globalAlpha = 1 - adjustment.opacity;
    ctx.drawImage(result, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = adjustment.opacity;
    ctx.drawImage(changed, 0, 0);
    result = mixed;
  }
  return result;
}

/** 渲染图层自身内容及绑定的调整；图像保持源分辨率，文字和形状保持可编辑。
 * @param {object} layer 图层。
 * @param {object[]} linkedAdjustments 按文档顺序排列的调整子项。
 * @returns {Promise<HTMLCanvasElement>} 图层局部画布。
 */
export async function layerSurface(layer, linkedAdjustments = []) {
  const cached = surfaces.get(layer);
  if (cached && cached.adjustments.length === linkedAdjustments.length &&
      cached.adjustments.every((item, index) => item === linkedAdjustments[index]))
    return cached.canvas;
  let image = layer.type === "text" && layer.comicText
    ? await loadImage(await comicTextDataUrl(layer))
    : layer.src ? await loadImage(layer.src) : null;
  let canvas = canvasOf(
    image ? image.width : layer.width,
    image ? image.height : layer.height,
  );
  let ctx = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height;
  if (image) ctx.drawImage(image, 0, 0);
  else if (layer.type !== "raster") {
    ctx.fillStyle = layer.fill;
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = layer.strokeWidth;
    if (layer.type === "text") {
      // 文本框本身决定排版和裁切边界，调整宽高不会把文字画到框外。
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      ctx.font = `${layer.fontWeight || "400"} ${layer.fontSize || 64}px ${layer.fontFamily || "Arial"}`;
      ctx.textBaseline = "top";
      ctx.textAlign = layer.align || "left";
      const lines = [];
      for (const line of (layer.text || "").split("\n")) {
        let current = "";
        for (const char of line) {
          if (current && ctx.measureText(current + char).width > w) {
            lines.push(current);
            current = "";
          }
          current += char;
        }
        lines.push(current);
      }
      lines.slice(0, Math.ceil(h / ((layer.fontSize || 64) * (layer.lineHeight || 1.2)))).forEach((line, i) =>
        ctx.fillText(
          line,
          layer.align === "center" ? w / 2 : layer.align === "right" ? w : 0,
          i * (layer.fontSize || 64) * (layer.lineHeight || 1.2),
        ),
      );
      ctx.restore();
    } else if (layer.type === "gradient") {
      const angle = ((layer.gradientAngle || 0) * Math.PI) / 180;
      const dx = (Math.cos(angle) * w) / 2,
        dy = (Math.sin(angle) * h) / 2;
      const gradient =
        layer.gradientType === "radial"
          ? ctx.createRadialGradient(
              w / 2,
              h / 2,
              0,
              w / 2,
              h / 2,
              Math.max(w, h) / 2,
            )
          : ctx.createLinearGradient(
              w / 2 - dx,
              h / 2 - dy,
              w / 2 + dx,
              h / 2 + dy,
            );
      gradient.addColorStop(0, layer.fill);
      gradient.addColorStop(1, layer.endColor || "#ffffff");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    } else {
      shapePath(ctx, layer, w, h);
      if (layer.type !== "line" && layer.fill !== "transparent") ctx.fill();
      if (layer.strokeWidth) ctx.stroke();
    }
  }
  canvas = adjustedCanvas(canvas, layer.adjustments);
  // 调整跟随目标的局部坐标，先调色再应用目标蒙版，模糊也不会越过蒙版。
  canvas = applyLinkedAdjustments(canvas, linkedAdjustments);
  ctx = canvas.getContext("2d");
  if (layer.effects?.overlay) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = layer.effects.overlay;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
  if (layer.mask && layer.maskEnabled) {
    const mask = await loadImage(layer.mask);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
  surfaces.set(layer, { canvas, adjustments: [...linkedAdjustments] });
  return canvas;
}

/** 按文档坐标绘制一个已变换的图层。
 * @param {CanvasRenderingContext2D} ctx 目标上下文。
 * @param {object} layer 图层参数。
 * @param {HTMLCanvasElement} surface 局部内容。
 */
export function placeLayer(ctx, layer, surface) {
  ctx.save();
  ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  ctx.drawImage(
    surface,
    -layer.width / 2,
    -layer.height / 2,
    layer.width,
    layer.height,
  );
  ctx.restore();
}

/** 合成文档，预览、导出和取色共用同一渲染流程。
 * @param {object} doc 文档。
 * @param {Map<string, HTMLCanvasElement>} overrides 绘画过程中的临时图层。
 * @returns {Promise<HTMLCanvasElement>} 合成画布。
 */
export async function renderDocument(doc, overrides = new Map()) {
  // 分组在独立画布内合成后再应用透明度，避免组内重叠区域变深。
  async function renderGroup(parentId) {
    const canvas = canvasOf(doc.width, doc.height),
      ctx = canvas.getContext("2d");
    let clipBase = null;
    for (const layer of doc.layers.filter((l) => l.parentId === parentId)) {
      // 绑定调整由目标图层渲染；它不是合成栈中的画面，也不改变剪贴基底。
      if (layer.type === "adjustment" && layer.targetId) continue;
      if (!layer.visible) {
        if (!layer.clipped) clipBase = null;
        continue;
      }
      if (layer.type === "adjustment") {
        const adjusted = adjustedCanvas(canvas, layer.adjustments);
        // 用加权的预乘透明度混合，避免半透明图像经过调整层后变得不透明。
        const original = canvasOf(doc.width, doc.height);
        original.getContext("2d").drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, doc.width, doc.height);
        ctx.save();
        ctx.globalAlpha = 1 - layer.opacity;
        ctx.drawImage(original, 0, 0);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(adjusted, 0, 0);
        ctx.restore();
        continue;
      }
      const positioned = canvasOf(doc.width, doc.height),
        pctx = positioned.getContext("2d");
      if (layer.type === "group")
        pctx.drawImage(await renderGroup(layer.id), 0, 0);
      else {
        const linked = doc.layers.filter((item) => item.type === "adjustment" && item.targetId === layer.id);
        const temporary = overrides.get(layer.id);
        const surface = temporary
          ? applyLinkedAdjustments(temporary, linked)
          : await layerSurface(layer, linked);
        placeLayer(pctx, layer, surface);
      }
      if (layer.clipped && clipBase) {
        pctx.globalCompositeOperation = "destination-in";
        pctx.drawImage(clipBase, 0, 0);
      } else if (layer.clipped) pctx.clearRect(0, 0, doc.width, doc.height);
      if (!layer.clipped) clipBase = positioned;
      if (customBlends.has(layer.blend)) {
        let source = positioned;
        if (layer.effects?.shadow || layer.effects?.glow) {
          source = canvasOf(doc.width, doc.height);
          const effect = source.getContext("2d");
          effect.shadowColor = layer.effects.glow
            ? layer.stroke
            : layer.effects.shadowColor;
          effect.shadowBlur = layer.effects.glow || layer.effects.shadow;
          effect.shadowOffsetX = layer.effects.glow ? 0 : layer.effects.shadowX;
          effect.shadowOffsetY = layer.effects.glow ? 0 : layer.effects.shadowY;
          effect.drawImage(positioned, 0, 0);
        }
        const pixels = ctx.getImageData(0, 0, doc.width, doc.height);
        blendPixels(
          pixels.data,
          source.getContext("2d").getImageData(0, 0, doc.width, doc.height)
            .data,
          layer.blend,
          layer.opacity,
        );
        ctx.putImageData(pixels, 0, 0);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      if (layer.effects?.shadow || layer.effects?.glow) {
        ctx.shadowColor = layer.effects.glow
          ? layer.stroke
          : layer.effects.shadowColor;
        ctx.shadowBlur = layer.effects.glow || layer.effects.shadow;
        ctx.shadowOffsetX = layer.effects.glow ? 0 : layer.effects.shadowX;
        ctx.shadowOffsetY = layer.effects.glow ? 0 : layer.effects.shadowY;
      }
      ctx.drawImage(positioned, 0, 0);
      ctx.restore();
    }
    return canvas;
  }
  return renderGroup(null);
}

/** 从顶层向下命中可见图层，忽略透明像素和锁定图层。
 * @param {object} doc 文档。
 * @param {object} point 画布坐标。
 * @returns {Promise<object|undefined>} 命中图层。
 */
export async function hitLayer(doc, point) {
  for (const layer of [...doc.layers].reverse()) {
    if (
      !layer.visible ||
      layer.locked ||
      ["group", "adjustment"].includes(layer.type)
    )
      continue;
    let parent = doc.layers.find((l) => l.id === layer.parentId),
      hidden = false;
    while (parent) {
      if (!parent.visible || parent.locked) hidden = true;
      parent = doc.layers.find((l) => l.id === parent.parentId);
    }
    if (hidden) continue;
    const p = localPoint(point, layer);
    if (p.x < 0 || p.y < 0 || p.x >= layer.width || p.y >= layer.height)
      continue;
    const surface = await layerSurface(layer, doc.layers.filter((item) => item.type === "adjustment" && item.targetId === layer.id));
    const alpha = surface
      .getContext("2d")
      .getImageData(
        Math.min(
          surface.width - 1,
          Math.floor((p.x / layer.width) * surface.width),
        ),
        Math.min(
          surface.height - 1,
          Math.floor((p.y / layer.height) * surface.height),
        ),
        1,
        1,
      ).data[3];
    if (alpha > 8) return layer;
  }
}

/** 将选区边缘转换为可叠加的黑白轮廓。
 * @param {HTMLCanvasElement} mask 选区蒙版。
 * @returns {HTMLCanvasElement} 透明背景的边缘图像。
 */
export function selectionOutline(mask) {
  const output = canvasOf(mask.width, mask.height),
    ctx = output.getContext("2d");
  const input = mask
    .getContext("2d")
    .getImageData(0, 0, mask.width, mask.height).data;
  const edge = ctx.createImageData(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++) {
      const i = (y * mask.width + x) * 4;
      if (input[i + 3] < 128) continue;
      if (
        x === 0 ||
        y === 0 ||
        x === mask.width - 1 ||
        y === mask.height - 1 ||
        input[i - 1] < 128 ||
        input[i + 7] < 128 ||
        input[i - mask.width * 4 + 3] < 128 ||
        input[i + mask.width * 4 + 3] < 128
      ) {
        const color = Math.floor((x + y) / 5) % 2 ? 255 : 0;
        edge.data.set([color, color, color, 255], i);
      }
    }
  ctx.putImageData(edge, 0, 0);
  return output;
}
