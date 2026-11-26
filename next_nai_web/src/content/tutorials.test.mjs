import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findGuideStep, RESTRICTED_GUIDES, TUTORIAL_CATALOG, TUTORIAL_TOPICS, WORKSPACE_GUIDES } from './tutorials.mjs';
import { DRAWING_LESSONS, getDrawingLesson } from './tutorials/drawing.mjs';
import coreZhCN from '../i18n/locales/core.zh-CN.js';
import coreEnUS from '../i18n/locales/core.en-US.js';

// 中英文教程必须逐项对应：同样的章节、步骤、表格行列，且没有空文案。
function assertSameShape(zh, en, path) {
  if (typeof zh === 'string') {
    assert.equal(typeof en, 'string', path);
    assert.ok(zh.trim() && en.trim(), `${path} 不能为空`);
    return;
  }
  assert.equal(Array.isArray(zh), Array.isArray(en), path);
  const keys = Object.keys(zh);
  assert.deepEqual(Object.keys(en), keys, path);
  for (const key of keys) assertSameShape(zh[key], en[key], `${path}.${key}`);
}

test('教程目录的页面、模块和篇目都有中英文名称', () => {
  for (const locale of [coreZhCN, coreEnUS]) {
    for (const page of TUTORIAL_CATALOG) {
      assert.ok(locale.tutorials.nav[page.id]);
      for (const group of page.modules) assert.ok(locale.tutorials.nav[group.id]);
    }
    for (const topic of TUTORIAL_TOPICS) {
      assert.ok(locale.tutorials.topics[topic.id]);
      assert.ok(locale.tutorials.guides[topic.guide], `${topic.guide} 缺少引导名称`);
    }
  }
  assert.equal(new Set(TUTORIAL_TOPICS.map((topic) => topic.id)).size, TUTORIAL_TOPICS.length, '篇目编号不能重复');
});

test('每篇教程的中英文内容结构一致，演示说明和章节齐全', async () => {
  for (const topic of TUTORIAL_TOPICS) {
    if (DRAWING_LESSONS[topic.id]) {
      const lesson = DRAWING_LESSONS[topic.id];
      assertSameShape(lesson['zh-CN'], lesson['en-US'], topic.id);
      assert.equal(lesson.actions.length, lesson['zh-CN'].demo.length);
      continue;
    }
    const { default: content } = await import(`./tutorials/${topic.id}.mjs`);
    assertSameShape(content['zh-CN'], content['en-US'], topic.id);
    const copy = content['zh-CN'];
    assert.ok(copy.lead && copy.tryIt && copy.guide, `${topic.id} 缺少导语、示例或引导说明`);
    assert.ok(copy.demo.length >= 3, `${topic.id} 演示至少分三步`);
    assert.ok(copy.sections.length >= 1, `${topic.id} 至少有一个说明章节`);
    for (const section of copy.sections) {
      for (const block of section.blocks.filter((item) => item.table)) {
        const columns = block.head?.length ?? block.table[0].length;
        for (const row of block.table) assert.equal(row.length, columns, `${topic.id}「${section.title}」表格列数不一致`);
      }
    }
  }
});

// 按页面上依次出现的控件模拟一条引导，返回每一步显示的说明。
// next 表示点「下一步」，画面不变；click 表示点击高亮控件，随后由 show 给出点击后的画面。
function simulate(name) {
  const { steps } = WORKSPACE_GUIDES[name];
  const seen = new Set();
  let progress = 0;
  let index = -1;
  let scene = [[], []];
  const show = (visible, covered = []) => {
    scene = [visible, covered];
    for (;;) {
      const result = findGuideStep(steps, progress, new Set(visible), new Set([...visible, ...covered]), seen);
      if (result.done >= steps.length) return 'finished';
      if (result.done !== progress) { progress = result.done; continue; }
      index = result.index;
      return index >= 0 ? steps[index].id : result.hidden ? 'hidden' : 'waiting';
    }
  };
  return {
    show,
    next: () => { progress = index + 1; return show(...scene); },
    click: () => { progress = index + 1; },
  };
}

test('提示词联想引导跟随设置窗口推进，下拉菜单遮住时暂时隐藏，关闭窗口后进入练习', () => {
  const guide = simulate('suggestions');
  assert.equal(guide.show(['gear']), 'gear');
  assert.equal(guide.show(['configure'], ['gear']), 'configure');
  const dialog = ['enableSuggestions', 'appearance', 'syntax', 'closeSettings'];
  assert.equal(guide.show(dialog, ['gear']), 'enableSuggestions');
  assert.equal(guide.next(), 'appearance');
  assert.equal(guide.show([], [...dialog, 'gear']), 'hidden');
  assert.equal(guide.show(dialog, ['gear']), 'appearance');
  assert.equal(guide.show(['gear']), 'finished', '取消设置窗口也直接进入练习');
});

test('笔记本引导必须看过角色卡才结束，提前关闭笔记本会回到入口', () => {
  const guide = simulate('notebook');
  assert.equal(guide.show(['notebook']), 'notebook');
  assert.equal(guide.show(['note', 'closeNotebook'], ['notebook']), 'note');
  assert.equal(guide.show(['notebook']), 'notebook');
  assert.equal(guide.show(['note', 'closeNotebook'], ['notebook']), 'note');
  assert.equal(guide.show(['characters', 'closePreview'], ['note', 'closeNotebook', 'notebook']), 'characters');
  assert.equal(guide.next(), 'closePreview');
  assert.equal(guide.show(['note', 'closeNotebook'], ['notebook']), 'closeNotebook');
  assert.equal(guide.show(['notebook']), 'finished');
});

test('提示词区已收起时先展开，再依次收起、展开并进入大窗口', () => {
  const guide = simulate('collapse');
  assert.equal(guide.show(['expandSection', 'gear']), 'expandSection');
  guide.click();
  assert.equal(guide.show(['collapse', 'expandEditor', 'gear']), 'collapse');
  guide.click();
  assert.equal(guide.show(['expandSection', 'gear']), 'reopen');
  guide.click();
  assert.equal(guide.show(['collapse', 'expandEditor', 'gear']), 'expandEditor');
  const editor = ['editorToolbar', 'weightButtons', 'commentButtons', 'editorApply'];
  assert.equal(guide.show(editor, ['collapse', 'expandEditor']), 'editorToolbar');
  assert.equal(guide.next(), 'editorApply');
  assert.equal(guide.show(['collapse', 'expandEditor']), 'finished');
});

test('没有翻译页签或窄屏没有预览栏时跳过这些可选步骤', () => {
  const translation = simulate('translation');
  assert.equal(translation.show(['gear', 'promptInput']), 'gear');
  assert.equal(translation.show(['translationSettings'], ['gear']), 'translationSettings');
  assert.equal(translation.next(), 'finished');

  const comments = simulate('comments');
  assert.equal(comments.show(['expandEditor']), 'expandEditor');
  assert.equal(comments.show(['commentButtons', 'editorApply'], ['expandEditor']), 'commentButtons');
  assert.equal(comments.next(), 'editorApply');
});

test('工作台引导的每一步都能找到下一步，受限账号不提供的引导都在目录中', () => {
  for (const [name, guide] of Object.entries(WORKSPACE_GUIDES)) {
    const ids = guide.steps.map((step) => step.id);
    assert.equal(new Set(ids).size, ids.length, `${name} 的步骤编号不能重复`);
    assert.ok(guide.steps.some((step) => !step.extra), `${name} 至少有一个计数步骤`);
    const last = guide.steps.at(-1);
    assert.ok(last.next || last.end, `${name} 最后一步必须能结束引导`);
  }
  for (const guide of RESTRICTED_GUIDES) assert.ok(TUTORIAL_TOPICS.some((topic) => topic.guide === guide));
});

test('教程图示的三张 PNG 可以直接读取，尺寸与历史缩略图记录一致', async () => {
  const { tutorialImages } = await import('./tutorialImages.mjs');
  assert.equal(tutorialImages.length, 3);
  for (const image of tutorialImages) {
    const png = await readFile(new URL('../../public' + image.src, import.meta.url));
    assert.equal(png.toString('ascii',1,4),'PNG');
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[image.width,image.height]);
  }
});

test('所有教程的节点都有双语名称，触屏的节点与实际可练习的项目一致', async () => {
  const { getReplayChapters } = await import('./tutorials/replayChapters.mjs');
  for (const { id } of TUTORIAL_TOPICS) {
    for (const narrow of [false,true]) {
      const chapters = getReplayChapters(id,narrow,'zh-CN');
      const en = getReplayChapters(id,narrow,'en-US');
      assert.ok(chapters.length >= 3 && chapters.length <= 5, id);
      assert.deepEqual(chapters.map(c=>c.start),en.map(c=>c.start));
      assert.ok(chapters.every((c,i)=>c.label && en[i].label && en[i].label !== c.label));
      if (narrow) assert.ok(chapters.every(c => !['commentKey','wheelWeight'].includes(c.start)));
      if (DRAWING_LESSONS[id]) {
        const lesson = getDrawingLesson(id,narrow);
        assertSameShape(lesson['zh-CN'],lesson['en-US'],id);
        assert.equal(lesson.actions.length,lesson['zh-CN'].demo.length);
        const indexes=chapters.map(c=>lesson.actions.indexOf(c.start));
        assert.ok(indexes.every((v,i)=>v>=0 && (!i || v>indexes[i-1])));
      }
    }
  }
});
