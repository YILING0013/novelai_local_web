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
} from '@mui/material';
import {
  Brush as BrushIcon,
  CleaningServices as EraserIcon,
  CropSquare as CropSquareIcon,
  Layers as LayersIcon,
  OpenWith as OpenWithIcon,
  PanTool as PanToolIcon,
  ExpandMore as ExpandMoreIcon,
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
      }}
    >
      <Stack spacing={0.75}>
        {/* ---- Mobile: compact toolbar row with collapsible detail ---- */}
        {isMobile ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
              {/* Tool mode: paint / erase / rect (cycle button) */}
              <Button
                size="small"
                variant={!isMoveMode ? 'contained' : 'outlined'}
                color="primary"
                onClick={() => {
                  if (isMoveMode) {
                    onInteractionModeChange(toolMode);
                  } else {
                    cycleToolMode();
                  }
                }}
                startIcon={<CurrentToolIcon fontSize="small" />}
                sx={{ minWidth: 72, justifyContent: 'flex-start' }}
              >
                {t(currentToolMeta.labelKey)}
              </Button>

              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={togglePaintTarget}
                startIcon={<LayersIcon fontSize="small" />}
                sx={{ minWidth: 102, justifyContent: 'flex-start' }}
              >
                {currentPaintTargetLabel}
              </Button>

              {/* Movement mode: move-global (drag+zoom via pinch) */}
              <Button
                size="small"
                variant={interactionMode === 'move-global' ? 'contained' : 'outlined'}
                onClick={() => onInteractionModeChange('move-global')}
                startIcon={<OpenWithIcon fontSize="small" />}
                sx={{ minWidth: 72, justifyContent: 'flex-start' }}
              >
                {t('painting.workspace.inpaint.drag')}
              </Button>

              {/* Canvas / Viewport toggle */}
              <Button
                size="small"
                variant={(interactionMode === 'move-scene' || interactionMode === 'move-viewport') ? 'contained' : 'outlined'}
                onClick={() => {
                  if (interactionMode === 'move-scene' || interactionMode === 'move-viewport') {
                    cycleMovementMode();
                  } else {
                    onInteractionModeChange('move-scene');
                  }
                }}
                startIcon={<PanToolIcon fontSize="small" />}
                sx={{ minWidth: 72, justifyContent: 'flex-start' }}
              >
                {movementMode === 'move-scene'
                  ? t('painting.workspace.inpaint.canvas')
                  : t('painting.workspace.inpaint.viewport')}
              </Button>

              <Box sx={{ flex: 1 }} />

              {/* Expand / collapse parameter details */}
              <IconButton
                aria-label={toolsExpanded
                  ? t('painting.workspace.inpaint.collapseTools')
                  : t('painting.workspace.inpaint.expandTools')}
                size="small"
                onClick={() => setToolsExpanded((prev) => !prev)}
                sx={{
                  transform: toolsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              >
                <ExpandMoreIcon fontSize="small" />
              </IconButton>
            </Box>

            <Collapse in={toolsExpanded} timeout="auto" unmountOnExit>
              <Stack spacing={0.75} sx={{ pt: 1, px: 0.5 }}>
                {/* Brush size and Overlay color in one line */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 72 }}>{brushSizeLabel}</Typography>
                    <Slider 
                      size="small"
                      value={brushSize} 
                      min={4} max={128} step={1} 
                      onChange={(_, value) => onBrushSizeChange(value)} 
                    />
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
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
              <Slider value={brushSize} min={4} max={128} step={1} onChange={(_, value) => onBrushSizeChange(value)} />
            </Box>

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
