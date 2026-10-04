import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./ApiClient.js', import.meta.url), 'utf8');
const apiModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { ApiClient } = apiModule;

test('双语标签查询支持取消，中文释义和工具估价沿用本地会话与 CSRF', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ tags: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  const client = new ApiClient();
  client.setCsrfToken('local-test-csrf');
  const controller = new AbortController();
  await client.getPrompt('1 girl', { signal: controller.signal });
  await client.translatePromptTags(['1girl', '蓝色眼睛'], { signal: controller.signal });
  const estimate = { image_tool: 'enhance', source_width: 1024, source_height: 1024 };
  await client.estimateImageTool(estimate, { signal: controller.signal });
  assert.equal(requests[0].url, '/api/suggest-tags?prompt=1+girl');
  assert.equal(requests[0].options.signal, controller.signal);
  assert.equal(requests[1].url, '/api/translate-tags');
  assert.deepEqual(JSON.parse(requests[1].options.body), { tags: ['1girl', '蓝色眼睛'] });
  assert.equal(requests[2].url, '/api/image-tools/estimate');
  assert.deepEqual(JSON.parse(requests[2].options.body), estimate);
  for (const { options } of requests.slice(1)) {
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.signal, controller.signal);
    assert.equal(options.headers.get('X-CSRF-Token'), 'local-test-csrf');
  }
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

test('目录浏览复用本地会话请求并正确编码Windows路径', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ path: 'E:\\exports', directories: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await new ApiClient().getLocalDirectories('E:\\My Art\\导出');
  const url = new URL(request.url, 'http://localhost');
  assert.equal(url.pathname, '/api/local/directories');
  assert.equal(url.searchParams.get('path'), 'E:\\My Art\\导出');
  assert.equal(request.options.credentials, 'include');
});
