// ImageEditor/DrawMode.js
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Slider,
  Tooltip,
  Paper,
  Divider,
  Alert
} from '@mui/material';
import {
  Clear as ClearIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
  Delete as DeleteIcon,
  Palette as PaletteIcon,
  Save as SaveIcon,
  FormatColorFill as ColorFillIcon,
  Contrast as ContrastIcon,
  Colorize as ColorizeIcon
} from '@mui/icons-material';
import { HexColorPicker } from 'react-colorful';
import { useI18n } from '@/i18n/I18nProvider';

// 自定义颜色选择器组件
const ColorPicker = ({ selectedColor, onColorChange, onEyedropperChange, eyedropperActive }) => {
  const { t } = useI18n();
  const [showColorPicker, setShowColorPicker] = useState(false);
  
  // 预设颜色
  const presetColors = [
    '#000000', '#FFFFFF', '#FF0000', '#FF9900', '#FFFF00', 
    '#00FF00', '#00FFFF', '#0000FF', '#9900FF', '#FF00FF',
    '#795548', '#607D8B', '#9E9E9E', '#FFC107', '#8BC34A'
  ];

  // 切换吸管工具
  const toggleEyedropper = () => {
    const newState = !eyedropperActive;
    if (onEyedropperChange) {
      onEyedropperChange(newState);
    }
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        <PaletteIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
        {t('painting.tools.imageEditor.draw.palette')}
      </Typography>
      
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
        {presetColors.map((color) => (
          <Tooltip key={color} title={color} arrow>
            <Box
              sx={{
                width: 24,
                height: 24,
                backgroundColor: color,
                border: selectedColor === color ? '2px solid #ff4081' : '1px solid rgba(0,0,0,0.2)',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'transform 0.2s',
                '&:hover': {
                  transform: 'scale(1.1)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                }
              }}
              onClick={() => onColorChange(color)}
            />
          </Tooltip>
        ))}
      </Box>
      
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button 
            variant="outlined" 
            size="small"
            onClick={() => setShowColorPicker(!showColorPicker)}
            startIcon={<ColorFillIcon />}
            sx={{ 
              textTransform: 'none',
              borderRadius: 1.5
            }}
          >
            {showColorPicker
              ? t('painting.tools.imageEditor.draw.closeColorPicker')
              : t('painting.tools.imageEditor.draw.customColor')}
          </Button>
          <Tooltip title={t('painting.tools.imageEditor.draw.eyedropperTooltip')} arrow>
            <Button
              variant={eyedropperActive ? "contained" : "outlined"}
              size="small"
              color={eyedropperActive ? "secondary" : "primary"}
              onClick={toggleEyedropper}
              startIcon={<ColorizeIcon />}
              sx={{ 
                textTransform: 'none',
                borderRadius: 1.5
              }}
            >
              {t('painting.tools.imageEditor.draw.eyedropper')}
            </Button>
          </Tooltip>
        </Box>
        
        <Box 
          sx={{ 
            width: 32, 
            height: 32, 
            backgroundColor: selectedColor,
            borderRadius: '4px',
            border: '1px solid rgba(0,0,0,0.2)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }} 
        />
      </Box>
      
      {showColorPicker && (
        <Box sx={{ 
          position: 'relative', 
          zIndex: 1000,
          width: '100%',
          mt: 1,
          p: 1,
          borderRadius: 1,
          bgcolor: 'background.paper',
          boxShadow: '0 3px 10px rgba(0,0,0,0.2)'
        }}>
          <HexColorPicker color={selectedColor} onChange={onColorChange} style={{ width: '100%' }} />
        </Box>
      )}
    </Box>
  );
};

const DrawMode = ({ displayDimensions, imageDimensions, onSave, isMobile, theme, inSidePanel = false, canvasRef, sourceImageRef = null }) => {
  const { t } = useI18n();
  const internalCanvasRef = useRef(null);
  // 使用传入的 canvasRef 或内部创建的 ref
  const effectiveCanvasRef = canvasRef || internalCanvasRef;
  
  const [brushSize, setBrushSize] = useState(5);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [isDrawing, setIsDrawing] = useState(false);
  
  // 支持撤销/重做
  const [drawHistory, setDrawHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentPath, setCurrentPath] = useState([]);
  
  // 是否使用橡皮擦模式
  const [eraserMode, setEraserMode] = useState(false);
  
  // 吸管模式
  const [eyedropperMode, setEyedropperMode] = useState(false);

  // 处理吸管工具状态变化
  const handleEyedropperChange = (active) => {
    setEyedropperMode(active);
    if (active) {
      // 启用吸管模式时，暂时禁用橡皮擦模式
      setEraserMode(false);
    }
  };

  // 从画布或图像中获取颜色
  const getColorFromPoint = useCallback((x, y) => {
    // 尝试从原始图像获取颜色
    try {
      const mainCanvas = effectiveCanvasRef.current;
      const image = sourceImageRef?.current;

      if (!mainCanvas) {
        return null;
      }

      const canvasRect = mainCanvas.getBoundingClientRect();
      const scaleX = mainCanvas.width / canvasRect.width;
      const scaleY = mainCanvas.height / canvasRect.height;

      if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        const imageRect = image.getBoundingClientRect();
        const displayX = (imageRect.left - canvasRect.left) * scaleX;
        const displayY = (imageRect.top - canvasRect.top) * scaleY;
        const displayWidth = imageRect.width * scaleX;
        const displayHeight = imageRect.height * scaleY;

        if (displayWidth > 0 && displayHeight > 0) {
          const normalizedX = (x - displayX) / displayWidth;
          const normalizedY = (y - displayY) / displayHeight;

          if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
            return null;
          }

          const sampleCanvas = document.createElement('canvas');
          const sampleCtx = sampleCanvas.getContext('2d');

          if (!sampleCtx) {
            return null;
          }

          const targetWidth = Math.max(1, Math.round(imageDimensions?.width || image.naturalWidth));
          const targetHeight = Math.max(1, Math.round(imageDimensions?.height || image.naturalHeight));

          sampleCanvas.width = targetWidth;
          sampleCanvas.height = targetHeight;
          sampleCtx.drawImage(image, 0, 0, targetWidth, targetHeight);
          sampleCtx.drawImage(
            mainCanvas,
            displayX,
            displayY,
            displayWidth,
            displayHeight,
            0,
            0,
            targetWidth,
            targetHeight
          );

          const sampleX = Math.max(0, Math.min(targetWidth - 1, Math.floor(normalizedX * targetWidth)));
          const sampleY = Math.max(0, Math.min(targetHeight - 1, Math.floor(normalizedY * targetHeight)));
          const pixel = sampleCtx.getImageData(sampleX, sampleY, 1, 1).data;

          if (pixel[3] === 0) {
            return null;
          }

          return `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;
        }
      }

      const sampleCanvas = document.createElement('canvas');
      const sampleCtx = sampleCanvas.getContext('2d');
      if (!sampleCtx) {
        return null;
      }

      sampleCanvas.width = displayDimensions.width;
      sampleCanvas.height = displayDimensions.height;

      const sampleX = Math.max(0, Math.min(sampleCanvas.width - 1, Math.floor(x)));
      const sampleY = Math.max(0, Math.min(sampleCanvas.height - 1, Math.floor(y)));

      if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        sampleCtx.drawImage(image, 0, 0, displayDimensions.width, displayDimensions.height);
      }

      if (mainCanvas) {
        sampleCtx.drawImage(mainCanvas, 0, 0, displayDimensions.width, displayDimensions.height);
      }

      if ((!image || !image.complete) && !mainCanvas) {
        return null;
      }

      const pixel = sampleCtx.getImageData(sampleX, sampleY, 1, 1).data;
      if (pixel[3] === 0) {
        return null;
      }

      // 转换为十六进制颜色
      return `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;
    } catch (error) {
      console.error('Error getting color from image:', error);
      return null;
    }
  }, [displayDimensions, effectiveCanvasRef, imageDimensions, sourceImageRef]);

  // 使用 useCallback 记忆 redrawCanvas 函数
  const redrawCanvas = useCallback(() => {
    const canvas = effectiveCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制历史记录中的所有路径
    for (let i = 0; i <= historyIndex; i++) {
      const path = drawHistory[i];
      if (!path || path.length < 2) continue;
      
      for (let j = 1; j < path.length; j++) {
        const point = path[j];
        const prevPoint = path[j - 1];
        
        ctx.globalCompositeOperation = point.eraser ? 'destination-out' : 'source-over';
        ctx.strokeStyle = point.eraser ? 'rgba(0,0,0,1)' : point.color;
        ctx.lineWidth = point.size;
        ctx.globalAlpha = point.opacity;
        
        ctx.beginPath();
        ctx.moveTo(prevPoint.x, prevPoint.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    }
    
    // 重置绘图状态
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }, [historyIndex, drawHistory, effectiveCanvasRef]);

  useEffect(() => {
    const canvas = effectiveCanvasRef.current;
    if (!canvas || displayDimensions.width === 0 || displayDimensions.height === 0) return;
    
    // 设置canvas尺寸与图像显示尺寸一致
    canvas.width = displayDimensions.width;
    canvas.height = displayDimensions.height;
    
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    // 如果有历史记录，重绘所有内容
    if (historyIndex >= 0) {
      redrawCanvas();
    } else {
      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [displayDimensions, historyIndex, drawHistory, redrawCanvas, effectiveCanvasRef]);

  // 滚轮调整笔刷大小
  useEffect(() => {
    const canvas = effectiveCanvasRef.current;
    if (!canvas) return;
    
    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          // 向上滚动，增加笔刷大小
          setBrushSize(prev => Math.min(prev + 1, 50));
        } else {
          // 向下滚动，减小笔刷大小
          setBrushSize(prev => Math.max(prev - 1, 1));
        }
      }
    };
    
    canvas.addEventListener('wheel', handleWheel);
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [effectiveCanvasRef]);

  // 鼠标事件处理 - 简化版，移除预览相关逻辑
  useEffect(() => {
    const canvas = effectiveCanvasRef.current;
    if (!canvas) return;
    
    const startDrawing = (e) => {
      const rect = canvas.getBoundingClientRect();
      // 添加缩放比例计算，修复坐标偏移问题
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      
      // 如果是吸管模式，获取颜色并返回
      if (eyedropperMode) {
        const color = getColorFromPoint(x, y);
        if (color) {
          setSelectedColor(color);
          // 取色后自动关闭吸管模式
          setEyedropperMode(false);
        }
        return;
      }
      
      setIsDrawing(true);
      setCurrentPath([{ x, y, size: brushSize, color: selectedColor, opacity: brushOpacity, eraser: eraserMode }]);
    };
    
    const draw = (e) => {
      if (eyedropperMode) return; // 吸管模式下不绘制
      if (!isDrawing) return;
      
      const rect = canvas.getBoundingClientRect();
      // 添加缩放比例计算，修复坐标偏移问题
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      
      setCurrentPath(prev => [...prev, { x, y, size: brushSize, color: selectedColor, opacity: brushOpacity, eraser: eraserMode }]);
      
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const lastPoint = currentPath[currentPath.length - 1];
      
      if (lastPoint) {
        ctx.globalCompositeOperation = eraserMode ? 'destination-out' : 'source-over';
        ctx.strokeStyle = eraserMode ? 'rgba(0,0,0,1)' : lastPoint.color;
        ctx.lineWidth = lastPoint.size;
        ctx.globalAlpha = lastPoint.opacity;
        
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    };
    
    const endDrawing = () => {
      if (eyedropperMode) return; // 吸管模式下不处理绘制结束
      if (!isDrawing) return;
      
      setIsDrawing(false);
      
      // 只有当路径有效时才添加到历史记录
      if (currentPath.length > 1) {
        // 如果有后续历史（撤销后又绘制），则清除
        if (historyIndex < drawHistory.length - 1) {
          setDrawHistory(prev => prev.slice(0, historyIndex + 1));
        }
        
        setDrawHistory(prev => [...prev, currentPath]);
        setHistoryIndex(prev => prev + 1);
      }
      
      setCurrentPath([]);
    };
    
    // 添加触摸事件支持 - 简化版，移除预览相关逻辑
    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        // 添加缩放比例计算，修复坐标偏移问题
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (touch.clientX - rect.left) * scaleX;
        const y = (touch.clientY - rect.top) * scaleY;
        
        // 如果是吸管模式，获取颜色并返回
        if (eyedropperMode) {
          const color = getColorFromPoint(x, y);
          if (color) {
            setSelectedColor(color);
            // 取色后自动关闭吸管模式
            setEyedropperMode(false);
          }
          return;
        }
        
        setIsDrawing(true);
        setCurrentPath([{ x, y, size: brushSize, color: selectedColor, opacity: brushOpacity, eraser: eraserMode }]);
      }
    };
    
    const handleTouchMove = (e) => {
      if (eyedropperMode) return; // 吸管模式下简化处理逻辑
      
      if (e.touches.length === 1 && isDrawing) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        // 添加缩放比例计算，修复坐标偏移问题
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (touch.clientX - rect.left) * scaleX;
        const y = (touch.clientY - rect.top) * scaleY;
        
        setCurrentPath(prev => [...prev, { x, y, size: brushSize, color: selectedColor, opacity: brushOpacity, eraser: eraserMode }]);
        
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const lastPoint = currentPath[currentPath.length - 1];
        
        if (lastPoint) {
          ctx.globalCompositeOperation = eraserMode ? 'destination-out' : 'source-over';
          ctx.strokeStyle = eraserMode ? 'rgba(0,0,0,1)' : lastPoint.color;
          ctx.lineWidth = lastPoint.size;
          ctx.globalAlpha = lastPoint.opacity;
          
          ctx.beginPath();
          ctx.moveTo(lastPoint.x, lastPoint.y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }
    };
    
    const handleTouchEnd = (e) => {
      e.preventDefault();
      
      // 如果在吸管模式下结束触摸，不做特殊处理，已在touchstart中处理取色
      if (eyedropperMode) return;
      
      const mouseEvent = new MouseEvent('mouseup', {});
      canvas.dispatchEvent(mouseEvent);
    };
    
    // 鼠标事件
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDrawing);
    canvas.addEventListener('mouseleave', endDrawing);
      
    // 触摸事件
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      // 移除鼠标事件
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', endDrawing);
      canvas.removeEventListener('mouseleave', endDrawing);
      
      // 移除触摸事件
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDrawing, currentPath, brushSize, selectedColor, brushOpacity, eraserMode, historyIndex, drawHistory, effectiveCanvasRef, eyedropperMode, getColorFromPoint]);

  const handleBrushSizeChange = (e, value) => {
    setBrushSize(value);
  };

  const handleOpacityChange = (e, value) => {
    setBrushOpacity(value);
  };

  // 撤销功能
  const handleUndo = () => {
    if (historyIndex >= 0) {
      setHistoryIndex(prev => prev - 1);
    }
  };

  // 重做功能
  const handleRedo = () => {
    if (historyIndex < drawHistory.length - 1) {
      setHistoryIndex(prev => prev + 1);
    }
  };

  // 清空功能
  const handleClear = () => {
    setDrawHistory([]);
    setHistoryIndex(-1);
    setCurrentPath([]);
    
    const canvas = effectiveCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // 切换橡皮擦模式
  const toggleEraserMode = () => {
    setEraserMode(prev => !prev);
    // 启用橡皮擦模式时，关闭吸管模式
    if (!eraserMode) {
      setEyedropperMode(false);
    }
  };

  const handleSaveDrawing = () => {
    if (effectiveCanvasRef.current) {
      onSave(effectiveCanvasRef.current);
    }
  };

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
          gap: 2,
          height: '100%',
          overflow: 'auto'
        }}
      >
        {/* 颜色选择器 */}
        <ColorPicker 
          selectedColor={selectedColor} 
          onColorChange={setSelectedColor}
          onEyedropperChange={handleEyedropperChange}
          eyedropperActive={eyedropperMode}
        />
        
        <Divider />
        
        {/* 画笔设置 */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
            <ContrastIcon fontSize="small" sx={{ mr: 0.5 }} />
            {t('painting.tools.imageEditor.draw.brushSettings')}
          </Typography>
          
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 0.5, display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('painting.tools.imageEditor.draw.brushSize')}</span>
              <span>{brushSize}px</span>
            </Typography>
            <Slider
              value={brushSize}
              min={1}
              max={50}
              step={1}
              onChange={handleBrushSizeChange}
              valueLabelDisplay="auto"
              marks={[
                { value: 1, label: '1' },
                { value: 25, label: '25' },
                { value: 50, label: '50' },
              ]}
              sx={{
                color: theme.palette.primary.main,
                '& .MuiSlider-thumb': {
                  '&:hover, &.Mui-focusVisible': {
                    boxShadow: `0px 0px 0px 8px ${theme.palette.primary.main}30`
                  }
                }
              }}
            />
          </Box>
          
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5, display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('painting.tools.imageEditor.draw.opacity')}</span>
              <span>{Math.round(brushOpacity * 100)}%</span>
            </Typography>
            <Slider
              value={brushOpacity}
              min={0.1}
              max={1}
              step={0.05}
              onChange={handleOpacityChange}
              valueLabelDisplay="auto"
              valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
              marks={[
                { value: 0.1, label: '10%' },
                { value: 0.5, label: '50%' },
                { value: 1, label: '100%' },
              ]}
              sx={{
                color: theme.palette.primary.main,
                '& .MuiSlider-thumb': {
                  '&:hover, &.Mui-focusVisible': {
                    boxShadow: `0px 0px 0px 8px ${theme.palette.primary.main}30`
                  }
                }
              }}
            />
          </Box>
          
          {/* 预览当前画笔 */}
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '60px',
            mt: 2,
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: 1
          }}>
            <Box sx={{ 
              width: brushSize, 
              height: brushSize, 
              backgroundColor: eraserMode ? 'transparent' : selectedColor,
              opacity: eraserMode ? 0.5 : brushOpacity,
              border: eraserMode ? '1px dashed #999' : 'none',
              borderRadius: '50%'
            }} />
          </Box>
        </Box>
        
        <Divider />
        
        {/* 工具按钮组 */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Tooltip title={eraserMode
            ? t('painting.tools.imageEditor.draw.switchToBrush')
            : t('painting.tools.imageEditor.draw.switchToEraser')} arrow>
            <Button 
              variant={eraserMode ? "contained" : "outlined"}
              onClick={toggleEraserMode}
              startIcon={<ClearIcon />}
              size="small"
              color={eraserMode ? "secondary" : "primary"}
              disabled={eyedropperMode} // 吸管模式时禁用橡皮擦
              sx={{ 
                borderRadius: 1.5,
                textTransform: 'none'
              }}
            >
              {eraserMode
                ? t('painting.tools.imageEditor.draw.eraser')
                : t('painting.tools.imageEditor.draw.brush')}
            </Button>
          </Tooltip>
          
          <Tooltip title={t('painting.tools.imageEditor.draw.undo')} arrow>
            <span>
              <IconButton 
                onClick={handleUndo} 
                disabled={historyIndex < 0}
                sx={{ 
                  color: theme.palette.primary.main,
                  bgcolor: theme.palette.action.hover,
                  '&:hover': {
                    bgcolor: theme.palette.action.selected,
                  }
                }}
                size="small"
                aria-label={t('painting.tools.imageEditor.draw.undo')}
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          
          <Tooltip title={t('painting.tools.imageEditor.draw.redo')} arrow>
            <span>
              <IconButton 
                onClick={handleRedo}
                disabled={historyIndex >= drawHistory.length - 1}
                sx={{ 
                  color: theme.palette.primary.main,
                  bgcolor: theme.palette.action.hover,
                  '&:hover': {
                    bgcolor: theme.palette.action.selected,
                  }
                }}
                size="small"
                aria-label={t('painting.tools.imageEditor.draw.redo')}
              >
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          
          <Tooltip title={t('painting.tools.imageEditor.draw.clear')} arrow>
            <span>
              <IconButton 
                onClick={handleClear}
                disabled={historyIndex < 0}
                sx={{ 
                  color: theme.palette.error.main,
                  bgcolor: theme.palette.action.hover,
                  '&:hover': {
                    bgcolor: theme.palette.error.light,
                    color: theme.palette.error.contrastText
                  }
                }}
                size="small"
                aria-label={t('painting.tools.imageEditor.draw.clear')}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        
        {/* 提示消息 - 吸管模式 */}
        {eyedropperMode && (
          <Alert 
            severity="info" 
            sx={{ mt: 1, borderRadius: 1 }}
            variant="outlined"
          >
            {t('painting.tools.imageEditor.draw.eyedropperActive')}
          </Alert>
        )}
        
        {/* 保存按钮 */}
        <Box sx={{ mt: 'auto', pt: 2 }}>
          <Button
            variant="contained"
            onClick={handleSaveDrawing}
            startIcon={<SaveIcon />}
            fullWidth
            disabled={eyedropperMode} // 吸管模式时禁用保存
            sx={{
              borderRadius: 8,
              py: 1,
              bgcolor: theme.palette.success.main,
              '&:hover': {
                bgcolor: theme.palette.success.dark,
              }
            }}
          >
            {t('painting.tools.common.save')}
          </Button>
        </Box>
      </Paper>
    );
  }

  // 原始布局，当需要渲染在画布上时使用
  return (
    <>
      {/* 保留画布引用 */}
      <canvas
        ref={effectiveCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          cursor: eyedropperMode ? 'crosshair' : (eraserMode ? 'cell' : 'crosshair'),
          width: '100%',
          height: '100%',
          zIndex: 1
        }}
      />
      
      {/* 画笔大小浮动提示（在绘制时显示） */}
      {isDrawing && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.7)',
            color: 'white',
            padding: '4px 12px',
            borderRadius: 2,
            zIndex: 3,
            fontWeight: 'bold'
          }}
        >
          <Typography variant="caption">
            {eraserMode
              ? t('painting.tools.imageEditor.draw.eraser')
              : t('painting.tools.imageEditor.draw.brush')} {brushSize}px / {Math.round(brushOpacity * 100)}%
          </Typography>
        </Box>
      )}
      
      {/* 吸管模式提示 */}
      {eyedropperMode && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.7)',
            color: 'white',
            padding: '4px 12px',
            borderRadius: 2,
            zIndex: 3,
            fontWeight: 'bold'
          }}
        >
          <Typography variant="caption">
            {t('painting.tools.imageEditor.draw.eyedropperModeHint')}
          </Typography>
        </Box>
      )}
    </>
  );
};

export default DrawMode;
