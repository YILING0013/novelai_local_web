import { useEffect, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Close, CropSquare, FilterNone, HorizontalRule, ArrowBack, ArrowForward } from '@mui/icons-material';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useI18n } from '@/i18n/I18nProvider';
import { useDesktopHistory } from './navigation';

/**
 * 登录窗与工作区共用的桌面标题栏。只有空白和标题区域可拖动，操作按钮保持正常点击。
 * @param {object} props 标题、左侧导航、工作区操作和是否允许最大化。
 * @returns {React.ReactElement} 高度为42px的标题栏，关闭仍走未保存确认流程。
 */
export default function DesktopTitleBar({ title = 'NovelAI Local', leading, children, allowMaximize = true }) {
  const { locale, t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const zh = locale === 'zh-CN';
  const history = useDesktopHistory();
  useEffect(() => {
    const window = getCurrentWindow();
    let disposed = false;
    const update = async () => { const value = await window.isMaximized(); if (!disposed) setMaximized(value); };
    void update();
    const unlisten = window.onResized(update);
    return () => { disposed = true; void unlisten.then((stop) => stop()); };
  }, []);
  const run = async (operation) => {
    try { await operation(); }
    catch (error) { window.dispatchEvent(new CustomEvent('desktop-window-error', { detail: error })); }
  };
  const controls = [
    { label: zh ? '最小化' : 'Minimize', icon: <HorizontalRule />, action: () => getCurrentWindow().minimize() },
    ...(allowMaximize ? [{ label: maximized ? (zh ? '还原窗口' : 'Restore') : (zh ? '最大化' : 'Maximize'), icon: maximized ? <FilterNone /> : <CropSquare />, action: () => getCurrentWindow().toggleMaximize() }] : []),
    { label: zh ? '关闭窗口' : 'Close window', icon: <Close />, action: () => getCurrentWindow().close(), close: true },
  ];
  return <Box component="header" aria-label={zh ? '窗口标题栏' : 'Window title bar'} sx={{
    height: 42, minHeight: 42, flexShrink: 0, display: 'flex', alignItems: 'center',
    bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', userSelect: 'none',
    position: 'relative', zIndex: (theme) => theme.zIndex.drawer + 1,
  }}>
    {leading && <Box sx={{ display: 'flex', alignItems: 'center', pl: 0.75 }}>{leading}</Box>}
    <Box sx={{ display: 'flex', alignItems: 'center', pl: leading ? 0.25 : 0.75 }}>
      <Tooltip title={zh ? '后退' : 'Back'}><span><IconButton size="small" aria-label={zh ? '后退' : 'Back'} disabled={!history.canBack} onClick={() => history.go(-1, t('main.unsavedWarning'))}><ArrowBack sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>
      <Tooltip title={zh ? '前进' : 'Forward'}><span><IconButton size="small" aria-label={zh ? '前进' : 'Forward'} disabled={!history.canForward} onClick={() => history.go(1, t('main.unsavedWarning'))}><ArrowForward sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>
    </Box>
    <Box data-tauri-drag-region sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, flex: 1, minWidth: 64, alignSelf: 'stretch' }}>
      <Box component="img" data-tauri-drag-region src="/logo.svg" alt="" draggable={false} sx={{ width: 22, height: 22, objectFit: 'contain', pointerEvents: 'none' }} />
      <Typography data-tauri-drag-region noWrap sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary', pointerEvents: 'none' }}>{title}</Typography>
    </Box>
    {children && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, px: 0.75, '& .MuiIconButton-root': { width: 32, height: 32, color: 'text.secondary', borderRadius: 1 }, '& .MuiSvgIcon-root': { fontSize: 19 } }}>{children}</Box>}
    <Box sx={{ display: 'flex', alignSelf: 'stretch', ml: 0.5 }}>
      {controls.map((control) => <Tooltip key={control.label} title={control.label} enterDelay={600}>
        <IconButton aria-label={control.label} onClick={() => void run(control.action)} disableRipple sx={{
          width: 46, height: 42, borderRadius: 0, color: 'text.secondary',
          '& .MuiSvgIcon-root': { fontSize: 15 },
          '&:hover': control.close ? { bgcolor: '#c42b1c', color: '#fff' } : { bgcolor: 'action.hover', color: 'text.primary' },
        }}>{control.icon}</IconButton>
      </Tooltip>)}
    </Box>
  </Box>;
}
