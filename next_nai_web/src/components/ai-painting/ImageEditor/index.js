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
  Divider
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
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

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
  const [activeRadioTool, setActiveRadioTool] = useState(null);
  const [editedImageUrl, setEditedImageUrl] = useState(null);

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
    if (tool !== activeMainTool) {
      setActiveRadioTool(null);
      setRadioToolParams({
        lineart: false,
        sketch: false,
        declutter: false
      });
      setEmotionParams(null);
      setColorizeParams(null);
    }
    setActiveMainTool(prev => (prev === tool ? null : tool));
  };

  const handleRadioToolClick = (tool) => {
    const newActiveRadioTool = activeRadioTool === tool ? null : tool;
    setActiveMainTool(null);
    if (newActiveRadioTool !== activeRadioTool) {
      setEmotionParams(null);
      setColorizeParams(null);
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

  // 初始化 Canvas 大小
  useEffect(() => {
    if (
      canvasRef.current && 
      displayDimensions.width > 0 && 
      displayDimensions.height > 0 && 
      activeMainTool === 'draw'
    ) {
      canvasRef.current.width = displayDimensions.width;
      canvasRef.current.height = displayDimensions.height;
      const ctx = canvasRef.current.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [displayDimensions, activeMainTool]);

  const handleSaveDrawing = (canvasWithDrawing) => {
    if (!canvasWithDrawing) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageDimensions.width;
    tempCanvas.height = imageDimensions.height;
    const ctx = tempCanvas.getContext('2d');

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, imageDimensions.width, imageDimensions.height);
      const scale = imageDimensions.width / displayDimensions.width;
      ctx.drawImage(
        canvasWithDrawing, 
        0, 0, displayDimensions.width, displayDimensions.height,
        0, 0, imageDimensions.width, imageDimensions.height
      );
      const newImageUrl = tempCanvas.toDataURL('image/png');
      setEditedImageUrl(newImageUrl);
      setActiveMainTool(null);
    };
    img.src = editedImageUrl || imageUrl;
  };

  const handleSaveEmotionParams = useCallback((params) => {
    setEmotionParams(params);
  }, []);

  const handleSaveColorizeParams = useCallback((params) => {
    setColorizeParams(params);
  }, []);

  const handleFinalSave = () => {
    const exportData = {
      editedImage: editedImageUrl,
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
    console.log('最终保存:', exportData);
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
          onSave={handleSaveDrawing}
          isMobile={isMobile}
          theme={theme}
          inSidePanel={true}
          canvasRef={canvasRef}
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
          elevation={3}
          sx={{
            padding: 2,
            borderRadius: 1,
            backgroundColor: theme.palette.background.paper,
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
          
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Button 
              variant="contained" 
              color="primary"
              onClick={() => {
                alert(t('painting.tools.imageEditor.effectSelected', {
                  effect: getToolLabel(activeRadioTool),
                }));
              }}
              sx={{ 
                borderRadius: 2,
                px: 3
              }}
            >
              {t('painting.tools.imageEditor.confirmSelection')}
            </Button>
          </Box>
        </Paper>
      );
    }
    return null;
  };

  const renderResultPanel = () => {
    return (
      <Paper 
        elevation={3}
        sx={{
          p: 2,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
          {t('painting.tools.imageEditor.preview.title')}
        </Typography>
        
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center', 
          justifyContent: 'center',
          mb: 2,
          border: `1px dashed ${theme.palette.divider}`,
          borderRadius: 1,
          p: 2
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
              <Box 
                component="pre"
                sx={{ 
                  p: 1.5, 
                  borderRadius: 1,
                  fontSize: '0.75rem',
                  overflowX: 'auto'
                }}
              >
                {JSON.stringify(emotionParams, null, 2)}
              </Box>
            </Box>
          )}
          
          {activeRadioTool === 'colorize' && colorizeParams && (
            <Box sx={{ width: '100%', mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>{t('painting.tools.imageEditor.preview.colorizeParameters')}:</Typography>
              <Box 
                component="pre"
                sx={{ 
                  p: 1.5, 
                  borderRadius: 1,
                  fontSize: '0.75rem',
                  overflowX: 'auto'
                }}
              >
                {JSON.stringify(colorizeParams, null, 2)}
              </Box>
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
                      bgcolor: theme.palette.primary.light,
                      color: theme.palette.primary.contrastText,
                      borderRadius: 1,
                      fontSize: '0.75rem'
                    }}
                  >
                    {getToolLabel('lineart')}
                  </Box>
                )}
                {activeRadioTool === 'sketch' && (
                  <Box 
                    sx={{ 
                      p: 1, 
                      bgcolor: theme.palette.secondary.light,
                      color: theme.palette.secondary.contrastText,
                      borderRadius: 1,
                      fontSize: '0.75rem'
                    }}
                  >
                    {getToolLabel('sketch')}
                  </Box>
                )}
                {activeRadioTool === 'declutter' && (
                  <Box 
                    sx={{ 
                      p: 1, 
                      bgcolor: theme.palette.success.light,
                      color: theme.palette.success.contrastText,
                      borderRadius: 1,
                      fontSize: '0.75rem'
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
      onClose={onClose} 
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#f5f5f5',
        }
      }}
    >
      <DialogTitle 
        sx={{ 
          p: 1, 
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          position: 'sticky',
          top: 0,
          zIndex: 1100,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="h6">{t('painting.tools.imageEditor.title')}</Typography>
          </Box>
          <IconButton onClick={() => onClose()} aria-label={t('painting.tools.common.close')} sx={{ color: 'inherit' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent 
        sx={{ 
          p: 0,
          height: { xs: 'auto', sm: 'calc(100vh - 64px - 64px)' },
          maxHeight: { xs: 'none', sm: 'calc(100vh - 64px - 64px)' },
          overflowY: { xs: 'visible', sm: 'hidden' },
          display: 'flex', 
          flexDirection: 'column',
          bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#f5f5f5',
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
            flex: { xs: 'none', sm: 1 }, 
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            overflow: { xs: 'visible', sm: 'hidden' },
          }}
        >
          {/* Tool Control Panel */}
          <Box 
            sx={{ 
              width: isMobile ? '100%' : getSidePanelWidth(),
              height: isMobile ? 'auto' : '100%',
              minHeight: isMobile ? '300px' : 'auto',
              p: 1,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            
            {renderActiveToolControls() || renderRadioToolControls() || (
              <Paper
                elevation={3}
                sx={{
                  p: 2,
                  mb: 2,
                  height: isMobile ? 'auto' : '100%',
                  minHeight: isMobile ? '200px' : 'auto',
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
              minHeight: {xs: '350px', sm: '400px'}, 
              my: { xs: 2, sm: 0 },
              bgcolor: theme.palette.mode === 'dark' 
                ? 'rgba(0,0,0,0.3)' 
                : 'rgba(0,0,0,0.03)',
            }}
          >
            {(imageUrl || editedImageUrl) && (
              <Paper 
                elevation={3} 
                sx={{
                  position: 'relative',
                  width: `${displayDimensions.width}px`,
                  height: `${displayDimensions.height}px`,
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
              minHeight: isMobile ? '300px' : 'auto',
              p: 1,
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
          p: 1,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          position: 'sticky',
          bottom: 0,
          zIndex: 1100,
        }}
      >
        <Button 
          onClick={() => onClose()}
          sx={{ 
            color: theme.palette.primary.contrastText,
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
            }
          }}
        >
          {t('painting.tools.common.cancel')}
        </Button>
        <Button 
          variant="contained" 
          onClick={handleFinalSave}
          sx={{ 
            bgcolor: theme.palette.secondary.main,
            color: theme.palette.secondary.contrastText,
            '&:hover': {
              bgcolor: theme.palette.secondary.dark,
            }
          }}
        >
          {t('painting.tools.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImageEditor;
