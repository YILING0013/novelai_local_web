import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNovelAIImageRequestParams } from './novelAIRequestParams.mjs';

test('NovelAI 单次请求始终只生成一张，批量数量留给前端串行调度', () => {
  const requestParams = buildNovelAIImageRequestParams({
    model: 'nai-diffusion-5-full',
    batchSize: 8,
    seed: 123,
    ucPreset: 4,
    ucPresetId: 'none',
  }, false);

  assert.equal(requestParams.n_samples, 1);
  assert.equal(Object.hasOwn(requestParams, 'batchSize'), false);
  assert.equal(Object.hasOwn(requestParams, 'ucPreset'), false);
  assert.equal(Object.hasOwn(requestParams, 'ucPresetId'), false);
});

test('旧 NovelAI 模型的单次请求同样固定 n_samples 为 1', () => {
  const requestParams = buildNovelAIImageRequestParams({
    model: 'nai-diffusion-3',
    batchSize: 4,
    seed: 456,
    smea: true,
    ucPreset: 1,
    ucPresetId: 'light',
  }, true);

  assert.equal(requestParams.n_samples, 1);
  assert.equal(requestParams.sm, true);
  assert.equal(Object.hasOwn(requestParams, 'ucPreset'), false);
  assert.equal(Object.hasOwn(requestParams, 'ucPresetId'), false);
});
