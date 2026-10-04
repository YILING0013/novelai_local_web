import assert from 'node:assert/strict';
import test from 'node:test';
import { getPromptTagRange, insertPromptTag } from './promptTagCompletion.mjs';

test('光标在词中间时按前半词查询，选择后替换完整标签', () => {
  const text = '1girl, blue eyes, smile';
  const range = getPromptTagRange(text, 9);
  assert.deepEqual(range, { start: 7, end: 16, query: 'bl' });
  assert.deepEqual(insertPromptTag(text, range, 'black eyes'), {
    text: '1girl, black eyes, smile', cursor: 19,
  });
});

test('保留已存在的中英文逗号和后续空白', () => {
  for (const comma of [',', '，']) {
    const text = `  blu  ${comma}  smile`;
    const result = insertPromptTag(text, getPromptTagRange(text, 5), 'blue hair');
    assert.deepEqual(result, { text: `  blue hair  ${comma}  smile`, cursor: 16 });
  }
  assert.deepEqual(insertPromptTag('blu,', getPromptTagRange('blu,', 3), 'blue hair'), {
    text: 'blue hair,', cursor: 10,
  });
});

test('保留负数权重、嵌套括号及内部空白，末尾逗号位于闭合符外', () => {
  const text = '  {-2.0:: [blu] ::}  ';
  const range = getPromptTagRange(text, text.indexOf('blu') + 3);
  assert.equal(range.query, 'blu');
  assert.deepEqual(insertPromptTag(text, range, 'blue hair'), {
    text: '  {-2.0:: [blue hair] ::},  ', cursor: 28,
  });
  const grouped = '1.2::cat, blu::';
  assert.equal(insertPromptTag(grouped, getPromptTagRange(grouped, grouped.length), 'blue hair').text,
    '1.2::cat, blue hair::, ');
});

test('中文输入和多行文本使用相同替换范围，已有换行继续作为分隔符', () => {
  const text = '猫，\r\n  蓝色眼睛\nsmile';
  const range = getPromptTagRange(text, text.indexOf('眼'));
  assert.deepEqual(range, { start: 6, end: 10, query: '蓝色' });
  assert.deepEqual(insertPromptTag(text, range, 'blue eyes'), {
    text: '猫，\r\n  blue eyes\nsmile', cursor: 15,
  });
});

test('同标签选区按选中文字查询，替换完整词条，跨标签选区不联想', () => {
  const text = '1girl, blue eyes, smile';
  const range = getPromptTagRange(text, 12, 16);
  assert.deepEqual(range, { start: 7, end: 16, query: 'eyes' });
  assert.equal(insertPromptTag(text, range, 'red eyes').text, '1girl, red eyes, smile');
  assert.equal(getPromptTagRange(text, 8, 20), null);
});

test('注释、随机标记及其跨行内容不产生破坏语法的建议', () => {
  for (const text of ['/* cat, blue */', '/* cat,\nblue', '<ran_id="cat, blue"/>', '<ran_sorting_id="blue']) {
    assert.equal(getPromptTagRange(text, text.indexOf('blue') + 4), null);
  }
  const text = '/* cat */ , blue';
  assert.equal(getPromptTagRange(text, text.length).query, 'blue');
});

test('空白、权重前缀和分隔符后不误查询，普通标签末尾补逗号与空格', () => {
  assert.equal(getPromptTagRange('1.2::blue::', 3), null);
  assert.equal(getPromptTagRange('blue, ', 6), null);
  assert.equal(getPromptTagRange('', 0), null);
  assert.deepEqual(insertPromptTag('blu', getPromptTagRange('blu', 3), 'blue hair'), {
    text: 'blue hair, ', cursor: 11,
  });
});
