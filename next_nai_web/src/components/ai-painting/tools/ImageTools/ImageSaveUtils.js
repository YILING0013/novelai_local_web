// ImageSaveUtils.js
// 图像保存和文件名生成工具类


export const DOWNLOAD_NAMING_METHODS = [
  { value: 'seed', labelKey: 'settings.naming.seed' },
  { value: 'prompt32', labelKey: 'settings.naming.prompt32' },
  { value: 'localDateTime', labelKey: 'settings.naming.localDateTime' },
  { value: 'timestamp', labelKey: 'settings.naming.timestamp' },
  { value: 'random', labelKey: 'settings.naming.random' },
  { value: 'custom', labelKey: 'settings.naming.custom' },
];

// 自定义模板可用的变量；{prompt:20}、{random:6} 这类写法可指定长度。
export const FILE_NAME_TEMPLATE_TOKENS = ['prefix', 'seed', 'prompt', 'date', 'time', 'timestamp', 'random'];
export const DEFAULT_FILE_NAME_TEMPLATE = '{prefix}_{seed}_{date}';

/**
 * 生成随机字符串
 *
 * Args:
 *   length: 随机字符串长度。
 *
 * Returns:
 *   string: 生成的随机字符串。
 */
export const generateRandomString = (length = 8) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};
  
/**
 * 按浏览器当前时区格式化日期为指定格式。
 *
 * Args:
 *   date: 日期对象。
 *   format: 日期格式字符串。
 *
 * Returns:
 *   string: 格式化后的日期字符串。
 */
export const formatDate = (date, format = 'yyyyMMdd_HHmmss') => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace('yyyy', year)
    .replace('MM', month)
    .replace('dd', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
};

/**
 * 清理文件名片段中的非法字符。
 *
 * Args:
 *   value: 待清理的文件名片段。
 *   fallback: 清理后为空时使用的兜底文本。
 *
 * Returns:
 *   string: 可安全用于浏览器下载文件名的片段。
 */
export const sanitizeFileNamePart = (value, fallback = 'image') => {
  const sanitized = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  return sanitized || fallback;
};

/**
 * 获取图像的正面提示词片段。
 *
 * Args:
 *   image: 图像对象，优先读取 prompt / positivePrompt / metadata.positivePrompt。
 *
 * Returns:
 *   string: 正面提示词前 32 个字符，缺失时返回空字符串。
 */
export const getPositivePromptNamePart = (image = {}, length = 32) => {
  const prompt = image.prompt
    || image.positivePrompt
    || image.metadata?.positivePrompt
    || image.metadata?.prompt
    || '';

  return Array.from(String(prompt).trim()).slice(0, length).join('');
};

/**
 * 按用户模板拼出文件名主体，例如 "{prefix}_{seed}_{date}"。
 * 变量值和模板里的普通文字都会清理非法字符；不认识的变量原样保留，便于在预览里发现拼写错误。
 * @param {string} template 用户填写的模板。
 * @param {object} image 图像对象，提供 seed、prompt 等信息。
 * @param {object} settings 图像命名设置，提供 fileNamePrefix。
 * @param {string|number} fallbackName 没有种子时使用的名称。
 * @returns {string} 不含扩展名的文件名，模板结果为空时返回空字符串。
 */
export const renderFileNameTemplate = (template, image, settings, fallbackName) => {
  const now = new Date();
  const values = {
    prefix: () => settings.fileNamePrefix,
    seed: () => image.seed ?? fallbackName,
    prompt: (length) => getPositivePromptNamePart(image, length || 32),
    date: () => formatDate(now, 'yyyy-MM-dd'),
    time: () => formatDate(now, 'HH-mm-ss'),
    timestamp: () => now.getTime(),
    random: (length) => generateRandomString(length || 8),
  };
  const name = String(template || DEFAULT_FILE_NAME_TEMPLATE).replace(/\{(\w+)(?::(\d{1,3}))?\}/g, (token, key, length) => (
    Object.hasOwn(values, key) ? sanitizeFileNamePart(values[key](Math.min(Number(length) || 0, 120)), '') : token
  ));
  return sanitizeFileNamePart(name, '');
};

const normalizeExtension = (extension = 'png') => (
  String(extension || 'png').replace(/^\./, '').toLowerCase() || 'png'
);
  
/**
 * 根据设置生成下载文件名。
 *
 * Args:
 *   image: 图像对象，包含 seed、prompt、id 等信息。
 *   imageSettings: 图像下载命名设置对象。
 *   options: 额外选项，支持 extension 与 fallbackName。
 *
 * Returns:
 *   string: 生成的文件名。
 */
export const generateFileName = (image = {}, imageSettings = {}, options = {}) => {
  const defaultSettings = {
    fileNamePrefix: 'AI_Image',
    fileNameSuffix: '',
    namingMethod: 'seed',
    randomStringLength: 8,
    includeDateInName: false,
    dateFormat: 'yyyyMMdd_HHmmss'
  };

  const settings = { ...defaultSettings, ...imageSettings };
  const fallbackName = options.fallbackName || image.seed || image.id || Math.floor(Math.random() * 1000000000);
  const extension = normalizeExtension(options.extension || (image.type === 'video' ? 'mp4' : 'png'));
  // 自定义模板自己决定前缀和各部分顺序，不再套用下面的固定拼法。
  if (settings.namingMethod === 'custom') {
    return `${renderFileNameTemplate(settings.fileNameTemplate, image, settings, fallbackName) || sanitizeFileNamePart(fallbackName)}.${extension}`;
  }
  let coreName = '';

  // 根据命名预设生成主体，手动下载和自动下载共享同一套规则。
  switch (settings.namingMethod) {
    case 'prompt32':
      coreName = getPositivePromptNamePart(image) || fallbackName;
      break;
    case 'timestamp':
      coreName = Date.now();
      break;
    case 'localDateTime':
      // 使用本地日期字段，年月日和时分秒都遵循用户设备当前时区。
      coreName = formatDate(new Date(), 'yyyy-MM-dd_HH-mm-ss');
      break;
    case 'random':
      coreName = generateRandomString(settings.randomStringLength || 8);
      break;
    case 'seed':
    default:
      coreName = image.seed || fallbackName;
      break;
  }

  const nameParts = [
    settings.fileNamePrefix,
    coreName,
    settings.includeDateInName ? formatDate(new Date(), settings.dateFormat) : '',
    settings.fileNameSuffix,
  ]
    .map((part) => sanitizeFileNamePart(part, ''))
    .filter(Boolean);

  return `${nameParts.join('_') || sanitizeFileNamePart(fallbackName)}.${extension}`;
};
  
/**
 * 从 localStorage 读取图像下载设置。
 *
 * Args:
 *   None.
 *
 * Returns:
 *   Object: 图像下载设置对象。
 */
export const getImageSettings = () => {
  return {
    fileNamePrefix: localStorage.getItem('fileNamePrefix') || 'AI_Image',
    fileNameSuffix: '',
    namingMethod: localStorage.getItem('namingMethod') || 'seed',
    fileNameTemplate: localStorage.getItem('fileNameTemplate') || DEFAULT_FILE_NAME_TEMPLATE,
    randomStringLength: 8,
    includeDateInName: false,
    dateFormat: 'yyyyMMdd_HHmmss'
  };
};
