"use client";

import { createClientId } from '@/utils/browserCapabilities.mjs';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, IconButton, Menu, MenuItem, Paper, Snackbar, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Add, ArrowBack, ArrowDownward, ArrowForward, ArrowUpward, BrushOutlined, Check, Close, ContentCopy, ContentCut, CropFree, DashboardOutlined, DeleteOutline, Download, Flip, ImageOutlined, LayersOutlined, Menu as MenuIcon, MouseOutlined, PanToolOutlined, PlayArrow, Redo, SaveOutlined, SettingsOutlined, TextFields, Undo, UploadFile, ZoomIn, ChatBubbleOutline, AutoAwesome } from '@mui/icons-material';
import { Eraser } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { downloadBlobToFile, fetchUrlAsBlob } from '@/utils/mediaAssets';
import comicClient from '@/utils/ApiClient';
import { COMIC_LAYOUTS, COMIC_TEMPLATES, applyTemplate, comicContentBounds, convertPanelType, createComicPage, createComicTemplate, createRectanglePanel, fitPanelImage, getComicLayoutSize, isComicPanelInterior, movePanel, movePanelEdge, movePanelVertex, panelBounds, placeComicPanelBadge, resizeComicPage, rotatePanel, sectionBounds, splitPanelAlongPath, transformPanelImage } from './comicDocument.mjs';
import { comicCutIntersections, snapComicCutPoint, snapPanelAngle, snapPanelDrag } from './comicSnapping.mjs';
import { deleteComicPage, deleteComicTemplate, exportComicZip, importComicProject, loadComicLibrary, saveComicCanvasDefaults, saveComicDraft, saveComicPage, saveComicTemplate } from './comicStorage.mjs';
import { exportComicProject, readComicProject } from './comicProject.mjs';
import ComicCropDialog from './ComicCropDialog';
import ComicElementArt from './ComicElementArt';
import PageArt from './ComicPageArt';
import ComicElementDialog from './ComicElementDialog';
import ComicLayerPanel from './ComicLayerPanel';
import ComicAIStudio from './ComicAIStudio';
import { ComicProviderControl } from './ComicLLMSettings';
import { applyComicAIImage, clampPointToComicFrame, comicAIControlPosition, comicAISectionFingerprint } from './comicAI.mjs';
import { buildComicLetteringElements } from './comicLettering.mjs';
import { COMIC_BALLOON_PRESETS, comicElementMatrix, createComicElement, loadComicFonts, readComicAsset } from './comicElements.mjs';
import { ensureComicLayers, getComicRenderItems, reorderComicItem } from './comicLayers.mjs';
import messages from './comicMessages';
import { normalizeNovelAICharacterCenter } from '../utils/novelAIV5Params.mjs';
import LockableSlider from '@/components/muiWrappers/LockableSlider';

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M25 13a10 10 0 1 0 1 8M25 5v8h-8" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 13a10 10 0 1 0 1 8M25 5v8h-8" fill="none" stroke="#222" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')}") 16 16, grab`;

const polygonPoints = (points) => points.map(({ x, y }) => `${x},${y}`).join(' ');

function isCutEnd(start, hit, minimumDistance) {
  return start && hit && hit.panelId === start.panelId && (start.corners.length || hit.edgeIndex !== start.edgeIndex)
    && Math.hypot(hit.point.x - start.point.x, hit.point.y - start.point.y) > minimumDistance;
}

/** 工具和操作共用图标按钮：手机只显示图标，名称与快捷键保留在提示和无障碍标签中。 */
function ComicButton({ label, icon: Icon, shortcut, tip, sx, ...props }) {
  return <Tooltip disableInteractive title={`${tip || label}${shortcut ? ` (${shortcut})` : ''}`}>
    <span style={{ display: 'inline-flex' }}><Button {...props} aria-label={label} data-action-label={label} size="small" startIcon={<Icon />} sx={{ minWidth: { xs: 34, md: 0 }, minHeight: { xs: 34, md: 27 }, px: 0.8, py: 0.4, fontSize: 11, '& .MuiButton-startIcon': { mr: { xs: 0, md: 0.7 }, ml: 0 }, '& .MuiButton-startIcon > svg': { width: 18, height: 18 }, ...sx }}><Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>{label}</Box></Button></span>
  </Tooltip>;
}

/** 画框和文字组件共用独立旋转手柄，命中区不再覆盖缩放角点。 */
function ComicRotationHandle({ x: positionX, y: positionY, scale, color, label, touch, ...props }) {
  return <g {...props} data-handle="rotate" transform={`translate(${positionX} ${positionY}) scale(${scale})`} style={{ cursor: ROTATE_CURSOR }}>
    <title>{label}</title><circle r={touch ? 20 : 13} fill="transparent" />
    <g pointerEvents="none"><circle r={9} fill="white" stroke={color} strokeWidth={1.5} /><path d="M4 -3A5 5 0 1 0 5 2M4 -6V-2H0" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></g>
  </g>;
}

/** 将上传和画廊原图读为可持久保存的图片，保留 PNG/WebP 透明通道。 */
async function readImage(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
  const image = new Image(); image.src = dataUrl; await image.decode();
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
}

/** AI 制作和手动编排复用同一画布；公开示例在内存中编辑，不读写个人漫画库。 */
const ComicWorkspace = forwardRef(function ComicWorkspace({ generatedItems = [], onSelectTask, onPanelBoundsChange, manualEditor, onParameterToolbarChange, onEditTask, onSaveTask, onGenerate, onGenerateAll, onStopSequence, generatingSequence, generationAction, generationVerification, active = true, androidLayout = false, directorEnabled = true, directorImageModels = [], onDirectorBusyChange, characterPlacement = null }, ref) {
  const { locale } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const compactAndroid = androidLayout && isMobile;
  const shortViewport = useMediaQuery('(min-width: 600px) and (max-height: 500px)');
  const c = messages[locale];
  const textRef = useRef(c); textRef.current = c;
  const language = locale === 'zh-CN' ? 'zh' : 'en';
  const [page, setPage] = useState(null);
  const pageRef = useRef(null);
  const [pages, setPages] = useState([]);
  const pagesRef = useRef([]);
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [selectedStrokeId, setSelectedStrokeId] = useState(null);
  const [activeLayerId, setActiveLayerId] = useState('panels');
  const [layersOpen, setLayersOpen] = useState(false);
  const [creationMode, setMode] = useState('ai');
  const mode = directorEnabled ? creationMode : 'manual';
  const [dockCollapsed, setDockCollapsed] = useState(compactAndroid);
  const aiDockOpen = mode === 'ai' && !dockCollapsed;
  const [directorBusy, setDirectorBusy] = useState(false);
  const [canvasActions, setCanvasActions] = useState(null);
  const [selectedControl, setSelectedControl] = useState(null);
  const controlDrag = useRef(null);
  // 拖动中的角色圆点只在画布内实时移动，松手后才写回参数面板，避免每帧重绘整个绘图页。
  const [characterDrag, setCharacterDrag] = useState(null);
  const characterDragRef = useRef(null);
  const placementCharacters = characterPlacement?.characters;
  const [accountId, setAccountId] = useState('');
  const [llmSettings, setLLMSettings] = useState(null);
  const deletingPages = useRef(new Set());
  const w = (zh, en) => language === 'zh' ? zh : en;
  const [toolsOpen, setToolsOpen] = useState(false);
  const [balloonPicker, setBalloonPicker] = useState(false);
  const [elementEditorId, setElementEditorId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const selectedIdRef = useRef(null); selectedIdRef.current = selectedId;
  const [section, setSection] = useState(0);
  const [tool, setTool] = useState('select');
  const [templateTab, setTemplateTab] = useState(0);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [gutter, setGutter] = useState(14);
  const [brushSize, setBrushSize] = useState(5);
  const [cut, setCut] = useState(null);
  const [cutHover, setCutHover] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [rectangle, setRectangle] = useState(null);
  const [cropId, setCropId] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [galleryTab, setGalleryTab] = useState(0);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [canvasDimensions, setCanvasDimensions] = useState(null);
  const [canvasDefaults, setCanvasDefaults] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view); viewRef.current = view;
  const zoom = view.zoom;
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 420, viewportWidth: 0, viewportHeight: 0 });
  const [pagesOpen, setPagesOpen] = useState(false);
  useEffect(() => {
    if (!compactAndroid || !active || (!pagesOpen && dockCollapsed)) return;
    const back = (event) => {
      if (event.defaultPrevented || (event.detail && !event.detail.hasAttribute('data-comic-dock'))) return;
      event.preventDefault();
      if (pagesOpen) setPagesOpen(false);
      else setDockCollapsed(true);
    };
    window.addEventListener('mobile-back', back);
    return () => window.removeEventListener('mobile-back', back);
  }, [compactAndroid, active, pagesOpen, dockCollapsed]);
  const [lastAction, setLastAction] = useState('');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef({ undo: [], redo: [] });
  const svg = useRef(null);
  const viewport = useRef(null);
  const viewDrag = useRef(null);
  const keyboardActions = useRef(null);
  const drag = useRef(null);
  const touchPoints = useRef(new Map());
  const dragFrame = useRef(null);
  const pendingDrag = useRef(null);
  const [snapGuides, setSnapGuides] = useState([]);
  const [dragCursor, setDragCursor] = useState(null);
  const [rotationLabel, setRotationLabel] = useState(null);
  const upload = useRef(null);
  const uploadTarget = useRef(null);
  const elementUpload = useRef(null);
  const projectUpload = useRef(null);
  const elementUploadKind = useRef('bubble');
  const callbacks = useRef({ onSelectTask }); callbacks.current = { onSelectTask };
  const selected = page?.panels.find((panel) => panel.id === selectedId);
  const selectedElement = page?.elements.find((element) => element.id === selectedElementId);
  const selectedStroke = page?.strokes.find((stroke) => stroke.id === selectedStrokeId);
  const editingElement = page?.elements.find((element) => element.id === elementEditorId);
  const selectedItem = selected ? { kind: 'panel', id: selected.id } : selectedElement ? { kind: 'element', id: selectedElement.id } : selectedStroke ? { kind: 'stroke', id: selectedStroke.id } : null;
  const cropPanel = page?.panels.find((panel) => panel.id === cropId);
  const selectedNumber = selected ? page.panels.indexOf(selected) + 1 : 0;
  const target = selected ? { pageId: page.id, panelId: selected.id, panelNumber: selectedNumber } : null;
  const overlayLabel = language === 'zh' ? '叠加画框' : 'Overlay frame';
  const regularLabel = language === 'zh' ? '普通画框' : 'Regular frame';
  const pageWidth = page?.width, pageHeight = page?.height;
  const hasPage = Boolean(page);
  const panels = page?.panels;
  const panelBadges = useMemo(() => new Map(panels?.map((panel, index) => {
    const number = index + 1;
    const width = Math.max(29, String(number).length * 11 + 10);
    return [panel.id, { number, width, position: placeComicPanelBadge(panel, width, 26) }];
  })), [panels]);

  useEffect(() => () => cancelAnimationFrame(dragFrame.current), []);

  useEffect(() => { if (compactAndroid) setDockCollapsed(true); }, [compactAndroid]);

  useEffect(() => {
    const flush = (event) => { if (pageRef.current) event.detail.waitUntil(saveComicDraft(pageRef.current)); };
    window.addEventListener('desktop-flush-before-update', flush);
    return () => window.removeEventListener('desktop-flush-before-update', flush);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let current = true;
    comicClient.request('/comic/llm-settings').then((result) => {
      if (current) setLLMSettings(result.settings);
    }).catch(() => { if (current) setLLMSettings(null); });
    return () => { current = false; };
  }, [active]);

  useEffect(() => {
    let mounted = true;
    loadComicLibrary().then((library) => {
      if (!mounted) return;
      pagesRef.current = library.pages; setPages(library.pages); setTemplates(library.templates);
      const draft = ensureComicLayers(library.draft || createComicPage('portrait', 'blank', getComicLayoutSize('portrait', library.canvasDefaults))); pageRef.current = draft; setPage(draft); setActiveLayerId(draft.layers[0].id);
      setCanvasDefaults(library.canvasDefaults);
      setDirty(Boolean(library.draft)); setStorageReady(true);
    }).catch(() => { if (mounted) { setNotice({ severity: 'error', text: textRef.current.storageError }); const draft = createComicPage(); pageRef.current = draft; setPage(draft); } });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (page?.fonts.length) loadComicFonts(page.fonts).catch(() => setNotice({ severity: 'error', text: c.fontError }));
  }, [page?.fonts, c.fontError]);

  useEffect(() => {
    if (!active) return;
    const current = pageRef.current;
    const panel = current?.panels.find((item) => item.id === selectedIdRef.current);
    if (panel) callbacks.current.onSelectTask?.({ pageId: current.id, panelId: panel.id, panelNumber: current.panels.indexOf(panel) + 1 }, panel.task?.params || null);
  }, [active]);

  useEffect(() => {
    if (!page || !storageReady) return;
    const timer = setTimeout(() => { saveComicDraft(page).catch(() => setNotice({ severity: 'error', text: c.storageError })); }, 500);
    return () => clearTimeout(timer);
  }, [page, storageReady, c.storageError]);

  useEffect(() => {
    if (!active || !pageWidth || !viewport.current) return;
    const element = viewport.current;
    let resizeFrame = 0;
    const resize = () => {
      // 低矮横屏缩小桌面留白，避免“适应画布”后整页被压成几个像素。
      const inset = compactAndroid ? (shortViewport ? 24 : 32) : 64;
      const viewportWidth = element.clientWidth;
      const viewportHeight = element.clientHeight;
      const ratio = Math.min(Math.max(1, viewportWidth - inset) / pageWidth, Math.max(1, viewportHeight - inset) / pageHeight);
      const width = pageWidth * ratio, height = pageHeight * ratio;
      setCanvasSize((current) => current.width === width && current.height === height
        && current.viewportWidth === viewportWidth && current.viewportHeight === viewportHeight
        ? current : { width, height, viewportWidth, viewportHeight });
    };
    // 切页、展开侧栏会同时改变容器和画布尺寸，延后一帧更新避免在观察回调内反复触发布局。
    const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); });
    observer.observe(element); resize();
    return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame); };
  }, [pageWidth, pageHeight, active, compactAndroid, shortViewport]);

  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); setSelectedControl(null); }, [page?.id, page?.layout]);
  useEffect(() => { onPanelBoundsChange?.(selected ? panelBounds(selected) : null); }, [selected, onPanelBoundsChange]);
  // 参数面板收到松手位置后，圆点改由最新角色数据显示；切换画框时放弃未完成的拖动。
  useEffect(() => {
    if (characterDragRef.current?.pointerId !== null) return;
    characterDragRef.current = null; setCharacterDrag(null);
  }, [placementCharacters]);
  useEffect(() => { characterDragRef.current = null; setCharacterDrag(null); }, [selectedId]);

  useEffect(() => {
    if (!active) return;
    const keyDown = (event) => keyboardActions.current?.(event);
    const release = (event) => { if (event.type === 'blur' || event.code === 'Space') setSpaceHeld(false); };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', release, true); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', release, true); window.removeEventListener('blur', release); };
  }, [active]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !active) return;
    const wheel = (event) => {
      if (isMobile && !(event.ctrlKey || event.metaKey || tool === 'zoom')) return;
      event.preventDefault();
      changeZoom(viewRef.current.zoom * Math.exp(-event.deltaY * 0.002), event);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [active, tool, hasPage, isMobile]);

  function replacePage(next, record = true) {
    if (record && pageRef.current) {
      // 异步回填期间不把尚未松手的中间坐标记录为一次可撤销操作。
      history.current.undo.push(drag.current ? pageBeforeDrag(drag.current) : pageRef.current); history.current.undo = history.current.undo.slice(-30); history.current.redo = [];
      setHistoryVersion((value) => value + 1);
    }
    const normalized = ensureComicLayers(next);
    pageRef.current = normalized; setPage(normalized); setDirty(true);
  }
  function choose(panel, nextPage = pageRef.current, options) {
    setSelectedElementId(null);
    setSelectedStrokeId(null);
    setSelectedId(panel?.id || null);
    if (panel?.layerId) setActiveLayerId(panel.layerId);
    if (panel && panel.section >= 0) setSection(panel.section);
    callbacks.current.onSelectTask?.(panel ? { pageId: nextPage.id, panelId: panel.id, panelNumber: nextPage.panels.indexOf(panel) + 1 } : null, panel?.task?.params || null, options);
  }
  function chooseElement(element) {
    choose(null);
    setSelectedElementId(element?.id || null);
    if (element) setActiveLayerId(element.layerId);
  }
  function creationLayer(preferred) {
    const current = pageRef.current;
    const activeLayer = current.layers.find((layer) => layer.id === activeLayerId) || current.layers[0];
    const layer = activeLayer.kind === 'custom' ? activeLayer : current.layers.find((item) => item.kind === preferred) || activeLayer;
    if (layer.locked || !layer.visible) { setNotice({ severity: 'info', text: c.layerUnavailable }); return null; }
    return layer;
  }
  function insertElement(kind, bounds, options = {}) {
    const layer = creationLayer('dialogue'); if (!layer) return;
    const current = pageRef.current;
    const element = createComicElement(kind, bounds, { ...options, layerId: layer.id, order: Math.max(-1, ...getComicRenderItems(current).filter(({ item }) => item.layerId === layer.id).map(({ item }) => item.order)) + 1 });
    replacePage({ ...current, elements: [...current.elements, element] });
    chooseElement(element); setTool('select'); setElementEditorId(element.id); setBalloonPicker(false);
  }
  function updateElement(id, changes) {
    const current = pageRef.current;
    replacePage({ ...current, elements: current.elements.map((element) => element.id === id ? { ...element, ...changes } : element) });
  }
  function deleteSelection() {
    cancelDrag();
    const current = pageRef.current;
    if (selectedElement) { replacePage({ ...current, elements: current.elements.filter((element) => element.id !== selectedElement.id) }); chooseElement(null); }
    else if (selected) { replacePage({ ...current, panels: current.panels.filter((panel) => panel.id !== selected.id) }); choose(null); }
    else if (selectedStroke) { replacePage({ ...current, strokes: current.strokes.filter((stroke) => stroke.id !== selectedStroke.id) }); choose(null); }
  }
  function duplicateSelection() {
    const current = pageRef.current;
    if (selectedElement) {
      const copy = { ...structuredClone(selectedElement), id: createClientId(), x: selectedElement.x + 20, y: selectedElement.y + 20, order: Math.max(-1, ...getComicRenderItems(current).filter(({ item }) => item.layerId === selectedElement.layerId).map(({ item }) => item.order)) + 1 };
      replacePage({ ...current, elements: [...current.elements, copy] }); chooseElement(copy);
    } else if (selected) {
      const copy = movePanel({ ...structuredClone(selected), id: createClientId() }, { x: 20, y: 20 }, sectionBounds(current, selected.type === 'overlay' ? -1 : selected.section));
      copy.order = Math.max(-1, ...getComicRenderItems(current).filter(({ item }) => item.layerId === selected.layerId).map(({ item }) => item.order)) + 1;
      replacePage({ ...current, panels: [...current.panels, copy] }); choose(copy, pageRef.current);
    } else if (selectedStroke) {
      const copy = { ...structuredClone(selectedStroke), id: createClientId(), points: selectedStroke.points.map((point) => ({ x: point.x + 20, y: point.y + 20 })), order: Math.max(-1, ...getComicRenderItems(current).filter(({ item }) => item.layerId === selectedStroke.layerId).map(({ item }) => item.order)) + 1 };
      replacePage({ ...current, strokes: [...current.strokes, copy] }); setSelectedStrokeId(copy.id);
    }
  }
  function changeLayers(next) {
    replacePage(next);
    const selectedCollection = selected ? next.panels : selectedElement ? next.elements : next.strokes;
    const layer = next.layers.find((item) => item.id === selectedCollection.find((content) => content.id === selectedItem?.id)?.layerId);
    if (layer && (!layer.visible || layer.locked)) choose(null);
    if (cut) {
      const cuttingPanel = next.panels.find((panel) => panel.id === cut.panelId);
      const cuttingLayer = next.layers.find((item) => item.id === cuttingPanel?.layerId);
      if (!cuttingLayer || !cuttingLayer.visible || cuttingLayer.locked) setCut(null);
    }
    if (!next.layers.some((item) => item.id === activeLayerId)) setActiveLayerId(next.layers.at(-1).id);
  }
  function updatePanel(id, changes, record = true) {
    const current = pageRef.current;
    replacePage({ ...current, panels: current.panels.map((panel) => panel.id === id ? { ...panel, ...changes } : panel) }, record);
  }
  function rememberTask(taskTarget, snapshot, { record = true } = {}) {
    const current = pageRef.current;
    if (!current || current.id !== taskTarget?.pageId || !current.panels.some((panel) => panel.id === taskTarget.panelId)) return false;
    updatePanel(taskTarget.panelId, { task: { params: snapshot, savedAt: Date.now() } }, record);
    return true;
  }
  async function receiveImage({ pageId, panelId, image }) {
    const current = pageRef.current?.id === pageId ? pageRef.current : pagesRef.current.find((item) => item.id === pageId);
    const panel = current?.panels.find((item) => item.id === panelId);
    if (!panel) { setNotice({ severity: 'warning', text: c.missingPanel }); return false; }
    const next = { ...current, panels: current.panels.map((item) => item.id === panelId ? { ...item, image: fitPanelImage(item, image) } : item) };
    if (pageRef.current.id === pageId) { replacePage(next); await saveComicDraft(next); }
    else {
      // 先更新内存中的页面，确认对话框期间返回的图像也能被立即重新载入。
      pagesRef.current = pagesRef.current.map((item) => item.id === pageId ? next : item); setPages(pagesRef.current);
      const saved = await saveComicPage(next);
      pagesRef.current = pagesRef.current.map((item) => item.id === pageId ? { ...item, order: saved.order, updatedAt: saved.updatedAt } : item); setPages(pagesRef.current);
    }
    setNotice({ severity: 'success', text: c.generated }); return true;
  }
  useImperativeHandle(ref, () => ({
    saveTask: rememberTask,
    receiveGeneratedImage: receiveImage,
    getCurrentPage: () => pageRef.current,
    selectGenerationPanel(pageId, panelId) {
      const current = pageRef.current;
      if (current?.id !== pageId) return false;
      const panel = current.panels.find((item) => item.id === panelId);
      if (!panel || !current.layers.some((layer) => layer.id === panel.layerId && layer.visible && !layer.locked)) return false;
      choose(panel, current, { sequence: true });
      return true;
    },
  }));

  function getAIPage(pageId) {
    if (deletingPages.current.has(pageId)) return null;
    return pageRef.current?.id === pageId ? pageRef.current : pagesRef.current.find((item) => item.id === pageId);
  }
  async function updateAIPage(pageId, update, { record = false } = {}) {
    const current = getAIPage(pageId);
    if (!current) return null;
    const next = update(current);
    if (next === current) return current;
    if (pageRef.current?.id === pageId) replacePage(next, record);
    // AI 任务开始即保存到页面库；切换当前草稿后仍能向发起页交付结果。
    pagesRef.current = pagesRef.current.some((item) => item.id === pageId)
      ? pagesRef.current.map((item) => item.id === pageId ? next : item)
      : [...pagesRef.current, next];
    setPages(pagesRef.current);
    const saved = await saveComicPage(next);
    pagesRef.current = pagesRef.current.map((item) => item.id === pageId ? { ...item, order: saved.order, updatedAt: saved.updatedAt } : item);
    setPages(pagesRef.current);
    if (pageRef.current?.id === pageId) await saveComicDraft(pageRef.current);
    return getAIPage(pageId);
  }
  async function applyAIResult({ pageId, sectionId, image, originalImage, result, taskId, expectedFingerprint, force = false, record = true, undoToken = null }) {
    // 当前页的撤销栈不能记录后台页；切页后只保存待应用结果，回到发起页再明确替换。
    if (pageRef.current?.id !== pageId) return { applied: false, fingerprint: null };
    let applied = false;
    let fingerprint = null;
    const saving = updateAIPage(pageId, (current) => {
      if (!force && comicAISectionFingerprint(current, sectionId) !== expectedFingerprint) return current;
      const textElements = result ? buildComicLetteringElements(current, sectionId, image, result) : [];
      applied = true;
      const next = applyComicAIImage(current, sectionId, image, { originalImage, taskId, textElements });
      // 比较基线必须是本次回填本身，不能把磁盘保存期间的新编辑纳入基线。
      fingerprint = comicAISectionFingerprint(next, sectionId);
      return next;
    // 两次回填之间若有其他可撤销编辑，文字结果必须单独记录，避免撤销无关编辑时连带丢字。
    }, { record: record || !undoToken || history.current.undo.at(-1) !== undoToken });
    const appliedUndoToken = history.current.undo.at(-1);
    await saving;
    if (applied && pageRef.current?.id === pageId) choose(null, pageRef.current, { savePrevious: false });
    return { applied, fingerprint, undoToken: appliedUndoToken };
  }

  async function savePage() {
    let snapshot;
    let saved;
    do {
      snapshot = pageRef.current;
      saved = await saveComicPage(snapshot);
      pagesRef.current = [...pagesRef.current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.order - b.order);
      setPages(pagesRef.current);
      // 写入期间可能刚好收到生成结果，必须将最新图像也写完才能离开此页。
    } while (pageRef.current.id === snapshot.id && pageRef.current !== snapshot);
    if (pageRef.current.id !== snapshot.id) return false;
    pageRef.current = saved; setPage(saved); setDirty(false);
    setNotice({ severity: 'success', text: c.pageSaved });
    return true;
  }
  async function perform(operation, errorText = c.storageError) {
    setBusy(true);
    try { await operation(); } catch { setNotice({ severity: 'error', text: errorText }); }
    finally { setBusy(false); }
  }
  function loadPage(next, fresh = false) {
    cancelDrag();
    if (!fresh) next = pagesRef.current.find((item) => item.id === next.id) || next;
    next = ensureComicLayers(next);
    pageRef.current = next; setPage(next); setSection(0); choose(null, next, { savePrevious: false }); setCut(null); setCropId(null); setElementEditorId(null); setActiveLayerId(next.layers[0].id); setDirty(fresh);
    history.current = { undo: [], redo: [] }; setHistoryVersion((value) => value + 1);
    setPagesOpen(false);
  }
  function navigate(next, fresh = false) {
    const action = () => loadPage(next, fresh);
    if (dirty) setConfirmation({ kind: 'navigate', action }); else action();
  }
  function undo(redo = false) {
    cancelDrag();
    const source = redo ? history.current.redo : history.current.undo;
    if (!source.length) return;
    (redo ? history.current.undo : history.current.redo).push(pageRef.current);
    const next = source.pop(); replacePage(next, false); choose(null, next, { savePrevious: false }); setCut(null); setHistoryVersion((value) => value + 1);
  }
  function applyPreset(template) {
    const layer = creationLayer('panels'); if (!layer) return;
    setTemplatePicker(false);
    const action = () => { const next = applyTemplate(pageRef.current, template.id, section, templates, layer.kind === 'custom' ? layer.id : undefined); replacePage(next); choose(null, next, { savePrevious: false }); setCut(null); };
    setConfirmation({ kind: 'replace', action });
  }
  function changeZoom(value, event) {
    const previous = viewRef.current;
    const nextZoom = Math.max(0.25, Math.min(5, value));
    const bounds = viewport.current.getBoundingClientRect();
    const x = event ? event.clientX - bounds.left - bounds.width / 2 : 0;
    const y = event ? event.clientY - bounds.top - bounds.height / 2 : 0;
    const ratio = nextZoom / previous.zoom;
    const next = { zoom: nextZoom, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio };
    viewRef.current = next; setView(next);
  }
  function viewPointerDown(event) {
    if (event.target.closest('button, input, [role="menu"], [data-comic-layers], [data-comic-panel-image-actions]')) return;
    if (!(tool === 'hand' || tool === 'zoom' || spaceHeld || event.button === 1)) return;
    if (!event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    if (tool === 'zoom' && !spaceHeld && event.button === 0) {
      changeZoom(viewRef.current.zoom * (event.altKey ? 0.8 : 1.25), event); return;
    }
    viewDrag.current = { x: event.clientX, y: event.clientY, view: viewRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function viewPointerMove(event) {
    const action = viewDrag.current;
    if (!action) { if (tool === 'cut') pointerMove(event); return; }
    const next = { ...action.view, x: action.view.x + event.clientX - action.x, y: action.view.y + event.clientY - action.y };
    viewRef.current = next; setView(next);
  }
  function canvasPoint(event, clamp = true) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current.getScreenCTM().inverse());
    if (!clamp) return { x: point.x, y: point.y };
    return { x: Math.max(0, Math.min(page.width, point.x)), y: Math.max(0, Math.min(page.height, point.y)) };
  }
  function moveAIControl(sectionId, instanceId, point, record = false) {
    const current = pageRef.current;
    const plan = current.aiWorkflow.plan;
    const bounds = comicContentBounds(current, sectionId);
    const next = { ...plan, sections: plan.sections.map((part) => part.id !== sectionId ? part : { ...part, useCoords: true,
      instances: part.instances.map((instance) => {
        if (instance.id !== instanceId) return instance;
        const candidate = { ...instance, center: { x: (point.x - bounds.x) / bounds.width, y: (point.y - bounds.y) / bounds.height } };
        return { ...candidate, center: comicAIControlPosition(current, part, candidate).center };
      }),
    }) };
    replacePage({ ...current, aiWorkflow: { ...current.aiWorkflow, plan: next, updatedAt: Date.now() } }, record);
  }
  function finishAIControl(event, cancelled = false) {
    event.stopPropagation();
    const action = controlDrag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    controlDrag.current = null;
    if (cancelled) replacePage(action.before, false);
    else if (pageRef.current !== action.before) {
      history.current.undo.push(action.before); history.current.undo = history.current.undo.slice(-30); history.current.redo = [];
      setHistoryVersion((value) => value + 1);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function pointerDown(event) {
    if (event.button !== 0 || (event.pointerType !== 'touch' && !event.isPrimary)) return;
    if (event.target.closest('button, input, [data-comic-layers], [data-comic-ai-control], [data-comic-character]')) return;
    if (event.pointerType === 'touch' && drag.current) {
      const action = drag.current;
      if (tool !== 'select' || (!action.panel && !action.element) || touchPoints.current.size !== 1) return;
      event.preventDefault();
      flushDrag();
      touchPoints.current.set(event.pointerId, canvasPoint(event, false));
      const [a, b] = [...touchPoints.current.values()];
      action.gesture = { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
      if (action.panel) {
        action.basePanel = pageRef.current.panels.find((item) => item.id === action.panel.id);
        action.imageStartPoints ||= action.basePanel.points;
        action.kind = 'gesture';
      } else {
        action.baseElement = pageRef.current.elements.find((item) => item.id === action.element.id);
        action.kind = 'element-gesture';
      }
      svg.current.setPointerCapture(event.pointerId);
      setSnapGuides([]);
      return;
    }
    // 阻止浏览器拖拽原图或选择 SVG 文字，否则第一步移动就会取消画笔手势。
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const point = canvasPoint(event); const current = pageRef.current;
    const element = event.target.closest('[data-panel]'); const panel = current.panels.find((item) => item.id === element?.dataset.panel);
    const artwork = current.elements.find((item) => item.id === event.target.closest('[data-element]')?.dataset.element);
    if (tool === 'cut') {
      const raw = canvasPoint(event, false);
      const candidates = editableItems.filter(({ kind, item }) => kind === 'panel' && (!cut || item.id === cut.panelId)).map(({ item }) => item).reverse();
      const near = snapComicCutPoint(candidates, raw, (event.pointerType === 'touch' ? 22 : 14) * handleScale);
      const first = cut || (near && { ...near, corners: [] });
      drag.current = { kind: 'cut', pointerId: event.pointerId, first, pressed: raw, last: raw, continuing: Boolean(cut), before: current };
      setCut(first); setCutHover(near); setCursor(near?.point || raw);
      if (first) choose(current.panels.find((item) => item.id === first.panelId));
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === 'select') {
      const handleTarget = event.target.closest('[data-handle]');
      const handle = handleTarget?.dataset.handle;
      if (artwork) {
        if (artwork.id !== selectedElementId) chooseElement(artwork);
        if (!current.layers.find((item) => item.id === artwork.layerId).locked) {
          const matrix = new DOMMatrix(comicElementMatrix(artwork));
          const center = new DOMPoint(artwork.width / 2, artwork.height / 2).matrixTransform(matrix);
          drag.current = { kind: `element-${handle || 'move'}`, element: artwork, start: canvasPoint(event, false), before: current, inverse: matrix.inverse(), center, handleX: Number(handleTarget?.dataset.x), handleY: Number(handleTarget?.dataset.y) };
        }
      } else {
        if (panel?.id !== selectedId || selectedElementId) choose(panel);
        if (panel && !current.layers.find((item) => item.id === panel.layerId).locked) {
          const box = panelBounds(panel), kind = handle || 'move';
          drag.current = { kind, index: Number(handleTarget?.dataset.index), panel, start: canvasPoint(event, false), before: current, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, imageStartPoints: ['move', 'rotate'].includes(kind) ? panel.points : null };
        }
      }
    } else if (tool === 'rectangle' || tool === 'overlay' || tool === 'text') {
      const layer = creationLayer(tool === 'overlay' ? 'overlays' : tool === 'text' ? 'dialogue' : 'panels'); if (!layer) return;
      drag.current = { kind: tool === 'text' ? 'text' : 'rectangle', start: point, before: current, section: tool === 'overlay' ? -1 : section, layerId: layer.id };
      setRectangle({ start: point, end: point });
    } else if (tool === 'brush' || tool === 'eraser') {
      const layer = current.layers.find((item) => item.id === activeLayerId) || current.layers[0];
      if (layer.locked || !layer.visible) { setNotice({ severity: 'info', text: c.layerUnavailable }); return; }
      // 橡皮只绘制白色遮盖笔触，不删除画框或改变其命中区域和生成任务。
      const stroke = { id: createClientId(), kind: tool === 'eraser' ? 'erase' : 'brush', points: [point], color: tool === 'eraser' ? '#ffffff' : '#111111', width: brushSize, layerId: layer.id, order: Math.max(-1, ...getComicRenderItems(current).filter(({ item }) => item.layerId === layer.id).map(({ item }) => item.order)) + 1 };
      drag.current = { kind: 'brush', strokeId: stroke.id, before: current };
      replacePage({ ...current, strokes: [...current.strokes, stroke] }, false);
    }
    if (drag.current) {
      drag.current.pointerId = event.pointerId;
      setDragCursor(drag.current.kind.includes('rotate') ? ROTATE_CURSOR : drag.current.kind.includes('move') ? 'grabbing' : 'move');
      if (event.pointerType === 'touch') touchPoints.current.set(event.pointerId, canvasPoint(event, false));
      svg.current.setPointerCapture(event.pointerId);
    }
  }
  function pointerMove(event) {
    if (event.pointerType === 'touch' && touchPoints.current.has(event.pointerId)) touchPoints.current.set(event.pointerId, canvasPoint(event, false));
    if (drag.current && event.pointerId !== drag.current.pointerId && !touchPoints.current.has(event.pointerId)) return;
    // 合并高频移动事件；松手前同步最后一帧，保证撤销只记录一次完整手势。
    if (drag.current && !['brush', 'cut'].includes(drag.current.kind)) {
      pendingDrag.current = { clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType, shiftKey: event.shiftKey, altKey: event.altKey };
      if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(flushDrag);
      return;
    }
    applyPointerMove(event);
  }
  function flushDrag() {
    cancelAnimationFrame(dragFrame.current); dragFrame.current = null;
    const event = pendingDrag.current; pendingDrag.current = null;
    if (event && drag.current) applyPointerMove(event);
  }
  function applyPointerMove(event) {
    if (tool === 'cut') {
      const raw = canvasPoint(event, false), action = drag.current;
      let first = action?.first || cut;
      const candidates = editableItems.filter(({ kind, item }) => kind === 'panel' && (!first || item.id === first.panelId)).map(({ item }) => item).reverse();
      const snapDistance = (event.pointerType === 'touch' ? 22 : 14) * handleScale;
      const near = snapComicCutPoint(candidates, raw, snapDistance);
      if (action) {
        // 保留每段鼠标轨迹的交点，快速划过整框也不会漏掉进入和离开的边。
        const crossings = candidates.flatMap((item) => comicCutIntersections(item, action.last, raw, snapDistance)).sort((left, right) => left.distance - right.distance);
        for (const hit of crossings) {
          if (!first) {
            first = { ...hit, corners: [] };
            choose(pageRef.current.panels.find((item) => item.id === hit.panelId));
          } else if (!action.end && isCutEnd(first, hit, handleScale)) action.end = hit;
        }
        if (!first && near) {
          first = { ...near, corners: [] };
          choose(pageRef.current.panels.find((item) => item.id === near.panelId));
        }
        action.first = first;
        // 悬停只预览吸附。只有松手落在边上或真正穿过边界，才结束切割。
        action.near = near;
        action.last = raw;
        setCut(first);
      }
      setCutHover(action?.end || near); setCursor(action?.end?.point || near?.point || raw);
      return;
    }
    const action = drag.current; if (!action) return;
    const point = canvasPoint(event);
    const current = pageRef.current;
    if ((action.panel || action.element) && !action.gesture && !action.moved) {
      const raw = canvasPoint(event, false);
      if (Math.hypot(raw.x - action.start.x, raw.y - action.start.y) < 2 * handleScale) return;
      action.moved = true;
    }
    if (action.kind === 'rectangle' || action.kind === 'text') { setRectangle({ start: action.start, end: point }); return; }
    if (action.kind === 'brush') { replacePage({ ...current, strokes: current.strokes.map((stroke) => stroke.id === action.strokeId ? { ...stroke, points: [...stroke.points, point] } : stroke) }, false); return; }
    if (action.element) {
      const start = action.baseElement || action.element; const raw = canvasPoint(event, false);
      let changes;
      if (action.kind === 'element-move') {
        const matrix = new DOMMatrix(comicElementMatrix(start));
        const corners = [[0, 0], [start.width, 0], [start.width, start.height], [0, start.height]].map(([cornerX, cornerY]) => new DOMPoint(cornerX, cornerY).matrixTransform(matrix));
        const references = editableItems.filter(({ item }) => item.id !== start.id).map(({ kind, item }) => {
          if (kind === 'panel') return item;
          const transform = new DOMMatrix(comicElementMatrix(item));
          return { points: [[0, 0], [item.width, 0], [item.width, item.height], [0, item.height]].map(([cornerX, cornerY]) => new DOMPoint(cornerX, cornerY).matrixTransform(transform)) };
        });
        const delta = { x: raw.x - action.start.x, y: raw.y - action.start.y };
        const snapped = event.altKey ? { delta, guides: [] } : snapPanelDrag({ panel: { points: corners }, kind: 'move', delta, references, bounds: { x: 0, y: 0, width: current.width, height: current.height }, threshold: 6 * handleScale, shift: event.shiftKey });
        changes = { x: start.x + snapped.delta.x, y: start.y + snapped.delta.y }; setSnapGuides(snapped.guides);
      }
      else if (action.kind === 'element-gesture') {
        const [a, b] = [...touchPoints.current.values()];
        const angle = Math.atan2(b.y - a.y, b.x - a.x) - action.gesture.angle;
        const snapped = snapPanelAngle(start.rotation + angle * 180 / Math.PI, []);
        changes = { rotation: snapped.angle, x: start.x + (a.x + b.x) / 2 - action.gesture.center.x, y: start.y + (a.y + b.y) / 2 - action.gesture.center.y };
      }
      else if (action.kind === 'element-rotate') {
        const angle = Math.atan2(raw.y - action.center.y, raw.x - action.center.x) - Math.atan2(action.start.y - action.center.y, action.start.x - action.center.x);
        const rotation = start.rotation + angle * 180 / Math.PI;
        changes = { rotation: event.altKey ? rotation : snapPanelAngle(rotation, [], event.shiftKey).angle };
      } else {
        const local = new DOMPoint(raw.x, raw.y).matrixTransform(action.inverse);
        const origin = new DOMPoint(action.start.x, action.start.y).matrixTransform(action.inverse);
        const horizontal = action.handleX * 2 - 1, vertical = action.handleY * 2 - 1;
        let width = Math.max(24, start.width + (local.x - origin.x) * horizontal), height = Math.max(24, start.height + (local.y - origin.y) * vertical);
        if (event.shiftKey) {
          const ratio = !vertical || (horizontal && Math.abs(width / start.width - 1) > Math.abs(height / start.height - 1)) ? width / start.width : height / start.height;
          const scale = Math.max(ratio, 24 / start.width, 24 / start.height);
          width = start.width * scale; height = start.height * scale;
        }
        // 固定对角点，将缩放后的局部中心沿原变换移动，旋转/镜像时也不跳位。
        const matrix = comicElementMatrix(start);
        const dx = horizontal * (width - start.width) / 2;
        const dy = vertical * (height - start.height) / 2;
        const centerX = action.center.x + matrix[0] * dx + matrix[2] * dy;
        const centerY = action.center.y + matrix[1] * dx + matrix[3] * dy;
        changes = { width, height, x: centerX - width / 2, y: centerY - height / 2 };
      }
      if (changes.rotation !== undefined) setRotationLabel({ ...action.center, angle: changes.rotation });
      replacePage({ ...current, elements: current.elements.map((item) => item.id === start.id ? { ...item, ...changes } : item) }, false); return;
    }
    const start = action.basePanel || action.panel;
    const bounds = sectionBounds(current, start.type === 'overlay' ? -1 : start.section);
    const raw = canvasPoint(event, false);
    const references = current.panels.filter((panel) => panel.id !== start.id && current.layers.find((layer) => layer.id === panel.layerId).visible);
    let moved, guides = [];
    if (action.kind === 'rotate' || action.kind === 'gesture') {
      let angle, delta = { x: 0, y: 0 };
      if (action.kind === 'gesture') {
        const [a, b] = [...touchPoints.current.values()];
        angle = Math.atan2(b.y - a.y, b.x - a.x) - action.gesture.angle;
        delta = { x: (a.x + b.x) / 2 - action.gesture.center.x, y: (a.y + b.y) / 2 - action.gesture.center.y };
      } else angle = Math.atan2(raw.y - action.center.y, raw.x - action.center.x) - Math.atan2(action.start.y - action.center.y, action.start.x - action.center.x);
      const orientation = Math.atan2(start.points[1].y - start.points[0].y, start.points[1].x - start.points[0].x) * 180 / Math.PI;
      const snapped = event.altKey ? { angle: orientation + angle * 180 / Math.PI, snapped: false } : snapPanelAngle(orientation + angle * 180 / Math.PI, references, event.shiftKey);
      moved = rotatePanel(start, (snapped.angle - orientation) * Math.PI / 180, delta, bounds);
      if (moved) setRotationLabel({ ...action.center, angle: snapped.angle });
      if (moved && snapped.snapped) {
        const box = panelBounds(moved), center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const radius = Math.max(box.width, box.height) / 2 + 20 * handleScale;
        const cos = Math.cos(snapped.angle * Math.PI / 180), sin = Math.sin(snapped.angle * Math.PI / 180);
        guides = [{ a: { x: center.x - cos * radius, y: center.y - sin * radius }, b: { x: center.x + cos * radius, y: center.y + sin * radius } }];
      }
    } else {
      const delta = { x: raw.x - action.start.x, y: raw.y - action.start.y };
      const snapped = event.altKey ? { delta, guides: [] } : snapPanelDrag({ panel: start, kind: action.kind, index: action.index, delta, references, bounds, threshold: (event.pointerType === 'touch' ? 10 : 6) * handleScale, shift: event.shiftKey });
      moved = action.kind === 'vertex' ? movePanelVertex(start, action.index, { x: start.points[action.index].x + snapped.delta.x, y: start.points[action.index].y + snapped.delta.y }, bounds)
        : action.kind === 'move' ? movePanel(start, snapped.delta, bounds) : movePanelEdge(start, action.index, snapped.delta, bounds);
      // 被页面边界或凸形限制挡住时，不显示并未真正落到的吸附线。
      const index = action.kind === 'move' ? 0 : action.index;
      if (Math.abs(moved.points[index].x - start.points[index].x - snapped.delta.x) < 0.001 && Math.abs(moved.points[index].y - start.points[index].y - snapped.delta.y) < 0.001) guides = snapped.guides;
    }
    setSnapGuides(guides);
    if (!moved || moved === start) return;
    replacePage({ ...current, panels: current.panels.map((panel) => {
      if (panel.id !== moved.id) return panel;
      // 只替换拖动改变的几何，期间刚回填的图片和任务继续保留。
      const image = action.imageStartPoints ? transformPanelImage(panel.image, panel.points, moved.points) : panel.image;
      return { ...panel, points: moved.points, image };
    }) }, false);
  }
  function pageBeforeDrag(action) {
    const current = pageRef.current;
    if (action.kind === 'brush') return { ...current, strokes: current.strokes.filter((stroke) => stroke.id !== action.strokeId) };
    if (action.element) return { ...current, elements: current.elements.map((item) => item.id === action.element.id ? { ...item, x: action.element.x, y: action.element.y, width: action.element.width, height: action.element.height, rotation: action.element.rotation } : item) };
    if (!action.panel) return current;
    // 撤销手势时只还原位置，不回滚拖动期间完成的异步生成或任务保存。
    return { ...current, panels: current.panels.map((panel) => {
      if (panel.id !== action.panel.id) return panel;
      const image = action.imageStartPoints ? transformPanelImage(panel.image, panel.points, action.imageStartPoints) : panel.image;
      return { ...panel, points: action.panel.points, image };
    }) };
  }
  function cancelDrag(event) {
    if (event?.type === 'lostpointercapture' && !touchPoints.current.has(event.pointerId) && event.pointerId !== drag.current?.pointerId) return;
    cancelAnimationFrame(dragFrame.current); dragFrame.current = null; pendingDrag.current = null;
    touchPoints.current.clear(); setSnapGuides([]); setDragCursor(null); setRotationLabel(null); setCut(null); setCutHover(null); setCursor(null);
    if (!drag.current) return;
    if (drag.current.kind === 'cut') {
      const pointerId = drag.current.pointerId; drag.current = null;
      if (viewport.current.hasPointerCapture(pointerId)) viewport.current.releasePointerCapture(pointerId);
      return;
    }
    replacePage(pageBeforeDrag(drag.current), false); drag.current = null; setRectangle(null);
  }
  /** 切换工具前结束当前手势，避免捕获中的指针继续使用旧工具的数据。 */
  function changeTool(value) {
    cancelDrag(); setTool(value);
  }
  function pointerUp(event) {
    if (!drag.current || (event.pointerId !== drag.current.pointerId && !touchPoints.current.has(event.pointerId))) return;
    if (drag.current.kind === 'cut') {
      applyPointerMove(event);
      const { first, end: crossed, near, pressed, last, continuing } = drag.current; drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (!first) return;
      const current = pageRef.current, cuttingPanel = current.panels.find((item) => item.id === first.panelId);
      if (!cuttingPanel) { setCut(null); return; }
      const end = crossed || (isCutEnd(first, near, handleScale) ? near : null);
      if (!end) {
        const previous = first.corners.at(-1) || first.point;
        if ((continuing || Math.hypot(last.x - pressed.x, last.y - pressed.y) > handleScale)
          && isComicPanelInterior(cuttingPanel, last) && Math.hypot(last.x - previous.x, last.y - previous.y) > handleScale) {
          setCut({ ...first, corners: [...first.corners, last] });
          setCutHover(null);
          setCursor(null);
        }
        return;
      }
      const nextOrder = getComicRenderItems(current).find(({ item }) => item.layerId === cuttingPanel.layerId && item.order > cuttingPanel.order)?.item.order;
      const parts = splitPanelAlongPath(cuttingPanel, [first.point, ...first.corners, end.point], gutter, nextOrder);
      if (!parts) { setCutHover(null); setCursor(null); setNotice({ severity: 'info', text: c.cutError }); return; }
      parts.sort((left, right) => panelBounds(left).y - panelBounds(right).y || panelBounds(left).x - panelBounds(right).x);
      replacePage({ ...current, panels: current.panels.flatMap((item) => item.id === cuttingPanel.id ? parts : [item]) });
      setCut(null); setCutHover(null); setCursor(null); choose(null); return;
    }
    flushDrag();
    touchPoints.current.delete(event.pointerId);
    if (touchPoints.current.size) {
      const action = drag.current;
      const [pointerId, start] = [...touchPoints.current.entries()][0];
      action.pointerId = pointerId; action.start = start; action.gesture = null;
      if (action.panel) { action.kind = 'move'; action.basePanel = pageRef.current.panels.find((item) => item.id === action.panel.id); }
      else { action.kind = 'element-move'; action.baseElement = pageRef.current.elements.find((item) => item.id === action.element.id); }
      setSnapGuides([]); setDragCursor('grabbing');
      if (svg.current.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
      return;
    }
    setSnapGuides([]); setDragCursor(null); setRotationLabel(null);
    const action = drag.current; if (!action) return; drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (action.kind === 'text') {
      const end = canvasPoint(event); setRectangle(null);
      const width = Math.abs(end.x - action.start.x), height = Math.abs(end.y - action.start.y);
      insertElement('text', { x: Math.min(action.start.x, end.x), y: Math.min(action.start.y, end.y), width: width < 24 ? 220 : width, height: height < 24 ? 100 : height }, { layerId: action.layerId });
      return;
    }
    if (action.kind === 'rectangle') {
      const frame = createRectanglePanel(pageRef.current, action.section, action.start, canvasPoint(event)); setRectangle(null);
      if (frame) {
        frame.layerId = action.layerId; frame.order = Math.max(-1, ...getComicRenderItems(pageRef.current).filter(({ item }) => item.layerId === action.layerId).map(({ item }) => item.order)) + 1;
        const next = { ...pageRef.current, panels: [...pageRef.current.panels, frame] }; replacePage(next); choose(frame, pageRef.current); setTool('select'); setLastAction(c.select);
      }
      else setNotice({ severity: 'info', text: c.smallPanel });
    } else if (pageRef.current !== action.before) {
      history.current.undo.push(pageBeforeDrag(action)); history.current.undo = history.current.undo.slice(-30); history.current.redo = []; setHistoryVersion((value) => value + 1);
    }
  }
  async function addImage(blob, imageTarget) {
    const image = await readImage(blob); await receiveImage({ ...imageTarget, image });
    if (pageRef.current.id === imageTarget.pageId) setCropId(imageTarget.panelId);
  }
  async function openGallery(append = false) {
    const imageTarget = append ? gallery.target : target;
    const previousEntries = append ? gallery.entries : [];
    setGallery({ target: imageTarget, entries: previousEntries, loading: true });
    try {
      // 本地画廊从磁盘分页读取，避免打开漫画时把整个图库装入内存。
      const result = await comicClient.getGallery({ source: 'outputs', offset: previousEntries.length, limit: 60 });
      setGallery((current) => current?.target === imageTarget ? {
        target: imageTarget, entries: [...previousEntries, ...result.items],
        hasMore: result.has_more, loading: false,
      } : current);
    } catch { setGallery((current) => current?.target === imageTarget ? { ...current, loading: false, failed: true } : current); }
  }
  async function reorderPage(index, direction) {
    const reordered = [...pagesRef.current]; [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    const saved = await Promise.all(reordered.map((item, order) => saveComicPage({ ...item, order })));
    pagesRef.current = saved; setPages(saved);
    const current = saved.find((item) => item.id === pageRef.current.id);
    if (current) { pageRef.current = { ...pageRef.current, order: current.order }; setPage(pageRef.current); }
  }
  function moveLayer(direction) {
    if (selectedItem) replacePage(reorderComicItem(pageRef.current, selectedItem.kind, selectedItem.id, direction));
  }

  keyboardActions.current = (event) => {
    if (event.isComposing || !pageRef.current || !viewport.current?.getClientRects().length || event.target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="listbox"], [data-comic-dock], [data-comic-ai-control], [data-comic-character], [data-comic-panel-image-actions]')) return;
    // 弹窗和参数输入保留各自的快捷键；只有漫画画布接管编辑命令。
    if (cropId || gallery || templatePicker || templateDialog || confirmation || balloonPicker || elementEditorId || contextMenu || [...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden')) return;
    const key = event.key.toLowerCase(); const command = event.ctrlKey || event.metaKey;
    if (key === 'escape' && event.target.closest('[data-comic-layers]')) return;
    let action;
    let label;
    if (command && key === 'z') { action = () => undo(event.shiftKey); label = event.shiftKey ? c.redo : c.undo; }
    else if (command && key === 'y') { action = () => undo(true); label = c.redo; }
    else if (command && key === 's') { action = event.shiftKey ? () => { setTemplateName(''); setTemplateDialog(true); } : () => perform(savePage); label = event.shiftKey ? c.saveTemplate : c.savePage; }
    else if (command && key === 'n') { action = () => navigate(createComicPage(page.layout, 'blank', getComicLayoutSize(page.layout, canvasDefaults)), true); label = c.newPage; }
    else if (command && key === 'o' && selected) { action = () => { uploadTarget.current = target; upload.current.click(); }; label = c.upload; }
    else if (command && ['=', '+', '-', '0'].includes(key)) { action = () => key === '0' ? setView({ zoom: 1, x: 0, y: 0 }) : changeZoom(zoom * (key === '-' ? 0.8 : 1.25)); label = c.zoomCanvas; }
    else if (command && key === 'j' && selectedItem) { action = duplicateSelection; label = c.duplicate; }
    else if (!command && !event.altKey && key === 'delete' && selectedItem) { action = deleteSelection; label = c.deleteContent; }
    else if (!command && !event.altKey && key === 'escape') { action = () => { cancelDrag(); choose(null, pageRef.current, { savePrevious: false }); setCut(null); }; label = c.select; }
    else if (!command && !event.altKey && event.code === 'Space' && !event.target.closest('button, a, [role="button"], [role="combobox"]')) { action = () => setSpaceHeld(true); label = c.hand; }
    else if (!command && !event.altKey && ['[', ']'].includes(key)) { action = () => setBrushSize((value) => Math.max(1, Math.min(64, value + (key === ']' ? 2 : -2)))); label = c.brushSize; }
    else if (!command && !event.altKey && key === 'c' && event.shiftKey && selected?.image) { action = () => setCropId(selected.id); label = c.cropImage; }
    else if (!command && !event.altKey) {
      const nextTool = { v: 'select', c: 'cut', u: event.shiftKey ? 'overlay' : 'rectangle', b: 'brush', e: 'eraser', h: 'hand', z: 'zoom', t: 'text' }[key];
      if (nextTool) { action = () => changeTool(nextTool); label = nextTool === 'overlay' ? overlayLabel : c[nextTool]; }
    }
    if (!action) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat || event.code === 'Space' || ['[', ']'].includes(key)) { action(); setLastAction(label); }
  };

  if (!page) return <Box sx={{ p: 4 }}><Typography>{c.loading}</Typography></Box>;

  const sectionLabels = page.layout === 'spreadPortrait' ? [c.left, c.right] : [c.top, c.bottom];
  const comicPageSelection = (COMIC_LAYOUTS[page.layout].sections === 2 || (compactAndroid && mode === 'manual')) && <Box sx={{ display: 'flex', gap: 1, minWidth: 0 }}>
          {COMIC_LAYOUTS[page.layout].sections === 2 && <ToggleButtonGroup size="small" exclusive value={section} onChange={(_, value) => { if (value !== null) { setSection(value); choose(null); } }} sx={{ flex: 1, '& .MuiToggleButton-root': { flex: 1, minHeight: { xs: 44, md: 32 }, whiteSpace: 'nowrap' } }}>{sectionLabels.map((label, index) => <ToggleButton key={index} value={index} aria-label={label} data-action-label={label}>{label}</ToggleButton>)}</ToggleButtonGroup>}
          {compactAndroid && mode === 'manual' && <TextField select size="small" value={selectedId || ''} slotProps={{ select: { displayEmpty: true, renderValue: () => selectedNumber ? `${c.panel} ${selectedNumber}` : c.panel, inputProps: { 'aria-label': c.panel } } }} sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-root': { minHeight: 44 } }} onChange={(event) => { changeTool('select'); choose(page.panels.find((panel) => panel.id === event.target.value)); }}><MenuItem value="">{c.noPanel}</MenuItem>{page.panels.map((panel, index) => <MenuItem key={panel.id} value={panel.id} disabled={page.layers.some((layer) => layer.id === panel.layerId && (layer.locked || !layer.visible))}>{index + 1} · {panel.type === 'overlay' ? overlayLabel : regularLabel}</MenuItem>)}</TextField>}
        </Box>;
  const editableItems = getComicRenderItems(page).filter(({ kind, item }) => kind !== 'stroke' && !page.layers.find((layer) => layer.id === item.layerId)?.locked);
  const handleScale = page.width / canvasSize.width / zoom;
  const selectedBounds = selected ? panelBounds(selected) : null;
  const imageButtonSize = isMobile ? 36 : 32;
  const imageActionsWidth = imageButtonSize * 4 + 12;
  const imageActionsHeight = imageButtonSize + 6;
  let imageActionsPosition = null;
  if (selectedBounds && tool !== 'cut') {
    const { viewportWidth, viewportHeight } = canvasSize;
    const left = viewportWidth / 2 + view.x + (selectedBounds.x - page.width / 2) / handleScale;
    const top = viewportHeight / 2 + view.y + (selectedBounds.y - page.height / 2) / handleScale;
    const right = left + selectedBounds.width / handleScale;
    const bottom = top + selectedBounds.height / handleScale;
    if (right > 0 && bottom > 0 && left < viewportWidth && top < viewportHeight
      && viewportWidth >= imageActionsWidth + 16 && viewportHeight >= imageActionsHeight + 16) {
      // 用画布坐标跟随选框，位置随缩放更新；按钮本身始终用屏幕像素显示。
      const fitsBelow = bottom + imageActionsHeight + 16 <= viewportHeight;
      const fitsLeft = !fitsBelow && left >= imageActionsWidth + 16;
      imageActionsPosition = {
        left: Math.max(8, Math.min(fitsLeft ? left - imageActionsWidth - 8 : left, viewportWidth - imageActionsWidth - 8)),
        top: Math.max(8, Math.min(fitsBelow ? bottom + 8 : bottom - imageActionsHeight - 8, viewportHeight - imageActionsHeight - 8)),
      };
    }
  }
  const moveHandleAbove = selectedBounds && selectedBounds.y > 40 * handleScale;
  const panelMoveHandle = selectedBounds ? { x: selectedBounds.x + selectedBounds.width / 2, y: moveHandleAbove ? selectedBounds.y - 28 * handleScale : selectedBounds.y + selectedBounds.height + 28 * handleScale, anchorY: moveHandleAbove ? selectedBounds.y : selectedBounds.y + selectedBounds.height } : null;
  const panelRotateHandle = selectedBounds ? { x: panelMoveHandle.x + 44 * handleScale, y: panelMoveHandle.y } : null;
  // 与回填生成图使用同一铺满算法，虚线框就是当前分辨率图像放进画框后的实际范围；超出画框的部分会被裁掉。
  const placementImage = mode === 'manual' && selected && tool === 'select' && characterPlacement?.width > 0 && characterPlacement?.height > 0
    ? fitPanelImage(selected, { width: characterPlacement.width, height: characterPlacement.height }) : null;
  const characterBox = placementImage && {
    x: placementImage.x, y: placementImage.y,
    width: placementImage.width * placementImage.scale, height: placementImage.height * placementImage.scale,
  };
  // 和 AI 制作一样，圆点拖到画框外时停在框内最近处；坐标再按虚线框（实际成图范围）换算成 0–1。
  const characterCenterAtPoint = (pagePoint) => {
    const point = clampPointToComicFrame(selected.points, pagePoint);
    const axis = (value, start, size) => Number(Math.min(1, Math.max(0, (value - start) / size)).toFixed(3));
    return { x: axis(point.x, characterBox.x, characterBox.width), y: axis(point.y, characterBox.y, characterBox.height) };
  };
  const updateCharacterDrag = (next) => { characterDragRef.current = next; setCharacterDrag(next); };
  const finishCharacterDrag = (event, cancelled) => {
    event.stopPropagation();
    const drag = characterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) { updateCharacterDrag(null); return; }
    // 保留松手位置直到参数面板回传新坐标，避免圆点先闪回旧位置。
    updateCharacterDrag({ ...drag, pointerId: null });
    characterPlacement.onMove(drag.index, drag.center);
  };
  const cutHoverPanel = cutHover ? page.panels.find((item) => item.id === cutHover.panelId) : null;
  const cutVertices = cut ? [cut.point, ...cut.corners] : [];
  const cutPreview = cursor ? [...cutVertices, cursor] : cutVertices;
  const tools = [
    ['select', MouseOutlined, c.select, c.selectTip, 'V'], ['cut', ContentCut, c.cut, c.cutTip, 'C'], ['rectangle', CropFree, c.rectangle, c.rectangleTip, 'U'],
    ['overlay', LayersOutlined, overlayLabel, language === 'zh' ? '拖出可跨越分镜的上层画框，支持透明人物立绘' : 'Draw an overlay across panels; transparent character images are supported', 'Shift+U'],
    ['brush', BrushOutlined, c.brush, c.brushTip, 'B'], ['eraser', Eraser, c.eraser, c.eraserTip, 'E'],
    ['hand', PanToolOutlined, c.hand, c.handTip, 'H / Space'], ['zoom', ZoomIn, c.zoom, c.zoomTip, 'Z'],
  ];
  const pageLibrary = (<Box component="aside" data-testid="comic-page-library" sx={{ p: 0.8, borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.65, minHeight: 0, overflowY: 'auto', height: '100%', '& .MuiTypography-subtitle2': { fontSize: 11 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><Typography variant="subtitle2">{c.pages}</Typography><Chip size="small" label={pages.length} />{isMobile && <ComicButton icon={Close} label={c.close} onClick={() => setPagesOpen(false)} />}</Box>
      <TextField fullWidth hiddenLabel size="small" placeholder={c.pageTitle} slotProps={{ htmlInput: { 'aria-label': c.pageTitle } }} value={page.title} onChange={(event) => replacePage({ ...page, title: event.target.value })} sx={{ '& .MuiInputBase-input': { height: 34, boxSizing: 'border-box', py: 0, px: 1, lineHeight: 'normal' } }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.65, '& > span': { width: '100%' }, '& .MuiButton-root': { width: '100%', minHeight: 32, justifyContent: { xs: 'center', md: 'flex-start' }, px: 1 } }}>
        <ComicButton icon={Add} label={c.newPage} shortcut="Ctrl+N" variant="outlined" disabled={busy} onClick={() => navigate(createComicPage(page.layout, 'blank', getComicLayoutSize(page.layout, canvasDefaults)), true)} />
        <ComicButton icon={SaveOutlined} label={c.exportProject} tip={c.exportProjectTip} variant="contained" disabled={busy} onClick={() => perform(async () => {
          if (selectedIdRef.current) onSaveTask?.();
          const blob = await exportComicProject({ pages: pagesRef.current, templates, draft: pageRef.current });
          await downloadBlobToFile(blob, 'comic-project.zip');
          setNotice({ severity: 'success', text: c.projectExported });
        }, c.exportError)} />
        <ComicButton icon={UploadFile} label={c.importProject} tip={c.importProjectTip} variant="outlined" disabled={busy} onClick={() => projectUpload.current.click()} />
        <ComicButton icon={Download} label={busy ? c.exportBusy : c.export} tip={c.exportImagesTip} variant="outlined" disabled={busy || !pages.length} onClick={() => perform(async () => { const blob = await exportComicZip(pagesRef.current); await downloadBlobToFile(blob, 'comic-pages.zip'); }, c.exportError)} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>{`${dirty ? c.unsaved : c.saved} · ${c.draft}`}</Typography>
      <Divider />
      {!pages.length && <Typography color="text.secondary" variant="body2" sx={{ py: 3, textAlign: 'center' }}>{c.noPages}</Typography>}
      {pages.map((item, index) => <Paper key={item.id} variant="outlined" sx={{ p: 0.6, borderColor: item.id === page.id ? 'primary.main' : 'divider', flexShrink: 0 }}>
        <ButtonBase onClick={() => { if (item.id !== page.id) navigate(item); }} sx={{ width: '100%', display: 'block', textAlign: 'left' }} aria-label={`${String(index + 1).padStart(3, '0')} ${item.title}`}>
          <Box component="svg" viewBox={`0 0 ${item.width} ${item.height}`} sx={{ display: 'block', width: '100%', height: 104, bgcolor: 'action.hover' }}><PageArt page={item} prefix={`thumb-${item.id}`} /></Box>
          <Typography variant="caption" noWrap component="div" sx={{ mt: 0.5 }}>{String(index + 1).padStart(3, '0')} · {item.title || c.pages}</Typography>
        </ButtonBase>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><IconButton size="small" aria-label={c.moveUp} disabled={!index || busy} onClick={() => perform(() => reorderPage(index, -1))}><ArrowUpward sx={{ fontSize: 16 }} /></IconButton><IconButton size="small" aria-label={c.moveDown} disabled={index === pages.length - 1 || busy} onClick={() => perform(() => reorderPage(index, 1))}><ArrowDownward sx={{ fontSize: 16 }} /></IconButton><IconButton size="small" disabled={directorBusy} aria-label={c.deletePage} onClick={() => setConfirmation({ kind: 'delete', action: async () => { await deleteComicPage(item.id); deletingPages.current.add(item.id); pagesRef.current = pagesRef.current.filter((saved) => saved.id !== item.id); setPages(pagesRef.current); if (pageRef.current.id === item.id) loadPage(createComicPage(item.layout, 'blank', getComicLayoutSize(item.layout, canvasDefaults)), true); } })}><DeleteOutline sx={{ fontSize: 16 }} /></IconButton></Box>
      </Paper>)}
    </Box>);
  const panelColor = selected?.type === 'overlay' ? '#bd7110' : '#287bcc';
  const pageTools = (<Box data-comic-page-tools sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: { md: 1 } }}>
          <TextField select size="small" value={page.layout} slotProps={{ select: { inputProps: { 'aria-label': c.title } } }} onChange={(event) => navigate(createComicPage(event.target.value, 'blank', getComicLayoutSize(event.target.value, canvasDefaults)), true)} sx={{ flex: { xs: 1, md: 'none' }, minWidth: { xs: 0, md: 108 }, '& .MuiInputBase-root': { minHeight: { xs: 44, md: 34 } } }}>
            {Object.keys(COMIC_LAYOUTS).map((layout) => <MenuItem key={layout} value={layout}>{c[layout]}</MenuItem>)}
          </TextField>
          <ComicButton icon={CropFree} label={c.canvasSize} tip={c.canvasSizeTip} variant={compactAndroid ? 'outlined' : 'text'} disabled={busy || directorBusy} onClick={() => setCanvasDimensions({ width: String(page.width), height: String(page.height) })} />
          <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
          <Tooltip title={`${c.zoomCanvas} (Ctrl+0 / Ctrl+±)`}><TextField select size="small" value={zoom} slotProps={{ select: { inputProps: { 'aria-label': c.zoomCanvas } } }} onChange={(event) => Number(event.target.value) === 1 ? setView({ zoom: 1, x: 0, y: 0 }) : changeZoom(Number(event.target.value))} sx={{ width: { xs: 90, md: 74 }, flexShrink: 0, '& .MuiInputBase-root': { minHeight: { xs: 44, md: 34 } } }}>{[...new Set([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, zoom])].sort((a, b) => a - b).map((value) => <MenuItem value={value} key={value}>{value === 1 ? c.fit : `${Math.round(value * 100)}%`}</MenuItem>)}</TextField></Tooltip>
        </Box>);
  const editingTools = (
    <Box component="aside" data-comic-editing-tools onClickCapture={(event) => { if (compactAndroid && event.target.closest('button:not(:disabled)')) setToolsOpen(false); }} sx={{ p: { xs: 0.4, md: 0.8 }, minHeight: 0, bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', overflowY: 'auto', overflowX: 'hidden', '& .MuiButton-root': { justifyContent: compactAndroid ? 'flex-start' : { xs: 'center', md: 'flex-start' }, width: '100%', ...(compactAndroid ? { minHeight: 40, '& > .MuiBox-root': { display: 'inline' }, '& .MuiButton-startIcon': { mr: 1 } } : {}) }, '& [data-comic-tool-group]': { display: compactAndroid ? 'grid' : 'flex', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 0.75 }, '& .MuiTypography-subtitle2': { fontSize: 11 } }}>
      {compactAndroid && <Box sx={{ gridColumn: '1 / -1', mb: 1 }}>{pageTools}{comicPageSelection}</Box>}
      <Typography variant="subtitle2" sx={{ mb: 0.5, display: { xs: 'none', md: 'block' } }}>{c.templates}</Typography>
      <Box data-comic-tool-group sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
        <ComicButton variant="outlined" icon={DashboardOutlined} label={language === 'zh' ? '选择模板' : 'Templates'} onClick={() => setTemplatePicker(true)} />
        <ComicButton icon={Add} label={c.blank} onClick={() => applyPreset(COMIC_TEMPLATES[0])} />
        <ComicButton icon={SaveOutlined} label={c.saveTemplate} shortcut="Ctrl+Shift+S" onClick={() => { setTemplateName(''); setTemplateDialog(true); }} />
      </Box>
      <Divider sx={{ my: 0.75 }} />
      <Box data-comic-tool-group sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        {tools.map(([id, Icon, label, tip, shortcut]) => <ComicButton key={id} icon={Icon} label={label} tip={tip} shortcut={shortcut} onClick={() => changeTool(id)} onDoubleClick={id === 'hand' ? () => setView({ zoom: 1, x: 0, y: 0 }) : undefined} variant={tool === id ? 'contained' : 'text'} aria-pressed={tool === id} />)}
      </Box>
      <Divider sx={{ my: 0.75 }} />
      <Box data-comic-tool-group sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        <ComicButton icon={ChatBubbleOutline} label={c.dialogue} onClick={() => setBalloonPicker(true)} />
        <ComicButton icon={TextFields} label={c.text} tip={c.textTip} shortcut="T" variant={tool === 'text' ? 'contained' : 'text'} onClick={() => changeTool('text')} />
        <ComicButton icon={AutoAwesome} label={c.sticker} onClick={() => { elementUploadKind.current = 'sticker'; elementUpload.current.click(); }} />
      </Box>
      <Divider sx={{ my: 0.75 }} />
      <Box data-comic-tool-group sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <ComicButton icon={Undo} label={c.undo} shortcut="Ctrl+Z" disabled={!history.current.undo.length || !historyVersion} onClick={() => undo()} />
        <ComicButton icon={Redo} label={c.redo} shortcut="Ctrl+Y / Ctrl+Shift+Z" disabled={!history.current.redo.length} onClick={() => undo(true)} />
      </Box>
      <TextField select fullWidth size="small" label={c.panel} value={selectedId || ''} sx={{ my: 1, display: { xs: 'none', md: 'block' } }} onChange={(event) => { changeTool('select'); choose(page.panels.find((panel) => panel.id === event.target.value)); }}>
        <MenuItem value="">{c.noPanel}</MenuItem>
        {page.panels.map((panel, index) => <MenuItem key={panel.id} value={panel.id} disabled={page.layers.some((layer) => layer.id === panel.layerId && (layer.locked || !layer.visible))} sx={{ color: panel.type === 'overlay' ? '#bd7110' : 'primary.main' }}>{index + 1} · {panel.type === 'overlay' ? overlayLabel : regularLabel}{panel.task ? ' ✓' : ''}</MenuItem>)}
      </TextField>
      {tool === 'cut' && <LockableSlider label={c.gutter} min={0} max={48} step={1} value={gutter} onChange={setGutter} sx={{ my: 0.5, '& .MuiTypography-root': { fontSize: 11 } }} />}
      {['brush', 'eraser'].includes(tool) && <LockableSlider label={c.brushSize} min={1} max={64} step={1} value={brushSize} onChange={setBrushSize} sx={{ my: 0.5, '& .MuiTypography-root': { fontSize: 11 } }} />}
      {selected && <>
        <Divider sx={{ my: 0.75 }} /><Typography variant="subtitle2" sx={{ color: panelColor, mb: 0.5 }}>{compactAndroid ? `#${selectedNumber}` : `${c.panel} ${selectedNumber} · ${selected.type === 'overlay' ? overlayLabel : regularLabel}`}</Typography>
        {compactAndroid ? <ComicButton icon={selected.type === 'overlay' ? LayersOutlined : CropFree} label={selected.type === 'overlay' ? regularLabel : overlayLabel} onClick={() => { const converted = convertPanelType(selected, selected.type === 'overlay' ? 'regular' : 'overlay', page, section); if (converted) updatePanel(selected.id, converted); else setNotice({ severity: 'warning', text: c.smallPanel }); }} /> : <TextField select size="small" fullWidth label={language === 'zh' ? '画框类型' : 'Frame type'} value={selected.type || 'regular'} sx={{ my: 1 }} onChange={(event) => { const converted = convertPanelType(selected, event.target.value, page, section); if (converted) updatePanel(selected.id, converted); else setNotice({ severity: 'warning', text: c.smallPanel }); }}><MenuItem value="regular">{regularLabel}</MenuItem><MenuItem value="overlay">{overlayLabel}</MenuItem></TextField>}
        <LockableSlider label={selected.borderWidth ? c.border : c.borderless} min={0} max={12} step={1} value={selected.borderWidth} onChange={(value) => updatePanel(selected.id, { borderWidth: value })} sx={{ my: 0.5, '& .MuiTypography-root': { fontSize: 11 } }} />
        <Box data-comic-tool-group sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}><ComicButton icon={ArrowUpward} label={c.contentForward} onClick={() => moveLayer(1)} /><ComicButton icon={ArrowDownward} label={c.contentBackward} onClick={() => moveLayer(-1)} /></Box>
        <ComicButton color="error" icon={DeleteOutline} label={c.deletePanel} shortcut="Delete" onClick={deleteSelection} />
      </>}
      {selectedElement && <>
        <Divider sx={{ my: 0.75 }} /><Typography variant="subtitle2" noWrap sx={{ display: { xs: 'none', md: 'block' }, color: '#ad69da' }}>{selectedElement.name || (selectedElement.kind === 'bubble' ? c.dialogue : c[selectedElement.kind])}</Typography>
        <Box data-comic-tool-group sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <ComicButton icon={SettingsOutlined} label={c.editElement} onClick={() => setElementEditorId(selectedElement.id)} />
          <ComicButton icon={Flip} label={c.flipHorizontal} onClick={() => updateElement(selectedElement.id, { flipX: !selectedElement.flipX })} />
          <ComicButton icon={ContentCopy} label={c.duplicate} shortcut="Ctrl+J" onClick={duplicateSelection} />
          <ComicButton icon={ArrowUpward} label={c.contentForward} onClick={() => moveLayer(1)} /><ComicButton icon={ArrowDownward} label={c.contentBackward} onClick={() => moveLayer(-1)} />
          <ComicButton color="error" icon={DeleteOutline} label={c.deleteContent} shortcut="Delete" onClick={deleteSelection} />
        </Box>
      </>}
      <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { const file = event.target.files[0]; event.target.value = ''; if (file) perform(() => addImage(file, uploadTarget.current), c.imageError); }} />
      <input ref={elementUpload} data-testid="comic-asset-upload" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" hidden onChange={(event) => {
        const file = event.target.files[0]; event.target.value = ''; if (!file) return;
        const pageId = pageRef.current.id, kind = elementUploadKind.current;
        perform(async () => {
          const asset = await readComicAsset(file); if (pageRef.current.id !== pageId) return;
          const scale = Math.min(pageRef.current.width * 0.4 / asset.width, pageRef.current.height * 0.4 / asset.height, 1);
          const width = asset.width * scale, height = asset.height * scale;
          insertElement(kind, { x: (pageRef.current.width - width) / 2, y: (pageRef.current.height - height) / 2, width, height }, { dataUrl: asset.dataUrl, name: file.name });
        }, c.imageError);
      }} />
    </Box>
  );
  return <Box data-testid="comic-workspace" onClickCapture={(event) => { const button = event.target.closest('button'); const label = button?.dataset.actionLabel || button?.getAttribute('aria-label'); if (label) setLastAction(label); }} sx={{ position: 'relative', height: '100%', minHeight: { xs: 0, md: 480 }, maxHeight: compactAndroid ? '100%' : { xs: 'calc(100dvh - 110px)', md: 'none' }, display: 'grid', gridTemplateColumns: compactAndroid ? 'minmax(0,1fr)' : { xs: '46px minmax(0,1fr)', md: '146px minmax(0,1fr) 164px' }, bgcolor: 'background.default', borderRadius: 1, overflow: 'hidden', '& .MuiButton-root': { fontSize: compactAndroid ? 13 : 11, minWidth: compactAndroid ? 44 : 0, minHeight: compactAndroid ? 44 : undefined, lineHeight: 1.45, textTransform: 'none' }, '& .MuiSvgIcon-root': { fontSize: compactAndroid ? 20 : 17 }, '& .MuiIconButton-root': { minWidth: compactAndroid ? 44 : 0, minHeight: compactAndroid ? 44 : 0 }, '& .MuiOutlinedInput-root': { fontSize: compactAndroid ? 13 : 11 }, '& .MuiInputBase-input, & .MuiSelect-select': { py: 0.8 }, '& .MuiInputLabel-root': { fontSize: compactAndroid ? 13 : 11 }, '& .MuiTypography-caption': { fontSize: compactAndroid ? 12 : 10 }, '& .MuiChip-root': { height: 21, fontSize: 10 }, '& .MuiToggleButton-root': { fontSize: 11, py: 0.4, px: 1 }, '& .MuiSlider-root': { py: 1.2 }, '& .MuiSlider-thumb': { width: 10, height: 10 } }}>
    <input ref={projectUpload} type="file" hidden accept=".zip,application/zip" aria-label={c.importProject} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      perform(async () => {
        const project = await readComicProject(file);
        const images = new Set(project.pages.flatMap((item) => [...item.panels.map((panel) => panel.image?.dataUrl), ...item.elements.map((element) => element.dataUrl)]).filter(Boolean));
        // 自定义素材遵循上传时同样的校验，损坏图片、危险 SVG 或坏字体不落库。
        for (const dataUrl of images) {
          const blob = await fetchUrlAsBlob(dataUrl);
          const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[blob.type];
          await readComicAsset(new File([blob], `asset.${extension}`, { type: blob.type }));
        }
        await loadComicFonts(project.pages.flatMap((item) => item.fonts));
        if (selectedIdRef.current) onSaveTask?.();
        const currentBeforeImport = pageRef.current;
        const pagesBeforeImport = new Map(pagesRef.current.map((item) => [item.id, item]));
        const keepCurrent = dirty || history.current.undo.length > 0 || selectedIdRef.current || pagesBeforeImport.has(currentBeforeImport.id);
        const library = await importComicProject(project, keepCurrent ? currentBeforeImport : null);
        // 导入事务期间仍可能收到生成结果，保留旧页面刚回填的图像。
        if (pageRef.current !== currentBeforeImport) await savePage();
        library.pages = library.pages.map((item) => {
          const latest = pagesRef.current.find((saved) => saved.id === item.id);
          return latest && latest !== pagesBeforeImport.get(item.id) ? latest : item;
        });
        pagesRef.current = library.pages; setPages(library.pages); setTemplates(library.templates);
        loadPage(library.draft);
        setNotice({ severity: 'success', text: c.projectImported.replace('{count}', String(project.pages.length)) });
      }, c.importError);
    }} />
    {!compactAndroid && editingTools}

    <Box sx={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box data-comic-toolbar data-testid="comic-canvas-toolbar" sx={{ p: { xs: 0.5, md: 0.65 }, display: 'flex', flexDirection: 'row', flexWrap: compactAndroid ? 'nowrap' : 'wrap', alignItems: 'center', gap: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, flex: compactAndroid ? 1 : 'none' }}>
          {directorEnabled && <ToggleButtonGroup exclusive value={mode} disabled={generatingSequence || directorBusy} aria-label={language === 'zh' ? '制作方式' : 'Creation mode'}
            onChange={(_, value) => { if (value) { setMode(value); setDockCollapsed(compactAndroid); if (value === 'manual' && !selected) choose(page.panels.find((panel) => page.layers.some((layer) => layer.id === panel.layerId && layer.visible && !layer.locked))); } }}
            sx={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', flex: { xs: 1, md: 'none' }, width: { md: language === 'zh' ? 190 : 250 }, minWidth: 0, minHeight: 44, p: '4px', border: 0, borderRadius: 2, bgcolor: 'action.selected',
              '&:before': { content: '""', position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc((100% - 8px) / 2)', borderRadius: 1.3, bgcolor: 'primary.main', transform: mode === 'manual' ? 'translateX(100%)' : 'translateX(0)', transition: 'transform 200ms ease' },
              '& .MuiToggleButtonGroup-grouped': { position: 'relative', zIndex: 1, m: 0, border: 0, borderRadius: '6px !important', px: 1, py: 0.75, fontSize: 13, fontWeight: 500, color: 'text.secondary', '&:hover': { bgcolor: 'transparent' }, '&.Mui-selected': { color: 'primary.contrastText', fontWeight: 700, bgcolor: 'transparent', '&:hover': { bgcolor: 'transparent' } }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } },
              '@media (prefers-reduced-motion: reduce)': { '&:before': { transition: 'none' } } }}>
            <ToggleButton value="ai" aria-label={language === 'zh' ? 'AI制作' : 'AI creation'}>{compactAndroid ? 'AI' : (language === 'zh' ? 'AI制作' : 'AI creation')}</ToggleButton>
            <ToggleButton value="manual" aria-label={language === 'zh' ? '手动编排' : 'Manual layout'}>{compactAndroid ? (language === 'zh' ? '手动' : 'Manual') : (language === 'zh' ? '手动编排' : 'Manual layout')}</ToggleButton>
          </ToggleButtonGroup>}
          {compactAndroid && <ComicButton icon={BrushOutlined} label={language === 'zh' ? '绘图工具' : 'Drawing tools'} variant="outlined" onClick={() => setToolsOpen(true)} />}
          {compactAndroid && directorEnabled && <ComicButton icon={SettingsOutlined} label={language === 'zh' ? '参数' : 'Parameters'} variant="outlined" onClick={() => setDockCollapsed(false)} />}
          {compactAndroid && <ComicButton icon={MenuIcon} label={c.pages} onClick={() => setPagesOpen(true)} />}
        </Box>
        {!compactAndroid && pageTools}
        {!compactAndroid && comicPageSelection}
        {isMobile && !compactAndroid && <ComicButton icon={MenuIcon} label={c.pages} onClick={() => setPagesOpen(true)} />}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', lg: 'row' } }}>
        {directorEnabled && <Box component="aside" data-comic-dock data-testid="comic-dock" role={active && compactAndroid && !dockCollapsed ? 'dialog' : undefined} aria-modal={active && compactAndroid && !dockCollapsed ? true : undefined} aria-label={language === 'zh' ? '漫画参数' : 'Comic parameters'} sx={{ width: { xs: '100%', lg: dockCollapsed ? 44 : 350 }, flexShrink: 0, minHeight: 0, height: { xs: mode === 'ai' && !dockCollapsed ? '54%' : 'auto', lg: 'auto' }, maxHeight: { xs: dockCollapsed ? 48 : '54%', lg: 'none' }, display: 'flex', flexDirection: 'column', border: 0, bgcolor: 'background.paper', '& .MuiInputBase-root, & .MuiButton-root, & .MuiTypography-body2': { fontSize: 13 }, ...(compactAndroid ? { display: dockCollapsed ? 'none' : 'flex', position: 'absolute', inset: 0, width: 'auto', height: 'auto', maxHeight: 'none', zIndex: 1200 } : {}) }}>
          <Box sx={{ display: 'flex', alignItems: 'center', px: 1, minHeight: 48, gap: 0.5, borderBottom: dockCollapsed ? 0 : 1, borderColor: 'divider' }}>
            <IconButton size="small" aria-label={dockCollapsed ? (language === 'zh' ? '展开参数' : 'Expand parameters') : (language === 'zh' ? '收起参数' : 'Collapse parameters')} onClick={() => setDockCollapsed(!dockCollapsed)}>{compactAndroid ? <Close /> : <ArrowBack sx={{ transform: dockCollapsed ? 'rotate(180deg)' : 'none', width: 18 }} />}</IconButton>
            {!dockCollapsed && <><Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{mode === 'ai' ? (language === 'zh' ? 'AI制作' : 'AI creation') : `${c.panel} ${selectedNumber || '—'}`}</Typography>
              {mode === 'manual' && <Button size="small" startIcon={<SaveOutlined />} disabled={!selected || directorBusy || generationAction?.loading} onClick={() => { const snapshot = onSaveTask?.(); if (snapshot) { rememberTask(target, snapshot); setNotice({ severity: 'success', text: c.taskSaved }); } }} sx={{ whiteSpace: 'nowrap', mr: 0.5 }}>{c.saveTask}</Button>}
              {mode === 'ai' && active && <ComicProviderControl client={comicClient} language={language}
                disabled={directorBusy} compact={compactAndroid} onChange={setLLMSettings} />}</>}
          </Box>
          <Box sx={{ display: dockCollapsed ? 'none' : (compactAndroid && mode === 'ai' ? 'flex' : 'block'), overflowY: compactAndroid && mode === 'ai' ? 'hidden' : 'auto', overflowX: 'hidden', flex: 1, minHeight: 0, flexDirection: 'column' }}>
            {compactAndroid && comicPageSelection}
            <Box sx={{ display: mode === 'ai' ? (compactAndroid ? 'flex' : 'block') : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <ComicAIStudio compact={compactAndroid} open={active && aiDockOpen} actionContainer={active && mode === 'ai' ? canvasActions : null}
                onOpenResults={() => setDockCollapsed(false)} page={page} client={comicClient} language={language} llmSettings={llmSettings} selectedControl={selectedControl}
                imageModels={directorImageModels} getPage={getAIPage} onUpdatePage={updateAIPage} onApplyResult={applyAIResult} generationBusy={generationAction?.loading && !directorBusy}
                onBusyChange={(value) => { setDirectorBusy(value); onDirectorBusyChange?.(value); }} />
            </Box>
            <Box sx={{ display: mode === 'manual' ? 'flex' : 'none', flexDirection: 'column', gap: 1.5, p: 1 }}>
              {/* 参数快照由父层保存，隐藏时卸载输入控件，避免自动高度观察器在零尺寸下触发循环。 */}
              {mode === 'manual' && (manualEditor || (compactAndroid ? <Button fullWidth variant="outlined" startIcon={<SettingsOutlined />} disabled={!selected} onClick={() => { setDockCollapsed(true); onEditTask?.(selectedBounds); }}>{c.editTask}</Button> : <ComicButton icon={SettingsOutlined} label={c.editTask} onClick={() => onEditTask?.(selectedBounds)} />))}
            </Box>
          </Box>
          {mode === 'manual' && !dockCollapsed && manualEditor && <Box ref={onParameterToolbarChange} data-testid="comic-parameter-toolbar"
            sx={{ flexShrink: 0, px: 1, py: 0.75, borderTop: 1, borderColor: 'divider', '& > :first-child': { mb: 0 } }} />}
        </Box>}
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', bgcolor: 'action.hover',
        backgroundImage: 'radial-gradient(#88888825 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
      <Box ref={viewport} tabIndex={-1} data-testid="comic-viewport" onContextMenu={(event) => {
        if (event.target.closest('[data-comic-panel-image-actions]')) return;
        event.preventDefault();
        // 切割时右键只放弃当前切口并回到选择工具，不弹出画布菜单。
        if (tool === 'cut') { changeTool('select'); return; }
        const panel = page.panels.find((item) => item.id === event.target.closest('[data-panel]')?.dataset.panel);
        const element = page.elements.find((item) => item.id === event.target.closest('[data-element]')?.dataset.element);
        if (element) chooseElement(element); else if (panel) choose(panel);
        setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6 });
      }} onPointerDownCapture={viewPointerDown} onPointerDown={tool === 'cut' ? pointerDown : undefined} onPointerMove={viewPointerMove} onPointerUp={(event) => { if (tool === 'cut') pointerUp(event); viewDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={(event) => { viewDrag.current = null; if (tool === 'cut') cancelDrag(event); }} onLostPointerCapture={(event) => { viewDrag.current = null; if (tool === 'cut') cancelDrag(event); }} onPointerLeave={() => { if (!drag.current) setCutHover(null); }} onDragStart={(event) => event.preventDefault()}
        sx={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', bgcolor: 'action.hover', backgroundImage: 'radial-gradient(#88888825 1px, transparent 1px)', backgroundSize: '18px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', userSelect: 'none', cursor: tool === 'hand' || spaceHeld ? 'grab' : tool === 'zoom' ? 'zoom-in' : 'default' }}>
        <Box component="svg" ref={svg} tabIndex={0} viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label={c.title} data-testid="comic-canvas"
          onDragStart={(event) => event.preventDefault()} onPointerDown={tool === 'cut' ? undefined : pointerDown} onPointerMove={tool === 'cut' ? undefined : pointerMove} onPointerUp={tool === 'cut' ? undefined : pointerUp} onPointerCancel={tool === 'cut' ? undefined : cancelDrag} onLostPointerCapture={tool === 'cut' ? undefined : cancelDrag}
          sx={{ width: canvasSize.width, height: canvasSize.height, flexShrink: 0, overflow: 'visible', transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})`, transformOrigin: 'center', boxShadow: '0 0 0 1px rgba(0,0,0,0.1)', bgcolor: 'white', touchAction: 'none', userSelect: 'none', cursor: dragCursor || (tool === 'hand' || spaceHeld ? 'grab' : tool === 'zoom' ? 'zoom-in' : ['cut', 'rectangle', 'overlay', 'brush', 'eraser', 'text'].includes(tool) ? 'crosshair' : 'default'), ...(dragCursor ? { '& *': { cursor: `${dragCursor} !important` } } : {}) }}>
          <defs><clipPath id="comic-page-clip"><rect width={page.width} height={page.height} /></clipPath></defs><g clipPath="url(#comic-page-clip)"><PageArt page={page} prefix="editor" /></g>
          {COMIC_LAYOUTS[page.layout].sections === 2 && <rect {...sectionBounds(page, section)} fill="none" stroke="#287bcc" strokeWidth={2} strokeDasharray="10 8" pointerEvents="none" />}
          {editableItems.map(({ kind, item }) => {
            if (kind === 'element') return <g key={item.id} data-element={item.id} transform={`matrix(${comicElementMatrix(item).join(' ')})`} onDoubleClick={() => { chooseElement(item); setElementEditorId(item.id); }}>
              <polygon data-element={item.id} points={polygonPoints(item.mask.map((point) => ({ x: point.x * item.width, y: point.y * item.height })))} fill="transparent" stroke="#ad69da" strokeWidth={(item.id === selectedElementId ? 2 : 1) * handleScale} strokeDasharray={item.id === selectedElementId ? undefined : `${6 * handleScale} ${5 * handleScale}`} opacity={item.id === selectedElementId ? 1 : 0.45} style={{ cursor: tool === 'select' ? 'grab' : 'inherit' }} />
            </g>;
            const color = item.type === 'overlay' ? '#bd7110' : '#287bcc';
            const { number, width, position } = panelBadges.get(item.id);
            return <g key={item.id} data-panel={item.id}>
              <polygon data-panel={item.id} points={polygonPoints(item.points)} fill="transparent" stroke={color} strokeWidth={(item.id === selectedId ? 1.5 : 0.75) * handleScale} strokeDasharray={item.id === selectedId ? undefined : `${6 * handleScale} ${5 * handleScale}`} opacity={item.id === selectedId ? 1 : 0.6} style={{ cursor: tool === 'select' ? 'grab' : 'inherit' }} />
              {position && <g data-panel-number={item.id} pointerEvents="none" transform={`translate(${position.x} ${position.y}) scale(${position.scale})`}>
                <rect width={width} height={26} rx={5} fill={color} />
                <text x={width / 2} y={19} fill="white" fontSize={18} textAnchor="middle" fontFamily="sans-serif">{number}</text>
              </g>}
            </g>;
          })}
          {selected && tool === 'select' && <g data-panel={selected.id}>
            {selected.points.map((p, index) => { const next = selected.points[(index + 1) % selected.points.length]; return <g key={index}>
              <g data-panel={selected.id} data-handle="edge" data-index={index} style={{ cursor: 'move' }}>
                <circle cx={(p.x + next.x) / 2} cy={(p.y + next.y) / 2} r={(isMobile ? 18 : 10) * handleScale} fill="transparent" />
                <rect x={(p.x + next.x) / 2 - 4 * handleScale} y={(p.y + next.y) / 2 - 4 * handleScale} width={8 * handleScale} height={8 * handleScale} fill="white" stroke={panelColor} strokeWidth={1.5 * handleScale} pointerEvents="none" />
              </g>
              <g data-panel={selected.id} data-handle="vertex" data-index={index} style={{ cursor: 'move' }}>
                <circle cx={p.x} cy={p.y} r={(isMobile ? 22 : 12) * handleScale} fill="transparent"><title>{c.vertexHandle}</title></circle>
                <circle cx={p.x} cy={p.y} r={5 * handleScale} fill="white" stroke={panelColor} strokeWidth={1.5 * handleScale} pointerEvents="none" />
              </g>
            </g>; })}
            <line x1={panelMoveHandle.x} y1={panelMoveHandle.anchorY} x2={panelMoveHandle.x} y2={panelMoveHandle.y} stroke={panelColor} strokeWidth={1.5 * handleScale} pointerEvents="none" />
            <g data-panel={selected.id} data-handle="move" data-testid="comic-panel-move" style={{ cursor: 'grab' }}>
              <circle cx={panelMoveHandle.x} cy={panelMoveHandle.y} r={(isMobile ? 22 : 12) * handleScale} fill="transparent"><title>{c.moveHandle}</title></circle>
              <circle cx={panelMoveHandle.x} cy={panelMoveHandle.y} r={7 * handleScale} fill={panelColor} stroke="white" strokeWidth={1.5 * handleScale} pointerEvents="none" />
            </g>
            <line x1={panelMoveHandle.x} y1={panelMoveHandle.y} x2={panelRotateHandle.x} y2={panelRotateHandle.y} stroke={panelColor} strokeWidth={handleScale} pointerEvents="none" />
            <ComicRotationHandle {...panelRotateHandle} scale={handleScale} color={panelColor} label={c.rotateHandle} touch={isMobile} data-testid="comic-panel-rotate" />
          </g>}
          {selectedElement && tool === 'select' && <g data-element={selectedElement.id} transform={`matrix(${comicElementMatrix(selectedElement).join(' ')})`}>
            <rect width={selectedElement.width} height={selectedElement.height} fill="none" stroke="#ad69da" strokeWidth={1.5 * handleScale} strokeDasharray={`${5 * handleScale} ${3 * handleScale}`} pointerEvents="none" />
            {[[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]].map(([horizontal, vertical], index) => {
              const handleX = horizontal * selectedElement.width, handleY = vertical * selectedElement.height;
              const matrix = comicElementMatrix(selectedElement);
              const direction = Math.atan2(matrix[1] * (horizontal - 0.5) + matrix[3] * (vertical - 0.5), matrix[0] * (horizontal - 0.5) + matrix[2] * (vertical - 0.5));
              const cursor = ['ew', 'nwse', 'ns', 'nesw'][(Math.round(direction / (Math.PI / 4)) + 8) % 4];
              return <g key={index} data-handle="resize" data-x={horizontal} data-y={vertical} style={{ cursor: `${cursor}-resize` }}>
                <circle cx={handleX} cy={handleY} r={(isMobile ? 18 : 10) * handleScale} fill="transparent"><title>{c.resizeHandle}</title></circle>
                <rect x={handleX - 4 * handleScale} y={handleY - 4 * handleScale} width={8 * handleScale} height={8 * handleScale} rx={handleScale} fill="white" stroke="#ad69da" strokeWidth={1.5 * handleScale} pointerEvents="none" />
              </g>;
            })}
            <line x1={selectedElement.width / 2} y1={selectedElement.height} x2={selectedElement.width / 2} y2={selectedElement.height + 28 * handleScale} stroke="#ad69da" strokeWidth={1.5 * handleScale} pointerEvents="none" />
            <g data-handle="move" data-testid="comic-element-move" style={{ cursor: 'grab' }}>
              <circle cx={selectedElement.width / 2} cy={selectedElement.height + 28 * handleScale} r={(isMobile ? 22 : 12) * handleScale} fill="transparent"><title>{c.moveHandle}</title></circle>
              <circle cx={selectedElement.width / 2} cy={selectedElement.height + 28 * handleScale} r={7 * handleScale} fill="#ad69da" stroke="white" strokeWidth={1.5 * handleScale} pointerEvents="none" />
            </g>
            <line x1={selectedElement.width / 2} y1={0} x2={selectedElement.width / 2} y2={-28 * handleScale} stroke="#ad69da" strokeWidth={1.5 * handleScale} pointerEvents="none" />
            <ComicRotationHandle x={selectedElement.width / 2} y={-28 * handleScale} scale={handleScale} color="#ad69da" label={c.rotateHandle} touch={isMobile} data-testid="comic-element-rotate" />
          </g>}
          <g pointerEvents="none" stroke="#a855f7" strokeWidth={0.75 * handleScale} fill="none">
            {snapGuides.map(({ a, b, measure }, index) => <g key={index}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {measure && [a, b].map((p, end) => <line key={end} x1={p.x - (a.x === b.x ? 3 * handleScale : 0)} y1={p.y - (a.y === b.y ? 3 * handleScale : 0)} x2={p.x + (a.x === b.x ? 3 * handleScale : 0)} y2={p.y + (a.y === b.y ? 3 * handleScale : 0)} />)}
            </g>)}
          </g>
          {rotationLabel && <g pointerEvents="none" transform={`translate(${rotationLabel.x} ${rotationLabel.y}) scale(${handleScale})`}><rect x={-29} y={-13} width={58} height={26} rx={6} fill={theme.palette.background.paper} stroke={theme.palette.divider} /><text textAnchor="middle" y={5} fill={theme.palette.text.primary} fontSize={12} fontFamily="sans-serif">{Math.round((rotationLabel.angle % 360 + 360) % 360)}°</text></g>}
          {tool === 'cut' && <g pointerEvents="none" stroke="#d34256">
            {cutHoverPanel && <line x1={cutHoverPanel.points[cutHover.edgeIndex].x} y1={cutHoverPanel.points[cutHover.edgeIndex].y} x2={cutHoverPanel.points[(cutHover.edgeIndex + 1) % cutHoverPanel.points.length].x} y2={cutHoverPanel.points[(cutHover.edgeIndex + 1) % cutHoverPanel.points.length].y} strokeWidth={3 * handleScale} opacity={0.7} />}
            {cutPreview.length > 1 && <g fill="none" strokeLinejoin="round">
              <polyline points={polygonPoints(cutPreview)} strokeWidth={gutter} opacity={0.18} />
              <polyline points={polygonPoints(cutPreview)} strokeWidth={1.5 * handleScale} strokeDasharray={`${6 * handleScale} ${4 * handleScale}`} />
            </g>}
            {cutVertices.map((point, index) => <circle key={index} data-comic-cut-vertex cx={point.x} cy={point.y} r={5 * handleScale} fill="#d34256" stroke="white" strokeWidth={handleScale} />)}
            {cutHover && <circle cx={cutHover.point.x} cy={cutHover.point.y} r={6 * handleScale} fill="white" strokeWidth={2 * handleScale} />}
          </g>}
          {mode === 'ai' && page.aiWorkflow?.plan?.sections.flatMap((part) => part.instances.map((instance, index) => {
            const { frame, point } = comicAIControlPosition(page, part, instance);
            if (frame && page.layers.some((layer) => layer.id === frame.layerId && !layer.visible)) return null;
            const character = page.aiWorkflow.plan.characters.find((item) => item.id === instance.characterId);
            const label = `${index + 1} · ${character?.name || (language === 'zh' ? '场景' : 'Scene')}`;
            const selectedPoint = selectedControl?.sectionId === part.id && selectedControl?.instanceId === instance.id;
            return <g key={`${part.id}:${instance.id}`} data-comic-ai-control={`${part.id}:${instance.id}`} role="button" tabIndex={0} aria-label={label} aria-pressed={selectedPoint}
              transform={`translate(${point.x} ${point.y}) scale(${handleScale})`} style={{ cursor: directorBusy ? 'wait' : 'grab', outline: 'none' }}
              onFocus={() => { setSelectedControl({ sectionId: part.id, instanceId: instance.id }); }}
              onPointerDown={(event) => {
                event.stopPropagation(); event.preventDefault();
                setSelectedControl({ sectionId: part.id, instanceId: instance.id }); setDockCollapsed(false);
                event.currentTarget.focus({ preventScroll: true });
                if (directorBusy || generationAction?.loading || event.button !== 0) return;
                controlDrag.current = { pointerId: event.pointerId, before: pageRef.current, sectionId: part.id, instanceId: instance.id };
                event.currentTarget.setPointerCapture(event.pointerId);
              }} onPointerMove={(event) => {
                event.stopPropagation();
                const action = controlDrag.current;
                if (action?.pointerId === event.pointerId) moveAIControl(action.sectionId, action.instanceId, canvasPoint(event));
              }} onPointerUp={(event) => finishAIControl(event)} onPointerCancel={(event) => finishAIControl(event, true)} onLostPointerCapture={(event) => finishAIControl(event, true)}
              onKeyDown={(event) => {
                if (directorBusy || generationAction?.loading) return;
                const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
                if (delta) { event.preventDefault(); event.stopPropagation(); moveAIControl(part.id, instance.id, { x: point.x + delta[0] * (event.shiftKey ? 10 : 2), y: point.y + delta[1] * (event.shiftKey ? 10 : 2) }, true); }
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedControl({ sectionId: part.id, instanceId: instance.id }); setDockCollapsed(false); }
              }}>
              <title>{label}</title><circle r={isMobile ? 22 : 17} fill="transparent" />
              <circle r={selectedPoint ? 14 : 12} fill={theme.palette.primary.main} stroke={selectedPoint ? theme.palette.text.primary : '#fff'} strokeWidth={selectedPoint ? 3 : 2} />
              <text y={4} textAnchor="middle" fontSize={12} fontWeight={700} fill={theme.palette.primary.contrastText} pointerEvents="none">{index + 1}</text>
            </g>;
          }))}
          {characterBox && <g data-testid="comic-character-placement">
            <rect {...characterBox} fill={theme.palette.primary.main} fillOpacity={0.05} stroke={theme.palette.primary.main} strokeWidth={1.25 * handleScale} strokeDasharray={`${7 * handleScale} ${5 * handleScale}`} pointerEvents="none" />
            <g pointerEvents="none" transform={`translate(${characterBox.x + 6 * handleScale} ${characterBox.y + 6 * handleScale}) scale(${handleScale})`}>
              <rect width={`${characterPlacement.width} × ${characterPlacement.height}`.length * 7 + 14} height={20} rx={4} fill={theme.palette.primary.main} />
              <text x={8} y={14} fontSize={12} fontWeight={600} fill={theme.palette.primary.contrastText} fontFamily="sans-serif">{characterPlacement.width} × {characterPlacement.height}</text>
            </g>
            {characterPlacement.characters.map((character, index) => {
              const dragging = characterDrag?.index === index;
              const center = dragging ? characterDrag.center : normalizeNovelAICharacterCenter(character.center, character.position);
              const x = characterBox.x + center.x * characterBox.width, y = characterBox.y + center.y * characterBox.height;
              const name = character.name || w(`角色 ${index + 1}`, `Character ${index + 1}`);
              const label = `${index + 1} · ${name} (${center.x.toFixed(3)}, ${center.y.toFixed(3)})`;
              return <g key={index} data-comic-character={index} data-testid="comic-character-point" role="button" tabIndex={0} aria-label={label}
                transform={`translate(${x} ${y}) scale(${handleScale})`} opacity={character.isTemporarilyDisabled ? 0.45 : 1}
                style={{ cursor: dragging && characterDrag.pointerId !== null ? 'grabbing' : 'grab', outline: 'none' }}
                onPointerDown={(event) => {
                  event.stopPropagation(); event.preventDefault();
                  if (event.button !== 0) return;
                  event.currentTarget.focus({ preventScroll: true });
                  updateCharacterDrag({ index, pointerId: event.pointerId, center });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  event.stopPropagation();
                  const drag = characterDragRef.current;
                  if (drag?.pointerId === event.pointerId) updateCharacterDrag({ ...drag, center: characterCenterAtPoint(canvasPoint(event, false)) });
                }}
                onPointerUp={(event) => finishCharacterDrag(event, false)} onPointerCancel={(event) => finishCharacterDrag(event, true)} onLostPointerCapture={(event) => finishCharacterDrag(event, true)}
                onKeyDown={(event) => {
                  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
                  if (!delta) return;
                  event.preventDefault(); event.stopPropagation();
                  const amount = event.shiftKey ? 0.05 : 0.01;
                  characterPlacement.onMove(index, characterCenterAtPoint({
                    x: x + delta[0] * amount * characterBox.width, y: y + delta[1] * amount * characterBox.height,
                  }));
                }}>
                <title>{label}</title><circle r={isMobile ? 22 : 17} fill="transparent" />
                <circle r={dragging ? 14 : 12} fill={theme.palette.primary.main} stroke={dragging ? theme.palette.text.primary : '#fff'} strokeWidth={dragging ? 3 : 2} />
                <text y={4} textAnchor="middle" fontSize={12} fontWeight={700} fill={theme.palette.primary.contrastText} pointerEvents="none">{index + 1}</text>
                {dragging && <g pointerEvents="none" transform="translate(18 -10)">
                  <rect width={92} height={20} rx={4} fill={theme.palette.background.paper} stroke={theme.palette.divider} />
                  <text x={46} y={14} textAnchor="middle" fontSize={11} fill={theme.palette.text.primary} fontFamily="sans-serif" style={{ fontVariantNumeric: 'tabular-nums' }}>{center.x.toFixed(3)}, {center.y.toFixed(3)}</text>
                </g>}
              </g>;
            })}
          </g>}
          {rectangle && <rect x={Math.min(rectangle.start.x, rectangle.end.x)} y={Math.min(rectangle.start.y, rectangle.end.y)} width={Math.abs(rectangle.start.x - rectangle.end.x)} height={Math.abs(rectangle.start.y - rectangle.end.y)} fill={tool === 'overlay' ? '#bd711020' : '#287bcc20'} stroke={tool === 'overlay' ? '#bd7110' : '#287bcc'} strokeWidth={1.5 * handleScale} strokeDasharray={`${5 * handleScale} ${3 * handleScale}`} pointerEvents="none" />}
        </Box>
        {imageActionsPosition && <Paper role="group" aria-label={w('画框图像操作', 'Frame image actions')}
          data-comic-panel-image-actions data-testid="comic-panel-image-actions" elevation={0}
          onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
          sx={{
            position: 'absolute', ...imageActionsPosition, zIndex: 2, display: 'flex', gap: '2px', p: '2px',
            border: 1, borderColor: 'divider', borderRadius: 1.5, cursor: 'auto',
            '& .MuiButton-root': {
              width: imageButtonSize, minWidth: imageButtonSize, height: imageButtonSize, minHeight: imageButtonSize, p: 0,
              '& .MuiButton-startIcon': { m: 0 }, '& > .MuiBox-root': { display: 'none' },
            },
          }}>
          <ComicButton icon={UploadFile} label={c.upload} shortcut="Ctrl+O" onClick={() => { uploadTarget.current = target; upload.current.click(); }} />
          <ComicButton icon={ImageOutlined} label={c.gallery} onClick={() => openGallery()} />
          <ComicButton icon={CropFree} label={c.cropImage} shortcut="Shift+C" disabled={!selected.image} onClick={() => setCropId(selected.id)} />
          <ComicButton icon={DeleteOutline} label={c.removeImage} disabled={!selected.image} onClick={() => updatePanel(selected.id, { image: null })} />
        </Paper>}
        <Box sx={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', overflow: 'hidden', bgcolor: layersOpen ? 'primary.main' : 'background.paper', borderRadius: 1.5, border: 1, borderColor: 'divider' }}><ComicButton icon={LayersOutlined} label={c.layers} variant={layersOpen ? 'contained' : 'text'} sx={{ borderRadius: 0, boxShadow: 'none' }} onClick={() => setLayersOpen((open) => !open)} /></Box>
        {isMobile && <Typography role="status" data-testid="comic-tool-name" variant="caption" noWrap sx={{ position: 'absolute', left: 8, bottom: 6, maxWidth: '70%', px: 0.6, py: 0.2, borderRadius: 0.5, color: '#fff', bgcolor: '#20242a66', pointerEvents: 'none' }}>{spaceHeld ? c.hand : lastAction || (tool === 'text' ? c.text : tools.find(([id]) => id === tool)?.[2])}</Typography>}
      {layersOpen && <Box sx={{ position: 'absolute', right: 8, bottom: 48, zIndex: 4, maxWidth: 'calc(100% - 16px)', cursor: 'auto' }}>
        <ComicLayerPanel page={page} activeLayerId={activeLayerId} selectedItem={selectedItem} language={language} onClose={() => setLayersOpen(false)} onSelectLayer={(id) => { choose(null); setActiveLayerId(id); }} onSelectItem={(kind, id) => {
          const current = pageRef.current;
          const item = (kind === 'panel' ? current.panels : kind === 'element' ? current.elements : current.strokes).find((value) => value.id === id);
          const layer = current.layers.find((value) => value.id === item?.layerId);
          if (!item || layer.locked || !layer.visible) return;
          if (kind === 'panel') choose(item, current); else if (kind === 'element') chooseElement(item); else { choose(null); setSelectedStrokeId(item.id); setActiveLayerId(item.layerId); }
        }} onChange={changeLayers} />
      </Box>}
      </Box>
      <Paper data-testid="comic-canvas-actions" elevation={0} sx={{ alignSelf: 'center', maxWidth: 'calc(100% - 12px)', m: { xs: 0.75, sm: 1.25 }, p: 0.5, display: 'flex',
        flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 0.5, flexShrink: 0, border: 1, borderColor: 'divider', borderRadius: 2,
        '& .MuiButton-root': { minHeight: { xs: 34, md: 32 }, fontSize: 12, lineHeight: 1.25 } }}>
        {mode === 'manual' && <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          {generationVerification}
          <Button size="small" variant="contained" startIcon={<PlayArrow />} disabled={busy || directorBusy || generatingSequence || generationAction?.disabled || !selected}
            onClick={onGenerate}>{generationAction?.text || c.generate}{generationAction?.costLabel ? ` · ${generationAction.costLabel}` : ''}</Button>
        </Box>}
        {mode === 'manual' && onGenerateAll && (generatingSequence
          ? <Button size="small" color="warning" onClick={onStopSequence}>{w('停止后续分镜', 'Stop remaining panels')}</Button>
          : <Button size="small" disabled={busy || directorBusy || generationAction?.sequenceDisabled ||
            !page.panels.some((panel) => page.layers.some((layer) => layer.id === panel.layerId && layer.visible && !layer.locked))}
            onClick={onGenerateAll}>{w('按顺序生成全部分镜', 'Generate all panels in order')}</Button>)}
        {!directorEnabled && selected && <ComicButton icon={SettingsOutlined} label={c.editTask} onClick={() => onEditTask?.(selectedBounds)} />}
        {selectedElement && <ComicButton icon={SettingsOutlined} label={c.editElement} onClick={() => setElementEditorId(selectedElement.id)} />}
        <Box ref={setCanvasActions} sx={{ display: 'contents' }} />
        <ComicButton icon={dirty ? SaveOutlined : Check} label={c.savePage} tip={c.savedLocally} shortcut="Ctrl+S" disabled={busy} onClick={() => perform(savePage)} />
      </Paper>
      </Box>
      </Box>
    </Box>

    {compactAndroid && <Dialog open={active && toolsOpen} keepMounted onClose={() => setToolsOpen(false)} fullWidth maxWidth="xs" aria-labelledby="comic-tools-title">
      <DialogTitle id="comic-tools-title" sx={{ display: 'flex', alignItems: 'center', py: 1, fontSize: 16 }}><Box sx={{ flex: 1 }}>{language === 'zh' ? '绘图工具' : 'Drawing tools'}</Box><IconButton aria-label={c.close} onClick={() => setToolsOpen(false)}><Close /></IconButton></DialogTitle>
      <DialogContent dividers sx={{ p: 1 }}>{editingTools}</DialogContent>
    </Dialog>}
    {isMobile ? <Drawer anchor="right" open={active && pagesOpen} onClose={() => setPagesOpen(false)} slotProps={{ paper: { sx: { width: 'min(82vw, 290px)', p: 1, ...(compactAndroid ? { top: 'var(--mobile-top)', bottom: 'var(--mobile-bottom)', height: 'auto' } : {}) } } }}>{pageLibrary}</Drawer> : pageLibrary}

    <Menu open={Boolean(contextMenu)} onClose={() => setContextMenu(null)} onClick={() => setContextMenu(null)} anchorReference="anchorPosition" anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}>
      <MenuItem onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>{c.resetView}<Typography component="span" sx={{ ml: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+0</Typography></MenuItem>
      <MenuItem onClick={() => changeZoom(page.width / canvasSize.width)}>{c.actualSize}</MenuItem>
      <Divider />
      <MenuItem disabled={!history.current.undo.length} onClick={() => undo()}>{c.undo}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+Z</Typography></MenuItem>
      <MenuItem disabled={!history.current.redo.length} onClick={() => undo(true)}>{c.redo}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+Y</Typography></MenuItem>
      <Divider />
      <MenuItem onClick={() => setBalloonPicker(true)}>{c.dialogue}</MenuItem>
      <MenuItem onClick={() => changeTool('text')}>{c.text}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>T</Typography></MenuItem>
      <MenuItem onClick={() => setLayersOpen(true)}>{c.layers}</MenuItem>
      {selectedItem && <Divider />}
      {selectedElement && <MenuItem onClick={() => setElementEditorId(selectedElement.id)}>{c.editElement}</MenuItem>}
      {selected?.image && <MenuItem onClick={() => setCropId(selected.id)}>{c.cropImage}</MenuItem>}
      {selectedItem && [<MenuItem key="duplicate" onClick={duplicateSelection}>{c.duplicate}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+J</Typography></MenuItem>, <MenuItem key="up" onClick={() => moveLayer(1)}>{c.contentForward}</MenuItem>, <MenuItem key="down" onClick={() => moveLayer(-1)}>{c.contentBackward}</MenuItem>, <MenuItem key="delete" sx={{ color: 'error.main' }} onClick={deleteSelection}>{c.deleteContent}</MenuItem>]}
    </Menu>

    <Dialog open={Boolean(canvasDimensions)} onClose={() => !busy && setCanvasDimensions(null)} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => {
        event.preventDefault();
        const width = Number(canvasDimensions.width), height = Number(canvasDimensions.height);
        if (![width, height].every((value) => Number.isInteger(value) && value > 0)) return;
        perform(async () => {
          cancelDrag();
          const bounds = sectionBounds({ ...pageRef.current, width, height });
          // 默认尺寸只记录一页的短边和长边，打开旧页或切换双页时不会覆盖或翻倍。
          const defaults = { width: Math.min(bounds.width, bounds.height), height: Math.max(bounds.width, bounds.height) };
          await saveComicCanvasDefaults(defaults);
          setCanvasDefaults(defaults);
          const current = pageRef.current;
          if (width !== current.width || height !== current.height) replacePage(resizeComicPage(current, width, height));
          setCut(null); setView({ zoom: 1, x: 0, y: 0 }); setCanvasDimensions(null);
        });
      }}>
        <DialogTitle>{c.canvasSize}</DialogTitle>
        <DialogContent sx={{ display: 'flex', gap: 1.5, pt: '12px !important' }}>
          {['width', 'height'].map((dimension) => {
            const value = canvasDimensions?.[dimension] ?? '';
            const invalid = !Number.isInteger(Number(value)) || Number(value) <= 0;
            return <TextField key={dimension} autoFocus={dimension === 'width'} disabled={busy} fullWidth type="number" size="small" label={c[dimension]} value={value} error={invalid} helperText={invalid ? c.canvasSizeError : null} slotProps={{ htmlInput: { min: 1, step: 1, inputMode: 'numeric' } }} onChange={(event) => setCanvasDimensions({ ...canvasDimensions, [dimension]: event.target.value })} />;
          })}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setCanvasDimensions(null)}>{c.cancel}</Button>
          <Tooltip title={c.canvasSizeTip}><span><Button type="submit" variant="contained" disabled={busy || !canvasDimensions || !Object.values(canvasDimensions).every((value) => Number.isInteger(Number(value)) && Number(value) > 0)}>{c.confirm}</Button></span></Tooltip>
        </DialogActions>
      </Box>
    </Dialog>

    <Dialog open={balloonPicker} onClose={() => setBalloonPicker(false)} maxWidth="md" fullWidth aria-labelledby="comic-balloon-title">
      <DialogTitle id="comic-balloon-title" sx={{ py: 1.5, fontSize: 16 }}>{c.dialogue}</DialogTitle>
      <DialogContent dividers sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.7, mb: 1.2 }}>
          <ComicButton icon={UploadFile} label={c.uploadBalloon} onClick={() => { elementUploadKind.current = 'bubble'; elementUpload.current.click(); }} />
          <ComicButton icon={TextFields} label={c.text} tip={c.textTip} shortcut="T" onClick={() => { changeTool('text'); setBalloonPicker(false); }} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3,minmax(0,1fr))', sm: 'repeat(4,minmax(0,1fr))' }, gap: 1 }}>
          {COMIC_BALLOON_PRESETS.map((preset) => {
            const ratio = preset.aspectRatio || 4 / 3;
            const previewWidth = Math.min(240, 180 * ratio), previewHeight = previewWidth / ratio;
            return <ButtonBase key={preset.id} aria-label={preset.name[language]} onClick={() => {
              const width = Math.min(page.width * 0.4, page.height * 0.4 * ratio), height = width / ratio;
              insertElement('bubble', { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height }, { presetId: preset.id, name: preset.name[language] });
            }} sx={{ minWidth: 0, display: 'block', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.7, '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' } }}>
            <Box component="svg" viewBox="0 0 240 180" sx={{ display: 'block', width: '100%', height: { xs: 76, sm: 112 } }}><ComicElementArt element={createComicElement('bubble', { x: (240 - previewWidth) / 2, y: (180 - previewHeight) / 2, width: previewWidth, height: previewHeight }, { presetId: preset.id })} fonts={[]} /></Box>
            <Typography variant="caption" noWrap component="div">{preset.name[language]}</Typography>
          </ButtonBase>; })}
        </Box>
      </DialogContent>
      <DialogActions><ComicButton icon={Close} label={c.close} onClick={() => setBalloonPicker(false)} /></DialogActions>
    </Dialog>
    {editingElement && <ComicElementDialog key={editingElement.id} element={editingElement} fonts={page.fonts} language={language} onClose={() => setElementEditorId(null)} onApply={(element, fonts) => {
      const current = pageRef.current;
      replacePage({ ...current, fonts, elements: current.elements.map((item) => item.id === element.id ? element : item) }); setElementEditorId(null);
    }} />}

    <Dialog open={templatePicker} onClose={() => setTemplatePicker(false)} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontSize: 16, py: 1.5 }}>{c.templates}{COMIC_LAYOUTS[page.layout].sections === 2 ? ` · ${sectionLabels[section]}` : ''}</DialogTitle>
      <Tabs value={templateTab} onChange={(_, value) => setTemplateTab(value)} sx={{ px: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: 12 } }}><Tab label={`${c.presets} ${COMIC_TEMPLATES.length}`} /><Tab label={c.custom} /></Tabs>
      <DialogContent dividers sx={{ p: 2, maxHeight: '65vh' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3,minmax(0,1fr))', sm: 'repeat(5,minmax(0,1fr))', md: 'repeat(7,minmax(0,1fr))' }, gap: 1 }}>
          {(templateTab ? templates : COMIC_TEMPLATES).map((template) => <Box key={template.id} sx={{ position: 'relative' }}>
            <ButtonBase aria-label={template.name[language]} onClick={() => applyPreset(template)} sx={{ display: 'block', width: '100%', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.65, '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}>
              <Box component="svg" viewBox="-0.06 -0.06 1.12 1.12" preserveAspectRatio="none" sx={{ bgcolor: 'white', height: 108, width: '100%', display: 'block' }}>
                {template.panels.map((panel, index) => <polygon key={index} points={polygonPoints(panel.points)} fill="none" stroke={panel.type === 'overlay' ? '#bd7110' : '#202027'} strokeWidth={0.018} strokeDasharray={panel.borderWidth === 0 ? '0.04 0.03' : undefined} />)}
              </Box><Typography variant="caption" noWrap component="div" sx={{ mt: 0.5, fontSize: 11 }}>{template.name[language]}</Typography>
            </ButtonBase>
            {templateTab === 1 && <IconButton size="small" aria-label={c.templateDelete} sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'background.paper' }} onClick={() => perform(async () => { await deleteComicTemplate(template.id); setTemplates(templates.filter((item) => item.id !== template.id)); })}><DeleteOutline sx={{ fontSize: 15 }} /></IconButton>}
          </Box>)}
        </Box>
      </DialogContent><DialogActions sx={{ py: 0.6 }}><ComicButton icon={Close} label={c.close} onClick={() => setTemplatePicker(false)} /></DialogActions>
    </Dialog>
    {cropPanel?.image && <ComicCropDialog key={cropPanel.id} panel={cropPanel} onClose={() => setCropId(null)} onApply={(image) => { updatePanel(cropPanel.id, { image }); setCropId(null); }} />}
    <Dialog open={Boolean(gallery)} onClose={() => setGallery(null)} maxWidth="md" fullWidth>
      <DialogTitle>{c.gallery}</DialogTitle><Tabs value={galleryTab} onChange={(_, value) => setGalleryTab(value)} sx={{ px: 3 }}><Tab label={c.recent} /><Tab label={c.personal} /></Tabs>
      <DialogContent dividers>
        {galleryTab === 1 && gallery?.failed && <Alert severity="error">{c.galleryError}</Alert>}
        {galleryTab === 1 && gallery?.loading && !gallery.entries.length ? <Typography>{c.loading}</Typography> : <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 1 }}>
          {(galleryTab ? gallery?.entries || [] : generatedItems.filter((item) => item.type !== 'video')).map((item, index) => <ButtonBase key={item.id} disabled={busy} aria-label={`${c.panel} ${index + 1}`} onClick={() => perform(async () => { const blob = galleryTab ? await fetchUrlAsBlob((await comicClient.getGalleryEntry(item.id)).url) : await fetchUrlAsBlob(item.src); await addImage(blob, gallery.target); setGallery(null); }, c.imageError)} sx={{ display: 'block', overflow: 'hidden', borderRadius: 1 }}>
            <Box component="img" src={galleryTab ? item.thumbnail_url : item.src} alt={item.title || item.prompt || ''} loading="lazy" sx={{ width: '100%', height: 140, objectFit: 'cover' }} />
          </ButtonBase>)}
        </Box>}
        {galleryTab === 1 && (gallery?.hasMore || gallery?.failed) && <Button disabled={gallery.loading} onClick={() => openGallery(true)}>{gallery.loading ? c.loading : c.loadMore}</Button>}
      </DialogContent><DialogActions><ComicButton icon={Close} label={c.close} onClick={() => setGallery(null)} /></DialogActions>
    </Dialog>
    <Dialog open={templateDialog} onClose={() => setTemplateDialog(false)} maxWidth="xs" fullWidth>
      <DialogTitle>{c.saveTemplate}</DialogTitle><DialogContent><TextField autoFocus fullWidth label={c.templateName} value={templateName} onChange={(event) => setTemplateName(event.target.value)} sx={{ mt: 1 }} /></DialogContent>
      <DialogActions><ComicButton icon={Close} label={c.cancel} onClick={() => setTemplateDialog(false)} /><ComicButton icon={SaveOutlined} label={c.save} disabled={!templateName.trim() || busy} onClick={() => perform(async () => { const template = await saveComicTemplate(createComicTemplate(page, section, templateName.trim())); setTemplates([...templates, template]); setTemplateTab(1); setTemplateDialog(false); setNotice({ severity: 'success', text: c.templateSaved }); })} /></DialogActions>
    </Dialog>
    <Dialog open={Boolean(confirmation)} onClose={() => setConfirmation(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{confirmation?.kind === 'navigate' ? c.discardTitle : confirmation?.kind === 'delete' ? c.deleteTitle : c.replaceTitle}</DialogTitle>
      <DialogContent>{confirmation?.kind === 'navigate' ? c.discardBody : confirmation?.kind === 'delete' ? c.deleteBody : c.replaceBody}</DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}><ComicButton icon={Close} label={c.cancel} onClick={() => setConfirmation(null)} />
        <ComicButton icon={confirmation?.kind === 'delete' ? DeleteOutline : Check} label={confirmation?.kind === 'navigate' ? c.discard : c.confirm} color={confirmation?.kind === 'delete' ? 'error' : 'primary'} disabled={busy} onClick={() => { const action = confirmation.action; setConfirmation(null); perform(action); }} />
        {confirmation?.kind === 'navigate' && <ComicButton icon={SaveOutlined} label={c.saveContinue} variant="contained" disabled={busy} onClick={() => { const action = confirmation.action; perform(async () => { if (await savePage()) { setConfirmation(null); action(); } }); }} />}
      </DialogActions>
    </Dialog>
    <Snackbar open={Boolean(notice) && active} autoHideDuration={4500} onClose={() => setNotice(null)}><Alert severity={notice?.severity || 'info'} onClose={() => setNotice(null)}>{notice?.text}</Alert></Snackbar>
  </Box>;
});

export default ComicWorkspace;
