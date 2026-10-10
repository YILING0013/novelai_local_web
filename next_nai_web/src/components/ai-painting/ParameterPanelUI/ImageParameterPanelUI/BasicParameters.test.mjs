import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as novelAIV5Params from '../../utils/novelAIV5Params.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { createTheme, alpha } = require('@mui/material/styles');
const theme = createTheme();
const parameterMapping = await import('../../utils/parameterMapping.js');

// 使用实际组件与事件回调，仅替换浏览器容器和 Hook 调度。
function createControls(file, initialProps) {
  let props = initialProps;
  let cursor = 0;
  let dirty = false;
  const slots = [];
  let effects = [];
  const dependencies = {
    react: {
      ...React,
      useId: () => 'parameters',
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], (next) => {
          const value = typeof next === 'function' ? next(slots[index]) : next;
          if (!Object.is(value, slots[index])) dirty = true;
          slots[index] = value;
        }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect(effect, deps) {
        const index = cursor++;
        if (!slots[index] || deps.some((value, offset) => !Object.is(value, slots[index][offset]))) {
          effects.push(effect);
          slots[index] = deps;
        }
      },
    },
    '@mui/material': new Proxy({ alpha }, {
      get: (target, name) => target[name] ?? (name === 'useTheme' ? () => theme : name === 'useMediaQuery' ? () => false : name),
    }),
    '@mui/icons-material': new Proxy({}, { get: (_, name) => name }),
    '@/components/muiWrappers/LockableSlider': { __esModule: true, default: 'LockableSlider' },
    '@/i18n/I18nProvider': { useI18n: () => ({ t: (key) => key }) },
    '../../utils/parameterMapping': parameterMapping,
    '../../utils/modelUtils': novelAIV5Params,
  };
  const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    filename: file,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
    module: { type: 'commonjs' },
  });
  const exports = {};
  runInNewContext(code, {
    exports, require: (name) => dependencies[name] || require(name),
    setTimeout: () => 1, clearTimeout: () => {},
  });
  return {
    update(next) { props = { ...props, ...next }; dirty = true; },
    render() {
      let tree;
      for (let pass = 0; pass < 20; pass += 1) {
        cursor = 0;
        dirty = false;
        effects = [];
        tree = exports.default(props);
        effects.forEach((effect) => effect());
        if (!dirty) return tree;
      }
      assert.fail('参数同步应在有限次渲染内稳定');
    },
  };
}

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((child) => findNode(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return findNode(tree.props?.children, predicate);
}

const slider = (tree, name) => findNode(tree, (node) => node.type === 'LockableSlider'
  && node.props.label === `painting.workspace.parameters.${name}`);
const modeButton = (tree) => findNode(tree, (node) => node.type === 'Button'
  && String(node.props.children).endsWith('LargeImageMode'));

function createPanel(overrides = {}, controlProps = {}) {
  let params = {
    width: 1024, height: 1024, steps: 23, guidanceScale: 5,
    promptGuidanceRescale: 0, batchSize: 1, use_upscale_credits: false,
    ...overrides,
  };
  const inputChanges = [];
  const panel = createControls('./BasicParameters.js', {
    params,
    editing: { width: false, height: false },
    tempInputs: {},
    expandedPanels: {},
    ...controlProps,
    handleParamChange: (field, value) => {
      params = { ...params, [field]: value };
      panel.update({ params });
    },
    handleInputChange: (...args) => inputChanges.push(args),
  });
  return {
    panel, inputChanges, getParams: () => params,
    updateParams(next) {
      params = { ...params, ...next };
      panel.update({ params });
    },
  };
}

test('Medium 普通和大图模式均固定 14 步和采样器，保留 CFG，隐藏无效控件', () => {
  for (const use_upscale_credits of [false, true]) {
    const { panel, getParams } = createPanel({
      model: 'nai-diffusion-5-full-medium', steps: 50, sampler: 'k_euler',
      promptGuidanceRescale: 0.8, use_upscale_credits,
    }, { isV5Model: true });
    const tree = panel.render();
    assert.equal(getParams().steps, 14);
    assert.equal(getParams().sampler, 'k_euler_ancestral');
    assert.equal(getParams().promptGuidanceRescale, 0);
    assert.ok(!slider(tree, 'samplingSteps'));
    assert.ok(!slider(tree, 'promptGuidanceRescale'));
    assert.ok(slider(tree, 'cfgScale'));
    const steps = findNode(tree, (node) => node.type === 'TextField'
      && node.props.label === 'painting.workspace.parameters.samplingSteps');
    assert.equal(steps.props.value, 14);
    assert.equal(steps.props.slotProps.input.readOnly, true);
    const sampler = findNode(tree, (node) => node.type === 'Select'
      && node.props.label === 'painting.workspace.parameters.sampler');
    assert.equal(sampler.props.disabled, true);
  }
});

test('启用大图、拖动步数至 50、切回普通模式后数值与实际参数立即恢复', () => {
  const { panel, getParams } = createPanel();
  modeButton(panel.render()).props.onClick();
  assert.equal(slider(panel.render(), 'samplingSteps').props.max, 50);
  slider(panel.render(), 'samplingSteps').props.onChange(50);
  assert.equal(slider(panel.render(), 'samplingSteps').props.value, 50);
  modeButton(panel.render()).props.onClick();
  const steps = slider(panel.render(), 'samplingSteps').props;
  assert.equal(steps.max, 28);
  assert.equal(steps.value, 28);
  assert.equal(getParams().steps, 28);
  assert.equal(getParams().use_upscale_credits, false);
});

test('外部切回普通模式或回传旧大图数值时同步收紧步数和尺寸，无需点击控件', () => {
  const { panel, inputChanges, getParams, updateParams } = createPanel({
    use_upscale_credits: true, width: 1472, height: 1472, steps: 50,
  });
  panel.render();
  updateParams({ use_upscale_credits: false });
  const tree = panel.render();
  assert.equal(slider(tree, 'samplingSteps').props.value, 28);
  assert.ok(getParams().width * getParams().height <= 1048576);
  assert.equal(getParams().steps, 28);
  assert.ok(inputChanges.some(([field, value]) => field === 'width' && value === String(getParams().width)));
  updateParams({ steps: 45 });
  assert.equal(slider(panel.render(), 'samplingSteps').props.value, 28);
});

test('切换模式保留范围内的步数和其他滑块，并继续响应拖动与尺寸输入', () => {
  const { panel, inputChanges } = createPanel();
  modeButton(panel.render()).props.onClick();
  modeButton(panel.render()).props.onClick();
  assert.equal(slider(panel.render(), 'samplingSteps').props.value, 23);
  for (const [label, value] of [['samplingSteps', 20], ['cfgScale', 6.5], ['promptGuidanceRescale', 0.24], ['batchSize', 3]]) {
    slider(panel.render(), label).props.onChange(value);
    assert.equal(slider(panel.render(), label).props.value, value);
  }
  const width = findNode(panel.render(), (node) => node.type === 'TextField' && node.props.id.endsWith('-width'));
  width.props.onChange({ target: { value: '832' } });
  assert.deepEqual(inputChanges.at(-1), ['width', '832']);
});

test('LockableSlider 的数值标签与圆点共同跟随外部值，桌面拖动仍回传新值', () => {
  const changes = [];
  const controls = createControls('../../../muiWrappers/LockableSlider.js', {
    label: '步数', value: 50, min: 1, max: 50, step: 1,
    onChange: (value) => changes.push(value),
  });
  controls.render();
  controls.update({ value: 28, max: 28 });
  const tree = controls.render();
  const control = findNode(tree, (node) => node.type === 'Slider');
  assert.equal(control.props.value, 28);
  assert.equal(control.props.max, 28);
  assert.ok(findNode(tree, (node) => node.type === 'Typography' && node.props.children === 28));
  control.props.onChange({}, 17);
  assert.deepEqual(changes, [17]);
});
