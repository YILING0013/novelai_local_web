import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPromptForEditing } from './promptFormatting.mjs';
import { adjustPromptWeight } from './promptWeights.mjs';
import { DEFAULT_PROMPT_SYNTAX } from './promptCatalog.mjs';

const settings = { normalizeCommas: true, replaceUnderscores: true, trailingComma: 'preserve' };

test('格式化普通标签时保留注释、占位符和权重语法', () => {
  const source = 'long_hair， 1.2::red， blue::， /*保留， /*嵌套_x*/ 内容*/， <ran_id A_B>， __keep_me__， artist:name_one， tag\\,literal';
  const expected = 'long hair, 1.2::red, blue::, /*保留， /*嵌套_x*/ 内容*/, <ran_id A_B>, __keep_me__, artist:name_one, tag\\,literal';
  assert.equal(formatPromptForEditing(source, settings), expected);
});

test('段尾规则保留原有换行，也不会把逗号写入未闭合注释', () => {
  assert.equal(formatPromptForEditing('red，\nblue,  ', { ...settings, trailingComma: 'remove' }).trimEnd(), 'red,\nblue');
  assert.equal(formatPromptForEditing('red\nblue', { ...settings, trailingComma: 'append' }), 'red\nblue,');
  assert.equal(formatPromptForEditing('red /*注释未结束，', { ...settings, trailingComma: 'append' }), 'red /*注释未结束，');
});

test('自动格式化不改变搜索表达式内的逗号、下划线和次数，仍整理相邻词条', () => {
  const opts = { ...settings, suggestionSyntax: DEFAULT_PROMPT_SYNTAX };
  assert.equal(formatPromptForEditing('long_hair， 1.5::=*^[a,b]{1,3}::， blue_eyes', opts),
    'long hair, 1.5::=*^[a,b]{1,3}::, blue eyes');
  const opted = { ...opts, suggestionSyntax: { enabled: true, category: '＋', exact: '＝', fuzzy: '？', regex: '＊' } };
  assert.equal(formatPromptForEditing('{＋原神＝＊^blue_[a-z]{2,4}$}，next_tag', opted),
    '{＋原神＝＊^blue_[a-z]{2,4}$}, next tag');
});

test('数字步长作用于新权重与已有权重，括号权重仍按层增减', () => {
  assert.equal(adjustPromptWeight('red', 0, 3, 1, 'numeric', 0.05).text, '1.05::red::');
  assert.equal(adjustPromptWeight('1.15::red::', 8, 8, -1, 'numeric', 0.05).text, '1.1::red::');
  assert.equal(adjustPromptWeight('{red}', 3, 3, 1, 'brackets', 0.5).text, '{{red}}');
});
