import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { setImmediate as settle } from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import { PAGE_IDS } from '../src/i18n/pageConfig.mjs';

const { transformSync } = createRequire(import.meta.url)('next/dist/build/swc');

function mount(file, { local = false } = {}) {
  const window = new EventTarget();
  const document = new EventTarget();
  document.getElementById = () => ({});
  const slots = [];
  let cursor = 0, effects = [], root, dirty = false;
  let params = new URLSearchParams();
  const state = { confirmed: false, prompts: 0, destroyed: 0, close: null, root: null };
  const t = key => key;
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useCallback: callback => callback,
    useMemo: callback => callback(),
    useEffect(effect, deps) {
      const i = cursor++;
      const old = slots[i];
      if (!old || !deps || deps.some((dep, index) => !Object.is(dep, old.deps?.[index]))) {
        effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  const nativeWindow = {
    label: 'main',
    onCloseRequested(callback) { state.close = callback; return Promise.resolve(() => { state.close = null; }); },
    async destroy() { state.destroyed++; },
  };
  const modules = {
    react: hooks,
    'react-dom': { createPortal: content => content },
    'react-dom/client': { createRoot: () => ({ render: tree => { root = tree; } }) },
    'react-router-dom': {
      HashRouter: 'HashRouter', useLocation: () => ({ pathname: '/main' }), useNavigate: () => () => {},
      useSearchParams: () => [params, next => { params = new URLSearchParams(next); dirty = true; }],
    },
    '@mui/material': new Proxy({
      useTheme: () => ({ breakpoints: { down: () => '' } }),
      useMediaQuery: () => false,
    }, { get: (values, name) => values[name] || name }),
    '@mui/icons-material': new Proxy({}, { get: (_, name) => name }),
    'lucide-react': { PanelLeft: 'PanelLeft' },
    '@tauri-apps/api/window': { getCurrentWindow: () => nativeWindow },
    '@tauri-apps/api/core': { invoke: async () => {} },
    '@tauri-apps/plugin-dialog': { confirm: async () => { state.prompts++; return state.confirmed; } },
    '@/i18n/I18nProvider': { useI18n: () => ({ t, locale: 'zh-CN' }) },
    '@/i18n/pageConfig.mjs': { PAGE_IDS, readPageColor: () => '#000' },
    '@/providers/AppThemeProvider': { useAppTheme: () => ({ mode: 'dark', toggleTheme() {} }) },
    '@/utils/ApiClient': { __esModule: true, default: { getSession: async () => ({ authenticated: true }), getAccount: async () => ({}) } },
    './transport': { installTransport() {} },
  };
  function load(path) {
    const exports = {};
    const { code } = transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' },
    });
    runInNewContext(code, { exports, require: name => modules[name] || { __esModule: true, default: name }, React: hooks,
      window, document, Event, CustomEvent, URL, location: { origin: 'http://fixture' }, localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null } });
    return exports;
  }
  modules['@/desktop/navigation'] = load('../src/desktop/navigation.js');
  const loaded = load(file);
  let Component = loaded.default;
  if (!Component) {
    while (root.props.children) root = root.props.children;
    Component = root.type;
  }
  function render() {
    do {
      dirty = false; cursor = 0; effects = [];
      state.root = Component({ local, onLogin() {} });
      effects.forEach(effect => effect());
    } while (dirty);
    return state.root;
  }
  render();
  return { state, window, render, async close() { const event = new Event('close', { cancelable: true }); await state.close(event); assert.equal(event.defaultPrevented, true); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('绘画工作区从打开到切换页面都保护退出，本机图库不无故拦截', () => {
  const painting = mount('./Workspace.jsx');
  const check = () => { const event = new Event('beforeunload', { cancelable: true }); painting.window.dispatchEvent(event); return event.defaultPrevented; };
  assert.equal(check(), true);
  painting.window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: PAGE_IDS.GALLERY }));
  painting.render();
  assert.equal(check(), true);
  painting.unmount();
  assert.equal(check(), false);
  const tools = mount('./Workspace.jsx', { local: true });
  const event = new Event('beforeunload', { cancelable: true });
  tools.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  tools.unmount();
});

test('取消关窗保留工作区，确认后等待草稿保存，重复关闭只提示一次', async () => {
  const h = mount('./entry.jsx');
  h.window.addEventListener('beforeunload', event => event.preventDefault());
  await h.close();
  assert.equal(h.state.prompts, 1);
  assert.equal(h.state.destroyed, 0);
  h.state.confirmed = true;
  let finish;
  h.window.addEventListener('desktop-flush-before-update', event => event.detail.waitUntil(new Promise(resolve => { finish = resolve; })));
  const closing = h.close();
  await settle();
  await h.close();
  assert.equal(h.state.prompts, 2);
  assert.equal(h.state.destroyed, 0);
  finish(); await closing;
  assert.equal(h.state.destroyed, 1);
  h.unmount();
});

test('草稿保存失败显示错误且不销毁窗口', async () => {
  const h = mount('./entry.jsx');
  h.window.addEventListener('desktop-flush-before-update', event => event.detail.waitUntil(Promise.reject(new Error('DISK_FULL'))));
  await h.close();
  assert.equal(h.state.destroyed, 0);
  assert.ok(JSON.stringify(h.state.root).includes('DISK_FULL'));
  h.unmount();
});
