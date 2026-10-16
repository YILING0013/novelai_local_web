import { createClientId } from '@/utils/browserCapabilities.mjs';
import { validateLut } from "./lut.js";

export const BLENDS = [
  ["source-over", "正常"],
  ["darken", "变暗"],
  ["multiply", "正片叠底"],
  ["color-burn", "颜色加深"],
  ["linear-burn", "线性加深"],
  ["lighten", "变亮"],
  ["screen", "滤色"],
  ["color-dodge", "颜色减淡"],
  ["lighter", "线性减淡"],
  ["overlay", "叠加"],
  ["soft-light", "柔光"],
  ["hard-light", "强光"],
  ["vivid-light", "亮光"],
  ["linear-light", "线性光"],
  ["pin-light", "点光"],
  ["hard-mix", "实色混合"],
  ["difference", "差值"],
  ["exclusion", "排除"],
  ["subtract", "减去"],
  ["divide", "划分"],
  ["hue", "色相"],
  ["saturation", "饱和度"],
  ["color", "颜色"],
  ["luminosity", "明度"],
];

export const HSL_CHANNELS = [
  { key: "red", label: "红色", hue: 0, color: "#ef5c56" },
  { key: "orange", label: "橙色", hue: 30, color: "#ed9a4b" },
  { key: "yellow", label: "黄色", hue: 60, color: "#e9cd56" },
  { key: "green", label: "绿色", hue: 120, color: "#74b96e" },
  { key: "aqua", label: "青色", hue: 180, color: "#5bc8c6" },
  { key: "blue", label: "蓝色", hue: 240, color: "#688be5" },
  { key: "purple", label: "紫色", hue: 270, color: "#a575d5" },
  { key: "magenta", label: "洋红", hue: 300, color: "#dc75b4" },
];

export const HSL_RANGES = {
  hue: [-60, 60],
  saturation: [-100, 100],
  lightness: [-100, 100],
};

export const GRADING_CHANNELS = [
  { key: "shadows", label: "阴影" },
  { key: "midtones", label: "中间调" },
  { key: "highlights", label: "高光" },
  { key: "global", label: "整体" },
];

export const GRADING_RANGES = {
  hue: [0, 360],
  saturation: [0, 100],
  lightness: [-100, 100],
};

export const DEFAULT_ADJUSTMENTS = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  temperature: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  tint: 0,
  hsl: Object.fromEntries(HSL_CHANNELS.map(({ key }) => [key, { hue: 0, saturation: 0, lightness: 0 }])),
  grading: Object.fromEntries(GRADING_CHANNELS.map(({ key }) => [key, { hue: 0, saturation: 0, lightness: 0 }])),
  gradingBlending: 50,
  gradingBalance: 0,
  dehaze: 0,
  lut: null,
  lutStrength: 100,
  sharpen: 0,
  aberration: 0,
  bloom: 0,
  blur: 0,
  grayscale: 0,
  invert: 0,
  noise: 0,
  vignette: 0,
  black: 0,
  white: 255,
  gamma: 1,
  duotone: false,
  shadowColor: "#172b42",
  highlightColor: "#f6d9aa",
  motion: 0,
  motionAngle: 0,
  curve: [
    [0, 0],
    [255, 255],
  ],
  curveRed: [[0, 0], [255, 255]],
  curveGreen: [[0, 0], [255, 255]],
  curveBlue: [[0, 0], [255, 255]],
};

export const ADJUSTMENT_RANGES = {
  exposure: [-3, 3],
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 200],
  hue: [-180, 180],
  temperature: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  vibrance: [-100, 100],
  tint: [-100, 100],
  gradingBlending: [0, 100],
  gradingBalance: [-100, 100],
  dehaze: [-100, 100],
  lutStrength: [0, 100],
  sharpen: [0, 100],
  aberration: [0, 20],
  bloom: [0, 100],
  blur: [0, 40],
  grayscale: [0, 1],
  invert: [0, 1],
  noise: [0, 60],
  vignette: [0, 100],
  black: [0, 254],
  white: [1, 255],
  gamma: [0.1, 4],
  motion: [0, 100],
  motionAngle: [-180, 180],
};

/** 校验文档和预设共用的后处理参数，旧项目缺少的参数使用中性默认值。
 * @param {object} values 文件中保存的调色参数。
 * @returns {object} 完整且独立的调色参数。
 */
export function validateAdjustments(values = {}) {
  const adjustment = { ...DEFAULT_ADJUSTMENTS, ...values };
  for (const [key, [min, max]] of Object.entries(ADJUSTMENT_RANGES)) {
    if (!Number.isFinite(adjustment[key]) || adjustment[key] < min || adjustment[key] > max)
      throw new Error(`调色参数 ${key} 必须在 ${min}–${max} 之间。`);
  }
  if (typeof adjustment.duotone !== "boolean" ||
      ![adjustment.shadowColor, adjustment.highlightColor].every((color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)))
    throw new Error("渐变映射开关或颜色格式无效。");
  const curves = {};
  for (const key of ["curve", "curveRed", "curveGreen", "curveBlue"]) {
    const curve = adjustment[key];
    if (
      !Array.isArray(curve) || curve.length < 2 || curve.length > 16 ||
      curve.some((point, index) =>
        !Array.isArray(point) || point.length !== 2 ||
        point.some((value) => !Number.isFinite(value) || value < 0 || value > 255) ||
        (index > 0 && point[0] <= curve[index - 1][0])) ||
      curve[0][0] !== 0 || curve.at(-1)[0] !== 255
    )
      throw new Error(`${key} 曲线控制点格式无效。`);
    curves[key] = curve.map((point) => [...point]);
  }
  const savedHsl = adjustment.hsl;
  if (!savedHsl || typeof savedHsl !== "object" || Array.isArray(savedHsl) ||
      Object.keys(savedHsl).some((key) => !Object.hasOwn(DEFAULT_ADJUSTMENTS.hsl, key)))
    throw new Error("HSL 混色需使用红、橙、黄、绿、青、蓝、紫、洋红八个色带。");
  const hsl = {};
  for (const { key, label } of HSL_CHANNELS) {
    const value = Object.hasOwn(savedHsl, key) ? savedHsl[key] : DEFAULT_ADJUSTMENTS.hsl[key];
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some((parameter) => !Object.hasOwn(HSL_RANGES, parameter)))
      throw new Error(`${label}混色参数格式无效。`);
    const band = { ...DEFAULT_ADJUSTMENTS.hsl[key], ...value };
    for (const [parameter, [min, max]] of Object.entries(HSL_RANGES))
      if (!Number.isFinite(band[parameter]) || band[parameter] < min || band[parameter] > max)
        throw new Error(`${label}混色 ${parameter} 必须在 ${min}–${max} 之间。`);
    hsl[key] = band;
  }
  const savedGrading = adjustment.grading;
  if (!savedGrading || typeof savedGrading !== "object" || Array.isArray(savedGrading) ||
      Object.keys(savedGrading).some((key) => !Object.hasOwn(DEFAULT_ADJUSTMENTS.grading, key)))
    throw new Error("色调分级需使用阴影、中间调、高光和整体四个区域。");
  const grading = {};
  for (const { key, label } of GRADING_CHANNELS) {
    const value = Object.hasOwn(savedGrading, key) ? savedGrading[key] : DEFAULT_ADJUSTMENTS.grading[key];
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some((parameter) => !Object.hasOwn(GRADING_RANGES, parameter)))
      throw new Error(`${label}色调分级参数格式无效。`);
    const band = { ...DEFAULT_ADJUSTMENTS.grading[key], ...value };
    for (const [parameter, [min, max]] of Object.entries(GRADING_RANGES))
      if (!Number.isFinite(band[parameter]) || band[parameter] < min || band[parameter] > max)
        throw new Error(`${label}色调分级 ${parameter} 必须在 ${min}–${max} 之间。`);
    grading[key] = band;
  }
  return {
    ...adjustment, ...curves, hsl, grading,
    lut: adjustment.lut === null ? null : validateLut(adjustment.lut),
  };
}

/** 创建可序列化的图层；图像源与变换分开，缩小不会丢失原始像素。
 * @param {string} type 图层类型。
 * @param {object} values 业务属性。
 * @returns {object} 新图层。
 */
export function makeLayer(type, values = {}) {
  return {
    id: createClientId(),
    type,
    name: "新图层",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    flipX: false,
    flipY: false,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "source-over",
    parentId: null,
    targetId: null,
    fill: "#eac6a0",
    stroke: "#ffffff",
    strokeWidth: 0,
    radius: 20,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    effects: {
      shadow: 0,
      shadowColor: "#000000",
      shadowX: 8,
      shadowY: 12,
      overlay: "",
      glow: 0,
    },
    mask: null,
    maskEnabled: true,
    clipped: false,
    ...values,
  };
}

/** 创建空白文档。
 * @param {object} options 名称、宽、高与背景色。
 * @returns {object} 独立文档。
 */
export function makeDocument({
  name = "未命名",
  width = 1600,
  height = 1000,
  background = "#ffffff",
} = {}) {
  return {
    id: createClientId(),
    name,
    width,
    height,
    layers:
      background === "transparent"
        ? []
        : [
            makeLayer("rect", {
              name: "背景",
              width,
              height,
              fill: background,
              locked: true,
            }),
          ],
    guides: [],
  };
}

/** 获取选中图层、分组后代及绑定的调整子项，供移动、复制和删除复用。
 * @param {object[]} layers 图层列表。
 * @param {string[]} ids 选中编号。
 * @returns {Set<string>} 包含后代与依赖调整项的编号集合；选中调整项不会反向包含目标。
 */
export function descendantIds(layers, ids) {
  const result = new Set(ids);
  for (let changed = true; changed;) {
    changed = false;
    for (const layer of layers)
      if (
        (result.has(layer.parentId) || (layer.type === "adjustment" && result.has(layer.targetId))) &&
        !result.has(layer.id)
      ) {
        result.add(layer.id);
        changed = true;
      }
  }
  return result;
}

/** 校验来自文件或浏览器存储的项目，避免不合法尺寸和循环分组。
 * @param {object} doc 待导入文档。
 * @returns {object} 校验后的文档。
 */
export function validateDocument(doc) {
  if (
    !doc ||
    !Number.isInteger(doc.width) ||
    !Number.isInteger(doc.height) ||
    doc.width < 1 ||
    doc.height < 1 ||
    doc.width > 8192 ||
    doc.height > 8192 ||
    doc.width * doc.height > 32000000
  )
    throw new Error("画布需为 1–8192 像素，且总像素不超过 3200 万。");
  if (!Array.isArray(doc.layers) || doc.layers.length > 200)
    throw new Error("项目最多支持 200 个图层。");
  const ids = new Set(doc.layers.map((l) => l.id));
  if (ids.size !== doc.layers.length) throw new Error("项目包含重复图层编号。");
  const types = [
    "raster",
    "rect",
    "roundRect",
    "ellipse",
    "line",
    "triangle",
    "diamond",
    "pentagon",
    "hexagon",
    "star",
    "arrow",
    "heart",
    "text",
    "gradient",
    "group",
    "adjustment",
  ];
  const normalized = doc.layers.map((l) => {
    if (
      !types.includes(l.type) ||
      ![l.x, l.y, l.width, l.height, l.rotation, l.opacity].every(
        Number.isFinite,
      ) ||
      l.width <= 0 ||
      l.height <= 0 ||
      l.width > 16384 ||
      l.height > 16384 ||
      l.width * l.height > 32000000
    )
      throw new Error("图层类型或尺寸无效。");
    for (const [field, min, max] of [["starPoints", 3, 20], ["starInner", 5, 95], ["arrowHead", 5, 95], ["arrowShaft", 5, 95]])
      if (l[field] !== undefined && (!Number.isFinite(l[field]) || l[field] < min || l[field] > max ||
          (field === "starPoints" && !Number.isInteger(l[field]))))
        throw new Error(`形状参数 ${field} 无效。`);
    for (const src of [l.src, l.mask])
      if (
        src &&
        !/^data:image\/(png|jpeg|webp|gif|svg\+xml|avif|bmp|x-ms-bmp);/.test(
          src,
        )
      )
        throw new Error("项目图片必须内嵌，不能引用外部地址。");
    if (
      typeof l.id !== "string" ||
      l.opacity < 0 ||
      l.opacity > 1 ||
      !BLENDS.some(([mode]) => mode === l.blend)
    )
      throw new Error("图层编号、透明度或混合模式无效。");
    const adjustment = validateAdjustments(l.adjustments);
    if (l.targetId !== undefined && l.targetId !== null) {
      const target = doc.layers.find((item) => item.id === l.targetId);
      if (l.type !== "adjustment" || !target || ["group", "adjustment"].includes(target.type))
        throw new Error("调整子项必须绑定到文档中的图像、文字或形状图层，不能绑定分组或其他调整项。");
    }
    const parents = new Set([l.id]);
    let parent = l.parentId;
    while (parent) {
      const entry = doc.layers.find((item) => item.id === parent);
      if (parents.has(parent) || !entry || entry.type !== "group")
        throw new Error("项目分组关系无效。");
      parents.add(parent);
      parent = entry.parentId;
    }
    return makeLayer(l.type, {
      ...l,
      adjustments: adjustment,
      effects: {
        shadow: 0,
        shadowColor: "#000000",
        shadowX: 8,
        shadowY: 12,
        overlay: "",
        glow: 0,
        ...l.effects,
      },
    });
  });
  return {
    ...doc,
    id: doc.id || createClientId(),
    name: String(doc.name || "导入项目"),
    layers: normalized,
    guides: Array.isArray(doc.guides)
      ? doc.guides.filter(
          (g) => ["x", "y"].includes(g.axis) && Number.isFinite(g.position),
        )
      : [],
  };
}

/** 把画布坐标变换为图层自身坐标，用于选取与蒙版绘画。
 * @param {object} point 画布坐标。
 * @param {object} layer 图层变换。
 * @returns {object} 图层内坐标。
 */
export function localPoint(point, layer) {
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - layer.x - layer.width / 2;
  const dy = point.y - layer.y - layer.height / 2;
  return {
    x:
      (dx * Math.cos(angle) - dy * Math.sin(angle)) * (layer.flipX ? -1 : 1) +
      layer.width / 2,
    y:
      (dx * Math.sin(angle) + dy * Math.cos(angle)) * (layer.flipY ? -1 : 1) +
      layer.height / 2,
  };
}
