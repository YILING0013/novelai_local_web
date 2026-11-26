"use client";
import { NavigationResizeHandle, useNavigationWidth } from '@/components/ResizableNavigation';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
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
  CollectionsOutlined as GalleryIcon,
  PhotoFilter as ImageProcessingIcon,
  LocalOffer as TaggingIcon,
  Hd as UpscalingIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  Menu as MenuIcon,
  Settings as SettingsIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import AIPaintingPage from '@/components/ai-painting/AIPaintingPage';
import PaintingModeNavigation from '@/components/ai-painting/PaintingModeNavigation';
import SettingsPage from '@/components/settings/SettingsPage';
import GalleryWorkspace from '@/components/gallery/GalleryWorkspace';
import LocalInferencePage from '@/components/local-inference/LocalInferencePage';
import apiClient from '@/utils/ApiClient';
import TutorialsPage from '@/components/tutorials/TutorialsPage';
import { DRAWING_TUTORIALS } from '@/content/tutorials.mjs';
import DrawingPractice from '@/components/tutorials/DrawingPractice';
import ReleaseGuide from '@/components/changelog/ReleaseGuide';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import { useI18n } from '@/i18n/I18nProvider';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { useAppTheme } from '@/providers/AppThemeProvider';
import {
  PAGE_IDS,
  migrateLegacyPageColors,
  readPageColor,
} from '@/i18n/pageConfig.mjs';

import AccountDialog from '@/components/account/AccountDialog';

const ImageProcessingWorkspace = dynamic(() => import('@/components/ai-painting/ImageProcessing/ImageProcessingWorkspace'), { ssr: false });

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
  const navigation = useNavigationWidth();
  const openDrawer = isMobile ? mobileDrawerOpen : navigation.desktopDrawerWidth >= 160;
  const sidebarWidth = isMobile ? drawerWidth : navigation.desktopDrawerWidth;
  const [openPages, setOpenPages] = useState([]);
  const [workContext, setWorkContext] = useState(null);
  const [activePage, setActivePage] = useState(null);
  const settingsSource = useRef(null);
  const [settingsRequest, setSettingsRequest] = useState(null);
  useEffect(() => {
    if (activePage && activePage !== PAGE_IDS.SETTINGS) settingsSource.current = activePage;
  }, [activePage]);
  const [paintHost, setPaintHost] = useState(null);
  const [generatedItems, setGeneratedItems] = useState([]);
  const [processingRequest, setProcessingRequest] = useState(null);
  const comicRef = useRef(null);
  const [gallerySource, setGallerySource] = useState('outputs');
  const [requestedGallerySource, setRequestedGallerySource] = useState('outputs');
  const [galleryBusy, setGalleryBusy] = useState(false);
  useEffect(() => { if (!galleryBusy) setGallerySource(requestedGallerySource); }, [galleryBusy, requestedGallerySource]);
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
      { id: PAGE_IDS.GALLERY, labelKey: 'pages.gallery', icon: <GalleryIcon />, color: readPageColor(storage, PAGE_IDS.GALLERY), confirmOnClose: false },
      { id: PAGE_IDS.IMAGE_PROCESSING, labelKey: 'painting.workspace.tabs.imageProcessing', icon: <ImageProcessingIcon />, color: readPageColor(storage, PAGE_IDS.IMAGE_PROCESSING), confirmOnClose: true },
      { id: PAGE_IDS.IMAGE_TAGGING, labelKey: 'pages.imageTagging', icon: <TaggingIcon />, component: <LocalInferencePage kind="tagger" />, color: readPageColor(storage, PAGE_IDS.IMAGE_TAGGING), confirmOnClose: false },
      { id: PAGE_IDS.LOCAL_UPSCALING, labelKey: 'pages.localUpscaling', icon: <UpscalingIcon />, component: <LocalInferencePage kind="upscale" />, color: readPageColor(storage, PAGE_IDS.LOCAL_UPSCALING), confirmOnClose: false },
      { id: PAGE_IDS.TUTORIALS, labelKey: 'pages.tutorials', icon: <SchoolOutlinedIcon />, color: readPageColor(storage, PAGE_IDS.TUTORIALS), confirmOnClose: false },
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
  const [activeGuide, setActiveGuide] = useState(null);
  const practiceTopic = activeGuide?.startsWith('practice:') ? activeGuide.slice(9) : null;
  const drawingTopic = DRAWING_TUTORIALS.includes(practiceTopic || activeGuide) ? practiceTopic || activeGuide : null;
  const promptExerciseTopic = drawingTopic ? null : practiceTopic || (activeGuide === 'suggestionPractice' ? 'suggestions' : activeGuide);
  const [guideSource, setGuideSource] = useState(null);
  const startGuidePractice = useCallback(() => setActiveGuide((guide) => guide === 'suggestions' ? 'suggestionPractice' : `practice:${guide}`), []);
  const [guideEnded, setGuideEnded] = useState(false);
  const closeReleaseGuide = useCallback(() => { setActiveGuide(null); setGuideEnded(true); }, []);

  const handleOpenPage = useCallback((page) => {
    setOpenPages((current) => current.some((item) => item.id === page.id) ? current : [...current, page]);
    setActivePage(page.id);
    if (isMobile) setMobileDrawerOpen(false);
  }, [isMobile]);

  const startTutorial = (guide, { source = PAGE_IDS.TUTORIALS } = {}) => {
    handleOpenPage(visiblePages.find((page) => page.id === PAGE_IDS.AI_PAINTING));
    setGuideSource(source);
    setGuideEnded(false);
    setActiveGuide(guide === 'suggestions' ? guide : `practice:${guide}`);
  };
  useEffect(() => {
    if (activePage !== PAGE_IDS.AI_PAINTING) {
      setActiveGuide(null);
      setGuideSource(null);
      setGuideEnded(false);
    }
  }, [activePage]);
  const returnFromGuide = guideSource && !activeGuide ? () => {
    const source = visiblePages.find((page) => page.id === guideSource);
    if (source) handleOpenPage(source);
  } : undefined;


  useEffect(() => {
    const openRequestedPage = (event) => {
      let pageId = event.detail?.pageId || event.detail;
      if (pageId === PAGE_IDS.SETTINGS) setSettingsRequest({ section: event.detail?.section || null });
      if ([PAGE_IDS.REFERENCE_GALLERY, PAGE_IDS.LOCAL_GALLERY, PAGE_IDS.GALLERY].includes(pageId)) {
        if (pageId !== PAGE_IDS.GALLERY) setRequestedGallerySource(pageId === PAGE_IDS.REFERENCE_GALLERY ? 'references' : 'outputs');
        pageId = PAGE_IDS.GALLERY;
      }
      if (pageId === PAGE_IDS.AI_PAINTING && sessionStorage.getItem('novelai:pending-image-processing')) {
        setProcessingRequest(JSON.parse(sessionStorage.getItem('novelai:pending-image-processing')));
        sessionStorage.removeItem('novelai:pending-image-processing');
        pageId = PAGE_IDS.IMAGE_PROCESSING;
      }
      const requested = visiblePages.find((page) => page.id === pageId);
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

  const editorBridge = useMemo(() => ({
    share(items, reader) { setGeneratedItems(items); comicRef.current = reader; },
    open(request) {
      setProcessingRequest(request);
      handleOpenPage(visiblePages.find((page) => page.id === PAGE_IDS.IMAGE_PROCESSING));
    },
  }), [handleOpenPage, visiblePages]);
  const renderModeTools = (selected, onChange) => paintHost && createPortal(
    <PaintingModeNavigation selected={selected} expanded={openDrawer} onChange={(mode) => { onChange(mode); setMobileDrawerOpen(false); }} />, paintHost,
  );

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

          {!isMobile && <NavigationResizeHandle {...navigation} />}
        <Drawer variant={isMobile ? 'temporary' : 'permanent'} open={isMobile ? openDrawer : true}
          onClose={() => setMobileDrawerOpen(false)} slotProps={{ paper: { id: 'main-navigation', component: 'nav', 'aria-label': t('main.navigation') } }} sx={{
            width: sidebarWidth, flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: sidebarWidth, visibility: !isMobile && sidebarWidth === 0 ? 'hidden' : undefined, boxSizing: 'border-box',
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
          <List sx={{ px: 1, pt: '5px', pb: 1, flexGrow: 1 }}>
            {visiblePages.map((page) => {
              const isActive = activePage === page.id;
              return <Box key={page.id} sx={{ mb: 0.5 }}>
                <Tooltip title={openDrawer ? '' : getPageLabel(page)} placement="right" arrow>
                  <ListItemButton aria-label={getPageLabel(page)} aria-current={isActive ? 'page' : undefined} onClick={() => handleOpenPage(page)}
                    sx={{ height: 44, minHeight: 44, px: 1, borderRadius: 1.5, position: 'relative', bgcolor: isActive ? 'action.selected' : 'transparent',
                      '&::before': isActive ? { content: '""', position: 'absolute', left: 0, top: '22%', height: '56%', width: 2, bgcolor: page.color, borderRadius: 1 } : {} }}>
                    <ListItemIcon sx={{ minWidth: openDrawer ? 36 : 0, mx: openDrawer ? 0 : 'auto', color: isActive ? page.color : 'text.secondary', '& .MuiSvgIcon-root': { fontSize: 24 } }}>{page.icon}</ListItemIcon>
                    {openDrawer && <ListItemText primary={getPageLabel(page)} slotProps={{ primary: { fontSize: 13 } }} />}
                  </ListItemButton>
                </Tooltip>
                {page.id === PAGE_IDS.AI_PAINTING && <Box ref={setPaintHost} role="group" aria-label={t('pages.aiPainting')}
                  sx={{ display: isActive ? 'flex' : 'none', mt: 0.5, py: 0.5, px: 0.25, borderRadius: 1.5,
                    bgcolor: alpha(theme.palette.primary.main, 0.07), flexDirection: 'column', gap: 0.25 }} />}
              </Box>;
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
              <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', p: 0 }}>
                {openPages.map((page) => (
                  <Box key={page.id} sx={{ height: '100%', display: page.id === activePage ? 'block' : 'none' }}>
                    {page.id === PAGE_IDS.GALLERY
                      ? <GalleryWorkspace source={gallerySource} onSourceChange={setRequestedGallerySource} onBusyChange={setGalleryBusy} workContext={workContext} onWorkContextChange={setWorkContext} />
                      : page.id === PAGE_IDS.IMAGE_PROCESSING
                      ? <ImageProcessingWorkspace active={page.id === activePage} generatedItems={generatedItems} getCurrentComicPage={() => comicRef.current?.()}
                          galleryRequest={processingRequest} onGalleryRequestHandled={() => setProcessingRequest(null)} />
                      : page.id === PAGE_IDS.SETTINGS
                      ? React.cloneElement(page.component, { pages: visiblePages, active: page.id === activePage, sectionRequest: settingsRequest, onBack: () => setActivePage(settingsSource.current || PAGE_IDS.AI_PAINTING) })
                      : page.id === PAGE_IDS.TUTORIALS
                      ? <TutorialsPage active={activePage === PAGE_IDS.TUTORIALS} onStartGuide={startTutorial} />
                      : page.id === PAGE_IDS.AI_PAINTING
                      ? <><Box sx={{ display: drawingTopic ? 'none' : 'contents' }}>{React.cloneElement(page.component, {
                        userId: accountSnapshot?.information?.email || '',
                        accountSnapshot,
                        renderModeTools, desktopEditor: editorBridge,
                        workContext, onWorkContextChange: setWorkContext,
                        active: page.id === activePage && !drawingTopic,
                              releaseGuideActive: activeGuide === 'notebook',
                              suggestionPractice: activeGuide === 'suggestionPractice',
                              promptExerciseTopic,
                              promptExerciseActive: Boolean(practiceTopic && !drawingTopic),
                              onExitSuggestionPractice: closeReleaseGuide,
                        tutorialTopic: activeGuide, onBack: returnFromGuide, backLabel: t('tutorials.returnToTutorial'),
                      })}</Box>{drawingTopic && <DrawingPractice key={drawingTopic} topic={drawingTopic} onClose={closeReleaseGuide} />}</> : page.component}
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
      <Dialog open={Boolean(guideEnded && returnFromGuide)} onClose={() => setGuideEnded(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('tutorials.sessionEnded')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setGuideEnded(false)}>{t('tutorials.stayInWorkspace')}</Button>
          <Button autoFocus variant="contained" onClick={() => { setGuideEnded(false); returnFromGuide(); }}>
            {t(guideSource === PAGE_IDS.TUTORIALS ? 'tutorials.returnToTutorial' : 'tutorials.returnToChangelog')}
          </Button>
        </DialogActions>
      </Dialog>
      {activeGuide && !drawingTopic && activeGuide !== 'suggestionPractice' && !activeGuide.startsWith('practice:') && <ReleaseGuide key={activeGuide} guide={activeGuide}
        onClose={closeReleaseGuide} onPractice={startGuidePractice} />}

    </>
  );
}
