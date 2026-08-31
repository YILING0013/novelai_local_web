import { useCallback, useEffect, useRef, useState } from 'react';
import { generateImage } from './ImageGenerationService';
import batchController from '../tools/BatchGeneration/BatchGenerationService';
import apiClient from '@/utils/ApiClient';
import {
  createGenerationError,
  GENERATION_ERROR_CODES,
  normalizeGenerationErrorCode,
} from './errors';

const createIdleStatus = () => ({
  status: 'idle',
  queuePosition: null,
  progress: 0,
  error: null,
  errorCode: null,
  errorId: null,
  category: null,
  statusCode: null,
  model: null,
  terminalGenerationFailed: false,
});

const useImageGeneration = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState(createIdleStatus);
  const [batchStatus, setBatchStatus] = useState(batchController.getStatus());
  const generatingRef = useRef(false);
  const batchIdRef = useRef('');

  const startGeneration = useCallback(async (params) => {
    if (generatingRef.current) return null;
    generatingRef.current = true;
    setIsGenerating(true);
    setGenerationStatus({
      ...createIdleStatus(),
      status: 'processing',
      progress: 10,
      model: params.model || null,
    });

    try {
      const result = await generateImage(params);
      if (!result.success) {
        throw createGenerationError(
          normalizeGenerationErrorCode(result, GENERATION_ERROR_CODES.GENERATION_FAILED),
          {
            category: result.category,
            statusCode: result.statusCode,
            errorId: result.errorId,
            model: result.model || params.model,
          },
        );
      }

      setGenerationStatus({
        ...createIdleStatus(),
        status: 'completed',
        progress: 100,
        model: result.model || params.model || null,
      });
      return {
        id: `${Date.now()}-${params.index ?? 0}`,
        src: result.imageUrl || result.image,
        originalSrc: result.downloadUrl || result.imageUrl || result.image,
        downloadSrc: result.downloadUrl || result.imageUrl || result.image,
        cachedBlob: result.cachedBlob || null,
        objectUrlToRevoke: result.objectUrlToRevoke || null,
        seed: result.seed ?? params.seed ?? '',
        prompt: params.positivePrompt || '',
        width: result.width,
        height: result.height,
        isComposited: false,
        model: result.model || params.model || null,
      };
    } catch (error) {
      const normalizedError = createGenerationError(
        normalizeGenerationErrorCode(error, GENERATION_ERROR_CODES.GENERATION_FAILED),
        {
          category: error?.category,
          statusCode: error?.statusCode,
          errorId: error?.errorId,
          model: error?.model || params.model,
        },
      );
      setGenerationStatus({
        ...createIdleStatus(),
        status: 'failed',
        errorCode: normalizedError.code,
        errorId: normalizedError.errorId || null,
        category: normalizedError.category || null,
        statusCode: normalizedError.statusCode || null,
        model: normalizedError.model || params.model || null,
      });
      throw normalizedError;
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  }, []);

  const startBatchGeneration = useCallback(async (params, onImageGenerated, onBatchError) => {
    const batchSize = Math.min(8, Math.max(1, Number.parseInt(params.batchSize, 10) || 1));
    const batchId = crypto.randomUUID();
    batchIdRef.current = batchId;
    batchController.initialize(batchSize);
    batchController.setParams(params);
    setBatchStatus({ ...batchController.getStatus() });

    while (batchController.shouldContinue()) {
      const imageIndex = batchController.status.current - 1;
      try {
        const imageResult = await startGeneration({
          ...batchController.getParams(),
          batch_id: batchId,
          index: imageIndex,
          batch_size: batchSize,
        });
        if (!imageResult) throw createGenerationError(GENERATION_ERROR_CODES.GENERATION_FAILED);

        batchController.completeCurrentImage(true);
        setBatchStatus({ ...batchController.getStatus() });
        if (typeof onImageGenerated === 'function') onImageGenerated(imageResult);

        if (batchController.shouldContinue()) {
          await batchController.wait(batchController.config.bufferTime);
          setBatchStatus({ ...batchController.getStatus() });
        }
      } catch (error) {
        batchController.completeCurrentImage(false);
        batchController.handleError(error, (errorDetails) => {
          if (typeof onBatchError === 'function') {
            onBatchError(errorDetails, imageIndex + 1, batchSize);
          }
        });
        setBatchStatus({ ...batchController.getStatus() });
        await apiClient.cancelImageBatch(batchId).catch(() => {});
        break;
      }
    }

    batchIdRef.current = '';
    return batchController.getStatus();
  }, [startGeneration]);

  const stopBatchGeneration = useCallback((updateUi, keepalive = false) => {
    const batchId = batchIdRef.current;
    batchController.cancel();
    batchIdRef.current = '';
    if (updateUi) setBatchStatus({ ...batchController.getStatus() });
    if (batchId) void apiClient.cancelImageBatch(batchId, keepalive).catch(() => {});
  }, []);

  const cancelBatchGeneration = useCallback(() => {
    stopBatchGeneration(true);
  }, [stopBatchGeneration]);

  useEffect(() => () => {
    // 页面关闭、路由切换或退出登录时，只拦截尚未发送的后续请求。
    stopBatchGeneration(false, true);
  }, [stopBatchGeneration]);

  const resetGeneration = useCallback(() => setGenerationStatus(createIdleStatus()), []);

  return {
    isGenerating,
    generationStatus,
    startGeneration,
    resetGeneration,
    setIsGenerating,
    setGenerationStatus,
    batchStatus,
    startBatchGeneration,
    cancelBatchGeneration,
  };
};

export default useImageGeneration;
