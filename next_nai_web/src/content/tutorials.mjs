import { DRAWING_LESSONS } from './tutorials/drawing.mjs';

/**
 * 教程目录：页面 → 模块 → 篇目三级。篇目正文和演示按需加载，这里只保存导航与引导需要的编号。
 * 新增模块时在对应页面下追加 modules；guide 指向下方的工作台引导。
 */
export const TUTORIAL_CATALOG = Object.freeze([
  {
    id: 'painting',
    modules: [
      {
        id: 'promptEditor',
        topics: [
          { id: 'collapse', guide: 'collapse' },
          { id: 'preview', guide: 'preview' },
          { id: 'translation', guide: 'translation' },
          { id: 'comments', guide: 'comments' },
          { id: 'weights', guide: 'weights' },
          { id: 'suggestions', guide: 'suggestions' },
          { id: 'random', guide: 'random' },
        ],
      },
      { id: 'promptNotebook', topics: [{ id: 'notebook', guide: 'notebook' }] },
      { id: 'drawingImages', topics: ['imageDisplay', 'imageHistory', 'imageDrop', 'imageAdjustment'].map((id) => ({ id, guide: id })) },
      { id: 'drawingJobs', topics: ['generationParameters', 'generationErrors'].map((id) => ({ id, guide: id })) },
      { id: 'drawingWorks', topics: [{ id: 'workHistory', guide: 'workHistory' }] },
    ],
  },
]);

/** 按阅读顺序排好的全部篇目，供上一篇、下一篇和面包屑使用。 */
export const TUTORIAL_TOPICS = Object.freeze(TUTORIAL_CATALOG.flatMap((page) => page.modules.flatMap((group) =>
  group.topics.map((topic) => ({ ...topic, page: page.id, module: group.id })))));

/** 图像、参数、错误和作品的练习采用独立工作台。 */
export const DRAWING_TUTORIALS = Object.freeze(Object.keys(DRAWING_LESSONS));

// 手机上参数面板收在抽屉里；提示词区收起时先展开。两步都不计入步骤编号。
const panel = { id: 'panel', extra: true };
const expandSection = { id: 'expandSection', click: true, optional: true, extra: true };

/**
 * 工作台引导：每一步高亮一个带 data-release-target 的真实控件。
 * - 没有标记的步骤由用户自己打开窗口推进，后面的控件出现后自动切换。
 * - next：看完后点「下一步」；click：点击高亮控件后继续。
 * - optional：控件不在页面上时跳过，例如受限账号没有翻译页签。
 * - end：这个控件所在的窗口关闭后结束引导。
 * - practice：结束后进入提示词联想练习。
 */
export const WORKSPACE_GUIDES = Object.freeze({
  collapse: {
    practice: true,
    steps: [panel, expandSection, { id: 'collapse', click: true }, { id: 'reopen', target: 'expandSection', click: true },
      { id: 'expandEditor' }, { id: 'editorToolbar', next: true }, { id: 'editorApply', end: true }],
  },
  preview: {
    practice: true,
    steps: [panel, expandSection, { id: 'promptInput', next: true }, { id: 'gear' }, { id: 'previewToggle', next: true }],
  },
  translation: {
    practice: true,
    steps: [panel, { id: 'translationTab', click: true, optional: true }, { id: 'translateSource', next: true, optional: true },
      { id: 'gear' }, { id: 'translationSettings', next: true }],
  },
  comments: {
    practice: true,
    steps: [panel, expandSection, { id: 'expandEditor' }, { id: 'commentButtons', next: true },
      { id: 'editorPreview', next: true, optional: true }, { id: 'editorApply', end: true }],
  },
  weights: {
    practice: true,
    steps: [panel, expandSection, { id: 'expandEditor' }, { id: 'weightButtons', next: true }, { id: 'editorApply', end: true }],
  },
  suggestions: {
    practice: true,
    steps: [panel, { id: 'gear' }, { id: 'configure' }, { id: 'enableSuggestions', next: true },
      { id: 'appearance', next: true }, { id: 'syntax', next: true }, { id: 'closeSettings', end: true }],
  },
  random: {
    practice: true,
    steps: [panel, { id: 'random' }, { id: 'randomEnable', next: true }, { id: 'randomTabs', next: true }, { id: 'randomActions', end: true }],
  },
  notebook: {
    practice: true,
    steps: [panel, { id: 'notebook' }, { id: 'note' }, { id: 'characters', next: true }, { id: 'closePreview' }, { id: 'closeNotebook', end: true }],
  },
});

/**
 * 根据页面上实际显示的控件算出引导当前所在的步骤。用户自己打开、关闭窗口时，引导跟着前进或回到入口。
 * @param {object[]} steps WORKSPACE_GUIDES 中一条引导的步骤。
 * @param {number} progress 已经完成的步骤数。
 * @param {Set<string>} visible 当前可以操作的控件名。
 * @param {Set<string>} present 页面上存在的控件名，包括被下拉菜单或子窗口暂时遮住的控件。
 * @param {Set<number>} seen 已经显示过的步骤序号；函数会记录新出现的步骤，并清除已经关闭的步骤。
 * @returns {{done: number, index: number, hidden: boolean}} done 为新的完成数，不小于步骤数时引导结束；
 *   index 为当前步骤，-1 表示控件还没出现；hidden 表示控件被暂时遮住，提示应先隐藏。
 */
export function findGuideStep(steps, progress, visible, present, seen) {
  const targetOf = (step) => step.target || step.id;
  // 还没完成的阅读或点击步骤会挡住后面的步骤；可选步骤只在控件存在时才需要完成。
  const blocks = (step) => (step.next || step.click) && (!step.optional || present.has(targetOf(step)));

  let done = progress;
  steps.forEach((step, index) => {
    if (index < done || !seen.has(index) || present.has(targetOf(step))) return;
    seen.delete(index);
    // 阅读步骤的控件随窗口关闭，说明用户已经看过并离开；结束窗口关闭时，前面不能再有没完成的步骤。
    if (step.next) done = index + 1;
    else if (step.end && !steps.slice(done, index).some(blocks)) done = steps.length;
  });
  if (done !== progress) return { done, index: -1, hidden: false };
  steps.forEach((step, index) => { if (index >= progress && visible.has(targetOf(step))) seen.add(index); });

  // 从当前进度往后找，遇到第一个还没完成的阅读或点击步骤为止；其中最后一个可见的控件就是当前步骤。
  let index = -1;
  let hidden = false;
  for (let candidate = progress; candidate < steps.length; candidate += 1) {
    const step = steps[candidate];
    const target = targetOf(step);
    if (visible.has(target)) index = candidate;
    else if (seen.has(candidate) && present.has(target)) hidden = true;
    if (blocks(step)) break;
  }
  return { done, index, hidden: index < 0 && hidden };
}

/** 受限账号没有随机提示词、翻译页签和笔记本，这些引导不提供入口。 */
export const RESTRICTED_GUIDES = Object.freeze(['translation', 'random', 'notebook']);

/** 演练使用正式词库中的查询与词条，分类路径示例同时展示逐级浏览和类别内搜索。 */
export const SUGGESTION_EXERCISES = [
  { id: 'english', query: 'blue hair', tag: 'blue_hair' },
  { id: 'pinyin', query: 'jinfa', tag: 'blonde_hair' },
  { id: 'categories', query: '+', choices: ['clothing', 'bottoms', 'skirt'] },
  { id: 'scoped', query: '+原神=fu', tag: 'furina_(genshin_impact)' },
  { id: 'fuzzy', query: '?bluhair', tag: 'blue_hair' },
  { id: 'regex', query: '=*^blue_', tagPrefix: 'blue_' },
];
