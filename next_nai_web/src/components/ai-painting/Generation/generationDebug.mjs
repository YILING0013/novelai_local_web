const privateField = /token|password|secret|cookie|authorization|credential|captcha|apikey|fingerprint|debugcode|sessionid|filepath|^headers$/;
const imageField = /^(?:data|encoding|dataurl|.*(?:images?\d*|base64|thumbnail|imagepreview|(?:image|mask)(?:data|bytes)|mask|(?:referenceimagemultiple|directorreferenceimages)cached|referenceimagemultiple))$/;
const imageBase64Header = /^(?:iVBORw0KGgo|\/9j\/|R0lGOD[dh]|UklGR|SUkqAA|TU0AKg)/;
const textField = /prompt|caption|instruction|^input$|^uc$|^text$|^positive$|^negative$/;

/**
 * 生成可导出的参数副本。它保留字段结构、截断提示词和图像，并移除凭据和文件链接。
 * @param {object} parameters 编辑器或待发送请求的参数。
 * @returns {object} 可写进诊断 JSON 的副本。
 */
export function summarizeGenerationParameters(parameters) {
  let remaining = 1500;
  function visit(value, field = '', depth = 0) {
    remaining -= 1;
    if (remaining < 0 || depth > 10) return { omitted: true };
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        if (remaining <= 0) {
          items.push({ omitted_items: value.length - items.length });
          break;
        }
        items.push(visit(item, field, depth + 1));
      }
      return items;
    }
    if (value && typeof value === 'object') {
      if (value instanceof Blob) return { type: value.type, bytes: value.size };
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return { bytes: value.byteLength };
      const result = Object.create(null);
      for (const [name, item] of Object.entries(value)) {
        if (remaining <= 0) {
          result.omitted_fields = true;
          break;
        }
        const key = name.replace(/[_-]/g, '').toLowerCase();
        if (/^[A-Za-z0-9_-]{1,80}$/.test(name) && !privateField.test(key) && typeof item !== 'function') {
          result[name] = visit(item, key, depth + 1);
        }
      }
      return result;
    }
    if (typeof value !== 'string') return ['number', 'boolean'].includes(typeof value) ? value : null;
    if (/^(?:https?:\/\/|blob:|file:)/i.test(value)) return { url_omitted: true };
    const isDataUrl = /^data:/i.test(value);
    if (isDataUrl || imageField.test(field) || (value.length >= 32 && imageBase64Header.test(value))) {
      const comma = isDataUrl ? value.indexOf(',') : -1;
      const offset = isDataUrl ? (comma < 0 ? value.length : comma + 1) : 0;
      const length = value.length - offset;
      const edge = Math.min(24, Math.max(0, Math.floor((length - 1) / 3)));
      const head = value.slice(offset, offset + edge);
      const tail = value.slice(value.length - edge);
      return edge && /^[A-Za-z0-9+/_=-]+$/.test(head) && /^[A-Za-z0-9+/_=-]+$/.test(tail)
        ? { base64_length: length, head, tail }
        : { base64_length: length };
    }
    const limit = textField.test(field) ? 160 : 240;
    return value.length > limit
      ? { length: value.length, head: value.slice(0, limit / 2), tail: value.slice(-limit / 2) }
      : value;
  }
  return visit(parameters);
}
