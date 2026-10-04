import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { setImmediate as settle } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as generationErrors from './Generation/errors.js';
import * as v5Params from './utils/novelAIV5Params.mjs';
import chinese from '../../i18n/locales/painting-workspace.zh-CN.js';
import english from '../../i18n/locales/painting-workspace.en-US.js';

const require = createRequire(import.meta.url);
const { code } = require('next/dist/build/swc').transformSync(
  readFileSync(new URL('./ImageEnhanceDialog.js', import.meta.url), 'utf8'),
  {
    filename: 'ImageEnhanceDialog.js',
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
    module: { type: 'commonjs' },
  },
);

function createDialog(overrides = {}, locale = chinese) {
  let props = {
    open: true, source: { width: 1024, height: 1024, src: 'blob:source' },
    model: 'nai-diffusion-5-full', initialSteps: 28,
    onClose() {}, onSubmit() {}, ...overrides,
  };
  const slots = [];
  const requests = [];
  const timers = new Map();
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let nextTimer = 0;
  const dependencies = {
    react: {
      ...React,
      useId: () => 'enhance',
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], (next) => {
          const value = typeof next === 'function' ? next(slots[index]) : next;
          if (!Object.is(value, slots[index])) dirty = true;
          slots[index] = value;
        }];
      },
      useEffect(effect, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
          effects.push(() => {
            previous?.cleanup?.();
            slots[index] = { deps, cleanup: effect() };
          });
        }
      },
    },
    '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    '@mui/icons-material': new Proxy({}, { get: (_target, name) => name }),
    '@/i18n/I18nProvider': {
      useI18n: () => ({
        t: (key, values = {}) => {
          const text = key.split('.').reduce((value, field) => value?.[field], locale) || key;
          return text.replace(/\{(\w+)\}/g, (_match, name) => values[name]);
        },
      }),
    },
    '@/utils/ApiClient': {
      __esModule: true,
      default: {
        estimateImageTool(data, options) {
          return new Promise((resolve, reject) => requests.push({ data, ...options, resolve, reject }));
        },
      },
    },
    './Generation/errors': generationErrors,
    './utils/novelAIV5Params.mjs': v5Params,
  };
  const exports = {};
  runInNewContext(code, {
    exports, require: (name) => dependencies[name] || require(name), AbortController,
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    requests,
    update(next) { props = { ...props, ...next }; },
    render() {
      for (let pass = 0; pass < 20; pass += 1) {
        cursor = 0;
        dirty = false;
        effects = [];
        const tree = exports.default(props);
        effects.forEach((effect) => effect());
        if (!dirty) return tree;
      }
      assert.fail('增强弹窗状态应稳定');
    },
    async tick() {
      for (const [id, callback] of timers) { timers.delete(id); callback(); }
      await Promise.resolve();
    },
  };
}

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((child) => findNode(child, predicate)).find(Boolean) ?? null;
  if (predicate(tree)) return tree;
  return findNode(tree.props?.children, predicate);
}

const submitButton = (tree) => findNode(tree, (node) => node.type === 'Button' && node.props.variant === 'contained');
const slider = (tree, name) => findNode(tree, (node) => node.type === 'Slider' && node.props['aria-labelledby'] === `enhance-${name}`);
const estimateResult = { cost: 15, width: 1024, height: 1024, balance: 50, affordable: true };

test('暂时无法读取官方余额时显示明确说明，并允许把请求交给官方校验', async () => {
  const dialog = createDialog();
  dialog.render();
  await dialog.tick();
  dialog.requests[0].resolve({ ...estimateResult, balance: null, affordable: null });
  await settle();
  const tree = dialog.render();
  assert.equal(submitButton(tree).props.disabled, false);
  assert.ok(findNode(tree, (node) => node.type === 'Typography'
    && node.props.children === chinese.painting.workspace.imageTools.balanceUnknown));
});

test('官方余额不足错误码使用 Anlas 文案', () => {
  assert.equal(generationErrors.normalizeGenerationErrorCode({
    code: 'NOVELAI_INSUFFICIENT_ANLAS', statusCode: 402,
  }), 'NOVELAI_INSUFFICIENT_ANLAS');
  assert.equal(generationErrors.GENERATION_ERROR_MESSAGE_KEYS.NOVELAI_INSUFFICIENT_ANLAS,
    'painting.workspace.imageTools.insufficientBalance');
});

test('增强预设通过服务端估价后才允许提交，提交使用对应尺寸和点数', async () => {
  const submissions = [];
  const dialog = createDialog({ onSubmit: (settings) => submissions.push(settings), initialSteps: 23 });
  assert.equal(submitButton(dialog.render()).props.disabled, true);
  await dialog.tick();
  assert.deepEqual(JSON.parse(JSON.stringify(dialog.requests[0].data)), {
    image_tool: 'enhance', model: 'nai-diffusion-5-full', source_width: 1024, source_height: 1024,
    upscale_amount: 1, strength: 0.5, noise: 0, steps: 23,
  });
  dialog.requests[0].resolve(estimateResult);
  await settle();
  const submit = submitButton(dialog.render());
  assert.equal(submit.props.disabled, false);
  assert.equal(submit.props.children, '增强 · 15 点');
  await submit.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(submissions)), [{
    upscale_amount: 1, strength: 0.5, noise: 0, steps: 23, width: 1024, height: 1024, cost: 15,
  }]);
});

test('切换倍率立即禁用旧估价，乱序返回与关闭后的请求不能覆盖当前点数', async () => {
  const dialog = createDialog();
  dialog.render();
  await dialog.tick();
  findNode(dialog.render(), (node) => node.type === 'ToggleButtonGroup').props.onChange(null, 1.5);
  assert.equal(submitButton(dialog.render()).props.disabled, true);
  assert.equal(dialog.requests[0].signal.aborted, true);
  await dialog.tick();
  dialog.requests[1].resolve({ ...estimateResult, cost: 34, width: 1536, height: 1536 });
  await settle();
  dialog.requests[0].resolve(estimateResult);
  await settle();
  assert.equal(submitButton(dialog.render()).props.children, '增强 · 34 点');
  slider(dialog.render(), 'steps').props.onChange(null, 50);
  dialog.render();
  await dialog.tick();
  dialog.update({ open: false });
  dialog.render();
  assert.equal(dialog.requests[2].signal.aborted, true);
});

test('余额不足与参数错误显示本地化提示并阻止提交', async () => {
  const dialog = createDialog();
  dialog.render();
  await dialog.tick();
  dialog.requests[0].resolve({ ...estimateResult, affordable: false, balance: 2 });
  await settle();
  let tree = dialog.render();
  assert.equal(submitButton(tree).props.disabled, true);
  assert.equal(findNode(tree, (node) => node.type === 'Alert').props.children, chinese.painting.workspace.imageTools.insufficientBalance);
  slider(tree, 'strength').props.onChange(null, 0.9);
  dialog.render();
  await dialog.tick();
  dialog.requests[1].reject({ statusCode: 400, category: 'parameter' });
  await settle();
  tree = dialog.render();
  assert.equal(submitButton(tree).props.disabled, true);
  assert.equal(findNode(tree, (node) => node.type === 'Alert').props.children, chinese.painting.workspace.errors.invalidParameters);
});

test('Magnitude 使用官方预设，重新打开后重置高级参数；Max 仅对 V5 显示', async () => {
  const dialog = createDialog();
  slider(dialog.render(), 'magnitude').props.onChange(null, 4);
  let tree = dialog.render();
  assert.equal(slider(tree, 'strength').props.value, 0.7);
  assert.equal(slider(tree, 'noise').props.value, 0.1);
  assert.ok(findNode(tree, (node) => node.type === 'ToggleButton' && node.props.value === 'max'));
  dialog.update({ open: false });
  dialog.render();
  dialog.update({ open: true, model: 'nai-diffusion-4-5-full', initialSteps: 28 });
  tree = dialog.render();
  assert.equal(slider(tree, 'strength').props.value, 0.5);
  assert.equal(slider(tree, 'noise').props.value, 0);
  assert.equal(slider(tree, 'steps').props.value, 28);
  assert.equal(findNode(tree, (node) => node.type === 'ToggleButton' && node.props.value === 'max'), null);
});

test('替换同尺寸源图仍重新查询余额，不停留在旧报价或加载状态', async () => {
  const dialog = createDialog();
  dialog.render();
  await dialog.tick();
  dialog.requests[0].resolve(estimateResult);
  await settle();
  assert.equal(submitButton(dialog.render()).props.disabled, false);
  dialog.update({ source: { width: 1024, height: 1024, src: 'blob:another' } });
  assert.equal(submitButton(dialog.render()).props.disabled, true);
  await dialog.tick();
  assert.equal(dialog.requests.length, 2);
  dialog.requests[1].resolve({ ...estimateResult, affordable: false, balance: 0 });
  await settle();
  assert.equal(submitButton(dialog.render()).props.disabled, true);
  assert.ok(findNode(dialog.render(), (node) => node.type === 'Alert'));
});

test('中英文文案齐全，缺少源图尺寸不会请求估价或允许提交', async () => {
  assert.deepEqual(Object.keys(chinese.painting.workspace.imageTools), Object.keys(english.painting.workspace.imageTools));
  for (const locale of [chinese, english]) {
    const dialog = createDialog({ source: { src: 'blob:source' } }, locale);
    const tree = dialog.render();
    await dialog.tick();
    assert.equal(dialog.requests.length, 0);
    assert.equal(submitButton(tree).props.disabled, true);
    assert.equal(findNode(tree, (node) => node.type === 'Alert').props.children, locale.painting.workspace.imageTools.sourceDimensionsUnavailable);
  }
});
