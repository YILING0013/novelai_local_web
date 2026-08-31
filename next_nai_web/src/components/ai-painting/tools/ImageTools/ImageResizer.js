// gcd - 计算两个整数的最大公约数
function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
  }
  
  // 生成允许分辨率列表（仅保留每种比例下面积最大的尺寸）
  function generateOptimizedAllowedResolutions() {
    const maxProduct = 1024 * 1024; // 1048576
    const maxValue = 2048;
    const step = 64;
    const groups = new Map();
  
    for (let width = step; width <= maxValue; width += step) {
      for (let height = step; height <= maxValue; height += step) {
        if (width * height > maxProduct) continue;
        const normW = width / step;
        const normH = height / step;
        const d = gcd(normW, normH);
        const key = `${normW / d}:${normH / d}`;
        const area = width * height;
        if (!groups.has(key) || area > groups.get(key).area) {
          groups.set(key, { width, height, area });
        }
      }
    }
    return [...groups.values()].map(({ width, height }) => [width, height]);
  }

  /**
   * 检查给定的分辨率是否超过允许的限制
   * @param {number} width - 图像宽度
   * @param {number} height - 图像高度
   * @returns {object} 包含检查结果的对象
   */
  export function checkResolutionLimit(width, height) {
    const allowedResolutions = generateOptimizedAllowedResolutions();
    const maxAllowedArea = Math.max(...allowedResolutions.map(([w, h]) => w * h));
    const currentArea = width * height;
    
    // 检查是否有完全匹配的分辨率
    const exactMatch = allowedResolutions.some(([w, h]) => w === width && h === height);
    
    // 检查面积是否超过限制
    const exceedsAreaLimit = currentArea > maxAllowedArea;
    
    // 检查宽度或高度是否超过单个维度限制
    const exceedsDimensionLimit = width > 2048 || height > 2048;
    
    const isOverLimit = !exactMatch || exceedsAreaLimit || exceedsDimensionLimit;
    
    return {
      isOverLimit,
      currentResolution: { width, height },
      currentArea,
      maxAllowedArea,
      exceedsAreaLimit,
      exceedsDimensionLimit,
      exactMatch,
      // 计算建议的分辨率
      suggestedResolution: isOverLimit ? pickTargetResolution(width, height, allowedResolutions) : null
    };
  }

  /**
   * 获取最大允许的分辨率信息
   * @returns {object} 最大允许分辨率的相关信息
   */
  export function getMaxAllowedResolution() {
    const allowedResolutions = generateOptimizedAllowedResolutions();
    const maxArea = Math.max(...allowedResolutions.map(([w, h]) => w * h));
    const maxResolution = allowedResolutions.find(([w, h]) => w * h === maxArea);
    
    return {
      maxArea,
      maxResolution,
      maxWidth: 2048,
      maxHeight: 2048
    };
  }
  
  // 根据原图尺寸和允许分辨率，挑选最合适的目标尺寸
  function pickTargetResolution(origWidth, origHeight, allowedResolutions) {
    const inputRatio = origWidth / origHeight;
    
    // 找出比例最接近的分辨率
    let bestDiff = Infinity;
    allowedResolutions.forEach(([w, h]) => {
      const diff = Math.abs(w / h - inputRatio);
      if (diff < bestDiff) {
        bestDiff = diff;
      }
    });

    // 获取比例差异在可接受范围内的候选项
    const diffThreshold = bestDiff * 1.1; // 允许10%的比例差异
    const ratioCandidates = allowedResolutions.filter(
      ([w, h]) => Math.abs(w / h - inputRatio) <= diffThreshold
    );

    // 按面积（像素总数）从大到小排序
    ratioCandidates.sort((a, b) => (b[0] * b[1]) - (a[0] * a[1]));
    
    // 尝试找到比原图大但不超过2048的最小候选
    const biggerCandidates = ratioCandidates.filter(
      ([w, h]) => w >= origWidth && h >= origHeight && w <= 2048 && h <= 2048
    );
    
    if (biggerCandidates.length > 0) {
      // 返回面积最小的那个大分辨率（更接近原图）
      return biggerCandidates.reduce((acc, cur) => 
        cur[0] * cur[1] < acc[0] * acc[1] ? cur : acc
      );
    }

    // 如果没有更大的合适尺寸，尝试找到比例接近且尽量不损失太多分辨率的
    const smallerCandidates = ratioCandidates.filter(
      ([w, h]) => (w * h) >= (origWidth * origHeight * 0.7) // 至少保留70%的像素
    );
    
    if (smallerCandidates.length > 0) {
      return smallerCandidates[0]; // 已经按面积排序，取最大的
    }
    
    // 如果没有合适的候选，返回面积最大的那个比例接近的分辨率
    return ratioCandidates[0] || allowedResolutions[0];
  }
  
  // 使用 Canvas 进行彩色图像缩放 - 优化视觉质量
  function resizeImageCanvas(img, targetWidth, targetHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
  
    const inputArea = img.width * img.height;
    const targetArea = targetWidth * targetHeight;
    const inputRatio = img.width / img.height;
    const targetRatio = targetWidth / targetHeight;
    const ratioDiff = Math.abs(inputRatio - targetRatio);
  
    // 设置平滑算法 - 彩色图像使用默认算法以获得更好的视觉效果
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  
    // 上采样且比例相近时，letterbox 等比放大
    if (inputArea < targetArea && ratioDiff < 0.05) {
      const scale = Math.min(targetWidth / img.width, targetHeight / img.height);
      const newWidth = img.width * scale;
      const newHeight = img.height * scale;
      const dx = (targetWidth - newWidth) / 2;
      const dy = (targetHeight - newHeight) / 2;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, dx, dy, newWidth, newHeight);
    } else {
      // 下采样或比例差较大时，直接强制拉伸
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    }
    return canvas.toDataURL("image/png");
  }
  
  /**
   * 核心封装：传入 File / base64 / url / 不完整DataURL 等，自动根据逻辑挑选目标分辨率并缩放返回新的 base64
   * @param {File|string} input - 图片文件、base64、url 或不完整dataURL
   * @returns {Promise<object>} 包含缩放后的 DataURL 和尺寸的对象
   */
  export const IMAGE_RESIZE_ERROR_CODES = Object.freeze({
    INPUT_UNSUPPORTED: 'IMAGE_RESIZE_INPUT_UNSUPPORTED',
    FILE_READ_FAILED: 'IMAGE_RESIZE_FILE_READ_FAILED',
    IMAGE_LOAD_FAILED: 'IMAGE_RESIZE_IMAGE_LOAD_FAILED',
    DOWNLOAD_FAILED: 'IMAGE_RESIZE_DOWNLOAD_FAILED',
  });

  /**
   * 创建带稳定客户端错误码的缩放异常。
   *
   * Args:
   *   code: 供界面本地化的错误码。
   *
   * Returns:
   *   Error: message 与 code 均为稳定错误码的异常。
   */
  function createResizeError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  export async function resizeImage(input) {
    const allowedResolutions = generateOptimizedAllowedResolutions();
    const dataURL = await convertToDataURL(input);
    const img = await loadImage(dataURL);
    const [w, h] = pickTargetResolution(img.width, img.height, allowedResolutions);
    const resizedDataURL = resizeImageCanvas(img, w, h);
    return { dataURL: resizedDataURL, width: w, height: h };
  }
  
  // 工具函数 - 统一将各种输入转换为完整 DataURL
  async function convertToDataURL(input) {
    if (input instanceof File) {
      return fileToDataURL(input);
    }
    // 如果是字符串
    if (typeof input === "string") {
      // 已经是 dataURL
      if (input.startsWith("data:image")) {
        return input;
      }
      // 如果只是 base64 无前缀，例如 iVBORw0KGgo 或 /9j/4AAQSk
      // 简单检测base64特征
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(input.replace(/\s/g, ""))) {
        return `data:image/png;base64,${input}`;
      }
      // 否则将其视作普通 URL 尝试加载后转 dataURL
      return await fetchAsDataURL(input);
    }
    throw createResizeError(IMAGE_RESIZE_ERROR_CODES.INPUT_UNSUPPORTED);
  }
  
  // 工具函数 - File 转 DataURL
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(createResizeError(IMAGE_RESIZE_ERROR_CODES.FILE_READ_FAILED));
      reader.readAsDataURL(file);
    });
  }
  
  // 工具函数 - 加载 base64 / 完整dataURL 返回 HTMLImageElement
  function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(createResizeError(IMAGE_RESIZE_ERROR_CODES.IMAGE_LOAD_FAILED));
      image.src = dataURL;
    });
  }
  
  // 工具函数 - 远程 URL 转 DataURL
  async function fetchAsDataURL(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw createResizeError(IMAGE_RESIZE_ERROR_CODES.DOWNLOAD_FAILED);
    }
    const blob = await response.blob();
    return fileToDataURL(blob);
  }
