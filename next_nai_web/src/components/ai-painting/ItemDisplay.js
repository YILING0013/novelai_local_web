/* eslint-disable @next/next/no-img-element */
// ItemDisplay.js
"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Paper,
  Typography,
  Fade,
  ButtonGroup,
  LinearProgress,
  CircularProgress,
  Snackbar,
  Alert,
  useTheme,
} from '@mui/material';
import {
  SaveAlt as SaveIcon,
  ImportExport as ImportExportIcon,
  AddPhotoAlternate as AddPhotoIcon,
  Brush as BrushIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RestartAlt as ResetIcon,
  Warning as WarningIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Refresh as RefreshIcon,
  PhotoSizeSelectLarge as UpscaleIcon,
} from '@mui/icons-material';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import Image from 'next/image';
import { useGeneration } from './Generation/GenerationContext';
import { getImageSettings, generateFileName } from './tools/ImageTools/ImageSaveUtils';
import { downloadBlobToFile, downloadUrlToFile } from '@/utils/mediaAssets';
import { useI18n } from '@/i18n/I18nProvider';
import { forwardPaintingPanelError } from './Generation/errorRecords.mjs';

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
const GalleryHeader = React.memo(({ imageCount, onRefresh, isLoading }) => {
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
    <Box
      onClick={handleClick}
      sx={{
        cursor: 'pointer',
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
    </Box>
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
  onRefresh
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
    if (!referenceImages || referenceImages.length === 0) return [];

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

  if (columns.length === 0) {
    return (
      <Box sx={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.palette.text.secondary,
        p: 4,
        textAlign: 'center'
      }}>
        <AddPhotoIcon sx={{ fontSize: 60, mb: 2, opacity: 0.5 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>{t('painting.workspace.gallery.noReferences')}</Typography>
        <Typography variant="body2" color={theme.palette.text.disabled}>{t('painting.workspace.gallery.tryAgainLater')}</Typography>
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
                <GalleryHeader imageCount={referenceImages.length} onRefresh={onRefresh} isLoading={loadingReferenceImages} />
              ) : (
                <GalleryItem
                  item={item}
                  onImageClick={onImageClick}
                  isSelected={selectedReferenceImage?.filename === item.filename}
                  isLoadingParams={loadingImageParams}
                />
              )}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
});
ReferenceImageGallery.displayName = 'ReferenceImageGallery';


// --- Main ItemDisplay Component ---

const ItemDisplay = ({
  item,
  onActionButtonClick,
  onNextItem,
  onPreviousItem,
  onDeleteItem,
  generatedItemsCount,
  onApplyImageParameters,
  onError = null,
  disableVibeAction = false,
  isUpscaling = false,
}) => {
  const { t } = useI18n();
  const theme = useTheme();
  const [hoverToolbar, setHoverToolbar] = useState(false);
  const [hoverImage, setHoverImage] = useState(false);
  const [notification, setNotification] = useState({ open: false, message: '', severity: 'success' });
  const wrapperRef = useRef(null);
  const { isGenerating, generationStatus } = useGeneration();

  const [referenceImages, setReferenceImages] = useState([]);
  const [loadingReferenceImages, setLoadingReferenceImages] = useState(false);
  const [loadingImageParams, setLoadingImageParams] = useState(false);
  const [selectedReferenceImage, setSelectedReferenceImage] = useState(null);
  const [referenceMetadata, setReferenceMetadata] = useState(null);

  const toolbarButtons = useMemo(() => [
    { icon: <AddPhotoIcon />, tooltip: t('painting.workspace.gallery.useForImg2Img'), action: 'use-as-input' },
    { icon: <BrushIcon />, tooltip: t('painting.workspace.gallery.sendToInpaint'), action: 'use-as-inpaint' },
    { icon: <ImportExportIcon />, tooltip: disableVibeAction ? t('painting.workspace.errors.v5VibeUnsupported') : t('painting.workspace.gallery.useForVibe'), action: 'use-as-vibe', disabled: disableVibeAction },
    {
      icon: isUpscaling ? <CircularProgress size={18} color="inherit" /> : <UpscaleIcon />,
      tooltip: t(isUpscaling ? 'painting.workspace.gallery.officialUpscaling' : 'painting.workspace.gallery.officialUpscale'),
      action: 'official-upscale',
      disabled: isUpscaling || isGenerating,
    },
    { icon: <SaveIcon />, tooltip: t('painting.workspace.gallery.saveProject'), action: 'save', disabled: false },
  ], [disableVibeAction, isGenerating, isUpscaling, t]);

  const showNotification = useCallback((message, severity = 'success') => {
    setNotification({ open: true, message, severity });
  }, []);

  const fetchReferenceImages = useCallback(async () => {
    setLoadingReferenceImages(true);
    try {
      const response = await fetch(REFERENCE_METADATA_URL, {
        cache: 'no-store',
      });

      if (!response.ok) {
        // 静态参考图库没有 API 错误体，仍以稳定 code/statusCode 标记真实请求失败。
        throw Object.assign(new Error('REFERENCE_IMAGE_LIST_LOAD_FAILED'), {
          code: 'REFERENCE_IMAGE_LIST_LOAD_FAILED',
          statusCode: response.status,
        });
      }

      const metadata = await response.json();
      setReferenceMetadata(metadata);
      setReferenceImages(buildReferenceImageList(metadata));
    } catch (error) {
      console.error('获取参考图像失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'reference-gallery',
        messageKey: 'painting.workspace.errors.fetchReferenceImagesFailed',
      });
      showNotification(t('painting.workspace.errors.fetchReferenceImagesFailed'), 'error');
    } finally {
      setLoadingReferenceImages(false);
    }
  }, [onError, showNotification, t]);

  const fetchImageParameters = useCallback(async (filename) => {
    setLoadingImageParams(true);
    try {
      const metadataEntry = referenceMetadata?.[filename];

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
      console.error('获取图像参数失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'reference-parameters',
        messageKey: 'painting.workspace.errors.fetchImageParametersFailed',
      });
      showNotification(t('painting.workspace.errors.fetchImageParametersFailed'), 'error');
    } finally {
      setLoadingImageParams(false);
    }
  }, [onApplyImageParameters, onError, referenceMetadata, showNotification, t]);

  const handleReferenceImageClick = useCallback((imageItem) => {
    setSelectedReferenceImage(imageItem);
    fetchImageParameters(imageItem.filename);
  }, [fetchImageParameters]);

  useEffect(() => {
    if (!item && referenceImages.length === 0 && !loadingReferenceImages) {
      fetchReferenceImages();
    }
  }, [item, fetchReferenceImages, loadingReferenceImages, referenceImages.length]);

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
    if (!item) return;
    const activeElement = document.activeElement;
    // 检查焦点是否在输入框内，如果是，则不响应导航键
    const isInputFocused = activeElement && (activeElement.tagName.toLowerCase() === 'input' || activeElement.tagName.toLowerCase() === 'textarea' || activeElement.isContentEditable);
    if (isInputFocused && ['ArrowLeft', 'ArrowRight', 'Delete'].includes(event.key)) return;

    switch (event.key) {
      case 'ArrowLeft': event.preventDefault(); onPreviousItem(); break;
      case 'ArrowRight': event.preventDefault(); onNextItem(); break;
      case 'Delete': event.preventDefault(); onDeleteItem(); break;
      default: break;
    }
  }, [item, onPreviousItem, onNextItem, onDeleteItem]);

  useEffect(() => {
    // 仅在有选中项目时才添加键盘事件监听
    if (item) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [item, handleKeyDown]);

  return (
    <Box
      sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', outline: 'none' }}
      onMouseEnter={() => { setHoverToolbar(true); setHoverImage(true); }}
      onMouseLeave={() => { setHoverToolbar(false); setHoverImage(false); }}
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

      {item ? (
        // 渲染图片查看器
          <TransformWrapper ref={wrapperRef} initialScale={1} minScale={0.5} maxScale={4} centerOnInit={true} centerZoomedOut={false} limitToBounds={false} doubleClick={{ disabled: true }} panning={{ disabled: false }} velocityAnimation={{ disabled: true }} alignmentAnimation={{ disabled: true }}>
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <Fade in={hoverToolbar} timeout={200}>
                  <ButtonGroup
                    orientation="vertical"
                    variant="contained"
                    size="small"
                    color="primary"
                    sx={{
                      position: 'absolute',
                      bottom: 16,
                      right: 16,
                      zIndex: 100,
                      opacity: 0.7,
                      '&:hover': { opacity: 1 }
                    }}
                  >
                    <IconButton aria-label={t('painting.workspace.gallery.zoomIn')} onClick={() => zoomIn()}><ZoomInIcon fontSize="small" /></IconButton>
                    <IconButton aria-label={t('painting.workspace.gallery.zoomOut')} onClick={() => zoomOut()}><ZoomOutIcon fontSize="small" /></IconButton>
                    <IconButton aria-label={t('painting.workspace.gallery.resetView')} onClick={() => resetTransform()}><ResetIcon fontSize="small" /></IconButton>
                  </ButtonGroup>
                </Fade>

                <Fade in={hoverToolbar} timeout={200}>
                  <Paper
                    elevation={0}
                    sx={{
                      position: 'absolute',
                      top: isGenerating ? 80 : 16,
                      right: 16,
                      zIndex: 100,
                      p: 0.5,
                      backgroundColor: theme.palette.background.paper + '99',
                      backdropFilter: 'blur(5px)',
                      border: `1px solid ${theme.palette.divider}40`,
                      display: 'flex',
                      gap: 0.5,
                      borderRadius: 2
                    }}
                  >
                    {toolbarButtons.map((button) => (
                      <Tooltip key={button.action} title={button.tooltip} arrow placement="bottom">
                        <span>
                          <IconButton
                            aria-label={button.tooltip}
                            size="small"
                            onClick={() => handleButtonClick(button.action)}
                            disabled={button.disabled}
                            sx={{
                              color: theme.palette.text.primary,
                              '&:hover': { backgroundColor: theme.palette.action.hover },
                              '&.Mui-disabled': { color: theme.palette.action.disabled, pointerEvents: 'auto' }
                            }}
                          >
                            {button.icon}
                          </IconButton>
                        </span>
                      </Tooltip>
                    ))}
                  </Paper>
                </Fade>

                {generatedItemsCount > 1 && (
                  <>
                    <Fade in={hoverImage} timeout={200}>
                      <IconButton
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
                    <Fade in={hoverImage} timeout={200}>
                      <IconButton
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
                        aria-label={t('painting.workspace.gallery.nextItem')}
                      >
                        <ChevronRightIcon />
                      </IconButton>
                    </Fade>
                  </>
                )}

                <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', position: 'relative' }}>
                    <Image src={item.src} alt={t('painting.workspace.gallery.generatedImageAlt')} width={item.width || 512} height={item.height || 512} unoptimized={true} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px', boxShadow: theme.shadows[8] }} draggable={false} />
                  </Box>
                </TransformComponent>
              </>
            )}
          </TransformWrapper>
      ) : (
        <ReferenceImageGallery
          referenceImages={referenceImages}
          loadingReferenceImages={loadingReferenceImages}
          loadingImageParams={loadingImageParams}
          selectedReferenceImage={selectedReferenceImage}
          onImageClick={handleReferenceImageClick}
          onRefresh={fetchReferenceImages}
        />
      )}
    </Box>
  );
};

export default ItemDisplay;
