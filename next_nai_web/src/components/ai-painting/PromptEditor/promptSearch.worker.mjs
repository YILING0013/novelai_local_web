import assets from './promptSearchAssets.json';
import { openPromptCatalog } from './promptCatalog.mjs';

let catalog;
const waiting = new Map();
async function loadCatalog() {
  // 开发构建会使用 blob: Worker，它没有可供 fetch 解析相对路径的 HTTP 地址。
  const base = self.location.origin + '/tag-search/';
  const [runtime, response] = await Promise.all([
    import(/* webpackIgnore: true */ base + assets.glueFile),
    fetch(base + assets.catalogFile, { cache: 'force-cache' }),
  ]);
  if (!response.ok) throw new Error('catalog_unavailable');
  const [bytes] = await Promise.all([
    new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),
    runtime.default({ module_or_path: fetch(base + assets.wasmFile, { cache: 'force-cache' }) }),
  ]);
  return openPromptCatalog(new Uint8Array(bytes), runtime.TagCatalog);
}

self.onmessage = async ({ data }) => {
  if (data.cancel) { waiting.delete(data.id); return; }
  waiting.set(data.id, true);
  try {
    // 首次下载期间用户可以继续输入；已取消的请求无需再扫描词库。
    catalog ??= loadCatalog().catch(error => { catalog = null; throw error; });
    const search = await catalog;
    if (!waiting.has(data.id)) return;
    self.postMessage({ id: data.id, tags: search(data.query, data.limit, data.syntax) });
  } catch (error) {
    if (waiting.has(data.id)) self.postMessage({ id: data.id,
      code: String(error) === 'invalid_regex' ? 'invalid_regex' : 'catalog_unavailable' });
  } finally {
    waiting.delete(data.id);
  }
};
