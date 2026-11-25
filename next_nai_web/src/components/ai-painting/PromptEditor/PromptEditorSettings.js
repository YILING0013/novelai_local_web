import { useContext, useId, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, IconButton, InputLabel, Menu, MenuItem, Select, Switch, Tooltip, Typography } from '@mui/material';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useI18n } from '@/i18n/I18nProvider';
import usePromptEditorSettings from './usePromptEditorSettings';
import EditorExerciseContext from '@/components/tutorials/EditorExerciseContext';
import TagSuggestionSettings from '@/components/settings/TagSuggestionSettings';
import { invalidPromptSyntaxSymbols } from './promptTagCompletion.mjs';

/**
 * 将普通输入框和展开编辑器的预览、联想选项集中到右上角设置菜单。
 * @param {object} props 当前选项与更新回调，展开编辑器还可选择叠加预览。
 * @returns {React.ReactElement} 设置按钮及菜单。
 */
export default function PromptEditorSettings({ previewEnabled, onPreviewChange, suggestionsEnabled, onSuggestionsChange, overlayPreview, onOverlayChange, guideEntry = false }) {
  const { t } = useI18n();
  const exercise = useContext(EditorExerciseContext);
  const menuId = useId();
  const [anchor, setAnchor] = useState(null);
  const settings = usePromptEditorSettings();
  const { defaultWeightMode, translationEnabled, translationTarget, translationUnderline, setSetting } = settings;
  const [suggestionDraft, setSuggestionDraft] = useState(null);
  const edited = { ...settings, ...suggestionDraft };
  const invalidSymbols = invalidPromptSyntaxSymbols(edited.suggestionSyntax);
  const options = [
    { key: 'previewEnabled', checked: previewEnabled, change: onPreviewChange },
    ...(onOverlayChange ? [{ key: 'overlayPreview', checked: overlayPreview, change: onOverlayChange, disabled: !previewEnabled }] : []),
    { key: 'suggestionsEnabled', checked: suggestionsEnabled, change: onSuggestionsChange },
  ];

  return (
    <>
      <Tooltip title={t('painting.tools.promptEditor.settings')} arrow>
        <IconButton
          size="small"
          data-release-target={guideEntry ? 'gear' : undefined} aria-label={t('painting.tools.promptEditor.settings')}
          data-tour="gear" aria-haspopup="menu"
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
          <MenuItem key={key} data-release-target={guideEntry && key === 'previewEnabled' ? 'previewToggle' : undefined}
            data-tour={key} role="menuitemcheckbox" aria-checked={checked} disabled={disabled} onClick={() => { change(!checked); if (exercise) setAnchor(null); }} sx={{ gap: 1, minHeight: 44 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>{t(`painting.tools.promptEditor.${key}`)}</Typography>
            <Switch size="small" checked={checked} disabled={disabled} tabIndex={-1}
              slotProps={{ input: { 'aria-hidden': true, tabIndex: -1 } }} sx={{ pointerEvents: 'none' }} />
          </MenuItem>
        ))}
        <Button data-release-target={guideEntry ? 'configure' : undefined} variant="outlined" role="menuitem" tabIndex={-1} aria-haspopup="dialog"
          startIcon={<TuneIcon />} endIcon={<ChevronRightIcon />}
          onClick={() => { setAnchor(null); setSuggestionDraft({}); }}
          sx={{ mx: 2, mt: 0.5, mb: 1.5, width: 'calc(100% - 32px)', minHeight: 40, textTransform: 'none',
            justifyContent: 'flex-start', '& .MuiButton-endIcon': { ml: 'auto' } }}>
          {t('settings.prompt.configureSuggestions')}
        </Button>
        <Divider />
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
          <MenuItem key={key} data-release-target={guideEntry && key === 'translationEnabled' ? 'translationSettings' : undefined}
            role="menuitemcheckbox" aria-checked={checked} disabled={disabled}
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
      <Dialog open={suggestionDraft !== null} onClose={() => setSuggestionDraft(null)} fullWidth maxWidth="sm" scroll="paper"
        slotProps={{ paper: { sx: {
          m: { xs: 1, sm: 3 }, width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' },
          maxHeight: { xs: 'calc(100dvh - 16px)', sm: 'calc(100dvh - 48px)' }, overflow: 'hidden',
        } } }}
        aria-labelledby={`${menuId}-suggestions`}>
        <DialogTitle id={`${menuId}-suggestions`} sx={{ flexShrink: 0, px: { xs: 2, sm: 3 }, py: 1.5 }}>{t('settings.prompt.suggestionSettings')}</DialogTitle>
        <DialogContent dividers sx={{
          position: 'relative', flex: '0 1 auto', minHeight: 0, minWidth: 0, px: { xs: 2, sm: 3 }, py: 1,
          overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
          '& .settings-row': { mx: 0, px: 0 },
        }}>
          <TagSuggestionSettings guideEntry={guideEntry} settings={edited} saved={settings} invalidSymbols={invalidSymbols}
            onChange={(key, value) => setSuggestionDraft((draft) => ({ ...draft, [key]: value }))} />
          {edited.suggestionsEnabled && edited.suggestionSyntax.enabled && <Typography variant="caption" color="text.secondary"
            sx={{ display: { xs: 'none', lg: 'block' } }}>{t('settings.prompt.help.syntaxSymbols', edited.suggestionSyntax)}</Typography>}
        </DialogContent>
        <DialogActions data-release-target={guideEntry ? 'closeSettings' : undefined} sx={{ flexShrink: 0, px: { xs: 2, sm: 3 }, py: 1.25 }}>
          <Button onClick={() => setSuggestionDraft(null)}>{t('painting.tools.common.cancel')}</Button>
          <Button variant="contained" disabled={!!invalidSymbols.length}
            onClick={() => { settings.updateSettings(suggestionDraft); setSuggestionDraft(null); }}>{t('settings.save')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
