import assert from 'node:assert/strict';
import test from 'node:test';
import { applyImageParametersToUI } from './parameterMapping.js';
import { buildNovelAIV5CharacterControl } from './novelAIV5Params.mjs';

test('图库参数切到受支持模型并写入该模型提示词，保留角色坐标模式，未知模型不改现有内容', () => {
  const originalModel = 'nai-diffusion-4-5-full';
  const targetModel = 'nai-diffusion-5-full';
  const prompts = { [originalModel]: { positivePrompt: 'original', negativePrompt: 'original negative' } };
  const params = { model: originalModel };
  let characterTabs = [];
  const callbacks = {
    handleParamChange: (key, value) => { params[key] = value; },
    // React 在同一次事件中不会立即提交新模型，未指定目标时仍写入旧模型。
    setPositivePrompt: (value, model = originalModel) => { prompts[model] = { ...prompts[model], positivePrompt: value }; },
    setNegativePrompt: (value, model = originalModel) => { prompts[model] = { ...prompts[model], negativePrompt: value }; },
    setCharacterTabsFromNote: (tabs) => { characterTabs = tabs; },
  };
  const metadata = {
    model: targetModel, positivePrompt: 'new prompt', negativePrompt: 'new negative', seed: 123,
    use_coords: true, characterTabs: [{ prompt: 'girl', uc: 'bad hands', center: { x: 0.2, y: 0.8 } }],
  };
  assert.equal(applyImageParametersToUI(metadata, callbacks), true);
  assert.equal(params.model, targetModel);
  assert.equal(params.seed, 123);
  assert.deepEqual(prompts[originalModel], { positivePrompt: 'original', negativePrompt: 'original negative' });
  assert.deepEqual(prompts[targetModel], { positivePrompt: 'new prompt', negativePrompt: 'new negative' });
  assert.equal(params.aiDecidePosition, false);
  assert.equal(params.characterPositionMode, 'custom');
  const control = buildNovelAIV5CharacterControl(characterTabs, params.characterPositionMode === 'custom');
  assert.equal(control.use_coords, true);
  assert.deepEqual(control.characterPrompts[0].center, { x: 0.2, y: 0.8 });
  assert.equal(applyImageParametersToUI({ model: targetModel, use_coords: false }, callbacks), true);
  assert.equal(params.aiDecidePosition, true);
  assert.equal(params.characterPositionMode, 'ai');
  assert.equal(characterTabs.length, 1);
  assert.equal(applyImageParametersToUI({
    characterTabs: [],
    v4_prompt: { caption: { char_captions: [{ char_caption: 'stale character' }] } },
    originalMetadata: { characterTabs: [{ prompt: 'another stale character' }] },
  }, callbacks), true);
  assert.deepEqual(characterTabs, []);
  assert.equal(applyImageParametersToUI({ model: 'unsupported-model', positivePrompt: 'do not apply', seed: 999 }, callbacks), false);
  assert.equal(params.model, targetModel);
  assert.equal(params.seed, 123);
  assert.equal(prompts[targetModel].positivePrompt, 'new prompt');
});
