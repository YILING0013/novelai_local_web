"use client";

import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

const settingFields = ['width', 'height', 'steps', 'guidanceScale', 'sampler', 'noiseSchedule', 'smea', 'dyn', 'promptGuidanceRescale'];

/**
 * 预览拖入的图片、选择用途，或只导入选中的图像信息；不展示参数值。
 * @param {object} props 图片文件、可用用途、元数据和用户选择后的处理回调。
 * @returns {React.ReactElement} 图像用途与信息导入面板。
 */
export default function MetadataDialog({ open, onClose, metadata, onApply, imageFile = null, imageActions = [], onUseImage, reading = false }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState('');
  const [selected, setSelected] = useState({ prompt: true, negative: true, characters: true, settings: false, seed: false });

  useEffect(() => {
    if (!open) return undefined;
    setSelected({ prompt: true, negative: true, characters: true, settings: false, seed: false });
    if (!imageFile) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(imageFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [open, imageFile, metadata]);

  const fields = [
    { id: 'prompt', label: 'importPrompt', keys: ['positivePrompt'] },
    { id: 'negative', label: 'importNegativePrompt', keys: ['negativePrompt'] },
    { id: 'characters', label: 'importCharacters', keys: ['characterTabs'] },
    { id: 'settings', label: 'importSettings', keys: settingFields },
    { id: 'seed', label: 'importSeed', keys: ['seed'] },
  ].filter(({ keys }) => keys.some(key => metadata?.[key] !== undefined && metadata[key] !== '' && (!Array.isArray(metadata[key]) || metadata[key].length > 0)));

  const apply = () => {
    const filtered = {};
    for (const field of fields) {
      if (!selected[field.id]) continue;
      for (const key of field.keys) {
        if (metadata[key] !== undefined) filtered[key] = metadata[key];
      }
    }
    onApply(filtered);
  };

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
    <DialogTitle>{t('painting.tools.metadata.chooseImageAction')}</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2.5}>
        {preview && <Box component="img" src={preview} alt={t('painting.tools.metadata.imagePreview')}
          sx={{ display: 'block', width: '100%', height: 'clamp(140px, 28vh, 280px)', objectFit: 'contain', bgcolor: 'background.default', borderRadius: 1 }} />}
        {imageFile && imageActions.length > 0 && <Stack direction="row" flexWrap="wrap" gap={1}>
          {imageActions.map(action => <Button key={action} variant="outlined" onClick={() => onUseImage(action)}>
            {t(`painting.tools.metadata.useImage.${action}`)}
          </Button>)}
        </Stack>}
        {reading && <Typography role="status" variant="body2" color="text.secondary">{t('painting.tools.metadata.readingInformation')}</Typography>}
        {fields.length > 0 && <Box>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('painting.tools.metadata.importInformation')}</Typography>
          <Stack>
            {fields.map(field => <FormControlLabel key={field.id} label={t(`painting.tools.metadata.${field.label}`)}
              control={<Checkbox checked={selected[field.id]} onChange={(_, checked) => setSelected(current => ({ ...current, [field.id]: checked }))} />} />)}
          </Stack>
        </Box>}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>{t('common.cancel')}</Button>
      {fields.length > 0 && <Button variant="contained" disabled={reading || !fields.some(field => selected[field.id])} onClick={apply}>
        {t('painting.tools.metadata.importInformation')}
      </Button>}
    </DialogActions>
  </Dialog>;
}
