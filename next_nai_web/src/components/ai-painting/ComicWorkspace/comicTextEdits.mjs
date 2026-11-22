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
export function comicTextEdits(state, dialogues) {
  return comicTextLines(state).map((line, index) => {
    const id = line.id ?? String(index);
    const previous = state.result?.blocks.find((block) => block.id === id && sameComicTextBounds(block.bounds, line.bounds))
      ?? state.result?.blocks.find((block) => sameComicTextBounds(block.bounds, line.bounds));
    const saved = Object.hasOwn(state.assignments ?? {}, id) ? state.assignments[id]
      : Object.hasOwn(state.assignments ?? {}, index) ? state.assignments[index]
      : previous?.applied ? previous.dialogueId || (previous.text
        ? { action: 'replace', text: previous.text, direction: previous.direction } : { action: 'erase' }) : null;
    const dialogue = dialogues.find((item) => item.id === saved && item.text.trim());
    const choice = typeof saved === 'string' && !dialogue ? null : saved;
    const text = dialogue?.text.trim() ?? (choice?.action === 'replace' ? choice.text.trim() : '');
    const direction = dialogue ? (dialogue.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb') : choice?.direction ?? line.direction;
    return { id, line, choice, text, direction, dialogueId: dialogue?.id ?? null, previous };
  });
}
