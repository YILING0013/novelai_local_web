"use client";

import React, { useEffect, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { ArrowBack, AutoAwesome, Brush, Close, ExpandMore, ImageOutlined, InfoOutlined, PaletteOutlined, PersonOutline, Tune } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const settingFields = ['width', 'height', 'steps', 'guidanceScale', 'sampler', 'noiseSchedule', 'smea', 'dyn', 'promptGuidanceRescale'];
const actionIcons = { img2img: ImageOutlined, vibe: AutoAwesome, reference: PersonOutline, inpaint: Brush, editor: PaletteOutlined };
const defaultSelection = { positivePrompt: true, negativePrompt: true, characterTabs: true };

/**
 * 预览拖入的图片、选择用途、按需查看详细元数据，或只导入选中的信息。
 * @param {object} props 图片文件、可用用途、元数据和用户选择后的处理回调。
 * @returns {React.ReactElement} 图像用途与信息导入面板。
 */
export default function MetadataDialog({ open, onClose, metadata, onApply, imageFile = null, imageActions = [], onUseImage, reading = false }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState('');
  const [showMetadata, setShowMetadata] = useState(false);
  const [selected, setSelected] = useState(defaultSelection);

  useEffect(() => {
    if (!open) return undefined;
    setSelected(defaultSelection);
    setShowMetadata(false);
  }, [open, imageFile]);

  useEffect(() => {
    if (!open) return undefined;
    if (!imageFile) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(imageFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [open, imageFile]);

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
      for (const key of field.keys) {
        if (!selected[key] || metadata[key] === undefined) continue;
        filtered[key] = key === 'characterTabs'
          ? metadata[key].filter((_, index) => selected[`character_${index}`] !== false)
          : metadata[key];
        if (key === 'characterTabs' && !filtered[key].length) delete filtered[key];
      }
    }
    onApply(filtered);
  };

  const basicValues = [
    ['width', metadata?.width], ['height', metadata?.height],
    ['steps', metadata?.steps], ['guidanceScale', metadata?.guidanceScale], ['seed', metadata?.seed],
    ['sampler', metadata?.sampler], ['noiseSchedule', metadata?.noiseSchedule],
  ].filter(([, value]) => value !== undefined);
  const advancedValues = ['smea', 'dyn', 'promptGuidanceRescale'].filter(key => metadata?.[key] !== undefined);
  const hasSelection = fields.some(field => field.keys.some(key => selected[key]
    && (key !== 'characterTabs' || metadata.characterTabs.some((_, index) => selected[`character_${index}`] !== false))));
  const actionStyle = {
    justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', color: 'text.primary',
    borderColor: 'divider', borderRadius: 2, minHeight: { xs: 60, sm: 72 }, px: 1.5, lineHeight: 1.4,
    '& .MuiButton-startIcon': { color: 'primary.main', mr: 1.25 },
    '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
  };

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" scroll="paper" aria-labelledby="image-import-title"
    PaperProps={{ sx: { maxWidth: 820, m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' }, borderRadius: 3, backgroundImage: 'none' } }}>
    <DialogTitle id="image-import-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: { xs: 2, sm: 2.5 }, pr: 6 }}>
      {showMetadata
        ? <IconButton size="small" aria-label={t('painting.tools.metadata.backToImageActions')} onClick={() => setShowMetadata(false)}><ArrowBack fontSize="small" /></IconButton>
        : <ImageOutlined color="primary" />}
      <Typography component="span" sx={{ fontSize: { xs: 17, sm: 20 }, fontWeight: 600 }}>
        {t(showMetadata ? 'painting.tools.metadata.viewMetadata' : 'painting.tools.metadata.chooseImageAction')}
      </Typography>
      <IconButton onClick={onClose} aria-label={t('painting.tools.metadata.close')} sx={{ position: 'absolute', right: 12, top: 12 }}><Close fontSize="small" /></IconButton>
    </DialogTitle>
    <DialogContent dividers sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={2.5}>
        {!showMetadata && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: preview ? 'minmax(0, 0.9fr) minmax(0, 1.1fr)' : '1fr' }, gap: 2.5 }}>
          {preview && <Box sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.default' }}>
            <Box component="img" src={preview} alt={t('painting.tools.metadata.imagePreview')}
              sx={{ display: 'block', width: '100%', height: { xs: 150, sm: 242 }, objectFit: 'contain', p: 1 }} />
            <Box sx={{ px: 1.5, py: 1.25, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="body2" title={imageFile.name} noWrap sx={{ fontWeight: 500 }}>{imageFile.name}</Typography>
              <Typography variant="caption" color="text.secondary">{(imageFile.size / 1024 / 1024).toFixed(2)} MB</Typography>
            </Box>
          </Box>}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, alignContent: 'start' }}>
            {imageFile && imageActions.map(action => {
              const Icon = actionIcons[action];
              return <Button key={action} variant="outlined" startIcon={<Icon />} sx={actionStyle} onClick={() => onUseImage(action)}>
                {t(`painting.tools.metadata.useImage.${action}`)}
              </Button>;
            })}
            <Button variant="outlined" startIcon={<InfoOutlined />} sx={actionStyle} disabled={reading} onClick={() => setShowMetadata(true)}>
              {t('painting.tools.metadata.viewMetadata')}
            </Button>
          </Box>
        </Box>}
        {reading && <Typography role="status" variant="body2" color="text.secondary">{t('painting.tools.metadata.readingInformation')}</Typography>}
        {showMetadata && <Stack spacing={2} sx={{ minWidth: 0, userSelect: 'text' }}>
          {!metadata && <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{t('painting.tools.metadata.noMetadata')}</Typography>}
          {basicValues.length > 0 && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.basicParameters')}</Typography>
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              <Table size="small"><TableBody>
                {basicValues.map(([key, value]) => <TableRow key={key} sx={{ '&:last-child td, &:last-child th': { borderBottom: 0 } }}>
                  <TableCell padding="checkbox"><Checkbox size="small" checked={Boolean(selected[key])}
                    inputProps={{ 'aria-label': t(`painting.tools.metadata.${key}`) }}
                    onChange={(_, checked) => setSelected(current => ({ ...current, [key]: checked }))} /></TableCell>
                  <TableCell component="th" scope="row" sx={{ color: 'text.secondary', width: '42%' }}>{t(`painting.tools.metadata.${key}`)}</TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{String(value)}</TableCell>
                </TableRow>)}
              </TableBody></Table>
            </Box>
          </Box>}
          {advancedValues.length > 0 && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.advancedParameters')}</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {advancedValues.map(key => <FormControlLabel key={key} sx={{ m: 0 }}
                control={<Checkbox size="small" checked={Boolean(selected[key])} onChange={(_, checked) => setSelected(current => ({ ...current, [key]: checked }))} />}
                label={<Chip variant="outlined" size="small" label={`${t(`painting.tools.metadata.${key}`)}: ${typeof metadata[key] === 'boolean' ? t(metadata[key] ? 'painting.tools.common.on' : 'painting.tools.common.off') : metadata[key]}`} />} />)}
            </Stack>
          </Box>}
          {['positivePrompt', 'negativePrompt'].filter(key => metadata?.[key] !== undefined).map(key => <Box key={key}>
            <FormControlLabel sx={{ m: 0, mb: 0.5 }} label={t(`painting.tools.notebook.${key}`)}
              control={<Checkbox size="small" checked={Boolean(selected[key])} onChange={(_, checked) => setSelected(current => ({ ...current, [key]: checked }))} />} />
            <Typography variant="body2" sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 200, overflowY: 'auto' }}>
              {metadata[key] || t('painting.tools.metadata.none')}
            </Typography>
          </Box>)}
          {metadata?.characterTabs?.length > 0 && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('painting.tools.metadata.characterInfo')}</Typography>
            {metadata.characterTabs.map((character, index) => <Accordion key={index} disableGutters elevation={0}
              sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important', mb: 1, '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Checkbox size="small" checked={Boolean(selected.characterTabs) && selected[`character_${index}`] !== false}
                    inputProps={{ 'aria-label': `${t('painting.tools.metadata.importCharacters')} ${index + 1}` }}
                    onClick={event => event.stopPropagation()}
                    onChange={(_, checked) => setSelected(current => ({ ...current, characterTabs: true, [`character_${index}`]: checked }))} />
                  <Typography variant="body2" noWrap>{character.name || `${t('painting.tools.metadata.importCharacters')} ${index + 1}`}</Typography>
                  {character.position && <Chip size="small" label={/^[A-E][1-5]$/.test(character.position) ? t(`painting.tools.metadata.positions.${character.position}`) : character.position} />}
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <Typography variant="caption" color="text.secondary">{t('painting.tools.metadata.characterDescription')}</Typography>
                  <Typography variant="body2">{character.prompt || t('painting.tools.metadata.noDescription')}</Typography>
                  <Typography variant="caption" color="text.secondary">{t('painting.tools.metadata.characterNegative')}</Typography>
                  <Typography variant="body2">{character.uc || t('painting.tools.metadata.noNegativeContent')}</Typography>
                  {character.center && <Typography variant="caption" color="text.secondary">X: {character.center.x} · Y: {character.center.y}</Typography>}
                </Stack>
              </AccordionDetails>
            </Accordion>)}
          </Box>}
        </Stack>}
        {fields.length > 0 && <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Tune fontSize="small" color="primary" /><Typography variant="subtitle2">{t('painting.tools.metadata.informationToImport')}</Typography>
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 0.5 }}>
            {fields.map(field => {
              const keys = field.keys.filter(key => metadata[key] !== undefined);
              const checked = keys.every(key => Boolean(selected[key])) && (field.id !== 'characters' || metadata.characterTabs.every((_, index) => selected[`character_${index}`] !== false));
              const someChecked = keys.some(key => Boolean(selected[key]));
              return <FormControlLabel key={field.id} label={<Typography variant="body2">{t(`painting.tools.metadata.${field.label}`)}</Typography>}
                sx={{ m: 0, borderRadius: 1, bgcolor: someChecked ? 'action.selected' : 'transparent' }}
                control={<Checkbox size="small" checked={checked} indeterminate={!checked && someChecked} onChange={(_, nextChecked) => setSelected(current => ({
                  ...current, ...Object.fromEntries(keys.map(key => [key, nextChecked])),
                  ...(field.id === 'characters' ? Object.fromEntries(metadata.characterTabs.map((_, index) => [`character_${index}`, nextChecked])) : {}),
                }))} />} />;
            })}
          </Box>
        </Box>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, py: 1.75, gap: 1 }}>
      <Button color="inherit" onClick={onClose}>{t('common.cancel')}</Button>
      {fields.length > 0 && <Button variant="contained" disabled={reading || !hasSelection} onClick={apply}>
        {t('painting.tools.metadata.importInformation')}
      </Button>}
    </DialogActions>
  </Dialog>;
}
