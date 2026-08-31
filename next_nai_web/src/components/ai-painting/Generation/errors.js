import { extractErrorId } from '../../../utils/errorId.mjs';

export const GENERATION_ERROR_CODES = Object.freeze({
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GENERATION_FAILED: 'GENERATION_FAILED',
  INVALID_GENERATED_FILE: 'INVALID_GENERATED_FILE',
  MODEL_NOT_SUPPORTED: 'MODEL_NOT_SUPPORTED',
  DIRECTOR_REFERENCE_SUBSCRIPTION_REQUIRED: 'DIRECTOR_REFERENCE_SUBSCRIPTION_REQUIRED',
  VIBE_ENCODING_LIMIT_REACHED: 'VIBE_ENCODING_LIMIT_REACHED',
  VIBE_NOT_AVAILABLE: 'VIBE_NOT_AVAILABLE',
});

export const GENERATION_ERROR_MESSAGE_KEYS = Object.freeze({
  [GENERATION_ERROR_CODES.INVALID_PARAMETER]: 'painting.workspace.errors.invalidParameters',
  [GENERATION_ERROR_CODES.RATE_LIMITED]: 'painting.workspace.errors.rateLimited',
  [GENERATION_ERROR_CODES.NETWORK_ERROR]: 'painting.workspace.errors.network',
  [GENERATION_ERROR_CODES.TIMEOUT]: 'painting.workspace.errors.timeout',
  [GENERATION_ERROR_CODES.UNAUTHORIZED]: 'painting.workspace.errors.unauthorized',
  [GENERATION_ERROR_CODES.FORBIDDEN]: 'painting.workspace.errors.forbidden',
  [GENERATION_ERROR_CODES.SERVICE_UNAVAILABLE]: 'painting.workspace.errors.serviceUnavailable',
  [GENERATION_ERROR_CODES.GENERATION_FAILED]: 'painting.workspace.errors.generationFailed',
  [GENERATION_ERROR_CODES.INVALID_GENERATED_FILE]: 'painting.workspace.errors.invalidGeneratedFile',
  [GENERATION_ERROR_CODES.MODEL_NOT_SUPPORTED]: 'painting.workspace.errors.modelNotSupported',
  [GENERATION_ERROR_CODES.DIRECTOR_REFERENCE_SUBSCRIPTION_REQUIRED]: 'painting.workspace.errors.directorReferenceSubscriptionRequired',
  [GENERATION_ERROR_CODES.VIBE_ENCODING_LIMIT_REACHED]: 'painting.workspace.errors.vibeEncodingLimitReached',
  [GENERATION_ERROR_CODES.VIBE_NOT_AVAILABLE]: 'painting.workspace.errors.vibeNotAvailable',
});

const KNOWN_CODES = new Set(Object.values(GENERATION_ERROR_CODES));
const KNOWN_CATEGORIES = new Set([
  'authentication', 'forbidden', 'http', 'network', 'parameter',
  'rate_limit', 'server', 'timeout',
]);

export function getGenerationErrorCategory(code, category = '') {
  if (KNOWN_CATEGORIES.has(category)) return category;
  if (code === GENERATION_ERROR_CODES.INVALID_PARAMETER) return 'parameter';
  if (code === GENERATION_ERROR_CODES.RATE_LIMITED) return 'rate_limit';
  if (code === GENERATION_ERROR_CODES.NETWORK_ERROR) return 'network';
  if (code === GENERATION_ERROR_CODES.TIMEOUT) return 'timeout';
  return 'unknown';
}

export function normalizeGenerationErrorCode(error, fallbackCode = GENERATION_ERROR_CODES.GENERATION_FAILED) {
  const directCode = typeof error === 'string'
    ? error
    : error?.code || error?.errorCode || error?.data?.code;
  if (KNOWN_CODES.has(directCode)) return directCode;

  switch (error?.category) {
    case 'parameter': return GENERATION_ERROR_CODES.INVALID_PARAMETER;
    case 'rate_limit': return GENERATION_ERROR_CODES.RATE_LIMITED;
    case 'network': return GENERATION_ERROR_CODES.NETWORK_ERROR;
    case 'timeout': return GENERATION_ERROR_CODES.TIMEOUT;
    default: break;
  }
  switch (error?.statusCode || error?.status) {
    case 400:
    case 422: return GENERATION_ERROR_CODES.INVALID_PARAMETER;
    case 401: return GENERATION_ERROR_CODES.UNAUTHORIZED;
    case 403: return GENERATION_ERROR_CODES.FORBIDDEN;
    case 408:
    case 504: return GENERATION_ERROR_CODES.TIMEOUT;
    case 429: return GENERATION_ERROR_CODES.RATE_LIMITED;
    case 502:
    case 503: return GENERATION_ERROR_CODES.SERVICE_UNAVAILABLE;
    default: return fallbackCode;
  }
}

export function createGenerationError(code, options = {}) {
  const normalizedCode = normalizeGenerationErrorCode(code);
  const errorId = extractErrorId(options);
  return Object.assign(new Error(normalizedCode), {
    code: normalizedCode,
    category: getGenerationErrorCategory(normalizedCode, options.category),
    statusCode: options.statusCode,
    ...(errorId ? { errorId } : {}),
    ...(typeof options.model === 'string' ? { model: options.model } : {}),
  });
}

export function createGenerationFailure(code, details = {}) {
  const normalizedCode = normalizeGenerationErrorCode(code);
  const errorId = extractErrorId(details);
  return {
    ...details,
    success: false,
    code: normalizedCode,
    category: getGenerationErrorCategory(normalizedCode, details.category),
    ...(errorId ? { errorId } : {}),
  };
}
