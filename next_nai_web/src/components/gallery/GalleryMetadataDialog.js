"use client";

import React, { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 单张和批量图片共用的元数据另存表单，原图始终保留。
 * @param {object} props 图片数量、初始参数和另存回调；批量编辑只提交填写的字段。
 * @returns {React.ReactElement} 元数据编辑与清除对话框。
 */
export default function GalleryMetadataDialog({ count, initialParameters = {}, onClose, onSubmit, busy, error }) {
  const { t } = useI18n();
  const [mode, setMode] = useState('edit');
  const [parameters, setParameters] = useState(initialParameters);
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState(JSON.stringify(initialParameters, null, 2));
  const [validationError, setValidationError] = useState('');

  const submit = () => {
    let result = parameters;
    if (mode === 'edit' && advanced) {
      try {
        result = JSON.parse(jsonText);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      } catch {
        setValidationError(t('gallery.invalidParameters'));
        return;
      }
    }
    setValidationError('');
    onSubmit({ mode, ...(mode === 'edit' ? { parameters: result } : {}) });
  };

  return <Dialog open onClose={() => !busy && onClose()} maxWidth="sm" fullWidth>
    <DialogTitle>{t('gallery.metadataTitle', { count })}</DialogTitle>
    <DialogContent sx={{ pt: '8px !important' }}>
      <Stack spacing={2}>
        {(error || validationError) && <Alert severity="error">{validationError || error}</Alert>}
        <Typography variant="body2" color="text.secondary">{t('gallery.metadataCopyHint')}</Typography>
        <ToggleButtonGroup exclusive value={mode} size="small" onChange={(_, next) => next && setMode(next)} aria-label={t('gallery.metadataAction')}>
          <ToggleButton value="edit">{t('gallery.editMetadata')}</ToggleButton>
          <ToggleButton value="strip">{t('gallery.clearMetadata')}</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'strip' ? <Alert severity="info">{t('gallery.clearMetadataHint')}</Alert> : <>
          {count > 1 && <Alert severity="info">{t('gallery.batchMetadataHint')}</Alert>}
          {!advanced && <>
            {['positivePrompt', 'negativePrompt'].map((field) => <TextField key={field} size="small" multiline minRows={3}
              label={t(`gallery.${field}`)} value={parameters[field] ?? ''} disabled={busy}
              onChange={(event) => setParameters({ ...parameters, [field]: event.target.value })} />)}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
              {['model', 'seed', 'steps', 'guidanceScale'].map((field) => <TextField key={field} size="small"
                label={t(`gallery.${field}`)} value={parameters[field] ?? ''} disabled={busy}
                type={field === 'model' ? 'text' : 'number'}
                onChange={(event) => setParameters({ ...parameters, [field]: field === 'model' || event.target.value === '' ? event.target.value : Number(event.target.value) })} />)}
            </Box>
          </>}
          <Accordion expanded={advanced} disableGutters onChange={(_, expanded) => {
            if (expanded) setJsonText(JSON.stringify(parameters, null, 2));
            else {
              try {
                const value = JSON.parse(jsonText);
                if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
                setParameters(value);
                setValidationError('');
              } catch { setValidationError(t('gallery.invalidParameters')); return; }
            }
            setAdvanced(expanded);
          }}>
            <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2">{t('gallery.allParameters')}</Typography></AccordionSummary>
            <AccordionDetails>
              <TextField fullWidth multiline minRows={10} maxRows={18} value={jsonText} disabled={busy}
                label={t('gallery.parametersJson')} onChange={(event) => setJsonText(event.target.value)}
                slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }} />
            </AccordionDetails>
          </Accordion>
        </>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}>
      <Button onClick={onClose} disabled={busy}>{t('gallery.cancel')}</Button>
      <Button variant="contained" onClick={submit} disabled={busy}>{t(busy ? 'gallery.saving' : 'gallery.saveCopy')}</Button>
    </DialogActions>
  </Dialog>;
}
