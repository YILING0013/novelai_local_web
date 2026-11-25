import React, { useContext, useState } from 'react';
import EditorExerciseContext from '@/components/tutorials/EditorExerciseContext';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography } from '@mui/material';
import { CheckCircleOutline, Close, EditOutlined } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { MODEL_OPTIONS } from '../utils/generationOptions';
import { normalizeNoteCharacters } from './noteCharacters.mjs';
import noteCharacterMessages from './noteCharacterMessages';
import NoteCharacterCards from './NoteCharacterCards';
import NotePromptPreview from './NotePromptPreview';

const NoteViewDialog = ({ open, onClose, note, onEdit, onUse }) => {
  const { t, locale } = useI18n();
  const exercise = useContext(EditorExerciseContext);
  const [failedImage, setFailedImage] = useState(null);
  if (!note || !open) return null;
  let characters = [];
  let characterError = false;
  try {
    characters = normalizeNoteCharacters(note.character_tabs ?? note.characterTabs, note.model);
  } catch {
    characterError = true;
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      sx={{ '& .MuiDialog-paper': { m: { xs: 1, sm: 4 }, width: { xs: 'calc(100% - 16px)', sm: '100%' } } }}>
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, px: { xs: 2, sm: 3 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>{note.title}</Typography>
          {note.model && <Chip size="small" variant="outlined" sx={{ mt: 0.75 }} label={MODEL_OPTIONS.find((option) => option.value === note.model)?.label || note.model} />}
        </Box>
        <IconButton data-release-target="closePreview" aria-label={t('painting.tools.common.close')} onClick={onClose}><Close /></IconButton>
      </DialogTitle>
      {exercise?.instructions && <Box sx={{ px: 2 }}>{exercise.instructions}</Box>}
      <DialogContent dividers sx={{ px: { xs: 1.5, sm: 3 }, py: 2 }}>
        <Stack spacing={2.5}>
          {note.image_url && (failedImage === note.image_url
            ? <Alert severity="warning">{t('painting.tools.notebook.imageLoadFailed')}</Alert>
            : <Box component="img" src={note.image_url} alt={note.title} onError={() => setFailedImage(note.image_url)}
                sx={{ alignSelf: 'center', objectFit: 'contain', maxWidth: '100%', maxHeight: 'min(32vh, 260px)', borderRadius: 2 }} />)}
          <NotePromptPreview positive={note.text_content1} negative={note.text_content2} />
          {characterError && <Alert severity="error">{noteCharacterMessages[locale].parsingFailed}</Alert>}
          {characters.length > 0 && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                <Typography component="h3" variant="subtitle1" fontWeight={600}>{t('painting.tools.notebook.characterCards')}</Typography>
                <Typography variant="caption" color="text.secondary">{t('painting.tools.notebook.count', { count: characters.length })}</Typography>
                {note.character_position_mode && <Chip size="small" variant="outlined" label={t(`painting.workspace.parameters.${note.character_position_mode === 'custom' ? 'positionModeCustom' : 'positionModeAi'}`)} />}
              </Box>
              <NoteCharacterCards characters={characters} model={note.model} highlightFirst />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
        {onEdit && <Button onClick={() => { onClose(); onEdit(note); }} startIcon={<EditOutlined />}>{t('painting.tools.common.edit')}</Button>}
        {onUse && <Button variant="contained" disabled={characterError} onClick={() => { if (onUse(note) !== false) onClose(); }} startIcon={<CheckCircleOutline />}>
          {t('painting.tools.notebook.useThisNote')}
        </Button>}
      </DialogActions>
    </Dialog>
  );
};

export default NoteViewDialog;
