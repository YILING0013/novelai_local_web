"use client";

import { MenuItem, TextField } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

/** 设置页与灵感卡片共用的图库来源选择。 */
export default function GallerySourceSelect({ value, onChange, disabled = false }) {
  const { t } = useI18n();
  return <TextField select fullWidth size="small" label={t('librarySettings.inspirationSource')}
    value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    {['default', 'references', 'outputs'].map((source) =>
      <MenuItem key={source} value={source}>{t(`librarySettings.${source}`)}</MenuItem>)}
  </TextField>;
}
