"use client";

import { createClientId } from '@/utils/browserCapabilities.mjs';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, Tab, Tabs, TextField, Typography, useTheme } from '@mui/material';
import { alpha, darken, lighten } from '@mui/material/styles';
import { UploadFile } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';
import apiClient from '@/utils/ApiClient';
import { loadComicLibrary } from '../ComicWorkspace/comicStorage.mjs';
import { readComicProject } from '../ComicWorkspace/comicProject.mjs';
import { loadComicFonts } from '../ComicWorkspace/comicElements.mjs';
import ComicPageArt from '../ComicWorkspace/ComicPageArt';
import { comicPagesToDocuments } from './comicImport';
import Editor from './compositor/components/Editor';
import './compositor/editor.css';

const messages = {
  'zh-CN': {
    gallery: '从画廊导入', comics: '导入漫画项目', session: '本次生成', outputs: '本地图库', references: '参考图库',
    sessionSearch: '搜索提示词或编号', emptySession: '本次会话还没有生成图像', generatedImage: '生成图像',
    untitled: '未命名',
    search: '搜索标题或文件名', emptyGallery: '此画廊还没有图像', emptyComics: '还没有漫画页面',
    cancel: '取消', import: '导入所选', all: '全部选择', file: '打开漫画项目文件',
    current: '当前编辑页', pages: '页', comicError: '漫画项目读取失败', importing: '正在导入…',
  },
  'en-US': {
    gallery: 'Import from gallery', comics: 'Import comic project', session: 'This session', outputs: 'Local gallery', references: 'Reference gallery',
    sessionSearch: 'Search prompts or IDs', emptySession: 'No images generated in this session', generatedImage: 'Generated image',
    untitled: 'Untitled',
    search: 'Search titles or filenames', emptyGallery: 'No images in this gallery', emptyComics: 'No comic pages yet',
    cancel: 'Cancel', import: 'Import selected', all: 'Select all', file: 'Open comic project file',
    current: 'Current page', pages: 'pages', comicError: 'Unable to read the comic project', importing: 'Importing…',
  },
};

/**
 * 把本地磁盘图库、漫画项目和站点主题接入图像编辑器。
 * @param {object} props 当前可见状态、本次生成图像、图像导入请求和漫画当前页读取方法。
 * @returns {React.ReactElement} 图像处理工作区和素材选择窗口。
 */
export default function ImageProcessingWorkspace({ active, generatedItems, galleryRequest, onGalleryRequestHandled, getCurrentComicPage }) {
  const { locale, t } = useI18n();
  const theme = useTheme();
  const text = messages[locale];
  const [picker, setPicker] = useState(null);
  const [gallery, setGallery] = useState({ entries: [], hasMore: false });
  const [source, setSource] = useState('session');
  const [query, setQuery] = useState('');
  const [comicPages, setComicPages] = useState([]);
  const [currentPageId, setCurrentPageId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importRequest, setImportRequest] = useState(null);
  const projectInput = useRef(null);
  const handledGalleryRequest = useRef(null);

  useEffect(() => {
    if (!galleryRequest || handledGalleryRequest.current === galleryRequest.id) return;
    handledGalleryRequest.current = galleryRequest.id;
    setBusy(true);
    setError('');
    (async () => {
      try {
        if (galleryRequest.generatedItem) {
          const item = galleryRequest.generatedItem;
          const blob = item.cachedBlob || await fetchUrlAsBlob(item.downloadSrc || item.originalSrc || item.src);
          const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
          setImportRequest({ id: galleryRequest.id, files: [new File([blob], `generated-${item.id}.${extension}`, { type: blob.type })] });
        } else {
          const entry = await apiClient.getGalleryEntry(galleryRequest.entryId);
          const blob = await fetchUrlAsBlob(entry.url);
          setImportRequest({ id: galleryRequest.id, files: [new File([blob], entry.filename, { type: blob.type })] });
        }
      } catch (failure) {
        setError(t('painting.workspace.errors.imageProcessingFailed'));
        setBusy(false);
      } finally {
        onGalleryRequestHandled();
      }
    })();
  }, [galleryRequest, onGalleryRequestHandled, t]);

  useEffect(() => {
    if (picker !== 'gallery' || source === 'session') return;
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await apiClient.getGallery({ source, offset: 0, limit: 60, q: query.trim(), trash: false });
        if (cancelled) return;
        setGallery({ entries: result.items, hasMore: result.has_more });
        setSelected([]);
        setError(result.errors?.length ? t('gallery.scanErrors', { count: result.errors.length }) : '');
      } catch {
        if (!cancelled) setError(t('painting.workspace.errors.imageProcessingFailed'));
      } finally { if (!cancelled) setBusy(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [picker, source, query, t]);

  const openPicker = async (kind, gallerySource = 'session') => {
    setPicker(kind);
    setSelected([]);
    setQuery('');
    setError('');
    setBusy(true);
    try {
      if (kind === 'gallery') {
        setSource(gallerySource);
        if (gallerySource !== 'session') {
          setGallery({ entries: [], hasMore: false });
        }
      } else {
        const library = await loadComicLibrary();
        const current = getCurrentComicPage() || library.draft;
        const pages = library.pages.map((page) => page.id === current?.id ? current : page);
        if (current && !pages.some((page) => page.id === current.id)) pages.push(current);
        await loadComicFonts(pages.flatMap((page) => page.fonts));
        setComicPages(pages);
        setCurrentPageId(current?.id);
        if (current) setSelected([current.id]);
      }
    } catch (failure) {
      setError(kind === 'gallery' ? t('painting.workspace.errors.imageProcessingFailed') : `${text.comicError}: ${failure.message}`);
    } finally { setBusy(false); }
  };

  const importSelected = async () => {
    setBusy(true);
    setError('');
    try {
      const id = createClientId();
      if (picker === 'gallery') {
        const files = await Promise.all(sourceEntries.filter((entry) => selected.includes(entry.id)).map(async (entry) => {
          const blob = source === 'session'
            ? entry.cachedBlob || await fetchUrlAsBlob(entry.downloadSrc || entry.originalSrc || entry.src)
            : await fetchUrlAsBlob((await apiClient.getGalleryEntry(entry.id)).url);
          const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
          const filename = source === 'session' ? `generated-${entry.id}.${extension}` : entry.filename;
          return new File([blob], filename, { type: blob.type });
        }));
        setImportRequest({ id, files });
      } else {
        const documents = await comicPagesToDocuments(comicPages.filter((page) => selected.includes(page.id)), locale === 'zh-CN' ? 'zh' : 'en');
        setImportRequest({ id, documents });
      }
      setPicker(null);
    } catch (failure) {
      setError(picker === 'gallery'
        ? t('painting.workspace.errors.imageProcessingFailed')
        : `${text.comicError}: ${failure.message}`);
      setBusy(false);
    }
  };

  const sourceEntries = source === 'session' ? generatedItems.filter((item) => item.type !== 'video') : gallery.entries.filter((entry) => entry.source === source);
  const visibleEntries = source === 'session' ? sourceEntries.filter((entry) => `${entry.title || ''} ${entry.filename || ''} ${entry.prompt || ''} ${entry.id}`.toLowerCase().includes(query.toLowerCase())) : sourceEntries;
  const toggleSelected = (id) => setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);

  return <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {error && !picker && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    <Box className="image-processing-editor" data-drop-zone style={{
      colorScheme: theme.palette.mode,
      '--bg': theme.palette.background.default,
      '--panel': theme.palette.background.paper,
      '--panel-raised': theme.palette.mode === 'dark' ? lighten(theme.palette.background.paper, 0.04) : darken(theme.palette.background.paper, 0.03),
      '--border': theme.palette.divider,
      '--text': theme.palette.text.primary,
      '--muted': theme.palette.text.secondary,
      '--faint': theme.palette.text.disabled,
      '--accent': theme.palette.primary.main,
      '--accent-dark': alpha(theme.palette.primary.main, 0.16),
      '--accent-contrast': theme.palette.primary.contrastText,
      '--blue': theme.palette.info.main,
      '--error': theme.palette.error.main,
      '--warning': theme.palette.warning.main,
      '--success': theme.palette.success.main,
      '--radius': '6px',
    }}>
      <Editor active={active && !picker} locale={locale} importRequest={importRequest}
        onImportComplete={() => { setImportRequest(null); setBusy(false); }}
        onOpenGallery={() => openPicker('gallery')} onOpenComic={() => openPicker('comic')} />
    </Box>
    <input ref={projectInput} hidden type="file" accept=".zip,.comic" onChange={async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      setBusy(true); setError('');
      try {
        const project = await readComicProject(file);
        await loadComicFonts(project.pages.flatMap((page) => page.fonts));
        setComicPages(project.pages);
        setCurrentPageId(null);
        setSelected([project.activePageId]);
        setPicker('comic');
      } catch (failure) {
        setError(`${text.comicError}: ${failure.message}`);
      } finally { setBusy(false); }
    }} />
    <Dialog open={Boolean(picker)} onClose={() => { if (!busy) setPicker(null); }} fullWidth maxWidth="md">
      <DialogTitle>{picker === 'gallery' ? text.gallery : text.comics}</DialogTitle>
      <DialogContent dividers sx={{ minHeight: 240 }}>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {picker === 'gallery' && <>
          <Tabs value={source} onChange={(_, value) => openPicker('gallery', value)} variant="scrollable" scrollButtons="auto">
            <Tab value="session" label={text.session} disabled={busy} /><Tab value="outputs" label={text.outputs} disabled={busy} /><Tab value="references" label={text.references} disabled={busy} />
          </Tabs>
          <TextField size="small" fullWidth label={source === 'session' ? text.sessionSearch : text.search} value={query} onChange={(event) => setQuery(event.target.value)} sx={{ my: 2 }} />
        </>}
        {busy ? <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}><CircularProgress size={28} aria-label={text.importing} /></Box>
          : picker === 'gallery' ? <>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1 }}>
              {visibleEntries.map((entry, index) => <ButtonBase key={entry.id} onClick={() => toggleSelected(entry.id)} aria-label={entry.title || entry.filename || `${text.generatedImage} ${index + 1}`} aria-pressed={selected.includes(entry.id)} sx={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, border: 2, borderColor: selected.includes(entry.id) ? 'primary.main' : 'divider', borderRadius: 1.5, overflow: 'hidden', '& img': { height: 140, objectFit: 'contain' } }}>
                {source === 'session'
                  ? <Box component="img" src={entry.src} alt={entry.prompt || ''} sx={{ display: 'block', width: '100%', bgcolor: 'action.hover' }} />
                  : <Box component="img" src={entry.thumbnail_url} alt={entry.title || entry.filename} loading="lazy" sx={{ display: 'block', width: '100%', bgcolor: 'action.hover' }} />}
                <Typography variant="caption" noWrap sx={{ p: 0.5, width: '100%' }}>{entry.title || entry.filename || entry.prompt || `${text.generatedImage} ${index + 1}`}</Typography>
                <Checkbox component="span" checked={selected.includes(entry.id)} slotProps={{ input: { tabIndex: -1, 'aria-hidden': true, readOnly: true } }} disableRipple sx={{ position: 'absolute', right: 0, top: 0, pointerEvents: 'none' }} />
              </ButtonBase>)}
            </Box>
            {source !== 'session' && gallery.hasMore && <Button onClick={async () => {
              setBusy(true); setError('');
              try {
                const result = await apiClient.getGallery({ source, offset: gallery.entries.length, limit: 60, q: query.trim(), trash: false });
                setGallery((current) => ({ entries: [...current.entries, ...result.items], hasMore: result.has_more }));
              } catch { setError(t('painting.workspace.errors.imageProcessingFailed')); }
              finally { setBusy(false); }
            }}>{t('gallery.loadMore')}</Button>}
            {!visibleEntries.length && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{source === 'session' ? text.emptySession : text.emptyGallery}</Typography>}
          </> : <>
            <List disablePadding sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1.5 }}>{comicPages.map((page, index) => {
              const title = `${String(index + 1).padStart(2, '0')} · ${page.title || text.untitled}`;
              return <ListItemButton key={page.id} selected={selected.includes(page.id)} onClick={() => toggleSelected(page.id)} aria-label={title} aria-pressed={selected.includes(page.id)} sx={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0, p: 0, overflow: 'hidden', border: 2, borderColor: selected.includes(page.id) ? 'primary.main' : 'divider', borderRadius: 1.5 }}>
              <Box component="svg" viewBox={`0 0 ${page.width} ${page.height}`} aria-hidden="true" sx={{ display: 'block', width: '100%', height: 180, bgcolor: 'action.hover' }}>
                <ComicPageArt page={page} prefix={`image-processing-preview-${page.id}`} />
              </Box>
              <ListItemText primary={title} secondary={`${page.width} × ${page.height}${page.id === currentPageId ? ` · ${text.current}` : ''}`} sx={{ mx: 1, my: 0.75, '& .MuiListItemText-primary': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }} />
              <Checkbox component="span" checked={selected.includes(page.id)} slotProps={{ input: { tabIndex: -1, 'aria-hidden': true, readOnly: true } }} disableRipple sx={{ position: 'absolute', right: 0, top: 0, pointerEvents: 'none' }} />
            </ListItemButton>;
            })}</List>
            {!comicPages.length && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{text.emptyComics}</Typography>}
          </>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {picker === 'comic' && <Button startIcon={<UploadFile />} disabled={busy} onClick={() => projectInput.current.click()}>{text.file}</Button>}
        <Button disabled={busy} onClick={() => setSelected((picker === 'gallery' ? visibleEntries : comicPages).map((entry) => entry.id))}>{picker === 'gallery' && source !== 'session' ? t('gallery.selectLoaded') : text.all}</Button>
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={() => setPicker(null)}>{text.cancel}</Button>
        <Button variant="contained" disabled={busy || !selected.length} onClick={importSelected}>{text.import}{selected.length ? ` (${selected.length})` : ''}</Button>
      </DialogActions>
    </Dialog>
  </Box>;
}
