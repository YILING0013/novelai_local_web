import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createComicPage, createComicTemplate, fitPanelImage } from './comicDocument.mjs';
import { createComicElement } from './comicElements.mjs';
import { comicBalloonContours } from './comicBalloonPaths.mjs';
import { exportComicProject, readComicProject } from './comicProject.mjs';

const png = 'data:image/png;base64,aW1hZ2U=';
const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="4" cx="5" cy="5"/></svg>').toString('base64')}`;

test('项目保留页面顺序、最新草稿、图层曲线及完整生成任务，素材独立去重打包', async () => {
  const first = createComicPage('portrait');
  const second = createComicPage('spreadPortrait');
  second.title = '第二页';
  const draft = structuredClone(first);
  draft.title = '第一话 · 当前未保存的修改';
  draft.panels[0].image = fitPanelImage(draft.panels[0], { dataUrl: png, width: 100, height: 100 });
  draft.panels[0].task = { savedAt: 123, params: { parameterState: { params: { prompt: '完整参数', seed: 233, imageToImage: { image: png } }, imagePreview: png, characterTabs: [{ enabled: false, prompt: 'character' }] }, promptsByModel: { model: 'prompt' }, vibeImages: [{ dataUrl: png, encoded: 'embedding' }], krea2EditSourceImage: null } };
  draft.layers[1].locked = true;
  draft.layers[2].visible = false;
  draft.fonts.push({ id: 'font-id', family: 'comic-font-id', name: '手写字体', dataUrl: 'data:font/woff2;base64,Zm9udA==' });
  draft.elements.push(createComicElement('bubble', { x: 30, y: 50, width: 200, height: 260 }, { layerId: 'dialogue', order: 3, text: '竖排中文', writingMode: 'vertical-rl', balloonContours: comicBalloonContours('speech'), fontFamily: 'comic-font-id', rotation: 21, skewX: 12, feather: 3, flipX: true }));
  draft.elements.push(createComicElement('sticker', { x: 130, y: 150, width: 100, height: 100 }, { layerId: 'dialogue', order: 4, dataUrl: svg }));
  const templates = [createComicTemplate(draft, 0, '自定义分镜')];
  const blob = await exportComicProject({ pages: [first, second], templates, draft });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entries = Object.keys(zip.files).filter((path) => path.startsWith('assets/') && !zip.files[path].dir);
  assert.equal(entries.length, 3);
  assert.ok(entries.some((path) => path.endsWith('.svg')));
  assert.ok(entries.some((path) => path.endsWith('.woff2')));
  assert.equal((await zip.file('comic-project.json').async('string')).includes(png), false);
  const restored = await readComicProject(blob);
  assert.deepEqual(restored, { pages: [{ ...draft, order: 0 }, { ...second, order: 1 }], templates, activePageId: draft.id });
  assert.equal(first.title, '');
});

test('未保存的新页也导出，导入素材文件与临时预览在原地址失效后仍可使用', async () => {
  const draft = createComicPage();
  const file = new File(['original bytes'], '参考图.png', { type: 'image/png', lastModified: 1234 });
  const other = new Blob(['second bytes'], { type: 'image/webp' });
  const url = URL.createObjectURL(new Blob(['preview'], { type: 'image/png' }));
  draft.panels[0].task = { params: { parameterState: { params: {}, referenceImages: [{ file }, { file: other }], imagePreview: url }, promptsByModel: {}, vibeImages: [] } };
  let blob;
  try { blob = await exportComicProject({ pages: [], templates: [], draft }); } finally { URL.revokeObjectURL(url); }
  const { pages } = await readComicProject(blob);
  assert.equal(pages.length, 1);
  const restored = pages[0].panels[0].task.params.parameterState;
  assert.ok(restored.referenceImages[0].file instanceof File);
  assert.equal(restored.referenceImages[0].file.name, file.name);
  assert.equal(restored.referenceImages[0].file.lastModified, 1234);
  assert.equal(await restored.referenceImages[0].file.text(), 'original bytes');
  assert.equal(await restored.referenceImages[1].file.text(), 'second bytes');
  assert.equal(restored.imagePreview, `data:image/png;base64,${Buffer.from('preview').toString('base64')}`);
});

test('拒绝图片 ZIP、未知项目版本、缺失素材及损坏结构，不返回部分项目', async () => {
  const draft = createComicPage();
  draft.panels[0].image = fitPanelImage(draft.panels[0], { dataUrl: png, width: 100, height: 100 });
  const bytes = await (await exportComicProject({ pages: [], templates: [], draft })).arrayBuffer();
  for (const change of [
    (zip) => zip.remove('comic-project.json'),
    (zip, manifest) => { manifest.version = 999; },
    (zip) => zip.remove('assets/0001.png'),
    (zip, manifest) => { manifest.pages[0].layers = []; },
    (zip, manifest) => { manifest.pages[0].panels[0].points = [{ x: 'bad', y: 1 }]; },
    (zip, manifest) => { manifest.activePageId = 'missing'; },
  ]) {
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('comic-project.json').async('string'));
    change(zip, manifest);
    if (zip.file('comic-project.json')) zip.file('comic-project.json', JSON.stringify(manifest));
    await assert.rejects(readComicProject(await zip.generateAsync({ type: 'uint8array' })));
  }
  await assert.rejects(readComicProject(new Uint8Array([1, 2, 3])));
});
