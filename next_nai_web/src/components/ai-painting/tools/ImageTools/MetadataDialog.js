"use client";

import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, Switch, Slider, TextField, MenuItem, Typography } from '@mui/material';
import { AutoAwesome, Brush, Close, ImageOutlined, PaletteOutlined, PersonOutline } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import InlinePromptInput from '../../PromptEditor/InlinePromptInput';
import { MODEL_OPTIONS, SAMPLER_OPTIONS, NOISE_SCHEDULE_OPTIONS, resolveMetadataModel } from '../../utils/generationOptions';
import { DEFAULT_PAINTING_MODEL_ID } from '../../utils/modelUtils';
import { getImageImportOptions, normalizeImageImportParameters } from '../../utils/parameterMapping';
import { useI18n } from '@/i18n/I18nProvider';

const defaultParams = { model: DEFAULT_PAINTING_MODEL_ID, width: 1024, height: 1024, use_upscale_credits: false };
const parameterKeys = ['model', 'width', 'height', 'steps', 'guidanceScale', 'seed', 'sampler', 'noiseSchedule', 'smea', 'dyn', 'promptGuidanceRescale'];
const actionIcons = { img2img: ImageOutlined, vibe: AutoAwesome, reference: PersonOutline, inpaint: Brush, editor: PaletteOutlined };
const defaultSelection = { positivePrompt: true, negativePrompt: true, characterTabs: true };

/**
 * 在同一个弹窗中选择图片用途，编辑并勾选要导入的提示词、角色和生成参数。
 * @param {object} props 图片文件、可用用途、元数据及导入和使用图片的回调。
 * @returns {React.ReactElement} 高度固定、元数据区域独立滚动的图像导入面板。
 */
export default function MetadataDialog({ open, onClose, metadata, onApply, imageFile = null, imageActions = [], onUseImage, reading = false, params = defaultParams, allowedModels = null, restrictedAccount = false }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState('');
  const [draft, setDraft] = useState(metadata || {});
  const [selected, setSelected] = useState(defaultSelection);

  useEffect(() => {
    if (!open) return;
    const detectedModel = resolveMetadataModel(metadata?.model);
    const permittedModel = detectedModel && (!allowedModels || allowedModels.includes(detectedModel)) ? detectedModel : undefined;
    setSelected({ ...defaultSelection, model: Boolean(permittedModel) });
    setDraft(metadata ? normalizeImageImportParameters({ ...metadata, model: permittedModel || params.model },
      { ...params, model: permittedModel || params.model }, restrictedAccount) : {});
  }, [open, imageFile, metadata, params, restrictedAccount, allowedModels]);

  useEffect(() => {
    if (!open) return undefined;
    if (!imageFile) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(imageFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [open, imageFile]);

  const effectiveParams = { ...params, model: selected.model ? draft.model : params.model };
  const options = getImageImportOptions(effectiveParams, restrictedAccount);
  const modelOptions = MODEL_OPTIONS.filter(option => option.category !== 'video' && (!allowedModels || allowedModels.includes(option.value)));
  const allowedKeys = new Set(['model', ...Object.keys(options.ranges),
    ...(options.resolutions.length ? ['width', 'height'] : []),
    ...(options.novelAI ? ['sampler', 'smea', 'dyn', ...(options.medium ? [] : ['noiseSchedule'])] : [])]);
  const importKeys = ['positivePrompt', 'negativePrompt', 'characterTabs', ...parameterKeys]
    .filter(key => draft[key] !== undefined && (key !== 'characterTabs' || draft[key].length > 0)
      && (!parameterKeys.includes(key) || allowedKeys.has(key)) && !(options.medium && key === 'negativePrompt'));
  const hasSelection = importKeys.some(key => selected[key]
    && (key !== 'characterTabs' || draft.characterTabs.some((_, index) => selected[`character_${index}`] !== false)));
  const allSelected = importKeys.every(key => selected[key]
    && (key !== 'characterTabs' || draft.characterTabs.every((_, index) => selected[`character_${index}`] !== false)));
  const toggleParameter = (key, checked) => {
    setSelected(current => ({ ...current, [key]: checked,
      ...(['width', 'height'].includes(key) ? { width: checked, height: checked } : {}),
    }));
    if (key === 'model') setDraft(current => normalizeImageImportParameters(current,
      { ...params, model: checked ? current.model : params.model }, restrictedAccount));
  };
  const updateParameter = (key, value) => {
    const model = key === 'model' ? value : effectiveParams.model;
    setDraft(current => normalizeImageImportParameters({ ...current, [key]: value }, { ...params, model }, restrictedAccount,
      ['width', 'height'].includes(key) ? key : undefined));
    if (key === 'model') setSelected(current => ({ ...current, model: true }));
  };
  const apply = () => {
    const normalized = normalizeImageImportParameters(draft, effectiveParams, restrictedAccount);
    const filtered = {};
    for (const key of importKeys) {
      if (!selected[key]) continue;
      if (key === 'characterTabs') {
        const characters = normalized.characterTabs.filter((_, index) => selected[`character_${index}`] !== false)
          .map(character => options.medium ? { ...character, uc: '' } : character);
        if (characters.length) filtered[key] = characters;
      } else filtered[key] = normalized[key];
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
      <Box data-metadata-scroll sx={{ minHeight: 0, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain', pr: 0.75, pb: 0.5, scrollbarGutter: 'stable', '& .MuiCheckbox-root.Mui-checked': { color: theme => alpha(theme.palette.primary.main, 0.65) } }}>
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
            data-metadata-field={key} onClick={() => { if (!(options.medium && key === 'negativePrompt')) toggleParameter(key, !selected[key]); }}
            sx={{ p: 1.25, border: 1, borderColor: theme => selected[key] ? alpha(theme.palette.primary.main, 0.35) : theme.palette.divider, bgcolor: 'transparent', borderRadius: 2, cursor: 'pointer' }}>
            <FormControlLabel sx={{ m: 0, mb: 0.5 }} label={t(`painting.tools.notebook.${key}`)} onClick={event => event.stopPropagation()}
              control={<Checkbox size="small" disabled={options.medium && key === 'negativePrompt'} checked={Boolean(selected[key]) && !(options.medium && key === 'negativePrompt')} onChange={(_, checked) => toggleParameter(key, checked)} />} />
            <Box onClick={event => event.stopPropagation()}>
              <InlinePromptInput value={draft[key]} previewEnabled expandToContent minRows={2}
                placeholder={t(`painting.tools.notebook.${key}`)} inputProps={{ readOnly: options.medium && key === 'negativePrompt' }}
                onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, [key]: value })); }} />
            </Box>
          </Box>)}
          {draft.characterTabs?.length > 0 && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.characterInfo')}</Typography>
            <Stack spacing={1.25}>
              {draft.characterTabs.map((character, index) => {
                const checked = Boolean(selected.characterTabs) && selected[`character_${index}`] !== false;
                return <Box key={index} data-metadata-field={`character_${index}`} onClick={() => setSelected(current => ({ ...current, characterTabs: true, [`character_${index}`]: !checked }))}
                  sx={{ p: 1.25, border: 1, borderColor: theme => checked ? alpha(theme.palette.primary.main, 0.35) : theme.palette.divider, bgcolor: 'transparent', borderRadius: 2, cursor: 'pointer' }}>
                  <FormControlLabel sx={{ m: 0, mb: 1 }} label={character.name || `${t('painting.tools.metadata.importCharacters')} ${index + 1}`} onClick={event => event.stopPropagation()}
                    control={<Checkbox size="small" checked={checked} onChange={(_, nextChecked) => setSelected(current => ({ ...current, characterTabs: true, [`character_${index}`]: nextChecked }))} />} />
                  <Stack spacing={1.25}>
                    {['prompt', 'uc'].map(key => <Box key={key} onClick={event => event.stopPropagation()}>
                      <Typography variant="caption" color="text.secondary">{t(key === 'prompt' ? 'painting.tools.metadata.characterDescription' : 'painting.tools.metadata.characterNegative')}</Typography>
                      <InlinePromptInput value={character[key] || ''} previewEnabled expandToContent minRows={2}
                        placeholder={t(key === 'prompt' ? 'painting.tools.metadata.characterDescription' : 'painting.tools.metadata.characterNegative')}
                        inputProps={{ readOnly: options.medium && key === 'uc' }} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current,
                          characterTabs: current.characterTabs.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
                        })); }} />
                    </Box>)}
                    <Typography variant="caption" color="text.secondary">
                      {character.position ? (/^[A-E][1-5]$/.test(character.position) ? t(`painting.tools.metadata.positions.${character.position}`) : character.position) : t('painting.tools.metadata.positionNotSet')}
                      {character.center && ` · X: ${character.center.x} · Y: ${character.center.y}`}
                    </Typography>
                  </Stack>
                </Box>;
              })}
            </Stack>
          </Box>}
          {parameterKeys.some(key => importKeys.includes(key)) && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.basicParameters')}</Typography>
            <Stack spacing={0.75}>
              {parameterKeys.filter(key => importKeys.includes(key) && key !== 'height').map(key => {
                const size = key === 'width';
                const choices = key === 'model' ? modelOptions : key === 'sampler' ? SAMPLER_OPTIONS : key === 'noiseSchedule' ? NOISE_SCHEDULE_OPTIONS : null;
                const label = t(`painting.tools.metadata.${size ? 'size' : key}`);
                const fixed = Object.hasOwn(options.fixed, key);
                return <Box key={key} data-metadata-field={size ? 'size' : key}
                  onClick={() => toggleParameter(key, !selected[key])}
                  sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 1, pr: 1, border: 1,
                    borderColor: theme => selected[key] ? alpha(theme.palette.primary.main, 0.35) : theme.palette.divider, borderRadius: 1.5, cursor: 'pointer' }}>
                  <Checkbox size="small" checked={Boolean(selected[key])} inputProps={{ 'aria-label': t('painting.tools.metadata.selectParameter', { name: label }) }}
                    onClick={event => event.stopPropagation()} onChange={(_, checked) => toggleParameter(key, checked)} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{label}</Typography>
                  <Box sx={{ width: '58%', minWidth: 0 }} onClick={event => event.stopPropagation()}>
                    {size ? <Stack direction="row" spacing={1}>
                      {['width', 'height'].map(dimension => <TextField key={dimension} select size="small" fullWidth value={draft[dimension]}
                        label={t(`painting.tools.metadata.${dimension}`)} onChange={event => updateParameter(dimension, Number(event.target.value))}>
                        {[...new Set(options.resolutions.map(resolution => resolution[dimension === 'width' ? 0 : 1]))].sort((a, b) => a - b)
                          .map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                      </TextField>)}
                    </Stack> : choices ? <TextField select fullWidth size="small" value={draft[key]} disabled={fixed}
                      label={label} onChange={event => updateParameter(key, event.target.value)}>
                      {choices.map(option => <MenuItem key={option.value} value={option.value}>{key === 'noiseSchedule' ? t(`painting.workspace.parameters.${option.label}`) : option.label}</MenuItem>)}
                    </TextField> : typeof draft[key] === 'boolean' ? <Switch size="small" checked={draft[key]} disabled={fixed}
                      inputProps={{ 'aria-label': label }} onChange={(_, checked) => updateParameter(key, checked)} />
                    : key === 'seed' ? <TextField size="small" fullWidth value={draft[key]} type="number" label={label}
                      inputProps={{ min: options.ranges.seed.min, max: options.ranges.seed.max, step: 1 }}
                      onChange={event => updateParameter(key, event.target.value === '' ? '' : Number(event.target.value))} />
                    : <Stack direction="row" spacing={1} alignItems="center">
                      <Slider size="small" value={draft[key]} {...options.ranges[key]} disabled={fixed} aria-label={label}
                        onChange={(_, value) => updateParameter(key, value)} />
                      <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right' }}>{draft[key]}</Typography>
                    </Stack>}
                  </Box>
                </Box>;
              })}
            </Stack>
            {metadata?.model && !modelOptions.some(option => option.value === resolveMetadataModel(metadata.model)) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {t('painting.tools.metadata.sourceModel', { name: metadata.model })}
            </Typography>}
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
