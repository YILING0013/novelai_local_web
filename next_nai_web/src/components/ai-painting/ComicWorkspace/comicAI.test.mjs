import assert from 'node:assert/strict';
import test from 'node:test';
import { applyComicAIImage, buildComicAIParams, buildComicAISections, comicAIImagePlacement, comicAISectionFingerprint, validateComicAIPlan } from './comicAI.mjs';
import { applyTemplate, createComicPage, createRectanglePanel, panelBounds } from './comicDocument.mjs';
import { createComicElement } from './comicElements.mjs';

function planFixture() {
  return { version: 1, summary: '问候', characters: [{ id: 'a', name: '旅人', appearance: 'silver hair' }], sections: [{
    id: 0, width: 832, height: 1216, globalPrompt: 'comic, two panels', negativePrompt: 'blurry',
    panels: [{ id: 'p1', number: 1, summary: '问候' }, { id: 'p2', number: 2, summary: '远景' }],
    instances: [{ id: 'i1', panelId: 'p1', characterId: 'a', prompt: '1girl, silver hair', negativePrompt: 'hat', center: { x: 0.273, y: 0.31 } },
      { id: 'i2', panelId: 'p2', characterId: null, prompt: 'mountain', negativePrompt: '', center: { x: 0.5, y: 0.8 } }],
    dialogues: [{ id: 'd1', panelId: 'p1', speakerId: 'a', text: '你好！', type: 'speech', order: 1, direction: 'horizontal' },
      { id: 'd2', panelId: 'p2', speakerId: null, text: '第二天', type: 'narration', order: 2, direction: 'vertical' }],
  }] };
}

test('单框允许自由编排，多格参考保留编号、阅读方向及每区独立坐标', () => {
  assert.deepEqual(buildComicAISections(createComicPage())[0], { id: 0, width: 832, height: 1216, referencePanels: [] });
  const page = createComicPage('spreadPortrait', 'two-vertical');
  const sections = buildComicAISections(page);
  assert.deepEqual(sections.map(({ width, height }) => [width, height]), [[1216, 832], [1216, 832]]);
  assert.equal(sections[0].referencePanels[0].id, page.panels[0].id);
  assert.equal(buildComicAISections(page, 'rtl')[0].referencePanels[0].id, page.panels[1].id);
  assert.deepEqual(sections[0].referencePanels.map(({ center }) => center), sections[1].referencePanels.map(({ center }) => center));
  assert.deepEqual(sections[0].referencePanels.map(({ number }) => number), [1, 2]);
  page.panels[0].points[0].x = 0;
  const clipped = buildComicAISections(page)[0].referencePanels[0];
  assert.ok(clipped.center.x - clipped.width / 2 >= 0);
});

test('角色提示保留坐标、对白及横竖文字容器引导，质量词在全局Text清单之前', () => {
  const plan = validateComicAIPlan(planFixture());
  const params = buildComicAIParams(plan.sections[0], { qualitySuffix: 'best quality', seed: 42 });
  assert.equal(params.model, 'nai-diffusion-5-full');
  assert.equal(params.batchSize, 1);
  assert.equal(params.characterControl.use_coords, true);
  assert.deepEqual(params.characterControl.characterPrompts[0].center, { x: 0.273, y: 0.31 });
  assert.equal(params.characterControl.characterPrompts[0].prompt, '1girl, silver hair, speaking, wide speech bubble with tail pointing to this character, horizontal text, "你好！"');
  assert.equal(params.characterControl.characterPrompts[1].prompt, 'mountain');
  assert.equal(params.positivePrompt, 'comic, two panels, best quality, Panel 1: 问候, Panel 2: 远景, Panel 2: tall narrator box, vertical text, "第二天"\nText: 你好！\n\n第二天');
  assert.equal(params.characterControl.v4_negative_prompt_char_captions[0].char_caption, 'hat');
  const reversed = structuredClone(plan.sections[0]);
  reversed.dialogues[0].direction = 'vertical';
  reversed.dialogues[1].direction = 'horizontal';
  const reversedParams = buildComicAIParams(reversed, { qualitySuffix: 'best quality', seed: 42 });
  assert.equal(reversedParams.characterControl.characterPrompts[0].prompt, '1girl, silver hair, speaking, tall speech bubble with tail pointing to this character, vertical text, "你好！"');
  assert.equal(reversedParams.characterControl.characterPrompts[1].prompt, 'mountain');
  assert.ok(reversedParams.positivePrompt.includes('Panel 2: wide narrator box, horizontal text, "第二天"'));
  assert.equal(reversedParams.positivePrompt.split('\nText: ')[1], params.positivePrompt.split('\nText: ')[1], '修改方向不改写全局对白内容');
  reversed.dialogues[0].type = 'sfx';
  const soundEffect = buildComicAIParams(reversed);
  assert.equal(soundEffect.characterControl.characterPrompts[0].prompt, '1girl, silver hair');
  assert.ok(soundEffect.positivePrompt.includes('Panel 1: sound effect, vertical text, "你好！"'));
  plan.sections[0].dialogues[0].text = '欢迎！';
  for (let run = 0; run < 2; run += 1) {
    const changed = buildComicAIParams(plan.sections[0]);
    assert.equal(changed.positivePrompt.includes('你好！'), false);
    assert.equal(changed.positivePrompt.match(/Text:/g).length, 1);
    assert.equal(changed.characterControl.characterPrompts[0].prompt.match(/欢迎！/g).length, 1);
  }
  const medium = buildComicAIParams(plan.sections[0], { model: 'nai-diffusion-5-full-medium' });
  assert.equal(medium.steps, 14);
  plan.sections[0].instances[0].center.x = 1.2;
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  assert.equal(buildComicAIParams(plan.sections[0]).characterControl.characterPrompts[0].center.x, 1);
  plan.sections[0].instances[0].center.x = NaN;
  assert.throws(() => validateComicAIPlan(plan), /instance/);
});

test('画外音和旁白不占可见人物槽，所有对白保留在末尾Text并按分镜粗定位', () => {
  const plan = planFixture();
  plan.characters.push({ id: 'b', name: '画外来客', appearance: 'black hair' });
  const section = plan.sections[0];
  section.panels[0].bounds = { x: 0, y: 0, width: 0.4, height: 0.5 };
  section.instances = [section.instances[0]];
  section.dialogues = [
    { id: 'd1', panelId: 'p1', speakerId: 'b', text: '门外有人吗？', type: 'speech', order: 1, direction: 'horizontal' },
    { id: 'd2', panelId: 'p1', speakerId: 'a', text: '请进。', type: 'speech', order: 2, direction: 'horizontal' },
    { id: 'd3', panelId: 'p1', speakerId: 'a', text: '一小时后', type: 'narration', order: 3, direction: 'vertical' },
    { id: 'd4', panelId: 'p2', speakerId: null, text: '咚咚', type: 'sfx', order: 4, direction: 'horizontal' },
  ];
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  const params = buildComicAIParams(section);
  assert.equal(params.characterControl.enabledCharacterCount, 1);
  assert.match(params.characterControl.characterPrompts[0].prompt, /请进。/);
  assert.doesNotMatch(params.characterControl.characterPrompts[0].prompt, /门外有人吗|一小时后|咚咚|off-screen/);
  assert.ok(params.positivePrompt.includes('Panel 1, upper left area: off-screen voice, wide speech bubble coming from outside the panel frame, horizontal text, "门外有人吗？"'));
  assert.ok(params.positivePrompt.includes('Panel 1, upper left area: tall narrator box, vertical text, "一小时后"'));
  assert.ok(params.positivePrompt.includes('Panel 2: sound effect, horizontal text, "咚咚"'));
  assert.equal(params.positivePrompt.split('\nText: ')[1], section.dialogues.map((line) => line.text).join('\n\n'));
  section.instances = [];
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  assert.equal(buildComicAIParams(section).characterControl.enabledCharacterCount, 0);
  section.dialogues[0].speakerId = 'missing';
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  assert.match(buildComicAIParams(section).positivePrompt, /off-screen voice.*门外有人吗/);
});

test('人物记录不完整、重复编号或台词缺漏仍可生成，空分镜也不拦截有效画面提示', () => {
  const plan = planFixture();
  plan.characters = [];
  const section = plan.sections[0];
  section.panels.forEach((panel) => { panel.number = 0; });
  section.panels[0].bounds = { x: -0.1, y: 0.95, width: 1.3, height: 0.2 };
  section.dialogues.forEach((dialogue) => { dialogue.order = 0; });
  section.instances[0].center = { x: 1.2, y: -0.1 };
  let params = buildComicAIParams(validateComicAIPlan(plan).sections[0]);
  assert.deepEqual(params.characterControl.characterPrompts[0].center, { x: 1, y: 0 });
  assert.match(params.characterControl.characterPrompts[0].prompt, /你好！/);
  assert.equal(params.positivePrompt.split('\nText: ')[1], '你好！\n\n第二天');
  section.dialogues = [];
  section.panels = [];
  params = buildComicAIParams(validateComicAIPlan(plan).sections[0]);
  assert.equal(params.characterControl.enabledCharacterCount, 2);
  assert.match(params.positivePrompt, /comic, two panels/);
  assert.doesNotMatch(params.positivePrompt, /Text:/);
});

test('自由构图显式关闭角色坐标仍保留版式和人物提示，旧计划默认沿用坐标控制', () => {
  const plan = planFixture();
  const section = plan.sections[0];
  section.globalPrompt = 'comic, irregular panel layout, diagonal gutters, inset panel';
  const original = buildComicAIParams(section, { characters: plan.characters });
  assert.equal(original.characterPositionMode, 'custom');
  assert.equal(original.characterControl.use_coords, true);
  section.useCoords = false;
  const free = buildComicAIParams(validateComicAIPlan(plan).sections[0], { characters: plan.characters });
  assert.equal(free.characterPositionMode, 'auto');
  assert.equal(free.characterControl.use_coords, false);
  assert.equal(free.positivePrompt, original.positivePrompt);
  assert.match(free.positivePrompt, /irregular panel layout, diagonal gutters, inset panel/);
  assert.doesNotMatch(free.positivePrompt, /(?:upper|middle|lower) (?:left|center|right) area/);
  assert.deepEqual(free.characterControl.characterPrompts, original.characterControl.characterPrompts);
  assert.deepEqual(free.characterControl.v4_prompt_char_captions, original.characterControl.v4_prompt_char_captions);
});

test('各角色固定外观带入每次出场，跨格重复人物一致且场景不混入角色外貌', () => {
  const plan = planFixture();
  plan.characters = [
    { id: 'a', name: '店员', appearance: '1girl, pink hair, blue eyes, green apron' },
    { id: 'b', name: '猫', appearance: 'gray tabby cat, yellow eyes, red collar' },
    { id: 'c', name: '画外来客', appearance: 'purple hair, black coat' },
  ];
  const section = plan.sections[0];
  section.instances[0].prompt = 'clerk, medium shot, leaning on the counter';
  section.instances.push(
    { ...section.instances[0], id: 'i3', panelId: 'p2', prompt: 'clerk, close-up of face, looking down' },
    { ...section.instances[0], id: 'i4', characterId: 'b', prompt: 'cat, raising one paw' },
  );
  section.dialogues.push({ id: 'd3', panelId: 'p2', speakerId: 'c', text: '门外有人吗？', type: 'speech', order: 3, direction: 'horizontal' });
  const params = buildComicAIParams(validateComicAIPlan(plan).sections[0], { characters: plan.characters });
  const prompts = params.characterControl.characterPrompts;
  assert.equal(params.characterControl.enabledCharacterCount, 4);
  for (const index of [0, 2]) {
    assert.ok(prompts[index].prompt.startsWith(`${plan.characters[0].appearance}, ${section.instances[index].prompt}`));
    assert.doesNotMatch(prompts[index].prompt, /gray tabby|yellow eyes|red collar/);
  }
  assert.equal(prompts[1].prompt, 'mountain');
  assert.equal(prompts[3].prompt, `${plan.characters[1].appearance}, cat, raising one paw`);
  assert.doesNotMatch(prompts[3].prompt, /pink hair|blue eyes|green apron/);
  assert.match(prompts[0].prompt, /speaking, wide speech bubble.*你好！/);
  assert.doesNotMatch(JSON.stringify(params), /purple hair|black coat/);
});

test('完整出场提示换装后不会带回人物表中的旧服装，旧两阶段计划仍保留外观前置', () => {
  const plan = planFixture();
  plan.planningModels = { story: 'xialong-v1', format: 'glm-4-6' };
  plan.characters[0].appearance = '1girl, red coat, braided hair';
  const section = plan.sections[0];
  section.instances[0].prompt = '1girl, yellow raincoat, loose hair, standing in rain';
  const legacy = buildComicAIParams(validateComicAIPlan(plan).sections[0], { characters: plan.characters });
  assert.ok(legacy.characterControl.characterPrompts[0].prompt.startsWith(plan.characters[0].appearance));
  plan.planningModels.extract = 'glm-4-6';
  plan.visualStyle = 'watercolor';
  section.characterPromptsComplete = true;
  const complete = buildComicAIParams(validateComicAIPlan(plan).sections[0], { characters: plan.characters });
  const prompt = complete.characterControl.characterPrompts[0].prompt;
  assert.ok(prompt.startsWith(section.instances[0].prompt));
  assert.doesNotMatch(prompt, /red coat|braided hair/);
  assert.match(prompt, /speaking, wide speech bubble.*你好！/);
  assert.equal(complete.characterControl.characterPrompts[1].prompt, 'mountain');
  assert.equal(complete.positivePrompt, legacy.positivePrompt);
  assert.deepEqual(complete.characterControl.characterPrompts[0].center, section.instances[0].center);
});

test('不同正常分镜数量和空镜可生成，仅角色实例受22槽上限约束', () => {
  const plan = planFixture();
  const section = plan.sections[0];
  section.dialogues = [];
  section.instances = [];
  for (const count of [1, 3, 4, 6, 8, 12, 24]) {
    section.panels = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, number: index + 1, summary: '空镜' }));
    assert.doesNotThrow(() => validateComicAIPlan(plan));
  }
  section.instances = Array.from({ length: 22 }, (_, index) => ({ id: `i${index}`, panelId: 'p0', characterId: 'a', prompt: 'person', negativePrompt: '', center: { x: 0.5, y: 0.5 } }));
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  section.instances.push({ ...section.instances[0], id: 'i22' });
  assert.throws(() => validateComicAIPlan(plan), /section/);
});

test('每格镜头含无人物的鱼空镜都进入主提示词，粗定位不增加角色或写入数字坐标', () => {
  const plan = planFixture();
  const section = plan.sections[0];
  section.panels = [
    { id: 'p1', number: 1, summary: 'A silver-haired clerk smiles behind a convenience store counter.', bounds: { x: 0.041, y: 0.031, width: 0.402, height: 0.302 } },
    { id: 'p2', number: 2, summary: 'Close-up of a wet fish lying on the empty counter, dripping water.', bounds: { x: 0.571, y: 0.681, width: 0.389, height: 0.287 } },
  ];
  section.instances = [section.instances[0]];
  const params = buildComicAIParams(validateComicAIPlan(plan).sections[0]);
  const visual = params.positivePrompt.split('\nText: ')[0];
  assert.ok(visual.includes(`Panel 1, upper left area: ${section.panels[0].summary}`));
  assert.ok(visual.includes(`Panel 2, lower right area: ${section.panels[1].summary}`));
  assert.ok(visual.includes('Panel 2, lower right area: tall narrator box'));
  assert.equal(params.characterControl.enabledCharacterCount, 1);
  assert.deepEqual(params.characterControl.characterPrompts[0].center, section.instances[0].center);
  for (const panel of section.panels) for (const coordinate of Object.values(panel.bounds)) assert.equal(visual.includes(String(coordinate)), false);
  for (const coordinate of Object.values(section.instances[0].center)) assert.equal(visual.includes(String(coordinate)), false);
});

test('有效引号与正负权重保留，只去掉明确旧Text清单和已知重复对白', () => {
  const plan = planFixture();
  const section = plan.sections[0];
  section.globalPrompt = '1.5::artist:example::, -1::4koma::, "rainy window", speech bubble, "旧对白"\nText: 旧对白\n\n第二天';
  section.negativePrompt = '1.5::4koma, simple composition::, bad quality';
  section.instances[0].prompt = '1.25::silver hair::, "golden hour", speech bubble, "旧对白"';
  section.instances[0].negativePrompt = '1.2::bad hands::';
  section.dialogues[0].text = '新对白';
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  const params = buildComicAIParams(section);
  assert.ok(params.positivePrompt.includes('1.5::artist:example::, -1::4koma::, "rainy window"'));
  assert.ok(params.characterControl.characterPrompts[0].prompt.includes('1.25::silver hair::, "golden hour"'));
  assert.doesNotMatch(params.positivePrompt, /旧对白/);
  assert.doesNotMatch(params.characterControl.characterPrompts[0].prompt, /旧对白/);
  assert.equal(params.positivePrompt.match(/Text:/g).length, 1);
  assert.equal(params.positivePrompt.split('\nText: ')[1], '新对白\n\n第二天');
  assert.equal(params.negativePrompt, section.negativePrompt);
  assert.equal(params.characterControl.v4_negative_prompt_char_captions[0].char_caption, '1.2::bad hands::');
  assert.equal(Object.hasOwn(params, 'ucPreset'), false);
  assert.equal(Object.hasOwn(params, 'ucPresetId'), false);
  assert.equal(section.globalPrompt.includes('旧对白'), true, '源计划保留完整原文供继续编辑');
});

test('收到计划即移除重复对白，保存后编辑台词不会从画面提示带回旧句', () => {
  for (const originalLine of ['原来的台词', '他说"欢迎"\n请进。']) {
    const raw = planFixture();
    const section = raw.sections[0];
    section.dialogues[0].text = originalLine;
    section.globalPrompt = `1.5::artist:example::, -1::4koma::, "rainy window", ${JSON.stringify(originalLine)}`;
    section.panels[0].summary = `A clerk opens the door, ${JSON.stringify(originalLine)}, 「${originalLine}」`;
    section.panels[1].summary = 'A fish lies on the counter, "更早的台词"\nText: 更早的台词';
    section.instances[0].prompt = `1.25::silver hair::, "golden hour", "${originalLine}", 「${originalLine}」`;
    const original = structuredClone(raw);
    const received = validateComicAIPlan(raw);
    assert.deepEqual(raw, original, '收到计划时不改写接口原对象');
    assert.equal(validateComicAIPlan(raw, { forGeneration: false }), raw, '旧项目导入仍保留可编辑原文');
    const saved = JSON.parse(JSON.stringify(received));
    saved.sections[0].dialogues[0].text = '修改后的台词';
    const params = buildComicAIParams(saved.sections[0]);
    assert.equal(params.positivePrompt.includes(originalLine), false);
    assert.equal(params.positivePrompt.includes(JSON.stringify(originalLine)), false);
    assert.equal(params.positivePrompt.includes('更早的台词'), false);
    assert.ok(params.positivePrompt.includes('Panel 1: A clerk opens the door'));
    assert.ok(params.positivePrompt.includes('Panel 2: A fish lies on the counter'));
    assert.equal(params.characterControl.characterPrompts[0].prompt.includes(originalLine), false);
    assert.equal(params.positivePrompt.split('\nText: ')[1], '修改后的台词\n\n第二天');
    assert.match(params.characterControl.characterPrompts[0].prompt, /修改后的台词/);
    assert.ok(params.positivePrompt.includes('1.5::artist:example::, -1::4koma::, "rainy window"'));
    assert.ok(params.characterControl.characterPrompts[0].prompt.includes('1.25::silver hair::, "golden hour"'));
  }
});

test('每图独立限制750个文字字符，对白空行分隔也计入且Unicode字符不重复计数', () => {
  const plan = planFixture();
  const section = plan.sections[0];
  section.dialogues[0].text = '😀'.repeat(744) + ' ';
  section.dialogues[1].text = '下一页';
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  plan.sections.push({ ...structuredClone(section), id: 1 });
  assert.doesNotThrow(() => validateComicAIPlan(plan));
  section.dialogues[0].text += '字';
  assert.throws(() => validateComicAIPlan(plan), /750/);
  assert.throws(() => buildComicAIParams(section), /750/);
  section.dialogues = [section.dialogues[0]];
  section.dialogues[0].text = '字'.repeat(374);
  assert.doesNotThrow(() => buildComicAIParams(section, { model: 'nai-diffusion-5-curated' }));
  section.dialogues[0].text += ' ';
  assert.throws(() => buildComicAIParams(section, { model: 'nai-diffusion-5-curated' }), /374/);
});

test('整区生成替换旧分镜而不复用裁片，另一分区内容保持独立', () => {
  const page = createComicPage('spreadPortrait', 'grid-four');
  const secondPanels = page.panels.filter((panel) => panel.section === 1);
  page.panels.push(createRectanglePanel(page, -1, { x: 1200, y: 100 }, { x: 1400, y: 300 }));
  page.elements.push(createComicElement('text', { x: 100, y: 100, width: 100, height: 100 }, { layerId: 'dialogue', text: '旧文字' }));
  const otherText = createComicElement('text', { x: 1500, y: 100, width: 100, height: 100 }, { layerId: 'dialogue', text: '保留文字' });
  page.elements.push(otherText);
  page.strokes.push({ id: 'old-stroke', layerId: 'dialogue', order: 4, width: 5, color: '#000', points: [{ x: 50, y: 50 }] });
  const original = structuredClone(page);
  const image = { dataUrl: 'data:image/png;base64,b3JpZ2luYWw=', width: 1216, height: 832 };
  const changed = applyComicAIImage(page, 0, image, { taskId: 'task' });
  assert.deepEqual(page, original);
  assert.deepEqual(changed.panels.filter((panel) => panel.section === 1), secondPanels);
  assert.equal(changed.panels.filter((panel) => panel.type === 'overlay').length, 0);
  assert.deepEqual(changed.elements, [otherText]);
  assert.equal(changed.strokes.length, 0);
  const visible = changed.panels.find((panel) => panel.comicAIRole === 'image');
  assert.deepEqual(panelBounds(visible), { x: 32, y: 32, width: 1216, height: 832 });
  assert.equal(visible.borderWidth, 0);
  assert.equal(changed.panels.filter((panel) => panel.section === 0).length, 2);
  assert.equal(changed.layers.find((layer) => layer.comicAIRole === 'original').visible, false);
  const reframed = applyTemplate(changed, 'grid-four', 0);
  assert.equal(buildComicAISections(reframed)[0].referencePanels.length, 4);
  const text = createComicElement('text', { x: 50, y: 60, width: 100, height: 50 }, { text: '新对白' });
  const clean = { ...image, dataUrl: 'data:image/png;base64,Y2xlYW4=' };
  const rebuilt = applyComicAIImage(changed, 0, clean, { taskId: 'task', textElements: [text] });
  assert.equal(rebuilt.panels.find((panel) => panel.comicAIRole === 'original').image.dataUrl, image.dataUrl);
  assert.equal(rebuilt.panels.find((panel) => panel.comicAIRole === 'image').image.dataUrl, clean.dataUrl);
  assert.equal(rebuilt.layers.filter((layer) => layer.comicAISectionId === 0).length, 3);
  assert.equal(rebuilt.elements.filter((element) => element.comicAISectionId === 0).length, 1);
});

test('旧页整图完整contain，修改检测忽略工作流和另一分区而识别目标区编辑', () => {
  const old = { ...createComicPage(), layoutVersion: 1, width: 800, height: 1120, panels: [] };
  const oldPage = applyTemplate(old, 'blank');
  const image = { dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 832, height: 1216 };
  const placement = comicAIImagePlacement(oldPage, 0, image);
  assert.equal(placement.scale, 1056 / 1216);
  const updated = applyComicAIImage(oldPage, 0, image);
  const rendered = updated.panels.find((panel) => panel.comicAIRole === 'image');
  assert.deepEqual(rendered.image, { ...image, ...placement, rotation: 0 });
  assert.equal(panelBounds(rendered).width, image.width * placement.scale);
  const spread = createComicPage('spreadLandscape');
  const before = comicAISectionFingerprint(spread, 0);
  const metadataOnly = { ...spread, updatedAt: 1, aiWorkflow: { state: 'working' } };
  assert.equal(comicAISectionFingerprint(metadataOnly, 0), before);
  metadataOnly.panels[1] = { ...metadataOnly.panels[1], borderWidth: 10 };
  assert.equal(comicAISectionFingerprint(metadataOnly, 0), before);
  metadataOnly.panels[0] = { ...metadataOnly.panels[0], borderWidth: 10 };
  assert.notEqual(comicAISectionFingerprint(metadataOnly, 0), before);
});
