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
  Alert,
  MenuItem,
} from '@mui/material';
import {
  Image as ImageIcon,
  BrokenImage as BrokenImageIcon,
  Save as SaveIcon,
  ExpandMore as ExpandMoreIcon,
  Face as FaceIcon, // 用于角色卡图标
} from '@mui/icons-material';
import { getNoteTitleError } from '../../../utils/noteTitle.mjs';
import { getPublicToolErrorMessageKey } from '../../../utils/publicToolErrors.mjs';
import { useI18n } from '@/i18n/I18nProvider';
import { getGroupOptions } from './noteGroups.mjs';
import { normalizeNoteCharacters } from './noteCharacters.mjs';
import { getNoteContentLength, NOTE_CONTENT_LIMIT, NOTE_CHARACTER_JSON_LIMIT, NOTE_TOKEN_LIMIT } from './noteLimits.mjs';
import noteCharacterMessages from './noteCharacterMessages';
import NoteCharacterCards from './NoteCharacterCards';
import useNoteTokenCount from './useNoteTokenCount';

const SaveNoteDialog = ({ 
  open, 
  onClose, 
  onSave, 
  positivePrompt, 
  negativePrompt, 
  extractActiveContent,
  currentCharacterTabs, // 新增: 从 AIPaintingPage -> PromptPanel 传递过来的当前角色卡数据
  groups = [],
  defaultGroupId = null,
}) => {
  const { t, locale } = useI18n();
  const words = noteCharacterMessages[locale];
  const [noteTitle, setNoteTitle] = useState('');
  const [noteImageUrl, setNoteImageUrl] = useState('');
  const [imageUrlError, setImageUrlError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [saveError, setSaveError] = useState('');
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
      setGroupId(defaultGroupId);
      setSaveError('');
      setLoading(false);
    }
  }, [open, defaultGroupId]);

  const handleImageUrlChange = (e) => {
    setNoteImageUrl(e.target.value);
    setImageUrlError(false); // 每次修改都重置错误状态
  };

  const handleSave = async () => {
    if (titleError || characterError || overLimit || structureOverLimit) {
      return;
    }
    setLoading(true);
    setSaveError('');
    try {
      // 将当前的角色卡数据 (currentCharacterTabs) 一起传递
      const success = await onSave(noteTitle.trim(), noteImageUrl, characterTabsToDisplay, groupId);
      if (success !== false) {
        onClose(); // 只有成功时才关闭
      } else setSaveError(words.saveFailed);
    } catch (error) {
        setSaveError(t(getPublicToolErrorMessageKey(error, 'painting.tools.notebook.errors.NOTE_SAVE_FAILED')));
    } finally {
        setLoading(false);
    }
  };

  const activePositivePrompt = extractActiveContent ? extractActiveContent(positivePrompt) : positivePrompt;
  const activeNegativePrompt = extractActiveContent ? extractActiveContent(negativePrompt) : negativePrompt;
  let characterTabsToDisplay = [];
  let characterError = '';
  try {
    characterTabsToDisplay = normalizeNoteCharacters(currentCharacterTabs);
  } catch (error) {
    characterError = error.code === 'NOTE_CHARACTER_FIELDS_INVALID' ? words.fieldsInvalid
      : error.code === 'NOTE_CHARACTER_JSON_ARRAY_REQUIRED' ? words.arrayRequired : words.invalidJson;
  }
  const contentLength = getNoteContentLength(activePositivePrompt, activeNegativePrompt, characterTabsToDisplay);
  const { tokenCount, status: tokenizerStatus, retry: retryTokenizer } = useNoteTokenCount(open, activePositivePrompt, activeNegativePrompt, characterTabsToDisplay);
  const tokenOverLimit = tokenCount > NOTE_TOKEN_LIMIT;
  const overLimit = contentLength > NOTE_CONTENT_LIMIT;
  const structureOverLimit = Array.from(JSON.stringify(characterTabsToDisplay)).length > NOTE_CHARACTER_JSON_LIMIT;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('painting.tools.notebook.saveDialog.title')}</DialogTitle>
      <DialogContent dividers>
        {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}
        {characterError && <Alert severity="error" sx={{ mb: 2 }}>{characterError}</Alert>}
        {overLimit && <Alert severity="error" sx={{ mb: 2 }}>{words.contentLimit}</Alert>}
        {structureOverLimit && <Alert severity="error" sx={{ mb: 2 }}>{words.structureLimit}</Alert>}
        {tokenOverLimit && <Alert severity="warning" sx={{ mb: 2 }}>{words.tokenLimit}</Alert>}
        {tokenizerStatus === 'error' && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" onClick={retryTokenizer}>{words.retry}</Button>}>{words.tokenError}</Alert>}
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
            <TextField select fullWidth label={words.group} value={groupId ?? ''} disabled={loading}
              SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
              onChange={(event) => setGroupId(event.target.value || null)} sx={{ mb: 2 }}>
              <MenuItem value="">{words.ungrouped}</MenuItem>
              {getGroupOptions(groups).map((group) => <MenuItem key={group.id} value={group.id}>{group.label}</MenuItem>)}
            </TextField>
            
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
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color={tokenOverLimit ? 'warning.main' : 'text.secondary'}>
                {words.contentCount}: {tokenizerStatus === 'ready' ? `${tokenCount} tokens` : tokenizerStatus === 'error' ? '—' : words.tokenLoading} · {contentLength} {words.characters}
              </Typography>
              <Typography variant="caption" color="text.secondary">{words.tokenHelp}</Typography>
            </Box>

            {/* 当前角色卡预览 */}
            {characterTabsToDisplay.length > 0 && (
                <Accordion defaultExpanded TransitionProps={{ unmountOnExit: true }} sx={{boxShadow: 'none', border: '1px solid', borderColor: 'divider', '&:before': {display: 'none'} , mb:2}}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <FaceIcon sx={{ mr: 1, color: 'action.active' }} />
                        <Typography variant="subtitle2" sx={{fontWeight: 'medium'}}>{t('painting.tools.notebook.currentCharacterCards')} ({t('painting.tools.notebook.count', { count: characterTabsToDisplay.length })})</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ maxHeight: 300, overflowY: 'auto', p:1, pt:0 }}>
                        <NoteCharacterCards characters={characterTabsToDisplay} />
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
          disabled={loading || Boolean(titleError) || Boolean(characterError) || overLimit || structureOverLimit || (!!noteImageUrl && imageUrlError)}
          startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
        >
          {loading ? t('painting.tools.common.saving') : t('painting.tools.notebook.confirmSave')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SaveNoteDialog;
