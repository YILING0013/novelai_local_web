"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Tab,
  Tabs,
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
  PhotoLibraryOutlined as ReferenceGalleryIcon,
  FolderOutlined as LocalGalleryIcon,
  AutoAwesome as TaggingIcon,
  ZoomInMap as UpscalingIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  Menu as MenuIcon,
  Settings as SettingsIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import AIPaintingPage from '@/components/ai-painting/AIPaintingPage';
import SettingsPage from '@/components/settings/SettingsPage';
import GalleryWorkspace from '@/components/gallery/GalleryWorkspace';
import LocalInferencePage from '@/components/local-inference/LocalInferencePage';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { useAppTheme } from '@/providers/AppThemeProvider';
import {
  PAGE_IDS,
  migrateLegacyPageColors,
  readPageColor,
} from '@/i18n/pageConfig.mjs';

import AccountDialog from '@/components/account/AccountDialog';

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
const closedDrawerWidth = 64;

export default function MainPage() {
  const router = useRouter();
  const { t } = useI18n();
  const theme = useTheme();
  const { mode, toggleTheme, primaryColors, backgroundColors, animationEnabled, animationSpeed } = useAppTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [authChecking, setAuthChecking] = useState(true);
  const [authCheckError, setAuthCheckError] = useState('');
  const [accountSnapshot, setAccountSnapshot] = useState(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // 桌面导航分为隐藏、图标、完整三档；移动端仍使用原来的抽屉。
  const [desktopDrawerMode, setDesktopDrawerMode] = useState('hidden');
  const openDrawer = isMobile ? mobileDrawerOpen : desktopDrawerMode === 'expanded';
  const sidebarWidth = isMobile ? drawerWidth
    : desktopDrawerMode === 'hidden' ? 0
      : openDrawer ? 208 : closedDrawerWidth;
  const sidebarHandleWidth = desktopDrawerMode === 'compact' ? 34 : openDrawer ? 28 : 16;
  const sidebarHandleInset = desktopDrawerMode === 'hidden' ? 0 : sidebarHandleWidth - 14;
  const sidebarEdgeCurve = `M${sidebarHandleInset + 0.5} 0 C${sidebarHandleInset + 0.5} 24 ${sidebarHandleWidth - 0.5} 32 ${sidebarHandleWidth - 0.5} 56 C${sidebarHandleWidth - 0.5} 80 ${sidebarHandleInset + 0.5} 88 ${sidebarHandleInset + 0.5} 112`;
  const [openPages, setOpenPages] = useState([]);
  const [workContext, setWorkContext] = useState(null);
  const [activePage, setActivePage] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pageToClose, setPageToClose] = useState(null);
  const sidebarActionSx = {
    width: openDrawer ? '100%' : 48,
    height: isMobile ? 48 : openDrawer ? 36 : 44,
    minHeight: isMobile ? 48 : openDrawer ? 36 : 44,
    flex: 'none',
    borderRadius: 2,
    backgroundColor: alpha(theme.palette.primary.main, mode === 'light' ? 0.08 : 0.15),
    '& .MuiSvgIcon-root': { fontSize: !isMobile && !openDrawer ? 26 : undefined },
  };

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
      { id: PAGE_IDS.REFERENCE_GALLERY, labelKey: 'gallery.referencesTitle', icon: <ReferenceGalleryIcon />, component: <GalleryWorkspace source="references" />, color: readPageColor(storage, PAGE_IDS.REFERENCE_GALLERY), confirmOnClose: false },
      { id: PAGE_IDS.LOCAL_GALLERY, labelKey: 'gallery.outputsTitle', icon: <LocalGalleryIcon />, component: <GalleryWorkspace source="outputs" />, color: readPageColor(storage, PAGE_IDS.LOCAL_GALLERY), confirmOnClose: false },
      { id: PAGE_IDS.IMAGE_TAGGING, labelKey: 'pages.imageTagging', icon: <TaggingIcon />, component: <LocalInferencePage kind="tagger" />, color: readPageColor(storage, PAGE_IDS.IMAGE_TAGGING), confirmOnClose: false },
      { id: PAGE_IDS.LOCAL_UPSCALING, labelKey: 'pages.localUpscaling', icon: <UpscalingIcon />, component: <LocalInferencePage kind="upscale" />, color: readPageColor(storage, PAGE_IDS.LOCAL_UPSCALING), confirmOnClose: false },
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
    if (isMobile) setMobileDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    const openRequestedPage = (event) => {
      const requested = visiblePages.find((page) => page.id === event.detail);
      if (requested) handleOpenPage(requested);
    };
    window.addEventListener('novelai:open-page', openRequestedPage);
    return () => window.removeEventListener('novelai:open-page', openRequestedPage);
  }, [handleOpenPage, visiblePages]);

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
    if (pageId === PAGE_IDS.AI_PAINTING) setWorkContext(null);
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
              <IconButton color="inherit" aria-label={t('main.openDrawer')} edge="start" onClick={() => setMobileDrawerOpen(!openDrawer)}><MenuIcon /></IconButton>
              <Typography variant="h6" noWrap sx={{ fontWeight: 'bold', background: getAppTitleGradient(), WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                NovelAI Local
              </Typography>
            </Box>
          </Toolbar>
        </AppBar>

          {!isMobile && (
            <Box sx={{
              position: 'fixed', left: Math.max(0, sidebarWidth - sidebarHandleInset - 1), top: '66.6667%',
              transform: 'translateY(-50%)', zIndex: theme.zIndex.drawer + 1,
              width: sidebarHandleWidth, height: 112,
              display: 'flex', alignItems: 'center', pointerEvents: 'none',
              transition: theme.transitions.create('left', {
                duration: animationEnabled ? theme.transitions.duration.standard : 0,
                easing: theme.transitions.easing.sharp,
              }),
              '& .MuiIconButton-root': {
                width: openDrawer ? 24 : 16,
                height: 32, p: 0, borderRadius: 1, color: 'text.secondary', pointerEvents: 'auto',
                '& .MuiSvgIcon-root': { fontSize: 18 },
                '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
              },
            }}>
              {/* 曲线从抽屉边缘平滑伸出，背景与菜单相接。 */}
              <Box component="svg" viewBox={`0 0 ${sidebarHandleWidth} 112`} aria-hidden="true"
                sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                <path d={`${sidebarEdgeCurve} Z`} fill={theme.palette.background.drawer} />
                <path d={sidebarEdgeCurve} fill="none" stroke={theme.palette.divider} vectorEffect="non-scaling-stroke" />
              </Box>
              {desktopDrawerMode !== 'hidden' && (
                <Tooltip title={t(openDrawer ? 'main.showSidebarIcons' : 'main.hideSidebar')} placement="right" arrow disableInteractive>
                  <IconButton
                    aria-label={t(openDrawer ? 'main.showSidebarIcons' : 'main.hideSidebar')}
                    aria-controls="main-navigation"
                    aria-expanded={openDrawer}
                    onClick={() => setDesktopDrawerMode(openDrawer ? 'compact' : 'hidden')}
                  ><ChevronLeftIcon fontSize="small" /></IconButton>
                </Tooltip>
              )}
              {desktopDrawerMode === 'compact' && <Divider orientation="vertical" sx={{ height: 14, position: 'relative' }} />}
              {desktopDrawerMode !== 'expanded' && (
                <Tooltip title={t(desktopDrawerMode === 'hidden' ? 'main.showSidebarIcons' : 'main.expandSidebar')} placement="right" arrow disableInteractive>
                  <IconButton
                    aria-label={t(desktopDrawerMode === 'hidden' ? 'main.showSidebarIcons' : 'main.expandSidebar')}
                    aria-controls="main-navigation"
                    aria-expanded={false}
                    onClick={() => setDesktopDrawerMode(desktopDrawerMode === 'hidden' ? 'compact' : 'expanded')}
                  ><ChevronRightIcon fontSize="small" /></IconButton>
                </Tooltip>
              )}
            </Box>
          )}
        <Drawer variant={isMobile ? 'temporary' : 'permanent'} open={isMobile ? openDrawer : true}
          onClose={() => setMobileDrawerOpen(false)} slotProps={{ paper: { id: 'main-navigation', component: 'nav', 'aria-label': t('main.navigation') } }} sx={{
            width: sidebarWidth, flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: sidebarWidth, visibility: !isMobile && desktopDrawerMode === 'hidden' ? 'hidden' : undefined, boxSizing: 'border-box',
              transition: theme.transitions.create(['width', 'background-color'], {
                easing: theme.transitions.easing.sharp,
                duration: animationEnabled ? theme.transitions.duration.standard : 0,
              }),
              overflowX: 'hidden', scrollbarWidth: isMobile ? 'auto' : 'none', boxShadow: 'none', border: 'none', borderRadius: 0,
              backgroundImage: !isMobile ? `linear-gradient(to bottom, ${theme.palette.divider} calc(66.6667% - 56px), transparent calc(66.6667% - 56px), transparent calc(66.6667% + 56px), ${theme.palette.divider} calc(66.6667% + 56px))` : 'none',
              backgroundSize: '1px 100%', backgroundPosition: 'right top', backgroundRepeat: 'no-repeat',
              backgroundColor: theme.palette.background.drawer, display: 'flex', flexDirection: 'column', height: '100%',
            },
          }}>
          {isMobile && <Toolbar />}
          {isMobile && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, mb: 1 }}>
            {openDrawer && (
              <Typography variant="h6" noWrap sx={{ fontWeight: 'bold', background: getAppTitleGradient(), WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                NovelAI Local
              </Typography>
            )}
            <IconButton onClick={() => setMobileDrawerOpen(!openDrawer)} aria-label={openDrawer ? t('main.closeDrawer') : t('main.openDrawer')}
              sx={{ color: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.1), borderRadius: '50%', p: 1,
                transition: `all ${animationEnabled ? 200 : 0}ms ease`, '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2), transform: animationEnabled ? 'rotate(180deg)' : 'none' } }}>
              {openDrawer ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </IconButton>
          </Box>}
          {isMobile && <Divider sx={{ mx: 2, mb: 2, opacity: 0.6 }} />}
          <List sx={{ px: openDrawer ? 1.5 : 1, py: 1, flexGrow: 1, flexShrink: isMobile ? 1 : 0 }}>
            {visiblePages.map((page) => {
              const isActive = activePage === page.id;
              const isHovered = hoveredItem === page.id;
              return (
                <Tooltip key={page.id} title={openDrawer ? '' : getPageLabel(page)} placement="right" arrow>
                  <ListItem disablePadding sx={{ mb: isMobile ? 1 : 0.25, borderRadius: 2, overflow: 'hidden' }}>
                    <ListItemButton aria-label={getPageLabel(page)} aria-current={isActive ? 'page' : undefined} onClick={() => handleOpenPage(page)} onMouseEnter={() => setHoveredItem(page.id)} onMouseLeave={() => setHoveredItem(null)}
                      sx={{ borderRadius: 2, py: isMobile ? 1.25 : openDrawer ? 0.75 : 1.125, px: openDrawer && isMobile ? 2 : 1, position: 'relative',
                        backgroundColor: isActive ? alpha(page.color, mode === 'light' ? 0.12 : 0.2) : isHovered ? alpha(theme.palette.action.hover, 0.1) : 'transparent',
                        transition: `all ${animationEnabled ? animationSpeed : 0}ms ease`,
                        '&::before': isActive ? { content: '""', position: 'absolute', left: 0, top: '20%', height: '60%', width: 4, backgroundColor: page.color, borderRadius: '0 4px 4px 0' } : {},
                        '&:hover': { backgroundColor: isActive ? alpha(page.color, mode === 'light' ? 0.18 : 0.25) : alpha(theme.palette.action.hover, 0.15) } }}>
                      <ListItemIcon sx={{ minWidth: openDrawer ? (isMobile ? 46 : 34) : 0, color: isActive ? page.color : 'text.secondary', opacity: isActive ? 1 : 0.7, mx: openDrawer ? 0 : 'auto',
                        '& .MuiSvgIcon-root': { fontSize: !isMobile && !openDrawer ? 26 : undefined } }}>
                        {page.icon}
                      </ListItemIcon>
                      <ListItemText primary={getPageLabel(page)} sx={{ display: openDrawer ? 'block' : 'none', m: 0,
                        '& .MuiTypography-root': { fontWeight: isActive ? 600 : 500, color: isActive ? page.color : 'text.primary', whiteSpace: 'nowrap', fontSize: '0.95rem' } }} />
                    </ListItemButton>
                  </ListItem>
                </Tooltip>
              );
            })}
          </List>

          <Box sx={{ py: isMobile ? 2 : 1, px: openDrawer ? 1.5 : 1, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isMobile ? 1 : 0.25, flexShrink: isMobile ? 1 : 0 }}>
            <Tooltip title={openDrawer ? '' : (mode === 'light' ? t('main.themeToDark') : t('main.themeToLight'))} placement="right" arrow>
              <ListItem disablePadding sx={{ justifyContent: 'center' }}>
                <ListItemButton onClick={toggleTheme} aria-label={mode === 'light' ? t('main.themeToDark') : t('main.themeToLight')}
                  sx={{ ...sidebarActionSx, px: openDrawer ? (isMobile ? 2 : 1) : 0, justifyContent: openDrawer ? 'flex-start' : 'center' }}>
                  <ListItemIcon sx={{ minWidth: openDrawer ? (isMobile ? 46 : 34) : 0, color: theme.palette.primary.main }}>
                    {mode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
                  </ListItemIcon>
                  {openDrawer && <ListItemText primary={mode === 'light' ? t('main.darkMode') : t('main.lightMode')} sx={{ m: 0, whiteSpace: 'nowrap' }} />}
                </ListItemButton>
              </ListItem>
            </Tooltip>
            <ListItem disablePadding sx={{ justifyContent: 'center' }}>
              <LanguageSwitcher compact={!openDrawer} fullWidth={openDrawer} sx={{
                width: openDrawer ? '100%' : 48, minWidth: 0,
                '& .MuiIconButton-root': sidebarActionSx,
                '& .MuiOutlinedInput-root': sidebarActionSx,
              }} />
            </ListItem>
            <Tooltip title={openDrawer ? '' : t('main.accountInfo')} placement="right" arrow>
              <ListItem disablePadding sx={{ justifyContent: 'center' }}>
                <ListItemButton onClick={() => setAccountDialogOpen(true)} aria-label={t('main.accountInfo')}
                  sx={{ ...sidebarActionSx, px: openDrawer ? (isMobile ? 2 : 1) : 0, justifyContent: openDrawer ? 'flex-start' : 'center' }}>
                  <ListItemIcon sx={{ minWidth: openDrawer ? (isMobile ? 46 : 34) : 0, color: theme.palette.primary.main }}><AccountIcon /></ListItemIcon>
                  {openDrawer && <ListItemText primary={t('main.account')} sx={{ m: 0, whiteSpace: 'nowrap' }} />}
                </ListItemButton>
              </ListItem>
            </Tooltip>
            {openDrawer && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, opacity: 0.7 }}>NovelAI Local</Typography>}
          </Box>
        </Drawer>

        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: 0, display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: theme.palette.background.default, marginLeft: 0, overflow: 'auto' }}>
          {openPages.length > 0 && (
            <>
              {/* 移动端保留标签页；桌面导航统一使用侧栏，释放画布高度。 */}
              {isMobile && (
              <Paper elevation={0} sx={{ borderRadius: 0, boxShadow: isMobile ? 'none' : '0 2px 10px rgba(0,0,0,0.03)', position: 'relative', zIndex: 1,
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`, bgcolor: alpha(theme.palette.background.paper, 0.9), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center' }}>
                {isMobile && <IconButton color="inherit" aria-label={t('main.openDrawer')} edge="start" onClick={() => setMobileDrawerOpen(!openDrawer)} sx={{ mr: 1, ml: 1 }}><MenuIcon /></IconButton>}
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
              )}
              <Box sx={{ flexGrow: 1, overflow: 'auto', p: { xs: 1, sm: 1.5 } }}>
                {openPages.map((page) => (
                  <Box key={page.id} sx={{ height: '100%', display: page.id === activePage ? 'block' : 'none' }}>
                    {page.id === PAGE_IDS.SETTINGS
                      ? React.cloneElement(page.component, { pages: visiblePages, active: page.id === activePage })
                      : React.cloneElement(page.component, {
                        userId: accountSnapshot?.information?.email || '',
                        accountSnapshot,
                        workContext, onWorkContextChange: setWorkContext,
                        active: page.id === activePage,
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
