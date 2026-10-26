import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import chinese from '../../i18n/locales/gallery.zh-CN.js';

const require = createRequire(import.meta.url);
const { code } = require('next/dist/build/swc').transformSync(
  readFileSync(new URL('./WorkVersionBar.js', import.meta.url), 'utf8'), {
    filename: 'WorkVersionBar.js',
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
    module: { type: 'commonjs' },
  },
);

function createBar() {
  const slots = [], calls = [];
  let cursor = 0;
  const parameters = { positivePrompt: 'current draft', editor_state: { parameterState: { referenceImages: [{ name: 'reference', disabled: true }] } } };
  const props = { context: null, getParameters: () => parameters, onChange: (value) => { props.context = value; }, onContinue() {} };
  const dependencies = {
    react: { ...React, useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    } },
    '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    '@mui/icons-material': new Proxy({}, { get: (_target, name) => name }),
    '@/i18n/I18nProvider': { useI18n: () => ({ t: (key) => key.split('.').reduce((value, field) => value?.[field], chinese) || key }) },
    '../gallery/GalleryVersionsDialog': () => null,
    '@/utils/ApiClient': {
      createWork: async (body) => {
        calls.push(body);
        return { work: { id: 'work', title: body.title }, version: null };
      },
    },
  };
  const exports = {};
  runInNewContext(code, { exports, React, require: (name) => dependencies[name] || require(name) });
  return { calls, props, parameters, render: () => { cursor = 0; return exports.default(props); } };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((child) => find(child, predicate)).find(Boolean) ?? null;
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}

const button = (tree, text) => find(tree, (node) => node.type === 'Button' && node.props.children === text);

test('默认普通模式；取消新建不启用，创建后才显示版本功能，退出保留编辑内容', async () => {
  const bar = createBar();
  let tree = bar.render();
  assert.equal(button(tree, '保存提示词版本'), null);
  assert.equal(button(tree, '作品蓝图'), null);
  assert.ok(button(tree, '打开作品'));
  assert.equal(bar.calls.length, 0);

  button(tree, '新建作品').props.onClick();
  tree = bar.render();
  assert.equal(find(tree, (node) => node.type === 'Dialog').props.open, true);
  button(tree, '取消').props.onClick();
  assert.equal(bar.props.context, null);
  assert.equal(bar.calls.length, 0);

  button(bar.render(), '新建作品').props.onClick();
  tree = bar.render();
  find(tree, (node) => node.type === 'TextField' && node.props.label === '作品名称').props.onChange({ target: { value: 'My work' } });
  tree = bar.render();
  await find(tree, (node) => node.type === 'Button' && node.props.variant === 'contained').props.onClick();
  assert.equal(bar.calls.length, 1);
  assert.equal(bar.calls[0].title, 'My work');
  assert.equal(bar.calls[0].parameters, undefined);
  assert.equal(bar.props.context.parent_version_id, null);
  tree = bar.render();
  assert.equal(button(tree, '保存提示词版本'), null);
  bar.props.context = { ...bar.props.context, parent_version_id: 'v1', number: 1 };
  tree = bar.render();
  assert.ok(button(tree, '保存提示词版本'));
  assert.ok(button(tree, '作品蓝图'));

  button(tree, '退出作品').props.onClick();
  tree = bar.render();
  assert.equal(bar.props.context, null);
  assert.equal(button(tree, '保存提示词版本'), null);
  assert.equal(bar.parameters.positivePrompt, 'current draft');
  assert.equal(bar.parameters.editor_state.parameterState.referenceImages[0].name, 'reference');
  assert.equal(bar.calls.length, 1);
});
