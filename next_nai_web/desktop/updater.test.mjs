import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createRequire } from 'node:module';

const { transformSync } = createRequire(import.meta.url)('next/dist/build/swc');

const code = transformSync(readFileSync(new URL('./updater.js', import.meta.url), 'utf8'), {
  jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' },
}).code;
function setup(options = {}) {
  const window = new EventTarget();
  const calls = [];
  const exports = {};
  const modules = {
    react: { useEffect() {}, useState() {} },
    '@tauri-apps/api/core': { invoke: async command => { calls.push(command); } },
    '@tauri-apps/api/event': { listen: async () => () => {} },
    '@tauri-apps/plugin-dialog': { confirm: async () => { options.onConfirm?.(window); return options.confirm !== false; } },
    '@/desktop/navigation': { confirmWorkspaceLeave: async () => options.leave !== false },
  };
  runInNewContext(code, { exports, require: name => modules[name], window, Event, CustomEvent, Error });
  return { window, calls, ...exports };
}

test('安装等待全部草稿保存完成', async () => {
  const h = setup();
  let finish;
  h.window.addEventListener('desktop-flush-before-update', event => event.detail.waitUntil(new Promise(resolve => { finish = resolve; })));
  const task = h.installDesktopUpdate(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, []);
  finish();
  assert.equal(await task, true);
  assert.deepEqual(h.calls, ['updater_install']);
});

test('保存失败时保留当前进程', async () => {
  const h = setup();
  h.window.addEventListener('desktop-flush-before-update', event => event.detail.waitUntil(Promise.reject(new Error('DISK_FULL'))));
  await assert.rejects(h.installDesktopUpdate(true), /DISK_FULL/);
  assert.deepEqual(h.calls, []);
});

test('在途任务以及确认期间新启动的任务均阻止安装', async () => {
  for (const before of [true, false]) {
    const block = event => event.preventDefault();
    const h = setup({ onConfirm: window => window.addEventListener('desktop-before-update', block) });
    if (before) h.window.addEventListener('desktop-before-update', block);
    await assert.rejects(h.installDesktopUpdate(true), /UPDATE_WORKSPACE_BUSY/);
    assert.deepEqual(h.calls, []);
  }
});

test('取消安装或保留未保存内容时不退出应用', async () => {
  for (const options of [{ confirm: false }, { leave: false }]) {
    const h = setup(options);
    assert.equal(await h.installDesktopUpdate(false), false);
    assert.deepEqual(h.calls, []);
  }
});
