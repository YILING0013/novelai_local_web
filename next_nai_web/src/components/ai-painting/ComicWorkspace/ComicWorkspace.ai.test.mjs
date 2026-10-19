import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { applyComicAIImage, comicAISectionFingerprint } from './comicAI.mjs';
import { createComicPage } from './comicDocument.mjs';
import { createComicElement } from './comicElements.mjs';
import { buildComicLetteringElements } from './comicLettering.mjs';

const source = readFileSync(new URL('./ComicWorkspace.js', import.meta.url), 'utf8');
const start = source.indexOf('  function getAIPage(pageId) {');
const end = source.indexOf('  async function savePage() {', start);
assert.ok(start >= 0 && end > start, '需要执行 Workspace 中的 AI 页面回调');
// 直接取实际回调，保存函数由测试控制完成时机，覆盖 await 前后的真实页面引用。
const implementation = source.slice(start, end);
const image = { dataUrl: 'data:image/png;base64,Z2VuZXJhdGVk', width: 832, height: 1216 };

/**
 * 提供页面引用、保存时机和状态记录，执行 Workspace 的真实 AI 回调。
 * @param {object} options 初始页面、当前草稿与可选的磁盘保存回调。
 * @returns {object} AI 回调、页面引用和可断言的保存及撤销记录。
 */
function workspaceScenario({ pages, current = pages[0], save = async (page) => ({ ...page, updatedAt: 100 }) }) {
  const pageRef = { current };
  const pagesRef = { current: [...pages] };
  const deletingPages = { current: new Set() };
  const writes = [], drafts = [], undo = [], replacements = [], selections = [], pageLists = [];
  const callbacks = runInNewContext(`${implementation}\n({ getAIPage, updateAIPage, applyAIResult })`, {
    pageRef, pagesRef, deletingPages, history: { current: { undo, redo: [] } },
    applyComicAIImage, comicAISectionFingerprint, buildComicLetteringElements,
    replacePage(next, record) {
      if (record) undo.push(pageRef.current);
      replacements.push({ next, record });
      pageRef.current = next;
    },
    setPages: (next) => pageLists.push(Array.from(next, (page) => page.id)),
    saveComicPage: async (next) => { writes.push(next); return save(next); },
    saveComicDraft: async (next) => { drafts.push(next); },
    choose: (...args) => selections.push(args),
  });
  return { ...callbacks, pageRef, pagesRef, deletingPages, writes, drafts, undo, replacements, selections, pageLists };
}

test('保存期间的新编辑不进入回填基线，后续文字结果不能覆盖该编辑', async () => {
  const page = createComicPage();
  let finishSave;
  const saving = new Promise((resolve) => { finishSave = resolve; });
  const scenario = workspaceScenario({ pages: [page], save: async (snapshot) => { await saving; return { ...snapshot, updatedAt: 100 }; } });
  const delivery = { pageId: page.id, sectionId: 0, image, originalImage: image, taskId: 'generation-1', expectedFingerprint: comicAISectionFingerprint(page, 0) };
  const pending = scenario.applyAIResult(delivery);
  assert.equal(scenario.writes.length, 1);
  const appliedFingerprint = comicAISectionFingerprint(scenario.pageRef.current, 0);
  const edited = { ...scenario.pageRef.current, elements: [createComicElement('text', { x: 60, y: 60, width: 150, height: 60 }, { text: '保存期间的新对白' })] };
  scenario.pageRef.current = edited;
  finishSave();

  const applied = await pending;
  assert.equal(applied.applied, true);
  assert.equal(applied.fingerprint, appliedFingerprint);
  assert.notEqual(applied.fingerprint, comicAISectionFingerprint(edited, 0));
  assert.equal(scenario.getAIPage(page.id), edited);
  assert.equal(scenario.drafts[0], edited, '草稿应保存等待期间的最新页面');
  assert.equal(scenario.undo.length, 1);
  assert.equal(scenario.undo[0], page);

  const lettering = await scenario.applyAIResult({ ...delivery, expectedFingerprint: applied.fingerprint,
    image: { ...image, dataUrl: 'data:image/png;base64,Y2xlYW5lZA==' }, result: { blocks: [] } });
  assert.equal(lettering.applied, false);
  assert.equal(lettering.fingerprint, null);
  assert.equal(scenario.pageRef.current, edited);
  assert.equal(scenario.writes.length, 1, '拒绝回填不应保存或新增撤销记录');
  assert.equal(scenario.undo.length, 1);
});

test('没有交错编辑时，原图与文字回填共用一次撤销并保留完整生成结果', async () => {
  const page = createComicPage();
  const scenario = workspaceScenario({ pages: [page] });
  const delivery = { pageId: page.id, sectionId: 0, image, originalImage: image, taskId: 'generation-1', expectedFingerprint: comicAISectionFingerprint(page, 0) };
  const original = await scenario.applyAIResult(delivery);
  const cleanedImage = { ...image, dataUrl: 'data:image/png;base64,Y2xlYW5lZA==' };
  const result = { blocks: [{ id: 'text-1', applied: true, bounds: { x: 50, y: 50, width: 120, height: 50 }, text: '可编辑对白', color: '#111111', direction: 'horizontal-tb', dialogueId: 'd1' }] };
  const cleaned = await scenario.applyAIResult({ ...delivery, image: cleanedImage, result, expectedFingerprint: original.fingerprint, record: false, undoToken: original.undoToken });

  assert.equal(cleaned.applied, true);
  assert.equal(original.undoToken, page);
  assert.equal(cleaned.undoToken, original.undoToken);
  assert.equal(scenario.undo.length, 1);
  assert.equal(scenario.undo[0], page, '撤销快照应直接回到生成前');
  assert.equal(scenario.pageRef.current.panels.find((panel) => panel.comicAIRole === 'image').image.dataUrl, cleanedImage.dataUrl);
  assert.equal(scenario.pageRef.current.elements[0].text, '可编辑对白');
});

test('原图保存期间插入标题编辑后，文字回填独立撤销且不混入旧撤销标识', async () => {
  const page = createComicPage();
  let finishSave, saves = 0;
  const saving = new Promise((resolve) => { finishSave = resolve; });
  const scenario = workspaceScenario({ pages: [page], save: async (snapshot) => {
    if (++saves === 1) await saving;
    return { ...snapshot, updatedAt: 100 };
  } });
  const delivery = { pageId: page.id, sectionId: 0, image, originalImage: image, taskId: 'generation-1', expectedFingerprint: comicAISectionFingerprint(page, 0) };
  const pending = scenario.applyAIResult(delivery);
  const rawPage = scenario.pageRef.current;
  await scenario.updateAIPage(page.id, (current) => ({ ...current, title: '用户新标题' }), { record: true });
  const editedPage = scenario.pageRef.current;
  finishSave();
  const original = await pending;
  assert.equal(original.undoToken, page, '原图撤销标识在等待保存之前固定');
  const cleaned = await scenario.applyAIResult({ ...delivery, image: { ...image, dataUrl: 'data:image/png;base64,Y2xlYW5lZA==' }, result: { blocks: [] },
    expectedFingerprint: original.fingerprint, record: false, undoToken: original.undoToken });

  assert.equal(cleaned.applied, true);
  assert.equal(scenario.pageRef.current.title, '用户新标题');
  assert.equal(scenario.undo.length, 3);
  assert.equal(scenario.undo.pop(), editedPage, '先撤销文字回填，保留用户的新标题');
  assert.equal(scenario.undo.pop(), rawPage, '再撤销标题，保留已生成原图');
  assert.equal(scenario.undo.pop(), page, '最后撤销原图，才回到原页面');
});

test('后台页保留待应用原图，自动回填和强制回填都不改画布或当前撤销栈', async () => {
  const origin = createComicPage();
  const current = createComicPage();
  const scenario = workspaceScenario({ pages: [origin, current], current });
  const fingerprint = comicAISectionFingerprint(origin, 0);
  await scenario.updateAIPage(origin.id, (page) => ({ ...page, aiWorkflow: { sections: {
    0: { status: 'pending', pending: true, originalImage: image },
  } } }));
  const retained = scenario.getAIPage(origin.id);

  for (const force of [false, true]) {
    const result = await scenario.applyAIResult({ pageId: origin.id, sectionId: 0, image, taskId: 'generation-1', expectedFingerprint: fingerprint, force });
    assert.equal(result.applied, false);
    assert.equal(result.fingerprint, null);
  }
  assert.equal(scenario.getAIPage(origin.id), retained);
  assert.equal(comicAISectionFingerprint(retained, 0), fingerprint);
  assert.equal(retained.aiWorkflow.sections[0].status, 'pending');
  assert.equal(retained.aiWorkflow.sections[0].pending, true);
  assert.equal(retained.aiWorkflow.sections[0].originalImage, image);
  assert.equal(scenario.pageRef.current, current);
  assert.equal(scenario.writes.length, 1);
  assert.equal(scenario.drafts.length, 0);
  assert.equal(scenario.undo.length, 0);
  assert.equal(scenario.selections.length, 0);
});

test('更新页面原位保留页面库顺序，当前页始终使用最新草稿', async () => {
  const pages = [10, 20, 30].map((order) => ({ ...createComicPage(), order }));
  const current = { ...pages[0], title: '尚未保存的标题' };
  const scenario = workspaceScenario({ pages, current });
  assert.equal(scenario.getAIPage(current.id), current);
  assert.equal(scenario.getAIPage(pages[1].id), pages[1]);

  for (const pageId of [pages[1].id, pages[0].id, pages[1].id]) {
    await scenario.updateAIPage(pageId, (page) => ({ ...page, aiWorkflow: { version: 1 } }));
  }
  const ids = pages.map((page) => page.id);
  assert.ok(scenario.pageLists.every((list) => JSON.stringify(list) === JSON.stringify(ids)), '保存前后都不把更新页移到队尾');
  assert.deepEqual(Array.from(scenario.pagesRef.current, (page) => page.order), [10, 20, 30]);
  assert.equal(scenario.getAIPage(current.id).title, '尚未保存的标题');
  assert.equal(scenario.pagesRef.current[2], pages[2]);
  assert.equal(scenario.replacements.length, 1);
  assert.equal(scenario.replacements[0].record, false, '只更新工作流状态不增加撤销记录');
  assert.equal(scenario.undo.length, 0);
});

test('删除标记立即阻止当前页和后台页的读取、保存与强制回填', async () => {
  const pages = [createComicPage(), createComicPage()];
  const scenario = workspaceScenario({ pages });
  let updates = 0;
  for (const page of pages) {
    scenario.deletingPages.current.add(page.id);
    assert.equal(scenario.getAIPage(page.id), null);
    assert.equal(await scenario.updateAIPage(page.id, () => { updates += 1; return { ...page, title: '不应保存' }; }), null);
    const result = await scenario.applyAIResult({ pageId: page.id, sectionId: 0, image, force: true });
    assert.equal(result.applied, false);
    assert.equal(result.fingerprint, null);
  }
  assert.equal(updates, 0);
  assert.equal(scenario.writes.length, 0);
  assert.equal(scenario.replacements.length, 0);
  assert.equal(scenario.pageLists.length, 0);
  assert.equal(scenario.pageRef.current, pages[0]);
  assert.deepEqual(scenario.pagesRef.current, pages);
});

test('先前保存完成时不重新加入已删除页，也不覆盖切换后的草稿', async () => {
  const origin = createComicPage();
  const next = createComicPage();
  let finishSave;
  const saving = new Promise((resolve) => { finishSave = resolve; });
  const scenario = workspaceScenario({ pages: [origin, next], save: async (snapshot) => { await saving; return { ...snapshot, updatedAt: 100 }; } });
  const pending = scenario.updateAIPage(origin.id, (page) => ({ ...page, aiWorkflow: { version: 1 } }));
  assert.equal(scenario.writes.length, 1);
  scenario.deletingPages.current.add(origin.id);
  scenario.pagesRef.current = [next];
  scenario.pageRef.current = next;
  finishSave();

  assert.equal(await pending, null);
  assert.deepEqual(Array.from(scenario.pagesRef.current, (page) => page.id), [next.id]);
  assert.equal(scenario.pageRef.current, next);
  assert.equal(scenario.getAIPage(origin.id), null);
  assert.equal(scenario.drafts.length, 0);
  assert.equal(scenario.writes.length, 1);
});
