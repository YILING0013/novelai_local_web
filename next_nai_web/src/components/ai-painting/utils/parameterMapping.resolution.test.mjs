import assert from 'node:assert/strict';
import test from 'node:test';
import { getPanelResolutionParameters, setLargeImageMode } from './parameterMapping.js';

test('画框按比例优先匹配允许尺寸，同等比例取最大尺寸，横竖选择相互对称', () => {
  const params = { model: 'nai-diffusion-4-5-full' };
  assert.deepEqual(getPanelResolutionParameters(params, { width: 1, height: 1 }), { width: 1024, height: 1024 });
  assert.deepEqual(getPanelResolutionParameters(params, { width: 3, height: 2 }), { width: 1152, height: 768 });
  assert.deepEqual(getPanelResolutionParameters(params, { width: 2, height: 3 }), { width: 768, height: 1152 });
  for (const ratio of [0.1, 0.697, 1.37, 20]) {
    const result = getPanelResolutionParameters(params, { width: ratio, height: 1 });
    assert.ok(result.width >= 512 && result.height >= 512);
    assert.ok(result.width <= 2048 && result.height <= 2048 && result.width * result.height <= 1048576);
    const error = Math.abs(Math.log(result.width / result.height / ratio));
    for (let width = 512; width <= 2048; width += 64) {
      for (let height = 512; height <= 2048; height += 64) {
        if (width * height <= 1048576) assert.ok(error <= Math.abs(Math.log(width / height / ratio)) + 1e-10);
      }
    }
    assert.deepEqual(getPanelResolutionParameters(params, { width: 1, height: ratio }), { width: result.height, height: result.width });
  }
});

test('匹配只使用当前画框的普通或大图权限，不受其他面板的全局分辨率缓存影响', () => {
  const params = { model: 'nai-diffusion-5-full-medium', use_upscale_credits: true, steps: 14 };
  setLargeImageMode(false);
  assert.deepEqual(getPanelResolutionParameters(params, { width: 2, height: 1 }), { width: 2432, height: 1216 });
  setLargeImageMode(true);
  assert.deepEqual(getPanelResolutionParameters({ ...params, use_upscale_credits: false }, { width: 2, height: 1 }), { width: 1408, height: 704 });
  assert.equal(params.use_upscale_credits, true);
  assert.equal(params.steps, 14);
  setLargeImageMode(false);
});
