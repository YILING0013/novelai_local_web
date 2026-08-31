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
});
