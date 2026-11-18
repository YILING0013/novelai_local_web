import { registerPlugin } from '@capacitor/core';
import { confirm, message } from './dialog';

export const local = registerPlugin('NovelAILocal');

/** 分块传输文件，避免在一次 WebView 桥接消息里复制大图片或 ZIP。 */
export async function withTransfer(blob, onStaged) {
  const id = crypto.randomUUID();
  const chunkSize = 192 * 1024;
  try {
    for (let offset = 0; offset < blob.size || offset === 0; offset += chunkSize) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      let binary = '';
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      await local.stage({ id, append: offset > 0, data: btoa(binary) });
    }
    return await onStaged(id);
  } finally {
    await local.discard({ id });
  }
}

/** 将本地 API 请求交给原生插件，图片走 WebView 内部资源流。 */
export function installTransport() {
  const fetchOriginal = window.fetch.bind(window);
  window.novelaiDialog = { alert: message, confirm };
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = init.method || (input instanceof Request ? input.method : 'GET');
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')
        || (method === 'GET' && /^\/api\/local\/(?:gallery\/[^/]+\/(?:file|thumbnail)|versions\/assets\/|metadata-exports\/)/.test(url.pathname))) {
      return fetchOriginal(input, init);
    }
    init.signal?.throwIfAborted();
    const request = { method, path: url.pathname + url.search };
    let body = init.body;
    if (body instanceof FormData) {
      const multipart = { files: [] };
      for (const [key, file] of body) {
        if (typeof file === 'string') { multipart[key] = file; continue; }
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        multipart.files.push({ name: file.name, data });
      }
      body = JSON.stringify(multipart);
    }
    init.signal?.throwIfAborted();
    // 账户和漫画密钥字段只通过内存传递。
    const media = /^\/api\/(?:images\/|local\/(?:gallery\/import$|inference\/jobs$|works(?:\/|$)))/.test(url.pathname);
    const reply = media && body?.length >= 192 * 1024
      ? await withTransfer(new Blob([body]), (transfer) => {
        init.signal?.throwIfAborted();
        return local.request({ ...request, transfer });
      })
      : await local.request({ ...request, body: body || 'null' });
    init.signal?.throwIfAborted();
    const status = reply.status >= 300 && reply.status < 400 ? 502 : reply.status;
    return Response.json(reply.body, { status });
  };
}
