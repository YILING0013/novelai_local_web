// ItemPreview.js
"use client";

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
  Stack,
  Paper,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slide,
  useMediaQuery,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  KeyboardArrowLeft as LeftIcon,
  KeyboardArrowRight as RightIcon,
  Collections as CollectionsIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  DeleteSweep as DeleteSweepIcon,
  Close as CloseIcon,
  Archive as ArchiveIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  createObjectUrlFromBlob,
  downloadBlobToFile,
  downloadUrlToFile,
  fetchUrlAsBlob,
  revokeObjectUrl,
} from '@/utils/mediaAssets';
import { generateFileName, getImageSettings } from './tools/ImageTools/ImageSaveUtils';
import { useI18n } from '@/i18n/I18nProvider';

const SlideUp = React.forwardRef(function SlideUp(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

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
}) => {
  const { t } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const scrollContainerRef = useRef(null);
  const selectedItemRef = useRef(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [copyingId, setCopyingId] = useState(null);
  const currentItem = items.find((item) => item.id === currentItemId) || null;
  const currentItemMetadata = currentItem?.metadataStatus === 'ready' && currentItem?.metadataSource === currentItem?.src
    ? currentItem.metadata
    : null;
  const currentSeed = getGeneratedItemSeed(currentItem, currentItemMetadata);
  const formattedSeed = currentSeed.length > 9
    ? `${currentSeed.slice(0, 3)}...${currentSeed.slice(-3)}`
    : currentSeed;
  const showActionText = !isMobile;

  const getItemBlob = useCallback(async (item) => {
    if (!item) {
      throw new Error('ITEM_REQUIRED');
    }

    if (item.cachedBlob) {
      return item.cachedBlob;
    }

    return fetchUrlAsBlob(item.downloadSrc || item.originalSrc || item.src);
  }, []);

  const copyImageToClipboard = useCallback(async (item) => {
    if (!item) return;

    setCopyingId(item.id);
    try {
      const blob = await getItemBlob(item);
      const pngBlob = blob.type === 'image/png'
        ? blob
        : await new Promise((resolve, reject) => {
            const img = new Image();
            const temporaryUrl = createObjectUrlFromBlob(blob);

            if (!temporaryUrl) {
              reject(new Error('COPY_PREVIEW_UNAVAILABLE'));
              return;
            }

            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              canvas.toBlob((pngResult) => {
                revokeObjectUrl(temporaryUrl);
                if (pngResult) {
                  resolve(pngResult);
                  return;
                }

                reject(new Error('PNG_CONVERSION_FAILED'));
              }, 'image/png');
            };
            img.onerror = () => {
              revokeObjectUrl(temporaryUrl);
              reject(new Error('IMAGE_READ_FAILED'));
            };
            img.src = temporaryUrl;
          });
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob }),
      ]);
    } catch {
      // silent fail
    } finally {
      setCopyingId(null);
    }
  }, [getItemBlob]);

  const downloadItem = useCallback(async (item) => {
    if (!item) return;

    const settings = getImageSettings();
    const fileName = generateFileName(item, settings, {
      extension: 'png',
      fallbackName: item.seed || item.id || Date.now(),
    });

    if (item.cachedBlob) {
      await downloadBlobToFile(item.cachedBlob, fileName);
      return;
    }

    await downloadUrlToFile(item.downloadSrc || item.originalSrc || item.src, fileName);
  }, []);

  const renderActionControl = ({ key, label, icon, onClick, color = 'inherit', disabled = false }) => {
    if (showActionText) {
      return (
        <Button
          key={key}
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
        <span>
          <IconButton
            aria-label={label}
            size="small"
            color={color === 'error' ? 'error' : 'default'}
            onClick={onClick}
            disabled={disabled}
            sx={{
              color: color === 'error' ? theme.palette.error.main : theme.palette.text.secondary,
            }}
          >
            {icon}
          </IconButton>
        </span>
      </Tooltip>
    );
  };

  const handleCopyImage = useCallback(async (e, item) => {
    e.stopPropagation();
    await copyImageToClipboard(item);
  }, [copyImageToClipboard]);

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
        extension: 'png',
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
  }, []);

  useEffect(() => {
    if (selectedItemRef.current && scrollContainerRef.current) {
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
  }, [currentItemId]);

  return (
    <Box sx={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {items.length > 0 ? (
        <Box
          ref={scrollContainerRef}
          sx={{
            flex: 1,
            minHeight: 0,
            width: '100%',
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
            sx={{ height: '100%', py: 1, px: 0.5, display: 'inline-flex', minWidth: 'fit-content' }}
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
                onClick={() => onSelectItem(item)}
                sx={{
                  position: 'relative',
                  height: '100%',
                  width: { xs: 56, sm: 80, md: 110 },
                  flexShrink: 0,
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  border: currentItemId === item.id
                    ? `2px solid ${theme.palette.primary.main}`
                    : `1px solid ${theme.palette.divider}`,
                  transform: currentItemId === item.id ? 'scale(1.05)' : 'scale(1)',
                  '&:hover': { transform: 'scale(1.05)', borderColor: theme.palette.primary.light },
                }}
              >
                <Box
                  component="img"
                  src={item.src}
                  alt={t('painting.workspace.gallery.previewImageAlt', { id: item.id })}
                  sx={{ height: '100%', width: '100%', objectFit: 'cover' }}
                />

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
      ) : (
        <Box sx={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: theme.palette.text.secondary, p: 1 }}>
          <Typography variant="body2">{t('painting.workspace.gallery.previewEmpty')}</Typography>
        </Box>
      )}

      {currentItem && (
        <Box
          sx={{
            flexShrink: 0,
            mt: 0.5,
            px: 0.75,
            py: 0.5,
            borderTop: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            bgcolor: alpha(theme.palette.primary.main, 0.05),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
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
            {currentItemMetadata && renderActionControl({
              key: 'use-params',
              label: t('painting.workspace.gallery.useParameters'),
              icon: <TuneIcon sx={{ fontSize: 18 }} />,
              onClick: () => { void onUseItemMetadata(currentItem); },
            })}
            {renderActionControl({
              key: 'copy-image',
              label: t('painting.workspace.gallery.copyImage'),
              icon: <CopyIcon sx={{ fontSize: 18 }} />,
              onClick: () => { void copyImageToClipboard(currentItem); },
              disabled: copyingId === currentItem.id,
            })}
            {renderActionControl({
              key: 'download-item',
              label: t('painting.workspace.gallery.downloadImage'),
              icon: <DownloadIcon sx={{ fontSize: 18 }} />,
              onClick: () => { void downloadItem(currentItem); },
            })}
            {renderActionControl({
              key: 'delete-item',
              label: t('painting.workspace.gallery.deleteImage'),
              icon: <DeleteIcon sx={{ fontSize: 18 }} />,
              onClick: () => onDeleteItem(currentItem.id),
              color: 'error',
            })}
          </Stack>
          {currentSeed && (
            <Tooltip title={t('painting.workspace.gallery.seedApplyHelp')} arrow placement="top">
              <Chip
                clickable
                color="primary"
                variant="outlined"
                size="small"
                label={`Seed ${formattedSeed}`}
                onClick={() => {
                  void onSeedCopyAndApply(currentSeed);
                }}
                sx={{
                  ml: 'auto',
                  flexShrink: 0,
                  fontWeight: 600,
                  '& .MuiChip-label': {
                    px: 1.25,
                  },
                }}
              />
            </Tooltip>
          )}
        </Box>
      )}

      {/* 图库按钮 */}
      {items.length > 0 && (
        <Tooltip title={t('painting.workspace.gallery.openGallery')} arrow placement="top">
          <IconButton
            aria-label={t('painting.workspace.gallery.openGallery')}
            onClick={() => setGalleryOpen(true)}
            sx={{
              position: 'absolute',
              right: -4,
              top: -4,
              color: 'white',
              bgcolor: alpha(theme.palette.primary.main, 0.85),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
              '&:hover': { bgcolor: theme.palette.primary.main },
              zIndex: 10,
            }}
            size="small"
          >
            <CollectionsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      {/* 图库展开面板 */}
      <Dialog
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        TransitionComponent={SlideUp}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            maxHeight: '80vh',
            bgcolor: theme.palette.background.default,
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CollectionsIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              {t('painting.workspace.gallery.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('painting.workspace.gallery.itemCount', { count: items.length })}
            </Typography>
          </Stack>
          <IconButton aria-label={t('painting.workspace.gallery.closeGallery')} onClick={() => setGalleryOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ p: 2 }}>
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
                  sx={{
                    position: 'relative',
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
                  onClick={() => {
                    onSelectItem(item);
                    setGalleryOpen(false);
                  }}
                >
                <Box
                  component="img"
                  src={item.src}
                  alt={t('painting.workspace.gallery.galleryItemAlt', { index: index + 1 })}
                  sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
                />

                {/* 悬停操作层 */}
                <Box
                  className="gallery-overlay"
                  sx={{
                    position: 'absolute',
                    inset: 0,
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

                  {itemMetadata && (
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
                      <IconButton
                        aria-label={t('painting.workspace.gallery.download')}
                        size="small"
                        onClick={(e) => handleDownloadSingle(e, item)}
                        sx={{ color: 'white', p: 0.4, '&:hover': { bgcolor: alpha('#fff', 0.2) } }}
                      >
                        <DownloadIcon sx={{ fontSize: 18 }} />
                      </IconButton>
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
            onClick={handleClearAll}
          >
            {t('painting.workspace.gallery.clearAll')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<ArchiveIcon />}
            onClick={handleDownloadAll}
          >
            {t('painting.workspace.gallery.downloadAllArchive')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ItemPreview;
