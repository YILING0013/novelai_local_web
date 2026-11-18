import { useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
  LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Radio, Stack, Typography,
} from '@mui/material';
import { DarkModeOutlined, DownloadForOfflineOutlined, Language, LightModeOutlined, MoreVert, SystemUpdateAltOutlined } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { useAppTheme } from '@/providers/AppThemeProvider';
import api from '@/utils/ApiClient';
import inferenceMessages from '@/components/local-inference/inferenceMessages';
import { useAndroidUpdates } from './AndroidUpdates';

/** 左侧保留导航，账户、设置、主题、语言与下载任务集中在更多菜单。 */
export default function MobileTitleBar({ leading, actions = [], title = 'NovelAI Local' }) {
  const [anchor, setAnchor] = useState(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [task, setTask] = useState(null);
  const [taskError, setTaskError] = useState('');
  const { locale, setLocale, ready, t } = useI18n();
  const { mode, toggleTheme } = useAppTheme();
  const updates = useAndroidUpdates();
  const zh = locale === 'zh-CN';
  const tasksLabel = zh ? '任务与下载' : 'Tasks & downloads';

  useEffect(() => {
    if (!tasksOpen) return;
    let disposed = false;
    async function refresh() {
      try {
        const state = await api.request('/local/inference');
        if (!disposed) { setTask(state.job); setTaskError(''); }
      } catch (error) {
        if (!disposed) setTaskError(error.data?.message || error.message);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [tasksOpen]);

  return <>
    <Stack data-mobile-titlebar direction="row" alignItems="center" spacing={1} sx={{ px: 1, minHeight: 44, flexShrink: 0, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.drawer', color: 'text.primary' }}>
      {leading}
      <Box component="img" src="/logo.svg" alt="" sx={{ width: 24, height: 24 }} />
      <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>{title}</Typography>
      <IconButton aria-label={zh ? '更多选项' : 'More options'} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor(event.currentTarget)}>
        <Badge color="primary" variant="dot" invisible={!updates.available}><MoreVert /></Badge>
      </IconButton>
    </Stack>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      {actions.map(({ label, icon, onClick, disabled, selected }) => <MenuItem key={label} disabled={disabled} selected={selected} onClick={() => { setAnchor(null); void onClick(); }}>
        <ListItemIcon>{icon}</ListItemIcon><ListItemText>{label}</ListItemText>
      </MenuItem>)}
      {actions.length > 0 && <Divider />}
      <MenuItem onClick={() => { setAnchor(null); toggleTheme(); }}><ListItemIcon>{mode === 'light' ? <DarkModeOutlined /> : <LightModeOutlined />}</ListItemIcon><ListItemText>{t(mode === 'light' ? 'main.themeToDark' : 'main.themeToLight')}</ListItemText></MenuItem>
      <MenuItem onClick={() => { setAnchor(null); setLanguageOpen(true); }}><ListItemIcon><Language /></ListItemIcon><ListItemText>{zh ? '语言 / Language' : 'Language / 语言'}</ListItemText><Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>{zh ? '中文' : 'English'}</Typography></MenuItem>
      <MenuItem onClick={() => { setAnchor(null); setTasksOpen(true); }}><ListItemIcon><DownloadForOfflineOutlined /></ListItemIcon><ListItemText>{tasksLabel}</ListItemText></MenuItem>
      <MenuItem onClick={() => { setAnchor(null); updates.open(); }}><ListItemIcon><SystemUpdateAltOutlined /></ListItemIcon><ListItemText>{updates.label}</ListItemText></MenuItem>
    </Menu>
    <Dialog open={languageOpen} onClose={() => setLanguageOpen(false)} fullWidth maxWidth="xs" aria-labelledby="language-dialog-title">
      <DialogTitle id="language-dialog-title">{t('common.language')}</DialogTitle>
      <DialogContent sx={{ p: 0 }}><List disablePadding>
        {[['en-US', 'English'], ['zh-CN', '中文']].map(([value, label]) => <ListItemButton key={value} selected={locale === value} disabled={!ready} onClick={() => { setLocale(value); setLanguageOpen(false); }}>
          <ListItemText>{label}</ListItemText><Radio checked={locale === value} tabIndex={-1} disableRipple />
        </ListItemButton>)}
      </List></DialogContent>
      <DialogActions><Button onClick={() => setLanguageOpen(false)}>{t('common.cancel')}</Button></DialogActions>
    </Dialog>
    <Dialog open={tasksOpen} onClose={() => setTasksOpen(false)} fullWidth maxWidth="xs" aria-labelledby="mobile-tasks-title">
      <DialogTitle id="mobile-tasks-title">{tasksLabel}</DialogTitle>
      <DialogContent><Stack spacing={1.5}>
        {taskError && <Alert severity="error">{taskError}</Alert>}
        {task ? <>
          <Typography variant="subtitle2">{task.model_id}</Typography>
          <Typography variant="body2">{inferenceMessages[locale].stages[task.stage] || task.stage}</Typography>
          {task.status === 'running' && <LinearProgress variant={task.total ? 'determinate' : 'indeterminate'} value={task.total ? 100 * task.completed / task.total : undefined} />}
        </> : <Typography variant="body2" color="text.secondary">{zh ? '暂无本地推理或模型下载任务' : 'No local inference or model downloads'}</Typography>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setTasksOpen(false)}>{t('gallery.cancel')}</Button></DialogActions>
    </Dialog>
  </>;
}
