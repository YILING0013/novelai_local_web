import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOVELAI_V5_DEFAULT_PARAMS,
  NOVELAI_V5_CHARACTER_WARNING_THRESHOLD,
  NOVELAI_V5_LARGE_MAX_STEPS,
  NOVELAI_V5_MODEL_IDS,
  NOVELAI_V5_STANDARD_MAX_STEPS,
  buildNovelAIV5CharacterControl,
  isNovelAIV5Model,
  normalizeNovelAICharacterCenter,
  removeNovelAIUCPresetParams,
  sanitizeNovelAIV5GenerationParams,
} from './novelAIV5Params.mjs';

test('NovelAI V5 exposes both supported model IDs and the verified text-to-image defaults', () => {
  assert.deepEqual(NOVELAI_V5_MODEL_IDS, [
    'nai-diffusion-5-curated',
    'nai-diffusion-5-full',
  ]);
  assert.equal(isNovelAIV5Model('nai-diffusion-5-curated'), true);
  assert.equal(isNovelAIV5Model('nai-diffusion-5-full'), true);
  assert.equal(isNovelAIV5Model('nai-diffusion-4-5-full'), false);
  assert.deepEqual(NOVELAI_V5_DEFAULT_PARAMS, {
    width: 832,
    height: 1216,
    guidanceScale: 7,
    sampler: 'k_euler_ancestral',
    steps: 23,
    batchSize: 1,
    promptGuidanceRescale: 0,
    noiseSchedule: 'karras',
    smea: false,
    dyn: false,
    autoSmea: false,
    prefer_brownian: true,
    deliberate_euler_ancestral_bug: false,
    legacy: false,
    legacy_uc: false,
    legacy_v3_extend: false,
    use_upscale_credits: false,
    characterPositionMode: 'ai',
  });
  assert.equal(NOVELAI_V5_CHARACTER_WARNING_THRESHOLD, 25);
  assert.equal(NOVELAI_V5_STANDARD_MAX_STEPS, 23);
  assert.equal(NOVELAI_V5_LARGE_MAX_STEPS, 50);
});

test('NovelAI V5 normalizes old cached steps according to standard and large-image modes', () => {
  assert.equal(sanitizeNovelAIV5GenerationParams({
    model: 'nai-diffusion-5-full',
    steps: 28,
    use_upscale_credits: false,
  }).steps, 23);
  assert.equal(sanitizeNovelAIV5GenerationParams({
    model: 'nai-diffusion-5-full',
    steps: 50,
    use_upscale_credits: true,
  }).steps, 50);
  assert.equal(sanitizeNovelAIV5GenerationParams({
    model: 'nai-diffusion-5-full',
    steps: 51,
    use_upscale_credits: true,
  }).steps, 50);
});

test('NovelAI V5 strips only Character Reference and Vibe fields', () => {
  const params = {
    model: 'nai-diffusion-5-curated',
    positivePrompt: '1girl',
    negativePrompt: 'lowres',
    width: 832,
    ucPreset: 9,
    ucPresetId: 'heavy',
    director_reference_images: ['legacy-reference'],
    director_reference_images_cached: [{ data: 'reference' }],
    director_reference_descriptions: ['character'],
    director_reference_strength_values: [0.6],
    director_reference_secondary_strength_values: [0],
    director_reference_information_extracted: [1],
    characterControl: { enabledCharacterCount: 1 },
    characterPrompts: [{ prompt: 'character' }],
    v4_prompt_char_captions: [{ char_caption: 'character' }],
    v4_negative_prompt_char_captions: [{ char_caption: 'bad hands' }],
    vibeTransfer: { reference_image_multiple: ['vibe'] },
    reference_image_multiple: ['vibe'],
    reference_information_extracted_multiple: [1],
    reference_strength_multiple: [0.6],
    reference_image: 'single-vibe',
    reference_information_extracted: 1,
    reference_strength: 0.6,
    imageToImage: { image: 'source', mask: 'mask' },
    image: 'source',
    mask: 'mask',
    action: true,
    strength: 0.7,
    noise: 0.1,
    inpaint_strength: 1,
    disabled_original_image: true,
    color_correct: true,
    req_type: 'emotion',
    defry: 0.5,
  };

  const sanitized = sanitizeNovelAIV5GenerationParams(params);
  assert.equal(Object.hasOwn(sanitized, 'ucPreset'), false);
  assert.equal(Object.hasOwn(sanitized, 'ucPresetId'), false);
  assert.deepEqual(sanitized.characterControl, { enabledCharacterCount: 1 });
  assert.deepEqual(sanitized.characterPrompts, [{ prompt: 'character' }]);
  assert.deepEqual(sanitized.imageToImage, { image: 'source', mask: 'mask' });
  assert.equal(sanitized.image, 'source');
  assert.equal(sanitized.mask, 'mask');
  assert.equal(sanitized.action, true);
  for (const unsupportedKey of [
    'director_reference_images',
    'director_reference_images_cached',
    'director_reference_descriptions',
    'director_reference_strength_values',
    'director_reference_secondary_strength_values',
    'director_reference_information_extracted',
    'vibeTransfer',
    'reference_image_multiple',
    'reference_information_extracted_multiple',
    'reference_strength_multiple',
    'reference_image',
    'reference_information_extracted',
    'reference_strength',
  ]) {
    assert.equal(Object.hasOwn(sanitized, unsupportedKey), false, unsupportedKey);
  }
  assert.ok(params.imageToImage, 'the caller-owned object must not be mutated');
});

test('sanitizing another model preserves its existing request object', () => {
  const params = {
    model: 'nai-diffusion-4-5-full',
    imageToImage: { image: 'source' },
    characterControl: { enabledCharacterCount: 1 },
  };

  assert.equal(sanitizeNovelAIV5GenerationParams(params), params);
});

test('old cached or external UC preset values are removed without mutating their source', () => {
  const legacyParams = {
    model: 'nai-diffusion-4-5-full',
    ucPreset: 3,
    ucPresetId: 'humanFocus',
    negativePrompt: 'manual undesired content',
  };

  const sanitized = removeNovelAIUCPresetParams(legacyParams);
  assert.deepEqual(sanitized, {
    model: 'nai-diffusion-4-5-full',
    negativePrompt: 'manual undesired content',
  });
  assert.equal(legacyParams.ucPreset, 3);
  assert.equal(legacyParams.ucPresetId, 'humanFocus');
});

test('NovelAI V5 builds exact custom-coordinate character request fields without truncation', () => {
  const characters = Array.from({ length: 27 }, (_, index) => ({
    name: `Character ${index + 1}`,
    prompt: `prompt ${index + 1}`,
    uc: `uc ${index + 1}`,
    center: index === 0 ? { x: 1.2, y: -0.2 } : { x: 0.027, y: 0.972 },
    position: 'C3',
    isTemporarilyDisabled: index === 1,
  }));

  const result = buildNovelAIV5CharacterControl(characters, true);
  assert.equal(result.enabledCharacterCount, 26);
  assert.equal(result.use_coords, true);
  assert.deepEqual(result.characterPrompts[0], {
    prompt: 'prompt 1',
    uc: 'uc 1',
    center: { x: 1, y: 0 },
    enabled: true,
  });
  assert.deepEqual(result.characterPrompts[1].center, { x: 0.027, y: 0.972 });
  assert.deepEqual(result.v4_prompt_char_captions[0], {
    char_caption: 'prompt 1',
    centers: [{ x: 1, y: 0 }],
  });
  assert.deepEqual(result.v4_negative_prompt_char_captions[0], {
    char_caption: 'uc 1',
    centers: [{ x: 1, y: 0 }],
  });
  assert.equal(result.characterPrompts.some(({ prompt }) => prompt === 'prompt 2'), false);
});

test('NovelAI V5 AI choice disables coordinates and legacy grid positions migrate precisely', () => {
  const result = buildNovelAIV5CharacterControl([{
    prompt: 'girl',
    uc: '',
    position: 'A5',
  }], false);

  assert.equal(result.use_coords, false);
  assert.deepEqual(result.characterPrompts[0].center, { x: 0.1, y: 0.9 });
  assert.deepEqual(normalizeNovelAICharacterCenter({ x: 0.5049, y: 0.7051 }), {
    x: 0.505,
    y: 0.705,
  });
});
