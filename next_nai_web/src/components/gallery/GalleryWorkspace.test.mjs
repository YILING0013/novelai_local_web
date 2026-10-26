import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import * as versionDiff from './versionDiff.mjs';

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
    getGalleryCollections: async () => ({ collections: [] }),
    getGalleryEntry: async () => fixture,
    getLocalDirectories: async () => ({ path: exportDirectory, parent: 'E:\\', directories: [], roots: [{ name: 'E:', path: 'E:\\' }], suggested_export_directory: exportDirectory }),
    ...apiOverrides,
  };
  const useSlot = (initial) => {
    const position = cursor++;
    if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
    return [slots[position], (next) => { slots[position] = typeof next === 'function' ? next(slots[position]) : next; }];
  };
  const sessionStorage = { setItem: (key, value) => storage.set(key, value) };
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
    '@/utils/browserCapabilities.mjs': { copyTextToClipboard: async () => {}, createClientId: () => 'synthetic-editor-request' },
    '@/i18n/I18nProvider': { useI18n: () => ({ t: translation }) },
    './GalleryDetailDialog': { __esModule: true, default: 'GalleryDetailDialog' },
    './GalleryMetadataDialog': { __esModule: true, default: 'GalleryMetadataDialog' },
    './GalleryVersionsDialog': { __esModule: true, default: 'GalleryVersionsDialog' },
    './VersionBlueprintCanvas': { __esModule: true, default: 'VersionBlueprintCanvas' },
    './VersionSnapshotDetails': { __esModule: true, default: 'VersionSnapshotDetails' },
    './versionDiff.mjs': versionDiff,
  };
  const load = (source) => {
    const { code } = transformSync(readFileSync(new URL(source, import.meta.url), 'utf8'), {
      filename: source, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' },
    });
    const result = {};
    runInNewContext(code, { exports: result, require: (name) => dependencies[name] || require(name), window,
      document: { addEventListener: (name, listener) => { listeners[name] = listener; }, removeEventListener: () => {} },
      FormData, CustomEvent, Event, sessionStorage, structuredClone, IntersectionObserver: class { observe() {} disconnect() {} },
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


test('图库发送图像处理只传本地图片 ID，保留现有绘画参数', async () => {
  const gallery = renderComponent('GalleryWorkspace.js', { source: 'references' });
  gallery.render(); await gallery.flush();
  findNode(gallery.render(), (node) => node.type === 'ButtonBase').props.onClick();
  findNode(gallery.render(), (node) => node.type === 'GalleryDetailDialog').props.onApply(fixture, 'imageProcessing');
  assert.deepEqual(JSON.parse(gallery.storage.get('novelai:pending-image-processing')), {
    id: 'synthetic-editor-request', entryId: fixture.id,
  });
  assert.equal(gallery.storage.has('novelai:pending-reference-parameters'), false);
  assert.deepEqual(gallery.events.map((event) => event.type), ['novelai:image-processing', 'novelai:open-page']);
  assert.equal(gallery.events.at(-1).detail, 'ai-painting');
});

test('作品历史入口保留纯提示词作品，继续版本携带父版本而普通应用不携带', async () => {
  const gallery = renderComponent('GalleryWorkspace.js', { source: 'outputs' });
  gallery.render(); await gallery.flush();
  button(gallery.render(), 'gallery.version.title').props.onClick();
  const dialog = findNode(gallery.render(), (node) => node.type === 'GalleryVersionsDialog');
  assert.deepEqual(Array.from(dialog.props.imageIds), []);
  dialog.props.onContinue({ id: 'version-2', number: 2, parameters: { positivePrompt: 'blue', negativePrompt: 'lowres', seed: 42, image: 'large-image' } }, { id: 'work-1', title: 'Story' });
  assert.deepEqual(JSON.parse(gallery.storage.get('novelai:pending-version')), { work_id: 'work-1', parent_version_id: 'version-2', apply_only: false });
  assert.equal(gallery.storage.has('novelai:pending-reference-parameters'), false);
  assert.deepEqual(gallery.events.map((event) => event.type), ['novelai:continue-version', 'novelai:open-page']);
});

test('智能收藏显示已存条件，用户之后输入的搜索不会被收藏内旧 q 覆盖', async () => {
  const requests = [];
  const gallery = renderComponent('GalleryWorkspace.js', { source: 'references' }, {
    getGallery: async (options) => { requests.push(options); return { items: [fixture], total: 1, has_more: false }; },
    getGalleryCollections: async () => ({ collections: [{ id: 'c1', name: 'Blue', filters: { q: 'old', tags: 'blue eyes', group: '', trash: false } }] }),
  });
  gallery.render(); await gallery.flush();
  button(gallery.render(), 'gallery.smart.filters').props.onClick();
  findNode(gallery.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.smart.collections').props.onChange({ target: { value: 'c1' } });
  gallery.render(); await gallery.flush(); gallery.render(); await gallery.flush();
  const query = findNode(gallery.render(), (node) => node.type === 'TextField' && node.props.placeholder === 'gallery.search');
  query.props.onChange({ target: { value: 'new' } });
  gallery.render(); await gallery.flush(); gallery.render(); await gallery.flush();
  assert.equal(requests.at(-1).q, 'new');
  assert.equal(requests.at(-1).tags, 'blue eyes');
  assert.equal(requests.at(-1).collection_id, '');
  findNode(gallery.render(), (node) => node.type === 'TextField' && node.props.placeholder === 'gallery.search').props.onChange({ target: { value: '' } });
  gallery.render(); await gallery.flush(); gallery.render(); await gallery.flush();
  assert.equal(requests.at(-1).q, '');
  assert.equal(requests.at(-1).collection_id, '');
});

test('版本对话框从任意父版提交并恢复为新版本，参考图不进入可视参数表单', async () => {
  const requests = [];
  const versions = [
    { id: 'v1', parent_id: null, number: 1, created_at: '2026-10-20T00:00:00Z', parameters: { positivePrompt: 'red', seed: 1 }, images: [], message: 'first' },
    { id: 'v2', parent_id: 'v1', number: 2, created_at: '2026-10-21T00:00:00Z', parameters: { positivePrompt: 'blue', seed: 2, image: 'data:image/png;base64,private' }, images: [], message: 'second' },
  ];
  const work = { id: 'w1', title: 'Story' };
  const dialog = renderComponent('GalleryVersionsDialog.js', { open: true, initialWorkId: 'w1' }, {
    getWorks: async () => ({ works: [work] }),
    getWork: async () => ({ work, versions }),
    createWorkVersion: async (id, body) => { requests.push({ id, body }); return { work, version: { ...versions[1], id: 'v3', number: 3 } }; },
  });
  dialog.render(); await dialog.flush(); dialog.render(); await dialog.flush();
  let tree = dialog.render();
  const fields = findNode(tree, (node) => node.type === 'GalleryMetadataFields');
  assert.deepEqual(JSON.parse(JSON.stringify(fields.props.value)), { seed: 2 });
  const canvas = findNode(tree, (node) => node.type === 'VersionBlueprintCanvas');
  canvas.props.onSelect('v1');
  tree = dialog.render();
  findNode(tree, (node) => node.type === 'TextField' && node.props.label === 'gallery.positivePrompt').props.onChange({ target: { value: 'green' } });
  await button(dialog.render(), 'gallery.version.commit').props.onClick();
  assert.equal(requests[0].body.parent_id, 'v1');
  assert.equal(requests[0].body.parameters.positivePrompt, 'green');
  assert.deepEqual(Array.from(requests[0].body.image_ids), []);
  await button(dialog.render(), 'gallery.version.restore').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].body)), { parent_id: 'v2', restore_version_id: 'v1', operation: 'restore', message: 'gallery.version.restoreMessage' });
});

test('蓝图节点选择自动比较父节点，布局备注分组通过独立接口保存', async () => {
  const persisted = [];
  const versions = [
    { id: 'v1', number: 1, parent_id: null, images: [], parameters: { positivePrompt: 'root' } },
    { id: 'v2', number: 2, parent_id: 'v1', images: [{ id: 'img' }], parameters: { positivePrompt: 'changed' } },
  ];
  const blueprint = { positions: {}, edge_notes: {}, hidden_node_ids: [], groups: [] };
  const dialog = renderComponent('GalleryVersionsDialog.js', { open: true, initialWorkId: 'w' }, {
    getWorks: async () => ({ works: [{ id: 'w', title: 'Sketch' }] }),
    getWork: async () => ({ work: { id: 'w', title: 'Sketch' }, versions, blueprint }),
    updateWorkBlueprint: async (id, body) => { persisted.push({ id, body }); return { blueprint: body }; },
  });
  dialog.render(); await dialog.flush(); dialog.render(); await dialog.flush();
  let tree = dialog.render();
  const details = findNode(tree, (node) => node.type === 'VersionSnapshotDetails');
  assert.equal(details.props.selected.id, 'v2');
  assert.equal(details.props.compared.id, 'v1');
  const next = { ...blueprint, edge_notes: { v2: '试试蓝色灯光' }, positions: { v2: { x: 420, y: 80 } } };
  await findNode(tree, (node) => node.type === 'VersionBlueprintCanvas').props.onBlueprintChange(next);
  assert.equal(persisted[0].id, 'w');
  assert.deepEqual(persisted[0].body, next);
  tree = dialog.render();
  assert.deepEqual(findNode(tree, (node) => node.type === 'VersionBlueprintCanvas').props.blueprint, next);
});

test('新作品不创建提示词节点，等待第一张图片', async () => {
  const requests = [];
  const dialog = renderComponent('GalleryVersionsDialog.js', { open: true }, {
    getWorks: async () => ({ works: [] }),
    createWork: async (body) => { requests.push(body); return { work: { id: 'new', title: body.title }, version: null }; },
  });
  dialog.render(); await dialog.flush();
  button(dialog.render(), 'gallery.version.newWork').props.onClick();
  findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.version.workTitle').props.onChange({ target: { value: 'Draft' } });
  assert.ok(!findNode(dialog.render(), (node) => node.type === 'TextField' && node.props.label === 'gallery.positivePrompt'));
  await button(dialog.render(), 'gallery.version.newWork').props.onClick();
  assert.equal(requests[0].title, 'Draft');
  assert.equal(requests[0].parameters, undefined);
  assert.deepEqual(Array.from(requests[0].image_ids), []);
});


test('双节点比较选中组合，单节点比较父级，纯文本不比较且应用参数不切换作品', async () => {
  const versions = [
    { id: 'v1', number: 1, parent_id: null, images: [{ id: 'i1' }], parameters: {} },
    { id: 'v2', number: 2, parent_id: 'v1', images: [{ id: 'i2' }], parameters: {} },
    { id: 'v3', number: 3, parent_id: 'v1', images: [{ id: 'i3' }], parameters: {} },
    { id: 'v4', number: 4, parent_id: 'v2', images: [], parameters: {} },
  ];
  const applied = [], continued = [];
  const dialog = renderComponent('GalleryVersionsDialog.js', {
    open: true, initialWorkId: 'w', activeContext: { work_id: 'w', parent_version_id: 'v2' },
    onApply: (version) => applied.push(version.id), onContinue: (version) => continued.push(version.id),
  }, {
    getWorks: async () => ({ works: [{ id: 'w', title: 'Sketch' }] }),
    getWork: async () => ({ work: { id: 'w', title: 'Sketch' }, versions }),
  });
  dialog.render(); await dialog.flush(); dialog.render(); await dialog.flush();
  const details = () => findNode(dialog.render(), (node) => node.type === 'VersionSnapshotDetails').props;
  const canvas = () => findNode(dialog.render(), (node) => node.type === 'VersionBlueprintCanvas').props;
  assert.equal(details().compared, undefined);
  canvas().onSelect('v2', ['v2']);
  assert.equal(details().compared.id, 'v1');
  canvas().onSelect('v3', ['v2', 'v3']);
  assert.equal(details().selected.id, 'v3');
  assert.equal(details().compared.id, 'v2');
  details().onApply();
  assert.deepEqual(applied, ['v3']); assert.deepEqual(continued, []);
  assert.equal(canvas().activeVersionId, 'v2');
  canvas().onSelect('v4', ['v4']);
  assert.equal(details().compared, undefined);
  canvas().onSelect('v3', ['v3']);
  assert.equal(details().compared.id, 'v1');
});

test('作品批量删除先确认范围，删除当前作品后退出作品状态', async () => {
  const requests = [], contexts = [];
  const works = [{ id: 'w1', title: 'One', version_count: 2 }, { id: 'w2', title: 'Two', version_count: 0 }];
  const dialog = renderComponent('GalleryVersionsDialog.js', { open: true, activeContext: { work_id: 'w1' }, onContextChange: (value) => contexts.push(value) }, {
    getWorks: async () => ({ works }),
    deleteWorks: async (ids) => { requests.push(Array.from(ids)); return { deleted_ids: ids, cleanup_failed: 0 }; },
  });
  dialog.render(); await dialog.flush();
  for (const title of ['One', 'Two']) findNode(dialog.render(), (node) => node.type === 'Checkbox' && node.props.inputProps?.['aria-label'] === '选择作品 ' + title).props.onChange(null, true);
  button(dialog.render(), '删除作品').props.onClick();
  assert.deepEqual(requests, []);
  await button(dialog.render(), '永久删除').props.onClick();
  assert.deepEqual(requests, [['w1', 'w2']]); assert.deepEqual(contexts, [null]);
  assert.ok(!findNode(dialog.render(), (node) => node.type === 'Checkbox' && node.props.inputProps?.['aria-label'] === '选择作品 One'));
});
