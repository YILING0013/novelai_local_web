import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./ApiClient.js', import.meta.url), 'utf8');
const testableSource = source.replace(
  /^import .*modelUtils';\r?\n/,
  "const isPaintingModelAllowed = (model) => model === 'nai-diffusion-4-5-full';\n",
);
const apiModule = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);
const { ApiClient } = apiModule;

test('标签请求使用 prompt 并只附加白名单模型', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ tags: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const client = new ApiClient();

  await client.getPrompt('1 girl', 'nai-diffusion-4-5-full');
  await client.getPrompt('landscape', 'unsupported-model');

  assert.equal(
    requests[0].url,
    '/api/images/tags?prompt=1+girl&model=nai-diffusion-4-5-full',
  );
  assert.equal(requests[1].url, '/api/images/tags?prompt=landscape');
});

test('卸载批次删除请求可启用 keepalive', async (t) => {
  let requestOptions = null;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requestOptions = options;
    return new Response(JSON.stringify({ cancelled: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const client = new ApiClient();

  await client.cancelImageBatch('batch-on-unmount', true);

  assert.equal(requestOptions.method, 'DELETE');
  assert.equal(requestOptions.keepalive, true);
  assert.equal(requestOptions.body, JSON.stringify({ batch_id: 'batch-on-unmount' }));
});
