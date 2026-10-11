"use client";

import { createClientId } from '../../../utils/browserCapabilities.mjs';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, IconButton, Menu, MenuItem, Paper, Slider, Snackbar, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Add, ArrowBack, ArrowDownward, ArrowForward, ArrowUpward, BrushOutlined, Check, Close, ContentCopy, ContentCut, CropFree, DashboardOutlined, DeleteOutline, Download, Flip, ImageOutlined, LayersOutlined, Menu as MenuIcon, MouseOutlined, PanToolOutlined, PlayArrow, Redo, SaveOutlined, SettingsOutlined, TextFields, Undo, UploadFile, ZoomIn, ChatBubbleOutline, AutoAwesome } from '@mui/icons-material';
import { Eraser } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useI18n } from '@/i18n/I18nProvider';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';
import apiClient from '@/utils/ApiClient';
import { COMIC_LAYOUTS, COMIC_TEMPLATES, applyTemplate, convertPanelType, createComicPage, createComicTemplate, createRectanglePanel, fitPanelImage, movePanel, movePanelEdge, movePanelVertex, panelBounds, sectionBounds, splitPanel } from './comicDocument.mjs';
import { deleteComicPage, deleteComicTemplate, exportComicZip, importComicProject, loadComicLibrary, saveComicDraft, saveComicPage, saveComicTemplate } from './comicStorage.mjs';
import { exportComicProject, readComicProject } from './comicProject.mjs';
import ComicCropDialog from './ComicCropDialog';
import ComicElementArt from './ComicElementArt';
import ComicElementDialog from './ComicElementDialog';
import ComicLayerPanel from './ComicLayerPanel';
import { COMIC_BALLOON_PRESETS, comicElementMatrix, createComicElement, loadComicFonts, readComicAsset } from './comicElements.mjs';
import { ensureComicLayers, getComicRenderItems, reorderComicItem } from './comicLayers.mjs';
import messages from './comicMessages';

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M25 13a10 10 0 1 0 1 8M25 5v8h-8" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 13a10 10 0 1 0 1 8M25 5v8h-8" fill="none" stroke="#222" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')}") 16 16, grab`;

const polygonPoints = (points) => points.map(({ x, y }) => `${x},${y}`).join(' ');

/** 工具和操作共用图标按钮：手机只显示图标，名称与快捷键保留在提示和无障碍标签中。 */
function ComicButton({ label, icon: Icon, shortcut, tip, sx, ...props }) {
  return <Tooltip disableInteractive title={`${tip || label}${shortcut ? ` (${shortcut})` : ''}`}>
    <span style={{ display: 'inline-flex' }}><Button {...props} aria-label={label} data-action-label={label} size="small" startIcon={<Icon />} sx={{ minWidth: { xs: 34, md: 0 }, minHeight: { xs: 34, md: 27 }, px: 0.8, py: 0.4, fontSize: 11, '& .MuiButton-startIcon': { mr: { xs: 0, md: 0.7 }, ml: 0 }, '& .MuiButton-startIcon > svg': { width: 18, height: 18 }, ...sx }}><Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>{label}</Box></Button></span>
  </Tooltip>;
}

/** 分镜编辑器与页面缩略图共用绘制顺序，透明图像透出下层分镜。 */
function PageArt({ page, prefix }) {
  function panelArt(panel) {
    const image = panel.image;
    return <g key={panel.id}>
      <defs><clipPath id={`${prefix}-${panel.id}`}><polygon points={polygonPoints(panel.points)} /></clipPath></defs>
      {image && <image href={image.dataUrl} x={image.x} y={image.y} width={image.width * image.scale} height={image.height * image.scale} clipPath={`url(#${prefix}-${panel.id})`} />}
      <polygon points={polygonPoints(panel.points)} fill="none" stroke="#111111" strokeWidth={panel.borderWidth} strokeLinejoin="round" />
    </g>;
  }
  return <g pointerEvents="none">
    <rect width={page.width} height={page.height} fill="white" />
    {getComicRenderItems(page).map(({ kind, item }) => {
      if (kind === 'panel') return panelArt(item);
      if (kind === 'element') return <ComicElementArt key={item.id} element={item} fonts={page.fonts} />;
      return item.points.length === 1
        ? <circle key={item.id} cx={item.points[0].x} cy={item.points[0].y} r={item.width / 2} fill={item.kind === 'erase' ? '#ffffff' : item.color} />
        : <polyline key={item.id} points={polygonPoints(item.points)} fill="none" stroke={item.kind === 'erase' ? '#ffffff' : item.color} strokeWidth={item.width} strokeLinecap="round" strokeLinejoin="round" />;
    })}
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

/** 左侧工具、中央画布与右侧页面库；生成表单由生成页复用现有参数面板。 */
const ComicWorkspace = forwardRef(function ComicWorkspace({ generatedItems = [], onSelectTask, onEditTask, onSaveTask, onGenerate, generationAction, active = true }, ref) {
  const { locale } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
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
  const [cursor, setCursor] = useState(null);
  const [rectangle, setRectangle] = useState(null);
  const [cropId, setCropId] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [galleryTab, setGalleryTab] = useState(0);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view); viewRef.current = view;
  const zoom = view.zoom;
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 420 });
  const [pagesOpen, setPagesOpen] = useState(false);
  const [lastAction, setLastAction] = useState('');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef({ undo: [], redo: [] });
  const svg = useRef(null);
  const viewport = useRef(null);
  const viewDrag = useRef(null);
  const keyboardActions = useRef(null);
  const drag = useRef(null);
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

  useEffect(() => {
    let mounted = true;
    loadComicLibrary().then((library) => {
      if (!mounted) return;
      pagesRef.current = library.pages; setPages(library.pages); setTemplates(library.templates);
      const draft = ensureComicLayers(library.draft || createComicPage()); pageRef.current = draft; setPage(draft); setActiveLayerId(draft.layers[0].id);
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
    if (!pageWidth || !viewport.current) return;
    const element = viewport.current;
    const resize = () => {
      const ratio = Math.min(Math.max(1, element.clientWidth - 64) / pageWidth, Math.max(1, element.clientHeight - 64) / pageHeight);
      setCanvasSize({ width: pageWidth * ratio, height: pageHeight * ratio });
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, [pageWidth, pageHeight, active]);

  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); }, [page?.id, page?.layout]);

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
  useImperativeHandle(ref, () => ({ saveTask: rememberTask, receiveGeneratedImage: receiveImage }));

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
    if (event.target.closest('button, input, [role="menu"], [data-comic-layers]')) return;
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
    if (!action) return;
    const next = { ...action.view, x: action.view.x + event.clientX - action.x, y: action.view.y + event.clientY - action.y };
    viewRef.current = next; setView(next);
  }
  function canvasPoint(event, clamp = true) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current.getScreenCTM().inverse());
    if (!clamp) return { x: point.x, y: point.y };
    return { x: Math.max(0, Math.min(page.width, point.x)), y: Math.max(0, Math.min(page.height, point.y)) };
  }
  function nearestBorder(panel, point) {
    let nearest = null;
    panel.points.forEach((a, index) => {
      const b = panel.points[(index + 1) % panel.points.length]; const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
      const p = { x: a.x + t * dx, y: a.y + t * dy }; const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (!nearest || distance < nearest.distance) nearest = { ...p, distance };
    });
    return nearest;
  }
  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary) return;
    // 阻止浏览器拖拽原图或选择 SVG 文字，否则第一步移动就会取消画笔手势。
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const point = canvasPoint(event); const current = pageRef.current;
    const element = event.target.closest('[data-panel]'); const panel = current.panels.find((item) => item.id === element?.dataset.panel);
    const artwork = current.elements.find((item) => item.id === event.target.closest('[data-element]')?.dataset.element);
    if (tool === 'cut') {
      const cuttingPanel = cut ? current.panels.find((item) => item.id === cut.panelId) : selected || panel;
      if (!cuttingPanel) return;
      const cuttingLayer = current.layers.find((item) => item.id === cuttingPanel.layerId);
      if (!cuttingLayer.visible || cuttingLayer.locked) { setCut(null); setNotice({ severity: 'info', text: c.layerUnavailable }); return; }
      const near = nearestBorder(cuttingPanel, point); const tolerance = current.width / svg.current.getBoundingClientRect().width * 24;
      if (near.distance > tolerance) { setNotice({ severity: 'info', text: c.cutError }); return; }
      if (!cut) { setCut({ panelId: cuttingPanel.id, start: { x: near.x, y: near.y } }); choose(cuttingPanel); }
      else {
        const nextOrder = getComicRenderItems(current).find(({ item }) => item.layerId === cuttingPanel.layerId && item.order > cuttingPanel.order)?.item.order;
        const parts = splitPanel(cuttingPanel, cut.start, near, gutter, nextOrder);
        if (!parts) { setNotice({ severity: 'info', text: c.cutError }); return; }
        parts.sort((a, b) => panelBounds(a).y - panelBounds(b).y || panelBounds(a).x - panelBounds(b).x);
        replacePage({ ...current, panels: current.panels.flatMap((item) => item.id === cuttingPanel.id ? parts : [item]) }); setCut(null); choose(null);
      }
      return;
    }
    if (tool === 'select') {
      const handle = event.target.dataset.handle;
      if (artwork) {
        if (artwork.id !== selectedElementId) chooseElement(artwork);
        if (handle) {
          const matrix = new DOMMatrix(comicElementMatrix(artwork));
          const center = new DOMPoint(artwork.width / 2, artwork.height / 2).matrixTransform(matrix);
          drag.current = { kind: `element-${handle}`, element: artwork, start: canvasPoint(event, false), before: current, inverse: matrix.inverse(), center, index: Number(event.target.dataset.index) };
        }
      } else {
        if (panel?.id !== selectedId || selectedElementId) choose(panel);
        // 点画框只选中；整框位移只从外置端点开始，避免误拖大块画面。
        if (panel && handle) drag.current = { kind: handle, index: Number(event.target.dataset.index), panel, start: canvasPoint(event, false), before: current };
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
    if (drag.current) event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    const point = canvasPoint(event);
    if (cut) setCursor(point);
    const action = drag.current; if (!action) return;
    const current = pageRef.current;
    if (action.kind === 'rectangle' || action.kind === 'text') { setRectangle({ start: action.start, end: point }); return; }
    if (action.kind === 'brush') { replacePage({ ...current, strokes: current.strokes.map((stroke) => stroke.id === action.strokeId ? { ...stroke, points: [...stroke.points, point] } : stroke) }, false); return; }
    if (action.element) {
      const start = action.element; const raw = canvasPoint(event, false);
      let changes;
      if (action.kind === 'element-move') changes = { x: start.x + raw.x - action.start.x, y: start.y + raw.y - action.start.y };
      else if (action.kind === 'element-rotate') {
        const angle = Math.atan2(raw.y - action.center.y, raw.x - action.center.x) - Math.atan2(action.start.y - action.center.y, action.start.x - action.center.x);
        let rotation = start.rotation + angle * 180 / Math.PI;
        if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
        changes = { rotation };
      } else {
        const local = new DOMPoint(raw.x, raw.y).matrixTransform(action.inverse);
        const corner = action.index;
        const left = corner === 0 || corner === 3, top = corner < 2;
        let width = Math.max(24, left ? start.width - local.x : local.x), height = Math.max(24, top ? start.height - local.y : local.y);
        if (event.shiftKey) height = width * start.height / start.width;
        // 固定对角点，将缩放后的局部中心沿原变换移动，旋转/镜像时也不跳位。
        const matrix = comicElementMatrix(start);
        const dx = (left ? start.width - width : width - start.width) / 2;
        const dy = (top ? start.height - height : height - start.height) / 2;
        const centerX = action.center.x + matrix[0] * dx + matrix[2] * dy;
        const centerY = action.center.y + matrix[1] * dx + matrix[3] * dy;
        changes = { width, height, x: centerX - width / 2, y: centerY - height / 2 };
      }
      replacePage({ ...current, elements: current.elements.map((item) => item.id === start.id ? { ...item, ...changes } : item) }, false); return;
    }
    const bounds = sectionBounds(current, action.panel.type === 'overlay' ? -1 : action.panel.section);
    const moved = action.kind === 'vertex' ? movePanelVertex(action.panel, action.index, point, bounds)
      : action.kind === 'move' ? movePanel(action.panel, { x: canvasPoint(event, false).x - action.start.x, y: canvasPoint(event, false).y - action.start.y }, bounds)
        : movePanelEdge(action.panel, action.index, { x: point.x - action.start.x, y: point.y - action.start.y }, bounds);
    replacePage({ ...current, panels: current.panels.map((panel) => {
      if (panel.id !== moved.id) return panel;
      // 只替换拖动改变的几何，期间刚回填的图片和任务继续保留。
      const image = action.kind === 'move' && panel.image ? { ...panel.image, x: panel.image.x + moved.points[0].x - panel.points[0].x, y: panel.image.y + moved.points[0].y - panel.points[0].y } : panel.image;
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
      const image = action.kind === 'move' && panel.image ? { ...panel.image, x: panel.image.x + action.panel.points[0].x - panel.points[0].x, y: panel.image.y + action.panel.points[0].y - panel.points[0].y } : panel.image;
      return { ...panel, points: action.panel.points, image };
    }) };
  }
  function cancelDrag() {
    if (!drag.current) return;
    replacePage(pageBeforeDrag(drag.current), false); drag.current = null; setRectangle(null);
  }
  function pointerUp(event) {
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
      const result = await apiClient.getGallery({ source: 'outputs', offset: previousEntries.length, limit: 60 });
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
    if (event.isComposing || !pageRef.current || !viewport.current?.getClientRects().length || event.target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="listbox"]')) return;
    // 弹窗和参数输入保留各自的快捷键；只有漫画画布接管编辑命令。
    if (pagesOpen || cropId || gallery || templatePicker || templateDialog || confirmation || balloonPicker || elementEditorId || contextMenu || [...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden')) return;
    const key = event.key.toLowerCase(); const command = event.ctrlKey || event.metaKey;
    if (key === 'escape' && event.target.closest('[data-comic-layers]')) return;
    let action;
    let label;
    if (command && key === 'z') { action = () => undo(event.shiftKey); label = event.shiftKey ? c.redo : c.undo; }
    else if (command && key === 'y') { action = () => undo(true); label = c.redo; }
    else if (command && key === 's') { action = event.shiftKey ? () => { setTemplateName(''); setTemplateDialog(true); } : () => perform(savePage); label = event.shiftKey ? c.saveTemplate : c.savePage; }
    else if (command && key === 'n') { action = () => navigate(createComicPage(page.layout), true); label = c.newPage; }
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
      if (nextTool) { action = () => { setTool(nextTool); setCut(null); }; label = nextTool === 'overlay' ? overlayLabel : c[nextTool]; }
    }
    if (!action) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat || event.code === 'Space' || ['[', ']'].includes(key)) { action(); setLastAction(label); }
  };

  if (!page) return <Box sx={{ p: 4 }}><Typography>{c.loading}</Typography></Box>;
  const sectionLabels = page.layout === 'spreadPortrait' ? [c.left, c.right] : [c.top, c.bottom];
  const editableItems = getComicRenderItems(page).filter(({ kind, item }) => kind !== 'stroke' && !page.layers.find((layer) => layer.id === item.layerId)?.locked);
  const handleScale = page.width / canvasSize.width / zoom;
  const selectedBounds = selected ? panelBounds(selected) : null;
  const moveHandleAbove = selectedBounds && selectedBounds.y > 40 * handleScale;
  const panelMoveHandle = selectedBounds ? { x: selectedBounds.x + selectedBounds.width / 2, y: moveHandleAbove ? selectedBounds.y - 28 * handleScale : selectedBounds.y + selectedBounds.height + 28 * handleScale, anchorY: moveHandleAbove ? selectedBounds.y : selectedBounds.y + selectedBounds.height } : null;
  const tools = [
    ['select', MouseOutlined, c.select, c.selectTip, 'V'], ['cut', ContentCut, c.cut, c.cutTip, 'C'], ['rectangle', CropFree, c.rectangle, c.rectangleTip, 'U'],
    ['overlay', LayersOutlined, overlayLabel, language === 'zh' ? '拖出可跨越分镜的上层画框，支持透明人物立绘' : 'Draw an overlay across panels; transparent character images are supported', 'Shift+U'],
    ['brush', BrushOutlined, c.brush, c.brushTip, 'B'], ['eraser', Eraser, c.eraser, c.eraserTip, 'E'],
    ['hand', PanToolOutlined, c.hand, c.handTip, 'H / Space'], ['zoom', ZoomIn, c.zoom, c.zoomTip, 'Z'],
  ];
  const pageLibrary = (<Box component="aside" sx={{ p: 0.8, borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.65, minHeight: 0, overflowY: 'auto', height: '100%', '& .MuiTypography-subtitle2': { fontSize: 11 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><Typography variant="subtitle2">{c.pages}</Typography><Chip size="small" label={pages.length} />{isMobile && <ComicButton icon={Close} label={c.close} onClick={() => setPagesOpen(false)} />}</Box>
      <TextField fullWidth hiddenLabel size="small" placeholder={c.pageTitle} slotProps={{ htmlInput: { 'aria-label': c.pageTitle } }} value={page.title} onChange={(event) => replacePage({ ...page, title: event.target.value })} sx={{ '& .MuiInputBase-input': { height: 34, boxSizing: 'border-box', py: 0, px: 1, lineHeight: 'normal' } }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.65, '& > span': { width: '100%' }, '& .MuiButton-root': { width: '100%', minHeight: 32, justifyContent: { xs: 'center', md: 'flex-start' }, px: 1 } }}>
        <ComicButton icon={Add} label={c.newPage} shortcut="Ctrl+N" variant="outlined" disabled={busy} onClick={() => navigate(createComicPage(page.layout), true)} />
        <ComicButton icon={SaveOutlined} label={c.exportProject} tip={c.exportProjectTip} variant="contained" disabled={busy} onClick={() => perform(async () => {
          if (selectedIdRef.current) onSaveTask?.();
          const blob = await exportComicProject({ pages: pagesRef.current, templates, draft: pageRef.current });
          saveAs(blob, 'comic-project.zip');
          setNotice({ severity: 'success', text: c.projectExported });
        }, c.exportError)} />
        <ComicButton icon={UploadFile} label={c.importProject} tip={c.importProjectTip} variant="outlined" disabled={busy} onClick={() => projectUpload.current.click()} />
        <ComicButton icon={Download} label={busy ? c.exportBusy : c.export} tip={c.exportImagesTip} variant="outlined" disabled={busy || !pages.length} onClick={() => perform(async () => { const blob = await exportComicZip(pagesRef.current); saveAs(blob, 'comic-pages.zip'); }, c.exportError)} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>{dirty ? c.unsaved : c.saved} · {c.draft}</Typography>
      <Divider />
      {!pages.length && <Typography color="text.secondary" variant="body2" sx={{ py: 3, textAlign: 'center' }}>{c.noPages}</Typography>}
      {pages.map((item, index) => <Paper key={item.id} variant="outlined" sx={{ p: 0.6, borderColor: item.id === page.id ? 'primary.main' : 'divider', flexShrink: 0 }}>
        <ButtonBase onClick={() => { if (item.id !== page.id) navigate(item); }} sx={{ width: '100%', display: 'block', textAlign: 'left' }} aria-label={`${String(index + 1).padStart(3, '0')} ${item.title}`}>
          <Box component="svg" viewBox={`0 0 ${item.width} ${item.height}`} sx={{ display: 'block', width: '100%', height: 104, bgcolor: 'action.hover' }}><PageArt page={item} prefix={`thumb-${item.id}`} /></Box>
          <Typography variant="caption" noWrap component="div" sx={{ mt: 0.5 }}>{String(index + 1).padStart(3, '0')} · {item.title || c.pages}</Typography>
        </ButtonBase>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><IconButton size="small" aria-label={c.moveUp} disabled={!index || busy} onClick={() => perform(() => reorderPage(index, -1))}><ArrowUpward sx={{ fontSize: 16 }} /></IconButton><IconButton size="small" aria-label={c.moveDown} disabled={index === pages.length - 1 || busy} onClick={() => perform(() => reorderPage(index, 1))}><ArrowDownward sx={{ fontSize: 16 }} /></IconButton><IconButton size="small" aria-label={c.deletePage} onClick={() => setConfirmation({ kind: 'delete', action: async () => { await deleteComicPage(item.id); pagesRef.current = pagesRef.current.filter((saved) => saved.id !== item.id); setPages(pagesRef.current); if (pageRef.current.id === item.id) loadPage(createComicPage(item.layout), true); } })}><DeleteOutline sx={{ fontSize: 16 }} /></IconButton></Box>
      </Paper>)}
    </Box>);
  const panelColor = selected?.type === 'overlay' ? '#bd7110' : '#287bcc';
  return <Box data-testid="comic-workspace" onClickCapture={(event) => { const button = event.target.closest('button'); const label = button?.dataset.actionLabel || button?.getAttribute('aria-label'); if (label) setLastAction(label); }} sx={{ position: 'relative', height: '100%', minHeight: { xs: 0, md: 480 }, maxHeight: { xs: 'calc(100dvh - 110px)', md: 'none' }, display: 'grid', gridTemplateColumns: { xs: '46px minmax(0,1fr)', md: '146px minmax(0,1fr) 164px' }, bgcolor: 'background.default', borderRadius: 1, overflow: 'hidden', '& .MuiButton-root': { fontSize: 11, minWidth: 0, lineHeight: 1.45, textTransform: 'none' }, '& .MuiSvgIcon-root': { fontSize: 17 }, '& .MuiOutlinedInput-root': { fontSize: 11 }, '& .MuiInputBase-input, & .MuiSelect-select': { py: 0.8 }, '& .MuiInputLabel-root': { fontSize: 11 }, '& .MuiTypography-caption': { fontSize: 10 }, '& .MuiChip-root': { height: 21, fontSize: 10 }, '& .MuiToggleButton-root': { fontSize: 11, py: 0.4, px: 1 }, '& .MuiSlider-root': { py: 1.2 }, '& .MuiSlider-thumb': { width: 10, height: 10 } }}>
    <input ref={projectUpload} type="file" hidden accept=".zip,application/zip" aria-label={c.importProject} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      perform(async () => {
        const project = await readComicProject(file);
        const images = new Set(project.pages.flatMap((item) => [...item.panels.map((panel) => panel.image?.dataUrl), ...item.elements.map((element) => element.dataUrl)]).filter(Boolean));
        // 自定义素材遵循上传时同样的校验，损坏图片、危险 SVG 或坏字体不落库。
        for (const dataUrl of images) {
          const blob = await (await fetch(dataUrl)).blob();
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
    <Box component="aside" sx={{ p: { xs: 0.4, md: 0.8 }, minHeight: 0, bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', overflowY: 'auto', '& .MuiButton-root': { justifyContent: { xs: 'center', md: 'flex-start' }, width: '100%' }, '& .MuiTypography-subtitle2': { fontSize: 11 } }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5, display: { xs: 'none', md: 'block' } }}>{c.templates}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
        <ComicButton variant="outlined" icon={DashboardOutlined} label={language === 'zh' ? '选择模板' : 'Templates'} onClick={() => setTemplatePicker(true)} />
        <ComicButton icon={Add} label={c.blank} onClick={() => applyPreset(COMIC_TEMPLATES[0])} />
        <ComicButton icon={SaveOutlined} label={c.saveTemplate} shortcut="Ctrl+Shift+S" onClick={() => { setTemplateName(''); setTemplateDialog(true); }} />
      </Box>
      <Divider sx={{ my: 0.75 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        {tools.map(([id, Icon, label, tip, shortcut]) => <ComicButton key={id} icon={Icon} label={label} tip={tip} shortcut={shortcut} onClick={() => { setTool(id); setCut(null); }} onDoubleClick={id === 'hand' ? () => setView({ zoom: 1, x: 0, y: 0 }) : undefined} variant={tool === id ? 'contained' : 'text'} aria-pressed={tool === id} />)}
      </Box>
      <Divider sx={{ my: 0.75 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        <ComicButton icon={ChatBubbleOutline} label={c.dialogue} onClick={() => setBalloonPicker(true)} />
        <ComicButton icon={TextFields} label={c.text} tip={c.textTip} shortcut="T" variant={tool === 'text' ? 'contained' : 'text'} onClick={() => { setTool('text'); setCut(null); }} />
        <ComicButton icon={AutoAwesome} label={c.sticker} onClick={() => { elementUploadKind.current = 'sticker'; elementUpload.current.click(); }} />
      </Box>
      <Divider sx={{ my: 0.75 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <ComicButton icon={Undo} label={c.undo} shortcut="Ctrl+Z" disabled={!history.current.undo.length || !historyVersion} onClick={() => undo()} />
        <ComicButton icon={Redo} label={c.redo} shortcut="Ctrl+Y / Ctrl+Shift+Z" disabled={!history.current.redo.length} onClick={() => undo(true)} />
      </Box>
      <TextField select fullWidth size="small" label={c.panel} value={selectedId || ''} sx={{ my: 1, display: { xs: 'none', md: 'block' } }} onChange={(event) => { setTool('select'); choose(page.panels.find((panel) => panel.id === event.target.value)); }}>
        <MenuItem value="">{c.noPanel}</MenuItem>
        {page.panels.map((panel, index) => <MenuItem key={panel.id} value={panel.id} disabled={page.layers.some((layer) => layer.id === panel.layerId && (layer.locked || !layer.visible))} sx={{ color: panel.type === 'overlay' ? '#bd7110' : 'primary.main' }}>{index + 1} · {panel.type === 'overlay' ? overlayLabel : regularLabel}{panel.task ? ' ✓' : ''}</MenuItem>)}
      </TextField>
      {tool === 'cut' && <><Typography variant="caption">{c.gutter}: {gutter}px</Typography><Slider aria-label={c.gutter} min={0} max={48} value={gutter} onChange={(_, value) => setGutter(value)} /></>}
      {['brush', 'eraser'].includes(tool) && <><Typography variant="caption">{isMobile ? brushSize : `${c.brushSize}: ${brushSize}px`}</Typography><Slider aria-label={c.brushSize} min={1} max={64} value={brushSize} onChange={(_, value) => setBrushSize(value)} /></>}
      {selected && <>
        <Divider sx={{ my: 0.75 }} /><Typography variant="subtitle2" sx={{ color: panelColor, mb: 0.5 }}>{isMobile ? `#${selectedNumber}` : `${c.panel} ${selectedNumber} · ${selected.type === 'overlay' ? overlayLabel : regularLabel}`}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <ComicButton icon={UploadFile} label={c.upload} shortcut="Ctrl+O" onClick={() => { uploadTarget.current = target; upload.current.click(); }} />
          <ComicButton icon={ImageOutlined} label={c.gallery} onClick={() => openGallery()} />
          <ComicButton icon={CropFree} label={c.cropImage} shortcut="Shift+C" disabled={!selected.image} onClick={() => setCropId(selected.id)} />
          <ComicButton icon={DeleteOutline} label={c.removeImage} disabled={!selected.image} onClick={() => updatePanel(selected.id, { image: null })} />
        </Box>
        {isMobile ? <ComicButton icon={selected.type === 'overlay' ? LayersOutlined : CropFree} label={selected.type === 'overlay' ? regularLabel : overlayLabel} onClick={() => { const converted = convertPanelType(selected, selected.type === 'overlay' ? 'regular' : 'overlay', page, section); if (converted) updatePanel(selected.id, converted); else setNotice({ severity: 'warning', text: c.smallPanel }); }} /> : <TextField select size="small" fullWidth label={language === 'zh' ? '画框类型' : 'Frame type'} value={selected.type || 'regular'} sx={{ my: 1 }} onChange={(event) => { const converted = convertPanelType(selected, event.target.value, page, section); if (converted) updatePanel(selected.id, converted); else setNotice({ severity: 'warning', text: c.smallPanel }); }}><MenuItem value="regular">{regularLabel}</MenuItem><MenuItem value="overlay">{overlayLabel}</MenuItem></TextField>}
        <Typography variant="caption">{isMobile ? `${selected.borderWidth}px` : selected.borderWidth ? `${c.border}: ${selected.borderWidth}px` : c.borderless}</Typography>
        <Slider aria-label={c.border} min={0} max={12} value={selected.borderWidth} onChange={(_, value) => updatePanel(selected.id, { borderWidth: value })} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}><ComicButton icon={ArrowUpward} label={c.contentForward} onClick={() => moveLayer(1)} /><ComicButton icon={ArrowDownward} label={c.contentBackward} onClick={() => moveLayer(-1)} /></Box>
        <ComicButton color="error" icon={DeleteOutline} label={c.deletePanel} shortcut="Delete" onClick={deleteSelection} />
      </>}
      {selectedElement && <>
        <Divider sx={{ my: 0.75 }} /><Typography variant="subtitle2" noWrap sx={{ display: { xs: 'none', md: 'block' }, color: '#ad69da' }}>{selectedElement.name || (selectedElement.kind === 'bubble' ? c.dialogue : c[selectedElement.kind])}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
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

    <Box sx={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ position: 'relative', p: 0.65, pr: { xs: 5, md: 0.65 }, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.65, borderBottom: 1, borderColor: 'divider' }}>
        <TextField select size="small" value={page.layout} aria-label={c.title} onChange={(event) => navigate(createComicPage(event.target.value), true)} sx={{ minWidth: 108 }}>
          {Object.keys(COMIC_LAYOUTS).map((layout) => <MenuItem key={layout} value={layout}>{c[layout]}</MenuItem>)}
        </TextField>
        {COMIC_LAYOUTS[page.layout].sections === 2 && <ToggleButtonGroup size="small" exclusive value={section} onChange={(_, value) => { if (value !== null) { setSection(value); choose(null); } }}>{sectionLabels.map((label, index) => <Tooltip key={index} title={label}><ToggleButton value={index} aria-label={label} data-action-label={label}>{isMobile ? (page.layout === 'spreadPortrait' ? (index ? <ArrowForward /> : <ArrowBack />) : (index ? <ArrowDownward /> : <ArrowUpward />)) : label}</ToggleButton></Tooltip>)}</ToggleButtonGroup>}
        <Box sx={{ flex: 1 }} />
        {isMobile && <Box sx={{ position: 'absolute', top: 3, right: 3 }}><ComicButton icon={MenuIcon} label={c.pages} onClick={() => setPagesOpen(true)} /></Box>}
        <Tooltip title={`${c.zoomCanvas} (Ctrl+0 / Ctrl+±)`}><TextField select size="small" value={zoom} onChange={(event) => Number(event.target.value) === 1 ? setView({ zoom: 1, x: 0, y: 0 }) : changeZoom(Number(event.target.value))} sx={{ width: 74 }}>{[...new Set([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, zoom])].sort((a, b) => a - b).map((value) => <MenuItem value={value} key={value}>{value === 1 ? c.fit : `${Math.round(value * 100)}%`}</MenuItem>)}</TextField></Tooltip>
        {isMobile && <TextField select size="small" value={selectedId || ''} slotProps={{ select: { displayEmpty: true, renderValue: () => selectedNumber ? `#${selectedNumber}` : c.panel, inputProps: { 'aria-label': c.panel } } }} sx={{ width: 72 }} onChange={(event) => { setTool('select'); choose(page.panels.find((panel) => panel.id === event.target.value)); }}><MenuItem value="">{c.noPanel}</MenuItem>{page.panels.map((panel, index) => <MenuItem key={panel.id} value={panel.id} disabled={page.layers.some((layer) => layer.id === panel.layerId && (layer.locked || !layer.visible))}>{index + 1} · {panel.type === 'overlay' ? overlayLabel : regularLabel}</MenuItem>)}</TextField>}
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, flexWrap: 'wrap', alignItems: 'center', gap: 0.6, px: 1, py: 0.35 }}><Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#287bcc' }} /><Typography variant="caption">{regularLabel}</Typography><Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#bd7110', ml: 0.5 }} /><Typography variant="caption">{overlayLabel}</Typography><Box sx={{ flex: 1 }} /><Typography variant="caption" color="text.secondary">{page.width} × {page.height}</Typography></Box>
      <Box ref={viewport} tabIndex={-1} data-testid="comic-viewport" onContextMenu={(event) => {
        event.preventDefault();
        const panel = page.panels.find((item) => item.id === event.target.closest('[data-panel]')?.dataset.panel);
        const element = page.elements.find((item) => item.id === event.target.closest('[data-element]')?.dataset.element);
        if (element) chooseElement(element); else if (panel) choose(panel);
        setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6 });
      }} onPointerDownCapture={viewPointerDown} onPointerMove={viewPointerMove} onPointerUp={(event) => { viewDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { viewDrag.current = null; }} onLostPointerCapture={() => { viewDrag.current = null; }} onDragStart={(event) => event.preventDefault()}
        sx={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', bgcolor: 'action.hover', backgroundImage: 'radial-gradient(#88888825 1px, transparent 1px)', backgroundSize: '18px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', userSelect: 'none', cursor: tool === 'hand' || spaceHeld ? 'grab' : tool === 'zoom' ? 'zoom-in' : 'default' }}>
        <Box component="svg" ref={svg} tabIndex={0} viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label={c.title} data-testid="comic-canvas"
          onDragStart={(event) => event.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
          sx={{ width: canvasSize.width, height: canvasSize.height, flexShrink: 0, overflow: 'visible', transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})`, transformOrigin: 'center', boxShadow: '0 6px 24px #00000020', bgcolor: 'white', touchAction: 'none', userSelect: 'none', cursor: tool === 'hand' || spaceHeld ? 'grab' : tool === 'zoom' ? 'zoom-in' : ['cut', 'rectangle', 'overlay', 'brush', 'eraser', 'text'].includes(tool) ? 'crosshair' : 'default' }}>
          <defs><clipPath id="comic-page-clip"><rect width={page.width} height={page.height} /></clipPath></defs><g clipPath="url(#comic-page-clip)"><PageArt page={page} prefix="editor" /></g>
          {COMIC_LAYOUTS[page.layout].sections === 2 && <rect {...sectionBounds(page, section)} fill="none" stroke="#287bcc" strokeWidth={2} strokeDasharray="10 8" pointerEvents="none" />}
          {editableItems.map(({ kind, item }) => {
            if (kind === 'element') return <g key={item.id} data-element={item.id} transform={`matrix(${comicElementMatrix(item).join(' ')})`} onDoubleClick={() => { chooseElement(item); setElementEditorId(item.id); }}>
              <polygon data-element={item.id} points={polygonPoints(item.mask.map((point) => ({ x: point.x * item.width, y: point.y * item.height })))} fill="transparent" stroke="#ad69da" strokeWidth={(item.id === selectedElementId ? 2 : 1) * handleScale} strokeDasharray={item.id === selectedElementId ? undefined : `${6 * handleScale} ${5 * handleScale}`} opacity={item.id === selectedElementId ? 1 : 0.45} style={{ cursor: tool === 'select' ? 'pointer' : 'inherit' }} />
            </g>;
            const color = item.type === 'overlay' ? '#bd7110' : '#287bcc'; const bounds = panelBounds(item); const index = page.panels.indexOf(item) + 1;
            return <g key={item.id} data-panel={item.id}>
              <polygon data-panel={item.id} points={polygonPoints(item.points)} fill="transparent" stroke={color} strokeWidth={item.id === selectedId ? 3 : 1} strokeDasharray={item.id === selectedId ? undefined : '7 6'} opacity={item.id === selectedId ? 1 : 0.6} style={{ cursor: tool === 'select' ? 'pointer' : 'inherit' }} />
              <g pointerEvents="none"><rect x={bounds.x + 7} y={bounds.y + 7} width={29} height={26} rx={5} fill={color} /><text x={bounds.x + 21.5} y={bounds.y + 26} fill="white" fontSize={18} textAnchor="middle" fontFamily="sans-serif">{index}</text></g>
            </g>;
          })}
          {selected && tool === 'select' && <g data-panel={selected.id}>
            {selected.points.map((p, index) => { const next = selected.points[(index + 1) % selected.points.length]; return <g key={index}>
              <rect data-panel={selected.id} data-handle="edge" data-index={index} x={(p.x + next.x) / 2 - 4 * handleScale} y={(p.y + next.y) / 2 - 4 * handleScale} width={8 * handleScale} height={8 * handleScale} fill="white" stroke={panelColor} strokeWidth={1.5 * handleScale} style={{ cursor: 'move' }} />
              <circle data-panel={selected.id} data-handle="vertex" data-index={index} cx={p.x} cy={p.y} r={5 * handleScale} fill="white" stroke={panelColor} strokeWidth={1.5 * handleScale} style={{ cursor: 'move' }} />
            </g>; })}
            <line x1={panelMoveHandle.x} y1={panelMoveHandle.anchorY} x2={panelMoveHandle.x} y2={panelMoveHandle.y} stroke={panelColor} strokeWidth={1.5 * handleScale} pointerEvents="none" />
            <circle data-panel={selected.id} data-handle="move" data-testid="comic-panel-move" cx={panelMoveHandle.x} cy={panelMoveHandle.y} r={7 * handleScale} fill={panelColor} stroke="white" strokeWidth={1.5 * handleScale} style={{ cursor: 'move' }}><title>{c.moveHandle}</title></circle>
          </g>}
          {selectedElement && tool === 'select' && <g data-element={selectedElement.id} transform={`matrix(${comicElementMatrix(selectedElement).join(' ')})`}>
            <rect width={selectedElement.width} height={selectedElement.height} fill="none" stroke="#ad69da" strokeWidth={1.5 * handleScale} strokeDasharray={`${5 * handleScale} ${3 * handleScale}`} pointerEvents="none" />
            {[[0, 0], [selectedElement.width, 0], [selectedElement.width, selectedElement.height], [0, selectedElement.height]].map(([x, y], index) => <rect key={index} data-element={selectedElement.id} data-handle="resize" data-index={index} x={x - 5 * handleScale} y={y - 5 * handleScale} width={10 * handleScale} height={10 * handleScale} fill="white" stroke="#ad69da" strokeWidth={1.5 * handleScale} style={{ cursor: index % 2 ? 'nesw-resize' : 'nwse-resize' }}><title>{c.resizeHandle}</title></rect>)}
            <line x1={selectedElement.width / 2} y1={selectedElement.height} x2={selectedElement.width / 2} y2={selectedElement.height + 28 * handleScale} stroke="#ad69da" strokeWidth={1.5 * handleScale} pointerEvents="none" />
            <circle data-element={selectedElement.id} data-handle="move" data-testid="comic-element-move" cx={selectedElement.width / 2} cy={selectedElement.height + 28 * handleScale} r={7 * handleScale} fill="#ad69da" stroke="white" strokeWidth={1.5 * handleScale} style={{ cursor: 'move' }}><title>{c.moveHandle}</title></circle>
            <line x1={selectedElement.width / 2} y1={0} x2={selectedElement.width / 2} y2={-28 * handleScale} stroke="#ad69da" strokeWidth={1.5 * handleScale} pointerEvents="none" />
            <circle data-element={selectedElement.id} data-handle="rotate" data-testid="comic-element-rotate" cx={selectedElement.width / 2} cy={-28 * handleScale} r={6 * handleScale} fill="white" stroke="#ad69da" strokeWidth={1.5 * handleScale} style={{ cursor: ROTATE_CURSOR }}><title>{c.rotateHandle}</title></circle>
          </g>}
          {cut && <g pointerEvents="none"><circle cx={cut.start.x} cy={cut.start.y} r={8} fill="#d34256" />{cursor && <line x1={cut.start.x} y1={cut.start.y} x2={cursor.x} y2={cursor.y} stroke="#d34256" strokeWidth={3} strokeDasharray="9 6" />}</g>}
          {rectangle && <rect x={Math.min(rectangle.start.x, rectangle.end.x)} y={Math.min(rectangle.start.y, rectangle.end.y)} width={Math.abs(rectangle.start.x - rectangle.end.x)} height={Math.abs(rectangle.start.y - rectangle.end.y)} fill={tool === 'overlay' ? '#bd711020' : '#287bcc20'} stroke={tool === 'overlay' ? '#bd7110' : '#287bcc'} strokeWidth={3} pointerEvents="none" />}
        </Box>
        <Box sx={{ position: 'absolute', right: 8, bottom: 8, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, boxShadow: 3 }}><ComicButton icon={LayersOutlined} label={c.layers} variant={layersOpen ? 'contained' : 'text'} onClick={() => setLayersOpen((open) => !open)} /></Box>
        {isMobile && <Typography role="status" data-testid="comic-tool-name" variant="caption" noWrap sx={{ position: 'absolute', left: 8, bottom: 6, maxWidth: '70%', px: 0.6, py: 0.2, borderRadius: 0.5, color: '#fff', bgcolor: '#20242a66', pointerEvents: 'none' }}>{spaceHeld ? c.hand : lastAction || (tool === 'text' ? c.text : tools.find(([id]) => id === tool)?.[2])}</Typography>}
      </Box>
      {layersOpen && <Box sx={{ position: 'absolute', right: 8, bottom: 82, zIndex: 4, maxWidth: 'calc(100% - 16px)' }}>
        <ComicLayerPanel page={page} activeLayerId={activeLayerId} selectedItem={selectedItem} language={language} onClose={() => setLayersOpen(false)} onSelectLayer={(id) => { choose(null); setActiveLayerId(id); }} onSelectItem={(kind, id) => {
          const current = pageRef.current;
          const item = (kind === 'panel' ? current.panels : kind === 'element' ? current.elements : current.strokes).find((value) => value.id === id);
          const layer = current.layers.find((value) => value.id === item?.layerId);
          if (!item || layer.locked || !layer.visible) return;
          if (kind === 'panel') choose(item, current); else if (kind === 'element') chooseElement(item); else { choose(null); setSelectedStrokeId(item.id); setActiveLayerId(item.layerId); }
        }} onChange={changeLayers} />
      </Box>}
      <Box sx={{ p: 0.65, display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        {selected ? <>
          <Chip size="small" label={isMobile ? `#${selectedNumber}` : `${c.panel} ${selectedNumber}${selected.task ? ` · ${c.ready}` : ''}`} />
          <ComicButton icon={SettingsOutlined} label={c.editTask} onClick={() => onEditTask?.(selectedBounds)} />
          <ComicButton icon={SaveOutlined} label={c.saveTask} onClick={() => { const snapshot = onSaveTask?.(); if (snapshot) { rememberTask(target, snapshot); setNotice({ severity: 'success', text: c.taskSaved }); } }} />
        </> : selectedElement ? <><Chip size="small" label={selectedElement.kind === 'bubble' ? c.dialogue : c[selectedElement.kind]} /><ComicButton icon={SettingsOutlined} label={c.editElement} onClick={() => setElementEditorId(selectedElement.id)} /></> : <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>{c.noPanel}</Typography>}
        {(selected || generationAction?.loading) && <>
          <ComicButton icon={PlayArrow} variant="contained" disabled={busy || generationAction?.disabled} onClick={onGenerate} label={`${generationAction?.text || `${c.generate} ${selectedNumber}`}${generationAction?.costLabel ? ` · ${generationAction.costLabel}` : ''}`} />
          {isMobile && generationAction?.costLabel && <Typography variant="caption">{generationAction.costLabel}</Typography>}
        </>}
        <Box sx={{ flex: 1 }} /><ComicButton icon={dirty ? SaveOutlined : Check} label={c.savePage} tip={c.savedLocally} shortcut="Ctrl+S" disabled={busy} onClick={() => perform(savePage)} />
      </Box>
    </Box>

    {isMobile ? <Drawer anchor="right" open={pagesOpen} onClose={() => setPagesOpen(false)} slotProps={{ paper: { sx: { width: 'min(82vw, 290px)', p: 1 } } }}>{pageLibrary}</Drawer> : pageLibrary}

    <Menu open={Boolean(contextMenu)} onClose={() => setContextMenu(null)} onClick={() => setContextMenu(null)} anchorReference="anchorPosition" anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}>
      <MenuItem onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>{c.resetView}<Typography component="span" sx={{ ml: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+0</Typography></MenuItem>
      <MenuItem onClick={() => changeZoom(page.width / canvasSize.width)}>{c.actualSize}</MenuItem>
      <Divider />
      <MenuItem disabled={!history.current.undo.length} onClick={() => undo()}>{c.undo}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+Z</Typography></MenuItem>
      <MenuItem disabled={!history.current.redo.length} onClick={() => undo(true)}>{c.redo}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+Y</Typography></MenuItem>
      <Divider />
      <MenuItem onClick={() => setBalloonPicker(true)}>{c.dialogue}</MenuItem>
      <MenuItem onClick={() => { setTool('text'); setCut(null); }}>{c.text}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>T</Typography></MenuItem>
      <MenuItem onClick={() => setLayersOpen(true)}>{c.layers}</MenuItem>
      {selectedItem && <Divider />}
      {selectedElement && <MenuItem onClick={() => setElementEditorId(selectedElement.id)}>{c.editElement}</MenuItem>}
      {selected?.image && <MenuItem onClick={() => setCropId(selected.id)}>{c.cropImage}</MenuItem>}
      {selectedItem && [<MenuItem key="duplicate" onClick={duplicateSelection}>{c.duplicate}<Typography component="span" sx={{ ml: 'auto', pl: 3, color: 'text.secondary', fontSize: 11 }}>Ctrl+J</Typography></MenuItem>, <MenuItem key="up" onClick={() => moveLayer(1)}>{c.contentForward}</MenuItem>, <MenuItem key="down" onClick={() => moveLayer(-1)}>{c.contentBackward}</MenuItem>, <MenuItem key="delete" sx={{ color: 'error.main' }} onClick={deleteSelection}>{c.deleteContent}</MenuItem>]}
    </Menu>

    <Dialog open={balloonPicker} onClose={() => setBalloonPicker(false)} maxWidth="md" fullWidth aria-labelledby="comic-balloon-title">
      <DialogTitle id="comic-balloon-title" sx={{ py: 1.5, fontSize: 16 }}>{c.dialogue}</DialogTitle>
      <DialogContent dividers sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.7, mb: 1.2 }}>
          <ComicButton icon={UploadFile} label={c.uploadBalloon} onClick={() => { elementUploadKind.current = 'bubble'; elementUpload.current.click(); }} />
          <ComicButton icon={TextFields} label={c.text} tip={c.textTip} shortcut="T" onClick={() => { setTool('text'); setBalloonPicker(false); }} />
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
          {(galleryTab ? gallery?.entries || [] : generatedItems.filter((item) => item.type !== 'video')).map((item, index) => <ButtonBase key={item.id} disabled={busy} aria-label={`${c.panel} ${index + 1}`} onClick={() => perform(async () => { const blob = galleryTab ? await fetchUrlAsBlob((await apiClient.getGalleryEntry(item.id)).url) : await fetchUrlAsBlob(item.src); await addImage(blob, gallery.target); setGallery(null); }, c.imageError)} sx={{ display: 'block', overflow: 'hidden', borderRadius: 1 }}>
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
