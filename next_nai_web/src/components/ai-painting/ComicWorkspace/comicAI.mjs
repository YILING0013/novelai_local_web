import { createClientId } from '../../../utils/browserCapabilities.mjs';
import { COMIC_LAYOUTS, comicContentBounds, panelBounds, sectionBounds } from './comicDocument.mjs';
import { comicElementMatrix } from './comicElements.mjs';
import { ensureComicLayers } from './comicLayers.mjs';
import { buildNovelAIV5CharacterControl, NOVELAI_V5_DEFAULT_PARAMS, NOVELAI_V5_MEDIUM_DEFAULT_PARAMS, NOVELAI_V5_MEDIUM_MODEL_ID } from '../utils/novelAIV5Params.mjs';

/**
 * 将角色的整页归一化坐标约束在所属画框内，供画布预览、拖动和生图共同使用。
 * @param {object} page 当前漫画页。
 * @param {object} section 单区编排。
 * @param {object} instance 角色出场及其归一化坐标。
 * @returns {object} 画框、画布坐标与实际提交给模型的 center。
 */
export function comicAIControlPosition(page, section, instance) {
  const bounds = comicContentBounds(page, section.id);
  const frames = page.panels.filter((panel) => panel.section === section.id && panel.type !== 'overlay' && panel.comicAIRole !== 'original');
  const plannedPanel = section.panels.find((panel) => panel.id === instance.panelId);
  const frame = frames.find((panel) => panel.id === instance.panelId)
    || (frames.length === 1 ? frames[0] : frames[(plannedPanel?.number || 1) - 1]);
  let point = { x: bounds.x + Math.min(1, Math.max(0, instance.center.x)) * bounds.width,
    y: bounds.y + Math.min(1, Math.max(0, instance.center.y)) * bounds.height };
  if (frame) {
    const points = frame.points;
    let inside = false;
    let nearest = null;
    let distance = Infinity;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j], b = points[i];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
      const projected = { x: a.x + t * dx, y: a.y + t * dy };
      const candidate = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (candidate < distance) { distance = candidate; nearest = projected; }
    }
    if (!inside) {
      // 分镜为凸多边形；稍向内部收拢，控制点不会落在相邻画框的边线上。
      const center = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 });
      point = { x: nearest.x * 0.97 + center.x * 0.03, y: nearest.y * 0.97 + center.y * 0.03 };
    }
  }
  return { frame, point, center: { x: (point.x - bounds.x) / bounds.width, y: (point.y - bounds.y) / bounds.height } };
}

/**
 * 将预览时修正过的画框坐标写入计划，确保预览与实际生图使用同一份数据。
 * @param {object} page 当前漫画页。
 * @param {object} plan 完整编排。
 * @returns {object} 带规范坐标的编排副本。
 */
export function positionComicAIControls(page, plan) {
  return { ...plan, sections: plan.sections.map((section) => ({ ...section,
    useCoords: section.instances.length ? true : section.useCoords,
    instances: section.instances.map((instance) => ({ ...instance, center: comicAIControlPosition(page, section, instance).center })),
  })) };
}

function comicTextContent(section, model) {
  const content = [...section.dialogues].sort((left, right) => left.order - right.order).map((dialogue) => dialogue.text).join('\n\n');
  // 官方文字上限包括空格和换行；按 Unicode 字符计数，不把表情误算成两个 UTF-16 单元。
  const limit = model === 'nai-diffusion-5-curated' ? 374 : 750;
  if (Array.from(content).length > limit) throw new Error(`第 ${section.id + 1} 页文字超过 ${limit} 字符（含空格与换行），请缩短对白。 / Page ${section.id + 1} text exceeds ${limit} characters, including spaces and newlines.`);
  return content;
}

/**
 * 让对白只保存在 dialogues 中，接收计划和构建请求时都清理明确的重复文字。
 * @param {object} section 已通过结构校验的单区编排。
 * @returns {object} 保留其他提示词与权重的编排副本，不修改传入对象。
 */
function cleanComicAIVisualPrompts(section) {
  const textBlock = /(?:^|\n)[\t ]*Text[\t ]*:[\t ]*([\s\S]*)$/i;
  const knownText = new Set(section.dialogues.map((dialogue) => dialogue.text).filter(Boolean));
  for (const prompt of [section.globalPrompt, ...section.panels.map((panel) => panel.summary), ...section.instances.map((instance) => instance.prompt)]) {
    const previous = prompt.match(textBlock);
    if (previous) for (const line of previous[1].split(/\n[\t ]*\n/)) if (line.trim()) knownText.add(line.trim());
  }
  const cleanVisualPrompt = (prompt) => {
    let visual = prompt.replace(textBlock, '').trim();
    for (const line of knownText) {
      visual = visual.replaceAll(JSON.stringify(line), '');
      for (const [open, close] of [['"', '"'], ['“', '”'], ['「', '」'], ['『', '』']]) visual = visual.replaceAll(`${open}${line}${close}`, '');
    }
    return visual.replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '');
  };
  return { ...section, globalPrompt: cleanVisualPrompt(section.globalPrompt),
    panels: section.panels.map((panel) => ({ ...panel, summary: cleanVisualPrompt(panel.summary) })),
    instances: section.instances.map((instance) => ({ ...instance, prompt: cleanVisualPrompt(instance.prompt) })) };
}

/**
 * 将现有漫画页整理为故事编排输入，多格只提供参考位置，不作为生成后的裁切模板。
 * @param {object} page 当前漫画页。
 * @param {'ltr'|'rtl'} readingDirection 同一行分镜的阅读方向，默认从左到右。
 * @returns {Array<object>} 每区固定请求尺寸及归一化参考分镜；单框页允许模型自由编排。
 */
export function buildComicAISections(page, readingDirection = 'ltr') {
  const ready = ensureComicLayers(page);
  const visibleLayers = new Set(ready.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return Array.from({ length: COMIC_LAYOUTS[page.layout].sections }, (_, id) => {
    const bounds = comicContentBounds(page, id);
    const panels = ready.panels.filter((panel) => panel.type !== 'overlay' && !panel.comicAIRole && panel.section === id && visibleLayers.has(panel.layerId))
      .map((panel) => {
        const box = panelBounds(panel);
        const x = Math.max(box.x, bounds.x), y = Math.max(box.y, bounds.y);
        return { panel, bounds: { x, y, width: Math.min(box.x + box.width, bounds.x + bounds.width) - x, height: Math.min(box.y + box.height, bounds.y + bounds.height) - y } };
      }).filter(({ bounds: box }) => box.width > 0 && box.height > 0);
    // 同一水平带内按阅读方向排序，避免有意错开一点高度的画框被误排到下一行。
    panels.sort((left, right) => {
      const overlap = Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height) - Math.max(left.bounds.y, right.bounds.y);
      if (overlap > Math.min(left.bounds.height, right.bounds.height) / 2) return (left.bounds.x - right.bounds.x) * (readingDirection === 'rtl' ? -1 : 1);
      return left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x;
    });
    return {
      id, width: page.layout === 'portrait' ? 832 : 1216, height: page.layout === 'portrait' ? 1216 : 832,
      referencePanels: panels.length > 1 ? panels.map(({ panel, bounds: box }, index) => ({
        id: panel.id, number: index + 1,
        center: { x: (box.x + box.width / 2 - bounds.x) / bounds.width, y: (box.y + box.height / 2 - bounds.y) / bounds.height },
        width: box.width / bounds.width, height: box.height / bounds.height,
      })) : [],
    };
  });
}

/**
 * 检查编排能否被编辑器和生成流程读取，不把剧情、台词或角色完整度作为生成门槛。
 * @param {object} plan version 1 的完整漫画编排。
 * @param {object} options model 默认 V5 Full；forGeneration 默认 true，导入编辑草稿时设为 false，仅检查结构。
 * @returns {object} 生成时返回已清理重复对白的编排副本；仅校验导入时保留原对象。结构不完整时抛出错误。
 */
export function validateComicAIPlan(plan, { model = 'nai-diffusion-5-full', forGeneration = true } = {}) {
  const identified = (items) => Array.isArray(items) && items.every((item) => item && typeof item.id === 'string' && item.id.length > 0) && new Set(items.map((item) => item.id)).size === items.length;
  const coordinate = (value) => typeof value === 'number' && Number.isFinite(value);
  if (!plan || plan.version !== 1 || typeof plan.summary !== 'string' || !identified(plan.characters) || !Array.isArray(plan.sections) || !plan.sections.length || plan.sections.length > 2) throw new Error('Invalid comic AI plan.');
  if (plan.storyDraft !== undefined && typeof plan.storyDraft !== 'string') throw new Error('Invalid comic AI story draft.');
  if (plan.visualStyle !== undefined && typeof plan.visualStyle !== 'string') throw new Error('Invalid comic AI visual style.');
  if (plan.planningModels !== undefined && (!plan.planningModels || typeof plan.planningModels.story !== 'string' || typeof plan.planningModels.format !== 'string'
    || (plan.planningModels.extract !== undefined && typeof plan.planningModels.extract !== 'string'))) throw new Error('Invalid comic AI planning models.');
  if (plan.characters.some((character) => typeof character.name !== 'string' || typeof character.appearance !== 'string')) throw new Error('Invalid comic AI character.');
  const sectionIds = new Set();
  for (const section of plan.sections) {
    if (!Number.isInteger(section.id) || section.id < 0 || section.id > 1 || sectionIds.has(section.id)
      || !((section.width === 832 && section.height === 1216) || (section.width === 1216 && section.height === 832))
      || typeof section.globalPrompt !== 'string' || typeof section.negativePrompt !== 'string'
      || !identified(section.panels)
      || !identified(section.instances) || section.instances.length > 22 || !identified(section.dialogues)) throw new Error('Invalid comic AI section.');
    sectionIds.add(section.id);
    if (section.panels.some((panel) => !Number.isInteger(panel.number) || typeof panel.summary !== 'string')) throw new Error('Invalid comic AI panel.');
    if (section.panels.some((panel) => panel.bounds !== undefined && (!['x', 'y', 'width', 'height'].every((key) => coordinate(panel.bounds?.[key]))
      || panel.bounds.width <= 0 || panel.bounds.height <= 0))) throw new Error('Invalid comic AI panel bounds.');
    if (section.instances.some((instance) => typeof instance.panelId !== 'string' || (instance.characterId !== null && typeof instance.characterId !== 'string')
      || typeof instance.prompt !== 'string' || typeof instance.negativePrompt !== 'string' || !coordinate(instance.center?.x) || !coordinate(instance.center?.y))) throw new Error('Invalid comic AI instance.');
    if (section.dialogues.some((dialogue) => typeof dialogue.panelId !== 'string' || (dialogue.speakerId !== null && typeof dialogue.speakerId !== 'string')
      || typeof dialogue.text !== 'string' || !['speech', 'narration', 'sfx'].includes(dialogue.type) || !['horizontal', 'vertical'].includes(dialogue.direction)
      || !Number.isInteger(dialogue.order))) throw new Error('Invalid comic AI dialogue.');
    // 缺少对白、人物记录或重复排序不影响请求执行；这里只检查每张图的真实文字容量。
    if (forGeneration) comicTextContent(section, model);
  }
  // 首次收到计划即移除画面提示里的重复对白，随后编辑 dialogues 不会把旧台词带回请求。
  return forGeneration ? { ...plan, sections: plan.sections.map(cleanComicAIVisualPrompts) } : plan;
}

/**
 * 将一页编排变成现有图像生成服务可直接执行的 V5 参数。
 * @param {object} section 已校验的单区编排，包含角色实例与对白。
 * @param {object} options characters 为人物固定外观；另含模型、质量提示后缀与种子，质量词放在 Text 清单之前。
 * @returns {object} 带精确角色坐标的普通生成参数，一次只请求一张图。
 */
export function buildComicAIParams(section, { characters = [], model = 'nai-diffusion-5-full', qualitySuffix = 'best quality, amazing quality, very aesthetic, highres', seed = '' } = {}) {
  section = cleanComicAIVisualPrompts(section);
  const dialogues = [...section.dialogues].sort((left, right) => left.order - right.order);
  const text = comicTextContent(section, model);
  const panelLocations = new Map(section.panels.map((panel) => {
    let location = `Panel ${panel.number}`;
    if (panel.bounds) {
      const x = panel.bounds.x + panel.bounds.width / 2, y = panel.bounds.y + panel.bounds.height / 2;
      location += `, ${y < 1 / 3 ? 'upper' : y > 2 / 3 ? 'lower' : 'middle'} ${x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center'} area`;
    }
    return [panel.id, location];
  }));
  // 空镜没有人物实例，仍需把每格可绘制的镜头描述传给生图模型。
  const panelShots = section.panels.filter((panel) => panel.summary).map((panel) => `${panelLocations.get(panel.id)}: ${panel.summary}`);
  const speakers = new Map(dialogues.filter((dialogue) => dialogue.type === 'speech' && dialogue.speakerId !== null).map((dialogue) => [dialogue.id,
    section.instances.find((instance) => instance.panelId === dialogue.panelId && instance.characterId === dialogue.speakerId)?.id]));
  const characterTabs = section.instances.map((instance) => {
    // 新计划的出场提示已经包含当时的完整外观，避免把人物表里的旧服装重新加回去。
    const appearance = section.characterPromptsComplete === true ? '' : characters.find((character) => character.id === instance.characterId)?.appearance;
    const lines = dialogues.filter((dialogue) => speakers.get(dialogue.id) === instance.id);
    const spoken = lines.map((dialogue) => {
      const vertical = dialogue.direction === 'vertical';
      // 生图时就引导文字方向和容器比例，避免后续把横排文字塞进模型生成的细长竖气泡。
      const shape = vertical ? 'tall' : 'wide';
      return `speaking, ${shape} speech bubble with tail pointing to this character, ${vertical ? 'vertical text' : 'horizontal text'}, ${JSON.stringify(dialogue.text)}`;
    });
    return {
      id: instance.id, name: instance.characterId || '场景', prompt: [appearance, instance.prompt, ...spoken].filter(Boolean).join(', '),
      uc: instance.negativePrompt, center: { ...instance.center }, isTemporarilyDisabled: false,
    };
  });
  const unboundText = dialogues.filter((dialogue) => !speakers.get(dialogue.id)).map((dialogue) => {
    const vertical = dialogue.direction === 'vertical';
    const shape = vertical ? 'tall' : 'wide';
    // 画外音、旁白和拟声词属于画面提示，不借用入镜人物的角色槽。
    const container = dialogue.type === 'narration' ? `${shape} narrator box` : dialogue.type === 'sfx' ? 'sound effect'
      : `off-screen voice, ${shape} speech bubble coming from outside the panel frame`;
    return `${panelLocations.get(dialogue.panelId)}: ${container}, ${vertical ? 'vertical text' : 'horizontal text'}, ${JSON.stringify(dialogue.text)}`;
  });
  const global = [section.globalPrompt, qualitySuffix.trim(), ...panelShots, ...unboundText].filter(Boolean).join(', ');
  return {
    ...NOVELAI_V5_DEFAULT_PARAMS,
    ...(model === NOVELAI_V5_MEDIUM_MODEL_ID ? NOVELAI_V5_MEDIUM_DEFAULT_PARAMS : {}),
    model, width: section.width, height: section.height, seed, batchSize: 1,
    positivePrompt: dialogues.length ? `${global}\nText: ${text}` : global,
    negativePrompt: section.negativePrompt, characterPositionMode: section.useCoords === false ? 'auto' : 'custom',
    characterControl: buildNovelAIV5CharacterControl(characterTabs, section.useCoords !== false),
  };
}

/**
 * 将整张生成图完整放入分区内容区，旧尺寸页面也不会裁掉边缘剧情。
 * @param {object} page 接收图片的漫画页。
 * @param {number} sectionId 分区编号。
 * @param {{width:number,height:number}} image 原始图片尺寸。
 * @returns {{x:number,y:number,width:number,height:number,scale:number}} 页面坐标中的图片放置参数，width/height 保留原图尺寸。
 */
export function comicAIImagePlacement(page, sectionId, image) {
  const bounds = comicContentBounds(page, sectionId);
  const scale = Math.min(bounds.width / image.width, bounds.height / image.height);
  return { x: bounds.x + (bounds.width - image.width * scale) / 2, y: bounds.y + (bounds.height - image.height * scale) / 2, width: image.width, height: image.height, scale };
}

/**
 * 记录会影响指定分区结果的编辑内容，忽略工作流状态与保存时间。
 * @param {object} page 当前漫画页。
 * @param {number} sectionId 需要检测修改的分区编号。
 * @returns {string} 可与任务发起时比较的稳定内容快照。
 */
export function comicAISectionFingerprint(page, sectionId) {
  const ready = ensureComicLayers(page);
  const bounds = sectionBounds(page, sectionId);
  const overlaps = (box) => box.x < bounds.x + bounds.width && box.x + box.width > bounds.x && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y;
  const panels = ready.panels.filter((panel) => panel.section === sectionId || (panel.type === 'overlay' && overlaps(panelBounds(panel))));
  const strokes = ready.strokes.filter((stroke) => {
    const box = panelBounds(stroke.points);
    return overlaps({ x: box.x - stroke.width / 2, y: box.y - stroke.width / 2, width: box.width + stroke.width, height: box.height + stroke.width });
  });
  const elements = ready.elements.filter((element) => {
    const matrix = comicElementMatrix(element);
    return overlaps(panelBounds([[0, 0], [element.width, 0], [element.width, element.height], [0, element.height]].map(([x, y]) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }))));
  });
  const layerIds = new Set([...panels, ...strokes, ...elements].map((item) => item.layerId));
  return JSON.stringify({ id: page.id, layout: page.layout, layoutVersion: page.layoutVersion, width: page.width, height: page.height,
    layers: ready.layers.filter((layer) => layerIds.has(layer.id)), panels, strokes, elements, fonts: ready.fonts });
}

/**
 * 用完整整页图替换目标区的旧排版，保留新生成原图并让清理后的底图、文字可分别编辑。
 * @param {object} page 原漫画页，不会被原地修改。
 * @param {number} sectionId 目标分区编号。
 * @param {{dataUrl:string,width:number,height:number}} image 显示底图，可以是原图或去字后的图。
 * @param {object} options originalImage 为可选原图；taskId 关联同次生成；textElements 为页面坐标的文字元素。
 * @returns {object} 替换后的新页面；同一任务重建不会累积隐藏原图或文字。
 */
export function applyComicAIImage(page, sectionId, image, { originalImage, taskId = null, textElements = [] } = {}) {
  const ready = ensureComicLayers(page);
  const bounds = sectionBounds(page, sectionId);
  const overlaps = (box) => box.x < bounds.x + bounds.width && box.x + box.width > bounds.x && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y;
  const previousOriginal = ready.panels.find((panel) => panel.comicAISectionId === sectionId && panel.comicAIRole === 'original' && panel.comicAITaskId === taskId);
  const source = originalImage || previousOriginal?.image || image;
  const replacedLayerIds = new Set(ready.layers.filter((layer) => layer.comicAISectionId === sectionId).map((layer) => layer.id));
  const originalLayer = { id: createClientId(), kind: 'custom', name: 'AI 生成原图', visible: false, locked: true, comicAISectionId: sectionId, comicAIRole: 'original', comicAITaskId: taskId };
  const imageLayer = { ...originalLayer, id: createClientId(), name: 'AI 漫画底图', visible: true, locked: false, comicAIRole: 'image' };
  const textLayer = { ...imageLayer, id: createClientId(), name: 'AI 可编辑文字', comicAIRole: 'text' };
  const panels = ready.panels.filter((panel) => !replacedLayerIds.has(panel.layerId) && panel.section !== sectionId && !(panel.type === 'overlay' && overlaps(panelBounds(panel))));
  for (const [asset, layer] of [[source, originalLayer], [image, imageLayer]]) {
    const placement = comicAIImagePlacement(page, sectionId, asset);
    const { x, y, scale, width, height } = placement;
    panels.push({ id: createClientId(), type: 'regular', section: sectionId, layerId: layer.id, order: 0, borderWidth: 0, task: null,
      comicAISectionId: sectionId, comicAIRole: layer.comicAIRole, comicAITaskId: taskId,
      points: [{ x, y }, { x: x + width * scale, y }, { x: x + width * scale, y: y + height * scale }, { x, y: y + height * scale }],
      image: { dataUrl: asset.dataUrl, ...placement, rotation: 0 } });
  }
  const elements = ready.elements.filter((element) => {
    if (replacedLayerIds.has(element.layerId)) return false;
    const matrix = comicElementMatrix(element);
    return !overlaps(panelBounds([[0, 0], [element.width, 0], [element.width, element.height], [0, element.height]].map(([x, y]) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }))));
  });
  const strokes = ready.strokes.filter((stroke) => {
    if (replacedLayerIds.has(stroke.layerId)) return false;
    const box = panelBounds(stroke.points);
    return !overlaps({ x: box.x - stroke.width / 2, y: box.y - stroke.width / 2, width: box.width + stroke.width, height: box.height + stroke.width });
  });
  return { ...ready, updatedAt: Date.now(), panels, strokes,
    layers: [...ready.layers.filter((layer) => layer.comicAISectionId !== sectionId), originalLayer, imageLayer, textLayer],
    elements: [...elements, ...textElements.map((element, order) => ({ ...element, layerId: textLayer.id, order, comicAISectionId: sectionId, comicAIRole: 'text', comicAITaskId: taskId }))] };
}
