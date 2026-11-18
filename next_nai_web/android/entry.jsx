import { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, Toolbar, Typography } from '@mui/material';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import AppProviders from '@/providers/AppProviders';
import { useAppTheme } from '@/providers/AppThemeProvider';
import { useI18n } from '@/i18n/I18nProvider';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { DesktopHistoryProvider, useDesktopHistory } from '@/desktop/navigation';
import api from '@/utils/ApiClient';
import SignIn from '../desktop/SignIn';
import { installTransport } from './transport';
import { saveAs } from './save-file';
import '@fontsource/geist/400.css';
import '@/app/globals.css';
import '../desktop/window.css';
import './window.css';

const Workspace = lazy(() => import('../desktop/Workspace'));
installTransport();
window.novelaiSaveFile = saveAs;

/** 安卓状态栏以下的工具条，与工作区共用语言、设置和账号操作。 */
export function AndroidTitleBar({ leading, children }) {
  return <Toolbar variant="dense" disableGutters sx={{ bgcolor: 'background.paper', flexShrink: 0, px: 1, gap: .5, minHeight: 48 }}>
    {leading}
    <Box component="img" src="/logo.svg" width={24} height={24} alt="" />
    <Typography noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 650 }}>NovelAI Local</Typography>
    {children}
  </Toolbar>;
}

function Routes() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const history = useDesktopHistory();
  const { t, locale } = useI18n();
  const { mode } = useAppTheme();
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [checking, setChecking] = useState(pathname !== '/local');
  const auth = pathname !== '/main' && pathname !== '/local';

  useEffect(() => {
    if (!checking) return;
    let active = true;
    api.getSession().then((session) => {
      if (!active) return;
      setChecking(false);
      navigate(session.authenticated ? '/main' : '/login', { replace: true });
    }).catch((failure) => {
      if (active) { setError(failure.message); setChecking(false); }
    });
    return () => { active = false; };
  }, [checking, navigate]);

  useEffect(() => {
    void SystemBars.setStyle({ style: mode === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  }, [mode]);

  useEffect(() => {
    const listener = App.addListener('backButton', () => {
      const dialog = [...document.querySelectorAll('[role="dialog"], [role="menu"]')].reverse()
        .find((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      if (dialog) {
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      } else if (history.canBack) {
        void history.go(-1, t('main.unsavedWarning'));
      } else {
        // 返回桌面保留当前创作和原生请求，交给系统管理进程。
        void App.minimizeApp();
      }
    });
    const external = (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute('download')) return;
      const url = new URL(link.href);
      if (link.target === '_blank' && (
        (url.origin === location.origin && url.pathname.startsWith('/api/local/')) ||
        url.protocol === 'blob:' || link.href.startsWith('data:image/')
      )) {
        event.preventDefault();
        setPreviewUrl(link.href);
        return;
      }
      if (url.origin === location.origin || url.protocol !== 'https:') return;
      event.preventDefault();
      void Browser.open({ url: link.href }).catch((failure) => setError(String(failure)));
    };
    const windowFailure = (event) => setError(event.detail?.message || String(event.detail));
    document.addEventListener('click', external);
    window.addEventListener('desktop-window-error', windowFailure);
    return () => {
      void listener.then((subscription) => subscription.remove());
      document.removeEventListener('click', external);
      window.removeEventListener('desktop-window-error', windowFailure);
    };
  }, [history, t]);

  return <Box className="android-app" sx={{ bgcolor: 'background.default' }}>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {auth && <AndroidTitleBar>
      <Button size="small" onClick={() => { setChecking(false); navigate('/local'); }}>
        {locale === 'zh-CN' ? '本机工具' : 'Local tools'}
      </Button>
      <LanguageSwitcher compact />
    </AndroidTitleBar>}
    <Suspense fallback={<CircularProgress sx={{ m: 'auto' }} />}>
      {checking ? <CircularProgress sx={{ m: 'auto' }} /> : auth ? <SignIn onSuccess={() => navigate('/main', { replace: true })} />
        : <Workspace android TitleBar={AndroidTitleBar} local={pathname === '/local'} onLogin={() => navigate('/login', { replace: true })} />}
    </Suspense>
    {previewUrl && <Dialog open onClose={() => setPreviewUrl('')} maxWidth="md">
      <DialogContent sx={{ p: 1, display: 'grid', placeItems: 'center' }}>
        <Box component="img" src={previewUrl} alt="" sx={{ maxHeight: '76dvh', maxWidth: '100%', objectFit: 'contain' }} />
      </DialogContent>
      <DialogActions><Button onClick={() => setPreviewUrl('')}>{t('gallery.cancel')}</Button></DialogActions>
    </Dialog>}
  </Box>;
}

createRoot(document.getElementById('root')).render(
  <HashRouter><AppProviders><DesktopHistoryProvider><Routes /></DesktopHistoryProvider></AppProviders></HashRouter>,
);
