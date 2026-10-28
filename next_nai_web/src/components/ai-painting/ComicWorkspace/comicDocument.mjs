import { createClientId } from '../../../utils/browserCapabilities.mjs';
import { ensureComicLayers } from './comicLayers.mjs';

const PAGE_MARGIN = 32;
const FRAME_WIDTH = 3;

export const COMIC_LAYOUTS = {
  portrait: { name: { zh: '竖版', en: 'Portrait' }, width: 896, height: 1280, sections: 1, sectionWidth: 896, sectionHeight: 1280 },
  landscape: { name: { zh: '横版', en: 'Landscape' }, width: 1280, height: 896, sections: 1, sectionWidth: 1280, sectionHeight: 896 },
  spreadPortrait: { name: { zh: '双列', en: 'Side by side' }, width: 2560, height: 896, sections: 2, sectionWidth: 1280, sectionHeight: 896 },
  spreadLandscape: { name: { zh: '双行', en: 'Stacked pages' }, width: 1280, height: 1792, sections: 2, sectionWidth: 1280, sectionHeight: 896 },
};

const rectangle = (x, y, width, height) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];

function rows(heights, columns) {
  let y = 0;
  return heights.flatMap((height, row) => {
    let x = 0;
    const panels = columns[row].map((width) => {
      const points = rectangle(x, y, width, height);
      x += width;
      return points;
    });
    y += height;
    return panels;
  });
}

const polygon = (coordinates) => coordinates.map(([x, y]) => ({ x, y }));
const preset = (id, zh, en, panels, borderWidth = FRAME_WIDTH) => ({
  id, name: { zh, en }, gutter: 14,
  panels: panels.map((points) => ({ points, borderWidth })),
});

// 模板只记录空画框；阅读节奏由格数、面积和倾斜方向决定，不混入图片或生成参数。
export const COMIC_TEMPLATES = [
  preset('blank', '单格留白', 'Single panel', [rectangle(0, 0, 1, 1)]),
  preset('two-horizontal', '双横格', 'Two horizontal', rows([0.5, 0.5], [[1], [1]])),
  preset('two-vertical', '双竖格', 'Two vertical', rows([1], [[0.5, 0.5]])),
  preset('three-horizontal', '三段叙事', 'Three horizontal', rows([1 / 3, 1 / 3, 1 / 3], [[1], [1], [1]])),
  preset('three-vertical', '三列并行', 'Three vertical', rows([1], [[1 / 3, 1 / 3, 1 / 3]])),
  preset('grid-four', '四格均分', 'Four panel grid', rows([0.5, 0.5], [[0.5, 0.5], [0.5, 0.5]])),
  preset('grid-six', '六格叙事', 'Six panel grid', rows([1 / 3, 1 / 3, 1 / 3], [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]])),
  preset('grid-nine', '九格节奏', 'Nine panel grid', rows([1 / 3, 1 / 3, 1 / 3], [[1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3]])),
  preset('hero-top', '上方主镜头', 'Top hero', rows([0.62, 0.38], [[1], [0.5, 0.5]])),
  preset('hero-bottom', '下方主镜头', 'Bottom hero', rows([0.38, 0.62], [[0.5, 0.5], [1]])),
  preset('hero-left', '左侧主镜头', 'Left hero', [rectangle(0, 0, 0.62, 1), rectangle(0.62, 0, 0.38, 0.5), rectangle(0.62, 0.5, 0.38, 0.5)]),
  preset('hero-right', '右侧主镜头', 'Right hero', [rectangle(0, 0, 0.38, 0.5), rectangle(0, 0.5, 0.38, 0.5), rectangle(0.38, 0, 0.62, 1)]),
  preset('cinematic', '宽景与特写', 'Scene and closeups', rows([0.24, 0.52, 0.24], [[1], [0.35, 0.65], [1]])),
  preset('four-horizontal', '四段停顿', 'Four horizontal', rows([0.25, 0.25, 0.25, 0.25], [[1], [1], [1], [1]])),
  preset('five-beats', '五格推进', 'Five beats', rows([0.28, 0.44, 0.28], [[0.5, 0.5], [1], [0.5, 0.5]])),
  preset('six-alternating', '错位六格', 'Alternating six', rows([0.3, 0.4, 0.3], [[0.35, 0.65], [0.65, 0.35], [0.4, 0.6]])),
  preset('opening-panorama', '开场全景', 'Opening panorama', rows([0.3, 0.35, 0.35], [[1], [0.5, 0.5], [0.5, 0.5]])),
  preset('closing-panorama', '结尾全景', 'Closing panorama', rows([0.35, 0.35, 0.3], [[0.5, 0.5], [0.5, 0.5], [1]])),
  preset('tall-center', '中央长镜头', 'Tall center', [rectangle(0, 0, 0.25, 0.5), rectangle(0, 0.5, 0.25, 0.5), rectangle(0.25, 0, 0.5, 1), rectangle(0.75, 0, 0.25, 0.5), rectangle(0.75, 0.5, 0.25, 0.5)]),
  preset('diagonal-duo', '斜切双格', 'Diagonal duo', [polygon([[0, 0], [1, 0], [1, 0.35], [0, 0.65]]), polygon([[0, 0.65], [1, 0.35], [1, 1], [0, 1]])]),
  preset('diagonal-action', '斜向动作', 'Diagonal action', [polygon([[0, 0], [0.7, 0], [0.3, 1], [0, 1]]), polygon([[0.7, 0], [1, 0], [1, 1], [0.3, 1]])]),
  preset('diagonal-three', '三段斜切', 'Three diagonal beats', [polygon([[0, 0], [1, 0], [1, 0.2], [0, 0.42]]), polygon([[0, 0.42], [1, 0.2], [1, 0.68], [0, 0.8]]), polygon([[0, 0.8], [1, 0.68], [1, 1], [0, 1]])]),
  preset('diagonal-opening', '斜格开场', 'Diagonal opening', [polygon([[0, 0], [0.65, 0], [0.4, 0.55], [0, 0.55]]), polygon([[0.65, 0], [1, 0], [1, 0.55], [0.4, 0.55]]), rectangle(0, 0.55, 1, 0.45)]),
  preset('diagonal-ending', '斜格收束', 'Diagonal ending', [rectangle(0, 0, 1, 0.45), polygon([[0, 0.45], [0.6, 0.45], [0.35, 1], [0, 1]]), polygon([[0.6, 0.45], [1, 0.45], [1, 1], [0.35, 1]])]),
  preset('triangle-impact', '三角冲击', 'Triangle impact', [polygon([[0, 0], [1, 0], [0.5, 0.6]]), polygon([[0, 0], [0.5, 0.6], [0, 1]]), polygon([[1, 0], [1, 1], [0.5, 0.6]]), polygon([[0, 1], [0.5, 0.6], [1, 1]])]),
  preset('borderless', '无框整页', 'Borderless page', [rectangle(0, 0, 1, 1)], 0),
  preset('borderless-pair', '无框双景', 'Borderless pair', rows([0.6, 0.4], [[1], [1]]), 0),
  { ...preset('open-hero', '无框主镜头', 'Open hero', rows([0.65, 0.35], [[1], [0.5, 0.5]])), panels: [{ points: rectangle(0, 0, 1, 0.65), borderWidth: 0 }, { points: rectangle(0, 0.65, 0.5, 0.35), borderWidth: FRAME_WIDTH }, { points: rectangle(0.5, 0.65, 0.5, 0.35), borderWidth: FRAME_WIDTH }] },
];

/**
 * 计算画框或顶点列表的外接矩形，供选框、图片裁剪和导出使用。
 * @param {object|Array} panelOrPoints 画框对象或页面绝对坐标顶点。
 * @returns {{x:number,y:number,width:number,height:number}} 外接矩形。
 */
export function panelBounds(panelOrPoints) {
  const points = Array.isArray(panelOrPoints) ? panelOrPoints : panelOrPoints.points;
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return { x, y, width: Math.max(...points.map((point) => point.x)) - x, height: Math.max(...points.map((point) => point.y)) - y };
}

/**
 * 获取单页或跨页中指定半页的范围，不包含页间缝隙。
 * @param {object} page 漫画页。
 * @param {number} section 半页编号，从零开始。
 * @returns {{x:number,y:number,width:number,height:number}} 页面绝对坐标范围。
 */
export function sectionBounds(page, section = 0) {
  if (section === -1) return { x: 0, y: 0, width: page.width, height: page.height };
  // 旧漫画保留自己的画布尺寸，不能随着新建页面默认尺寸一起变形。
  const width = page.layout === 'spreadPortrait' ? page.width / 2 : page.width;
  const height = page.layout === 'spreadLandscape' ? page.height / 2 : page.height;
  return { x: page.layout === 'spreadPortrait' ? section * width : 0, y: page.layout === 'spreadLandscape' ? section * height : 0, width, height };
}

/**
 * 获取漫画生成内容区；页外留白不进入模型图像或角色坐标。
 * @param {object} page 漫画页。
 * @param {number} section 单页或跨页的分区编号。
 * @returns {{x:number,y:number,width:number,height:number}} 内容区绝对坐标；常规画布四边留白 32 像素，小画布按比例缩小留白。
 */
export function comicContentBounds(page, section = 0) {
  const bounds = sectionBounds(page, section);
  const layout = COMIC_LAYOUTS[page.layout];
  const legacyPortrait = page.layout === 'portrait' || page.layout === 'spreadPortrait';
  // 旧版使用原来的单页基准，避免打开旧项目时页边距随新版预设改变。
  const referenceWidth = page.layoutVersion === 2 ? layout.sectionWidth : legacyPortrait ? 800 : 1120;
  const referenceHeight = page.layoutVersion === 2 ? layout.sectionHeight : legacyPortrait ? 1120 : 800;
  const margin = PAGE_MARGIN * Math.min(1, bounds.width / referenceWidth, bounds.height / referenceHeight);
  return { x: bounds.x + margin, y: bounds.y + margin, width: bounds.width - margin * 2, height: bounds.height - margin * 2 };
}

function signedArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function clipPolygon(points, start, end, offset, side) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const distance = (point) => side * ((dx * (point.y - start.y) - dy * (point.x - start.x)) / length - offset);
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const here = distance(point);
    const there = distance(next);
    if (here >= -0.00001) result.push(point);
    if ((here >= 0) !== (there >= 0)) {
      const ratio = here / (here - there);
      result.push({ x: point.x + (next.x - point.x) * ratio, y: point.y + (next.y - point.y) * ratio });
    }
  }
  // 切线经过已有顶点时，只保留一个顶点，避免后续拖动出现零长度边。
  return result.filter((point, index) => {
    const previous = result[(index + result.length - 1) % result.length];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.00001;
  });
}

function insetPolygon(points, amount, outerBounds) {
  const direction = Math.sign(signedArea(points));
  return points.reduce((result, start, index) => {
    const end = points[(index + 1) % points.length];
    // 新页面只给相邻分镜留沟槽，整页最外沿不再额外缩进半个沟槽。
    const outerEdge = outerBounds && (
      [outerBounds.x, outerBounds.x + outerBounds.width].some((x) => Math.abs(start.x - x) < 0.00001 && Math.abs(end.x - x) < 0.00001)
      || [outerBounds.y, outerBounds.y + outerBounds.height].some((y) => Math.abs(start.y - y) < 0.00001 && Math.abs(end.y - y) < 0.00001)
    );
    return clipPolygon(result, start, end, (outerEdge ? 0 : amount) * direction, direction);
  }, points);
}

function isUsablePolygon(points, minimumSize = 12) {
  if (points.length < 3 || Math.abs(signedArea(points)) < minimumSize * minimumSize) return false;
  const bounds = panelBounds(points);
  if (bounds.width < minimumSize || bounds.height < minimumSize) return false;
  let direction = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < minimumSize / 12) return false;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 0.00001) continue;
    if (direction && Math.sign(cross) !== direction) return false;
    direction = Math.sign(cross);
  }
  return true;
}

function clipToBounds(points, bounds) {
  const border = rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
  return border.reduce((result, start, index) => clipPolygon(result, start, border[(index + 1) % border.length], 0, 1), points);
}

/**
 * 在指定半页应用空分镜模板，保留另一半页的图片、参数和画框。
 * @param {object} page 当前漫画页。
 * @param {string} templateId 预设或自定义模板编号。
 * @param {number} section 目标半页编号。
 * @param {Array} customTemplates 用户保存的模板。
 * @param {string} targetLayerId 指定时仅替换该层，否则只处理默认画框层；锁定或隐藏层保持不变。
 * @returns {object} 应用模板后的新页面，不改动原对象。
 */
export function applyTemplate(page, templateId, section = 0, customTemplates = [], targetLayerId) {
  const template = [...COMIC_TEMPLATES, ...customTemplates].find((item) => item.id === templateId);
  if (!template) throw new Error('Comic template not found');
  const ready = ensureComicLayers(page);
  const editableLayers = ready.layers.filter((layer) => layer.visible && !layer.locked && (targetLayerId ? layer.id === targetLayerId : ['panels', 'overlays'].includes(layer.kind)));
  if (!editableLayers.length) return page;
  const editableIds = new Set(editableLayers.map((layer) => layer.id));
  const bounds = sectionBounds(page, section);
  const content = comicContentBounds(page, section);
  const templateScale = (content.x - bounds.x) / PAGE_MARGIN;
  const panels = template.panels.flatMap((item) => {
    const preferred = ready.layers.find((layer) => layer.kind === (item.type === 'overlay' ? 'overlays' : 'panels'));
    const layer = targetLayerId ? editableLayers[0] : preferred || editableLayers.at(-1);
    if (!editableIds.has(layer.id)) return [];
    const points = item.points.map((point) => ({ x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, content.x + point.x * content.width)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, content.y + point.y * content.height)) }));
    return [{ id: createClientId(), type: item.type || 'regular', layerId: layer.id, section: item.type === 'overlay' ? -1 : section, ...(item.type === 'overlay' ? { templateSection: section } : {}), points: template.gutter ? insetPolygon(points, template.gutter * templateScale / 2, page.layoutVersion === 2 ? content : undefined) : points, borderWidth: item.borderWidth, image: null, task: null }];
  });
  const sourceOverlays = new Set(template.panels.filter((panel) => panel.type === 'overlay').map((panel) => panel.sourcePanelId));
  const regular = [...ready.panels.filter((panel) => panel.type !== 'overlay' && (panel.section !== section || !editableIds.has(panel.layerId))), ...panels.filter((panel) => panel.type !== 'overlay')].sort((a, b) => a.section - b.section);
  // 回套刚保存的模板时替换源叠加框，避免透明人物在原位置重复叠加。
  const overlays = ready.panels.flatMap((panel) => {
    if (panel.type !== 'overlay') return [];
    if (!editableIds.has(panel.layerId)) return [panel];
    if (panel.templateSection === section) return [];
    if (!sourceOverlays.has(panel.id)) return [panel];
    // 跨页源框只替换当前半页部分，另一半页的原图和形状继续保留。
    if (COMIC_LAYOUTS[page.layout].sections === 1) return [];
    const remaining = clipToBounds(panel.points, sectionBounds(page, 1 - section));
    return isUsablePolygon(remaining, 12 * templateScale) ? [{ ...panel, points: remaining }] : [];
  });
  return ensureComicLayers({ ...ready, panels: [...regular, ...overlays, ...panels.filter((panel) => panel.type === 'overlay')], updatedAt: Date.now() });
}

/**
 * 创建指定方向的空白漫画页，跨页的两块可分别更换模板。
 * @param {string} layout COMIC_LAYOUTS 中的页面类型。
 * @param {string} templateId 初始预设模板编号。
 * @param {{width:number,height:number}} dimensions 可选的正整数画布尺寸；省略时使用本地版预设。
 * @returns {object} 包含画框、笔迹和时间的新页面。
 */
export function createComicPage(layout = 'portrait', templateId = 'blank', dimensions = COMIC_LAYOUTS[layout]) {
  const size = dimensions;
  let page = ensureComicLayers({ id: createClientId(), layout, layoutVersion: 2, title: '', width: size.width, height: size.height, panels: [], strokes: [], createdAt: Date.now(), updatedAt: Date.now() });
  for (let section = 0; section < COMIC_LAYOUTS[layout].sections; section += 1) page = applyTemplate(page, templateId, section);
  if (templateId === 'blank' && page.panels.length === 1) page.panels[0].initialPoints = page.panels[0].points.map((point) => ({ ...point }));
  return page;
}

/**
 * 将记住的单页尺寸转为横版、竖版或双页尺寸，避免双页反复切换时尺寸翻倍。
 * @param {string} layout 目标版式。
 * @param {{width:number,height:number}|null} defaults 单页短边与长边；未设置时使用本地版原预设。
 * @returns {{width:number,height:number}} 目标画布的正整数宽高，半像素只在最终画布取整。
 */
export function getComicLayoutSize(layout, defaults) {
  if (!defaults) return { width: COMIC_LAYOUTS[layout].width, height: COMIC_LAYOUTS[layout].height };
  const portrait = layout === 'portrait' || layout === 'spreadPortrait';
  return {
    width: Math.round((portrait ? defaults.width : defaults.height) * (layout === 'spreadPortrait' ? 2 : 1)),
    height: Math.round((portrait ? defaults.height : defaults.width) * (layout === 'spreadLandscape' ? 2 : 1)),
  };
}

/**
 * 调整画布边界，只有未编辑且没有内容的初始单画框随画布按宽高比例缩放。
 * @param {object} page 当前完整漫画页。
 * @param {number} width 新画布宽度，正整数像素。
 * @param {number} height 新画布高度，正整数像素。
 * @returns {object} 可整体撤销的新页面，其余内容和 AI 工作流保持原状。
 */
export function resizeComicPage(page, width, height) {
  const next = { ...page, width, height };
  if (COMIC_LAYOUTS[page.layout].sections !== 1 || page.panels.length !== 1 || page.elements.length || page.strokes.length || page.aiWorkflow) return next;
  const panel = page.panels[0];
  const layer = page.layers.find((item) => item.id === panel.layerId);
  if (panel.type !== 'regular' || panel.section !== 0 || panel.layerId !== 'panels' || panel.borderWidth !== FRAME_WIDTH || panel.image || panel.task || !layer.visible || layer.locked) return next;
  // 旧项目按当时的外沿留白识别初始框，新版不在页面外沿额外缩进半个沟槽。
  const content = comicContentBounds(page);
  const inset = content.x * (1 + (page.layoutVersion === 2 ? 0 : COMIC_TEMPLATES[0].gutter / 2 / PAGE_MARGIN));
  const initialPoints = panel.initialPoints || rectangle(inset, inset, page.width - inset * 2, page.height - inset * 2);
  if (panel.points.length !== initialPoints.length || !panel.points.every((point, index) => Math.abs(point.x - initialPoints[index].x) < 1e-7 && Math.abs(point.y - initialPoints[index].y) < 1e-7)) return next;
  const points = panel.points.map((point) => ({ x: point.x * width / page.width, y: point.y * height / page.height }));
  return { ...next, panels: [{ ...panel, points, initialPoints: points.map((point) => ({ ...point })) }] };
}

/**
 * 沿两点所在的直线切开凸画框，切口留白且不复制生成任务。
 * @param {object} panel 要切割的画框。
 * @param {{x:number,y:number}} start 切线第一点。
 * @param {{x:number,y:number}} end 切线第二点。
 * @param {number} gutter 切口留白宽度，单位为页面像素。
 * @param {number} nextOrder 同层下一项的顺序号，用于把新画框插在原位置。
 * @returns {Array|null} 两个新画框；没有切开或产生过小画框时返回 null。
 */
export function splitPanel(panel, start, end, gutter = 14, nextOrder = (panel.order ?? 0) + 1) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return null;
  const halves = [clipPolygon(panel.points, start, end, gutter / 2, 1), clipPolygon(panel.points, start, end, -gutter / 2, -1)];
  if (!halves.every((points) => isUsablePolygon(points))) return null;
  // 两块都使用新编号，旧画框尚未返回的生成结果就不会被填进切割后的画框。
  const order = panel.order ?? 0;
  return halves.map((points, index) => ({ ...panel, id: createClientId(), layerId: panel.layerId || (panel.type === 'overlay' ? 'overlays' : 'panels'), order: index === 0 ? order : (order + nextOrder) / 2, points, image: panel.image ? { ...panel.image } : null, task: null }));
}

/**
 * 拖拽创建矩形画框，自动限制在所选半页内。
 * @param {object} page 当前漫画页。
 * @param {number} section 目标半页编号，-1 创建可跨整页的叠加画框。
 * @param {object} start 拖拽起点。
 * @param {object} end 拖拽终点。
 * @returns {object|null} 新画框，拖拽范围太小时返回 null。
 */
export function createRectanglePanel(page, section, start, end) {
  const bounds = sectionBounds(page, section);
  const x = Math.max(bounds.x, Math.min(start.x, end.x));
  const y = Math.max(bounds.y, Math.min(start.y, end.y));
  const right = Math.min(bounds.x + bounds.width, Math.max(start.x, end.x));
  const bottom = Math.min(bounds.y + bounds.height, Math.max(start.y, end.y));
  if (right - x < 12 || bottom - y < 12) return null;
  const ready = ensureComicLayers(page);
  const layerId = (ready.layers.find((layer) => layer.kind === (section === -1 ? 'overlays' : 'panels')) || ready.layers.at(-1)).id;
  const order = Math.max(-1, ...[...ready.panels, ...ready.strokes, ...ready.elements].filter((item) => item.layerId === layerId).map((item) => item.order)) + 1;
  return { id: createClientId(), type: section === -1 ? 'overlay' : 'regular', layerId, order, section, points: rectangle(x, y, right - x, bottom - y), borderWidth: section === -1 ? 0 : FRAME_WIDTH, image: null, task: null };
}

/**
 * 移动画框顶点并保持凸形，防止边线交叉后无法继续切割。
 * @param {object} panel 当前画框。
 * @param {number} index 要移动的顶点索引。
 * @param {object} point 新位置。
 * @param {object} bounds 所属半页的范围。
 * @returns {object} 移动后的画框，无效移动返回原画框。
 */
export function movePanelVertex(panel, index, point, bounds) {
  const points = panel.points.map((old, vertex) => vertex === index ? { x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, point.x)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, point.y)) } : old);
  return isUsablePolygon(points) ? { ...panel, points } : panel;
}

/**
 * 同时移动一条边的两个端点，保持画框凸形和半页边界。
 * @param {object} panel 当前画框。
 * @param {number} index 边的起点索引。
 * @param {{x:number,y:number}} delta 页面坐标中的移动距离。
 * @param {object} bounds 所属半页的范围。
 * @returns {object} 移动后的画框，无效移动返回原画框。
 */
export function movePanelEdge(panel, index, delta, bounds) {
  const next = (index + 1) % panel.points.length;
  const edge = [panel.points[index], panel.points[next]];
  const dx = Math.max(bounds.x - Math.min(...edge.map((p) => p.x)), Math.min(bounds.x + bounds.width - Math.max(...edge.map((p) => p.x)), delta.x));
  const dy = Math.max(bounds.y - Math.min(...edge.map((p) => p.y)), Math.min(bounds.y + bounds.height - Math.max(...edge.map((p) => p.y)), delta.y));
  const points = panel.points.map((point, vertex) => vertex === index || vertex === next ? { x: point.x + dx, y: point.y + dy } : point);
  return isUsablePolygon(points) ? { ...panel, points } : panel;
}

/**
 * 整体移动画框和其中图像，在所属半页或整页边界处停下，保持形状与裁剪关系。
 * @param {object} panel 当前画框。
 * @param {{x:number,y:number}} delta 相对于拖拽起始画框的页面坐标位移。
 * @param {object} bounds 普通框所属半页的范围；叠加框使用整页范围。
 * @returns {object} 移动后的画框，没有实际位移时返回原画框。
 */
export function movePanel(panel, delta, bounds) {
  const frame = panelBounds(panel);
  // 统一限制整框位移，不能逐点裁进边界，否则碰到边缘时会改变凸多边形形状。
  // 缩小画布后保留零位移，允许超大或越界画框逐步移回可见区域。
  const left = bounds.x - frame.x, right = bounds.x + bounds.width - frame.x - frame.width;
  const top = bounds.y - frame.y, bottom = bounds.y + bounds.height - frame.y - frame.height;
  const dx = Math.max(Math.min(left, right, 0), Math.min(Math.max(left, right, 0), delta.x));
  const dy = Math.max(Math.min(top, bottom, 0), Math.min(Math.max(top, bottom, 0), delta.y));
  if (dx === 0 && dy === 0) return panel;
  return {
    ...panel,
    points: panel.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    image: panel.image ? { ...panel.image, x: panel.image.x + dx, y: panel.image.y + dy } : panel.image,
  };
}

/**
 * 围绕画框中心旋转并平移；整体限制在页面内，保持边长、凸形和图像构图。
 * @param {object} panel 手势开始时的画框。
 * @param {number} angle 相对旋转角度，单位为弧度。
 * @param {object} delta 页面坐标中的平移距离。
 * @param {object} bounds 允许编辑的页面范围。
 * @returns {object|null} 新画框；旋转后尺寸超过页面时返回 null。
 */
export function rotatePanel(panel, angle, delta, bounds) {
  const box = panelBounds(panel), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let points = panel.points.map((p) => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin + delta.x, y: cy + (p.x - cx) * sin + (p.y - cy) * cos + delta.y }));
  const rotated = panelBounds(points);
  if (rotated.width > bounds.width + 0.00001 || rotated.height > bounds.height + 0.00001) return null;
  const dx = Math.max(bounds.x - rotated.x, Math.min(0, bounds.x + bounds.width - rotated.x - rotated.width));
  const dy = Math.max(bounds.y - rotated.y, Math.min(0, bounds.y + bounds.height - rotated.y - rotated.height));
  points = points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return { ...panel, points, image: transformPanelImage(panel.image, panel.points, points) };
}

/**
 * 把图像跟随画框的刚性变换移动或旋转；拖动顶点改变形状时不调用。
 * @param {object|null} image 当前图像，允许拖动期间异步填入的新图。
 * @param {Array} before 变换前的画框顶点。
 * @param {Array} after 变换后的画框顶点。
 * @returns {object|null} 保留素材和比例的图像构图。
 */
export function transformPanelImage(image, before, after) {
  if (!image) return image;
  const angle = Math.atan2(after[1].y - after[0].y, after[1].x - after[0].x) - Math.atan2(before[1].y - before[0].y, before[1].x - before[0].x);
  const halfWidth = image.width * image.scale / 2, halfHeight = image.height * image.scale / 2;
  const dx = image.x + halfWidth - before[0].x, dy = image.y + halfHeight - before[0].y;
  return { ...image, x: after[0].x + dx * Math.cos(angle) - dy * Math.sin(angle) - halfWidth, y: after[0].y + dx * Math.sin(angle) + dy * Math.cos(angle) - halfHeight, rotation: (image.rotation || 0) + angle * 180 / Math.PI };
}

/**
 * 切换普通框与叠加框；转回普通框时裁进所选半页，避免跨页顶点失控。
 * @param {object} panel 当前画框。
 * @param {string} type regular 或 overlay。
 * @param {object} page 当前漫画页。
 * @param {number} section 转回普通框的目标半页编号。
 * @returns {object|null} 新画框，没有落在目标半页内时返回 null。
 */
export function convertPanelType(panel, type, page, section = 0) {
  const points = type === 'overlay' ? panel.points : clipToBounds(panel.points, sectionBounds(page, section));
  if (!isUsablePolygon(points)) return null;
  const result = { ...panel, type, points, section: type === 'overlay' ? -1 : section };
  delete result.templateSection;
  return result;
}

/**
 * 将图像居中铺满画框，保留原图尺寸供展开裁剪时缩放和平移。
 * @param {object} panel 目标画框。
 * @param {{dataUrl:string,width:number,height:number}} image 原图数据及实际宽高。
 * @returns {object} 带页面绝对位置 x/y 和缩放 scale 的图像记录。
 */
export function fitPanelImage(panel, image) {
  const bounds = panelBounds(panel);
  const scale = Math.max(bounds.width / image.width, bounds.height / image.height);
  return { ...image, scale, x: bounds.x + (bounds.width - image.width * scale) / 2, y: bounds.y + (bounds.height - image.height * scale) / 2 };
}

/**
 * 保存指定半页的普通框和叠加框形状，剔除图像和生成参数供下次套用。
 * @param {object} page 当前漫画页。
 * @param {number} section 要保存的半页编号。
 * @param {string|object} name 模板名称或中英文名称。
 * @returns {object} 以半页内边距归一化的自定义模板。
 */
export function createComicTemplate(page, section, name) {
  const bounds = sectionBounds(page, section);
  const content = comicContentBounds(page, section);
  const templateScale = (content.x - bounds.x) / PAGE_MARGIN;
  return {
    id: createClientId(), name: typeof name === 'string' ? { zh: name, en: name } : name, gutter: 0, custom: true,
    orientation: bounds.height > bounds.width ? 'portrait' : 'landscape', createdAt: Date.now(),
    panels: page.panels.flatMap((panel) => {
      if (panel.type !== 'overlay' && panel.section !== section) return [];
      const points = panel.type === 'overlay' ? clipToBounds(panel.points, bounds) : panel.points;
      if (!isUsablePolygon(points, 12 * templateScale)) return [];
      return [{ type: panel.type || 'regular', ...(panel.type === 'overlay' ? { sourcePanelId: panel.id } : {}), borderWidth: panel.borderWidth, points: points.map((point) => ({ x: (point.x - content.x) / content.width, y: (point.y - content.y) / content.height })) }];
    }),
  };
}
