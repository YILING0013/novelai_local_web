'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MobileGenerationTools from './MobileGenerationTools';

import { MODEL_OPTIONS } from './utils/generationOptions';
import { generateFileName, getImageSettings } from './tools/ImageTools/ImageSaveUtils';
import usePreviewImageDrag from './usePreviewImageDrag';
import { hasFileDrag, readDroppedFiles } from './tools/ImageTools/previewImageDragData.mjs';
import { getWorkspaceShortcut } from './tools/ImageTools/workspaceShortcuts.mjs';
import { defaultImagePreviewSettings, exportPreviewImage, imagePreviewSettingsKey, readImagePreviewSettings } from './tools/ImageTools/previewImageExport';
import { readQuickImagePresets } from './ImageProcessing/quickImageAdjustments';
import QuickImageAdjustment from './ImageProcessing/QuickImageAdjustment';
// AIPaintingPage.js

import AnlasIcon from './AnlasIcon';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
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
  Menu,
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
  ViewQuilt as ComicIcon,
  Warning as WarningIcon,
  PhotoFilter as ImageProcessingIcon,
  Check as CheckIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import ItemDisplay from './ItemDisplay';
import ImageEnhanceDialog from './ImageEnhanceDialog';
import ItemPreview from './ItemPreview';
import PromptPanel from './PromptPanel';
import WorkVersionBar from './WorkVersionBar';
import { restoreVersionWorkspace } from './utils/versionWorkspace.mjs';
import { buildGenerationRequest } from './Generation/ImageGenerationService';
import { normalizeNoteCharacters } from './NoteBook/noteCharacters.mjs';
import ParameterPanel from './ParameterPanel';
import InpaintWorkspacePanel from './InpaintWorkspace/InpaintWorkspacePanel';
import ComicWorkspace from './ComicWorkspace/ComicWorkspace';
import { panelBounds } from './ComicWorkspace/comicDocument.mjs';
import { getPanelResolutionParameters } from './utils/parameterMapping';
import { GenerationProvider, useGeneration } from './Generation/GenerationContext';
import BatchGenerationDialog from './tools/BatchGeneration/BatchGenerationDialog';
import ErrorSummaryDialog from './tools/BatchGeneration/ErrorSummaryDialog';
import MetadataDialog from './tools/ImageTools/MetadataDialog';
import { resizeImage } from './tools/ImageTools/ImageResizer';
import apiClient from '@/utils/ApiClient';
import { copyTextToClipboard, createClientId } from '@/utils/browserCapabilities.mjs';
import { createObjectUrlFromBlob, revokeObjectUrl, fetchUrlAsBlob } from '@/utils/mediaAssets';
import { extractActiveContent } from './PromptEditor';
import { applyImageParametersToUI } from './utils/parameterMapping';
import { extractMetadataFromFile, extractMetadataFromImageSrc } from './utils/metadataUtils';
import { clearVibePanelState, getVibePanelState, saveVibePanelState } from './utils/vibeDB';
import { getModelForPreciseReferences, getEffectiveReferenceParams, resolveWorkspaceReferences, restoreRequestReferenceImages } from './utils/novelAIReferenceParams.mjs';
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
  isMobile,
  formatNumber
}) => {
  const compactText = buttonState.shortText || buttonState.text;
  const hasCost = isDisplayableNovelAICost(buttonState.cost);
  const costLabel = formatNumber(buttonState.costTotal ?? buttonState.cost);
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
const ImageProcessingWorkspace = dynamic(() => import('./ImageProcessing/ImageProcessingWorkspace'), { ssr: false });

const AIPaintingPageContent = ({ userId, accountSnapshot = null, releaseGuideActive = false, suggestionPractice = false, promptExerciseTopic, promptExerciseActive = false, onExitSuggestionPractice, onBack, backLabel, tutorialTopic, offlinePractice = false, active = true, workContext, onWorkContextChange, renderModeTools, desktopEditor, androidLayout = false, sharedImage, onSharedImageHandled }) => {
  const { t, formatNumber, formatDate, locale } = useI18n();
  const [savedPreviewSettings, setPreviewSettings] = useState(null);
  const previewSettings = savedPreviewSettings ?? defaultImagePreviewSettings;

  useEffect(() => {
    const refresh = () => setPreviewSettings(readImagePreviewSettings());
    refresh();
    window.addEventListener('novelai:workspace-image-preview-changed', refresh);
    return () => window.removeEventListener('novelai:workspace-image-preview-changed', refresh);
  }, []);

  useEffect(() => {
    if (!savedPreviewSettings) return;
    try {
      localStorage.setItem(imagePreviewSettingsKey, JSON.stringify(savedPreviewSettings));
    } catch (error) {
      console.warn('无法保存图像预览设置:', error);
    }
  }, [savedPreviewSettings]);

  useEffect(() => {
    if (!active || !previewSettings.privacyShortcut) return;
    const togglePrivacy = (event) => {
      if (event.defaultPrevented || event.repeat || event.isComposing
        || event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      if (getWorkspaceShortcut(event) !== previewSettings.privacyShortcut) return;
      event.preventDefault();
      setPreviewSettings((saved) => ({ ...(saved ?? defaultImagePreviewSettings), privacyMode: !(saved?.privacyMode) }));
    };
    document.addEventListener('keydown', togglePrivacy);
    return () => document.removeEventListener('keydown', togglePrivacy);
  }, [active, previewSettings.privacyShortcut]);
  const comicText = locale === 'en-US' ? {
    title: 'Comic maker', edit: 'Panel parameters', save: 'Save task', close: 'Back to canvas',
    generate: 'Generate panel', select: 'Select a panel', saved: 'Panel task saved',
    received: 'Image saved to gallery and added to panel',
    missing: 'The panel was removed. The generated image is saved in your local gallery.',
    saving: 'Saving panel image', video: 'Comic panels support image models only.',
  } : {
    title: '漫画制作', edit: '分镜生成参数', save: '暂存任务', close: '返回画布',
    generate: '生成分镜', select: '请选择分镜', saved: '分镜任务已暂存',
    received: '图像已保存画廊并填入分镜',
    missing: '目标分镜已删除，生成图像已保存到本地画廊。',
    saving: '正在保存分镜图像', video: '漫画分镜仅支持图像模型。',
  };
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const compactAndroid = androidLayout && isMobile;
  const workspaceRef = useRef(null);
  const [comicEditorOpen, setComicEditorOpen] = useState(false);
  const parameterResizeRef = useRef(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [parameterPanelWidth, setParameterPanelWidth] = useState(null);
  const [resizingParameters, setResizingParameters] = useState(false);
  const maxParameterPanelWidth = Math.max(320, Math.min(680, workspaceWidth - 320));
  const visibleParameterPanelWidth = Math.min(maxParameterPanelWidth,
    parameterPanelWidth ?? Math.min(460, Math.max(380, workspaceWidth * 0.3)));

  useEffect(() => {
    // 菜单展开或窗口变窄时为画布保留空间，不让参数面板挤出页面。
    const observer = new ResizeObserver(([entry]) => setWorkspaceWidth(entry.contentRect.width));
    observer.observe(workspaceRef.current);
    return () => observer.disconnect();
  }, []);
  const accountDefaultModel = DEFAULT_PAINTING_MODEL_ID;
  const themeColors = {
    ItemDisplayBg: theme.palette.background.paper,
    ItemPreviewBg: theme.palette.background.default,

    // 移动端底部栏颜色
    mobileBottomBg: theme.palette.background.paper,
    mobileBottomBorder: theme.palette.divider,

    // 抽屉背景色
    drawerBg: theme.palette.background.paper,
  };
  const {
    currentItem, selectedByGeneration,
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
  const { customMetadata, scrambledMetadata } = previewSettings;
  const getItemPreviewFile = useMemo(() => {
    const filesByItem = new WeakMap();
    return (mode, asPng, item) => {
      let exportFiles = filesByItem.get(item);
      if (!exportFiles) {
        exportFiles = new Map();
        filesByItem.set(item, exportFiles);
      }
      const key = mode === 'original' && asPng ? 'original-png' : mode;
      if (!exportFiles.has(key)) {
        const source = item.cachedBlob || fetchUrlAsBlob(item.downloadSrc || item.originalSrc || item.src);
        const file = Promise.resolve(source)
          .then((blob) => exportPreviewImage(blob, mode, { customMetadata, scrambledMetadata }, asPng))
          .then((blob) => {
            const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.startsWith('image/') ? blob.type.slice(6) : 'png';
            const name = generateFileName(item, getImageSettings(), { extension, fallbackName: item.seed ?? item.id });
            return new File([blob], name, { type: blob.type });
          })
          .catch((error) => {
            exportFiles.delete(key);
            throw error;
          });
        exportFiles.set(key, file);
      }
      return exportFiles.get(key);
    };
  }, [customMetadata, scrambledMetadata]);
  const getPreviewFile = useCallback((mode, asPng) => getItemPreviewFile(mode, asPng, currentItem), [getItemPreviewFile, currentItem]);

  const parameterEditorRef = useRef(null);
  const comicWorkspaceRef = useRef(null);
  const comicTargetRef = useRef(null);
  const comicFlightRef = useRef(null);
  const comicAIFlightRef = useRef(false);
  const regularPaintingSnapshotRef = useRef(null);
  const [comicSelectedTarget, setComicSelectedTarget] = useState(null);
  const [comicPanelBounds, setComicPanelBounds] = useState(null);
  const [comicGenerationBusy, setComicGenerationBusy] = useState(false);
  const [comicAIBusy, setComicAIBusy] = useState(false);
  const [comicWorkspaceVisited, setComicWorkspaceVisited] = useState(false);
  const [imageProcessingVisited, setImageProcessingVisited] = useState(false);
  const [processingGalleryRequest, setProcessingGalleryRequest] = useState(null);
  const [parameterEditorState, setParameterEditorState] = useState(null);
  const [parameterEditorKey, setParameterEditorKey] = useState(0);
  const [leftPanelMode, setPanelMode] = useState('generation');
  const setLeftPanelMode = useCallback((mode) => {
    if (mode !== 'generation') setAdjustmentSource(undefined);
    setPanelMode(mode);
  }, []);
  const [adjustmentSource, setAdjustmentSource] = useState(undefined);
  const [adjustmentPanel, setAdjustmentPanel] = useState(null);
  const [quickImagePresets, setQuickImagePresets] = useState([]);
  const adjustmentActive = adjustmentSource !== undefined && leftPanelMode === 'generation';
  const displayPrivacy = previewSettings.privacyMode && previewSettings.privacyScope !== 'history';
  const toggleAdjustment = () => {
    setMobileDrawerOpen(false);
    setAdjustmentSource(adjustmentActive ? undefined : currentItem?.type === 'image' ? currentItem : null);
  };
  useEffect(() => {
    let active = true;
    void readQuickImagePresets().then((presets) => { if (active) setQuickImagePresets(presets); })
      .catch((error) => console.warn('读取单图处理预设失败:', error));
    return () => { active = false; };
  }, []);

  const versionContext = workContext;
  const setVersionContext = onWorkContextChange;
  const [versionLoading, setVersionLoading] = useState(false);
  const versionSelectionRef = useRef(0);
  const changeVersionContext = useCallback((context) => {
    versionSelectionRef.current += 1;
    setVersionContext(context);
  }, [setVersionContext]);
  useEffect(() => () => {
    // 退出登录或关闭工作区时，只阻止尚未发送的后续请求。
    const flight = comicFlightRef.current;
    if (!flight) return;
    flight.cancelled = true;
    if (flight.batchId) void apiClient.cancelImageBatch(flight.batchId, true).catch(() => {});
  }, []);
  const isCanvasWorkspace = leftPanelMode === 'comic' || leftPanelMode === 'imageProcessing';
  const imageToolBusyRef = useRef(false);
  const [imageToolBusy, setImageToolBusy] = useState(false);
  const [enhanceSource, setEnhanceSource] = useState(null);
  const inpaintWorkspaceRef = useRef(null);
  const fileInputRef = useRef(null);
  const vibeFileInputRef = useRef(null);
  const [inpaintPreviewBatch, setInpaintPreviewBatch] = useState({ active: false, current: 0, total: 0 });
  const [characterTabsFromNote, setCharacterTabsFromNote] = useState(null);
  const [characterTabsForPromptTokens, setCharacterTabsForPromptTokens] = useState([]);
  const [errorSummaryOpen, setErrorSummaryOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [workspaceErrors, setWorkspaceErrors] = useState([]);
  const [errorRecordsHydrated, setErrorRecordsHydrated] = useState(false);
  const [errorRecordsOwnerKey, setErrorRecordsOwnerKey] = useState('');
  const [vibeImages, setVibeImages] = useState([]);
  const [vibeCacheHydrated, setVibeCacheHydrated] = useState(false);
  const [pageMetadataDialog, setPageMetadataDialog] = useState({ open: false, metadata: null });
  const [imageImportRequest, setImageImportRequest] = useState(null);
  const [liveAccountSnapshot, setLiveAccountSnapshot] = useState(accountSnapshot);
  const [anlasDialogOpen, setAnlasDialogOpen] = useState(false);
  const [preferredGenerationParams, setGenerationParams] = useState(() => {
    // 尝试从localStorage中读取参数
    try {
      const defaults = {
        width: 1024,
        height: 1024,
        steps: 28,
        guidanceScale: 5,
        seed: '',
        batchSize: 1,
        model: accountDefaultModel,
        v5HighSettings: null,
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
        steps: 28,
        guidanceScale: 5,
        seed: '',
        batchSize: 1,
        model: accountDefaultModel,
        v5HighSettings: null,
      };
    }
  });

  const [imageToImageCostParameters, setImageToImageCostParameters] = useState(null);
  const [referenceCounts, setReferenceCounts] = useState({ v5Added: 0, active: 0 });
  const referenceInpaint = leftPanelMode === 'inpaint' || Boolean(imageToImageCostParameters?.mask);
  const referenceUnavailable = referenceInpaint || Boolean(imageToImageCostParameters?.directorTools);
  const effectiveModel = getModelForPreciseReferences(preferredGenerationParams.model, referenceCounts.v5Added, referenceUnavailable);
  const generationParams = useMemo(() => getEffectiveReferenceParams(preferredGenerationParams, effectiveModel),
    [effectiveModel, preferredGenerationParams]);
  const canUseReference = !imageToImageCostParameters?.directorTools
    && isNovelAIDirectorReferenceModel(getModelForPreciseReferences(effectiveModel, 1, referenceUnavailable), referenceInpaint);
  const canUseVibe = isNovelAIVibeModel(effectiveModel, referenceInpaint);
  const hasActiveVibes = canUseVibe && vibeImages.some((image) => !image.isTemporarilyDisabled);

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
    loadModelPromptCache(preferredGenerationParams.model)
  ));
  const activePromptModelRef = useRef(preferredGenerationParams.model);
  activePromptModelRef.current = preferredGenerationParams.model;
  const activePrompts = promptsByModel[preferredGenerationParams.model] || {
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
    if (leftPanelMode !== 'comic') persistModelPromptCache(promptsByModel);
  }, [promptsByModel, leftPanelMode]);

  // 移动端抽屉状态
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const practicingPrompt = suggestionPractice || promptExerciseActive;
  const tutorialPromptActive = offlinePractice || practicingPrompt || Boolean(promptExerciseTopic);
  useEffect(() => {
    if (isMobile && practicingPrompt) setMobileDrawerOpen(true);
  }, [isMobile, practicingPrompt]);
  const closeParameterDrawer = () => {
    setMobileDrawerOpen(false);
    if (practicingPrompt) onExitSuggestionPractice();
  };
  // 添加图像数据状态
  const [externalImageData, setExternalImageData] = useState(null);
  const [inpaintCostParameters, setInpaintCostParameters] = useState(null);
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
    otherSettings: false,
    img2img: false,
    vibe: false,
    reference: false,
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
    if (!vibeCacheHydrated || leftPanelMode === 'comic') {
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
  }, [vibeImages, vibeCacheHydrated, leftPanelMode]);
  const [setDesktopGenerateButtonContainer, desktopGenerateButtonWidth] = useObservedWidth();
  const [setMobileGenerateButtonContainer, mobileGenerateButtonWidth] = useObservedWidth();
  const [comicToolbarContainer, setComicToolbarContainer] = useState(null);
  const [parameterToolbarContainer, setParameterToolbarContainer] = useState(null);
  const [drawerToolbarContainer, setDrawerToolbarContainer] = useState(null);

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
  const calculateGenerationCost = useCallback((params, currentEditParameters, referenceCount) => {
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
      accountSnapshot: liveAccountSnapshot,
      referenceCount,
      batchSize: params.batchSize,
    });
  }, [liveAccountSnapshot]);

  /**
   * 按全部分镜实际生成规则累计点数，每个可编辑画框只生成一张。
   * @param {object} page 当前漫画页，包含画框、图层和暂存参数。
   * @returns {{count: number, total: number|null}} 分镜数量及总点数；超限时总点数为空。
   */
  const getComicBatchCost = (page) => {
    const panels = page.panels.filter((panel) => page.layers.some((layer) => layer.id === panel.layerId && layer.visible && !layer.locked));
    let total = 0;
    for (const panel of panels) {
      const isSelected = panel.id === comicTargetRef.current?.panelId;
      const savedState = !isSelected && panel.task?.params.parameterState;
      const savedReferences = savedState && resolveWorkspaceReferences(savedState.params, savedState.referenceImages || restoreRequestReferenceImages(savedState.params),
        panel.task.params.vibeImages || [], Boolean(savedState.imagePreview && savedState.restoredMask?.mask),
        Boolean(savedState.imagePreview && savedState.directorToolParams));
      const params = { ...(savedReferences ? savedReferences.params : generationParams), batchSize: 1 };
      // 未暂存的其它画框会按框形匹配尺寸，预估也使用同样的尺寸。
      if (!panel.task && !isSelected) Object.assign(params, getPanelResolutionParameters(params, panelBounds(panel)));
      const imageParameters = savedState
        ? { image: savedState.imagePreview, strength: params.strength, ...savedState.restoredMask }
        : imageToImageCostParameters;
      const referenceCount = savedReferences ? savedReferences.referenceParams?.director_reference_images_cached.length || 0 : referenceCounts.active;
      const cost = calculateGenerationCost(params, imageParameters, referenceCount);
      if (cost.total === null) return { count: panels.length, total: null };
      total += cost.total;
    }
    return { count: panels.length, total };
  };

  // 获取按钮状态的函数
  const getGenerateButtonState = () => {
    if (versionLoading) return {
      text: t('gallery.versionWorkspace.loading'), shortText: t('gallery.versionWorkspace.loading'),
      action: () => {}, color: 'primary', icon: <BrushIcon />, disabled: true, cost: null,
    };
    if (comicGenerationBusy && comicFlightRef.current?.count > 1) {
      return {
        text: t('painting.workspace.actions.cancelBatch', {
          current: comicFlightRef.current.index + 1, total: comicFlightRef.current.count,
        }),
        action: () => { comicFlightRef.current.cancelled = true; },
        color: 'error', icon: <CancelIcon />, disabled: false, cost: null,
      };
    }
    const isInpaintMode = leftPanelMode === 'inpaint';
    const isV4 = isV4Model(generationParams.model);
    const hasImageReference = referenceCounts.active > 0;
    const estimatedCost = calculateGenerationCost(
      generationParams,
      isInpaintMode ? inpaintCostParameters : imageToImageCostParameters,
      referenceCounts.active,
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
      && isNovelAIVibeModel(generationParams.model, isInpaintMode)
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

    // 正在进行单次生成
    if (isGenerating || imageToolBusy || comicGenerationBusy || comicAIBusy) {
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
        shortText: compactAndroid ? (locale === 'zh-CN' ? '局部重绘' : 'Inpaint') : t('painting.workspace.actions.startInpainting'),
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

    if (leftPanelMode === 'comic') {
      return {
        text: comicSelectedTarget ? `${comicText.generate} #${comicSelectedTarget.panelNumber}` : comicText.select,
        action: handleGenerate, color: 'primary', disabled: !comicSelectedTarget,
        cost: estimatedCost.perImage, costTotal: estimatedCost.total,
        costCount: estimatedCost.count, costLabel,
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
      disabled: tutorialPromptActive,
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
  const handleApplyMetadataFromNote = (note, applyModel, modelOptions, changeParameter) => {
    let characters;
    try {
      characters = normalizeNoteCharacters(note.character_tabs ?? note.characterTabs, note.model);
    } catch {
      showNotification(t('painting.tools.notebook.errors.NOTE_CHARACTER_JSON_INVALID'), 'error');
      return false;
    }
    const mappedModel = applyModel && note.model;
    if (mappedModel && !modelOptions.some((option) => option.value === mappedModel)) {
      showNotification(t('painting.workspace.errors.modelNotAvailableForAccount'), 'warning');
      return false;
    }
    // 模型切换与手工选择共用参数面板的默认值；等待切换期间也要把提示词写进目标模型的缓存。
    if (mappedModel && mappedModel !== preferredGenerationParams.model) changeParameter('model', mappedModel);
    const promptModel = mappedModel || preferredGenerationParams.model;
    setPositivePrompt(note.text_content1 || '', promptModel);
    setNegativePrompt(note.text_content2 || '', promptModel);
    if (characters.length && isNovelAIV5Model(mappedModel || effectiveModel) && note.character_position_mode) {
      changeParameter('characterPositionMode', note.character_position_mode);
    }
    setCharacterTabsFromNote(characters);
    if (characters.length) setExpandedPanels(prev => ({ ...prev, character: true }));
    showNotification(t('painting.workspace.notifications.noteApplied'), 'success');
    return true;
  };

  // 这个函数会作为 prop 传递给 PromptPanel，再由 PromptPanel 传递给 SaveNoteDialog
  const handleSaveCurrentNote = async (title, imageUrl, characterTabsToSave, groupId) => {
    if (!title.trim()) {
      showNotification(t('painting.workspace.errors.noteTitleRequired'), 'warning');
      return false; // 指示保存失败
    }
    try {
      const activePositive = extractActiveContent(positivePrompt, {
      });
      const activeNegative = extractActiveContent(negativePrompt, {
      });
      // 保存对话框已解析过的角色卡，确保预览内容与实际保存一致。
      await apiClient.saveTexts(title, activePositive, activeNegative, imageUrl, characterTabsToSave, groupId,
        generationParams.model, isNovelAIV5Model(generationParams.model) ? parameterEditorRef.current.getSnapshot().params.characterPositionMode : null);
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
      setPositivePrompt(metadataInfo.positivePrompt, metadataInfo.model);
    }

    // 设置负面提示词
    if (metadataInfo.negativePrompt !== undefined) {
      setNegativePrompt(metadataInfo.negativePrompt, metadataInfo.model);
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
      console.error('捕获到未处理的错误:', createPaintingErrorRecord(error));
      showNotification(
        getWorkspaceErrorMessage(t, error?.error || error),
        'error',
        true,
        [],
        { error: error?.error || error, source: 'browser', messageKey: getWorkspaceErrorMessageKey(error?.error || error) },
      );
    };

    // 页面加载完成后检查是否需要刷新按钮状态 - 只执行一次
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      // 强制刷新按钮状态
      setGenerationParams(prevParams => ({ ...prevParams }));
      console.log('生成参数已从缓存加载:', generationParams);
    }

    // 添加事件监听器
    window.addEventListener('error', handleGlobalError);

    // 清理
    return () => {
      window.removeEventListener('error', handleGlobalError);
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
    setGenerationParams((previousParams) => {
      const nextParams = {
        ...previousParams,
        [param]: resolvedValue,
      };

      if (param === 'model' && (!isNovelAIDirectorReferenceModel(resolvedValue)
        || isNovelAIV5Model(resolvedValue) !== isNovelAIV5Model(previousParams.model))) {
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
      console.error('应用图像参数失败:', createPaintingErrorRecord(error));
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
      console.error('读取图像元数据失败:', createPaintingErrorRecord(error));
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

  const closePageImageImport = useCallback(() => {
    if (sharedImage && pageMetadataDialog.file === sharedImage) onSharedImageHandled();
    setPageMetadataDialog({ open: false, metadata: null });
  }, [sharedImage, pageMetadataDialog.file, onSharedImageHandled]);

  const handleApplyPageMetadata = useCallback((filteredMetadata) => {
    closePageImageImport();
    if (!filteredMetadata) {
      return;
    }

    applyMetadataToCurrentParams(filteredMetadata, {
      successMessage: t('painting.workspace.notifications.imageMetadataApplied'),
      warningMessage: t('painting.workspace.errors.partialMetadataApply'),
    });
  }, [closePageImageImport, applyMetadataToCurrentParams, t]);

  const openImageImport = useCallback(async (imageFile) => {
    // 普通图片也能进入参考、重绘或编辑流程。
    setPageMetadataDialog({ open: true, file: imageFile, metadata: null, reading: true });
    try {
      const metadata = await extractMetadataFromFile(imageFile);
      setPageMetadataDialog(current => current.open && current.file === imageFile ? { ...current, metadata } : current);
    } catch {
      showNotification(t('painting.workspace.errors.applyImageMetadataFailed'), 'warning');
    } finally {
      setPageMetadataDialog(current => current.file === imageFile ? { ...current, reading: false } : current);
    }
  }, [showNotification, t]);

  useEffect(() => {
    if (active && sharedImage && !pageMetadataDialog.open) void openImageImport(sharedImage);
  }, [active, sharedImage, pageMetadataDialog.open, openImageImport]);

  const handlePageDrop = useCallback((event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files') || event.target?.closest?.('[data-drop-zone]')) return;
    event.preventDefault();
    event.stopPropagation();
    const imageFile = readDroppedFiles(event.dataTransfer).find((file) => file.type?.startsWith('image/'));
    if (!imageFile) return;
    if (adjustmentActive) setAdjustmentSource({ id: crypto.randomUUID(), cachedBlob: imageFile });
    else void openImageImport(imageFile);
  }, [adjustmentActive, openImageImport]);

  const handleUseDroppedImage = async (target, file) => {
    closePageImageImport();
    if (target === 'editor') {
      const request = { id: crypto.randomUUID(), generatedItem: { id: crypto.randomUUID(), cachedBlob: file, type: 'image' } };
      if (desktopEditor) desktopEditor.open(request);
      else { setProcessingGalleryRequest(request); changeWorkspaceMode('imageProcessing'); }
      return;
    }
    if (target === 'inpaint') {
      if (!inpaintWorkspaceRef.current) {
        showNotification(t('painting.workspace.errors.inpaintNotReady'), 'warning');
        return;
      }
      const src = URL.createObjectURL(file);
      try {
        await inpaintWorkspaceRef.current.importImageSource({ src, name: file.name });
        changeWorkspaceMode('inpaint');
      } catch {
        showNotification(t('painting.workspace.errors.imageProcessingFailed'), 'error');
      } finally {
        URL.revokeObjectURL(src);
      }
      return;
    }
    changeWorkspaceMode('generation');
    setExpandedPanels(current => ({ ...current, [target]: true }));
    setImageImportRequest({ id: crypto.randomUUID(), target, file });
    if (compactAndroid) setMobileDrawerOpen(true);
  };

  const handleSeedCopyAndApply = useCallback(async (seed) => {
    if (seed === undefined || seed === null || seed === '') {
      return;
    }

    const seedValue = typeof seed === 'string' ? seed : String(seed);
    handleParamChange('seed', seedValue);
    setExpandedPanels(prev => ({ ...prev, basic: true }));

    try {
      await copyTextToClipboard(seedValue);
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

  const importHistoryImages = async (files) => {
    const results = await Promise.allSettled(files.filter((file) => file.type.startsWith('image/')).map(async (file) => {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      const src = createObjectUrlFromBlob(file);
      return { src, width, height, cachedBlob: file, objectUrlToRevoke: src };
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') appendGeneratedItem(result.value);
    }
    if (!results.length || results.some((result) => result.status === 'rejected')) {
      showNotification(t('painting.workspace.gallery.historyImportFailed'), 'warning');
    }
  };


  const handleExportInpaintToHistory = useCallback((item) => {
    appendGeneratedItem({
      ...item,
      originalSrc: item.src,
      isComposited: true,
      type: 'image',
    });
  }, [appendGeneratedItem]);

  const continueWorkVersion = useCallback((parameters, context) => {
    const restored = restoreVersionWorkspace(parameters, parameterEditorRef.current.defaultParams);
    // 从漫画跳回普通创作前保留当前画框草稿，版本参数只进入普通绘画会话。
    if (comicTargetRef.current) {
      comicWorkspaceRef.current.saveTask(comicTargetRef.current, {
        parameterState: parameterEditorRef.current.getSnapshot(), promptsByModel, vibeImages,
      }, { record: false });
      comicTargetRef.current = null;
      setComicSelectedTarget(null);
    }
    setLeftPanelMode('generation');
    setGenerationParams(restored.parameterState.params);
    setPromptsByModel((previous) => ({
      ...previous,
      [restored.parameterState.params.model]: {
        positivePrompt: restored.positivePrompt, negativePrompt: restored.negativePrompt,
      },
    }));
    setVibeImages(restored.vibeImages);
    setExternalImageData(null);
    setCharacterTabsFromNote(null);
    setCharacterTabsForPromptTokens(restored.parameterState.characterTabs);
    setParameterEditorState(restored.parameterState);
    setParameterEditorKey((key) => key + 1);
    setExpandedPanels((previous) => ({ ...previous,
      img2img: Boolean(restored.parameterState.imagePreview),
      vibe: restored.vibeImages.length > 0, reference: restored.parameterState.referenceImages.length > 0,
      character: restored.parameterState.characterTabs.length > 0,
    }));
    if (context !== undefined) changeVersionContext(context);
  }, [changeVersionContext, promptsByModel, vibeImages]);
  const continueWorkVersionRef = useRef(continueWorkVersion);
  continueWorkVersionRef.current = continueWorkVersion;

  useEffect(() => {
    let active = true;
    const loadVersion = async (event) => {
      const context = event.detail;
      window.localStorage.removeItem('novelai:pending-version');
      const selection = ++versionSelectionRef.current;
      setVersionLoading(true);
      try {
        // Web Storage 只交接 ID；图片、遮罩和 Vibe 从本地后端读取，不受 5 MiB 配额限制。
        const result = context.parent_version_id
          ? await apiClient.getWorkVersion(context.work_id, context.parent_version_id)
          : await apiClient.getWork(context.work_id);
        if (!active || selection !== versionSelectionRef.current) return;
        if (result.version) {
          continueWorkVersionRef.current(result.version.parameters, context.apply_only ? undefined : {
            work_id: result.work.id, parent_version_id: result.version.id,
            work_title: result.work.title, number: result.version.number,
          });
        } else {
          changeVersionContext({ work_id: result.work.id, work_title: result.work.title, parent_version_id: null, number: null });
        }
        showNotification(t(context.apply_only ? 'gallery.versionWorkspace.applied' : 'gallery.versionWorkspace.loaded'), 'success');
      } catch (error) {
        if (active && selection === versionSelectionRef.current) showNotification(error.data?.error || error.message, 'error', false);
      } finally { if (active) setVersionLoading(false); }
    };
    window.addEventListener('novelai:continue-version', loadVersion);
    const pending = window.localStorage.getItem('novelai:pending-version');
    if (pending) {
      try { void loadVersion({ detail: JSON.parse(pending) }); }
      catch { window.localStorage.removeItem('novelai:pending-version'); }
    }
    return () => { active = false; window.removeEventListener('novelai:continue-version', loadVersion); };
  }, [changeVersionContext, showNotification, t]);

  // 处理应用图像参数
  const handleApplyImageParameters = useCallback((parsedParams) => {
    if (parsedParams.version_context) {
      continueWorkVersion(parsedParams, parsedParams.version_context);
      showNotification(t('gallery.versionWorkspace.loaded'), 'success');
      return true;
    }
    const applied = applyMetadataToCurrentParams(parsedParams, {
      successMessage: t('painting.workspace.notifications.imageParametersLoaded'),
      warningMessage: t('painting.workspace.errors.partialParameterApply'),
    });
    // 个人图库的空角色列表也代表用户的明确选择，不能残留上一张图的角色。
    if (Object.hasOwn(parsedParams, 'characterTabs')) setCharacterTabsFromNote(parsedParams.characterTabs);
    return applied;
  }, [applyMetadataToCurrentParams, continueWorkVersion, showNotification, t]);

  useEffect(() => {
    const applyInferencePrompt = (event) => {
      setPositivePrompt(event.detail);
      window.localStorage.removeItem('novelai:pending-inference-prompt');
    };
    window.addEventListener('novelai:inference-prompt', applyInferencePrompt);
    const pendingInference = window.localStorage.getItem('novelai:pending-inference-prompt');
    if (pendingInference) applyInferencePrompt({ detail: pendingInference });
    const applyReferenceParameters = (event) => {
      const parameters = event.detail;
      if (!parameters) return;
      handleApplyImageParameters(parameters);
      window.localStorage.removeItem('novelai:pending-reference-parameters');
    };
    const applyArtistPrompt = (event) => {
      const artistPrompt = String(event.detail || '').trim();
      if (!artistPrompt) return;
      setPositivePrompt((current) => current.trim() ? `${current.trim()}, ${artistPrompt}` : artistPrompt);
      window.localStorage.removeItem('novelai:pending-artist-prompt');
      showNotification(t('librarySettings.styleApplied'), 'success');
    };
    window.addEventListener('novelai:reference-parameters', applyReferenceParameters);
    window.addEventListener('novelai:artist-prompt', applyArtistPrompt);

    const pendingParameters = window.localStorage.getItem('novelai:pending-reference-parameters');
    if (pendingParameters) {
      try { applyReferenceParameters({ detail: JSON.parse(pendingParameters) }); } catch { window.localStorage.removeItem('novelai:pending-reference-parameters'); }
    }
    const pendingArtist = window.localStorage.getItem('novelai:pending-artist-prompt');
    if (pendingArtist) applyArtistPrompt({ detail: pendingArtist });

    return () => {
      window.removeEventListener('novelai:reference-parameters', applyReferenceParameters);
      window.removeEventListener('novelai:inference-prompt', applyInferencePrompt);
      window.removeEventListener('novelai:artist-prompt', applyArtistPrompt);
    };
  }, [handleApplyImageParameters, setPositivePrompt, showNotification, t]);

  useEffect(() => {
    const onSaveFailure = () => showNotification(t('librarySettings.saveFailed'), 'warning', false);
    const onWatermarkFailure = () => showNotification(t('painting.workspace.adjustment.autoWatermarkFailed'), 'warning');
    const onVersionFailure = () => showNotification(t('gallery.versionWorkspace.saveFailed'), 'warning', false);
    window.addEventListener('novelai:image-save-failed', onSaveFailure);
    window.addEventListener('novelai:auto-watermark-failed', onWatermarkFailure);
    window.addEventListener('novelai:version-save-failed', onVersionFailure);
    return () => {
      window.removeEventListener('novelai:image-save-failed', onSaveFailure);
      window.removeEventListener('novelai:auto-watermark-failed', onWatermarkFailure);
      window.removeEventListener('novelai:version-save-failed', onVersionFailure);
    };
  }, [showNotification, t]);

  // 源图和参数在打开弹窗时固定，切换历史图或修改侧栏不会悄悄改变本次增强。
  const handleImageTool = async (tool, settings = null) => {
    if (tutorialPromptActive) return;
    if (imageToolBusyRef.current || comicFlightRef.current || comicAIFlightRef.current || isGenerating || batchStatus.active || inpaintPreviewBatch.active) return;
    imageToolBusyRef.current = true;
    setImageToolBusy(true);
    try {
      let source = enhanceSource;
      if (!settings) {
        const sourceUrl = currentItem.isComposited
          ? currentItem.src
          : (currentItem.downloadSrc || currentItem.originalSrc || currentItem.src);
        const blob = currentItem.cachedBlob || await fetchUrlAsBlob(sourceUrl);
        const bitmap = await createImageBitmap(blob);
        const { width, height } = bitmap;
        bitmap.close();
        const image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(createWorkspaceError('INVALID_GENERATED_FILE'));
          reader.readAsDataURL(blob);
        });
        source = {
          width, height, image, src: currentItem.src,
          version: currentItem.version,
          params: getAllParametersRef.current
            ? getAllParametersRef.current()
            : { ...generationParams, positivePrompt, negativePrompt },
        };
        if (tool === 'enhance') {
          setEnhanceSource(source);
          return;
        }
      }

      const model = tool === 'upscale' ? 'nai-diffusion-5-curated' : source.params.model;
      const toolParams = {
        image_tool: tool,
        model,
        source_width: source.width,
        source_height: source.height,
        ...(settings ? {
          upscale_amount: settings.upscale_amount,
          strength: settings.strength,
          noise: settings.noise,
          steps: settings.steps,
        } : {}),
      };
      // 提交时刷新官方 Anlas 估价；最终扣费以 NovelAI 实际执行结果为准。
      const estimate = await apiClient.estimateImageTool(toolParams);
      if (estimate.affordable === false) throw createWorkspaceError('NOVELAI_INSUFFICIENT_ANLAS');
      const params = {
        ...source.params,
        ...toolParams,
        width: estimate.width,
        height: estimate.height,
        batchSize: 1,
        imageToImage: { image: source.image, strength: settings?.strength ?? 0.5, noise: settings?.noise ?? 0 },
        // 工具只使用当前文本和角色提示，避免侧栏参考图增加未预估的费用。
        vibeTransfer: null,
        smea: false,
        dyn: false,
        autoSmea: false,
      };
      // 退出作品后操作旧图片也保持普通生成；当前作品内才沿用源图的分支。
      if (versionContext) {
        params.version_context = source.version?.work_id === versionContext.work_id ? {
          work_id: source.version.work_id, parent_version_id: source.version.version_id,
        } : versionContext;
        const versionSelection = versionSelectionRef.current;
        params.onVersionCreated = (version) => {
          if (versionSelection === versionSelectionRef.current) setVersionContext((current) => current?.work_id === version.work_id ? {
            work_id: version.work_id, parent_version_id: version.version_id,
            work_title: version.work_title, number: version.number,
          } : current);
        };
      }
      for (const key of NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS) delete params[key];
      setEnhanceSource(null);
      const newItem = await generate(params);
      if (!newItem) throw createWorkspaceError('GENERATION_FAILED');
      showNotification(t('painting.workspace.notifications.imageGenerated'), 'success');
    } catch (error) {
      showNotification(getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.generationFailed'), 'error', true, [], {
        error,
        source: `image-tool-${tool}`,
        messageKey: WORKSPACE_ERROR_KEYS[error?.code] || 'painting.workspace.errors.generationFailed',
      });
    } finally {
      imageToolBusyRef.current = false;
      setImageToolBusy(false);
    }
  };

  const getPaintingSnapshot = () => ({
    parameterState: parameterEditorRef.current.getSnapshot(),
    promptsByModel,
    vibeImages,
  });

  const applyPaintingSnapshot = (snapshot) => {
    setGenerationParams(snapshot.parameterState.params);
    setPromptsByModel(snapshot.promptsByModel);
    // 离开的编辑会话不会再接收转换结果，重新打开时允许重试未完成的 Vibe。
    setVibeImages(snapshot.vibeImages.map((vibe) => vibe.status === 'converting'
      ? { ...vibe, status: 'unconverted' } : vibe));
    setExternalImageData(null);
    setCharacterTabsFromNote(null);
    setCharacterTabsForPromptTokens(snapshot.parameterState.characterTabs || []);
    setParameterEditorState(snapshot.parameterState);
    // 每个画框拥有完整的编辑态，重新挂载可同时清除图生图、编辑器和未提交输入。
    setParameterEditorKey((key) => key + 1);
  };

  const changeWorkspaceMode = (mode) => {
    if (mode === leftPanelMode) return;
    if (mode !== 'generation' && tutorialTopic) onExitSuggestionPractice();
    if (leftPanelMode === 'comic') {
      if (comicTargetRef.current) {
        comicWorkspaceRef.current.saveTask(comicTargetRef.current, getPaintingSnapshot(), { record: false });
      }
      comicTargetRef.current = null;
      setComicSelectedTarget(null);
      setComicEditorOpen(false);
      applyPaintingSnapshot(regularPaintingSnapshotRef.current);
    } else if (mode === 'comic') {
      regularPaintingSnapshotRef.current = getPaintingSnapshot();
      setComicWorkspaceVisited(true);
    }
    if (mode === 'imageProcessing') setImageProcessingVisited(true);
    setLeftPanelMode(mode);
  };

  useEffect(() => {
    if (tutorialTopic) changeWorkspaceMode('generation');
  }, [tutorialTopic]);

  useEffect(() => {
    if (desktopEditor) desktopEditor.share(generatedItems, () => comicWorkspaceRef.current?.getCurrentPage());
  }, [desktopEditor, generatedItems]);

  useEffect(() => {
    if (desktopEditor) return undefined;
    const openGalleryImage = () => {
      const pending = sessionStorage.getItem('novelai:pending-image-processing');
      if (!pending) return;
      sessionStorage.removeItem('novelai:pending-image-processing');
      setProcessingGalleryRequest(JSON.parse(pending));
      changeWorkspaceMode('imageProcessing');
    };
    openGalleryImage();
    window.addEventListener('novelai:image-processing', openGalleryImage);
    return () => window.removeEventListener('novelai:image-processing', openGalleryImage);
  });

  const handleComicSelectTask = (target, savedSnapshot, options = {}) => {
    if (leftPanelMode !== 'comic') return;
    const previous = comicTargetRef.current;
    if (target && previous?.pageId === target.pageId && previous?.panelId === target.panelId) {
      if (previous.panelNumber !== target.panelNumber) {
        comicTargetRef.current = target;
        setComicSelectedTarget(target);
      }
      return;
    }
    if (previous && options.savePrevious !== false) {
      // 切换选框只是自动保留参数，不应成为画布中的一次撤销操作。
      comicWorkspaceRef.current.saveTask(previous, getPaintingSnapshot(), { record: false });
    }
    comicTargetRef.current = target;
    setComicSelectedTarget(target);
    if (!target) return;

    const snapshot = savedSnapshot || {
      parameterState: { params: { ...parameterEditorRef.current.defaultParams } },
      promptsByModel: {},
      vibeImages: [],
    };
    applyPaintingSnapshot(snapshot);
  };

  const saveComicTask = () => {
    const snapshot = getPaintingSnapshot();
    if (comicTargetRef.current) comicWorkspaceRef.current.saveTask(comicTargetRef.current, snapshot);
    return snapshot;
  };

  // 图像生成请求
  const handleGenerate = async (allComicPanels = false) => {
    if (tutorialPromptActive) return;
    if (imageToolBusyRef.current || comicFlightRef.current || comicAIFlightRef.current || isGenerating) return;
    let requestedModel = generationParams.model;
    const comicPage = leftPanelMode === 'comic' ? comicWorkspaceRef.current?.getCurrentPage() : null;
    const generateEveryPanel = allComicPanels === true && Boolean(comicPage);
    const availablePanels = generateEveryPanel ? comicPage.panels.filter((panel) => comicPage.layers.some((layer) => layer.id === panel.layerId && layer.visible && !layer.locked)) : [];
    const firstPanel = availablePanels[0];
    const comicTarget = leftPanelMode === 'comic' ? comicTargetRef.current || (firstPanel ? { pageId: comicPage.id, panelId: firstPanel.id, panelNumber: comicPage.panels.indexOf(firstPanel) + 1 } : null) : null;
    if (leftPanelMode === 'comic' && !comicTarget) return;

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
      if (!comicTarget && versionContext) {
        params.version_context = versionContext;
        const versionSelection = versionSelectionRef.current;
        params.onVersionCreated = (version) => {
          if (versionSelection === versionSelectionRef.current) setVersionContext((current) => current?.work_id === version.work_id ? {
            work_id: version.work_id, parent_version_id: version.version_id,
            work_title: version.work_title, number: version.number,
          } : current);
        };
      }

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
        if (params.model === 'nai-diffusion-5-curated') {
          throw createWorkspaceError('NOVELAI_INPAINT_MODEL_NOT_SUPPORTED');
        }

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
        const previewBatchId = createClientId();

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
            if (previewParams.version_context && !previewParams.version_context.parent_version_id && previewItem.version) {
              previewParams.version_context = { ...previewParams.version_context, parent_version_id: previewItem.version.version_id };
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

      if (comicTarget) {
        const currentSnapshot = saveComicTask();
        setComicGenerationBusy(true);
        // 在第一张请求前固定所有画框的参数和目标，切页或切换表单不会改变队列。
        const { getLatestParams: ignoredLatestParams, ...fixedParams } = params;
        const queue = generateEveryPanel ? availablePanels.map((panel) => {
          const snapshot = panel.id === comicTargetRef.current?.panelId ? currentSnapshot : panel.task?.params || currentSnapshot;
          const panelParams = getAllParametersRef.current(snapshot);
          if (!panel.task && panel.id !== comicTargetRef.current?.panelId) Object.assign(panelParams, getPanelResolutionParameters(panelParams, panelBounds(panel)));
          const target = { pageId: comicPage.id, panelId: panel.id, panelNumber: comicPage.panels.indexOf(panel) + 1 };
          return { target, params: panelParams };
        }) : Array.from({ length: Math.min(8, Math.max(1, Number.parseInt(fixedParams.batchSize, 10) || 1)) }, () => ({ target: comicTarget, params: fixedParams }));
        const count = queue.length;
        const batchId = count > 1 ? createClientId() : null;
        comicFlightRef.current = { ...comicTarget, batchId, count, index: 0, cancelled: false };
        let panelReceived = true;
        for (let index = 0; index < count; index += 1) {
          if (comicFlightRef.current.cancelled) break;
          comicFlightRef.current.index = index;
          const entry = queue[index];
          requestedModel = entry.params.model;
          const item = await generate({ ...entry.params, batchSize: 1,
            ...(batchId ? { batch_id: batchId, index, batch_size: count, ...(!generateEveryPanel ? { seed: '' } : {}) } : {}),
          });
          if (!item) throw createWorkspaceError('GENERATION_FAILED');
          // 本地生成接口已经把图像写入磁盘画廊，再将结果送回发起任务的画框。
          const blob = item.cachedBlob || await fetchUrlAsBlob(item.downloadSrc || item.originalSrc || item.src);
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const image = await new Promise((resolve, reject) => {
            const decoded = new window.Image();
            decoded.onload = () => resolve({ dataUrl, width: decoded.naturalWidth, height: decoded.naturalHeight });
            decoded.onerror = reject;
            decoded.src = dataUrl;
          });
          panelReceived = await comicWorkspaceRef.current.receiveGeneratedImage({ ...entry.target, image });
          if (item.saveError) {
            // 磁盘失败时保留已生成的图像和画框内容，停止后续付费请求并明确提示。
            showNotification(t('librarySettings.saveFailed'), 'warning', false);
            return;
          }
          // 沿用本地版连续生成间隔；取消只阻止下一张，不丢弃已返回的结果。
          if (index < count - 1 && !comicFlightRef.current.cancelled) {
            for (let tick = 0; tick < 30 && !comicFlightRef.current.cancelled; tick += 1) await new Promise((resolve) => window.setTimeout(resolve, 500));
          }
        }
        if (comicFlightRef.current.cancelled) {
          showNotification(t('painting.workspace.notifications.batchCancelled'), 'info');
          return;
        }
        showNotification(panelReceived ? comicText.received : comicText.missing, panelReceived ? 'success' : 'warning');
        return;
      }

      // 检查是否需要批量生成
      if (params.batchSize > 1) {
        try {
          // 调用批量生成服务
          const finalBatchStatus = await generateBatchImages(params,
            undefined,
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
          console.error('批量处理过程中发生未捕获错误:', createPaintingErrorRecord(error));
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


      }
    } catch (error) {
      console.error('图像生成过程中发生错误:', createPaintingErrorRecord(error));

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
    } finally {
      if (comicTarget) {
        const flight = comicFlightRef.current;
        if (flight?.batchId && (flight.cancelled || flight.index < flight.count - 1)) {
          await apiClient.cancelImageBatch(flight.batchId).catch(() => {});
        }
        comicFlightRef.current = null;
        setComicGenerationBusy(false);
      }
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
    if (tutorialPromptActive) return false;
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
      case 'use-as-image-processing': {
        const request = { id: createClientId(), generatedItem: currentItem };
        if (desktopEditor) desktopEditor.open(request);
        else {
          setProcessingGalleryRequest(request);
          changeWorkspaceMode('imageProcessing');
        }
        return true;
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
          console.error('发送到局部重绘失败:', createPaintingErrorRecord(error));
          notify(
            getWorkspaceErrorMessage(t, error, 'painting.workspace.errors.sendToInpaintFailed'),
            'error',
            true,
            [],
            { error, messageKey: 'painting.workspace.errors.sendToInpaintFailed' },
          );
          return false;
        }

      case 'use-as-reference': {
        if (!canUseReference || hasActiveVibes) return false;
        const blob = currentItem.cachedBlob || await fetchUrlAsBlob(currentItem.src);
        await handleUseDroppedImage('reference', new File([blob], String(currentItem.id), { type: blob.type }));
        return true;
      }

      case 'use-as-vibe':
        if (!canUseVibe || referenceCounts.active) return false;
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
          otherSettings: false,
          img2img: false,
          vibe: false,
          reference: false,
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
  const hasCurrentItemSeed = currentItemMetadata?.seed !== undefined
    && currentItemMetadata?.seed !== null
    && currentItemMetadata?.seed !== '';


  useEffect(() => {
    if (!(isGenerating || imageToolBusy || comicGenerationBusy || comicAIBusy || batchStatus.active || inpaintPreviewBatch.active)) return;
    const block = (event) => event.preventDefault();
    window.addEventListener('desktop-before-update', block);
    return () => window.removeEventListener('desktop-before-update', block);
  }, [isGenerating, imageToolBusy, comicGenerationBusy, comicAIBusy, batchStatus.active, inpaintPreviewBatch.active]);

  const { subscription, anlas } = liveAccountSnapshot || {};
  const tier = subscription?.tier;
  const unavailableAnlas = t('painting.workspace.anlas.unavailable');
  const tierName = [t('main.local.notSubscribed'), 'Tablet', 'Scroll', 'Opus'][tier]
    || (tier == null ? unavailableAnlas : t('main.local.tierValue', { tier }));
  const subscriptionLabel = subscription?.active === false && tier > 0
    ? `${tierName} · ${t('main.local.notSubscribed')}` : tierName;
  const displayAnlas = (value) => value == null ? unavailableAnlas : formatNumber(value);
  const displayTotal = displayAnlas(anlas?.total);

  const renderAnlasStatus = (compact = false, iconOnly = false) => {
    return (
      <Tooltip title={t('painting.workspace.anlas.openDetails')} arrow>
        <Button
          size="small"
          onClick={() => setAnlasDialogOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${t('main.local.subscription')}: ${subscriptionLabel}; ${t('painting.workspace.anlas.balance')}: ${displayTotal}`}
          sx={{
            minWidth: iconOnly ? 40 : 0,
            minHeight: compact ? 44 : 36,
            px: compact ? 0.5 : 0.75,
            py: 0.5,
            gap: compact ? 0.5 : 0.65,
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
          {iconOnly ? <Box component="span" sx={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.primary.main, .12) }}>
            <AnlasIcon sx={{ fontSize: 17, color: 'primary.main' }} />
          </Box> : <>
            <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: subscription?.active ? 'primary.main' : 'text.secondary' }}>
              {subscriptionLabel}
            </Typography>
            {!compact && <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}>
              {t('painting.workspace.anlas.balance')}
            </Typography>}
            <Typography component="span" variant="body2"
              sx={{ fontWeight: 700, fontSize: compact ? 12 : undefined, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {displayTotal}
            </Typography>
            <AnlasIcon sx={{ fontSize: compact ? 16 : 18, flexShrink: 0, color: 'primary.main' }} />
          </>}
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
            {formatNumber(buttonState.costTotal ?? buttonState.cost)}
          </Typography>
          <AnlasIcon sx={{ flexShrink: 0, fontSize: compact ? 13 : 14, color: '#FFE082' }} />
        </Box>
      </Tooltip>
    );
  };

  const handleEditorParamChange = useCallback((param, value) => {
    // 参考图控件会延迟通知父层，切框后丢弃上一编辑面板尚未送达的更新。
    if (parameterEditorRef.current?.key !== parameterEditorKey) return;
    handleParamChange(param, value);
  }, [handleParamChange, parameterEditorKey]);

  const handleEditorVibeImagesChange = useCallback((nextImages) => {
    // 文件读取和 Vibe 编码都可能晚于切框完成，不能再写入新画框或普通绘图。
    if (parameterEditorRef.current?.key !== parameterEditorKey) return;
    setVibeImages(nextImages);
  }, [parameterEditorKey]);

  const previewCanDrag = Boolean(active && leftPanelMode === 'generation' && currentItem && currentItem.type !== 'video'
    && !adjustmentActive);
  const previewDrag = usePreviewImageDrag({
    enabled: previewCanDrag && previewSettings.displayImageDrag, getFile: getPreviewFile, privacyMode: previewSettings.privacyMode,
    onError: (error) => {
      const key = ['invalidCustomMetadata', 'imageTooLarge'].includes(error.message) ? error.message : 'copyExportFailed';
      showNotification(t(`painting.workspace.gallery.${key}`), 'error');
    },
  });

  const parameterEditor = (
    <>
      {/* 参数面板 - 传递expandedPanels和onExpandedPanelsChange */}
      <Box sx={{ flexShrink: 0, minWidth: 0, pb: 1 }}>
        <ParameterPanel
          loadAccountSettings={!tutorialPromptActive}
          parameterToolbarContainer={leftPanelMode === 'comic' ? comicToolbarContainer : (isMobile ? drawerToolbarContainer : parameterToolbarContainer)}
          renderPromptPanel={(characterControlSummary, characterControlContent, modelOptions, changeParameter) => (
            <PromptPanel
              releaseGuideActive={releaseGuideActive}
              suggestionPractice={suggestionPractice}
              promptExerciseTopic={promptExerciseTopic}
              promptExerciseActive={promptExerciseActive}
              onExitSuggestionPractice={onExitSuggestionPractice}
              loadAccountSettings={!tutorialPromptActive}
                  positivePrompt={positivePrompt}
              negativePrompt={negativePrompt}
              model={generationParams.model}
              characterTabs={characterTabsForPromptTokens}
              onPositivePromptChange={setPositivePrompt}
              onNegativePromptChange={setNegativePrompt}
              onSaveCurrentNote={handleSaveCurrentNote}
              modelOptions={modelOptions}
              onApplyNoteContent={(note, applyModel) => handleApplyMetadataFromNote(note, applyModel, modelOptions, changeParameter)}
              onError={reportWorkspaceFailure}
              characterControlSummary={characterControlSummary}
              characterControlContent={characterControlContent}
            />
          )}
          key={parameterEditorKey}
          editorSessionKey={parameterEditorKey}
          editorState={parameterEditorRef.current?.key === parameterEditorKey
            ? parameterEditorRef.current.getSnapshot() : parameterEditorState}
          editorStateRef={parameterEditorRef}
          isolated={leftPanelMode === 'comic'}
          comicPanelBounds={leftPanelMode === 'comic' ? comicPanelBounds : null}
          params={preferredGenerationParams}
          onReferenceCountsChange={setReferenceCounts}
          isInpaintMode={leftPanelMode === 'inpaint'}
          onParamChange={handleEditorParamChange}
          getAllParametersRef={getAllParametersRef}
          externalCharacterTabs={characterTabsFromNote} // 传递给 ParameterPanel
          expandedPanels={expandedPanels}
          onExpandedPanelsChange={isMobile ? handleMobileExpandPanel : handleExpandedPanelsChange}
          fileInputRef={fileInputRef}
          vibeFileInputRef={vibeFileInputRef}
          vibeImages={vibeImages}
          setVibeImages={handleEditorVibeImagesChange}
          externalImageData={externalImageData}
          imageImportRequest={imageImportRequest}
          onImageImportHandled={() => setImageImportRequest(null)}
          onImageToImageCostParametersChange={setImageToImageCostParameters}
          onCharacterTabsChange={setCharacterTabsForPromptTokens}
          onApplyMetadata={handleApplyMetadata}
          positivePrompt={positivePrompt}
          negativePrompt={negativePrompt}
          onError={reportWorkspaceFailure}
        />
      </Box>
    </>
  );


  const comicCharacterPlacement = leftPanelMode === 'comic' && isNovelAIV5Model(generationParams.model)
    && generationParams.characterPositionMode === 'custom' ? {
      width: Number(generationParams.width),
      height: Number(generationParams.height),
      characters: characterTabsForPromptTokens,
      onMove: (index, center) => parameterEditorRef.current?.setCharacterCenter(index, center),
    } : null;

  const comicGenerationAction = { ...getGenerateButtonState(), loading: comicGenerationBusy || comicAIBusy || isGenerating };
  const closeComicEditor = () => {
    saveComicTask();
    setComicEditorOpen(false);
  };

  useEffect(() => {
    if (!compactAndroid || !active || !mobileDrawerOpen) return;
    const back = (event) => {
      if (event.defaultPrevented || event.detail) return;
      event.preventDefault();
      setMobileDrawerOpen(false);
    };
    window.addEventListener('mobile-back', back);
    return () => window.removeEventListener('mobile-back', back);
  }, [active, compactAndroid, mobileDrawerOpen]);

  return (
    <>
      {/* 参数编辑态持续挂载，保证直接打开图像处理后仍能切换漫画并恢复普通绘图参数。 */}
      {leftPanelMode === 'imageProcessing' && <Box sx={{ display: 'none' }}>{parameterEditor}</Box>}
      <Box
        ref={workspaceRef}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          overflowX: 'hidden',
          position: 'relative',
          pb: isMobile && !isCanvasWorkspace && !compactAndroid ? { xs: '116px', sm: '60px' } : 0,
          overflowY: androidLayout ? 'hidden' : undefined,
          backgroundColor: theme.palette.background.default,
          userSelect: resizingParameters ? 'none' : undefined,
          cursor: resizingParameters ? 'col-resize' : undefined,
        }}
        onDragOverCapture={(event) => {
          if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
            event.preventDefault();
          }
        }}
        onDropCapture={handlePageDrop}
      >
        {/* 保留分镜参数状态，但关闭后整层退出布局，防止内部过渡控件拦住侧栏触摸。 */}
        {compactAndroid && leftPanelMode === 'comic' && <Dialog
          open={active && comicEditorOpen} keepMounted fullScreen onClose={closeComicEditor}
          sx={{ '&.MuiModal-hidden': { display: 'none' } }}
          aria-labelledby="mobile-comic-editor-title">
          <DialogTitle id="mobile-comic-editor-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {comicText.edit} {comicSelectedTarget && `#${comicSelectedTarget.panelNumber}`}
            <IconButton aria-label={comicText.close} onClick={closeComicEditor}><CloseIcon /></IconButton>
          </DialogTitle>
          <DialogContent dividers>{parameterEditor}</DialogContent>
          <DialogActions sx={{ gap: 1 }}>
            <Button aria-label={comicText.save} onClick={() => { closeComicEditor(); showNotification(comicText.saved); }}><CheckIcon /></Button>
            <Button aria-label={comicGenerationAction.text} variant="contained" disabled={comicGenerationAction.disabled}
              onClick={comicGenerationAction.action} startIcon={<PlayArrowIcon />}>
              {comicGenerationAction.costLabel || comicGenerationAction.text}
            </Button>
          </DialogActions>
        </Dialog>}
        {/* 通知提示框 */}
        <Snackbar
          open={notification.open}
          autoHideDuration={notification.autoHide ? 4000 : null}
          onClose={handleCloseNotification}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          sx={{ zIndex: 9999 }} // 确保最高层级
        >
          <Alert
            severity={notification.severity}
            variant="filled"
            icon={false}
            sx={{ width: '100%', py: 0.5, px: 1.5, boxShadow: 3,
              '& .MuiAlert-message': { width: '100%', py: 0.5, overflowWrap: 'anywhere' } }}
          >
            <IconButton
              aria-label={t('painting.workspace.actions.close')}
              size="small" color="inherit" onClick={handleCloseNotification}
              sx={{ float: 'right', ml: 0.5 }}
            ><CloseIcon fontSize="small" /></IconButton>
            <Typography variant="body2" component="div">
              {notification.message}
              {notification.errorRecord && (
                <Box component="button" type="button" onClick={() => {
                  setErrorSummaryOpen(true);
                  handleCloseNotification();
                }} sx={{ ml: 0.75, p: 0, border: 0, bgcolor: 'transparent', color: 'inherit',
                  font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>
                  {t('painting.workspace.actions.shortDetails')}
                </Box>
              )}
              {notification.actions?.map((action, index) => (
                <Button key={index} size="small" color="inherit" sx={{ minWidth: 0, px: 0.75, py: 0 }}
                  onClick={() => { action.action?.(); handleCloseNotification(); }}>
                  {action.text}
                </Button>
              ))}
            </Typography>
            {notification.errorRecord && (
              <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.92 }}>
                {t('painting.workspace.errorRecords.code')}: {notification.errorRecord.code}
                {notification.errorRecord.errorId
                  ? ` · ${t('painting.workspace.errorRecords.errorId')}: ${notification.errorRecord.errorId}`
                  : ''}
              </Typography>
            )}
          </Alert>
        </Snackbar>

        {/* 左侧区域 - 图像显示 */}
        <Box
          sx={{
            flex: compactAndroid || !isMobile || isCanvasWorkspace ? '1 1 0' : 'none',
            minWidth: 0,
            width: isMobile ? '100%' : 'auto',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            minHeight: compactAndroid || isCanvasWorkspace ? 0 : isMobile ? '80vh' : 'auto',
            maxHeight: '100%',
            p: isMobile ? 0.5 : '1px',
            overflow: 'hidden',
          }}
        >
          {renderModeTools ? renderModeTools(leftPanelMode, changeWorkspaceMode) : (
          <Box
            sx={{
              flex: '0 0 auto',
              width: isMobile ? '100%' : 56,
              mr: isMobile ? 0 : '3px',
              mb: isMobile ? 1 : 0,
              pt: isMobile ? 0 : 0.5,
              display: 'flex',
              flexDirection: isMobile ? 'row' : 'column',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
              gap: isMobile ? 0 : 0.5,
            }}
          >
            <Button
              variant="text"
              color="primary"
              aria-label={t('painting.workspace.tabs.generation')}
              aria-pressed={leftPanelMode === 'generation'}
              onClick={() => changeWorkspaceMode('generation')}
              sx={{
                minWidth: 0,
                flex: isMobile ? 1 : undefined,
                flexDirection: isMobile ? 'row' : 'column',
                gap: isMobile ? 0.75 : 0.25,
                py: 0.5,
                px: isMobile ? 1.25 : 0.5,
                minHeight: isMobile ? 36 : 48,
                fontSize: isMobile ? '0.8125rem' : '0.75rem',
                lineHeight: 1.4,
                borderRadius: 1.5,
                color: leftPanelMode === 'generation' ? 'primary.main' : 'text.secondary',
                bgcolor: leftPanelMode === 'generation' ? 'action.selected' : 'transparent',
              }}
            >
              <ImageIcon sx={{ fontSize: 18 }} />
              {t('painting.workspace.tabs.generation')}
            </Button>
            {(
              <Button
                variant="text"
                color="primary"
                aria-label={t('painting.workspace.tabs.inpaint')}
                aria-pressed={leftPanelMode === 'inpaint'}
                onClick={() => changeWorkspaceMode('inpaint')}
                sx={{
                  minWidth: 0,
                  flex: isMobile ? 1 : undefined,
                  flexDirection: isMobile ? 'row' : 'column',
                  gap: isMobile ? 0.75 : 0.25,
                  py: 0.5,
                  px: isMobile ? 1.25 : 0.5,
                  minHeight: isMobile ? 36 : 48,
                  fontSize: isMobile ? '0.8125rem' : '0.75rem',
                  lineHeight: 1.4,
                  borderRadius: 1.5,
                  color: leftPanelMode === 'inpaint' ? 'primary.main' : 'text.secondary',
                  bgcolor: leftPanelMode === 'inpaint' ? 'action.selected' : 'transparent',
                }}
              >
                <BrushIcon sx={{ fontSize: 18 }} />
                {t('painting.workspace.tabs.inpaint')}
              </Button>
            )}
            <Button
              variant="text"
              aria-label={comicText.title}
              aria-pressed={leftPanelMode === 'comic'}
              onClick={() => changeWorkspaceMode('comic')}
              sx={{
                minWidth: 0, flex: isMobile ? 1 : undefined,
                flexDirection: isMobile ? 'row' : 'column', gap: isMobile ? 0.75 : 0.25,
                px: isMobile ? 1.25 : 0.5, py: 0.5, minHeight: isMobile ? 36 : 48,
                fontSize: isMobile ? '0.8125rem' : '0.75rem', lineHeight: 1.4, borderRadius: 1.5,
                color: leftPanelMode === 'comic' ? 'primary.main' : 'text.secondary',
                bgcolor: leftPanelMode === 'comic' ? 'action.selected' : 'transparent',
              }}
            >
              <ComicIcon sx={{ fontSize: 18 }} />
              {comicText.title}
            </Button>
            <Button
              variant="text"
              aria-label={t('painting.workspace.tabs.imageProcessing')}
              aria-pressed={leftPanelMode === 'imageProcessing'}
              onClick={() => changeWorkspaceMode('imageProcessing')}
              sx={{
                minWidth: 0, flex: isMobile ? 1 : undefined,
                flexDirection: isMobile ? 'row' : 'column', gap: isMobile ? 0.5 : 0.25,
                px: 0.5, py: 0.5, minHeight: isMobile ? 36 : 48,
                fontSize: '0.75rem', lineHeight: 1.4, borderRadius: 1.5,
                color: leftPanelMode === 'imageProcessing' ? 'primary.main' : 'text.secondary',
                bgcolor: leftPanelMode === 'imageProcessing' ? 'action.selected' : 'transparent',
              }}
            >
              <ImageProcessingIcon sx={{ fontSize: 18 }} />
              {t('painting.workspace.tabs.imageProcessing')}
            </Button>
          </Box>
          )}

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
            {onBack && <Tooltip title={backLabel}><IconButton size="small" aria-label={backLabel} onClick={onBack} sx={{ alignSelf: 'flex-start' }}><ArrowBackIcon fontSize="small" /></IconButton></Tooltip>}
            {!isCanvasWorkspace && <WorkVersionBar
              context={versionContext}
              onChange={changeVersionContext}
              disabled={tutorialPromptActive || versionLoading || isGenerating || batchStatus.active || imageToolBusy || inpaintPreviewBatch.active}
              getParameters={() => {
                const parameters = getAllParametersRef.current();
                const request = buildGenerationRequest({ ...parameters, positivePrompt, negativePrompt });
                // 手动提交保留未展开的随机提示语法和空种子，不执行生成或采样。
                request.seed = parameters.seed;
                request.characterTabs = parameterEditorRef.current.getSnapshot().characterTabs;
                request.editor_state = parameters.version_editor;
                return request;
              }}
              onApply={(version) => continueWorkVersion(version.parameters)}
              onContinue={(version, work) => continueWorkVersion(version.parameters, {
                work_id: work.id, parent_version_id: version.id, work_title: work.title, number: version.number,
              })}
            />}
            {imageProcessingVisited && (
              <Box sx={{ display: leftPanelMode === 'imageProcessing' ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
                <ImageProcessingWorkspace
                  active={active && leftPanelMode === 'imageProcessing'}
                  generatedItems={generatedItems}
                  galleryRequest={processingGalleryRequest}
                  onGalleryRequestHandled={() => setProcessingGalleryRequest(null)}
                  getCurrentComicPage={() => comicWorkspaceRef.current?.getCurrentPage()}
                />
              </Box>
            )}
            {comicWorkspaceVisited && (
              <Box sx={{ display: leftPanelMode === 'comic' ? 'block' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
                <ComicWorkspace characterPlacement={comicCharacterPlacement}
                  ref={comicWorkspaceRef}
                  active={active && leftPanelMode === 'comic'}
                  generatedItems={generatedItems}
                  onSelectTask={handleComicSelectTask}
                  androidLayout={androidLayout}
                  manualEditor={!compactAndroid && leftPanelMode === 'comic' ? parameterEditor : null}
                  onEditTask={() => setComicEditorOpen(true)}
                  onPanelBoundsChange={setComicPanelBounds}
                  onParameterToolbarChange={setComicToolbarContainer}
                  directorImageModels={MODEL_OPTIONS.filter(({ value }) => isNovelAIV5Model(value))}
                  generatingSequence={comicGenerationBusy && Boolean(comicFlightRef.current?.count > 1)}
                  onStopSequence={() => { if (comicFlightRef.current) comicFlightRef.current.cancelled = true; }}
                  onGenerateAll={() => handleGenerate(true)}
                  onSaveTask={getPaintingSnapshot}
                  onGenerate={comicGenerationAction.action}
                  generationAction={comicGenerationAction}
                  onDirectorBusyChange={(value) => { comicAIFlightRef.current = value; setComicAIBusy(value); }}
                  isGenerating={comicGenerationBusy || isGenerating}
                />
              </Box>
            )}
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
                  mb: isMobile ? 0.5 : '1px',
                  p: isMobile ? 0.5 : '1px',
                  overflow: 'hidden',
                  borderRadius: isMobile ? 2 : '8px 0 0 8px',
                  backgroundColor: themeColors.ItemDisplayBg,
                  minHeight: compactAndroid ? 0 : isMobile ? '50vh' : '300px',
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <ItemDisplay
                  androidLayout={androidLayout}
                  item={currentItem}
                  active={active && leftPanelMode === 'generation'}
                  onActionButtonClick={handleActionButtonClick}
                  onNextItem={handleSelectNext}
                  onPreviousItem={handleSelectPrevious}
                  onDeleteItem={() => currentItem && handleDeletePreview(currentItem.id)}
                  generatedItemsCount={generatedItems.length}
                  onApplyImageParameters={handleApplyImageParameters}
                  onError={reportWorkspaceFailure}
                  hideVibeAction={!canUseVibe}
                  disableVibeAction={referenceCounts.active > 0}
                  showReferenceAction={canUseReference}
                  disableReferenceAction={hasActiveVibes}
                  previewSettings={previewSettings} privacyMode={previewSettings.privacyMode && previewSettings.privacyScope !== 'history'}
                  imageDrag={previewCanDrag ? { ...previewDrag, mode: previewSettings.copyMode } : null}
                  selectedByGeneration={selectedByGeneration}
                  onAdjustImage={toggleAdjustment}
                  onUploadAdjustmentImage={(file) => setAdjustmentSource({ id: crypto.randomUUID(), cachedBlob: file })}
                  adjustmentActive={adjustmentActive}
                  adjustmentPreview={adjustmentActive && adjustmentSource ? <QuickImageAdjustment key={adjustmentSource.id}
                    item={adjustmentSource} panel={adjustmentPanel} privacyMode={displayPrivacy}
                    privacyReveal={previewSettings.privacyReveal} previewSettings={previewSettings}
                    presets={quickImagePresets} onPresetsChange={setQuickImagePresets}
                    onClose={() => setAdjustmentSource(undefined)} onApply={(blob, width, height) => {
                      const src = createObjectUrlFromBlob(blob);
                      appendGeneratedItem({
                        type: 'image', src, originalSrc: src, downloadSrc: src, cachedBlob: blob, width, height,
                        objectUrlToRevoke: src, seed: adjustmentSource.seed, prompt: adjustmentSource.prompt,
                        model: adjustmentSource.model, galleryParameters: adjustmentSource.galleryParameters, isComposited: true,
                      });
                      setAdjustmentSource(undefined);
                    }} /> : null}
                  onImageTool={handleImageTool}
                  imageToolsDisabled={tutorialPromptActive || imageToolBusy || batchStatus.active || inpaintPreviewBatch.active}
                />
              </Paper>

              {/* 图像预览区 */}
              <Paper
                elevation={0}
                sx={{
                  flex: '0 0 auto',
                  p: isMobile ? 0.5 : '1px',
                  borderRadius: isMobile ? 2 : '8px 0 0 8px',
                  backgroundColor: themeColors.ItemPreviewBg,
                  overflow: 'hidden',
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                }}
              >
                <ItemPreview
                  items={generatedItems}
                  currentItemId={currentItem?.id}
                  onSelectItem={handleSelectPreview}
                  onImportImages={importHistoryImages}
                  onAdjustImage={toggleAdjustment}
                  adjustmentActive={adjustmentActive}
                  onDeleteItem={handleDeletePreview}
                  previewSettings={previewSettings}
                  quickImagePresets={quickImagePresets}
                  getPreviewFile={getPreviewFile}
                  getItemPreviewFile={getItemPreviewFile}
                  onPreviewSettingsChange={(patch) => setPreviewSettings((saved) => ({ ...(saved ?? defaultImagePreviewSettings), ...patch }))}
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
                  p: isMobile ? 0.5 : '1px',
                  borderRadius: isMobile ? 2 : '8px 0 0 8px',
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
                  onExportToHistory={handleExportInpaintToHistory}
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
        {!isMobile && !isCanvasWorkspace && (
          <>
          <Tooltip title={t('painting.workspace.actions.resizeParameters')} placement="left" arrow>
            <Box
              role="separator"
              tabIndex={0}
              aria-label={t('painting.workspace.actions.resizeParameters')}
              aria-orientation="vertical"
              aria-controls="painting-parameters"
              aria-valuemin={320}
              aria-valuemax={maxParameterPanelWidth}
              aria-valuenow={Math.round(visibleParameterPanelWidth)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                parameterResizeRef.current = { x: event.clientX, width: visibleParameterPanelWidth };
                setResizingParameters(true);
              }}
              onPointerMove={(event) => {
                if (!parameterResizeRef.current) return;
                const { x, width } = parameterResizeRef.current;
                setParameterPanelWidth(Math.max(320, Math.min(maxParameterPanelWidth, width + x - event.clientX)));
              }}
              onLostPointerCapture={() => {
                parameterResizeRef.current = null;
                setResizingParameters(false);
              }}
              onDoubleClick={() => setParameterPanelWidth(null)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const width = event.key === 'Home' ? 320 : event.key === 'End' ? maxParameterPanelWidth
                  : visibleParameterPanelWidth + (event.key === 'ArrowLeft' ? 16 : -16);
                setParameterPanelWidth(Math.max(320, Math.min(maxParameterPanelWidth, width)));
              }}
              sx={{
                flex: '0 0 6px', position: 'relative', cursor: 'col-resize', touchAction: 'none',
                outline: 'none', zIndex: 1,
                '&::before': {
                  content: '""', position: 'absolute', inset: '0 -2px',
                },
                '&::after': {
                  content: '""', position: 'absolute', width: 2, height: 40,
                  top: '50%', left: 2, transform: 'translateY(-50%)', borderRadius: 1,
                  bgcolor: resizingParameters ? 'primary.main' : 'divider',
                },
                '&:hover, &:focus-visible': { bgcolor: 'action.hover', '&::after': { bgcolor: 'primary.main' } },
              }}
            />
          </Tooltip>
          <Box
            id="painting-parameters"
            style={{ width: visibleParameterPanelWidth }}
            sx={{
              flex: '0 0 auto',
              minWidth: 0,
              px: '7px',
              pt: 0.5,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: '0 8px 8px 0',
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
                overflowX: 'hidden',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 2.5,
                height: '100%',
                pr: 0.75,
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
              {adjustmentActive && <Box ref={setAdjustmentPanel} />}
              <Box sx={{ display: adjustmentActive ? 'none' : 'contents' }}>{parameterEditor}</Box>
            </Box>

            {/* 桌面模式下的生成按钮和验证组件区域 */}
            <Box
              sx={{
                py: 1,
                flexShrink: 0,
                bgcolor: theme.palette.background.paper,
                borderTop: 1,
                borderColor: 'divider',
                mt: 'auto',
                overflow: 'hidden',
              }}
            >
              <Box ref={setParameterToolbarContainer} />
              <Box sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 1, minWidth: 0 }}>
                {/* 紧凑账号状态与生成按钮始终保持同一行。 */}
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  {renderAnlasStatus(true)}
                  {batchStatus.active && (
                    <Tooltip title={t('painting.workspace.actions.viewBatchDetails')} placement="top">
                      <IconButton
                        aria-label={t('painting.workspace.actions.viewBatchDetails')}
                        disabled={tutorialPromptActive} onClick={() => setBatchDialogOpen(true)}
                        size="small"
                        color="error"
                        sx={{ ml: 0.5, flexShrink: 0 }}
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
                      sx={{ ml: 0.5, flexShrink: 0 }}
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
                </Box>

                {/* 生成按钮使用剩余宽度，文字按可用空间缩短，保留预计消耗。 */}
                <Box sx={{ flex: '1 1 0', minWidth: 0, maxWidth: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                  <Box ref={setDesktopGenerateButtonContainer} sx={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
                    {/* 主操作保持稳定尺寸，窄宽度时继续沿用现有文字与点数显示规则。 */}
                    {(() => {
                      const buttonState = getGenerateButtonState();
                      const buttonContent = getResponsiveGenerateButtonContent({
                        availableWidth: desktopGenerateButtonWidth,
                        buttonState,
                        isMobile: false,
                        formatNumber,
                      });
                      const isError = buttonState.color === 'error';
                      const mainColor = isError ? theme.palette.error.main : theme.palette.primary.main;
                      const contrastText = isError ? theme.palette.error.contrastText : theme.palette.primary.contrastText;
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
                            height: 44,
                            minWidth: 0,
                            width: '100%',
                            maxWidth: '100%',
                            m: 0,
                            borderRadius: '8px',
                            border: 'none',
                            boxShadow: 'none',
                            background: mainColor,
                            color: contrastText,
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
                                  fontWeight: 600,
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
                  {isMobile && leftPanelMode !== 'comic' && (
                    <IconButton
                      data-release-target="panel" aria-label={t('painting.workspace.actions.openParameters')}
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
            </Box>
          </Box>
          </>
        )}

        {/* 移动端控制面板抽屉 */}
        {isMobile && !isCanvasWorkspace && (
          <SwipeableDrawer
            anchor="bottom"
            open={active && mobileDrawerOpen && !adjustmentActive}
            onClose={closeParameterDrawer}
            onOpen={() => setMobileDrawerOpen(true)}
            disableSwipeToOpen={false}
            ModalProps={{
              keepMounted: true,
            }}
            sx={{
              '& .MuiDrawer-paper': {
                height: compactAndroid ? '100%' : '100dvh',
                ...(compactAndroid ? { pt: 'var(--mobile-top)', pb: 'var(--mobile-bottom)', pl: 'var(--mobile-left)', pr: 'var(--mobile-right)', boxSizing: 'border-box' } : {}),
                overflow: 'hidden',
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: themeColors.drawerBg,
              },
              zIndex: 1300,
            }}
          >
            {/* 抽屉标题栏 */}
            <Box
              data-mobile-parameter-header
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
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
                onClick={closeParameterDrawer}
                edge="end"
              >
                <CloseIcon />
              </IconButton>
            </Box>

            {/* 抽屉内容区域 */}
            <Box
              data-mobile-parameter-body
              // 内容中的滑动和长按交给浏览器，只允许从标题栏开始拖动折叠抽屉。
              onTouchStart={(event) => event.stopPropagation()}
              sx={{
                p: 2,
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                overscrollBehaviorY: 'contain',
                backgroundColor: theme.palette.background.paper,
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
              {parameterEditor}

              {/* 移动端抽屉与桌面、底栏复用同一个紧凑余额状态块。 */}
              <Paper
                elevation={0}
                sx={{
                  py: 1,
                  mb: 2,
                  borderTop: 1,
                  borderColor: 'divider',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                {renderAnlasStatus()}
              </Paper>
            </Box>
            <Box data-mobile-parameter-footer ref={setDrawerToolbarContainer} sx={{ px: 2, pt: 1, flexShrink: 0, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }} />
          </SwipeableDrawer>
        )}
        {isMobile && adjustmentActive && adjustmentSource && <Box ref={setAdjustmentPanel} sx={{
          height: '41dvh', overflowY: 'auto', flexShrink: 0, px: 0.5,
          bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
        }} />}


        {/* 移动端下的固定生成按钮 */}
        {isMobile && !isCanvasWorkspace && (
          <Box data-mobile-generation-footer
            sx={{
              position: compactAndroid ? 'relative' : 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              py: compactAndroid ? 1 : 1.5,
              px: compactAndroid ? 1 : 2,
              flexShrink: 0,
              backgroundColor: themeColors.mobileBottomBg,
              borderTop: `1px solid ${themeColors.mobileBottomBorder}`,
              zIndex: 1200,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              alignItems: 'stretch',
            }}
          >
            <Box data-testid="mobile-generation-toolbar" sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: compactAndroid ? 0 : 1, minWidth: 0 }}>
              {renderAnlasStatus(true, true)}
              <MobileGenerationTools inputId="painting-image-import" disabled={tutorialPromptActive}
                errorCount={workspaceErrors.length} batchStatus={batchStatus}
                onImportFile={openImageImport} onBatch={() => setBatchDialogOpen(true)} onErrors={() => setErrorSummaryOpen(true)} />
            {/* 生成按钮 - 使用动态状态 */}
            {(() => {
              const buttonState = getGenerateButtonState();
              const buttonContent = getResponsiveGenerateButtonContent({
                availableWidth: mobileGenerateButtonWidth,
                buttonState,
                isMobile: true,
                formatNumber,
              });
              const currentIcon = buttonState.icon || <ImageIcon />;
              
              const isError = buttonState.color === 'error';
              const mainColor = isError ? theme.palette.error.main : theme.palette.primary.main;
              const contrastText = isError ? theme.palette.error.contrastText : theme.palette.primary.contrastText;
              const darkColor = isError ? theme.palette.error.dark : theme.palette.primary.dark;

              return (
                <Box sx={{ display: 'flex', flex: '1 1 0', minWidth: 0, ml: compactAndroid ? .75 : 0, alignItems: 'center', maxWidth: '100%' }}>
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
                      color: contrastText,
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
                            fontWeight: 600,
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
                    data-release-target="panel" aria-label={t('painting.workspace.actions.openParameters')}
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

        {enhanceSource && (
          <ImageEnhanceDialog
            open
            onClose={() => setEnhanceSource(null)}
            onSubmit={(settings) => handleImageTool('enhance', settings)}
            source={enhanceSource}
            model={enhanceSource.params.model}
            initialSteps={enhanceSource.params.steps}
            disabled={imageToolBusy || isGenerating || batchStatus.active}
          />
        )}

        {/* 错误汇总对话框 */}
        <ErrorSummaryDialog
          open={errorSummaryOpen}
          onClose={() => setErrorSummaryOpen(false)}
          errors={workspaceErrors}
          onClear={clearWorkspaceErrors}
        />
      </Box>
      <Dialog open={active && anlasDialogOpen} onClose={() => setAnlasDialogOpen(false)} maxWidth="xs" fullWidth
        aria-labelledby="anlas-details-title">
        <DialogTitle id="anlas-details-title">{t('painting.workspace.anlas.title')}</DialogTitle>
        <DialogContent>
          {liveAccountSnapshot?.stale === true && (
            <Alert severity="warning" sx={{ mb: 2 }}>{t('painting.workspace.anlas.stale')}</Alert>
          )}
          <Stack spacing={1.25}>
            {[
              [t('main.local.subscription'), subscriptionLabel],
              [t('painting.workspace.anlas.total'), displayTotal],
              [t('painting.workspace.anlas.fixed'), displayAnlas(anlas?.fixed)],
              [t('painting.workspace.anlas.purchased'), displayAnlas(anlas?.purchased)],
              [t('painting.workspace.anlas.updatedAt'), liveAccountSnapshot?.refreshed_at
                ? formatDate(liveAccountSnapshot.refreshed_at, { dateStyle: 'medium', timeStyle: 'short' })
                : ''],
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
        params={generationParams}
        open={pageMetadataDialog.open}
        onClose={closePageImageImport}
        metadata={pageMetadataDialog.metadata}
        imageFile={pageMetadataDialog.file}
        reading={pageMetadataDialog.reading}
        imageActions={[
          ...(generationParams.model.startsWith('nai-diffusion') ? ['img2img', 'inpaint'] : []),
          ...(!referenceCounts.active && canUseVibe ? ['vibe'] : []),
          ...(!hasActiveVibes && canUseReference ? ['reference'] : []),
          'editor',
        ]}
        onUseImage={handleUseDroppedImage}
        onApply={handleApplyPageMetadata}
      />
    </>
  );
};

// 包装了Context Provider的根组件
const AIPaintingPage = ({ userId, accountSnapshot = null, releaseGuideActive = false, suggestionPractice = false, promptExerciseTopic, promptExerciseActive = false, onExitSuggestionPractice, onBack, backLabel, tutorialTopic, offlinePractice = false, active = true, workContext, onWorkContextChange, renderModeTools, desktopEditor, androidLayout, sharedImage, onSharedImageHandled }) => {
  const [directory, setDirectory] = useState(() => localStorage.getItem('outputDirectory') || '');
  useEffect(() => {
    const changed = event => setDirectory(event.detail?.outputDirectory || '');
    window.addEventListener('imageSettingsUpdate', changed);
    return () => window.removeEventListener('imageSettingsUpdate', changed);
  }, []);
  return (
    <GenerationProvider key={JSON.stringify([userId, directory])} owner={userId} directory={directory}>
      <AIPaintingPageContent releaseGuideActive={releaseGuideActive} suggestionPractice={suggestionPractice} promptExerciseTopic={promptExerciseTopic} promptExerciseActive={promptExerciseActive} onExitSuggestionPractice={onExitSuggestionPractice} onBack={onBack} backLabel={backLabel} tutorialTopic={tutorialTopic} offlinePractice={offlinePractice} userId={userId} accountSnapshot={accountSnapshot} active={active} workContext={workContext} onWorkContextChange={onWorkContextChange} renderModeTools={renderModeTools} desktopEditor={desktopEditor} androidLayout={androidLayout} sharedImage={sharedImage} onSharedImageHandled={onSharedImageHandled} />
    </GenerationProvider>
  );
};

export default AIPaintingPage;
