// ImageEditor/ColorizeMode.js - 修复参数导出
import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  Paper,
  Slider,
  Chip,
  Divider
} from '@mui/material';
import {
  Palette as PaletteIcon,
  ColorLens as ColorLensIcon
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

// 强度对应文案 - 与EmotionMode保持一致
const intensityMap = {
  0: "Normal",
  1: "Slightly Weak",
  2: "Weak",
  3: "Even Weaker",
  4: "Very Weak",
  5: "Weakest"
};

// 预设颜色风格 - 移到组件外部以避免依赖问题
const colorPresets = [
  { id: 'vibrant', labelKey: 'painting.tools.imageEditor.colorize.presets.vibrant' },
  { id: 'pastel', labelKey: 'painting.tools.imageEditor.colorize.presets.pastel' },
  { id: 'monochrome', labelKey: 'painting.tools.imageEditor.colorize.presets.monochrome' },
  { id: 'warm', labelKey: 'painting.tools.imageEditor.colorize.presets.warm' },
  { id: 'cool', labelKey: 'painting.tools.imageEditor.colorize.presets.cool' },
  { id: 'vintage', labelKey: 'painting.tools.imageEditor.colorize.presets.vintage' },
  { id: 'neon', labelKey: 'painting.tools.imageEditor.colorize.presets.neon' },
  { id: 'autumn', labelKey: 'painting.tools.imageEditor.colorize.presets.autumn' },
  { id: 'winter', labelKey: 'painting.tools.imageEditor.colorize.presets.winter' }
];

const ColorizeMode = ({ isMobile, theme, inSidePanel = false, onSaveParams }) => {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [intensity, setIntensity] = useState(0);
  const [presetSelected, setPresetSelected] = useState('');

  // 使用 useMemo 记忆参数对象，避免不必要的重新渲染
  const params = useMemo(() => ({
    prompt: prompt,
    intensity: intensity,
    intensityText: intensityMap[intensity],
    preset: presetSelected ? colorPresets.find(p => p.id === presetSelected) : null
  }), [prompt, intensity, presetSelected]);

  // 当参数变化时，通知父组件
  useEffect(() => {
    if (typeof onSaveParams === 'function') {
      onSaveParams(params);
    }
  }, [params, onSaveParams]);

  const handlePresetClick = (presetId) => {
    if (presetId === presetSelected) {
      // 取消选择
      setPresetSelected('');
      setPrompt('');
    } else {
      setPresetSelected(presetId);
      setPrompt(presetId);
    }
  };

  const contentComponent = (
    <>
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        mb: 2.5
      }}>
        <Typography variant="h6" component="h2" sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          fontWeight: 'bold',
          color: theme.palette.text.primary
        }}>
          <PaletteIcon sx={{ mr: 1, color: theme.palette.primary.main }} />
          {t('painting.tools.imageEditor.colorize.title')}
        </Typography>
        
        <Chip 
          label={`${intensity} - ${t(`painting.tools.imageEditor.intensity.${intensity}`)}`}
          color="primary" 
          variant="outlined"
          sx={{ 
            fontWeight: 'bold',
            fontSize: '0.875rem',
            height: 32
          }}
        />
      </Box>
      
      <Divider sx={{ mb: 2 }} />
      
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* 预设颜色风格选择 */}
        <Box>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 'medium' }}>
            {t('painting.tools.imageEditor.colorize.presetLabel')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {colorPresets.map((preset) => (
              <Chip
                key={preset.id}
                label={t(preset.labelKey)}
                onClick={() => handlePresetClick(preset.id)}
                variant={presetSelected === preset.id ? "filled" : "outlined"}
                color={presetSelected === preset.id ? "secondary" : "default"}
                sx={{ 
                  borderRadius: 1.5,
                  '&:hover': {
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  },
                  transition: 'all 0.2s'
                }}
              />
            ))}
          </Box>
        </Box>
        
        <Divider />
        
        {/* 自定义提示词输入 */}
        <TextField
          label={t('painting.tools.imageEditor.colorize.customPrompt')}
          variant="outlined"
          size="small"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          fullWidth
          placeholder={t('painting.tools.imageEditor.colorize.promptPlaceholder')}
          sx={{ 
            '& .MuiOutlinedInput-root': {
              borderRadius: 1.5
            }
          }}
          InputProps={{
            startAdornment: <ColorLensIcon sx={{ mr: 1, color: theme.palette.action.active }} />
          }}
        />
        
        {/* 强度调节 */}
        <Box>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 'medium' }}>
            {t('painting.tools.imageEditor.colorize.intensity')}
          </Typography>
          
          <Slider
            value={intensity}
            min={0}
            max={5}
            step={1}
            onChange={(e, value) => setIntensity(value)}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => t(`painting.tools.imageEditor.intensity.${value}`)}
            marks={[
              { value: 0, label: '0' },
              { value: 1, label: '1' },
              { value: 2, label: '2' },
              { value: 3, label: '3' },
              { value: 4, label: '4' },
              { value: 5, label: '5' },
            ]}
            sx={{
              color: theme.palette.secondary.main,
              '& .MuiSlider-thumb': {
                '&:hover, &.Mui-focusVisible': {
                  boxShadow: `0px 0px 0px 8px ${theme.palette.secondary.main}30`
                }
              }
            }}
          />
          
          <Box sx={{ 
            mt: 2,
            p: 1.5,
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
              {t('painting.tools.imageEditor.colorize.intensityHelpTitle')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, textAlign: 'center' }}>
              {t('painting.tools.imageEditor.colorize.intensityHelp')}
            </Typography>
          </Box>
        </Box>
      </Box>
      
      {/* 当前参数预览 */}
      <Box sx={{ mt: 3, p: 1.5, borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t('painting.tools.imageEditor.currentParameters')}
        </Typography>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 0.5, fontSize: '0.75rem' }}>
          {presetSelected && (
            <>
              <Box component="dt" sx={{ fontWeight: 'bold' }}>{t('painting.tools.imageEditor.colorize.preset')}:</Box>
              <Box component="dd" sx={{ m: 0 }}>
                {t(colorPresets.find(p => p.id === presetSelected)?.labelKey) || presetSelected}
              </Box>
            </>
          )}
          
          <Box component="dt" sx={{ fontWeight: 'bold' }}>{t('painting.tools.imageEditor.strength')}:</Box>
          <Box component="dd" sx={{ m: 0 }}>{intensity} - {t(`painting.tools.imageEditor.intensity.${intensity}`)}</Box>
          
          {prompt && (
            <>
              <Box component="dt" sx={{ fontWeight: 'bold' }}>{t('painting.tools.imageEditor.prompt')}:</Box>
              <Box component="dd" sx={{ m: 0 }}>{prompt}</Box>
            </>
          )}
        </Box>
      </Box>
      
      {/* 移除应用按钮，改为参数自动保存 */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {t('painting.tools.imageEditor.autoApply')}
        </Typography>
      </Box>
    </>
  );

  // 如果在侧边面板中，则使用不同的布局
  if (inSidePanel) {
    return (
      <Paper
        elevation={3}
        sx={{
          p: 2,
          borderRadius: 2,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'auto'
        }}
      >
        {contentComponent}
      </Paper>
    );
  }

  // 原始布局，浮动在图像上
  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        width: isMobile ? '90%' : '500px',
        p: 3,
        borderRadius: 2,
        zIndex: 2,
        backgroundColor: theme.palette.background.paper,
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}
    >
      {contentComponent}
    </Paper>
  );
};

export default ColorizeMode;
