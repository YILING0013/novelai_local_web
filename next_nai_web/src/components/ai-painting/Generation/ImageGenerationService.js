import apiClient from '@/utils/ApiClient';
import {
  createBlobFromBase64,
  createObjectUrlFromBlob,
} from '@/utils/mediaAssets';
import {
  isNovelAIDirectorReferenceModel,
  isNovelAIV4OrAboveModel as isV4Model,
  normalizePaintingModelId,
  sanitizeNovelAIV5GenerationParams,
} from '../utils/modelUtils';
import { buildNovelAIImageRequestParams } from '../utils/novelAIRequestParams.mjs';
import {
  createGenerationFailure,
  GENERATION_ERROR_CODES,
  normalizeGenerationErrorCode,
} from './errors';

const extractBase64FromDataUrl = (dataUrl) => {
  if (!dataUrl) return null;
  const matches = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  return matches ? matches[1] : dataUrl;
};

/**
 * 按原生成页参数构造本地后端接收的 NovelAI 请求体。
 *
 * @param {object} params 当前生成参数。
 * @returns {object} 未封装、未加密的普通 JSON 请求体。
 */
function buildGenerationRequest(params) {
  const requestBody = buildNovelAIImageRequestParams(params, !isV4Model(params.model));

  if (
    isNovelAIDirectorReferenceModel(params.model)
    && Array.isArray(params.director_reference_images_cached)
    && params.director_reference_images_cached.length > 0
  ) {
    requestBody.director_reference_images_cached = params.director_reference_images_cached.map((image) => ({
      cache_secret_key: image.cache_secret_key,
      data: image.data,
    }));
    requestBody.director_reference_descriptions = params.director_reference_descriptions;
    requestBody.director_reference_strength_values = params.director_reference_strength_values;
    requestBody.director_reference_secondary_strength_values = params.director_reference_secondary_strength_values;
    requestBody.director_reference_information_extracted = params.director_reference_information_extracted;
  }

  if (params.characterControl?.enabledCharacterCount > 0) {
    requestBody.characterPrompts = params.characterControl.characterPrompts || [];
    requestBody.v4_prompt_char_captions = params.characterControl.v4_prompt_char_captions || [];
    requestBody.v4_negative_prompt_char_captions = params.characterControl.v4_negative_prompt_char_captions || [];
    requestBody.use_coords = params.characterControl.use_coords !== undefined
      ? params.characterControl.use_coords
      : Boolean(params.characterControl.aiDecidePosition);
  }

  if (params.vibeTransfer) {
    if (isV4Model(params.model)) {
      if (params.vibeTransfer.use_v4_vibe && params.vibeTransfer.reference_image_multiple) {
        requestBody.reference_image_multiple = params.vibeTransfer.reference_image_multiple;
        requestBody.reference_strength_multiple = params.vibeTransfer.reference_strength_multiple || [];
      }
    } else if (Array.isArray(params.vibeTransfer.images) && params.vibeTransfer.images.length > 0) {
      requestBody.reference_image_multiple = params.vibeTransfer.images.map(extractBase64FromDataUrl);
      requestBody.reference_information_extracted_multiple = params.vibeTransfer.informationExtracted || [];
      requestBody.reference_strength_multiple = params.vibeTransfer.referenceStrength || [];
    }
  }

  if (params.imageToImage) {
    requestBody.image = extractBase64FromDataUrl(params.imageToImage.image);
    requestBody.noise = params.imageToImage.noise || 0;
    requestBody.strength = params.imageToImage.strength ?? 0.7;
    requestBody.action = true;

    if (params.imageToImage.mask) {
      requestBody.mask = extractBase64FromDataUrl(params.imageToImage.mask);
      requestBody.inpaint_strength = params.imageToImage.inpaintStrength ?? 1;
      requestBody.disabled_original_image = Boolean(params.imageToImage.disabledOriginalImage);
      requestBody.color_correct = params.imageToImage.colorCorrect ?? true;
    }

    const directorTools = params.imageToImage.directorTools;
    if (directorTools?.active) {
      requestBody.req_type = directorTools.tool;
      if (directorTools.tool === 'emotion') {
        const toolParams = directorTools.params || {};
        requestBody.prompt = `${toolParams.emotion || ''}${toolParams.prompt ? `;; ${toolParams.prompt}` : ''}`;
        if (toolParams.defry !== undefined) requestBody.defry = toolParams.defry;
      } else if (directorTools.tool === 'colorize') {
        const toolParams = directorTools.params || {};
        requestBody.prompt = toolParams.prompt || '';
        if (toolParams.intensity !== undefined) requestBody.defry = toolParams.intensity;
      }
    }
  }

  if (params.batch_id) requestBody.batch_id = params.batch_id;
  if (Number.isInteger(params.index)) requestBody.index = params.index;
  if (Number.isInteger(params.batch_size)) requestBody.batch_size = params.batch_size;
  return requestBody;
}

/**
 * 同步调用本地后端并转换为原画廊使用的图片结果。
 *
 * @param {object} requestParams 当前生成参数。
 * @param {Function} onProgress 原页面进度回调。
 * @returns {Promise<object>} 原生成上下文可直接消费的结果。
 */
const generateImage = async (requestParams, onProgress = () => {}) => {
  const params = sanitizeNovelAIV5GenerationParams({
    ...requestParams,
    model: normalizePaintingModelId(requestParams?.model),
  });
  onProgress({ status: 'processing', queuePosition: 0, model: params.model });

  try {
    const response = await apiClient.generateImage(buildGenerationRequest(params));
    const generatedImage = response?.images?.[0];
    if (!generatedImage?.data) {
      return createGenerationFailure(GENERATION_ERROR_CODES.INVALID_GENERATED_FILE, {
        category: 'protocol',
        model: params.model,
      });
    }

    const cachedBlob = createBlobFromBase64(
      generatedImage.data,
      generatedImage.mime_type || 'image/png',
    );
    const displayUrl = createObjectUrlFromBlob(cachedBlob);
    if (!cachedBlob || !displayUrl) {
      return createGenerationFailure(GENERATION_ERROR_CODES.INVALID_GENERATED_FILE, {
        category: 'protocol',
        model: params.model,
      });
    }

    if (response.account_snapshot && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('novelai:account-updated', {
        detail: response.account_snapshot,
      }));
    }

    return {
      success: true,
      image: displayUrl,
      imageUrl: displayUrl,
      remoteImageUrl: null,
      downloadUrl: displayUrl,
      objectUrlToRevoke: displayUrl,
      cachedBlob,
      seed: generatedImage.seed ?? params.seed,
      completedAt: new Date().toISOString(),
      prompt: params.positivePrompt,
      width: generatedImage.width ?? params.width,
      height: generatedImage.height ?? params.height,
      status: 'completed',
      jobId: response.correlation_id || null,
      model: params.model,
    };
  } catch (error) {
    return createGenerationFailure(normalizeGenerationErrorCode(error), {
      status: 'failed',
      statusCode: error.statusCode,
      category: error.category,
      errorId: error.errorId,
      model: params.model,
    });
  }
};

export { buildGenerationRequest, generateImage };
