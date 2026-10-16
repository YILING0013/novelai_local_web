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
  Download as DownloadIcon,
  Archive as ArchiveIcon,
  Add as AddIcon,
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
  
  const statusLabelKey = {
    converted: 'vibeConverted',
    unconverted: 'vibePendingConversion',
    converting: 'vibeConverting',
    error: 'vibeConversionFailed',
  }[status];
  const statusLabel = statusLabelKey ? t(`painting.workspace.parameters.${statusLabelKey}`) : '';

  return (
    <Card elevation={0} sx={{ mb: 2, borderRadius: 1, bgcolor: 'transparent', boxShadow: 'none', overflow: 'hidden', border: '1px solid', borderColor: isDisabled ? 'warning.light' : 'divider' }}>
      <Box sx={{ 
        display: 'flex', 
        p: 2,
        gap: 2,
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
            borderRadius: 0.75,
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
            {isDisabled && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }}>
                <Chip size="small" label={t('painting.workspace.parameters.disabled')} sx={{ height: 22, fontSize: '0.6875rem', bgcolor: 'rgba(0,0,0,0.75)', color: 'white' }} />
              </Box>
            )}
            <Box sx={{ position: 'absolute', top: 4, left: 4 }}>
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
            </Box>
            <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 0.25 }}>
              {/* 下载按钮 */}
              {isV4Vibe && status === 'converted' && (
                <Tooltip title={t('painting.workspace.parameters.downloadVibeFile')} placement="top">
                  <IconButton
                    size="small"
                    onClick={() => onDownload(index)}
                    sx={{
                      p: 0.5,
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
              {/* 删除按钮 */}
              <Tooltip title={t('painting.workspace.parameters.delete')} placement="top">
                <IconButton
                  size="small"
                  onClick={() => onDelete(index)}
                  sx={{
                    p: 0.5,
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

            {/* 状态与转换操作共用图片底部浮层，避免遮住左上角的启用按钮。 */}
            {isV4Vibe && statusLabel && (
              <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, p: 0.5, display: 'flex', alignItems: 'center', gap: 0.25, background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}>
                <Tooltip title={statusLabel} describeChild>
                  <Chip label={statusLabel} size="small" variant="outlined" sx={{ height: 22, borderRadius: 0.5, flex: 1, minWidth: 0, fontSize: '0.6875rem', color: 'white', borderColor: 'rgba(255,255,255,0.5)', bgcolor: 'rgba(0,0,0,0.35)', '& .MuiChip-label': { px: 0.5 } }} />
                </Tooltip>
                {!isReadOnly && (
                  <Tooltip title={status === 'converted'
                    ? t('painting.workspace.parameters.vibeConverted')
                    : t('painting.workspace.parameters.clickToConvert')} placement="top">
                    <Box component="span" sx={{ display: 'flex', flexShrink: 0 }}>
                      <IconButton
                        aria-label={t('painting.workspace.parameters.clickToConvert')}
                        size="small"
                        onClick={() => onConvert(index)}
                        disabled={status === 'converting' || status === 'converted'}
                        sx={{
                          width: 22,
                          height: 22,
                          borderRadius: 0.5,
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
                    </Box>
                  </Tooltip>
                    )}
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
        <Box sx={{ flexGrow: 1, width: '100%', minWidth: 0 }}>
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
  blockedMessageKey = 'painting.workspace.parameters.vibeBlockedByReferences',
  handleVibeToggleDisabled,
}) => {
  const { t } = useI18n();
  const hasDownloadableVibes = vibeImages.some(v => v.status === 'converted');
  const enabledVibeCount = vibeImages.filter(v => v.isTemporarilyDisabled !== true).length;
  
  return (
    <Accordion 
      data-drop-zone="vibe"
      expanded={expandedPanels.vibe} 
      onChange={(_, isExpanded) => onExpandedPanelsChange('vibe', isExpanded)}
      onDragOver={blocked ? event => event.preventDefault() : handleVibeDragOver}
      onDragEnter={blocked ? undefined : handleVibeDragEnter}
      onDragLeave={handleVibeDragLeave}
      onDrop={event => {
        event.preventDefault();
        event.stopPropagation();
        if (!blocked) handleVibeDrop(event);
      }}
      disableGutters
      sx={{
        m: 0,
        border: 0,
        borderTop: '1px solid',
        borderColor: 'divider',
        borderRadius: 0,
        bgcolor: isVibeDragging && !blocked ? 'action.hover' : 'transparent',
        outline: isVibeDragging && !blocked ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: -2,
        backgroundImage: 'none',
        boxShadow: 'none',
        '&::before': { display: 'none' },
        '&:first-of-type, &:last-of-type': { borderRadius: 0 },
        '&.Mui-expanded': { margin: 0 },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
        sx={{
          minHeight: 44,
          px: 0,
          py: 0,
          bgcolor: 'transparent',
          '&.Mui-expanded': { minHeight: 44 },
          '& .MuiAccordionSummary-content, & .MuiAccordionSummary-content.Mui-expanded': { margin: 0 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flexWrap: 'wrap', columnGap: 1, rowGap: 0.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <StyleIcon sx={{ mr: 1, fontSize: 18, color: 'text.secondary' }} />
            <Typography sx={{ fontSize: 15, fontWeight: 500 }}>{t('painting.workspace.parameters.vibeTransfer')}</Typography>
          </Box>
          {vibeImages.length > 0 && <Tooltip title={blocked ? t(blockedMessageKey) : ''} describeChild arrow>
            <Typography component="span" variant="caption" sx={{ color: blocked ? 'warning.main' : enabledVibeCount > 0 ? 'primary.main' : 'text.secondary' }}>
              {t(blocked ? 'painting.workspace.parameters.vibePausedCount' : 'painting.workspace.parameters.vibeCount', { count: vibeImages.length, enabled: enabledVibeCount })}
            </Typography>
          </Tooltip>}
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, py: 2, position: 'relative' }}>
        {blocked && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 1, py: 0 }}>
            {t(blockedMessageKey)}
          </Alert>
        )}

        <input
          ref={vibeFileInputRef}
          type="file"
          accept={params.isV4Model ? '.naiv4vibe,.naiv4vibebundle,image/*' : 'image/*'}
          multiple
          onChange={params.isV4Model ? handleVibeV4FileUpload : handleVibeImageUpload}
          style={{ display: 'none' }}
        />
        {vibeImages.length === 0 && (
          <Box
            sx={{
              mt: 0.5, mb: 2, minHeight: 80, p: 2,
              border: '1px dashed', borderColor: isVibeDragging ? 'primary.main' : 'divider', borderRadius: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: isVibeDragging ? 'action.hover' : 'transparent',
              cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1,
            }}
            onClick={() => { if (!blocked) vibeFileInputRef.current.click(); }}
          >
            <UploadIcon sx={{ mr: 1, color: isVibeDragging ? 'primary.main' : 'text.secondary' }} />
            <Typography sx={{ fontSize: 14 }} color={isVibeDragging ? 'primary.main' : 'text.secondary'}>
              {isVibeDragging
                ? t(params.isV4Model ? 'painting.workspace.parameters.releaseToUploadFile' : 'painting.workspace.parameters.releaseToUploadImage')
                : t(params.isV4Model ? 'painting.workspace.parameters.clickOrDropVibeFile' : 'painting.workspace.parameters.clickOrDropMultipleImages')}
            </Typography>
          </Box>
        )}
        <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 0.5 }}>
          {vibeImages.length > 0 && (
            <Box sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', pb: 1, gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                disabled={blocked}
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => vibeFileInputRef.current.click()}
                sx={{ height: 32, flex: 1, minWidth: 0 }}
              >
                {t('painting.workspace.parameters.continueVibeUpload')}
              </Button>
              {params.isV4Model && <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                <Tooltip title={t('painting.workspace.parameters.downloadBundle')} arrow>
                  <span>
                    <IconButton
                      aria-label={t('painting.workspace.parameters.downloadBundle')}
                      color="primary"
                      size="small"
                      onClick={onDownloadBundle}
                      disabled={!hasDownloadableVibes}
                      sx={{ width: 32, height: 32, border: 1, borderColor: 'divider', borderRadius: 1 }}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('painting.workspace.parameters.downloadZip')} arrow>
                  <IconButton
                    aria-label={t('painting.workspace.parameters.downloadZip')}
                    color="primary"
                    size="small"
                    onClick={onDownloadZip}
                    sx={{ width: 32, height: 32, border: 1, borderColor: 'divider', borderRadius: 1 }}
                  >
                    <ArchiveIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>}
            </Box>
          )}
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
