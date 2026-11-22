import assert from 'node:assert/strict';
import test from 'node:test';
import { comicTextEdits } from './comicTextEdits.mjs';

const line = (text, x, y, vertical = false) => ({ text, direction: vertical ? 'vertical-rl' : 'horizontal-tb',
  bounds: { x, y, width: vertical ? 14 : 100, height: vertical ? 100 : 14 } });
const script = (text, id = 'd') => ({ text, id, direction: 'horizontal' });
const original = [script('先跟我回家吧。晚饭吃鱼，怎么样？'), script('喵……', 'cat')];
const lines = [line('先跟我回加吧', 10, 10), line('喵', 240, 12), line('脕饭吃免 怎么样', 14, 31)];

test('横排两行有错字和漏标点，跨过另一气泡匹配，输出原稿分段', () => {
  const edits = comicTextEdits({ ocr: { lines } }, original);
  assert.deepEqual(edits.map((e) => [e.dialogueId, e.text]), [
    ['d', '先跟我回家吧。'], ['cat', '喵……'], ['d', '晚饭吃鱼，怎么样？'],
  ]);
});

test('不同阅读方向、三行无标点、OCR 增删错字均对齐', () => {
  const rows = [line('今夭', 56, 12, true), line('我们一起', 37, 11, true), line('去看看海', 18, 12, true)];
  const edits = comicTextEdits({ ocr: { lines: rows } }, [script('今天我们一起去看海。')]);
  assert.deepEqual(edits.map((e) => e.text), ['今天', '我们一起', '去看海。']);
  const one = comicTextEdits({ ocr: { lines: [line('我是说眼晴不是装作没踩进里的洋子', 5, 5)] } },
    [script('我是说眼睛，不是装作没踩进泥里的样子。')]);
  assert.equal(one[0].text, '我是说眼睛，不是装作没踩进泥里的样子。');
});

test('只有一行时可以使用分句，重复短句和相似对白要人工选', () => {
  const get = (lines, dialogues) => comicTextEdits({ ocr: { lines } }, dialogues).map((e) => e.text);
  assert.deepEqual(get([lines[0]], original), ['先跟我回家吧。']);
  assert.deepEqual(get([line('我想和你一起去看大海', 0, 0)], [script('我想和你一起去看大海，好。')]), ['我想和你一起去看大海，']);
  assert.deepEqual(get([line('快走', 0, 0), line('快走', 200, 120)], [script('快走！')]), ['', '']);
  assert.deepEqual(get([line('今晚一起回家', 0, 0)], [script('今晚一起回家吧！'), script('今晚一起回家呀！', 'd2')]), ['']);
  assert.deepEqual(get([line('不相关', 0, 0)], [script('喵')]), ['']);
  assert.deepEqual(get([line('去看看', 0, 0), line('大海吧', 350, 250)], [script('去看看大海吧')]), ['', '']);
});

test('手动保留、自定义、恢复匹配、重开已应用的分行结果', () => {
  const state = { ocr: { lines }, assignments: { 0: null, 1: { action: 'erase' }, 2: { action: 'replace', text: '另写一句' } } };
  assert.deepEqual(comicTextEdits(state, original).map((e) => e.text), ['', '', '另写一句']);
  state.assignments[2] = { action: 'auto' };
  assert.equal(comicTextEdits(state, original)[2].text, '晚饭吃鱼，怎么样？');
  delete state.assignments[2];
  state.result = { blocks: [{ id: '2', bounds: lines[2].bounds, applied: true, matchedText: true, text: '晚饭吃鱼，怎么样？', dialogueId: 'd' }] };
  assert.equal(comicTextEdits(state, original)[2].text, '晚饭吃鱼，怎么样？');
  state.assignments[0] = 'd';
  assert.deepEqual(comicTextEdits(state, original).map((e) => e.text), [original[0].text, '', '']);
});

test('检测器的笔画内核很矮时仍以真实行高判断相邻，两行共享对白', () => {
  const rows = [{ ...line('先跟我回加吧', 112, 78), bounds: { x: 112, y: 78, width: 175, height: 25 },
    inkBounds: { x: 117, y: 82, width: 165, height: 16 } },
  { ...line('晚饭吃鱼，怎么样？', 108, 122), bounds: { x: 108, y: 122, width: 246, height: 25 },
    inkBounds: { x: 112, y: 127, width: 238, height: 15 } }];
  assert.deepEqual(comicTextEdits({ ocr: { lines: rows } }, original).map((e) => e.text), ['先跟我回家吧。', '晚饭吃鱼，怎么样？']);
  assert.equal(comicTextEdits({ ocr: { lines: [rows[1]] } }, original)[0].text, '晚饭吃鱼，怎么样？');
});
