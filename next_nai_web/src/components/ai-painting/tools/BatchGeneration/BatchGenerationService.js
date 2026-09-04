// BatchGenerationService.js
// 批量生成控制类
class BatchGenerationController {
  constructor(clock = {}) {
  // 原生 Window.setTimeout/clearTimeout 需要正确的调用上下文。
  // 如果直接保存后再以 this.clock.setTimeout(...) 调用，部分浏览器会抛出
  // TypeError: Illegal invocation，导致首张成功后批量流程立即进入失败清理。
  const now = typeof clock.now === 'function'
    ? clock.now.bind(clock)
    : () => Date.now();

  const setTimeoutFn = typeof clock.setTimeout === 'function'
    ? clock.setTimeout.bind(clock)
    : globalThis.setTimeout.bind(globalThis);

  const clearTimeoutFn = typeof clock.clearTimeout === 'function'
    ? clock.clearTimeout.bind(clock)
    : globalThis.clearTimeout.bind(globalThis);

  this.clock = {
    now,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
  };
    // 批量生成状态
    this.status = {
      active: false,      // 是否正在进行批量生成
      current: 0,         // 当前正在处理的图像索引
      total: 0,           // 总计划生成的图像数量
      completed: 0,       // 成功完成的图像数量
      failed: 0,          // 失败的图像数量
      errors: [],         // 错误记录
      waitingTime: 0,     // 等待时间（秒）
    };
    
    // 控制引用
    this.control = {
      cancel: false,      // 是否取消批量生成
      currentTimeout: null, // 当前等待的timeout ID
      currentWaitResolve: null,
      params: null,       // 当前批量生成使用的参数
    };
    
    // 批量生成配置
    this.config = {
      bufferTime: 15,     // 每次生成间的缓冲时间（秒）
    };
    
  }
  
  // 初始化批量生成
  initialize(batchSize) {
    this.status = {
      active: true,
      current: 1,
      total: batchSize,
      completed: 0,
      failed: 0,
      errors: [],
      waitingTime: 0,
    };
    
    this.control = {
      cancel: false,
      currentTimeout: null,
      currentWaitResolve: null,
      params: null,
    };
    
  }
  
  // 取消批量生成
  cancel() {
    this.status.active = false;
    this.control.cancel = true;
    
    // 取消当前等待的timeout
    if (this.control.currentTimeout !== null) {
      this.clock.clearTimeout(this.control.currentTimeout);
      this.control.currentTimeout = null;
    }
    if (this.control.currentWaitResolve) {
      const resolveWait = this.control.currentWaitResolve;
      this.control.currentWaitResolve = null;
      this.status.waitingTime = 0;
      resolveWait();
    }
    
    return this.status;
  }

  // 当前状态是否允许继续发送下一张图片。
  shouldContinue() {
    return this.status.active && !this.control.cancel;
  }
  
  // 完成当前图像生成
  completeCurrentImage(success) {
    if (success) {
      this.status.completed++;
    } else {
      this.status.failed++;
    }
    
    // 增加当前索引
    this.status.current++;
    
    // 检查是否完成所有图像
    if (this.status.current > this.status.total) {
      this.status.active = false;
    }
    
    return this.status;
  }
  
  // 添加错误记录
  addError(errorLike) {
    const normalizedError = typeof errorLike === 'string'
      ? { code: errorLike }
      : (errorLike || {});
    const error = {
      code: normalizedError.code || 'BATCH_UNKNOWN_ERROR',
      category: normalizedError.category || 'unknown',
      statusCode: normalizedError.statusCode || null,
      errorId: normalizedError.errorId || normalizedError.error_id || null,
      model: normalizedError.model || null,
      timestamp: Date.now(),
    };
    
    this.status.errors = [...this.status.errors, error];
    if (this.status.errors.length > 10) {
      // 保留最近的10条错误记录
      this.status.errors = this.status.errors.slice(-10);
    }
    
    return error;
  }
  
  // 处理错误，返回应该采取的行动，同时提供回调函数通知UI
  handleError(error, notifyUICallback = null) {
    const errorObj = this.addError(error);
    
    // 如果提供了通知回调函数，调用它显示错误
    if (notifyUICallback && typeof notifyUICallback === 'function') {
      notifyUICallback(errorObj, 'error');
    }
    
    // 本地连续生成遇到任意错误都立即终止，不自动重试或跳过。
    this.cancel();
    return 'stop';
  }
  
  // 等待指定时间
  async wait(seconds) {
    this.status.waitingTime = seconds;
    
    // 创建一个Promise，每秒更新一次状态
    return new Promise((resolve) => {
      this.control.currentWaitResolve = resolve;
      const startTime = this.clock.now();
      const updateInterval = 1000; // 1秒
      
      const countdown = () => {
        const elapsedTime = Math.floor((this.clock.now() - startTime) / 1000);
        const remainingTime = seconds - elapsedTime;
        
        if (remainingTime <= 0 || this.control.cancel) {
          this.status.waitingTime = 0;
          if (this.control.currentTimeout !== null) {
            this.clock.clearTimeout(this.control.currentTimeout);
            this.control.currentTimeout = null;
          }
          this.control.currentWaitResolve = null;
          resolve();
          return;
        }
        
        this.status.waitingTime = remainingTime;
        this.control.currentTimeout = this.clock.setTimeout(countdown, updateInterval);
      };
      
      countdown();
    });
  }
  
  // 获取当前状态
  getStatus() {
    return { ...this.status };
  }
  
  // 设置批量生成参数
  setParams(params) {
    // 保存获取最新参数的回调函数
    const getLatestParams = params.getLatestParams;
    
    // 创建新的参数对象
    this.control.params = { ...params };
    
    // 确保每次生成使用不同的种子
    if (!this.control.params.seed || this.control.params.seed === '') {
      this.control.params.seed = Math.floor(Math.random() * 4294967295);
    }
    
    // 保留获取最新参数的回调函数
    if (getLatestParams && typeof getLatestParams === 'function') {
      this.control.params.getLatestParams = getLatestParams;
    }
    
    return this.control.params;
  }
  
  // 获取用于当前生成的参数
  getParams() {
    // 如果提供了获取最新参数的回调函数，则调用它获取实时参数
    if (this.control.params && this.control.params.getLatestParams && typeof this.control.params.getLatestParams === 'function') {
      try {
        // 获取最新参数
        const latestParams = this.control.params.getLatestParams();
        
        // 确保参数中包含必要的内容
        if (latestParams) {
          // 生成新的种子
          const newSeed = Math.floor((this.clock.now() % 1000000) * (this.status.current + 1)) % 4294967295;
          
          // 返回最新参数，并保留一些特殊处理
          return {
            ...latestParams,
            seed: newSeed, // 使用新的种子
            // 保留获取最新参数的回调函数，确保下次调用时仍可获取
            getLatestParams: this.control.params.getLatestParams
          };
        }
      } catch (error) {
        console.error('获取最新参数失败:', error);
        // 如果获取最新参数失败，回退到原来的方法
      }
    }
    
    // 如果没有获取最新参数的回调函数，或者回调函数失败，则使用原来的方法
    if (this.control.params) {
      // 使用由时间和当前索引生成的随机种子
      const newSeed = Math.floor((this.clock.now() % 1000000) * (this.status.current + 1)) % 4294967295;
      return {
        ...this.control.params,
        seed: newSeed, // 使用新的种子
      };
    }
    
    return null;
  }
}

// 创建单例实例
const batchController = new BatchGenerationController();

export { BatchGenerationController };
export default batchController;
