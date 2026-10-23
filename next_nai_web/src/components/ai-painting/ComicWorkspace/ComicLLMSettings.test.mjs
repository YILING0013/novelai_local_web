import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./ComicLLMSettings.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function save(');
const implementation = source.slice(start, source.indexOf('  const visible =', start));

test('具名 Provider 独立提交密钥，保存后清空草稿且只交付活动模型设置', async () => {
  const settings = { provider: 'openai', baseUrl: 'https://proxy.example.test/v1', model: 'custom-model' };
  const configuration = { activeProviderId: 'team', providers: [{ id: 'team', name: 'Team', enabled: true, settings, hasApiKey: false }] };
  let submitted, cleared, published;
  const controls = runInNewContext(`${implementation}\n({ save })`, {
    configuration, credentials: { team: { apiKey: 'test-key', rememberApiKey: true } }, w: (zh) => zh,
    setBusy() {}, setError() {}, setNotice() {}, setConfiguration() {}, setSaved() {},
    setCredentials: (value) => { cleared = value; }, onChange: (value) => { published = value; },
    apiClient: { request: async (path, options) => {
      assert.equal(path, '/comic/llm-settings'); submitted = options.body;
      return { configuration, settings };
    } },
  });
  await controls.save();
  assert.equal(submitted.credentials.team.apiKey, 'test-key');
  assert.equal(submitted.credentials.team.rememberApiKey, true);
  assert.equal(submitted.configuration.providers[0].hasApiKey, undefined);
  assert.equal(JSON.stringify(cleared), '{}');
  assert.deepEqual(published, settings);
  assert.ok(!JSON.stringify(submitted.configuration).includes('test-key'));
});

test('连接测试指定选中的 Provider，失败保留设置和明确错误', async () => {
  let error = '', busy = false, changed = false, status;
  const controls = runInNewContext(`${implementation}\n({ testConnection })`, {
    selectedId: 'second', w: (zh) => zh, setError: (value) => { error = value; }, setBusy: (value) => { busy = value; }, setNotice() {},
    setTests: (fn) => { status = fn({}); }, onChange: () => { changed = true; },
    apiClient: { request: async (path, options) => {
      assert.equal(path, '/comic/llm-test'); assert.equal(options.body.providerId, 'second');
      throw Object.assign(new Error('LLM_UNAUTHORIZED'), { data: { error: 'Check the API key.' } });
    } },
  });
  await controls.testConnection();
  assert.equal(error, 'Check the API key.'); assert.equal(status.second, 'failed');
  assert.equal(busy, false); assert.equal(changed, false);
});
