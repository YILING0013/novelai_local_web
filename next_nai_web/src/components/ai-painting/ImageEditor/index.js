"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import NextImage from 'next/image';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  useMediaQuery,
  useTheme,
  Paper,
  Divider,
  Alert
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

import Toolbar from './Toolbar';
import DrawMode from './DrawMode';
import EmotionMode from './EmotionMode';
import ColorizeMode from './ColorizeMode';
import { useI18n } from '@/i18n/I18nProvider';

const ImageEditor = ({ 
  open, 
  onClose, 
  imageUrl, 
  currentDirectorToolParams = null,
}) => {
  const theme = useTheme();
  const { t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const getToolLabel = (tool) => t(`painting.tools.imageEditor.toolbar.${tool}`);
  
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [displayDimensions, setDisplayDimensions] = useState({
    width: 0,
    height: 0,
    scale: 1,
    left: 0,
    top: 0
  });
  
  const [activeMainTool, setActiveMainTool] = useState(null);
  const [activeRadioTool, setActiveRadioTool] = useState(
    currentDirectorToolParams?.type || null
  );
  const [editedImageUrl, setEditedImageUrl] = useState(null);
  const [saveError, setSaveError] = useState(false);

  const [emotionParams, setEmotionParams] = useState(
    currentDirectorToolParams?.type === 'emotion' ? currentDirectorToolParams.params : null
  );
  const [colorizeParams, setColorizeParams] = useState(
    currentDirectorToolParams?.type === 'colorize' ? currentDirectorToolParams.params : null
  );
  const [radioToolParams, setRadioToolParams] = useState({
    lineart: currentDirectorToolParams?.type === 'lineart',
    sketch: currentDirectorToolParams?.type === 'sketch',
    declutter: currentDirectorToolParams?.type === 'declutter'
  });

  // 用于放置图像与canvas的容器
  const imageContainerRef = useRef(null);
  // 画布引用
  const canvasRef = useRef(null);
  const drawingChangedRef = useRef(false);
  // 图像引用 - 增加图像引用以便于吸管工具使用
  const imageRef = useRef(null);

  // 当图像加载时，记录原图宽高
  const handleImageLoad = (event) => {
    const loadedImage = event.currentTarget;
    setImageDimensions({
      width: loadedImage.naturalWidth,
      height: loadedImage.naturalHeight
    });
    
    // 保存图像引用用于吸管工具
    imageRef.current = loadedImage;
  };

  const handleMainToolClick = (tool) => {
    if (saveDrawingDraft() === undefined) return;
    if (tool !== activeMainTool) {
      setActiveRadioTool(null);
      setRadioToolParams({
        lineart: false,
        sketch: false,
        declutter: false
      });
    }
    setActiveMainTool(prev => (prev === tool ? null : tool));
  };

  const handleRadioToolClick = (tool) => {
    if (saveDrawingDraft() === undefined) return;

    const newActiveRadioTool = activeRadioTool === tool ? null : tool;
    setActiveMainTool(null);
    if (newActiveRadioTool !== activeRadioTool) {
      setRadioToolParams({
        lineart: false,
        sketch: false,
        declutter: false
      });
    }
    if (newActiveRadioTool) {
      if (['lineart', 'sketch', 'declutter'].includes(newActiveRadioTool)) {
        setRadioToolParams(prev => ({
          ...prev,
          lineart: newActiveRadioTool === 'lineart',
          sketch: newActiveRadioTool === 'sketch',
          declutter: newActiveRadioTool === 'declutter'
        }));
      }
    }
    setActiveRadioTool(newActiveRadioTool);
  };

  // 根据图像原始大小与容器大小，计算要显示的缩放后尺寸
  useEffect(() => {
    const updateImageSize = () => {
      if (imageContainerRef.current && imageDimensions.width > 0 && imageDimensions.height > 0) {
        const containerWidth = imageContainerRef.current.clientWidth;
        const containerHeight = imageContainerRef.current.clientHeight;
        
        const scaleWidth = containerWidth / imageDimensions.width;
        const scaleHeight = containerHeight / imageDimensions.height;
        const scale = Math.min(scaleWidth, scaleHeight, 1);

        const scaledWidth = Math.floor(imageDimensions.width * scale);
        const scaledHeight = Math.floor(imageDimensions.height * scale);
        const left = Math.floor((containerWidth - scaledWidth) / 2);
        const top = Math.floor((containerHeight - scaledHeight) / 2);
        
        setDisplayDimensions({
          width: scaledWidth,
          height: scaledHeight,
          scale,
          left,
          top
        });
      }
    };

    updateImageSize();
    window.addEventListener('resize', updateImageSize);
    return () => {
      window.removeEventListener('resize', updateImageSize);
    };
  }, [imageDimensions]);

  /**
   * 将当前笔迹按原图尺寸合入编辑草稿，供切换工具和最终保存共用。
   *
   * Returns:
   *   string|null: 当前草稿；导出失败时返回 undefined，保留当前工具与笔迹。
   */
  const saveDrawingDraft = () => {
    if (activeMainTool !== 'draw' || !drawingChangedRef.current) return editedImageUrl;

    try {
      const sourceImage = imageRef.current;
      if (!sourceImage?.complete || !sourceImage.naturalWidth) {
        throw new Error('图像尚未加载完成');
      }
      const drawingCanvas = canvasRef.current;
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = sourceImage.naturalWidth;
      outputCanvas.height = sourceImage.naturalHeight;
      const context = outputCanvas.getContext('2d');
      context.drawImage(sourceImage, 0, 0);
      context.drawImage(drawingCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
      const draftImage = outputCanvas.toDataURL('image/png');
      setEditedImageUrl(draftImage);
      setSaveError(false);
      return draftImage;
    } catch {
      setSaveError(true);
      return undefined;
    }
  };

  const handleSaveEmotionParams = useCallback((params) => {
    setEmotionParams(params);
  }, []);

  const handleSaveColorizeParams = useCallback((params) => {
    setColorizeParams(params);
  }, []);

  const handleFinalSave = () => {
    // 使用本次合成的结果，不能等待 React 状态更新后再读取旧的 editedImageUrl。
    const draftImage = saveDrawingDraft();
    if (draftImage === undefined) return;
    const exportData = {
      editedImage: draftImage,
      emotionParams,
      colorizeParams,
      radioToolParams,
      activeRadioTool,
      directorTools: {
        type: activeRadioTool,
        params:
          activeRadioTool === 'emotion'
            ? emotionParams
            : activeRadioTool === 'colorize'
            ? colorizeParams
            : radioToolParams.lineart || radioToolParams.sketch || radioToolParams.declutter
            ? { enabled: true, toolType: activeRadioTool }
            : null
      }
    };
    onClose(exportData);
  };

  const getSidePanelWidth = () => {
    return isMobile ? '100%' : '300px';
  };

  const renderActiveToolControls = () => {
    if (activeMainTool === 'draw') {
      return (
        <DrawMode 
          displayDimensions={displayDimensions} 
          imageDimensions={imageDimensions}
          isMobile={isMobile}
          theme={theme}
          inSidePanel={true}
          canvasRef={canvasRef}
          drawingChangedRef={drawingChangedRef}
          sourceImageRef={imageRef}
        />
      );
    }
    return null;
  };

  const renderRadioToolControls = () => {
    if (activeRadioTool === 'emotion') {
      return (
        <EmotionMode 
          isMobile={isMobile}
          theme={theme}
          inSidePanel={true}
          onSaveParams={handleSaveEmotionParams}
          initialParams={emotionParams}
        />
      );
    } else if (activeRadioTool === 'colorize') {
      return (
        <ColorizeMode 
          isMobile={isMobile}
          theme={theme}
          inSidePanel={true}
          onSaveParams={handleSaveColorizeParams}
          initialParams={colorizeParams}
        />
      );
    } else if (['lineart', 'sketch', 'declutter'].includes(activeRadioTool)) {
      return (
        <Paper
          elevation={0}
          sx={{
            padding: 0,
            backgroundColor: 'transparent',
            color: theme.palette.text.primary,
            mb: 2
          }}
        >
          <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
            {t('painting.tools.imageEditor.selected')}: {getToolLabel(activeRadioTool)}
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant="body2" color="text.secondary">
            {t('painting.tools.imageEditor.noMoreSettings')}
          </Typography>
          
        </Paper>
      );
    }
    return null;
  };

  const renderResultPanel = () => {
    return (
      <Paper 
        elevation={0}
        sx={{
          p: 0,
          bgcolor: 'transparent',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Typography variant="subtitle1" sx={{ mb: 2, fontSize: 15, fontWeight: 600 }}>
          {t('painting.tools.imageEditor.preview.title')}
        </Typography>
        
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center', 
          justifyContent: 'center',
          mb: 2,
          p: 0
        }}>
          {!editedImageUrl && !activeRadioTool && (
            <Typography variant="body2" color="text.secondary" align="center">
              {t('painting.tools.imageEditor.preview.empty')}
            </Typography>
          )}
          
          {editedImageUrl && (
            <Box sx={{ width: '100%', mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>{t('painting.tools.imageEditor.preview.image')}:</Typography>
              <Box 
                sx={{ 
                  width: '100%', 
                  height: '150px', 
                  position: 'relative',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  overflow: 'hidden'
                }}
              >
                <NextImage
                  src={editedImageUrl}
                  alt={t('painting.tools.imageEditor.preview.editedImageAlt')}
                  fill
                  style={{ objectFit: 'contain' }}
                />
              </Box>
            </Box>
          )}

          {activeRadioTool === 'emotion' && emotionParams && (
            <Box sx={{ width: '100%', mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>{t('painting.tools.imageEditor.preview.emotionParameters')}:</Typography>
              <Typography variant="body2" color="text.secondary">
                {t(`painting.tools.imageEditor.emotion.options.${emotionParams.emotion}`)}
                {' · '}{t('painting.tools.imageEditor.strength')} {emotionParams.defry}
              </Typography>
              {emotionParams.prompt && (
                <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                  {emotionParams.prompt}
                </Typography>
              )}
            </Box>
          )}
          
          {activeRadioTool === 'colorize' && colorizeParams && (
            <Box sx={{ width: '100%', mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>{t('painting.tools.imageEditor.preview.colorizeParameters')}:</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('painting.tools.imageEditor.strength')} {colorizeParams.intensity}
              </Typography>
              {colorizeParams.prompt && (
                <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                  {colorizeParams.prompt}
                </Typography>
              )}
            </Box>
          )}
          
          {(['lineart', 'sketch', 'declutter'].includes(activeRadioTool) &&
            radioToolParams[activeRadioTool]) && (
            <Box sx={{ width: '100%', mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>{t('painting.tools.imageEditor.preview.selectedEffect')}:</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {activeRadioTool === 'lineart' && (
                  <Box 
                    sx={{ 
                      p: 1, 
                      bgcolor: 'action.selected',
                      color: 'text.primary',
                      borderRadius: 1,
                      fontSize: 14
                    }}
                  >
                    {getToolLabel('lineart')}
                  </Box>
                )}
                {activeRadioTool === 'sketch' && (
                  <Box 
                    sx={{ 
                      p: 1, 
                      bgcolor: 'action.selected',
                      color: 'text.primary',
                      borderRadius: 1,
                      fontSize: 14
                    }}
                  >
                    {getToolLabel('sketch')}
                  </Box>
                )}
                {activeRadioTool === 'declutter' && (
                  <Box 
                    sx={{ 
                      p: 1, 
                      bgcolor: 'action.selected',
                      color: 'text.primary',
                      borderRadius: 1,
                      fontSize: 14
                    }}
                  >
                    {getToolLabel('declutter')}
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </Paper>
    );
  };

  return (
    <Dialog 
      open={open} 
      onClose={() => onClose()}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          borderRadius: 0,
          border: 0,
          boxShadow: 'none',
        }
      }}
    >
      <DialogTitle 
        sx={{ 
          px: { xs: 2, sm: 3 },
          py: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          color: 'text.primary',
          position: 'sticky',
          top: 0,
          zIndex: 1100,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography component="span" sx={{ fontSize: 18, fontWeight: 600 }}>{t('painting.tools.imageEditor.title')}</Typography>
          </Box>
          <IconButton onClick={() => onClose()} aria-label={t('painting.tools.common.close')} sx={{ color: 'inherit' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent 
        sx={{ 
          p: 0,
          height: { xs: 'auto', md: 'calc(100vh - 64px - 64px)' },
          maxHeight: { xs: 'none', md: 'calc(100vh - 64px - 64px)' },
          overflowY: { xs: 'auto', md: 'hidden' },
          display: 'flex', 
          flexDirection: 'column',
          bgcolor: 'background.paper',
        }}
      >
      
        <Toolbar
          activeMainTool={activeMainTool}
          onMainToolClick={handleMainToolClick}
          activeRadioTool={activeRadioTool}
          onRadioToolClick={handleRadioToolClick}
          isMobile={isMobile}
          theme={theme}
        />
        
        <Box 
          sx={{ 
            flex: { xs: 'none', md: 1 },
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            overflow: { xs: 'visible', md: 'hidden' },
          }}
        >
          {/* Tool Control Panel */}
          <Box 
            sx={{ 
              width: isMobile ? '100%' : getSidePanelWidth(),
              height: isMobile ? 'auto' : '100%',
              minHeight: 0,
              flexShrink: 0,
              p: 2,
              borderRight: { md: `1px solid ${theme.palette.divider}` },
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            
            {renderActiveToolControls() || renderRadioToolControls() || (
              <Paper
                elevation={0}
                sx={{
                  p: 0,
                  mb: 2,
                  height: isMobile ? 'auto' : '100%',
                  minHeight: isMobile ? '80px' : 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  bgcolor: theme.palette.background.paper
                }}
              >
                <Typography variant="body1" align="center" color="text.secondary">
                  {t('painting.tools.imageEditor.chooseTool')}
                </Typography>
              </Paper>
            )}
          </Box>
          
          {/* Image Editing Area */}
          <Box 
            ref={imageContainerRef}
            sx={{ 
              flex: 1, 
              position: 'relative', 
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
              minHeight: { xs: '350px', md: 0 },
              flexShrink: 0,
              bgcolor: theme.palette.mode === 'dark' 
                ? 'rgba(0,0,0,0.3)' 
                : 'rgba(0,0,0,0.03)',
            }}
          >
            {(imageUrl || editedImageUrl) && (
              <Paper 
                elevation={0}
                sx={{
                  position: 'relative',
                  width: `${displayDimensions.width}px`,
                  height: `${displayDimensions.height}px`,
                  borderRadius: 0,
                  overflow: 'hidden'
                }}
              >
                <NextImage
                  ref={imageRef}
                  src={editedImageUrl || imageUrl}
                  alt={t('painting.tools.imageEditor.editingImageAlt')}
                  width={displayDimensions.width}
                  height={displayDimensions.height}
                  onLoad={handleImageLoad}
                  style={{ objectFit: 'contain' }}
                  priority
                />
                
                {activeMainTool === 'draw' && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${displayDimensions.width}px`,
                      height: `${displayDimensions.height}px`,
                    }}
                  >
                    <canvas
                      ref={canvasRef}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        cursor: 'crosshair',
                        pointerEvents: 'auto',
                      }}
                    />
                  </Box>
                )}
              </Paper>
            )}
          </Box>
          
          {/* Preview Panel */}
          <Box 
            sx={{ 
              width: isMobile ? '100%' : getSidePanelWidth(),
              height: isMobile ? 'auto' : '100%',
              minHeight: isMobile ? '160px' : 0,
              flexShrink: 0,
              p: 2,
              borderLeft: { md: `1px solid ${theme.palette.divider}` },
              overflow: 'auto'
            }}
          >
            {renderResultPanel()}
          </Box>
        </Box>
      </DialogContent>
      
      <DialogActions 
        sx={{ 
          borderTop: `1px solid ${theme.palette.divider}`, 
          px: { xs: 2, sm: 3 },
          py: 1.5,
          bgcolor: 'background.paper',
          flexWrap: 'wrap',
          gap: 1,
          position: 'sticky',
          bottom: 0,
          zIndex: 1100,
        }}
      >
        {saveError && (
          <Alert severity="error" sx={{ mr: 'auto', py: 0 }}>
            {t('painting.tools.imageEditor.saveFailed')}
          </Alert>
        )}
        <Button
          onClick={() => onClose()}
          sx={{
            minHeight: 40,
            color: 'text.secondary'
          }}
        >
          {t('painting.tools.common.cancel')}
        </Button>
        <Button 
          variant="contained" 
          onClick={handleFinalSave}
          sx={{
            minHeight: 40,
            minWidth: 88
          }}
        >
          {t('painting.tools.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImageEditor;
