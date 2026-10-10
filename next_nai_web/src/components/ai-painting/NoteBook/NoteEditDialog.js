import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, MenuItem, Paper, Stack, Switch, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { Add, DeleteOutline, GridOn, Save } from '@mui/icons-material';
import { getNoteTitleError } from '../../../utils/noteTitle.mjs';
import { getPublicToolErrorMessageKey } from '../../../utils/publicToolErrors.mjs';
import { useI18n } from '@/i18n/I18nProvider';
import CharacterPositionEditorDialog from '../ParameterPanelUI/ImageParameterPanelUI/CharacterPositionEditorDialog';
import { getGroupOptions } from './noteGroups.mjs';
import { normalizeNoteCharacters } from './noteCharacters.mjs';
import { getNoteContentLength, NOTE_CONTENT_LIMIT, NOTE_CHARACTER_JSON_LIMIT, NOTE_TOKEN_LIMIT } from './noteLimits.mjs';
import noteCharacterMessages from './noteCharacterMessages';
import useNoteTokenCount from './useNoteTokenCount';

const NoteEditDialog = ({ open, onClose, note, onSave, groups = [] }) => {
  const { t, locale } = useI18n();
  const words = noteCharacterMessages[locale];
  const [editedNote, setEditedNote] = useState({ title: '', text_content1: '', text_content2: '', image_url: '', character_tabs: [], group_id: null });
  const [characterJson, setCharacterJson] = useState('[]');
  const [jsonError, setJsonError] = useState('');
  const [editorMode, setEditorMode] = useState('visual');
  const [positionOpen, setPositionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [imageError, setImageError] = useState(false);
  const titleErrorCode = getNoteTitleError(editedNote.title);
  const titleError = titleErrorCode ? t(`painting.tools.notebook.errors.${titleErrorCode}`) : '';
  const characterCount = getNoteContentLength(editedNote.text_content1, editedNote.text_content2, editedNote.character_tabs);
  const { tokenCount, status: tokenizerStatus, retry: retryTokenizer } = useNoteTokenCount(open, editedNote.text_content1, editedNote.text_content2, editedNote.character_tabs);
  const tokenOverLimit = tokenCount > NOTE_TOKEN_LIMIT;
  const overLimit = characterCount > NOTE_CONTENT_LIMIT;
  const structureOverLimit = Array.from(JSON.stringify(editedNote.character_tabs)).length > NOTE_CHARACTER_JSON_LIMIT;
  const jsonErrorMessage = jsonError === 'NOTE_CHARACTER_FIELDS_INVALID' ? words.fieldsInvalid
    : jsonError === 'NOTE_CHARACTER_JSON_ARRAY_REQUIRED' ? words.arrayRequired : words.invalidJson;

  useEffect(() => {
    if (!open) return;
    const rawCharacters = note?.character_tabs ?? note?.characterTabs ?? [];
    let characters = [];
    let error = '';
    try {
      characters = normalizeNoteCharacters(rawCharacters);
    } catch (parseError) {
      error = parseError.code;
    }
    setEditedNote({
      title: note?.title ?? '', text_content1: note?.text_content1 ?? '', text_content2: note?.text_content2 ?? '',
      image_url: note?.image_url ?? '', character_tabs: characters, group_id: note?.group_id ?? null,
    });
    // 无效历史 JSON 原样留在编辑区，禁止打开编辑器时悄悄替换为空角色数组。
    setCharacterJson(error ? (typeof rawCharacters === 'string' ? rawCharacters : JSON.stringify(rawCharacters, null, 2)) : JSON.stringify(characters, null, 2));
    setJsonError(error);
    setEditorMode(error ? 'json' : 'visual');
    setLoading(false);
    setSaveError('');
    setImageError(false);
    setPositionOpen(false);
  }, [open, note]);

  const updateCharacters = (characters) => {
    setEditedNote((previous) => ({ ...previous, character_tabs: characters }));
    setCharacterJson(JSON.stringify(characters, null, 2));
    setJsonError('');
  };

  const updateCharacter = (index, character) => {
    updateCharacters(editedNote.character_tabs.map((item, itemIndex) => itemIndex === index ? character : item));
  };

  const handleJsonChange = (event) => {
    const value = event.target.value;
    setCharacterJson(value);
    try {
      const characters = normalizeNoteCharacters(value);
      setEditedNote((previous) => ({ ...previous, character_tabs: characters }));
      setJsonError('');
    } catch (error) {
      setJsonError(error.code);
    }
  };

  const handleSave = async () => {
    if (titleError || jsonError || overLimit || structureOverLimit) return;
    setLoading(true);
    setSaveError('');
    try {
      const saved = await onSave({ ...editedNote, title: editedNote.title.trim() }, note?.title ?? '');
      if (saved !== false) onClose();
      else setSaveError(words.saveFailed);
    } catch (error) {
      setSaveError(t(getPublicToolErrorMessageKey(error, 'painting.tools.notebook.errors.NOTE_SAVE_FAILED')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('painting.tools.notebook.editDialog.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {saveError && <Alert severity="error">{saveError}</Alert>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
            <TextField autoFocus required fullWidth label={t('painting.tools.notebook.noteTitle')} value={editedNote.title}
              onChange={(event) => setEditedNote({ ...editedNote, title: event.target.value })}
              disabled={loading} error={Boolean(titleError)} helperText={titleError || t('painting.tools.notebook.titleRule')} />
            <TextField select fullWidth label={words.group} value={editedNote.group_id ?? ''}
              SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
              onChange={(event) => setEditedNote({ ...editedNote, group_id: event.target.value || null })} disabled={loading}>
              <MenuItem value="">{words.ungrouped}</MenuItem>
              {getGroupOptions(groups).map((group) => <MenuItem key={group.id} value={group.id}>{group.label}</MenuItem>)}
            </TextField>
          </Box>
          <TextField multiline fullWidth minRows={3} maxRows={7} label={t('painting.tools.notebook.positivePrompt')}
            value={editedNote.text_content1} disabled={loading} onChange={(event) => setEditedNote({ ...editedNote, text_content1: event.target.value })} />
          <TextField multiline fullWidth minRows={2} maxRows={5} label={t('painting.tools.notebook.negativePrompt')}
            value={editedNote.text_content2} disabled={loading} onChange={(event) => setEditedNote({ ...editedNote, text_content2: event.target.value })} />
          <Box>
            <Typography variant="body2" color={tokenOverLimit ? 'warning.main' : 'text.secondary'}>
              {words.contentCount}: {tokenizerStatus === 'ready' ? `${tokenCount} tokens` : tokenizerStatus === 'error' ? '—' : words.tokenLoading} · {characterCount} {words.characters}
            </Typography>
            <Typography variant="caption" color="text.secondary">{words.tokenHelp}</Typography>
          </Box>
          {tokenizerStatus === 'error' && <Alert severity="error" action={<Button color="inherit" onClick={retryTokenizer}>{words.retry}</Button>}>{words.tokenError}</Alert>}
          {tokenOverLimit && <Alert severity="warning">{words.tokenLimit}</Alert>}
          {overLimit && <Alert severity="error">{words.contentLimit}</Alert>}
          {structureOverLimit && <Alert severity="error">{words.structureLimit}</Alert>}

          <Box>
            <Typography variant="subtitle1" fontWeight={600}>{words.savedCharacters} · {editedNote.character_tabs.length}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>{words.visualHelp}</Typography>
            <Tabs value={editorMode} onChange={(_, value) => setEditorMode(value)} aria-label={words.savedCharacters} sx={{ mb: 2 }}>
              <Tab value="visual" label={words.visual} disabled={Boolean(jsonError) || loading} />
              <Tab value="json" label={words.json} disabled={loading} />
            </Tabs>
            {editorMode === 'json' ? (
              <TextField fullWidth multiline minRows={8} maxRows={18} label={words.json} value={characterJson}
                onChange={handleJsonChange} disabled={loading} error={Boolean(jsonError)} helperText={jsonError ? jsonErrorMessage : words.jsonHelp}
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.85rem' } }} />
            ) : (
              <Stack spacing={2}>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  <Button variant="outlined" startIcon={<Add />} disabled={loading}
                    onClick={() => updateCharacters([...editedNote.character_tabs, { name: '', prompt: '', uc: '', position: 'C3' }])}>{words.addCharacter}</Button>
                  <Button startIcon={<GridOn />} disabled={loading || !editedNote.character_tabs.some((character) => !character.isTemporarilyDisabled)}
                    onClick={() => setPositionOpen(true)}>{words.canvas}</Button>
                </Stack>
                {editedNote.character_tabs.length === 0 && <Typography color="text.secondary" variant="body2">{words.noCharacters}</Typography>}
                {editedNote.character_tabs.map((character, index) => (
                  <Paper key={index} variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
                    <Stack spacing={2}>
                      <Stack direction="row" alignItems="center" gap={1}>
                        <Typography variant="subtitle2" color="primary" sx={{ flexGrow: 1 }}>{t('painting.tools.notebook.character')} {index + 1}</Typography>
                        <FormControlLabel sx={{ mr: 0 }} control={<Switch size="small" checked={!character.isTemporarilyDisabled} disabled={loading}
                          onChange={(event) => updateCharacter(index, { ...character, isTemporarilyDisabled: !event.target.checked })} />} label={<Typography variant="caption">{words.enabled}</Typography>} />
                        <IconButton aria-label={words.removeCharacter} disabled={loading}
                          onClick={() => updateCharacters(editedNote.character_tabs.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutline fontSize="small" /></IconButton>
                      </Stack>
                      <TextField size="small" label={words.characterName} value={character.name ?? ''} disabled={loading}
                        onChange={(event) => updateCharacter(index, { ...character, name: event.target.value })} />
                      <TextField multiline minRows={2} maxRows={6} label={t('painting.tools.notebook.positivePrompt')} value={character.prompt} disabled={loading}
                        onChange={(event) => updateCharacter(index, { ...character, prompt: event.target.value })} />
                      <TextField multiline minRows={2} maxRows={5} label={t('painting.tools.notebook.negativePrompt')} value={character.uc} disabled={loading}
                        onChange={(event) => updateCharacter(index, { ...character, uc: event.target.value })} />
                      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
                        <TextField select size="small" label={words.position} value={character.position} disabled={loading} sx={{ minWidth: 150 }}
                          onChange={(event) => {
                            const position = event.target.value;
                            updateCharacter(index, { ...character, position, center: { x: (position.charCodeAt(0) - 65) * 0.2 + 0.1, y: (Number(position[1]) - 1) * 0.2 + 0.1 } });
                          }}>
                          {['A', 'B', 'C', 'D', 'E'].flatMap((column) => [1, 2, 3, 4, 5].map((row) => <MenuItem key={`${column}${row}`} value={`${column}${row}`}>{column}{row}</MenuItem>))}
                        </TextField>
                        {character.center && <Typography variant="caption" color="text.secondary">{words.center}: ({character.center.x.toFixed(3)}, {character.center.y.toFixed(3)})</Typography>}
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
          <TextField fullWidth label={t('painting.tools.notebook.previewImageUrl')} value={editedNote.image_url} disabled={loading}
            onChange={(event) => { setEditedNote({ ...editedNote, image_url: event.target.value }); setImageError(false); }}
            error={imageError} helperText={imageError ? t('painting.tools.notebook.invalidImageUrl') : ''} />
          {editedNote.image_url && !imageError && <Box component="img" src={editedNote.image_url} alt={t('painting.tools.notebook.previewImageAlt')}
            onError={() => setImageError(true)} sx={{ maxHeight: 220, maxWidth: '100%', objectFit: 'contain', alignSelf: 'center', borderRadius: 1 }} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">{t('painting.tools.common.cancel')}</Button>
        <Button onClick={handleSave} variant="contained" disabled={loading || Boolean(titleError) || Boolean(jsonError) || overLimit || structureOverLimit}
          startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Save />}>
          {loading ? t('painting.tools.common.saving') : t('painting.tools.notebook.saveChanges')}
        </Button>
      </DialogActions>
      <CharacterPositionEditorDialog open={positionOpen} onClose={() => setPositionOpen(false)} characterTabs={editedNote.character_tabs}
        onCharacterDataChange={updateCharacter} width={1024} height={1024} />
    </Dialog>
  );
};

export default NoteEditDialog;
