import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as v5Params from './utils/novelAIV5Params.mjs';
import * as referenceParams from './utils/novelAIReferenceParams.mjs';
import * as promptTokenizer from './PromptEditor/novelAIImageTokenizer.mjs';
import * as parameterMapping from './utils/parameterMapping.js';
import * as versionWorkspace from './utils/versionWorkspace.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { createTheme } = require('@mui/material/styles');
const theme = createTheme();

function compile(file, dependencies, globals = {}) {
  const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    filename: file,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
    module: { type: 'commonjs' },
  });
  const exports = {};
  runInNewContext(code, { exports, require: (name) => dependencies[name], ...globals });
  return exports;
}

const modelUtils = compile('./utils/modelUtils.js', {
  './novelAIV5Params.mjs': v5Params,
  './novelAIReferenceParams.mjs': referenceParams,
});

function createPanel(overrides = {}, cached = {}) {
  const storage = new Map(Object.entries(cached));
  const writes = [];
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  const editorStateRef = { current: null };
  const getAllParametersRef = { current: null };
  const dependencies = {
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = {
          value: typeof initial === 'function' ? initial() : initial,
          set(next) {
            const value = typeof next === 'function' ? next(slots[index].value) : next;
            if (!Object.is(value, slots[index].value)) dirty = true;
            slots[index].value = value;
          },
        };
        return [slots[index].value, slots[index].set];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useMemo(factory, deps) {
        const index = cursor++;
        if (!slots[index] || deps.some((value, offset) => !Object.is(value, slots[index].deps[offset]))) {
          slots[index] = { deps, value: factory() };
        }
        return slots[index].value;
      },
      useCallback(callback) { return callback; },
      useEffect(effect, deps) {
        const index = cursor++;
        if (!slots[index] || deps.some((value, offset) => !Object.is(value, slots[index].deps[offset]))) {
          const previous = slots[index];
          slots[index] = { deps };
          effects.push(() => {
            previous?.cleanup?.();
            slots[index].cleanup = effect();
          });
        }
      },
    },
    '@mui/material': new Proxy({}, { get: (_target, name) => name === 'useTheme' ? () => theme : name }),
    '@mui/icons-material': new Proxy({}, { get: (_target, name) => name }),
    './utils/modelUtils': modelUtils,
    './utils/parameterMapping': parameterMapping,
    './utils/versionWorkspace.mjs': versionWorkspace,
    './PromptEditor/novelAIImageTokenizer.mjs': promptTokenizer,
    './PromptEditor': { extractActiveContent: (value) => value, ExpandedPromptDialog: 'ExpandedPromptDialog' },
    '../../utils/ApiClient': { __esModule: true, default: { getRandomPromptConfig: async () => ({ enabled: false }) } },
    '@/i18n/I18nProvider': { useI18n: () => ({ t: (key) => key }) },
  };
  const imports = new Proxy(dependencies, { get: (target, key) => target[key] || new Proxy(
    { __esModule: true, default: key }, { get: (value, name) => value[name] ?? name },
  ) });
  const component = compile('./ParameterPanel.js', imports, {
    console,
    process: { env: { NODE_ENV: 'test' } },
    setTimeout: (callback) => { callback(); return 1; },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); writes.push(key); },
      removeItem: (key) => { storage.delete(key); writes.push(key); },
    },
  }).default;
  const props = { isolated: true, disableVideo: true, editorStateRef, getAllParametersRef, ...overrides };
  return {
    writes,
    snapshot: () => editorStateRef.current.getSnapshot(),
    request: (snapshot) => getAllParametersRef.current(snapshot),
    update: (next) => Object.assign(props, next),
    render() {
      for (let pass = 0; pass < 25; pass += 1) {
        cursor = 0;
        dirty = false;
        effects = [];
        const tree = component(props);
        effects.forEach((effect) => effect());
        if (!dirty) return tree;
      }
      assert.fail('参数面板应在更新后稳定');
    },
  };
}

function elements(tree, type) {
  const children = React.Children.toArray(tree?.props?.children);
  return [tree?.type === type ? tree : null, ...children.flatMap((child) => elements(child, type))].filter(Boolean);
}

test('历史版本恢复后 V4 精确角色坐标与局部重绘遮罩进入真实请求', () => {
  const saved = {
    params: { model: 'nai-diffusion-4-5-full', width: 1024, height: 1024, aiDecidePosition: false, strength: 0.7 },
    characterTabs: [{ name: 'Hero', prompt: 'blue hair', uc: '', position: 'A4', center: { x: 0.12, y: 0.73 } }],
    imagePreview: 'data:image/png;base64,source',
    restoredMask: { mask: 'data:image/png;base64,mask', inpaintStrength: 0.8, disabledOriginalImage: true, colorCorrect: false },
  };
  const panel = createPanel({ editorState: saved, params: saved.params, positivePrompt: 'rain', negativePrompt: '' });
  const tree = panel.render();
  assert.equal(JSON.stringify(panel.request().characterControl.characterPrompts[0].center), JSON.stringify({ x: 0.12, y: 0.73 }));
  assert.equal(panel.request().imageToImage.mask, saved.restoredMask.mask);
  assert.equal(panel.request().imageToImage.inpaintStrength, 0.8);
  const clearMask = elements(tree, 'Alert').find((alert) => alert.props.children === 'gallery.versionWorkspace.maskRestored')?.props.action;
  assert.ok(clearMask);
  clearMask.props.onClick();
  panel.render();
  assert.equal(panel.request().imageToImage.mask, undefined);
  assert.equal(panel.request().imageToImage.image, saved.imagePreview);
});

test('AI和手动来回切换时恢复同会话最新快照，切换画框时使用新框参数', () => {
  for (const sameSession of [true, false]) {
    const latest = { params: { seed: '42', width: 1216, height: 832 }, imagePreview: 'data:image/png;base64,latest',
      characterTabs: [{ name: '最新角色', prompt: 'blue hair', disabled: true }], referenceImages: [{ id: 'latest-ref', disabled: true }] };
    const stale = { params: { seed: '7', width: 832, height: 1216 } };
    const editorRef = { current: { key: 1, getSnapshot: () => latest } };
    const panel = createPanel({ editorStateRef: editorRef, editorSessionKey: sameSession ? 1 : 2, editorState: stale, params: sameSession ? latest.params : stale.params });
    panel.render();
    const restored = editorRef.current.getSnapshot();
    assert.equal(restored.params.seed, sameSession ? '42' : '7');
    assert.equal(restored.params.width, sameSession ? 1216 : 832);
    assert.equal(restored.imagePreview, sameSession ? latest.imagePreview : null);
    assert.equal(restored.characterTabs.length, sameSession ? 1 : 0);
    assert.equal(restored.referenceImages.length, sameSession ? 1 : 0);
  }
});

test('新分镜清空参数与角色，不读取或覆盖普通生成缓存，且不能选视频模型', () => {
  const panel = createPanel({}, {
    aiImageParams_model: JSON.stringify('wan2-2'),
    aiImageParams_steps: '40',
    aiImageParams_seed: '7788',
    characterTabs: JSON.stringify([{ name: 'Old character', prompt: 'old', position: 'C3' }]),
  });
  const tree = panel.render();
  assert.equal(panel.request().model, 'nai-diffusion-4-5-full');
  assert.equal(panel.request().steps, 28);
  assert.equal(panel.request().seed, '');
  assert.equal(panel.snapshot().characterTabs.length, 0);
  assert.deepEqual(panel.writes, []);
  assert.equal(elements(tree, 'MenuItem').some((item) => item.props.value === 'wan2-2'), false);
});

test('重新载入分镜保留图生图、角色、参考图编辑态及实际请求参数', () => {
  const saved = {
    params: { model: 'nai-diffusion-4-5-full', seed: '4455', steps: 27, strength: 0.4 },
    imagePreview: 'data:image/png;base64,source',
    editedImageData: 'data:image/png;base64,edited',
    directorToolParams: { type: 'lineart', params: { enabled: true } },
    characterTabs: [{ name: 'Hero', prompt: 'blue hair', uc: 'hat', position: 'C3', colorId: 2 }],
    referenceImages: [{ id: 7, data: 'reference', displayUrl: 'data:image/png;base64,reference', disabled: true, strength: 0.4, fidelity: 0.8 }],
  };
  const vibeImages = [{ id: 'vibe-1', image: 'data:image/png;base64,vibe', encoding: 'encoded', disabled: true, isTemporarilyDisabled: true }];
  const panel = createPanel({ editorState: saved, params: saved.params, vibeImages, positivePrompt: 'panel one', negativePrompt: 'low quality' });
  panel.render();
  const snapshot = panel.snapshot();
  for (const key of ['imagePreview', 'editedImageData', 'directorToolParams', 'characterTabs', 'referenceImages']) {
    assert.equal(JSON.stringify(snapshot[key]), JSON.stringify(saved[key]));
  }
  assert.equal(panel.request().positivePrompt, 'panel one');
  assert.equal(panel.request().seed, '4455');
  assert.equal(panel.request().imageToImage.strength, 0.4);
  assert.equal(panel.request().characterControl.characterPrompts[0].prompt, 'blue hair');
  assert.equal(panel.request().version_editor.parameterState.referenceImages[0].data, 'reference');
  assert.equal(panel.request().version_editor.parameterState.referenceImages[0].disabled, true);
  assert.equal(JSON.stringify(panel.request().version_editor.vibeImages), JSON.stringify(vibeImages));
  const reopened = createPanel({ editorState: snapshot, params: snapshot.params, positivePrompt: 'panel one' });
  reopened.render();
  assert.equal(JSON.stringify(reopened.snapshot()), JSON.stringify(snapshot));
});

test('批量请求读取另一个分镜的提示词、角色与图生图快照，不改当前表单', () => {
  const panel = createPanel({ positivePrompt: 'visible frame', params: { model: 'nai-diffusion-4-5-full', seed: '10' } });
  panel.render();
  const before = JSON.stringify(panel.snapshot());
  const model = 'nai-diffusion-5-full';
  const request = panel.request({
    parameterState: { params: { model, seed: '99', width: 832, height: 1216, strength: 0.37, noise: 0.1, characterPositionMode: 'custom' },
      imagePreview: 'data:image/png;base64,other', editedImageData: 'data:image/png;base64,edit',
      characterTabs: [{ name: 'Other', prompt: 'red hair', uc: 'hat', center: { x: 0.2, y: 0.7 } }] },
    promptsByModel: { [model]: { positivePrompt: 'other frame', negativePrompt: 'blur' } }, vibeImages: [],
  });
  assert.equal(request.positivePrompt, 'other frame'); assert.equal(request.negativePrompt, 'blur');
  assert.equal(request.width, 832); assert.equal(request.seed, '99');
  assert.equal(request.imageToImage.strength, 0.37); assert.equal(request.imageToImage.image, 'data:image/png;base64,other');
  assert.equal(request.characterControl.characterPrompts[0].prompt, 'red hair');
  assert.equal(request.characterControl.characterPrompts[0].center.y, 0.7);
  assert.equal(JSON.stringify(panel.snapshot()), before);
  assert.equal(panel.request().positivePrompt, 'visible frame');
});

test('切框或退出漫画后丢弃旧会话的异步 Vibe 更新，重开未完成 Vibe 可重试', async () => {
  const source = readFileSync(new URL('./AIPaintingPage.js', import.meta.url), 'utf8');
  const names = ['applyPaintingSnapshot', 'handleEditorVibeImagesChange'];
  // 直接执行页面中的状态桥接函数，覆盖真实回调闭包，避免把实现复制进测试。
  const implementations = names.map((name) => {
    const start = source.indexOf(`  const ${name} = `);
    assert.ok(start >= 0, `缺少 ${name}`);
    return source.slice(start, source.indexOf('\n  const ', start + 1));
  }).join('\n');

  for (const destination of ['second-panel', 'regular-painting']) {
    const editorRef = { current: { key: 1 } };
    let images = [{ id: 'first-panel', status: 'converting' }];
    const reopened = [{ id: destination, status: 'converting' }, { id: 'ready', status: 'converted', encoding: 'keep' }];
    const context = {
      parameterEditorRef: editorRef, parameterEditorKey: 1,
      useCallback: (callback) => callback,
      setVibeImages: (next) => { images = typeof next === 'function' ? next(images) : next; },
      setGenerationParams() {}, setPromptsByModel() {}, setExternalImageData() {},
      setVideoBaseImageForPanel() {}, setCharacterTabsFromNote() {},
      setCharacterTabsForPromptTokens() {}, setParameterEditorState() {},
      setParameterEditorKey: (next) => { editorRef.current.key = next(editorRef.current.key); },
    };
    const callbacks = runInNewContext(`${implementations}\n({ ${names.join(', ')} })`, context);
    let finishOldConversion;
    const pending = new Promise((resolve) => { finishOldConversion = resolve; }).then(() => {
      callbacks.handleEditorVibeImagesChange((current) => current.map((vibe) => ({ ...vibe, encoding: 'old-frame' })));
    });

    callbacks.applyPaintingSnapshot({
      parameterState: { params: {} }, promptsByModel: {}, vibeImages: reopened,
    });
    finishOldConversion();
    await pending;
    assert.equal(images[0].id, destination);
    assert.equal(images[0].status, 'unconverted');
    assert.equal(images[0].encoding, undefined);
    assert.equal(images[1].encoding, 'keep');
    assert.equal(reopened[0].status, 'converting', '恢复操作不得修改已保存快照');

    const active = runInNewContext(`${implementations}\n({ ${names.join(', ')} })`, { ...context, parameterEditorKey: 2 });
    active.handleEditorVibeImagesChange((current) => current.map((vibe) => ({ ...vibe, status: 'converted' })));
    assert.equal(images[0].status, 'converted', '当前会话重试后的更新仍可提交');
  }
});

test('漫画推荐按钮点击后才更新实际请求尺寸，重开与改框均保留自定义尺寸和参考内容', () => {
  const updates = [];
  const panel = createPanel({
    positivePrompt: 'keep this scene',
    comicPanelBounds: { width: 300, height: 200 },
    params: { model: 'nai-diffusion-4-5-full', seed: '7123' },
    editorState: { params: { model: 'nai-diffusion-4-5-full', seed: '7123' }, imagePreview: 'data:image/png;base64,keep' },
    onParamChange: (key, value) => updates.push([key, value]),
  });
  const initial = panel.render();
  assert.equal(panel.request().width, 1024, '进入参数区不自动匹配');
  assert.equal(panel.request().height, 1024);
  const action = (tree) => elements(tree, './ParameterPanelUI/ImageParameterPanelUI/BasicParameters')[0].props.resolutionAction;
  assert.equal(action(initial).props.children, 'painting.workspace.parameters.useRecommendedResolution');
  action(initial).props.onClick();
  const tree = panel.render();
  assert.equal(panel.request().width, 1152);
  assert.equal(panel.request().height, 768);
  assert.equal(panel.request().seed, '7123');
  assert.equal(panel.request().positivePrompt, 'keep this scene');
  assert.equal(panel.request().imageToImage.image, 'data:image/png;base64,keep');
  assert.ok(updates.some(([field, value]) => field === 'width' && value === 1152));
  const imagePanel = elements(tree, './ParameterPanelUI/ImageParameterPanel')[0];
  imagePanel.props.handleParamChange('width', 1024);
  panel.render();
  assert.equal(panel.request().width, 1024, '点击后仍允许自定义尺寸');
  panel.update({ comicPanelBounds: { width: 200, height: 300 } });
  const changedBounds = panel.render();
  assert.equal(panel.request().width, 1024, '新画框比例不触发自动匹配');
  const snapshot = panel.snapshot();
  const reopened = createPanel({ editorState: snapshot, params: snapshot.params, comicPanelBounds: { width: 200, height: 300 } });
  reopened.render();
  assert.equal(reopened.request().width, 1024, '重开保留自定义尺寸');
  assert.equal(reopened.request().height, 768);
  action(changedBounds).props.onClick();
  panel.render();
  assert.equal(panel.request().width, 768);
  assert.equal(panel.request().height, 1152);
});

test('普通生成和未选择画框时不显示漫画推荐按钮', () => {
  for (const overrides of [
    { isolated: false, comicPanelBounds: { width: 3, height: 2 } },
    { comicPanelBounds: null },
  ]) {
    const panel = createPanel(overrides);
    const tree = panel.render();
    const basic = elements(tree, './ParameterPanelUI/ImageParameterPanelUI/BasicParameters')[0];
    assert.ok(!basic?.props.resolutionAction);
    assert.equal(elements(tree, 'Button').some((node) => node.props.children === 'painting.workspace.parameters.useRecommendedResolution'), false);
  }
});
