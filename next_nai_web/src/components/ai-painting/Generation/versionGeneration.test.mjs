import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildNovelAIImageRequestParams } from '../utils/novelAIRequestParams.mjs';
import * as modelUtils from '../utils/modelUtils.js';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadModule(path, dependencies = {}, globals = {}) {
  const { code } = transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' },
  });
  const exports = {};
  const localRequire = createRequire(new URL(path, import.meta.url));
  runInNewContext(code, { exports, require: (name) => dependencies[name] || localRequire(name), Date, setTimeout, clearTimeout, ...globals });
  return exports;
}

test('请求只传本地父版本 ID，不传回调或作品标题；保留复现需要的零种子', () => {
  const { buildGenerationRequest } = loadModule('./ImageGenerationService.js', {
    '@/utils/ApiClient': {}, '@/utils/mediaAssets': {}, '../utils/modelUtils': modelUtils,
    '../utils/novelAIRequestParams.mjs': { buildNovelAIImageRequestParams }, './errors': {},
  });
  const request = buildGenerationRequest({
    model: 'nai-diffusion-4-5-full', positivePrompt: 'rain', seed: 0,
    version_context: { work_id: 'work', parent_version_id: 'parent', work_title: 'title' },
    onVersionCreated: () => {},
  });
  assert.deepEqual(JSON.parse(JSON.stringify(request.version_context)), { work_id: 'work', parent_version_id: 'parent' });
  assert.equal(request.seed, 0);
  assert.equal(request.onVersionCreated, undefined);
});

test('本地角色编辑数据保留名称和禁用角色，官方角色请求仍只包含启用角色', () => {
  const { buildGenerationRequest } = loadModule('./ImageGenerationService.js', {
    '@/utils/ApiClient': {}, '@/utils/mediaAssets': {}, '../utils/modelUtils': modelUtils,
    '../utils/novelAIRequestParams.mjs': { buildNovelAIImageRequestParams }, './errors': {},
  });
  const tabs = [
    { name: '旅人', prompt: 'blue hair', position: 'B2' },
    { name: '同伴', prompt: 'red hair', isTemporarilyDisabled: true },
  ];
  const request = buildGenerationRequest({
    model: 'nai-diffusion-4-5-full', positivePrompt: 'scene',
    version_context: { work_id: 'work', parent_version_id: 'parent' },
    characterControl: { characterTabs: tabs, characterPrompts: [{ prompt: 'blue hair' }], enabledCharacterCount: 1 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(request.version_editor)), { characterTabs: tabs });
  assert.deepEqual(JSON.parse(JSON.stringify(request.characterPrompts)), [{ prompt: 'blue hair' }]);
  const disabled = buildGenerationRequest({
    model: 'nai-diffusion-4-5-full', characterControl: { characterTabs: tabs, enabledCharacterCount: 0 },
    version_context: { work_id: 'work', parent_version_id: 'parent' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(disabled.version_editor)), { characterTabs: tabs });
  assert.equal(disabled.characterPrompts, undefined);
});

test('完整本机编辑态随生成传递，官方参考字段只取当前启用输入', () => {
  const { buildGenerationRequest } = loadModule('./ImageGenerationService.js', {
    '@/utils/ApiClient': {}, '@/utils/mediaAssets': {}, '../utils/modelUtils': modelUtils,
    '../utils/novelAIRequestParams.mjs': { buildNovelAIImageRequestParams }, './errors': {},
  });
  const editor = { parameterState: { params: { seed: '' }, referenceImages: [{ data: 'disabled-ref', disabled: true }], characterTabs: [] }, vibeImages: [{ name: 'Vibe', encoding: 'encoded', isTemporarilyDisabled: true }] };
  const request = buildGenerationRequest({ model: 'nai-diffusion-4-5-full', version_editor: editor,
    version_context: { work_id: 'work', parent_version_id: 'parent' },
    director_reference_images_cached: [{ data: 'active-ref', cache_secret_key: 'live-key' }],
    characterControl: { characterTabs: [], enabledCharacterCount: 0 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(request.version_editor)), editor);
  assert.equal(request.director_reference_images_cached[0].data, 'active-ref');
  assert.equal(request.reference_image_multiple, undefined);
  const ordinary = buildGenerationRequest({ model: 'nai-diffusion-4-5-full', version_editor: editor,
    characterControl: { characterTabs: [{ name: '不记录的角色' }], enabledCharacterCount: 0 },
  });
  assert.equal(ordinary.version_context, undefined);
  assert.equal(ordinary.version_editor, undefined, '普通生成不上传禁用参考、原图等完整版本编辑态');
});

for (const existingParent of [null, { work_id: 'existing-work', parent_version_id: 'selected-parent' }, { work_id: 'empty-work', parent_version_id: null }]) {
  test(`批量生成保持用户选择的作品模式（${existingParent ? '固定父节点分支' : '不启用作品'}）`, async () => {
    const batch = loadModule('../tools/BatchGeneration/BatchGenerationService.js');
    batch.default.config.bufferTime = 0;
    const requests = [];
    const versions = [];
    const hook = loadModule('./useImageGeneration.js', {
      react: { useCallback: (fn) => fn, useEffect: () => {}, useRef: (value) => ({ current: value }), useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] },
      '@/utils/browserCapabilities.mjs': { createClientId: () => 'test-batch' },
      '@/utils/ApiClient': { cancelImageBatch: async () => {} },
      '../tools/BatchGeneration/BatchGenerationService': batch,
      './errors': loadModule('./errors.js'),
      './ImageGenerationService': { generateImage: async (params) => {
        requests.push(params);
        return { success: true, image: '/fixture.png', version: {
          work_id: existingParent?.work_id || 'new-work', version_id: `v${requests.length}`, number: requests.length,
        } };
      } },
    }).default();
    await hook.startBatchGeneration({
      model: 'nai-diffusion-4-5-full', batchSize: 3, version_context: existingParent,
      getLatestParams: () => ({ model: 'nai-diffusion-4-5-full', positivePrompt: 'live draft' }),
      onVersionCreated: (version) => versions.push(version),
    });
    assert.equal(requests.length, 3);
    assert.equal(versions.length, existingParent ? 3 : 0, '普通生成不会因旧后端返回版本信息而启用作品');
    for (const request of requests) {
      if (existingParent && !existingParent.parent_version_id && request !== requests[0]) {
        assert.equal(request.version_context.work_id, 'empty-work');
        assert.equal(request.version_context.parent_version_id, 'v1');
      } else assert.equal(request.version_context, existingParent);
    }
  });
}

test('版本写入失败仍返回已生成图片，并发出可见警告', async () => {
  const warnings = [];
  const hook = loadModule('./useImageGeneration.js', {
    react: { useCallback: (fn) => fn, useEffect: () => {}, useRef: (value) => ({ current: value }), useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] },
    '@/utils/browserCapabilities.mjs': {}, '@/utils/ApiClient': {},
    '../tools/BatchGeneration/BatchGenerationService': { getStatus: () => ({}) },
    './errors': loadModule('./errors.js'),
    './ImageGenerationService': { generateImage: async () => ({ success: true, image: '/saved.png', versionError: 'VERSION_SAVE_FAILED' }) },
  }, { window: { dispatchEvent: (event) => warnings.push(event.type) }, CustomEvent: class { constructor(type) { this.type = type; } } }).default();
  const image = await hook.startGeneration({ model: 'nai-diffusion-4-5-full' });
  assert.equal(image.src, '/saved.png');
  assert.equal(image.versionError, 'VERSION_SAVE_FAILED');
  assert.deepEqual(warnings, ['novelai:version-save-failed']);
});
