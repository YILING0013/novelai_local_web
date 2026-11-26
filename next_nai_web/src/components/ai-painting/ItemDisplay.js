// ItemDisplay.js
"use client";
import { getWorkspaceShortcut } from "./tools/ImageTools/workspaceShortcuts.mjs";
import { transparencyBackgroundSx } from "./tools/ImageTools/previewImageExport";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useContext } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Paper,
  Typography,
  Fade,
  Menu,
  MenuItem,
  ListItemText,
  ButtonBase,
  useMediaQuery,
  Button,
  LinearProgress,
  CircularProgress,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  useTheme,
} from '@mui/material';
import {
  SaveAlt as SaveIcon,
  AddPhotoAlternate as AddPhotoIcon,
  PhotoFilter as PhotoFilterIcon,
  CloudUpload as CloudUploadIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RestartAlt as ResetIcon,
  Warning as WarningIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Refresh as RefreshIcon,
  ImageOutlined as ImageOutlinedIcon,
  FolderOpenOutlined,
  AutoAwesome as AutoAwesomeIcon,
  OpenInFull as OpenInFullIcon,
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  Send as SendIcon,
  Tune as TuneIcon, BrushOutlined, CollectionsOutlined, StyleOutlined, PersonOutline,
} from '@mui/icons-material';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import Image from 'next/image';
import ImagePrivacyCover, { imagePrivacySx } from './ImagePrivacyCover';
import { useGeneration } from './Generation/GenerationContext';
import { getImageSettings, generateFileName } from './tools/ImageTools/ImageSaveUtils';
import { downloadBlobToFile, downloadUrlToFile } from '@/utils/mediaAssets';
import { useI18n } from '@/i18n/I18nProvider';
import { forwardPaintingPanelError } from './Generation/errorRecords.mjs';
import { hasFileDrag, readDroppedFiles } from './tools/ImageTools/previewImageDragData.mjs';
import GallerySourceSelect from '@/components/gallery/GallerySourceSelect';
import apiClient from '@/utils/ApiClient';

const REFERENCE_METADATA_URL = '/metadata.json';
const REFERENCE_IMAGE_BASE_URL = '/reference_img';

function buildReferenceImageUrl(filename) {
  return `${REFERENCE_IMAGE_BASE_URL}/${encodeURIComponent(filename)}`;
}

function extractReferenceComment(metadataEntry) {
  if (!metadataEntry || typeof metadataEntry !== 'object') {
    return null;
  }

  return (
    metadataEntry.ai_parameters?.Comment ||
    metadataEntry.png_text?.Comment ||
    metadataEntry.ai_parameters?.comment ||
    metadataEntry.png_text?.comment ||
    null
  );
}

function parseReferenceImageParameters(metadataEntry) {
  const comment = extractReferenceComment(metadataEntry);

  if (!comment) {
    return null;
  }

  if (typeof comment === 'object') {
    return comment;
  }

  if (typeof comment === 'string') {
    return JSON.parse(comment);
  }

  return null;
}

function buildReferenceImageList(metadataMap) {
  if (!metadataMap || typeof metadataMap !== 'object') {
    return [];
  }

  return Object.entries(metadataMap)
    .map(([filename, metadataEntry]) => {
      const size = metadataEntry?.basic_info?.size;

      return {
        filename,
        id: filename,
        url: buildReferenceImageUrl(filename),
        width: Array.isArray(size) ? size[0] : undefined,
        height: Array.isArray(size) ? size[1] : undefined,
      };
    })
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

// --- Helper Components (Extracted & Memoized for Performance) ---

/**
 * GalleryHeader Component
 * Renders the introductory card in the gallery.
 * Memoized to prevent re-renders unless its props change.
 */
const GalleryHeader = React.memo(({ imageCount, onRefresh, isLoading, source, onSourceChange }) => {
  const { t } = useI18n();
  const theme = useTheme(); // 添加主题hook

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        // 使用主题色创建渐变
        background: `linear-gradient(135deg, ${theme.palette.primary.main}20 0%, ${theme.palette.info.main}20 100%)`,
        border: `1px solid ${theme.palette.divider}`,
        backdropFilter: 'blur(10px)',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: `linear-gradient(45deg, transparent 30%, ${theme.palette.action.hover} 50%, transparent 70%)`,
          animation: 'shimmer 3s infinite',
        },
        '@keyframes shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      }}
    >
      <Typography variant="body1" sx={{
        color: theme.palette.text.primary,
        fontWeight: 'medium',
        mb: 1,
        textShadow: `0 1px 2px ${theme.palette.action.selected}`,
        zIndex: 1,
        position: 'relative'
      }}>
        {t('painting.workspace.gallery.needInspiration')}
      </Typography>
      <Typography variant="body2" sx={{
        color: theme.palette.text.secondary,
        mb: 1,
        zIndex: 1,
        position: 'relative'
      }}>
        {t('painting.workspace.gallery.clickForInspiration')}
      </Typography>
      <Box sx={{ mb: 1.5, position: 'relative', zIndex: 1 }}><GallerySourceSelect value={source} onChange={onSourceChange} disabled={isLoading} /></Box>
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, zIndex: 1, position: 'relative' }}>
        <Typography variant="caption" color={theme.palette.text.secondary}>
          {t('painting.workspace.gallery.referenceImageCount', { count: imageCount })}
        </Typography>
        <IconButton
          aria-label={t('painting.workspace.gallery.refresh')}
          size="small"
          onClick={onRefresh}
          disabled={isLoading}
          sx={{
            color: theme.palette.text.secondary,
            '&:hover': {
              color: theme.palette.primary.main,
              backgroundColor: theme.palette.action.hover
            }
          }}
        >
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
});
GalleryHeader.displayName = 'GalleryHeader';


/**
 * GalleryItem Component
 * Renders a single image item in the gallery.
 * Memoized to prevent re-renders unless its props change.
 */
const GalleryItem = React.memo(({ item, onImageClick, isSelected, isLoadingParams }) => {
  const { t } = useI18n();
  const theme = useTheme(); // 添加主题hook

  const handleClick = () => {
    onImageClick(item);
  };

  return (
    <ButtonBase
      aria-label={t('painting.workspace.gallery.clickForParameters')}
      disabled={isLoadingParams}
      onClick={handleClick}
      sx={{
        width: '100%', display: 'block', textAlign: 'left', cursor: 'pointer',
        borderRadius: 1,
        overflow: 'hidden',
        position: 'relative',
        transition: 'all 0.3s ease',
        backgroundColor: theme.palette.action.selected,
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: theme.shadows[8],
          '& .overlay': { opacity: 1 },
          '& .image': { transform: 'scale(1.05)' }
        },
        ...(isSelected && {
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            border: '3px solid',
            borderColor: theme.palette.primary.main, // 使用主题主色调
            borderRadius: 1,
            zIndex: 10,
            boxShadow: `0 0 15px ${theme.palette.primary.main}60`, // 使用主题色的半透明版本
            animation: 'pulse 2s infinite'
          },
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.7 }
          }
        })
      }}
    >
      <img
        src={item.url}
        alt={item.filename}
        className="image"
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          transition: 'transform 0.3s ease',
          backgroundColor: theme.palette.action.hover
        }}
        loading="lazy"
      />
      <Box
        className="overlay"
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: `linear-gradient(to top, ${theme.palette.background.paper}cc 0%, ${theme.palette.background.paper}4d 50%, transparent 100%)`,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          opacity: 0, transition: 'opacity 0.3s ease', p: 1
        }}
      >
        <Typography variant="caption" sx={{
          textAlign: 'center',
          fontWeight: 'bold',
          color: theme.palette.text.primary,
          textShadow: `0 1px 2px ${theme.palette.background.paper}`,
          backgroundColor: theme.palette.background.paper,
          px: 1,
          py: 0.5,
          borderRadius: 1
        }}>
          {t('painting.workspace.gallery.clickForParameters')}
        </Typography>
      </Box>
      {isLoadingParams && isSelected && (
        <Box sx={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: theme.palette.background.paper + 'cc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 15
        }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={24} sx={{ color: theme.palette.primary.main }} />
            <Typography variant="caption" color={theme.palette.text.primary}>{t('painting.workspace.common.loading')}</Typography>
          </Box>
        </Box>
      )}
    </ButtonBase>
  );
});
GalleryItem.displayName = 'GalleryItem';


/**
 * ReferenceImageGallery Component
 * The main gallery view, now an independent, memoized component.
 * This prevents it from re-rendering unnecessarily and losing scroll position.
 */
const ReferenceImageGallery = React.memo(({
  referenceImages,
  loadingReferenceImages,
  loadingImageParams,
  selectedReferenceImage,
  onImageClick,
  onRefresh, source, onSourceChange, hasMore, onLoadMore
}) => {
  const { t } = useI18n();
  const theme = useTheme(); // 添加主题hook
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const columns = useMemo(() => {

    const colCount = isMobile ? 2 : 4;
    const newColumns = Array.from({ length: colCount }, () => []);

    newColumns[0].push({ type: 'header', id: 'header' });

    referenceImages.forEach((image, index) => {
      const columnIndex = index % colCount;
      newColumns[columnIndex].push({ type: 'image', ...image });
    });

    return newColumns;
  }, [isMobile, referenceImages]); // Correct dependency array

  if (loadingReferenceImages) {
    return (
      <Box sx={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: theme.palette.background.default + '4d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20
      }}>
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          p: 3,
          backgroundColor: theme.palette.background.paper + 'b3',
          borderRadius: 2,
          backdropFilter: 'blur(10px)'
        }}>
          <CircularProgress size={40} sx={{ color: theme.palette.primary.main }} />
          <Typography variant="body1" color={theme.palette.text.primary}>{t('painting.workspace.gallery.loadingReferences')}</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{
      width: '100%',
      height: '100%',
      overflow: 'auto',
      p: 1,
      backgroundColor: theme.palette.background.default + '33',
      display: 'flex',
      gap: 1,
      alignItems: 'flex-start',
      '&::-webkit-scrollbar': { width: '6px' },
      '&::-webkit-scrollbar-track': {
        background: theme.palette.action.hover,
        borderRadius: '3px'
      },
      '&::-webkit-scrollbar-thumb': {
        background: theme.palette.action.selected,
        borderRadius: '3px',
        '&:hover': { background: theme.palette.action.focus }
      },
    }}>
      {columns.map((column, columnIndex) => (
        <Box key={columnIndex} sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {column.map((item) => (
            <Box key={item.id || item.filename}>
              {item.type === 'header' ? (
                <GalleryHeader imageCount={referenceImages.length} onRefresh={onRefresh} isLoading={loadingReferenceImages} source={source} onSourceChange={onSourceChange} />
              ) : (
                <GalleryItem
                  item={item}
                  onImageClick={onImageClick}
                  isSelected={selectedReferenceImage?.id === item.id}
                  isLoadingParams={loadingImageParams}
                />
              )}
            </Box>
          ))}
          {columnIndex === 0 && hasMore && <Button size="small" onClick={onLoadMore}>{t('librarySettings.loadMore')}</Button>}
        </Box>
      ))}
    </Box>
  );
});
ReferenceImageGallery.displayName = 'ReferenceImageGallery';


// --- Main ItemDisplay Component ---

const ItemDisplay = ({
  item,
  active = true,
  onActionButtonClick,
  onNextItem,
  onPreviousItem,
  onDeleteItem,
  generatedItemsCount,
  onApplyImageParameters,
  onError = null,
  disableVibeAction = false,
  hideVibeAction = false,
  hideImg2ImgAction = false,
  showReferenceAction = false,
  disableReferenceAction = false,
  privacyMode = false,
  previewSettings = {},
  onExerciseAction,
  imageDrag = null,
  onImageTool = null,
  imageToolsDisabled = false,
  enhanceDisabled = false,
  onAdjustImage = null,
  onUploadAdjustmentImage, adjustmentActive = false, selectedByGeneration, replayView,
  adjustmentPreview = null,
}) => {
  const { t } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [imageActionsAnchor, setImageActionsAnchor] = useState(null);
  const [canvasLocked, setCanvasLocked] = useState(false);
  const [adjustmentDropActive, setAdjustmentDropActive] = useState(false);
  const [measuredImage, setMeasuredImage] = useState(null);
  const [hoverToolbar, setHoverToolbar] = useState(false);
  const adjustmentZoomRef = useRef(null);
  const displayRef = useRef(null);
  const gesture = useRef(null);
  const adjustmentInput = useRef(null);
  const [notification, setNotification] = useState({ open: false, message: '', severity: 'success' });
  const zoomRef = useRef(null);
  const previewPan = useRef(null);
  const { isGenerating, generationStatus } = useGeneration();
  const imageWidth = item?.width || 512;
  const imageHeight = item?.height || 512;
  const imageRatio = measuredImage && measuredImage.src === item?.src ? measuredImage.ratio : imageWidth / imageHeight;
  const directImageDrag = privacyMode || previewSettings?.displayImageDrag === false ? null : imageDrag;

  const [referenceImages, setReferenceImages] = useState([]);
  const [loadingReferenceImages, setLoadingReferenceImages] = useState(false);
  const [loadingImageParams, setLoadingImageParams] = useState(false);
  const [selectedReferenceImage, setSelectedReferenceImage] = useState(null);
  const [referenceMetadata, setReferenceMetadata] = useState(null);
  const [inspirationSource, setInspirationSource] = useState('default');
  const [sourceReady, setSourceReady] = useState(false);
  const [hasMoreReferences, setHasMoreReferences] = useState(false);
  const referenceRequest = useRef(0);
  const parameterRequest = useRef(0);
  const referenceActionRef = useRef(null);
  const [pendingReferenceImage, setPendingReferenceImage] = useState(null);
  const [showInspiration, setShowInspiration] = useState(false);
  useEffect(() => {
    const update = () => setShowInspiration(localStorage.getItem('novelai:inspiration-visible') === 'true');
    update();
    window.addEventListener('novelai:inspiration-visibility', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('novelai:inspiration-visibility', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  const clearReferenceSelection = useCallback(() => {
    parameterRequest.current += 1;
    referenceActionRef.current = null;
    setPendingReferenceImage(null);
    setSelectedReferenceImage(null);
    setLoadingImageParams(false);
  }, []);

  useEffect(() => {
    clearReferenceSelection();
  }, [active, item?.id, inspirationSource, showInspiration, clearReferenceSelection]);

  useEffect(() => {
    setImageActionsAnchor(null);
    if (isMobile) {
      setHoverToolbar(false);
    }
  }, [isMobile, item?.id]);

  const isVideo = item?.type === 'video';
  const sourcePixels = Number(item?.width) * Number(item?.height);
  const itemId = item?.id;
  const lockedNavigation = !adjustmentActive && canvasLocked && previewSettings.lockedGestureNavigation && generatedItemsCount > 1;
  const viewRef = adjustmentActive ? adjustmentZoomRef : zoomRef;
  useEffect(() => {
    if (replayView) zoomRef.current?.setTransform(replayView.x, replayView.y, replayView.scale, 350);
  }, [replayView]);
  const imageControlsDisabled = adjustmentActive ? !adjustmentPreview : !item || isVideo;

  useLayoutEffect(() => {
    if (itemId && (!selectedByGeneration || previewSettings.centerNewGeneration)) zoomRef.current?.resetTransform(0);
  }, [itemId, selectedByGeneration, previewSettings.centerNewGeneration]);

  useEffect(() => {
    if (!hoverToolbar) return;
    const hideTouchToolbar = (event) => {
      if (!displayRef.current?.contains(event.target)) setHoverToolbar(false);
    };
    document.addEventListener('pointerdown', hideTouchToolbar);
    return () => document.removeEventListener('pointerdown', hideTouchToolbar);
  }, [hoverToolbar]);

  useEffect(() => {
    if (!active || !lockedNavigation) return;
    const region = displayRef.current;
    let lastEvent = -Infinity;
    let distance = 0;
    let moved = false;
    const onWheel = (event) => {
      if (event.ctrlKey || event.target.closest('[data-preview-toolbar]')) return;
      event.preventDefault();
      if (event.timeStamp - lastEvent > 170) {
        distance = 0;
        moved = false;
      }
      lastEvent = event.timeStamp;
      distance += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY)
        * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? region.clientHeight : 1);
      if (moved || Math.abs(distance) < 32) return;
      moved = true;
      if (distance > 0) onNextItem();
      else onPreviousItem();
    };
    region.addEventListener('wheel', onWheel, { passive: false });
    return () => region.removeEventListener('wheel', onWheel);
  }, [active, lockedNavigation, onNextItem, onPreviousItem]);
  const upscaleCost = sourcePixels > 0
    ? [1048576, 1747627, 2446678, 3145728].findIndex((limit) => sourcePixels <= limit) + 1
    : 0;
  const upscaleLabel = upscaleCost
    ? t('painting.workspace.imageTools.upscaleCost', {
      cost: t('painting.workspace.imageTools.approximateAmount', { cost: upscaleCost }),
    })
    : t('painting.workspace.imageTools.upscale');
  const toolbarPaperSx = {
    pointerEvents: 'auto',
    p: { xs: 0.25, md: 0.5 },
    backgroundColor: theme.palette.background.paper + '99',
    backdropFilter: 'blur(5px)',
    border: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    flexWrap: { xs: 'nowrap', md: 'wrap' },
    flexShrink: { xs: 0, md: 1 },
    gap: { xs: 0, md: 0.5 },
    borderRadius: 2,
  };
  const toolbarButtonSx = {
    width: { xs: 35, sm: 40, md: 34 },
    height: { xs: 40, md: 34 },
    '& .MuiSvgIcon-root': { fontSize: { xs: 21, md: 24 } },
    color: theme.palette.text.primary,
    '&:hover': { backgroundColor: theme.palette.action.hover },
    '&.Mui-disabled': { color: theme.palette.action.disabled, pointerEvents: 'auto' },
  };

  const sendActions = [
    { icon: <TuneIcon />, tooltip: t('painting.workspace.gallery.sendToImageProcessing'), action: 'use-as-image-processing' },
    { icon: <BrushOutlined />, tooltip: t('painting.workspace.gallery.sendToInpaint'), action: 'use-as-inpaint' },
  ];
  const useActions = [
    ...(!hideImg2ImgAction ? [{ icon: <CollectionsOutlined />, tooltip: t('painting.workspace.gallery.useForImg2Img'), action: 'use-as-input' }] : []),
    ...(!hideVibeAction ? [
      { icon: <StyleOutlined />, tooltip: t('painting.workspace.gallery.useForVibe'), action: 'use-as-vibe', disabled: disableVibeAction },
    ] : []),
    ...(showReferenceAction ? [
      { icon: <PersonOutline />, tooltip: t('painting.workspace.gallery.useForReference'), action: 'use-as-reference', disabled: disableReferenceAction },
    ] : []),
  ];
  const toolbarButtons = [
    ...(useActions.length ? [{ icon: <PhotoFilterIcon />, tooltip: t('painting.workspace.gallery.useFor'), action: 'use', options: useActions }] : []),
    { icon: <SendIcon />, tooltip: t('painting.workspace.gallery.sendTo'), action: 'send', options: sendActions },
    { icon: <SaveIcon />, tooltip: t('painting.workspace.gallery.saveProject'), action: 'save', disabled: false },
  ].flatMap((button) => previewSettings.expandedImageShortcuts && button.options ? button.options : [button]);
  const menuButton = toolbarButtons.find((button) => button.action === imageActionsAnchor?.action);

  const showNotification = useCallback((message, severity = 'success') => {
    setNotification({ open: true, message, severity });
  }, []);

  const fetchReferenceImages = useCallback(async (offset = 0) => {
    const requestId = ++referenceRequest.current;
    clearReferenceSelection();
    setLoadingReferenceImages(true);
    try {
      if (inspirationSource === 'default') {
        const response = await fetch(REFERENCE_METADATA_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error('REFERENCE_IMAGE_LIST_LOAD_FAILED');
        const metadata = await response.json();
        if (requestId !== referenceRequest.current) return;
        setReferenceMetadata(metadata);
        setReferenceImages(buildReferenceImageList(metadata));
        setHasMoreReferences(false);
      } else {
        const result = await apiClient.getGallery({ source: inspirationSource, offset, limit: 60 });
        if (requestId !== referenceRequest.current) return;
        const images = result.items.map((entry) => ({ ...entry, url: entry.thumbnail_url }));
        setReferenceImages((current) => offset ? [...current, ...images] : images);
        setHasMoreReferences(result.has_more);
      }
    } catch (error) {
      if (requestId === referenceRequest.current) showNotification(t('painting.workspace.errors.fetchReferenceImagesFailed'), 'error');
    } finally {
      if (requestId === referenceRequest.current) setLoadingReferenceImages(false);
    }
  }, [inspirationSource, showNotification, t, clearReferenceSelection]);

  useEffect(() => {
    let active = true;
    if (onExerciseAction) return;
    apiClient.getLocalSettings().then((settings) => {
      if (active) setInspirationSource(settings.inspirationSource || 'default');
    }).catch(() => {
      if (active) showNotification(t('librarySettings.sourceFailed'), 'error');
    }).finally(() => { if (active) setSourceReady(true); });
    const onSource = (event) => { clearReferenceSelection(); setInspirationSource(event.detail); };
    window.addEventListener('novelai:gallery-source', onSource);
    return () => { active = false; window.removeEventListener('novelai:gallery-source', onSource); };
  }, [showNotification, t, clearReferenceSelection]);

  const changeInspirationSource = async (source) => {
    clearReferenceSelection();
    try {
      await apiClient.saveLocalSettings({ inspirationSource: source });
      setInspirationSource(source);
      window.dispatchEvent(new CustomEvent('novelai:gallery-source', { detail: source }));
    } catch { showNotification(t('librarySettings.sourceFailed'), 'error'); }
  };

  const fetchImageParameters = useCallback(async (imageItem) => {
    const requestId = ++parameterRequest.current;
    setLoadingImageParams(true);
    try {
      if (inspirationSource !== 'default') {
        const entry = await apiClient.getGalleryEntry(imageItem.id);
        if (requestId !== parameterRequest.current) return;
        onApplyImageParameters?.({ ...entry.parameters, characterTabs: entry.parameters.characterTabs || [], positivePrompt: entry.prompt, negativePrompt: entry.negative_prompt });
        return;
      }
      const metadataEntry = referenceMetadata?.[imageItem.filename];

      if (!metadataEntry) {
        // 目录与本地元数据未匹配属于可恢复校验状态，不写入服务错误记录。
        showNotification(t('painting.workspace.errors.referenceMetadataNotFound'), 'error');
        return;
      }

      let parsedParams = null;
      try {
        parsedParams = parseReferenceImageParameters(metadataEntry);
      } catch (error) {
        console.error('解析图像参数失败:', error);
        forwardPaintingPanelError(onError, error, {
          source: 'reference-parameter-parser',
          messageKey: 'painting.workspace.errors.invalidImageParameterFormat',
        });
        showNotification(t('painting.workspace.errors.invalidImageParameterFormat'), 'error');
        return;
      }

      if (!parsedParams) {
        // 参考图片本身不含受支持参数是内容校验结果，不属于运行时异常。
        showNotification(t('painting.workspace.errors.unsupportedImageParameters'), 'error');
        return;
      }

      if (onApplyImageParameters) {
        onApplyImageParameters(parsedParams);
        showNotification(t('painting.workspace.notifications.imageParametersApplied'), 'success');
      }
    } catch (error) {
      if (requestId !== parameterRequest.current) return;
      console.error('获取图像参数失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'reference-parameters',
        messageKey: 'painting.workspace.errors.fetchImageParametersFailed',
      });
      showNotification(t('painting.workspace.errors.fetchImageParametersFailed'), 'error');
    } finally {
      if (requestId === parameterRequest.current) setLoadingImageParams(false);
    }
  }, [inspirationSource, onApplyImageParameters, onError, referenceMetadata, showNotification, t]);

  const handleReferenceImageClick = useCallback((imageItem) => {
    if (referenceActionRef.current) return;
    referenceActionRef.current = { image: imageItem, applying: false };
    setPendingReferenceImage(imageItem);
  }, []);

  const confirmReferenceImage = useCallback(async () => {
    const action = referenceActionRef.current;
    if (!action || action.applying) return;
    action.applying = true;
    setPendingReferenceImage(null);
    setSelectedReferenceImage(action.image);
    try { await fetchImageParameters(action.image); }
    finally { if (referenceActionRef.current === action) referenceActionRef.current = null; }
  }, [fetchImageParameters]);

  useEffect(() => {
    if (active && showInspiration && !item && sourceReady) {
      fetchReferenceImages();
    }
  }, [active, showInspiration, item, sourceReady, fetchReferenceImages]);

  const handleCloseNotification = () => {
    setNotification({ ...notification, open: false });
  };

  const handleButtonClick = async (action) => {
    if (!item) return;

    if (action === 'save') {
      try {
        const settings = getImageSettings();
        const fileName = generateFileName(item, settings, { extension: 'png' });
        const sourceToSave = item.isComposited ? item.src : (item.downloadSrc || item.originalSrc || item.src);
        if (item.cachedBlob) {
          await downloadBlobToFile(item.cachedBlob, fileName);
        } else {
          await downloadUrlToFile(sourceToSave, fileName);
        }
        showNotification(t('painting.workspace.notifications.itemSavedAs', {
          type: t('painting.workspace.common.image'),
          filename: fileName,
        }), 'success');
        return true;
      } catch (error) {
        console.error('保存项目失败:', error);
        forwardPaintingPanelError(onError, error, {
          source: 'project-save',
          messageKey: 'painting.workspace.errors.projectSaveFailed',
        });
        showNotification(t('painting.workspace.errors.projectSaveFailed'), 'error');
        return false;
      }
    } else {
      // 其他操作
      try {
        const result = await onActionButtonClick(action, null, showNotification);
        return result;
      } catch (error) {
        console.error(`Error performing action ${action}:`, error);
        forwardPaintingPanelError(onError, error, {
          source: 'item-action',
          messageKey: 'painting.workspace.errors.actionFailed',
        });
        showNotification(t('painting.workspace.errors.actionFailed'), 'error');
        return false;
      }
    }
  };

  const handleKeyDown = useCallback((event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const focused = event.target;
    if (focused?.isContentEditable || focused?.closest?.('input, textarea, select, [role="textbox"], [role="slider"], [role="menu"], [role="listbox"], [role="combobox"], [role="separator"]')) return;
    const dialog = focused?.closest?.('[role="dialog"]');
    if (dialog && !dialog.hasAttribute('data-history-dialog')) return;
    const shortcut = getWorkspaceShortcut(event);
    if (!shortcut) return;

    const { previousImageShortcut, nextImageShortcut, deleteImageShortcut, resetViewShortcut, adjustImageShortcut } = previewSettings;
    if (!dialog && shortcut === adjustImageShortcut && onAdjustImage && !event.repeat) {
      event.preventDefault();
      onAdjustImage();
      return;
    }
    if (!dialog && shortcut === resetViewShortcut && viewRef.current && !imageControlsDisabled && !event.repeat) {
      event.preventDefault();
      viewRef.current.resetTransform(0);
      return;
    }
    if (adjustmentActive || !itemId) return;
    switch (shortcut) {
      case previousImageShortcut: event.preventDefault(); onPreviousItem(); break;
      case nextImageShortcut: event.preventDefault(); onNextItem(); break;
      case deleteImageShortcut: if (!event.repeat && onDeleteItem) { event.preventDefault(); onDeleteItem(); } break;
      default: break;
    }
  }, [adjustmentActive, itemId, previewSettings, viewRef, imageControlsDisabled, onAdjustImage, onPreviousItem, onNextItem, onDeleteItem]);

  useEffect(() => {
    if (active) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [active, handleKeyDown]);

  return (
    <Box
      ref={displayRef}
      tabIndex={0}
      role="region"
      aria-label={t('settings.interface.display')}
      sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center',
        overflow: 'hidden', touchAction: lockedNavigation ? 'none' : undefined,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHoverToolbar(true); }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch' && !event.currentTarget.contains(document.activeElement)) setHoverToolbar(false);
      }}
      onFocus={(event) => { if (event.target.matches(':focus-visible')) setHoverToolbar(true); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover')) setHoverToolbar(false); }}
      onPointerDownCapture={(event) => {
        if (event.pointerType !== 'touch' || !event.isPrimary || !displayRef.current.contains(event.target)) return;
        setHoverToolbar(true);
        if (lockedNavigation && !event.target.closest('[data-preview-toolbar]')) {
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }
      }}
      onPointerUp={(event) => {
        const start = gesture.current;
        if (start?.id !== event.pointerId) return;
        gesture.current = null;
        if (!lockedNavigation) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        const distance = Math.abs(dx) >= Math.abs(dy) ? -dx : -dy;
        if (distance > 48) onNextItem();
        else if (distance < -48) onPreviousItem();
      }}
      onPointerCancel={() => { gesture.current = null; }}
    >
      <Snackbar open={notification.open} autoHideDuration={4000} onClose={handleCloseNotification} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={handleCloseNotification} severity={notification.severity} sx={{ width: '100%' }}>
          {notification.message}
        </Alert>
      </Snackbar>

      {isGenerating && (
        <Box sx={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          p: 2,
          backgroundColor: theme.palette.background.paper + 'b3',
          backdropFilter: 'blur(2px)',
          zIndex: 1000,
          borderRadius: '0 0 8px 8px'
        }}>
          {generationStatus.status === 'failed' ? (
            <Box sx={{
              textAlign: 'center',
              color: theme.palette.text.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <WarningIcon color="error" sx={{ fontSize: 24, mr: 1 }} />
              <Typography variant="body2">{t('painting.workspace.errors.generationFailed')}</Typography>
            </Box>
          ) : (
            <Box sx={{ width: '100%' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="body2" color={theme.palette.text.primary}>
                  {generationStatus.status === 'verifying'
                    ? t('painting.workspace.status.verifying')
                    : generationStatus.status === 'queued'
                      ? t('painting.workspace.status.generationProgress', {
                        progress: Math.round(generationStatus.progress || 0),
                      })
                      : generationStatus.status === 'processing'
                        ? t('painting.workspace.status.finishingGeneration')
                        : t('painting.workspace.status.preparing')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {generationStatus.status === 'processing' && <CircularProgress size={16} thickness={5} sx={{ color: theme.palette.primary.main, mr: 1 }} />}
                  <Typography variant="body2" color={theme.palette.text.primary}>{Math.round(generationStatus.progress)}%</Typography>
                </Box>
              </Box>
              <LinearProgress
                variant="determinate"
                value={generationStatus.progress}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: theme.palette.action.hover,
                  '& .MuiLinearProgress-bar': { backgroundColor: theme.palette.primary.main }
                }}
              />
            </Box>
          )}
        </Box>
      )}

      <Fade in={Boolean(onExerciseAction) || hoverToolbar || adjustmentActive || Boolean(replayView)} timeout={200}>
        <Paper
          data-preview-toolbar
          elevation={0}
          sx={{
            ...toolbarPaperSx,
            position: 'absolute',
            bottom: { xs: 8, md: 16 },
            right: { xs: 8, md: 16 },
            flexDirection: { xs: 'row', md: 'column' },
            zIndex: 100,
            opacity: { xs: 1, md: 0.7 },
            '&:hover': { opacity: 1 }
          }}
        >
          {(!canvasLocked || adjustmentActive || !item) && <>
            <IconButton sx={toolbarButtonSx} disabled={imageControlsDisabled} data-tour="zoomImage" aria-label={t('painting.workspace.gallery.zoomIn')} onClick={() => {
              viewRef.current?.zoomIn(); onExerciseAction?.('zoomImage');
            }}><ZoomInIcon fontSize="small" /></IconButton>
            <IconButton sx={toolbarButtonSx} disabled={imageControlsDisabled} aria-label={t('painting.workspace.gallery.zoomOut')} onClick={() => viewRef.current?.zoomOut()}><ZoomOutIcon fontSize="small" /></IconButton>
            <IconButton sx={toolbarButtonSx} disabled={imageControlsDisabled} data-tour="resetImage" aria-label={t('painting.workspace.gallery.resetView')} onClick={() => {
              viewRef.current?.resetTransform(); onExerciseAction?.('resetImage');
            }}><ResetIcon fontSize="small" /></IconButton>
          </>}
          {!adjustmentActive && <Tooltip title={t(canvasLocked ? 'painting.workspace.gallery.unlockCanvas' : 'painting.workspace.gallery.lockCanvas')}>
            <IconButton sx={toolbarButtonSx} disabled={!item || isVideo} aria-label={t(canvasLocked ? 'painting.workspace.gallery.unlockCanvas' : 'painting.workspace.gallery.lockCanvas')}
              aria-pressed={canvasLocked} onClick={() => {
                if (!canvasLocked) zoomRef.current?.resetTransform(0);
                setCanvasLocked(!canvasLocked);
              }}>
              {canvasLocked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>}
        </Paper>
      </Fade>

      <Box data-preview-toolbar sx={{
        position: 'absolute', top: isGenerating ? 80 : { xs: 8, md: 16 },
        left: { xs: 8, md: 16 }, right: { xs: 8, md: 16 },
        zIndex: 100, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: { xs: 0.5, md: 1 }, pointerEvents: 'none',
      }}>
        {(onAdjustImage || (onImageTool)) && (
          <Fade in={Boolean(onExerciseAction) || hoverToolbar || adjustmentActive} timeout={200}>
            <Paper elevation={0} sx={toolbarPaperSx}>
              {onImageTool && <>
              <Tooltip title={!upscaleCost
                ? t(sourcePixels > 0 ? 'painting.workspace.imageTools.upscaleTooLarge' : 'painting.workspace.imageTools.sourceDimensionsUnavailable')
                : upscaleLabel} arrow placement="bottom">
                <span>
                  <IconButton aria-label={upscaleLabel} size="small" sx={toolbarButtonSx}
                    disabled={!item || isVideo || adjustmentActive || isGenerating || imageToolsDisabled || !upscaleCost}
                    onClick={() => onImageTool('upscale')}>
                    <OpenInFullIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('painting.workspace.imageTools.enhance')} arrow placement="bottom">
                <span>
                  <IconButton aria-label={t('painting.workspace.imageTools.enhance')} size="small" sx={toolbarButtonSx}
                    disabled={!item || isVideo || adjustmentActive || isGenerating || imageToolsDisabled || enhanceDisabled}
                    onClick={() => onImageTool('enhance')}>
                    <AutoAwesomeIcon />
                  </IconButton>
                </span>
              </Tooltip>
              </>}
              {onAdjustImage && <Tooltip title={t('painting.workspace.adjustment.title')} arrow placement="bottom">
                <IconButton data-tour="openAdjustment" aria-label={t('painting.workspace.adjustment.title')} aria-pressed={adjustmentActive}
                  size="small" sx={{ ...toolbarButtonSx, color: adjustmentActive ? 'primary.main' : toolbarButtonSx.color }}
                  onClick={onAdjustImage}><TuneIcon /></IconButton>
              </Tooltip>}
              {adjustmentPreview && <Tooltip title={t('painting.workspace.adjustment.openImage')} arrow placement="bottom">
                <IconButton aria-label={t('painting.workspace.adjustment.openImage')} size="small" sx={toolbarButtonSx}
                  onClick={() => adjustmentInput.current.click()}><AddPhotoIcon /></IconButton>
              </Tooltip>}
            </Paper>
          </Fade>
        )}
        <Fade in={Boolean(onExerciseAction) || hoverToolbar} timeout={200}>
          <Paper elevation={0} sx={{ ...toolbarPaperSx, ml: 'auto', maxWidth: '100%', flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {toolbarButtons.map((button) => (
            <Tooltip key={button.action} title={button.tooltip} arrow placement="bottom">
              <span>
                <IconButton
                  aria-label={button.tooltip}
                  size="small"
                  aria-haspopup={button.options ? 'menu' : undefined}
                  aria-expanded={button.options ? menuButton?.action === button.action : undefined}
                  onClick={(event) => {
                    if (button.options) setImageActionsAnchor({ element: event.currentTarget, action: button.action });
                    else void handleButtonClick(button.action);
                  }}
                  disabled={!item || adjustmentActive || button.disabled || (isVideo && button.action !== 'save')}
                  sx={toolbarButtonSx}
                >
                  {button.icon}
                </IconButton>
              </span>
            </Tooltip>
          ))}
          </Paper>
        </Fade>
      </Box>

      <Menu
        anchorEl={imageActionsAnchor?.element}
        open={Boolean(menuButton)}
        onClose={() => setImageActionsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { maxWidth: 'calc(100vw - 24px)' } }, list: { 'aria-label': menuButton?.tooltip } }}
      >
        {menuButton?.options.map((button) => (
          <MenuItem key={button.action} disabled={button.disabled} sx={{ minHeight: 44, whiteSpace: 'normal' }} onClick={() => {
            setImageActionsAnchor(null);
            void handleButtonClick(button.action);
          }}>
            <ListItemText>{button.tooltip}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {generatedItemsCount > 1 && !adjustmentActive && (
        <>
          <Fade in={Boolean(onExerciseAction) || hoverToolbar} timeout={200}>
            <IconButton
              data-preview-toolbar
              onClick={onPreviousItem}
              sx={{
                position: 'absolute',
                left: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 101,
                color: theme.palette.text.primary,
                backgroundColor: theme.palette.background.paper + '4d',
                '&:hover': { backgroundColor: theme.palette.background.paper + '80' }
              }}
              aria-label={t('painting.workspace.gallery.previousItem')}
            >
              <ChevronLeftIcon />
            </IconButton>
          </Fade>
          <Fade in={Boolean(onExerciseAction) || hoverToolbar} timeout={200}>
            <IconButton
              data-preview-toolbar
              onClick={onNextItem}
              sx={{
                position: 'absolute',
                right: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 101,
                color: theme.palette.text.primary,
                backgroundColor: theme.palette.background.paper + '4d',
                '&:hover': { backgroundColor: theme.palette.background.paper + '80' }
              }}
              data-tour="nextImage" aria-label={t('painting.workspace.gallery.nextItem')}
            >
              <ChevronRightIcon />
            </IconButton>
          </Fade>
        </>
      )}

      {item && (isVideo ? !adjustmentActive && (
          <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', ...imagePrivacySx }}>
            <video
              data-private-image
              src={item.src}
              controls
              autoPlay
              loop
              style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px', boxShadow: theme.shadows[8] }}
            />
            {privacyMode && <ImagePrivacyCover onReveal={() => onExerciseAction?.('revealImage')} key={item.id} mode={previewSettings.privacyReveal} />}
          </Box>
      ) : (
        <Box sx={{ position: 'absolute', inset: 0, visibility: adjustmentActive ? 'hidden' : 'visible' }}>
          <TransformWrapper ref={zoomRef} initialScale={1} minScale={0.5} maxScale={4}
            onPanning={() => onExerciseAction?.('panImage')} onPinching={() => onExerciseAction?.('zoomImage')}
            disabled={canvasLocked || adjustmentActive} centerOnInit centerZoomedOut={false} limitToBounds={false}
            panning={{ excluded: ['image-privacy-cover', 'image-adjustment-canvas'] }} pinch={{ excluded: ['image-privacy-cover', 'image-adjustment-canvas'] }}
            doubleClick={{ disabled: true }} velocityAnimation={{ disabled: true }} alignmentAnimation={{ disabled: true }}>
            <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
              <Box
                sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', containerType: 'size' }}
              >
                <Box draggable={Boolean(directImageDrag?.armedMode)} data-preview-image-drag={directImageDrag ? (directImageDrag.armedMode ? 'ready' : 'idle') : undefined}
                  onMouseDown={directImageDrag ? (event) => {
                    // 缩放容器会取消 mousedown 的默认行为。左键先等待长按，短拖由下面的指针事件平移。
                    if (event.button === 0) event.stopPropagation();
                  } : undefined}
                  onPointerDown={directImageDrag ? (event) => {
                    directImageDrag.onPointerDown(event, directImageDrag.mode);
                    const state = zoomRef.current?.instance.transformState;
                    if (event.button === 0 && event.pointerType !== 'touch' && !canvasLocked && state) {
                      previewPan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
                        positionX: state.positionX, positionY: state.positionY, scale: state.scale };
                    }
                  } : undefined}
                  onPointerMove={directImageDrag ? (event) => {
                    const pan = previewPan.current;
                    if (!pan || pan.pointerId !== event.pointerId || !(event.buttons & 1) || directImageDrag.wasHeld()) return;
                    const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                      if (Math.hypot(dx, dy) <= 7) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }
                    zoomRef.current?.setTransform(pan.positionX + dx, pan.positionY + dy, pan.scale, 0);
                  } : undefined}
                  onPointerUp={() => { previewPan.current = null; }}
                  onPointerCancel={() => { previewPan.current = null; }}
                  onDragStart={directImageDrag ? (event) => directImageDrag.onDragStart(event, directImageDrag.mode) : undefined}
                  onDragEnd={directImageDrag?.onDragEnd}
                  onContextMenu={directImageDrag ? (event) => event.preventDefault() : undefined}
                  sx={{
                    position: 'relative', width: `min(${imageWidth}px, 100cqw, ${100 * imageRatio}cqh)`, aspectRatio: String(imageRatio),
                    borderRadius: '4px', boxShadow: theme.shadows[8], cursor: directImageDrag?.armedMode ? 'grabbing' : undefined, ...imagePrivacySx,
                    ...transparencyBackgroundSx(previewSettings, theme),
                  }}>
                  <Image data-private-image data-share-image-url={privacyMode ? undefined : (item.isComposited ? item.src : (item.downloadSrc || item.originalSrc || item.src))}
                    src={item.src} alt={t('painting.workspace.gallery.generatedImageAlt')} width={imageWidth} height={imageHeight}
                    unoptimized draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' }}
                    onLoad={({ currentTarget }) => {
                      const ratio = currentTarget.naturalWidth / currentTarget.naturalHeight;
                      if (ratio !== imageWidth / imageHeight) setMeasuredImage({ src: item.src, ratio });
                    }} />
                  {privacyMode && <ImagePrivacyCover onReveal={() => onExerciseAction?.('revealImage')} key={item.id} mode={previewSettings.privacyReveal} imageDrag={imageDrag} />}
                </Box>
              </Box>
            </TransformComponent>
          </TransformWrapper>
        </Box>
      ))}

      {!item && !adjustmentActive && (showInspiration ? (
        <ReferenceImageGallery
          referenceImages={referenceImages}
          loadingReferenceImages={loadingReferenceImages}
          loadingImageParams={loadingImageParams}
          selectedReferenceImage={selectedReferenceImage}
          onImageClick={handleReferenceImageClick}
          onRefresh={() => fetchReferenceImages()}
          source={inspirationSource}
          onSourceChange={changeInspirationSource}
          hasMore={hasMoreReferences}
          onLoadMore={() => fetchReferenceImages(referenceImages.length)}
        />
      ) : (
        <ImageOutlinedIcon
          titleAccess={t('painting.workspace.gallery.previewEmpty')}
          sx={{ fontSize: { xs: 64, md: 96 }, color: 'text.secondary', opacity: 0.55 }}
        />
      ))}
      {adjustmentActive && (adjustmentPreview ? (
        <TransformWrapper ref={adjustmentZoomRef} initialScale={1} minScale={0.5} maxScale={4}
          centerOnInit centerZoomedOut={false} limitToBounds={false}
          panning={{ excluded: ['image-privacy-cover', 'image-adjustment-canvas'] }}
          pinch={{ excluded: ['image-privacy-cover', 'image-adjustment-canvas'] }}
          doubleClick={{ disabled: true }} velocityAnimation={{ disabled: true }} alignmentAnimation={{ disabled: true }}>
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', containerType: 'size' }}>
            {adjustmentPreview}
          </TransformComponent>
        </TransformWrapper>
      ) : (
        <ButtonBase data-drop-zone onClick={() => adjustmentInput.current.click()}
          onDragOver={(event) => {
            if (!hasFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setAdjustmentDropActive(true);
          }}
          onDragLeave={() => setAdjustmentDropActive(false)}
          onDrop={(event) => {
            if (!hasFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            setAdjustmentDropActive(false);
            const image = readDroppedFiles(event.dataTransfer).find((file) => file.type.startsWith('image/'));
            if (image) onUploadAdjustmentImage(image);
          }}
          sx={{
            width: 'min(420px, calc(100% - 32px))', minHeight: { xs: 160, sm: 210 }, p: 3,
            display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'center',
            color: 'text.primary', border: '1px dashed', borderColor: adjustmentDropActive ? 'primary.main' : 'divider',
            borderRadius: 2, bgcolor: adjustmentDropActive ? 'action.selected' : 'transparent',
            '&:hover, &.Mui-focusVisible': { bgcolor: 'action.hover', borderColor: 'primary.main' },
            '& > *': { pointerEvents: 'none' },
          }}>
          <Box aria-hidden sx={{
            width: { xs: 64, sm: 82 }, height: { xs: 64, sm: 82 }, display: 'grid', placeItems: 'center',
            bgcolor: 'action.selected', color: 'primary.main', borderRadius: 2.5,
          }}>
            <AddPhotoIcon sx={{ fontSize: { xs: 38, sm: 46 } }} />
          </Box>
          <Typography variant="subtitle1" fontWeight={600}>{t('painting.workspace.adjustment.dropImageHere')}</Typography>
        </ButtonBase>
      ))}
      <input ref={adjustmentInput} type="file" accept="image/*" hidden onChange={(event) => {
        const file = event.currentTarget.files[0];
        event.currentTarget.value = '';
        if (file) onUploadAdjustmentImage(file);
      }} />
      <Dialog open={Boolean(pendingReferenceImage)} onClose={clearReferenceSelection} maxWidth="xs" fullWidth
        aria-labelledby="inspiration-parameters-title" aria-describedby="inspiration-parameters-description">
        <DialogTitle id="inspiration-parameters-title">{t('painting.workspace.gallery.confirmApplyTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText id="inspiration-parameters-description">{t('painting.workspace.gallery.confirmApplyDescription')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={clearReferenceSelection} autoFocus>{t('painting.workspace.actions.cancel')}</Button>
          <Button onClick={confirmReferenceImage} variant="contained">{t('painting.workspace.gallery.confirmApply')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ItemDisplay;
