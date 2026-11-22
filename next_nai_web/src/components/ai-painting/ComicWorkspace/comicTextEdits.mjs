import { matchComicDialogueLines } from './comicDialogueMatch.mjs';

/** 判断重新识别后是否仍为同一个原图文字框。 */
export function sameComicTextBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** 读取已存识别框。旧项目可能把识别信息和改字结果存在同一组文字块里。 */
export function comicTextLines(state) {
  return state.ocr?.lines ?? state.result?.blocks.map(({ id, ocrText, bounds, direction, confidence }) => ({
    id, text: ocrText, bounds, direction, confidence,
  })) ?? [];
}

/** 将保留原文、编排对白、手填文字和抹除的选择转换为清理原图所需的数据。 */
export function comicTextEdits(state, dialogues, matches) {
  const lines = comicTextLines(state);
  const suggestions = matches ?? matchComicDialogueLines(lines, dialogues);
  const assignments = state.assignments ?? {};
  const edits = lines.map((line, index) => {
    const id = line.id ?? String(index);
    const previous = state.result?.blocks.find((block) => sameComicTextBounds(block.bounds, line.bounds) && block.id === id)
      ?? state.result?.blocks.find((block) => sameComicTextBounds(block.bounds, line.bounds));
    const saved = Object.hasOwn(assignments, id) ? assignments[id]
      : Object.hasOwn(assignments, index) ? assignments[index] : undefined;
    // 已应用的分行结果仍使用这一段，避免重开项目时每个框又变成整句。
    const selected = saved !== undefined ? saved : !previous?.applied ? undefined
      : previous.matchedText ? { action: 'match', dialogueId: previous.dialogueId, text: previous.text }
      : previous.dialogueId || (previous.text ? { action: 'replace', text: previous.text, direction: previous.direction } : { action: 'erase' });
    return { id, line, selected, previous, suggestion: suggestions[index] };
  });
  const reserved = new Set(edits.map(({ selected }) => selected).filter((value) => typeof value === 'string'));
  return edits.map(({ selected, suggestion, ...edit }) => {
    if (suggestion && reserved.has(suggestion.dialogueId)) suggestion = null;
    let choice = selected;
    if (selected === undefined || selected?.action === 'auto') choice = suggestion ? { action: 'match', ...suggestion } : null;
    if (choice?.action === 'match' && reserved.has(choice.dialogueId)) choice = null;
    const dialogue = dialogues.find((item) => item.id === (choice?.dialogueId ?? choice) && item.text.trim());
    if ((typeof choice === 'string' || choice?.action === 'match') && !dialogue) choice = null;
    const text = choice?.action === 'match' ? choice.text : dialogue?.text.trim() ?? (choice?.action === 'replace' ? choice.text.trim() : '');
    const direction = dialogue ? (dialogue.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb') : choice?.direction ?? edit.line.direction;
    return { ...edit, choice, suggestion, selected, text, direction, dialogueId: dialogue?.id ?? null };
  });
}
