/**
 * 将笔记里的角色卡数组或历史 JSON 数据解析为可编辑的数组；无效数据明确报错。
 * @param {unknown} value 数组、JSON 字符串或含 character_tabs / characterTabs 的对象。
 * @returns {object[]} 保留名称、提示词、坐标和其他已有属性的角色卡副本。
 */
export function normalizeNoteCharacters(value) {
  let characters = value;
  if (characters == null || characters === '') return [];
  if (typeof characters === 'string') {
    try {
      characters = JSON.parse(characters);
    } catch {
      throw Object.assign(new Error('Invalid character card JSON'), { code: 'NOTE_CHARACTER_JSON_INVALID' });
    }
  }
  if (characters && !Array.isArray(characters) && typeof characters === 'object') {
    if (Object.hasOwn(characters, 'character_tabs')) characters = characters.character_tabs;
    else if (Object.hasOwn(characters, 'characterTabs')) characters = characters.characterTabs;
    if (typeof characters === 'string') {
      try {
        characters = JSON.parse(characters);
      } catch {
        throw Object.assign(new Error('Invalid character card JSON'), { code: 'NOTE_CHARACTER_JSON_INVALID' });
      }
    }
  }
  if (!Array.isArray(characters)) {
    throw Object.assign(new Error('Character cards must be an array'), { code: 'NOTE_CHARACTER_JSON_ARRAY_REQUIRED' });
  }

  return characters.map((character) => {
    const invalidField = !character || Array.isArray(character) || typeof character !== 'object'
      || ['name', 'prompt', 'uc', 'position'].some((field) => (
        character[field] !== undefined && typeof character[field] !== 'string'
      ))
      || (character.position && !/^[A-E][1-5]$/.test(character.position))
      || (character.center !== undefined && (
        !character.center || typeof character.center !== 'object'
        || ['x', 'y'].some((axis) => !Number.isFinite(character.center[axis])
          || character.center[axis] < 0 || character.center[axis] > 1)
      ));
    if (invalidField) {
      throw Object.assign(new Error('Invalid character card fields'), { code: 'NOTE_CHARACTER_FIELDS_INVALID' });
    }
    return {
      ...character,
      prompt: character.prompt ?? '',
      uc: character.uc ?? '',
      position: character.position || 'C3',
      ...(character.center ? { center: { ...character.center } } : {}),
    };
  });
}
