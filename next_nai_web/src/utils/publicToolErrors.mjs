export const PUBLIC_TOOL_ERROR_MESSAGE_KEYS = Object.freeze({
  IMAGE_UPLOAD_BLOCKED: 'painting.workspace.errors.uploadBlocked',
  IMAGE_UPLOAD_FILE_REQUIRED: 'painting.workspace.errors.uploadFileRequired',
  IMAGE_UPLOAD_FILE_TOO_LARGE: 'painting.workspace.errors.uploadFileTooLarge',
  IMAGE_UPLOAD_FORMAT_NOT_SUPPORTED: 'painting.workspace.errors.uploadFormatNotSupported',
  IMAGE_UPLOAD_RATE_LIMITED: 'painting.workspace.errors.uploadRateLimited',
  IMAGE_UPLOAD_READ_FAILED: 'painting.workspace.errors.uploadReadFailed',
  IMAGE_UPLOAD_SAVE_FAILED: 'painting.workspace.errors.uploadSaveFailed',
  RANDOM_PROMPT_CONFIG_INVALID: 'painting.tools.randomPrompt.errors.configInvalid',
  RANDOM_PROMPT_CONFIG_LIMIT_EXCEEDED: 'painting.tools.randomPrompt.errors.configLimitExceeded',
  RANDOM_PROMPT_SERVICE_UNAVAILABLE: 'painting.tools.randomPrompt.errors.serviceUnavailable',
});

/**
 * 将本地绘图工具异常转换为统一的本地化键。
 *
 * Args:
 *   error: ApiClient 异常或稳定工具业务码。
 *   fallbackKey: 当前工具界面的安全兜底翻译键。
 *
 * Returns:
 *   string: 可直接交给翻译函数的键，不读取后端自然语言正文。
 */
export function getPublicToolErrorMessageKey(
  error,
  fallbackKey = 'painting.workspace.errors.generic',
) {
  const code = error?.data?.code || error?.data?.error_code || error?.code;
  return PUBLIC_TOOL_ERROR_MESSAGE_KEYS[code] || fallbackKey;
}
