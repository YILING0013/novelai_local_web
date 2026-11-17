import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeCanvas, readPsd, writePsd } from 'ag-psd';

const allocations = [];
// 用 2×2 像素观察分配顺序，避免安全回归测试本身申请大块内存。
initializeCanvas(
  () => assert.fail('使用 ImageData 导入 PSD 时不应创建 Canvas'),
  (width, height) => {
    allocations.push(width * height * 4);
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  },
);
const pixels = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]),
};
const fixture = writePsd({
  width: 2,
  height: 2,
  imageData: pixels,
  children: [{ name: '像素图层', imageData: pixels }],
}, { generateThumbnail: false });

test('PSD 正常导入保留尺寸、图层名称和原始像素', () => {
  const psd = readPsd(fixture, {
    useImageData: true, skipThumbnail: true, totalMemoryLimit: 64,
  });
  assert.equal(psd.width, 2);
  assert.equal(psd.height, 2);
  assert.equal(psd.children[0].name, '像素图层');
  assert.deepEqual(psd.children[0].imageData.data, pixels.data);
  assert.deepEqual(psd.imageData.data, pixels.data);
});

test('PSD 图层超过内存预算时，在分配像素之前拒绝读取', () => {
  allocations.length = 0;
  assert.throws(() => readPsd(fixture, {
    useImageData: true, skipThumbnail: true,
    skipCompositeImageData: true, totalMemoryLimit: 8,
  }), /Exceeded memory limit/);
  assert.deepEqual(allocations, []);
});

test('PSD 图层与合成预览共用内存预算，不能分别突破上限', () => {
  allocations.length = 0;
  assert.throws(() => readPsd(fixture, {
    useImageData: true, skipThumbnail: true, totalMemoryLimit: 16,
  }), /Exceeded memory limit/);
  assert.deepEqual(allocations, [16]);
});
