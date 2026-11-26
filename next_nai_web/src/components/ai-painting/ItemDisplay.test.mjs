import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { setImmediate as settle } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import React from 'react';
import chinese from '../../i18n/locales/painting-workspace.zh-CN.js';
import english from '../../i18n/locales/painting-workspace.en-US.js';
import galleryChinese from '../../i18n/locales/gallery.zh-CN.js';
import galleryEnglish from '../../i18n/locales/gallery.en-US.js';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const theme = require('@mui/material/styles').createTheme();
const compile = (file) => transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  filename: file,
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
  module: { type: 'commonjs' },
}).code;
const displayCode = compile('./ItemDisplay.js');
const sourceSelectCode = compile('../gallery/GallerySourceSelect.js');

function createDisplay(source = 'default', locale = 'zh-CN') {
  const translations = locale === 'zh-CN' ? { ...chinese, ...galleryChinese } : { ...english, ...galleryEnglish };
  const translate = (key, values = {}) => (key.split('.').reduce((value, field) => value?.[field], translations) || key)
    .replace(/\{(\w+)\}/g, (_match, name) => values[name]);
  const slots = [], requests = [], applied = [], effects = [], listeners = new Map();
  let cursor = 0, dirty = false;
  const props = { item: null, active: true, onApplyImageParameters: (parameters) => applied.push(parameters) };
  const emit = (name, detail) => { for (const listener of listeners.get(name) || []) listener({detail}); };
  const dependencies = {
    react: {
      ...React,
      useContext: () => false,
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
      useMemo(factory, deps) {
        const index = cursor++;
        if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { deps, value: factory() };
        return slots[index].value;
      },
      useCallback(callback, deps) { return dependencies.react.useMemo(() => callback, deps); },
      useLayoutEffect(effect, deps) { return dependencies.react.useEffect(effect, deps); },
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
    '@mui/material': new Proxy({}, { get: (_target, name) => name === 'useTheme' ? () => theme : name === 'useMediaQuery' ? () => false : name }),
    '@mui/icons-material': new Proxy({}, { get: (_target, name) => name }),
    '@/i18n/I18nProvider': { useI18n: () => ({ t: translate }) },
    './Generation/GenerationContext': { useGeneration: () => ({ isGenerating: false }) },
    '@/utils/ApiClient': {
      getLocalSettings: async () => ({ inspirationSource: source }),
      saveLocalSettings: async ({ inspirationSource }) => { source = inspirationSource; },
      getGallery: async () => ({ items: [{ id: source, filename: source + '.png', thumbnail_url: '/fixture.png' }], has_more: false }),
      getGalleryEntry: (id) => new Promise((resolve) => requests.push({ id, resolve })),
    },
    './Generation/errorRecords.mjs': { forwardPaintingPanelError() {} },
  };
  const load = (code) => {
    const exports = {};
    runInNewContext(code, {
      exports, React, CustomEvent, document: new EventTarget(), localStorage: { getItem: key => key === 'novelai:inspiration-visible' ? 'true' : null },
      require: (name) => dependencies[name] || {},
      window: {
        innerWidth: 1200,
        dispatchEvent: (event) => emit(event.type, event.detail),
        addEventListener(name, listener) {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name).add(listener);
        },
        removeEventListener: (name, listener) => listeners.get(name)?.delete(listener),
        clearTimeout() {}, setTimeout() { return 1; },
      },
      fetch: async () => ({ ok: true, json: async () => ({
        'inspiration.png': { ai_parameters: { Comment: JSON.stringify({ prompt: 'inspiration', seed: 0 }) } },
      }) }),
    });
    return exports.default;
  };
  dependencies['@/components/gallery/GallerySourceSelect'] = load(sourceSelectCode);
  const Display = load(displayCode);
  const expand = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    const Component = typeof node.type === 'function' ? node.type : node.type?.type;
    if (typeof Component === 'function') return expand(Component(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  };
  return {
    applied, requests, props, emit, translate,
    render() {
      for (let pass = 0; pass < 20; pass += 1) {
        cursor = 0; dirty = false; effects.length = 0;
        const tree = expand(Display(props));
        effects.forEach((effect) => effect());
        if (!dirty) return tree;
      }
      assert.fail('灵感图库状态应稳定');
    },
    async ready() { for (let i = 0; i < 4; i += 1) { this.render(); await settle(); } return this.render(); },
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((node) => find(node, predicate)).find(Boolean) ?? null;
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
const imageButton = (tree) => find(tree, (node) => node.type === 'ButtonBase');
const dialog = (tree) => find(tree, (node) => node.type === 'Dialog');
const confirmButton = (tree) => find(tree, (node) => node.type === 'Button' && node.props.variant === 'contained');
const cancelButton = (tree) => find(tree, (node) => node.type === 'Button' && node.props.autoFocus);

test('默认灵感中英文确认：点击、取消和 Esc 不应用，确认双击只应用一次', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const display = createDisplay('default', locale);
    imageButton(await display.ready()).props.onClick();
    let tree = display.render();
    assert.equal(dialog(tree).props.open, true);
    assert.equal(find(tree, (node) => node.type === 'DialogTitle').props.children, locale === 'zh-CN' ? '应用这张灵感图的参数？' : 'Apply this image’s parameters?');
    assert.equal(cancelButton(tree).props.children, locale === 'zh-CN' ? '取消' : 'Cancel');
    assert.equal(display.applied.length, 0);
    cancelButton(tree).props.onClick();
    await confirmButton(tree).props.onClick();
    assert.equal(display.applied.length, 0);
    assert.equal(dialog(display.render()).props.open, false);
    imageButton(display.render()).props.onClick();
    tree = display.render();
    dialog(tree).props.onClose({}, 'escapeKeyDown');
    assert.equal(display.applied.length, 0);
    assert.equal(dialog(display.render()).props.open, false);
    imageButton(display.render()).props.onClick();
    const confirm = confirmButton(display.render()).props.onClick;
    await Promise.all([confirm(), confirm()]);
    assert.equal(display.applied.length, 1);
    assert.equal(display.applied[0].prompt, 'inspiration');
    assert.equal(display.applied[0].seed, 0);
  }
});

test('个人画风和生成图库确认后才读取参数，重复确认不重复请求，保留空提示词和零种子', async () => {
  for (const source of ['references', 'outputs']) {
    const display = createDisplay(source);
    imageButton(await display.ready()).props.onClick();
    const confirm = confirmButton(display.render()).props.onClick;
    assert.equal(display.requests.length, 0);
    const applying = confirm();
    await confirm();
    assert.equal(display.requests.length, 1);
    assert.equal(display.requests[0].id, source);
    assert.equal(imageButton(display.render()).props.disabled, true);
    display.requests[0].resolve({ parameters: { seed: 0, characterTabs: [] }, prompt: '', negative_prompt: '' });
    await applying;
    assert.equal(display.applied.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(display.applied[0])), { seed: 0, characterTabs: [], positivePrompt: '', negativePrompt: '' });
    assert.equal(imageButton(display.render()).props.disabled, false);
  }
});

test('切换来源、刷新及离开生成页会撤销待确认图，来源切换使已发出的参数读取失效', async () => {
  const display = createDisplay('references');
  imageButton(await display.ready()).props.onClick();
  let tree = display.render();
  find(tree, (node) => node.type === 'TextField' && node.props.select).props.onChange({ target: { value: 'outputs' } });
  await confirmButton(tree).props.onClick();
  assert.equal(display.requests.length, 0);
  tree = await display.ready();
  assert.equal(dialog(tree).props.open, false);
  imageButton(tree).props.onClick();
  tree = display.render();
  await find(tree, (node) => node.props?.['aria-label'] === display.translate('painting.workspace.gallery.refresh')).props.onClick();
  assert.equal(dialog(display.render()).props.open, false);
  imageButton(display.render()).props.onClick();
  display.props.active = false;
  assert.equal(dialog(display.render()).props.open, false);
  display.props.active = true;
  imageButton(await display.ready()).props.onClick();
  const applying = confirmButton(display.render()).props.onClick();
  display.emit('novelai:gallery-source', 'references');
  display.requests[0].resolve({ parameters: { seed: 1 }, prompt: 'old source', negative_prompt: '' });
  await applying;
  assert.equal(display.applied.length, 0);
});
