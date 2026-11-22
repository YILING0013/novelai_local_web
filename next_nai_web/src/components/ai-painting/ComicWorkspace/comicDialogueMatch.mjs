const letters = (text) => Array.from(text.normalize('NFKC').toLowerCase()).filter((c) => /[\p{L}\p{N}\p{M}]/u.test(c));

// 在字符序列上对齐，回溯每条 OCR 行在原对白中的结束位置。标点和空格保留在原文里。
function align(lines, script) {
  const source = lines.flat();
  const target = script.chars;
  const longest = Math.max(source.length, target.length);
  if (!longest || Math.min(source.length, target.length) < longest * 0.64) return null;
  if (source.reduce((n, character) => n + Number(script.alphabet.has(character)), 0) < longest * 0.64) return null;
  const stride = target.length + 1;
  const cells = new Uint32Array((source.length + 1) * stride);
  for (let j = 0; j < stride; j++) cells[j] = j;
  for (let i = 1; i <= source.length; i++) {
    const row = i * stride;
    cells[row] = i;
    for (let j = 1; j < stride; j++) {
      cells[row + j] = Math.min(cells[row - stride + j - 1] + Number(source[i - 1] !== target[j - 1]),
        cells[row - stride + j] + 1, cells[row + j - 1] + 1);
    }
  }
  const distance = cells.at(-1);
  const score = 1 - distance / longest;
  if (score < (longest <= 3 ? 1 : longest <= 5 ? 0.75 : 0.64)) return null;
  let i = source.length, j = target.length;
  const pieces = [];
  for (let k = lines.length - 1; k >= 0; k--) {
    const end = j;
    const start = i - lines[k].length;
    let equal = 0;
    while (i > start) {
      const at = i * stride + j;
      const same = source[i - 1] === target[j - 1];
      if (j && cells[at] === cells[at - stride - 1] + Number(!same)) {
        if (same) equal++;
        i--; j--;
      } else if (cells[at] === cells[at - stride] + 1) i--;
      else j--;
    }
    if (k === 0) j = 0;
    // 不能让长行的好分数把旁边一行无关的短字也带进来。
    if (!equal || equal < Math.max(end - j, lines[k].length) * 0.5) return null;
    pieces.unshift(script.text.slice(script.offsets[j], script.offsets[end]).trim());
  }
  return { score, pieces };
}

function scriptPart(id, text, start = 0) {
  const chars = [], offsets = [];
  let offset = 0;
  for (const character of text) {
    for (const normalized of letters(character)) {
      offsets.push(chars.length ? offset : 0);
      chars.push(normalized);
    }
    offset += character.length;
  }
  offsets.push(offset);
  return { id, text, start, end: start + text.length, chars, offsets, alphabet: new Set(chars) };
}

// 横排往下找、竖排往左找。用笔画高度和重叠量判断是否相邻，允许 OCR 顺序中穿插另一格。
function nextLine(lines, index) {
  const line = lines[index];
  const box = line.inkBounds || line.bounds;
  const vertical = line.direction === 'vertical-rl';
  let nearest = -1, best = Infinity;
  for (const [i, other] of lines.entries()) {
    if (other.direction !== line.direction || i === index) continue;
    const b = other.inkBounds || other.bounds;
    // 检测热图的笔画内核会比字号矮近一半，行距必须用含留边的 OCR 框衡量。
    const size = vertical ? line.bounds.width : line.bounds.height, otherSize = vertical ? other.bounds.width : other.bounds.height;
    const unit = Math.max(size, otherSize);
    if (Math.min(size, otherSize) < unit * 0.5) continue;
    const advance = vertical ? box.x + box.width / 2 - b.x - b.width / 2 : b.y + b.height / 2 - box.y - box.height / 2;
    if (advance < unit * 0.45 || advance > unit * 2.5) continue;
    const a0 = vertical ? box.y : box.x, b0 = vertical ? b.y : b.x;
    const aLen = vertical ? box.height : box.width, bLen = vertical ? b.height : b.width;
    if (Math.min(a0 + aLen, b0 + bLen) - Math.max(a0, b0) < Math.min(aLen, bLen) * 0.5) continue;
    const gap = advance + Math.min(Math.abs(a0 - b0), Math.abs(a0 + aLen / 2 - b0 - bLen / 2)) * 0.3;
    if (gap < best) { nearest = i; best = gap; }
  }
  return nearest;
}

/**
 * 为每个 OCR 框推荐整句或原稿中的一段。对不上或多个候选相近时留给用户核对。
 * @param {Array<object>} lines 实际识别框、方向和 OCR 文本。
 * @param {Array<object>} dialogues 当前分区的 AI 对白。
 * @returns {Array<object|null>} 按 OCR 框顺序排列的对白 ID 与带原标点的文本。
 */
export function matchComicDialogueLines(lines, dialogues) {
  const results = Array(lines.length).fill(null);
  if (!lines.length || !dialogues.length) return results;
  const words = lines.map((line) => letters(line.text || ''));
  const next = lines.map((_, i) => nextLine(lines, i));
  const scripts = dialogues.map(({ id, text }) => scriptPart(id, text.trim()));
  const maxLength = Math.max(...words.map((row) => row.length)) / 0.75;
  const partsByScript = scripts.map((script) => {
    const parts = script.text.match(/[^，,。！？!?；;、\n]+[，,。！？!?；;、\n]*/gu) || [];
    const phrases = [];
    let offset = script.text.indexOf(parts[0] || '');
    for (let start = 0; start < parts.length; start++) {
      let text = '';
      for (let end = start; end < parts.length; end++) {
        text += parts[end];
        if (start === 0 && end === parts.length - 1) continue;
        const part = scriptPart(script.id, text, offset);
        if (part.chars.length > maxLength) break;
        if (part.chars.length >= 4) phrases.push(part);
      }
      offset += parts[start].length;
    }
    return phrases;
  });
  const candidates = [];
  for (let start = 0; start < lines.length; start++) {
    const indices = [], rows = [];
    for (let i = start; i !== -1 && words[i].length && indices.length < 8; i = next[i]) {
      indices.push(i);
      rows.push(words[i]);
      for (const part of scripts) {
        const match = align(rows, part);
        if (match) candidates.push({ ...match, part, indices: [...indices] });
      }
    }
  }
  // 只有一行被识别时，优先使用更精确的原稿分句，避免把未出现的后半句也嵌进来。
  const clauses = [];
  for (const part of partsByScript.flat()) {
    for (let i = 0; i < lines.length; i++) {
      const match = align([words[i]], part);
      if (match && match.score >= 0.75) clauses.push({ ...match, part, indices: [i] });
    }
  }
  const proposals = [...candidates, ...clauses];
  const byLine = lines.map(() => []);
  const byDialogue = new Map(scripts.map(({ id }) => [id, []]));
  for (const proposal of proposals) {
    for (const i of proposal.indices) byLine[i].push(proposal);
    byDialogue.get(proposal.part.id).push(proposal);
  }
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  const accepted = [];
  for (const c of proposals) {
    const sameDialogue = byDialogue.get(c.part.id).filter((other) => overlaps(c.part, other.part));
    const rivals = new Set([...sameDialogue, ...c.indices.flatMap((i) => byLine[i])]);
    const ambiguous = Array.from(rivals).some((other) => {
      if (other === c || other.score <= c.score - 0.085) return false;
      if (other.part.id !== c.part.id) return true;
      const shared = other.indices.filter((i) => c.indices.includes(i));
      if (!shared.length) return true; // 不把原稿中的同一段文字分给两个气泡。
      // 整句和分句可以互相印证。边界不同则优先选字符对齐更准确的方案。
      if (shared.every((i) => c.pieces[c.indices.indexOf(i)] === other.pieces[other.indices.indexOf(i)])) return false;
      return other.score >= c.score;
    });
    if (!ambiguous) accepted.push(c);
  }
  // 整组建议和其中的一行都成立时，一次采用整组，保持各段前后相接。
  accepted.sort((a, b) => b.indices.length - a.indices.length || b.score - a.score);
  const assigned = new Map();
  for (const c of accepted) {
    const spans = assigned.get(c.part.id) || [];
    if (c.indices.some((i) => results[i]) || spans.some((part) => overlaps(part, c.part))) continue;
    spans.push(c.part);
    assigned.set(c.part.id, spans);
    c.indices.forEach((i, k) => { results[i] = { dialogueId: c.part.id, text: c.pieces[k] }; });
  }
  return results;
}
