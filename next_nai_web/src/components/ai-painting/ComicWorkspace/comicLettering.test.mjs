import assert from 'node:assert/strict';
import test from 'node:test';
import { createComicPage } from './comicDocument.mjs';
import { comicElementSvg, createComicElement, fitComicTextFontSize } from './comicElements.mjs';
import { buildComicLetteringElements } from './comicLettering.mjs';

test('只重建已去字的对白，按真实原图像素放回目标区，不使用参考分镜裁切', () => {
  const page = createComicPage('spreadPortrait', 'grid-four');
  const original = structuredClone(page);
  const image = { width: 608, height: 416 };
  const block = { id: 'text-1', applied: true, bounds: { x: 40, y: 30, width: 80, height: 50 }, text: '准确对白', color: '#123456', direction: 'vertical-rl', dialogueId: 'd1' };
  const result = { blocks: [block, { ...block, id: 'text-review', applied: false, text: '尚未清理，不能叠字' }] };
  const elements = buildComicLetteringElements(page, 1, image, result);
  assert.deepEqual(page, original);
  assert.equal(elements.length, 1);
  const [element] = elements;
  assert.deepEqual([element.x, element.y, element.width, element.height], [1392, 92, 160, 100]);
  assert.equal(element.text, '准确对白');
  assert.equal(element.writingMode, 'vertical-rl');
  assert.equal(element.color, '#123456');
  assert.equal(element.dialogueId, 'd1');
  assert.equal(element.comicTextBlockId, 'text-1');
  assert.equal(element.fill, 'none');
  assert.match(comicElementSvg(element), /准确对白|准确/);
});

test('气泡内部排版框优先于擦除框，位置和字号按实际可用内框计算', () => {
  const page = createComicPage('spreadPortrait');
  const image = { width: 608, height: 416 };
  const block = { id: 'text-layout', applied: true, bounds: { x: 40, y: 30, width: 80, height: 50 },
    text: '这是一段需要放在气泡内部的完整对白', direction: 'horizontal-tb', dialogueId: 'd1' };
  const [legacy] = buildComicLetteringElements(page, 1, image, { blocks: [block] });
  const [inside] = buildComicLetteringElements(page, 1, image, { blocks: [{ ...block, layoutBounds: { x: 45, y: 40, width: 40, height: 30 } }] });
  assert.deepEqual([inside.x, inside.y, inside.width, inside.height], [1402, 112, 80, 60]);
  assert.equal(inside.text, block.text);
  assert.ok(inside.fontSize < legacy.fontSize, '更小的气泡内框必须按可用区域缩字');
  assert.deepEqual(block.bounds, { x: 40, y: 30, width: 80, height: 50 }, '排版不改写原擦除框');
});

test('横排自动缩字保留整段对白和手动换行，最终排版不超出文字框', () => {
  const element = createComicElement('text', { x: 0, y: 0, width: 100, height: 70 }, { text: '这是一段需要自动缩小字号的对白。\n保留下一行。', lineHeight: 1.15 });
  const source = structuredClone(element);
  const size = fitComicTextFontSize(element, 32);
  assert.ok(size >= 1 && size < 32);
  assert.deepEqual(element, source);
  const svg = comicElementSvg({ ...element, fontSize: size });
  const lines = [...svg.matchAll(/<tspan x="([^"]+)" y="([^"]+)"[^>]*>(.*?)<\/tspan>/g)];
  assert.equal(lines.map((line) => line[3]).join(''), element.text.replace('\n', ''));
  assert.ok(lines.length * size * element.lineHeight <= element.height * 0.92);
  assert.ok(lines.every((line) => Number(line[2]) > 0 && Number(line[2]) < element.height));
});

test('竖排自动缩字兼容组合字符，重建后仍保留从右向左的独立文字列', () => {
  const element = createComicElement('text', { x: 0, y: 0, width: 65, height: 80 }, { text: '甲👩‍🎨乙丙丁戊己庚辛壬癸\n新段', writingMode: 'vertical-rl', lineHeight: 1.15 });
  element.fontSize = fitComicTextFontSize(element, 32);
  assert.ok(element.fontSize < 32);
  const svg = comicElementSvg(element);
  const columns = [...svg.matchAll(/<tspan x="([^"]+)" y="([^"]+)"[^>]*>(.*?)<\/tspan>/g)];
  assert.equal(columns.map((column) => column[3]).join(''), element.text.replace('\n', ''));
  assert.ok(columns.some((column) => column[3].includes('👩‍🎨')));
  assert.ok(columns.every((column, index) => index === 0 || Number(columns[index - 1][1]) > Number(column[1])));
  assert.ok(columns.length * element.fontSize * element.lineHeight <= element.width * 0.92);
});
