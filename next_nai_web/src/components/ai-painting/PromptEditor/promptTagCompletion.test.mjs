import assert from 'node:assert/strict';
import test from 'node:test';
import { getPromptTagRange, insertPromptTag, invalidPromptSyntaxSymbols } from './promptTagCompletion.mjs';
import { DEFAULT_PROMPT_SYNTAX } from './promptCatalog.mjs';

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

test('跨行嵌套注释中内层结束后的文字不参与标签联想', () => {
  const text = '/* first /* inner */\nlight, last */, blue_hair';
  assert.equal(getPromptTagRange(text, text.indexOf('light') + 2), null);
  assert.equal(getPromptTagRange(text, text.length).query, 'blue_hair');
});

test('正则里的逗号、次数与字符组都属于同一条查询，选择结果后保留相邻词条', () => {
  for (const syntax of [DEFAULT_PROMPT_SYNTAX, { ...DEFAULT_PROMPT_SYNTAX, category: '@', exact: '!', regex: '~' }]) {
    for (const pattern of ['^[a,b]{1,3}', '(blue,red)', 'blue\\,red', '^fu[']) {
      const query = syntax.category + '原神' + syntax.exact + syntax.regex + pattern;
      const text = 'prev, ' + query + ', next';
      const cursor = 6 + query.length;
      const range = getPromptTagRange(text, cursor, cursor, syntax);
      assert.equal(range.query, query);
      if (!pattern.endsWith('[')) {
        assert.equal(insertPromptTag(text, range, 'sample').text, 'prev, sample, next');
        assert.equal(getPromptTagRange(text, text.length, text.length, syntax).query, 'next');
      }
    }
  }
  const comment = '/* =*^cats */';
  assert.equal(getPromptTagRange(comment, 10, 10, DEFAULT_PROMPT_SYNTAX), null);
  const query = '=*[abc]';
  assert.equal(getPromptTagRange(query, query.length, query.length, { ...DEFAULT_PROMPT_SYNTAX, enabled: false }), null);
});

test('自定义符号接受不同标点，标出冲突、提示词保留符号与空值', () => {
  assert.deepEqual(invalidPromptSyntaxSymbols(DEFAULT_PROMPT_SYNTAX), []);
  assert.deepEqual(invalidPromptSyntaxSymbols({ ...DEFAULT_PROMPT_SYNTAX, category: '@', exact: '!', fuzzy: '~', regex: '#' }), []);
  assert.deepEqual(invalidPromptSyntaxSymbols({ enabled: true, category: '＋', exact: '＝', fuzzy: '？', regex: '＊' }), []);
  assert.deepEqual(invalidPromptSyntaxSymbols({ ...DEFAULT_PROMPT_SYNTAX, category: '?' }), ['category', 'fuzzy']);
  for (const exact of ['', 'AA', ',', '，', '[', '{', ':', '/', '\\', ' ']) {
    assert.deepEqual(invalidPromptSyntaxSymbols({ ...DEFAULT_PROMPT_SYNTAX, exact }), ['exact']);
  }
});

test('数字或括号权重中的正则保留字符组和数量，选中词条后只替换搜索命令', () => {
  for (const [prefix, query, suffix] of [
    ['1.5::', '=*^blue_[a-z]+', '::'], ['{', '=*^blue_[a-z]{2,4}$', '}'],
    ['[{', '=*^b[ace]{1,3}', '}]'], ['{', '＋原神＝＊^fu[a-z]{1,3}', '}'],
    ['{', '=*^test{1,3}', ''],
  ]) {
    const syntax = query.includes('＊') ? { enabled: true, category: '＋', exact: '＝', fuzzy: '？', regex: '＊' } : DEFAULT_PROMPT_SYNTAX;
    const raw = prefix + query + suffix;
    for (const cursor of [prefix.length + query.length, raw.length]) {
      const range = getPromptTagRange(raw, cursor, cursor, syntax);
      assert.equal(range.query, query);
      assert.equal(insertPromptTag(raw, range, 'blue_hair').text, prefix + 'blue_hair' + suffix + ', ');
    }
  }
});
