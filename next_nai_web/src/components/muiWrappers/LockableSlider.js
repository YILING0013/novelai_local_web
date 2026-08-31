// LockableSlider.jsx - 带锁定机制的滑块组件
import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Slider,
  Typography,
  Tooltip,
  alpha,
  useMediaQuery,
  useTheme,
  IconButton
} from '@mui/material';
import {
  Info as InfoIcon,
  LockOpen as LockOpenIcon,
  Lock as LockIcon
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const LockableSlider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  tooltip,
  marks = false,
  valueLabelFormat = null
}) => {
  const theme = useTheme();
  const { t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [isLocked, setIsLocked] = useState(true);
  const timeoutRef = useRef(null);
  const clickStartTimeRef = useRef(0);
  const sliderContainerRef = useRef(null);
  
  // 如果是非移动端，则不启用锁定机制
  useEffect(() => {
    if (!isMobile) {
      setIsLocked(false);
    }
  }, [isMobile]);
  
  // 处理锁定/解锁点击事件
  const handleSliderClick = (e) => {
    // 只有在移动端才启用锁定机制
    if (!isMobile) return;
    
    // 如果已经解锁，短按不做任何操作
    if (!isLocked) return;
    
    // 记录点击开始时间
    clickStartTimeRef.current = Date.now();
  };
  
  const handleSliderTouchEnd = (e) => {
    // 只有在移动端才启用锁定机制
    if (!isMobile) return;
    
    // 如果已经解锁，不做任何操作
    if (!isLocked) return;
    
    // 计算点击持续时间
    const clickDuration = Date.now() - clickStartTimeRef.current;
    
    // 如果是短按（小于300ms），则解锁滑块
    if (clickDuration < 300) {
      setIsLocked(false);
      
      // 设置自动锁定定时器
      resetLockTimer();
      
      // 阻止事件冒泡，防止触发其他点击事件
      e.stopPropagation();
    }
  };
  
  // 重置锁定计时器
  const resetLockTimer = () => {
    // 清除已有定时器
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // 设置新定时器：3秒后自动锁定
    timeoutRef.current = setTimeout(() => {
      setIsLocked(true);
    }, 3000);
  };
  
  // 处理滑块值变化
  const handleSliderChange = (_, newValue) => {
    // 如果锁定状态，不允许调整滑块
    if (isLocked && isMobile) return;
    
    // 调整值并通知父组件
    onChange(newValue);
    
    // 重置锁定计时器
    resetLockTimer();
  };
  
  // 组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  
  // 手动锁定/解锁滑块
  const toggleLock = (e) => {
    e.stopPropagation();
    setIsLocked(prev => !prev);
    
    // 如果解锁了，设置自动锁定计时器
    if (isLocked) {
      resetLockTimer();
    } else {
      // 如果手动锁定，清除定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }
  };
  
  return (
    <Box sx={{ mt: 0.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
          {label}
          {tooltip && (
            <Tooltip title={tooltip} arrow placement="top">
              <InfoIcon sx={{ ml: 0.5, fontSize: 16, opacity: 0.7 }} />
            </Tooltip>
          )}
        </Typography>
        
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="body2" fontWeight="medium" sx={{ mr: 1 }}>
            {valueLabelFormat ? valueLabelFormat(value) : value}
          </Typography>
          
          {/* 仅在移动设备上显示锁定/解锁按钮 */}
          {isMobile && (
            <IconButton 
              aria-label={isLocked
                ? t('painting.tools.lockableSlider.unlock')
                : t('painting.tools.lockableSlider.lock')}
              size="small" 
              onClick={toggleLock}
              color={isLocked ? "default" : "primary"}
              sx={{ 
                padding: 0.5,
                opacity: 0.8,
                '&:hover': { opacity: 1 }
              }}
            >
              {isLocked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
            </IconButton>
          )}
        </Box>
      </Box>
      
      <Box 
        ref={sliderContainerRef}
        onClick={handleSliderClick}
        onTouchEnd={handleSliderTouchEnd}
        sx={{ 
          position: 'relative',
          opacity: isLocked && isMobile ? 0.6 : 1,
          transition: 'opacity 0.2s',
          cursor: isLocked && isMobile ? 'pointer' : 'auto',
        }}
      >
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={handleSliderChange}
          disabled={isLocked && isMobile}
          valueLabelDisplay={isLocked && isMobile ? "off" : "auto"}
          sx={{ 
            color: isLocked && isMobile ? 'grey.400' : 'primary.main',
            height: 6,
            '& .MuiSlider-thumb': {
              width: isMobile ? 18 : 14,
              height: isMobile ? 18 : 14,
              backgroundColor: isLocked && isMobile ? 'grey.400' : 'primary.main',
              boxShadow: isLocked && isMobile ? 'none' : '0 2px 4px rgba(0,0,0,0.2)',
              '&:hover, &.Mui-focusVisible': {
                boxShadow: `0px 0px 0px 8px ${alpha(
                  theme.palette.primary.main,
                  0.16
                )}`,
              },
            },
            // 在锁定状态下改变轨道颜色
            '& .MuiSlider-rail': {
              opacity: 0.5,
              backgroundColor: isLocked && isMobile ? 'grey.300' : undefined,
            },
            '& .MuiSlider-track': {
              opacity: isLocked && isMobile ? 0.5 : 1,
              backgroundColor: isLocked && isMobile ? 'grey.400' : undefined,
            },
            // 标记
            '& .MuiSlider-mark': {
              backgroundColor: isLocked && isMobile ? 'grey.500' : '#bfbfbf',
            },
          }}
          marks={marks}
          aria-labelledby={`${label}-slider`}
        />
        
        {/* 在锁定状态下显示提示层 */}
        {isLocked && isMobile && (
          <Box 
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 2,
              zIndex: 1,
              pointerEvents: 'none', // 允许点击穿透到下层
            }}
          >
            <Typography 
              variant="caption" 
              sx={{ 
                color: 'text.secondary',
                backgroundColor: 'rgba(10, 10, 10, 0.3)',
                px: 1,
                py: 0.5,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                opacity: 0.9,
              }}
            >
              <LockIcon sx={{ fontSize: 14, mr: 0.5 }} />
              {t('painting.tools.lockableSlider.tapToUnlock')}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default LockableSlider;
