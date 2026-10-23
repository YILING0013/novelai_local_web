import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { applyComicAIImage, buildComicAIParams, buildComicAISections, comicAISectionFingerprint, positionComicAIControls, validateComicAIPlan } from './comicAI.mjs';
import { createComicPage } from './comicDocument.mjs';
import { buildComicLetteringElements } from './comicLettering.mjs';

const source = readFileSync(new URL('./ComicAIStudio.js', import.meta.url), 'utf8');
const defaultsStart = source.indexOf('const initialInput =');
const initialInput = runInNewContext(`${source.slice(defaultsStart, source.indexOf('\nconst terminal', defaultsStart))}\ninitialInput`);
const start = source.indexOf('  async function persist(');
const implementation = source.slice(start, source.indexOf('  const references =', start));
const workspaceSource = readFileSync(new URL('./ComicWorkspace.js', import.meta.url), 'utf8');
const workspaceStart = workspaceSource.indexOf('  function getAIPage(');
const workspaceImplementation = workspaceSource.slice(workspaceStart, workspaceSource.indexOf('  async function savePage()', workspaceStart));
const loadInputStart = source.indexOf('  useEffect(() => {\n    if (!open || flight.current) return;');
const loadInputEffect = source.slice(loadInputStart + '  useEffect(() => {'.length, source.indexOf('  }, [open, page?.id]);', loadInputStart));

test('新任务按有效订阅选择写作模型，保留已存草稿并忽略关闭后的账户返回', async () => {
  for (const { subscription, savedModel, expected, close } of [
    { subscription: { active: true, tier: 3 }, expected: 'xialong-v1' },
    { subscription: { active: true, tier: 2 }, expected: 'glm-4-6' },
    { subscription: { active: false, tier: 3 }, expected: 'glm-4-6' },
    { subscription: { active: true, tier: 3 }, savedModel: 'glm-4-6', expected: 'glm-4-6' },
    { subscription: { active: true, tier: 3 }, expected: 'glm-4-6', close: true },
  ]) {
    const currentPage = { id: 'page-one', ...(savedModel ? { aiDraft: { ...initialInput, model: savedModel } } : {}) };
    let input, opus = false, modelReady = false, resolveAccount;
    const account = new Promise((resolve) => { resolveAccount = resolve; });
    const cleanup = runInNewContext(`(() => {${loadInputEffect}})()`, {
      open: true, page: currentPage, initialInput,
      flight: { current: null }, displayedPageId: { current: null }, workflowRef: { current: null }, modelSelected: { current: false },
      callbacks: { current: { getPage: () => currentPage } }, apiClient: { getAccount: () => account },
      setWorkflow() {}, setError() {}, setJob() {},
      setInput: (next) => { input = typeof next === 'function' ? next(input) : next; },
      setOpus: (value) => { opus = value; }, setModelReady: (value) => { modelReady = value; },
    });
    assert.equal(modelReady, false);
    input = { ...input, text: '账户查询期间继续输入的新故事' };
    if (close) cleanup();
    resolveAccount({ account_snapshot: { subscription } });
    await account;
    assert.equal(input.model, expected);
    assert.equal(input.text, '账户查询期间继续输入的新故事');
    assert.equal(modelReady, !close);
    assert.equal(opus, !close && subscription.active && subscription.tier === 3);
  }
});

/** 执行真实工作流函数和画布回填函数，只替换网络、图片解码和磁盘存储。 */
function studioScenario({ count = 1, failGeneration = null, input: inputOverrides = {}, hooks = {}, llmSettings = null } = {}) {
  const first = { ...createComicPage(count === 2 ? 'spreadPortrait' : 'portrait'), id: 'page-one' };
  const second = { ...createComicPage(), id: 'page-two' };
  const plan = { version: 1, summary: '清晨旅行', storyDraft: '旅人在清晨出发，沿街走向车站。', visualStyle: '1.25::artist:example::, watercolor', planningModels: { story: 'xialong-v1', extract: 'glm-4-6', format: 'glm-4-6' }, characters: [], sections: Array.from({ length: count }, (_, id) => ({
    id, width: count === 2 ? 1216 : 832, height: count === 2 ? 832 : 1216,
    globalPrompt: `comic section ${id}`, negativePrompt: '',
    panels: [{ id: `p${id}`, number: 1, summary: '街道远景' }],
    instances: [{ id: `i${id}`, panelId: `p${id}`, characterId: null, prompt: 'morning street', negativePrompt: '', center: { x: 0.5, y: 0.5 } }],
    dialogues: [],
  })) };
  const input = { ...initialInput, text: '清晨旅行', ...inputOverrides };
  const initialWorkflow = { version: 1, id: 'previous-plan', sourceInput: input, plan, sections: {} };
  first.aiWorkflow = initialWorkflow;
  const pageRef = { current: first }, pagesRef = { current: [first, second] };
  const history = { current: { undo: [], redo: [] } };
  const requests = [], planRequests = [], localJobs = [], deliveries = [], errors = [], cancelledBatches = [], events = [], delays = [], busyChanges = [], progress = [];
  const assets = new Map();
  let busy = false, sequence = 0, scenario;
  const workspace = runInNewContext(`${workspaceImplementation}\n({ getAIPage, updateAIPage, applyAIResult })`, {
    pageRef, pagesRef, history, deletingPages: { current: new Set() },
    replacePage: (next, record = true) => {
      if (record) { history.current.undo.push(pageRef.current); history.current.redo = []; }
      pageRef.current = next;
    }, setPages() {},
    saveComicPage: async (next) => ({ order: next.order || 0, updatedAt: next.updatedAt }), saveComicDraft: async () => {}, choose() {},
    applyComicAIImage, comicAISectionFingerprint, buildComicLetteringElements,
  });
  const workflowRef = { current: initialWorkflow }, flight = { current: null }, displayedPageId = { current: first.id };
  const callbacks = { current: {
    getPage: workspace.getAIPage,
    onUpdatePage: workspace.updateAIPage,
    onApplyResult: async (delivery) => {
      const result = await workspace.applyAIResult(delivery);
      deliveries.push({ ...delivery, applied: result.applied });
      await hooks.applied?.(scenario, delivery, result);
      return result;
    },
    onBusyChange: (value) => busyChanges.push(value),
  } };
  const context = {
    page: first, input, isGenerating: false, generationBusy: false, llmSettings,
    workflowRef, flight, displayedPageId, callbacks,
    terminal: new Set(['completed', 'failed', 'cancelled']),
    structuredClone, Date, Object, Set, Promise,
    createClientId: () => `task-${++sequence}`,
    buildComicAIParams, buildComicAISections, comicAISectionFingerprint, positionComicAIControls, validateComicAIPlan,
    w: (zh) => zh, errorMessage: (cause) => cause.message,
    setWorkflow() {}, setBusy: (value) => { busy = value; }, setProgress: (value) => progress.push(value), setJob() {},
    setError: (value) => { if (value) errors.push(value); },
    setTimeout: (callback, delay) => { delays.push(delay); callback(); },
    window: { dispatchEvent: (event) => events.push(event.type) }, Event: class { constructor(type) { this.type = type; } },
    readAIImage: async (value) => typeof value === 'object' ? value : assets.get(value),
    generate: async (params) => {
      const sectionId = flight.current.sectionId;
      requests.push({ sectionId, params });
      await hooks.generate?.(scenario, sectionId, requests.length);
      if (requests.length === failGeneration) throw new Error('IMAGE_REQUEST_FAILED');
      return { cachedBlob: { dataUrl: `data:image/png;base64,original-${sectionId}-${requests.length}`, width: params.width, height: params.height }, seed: requests.length, savedFile: `image-${requests.length}.png` };
    },
    apiClient: {
      request: async (path, options) => {
        if (path === '/comic/plan') {
          planRequests.push(options.body);
          events.push('plan');
          await hooks.plan?.(scenario);
          return { plan: structuredClone(plan) };
        }
        assert.equal(path, '/local/inference/jobs');
        const body = options.body;
        localJobs.push(body);
        events.push(body.action);
        if (body.action === 'load') {
          await hooks.load?.(scenario);
          return { id: 'load-model', status: 'completed', result: {} };
        }
        const sectionId = flight.current.sectionId;
        await hooks.lettering?.(scenario, sectionId);
        const section = plan.sections[sectionId];
        const image = { dataUrl: `data:image/png;base64,cleaned-${sectionId}`, width: section.width, height: section.height };
        const imageUrl = `local:cleaned-${sectionId}`, maskUrl = `local:mask-${sectionId}`;
        assets.set(imageUrl, image); assets.set(maskUrl, image);
        return { id: `lettering-${sectionId}`, status: 'completed', result: { image: { url: imageUrl }, mask: { url: maskUrl }, blocks: [], unmatchedDialogueIds: [] } };
      },
      cancelImageBatch: async (id) => cancelledBatches.push(id),
    },
  };
  const controls = runInNewContext(`${implementation}\n({ run, cancel, applyPending })`, context);
  scenario = {
    controls, requests, planRequests, localJobs, deliveries, errors, cancelledBatches, events, delays, busyChanges, progress, flight, workflowRef,
    getPage: workspace.getAIPage,
    currentPage: () => pageRef.current,
    state: () => ({ busy, flight: flight.current }),
    selectPage: (id) => {
      pageRef.current = workspace.getAIPage(id); context.page = pageRef.current;
      if (!flight.current) displayedPageId.current = id;
    },
    editSection: (id) => workspace.updateAIPage('page-one', (current) => {
      const editable = current.panels.find((panel) => panel.section === id && panel.comicAIRole !== 'original');
      return { ...current, panels: current.panels.map((panel) => panel.id === editable.id ? { ...panel, borderWidth: 17 } : panel) };
    }),
  };
  return scenario;
}

test('先编排不生图，确认预览后使用调整坐标且不重复请求文字模型', async () => {
  const scenario = studioScenario();
  await scenario.controls.run('plan');
  assert.equal(scenario.requests.length, 0);
  assert.equal(scenario.localJobs.length, 0);
  assert.equal(scenario.planRequests.length, 1);
  scenario.workflowRef.current.plan.sections[0].instances[0].center = { x: 0.25, y: 0.75 };
  await scenario.controls.run('resume');
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.planRequests.length, 1);
  assert.deepEqual(scenario.requests[0].params.characterControl.characterPrompts[0].center, { x: 0.25, y: 0.75 });
});

test('区域擦除和自定义文本原样交给本地重建，重复应用只读取原图且不再付费生图', async () => {
  const scenario = studioScenario();
  await scenario.controls.run('full');
  const original = scenario.workflowRef.current.sections[0].originalImage.dataUrl;
  const assignments = { 'text-one': { action: 'erase' }, 'text-two': { action: 'replace', text: '新的对白', direction: 'vertical-rl' } };
  scenario.workflowRef.current.sections[0].assignments = assignments;
  await scenario.controls.run('rebuild', 0);
  await scenario.controls.run('rebuild', 0);
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.planRequests.length, 1);
  assert.deepEqual(scenario.localJobs.filter((job) => job.action === 'comic-lettering').map((job) => job.image), [original, original, original]);
  assert.deepEqual(scenario.localJobs.at(-1).assignments, assignments);
  assert.deepEqual(scenario.errors, []);
});

test('一键流程通过同一请求编排故事、画风人物和分镜，保留三阶段信息并回填图像', async () => {
  const scenario = studioScenario({ input: { model: 'xialong-v1' } });
  await scenario.controls.run('full');
  assert.deepEqual(scenario.events.slice(0, 3), ['load', 'plan', 'comic-lettering']);
  assert.equal(scenario.events.filter((event) => event === 'plan').length, 1);
  assert.equal(scenario.planRequests[0].model, 'xialong-v1');
  assert.ok(scenario.progress.includes('正在写故事、整理画风与人物并设计分镜（Xialong + GLM 4.6）'));
  const retainedPlan = scenario.getPage('page-one').aiWorkflow.plan;
  assert.equal(retainedPlan.storyDraft, '旅人在清晨出发，沿街走向车站。');
  assert.equal(retainedPlan.visualStyle, '1.25::artist:example::, watercolor');
  assert.deepEqual(retainedPlan.planningModels, { story: 'xialong-v1', extract: 'glm-4-6', format: 'glm-4-6' });
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.deliveries.length, 2);
  assert.ok(scenario.deliveries[0].image.dataUrl.includes('original-0'));
  assert.ok(scenario.deliveries[1].image.dataUrl.includes('cleaned-0'));
  const state = scenario.getPage('page-one').aiWorkflow.sections[0];
  assert.equal(state.status, 'completed');
  assert.ok(state.originalImage.dataUrl.includes('original-0'));
  assert.ok(state.cleanedImage.dataUrl.includes('cleaned-0'));
  assert.deepEqual(scenario.errors, []);
  assert.deepEqual(scenario.busyChanges, [true, false]);
});

test('自定义接口编排时显示所选模型，项目和编排请求不携带连接配置', async () => {
  const scenario = studioScenario({ llmSettings: { provider: 'claude', baseUrl: 'https://proxy.example.test', model: 'writer-model', storyModel: '' } });
  await scenario.controls.run('plan');
  assert.deepEqual(scenario.errors, []);
  assert.ok(scenario.progress.includes('正在写故事、整理画风与人物并设计分镜（claude · writer-model）'));
  assert.ok(!JSON.stringify(scenario.planRequests).includes('proxy.example.test'));
  assert.ok(!JSON.stringify(scenario.getPage('page-one')).includes('proxy.example.test'));
});

test('仅贴原生prompt即可一键制作，保留权重和人物描述且不注入默认画风', async () => {
  const prompt = '1.25::artist:example::, watercolor, adult woman, red coat, rainy street';
  const scenario = studioScenario({ input: { text: prompt } });
  await scenario.controls.run('full');
  assert.equal(scenario.planRequests.length, 1);
  const sent = scenario.planRequests[0];
  assert.equal(sent.inputType, 'prompt');
  assert.equal(sent.text, prompt);
  assert.equal(sent.characters, '');
  assert.equal(sent.style, '');
  assert.equal(scenario.requests.length, 1, '无需先手动填写分镜或人物再启动生成');
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].status, 'completed');
  assert.deepEqual(scenario.errors, []);
});

test('继续已保存计划时把人物固定外观传入生图，不重新请求故事编排', async () => {
  const scenario = studioScenario();
  const plan = scenario.workflowRef.current.plan;
  plan.characters.push({ id: 'clerk', name: '店员', appearance: 'pink hair, blue eyes, green apron' });
  Object.assign(plan.sections[0].instances[0], { characterId: 'clerk', prompt: 'clerk, close-up of face, smiling' });
  await scenario.controls.run('resume');
  assert.equal(scenario.planRequests.length, 0);
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.requests[0].params.characterControl.characterPrompts[0].prompt, 'pink hair, blue eyes, green apron, clerk, close-up of face, smiling');
  assert.deepEqual(scenario.errors, []);
});

test('编排缺少原故事台词和分镜描述时仍一键生图，不要求模型重编', async () => {
  const scenario = studioScenario({ input: { text: '清晨街边，旅人说：“你好！”' } });
  scenario.workflowRef.current.plan.sections[0].panels = [];
  await scenario.controls.run('full');
  assert.equal(scenario.planRequests.length, 1);
  assert.equal(scenario.requests.length, 1);
  assert.match(scenario.requests[0].params.positivePrompt, /comic section 0/);
  assert.doesNotMatch(scenario.requests[0].params.positivePrompt, /Text:/);
  assert.deepEqual(scenario.errors, []);
});

test('生图在途取消仍保存并交付已计费原图，停止文字推理与第二张生图', async () => {
  const scenario = studioScenario({ count: 2, hooks: { generate: async (current) => current.controls.cancel() } });
  await scenario.controls.run('resume');
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.localJobs.filter((job) => job.action === 'comic-lettering').length, 0);
  assert.equal(scenario.deliveries.length, 1);
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].status, 'cancelled');
  assert.ok(scenario.getPage('page-one').aiWorkflow.sections[0].originalImage);
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[1], undefined);
  assert.equal(scenario.cancelledBatches.length, 1);
  assert.deepEqual(scenario.state(), { busy: false, flight: null });
});

test('双区第二张失败后继续只请求第二张，第一张图与文字结果不重复计费', async () => {
  const scenario = studioScenario({ count: 2, failGeneration: 2 });
  await scenario.controls.run('full');
  const firstImage = scenario.getPage('page-one').aiWorkflow.sections[0].originalImage.dataUrl;
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].status, 'completed');
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[1].status, 'failed');
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[1].generationFailedWithoutImage, true);
  await scenario.controls.run('resume');
  assert.deepEqual(scenario.requests.map((request) => request.sectionId), [0, 1, 1]);
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].originalImage.dataUrl, firstImage);
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[1].status, 'completed');
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[1].generationFailedWithoutImage, undefined);
  assert.equal(scenario.localJobs.filter((job) => job.action === 'comic-lettering').length, 2);
  assert.equal(scenario.events.filter((event) => event === 'plan').length, 1);
  assert.equal(scenario.requests[0].params.batch_id, scenario.requests[1].params.batch_id);
  assert.equal(scenario.requests[2].params.batch_id, undefined);
  assert.equal(scenario.delays.filter((delay) => delay === 500).length, 30);
});

test('重新生图失败保留旧图参数与文字，成功返回新图后先清空旧文字再重建', async () => {
  let previous;
  const scenario = studioScenario({ failGeneration: 2, hooks: {
    generate: async (current, sectionId, attempt) => {
      if (attempt === 1) return;
      const waiting = current.getPage('page-one').aiWorkflow.sections[sectionId];
      assert.equal(waiting.status, 'generating');
      for (const key of ['originalImage', 'cleanedImage', 'maskImage', 'params', 'result', 'assignments', 'taskId']) assert.deepEqual(structuredClone(waiting[key]), previous[key]);
    },
    lettering: async (current, sectionId) => {
      if (current.requests.length !== 3) return;
      const fresh = current.getPage('page-one').aiWorkflow.sections[sectionId];
      assert.ok(fresh.originalImage.dataUrl.includes('original-0-3'));
      assert.notEqual(fresh.taskId, previous.taskId);
      for (const key of ['cleanedImage', 'maskImage', 'result', 'assignments', 'generationFailedWithoutImage']) assert.equal(fresh[key], undefined);
      assert.deepEqual(Object.keys(current.localJobs.at(-1).assignments), []);
    },
  } });
  await scenario.controls.run('resume');
  scenario.workflowRef.current.sections[0].assignments = { 'old-block': 'old-dialogue' };
  previous = structuredClone(scenario.getPage('page-one').aiWorkflow.sections[0]);
  await scenario.controls.run('regenerate', 0);
  const failed = scenario.getPage('page-one').aiWorkflow.sections[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'IMAGE_REQUEST_FAILED');
  assert.equal(failed.generationFailedWithoutImage, true);
  for (const key of ['originalImage', 'cleanedImage', 'maskImage', 'params', 'result', 'assignments', 'taskId']) assert.deepEqual(structuredClone(failed[key]), previous[key]);
  assert.equal(scenario.deliveries.length, 2, '失败的新请求不触碰旧画布');
  await scenario.controls.run('regenerate', 0);
  const completed = scenario.getPage('page-one').aiWorkflow.sections[0];
  assert.equal(completed.status, 'completed');
  assert.ok(completed.originalImage.dataUrl.includes('original-0-3'));
  assert.equal(completed.generationFailedWithoutImage, undefined);
  assert.equal(scenario.requests.length, 3);
  assert.equal(scenario.localJobs.filter((job) => job.action === 'comic-lettering').length, 2);
});

test('本地文字处理失败保留原图，继续时不再次生图或提示未知生图结果', async () => {
  let attempts = 0;
  const scenario = studioScenario({ hooks: { lettering: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('LOCAL_LETTERING_FAILED');
  } } });
  await scenario.controls.run('resume');
  const failed = scenario.getPage('page-one').aiWorkflow.sections[0];
  assert.equal(failed.status, 'failed');
  assert.ok(failed.originalImage);
  assert.equal(failed.generationFailedWithoutImage, false);
  await scenario.controls.run('resume');
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].status, 'completed');
  assert.equal(attempts, 2);
});

test('本地模型预检期间的画布编辑不会被随后原图或文字结果覆盖', async () => {
  const scenario = studioScenario({ hooks: { load: async (current) => current.editSection(0) } });
  await scenario.controls.run('full');
  const target = scenario.getPage('page-one');
  assert.equal(target.panels[0].borderWidth, 17);
  assert.equal(target.aiWorkflow.sections[0].status, 'pending');
  assert.equal(target.aiWorkflow.sections[0].pending, true);
  assert.ok(target.aiWorkflow.sections[0].originalImage);
  assert.ok(target.aiWorkflow.sections[0].cleanedImage);
  assert.ok(scenario.deliveries.every((delivery) => !delivery.applied));
});

test('第一张处理期间修改第二区，第二张仍使用任务发起时基线并保留待应用', async () => {
  const scenario = studioScenario({ count: 2, hooks: { lettering: async (current, sectionId) => {
    if (sectionId === 0) await current.editSection(1);
  } } });
  await scenario.controls.run('resume');
  const target = scenario.getPage('page-one');
  assert.equal(target.aiWorkflow.sections[0].status, 'completed');
  assert.equal(target.aiWorkflow.sections[1].status, 'pending');
  assert.ok(target.panels.some((panel) => panel.section === 1 && panel.borderWidth === 17));
  assert.ok(scenario.deliveries.filter((delivery) => delivery.sectionId === 1).every((delivery) => !delivery.applied));
});

test('原图回填后用户编辑，后续去字结果不覆盖新画布', async () => {
  const scenario = studioScenario({ hooks: { lettering: async (current) => current.editSection(0) } });
  await scenario.controls.run('resume');
  assert.deepEqual(scenario.deliveries.map((delivery) => delivery.applied), [true, false]);
  const target = scenario.getPage('page-one');
  assert.equal(target.aiWorkflow.sections[0].status, 'pending');
  assert.ok(target.panels.some((panel) => panel.comicAIRole === 'image' && panel.borderWidth === 17));
});

test('切页后结果只保存在发起页待应用，返回后显式应用不重新生成', async () => {
  const scenario = studioScenario({ hooks: { generate: async (current) => current.selectPage('page-two') } });
  const otherBefore = JSON.stringify(scenario.getPage('page-two'));
  await scenario.controls.run('resume');
  assert.equal(scenario.currentPage().id, 'page-two');
  assert.equal(JSON.stringify(scenario.getPage('page-two')), otherBefore);
  assert.ok(scenario.deliveries.every((delivery) => delivery.pageId === 'page-one' && !delivery.applied));
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].status, 'pending');
  scenario.selectPage('page-one');
  await scenario.controls.applyPending(0);
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].status, 'completed');
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].pending, false);
  assert.ok(scenario.getPage('page-one').panels.some((panel) => panel.comicAIRole === 'image' && panel.image.dataUrl.includes('cleaned-0')));
});

test('显式应用等待保存时防止重复提交，切页后仍只完成发起页的任务状态', async () => {
  let release, applied;
  const saving = new Promise((resolve) => { release = resolve; });
  const reachedSave = new Promise((resolve) => { applied = resolve; });
  const scenario = studioScenario({ hooks: {
    generate: async (current) => current.selectPage('page-two'),
    applied: async (_current, delivery) => { if (delivery.force) { applied(); await saving; } },
  } });
  await scenario.controls.run('resume');
  scenario.selectPage('page-one');
  const firstApply = scenario.controls.applyPending(0);
  await reachedSave;
  const repeatedApply = scenario.controls.applyPending(0);
  await new Promise(setImmediate);
  assert.equal(scenario.deliveries.filter((delivery) => delivery.force).length, 1);
  assert.equal(scenario.state().busy, true);
  assert.equal(scenario.state().flight.pageId, 'page-one');
  scenario.selectPage('page-two');
  const otherBefore = JSON.stringify(scenario.currentPage());
  release();
  await Promise.all([firstApply, repeatedApply]);
  assert.equal(JSON.stringify(scenario.currentPage()), otherBefore);
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].status, 'completed');
  assert.equal(scenario.getPage('page-one').aiWorkflow.sections[0].pending, false);
  assert.equal(scenario.requests.length, 1);
  assert.deepEqual(scenario.state(), { busy: false, flight: null });
  assert.deepEqual(scenario.busyChanges, [true, false, true, false]);
});
