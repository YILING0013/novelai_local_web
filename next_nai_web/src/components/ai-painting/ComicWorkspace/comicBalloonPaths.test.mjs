import test from 'node:test';
import assert from 'node:assert/strict';
import { comicBalloonContours, comicBalloonPath, moveComicBalloonPoint, splitComicBalloonCurve } from './comicBalloonPaths.mjs';
import { COMIC_BALLOON_PRESETS, comicElementSvg, createComicElement } from './comicElements.mjs';

test('所有对白预设提供独立的可编辑闭合轮廓，默认节点与最终绘制一致', () => {
  assert.ok(COMIC_BALLOON_PRESETS.length >= 21);
  for (const preset of COMIC_BALLOON_PRESETS) {
    const contours = comicBalloonContours(preset.id);
    const element = createComicElement('bubble', { x: 0, y: 0, width: 240, height: 180 }, { presetId: preset.id });
    assert.equal(comicElementSvg(element), comicElementSvg({ ...element, balloonContours: contours }));
    for (const contour of contours) {
      assert.ok(contour.length >= 3);
      assert.match(comicBalloonPath(contour), /^M .* Z$/);
      for (const point of contour) for (const field of ['x', 'y', 'inX', 'inY', 'outX', 'outY']) assert.ok(Number.isFinite(point[field]));
    }
    contours[0][0].x = -500;
    assert.notEqual(comicBalloonContours(preset.id)[0][0].x, -500);
  }
});

test('曲线加点保留每一段形状，包括最后一段与第一点相接的曲线', () => {
  const contours = comicBalloonContours('speech')[0];
  const original = structuredClone(contours);
  const sample = (start, end, t) => ['x', 'y'].map((axis) => {
    const suffix = axis.toUpperCase();
    return (1 - t) ** 3 * start[axis] + 3 * (1 - t) ** 2 * t * start[`out${suffix}`] + 3 * (1 - t) * t * t * end[`in${suffix}`] + t ** 3 * end[axis];
  });
  for (const index of [1, contours.length - 1]) {
    const split = splitComicBalloonCurve(contours, index);
    assert.equal(split.length, contours.length + 1);
    for (const t of [0, 0.1, 0.25, 0.5, 0.65, 0.9, 1]) {
      const expected = sample(contours[index], contours[(index + 1) % contours.length], t);
      const actual = t <= 0.5 ? sample(split[index], split[index + 1], t * 2) : sample(split[index + 1], split[(index + 2) % split.length], t * 2 - 1);
      assert.ok(actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-9));
    }
  }
  assert.deepEqual(contours, original);
});

test('锚点带动控制柄，平滑柄保持切线，Alt 可以独立弯曲且不影响其他轮廓', () => {
  const original = comicBalloonContours('thought');
  const snapshot = structuredClone(original);
  const target = { contour: 1, node: 0, handle: 'anchor' };
  const point = original[1][0];
  const moved = moveComicBalloonPoint(original, target, { x: point.x + 3, y: point.y - 5 });
  assert.equal(moved[1][0].inX, point.inX + 3);
  assert.equal(moved[1][0].outY, point.outY - 5);
  assert.deepEqual(moved[0], original[0]);
  const smooth = moveComicBalloonPoint(original, { ...target, handle: 'out' }, { x: point.x + 4, y: point.y + 2 })[1][0];
  assert.ok(Math.abs((smooth.inX - point.x) * 2 - (smooth.inY - point.y) * 4) < 1e-9);
  assert.ok(smooth.inX < point.x && smooth.inY < point.y);
  const independent = moveComicBalloonPoint(original, { ...target, handle: 'out' }, { x: point.x + 4, y: point.y + 2 }, true)[1][0];
  assert.equal(independent.inX, point.inX);
  assert.equal(independent.inY, point.inY);
  assert.equal(independent.smooth, false);
  assert.deepEqual(original, snapshot);
});
