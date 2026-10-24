import assert from 'node:assert/strict';
import test from 'node:test';
import { versionReferences, visibleVersionParameters } from './versionSnapshot.mjs';
import { createVersionEditorSnapshot } from '../ai-painting/utils/versionWorkspace.mjs';

test('完整快照显示原图和实际使用图，Vibe编码不被当成图片，禁用状态保留', () => {
  const parameters = { seed: 7, image: 'input', editor_state: { parameterState: {
    params: { seed: 0, steps: 28 }, characterTabs: [{ name: 'Alice', prompt: 'girl' }],
    referenceImages: [{ name: 'character.png', originalImage: 'original', data: 'processed', type: 'character', strength: 0.7, fidelity: 0.9, disabled: true }],
  }, vibeImages: [{ name: 'style.naiv4vibe', encoding: 'encoding-data', referenceStrength: 0.4, informationExtracted: 0.8 }] } };
  const refs = versionReferences(parameters);
  assert.equal(refs[0].preview, 'data:image/png;base64,original');
  assert.equal(refs[0].usedImage, 'data:image/png;base64,processed');
  assert.equal(refs[0].settings.disabled, true);
  assert.equal(refs[1].preview, null);
  assert.equal(refs[1].settings.encoding, true);
  assert.equal(refs[2].key, 'image');
  const visible = visibleVersionParameters(parameters);
  assert.equal(visible.seed, 7);
  assert.equal(visible.steps, 28);
  assert.equal(visible.characterTabs[0].name, 'Alice');
  assert.equal(Object.hasOwn(visible, 'editor_state'), false);
  assert.equal(Object.hasOwn(visible, 'image'), false);
});

test('图生图与遮罩展示实际请求输入，Vibe只有缩略图时仍有预览', () => {
  const refs = versionReferences({ image: 'actual-image', mask: 'actual-mask', editor_state: {
    parameterState: { imagePreview: 'original-image', editedImageData: 'old-edit', restoredMask: { mask: 'old-mask' } },
    vibeImages: [{ encoding: 'binary-encoding', thumbnail: 'data:image/png;base64,thumb' }],
  } });
  assert.equal(refs.find((item) => item.key === 'image').content, 'actual-image');
  assert.equal(refs.find((item) => item.key === 'mask').content, 'actual-mask');
  assert.equal(refs.find((item) => item.kind === 'vibe').preview, 'data:image/png;base64,thumb');
});

test('再次保存时去重原图不会被详情误判为参考图或Vibe发生变化', () => {
  const parameterState = { params: {}, referenceImages: [{ data: 'picture', originalImage: 'data:image/png;base64,picture', name: 'reference' }] };
  const vibeImages = [{ image: 'data:image/png;base64,style', originalImage: 'data:image/png;base64,style', encoding: 'encoding', name: 'style' }];
  const before = versionReferences({ editor_state: { parameterState, vibeImages } });
  const after = versionReferences({ editor_state: createVersionEditorSnapshot(parameterState, vibeImages) });
  assert.deepEqual(after, before);
});

test('直接参考图和旧单图Vibe的展示与恢复兼容，保留零强度', () => {
  const refs = versionReferences({ model: 'nai-diffusion-3', director_reference_images_cached: [], director_reference_images: ['ref'],
    reference_image_multiple: [], reference_image: 'vibe', reference_strength: 0, reference_information_extracted: 0 });
  assert.equal(refs.length, 2);
  assert.equal(refs[0].content, 'data:image/png;base64,ref');
  assert.equal(refs[1].settings.referenceStrength, 0);
  assert.equal(refs[1].settings.informationExtracted, 0);
});
