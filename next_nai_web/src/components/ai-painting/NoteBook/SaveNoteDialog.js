/* eslint-disable @next/next/no-img-element */
// ./NoteBook/SaveNoteDialog.js
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Button,
  Grid,
  Box,
  Paper,
  InputAdornment,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
} from '@mui/material';
import {
  Image as ImageIcon,
  BrokenImage as BrokenImageIcon,
  Save as SaveIcon,
  ExpandMore as ExpandMoreIcon,
  Face as FaceIcon, // 用于角色卡图标
} from '@mui/icons-material';
import { getNoteTitleError } from '../../../utils/noteTitle.mjs';
import { useI18n } from '@/i18n/I18nProvider';

// 简单的角色卡预览组件 (与 NoteEditDialog 中的类似)
const CharacterTabPreviewSimple = ({ tab, index, t }) => (
  <Paper elevation={0} sx={{ p: 0.5, mb: 0.5, bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 0.5 }}>
    <Typography variant="caption" display="block" sx={{fontSize: '0.7rem'}}>
      {t('painting.tools.notebook.character')} {index + 1}: {tab.prompt ? (tab.prompt.substring(0, 25) + (tab.prompt.length > 25 ? '...' : '')) : t('painting.tools.notebook.untitled')}
      {tab.position && ` (${tab.position})`}
    </Typography>
  </Paper>
);


const SaveNoteDialog = ({ 
  open, 
  onClose, 
  onSave, 
  positivePrompt, 
  negativePrompt, 
  extractActiveContent,
  currentCharacterTabs, // 新增: 从 AIPaintingPage -> PromptPanel 传递过来的当前角色卡数据
}) => {
  const { t } = useI18n();
  const [noteTitle, setNoteTitle] = useState('');
  const [noteImageUrl, setNoteImageUrl] = useState('');
  const [imageUrlError, setImageUrlError] = useState(false);
  const [loading, setLoading] = useState(false);
  const titleErrorCode = getNoteTitleError(noteTitle);
  const titleError = titleErrorCode
    ? t(`painting.tools.notebook.errors.${titleErrorCode}`)
    : '';

  // 当对话框打开时，清空标题和图片链接
  useEffect(() => {
    if (open) {
      setNoteTitle('');
      setNoteImageUrl('');
      setImageUrlError(false);
    }
  }, [open]);

  const handleImageUrlChange = (e) => {
    setNoteImageUrl(e.target.value);
    setImageUrlError(false); // 每次修改都重置错误状态
  };

  const handleSave = async () => {
    if (titleError) {
      return;
    }
    setLoading(true);
    try {
      // 将当前的角色卡数据 (currentCharacterTabs) 一起传递
      const success = await onSave(noteTitle, noteImageUrl, currentCharacterTabs || []);
      if (success) { // 假设 onSave 返回一个布尔值指示成功与否
        onClose(); // 只有成功时才关闭
      }
    } catch (error) {
        console.error("保存笔记时发生错误:", error);
    } finally {
        setLoading(false);
    }
  };

  const activePositivePrompt = extractActiveContent ? extractActiveContent(positivePrompt) : positivePrompt;
  const activeNegativePrompt = extractActiveContent ? extractActiveContent(negativePrompt) : negativePrompt;
  const characterTabsToDisplay = Array.isArray(currentCharacterTabs) ? currentCharacterTabs : [];


  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('painting.tools.notebook.saveDialog.title')}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          {/* 左侧：输入和预览 */}
          <Grid item xs={12} md={7}>
            <TextField
              autoFocus
              margin="dense"
              label={t('painting.tools.notebook.noteTitle')}
              fullWidth
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              error={Boolean(titleError)}
              helperText={titleError || t('painting.tools.notebook.titleRule')}
              sx={{ mb: 2 }}
              disabled={loading}
            />
            
            <Typography variant="subtitle2" gutterBottom sx={{ mt: 1, fontWeight: 'medium' }}>
              {t('painting.tools.notebook.saveDialog.previewHelp')}:
            </Typography>
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, maxHeight: 180, overflow: 'auto', fontSize: '0.9rem' }}>
              <Typography variant="caption" display="block" fontWeight="bold">{t('painting.tools.notebook.positive')}:</Typography>
              <Typography variant="body2" sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: 'text.secondary', mb:1 }}>
                {activePositivePrompt || t('painting.tools.notebook.emptyValue')}
              </Typography>
              <Typography variant="caption" display="block" fontWeight="bold">{t('painting.tools.notebook.negative')}:</Typography>
              <Typography variant="body2" sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                {activeNegativePrompt || t('painting.tools.notebook.emptyValue')}
              </Typography>
            </Paper>

            {/* 当前角色卡预览 */}
            {characterTabsToDisplay.length > 0 && (
                <Accordion defaultExpanded={characterTabsToDisplay.length <= 3} TransitionProps={{ unmountOnExit: true }} sx={{boxShadow: 'none', border: '1px solid rgba(0,0,0,0.12)', '&:before': {display: 'none'} , mb:2}}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <FaceIcon sx={{ mr: 1, color: 'action.active' }} />
                        <Typography variant="subtitle2" sx={{fontWeight: 'medium'}}>{t('painting.tools.notebook.currentCharacterCards')} ({t('painting.tools.notebook.count', { count: characterTabsToDisplay.length })})</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ maxHeight: 150, overflowY: 'auto', p:1, pt:0 }}>
                        {characterTabsToDisplay.map((tab, index) => (
                            <CharacterTabPreviewSimple key={index} tab={tab} index={index} t={t} />
                        ))}
                    </AccordionDetails>
                </Accordion>
            )}
            
            <Typography variant="subtitle2" gutterBottom sx={{fontWeight: 'medium'}}>
              {t('painting.tools.notebook.imagePreviewUrl')}
            </Typography>
            <TextField
              fullWidth
              placeholder={t('painting.tools.notebook.imageUrlPlaceholder')}
              value={noteImageUrl}
              onChange={handleImageUrlChange}
              error={imageUrlError}
              helperText={imageUrlError
                ? t('painting.tools.notebook.invalidImageUrl')
                : t('painting.tools.notebook.imageUrlHelp')}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    {noteImageUrl && (imageUrlError ? <BrokenImageIcon color="error" /> : <ImageIcon color="primary" />)}
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          
          {/* 右侧：图片预览 */}
          <Grid item xs={12} md={5}>
            <Paper 
              elevation={0}
              sx={{
                height: '100%', display: 'flex', flexDirection: 'column',
                justifyContent: 'center', alignItems: 'center',
                p: 1.5, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid rgba(0,0,0,0.08)',
                minHeight: 200,
              }}
            >
              {noteImageUrl ? (
                <Box sx={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems:'center', justifyContent:'center' }}>
                  <img 
                    src={noteImageUrl} alt={t('painting.tools.notebook.previewImageAlt')}
                    onError={() => setImageUrlError(true)} onLoad={() => setImageUrlError(false)}
                    style={{ width: 'auto', height: 'auto', maxHeight: '280px', maxWidth:'100%', objectFit: 'contain', display: imageUrlError ? 'none' : 'block', borderRadius:'4px' }}
                  />
                  {imageUrlError && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'text.secondary' }}>
                      <BrokenImageIcon fontSize="large" color="error" />
                      <Typography variant="body2" color="error" sx={{ mt: 1 }}>{t('painting.tools.notebook.invalidImageUrlShort')}</Typography>
                    </Box>
                  )}
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'text.disabled', height: '100%' }}>
                  <ImageIcon sx={{fontSize: 48}} />
                  <Typography variant="body2" sx={{ mt: 1 }}>{t('painting.tools.notebook.imagePreviewArea')}</Typography>
                  <Typography variant="caption" align="center" sx={{ mt: 0.5, px: 2 }}>
                    {t('painting.tools.notebook.imagePreviewEmpty')}
                  </Typography>
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>{t('painting.tools.common.cancel')}</Button>
        <Button 
          onClick={handleSave} 
          variant="contained"
          disabled={loading || Boolean(titleError) || (!!noteImageUrl && imageUrlError)}
          startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
        >
          {loading ? t('painting.tools.common.saving') : t('painting.tools.notebook.confirmSave')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SaveNoteDialog;
