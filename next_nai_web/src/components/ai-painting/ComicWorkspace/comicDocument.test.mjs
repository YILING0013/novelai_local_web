import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMIC_LAYOUTS, COMIC_TEMPLATES, applyTemplate, convertPanelType, createComicPage,
  createComicTemplate, createRectanglePanel, fitPanelImage, movePanel, movePanelEdge,
  movePanelVertex, panelBounds, sectionBounds, splitPanel,
} from './comicDocument.mjs';

test('四种版式有正确尺寸，28 个空分镜模板都能在每个半页完整创建', () => {
  assert.equal(COMIC_TEMPLATES.length, 28);
  assert.equal(new Set(COMIC_TEMPLATES.map((template) => JSON.stringify(template.panels))).size, 28);
  for (const [layout, dimensions] of Object.entries(COMIC_LAYOUTS)) {
    for (const template of COMIC_TEMPLATES) {
      const page = createComicPage(layout, template.id);
      assert.equal(page.width, dimensions.width);
      assert.equal(page.height, dimensions.height);
      assert.equal(page.panels.length, template.panels.length * dimensions.sections);
      assert.equal(new Set(page.panels.map((panel) => panel.id)).size, page.panels.length);
      for (const panel of page.panels) {
        const section = sectionBounds(page, panel.section);
        const bounds = panelBounds(panel);
        assert.ok(bounds.width > 12 && bounds.height > 12);
        assert.ok(panel.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
        assert.ok(panel.points.every((point) => point.x >= section.x && point.x <= section.x + section.width && point.y >= section.y && point.y <= section.y + section.height));
        assert.equal(panel.type, 'regular');
        assert.equal(panel.image, null);
        assert.equal(panel.task, null);
      }
    }
  }
});

test('跨页只替换指定半页，保留另一半页内容与跨页叠加框', () => {
  let page = createComicPage('spreadPortrait');
  page.panels[1].task = { params: { prompt: 'right panel' } };
  const rightPanel = page.panels[1];
  const overlay = createRectanglePanel(page, -1, { x: 500, y: 200 }, { x: 1100, y: 600 });
  page = { ...page, panels: [...page.panels, overlay] };
  const changed = applyTemplate(page, 'grid-four', 0);
  assert.equal(changed.panels.filter((panel) => panel.section === 0).length, 4);
  assert.equal(changed.panels.find((panel) => panel.id === rightPanel.id), rightPanel);
  assert.equal(changed.panels.at(-1), overlay);
  assert.equal(page.panels.length, 3);
});

test('直线切割产生两块留白画框，图像保持对齐，任务和旧编号不会复制', () => {
  const panel = createComicPage().panels[0];
  panel.image = fitPanelImage(panel, { dataUrl: 'data:image/png;base64,test', width: 1000, height: 800 });
  panel.task = { params: { prompt: 'scene' } };
  const original = structuredClone(panel);
  const halves = splitPanel(panel, { x: 400, y: 0 }, { x: 400, y: 1120 }, 14);
  assert.equal(halves.length, 2);
  assert.ok(halves.every((half) => half.id !== panel.id));
  assert.notEqual(halves[0].id, halves[1].id);
  assert.deepEqual(panel, original);
  const [left, right] = halves.sort((a, b) => panelBounds(a).x - panelBounds(b).x);
  assert.equal(panelBounds(left).x + panelBounds(left).width, 393);
  assert.equal(panelBounds(right).x, 407);
  for (const half of halves) {
    assert.deepEqual(half.image, panel.image);
    assert.notEqual(half.image, panel.image);
    assert.equal(half.task, null);
  }
});

test('经过两个角的斜切可生成三角框，后续继续切割仍保持有效顶点', () => {
  const panel = createComicPage().panels[0];
  const halves = splitPanel(panel, panel.points[0], panel.points[2], 0);
  assert.deepEqual(halves.map((half) => half.points.length), [3, 3]);
  for (const half of halves) {
    const bounds = panelBounds(half);
    const split = splitPanel(half, { x: bounds.x, y: bounds.y + bounds.height / 2 }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 });
    assert.equal(split.length, 2);
    assert.ok(split.every((result) => result.points.length >= 3));
  }
  assert.equal(splitPanel(panel, { x: 0, y: 0 }, { x: 0, y: 1120 }), null);
  assert.equal(splitPanel(panel, { x: 40, y: 0 }, { x: 40, y: 1120 }), null);
  assert.equal(splitPanel(panel, panel.points[0], panel.points[0]), null);
});

test('拖拽矩形和顶点限制在所属半页，交叉边与零面积画框被拒绝', () => {
  const page = createComicPage('spreadPortrait');
  const bounds = sectionBounds(page, 1);
  const panel = createRectanglePanel(page, 1, { x: 600, y: -20 }, { x: 1900, y: 1200 });
  assert.deepEqual(panelBounds(panel), bounds);
  assert.equal(createRectanglePanel(page, 1, { x: 900, y: 200 }, { x: 906, y: 204 }), null);
  const moved = movePanelVertex(panel, 0, { x: 750, y: 180 }, bounds);
  assert.deepEqual(moved.points[0], { x: 800, y: 180 });
  assert.equal(movePanelVertex(panel, 0, { x: 1600, y: 1120 }, bounds), panel);
  const movedEdge = movePanelEdge(panel, 0, { x: 0, y: 100 }, bounds);
  assert.deepEqual(movedEdge.points.slice(0, 2), [{ x: 800, y: 100 }, { x: 1600, y: 100 }]);
  assert.equal(movePanelEdge(panel, 0, { x: 0, y: 1120 }, bounds), panel);
});

test('叠加框可跨越跨页中线且初始无边框，独立保留透明图像源', () => {
  const page = createComicPage('spreadLandscape');
  const panel = createRectanglePanel(page, -1, { x: 100, y: 600 }, { x: 1000, y: 1100 });
  assert.equal(panel.type, 'overlay');
  assert.equal(panel.borderWidth, 0);
  assert.equal(panel.section, -1);
  assert.deepEqual(sectionBounds(page, -1), { x: 0, y: 0, width: 1120, height: 1600 });
  const source = { dataUrl: 'data:image/png;base64,transparent', width: 900, height: 500 };
  assert.deepEqual(fitPanelImage(panel, source), { ...source, x: 100, y: 600, scale: 1 });
});

test('整体拖动画框保留凸形、编号和任务，图像同步移动且原对象不变', () => {
  const page = createComicPage('spreadPortrait');
  const bounds = sectionBounds(page, 1);
  const rectangle = createRectanglePanel(page, 1, { x: 900, y: 150 }, { x: 1250, y: 500 });
  const panel = movePanelVertex(rectangle, 0, { x: 930, y: 185 }, bounds);
  panel.image = fitPanelImage(panel, { dataUrl: 'original-image', width: 800, height: 600 });
  panel.task = { params: { prompt: 'keep task' } };
  const original = structuredClone(panel);
  const moved = movePanel(panel, { x: 50, y: 80 }, bounds);
  assert.deepEqual(panel, original);
  assert.equal(moved.id, panel.id);
  assert.equal(moved.task, panel.task);
  assert.deepEqual(moved.points, panel.points.map((point) => ({ x: point.x + 50, y: point.y + 80 })));
  assert.deepEqual(moved.image, { ...panel.image, x: panel.image.x + 50, y: panel.image.y + 80 });
  assert.equal(splitPanel(moved, { x: 1100, y: 0 }, { x: 1100, y: 1120 }).length, 2);
});

test('整体移动在半页边缘停止，不压扁画框；叠加框可越过中线但不越过整页', () => {
  const page = createComicPage('spreadPortrait');
  const panel = createRectanglePanel(page, 1, { x: 900, y: 150 }, { x: 1250, y: 500 });
  const bounds = sectionBounds(page, 1);
  const bottomRight = movePanel(panel, { x: 5000, y: 5000 }, bounds);
  assert.deepEqual(panelBounds(bottomRight), { x: 1250, y: 770, width: 350, height: 350 });
  assert.equal(movePanel(bottomRight, { x: 10, y: 10 }, bounds), bottomRight);
  const topLeft = movePanel(panel, { x: -5000, y: -5000 }, bounds);
  assert.deepEqual(panelBounds(topLeft), { x: 800, y: 0, width: 350, height: 350 });
  assert.equal(movePanel(panel, { x: 0, y: 0 }, bounds), panel);

  const overlay = createRectanglePanel(page, -1, { x: 700, y: 100 }, { x: 900, y: 300 });
  const movedOverlay = movePanel(overlay, { x: 100, y: 0 }, sectionBounds(page, -1));
  assert.deepEqual(panelBounds(movedOverlay), { x: 800, y: 100, width: 200, height: 200 });
  assert.equal(movedOverlay.section, -1);
  assert.deepEqual(panelBounds(movePanel(overlay, { x: 5000, y: -5000 }, sectionBounds(page, -1))), { x: 1400, y: 0, width: 200, height: 200 });
});

test('图片按外接矩形居中铺满，保留完整原图以便再次裁剪', () => {
  const page = createComicPage();
  const panel = createRectanglePanel(page, 0, { x: 100, y: 200 }, { x: 500, y: 500 });
  const image = fitPanelImage(panel, { dataUrl: 'data:image/png;base64,test', width: 800, height: 800 });
  assert.equal(image.scale, 0.5);
  assert.equal(image.x, 100);
  assert.equal(image.y, 150);
  assert.equal(image.width, 800);
  assert.equal(image.height, 800);
});

test('跨页叠加框转回普通框时裁入目标半页，完全落在另一页时不转换', () => {
  const page = createComicPage('spreadPortrait');
  const overlay = createRectanglePanel(page, -1, { x: 600, y: 100 }, { x: 1100, y: 900 });
  const converted = convertPanelType(overlay, 'regular', page, 0);
  assert.equal(converted.type, 'regular');
  assert.equal(converted.section, 0);
  assert.deepEqual(panelBounds(converted), { x: 600, y: 100, width: 200, height: 800 });
  const rightOnly = createRectanglePanel(page, -1, { x: 950, y: 200 }, { x: 1200, y: 500 });
  assert.equal(convertPanelType(rightOnly, 'regular', page, 0), null);
  const restored = convertPanelType(converted, 'overlay', page, 0);
  assert.equal(restored.section, -1);
  assert.deepEqual(restored.points, converted.points);
});

test('模板保留叠加框类型，同页回套及重复套用都不会复制叠加框', () => {
  let page = createComicPage('portrait');
  const overlay = createRectanglePanel(page, -1, { x: 100, y: 200 }, { x: 500, y: 1000 });
  page = { ...page, panels: [...page.panels, overlay] };
  const template = createComicTemplate(page, 0, '叠加模板');
  assert.equal(template.panels.length, 2);
  assert.equal(template.panels[1].type, 'overlay');
  assert.equal(template.panels[1].sourcePanelId, overlay.id);
  const applied = applyTemplate(page, template.id, 0, [template]);
  assert.equal(applied.panels.length, 2);
  assert.equal(applied.panels[1].templateSection, 0);
  assert.equal(applied.panels[1].section, -1);
  for (const [key, value] of Object.entries(panelBounds(overlay))) assert.ok(Math.abs(panelBounds(applied.panels[1])[key] - value) < 0.00001);
  const repeated = applyTemplate(applied, template.id, 0, [template]);
  assert.equal(repeated.panels.length, 2);
  assert.equal(applyTemplate(repeated, 'blank').panels.length, 1);
});

test('跨页叠加框保存为半页模板时只替换该半页，另一半页仍保留原图', () => {
  let page = createComicPage('spreadPortrait');
  const overlay = createRectanglePanel(page, -1, { x: 600, y: 100 }, { x: 1100, y: 900 });
  overlay.image = { dataUrl: 'original-alpha' };
  page = { ...page, panels: [...page.panels, overlay] };
  const template = createComicTemplate(page, 0, '跨页模板');
  const applied = applyTemplate(page, template.id, 0, [template]);
  const retained = applied.panels.find((panel) => panel.id === overlay.id);
  assert.equal(retained.image.dataUrl, 'original-alpha');
  assert.deepEqual(panelBounds(retained), { x: 800, y: 100, width: 300, height: 800 });
  const imported = applied.panels.find((panel) => panel.templateSection === 0);
  assert.deepEqual(panelBounds(imported), { x: 600, y: 100, width: 200, height: 800 });
  assert.equal(imported.image, null);
});

test('自定义模板只保存分镜形状，重新套用不叠加沟槽且不泄露任务或图像', () => {
  const original = createComicPage('spreadLandscape', 'diagonal-opening');
  original.panels[3].image = { dataUrl: 'private-image' };
  original.panels[3].task = { params: { prompt: 'private-prompt' } };
  const template = createComicTemplate(original, 1, '我的模板');
  assert.equal(template.panels.length, 3);
  assert.equal(JSON.stringify(template).includes('private-'), false);
  assert.equal(template.name.zh, '我的模板');
  const restored = applyTemplate(createComicPage('spreadLandscape'), template.id, 1, [template]);
  const actual = restored.panels.filter((panel) => panel.section === 1);
  const expected = original.panels.filter((panel) => panel.section === 1);
  for (let index = 0; index < actual.length; index += 1) {
    for (let vertex = 0; vertex < actual[index].points.length; vertex += 1) {
      assert.ok(Math.abs(actual[index].points[vertex].x - expected[index].points[vertex].x) < 0.00001);
      assert.ok(Math.abs(actual[index].points[vertex].y - expected[index].points[vertex].y) < 0.00001);
    }
    assert.equal(actual[index].image, null);
    assert.equal(actual[index].task, null);
  }
});
