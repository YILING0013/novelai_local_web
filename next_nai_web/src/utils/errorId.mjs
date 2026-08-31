const ERROR_ID_PATTERN = /^[0-9a-f]{8,32}$/i;
const LEGACY_ERROR_ID_PATTERN = /\bError\s*ID\s*[:：#]?\s*([0-9a-f]{8,32})\b/i;

/**
 * 功能：校验并规范化后端错误记录 ID，兼容历史 8 至 32 位十六进制格式。
 *
 * Args:
 *   value: 待校验的错误 ID。
 *
 * Returns:
 *   string|null: 小写错误 ID；格式无效时返回 null。
 */
export function normalizeErrorId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return ERROR_ID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * 功能：优先读取结构化 error_id，并兼容从旧版 Error ID 文案中提取诊断 ID。
 *
 * Args:
 *   value: API 响应、异常对象或旧版错误文案。
 *
 * Returns:
 *   string|null: 可用于错误日志查询的小写错误 ID；不存在时返回 null。
 */
export function extractErrorId(value) {
  if (typeof value === 'string') {
    const directId = normalizeErrorId(value);
    if (directId) {
      return directId;
    }

    const legacyMatch = value.match(LEGACY_ERROR_ID_PATTERN);
    return normalizeErrorId(legacyMatch?.[1]);
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  // 顶层结构化字段是新协议的权威来源，其后才兼容各层旧响应对象。
  const structuredCandidates = [
    value.error_id,
    value.errorId,
    value.data?.error_id,
    value.data?.errorId,
    value.error?.error_id,
    value.error?.errorId,
  ];
  for (const candidate of structuredCandidates) {
    const normalized = normalizeErrorId(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const legacyTextCandidates = [
    value.message,
    typeof value.error === 'string' ? value.error : value.error?.message,
    value.detail,
    value.description,
    value.data?.message,
    typeof value.data?.error === 'string' ? value.data.error : value.data?.error?.message,
    value.data?.detail,
  ];
  for (const candidate of legacyTextCandidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const legacyMatch = candidate.match(LEGACY_ERROR_ID_PATTERN);
    const normalized = normalizeErrorId(legacyMatch?.[1]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}
