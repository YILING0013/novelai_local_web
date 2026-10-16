const cubeNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 校验预设或项目内嵌的三维 LUT，并复制表数据以便独立保存。
 * @param {object} lut 名称、尺寸、输入域和按红通道最快排列的 RGB 表。
 * @returns {object} 经过校验的可序列化 LUT。
 */
export function validateLut(lut) {
  if (!lut || typeof lut !== "object" || Array.isArray(lut) ||
      !Number.isInteger(lut.size) || lut.size < 2 || lut.size > 65)
    throw new Error("3D LUT 尺寸需为 2–65。");
  if (typeof lut.name !== "string" || !lut.name.trim() || lut.name.length > 160)
    throw new Error("LUT 名称需为 1–160 个字符。");
  if (![lut.domainMin, lut.domainMax].every((domain) =>
    Array.isArray(domain) && domain.length === 3 && domain.every(Number.isFinite)))
    throw new Error("LUT 输入域需为三个有限数值。");
  if (lut.domainMin.some((min, channel) =>
    min >= lut.domainMax[channel] || !Number.isFinite(lut.domainMax[channel] - min)))
    throw new Error("LUT 输入域的每个最大值必须大于最小值。");
  if (!Array.isArray(lut.data) || lut.data.length !== lut.size ** 3 * 3 || !lut.data.every(Number.isFinite))
    throw new Error(`LUT 必须包含 ${lut.size ** 3} 行有效 RGB 数据。`);
  return {
    name: lut.name.trim(), size: lut.size,
    domainMin: [...lut.domainMin], domainMax: [...lut.domainMax], data: [...lut.data],
  };
}

/** 读取标准三维 .cube，支持注释、标题、独立通道输入域及 Resolve 输入范围。
 * @param {string} text 用户导入的 .cube 文本。
 * @param {string} fileName 未设置 TITLE 时使用的文件名。
 * @returns {object} 完整 LUT；不支持的类型或不完整的数据会明确报错。
 */
export function parseCubeLut(text, fileName = "自定义 LUT.cube") {
  let name = fileName.replace(/\.cube$/i, "").slice(0, 160) || "自定义 LUT";
  let size = null, domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  const seen = new Set(), data = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const original = lines[index].trim();
    if (!original || original.startsWith("#")) continue;
    const title = /^TITLE\s+"([^"]*)"\s*(?:#.*)?$/i.exec(original);
    if (title) {
      if (data.length || seen.has("TITLE")) throw new Error(`第 ${index + 1} 行：TITLE 必须在数据之前且不能重复。`);
      name = title[1].trim() || name;
      seen.add("TITLE");
      continue;
    }
    const tokens = original.split("#", 1)[0].trim().split(/\s+/);
    const keyword = tokens[0].toUpperCase();
    if (["LUT_1D_SIZE", "LUT_1D_INPUT_RANGE", "LUT_2D_SIZE"].includes(keyword))
      throw new Error("当前仅支持独立 3D .cube，暂不支持 1D LUT 或带 1D shaper 的组合文件。");
    if (["LUT_3D_SIZE", "DOMAIN_MIN", "DOMAIN_MAX", "LUT_3D_INPUT_RANGE"].includes(keyword)) {
      if (data.length || seen.has(keyword)) throw new Error(`第 ${index + 1} 行：${keyword} 不能重复或放在表数据之后。`);
      const values = tokens.slice(1).map((token) => cubeNumber.test(token) ? Number(token) : NaN);
      const expected = keyword === "LUT_3D_SIZE" ? 1 : keyword === "LUT_3D_INPUT_RANGE" ? 2 : 3;
      if (values.length !== expected || !values.every(Number.isFinite))
        throw new Error(`第 ${index + 1} 行：${keyword} 数值格式无效。`);
      if (keyword === "LUT_3D_SIZE") {
        size = values[0];
        if (!Number.isInteger(size) || size < 2 || size > 65) throw new Error("3D LUT 尺寸需为 2–65。");
      } else if (keyword === "LUT_3D_INPUT_RANGE") {
        if (seen.has("DOMAIN_MIN") || seen.has("DOMAIN_MAX")) throw new Error("LUT 不能混用 INPUT_RANGE 和 DOMAIN_MIN/MAX。");
        domainMin = Array(3).fill(values[0]);
        domainMax = Array(3).fill(values[1]);
      } else {
        if (seen.has("LUT_3D_INPUT_RANGE")) throw new Error("LUT 不能混用 INPUT_RANGE 和 DOMAIN_MIN/MAX。");
        if (keyword === "DOMAIN_MIN") domainMin = values;
        else domainMax = values;
      }
      seen.add(keyword);
      continue;
    }
    if (!size) throw new Error(`第 ${index + 1} 行：请先提供 LUT_3D_SIZE（仅支持标准 3D .cube）。`);
    if (tokens.length !== 3 || tokens.some((token) => !cubeNumber.test(token) || !Number.isFinite(Number(token))))
      throw new Error(`第 ${index + 1} 行：LUT 数据必须是三个有限 RGB 数值，不支持“${tokens[0]}”。`);
    data.push(...tokens.map(Number));
    if (data.length > size ** 3 * 3) throw new Error(`LUT 数据超过 ${size ** 3} 行，请检查尺寸声明。`);
  }
  if (!size) throw new Error("文件缺少 LUT_3D_SIZE，仅支持标准 3D .cube。");
  return validateLut({ name, size, domainMin, domainMax, data });
}

/** 使用三线性插值应用 LUT，按强度与原像素混合并保持透明度。
 * @param {Uint8ClampedArray} pixels RGBA 像素，原地更新。
 * @param {object|null} lut 已校验的三维 LUT。
 * @param {number} strength 0–100 的应用强度。
 * @returns {void} 颜色写回 pixels，超出 8 位显示范围的结果由数组裁剪。
 */
export function applyLutPixels(pixels, lut, strength) {
  if (!lut || !strength) return;
  const { size, data, domainMin, domainMax } = lut;
  const amount = strength / 100, plane = size * size * 3, row = size * 3;
  // 输入只有 256 个通道值，先建立索引和比例表，避免逐像素重复输入域换算。
  const indices = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  const fractions = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
  for (let channel = 0; channel < 3; channel++) {
    for (let value = 0; value < 256; value++) {
      const position = Math.max(0, Math.min(1, (value / 255 - domainMin[channel]) /
        (domainMax[channel] - domainMin[channel]))) * (size - 1);
      const lower = Math.min(size - 2, Math.floor(position));
      indices[channel][value] = lower;
      fractions[channel][value] = position - lower;
    }
  }
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const red = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
    const base = indices[0][red] * 3 + indices[1][green] * row + indices[2][blue] * plane;
    const x = fractions[0][red], y = fractions[1][green], z = fractions[2][blue];
    for (let channel = 0; channel < 3; channel++) {
      const lowNear = data[base + channel] * (1 - x) + data[base + 3 + channel] * x;
      const lowFar = data[base + row + channel] * (1 - x) + data[base + row + 3 + channel] * x;
      const highNear = data[base + plane + channel] * (1 - x) + data[base + plane + 3 + channel] * x;
      const highFar = data[base + plane + row + channel] * (1 - x) + data[base + plane + row + 3 + channel] * x;
      const output = ((lowNear * (1 - y) + lowFar * y) * (1 - z) +
        (highNear * (1 - y) + highFar * y) * z) * 255;
      pixels[i + channel] = pixels[i + channel] * (1 - amount) + output * amount;
    }
  }
}
