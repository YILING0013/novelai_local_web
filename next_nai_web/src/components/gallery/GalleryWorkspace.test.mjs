import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const translation = (key) => key;
const exportDirectory = 'E:\\metadata-exports';
const fixture = { id: 'image-1', title: 'Example', filename: 'example.png', url: '/image.png', thumbnail_url: '/thumb.png', prompt: 'girl, artist:example, sunset', negative_prompt: 'lowres', style_prompt: 'artist:example', parameters: { seed: 42, steps: 28, model: 'nai-diffusion-4-5-full' }, metadata: {}, width: 832, height: 1216 };

function renderComponent(filename, props, apiOverrides = {}) {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const events = [];
  const listeners = {};
  const storage = new Map();
  const selection = { anchorNode: 'prompt', focusNode: 'prompt', text: 'artist:example', toString() { return this.text; }, removeAllRanges() { this.text = ''; } };
  const api = {
    getGallery: async () => ({ items: [fixture], total: 1, has_more: false }),
    getGalleryGroups: async () => ({ groups: [] }),
    getGalleryEntry: async () => fixture,
    getLocalDirectories: async () => ({ path: exportDirectory, parent: 'E:\\', directories: [], roots: [{ name: 'E:', path: 'E:\\' }], suggested_export_directory: exportDirectory }),
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
    getSelection: () => selection,
  };
  const dependencies = {
    react: { ...React, useState: useSlot, useRef: (initial) => useSlot(() => ({ current: initial }))[0], useCallback: (callback, deps) => {
      const [previous, update] = useSlot(null);
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) { update({ callback, deps }); return callback; }
      return previous.callback;
    },
      useEffect: (effect, deps) => {
        const [old, update] = useSlot(null);
        if (!old || deps.some((value, index) => value !== old[index])) { effects.push(effect); update(deps); }
      } },
    '@mui/material': new Proxy({}, { get: (_, key) => key === 'useTheme' ? () => ({ breakpoints: { up: (name) => name } }) : key === 'useMediaQuery' ? () => false : key }),
    '@mui/icons-material': new Proxy({}, { get: (_, key) => key }),
    '@/utils/ApiClient': { __esModule: true, default: api },
    '@/utils/browserCapabilities.mjs': { copyTextToClipboard: async () => {} },
    '@/i18n/I18nProvider': { useI18n: () => ({ t: translation }) },
    './GalleryDetailDialog': { __esModule: true, default: 'GalleryDetailDialog' },
    './GalleryMetadataDialog': { __esModule: true, default: 'GalleryMetadataDialog' },
  };
  const load = (source) => {
    const { code } = transformSync(readFileSync(new URL(source, import.meta.url), 'utf8'), {
      filename: source, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' },
    });
    const result = {};
    runInNewContext(code, { exports: result, require: (name) => dependencies[name] || require(name), window,
      document: { addEventListener: (name, listener) => { listeners[name] = listener; }, removeEventListener: () => {} },
      FormData, CustomEvent, structuredClone, IntersectionObserver: class { observe() {} disconnect() {} },
      navigator: { clipboard: { writeText: async () => {} } },
    });
    return result;
  };
  dependencies['./GalleryMetadataFields'] = { ...load('GalleryMetadataFields.js'), __esModule: true, default: 'GalleryMetadataFields' };
  const exports = load(filename);
  return {
    render: () => { cursor = 0; return exports.default(props); },
    flush: async () => { for (const effect of effects.splice(0)) effect(); await new Promise((resolve) => setImmediate(resolve)); },
    storage, events, listeners, exports, selection,
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
  details.props.onApply(fixture, 'positivePrompt');
  assert.deepEqual(JSON.parse(gallery.storage.get('novelai:pending-reference-parameters')), { positivePrompt: fixture.prompt });
  details.props.onApply(fixture, 'negativePrompt');
  assert.deepEqual(JSON.parse(gallery.storage.get('novelai:pending-reference-parameters')), { negativePrompt: fixture.negative_prompt });
  details.props.onApply({ ...fixture, negative_prompt: '' }, 'negativePrompt');
  assert.deepEqual(JSON.parse(gallery.storage.get('novelai:pending-reference-parameters')), { negativePrompt: '' });
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
  assert.equal(save.props.variant, 'contained');
  detail.selection.text = '';
  detail.listeners.selectionchange();
  assert.ok(button(detail.render(), 'gallery.saveSelectedStyle'));
  detail.selection.text = 'artist:example';
  await save.props.onClick();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, fixture.id);
  assert.deepEqual(JSON.parse(JSON.stringify(patches[0].changes)), { style_prompt: 'artist:example' });
  assert.equal(detail.selection.text, '');
  detail.listeners.selectionchange();
  assert.equal(button(detail.render(), 'gallery.saveSelectedStyle') ?? null, null);
  detail.selection.text = 'sunset';
  detail.listeners.selectionchange();
  findNode(detail.render(), (node) => node.type === 'IconButton' && node.props['aria-label'] === 'gallery.clearSelection').props.onClick();
  assert.equal(detail.selection.text, '');
  detail.listeners.selectionchange();
  assert.equal(button(detail.render(), 'gallery.saveSelectedStyle') ?? null, null);
});

test('批量编辑元数据只提交填写的字段，清除模式不带编辑参数', async () => {
  const requests = [];
  const dialog = renderComponent('GalleryMetadataDialog.js', { count: 2, initialParameters: {}, onSubmit: (request) => requests.push(request) });
  dialog.render(); await dialog.flush();
  const positive = findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.positivePrompt');
  positive.props.onChange({ target: { value: 'new prompt' } });
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { mode: 'edit', output_directory: exportDirectory, parameters: { positivePrompt: 'new prompt' } });
  findNode(dialog.render(), (node) => node.type === 'ToggleButtonGroup').props.onChange(null, 'strip');
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), { mode: 'strip', output_directory: exportDirectory });
});

test('元数据树修改保留未知数组与空值，单图另存不提交未改参数', async () => {
  const requests = [];
  const original = { png: { Comment: { prompt: 'old', unknown: [{ active: true, value: null }] } }, exif: {}, stealth: {} };
  const dialog = renderComponent('GalleryMetadataDialog.js', { count: 1, initialParameters: { seed: 42, positivePrompt: 'old' }, initialDocument: original, onSubmit: (request) => requests.push(request) });
  dialog.render(); await dialog.flush();
  const fields = findNode(dialog.render(), (node) => node.type === 'GalleryMetadataFields' && node.props.value === original);
  const edited = { ...original, png: { Comment: { unknown: [{ active: false, value: null }] } } };
  fields.props.onChange(edited, ['png', 'Comment', 'prompt']);
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { mode: 'edit', output_directory: exportDirectory, parameters: {}, metadata_document: edited });
  assert.equal(original.png.Comment.prompt, 'old');
  assert.equal(findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.parametersJson') ?? null, null);
});

test('递归字段按精确路径隐藏重复值，未知字段可编辑且保留合法特殊键', () => {
  const changes = [];
  const value = JSON.parse('{"prompt":"merged","customPrompt":"separate","__proto__":"valid key","enabled":true,"empty":null}');
  const fields = renderComponent('GalleryMetadataFields.js', { value, path: ['png', 'Comment'], hiddenPaths: [['png', 'Comment', 'prompt']], onChange: (next, path) => changes.push({ next, path }) });
  const tree = fields.render();
  assert.equal(findNode(tree, (node) => node.type === 'TextField' && node.props.label === 'gallery.prompt') ?? null, null);
  findNode(tree, (node) => node.type === 'TextField' && node.props.label === '__proto__').props.onChange({ target: { value: 'updated' } });
  assert.equal(Object.hasOwn(changes[0].next, '__proto__'), true);
  assert.equal(changes[0].next.__proto__, 'updated');
  assert.equal(changes[0].next.prompt, 'merged');
  assert.equal(changes[0].next.empty, null);
  findNode(tree, (node) => node.type === 'Switch').props.onChange(null, false);
  assert.equal(changes[1].next.enabled, false);
  assert.ok(findNode(tree, (node) => node.type === 'TextField' && node.props.label === 'customPrompt'));
});

test('主提示词与同一角色重复字段合并，其他角色属性不被隐藏', () => {
  const parameters = { positivePrompt: 'main', characterTabs: [{ prompt: 'girl', center: { x: 0.2, y: 0.8 } }], v4_prompt: { caption: { base_caption: 'main', char_captions: [{ char_caption: 'girl', centers: [{ x: 0.2, y: 0.8 }], custom: 'keep' }] } } };
  const fields = renderComponent('GalleryMetadataFields.js', { value: parameters });
  const hidden = fields.exports.getParameterSharedPaths(parameters).map((path) => JSON.stringify(path));
  assert.ok(hidden.includes(JSON.stringify(['v4_prompt', 'caption', 'base_caption'])));
  assert.ok(hidden.includes(JSON.stringify(['v4_prompt', 'caption', 'char_captions', 0, 'char_caption'])));
  assert.equal(hidden.includes(JSON.stringify(['v4_prompt', 'caption', 'char_captions', 0, 'custom'])), false);
});

test('合并角色优先显示提示词与坐标，原始元数据保持字段和顺序', () => {
  const character = { colorId: 2, center: { x: 0.2, y: 0.8 }, custom: 'keep', position: 'B4', name: '', uc: 'lowres', prompt: 'girl' };
  const canonical = renderComponent('GalleryMetadataFields.js', { value: character, path: ['characterTabs', 0] });
  assert.deepEqual(Array.from(canonical.render().props.children[0], (node) => node.key), ['prompt', 'uc', 'center', 'position', 'custom']);
  const original = renderComponent('GalleryMetadataFields.js', { value: character, path: ['png', 'Comment', 'characterTabs', 0] });
  assert.deepEqual(Array.from(original.render().props.children[0], (node) => node.key), Object.keys(character));
  assert.equal(character.colorId, 2);
});

test('批量模板加载完整详情，融合图库提示词但不补UI尺寸，删除字段仍在模板另存中生效', async () => {
  const requests = [];
  const source = { ...fixture, parameters: { seed: 42, width: 832, height: 1216 }, metadata_document: { png: { Comment: { prompt: 'embedded prompt', seed: 42, custom: { keep: true } } } }, metadata_bindings: [
    { path: ['png', 'Comment', 'prompt'], parameter_path: ['positivePrompt'] },
    { path: ['png', 'Comment', 'seed'], parameter_path: ['seed'] },
  ], metadata_shared_paths: [['png', 'Comment', 'prompt'], ['png', 'Comment', 'seed']] };
  const dialog = renderComponent('GalleryMetadataDialog.js', { count: 2, templateEntries: [fixture], onSubmit: (request) => requests.push(request) }, { getGalleryEntry: async () => source });
  dialog.render(); await dialog.flush();
  findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.batchTemplate').props.onChange({ target: { value: fixture.id } });
  await dialog.flush();
  const fields = findNode(dialog.render(), (node) => node.type === 'GalleryMetadataFields' && node.props.value.png);
  assert.equal(fields.props.value.png.Comment.prompt, fixture.prompt);
  assert.equal(fields.props.value.png.Comment.negativePrompt, fixture.negative_prompt);
  assert.equal(Object.hasOwn(fields.props.value.png.Comment, 'width'), false);
  const edited = structuredClone(fields.props.value);
  delete edited.png.Comment.seed;
  fields.props.onChange(edited, ['png', 'Comment', 'seed']);
  findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.negativePrompt').props.onChange({ target: { value: 'edited negative' } });
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { mode: 'edit', output_directory: exportDirectory, parameters: { negativePrompt: 'edited negative' }, template_metadata_document: edited, template_original_document: fields.props.value });
  assert.equal(source.metadata_document.png.Comment.prompt, 'embedded prompt');
  findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.batchTemplate').props.onChange({ target: { value: '' } });
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), { mode: 'edit', output_directory: exportDirectory, parameters: {} });
});

test('目录浏览可进入子目录并确认，另存也接受用户手填路径', async () => {
  const requests = [];
  const visited = [];
  const child = `${exportDirectory}\\finished`;
  const dialog = renderComponent('GalleryMetadataDialog.js', { count: 1, onSubmit: (request) => requests.push(request) }, {
    getLocalDirectories: async (path) => { visited.push(path); return { path: path || exportDirectory, parent: 'E:\\', directories: path === child ? [] : [{ name: 'finished', path: child }], roots: [{ name: 'E:', path: 'E:\\' }], suggested_export_directory: exportDirectory }; },
  });
  dialog.render(); await dialog.flush();
  button(dialog.render(), 'gallery.browseDirectory').props.onClick(); await dialog.flush();
  assert.deepEqual(visited, ['', '']);
  findNode(dialog.render(), (node) => node.type === 'ListItemButton').props.onClick(); await dialog.flush();
  button(dialog.render(), 'gallery.useDirectory').props.onClick();
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.equal(requests[0].output_directory, child);
  assert.ok(visited.includes(child));
  findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.directoryPath').props.onChange({ target: { value: 'E:\\not-opened' } });
  assert.equal(button(dialog.render(), 'gallery.useDirectory').props.disabled, true);
  findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.outputDirectory').props.onChange({ target: { value: ' E:\\other-exports ' } });
  button(dialog.render(), 'gallery.saveCopy').props.onClick();
  assert.equal(requests[1].output_directory, 'E:\\other-exports');
});
