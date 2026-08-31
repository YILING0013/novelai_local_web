export const NOTE_TITLE_REQUIRED_ERROR = 'NOTE_TITLE_REQUIRED';
export const NOTE_TITLE_COLON_ERROR = 'NOTE_TITLE_FORBIDDEN_COLON';
export const NOTE_IMPORT_ROOT_ERROR = 'NOTE_IMPORT_ROOT_ARRAY_REQUIRED';
export const NOTE_IMPORT_ITEM_ERROR = 'NOTE_IMPORT_ITEM_INVALID';

const FORBIDDEN_NOTE_TITLE_PATTERN = /[:：]/u;

/**
 * 校验单个笔记标题。
 *
 * Args:
 *   title: 待校验的笔记标题。
 *
 * Returns:
 *   string: 校验失败时返回稳定客户端错误码，合法时返回空字符串。
 */
export function getNoteTitleError(title) {
  if (typeof title !== 'string' || !title.trim()) {
    return NOTE_TITLE_REQUIRED_ERROR;
  }
  if (FORBIDDEN_NOTE_TITLE_PATTERN.test(title)) {
    return NOTE_TITLE_COLON_ERROR;
  }
  return '';
}

/**
 * 校验导入文件中的全部笔记标题。
 *
 * Args:
 *   notes: 从导入文件解析出的笔记数组。
 *
 * Returns:
 *   object|null: 校验失败时返回稳定错误码及插值参数，全部合法时返回 null。
 */
export function getImportedNotesError(notes) {
  if (!Array.isArray(notes)) {
    return { code: NOTE_IMPORT_ROOT_ERROR, params: {} };
  }

  for (const [index, note] of notes.entries()) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
      return { code: NOTE_IMPORT_ITEM_ERROR, params: { index: index + 1 } };
    }
    const titleError = getNoteTitleError(note.title);
    if (titleError) {
      return { code: titleError, params: { index: index + 1 } };
    }
  }

  return null;
}

/**
 * 将笔记校验结果转换为可由 UI 本地化的稳定异常。
 *
 * Args:
 *   validationError: 字符串错误码或 `{code, params}` 校验结果。
 *
 * Returns:
 *   Error: message/code 为稳定错误码，并保留命名插值 params。
 */
export function createNoteValidationError(validationError) {
  const descriptor = typeof validationError === 'string'
    ? { code: validationError, params: {} }
    : validationError;
  const code = descriptor?.code || NOTE_IMPORT_ITEM_ERROR;
  const error = new Error(code);
  error.code = code;
  error.params = descriptor?.params || {};
  return error;
}
