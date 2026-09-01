import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateNovelAIImageCost,
  estimateNovelAIGenerationCost,
  isDisplayableNovelAICost,
} from './novelAICost.mjs';

test('0 点属于可显示成本，非生成状态和超限状态保持隐藏', () => {
  assert.equal(isDisplayableNovelAICost(0), true);
  assert.equal(isDisplayableNovelAICost(20), true);
  assert.equal(isDisplayableNovelAICost(null), false);
  assert.equal(isDisplayableNovelAICost(-3), false);
});

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

test('有效订阅的普通小图显示 0，未订阅小图仍显示公式成本', () => {
  const imageOptions = {
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
  };

  assert.deepEqual(estimateNovelAIGenerationCost({
    ...imageOptions,
    subscriptionActive: true,
    useUpscaleCredits: false,
  }), {
    rawPerImage: 20,
    perImage: 0,
    total: 0,
    count: 1,
    subscriptionFree: true,
  });

  assert.deepEqual(estimateNovelAIGenerationCost({
    ...imageOptions,
    subscriptionActive: false,
    useUpscaleCredits: false,
    batchSize: 4,
  }), {
    rawPerImage: 20,
    perImage: 20,
    total: 80,
    count: 4,
    subscriptionFree: false,
  });
});

test('有效订阅的大图仍计费，连续生成同时给出单张和本批总消耗', () => {
  assert.deepEqual(estimateNovelAIGenerationCost({
    model: 'nai-diffusion-5-full',
    width: 1024,
    height: 1024,
    steps: 28,
    subscriptionActive: true,
    useUpscaleCredits: true,
    batchSize: 8,
  }), {
    rawPerImage: 30,
    perImage: 30,
    total: 240,
    count: 8,
    subscriptionFree: false,
  });
});

test('超出单张成本上限时不计算负数总消耗', () => {
  assert.deepEqual(estimateNovelAIGenerationCost({
    model: 'nai-diffusion-5-full',
    width: 2048,
    height: 1536,
    steps: 47,
    subscriptionActive: false,
    useUpscaleCredits: true,
    batchSize: 4,
  }), {
    rawPerImage: -3,
    perImage: -3,
    total: null,
    count: 4,
    subscriptionFree: false,
  });
});
