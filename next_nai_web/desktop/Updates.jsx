import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Snackbar, Stack, Typography } from '@mui/material';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useI18n } from '@/i18n/I18nProvider';
import { installDesktopUpdate, useDesktopUpdater } from './updater';

export function UpdateSettings() {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const update = useDesktopUpdater();
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  useEffect(() => { void getVersion().then(setVersion).catch(() => {}); }, []);
  async function run(command) {
    setError('');
    try { await invoke(command, command === 'updater_check' ? { automatic: false } : undefined); }
    catch (cause) { setError(String(cause)); }
  }
  async function install() {
    setError(''); setPreparing(true);
    try { await installDesktopUpdate(zh); }
    catch (cause) { setError(cause.message || String(cause)); }
    finally { setPreparing(false); }
  }
  const failure = error || update.error;
  const failureText = failure === 'UPDATE_WORKSPACE_BUSY'
    ? (zh ? '请等待生成、保存或模型任务结束后再安装。' : 'Finish generation, saving and model tasks before installing.')
    : failure === 'UPDATE_DOWNLOAD_OR_SIGNATURE_FAILED'
      ? (zh ? '下载或签名校验失败，未安装更新。' : 'Download or signature verification failed. Nothing was installed.')
      : (zh ? '更新未完成，请重试或打开下载页面。' : 'Update did not complete. Retry or open the download page.');
  return <Stack spacing={1.5}>
    <Typography variant="h6">{zh ? '应用更新' : 'App updates'}</Typography>
    <Typography variant="body2">NovelAI Local {version}</Typography>
    {update.phase === 'up-to-date' && <Alert severity="success">{zh ? '已是最新版本' : 'You are up to date'}</Alert>}
    {update.version && <Box><Typography>{zh ? '可用版本：' : 'Available version: '}{update.version}</Typography>
      {update.notes && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{update.notes}</Typography>}</Box>}
    {failure && <Alert severity="error">{failureText}</Alert>}
    {update.phase === 'downloading' && <Box><LinearProgress variant={update.total ? 'determinate' : 'indeterminate'} value={update.total ? Math.min(100, update.downloaded / update.total * 100) : 0} /><Typography variant="caption">{(update.downloaded / 1048576).toFixed(1)} MB{update.total ? ` / ${(update.total / 1048576).toFixed(1)} MB` : ''}</Typography></Box>}
    {update.phase === 'ready' && <Alert severity="success">{zh ? '更新包已下载，签名校验通过。' : 'Update downloaded and signature verified.'}</Alert>}
    <Stack direction="row" gap={1} flexWrap="wrap">
      <Button disabled={preparing || ['checking', 'downloading', 'ready', 'installing'].includes(update.phase)} onClick={() => run('updater_check')}>{update.phase === 'checking' ? (zh ? '正在检查…' : 'Checking…') : (zh ? '检查更新' : 'Check for updates')}</Button>
      {update.version && ['available', 'error'].includes(update.phase) && <Button variant="contained" onClick={() => run('updater_download')}>{zh ? '下载更新' : 'Download update'}</Button>}
      {update.phase === 'downloading' && <Button onClick={() => run('updater_cancel')}>{zh ? '取消下载' : 'Cancel download'}</Button>}
      {update.phase === 'ready' && <Button variant="contained" disabled={preparing} onClick={install}>{zh ? '安装并重新打开' : 'Install and reopen'}</Button>}
      <Button onClick={() => { void openUrl('https://github.com/YILING0013/novelai_local_web/releases').catch(cause => setError(String(cause))); }}>{zh ? '下载页面' : 'Download page'}</Button>
    </Stack>
    <Dialog open={preparing || update.phase === 'installing'} disableEscapeKeyDown><DialogContent>{zh ? '正在准备安装…' : 'Preparing to install…'}</DialogContent></Dialog>
  </Stack>;
}

export default function UpdateNotice() {
  const { locale } = useI18n();
  const update = useDesktopUpdater();
  const shown = useRef('');
  const [notice, setNotice] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const check = () => { void invoke('updater_check', { automatic: true }).catch(() => {}); };
    const start = setTimeout(check, 8000);
    const interval = setInterval(check, 6 * 60 * 60 * 1000);
    return () => { clearTimeout(start); clearInterval(interval); };
  }, []);
  useEffect(() => {
    if (update.phase === 'available' && shown.current !== update.version) { shown.current = update.version; setNotice(true); }
  }, [update.phase, update.version]);
  const zh = locale === 'zh-CN';
  return <><Snackbar open={notice} autoHideDuration={15000} onClose={() => setNotice(false)}>
    <Alert severity="info" onClose={() => setNotice(false)} action={<Button onClick={() => { setNotice(false); setDetails(true); }}>{zh ? '查看更新' : 'View update'}</Button>}>
      {zh ? `发现新版本 ${update.version}` : `Version ${update.version} is available`}
    </Alert>
  </Snackbar><Dialog open={details} onClose={() => setDetails(false)} fullWidth maxWidth="sm">
    <DialogTitle>NovelAI Local</DialogTitle><DialogContent><UpdateSettings /></DialogContent>
    <DialogActions><Button onClick={() => setDetails(false)}>{zh ? '关闭' : 'Close'}</Button></DialogActions>
  </Dialog></>;
}
