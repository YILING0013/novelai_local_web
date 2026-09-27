// ImageEditor/EmotionMode.js - 修复参数导出
import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  Slider,
  Chip,
  Divider
} from '@mui/material';
import {
  Add as AddIcon,
  Remove as RemoveIcon,
  Mood as MoodIcon
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

// 情绪对应文案
const emotionMap = {
  0: "Normal",
  1: "Slightly Weak",
  2: "Weak",
  3: "Even Weaker",
  4: "Very Weak",
  5: "Weakest"
};

// 情绪选项
const emotionOptions = [
  'neutral', 'happy', 'sad', 'angry', 'surprised', 'disgusted', 'scared', 'confused',
  'tired', 'excited', 'embarrassed', 'shy', 'smug', 'determined', 'bored', 'thinking',
  'nervous', 'laughing', 'irritated', 'aroused', 'worried', 'love', 'hurt', 'playful'
].map((value) => ({ value, labelKey: `painting.tools.imageEditor.emotion.options.${value}` }));

const EmotionMode = ({ isMobile, theme, inSidePanel = false, onSaveParams, initialParams }) => {
  const { t } = useI18n();
  const [selectedEmotion, setSelectedEmotion] = useState(initialParams?.emotion ?? 'neutral');
  const [prompt, setPrompt] = useState(initialParams?.prompt ?? '');
  const [defry, setDefry] = useState(initialParams?.defry ?? 0);

  // 使用 useMemo 记忆参数对象，避免不必要的重新渲染
  const params = useMemo(() => ({
    emotion: selectedEmotion,
    prompt: prompt,
    defry: defry,
    defryText: emotionMap[defry]
  }), [selectedEmotion, prompt, defry]);

  // 当参数变化时，通知父组件
  useEffect(() => {
    if (typeof onSaveParams === 'function') {
      onSaveParams(params);
    }
  }, [params, onSaveParams]);

  const handleDefryIncrease = () => {
    setDefry((prev) => Math.min(prev + 1, 5));
  };

  const handleDefryDecrease = () => {
    setDefry((prev) => Math.max(prev - 1, 0));
  };

  const contentComponent = (
    <>
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1,
        mb: 2.5
      }}>
        <Typography variant="subtitle1" component="h2" sx={{
          display: 'flex', 
          alignItems: 'center', 
          fontSize: 15,
          fontWeight: 600,
          color: theme.palette.text.primary
        }}>
          <MoodIcon sx={{ mr: 1, fontSize: 18, color: 'text.secondary' }} />
          {t('painting.tools.imageEditor.emotion.title')}
        </Typography>
        
        <Chip 
          label={`${defry} - ${t(`painting.tools.imageEditor.intensity.${defry}`)}`}
          variant="outlined"
          sx={{ 
            fontWeight: 500,
            fontSize: '0.875rem',
            height: 32
          }}
        />
      </Box>
      
      <Divider sx={{ mb: 2 }} />
      
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* 情绪选择 */}
        <FormControl fullWidth variant="outlined" size="small">
          <InputLabel id="emotion-select-label">{t('painting.tools.imageEditor.emotion.type')}</InputLabel>
          <Select
            labelId="emotion-select-label"
            id="emotion-select"
            value={selectedEmotion}
            onChange={(e) => setSelectedEmotion(e.target.value)}
            label={t('painting.tools.imageEditor.emotion.type')}
            sx={{ 
              borderRadius: 1.5,
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: theme.palette.mode === 'dark' 
                  ? 'rgba(255, 255, 255, 0.23)' 
                  : 'rgba(0, 0, 0, 0.23)'
              }
            }}
          >
            {emotionOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        
        {/* Prompt 输入 */}
        <TextField
          label={t('painting.tools.imageEditor.promptLabel')}
          variant="outlined"
          size="small"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          fullWidth
          placeholder={t('painting.tools.imageEditor.emotion.promptPlaceholder')}
          sx={{ 
            borderRadius: 1.5,
            '& .MuiOutlinedInput-root': {
              borderRadius: 1.5
            }
          }}
        />
        
        {/* 强度调节 */}
        <Box>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 'medium' }}>
            {t('painting.tools.imageEditor.emotion.intensity')}
          </Typography>
          
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 2 
          }}>
            <Slider
              value={defry}
              min={0}
              max={5}
              step={1}
              onChange={(e, value) => setDefry(value)}
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
                color: theme.palette.primary.main,
                flexGrow: 1,
                '& .MuiSlider-thumb': {
                  '&:hover, &.Mui-focusVisible': {
                    boxShadow: `0px 0px 0px 8px ${theme.palette.primary.main}30`
                  }
                }
              }}
            />
            
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center',
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 1,
              ml: 1
            }}>
              <IconButton 
                size="small" 
                onClick={handleDefryDecrease} 
                disabled={defry === 0}
                sx={{
                  color: theme.palette.text.primary
                }}
              >
                <RemoveIcon fontSize="small" />
              </IconButton>
              
              <Typography 
                variant="body2" 
                sx={{ 
                  width: '30px', 
                  textAlign: 'center',
                  fontWeight: 'bold'
                }}
              >
                {defry}
              </Typography>
              
              <IconButton 
                size="small" 
                onClick={handleDefryIncrease} 
                disabled={defry === 5}
                sx={{
                  color: theme.palette.text.primary
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Box>
      </Box>
      
      {/* 当前参数预览 */}
      <Box sx={{ mt: 3, p: 1.5, borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t('painting.tools.imageEditor.currentParameters')}
        </Typography>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 0.5, fontSize: 14 }}>
          <Box component="dt" sx={{ fontWeight: 'bold' }}>{t('painting.tools.imageEditor.emotion.type')}:</Box>
          <Box component="dd" sx={{ m: 0 }}>
            {t(emotionOptions.find(opt => opt.value === selectedEmotion)?.labelKey) || selectedEmotion}
          </Box>
          
          <Box component="dt" sx={{ fontWeight: 'bold' }}>{t('painting.tools.imageEditor.strength')}:</Box>
          <Box component="dd" sx={{ m: 0 }}>{defry} - {t(`painting.tools.imageEditor.intensity.${defry}`)}</Box>
          
          {prompt && (
            <>
              <Box component="dt" sx={{ fontWeight: 'bold' }}>{t('painting.tools.imageEditor.prompt')}:</Box>
              <Box component="dd" sx={{ m: 0 }}>{prompt}</Box>
            </>
          )}
        </Box>
      </Box>
      
    </>
  );

  // 如果在侧边面板中，则使用不同的布局
  if (inSidePanel) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 0,
          bgcolor: 'transparent',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'auto',
          '& .MuiInputBase-root': { minHeight: 44 },
          '& .MuiIconButton-root': { minWidth: 36, minHeight: 36 }
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

export default EmotionMode;
