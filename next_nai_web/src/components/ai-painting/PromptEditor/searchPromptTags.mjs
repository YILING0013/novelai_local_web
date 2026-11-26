import { DEFAULT_PROMPT_SYNTAX } from './promptCatalog.mjs';
export { DEFAULT_PROMPT_SYNTAX };

let worker;
let sequence = 0;
const pending = new Map();

/**
 * 在浏览器后台查询词屿标签，多个编辑器共用一次下载与一份 WASM 词库。
 * @param {string} query 当前光标处的查询文本。
 * @param {object} options 可见条数、分类等语法字符和取消信号。
 * @returns {Promise<Array>} 排序后的标签及可继续输入的类别候选。
 */
export function searchPromptTags(query, { limit = 40, syntax = DEFAULT_PROMPT_SYNTAX, signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    if (!worker) {
      worker = new Worker(new URL('./promptSearch.worker.mjs', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        request.clear();
        if (data.code) request.reject(Object.assign(new Error(data.code), { code: data.code }));
        else request.resolve(data.tags);
      };
      worker.onerror = () => {
        for (const request of pending.values()) {
          request.clear();
          request.reject(new Error('catalog_unavailable'));
        }
        worker.terminate();
        worker = null;
      };
    }
    const id = ++sequence;
    const abort = () => {
      pending.delete(id);
      worker.postMessage({ id, cancel: true });
      reject(signal.reason);
    };
    pending.set(id, { resolve, reject, clear: () => {
      signal?.removeEventListener('abort', abort);
      pending.delete(id);
    } });
    signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage({ id, query, limit, syntax });
  });
}
