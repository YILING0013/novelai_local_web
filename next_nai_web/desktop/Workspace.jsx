import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, IconButton, List, ListItemButton, ListItemIcon, Tooltip, alpha } from '@mui/material';
import { AccountCircle, Brightness4, Brightness7, Brush, CollectionsOutlined, AutoAwesome, PhotoFilter, Settings, ZoomInMap } from '@mui/icons-material';
import { PanelLeft } from 'lucide-react';
import { open as pick } from '@tauri-apps/plugin-dialog';
import TitleBar from '@/desktop/DesktopTitleBar';
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
export default function Workspace({local,onLogin}){
  const {t}=useI18n(),{mode,toggleTheme}=useAppTheme();
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
  const [work,setWork]=useState(null),[dirty,setDirty]=useState(false),[error,setError]=useState('');
  const [paintHost,setPaintHost]=useState(null),[generated,setGenerated]=useState([]),[incoming,setIncoming]=useState(null);
  const comic=useRef(null);
  const select=useCallback(id=>{
    const reference = id === ID.REFERENCE_GALLERY;
    const gallery = reference || id === ID.LOCAL_GALLERY || id === ID.GALLERY;
    setParams(gallery ? { page: ID.GALLERY, source: reference ? 'references' : id === ID.LOCAL_GALLERY ? 'outputs' : gallerySource } : {page:id});
  },[gallerySource,setParams]);
  useEffect(()=>{setVisited(list=>list.includes(active)?list:[...list,active]);},[active]);
  useEffect(()=>{if(!local)api.getSession().then(s=>{if(!s.authenticated)onLogin();else {setAccount(s.account_snapshot);api.getAccount().then(r=>setAccount(r.account_snapshot)).catch(e=>{if(e.status===401)onLogin()})}}).catch(e=>setError(e.message));},[local]); // window hand-off happens once
  const bridge=useMemo(()=>({share(items,reader){setGenerated(items);comic.current=reader},open(request){setIncoming(request);select(ID.IMAGE_PROCESSING)}}),[select]);
  useEffect(()=>{
    const goto=e=>{if(e.detail===ID.AI_PAINTING&&sessionStorage.getItem('novelai:pending-image-processing')){
      try{setIncoming(JSON.parse(sessionStorage.getItem('novelai:pending-image-processing')));sessionStorage.removeItem('novelai:pending-image-processing');select(ID.IMAGE_PROCESSING)}catch(err){setError(err.message)}
    }else if(!local||e.detail!==ID.AI_PAINTING)select(e.detail)};
    // 与服务版一致：打开过绘画工作区就确认离开，生成中和未保存的画布也需要保护。
    const warn=e=>{if(dirty||visited.includes(ID.AI_PAINTING)||generated.length>0)e.preventDefault()};
    const hot=e=>{if(e.ctrlKey&&e.key===','){e.preventDefault();select(ID.SETTINGS)}};
    window.addEventListener('novelai:open-page',goto);window.addEventListener('beforeunload',warn);window.addEventListener('keydown',hot);
    return ()=>{window.removeEventListener('novelai:open-page',goto);window.removeEventListener('beforeunload',warn);window.removeEventListener('keydown',hot)};
  },[select,generated.length,dirty,local,visited]);
  const nav=pages.filter(([id])=>!local||id!==ID.AI_PAINTING).map(([id,labelKey,Icon])=>({id,labelKey,title:t(labelKey),Icon,color:readPageColor(localStorage,id)}));
  const action=(label,click,icon,current)=><Tooltip title={label}><IconButton size="small" aria-label={label} aria-current={current?'page':undefined} onClick={click}>{icon}</IconButton></Tooltip>;
  const modes=(selected,onChange)=>paintHost&&createPortal(<PaintingModeNavigation selected={selected} onChange={onChange}/>,paintHost);
  function render(id){
    const on=active===id;
    if(id===ID.AI_PAINTING)return <Painting active={on} userId={account?.information?.email||''} accountSnapshot={account} workContext={work} onWorkContextChange={setWork} renderModeTools={modes} desktopEditor={bridge}/>;
    if(id===ID.GALLERY)return <Gallery source={gallerySource} onBusyChange={setGalleryBusy} onSourceChange={source=>setParams({page:ID.GALLERY,source})} workContext={work} onWorkContextChange={setWork}/>;
    if(id===ID.IMAGE_PROCESSING)return <Editor active={on} generatedItems={generated} getCurrentComicPage={()=>comic.current?.()} galleryRequest={incoming} onGalleryRequestHandled={()=>setIncoming(null)}/>;
    if(id===ID.SETTINGS)return <Preferences active={on} pages={nav} onDirtyChange={setDirty} chooseDirectory={()=>pick({directory:true})} desktopPreferences={<WebSettings/>}/>;
    return <Inference active={on} kind={id===ID.IMAGE_TAGGING?'tagger':'upscale'}/>;
  }
  const toggleLabel = t(rail ? 'main.hideSidebar' : 'main.showSidebarIcons');
  return <><TitleBar leading={<Tooltip title={toggleLabel}><IconButton size="small" aria-label={toggleLabel}
    aria-controls="main-navigation" aria-expanded={rail} onClick={()=>setRail(v=>!v)}>
    <PanelLeft size={18} strokeWidth={1.7}>{!rail&&<path d="M5 3h4v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="currentColor" stroke="none"/>}</PanelLeft>
  </IconButton></Tooltip>} >
    <LanguageSwitcher compact/>{action(t(mode==='light'?'main.themeToDark':'main.themeToLight'),toggleTheme,mode==='light'?<Brightness4/>:<Brightness7/>)}
    {action(t('pages.settings'),()=>select(ID.SETTINGS),<Settings/>,active===ID.SETTINGS)}
    {action(t(local?'login.login':'main.accountInfo'),local?async()=>{if(await confirmWorkspaceLeave(t('main.unsavedWarning')))onLogin()}:()=>setAccountOpen(true),<AccountCircle/>)}
    </TitleBar>
    {error&&<Alert severity="error" onClose={()=>setError('')}>{error}</Alert>}
    <Box sx={{flex:1,minHeight:0,display:'flex'}}>
    {rail&&<Box id="main-navigation" component="nav" aria-label={t('main.navigation')} sx={{width:64,overflowY:'auto',flexShrink:0,bgcolor:'background.drawer',borderRight:1,borderColor:'divider'}}>
      <List sx={{px:1,pt:'5px'}}>{nav.filter(p=>p.id!==ID.SETTINGS).map(({id,title,Icon,color})=><Box key={id} sx={{mb:.5}}>
        <Tooltip title={title} placement="right" arrow><ListItemButton aria-label={title} aria-current={id===active?'page':undefined} onClick={()=>select(id)}
          sx={{height:44,minHeight:44,px:1,borderRadius:1.5,position:'relative',bgcolor:id===active?'action.selected':'transparent','&::before':id===active?{content:'""',position:'absolute',left:0,top:'22%',height:'56%',width:2,bgcolor:color,borderRadius:1}:{}}}>
          <ListItemIcon sx={{minWidth:0,mx:'auto',color:id===active?color:'text.secondary'}}><Icon/></ListItemIcon></ListItemButton></Tooltip>
        {id===ID.AI_PAINTING&&<Box ref={setPaintHost} sx={{display:id===active?'flex':'none',flexDirection:'column',gap:.25,mt:.5,p:.25,borderRadius:1.5,bgcolor:theme=>alpha(theme.palette.primary.main,.07)}}/>}</Box>)}</List>
      </Box>}
      <Box component="main" sx={{minWidth:0,minHeight:0,flex:1,overflow:'hidden'}}>
        {visited.map(id=><Box key={id} component="section" aria-label={nav.find(p=>p.id===id)?.title} sx={{display:active===id?'block':'none',height:'100%',overflow:'auto'}}>
          <Suspense fallback={<CircularProgress size={24}/>}>{render(id)}</Suspense></Box>)}
      </Box>
    </Box>
    {accountOpen&&<Suspense fallback={null}><Account open onClose={()=>setAccountOpen(false)} accountSnapshot={account} onAccountSnapshot={setAccount}
      onLogout={async()=>{if(await confirmWorkspaceLeave(t('main.unsavedWarning'))){await api.logout();onLogin()}}}/></Suspense>}
  </>;
}
