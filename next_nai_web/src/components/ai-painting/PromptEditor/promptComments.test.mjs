import assert from 'node:assert/strict';
import test from 'node:test';
import { commentText, extractActiveContent, uncommentText } from './promptUtils.js';

test('注释中的随机标签不抽取，随机词条中的注释也不会用于生成', () => {
  const storage = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  try {
    const options = { processRandomPrompts: true, randomPromptConfig: { categories: [
      { id: 'active', name: 'active', items: ['blue hair /* red hair */', 'green hair'], extractMode: 'sequential' },
      { id: 'hidden', name: 'hidden', items: ['hidden'], extractMode: 'sequential' },
    ] } };
    const prompt = '/* outer /* inner */ <ran_id="hidden"/> */ <ran_id="active"/>';
    assert.equal(extractActiveContent(prompt, options), 'blue hair');
    assert.equal(storage.get('category_item_position_active'), '1', '一次生成只抽取一次');
    assert.equal(storage.has('category_item_position_hidden'), false);
    assert.equal(extractActiveContent(prompt, options), 'green hair');
    assert.equal(extractActiveContent('garden /* multi\nline */'), 'garden');
    assert.equal(extractActiveContent('/* first */ garden /* second\nline */'), 'garden');
    assert.equal(extractActiveContent('// literal\n# literal\n/* incomplete'), '// literal\n# literal\n/* incomplete');
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('再次注释包含旧注释的选区时关闭整块，取消时恢复先前的注释', () => {
  const original = '/* old tag */, still active, keep';
  const commented = commentText(original, 0, original.indexOf(', keep'));
  assert.equal(extractActiveContent(commented.text), ', keep');
  assert.deepEqual(commentText(commented.text, commented.start, commented.end), commented);
  assert.equal(uncommentText(commented.text, commented.start, commented.end).text, original);
});

test('选区跨过已有注释的末尾时保留整块，取消注释可处理多个独立块', () => {
  const original = '/* old, tag */, new tag, keep';
  const commented = commentText(original, original.indexOf('tag'), original.indexOf(', keep'));
  assert.equal(extractActiveContent(commented.text), ', keep');
  assert.equal(uncommentText(commented.text, commented.start, commented.end).text, original);

  const separate = '/* old */, keep, /* new */';
  const restored = ' old , keep,  new ';
  assert.deepEqual(uncommentText(separate, 0, separate.length), { text: restored, start: 0, end: restored.length });
});
