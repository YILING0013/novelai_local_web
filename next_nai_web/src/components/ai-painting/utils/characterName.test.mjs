import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARACTER_NAME_MAX_LENGTH,
  normalizeCharacterName,
  resolveCharacterName,
} from './characterName.mjs';

test('character names are limited to 16 characters', () => {
  const name = '1234567890abcdefghijklmnop';

  assert.equal(CHARACTER_NAME_MAX_LENGTH, 16);
  assert.equal(normalizeCharacterName(name), '1234567890abcdef');
});

test('cached names stay visible while empty legacy values use the indexed fallback', () => {
  assert.equal(resolveCharacterName('自定义角色', '角色 1'), '自定义角色');
  assert.equal(resolveCharacterName('', '角色 1'), '角色 1');
  assert.equal(resolveCharacterName('   ', '角色 1'), '角色 1');
  assert.equal(resolveCharacterName(undefined, '角色 1'), '角色 1');
});
