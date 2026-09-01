"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  AccountCircle as AccountIcon,
  Brightness4 as DarkModeIcon,
  Brightness7 as LightModeIcon,
  Brush as BrushIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  Menu as MenuIcon,
  Paid as PaidIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Star as StarIcon,
  VerifiedUser as VerifiedUserIcon,
  VpnKey as KeyIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import AIPaintingPage from '@/components/ai-painting/AIPaintingPage';
import SettingsPage from '@/components/settings/SettingsPage';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { useAppTheme } from '@/providers/AppThemeProvider';
import {
  PAGE_IDS,
  getPageColorStorageKey,
  migrateLegacyPageColors,
  readPageColor,
} from '@/i18n/pageConfig.mjs';

const safeLocalStorage = {
  getItem: (key, defaultValue = null) => {
    if (typeof window === 'undefined') return defaultValue;
    return window.localStorage.getItem(key) || defaultValue;
  },
};

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

const CloseConfirmDialog = ({ open, onClose, onConfirm, pageName }) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
        <WarningIcon color="warning" sx={{ mr: 1 }} />
        {t('main.closePageTitle')}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{t('main.closePageMessage', { page: pageName })}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={onConfirm} color="error" variant="contained">{t('main.confirmClose')}</Button>
      </DialogActions>
    </Dialog>
  );
};

const drawerWidth = 240;
const closedDrawerWidth = 80;

export default function MainPage() {
  const router = useRouter();
  const { t } = useI18n();
  const theme = useTheme();
  const { mode, toggleTheme, primaryColors, backgroundColors, animationEnabled, animationSpeed } = useAppTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [authChecking, setAuthChecking] = useState(true);
  const [authCheckError, setAuthCheckError] = useState('');
  const [accountSnapshot, setAccountSnapshot] = useState(null);
  const [openDrawer, setOpenDrawer] = useState(false);
  const [openPages, setOpenPages] = useState([]);
  const [activePage, setActivePage] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pageToClose, setPageToClose] = useState(null);

  const applyAccountSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    setAccountSnapshot(snapshot);
    window.dispatchEvent(new CustomEvent('novelai:account-updated', { detail: snapshot }));
  }, []);

  const logout = useCallback(async () => {
    await apiClient.logout();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    let active = true;
    const verifySession = async () => {
      try {
        const recovery = await apiClient.getAccountRecovery();
        if (!active) return;
        if (recovery.active) {
          router.replace('/login');
          return;
        }
        const session = await apiClient.getSession();
        if (!active) return;
        if (!session.authenticated) {
          router.replace('/login');
          return;
        }
        const snapshot = session.account_snapshot || (await apiClient.getAccount()).account_snapshot;
        if (!active) return;
        applyAccountSnapshot(snapshot);
        setAuthChecking(false);
      } catch (requestError) {
        if (!active) return;
        if (requestError?.status === 401 || requestError?.status === 403) router.replace('/login');
        else {
          setAuthCheckError(requestError?.data?.message || requestError?.code || 'ACCOUNT_UNAVAILABLE');
          setAuthChecking(false);
        }
      }
    };
    void verifySession();
    return () => { active = false; };
  }, [applyAccountSnapshot, router]);

  useEffect(() => {
    const handleAccountUpdate = (event) => {
      if (event.detail) setAccountSnapshot(event.detail);
    };
    window.addEventListener('novelai:account-updated', handleAccountUpdate);
    return () => window.removeEventListener('novelai:account-updated', handleAccountUpdate);
  }, []);

  const [pages, setPages] = useState(() => {
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    if (storage) migrateLegacyPageColors(storage);
    return [
      { id: PAGE_IDS.AI_PAINTING, labelKey: 'pages.aiPainting', icon: <BrushIcon />, component: <AIPaintingPage />, color: readPageColor(storage, PAGE_IDS.AI_PAINTING), confirmOnClose: true },
      { id: PAGE_IDS.SETTINGS, labelKey: 'pages.settings', icon: <SettingsIcon />, color: readPageColor(storage, PAGE_IDS.SETTINGS), confirmOnClose: false },
    ];
  });

  const visiblePages = useMemo(() => pages.map((page) => (
    page.id === PAGE_IDS.SETTINGS && !page.component
      ? { ...page, component: <SettingsPage pages={pages} /> }
      : page
  )), [pages]);

  useEffect(() => {
    const handleThemeUpdate = (event) => {
      const { pageColors } = event.detail || {};
      if (!pageColors) return;
      setPages((current) => current.map((page) => ({ ...page, color: pageColors[page.id] || page.color })));
      setOpenPages((current) => current.map((page) => ({ ...page, color: pageColors[page.id] || page.color })));
    };
    window.addEventListener('themeUpdate', handleThemeUpdate);
    return () => window.removeEventListener('themeUpdate', handleThemeUpdate);
  }, []);

  const getPageLabel = useCallback((page) => page?.labelKey ? t(page.labelKey) : (page?.title || ''), [t]);
  const handleOpenPage = useCallback((page) => {
    setOpenPages((current) => current.some((item) => item.id === page.id) ? current : [...current, page]);
    setActivePage(page.id);
    if (isMobile) setOpenDrawer(false);
  }, [isMobile]);

  useEffect(() => {
    if (!authChecking && openPages.length === 0 && visiblePages.length > 0) handleOpenPage(visiblePages[0]);
  }, [authChecking, handleOpenPage, openPages.length, visiblePages]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!openPages.some((page) => page.confirmOnClose)) return;
      event.preventDefault();
      event.returnValue = t('main.unsavedWarning');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [openPages, t]);

  const confirmClosePage = (pageId) => {
    const remaining = openPages.filter((page) => page.id !== pageId);
    setOpenPages(remaining);
    if (activePage === pageId) setActivePage(remaining.at(-1)?.id || null);
    setCloseConfirmOpen(false);
    setPageToClose(null);
  };
  const handleClosePage = (pageId, event) => {
    event?.stopPropagation();
    const page = openPages.find((item) => item.id === pageId);
    if (page?.confirmOnClose) {
      setPageToClose(pageId);
      setCloseConfirmOpen(true);
    } else confirmClosePage(pageId);
  };
  const getActivePageColor = () => (
    openPages.find((page) => page.id === activePage)?.color || theme.palette.primary.main
  );
  const getAppTitleGradient = () => (
    `linear-gradient(45deg, ${mode === 'light' ? primaryColors.light : primaryColors.dark} 30%, #448AFF 90%)`
  );

  if (authCheckError) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Paper sx={{ width: '100%', maxWidth: 520, p: 3, textAlign: 'center' }}>
          <Alert severity="error">{authCheckError}</Alert>
          <Button variant="contained" sx={{ mt: 2 }} onClick={() => window.location.reload()}>{t('common.refresh')}</Button>
        </Paper>
      </Box>
    );
  }
  if (authChecking) {
    return <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress size={40} /></Box>;
  }

  return (
    <>
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <AppBar position="fixed" sx={{
          zIndex: theme.zIndex.drawer + 1, boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
          background: backgroundColors[mode].drawer, color: 'text.primary',
          transition: `all ${animationEnabled ? 300 : 0}ms ease`, display: 'none',
        }}>
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <IconButton color="inherit" aria-label={t('main.openDrawer')} edge="start" onClick={() => setOpenDrawer(!openDrawer)}><MenuIcon /></IconButton>
              <Typography variant="h6" noWrap sx={{ fontWeight: 'bold', background: getAppTitleGradient(), WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                NovelAI Local
              </Typography>
            </Box>
          </Toolbar>
        </AppBar>

        <Drawer variant={isMobile ? 'temporary' : 'permanent'} open={isMobile ? openDrawer : true}
          onClose={() => isMobile && setOpenDrawer(false)} sx={{
            width: openDrawer ? drawerWidth : closedDrawerWidth, flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: openDrawer ? drawerWidth : closedDrawerWidth, boxSizing: 'border-box',
              transition: theme.transitions.create(['width', 'background-color'], {
                easing: theme.transitions.easing.sharp,
                duration: animationEnabled ? theme.transitions.duration.standard : 0,
              }),
              overflowX: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: 'none',
              backgroundColor: theme.palette.background.drawer, display: 'flex', flexDirection: 'column', height: '100%',
            },
          }}>
          {isMobile && <Toolbar />}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: openDrawer ? 'space-between' : 'center', p: 2, mb: 1 }}>
            {openDrawer && (
              <Typography variant="h6" noWrap sx={{ fontWeight: 'bold', background: getAppTitleGradient(), WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                NovelAI Local
              </Typography>
            )}
            <IconButton onClick={() => setOpenDrawer(!openDrawer)} aria-label={openDrawer ? t('main.closeDrawer') : t('main.openDrawer')}
              sx={{ color: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.1), borderRadius: '50%', p: 1,
                transition: `all ${animationEnabled ? 200 : 0}ms ease`, '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2), transform: animationEnabled ? 'rotate(180deg)' : 'none' } }}>
              {openDrawer ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </IconButton>
          </Box>
          <Divider sx={{ mx: 2, mb: 2, opacity: 0.6 }} />
          <List sx={{ px: 1.5, flexGrow: 1 }}>
            {visiblePages.map((page) => {
              const isActive = activePage === page.id;
              const isHovered = hoveredItem === page.id;
              return (
                <Tooltip key={page.id} title={openDrawer ? '' : getPageLabel(page)} placement="right" arrow>
                  <ListItem disablePadding sx={{ mb: 1, borderRadius: 2, overflow: 'hidden' }}>
                    <ListItemButton onClick={() => handleOpenPage(page)} onMouseEnter={() => setHoveredItem(page.id)} onMouseLeave={() => setHoveredItem(null)}
                      sx={{ borderRadius: 2, py: 1.25, position: 'relative',
                        backgroundColor: isActive ? alpha(page.color, mode === 'light' ? 0.12 : 0.2) : isHovered ? alpha(theme.palette.action.hover, 0.1) : 'transparent',
                        transition: `all ${animationEnabled ? animationSpeed : 0}ms ease`,
                        '&::before': isActive ? { content: '""', position: 'absolute', left: 0, top: '20%', height: '60%', width: 4, backgroundColor: page.color, borderRadius: '0 4px 4px 0' } : {},
                        '&:hover': { backgroundColor: isActive ? alpha(page.color, mode === 'light' ? 0.18 : 0.25) : alpha(theme.palette.action.hover, 0.15) } }}>
                      <ListItemIcon sx={{ minWidth: openDrawer ? 46 : 36, color: isActive ? page.color : 'text.secondary', opacity: isActive ? 1 : 0.7, mx: openDrawer ? 0 : 'auto' }}>
                        {page.icon}
                      </ListItemIcon>
                      <ListItemText primary={getPageLabel(page)} sx={{ opacity: openDrawer ? 1 : 0, width: openDrawer ? 'auto' : 0, m: 0,
                        '& .MuiTypography-root': { fontWeight: isActive ? 600 : 500, color: isActive ? page.color : 'text.primary', whiteSpace: 'nowrap', fontSize: '0.95rem' } }} />
                    </ListItemButton>
                  </ListItem>
                </Tooltip>
              );
            })}
          </List>

          <Box sx={{ pt: 2, pb: 2, px: 1.5, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Tooltip title={openDrawer ? '' : (mode === 'light' ? t('main.themeToDark') : t('main.themeToLight'))} placement="right" arrow>
              <ListItem disablePadding sx={{ mb: 1, borderRadius: 2, overflow: 'hidden' }}>
                <ListItemButton onClick={toggleTheme} sx={{ borderRadius: 2, py: 1.25, backgroundColor: alpha(theme.palette.primary.main, mode === 'light' ? 0.08 : 0.15) }}>
                  <ListItemIcon sx={{ minWidth: openDrawer ? 46 : 36, color: theme.palette.primary.main, mx: openDrawer ? 0 : 'auto' }}>
                    {mode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
                  </ListItemIcon>
                  <ListItemText primary={mode === 'light' ? t('main.darkMode') : t('main.lightMode')} sx={{ opacity: openDrawer ? 1 : 0, width: openDrawer ? 'auto' : 0, m: 0 }} />
                </ListItemButton>
              </ListItem>
            </Tooltip>
            <ListItem disablePadding sx={{ mb: 1, borderRadius: 2, overflow: 'visible' }}>
              <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <LanguageSwitcher compact={!openDrawer} fullWidth={openDrawer} sx={openDrawer ? { width: '100%', '& .MuiOutlinedInput-root': { bgcolor: alpha(theme.palette.primary.main, mode === 'light' ? 0.08 : 0.15) } } : {}} />
              </Box>
            </ListItem>
            <Tooltip title={openDrawer ? '' : t('main.accountInfo')} placement="right" arrow>
              <ListItem disablePadding sx={{ mb: 1, borderRadius: 2, overflow: 'hidden' }}>
                <ListItemButton onClick={() => setAccountDialogOpen(true)} sx={{ borderRadius: 2, py: 1.25, backgroundColor: alpha(theme.palette.primary.main, mode === 'light' ? 0.08 : 0.15) }}>
                  <ListItemIcon sx={{ minWidth: openDrawer ? 46 : 36, color: theme.palette.primary.main, mx: openDrawer ? 0 : 'auto' }}><AccountIcon /></ListItemIcon>
                  <ListItemText primary={t('main.account')} sx={{ opacity: openDrawer ? 1 : 0, width: openDrawer ? 'auto' : 0, m: 0 }} />
                </ListItemButton>
              </ListItem>
            </Tooltip>
            {openDrawer && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, opacity: 0.7 }}>NovelAI Local</Typography>}
          </Box>
        </Drawer>

        <Box component="main" sx={{ flexGrow: 1, p: 0, display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: theme.palette.background.default, marginLeft: 0, overflow: 'auto' }}>
          {openPages.length > 0 && (
            <>
              <Paper elevation={0} sx={{ borderRadius: 0, boxShadow: isMobile ? 'none' : '0 2px 10px rgba(0,0,0,0.03)', position: 'relative', zIndex: 1,
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`, bgcolor: alpha(theme.palette.background.paper, 0.9), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center' }}>
                {isMobile && <IconButton color="inherit" aria-label={t('main.openDrawer')} edge="start" onClick={() => setOpenDrawer(!openDrawer)} sx={{ mr: 1, ml: 1 }}><MenuIcon /></IconButton>}
                <Tabs value={activePage} onChange={(event, value) => setActivePage(value)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 48, flex: 1,
                  '& .MuiTabs-indicator': { backgroundColor: getActivePageColor(), height: 3, borderRadius: '3px 3px 0 0' }, '& .MuiTabs-scrollButtons': { color: 'text.secondary', width: 28 } }}>
                  {openPages.map((page) => (
                    <Tab key={page.id} value={page.id} label={<Box sx={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', '& svg': { fontSize: '1rem', mr: 0.5, opacity: 0.8 } }}>
                      {React.cloneElement(page.icon, { style: { fontSize: 'inherit', color: activePage === page.id ? page.color : 'inherit' } })}{getPageLabel(page)}
                    </Box>}
                      sx={{ minHeight: 48, textTransform: 'none', fontWeight: activePage === page.id ? 600 : 400, color: activePage === page.id ? page.color : 'text.secondary', opacity: activePage === page.id ? 1 : 0.7, py: 0.5, px: 2, '&.Mui-selected': { color: page.color } }}
                      icon={<div onClick={(event) => handleClosePage(page.id, event)} style={{ marginLeft: 4 }}><CloseIcon fontSize="small" sx={{ fontSize: '1rem', opacity: 0.5, '&:hover': { opacity: 1, color: 'error.main' } }} /></div>}
                      iconPosition="end" />
                  ))}
                </Tabs>
              </Paper>
              <Box sx={{ flexGrow: 1, overflow: 'auto', p: { xs: 1, sm: 1.5 } }}>
                {openPages.map((page) => (
                  <Box key={page.id} sx={{ height: '100%', display: page.id === activePage ? 'block' : 'none' }}>
                    {page.id === PAGE_IDS.SETTINGS
                      ? React.cloneElement(page.component, { pages: visiblePages })
                      : React.cloneElement(page.component, {
                        userId: accountSnapshot?.information?.email || '',
                        accountSnapshot,
                      })}
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      </Box>

      <AccountDialog open={accountDialogOpen} onClose={() => setAccountDialogOpen(false)}
        accountSnapshot={accountSnapshot} onAccountSnapshot={applyAccountSnapshot} onLogout={logout} />
      <CloseConfirmDialog open={closeConfirmOpen} onClose={() => { setCloseConfirmOpen(false); setPageToClose(null); }}
        onConfirm={() => confirmClosePage(pageToClose)} pageName={getPageLabel(openPages.find((page) => page.id === pageToClose))} />
    </>
  );
}
