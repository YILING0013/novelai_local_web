import { useId, useState } from 'react';
import { Box, Divider, FormControl, IconButton, InputLabel, Menu, MenuItem, Select, Switch, Tooltip, Typography } from '@mui/material';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { useI18n } from '@/i18n/I18nProvider';
import usePromptEditorSettings from './usePromptEditorSettings';

/**
 * 将普通输入框和展开编辑器的预览、联想选项集中到右上角设置菜单。
 * @param {object} props 当前选项与更新回调，展开编辑器还可选择叠加预览。
 * @returns {React.ReactElement} 设置按钮及菜单。
 */
export default function PromptEditorSettings({ previewEnabled, onPreviewChange, suggestionsEnabled, onSuggestionsChange, overlayPreview, onOverlayChange }) {
  const { t } = useI18n();
  const menuId = useId();
  const [anchor, setAnchor] = useState(null);
  const { defaultWeightMode, translationEnabled, translationTarget, translationUnderline, setSetting } = usePromptEditorSettings();
  const options = [
    { key: 'previewEnabled', checked: previewEnabled, change: onPreviewChange },
    { key: 'suggestionsEnabled', checked: suggestionsEnabled, change: onSuggestionsChange },
    ...(onOverlayChange ? [{ key: 'overlayPreview', checked: overlayPreview, change: onOverlayChange, disabled: !previewEnabled }] : []),
  ];

  return (
    <>
      <Tooltip title={t('painting.tools.promptEditor.settings')} arrow>
        <IconButton
          size="small"
          aria-label={t('painting.tools.promptEditor.settings')}
          aria-haspopup="menu"
          aria-controls={anchor ? menuId : undefined}
          aria-expanded={Boolean(anchor)}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <SettingsOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 264, maxWidth: 'calc(100vw - 24px)' } } }}>
        {options.map(({ key, checked, change, disabled }) => (
          <MenuItem key={key} role="menuitemcheckbox" aria-checked={checked} disabled={disabled} onClick={() => change(!checked)} sx={{ gap: 1, minHeight: 44 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>{t(`painting.tools.promptEditor.${key}`)}</Typography>
            <Switch size="small" checked={checked} disabled={disabled} tabIndex={-1}
              slotProps={{ input: { 'aria-hidden': true, tabIndex: -1 } }} sx={{ pointerEvents: 'none' }} />
          </MenuItem>
        ))}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Tooltip title={t('painting.tools.promptEditor.weightModeHelp')} arrow placement="left">
            <FormControl size="small" fullWidth>
              <InputLabel id={`${menuId}-weight`}>{t('painting.tools.promptEditor.defaultWeightMode')}</InputLabel>
              <Select labelId={`${menuId}-weight`} value={defaultWeightMode}
                label={t('painting.tools.promptEditor.defaultWeightMode')}
                onChange={(event) => setSetting('defaultWeightMode', event.target.value)}>
                <MenuItem value="numeric">{t('painting.tools.promptEditor.weightModes.numeric')}</MenuItem>
                <MenuItem value="brackets">{t('painting.tools.promptEditor.weightModes.brackets')}</MenuItem>
              </Select>
            </FormControl>
          </Tooltip>
        </Box>
        <Divider />
        {[
          { key: 'translationEnabled', checked: translationEnabled },
          { key: 'translationUnderline', checked: translationUnderline, disabled: !translationEnabled },
        ].map(({ key, checked, disabled }) => (
          <MenuItem key={key} role="menuitemcheckbox" aria-checked={checked} disabled={disabled}
            onClick={() => setSetting(key, !checked)} sx={{ gap: 1, minHeight: 44 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>{t(`painting.tools.promptEditor.${key}`)}</Typography>
            <Switch size="small" checked={checked} disabled={disabled} tabIndex={-1}
              slotProps={{ input: { 'aria-hidden': true, tabIndex: -1 } }} sx={{ pointerEvents: 'none' }} />
          </MenuItem>
        ))}
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Tooltip title={t('painting.tools.promptEditor.translationTargetHelp')} arrow placement="left">
            <FormControl size="small" fullWidth disabled={!translationEnabled}>
              <InputLabel id={`${menuId}-language`}>{t('painting.tools.promptEditor.translationTarget')}</InputLabel>
              <Select labelId={`${menuId}-language`} value={translationTarget}
                label={t('painting.tools.promptEditor.translationTarget')}
                onChange={(event) => setSetting('translationTarget', event.target.value)}>
                {['auto', 'zh', 'en', 'ja', 'ko'].map((language) => (
                  <MenuItem key={language} value={language}>{t(`painting.tools.promptEditor.translationLanguages.${language}`)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Tooltip>
        </Box>
      </Menu>
    </>
  );
}
