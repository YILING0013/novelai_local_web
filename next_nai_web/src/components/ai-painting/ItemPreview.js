// ItemPreview.js
"use client";

import React, { useContext, useRef, useEffect, useState, useCallback } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
  Stack,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slide,
  useMediaQuery,
  Alert,
  Snackbar,
} from '@mui/material';
import {
  KeyboardArrowLeft as LeftIcon,
  KeyboardArrowRight as RightIcon,
  PlayCircleFilled as PlayIcon,
  Collections as CollectionsIcon,
  History as HistoryIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  DeleteSweep as DeleteSweepIcon,
  Close as CloseIcon,
  Archive as ArchiveIcon,
  Tune as TuneIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  VisibilityOutlined, FileUploadOutlined,
} from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { Sprout } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  downloadBlobToFile,
  downloadUrlToFile,
  fetchUrlAsBlob,
} from '@/utils/mediaAssets';
import { generateFileName, getImageSettings } from './tools/ImageTools/ImageSaveUtils';
import PublicDemoContext from './PublicDemoContext';
import { useI18n } from '@/i18n/I18nProvider';
import ImagePrivacyCover, { imagePrivacySx } from './ImagePrivacyCover';
import PreviewImageSettings from './PreviewImageSettings';
import PreviewImageExport from './PreviewImageExport';
import usePreviewImageDrag from './usePreviewImageDrag';
import { hasFileDrag, readDroppedFiles } from './tools/ImageTools/previewImageDragData.mjs';

const SlideUp = React.forwardRef(function SlideUp(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

/** 历史条和历史窗口共用缩略图与长按拖拽；视频仍使用静态封面。 */
function HistoryThumbnail({ item, alt, fit, privacyMode, privacyReveal, drag, onSelect }) {
  const { t } = useI18n();
  const imageDrag = privacyMode ? null : drag;
  return <>
    <Box component="img" data-private-image
      data-history-image-drag={imageDrag ? (imageDrag.armedMode ? 'ready' : 'idle') : undefined}
      src={item.type === 'video' ? item.coverImage : item.src} alt={alt}
      draggable={Boolean(imageDrag?.armedMode)}
      onPointerDown={imageDrag?.onPointerDown} onDragStart={imageDrag?.onDragStart} onDragEnd={imageDrag?.onDragEnd}
      onContextMenu={imageDrag ? (event) => event.preventDefault() : undefined}
      sx={{ height: '100%', width: '100%', display: 'block', objectFit: fit, cursor: imageDrag?.armedMode ? 'grabbing' : undefined }} />
    {privacyMode && <ImagePrivacyCover mode={privacyReveal} imageDrag={drag} />}
    {privacyMode && privacyReveal === 'toggle' && <Tooltip title={t('painting.workspace.gallery.selectPreview')}>
      <IconButton size="small" aria-label={t('painting.workspace.gallery.selectPreview')}
        onClick={(event) => { event.stopPropagation(); onSelect(); }}
        sx={{
          position: 'absolute', top: 3, left: 3, zIndex: 2, color: 'white', bgcolor: 'rgba(0,0,0,0.62)',
          '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' },
        }}>
        <VisibilityOutlined sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>}
  </>;
}

/**
 * 获取生成项目的 Seed，优先使用图片元数据，缺失时回退到轮询结果保存的 Seed。
 *
 * Args:
 *   item: 当前生成的图片或视频项目。
 *   metadata: 与当前图片来源绑定的已解析元数据。
 *
 * Returns:
 *   string: 可展示和复制的 Seed；无可用值时为空字符串。
 *
 * @param {object|null} item - 当前生成的图片或视频项目。
 * @param {object|null} metadata - 与当前图片来源绑定的已解析元数据。
 * @returns {string} 返回可展示和复制的 Seed；无可用值时返回空字符串。
 */
const getGeneratedItemSeed = (item, metadata) => {
  const metadataSeed = metadata?.seed;
  if (metadataSeed !== undefined && metadataSeed !== null && metadataSeed !== '') {
    return String(metadataSeed);
  }

  const resultSeed = item?.seed;
  if (resultSeed !== undefined && resultSeed !== null && resultSeed !== '') {
    return String(resultSeed);
  }

  return '';
};

const ItemPreview = ({
  items,
  currentItemId,
  onSelectItem,
  onDeleteItem,
  onSeedCopyAndApply,
  onUseItemMetadata,
  previewSettings,
  getPreviewFile,
  getItemPreviewFile,
  quickImagePresets,
  onPreviewSettingsChange,
  onImportImages,
  onAdjustImage,
  adjustmentActive,
  onExerciseAction,
}) => {
  const { t } = useI18n();
  const publicDemo = useContext(PublicDemoContext);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const scrollContainerRef = useRef(null);
  const selectedItemRef = useRef(null);
  const selectedGalleryItemRef = useRef(null);
  const closeHistoryRef = useRef(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const hasHistory = items.length > 0;
  const historyHidden = !isMobile && historyCollapsed;
  const [notice, setNotice] = useState(null);
  const [historyDropActive, setHistoryDropActive] = useState(false);
  const historyPrivacy = previewSettings.privacyMode && previewSettings.privacyScope !== 'display';
  const currentItem = items.find((item) => item.id === currentItemId) || null;
  const currentItemMetadata = currentItem?.metadataStatus === 'ready' && currentItem?.metadataSource === currentItem?.src
    ? currentItem.metadata
    : null;
  const currentSeed = getGeneratedItemSeed(currentItem, currentItemMetadata);
  const showActionText = !isMobile;
  const historyDropHandlers = (region) => ({
    'data-drop-zone': '',
    onDragOver: (event) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setHistoryDropActive(region);
    },
    onDragLeave: (event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setHistoryDropActive(false);
    },
    onDrop: (event) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      setHistoryDropActive(false);
      if (!historyDrag.isDragging()) void onImportImages(readDroppedFiles(event.dataTransfer));
    },
  });

  const getItemBlob = useCallback(async (item) => {
    if (!item) {
      throw new Error('ITEM_REQUIRED');
    }

    if (item.cachedBlob) {
      return item.cachedBlob;
    }

    return fetchUrlAsBlob(item.downloadSrc || item.originalSrc || item.src);
  }, []);

  const showExportNotice = (message, severity) => setNotice({ message, severity });
  const historyDrag = usePreviewImageDrag({
    enabled: !publicDemo && hasHistory && previewSettings.historyImageDrag,
    getFile: getItemPreviewFile,
    privacyMode: historyPrivacy,
    onError: (error) => {
      const key = ['invalidCustomMetadata', 'imageTooLarge'].includes(error.message) ? error.message : 'copyExportFailed';
      showExportNotice(t(`painting.workspace.gallery.${key}`), 'error');
    },
  });

  function dragForThumbnail(item) {
    if (publicDemo || !previewSettings.historyImageDrag || item.type === 'video') return null;
    const mode = previewSettings.copyMode;
    return {
      armedMode: historyDrag.armedItemId === item.id ? historyDrag.armedMode : null,
      onPointerDown: (event) => historyDrag.onPointerDown(event, mode, item),
      onDragStart: (event) => historyDrag.onDragStart(event, mode, item),
      onDragEnd: historyDrag.onDragEnd,
    };
  }

  const downloadItem = useCallback(async (item) => {
    if (!item) return;

    const settings = getImageSettings();
    const fileName = generateFileName(item, settings, {
      extension: item.type === 'video' ? 'mp4' : 'png',
      fallbackName: item.seed || item.id || Date.now(),
    });

    if (item.cachedBlob) {
      await downloadBlobToFile(item.cachedBlob, fileName);
      return;
    }

    await downloadUrlToFile(item.downloadSrc || item.originalSrc || item.src, fileName);
  }, []);

  const renderActionControl = ({ key, label, icon, onClick, color = 'inherit', disabled = false }) => {
    disabled = disabled || (publicDemo && ['download-item', 'copy-image'].includes(key));
    if (showActionText) {
      return (
        <Button
          data-tour={key} key={key}
          size="small"
          color={color === 'error' ? 'error' : 'inherit'}
          variant="text"
          startIcon={icon}
          onClick={onClick}
          disabled={disabled}
          sx={{
            minWidth: 0,
            px: 1,
            py: 0.5,
            borderRadius: 1.25,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            color: color === 'error' ? theme.palette.error.main : theme.palette.text.secondary,
            '&:hover': {
              bgcolor: alpha(color === 'error' ? theme.palette.error.main : theme.palette.primary.main, 0.08),
            },
          }}
        >
          {label}
        </Button>
      );
    }

    return (
      <Tooltip key={key} title={label} arrow placement="top">
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <IconButton
            data-tour={key} aria-label={label}
            size="small"
            color={color === 'error' ? 'error' : 'default'}
            onClick={onClick}
            disabled={disabled}
            sx={{
              width: 36,
              height: 36,
              color: color === 'error' ? theme.palette.error.main : theme.palette.text.secondary,
            }}
          >
            {icon}
          </IconButton>
        </span>
      </Tooltip>
    );
  };

  const handleDownloadSingle = useCallback(async (e, item) => {
    e.stopPropagation();
    void downloadItem(item);
  }, [downloadItem]);

  const handleDownloadAll = useCallback(async () => {
    const zip = new JSZip();
    const folder = zip.folder('generated_items');
    const usedNames = new Set();
    const settings = getImageSettings();

    for (const [index, item] of items.entries()) {
      const blob = await getItemBlob(item);
      const baseFileName = generateFileName(item, settings, {
        extension: item.type === 'video' ? 'mp4' : 'png',
        fallbackName: item.seed || item.id || index,
      });
      const dotIndex = baseFileName.lastIndexOf('.');
      const namePart = dotIndex > 0 ? baseFileName.slice(0, dotIndex) : baseFileName;
      const extension = dotIndex > 0 ? baseFileName.slice(dotIndex) : '';
      let fileName = baseFileName;
      let duplicateIndex = 2;

      // 批量下载时同一提示词或同一种子可能生成重名文件，需要在 zip 内保持唯一。
      while (usedNames.has(fileName)) {
        fileName = `${namePart}_${duplicateIndex}${extension}`;
        duplicateIndex += 1;
      }
      usedNames.add(fileName);
      folder.file(fileName, blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'AI_Generated_Items.zip');
  }, [getItemBlob, items]);

  const handleClearAll = useCallback(() => {
    closeHistoryRef.current?.focus();
    [...items].reverse().forEach((item) => onDeleteItem(item.id));
  }, [items, onDeleteItem]);

  // 滚动处理
  const scrollLeft = () => {
    scrollContainerRef.current?.scrollBy({ left: -(scrollContainerRef.current.clientWidth * 0.75), behavior: 'smooth' });
  };

  const scrollRight = () => {
    scrollContainerRef.current?.scrollBy({ left: scrollContainerRef.current.clientWidth * 0.75, behavior: 'smooth' });
  };

  const handleWheel = (e) => {
    if (scrollContainerRef.current) {
      e.preventDefault();
      scrollContainerRef.current.scrollBy({ left: e.deltaY > 0 ? 60 : -60, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [hasHistory]);

  useEffect(() => {
    if (previewSettings.historyFollowSelection && selectedItemRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const el = selectedItemRef.current;
      const cRect = container.getBoundingClientRect();
      const sRect = el.getBoundingClientRect();
      if (sRect.left < cRect.left || sRect.right > cRect.right) {
        container.scrollBy({
          left: sRect.left - cRect.left - cRect.width / 2 + sRect.width / 2,
          behavior: 'smooth',
        });
      }
    }
  }, [currentItemId, historyHidden, items.length, previewSettings.historyFollowSelection]);

  useEffect(() => {
    if (galleryOpen && previewSettings.historyFollowSelection) selectedGalleryItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [galleryOpen, currentItemId, previewSettings.historyFollowSelection]);

  const seedControl = currentSeed && (
    <Tooltip title={t('painting.workspace.gallery.seedApplyHelp')} arrow placement="top">
      <IconButton
        color="primary"
        size="small"
        aria-label={t('painting.workspace.gallery.seedApplyHelp')}
        data-tour="applySeed" onClick={() => { void onSeedCopyAndApply(currentSeed); }}
        sx={{
          width: { xs: 36, md: 32 },
          height: { xs: 36, md: 32 },
          flexShrink: 0,
        }}
      ><Sprout size={20} aria-hidden="true" /></IconButton>
    </Tooltip>
  );

  return (
    <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, flexShrink: 0 }}>
      <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice(null)}>
        {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.message}</Alert>}
      </Snackbar>
      <Box id="generation-history" hidden={historyHidden}
        {...(!historyHidden && !publicDemo ? historyDropHandlers('strip') : {})}
        sx={{
          height: { xs: 64, sm: 72, md: 80 }, borderRadius: 1,
          outline: historyDropActive === 'strip' ? '2px dashed' : undefined,
          outlineColor: 'primary.main', outlineOffset: '-3px',
          bgcolor: historyDropActive === 'strip' ? 'action.hover' : undefined,
        }}>
      {!hasHistory && !publicDemo && <Stack direction="row" alignItems="center" justifyContent="center" gap={0.75}
        sx={{ height: '100%', color: 'text.secondary' }}>
        <FileUploadOutlined fontSize="small" />
        <Typography variant="caption">{t('painting.workspace.gallery.dropHistoryImages')}</Typography>
      </Stack>}
      {hasHistory && (
        <Box
          ref={scrollContainerRef}
          sx={{
            height: '100%',
            width: '100%',
            minWidth: 0,
            flex: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-track': { bgcolor: theme.palette.action.hover, borderRadius: 3 },
            '&::-webkit-scrollbar-thumb': { bgcolor: theme.palette.action.selected, borderRadius: 3, '&:hover': { bgcolor: theme.palette.action.focus } },
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ height: '100%', py: { xs: 0.5, md: 1 }, px: 0.5, display: 'inline-flex', minWidth: 'fit-content' }}
          >
            {/* 左导航 */}
            <Box sx={{ position: 'sticky', left: 0, zIndex: 2, display: 'flex', alignItems: 'center', pr: 0.5 }}>
              <IconButton
                aria-label={t('painting.workspace.gallery.scrollLeft')}
                size="small"
                onClick={scrollLeft}
                sx={{ color: theme.palette.text.primary, bgcolor: alpha(theme.palette.background.paper, 0.3), '&:hover': { bgcolor: alpha(theme.palette.background.paper, 0.5) } }}
              >
                <LeftIcon />
              </IconButton>
            </Box>

            {items.map((item) => (
              <Paper
                key={item.id}
                ref={currentItemId === item.id ? selectedItemRef : null}
                elevation={0}
                onClick={(event) => {
                  if (!event.detail || !historyDrag.wasHeld(item)) onSelectItem(item.id);
                }}
                sx={{
                  position: 'relative',
                  ...imagePrivacySx,
                  // 缩略图不随容器高度拉伸，横图、竖图都占用同样的正方形。
                  height: { xs: 56, sm: 64 },
                  width: { xs: 56, sm: 64 },
                  boxSizing: 'border-box',
                  flexShrink: 0,
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  border: currentItemId === item.id
                    ? `2px solid ${theme.palette.primary.main}`
                    : `1px solid ${theme.palette.divider}`,
                  '&:hover': { borderColor: theme.palette.primary.light },
                }}
              >
                <HistoryThumbnail item={item} fit="cover" alt={t('painting.workspace.gallery.previewImageAlt', { id: item.id })}
                  privacyMode={historyPrivacy} privacyReveal={previewSettings.privacyReveal}
                  drag={dragForThumbnail(item)} onSelect={() => onSelectItem(item.id)} />

                {item.type === 'video' && (
                  <Box sx={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    color: 'white', bgcolor: 'rgba(0,0,0,0.5)', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                  }}>
                    <PlayIcon fontSize="large" />
                  </Box>
                )}

              </Paper>
            ))}

            {/* 右导航 */}
            <Box sx={{ position: 'sticky', right: 0, zIndex: 2, display: 'flex', alignItems: 'center', pl: 0.5 }}>
              <IconButton
                aria-label={t('painting.workspace.gallery.scrollRight')}
                size="small"
                onClick={scrollRight}
                sx={{ color: theme.palette.text.primary, bgcolor: alpha(theme.palette.background.paper, 0.3), '&:hover': { bgcolor: alpha(theme.palette.background.paper, 0.5) } }}
              >
                <RightIcon />
              </IconButton>
            </Box>
          </Stack>
        </Box>
      )}
      </Box>

      <Box
          sx={{
            flexShrink: 0,
            mt: historyHidden ? 0 : { xs: 0.25, md: 0.5 },
            px: { xs: 0, md: 0.75 },
            py: { xs: 0, md: 0.5 },
            borderTop: historyHidden ? 0 : `1px solid ${theme.palette.divider}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: { xs: 0.5, md: 1 },
            minWidth: 0,
          }}
        >
          {!isMobile && (
            <Tooltip title={t(historyHidden ? 'painting.workspace.gallery.expandHistory' : 'painting.workspace.gallery.collapseHistory')} arrow>
              <IconButton
                size="small"
                aria-label={t(historyHidden ? 'painting.workspace.gallery.expandHistory' : 'painting.workspace.gallery.collapseHistory')}
                aria-expanded={!historyHidden}
                aria-controls="generation-history"
                onClick={() => setHistoryCollapsed((collapsed) => !collapsed)}
                sx={{ color: 'text.secondary', flexShrink: 0 }}
              >
                {historyHidden ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
          <PreviewImageSettings onExerciseAction={onExerciseAction} settings={previewSettings} onChange={onPreviewSettingsChange} presets={quickImagePresets}
            getCurrentImage={currentItem && currentItem.type !== 'video' ? () => getItemBlob(currentItem) : undefined} />
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, pr: 0.5, borderRight: `1px solid ${theme.palette.divider}` }}>
              <Tooltip title={t('gallery.sessionHistory')} arrow>
                <IconButton
                  size="small"
                  aria-label={t('gallery.sessionHistory')}
                  data-tour="historyOpen" onClick={() => { setGalleryOpen(true); onExerciseAction?.('historyOpen'); }}
                  sx={{ color: 'text.secondary', width: { xs: 36, md: 32 }, height: { xs: 36, md: 32 } }}
                >
                  <HistoryIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {previewSettings.showAdjustmentEntry && onAdjustImage && <Tooltip title={t('painting.workspace.adjustment.title')} arrow>
                <IconButton size="small" aria-label={t('painting.workspace.adjustment.title')}
                  aria-pressed={adjustmentActive} onClick={onAdjustImage}
                  sx={{ color: adjustmentActive ? 'primary.main' : 'text.secondary', width: { xs: 36, md: 32 }, height: { xs: 36, md: 32 } }}>
                  <TuneIcon fontSize="small" />
                </IconButton>
              </Tooltip>}
              {previewSettings.showGalleryEntry && <Tooltip title={t('painting.workspace.gallery.openGallery')} arrow>
                <span><IconButton
                  size="small"
                  aria-label={t('painting.workspace.gallery.openGallery')}
                  disabled={publicDemo} onClick={() => window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: 'generation-gallery' }))}
                  sx={{ color: 'text.secondary', width: { xs: 36, md: 32 }, height: { xs: 36, md: 32 } }}
                >
                  <CollectionsIcon fontSize="small" />
                </IconButton></span>
              </Tooltip>}
            </Box>
          {currentItem ? <>
          <Stack
            direction="row"
            spacing={showActionText ? 0.5 : 0}
            alignItems="center"
            sx={{
              minWidth: 0,
              flex: 1,
              overflowX: 'auto',
              overflowY: 'hidden',
              '&::-webkit-scrollbar': { display: 'none' },
              scrollbarWidth: 'none',
            }}
          >
            {/* 视频也使用默认预览区操作栏，避免必须打开图库才能删除当前视频。 */}
            {currentItemMetadata && renderActionControl({
              key: 'use-params',
              label: t('painting.workspace.gallery.useParameters'),
              icon: <TuneIcon sx={{ fontSize: 18 }} />,
              onClick: () => { void onUseItemMetadata(currentItem); },
            })}
            {currentItem.type === 'video' ? renderActionControl({
              key: 'download-item',
              label: t('painting.workspace.gallery.downloadVideo'),
              icon: <DownloadIcon sx={{ fontSize: 18 }} />,
              onClick: () => { void downloadItem(currentItem); },
            }) : ['copy', 'download'].map((action) => (
              <PreviewImageExport key={`${currentItem.id}:${action}`} action={action} getFile={getPreviewFile}
                defaultMode={previewSettings[`${action}Mode`]} disabled={publicDemo} showText={showActionText}
                onNotice={showExportNotice} privacyMode={historyPrivacy} />
            ))}
          </Stack>
          {seedControl}
          <Box sx={{ display: 'flex', flexShrink: 0, ml: 0.5, pl: 0.5, borderLeft: `1px solid ${theme.palette.divider}` }}>
            {renderActionControl({
              key: 'delete-item',
              label: currentItem.type === 'video'
                ? t('painting.workspace.gallery.deleteVideo')
                : t('painting.workspace.gallery.deleteImage'),
              icon: <DeleteIcon sx={{ fontSize: 18 }} />,
              onClick: () => onDeleteItem(currentItem.id),
              color: 'error',
            })}
          </Box>
          </> : <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{t('painting.workspace.gallery.noHistoryImages')}</Typography>}
      </Box>

      {/* 图库展开面板 */}
      <Dialog
        open={galleryOpen}
        data-drop-zone
        onClose={() => { setGalleryOpen(false); setHistoryDropActive(false); }}
        onDrop={(event) => { if (hasFileDrag(event.dataTransfer)) event.preventDefault(); }}
        TransitionComponent={SlideUp}
        maxWidth="md"
        fullWidth
        PaperProps={{
          ...(!publicDemo && galleryOpen ? historyDropHandlers('gallery') : {}),
          'data-history-dialog': true,
          sx: {
            borderRadius: 3,
            maxHeight: '80vh',
            bgcolor: theme.palette.background.default,
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <HistoryIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              {t('gallery.sessionHistory')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('painting.workspace.gallery.itemCount', { count: items.length })}
            </Typography>
          </Stack>
          <IconButton ref={closeHistoryRef} data-tour="dialogClose" aria-label={t('painting.workspace.gallery.closeGallery')} onClick={() => setGalleryOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{
            p: 2, minHeight: 180, position: 'relative',
            outline: historyDropActive === 'gallery' ? '2px dashed' : undefined, outlineColor: 'primary.main', outlineOffset: '-5px',
            bgcolor: historyDropActive === 'gallery' ? 'action.hover' : undefined,
          }}>
          {!hasHistory && <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 144, color: 'text.secondary' }}>
            <FileUploadOutlined />
            <Typography variant="body2">{t(publicDemo ? 'painting.workspace.gallery.noHistoryImages' : 'painting.workspace.gallery.dropHistoryImages')}</Typography>
          </Stack>}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
              gap: '12px',
            }}
          >
            {items.map((item, index) => {
              const itemMetadata = item.metadataStatus === 'ready' && item.metadataSource === item.src
                ? item.metadata
                : null;
              const itemSeed = getGeneratedItemSeed(item, itemMetadata);

              return (
                <Box
                  key={item.id}
                  ref={currentItemId === item.id ? selectedGalleryItemRef : null}
                  aria-current={currentItemId === item.id ? 'true' : undefined}
                  sx={{
                    position: 'relative',
                    ...imagePrivacySx,
                    borderRadius: 2,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    aspectRatio: '1 / 1',
                    minWidth: 0,
                    bgcolor: alpha(theme.palette.common.black, 0.04),
                    border: currentItemId === item.id
                      ? `2px solid ${theme.palette.primary.main}`
                      : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                    transition: 'all 0.2s ease',
                    '&:hover': !isMobile ? {
                      boxShadow: theme.shadows[6],
                      '& .gallery-overlay': { opacity: 1 },
                    } : undefined,
                  }}
                  onClick={(event) => {
                    if (event.detail && historyDrag.wasHeld(item)) return;
                    onSelectItem(item.id);
                    setGalleryOpen(false);
                  }}
                >
                {item.type === 'video' ? (
                  <Box sx={{ position: 'relative', width: '100%', height: '100%', ...imagePrivacySx }}>
                    <HistoryThumbnail item={item} fit="contain" alt={t('painting.workspace.gallery.galleryItemAlt', { index: index + 1 })}
                      privacyMode={historyPrivacy} privacyReveal={previewSettings.privacyReveal}
                      onSelect={() => { onSelectItem(item.id); setGalleryOpen(false); }} />
                    <Box sx={{
                      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                      color: 'white', bgcolor: 'rgba(0,0,0,0.5)', borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                    }}>
                      <PlayIcon sx={{ fontSize: 40 }} />
                    </Box>
                  </Box>
                ) : (
                  <HistoryThumbnail item={item} fit={previewSettings.historyImageFit} alt={t('painting.workspace.gallery.galleryItemAlt', { index: index + 1 })}
                    privacyMode={historyPrivacy} privacyReveal={previewSettings.privacyReveal}
                    drag={dragForThumbnail(item)} onSelect={() => { onSelectItem(item.id); setGalleryOpen(false); }} />
                )}

                {/* 悬停操作层 */}
                <Box
                  className="gallery-overlay"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 2,
                    pointerEvents: 'none',
                    '& button': { pointerEvents: 'auto' },
                    opacity: isMobile ? 1 : 0,
                    transition: 'opacity 0.2s',
                    background: `linear-gradient(to bottom, ${alpha('#000', isMobile ? 0.28 : 0.5)} 0%, transparent 40%, transparent 60%, ${alpha('#000', isMobile ? 0.28 : 0.4)} 100%)`,
                  }}
                >
                  {/* 右上角删除 */}
                  <Tooltip title={t('painting.workspace.gallery.delete')} arrow placement="left">
                    <IconButton
                      aria-label={t('painting.workspace.gallery.delete')}
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeHistoryRef.current?.focus();
                        onDeleteItem(item.id);
                      }}
                      sx={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        color: 'white',
                        bgcolor: alpha(theme.palette.error.main, 0.7),
                        '&:hover': { bgcolor: theme.palette.error.main },
                        p: 0.5,
                      }}
                    >
                      <DeleteIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>

                  {item.type !== 'video' && itemMetadata && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<TuneIcon sx={{ fontSize: 14 }} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onUseItemMetadata(item);
                      }}
                      sx={{
                        position: 'absolute',
                        left: 8,
                        bottom: 34,
                        minWidth: 0,
                        px: 1,
                        py: 0.25,
                        fontSize: '0.7rem',
                        lineHeight: 1.2,
                        bgcolor: alpha(theme.palette.primary.main, 0.88),
                        color: theme.palette.primary.contrastText,
                        '&:hover': {
                          bgcolor: theme.palette.primary.main,
                        },
                        '& .MuiButton-startIcon': {
                          mr: 0.4,
                        },
                      }}
                    >
                      {t('painting.workspace.gallery.useParameters')}
                    </Button>
                  )}

                  {/* 底部信息和下载 */}
                  <Stack
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, px: 1, py: 0.5 }}
                  >
                    <Typography variant="caption" sx={{ color: 'white', opacity: 0.9 }} noWrap>
                      {itemSeed ? `seed: ${itemSeed}` : ''}
                    </Typography>
                    <Tooltip title={t('painting.workspace.gallery.download')} arrow placement="top">
                      <span style={{ display: 'inline-flex' }}><IconButton
                        aria-label={t('painting.workspace.gallery.download')}
                        size="small"
                        disabled={publicDemo} onClick={(e) => handleDownloadSingle(e, item)}
                        sx={{ color: 'white', p: 0.4, '&:hover': { bgcolor: alpha('#fff', 0.2) } }}
                      >
                        <DownloadIcon sx={{ fontSize: 18 }} />
                      </IconButton></span>
                    </Tooltip>
                  </Stack>
                </Box>
                </Box>
              );
            })}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 2, py: 1.5, justifyContent: 'space-between' }}>
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<DeleteSweepIcon />}
            disabled={!hasHistory}
            onClick={handleClearAll}
          >
            {t('painting.workspace.gallery.clearAll')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<ArchiveIcon />}
            disabled={publicDemo || !hasHistory} onClick={handleDownloadAll}
          >
            {t('painting.workspace.gallery.downloadAllArchive')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ItemPreview;
