import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { createTheme } = require('@mui/material/styles');
const theme = createTheme();

// 保留组件实际事件处理函数，通过最小 Hook 容器检查保存边界与回调数据。
function createEditor(file = 'index.js', props = {}, document = {}) {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const useSlot = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  };
  const dependencies = {
    react: {
      ...React,
      useState: useSlot,
      useRef: (initial) => useSlot(() => ({ current: initial }))[0],
      useEffect: (effect) => effects.push(effect),
      useCallback: (callback) => callback,
      useMemo: (factory) => factory(),
    },
    '@mui/material': new Proxy({}, {
      get: (_, name) => name === 'useTheme' ? () => theme : name === 'useMediaQuery' ? () => false : name,
    }),
    '@mui/icons-material': new Proxy({}, { get: (_, name) => name }),
    'next/image': { __esModule: true, default: 'NextImage' },
    '@/i18n/I18nProvider': { useI18n: () => ({ t: (key) => key }) },
  };
  for (const name of ['Toolbar', 'DrawMode', 'EmotionMode', 'ColorizeMode']) {
    dependencies[`./${name}`] = { __esModule: true, default: name };
  }
  const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    filename: file,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
    module: { type: 'commonjs' },
  });
  const exports = {};
  runInNewContext(code, { exports, require: (name) => dependencies[name] || require(name), document });
  return {
    render: () => {
      cursor = 0;
      effects.length = 0;
      return exports.default({ open: true, imageUrl: 'original.png', theme, inSidePanel: true, ...props });
    },
    effects,
  };
}

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((child) => findNode(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return findNode(tree.props?.children, predicate);
}

const saveButton = (tree) => findNode(tree, (node) => node.type === 'Button' && node.props.children === 'painting.tools.common.save');
const toolbar = (tree) => findNode(tree, (node) => node.type === 'Toolbar');

test('五个图像工具无需二次确认，只点击最终保存就提交所选效果和默认参数', () => {
  for (const [tool, expectedParams] of [
    ['lineart', { enabled: true, toolType: 'lineart' }],
    ['sketch', { enabled: true, toolType: 'sketch' }],
    ['declutter', { enabled: true, toolType: 'declutter' }],
    ['emotion', { emotion: 'neutral', prompt: '', defry: 0 }],
    ['colorize', { prompt: '', intensity: 0, preset: null }],
  ]) {
    const closed = [];
    const editor = createEditor('index.js', { onClose: (data) => closed.push(data) });
    toolbar(editor.render()).props.onRadioToolClick(tool);
    const tree = editor.render();
    assert.equal(toolbar(tree).props.activeRadioTool, tool);
    const controls = findNode(tree, (node) => ['EmotionMode', 'ColorizeMode'].includes(node.type));
    if (controls) {
      const mode = createEditor(`${controls.type}.js`, controls.props);
      assert.ok(!saveButton(mode.render()));
      mode.effects.forEach((effect) => effect());
    }
    assert.equal(closed.length, 0, `${tool} 选择工具不应提前保存`);
    saveButton(editor.render()).props.onClick();
    assert.equal(closed.length, 1);
    assert.equal(closed[0].editedImage, null);
    assert.equal(closed[0].directorTools.type, tool);
    for (const [name, value] of Object.entries(expectedParams)) {
      assert.equal(closed[0].directorTools.params[name], value, `${tool}.${name}`);
    }
  }
});

test('再次点击已保存的图像工具会取消选择，最终保存不再提交旧效果', () => {
  for (const tool of ['lineart', 'sketch', 'declutter', 'emotion', 'colorize']) {
    let saved;
    const editor = createEditor('index.js', {
      currentDirectorToolParams: { type: tool, params: { enabled: true, emotion: 'happy', prompt: 'warm', defry: 3, intensity: 4 } },
      onClose: (data) => { saved = data; },
    });
    toolbar(editor.render()).props.onRadioToolClick(tool);
    const tree = editor.render();
    assert.equal(toolbar(tree).props.activeRadioTool, null);
    saveButton(tree).props.onClick();
    assert.equal(saved.directorTools.type, null, tool);
    assert.equal(saved.directorTools.params, null, tool);
  }
});

test('情绪与着色控件的当前参数自动交给最终保存，无需单独确认', () => {
  for (const tool of ['emotion', 'colorize']) {
    const closed = [];
    const editor = createEditor('index.js', { onClose: (data) => closed.push(data) });
    toolbar(editor.render()).props.onRadioToolClick(tool);
    const controls = findNode(editor.render(), (node) => node.type === (tool === 'emotion' ? 'EmotionMode' : 'ColorizeMode'));
    const mode = createEditor(`${controls.type}.js`, controls.props);
    let tree = mode.render();
    mode.effects.forEach((effect) => effect());
    if (tool === 'emotion') {
      findNode(tree, (node) => node.type === 'Select').props.onChange({ target: { value: 'happy' } });
    } else {
      findNode(tree, (node) => node.type === 'Chip' && node.props.label === 'painting.tools.imageEditor.colorize.presets.warm').props.onClick();
      tree = mode.render();
    }
    findNode(tree, (node) => node.type === 'TextField').props.onChange({ target: { value: 'warm smile' } });
    findNode(tree, (node) => node.type === 'Slider').props.onChange({}, 3);
    mode.render();
    mode.effects.forEach((effect) => effect());
    assert.equal(closed.length, 0);
    saveButton(editor.render()).props.onClick();
    assert.equal(closed.length, 1);
    const { type, params } = closed[0].directorTools;
    assert.equal(type, tool);
    assert.equal(params.prompt, 'warm smile');
    if (tool === 'emotion') {
      assert.equal(params.emotion, 'happy');
      assert.equal(params.defry, 3);
    } else {
      assert.equal(params.preset.id, 'warm');
      assert.equal(params.intensity, 3);
    }
  }
});

test('绘制后只点击最终保存就合成当前画布，并按原图分辨率导出', () => {
  const calls = [];
  let saved;
  const output = { getContext: () => ({ drawImage: (...args) => calls.push(args) }), toDataURL: () => 'data:image/png;draft' };
  const editor = createEditor('index.js', { onClose: (data) => { saved = data; } }, { createElement: () => output });
  toolbar(editor.render()).props.onMainToolClick('draw');
  const tree = editor.render();
  const drawing = findNode(tree, (node) => node.type === 'DrawMode');
  const source = { complete: true, naturalWidth: 2048, naturalHeight: 1536 };
  const canvas = { width: 512, height: 384 };
  drawing.props.canvasRef.current = canvas;
  drawing.props.sourceImageRef.current = source;
  drawing.props.drawingChangedRef.current = true;
  saveButton(tree).props.onClick();
  assert.equal(saved.editedImage, 'data:image/png;draft');
  assert.equal(output.width, 2048);
  assert.equal(output.height, 1536);
  assert.deepEqual(calls, [[source, 0, 0], [canvas, 0, 0, 2048, 1536]]);
  assert.equal(drawing.props.onSave, undefined);
});

test('切换工具先保留笔迹草稿，再由最终保存一并提交效果', () => {
  let saved;
  const output = { getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/png;draft' };
  const editor = createEditor('index.js', { onClose: (data) => { saved = data; } }, { createElement: () => output });
  toolbar(editor.render()).props.onMainToolClick('draw');
  let tree = editor.render();
  const drawing = findNode(tree, (node) => node.type === 'DrawMode').props;
  drawing.canvasRef.current = {};
  drawing.sourceImageRef.current = { complete: true, naturalWidth: 800, naturalHeight: 600 };
  drawing.drawingChangedRef.current = true;
  toolbar(tree).props.onRadioToolClick('lineart');
  assert.equal(saved, undefined);
  tree = editor.render();
  saveButton(tree).props.onClick();
  assert.equal(saved.editedImage, 'data:image/png;draft');
  assert.equal(saved.directorTools.type, 'lineart');
  assert.equal(saved.directorTools.params.enabled, true);
});

test('未绘制时沿用原图，取消及 Escape 不传入任何保存数据', () => {
  const closed = [];
  const editor = createEditor('index.js', { onClose: (...args) => closed.push(args) });
  toolbar(editor.render()).props.onMainToolClick('draw');
  const tree = editor.render();
  saveButton(tree).props.onClick();
  assert.equal(closed[0][0].editedImage, null);
  findNode(tree, (node) => node.type === 'Button' && node.props.children === 'painting.tools.common.cancel').props.onClick();
  tree.props.onClose({ type: 'keydown' }, 'escapeKeyDown');
  assert.deepEqual(closed.slice(1), [[], []]);
});

test('画布导出失败时保留绘制工具和草稿，不触发关闭', () => {
  let closeCount = 0;
  const editor = createEditor('index.js', { onClose: () => { closeCount += 1; } });
  toolbar(editor.render()).props.onMainToolClick('draw');
  let tree = editor.render();
  const drawing = findNode(tree, (node) => node.type === 'DrawMode').props;
  drawing.drawingChangedRef.current = true;
  drawing.sourceImageRef.current = { complete: false };
  saveButton(tree).props.onClick();
  tree = editor.render();
  assert.equal(closeCount, 0);
  assert.equal(toolbar(tree).props.activeMainTool, 'draw');
  assert.ok(findNode(tree, (node) => node.type === 'Alert'));
});

test('重新打开编辑器保留已保存的效果及参数', () => {
  const params = { emotion: 'happy', prompt: 'smiling', defry: 3 };
  let saved;
  const editor = createEditor('index.js', {
    currentDirectorToolParams: { type: 'emotion', params }, onClose: (data) => { saved = data; },
  });
  const tree = editor.render();
  assert.equal(toolbar(tree).props.activeRadioTool, 'emotion');
  saveButton(tree).props.onClick();
  assert.equal(saved.directorTools.params, params);
  const emotion = createEditor('EmotionMode.js', { initialParams: params, onSaveParams: (data) => { saved = data; } });
  emotion.render();
  emotion.effects.forEach((effect) => effect());
  assert.equal(saved.emotion, 'happy');
  assert.equal(saved.prompt, 'smiling');
  assert.equal(saved.defry, 3);
  const colorize = createEditor('ColorizeMode.js', {
    initialParams: { prompt: 'warm sunset', intensity: 4, preset: { id: 'warm' } },
    onSaveParams: (data) => { saved = data; },
  });
  colorize.render();
  colorize.effects.forEach((effect) => effect());
  assert.equal(saved.prompt, 'warm sunset');
  assert.equal(saved.intensity, 4);
  assert.equal(saved.preset.id, 'warm');
});
