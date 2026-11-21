import assert from 'node:assert/strict';
import test from 'node:test';
import { curveTable } from './compositor/lib/pixels.js';

test('单图调色曲线穿过控制点，在相邻区间内平滑过渡', () => {
  const points = [[0, 0], [64, 20], [128, 210], [192, 220], [255, 255]];
  const smooth = curveTable(points, true);
  const linear = curveTable(points);

  for (const [input, output] of points) assert.equal(smooth[input], output);
  for (let x = 1; x <= 255; x++) assert.ok(smooth[x] >= smooth[x - 1]);
  assert.notEqual(smooth[48], linear[48]);
  assert.deepEqual(curveTable([[0, 0], [255, 255]], true), Uint8ClampedArray.from({ length: 256 }, (_, x) => x));
});
