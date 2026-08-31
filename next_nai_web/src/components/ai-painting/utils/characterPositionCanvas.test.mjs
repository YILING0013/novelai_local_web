import assert from 'node:assert/strict';
import test from 'node:test';

import { fitCharacterPositionCanvas } from './characterPositionCanvas.mjs';

test('portrait character canvas fits a wide host without stretching', () => {
  const result = fitCharacterPositionCanvas(1176, 390.7, 832, 1216);

  assert.ok(Math.abs(result.width - 267.321) < 0.01, result.width);
  assert.ok(Math.abs(result.height - 390.7) < 0.001, result.height);
  assert.ok(Math.abs((result.width / result.height) - (832 / 1216)) < 0.000001);
});

test('invalid or empty dimensions produce an empty canvas', () => {
  assert.deepEqual(fitCharacterPositionCanvas(0, 390.7, 832, 1216), { width: 0, height: 0 });
  assert.deepEqual(fitCharacterPositionCanvas(1176, 390.7, 832, 0), { width: 0, height: 0 });
});
