import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, IconButton, Tooltip } from '@mui/material';
import LaptopOutlined from '@mui/icons-material/LaptopOutlined';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import AppProviders from '@/providers/AppProviders';
import { useI18n } from '@/i18n/I18nProvider';
import DesktopTitleBar from '@/desktop/DesktopTitleBar';
import { DesktopHistoryProvider, confirmWorkspaceLeave } from '@/desktop/navigation';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import api from '@/utils/ApiClient';
import SignIn from './SignIn';
import UpdateNotice from './Updates';
import { installTransport } from './transport';
import '@fontsource/geist/400.css';
import '@/app/globals.css';
import './window.css';
const Workspace = lazy(() => import('./Workspace'));
installTransport();
function Window() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const nativeWindow = getCurrentWindow();
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const auth = pathname === '/login';
  const switching = nativeWindow.label !== (auth ? 'auth' : 'main');
  useEffect(() => {
    let alive = true;
    (async () => {
      if (switching) return invoke('desktop_switch_window', { route: pathname });
      if (auth && !restored) {
        const session = await api.getSession();
        if (!alive) return;
        setRestored(true);
        if (session.authenticated) { navigate('/main', { replace: true }); return; }
      }
      if (alive) await invoke('desktop_window_ready');
    })().catch(e => { if (alive) { setError(e.message || String(e)); void invoke('desktop_window_ready'); } });
    return () => { alive = false; };
  }, [auth, switching, pathname, restored, navigate]);
  useEffect(() => {
    let leaving = false;
    let disposed = false;
    const closingWindow = getCurrentWindow();
    const stop = closingWindow.onCloseRequested(async event => {
      event.preventDefault(); if (leaving) return; leaving = true;
      try {
        if (!await confirmWorkspaceLeave(t('main.unsavedWarning'))) return;
        const pending = [];
        window.dispatchEvent(new CustomEvent('desktop-flush-before-update', { detail: { waitUntil: promise => pending.push(Promise.resolve(promise)) } }));
        await Promise.all(pending);
        await closingWindow.destroy();
      } catch (failure) {
        if (!disposed) setError(failure.message || String(failure));
      }
      finally { leaving = false; }
    });
    const windowFailure = event => setError(event.detail?.message || String(event.detail));
    const external = e => {
      const link = e.target.closest?.('a[href]');
      if (link && /^https?:/.test(link.href) && new URL(link.href).origin !== location.origin && !link.hasAttribute('download')) {
        e.preventDefault(); void openUrl(link.href).catch(err=>setError(String(err)));
      }
    };
    document.addEventListener('click',external);
    window.addEventListener('desktop-window-error', windowFailure);
    return () => { disposed = true; void stop.then(fn=>fn()); document.removeEventListener('click',external); window.removeEventListener('desktop-window-error', windowFailure); };
  }, [t]);
  return <Box height="100dvh" display="flex" flexDirection="column" overflow="hidden">
    <UpdateNotice />
    {error && <Alert severity="error" action={<Button onClick={()=>location.reload()}>{t('common.retry')}</Button>}>{error}</Alert>}
    {auth && <DesktopTitleBar allowMaximize={false}><Tooltip title={locale==='zh-CN'?'本机工具':'Local tools'}>
      <IconButton aria-label={locale==='zh-CN'?'本机工具':'Local tools'} onClick={()=>navigate('/local')}><LaptopOutlined/></IconButton>
    </Tooltip><LanguageSwitcher compact/></DesktopTitleBar>}
    {switching ? <CircularProgress/> : auth ? <SignIn onSuccess={()=>navigate('/main',{replace:true})}/>
      : <Workspace local={pathname==='/local'} onLogin={()=>navigate('/login')}/>}
  </Box>;
}
createRoot(document.getElementById('root')).render(<HashRouter><AppProviders><DesktopHistoryProvider>
  <Suspense fallback={<CircularProgress/>}><Window/></Suspense>
</DesktopHistoryProvider></AppProviders></HashRouter>);
