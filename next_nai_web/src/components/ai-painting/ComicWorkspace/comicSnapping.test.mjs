import test from 'node:test';
import assert from 'node:assert/strict';
import { comicCutIntersections, snapComicCutPoint } from './comicSnapping.mjs';

const square = { id: 'square', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };

test('切割点按真实斜边吸附，同距离时保留顶层画框', () => {
  const top = { id: 'top', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  const panels = [top, { ...top, id: 'bottom' }];
  const nearest = snapComicCutPoint(panels, { x: 55, y: 45 }, 8);
  assert.equal(nearest.panelId, 'top');
  assert.equal(nearest.edgeIndex, 0);
  assert.deepEqual(nearest.point, { x: 50, y: 50 });
  assert.equal(nearest.distance, Math.hypot(5, 5));
  assert.equal(snapComicCutPoint(panels, { x: 55, y: 45 }, 6), null);
});

test('一次快速拖动穿过两条边，交点按前进方向排序', () => {
  const crossings = comicCutIntersections(square, { x: -20, y: 50 }, { x: 120, y: 50 });
  assert.deepEqual(crossings, [
    { panelId: 'square', edgeIndex: 3, point: { x: 0, y: 50 }, distance: 20 },
    { panelId: 'square', edgeIndex: 1, point: { x: 100, y: 50 }, distance: 120 },
  ]);
  const reversed = comicCutIntersections(square, { x: 120, y: 50 }, { x: -20, y: 50 });
  assert.deepEqual(reversed.map((hit) => hit.point), [{ x: 100, y: 50 }, { x: 0, y: 50 }]);
  assert.deepEqual(comicCutIntersections(square, { x: 50, y: 50 }, { x: 100, y: 50 }).map((hit) => hit.point), [{ x: 100, y: 50 }]);
});

test('穿过顶点只记录一个交点，单纯擦过顶点不算穿越', () => {
  const crossings = comicCutIntersections(square, { x: -20, y: -20 }, { x: 120, y: 120 });
  assert.deepEqual(crossings.map((hit) => hit.point), [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  assert.deepEqual(comicCutIntersections(square, { x: -20, y: 20 }, { x: 20, y: -20 }), []);
});

test('沿画框边共线滑动和原地指针事件不会产生穿越交点', () => {
  assert.deepEqual(comicCutIntersections(square, { x: -20, y: 0 }, { x: 120, y: 0 }), []);
  assert.deepEqual(comicCutIntersections(square, { x: 120, y: 100 }, { x: -20, y: 100 }), []);
  assert.deepEqual(comicCutIntersections(square, { x: 50, y: 50 }, { x: 50, y: 50 }), []);
});
