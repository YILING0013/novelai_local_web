import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { code } = transformSync(readFileSync(new URL('./MetadataDialog.js', import.meta.url), 'utf8'), {
  filename: 'MetadataDialog.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' },
});

function mount(initialProps) {
  let props = { open: true, onClose() {}, onApply() {}, ...initialProps };
  const slots = [];
  const revoked = [];
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
  };
  const exports = {};
  runInNewContext(code, { exports, React: hooks,
    URL: { createObjectURL: file => 'blob:' + file.name, revokeObjectURL: url => revoked.push(url) },
    require: name => name === 'react' ? hooks : ['@mui/material', '@mui/icons-material'].includes(name) ? new Proxy({}, { get: (_, key) => key })
      : { useI18n: () => ({ t: key => key }) },
  });
  return {
    revoked, setProps(next) { props = { ...props, ...next }; },
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
const fixture = { width: 1024, height: 1024, steps: 14, guidanceScale: 7, seed: 0, smea: false, promptGuidanceRescale: 0,
  positivePrompt: 'original positive', negativePrompt: 'original negative', characterTabs: [{ prompt: 'character one', uc: 'character negative', position: 'C3' }] };

test('直接展示元数据，提示词和角色在前，生成参数和 Seed 默认不导入', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  const tree = page.render();
  assert.equal(nodes(tree).filter(node => node.type === 'Dialog').length, 1);
  assert.doesNotMatch(JSON.stringify(tree), /viewMetadata|backToImageActions/);
  assert.deepEqual(nodes(tree).filter(node => node.props?.['data-metadata-field']).slice(0, 4).map(node => node.props['data-metadata-field']), ['positivePrompt', 'negativePrompt', 'character_0', 'width']);
  assert.equal(nodes(field(tree, 'positivePrompt')).find(node => node.type === 'TextField').props.value, fixture.positivePrompt);
  applyButton(tree).props.onClick();
  assert.deepEqual(Object.keys(result).sort(), ['characterTabs', 'negativePrompt', 'positivePrompt']);
});

test('编辑提示词和角色后导入修改值，原始元数据保持不变', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  let tree = page.render();
  nodes(field(tree, 'positivePrompt')).find(node => node.type === 'TextField').props.onChange({ target: { value: 'edited positive' } });
  tree = page.render();
  nodes(field(tree, 'character_0')).find(node => node.type === 'TextField').props.onChange({ target: { value: 'edited character' } });
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
  field(page.render(), 'width').props.onClick();
  nodes(field(page.render(), 'width')).find(node => node.type === 'TextField').props.onChange({ target: { value: '1216' } });
  applyButton(page.render()).props.onClick();
  assert.equal(result.width, 1216);
  assert.equal(Object.hasOwn(result, 'negativePrompt'), false);
  assert.equal(Object.hasOwn(result, 'height'), false);
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

test('普通图片无元数据时仍能选择用途，只关闭一次并释放预览地址', () => {
  let closes = 0;
  const actions = [], page = mount({ imageFile: { name: 'ordinary.png', size: 1024 }, metadata: null,
    imageActions: ['img2img', 'vibe', 'reference', 'inpaint', 'editor'], onUseImage: action => actions.push(action), onClose: () => closes++ });
  const tree = page.render();
  assert.match(JSON.stringify(tree), /painting.tools.metadata.noMetadata/);
  nodes(tree).find(node => node.type === 'Button' && node.props.children.endsWith('useImage.vibe')).props.onClick();
  assert.deepEqual(actions, ['vibe']);
  nodes(tree).find(node => node.type === 'IconButton').props.onClick();
  assert.equal(closes, 1);
  page.setProps({ open: false }); page.render();
  assert.deepEqual(page.revoked, ['blob:ordinary.png']);
});

test('只导入选中的角色，并支持把已有提示词编辑为空', () => {
  let result;
  const page = mount({ metadata: { ...fixture, characterTabs: [...fixture.characterTabs, { prompt: 'second' }] }, onApply: data => { result = data; } });
  field(page.render(), 'character_1').props.onClick();
  nodes(field(page.render(), 'positivePrompt')).find(node => node.type === 'TextField').props.onChange({ target: { value: '' } });
  applyButton(page.render()).props.onClick();
  assert.equal(result.characterTabs.length, 1);
  assert.equal(result.positivePrompt, '');
});

test('读取完成后呈现元数据，重新打开时恢复原始内容与默认选择', () => {
  const file = { name: 'incoming.png', size: 1000 };
  const page = mount({ imageFile: file, metadata: null, reading: true });
  assert.match(JSON.stringify(page.render()), /readingInformation/);
  page.setProps({ metadata: fixture, reading: false });
  nodes(field(page.render(), 'positivePrompt')).find(node => node.type === 'TextField').props.onChange({ target: { value: 'edited' } });
  page.setProps({ open: false }); page.render();
  page.setProps({ open: true });
  assert.equal(nodes(field(page.render(), 'positivePrompt')).find(node => node.type === 'TextField').props.value, fixture.positivePrompt);
});
