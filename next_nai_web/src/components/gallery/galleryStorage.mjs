import { createClientId } from '../../utils/browserCapabilities.mjs';
const DB_NAME = 'novelai-personal-gallery';
const MODE_KEY = 'novelai:gallery-storage';
export const GALLERY_SOURCE_KEY = 'novelai:inspiration-source';
export const GALLERY_SOURCE_CHANGED = 'novelai:gallery-source';
export const GALLERY_VISIBILITY_KEY = 'novelai:inspiration-visible';
export const GALLERY_VISIBILITY_CHANGED = 'novelai:inspiration-visibility';
export const GALLERY_CHANGED = 'novelai:gallery-updated';
export const GALLERY_STORAGE_CHANGED = 'novelai:gallery-storage-changed';
export const GALLERY_SOURCES = ['references', 'outputs'];
let database;

/**
 * 读取生成页记住的灵感来源，首次使用保留原来的默认示例图库。
 * @returns {string} default、references 或 outputs。
 */
export function getGalleryInspirationSource() {
  const source = typeof window !== 'undefined' ? localStorage.getItem(GALLERY_SOURCE_KEY) : null;
  return ['references', 'outputs'].includes(source) ? source : 'default';
}

/**
 * 保存灵感来源并同步当前页面中的设置与生成工作区。
 * @param {string} source default、references 或 outputs。
 * @returns {void} 完成后通知订阅该设置的界面。
 */
export function setGalleryInspirationSource(source) {
  if (!['default', ...GALLERY_SOURCES].includes(source)) throw new Error('gallery.errors.invalidData');
  localStorage.setItem(GALLERY_SOURCE_KEY, source);
  window.dispatchEvent(new Event(GALLERY_SOURCE_CHANGED));
}

/**
 * 读取本浏览器是否在空白预览中显示灵感图库。
 * @returns {boolean} 仅显式开启时返回 true，未设置时隐藏。
 */
export function getGalleryInspirationVisibility() {
  return typeof window !== 'undefined' && localStorage.getItem(GALLERY_VISIBILITY_KEY) === 'true';
}

/**
 * 保存灵感图库的显示状态，并通知同一页面中的设置与绘画工作区。
 * @param {boolean} visible 是否显示。
 */
export function setGalleryInspirationVisibility(visible) {
  localStorage.setItem(GALLERY_VISIBILITY_KEY, String(visible));
  window.dispatchEvent(new Event(GALLERY_VISIBILITY_CHANGED));
}

/**
 * 打开图库数据库；原图与索引分开，列表读取不加载全部原图。
 * @returns {Promise<IDBDatabase>} 已打开的图库数据库。
 */
export function openGalleryDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ['entries', 'files', 'groups', 'settings']) {
        request.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { blocked = true; database = null; reject(new Error('gallery.errors.databaseBlocked')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  });
  return database;
}

async function readStore(name, id) {
  const db = await openGalleryDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readonly');
    const request = id === undefined ? tx.objectStore(name).getAll() : tx.objectStore(name).get(id);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
}

async function writeStores(values) {
  const db = await openGalleryDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(Object.keys(values), 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    try {
      for (const [name, records] of Object.entries(values)) {
        for (const record of records) tx.objectStore(name).put(record);
      }
    } catch (error) { tx.abort(); reject(error); }
  });
}

/**
 * 返回当前存储模式；切换模式不搬移或删除另一处的图库。
 * @returns {string} browser 或 directory。
 */
export function getGalleryStorageMode() {
  return localStorage.getItem(MODE_KEY) === 'directory' ? 'directory' : 'browser';
}

/**
 * 检查浏览器是否能在桌面安全上下文中让用户授权目录。
 * @returns {boolean} 当前设备是否支持目录选择。
 */
export function supportsGalleryDirectory() {
  return window.isSecureContext && typeof window.showDirectoryPicker === 'function'
    && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * 获取所选目录与权限状态；不会自行弹出授权框。
 * @returns {Promise<object>} 当前模式、目录句柄、名称及权限。
 */
export async function getGalleryStorageStatus() {
  const saved = await readStore('settings', 'directory');
  return {
    mode: getGalleryStorageMode(),
    handle: saved?.handle,
    name: saved?.handle.name || '',
    permission: saved ? await saved.handle.queryPermission({ mode: 'readwrite' }) : 'prompt',
  };
}

/**
 * 由点击事件传入已获授权的目录；只在该目录下创建专用子目录。
 * @param {FileSystemDirectoryHandle} handle 用户在选择框中授权的目录。
 * @returns {Promise<void>} 保存完成后通知页面更新。
 */
export async function setGalleryDirectory(handle) {
  await handle.getDirectoryHandle('novelai-gallery', { create: true });
  await writeStores({ settings: [{ id: 'directory', handle }] });
  setGalleryStorageMode('directory');
}

/**
 * 切换图库和自动保存的共同目标，调用方须先完成目录授权。
 * @param {string} mode browser 或 directory。
 * @returns {void} 修改设置并通知页面。
 */
export function setGalleryStorageMode(mode) {
  if (!['browser', 'directory'].includes(mode)) throw new Error('gallery.errors.invalidData');
  localStorage.setItem(MODE_KEY, mode);
  window.dispatchEvent(new Event(GALLERY_STORAGE_CHANGED));
}

/**
 * 固定一次操作的存储目标，期间切换设置不会把半批数据写入另一处。
 * @returns {Promise<object>} 本次操作固定使用的模式和已授权目录。
 */
export async function getGalleryStorageTarget() {
  if (getGalleryStorageMode() === 'browser') return { mode: 'browser' };
  const { handle, permission } = await getGalleryStorageStatus();
  if (!handle || permission !== 'granted') throw new Error('gallery.errors.directoryPermission');
  return { mode: 'directory', directory: await handle.getDirectoryHandle('novelai-gallery', { create: true }) };
}

async function directoryFile(root, folder, name, content) {
  // 文件名只接受应用产生的摘要和 UUID，外部备份不得提供任意路径。
  if (!/^[a-zA-Z0-9_-]+\.(json|png|jpg|webp|gif|bmp|bin)$/.test(name)) throw new Error('gallery.errors.invalidData');
  const directory = await root.getDirectoryHandle(folder, { create: content !== undefined });
  const file = await directory.getFileHandle(name, { create: content !== undefined });
  if (content === undefined) return file.getFile();
  const stream = await file.createWritable();
  try { await stream.write(content); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}

async function listDirectoryRecords(folder, root) {
  let directory;
  try { directory = await root.getDirectoryHandle(folder); }
  catch (error) { if (error.name === 'NotFoundError') return []; throw error; }
  const records = [];
  for await (const handle of directory.values()) {
    if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue;
    const record = JSON.parse(await (await handle.getFile()).text());
    if (folder === 'entries') validateGalleryEntry(record);
    else if (folder === 'history') {
      if (!/^history-[a-f0-9-]{36}$/.test(record.id) || handle.name !== record.id + '.json'
        || !/^[a-f0-9]{64}$/.test(record.hash) || !/^(png|jpg|webp|gif|bmp|bin)$/.test(record.extension)) throw new Error('gallery.errors.invalidData');
    } else if (typeof record.id !== 'string' || handle.name !== record.id + '.json' ||
      !GALLERY_SOURCES.includes(record.source) || typeof record.name !== 'string') throw new Error('gallery.errors.invalidData');
    records.push(record);
  }
  return records;
}

/**
 * 读取轻量索引，用于分页、搜索、分组和备份；不加载图片内容。
 * @param {object} [target] 固定存储目标，省略时使用当前设置。
 * @returns {Promise<Array>} 全部轻量图库记录。
 */
export async function getGalleryEntries(target) {
  const storage = target || await getGalleryStorageTarget();
  return storage.mode === 'directory' ? listDirectoryRecords('entries', storage.directory) : readStore('entries');
}

/**
 * 返回图库分组；source 省略时用于完整备份。
 * @param {string} [source] references 或 outputs，省略时返回全部分组。
 * @param {object} [target] 本次操作的存储目标。
 * @returns {Promise<Array>} 匹配的分组。
 */
export async function getGalleryGroups(source, target) {
  const storage = target || await getGalleryStorageTarget();
  const groups = storage.mode === 'directory' ? await listDirectoryRecords('groups', storage.directory) : await readStore('groups');
  return groups.filter((group) => !source || group.source === source);
}

/**
 * 创建或恢复分组，返回已保存记录。
 * @param {object} group 分组 ID、来源及名称。
 * @param {object} [target] 本次操作的存储目标。
 * @returns {Promise<object>} 已保存的分组。
 */
export async function saveGalleryGroup(group, target) {
  const storage = target || await getGalleryStorageTarget();
  if (storage.mode === 'directory') {
    await directoryFile(storage.directory, 'groups', `${group.id}.json`, JSON.stringify(group));
  } else await writeStores({ groups: [group] });
  window.dispatchEvent(new Event(GALLERY_CHANGED));
  return group;
}

/**
 * 根据索引读取原图或缩略图，目录不可用时明确报错而不换用其他存储。
 * @param {object} entry 已读取的图库记录。
 * @param {boolean} [thumbnail] 是否读取缩略图。
 * @param {object} [target] 本次操作的存储目标。
 * @returns {Promise<Blob>} 图片内容。
 */
export async function getGalleryBlob(entry, thumbnail = false, target) {
  const storage = target || await getGalleryStorageTarget();
  // 另一窗口可能刚迁移了旧索引，已经打开的详情依旧能读到同一个哈希的图。
  for (const id of entry.shared ? [entry.hash] : [entry.id, entry.hash]) {
    if (storage.mode === 'directory') {
      try {
        const file = await directoryFile(storage.directory, thumbnail ? 'thumbnails' : 'images', thumbnail ? `${id}.webp` : `${id}.${entry.extension}`);
        return !thumbnail && !file.type && entry.mime ? new Blob([file], { type: entry.mime }) : file;
      } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    } else {
      const file = await readStore('files', id);
      if (file) return thumbnail ? file.thumbnail : file.blob;
    }
  }
  throw new Error('gallery.errors.missingImage');
}

/**
 * 读取单条详情，不附带短期 URL 或远端地址。
 * @param {string} id 图片在图库中的稳定 ID。
 * @param {object} [target] 本次操作的存储目标。
 * @param {boolean} [optional] 去重查询时允许记录不存在。
 * @returns {Promise<object|null>} 图库记录，允许缺失时返回 null。
 */
export async function getGalleryEntry(id, target, optional = false) {
  const storage = target || await getGalleryStorageTarget();
  let entry;
  try {
    entry = storage.mode === 'directory'
      ? JSON.parse(await (await directoryFile(storage.directory, 'entries', `${id}.json`)).text())
      : await readStore('entries', id);
  } catch (error) { if (optional && error.name === 'NotFoundError') return null; throw error; }
  if (!entry && optional) return null;
  if (!entry) throw new Error('gallery.errors.missingImage');
  validateGalleryEntry(entry);
  return entry;
}

/**
 * 验证外部图库记录的路径字段和基础数据，返回原记录。
 * @param {object} entry 来自目录或备份的图库记录。
 * @returns {object} 校验后的原记录，无效时抛错。
 */
export function validateGalleryEntry(entry) {
  const baseId = `${entry?.source}-${entry?.hash}`;
  const copyId = typeof entry?.id === 'string' && entry.source === 'outputs' && entry.id.startsWith(`${baseId}-`)
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.id.slice(baseId.length + 1));
  if (!entry || !GALLERY_SOURCES.includes(entry.source) || !/^[a-f0-9]{64}$/.test(entry.hash)
    || (entry.id !== baseId && !copyId) || !['png', 'jpg', 'webp', 'gif', 'bmp'].includes(entry.extension)
    || !['filename', 'title', 'prompt', 'negative_prompt', 'style_prompt', 'group_id'].every((key) => typeof entry[key] === 'string')
    || !Number.isFinite(entry.created_at) || !Number.isFinite(entry.width) || entry.width <= 0
    || !Number.isFinite(entry.height) || entry.height <= 0 || !entry.parameters || typeof entry.parameters !== 'object' || Array.isArray(entry.parameters)
    || !(entry.trashed_at === null || Number.isFinite(entry.trashed_at))) {
    throw new Error('gallery.errors.invalidData');
  }
  return entry;
}

/**
 * 保存一张图；浏览器事务一次提交，目录中最后写索引，避免把未完成的图片显示为成功。
 * @param {object} entry 完整图库索引。
 * @param {object} [files] 新增时传入原图 blob 和缩略图 thumbnail。
 * @param {object} [target] 本次操作的存储目标。
 * @returns {Promise<object>} 成功提交的记录。
 */
export async function saveGalleryEntry(entry, files, target) {
  validateGalleryEntry(entry);
  const storage = target || await getGalleryStorageTarget();
  await navigator.locks.request('novelai-gallery-media', async () => {
    if (files) {
      await saveSharedImage(storage, entry.hash, entry.extension, files.blob, files.thumbnail);
      entry = { ...entry, shared: true };
    }
    // 元数据编辑可能从另一个标签页迁移之前的记录发起。
    else if ((await getGalleryEntry(entry.id, storage)).shared) entry = { ...entry, shared: true };
    if (storage.mode === 'directory') await directoryFile(storage.directory, 'entries', entry.id + '.json', JSON.stringify(entry));
    else await writeStores({ entries: [entry] });
  });
  window.dispatchEvent(new Event(GALLERY_CHANGED));
  return entry;
}

/**
 * 只更新用户可编辑字段，原图和完整参数保留；回收站通过标记实现。
 * @param {string} id 待编辑的图库 ID。
 * @param {object} changes 用户编辑字段或回收站标记。
 * @param {object} [target] 本次操作的存储目标。
 * @returns {Promise<object>} 已保存的完整记录。
 */
export async function updateGalleryEntry(id, changes, target) {
  const storage = target || await getGalleryStorageTarget();
  const entry = await getGalleryEntry(id, storage);
  for (const key of ['title', 'prompt', 'negative_prompt', 'style_prompt', 'group_id', 'trashed_at']) {
    if (Object.hasOwn(changes, key)) entry[key] = changes[key];
  }
  entry.updated_at = Date.now();
  return saveGalleryEntry(entry, undefined, storage);
}

/**
 * 彻底删除回收站中的一张图片，同时移除原图、缩略图和索引。
 * @param {string} id 用户确认删除的图库 ID；未移入回收站的图片不能删除。
 * @param {object} [target] 本次操作固定使用的存储位置。
 * @returns {Promise<void>} 删除完成；中断后可对同一 ID 重试。
 */
export async function deleteGalleryEntry(id, target) {
  const storage = target || await getGalleryStorageTarget();
  await navigator.locks.request('novelai-gallery-media', async () => {
    const entry = await getGalleryEntry(id, storage, true);
    if (!entry) return;
    if (entry.id !== id) throw new Error('gallery.errors.invalidData');
    if (entry.trashed_at === null) throw new Error('gallery.errors.notInTrash');
    await removeMediaRecords(storage, [entry], []);
  });
  window.dispatchEvent(new Event(GALLERY_CHANGED));
}

async function removeStored(storage, store, id, folder, filename) {
  if (storage.mode === 'directory') {
    try { await (await storage.directory.getDirectoryHandle(folder)).removeEntry(filename); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
  } else {
    const db = await openGalleryDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  }
}

async function removeImageFiles(storage, id, extension) {
  await removeStored(storage, 'files', id, 'images', id + '.' + extension);
  if (storage.mode === 'directory') await removeStored(storage, 'files', id, 'thumbnails', id + '.webp');
}

async function saveSharedImage(storage, hash, extension, blob, thumbnail) {
  let matches;
  const output = 'outputs-' + hash;
  if (storage.mode === 'directory') {
    matches = [];
    let entries;
    try { entries = await storage.directory.getDirectoryHandle('entries'); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (entries) for await (const file of entries.values()) {
      if (file.kind === 'file' && file.name.endsWith('.json') &&
        (file.name === 'references-' + hash + '.json' || file.name.startsWith(output))) {
        matches.push(await getGalleryEntry(file.name.slice(0, -5), storage));
      }
    }
  } else {
    const db = await openGalleryDatabase();
    matches = await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly');
      const entries = tx.objectStore('entries');
      const outputs = entries.getAll(IDBKeyRange.bound(output, output + '\uffff'));
      const reference = entries.get('references-' + hash);
      tx.oncomplete = () => resolve([...outputs.result, reference.result].filter(Boolean));
      tx.onabort = () => reject(tx.error);
    });
  }
  const legacy = matches.filter(entry => !entry.shared);
  // 旧画廊按条目保存。首次共用时先准备原图和旧缩略图，改好索引后才移除旧副本。
  if (!thumbnail && legacy.length) thumbnail = await getGalleryBlob(legacy[0], true, storage);
  if (storage.mode === 'directory') {
    for (const [folder, name, content] of [['images', hash + '.' + extension, blob], ['thumbnails', hash + '.webp', thumbnail]]) {
      if (!content) continue;
      try { await directoryFile(storage.directory, folder, name); }
      catch (error) {
        if (error.name !== 'NotFoundError') throw error;
        await directoryFile(storage.directory, folder, name, content);
      }
    }
    for (const old of legacy) {
      await directoryFile(storage.directory, 'entries', old.id + '.json', JSON.stringify({ ...old, shared: true }));
      await removeImageFiles(storage, old.id, old.extension);
    }
  } else {
    const oldFile = await readStore('files', hash);
    if (!oldFile || (thumbnail && !oldFile.thumbnail) || legacy.length) {
      await writeStores({
        files: [{ id: hash, blob: oldFile?.blob || blob, thumbnail: oldFile?.thumbnail || thumbnail }],
        entries: legacy.map(entry => ({ ...entry, shared: true })),
      });
      for (const old of legacy) await removeImageFiles(storage, old.id, old.extension);
    }
  }
}

async function historyRecords(storage) {
  return storage.mode === 'directory' ? listDirectoryRecords('history', storage.directory)
    : (await readStore('settings')).filter(record => record.id.startsWith('history-'));
}

async function removeMediaRecords(storage, gallery, history) {
  const shared = [...gallery.filter(entry => entry.shared), ...history];
  const files = new Map(gallery.filter(entry => !entry.shared).map(entry => [entry.id, entry.extension]));
  if (shared.length) {
    const removedIds = new Set([...gallery, ...history].map(record => record.id));
    const retainedHashes = new Set([
      ...(await getGalleryEntries(storage)).filter(entry => entry.shared), ...await historyRecords(storage),
    ].filter(record => !removedIds.has(record.id)).map(record => record.hash));
    for (const record of shared) if (!retainedHashes.has(record.hash)) files.set(record.hash, record.extension);
  }
  if (storage.mode === 'browser') {
    const db = await openGalleryDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['files', 'entries', 'settings'], 'readwrite');
      for (const id of files.keys()) tx.objectStore('files').delete(id);
      for (const entry of gallery) tx.objectStore('entries').delete(entry.id);
      for (const record of history) tx.objectStore('settings').delete(record.id);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    return;
  }
  // 目录中最后删索引，遇到权限或写盘错误可以从原来的索引继续重试。
  for (const [id, extension] of files) await removeImageFiles(storage, id, extension);
  for (const entry of gallery) {
    await removeStored(storage, 'entries', entry.id, 'entries', entry.id + '.json');
  }
  for (const record of history) await removeStored(storage, 'settings', record.id, 'history', record.id + '.json');
}

/** 清空本存储目标的画廊条目、回收站和分组；历史仍引用的原图继续保留。 */
export async function clearGalleryLibrary(target) {
  const storage = target || await getGalleryStorageTarget();
  await navigator.locks.request('novelai-gallery-media', async () => {
    await removeMediaRecords(storage, await getGalleryEntries(storage), []);
    for (const group of await getGalleryGroups(undefined, storage)) {
      await removeStored(storage, 'groups', group.id, 'groups', group.id + '.json');
    }
  });
  localStorage.setItem(GALLERY_CHANGED, createClientId());
  window.dispatchEvent(new Event(GALLERY_CHANGED));
}

export const HISTORY_CHANGED = 'novelai:image-history-changed';
const KEEP_HISTORY = 'novelai:keep-image-history';
const sessionCookie = 'novelai_image_session';

/** 读取当前浏览器的跨会话保存选择，首次使用为关闭。 */
export function keepsImageHistory() {
  return typeof window !== 'undefined' && localStorage.getItem(KEEP_HISTORY) === 'true';
}

function notifyHistory() {
  localStorage.setItem(HISTORY_CHANGED, createClientId());
  window.dispatchEvent(new Event(HISTORY_CHANGED));
}

// 仅存放随机会话名，原图与提示词不放进 cookie。多窗口在同一把锁内取得相同会话。
function imageSession() {
  const read = () => document.cookie.split('; ').find(row => row.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
  const existing = read();
  if (existing) return existing;
  const id = createClientId();
  document.cookie = sessionCookie + '=' + id + '; Path=/; SameSite=Strict' + (location.protocol === 'https:' ? '; Secure' : '');
  if (read() !== id) throw new Error('gallery.errors.operation');
  return id;
}

async function writeHistoryRecord(storage, record) {
  if (storage.mode === 'directory') await directoryFile(storage.directory, 'history', record.id + '.json', JSON.stringify(record));
  else await writeStores({ settings: [record] });
}

/** 切换跨会话历史保存，并把当前存储目标中已有的本会话历史一起切换。 */
export async function setKeepImageHistory(keep, target) {
  const storage = target || await getGalleryStorageTarget();
  await navigator.locks.request('novelai-gallery-media', async () => {
    const session = imageSession();
    for (const record of await historyRecords(storage)) {
      if (record.persistent || record.session === session) await writeHistoryRecord(storage, { ...record, session, persistent: keep });
    }
    localStorage.setItem(KEEP_HISTORY, String(keep));
  });
  notifyHistory();
}

/** 读取当前账号历史并回收已结束会话的临时图片；返回轻量记录与固定的读取目标。 */
export async function listImageHistory(owner, target) {
  const storage = target || await getGalleryStorageTarget();
  return navigator.locks.request('novelai-gallery-media', async () => {
    const session = imageSession();
    const records = await historyRecords(storage);
    // 持久历史由各存储位置的记录决定，其他位置的开关不应清除它。
    const retained = record => record.session === session || record.persistent;
    const expired = records.filter(record => !retained(record));
    if (expired.length) await removeMediaRecords(storage, [], expired);
    return { storage, records: records.filter(record => record.owner === owner && retained(record)).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)) };
  });
}

/** 在当前存储中保存一条历史。元数据按历史独立保存，原图按内容哈希与画廊共用。 */
export async function saveImageHistory(record, blob, storage, clearRevision) {
  await navigator.locks.request('novelai-gallery-media', async () => {
    if (localStorage.getItem('novelai:history-cleared:' + record.owner) !== clearRevision) return;
    await saveSharedImage(storage, record.hash, record.extension, blob);
    await writeHistoryRecord(storage, { ...record, shared: true, session: imageSession(), persistent: keepsImageHistory() });
  });
  notifyHistory();
}

/** 删除当前账号的一条或所有历史记录，保留其他历史或画廊仍引用的图片。 */
export async function clearImageHistory(owner, id, target) {
  const storage = target || await getGalleryStorageTarget();
  await navigator.locks.request('novelai-gallery-media', async () => {
    if (id === undefined) localStorage.setItem('novelai:history-cleared:' + owner, createClientId());
    const selected = (await historyRecords(storage)).filter(record => record.owner === owner && (id === undefined || record.id === id));
    await removeMediaRecords(storage, [], selected);
  });
  notifyHistory();
}

/**
 * 将真实存储异常映射为中英文文案键，不把图库内容写入错误消息。
 * @param {Error} error 本次存储或导入异常。
 * @returns {string} 安全的本地化文案键。
 */
export function getGalleryErrorKey(error) {
  if (error?.name === 'QuotaExceededError') return 'gallery.errors.quota';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'gallery.errors.directoryPermission';
  if (error?.name === 'NotFoundError') return 'gallery.errors.missingImage';
  const knownKeys = ['operation', 'quota', 'directoryPermission', 'databaseBlocked', 'missingImage', 'missingWork', 'firstVersionImage', 'writeConflict', 'invalidData', 'imageType', 'archiveFormat', 'archiveSize', 'archiveChecksum', 'notInTrash'];
  return knownKeys.map((key) => `gallery.errors.${key}`).includes(error?.message) ? error.message : 'gallery.errors.operation';
}
