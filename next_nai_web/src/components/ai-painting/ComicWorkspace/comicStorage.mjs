import { createClientId } from '../../../utils/browserCapabilities.mjs';
import { ensureComicLayers, getComicRenderItems } from './comicLayers.mjs';
import { comicElementMatrix, comicElementSvg, loadComicFonts } from './comicElements.mjs';

let databasePromise;

function openComicDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('novelai-comic-workspace', 1);
      request.onupgradeneeded = () => {
        for (const name of ['pages', 'templates', 'drafts']) request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          databasePromise = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        databasePromise = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        databasePromise = undefined;
        reject(new Error('Close other comic editor tabs to update the comic library.'));
      };
    });
  }
  return databasePromise;
}

// 等事务真正提交后才显示保存成功，避免浏览器配额不足时误报。
async function writeRecord(storeName, operation, value) {
  const database = await openComicDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName)[operation](value);
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(transaction.error || new Error('Comic library transaction aborted.'));
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * 读取当前浏览器的漫画库，已保存页面按手动顺序排列。
 * @returns {Promise<{pages:Array,templates:Array,draft:object|null}>} 漫画页、自定义模板和上次草稿。
 */
export async function loadComicLibrary() {
  const database = await openComicDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['pages', 'templates', 'drafts'], 'readonly');
    const pages = transaction.objectStore('pages').getAll();
    const templates = transaction.objectStore('templates').getAll();
    const draft = transaction.objectStore('drafts').get('current');
    transaction.oncomplete = () => resolve({
      pages: pages.result.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt).map(ensureComicLayers),
      templates: templates.result.sort((a, b) => a.createdAt - b.createdAt),
      draft: draft.result?.page ? ensureComicLayers(draft.result.page) : null,
    });
    transaction.onabort = () => reject(transaction.error || new Error('Comic library transaction aborted.'));
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * 暂存正在编辑的完整页面，刷新后可继续编辑。
 * @param {object|null} page 当前页面，null 表示清除草稿。
 * @returns {Promise<void>} 草稿事务提交后完成。
 */
export async function saveComicDraft(page) {
  await writeRecord('drafts', 'put', { id: 'current', page: page ? ensureComicLayers(page) : null });
}

/**
 * 保存漫画页，新页面放到列表末尾；传入 order 可调整已有页顺序。
 * @param {object} page 页面及可选的 order 顺序号。
 * @returns {Promise<object>} 含最终顺序号和保存时间的页面。
 */
export async function saveComicPage(page) {
  const database = await openComicDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('pages', 'readwrite');
    const store = transaction.objectStore('pages');
    const request = store.getAll();
    let saved;
    request.onsuccess = () => {
      const existing = request.result.find((item) => item.id === page.id);
      const order = page.order ?? existing?.order ?? Math.max(-1, ...request.result.map((item) => item.order)) + 1;
      saved = { ...ensureComicLayers(page), order, updatedAt: Date.now() };
      store.put(saved);
    };
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = () => reject(transaction.error || new Error('Comic page save aborted.'));
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * 从当前浏览器漫画库移除一个已保存页面。
 * @param {string} id 要删除的页面编号。
 * @returns {Promise<void>} 删除事务提交后完成。
 */
export async function deleteComicPage(id) {
  await writeRecord('pages', 'delete', id);
}

/**
 * 保存只有画框形状的自定义模板，供单页或跨页套用。
 * @param {object} template createComicTemplate 创建的模板。
 * @returns {Promise<object>} 已保存的模板。
 */
export async function saveComicTemplate(template) {
  return writeRecord('templates', 'put', template);
}

/**
 * 从当前浏览器移除一个自定义模板。
 * @param {string} id 要删除的模板编号。
 * @returns {Promise<void>} 删除事务提交后完成。
 */
export async function deleteComicTemplate(id) {
  await writeRecord('templates', 'delete', id);
}

/**
 * 将已验证的项目作为新副本一次性导入，保留原漫画库和导入前尚未保存的页面。
 * @param {{pages:Array,templates:Array,activePageId:string}} project 完整项目编辑数据。
 * @param {object|null} currentPage 导入前需要保留的当前草稿。
 * @returns {Promise<{pages:Array,templates:Array,draft:object}>} 事务提交后的漫画库及打开的导入页面。
 */
export async function importComicProject(project, currentPage = null) {
  const database = await openComicDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['pages', 'templates', 'drafts'], 'readwrite');
    const pageStore = transaction.objectStore('pages');
    const templateStore = transaction.objectStore('templates');
    const existingPages = pageStore.getAll();
    const existingTemplates = templateStore.getAll();
    let result;
    existingTemplates.onsuccess = () => {
      const pages = existingPages.result.sort((a, b) => a.order - b.order);
      let nextOrder = Math.max(-1, ...pages.map((page) => page.order)) + 1;
      if (currentPage) {
        const index = pages.findIndex((page) => page.id === currentPage.id);
        const saved = { ...ensureComicLayers(currentPage), order: index < 0 ? nextOrder++ : pages[index].order, updatedAt: Date.now() };
        if (index < 0) pages.push(saved); else pages[index] = saved;
        pageStore.put(saved);
      }
      let draft;
      for (const page of project.pages) {
        // 新页面编号避免重复导入覆盖原作，也不会接收旧页面尚未结束的生成结果。
        const copy = { ...page, id: createClientId(), order: nextOrder++, updatedAt: Date.now() };
        pages.push(copy); pageStore.add(copy);
        if (page.id === project.activePageId) draft = copy;
      }
      const templates = [...existingTemplates.result];
      for (const template of project.templates) {
        const copy = { ...template, id: createClientId() };
        templates.push(copy); templateStore.add(copy);
      }
      transaction.objectStore('drafts').put({ id: 'current', page: draft });
      result = { pages, templates, draft };
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error('Comic project import aborted.'));
    transaction.onerror = () => reject(transaction.error);
  });
}

function tracePanel(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

async function paintPanel(context, panel) {
  context.save();
  tracePanel(context, panel.points);
  context.clip();
  if (panel.image) {
    const source = panel.image;
    const image = await new Promise((resolve, reject) => {
      const loaded = new Image();
      loaded.onload = () => resolve(loaded);
      loaded.onerror = () => reject(new Error('Unable to load a comic panel image.'));
      loaded.src = source.dataUrl;
    });
    const width = source.width * source.scale, height = source.height * source.scale;
    context.translate(source.x + width / 2, source.y + height / 2);
    context.rotate((source.rotation || 0) * Math.PI / 180);
    context.drawImage(image, -width / 2, -height / 2, width, height);
  }
  context.restore();
  if (panel.borderWidth > 0) {
    tracePanel(context, panel.points);
    context.strokeStyle = '#111111';
    context.lineWidth = panel.borderWidth;
    context.stroke();
  }
}

/**
 * 以编辑器同样的绝对坐标、裁剪和图层顺序绘制漫画页。
 * @param {object} page 漫画页，图像必须是已载入的 data URL。
 * @returns {Promise<HTMLCanvasElement>} 原始页面分辨率的白底画布。
 */
export async function renderComicPage(page) {
  const ready = ensureComicLayers(page);
  await loadComicFonts(ready.fonts);
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, page.width, page.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const { kind, item } of getComicRenderItems(ready)) {
    if (kind === 'panel') {
      await paintPanel(context, item);
      continue;
    }
    if (kind === 'element') {
      const image = await new Promise((resolve, reject) => {
        const loaded = new Image();
        loaded.onload = () => resolve(loaded);
        loaded.onerror = () => reject(new Error('Unable to load a comic element.'));
        loaded.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(comicElementSvg(item, { fonts: ready.fonts }))}`;
      });
      context.save();
      context.transform(...comicElementMatrix(item));
      context.drawImage(image, 0, 0, item.width, item.height);
      context.restore();
      continue;
    }
    const stroke = item;
    // 橡皮作为可排序的白色笔迹，页面、预览和导出保持相同覆盖结果。
    const color = stroke.kind === 'erase' ? '#ffffff' : stroke.color;
    if (stroke.points.length === 1) {
      context.beginPath();
      context.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      context.strokeStyle = color;
      context.lineWidth = stroke.width;
      context.stroke();
    }
  }
  return canvas;
}

/**
 * 按传入的漫画页顺序导出 PNG 压缩包，文件名从 001.png 开始。
 * @param {Array} pages 按用户阅读顺序排列的已保存漫画页。
 * @returns {Promise<Blob>} 可通过下载链接保存的 ZIP 文件。
 */
export async function exportComicZip(pages) {
  const { default: JSZip } = await import('jszip');
  const archive = new JSZip();
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await renderComicPage(pages[index]);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Unable to export a comic page.')), 'image/png');
    });
    archive.file(`${String(index + 1).padStart(3, '0')}.png`, await blob.arrayBuffer());
  }
  return archive.generateAsync({ type: 'blob', compression: 'STORE' });
}
