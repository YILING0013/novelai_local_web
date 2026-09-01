// AIPaintingPage.js
"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Grid,
  useTheme,
  useMediaQuery,
  Snackbar,
  Alert,
  Fab,
  Badge,
  Tooltip,
  IconButton,
  Typography,
  Button,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  AppBar,
  Toolbar,
  Slide,
  Divider,
  Stack,
  SwipeableDrawer,
  alpha
} from '@mui/material';
import {
  Brush as BrushIcon,
  Cancel as CancelIcon,
  Close as CloseIcon,
  BarChart as BarChartIcon,
  ErrorOutline as ErrorOutlineIcon,
  Menu as MenuIcon,
  Tune as TuneIcon,
  KeyboardArrowRight as KeyboardArrowRightIcon,
  Expand as ExpandIcon,
  ChevronLeft as ChevronLeftIcon,
  Image as ImageIcon,
  Warning as WarningIcon,
  MonetizationOn as MonetizationOnIcon,
} from '@mui/icons-material';
import ItemDisplay from './ItemDisplay';
import ItemPreview from './ItemPreview';
import PromptPanel from './PromptPanel';
import ParameterPanel from './ParameterPanel';
import InpaintWorkspacePanel from './InpaintWorkspace/InpaintWorkspacePanel';
import { GenerationProvider, useGeneration } from './Generation/GenerationContext';
import BatchGenerationDialog from './tools/BatchGeneration/BatchGenerationDialog';
import ErrorSummaryDialog from './tools/BatchGeneration/ErrorSummaryDialog';
import MetadataDialog from './tools/ImageTools/MetadataDialog';
import { getImageSettings, autoSaveImage } from './tools/ImageTools/ImageSaveUtils';
import { resizeImage } from './tools/ImageTools/ImageResizer';
import apiClient from '@/utils/ApiClient';
import { createBlobFromBase64, createObjectUrlFromBlob, revokeObjectUrl } from '@/utils/mediaAssets';
import { extractActiveContent } from './PromptEditor';
import { applyImageParametersToUI } from './utils/parameterMapping';
import { extractMetadataFromFile, extractMetadataFromImageSrc } from './utils/metadataUtils';
import { clearVibePanelState, getVibePanelState, saveVibePanelState } from './utils/vibeDB';
import imageCacheManager from './utils/imageCacheManager';
import { sha256 as hashAccountIdentity } from './utils/cryptoUtils';
import {
  DEFAULT_PAINTING_MODEL_ID,
  NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS,
  isNovelAIDirectorReferenceModel,
  isNovelAIV5Model,
  isNovelAIV4OrAboveModel as isV4Model,
  isNovelAIVibeModel,
} from './utils/modelUtils';
import {
  estimateNovelAIGenerationCost,
  isDisplayableNovelAICost,
} from './utils/novelAICost.mjs';
import { loadModelPromptCache, persistModelPromptCache } from './utils/promptCache';
import { useI18n } from '@/i18n/I18nProvider';
import {
  PAINTING_ERROR_RECORDS_STORAGE_KEY,
  createPaintingErrorRecord,
  parsePaintingErrorRecords,
  prependPaintingErrorRecord,
  serializePaintingErrorRecords,
} from './Generation/errorRecords.mjs';
import { GENERATION_ERROR_MESSAGE_KEYS } from './Generation/errors';

const WORKSPACE_ERROR_KEYS = Object.freeze({
  ...GENERATION_ERROR_MESSAGE_KEYS,
  POLLING_FAILED: 'painting.workspace.errors.pollingFailed',
  INPAINT_SOURCE_REQUIRED: 'painting.workspace.errors.inpaintSourceRequired',
  INPAINT_VIEWPORT_EMPTY: 'painting.workspace.errors.inpaintViewportEmpty',
  INPAINT_PREVIEW_GENERATION_FAILED: 'painting.workspace.errors.inpaintPreviewGenerationFailed',
  INPAINT_PREVIEW_LOAD_FAILED: 'painting.workspace.errors.inpaintPreviewLoadFailed',
});

const WORKSPACE_ERROR_CATEGORY_KEYS = Object.freeze({
  parameter: 'painting.workspace.errors.invalidParameters',
  rate_limit: 'painting.workspace.errors.rateLimited',
  network: 'painting.workspace.errors.network',
  timeout: 'painting.workspace.errors.timeout',
});

const WORKSPACE_HTTP_ERROR_KEYS = Object.freeze({
  401: 'painting.workspace.errors.unauthorized',
  403: 'painting.workspace.errors.forbidden',
  408: 'painting.workspace.errors.timeout',
  429: 'painting.workspace.errors.rateLimited',
  502: 'painting.workspace.errors.serviceUnavailable',
  503: 'painting.workspace.errors.serviceUnavailable',
  504: 'painting.workspace.errors.timeout',
});

/**
 * 将服务层异常解析为工作区翻译键，安全业务码优先于通用 HTTP 分类。
 *
 * Args:
 *   error: 服务层错误对象或稳定错误码。
 *   fallbackKey: 未知错误码使用的翻译键。
 *
 * Returns:
 *   string: 可安全交给翻译函数的工作区错误键。
 */
const getWorkspaceErrorMessageKey = (error, fallbackKey = 'painting.workspace.errors.generic') => {
  if (typeof error === 'object' && error?.messageKey) {
    return error.messageKey;
  }
  const code = typeof error === 'string'
    ? error
    : error?.code || error?.errorCode || error?.data?.code;
  const categoryKey = typeof error === 'object'
    ? WORKSPACE_ERROR_CATEGORY_KEYS[error?.category]
    : null;
  const statusKey = typeof error === 'object'
    ? WORKSPACE_HTTP_ERROR_KEYS[error?.statusCode || error?.status]
    : null;
  return WORKSPACE_ERROR_KEYS[code] || categoryKey || statusKey || fallbackKey;
};

const getWorkspaceErrorMessage = (t, error, fallbackKey = 'painting.workspace.errors.generic') => (
  t(getWorkspaceErrorMessageKey(error, fallbackKey))
);

/**
 * 创建仅携带稳定错误码的工作区异常，供 UI 层本地化展示。
 *
 * Args:
 *   code: 稳定客户端错误码。
 *   options: 可选的错误 ID、分类与状态码。
 *
 * Returns:
 *   Error: 带有 code 字段且不包含上游详情的异常。
 */
const createWorkspaceError = (code, options = {}) => Object.assign(new Error(code), {
  code,
  ...options,
});

const useObservedWidth = () => {
  const [element, setElement] = useState(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!element) {
      setWidth(0);
      return undefined;
    }

    const updateWidth = (nextWidth) => {
      setWidth((previousWidth) => (
        Math.abs(previousWidth - nextWidth) < 1 ? previousWidth : nextWidth
      ));
    };

    const measure = () => {
      updateWidth(element.getBoundingClientRect().width);
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];

        if (entry) {
          updateWidth(entry.contentRect.width);
        }
      });

      observer.observe(element);

      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [element]);

  return [setElement, width];
};

const estimateButtonTextWidth = (text, fontSize) => {
  if (!text) {
    return 0;
  }

  return Array.from(text).reduce((totalWidth, char) => {
    if (/[\u4E00-\u9FFF]/.test(char)) {
      return totalWidth + fontSize;
    }

    if (/\d/.test(char)) {
      return totalWidth + fontSize * 0.62;
    }

    if (/[A-Z]/.test(char)) {
      return totalWidth + fontSize * 0.76;
    }

    if (/[a-z]/.test(char)) {
      return totalWidth + fontSize * 0.6;
    }

    if (char === ' ') {
      return totalWidth + fontSize * 0.35;
    }

    return totalWidth + fontSize * 0.85;
  }, 0);
};

const getResponsiveGenerateButtonContent = ({
  availableWidth,
  buttonState,
  isMobile
}) => {
  const compactText = buttonState.shortText || buttonState.text;
  const hasCost = isDisplayableNovelAICost(buttonState.cost);
  const costLabel = buttonState.costLabel || String(buttonState.cost);
  const costTextWidth = hasCost
    ? estimateButtonTextWidth(costLabel, isMobile ? 10 : 10)
    : 0;
  const costWidth = hasCost ? 24 + costTextWidth : 0;
  const costGap = hasCost ? (isMobile ? 10 : 14) : 0;

  if (!availableWidth) {
    return {
      mode: hasCost ? 'icon' : 'compact',
      label: compactText,
      showText: !hasCost,
      showCost: hasCost,
    };
  }

  const fontSize = isMobile ? 14 : 15;
  const buttonPadding = isMobile ? 28 : 40;
  const iconWidth = isMobile ? 20 : 22;
  const labelGap = compactText ? 8 : 0;
  const fullTextWidth = estimateButtonTextWidth(buttonState.text, fontSize);
  const compactTextWidth = estimateButtonTextWidth(compactText, fontSize);
  const iconOnlyWidth = buttonPadding + iconWidth;
  const fullLabelWidth = buttonPadding + iconWidth + labelGap + fullTextWidth;
  const compactLabelWidth = buttonPadding + iconWidth + labelGap + compactTextWidth;
  // 预计消耗属于生成前的必要状态，即使窄屏隐藏按钮文字也不能把它一并隐藏。
  const showCost = hasCost;
  const contentWidth = showCost
    ? Math.max(0, availableWidth - costGap - costWidth)
    : availableWidth;

  let mode = 'icon';

  if (contentWidth >= fullLabelWidth) {
    mode = 'full';
  } else if (contentWidth >= compactLabelWidth) {
    mode = 'compact';
  }

  const visibleLabel = mode === 'full' ? buttonState.text : compactText;

  return {
    mode,
    label: visibleLabel,
    showText: mode !== 'icon',
    showCost,
  };
};

// 使用GenerationContext包装的AIPaintingPage内部组件
const AIPaintingPageContent = ({ userId, accountSnapshot = null }) => {
  const { t, formatNumber } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const accountDefaultModel = DEFAULT_PAINTING_MODEL_ID;
  const themeColors = {
    ItemDisplayBg: theme.palette.background.paper,
    ItemPreviewBg: theme.palette.background.default,

    // 移动端底部栏颜色
    mobileBottomBg: alpha(theme.palette.background.paper, 0.9),
    mobileBottomBorder: alpha(theme.palette.divider, 0.2),

    // 抽屉背景色
    drawerBg: theme.palette.background.paper,
  };
  const {
    currentItem,
    generatedItems,
    generate,
    generatePreview,
    selectItem,
    deleteItem,
    appendGeneratedItem,
    updateGeneratedItem,
    isGenerating,
    generationStatus,
    resetGeneration,
    // 添加批量生成相关函数
    generateBatchImages,
    cancelBatchGeneration,
    batchStatus
  } = useGeneration();

  // 状态管理
  const hasInitializedRef = useRef(false);
  const getAllParametersRef = useRef(null);
  const inpaintWorkspaceRef = useRef(null);
  const fileInputRef = useRef(null);
  const vibeFileInputRef = useRef(null);
  const upscaleInFlightRef = useRef(false);
  const [inpaintPreviewBatch, setInpaintPreviewBatch] = useState({ active: false, current: 0, total: 0 });
  const [characterTabsFromNote, setCharacterTabsFromNote] = useState(null);
  const [characterTabsForPromptTokens, setCharacterTabsForPromptTokens] = useState([]);
  const [imageSettings, setImageSettings] = useState(getImageSettings());
  const [errorSummaryOpen, setErrorSummaryOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [workspaceErrors, setWorkspaceErrors] = useState([]);
  const [errorRecordsHydrated, setErrorRecordsHydrated] = useState(false);
  const [errorRecordsOwnerKey, setErrorRecordsOwnerKey] = useState('');
  const [vibeImages, setVibeImages] = useState([]);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [vibeCacheHydrated, setVibeCacheHydrated] = useState(false);
  const [pageMetadataDialog, setPageMetadataDialog] = useState({ open: false, metadata: null });
  const [liveAccountSnapshot, setLiveAccountSnapshot] = useState(accountSnapshot);
  const [anlasDialogOpen, setAnlasDialogOpen] = useState(false);
  const [generationParams, setGenerationParams] = useState(() => {
    // 尝试从localStorage中读取参数
    try {
      const defaults = {
        width: 1024,
        height: 1024,
        steps: 23,
        guidanceScale: 5,
        seed: '',
        batchSize: 1,
        model: accountDefaultModel,
      };

      // 从缓存中读取各参数值
      const cachedParams = {};
      Object.keys(defaults).forEach(key => {
        const cached = localStorage.getItem('aiImageParams_' + key);
        if (cached !== null) {
          try {
            cachedParams[key] = JSON.parse(cached);
          } catch (e) {
            cachedParams[key] = cached;
          }
        }
      });

      const mergedParams = { ...defaults, ...cachedParams };
      const normalizedModel = mergedParams.model || defaults.model;
      if (normalizedModel !== mergedParams.model) {
        // 废弃模型的旧缓存必须在页面启动时回落，不能继续形成隐藏生成请求。
        mergedParams.model = normalizedModel;
        localStorage.setItem('aiImageParams_model', JSON.stringify(normalizedModel));
      }

      return mergedParams;
    } catch (error) {
      console.error('从缓存加载参数失败:', error);
      // 加载失败时返回默认值
      return {
        width: 1024,
        height: 1024,
        steps: 23,
        guidanceScale: 5,
        seed: '',
        batchSize: 1,
        model: accountDefaultModel,
      };
    }
  });

  useEffect(() => {
    setLiveAccountSnapshot(accountSnapshot);
  }, [accountSnapshot]);

  useEffect(() => {
    const handleAccountUpdate = (event) => {
      if (event.detail) setLiveAccountSnapshot(event.detail);
    };
    window.addEventListener('novelai:account-updated', handleAccountUpdate);
    return () => window.removeEventListener('novelai:account-updated', handleAccountUpdate);
  }, []);
  const [promptsByModel, setPromptsByModel] = useState(() => (
    loadModelPromptCache(generationParams.model)
  ));
  const activePromptModelRef = useRef(generationParams.model);
  activePromptModelRef.current = generationParams.model;
  const activePrompts = promptsByModel[generationParams.model] || {
    positivePrompt: '',
    negativePrompt: '',
  };
  const positivePrompt = activePrompts.positivePrompt;
  const negativePrompt = activePrompts.negativePrompt;

  /**
   * 更新当前模型的单个提示词，并保留其它模型缓存。
   *
   * Args:
   *   field: 要更新的正面或负面提示词字段。
   *   nextValueOrUpdater: 新文本，或接收当前文本并返回新文本的更新函数。
   *   targetModel: 元数据导入等场景显式指定的目标模型；缺省时使用当前模型。
   *
   * Returns:
   *   void: 更新 React 状态，持久化由独立 effect 统一完成。
   */
  const updateActivePrompt = useCallback((field, nextValueOrUpdater, targetModel = null) => {
    const modelId = targetModel || activePromptModelRef.current;
    if (!modelId) {
      return;
    }

    setPromptsByModel((previousCache) => {
      const currentEntry = previousCache[modelId] || {
        positivePrompt: '',
        negativePrompt: '',
      };
      const currentValue = currentEntry[field] || '';
      const resolvedValue = typeof nextValueOrUpdater === 'function'
        ? nextValueOrUpdater(currentValue)
        : nextValueOrUpdater;

      return {
        ...previousCache,
        [modelId]: {
          ...currentEntry,
          [field]: typeof resolvedValue === 'string' ? resolvedValue : String(resolvedValue ?? ''),
        },
      };
    });
  }, []);

  const setPositivePrompt = useCallback((nextValueOrUpdater, targetModel = null) => {
    updateActivePrompt('positivePrompt', nextValueOrUpdater, targetModel);
  }, [updateActivePrompt]);

  const setNegativePrompt = useCallback((nextValueOrUpdater, targetModel = null) => {
    updateActivePrompt('negativePrompt', nextValueOrUpdater, targetModel);
  }, [updateActivePrompt]);

  useEffect(() => {
    persistModelPromptCache(promptsByModel);
  }, [promptsByModel]);

  // 移动端抽屉状态
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // 添加图像数据状态
  const [externalImageData, setExternalImageData] = useState(null);
  const [imageToImageCostParameters, setImageToImageCostParameters] = useState(null);
  const [inpaintCostParameters, setInpaintCostParameters] = useState(null);
  const [leftPanelMode, setLeftPanelMode] = useState('generation');
  const isV5Model = isNovelAIV5Model(generationParams.model);

  // 添加通知状态
  const [notification, setNotification] = useState({
    open: false,
    message: '',
    severity: 'success',
    autoHide: true,
    actions: [], // 添加操作按钮数组
    errorRecord: null,
  });
  // 添加面板展开状态
  const [expandedPanels, setExpandedPanels] = useState({
    basic: true,
    img2img: false,
    vibe: false,
    character: false
  });

  useEffect(() => {
    let cancelled = false;

    const hydrateVibePanel = async () => {
      try {
        const cachedVibes = await getVibePanelState();

        if (!cancelled && Array.isArray(cachedVibes) && cachedVibes.length > 0) {
          const normalizedCachedVibes = cachedVibes.map((item) => ({
            ...item,
            isTemporarilyDisabled: item.isTemporarilyDisabled === true,
          }));
          setVibeImages((prev) => (prev.length > 0 ? prev : normalizedCachedVibes));
        }
      } catch (error) {
        console.error('恢复Vibe面板缓存失败:', error);
      } finally {
        if (!cancelled) {
          setVibeCacheHydrated(true);
        }
      }
    };

    hydrateVibePanel();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!vibeCacheHydrated) {
      return;
    }

    const persistVibePanel = async () => {
      try {
        if (vibeImages.length === 0) {
          await clearVibePanelState();
          return;
        }

        await saveVibePanelState(vibeImages);
      } catch (error) {
        console.error('保存Vibe面板缓存失败:', error);
      }
    };

    persistVibePanel();
  }, [vibeImages, vibeCacheHydrated]);
  const [setDesktopGenerateButtonContainer, desktopGenerateButtonWidth] = useObservedWidth();
  const [setMobileGenerateButtonContainer, mobileGenerateButtonWidth] = useObservedWidth();

  useEffect(() => {
    let cancelled = false;
    setErrorRecordsHydrated(false);
    setErrorRecordsOwnerKey('');
    setWorkspaceErrors([]);

    const hydrateOwnerRecords = async () => {
      if (!userId) {
        if (!cancelled) {
          setErrorRecordsHydrated(true);
        }
        return;
      }

      try {
        // localStorage 仅保存账号标识的摘要，切换账号时不会读取到另一分区。
        const ownerKey = await hashAccountIdentity(`ai-painting-owner:${userId}`);
        if (cancelled) return;
        setErrorRecordsOwnerKey(ownerKey);
        setWorkspaceErrors(parsePaintingErrorRecords(
          localStorage.getItem(PAINTING_ERROR_RECORDS_STORAGE_KEY),
          ownerKey,
        ));
      } catch (error) {
        console.error('恢复绘图错误记录失败:', error);
      } finally {
        if (!cancelled) {
          setErrorRecordsHydrated(true);
        }
      }
    };

    hydrateOwnerRecords();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!errorRecordsHydrated || !errorRecordsOwnerKey) {
      return;
    }

    try {
      const currentRegistry = localStorage.getItem(PAINTING_ERROR_RECORDS_STORAGE_KEY);
      localStorage.setItem(
        PAINTING_ERROR_RECORDS_STORAGE_KEY,
        serializePaintingErrorRecords(
          currentRegistry,
          errorRecordsOwnerKey,
          workspaceErrors,
        ),
      );
    } catch (error) {
      // 本地存储不可用不应影响生成或错误提示本身。
      console.error('保存绘图错误记录失败:', error);
    }
  }, [errorRecordsHydrated, errorRecordsOwnerKey, workspaceErrors]);

  /**
   * 功能：把异常追加到当前账号的统一错误记录，并返回可直接展示的安全结构。
   *
   * Args:
   *   errorLike: 捕获到的异常、批量错误或稳定错误码。
   *   options: 来源与本地化消息键等安全元数据。
   *
   * Returns:
   *   object: 已去除 cause、响应正文等敏感字段的错误记录。
   */
  const recordWorkspaceError = useCallback((errorLike, options = {}) => {
    const record = createPaintingErrorRecord(errorLike, options);
    setWorkspaceErrors((currentRecords) => prependPaintingErrorRecord(currentRecords, record));
    return record;
  }, []);

  /**
   * 功能：按用户操作清空当前账号的绘图错误历史。
   *
   * Args:
   *   无。
   *
   * Returns:
   *   void: 同步清空 React 状态与当前账号的 localStorage 分区。
   */
  const clearWorkspaceErrors = useCallback(() => {
    setWorkspaceErrors([]);
    setNotification((currentNotification) => (
      currentNotification.severity === 'error'
        ? { ...currentNotification, open: false, errorRecord: null }
        : currentNotification
    ));
    try {
      if (errorRecordsOwnerKey) {
        const currentRegistry = localStorage.getItem(PAINTING_ERROR_RECORDS_STORAGE_KEY);
        localStorage.setItem(
          PAINTING_ERROR_RECORDS_STORAGE_KEY,
          serializePaintingErrorRecords(currentRegistry, errorRecordsOwnerKey, []),
        );
      }
    } catch (error) {
      console.error('清空绘图错误记录失败:', error);
    }
  }, [errorRecordsOwnerKey]);

  // 显示通知的辅助函数
  const showNotification = useCallback((
    message,
    severity = 'success',
    autoHide = true,
    actions = [],
    errorOptions = null,
  ) => {
    // 防止空消息
    if (!message) {
      message = severity === 'error'
        ? t('painting.workspace.errors.generic')
        : t('painting.workspace.notifications.completed');
    }

    const errorRecord = severity === 'error'
      ? recordWorkspaceError(errorOptions?.error || errorOptions || { code: 'UNKNOWN_ERROR' }, {
        source: errorOptions?.source,
        messageKey: errorOptions?.messageKey,
        model: errorOptions?.model,
      })
      : null;

    // 通知只保存安全错误记录；原始异常保留在调用方控制台日志中。
    setNotification({
      open: true,
      message,
      severity,
      autoHide: severity !== 'error' && autoHide, // 错误类型不自动隐藏
      actions: actions || [],
      errorRecord,
    });
  }, [recordWorkspaceError, t]);

  /**
   * 功能：接收子面板的真实请求异常，并统一写入持久错误记录和错误 Snackbar。
   *
   * Args:
   *   error: 子面板 catch 捕获到的原始异常。
   *   options: 错误来源与本地化消息键。
   *
   * Returns:
   *   void: 通过页面统一通知和错误记录状态完成上报。
   */
  const reportWorkspaceFailure = useCallback((error, options = {}) => {
    const errorCode = error?.code || error?.data?.code;
    const messageKey = error?.messageKey
      || (errorCode && WORKSPACE_ERROR_KEYS[errorCode])
      || options.messageKey
      || getWorkspaceErrorMessageKey(error);
    showNotification(t(messageKey), 'error', false, [], {
      error,
      source: options.source || 'workspace',
      messageKey,
    });
  }, [showNotification, t]);


  // 按 NovelAI 当前计费顺序计算生成点数。
  const calculateGenerationCost = useCallback((params, currentEditParameters) => {
    const isSmeaSupported = !isV4Model(params.model);
    const editParameters = currentEditParameters === undefined
      ? params.imageToImage
      : currentEditParameters;
    return estimateNovelAIGenerationCost({
      model: params.model,
      width: params.width,
      height: params.height,
      steps: params.steps,
      enableSmea: isSmeaSupported && params.smea,
      enableSmeaDyn: isSmeaSupported && params.smea && params.dyn,
      hasImage: Boolean(editParameters?.image),
      hasMask: Boolean(editParameters?.mask),
      strength: editParameters?.strength,
      inpaintImg2ImgStrength: editParameters?.inpaintStrength,
      subscriptionActive: liveAccountSnapshot?.subscription?.active === true,
      useUpscaleCredits: params.use_upscale_credits === true,
      batchSize: params.batchSize,
    });
  }, [liveAccountSnapshot?.subscription?.active]);

  // 获取按钮状态的函数
  const getGenerateButtonState = () => {
    const isInpaintMode = leftPanelMode === 'inpaint';
    const isV4 = isV4Model(generationParams.model);
    const hasImageReference = Boolean(
      isNovelAIDirectorReferenceModel(generationParams.model)
      && generationParams.director_reference_images_cached?.length
    );
    const estimatedCost = calculateGenerationCost(
      generationParams,
      isInpaintMode ? inpaintCostParameters : imageToImageCostParameters,
    );
    const costLabel = estimatedCost.perImage === -3
      ? null
      : (estimatedCost.count > 1
        ? t('painting.workspace.anlas.estimatedBatchCost', {
          perImage: formatNumber(estimatedCost.perImage),
          total: formatNumber(estimatedCost.total),
        })
        : t('painting.workspace.anlas.estimatedSingleCost', {
          cost: formatNumber(estimatedCost.perImage),
        }));

    if (
      isV4
      && isNovelAIVibeModel(generationParams.model)
      && !hasImageReference
      && vibeImages.some((vibe) => (
        vibe.isV4Vibe
        && vibe.isTemporarilyDisabled !== true
        && vibe.status !== 'converted'
      ))
    ) {
      return {
        text: t('painting.workspace.actions.convertAllVibesFirst'),
        shortText: t('painting.workspace.actions.convertVibes'),
        action: () => {},
        color: 'primary',
        icon: <WarningIcon />,
        disabled: true,
        cost: null,
      };
    }

    if (batchStatus.active) {
      return {
        text: t('painting.workspace.actions.cancelBatch', {
          current: batchStatus.current,
          total: batchStatus.total,
        }),
        shortText: t('painting.workspace.actions.cancelGeneration'),
        action: handleCancelBatchGeneration,
        color: 'error',
        icon: <CancelIcon />,
        disabled: false,
        cost: null,
      };
    }

    if (isGenerating) {
      return {
        text: isInpaintMode
          ? t('painting.workspace.actions.inpaintingProgress', {
            progress: Math.round(generationStatus.progress || 0),
          })
          : t('painting.workspace.actions.generatingProgress', {
            progress: Math.round(generationStatus.progress || 0),
          }),
        shortText: isInpaintMode
          ? t('painting.workspace.actions.inpainting')
          : t('painting.workspace.actions.generating'),
        action: () => {},
        color: 'primary',
        icon: isInpaintMode ? <ImageIcon /> : null,
        disabled: true,
        cost: null,
      };
    }

    if (estimatedCost.perImage === -3) {
      return {
        text: t('painting.workspace.actions.generationSettingsTooExpensive'),
        shortText: t('painting.workspace.actions.adjustGenerationSettings'),
        action: () => {},
        color: 'error',
        icon: <WarningIcon />,
        disabled: true,
        cost: null,
      };
    }

    if (isInpaintMode) {
      const previewCount = Math.max(1, Number.parseInt(generationParams.batchSize, 10) || 1);
      return {
        text: previewCount > 1
          ? t('painting.workspace.actions.generateInpaintResults', { count: previewCount })
          : t('painting.workspace.actions.generateInpaintResult'),
        shortText: t('painting.workspace.actions.startInpainting'),
        action: handleGenerate,
        color: 'primary',
        icon: <ImageIcon />,
        disabled: false,
        cost: estimatedCost.perImage,
        costTotal: estimatedCost.total,
        costCount: estimatedCost.count,
        costLabel,
      };
    }

    return {
      text: t('painting.workspace.actions.generateBatchImages', {
        count: generationParams.batchSize,
        width: generationParams.width,
        height: generationParams.height,
      }),
      shortText: t('painting.workspace.actions.generateImage'),
      action: handleGenerate,
      color: 'primary',
      icon: null,
      disabled: false,
      cost: estimatedCost.perImage,
      costTotal: estimatedCost.total,
      costCount: estimatedCost.count,
      costLabel,
    };
  };
  // 确保生成按钮初始化正确显示参数
  useEffect(() => {
    // 强制刷新按钮状态
    setGenerationParams(prevParams => ({ ...prevParams }));
  }, []);

  // 处理应用笔记元数据（包括提示词和角色卡片）
  const handleApplyMetadataFromNote = (note) => {
    setPositivePrompt(note.text_content1 || '');
    setNegativePrompt(note.text_content2 || '');
    // 更新 ParameterPanel 的 characterTabs
    setCharacterTabsFromNote(note.character_tabs || []); // 如果没有则传空数组

    // 可以在这里展开 ParameterPanel 中的角色控制区域
    // onExpandedPanelsChange('character', true); // 假设有这个函数
    setExpandedPanels(prev => ({ ...prev, character: true }));


    showNotification(t('painting.workspace.notifications.noteApplied'), 'success');
  };

  // 这个函数会作为 prop 传递给 PromptPanel，再由 PromptPanel 传递给 SaveNoteDialog
  const handleSaveCurrentNote = async (title, imageUrl) => {
    if (!title.trim()) {
      showNotification(t('painting.workspace.errors.noteTitleRequired'), 'warning');
      return false; // 指示保存失败
    }
    try {
      const allParams = getAllParametersRef.current ? getAllParametersRef.current() : {};
      const activePositive = extractActiveContent(positivePrompt, {
      });
      const activeNegative = extractActiveContent(negativePrompt, {
      });
      // 从 ParameterPanel 的 getAllParameters 获取 characterTabs
      const characterTabsToSave = allParams.characterControl?.characterTabs || [];
      await apiClient.saveTexts(title, activePositive, activeNegative, imageUrl, characterTabsToSave);
      showNotification(t('painting.workspace.notifications.noteSaved'), 'success');
      return true; // 指示保存成功
    } catch (error) {
      showNotification(
        getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.noteSaveFailed'),
        'error',
        true,
        [],
        { error, source: 'notebook', messageKey: 'painting.workspace.errors.noteSaveFailed' },
      );
      return false; // 指示保存失败
    }
  };

  // 处理应用元数据
  const handleApplyMetadata = (metadataInfo) => {
    // 设置正面提示词
    if (metadataInfo.positivePrompt !== undefined) {
      setPositivePrompt(metadataInfo.positivePrompt);
    }

    // 设置负面提示词
    if (metadataInfo.negativePrompt !== undefined) {
      setNegativePrompt(metadataInfo.negativePrompt);
    }

    if (Array.isArray(metadataInfo.characterTabs)) {
      setCharacterTabsFromNote(metadataInfo.characterTabs);
      if (metadataInfo.characterTabs.length > 0) {
        setExpandedPanels(prev => ({ ...prev, character: true }));
      }
    }
  };

  // 处理展开面板变更
  const handleExpandedPanelsChange = (panel, isExpanded) => {
    setExpandedPanels(prev => ({ ...prev, [panel]: isExpanded }));
  };

  useEffect(() => {
    // 检查是否有初始错误需要显示（例如从URL参数或会话存储中）
    const initialError = sessionStorage.getItem('initialError');

    if (initialError) {
      // 显示初始错误并从会话存储中清除
      showNotification(
        getWorkspaceErrorMessage(t, initialError),
        'error',
        true,
        [],
        { error: initialError, source: 'workspace' },
      );
      sessionStorage.removeItem('initialError');
    }

    // 设置全局错误处理器来捕获未处理的错误
    const handleGlobalError = (error) => {
      console.error('捕获到未处理的错误:', error);
      showNotification(
        getWorkspaceErrorMessage(t, error?.error || error),
        'error',
        true,
        [],
        { error: error?.error || error, source: 'browser' },
      );
    };

    // 页面加载完成后检查是否需要刷新按钮状态 - 只执行一次
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      // 强制刷新按钮状态
      setGenerationParams(prevParams => ({ ...prevParams }));
      console.log('生成参数已从缓存加载:', generationParams);
    }

    const handleImageSettingsUpdate = (event) => {
      if (event.detail) {
        setImageSettings(event.detail);
        console.log('已更新图像设置:', event.detail);
      }
    };

    // 添加事件监听器
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('imageSettingsUpdate', handleImageSettingsUpdate);

    // 清理
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('imageSettingsUpdate', handleImageSettingsUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNotification, t]);


  // 关闭通知
  const handleCloseNotification = (event, reason) => {
    // 如果是autoHide触发的关闭且该通知是错误类型，则不关闭
    if (reason === 'timeout' && !notification.autoHide) {
      return;
    }
    setNotification({ ...notification, open: false });
  };

  // 参数变更处理
  const handleParamChange = useCallback((param, value) => {
    const resolvedValue = value;
    const shouldClearDirectorReference = param === 'model'
      && !isNovelAIDirectorReferenceModel(resolvedValue);

    if (shouldClearDirectorReference) {
      // 切离白名单模型时同步失效已验证的参考图缓存，重新进入 4.5 后必须重新上传。
      imageCacheManager.clear();
    }

    setGenerationParams((previousParams) => {
      const nextParams = {
        ...previousParams,
        [param]: resolvedValue,
      };

      if (shouldClearDirectorReference) {
        NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS.forEach((key) => delete nextParams[key]);
      }

      return nextParams;
    });
  }, []);

  const applyMetadataToCurrentParams = useCallback((parsedParams, {
    successMessage = t('painting.workspace.notifications.imageParametersLoaded'),
    warningMessage = t('painting.workspace.errors.partialParameterApply'),
  } = {}) => {
    try {
      const success = applyImageParametersToUI(parsedParams, {
        setPositivePrompt,
        setNegativePrompt,
        setCharacterTabsFromNote,
        setExpandedPanels,
        handleParamChange,
        showNotification: (code, severity = 'success', params = {}) => {
          const message = code === 'PARAMETER_RESOLUTION_AUTO_ADJUSTED'
            ? t('painting.workspace.notifications.resolutionAdjusted', params)
            : getWorkspaceErrorMessage(t, code);
          showNotification(
            message,
            severity,
            true,
            [],
            severity === 'error'
              ? { error: code, source: 'parameter-import', messageKey: WORKSPACE_ERROR_KEYS[code] }
              : null,
          );
        },
      });

      if (success) {
        if (successMessage) {
          showNotification(successMessage, 'success');
        }
        return true;
      }

      if (warningMessage) {
        showNotification(warningMessage, 'warning');
      }
      return false;
    } catch (error) {
      console.error('应用图像参数失败:', error);
      showNotification(
        getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.applyImageParametersFailed'),
        'error',
        true,
        [],
        {
          error,
          source: 'parameter-import',
          messageKey: 'painting.workspace.errors.applyImageParametersFailed',
        },
      );
      return false;
    }
  }, [handleParamChange, setNegativePrompt, setPositivePrompt, showNotification, t]);

  const ensureItemMetadata = useCallback(async (item) => {
    if (!item || !item.src) {
      return item?.metadata || null;
    }

    const metadataBoundToCurrentSource = item.metadataSource === item.src;

    if (metadataBoundToCurrentSource && item.metadataStatus === 'ready') {
      return item.metadata || null;
    }

    if (metadataBoundToCurrentSource && (item.metadataStatus === 'loading' || item.metadataStatus === 'missing' || item.metadataStatus === 'error')) {
      return item.metadata || null;
    }

    updateGeneratedItem(item.id, {
      metadataStatus: 'loading',
      metadataSource: item.src,
    });

    try {
      const metadata = await extractMetadataFromImageSrc(item.src, `${item.id}.png`);
      updateGeneratedItem(item.id, {
        metadata: metadata || null,
        metadataStatus: metadata ? 'ready' : 'missing',
        metadataSource: item.src,
      });
      return metadata;
    } catch (error) {
      console.error('读取图像元数据失败:', error);
      updateGeneratedItem(item.id, {
        metadata: null,
        metadataStatus: 'error',
        metadataSource: item.src,
      });
      return null;
    }
  }, [updateGeneratedItem]);

  useEffect(() => {
    generatedItems.forEach((item) => {
      if (item.src && item.metadataSource !== item.src) {
        void ensureItemMetadata(item);
      }
    });
  }, [ensureItemMetadata, generatedItems]);

  useEffect(() => {
    const shouldHandleFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

    const preventBrowserFileDrop = (event) => {
      if (!shouldHandleFileDrag(event)) {
        return;
      }

      if (event.target?.closest?.('[data-drop-zone]')) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener('dragover', preventBrowserFileDrop, true);
    window.addEventListener('drop', preventBrowserFileDrop, true);

    return () => {
      window.removeEventListener('dragover', preventBrowserFileDrop, true);
      window.removeEventListener('drop', preventBrowserFileDrop, true);
    };
  }, []);

  const handleApplyPageMetadata = useCallback((filteredMetadata) => {
    setPageMetadataDialog({ open: false, metadata: null });

    if (!filteredMetadata) {
      return;
    }

    applyMetadataToCurrentParams(filteredMetadata, {
      successMessage: t('painting.workspace.notifications.imageMetadataApplied'),
      warningMessage: t('painting.workspace.errors.partialMetadataApply'),
    });
  }, [applyMetadataToCurrentParams, t]);

  const handlePageDrop = useCallback(async (event) => {
    const hasFiles = Array.from(event.dataTransfer?.types || []).includes('Files');
    if (!hasFiles) {
      return;
    }

    if (event.target?.closest?.('[data-drop-zone]')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const imageFile = Array.from(event.dataTransfer?.files || []).find((file) => file.type?.startsWith('image/'));
    if (!imageFile) {
      return;
    }

    const metadata = await extractMetadataFromFile(imageFile);
    if (metadata) {
      setPageMetadataDialog({ open: true, metadata });
    }
  }, []);

  const handleSeedCopyAndApply = useCallback(async (seed) => {
    if (seed === undefined || seed === null || seed === '') {
      return;
    }

    const seedValue = typeof seed === 'string' ? seed : String(seed);
    handleParamChange('seed', seedValue);
    setExpandedPanels(prev => ({ ...prev, basic: true }));

    try {
      await navigator.clipboard.writeText(seedValue);
      showNotification(t('painting.workspace.notifications.seedCopiedAndApplied'), 'success');
    } catch (error) {
      console.error('复制 Seed 失败:', error);
      showNotification(t('painting.workspace.errors.seedCopyFailedAfterApply'), 'warning');
    }
  }, [handleParamChange, showNotification, t]);

  const handleUseItemMetadata = useCallback(async (item) => {
    const metadata = await ensureItemMetadata(item);

    if (!metadata) {
      showNotification(t('painting.workspace.errors.noApplicableMetadata'), 'warning');
      return false;
    }

    selectItem(item.id);
    const applied = applyMetadataToCurrentParams(metadata, {
      successMessage: t('painting.workspace.notifications.currentImageParametersApplied'),
      warningMessage: t('painting.workspace.errors.partialCurrentImageParameters'),
    });

    if (applied) {
      setExpandedPanels(prev => ({ ...prev, basic: true }));
    }

    return applied;
  }, [applyMetadataToCurrentParams, ensureItemMetadata, selectItem, showNotification, t]);

  const handleSendCurrentItemToInpaint = useCallback(async () => {
    if (!currentItem) {
      showNotification(t('painting.workspace.errors.itemCannotSendToInpaint'), 'warning');
      return false;
    }

    if (!inpaintWorkspaceRef.current) {
      showNotification(t('painting.workspace.errors.inpaintNotReady'), 'warning');
      return false;
    }

    await inpaintWorkspaceRef.current.importImageSource({
      src: currentItem.src,
      name: `generated_${currentItem.id}.png`,
      seed: currentItem.seed ?? '',
      prompt: currentItem.prompt || positivePrompt,
    });

    setLeftPanelMode('inpaint');
    showNotification(t('painting.workspace.notifications.sentToInpaint'), 'success');
    return true;
  }, [currentItem, positivePrompt, showNotification, t]);

  const handleExportInpaintToGallery = useCallback((item) => {
    appendGeneratedItem({
      ...item,
      originalSrc: item.src,
      isComposited: true,
      type: 'image',
    });
  }, [appendGeneratedItem]);

  // 处理应用图像参数
  const handleApplyImageParameters = useCallback((parsedParams) => {
    console.log('应用图像参数:', parsedParams);
    applyMetadataToCurrentParams(parsedParams, {
      successMessage: t('painting.workspace.notifications.imageParametersLoaded'),
      warningMessage: t('painting.workspace.errors.partialParameterApply'),
    });
  }, [applyMetadataToCurrentParams, t]);

  // 图像/视频生成请求
  const handleGenerate = async () => {
    let requestedModel = generationParams.model;

    try {
      // 关闭移动抽屉以便用户查看结果
      if (isMobile && mobileDrawerOpen) {
        setMobileDrawerOpen(false);
      }

      // 构建完整参数
      let params;
      if (getAllParametersRef.current) {
        // 获取所有参数，包括嵌套参数
        params = getAllParametersRef.current();
      } else {
        // 回退到基本参数
        params = {
          ...generationParams,
          positivePrompt,
          negativePrompt
        };
      }
      requestedModel = params.model || requestedModel;

      // 添加获取最新参数的回调函数
      params.getLatestParams = () => {
        // 实时获取最新参数
        if (getAllParametersRef.current) {
          const latestParams = getAllParametersRef.current();
          return latestParams;
        }
        return {
          ...generationParams,
          positivePrompt,
          negativePrompt
        };
      };

      if (leftPanelMode === 'inpaint') {
        if (!inpaintWorkspaceRef.current?.hasSourceImage()) {
          throw createWorkspaceError('INPAINT_SOURCE_REQUIRED');
        }

        const payload = inpaintWorkspaceRef.current.prepareGeneration();
        if (!payload) {
          throw createWorkspaceError('INPAINT_VIEWPORT_EMPTY');
        }

        const previewCount = Math.max(1, Number.parseInt(params.batchSize, 10) || 1);

        const { imageToImage: ignoredImageToImage, ...baseGenerationParams } = params;

        const previewParams = {
          ...baseGenerationParams,
          batchSize: 1,
          width: payload.outputWidth,
          height: payload.outputHeight,
        };

        if (payload.generationMode === 'inpaint') {
          previewParams.imageToImage = {
            image: payload.baseImage,
            strength: params.strength ?? 0.7,
            noise: params.noise ?? 0,
            mask: payload.mask,
            inpaintStrength: payload.inpaintStrength ?? 1.0,
            disabledOriginalImage: payload.disabledOriginalImage,
            colorCorrect: payload.colorCorrect,
          };
        }

        let generatedPreviewCount = 0;
        const previewBatchId = crypto.randomUUID();

        setInpaintPreviewBatch({ active: true, current: 0, total: previewCount });

        try {
          for (let previewIndex = 0; previewIndex < previewCount; previewIndex += 1) {
            if (previewIndex > 0) {
              const preparedPayload = inpaintWorkspaceRef.current.prepareGeneration();
              if (!preparedPayload) {
                throw createWorkspaceError('INPAINT_VIEWPORT_EMPTY');
              }
            }

            setInpaintPreviewBatch({ active: true, current: previewIndex + 1, total: previewCount });

            const previewItem = await generatePreview({
              ...previewParams,
              batch_id: previewBatchId,
              index: previewIndex,
              batch_size: previewCount,
            });

            if (!previewItem) {
              throw createWorkspaceError('INPAINT_PREVIEW_GENERATION_FAILED');
            }

            let applied = false;
            try {
              applied = await inpaintWorkspaceRef.current.applyGeneratedPatch(previewItem);
            } finally {
              // 预览不会进入受 Provider 管理的画廊；工作区完成图像加载后立即释放 Blob URL。
              revokeObjectUrl(previewItem.objectUrlToRevoke);
            }
            if (!applied) {
              throw createWorkspaceError('INPAINT_PREVIEW_LOAD_FAILED');
            }

            generatedPreviewCount += 1;
            if (previewIndex < previewCount - 1) {
              await new Promise((resolve) => window.setTimeout(resolve, 15_000));
            }
          }
        } catch (error) {
          await apiClient.cancelImageBatch(previewBatchId).catch(() => {});
          throw error;
        } finally {
          setInpaintPreviewBatch({ active: false, current: 0, total: 0 });
        }

        showNotification(
          payload.generationMode === 'inpaint'
            ? (generatedPreviewCount > 1
              ? t('painting.workspace.notifications.inpaintPreviewsGenerated', { count: generatedPreviewCount })
              : t('painting.workspace.notifications.inpaintPreviewGenerated'))
            : (generatedPreviewCount > 1
              ? t('painting.workspace.notifications.emptyViewportCandidatesGenerated', { count: generatedPreviewCount })
              : t('painting.workspace.notifications.emptyViewportCandidateGenerated')),
          'success'
        );
        return;
      }

      // 检查是否需要批量生成
      if (params.batchSize > 1) {
        try {
          // 调用批量生成服务
          const finalBatchStatus = await generateBatchImages(params,
            // 为批量生成添加回调，处理成功生成的图像自动保存
            (newImage) => {
              // 如果启用了自动保存，则保存每张生成的图像
              if (imageSettings.autoSaveEnabled) {
                setTimeout(() => {
                  autoSaveImage(newImage, imageSettings)
                    .then(success => {
                      if (success) {
                        console.log(`已自动保存图像: ${newImage.id}`);
                      }
                    })
                    .catch(err => console.error('自动保存图像失败:', err));
                }, 500); // 延迟500ms以确保图像已完全加载
              }
            },
            // 批量错误立即进入统一记录，使批量仍在运行时指示器也保持可见。
            (batchError) => {
              recordWorkspaceError(batchError, {
                source: 'batch-generation',
                messageKey: WORKSPACE_ERROR_KEYS[batchError.code],
              });
            },
          );

          // 控制器生成的批量级错误不经过单张失败回调，在终态单独补入记录。
          (finalBatchStatus.errors || [])
            .filter((batchError) => batchError.code?.startsWith('BATCH_'))
            .forEach((batchError) => {
              recordWorkspaceError(batchError, {
                source: 'batch-generation',
                messageKey: WORKSPACE_ERROR_KEYS[batchError.code],
              });
            });

          // 检查是否有错误
          if (finalBatchStatus.errors && finalBatchStatus.errors.length > 0) {
            // 显示带有错误摘要选项的通知
            showNotification(
              t('painting.workspace.notifications.batchCompleted', {
                completed: finalBatchStatus.completed,
                failed: finalBatchStatus.failed,
              }),
              'warning',
              true,
              [
                {
                  text: t('painting.workspace.actions.viewErrorDetails'),
                  action: () => setErrorSummaryOpen(true),
                  color: 'error'
                }
              ]
            );
          }
          // 成功完成没有暂停
          else {
            showNotification(t('painting.workspace.notifications.batchCompleted', {
              completed: finalBatchStatus.completed,
              failed: finalBatchStatus.failed,
            }), 'success');
          }
        } catch (error) {
          // 批量生成过程中的错误
          console.error('批量处理过程中发生未捕获错误:', error);
          showNotification(
            getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.batchGenerationFailed'),
            'error',
            true,
            [],
            {
              error,
              source: 'batch-generation',
              messageKey: 'painting.workspace.errors.batchGenerationFailed',
            },
          );
        }
      } else {
        // 单次生成 (图片或视频)
        const newItem = await generate(params);

        if (!newItem) {
          if (generationStatus && generationStatus.status === 'failed') {
            throw createWorkspaceError(generationStatus.errorCode || 'GENERATION_FAILED', {
              errorId: generationStatus.errorId,
              category: generationStatus.category,
              statusCode: generationStatus.statusCode,
              model: generationStatus.model || params.model,
              terminalGenerationFailed: generationStatus.terminalGenerationFailed,
            });
          } else {
            throw createWorkspaceError('GENERATION_FAILED');
          }
        }

        showNotification(t('painting.workspace.notifications.imageGenerated'), 'success');

        // 如果是图片且启用了自动保存
        if (imageSettings.autoSaveEnabled) {
          setTimeout(() => {
            autoSaveImage(newItem, imageSettings)
              .then(success => {
                if (success) {
                  showNotification(t('painting.workspace.notifications.imageAutoSaved'), 'info', true);
                }
              })
              .catch(err => console.error('自动保存图像失败:', err));
          }, 500);
        }
      }
    } catch (error) {
      console.error('图像生成过程中发生错误:', error);

      if (leftPanelMode === 'inpaint') {
        inpaintWorkspaceRef.current?.handleGenerationFailure?.();
      }

      // 客户端仅依据稳定错误码选择提示，原始异常只保留在控制台日志中。
      const errorMessage = getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.generationFailed');

      // 显示错误通知，不会自动消失
      showNotification(errorMessage, 'error', true, [], {
        error,
        source: 'image-generation',
        messageKey: WORKSPACE_ERROR_KEYS[error?.code]
          || 'painting.workspace.errors.generationFailed',
      });
    }
  };

  // 添加取消批量生成的处理函数
  const handleCancelBatchGeneration = () => {
    cancelBatchGeneration();
    showNotification(t('painting.workspace.notifications.batchCancelled'), 'info');
  };

  // 选择预览图
  const handleSelectPreview = (item) => {
    selectItem(item.id);
  };

  // 删除预览图 - 优化删除逻辑
  const handleDeletePreview = useCallback((itemIdToDelete) => {
    const itemIndex = generatedItems.findIndex(item => item.id === itemIdToDelete);
    deleteItem(itemIdToDelete);

    if (currentItem && currentItem.id === itemIdToDelete) {
      if (generatedItems.length > 1) {
        const newIndex = Math.max(0, itemIndex - 1);
        selectItem(generatedItems[newIndex]?.id);
      } else {
        selectItem(null);
      }
    }
  }, [generatedItems, currentItem, deleteItem, selectItem]);


  // 图像文件上传处理 - 直接将ParameterPanel中的该函数移到这里
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      // 导入并使用ImageResizer中的resizeImage函数
      const resizeResult = await resizeImage(file);

      // 设置外部图像数据
      setExternalImageData({
        dataURL: resizeResult.dataURL,
        width: resizeResult.width,
        height: resizeResult.height
      });

      // 更新宽度和高度参数
      handleParamChange('width', resizeResult.width);
      handleParamChange('height', resizeResult.height);

      // 展开图生图面板
      setExpandedPanels(prev => ({ ...prev, img2img: true }));

      // 显示成功通知
      showNotification(t('painting.workspace.notifications.addedToImg2Img'), 'success');

      return true;
    } catch (error) {
      console.error('处理图像失败:', error);
      showNotification(
        getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.imageProcessingFailed'),
        'error',
        true,
        [],
        { error, source: 'image-input', messageKey: 'painting.workspace.errors.imageProcessingFailed' },
      );
      return false;
    }
  };

  // Action button handler for ItemDisplay
  const handleActionButtonClick = async (action, _unusedParam, _displayNotification) => {
    // 项目操作统一使用页面通知，确保错误会进入同一个持久指示器。
    const notify = (message, severity = 'success', autoHide = true, actions = [], errorOptions = null) => (
      showNotification(message, severity, autoHide, actions, {
        ...(errorOptions || {}),
        source: errorOptions?.source || 'item-action',
      })
    );
    if (!currentItem) return false;

    if (
      isNovelAIV5Model(generationParams.model)
      && action === 'use-as-vibe'
    ) {
      notify(t('painting.workspace.errors.v5VibeUnsupported'), 'warning');
      return false;
    }

    // 辅助函数：将Blob转换为DataURL
    const convertBlobToDataURL = (blob) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    switch (action) {
      case 'official-upscale':
        if (upscaleInFlightRef.current) return false;
        upscaleInFlightRef.current = true;
        setIsUpscaling(true);
        try {
          const sourceToUpscale = currentItem.isComposited
            ? currentItem.src
            : (currentItem.downloadSrc || currentItem.originalSrc || currentItem.src);
          const sourceResponse = await fetch(sourceToUpscale);
          if (!sourceResponse.ok) {
            throw createWorkspaceError('MEDIA_ASSET_DOWNLOAD_FAILED', {
              statusCode: sourceResponse.status,
            });
          }
          const imageDataUrl = await convertBlobToDataURL(await sourceResponse.blob());
          const response = await apiClient.upscaleImage({
            image: imageDataUrl,
            model: currentItem.model || generationParams.model,
          });
          const upscaledImage = response?.images?.[0];
          if (!upscaledImage?.data) throw createWorkspaceError('INVALID_GENERATED_FILE');

          const cachedBlob = createBlobFromBase64(
            upscaledImage.data,
            upscaledImage.mime_type || 'image/png',
          );
          const displayUrl = createObjectUrlFromBlob(cachedBlob);
          if (!cachedBlob || !displayUrl) throw createWorkspaceError('INVALID_GENERATED_FILE');

          appendGeneratedItem({
            type: 'image',
            src: displayUrl,
            originalSrc: displayUrl,
            downloadSrc: displayUrl,
            cachedBlob,
            objectUrlToRevoke: displayUrl,
            seed: upscaledImage.seed ?? currentItem.seed ?? '',
            prompt: currentItem.prompt || '',
            width: currentItem.width,
            height: currentItem.height,
            isComposited: false,
            model: currentItem.model || generationParams.model,
          });
          if (response.account_snapshot) {
            window.dispatchEvent(new CustomEvent('novelai:account-updated', {
              detail: response.account_snapshot,
            }));
          }
          notify(t('painting.workspace.notifications.officialUpscaleComplete'), 'success');
          return true;
        } catch (error) {
          console.error('官方 Upscale 失败:', error);
          notify(
            getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.officialUpscaleFailed'),
            'error',
            true,
            [],
            { error, source: 'official-upscale', messageKey: 'painting.workspace.errors.officialUpscaleFailed' },
          );
          return false;
        } finally {
          upscaleInFlightRef.current = false;
          setIsUpscaling(false);
        }

      case 'use-as-input':
        try {
          const response = await fetch(currentItem.src);
          const blob = await response.blob();

          const file = new File([blob], `image_${Date.now()}.png`, { type: 'image/png' });

          const event = { target: { files: [file] } };

          const result = await handleImageUpload(event);

          return result;
        } catch (error) {
          console.error('转换图像失败:', error);
          notify(
            getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.imageConversionFailed'),
            'error',
            true,
            [],
            { error, messageKey: 'painting.workspace.errors.imageConversionFailed' },
          );
          return false;
        }

      case 'use-as-inpaint':
        try {
          return await handleSendCurrentItemToInpaint();
        } catch (error) {
          console.error('发送到局部重绘失败:', error);
          notify(
            getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.sendToInpaintFailed'),
            'error',
            true,
            [],
            { error, messageKey: 'painting.workspace.errors.sendToInpaintFailed' },
          );
          return false;
        }

      case 'use-as-vibe':
        try {
          const response = await fetch(currentItem.src);
          const blob = await response.blob();
          const file = new File([blob], `vibe_image_${Date.now()}.png`, { type: 'image/png' });

          const event = { target: { files: [file] } };

          if (isV4Model(generationParams.model)) {
            // For V4, we use the new logic which is handled inside ParameterPanel
            const customEvent = new CustomEvent('vibeImageDropped', { detail: { files: [file] } });
            window.dispatchEvent(customEvent);
          } else {
            // For V3, we use the old direct manipulation logic
            // This logic is now inside ParameterPanel's handleVibeImageUpload
            const customEvent = new CustomEvent('vibeImageDropped', { detail: { files: [file] } });
            window.dispatchEvent(customEvent);
          }

          setExpandedPanels(prev => ({ ...prev, vibe: true }));
          notify(t('painting.workspace.notifications.addedToVibe'), 'success');

          return true;
        } catch (error) {
          console.error('添加Vibe图像失败:', error);
          notify(getWorkspaceErrorMessage(t, error), 'error', true, [], { error });
          return false;
        }

      default:
        console.log('未知操作:', action);
        return false;
    }
  };

  // 用于移动端检查是否应该打开批量生成对话框
  const shouldOpenBatchDialog = batchStatus.active;

  // 处理抽屉打开关闭
  const toggleMobileDrawer = () => {
    setMobileDrawerOpen(!mobileDrawerOpen);
  };

  // 移动端抽屉展开时，点击一个面板时折叠其他面板
  const handleMobileExpandPanel = (panel, isExpanded) => {
    if (isMobile) {
      // 如果是展开操作，关闭其他所有面板
      if (isExpanded) {
        const newExpandedState = {
          basic: false,
          img2img: false,
          vibe: false,
          character: false
        };
        newExpandedState[panel] = true;
        setExpandedPanels(newExpandedState);
      } else {
        // 如果是折叠操作，直接更新当前面板状态
        setExpandedPanels(prev => ({
          ...prev,
          [panel]: false
        }));
      }
    } else {
      // 非移动端保持原来的行为
      setExpandedPanels(prev => ({
        ...prev,
        [panel]: isExpanded
      }));
    }
  };

  // 选择上一张图片
  const handleSelectPrevious = useCallback(() => {
    if (!currentItem || generatedItems.length <= 1) return;
    const currentIndex = generatedItems.findIndex(img => img.id === currentItem.id);
    const prevIndex = (currentIndex - 1 + generatedItems.length) % generatedItems.length;
    selectItem(generatedItems[prevIndex].id);
  }, [currentItem, generatedItems, selectItem]);

  // 选择下一张图片
  const handleSelectNext = useCallback(() => {
    if (!currentItem || generatedItems.length <= 1) return;
    const currentIndex = generatedItems.findIndex(img => img.id === currentItem.id);
    const nextIndex = (currentIndex + 1) % generatedItems.length;
    selectItem(generatedItems[nextIndex].id);
  }, [currentItem, generatedItems, selectItem]);

  const currentItemMetadata = currentItem?.metadataStatus === 'ready' && currentItem?.metadataSource === currentItem?.src
    ? currentItem.metadata
    : null;
  const hasCurrentItemActionRow = Boolean(currentItem);
  const hasCurrentItemSeed = currentItemMetadata?.seed !== undefined
    && currentItemMetadata?.seed !== null
    && currentItemMetadata?.seed !== '';


  const renderAnlasStatus = () => {
    const total = liveAccountSnapshot?.anlas?.total;
    const displayTotal = total === null || total === undefined
      ? t('painting.workspace.anlas.unavailable')
      : formatNumber(total);
    return (
      <Tooltip title={t('painting.workspace.anlas.openDetails')} arrow>
        <Button
          size="small"
          onClick={() => setAnlasDialogOpen(true)}
          aria-label={`${t('painting.workspace.anlas.balance')}: ${displayTotal}`}
          sx={{
            minWidth: 0,
            minHeight: 36,
            px: 0.75,
            py: 0.5,
            gap: 0.65,
            borderRadius: 1.5,
            border: `1px solid ${alpha(theme.palette.divider, 0.24)}`,
            bgcolor: alpha(theme.palette.primary.main, 0.055),
            color: 'text.primary',
            textTransform: 'none',
            whiteSpace: 'nowrap',
            lineHeight: 1,
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderColor: alpha(theme.palette.primary.main, 0.28),
            },
          }}
        >
          <Box
            component="span"
            sx={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              color: 'primary.main',
              lineHeight: 0,
            }}
          >
            <MonetizationOnIcon sx={{ display: 'block', fontSize: 17 }} />
          </Box>
          <Typography
            component="span"
            variant="caption"
            sx={{ color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}
          >
            {t('painting.workspace.anlas.balance')}
          </Typography>
          <Typography
            component="span"
            variant="body2"
            sx={{ fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
          >
            {displayTotal}
          </Typography>
        </Button>
      </Tooltip>
    );
  };

  const renderGenerationCost = (buttonState, compact = false) => {
    if (!isDisplayableNovelAICost(buttonState.cost)) return null;

    return (
      <Tooltip title={t('painting.workspace.anlas.estimatedCostHelp')} arrow>
        <Box
          component="span"
          aria-label={buttonState.costLabel}
          sx={{
            flexShrink: 0,
            minHeight: compact ? 24 : 26,
            px: compact ? 0.6 : 0.75,
            py: 0.35,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: compact ? 0.35 : 0.45,
            borderRadius: 1,
            bgcolor: 'rgba(0,0,0,0.16)',
            border: '1px solid rgba(255,255,255,0.16)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          <MonetizationOnIcon
            sx={{ display: 'block', flexShrink: 0, fontSize: compact ? 13 : 14, color: '#FFE082' }}
          />
          <Typography
            component="span"
            variant="caption"
            sx={{
              color: 'inherit',
              fontSize: compact ? '0.625rem' : '0.68rem',
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {buttonState.costLabel}
          </Typography>
        </Box>
      </Tooltip>
    );
  };

  return (
    <>
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          overflowX: 'hidden',
          position: 'relative',
          pb: isMobile ? '60px' : 0,
          backgroundColor: theme.palette.background.default,
        }}
        onDragOverCapture={(event) => {
          if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
            event.preventDefault();
          }
        }}
        onDropCapture={handlePageDrop}
      >
        {/* 通知提示框 */}
        <Snackbar
          open={notification.open}
          autoHideDuration={notification.autoHide ? 4000 : null}
          onClose={handleCloseNotification}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          sx={{ zIndex: 9999 }} // 确保最高层级
        >
          <Alert
            onClose={handleCloseNotification}
            severity={notification.severity}
            variant="filled"  // 使用填充样式使错误更明显
            sx={{
              width: '100%',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
              ...(notification.severity === 'error' && {
                fontWeight: 'medium',
              })
            }}
            action={
              (notification.actions?.length > 0 || notification.errorRecord) ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {notification.actions.map((action, index) => (
                    <Button
                      key={index}
                      color={action.color || 'inherit'}
                      size="small"
                      onClick={() => {
                        if (action.action && typeof action.action === 'function') {
                          action.action();
                        }
                        // 执行操作后关闭通知
                        handleCloseNotification();
                      }}
                    >
                      {action.text}
                    </Button>
                  ))}
                  {notification.errorRecord && (
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => {
                        setErrorSummaryOpen(true);
                        handleCloseNotification();
                      }}
                    >
                      {t('painting.workspace.actions.errorDetails')}
                    </Button>
                  )}
                  <IconButton
                    aria-label={t('painting.workspace.actions.close')}
                    color="inherit"
                    size="small"
                    onClick={handleCloseNotification}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : null
            }
          >
            <Box>
              <Typography variant="body2" component="div">
                {notification.message}
              </Typography>
              {notification.errorRecord && (
                <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.92 }}>
                  {t('painting.workspace.errorRecords.code')}: {notification.errorRecord.code}
                  {notification.errorRecord.errorId
                    ? ` · ${t('painting.workspace.errorRecords.errorId')}: ${notification.errorRecord.errorId}`
                    : ''}
                </Typography>
              )}
            </Box>
          </Alert>
        </Snackbar>

        {/* 左侧区域 - 图像显示 */}
        <Box
          sx={{
            flex: isMobile ? 'none' : 10,
            width: isMobile ? '100%' : 'auto',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            minHeight: isMobile ? '80vh' : 'auto', // 移动端增加最小高度
            maxHeight: '100%',
            p: 0.5,
            overflow: 'hidden',
          }}
        >
          <Paper
            elevation={0}
            sx={{
              flex: '0 0 auto',
              width: isMobile ? '100%' : 72,
              height: isMobile ? 'auto' : '100%',
              mr: isMobile ? 0 : 0.5,
              mb: isMobile ? 0.5 : 0,
              p: 0.5,
              borderRadius: 2,
              display: 'flex',
              flexDirection: isMobile ? 'row' : 'column',
              justifyContent: 'flex-start',
              gap: 0.5,
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
            }}
          >
            <Button
              variant={leftPanelMode === 'generation' ? 'contained' : 'outlined'}
              color="primary"
              onClick={() => setLeftPanelMode('generation')}
              sx={{
                minWidth: isMobile ? 'auto' : 0,
                flex: isMobile ? 1 : '0 0 auto',
                flexDirection: isMobile ? 'row' : 'column',
                gap: 0.5,
                py: 1,
              }}
            >
              <ImageIcon fontSize="small" />
              {t('painting.workspace.tabs.generation')}
            </Button>
            {(
              <Button
                variant={leftPanelMode === 'inpaint' ? 'contained' : 'outlined'}
                color="primary"
                onClick={() => setLeftPanelMode('inpaint')}
                sx={{
                  minWidth: isMobile ? 'auto' : 0,
                  flex: isMobile ? 1 : '0 0 auto',
                  flexDirection: isMobile ? 'row' : 'column',
                  gap: 0.5,
                  py: 1,
                }}
              >
                <BrushIcon fontSize="small" />
                {t('painting.workspace.tabs.inpaint')}
              </Button>
            )}
          </Paper>

          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                display: leftPanelMode === 'generation' ? 'flex' : 'none',
                flex: 1,
                minHeight: 0,
                flexDirection: 'column',
              }}
            >
              {/* 图像主展示区 */}
              <Paper
                elevation={0}
                sx={{
                  flex: 10,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  position: 'relative',
                  mb: 0.5,
                  p: 0.5,
                  overflow: 'hidden',
                  borderRadius: 2,
                  backgroundColor: themeColors.ItemDisplayBg,
                  minHeight: isMobile ? '50vh' : '300px',
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <ItemDisplay
                  item={currentItem}
                  onActionButtonClick={handleActionButtonClick}
                  onNextItem={handleSelectNext}
                  onPreviousItem={handleSelectPrevious}
                  onDeleteItem={() => currentItem && handleDeletePreview(currentItem.id)}
                  generatedItemsCount={generatedItems.length}
                  onApplyImageParameters={handleApplyImageParameters}
                  onError={reportWorkspaceFailure}
                  disableVibeAction={isV5Model}
                  isUpscaling={isUpscaling}
                />
              </Paper>

              {/* 图像预览区 */}
              <Paper
                elevation={0}
                sx={{
                  flex: '0 0 auto',
                  height: hasCurrentItemActionRow
                    ? { xs: 108, sm: 126, md: 136 }
                    : { xs: 80, sm: 100, md: 110 },
                  p: 0.5,
                  borderRadius: 2,
                  backgroundColor: themeColors.ItemPreviewBg,
                  overflow: 'hidden',
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <ItemPreview
                  items={generatedItems}
                  currentItemId={currentItem?.id}
                  onSelectItem={handleSelectPreview}
                  onDeleteItem={handleDeletePreview}
                  onSeedCopyAndApply={handleSeedCopyAndApply}
                  onUseItemMetadata={handleUseItemMetadata}
                />
              </Paper>
            </Box>

            {(
              <Paper
                elevation={0}
                sx={{
                  display: leftPanelMode === 'inpaint' ? 'block' : 'none',
                  flex: 1,
                  p: 0.5,
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundColor: themeColors.ItemDisplayBg,
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <InpaintWorkspacePanel
                  ref={inpaintWorkspaceRef}
                  generatedItems={generatedItems}
                  outputResolution={{ width: generationParams.width, height: generationParams.height }}
                  isMobile={isMobile}
                  onExportToGallery={handleExportInpaintToGallery}
                  showNotification={showNotification}
                  isGenerating={isGenerating}
                  generationStatus={generationStatus}
                  previewBatchStatus={inpaintPreviewBatch}
                  onCostParametersChange={setInpaintCostParameters}
                />
              </Paper>
            )}
          </Box>
        </Box>

        {/* 桌面端右侧区域 - 控制面板 */}
        {!isMobile && (
          <Box
            sx={{
              flex: 4,
              width: 'auto',
              minWidth: 0,
              p: 1,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflowX: 'hidden',
            }}
          >
            {/* 提示词和参数面板的滚动区域 */}
            <Box
              sx={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                height: '100%',
                pr: 0.1,
                // 滚动条样式使用主题色
                '&::-webkit-scrollbar': {
                  width: '4px',
                },
                '&::-webkit-scrollbar-track': {
                  background: alpha(theme.palette.action.hover, 0.3),
                  borderRadius: '3px',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: alpha(theme.palette.primary.main, 0.4),
                  borderRadius: '3px',
                  '&:hover': {
                    background: alpha(theme.palette.primary.main, 0.6),
                  }
                },
              }}
            >
              {/* 上方：正负面词条输入区 */}
              <Paper
                elevation={0}
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  flexShrink: 0,
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <PromptPanel
                  positivePrompt={positivePrompt}
                  negativePrompt={negativePrompt}
                  model={generationParams.model}
                  characterTabs={characterTabsForPromptTokens}
                  onPositivePromptChange={setPositivePrompt}
                  onNegativePromptChange={setNegativePrompt}
                  onSaveCurrentNote={handleSaveCurrentNote}
                  onApplyNoteContent={handleApplyMetadataFromNote}
                  onError={reportWorkspaceFailure}
                />
              </Paper>

              {/* 参数面板 - 传递expandedPanels和onExpandedPanelsChange */}
              <Paper
                elevation={0}
                sx={{
                  borderRadius: 2,
                  overflow: 'visible',
                  mb: 2,
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <ParameterPanel
                  params={generationParams}
                  onParamChange={handleParamChange}
                  getAllParametersRef={getAllParametersRef}
                  externalCharacterTabs={characterTabsFromNote} // 传递给 ParameterPanel
                  expandedPanels={expandedPanels}
                  onExpandedPanelsChange={handleExpandedPanelsChange}
                  fileInputRef={fileInputRef}
                  vibeFileInputRef={vibeFileInputRef}
                  vibeImages={vibeImages}
                  setVibeImages={setVibeImages}
                  externalImageData={externalImageData}
                  onImageToImageCostParametersChange={setImageToImageCostParameters}
                  onCharacterTabsChange={setCharacterTabsForPromptTokens}
                  onApplyMetadata={handleApplyMetadata}
                  positivePrompt={positivePrompt}
                  negativePrompt={negativePrompt}
                  onError={reportWorkspaceFailure}
                />
              </Paper>
            </Box>

            {/* 桌面模式下的生成按钮和验证组件区域 */}
            <Paper
              elevation={0}
              sx={{
                borderRadius: 2,
                p: 1.5,
                flexShrink: 0,
                bgcolor: theme.palette.background.paper,
                border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                minHeight: '64px',
                mt: 'auto',
                overflow: 'hidden',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minWidth: 0 }}>
                {/* 验证状态 - 使用新的简洁图标样式 */}
                <Box sx={{ flexShrink: 0 }}>
                  {renderAnlasStatus()}
                </Box>

                {/* 生成按钮区域 - 占据剩余空间 */}
                <Box sx={{ flex: 1, minWidth: 0, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
                  {/* 批量进度指示器 */}
                  {batchStatus.active && (
                    <Tooltip title={t('painting.workspace.actions.viewBatchDetails')} placement="top">
                      <IconButton
                        aria-label={t('painting.workspace.actions.viewBatchDetails')}
                        onClick={() => setBatchDialogOpen(true)}
                        size="small"
                        color="error"
                        sx={{ flexShrink: 0 }}
                      >
                        <Badge
                          badgeContent={`${batchStatus.current}/${batchStatus.total}`}
                          color="error"
                          max={999}
                          sx={{
                            '& .MuiBadge-badge': {
                              fontSize: '0.6rem',
                              height: 'auto',
                              padding: '0 4px',
                            }
                          }}
                        >
                          <BarChartIcon fontSize="small" />
                        </Badge>
                      </IconButton>
                    </Tooltip>
                  )}

                  {/* 错误数量指示器 */}
                  <Tooltip title={t('painting.workspace.actions.viewErrorDetails')} placement="top">
                    <IconButton
                      aria-label={t('painting.workspace.actions.viewErrorDetails')}
                      onClick={() => setErrorSummaryOpen(true)}
                      size="small"
                      color={workspaceErrors.length > 0
                        ? 'error'
                        : 'default'}
                      sx={{ flexShrink: 0 }}
                    >
                      <Badge
                        badgeContent={workspaceErrors.length}
                        color="error"
                        max={99}
                        sx={{
                          '& .MuiBadge-badge': {
                            fontSize: '0.6rem',
                          }
                        }}
                      >
                        <ErrorOutlineIcon fontSize="small" />
                      </Badge>
                    </IconButton>
                  </Tooltip>

                  <Box ref={setDesktopGenerateButtonContainer} sx={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
                    {/* 生成按钮 - 机械按键质感 */}
                    {(() => {
                      const buttonState = getGenerateButtonState();
                      const buttonContent = getResponsiveGenerateButtonContent({
                        availableWidth: desktopGenerateButtonWidth,
                        buttonState,
                        isMobile: false,
                      });
                      const isError = buttonState.color === 'error';
                      const mainColor = isError ? theme.palette.error.main : theme.palette.primary.main;
                      const lightColor = isError ? theme.palette.error.light : theme.palette.primary.light;
                      const darkColor = isError ? theme.palette.error.dark : theme.palette.primary.dark;
                      // 如果原先没有指定具体图标，对于这种动态情况增加一个后备生图图标以防极小尺寸看不见
                      const currentIcon = buttonState.icon || <ImageIcon />;

                      return (
                        <Button
                          variant="contained"
                          disabled={buttonState.disabled}
                          onClick={buttonState.action}
                          color={buttonState.color}
                          fullWidth
                          title={buttonState.text}
                          aria-label={buttonState.text}
                          sx={{
                            height: { xs: '44px', sm: '48px', md: '52px' },
                            minWidth: 0,
                            width: '100%',
                            maxWidth: '100%',
                            m: 0,
                            borderRadius: '8px',
                            border: 'none',
                            boxShadow: 'none',
                            background: mainColor,
                            color: 'white',
                            textTransform: 'none',
                            fontSize: { xs: '0.85rem', md: '0.95rem' },
                            fontWeight: 600,
                            transition: 'background 0.15s ease, opacity 0.15s ease',
                            '&:hover': {
                              boxShadow: 'none',
                              background: darkColor,
                            },
                            '&:active': {
                              boxShadow: 'none',
                              background: darkColor,
                              opacity: 0.9,
                            },
                            '&:disabled': {
                              border: 'none',
                              boxShadow: 'none',
                              background: alpha(theme.palette.action.disabledBackground, 0.5),
                              color: alpha(theme.palette.text.primary, 0.38),
                            },
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: buttonContent.showCost ? 'space-between' : 'center',
                            gap: buttonContent.showCost ? 1 : 0,
                            px: { xs: 1, md: 1.25, lg: 1.75 },
                            overflow: 'hidden',
                            boxSizing: 'border-box',
                          }}
                        >
                          <Box
                            sx={{
                              flex: buttonContent.showCost ? 1 : '0 1 auto',
                              minWidth: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: buttonContent.showText ? 1 : 0,
                              overflow: 'hidden',
                            }}
                          >
                            <Box sx={{ display: 'flex', flexShrink: 0, lineHeight: 0 }}>
                              {currentIcon}
                            </Box>
                            {buttonContent.showText && (
                              <Typography
                                variant="body1"
                                component="span"
                                sx={{
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  fontWeight: 'bold',
                                  minWidth: 0,
                                }}
                              >
                                {buttonContent.label}
                              </Typography>
                            )}
                          </Box>

                        {buttonContent.showCost && renderGenerationCost(buttonState)}
                      </Button>
                    );
                  })()}
                  </Box>

                  {/* 移动端参数菜单按钮 */}
                  {isMobile && (
                    <IconButton
                      aria-label={t('painting.workspace.actions.openParameters')}
                      color="primary"
                      onClick={toggleMobileDrawer}
                      sx={{
                        width: '44px',
                        height: '44px',
                        ml: 1,
                        borderRadius: '8px',
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                        flexShrink: 0,
                      }}
                    >
                      <TuneIcon />
                    </IconButton>
                  )}
                </Box>
              </Box>
            </Paper>
          </Box>
        )}

        {/* 移动端控制面板抽屉 */}
        {isMobile && (
          <SwipeableDrawer
            anchor="bottom"
            open={mobileDrawerOpen}
            onClose={() => setMobileDrawerOpen(false)}
            onOpen={() => setMobileDrawerOpen(true)}
            disableSwipeToOpen={false}
            ModalProps={{
              keepMounted: true,
            }}
            sx={{
              '& .MuiDrawer-paper': {
                height: '100vh',
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: themeColors.drawerBg,
              },
              zIndex: 1300,
            }}
          >
            {/* 抽屉标题栏 */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: `1px solid ${theme.palette.divider}`,
                pt: 1,
                pl: 1.5,
                position: 'sticky',
                top: 0,
                backgroundColor: theme.palette.background.paper, // 使用主题色
                zIndex: 1,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            >
              <Typography variant="h6" fontWeight="medium">
                {t('painting.workspace.parameters.title')}
              </Typography>
              <IconButton
                aria-label={t('painting.workspace.actions.closeParameters')}
                sx={{ mr: 0.5 }}
                onClick={() => setMobileDrawerOpen(false)}
                edge="end"
              >
                <CloseIcon />
              </IconButton>
            </Box>

            {/* 抽屉内容区域 */}
            <Box
              sx={{
                p: 1,
                overflowY: 'auto',
                height: '100vh',
                backgroundColor: theme.palette.background.default, // 使用主题色
                // 滚动条样式使用主题色
                '&::-webkit-scrollbar': {
                  width: '6px',
                },
                '&::-webkit-scrollbar-track': {
                  background: alpha(theme.palette.action.hover, 0.3),
                  borderRadius: '3px',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: alpha(theme.palette.primary.main, 0.4),
                  borderRadius: '3px',
                  '&:hover': {
                    background: alpha(theme.palette.primary.main, 0.6),
                  }
                },
              }}
            >
              {/* 提示词设置面板 */}
              <Paper
                elevation={0}
                sx={{
                  mb: 2,
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <PromptPanel
                  positivePrompt={positivePrompt}
                  negativePrompt={negativePrompt}
                  model={generationParams.model}
                  characterTabs={characterTabsForPromptTokens}
                  onPositivePromptChange={setPositivePrompt}
                  onNegativePromptChange={setNegativePrompt}
                  onSaveCurrentNote={handleSaveCurrentNote}
                  onApplyNoteContent={handleApplyMetadataFromNote}
                  onError={reportWorkspaceFailure}
                />
              </Paper>

              {/* 参数控制面板 */}
              <Paper
                elevation={0}
                sx={{
                  borderRadius: 2,
                  overflow: 'visible',
                  mb: 2,
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <ParameterPanel
                  params={generationParams}
                  onParamChange={handleParamChange}
                  getAllParametersRef={getAllParametersRef}
                  expandedPanels={expandedPanels}
                  onExpandedPanelsChange={(panel, isExpanded) => handleMobileExpandPanel(panel, isExpanded)}
                  fileInputRef={fileInputRef}
                  vibeFileInputRef={vibeFileInputRef}
                  vibeImages={vibeImages}
                  setVibeImages={setVibeImages}
                  externalImageData={externalImageData}
                  onImageToImageCostParametersChange={setImageToImageCostParameters}
                  onCharacterTabsChange={setCharacterTabsForPromptTokens}
                  onApplyMetadata={handleApplyMetadata}
                  positivePrompt={positivePrompt}
                  negativePrompt={negativePrompt}
                  onError={reportWorkspaceFailure}
                />
              </Paper>

              {/* 移动端抽屉与桌面、底栏复用同一个紧凑余额状态块。 */}
              <Paper
                elevation={0}
                sx={{
                  p: 1,
                  borderRadius: 2,
                  mb: 6,
                  bgcolor: theme.palette.background.paper,
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                {renderAnlasStatus()}
              </Paper>
            </Box>
          </SwipeableDrawer>
        )}

        {/* 移动端下的固定生成按钮 */}
        {isMobile && (
          <Box
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              py: 1.5,
              px: 2,
              backgroundColor: themeColors.mobileBottomBg,
              backdropFilter: 'blur(10px)',
              borderTop: `1px solid ${themeColors.mobileBottomBorder}`,
              zIndex: 1200,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {/* 移动端底栏沿用原状态位展示 NovelAI Anlas 总额。 */}
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {renderAnlasStatus()}

              {/* 批量生成状态指示器 - 移动端 */}
              {batchStatus.active && (
                <IconButton
                  aria-label={t('painting.workspace.actions.viewBatchDetails')}
                  size="small"
                  onClick={() => setBatchDialogOpen(true)}
                  color="error"
                  sx={{ ml: 1 }}
                >
                  <Badge
                    badgeContent={`${batchStatus.current}/${batchStatus.total}`}
                    color="error"
                    max={999}
                    sx={{
                      '& .MuiBadge-badge': {
                        fontSize: '0.55rem',
                        height: 'auto',
                        padding: '0 4px'
                      }
                    }}
                  >
                    <BarChartIcon fontSize="small" />
                  </Badge>
                </IconButton>
              )}

              {/* 错误指示器 - 移动端 */}
              <IconButton
                aria-label={t('painting.workspace.actions.viewErrorDetails')}
                size="small"
                onClick={() => setErrorSummaryOpen(true)}
                color={workspaceErrors.length > 0
                  ? 'error'
                  : 'default'}
                sx={{ ml: 1 }}
              >
                <Badge
                  badgeContent={workspaceErrors.length}
                  color="error"
                  max={99}
                >
                  <ErrorOutlineIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Box>

            {/* 生成按钮 - 使用动态状态 */}
            {(() => {
              const buttonState = getGenerateButtonState();
              const buttonContent = getResponsiveGenerateButtonContent({
                availableWidth: mobileGenerateButtonWidth,
                buttonState,
                isMobile: true,
              });
              const currentIcon = buttonState.icon || <ImageIcon />;
              
              const isError = buttonState.color === 'error';
              const mainColor = isError ? theme.palette.error.main : theme.palette.primary.main;
              const lightColor = isError ? theme.palette.error.light : theme.palette.primary.light;
              const darkColor = isError ? theme.palette.error.dark : theme.palette.primary.dark;

              return (
                <Box sx={{ display: 'flex', flexGrow: 1, minWidth: 0, ml: 1.5, alignItems: 'center', maxWidth: '100%' }}>
                  <Button
                    ref={setMobileGenerateButtonContainer}
                    variant="contained"
                    disabled={buttonState.disabled}
                    onClick={buttonState.action}
                    color={buttonState.color}
                    title={buttonState.text}
                    aria-label={buttonState.text}
                    sx={{
                      flexGrow: 1,
                      minWidth: 0,
                      maxWidth: '100%',
                      height: '44px',
                      borderRadius: '8px',
                      m: 0,
                      border: 'none',
                      boxShadow: 'none',
                      background: mainColor,
                      color: 'white',
                      transition: 'background 0.15s ease, opacity 0.15s ease',
                      '&:hover': {
                        boxShadow: 'none',
                        background: darkColor,
                      },
                      '&:active': {
                        boxShadow: 'none',
                        background: darkColor,
                        opacity: 0.9,
                      },
                      '&:disabled': {
                        border: 'none',
                        boxShadow: 'none',
                        background: alpha(theme.palette.action.disabledBackground, 0.5),
                        color: alpha(theme.palette.text.primary, 0.38),
                      },
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: buttonContent.showCost ? 'space-between' : 'center',
                      gap: buttonContent.showCost ? 1 : 0,
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      px: 1,
                      minWidth: 0,
                    }}>
                    <Box
                      sx={{
                        flex: buttonContent.showCost ? 1 : '0 1 auto',
                        minWidth: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: buttonContent.showText ? 1 : 0,
                        overflow: 'hidden',
                      }}
                    >
                      <Box sx={{ display: 'flex', flexShrink: 0, lineHeight: 0 }}>
                        {currentIcon}
                      </Box>
                      {buttonContent.showText && (
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 'bold',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                          }}
                        >
                          {buttonContent.label}
                        </Typography>
                      )}
                    </Box>

                    {/* 移动端同样始终显示可生成请求的预计点数。 */}
                    {buttonContent.showCost && renderGenerationCost(buttonState, true)}
                  </Button>

                  {/* 移动端打开参数菜单的按钮 */}
                  <IconButton
                    aria-label={t('painting.workspace.actions.openParameters')}
                    color="primary"
                    onClick={toggleMobileDrawer}
                    sx={{
                      width: '44px',
                      height: '44px',
                      ml: 1,
                      borderRadius: '8px',
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                      flexShrink: 0,
                    }}
                  >
                    <TuneIcon />
                  </IconButton>
                </Box>
              );
            })()}
          </Box>
        )}

        {/* 将BatchGenerationDialog改为使用Drawer而不是Dialog */}
        <Drawer
          anchor={isMobile ? "bottom" : "right"}
          open={batchDialogOpen}
          onClose={() => setBatchDialogOpen(false)} // 允许随时关闭侧边栏
          sx={{
            '& .MuiDrawer-paper': {
              width: isMobile ? '100%' : 400,
              borderRadius: isMobile ? '16px 16px 0 0' : 0,
              maxHeight: isMobile ? '80vh' : '100%',
              backgroundColor: theme.palette.background.paper, // 使用主题色
            },
          }}
        >
          <Box sx={{ p: 2, backgroundColor: theme.palette.background.default }}>
            <Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 2,
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              pb: 1
            }}>
              <Typography variant="h6" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
                {t('painting.workspace.batch.statusTitle')}
                {batchStatus.active && <CircularProgress size={20} sx={{ ml: 2 }} />}
              </Typography>
              <IconButton
                aria-label={t('painting.workspace.actions.closeBatchStatus')}
                onClick={() => setBatchDialogOpen(false)} // 允许随时关闭侧边栏
                size="small"
              >
                <CloseIcon />
              </IconButton>
            </Box>

            <BatchGenerationDialog
              open={true} // 始终为true，因为我们使用Drawer控制显示
              embedded={true} // 新增属性，表示内嵌模式
              onClose={() => setBatchDialogOpen(false)} // 允许随时关闭
              onCancel={handleCancelBatchGeneration}
            />

            {/* 如果用户想查看错误详情的按钮 */}
            {workspaceErrors.length > 0 && (
              <Button
                variant="outlined"
                color="error"
                startIcon={<ErrorOutlineIcon />}
                onClick={() => {
                  setErrorSummaryOpen(true);
                  setBatchDialogOpen(false);
                }}
                fullWidth
                sx={{ mt: 2 }}
              >
                {t('painting.workspace.actions.viewErrorDetailsCount', { count: workspaceErrors.length })}
              </Button>
            )}
          </Box>
        </Drawer>

        {/* 错误汇总对话框 */}
        <ErrorSummaryDialog
          open={errorSummaryOpen}
          onClose={() => setErrorSummaryOpen(false)}
          errors={workspaceErrors}
          onClear={clearWorkspaceErrors}
        />
      </Box>
      <Dialog open={anlasDialogOpen} onClose={() => setAnlasDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('painting.workspace.anlas.title')}</DialogTitle>
        <DialogContent>
          {liveAccountSnapshot?.stale === true && (
            <Alert severity="warning" sx={{ mb: 2 }}>{t('painting.workspace.anlas.stale')}</Alert>
          )}
          <Stack spacing={1.25}>
            {[
              [t('painting.workspace.anlas.fixed'), liveAccountSnapshot?.anlas?.fixed],
              [t('painting.workspace.anlas.purchased'), liveAccountSnapshot?.anlas?.purchased],
              [t('painting.workspace.anlas.updatedAt'), liveAccountSnapshot?.refreshed_at],
            ].map(([label, value]) => (
              <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Typography color="text.secondary">{label}</Typography>
                <Typography>{value === null || value === undefined || value === ''
                  ? t('painting.workspace.anlas.unavailable')
                  : String(value)}</Typography>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnlasDialogOpen(false)}>{t('painting.workspace.actions.close')}</Button>
        </DialogActions>
      </Dialog>
      <MetadataDialog
        open={pageMetadataDialog.open}
        onClose={() => setPageMetadataDialog({ open: false, metadata: null })}
        metadata={pageMetadataDialog.metadata}
        onApply={handleApplyPageMetadata}
      />
    </>
  );
};

// 包装了Context Provider的根组件
const AIPaintingPage = ({ userId, accountSnapshot = null }) => {
  return (
    <GenerationProvider>
      <AIPaintingPageContent userId={userId} accountSnapshot={accountSnapshot} />
    </GenerationProvider>
  );
};

export default AIPaintingPage;
