import assert from 'node:assert/strict';
import test from 'node:test';
import { checkResolutionLimit } from './ImageResizer.js';

test('大图在接近原比例时保留较多像素，不再局限于精确比例的小尺寸', () => {
  for (const [width, height] of [[3840, 2160], [2400, 3500], [1234, 2345], [5000, 1000]]) {
    const { suggestedResolution: [w, h] } = checkResolutionLimit(width, height);
    assert.ok(w * h >= 700000, `${width}×${height} 应保留足够像素，实际 ${w}×${h}`);
    assert.ok(Math.abs(Math.log((w / h) / (width / height))) <= Math.log(1.03));
  }
});

test('横竖互换得到互换的目标尺寸，普通与极端比例都遵守尺寸限制', () => {
  for (const [width, height] of [[3840, 2160], [2400, 3500], [3000, 4000], [5000, 1000], [10000, 300]]) {
    const [w, h] = checkResolutionLimit(width, height).suggestedResolution;
    assert.deepEqual(checkResolutionLimit(height, width).suggestedResolution, [h, w]);
    assert.ok(w <= 2048 && h <= 2048 && w * h <= 1048576);
    assert.equal(w % 64, 0);
    assert.equal(h % 64, 0);
    assert.equal(checkResolutionLimit(w, h).isOverLimit, false);
  }
});

test('已经符合允许尺寸的图片保持原样', () => {
  for (const [width, height] of [[1024, 1024], [1024, 576], [1024, 768], [832, 1216]]) {
    const result = checkResolutionLimit(width, height);
    assert.equal(result.isOverLimit, false);
    assert.equal(result.suggestedResolution, null);
  }
});
