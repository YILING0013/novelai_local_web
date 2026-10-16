import { GRADING_CHANNELS, HSL_CHANNELS } from "./model.js";

/** 连通魔棒选区，使用队列避免大区域递归栈溢出。
 * @param {Uint8ClampedArray} pixels RGBA 像素。
 * @param {number} width 图片宽。
 * @param {number} height 图片高。
 * @param {number} x 种子横坐标。
 * @param {number} y 种子纵坐标。
 * @param {number} tolerance 通道容差。
 * @returns {Uint8ClampedArray} 白色 RGBA 选区蒙版。
 */
export function floodMask(pixels, width, height, x, y, tolerance) {
  const output = new Uint8ClampedArray(pixels.length);
  if (x < 0 || y < 0 || x >= width || y >= height) return output;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const start = y * width + x;
  const color = pixels.slice(start * 4, start * 4 + 4);
  let read = 0,
    write = 1;
  queue[0] = start;
  visited[start] = 1;
  while (read < write) {
    const index = queue[read++],
      p = index * 4;
    if (
      Math.max(
        ...color.map((c, channel) => Math.abs(c - pixels[p + channel])),
      ) > tolerance
    )
      continue;
    output.set([255, 255, 255, 255], p);
    const px = index % width,
      py = Math.floor(index / width);
    const neighbors = [
      px > 0 ? index - 1 : -1,
      px < width - 1 ? index + 1 : -1,
      py > 0 ? index - width : -1,
      py < height - 1 ? index + width : -1,
    ];
    for (const neighbor of neighbors)
      if (neighbor >= 0 && !visited[neighbor]) {
        visited[neighbor] = 1;
        queue[write++] = neighbor;
      }
  }
  return output;
}

/** 在像素上处理明暗、色阶、色温、渐变映射、颗粒和暗角，保持透明度。
 * @param {Uint8ClampedArray} data RGBA 像素，就地更新。
 * @param {number} width 图片宽。
 * @param {number} height 图片高。
 * @param {object} a 调色参数。
 */
export function adjustPixels(data, width, height, a) {
  const parse = (hex) =>
    [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const dark = parse(a.shadowColor || "#172b42"),
    light = parse(a.highlightColor || "#f6d9aa");
  const span = Math.max(1, a.white - a.black);
  const curve = curveTable(
    a.curve || [
      [0, 0],
      [255, 255],
    ],
  );
  const hslBands = HSL_CHANNELS.map(({ key }) => a.hsl[key]);
  const hasHsl = hslBands.some((band) => band.hue || band.saturation || band.lightness);
  const channelCurves = [a.curveRed, a.curveGreen, a.curveBlue].map(curveTable);
  const gradeBands = GRADING_CHANNELS.map(({ key }) => a.grading[key]);
  const hasGrading = gradeBands.some((band) => band.saturation || band.lightness);
  const gradeColors = gradeBands.map((band) => {
    const hue = (band.hue % 360) / 60, secondary = 1 - Math.abs(hue % 2 - 1);
    const color = hue < 1 ? [1, secondary, 0] : hue < 2 ? [secondary, 1, 0]
      : hue < 3 ? [0, 1, secondary] : hue < 4 ? [0, secondary, 1]
      : hue < 5 ? [secondary, 0, 1] : [1, 0, secondary];
    const luma = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
    return color.map((channel) => (channel - luma) * band.saturation / 100 * 96);
  });
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    let rgb = [0, 1, 2].map(
      (c) =>
        channelCurves[c][curve[
          Math.round(
            255 *
              Math.pow(
                Math.max(0, Math.min(1, (data[i + c] - a.black) / span)),
                1 / a.gamma,
              ),
          )
        ]],
    );
    if (a.brightness) rgb = rgb.map((channel) => channel + a.brightness * 2.55);
    rgb[0] += a.temperature * 0.6;
    rgb[2] -= a.temperature * 0.6;
    if (a.highlights || a.shadows || a.whites || a.blacks) {
      // 使用平滑的亮度权重区分明暗区域，避免在选定亮度处产生硬边。
      const luma = Math.max(0, Math.min(1, (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255));
      const delta = 1.3 * (
        (a.highlights || 0) * luma ** 3 + (a.shadows || 0) * (1 - luma) ** 3 +
        (a.whites || 0) * luma ** 6 + (a.blacks || 0) * (1 - luma) ** 6
      );
      rgb = rgb.map((channel) => channel + delta);
    }
    if (a.tint) {
      rgb[0] += a.tint * 0.3;
      rgb[1] -= a.tint * 0.6;
      rgb[2] += a.tint * 0.3;
    }
    if (a.vibrance) {
      const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      // 已经鲜艳的颜色获得较少增益，低饱和区域则获得更多增益。
      const chroma = Math.min(1, (Math.max(...rgb) - Math.min(...rgb)) / 255);
      const amount = 1 + (a.vibrance / 100) * (1 - chroma);
      rgb = rgb.map((channel) => luma + (channel - luma) * amount);
    }
    if (hasHsl) {
      const [red, green, blue] = rgb.map((channel) => Math.max(0, Math.min(1, channel / 255)));
      const max = Math.max(red, green, blue), min = Math.min(red, green, blue), chroma = max - min;
      // 灰色没有色相；低饱和区域逐渐减弱混色，避免灰阶噪点突然变色。
      if (chroma > 0) {
        let hue = 60 * (max === red ? ((green - blue) / chroma) % 6
          : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4);
        if (hue < 0) hue += 360;
        let lightness = (max + min) / 2;
        let saturation = chroma / (1 - Math.abs(2 * lightness - 1));
        let band = 0;
        while (band < HSL_CHANNELS.length - 1 && hue >= HSL_CHANNELS[band + 1].hue) band++;
        const next = (band + 1) % HSL_CHANNELS.length;
        const left = hslBands[band], right = hslBands[next];
        const start = HSL_CHANNELS[band].hue, end = next === 0 ? 360 : HSL_CHANNELS[next].hue;
        const position = (hue - start) / (end - start);
        // 在相邻色带之间平滑插值，并把 360° 接回红色，消除色带边界。
        const blend = position * position * (3 - 2 * position);
        const hueShift = left.hue + (right.hue - left.hue) * blend;
        const saturationShift = left.saturation + (right.saturation - left.saturation) * blend;
        const lightnessShift = left.lightness + (right.lightness - left.lightness) * blend;
        if (hueShift || saturationShift || lightnessShift) {
          const colorWeight = Math.min(1, saturation * 4);
          hue = ((hue + hueShift * colorWeight) % 360 + 360) % 360;
          saturation = Math.max(0, Math.min(1, saturation * (1 + saturationShift / 100 * colorWeight)));
          const lightnessAmount = lightnessShift / 100 * colorWeight;
          lightness = lightnessAmount >= 0
            ? lightness + (1 - lightness) * lightnessAmount
            : lightness * (1 + lightnessAmount);
          const strength = (1 - Math.abs(2 * lightness - 1)) * saturation;
          const secondary = strength * (1 - Math.abs((hue / 60) % 2 - 1));
          const offset = lightness - strength / 2;
          const sector = Math.floor(hue / 60);
          rgb = (sector === 0 ? [strength, secondary, 0]
            : sector === 1 ? [secondary, strength, 0]
            : sector === 2 ? [0, strength, secondary]
            : sector === 3 ? [0, secondary, strength]
            : sector === 4 ? [secondary, 0, strength] : [strength, 0, secondary])
            .map((channel) => (channel + offset) * 255);
        }
      }
    }
    if (hasGrading) {
      const luma = Math.max(0, Math.min(1, (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255));
      const position = Math.max(0, Math.min(1, luma + a.gradingBalance / 100 * 0.25));
      const power = 3 - a.gradingBlending / 50;
      const weights = [(1 - position) ** power, (1 - Math.abs(2 * position - 1)) ** power, position ** power];
      const total = weights[0] + weights[1] + weights[2];
      const shifts = [0, 0, 0];
      let lightness = 0;
      // 先按原亮度混合三个区域；整体分级再覆盖所有亮度，保持两类控制独立。
      for (let band = 0; band < gradeBands.length; band++) {
        const weight = band === 3 ? 1 : weights[band] / total;
        for (let channel = 0; channel < 3; channel++) shifts[channel] += gradeColors[band][channel] * weight;
        lightness += gradeBands[band].lightness / 100 * weight;
      }
      lightness = Math.max(-1, Math.min(1, lightness));
      rgb = rgb.map((channel, index) => {
        const toned = channel + shifts[index];
        return lightness >= 0 ? toned + (255 - toned) * lightness : toned * (1 + lightness);
      });
    }
    if (a.duotone) {
      const luma = Math.max(
        0,
        Math.min(
          1,
          (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255,
        ),
      );
      rgb = dark.map((v, c) => v + (light[c] - v) * luma);
    }
    // 固定噪声种子让拖动参数时的颗粒稳定，导出与预览一致。
    let seed = Math.imul(i / 4 + 1, 0x45d9f3b);
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
    const noise =
      (((seed ^ (seed >>> 16)) >>> 0) / 4294967295 - 0.5) * a.noise * 2;
    const x = ((i / 4) % width) / width - 0.5,
      y = Math.floor(i / 4 / width) / height - 0.5;
    const vignette = 1 - (Math.min(1, (x * x + y * y) * 2) * a.vignette) / 100;
    for (let c = 0; c < 3; c++) data[i + c] = (rgb[c] + noise) * vignette;
  }
}

/** 通过局部暗通道估计雾气并恢复对比度，负值添加薄雾，保留像素透明度。
 * @param {Uint8ClampedArray} data RGBA 像素，就地更新。
 * @param {number} width 图片宽。
 * @param {number} height 图片高。
 * @param {number} amount -100–100 的去朦胧强度。
 * @returns {void} 恢复后的颜色写回 data。
 */
export function dehazePixels(data, width, height, amount) {
  if (!amount) return;
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    histogram[Math.min(data[i], data[i + 1], data[i + 2])]++;
    count++;
  }
  if (!count) return;
  let threshold = 255, accumulated = 0;
  const brightest = Math.max(1, Math.ceil(count * 0.01));
  for (; threshold > 0; threshold--) {
    accumulated += histogram[threshold];
    if (accumulated >= brightest) break;
  }
  const atmosphere = [0, 0, 0];
  let atmosphereWeight = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3] || Math.min(data[i], data[i + 1], data[i + 2]) < threshold) continue;
    const weight = data[i + 3] / 255;
    for (let channel = 0; channel < 3; channel++) atmosphere[channel] += data[i + channel] * weight;
    atmosphereWeight += weight;
  }
  for (let channel = 0; channel < 3; channel++) atmosphere[channel] = Math.max(1, atmosphere[channel] / atmosphereWeight);
  if (amount < 0) {
    const haze = -amount / 100 * 0.6;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      for (let channel = 0; channel < 3; channel++)
        data[i + channel] = data[i + channel] * (1 - haze) + atmosphere[channel] * haze;
    }
    return;
  }
  let dark = new Float32Array(width * height);
  for (let i = 0; i < dark.length; i++) {
    const offset = i * 4;
    // 透明区域不作为黑色采样点，否则半透明边缘附近无法正确去雾。
    dark[i] = data[offset + 3] ? Math.min(1, data[offset] / atmosphere[0],
      data[offset + 1] / atmosphere[1], data[offset + 2] / atmosphere[2]) : 1;
  }
  const radius = Math.max(1, Math.min(12, Math.round(Math.min(width, height) / 80)));
  // 两次滑动最小窗口形成局部暗通道，计算量不随窗口面积增长。
  for (const vertical of [false, true]) {
    const length = vertical ? height : width, lines = vertical ? width : height;
    const output = new Float32Array(dark.length), positions = new Int32Array(length + 2 * radius),
      values = new Float32Array(length + 2 * radius);
    for (let line = 0; line < lines; line++) {
      let head = 0, tail = 0;
      for (let position = -radius; position < length + radius; position++) {
        const sample = Math.max(0, Math.min(length - 1, position));
        const value = dark[vertical ? sample * width + line : line * width + sample];
        while (tail > head && values[tail - 1] >= value) tail--;
        positions[tail] = position;
        values[tail++] = value;
        while (positions[head] < position - 2 * radius) head++;
        const center = position - radius;
        if (center >= 0 && center < length)
          output[vertical ? center * width + line : line * width + center] = values[head];
      }
    }
    dark = output;
  }
  for (let i = 0; i < dark.length; i++) {
    const offset = i * 4;
    if (!data[offset + 3]) continue;
    const transmission = Math.max(0.15, 1 - amount / 100 * 0.85 * dark[i]);
    for (let channel = 0; channel < 3; channel++)
      data[offset + channel] = (data[offset + channel] - atmosphere[channel]) / transmission + atmosphere[channel];
  }
}

/** 使用相邻像素增强细节并偏移红蓝通道，保留原图透明度和透明边缘。
 * @param {Uint8ClampedArray} data RGBA 像素，就地更新。
 * @param {number} width 图片宽。
 * @param {number} height 图片高。
 * @param {object} adjustments 锐化和色差参数。
 */
export function detailPixels(data, width, height, adjustments) {
  if (adjustments.sharpen) {
    const source = data.slice(), amount = adjustments.sharpen / 50;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        if (!source[index + 3]) continue;
        const neighbors = [
          (y * width + Math.max(0, x - 1)) * 4,
          (y * width + Math.min(width - 1, x + 1)) * 4,
          (Math.max(0, y - 1) * width + x) * 4,
          (Math.min(height - 1, y + 1) * width + x) * 4,
        ];
        let weight = 0, red = 0, green = 0, blue = 0;
        for (const neighbor of neighbors) {
          const alpha = source[neighbor + 3] / 255;
          weight += alpha;
          red += source[neighbor] * alpha;
          green += source[neighbor + 1] * alpha;
          blue += source[neighbor + 2] * alpha;
        }
        if (!weight) continue;
        data[index] = source[index] + (source[index] - red / weight) * amount;
        data[index + 1] = source[index + 1] + (source[index + 1] - green / weight) * amount;
        data[index + 2] = source[index + 2] + (source[index + 2] - blue / weight) * amount;
      }
    }
  }
  if (adjustments.aberration) {
    const source = data.slice(), offset = Math.round(adjustments.aberration);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        if (!source[index + 3]) continue;
        const red = (y * width + Math.max(0, x - offset)) * 4;
        const blue = (y * width + Math.min(width - 1, x + offset)) * 4;
        // 透明邻点没有可见颜色，保留本像素颜色以免引入黑色边缘。
        if (source[red + 3]) data[index] = source[red];
        if (source[blue + 3]) data[index + 2] = source[blue + 2];
      }
    }
  }
}

/** 将曲线控制点线性插值为 256 个色调映射值。
 * @param {number[][]} points 按输入值排序的控制点。
 * @returns {Uint8ClampedArray} 色调查找表。
 */
export function curveTable(points) {
  const table = new Uint8ClampedArray(256);
  let segment = 0;
  for (let x = 0; x < 256; x++) {
    while (segment < points.length - 2 && x > points[segment + 1][0]) segment++;
    const [x0, y0] = points[segment],
      [x1, y1] = points[segment + 1];
    table[x] =
      y0 +
      (y1 - y0) * Math.max(0, Math.min(1, (x - x0) / Math.max(1, x1 - x0)));
  }
  return table;
}

/** 实现 Canvas 原生缺少的混合模式，并正确合成半透明像素。
 * @param {Uint8ClampedArray} back 底图像素，就地写入结果。
 * @param {Uint8ClampedArray} front 前景像素。
 * @param {string} mode 混合模式。
 * @param {number} opacity 图层透明度。
 */
export function blendPixels(back, front, mode, opacity) {
  for (let i = 0; i < back.length; i += 4) {
    const ab = back[i + 3] / 255,
      as = (front[i + 3] / 255) * opacity,
      alpha = as + ab * (1 - as);
    if (!as) continue;
    for (let c = 0; c < 3; c++) {
      const b = back[i + c] / 255,
        s = front[i + c] / 255;
      let mixed;
      switch (mode) {
        case "linear-burn":
          mixed = b + s - 1;
          break;
        case "linear-light":
          mixed = b + 2 * s - 1;
          break;
        case "pin-light":
          mixed = s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
          break;
        case "subtract":
          mixed = b - s;
          break;
        case "divide":
          mixed = s === 0 ? 1 : b / s;
          break;
        default: {
          mixed =
            s < 0.5
              ? s === 0
                ? 0
                : 1 - (1 - b) / (2 * s)
              : s === 1
                ? 1
                : b / (2 * (1 - s));
          if (mode === "hard-mix") mixed = mixed < 0.5 ? 0 : 1;
        }
      }
      mixed = Math.max(0, Math.min(1, mixed));
      back[i + c] =
        (255 * ((1 - as) * ab * b + (1 - ab) * as * s + as * ab * mixed)) /
        alpha;
    }
    back[i + 3] = alpha * 255;
  }
}

/** 用分离滑动窗口扩展或收缩选区，避免逐像素扫描整个邻域。
 * @param {Uint8ClampedArray} data RGBA 选区。
 * @param {number} width 宽。
 * @param {number} height 高。
 * @param {number} radius 半径。
 * @param {boolean} expand 是否扩展。
 * @returns {Uint8ClampedArray} 新选区。
 */
export function morphology(data, width, height, radius, expand) {
  let source = Uint8Array.from(
    { length: width * height },
    (_, i) => data[i * 4 + 3],
  );
  for (const vertical of [false, true]) {
    const result = new Uint8Array(width * height),
      length = vertical ? height : width,
      lines = vertical ? width : height;
    for (let line = 0; line < lines; line++) {
      const deque = [],
        values = [];
      let head = 0;
      for (let p = -radius; p < length + radius; p++) {
        const value =
          p < 0 || p >= length
            ? 0
            : source[vertical ? p * width + line : line * width + p];
        while (
          deque.length > head &&
          (expand ? values.at(-1) <= value : values.at(-1) >= value)
        ) {
          deque.pop();
          values.pop();
        }
        deque.push(p);
        values.push(value);
        while (deque[head] < p - 2 * radius) head++;
        const center = p - radius;
        if (center >= 0 && center < length)
          result[vertical ? center * width + line : line * width + center] =
            values[head];
      }
    }
    source = result;
  }
  const output = new Uint8ClampedArray(data.length);
  for (let i = 0; i < source.length; i++)
    output.set([255, 255, 255, source[i]], i * 4);
  return output;
}

/** 计算非透明区域范围，供选区裁剪与画布修边使用。
 * @param {Uint8ClampedArray} data RGBA 像素。
 * @param {number} width 宽。
 * @param {number} height 高。
 * @returns {object|null} 最小包围矩形；全透明返回 null。
 */
export function alphaBounds(data, width, height) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return right < 0
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
