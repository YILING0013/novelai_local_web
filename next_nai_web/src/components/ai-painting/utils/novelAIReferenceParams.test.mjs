import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDirectorReferenceParams, getReferenceImageLayout, getModelForPreciseReferences, resolveWorkspaceReferences, isNovelAIDirectorReferenceModel, isNovelAIVibeModel, sanitizeNovelAIReferenceParams } from './novelAIReferenceParams.mjs';

test('重绘面板过滤 V4/V4.5 Vibe，退出后恢复原配置，普通图生图仍可使用 Vibe', () => {
  for (const model of ['nai-diffusion-4-curated-preview', 'nai-diffusion-4-full',
    'nai-diffusion-4-5-curated', 'nai-diffusion-4-5-full']) {
    const original = {
      model,
      vibeTransfer: { reference_image_multiple: ['vibe'] },
      reference_image_multiple: ['vibe'],
      reference_strength_multiple: [0.5],
      imageToImage: { image: 'image', strength: 0.7 },
    };
    assert.equal(isNovelAIVibeModel(model, true), false);
    const inpaint = sanitizeNovelAIReferenceParams(original, true);
    assert.equal(Object.hasOwn(inpaint, 'vibeTransfer'), false);
    assert.equal(Object.hasOwn(inpaint, 'reference_image_multiple'), false);
    assert.equal(Object.hasOwn(inpaint, 'reference_strength_multiple'), false);
    assert.deepEqual(sanitizeNovelAIReferenceParams(original), original);
    assert.equal(original.vibeTransfer.reference_image_multiple[0], 'vibe');
    const direct = sanitizeNovelAIReferenceParams({ ...original, imageToImage: { image: 'image', mask: 'mask' } });
    assert.equal(Object.hasOwn(direct, 'vibeTransfer'), false);
  }
});

test('V4.5 重绘保留角色参考和角色提示词，角色参考与 Vibe 互斥', () => {
  for (const model of ['nai-diffusion-4-5-curated', 'nai-diffusion-4-5-full']) {
    const params = {
      model,
      imageToImage: { image: 'image', mask: 'mask' },
      director_reference_images_cached: [{ data: 'reference' }],
      director_reference_descriptions: ['character'],
      characterControl: { characterPrompts: [{ prompt: 'girl' }] },
      vibeTransfer: { images: ['vibe'] },
    };
    const result = sanitizeNovelAIReferenceParams(params);
    assert.deepEqual(result.director_reference_images_cached, params.director_reference_images_cached);
    assert.deepEqual(result.director_reference_descriptions, params.director_reference_descriptions);
    assert.deepEqual(result.characterControl, params.characterControl);
    assert.equal(Object.hasOwn(result, 'vibeTransfer'), false);
    assert.equal(Object.hasOwn(sanitizeNovelAIReferenceParams(params, false), 'vibeTransfer'), false);
  }
});

test('V3 重绘保留 Vibe，V5 重绘过滤参考图，V3 和 V4 不发送角色参考', () => {
  for (const model of ['nai-diffusion-3', 'nai-diffusion-furry-3', 'nai-diffusion-4-full',
    'nai-diffusion-5-full', 'nai-diffusion-5-curated']) {
    const result = sanitizeNovelAIReferenceParams({
      model,
      imageToImage: { image: 'image', mask: 'mask' },
      director_reference_images_cached: [{ data: 'reference' }],
      director_reference_images: ['reference'],
      director_reference_strength_values: [1],
      vibeTransfer: { images: ['vibe'] },
    });
    assert.equal(Object.hasOwn(result, 'director_reference_images_cached'), false);
    assert.equal(Object.hasOwn(result, 'director_reference_images'), false);
    assert.equal(Object.hasOwn(result, 'director_reference_strength_values'), false);
    assert.equal(Object.hasOwn(result, 'vibeTransfer'), model.endsWith('-3'));
  }
});

test('V5 各模型可多图混用、保留零强度，默认值为强度 1，相同服装分别编码', () => {
  const types = ['costume', 'style', 'character', 'character_mainoutfit', 'character&style_anyoutfit', 'character&style'];
  const images = types.map((type, index) => ({ data: String(index), type, strength: index, fidelity: 0.2 }));
  const refs = buildDirectorReferenceParams([...images, { data: 'default' }, { data: 'off', disabled: true }], true);
  assert.deepEqual(refs.director_reference_descriptions.map((item) => item.caption.base_caption), [...types, 'character&style']);
  assert.deepEqual(refs.director_reference_strength_values, [0, 1, 2, 3, 4, 5, 1]);
  assert.deepEqual(refs.director_reference_secondary_strength_values, Array(7).fill(0));
  assert.deepEqual(refs.director_reference_information_extracted, Array(7).fill(1));
  assert.deepEqual(refs.director_reference_images_cached.map((image) => image.data), ['0', '1', '2', '3', '4', '5', 'default']);
  for (const model of ['nai-diffusion-5-curated', 'nai-diffusion-5-full']) {
    const params = { model, ...refs, imageToImage: { image: 'source' }, vibeTransfer: { images: ['old'] } };
    const result = sanitizeNovelAIReferenceParams(params);
    assert.deepEqual(result.director_reference_images_cached, refs.director_reference_images_cached);
    assert.equal(result.vibeTransfer, undefined);
    assert.equal(sanitizeNovelAIReferenceParams(params, true).director_reference_images_cached, undefined);
    assert.equal(isNovelAIVibeModel(model), false);
  }
  assert.equal(buildDirectorReferenceParams([{ disabled: true, data: 'off' }], true), null);
  assert.deepEqual(buildDirectorReferenceParams([{ data: 'old', fidelity: 0.2 }], false).director_reference_secondary_strength_values, [0.8]);
});

test('V5 精确参考从窄图到宽图按官方尺寸居中裁切，V4.5 仍使用原尺寸和黑边', () => {
  const square = getReferenceImageLayout(512, 512, true);
  assert.equal(square.canvasWidth, 1024);
  assert.equal(square.canvasHeight, 1024);
  assert.equal(square.drawWidth, 1024);
  const portrait = getReferenceImageLayout(832, 1216, true);
  assert.deepEqual([portrait.canvasWidth, portrait.canvasHeight, portrait.drawWidth, portrait.drawHeight], [832, 1216, 832, 1216]);
  const odd = getReferenceImageLayout(1025, 1024, true);
  assert.equal(odd.canvasWidth, 1024);
  assert.equal(Math.abs(odd.x), 0);
  assert.equal(odd.drawWidth, 1025);
  for (const [w, h, expected] of [[10000, 100, [4096, 256]], [100, 10000, [256, 4096]], [640, 320, [1408, 704]]]) {
    const layout = getReferenceImageLayout(w, h, true);
    assert.deepEqual([layout.canvasWidth, layout.canvasHeight], expected);
  }
  const legacy = getReferenceImageLayout(2048, 512, false);
  assert.deepEqual([legacy.canvasWidth, legacy.canvasHeight, legacy.drawWidth, legacy.drawHeight, legacy.x, legacy.y], [1536, 1024, 1536, 384, 0, 320]);
});

test('Medium 有参考卡时临时使用 High；移除所有图片或局部重绘恢复首选模型', () => {
  const medium = 'nai-diffusion-5-full-medium', high = 'nai-diffusion-5-full';
  assert.equal(getModelForPreciseReferences(medium, 1, false), high);
  assert.equal(getModelForPreciseReferences(medium, 1, true), medium);
  assert.equal(getModelForPreciseReferences(medium, 0, false), medium);
  assert.equal(getModelForPreciseReferences(high, 0, false), high);
  assert.equal(getModelForPreciseReferences('nai-diffusion-5-curated', 2, false), 'nai-diffusion-5-curated');
  assert.equal(isNovelAIDirectorReferenceModel(medium), false);
});

test('分镜切换和批量生成分别使用各自参考、High 的采样设置与启用数量', () => {
  const medium = { model: 'nai-diffusion-5-full-medium', steps: 14,
    v5HighSettings: { steps: 27, sampler: 'k_euler', promptGuidanceRescale: 0.4 } };
  const images = [{ data: 'first', type: 'costume', strength: 0 }, { data: 'off', disabled: true }];
  const withRefs = resolveWorkspaceReferences(medium, images, [{ image: 'vibe' }], false, false);
  assert.equal(withRefs.params.model, 'nai-diffusion-5-full');
  assert.equal(withRefs.params.steps, 27);
  assert.equal(withRefs.referenceParams.director_reference_images_cached.length, 1);
  assert.deepEqual(withRefs.referenceParams.director_reference_strength_values, [0]);
  for (const [refs, mask, tool] of [[images, true, false], [images, false, true], [[], false, false]]) {
    const result = resolveWorkspaceReferences(medium, refs, [], mask, tool);
    assert.equal(result.params, medium);
    assert.equal(result.referenceParams, null);
  }
  const disabled = resolveWorkspaceReferences(medium, [images[1]], [], false, false);
  assert.equal(disabled.params.model, 'nai-diffusion-5-full');
  assert.equal(disabled.referenceParams, null);
});
