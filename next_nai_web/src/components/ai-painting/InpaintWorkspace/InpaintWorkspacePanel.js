"use client";

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  ClickAwayListener,
  FormControlLabel,
  IconButton,
  Paper,
  Popper,
  Slider,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AddPhotoAlternate as AddPhotoAlternateIcon,
  BlurOn as BlurOnIcon,
  Collections as CollectionsIcon,
  DeleteSweep as DeleteSweepIcon,
  FileDownload as FileDownloadIcon,
  FitScreen as FitScreenIcon,
  ImageOutlined as ImageOutlinedIcon,
  Image as ImageIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Preview as PreviewIcon,
  Redo as RedoIcon,
  Tune as TuneIcon,
  Undo as UndoIcon,
} from '@mui/icons-material';
import { saveAs } from 'file-saver';
import InpaintControls from './InpaintControls';
import InpaintSourcePicker from './InpaintSourcePicker';
import {
  clamp,
  createInitialViewportRect,
  fitSceneToStage,
  getAspectRatio,
  moveViewportRect,
  normalizeViewportRect,
  pointInRect,
  resizeViewportRect,
  scaleRectAroundPoint,
  screenRectToWorldRect,
  screenToWorldPoint,
  snapWorldRectToContent,
  worldRectToScreenRect,
} from '../tools/InpaintTools/workspaceMath';
import {
  createFeatheredPatchCanvas,
  cropWorldRectToDataUrl,
  worldRectHasVisibleContent,
  dataUrlToBlob,
  exportContentCanvas,
  extractMaskedPatchCanvas,
  getCanvasAlphaBounds,
  loadImageElement,
  mergePatchIntoContentCanvas,
} from '../tools/InpaintTools/exportUtils';
import { createInpaintMaskCanvas, createInpaintMaskData } from '../tools/InpaintTools/maskUtils';
import { useI18n } from '@/i18n/I18nProvider';

const DESKTOP_DEFAULT_MODE = 'paint';
const MOBILE_DEFAULT_MODE = 'move-scene';
const HISTORY_LIMIT = 60;
const HISTORY_COMMIT_DELAY = 200;
const PATCH_MASK_OUTWARD_FEATHER_PIXELS = 8;
const MASK_DRAW_TARGET = 'mask';
const IMAGE_DRAW_TARGET = 'image';
// 预览蒙版用于确认最终送入后端的遮罩区域，需要绕过编辑态透明度并完整显色。
const MASK_PREVIEW_OPACITY = 1;

const createOffscreenCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const createMaskPreviewCanvas = (maskCanvas, previewColor = '#ffffff') => {
  const previewCanvas = createOffscreenCanvas(maskCanvas.width, maskCanvas.height);
  const previewCtx = previewCanvas.getContext('2d');
  previewCtx.fillStyle = previewColor;
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.globalCompositeOperation = 'destination-in';
  previewCtx.drawImage(maskCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.globalCompositeOperation = 'source-over';
  return previewCanvas;
};

const areRectsEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
};

const areSceneTransformsEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.scale === right.scale &&
    left.offsetX === right.offsetX &&
    left.offsetY === right.offsetY
  );
};

const PENDING_PATCH_BAR_HEIGHT = 52;
const PENDING_PATCH_BAR_MARGIN = 12;

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const configureStageCanvas = (canvas, width, height) => {
  if (!canvas || !width || !height) {
    return null;
  }

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== pixelWidth) {
    canvas.width = pixelWidth;
  }
  if (canvas.height !== pixelHeight) {
    canvas.height = pixelHeight;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
};

const cloneStroke = (stroke) => ({
  ...stroke,
  points: stroke.points ? stroke.points.map((point) => ({ ...point })) : undefined,
  rect: stroke.rect ? { ...stroke.rect } : undefined,
  start: stroke.start ? { ...stroke.start } : undefined,
});

const cloneSnapshot = (snapshot) => ({
  sceneTransform: { ...snapshot.sceneTransform },
  viewportRect: snapshot.viewportRect ? { ...snapshot.viewportRect } : null,
  strokes: snapshot.strokes.map(cloneStroke),
});

const serializeSnapshot = (snapshot) => JSON.stringify(snapshot);

const getStrokeTarget = (stroke) => (
  stroke?.target === IMAGE_DRAW_TARGET ? IMAGE_DRAW_TARGET : MASK_DRAW_TARGET
);

const filterStrokesByTarget = (allStrokes = [], target) => (
  allStrokes.filter((stroke) => getStrokeTarget(stroke) === target)
);

const getStrokePaintColor = (stroke, fallbackColor) => (
  stroke?.color || fallbackColor
);

const getStrokeOpacity = (stroke, fallbackOpacity = 1) => {
  const value = Number.isFinite(stroke?.opacity) ? stroke.opacity : fallbackOpacity;
  return clamp(value, 0, 1);
};

const mergeBounds = (left, right) => {
  if (!left) {
    return right ? { ...right } : null;
  }

  if (!right) {
    return { ...left };
  }

  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const getStrokeWorldBounds = (stroke) => {
  if (!stroke || getStrokeTarget(stroke) !== IMAGE_DRAW_TARGET || stroke.mode === 'erase') {
    return null;
  }

  if (stroke.type === 'rect' && stroke.rect) {
    const minX = Math.floor(stroke.rect.x);
    const minY = Math.floor(stroke.rect.y);
    const maxX = Math.ceil(stroke.rect.x + stroke.rect.width);
    const maxY = Math.ceil(stroke.rect.y + stroke.rect.height);

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  if (!stroke.points || stroke.points.length === 0) {
    return null;
  }

  const radius = Math.max(stroke.size || 1, 1) / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  stroke.points.forEach((point) => {
    minX = Math.min(minX, point.x - radius);
    minY = Math.min(minY, point.y - radius);
    maxX = Math.max(maxX, point.x + radius);
    maxY = Math.max(maxY, point.y + radius);
  });

  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.max(1, Math.ceil(maxX) - Math.floor(minX)),
    height: Math.max(1, Math.ceil(maxY) - Math.floor(minY)),
  };
};

const drawStrokeToLayerContext = ({
  ctx,
  stroke,
  projectPoint,
  projectSize,
  color,
  opacity = 1,
}) => {
  ctx.save();
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.globalAlpha = stroke.mode === 'erase' ? 1 : opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(projectSize(stroke.size || 1), 1);

  if (stroke.type === 'rect' && stroke.rect) {
    const startPoint = projectPoint({ x: stroke.rect.x, y: stroke.rect.y });
    const endPoint = projectPoint({
      x: stroke.rect.x + stroke.rect.width,
      y: stroke.rect.y + stroke.rect.height,
    });
    const x = Math.min(startPoint.x, endPoint.x);
    const y = Math.min(startPoint.y, endPoint.y);
    const width = Math.abs(endPoint.x - startPoint.x);
    const height = Math.abs(endPoint.y - startPoint.y);
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    return;
  }

  if (!stroke.points || stroke.points.length === 0) {
    ctx.restore();
    return;
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    const { x, y } = projectPoint(point);
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  stroke.points.forEach((point, index) => {
    const { x, y } = projectPoint(point);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
};

const drawPreviewStroke = ({
  ctx,
  stroke,
  sceneTransform,
  overlayColor,
  overlayOpacity,
  useStrokeStyle = false,
}) => {
  drawStrokeToLayerContext({
    ctx,
    stroke,
    projectPoint: (point) => ({
      x: point.x * sceneTransform.scale + sceneTransform.offsetX,
      y: point.y * sceneTransform.scale + sceneTransform.offsetY,
    }),
    projectSize: (size) => size * sceneTransform.scale,
    color: useStrokeStyle ? getStrokePaintColor(stroke, overlayColor) : overlayColor,
    opacity: useStrokeStyle ? getStrokeOpacity(stroke, overlayOpacity) : 1,
  });
};

const buildImageLayerAsset = ({ strokes, defaultColor, defaultOpacity }) => {
  const imageLayerStrokes = filterStrokesByTarget(strokes, IMAGE_DRAW_TARGET);
  const roughBounds = imageLayerStrokes.reduce((bounds, stroke) => (
    mergeBounds(bounds, getStrokeWorldBounds(stroke))
  ), null);

  if (!roughBounds) {
    return null;
  }

  const imageLayerCanvas = createOffscreenCanvas(roughBounds.width, roughBounds.height);
  const imageLayerCtx = imageLayerCanvas.getContext('2d');

  imageLayerStrokes.forEach((stroke) => {
    drawStrokeToLayerContext({
      ctx: imageLayerCtx,
      stroke,
      projectPoint: (point) => ({
        x: point.x - roughBounds.x,
        y: point.y - roughBounds.y,
      }),
      projectSize: (size) => size,
      color: getStrokePaintColor(stroke, defaultColor),
      opacity: getStrokeOpacity(stroke, defaultOpacity),
    });
  });

  const alphaBounds = getCanvasAlphaBounds(imageLayerCanvas);
  if (!alphaBounds) {
    return null;
  }

  if (
    alphaBounds.x === 0 &&
    alphaBounds.y === 0 &&
    alphaBounds.width === imageLayerCanvas.width &&
    alphaBounds.height === imageLayerCanvas.height
  ) {
    return {
      canvas: imageLayerCanvas,
      bounds: roughBounds,
    };
  }

  const croppedCanvas = createOffscreenCanvas(alphaBounds.width, alphaBounds.height);
  const croppedCtx = croppedCanvas.getContext('2d');
  croppedCtx.drawImage(
    imageLayerCanvas,
    alphaBounds.x,
    alphaBounds.y,
    alphaBounds.width,
    alphaBounds.height,
    0,
    0,
    alphaBounds.width,
    alphaBounds.height
  );

  return {
    canvas: croppedCanvas,
    bounds: {
      x: roughBounds.x + alphaBounds.x,
      y: roughBounds.y + alphaBounds.y,
      width: alphaBounds.width,
      height: alphaBounds.height,
    },
  };
};

const composeContentWithImageLayer = ({
  contentCanvas,
  contentBounds,
  imageLayerAsset,
}) => {
  if (!contentCanvas && !imageLayerAsset) {
    return null;
  }

  if (!imageLayerAsset) {
    return {
      canvas: contentCanvas,
      bounds: contentBounds,
    };
  }

  if (!contentCanvas || !contentBounds) {
    return imageLayerAsset;
  }

  const nextBounds = mergeBounds(contentBounds, imageLayerAsset.bounds);
  const nextCanvas = createOffscreenCanvas(nextBounds.width, nextBounds.height);
  const nextCtx = nextCanvas.getContext('2d');

  nextCtx.drawImage(
    contentCanvas,
    contentBounds.x - nextBounds.x,
    contentBounds.y - nextBounds.y,
    contentBounds.width,
    contentBounds.height
  );

  nextCtx.drawImage(
    imageLayerAsset.canvas,
    imageLayerAsset.bounds.x - nextBounds.x,
    imageLayerAsset.bounds.y - nextBounds.y,
    imageLayerAsset.bounds.width,
    imageLayerAsset.bounds.height
  );

  return {
    canvas: nextCanvas,
    bounds: nextBounds,
  };
};

const EmptyStateCard = ({ generatedItems, onOpenUpload, onOpenSourcePicker, onQuickSelect, onDragEnter, onDragLeave, onDrop, dragActive }) => {
  const { t } = useI18n();
  const imageItems = generatedItems.filter((item) => item.type !== 'video').slice(-4).reverse();

  return (
    <Paper
      elevation={0}
      data-drop-zone="inpaint"
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 2,
        border: (theme) => `1px dashed ${dragActive ? theme.palette.primary.main : theme.palette.divider}`,
        backgroundColor: (theme) => dragActive ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.paper,
        p: 3,
        gap: 2,
      }}
    >
      <ImageOutlinedIcon sx={{ fontSize: 44, color: 'text.secondary' }} />
      <Typography variant="h6">{t('painting.workspace.inpaint.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 420 }}>
        {t('painting.workspace.inpaint.emptyDescription')}
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Button variant="contained" startIcon={<AddPhotoAlternateIcon />} onClick={onOpenUpload}>
          {t('painting.workspace.inpaint.clickToUpload')}
        </Button>
        <Button variant="outlined" startIcon={<CollectionsIcon />} onClick={onOpenSourcePicker}>
          {t('painting.workspace.inpaint.selectFromGalleryShort')}
        </Button>
      </Stack>

      {imageItems.length > 0 && (
        <Box sx={{ width: '100%' }}>
          <Typography variant="caption" color="text.secondary">{t('painting.workspace.inpaint.recentImages')}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))', gap: 1, mt: 1 }}>
            {imageItems.map((item, index) => (
              <Paper
                key={item.id}
                elevation={1}
                onClick={() => onQuickSelect(item)}
                sx={{
                  cursor: 'pointer',
                  overflow: 'hidden',
                  borderRadius: 1.5,
                  transition: 'transform 0.2s ease',
                  '&:hover': { transform: 'translateY(-2px)' },
                }}
              >
                <Box component="img" src={item.src} alt={t('painting.workspace.inpaint.recentImageAlt', { index: index + 1 })} sx={{ width: '100%', height: 76, display: 'block', objectFit: 'cover' }} />
              </Paper>
            ))}
          </Box>
        </Box>
      )}
    </Paper>
  );
};

const InpaintWorkspacePanel = forwardRef(({
  generatedItems,
  outputResolution,
  isMobile,
  onExportToGallery,
  showNotification,
  isGenerating = false,
  generationStatus = { status: 'idle', queuePosition: null, progress: 0, error: null },
  previewBatchStatus = { active: false, current: 0, total: 0 },
  onCostParametersChange = null,
}, ref) => {
  const { t } = useI18n();
  const theme = useTheme();
  const rootRef = useRef(null);
  const stageContainerRef = useRef(null);
  const stageObserverRef = useRef(null);
  const contentCanvasRef = useRef(null);
  const contentBoundsRef = useRef(null);
  const pendingPatchImageRef = useRef(null);
  const pendingPatchImagesRef = useRef(new Map());
  const pendingPatchesRef = useRef([]);
  const featheredPatchCanvasRef = useRef(null);
  const lastRequestRef = useRef(null);
  const needsAutoFitRef = useRef(false);
  const historyRef = useRef({ entries: [], index: -1 });
  const historyTimerRef = useRef(null);
  const stateRef = useRef({
    sceneTransform: { scale: 1, offsetX: 0, offsetY: 0 },
    viewportRect: null,
    strokes: [],
    draftStroke: null,
    dragState: null,
  });
  const pointerInsideRef = useRef(false);
  const historyResetAfterFitRef = useRef(false);
  const displayCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const pinchRef = useRef(null);
  const sessionBaseCanvasRef = useRef(null);
  const sessionBaseBoundsRef = useRef(null);
  const hadPendingPatchRef = useRef(false);

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [sourceImage, setSourceImage] = useState(null);
  const [sceneTransform, setSceneTransform] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [viewportRect, setViewportRect] = useState(null);
  const [toolMode, setToolMode] = useState(DESKTOP_DEFAULT_MODE);
  const [paintTarget, setPaintTarget] = useState(MASK_DRAW_TARGET);
  const [interactionMode, setInteractionMode] = useState(isMobile ? MOBILE_DEFAULT_MODE : DESKTOP_DEFAULT_MODE);
  const [maskBrushSize, setMaskBrushSize] = useState(28);
  const [imageBrushSize, setImageBrushSize] = useState(28);
  const [maskOverlayColor, setMaskOverlayColor] = useState('#ff4d4f');
  const [maskOverlayOpacity, setMaskOverlayOpacity] = useState(0.35);
  const [imageOverlayColor, setImageOverlayColor] = useState('#ffb300');
  const [imageOverlayOpacity, setImageOverlayOpacity] = useState(0.65);
  const [expandPixels, setExpandPixels] = useState(8);
  const [showMaskPreview, setShowMaskPreview] = useState(false);
  const [disabledOriginalImage, setDisabledOriginalImage] = useState(false);
  const [colorCorrect, setColorCorrect] = useState(true);
  const [patchFeather, setPatchFeather] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [strokes, setStrokes] = useState([]);
  const [draftStroke, setDraftStroke] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [pendingPatches, setPendingPatches] = useState([]);
  const [activePendingPatchIndex, setActivePendingPatchIndex] = useState(0);
  const [isGenerationLocked, setIsGenerationLocked] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [featherPopoverOpen, setFeatherPopoverOpen] = useState(false);
  const featherAnchorRef = useRef(null);
  const [inpaintStrength, setInpaintStrength] = useState(1.0);
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
  const settingsAnchorRef = useRef(null);
  const [compareSliderPosition, setCompareSliderPosition] = useState(0.5);
  const [isCompareSliderDragging, setIsCompareSliderDragging] = useState(false);

  const outputAspectRatio = getAspectRatio(outputResolution);
  const hasSourceImage = Boolean(sourceImage && contentCanvasRef.current && contentBoundsRef.current);

  useEffect(() => {
    if (!onCostParametersChange) return;

    onCostParametersChange(hasSourceImage
      ? { image: true, mask: true, inpaintStrength }
      : null);
  }, [hasSourceImage, inpaintStrength, onCostParametersChange]);

  const pendingPatch = pendingPatches[activePendingPatchIndex] || null;
  const pendingPatchCount = pendingPatches.length;
  const primaryPatch = pendingPatches.find((p) => p.status === 'primary') || null;
  const isCurrentPrimary = pendingPatch?.status === 'primary';
  const isCurrentKept = pendingPatch?.status === 'kept';
  const isMultiPatch = pendingPatchCount > 1;
  const hasAnyFeather = patchFeather.top > 0 || patchFeather.right > 0 || patchFeather.bottom > 0 || patchFeather.left > 0;
  const previewGenerationActive = Boolean(isGenerating || previewBatchStatus?.active);
  const showPendingPatchBar = pendingPatchCount > 0 && !previewGenerationActive;
  const previewGenerationProgress = clamp(Number(generationStatus?.progress || 0), 0, 100);
  const previewGenerationLabel = !isGenerating && previewBatchStatus?.active
    ? ((previewBatchStatus.current || 0) < (previewBatchStatus.total || 0)
      ? t('painting.workspace.inpaint.preparingNextGeneration')
      : t('painting.workspace.inpaint.organizingResults'))
    : generationStatus?.status === 'verifying'
      ? t('painting.workspace.inpaint.verifying')
      : generationStatus?.status === 'queued'
        ? t('painting.workspace.inpaint.generationProgress', {
          progress: Math.round(generationStatus?.progress || 0),
        })
        : generationStatus?.status === 'processing'
          ? t('painting.workspace.inpaint.finishingGeneration')
          : t('painting.workspace.inpaint.preparing');
  const maskStrokes = filterStrokesByTarget(strokes, MASK_DRAW_TARGET);
  const imageLayerStrokes = filterStrokesByTarget(strokes, IMAGE_DRAW_TARGET);
  const activeBrushSize = paintTarget === IMAGE_DRAW_TARGET ? imageBrushSize : maskBrushSize;
  const activeBrushSizeLabel = paintTarget === IMAGE_DRAW_TARGET
    ? t('painting.workspace.inpaint.brushSize')
    : t('painting.workspace.inpaint.maskSize');
  const activeOverlayColor = paintTarget === IMAGE_DRAW_TARGET ? imageOverlayColor : maskOverlayColor;
  const activeOverlayOpacity = paintTarget === IMAGE_DRAW_TARGET ? imageOverlayOpacity : maskOverlayOpacity;
  const activeOverlayColorLabel = paintTarget === IMAGE_DRAW_TARGET
    ? t('painting.workspace.inpaint.brushColor')
    : t('painting.workspace.inpaint.maskColor');
  const activeOverlayOpacityLabel = paintTarget === IMAGE_DRAW_TARGET
    ? t('painting.workspace.inpaint.brushOpacity')
    : t('painting.workspace.inpaint.maskOpacity');
  const activeLayerHasStrokes = paintTarget === IMAGE_DRAW_TARGET
    ? imageLayerStrokes.length > 0
    : maskStrokes.length > 0;
  const clearActiveLayerLabel = paintTarget === IMAGE_DRAW_TARGET
    ? t('painting.workspace.inpaint.clearImagePainting')
    : t('painting.workspace.inpaint.clearMask');

  const handleActiveOverlayColorChange = useCallback((value) => {
    if (paintTarget === IMAGE_DRAW_TARGET) {
      setImageOverlayColor(value);
      return;
    }

    setMaskOverlayColor(value);
  }, [paintTarget]);

  const handleActiveBrushSizeChange = useCallback((value) => {
    if (paintTarget === IMAGE_DRAW_TARGET) {
      setImageBrushSize(value);
      return;
    }

    setMaskBrushSize(value);
  }, [paintTarget]);

  const handleActiveOverlayOpacityChange = useCallback((value) => {
    if (paintTarget === IMAGE_DRAW_TARGET) {
      setImageOverlayOpacity(value);
      return;
    }

    setMaskOverlayOpacity(value);
  }, [paintTarget]);

  const updateHistoryFlags = useCallback(() => {
    const history = historyRef.current;
    setHistoryState({
      canUndo: history.index > 0,
      canRedo: history.index >= 0 && history.index < history.entries.length - 1,
    });
  }, []);

  const buildSnapshot = useCallback((overrides = {}) => {
    const current = stateRef.current;
    return cloneSnapshot({
      sceneTransform: overrides.sceneTransform || current.sceneTransform,
      viewportRect: overrides.viewportRect !== undefined ? overrides.viewportRect : current.viewportRect,
      strokes: overrides.strokes || current.strokes,
    });
  }, []);

  const clearHistoryTimer = useCallback(() => {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
  }, []);

  const clearHistory = useCallback(() => {
    clearHistoryTimer();
    historyRef.current = { entries: [], index: -1 };
    updateHistoryFlags();
  }, [clearHistoryTimer, updateHistoryFlags]);

  const clearPendingPatchSession = useCallback((options = {}) => {
    const { resetRequest = true, resetFeather = true } = options;

    pendingPatchImagesRef.current.clear();
    pendingPatchImageRef.current = null;
    featheredPatchCanvasRef.current = null;
    pendingPatchesRef.current = [];
    sessionBaseCanvasRef.current = null;
    sessionBaseBoundsRef.current = null;

    if (resetRequest) {
      lastRequestRef.current = null;
    }

    setPendingPatches([]);
    setActivePendingPatchIndex(0);

    if (resetFeather) {
      setPatchFeather({ top: 0, right: 0, bottom: 0, left: 0 });
    }
  }, []);

  const resetHistory = useCallback((snapshotOverrides = {}) => {
    clearHistoryTimer();
    const snapshot = buildSnapshot(snapshotOverrides);
    historyRef.current = { entries: [snapshot], index: 0 };
    updateHistoryFlags();
  }, [buildSnapshot, clearHistoryTimer, updateHistoryFlags]);

  const commitHistorySnapshot = useCallback((snapshotOverrides = {}) => {
    clearHistoryTimer();
    const snapshot = buildSnapshot(snapshotOverrides);
    const history = historyRef.current;
    const currentEntry = history.entries[history.index];

    if (currentEntry && serializeSnapshot(currentEntry) === serializeSnapshot(snapshot)) {
      updateHistoryFlags();
      return;
    }

    let nextEntries = history.entries.slice(0, history.index + 1);
    nextEntries.push(snapshot);

    if (nextEntries.length > HISTORY_LIMIT) {
      nextEntries = nextEntries.slice(nextEntries.length - HISTORY_LIMIT);
    }

    historyRef.current = {
      entries: nextEntries,
      index: nextEntries.length - 1,
    };
    updateHistoryFlags();
  }, [buildSnapshot, clearHistoryTimer, updateHistoryFlags]);

  const queueHistoryCommit = useCallback((snapshotOverrides = {}) => {
    clearHistoryTimer();
    historyTimerRef.current = setTimeout(() => {
      commitHistorySnapshot(snapshotOverrides);
    }, HISTORY_COMMIT_DELAY);
  }, [clearHistoryTimer, commitHistorySnapshot]);

  const applySnapshot = useCallback((snapshot) => {
    clearHistoryTimer();
    setSceneTransform({ ...snapshot.sceneTransform });
    setViewportRect(snapshot.viewportRect ? { ...snapshot.viewportRect } : null);
    setStrokes(snapshot.strokes.map(cloneStroke));
    setDraftStroke(null);
  }, [clearHistoryTimer]);

  const handleUndo = useCallback(() => {
    const history = historyRef.current;
    if (history.index <= 0 || pendingPatch) {
      return;
    }
    const nextIndex = history.index - 1;
    historyRef.current = {
      ...history,
      index: nextIndex,
    };
    applySnapshot(history.entries[nextIndex]);
    updateHistoryFlags();
  }, [applySnapshot, pendingPatch, updateHistoryFlags]);

  const handleRedo = useCallback(() => {
    const history = historyRef.current;
    if (history.index < 0 || history.index >= history.entries.length - 1 || pendingPatch) {
      return;
    }
    const nextIndex = history.index + 1;
    historyRef.current = {
      ...history,
      index: nextIndex,
    };
    applySnapshot(history.entries[nextIndex]);
    updateHistoryFlags();
  }, [applySnapshot, pendingPatch, updateHistoryFlags]);

  useEffect(() => {
    stateRef.current = {
      sceneTransform,
      viewportRect,
      strokes,
      draftStroke,
      dragState,
    };
  }, [dragState, draftStroke, sceneTransform, viewportRect, strokes]);

  useEffect(() => {
    pendingPatchesRef.current = pendingPatches;
  }, [pendingPatches]);

  useEffect(() => {
    pendingPatchImageRef.current = pendingPatch
      ? pendingPatchImagesRef.current.get(pendingPatch.id) || null
      : null;
  }, [pendingPatch]);

  useEffect(() => {
    const hasPendingPatch = Boolean(pendingPatch);

    // 每轮预览第一次加载结果时归中；同一轮内切换多个候选结果时保留用户调整的位置。
    if (hasPendingPatch && !hadPendingPatchRef.current) {
      setCompareSliderPosition(0.5);
    }

    hadPendingPatchRef.current = hasPendingPatch;
    setIsCompareSliderDragging(false);
  }, [pendingPatch]);

  useEffect(() => () => {
    clearHistoryTimer();
  }, [clearHistoryTimer]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!pointerInsideRef.current) {
        return;
      }

      const activeElement = document.activeElement;
      const isTypingTarget = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
      );

      if (isTypingTarget) {
        return;
      }

      const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
      const isRedo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y';

      if (isUndo) {
        event.preventDefault();
        handleUndo();
      } else if (isRedo) {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRedo, handleUndo]);

  const handleStageContainerRef = useCallback((node) => {
    if (stageObserverRef.current) {
      stageObserverRef.current.disconnect();
      stageObserverRef.current = null;
    }

    stageContainerRef.current = node;

    if (!node) {
      return;
    }

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(node);
    stageObserverRef.current = resizeObserver;
  }, []);

  const fitStageToContent = useCallback((options = {}) => {
    const { recordHistory = false } = options;
    const bounds = contentBoundsRef.current;
    if (!bounds || !stageSize.width || !stageSize.height) {
      return;
    }

    const nextSceneTransform = fitSceneToStage(bounds, stageSize);
    needsAutoFitRef.current = false;
    setSceneTransform(nextSceneTransform);
    const nextViewportRect = createInitialViewportRect(stageSize, outputAspectRatio, {
      sceneTransform: nextSceneTransform,
      outputResolution,
      contentBounds: bounds,
    });
    setViewportRect(nextViewportRect);

    if (historyResetAfterFitRef.current) {
      historyResetAfterFitRef.current = false;
      resetHistory({
        sceneTransform: nextSceneTransform,
        viewportRect: nextViewportRect,
        strokes: [],
      });
    } else if (recordHistory) {
      commitHistorySnapshot({
        sceneTransform: nextSceneTransform,
        viewportRect: nextViewportRect,
      });
    }
  }, [commitHistorySnapshot, outputAspectRatio, outputResolution, resetHistory, stageSize]);

  const syncViewportAspect = useCallback(() => {
    if (!hasSourceImage || !stageSize.width || !stageSize.height) {
      return;
    }

    setViewportRect((prev) => {
      const nextViewportRect = normalizeViewportRect(
        prev || createInitialViewportRect(stageSize, outputAspectRatio, {
          sceneTransform: stateRef.current.sceneTransform,
          outputResolution,
          contentBounds: contentBoundsRef.current,
        }),
        stageSize,
        outputAspectRatio
      );

      return areRectsEqual(prev, nextViewportRect) ? prev : nextViewportRect;
    });
  }, [hasSourceImage, outputAspectRatio, outputResolution, stageSize]);

  const importSourceImage = useCallback(async (source) => {
    const image = await loadImageElement(source.src);
    const nextCanvas = createOffscreenCanvas(image.width, image.height);
    const nextCtx = nextCanvas.getContext('2d');
    nextCtx.drawImage(image, 0, 0, nextCanvas.width, nextCanvas.height);

    contentCanvasRef.current = nextCanvas;
    contentBoundsRef.current = { x: 0, y: 0, width: image.width, height: image.height };
    pendingPatchImageRef.current = null;
    featheredPatchCanvasRef.current = null;
    lastRequestRef.current = null;
    needsAutoFitRef.current = true;
    historyResetAfterFitRef.current = true;

    setSourceImage({
      ...source,
      width: image.width,
      height: image.height,
    });
    setStrokes([]);
    setDraftStroke(null);
    clearPendingPatchSession({ resetRequest: true, resetFeather: true });
    setIsGenerationLocked(false);
    setShowMaskPreview(false);
    setDisabledOriginalImage(false);
    setColorCorrect(true);
    setInpaintStrength(1.0);
    clearHistoryTimer();
    setViewportRect(null);

    if (stageSize.width && stageSize.height) {
      fitStageToContent();
    }
  }, [clearHistoryTimer, clearPendingPatchSession, fitStageToContent, stageSize]);

  const clearWorkspace = useCallback(() => {
    contentCanvasRef.current = null;
    contentBoundsRef.current = null;
    pendingPatchImageRef.current = null;
    featheredPatchCanvasRef.current = null;
    lastRequestRef.current = null;
    needsAutoFitRef.current = false;
    historyResetAfterFitRef.current = false;

    setSourceImage(null);
    setSceneTransform({ scale: 1, offsetX: 0, offsetY: 0 });
    setViewportRect(null);
    setStrokes([]);
    setDraftStroke(null);
    setDragState(null);
    clearPendingPatchSession({ resetRequest: true, resetFeather: true });
    setIsGenerationLocked(false);
    setShowMaskPreview(false);
    setDisabledOriginalImage(false);
    setColorCorrect(true);
    setInpaintStrength(1.0);
    clearHistory();
    showNotification?.(t('painting.workspace.inpaint.workspaceCleared'), 'info');
  }, [clearHistory, clearPendingPatchSession, showNotification, t]);

  const importFile = useCallback(async (file) => {
    const dataUrl = await readFileAsDataUrl(file);
    await importSourceImage({
      src: dataUrl,
      name: file.name,
      seed: '',
    });
    showNotification?.(t('painting.workspace.inpaint.imageLoaded'), 'success');
  }, [importSourceImage, showNotification, t]);

  const importGalleryItem = useCallback(async (item) => {
    await importSourceImage({
      src: item.src,
      name: `gallery_${item.id}.png`,
      seed: item.seed || '',
      prompt: item.prompt || '',
    });
    showNotification?.(t('painting.workspace.inpaint.galleryImageLoaded'), 'success');
  }, [importSourceImage, showNotification, t]);

  const getPointerPoint = useCallback((event) => {
    const rect = displayCanvasRef.current?.getBoundingClientRect() || stageContainerRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const zoomScene = useCallback((factor, anchorPoint) => {
    setSceneTransform((prev) => {
      const nextScale = clamp(prev.scale * factor, 0.08, 12);
      const point = anchorPoint || { x: stageSize.width / 2, y: stageSize.height / 2 };
      const worldX = (point.x - prev.offsetX) / prev.scale;
      const worldY = (point.y - prev.offsetY) / prev.scale;

      return {
        scale: nextScale,
        offsetX: point.x - worldX * nextScale,
        offsetY: point.y - worldY * nextScale,
      };
    });
    queueHistoryCommit();
  }, [queueHistoryCommit, stageSize.height, stageSize.width]);

  const zoomGlobal = useCallback((factor, anchorPoint) => {
    const point = anchorPoint || { x: stageSize.width / 2, y: stageSize.height / 2 };

    setSceneTransform((prev) => {
      const nextScale = clamp(prev.scale * factor, 0.08, 12);
      const worldX = (point.x - prev.offsetX) / prev.scale;
      const worldY = (point.y - prev.offsetY) / prev.scale;

      return {
        scale: nextScale,
        offsetX: point.x - worldX * nextScale,
        offsetY: point.y - worldY * nextScale,
      };
    });

    setViewportRect((prev) => scaleRectAroundPoint(prev, factor, stageSize, outputAspectRatio, point));
    queueHistoryCommit();
  }, [outputAspectRatio, queueHistoryCommit, stageSize]);

  const zoomViewport = useCallback((factor) => {
    setViewportRect((prev) => resizeViewportRect(prev, factor, stageSize, outputAspectRatio));
    queueHistoryCommit();
  }, [outputAspectRatio, queueHistoryCommit, stageSize]);

  const applySnapAfterViewportMove = useCallback((nextRect, currentSceneTransform) => {
    const bounds = contentBoundsRef.current;
    if (!bounds || !nextRect) {
      return nextRect;
    }

    const currentWorldRect = screenRectToWorldRect(nextRect, currentSceneTransform);
    const snappedWorldRect = snapWorldRectToContent(currentWorldRect, bounds, 5, currentSceneTransform.scale);

    return worldRectToScreenRect(snappedWorldRect, currentSceneTransform);
  }, []);

  const applySnapAfterSceneMove = useCallback((nextSceneTransform) => {
    const bounds = contentBoundsRef.current;
    const currentViewportRect = stateRef.current.viewportRect;

    if (!bounds || !currentViewportRect) {
      return nextSceneTransform;
    }

    const currentWorldRect = screenRectToWorldRect(currentViewportRect, nextSceneTransform);
    const snappedWorldRect = snapWorldRectToContent(currentWorldRect, bounds, 5, nextSceneTransform.scale);

    return {
      ...nextSceneTransform,
      offsetX: currentViewportRect.x - snappedWorldRect.x * nextSceneTransform.scale,
      offsetY: currentViewportRect.y - snappedWorldRect.y * nextSceneTransform.scale,
    };
  }, []);

  const buildSourceContentSnapshot = useCallback(() => {
    if (!contentCanvasRef.current || !contentBoundsRef.current) {
      return null;
    }

    const imageLayerAsset = buildImageLayerAsset({
      strokes,
      defaultColor: imageOverlayColor,
      defaultOpacity: imageOverlayOpacity,
    });

    return composeContentWithImageLayer({
      contentCanvas: contentCanvasRef.current,
      contentBounds: contentBoundsRef.current,
      imageLayerAsset,
    });
  }, [imageOverlayColor, imageOverlayOpacity, strokes]);

  const buildGenerationPayload = useCallback(() => {
    if (!hasSourceImage || !viewportRect || !outputResolution?.width || !outputResolution?.height) {
      return null;
    }

    const sourceSnapshot = buildSourceContentSnapshot();
    if (!sourceSnapshot?.canvas || !sourceSnapshot?.bounds) {
      return null;
    }

    const worldRect = snapWorldRectToContent(
      screenRectToWorldRect(viewportRect, sceneTransform),
      sourceSnapshot.bounds,
      5,
      sceneTransform.scale
    );

    const outputWidth = outputResolution.width;
    const outputHeight = outputResolution.height;
    const hasVisibleContent = worldRectHasVisibleContent({
      contentCanvas: sourceSnapshot.canvas,
      contentBounds: sourceSnapshot.bounds,
      worldRect,
    });

    if (!hasVisibleContent) {
      return {
        worldRect,
        outputWidth,
        outputHeight,
        generationMode: 'text-to-image',
      };
    }

    const maskData = createInpaintMaskData({
      contentCanvas: sourceSnapshot.canvas,
      contentBounds: sourceSnapshot.bounds,
      worldRect,
      outputWidth,
      outputHeight,
      strokes: maskStrokes,
      expandPixels,
    });

    return {
      worldRect,
      outputWidth,
      outputHeight,
      generationMode: 'inpaint',
      disabledOriginalImage,
      colorCorrect,
      inpaintStrength,
      baseImage: cropWorldRectToDataUrl({
        contentCanvas: sourceSnapshot.canvas,
        contentBounds: sourceSnapshot.bounds,
        worldRect,
        outputWidth,
        outputHeight,
      }),
      mask: maskData.dataUrl,
      maskCanvas: maskData.canvas,
    };
  }, [buildSourceContentSnapshot, colorCorrect, disabledOriginalImage, expandPixels, hasSourceImage, inpaintStrength, maskStrokes, outputResolution, sceneTransform, viewportRect]);

  const preserveMaskStrokesAfterGeneration = useCallback(() => {
    const preservedMaskStrokes = filterStrokesByTarget(stateRef.current.strokes, MASK_DRAW_TARGET)
      .map(cloneStroke);

    // 生成结果只替换图像内容，蒙版是用户下一轮局部重绘的选择范围，需要跨预览会话保留。
    setStrokes(preservedMaskStrokes);
    setDraftStroke(null);
    resetHistory({
      sceneTransform: stateRef.current.sceneTransform,
      viewportRect: stateRef.current.viewportRect,
      strokes: preservedMaskStrokes,
    });
  }, [resetHistory]);

  const handleApplySinglePatch = useCallback(async () => {
    const singlePatch = pendingPatchesRef.current[0];
    const baseCanvas = sessionBaseCanvasRef.current || contentCanvasRef.current;
    const baseBounds = sessionBaseBoundsRef.current || contentBoundsRef.current;

    if (!singlePatch || !baseCanvas || !baseBounds) {
      return;
    }

    const mergeResult = await mergePatchIntoContentCanvas({
      contentCanvas: baseCanvas,
      contentBounds: baseBounds,
      patchSrc: singlePatch.src,
      patchImage: pendingPatchImagesRef.current.get(singlePatch.id) || null,
      worldRect: singlePatch.worldRect,
      featherPixels: patchFeather,
    });

    contentCanvasRef.current = mergeResult.canvas;
    contentBoundsRef.current = mergeResult.bounds;
    clearPendingPatchSession({ resetRequest: true, resetFeather: true });
    setIsGenerationLocked(false);
    preserveMaskStrokesAfterGeneration();
    showNotification?.(t('painting.workspace.inpaint.resultMerged'), 'success');
  }, [clearPendingPatchSession, patchFeather, preserveMaskStrokesAfterGeneration, showNotification, t]);

  const handleDiscardCurrentPatch = useCallback(() => {
    const patches = pendingPatchesRef.current;

    if (patches.length === 0) {
      return;
    }

    const idx = activePendingPatchIndex;
    pendingPatchImagesRef.current.delete(patches[idx].id);
    const next = patches.filter((_, i) => i !== idx);

    if (next.length === 0) {
      clearPendingPatchSession({ resetRequest: true, resetFeather: true });
      setIsGenerationLocked(false);
      showNotification?.(t('painting.workspace.inpaint.allPreviewsDiscarded'), 'info');
      return;
    }

    pendingPatchesRef.current = next;
    setPendingPatches(next);
    setActivePendingPatchIndex(Math.min(idx, next.length - 1));
  }, [activePendingPatchIndex, clearPendingPatchSession, showNotification, t]);

  const handleKeepCurrentPatch = useCallback(() => {
    if (!pendingPatch) {
      return;
    }

    setPendingPatches((prev) => {
      const next = prev.map((patch, index) => (
        index === activePendingPatchIndex
          ? { ...patch, status: patch.status === 'kept' ? 'pending' : 'kept' }
          : patch
      ));
      pendingPatchesRef.current = next;
      return next;
    });
  }, [activePendingPatchIndex, pendingPatch]);

  const handleSetPrimaryPatch = useCallback(() => {
    if (!pendingPatch) {
      return;
    }

    setPendingPatches((prev) => {
      const next = prev.map((patch, index) => ({
        ...patch,
        status: index === activePendingPatchIndex
          ? 'primary'
          : patch.status === 'primary' ? 'pending' : patch.status,
      }));
      pendingPatchesRef.current = next;
      return next;
    });
  }, [activePendingPatchIndex, pendingPatch]);

  const handleFinishSession = useCallback(async () => {
    const allPatches = pendingPatchesRef.current;
    const primaryP = allPatches.find((p) => p.status === 'primary');
    const keptPatches = allPatches.filter((p) => p.status === 'kept');
    const baseCanvas = sessionBaseCanvasRef.current || contentCanvasRef.current;
    const baseBounds = sessionBaseBoundsRef.current || contentBoundsRef.current;

    if (primaryP && baseCanvas && baseBounds) {
      const mergeResult = await mergePatchIntoContentCanvas({
        contentCanvas: baseCanvas,
        contentBounds: baseBounds,
        patchSrc: primaryP.src,
        patchImage: pendingPatchImagesRef.current.get(primaryP.id) || null,
        worldRect: primaryP.worldRect,
        featherPixels: patchFeather,
      });
      contentCanvasRef.current = mergeResult.canvas;
      contentBoundsRef.current = mergeResult.bounds;
    }

    for (const patch of keptPatches) {
      const mergeResult = await mergePatchIntoContentCanvas({
        contentCanvas: baseCanvas,
        contentBounds: baseBounds,
        patchSrc: patch.src,
        patchImage: pendingPatchImagesRef.current.get(patch.id) || null,
        worldRect: patch.worldRect,
        featherPixels: patchFeather,
      });
      const exportResult = exportContentCanvas({
        contentCanvas: mergeResult.canvas,
        background: 'transparent',
      });

      if (exportResult) {
        onExportToGallery?.({
          src: exportResult.dataUrl,
          width: exportResult.width,
          height: exportResult.height,
          seed: patch.seed || sourceImage?.seed || '',
          prompt: patch.prompt || sourceImage?.prompt || t('painting.workspace.inpaint.exportPromptFallback'),
        });
      }
    }

    clearPendingPatchSession({ resetRequest: true, resetFeather: true });
    setIsGenerationLocked(false);
    preserveMaskStrokesAfterGeneration();

    if (primaryP && keptPatches.length > 0) {
      showNotification?.(t('painting.workspace.inpaint.primaryAppliedAndKeptSaved', { count: keptPatches.length }), 'success');
    } else if (primaryP) {
      showNotification?.(t('painting.workspace.inpaint.resultMerged'), 'success');
    } else if (keptPatches.length > 0) {
      showNotification?.(t('painting.workspace.inpaint.keptSaved', { count: keptPatches.length }), 'success');
    } else {
      showNotification?.(t('painting.workspace.inpaint.previewClosedWithoutApply'), 'info');
    }
  }, [clearPendingPatchSession, onExportToGallery, patchFeather, preserveMaskStrokesAfterGeneration, showNotification, sourceImage, t]);

  const handleSelectPreviousPendingPatch = useCallback(() => {
    if (pendingPatchesRef.current.length <= 1) {
      return;
    }

    setActivePendingPatchIndex((prev) => (
      prev === 0 ? pendingPatchesRef.current.length - 1 : prev - 1
    ));
  }, []);

  const handleSelectNextPendingPatch = useCallback(() => {
    if (pendingPatchesRef.current.length <= 1) {
      return;
    }

    setActivePendingPatchIndex((prev) => (
      prev === pendingPatchesRef.current.length - 1 ? 0 : prev + 1
    ));
  }, []);

  const handleClearActiveLayer = useCallback(() => {
    if (pendingPatch || stateRef.current.strokes.length === 0) {
      return;
    }

    const nextStrokes = stateRef.current.strokes
      .filter((stroke) => getStrokeTarget(stroke) !== paintTarget)
      .map(cloneStroke);

    if (nextStrokes.length === stateRef.current.strokes.length) {
      return;
    }

    setStrokes(nextStrokes);
    commitHistorySnapshot({ strokes: nextStrokes });
  }, [commitHistorySnapshot, paintTarget, pendingPatch]);

  const exportWorkspace = useCallback(async (background, shouldExportToGallery = false) => {
    if (!contentCanvasRef.current) {
      showNotification?.(t('painting.workspace.inpaint.nothingToExport'), 'warning');
      return null;
    }

    const exportResult = exportContentCanvas({
      contentCanvas: contentCanvasRef.current,
      background,
    });

    if (!exportResult) {
      showNotification?.(t('painting.workspace.inpaint.noVisibleContentToExport'), 'warning');
      return null;
    }

    if (shouldExportToGallery) {
      onExportToGallery?.({
        src: exportResult.dataUrl,
        width: exportResult.width,
        height: exportResult.height,
        seed: sourceImage?.seed || '',
        prompt: sourceImage?.prompt || t('painting.workspace.inpaint.exportPromptFallback'),
      });
      showNotification?.(t('painting.workspace.inpaint.exportedToGallery'), 'success');
      return exportResult;
    }

    const blob = await dataUrlToBlob(exportResult.dataUrl);
    const fileName = `${background === 'white' ? 'inpaint-white' : 'inpaint-transparent'}-${Date.now()}.png`;
    saveAs(blob, fileName);
    showNotification?.(t('painting.workspace.inpaint.fileExported'), 'success');
    return exportResult;
  }, [onExportToGallery, showNotification, sourceImage, t]);

  const startUploadFlow = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      await importFile(file);
    } catch (error) {
      console.error('载入局部重绘源图失败:', error);
      showNotification?.(t('painting.workspace.inpaint.loadImageFailed'), 'error');
    } finally {
      event.target.value = '';
    }
  }, [importFile, showNotification, t]);

  const handleEmptyStateDrop = useCallback(async (event) => {
    event.preventDefault();
    setDragActive(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    try {
      await importFile(file);
    } catch (error) {
      console.error('拖入导入失败:', error);
      showNotification?.(t('painting.workspace.inpaint.dropImageFailed'), 'error');
    }
  }, [importFile, showNotification, t]);

  const handleStagePointerDown = useCallback((event) => {
    if (!hasSourceImage || isGenerationLocked) {
      return;
    }

    const point = getPointerPoint(event);
    const desktopMoveGlobal = !isMobile && event.button === 1;
    const desktopMoveScene = !isMobile && (event.button === 2 || (event.button === 0 && event.altKey));
    const desktopPaint = !isMobile && event.button === 0 && !event.altKey;

    if (pendingPatch) {
      const desktopPreviewMove = !isMobile && (event.button === 0 || event.button === 1);
      const mobilePreviewMove = isMobile && event.button === 0;

      if (!viewportRect || (!desktopPreviewMove && !mobilePreviewMove)) {
        return;
      }

      event.preventDefault();
      setDragState({
        type: 'move-global',
        startPoint: point,
        startSceneTransform: sceneTransform,
        startRect: viewportRect,
      });
      return;
    }

    if (!isMobile && !desktopMoveGlobal && !desktopMoveScene && !desktopPaint) {
      return;
    }

    event.preventDefault();

    const worldPoint = screenToWorldPoint(point, sceneTransform);

    if (desktopMoveGlobal) {
      if (!viewportRect) {
        return;
      }
      setDragState({
        type: 'move-global',
        startPoint: point,
        startSceneTransform: sceneTransform,
        startRect: viewportRect,
      });
      return;
    }

    if (isMobile && interactionMode === 'move-viewport') {
      if (!viewportRect) {
        return;
      }
      setDragState({
        type: 'move-viewport',
        startPoint: point,
        startRect: viewportRect,
      });
      return;
    }

    if (isMobile && interactionMode === 'move-global') {
      if (!viewportRect) {
        return;
      }
      setDragState({
        type: 'move-global',
        startPoint: point,
        startSceneTransform: sceneTransform,
        startRect: viewportRect,
      });
      return;
    }

    if (desktopMoveScene || (isMobile && interactionMode === 'move-scene')) {
      setDragState({
        type: 'move-scene',
        startPoint: point,
        startSceneTransform: sceneTransform,
      });
      return;
    }

    if (!desktopPaint && !isMobile) {
      return;
    }

    const activeMode = isMobile ? interactionMode : toolMode;

    if (activeMode === 'paint' || activeMode === 'erase') {
      setDraftStroke({
        type: 'path',
        target: paintTarget,
        mode: activeMode === 'erase' ? 'erase' : 'paint',
        size: activeBrushSize,
        color: activeOverlayColor,
        opacity: activeOverlayOpacity,
        points: [worldPoint],
      });
      return;
    }

    if (activeMode === 'rect') {
      setDraftStroke({
        type: 'rect',
        target: paintTarget,
        mode: 'paint',
        size: activeBrushSize,
        color: activeOverlayColor,
        opacity: activeOverlayOpacity,
        start: worldPoint,
        rect: {
          x: worldPoint.x,
          y: worldPoint.y,
          width: 0,
          height: 0,
        },
      });
    }
  }, [activeBrushSize, activeOverlayColor, activeOverlayOpacity, getPointerPoint, hasSourceImage, interactionMode, isGenerationLocked, isMobile, paintTarget, pendingPatch, sceneTransform, toolMode, viewportRect]);

  const handleGlobalPointerMove = useCallback((event) => {
    const point = getPointerPoint(event);
    const {
      dragState: currentDragState,
      draftStroke: currentDraftStroke,
      sceneTransform: currentSceneTransform,
    } = stateRef.current;

    if (currentDragState?.type === 'move-global') {
      if (!currentDragState.startRect || !currentDragState.startSceneTransform) {
        return;
      }

      const deltaX = point.x - currentDragState.startPoint.x;
      const deltaY = point.y - currentDragState.startPoint.y;
      const nextViewportRect = moveViewportRect(currentDragState.startRect, deltaX, deltaY);
      const nextSceneTransform = {
        ...currentDragState.startSceneTransform,
        offsetX: currentDragState.startSceneTransform.offsetX + deltaX,
        offsetY: currentDragState.startSceneTransform.offsetY + deltaY,
      };

      setViewportRect((prev) => (areRectsEqual(prev, nextViewportRect) ? prev : nextViewportRect));
      setSceneTransform((prev) => (areSceneTransformsEqual(prev, nextSceneTransform) ? prev : nextSceneTransform));
      return;
    }

    if (currentDragState?.type === 'move-viewport') {
      if (!currentDragState.startRect) {
        return;
      }

      const deltaX = point.x - currentDragState.startPoint.x;
      const deltaY = point.y - currentDragState.startPoint.y;
      const nextViewportRect = moveViewportRect(currentDragState.startRect, deltaX, deltaY);

      setViewportRect((prev) => (areRectsEqual(prev, nextViewportRect) ? prev : nextViewportRect));
      return;
    }

    if (currentDragState?.type === 'move-scene') {
      const deltaX = point.x - currentDragState.startPoint.x;
      const deltaY = point.y - currentDragState.startPoint.y;
      const nextSceneTransform = {
        ...currentDragState.startSceneTransform,
        offsetX: currentDragState.startSceneTransform.offsetX + deltaX,
        offsetY: currentDragState.startSceneTransform.offsetY + deltaY,
      };

      setSceneTransform((prev) => (areSceneTransformsEqual(prev, nextSceneTransform) ? prev : nextSceneTransform));
      return;
    }

    if (currentDraftStroke?.type === 'path') {
      const worldPoint = screenToWorldPoint(point, currentSceneTransform);
      setDraftStroke((prev) => {
        if (!prev?.points) {
          return prev;
        }

        return {
          ...prev,
          points: [...prev.points, worldPoint],
        };
      });
      return;
    }

    if (currentDraftStroke?.type === 'rect') {
      const worldPoint = screenToWorldPoint(point, currentSceneTransform);
      const x = Math.min(currentDraftStroke.start.x, worldPoint.x);
      const y = Math.min(currentDraftStroke.start.y, worldPoint.y);
      const width = Math.abs(worldPoint.x - currentDraftStroke.start.x);
      const height = Math.abs(worldPoint.y - currentDraftStroke.start.y);

      setDraftStroke((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          rect: { x, y, width, height },
        };
      });
    }
  }, [getPointerPoint]);

  const handleGlobalPointerUp = useCallback(() => {
    const {
      dragState: currentDragState,
      draftStroke: currentDraftStroke,
      sceneTransform: currentSceneTransform,
      viewportRect: currentViewportRect,
      strokes: currentStrokes,
    } = stateRef.current;

    if (currentDragState?.type === 'move-viewport') {
      const nextViewportRect = applySnapAfterViewportMove(currentViewportRect, currentSceneTransform);
      setViewportRect((prev) => (areRectsEqual(prev, nextViewportRect) ? prev : nextViewportRect));
      commitHistorySnapshot({ viewportRect: nextViewportRect });
    }

    if (currentDragState?.type === 'move-scene') {
      const nextSceneTransform = applySnapAfterSceneMove(currentSceneTransform);
      setSceneTransform((prev) => (areSceneTransformsEqual(prev, nextSceneTransform) ? prev : nextSceneTransform));
      commitHistorySnapshot({ sceneTransform: nextSceneTransform });
    }

    if (currentDragState?.type === 'move-global') {
      commitHistorySnapshot();
    }

    if (currentDraftStroke?.type === 'path' && currentDraftStroke.points.length > 0) {
      const nextStrokes = [...currentStrokes, currentDraftStroke].map(cloneStroke);
      setStrokes(nextStrokes);
      commitHistorySnapshot({ strokes: nextStrokes });
    }

    if (currentDraftStroke?.type === 'rect' && currentDraftStroke.rect.width > 0 && currentDraftStroke.rect.height > 0) {
      const nextStrokes = [...currentStrokes, currentDraftStroke].map(cloneStroke);
      setStrokes(nextStrokes);
      commitHistorySnapshot({ strokes: nextStrokes });
    }

    setDraftStroke(null);
    setDragState(null);
  }, [applySnapAfterSceneMove, applySnapAfterViewportMove, commitHistorySnapshot]);

  const updateCompareSliderFromClientX = useCallback((clientX) => {
    const stageRect = stageContainerRef.current?.getBoundingClientRect();
    const activeViewportRect = stateRef.current.viewportRect;

    if (!stageRect || !activeViewportRect || activeViewportRect.width <= 0) {
      return;
    }

    const localX = clientX - stageRect.left;
    const relativePosition = (localX - activeViewportRect.x) / activeViewportRect.width;
    setCompareSliderPosition(clamp(relativePosition, 0, 1));
  }, []);

  const handleCompareSliderPointerDown = useCallback((event) => {
    if (!pendingPatch || !viewportRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateCompareSliderFromClientX(event.clientX);
    setIsCompareSliderDragging(true);
  }, [pendingPatch, updateCompareSliderFromClientX, viewportRect]);

  const handleCompareSliderPointerMove = useCallback((event) => {
    if (!isCompareSliderDragging) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateCompareSliderFromClientX(event.clientX);
  }, [isCompareSliderDragging, updateCompareSliderFromClientX]);

  const handleCompareSliderPointerUp = useCallback((event) => {
    if (!isCompareSliderDragging) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    updateCompareSliderFromClientX(event.clientX);
    setIsCompareSliderDragging(false);
  }, [isCompareSliderDragging, updateCompareSliderFromClientX]);

  const handleCompareSliderPointerCancel = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsCompareSliderDragging(false);
  }, []);

  const isPointerInteractionActive = Boolean(dragState || draftStroke);

  useEffect(() => {
    if (!isPointerInteractionActive) {
      return undefined;
    }

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [handleGlobalPointerMove, handleGlobalPointerUp, isPointerInteractionActive]);

  const handleStageWheel = useCallback((event) => {
    if (!hasSourceImage || isMobile || isGenerationLocked) {
      return;
    }

    event.preventDefault();
    const point = getPointerPoint(event);
    const factor = event.deltaY < 0 ? 1.08 : 0.92;

    if (pendingPatch) {
      zoomGlobal(factor, point);
      return;
    }

    const insideViewport = pointInRect(point, viewportRect);

    if (insideViewport) {
      zoomGlobal(factor, point);
    } else {
      zoomScene(factor, point);
    }
  }, [getPointerPoint, hasSourceImage, isGenerationLocked, isMobile, pendingPatch, viewportRect, zoomGlobal, zoomScene]);

  /* ---- Mobile pinch-to-zoom via touch events ---- */
  useEffect(() => {
    if (!isMobile) {
      return undefined;
    }
    const container = stageContainerRef.current;
    if (!container) {
      return undefined;
    }

    const getTouchCenter = (t1, t2) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });
    const getTouchDistance = (t1, t2) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const handleTouchStart = (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const rect = container.getBoundingClientRect();
        const center = getTouchCenter(event.touches[0], event.touches[1]);
        pinchRef.current = {
          startDist: getTouchDistance(event.touches[0], event.touches[1]),
          lastDist: getTouchDistance(event.touches[0], event.touches[1]),
          center: { x: center.x - rect.left, y: center.y - rect.top },
        };
      }
    };

    const handleTouchMove = (event) => {
      if (event.touches.length === 2 && pinchRef.current) {
        event.preventDefault();
        const currentDist = getTouchDistance(event.touches[0], event.touches[1]);
        const scaleFactor = currentDist / pinchRef.current.lastDist;
        pinchRef.current.lastDist = currentDist;

        const rect = container.getBoundingClientRect();
        const center = getTouchCenter(event.touches[0], event.touches[1]);
        const point = { x: center.x - rect.left, y: center.y - rect.top };

        zoomGlobal(scaleFactor, point);
      }
    };

    const handleTouchEnd = (event) => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isMobile, zoomGlobal]);

  useEffect(() => () => {
    if (stageObserverRef.current) {
      stageObserverRef.current.disconnect();
      stageObserverRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (needsAutoFitRef.current && hasSourceImage && stageSize.width && stageSize.height) {
      fitStageToContent();
    }
  }, [fitStageToContent, hasSourceImage, stageSize.height, stageSize.width]);

  useEffect(() => {
    syncViewportAspect();
  }, [syncViewportAspect]);

  useEffect(() => {
    if (!pendingPatch || !pendingPatchImageRef.current) {
      featheredPatchCanvasRef.current = null;
      return;
    }

    featheredPatchCanvasRef.current = createFeatheredPatchCanvas({
      patchImage: pendingPatchImageRef.current,
      featherPixels: patchFeather,
    });
  }, [patchFeather, pendingPatch]);

  useEffect(() => {
    const displayCanvas = displayCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;

    if (!displayCanvas || !overlayCanvas) {
      return;
    }

    const displayCtx = configureStageCanvas(displayCanvas, stageSize.width, stageSize.height);
    const overlayCtx = configureStageCanvas(overlayCanvas, stageSize.width, stageSize.height);

    if (!displayCtx || !overlayCtx) {
      return;
    }

    displayCtx.fillStyle = theme.palette.background.default;
    displayCtx.fillRect(0, 0, stageSize.width, stageSize.height);

    const previewStrokes = draftStroke ? [...strokes, draftStroke] : strokes;
    const imagePreviewStrokes = filterStrokesByTarget(previewStrokes, IMAGE_DRAW_TARGET);
    const maskPreviewStrokes = pendingPatch ? [] : filterStrokesByTarget(previewStrokes, MASK_DRAW_TARGET);

    if (contentCanvasRef.current && contentBoundsRef.current) {
      const bounds = contentBoundsRef.current;
      const compareSplitX = viewportRect
        ? clamp(
          viewportRect.x + (viewportRect.width * compareSliderPosition),
          viewportRect.x,
          viewportRect.x + viewportRect.width
        )
        : null;

      displayCtx.save();
      displayCtx.imageSmoothingEnabled = sceneTransform.scale <= 1;
      displayCtx.imageSmoothingQuality = sceneTransform.scale <= 1 ? 'high' : 'medium';
      displayCtx.drawImage(
        contentCanvasRef.current,
        bounds.x * sceneTransform.scale + sceneTransform.offsetX,
        bounds.y * sceneTransform.scale + sceneTransform.offsetY,
        bounds.width * sceneTransform.scale,
        bounds.height * sceneTransform.scale
      );

      if (imagePreviewStrokes.length > 0) {
        const imageLayerPreviewCanvas = createOffscreenCanvas(stageSize.width, stageSize.height);
        const imageLayerPreviewCtx = imageLayerPreviewCanvas.getContext('2d');

        imagePreviewStrokes.forEach((stroke) => {
          drawPreviewStroke({
            ctx: imageLayerPreviewCtx,
            stroke,
            sceneTransform,
            overlayColor: imageOverlayColor,
            overlayOpacity: imageOverlayOpacity,
            useStrokeStyle: true,
          });
        });

        displayCtx.drawImage(imageLayerPreviewCanvas, 0, 0, stageSize.width, stageSize.height);
      }

      if (pendingPatch && pendingPatchImageRef.current) {
        const patchPreviewCanvas = featheredPatchCanvasRef.current || pendingPatchImageRef.current;

        if (compareSplitX !== null && viewportRect) {
          displayCtx.save();
          displayCtx.beginPath();
          displayCtx.rect(
            viewportRect.x,
            viewportRect.y,
            Math.max(0, compareSplitX - viewportRect.x),
            viewportRect.height
          );
          displayCtx.clip();
        }

        displayCtx.drawImage(
          patchPreviewCanvas,
          pendingPatch.worldRect.x * sceneTransform.scale + sceneTransform.offsetX,
          pendingPatch.worldRect.y * sceneTransform.scale + sceneTransform.offsetY,
          pendingPatch.worldRect.width * sceneTransform.scale,
          pendingPatch.worldRect.height * sceneTransform.scale
        );

        if (compareSplitX !== null && viewportRect) {
          displayCtx.restore();
        }
      }
      displayCtx.restore();

      const outlineX = bounds.x * sceneTransform.scale + sceneTransform.offsetX;
      const outlineY = bounds.y * sceneTransform.scale + sceneTransform.offsetY;
      const outlineWidth = bounds.width * sceneTransform.scale;
      const outlineHeight = bounds.height * sceneTransform.scale;

      overlayCtx.save();
      overlayCtx.strokeStyle = alpha(theme.palette.info.main, 0.45);
      overlayCtx.lineWidth = 1;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.strokeRect(outlineX, outlineY, outlineWidth, outlineHeight);
      overlayCtx.restore();
    }

    if (!pendingPatch && showMaskPreview && viewportRect && hasSourceImage) {
      const worldRect = screenRectToWorldRect(viewportRect, sceneTransform);
      const sourceSnapshot = buildSourceContentSnapshot();

      if (sourceSnapshot?.canvas && sourceSnapshot?.bounds) {
        const maskCanvas = createInpaintMaskCanvas({
          contentCanvas: sourceSnapshot.canvas,
          contentBounds: sourceSnapshot.bounds,
          worldRect,
          outputWidth: outputResolution.width,
          outputHeight: outputResolution.height,
          strokes: maskPreviewStrokes,
          expandPixels,
        });
        const maskPreviewCanvas = createMaskPreviewCanvas(maskCanvas, maskOverlayColor);

        overlayCtx.save();
        overlayCtx.globalAlpha = MASK_PREVIEW_OPACITY;
        overlayCtx.drawImage(maskPreviewCanvas, viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
        overlayCtx.restore();
      }
    } else {
      const previewCanvas = createOffscreenCanvas(stageSize.width, stageSize.height);
      const previewCtx = previewCanvas.getContext('2d');

      maskPreviewStrokes.forEach((stroke) => {
        drawPreviewStroke({
          ctx: previewCtx,
          stroke,
          sceneTransform,
          overlayColor: maskOverlayColor,
          overlayOpacity: maskOverlayOpacity,
        });
      });

      overlayCtx.save();
      overlayCtx.globalAlpha = maskOverlayOpacity;
      overlayCtx.drawImage(previewCanvas, 0, 0, stageSize.width, stageSize.height);
      overlayCtx.restore();
    }
  }, [buildSourceContentSnapshot, compareSliderPosition, draftStroke, expandPixels, hasSourceImage, imageOverlayColor, imageOverlayOpacity, maskOverlayColor, maskOverlayOpacity, outputResolution, patchFeather, pendingPatch, sceneTransform, showMaskPreview, stageSize, strokes, theme.palette.background.default, theme.palette.info.main, viewportRect]);

  useImperativeHandle(ref, () => ({
    importImageSource: async (source) => {
      await importSourceImage(source);
      return true;
    },
    hasSourceImage: () => hasSourceImage,
    prepareGeneration: () => {
      if (pendingPatchesRef.current.length > 0 && lastRequestRef.current) {
        setIsGenerationLocked(true);
        return lastRequestRef.current;
      }

      const payload = buildGenerationPayload();
      if (!payload) {
        return null;
      }

      lastRequestRef.current = payload;
      setIsGenerationLocked(true);
      clearPendingPatchSession({ resetRequest: false, resetFeather: true });
      sessionBaseCanvasRef.current = contentCanvasRef.current;
      sessionBaseBoundsRef.current = contentBoundsRef.current;
      setShowMaskPreview(false);
      return payload;
    },
    applyGeneratedPatch: async (item) => {
      if (!lastRequestRef.current) {
        return false;
      }

      const previewItem = typeof item === 'string'
        ? { src: item }
        : item;
      const image = await loadImageElement(previewItem.src);
      const maskedPatchResult = lastRequestRef.current.generationMode === 'inpaint' && lastRequestRef.current.maskCanvas
        ? extractMaskedPatchCanvas({
          patchImage: image,
          maskCanvas: lastRequestRef.current.maskCanvas,
          worldRect: lastRequestRef.current.worldRect,
          outwardFeatherPixels: PATCH_MASK_OUTWARD_FEATHER_PIXELS,
        })
        : null;
      const resolvedPatchImage = maskedPatchResult?.canvas || image;
      const resolvedPatchSrc = maskedPatchResult?.canvas
        ? maskedPatchResult.canvas.toDataURL('image/png')
        : previewItem.src;
      const resolvedWorldRect = maskedPatchResult?.worldRect || lastRequestRef.current.worldRect;
      const patchId = `inpaint-preview-${Date.now()}-${Math.random()}`;
      const nextPendingPatch = {
        id: patchId,
        src: resolvedPatchSrc,
        worldRect: resolvedWorldRect,
        status: 'pending',
        seed: previewItem.seed || sourceImage?.seed || '',
        prompt: previewItem.prompt || sourceImage?.prompt || '',
      };
      const nextPendingPatches = [...pendingPatchesRef.current, nextPendingPatch];

      pendingPatchImagesRef.current.set(patchId, resolvedPatchImage);
      pendingPatchesRef.current = nextPendingPatches;
      featheredPatchCanvasRef.current = null;
      setPendingPatches(nextPendingPatches);
      setActivePendingPatchIndex(nextPendingPatches.length - 1);
      preserveMaskStrokesAfterGeneration();
      setShowMaskPreview(false);
      setIsGenerationLocked(false);
      return true;
    },
    handleGenerationFailure: () => {
      featheredPatchCanvasRef.current = null;

      if (pendingPatchesRef.current.length === 0) {
        clearPendingPatchSession({ resetRequest: true, resetFeather: true });
      }

      setIsGenerationLocked(false);
    },
    clearWorkspace,
  }), [buildGenerationPayload, clearPendingPatchSession, clearWorkspace, hasSourceImage, importSourceImage, preserveMaskStrokesAfterGeneration, sourceImage]);

  const pendingPatchBarPosition = pendingPatch && viewportRect
    ? {
      left: clamp(
        viewportRect.x + (viewportRect.width / 2),
        PENDING_PATCH_BAR_MARGIN,
        Math.max(PENDING_PATCH_BAR_MARGIN, stageSize.width - PENDING_PATCH_BAR_MARGIN)
      ),
      top: clamp(
        viewportRect.y + viewportRect.height + PENDING_PATCH_BAR_MARGIN,
        PENDING_PATCH_BAR_MARGIN,
        Math.max(PENDING_PATCH_BAR_MARGIN, stageSize.height - PENDING_PATCH_BAR_HEIGHT - PENDING_PATCH_BAR_MARGIN)
      ),
    }
    : null;

  const generationOverlayPosition = viewportRect
    ? {
      left: viewportRect.x + (viewportRect.width / 2),
      top: viewportRect.y + (viewportRect.height / 2),
    }
    : {
      left: stageSize.width / 2,
      top: stageSize.height / 2,
    };

  const compareSliderScreenX = pendingPatch && viewportRect
    ? clamp(
      viewportRect.x + (viewportRect.width * compareSliderPosition),
      viewportRect.x,
      viewportRect.x + viewportRect.width
    )
    : null;

  return (
    <Box
      ref={rootRef}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
      }}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleFileInputChange}
      />

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          minHeight: 0,
          borderRadius: 2,
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <Typography variant="subtitle1" fontWeight={600}>{t('painting.workspace.inpaint.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('painting.workspace.inpaint.outputResolution', {
                width: outputResolution.width,
                height: outputResolution.height,
              })}
              {sourceImage ? t('painting.workspace.inpaint.sourceResolution', {
                width: sourceImage.width,
                height: sourceImage.height,
              }) : ''}
            </Typography>
          </Box>

          {hasSourceImage && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              <Button aria-label={t('painting.workspace.inpaint.clearContent')} size="small" color="error" variant="outlined" startIcon={<DeleteSweepIcon />} onClick={clearWorkspace}
                sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } } }}>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.clearContent')}</Box>
              </Button>
              <Button aria-label={t('painting.workspace.inpaint.replaceSource')} size="small" variant="outlined" startIcon={<AddPhotoAlternateIcon />} onClick={startUploadFlow}
                sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } } }}>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.replaceSource')}</Box>
              </Button>
              <Button aria-label={t('painting.workspace.inpaint.selectFromGalleryShort')} size="small" variant="outlined" startIcon={<CollectionsIcon />} onClick={() => setSourcePickerOpen(true)}
                sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } } }}>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.selectFromGalleryShort')}</Box>
              </Button>
            </Stack>
          )}
        </Box>

        {!hasSourceImage ? (
          <EmptyStateCard
            generatedItems={generatedItems}
            onOpenUpload={startUploadFlow}
            onOpenSourcePicker={() => setSourcePickerOpen(true)}
            onQuickSelect={importGalleryItem}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleEmptyStateDrop}
            dragActive={dragActive}
          />
        ) : (
          <Box
            ref={handleStageContainerRef}
            data-drop-zone="inpaint"
            onPointerDown={handleStagePointerDown}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={handleStageWheel}
            sx={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              overflow: 'hidden',
              touchAction: 'none',
              overscrollBehavior: 'contain',
              borderRadius: 2,
              backgroundColor: 'background.default',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              WebkitTapHighlightColor: 'transparent',
              backgroundImage: `linear-gradient(45deg, ${alpha(theme.palette.common.black, 0.04)} 25%, transparent 25%), linear-gradient(-45deg, ${alpha(theme.palette.common.black, 0.04)} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${alpha(theme.palette.common.black, 0.04)} 75%), linear-gradient(-45deg, transparent 75%, ${alpha(theme.palette.common.black, 0.04)} 75%)`,
              backgroundSize: '24px 24px',
              backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
            }}
          >
            <canvas ref={displayCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
            <canvas ref={overlayCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

            {previewGenerationActive && (
              <Paper
                elevation={0}
                sx={{
                  position: 'absolute',
                  left: generationOverlayPosition.left,
                  top: generationOverlayPosition.top,
                  transform: 'translate(-50%, -50%)',
                  px: 2,
                  py: 1.75,
                  minWidth: 168,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.background.paper, 0.94),
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: alpha(theme.palette.divider, 0.18),
                  pointerEvents: 'none',
                  zIndex: 12,
                }}
              >
                <Stack spacing={1.25} alignItems="center">
                  <Box sx={{ position: 'relative', width: 92, height: 92, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress
                      variant="determinate"
                      value={100}
                      size={92}
                      thickness={4}
                      sx={{ color: alpha(theme.palette.primary.main, 0.16), position: 'absolute', inset: 0 }}
                    />
                    <CircularProgress
                      variant="determinate"
                      value={previewGenerationProgress}
                      size={92}
                      thickness={4}
                      sx={{ color: theme.palette.primary.main, position: 'absolute', inset: 0 }}
                    />
                    <Typography variant="h6" fontWeight={700} color="text.primary">
                      {`${Math.round(previewGenerationProgress)}%`}
                    </Typography>
                  </Box>

                  <Stack spacing={0.25} alignItems="center">
                    <Typography variant="body2" fontWeight={600} color="text.primary">
                      {previewGenerationLabel}
                    </Typography>
                    {(previewBatchStatus?.total || 0) > 1 && (
                      <Typography variant="caption" color="text.secondary">
                        {t('painting.workspace.inpaint.batchGenerationProgress', {
                          current: Math.max(1, previewBatchStatus.current || 1),
                          total: previewBatchStatus.total,
                        })}
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              </Paper>
            )}

            {viewportRect && (
              <Box
                sx={{
                  position: 'absolute',
                  left: viewportRect.x,
                  top: viewportRect.y,
                  width: viewportRect.width,
                  height: viewportRect.height,
                  border: `2px solid ${pendingPatch ? theme.palette.success.main : theme.palette.primary.main}`,
                  boxShadow: pendingPatch ? 'none' : `0 0 0 9999px ${alpha(theme.palette.common.black, 0.28)}`,
                  borderRadius: 1.5,
                  pointerEvents: 'none',
                  transition: 'border-color 0.2s ease',
                  zIndex: 1,
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    left: 8,
                    top: 8,
                    px: 1,
                    py: 0.25,
                    borderRadius: 999,
                    bgcolor: alpha(theme.palette.background.paper, 0.86),
                    color: 'text.primary',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {outputResolution.width} × {outputResolution.height}
                </Box>
              </Box>
            )}

            {pendingPatch && viewportRect && compareSliderScreenX !== null && (
              <>
                <Paper
                  elevation={0}
                  sx={{
                    position: 'absolute',
                    left: viewportRect.x + 10,
                    top: viewportRect.y + 40,
                    px: 1,
                    py: 0.25,
                    borderRadius: 999,
                    bgcolor: alpha(theme.palette.success.main, 0.9),
                    color: theme.palette.getContrastText(theme.palette.success.main),
                    pointerEvents: 'none',
                    zIndex: 11,
                  }}
                >
                  <Typography variant="caption" fontWeight={700}>{t('painting.workspace.inpaint.merged')}</Typography>
                </Paper>
                <Paper
                  elevation={0}
                  sx={{
                    position: 'absolute',
                    right: Math.max(8, stageSize.width - viewportRect.x - viewportRect.width + 10),
                    top: viewportRect.y + 40,
                    px: 1,
                    py: 0.25,
                    borderRadius: 999,
                    bgcolor: alpha(theme.palette.background.paper, 0.88),
                    color: 'text.primary',
                    pointerEvents: 'none',
                    zIndex: 11,
                  }}
                >
                  <Typography variant="caption" fontWeight={700}>{t('painting.workspace.inpaint.original')}</Typography>
                </Paper>

                <Box
                  data-inpaint-interactive="true"
                  onPointerDown={handleCompareSliderPointerDown}
                  onPointerMove={handleCompareSliderPointerMove}
                  onPointerUp={handleCompareSliderPointerUp}
                  onPointerCancel={handleCompareSliderPointerCancel}
                  onLostPointerCapture={() => setIsCompareSliderDragging(false)}
                  sx={{
                    position: 'absolute',
                    left: compareSliderScreenX - 18,
                    top: viewportRect.y,
                    width: 36,
                    height: viewportRect.height,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'ew-resize',
                    touchAction: 'none',
                    pointerEvents: 'auto',
                    zIndex: 12,
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 2,
                      borderRadius: 999,
                      bgcolor: alpha(theme.palette.common.white, 0.96),
                      boxShadow: `0 0 0 1px ${alpha(theme.palette.common.black, 0.18)}`,
                    }}
                  />
                  <Paper
                    elevation={4}
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(theme.palette.background.paper, 0.96),
                      border: '1px solid',
                      borderColor: alpha(theme.palette.divider, 0.35),
                    }}
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 12,
                        borderLeft: '2px solid',
                        borderRight: '2px solid',
                        borderColor: 'text.secondary',
                        borderRadius: 0.5,
                      }}
                    />
                  </Paper>
                </Box>
              </>
            )}

            <Paper
              data-inpaint-interactive="true"
              elevation={0}
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              sx={{
                position: 'absolute',
                top: { xs: 8, sm: 12 },
                right: { xs: 8, sm: 12 },
                p: 0.5,
                borderRadius: 1.5,
                bgcolor: alpha(theme.palette.background.paper, 0.9),
                backdropFilter: 'blur(10px)',
                border: '1px solid',
                borderColor: alpha(theme.palette.divider, 0.2),
                pointerEvents: 'auto',
                zIndex: 10,
              }}
            >
              <Stack direction="row" spacing={0.5}>
                <Button aria-label={t('painting.workspace.inpaint.transparentBackground')} size="small" variant="outlined" startIcon={<FileDownloadIcon />} onClick={() => exportWorkspace('transparent', false)}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.transparentBackground')}</Box>
                </Button>
                <Button aria-label={t('painting.workspace.inpaint.whiteBackground')} size="small" variant="outlined" startIcon={<FileDownloadIcon />} onClick={() => exportWorkspace('white', false)}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.whiteBackground')}</Box>
                </Button>
                <Button aria-label={t('painting.workspace.inpaint.toGallery')} size="small" variant="contained" startIcon={<ImageIcon />} onClick={() => exportWorkspace('transparent', true)}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.toGallery')}</Box>
                </Button>
              </Stack>
            </Paper>

            <Paper
              data-inpaint-interactive="true"
              elevation={0}
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              sx={{
                position: 'absolute',
                left: { xs: 8, sm: 12 },
                bottom: { xs: 8, sm: 12 },
                p: 0.5,
                borderRadius: 1.5,
                bgcolor: alpha(theme.palette.background.paper, 0.9),
                backdropFilter: 'blur(10px)',
                border: '1px solid',
                borderColor: alpha(theme.palette.divider, 0.2),
                pointerEvents: 'auto',
                zIndex: 10,
              }}
            >
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Button aria-label={t('painting.workspace.inpaint.undo')} size="small" variant="outlined" startIcon={<UndoIcon />} onClick={handleUndo} disabled={!historyState.canUndo || Boolean(pendingPatch)}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.undo')}</Box>
                </Button>
                <Button aria-label={t('painting.workspace.inpaint.redo')} size="small" variant="outlined" startIcon={<RedoIcon />} onClick={handleRedo} disabled={!historyState.canRedo || Boolean(pendingPatch)}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.redo')}</Box>
                </Button>
                <Button aria-label={t('painting.workspace.inpaint.previewMask')} size="small" variant={showMaskPreview ? 'contained' : 'outlined'} startIcon={<PreviewIcon />} onClick={() => setShowMaskPreview((prev) => !prev)}
                  disabled={Boolean(pendingPatch)}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.previewMask')}</Box>
                </Button>
                <Button size="small" variant="outlined" startIcon={<DeleteSweepIcon />} onClick={handleClearActiveLayer}
                  disabled={Boolean(pendingPatch) || !activeLayerHasStrokes}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{clearActiveLayerLabel}</Box>
                </Button>
                <Button aria-label={t('painting.workspace.inpaint.resetView')} size="small" variant="outlined" startIcon={<FitScreenIcon />} onClick={() => fitStageToContent({ recordHistory: true })}
                  sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } }, minWidth: { xs: 32, sm: 'auto' }, px: { xs: 0.5, sm: 1 } }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('painting.workspace.inpaint.resetView')}</Box>
                </Button>
              </Stack>
            </Paper>

            <Box
              data-inpaint-interactive="true"
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              sx={{
                display: { xs: 'none', sm: 'block' },
                position: 'absolute',
                right: { xs: 8, sm: 12 },
                bottom: { xs: 8, sm: 12 },
                pointerEvents: 'auto',
                zIndex: 10,
              }}
            >
              <IconButton
                ref={settingsAnchorRef}
                aria-label={t('painting.workspace.inpaint.settings')}
                size="small"
                onClick={() => setSettingsPopoverOpen((prev) => !prev)}
                sx={{
                  bgcolor: alpha(theme.palette.background.paper, 0.9),
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: alpha(theme.palette.divider, 0.2),
                  '&:hover': { bgcolor: alpha(theme.palette.background.paper, 0.95) },
                }}
              >
                <TuneIcon fontSize="small" />
              </IconButton>
              <Popper
                open={settingsPopoverOpen}
                anchorEl={settingsAnchorRef.current}
                placement="top-end"
                sx={{ zIndex: 20 }}
              >
                <ClickAwayListener onClickAway={() => setSettingsPopoverOpen(false)}>
                  <Paper
                    elevation={4}
                    sx={{
                      p: 1.5,
                      mb: 1,
                      borderRadius: 1.5,
                      bgcolor: alpha(theme.palette.background.paper, 0.95),
                      backdropFilter: 'blur(10px)',
                      border: '1px solid',
                      borderColor: alpha(theme.palette.divider, 0.2),
                      minWidth: 220,
                    }}
                  >
                    <Stack spacing={1}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <FormControlLabel
                          sx={{ m: 0 }}
                          control={
                            <Checkbox
                              size="small"
                              checked={disabledOriginalImage}
                              onChange={(event) => setDisabledOriginalImage(event.target.checked)}
                            />
                          }
                          label={<Typography variant="caption">{t('painting.workspace.inpaint.disableOriginalImage')}</Typography>}
                        />
                        <FormControlLabel
                          sx={{ m: 0 }}
                          control={
                            <Checkbox
                              size="small"
                              checked={colorCorrect}
                              onChange={(event) => setColorCorrect(event.target.checked)}
                            />
                          }
                          label={<Typography variant="caption">{t('painting.workspace.inpaint.colorCorrection')}</Typography>}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{t('painting.workspace.inpaint.referenceStrength')}</Typography>
                        <Slider
                          size="small"
                          value={inpaintStrength}
                          min={0.01}
                          max={1}
                          step={0.01}
                          onChange={(_, value) => setInpaintStrength(value)}
                        />
                        <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right' }}>{inpaintStrength.toFixed(2)}</Typography>
                      </Box>
                    </Stack>
                  </Paper>
                </ClickAwayListener>
              </Popper>
            </Box>

            {showPendingPatchBar && (
              <Paper
                data-inpaint-interactive="true"
                elevation={0}
                onPointerDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                sx={{
                  position: 'absolute',
                  left: pendingPatchBarPosition ? pendingPatchBarPosition.left : PENDING_PATCH_BAR_MARGIN,
                  top: pendingPatchBarPosition ? pendingPatchBarPosition.top : PENDING_PATCH_BAR_MARGIN,
                  transform: 'translateX(-50%)',
                  maxWidth: `calc(100% - ${PENDING_PATCH_BAR_MARGIN * 2}px)`,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.background.paper, 0.92),
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: alpha(theme.palette.divider, 0.2),
                  pointerEvents: 'auto',
                  zIndex: 10,
                  whiteSpace: 'nowrap',
                }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center">
                  {isMultiPatch && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                      <IconButton
                        aria-label={t('painting.workspace.inpaint.previousResult')}
                        size="small"
                        onClick={handleSelectPreviousPendingPatch}
                        sx={{ p: 0.25, borderRadius: 1 }}
                      >
                        <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                      <IconButton
                        aria-label={t('painting.workspace.inpaint.nextResult')}
                        size="small"
                        onClick={handleSelectNextPendingPatch}
                        sx={{ p: 0.25, borderRadius: 1 }}
                      >
                        <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Box>
                  )}

                  {isMultiPatch && (
                    <Stack spacing={0} sx={{ flexShrink: 0, minWidth: 0 }}>
                      <Typography variant="caption" fontWeight={700} color="text.primary" sx={{ lineHeight: 1.2 }}>
                        {t('painting.workspace.inpaint.resultProgress', {
                          current: activePendingPatchIndex + 1,
                          total: pendingPatchCount,
                        })}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          lineHeight: 1.2,
                          color: isCurrentPrimary ? 'success.main' : isCurrentKept ? 'info.main' : 'text.disabled',
                          fontWeight: isCurrentPrimary || isCurrentKept ? 600 : 400,
                        }}
                      >
                        {isCurrentPrimary
                          ? t('painting.workspace.inpaint.primaryStatus')
                          : isCurrentKept
                            ? t('painting.workspace.inpaint.keptStatus')
                            : t('painting.workspace.inpaint.pendingStatus')}
                      </Typography>
                    </Stack>
                  )}

                  <IconButton
                    ref={featherAnchorRef}
                    aria-label={t('painting.workspace.inpaint.edgeFeathering')}
                    size="small"
                    onClick={() => setFeatherPopoverOpen((prev) => !prev)}
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      flexShrink: 0,
                      border: '1px solid',
                      borderColor: hasAnyFeather ? 'primary.main' : alpha(theme.palette.divider, 0.3),
                      bgcolor: hasAnyFeather ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                      color: hasAnyFeather ? 'primary.main' : 'text.secondary',
                      '&:hover': {
                        bgcolor: hasAnyFeather ? alpha(theme.palette.primary.main, 0.15) : alpha(theme.palette.action.hover, 0.08),
                      },
                    }}
                  >
                    <BlurOnIcon sx={{ fontSize: 18 }} />
                  </IconButton>

                  <Popper
                    open={featherPopoverOpen}
                    anchorEl={featherAnchorRef.current}
                    placement="bottom-start"
                    sx={{ zIndex: 20 }}
                  >
                    <ClickAwayListener onClickAway={() => setFeatherPopoverOpen(false)}>
                      <Paper
                        elevation={4}
                        data-inpaint-interactive="true"
                        onPointerDown={(e) => e.stopPropagation()}
                        sx={{
                          mt: 0.5,
                          p: 1.5,
                          borderRadius: 2,
                          width: 220,
                          bgcolor: alpha(theme.palette.background.paper, 0.96),
                          backdropFilter: 'blur(10px)',
                          border: '1px solid',
                          borderColor: alpha(theme.palette.divider, 0.15),
                        }}
                      >
                        <Typography variant="caption" fontWeight={600} color="text.primary" sx={{ mb: 1, display: 'block' }}>
                          {t('painting.workspace.inpaint.edgeFeathering')}
                        </Typography>
                        {[
                          { key: 'top', label: t('painting.workspace.inpaint.top') },
                          { key: 'right', label: t('painting.workspace.inpaint.right') },
                          { key: 'bottom', label: t('painting.workspace.inpaint.bottom') },
                          { key: 'left', label: t('painting.workspace.inpaint.left') },
                        ].map(({ key, label }) => (
                          <Stack key={key} direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ width: 16, textAlign: 'center', flexShrink: 0 }}>
                              {label}
                            </Typography>
                            <Slider
                              size="small"
                              min={0}
                              max={64}
                              step={1}
                              value={patchFeather[key]}
                              onChange={(_, value) => {
                                setPatchFeather((prev) => ({ ...prev, [key]: value }));
                              }}
                              sx={{ flex: 1 }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ width: 20, textAlign: 'right', flexShrink: 0 }}>
                              {patchFeather[key]}
                            </Typography>
                          </Stack>
                        ))}
                      </Paper>
                    </ClickAwayListener>
                  </Popper>

                  {isMultiPatch ? (
                    <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                      <Button
                        size="small"
                        variant={isCurrentKept ? 'contained' : 'outlined'}
                        color="info"
                        onClick={handleKeepCurrentPatch}
                        sx={{ minWidth: 0, px: 1, borderRadius: 1.5 }}
                      >
                        {t('painting.workspace.inpaint.keep')}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={handleDiscardCurrentPatch}
                        sx={{ minWidth: 0, px: 1, borderRadius: 1.5 }}
                      >
                        {t('painting.workspace.inpaint.discard')}
                      </Button>
                      <Button
                        size="small"
                        variant={isCurrentPrimary ? 'contained' : 'outlined'}
                        color="success"
                        onClick={handleSetPrimaryPatch}
                        sx={{ minWidth: 0, px: 1, borderRadius: 1.5 }}
                      >
                        {t('painting.workspace.inpaint.primary')}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        onClick={handleFinishSession}
                        sx={{ minWidth: 0, px: 1, borderRadius: 1.5 }}
                      >
                        {t('painting.workspace.inpaint.finish')}
                      </Button>
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        onClick={handleApplySinglePatch}
                        sx={{ minWidth: 0, px: 1.5, borderRadius: 1.5 }}
                      >
                        {t('painting.workspace.inpaint.apply')}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={handleDiscardCurrentPatch}
                        sx={{ minWidth: 0, px: 1.5, borderRadius: 1.5 }}
                      >
                        {t('painting.workspace.inpaint.discard')}
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            )}
          </Box>
        )}
      </Paper>

      <InpaintControls
        isMobile={isMobile}
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        paintTarget={paintTarget}
        onPaintTargetChange={setPaintTarget}
        interactionMode={interactionMode}
        onInteractionModeChange={setInteractionMode}
        brushSize={activeBrushSize}
        onBrushSizeChange={handleActiveBrushSizeChange}
        brushSizeLabel={activeBrushSizeLabel}
        overlayColor={activeOverlayColor}
        onOverlayColorChange={handleActiveOverlayColorChange}
        overlayColorLabel={activeOverlayColorLabel}
        overlayOpacity={activeOverlayOpacity}
        onOverlayOpacityChange={handleActiveOverlayOpacityChange}
        overlayOpacityLabel={activeOverlayOpacityLabel}
        expandPixels={expandPixels}
        onExpandPixelsChange={setExpandPixels}
        onSceneZoom={(factor) => zoomScene(factor)}
        onViewportZoom={zoomViewport}
        disabledOriginalImage={disabledOriginalImage}
        onDisabledOriginalImageChange={setDisabledOriginalImage}
        colorCorrect={colorCorrect}
        onColorCorrectChange={setColorCorrect}
        inpaintStrength={inpaintStrength}
        onInpaintStrengthChange={setInpaintStrength}
      />

      <InpaintSourcePicker
        open={sourcePickerOpen}
        items={generatedItems}
        onClose={() => setSourcePickerOpen(false)}
        onSelect={async (item) => {
          await importGalleryItem(item);
          setSourcePickerOpen(false);
        }}
      />
    </Box>
  );
});

InpaintWorkspacePanel.displayName = 'InpaintWorkspacePanel';

export default InpaintWorkspacePanel;
