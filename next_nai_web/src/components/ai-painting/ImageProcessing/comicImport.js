import { makeDocument, makeLayer, validateDocument } from './compositor/lib/model.js';
import { panelBounds } from '../ComicWorkspace/comicDocument.mjs';
import { comicElementMatrix, comicElementSvg, loadComicFonts } from '../ComicWorkspace/comicElements.mjs';
import { ensureComicLayers } from '../ComicWorkspace/comicLayers.mjs';

/**
 * 用漫画原有排版绘制可编辑文字，保留气泡、竖排、上传字体和局部蒙版。
 * @param {object} layer 由漫画导入的文字图层，文字及字号使用图像编辑器中的当前值。
 * @returns {Promise<string>} 可直接解码的内嵌 SVG 图像。
 */
export async function comicTextDataUrl(layer) {
  await loadComicFonts(layer.comicFonts);
  const svg = comicElementSvg({
    ...layer.comicText,
    width: layer.width,
    height: layer.height,
    text: layer.text,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    lineHeight: layer.lineHeight,
    textAlign: layer.align,
    color: layer.fill,
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    opacity: 1,
  }, { fonts: layer.comicFonts });
  const weighted = svg.replace('<text ', `<text font-weight="${layer.fontWeight === '700' ? '700' : '400'}" `);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(weighted)}`;
}

function tracePolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function drawingSurface(points, padding = 0) {
  const bounds = panelBounds(points);
  const left = Math.floor(bounds.x - padding), top = Math.floor(bounds.y - padding);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(bounds.x + bounds.width + padding) - left);
  canvas.height = Math.max(1, Math.ceil(bounds.y + bounds.height + padding) - top);
  const context = canvas.getContext('2d');
  context.translate(-left, -top);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  return { canvas, context, x: left, y: top, width: canvas.width, height: canvas.height };
}

/**
 * 将漫画页转换为独立图像文档，每个分镜、笔迹、气泡和贴纸保留为独立图层。
 * @param {Array<object>} pages 漫画库或已验证项目文件中的页面，可包含当前草稿。
 * @param {'zh'|'en'} language 未命名页面和图层使用的语言。
 * @returns {Promise<Array<object>>} 按输入顺序排列、可由图像编辑器打开的文档。
 */
export async function comicPagesToDocuments(pages, language = 'zh') {
  const labels = language === 'en'
    ? { page: 'Comic page', background: 'Background', panels: 'Panels', overlays: 'Overlays', dialogue: 'Dialogue', custom: 'Layer', panel: 'Panel', border: 'Border', stroke: 'Brush stroke', erase: 'Eraser', bubble: 'Balloon', sticker: 'Sticker', text: 'Text' }
    : { page: '漫画页', background: '背景', panels: '分镜', overlays: '叠加画框', dialogue: '对白', custom: '图层', panel: '分镜', border: '边框', stroke: '笔迹', erase: '橡皮', bubble: '气泡', sticker: '贴纸', text: '文字' };
  const documents = [];
  for (const [pageIndex, source] of pages.entries()) {
    const page = ensureComicLayers(source);
    await loadComicFonts(page.fonts);
    const converted = makeDocument({ name: page.title || `${labels.page} ${pageIndex + 1}`, width: page.width, height: page.height });
    converted.layers[0].name = labels.background;
    const items = [
      ...page.panels.map((item, index) => ({ kind: 'panel', item, index })),
      ...page.strokes.map((item, index) => ({ kind: 'stroke', item, index })),
      ...page.elements.map((item, index) => ({ kind: 'element', item, index })),
    ];

    for (const comicLayer of page.layers) {
      const group = makeLayer('group', { name: comicLayer.name || labels[comicLayer.kind] || labels.custom, width: page.width, height: page.height, visible: comicLayer.visible, locked: comicLayer.locked });
      converted.layers.push(group);
      for (const { kind, item, index } of items.filter(({ item }) => item.layerId === comicLayer.id).sort((first, second) => first.item.order - second.item.order)) {
        const common = { parentId: group.id, locked: comicLayer.locked };
        if (kind === 'panel') {
          const name = `${labels.panel} ${index + 1}`;
          if (item.image) {
            const image = item.image;
            const width = image.width * image.scale, height = image.height * image.scale;
            const centerX = image.x + width / 2, centerY = image.y + height / 2;
            const angle = (image.rotation || 0) * Math.PI / 180;
            const mask = document.createElement('canvas');
            mask.width = image.width;
            mask.height = image.height;
            const context = mask.getContext('2d');
            // 蒙版跟随原始图片坐标，保留框外像素，导入后仍可继续调整裁剪。
            tracePolygon(context, item.points.map((point) => ({
              x: ((point.x - centerX) * Math.cos(angle) + (point.y - centerY) * Math.sin(angle)) / image.scale + image.width / 2,
              y: (-(point.x - centerX) * Math.sin(angle) + (point.y - centerY) * Math.cos(angle)) / image.scale + image.height / 2,
            })));
            context.fillStyle = '#ffffff';
            context.fill();
            converted.layers.push(makeLayer('raster', { ...common, name, src: image.dataUrl, x: image.x, y: image.y, width, height, rotation: image.rotation || 0, mask: mask.toDataURL('image/png') }));
          }
          if (item.borderWidth > 0) {
            const { canvas, context, ...bounds } = drawingSurface(item.points, item.borderWidth / 2 + 1);
            tracePolygon(context, item.points);
            context.strokeStyle = '#111111';
            context.lineWidth = item.borderWidth;
            context.stroke();
            converted.layers.push(makeLayer('raster', { ...common, ...bounds, name: `${name} · ${labels.border}`, src: canvas.toDataURL('image/png') }));
          }
          continue;
        }
        if (kind === 'stroke') {
          const { canvas, context, ...bounds } = drawingSurface(item.points, item.width / 2 + 1);
          const color = item.kind === 'erase' ? '#ffffff' : item.color;
          context.beginPath();
          if (item.points.length === 1) {
            context.arc(item.points[0].x, item.points[0].y, item.width / 2, 0, Math.PI * 2);
            context.fillStyle = color;
            context.fill();
          } else {
            context.moveTo(item.points[0].x, item.points[0].y);
            for (const point of item.points.slice(1)) context.lineTo(point.x, point.y);
            context.strokeStyle = color;
            context.lineWidth = item.width;
            context.stroke();
          }
          converted.layers.push(makeLayer('raster', { ...common, ...bounds, name: `${item.kind === 'erase' ? labels.erase : labels.stroke} ${index + 1}`, src: canvas.toDataURL('image/png') }));
          continue;
        }

        const name = item.name || `${labels[item.kind]} ${index + 1}`;
        const geometry = { x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation, flipX: item.flipX, flipY: item.flipY, opacity: item.opacity };
        const fonts = page.fonts.filter((font) => font.family === item.fontFamily);
        if (!item.skewX && !item.skewY && (item.kind !== 'sticker' || item.text)) {
          converted.layers.push(makeLayer('text', {
            ...common, ...geometry, name,
            text: item.text, fontFamily: item.fontFamily, fontSize: item.fontSize, lineHeight: item.lineHeight, align: item.textAlign, fontWeight: '400', fill: item.color, stroke: item.stroke, strokeWidth: item.strokeWidth,
            comicText: { ...item, opacity: 1 }, comicFonts: fonts,
          }));
          continue;
        }

        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(comicElementSvg({ ...item, opacity: 1 }, { fonts }))}`;
        await image.decode();
        if (item.skewX || item.skewY) {
          const matrix = comicElementMatrix(item);
          const corners = [[0, 0], [item.width, 0], [item.width, item.height], [0, item.height]].map(([localX, localY]) => ({ x: matrix[0] * localX + matrix[2] * localY + matrix[4], y: matrix[1] * localX + matrix[3] * localY + matrix[5] }));
          const { canvas, context, ...bounds } = drawingSurface(corners, 1);
          context.transform(...matrix);
          context.drawImage(image, 0, 0, item.width, item.height);
          converted.layers.push(makeLayer('raster', { ...common, ...bounds, name, opacity: item.opacity, src: canvas.toDataURL('image/png') }));
        } else {
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(item.width);
          canvas.height = Math.ceil(item.height);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          converted.layers.push(makeLayer('raster', { ...common, ...geometry, name, src: canvas.toDataURL('image/png') }));
        }
      }
    }
    documents.push(validateDocument(converted));
  }
  return documents;
}
