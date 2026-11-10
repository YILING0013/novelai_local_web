"use client";

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { LanOutlined } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

export default function DesktopWebAccess({ sx, inline = false }) {
  const { t } = useI18n();
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setDesktop(window.novelaiLocalDesktop === true); }, []);

  const update = useCallback(async (enabled) => {
    setBusy(true);
    setError('');
    try {
      const options = enabled === undefined ? {} : {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      };
      const response = await fetch('/api/desktop/web-access', { ...options, cache: 'no-store' });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setStatus(result);
      if (result.error) setError('restoreFailed');
      window.dispatchEvent(new CustomEvent('novelai:web-access', { detail: result.enabled }));
    } catch {
      setError(enabled === undefined ? 'readFailed' : 'changeFailed');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { if (inline && desktop) void update(); }, [inline, desktop, update]);

  if (!desktop) return null;
  const panel = (
    <Stack spacing={2}>
      <FormControlLabel label={t('desktop.enable')} control={
        <Switch checked={Boolean(status?.enabled)} disabled={!status || busy}
          onChange={event => update(event.target.checked)} />
      } />
      <Typography variant="body2" color="text.secondary">{t('desktop.hint')}</Typography>
      {error && <Alert severity="error" action={<Button disabled={busy} onClick={() => update()}>{t('common.retry')}</Button>}>{t(`desktop.${error}`, { port: status?.port })}</Alert>}
      {status?.enabled && status.urls.map((url, i) => <Box key={url}>
        <Typography variant="caption" color="text.secondary">{t(i ? 'desktop.lan' : 'desktop.loopback')}</Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', userSelect: 'all' }}>{url}</Typography>
      </Box>)}
    </Stack>
  );
  if (inline) return panel;
  return <>
    <Button startIcon={<LanOutlined />} size="small" sx={sx} onClick={() => {
      setOpen(true); setStatus(null); update();
    }}>{t('desktop.webAccess')}</Button>
    <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} fullWidth maxWidth="xs">
      <DialogTitle>{t('desktop.webAccess')}</DialogTitle>
      <DialogContent>
        {panel}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setOpen(false)}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  </>;
}
