/* eslint-disable @next/next/no-img-element */
// ./NoteBook/NoteViewDialog.js
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Button,
  Grid,
  Box,
  Paper,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
} from '@mui/material';
import {
  Cancel as CancelIcon,
  BrokenImage as BrokenImageIcon,
  Edit as EditIcon,
  CheckCircle as CheckCircleIcon,
  ExpandMore as ExpandMoreIcon,
  Face as FaceIcon, // 用于角色卡图标
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { normalizeNoteCharacters } from './noteCharacters.mjs';
import noteCharacterMessages from './noteCharacterMessages';
import NoteCharacterCards from './NoteCharacterCards';

const NoteViewDialog = ({ open, onClose, note, onEdit, onUse }) => {
  const { t, locale } = useI18n();
  if (!note) return null;

  let characterTabs = [];
  let characterError = false;
  try {
    characterTabs = normalizeNoteCharacters(note.character_tabs ?? note.characterTabs);
  } catch {
    characterError = true;
  }

  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        {note.title}
        <IconButton
          aria-label={t('painting.tools.common.close')}
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CancelIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {characterError && <Alert severity="error" sx={{ mb: 2 }}>{noteCharacterMessages[locale].parsingFailed}</Alert>}
        <Grid container spacing={2}>
          {/* 图像预览 */}
          {note.image_url && (
            <Grid item xs={12} sx={{ mb: 1 }}>
              <Box 
                sx={{ 
                  width: '100%', display: 'flex', justifyContent: 'center',
                  bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 1, p: 1, minHeight: 150
                }}
              >
                <img 
                  src={note.image_url} alt={note.title}
                  style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '4px' }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    const errorBox = e.target.nextSibling;
                    if (errorBox) errorBox.style.display = 'flex';
                  }}
                />
                <Box sx={{ display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, minHeight: 150 }}>
                  <BrokenImageIcon color="error" sx={{ fontSize: 40 }} />
                  <Typography color="error" variant="caption" sx={{ mt: 1 }}>{t('painting.tools.notebook.imageLoadFailed')}</Typography>
                </Box>
              </Box>
            </Grid>
          )}
          
          {/* 提示词内容 */}
          <Grid item xs={12} md={note.image_url ? 6 : 12}> {/* 如果有图片，则提示词占一半宽度 */}
            <Typography variant="subtitle2" gutterBottom sx={{fontWeight: 'medium'}}>{t('painting.tools.notebook.positivePrompt')}</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 200, overflow: 'auto', bgcolor: 'rgba(0,0,0,0.01)' }}>
              <Typography variant="body2" sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                {note.text_content1 || t('painting.tools.notebook.emptyValue')}
              </Typography>
            </Paper>
          </Grid>
          
          <Grid item xs={12} md={note.image_url ? 6 : 12}>
            <Typography variant="subtitle2" gutterBottom sx={{fontWeight: 'medium'}}>{t('painting.tools.notebook.negativePrompt')}</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 200, overflow: 'auto', bgcolor: 'rgba(0,0,0,0.01)' }}>
              <Typography variant="body2" sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                {note.text_content2 || t('painting.tools.notebook.emptyValue')}
              </Typography>
            </Paper>
          </Grid>

          {/* 角色卡展示区域 */}
          {characterTabs.length > 0 && (
            <Grid item xs={12}>
              <Accordion defaultExpanded TransitionProps={{ unmountOnExit: true }} sx={{boxShadow: 'none', border: '1px solid', borderColor: 'divider', '&:before': {display: 'none'} }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <FaceIcon sx={{ mr: 1, color: 'action.active' }} />
                  <Typography variant="subtitle2" sx={{fontWeight: 'medium'}}>{t('painting.tools.notebook.characterCards')} ({t('painting.tools.notebook.count', { count: characterTabs.length })})</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ maxHeight: 300, overflowY: 'auto', p: {xs: 1, sm: 1.5} }}>
                  <NoteCharacterCards characters={characterTabs} />
                </AccordionDetails>
              </Accordion>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button 
          variant="outlined" 
          onClick={() => { onClose(); onEdit(note); }}
          startIcon={<EditIcon />}
        >
          {t('painting.tools.common.edit')}
        </Button>
        <Button 
          variant="contained" 
          disabled={characterError}
          onClick={() => { onUse(note); onClose(); }}
          startIcon={<CheckCircleIcon />}
        >
          {t('painting.tools.notebook.useThisNote')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NoteViewDialog;
