import assert from 'node:assert/strict';
import test from 'node:test';
import { diffParameters, diffPrompts, diffPromptText, promptTokens } from './versionDiff.mjs';

test('行内差异精确标记词语、权重和换行，并能还原两侧原文', () => {
  for (const [before, after] of [
    ['red eyes, {rain}, city\nnight', 'blue eyes, 1.3::rain::, city\nnight, neon'],
    ['a, b, a', 'b, a, a'], ['', '纯提示词草稿'], ['test', ''], ['same', 'same'],
  ]) {
    const fragments = diffPromptText(before, after);
    assert.equal(fragments.filter((part) => part.kind !== 'added').map((part) => part.text).join(''), before);
    assert.equal(fragments.filter((part) => part.kind !== 'removed').map((part) => part.text).join(''), after);
  }
  const changed = diffPromptText('red eyes', 'blue eyes');
  assert.deepEqual(changed, [{ kind: 'removed', text: 'red' }, { kind: 'added', text: 'blue' }, { kind: 'equal', text: ' eyes' }]);
});

test('数值、括号和负权重按有效权重比较，保留标签重复次数', () => {
  assert.deepEqual(promptTokens('1.2::red, blue::, {green}, -1::dark::, name (series, part), escaped\\,comma'), [
    { name: 'red', weight: 1.2 }, { name: 'blue', weight: 1.2 }, { name: 'green', weight: 1.05 }, { name: 'dark', weight: -1 }, { name: 'name (series, part)', weight: 1 }, { name: 'escaped,comma', weight: 1 },
  ]);
  assert.deepEqual(diffPrompts('red, red, {blue}, old', 'red, 1.5::blue::, new'), {
    added: [{ name: 'new', weight: 1 }], removed: [{ name: 'red', weight: 1 }, { name: 'old', weight: 1 }], changed: [{ name: 'blue', before: 1.05, after: 1.5 }],
  });
});

test('参数与角色逐字段比较，属性顺序和重复别名不产生噪声', () => {
  assert.deepEqual(diffParameters(
    { positivePrompt: 'red', prompt: 'red', guidanceScale: 5, scale: 5, characterTabs: [{ prompt: 'girl', center: { x: 0.2, y: 0.5 } }], custom: { x: 1, y: 2 } },
    { positivePrompt: 'blue', prompt: 'blue', guidanceScale: 6, scale: 6, characterTabs: [{ prompt: 'boy', center: { x: 0.8, y: 0.5 } }], custom: { y: 2, x: 1 } },
  ), [
    { path: 'guidanceScale', before: 5, after: 6 }, { path: 'characterTabs.0.prompt', before: 'girl', after: 'boy' }, { path: 'characterTabs.0.center.x', before: 0.2, after: 0.8 },
  ]);
});

test('参考图片相同时不报变化，变化时摘要不泄漏图片编码', () => {
  const original = { image: 'data:image/png;base64,old', director_reference_images_cached: [{ data: 'private-old' }] };
  assert.deepEqual(diffParameters(original, structuredClone(original)), []);
  const changes = diffParameters(original, { image: 'data:image/png;base64,new', director_reference_images_cached: [{ data: 'private-new' }] });
  assert.deepEqual(changes, [{ path: 'image', media: true }, { path: 'director_reference_images_cached', media: true }]);
  assert.equal(JSON.stringify(changes).includes('private'), false);
});

test('双冒号关闭全部未闭合的括号权重，不把权重泄漏给后续标签', () => {
  assert.deepEqual(promptTokens('{{rain::, plain'), [{ name: 'rain', weight: 1.1025 }, { name: 'plain', weight: 1 }]);
  assert.deepEqual(promptTokens('[1.2::rain::, plain'), [{ name: 'rain', weight: 1.2 }, { name: 'plain', weight: 1 }]);
  assert.deepEqual(promptTokens('red {hair}, plain'), [{ name: 'red hair', weight: 1.028571 }, { name: 'plain', weight: 1 }]);
});

test('导入版本与再次生成的角色副本只显示规范字段变化，不重复整个 caption 对象', () => {
  const before = {
    positivePrompt: 'red sky', negativePrompt: 'lowres', use_coords: true,
    characterTabs: [{ prompt: 'girl', uc: 'hat', center: { x: 0.2, y: 0.5 }, colorId: 0 }],
    v4_prompt: { caption: { base_caption: 'red sky', char_captions: [{ char_caption: 'girl', centers: [{ x: 0.2, y: 0.5 }] }] }, use_coords: true },
    v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [{ char_caption: 'hat', centers: [{ x: 0.2, y: 0.5 }] }] } },
  };
  const after = {
    positivePrompt: 'blue sky', negativePrompt: 'lowres', use_coords: true,
    characterTabs: [{ prompt: 'boy', uc: 'hat', center: { x: 0.8, y: 0.5 }, colorId: 4 }],
    characterPrompts: [{ prompt: 'boy', uc: 'hat', center: { x: 0.8, y: 0.5 }, enabled: true }],
    v4_prompt_char_captions: [{ char_caption: 'boy', centers: [{ x: 0.8, y: 0.5 }] }],
    v4_negative_prompt_char_captions: [{ char_caption: 'hat', centers: [{ x: 0.8, y: 0.5 }] }],
  };
  const original = structuredClone({ before, after });
  assert.deepEqual(diffParameters(before, after), [
    { path: 'characterTabs.0.prompt', before: 'girl', after: 'boy' },
    { path: 'characterTabs.0.center.x', before: 0.2, after: 0.8 },
  ]);
  assert.deepEqual({ before, after }, original);
});

test('没有规范字段时保留原始 v4 提示词、坐标与未知字段，单侧对象逐叶显示', () => {
  assert.deepEqual(diffParameters({}, {
    v4_prompt: { caption: { base_caption: 'main', char_captions: [{ char_caption: 'girl', centers: [{ x: 0.2, y: 0.5 }], custom: { enabled: true } }] }, use_order: false },
  }), [
    { path: 'v4_prompt.caption.base_caption', before: undefined, after: 'main' },
    { path: 'v4_prompt.caption.char_captions.0.char_caption', before: undefined, after: 'girl' },
    { path: 'v4_prompt.caption.char_captions.0.centers.0.x', before: undefined, after: 0.2 },
    { path: 'v4_prompt.caption.char_captions.0.centers.0.y', before: undefined, after: 0.5 },
    { path: 'v4_prompt.caption.char_captions.0.custom.enabled', before: undefined, after: true },
    { path: 'v4_prompt.use_order', before: undefined, after: false },
  ]);
});

test('部分规范字段只隐藏对应副本，额外中心点、未知属性与启用状态仍保留', () => {
  const after = {
    positivePrompt: 'main', characterTabs: [{ prompt: 'girl', center: { x: 0.2, y: 0.5 }, colorId: 3, isTemporarilyDisabled: false }],
    v4_prompt: { caption: { base_caption: 'main', char_captions: [{ char_caption: 'girl', centers: [{ x: 0.2, y: 0.5, z: 1 }, { x: 0.7, y: 0.9 }], custom: 'keep' }] }, use_order: true },
    v4_negative_prompt: { caption: { base_caption: 'negative without canonical', char_captions: [{ char_caption: 'hat' }] } },
  };
  const changes = diffParameters({}, after);
  assert.deepEqual(changes.map((item) => item.path), [
    'characterTabs.0.prompt', 'characterTabs.0.center.x', 'characterTabs.0.center.y', 'characterTabs.0.isTemporarilyDisabled',
    'v4_prompt.caption.char_captions.0.centers.0.z', 'v4_prompt.caption.char_captions.0.centers.1.x', 'v4_prompt.caption.char_captions.0.centers.1.y',
    'v4_prompt.caption.char_captions.0.custom', 'v4_prompt.use_order', 'v4_negative_prompt.caption.base_caption', 'v4_negative_prompt.caption.char_captions.0.char_caption',
  ]);
  assert.ok(changes.every((item) => item.after === null || typeof item.after !== 'object'));
});

test('嵌套 characterControl 副本按启用角色对应规范卡片，UI颜色不计入差异', () => {
  const tabs = [{ prompt: 'disabled', isTemporarilyDisabled: true, colorId: 2 }, { prompt: 'active', uc: '', center: { x: 0.4, y: 0.8 }, colorId: 4 }];
  const before = { characterTabs: tabs, use_coords: true };
  const after = { ...before, characterControl: {
    characterTabs: structuredClone(tabs), characterPrompts: [{ prompt: 'active', uc: '', center: { x: 0.4, y: 0.8 }, enabled: true }],
    v4_prompt_char_captions: [{ char_caption: 'active', centers: [{ x: 0.4, y: 0.8 }] }],
    v4_negative_prompt_char_captions: [{ char_caption: '', centers: [{ x: 0.4, y: 0.8 }] }],
    use_coords: true, enabledCharacterCount: 1,
  } };
  after.characterControl.characterTabs[0].colorId = 5;
  assert.deepEqual(diffParameters(before, after), []);
  assert.deepEqual(diffParameters({ characterTabs: [] }, { characterTabs: [], v4_prompt_char_captions: [], characterPrompts: [] }), []);
});

test('emotion 与 colorize 的独立工具提示词不被主正向提示词去重', () => {
  for (const req_type of ['emotion', 'colorize']) {
    assert.deepEqual(diffParameters(
      { req_type, positivePrompt: 'portrait', prompt: 'old tool instruction' },
      { req_type, positivePrompt: 'portrait', prompt: 'new tool instruction' },
    ), [{ path: 'prompt', before: 'old tool instruction', after: 'new tool instruction' }]);
  }
});
