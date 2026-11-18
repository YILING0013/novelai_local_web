import { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent } from '@mui/material';
import { CollectionsOutlined } from '@mui/icons-material';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import AppProviders from '@/providers/AppProviders';
import { useAppTheme } from '@/providers/AppThemeProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { DesktopHistoryProvider, useDesktopHistory } from '@/desktop/navigation';
import api from '@/utils/ApiClient';
import SignIn from '../desktop/SignIn';
import { installTransport } from './transport';
import { saveAs } from './save-file';
import MobileTitleBar from './MobileTitleBar';
import { AndroidUpdateProvider } from './AndroidUpdates';
import '@fontsource/geist/400.css';
import '@/app/globals.css';
import '../desktop/window.css';
import './window.css';

const Workspace = lazy(() => import('../desktop/Workspace'));
installTransport();
window.novelaiSaveFile = saveAs;

function Routes() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const history = useDesktopHistory();
  const { t, locale } = useI18n();
  const { mode } = useAppTheme();
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [checking, setChecking] = useState(pathname !== '/local');
  const auth = pathname !== '/main' && pathname !== '/local';
  useEffect(() => { void App.getInfo().then(({ version }) => setAppVersion(version)); }, []);

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
      const dialog = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].reverse()
        .find((node) => !node.closest('[aria-hidden="true"]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      if (!window.dispatchEvent(new CustomEvent('mobile-back', { cancelable: true, detail: dialog }))) return;
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

  useEffect(() => {
    const revealInput = () => requestAnimationFrame(() => {
      const input = document.activeElement;
      if (input?.matches('input, textarea')) input.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    window.addEventListener('resize', revealInput);
    return () => window.removeEventListener('resize', revealInput);
  }, []);

  return <Box className="android-app" sx={{ bgcolor: 'background.default' }}>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {auth && <MobileTitleBar actions={[{
      label: locale === 'zh-CN' ? '本机工具' : 'Local tools', icon: <CollectionsOutlined />,
      onClick: () => { setChecking(false); navigate('/local'); },
    }]} />}
    <Suspense fallback={<CircularProgress sx={{ m: 'auto' }} />}>
      {checking ? <CircularProgress sx={{ m: 'auto' }} /> : auth ? <SignIn android onSuccess={() => navigate('/main', { replace: true })} />
        : <Workspace android appVersion={appVersion} TitleBar={MobileTitleBar} local={pathname === '/local'} onLogin={() => navigate('/login', { replace: true })} />}
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
  <HashRouter><AppProviders><DesktopHistoryProvider><AndroidUpdateProvider><Routes /></AndroidUpdateProvider></DesktopHistoryProvider></AppProviders></HashRouter>,
);
