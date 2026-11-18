import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Snackbar, Stack, Typography } from '@mui/material';
import { confirmWorkspaceLeave } from '@/desktop/navigation';
import { useI18n } from '@/i18n/I18nProvider';
import api from '@/utils/ApiClient';

const updater = registerPlugin('NovelAIUpdate');
const Updates = createContext(null);
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** 在登录页和创作工作区之间保留同一个自动更新状态。 */
export function AndroidUpdateProvider({ children }) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [status, setStatus] = useState('idle');
  const [version, setVersion] = useState('');
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  const working = useRef(false);
  const lastCheck = useRef(0);
  const announced = useRef('');

  const check = useCallback(async (manual = false) => {
    if (working.current || (!manual && Date.now() - lastCheck.current < CHECK_INTERVAL)) return;
    working.current = true;
    lastCheck.current = Date.now();
    if (manual) { setStatus('checking'); setError(''); }
    try {
      const result = await updater.check();
      setNeedsPermission(false);
      setError('');
      setVersion(result.version || '');
      setStatus(result.debug ? 'debug' : result.ready ? 'ready' : result.version ? 'available' : 'current');
      if (result.version && announced.current !== result.version) {
        announced.current = result.version;
        setNotice(!manual);
      }
    } catch {
      if (manual) { setStatus('idle'); setError('check'); }
    } finally { working.current = false; }
  }, []);

  useEffect(() => {
    void check();
    const interval = window.setInterval(check, CHECK_INTERVAL);
    const resumed = App.addListener('resume', () => { void check(); });
    const progressListener = updater.addListener('progress', ({ percent }) => setProgress(percent));
    return () => {
      window.clearInterval(interval);
      void resumed.then((listener) => listener.remove());
      void progressListener.then((listener) => listener.remove());
    };
  }, [check]);

  async function download() {
    if (working.current) return;
    working.current = true;
    setError('');
    setProgress(0);
    setStatus('downloading');
    try {
      await updater.download();
      setStatus('ready');
    } catch {
      setStatus('available');
      setError('download');
    } finally { working.current = false; }
  }

  async function install() {
    if (working.current) return;
    working.current = true;
    setError('');
    setStatus('installing');
    try {
      if (!window.dispatchEvent(new Event('desktop-before-update', { cancelable: true }))) {
        setError('busy');
        return;
      }
      if (!await confirmWorkspaceLeave(zh ? '安装更新前请保存当前作品。继续安装？' : 'Save your work before installing the update. Continue?')) return;
      // 等待漫画草稿落盘，并在拉起安装器前重新检查生成与本机推理状态。
      const pending = [];
      window.dispatchEvent(new CustomEvent('desktop-flush-before-update', {
        detail: { waitUntil: (promise) => pending.push(Promise.resolve(promise)) },
      }));
      await Promise.all(pending);
      const inference = await api.request('/local/inference');
      if (inference.busy || !window.dispatchEvent(new Event('desktop-before-update', { cancelable: true }))) {
        setError('busy');
        return;
      }
      const result = await updater.install();
      setNeedsPermission(result.permissionRequired);
    } catch {
      setError('install');
      setStatus('available');
      return;
    } finally {
      working.current = false;
      setStatus((current) => current === 'installing' ? 'ready' : current);
    }
  }

  const title = zh ? '应用更新' : 'App update';
  const label = version ? (zh ? `发现新版 ${version}` : `Update ${version} available`) : title;
  const close = () => setOpen(false);
  const openUpdates = () => {
    setNotice(false);
    setOpen(true);
    if (!working.current && !version) void check(true);
  };
  const errorMessage = {
    check: zh ? '检查更新失败，请稍后重试。' : 'Could not check for updates. Try again later.',
    download: zh ? '下载或校验失败，请重新下载。' : 'Download or verification failed. Try downloading again.',
    install: zh ? '无法安装更新，请重试。' : 'Could not install the update. Try again.',
    busy: zh ? '请等待生成或本机推理任务完成后再安装。' : 'Wait for generation or local inference to finish before installing.',
  }[error];

  return <Updates.Provider value={{ label, available: Boolean(version), open: openUpdates }}>
    {children}
    <Snackbar open={notice && !open} autoHideDuration={8000} onClose={() => setNotice(false)}
      message={label} action={<Button color="inherit" onClick={openUpdates}>{zh ? '查看' : 'View'}</Button>} />
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs" aria-labelledby="android-updates-title">
      <DialogTitle id="android-updates-title">{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{errorMessage}</Alert>}
          {version && <Typography variant="body1">NovelAI Local {version}</Typography>}
          {status === 'checking' && <Typography>{zh ? '正在检查更新…' : 'Checking for updates…'}</Typography>}
          {status === 'current' && <Typography>{zh ? '当前已是最新版本。' : 'You are on the latest version.'}</Typography>}
          {status === 'debug' && <Typography>{zh ? '调试包请通过 GitHub 安装正式版。' : 'Get the signed release on GitHub.'}</Typography>}
          {status === 'available' && <Typography color="text.secondary">{zh ? '从 GitHub 下载正式 APK。' : 'Download the signed APK from GitHub.'}</Typography>}
          {status === 'downloading' && <>
            <LinearProgress variant="determinate" value={progress} />
            <Typography color="text.secondary">{zh ? '正在下载并校验' : 'Downloading and verifying'} · {progress}%</Typography>
          </>}
          {status === 'installing' && <Typography>{zh ? '正在准备安装…' : 'Preparing installation…'}</Typography>}
          {status === 'ready' && <Typography>{needsPermission
            ? (zh ? '请在系统设置允许此应用安装，然后返回继续。' : 'Allow installs from this app in Android Settings, then return to continue.')
            : (zh ? 'APK 已通过校验，可以安装。' : 'The APK has been verified and is ready to install.')}</Typography>}
          <Button component="a" href="https://github.com/YILING0013/novelai_local_web/releases" sx={{ alignSelf: 'flex-start' }}>
            {zh ? 'GitHub 发布记录' : 'GitHub releases'}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{zh ? '关闭' : 'Close'}</Button>
        {['idle', 'current'].includes(status) && <Button onClick={() => { void check(true); }}>{zh ? '检查更新' : 'Check for updates'}</Button>}
        {status === 'available' && <Button variant="contained" onClick={download}>{zh ? '下载更新' : 'Download update'}</Button>}
        {status === 'ready' && <Button variant="contained" onClick={install}>{zh ? '安装更新' : 'Install update'}</Button>}
      </DialogActions>
    </Dialog>
  </Updates.Provider>;
}

/** 为手机标题栏提供更新入口和发现新版后的提示。 */
export function useAndroidUpdates() {
  return useContext(Updates);
}
