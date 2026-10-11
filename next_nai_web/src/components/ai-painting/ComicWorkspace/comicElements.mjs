import { createClientId } from '../../../utils/browserCapabilities.mjs';
import { comicBalloonContours, comicBalloonPath } from './comicBalloonPaths.mjs';

const FULL_MASK = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const loadedFonts = new Map();
let textMeasureContext;

export const COMIC_BALLOON_PRESETS = [
  { id: 'speech', name: { zh: '对白', en: 'Speech' }, textBox: [0.16, 0.14, 0.68, 0.56] },
  { id: 'speech-right', name: { zh: '右侧对白', en: 'Right speech' }, textBox: [0.16, 0.14, 0.68, 0.56] },
  { id: 'ellipse', name: { zh: '椭圆', en: 'Oval' }, textBox: [0.16, 0.2, 0.68, 0.6] },
  { id: 'round-box', name: { zh: '圆角对白', en: 'Rounded speech' }, textBox: [0.13, 0.14, 0.74, 0.55] },
  { id: 'caption', name: { zh: '旁白方框', en: 'Caption' }, textBox: [0.1, 0.12, 0.8, 0.76] },
  { id: 'thought', name: { zh: '思考', en: 'Thought' }, textBox: [0.2, 0.15, 0.6, 0.5] },
  { id: 'cloud', name: { zh: '云朵', en: 'Cloud' }, textBox: [0.2, 0.2, 0.6, 0.6] },
  { id: 'shout', name: { zh: '喊叫', en: 'Shout' }, textBox: [0.22, 0.23, 0.56, 0.54] },
  { id: 'impact', name: { zh: '爆发', en: 'Impact' }, textBox: [0.24, 0.26, 0.52, 0.48] },
  { id: 'whisper', name: { zh: '悄悄话', en: 'Whisper' }, textBox: [0.16, 0.14, 0.68, 0.56] },
  { id: 'speed', name: { zh: '速度线', en: 'Speed lines' }, textBox: [0.24, 0.24, 0.52, 0.52] },
  { id: 'electric', name: { zh: '电波', en: 'Electric' }, textBox: [0.2, 0.18, 0.6, 0.54] },
  { id: 'jaggy-small', name: { zh: '尖角窄框', en: 'Narrow jagged' }, textBox: [0.25, 0.2, 0.5, 0.6], aspectRatio: 0.72 },
  { id: 'jaggy-wide', name: { zh: '弧边尖角', en: 'Curved jagged' }, textBox: [0.2, 0.22, 0.6, 0.56], aspectRatio: 0.9 },
  { id: 'vibration', name: { zh: '颤抖波纹', en: 'Trembling' }, textBox: [0.2, 0.17, 0.6, 0.66], aspectRatio: 0.78 },
  { id: 'mumble', name: { zh: '喃喃细语', en: 'Mumble' }, textBox: [0.24, 0.14, 0.52, 0.72], aspectRatio: 0.48 },
  { id: 'announcement', name: { zh: '宣告', en: 'Announcement' }, textBox: [0.24, 0.25, 0.52, 0.51], aspectRatio: 0.95 },
  { id: 'whisper-oval', name: { zh: '虚线低语', en: 'Dotted whisper' }, textBox: [0.2, 0.15, 0.6, 0.7], aspectRatio: 0.7 },
  { id: 'burst-fine', name: { zh: '细芒爆发', en: 'Fine burst' }, textBox: [0.35, 0.35, 0.3, 0.3], aspectRatio: 1 },
  { id: 'jagged-star', name: { zh: '不规则锯齿', en: 'Jagged star' }, textBox: [0.24, 0.24, 0.52, 0.52], aspectRatio: 1 },
  { id: 'speed-oval', name: { zh: '椭圆集中线', en: 'Oval focus lines' }, textBox: [0.28, 0.26, 0.44, 0.48], aspectRatio: 0.85 },
];

/**
 * 创建独立的对白框、贴纸或文字，所有几何使用页面坐标。
 * @param {'bubble'|'sticker'|'text'} kind 元素类型。
 * @param {{x:number,y:number,width:number,height:number}} bounds 元素位置和大小。
 * @param {object} options 素材、图层、文字及样式；同名字段覆盖默认值。
 * @returns {object} 可直接放入 page.elements 的元素。
 */
export function createComicElement(kind, bounds, options = {}) {
  return {
    id: createClientId(), kind, name: '', layerId: '', order: 0,
    ...bounds, rotation: 0, skewX: 0, skewY: 0, flipX: false, flipY: false, opacity: 1,
    presetId: kind === 'bubble' ? 'speech' : null, dataUrl: null, text: '',
    fontFamily: 'sans-serif', fontSize: 28, textAlign: 'center', writingMode: 'horizontal-tb', lineHeight: 1.25,
    color: '#111111', fill: kind === 'bubble' ? '#ffffff' : 'none', stroke: '#111111', strokeWidth: kind === 'bubble' ? 2 : 0, feather: 0,
    ...options, mask: (options.mask || FULL_MASK).map((point) => ({ ...point })),
  };
}

/**
 * 获取元素局部坐标到页面坐标的矩阵，预览、选框及 Canvas 导出共用。
 * @param {object} element 元素；旋转和倾斜单位为度，镜像以元素中心为轴。
 * @returns {number[]} SVG matrix 与 Canvas transform 通用的 [a,b,c,d,e,f]。
 */
export function comicElementMatrix(element) {
  const radians = Math.PI / 180;
  const cosine = Math.cos(element.rotation * radians), sine = Math.sin(element.rotation * radians);
  const skewX = Math.tan(element.skewX * radians), skewY = Math.tan(element.skewY * radians);
  const flipX = element.flipX ? -1 : 1, flipY = element.flipY ? -1 : 1;
  const a = flipX * (cosine * (1 + skewX * skewY) - sine * skewY);
  const b = flipX * (sine * (1 + skewX * skewY) + cosine * skewY);
  const c = flipY * (cosine * skewX - sine), d = flipY * (sine * skewX + cosine);
  return [a, b, c, d, element.x + element.width / 2 - a * element.width / 2 - c * element.height / 2, element.y + element.height / 2 - b * element.width / 2 - d * element.height / 2];
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function balloonShape(element, presetId) {
  const contours = element.balloonContours || comicBalloonContours(presetId);
  const dash = presetId === 'whisper' ? ' stroke-dasharray="4 3"' : presetId === 'whisper-oval' ? ' stroke-dasharray="1 3" stroke-linecap="round"' : '';
  const outlines = contours.map((contour) => `<path d="${comicBalloonPath(contour)}" vector-effect="non-scaling-stroke"${dash} />`).join('');
  if (presetId !== 'speed' && presetId !== 'speed-oval') return outlines;
  // 每条线由宽底逐渐收尖，角度、长短和粗细固定但不均匀，预览与导出不会随机变化。
  const rays = Array.from({ length: 84 }, (_, index) => {
    const varied = (Math.sin(index * 12.9898 + 7.23) + 1) / 2;
    const angle = (index + varied * 0.55) * Math.PI * 2 / 84;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const edge = presetId === 'speed' ? 50 / Math.max(Math.abs(cosine), Math.abs(sine)) : 48;
    const length = 0.24 + ((Math.sin(index * 4.73) + 1) / 2) * 0.38;
    const tip = edge * (1 - length), base = (0.12 + varied * 0.75) * element.strokeWidth / 2;
    const x = 50 + cosine * (edge + 2), y = 50 + sine * (edge + 2);
    return `<path d="M ${x - sine * base} ${y + cosine * base} L ${50 + cosine * tip} ${50 + sine * tip} L ${x + sine * base} ${y - cosine * base} Z" />`;
  }).join('');
  const clip = `<defs><clipPath id="balloon-rays">${contours.map((contour) => `<path d="${comicBalloonPath(contour)}" />`).join('')}</clipPath></defs>`;
  return `${outlines}${clip}<g clip-path="url(#balloon-rays)" fill="${escapeXml(element.stroke)}" stroke="none">${rays}</g>`;
}

function wrapText(text, width, fontSize, fontFamily) {
  if (!textMeasureContext && typeof document !== 'undefined') textMeasureContext = document.createElement('canvas').getContext('2d');
  const family = fontFamily.replace(/["\\]/g, '');
  if (textMeasureContext) textMeasureContext.font = `${fontSize}px ${['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].includes(family) ? family : `"${family}"`}, sans-serif`;
  // 服务端预渲染没有 Canvas；浏览器预览和最终导出均用已加载字体的真实字宽。
  const measure = textMeasureContext ? (value) => textMeasureContext.measureText(value).width : (value) => Array.from(value).reduce((sum, character) => sum + (/[^\x00-\xff]/.test(character) ? 1 : 0.6) * fontSize, 0);
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.match(/\S+\s*|\s+/gu) || []) {
      if (line && measure(line + word) > width) { lines.push(line.trimEnd()); line = ''; }
      for (const character of Array.from(line ? word : word.trimStart())) {
        if (line && measure(line + character) > width) { lines.push(line.trimEnd()); line = ''; }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * 生成完整的局部 SVG。坐标为 0..width/height；页面变换由 comicElementMatrix 处理。
 * @param {object} element 元素，蒙版使用 0..1 四角坐标，feather 为局部像素。
 * @param {{fonts?:Array}} options 页面上传字体；调用前应 await loadComicFonts(fonts)。
 * @returns {string} 可作为 image 的 data URL 源或由 Canvas 解码的 SVG 文本。
 */
export function comicElementSvg(element, { fonts = [] } = {}) {
  const { width, height, fontSize, fontFamily } = element;
  const font = fonts.find((item) => item.family === fontFamily);
  const fontCss = font ? `<style>@font-face{font-family:"${escapeXml(font.family.replace(/["\\]/g, ''))}";src:url("${escapeXml(font.dataUrl)}")}</style>` : '';
  const preset = COMIC_BALLOON_PRESETS.find((item) => item.id === element.presetId) || COMIC_BALLOON_PRESETS[0];
  let content = '';
  if (element.dataUrl) {
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(element.dataUrl)) throw new Error('Only embedded image assets are supported.');
    content = `<image href="${escapeXml(element.dataUrl)}" width="${width}" height="${height}" preserveAspectRatio="none" />`;
  } else if (element.kind === 'bubble') {
    content = `<svg width="${width}" height="${height}" viewBox="0 0 100 100" preserveAspectRatio="none"><g fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}" stroke-linejoin="round">${balloonShape(element, preset.id)}</g></svg>`;
  } else if (element.kind === 'text' && element.fill !== 'none') {
    content = `<rect width="${width}" height="${height}" fill="${escapeXml(element.fill)}" />`;
  }
  if (element.text) {
    const textBox = element.kind === 'bubble' && !element.dataUrl ? preset.textBox : [0.04, 0.04, 0.92, 0.92];
    const left = width * textBox[0], top = height * textBox[1], availableWidth = width * textBox[2], availableHeight = height * textBox[3];
    const lineHeight = fontSize * element.lineHeight;
    const anchor = element.textAlign === 'left' ? 'start' : element.textAlign === 'right' ? 'end' : 'middle';
    const vertical = element.writingMode === 'vertical-rl';
    let spans;
    if (vertical) {
      // 竖排每字占一格，换行另起一列；按字素分段避免拆开组合字符或表情。
      const capacity = Math.max(1, Math.floor(availableHeight / fontSize));
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const columns = element.text.replace(/\r\n?/g, '\n').split('\n').flatMap((paragraph) => {
        const characters = Array.from(segmenter.segment(paragraph), ({ segment }) => segment);
        return Array.from({ length: Math.max(1, Math.ceil(characters.length / capacity)) }, (_, index) => characters.slice(index * capacity, (index + 1) * capacity).join(''));
      });
      const x = left + availableWidth / 2 + (columns.length - 1) * lineHeight / 2;
      const y = element.textAlign === 'left' ? top : element.textAlign === 'right' ? top + availableHeight : top + availableHeight / 2;
      spans = columns.map((column, index) => `<tspan x="${x - index * lineHeight}" y="${y}" xml:space="preserve">${escapeXml(column)}</tspan>`).join('');
    } else {
      const lines = wrapText(element.text, availableWidth, fontSize, fontFamily);
      const baseline = top + (availableHeight - lines.length * lineHeight) / 2 + (lineHeight + fontSize * 0.72) / 2;
      const x = element.textAlign === 'left' ? left : element.textAlign === 'right' ? left + availableWidth : left + availableWidth / 2;
      spans = lines.map((line, index) => `<tspan x="${x}" y="${baseline + index * lineHeight}" xml:space="preserve">${escapeXml(line)}</tspan>`).join('');
    }
    content += `<text fill="${escapeXml(element.color)}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" text-anchor="${anchor}"${vertical ? ' writing-mode="vertical-rl" dominant-baseline="central" style="text-orientation:upright"' : ''}${element.kind === 'text' ? ` stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}" paint-order="stroke" stroke-linejoin="round"` : ''}>${spans}</text>`;
  }
  const maskPoints = element.mask.map((point) => `${point.x * width},${point.y * height}`).join(' ');
  const feather = Math.max(0, element.feather);
  // 羽化只改变可见轮廓的 alpha。先提取轮廓，避免半透明素材内部被重复乘低透明度；原图颜色与细节不模糊。
  const filter = feather ? `<filter id="feather" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feComponentTransfer in="SourceAlpha" result="shape"><feFuncA type="discrete" tableValues="0 ${Array(255).fill(1).join(' ')}" /></feComponentTransfer><feMorphology in="shape" operator="erode" radius="${feather / 2}" result="inner" /><feGaussianBlur in="inner" stdDeviation="${feather / 3}" result="soft" /><feComposite in="SourceGraphic" in2="soft" operator="in" /></filter>` : '';
  return `<svg xmlns="${SVG_NAMESPACE}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${fontCss}<defs><clipPath id="crop"><polygon points="${maskPoints}" /></clipPath>${filter}</defs><g opacity="${element.opacity}"${feather ? ' filter="url(#feather)"' : ''}><g clip-path="url(#crop)">${content}</g></g></svg>`;
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
}

const SVG_TAGS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'symbol', 'use', 'title', 'desc', 'text', 'tspan', 'style', 'filter', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feBlend', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feMorphology', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA']);
const SVG_ATTRIBUTES = new Set(['id', 'class', 'style', 'xmlns', 'xmlns:xlink', 'xml:space', 'version', 'viewBox', 'preserveAspectRatio', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color', 'clip-path', 'clip-rule', 'clipPathUnits', 'mask', 'maskUnits', 'maskContentUnits', 'mask-type', 'filter', 'filterUnits', 'primitiveUnits', 'color-interpolation-filters', 'vector-effect', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity', 'fx', 'fy', 'fr', 'patternUnits', 'patternContentUnits', 'patternTransform', 'href', 'xlink:href', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'dy', 'dx', 'rotate', 'textLength', 'lengthAdjust', 'display', 'visibility', 'paint-order', 'in', 'in2', 'result', 'type', 'values', 'mode', 'operator', 'k1', 'k2', 'k3', 'k4', 'stdDeviation', 'radius', 'flood-color', 'flood-opacity', 'tableValues', 'slope', 'intercept', 'amplitude', 'exponent']);
const SVG_STYLE_PROPERTIES = new Set(['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color', 'clip-path', 'clip-rule', 'mask', 'mask-type', 'filter', 'color-interpolation-filters', 'vector-effect', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'display', 'visibility', 'paint-order', 'transform', 'transform-origin']);

function validateSvgValue(value) {
  if (/[\\@<>]|javascript\s*:|expression\s*\(/i.test(value)) throw new Error('SVG contains unsupported or unsafe content.');
  for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
    if (!/^\s*['"]?#[\w.:-]+['"]?\s*$/.test(match[1])) throw new Error('SVG external resources are not allowed.');
  }
}

function validateSvgStyle(style) {
  validateSvgValue(style);
  for (const declaration of style.split(';').filter((item) => item.trim())) {
    const colon = declaration.indexOf(':');
    if (colon < 0 || !SVG_STYLE_PROPERTIES.has(declaration.slice(0, colon).trim().toLowerCase())) throw new Error('SVG contains an unsupported style.');
  }
}

/**
 * 读取 PNG/WebP/JPEG 或安全 SVG，保留透明通道；SVG 仅以隔离的 image 数据源使用。
 * @param {File} file 用户选择的素材文件。
 * @returns {Promise<{dataUrl:string,width:number,height:number,name:string}>} 可传入 createComicElement 的素材数据。
 */
export async function readComicAsset(file) {
  const extension = file.name.split('.').at(-1).toLowerCase();
  const mime = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }[extension];
  if (!mime) throw new Error('Choose a PNG, WebP, JPEG, or SVG image.');
  let blob = file;
  if (mime === 'image/svg+xml') {
    const source = await file.text();
    if (/<!DOCTYPE|<!ENTITY|<\?(?!xml[\s?])/i.test(source)) throw new Error('SVG document declarations are not allowed.');
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = document.documentElement;
    if (document.querySelector('parsererror') || root.localName !== 'svg') throw new Error('Invalid SVG image.');
    // 删除编辑器附带的非显示元数据，其余节点和样式均逐项校验，禁止脚本、外链和 HTML。
    for (const metadata of root.querySelectorAll('metadata')) metadata.remove();
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if ((node.namespaceURI && node.namespaceURI !== SVG_NAMESPACE) || !SVG_TAGS.has(node.localName)) throw new Error('SVG contains unsupported or unsafe content.');
      for (const attribute of [...node.attributes]) {
        if (/^on/i.test(attribute.name)) throw new Error('SVG event handlers are not allowed.');
        if (attribute.name === 'href' || attribute.name === 'xlink:href') {
          if (!/^#[\w.:-]+$/.test(attribute.value)) throw new Error('SVG external resources are not allowed.');
        } else if (attribute.name === 'style') validateSvgStyle(attribute.value);
        else if (!attribute.name.startsWith('xmlns')) validateSvgValue(attribute.value);
        if (!SVG_ATTRIBUTES.has(attribute.name)) node.removeAttributeNode(attribute);
      }
      if (node.localName === 'style') {
        const css = node.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
        const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
        if (css.replace(/([^{}]+)\{([^{}]*)\}/g, '').trim()) throw new Error('SVG contains an unsupported stylesheet.');
        for (const [, selector, declarations] of rules) {
          if (!/^[\w\s.#,*+>:\[\]="'-]+$/.test(selector)) throw new Error('SVG contains an unsupported selector.');
          validateSvgStyle(declarations);
        }
      }
    }
    root.setAttribute('xmlns', SVG_NAMESPACE);
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
      if (!root.hasAttribute('width') || root.getAttribute('width').endsWith('%')) root.setAttribute('width', viewBox[2]);
      if (!root.hasAttribute('height') || root.getAttribute('height').endsWith('%')) root.setAttribute('height', viewBox[3]);
    }
    blob = new Blob([new XMLSerializer().serializeToString(root)], { type: mime });
  } else if (file.type !== mime) blob = new Blob([file], { type: mime });
  const dataUrl = await fileDataUrl(blob);
  const image = new Image(); image.src = dataUrl; await image.decode();
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight, name: file.name.replace(/\.[^.]+$/, '') };
}

/**
 * 加载并注册页面字体，完成后 Canvas 字宽测量和编辑器可立即使用这些字体。
 * @param {Array<{id:string,family:string,name:string,dataUrl:string}>} fonts 页面持久化的字体列表。
 * @returns {Promise<void>} 所有字体已加载；坏字体会明确拒绝而不是静默替换。
 */
export async function loadComicFonts(fonts = []) {
  await Promise.all(fonts.map((font) => {
    if (!loadedFonts.has(font.family)) {
      const promise = new FontFace(font.family, `url("${font.dataUrl}")`).load().then((face) => { document.fonts.add(face); });
      loadedFonts.set(font.family, promise);
      promise.catch(() => { loadedFonts.delete(font.family); });
    }
    return loadedFonts.get(font.family);
  }));
}

/**
 * 读取并验证字体文件，为页面生成独立字族名，避免覆盖系统或其他页面的字体。
 * @param {File} file TTF、OTF、WOFF 或 WOFF2 文件。
 * @returns {Promise<{id:string,family:string,name:string,dataUrl:string}>} 已加载、可保存的字体。
 */
export async function readComicFont(file) {
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!['ttf', 'otf', 'woff', 'woff2'].includes(extension)) throw new Error('Choose a TTF, OTF, WOFF, or WOFF2 font.');
  const id = createClientId();
  const font = { id, family: `comic-font-${id}`, name: file.name.replace(/\.[^.]+$/, ''), dataUrl: await fileDataUrl(new Blob([file], { type: `font/${extension}` })) };
  await loadComicFonts([font]);
  return font;
}
