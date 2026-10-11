import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./AIPaintingPage.js', import.meta.url), 'utf8');
const start = source.indexOf('  const handleGenerate = async () => {');
const implementation = source.slice(start, source.indexOf('  // 添加取消批量生成', start));

function generationScenario({ count = 1, fail = false, saveError = null, cancel = false } = {}) {
  const target = { pageId: 'page-one', panelId: 'frame-one', panelNumber: 1 };
  const comicTargetRef = { current: target };
  const comicFlightRef = { current: null };
  const requests = [], deliveries = [], notices = [], delays = [], cancelled = [];
  const params = { model: 'nai-diffusion-4-5-full', width: 1152, height: 768, seed: '42', batchSize: count, positivePrompt: 'first frame', reference: { data: 'retained' } };
  let saved = 0;
  let busy = false;
  const context = {
    imageToolBusyRef: { current: false }, comicTargetRef, comicFlightRef,
    isGenerating: false, isMobile: false, mobileDrawerOpen: false,
    leftPanelMode: 'comic', generationParams: params,
    getAllParametersRef: { current: () => params },
    saveComicTask: () => { saved += 1; },
    setComicGenerationBusy: (value) => { busy = value; },
    setComicEditorOpen() {}, createClientId: () => 'synthetic-batch',
    generate: async (request) => {
      requests.push(request);
      // 图像返回前切到另一个画框；在途参数与接收目标必须不变。
      comicTargetRef.current = { pageId: 'page-two', panelId: 'frame-two', panelNumber: 2 };
      if (cancel) comicFlightRef.current.cancelled = true;
      if (fail) throw new Error('UPSTREAM_FAILED');
      return { cachedBlob: {}, saveError };
    },
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/png;base64,synthetic'; this.onload(); }
    },
    window: {
      Image: class {
        naturalWidth = 1152;
        naturalHeight = 768;
        set src(_value) { this.onload(); }
      },
      setTimeout(callback, duration) { delays.push(duration); callback(); },
    },
    comicWorkspaceRef: { current: { receiveGeneratedImage: async (delivery) => { deliveries.push(delivery); return true; } } },
    showNotification: (...args) => notices.push(args),
    comicText: { received: 'received', missing: 'missing' },
    t: (key) => key,
    apiClient: { cancelImageBatch: async (id) => cancelled.push(id) },
    console: { error() {} },
    getWorkspaceErrorMessage: () => 'generation-failed',
    WORKSPACE_ERROR_KEYS: {},
    createWorkspaceError: (code) => Object.assign(new Error(code), { code }),
  };
  const generate = runInNewContext(`${implementation}\nhandleGenerate`, context);
  return { generate, requests, deliveries, notices, delays, cancelled, comicFlightRef,
    state: () => ({ saved, busy }), params };
}

test('漫画生成固定最初画框和参数，连续生成沿用本地批次标识及 15 秒间隔', async () => {
  const scenario = generationScenario({ count: 2 });
  await scenario.generate();
  assert.equal(scenario.requests.length, 2);
  assert.deepEqual(scenario.delays, [15_000]);
  scenario.requests.forEach((request, index) => {
    assert.equal(request.positivePrompt, 'first frame');
    assert.equal(request.reference.data, 'retained');
    assert.equal(request.getLatestParams, undefined);
    assert.equal(request.batch_id, 'synthetic-batch');
    assert.equal(request.index, index);
    assert.equal(request.batch_size, 2);
    assert.equal(request.batchSize, 1);
  });
  assert.ok(scenario.deliveries.every((item) => item.pageId === 'page-one' && item.panelId === 'frame-one'));
  assert.equal(scenario.notices.at(-1)[0], 'received');
  assert.equal(scenario.comicFlightRef.current, null);
  assert.deepEqual(scenario.state(), { saved: 1, busy: false });
});

test('磁盘保存失败仍保留已返回的图像，明确警告并停止后续生成', async () => {
  const scenario = generationScenario({ count: 3, saveError: 'LOCAL_IMAGE_SAVE_FAILED' });
  await scenario.generate();
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.deliveries.length, 1);
  assert.deepEqual(scenario.notices.at(-1), ['librarySettings.saveFailed', 'warning', false]);
  assert.deepEqual(scenario.cancelled, ['synthetic-batch']);
  assert.equal(scenario.state().busy, false);
});

test('取消不丢失在途结果，失败不回填，两种情况都结束批次并允许后续操作', async () => {
  for (const options of [{ cancel: true }, { fail: true }]) {
    const scenario = generationScenario({ count: 3, ...options });
    await scenario.generate();
    assert.equal(scenario.requests.length, 1);
    assert.equal(scenario.deliveries.length, options.fail ? 0 : 1);
    assert.deepEqual(scenario.cancelled, ['synthetic-batch']);
    assert.equal(scenario.comicFlightRef.current, null);
    assert.equal(scenario.state().busy, false);
    assert.equal(scenario.notices.at(-1)[0], options.fail ? 'generation-failed' : 'painting.workspace.notifications.batchCancelled');
  }
});
