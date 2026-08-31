"use client";

import React from 'react';
import NextImage from 'next/image';
import LockableSlider from '@/components/muiWrappers/LockableSlider';
import {
  Box,
  Typography,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Card,
  Alert,
  Tooltip,
  CircularProgress,
  Chip,
  Button
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Upload as UploadIcon,
  Delete as DeleteIcon,
  Style as StyleIcon,
  Sync as SyncIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Download as DownloadIcon,
  Archive as ArchiveIcon,
} from '@mui/icons-material';
import TemporaryDisableButton from './TemporaryDisableButton';
import { useI18n } from '@/i18n/I18nProvider';


// Vibe Transfer 图像组件 (UI 已优化)
const VibeImageComponent = ({ 
  vibeItem,
  onDelete, 
  onInfoChange, 
  onStrengthChange, 
  onConvert,
  onDownload,
  onToggleDisabled,
  index,
}) => {
  const { t } = useI18n();
  const { 
    image, 
    thumbnail,
    informationExtracted, 
    referenceStrength, 
    isV4Vibe = false,
    encodingInfo = {},
    status, // 'unconverted', 'converting', 'converted', 'error'
    isReadOnly = false,
    isTemporarilyDisabled = false,
  } = vibeItem;
  const isDisabled = isTemporarilyDisabled === true;
  
  const getStatusChip = () => {
    // 统一为浮层优化的样式
    const chipProps = {
      size: "small",
      variant: "outlined",
      sx: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        color: 'white',
        borderColor: 'rgba(255, 255, 255, 0.5)',
        '& .MuiChip-icon': {
          color: 'white',
          width: '16px',
          height: '16px',
        },
      }
    };

    switch(status) {
      case 'converted':
        return <Chip icon={<CheckCircleIcon />} label={t('painting.workspace.parameters.vibeConverted')} color="success" {...chipProps} />;
      case 'unconverted':
        return <Chip icon={<WarningIcon />} label={t('painting.workspace.parameters.vibePendingConversion')} color="warning" {...chipProps} />;
      case 'converting':
        return <Chip icon={<CircularProgress size={14} color="inherit" />} label={t('painting.workspace.parameters.vibeConverting')} color="info" {...chipProps} />;
      case 'error':
        return <Chip icon={<ErrorIcon />} label={t('painting.workspace.parameters.vibeConversionFailed')} color="error" {...chipProps} />;
      default:
        return null;
    }
  };

  return (
    <Card elevation={0} sx={{ mb: 1, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: isDisabled ? 'warning.light' : 'divider' }}>
      <Box sx={{ 
        display: 'flex', 
        p: 1,
        gap: 1,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: isDisabled ? 0.76 : 1,
        transition: 'opacity 0.2s ease'
      }}>
        {/* 左侧容器: 图像 + ID */}
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: { xs: 84, sm: 100 },
          minWidth: { xs: 84, sm: 100 },
          flexShrink: 0,
        }}>
          {/* 图像容器 */}
          <Box sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            borderRadius: 1.5,
            overflow: 'hidden',
            backgroundColor: 'black',
          }}>
            {thumbnail || image ? (
              <NextImage
                src={thumbnail || image}
                alt={t('painting.workspace.parameters.referenceImageAlt')}
                fill
                sizes="100px"
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <Box sx={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'grey.500', backgroundColor: 'grey.900',
              }}>
                <StyleIcon aria-label={t('painting.workspace.parameters.referenceImageAlt')} />
              </Box>
            )}
            {/* [修改] 将右上角的按钮放入一个容器中 */}
            <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 0.5 }}>
              {/* 下载按钮 */}
              {isV4Vibe && status === 'converted' && (
                <Tooltip title={t('painting.workspace.parameters.downloadVibeFile')} placement="top">
                  <IconButton
                    size="small"
                    onClick={() => onDownload(index)}
                    sx={{
                      backgroundColor: 'rgba(0, 0, 0, 0.6)',
                      color: 'white',
                      '&:hover': {
                        backgroundColor: 'rgba(0, 123, 255, 0.8)',
                      }
                    }}
                  >
                    <DownloadIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
              <TemporaryDisableButton
                isDisabled={isDisabled}
                onToggle={() => onToggleDisabled(index)}
                iconOnly
                sx={{
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: isDisabled ? 'rgba(255, 152, 0, 0.85)' : 'rgba(97, 97, 97, 0.85)',
                  }
                }}
              />
              {/* 删除按钮 */}
              <Tooltip title={t('painting.workspace.parameters.delete')} placement="top">
                <IconButton
                  size="small"
                  onClick={() => onDelete(index)}
                  sx={{
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    color: 'white',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 0, 0, 0.8)',
                    }
                  }}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>

            {/* 左上角转换按钮 */}
            {isV4Vibe && !isReadOnly && (
              <Tooltip title={status === 'converted'
                ? t('painting.workspace.parameters.vibeConverted')
                : t('painting.workspace.parameters.clickToConvert')} placement="top">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onConvert(index)}
                    disabled={status === 'converting' || status === 'converted'}
                    sx={{
                      position: 'absolute',
                      top: 4,
                      left: 4,
                      backgroundColor: 'rgba(0, 0, 0, 0.6)',
                      color: 'white',
                      '&:hover': {
                        backgroundColor: status !== 'converted' ? 'rgba(0, 191, 165, 0.8)' : 'rgba(0, 0, 0, 0.6)',
                      },
                      '&.Mui-disabled': {
                          backgroundColor: status === 'converted' ? 'rgba(46, 125, 50, 0.7)' : 'rgba(0,0,0,0.5)',
                          color: 'white',
                          opacity: 1,
                      }
                    }}
                  >
                    {status === 'converting' ? <CircularProgress size={16} color="inherit" /> : 
                     status === 'converted' ? <CheckCircleIcon sx={{ fontSize: 16 }} /> :
                     <SyncIcon sx={{ fontSize: 16 }} />}
                  </IconButton>
                </span>
              </Tooltip>
            )}

            {/* 底部信息浮层 (仅含状态) */}
            {isV4Vibe && (
              <Box sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                p: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
                pointerEvents: 'none',
              }}>
                {getStatusChip()}
              </Box>
            )}
          </Box>
          {/* ID 信息 (位于图像下方) */}
          {isV4Vibe && encodingInfo.name && (
            <Typography 
              variant="caption" 
              color="text.secondary" 
              sx={{ 
                mt: 0.5, 
                width: '100%', 
                textAlign: 'center',
                wordBreak: 'break-all'
              }}
            >
              ID: {encodingInfo.name}
            </Typography>
          )}
        </Box>
        
        {/* 控制器容器 */}
        <Box sx={{ flexGrow: 1, width: '100%' }}>
          {isDisabled && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, flexWrap: 'wrap' }}>
              <Chip size="small" label={t('painting.workspace.parameters.disabled')} color="warning" variant="outlined" />
              <Typography variant="caption" color="warning.main">
                {t('painting.workspace.parameters.excludedFromRequest')}
              </Typography>
            </Box>
          )}
          <LockableSlider
            label={t('painting.workspace.parameters.referenceStrength')}
            value={referenceStrength}
            min={0}
            max={1}
            step={0.02}
            onChange={(newValue) => onStrengthChange(index, newValue)}
            valueLabelFormat={(value) => value.toFixed(2)}
          />
          
          {isV4Vibe ? (
             <LockableSlider
              label={t('painting.workspace.parameters.informationExtracted')}
              value={informationExtracted}
              min={0}
              max={1}
              step={0.1}
              onChange={(newValue) => onInfoChange(index, newValue)}
              valueLabelFormat={(value) => value.toFixed(1)}
              disabled={isReadOnly}
            />
          ) : (
            <LockableSlider
              label={t('painting.workspace.parameters.informationExtracted')}
              value={informationExtracted}
              min={0}
              max={1}
              step={0.02}
              onChange={(newValue) => onInfoChange(index, newValue)}
              valueLabelFormat={(value) => value.toFixed(2)}
            />
          )}
        </Box>
      </Box>
    </Card>
  );
};


const VibePanel = ({
  params,
  expandedPanels,
  onExpandedPanelsChange,
  vibeFileInputRef,
  isVibeDragging,
  handleVibeDragOver,
  handleVibeDragEnter,
  handleVibeDragLeave,
  handleVibeDrop,
  handleVibeV4FileUpload,
  handleVibeImageUpload,
  vibeImages,
  handleVibeImageDelete,
  handleVibeInfoChange,
  handleVibeStrengthChange,
  handleVibeConvert,
  onDownloadVibe,
  onDownloadBundle,
  onDownloadZip,
  // 接收禁用状态
  blocked = false,
  handleVibeToggleDisabled,
}) => {
  const { t } = useI18n();
  const hasDownloadableVibes = vibeImages.some(v => v.status === 'converted');
  const enabledVibeCount = vibeImages.filter(v => v.isTemporarilyDisabled !== true).length;
  
  return (
    <Accordion 
      expanded={expandedPanels.vibe} 
      onChange={(_, isExpanded) => onExpandedPanelsChange('vibe', isExpanded)}
      disableGutters
      sx={{
        boxShadow: 'none',
        '&::before': { display: 'none' },
        mt: 1,
        borderRadius: 2,
        overflow: 'hidden',
        '&.Mui-expanded': { margin: '8px 0 0 0' }
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          minHeight: 40,
          backgroundColor: expandedPanels.vibe ? 'action.hover' : 'transparent',
          '&.Mui-expanded': { minHeight: 40 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <StyleIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />
          <Typography variant="subtitle2" fontWeight="medium">
            {t('painting.workspace.parameters.vibeTransfer')}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 1.25, pt: 0.75, position: 'relative' }}>
        {blocked && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 1, py: 0 }}>
            {t('painting.workspace.parameters.vibeBlockedByReferences')}
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {params.isV4Model
            ? t('painting.workspace.parameters.vibeV4Description')
            : t('painting.workspace.parameters.vibeV3Description')}
        </Typography>

        {params.isV4Model ? (
          <>
            <input
              ref={vibeFileInputRef}
              type="file"
              accept=".naiv4vibe,.naiv4vibebundle,image/*"
              multiple
              onChange={handleVibeV4FileUpload}
              style={{ display: 'none' }}
            />

            <Box
              data-drop-zone="vibe"
              sx={{
                mt: 1,
                mb: 1.5,
                height: 56,
                border: '2px dashed',
                borderColor: isVibeDragging ? 'primary.main' : 'divider',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isVibeDragging ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
                transition: 'all 0.2s',
                cursor: blocked ? 'not-allowed' : 'pointer',
                opacity: blocked ? 0.5 : 1,
              }}
              onClick={() => {
                if (!blocked) {
                  vibeFileInputRef.current.click();
                }
              }}
              onDragOver={blocked ? undefined : handleVibeDragOver}
              onDragEnter={blocked ? undefined : handleVibeDragEnter}
              onDragLeave={blocked ? undefined : handleVibeDragLeave}
              onDrop={blocked ? undefined : handleVibeDrop}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', textAlign: 'center' }}>
                <UploadIcon sx={{ mr: 1, color: isVibeDragging ? 'primary.main' : 'text.secondary' }} />
                <Typography variant="body2" color={isVibeDragging ? 'primary.main' : 'text.secondary'}>
                  {isVibeDragging
                    ? t('painting.workspace.parameters.releaseToUploadFile')
                    : t('painting.workspace.parameters.clickOrDropVibeFile')}
                </Typography>
              </Box>
            </Box>

            {vibeImages.length > 0 && (
              <Alert severity="info" sx={{ mb: 1, py: 0 }}>
                {t('painting.workspace.parameters.vibeCount', {
                  count: vibeImages.length,
                  enabled: enabledVibeCount,
                })}
              </Alert>
            )}
          </>
        ) : (
          <>
            <input
              ref={vibeFileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleVibeImageUpload}
              style={{ display: 'none' }}
            />

            <Box
              data-drop-zone="vibe"
              sx={{
                mt: 0.5,
                mb: 1,
                height: 52,
                border: '2px dashed',
                borderColor: isVibeDragging ? 'primary.main' : 'divider',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isVibeDragging ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
                transition: 'all 0.2s',
                cursor: blocked ? 'not-allowed' : 'pointer',
                opacity: blocked ? 0.5 : 1,
              }}
              onClick={() => {
                if (!blocked) {
                  vibeFileInputRef.current.click();
                }
              }}
              onDragOver={blocked ? undefined : handleVibeDragOver}
              onDragEnter={blocked ? undefined : handleVibeDragEnter}
              onDragLeave={blocked ? undefined : handleVibeDragLeave}
              onDrop={blocked ? undefined : handleVibeDrop}
            >
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <UploadIcon sx={{ mr: 1, color: isVibeDragging ? 'primary.main' : 'text.secondary' }} />
                <Typography variant="body2" color={isVibeDragging ? 'primary.main' : 'text.secondary'}>
                  {isVibeDragging
                    ? t('painting.workspace.parameters.releaseToUploadImage')
                    : t('painting.workspace.parameters.clickOrDropMultipleImages')}
                </Typography>
              </Box>
            </Box>
          </>
        )}

        {params.isV4Model && vibeImages.length > 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1, gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={onDownloadBundle}
              disabled={!hasDownloadableVibes}
            >
              {t('painting.workspace.parameters.downloadBundle')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ArchiveIcon />}
              onClick={onDownloadZip}
            >
              {t('painting.workspace.parameters.downloadZip')}
            </Button>
          </Box>
        )}

        <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 1 }}>
          {vibeImages.map((item, index) => (
            <VibeImageComponent
              key={item.id}
              index={index}
              vibeItem={item}
              onDelete={handleVibeImageDelete}
              onInfoChange={handleVibeInfoChange}
              onStrengthChange={handleVibeStrengthChange}
              onConvert={handleVibeConvert}
              onDownload={onDownloadVibe}
              onToggleDisabled={handleVibeToggleDisabled}
            />
          ))}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

export default VibePanel;
