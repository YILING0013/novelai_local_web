"use client";

import React from 'react';
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const InpaintSourcePicker = ({ open, items, onClose, onSelect }) => {
  const { t } = useI18n();
  const imageItems = items.filter((item) => item.type !== 'video');

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1.5 }}>
        <Typography variant="h6">{t('painting.workspace.inpaint.selectFromGallery')}</Typography>
        <IconButton aria-label={t('painting.workspace.inpaint.closePicker')} onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {imageItems.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
            <ImageIcon color="disabled" sx={{ fontSize: 40, mb: 1 }} />
            <Typography color="text.secondary">{t('painting.workspace.inpaint.noGalleryImages')}</Typography>
          </Paper>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 1.5,
            }}
          >
            {imageItems.map((item, index) => (
              <Paper
                key={item.id}
                elevation={1}
                onClick={() => onSelect(item)}
                sx={{
                  cursor: 'pointer',
                  overflow: 'hidden',
                  borderRadius: 2,
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: 4,
                  },
                }}
              >
                <Box
                  component="img"
                  src={item.src}
                  alt={item.prompt || t('painting.workspace.inpaint.galleryImageAlt', { index: index + 1 })}
                  sx={{
                    display: 'block',
                    width: '100%',
                    height: 120,
                    objectFit: 'cover',
                  }}
                />
                <Box sx={{ p: 1 }}>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {t('painting.workspace.inpaint.seedValue', {
                      seed: item.seed || t('painting.workspace.inpaint.notRecorded'),
                    })}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default InpaintSourcePicker;
