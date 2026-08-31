"use client";

import React, { useState, useEffect } from 'react';
import LockableSlider from '@/components/muiWrappers/LockableSlider';
import {
  Box,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Grid,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  InputAdornment,
  FormControlLabel,
  Checkbox,
  FormGroup,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
  Clear as ClearIcon,
  Tune as TuneIcon,
  AspectRatio as AspectRatioIcon,
  KeyboardArrowUp as ArrowUpIcon,
  KeyboardArrowDown as ArrowDownIcon,
} from '@mui/icons-material';
import { useMediaQuery, useTheme } from '@mui/material';
import ImageReferenceControl from './BasicParametersUI/ImageReferenceControl';
import { setLargeImageMode, findClosestAllowedResolution } from '../../utils/parameterMapping';
import {
  NOVELAI_V5_STANDARD_MAX_STEPS,
  isNovelAIDirectorReferenceModel,
} from '../../utils/modelUtils';
import { useI18n } from '@/i18n/I18nProvider';

// 采样算法选项
const samplerOptions = [
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim_v3', label: 'DDIM' },
];

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

// 噪声调度选项
const noiseScheduleOptions = [
  { value: 'native', labelKey: 'painting.workspace.parameters.noiseNative' },
  { value: 'karras', labelKey: 'painting.workspace.parameters.noiseKarras' },
  { value: 'exponential', labelKey: 'painting.workspace.parameters.noiseExponential' },
  { value: 'polyexponential', labelKey: 'painting.workspace.parameters.noisePolyexponential' },
];

const compactOptionLabelSx = {
  m: 0,
  minHeight: 22,
  '& .MuiCheckbox-root': { p: 0.35 },
  '& .MuiCheckbox-root .MuiSvgIcon-root': { fontSize: 18 },
};

const compactOptionTextSx = {
  fontSize: '0.75rem',
  lineHeight: 1.2,
};

const compactInfoIconSx = {
  ml: 0.35,
  fontSize: 12,
  opacity: 0.7,
};


const BasicParameters = ({
  params,
  handleParamChange,
  handleSeedChange,
  editing,
  tempInputs,
  handleInputFocus,
  handleInputChange,
  handleInputBlur,
  handleSizePresetClick,
  handleClearSeed,
  handleRefreshSeed,
  handleSmeaChange,
  handleDynChange,
  handleResetParamsConfirm,
  expandedPanels,
  onExpandedPanelsChange,
  onReferenceImageChange,
  isV5Model = false,
  // 接收禁用状态
  imageReferenceDisabled,
}) => {
  const { t } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // 初始化状态，如果 params 中已有 use_upscale_credits 则同步
  const [isLargeMode, setIsLargeMode] = useState(!!params.use_upscale_credits);
  const standardMaxSteps = isV5Model ? NOVELAI_V5_STANDARD_MAX_STEPS : 28;

  // 监听 params 变化，确保外部（如缓存加载）改变参数时，UI 状态能同步
  useEffect(() => {
    const shouldBeLargeMode = !!params.use_upscale_credits;
    if (isLargeMode !== shouldBeLargeMode) {
      setIsLargeMode(shouldBeLargeMode);
      setLargeImageMode(shouldBeLargeMode);
    }
  }, [
    isLargeMode,
    params.use_upscale_credits,
  ]);

  const toggleLargeMode = () => {
    const newMode = !isLargeMode;
    setIsLargeMode(newMode);
    setLargeImageMode(newMode);

    // 启用大图模式时，将 use_upscale_credits 添加到 params 并设置为 true
    handleParamChange('use_upscale_credits', newMode);

    // 如果切换回小图模式，检查当前值是否越界并修正
    if (!newMode) {
      // 1. 检查并修正分辨率
      // 这里的 findClosestAllowedResolution 已经在 setLargeImageMode 内部更新了允许列表，所以会返回符合小图模式的最接近值
      const [newWidth, newHeight] = findClosestAllowedResolution(params.width, params.height);

      if (newWidth !== params.width || newHeight !== params.height) {
        handleParamChange('width', newWidth);
        handleParamChange('height', newHeight);
        // 更新输入框的临时状态，确保 UI 立刻刷新
        handleInputChange('width', newWidth.toString());
        handleInputChange('height', newHeight.toString());
      }

      // 2. 检查并修正步数
      if (params.steps > standardMaxSteps) {
        handleParamChange('steps', standardMaxSteps);
      }
    }
  };

  const sizePresets = isLargeMode ? largeSizePresets : standardSizePresets;
  const maxResolution = isLargeMode ? 4096 : 2048;
  const maxSteps = isLargeMode ? 50 : standardMaxSteps;
  const isSmeaUnsupported = params.isV4Model;
  // V4 及以上模型官方不支持 SMEA / SMEA DYN，UI 必须显示为关闭且不可交互。
  const smeaChecked = isSmeaUnsupported ? false : Boolean(params.smea);
  const dynChecked = isSmeaUnsupported ? false : Boolean(params.dyn);
  const autoSmeaChecked = isSmeaUnsupported ? false : Boolean(params.autoSmea);
  const smeaTooltip = isSmeaUnsupported
    ? t('painting.workspace.parameters.smeaUnsupported')
    : t('painting.workspace.parameters.smeaHelp');
  const dynTooltip = isSmeaUnsupported
    ? t('painting.workspace.parameters.smeaDynUnsupported')
    : t('painting.workspace.parameters.smeaDynHelp');

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

  return (
    <Box sx={{ pt: 1 }}>
      {/* 图像尺寸 */}
      <Box sx={{ mt: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('painting.workspace.parameters.imageSize')}
          </Typography>
          <Button
              size="small"
              startIcon={<AspectRatioIcon />}
              onClick={toggleLargeMode}
              color={isLargeMode ? "warning" : "primary"}
              sx={{ fontSize: '0.75rem', py: 0 }}
            >
              {isLargeMode
                ? t('painting.workspace.parameters.disableLargeImageMode')
                : t('painting.workspace.parameters.enableLargeImageMode')}
          </Button>
        </Box>
        <Grid container spacing={1.5}>
          <Grid item xs={6}>
              <TextField
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

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            {sizePresets.map((preset, index) => (
              <Chip
                key={index}
                label={t(preset.labelKey, { width: preset.width, height: preset.height })}
                size="small"
                variant={params.width === preset.width && params.height === preset.height ? "filled" : "outlined"}
                onClick={() => handleSizePresetClick(preset.width, preset.height)}
                color="primary"
                sx={{ borderRadius: 1 }}
              />
            ))}
          </Box>
        </Box>

        {/* Seed 设置与采样算法 */}
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          <Grid item xs={7}>
            <TextField
              label={t('painting.workspace.parameters.seed')}
              value={params.seed}
              onChange={(e) => handleSeedChange(e.target.value)}
              fullWidth
              size="small"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={t('painting.workspace.parameters.clearSeed')} arrow>
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={handleClearSeed}
                        disabled={params.seed === ''}
                      >
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Grid item xs={1} sx={{ display: 'flex', alignItems: 'center' }}>
                      <Tooltip title={t('painting.workspace.parameters.randomSeed')} arrow>
                        <IconButton onClick={() => handleSeedChange(null, true)}>
                          <RefreshIcon />
                        </IconButton>
                      </Tooltip>
                    </Grid>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={5}>
            <FormControl fullWidth size="small">
              <InputLabel id="sampler-select-label">{t('painting.workspace.parameters.sampler')}</InputLabel>
              <Select
                labelId="sampler-select-label"
                value={params.sampler || 'k_euler'}
                onChange={(e) => handleParamChange('sampler', e.target.value)}
                label={t('painting.workspace.parameters.sampler')}
              >
                {samplerOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {/* 采样步数 */}
        <LockableSlider
          label={t('painting.workspace.parameters.samplingSteps')}
          value={params.steps}
          min={1}
          max={maxSteps}
          step={1}
          onChange={(newValue) => handleParamChange('steps', newValue)}
          tooltip={t('painting.workspace.parameters.samplingStepsHelp')}
        />

        {/* 引导比例 */}
        <LockableSlider
          label={t('painting.workspace.parameters.cfgScale')}
          value={params.guidanceScale}
          min={1}
          max={20}
          step={0.1}
          onChange={(newValue) => handleParamChange('guidanceScale', newValue)}
          tooltip={t('painting.workspace.parameters.cfgScaleCreativityHelp')}
          valueLabelFormat={(value) => value.toFixed(1)}
        />

        {/* Prompt Guidance Rescale */}
        <LockableSlider
          label={t('painting.workspace.parameters.promptGuidanceRescale')}
          value={params.promptGuidanceRescale}
          min={0}
          max={1}
          step={0.02}
          onChange={(newValue) => handleParamChange('promptGuidanceRescale', newValue)}
          tooltip={t('painting.workspace.parameters.promptGuidanceRescaleHelp')}
          valueLabelFormat={(value) => value.toFixed(2)}
        />

        {/* 噪声调度 */}
        <Box sx={{ mt: 1.5, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
          <FormControl variant="outlined" size="small" sx={{ flex: 1 }}>
            <InputLabel id="noise-schedule-label">{t('painting.workspace.parameters.noiseSchedule')}</InputLabel>
            <Select
              labelId="noise-schedule-label"
              value={params.noiseSchedule}
              onChange={(e) => handleParamChange('noiseSchedule', e.target.value)}
              label={t('painting.workspace.parameters.noiseSchedule')}
            >
              {noiseScheduleOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* 角色参考仅对 NAI Diffusion 4.5 系列开放。 */}
        {isNovelAIDirectorReferenceModel(params.model) && (
          <ImageReferenceControl
            onReferenceImageChange={onReferenceImageChange}
            disabled={imageReferenceDisabled}
          />
        )}

        {/* 批量生成 */}
        <LockableSlider
          label={t('painting.workspace.parameters.batchSize')}
          value={params.batchSize}
          min={1}
          max={8}
          step={1}
          onChange={(newValue) => handleParamChange('batchSize', newValue)}
          tooltip={t('painting.workspace.parameters.batchSizeHelp')}
          marks={[
            { value: 1, label: '1' },
            { value: 4, label: '4' },
            { value: 8, label: '8' },
          ]}
        />

        {/* 添加专业参数折叠栏 */}
        <Box sx={{ mt: 0.5, mb: 0.5 }}>
          <Accordion
            sx={{
              boxShadow: 'none',
              background: 'transparent',
              border: '1px dashed',
              borderColor: 'divider',
              '&:before': { display: 'none' },
              borderRadius: 1,
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
              sx={{
                minHeight: 30,
                height: 30,
                p: 0,
                pl: 0.75,
                '&.Mui-expanded': { minHeight: 30 },
                '& .MuiAccordionSummary-content': { margin: 0 },
                '& .MuiAccordionSummary-content.Mui-expanded': { margin: 0 },
                '& .MuiAccordionSummary-expandIconWrapper': { mr: 0.25 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography color="text.secondary" sx={{ fontSize: '0.72rem', lineHeight: 1.2 }}>
                  {t('painting.workspace.parameters.extraConfiguration')}
                </Typography>
                <Tooltip title={t('painting.workspace.parameters.extraConfigurationWarning')} arrow placement="right">
                  <InfoIcon sx={{ ml: 0.35, fontSize: 12, opacity: 0.6 }} />
                </Tooltip>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 1, pt: 0 }}>
              <Typography color="text.secondary" sx={{ display: 'block', mb: 0.65, mt: 0.25, fontSize: '0.7rem', lineHeight: 1.25, fontStyle: 'italic' }}>
                {t('painting.workspace.parameters.experimentalWarning')}
              </Typography>

              <Box sx={{ mb: 0.75 }}>
                <Typography color="text.secondary" fontWeight="medium" sx={{ mb: 0.25, display: 'block', fontSize: '0.72rem', lineHeight: 1.2 }}>
                  {t('painting.workspace.parameters.compatibilitySettings')}
                </Typography>
                <FormGroup sx={{ pl: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={params.legacy}
                          onChange={(e) => handleParamChange('legacy', e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.legacyCompatibility')}</Typography>
                          <Tooltip title={t('painting.workspace.parameters.legacyCompatibilityHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={params.legacy_uc}
                          onChange={(e) => handleParamChange('legacy_uc', e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.legacyPromptConditioning')}</Typography>
                          <Tooltip title={t('painting.workspace.parameters.legacyPromptConditioningHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={params.legacy_v3_extend}
                          onChange={(e) => handleParamChange('legacy_v3_extend', e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.legacyV3Extend')}</Typography>
                          <Tooltip title={t('painting.workspace.parameters.legacyV3ExtendHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />
                  </Box>
                </FormGroup>
              </Box>

              <Box sx={{ mb: 0.25 }}>
                <Typography color="text.secondary" fontWeight="medium" sx={{ mb: 0.25, display: 'block', fontSize: '0.72rem', lineHeight: 1.2 }}>
                  {t('painting.workspace.parameters.specialFeatures')}
                </Typography>
                <FormGroup sx={{ pl: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={smeaChecked}
                          onChange={handleSmeaChange}
                          disabled={isSmeaUnsupported}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>SMEA</Typography>
                          <Tooltip title={smeaTooltip} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={dynChecked}
                          onChange={handleDynChange}
                          disabled={isSmeaUnsupported || !smeaChecked}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>DYN</Typography>
                          <Tooltip title={dynTooltip} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={params.variety}
                          onChange={(e) => handleParamChange('variety', e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.variety')}</Typography>
                          <Tooltip title={t('painting.workspace.parameters.varietyHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={params.decrisp}
                          onChange={(e) => handleParamChange('decrisp', e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.decrisp')}</Typography>
                          <Tooltip title={t('painting.workspace.parameters.decrispHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={autoSmeaChecked}
                          onChange={(e) => handleParamChange('autoSmea', e.target.checked)}
                          disabled={isSmeaUnsupported}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.autoSmea')}</Typography>
                          <Tooltip title={isSmeaUnsupported
                            ? t('painting.workspace.parameters.autoSmeaUnsupported')
                            : t('painting.workspace.parameters.autoSmeaHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={params.prefer_brownian}
                          onChange={(e) => handleParamChange('prefer_brownian', e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.brownianMotion')}</Typography>
                          <Tooltip title={t('painting.workspace.parameters.brownianMotionHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={params.deliberate_euler_ancestral_bug}
                          onChange={(e) => handleParamChange('deliberate_euler_ancestral_bug', e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography sx={compactOptionTextSx}>{t('painting.workspace.parameters.preserveSamplerBug')}</Typography>
                          <Tooltip title={t('painting.workspace.parameters.preserveSamplerBugHelp')} arrow>
                            <InfoIcon sx={compactInfoIconSx} />
                          </Tooltip>
                        </Box>
                      }
                      sx={compactOptionLabelSx}
                    />
                  </Box>
                </FormGroup>
              </Box>
            </AccordionDetails>
          </Accordion>
        </Box>

        {/* 添加重置参数按钮 */}
        <Box sx={{ display: 'flex', justifyContent: 'right', width: '100%' }}>
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            startIcon={<RefreshIcon fontSize="small" />}
            onClick={handleResetParamsConfirm}
            sx={{
              mt: 1,
              fontSize: '0.75rem',
              opacity: 0.8,
              '&:hover': { opacity: 1 }
            }}
          >
            {t('painting.workspace.parameters.resetAllDefaults')}
          </Button>
        </Box>
    </Box>
  );
};

export default BasicParameters;
