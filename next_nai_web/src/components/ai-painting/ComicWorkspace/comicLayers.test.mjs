import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addComicLayer, ensureComicLayers, getComicRenderItems, mergeComicLayerDown,
  moveComicItemToLayer, reorderComicItem, reorderComicLayer,
} from './comicLayers.mjs';
import { applyTemplate, createComicPage, createRectanglePanel, splitPanel } from './comicDocument.mjs';
import { loadComicLibrary, saveComicCanvasDefaults, saveComicDraft, saveComicPage } from './comicStorage.mjs';

const visibleIds = (page) => getComicRenderItems(page).map(({ item }) => item.id);
const mixedPage = () => ensureComicLayers({
  id: 'page', createdAt: 10,
  panels: [{ id: 'background', type: 'regular', order: 1 }, { id: 'foreground', type: 'overlay', order: 3 }],
  strokes: [{ id: 'ink', layerId: 'panels', order: 2 }, { id: 'erase', kind: 'erase', order: 5 }],
  elements: [{ id: 'text', type: 'text', order: 4 }],
});

test('旧漫画页补齐默认图层，普通框、叠加框和笔迹保持原覆盖关系', () => {
  const old = {
    id: 'legacy', customMetadata: { version: 7 },
    panels: [{ id: 'overlay', type: 'overlay', image: { dataUrl: 'image' } }, { id: 'panel', type: 'regular', task: { params: { prompt: 'scene' } } }],
    strokes: [{ id: 'stroke', kind: 'brush', points: [{ x: 5, y: 9 }] }],
  };
  const snapshot = structuredClone(old);
  const ready = ensureComicLayers(old);
  assert.deepEqual(ready.layers.map((layer) => layer.id), ['panels', 'overlays', 'dialogue']);
  assert.deepEqual(visibleIds(ready), ['panel', 'overlay', 'stroke']);
  assert.deepEqual(ready.elements, []);
  assert.deepEqual(ready.fonts, []);
  assert.equal(ready.customMetadata, old.customMetadata);
  assert.equal(ready.panels[1].task, old.panels[1].task);
  assert.deepEqual(old, snapshot);
  assert.equal(ensureComicLayers(ready), ready);
});

test('同层内容按共同顺序绘制，隐藏层不显示，锁定层仍显示', () => {
  const page = mixedPage();
  assert.deepEqual(visibleIds(page), ['background', 'ink', 'foreground', 'text', 'erase']);
  const changed = { ...page, layers: page.layers.map((layer) => ({ ...layer, locked: true, visible: layer.id !== 'overlays' })) };
  assert.deepEqual(visibleIds(changed), ['background', 'ink', 'text', 'erase']);
});

test('同层上下移动可以越过笔迹或元素，不改变内容归属和图层位置', () => {
  const page = mixedPage();
  const moved = reorderComicItem(page, 'panel', 'background', 1);
  assert.deepEqual(visibleIds(moved), ['ink', 'background', 'foreground', 'text', 'erase']);
  assert.equal(moved.panels[0].layerId, 'panels');
  assert.equal(moved.layers, page.layers);
  assert.deepEqual(visibleIds(page), ['background', 'ink', 'foreground', 'text', 'erase']);
  assert.equal(reorderComicItem(moved, 'panel', 'background', 1), moved);
});

test('向下合并保留跨类型视觉顺序，不重新创建已经合并的默认层', () => {
  const page = mixedPage();
  const snapshot = structuredClone(page);
  const merged = mergeComicLayerDown(page, 'dialogue');
  assert.deepEqual(visibleIds(merged), visibleIds(page));
  assert.deepEqual(merged.layers.map((layer) => layer.id), ['panels', 'overlays']);
  assert.equal(merged.elements[0].layerId, 'overlays');
  assert.equal(merged.strokes[1].layerId, 'overlays');
  assert.deepEqual(ensureComicLayers(merged).layers, merged.layers);
  assert.deepEqual(page, snapshot);
  const extra = ensureComicLayers({ ...merged, elements: [...merged.elements, { id: 'new-text', type: 'text' }] });
  assert.equal(extra.elements.at(-1).layerId, 'overlays');
  assert.equal(extra.layers.length, 2);
});

test('内容跨层后放在目标层顶部，图层上下移动仍独立工作', () => {
  const page = mixedPage();
  const added = addComicLayer(page, '效果');
  const layerId = added.layers.at(-1).id;
  const moved = moveComicItemToLayer(added, 'panel', 'background', layerId);
  assert.equal(moved.panels[0].layerId, layerId);
  assert.deepEqual(visibleIds(moved), ['ink', 'foreground', 'text', 'erase', 'background']);
  const reordered = reorderComicLayer(moved, layerId, -1);
  assert.deepEqual(visibleIds(reordered), ['ink', 'foreground', 'background', 'text', 'erase']);
  assert.equal(reordered.panels, moved.panels);
  assert.equal(reorderComicLayer(page, 'panels', -1), page);
});

test('锁定内容不允许换层或调序，显隐不同的图层不能合并后改变显示结果', () => {
  const page = mixedPage();
  const locked = { ...page, layers: page.layers.map((layer) => layer.id === 'panels' ? { ...layer, locked: true } : layer) };
  assert.equal(moveComicItemToLayer(locked, 'panel', 'background', 'dialogue'), locked);
  assert.equal(moveComicItemToLayer(locked, 'element', 'text', 'panels'), locked);
  assert.equal(reorderComicItem(locked, 'panel', 'background', 1), locked);
  assert.equal(mergeComicLayerDown(locked, 'overlays'), locked);
  const hidden = { ...page, layers: page.layers.map((layer) => layer.id === 'dialogue' ? { ...layer, visible: false } : layer) };
  assert.equal(mergeComicLayerDown(hidden, 'dialogue'), hidden);
});

test('新页和重复切割都保留图层，新增画框插入原位置而不挤到文字上方', () => {
  const page = createComicPage();
  assert.equal(page.layers.length, 3);
  const panel = { ...page.panels[0], order: 2 };
  const halves = splitPanel(panel, { x: 400, y: 0 }, { x: 400, y: 1120 }, 14, 2.25);
  assert.deepEqual(halves.map((half) => half.order), [2, 2.125]);
  assert.ok(halves.every((half) => half.layerId === panel.layerId));
  const smaller = splitPanel(halves[0], { x: 0, y: 560 }, { x: 800, y: 560 }, 14, halves[1].order);
  assert.deepEqual(smaller.map((half) => half.order), [2, 2.0625]);
});

test('模板只替换目标自定义层，默认套版也不会删除自定义层或其他层的跨页框', () => {
  let page = addComicLayer(createComicPage('spreadPortrait'), '动作');
  const customLayer = page.layers.at(-1).id;
  const regular = { ...createRectanglePanel(page, 0, { x: 80, y: 80 }, { x: 200, y: 240 }), layerId: customLayer };
  const overlay = createRectanglePanel(page, -1, { x: 600, y: 100 }, { x: 1000, y: 300 });
  page = { ...page, panels: [...page.panels, regular, overlay] };
  const snapshot = structuredClone(page);
  const changed = applyTemplate(page, 'grid-four', 0, [], customLayer);
  assert.equal(changed.panels.filter((panel) => panel.layerId === customLayer).length, 4);
  assert.ok(changed.panels.every((panel) => panel.id !== regular.id));
  assert.ok(page.panels.filter((panel) => panel.id !== regular.id).every((panel) => changed.panels.includes(panel)));
  const defaults = applyTemplate(page, 'grid-four', 0);
  assert.ok(defaults.panels.includes(regular));
  assert.ok(defaults.panels.includes(overlay));
  assert.deepEqual(page, snapshot);
});

test('模板保留锁定或隐藏图层的旧框，并且不向这些层新增内容', () => {
  let page = createComicPage();
  const overlay = createRectanglePanel(page, -1, { x: 50, y: 50 }, { x: 200, y: 200 });
  page = { ...page, panels: [...page.panels, overlay], layers: page.layers.map((layer) => layer.id === 'overlays' ? { ...layer, locked: true } : layer) };
  const template = { id: 'mixed', gutter: 0, panels: [{ type: 'regular', borderWidth: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, { type: 'overlay', sourcePanelId: overlay.id, borderWidth: 0, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] }] };
  const changed = applyTemplate(page, template.id, 0, [template]);
  assert.deepEqual(changed.panels.filter((panel) => panel.layerId === 'overlays'), [overlay]);
  assert.notEqual(changed.panels.find((panel) => panel.type === 'regular').id, page.panels[0].id);
  const unavailable = { ...page, layers: page.layers.map((layer) => layer.id === 'panels' ? { ...layer, visible: false } : layer) };
  assert.equal(applyTemplate(unavailable, template.id, 0, [template]), unavailable);
  assert.equal(applyTemplate(page, 'grid-four', 0, [], 'overlays'), page);
});

test('漫画库完整保留页面内容，默认画布尺寸与当前草稿独立保存', async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const records = new Map(['pages', 'templates', 'drafts'].map((name) => [name, new Map()]));
  // 测试浏览器存储边界，记录按结构化克隆写入和读回，不依赖源码字段白名单。
  const database = {
    transaction() {
      const transaction = {
        objectStore(name) {
          const store = records.get(name);
          const read = (value) => {
            const request = {};
            queueMicrotask(() => {
              request.result = structuredClone(value);
              request.onsuccess?.();
            });
            return request;
          };
          return {
            getAll: () => read([...store.values()]),
            get: (id) => read(store.get(id)),
            put: (value) => store.set(value.id, structuredClone(value)),
          };
        },
      };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
  };
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => { request.result = database; request.onsuccess(); });
    return request;
  } };
  try {
    assert.equal((await loadComicLibrary()).canvasDefaults, null);
    const canvasDefaults = { width: 901.5, height: 1603 };
    await saveComicCanvasDefaults(canvasDefaults);
    const page = mixedPage();
    page.elements = [{ ...page.elements[0], rotation: 23, skewX: 14, flipY: true, masks: [{ points: [{ x: 2, y: 4 }], feather: 6 }], sourceAsset: { dataUrl: 'data:image/svg+xml,asset', kind: 'uploaded' } }];
    page.fonts = [{ id: 'font', family: 'Imported font', dataUrl: 'data:font/woff2;base64,saved' }];
    page.extra = { untouched: true };
    const saved = await saveComicPage(page);
    await saveComicDraft(page);
    const library = await loadComicLibrary();
    assert.equal(saved.order, 0);
    assert.deepEqual(library.pages[0].elements, page.elements);
    assert.deepEqual(library.pages[0].fonts, page.fonts);
    assert.deepEqual(library.pages[0].extra, page.extra);
    assert.deepEqual(library.draft, page);
    assert.deepEqual(library.canvasDefaults, canvasDefaults);

    const oldPage = { ...page, id: 'older-page', width: 800, height: 1120 };
    await saveComicDraft(oldPage);
    assert.deepEqual((await loadComicLibrary()).canvasDefaults, canvasDefaults);
    const nextDefaults = { width: 1234, height: 2345 };
    await saveComicCanvasDefaults(nextDefaults);
    const reopened = await loadComicLibrary();
    assert.deepEqual(reopened.canvasDefaults, nextDefaults);
    assert.deepEqual(reopened.draft, oldPage);
    assert.deepEqual(reopened.pages, library.pages);
  } finally {
    globalThis.indexedDB = originalIndexedDB;
  }
});
