import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import * as blueprintFunctions from './versionBlueprint.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const versions = [
  { id: 'a', number: 1, parent_id: null, images: [], message: 'first' },
  { id: 'b', number: 2, parent_id: 'a', images: [{ id: 'image', thumbnail_url: '/thumbnail.png', url: '/original.png' }], message: 'second' },
  { id: 'c', number: 3, parent_id: 'b', images: [], message: 'third' },
];

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((child) => find(child, predicate)).find(Boolean);
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}

function harness() {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const commits = [];
  const selected = [];
  const captured = new Set();
  const props = { versions, blueprint: { positions: {}, edge_notes: {}, hidden_node_ids: [], groups: [] }, selectedId: null,
    onSelect: (id) => { selected.push(id); props.selectedId = id; }, onBlueprintChange: (next) => { commits.push(next); props.blueprint = next; } };
  const slot = (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; };
  const memo = (factory, dependencies) => { const [prior, update] = slot(null); if (!prior || dependencies.some((item, index) => item !== prior.dependencies[index])) { const value = factory(); update({ value, dependencies }); return value; } return prior.value; };
  const surface = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700 }),
    setPointerCapture: (id) => captured.add(id), hasPointerCapture: (id) => captured.has(id), releasePointerCapture: (id) => captured.delete(id),
    addEventListener() {}, removeEventListener() {},
  };
  const dependencies = {
    react: { ...React, useState: slot, useRef: (initial) => slot(() => ({ current: initial }))[0], useId: () => 'blueprint-test', useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
      useEffect: (effect, deps) => { const [prior, update] = slot(null); if (!prior || deps.some((item, index) => item !== prior[index])) { effects.push(effect); update(deps); } } },
    '@mui/material': new Proxy({}, { get: (_, key) => key === 'useTheme' ? () => ({ palette: { primary: { main: '#7586e4' }, text: { secondary: '#888' }, background: { paper: '#222' } } }) : key }),
    '@mui/icons-material': new Proxy({}, { get: (_, key) => key }),
    '@mui/material/styles': { alpha: (value) => value },
    '@/i18n/I18nProvider': { useI18n: () => ({ locale: 'zh-CN' }) },
    '@/utils/browserCapabilities.mjs': { createClientId: () => 'new-group' },
    './versionBlueprint.mjs': blueprintFunctions,
  };
  const { code } = transformSync(readFileSync(new URL('./VersionBlueprintCanvas.js', import.meta.url), 'utf8'), { filename: 'VersionBlueprintCanvas.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } });
  const exports = {};
  runInNewContext(code, { exports, require: (name) => dependencies[name] || require(name), ResizeObserver: class { constructor(callback) { this.callback = callback; } observe() { this.callback([{ contentRect: { width: 1200, height: 700 } }]); } disconnect() {} } });
  return {
    props, commits, selected,
    render: () => { cursor = 0; const tree = exports.default(props); find(tree, (node) => node.props?.role === 'region').props.ref.current = surface; return tree; },
    flush: () => { for (const effect of effects.splice(0)) effect(); },
    event: (id, x, y, shiftKey = false) => ({ pointerId: 1, button: 0, clientX: x, clientY: y, shiftKey,
      target: { closest: (selector) => id && selector === '[data-blueprint-node]' ? { dataset: { blueprintNode: id }, focus() {} } : null } }),
  };
}

const surface = (tree) => find(tree, (node) => node.props?.role === 'region');
const action = (tree, label) => find(tree, (node) => ['Button', 'IconButton'].includes(node.type) && node.props['aria-label'] === label);
const openDialog = (tree) => find(tree, (node) => node.type === 'Dialog' && node.props.open);
const saveDialog = (tree) => find(openDialog(tree), (node) => node.type === 'Button' && node.props.children === '保存');

test('Shift多选后共同拖动只保存一次，不把拖动误当成节点点击', () => {
  const canvas = harness(); canvas.render(); canvas.flush(); canvas.render(); canvas.flush();
  for (const [id, shift] of [['a', false], ['b', true]]) {
    const target = surface(canvas.render()); const event = canvas.event(id, 100, 100, shift);
    target.props.onPointerDown(event); surface(canvas.render()).props.onPointerUp(event); canvas.render(); canvas.flush();
  }
  assert.deepEqual(canvas.selected, ['a', 'b']);
  assert.equal(canvas.commits.length, 0);
  surface(canvas.render()).props.onPointerDown(canvas.event('a', 100, 100));
  surface(canvas.render()).props.onPointerMove(canvas.event('a', 180, 145));
  assert.equal(canvas.commits.length, 0);
  surface(canvas.render()).props.onPointerUp(canvas.event('a', 180, 145));
  assert.equal(canvas.commits.length, 1);
  assert.deepEqual(Object.keys(canvas.props.blueprint.positions), ['a', 'b']);
  assert.equal(canvas.props.blueprint.positions.b.x - canvas.props.blueprint.positions.a.x, 328);
  assert.deepEqual(canvas.selected, ['a', 'b']);
});

test('多选成组、折叠和解组均只更新布局；隐藏后可以恢复全部节点', () => {
  const canvas = harness(); canvas.render(); canvas.flush(); canvas.render(); canvas.flush();
  for (const [id, shift] of [['a', false], ['b', true]]) { const event = canvas.event(id, 100, 100, shift); surface(canvas.render()).props.onPointerDown(event); surface(canvas.render()).props.onPointerUp(event); }
  action(canvas.render(), '选中成组').props.onClick();
  find(openDialog(canvas.render()), (node) => node.type === 'TextField').props.onChange({ target: { value: '人物探索' } });
  saveDialog(canvas.render()).props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(canvas.props.blueprint.groups)), [{ id: 'new-group', title: '人物探索', node_ids: ['a', 'b'], collapsed: false }]);
  action(canvas.render(), '折叠组').props.onClick();
  assert.equal(canvas.props.blueprint.groups[0].collapsed, true);
  assert.ok(find(canvas.render(), (node) => node.props?.['data-blueprint-node'] === 'group:new-group'));
  action(canvas.render(), '展开组').props.onClick();
  assert.equal(canvas.props.blueprint.groups[0].collapsed, false);
  action(canvas.render(), '隐藏所选').props.onClick();
  assert.deepEqual(Array.from(canvas.props.blueprint.hidden_node_ids), ['a', 'b']);
  action(canvas.render(), '展开全部').props.onClick();
  assert.deepEqual(Array.from(canvas.props.blueprint.hidden_node_ids), []);
  action(canvas.render(), '解散组').props.onClick();
  assert.deepEqual(Array.from(canvas.props.blueprint.groups), []);
  assert.deepEqual(versions.map((version) => version.parent_id), [null, 'a', 'b']);
});

test('连线备注按子版本保存，框选可选中多个节点且不移动版本', () => {
  const canvas = harness(); canvas.render(); canvas.flush(); canvas.render(); canvas.flush();
  const edge = find(canvas.render(), (node) => node.type === 'path' && node.props.role === 'button');
  edge.props.onClick();
  find(openDialog(canvas.render()), (node) => node.type === 'TextField').props.onChange({ target: { value: '降低背景饱和度' } });
  saveDialog(canvas.render()).props.onClick();
  assert.equal(canvas.props.blueprint.edge_notes.b, '降低背景饱和度');
  find(canvas.render(), (node) => node.type === 'ToggleButtonGroup').props.onChange(null, 'select');
  surface(canvas.render()).props.onPointerDown(canvas.event(null, 0, 0));
  surface(canvas.render()).props.onPointerMove(canvas.event(null, 1200, 700));
  surface(canvas.render()).props.onPointerUp(canvas.event(null, 1200, 700));
  assert.equal(action(canvas.render(), '选中成组').props.disabled, false);
  action(canvas.render(), '隐藏所选').props.onClick();
  assert.deepEqual(Array.from(canvas.props.blueprint.hidden_node_ids), ['a', 'b', 'c']);
  assert.equal(canvas.props.blueprint.edge_notes.b, '降低背景饱和度');
  assert.deepEqual(Object.keys(canvas.props.blueprint.positions), []);
});


test('绿色标记只跟随当前创作节点，右键提供节点动作且图片不裁剪', () => {
  const canvas = harness(); canvas.props.activeVersionId = 'a';
  canvas.render(); canvas.flush(); canvas.render(); canvas.flush();
  const event = canvas.event('b', 180, 160);
  event.preventDefault = () => {};
  surface(canvas.render()).props.onContextMenu(event);
  const tree = canvas.render();
  assert.equal(find(tree, (node) => node.props?.['data-blueprint-node'] === 'a').props['data-active-version'], true);
  assert.equal(find(tree, (node) => node.props?.['data-blueprint-node'] === 'b').props['data-active-version'], undefined);
  assert.equal(find(tree, (node) => node.props?.component === 'img').props.sx.objectFit, 'contain');
  assert.equal(find(tree, (node) => node.type === 'Menu').props.open, true);
  const applied = [];
  canvas.props.onApply = (version) => applied.push(version.id);
  find(canvas.render(), (node) => node.type === 'MenuItem' && node.props.children === '应用所有参数').props.onClick();
  assert.deepEqual(applied, ['b']);
  assert.equal(canvas.props.activeVersionId, 'a');
});
