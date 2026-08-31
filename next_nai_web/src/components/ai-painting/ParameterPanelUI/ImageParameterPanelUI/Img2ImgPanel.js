"use client";

import React from 'react';
import NextImage from 'next/image';
import ImageEditor from '../../ImageEditor/index';
import LockableSlider from '@/components/muiWrappers/LockableSlider';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Card,
  CardActions,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Upload as UploadIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const Img2ImgPanel = ({
  params,
  handleParamChange,
  expandedPanels,
  onExpandedPanelsChange,
  fileInputRef,
  imagePreview,
  handleImageUpload,
  handleImageDelete,
  handleOpenEditor,
  isDragging,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
  renderEditSummary,
  editorKey,
  editorOpen,
  handleCloseEditor,
  directorToolParams,
}) => {
  const { t } = useI18n();
  return (
    <Accordion 
      expanded={expandedPanels.img2img} 
      onChange={(_, isExpanded) => onExpandedPanelsChange('img2img', isExpanded)}
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
          backgroundColor: expandedPanels.img2img ? 'action.hover' : 'transparent',
          '&.Mui-expanded': { minHeight: 40 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <ImageIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />
          <Typography variant="subtitle2" fontWeight="medium">{t('painting.workspace.parameters.img2img')}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1.5, pb: 2, pt: 1 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t('painting.workspace.parameters.img2imgDescription')}
        </Typography>
        
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          style={{ display: 'none' }}
        />
        
        {!imagePreview ? (
          <Box
            data-drop-zone="img2img"
            sx={{
              mt: 1,
              height: 100,
              border: '2px dashed',
              borderColor: isDragging ? 'primary.main' : 'divider',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isDragging ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            onClick={() => fileInputRef.current.click()}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <UploadIcon sx={{ mb: 1, color: isDragging ? 'primary.main' : 'text.secondary' }} />
              <Typography variant="body2" color={isDragging ? 'primary.main' : 'text.secondary'}>
                {isDragging
                  ? t('painting.workspace.parameters.releaseToUploadImage')
                  : t('painting.workspace.parameters.clickOrDropImageHere')}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Card sx={{ mt: 2, borderRadius: 2, overflow: 'visible' }}>
            <Box sx={{ 
              position: 'relative', 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              p: 2,
              minHeight: { xs: 200, sm: 250 }
            }}>
              <NextImage
                src={imagePreview}
                alt={t('painting.workspace.parameters.sourceImageAlt')}
                width={300}
                height={300}
                style={{ 
                  objectFit: 'contain', 
                  backgroundColor: 'black',
                  maxWidth: '100%',
                  maxHeight: '100%'
                }}
              />
              <IconButton
                size="small"
                onClick={handleImageDelete}
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 0, 0, 0.8)',
                  }
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
            <CardActions>
              <Button 
                startIcon={<EditIcon />} 
                onClick={handleOpenEditor}
                fullWidth
                sx={{ py: 1 }}
              >
                {t('painting.workspace.parameters.editImage')}
              </Button>
            </CardActions>
            
            {renderEditSummary()}
          </Card>
        )}

        {imagePreview && (
          <Box sx={{ mt: 3 }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" fontWeight="medium" color="text.primary" gutterBottom>
              {t('painting.workspace.parameters.img2imgAdjustments')}
            </Typography>

            <Box>
              <LockableSlider
                label={t('painting.workspace.parameters.strength')}
                value={params.strength}
                min={0}
                max={1}
                step={0.01}
                onChange={(newValue) => handleParamChange('strength', newValue)}
                tooltip={t('painting.workspace.parameters.strengthHelp')}
                valueLabelFormat={(value) => value.toFixed(2)}
              />

              <LockableSlider
                label={t('painting.workspace.parameters.noise')}
                value={params.noise}
                min={0}
                max={1}
                step={0.01}
                onChange={(newValue) => handleParamChange('noise', newValue)}
                tooltip={t('painting.workspace.parameters.noiseHelp')}
                valueLabelFormat={(value) => value.toFixed(2)}
              />
            </Box>
          </Box>
        )}
        
        <ImageEditor 
          key={editorKey}
          open={editorOpen} 
          onClose={handleCloseEditor} 
          imageUrl={imagePreview}
          currentDirectorToolParams={directorToolParams}
        />
      </AccordionDetails>
    </Accordion>
  );
};

export default Img2ImgPanel;
