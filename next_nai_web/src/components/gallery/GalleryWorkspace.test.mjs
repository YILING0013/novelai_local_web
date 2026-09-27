import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const translation = (key) => key;
const fixture = { id: 'image-1', title: 'Example', filename: 'example.png', url: '/image.png', thumbnail_url: '/thumb.png', prompt: 'girl, artist:example, sunset', negative_prompt: 'lowres', style_prompt: 'artist:example', parameters: { seed: 42, steps: 28, model: 'nai-diffusion-4-5-full' }, metadata: {}, width: 832, height: 1216 };

function renderComponent(filename, props, apiOverrides = {}) {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const events = [];
  const listeners = {};
  const storage = new Map();
  const api = {
    getGallery: async () => ({ items: [fixture], total: 1, has_more: false }),
    getGalleryGroups: async () => ({ groups: [] }),
    getGalleryEntry: async () => fixture,
    ...apiOverrides,
  };
  const useSlot = (initial) => {
    const position = cursor++;
    if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
    return [slots[position], (next) => { slots[position] = typeof next === 'function' ? next(slots[position]) : next; }];
  };
  const window = {
    localStorage: { setItem: (key, value) => storage.set(key, value) },
    dispatchEvent: (event) => events.push(event),
    addEventListener: (name, listener) => { listeners[name] = listener; },
    removeEventListener: () => {},
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout: () => {},
    getSelection: () => ({ anchorNode: 'prompt', focusNode: 'prompt', toString: () => 'artist:example' }),
  };
  const dependencies = {
    react: { ...React, useState: useSlot, useRef: (initial) => useSlot(() => ({ current: initial }))[0], useCallback: (callback) => callback,
      useEffect: (effect, deps) => {
        const [old, update] = useSlot(null);
        if (!old || deps.some((value, index) => value !== old[index])) { effects.push(effect); update(deps); }
      } },
    '@mui/material': new Proxy({}, { get: (_, key) => key === 'useTheme' ? () => ({ breakpoints: { up: (name) => name } }) : key === 'useMediaQuery' ? () => false : key }),
    '@mui/icons-material': new Proxy({}, { get: (_, key) => key }),
    '@/utils/ApiClient': { __esModule: true, default: api },
    '@/i18n/I18nProvider': { useI18n: () => ({ t: translation }) },
    './GalleryDetailDialog': { __esModule: true, default: 'GalleryDetailDialog' },
    './GalleryMetadataDialog': { __esModule: true, default: 'GalleryMetadataDialog' },
  };
  const { code } = transformSync(readFileSync(new URL(filename, import.meta.url), 'utf8'), {
    filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' },
  });
  const exports = {};
  runInNewContext(code, { exports, require: (name) => dependencies[name] || require(name), window,
    document: { addEventListener: (name, listener) => { listeners[name] = listener; }, removeEventListener: () => {} },
    FormData, CustomEvent, IntersectionObserver: class { observe() {} disconnect() {} },
    navigator: { clipboard: { writeText: async () => {} } },
  });
  return {
    render: () => { cursor = 0; return exports.default(props); },
    flush: async () => { for (const effect of effects.splice(0)) effect(); await new Promise((resolve) => setImmediate(resolve)); },
    storage, events, listeners,
  };
}

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((child) => findNode(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return findNode(tree.props?.children, predicate);
}

const button = (tree, label) => findNode(tree, (node) => node.type === 'Button' && node.props.children === label);

test('参考图库一次上传多张图片，标题与提示词留空也会导入', async () => {
  const uploads = [];
  const gallery = renderComponent('GalleryWorkspace.js', { source: 'references' }, {
    importGalleryImages: async (body) => { uploads.push(body); return { items: [fixture, { ...fixture, id: 'image-2' }], errors: [] }; },
  });
  const tree = gallery.render();
  await gallery.flush();
  const input = findNode(tree, (node) => node.type === 'input' && node.props.type === 'file');
  input.props.onChange({ target: { files: [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })], value: '' } });
  await gallery.flush();
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].getAll('files').map((file) => file.name), ['a.png', 'b.png']);
  assert.equal(uploads[0].has('title'), false);
  assert.equal(uploads[0].has('prompt'), false);
});

test('混合大小的批量上传按 60 MiB 和 30 张限制拆分，并保持所有图片顺序', async () => {
  const uploads = [];
  const files = Array.from({ length: 52 }, (_, index) => {
    const file = new File(['image'], `${index}.png`, { type: 'image/png' });
    // 只模拟浏览器提供的大小，避免为请求分批测试分配大块图片数据。
    Object.defineProperty(file, 'size', { value: index < 21 ? 3 * 1024 * 1024 : 1 });
    return file;
  });
  const gallery = renderComponent('GalleryWorkspace.js', { source: 'references' }, {
    importGalleryImages: async (body) => { uploads.push(body.getAll('files').map((file) => file.name)); return { items: [], errors: [] }; },
  });
  const tree = gallery.render();
  await gallery.flush();
  const input = findNode(tree, (node) => node.type === 'input' && node.props.type === 'file');
  input.props.onChange({ target: { files, value: '' } });
  await gallery.flush();
  assert.deepEqual(uploads.map((batch) => batch.length), [20, 30, 2]);
  assert.deepEqual(uploads.flat(), files.map((file) => file.name));
});

test('画风、提示词和全部参数分别应用，不会把种子混入仅提示词操作', async () => {
  const gallery = renderComponent('GalleryWorkspace.js', { source: 'references' });
  gallery.render(); await gallery.flush();
  findNode(gallery.render(), (node) => node.type === 'ButtonBase').props.onClick();
  const details = findNode(gallery.render(), (node) => node.type === 'GalleryDetailDialog');
  details.props.onApply(fixture, 'style');
  assert.equal(gallery.storage.get('novelai:pending-artist-prompt'), 'artist:example');
  details.props.onApply(fixture, 'prompt');
  assert.deepEqual(JSON.parse(gallery.storage.get('novelai:pending-reference-parameters')), { positivePrompt: fixture.prompt, negativePrompt: 'lowres' });
  details.props.onApply(fixture, 'parameters');
  assert.deepEqual(JSON.parse(gallery.storage.get('novelai:pending-reference-parameters')), { ...fixture.parameters, characterTabs: [], positivePrompt: fixture.prompt, negativePrompt: 'lowres' });
  assert.equal(gallery.events.filter((event) => event.type === 'novelai:open-page').length, 3);
});

test('详情中的提示词选段只保存画风，不覆盖完整提示词或生成参数', async () => {
  const patches = [];
  const detail = renderComponent('GalleryDetailDialog.js', { entryId: fixture.id, groups: [], onChanged: () => {} }, {
    updateGalleryEntry: async (id, changes) => { patches.push({ id, changes }); return { ...fixture, ...changes }; },
  });
  detail.render(); await detail.flush();
  const prompt = findNode(detail.render(), (node) => node.type === 'Typography' && node.props.children === fixture.prompt);
  prompt.props.ref.current = { contains: (node) => node === 'prompt' };
  detail.listeners.selectionchange();
  const save = button(detail.render(), 'gallery.saveSelectedStyle');
  assert.equal(save.props.disabled, false);
  await save.props.onClick();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, fixture.id);
  assert.deepEqual(JSON.parse(JSON.stringify(patches[0].changes)), { style_prompt: 'artist:example' });
});

test('批量编辑元数据只提交填写的字段，清除模式不带编辑参数', () => {
  const requests = [];
  const dialog = renderComponent('GalleryMetadataDialog.js', { count: 2, initialParameters: {}, onSubmit: (request) => requests.push(request) });
  const positive = findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.positivePrompt');
  positive.props.onChange({ target: { value: 'new prompt' } });
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { mode: 'edit', parameters: { positivePrompt: 'new prompt' } });
  findNode(dialog.render(), (node) => node.type === 'ToggleButtonGroup').props.onChange(null, 'strip');
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), { mode: 'strip' });
});

test('高级参数 JSON 错误时保留编辑框并阻止另存', () => {
  const requests = [];
  const dialog = renderComponent('GalleryMetadataDialog.js', { count: 1, onSubmit: (request) => requests.push(request) });
  findNode(dialog.render(), (node) => node.type === 'Accordion').props.onChange(null, true);
  findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.parametersJson').props.onChange({ target: { value: '{broken' } });
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.equal(requests.length, 0);
  assert.ok(findNode(dialog.render(), (node) => node.type === 'Alert' && node.props.children === 'gallery.invalidParameters'));
});
