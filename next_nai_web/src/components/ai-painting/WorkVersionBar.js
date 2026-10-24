'use client';

import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { AccountTree, Add, SaveOutlined } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import GalleryVersionsDialog from '../gallery/GalleryVersionsDialog';

/**
 * 在现有绘画工作台显示创作分支，并保存不需要生成图片的提示词版本。
 * @param {object} props 当前版本、参数读取函数和继续创作回调。
 * @returns {React.ReactNode} 紧凑版本栏和保存/历史对话框。
 */
export default function WorkVersionBar({ context, onChange, getParameters, onContinue, disabled }) {
  const { t } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = draft.context
        ? await apiClient.createWorkVersion(draft.context.work_id, {
          parent_id: draft.context.parent_version_id, parameters: draft.parameters,
          message, operation: 'prompt',
        })
        : await apiClient.createWork({ title, parameters: draft.parameters, message });
      onChange({
        work_id: result.work.id, parent_version_id: result.version.id,
        work_title: result.work.title, number: result.version.number,
      });
      setDraft(null);
    } catch (failure) {
      setError(failure.data?.error || failure.message);
    } finally { setBusy(false); }
  };

  return <>
    <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.5}
      sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
      <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {context ? t('gallery.versionWorkspace.current', { title: context.work_title, number: context.number }) : t('gallery.versionWorkspace.newHint')}
        </Typography>
      </Box>
      <Button size="small" startIcon={<SaveOutlined />} disabled={disabled} onClick={() => {
        setError(''); setMessage('');
        const parameters = getParameters();
        setTitle(parameters.positivePrompt?.slice(0, 60) || t('gallery.versionWorkspace.untitled'));
        setDraft({ parameters, context });
      }}>{t('gallery.versionWorkspace.save')}</Button>
      <Button size="small" startIcon={<AccountTree />} disabled={disabled} onClick={() => setHistoryOpen(true)}>
        {t('gallery.versionWorkspace.history')}
      </Button>
      {context && <Button size="small" startIcon={<Add />} disabled={disabled} onClick={() => onChange(null)}>
        {t('gallery.versionWorkspace.newWork')}
      </Button>}
    </Stack>
    <GalleryVersionsDialog open={historyOpen} onClose={() => setHistoryOpen(false)} initialWorkId={context?.work_id || null}
      onContinue={(version, work) => { onContinue(version, work); setHistoryOpen(false); }} />
    <Dialog open={Boolean(draft)} onClose={() => { if (!busy) setDraft(null); }} fullWidth maxWidth="sm">
      <DialogTitle>{t('gallery.versionWorkspace.save')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">{t('gallery.versionWorkspace.saveHint')}</Typography>
          {!draft?.context && <TextField autoFocus fullWidth label={t('gallery.versionWorkspace.title')} value={title}
            onChange={(event) => setTitle(event.target.value)} inputProps={{ maxLength: 160 }} />}
          <TextField fullWidth multiline minRows={2} label={t('gallery.versionWorkspace.message')} value={message}
            onChange={(event) => setMessage(event.target.value)} inputProps={{ maxLength: 2000 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setDraft(null)}>{t('gallery.versionWorkspace.cancel')}</Button>
        <Button variant="contained" disabled={busy || (!draft?.context && !title.trim())} onClick={save}>
          {t('gallery.versionWorkspace.save')}
        </Button>
      </DialogActions>
    </Dialog>
  </>;
}
