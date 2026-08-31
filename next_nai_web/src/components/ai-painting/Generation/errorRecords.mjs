import { normalizeErrorId } from '../../../utils/errorId.mjs';

export const PAINTING_ERROR_RECORDS_STORAGE_KEY = 'aiPaintingErrorRecords:v2';
export const MAX_PAINTING_ERROR_RECORDS = 20;

const REGISTRY_VERSION = 2;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_.-]+$/;
const OWNER_KEY_PATTERN = /^[a-f0-9]{64}$/;

const normalizeToken = (value, fallback, maxLength) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().slice(0, maxLength);
  return normalized && SAFE_TOKEN_PATTERN.test(normalized) ? normalized : fallback;
};

const normalizeStatusCode = (value) => {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : null;
};

const normalizeOccurredAt = (value, now) => {
  const date = value === undefined || value === null ? new Date(now()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(now()).toISOString() : date.toISOString();
};

/**
 * 把面板捕获到的原始异常交给页面级统一错误入口。
 * @param {Function} onError 页面传入的错误回调。
 * @param {unknown} error catch 捕获到的原始异常。
 * @param {object} options 来源、翻译键等展示元数据。
 * @returns {boolean} 已交给页面级回调时返回 true。
 */
export function forwardPaintingPanelError(onError, error, options = {}) {
  if (typeof onError !== 'function') {
    return false;
  }

  onError(error, options);
  return true;
}

/**
 * 将任意异常收敛为可安全写入 localStorage 的绘图错误记录。
 * @param {unknown} errorLike 服务异常、批量错误对象或稳定错误码。
 * @param {object} options 来源、模型和测试用时钟等元数据。
 * @returns {object} 只包含白名单诊断字段的记录。
 */
export function createPaintingErrorRecord(errorLike, options = {}) {
  const nestedError = errorLike?.error && typeof errorLike.error === 'object'
    ? errorLike.error
    : null;
  const directCode = typeof errorLike === 'string'
    ? errorLike
    : errorLike?.code || errorLike?.errorCode || errorLike?.error_code || nestedError?.code;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const structuredErrorId = normalizeErrorId(errorLike?.errorId)
    || normalizeErrorId(errorLike?.error_id)
    || normalizeErrorId(nestedError?.errorId)
    || normalizeErrorId(nestedError?.error_id);
  return {
    code: normalizeToken(directCode, 'UNKNOWN_ERROR', 96),
    // 只接收服务链路已经确认的结构化 ID，绝不从浏览器异常文案中猜测。
    errorId: structuredErrorId,
    category: normalizeToken(errorLike?.category || nestedError?.category, 'unknown', 48),
    statusCode: normalizeStatusCode(
      errorLike?.statusCode ?? errorLike?.status_code ?? errorLike?.status ?? nestedError?.statusCode,
    ),
    source: normalizeToken(options.source || errorLike?.source, 'workspace', 64),
    occurredAt: normalizeOccurredAt(
      options.occurredAt ?? errorLike?.occurredAt ?? errorLike?.timestamp,
      now,
    ),
    messageKey: normalizeToken(options.messageKey || errorLike?.messageKey, '', 160),
    model: normalizeToken(options.model || errorLike?.model || nestedError?.model, '', 96),
  };
}

/**
 * 把新错误插入记录首位，并限制为最近指定条数。
 * @param {object[]} records 当前错误记录数组。
 * @param {object} record 新错误。
 * @param {number} limit 最大保留数量。
 * @returns {object[]} 按时间从新到旧排列的安全错误记录。
 */
export function prependPaintingErrorRecord(
  records,
  record,
  limit = MAX_PAINTING_ERROR_RECORDS,
) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : MAX_PAINTING_ERROR_RECORDS;
  const currentRecords = Array.isArray(records) ? records : [];
  const normalizedRecord = createPaintingErrorRecord(record, record);
  const uniqueCurrentRecords = currentRecords.filter((currentRecord) => (
    JSON.stringify(createPaintingErrorRecord(currentRecord, currentRecord))
      !== JSON.stringify(normalizedRecord)
  ));
  return [normalizedRecord, ...uniqueCurrentRecords].slice(0, safeLimit);
}

const normalizeOwnerRecords = (records, limit) => {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : MAX_PAINTING_ERROR_RECORDS;
  return (Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record === 'object' && !Array.isArray(record))
    .slice(0, safeLimit)
    .map((record) => createPaintingErrorRecord(record, record));
};

const parseRegistry = (serialized, limit) => {
  const emptyRegistry = { version: REGISTRY_VERSION, owners: {} };
  if (typeof serialized !== 'string' || !serialized.trim()) {
    return emptyRegistry;
  }

  try {
    const parsed = JSON.parse(serialized);
    if (
      parsed?.version !== REGISTRY_VERSION
      || !parsed.owners
      || typeof parsed.owners !== 'object'
      || Array.isArray(parsed.owners)
    ) {
      return emptyRegistry;
    }

    const owners = {};
    Object.entries(parsed.owners).forEach(([ownerKey, records]) => {
      if (OWNER_KEY_PATTERN.test(ownerKey)) {
        owners[ownerKey] = normalizeOwnerRecords(records, limit);
      }
    });
    return { version: REGISTRY_VERSION, owners };
  } catch {
    return emptyRegistry;
  }
};

/**
 * 读取当前账号的持久化错误，其他账号记录不会进入界面状态。
 * @param {string} serialized localStorage 中的 v2 registry JSON。
 * @param {string} ownerKey 当前账号稳定标识的 SHA-256。
 * @param {number} limit 最大恢复数量。
 * @returns {object[]} 当前账号的安全错误记录。
 */
export function parsePaintingErrorRecords(
  serialized,
  ownerKey,
  limit = MAX_PAINTING_ERROR_RECORDS,
) {
  if (!OWNER_KEY_PATTERN.test(ownerKey || '')) {
    return [];
  }
  return parseRegistry(serialized, limit).owners[ownerKey] || [];
}

/**
 * 仅更新当前账号在 v2 registry 中的记录，并保留其他账号分区。
 * @param {string} serialized localStorage 中原有的 v2 registry JSON。
 * @param {string} ownerKey 当前账号稳定标识的 SHA-256。
 * @param {object[]} records 当前账号待保存的错误记录。
 * @param {number} limit 最大保留数量。
 * @returns {string} 可直接写回 localStorage 的 registry JSON。
 */
export function serializePaintingErrorRecords(
  serialized,
  ownerKey,
  records,
  limit = MAX_PAINTING_ERROR_RECORDS,
) {
  const registry = parseRegistry(serialized, limit);
  if (!OWNER_KEY_PATTERN.test(ownerKey || '')) {
    return JSON.stringify(registry);
  }

  const normalizedRecords = normalizeOwnerRecords(records, limit);
  if (normalizedRecords.length > 0) {
    registry.owners[ownerKey] = normalizedRecords;
  } else {
    delete registry.owners[ownerKey];
  }
  return JSON.stringify(registry);
}
