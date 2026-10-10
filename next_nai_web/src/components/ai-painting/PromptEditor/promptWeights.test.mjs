import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustPromptWeight, weightUpText, weightDownText } from './promptWeights.mjs';

test('无权重提示词从 1.0 每次调整 0.1，保留未选词、分隔符、空白和限定括号', () => {
  const text = 'keep,  blue_hair，\n furina_(genshin_impact), untouched';
  const start = text.indexOf('blue_hair');
  const end = text.indexOf(', untouched');
  const result = weightUpText(text, start, end);
  assert.equal(result.text, 'keep,  1.1::blue_hair::，\n 1.1::furina_(genshin_impact)::, untouched');
  assert.equal(result.text.slice(result.start, result.end), '1.1::blue_hair::，\n 1.1::furina_(genshin_impact)::');
  assert.equal(weightDownText('blue eyes', 0, 9).text, '0.9::blue eyes::');
});

test('返回选区可连续调权，从正数经过零降到负数且没有浮点尾数', () => {
  let result = { text: '0.2::blue hair::, untouched', start: 5, end: 14 };
  for (let count = 0; count < 4; count += 1) {
    result = adjustPromptWeight(result.text, result.start, result.end, -1);
  }
  assert.equal(result.text, '-0.2::blue hair::, untouched');
  assert.equal(result.text.slice(result.start, result.end), '-0.2::blue hair::');
  for (let count = 0; count < 5; count += 1) {
    result = adjustPromptWeight(result.text, result.start, result.end, 1);
  }
  assert.equal(result.text, '0.3::blue hair::, untouched');
  assert.equal(weightUpText('1.25::cat::', 0, 11).text, '1.35::cat::');
});

test('已有括号权重按层调整，和数值权重、默认格式共同使用', () => {
  const text = '{{strong}}, [[soft]], -1.2::negative::, normal';
  assert.equal(weightUpText(text, 0, text.length).text, '{{{strong}}}, [soft], -1.1::negative::, 1.1::normal::');
  assert.equal(weightDownText(text, 0, text.length).text, '{strong}, [[[soft]]], -1.3::negative::, 0.9::normal::');
  assert.equal(weightUpText('normal, -0.1::cat::', 0, 18, 'brackets').text, '{normal}, 0.0::cat::');
  assert.equal(weightDownText('normal', 0, 6, 'brackets').text, '[normal]');
});

test('包含逗号或嵌套权重的整体权重组不会被拆坏', () => {
  const text = '1.2::red, blue::, {soft, warm}, 1.4::[nested]::';
  const result = weightDownText(text, 0, text.length);
  assert.equal(result.text, '1.1::red, blue::, soft, warm, 1.3::[nested]::');
  assert.equal(result.end, result.text.length);
  assert.equal(weightUpText('1.2::1.3::cat::::', 0, 17).text, '1.3::1.3::cat::::');
});

test('普通词的局部选择只修改选区，词内括号不当成权重', () => {
  const text = 'girl with blue eyes, cat_(series)';
  const start = text.indexOf('blue');
  const end = text.indexOf(',');
  const first = weightUpText(text, start, end);
  assert.equal(first.text, 'girl with 1.1::blue eyes::, cat_(series)');
  const second = weightUpText(first.text, first.start, first.end);
  assert.equal(second.text, 'girl with 1.2::blue eyes::, cat_(series)');
  assert.equal(second.text.slice(second.start, second.end), '1.2::blue eyes::');
  const third = weightDownText(second.text, second.start, second.end);
  assert.equal(third.text, first.text);
  assert.equal(weightDownText('cat_(series)', 0, 12).text, '0.9::cat_(series)::');
  assert.equal(weightDownText('{cat} {dog}', 0, 11).text, 'cat dog');
  assert.equal(weightUpText('{cat} {dog}', 1, 4).text, '{{cat}} {dog}');
  assert.equal(weightUpText('1.2::red:: blue', 5, 8).text, '1.3::red:: blue');
  const partial = weightUpText('blue_hair', 5, 9);
  assert.equal(weightUpText(partial.text, partial.start, partial.end).text, 'blue_1.2::hair::');
});

test('纯分隔符、注释和随机提示词保持原样', () => {
  assert.equal(weightUpText(' , ，\n ', 0, 6).text, ' , ，\n ');
  const special = '/* red, blue */, <ran_id="style"/>, cat';
  assert.equal(weightUpText(special, 0, special.length).text, '/* red, blue */, <ran_id="style"/>, 1.1::cat::');
});

test('光标可连续调权，回到 1.0 后移除数值包装，再次降权为 0.9', () => {
  const text = 'keep, blue eyes, untouched';
  const cursor = text.indexOf('eyes');
  let result = weightUpText(text, cursor, cursor);
  assert.deepEqual(result, { text: 'keep, 1.1::blue eyes::, untouched', start: cursor + 5, end: cursor + 5 });
  result = weightDownText(result.text, result.start, result.end);
  assert.deepEqual(result, { text, start: cursor, end: cursor });
  result = weightDownText(result.text, result.start, result.end);
  assert.deepEqual(result, { text: 'keep, 0.9::blue eyes::, untouched', start: cursor + 5, end: cursor + 5 });
  result = weightUpText(result.text, result.start, result.end);
  assert.deepEqual(result, { text, start: cursor, end: cursor });
});

test('权重归一只移除外层数值包装，选区和光标保留正文内部括号', () => {
  const text = '1.1::furina_(series)::';
  const selected = weightDownText(text, 0, text.length);
  assert.deepEqual(selected, { text: 'furina_(series)', start: 0, end: 15 });
  assert.equal(weightDownText(selected.text, selected.start, selected.end).text, '0.9::furina_(series)::');
  assert.deepEqual(weightUpText('0.9::{soft}::', 8, 8), { text: '{soft}', start: 3, end: 3 });
  assert.deepEqual(weightDownText('1.1::[soft]::', 8, 8), { text: '[soft]', start: 3, end: 3 });
  let negative = weightDownText('0.0::cat::', 7, 7);
  assert.deepEqual(negative, { text: '-0.1::cat::', start: 8, end: 8 });
  negative = weightUpText(negative.text, negative.start, negative.end);
  assert.deepEqual(negative, { text: '0.0::cat::', start: 7, end: 7 });
});

test('光标在词中、词末或完整权重组内可调，空白段和语法标记不变', () => {
  assert.deepEqual(weightUpText('cat, dog', 3, 3), { text: '1.1::cat::, dog', start: 8, end: 8 });
  assert.deepEqual(weightUpText('cat', 3, 3), { text: '1.1::cat::', start: 8, end: 8 });
  assert.deepEqual(weightDownText('{cat}, dog', 3, 3), { text: 'cat, dog', start: 2, end: 2 });
  assert.deepEqual(weightUpText('1.2::red, blue::', 12, 12), { text: '1.3::red, blue::', start: 12, end: 12 });
  for (const [text, cursor] of [['cat,  dog', 5], ['cat  , dog', 4], ['cat, ，\n dog', 6], ['   ', 1], ['/* cat */', 4], ['cat /* ignored */', 9], ['<ran_id="style"/>', 10], ['cat <ran_id="style"/>', 14], ['', 0]]) {
    assert.deepEqual(weightUpText(text, cursor, cursor), { text, start: cursor, end: cursor });
  }
});
