import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { estimateNovelAIGenerationCost } from './utils/novelAICost.mjs';
import { getPanelResolutionParameters } from './utils/parameterMapping.js';
import { isNovelAIV4OrAboveModel as isV4Model } from './utils/modelUtils.js';
import { panelBounds } from './ComicWorkspace/comicDocument.mjs';

const source = readFileSync(new URL('./AIPaintingPage.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  const handleGenerate = async (');
const implementation = source.slice(start, source.indexOf('  // 添加取消批量生成', start));

test('浏览器错误的新记录和旧记录都使用工作区文案，批量错误保留原分类', () => {
  const handlerStart = source.indexOf('    const handleGlobalError =');
  const handlerSource = source.slice(handlerStart, source.indexOf('\n\n    // 页面加载', handlerStart));
  const notices = [];
  const handle = runInNewContext(`${handlerSource}\nhandleGlobalError`, {
    console: { error() {} }, t: (key) => key, getWorkspaceErrorMessage: () => 'generic',
    getWorkspaceErrorMessageKey: () => 'painting.workspace.errors.generic', showNotification: (...args) => notices.push(args),
  });
  handle({ error: new TypeError('切页异常') });
  assert.equal(notices[0][4].messageKey, 'painting.workspace.errors.generic');
  const dialogSource = readFileSync(new URL('./tools/BatchGeneration/ErrorSummaryDialog.js', import.meta.url), 'utf8');
  const categoryStart = dialogSource.indexOf('const BATCH_CATEGORY_KEYS');
  const categories = dialogSource.slice(categoryStart, dialogSource.indexOf('\n\nconst ErrorSummaryDialog', categoryStart));
  const messageStart = dialogSource.indexOf('  const getErrorMessage =');
  const messageSource = dialogSource.slice(messageStart, dialogSource.indexOf('\n\n  const getErrorText', messageStart));
  const message = runInNewContext(`${categories}\n${messageSource}\ngetErrorMessage`, {
    React: { useCallback: (fn) => fn }, t: (key) => key, GENERATION_ERROR_MESSAGE_KEYS: {},
  });
  assert.equal(message({ source: 'browser', category: 'unknown', code: 'UNKNOWN_ERROR' }), 'painting.workspace.errors.generic');
  assert.equal(message({ source: 'batch', category: 'unknown' }), 'painting.tools.batch.errors.categories.unknown');
});

function generationScenario({ count = 1, fail = false, saveError = null, cancel = false, aiBusy = false, panels = [] } = {}) {
  const target = { pageId: 'page-one', panelId: 'frame-one', panelNumber: 1 };
  const comicTargetRef = { current: target };
  const comicFlightRef = { current: null };
  const requests = [], deliveries = [], notices = [], delays = [], cancelled = [];
  const params = { model: 'nai-diffusion-4-5-full', width: 1152, height: 768, seed: '42', batchSize: count, positivePrompt: 'first frame', reference: { data: 'retained' } };
  let saved = 0;
  let busy = false;
  const context = {
    imageToolBusyRef: { current: false }, comicTargetRef, comicFlightRef, comicAIFlightRef: { current: aiBusy },
    isGenerating: false, isMobile: false, mobileDrawerOpen: false,
    leftPanelMode: 'comic', generationParams: params,
    getAllParametersRef: { current: (snapshot) => snapshot?.request || params },
    saveComicTask: () => { saved += 1; return { request: params }; },
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
    comicWorkspaceRef: { current: { getCurrentPage: () => ({ id: 'page-one', panels, layers: [{ id: 'visible', visible: true, locked: false }, { id: 'locked', visible: true, locked: true }] }), receiveGeneratedImage: async (delivery) => { deliveries.push(delivery); return true; } } },
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
  assert.equal(scenario.delays.reduce((sum, value) => sum + value, 0), 15_000);
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

test('一次按各自保存的参数逐张生成所有可编辑分镜，切页不改变队列目标', async () => {
  const scenario = generationScenario({ panels: [
    { id: 'frame-one', layerId: 'visible' },
    { id: 'frame-locked', layerId: 'locked' },
    { id: 'frame-three', layerId: 'visible', task: { params: { request: { model: 'nai-diffusion-5-full', positivePrompt: 'third frame', width: 832, height: 1216, seed: '75', batchSize: 4 } } } },
  ] });
  await scenario.generate(true);
  assert.equal(scenario.requests.length, 2);
  assert.equal(scenario.requests[0].positivePrompt, 'first frame');
  assert.equal(scenario.requests[1].positivePrompt, 'third frame');
  assert.equal(scenario.requests[1].seed, '75');
  assert.equal(scenario.requests[1].batchSize, 1);
  assert.deepEqual(scenario.deliveries.map((item) => [item.pageId, item.panelId]), [['page-one', 'frame-one'], ['page-one', 'frame-three']]);
  assert.equal(scenario.delays.reduce((sum, value) => sum + value, 0), 15_000);
});

test('AI整页流程占用生成期间不启动另一项画框生成', async () => {
  const scenario = generationScenario({ aiBusy: true });
  await scenario.generate();
  assert.equal(scenario.requests.length, 0);
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

test('全部分镜预估使用当前编辑、各自暂存和未暂存框形，排除隐藏及锁定图层且每框只算一张', () => {
  const costStart = source.indexOf('  const calculateGenerationCost = useCallback(');
  const implementation = source.slice(costStart, source.indexOf('  // 获取按钮状态的函数', costStart));
  const params = { model: 'nai-diffusion-4-5-full', width: 1024, height: 1024, steps: 28, batchSize: 8 };
  const liveAccountSnapshot = { subscription: { active: false } };
  const context = { useCallback: (fn) => fn, estimateNovelAIGenerationCost, isV4Model, panelBounds, getPanelResolutionParameters,
    liveAccountSnapshot, generationParams: params, comicTargetRef: { current: { panelId: 'selected' } }, imageToImageCostParameters: null };
  const estimate = runInNewContext(`${implementation}\ngetComicBatchCost`, context);
  const savedState = { params: { ...params, model: 'nai-diffusion-5-full', strength: 0.5, use_upscale_credits: true }, imagePreview: 'data:image/png;base64,synthetic' };
  const page = { layers: [{ id: 'visible', visible: true, locked: false }, { id: 'locked', visible: true, locked: true }, { id: 'hidden', visible: false }], panels: [
    { id: 'selected', layerId: 'visible', task: { params: { parameterState: { params: { ...params, steps: 50 } } } } },
    { id: 'saved', layerId: 'visible', task: { params: { parameterState: savedState } } },
    { id: 'unsaved', layerId: 'visible', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }] },
    { id: 'locked', layerId: 'locked' }, { id: 'hidden', layerId: 'hidden' },
  ] };
  assert.equal(estimate(page).count, 3);
  assert.equal(estimate(page).total, 54, '当前参数 20 + 暂存图生图 15 + 按框形匹配尺寸 19');
  assert.equal(params.width, 1024, '预估不得改动当前表单');
  assert.equal(savedState.params.batchSize, 8, '预估不得改动暂存任务');
  params.steps = 20;
  assert.equal(estimate(page).total, 46, '修改当前步数会同时更新当前框及未暂存框的预估');
  liveAccountSnapshot.subscription.active = true;
  assert.equal(estimate(page).total, 15, '订阅免费图为 0，暂存的大图仍收费');
  savedState.params.width = 4096;
  savedState.params.height = 4096;
  assert.equal(estimate(page).total, null, '存在超限分镜时不能展示不完整的低价总数');
  assert.equal(estimate({ layers: [], panels: [] }).total, 0);
});
