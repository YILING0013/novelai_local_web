import { createClientId } from '@/utils/browserCapabilities.mjs';
import { sha256 } from '../utils/cryptoUtils';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';

let database;
const fields = ['width', 'height', 'model', 'prompt', 'seed', 'filename', 'galleryParameters', 'isComposited', 'isGenerationResult', 'version'];

/** 打开工作区历史。此库只拥有历史副本，移除历史不会删除输出目录中的原图。 */
function openHistory() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('novelai-local-image-history', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('images', { keyPath: ['owner', 'id'] }).createIndex('owner', 'owner');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

/** 为同一浏览器会话的窗口共用标识，供用户选择关闭应用后是否保留图片。 */
function historySession() {
  const cookie = document.cookie.match(/(?:^|; )nai_local_history=([\w-]+)/);
  if (cookie) return cookie[1];
  const id = sessionStorage.getItem('nai_local_history') || createClientId();
  sessionStorage.setItem('nai_local_history', id);
  document.cookie = 'nai_local_history=' + id + '; Path=/; SameSite=Strict';
  return id;
}

/** 读取指定账号和输出目录的历史，按生成顺序返回可展示的图片。 */
export async function restoreImageHistory(account, directory) {
  const owner = await sha256(JSON.stringify([account, directory]));
  const db = await openHistory();
  const session = historySession();
  const keep = localStorage.getItem('keepImageHistory') === 'true';
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const request = store.index('owner').getAll(owner);
    let visible;
    request.onsuccess = () => {
      visible = request.result.filter(row => {
        if (keep || row.session === session) return true;
        store.delete([owner, row.id]);
        return false;
      });
    };
    tx.oncomplete = () => resolve(visible);
    tx.onabort = () => reject(tx.error);
  });
  return rows.sort((a, b) => a.created - b.created).map(row => {
    const src = URL.createObjectURL(row.blob);
    return { ...row.item, id: row.id, type: 'image', src, originalSrc: src, downloadSrc: src, cachedBlob: row.blob, objectUrlToRevoke: src };
  });
}

/** 保存或移除指定分区的单张历史图片。写操作由调用方按顺序提交。 */
export async function writeImageHistory(account, directory, item, remove = false) {
  const owner = await sha256(JSON.stringify([account, directory]));
  const db = await openHistory();
  const row = remove ? null : {
    owner, id: item.id, session: historySession(), created: Date.now(),
    blob: item.cachedBlob || await fetchUrlAsBlob(item.downloadSrc || item.src),
    item: Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key, item[key]])),
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    if (remove) store.delete([owner, item.id]);
    else store.put(row);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
}
