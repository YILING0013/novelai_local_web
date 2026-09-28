"use client";

import React, { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import GalleryMetadataFields, { getParameterSharedPaths } from './GalleryMetadataFields';

const basicFields = ['model', 'seed', 'steps', 'guidanceScale', 'sampler', 'width', 'height'];

/**
 * 用统一提示词、角色和递归字段编辑图片元数据；只提交改过的参数，另存时保留原图。
 * @param {object} props 单张图片的参数与完整元数据树；批量操作只覆盖用户填写的参数。
 * @returns {React.ReactElement} 可视化元数据另存表单。
 */
export default function GalleryMetadataDialog({ count, initialParameters = {}, initialDocument, metadataSharedPaths = [], onClose, onSubmit, busy, error }) {
  const { t } = useI18n();
  const [mode, setMode] = useState('edit');
  const [parameters, setParameters] = useState(initialParameters);
  const [changes, setChanges] = useState({});
  const [document, setDocument] = useState(initialDocument);
  const [documentChanged, setDocumentChanged] = useState(false);
  const hiddenParameters = [...getParameterSharedPaths(parameters), ...basicFields.map((key) => [key])];
  const cardSx = { p: { xs: 1.5, sm: 2 }, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' };

  const changeParameters = (next, path) => {
    setParameters(next);
    setChanges((current) => ({ ...current, [path[0]]: next[path[0]] }));
  };

  return <Dialog open onClose={() => !busy && onClose()} maxWidth="md" fullWidth>
    <DialogTitle>{t('gallery.metadataTitle', { count })}</DialogTitle>
    <DialogContent sx={{ pt: '8px !important', px: { xs: 1.5, sm: 3 }, bgcolor: 'background.default' }}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography variant="body2" color="text.secondary">{t('gallery.metadataCopyHint')}</Typography>
        <ToggleButtonGroup exclusive value={mode} size="small" onChange={(_, next) => next && setMode(next)} aria-label={t('gallery.metadataAction')} disabled={busy}>
          <ToggleButton value="edit">{t('gallery.editMetadata')}</ToggleButton>
          <ToggleButton value="strip">{t('gallery.clearMetadata')}</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'strip' ? <Alert severity="info">{t('gallery.clearMetadataHint')}</Alert> : <>
          {count > 1 && <Alert severity="info">{t('gallery.batchMetadataHint')}</Alert>}
          <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('gallery.mainPrompts')}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>{t('gallery.sharedPromptHint')}</Typography>
            <Stack spacing={2}>{['positivePrompt', 'negativePrompt'].map((field) => <TextField key={field} size="small" multiline minRows={3} maxRows={12}
              label={t(`gallery.${field}`)} value={parameters[field] ?? ''} disabled={busy}
              onChange={(event) => changeParameters({ ...parameters, [field]: event.target.value }, [field])} />)}</Stack>
          </Box>
          <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>{t('gallery.generationParameters')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
              {basicFields.map((field) => <TextField key={field} size="small" label={t(`gallery.${field}`)} value={parameters[field] ?? ''} disabled={busy}
                type={['model', 'sampler'].includes(field) ? 'text' : 'number'} inputProps={{ step: 'any' }} sx={field === 'model' ? { gridColumn: '1 / -1' } : undefined}
                onChange={(event) => changeParameters({ ...parameters, [field]: ['model', 'sampler'].includes(field) || event.target.value === '' ? event.target.value : Number(event.target.value) }, [field])} />)}
            </Box>
          </Box>
          {parameters.characterTabs?.length > 0 && <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('gallery.characterPrompts')}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{t('gallery.characterPromptHint')}</Typography>
            <GalleryMetadataFields value={{ characterTabs: parameters.characterTabs }} disabled={busy} allowStructure={false}
              onChange={(next, path) => changeParameters({ ...parameters, ...next }, path)} />
          </Box>}
          <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('gallery.otherParameters')}</Typography>
            <GalleryMetadataFields value={parameters} hiddenPaths={hiddenParameters} disabled={busy} allowStructure={count > 1} onChange={changeParameters} />
          </Box>
          {document && count === 1 && <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('gallery.originalMetadata')}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{t('gallery.metadataTreeHint')}</Typography>
            <GalleryMetadataFields value={document} hiddenPaths={metadataSharedPaths} disabled={busy} onChange={(next) => { setDocument(next); setDocumentChanged(true); }} />
          </Box>}
        </>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: { xs: 1.5, sm: 3 }, py: 2, borderTop: 1, borderColor: 'divider' }}>
      <Button onClick={onClose} disabled={busy}>{t('gallery.cancel')}</Button>
      <Button variant="contained" onClick={() => onSubmit({ mode, ...(mode === 'edit' ? { parameters: changes, ...(documentChanged ? { metadata_document: document } : {}) } : {}) })} disabled={busy}>{t(busy ? 'gallery.saving' : 'gallery.saveCopy')}</Button>
    </DialogActions>
  </Dialog>;
}
