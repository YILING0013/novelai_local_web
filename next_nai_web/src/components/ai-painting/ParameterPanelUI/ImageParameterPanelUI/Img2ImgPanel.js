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
        m: 0,
        border: 0,
        borderTop: '1px solid',
        borderColor: 'divider',
        borderRadius: 0,
        bgcolor: 'transparent',
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
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <ImageIcon sx={{ mr: 1, fontSize: 18, color: 'text.secondary' }} />
          <Typography sx={{ fontSize: 15, fontWeight: 500 }}>{t('painting.workspace.parameters.img2img')}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, py: 2 }}>
        <Typography color="text.secondary" display="block" sx={{ mb: 2, fontSize: 14, lineHeight: 1.6 }}>
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
              border: '1px dashed',
              borderColor: isDragging ? 'primary.main' : 'divider',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isDragging ? 'action.hover' : 'transparent',
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
              <Typography sx={{ fontSize: 14 }} color={isDragging ? 'primary.main' : 'text.secondary'}>
                {isDragging
                  ? t('painting.workspace.parameters.releaseToUploadImage')
                  : t('painting.workspace.parameters.clickOrDropImageHere')}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ 
              position: 'relative', 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              p: 0.75,
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
            <CardActions sx={{ px: 0, py: 0.5 }}>
              <Button 
                startIcon={<EditIcon />} 
                onClick={handleOpenEditor}
                fullWidth
                sx={{ py: 0.5 }}
              >
                {t('painting.workspace.parameters.editImage')}
              </Button>
            </CardActions>
            
            {renderEditSummary()}
          </Box>
        )}

        {imagePreview && (
          <Box sx={{ mt: 1.5 }}>
            <Divider sx={{ mb: 1 }} />
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
        
        {editorOpen && <ImageEditor
          key={editorKey}
          open={editorOpen} 
          onClose={handleCloseEditor} 
          imageUrl={imagePreview}
          currentDirectorToolParams={directorToolParams}
        />}
      </AccordionDetails>
    </Accordion>
  );
};

export default Img2ImgPanel;
