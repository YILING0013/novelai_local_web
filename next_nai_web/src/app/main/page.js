"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Checkbox,
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
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
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

const displayValue = (value, t) => {
  if (value === null || value === undefined || value === '') return t('main.local.unavailable');
  if (typeof value === 'boolean') return t(value ? 'main.local.yes' : 'main.local.no');
  return String(value);
};

const AccountDialog = ({ open, onClose, accountSnapshot, onAccountSnapshot, onLogout }) => {
  const theme = useTheme();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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

  const snapshotRows = [
    [t('main.local.loginMode'), accountSnapshot?.auth?.login_mode],
    [t('main.local.credentialManagement'), accountSnapshot?.auth?.can_manage_credentials],
    [t('main.local.email'), accountSnapshot?.information?.email],
    [t('main.local.emailVerified'), accountSnapshot?.information?.email_verified],
    [t('main.local.accountCreatedAt'), accountSnapshot?.information?.account_created_at],
    [t('main.local.trialActivated'), accountSnapshot?.information?.trial_activated],
    [t('main.local.trialActionsLeft'), accountSnapshot?.information?.trial_actions_left],
    [t('main.local.trialImagesLeft'), accountSnapshot?.information?.trial_images_left],
    [t('main.local.banStatus'), accountSnapshot?.information?.ban_status],
    [t('main.local.banMessage'), accountSnapshot?.information?.ban_message],
    [t('main.local.subscription'), accountSnapshot?.subscription?.tier],
    [t('main.local.subscriptionActive'), accountSnapshot?.subscription?.active],
    [t('main.local.subscriptionExpires'), accountSnapshot?.subscription?.expires_at],
    [t('main.local.subscriptionGrace'), accountSnapshot?.subscription?.is_grace_period],
    [t('main.local.anlasTotal'), accountSnapshot?.anlas?.total],
    [t('main.local.anlasFixed'), accountSnapshot?.anlas?.fixed],
    [t('main.local.anlasPurchased'), accountSnapshot?.anlas?.purchased],
    [t('main.local.v5Percent'), accountSnapshot?.v5?.is_negative === true ? null : accountSnapshot?.v5?.percent],
    [t('main.local.v5Available'), accountSnapshot?.v5?.available],
    [t('main.local.v5Negative'), accountSnapshot?.v5?.is_negative],
    [t('main.local.v5Reset'), accountSnapshot?.v5?.time_until_next_percent],
    [t('main.local.refreshedAt'), accountSnapshot?.refreshed_at],
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{
      sx: { borderRadius: 2, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' },
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
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.25 }}>
              {snapshotRows.map(([label, value]) => (
                <Paper key={label} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography sx={{ mt: 0.4, overflowWrap: 'anywhere' }}>{displayValue(value, t)}</Typography>
                </Paper>
              ))}
            </Box>

            {accountSnapshot?.auth?.can_manage_credentials === true && (
              <Stack spacing={2.5} sx={{ mt: 3 }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="h6" sx={{ mb: 1.5 }}>{t('main.local.changePassword')}</Typography>
                  <Stack spacing={1.5}>
                    <TextField type="password" label={t('main.local.currentPassword')} value={passwordForm.current}
                      onChange={(event) => setPasswordForm((current) => ({ ...current, current: event.target.value }))} />
                    <TextField type="password" label={t('main.local.newPassword')} value={passwordForm.next}
                      onChange={(event) => setPasswordForm((current) => ({ ...current, next: event.target.value }))} />
                    <FormControlLabel control={<Checkbox checked={passwordForm.backup}
                      onChange={(event) => setPasswordForm((current) => ({ ...current, backup: event.target.checked }))} />}
                      label={t('main.local.backupConfirmed')} />
                    <Button variant="contained" onClick={changePassword}
                      disabled={loading || !passwordForm.current || !passwordForm.next || !passwordForm.backup}>
                      {t('main.local.changePassword')}
                    </Button>
                  </Stack>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="h6" sx={{ mb: 1.5 }}>{t('main.local.changeEmail')}</Typography>
                  <Stack spacing={1.5}>
                    <TextField type="password" label={t('main.local.currentPassword')} value={emailForm.current}
                      onChange={(event) => setEmailForm((current) => ({ ...current, current: event.target.value }))} />
                    <TextField type="email" label={t('main.local.newEmail')} value={emailForm.next}
                      onChange={(event) => setEmailForm((current) => ({ ...current, next: event.target.value }))} />
                    <FormControlLabel control={<Checkbox checked={emailForm.backup}
                      onChange={(event) => setEmailForm((current) => ({ ...current, backup: event.target.checked }))} />}
                      label={t('main.local.backupConfirmed')} />
                    <Button variant="contained" onClick={changeEmail}
                      disabled={loading || !emailForm.current || !emailForm.next.trim() || !emailForm.backup}>
                      {t('main.local.changeEmail')}
                    </Button>
                  </Stack>
                </Paper>
              </Stack>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
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
