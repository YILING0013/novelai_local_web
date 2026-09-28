import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const httpCrypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };

function loadModule(path, globals = {}, dependencies = {}) {
  const { code } = transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' },
  });
  const exports = {};
  const requireFromModule = createRequire(new URL(path, import.meta.url));
  runInNewContext(code, { exports, require: (name) => dependencies[name] || requireFromModule(name), crypto: httpCrypto, Date, setTimeout, clearTimeout, ...globals });
  return exports;
}

test('局域网 HTTP 没有 randomUUID 时，实际生成批次仍带有效且独立的 UUID', async () => {
  assert.equal(httpCrypto.randomUUID, undefined);
  const capabilities = loadModule('./browserCapabilities.mjs');
  const batch = loadModule('../components/ai-painting/tools/BatchGeneration/BatchGenerationService.js');
  const requests = [];
  const { default: renderGeneration } = loadModule('../components/ai-painting/Generation/useImageGeneration.js', {}, {
    react: { useCallback: (callback) => callback, useEffect: () => {}, useRef: (initial) => ({ current: initial }), useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] },
    '@/utils/browserCapabilities.mjs': capabilities,
    '@/utils/ApiClient': { cancelImageBatch: async () => {} },
    './ImageGenerationService': { generateImage: async (params) => { requests.push(params); return { success: true, image: '/test.png', width: 832, height: 1216 }; } },
    '../tools/BatchGeneration/BatchGenerationService': batch,
    './errors': loadModule('../components/ai-painting/Generation/errors.js'),
  });
  const hook = renderGeneration();
  const images = [];
  for (let i = 0; i < 2; i += 1) {
    await hook.startBatchGeneration({ batchSize: 1, model: 'nai-diffusion-4-5-full', seed: 42 }, (image) => images.push(image));
  }
  assert.equal(images.length, 2);
  for (const params of requests) {
    assert.match(params.batch_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(params.model, 'nai-diffusion-4-5-full');
    assert.equal(params.batch_size, 1);
  }
  assert.notEqual(requests[0].batch_id, requests[1].batch_id);
});

test('HTTP 文字复制在当前对话框内选择完整文本，完成后清理并恢复焦点', async () => {
  const copied = [];
  let input;
  let removed = false;
  let restored = false;
  const dialog = { appendChild: (element) => { input = element; } };
  const previousFocus = { closest: (selector) => { assert.equal(selector, '[role="dialog"]'); return dialog; }, focus: () => { restored = true; } };
  const document = {
    activeElement: previousFocus,
    body: { appendChild: () => assert.fail('对话框内复制不能把焦点放到对话框外') },
    createElement: (tag) => {
      assert.equal(tag, 'textarea');
      return { style: {}, focus: () => {}, select: () => {}, setSelectionRange: (start, end) => assert.deepEqual([start, end], [0, input.value.length]), remove: () => { removed = true; } };
    },
    execCommand: (command) => { assert.equal(command, 'copy'); copied.push(input.value); return true; },
  };
  const { copyTextToClipboard } = loadModule('./browserCapabilities.mjs', { navigator: {}, document });
  await copyTextToClipboard('正向提示词\nartist:example');
  assert.deepEqual(copied, ['正向提示词\nartist:example']);
  assert.equal(removed, true);
  assert.equal(restored, true);

  document.execCommand = () => false;
  removed = false;
  await assert.rejects(copyTextToClipboard('cannot copy'), /CLIPBOARD_COPY_FAILED/);
  assert.equal(removed, true, '浏览器拒绝复制时也必须清理临时输入框');
});

test('安全上下文优先使用 Clipboard API，无权限时再尝试文本回退', async () => {
  const copied = [];
  const navigator = { clipboard: { writeText: async (text) => copied.push(text) } };
  let fallbackCalls = 0;
  const input = { style: {}, focus() {}, select() {}, setSelectionRange() {}, remove() {} };
  const document = { createElement: () => input, body: { appendChild() {} }, execCommand: () => { fallbackCalls += 1; return true; } };
  const { copyTextToClipboard } = loadModule('./browserCapabilities.mjs', { navigator, document });
  await copyTextToClipboard('HTTPS text');
  assert.deepEqual(copied, ['HTTPS text']);
  assert.equal(fallbackCalls, 0);
  navigator.clipboard.writeText = async () => { throw new Error('NotAllowedError'); };
  await copyTextToClipboard('fallback text');
  assert.equal(fallbackCalls, 1);
  assert.equal(input.value, 'fallback text');
});

test('HTTP 下账户与参考图的 SHA256 和 HMAC 保持 WebCrypto 的 UTF-8 结果', async () => {
  assert.equal(httpCrypto.subtle, undefined);
  const { sha256, hmacSha256 } = loadModule('../components/ai-painting/utils/cryptoUtils.js');
  const encoder = new TextEncoder();
  for (const value of ['', 'ai-painting-owner:测试账户', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA']) {
    const digest = await webcrypto.subtle.digest('SHA-256', encoder.encode(value));
    assert.equal(await sha256(value), Buffer.from(digest).toString('hex'));
  }
  for (const [key, message] of [['0123456789abcdef'.repeat(4), 'data:image/png;base64,测试参考图'], ['密钥', '']]) {
    const cryptoKey = await webcrypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await webcrypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
    assert.equal(hmacSha256(key, message), Buffer.from(signature).toString('hex'));
  }
});
