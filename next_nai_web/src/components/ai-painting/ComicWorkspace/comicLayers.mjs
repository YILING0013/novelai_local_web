import { createClientId } from '../../../utils/browserCapabilities.mjs';
const DEFAULT_LAYERS = ['panels', 'overlays', 'dialogue'];
const ITEM_COLLECTIONS = { panel: 'panels', stroke: 'strokes', element: 'elements' };

// 三类内容共用同一个层内顺序，不能先画完画框再统一补上文字或笔迹。
function allItems(page) {
  return Object.entries(ITEM_COLLECTIONS).flatMap(([kind, collection]) => page[collection].map((item) => ({ kind, item })));
}

/**
 * 为漫画页补齐图层、元素和字体字段，保留已有图层安排及所有业务数据。
 * @param {object} page 新建或从漫画库读取的页面。
 * @returns {object} 可编辑的页面；字段已齐全时返回原对象。
 */
export function ensureComicLayers(page) {
  const sourceLayers = page.layers?.length ? page.layers : DEFAULT_LAYERS.map((kind) => ({ id: kind, kind }));
  const normalizedLayers = sourceLayers.map((layer) => {
    if (layer.name !== undefined && layer.kind && layer.visible !== undefined && layer.locked !== undefined) return layer;
    return { ...layer, name: layer.name ?? '', kind: layer.kind || (DEFAULT_LAYERS.includes(layer.id) ? layer.id : 'custom'), visible: layer.visible ?? true, locked: layer.locked ?? false };
  });
  const layers = page.layers && normalizedLayers.every((layer, index) => layer === page.layers[index]) ? page.layers : normalizedLayers;
  const layerIds = new Set(layers.map((layer) => layer.id));
  const collections = { panels: page.panels || [], strokes: page.strokes || [], elements: page.elements || [] };
  let nextOrder = Math.max(-1, ...Object.values(collections).flat().map((item) => Number.isFinite(item.order) ? item.order : -1)) + 1;
  for (const [collection, items] of Object.entries(collections)) {
    const normalized = items.map((item) => {
      const defaultKind = collection === 'panels' ? (item.type === 'overlay' ? 'overlays' : 'panels') : 'dialogue';
      // 已合并或删除的默认层不会重新出现，新内容落到现有同类层或最上层。
      const layerId = layerIds.has(item.layerId) ? item.layerId : (layers.find((layer) => layer.kind === defaultKind) || layers.at(-1)).id;
      const order = Number.isFinite(item.order) ? item.order : nextOrder++;
      return layerId === item.layerId && order === item.order ? item : { ...item, layerId, order };
    });
    collections[collection] = normalized.every((item, index) => item === items[index]) ? items : normalized;
  }
  const fonts = page.fonts || [];
  if (layers === page.layers && fonts === page.fonts && Object.entries(collections).every(([key, value]) => value === page[key])) return page;
  return { ...page, layers, ...collections, fonts };
}

/**
 * 按从底到顶的图层和层内顺序取得可见内容，锁定层仍参与显示与导出。
 * @param {object} page 漫画页。
 * @returns {Array<{kind:string,item:object}>} 画框、笔迹和元素的实际绘制顺序。
 */
export function getComicRenderItems(page) {
  const ready = ensureComicLayers(page);
  const positions = new Map(ready.layers.filter((layer) => layer.visible).map((layer, index) => [layer.id, index]));
  return allItems(ready).filter(({ item }) => positions.has(item.layerId)).sort((a, b) => positions.get(a.item.layerId) - positions.get(b.item.layerId) || a.item.order - b.item.order);
}

/**
 * 在最上方新增一个空白自定义图层。
 * @param {object} page 漫画页。
 * @param {string} name 用户输入的图层名称。
 * @returns {object} 新页面，最后一个图层是刚创建的图层。
 */
export function addComicLayer(page, name) {
  const ready = ensureComicLayers(page);
  return { ...ready, layers: [...ready.layers, { id: createClientId(), name, kind: 'custom', visible: true, locked: false }], updatedAt: Date.now() };
}

/**
 * 将整层向上或向下移动一层，保持层内内容和顺序不变。
 * @param {object} page 漫画页。
 * @param {string} id 要移动的图层编号。
 * @param {number} direction 向上为 1，向下为 -1。
 * @returns {object} 新页面；已到边界或图层不存在时返回原页面。
 */
export function reorderComicLayer(page, id, direction) {
  const ready = ensureComicLayers(page);
  const index = ready.layers.findIndex((layer) => layer.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ready.layers.length || ![-1, 1].includes(direction)) return page;
  const layers = [...ready.layers];
  [layers[index], layers[target]] = [layers[target], layers[index]];
  return { ...ready, layers, updatedAt: Date.now() };
}

/**
 * 将当前层合入紧邻下层，保持画框、笔迹和元素之间原有的视觉顺序。
 * @param {object} page 漫画页。
 * @param {string} id 要向下合并的图层编号。
 * @returns {object} 新页面；锁定、显隐不一致或没有下层时返回原页面。
 */
export function mergeComicLayerDown(page, id) {
  const ready = ensureComicLayers(page);
  const index = ready.layers.findIndex((layer) => layer.id === id);
  if (index <= 0) return page;
  const source = ready.layers[index];
  const target = ready.layers[index - 1];
  if (source.locked || target.locked || source.visible !== target.visible) return page;
  const contents = allItems(ready);
  const ordered = [target, source].flatMap((layer) => contents.filter(({ item }) => item.layerId === layer.id).sort((a, b) => a.item.order - b.item.order));
  const replacements = new Map(ordered.map(({ item }, order) => [item, { ...item, layerId: target.id, order }]));
  return {
    ...ready,
    layers: ready.layers.filter((layer) => layer.id !== id),
    panels: ready.panels.map((item) => replacements.get(item) || item),
    strokes: ready.strokes.map((item) => replacements.get(item) || item),
    elements: ready.elements.map((item) => replacements.get(item) || item),
    updatedAt: Date.now(),
  };
}

/**
 * 将一项内容移到目标层顶部，保持内容自身数据不变。
 * @param {object} page 漫画页。
 * @param {string} kind panel、stroke 或 element。
 * @param {string} id 内容编号。
 * @param {string} layerId 目标图层编号。
 * @returns {object} 新页面；源层或目标层锁定、内容不存在时返回原页面。
 */
export function moveComicItemToLayer(page, kind, id, layerId) {
  const ready = ensureComicLayers(page);
  const collection = ITEM_COLLECTIONS[kind];
  const item = ready[collection]?.find((entry) => entry.id === id);
  const target = ready.layers.find((layer) => layer.id === layerId);
  if (!item || !target || item.layerId === layerId || target.locked || ready.layers.find((layer) => layer.id === item.layerId).locked) return page;
  const order = Math.max(-1, ...allItems(ready).filter((entry) => entry.item.layerId === layerId).map((entry) => entry.item.order)) + 1;
  return { ...ready, [collection]: ready[collection].map((entry) => entry === item ? { ...entry, layerId, order } : entry), updatedAt: Date.now() };
}

/**
 * 在同一图层中将内容向上或向下移动一位，可以越过另一种内容类型。
 * @param {object} page 漫画页。
 * @param {string} kind panel、stroke 或 element。
 * @param {string} id 内容编号。
 * @param {number} direction 向上为 1，向下为 -1。
 * @returns {object} 新页面；层已锁定或内容已到边界时返回原页面。
 */
export function reorderComicItem(page, kind, id, direction) {
  const ready = ensureComicLayers(page);
  const item = ready[ITEM_COLLECTIONS[kind]]?.find((entry) => entry.id === id);
  if (!item || ready.layers.find((layer) => layer.id === item.layerId).locked || ![-1, 1].includes(direction)) return page;
  const ordered = allItems(ready).filter((entry) => entry.item.layerId === item.layerId).sort((a, b) => a.item.order - b.item.order);
  const index = ordered.findIndex((entry) => entry.kind === kind && entry.item.id === id);
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return page;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const replacements = new Map(ordered.map((entry, order) => [entry.item, entry.item.order === order ? entry.item : { ...entry.item, order }]));
  return {
    ...ready,
    panels: ready.panels.map((entry) => replacements.get(entry) || entry),
    strokes: ready.strokes.map((entry) => replacements.get(entry) || entry),
    elements: ready.elements.map((entry) => replacements.get(entry) || entry),
    updatedAt: Date.now(),
  };
}
