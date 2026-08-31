// utils/vibeDB.js

const DB_NAME = 'AIPaintingVibeDB';
const STORE_NAME = 'vibeCache';
const PANEL_STATE_STORE_NAME = 'vibePanelState';
const PANEL_STATE_KEY = 'current-vibe-images';
const DB_VERSION = 2;
export const VIBE_DB_ERROR_CODES = Object.freeze({
  UNSUPPORTED: 'VIBE_DB_UNSUPPORTED',
  OPEN_FAILED: 'VIBE_DB_OPEN_FAILED',
});

/**
 * 打开或创建 IndexedDB 数据库。
 * @returns {Promise<IDBDatabase>} 返回一个数据库实例的 Promise。
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      const error = new Error(VIBE_DB_ERROR_CODES.UNSUPPORTED);
      error.code = VIBE_DB_ERROR_CODES.UNSUPPORTED;
      reject(error);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // 创建一个对象存储空间，使用 cacheKey 作为主键
        db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(PANEL_STATE_STORE_NAME)) {
        db.createObjectStore(PANEL_STATE_STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error("数据库错误:", event.target.errorCode);
      const error = new Error(VIBE_DB_ERROR_CODES.OPEN_FAILED);
      error.code = VIBE_DB_ERROR_CODES.OPEN_FAILED;
      reject(error);
    };
  });
}

/**
 * 根据哈希值、模型和信息提取值生成一个唯一的缓存键。
 * @param {string} hash - 图像哈希值。
 * @param {string} model - 模型名称。
 * @param {number} information_extracted - 信息提取值。
 * @returns {string} 唯一的缓存键。
 */
const getCacheKey = (hash, model, information_extracted) => {
    // 将 information_extracted 格式化为一位小数
    return `${hash}-${model}-${information_extracted.toFixed(1)}`;
}

/**
 * 将 Vibe 数据添加到缓存中。
 * @param {object} vibeData - 要缓存的完整 Vibe JSON 对象。
 * @param {string} hash - 图像哈希值。
 * @param {string} model - 模型名称。
 * @param {number} information_extracted - 信息提取值。
 * @returns {Promise<void>} 操作完成时解析的 Promise。
 */
export const addVibeToCache = async (vibeData, hash, model, information_extracted) => {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const dataToStore = { ...vibeData, cacheKey: getCacheKey(hash, model, information_extracted) };
        const request = store.put(dataToStore);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
};

/**
 * 从缓存中检索 Vibe 数据。
 * @param {string} hash - 图像哈希值。
 * @param {string} model - 模型名称。
 * @param {number} information_extracted - 信息提取值。
 * @returns {Promise<object|undefined>} 返回找到的 Vibe 数据对象，如果未找到则返回 undefined。
 */
export const getVibeFromCache = async (hash, model, information_extracted) => {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(getCacheKey(hash, model, information_extracted));
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
};

/**
 * [新增] 从缓存中检索所有 Vibe 数据。
 * @returns {Promise<Array<object>>} 返回包含所有 Vibe 数据对象的数组。
 */
export const getAllVibesFromCache = async () => {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
    });
};

export const saveVibePanelState = async (vibeImages) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PANEL_STATE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PANEL_STATE_STORE_NAME);
    const request = store.put({
      key: PANEL_STATE_KEY,
      vibeImages,
      updatedAt: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
};

export const getVibePanelState = async () => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PANEL_STATE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(PANEL_STATE_STORE_NAME);
    const request = store.get(PANEL_STATE_KEY);

    request.onsuccess = () => resolve(request.result?.vibeImages || []);
    request.onerror = (event) => reject(event.target.error);
  });
};

export const clearVibePanelState = async () => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PANEL_STATE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PANEL_STATE_STORE_NAME);
    const request = store.delete(PANEL_STATE_KEY);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
};
