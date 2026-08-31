import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateNovelAIImageCost } from './novelAICost.mjs';

test('V5 在 V4 基础价上按单次请求乘 1.5 并取整', () => {
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28,
  }), 20);
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-curated', width: 832, height: 1216, steps: 28,
  }), 30);
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-full', width: 832, height: 1216, steps: 23,
  }), 26);
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-full', width: 1024, height: 1024, steps: 28, nSamples: 2,
  }), 30);
});

test('V5 图生图和局部重绘使用对应强度', () => {
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-full',
    width: 1024,
    height: 1024,
    steps: 28,
    hasImage: true,
    strength: 0.7,
  }), 21);
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-full-inpainting',
    width: 1024,
    height: 1024,
    steps: 28,
    hasImage: true,
    hasMask: true,
    strength: 0.7,
    inpaintImg2ImgStrength: 0.5,
  }), 15);
});

test('V5 不套用旧模型的最小像素夹紧，并拒绝单张超过 140 点', () => {
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-curated', width: 64, height: 64, steps: 28,
  }), 2);
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-full', width: 2048, height: 1536, steps: 46,
  }), 140);
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-full', width: 2048, height: 1536, steps: 47,
  }), -3);
  assert.equal(calculateNovelAIImageCost({
    model: 'nai-diffusion-5-full',
    width: 2048,
    height: 1536,
    steps: 50,
    hasImage: true,
    strength: 0.7,
  }), 105);
});
