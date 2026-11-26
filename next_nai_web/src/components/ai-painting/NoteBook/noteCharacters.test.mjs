import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateRaw } from 'pako';
import { normalizeNoteCharacters } from './noteCharacters.mjs';
import { getNoteContentLength, getNoteTokenCount, NOTE_TOKEN_LIMIT } from './noteLimits.mjs';
import { NovelAIQwenTokenizer } from '../PromptEditor/novelAIImageTokenizer.mjs';

test('历史 JSON 角色卡可恢复、编辑和再次保存，保留名称、负向提示词、位置及其他属性', () => {
  const original = [{ name: '旅人', prompt: '1girl, silver hair', uc: 'hat', position: 'B3', center: { x: 0.27, y: 0.53 }, colorId: 4, isTemporarilyDisabled: true, custom: { version: 1 } }];
  for (const stored of [original, JSON.stringify(original), { character_tabs: original }, { characterTabs: JSON.stringify(original) }, JSON.stringify({ character_tabs: original })]) {
    const editable = normalizeNoteCharacters(stored);
    assert.deepEqual(editable, original);
    editable[0].prompt = '1girl, blue hair';
    editable[0].center.x = 0.42;
    const reopened = normalizeNoteCharacters(JSON.stringify(editable));
    assert.equal(reopened[0].prompt, '1girl, blue hair');
    assert.equal(reopened[0].uc, 'hat');
    assert.equal(reopened[0].name, '旅人');
    assert.equal(reopened[0].position, 'B3');
    assert.deepEqual(reopened[0].center, { x: 0.42, y: 0.53 });
    assert.equal(reopened[0].isTemporarilyDisabled, true);
    assert.deepEqual(reopened[0].custom, { version: 1 });
  }
  assert.equal(original[0].prompt, '1girl, silver hair');
  assert.equal(original[0].center.x, 0.27);
});

test('损坏 JSON 与错误字段阻止保存，不能被转换为空角色卡', () => {
  for (const invalid of ['[{"prompt":', { unknown: [] }, [null], [{ prompt: 7 }], [{ uc: {} }], [{ position: 'F6' }], [{ center: { x: 2, y: 0.5 } }]]) {
    assert.throws(() => normalizeNoteCharacters(invalid), (error) => error.code.startsWith('NOTE_CHARACTER_'));
  }
  assert.deepEqual(normalizeNoteCharacters(null), []);
  assert.deepEqual(normalizeNoteCharacters([{ prompt: 'portrait' }]), [{ prompt: 'portrait', uc: '', position: 'C3' }]);
  assert.equal(normalizeNoteCharacters([{ prompt: 'portrait', position: '' }])[0].position, 'C3');
});

test('V5 笔记来回编辑保留真实坐标，旧网格可重新指定 V5，边缘位置可回填到 V4', () => {
  for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-full-medium', 'nai-diffusion-5-curated']) {
    const tabs = [{ prompt: 'blue eyes', uc: 'hat', position: 'C3', center: { x: 0.047, y: 1 } }, { position: 'D2' }];
    const saved = normalizeNoteCharacters(tabs, model);
    assert.deepEqual(saved[0], { prompt: 'blue eyes', uc: 'hat', position: 'A5', center: { x: 0.047, y: 1 } });
    assert.deepEqual(saved[1].center, { x: 0.7, y: 0.3 });
    assert.deepEqual(normalizeNoteCharacters(JSON.stringify(saved), model), saved);
    assert.equal(tabs[0].position, 'C3');
    assert.equal(normalizeNoteCharacters(tabs, 'nai-diffusion-4-5-full')[0].position, 'C3');
  }
});

test('字符数独立展示，包含正文和角色正负词且Unicode字符只计一次', () => {
  const characters = [{ name: '不计入名称', prompt: '星🌙', uc: 'rain', position: 'C3' }];
  assert.equal(getNoteContentLength('夜', '☁', characters), 8);
});

test('笔记使用真实Qwen分词器显示2942 token提示阈值，英文中文及停用角色均准确计入', () => {
  const definition = JSON.parse(new TextDecoder().decode(inflateRaw(
    readFileSync(new URL('../../../../public/qwen35_tokenizer.def', import.meta.url)),
  )));
  const tokenizer = new NovelAIQwenTokenizer(definition.vocab, definition.merges, definition.specialTokens, definition.config);
  assert.equal(NOTE_TOKEN_LIMIT, 2942);
  assert.equal(getNoteTokenCount(tokenizer, '1girl, masterpiece, no text', '女孩，杰作，无文字', [
    { prompt: 'girl, ', uc: '女孩，杰作，无文字', isTemporarilyDisabled: true },
  ]), 22);

  const longEnglish = 'cat '.repeat(1000);
  assert.ok(getNoteContentLength(longEnglish) > NOTE_TOKEN_LIMIT);
  assert.ok(getNoteTokenCount(tokenizer, longEnglish) < NOTE_TOKEN_LIMIT);
  assert.ok(getNoteTokenCount(tokenizer, '女孩，杰作，无文字'.repeat(500)) > NOTE_TOKEN_LIMIT);
});
