import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, CircularProgress, Snackbar } from '@mui/material';
import { House, Brush, Images, FolderOpen, ScanEye, Expand, Layers, Settings2, Moon, Sun, UserRound,
  LogIn, X, Image as Picture, Paintbrush, PanelsTopLeft, SlidersHorizontal, Monitor, ArrowRight } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAppTheme } from '@/providers/AppThemeProvider';
import { PAGE_IDS as ID, readPageColor } from '@/i18n/pageConfig.mjs';
import api from '@/utils/ApiClient';
import TitleBar, { native, ToolButton } from './TitleBar';
import Home from './WorkspaceHome';
import DesktopWebAccess from '@/components/settings/DesktopWebAccess';

const Painting = lazy(() => import('@/components/ai-painting/AIPaintingPage'));
const Gallery = lazy(() => import('@/components/gallery/GalleryWorkspace'));
const Inference = lazy(() => import('@/components/local-inference/LocalInferencePage'));
const ImageEditor = lazy(() => import('@/components/ai-painting/ImageProcessing/ImageProcessingWorkspace'));
const Settings = lazy(() => import('@/components/settings/SettingsPage'));
const Account = lazy(() => import('@/components/account/AccountDialog'));

const toolIcons = { home: House, [ID.AI_PAINTING]: Brush, [ID.LOCAL_GALLERY]: FolderOpen,
  [ID.REFERENCE_GALLERY]: Images, editor: Layers, [ID.IMAGE_TAGGING]: ScanEye, [ID.LOCAL_UPSCALING]: Expand, settings: Settings2 };
const labelKeys = { [ID.AI_PAINTING]: 'pages.aiPainting', [ID.LOCAL_GALLERY]: 'gallery.outputsTitle',
  [ID.REFERENCE_GALLERY]: 'gallery.referencesTitle', [ID.IMAGE_TAGGING]: 'pages.imageTagging', [ID.LOCAL_UPSCALING]: 'pages.localUpscaling',
  settings: 'pages.settings', editor: 'painting.workspace.tabs.imageProcessing' };

function chooseDirectory() {
  return new Promise(resolve => {
    const receive = ({ data }) => {
      if (typeof data !== 'string' || !data.startsWith('folder:')) return;
      window.chrome.webview.removeEventListener('message', receive); resolve(data.slice(7));
    };
    window.chrome.webview.addEventListener('message', receive); native('folder');
  });
}

export default function Studio({ local }) {
  const { t, locale } = useI18n();
  const zh = locale === 'zh-CN';
  const { mode, toggleTheme } = useAppTheme();
  const [account, setAccount] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [webEnabled, setWebEnabled] = useState(null);
  const [startupError, setStartupError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [work, setWork] = useState(null);
  const [rail, setRail] = useState(true);
  const [modeHost, setModeHost] = useState(null);
  const [notice, setNotice] = useState('');
  const [incoming, setIncoming] = useState(null);
  const initial = local ? 'home' : ID.AI_PAINTING;
  const [tabs, setTabs] = useState([initial]);
  const [history, setHistory] = useState({ items: [initial], at: 0 });
  const active = history.items[history.at];
  const labels = Object.fromEntries(Object.entries(labelKeys).map(([k, v]) => [k, t(v)]));
  labels.home = zh ? '工作台' : 'Workspace';
  const open = useCallback((id) => {
    setTabs(all => all.includes(id) ? all : [...all, id]);
    setHistory(h => h.items[h.at] === id ? h : { items: [...h.items.slice(0, h.at + 1), id], at: h.at + 1 });
  }, []);
  const [generated, setGenerated] = useState([]);
  const comicPage = useRef(null);
  const desktopEditor = useMemo(() => ({
    share(items, readComicPage) { setGenerated(items); comicPage.current = readComicPage; },
    open(request) { setIncoming(request); open('editor'); },
  }), [open]);
  const travel = delta => {
    const id = history.items[history.at + delta];
    if (id) { setTabs(all => all.includes(id) ? all : [...all,id]); setHistory(h => ({ ...h, at: h.at + delta })); }
  };
  const closeTab = id => {
    if ((id === ID.AI_PAINTING || id === 'editor' || (id === 'settings' && settingsDirty)) && !window.confirm(t('main.unsavedWarning'))) return;
    const rest = tabs.filter(k => k !== id);
    setTabs(rest.length ? rest : ['home']);
    if (active === id) open(rest.at(-1) || 'home');
    if (id === 'settings') setSettingsDirty(false);
    if (id === ID.AI_PAINTING) { setGenerated([]); comicPage.current = null; }
  };
  useEffect(() => {
    let live = true;
    api.getSession().then(session => {
      if (!live) return;
      if (!local && !session.authenticated) { setStartupError(zh ? '会话已结束，请重新登录。' : 'Your session has ended. Sign in again.'); return; }
      setAccount(session.account_snapshot || null); setInitialized(true);
    }).catch(err => { if (live) setStartupError(err.code || 'LOCAL_SERVICE_UNAVAILABLE'); });
    return () => { live = false; };
  }, [local, zh]);
  useEffect(() => {
    let live = true;
    fetch('/api/desktop/web-access').then(r => r.json()).then(r => { if (live) setWebEnabled(r.enabled); }).catch(() => {});
    const changed = e => setWebEnabled(e.detail);
    window.addEventListener('novelai:web-access', changed);
    return () => { live = false; window.removeEventListener('novelai:web-access', changed); };
  }, []);
  useEffect(() => { if (initialized || startupError) native('ready'); }, [initialized, startupError]);
  useEffect(() => {
    const requested = e => {
      const id = e.detail;
      if (id === ID.AI_PAINTING) {
        const raw = sessionStorage.getItem('novelai:pending-image-processing');
        if (raw) {
          sessionStorage.removeItem('novelai:pending-image-processing'); setIncoming(JSON.parse(raw)); open('editor');
        } else if (!local) open(id);
        else setNotice(zh ? '已保存到绘画草稿。登录 NovelAI 后可继续创作。' : 'Saved to your painting draft. Sign in to continue.');
      } else if (toolIcons[id]) open(id);
    };
    const accountUpdated = e => { if (e.detail) setAccount(e.detail); };
    window.addEventListener('novelai:open-page', requested);
    window.addEventListener('novelai:account-updated', accountUpdated);
    return () => { window.removeEventListener('novelai:open-page', requested); window.removeEventListener('novelai:account-updated', accountUpdated); };
  }, [local, open, zh]);
  useEffect(() => {
    function shortcuts(e) {
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); open('settings'); }
      if (e.altKey && e.key === 'ArrowLeft' && history.at > 0) { e.preventDefault(); travel(-1); }
      if (e.altKey && e.key === 'ArrowRight' && history.at + 1 < history.items.length) { e.preventDefault(); travel(1); }
    }
    window.addEventListener('keydown', shortcuts); return () => window.removeEventListener('keydown', shortcuts);
  });
  useEffect(() => {
    const warn = e => { if (tabs.includes(ID.AI_PAINTING) || settingsDirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tabs, settingsDirty]);

  const ids = ['home', ...(local ? [] : [ID.AI_PAINTING]), ID.LOCAL_GALLERY, ID.REFERENCE_GALLERY,
    'editor', ID.IMAGE_TAGGING, ID.LOCAL_UPSCALING];
  const paintModes = (selected, change) => modeHost && createPortal(
    [['generation', Picture, t('painting.workspace.tabs.generation')], ['inpaint', Paintbrush, t('painting.workspace.tabs.inpaint')],
      ['comic', PanelsTopLeft, zh ? '漫画制作' : 'Comic maker']].map(([id, Icon, label]) =>
      <ToolButton key={id} label={label} aria-pressed={selected === id} onClick={() => change(id)}><Icon size={17}/></ToolButton>), modeHost);
  const pages = Object.values(ID).map(id => ({ id, labelKey: labelKeys[id], title: labels[id], color: readPageColor(localStorage, id) }));
  const signIn = () => native('auth');
  const logout = async () => {
    const clean = window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    if (!clean && !window.confirm(t('main.unsavedWarning'))) return;
    await api.logout(); native('signed-out');
  };
  function tool(id) {
    const isActive = id === active;
    if (id === 'home') return <Home local={local} active={isActive} labels={labels} open={open} />;
    if (id === ID.AI_PAINTING) return <Painting active={isActive} accountSnapshot={account} userId={account?.information?.email || ''}
      workContext={work} onWorkContextChange={setWork} renderModeTools={paintModes} desktopEditor={desktopEditor}/>;
    if (id === ID.LOCAL_GALLERY || id === ID.REFERENCE_GALLERY) return <Gallery source={id === ID.LOCAL_GALLERY ? 'outputs' : 'references'}
      workContext={work} onWorkContextChange={setWork}/>;
    if (id === 'editor') return <ImageEditor active={isActive} generatedItems={generated} galleryRequest={incoming}
      onGalleryRequestHandled={() => setIncoming(null)} getCurrentComicPage={() => comicPage.current?.()}/>;
    if (id === 'settings') return <Settings active={isActive} pages={pages} chooseDirectory={chooseDirectory} onDirtyChange={setSettingsDirty}
      desktopPreferences={<div className="desktop-prefs">
        <h1>{t('desktop.application')}</h1>
        <section><h2>{t('desktop.webAccess')}</h2><DesktopWebAccess inline /></section>
        <section className="app-version"><img src="/logo.png" alt="" /><div><b>NovelAI Local</b><small>Windows x64 · 1.1.0</small></div></section>
      </div>}/>;
    return <Inference kind={id === ID.IMAGE_TAGGING ? 'tagger' : 'upscale'} active={isActive}/>;
  }
  return <div className="studio-frame">
    <TitleBar title={local ? (zh ? '本机工具' : 'Local tools') : labels[active]} onRail={() => setRail(v => !v)}
      back={history.at > 0 ? () => travel(-1) : undefined} forward={history.at < history.items.length - 1 ? () => travel(1) : undefined}>
      <ToolButton label={labels.settings} onClick={() => open('settings')}><Settings2/></ToolButton>
      <ToolButton label={local ? t('login.login') : t('main.accountInfo')} onClick={local ? signIn : () => setAccountOpen(true)}>{local ? <LogIn/> : <UserRound/>}</ToolButton>
    </TitleBar>
    <div className="studio-body">
      <nav className="studio-rail" hidden={!rail} aria-label={t('main.navigation')}>
        <div className="rail-modules">{ids.map(id => {
          const Icon = toolIcons[id];
          return <div key={id}><ToolButton label={labels[id]} aria-current={active === id ? 'page' : undefined}
            onClick={() => open(id)}><Icon/></ToolButton>
            {id === ID.AI_PAINTING && <div className="paint-modes" hidden={active !== id} ref={setModeHost}/>}</div>;
        })}</div>
        <div className="rail-bottom"><ToolButton label={zh ? '切换明暗主题' : 'Toggle theme'} onClick={toggleTheme}>{mode === 'dark' ? <Sun/> : <Moon/>}</ToolButton>
          <ToolButton label={labels.settings} aria-current={active === 'settings' ? 'page' : undefined} onClick={() => open('settings')}><SlidersHorizontal/></ToolButton></div>
      </nav>
      <div className="studio-desk">
        <div className="doc-tabs" role="tablist">{tabs.map(id => { const Icon = toolIcons[id];
          return <div className="doc-tab" data-active={id === active} key={id}>
            <button role="tab" aria-selected={id === active} onClick={() => open(id)}><Icon size={15}/>{labels[id]}</button>
            {id !== 'home' && <ToolButton label={(zh ? '关闭 ' : 'Close ') + labels[id]} onClick={() => closeTab(id)}><X size={13}/></ToolButton>}
          </div>;
        })}</div>
        {startupError ? <Alert severity="error">{startupError} <button onClick={() => location.reload()}>{t('common.retry')}</button> <button onClick={signIn}>{t('login.login')}</button></Alert>
          : initialized && tabs.map(id => <section className="studio-canvas" key={id} hidden={id !== active} role="tabpanel" aria-label={labels[id]}>
            <Suspense fallback={<div className="studio-loading"><CircularProgress size={24}/></div>}>{tool(id)}</Suspense>
          </section>)}
        <footer className="studio-status"><span><i data-connected={initialized}/>{initialized ? (zh ? '本地服务已连接' : 'Local service connected') : (startupError || (zh ? '正在连接…' : 'Connecting…'))}</span><span><Monitor size={12}/>{webEnabled == null ? 'Windows' : webEnabled ? t('desktop.webOn') : t('desktop.webOff')}</span></footer>
      </div>
    </div>
    {accountOpen && <Suspense fallback={null}><Account open onClose={() => setAccountOpen(false)} accountSnapshot={account} onAccountSnapshot={setAccount} onLogout={logout}/></Suspense>}
    <Snackbar open={Boolean(notice)} autoHideDuration={5000} onClose={() => setNotice('')} message={notice} action={<ToolButton label={t('login.login')} onClick={signIn}><ArrowRight/></ToolButton>}/>
  </div>;
}
