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
const checkbox = (tree, name) => nodes(tree).find(node => node.type === 'FormControlLabel' && (typeof node.props.label === 'string' ? node.props.label : (node.props.label.props.children ?? '')).endsWith(name)).props.control;
const applyButton = tree => nodes(tree).find(node => node.type === 'Button' && node.props.variant === 'contained');
const fixture = { width: 1024, height: 1024, steps: 14, guidanceScale: 7, seed: 0, smea: false, promptGuidanceRescale: 0,
  positivePrompt: 'PRIVATE_PROMPT_CONTENT', negativePrompt: 'PRIVATE_NEGATIVE_CONTENT', characterTabs: [{ prompt: 'PRIVATE_CHARACTER_CONTENT' }] };

test('信息只显示分类选项，不显示具体值，Seed 和生成设置默认不导入', () => {
  const results = [], page = mount({ metadata: fixture, onApply: data => results.push(data) });
  const tree = page.render();
  assert.equal(checkbox(tree, 'importSeed').props.checked, false);
  assert.equal(checkbox(tree, 'importSettings').props.checked, false);
  assert.doesNotMatch(JSON.stringify(tree), /PRIVATE_|1024|guidanceScale/);
  applyButton(tree).props.onClick();
  assert.deepEqual(Object.keys(results[0]).sort(), ['characterTabs', 'negativePrompt', 'positivePrompt']);
});

test('选择生成设置仍不导入 Seed，并保留 false 和零值', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  let tree = page.render();
  checkbox(tree, 'importSettings').props.onChange(null, true);
  tree = page.render(); applyButton(tree).props.onClick();
  assert.equal(result.steps, 14); assert.equal(result.smea, false); assert.equal(result.promptGuidanceRescale, 0);
  assert.equal(Object.hasOwn(result, 'seed'), false);
});

test('只有用户明确选择才导入 Seed 0，关闭重开后恢复默认', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  checkbox(page.render(), 'importSeed').props.onChange(null, true);
  applyButton(page.render()).props.onClick();
  assert.equal(result.seed, 0);
  page.setProps({ open: false }); page.render();
  page.setProps({ open: true });
  assert.equal(checkbox(page.render(), 'importSeed').props.checked, false);
});

test('普通图片没有元数据时仍能选择用途，关闭后释放预览地址', () => {
  const actions = [], page = mount({ imageFile: { name: 'ordinary.png' }, metadata: null, imageActions: ['img2img', 'vibe', 'reference', 'inpaint', 'editor'], onUseImage: action => actions.push(action) });
  const tree = page.render();
  assert.equal(nodes(tree).find(node => node.props?.component === 'img').props.src, 'blob:ordinary.png');
  assert.equal(nodes(tree).filter(node => node.type === 'FormControlLabel').length, 0);
  nodes(tree).find(node => node.type === 'Button' && node.props.children.endsWith('useImage.vibe')).props.onClick();
  assert.deepEqual(actions, ['vibe']);
  page.setProps({ open: false }); page.render();
  assert.deepEqual(page.revoked, ['blob:ordinary.png']);
});


test('主动查看才展示完整元数据，返回时保留导入选择且不自动应用', () => {
  const results = [], page = mount({ metadata: fixture, onApply: data => results.push(data) });
  checkbox(page.render(), 'importSeed').props.onChange(null, true);
  nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('viewMetadata')).props.onClick();
  let tree = page.render();
  assert.match(JSON.stringify(tree), /PRIVATE_PROMPT_CONTENT/);
  assert.match(JSON.stringify(tree), /PRIVATE_NEGATIVE_CONTENT/);
  assert.match(JSON.stringify(tree), /PRIVATE_CHARACTER_CONTENT/);
  assert.ok(nodes(tree).some(node => node.type === 'TableCell' && node.props.children === '0'));
  assert.match(JSON.stringify(tree), /painting.tools.common.off/);
  assert.equal(results.length, 0);
  nodes(tree).find(node => node.type === 'IconButton' && node.props['aria-label'].endsWith('backToImageActions')).props.onClick();
  tree = page.render();
  assert.doesNotMatch(JSON.stringify(tree), /PRIVATE_/);
  assert.equal(checkbox(tree, 'importSeed').props.checked, true);
});

test('无元数据时显示明确空状态，读取中暂不能查看', () => {
  const page = mount({ metadata: null, reading: true });
  let button = nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('viewMetadata'));
  assert.equal(button.props.disabled, true);
  page.setProps({ reading: false });
  button = nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('viewMetadata'));
  button.props.onClick();
  assert.match(JSON.stringify(page.render()), /painting.tools.metadata.noMetadata/);
});

test('读取结果到达时不重置用户选择或预览地址，重新打开才恢复默认', () => {
  const file = { name: 'incoming.png' };
  const page = mount({ imageFile: file, metadata: fixture });
  checkbox(page.render(), 'importSeed').props.onChange(null, true);
  page.setProps({ metadata: { ...fixture, steps: 28 } });
  assert.equal(checkbox(page.render(), 'importSeed').props.checked, true);
  assert.equal(page.revoked.length, 0);
  page.setProps({ open: false }); page.render();
  page.setProps({ open: true });
  assert.equal(checkbox(page.render(), 'importSeed').props.checked, false);
});


test('详情中可只选择单个生成参数，返回后显示部分选择状态', () => {
  let result;
  const page = mount({ metadata: fixture, onApply: data => { result = data; } });
  nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('viewMetadata')).props.onClick();
  let tree = page.render();
  nodes(tree).find(node => node.type === 'Checkbox' && node.props.inputProps?.['aria-label'].endsWith('.width')).props.onChange(null, true);
  tree = page.render();
  assert.equal(checkbox(tree, 'importSettings').props.indeterminate, true);
  applyButton(tree).props.onClick();
  assert.equal(result.width, 1024);
  assert.equal(Object.hasOwn(result, 'height'), false);
  assert.equal(Object.hasOwn(result, 'seed'), false);
});

test('详情关闭直接退出一次，返回用途后复用同一张图片', () => {
  let closes = 0;
  const actions = [], file = { name: 'reuse.png' };
  const page = mount({ imageFile: file, imageActions: ['img2img'], metadata: fixture, onClose: () => closes++, onUseImage: target => actions.push(target) });
  nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('viewMetadata')).props.onClick();
  nodes(page.render()).find(node => node.type === 'IconButton' && node.props['aria-label'].endsWith('.close')).props.onClick();
  assert.equal(closes, 1);
  nodes(page.render()).find(node => node.type === 'IconButton' && node.props['aria-label'].endsWith('backToImageActions')).props.onClick();
  nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('useImage.img2img')).props.onClick();
  assert.deepEqual(actions, ['img2img']);
  assert.equal(page.revoked.length, 0);
});


test('详情中排除单个角色时只导入仍被选中的角色', () => {
  let result;
  const characters = [{ name: 'first', prompt: 'one' }, { name: 'second', prompt: 'two' }];
  const page = mount({ metadata: { ...fixture, characterTabs: characters }, onApply: data => { result = data; } });
  nodes(page.render()).find(node => node.type === 'Button' && node.props.children.endsWith('viewMetadata')).props.onClick();
  nodes(page.render()).find(node => node.type === 'Checkbox' && node.props.inputProps?.['aria-label'].endsWith('importCharacters 2')).props.onChange(null, false);
  applyButton(page.render()).props.onClick();
  assert.equal(result.characterTabs.length, 1);
  assert.equal(result.characterTabs[0].name, 'first');
});
