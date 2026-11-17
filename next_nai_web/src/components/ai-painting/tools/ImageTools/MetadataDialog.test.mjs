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
    require: name => name === 'react' ? hooks : name === '@mui/material' ? new Proxy({}, { get: (_, key) => key })
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
const checkbox = (tree, name) => nodes(tree).find(node => node.type === 'FormControlLabel' && node.props.label.endsWith(name)).props.control;
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
