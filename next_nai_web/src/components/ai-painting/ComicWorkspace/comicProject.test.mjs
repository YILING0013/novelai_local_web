import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { applyTemplate, createComicPage, createComicTemplate, fitPanelImage } from './comicDocument.mjs';
import { applyComicAIImage, buildComicAISections, validateComicAIPlan } from './comicAI.mjs';
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

test('旧尺寸项目与新AI页面可同包导入，保留原图、计划、参考快照和可编辑文本', async (t) => {
  const legacy = { ...createComicPage('spreadPortrait'), width: 1600, height: 1120, panels: [] };
  delete legacy.layoutVersion;
  let oldPage = applyTemplate(legacy, 'blank', 0);
  oldPage = applyTemplate(oldPage, 'blank', 1);
  const reference = createComicPage();
  const sourceInput = { model: 'glm-4-6', inputType: 'story', text: '旅人问候', style: '', language: 'zh', readingDirection: 'ltr', characters: '旅人：银色长发。', sections: buildComicAISections(reference) };
  const plan = { version: 1, summary: '旅人问候', storyDraft: '第一阶段原文：\n旅人在车站挥手，与旧友重逢。', visualStyle: '1.25::artist:example::, watercolor\nsoft morning light', planningModels: { story: 'xialong-v1', extract: 'glm-4-6', format: 'glm-4-6' }, characters: [{ id: 'c1', name: '旅人', appearance: 'silver hair' }], sections: [{
    id: 0, width: 832, height: 1216, characterPromptsComplete: true, globalPrompt: 'comic', negativePrompt: '', panels: [{ id: 'p1', number: 1, summary: '问候' }],
    instances: [{ id: 'i1', panelId: 'p1', characterId: 'c1', prompt: '1girl', negativePrompt: '', center: { x: 0.5, y: 0.5 } }],
    dialogues: [{ id: 'd1', panelId: 'p1', speakerId: 'c1', text: '你好', type: 'speech', order: 1, direction: 'horizontal' }],
  }] };
  const image = { dataUrl: png, width: 832, height: 1216 };
  const text = createComicElement('text', { x: 80, y: 80, width: 100, height: 50 }, { text: '你好' });
  const draft = applyComicAIImage(reference, 0, image, { taskId: 'workflow', textElements: [text] });
  draft.aiWorkflow = { version: 1, id: 'workflow', sourceInput, referenceSnapshot: reference, plan, sections: { '0': {
    status: 'completed', originalImage: image, cleanedImage: image, assignments: { 'text-1': 'd1' },
    result: { sourceHash: 'a'.repeat(64), image: { id: 'gallery-image' }, mask: { id: 'gallery-mask' }, unmatchedDialogueIds: [], blocks: [{
      id: 'text-1', bounds: { x: 48, y: 48, width: 100, height: 50 }, direction: 'horizontal-tb', ocrText: '你号', text: '你好', dialogueId: 'd1',
      needsReview: false, applied: true, reason: null, color: '#111111', fontSize: 24, confidence: 0.9,
    }] },
  } }, updatedAt: 123 };
  const blob = await exportComicProject({ pages: [oldPage], templates: [], draft });
  const result = await readComicProject(blob);
  assert.deepEqual(result.pages[0], { ...oldPage, order: 0 });
  assert.deepEqual(result.pages[1], { ...draft, order: 1 });
  assert.equal(result.pages[1].aiWorkflow.plan.storyDraft, plan.storyDraft);
  assert.equal(result.pages[1].aiWorkflow.plan.visualStyle, plan.visualStyle);
  assert.deepEqual(result.pages[1].aiWorkflow.plan.planningModels, plan.planningModels);
  assert.equal(result.pages[1].aiWorkflow.plan.sections[0].characterPromptsComplete, true);
  await t.test('生成受限的编辑草稿仍可完整导出导入，恢复后生成仍受校验', async () => {
    for (const { change, tooLong } of [
      { change: (section) => { section.dialogues[0].text = '字'.repeat(751); }, tooLong: true },
      { change: (section) => { section.globalPrompt += '\nText: 待整理文字'; }, tooLong: false },
      { change: (section) => { section.instances[0].prompt += ', "你好"'; }, tooLong: false },
    ]) {
      const edited = structuredClone(draft);
      change(edited.aiWorkflow.plan.sections[0]);
      if (tooLong) assert.throws(() => validateComicAIPlan(edited.aiWorkflow.plan));
      else assert.doesNotThrow(() => validateComicAIPlan(edited.aiWorkflow.plan));
      const archive = await exportComicProject({ pages: [oldPage], templates: [], draft: edited });
      const restored = await readComicProject(archive);
      assert.deepEqual(restored.pages[1], { ...edited, order: 1 });
      if (tooLong) assert.throws(() => validateComicAIPlan(restored.pages[1].aiWorkflow.plan));
      else assert.doesNotThrow(() => validateComicAIPlan(restored.pages[1].aiWorkflow.plan));
    }
  });
  const bytes = await blob.arrayBuffer();
  for (const change of [
    (workflow) => { workflow.plan.storyDraft = { content: 'unexpected object' }; },
    (workflow) => { workflow.plan.planningModels = { story: 'xialong-v1', format: null }; },
    (workflow) => { workflow.plan.sections[0].instances[0].center.x = null; },
    (workflow) => { workflow.referenceSnapshot.aiWorkflow = { version: 1 }; },
    (workflow) => { workflow.sections['0'].originalImage.dataUrl = 'https://example.com/image.png'; },
    (workflow) => { workflow.sections['0'].result.blocks[0].bounds.width = -1; },
  ]) {
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('comic-project.json').async('string'));
    change(manifest.pages[1].aiWorkflow);
    zip.file('comic-project.json', JSON.stringify(manifest));
    await assert.rejects(readComicProject(await zip.generateAsync({ type: 'uint8array' })));
  }
});
