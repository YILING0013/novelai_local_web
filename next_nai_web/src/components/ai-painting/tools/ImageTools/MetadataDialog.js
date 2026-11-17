"use client";

import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, Switch, TextField, Typography } from '@mui/material';
import { AutoAwesome, Brush, Close, ImageOutlined, PaletteOutlined, PersonOutline } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const parameterKeys = ['width', 'height', 'steps', 'guidanceScale', 'seed', 'sampler', 'noiseSchedule', 'smea', 'dyn', 'promptGuidanceRescale'];
const actionIcons = { img2img: ImageOutlined, vibe: AutoAwesome, reference: PersonOutline, inpaint: Brush, editor: PaletteOutlined };
const defaultSelection = { positivePrompt: true, negativePrompt: true, characterTabs: true };

/**
 * 在同一个弹窗中选择图片用途，编辑并勾选要导入的提示词、角色和生成参数。
 * @param {object} props 图片文件、可用用途、元数据及导入和使用图片的回调。
 * @returns {React.ReactElement} 高度固定、元数据区域独立滚动的图像导入面板。
 */
export default function MetadataDialog({ open, onClose, metadata, onApply, imageFile = null, imageActions = [], onUseImage, reading = false }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState('');
  const [draft, setDraft] = useState(metadata || {});
  const [selected, setSelected] = useState(defaultSelection);

  useEffect(() => {
    if (open) setSelected(defaultSelection);
  }, [open, imageFile]);

  useEffect(() => {
    if (open) setDraft(metadata || {});
  }, [open, imageFile, metadata]);

  useEffect(() => {
    if (!open) return undefined;
    if (!imageFile) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(imageFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [open, imageFile]);

  const importKeys = ['positivePrompt', 'negativePrompt', 'characterTabs', ...parameterKeys]
    .filter(key => draft[key] !== undefined && (key !== 'characterTabs' || draft[key].length > 0));
  const hasSelection = importKeys.some(key => selected[key]
    && (key !== 'characterTabs' || draft.characterTabs.some((_, index) => selected[`character_${index}`] !== false)));
  const allSelected = importKeys.every(key => selected[key]
    && (key !== 'characterTabs' || draft.characterTabs.every((_, index) => selected[`character_${index}`] !== false)));
  const apply = () => {
    const filtered = {};
    for (const key of importKeys) {
      if (!selected[key]) continue;
      if (key === 'characterTabs') {
        const characters = draft.characterTabs.filter((_, index) => selected[`character_${index}`] !== false);
        if (characters.length) filtered[key] = characters;
      } else filtered[key] = draft[key];
    }
    onApply(filtered);
  };

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="image-import-title"
    PaperProps={{ sx: {
      maxWidth: 980, m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' },
      height: { xs: 'calc(100dvh - 24px)', sm: 'min(740px, calc(100dvh - 64px))' }, maxHeight: 'none',
      borderRadius: 3, backgroundImage: 'none', overflow: 'hidden',
    } }}>
    <DialogTitle id="image-import-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: { xs: 2, sm: 2.5 }, pr: 6, flexShrink: 0 }}>
      <ImageOutlined color="primary" />
      <Typography component="span" sx={{ fontSize: { xs: 17, sm: 20 }, fontWeight: 600 }}>{t('painting.tools.metadata.chooseImageAction')}</Typography>
      <IconButton onClick={onClose} aria-label={t('painting.tools.metadata.close')} sx={{ position: 'absolute', right: 12, top: 12 }}><Close fontSize="small" /></IconButton>
    </DialogTitle>
    <DialogContent dividers sx={{
      p: { xs: 1.5, sm: 2.5 }, minHeight: 0, overflow: 'hidden', display: 'grid', gap: { xs: 1.5, sm: 2.5 },
      gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: preview ? 'minmax(0, 0.8fr) minmax(0, 1.2fr)' : 'minmax(0, 1fr)' },
      gridTemplateRows: { xs: preview ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)', sm: 'minmax(0, 1fr)' },
    }}>
      {preview && <Box sx={{
        minHeight: 0, minWidth: 0, overflowY: 'auto', display: { xs: 'grid', sm: 'flex' }, flexDirection: 'column',
        gridTemplateColumns: 'minmax(0, 0.75fr) minmax(0, 1.25fr)', gap: 1.5, alignContent: 'start',
      }}>
        <Box sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.default', flexShrink: 0 }}>
          <Box component="img" src={preview} alt={t('painting.tools.metadata.imagePreview')}
            sx={{ display: 'block', width: '100%', height: { xs: 92, sm: 250 }, objectFit: 'contain', p: 1 }} />
          <Box sx={{ px: 1.25, py: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="caption" title={imageFile.name} noWrap sx={{ display: 'block', fontWeight: 500 }}>{imageFile.name}</Typography>
            <Typography variant="caption" color="text.secondary">{(imageFile.size / 1024 / 1024).toFixed(2)} MB</Typography>
          </Box>
        </Box>
        {imageActions.length > 0 && <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, alignContent: 'start' }}>
          {imageActions.map(action => {
            const Icon = actionIcons[action];
            return <Button key={action} variant="outlined" startIcon={<Icon fontSize="small" />} onClick={() => onUseImage(action)} sx={{
              justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', color: 'text.primary', borderColor: 'divider',
              borderRadius: 1.5, minWidth: 0, minHeight: { xs: 46, sm: 54 }, px: { xs: 1, sm: 1.5 }, fontSize: { xs: 12, sm: 14 }, lineHeight: 1.4,
              '& .MuiButton-startIcon': { color: 'primary.main', mr: 0.75, ml: 0 },
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
            }}>{t(`painting.tools.metadata.useImage.${action}`)}</Button>;
          })}
        </Box>}
      </Box>}
      <Box data-metadata-scroll sx={{ minHeight: 0, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain', pr: 0.75, pb: 0.5, scrollbarGutter: 'stable' }}>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="subtitle2">{t('painting.tools.metadata.informationToImport')}</Typography>
            {importKeys.length > 0 && <Button size="small" onClick={() => setSelected({
              ...Object.fromEntries(importKeys.map(key => [key, !allSelected])),
              ...Object.fromEntries((draft.characterTabs || []).map((_, index) => [`character_${index}`, !allSelected])),
            })}>{t(allSelected ? 'painting.tools.metadata.deselectAll' : 'painting.tools.metadata.selectAll')}</Button>}
          </Stack>
          {reading && <Typography role="status" variant="body2" color="text.secondary">{t('painting.tools.metadata.readingInformation')}</Typography>}
          {!reading && !importKeys.length && <Typography color="text.secondary" variant="body2" sx={{ py: 3 }}>{t('painting.tools.metadata.noMetadata')}</Typography>}
          {['positivePrompt', 'negativePrompt'].filter(key => draft[key] !== undefined).map(key => <Box key={key}
            data-metadata-field={key} onClick={() => setSelected(current => ({ ...current, [key]: !current[key] }))}
            sx={{ p: 1.25, border: 1, borderColor: selected[key] ? 'primary.main' : 'divider', bgcolor: selected[key] ? 'action.selected' : 'transparent', borderRadius: 2, cursor: 'pointer' }}>
            <FormControlLabel sx={{ m: 0, mb: 0.5 }} label={t(`painting.tools.notebook.${key}`)} onClick={event => event.stopPropagation()}
              control={<Checkbox size="small" checked={Boolean(selected[key])} onChange={(_, checked) => setSelected(current => ({ ...current, [key]: checked }))} />} />
            <TextField fullWidth multiline minRows={2} maxRows={5} size="small" value={draft[key]}
              inputProps={{ 'aria-label': t(`painting.tools.notebook.${key}`) }} onClick={event => event.stopPropagation()}
              onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
          </Box>)}
          {draft.characterTabs?.length > 0 && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.characterInfo')}</Typography>
            <Stack spacing={1.25}>
              {draft.characterTabs.map((character, index) => {
                const checked = Boolean(selected.characterTabs) && selected[`character_${index}`] !== false;
                return <Box key={index} data-metadata-field={`character_${index}`} onClick={() => setSelected(current => ({ ...current, characterTabs: true, [`character_${index}`]: !checked }))}
                  sx={{ p: 1.25, border: 1, borderColor: checked ? 'primary.main' : 'divider', bgcolor: checked ? 'action.selected' : 'transparent', borderRadius: 2, cursor: 'pointer' }}>
                  <FormControlLabel sx={{ m: 0, mb: 1 }} label={character.name || `${t('painting.tools.metadata.importCharacters')} ${index + 1}`} onClick={event => event.stopPropagation()}
                    control={<Checkbox size="small" checked={checked} onChange={(_, nextChecked) => setSelected(current => ({ ...current, characterTabs: true, [`character_${index}`]: nextChecked }))} />} />
                  <Stack spacing={1.25}>
                    {['prompt', 'uc'].map(key => <TextField key={key} fullWidth multiline minRows={2} maxRows={5} size="small" value={character[key] || ''}
                      label={t(key === 'prompt' ? 'painting.tools.metadata.characterDescription' : 'painting.tools.metadata.characterNegative')}
                      onClick={event => event.stopPropagation()} onChange={event => setDraft(current => ({ ...current,
                        characterTabs: current.characterTabs.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item),
                      }))} />)}
                    <Typography variant="caption" color="text.secondary">
                      {character.position ? (/^[A-E][1-5]$/.test(character.position) ? t(`painting.tools.metadata.positions.${character.position}`) : character.position) : t('painting.tools.metadata.positionNotSet')}
                      {character.center && ` · X: ${character.center.x} · Y: ${character.center.y}`}
                    </Typography>
                  </Stack>
                </Box>;
              })}
            </Stack>
          </Box>}
          {parameterKeys.some(key => draft[key] !== undefined) && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.basicParameters')}</Typography>
            <Stack spacing={0.75}>
              {parameterKeys.filter(key => draft[key] !== undefined).map(key => <Box key={key} data-metadata-field={key}
                onClick={() => setSelected(current => ({ ...current, [key]: !current[key] }))}
                sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.75, pr: 1, border: 1, borderColor: selected[key] ? 'primary.main' : 'divider', bgcolor: selected[key] ? 'action.selected' : 'transparent', borderRadius: 1.5, cursor: 'pointer' }}>
                <Checkbox size="small" checked={Boolean(selected[key])} inputProps={{ 'aria-label': t('painting.tools.metadata.selectParameter', { name: t(`painting.tools.metadata.${key}`) }) }}
                  onClick={event => event.stopPropagation()} onChange={(_, checked) => setSelected(current => ({ ...current, [key]: checked }))} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{t(`painting.tools.metadata.${key}`)}</Typography>
                {typeof draft[key] === 'boolean'
                  ? <Switch size="small" checked={draft[key]} inputProps={{ 'aria-label': t(`painting.tools.metadata.${key}`) }}
                    onClick={event => event.stopPropagation()} onChange={(_, checked) => setDraft(current => ({ ...current, [key]: checked }))} />
                  : <TextField size="small" value={draft[key]} type={typeof draft[key] === 'number' ? 'number' : 'text'} sx={{ width: '48%' }}
                    inputProps={{ 'aria-label': t(`painting.tools.metadata.${key}`), step: 'any' }} onClick={event => event.stopPropagation()}
                    onChange={event => { const value = typeof draft[key] === 'number' ? Number(event.target.value) : event.target.value; setDraft(current => ({ ...current, [key]: value })); }} />}
              </Box>)}
            </Stack>
          </Box>}
        </Stack>
      </Box>
    </DialogContent>
    <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, gap: 1, flexShrink: 0 }}>
      <Button color="inherit" onClick={onClose}>{t('common.cancel')}</Button>
      {importKeys.length > 0 && <Button variant="contained" disabled={reading || !hasSelection} onClick={apply}>{t('painting.tools.metadata.importInformation')}</Button>}
    </DialogActions>
  </Dialog>;
}
