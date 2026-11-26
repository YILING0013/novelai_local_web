import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import assets from './promptSearchAssets.json' with { type: 'json' };
import { DEFAULT_PROMPT_SYNTAX, openPromptCatalog } from './promptCatalog.mjs';

let search;
before(async () => {
  const base = new URL('../../../../public/tag-search/', import.meta.url);
  const runtime = await import(new URL(assets.glueFile, base));
  runtime.initSync({ module: await readFile(new URL(assets.wasmFile, base)) });
  search = openPromptCatalog(gunzipSync(await readFile(new URL(assets.catalogFile, base))), runtime.TagCatalog);
});

test('实际词库中的原神角色支持英文、中文、全拼与首字母并保持类别约束', () => {
  for (const term of ['fu', '芙宁娜', 'funingna', 'fnn']) {
    assert.equal(search('+原神=' + term, 8)[0].name, 'furina_(genshin_impact)');
  }
  assert.equal(search('+yuanshen', 1)[0].completion, '+原神=');
  assert.deepEqual(search('+原神+=fu', 8), search('+作品 / IP+原神=fu', 8));
  assert.deepEqual(search('+服装+原神=fu', 8), []);
  assert.equal(search('long hair', 1)[0].name, 'long_hair');
});

test('类别候选可以继续浏览子类，并只匹配该类别中的标签', () => {
  const clothing = search('+', 40).find(row => row.name === '服装');
  assert.equal(clothing.completion, '+服装+');
  const tops = search(clothing.completion, 40).find(row => row.name === '上装');
  assert.equal(tops.completion, '+服装+上装=');
  assert.equal(search(tops.completion, 1)[0].name, 'shirt');
});

test('模糊匹配按相似度和引用量排列，错误正则不影响后续查询', () => {
  assert.equal(search('?long hair', 6)[0].name, 'long_hair');
  assert.equal(search('?furian', 6)[0].name, 'furina_(genshin_impact)');
  assert.throws(() => search('=*[broken', 5), error => String(error) === 'invalid_regex');
  assert.deepEqual(search('+原神=*^furina_\\(genshin_impact\\)$', 5).map(t => t.name), ['furina_(genshin_impact)']);
});

test('自定义字符、关闭语法和未识别的分类都按设置处理', () => {
  const syntax = { enabled: true, category: '#', exact: '@', fuzzy: '~', regex: '!' };
  assert.equal(search('#服装#', 40, syntax).find(row => row.name === '上装').completion, '#服装#上装@');
  assert.equal(search('#原神@!^furina_', 1, syntax)[0].name, 'furina_(genshin_impact)');
  assert.equal(search('~furian', 1, syntax)[0].name, 'furina_(genshin_impact)');
  assert.deepEqual(search('+does-not-exist=fu', 5), []);
  const disabled = { ...DEFAULT_PROMPT_SYNTAX, enabled: false };
  assert.deepEqual(search('+原神=fu', 5, disabled), []);
  assert.equal(search('funingna', 1, disabled)[0].translation, '芙宁娜（原神）');
});
