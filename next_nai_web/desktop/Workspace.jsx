import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Tab, Tabs, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { AccountCircle, Brightness4, Brightness7, Brush, ChevronLeft, CollectionsOutlined, AutoAwesome, Logout, PersonOutline, PhotoFilter, Settings, ZoomInMap } from '@mui/icons-material';
import { PanelLeft } from 'lucide-react';
import { open as pick } from '@tauri-apps/plugin-dialog';
import DesktopTitleBar from '@/desktop/DesktopTitleBar';
import { confirmWorkspaceLeave } from '@/desktop/navigation';
import { useI18n } from '@/i18n/I18nProvider';
import { useAppTheme } from '@/providers/AppThemeProvider';
import { PAGE_IDS as ID, readPageColor } from '@/i18n/pageConfig.mjs';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import api from '@/utils/ApiClient';
import WebSettings from './WebSettings';
import PaintingModeNavigation from '@/components/ai-painting/PaintingModeNavigation';
const Painting=lazy(()=>import('@/components/ai-painting/AIPaintingPage'));
const Gallery=lazy(()=>import('@/components/gallery/GalleryWorkspace'));
const Editor=lazy(()=>import('@/components/ai-painting/ImageProcessing/ImageProcessingWorkspace'));
const Inference=lazy(()=>import('@/components/local-inference/LocalInferencePage'));
const Preferences=lazy(()=>import('@/components/settings/SettingsPage'));
const Account=lazy(()=>import('@/components/account/AccountDialog'));
const pages=[
  [ID.AI_PAINTING,'pages.aiPainting',Brush],[ID.GALLERY,'pages.gallery',CollectionsOutlined],
  [ID.IMAGE_PROCESSING,'painting.workspace.tabs.imageProcessing',PhotoFilter],
  [ID.IMAGE_TAGGING,'pages.imageTagging',AutoAwesome],[ID.LOCAL_UPSCALING,'pages.localUpscaling',ZoomInMap],
  [ID.SETTINGS,'pages.settings',Settings]];
export default function Workspace({ local, onLogin, android = false, appVersion, TitleBar = DesktopTitleBar }){
  const {t, locale}=useI18n(),{mode,toggleTheme,animationEnabled}=useAppTheme();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  const androidDrawer = android && narrow;
  const navigate = useNavigate();
  const [params,setParams]=useSearchParams(), first=local?ID.GALLERY:ID.AI_PAINTING;
  const requested= params.get('page');
  const referenceRequested = requested === ID.REFERENCE_GALLERY;
  const page = referenceRequested || requested === ID.LOCAL_GALLERY ? ID.GALLERY : requested === 'editor' ? ID.IMAGE_PROCESSING : requested;
  const active=pages.some(([id])=>id===page&&(!local||id!==ID.AI_PAINTING))?page:first;
  const requestedSource = referenceRequested || params.get('source') === 'references' ? 'references' : 'outputs';
  const [gallerySource, setGallerySource] = useState(requestedSource);
  const [galleryBusy, setGalleryBusy] = useState(false);
  useEffect(() => { if (active === ID.GALLERY && !galleryBusy) setGallerySource(requestedSource); }, [active, galleryBusy, requestedSource]);
  const [visited,setVisited]=useState([active]),[rail,setRail]=useState(true),[account,setAccount]=useState(null),[accountOpen,setAccountOpen]=useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [work,setWork]=useState(null),[dirty,setDirty]=useState(false),[error,setError]=useState('');
  const [paintHost,setPaintHost]=useState(null),[generated,setGenerated]=useState([]),[incoming,setIncoming]=useState(null);
  const comic=useRef(null);
  const settingsReturn = useRef({});
  const settingsSection = params.get('section');
  const sectionRequest = useMemo(() => android ? { section: settingsSection } : null, [android, settingsSection]);
  useEffect(() => {
    if (active !== ID.SETTINGS) settingsReturn.current = Object.fromEntries(params);
  }, [active, params]);
  useEffect(() => {
    if (!androidDrawer || !drawerOpen) return;
    const closeDrawer = (event) => {
      if (event.defaultPrevented || event.detail) return;
      event.preventDefault();
      setDrawerOpen(false);
    };
    window.addEventListener('mobile-back', closeDrawer);
    return () => window.removeEventListener('mobile-back', closeDrawer);
  }, [androidDrawer, drawerOpen]);
  const select=useCallback(id=>{
    const reference = id === ID.REFERENCE_GALLERY;
    const gallery = reference || id === ID.LOCAL_GALLERY || id === ID.GALLERY;
    setParams(gallery ? { page: ID.GALLERY, source: reference ? 'references' : id === ID.LOCAL_GALLERY ? 'outputs' : gallerySource } : {page:id});
    if (android) setDrawerOpen(false);
  },[android,gallerySource,setParams]);
  useEffect(()=>{setVisited(list=>list.includes(active)?list:[...list,active]);},[active]);
  useEffect(()=>{if(!local)api.getSession().then(s=>{if(!s.authenticated)onLogin();else {setAccount(s.account_snapshot);api.getAccount().then(r=>setAccount(r.account_snapshot)).catch(e=>{if(e.status===401)onLogin()})}}).catch(e=>setError(e.message));},[local]); // window hand-off happens once
  const bridge=useMemo(()=>({share(items,reader){setGenerated(items);comic.current=reader},open(request){setIncoming(request);select(ID.IMAGE_PROCESSING)}}),[select]);
  useEffect(()=>{
    const goto=e=>{if(android && e.detail?.pageId===ID.SETTINGS){
      setParams({page:ID.SETTINGS,section:e.detail.section});
    }else if(e.detail===ID.AI_PAINTING&&sessionStorage.getItem('novelai:pending-image-processing')){
      try{setIncoming(JSON.parse(sessionStorage.getItem('novelai:pending-image-processing')));sessionStorage.removeItem('novelai:pending-image-processing');select(ID.IMAGE_PROCESSING)}catch(err){setError(err.message)}
    }else if(!local||e.detail!==ID.AI_PAINTING)select(e.detail)};
    // 与服务版一致：打开过绘画工作区就确认离开，生成中和未保存的画布也需要保护。
    const warn=e=>{if(dirty||visited.includes(ID.AI_PAINTING)||generated.length>0)e.preventDefault()};
    const hot=e=>{if(e.ctrlKey&&e.key===','){e.preventDefault();select(ID.SETTINGS)}};
    window.addEventListener('novelai:open-page',goto);window.addEventListener('beforeunload',warn);window.addEventListener('keydown',hot);
    return ()=>{window.removeEventListener('novelai:open-page',goto);window.removeEventListener('beforeunload',warn);window.removeEventListener('keydown',hot)};
  },[select,generated.length,dirty,local,visited,android,setParams]);
  const nav=pages.filter(([id])=>!local||id!==ID.AI_PAINTING).map(([id,labelKey,Icon])=>({id,labelKey,title:t(labelKey),Icon,icon:<Icon/>,color:readPageColor(localStorage,id)}));
  const action=(label,click,icon,current)=><Tooltip title={label}><IconButton size="small" aria-label={label} aria-current={current?'page':undefined} onClick={click}>{icon}</IconButton></Tooltip>;
  const modes=(selected,onChange)=>paintHost&&createPortal(<PaintingModeNavigation selected={selected} expanded={androidDrawer} onChange={(modeId)=>{
    onChange(modeId);
    if (androidDrawer) setDrawerOpen(false);
  }}/>,paintHost);
  const closeSettings = async () => {
    if (!dirty || await window.novelaiDialog.confirm(t('main.unsavedWarning'))) setParams(settingsReturn.current);
  };
  const openOnline = async () => {
    try {
      if (!await confirmWorkspaceLeave(t('main.unsavedWarning'))) return;
      const session = await api.getSession();
      if (session.authenticated) navigate('/main');
      else onLogin();
    } catch (failure) {
      setError(failure.message);
    }
  };
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await api.logout(); onLogin(); }
    catch (failure) { setError(failure.data?.message || t('main.local.logoutFailed')); setLogoutOpen(false); }
    finally { setLoggingOut(false); }
  };
  function render(id){
    const on=active===id;
    if(id===ID.AI_PAINTING)return <Painting active={on} androidLayout={android}
      userId={account?.information?.email||''} accountSnapshot={account} workContext={work} onWorkContextChange={setWork} renderModeTools={modes} desktopEditor={bridge}/>;
    if(id===ID.GALLERY)return <Gallery androidLayout={android} source={gallerySource} onBusyChange={setGalleryBusy} onSourceChange={source=>setParams({page:ID.GALLERY,source})} workContext={work} onWorkContextChange={setWork}/>;
    if(id===ID.IMAGE_PROCESSING)return <Editor active={on} generatedItems={generated} getCurrentComicPage={()=>comic.current?.()} galleryRequest={incoming} onGalleryRequestHandled={()=>setIncoming(null)}/>;
    if(id===ID.SETTINGS)return <Preferences active={on} pages={nav} onDirtyChange={setDirty} fixedOutputDirectory={android} mobileLayout={android}
      sectionRequest={sectionRequest} appVersion={appVersion} onBack={android ? closeSettings : undefined} onSectionChange={(section) => {
        if (section) setParams({ page: ID.SETTINGS, section }, { state: { settingsParent: true } });
        else if (window.history.state?.usr?.settingsParent) navigate(-1);
        else setParams({ page: ID.SETTINGS }, { replace: true });
      }}
      chooseDirectory={android ? undefined : ()=>pick({directory:true})} desktopPreferences={android ? undefined : <WebSettings/>}/>;
    return <Inference active={on} androidLayout={android} kind={id===ID.IMAGE_TAGGING?'tagger':'upscale'}/>;
  }
  const toggleLabel = t(androidDrawer ? (drawerOpen ? 'main.closeDrawer' : 'main.openDrawer') : rail ? 'main.hideSidebar' : 'main.showSidebarIcons');
  const leading = <Tooltip title={toggleLabel}><IconButton size="small" aria-label={toggleLabel}
    aria-controls="main-navigation" aria-expanded={androidDrawer ? drawerOpen : rail}
    onClick={()=>androidDrawer ? setDrawerOpen(v=>!v) : setRail(v=>!v)}>
    <PanelLeft size={18} strokeWidth={1.7}>{!android && !rail&&<path d="M5 3h4v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="currentColor" stroke="none"/>}</PanelLeft>
  </IconButton></Tooltip>;
  const localTitle = locale === 'zh-CN' ? '本机工具' : 'Local workspace';
  const sidebarWidth = androidDrawer ? 'min(320px, calc(100vw - 32px))' : 64;
  const localTabs = [
    [ID.LOCAL_GALLERY, 'gallery.outputsTitle'], [ID.REFERENCE_GALLERY, 'gallery.referencesTitle'],
    [ID.IMAGE_TAGGING, 'pages.imageTagging'], [ID.LOCAL_UPSCALING, 'pages.localUpscaling'],
    [ID.IMAGE_PROCESSING, 'painting.workspace.tabs.imageProcessing'], [ID.SETTINGS, 'pages.settings'],
  ];
  return <>{android ? <TitleBar leading={local ? undefined : leading} title={local ? localTitle : undefined}
    actions={[
      ...(!local ? [{ label: t('main.accountInfo'), icon: <AccountCircle fontSize="small"/>, onClick: () => setAccountOpen(true) }] : []),
      { label: t('pages.settings'), icon: <Settings fontSize="small"/>, selected: active === ID.SETTINGS,
        onClick: () => active === ID.SETTINGS ? closeSettings() : select(ID.SETTINGS) },
      local ? { label: locale === 'zh-CN' ? '账号与在线功能' : 'Account & online workspace', icon: <PersonOutline fontSize="small"/>, onClick: openOnline }
        : { label: t('main.logout'), icon: <Logout fontSize="small"/>, onClick: () => setLogoutOpen(true) },
    ]}/> : <TitleBar leading={leading}>
    <LanguageSwitcher compact/>{action(t(mode==='light'?'main.themeToDark':'main.themeToLight'),toggleTheme,mode==='light'?<Brightness4/>:<Brightness7/>)}
    {action(t('pages.settings'),()=>select(ID.SETTINGS),<Settings/>,active===ID.SETTINGS)}
    {action(t(local?'login.login':'main.accountInfo'),local?async()=>{if(await confirmWorkspaceLeave(t('main.unsavedWarning')))onLogin()}:()=>setAccountOpen(true),<AccountCircle/>)}
    </TitleBar>}
    {error&&<Alert severity="error" onClose={()=>setError('')}>{error}</Alert>}
    {android && local && <Tabs variant="scrollable" scrollButtons="auto" aria-label={localTitle}
      value={active === ID.GALLERY ? (gallerySource === 'outputs' ? ID.LOCAL_GALLERY : ID.REFERENCE_GALLERY) : active}
      onChange={(_, id) => select(id)} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
      {localTabs.map(([id, key]) => <Tab key={id} value={id} label={t(key)} disabled={galleryBusy && [ID.LOCAL_GALLERY, ID.REFERENCE_GALLERY].includes(id)} />)}
    </Tabs>}
    <Box sx={{flex:1,minHeight:0,display:'flex',overflow:android?'hidden':undefined}}>
    {android ? !local && <Drawer variant={androidDrawer ? 'temporary' : 'permanent'} open={androidDrawer ? drawerOpen : rail}
      onClose={()=>setDrawerOpen(false)} ModalProps={{ keepMounted: true }}
      slotProps={{ paper: { id: 'main-navigation', component: 'nav', 'aria-label': t('main.navigation') } }}
      sx={{ width: androidDrawer ? sidebarWidth : rail ? 64 : 0, flexShrink: 0, '& .MuiDrawer-paper': {
        width: sidebarWidth, visibility: !androidDrawer && !rail ? 'hidden' : undefined, boxSizing: 'border-box',
        overflowX: 'hidden', scrollbarWidth: androidDrawer ? 'auto' : 'none',
        boxShadow: 'none', borderRadius: 0, borderRight: 1, borderColor: 'divider', bgcolor: 'background.drawer',
        transition: theme.transitions.create(['width', 'background-color'], { duration: animationEnabled ? theme.transitions.duration.standard : 0 }),
        top: androidDrawer ? 'var(--mobile-top)' : 'calc(var(--mobile-top) + 44px)',
        left: 'var(--mobile-left)', bottom: 'var(--mobile-bottom)', height: 'auto',
      } }}>
      {androidDrawer && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0, px: 2, py: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Box component="img" src="/logo.svg" alt="" sx={{ width: 40, height: 40 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="h6">NovelAI Local</Typography><Typography variant="body2" color="text.secondary">{locale === 'zh-CN' ? '创作工作区' : 'Workspace'}</Typography></Box>
        <IconButton aria-label={t('main.closeDrawer')} aria-expanded={drawerOpen} aria-controls="main-navigation" onClick={()=>setDrawerOpen(false)}><ChevronLeft /></IconButton>
      </Box>}
      <List sx={{ px: androidDrawer ? 1.5 : 1, pt: 1.5, pb: 1, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {nav.filter(p=>p.id!==ID.SETTINGS).map(({id,title,icon,color}) => <Box key={id} sx={{ mb: .5 }}>
          <Tooltip title={androidDrawer ? '' : title} placement="right" arrow>
            <ListItemButton aria-label={title} aria-current={id===active?'page':undefined} onClick={()=>select(id)}
              sx={{ minHeight: androidDrawer ? 56 : 44, px: androidDrawer ? 1.5 : 1, borderRadius: 1.5, bgcolor: id===active ? 'action.selected' : 'transparent',
                '&::before': id===active ? { content: '""', position: 'absolute', left: 0, top: '22%', height: '56%', width: 2, bgcolor: color, borderRadius: 1 } : {} }}>
              <ListItemIcon sx={{ minWidth: androidDrawer ? 44 : 0, mx: androidDrawer ? 0 : 'auto', color: id===active ? color : 'text.secondary' }}>{icon}</ListItemIcon>
              {androidDrawer && <ListItemText primary={title} primaryTypographyProps={{ fontSize: 16, fontWeight: id===active ? 650 : 500 }} />}
            </ListItemButton>
          </Tooltip>
          {id===ID.AI_PAINTING && <Box ref={setPaintHost} role="group" aria-label={title}
            sx={{ display: id===active?'flex':'none', flexDirection: 'column', gap: .25, mt: .5, py: .5, px: .25, borderRadius: 1.5, bgcolor: alpha(theme.palette.primary.main,.07) }}/>}
        </Box>)}
      </List>
    </Drawer> : rail&&<Box id="main-navigation" component="nav" aria-label={t('main.navigation')} sx={{width:64,overflowY:'auto',flexShrink:0,bgcolor:'background.drawer',borderRight:1,borderColor:'divider'}}>
      <List sx={{px:1,pt:'5px'}}>{nav.filter(p=>p.id!==ID.SETTINGS).map(({id,title,Icon,color})=><Box key={id} sx={{mb:.5}}>
        <Tooltip title={title} placement="right" arrow><ListItemButton aria-label={title} aria-current={id===active?'page':undefined} onClick={()=>select(id)}
          sx={{height:44,minHeight:44,px:1,borderRadius:1.5,position:'relative',bgcolor:id===active?'action.selected':'transparent','&::before':id===active?{content:'""',position:'absolute',left:0,top:'22%',height:'56%',width:2,bgcolor:color,borderRadius:1}:{}}}>
          <ListItemIcon sx={{minWidth:0,mx:'auto',color:id===active?color:'text.secondary'}}><Icon/></ListItemIcon></ListItemButton></Tooltip>
        {id===ID.AI_PAINTING&&<Box ref={setPaintHost} sx={{display:id===active?'flex':'none',flexDirection:'column',gap:.25,mt:.5,p:.25,borderRadius:1.5,bgcolor:theme=>alpha(theme.palette.primary.main,.07)}}/>}</Box>)}</List>
      </Box>}
      <Box component="main" sx={{minWidth:0,minHeight:0,flex:1,overflow:'hidden',contain:android?'layout':undefined}}>
        {visited.map(id=><Box key={id} component="section" aria-label={nav.find(p=>p.id===id)?.title} sx={{
          display:active===id?'block':'none',height:'100%',overflow:android && [ID.AI_PAINTING,ID.IMAGE_PROCESSING,ID.SETTINGS].includes(id) ? 'hidden' : 'auto',
          p:android && [ID.AI_PAINTING,ID.IMAGE_PROCESSING].includes(id) ? '4px 4px 0 0' : 0,
        }}>
          <Suspense fallback={<CircularProgress size={24}/>}>{render(id)}</Suspense></Box>)}
      </Box>
    </Box>
    {accountOpen&&<Suspense fallback={null}><Account androidLayout={android} open onClose={()=>setAccountOpen(false)} accountSnapshot={account} onAccountSnapshot={setAccount}
      onLogout={async()=>{if(await confirmWorkspaceLeave(t('main.unsavedWarning'))){await api.logout();onLogin()}}}/></Suspense>}
    {android && <Dialog open={logoutOpen} onClose={loggingOut ? undefined : () => setLogoutOpen(false)} fullWidth maxWidth="xs">
      <DialogTitle>{t('main.logout')}</DialogTitle>
      <DialogContent>{t('main.unsavedWarning')}</DialogContent>
      <DialogActions>
        <Button disabled={loggingOut} onClick={() => setLogoutOpen(false)}>{t('common.cancel')}</Button>
        <Button color="error" disabled={loggingOut} onClick={logout}>{t('main.logout')}</Button>
      </DialogActions>
    </Dialog>}
  </>;
}
