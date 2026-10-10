import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPromptLanguage, getPromptTargetLanguage, getCachedPromptTranslations, loadPromptTranslations, retryPromptTranslations } from './promptTranslation.mjs';

test('含汉字的假名日文优先识别为日文，自动方向中文转英文、其他转中文', () => {
  assert.equal(detectPromptLanguage('桜の花カタカナ'), 'ja');
  assert.equal(detectPromptLanguage('青い空'), 'ja');
  assert.equal(detectPromptLanguage('한국어 漢字'), 'ko');
  assert.equal(getPromptTargetLanguage('蓝色天空', 'auto'), 'en');
  assert.equal(getPromptTargetLanguage('桜の花カタカナ', 'auto'), 'zh');
  assert.equal(getPromptTargetLanguage('un ciel bleu', 'auto'), 'zh');
  assert.equal(getPromptTargetLanguage('蓝色天空', 'ko'), 'ko');
});

test('完整词库优先，重复及并发词条只请求一次，编辑只翻译新增内容', async (t) => {
  const requests = [];
  const dictionaryCalls = [];
  const lookup = async (tags) => {
    dictionaryCalls.push(tags);
    return { translations: Object.fromEntries(tags.filter((key) => key === 'sample (series)').map((key) => [key, '词库角色'])) };
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = JSON.parse(options.body);
    const source = JSON.parse(request.messages[0].content.split('[源文]\n')[1].split('\n\n')[0]);
    requests.push({ url, options, request, source });
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(Object.keys(source).map((id) => [id, `译文${source[id]}`]))) } }] }) };
  });
  const text = '{sample_(series)}, -1.2::golden sunlight::, golden sunlight。 quiet forest, artist:test';
  await Promise.all([loadPromptTranslations(text, 'auto', lookup), loadPromptTranslations(text, 'auto', lookup)]);
  assert.equal(dictionaryCalls.length, 1);
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.values(requests[0].source), ['golden sunlight', 'quiet forest']);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].request.chat_template_kwargs.enable_thinking, false);
  const cached = getCachedPromptTranslations(text, 'auto');
  assert.equal(cached.translations['sample (series)'], '词库角色');
  assert.equal(cached.translations['golden sunlight'], '译文golden sunlight');
  assert.equal(cached.tags.filter(({ key }) => key === 'golden sunlight').length, 2);
  await loadPromptTranslations(`${text}, new scenery`, 'auto', lookup);
  assert.deepEqual(Object.values(requests[1].source), ['new scenery']);
  assert.deepEqual(getCachedPromptTranslations('new scenery', 'auto').tags.map(({ start, end }) => [start, end]), [[0, 11]]);
});

test('中英文混合按各自方向分组；指定目标独立缓存且长句不会丢弃', async (t) => {
  const prompts = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    prompts.push(prompt);
    const source = JSON.parse(prompt.split('[源文]\n')[1].split('\n\n')[0]);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(Object.keys(source).map((id) => [id, `translation ${id}`]))) } }] }) };
  });
  const lookup = async () => ({ translations: {} });
  await loadPromptTranslations('明亮的夜空, unique mountain scene', 'auto', lookup);
  assert.equal(prompts.length, 2);
  assert.ok(prompts.some((prompt) => prompt.startsWith('请将以下文本翻译成英语')));
  assert.ok(prompts.some((prompt) => prompt.startsWith('请将以下文本翻译成中文')));
  await loadPromptTranslations('unique mountain scene', 'ja', lookup);
  assert.ok(prompts[2].startsWith('请将以下文本翻译成日语'));
  const longText = 'long landscape '.repeat(250).trim();
  await loadPromptTranslations(longText, 'zh', lookup);
  assert.ok(getCachedPromptTranslations(longText, 'zh').translations[longText]);
  const longSource = JSON.parse(prompts[3].split('[源文]\n')[1].split('\n\n')[0]);
  assert.equal(Object.values(longSource).join(' '), longText);
});

test('无效响应不按位置猜测译文，故障期间冷却且手动重试可恢复', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: calls === 1 ? '{"wrong":"串位结果"}' : '{"0":"正确翻译"}' } }] }) };
  });
  const lookup = async () => ({ translations: {} });
  await assert.rejects(loadPromptTranslations('malformed response case', 'zh', lookup));
  assert.equal(Object.keys(getCachedPromptTranslations('malformed response case', 'zh').translations).length, 0);
  await assert.rejects(loadPromptTranslations('malformed response case', 'zh', lookup));
  assert.equal(calls, 1);
  retryPromptTranslations();
  await loadPromptTranslations('malformed response case', 'zh', lookup);
  assert.equal(calls, 2);
  assert.equal(getCachedPromptTranslations('malformed response case', 'zh').translations['malformed response case'], '正确翻译');
});

test('等待词库期间继续输入或关闭翻译，不为旧文本启动机器翻译', async (t) => {
  const controller = new AbortController();
  let completeLookup;
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('旧文本不应触发机器翻译'); });
  const lookup = () => new Promise((resolve) => { completeLookup = resolve; });
  const pending = loadPromptTranslations('cancelled input before translation', 'zh', lookup, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  completeLookup({ translations: {} });
  await pending;
});

test('所有订阅取消后不再发送后续批次，已经成功的词条仍然缓存', async (t) => {
  const controller = new AbortController();
  let finishFirst;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls++;
    const source = JSON.parse(JSON.parse(options.body).messages[0].content.split('[源文]\n')[1].split('\n\n')[0]);
    if (calls === 1) {
      firstStarted();
      await new Promise((resolve) => { finishFirst = resolve; });
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(Object.keys(source).map((id) => [id, `成功${id}`]))) } }] }) };
  });
  const text = Array.from({ length: 25 }, (_, index) => `cancel queued tag ${index}`).join(', ');
  const pending = loadPromptTranslations(text, 'zh', async () => ({ translations: {} }), { signal: controller.signal });
  await started;
  controller.abort();
  finishFirst();
  await pending;
  assert.equal(calls, 1);
  const cached = getCachedPromptTranslations(text, 'zh').translations;
  assert.equal(Object.keys(cached).length, 24);
  assert.equal(cached['cancel queued tag 24'], undefined);
});

test('旧编辑器取消时，其他编辑器仍在等待的共享批次继续完成', async (t) => {
  const controller = new AbortController();
  let finishFirst;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls++;
    const source = JSON.parse(JSON.parse(options.body).messages[0].content.split('[源文]\n')[1].split('\n\n')[0]);
    if (calls === 1) {
      firstStarted();
      await new Promise((resolve) => { finishFirst = resolve; });
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(Object.keys(source).map((id) => [id, `共享结果${id}`]))) } }] }) };
  });
  const text = Array.from({ length: 25 }, (_, index) => `shared queued tag ${index}`).join(', ');
  const lookup = async () => ({ translations: {} });
  const original = loadPromptTranslations(text, 'zh', lookup, { signal: controller.signal });
  await started;
  const current = loadPromptTranslations('shared queued tag 24', 'zh', lookup);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  finishFirst();
  await Promise.all([original, current]);
  assert.equal(calls, 2);
  assert.equal(getCachedPromptTranslations('shared queued tag 24', 'zh').translations['shared queued tag 24'], '共享结果0');
});

test('共享旧请求先失败也等新请求完成，成功的新译文不会漏掉刷新', async (t) => {
  const pendingResponses = new Map();
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    const source = JSON.parse(JSON.parse(options.body).messages[0].content.split('[源文]\n')[1].split('\n\n')[0]);
    return new Promise((resolve) => pendingResponses.set(source[0], resolve));
  });
  const lookup = async () => ({ translations: {} });
  const old = loadPromptTranslations('old delayed failure', 'zh', lookup).catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  let currentSettled = false;
  const current = loadPromptTranslations('old delayed failure, fresh delayed success', 'zh', lookup)
    .finally(() => { currentSettled = true; });
  const currentRejection = assert.rejects(current);
  await new Promise((resolve) => setImmediate(resolve));
  pendingResponses.get('old delayed failure')({ ok: false, status: 503 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentSettled, false);
  pendingResponses.get('fresh delayed success')({ ok: true, json: async () => ({ choices: [{ message: { content: '{"0":"新词成功译文"}' } }] }) });
  await Promise.all([old, currentRejection]);
  assert.equal(getCachedPromptTranslations('fresh delayed success', 'zh').translations['fresh delayed success'], '新词成功译文');
  retryPromptTranslations();
});

test('原型属性同名的普通文本仍正常查询翻译，不读取对象继承属性', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"0":"构造函数"}' } }] }) }));
  assert.equal(getCachedPromptTranslations('constructor', 'zh').translations.constructor, undefined);
  await loadPromptTranslations('constructor', 'zh', async () => ({ translations: {} }));
  assert.equal(getCachedPromptTranslations('constructor', 'zh').translations.constructor, '构造函数');
});

test('故障冷却阻止新请求时，已有成功请求仍被等待并刷新', async (t) => {
  const pendingResponses = new Map();
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    const source = JSON.parse(JSON.parse(options.body).messages[0].content.split('[源文]\n')[1].split('\n\n')[0]);
    return new Promise((resolve) => pendingResponses.set(source[0], resolve));
  });
  const lookup = async () => ({ translations: {} });
  const existing = loadPromptTranslations('cooldown pending success', 'zh', lookup);
  const failure = assert.rejects(loadPromptTranslations('cooldown separate failure', 'zh', lookup));
  await new Promise((resolve) => setImmediate(resolve));
  pendingResponses.get('cooldown separate failure')({ ok: false, status: 503 });
  await failure;
  let settled = false;
  const current = loadPromptTranslations('cooldown pending success, cooldown skipped new', 'zh', lookup)
    .finally(() => { settled = true; });
  const rejection = assert.rejects(current);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(pendingResponses.has('cooldown skipped new'), false);
  pendingResponses.get('cooldown pending success')({ ok: true, json: async () => ({ choices: [{ message: { content: '{"0":"等待的成功结果"}' } }] }) });
  await Promise.all([existing, rejection]);
  assert.equal(getCachedPromptTranslations('cooldown pending success', 'zh').translations['cooldown pending success'], '等待的成功结果');
  retryPromptTranslations();
});
