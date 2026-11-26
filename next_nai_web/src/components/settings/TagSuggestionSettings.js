import { Box, Switch, TextField, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import { SettingsRow, SettingsSelect } from './SettingsRows';

const symbolKeys = ['category', 'exact', 'fuzzy', 'regex'];

/**
 * 给设置页和编辑器内的设置对话框显示同一组标签联想控件。
 * @param {object} props 当前选项、已保存值、无效符号和按字段更新草稿的回调。
 * @returns {React.ReactElement} 布局、搜索语法和候选数量设置。
 */
export default function TagSuggestionSettings({ settings, saved, invalidSymbols, onChange, guideEntry = false }) {
  const { t } = useI18n();
  const label = (key) => t(`settings.prompt.${key}`);
  const syntax = settings.suggestionSyntax;
  const updateSyntax = (key, value) => onChange('suggestionSyntax', { ...syntax, [key]: value });
  return <>
    <SettingsRow guideTarget={guideEntry ? 'enableSuggestions' : undefined}
      label={label('suggestionsEnabled')} description={label('help.suggestionsEnabled')} changed={settings.suggestionsEnabled !== saved.suggestionsEnabled}>
      <Switch checked={settings.suggestionsEnabled} slotProps={{ input: { 'aria-label': label('suggestionsEnabled') } }}
        onChange={(event) => onChange('suggestionsEnabled', event.target.checked)} />
    </SettingsRow>
    {Object.entries({ suggestionLimit: [5, 8, 12, 20, 40], suggestionLayout: ['flow', 'columns'], suggestionTextLayout: ['horizontal', 'vertical'] })
      .map(([key, values]) => <SettingsRow key={key} guideTarget={guideEntry && key === 'suggestionLayout' ? 'appearance' : undefined}
        label={label(key)} description={label(`help.${key}`)} changed={settings[key] !== saved[key]} wide>
        <SettingsSelect label={label(key)} value={settings[key]} disabled={!settings.suggestionsEnabled}
          options={values.map((value) => [value, typeof value === 'number' ? value : label(`${key}Options.${value}`)])}
          onChange={(value) => onChange(key, value)} />
      </SettingsRow>)}
    <SettingsRow label={label('suggestionSyntax')} description={label('help.suggestionSyntax')} changed={syntax.enabled !== saved.suggestionSyntax.enabled}>
      <Switch checked={syntax.enabled} disabled={!settings.suggestionsEnabled}
        slotProps={{ input: { 'aria-label': label('suggestionSyntax') } }}
        onChange={(event) => updateSyntax('enabled', event.target.checked)} />
    </SettingsRow>
    <SettingsRow guideTarget={guideEntry ? 'syntax' : undefined} label={label('syntaxSymbols')} description={t('settings.prompt.help.syntaxSymbols', syntax)}
      changed={symbolKeys.some((key) => syntax[key] !== saved.suggestionSyntax[key])} wide>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, pt: 0.5 }}>
        {symbolKeys.map((key) => <TextField key={key} size="small" fullWidth
          label={label(`symbols.${key}`)} value={syntax[key]} error={invalidSymbols.includes(key)}
          disabled={!invalidSymbols.length && (!syntax.enabled || !settings.suggestionsEnabled)}
          onChange={(event) => updateSyntax(key, event.target.value)}
          slotProps={{ htmlInput: { spellCheck: false, autoComplete: 'off' } }} />)}
      </Box>
      {!!invalidSymbols.length && <Typography variant="caption" color="error" role="alert">{label('invalidSymbols')}</Typography>}
    </SettingsRow>
  </>;
}
