import { SUPPORTED_PAINTING_MODEL_IDS } from './modelUtils.js';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_OPTIONS, resolveMetadataModel } from './generationOptions.js';
import { getImageImportOptions, normalizeImageImportParameters, mapImageParametersToUI } from './parameterMapping.js';

test('元数据模型 ID、网站名称和 NovelAI 来源名称映射到同一个模型', () => {
  assert.deepEqual(MODEL_OPTIONS.map(option => option.value).sort(), [...SUPPORTED_PAINTING_MODEL_IDS].sort());
  for (const option of MODEL_OPTIONS) {
    assert.equal(resolveMetadataModel(option.value), option.value);
    assert.equal(resolveMetadataModel(option.label), option.value);
  }
  assert.equal(resolveMetadataModel('NovelAI Diffusion V4.5 Full'), 'nai-diffusion-4-5-full');
  assert.equal(resolveMetadataModel('NovelAI Diffusion V4 Curated Preview'), 'nai-diffusion-4-curated-preview');
  assert.equal(resolveMetadataModel('NovelAI Diffusion V5 Full Medium'), 'nai-diffusion-5-full-medium');
  assert.equal(resolveMetadataModel('Stable Diffusion XL unknown-hash'), undefined);
  assert.equal(resolveMetadataModel('Some model 4.5'), undefined);
});

test('合法分辨率组合受当前大图模式限制，受限账号仍使用普通上限', () => {
  for (const large of [false, true]) for (const restricted of [false, true]) {
    const params = { model: 'nai-diffusion-4-5-full', use_upscale_credits: large };
    const options = getImageImportOptions(params, restricted);
    const limit = large && !restricted ? 3145728 : 1048576;
    for (const [width, height] of options.resolutions) {
      assert.ok(width >= 512 && height >= 512 && width * height <= limit);
      assert.equal(width % 64, 0); assert.equal(height % 64, 0);
    }
    const normalized = normalizeImageImportParameters({ width: 8000, height: 8000 }, params, restricted);
    assert.ok(options.resolutions.some(([w, h]) => w === normalized.width && h === normalized.height));
  }
});

test('尺寸修改保留选择的一边，所有数字范围和选项均符合主页面', () => {
  const params = { model: 'nai-diffusion-4-full' };
  const result = normalizeImageImportParameters({ width: 1536, height: 1024, steps: 999, guidanceScale: -5, seed: 999999999999,
    sampler: 'unlisted', noiseSchedule: 'unlisted', promptGuidanceRescale: 5, smea: true, dyn: true }, params, false, 'width');
  assert.equal(result.width, 1536); assert.equal(result.height, 640);
  assert.equal(result.steps, 28); assert.equal(result.guidanceScale, 1); assert.equal(result.seed, 4294967295);
  assert.equal(result.sampler, 'k_euler'); assert.equal(result.noiseSchedule, 'native');
  assert.equal(result.promptGuidanceRescale, 1); assert.equal(result.smea, false); assert.equal(result.dyn, false);
});

test('V5 Medium 的固定步数、采样器与重调值不能被外部参数改写', () => {
  const params = { model: 'nai-diffusion-5-full-medium', use_upscale_credits: true };
  const result = normalizeImageImportParameters({ steps: 50, sampler: 'k_euler', promptGuidanceRescale: 1, seed: 0 }, params);
  assert.equal(result.steps, 14); assert.equal(result.sampler, 'k_euler_ancestral'); assert.equal(result.promptGuidanceRescale, 0); assert.equal(result.seed, 0);
  assert.equal(mapImageParametersToUI({ model: 'nai-diffusion-5-full-medium' }).model, params.model);
});


test('读取 PNG Source 与 stealth 外层 Source，并交给模型选择映射', () => {
  const require = createRequire(import.meta.url);
  const { parseMetadataCandidates, parseNovelAIMetadata } = require('../tools/ImageTools/metadataParserCore.js');
  const parsed = parseMetadataCandidates([
    { keyword: 'Comment', text: JSON.stringify({ prompt: 'sky', steps: 28, width: 832, height: 1216 }) },
    { keyword: 'Source', text: 'NovelAI Diffusion V4.5 Full' },
  ]);
  assert.equal(resolveMetadataModel(parsed.model), 'nai-diffusion-4-5-full');
  const stealth = parseNovelAIMetadata({ Source: 'NovelAI Diffusion V5 Full Medium', Comment: JSON.stringify({ prompt: 'sky', steps: 14 }) });
  assert.equal(resolveMetadataModel(stealth.model), 'nai-diffusion-5-full-medium');
});
