import { COMIC_LAYOUTS } from './comicDocument.mjs';
import { ensureComicLayers } from './comicLayers.mjs';
import { validateComicAIPlan } from './comicAI.mjs';

const FORMAT = 'novelai-comic-project';
const MANIFEST = 'comic-project.json';
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2' };

/**
 * 导出可继续编辑的漫画项目，素材去重后独立放进 assets，当前草稿覆盖包内同名页面。
 * @param {{pages:Array,templates:Array,draft:object}} library 当前页面库、自定义模板及正在编辑的页面。
 * @returns {Promise<Blob>} 带版本号、完整编辑数据和素材的 ZIP 项目包。
 */
export async function exportComicProject({ pages, templates, draft }) {
  const { default: JSZip } = await import('jszip');
  const archive = new JSZip();
  const assets = {};
  const embedded = new Map();
  const ordered = pages.map((page) => page.id === draft?.id ? draft : page);
  if (draft && !pages.some((page) => page.id === draft.id)) ordered.push(draft);

  async function pack(value) {
    if (typeof value === 'string' && value.startsWith('blob:')) {
      // 临时预览地址跨浏览器会失效，在导出时把内容变成永久素材。
      const response = await fetch(value);
      if (!response.ok) throw new Error('Unable to read a temporary comic asset.');
      const blob = await response.blob();
      const entry = await pack(blob);
      return { ...entry, type: 'data-url' };
    }
    if (value instanceof Blob || (typeof value === 'string' && /^data:[\w/+.-]+(?:;[^,]*)?,/.test(value))) {
      const isBlob = value instanceof Blob;
      const prefix = isBlob ? `data:${value.type || 'application/octet-stream'};base64` : value.slice(0, value.indexOf(','));
      const mime = prefix.slice(5).split(';')[0];
      let path = embedded.get(value);
      if (!path) {
        path = `assets/${String(embedded.size + 1).padStart(4, '0')}.${EXTENSIONS[mime] || 'bin'}`;
        if (isBlob) archive.file(path, await value.arrayBuffer());
        else {
          const payload = value.slice(value.indexOf(',') + 1);
          archive.file(path, /;base64$/i.test(prefix) ? payload : decodeURIComponent(payload), { base64: /;base64$/i.test(prefix) });
        }
        assets[path] = { mime, prefix };
        embedded.set(value, path);
      }
      return { $comicAsset: path, type: !isBlob ? 'data-url' : typeof File !== 'undefined' && value instanceof File ? 'file' : 'blob', ...(isBlob && value.name ? { name: value.name, lastModified: value.lastModified } : {}) };
    }
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) items.push(await pack(item));
      return items;
    }
    if (value && typeof value === 'object') {
      const entries = [];
      for (const [key, item] of Object.entries(value)) entries.push([key, await pack(item)]);
      return Object.fromEntries(entries);
    }
    return value;
  }

  const content = await pack({ pages: ordered.map((page, order) => ({ ...page, order })), templates, activePageId: draft?.id || ordered[0]?.id });
  archive.file(MANIFEST, JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), ...content, assets }, null, 2));
  return archive.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

// 项目文件是外部输入，写入浏览器前检查绘制必需的字段，坏包不会污染已有漫画库。
function validatePage(page, allowWorkflow = true) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const points = (value, minimum) => Array.isArray(value) && value.length >= minimum && value.every((point) => point && finite(point.x) && finite(point.y));
  const collection = (value) => Array.isArray(value) && value.every((item) => item && typeof item.id === 'string') && new Set(value.map((item) => item.id)).size === value.length;
  const image = (value) => typeof value === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(value);
  const legacySizes = { portrait: [800, 1120], landscape: [1120, 800], spreadPortrait: [1600, 1120], spreadLandscape: [1120, 1600] };
  const size = page?.layoutVersion === 2 ? [COMIC_LAYOUTS[page.layout]?.width, COMIC_LAYOUTS[page.layout]?.height] : legacySizes[page?.layout];
  if (!page || typeof page.id !== 'string' || typeof page.title !== 'string' || !Object.hasOwn(COMIC_LAYOUTS, page.layout) ||
    ![undefined, 1, 2].includes(page.layoutVersion) || page.width !== size?.[0] || page.height !== size?.[1] ||
    !collection(page.panels) || !collection(page.strokes) || !collection(page.elements) || !collection(page.layers) || !page.layers.length || !collection(page.fonts)) throw new Error('Invalid comic page.');
  const layers = new Set(page.layers.map((layer) => layer.id));
  if (page.layers.some((layer) => typeof layer.name !== 'string' || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') ||
    [...page.panels, ...page.strokes, ...page.elements].some((item) => !layers.has(item.layerId) || !finite(item.order))) throw new Error('Invalid comic layer.');
  for (const panel of page.panels) {
    if (!points(panel.points, 3) || !finite(panel.borderWidth) || !['regular', 'overlay'].includes(panel.type) || !Number.isInteger(panel.section)) throw new Error('Invalid comic frame.');
    if (panel.image && (!image(panel.image.dataUrl) || !['x', 'y', 'width', 'height', 'scale'].every((key) => finite(panel.image[key])) || (panel.image.rotation !== undefined && !finite(panel.image.rotation)))) throw new Error('Invalid comic image.');
    if (panel.task && (!panel.task.params?.parameterState?.params || !panel.task.params.promptsByModel || !Array.isArray(panel.task.params.vibeImages))) throw new Error('Invalid comic task.');
  }
  for (const stroke of page.strokes) if (!points(stroke.points, 1) || !finite(stroke.width) || typeof stroke.color !== 'string') throw new Error('Invalid comic stroke.');
  for (const element of page.elements) {
    if (!['bubble', 'sticker', 'text'].includes(element.kind) || !['x', 'y', 'width', 'height', 'rotation', 'skewX', 'skewY', 'opacity', 'feather', 'fontSize', 'lineHeight', 'strokeWidth'].every((key) => finite(element[key])) ||
      !points(element.mask, 3) || !['text', 'fontFamily', 'textAlign', 'fill', 'stroke', 'color'].every((key) => typeof element[key] === 'string') || (element.dataUrl && !image(element.dataUrl))) throw new Error('Invalid comic element.');
    if (element.balloonContours && (!Array.isArray(element.balloonContours) || element.balloonContours.some((contour) => !Array.isArray(contour) || contour.length < 3 || contour.some((node) => !['x', 'y', 'inX', 'inY', 'outX', 'outY'].every((key) => finite(node[key])))))) throw new Error('Invalid comic curve.');
  }
  for (const font of page.fonts) if (typeof font.family !== 'string' || typeof font.name !== 'string' || !/^data:font\/(ttf|otf|woff|woff2);base64,/.test(font.dataUrl)) throw new Error('Invalid comic font.');
  if (page.aiWorkflow !== undefined) {
    const workflow = page.aiWorkflow;
    if (!allowWorkflow || !workflow || workflow.version !== 1 || typeof workflow.id !== 'string'
      || !workflow.sourceInput || typeof workflow.sourceInput !== 'object' || !workflow.sections || typeof workflow.sections !== 'object' || Array.isArray(workflow.sections)) throw new Error('Invalid comic AI workflow.');
    if (workflow.plan != null) validateComicAIPlan(workflow.plan, { forGeneration: false });
    const input = workflow.sourceInput;
    if (['model', 'inputType', 'text', 'style', 'language', 'readingDirection'].some((key) => typeof input[key] !== 'string')
      || !['story', 'prompt'].includes(input.inputType) || !['ltr', 'rtl'].includes(input.readingDirection)
      || typeof input.characters !== 'string' || !Array.isArray(input.sections) || !input.sections.length || input.sections.length > 2) throw new Error('Invalid comic AI input.');
    for (const section of input.sections) {
      if (!Number.isInteger(section.id) || section.id < 0 || section.id >= COMIC_LAYOUTS[page.layout].sections
        || !((section.width === 832 && section.height === 1216) || (section.width === 1216 && section.height === 832)) || !Array.isArray(section.referencePanels)
        || section.referencePanels.some((panel) => typeof panel.id !== 'string' || !Number.isInteger(panel.number)
          || ![panel.width, panel.height, panel.center?.x, panel.center?.y].every((value) => finite(value) && value >= 0 && value <= 1))) throw new Error('Invalid comic AI reference panel.');
    }
    if (workflow.referenceSnapshot) validatePage(workflow.referenceSnapshot, false);
    for (const [id, state] of Object.entries(workflow.sections)) {
      if (!input.sections.some((section) => String(section.id) === id) || !state || typeof state.status !== 'string') throw new Error('Invalid comic AI state.');
      for (const key of ['originalImage', 'cleanedImage', 'maskImage']) {
        const asset = state[key];
        if (asset && (!image(asset.dataUrl) || !finite(asset.width) || asset.width <= 0 || !finite(asset.height) || asset.height <= 0)) throw new Error('Invalid comic AI image.');
      }
      if (state.assignments && (typeof state.assignments !== 'object' || Array.isArray(state.assignments) || Object.values(state.assignments).some((value) => value !== null && typeof value !== 'string'))) throw new Error('Invalid comic AI assignment.');
      if (state.result) {
        const result = state.result;
        if (!/^[a-f0-9]{64}$/.test(result.sourceHash) || !collection(result.blocks) || !Array.isArray(result.unmatchedDialogueIds)
          || result.unmatchedDialogueIds.some((value) => typeof value !== 'string')) throw new Error('Invalid comic AI text result.');
        for (const block of result.blocks) {
          if (!block.bounds || !['x', 'y', 'width', 'height'].every((key) => Number.isInteger(block.bounds[key]))
            || block.bounds.x < 0 || block.bounds.y < 0 || block.bounds.width <= 0 || block.bounds.height <= 0
            || !['horizontal-tb', 'vertical-rl'].includes(block.direction) || typeof block.ocrText !== 'string' || typeof block.text !== 'string'
            || (block.dialogueId !== null && typeof block.dialogueId !== 'string') || typeof block.needsReview !== 'boolean' || typeof block.applied !== 'boolean'
            || !/^#[a-f0-9]{6}$/i.test(block.color) || !finite(block.fontSize) || block.fontSize <= 0
            || !finite(block.confidence) || block.confidence < 0 || block.confidence > 1) throw new Error('Invalid comic AI text block.');
        }
      }
    }
  }
}

/**
 * 读取项目压缩包并恢复素材；只返回完整验证的数据，不改变当前漫画库。
 * @param {Blob|ArrayBuffer|Uint8Array} file 用户选择的项目 ZIP。
 * @returns {Promise<{pages:Array,templates:Array,activePageId:string}>} 按原顺序排列的完整编辑数据。
 */
export async function readComicProject(file) {
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(file instanceof Blob ? await file.arrayBuffer() : file, { checkCRC32: true });
  const entry = archive.file(MANIFEST);
  if (!entry) throw new Error('This is not an editable comic project.');
  const manifest = JSON.parse(await entry.async('string'));
  if (manifest.format !== FORMAT || manifest.version !== 1 || !Array.isArray(manifest.pages) || !manifest.pages.length || !Array.isArray(manifest.templates) || !manifest.assets) throw new Error('Unsupported comic project.');
  const assets = new Map();
  for (const [path, info] of Object.entries(manifest.assets)) {
    if (!/^assets\/\d+\.[a-z0-9]+$/.test(path) || !archive.file(path) || typeof info?.prefix !== 'string' || !/^data:[\w/+.-]+(?:;[^,]*)?$/.test(info.prefix) || typeof info.mime !== 'string') throw new Error('Missing or invalid comic asset.');
    const data = await archive.file(path).async('uint8array');
    const dataUrl = /;base64$/i.test(info.prefix) ? `${info.prefix},${await archive.file(path).async('base64')}` : `${info.prefix},${encodeURIComponent(new TextDecoder().decode(data))}`;
    assets.set(path, { data, dataUrl, mime: info.mime });
  }
  function unpack(value) {
    if (Array.isArray(value)) return value.map(unpack);
    if (value && typeof value === 'object') {
      if (Object.hasOwn(value, '$comicAsset')) {
        const asset = assets.get(value.$comicAsset);
        if (!asset) throw new Error('Missing comic asset.');
        if (value.type === 'data-url') return asset.dataUrl;
        if (value.type === 'file') return new File([asset.data], value.name, { type: asset.mime, lastModified: value.lastModified });
        if (value.type === 'blob') return new Blob([asset.data], { type: asset.mime });
        throw new Error('Invalid comic asset type.');
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
    }
    return value;
  }
  const pages = unpack(manifest.pages);
  pages.forEach((page) => validatePage(page));
  if (new Set(pages.map((page) => page.id)).size !== pages.length || !pages.some((page) => page.id === manifest.activePageId)) throw new Error('Invalid comic page order.');
  const templates = unpack(manifest.templates);
  for (const template of templates) if (!template || typeof template.id !== 'string' || typeof template.name?.zh !== 'string' || typeof template.name?.en !== 'string' || !Array.isArray(template.panels) || template.panels.some((panel) => !Number.isFinite(panel.borderWidth) || !Array.isArray(panel.points) || panel.points.length < 3 || panel.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) throw new Error('Invalid comic template.');
  return { pages: pages.map(ensureComicLayers), templates, activePageId: manifest.activePageId };
}
