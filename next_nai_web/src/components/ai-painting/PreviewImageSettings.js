"use client";

import { useState } from 'react';
import { Box, Button, Dialog, DialogTitle, IconButton, FormControlLabel, MenuItem, Popover, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Close, EditOutlined, InfoOutlined, TuneRounded, WidgetsOutlined } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { getPrivacyShortcut, imageExportModes } from './tools/ImageTools/previewImageExport';
import CustomImageMetadataEditor from './CustomImageMetadataEditor';
import { hasImageWatermark } from './ImageProcessing/quickImageAdjustments';

/**
 * 配置预览隐私、快捷键和默认导出方式。
 * @param {object} props 当前设置与更改回调。
 * @returns {React.ReactElement} 预览设置按钮与面板。
 */
export default function PreviewImageSettings({ settings, onChange, getCurrentImage, presets = [] }) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState(null);
  const [editing, setEditing] = useState(false);
  const label = (key) => t(`painting.workspace.gallery.${key}`);
  const shortcut = settings.privacyShortcut.replace(/\b(Key|Digit)(?=[A-Z0-9](?:$|\+))/g, '');
  const watermarkPresets = presets.filter((preset) => hasImageWatermark(preset.settings));
  const watermarkPreset = watermarkPresets.find((preset) => preset.id === settings.autoWatermarkPresetId);

  return <>
    <Tooltip title={label('previewSettings')} arrow>
      <IconButton size="small" aria-label={label('previewSettings')} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ color: 'text.secondary', flexShrink: 0, width: { xs: 36, md: 32 }, height: { xs: 36, md: 32 } }}>
        <WidgetsOutlined fontSize="small" />
      </IconButton>
    </Tooltip>
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 350, maxWidth: 'calc(100vw - 32px)', p: 2 }, role: 'dialog', 'aria-label': label('previewSettings') } }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{label('previewSettings')}</Typography>
        <Stack direction="row" alignItems="center">
          <FormControlLabel label={label('privacyMode')}
            control={<Switch checked={settings.privacyMode} onChange={(event) => onChange({ privacyMode: event.target.checked })} />} />
          <Tooltip title={label('privacyModeHelp')} arrow>
            <IconButton size="small" aria-label={label('privacyModeHelp')}><InfoOutlined fontSize="small" /></IconButton>
          </Tooltip>
        </Stack>
        <TextField size="small" label={label('privacyShortcut')} value={shortcut}
          helperText={label('privacyShortcutHint')}
          slotProps={{ htmlInput: { readOnly: true } }}
          onKeyDown={(event) => {
            const nextShortcut = getPrivacyShortcut(event);
            const clear = ['Backspace', 'Delete'].includes(event.code) && !nextShortcut;
            if (!nextShortcut && !clear) return;
            event.preventDefault();
            onChange({ privacyShortcut: clear ? '' : nextShortcut, privacyShortcutCustomized: true });
          }} />
        {[['copyMode', 'copy'], ['downloadMode', 'download']].map(([setting, action]) => (
          <TextField select size="small" key={setting} label={label(setting)} value={settings[setting]}
            onChange={(event) => onChange({ [setting]: event.target.value })}>
            {imageExportModes.map((mode) => <MenuItem key={mode} value={mode}>{label(`exportActions.${action}.${mode}`)}</MenuItem>)}
          </TextField>
        ))}
        <TextField select size="small" label={label('scrambledMetadata')} value={settings.scrambledMetadata}
          onChange={(event) => onChange({ scrambledMetadata: event.target.value })}>
          {['preserve', 'clean', 'custom'].map((mode) => <MenuItem key={mode} value={mode}>{label(`metadataModes.${mode}`)}</MenuItem>)}
        </TextField>
        <Button size="small" startIcon={<EditOutlined />} onClick={() => {
          setAnchor(null);
          setEditing(true);
        }} sx={{ justifyContent: 'flex-start' }}>{label('customMetadataEdit')}</Button>
        <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 0.75 }}>
          <FormControlLabel label={t('painting.workspace.adjustment.autoWatermark')}
            control={<Switch checked={settings.autoWatermarkEnabled} disabled={!watermarkPresets.length}
              onChange={(event) => onChange({
                autoWatermarkEnabled: event.target.checked,
                autoWatermarkPresetId: watermarkPreset?.id ?? watermarkPresets[0]?.id ?? '',
              })} />} />
          <TextField select fullWidth size="small" label={t('painting.workspace.adjustment.watermarkPreset')}
            value={watermarkPreset?.id ?? ''} disabled={!watermarkPresets.length}
            helperText={t(watermarkPresets.length ? 'painting.workspace.adjustment.autoWatermarkHelp' : 'painting.workspace.adjustment.noWatermarkPreset')}
            onChange={(event) => onChange({ autoWatermarkPresetId: event.target.value })}>
            {!watermarkPreset && <MenuItem value="" disabled>{t('painting.workspace.adjustment.choosePreset')}</MenuItem>}
            {watermarkPresets.map((preset) => <MenuItem key={preset.id} value={preset.id}>{preset.name}</MenuItem>)}
          </TextField>
        </Box>
      </Stack>
    </Popover>
    <Dialog open={editing} onClose={() => setEditing(false)} fullWidth maxWidth="md" aria-labelledby="custom-metadata-title"
      slotProps={{ paper: { sx: {
        m: { xs: 1.5, sm: 3 },
        width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 48px)' },
        maxWidth: 800, maxHeight: 'min(780px, calc(100dvh - 32px))',
        minHeight: 'min(400px, calc(100dvh - 32px))',
        border: 1, borderColor: 'divider', borderRadius: { xs: 2.5, sm: 3.5 }, overflow: 'hidden',
      } } }}>
      <DialogTitle id="custom-metadata-header" sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, sm: 3 }, py: 1.75,
        borderBottom: 1, borderColor: 'divider', fontWeight: 650, fontSize: '1.08rem',
      }}>
        <Box component="span" aria-hidden="true" sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 1.5, bgcolor: 'action.selected', color: 'primary.main' }}>
          <TuneRounded fontSize="small" />
        </Box>
        <Box component="span" id="custom-metadata-title" sx={{ flex: 1 }}>{label('customMetadata')}</Box>
        <IconButton aria-label={t('common.close')} size="small" onClick={() => setEditing(false)}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      {editing && <CustomImageMetadataEditor initialValue={settings.customMetadata} getCurrentImage={getCurrentImage}
        onCancel={() => setEditing(false)} onSave={(customMetadata) => {
          onChange({ customMetadata });
          setEditing(false);
        }} />}
    </Dialog>
  </>;
}
