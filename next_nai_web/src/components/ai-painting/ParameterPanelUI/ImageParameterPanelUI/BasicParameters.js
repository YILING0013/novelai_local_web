"use client";

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import GenerationParameterBar from './GenerationParameterBar';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  IconButton,
  Chip,
  InputAdornment,
} from '@mui/material';
import {
  AspectRatio as AspectRatioIcon,
  KeyboardArrowUp as ArrowUpIcon,
  KeyboardArrowDown as ArrowDownIcon,
} from '@mui/icons-material';
import { useMediaQuery, useTheme } from '@mui/material';
import { setLargeImageMode, findClosestAllowedResolution } from '../../utils/parameterMapping';
import { NOVELAI_V5_MEDIUM_DEFAULT_PARAMS, NOVELAI_V5_MEDIUM_MODEL_ID, NOVELAI_V5_STANDARD_MAX_STEPS } from '../../utils/modelUtils';
import { useI18n } from '@/i18n/I18nProvider';

// 普通尺寸预设
const standardSizePresets = [
  { width: 1024, height: 1024, labelKey: 'painting.workspace.parameters.squareSize' },
  { width: 1216, height: 832, labelKey: 'painting.workspace.parameters.landscapeSize' },
  { width: 832, height: 1216, labelKey: 'painting.workspace.parameters.portraitSize' },
];

// 大图模式尺寸预设 (3MP+)
const largeSizePresets = [
  { width: 1472, height: 1472, labelKey: 'painting.workspace.parameters.squareSize' },
  { width: 1536, height: 1024, labelKey: 'painting.workspace.parameters.landscapeSize' },
  { width: 1024, height: 1536, labelKey: 'painting.workspace.parameters.portraitSize' },
];

const BasicParameters = ({
  params,
  resolutionAction = null,
  handleParamChange,
  handleSeedChange,
  editing,
  tempInputs,
  handleInputFocus,
  handleInputChange,
  handleInputBlur,
  handleSizePresetClick,
  handleClearSeed,
  handleSmeaChange,
  handleDynChange,
  handleResetParamsConfirm,
  parameterToolbarContainer = null,
  isV5Model = false,
}) => {
  const fieldId = React.useId();
  const { t } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isLargeMode = !!params.use_upscale_credits;
  const isV5Medium = params.model === NOVELAI_V5_MEDIUM_MODEL_ID;
  const standardMaxSteps = isV5Model ? NOVELAI_V5_STANDARD_MAX_STEPS : 28;

  useEffect(() => {
    setLargeImageMode(isLargeMode);
  }, [isLargeMode]);

  useEffect(() => {
    if (!isV5Medium) return;
    Object.entries(NOVELAI_V5_MEDIUM_DEFAULT_PARAMS).forEach(([field, value]) => {
      if (params[field] !== value) handleParamChange(field, value);
    });
  }, [handleParamChange, isV5Medium, params]);

  // 按实际参数收紧范围，兼顾按钮切换、外部参数回传和缓存加载。
  // 仅改变 Slider 的 max 会夹住圆点位置，右侧数值和生成请求仍可能保留旧步数。
  useEffect(() => {
    if (isLargeMode) return;

    const [newWidth, newHeight] = findClosestAllowedResolution(params.width, params.height);
    if (newWidth !== params.width || newHeight !== params.height) {
      handleParamChange('width', newWidth);
      handleParamChange('height', newHeight);
      handleInputChange('width', newWidth.toString());
      handleInputChange('height', newHeight.toString());
    }
    if (params.steps > standardMaxSteps) {
      handleParamChange('steps', standardMaxSteps);
    }
  }, [
    isLargeMode,
    params.width,
    params.height,
    params.steps,
    standardMaxSteps,
    handleParamChange,
    handleInputChange,
  ]);

  const toggleLargeMode = () => {
    handleParamChange('use_upscale_credits', !isLargeMode);
  };

  const sizePresets = isLargeMode ? largeSizePresets : standardSizePresets;
  const maxResolution = isLargeMode ? 4096 : 2048;
  const maxSteps = isLargeMode ? 50 : standardMaxSteps;
  const adjustDimension = (field, delta) => {
    const baseValue = parseInt(editing[field] ? tempInputs[field] : params[field], 10);
    const fallbackValue = Number.isNaN(baseValue) ? params[field] : baseValue;
    const nextValue = Math.min(maxResolution, Math.max(512, fallbackValue + delta));
    handleInputChange(field, nextValue.toString());
  };

  const renderDimensionAdornment = (field) => (
    <InputAdornment position="end" sx={{ ml: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        <Typography variant="caption" color="text.secondary">px</Typography>
        {isMobile && (
          <Box sx={{ display: 'flex', flexDirection: 'column', ml: 0.25 }}>
            <IconButton
              size="small"
              edge="end"
              onClick={() => adjustDimension(field, 64)}
              sx={{ p: 0.15 }}
            >
              <ArrowUpIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              size="small"
              edge="end"
              onClick={() => adjustDimension(field, -64)}
              sx={{ p: 0.15 }}
            >
              <ArrowDownIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        )}
      </Box>
    </InputAdornment>
  );

  // 通过 Portal 移动控件位置，尺寸限制和所有参数修改仍由当前面板统一管理。
  const parameterBar = <GenerationParameterBar
    params={params}
    maxSteps={maxSteps}
    isV5Medium={isV5Medium}
    handleParamChange={handleParamChange}
    handleSeedChange={handleSeedChange}
    handleClearSeed={handleClearSeed}
    handleSmeaChange={handleSmeaChange}
    handleDynChange={handleDynChange}
    handleResetParamsConfirm={handleResetParamsConfirm}
  />;
  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      pt: 1,
      '& .MuiInputBase-root': { fontSize: '0.9375rem' },
      '& .MuiOutlinedInput-root': { minHeight: 44 },
      '& .MuiOutlinedInput-input': { py: 1.25 },
    }}>
      {/* 图像尺寸 */}
      <Box sx={{
        '& .MuiOutlinedInput-root': { minHeight: 40 },
        '& .MuiOutlinedInput-input': { py: 1 },
      }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ fontSize: '0.9375rem', fontWeight: 600, flexShrink: 0 }}>
            {t('painting.workspace.parameters.imageSize')}
          </Typography>
          {resolutionAction}
          </Box>
          <Button
              size="small"
              startIcon={<AspectRatioIcon />}
              onClick={toggleLargeMode}
              color={isLargeMode ? "warning" : "primary"}
              sx={{ minHeight: 30, fontSize: '0.875rem', px: 1, py: 0.25 }}
            >
              {isLargeMode
                ? t('painting.workspace.parameters.disableLargeImageMode')
                : t('painting.workspace.parameters.enableLargeImageMode')}
          </Button>
        </Box>
        <Grid container spacing={1.5}>
          <Grid item xs={6}>
              <TextField
                id={`${fieldId}-width`}
                label={t('painting.workspace.parameters.widthShort')}
                type="number"
                value={editing.width ? tempInputs.width : params.width}
                onChange={(e) => handleInputChange('width', e.target.value)}
                onFocus={() => handleInputFocus('width')}
                onBlur={() => handleInputBlur('width')}
                size="small"
                fullWidth
                InputProps={{
                  endAdornment: renderDimensionAdornment('width'),
                  inputProps: { step: 64, min: 64, max: maxResolution }
                }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                id={`${fieldId}-height`}
                label={t('painting.workspace.parameters.heightShort')}
                type="number"
                value={editing.height ? tempInputs.height : params.height}
                onChange={(e) => handleInputChange('height', e.target.value)}
                onFocus={() => handleInputFocus('height')}
                onBlur={() => handleInputBlur('height')}
                size="small"
                fullWidth
                InputProps={{
                  endAdornment: renderDimensionAdornment('height'),
                  inputProps: { step: 64, min: 64, max: maxResolution }
                }}
              />
            </Grid>
          </Grid>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {sizePresets.map((preset, index) => (
              <Chip
                key={index}
                label={t(preset.labelKey, { width: preset.width, height: preset.height })}
                size="small"
                variant={params.width === preset.width && params.height === preset.height ? "filled" : "outlined"}
                onClick={() => handleSizePresetClick(preset.width, preset.height)}
                color="primary"
                sx={{
                  borderRadius: 1,
                  flex: '1 0 auto',
                  height: 28,
                  '& .MuiChip-label': { px: 0.75, fontSize: '0.75rem', lineHeight: 1.25, whiteSpace: 'nowrap' },
                }}
              />
            ))}
          </Box>
        </Box>

      {parameterToolbarContainer ? createPortal(parameterBar, parameterToolbarContainer) : parameterBar}
    </Box>
  );
};

export default BasicParameters;
