import { useId, useState } from 'react';
import { Box, IconButton, Menu, MenuItem, Switch, Tooltip, Typography } from '@mui/material';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 将普通输入框和展开编辑器的预览、联想选项集中到右上角设置菜单。
 * @param {object} props 当前选项与更新回调，展开编辑器还可选择叠加预览。
 * @returns {React.ReactElement} 设置按钮及菜单。
 */
export default function PromptEditorSettings({ previewEnabled, onPreviewChange, suggestionsEnabled, onSuggestionsChange, overlayPreview, onOverlayChange }) {
  const { t } = useI18n();
  const menuId = useId();
  const [anchor, setAnchor] = useState(null);
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
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">{t('painting.tools.promptEditor.suggestionsHelp')}</Typography>
        </Box>
      </Menu>
    </>
  );
}
