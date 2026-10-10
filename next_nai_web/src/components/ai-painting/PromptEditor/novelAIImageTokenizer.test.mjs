import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { inflateRaw } from 'pako';

import {
  NovelAIQwenTokenizer,
  countNovelAIMultiPromptTokens,
  getEnabledNovelAICharacterPromptTexts,
  getNovelAIImageTokenizerConfig,
} from './novelAIImageTokenizer.mjs';

const tokenizerAssetPath = new URL('../../../../public/qwen35_tokenizer.def', import.meta.url);

test('V5 模型使用 Qwen tokenizer 和各自的官方 token 上限', () => {
  assert.deepEqual(
    getNovelAIImageTokenizerConfig('nai-diffusion-5-curated'),
    { type: 'qwen', path: '/qwen35_tokenizer.def', limit: 703 },
  );
  assert.deepEqual(
    getNovelAIImageTokenizerConfig('nai-diffusion-5-full-inpainting'),
    { type: 'qwen', path: '/qwen35_tokenizer.def', limit: 1471 },
  );
  for (const model of ['nai-diffusion-5-full-medium', 'nai-diffusion-5-full-medium-inpainting']) {
    assert.deepEqual(getNovelAIImageTokenizerConfig(model),
      { type: 'qwen', path: '/qwen35_tokenizer.def', limit: 1471 });
  }
  assert.deepEqual(
    getNovelAIImageTokenizerConfig('nai-diffusion-4-5-full'),
    { type: 't5', path: '/t5_tokenizer.json', limit: 512 },
  );
});

test('multiprompt 逐字段累计 token，并只选择启用角色的同向提示词', () => {
  const tokenizer = {
    encode: (text) => Array.from(text),
  };
  const characterTabs = [
    { prompt: 'AB', uc: 'a' },
    { prompt: 'C', uc: 'bc', isTemporarilyDisabled: true },
    { prompt: 'DE', uc: '' },
  ];

  assert.deepEqual(
    getEnabledNovelAICharacterPromptTexts(characterTabs, 'prompt'),
    ['AB', 'DE'],
  );
  assert.deepEqual(
    getEnabledNovelAICharacterPromptTexts(characterTabs, 'uc', 2),
    ['a'],
  );
  assert.equal(countNovelAIMultiPromptTokens(tokenizer, ['main', 'AB', 'DE']), 8);
});

test('本地 Qwen 定义与官方资源一致并复现官方编码向量', () => {
  const compressedDefinition = fs.readFileSync(tokenizerAssetPath);
  assert.equal(
    createHash('sha256').update(compressedDefinition).digest('hex'),
    'f4040d875827d2f9edc30dd4d736bc4a853a19ceeb0d04f6e3648f17796d1667',
  );

  const definition = JSON.parse(
    new TextDecoder().decode(inflateRaw(compressedDefinition)),
  );
  const tokenizer = new NovelAIQwenTokenizer(
    definition.vocab,
    definition.merges,
    definition.specialTokens,
    definition.config,
  );

  assert.deepEqual(tokenizer.encode(''), []);
  assert.deepEqual(tokenizer.encode('girl, '), [27620, 11, 220]);
  assert.deepEqual(
    tokenizer.encode('1girl, masterpiece, no text'),
    [16, 27620, 11, 56744, 11, 874, 1414],
  );
  assert.deepEqual(
    tokenizer.encode('女孩，杰作，无文字'),
    [100665, 3709, 140724, 3709, 95979, 99943],
  );
  assert.deepEqual(tokenizer.encode('cafe\u0301, re\u0301sume\u0301, A\u030A'), [895, 56868, 11, 238976, 11, 76533]);
  assert.deepEqual(tokenizer.encode('<|im_start|>girl<|im_end|> <think>blue</think><|im_sta'), [
    248045, 27620, 248046, 220, 248068, 11855, 248069, 27, 91, 316, 77195,
  ]);
  assert.deepEqual(tokenizer.encode('👩🏽‍🎨✨🌌👨‍👩‍👧‍👦'), [
    9008, 239, 102, 9008, 237, 121, 373, 235, 9008, 236, 101, 169379,
    9008, 234, 234, 9008, 239, 101, 373, 235, 9008, 239, 102, 373, 235,
    9008, 239, 100, 373, 235, 9008, 239, 99,
  ]);
  const longTags = tokenizer.encode('masterpiece, best quality, 1girl, blue eyes, '.repeat(500));
  assert.equal(longTags.length, 6002);
  assert.equal(createHash('sha256').update(JSON.stringify(longTags)).digest('hex'),
    '2ba669a8eb0ee38c2b4ddb7e12332cfc7a5db444a5a4414cb25105335084d065');

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let state = 1701;
  const longWord = Array.from({ length: 100000 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return alphabet[state % alphabet.length];
  }).join('');
  assert.equal(tokenizer.encode(longWord).length, 64403);
});

test('BPE 先完成整轮相同词对合并，再处理本轮生成的较低 rank 词对', () => {
  const tokenizer = new NovelAIQwenTokenizer(
    { a: 0, b: 1, ab: 2, aba: 3, '<s>': 4 },
    [['ab', 'a'], ['a', 'b']],
    ['<s>'],
    { splitRegex: '[a-z]+' },
  );
  assert.deepEqual(tokenizer.encode('abab'), [2, 2]);
});
