"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Close as CloseIcon,
  GridOn as GridOnIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { fitCharacterPositionCanvas } from '../../utils/characterPositionCanvas.mjs';
import { resolveCharacterName } from '../../utils/characterName.mjs';
import { normalizeNovelAICharacterCenter } from '../../utils/modelUtils';

const markerColors = ['#D81B60', '#8E24AA', '#5E35B1', '#1E88E5', '#00897B', '#FB8C00'];

/**
 * 在图像展示区级别的等比画布上编辑 NovelAI V5 角色坐标。
 *
 * @param {object} props 位置编辑器属性。
 * @returns {React.ReactElement} 角色位置编辑对话框。
 */
const CharacterPositionEditorDialog = ({
  open,
  onClose,
  characterTabs,
  onCharacterDataChange,
  width,
  height,
}) => {
  const { t } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [canvasHost, setCanvasHost] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const activeCharacters = useMemo(() => (
    characterTabs
      .map((character, index) => ({ character, index }))
      .filter(({ character }) => character.isTemporarilyDisabled !== true)
  ), [characterTabs]);

  useEffect(() => {
    if (!open) return;
    const selectedStillExists = activeCharacters.some(({ index }) => index === selectedIndex);
    if (!selectedStillExists) {
      setSelectedIndex(activeCharacters[0]?.index ?? null);
    }
  }, [activeCharacters, open, selectedIndex]);

  useEffect(() => {
    if (!open || !canvasHost) return undefined;

    const updateCanvasSize = (hostWidth, hostHeight) => {
      setCanvasSize(fitCharacterPositionCanvas(hostWidth, hostHeight, width, height));
    };

    const initialRect = canvasHost.getBoundingClientRect();
    updateCanvasSize(initialRect.width, initialRect.height);
    const observer = new ResizeObserver(([entry]) => {
      updateCanvasSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(canvasHost);
    return () => observer.disconnect();
  }, [canvasHost, height, open, width]);

  const handleCanvasClick = (event) => {
    if (selectedIndex === null || !characterTabs[selectedIndex]) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const center = normalizeNovelAICharacterCenter({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
    onCharacterDataChange(selectedIndex, {
      ...characterTabs[selectedIndex],
      center,
    });
  };

  const selectedCharacter = selectedIndex === null ? null : characterTabs[selectedIndex];
  const selectedCenter = normalizeNovelAICharacterCenter(
    selectedCharacter?.center,
    selectedCharacter?.position,
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      fullWidth
      maxWidth="lg"
      PaperProps={{
        sx: {
          height: isMobile ? '100%' : 'min(88vh, 860px)',
          maxHeight: isMobile ? '100%' : 'calc(100vh - 48px)',
          borderRadius: isMobile ? 0 : 2.5,
        },
      }}
    >
      <DialogTitle sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="div">
              {t('painting.workspace.parameters.customPositionEditor')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('painting.workspace.parameters.customPositionEditorHelp')}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label={t('painting.workspace.actions.close')}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          p: { xs: 1, sm: 1.5 },
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            flex: '0 0 auto',
            overflowX: 'auto',
            pb: 1,
            scrollbarWidth: 'thin',
          }}
        >
          {activeCharacters.map(({ character, index }) => {
            const selected = selectedIndex === index;
            const label = resolveCharacterName(
              character.name,
              t('painting.workspace.parameters.defaultCharacterName', { index: index + 1 }),
            );
            return (
              <Button
                key={index}
                variant={selected ? 'contained' : 'outlined'}
                onClick={() => setSelectedIndex(index)}
                startIcon={(
                  <Box
                    component="span"
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: selected ? 'common.white' : markerColors[(character.colorId ?? index) % markerColors.length],
                      color: selected ? 'primary.main' : 'common.white',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </Box>
                )}
                sx={{ flex: '0 0 auto', textTransform: 'none', maxWidth: 180 }}
              >
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Box>
              </Button>
            );
          })}
        </Stack>

        <Box
          ref={setCanvasHost}
          sx={{
            flex: 1,
            minHeight: { xs: 240, sm: 320 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {activeCharacters.length === 0 ? (
            <Paper variant="outlined" sx={{ px: 2, py: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">
                {t('painting.workspace.parameters.noEnabledCharactersForPosition')}
              </Typography>
            </Paper>
          ) : (
            <Box
              component="button"
              type="button"
              onClick={handleCanvasClick}
              aria-label={t('painting.workspace.parameters.positionCanvasLabel')}
              sx={{
                position: 'relative',
                width: `${canvasSize.width}px`,
                height: `${canvasSize.height}px`,
                // MUI 会把数值 1 转换为 100%，这里必须显式使用像素单位。
                minWidth: '1px',
                minHeight: '1px',
                flex: '0 0 auto',
                boxSizing: 'border-box',
                p: 0,
                overflow: 'hidden',
                cursor: 'crosshair',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                boxShadow: theme.shadows[3],
                bgcolor: 'background.paper',
                backgroundImage: `linear-gradient(45deg, ${alpha(theme.palette.text.primary, 0.055)} 25%, transparent 25%), linear-gradient(-45deg, ${alpha(theme.palette.text.primary, 0.055)} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${alpha(theme.palette.text.primary, 0.055)} 75%), linear-gradient(-45deg, transparent 75%, ${alpha(theme.palette.text.primary, 0.055)} 75%)`,
                backgroundSize: '32px 32px',
                backgroundPosition: '0 0, 0 16px, 16px -16px, -16px 0px',
                '&:focus-visible': {
                  outline: '3px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                },
              }}
            >
              {activeCharacters.map(({ character, index }) => {
                const center = normalizeNovelAICharacterCenter(character.center, character.position);
                const selected = selectedIndex === index;
                const markerColor = markerColors[(character.colorId ?? index) % markerColors.length];
                return (
                  <Box
                    key={index}
                    component="span"
                    sx={{
                      position: 'absolute',
                      left: `${center.x * 100}%`,
                      top: `${center.y * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      width: selected ? 36 : 30,
                      height: selected ? 36 : 30,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: selected ? 'common.white' : markerColor,
                      color: selected ? markerColor : 'common.white',
                      border: '2px solid',
                      borderColor: markerColor,
                      boxShadow: theme.shadows[selected ? 5 : 2],
                      fontSize: selected ? '0.85rem' : '0.75rem',
                      fontWeight: 800,
                      pointerEvents: 'none',
                      transition: 'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease',
                    }}
                  >
                    {index + 1}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>

        {selectedCharacter && (
          <Typography variant="caption" color="text.secondary" sx={{ flex: '0 0 auto', pt: 1, textAlign: 'center' }}>
            {t('painting.workspace.parameters.normalizedCoordinates', {
              x: selectedCenter.x.toFixed(3),
              y: selectedCenter.y.toFixed(3),
            })}
          </Typography>
        )}
      </DialogContent>

      <DialogActions sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1.25 }}>
        <Button variant="contained" onClick={onClose} startIcon={<GridOnIcon />}>
          {t('painting.workspace.parameters.finishPositionEditing')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CharacterPositionEditorDialog;
