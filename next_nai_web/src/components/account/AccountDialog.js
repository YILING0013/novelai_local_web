"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Avatar, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, Stack, Tab, Tabs, TextField, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { AccountCircle as AccountIcon, Close as CloseIcon, Paid as PaidIcon, Refresh as RefreshIcon, Star as StarIcon, VerifiedUser as VerifiedUserIcon, VpnKey as KeyIcon } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';

const SummaryMetric = ({ label, value, hint, color = 'text.primary' }) => (
  <Box sx={{ minWidth: 0, py: 1 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
    <Typography variant="h6" sx={{ color, mt: 0.25, overflowWrap: 'anywhere' }}>{value}</Typography>
    {hint && (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.35 }}>
        {hint}
      </Typography>
    )}
  </Box>
);

const DetailRow = ({ label, value, hint, statusColor }) => (
  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.35, sm: 2 }}
    alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ py: 1.35 }}>
    <Typography variant="body2" color="text.secondary" sx={{ width: { sm: 142 }, flex: '0 0 auto' }}>
      {label}
    </Typography>
    <Box sx={{ minWidth: 0, flex: 1 }}>
      {statusColor ? (
        <Chip size="small" label={value} color={statusColor} variant="outlined" />
      ) : (
        <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{value}</Typography>
      )}
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, overflowWrap: 'anywhere' }}>
          {hint}
        </Typography>
      )}
    </Box>
  </Stack>
);

const AccountDialog = ({ open, onClose, accountSnapshot, onAccountSnapshot, onLogout }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { t, formatDate, formatNumber } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credentialTab, setCredentialTab] = useState(0);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', backup: false });
  const [emailForm, setEmailForm] = useState({ current: '', next: '', backup: false });

  const refreshAccount = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getAccount();
      onAccountSnapshot(data.account_snapshot || null);
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.code || t('main.accountDialog.loadError'));
    } finally {
      setLoading(false);
    }
  }, [onAccountSnapshot, t]);

  useEffect(() => {
    if (open) void refreshAccount();
  }, [open, refreshAccount]);

  const updateSnapshot = (data) => {
    onAccountSnapshot(data.account_snapshot || accountSnapshot);
    setNotice(t('main.local.credentialsUpdated'));
  };

  const changePassword = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      updateSnapshot(await apiClient.changePassword(passwordForm.current, passwordForm.next));
      setPasswordForm({ current: '', next: '', backup: false });
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.code || t('main.local.credentialChangeFailed'));
    } finally {
      setLoading(false);
    }
  };

  const changeEmail = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      updateSnapshot(await apiClient.changeEmail(emailForm.current, emailForm.next));
      setEmailForm({ current: '', next: '', backup: false });
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.code || t('main.local.credentialChangeFailed'));
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    setError('');
    try {
      await onLogout();
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.code || t('main.local.logoutFailed'));
      setLoading(false);
    }
  };

  const unavailable = t('main.local.unavailable');
  const yesNo = (value) => (
    typeof value === 'boolean' ? t(value ? 'main.local.yes' : 'main.local.no') : unavailable
  );
  const numberValue = (value) => (
    typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : unavailable
  );
  const timestampValue = (value, emptyValue = unavailable) => {
    if (value === null || value === undefined || value === '') return emptyValue;
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numericValue)) {
      if (numericValue <= 0) return emptyValue;
      const date = new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue);
      return formatDate(date, { dateStyle: 'medium', timeStyle: 'short' }) || emptyValue;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? emptyValue
      : formatDate(date, { dateStyle: 'medium', timeStyle: 'short' }) || emptyValue;
  };
  const durationValue = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return unavailable;
    if (value === 0) return t('main.local.refreshSoon');
    const totalMinutes = Math.ceil(value / 60);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return t('main.local.durationDaysHours', { days, hours });
    if (hours > 0) return t('main.local.durationHoursMinutes', { hours, minutes });
    return t('main.local.durationMinutes', { minutes });
  };
  const loginMode = accountSnapshot?.auth?.login_mode === 'password'
    ? t('main.local.loginModePassword')
    : accountSnapshot?.auth?.login_mode === 'persistent_token'
      ? t('main.local.loginModePat')
      : unavailable;
  const tier = (() => {
    const value = accountSnapshot?.subscription?.tier;
    if (value === 0) return t('main.local.notSubscribed');
    if (value === 1) return 'Tablet';
    if (value === 2) return 'Scroll';
    if (value === 3) return 'Opus';
    return value === null || value === undefined ? unavailable : t('main.local.tierValue', { tier: value });
  })();
  const subscriptionActive = accountSnapshot?.subscription?.active;
  const subscriptionStatus = subscriptionActive === true
    ? t('main.local.subscriptionActiveStatus')
    : subscriptionActive === false
      ? t('main.local.notSubscribed')
      : unavailable;
  const expiresAt = timestampValue(
    accountSnapshot?.subscription?.expires_at,
    t('main.local.notSubscribed'),
  );
  const banStatus = (() => {
    const value = accountSnapshot?.information?.ban_status;
    if (value === false || value === 'not_banned') return t('main.local.accountNormal');
    if (value === true || value === 'banned') return t('main.local.accountBanned');
    return value === null || value === undefined || value === '' ? unavailable : String(value);
  })();
  const isBanned = accountSnapshot?.information?.ban_status === true
    || accountSnapshot?.information?.ban_status === 'banned';
  const v5Percent = typeof accountSnapshot?.v5?.percent === 'number'
    && Number.isFinite(accountSnapshot.v5.percent)
    ? `${formatNumber(accountSnapshot.v5.percent)}%`
    : unavailable;
  const trialDetails = accountSnapshot?.information?.trial_activated === true
    ? t('main.local.trialRemaining', {
      actions: numberValue(accountSnapshot?.information?.trial_actions_left),
      images: numberValue(accountSnapshot?.information?.trial_images_left),
    })
    : accountSnapshot?.information?.trial_activated === false
      ? t('main.local.trialNotActivated')
      : unavailable;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile} PaperProps={{
      sx: { borderRadius: { xs: 0, sm: 2 }, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' },
    }}>
      <DialogTitle sx={{
        fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`, pb: 2,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <AccountIcon sx={{ mr: 1, color: theme.palette.primary.main }} />
          {t('main.accountInfo')}
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose} size="small" sx={{
          color: 'text.secondary', bgcolor: alpha(theme.palette.divider, 0.1),
          '&:hover': { bgcolor: alpha(theme.palette.divider, 0.2) },
        }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
        {accountSnapshot?.stale === true && (
          <Alert severity="warning" sx={{ mb: 2 }}>{t('main.local.staleAccount')}</Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
        {loading && !accountSnapshot ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={40} /></Box>
        ) : (
          <>
            <Box sx={{
              p: { xs: 2, sm: 2.5 }, mb: 3, border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.18), borderRadius: 2.5,
              background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.11)}, ${alpha(theme.palette.background.paper, 0.35)})`,
            }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between" spacing={2}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                  <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 44, height: 44 }}><AccountIcon /></Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                      {accountSnapshot?.information?.email || t('main.local.officialAccount')}
                    </Typography>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <Chip size="small" icon={<KeyIcon />} label={loginMode} variant="outlined" />
                      <Chip size="small" icon={<StarIcon />} label={tier} color="primary" variant="outlined" />
                      {subscriptionActive === true && (
                        <Chip size="small" label={subscriptionStatus} color="success" />
                      )}
                    </Stack>
                  </Box>
                </Stack>
                {accountSnapshot?.stale === true && (
                  <Chip size="small" color="warning" label={t('main.local.snapshotStale')} />
                )}
              </Stack>
              <Box sx={{
                display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                columnGap: 2.5, rowGap: 0.5, mt: 2, pt: 1, borderTop: '1px solid', borderColor: 'divider',
              }}>
                <SummaryMetric label={t('main.local.anlasTotal')} value={numberValue(accountSnapshot?.anlas?.total)}
                  hint={t('main.local.anlasBreakdown', {
                    fixed: numberValue(accountSnapshot?.anlas?.fixed),
                    purchased: numberValue(accountSnapshot?.anlas?.purchased),
                  })} color="primary.main" />
                <SummaryMetric label={t('main.local.v5Percent')} value={v5Percent}
                  hint={accountSnapshot?.v5?.available === true
                    ? t('main.local.v5AvailableStatus')
                    : accountSnapshot?.v5?.available === false
                      ? t('main.local.v5UnavailableStatus')
                      : null}
                  color={accountSnapshot?.v5?.is_negative === true ? 'error.main' : 'text.primary'} />
                <SummaryMetric label={t('main.local.subscriptionExpires')} value={expiresAt}
                  hint={accountSnapshot?.subscription?.is_grace_period === true
                    ? t('main.local.inGracePeriod')
                    : accountSnapshot?.subscription?.is_grace_period === false
                      ? t('main.local.notInGracePeriod')
                      : unavailable} />
              </Box>
            </Box>

            <Box sx={{
              display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
              gap: { xs: 2.5, md: 0 },
            }}>
              <Box sx={{ minWidth: 0, pr: { md: 3 } }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <VerifiedUserIcon sx={{ fontSize: 20, color: theme.palette.primary.main }} />
                  {t('main.local.accountSection')}
                </Typography>
                <Stack divider={<Divider flexItem />} sx={{ mt: 0.5 }}>
                  <DetailRow label={t('main.local.email')} value={accountSnapshot?.information?.email || unavailable} />
                  <DetailRow label={t('main.local.emailVerified')}
                    value={yesNo(accountSnapshot?.information?.email_verified)}
                    statusColor={accountSnapshot?.information?.email_verified === true ? 'success' : 'default'} />
                  <DetailRow label={t('main.local.accountCreatedAt')}
                    value={timestampValue(accountSnapshot?.information?.account_created_at)} />
                  <DetailRow label={t('main.local.trialStatus')} value={trialDetails} />
                  <DetailRow label={t('main.local.banStatus')} value={banStatus}
                    hint={accountSnapshot?.information?.ban_message || ''}
                    statusColor={isBanned ? 'error' : accountSnapshot?.information?.ban_status === null
                      || accountSnapshot?.information?.ban_status === undefined ? 'default' : 'success'} />
                </Stack>
              </Box>

              <Box sx={{
                minWidth: 0, pl: { md: 3 }, pt: { xs: 2.5, md: 0 },
                borderLeft: { md: '1px solid' }, borderTop: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
              }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PaidIcon sx={{ fontSize: 20, color: theme.palette.primary.main }} />
                  {t('main.local.subscriptionAndQuota')}
                </Typography>
                <Stack divider={<Divider flexItem />} sx={{ mt: 0.5 }}>
                  <DetailRow label={t('main.local.subscription')} value={tier} />
                  <DetailRow label={t('main.local.subscriptionActive')} value={subscriptionStatus}
                    statusColor={subscriptionActive === true ? 'success' : 'default'} />
                  <DetailRow label={t('main.local.subscriptionGrace')}
                    value={yesNo(accountSnapshot?.subscription?.is_grace_period)} />
                  <DetailRow label={t('main.local.anlasFixed')} value={numberValue(accountSnapshot?.anlas?.fixed)} />
                  <DetailRow label={t('main.local.anlasPurchased')} value={numberValue(accountSnapshot?.anlas?.purchased)} />
                  <DetailRow label={t('main.local.v5Available')}
                    value={accountSnapshot?.v5?.available === true
                      ? t('main.local.v5AvailableStatus')
                      : accountSnapshot?.v5?.available === false
                        ? t('main.local.v5UnavailableStatus')
                        : unavailable}
                    statusColor={accountSnapshot?.v5?.available === true ? 'success'
                      : accountSnapshot?.v5?.available === false ? 'error' : 'default'} />
                  <DetailRow label={t('main.local.v5Reset')}
                    value={durationValue(accountSnapshot?.v5?.time_until_next_percent)} />
                  <DetailRow label={t('main.local.refreshedAt')} value={timestampValue(accountSnapshot?.refreshed_at)} />
                </Stack>
              </Box>
            </Box>

            {accountSnapshot?.auth?.can_manage_credentials === true && (
              <Box sx={{ mt: 3, pt: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <KeyIcon sx={{ fontSize: 20, color: theme.palette.primary.main }} />
                  {t('main.local.credentialSettings')}
                </Typography>
                <Tabs value={credentialTab} onChange={(_, value) => setCredentialTab(value)}
                  variant="fullWidth" sx={{ mt: 1, mb: 2 }}>
                  <Tab label={t('main.local.changePassword')} />
                  <Tab label={t('main.local.changeEmail')} />
                </Tabs>
                {credentialTab === 0 ? (
                  <Stack spacing={1.5}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.5 }}>
                      <TextField type="password" label={t('main.local.currentPassword')} value={passwordForm.current}
                        onChange={(event) => setPasswordForm((current) => ({ ...current, current: event.target.value }))} />
                      <TextField type="password" label={t('main.local.newPassword')} value={passwordForm.next}
                        onChange={(event) => setPasswordForm((current) => ({ ...current, next: event.target.value }))} />
                    </Box>
                    <FormControlLabel control={<Checkbox checked={passwordForm.backup}
                      onChange={(event) => setPasswordForm((current) => ({ ...current, backup: event.target.checked }))} />}
                      label={t('main.local.backupConfirmed')} />
                    <Button variant="contained" onClick={changePassword} sx={{ alignSelf: { sm: 'flex-end' } }}
                      disabled={loading || !passwordForm.current || !passwordForm.next || !passwordForm.backup}>
                      {t('main.local.changePassword')}
                    </Button>
                  </Stack>
                ) : (
                  <Stack spacing={1.5}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.5 }}>
                      <TextField type="password" label={t('main.local.currentPassword')} value={emailForm.current}
                        onChange={(event) => setEmailForm((current) => ({ ...current, current: event.target.value }))} />
                      <TextField type="email" label={t('main.local.newEmail')} value={emailForm.next}
                        onChange={(event) => setEmailForm((current) => ({ ...current, next: event.target.value }))} />
                    </Box>
                    <FormControlLabel control={<Checkbox checked={emailForm.backup}
                      onChange={(event) => setEmailForm((current) => ({ ...current, backup: event.target.checked }))} />}
                      label={t('main.local.backupConfirmed')} />
                    <Button variant="contained" onClick={changeEmail} sx={{ alignSelf: { sm: 'flex-end' } }}
                      disabled={loading || !emailForm.current || !emailForm.next.trim() || !emailForm.backup}>
                      {t('main.local.changeEmail')}
                    </Button>
                  </Stack>
                )}
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 2, gap: 0.5, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Button onClick={logout} color="error" disabled={loading}>{t('main.logout')}</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} variant="outlined">{t('common.close')}</Button>
        <Button variant="contained" onClick={refreshAccount} startIcon={<RefreshIcon />} disabled={loading}>
          {t('main.accountDialog.refreshData')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AccountDialog;
