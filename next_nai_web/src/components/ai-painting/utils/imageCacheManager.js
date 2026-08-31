/**
 * imageCacheManager.js
 * 管理角色参考图像的 cache_secret_key 验证状态
 * 用于跟踪哪些 key 已经成功发送过 data，下次请求可以仅发送 key
 */

// 使用 sessionStorage 持久化已验证的 key（刷新页面后重置）
const STORAGE_KEY = 'director_reference_validated_keys';

// 内存缓存
let validatedKeysCache = null;

/**
 * 从 sessionStorage 加载已验证的 key
 */
const loadValidatedKeys = () => {
    if (validatedKeysCache !== null) {
        return validatedKeysCache;
    }

    try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
            validatedKeysCache = new Set(JSON.parse(stored));
        } else {
            validatedKeysCache = new Set();
        }
    } catch (e) {
        console.error('Failed to load validated keys from sessionStorage:', e);
        validatedKeysCache = new Set();
    }

    return validatedKeysCache;
};

/**
 * 保存已验证的 key 到 sessionStorage
 */
const saveValidatedKeys = () => {
    try {
        const keys = loadValidatedKeys();
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
    } catch (e) {
        console.error('Failed to save validated keys to sessionStorage:', e);
    }
};

const imageCacheManager = {
    /**
     * 标记一个或多个 cache_secret_key 为已验证
     * @param {string|string[]} keys - 要标记的 key
     */
    markAsValidated(keys) {
        const validatedKeys = loadValidatedKeys();
        const keysArray = Array.isArray(keys) ? keys : [keys];

        keysArray.forEach(key => {
            if (key) {
                validatedKeys.add(key);
            }
        });

        saveValidatedKeys();
    },

    /**
     * 检查一个 cache_secret_key 是否已验证
     * @param {string} key - 要检查的 key
     * @returns {boolean}
     */
    isValidated(key) {
        if (!key) return false;
        const validatedKeys = loadValidatedKeys();
        return validatedKeys.has(key);
    },

    /**
     * 移除无效的 cache_secret_key
     * @param {string[]} keys - 要移除的 key 数组
     */
    removeInvalidKeys(keys) {
        if (!keys || !Array.isArray(keys)) return;

        const validatedKeys = loadValidatedKeys();
        keys.forEach(key => {
            if (key) {
                validatedKeys.delete(key);
            }
        });

        saveValidatedKeys();
    },

    /**
     * 清空所有缓存的验证状态
     */
    clear() {
        validatedKeysCache = new Set();
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.error('Failed to clear validated keys from sessionStorage:', e);
        }
    },

    /**
     * 获取所有已验证的 key（用于调试）
     * @returns {string[]}
     */
    getAllValidatedKeys() {
        return [...loadValidatedKeys()];
    }
};

export default imageCacheManager;
