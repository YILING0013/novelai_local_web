import assert from 'node:assert/strict';
import test from 'node:test';
import { isNovelAIVibeModel, sanitizeNovelAIReferenceParams } from './novelAIReferenceParams.mjs';

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

test('V3 重绘保留 Vibe，V5 过滤参考图，非 V4.5 不发送角色参考', () => {
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
