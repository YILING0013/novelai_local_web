"use client";

import React, { useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  IconButton,
  Paper,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  FormControlLabel,
  Checkbox,
  Tooltip,
} from '@mui/material';
import {
  Brush as BrushIcon,
  CleaningServices as EraserIcon,
  CropSquare as CropSquareIcon,
  CircleOutlined as CircleOutlinedIcon,
  Layers as LayersIcon,
  OpenWith as OpenWithIcon,
  PanTool as PanToolIcon,
  ExpandMore as ExpandMoreIcon,
  ImageOutlined as ImageOutlinedIcon,
  CropFree as CropFreeIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const TOOL_ORDER = ['paint', 'erase', 'rect'];

const TOOL_META = {
  paint: { icon: BrushIcon, labelKey: 'painting.workspace.inpaint.brush' },
  erase: { icon: EraserIcon, labelKey: 'painting.workspace.inpaint.eraser' },
  rect: { icon: CropSquareIcon, labelKey: 'painting.workspace.inpaint.selection' },
};

const InpaintControls = ({
  isMobile,
  toolMode,
  onToolModeChange,
  paintTarget,
  onPaintTargetChange,
  interactionMode,
  onInteractionModeChange,
  brushSize,
  brushShape,
  onBrushShapeChange,
  onBrushSizeChange,
  brushSizeLabel,
  overlayColor,
  onOverlayColorChange,
  overlayColorLabel,
  overlayOpacity,
  onOverlayOpacityChange,
  overlayOpacityLabel,
  expandPixels,
  onExpandPixelsChange,
  onSceneZoom,
  onViewportZoom,
  disabledOriginalImage,
  onDisabledOriginalImageChange,
  colorCorrect,
  onColorCorrectChange,
  inpaintStrength,
  onInpaintStrengthChange,
}) => {
  const { t } = useI18n();
  const [toolsExpanded, setToolsExpanded] = useState(!isMobile);

  const currentToolMeta = TOOL_META[toolMode] || TOOL_META.paint;
  const CurrentToolIcon = currentToolMeta.icon;
  const currentPaintTargetLabel = paintTarget === 'image'
    ? t('painting.workspace.inpaint.imagePainting')
    : t('painting.workspace.inpaint.maskPainting');
  const isMask = paintTarget === 'mask';
  const brushShapeControl = isMask && (
    <Button
      size="small"
      variant="outlined"
      onClick={() => onBrushShapeChange(brushShape === 'square' ? 'circle' : 'square')}
      startIcon={brushShape === 'square' ? <CropSquareIcon /> : <CircleOutlinedIcon />}
      sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      {t(`painting.workspace.inpaint.${brushShape === 'square' ? 'squareBrush' : 'circleBrush'}`)}
    </Button>
  );

  const cycleToolMode = () => {
    const currentIndex = TOOL_ORDER.indexOf(toolMode);
    const nextIndex = (currentIndex + 1) % TOOL_ORDER.length;
    onToolModeChange(TOOL_ORDER[nextIndex]);
  };

  const togglePaintTarget = () => {
    onPaintTargetChange(paintTarget === 'image' ? 'mask' : 'image');
  };

  /* ---- mobile: movement mode is either 'move-scene' or 'move-viewport', collapsed into a toggle ---- */
  const movementMode = interactionMode === 'move-viewport' ? 'move-viewport' : 'move-scene';
  const cycleMovementMode = () => {
    onInteractionModeChange(movementMode === 'move-scene' ? 'move-viewport' : 'move-scene');
  };

  /* ---- mobile: whether the current interactionMode is a movement mode ---- */
  const isMoveMode = interactionMode === 'move-scene' || interactionMode === 'move-viewport' || interactionMode === 'move-global';

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1,
        borderRadius: 2,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        backgroundColor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flexShrink: 0,
        // 展开参数最多占用画布区的三分之二；详情自己滚动，收起按钮始终可点。
        maxHeight: isMobile ? '65%' : undefined,
      }}
    >
      <Stack spacing={0.75} sx={{ minHeight: 0 }}>
        {/* ---- Mobile: compact toolbar row with collapsible detail ---- */}
        {isMobile ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap', flexShrink: 0,
              '& .MuiIconButton-root': { width: 40, height: 40, flexShrink: 0, borderRadius: 1, border: 1, borderColor: 'divider' } }}>
              {/* Tool mode: paint / erase / rect (cycle button) */}
              <Tooltip title={t(currentToolMeta.labelKey)}>
              <IconButton
                size="small"
                aria-label={t(currentToolMeta.labelKey)}
                aria-pressed={!isMoveMode}
                color="primary"
                onClick={() => {
                  if (isMoveMode) {
                    onInteractionModeChange(toolMode);
                  } else {
                    cycleToolMode();
                  }
                }}
                sx={{ bgcolor: !isMoveMode ? 'action.selected' : 'transparent' }}
              >
                <CurrentToolIcon fontSize="small" />
              </IconButton>
              </Tooltip>

              <Tooltip title={currentPaintTargetLabel}>
              <IconButton
                size="small"
                aria-label={currentPaintTargetLabel}
                color="primary"
                onClick={togglePaintTarget}
              >
                {isMask ? <LayersIcon fontSize="small" /> : <ImageOutlinedIcon fontSize="small" />}
              </IconButton>
              </Tooltip>

              {/* Movement mode: move-global (drag+zoom via pinch) */}
              <Tooltip title={t('painting.workspace.inpaint.drag')}>
              <IconButton
                size="small"
                aria-label={t('painting.workspace.inpaint.drag')}
                aria-pressed={interactionMode === 'move-global'}
                color="primary"
                onClick={() => onInteractionModeChange('move-global')}
                sx={{ bgcolor: interactionMode === 'move-global' ? 'action.selected' : 'transparent' }}
              >
                <OpenWithIcon fontSize="small" />
              </IconButton>
              </Tooltip>

              {/* Canvas / Viewport toggle */}
              <Tooltip title={t(movementMode === 'move-scene' ? 'painting.workspace.inpaint.canvas' : 'painting.workspace.inpaint.viewport')}>
              <IconButton
                size="small"
                aria-label={t(movementMode === 'move-scene' ? 'painting.workspace.inpaint.canvas' : 'painting.workspace.inpaint.viewport')}
                aria-pressed={interactionMode === 'move-scene' || interactionMode === 'move-viewport'}
                color="primary"
                onClick={() => {
                  if (interactionMode === 'move-scene' || interactionMode === 'move-viewport') {
                    cycleMovementMode();
                  } else {
                    onInteractionModeChange('move-scene');
                  }
                }}
                sx={{ bgcolor: interactionMode === 'move-scene' || interactionMode === 'move-viewport' ? 'action.selected' : 'transparent' }}
              >
                {movementMode === 'move-scene' ? <PanToolIcon fontSize="small" /> : <CropFreeIcon fontSize="small" />}
              </IconButton>
              </Tooltip>

              <Box sx={{ flex: 1 }} />

              {/* Expand / collapse parameter details */}
              <Tooltip title={t(toolsExpanded ? 'painting.workspace.inpaint.collapseTools' : 'painting.workspace.inpaint.expandTools')}>
              <IconButton
                aria-label={toolsExpanded
                  ? t('painting.workspace.inpaint.collapseTools')
                  : t('painting.workspace.inpaint.expandTools')}
                size="small"
                aria-expanded={toolsExpanded}
                onClick={() => setToolsExpanded((prev) => !prev)}
                sx={{
                  transform: toolsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              >
                <ExpandMoreIcon fontSize="small" />
              </IconButton>
              </Tooltip>
            </Box>

            <Collapse in={toolsExpanded} timeout="auto" unmountOnExit
              sx={{ minHeight: 0, maxHeight: '100%', overflowY: 'auto', overscrollBehaviorY: 'contain' }}>
              <Stack spacing={0.75} sx={{ pt: 1, px: 0.5 }}>
                {brushShapeControl}
                {/* 手机让笔刷与颜色各占一行，避免长标签挤掉滑块。 */}
                <Box sx={{ display: 'grid', gap: 0.75 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 72 }}>{brushSizeLabel}</Typography>
                    <Slider
                      size="small"
                      value={brushSize}
                      min={isMask ? 8 : 4} max={isMask ? 520 : 128} step={isMask ? 8 : 1}
                      valueLabelDisplay="auto"
                      aria-label={brushSizeLabel}
                      onChange={(_, value) => onBrushSizeChange(value)}
                    />
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{overlayColorLabel}</Typography>
                    <Box
                      component="input"
                      type="color"
                      value={overlayColor}
                      onChange={(event) => onOverlayColorChange(event.target.value)}
                      sx={{
                        width: 28,
                        height: 28,
                        p: 0,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        borderRadius: 1,
                        backgroundColor: 'transparent',
                        cursor: 'pointer',
                      }}
                    />
                  </Box>
                </Box>

                {/* Overlay opacity */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 72 }}>{overlayOpacityLabel}</Typography>
                  <Slider
                    size="small"
                    value={overlayOpacity}
                    min={0.05} max={1} step={0.05}
                    onChange={(_, value) => onOverlayOpacityChange(value)}
                  />
                </Box>

                {/* Expand pixels */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 48 }}>{t('painting.workspace.inpaint.expandPixels')}</Typography>
                  <Slider
                    size="small"
                    value={expandPixels}
                    min={0} max={32} step={1}
                    onChange={(_, value) => onExpandPixelsChange(value)}
                  />
                </Box>

                {/* Additional Settings (Mobile Only) */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25, '& .MuiTypography-root': { whiteSpace: 'nowrap' } }}>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={disabledOriginalImage}
                        onChange={(event) => onDisabledOriginalImageChange(event.target.checked)}
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
                        onChange={(event) => onColorCorrectChange(event.target.checked)}
                      />
                    }
                    label={<Typography variant="caption">{t('painting.workspace.inpaint.colorCorrection')}</Typography>}
                  />
                </Box>

                {/* Inpaint strength */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 48 }}>{t('painting.workspace.inpaint.referenceStrength')}</Typography>
                  <Slider
                    size="small"
                    value={inpaintStrength}
                    min={0.01} max={1} step={0.01}
                    onChange={(_, value) => onInpaintStrengthChange(value)}
                  />
                  <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right' }}>{inpaintStrength.toFixed(2)}</Typography>
                </Box>
              </Stack>
            </Collapse>
          </>
        ) : (
          /* ---- Desktop: original horizontal layout with sliders ---- */
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              onClick={cycleToolMode}
              startIcon={<CurrentToolIcon fontSize="small" />}
              sx={{ minWidth: 92, justifyContent: 'flex-start' }}
            >
              {t(currentToolMeta.labelKey)}
            </Button>

            <Button
              size="small"
              variant="outlined"
              color="primary"
              onClick={togglePaintTarget}
              startIcon={<LayersIcon fontSize="small" />}
              sx={{ minWidth: 108, justifyContent: 'flex-start' }}
            >
              {currentPaintTargetLabel}
            </Button>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 150, flex: '1 1 150px' }}>
              <Box sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>{brushSizeLabel}</Box>
              <Slider value={brushSize} min={isMask ? 8 : 4} max={isMask ? 520 : 128} step={isMask ? 8 : 1} valueLabelDisplay="auto" aria-label={brushSizeLabel} onChange={(_, value) => onBrushSizeChange(value)} />
            </Box>

            {brushShapeControl}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>{overlayColorLabel}</Box>
              <Box
                component="input"
                type="color"
                value={overlayColor}
                onChange={(event) => onOverlayColorChange(event.target.value)}
                sx={{
                  width: 34,
                  height: 34,
                  p: 0,
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                }}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 150, flex: '1 1 150px' }}>
              <Box sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>{overlayOpacityLabel}</Box>
              <Slider value={overlayOpacity} min={0.05} max={1} step={0.05} onChange={(_, value) => onOverlayOpacityChange(value)} />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 160, flex: '1 1 160px' }}>
              <Box sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>{t('painting.workspace.inpaint.expandPixels')}</Box>
              <Slider value={expandPixels} min={0} max={32} step={1} onChange={(_, value) => onExpandPixelsChange(value)} />
            </Box>
          </Box>
        )}
      </Stack>
    </Paper>
  );
};

export default InpaintControls;
