import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { applyImageParametersToUI } from '../../utils/parameterMapping.js';
import { buildNovelAIImageRequestParams } from '../../utils/novelAIRequestParams.mjs';

const require = createRequire(import.meta.url);
const { parseMetadataCandidates, parseNovelAIMetadata } = require('./metadataParserCore.js');
const { transformSync } = require('next/dist/build/swc');
const { code } = transformSync(readFileSync(new URL('./MetadataDialog.js', import.meta.url), 'utf8')
  .replace('import.meta.url', JSON.stringify(new URL('./MetadataDialog.js', import.meta.url).href)), {
  filename: 'MetadataDialog.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' },
});

function mount(initialProps, readMetadata = async () => null) {
  let props = { open: true, onClose() {}, onApply() {}, ...initialProps };
  const slots = [];
  const revoked = [];
  const workers = [];
  const copied = [];
  const saved = [];
  let cursor = 0, dirty = false, effects = [];
  const hooks = { ...React,
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = initial;
      return [slots[id], next => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; dirty = true; }];
    },
    useEffect(effect, deps) {
      const id = cursor++, previous = slots[id];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[id] = { deps, cleanup: effect() }; });
      }
    },
    useRef(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = { current: initial };
      return slots[id];
    },
  };
  class MockWorker {
    constructor() { workers.push(this); }
    postMessage(message) { this.lastMessage = message; }
    terminate() { this.terminated = true; }
  }
  const exports = {};
  class TestURL extends URL {
    static createObjectURL(file) { return 'blob:' + file.name; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  runInNewContext(code, { exports, React: hooks, File, Worker: MockWorker, URL: TestURL,
    window: {}, ClipboardItem: class { constructor(items) { this.items = items; } },
    navigator: { clipboard: { write: async ([item]) => copied.push(await item.items['image/png']) } },
    require: name => name === 'react' ? hooks : ['@mui/material', '@mui/icons-material'].includes(name) ? new Proxy({}, { get: (_, key) => key })
      : name === '@mui/material/styles' ? { alpha: value => value }
      : name.includes('InlinePromptInput') ? { __esModule: true, default: 'InlinePromptInput' }
      : name === 'file-saver' ? { saveAs: async (...args) => saved.push(args) }
      : name.endsWith('/metadataUtils') ? { extractMetadataFromFile: readMetadata }
      : name.includes('/utils/') ? require(name.endsWith('.mjs') ? name : name + '.js')
      : { useI18n: () => ({ t: key => key }) },
  });
  return {
    revoked, workers, copied, saved, setProps(next) { props = { ...props, ...next }; },
    render() {
      for (let pass = 0; pass < 5; pass++) {
        cursor = 0; dirty = false; effects = [];
        const tree = exports.default(props);
        effects.forEach(effect => effect());
        if (!dirty) return tree;
      }
      assert.fail('导入面板应稳定渲染');
    },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const applyButton = tree => nodes(tree).find(node => node.type === 'Button' && node.props.variant === 'contained');
const field = (tree, key) => nodes(tree).find(node => node.props?.['data-metadata-field'] === key);
const toolsToggle = tree => nodes(tree).find(node => node.type === 'ToggleButton' && node.props.value === 'imageTools');
const imageButton = (tree, id) => nodes(tree).find(node => node.type === 'Button' && node.props.children === `painting.tools.metadata.${id}`);
const fixture = { width: 1024, height: 1024, steps: 14, guidanceScale: 7, seed: 0, smea: false, promptGuidanceRescale: 0,
  positivePrompt: 'original positive', negativePrompt: 'original negative', characterTabs: [{ prompt: 'character one', uc: 'character negative', position: 'C3' }] };

test('直接展示元数据，提示词和角色在前，生成参数和 Seed 默认不导入', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  const tree = page.render();
  assert.equal(nodes(tree).filter(node => node.type === 'Dialog').length, 1);
  assert.doesNotMatch(JSON.stringify(tree), /viewMetadata|backToImageActions/);
  assert.deepEqual(nodes(tree).filter(node => node.props?.['data-metadata-field']).slice(0, 4).map(node => node.props['data-metadata-field']), ['positivePrompt', 'negativePrompt', 'character_0', 'model']);
  assert.equal(nodes(field(tree, 'positivePrompt')).find(node => node.type === 'InlinePromptInput').props.value, fixture.positivePrompt);
  applyButton(tree).props.onClick();
  assert.deepEqual(Object.keys(result).sort(), ['characterTabs', 'negativePrompt', 'positivePrompt']);
});

test('编辑提示词和角色后导入修改值，原始元数据保持不变', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  let tree = page.render();
  nodes(field(tree, 'positivePrompt')).find(node => node.type === 'InlinePromptInput').props.onChange({ target: { value: 'edited positive' } });
  tree = page.render();
  nodes(field(tree, 'character_0')).find(node => node.type === 'InlinePromptInput').props.onChange({ target: { value: 'edited character' } });
  applyButton(page.render()).props.onClick();
  assert.equal(result.positivePrompt, 'edited positive');
  assert.equal(result.characterTabs[0].prompt, 'edited character');
  assert.equal(fixture.positivePrompt, 'original positive');
  assert.equal(fixture.characterTabs[0].prompt, 'character one');
});

test('点击参数卡片取消导入，单独激活并编辑一个数字参数', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  field(page.render(), 'negativePrompt').props.onClick();
  field(page.render(), 'size').props.onClick();
  nodes(field(page.render(), 'size')).find(node => node.type === 'TextField').props.onChange({ target: { value: '1216' } });
  applyButton(page.render()).props.onClick();
  assert.equal(result.width, 1216);
  assert.equal(Object.hasOwn(result, 'negativePrompt'), false);
  assert.equal(result.height, 832);
  assert.equal(Object.hasOwn(result, 'seed'), false);
});

test('全选保留零值与 false，取消全选后不能导入', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('selectAll')).props.onClick();
  applyButton(page.render()).props.onClick();
  assert.equal(result.seed, 0);
  assert.equal(result.smea, false);
  assert.equal(result.promptGuidanceRescale, 0);
  nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('deselectAll')).props.onClick();
  assert.equal(applyButton(page.render()).props.disabled, true);
});

test('可以将 NovelAI 图片中的多样性和额外设置勾选导入生成请求', () => {
  const metadata = parseMetadataCandidates([
    { keyword: 'Source', text: 'NovelAI Diffusion V4.5 Full' },
    { keyword: 'Comment', text: JSON.stringify({
      prompt: 'a garden', skip_cfg_above_sigma: 19.34, dynamic_thresholding: true,
      legacy: true, v4_negative_prompt: { legacy_uc: true }, legacy_v3_extend: true,
      prefer_brownian: false, deliberate_euler_ancestral_bug: true,
    }) },
  ]);
  const params = { model: 'nai-diffusion-4-5-full', variety: false, decrisp: false, prefer_brownian: true };
  const current = { ...params };
  const page = mount({ params, metadata, onApply: (data) => {
    applyImageParametersToUI(data, { handleParamChange: (key, value) => { current[key] = value; } });
  } });

  applyButton(page.render()).props.onClick();
  assert.deepEqual(current, params);
  const switches = { variety: true, decrisp: true, legacy: true, legacy_uc: true, legacy_v3_extend: true,
    prefer_brownian: false, deliberate_euler_ancestral_bug: true };
  for (const [key, enabled] of Object.entries(switches)) {
    const card = field(page.render(), key);
    assert.equal(nodes(card).find(node => node.type === 'Switch')?.props.checked, enabled, key);
    card.props.onClick();
  }
  applyButton(page.render()).props.onClick();
  const request = buildNovelAIImageRequestParams(current, false);
  for (const [key, enabled] of Object.entries(switches)) assert.equal(request[key], enabled, key);
});

test('显式关闭可以导入，图片缺少多样性字段时没有该导入选项', () => {
  const params = { model: 'nai-diffusion-4-5-full', variety: true };
  let result;
  const page = mount({ params, onApply: data => { result = data; }, metadata: parseNovelAIMetadata({
    Comment: JSON.stringify({ prompt: 'a garden', skip_cfg_above_sigma: null }),
  }) });
  const card = field(page.render(), 'variety');
  assert.equal(nodes(card).find(node => node.type === 'Switch')?.props.checked, false);
  card.props.onClick();
  applyButton(page.render()).props.onClick();
  assert.equal(result.variety, false);

  page.setProps({ metadata: parseNovelAIMetadata({ prompt: 'a garden' }) });
  assert.equal(field(page.render(), 'variety'), undefined);
});

test('勾选支持多样性的源模型后才显示对应的导入选项', () => {
  const params = { model: 'nai-diffusion-5-full' };
  const page = mount({ params, metadata: { model: 'nai-diffusion-4-5-full', variety: true } });
  assert.ok(field(page.render(), 'variety'));
  field(page.render(), 'model').props.onClick();
  assert.equal(field(page.render(), 'variety'), undefined);
  field(page.render(), 'model').props.onClick();
  assert.equal(nodes(field(page.render(), 'variety')).find(node => node.type === 'Switch').props.checked, true);
});

test('普通图片无元数据时仍能选择用途，只关闭一次并释放预览地址', () => {
  let closes = 0;
  const actions = [], page = mount({ imageFile: { name: 'ordinary.png', size: 1024 }, metadata: null,
    imageActions: ['img2img', 'vibe', 'reference', 'inpaint', 'editor'], onUseImage: action => actions.push(action), onClose: () => closes++ });
  page.render();
  page.workers[0].onmessage({ data: { suspected: false } });
  const tree = page.render();
  assert.equal(nodes(tree).some(node => Object.hasOwn(node.props, 'data-metadata-scroll')), false);
  nodes(tree).find(node => node.type === 'Button' && node.props.children.endsWith('useImage.vibe')).props.onClick();
  assert.deepEqual(actions, ['vibe']);
  nodes(tree).find(node => node.type === 'IconButton').props.onClick();
  assert.equal(closes, 1);
  page.setProps({ open: false }); page.render();
  assert.deepEqual(page.revoked, ['blob:ordinary.png']);
  assert.equal(page.workers[0].terminated, true);
});

test('拖入混淆图时锁定扳手，成功后恢复原有用途并重读输出图元数据', async () => {
  const file = new File(['source'], 'example.jpg', { type: 'image/jpeg' });
  const calls = [];
  const reads = [];
  const page = mount({ imageFile: file, metadata: fixture, imageActions: ['img2img'], onUseImage: (...args) => calls.push(args) },
    async input => { reads.push(input); return { positivePrompt: 'restored metadata' }; });
  page.render();
  const worker = page.workers[0];
  worker.onmessage({ data: { suspected: true } });
  const scrambled = page.render();
  assert.equal(toolsToggle(scrambled).props.disabled, true);
  assert.equal(toolsToggle(scrambled).props.selected, true);
  assert.equal(imageButton(scrambled, 'useImage.img2img'), undefined);
  assert.equal(field(scrambled, 'positivePrompt'), undefined);
  assert.match(JSON.stringify(scrambled), /possibleScramble/);
  imageButton(scrambled, 'unscramble').props.onClick();
  assert.equal(worker.lastMessage.direction, 'unscramble');
  worker.onmessage({ data: { blob: new Blob(['wrong']), suspected: true } });
  assert.match(JSON.stringify(page.render()), /scrambleDirectionTip/);
  imageButton(page.render(), 'scramble').props.onClick();
  assert.equal(worker.lastMessage.direction, 'scramble');
  worker.onmessage({ data: { blob: new Blob(['restored']), suspected: false } });
  const restored = page.render();
  assert.doesNotMatch(JSON.stringify(restored), /scrambleDirectionTip/);
  assert.equal(toolsToggle(restored).props.disabled, false);
  assert.equal(toolsToggle(restored).props.selected, false);
  assert.match(JSON.stringify(restored), /readingInformation/);
  await Promise.resolve();
  const withMetadata = page.render();
  assert.equal(reads.length, 1);
  assert.match(JSON.stringify(field(withMetadata, 'positivePrompt')), /restored metadata/);
  imageButton(withMetadata, 'useImage.img2img').props.onClick();
  assert.equal(calls[0][1].name, 'example.png');
  assert.equal(calls[0][1], reads[0]);
  assert.equal(await calls[0][1].text(), 'restored');
});

test('普通图片手动打开扳手后的两种变换都不显示多次处理提示', () => {
  for (const direction of ['scramble', 'unscramble']) {
    const page = mount({ imageFile: new File(['source'], 'ordinary.png'), imageActions: ['img2img', 'inpaint', 'vibe', 'editor'] });
    page.render();
    const worker = page.workers[0];
    worker.onmessage({ data: { suspected: false } });
    const ordinary = page.render();
    const row = nodes(ordinary).find(node => Object.hasOwn(node.props, 'data-image-purpose-actions'));
    assert.equal(row.props.sx.flexWrap, 'wrap');
    assert.equal(row.props.children.length, 4);
    assert.ok(row.props.children.every(button => button.props.size === 'small'));
    assert.equal(toolsToggle(ordinary).props.selected, false);
    toolsToggle(ordinary).props.onChange();
    assert.equal(toolsToggle(page.render()).props.selected, true);
    imageButton(page.render(), direction).props.onClick();
    assert.equal(worker.lastMessage.direction, direction);
    worker.onmessage({ data: { blob: new Blob(['changed']), suspected: true } });
    const changed = page.render();
    assert.equal(toolsToggle(changed).props.disabled, false);
    assert.doesNotMatch(JSON.stringify(changed), /scrambleDirectionTip/);
  }
});

test('复制和保存使用当前预览的 PNG 文件', async () => {
  const page = mount({ imageFile: new File(['source'], '样图.jpg', { type: 'image/jpeg' }) });
  page.render();
  page.workers[0].onmessage({ data: { blob: new Blob(['result']), suspected: false } });
  const tree = page.render();
  const button = label => nodes(tree).find(node => node.type === 'IconButton' && node.props['aria-label'].endsWith(label));
  await button('copyImage').props.onClick();
  await button('saveImage').props.onClick();
  assert.equal(await page.copied[0].text(), 'result');
  assert.equal(page.saved[0][0], page.copied[0]);
  assert.equal(page.saved[0][1], '样图.png');
});

test('只导入选中的角色，并支持把已有提示词编辑为空', () => {
  let result;
  const page = mount({ metadata: { ...fixture, characterTabs: [...fixture.characterTabs, { prompt: 'second' }] }, onApply: data => { result = data; } });
  field(page.render(), 'character_1').props.onClick();
  nodes(field(page.render(), 'positivePrompt')).find(node => node.type === 'InlinePromptInput').props.onChange({ target: { value: '' } });
  applyButton(page.render()).props.onClick();
  assert.equal(result.characterTabs.length, 1);
  assert.equal(result.positivePrompt, '');
});

test('读取完成后呈现元数据，重新打开时恢复原始内容与默认选择', () => {
  const file = { name: 'incoming.png', size: 1000 };
  const page = mount({ imageFile: file, metadata: null, reading: true });
  assert.match(JSON.stringify(page.render()), /readingInformation/);
  page.setProps({ metadata: fixture, reading: false });
  nodes(field(page.render(), 'positivePrompt')).find(node => node.type === 'InlinePromptInput').props.onChange({ target: { value: 'edited' } });
  page.setProps({ open: false }); page.render();
  page.setProps({ open: true });
  assert.equal(nodes(field(page.render(), 'positivePrompt')).find(node => node.type === 'InlinePromptInput').props.value, fixture.positivePrompt);
});


test('选定用途后先清空文件再关闭弹窗，不会因旧预览读取空文件导致页面白屏', () => {
  const page = mount({ imageFile: { name: 'preview.png', size: 100 }, metadata: fixture });
  page.render();
  page.setProps({ open: false, imageFile: null, metadata: null });
  assert.doesNotThrow(() => page.render());
  assert.deepEqual(page.revoked, ['blob:preview.png']);
});
