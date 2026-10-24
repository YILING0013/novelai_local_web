import assert from 'node:assert/strict';
import test from 'node:test';
import { createVersionEditorSnapshot, restoreVersionWorkspace } from './versionWorkspace.mjs';
import { buildNovelAIImageRequestParams } from './novelAIRequestParams.mjs';

const defaults = { model: 'nai-diffusion-4-5-full', width: 1024, height: 1024, steps: 28, seed: '' };

test('完整编辑态保留禁用参考、角色名称、Vibe原图与编码，排除凭据和重复图片', () => {
  const state = {
    params: { ...defaults, seed: '', director_reference_images_cached: [{ data: 'active-ref', cache_secret_key: 'secret' }], reference_image_multiple: ['encoding'], strength: 0.4 },
    characterTabs: [{ name: '同伴', prompt: 'red hair', uc: 'hat', position: 'B2', isTemporarilyDisabled: true }],
    referenceImages: [{ id: 'r1', name: 'character.png', data: 'active-ref', originalImage: 'data:image/png;base64,original-ref', displayUrl: 'blob:old', type: 'character&style', strength: 0.7, fidelity: 0.8, disabled: true, cache_secret_key: 'secret' }],
    imagePreview: 'data:image/png;base64,source', editedImageData: 'data:image/png;base64,edited',
    restoredMask: { mask: 'data:image/png;base64,mask', inpaintStrength: 0.8 },
    directorToolParams: { type: 'colorize', params: { prompt: 'blue sky', intensity: 2 } },
  };
  const vibes = [{ id: 'v1', name: 'watercolor', filename: 'artist.naiv4vibe', image: 'data:image/png;base64,vibe', thumbnail: 'data:image/png;base64,thumb', encoding: 'encoded-v4', isV4Vibe: true, status: 'converted', hash: 'hash', referenceStrength: 0.3, informationExtracted: 0.7, isTemporarilyDisabled: true, encodingInfo: { name: 'watercolor', token: 'private' } }];
  const editor = createVersionEditorSnapshot(state, vibes, { positivePrompt: 'random raw draft', negativePrompt: '' });
  assert.equal(editor.parameterState.params.director_reference_images_cached, undefined);
  assert.equal(editor.parameterState.params.reference_image_multiple, undefined);
  assert.equal(editor.parameterState.referenceImages[0].displayUrl, undefined);
  assert.equal(editor.parameterState.referenceImages[0].originalImage, state.referenceImages[0].originalImage);
  assert.equal(editor.parameterState.referenceImages[0].disabled, true);
  assert.equal(editor.vibeImages[0].filename, 'artist.naiv4vibe');
  assert.equal(editor.vibeImages[0].encoding, 'encoded-v4');
  assert.equal(editor.vibeImages[0].encodingInfo.token, undefined);
  assert.equal(JSON.stringify(editor).includes('secret'), false);
  state.characterTabs[0].name = 'changed';
  vibes[0].referenceStrength = 1;
  assert.equal(editor.parameterState.characterTabs[0].name, '同伴');
  assert.equal(editor.vibeImages[0].referenceStrength, 0.3);

  const parameters = { seed: 123, width: 832, height: 1216, positivePrompt: 'actual resolved prompt', editor_state: editor };
  const restored = restoreVersionWorkspace(parameters, defaults);
  assert.equal(restored.parameterState.params.seed, 123);
  assert.equal(restored.parameterState.params.width, 832);
  assert.equal(restored.positivePrompt, 'actual resolved prompt');
  assert.equal(restored.parameterState.referenceImages[0].displayUrl, 'data:image/png;base64,active-ref');
  assert.equal(restored.parameterState.referenceImages[0].cache_secret_key, null);
  assert.equal(restored.parameterState.referenceImages[0].disabled, true);
  assert.equal(restored.parameterState.characterTabs[0].isTemporarilyDisabled, true);
  assert.equal(restored.vibeImages[0].encoding, 'encoded-v4');
  assert.equal(restored.vibeImages[0].image, 'data:image/png;base64,vibe');
  assert.equal(restored.parameterState.editedImageData, 'data:image/png;base64,edited');
  assert.deepEqual(restored.parameterState.restoredMask, state.restoredMask);
  restored.vibeImages[0].referenceStrength = 0.9;
  restored.parameterState.characterTabs[0].name = 'edited after restore';
  assert.equal(editor.vibeImages[0].referenceStrength, 0.3);
  assert.equal(editor.parameterState.characterTabs[0].name, '同伴');
});

test('节点实际使用的局部重绘图片和遮罩覆盖此前编辑草稿，其他参考仍保留', () => {
  const editor = createVersionEditorSnapshot({ params: defaults, imagePreview: 'data:image/png;base64,old', restoredMask: { mask: 'old-mask' }, referenceImages: [] }, []);
  const restored = restoreVersionWorkspace({ editor_state: editor, image: 'actual-image', mask: 'actual-mask', inpaint_strength: 0.6 }, defaults);
  assert.equal(restored.parameterState.imagePreview, 'data:image/png;base64,actual-image');
  assert.equal(restored.parameterState.restoredMask.mask, 'data:image/png;base64,actual-mask');
  assert.equal(restored.parameterState.restoredMask.inpaintStrength, 0.6);
});

test('历史对话框手工修改的顶层参数和角色优先于旧编辑态，参考与Vibe继续保留', () => {
  const editor = createVersionEditorSnapshot({ params: { ...defaults, seed: 7 }, characterTabs: [{ name: '旧角色', prompt: 'red hair' }], referenceImages: [{ data: 'ref', disabled: true }] }, [{ encoding: 'vibe', name: 'style' }], { positivePrompt: 'old', negativePrompt: 'old negative' });
  const tabs = [{ name: '新角色', prompt: 'blue hair', uc: '', isTemporarilyDisabled: true }];
  const restored = restoreVersionWorkspace({ editor_state: editor, positivePrompt: '', negativePrompt: 'new negative', seed: 99, steps: 20, characterTabs: tabs }, defaults);
  assert.equal(restored.positivePrompt, '');
  assert.equal(restored.negativePrompt, 'new negative');
  assert.equal(restored.parameterState.params.seed, 99);
  assert.equal(restored.parameterState.params.steps, 20);
  assert.deepEqual(restored.parameterState.characterTabs, tabs);
  assert.equal(restored.parameterState.referenceImages[0].data, 'ref');
  assert.equal(restored.vibeImages[0].encoding, 'vibe');
});

test('版本恢复保留空提示词、零种子、角色坐标与大图开关，清空上一作品输入', () => {
  const parameters = {
    positivePrompt: '', negativePrompt: 'blurry', seed: 0, model: 'nai-diffusion-4-5-full',
    width: 1536, height: 1024, steps: 32, use_coords: true, use_upscale_credits: true,
    characterTabs: [{ name: '角色', prompt: 'silver hair', uc: '', position: 'B2', center: { x: 0.3, y: 0.3 } }],
  };
  const restored = restoreVersionWorkspace(parameters, defaults);
  assert.equal(restored.positivePrompt, '');
  assert.equal(restored.parameterState.params.seed, 0);
  assert.equal(restored.parameterState.params.use_upscale_credits, true);
  assert.equal(restored.parameterState.params.characterPositionMode, 'custom');
  assert.deepEqual(restored.parameterState.characterTabs, parameters.characterTabs);
  assert.equal(restored.parameterState.imagePreview, null);
  assert.equal(restored.parameterState.restoredMask, null);
  assert.deepEqual(restored.parameterState.referenceImages, []);
  assert.deepEqual(restored.vibeImages, []);
  assert.equal(buildNovelAIImageRequestParams(restored.parameterState.params, false).seed, 0);
});

test('版本中的图生图、遮罩和角色参考恢复到可编辑控件，参考密钥重新生成', () => {
  const restored = restoreVersionWorkspace({
    image: 'image-bytes', mask: 'mask-bytes', strength: 0.4, noise: 0.1,
    inpaint_strength: 0.8, disabled_original_image: true, color_correct: false,
    director_reference_images_cached: [{ data: 'reference-bytes' }],
    director_reference_descriptions: [{ caption: { base_caption: 'character&style' } }],
    director_reference_strength_values: [0.7], director_reference_secondary_strength_values: [0.2],
  }, defaults);
  assert.equal(restored.parameterState.imagePreview, 'data:image/png;base64,image-bytes');
  assert.deepEqual(restored.parameterState.restoredMask, {
    mask: 'data:image/png;base64,mask-bytes', inpaintStrength: 0.8,
    disabledOriginalImage: true, colorCorrect: false,
  });
  assert.equal(restored.parameterState.params.strength, 0.4);
  assert.equal(restored.parameterState.referenceImages[0].type, 'character&style');
  assert.equal(restored.parameterState.referenceImages[0].fidelity, 0.8);
  assert.equal(restored.parameterState.referenceImages[0].cache_secret_key, null);
});

test('V4 Vibe 恢复编码，V3 Vibe 恢复图片与信息强度', () => {
  const input = { reference_image_multiple: ['vibe-bytes'], reference_strength_multiple: [0.4], reference_information_extracted_multiple: [0.8] };
  const v4 = restoreVersionWorkspace(input, defaults).vibeImages[0];
  assert.equal(v4.encoding, 'vibe-bytes');
  assert.equal(v4.status, 'converted');
  const v3 = restoreVersionWorkspace({ ...input, model: 'nai-diffusion-3' }, defaults).vibeImages[0];
  assert.equal(v3.image, 'data:image/png;base64,vibe-bytes');
  assert.equal(v3.informationExtracted, 0.8);
  assert.equal(v3.referenceStrength, 0.4);
});

test('旧版官方请求中的直接参考图数组可恢复，已有缓存对象优先且不重复', () => {
  const parameters = {
    director_reference_images_cached: [], director_reference_images: ['direct-reference'],
    director_reference_descriptions: [{ caption: { base_caption: 'style' } }],
    director_reference_strength_values: [0.3], director_reference_secondary_strength_values: [0.1],
  };
  const reference = restoreVersionWorkspace(parameters, defaults).parameterState.referenceImages[0];
  assert.equal(reference.data, 'direct-reference');
  assert.equal(reference.displayUrl, 'data:image/png;base64,direct-reference');
  assert.equal(reference.type, 'style');
  assert.equal(reference.strength, 0.3);
  assert.equal(reference.fidelity, 0.9);
  assert.equal(reference.cache_secret_key, null);
  parameters.director_reference_images_cached = [{ data: 'cached-reference', cache_secret_key: 'old-secret' }];
  const cached = restoreVersionWorkspace(parameters, defaults).parameterState.referenceImages;
  assert.equal(cached.length, 1);
  assert.equal(cached[0].data, 'cached-reference');
  assert.equal(cached[0].cache_secret_key, null);
});

test('V3 旧单张 Vibe 恢复图片与零强度，多张字段存在时不重复加入单张', () => {
  const parameters = { model: 'nai-diffusion-3', reference_image: 'single-vibe', reference_strength: 0,
    reference_information_extracted: 0.4, reference_image_multiple: [] };
  const single = restoreVersionWorkspace(parameters, defaults).vibeImages;
  assert.equal(single.length, 1);
  assert.equal(single[0].image, 'data:image/png;base64,single-vibe');
  assert.equal(single[0].referenceStrength, 0);
  assert.equal(single[0].informationExtracted, 0.4);
  parameters.reference_image_multiple = ['multiple-vibe'];
  parameters.reference_strength_multiple = [0.7];
  parameters.reference_information_extracted_multiple = [0.8];
  const multiple = restoreVersionWorkspace(parameters, defaults).vibeImages;
  assert.equal(multiple.length, 1);
  assert.equal(multiple[0].image, 'data:image/png;base64,multiple-vibe');
  assert.equal(multiple[0].referenceStrength, 0.7);
  assert.equal(multiple[0].informationExtracted, 0.8);
});

test('查看增强版本不会隐式再次选择收费工具', () => {
  const restored = restoreVersionWorkspace({ image_tool: 'enhance', width: 1536, height: 1536, positivePrompt: 'rain' }, defaults);
  assert.equal(restored.parameterState.params.image_tool, undefined);
  assert.equal(restored.positivePrompt, 'rain');
});

test('V3 版本恢复自动 SMEA 开关，不被当前默认值替换', () => {
  const restored = restoreVersionWorkspace({ model: 'nai-diffusion-3', autoSmea: true }, { ...defaults, autoSmea: false });
  assert.equal(restored.parameterState.params.autoSmea, true);
  assert.equal(buildNovelAIImageRequestParams(restored.parameterState.params, true).autoSmea, true);
});
