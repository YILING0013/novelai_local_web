import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getPreviewTagRanges, PROMPT_TEXT_STYLE } from './previewTags.mjs';

test('按中英文逗号查询完整标签，大小写和下划线归一，保留原文范围', () => {
  const text = ' Blue_Hair,\n红色眼睛，artist_(sample),  year 2025 ';
  const tags = getPreviewTagRanges(text);
  assert.deepEqual(tags.map(({ key }) => key), ['blue hair', '红色眼睛', 'artist (sample)', 'year 2025']);
  assert.deepEqual(tags.map(({ start, end }) => text.slice(start, end)), ['Blue_Hair', '红色眼睛', 'artist_(sample)', 'year 2025']);
});

test('权重符号不参与精确翻译，也不改变应渲染的原始文字', () => {
  const text = ' {{blue_eyes}}, -1.5:: RED HAIR ::, [long_hair], +1.2::smile, open_mouth::';
  const tags = getPreviewTagRanges(text);
  assert.deepEqual(tags.map(({ key }) => key), ['blue eyes', 'red hair', 'long hair', 'smile', 'open mouth']);
  assert.deepEqual(tags.map(({ start, end }) => text.slice(start, end)), ['blue_eyes', 'RED HAIR', 'long_hair', 'smile', 'open_mouth']);
  assert.deepEqual(getPreviewTagRanges(' ,， {}, [] , 1.2:: ::'), []);
});

test('混合大小写、连续空格和下划线使用相同翻译键，仍保留显示原文', () => {
  const text = 'LONG_HAIR, long  hair, Long__Hair, _LoNg_ _hAiR_, ___';
  const tags = getPreviewTagRanges(text);
  assert.deepEqual(tags.map(({ key }) => key), Array(4).fill('long hair'));
  assert.deepEqual(tags.map(({ start, end }) => text.slice(start, end)), [
    'LONG_HAIR', 'long  hair', 'Long__Hair', '_LoNg_ _hAiR_',
  ]);
});

test('长自然语言段不参与翻译，其他短标签仍可查询', () => {
  const tags = getPreviewTagRanges(`blue_hair, ${'a'.repeat(501)}, red_eyes`);
  assert.deepEqual(tags.map(({ key }) => key), ['blue hair', 'red eyes']);
  assert.equal(getPreviewTagRanges('a'.repeat(500)).length, 1);
});

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { code } = transformSync(readFileSync(new URL('./EnhancedPreview.js', import.meta.url), 'utf8'), {
  filename: 'EnhancedPreview.js',
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'commonjs' },
});

test('高亮预览保留空白、换行和随机语法', () => {
  const display = ({ component = 'div', children, title, ...props }) => React.createElement(component, {
    ...(typeof title === 'string' ? { title } : {}),
    ...(props['data-preview-translation'] ? { 'data-preview-translation': props['data-preview-translation'] } : {}),
  }, children);
  const dependencies = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': new Proxy({}, { get: () => display }),
    '@mui/icons-material': new Proxy({}, { get: () => () => null }),
    '@/utils/ApiClient': { __esModule: true, default: {} },
    '@/i18n/I18nProvider': { useI18n: () => ({ t: (key) => key }) },
    './previewTags.mjs': { getPreviewTagRanges, PROMPT_TEXT_STYLE },
  };
  const testModule = { exports: {} };
  runInNewContext(code, { module: testModule, exports: testModule.exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  const text = 'Blue_Hair, 1.2::red eyes::,\n /* 原始注释 */ <ran_id="人物"/>, <ran_sorting_id="组合"/>\n';
  const result = renderToStaticMarkup(React.createElement(testModule.exports.default, { text, randomPromptConfig: null }));
  const visibleText = result.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\u200b$/, '');
  assert.equal(visibleText, text);
});
