import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getPreviewTagRanges, PROMPT_TEXT_STYLE } from './previewTags.mjs';

test('词库查询保留括号限定词，大小写和下划线归一，保留原文范围', () => {
  const text = ' Blue_Hair,\n红色眼睛，artist_(sample),  year 2025 ';
  const tags = getPreviewTagRanges(text, { dictionaryOnly: true });
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

test('长自然语言仍保留供机器翻译，不受词库单条长度限制影响', () => {
  const tags = getPreviewTagRanges(`blue_hair, ${'a'.repeat(501)}, red_eyes`);
  assert.deepEqual(tags.map(({ key }) => key), ['blue hair', 'a'.repeat(501), 'red eyes']);
  assert.equal(getPreviewTagRanges('a'.repeat(500)).length, 1);
});

test('清理嵌套正负小数权重后拆中英文句号，排除 artist、注释、随机语法和无效符号', () => {
  const text = '-1.2::{[(+1.5:蓝色天空)]}::。 (red_eyes:1.2), 1.2::artist:{name}::， (artist：name), 水彩画. 桜の花カタカナ， [long_hair], /* do not translate */ <ran_id="排除"/>, @@💥###, ((golden {light}))';
  const tags = getPreviewTagRanges(text);
  assert.deepEqual(tags.map(({ key }) => key), ['蓝色天空', 'red eyes', '水彩画', '桜の花カタカナ', 'long hair', 'golden light']);
  assert.deepEqual(tags.map(({ start, end }) => text.slice(start, end)), ['蓝色天空', 'red_eyes', '水彩画', '桜の花カタカナ', 'long_hair', 'golden {light']);
});

test('词库命中的句号和括号标签保持完整，未命中才去符号拆句', () => {
  const text = 'dr._sample_(series). other text, foo_(bar)';
  const dictionaryTranslations = { 'dr. sample (series). other text': '完整词条', 'foo (bar)': '角色名' };
  assert.deepEqual(getPreviewTagRanges(text, { dictionaryTranslations }).map(({ key }) => key), Object.keys(dictionaryTranslations));
  assert.deepEqual(getPreviewTagRanges(text).map(({ key }) => key), ['dr', 'sample series', 'other text', 'foo bar']);
});

test('代理对符号不改变原文下标，句号后的 artist 标签也不参与翻译', () => {
  const text = '💥blue hair. artist:{foo}, bar, golden💥light, 🍀red eyes';
  const tags = getPreviewTagRanges(text);
  assert.deepEqual(tags.map(({ key }) => key), ['blue hair', 'bar', 'golden light', 'red eyes']);
  assert.deepEqual(tags.map(({ start, end }) => text.slice(start, end)), ['blue hair', 'bar', 'golden💥light', 'red eyes']);
});

test('画师名内部的句号和括号不泄露为新词，词库范围排除末尾句号', () => {
  const text = 'cat。artist:foo, foo. artist:{bar}, artist:1.2::foo::, artist:(foo.bar), artist:name.with.period';
  const dictionaryTranslations = { cat: '猫', foo: '示例' };
  const tags = getPreviewTagRanges(text, { dictionaryTranslations });
  assert.deepEqual(tags.map(({ key }) => key), ['cat', 'foo']);
  assert.deepEqual(tags.map(({ start, end }) => text.slice(start, end)), ['cat', 'foo']);
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
    '@mui/material/styles': { alpha: require('@mui/material/styles').alpha },
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
  const result = renderToStaticMarkup(React.createElement(testModule.exports.default, {
    text, randomPromptConfig: null, tags: getPreviewTagRanges(text), translations: { 'blue hair': '蓝发', 'red eyes': '红眼' },
  }));
  const visibleText = result.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\u200b$/, '');
  assert.equal(visibleText, text);
  assert.match(result, /data-preview-translation="蓝发"/);
  assert.match(result, /data-preview-translation="红眼"/);
});
