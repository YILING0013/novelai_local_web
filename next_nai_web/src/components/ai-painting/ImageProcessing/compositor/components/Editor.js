"use client";

import { createClientId } from '@/utils/browserCapabilities.mjs';

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  SquareDashed,
  Lasso,
  WandSparkles,
  Crop,
  Paintbrush,
  Eraser,
  Stamp,
  Droplet,
  Blend,
  Shapes,
  Type,
  Pipette,
  Hand,
  ZoomIn,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Undo2,
  Redo2,
  Download,
  Upload,
  Save,
  Search,
  Eye,
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
  FolderPlus,
  Folder,
  Trash2,
  Copy,
  SquarePlus,
  Circle,
  Image as ImageIcon,
  Layers,
  SlidersHorizontal,
  Check,
  Maximize,
  Minus,
  Grid2X2,
  Ruler,
  CircleHelp,
  PanelRightClose,
  PanelRightOpen,
  ArrowUp,
  ArrowDown,
  Link2,
  PaintBucket,
  RotateCcw,
  History,
} from "lucide-react";
import { IconButton, Modal, NumberField, Slider } from "./Controls";
import { useEditorText } from "./messages";
import Inspector from "./Inspector";
import BrushSettings from "./BrushSettings";
import ToolProperties from "./ToolProperties";
import { DEFAULT_BRUSH, brushStrokeMarks, createBrushStamp, drawBrushStamp } from "../lib/brushes";
import { SHAPES, DEFAULT_SHAPE_OPTIONS } from "../lib/shapes";
import PalettePanel from "./PalettePanel";
import WorkspacePanels, { usePanelLayout, PanelLayoutMenu } from "./WorkspacePanels";
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  trimHistory,
} from "../lib/history";
import {
  makeLayer,
  makeDocument,
  validateDocument,
  descendantIds,
  localPoint,
  BLENDS,
  DEFAULT_ADJUSTMENTS,
} from "../lib/model";
import {
  canvasOf,
  loadImage,
  renderDocument,
  layerSurface,
  placeLayer,
  hitLayer,
  selectionOutline,
} from "../lib/renderer";
import { floodMask, alphaBounds, morphology } from "../lib/pixels";
import {
  downloadBlob,
  importFile,
  workspaceStorage,
  imagePdf,
} from "../lib/files";

const TOOLS = [
  ["move", MousePointer2, "移动 / 变换", "V"],
  ["marquee", SquareDashed, "矩形 / 椭圆选区", "M"],
  ["lasso", Lasso, "自由套索", "L"],
  ["wand", WandSparkles, "魔棒选区", "W"],
  ["crop", Crop, "裁剪", "C"],
  ["brush", Paintbrush, "画笔", "B"],
  ["eraser", Eraser, "橡皮擦", "E"],
  ["clone", Stamp, "仿制图章", "S"],
  ["blur", Droplet, "模糊画笔", "R"],
  ["mosaic", Grid2X2, "马赛克画笔", "P"],
  ["fill", PaintBucket, "填充", "K"],
  ["gradient", Blend, "渐变", "G"],
  ["shape", Shapes, "形状", "U"],
  ["text", Type, "文字", "T"],
  ["eyedropper", Pipette, "吸管", "I"],
  ["hand", Hand, "抓手", "H"],
  ["zoom", ZoomIn, "缩放", "Z"],
];
/** 浏览器编辑器主流程：文档事务、工具交互、文件读写与界面协调。
 * @param {object} props 面板状态、外部导入请求及画廊和漫画入口回调。
 * @returns {JSX.Element} 完整编辑工作区。
 */
export default function Editor({ active = true, locale = "zh-CN", importRequest = null, onImportComplete, onOpenGallery, onOpenComic }) {
  const english = locale === "en-US";
  const labelText = useEditorText();
  const [docs, setDocs] = useState([]),
    [activeId, setActiveId] = useState(null);
  const [selected, setSelected] = useState([]),
    [tool, setTool] = useState("move");
  const [zoom, setZoom] = useState(0.5),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const [color, setColor] = useState("#34453e"),
    [backColor, setBackColor] = useState("#eac6a0");
  const [brush, setBrush] = useState({ ...DEFAULT_BRUSH });
  const [mosaicSize, setMosaicSize] = useState(16);
  const [shapeOptions, setShapeOptions] = useState({ ...DEFAULT_SHAPE_OPTIONS });
  const [textOptions, setTextOptions] = useState({ fontFamily: "Arial", fontSize: 72, fontWeight: "400", lineHeight: 1.2, align: "left" });
  const [shape, setShape] = useState("roundRect"),
    [selectionShape, setSelectionShape] = useState("rect"),
    [selectionMode, setSelectionMode] = useState("replace");
  const [tolerance, setTolerance] = useState(32),
    [cropRatio, setCropRatio] = useState("free");
  const [selection, setSelection] = useState(null),
    [selectionImage, setSelectionImage] = useState(null);
  const [draftRect, setDraftRect] = useState(null),
    [draftPoints, setDraftPoints] = useState([]);
  const [panel, setPanel] = useState(true),
    [grid, setGrid] = useState(false),
    [rulers, setRulers] = useState(true),
    [snap, setSnap] = useState(true),
    [autoSelect, setAutoSelect] = useState(true);
  const [maskEditing, setMaskEditing] = useState(false),
    [collapsed, setCollapsed] = useState([]);
  const [menu, setMenu] = useState(null),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false),
    [renderTick, setRenderTick] = useState(0),
    [thumb, setThumb] = useState("");
  const [historyTick, setHistoryTick] = useState(0),
    [search, setSearch] = useState(""),
    [fullscreen, setFullscreen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(DEFAULT_HISTORY_LIMIT);
  const [position, setPosition] = useState({ x: 0, y: 0 }),
    [snapped, setSnapped] = useState([]);
  const [newOptions, setNewOptions] = useState({
    name: english ? "Untitled" : "未命名",
    width: 1600,
    height: 1000,
    background: "transparent",
  });
  const [exportOptions, setExportOptions] = useState({
    format: "png",
    scale: 1,
    quality: 0.92,
    dpi: 72,
  });
  const [exportPreview, setExportPreview] = useState(null);
  const panelLayout = usePanelLayout(setToast);
  const focusPanel = panelLayout.selectPanel;
  const previousTool = useRef(tool);
  const stageRef = useRef(null),
    boardRef = useRef(null),
    canvasRef = useRef(null),
    fileRef = useRef(null);
  const docRef = useRef(null),
    histories = useRef(new Map()),
    gesture = useRef(null),
    previewBefore = useRef(null);
  const renderVersion = useRef(0),
    overrides = useRef(new Map()),
    space = useRef(false),
    clipboard = useRef(null),
    cloneSource = useRef(null);
  const dragLayer = useRef(null),
    pendingFiles = useRef([]),
    ready = useRef(false),
    importedRequest = useRef(null),
    initialDocumentName = useRef(english ? "Untitled" : "未命名");
  const doc = docs.find((d) => d.id === activeId) || null;
  const hasDocument = doc !== null;
  docRef.current = doc;
  const layer = doc?.layers.find((l) => l.id === selected.at(-1));
  const currentTool = TOOLS.find((t) => t[0] === tool);
  const ToolIcon = currentTool[1];
  const history = histories.current.get(activeId) || { past: [], future: [] };
  const closeModal = useCallback(() => {
    setModal(null);
    setSearch("");
  }, []);

  // 切换工具时激活属性标签；初次载入保留用户保存的活动标签。
  useEffect(() => {
    if (previousTool.current !== tool) focusPanel("properties");
    previousTool.current = tool;
  }, [tool, focusPanel]);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("novelai-image-processing-history-limit"));
      if (Number.isInteger(saved) && saved >= 1 && saved <= MAX_HISTORY_LIMIT)
        setHistoryLimit(saved);
    } catch {
      setToast("无法读取历史记录偏好，将使用默认 60 步。");
    }
  }, []);

  useEffect(() => {
    const compactScreen = window.matchMedia('(max-width: 899px)');
    // 窗口缩到手机宽度时先露出画布，仍可手动打开图层和属性面板。
    const hidePanelsOnSmallScreen = () => { if (compactScreen.matches) setPanel(false); };
    hidePanelsOnSmallScreen();
    compactScreen.addEventListener('change', hidePanelsOnSmallScreen);
    return () => compactScreen.removeEventListener('change', hidePanelsOnSmallScreen);
  }, []);

  // 图片数据留在本机 IndexedDB，不经过应用服务器。
  useEffect(() => {
    let disposed = false;
    workspaceStorage("read")
      .then((saved) => {
        if (disposed) return;
        if (saved?.docs?.length) {
          const restored = saved.docs.map(validateDocument);
          setDocs(restored);
          setActiveId(
            restored.some((d) => d.id === saved.activeId)
              ? saved.activeId
              : restored[0].id,
          );
          setToast("已恢复上次的本地工作区");
        } else {
          const blank = makeDocument({ name: initialDocumentName.current, width: 1600, height: 1000, background: "transparent" });
          setDocs([blank]);
          setActiveId(blank.id);
        }
        ready.current = true;
        setStatus("saved");
      })
      .catch((error) => {
        if (disposed) return;
        const blank = makeDocument({ name: initialDocumentName.current, width: 1600, height: 1000, background: "transparent" });
        setDocs([blank]);
        setActiveId(blank.id);
        ready.current = true;
        setStatus("error");
        setToast(`本地恢复失败：${error.message}`);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!ready.current || !docs.length) return;
    setStatus("saving");
    let cancelled = false;
    const timer = setTimeout(() => {
      workspaceStorage("write", { docs, activeId })
        .then(() => {
          if (!cancelled) setStatus("saved");
        })
        .catch(() => {
          if (!cancelled) {
            setStatus("error");
            setToast("浏览器存储写入失败，请下载项目文件保存。");
          }
        });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [docs, activeId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const warn = (e) => {
      if (status === "saving" || status === "error") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    const version = ++renderVersion.current;
    const frame = requestAnimationFrame(() => {
      renderDocument(doc, overrides.current)
        .then((result) => {
          if (version !== renderVersion.current || !canvasRef.current) return;
          const target = canvasRef.current;
          target.width = doc.width;
          target.height = doc.height;
          target.getContext("2d").drawImage(result, 0, 0);
          if (!gesture.current) {
            const mini = canvasOf(240, (240 * doc.height) / doc.width);
            mini
              .getContext("2d")
              .drawImage(result, 0, 0, mini.width, mini.height);
            setThumb(mini.toDataURL());
          }
        })
        .catch((error) => setToast(error.message));
    });
    return () => cancelAnimationFrame(frame);
  }, [doc, renderTick]);
  useEffect(() => {
    setSelectionImage(
      selection ? selectionOutline(selection).toDataURL() : null,
    );
  }, [selection]);

  function fitCanvas(target = docRef.current) {
    if (!target || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    if (bounds.width <= 110 || bounds.height <= 110) return;
    setZoom(
      Math.min(
        (bounds.width - 110) / target.width,
        (bounds.height - 110) / target.height,
        1,
      ),
    );
    setPan({ x: 0, y: 0 });
  }
  useEffect(() => {
    if (!active || !hasDocument || !stageRef.current) return;
    const observer = new ResizeObserver(() => fitCanvas());
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [active, activeId, hasDocument]);

  useEffect(() => {
    if (!ready.current || !doc || !importRequest || importedRequest.current === importRequest.id) return;
    importedRequest.current = importRequest.id;
    const importContent = async () => {
      if (importRequest.documents) {
        for (const document of importRequest.documents) openDocument(document);
      }
      if (importRequest.files) await processFiles(importRequest.files);
      onImportComplete?.(importRequest.id);
    };
    importContent();
  });

  useEffect(() => {
    if (active) return;
    space.current = false;
    if (gesture.current) cancelGesture();
  });

  function previewDocument(next) {
    docRef.current = next;
    setDocs((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );
  }
  function commit(next, label, before = docRef.current) {
    if (!before || next === before) return;
    const state = histories.current.get(next.id) || { past: [], future: [] };
    state.past.push({
      doc: before,
      label,
      selected: selected.filter((id) => before.layers.some((l) => l.id === id)),
    });
    state.future = [];
    trimHistory(state, historyLimit);
    histories.current.set(next.id, state);
    previewDocument(next);
    setHistoryTick((n) => n + 1);
  }
  /** 把图像调色写入独立调整子项，普通属性仍修改原图层。
   * @param {object} current 当前文档。
   * @param {object} changes 属性或后处理改动。
   * @returns {object} 保留原图像内容的新文档。
   */
  function documentWithLayerChanges(current, changes) {
    if (changes.adjustments && !changes.type && layer.type !== "adjustment") {
      const adjustment = makeLayer("adjustment", {
        name: "独立调色", targetId: layer.id, parentId: layer.parentId,
        width: layer.width, height: layer.height, adjustments: changes.adjustments,
      });
      // 旧项目的内嵌参数一并移入子项，避免相同调色在原图和子项中重复生效。
      const layers = current.layers.map((item) => item.id === layer.id
        ? { ...item, adjustments: { ...DEFAULT_ADJUSTMENTS } } : item);
      layers.splice(layers.findIndex((item) => item.id === layer.id) + 1, 0, adjustment);
      setSelected([adjustment.id]);
      setCollapsed((ids) => ids.filter((id) => id !== layer.id));
      setMaskEditing(false);
      focusPanel("adjustments");
      return { ...current, layers };
    }
    return { ...current, layers: current.layers.map((item) => item.id === layer.id ? { ...item, ...changes } : item) };
  }
  function updateLayer(changes, label = "修改图层") {
    if (!layer) return;
    if (layer.locked) {
      setToast("请先解锁图层。");
      return;
    }
    if (changes.adjustments && !changes.type && layer.type !== "adjustment" && doc.layers.length >= 200) {
      setToast("图层数量已达 200，请先删除不需要的图层。");
      return;
    }
    commit(documentWithLayerChanges(docRef.current, changes), label);
  }
  function previewLayer(changes) {
    if (!layer || layer.locked) return;
    if (changes.adjustments && !changes.type && layer.type !== "adjustment" && doc.layers.length >= 200) {
      setToast("图层数量已达 200，请先删除不需要的图层。");
      return;
    }
    if (!previewBefore.current) previewBefore.current = doc;
    previewDocument(documentWithLayerChanges(docRef.current, changes));
  }
  function finishPreview() {
    if (previewBefore.current) {
      const before = previewBefore.current;
      previewBefore.current = null;
      commit(docRef.current, "修改图层属性", before);
    }
  }
  function undo(redo = false) {
    const activeStroke = gesture.current;
    if (["paint", "text-box"].includes(activeStroke?.kind) ||
        (activeStroke?.kind === "loading" && (activeStroke.pendingPoints || activeStroke.textBox))) {
      // 尚未松开的笔画不属于历史；先取消它，避免松开后把已撤销的内容重新提交。
      cancelGesture();
      setToast("已取消当前笔画，历史记录未改变；再次撤销可返回上一步。");
      return;
    }
    const current = docRef.current,
      state = histories.current.get(current?.id);
    if (!state) return;
    const source = redo ? state.future : state.past,
      target = redo ? state.past : state.future;
    const item = source.pop();
    if (!item) return;
    target.push({ doc: current, label: item.label, selected });
    trimHistory(state, historyLimit);
    previewDocument(item.doc);
    setHistoryTick((n) => n + 1);
    setSelection(null);
    setDraftRect(null);
    setSelected(
      (item.selected || []).filter((id) =>
        item.doc.layers.some((l) => l.id === id),
      ),
    );
  }
  function changeHistoryLimit(value) {
    const limit = Math.round(value);
    setHistoryLimit(limit);
    for (const state of histories.current.values()) trimHistory(state, limit);
    setHistoryTick((n) => n + 1);
    try {
      localStorage.setItem("novelai-image-processing-history-limit", String(limit));
    } catch {
      setToast("历史上限已生效，但浏览器无法保存此偏好。");
    }
  }
  function openDocument(next) {
    next = { ...next, id: createClientId() };
    docRef.current = next;
    setDocs((items) => items.length === 1 && items[0].layers.length === 0 ? [next] : [...items, next]);
    setActiveId(next.id);
    setSelected(next.layers.length ? [next.layers.at(-1).id] : []);
    setSelection(null);
    setMaskEditing(false);
    setModal(null);
    setDraftRect(null);
  }
  function switchDocument(id) {
    finishPreview();
    setActiveId(id);
    setSelected([]);
    setSelection(null);
    setMaskEditing(false);
    setDraftRect(null);
  }
  function addLayer(next, label = "新增图层") {
    if (doc.layers.length >= 200) {
      setToast("单个文档最多支持 200 个图层。");
      return;
    }
    const layers = [...doc.layers];
    const index = layer
      ? layers.findIndex((l) => l.id === layer.id) + 1
      : layers.length;
    next.parentId =
      layer?.type === "group" ? layer.id : layer?.parentId || null;
    layers.splice(index, 0, next);
    commit({ ...doc, layers }, label);
    setSelected([next.id]);
    setMaskEditing(false);
  }
  function addAdjustment(name, settings) {
    const target = layer?.type === "adjustment"
      ? doc.layers.find((item) => item.id === layer.targetId)
      : layer?.type !== "group" ? layer : null;
    if (target) setCollapsed((ids) => ids.filter((id) => id !== target.id));
    addLayer(
      makeLayer("adjustment", {
        name: `${name}调整`,
        width: doc.width,
        height: doc.height,
        targetId: target?.id || null,
        adjustments: { ...DEFAULT_ADJUSTMENTS, ...settings },
      }),
      "新增调整图层",
    );
    focusPanel("adjustments");
  }
  function removeLayers() {
    if (maskEditing && layer?.mask) {
      updateLayer({ mask: null }, "删除图层蒙版");
      setMaskEditing(false);
      return;
    }
    const ids = descendantIds(
      doc.layers,
      selected.filter((id) => !doc.layers.find((l) => l.id === id)?.locked),
    );
    if (!ids.size) return;
    commit(
      { ...doc, layers: doc.layers.filter((l) => !ids.has(l.id)) },
      "删除图层",
    );
    setSelected([]);
    setMaskEditing(false);
  }
  function duplicateLayers() {
    const ids = descendantIds(doc.layers, selected),
      mapping = new Map([...ids].map((id) => [id, createClientId()]));
    const copies = doc.layers
      .filter((l) => ids.has(l.id))
      .map((l) => ({
        ...l,
        id: mapping.get(l.id),
        parentId: mapping.get(l.parentId) || l.parentId,
        targetId: mapping.get(l.targetId) || l.targetId || null,
        name: `${l.name} 副本`,
        x: l.x + 20,
        y: l.y + 20,
        locked: false,
      }));
    if (doc.layers.length + copies.length > 200) {
      setToast("图层数量超过 200。");
      return;
    }
    commit({ ...doc, layers: [...doc.layers, ...copies] }, "复制图层");
    setSelected(selected.map((id) => mapping.get(id)));
  }
  function groupLayers() {
    const chosen = doc.layers.filter((l) => selected.includes(l.id));
    if (!chosen.length) return;
    if (chosen.some((l) => l.parentId !== chosen[0].parentId)) {
      setToast("请在同一文件夹内选择图层。");
      return;
    }
    const group = makeLayer("group", {
      name: "新建文件夹",
      width: doc.width,
      height: doc.height,
      parentId: chosen[0].parentId,
    });
    const layers = doc.layers.map((l) =>
      selected.includes(l.id) ? { ...l, parentId: group.id } : l,
    );
    layers.splice(
      Math.max(...chosen.map((l) => doc.layers.indexOf(l))) + 1,
      0,
      group,
    );
    commit({ ...doc, layers }, "图层分组");
    setSelected([group.id]);
  }
  function ungroup() {
    if (layer?.type !== "group") return;
    commit(
      {
        ...doc,
        layers: doc.layers
          .filter((l) => l.id !== layer.id)
          .map((l) =>
            l.parentId === layer.id ? { ...l, parentId: layer.parentId } : l,
          ),
      },
      "取消分组",
    );
    setSelected([]);
  }
  function reorder(id, targetId) {
    if (id === targetId) return;
    const moved = doc.layers.find((l) => l.id === id),
      target = doc.layers.find((l) => l.id === targetId);
    if (
      !moved ||
      !target ||
      descendantIds(doc.layers, [id]).has(target.parentId)
    )
      return;
    const linkedTarget = moved.type === "adjustment"
      ? target.type === "adjustment" ? target.targetId : target.type !== "group" ? target.id : null
      : null;
    const parentId = linkedTarget
      ? doc.layers.find((item) => item.id === linkedTarget).parentId
      : target.parentId;
    const layers = doc.layers.filter((l) => l.id !== id).map((item) => item.targetId === id ? { ...item, parentId } : item);
    layers.splice(layers.findIndex((l) => l.id === targetId) + 1, 0, {
      ...moved,
      parentId,
      ...(moved.type === "adjustment" ? { targetId: linkedTarget || null } : {}),
    });
    commit({ ...doc, layers }, "调整图层顺序");
  }
  async function rasterize(current = layer) {
    const source = await renderDocument({
      ...doc,
      layers: [
        {
          ...current,
          parentId: null,
          opacity: 1,
          blend: "source-over",
          visible: true,
          clipped: false,
        },
      ],
    });
    return {
      surface: source,
      layer: makeLayer("raster", {
        ...current,
        type: "raster",
        x: 0,
        y: 0,
        width: doc.width,
        height: doc.height,
        rotation: 0,
        flipX: false,
        flipY: false,
        src: source.toDataURL(),
        mask: null,
        adjustments: { ...DEFAULT_ADJUSTMENTS },
        effects: {
          shadow: 0,
          shadowColor: "#000000",
          shadowX: 8,
          shadowY: 12,
          glow: 0,
          overlay: "",
        },
      }),
    };
  }
  async function mergeLayers(all = false) {
    if (!all && !layer) return;
    let ids = descendantIds(doc.layers, selected);
    if (!all && selected.length === 1) {
      const siblings = doc.layers.filter((l) => l.parentId === layer.parentId && !l.targetId),
        index = siblings.findIndex((l) => l.id === layer.id);
      if (index === 0) {
        setToast("下方没有可以合并的图层。");
        return;
      }
      ids = descendantIds(doc.layers, [...selected, siblings[index - 1].id]);
    }
    const chosen = all ? doc.layers : doc.layers.filter((l) => ids.has(l.id));
    if (!all && chosen.some((l) => l.type === "adjustment" && !l.targetId)) {
      setToast("含调整图层时请使用“合并可见图层”，以保留合成效果。");
      return;
    }
    if (
      !all &&
      new Set(chosen.filter((l) => !ids.has(l.parentId)).map((l) => l.parentId))
        .size > 1
    ) {
      setToast("只能合并同一文件夹内的图层。");
      return;
    }
    const result = await renderDocument({
      ...doc,
      layers: chosen.map((l) => ({
        ...l,
        parentId: ids.has(l.parentId) ? l.parentId : null,
      })),
    });
    const merged = makeLayer("raster", {
      name: all ? "合并图像" : "合并图层",
      src: result.toDataURL(),
      width: doc.width,
      height: doc.height,
      parentId: all ? null : layer.parentId,
    });
    if (all) commit({ ...doc, layers: [merged] }, "合并可见图层");
    else {
      const index = Math.max(...chosen.map((l) => doc.layers.indexOf(l)));
      const layers = doc.layers.filter((l) => !ids.has(l.id));
      const beforeCount = doc.layers
        .slice(0, index + 1)
        .filter((l) => !ids.has(l.id)).length;
      layers.splice(beforeCount, 0, merged);
      commit({ ...doc, layers }, "合并图层");
    }
    setSelected([merged.id]);
  }
  async function maskAction(action) {
    if (
      !layer ||
      layer.locked ||
      ["group", "adjustment"].includes(layer.type)
    ) {
      setToast("请选择可编辑的内容图层。");
      return;
    }
    if (action === "remove") {
      updateLayer({ mask: null }, "删除蒙版");
      setMaskEditing(false);
      return;
    }
    if (action === "toggle") {
      updateLayer({ maskEnabled: !layer.maskEnabled }, "切换蒙版");
      return;
    }
    const mask = canvasOf(layer.width, layer.height),
      ctx = mask.getContext("2d");
    if (action === "invert" && layer.mask) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, mask.width, mask.height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(await loadImage(layer.mask), 0, 0, mask.width, mask.height);
    } else if (selection) {
      ctx.translate(layer.width / 2, layer.height / 2);
      ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      ctx.rotate((-layer.rotation * Math.PI) / 180);
      ctx.translate(-layer.x - layer.width / 2, -layer.y - layer.height / 2);
      ctx.drawImage(selection, 0, 0);
    } else {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, mask.width, mask.height);
    }
    updateLayer(
      { mask: mask.toDataURL(), maskEnabled: true },
      action === "invert" ? "反相蒙版" : "添加蒙版",
    );
    setMaskEditing(true);
    setToast("蒙版已选中：画笔显示，橡皮擦隐藏。");
  }
  async function selectAll() {
    const mask = canvasOf(doc.width, doc.height);
    const ctx = mask.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, doc.width, doc.height);
    setSelection(mask);
  }
  function combineSelection(mask, mode = selectionMode) {
    if (selection && mode !== "replace") {
      const result = canvasOf(doc.width, doc.height),
        ctx = result.getContext("2d");
      ctx.drawImage(selection, 0, 0);
      ctx.globalCompositeOperation =
        mode === "add" ? "source-over" : "destination-out";
      ctx.drawImage(mask, 0, 0);
      setSelection(result);
    } else setSelection(mask);
  }
  async function changeSelection(action) {
    if (!selection) return;
    if (action === "invert") {
      const result = canvasOf(doc.width, doc.height),
        ctx = result.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, doc.width, doc.height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(selection, 0, 0);
      setSelection(result);
    }
    if (action === "feather") {
      const result = canvasOf(doc.width, doc.height),
        ctx = result.getContext("2d");
      ctx.filter = "blur(5px)";
      ctx.drawImage(selection, 0, 0);
      setSelection(result);
    }
    if (action === "expand" || action === "contract") {
      const result = canvasOf(doc.width, doc.height),
        ctx = result.getContext("2d");
      const pixels = selection
        .getContext("2d")
        .getImageData(0, 0, doc.width, doc.height);
      ctx.putImageData(
        new ImageData(
          morphology(
            pixels.data,
            doc.width,
            doc.height,
            5,
            action === "expand",
          ),
          doc.width,
          doc.height,
        ),
        0,
        0,
      );
      setSelection(result);
    }
  }
  async function fillSelection(clear = false) {
    if (!layer || layer.locked || ["group", "adjustment"].includes(layer.type))
      return;
    const raster = await rasterize(),
      ctx = raster.surface.getContext("2d");
    const fill = canvasOf(doc.width, doc.height),
      fctx = fill.getContext("2d");
    fctx.fillStyle = color;
    fctx.fillRect(0, 0, doc.width, doc.height);
    if (selection) {
      fctx.globalCompositeOperation = "destination-in";
      fctx.drawImage(selection, 0, 0);
    }
    ctx.globalCompositeOperation = clear ? "destination-out" : "source-over";
    ctx.drawImage(fill, 0, 0);
    commit(
      {
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? { ...raster.layer, src: raster.surface.toDataURL() }
            : l,
        ),
      },
      clear ? "清除选区像素" : "填充颜色",
    );
  }
  async function liftSelection() {
    if (
      !selection ||
      !layer ||
      layer.locked ||
      ["group", "adjustment"].includes(layer.type)
    )
      return;
    const raster = await rasterize(),
      lifted = canvasOf(doc.width, doc.height),
      ctx = lifted.getContext("2d");
    ctx.drawImage(raster.surface, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(selection, 0, 0);
    const original = raster.surface.getContext("2d");
    original.globalCompositeOperation = "destination-out";
    original.drawImage(selection, 0, 0);
    const next = makeLayer("raster", {
      name: `${layer.name} · 选区`,
      src: lifted.toDataURL(),
      width: doc.width,
      height: doc.height,
      parentId: layer.parentId,
    });
    const layers = doc.layers.map((l) =>
      l.id === layer.id
        ? { ...raster.layer, src: raster.surface.toDataURL() }
        : l,
    );
    layers.splice(layers.findIndex((l) => l.id === layer.id) + 1, 0, next);
    commit({ ...doc, layers }, "移动选区像素到新图层");
    setSelected([next.id]);
    setSelection(null);
    setTool("move");
  }
  function applyCrop(rect = draftRect) {
    if (!rect || rect.width < 1 || rect.height < 1) return;
    const x = Math.max(0, Math.round(rect.x)),
      y = Math.max(0, Math.round(rect.y));
    const width = Math.min(doc.width - x, Math.round(rect.width)),
      height = Math.min(doc.height - y, Math.round(rect.height));
    if (width < 1 || height < 1) return;
    commit(
      {
        ...doc,
        width,
        height,
        layers: doc.layers.map((l) => ({ ...l, x: l.x - x, y: l.y - y })),
        guides: doc.guides.map((g) => ({
          ...g,
          position: g.position - (g.axis === "x" ? x : y),
        })),
      },
      "裁剪画布",
    );
    setDraftRect(null);
    setSelection(null);
    setTool("move");
    setTimeout(() => fitCanvas(), 0);
  }
  async function processFiles(files) {
    setBusy(true);
    try {
      for (const file of files) {
        const result = await importFile(file);
        if (result.report) {
          pendingFiles.current.push(result);
          setModal({ type: "import", result });
        } else if (result.doc) openDocument(result.doc);
        else if (result.layer) {
          const current = docRef.current;
          const imported = result.layer;
          const empty = current.layers.length === 0;
          const width = empty ? imported.width : current.width;
          const height = empty ? imported.height : current.height;
          imported.x = Math.round((width - imported.width) / 2);
          imported.y = Math.round((height - imported.height) / 2);
          const next = { ...current, width, height, layers: [...current.layers, imported] };
          commit(next, "导入图片");
          if (empty) fitCanvas(next);
          setSelected([imported.id]);
          setTool("move");
        }
      }
    } catch (error) {
      setToast(`导入失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }
  function saveProject() {
    downloadBlob(
      new Blob(
        [
          JSON.stringify({
            format: "compositor.web",
            version: 1,
            document: doc,
          }),
        ],
        { type: "application/json" },
      ),
      `${doc.name}.compweb`,
    );
    setToast("已下载可编辑项目，包含所有内嵌图片。");
  }
  async function exportImage(download = true) {
    const source = await renderDocument(doc),
      width = Math.round(doc.width * exportOptions.scale),
      height = Math.round(doc.height * exportOptions.scale);
    if (width > 16384 || height > 16384 || width * height > 64000000)
      throw new Error("导出尺寸超过 6400 万像素，请降低缩放比例。");
    const canvas = canvasOf(width, height),
      ctx = canvas.getContext("2d");
    if (["jpeg", "pdf"].includes(exportOptions.format)) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(source, 0, 0, width, height);
    let blob = await new Promise((resolve) =>
      canvas.toBlob(
        resolve,
        `image/${exportOptions.format === "pdf" ? "jpeg" : exportOptions.format}`,
        exportOptions.quality,
      ),
    );
    if (!blob) throw new Error("浏览器无法导出此尺寸的图像。");
    if (exportOptions.format === "pdf")
      blob = imagePdf(
        new Uint8Array(await blob.arrayBuffer()),
        width,
        height,
        exportOptions.dpi,
      );
    if (download) {
      downloadBlob(
        blob,
        `${doc.name}.${exportOptions.format === "jpeg" ? "jpg" : exportOptions.format}`,
      );
      setToast("图片已导出");
      closeModal();
    } else {
      const mini = canvasOf(440, (440 * height) / width);
      mini.getContext("2d").drawImage(canvas, 0, 0, mini.width, mini.height);
      setExportPreview({
        src: mini.toDataURL(),
        size: blob.size,
        width,
        height,
      });
    }
  }
  async function execute(action) {
    setMenu(null);
    try {
      await action();
    } catch (error) {
      setToast(error.message);
    }
  }

  function canvasPoint(event) {
    const bounds = boardRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / zoom,
      y: (event.clientY - bounds.top) / zoom,
      pressure: event.pointerType === "pen" ? event.pressure : 1,
    };
  }
  /** 选中文字并把输入焦点交给属性面板，单击和双击复用同一编辑入口。
   * @param {object} target 可编辑文字图层。
   */
  function editTextLayer(target) {
    setSelected([target.id]);
    setTool("text");
    focusPanel("properties");
    setPanel(true);
    requestAnimationFrame(() => {
      document.querySelector('textarea[aria-label={labelText("工具文字内容")}], textarea[aria-label={labelText("文字内容")}]')?.focus();
    });
  }
  async function pointerDown(event) {
    if (!doc || busy || event.button === 2 || modal || gesture.current) return;
    if (
      event.target.closest("button,input,select") &&
      !event.target.dataset.handle
    )
      return;
    event.preventDefault();
    setMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event),
      base = doc;
    if (tool === "hand" || space.current || event.button === 1) {
      gesture.current = {
        kind: "pan",
        clientX: event.clientX,
        clientY: event.clientY,
        pan,
      };
      return;
    }
    const rulerAxis = event.target.closest("[data-ruler]")?.dataset.ruler;
    if (rulerAxis) {
      gesture.current = { kind: "guide", axis: rulerAxis, before: doc };
      return;
    }
    if (
      !event.target.dataset.handle &&
      (point.x < 0 ||
        point.y < 0 ||
        point.x > doc.width ||
        point.y > doc.height)
    )
      return;
    if (tool === "zoom") {
      setZoom((z) =>
        Math.max(0.05, Math.min(8, z * (event.altKey ? 0.8 : 1.25))),
      );
      return;
    }
    if (tool === "eyedropper") {
      const pixel = canvasRef.current
        .getContext("2d")
        .getImageData(
          Math.min(doc.width - 1, Math.floor(point.x)),
          Math.min(doc.height - 1, Math.floor(point.y)),
          1,
          1,
        ).data;
      setColor(
        `#${[...pixel.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
      );
      return;
    }
    if (tool === "text") {
      const g = { kind: "loading", textBox: true, start: point, before: base, selectedBefore: [...selected] };
      gesture.current = g;
      const hit = await hitLayer(base, point);
      if (gesture.current !== g) return;
      g.kind = "text-box";
      g.hit = hit?.type === "text" ? hit : null;
      setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
      if (g.lastEvent) pointerMove(g.lastEvent);
      if (g.ended) pointerUp();
      return;
    }
    if (tool === "wand") {
      const ctx = canvasRef.current.getContext("2d"),
        pixels = ctx.getImageData(0, 0, doc.width, doc.height);
      const mask = canvasOf(doc.width, doc.height);
      mask
        .getContext("2d")
        .putImageData(
          new ImageData(
            floodMask(
              pixels.data,
              doc.width,
              doc.height,
              Math.floor(point.x),
              Math.floor(point.y),
              tolerance,
            ),
            doc.width,
            doc.height,
          ),
          0,
          0,
        );
      combineSelection(
        mask,
        event.shiftKey ? "add" : event.altKey ? "subtract" : selectionMode,
      );
      return;
    }
    if (tool === "fill") {
      execute(() => fillSelection());
      return;
    }
    if (["marquee", "lasso", "crop"].includes(tool)) {
      gesture.current = {
        kind: tool,
        start: point,
        points: [point],
        mode: event.shiftKey
          ? "add"
          : event.altKey
            ? "subtract"
            : selectionMode,
      };
      setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
      setDraftPoints([point]);
      return;
    }
    if (tool === "shape" || tool === "gradient") {
      const next = makeLayer(tool === "gradient" ? "gradient" : shape, {
        name:
          tool === "gradient"
            ? "渐变"
            : SHAPES.find(([type]) => type === shape)[1],
        x: point.x,
        y: point.y,
        width: 1,
        height: 1,
        fill: color,
        endColor: backColor,
        ...shapeOptions,
        radius: ["rect", "roundRect"].includes(shape) ? shapeOptions.radius : 0,
        stroke: backColor,
        strokeWidth: shape === "line" ? Math.max(1, shapeOptions.strokeWidth || 6) : shapeOptions.strokeWidth,
      });
      gesture.current = {
        kind: "shape",
        start: point,
        before: base,
        layer: next,
      };
      previewDocument({ ...base, layers: [...base.layers, next] });
      setSelected([next.id]);
      return;
    }
    if (tool === "move") {
      const g = { kind: "loading", start: point, before: base };
      gesture.current = g;
      const handle = event.target.dataset.handle;
      const hit = handle
        ? layer
        : autoSelect
          ? await hitLayer(base, point)
          : layer;
      if (gesture.current !== g) return;
      if (!hit || hit.locked) {
        setSelected([]);
        gesture.current = null;
        return;
      }
      let ids = descendantIds(base.layers, selected).has(hit.id)
        ? selected
        : [hit.id];
      if (event.shiftKey && !handle)
        ids = selected.includes(hit.id)
          ? selected.filter((id) => id !== hit.id)
          : [...selected, hit.id];
      setSelected(ids);
      setMaskEditing(false);
      Object.assign(g, {
        kind: handle === "rotate" ? "rotate" : handle ? "resize" : "move",
        ids: descendantIds(base.layers, ids),
        layer: hit,
        handle,
      });
      if (g.lastEvent) pointerMove(g.lastEvent);
      if (g.ended) pointerUp();
      return;
    }
    if (["brush", "eraser", "clone", "blur", "mosaic"].includes(tool)) {
      if (tool === "clone" && maskEditing) {
        setToast("仿制图章用于像素图层，请先取消“编辑蒙版”。");
        return;
      }
      if (tool === "clone" && event.altKey) {
        cloneSource.current = point;
        setToast("已设置仿制源，拖动开始绘制。");
        return;
      }
      if (tool === "clone" && !cloneSource.current) {
        setToast("先按住 Alt 并点击画布设置仿制源。");
        return;
      }
      if (layer?.locked || ["group", "adjustment"].includes(layer?.type)) {
        setToast("请选择未锁定的内容图层，或新建空白图层。");
        return;
      }
      const g = {
        kind: "loading",
        before: base,
        start: point,
        tool,
        mask: maskEditing && !!layer?.mask,
        pendingPoints: [],
        brush: { ...brush },
        paintColor: maskEditing && layer?.mask ? "#ffffff" : color,
        selectedBefore: [...selected],
      };
      gesture.current = g;
      let target = layer;
      if (!target)
        target = makeLayer("raster", {
          name: "绘画图层",
          width: doc.width,
          height: doc.height,
        });
      if (g.mask) {
        g.base = canvasOf(target.width, target.height);
        g.base
          .getContext("2d")
          .drawImage(
            await loadImage(target.mask),
            0,
            0,
            g.base.width,
            g.base.height,
          );
        g.layer = target;
      } else if (target.src || target.type !== "raster") {
        const raster = await rasterize(target);
        g.base = raster.surface;
        g.layer = raster.layer;
      } else {
        g.base = canvasOf(doc.width, doc.height);
        g.layer = target;
      }
      if (gesture.current !== g) return;
      g.stamp = await createBrushStamp(g.brush, g.paintColor);
      if (gesture.current !== g) return;
      g.paint = canvasOf(g.base.width, g.base.height);
      g.clippedPaint = canvasOf(g.base.width, g.base.height);
      g.dab = canvasOf(Math.ceil(g.brush.size * Math.SQRT2 + 2), Math.ceil(g.brush.size * Math.SQRT2 + 2));
      g.result = canvasOf(g.base.width, g.base.height);
      g.sample = canvasOf(doc.width, doc.height);
      g.sample
        .getContext("2d")
        .drawImage(tool === "clone" ? canvasRef.current : g.base, 0, 0);
      if (tool === "blur") {
        const blurred = canvasOf(g.base.width, g.base.height);
        const ctx = blurred.getContext("2d");
        ctx.filter = `blur(${Math.max(2, g.brush.size / 12)}px)`;
        ctx.drawImage(g.base, 0, 0);
        g.sample = blurred;
      }
      if (tool === "mosaic") {
        // 缩小取各块代表色再以最近邻放大；网格固定在图层左上角，来回涂抹不会漂移。
        const reduced = canvasOf(Math.ceil(g.base.width / mosaicSize), Math.ceil(g.base.height / mosaicSize));
        const small = reduced.getContext("2d");
        small.imageSmoothingEnabled = true;
        small.imageSmoothingQuality = "high";
        small.drawImage(g.base, 0, 0, g.base.width / mosaicSize, g.base.height / mosaicSize);
        g.sample = canvasOf(g.base.width, g.base.height);
        const pixelated = g.sample.getContext("2d");
        pixelated.imageSmoothingEnabled = false;
        pixelated.drawImage(reduced, 0, 0, reduced.width, reduced.height, 0, 0,
          reduced.width * mosaicSize, reduced.height * mosaicSize);
      }
      g.kind = "paint";
      g.stroke = { brush: g.brush };
      g.layerId = target.id;
      const layers = base.layers.some((l) => l.id === target.id)
        ? base.layers.map((l) => (l.id === target.id ? g.layer : l))
        : [...base.layers, g.layer];
      previewDocument({ ...base, layers });
      setSelected([target.id]);
      paintAt(g, point);
      for (const pending of g.pendingPoints) paintAt(g, pending);
      if (g.ended) pointerUp();
    }
  }
  function paintAt(g, point) {
    const ctx = g.paint.getContext("2d");
    const to = g.mask ? { ...localPoint(point, g.layer), pressure: point.pressure } : point;
    const marks = brushStrokeMarks(g.stroke, to);
    if (!marks.length) return;
    ctx.globalAlpha = g.brush.flow / 100;
    for (const mark of marks) {
      if (g.tool === "clone") {
        const dab = g.dab.getContext("2d"), half = g.dab.width / 2;
        dab.clearRect(0, 0, g.dab.width, g.dab.height);
        dab.globalCompositeOperation = "source-over";
        const dx = g.start.x - cloneSource.current.x,
          dy = g.start.y - cloneSource.current.y;
        dab.drawImage(g.sample, dx - mark.x + half, dy - mark.y + half);
        dab.globalCompositeOperation = "destination-in";
        drawBrushStamp(dab, g.stamp, { ...mark, x: half, y: half }, g.brush);
        ctx.drawImage(g.dab, mark.x - half, mark.y - half);
      } else drawBrushStamp(ctx, g.stamp, mark, g.brush);
    }
    const paint = g.clippedPaint,
      pctx = paint.getContext("2d");
    pctx.clearRect(0, 0, paint.width, paint.height);
    pctx.globalCompositeOperation = "source-over";
    pctx.drawImage(g.paint, 0, 0);
    if (selection) {
      pctx.globalCompositeOperation = "destination-in";
      pctx.save();
      if (g.mask) {
        pctx.translate(g.layer.width / 2, g.layer.height / 2);
        pctx.scale(g.layer.flipX ? -1 : 1, g.layer.flipY ? -1 : 1);
        pctx.rotate((-g.layer.rotation * Math.PI) / 180);
        pctx.translate(
          -g.layer.x - g.layer.width / 2,
          -g.layer.y - g.layer.height / 2,
        );
      }
      pctx.drawImage(selection, 0, 0);
      pctx.restore();
    }
    const result = g.result.getContext("2d");
    result.clearRect(0, 0, g.result.width, g.result.height);
    result.globalCompositeOperation = "source-over";
    result.drawImage(g.base, 0, 0);
    // 流量在每个笔尖上累积，不透明度只在整笔与原图合成时应用一次。
    result.globalAlpha = g.brush.opacity / 100;
    if (g.tool === "blur" || g.tool === "mosaic") {
      // 局部滤镜替换被笔尖覆盖的像素：原图 × (1−覆盖率) + 处理图 × 覆盖率。
      // 用预乘颜色相加保持半透明区域的透明度，不能把模糊副本当油墨叠加。
      result.globalCompositeOperation = "destination-out";
      result.drawImage(paint, 0, 0);
      pctx.globalCompositeOperation = "source-in";
      pctx.drawImage(g.sample, 0, 0);
      result.globalCompositeOperation = "lighter";
      result.drawImage(paint, 0, 0);
    } else {
      result.globalCompositeOperation = g.tool === "eraser" ? "destination-out" : "source-over";
      result.drawImage(paint, 0, 0);
    }
    result.globalAlpha = 1;
    result.globalCompositeOperation = "source-over";
    if (g.mask) {
      const changed = { ...g.layer, mask: g.result.toDataURL() };
      previewDocument({
        ...docRef.current,
        layers: docRef.current.layers.map((l) =>
          l.id === g.layerId ? changed : l,
        ),
      });
    } else {
      overrides.current.set(g.layerId, g.result);
      setRenderTick((n) => n + 1);
    }
  }
  function pointerMove(event) {
    if (!doc || !boardRef.current) return;
    const p = canvasPoint(event);
    setPosition({ x: Math.round(p.x), y: Math.round(p.y) });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "loading") {
      if (g.pendingPoints) g.pendingPoints.push(p);
      else
        g.lastEvent = {
          clientX: event.clientX,
          clientY: event.clientY,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        };
      return;
    }
    if (g.kind === "pan") {
      setPan({
        x: g.pan.x + event.clientX - g.clientX,
        y: g.pan.y + event.clientY - g.clientY,
      });
      return;
    }
    if (g.kind === "guide") {
      g.position = Math.round(p[g.axis]);
      setSnapped([{ axis: g.axis, position: g.position }]);
      return;
    }
    const point = {
      x: Math.max(0, Math.min(doc.width, p.x)),
      y: Math.max(0, Math.min(doc.height, p.y)),
      pressure: p.pressure,
    };
    if (g.kind === "paint") {
      paintAt(g, point);
      return;
    }
    if (["marquee", "lasso", "crop", "shape", "text-box"].includes(g.kind)) {
      let width = Math.abs(point.x - g.start.x),
        height = Math.abs(point.y - g.start.y);
      if (event.shiftKey && (g.kind === "shape" || g.kind === "marquee"))
        width = height = Math.min(
          Math.max(width, height),
          doc.width - g.start.x,
          doc.height - g.start.y,
        );
      if (g.kind === "crop" && cropRatio !== "free") {
        const [rw, rh] = cropRatio.split(":").map(Number);
        height = (width * rh) / rw;
      }
      const rect = {
        x: point.x < g.start.x ? g.start.x - width : g.start.x,
        y: point.y < g.start.y ? g.start.y - height : g.start.y,
        width,
        height,
      };
      g.rect = rect;
      if (g.kind === "shape") {
        const layer = {
          ...g.layer,
          ...rect,
          width: Math.max(1, width),
          height: Math.max(1, height),
          lineReverse: (point.x - g.start.x) * (point.y - g.start.y) < 0,
          gradientAngle:
            (Math.atan2(point.y - g.start.y, point.x - g.start.x) * 180) /
            Math.PI,
        };
        previewDocument({ ...g.before, layers: [...g.before.layers, layer] });
      } else {
        setDraftRect(rect);
        if (g.kind === "lasso") {
          g.points.push(point);
          setDraftPoints([...g.points]);
        }
      }
      return;
    }
    if (g.kind === "move") {
      let dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const lines = [];
      if (snap && !event.altKey) {
        const anchorsX = [
          0,
          doc.width / 2,
          doc.width,
          ...doc.guides
            .filter((guide) => guide.axis === "x")
            .map((guide) => guide.position),
        ];
        const anchorsY = [
          0,
          doc.height / 2,
          doc.height,
          ...doc.guides
            .filter((guide) => guide.axis === "y")
            .map((guide) => guide.position),
        ];
        for (const other of doc.layers.filter(
          (l) => !g.ids.has(l.id) && l.visible && l.type !== "group",
        )) {
          anchorsX.push(
            other.x,
            other.x + other.width / 2,
            other.x + other.width,
          );
          anchorsY.push(
            other.y,
            other.y + other.height / 2,
            other.y + other.height,
          );
        }
        for (const [axis, anchors] of [
          ["x", anchorsX],
          ["y", anchorsY],
        ]) {
          const start = g.layer[axis],
            size = g.layer[axis === "x" ? "width" : "height"];
          let difference = 6 / zoom,
            best = null;
          for (const anchor of anchors)
            for (const offset of [0, size / 2, size]) {
              const delta =
                anchor - (start + (axis === "x" ? dx : dy) + offset);
              if (Math.abs(delta) < Math.abs(difference)) {
                difference = delta;
                best = anchor;
              }
            }
          if (best !== null) {
            if (axis === "x") dx += difference;
            else dy += difference;
            lines.push({ axis, position: best });
          }
        }
      }
      setSnapped(lines);
      previewDocument({
        ...g.before,
        layers: g.before.layers.map((l) =>
          g.ids.has(l.id) && !l.locked
            ? { ...l, x: Math.round(l.x + dx), y: Math.round(l.y + dy) }
            : l,
        ),
      });
      return;
    }
    if (g.kind === "rotate") {
      const center = {
        x: g.layer.x + g.layer.width / 2,
        y: g.layer.y + g.layer.height / 2,
      };
      let rotation =
        (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI + 90;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      previewDocument({
        ...g.before,
        layers: g.before.layers.map((l) =>
          l.id === g.layer.id ? { ...l, rotation } : l,
        ),
      });
      return;
    }
    if (g.kind === "resize") {
      const a = (g.layer.rotation * Math.PI) / 180,
        dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      const localX = dx * Math.cos(a) + dy * Math.sin(a),
        localY = -dx * Math.sin(a) + dy * Math.cos(a);
      const sx = g.handle.includes("w") ? -1 : 1,
        sy = g.handle.includes("n") ? -1 : 1;
      let width = Math.max(1, Math.min(8192, g.layer.width + localX * sx)),
        height = Math.max(1, Math.min(8192, g.layer.height + localY * sy));
      if (event.shiftKey) height = (width * g.layer.height) / g.layer.width;
      const ox = ((width - g.layer.width) * sx) / 2,
        oy = ((height - g.layer.height) * sy) / 2;
      const x =
          g.layer.x +
          (g.layer.width - width) / 2 +
          ox * Math.cos(a) -
          oy * Math.sin(a),
        y =
          g.layer.y +
          (g.layer.height - height) / 2 +
          ox * Math.sin(a) +
          oy * Math.cos(a);
      previewDocument({
        ...g.before,
        layers: g.before.layers.map((l) =>
          l.id === g.layer.id ? { ...l, x, y, width, height } : l,
        ),
      });
    }
  }
  function pointerUp() {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "loading") {
      g.ended = true;
      return;
    }
    gesture.current = null;
    setSnapped([]);
    if (g.kind === "text-box") {
      setDraftRect(null);
      const dragged = g.rect && g.rect.width >= 3 && g.rect.height >= 3;
      if (!dragged && g.hit) {
        if (g.hit.locked) setToast("此文字图层已锁定，请先解锁。");
        else editTextLayer(g.hit);
        return;
      }
      if (g.before.layers.length >= 200) { setToast("单个文档最多支持 200 个图层。"); return; }
      const x = Math.min(g.before.width - 1, g.start.x), y = Math.min(g.before.height - 1, g.start.y);
      const rect = dragged ? g.rect : { x, y, width: Math.min(600, g.before.width - x), height: Math.min(180, g.before.height - y) };
      const next = makeLayer("text", { ...rect, ...textOptions, name: "新文字", text: "在这里输入文字", fill: color });
      commit({ ...g.before, layers: [...g.before.layers, next] }, "添加文字框", g.before);
      editTextLayer(next);
      return;
    }
    if (g.kind === "guide" && Number.isFinite(g.position)) {
      commit(
        {
          ...doc,
          guides: [...doc.guides, { axis: g.axis, position: g.position }],
        },
        "添加参考线",
      );
      return;
    }
    if (["move", "resize", "rotate", "shape"].includes(g.kind)) {
      if (
        g.kind === "shape" &&
        (!g.rect ||
          (g.layer.type === "line"
            ? Math.hypot(g.rect.width, g.rect.height) < 3
            : g.rect.width < 3 || g.rect.height < 3))
      ) {
        previewDocument(g.before);
        setSelected([]);
        return;
      }
      commit(
        docRef.current,
        g.kind === "shape"
          ? "绘制形状"
          : g.kind === "move"
            ? "移动图层"
            : "变换图层",
        g.before,
      );
    }
    if (g.kind === "paint") {
      overrides.current.delete(g.layerId);
      const updated = g.mask
        ? { ...g.layer, mask: g.result.toDataURL() }
        : { ...g.layer, src: g.result.toDataURL() };
      commit(
        {
          ...docRef.current,
          layers: docRef.current.layers.map((l) =>
            l.id === g.layerId ? updated : l,
          ),
        },
        g.mask
          ? "绘制蒙版"
          : {
              brush: "画笔",
              eraser: "橡皮擦",
              clone: "仿制图章",
              blur: "模糊画笔",
              mosaic: "马赛克画笔",
            }[g.tool],
        g.before,
      );
    }
    if (["marquee", "lasso"].includes(g.kind)) {
      const mask = canvasOf(doc.width, doc.height),
        ctx = mask.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      if (g.kind === "lasso") {
        g.points.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.closePath();
      } else if (g.rect) {
        if (selectionShape === "ellipse")
          ctx.ellipse(
            g.rect.x + g.rect.width / 2,
            g.rect.y + g.rect.height / 2,
            g.rect.width / 2,
            g.rect.height / 2,
            0,
            0,
            Math.PI * 2,
          );
        else ctx.rect(g.rect.x, g.rect.y, g.rect.width, g.rect.height);
      }
      ctx.fill();
      combineSelection(mask, g.mode);
      setDraftRect(null);
      setDraftPoints([]);
    }
  }
  function cancelGesture() {
    const g = gesture.current;
    if (g?.before) previewDocument(g.before);
    if (g?.selectedBefore) setSelected(g.selectedBefore);
    if (g?.pendingPoints) g.pendingPoints.length = 0;
    gesture.current = null;
    overrides.current.clear();
    setDraftRect(null);
    setDraftPoints([]);
    setSnapped([]);
  }
  async function copyContent() {
    if (selection) {
      const image = await renderDocument(doc),
        ctx = image.getContext("2d");
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(selection, 0, 0);
      clipboard.current = [
        makeLayer("raster", {
          name: "选区副本",
          src: image.toDataURL(),
          width: doc.width,
          height: doc.height,
        }),
      ];
    } else {
      const ids = descendantIds(doc.layers, selected);
      clipboard.current = doc.layers.filter((l) => ids.has(l.id));
    }
    setToast("已复制，可在其他项目标签中粘贴。");
  }
  function pasteContent() {
    if (!clipboard.current?.length) return;
    const mapping = new Map(
      clipboard.current.map((l) => [l.id, createClientId()]),
    );
    const copies = clipboard.current.map((l) => ({
      ...l,
      id: mapping.get(l.id),
      parentId: mapping.get(l.parentId) || null,
      targetId: mapping.get(l.targetId) || (l.targetId && doc.layers.some((item) => item.id === l.targetId)
        ? l.targetId : l.targetId && layer && !["group", "adjustment"].includes(layer.type) ? layer.id : null),
      locked: false,
    }));
    commit({ ...doc, layers: [...doc.layers, ...copies] }, "粘贴图层");
    setSelected(copies.filter((l) => !l.parentId).map((l) => l.id));
  }
  useEffect(() => {
    const stage = stageRef.current;
    if (!active || !stage) return;
    const wheel = (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || tool === "zoom") {
        setZoom((value) =>
          Math.max(0.05, Math.min(8, value * Math.exp(-event.deltaY * 0.002))),
        );
      } else
        setPan((value) => ({
          x: value.x - event.deltaX,
          y: value.y - event.deltaY,
        }));
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [active, doc?.id, tool]);
  const menus = doc
    ? {
        文件: [
          ["新建画布…", () => setModal({ type: "new" }), "Ctrl N"],
          ["打开 / 导入…", () => fileRef.current.click(), "Ctrl O"],
          null,
          ["保存可编辑项目", saveProject, "Ctrl S"],
          [
            "导出图像…",
            () => {
              setModal({ type: "export" });
              exportImage(false).catch((e) => setToast(e.message));
            },
            "Ctrl Shift E",
          ],
        ],
        编辑: [
          ["撤销", () => undo(), "Ctrl Z", !history.past.length],
          ["重做", () => undo(true), "Ctrl Shift Z", !history.future.length],
          null,
          [
            "复制图层 / 选区",
            copyContent,
            "Ctrl C",
            !selected.length && !selection,
          ],
          ["粘贴", pasteContent, "Ctrl V", !clipboard.current],
          ["填充前景色", () => fillSelection(), "Alt Backspace", !layer],
          ["清除选区像素", () => fillSelection(true), "Delete", !selection],
          null,
          ["查找命令…", () => setModal({ type: "commands" }), "Ctrl K"],
          ["快捷键", () => setModal({ type: "shortcuts" })],
        ],
        图像: [
          [
            "画布尺寸…",
            () =>
              setModal({
                type: "resize",
                width: doc.width,
                height: doc.height,
                mode: "canvas",
              }),
          ],
          [
            "图像尺寸…",
            () =>
              setModal({
                type: "resize",
                width: doc.width,
                height: doc.height,
                mode: "image",
              }),
          ],
          [
            "裁剪到选区",
            () => {
              if (selection) {
                const bounds = alphaBounds(
                  selection
                    .getContext("2d")
                    .getImageData(0, 0, doc.width, doc.height).data,
                  doc.width,
                  doc.height,
                );
                applyCrop(bounds);
              }
            },
            "",
            !selection,
          ],
          [
            "裁去透明边缘",
            async () => {
              const image = await renderDocument(doc);
              const bounds = alphaBounds(
                image.getContext("2d").getImageData(0, 0, doc.width, doc.height)
                  .data,
                doc.width,
                doc.height,
              );
              if (bounds) applyCrop(bounds);
            },
          ],
          null,
          [
            "水平翻转画布",
            () =>
              commit(
                {
                  ...doc,
                  layers: doc.layers.map((l) => ({
                    ...l,
                    x: doc.width - l.x - l.width,
                    rotation: -l.rotation,
                    flipX: !l.flipX,
                  })),
                  guides: doc.guides.map((g) =>
                    g.axis === "x"
                      ? { ...g, position: doc.width - g.position }
                      : g,
                  ),
                },
                "翻转画布",
              ),
          ],
          [
            "垂直翻转画布",
            () =>
              commit(
                {
                  ...doc,
                  layers: doc.layers.map((l) => ({
                    ...l,
                    y: doc.height - l.y - l.height,
                    rotation: -l.rotation,
                    flipY: !l.flipY,
                  })),
                  guides: doc.guides.map((g) =>
                    g.axis === "y"
                      ? { ...g, position: doc.height - g.position }
                      : g,
                  ),
                },
                "翻转画布",
              ),
          ],
        ],
        图层: [
          [
            "新建空白图层",
            () =>
              addLayer(
                makeLayer("raster", {
                  name: "空白图层",
                  width: doc.width,
                  height: doc.height,
                }),
              ),
            "Ctrl Shift N",
          ],
          ["复制图层", duplicateLayers, "Ctrl J", !selected.length],
          ["删除图层", removeLayers, "Backspace", !selected.length],
          null,
          ["编组", groupLayers, "Ctrl G", !selected.length],
          ["取消编组", ungroup, "Ctrl Shift G", layer?.type !== "group"],
          ["合并所选 / 向下合并", () => mergeLayers(), "Ctrl E", !layer],
          ["合并可见图层", () => mergeLayers(true)],
          null,
          [
            "从选区添加蒙版",
            () => maskAction("add"),
            "",
            !layer || ["group", "adjustment"].includes(layer?.type),
          ],
          [
            "切换剪贴蒙版",
            () => updateLayer({ clipped: !layer.clipped }, "剪贴蒙版"),
            "",
            !layer || layer.type === "adjustment",
          ],
          [
            "栅格化图层",
            async () => {
              const result = await rasterize();
              updateLayer(result.layer, "栅格化图层");
            },
            "",
            !layer || ["group", "adjustment"].includes(layer?.type),
          ],
        ],
        选择: [
          ["全选", selectAll, "Ctrl A"],
          ["取消选择", () => setSelection(null), "Ctrl D", !selection],
          [
            "反向选择",
            () => changeSelection("invert"),
            "Ctrl Shift I",
            !selection,
          ],
          ["羽化 5 px", () => changeSelection("feather"), "", !selection],
          null,
          ["扩展 5 px", () => changeSelection("expand"), "", !selection],
          ["收缩 5 px", () => changeSelection("contract"), "", !selection],
          [
            "剪切选区到新图层",
            liftSelection,
            "",
            !selection ||
              !layer ||
              ["group", "adjustment"].includes(layer?.type),
          ],
          [
            "载入图层透明度",
            async () => {
              if (layer) {
                const result = await rasterize();
                setSelection(result.surface);
              }
            },
            "",
            !layer || ["group", "adjustment"].includes(layer?.type),
          ],
        ],
        滤镜: [
          ["曝光 / 对比度", () => addAdjustment("曝光", { exposure: 0.25 })],
          ["色相 / 饱和度", () => addAdjustment("色相 / 饱和度", {})],
          [
            "色阶",
            () => {
              addAdjustment("色阶", {});
              focusPanel("adjustments");
            },
          ],
          ["曲线", () => addAdjustment("曲线", {})],
          ["黑白", () => addAdjustment("黑白", { grayscale: 1 })],
          ["反相", () => addAdjustment("反相", { invert: 1 })],
          ["渐变映射", () => addAdjustment("渐变映射", { duotone: true })],
          null,
          ["高斯模糊", () => addAdjustment("高斯模糊", { blur: 5 })],
          ["胶片颗粒", () => addAdjustment("胶片颗粒", { noise: 15 })],
          ["暗角", () => addAdjustment("暗角", { vignette: 35 })],
          ["运动模糊", () => addAdjustment("运动模糊", { motion: 20 })],
        ],
        视图: [
          ["适合窗口", () => fitCanvas(), "Ctrl 0"],
          [
            "实际大小 100%",
            () => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            },
            "Ctrl 1",
          ],
          null,
          [`${rulers ? "✓ " : ""}${labelText("标尺")}`, () => setRulers(!rulers), "Ctrl R"],
          [`${grid ? "✓ " : ""}${labelText("网格")}`, () => setGrid(!grid), "Ctrl '"],
          [`${snap ? "✓ " : ""}${labelText("自动吸附")}`, () => setSnap(!snap)],
          [
            "添加参考线…",
            () =>
              setModal({
                type: "guide",
                axis: "x",
                position: Math.round(doc.width / 2),
              }),
          ],
          [
            "清除参考线",
            () => commit({ ...doc, guides: [] }, "清除参考线"),
            "",
            !doc.guides.length,
          ],
          null,
          [`${panel ? "隐藏" : "显示"}全部面板`, () => setPanel(!panel), "Tab"],
          ["专注画布", () => setFullscreen(!fullscreen), "F"],
        ],
        面板: [
          ["面板与布局预设…", () => { setPanel(true); setModal({ type: "panels" }); }],
          null,
          ...[["properties", "属性"], ["adjustments", "调整"], ["layers", "图层"], ["palette", "色板"]].map(([id, title]) => [
            english
              ? `${labelText(!panel || panelLayout.layout.panels[id].hidden ? "显示" : "隐藏")} ${labelText(title)}`
              : `${!panel || panelLayout.layout.panels[id].hidden ? "显示" : "隐藏"}${title}面板`,
            () => {
              panelLayout.updatePanel(id, { hidden: panel && !panelLayout.layout.panels[id].hidden });
              setPanel(true);
            },
          ]),
          null,
          ["重置默认面板布局", () => { panelLayout.resetLayout(); setPanel(true); }],
        ],
        帮助: [
          ["快捷键", () => setModal({ type: "shortcuts" }), "?"],
          ["功能与版本说明", () => setModal({ type: "about" })],
        ],
      }
    : {};
  const commands = [
    ...Object.entries(menus).flatMap(([section, items]) =>
      items.filter(Boolean).map((item) => ({
        section: labelText(section),
        label: labelText(item[0]),
        action: item[1],
        shortcut: item[2],
        disabled: item[3],
      })),
    ),
    ...TOOLS.map(([id, , name, key]) => ({
      section: labelText("工具"),
      label: labelText(name),
      action: () => { setTool(id); focusPanel("properties"); },
      shortcut: key,
    })),
  ];
  const filteredCommands = commands.filter((command) =>
    `${command.section} ${command.label}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  useEffect(() => {
    if (!active || !doc) return;
    function keydown(event) {
      if (
        !doc ||
        modal ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
        event.target.isContentEditable
      )
        return;
      const mod = event.ctrlKey || event.metaKey,
        key = event.key.toLowerCase();
      if (key === "escape") {
        cancelGesture();
        setSelection(null);
        setMenu(null);
        setFullscreen(false);
        return;
      }
      if (key === " ") {
        event.preventDefault();
        space.current = true;
        return;
      }
      if (mod) {
        const actions = {
          z: () => undo(event.shiftKey),
          y: () => undo(true),
          s: saveProject,
          o: () => fileRef.current.click(),
          n: () =>
            event.shiftKey
              ? addLayer(
                  makeLayer("raster", {
                    name: "空白图层",
                    width: doc.width,
                    height: doc.height,
                  }),
                )
              : setModal({ type: "new" }),
          j: duplicateLayers,
          g: () => (event.shiftKey ? ungroup() : groupLayers()),
          e: () =>
            event.shiftKey
              ? (setModal({ type: "export" }), exportImage(false))
              : mergeLayers(),
          a: selectAll,
          d: () => setSelection(null),
          i: () => event.shiftKey && changeSelection("invert"),
          c: copyContent,
          v: pasteContent,
          k: () => setModal({ type: "commands" }),
          f: () => setModal({ type: "commands" }),
          r: () => setRulers(!rulers),
          "'": () => setGrid(!grid),
          0: () => fitCanvas(),
          1: () => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          },
          "=": () => setZoom((z) => Math.min(8, z * 1.25)),
          "+": () => setZoom((z) => Math.min(8, z * 1.25)),
          "-": () => setZoom((z) => Math.max(0.05, z / 1.25)),
        };
        if (actions[key] && !(key === "v" && !clipboard.current)) {
          event.preventDefault();
          execute(actions[key]);
        }
        return;
      }
      if (event.altKey && key === "backspace") {
        event.preventDefault();
        execute(() => fillSelection());
        return;
      }
      if (key === "backspace" || key === "delete") {
        event.preventDefault();
        if (selection && layer?.type !== "adjustment") execute(() => fillSelection(true));
        else removeLayers();
        return;
      }
      if (key === "enter" && tool === "crop") {
        applyCrop();
        return;
      }
      if (key === "tab") {
        event.preventDefault();
        setPanel(!panel);
        return;
      }
      if (key === "f") {
        setFullscreen(!fullscreen);
        return;
      }
      if (key === "?") {
        setModal({ type: "shortcuts" });
        return;
      }
      if (key === "x") {
        setColor(backColor);
        setBackColor(color);
        return;
      }
      if (key === "[" || key === "]") {
        setBrush((current) => ({ ...current, size: Math.max(1, Math.min(1000, current.size + (key === "]" ? 5 : -5))) }));
        return;
      }
      if (key.startsWith("arrow") && layer && !layer.locked) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const ids = descendantIds(doc.layers, selected);
        commit(
          {
            ...doc,
            layers: doc.layers.map((l) =>
              ids.has(l.id)
                ? {
                    ...l,
                    x:
                      l.x +
                      (key === "arrowright"
                        ? step
                        : key === "arrowleft"
                          ? -step
                          : 0),
                    y:
                      l.y +
                      (key === "arrowdown"
                        ? step
                        : key === "arrowup"
                          ? -step
                          : 0),
                  }
                : l,
            ),
          },
          "微调位置",
        );
        return;
      }
      const match = TOOLS.find((t) => t[3].toLowerCase() === key);
      if (match) {
        event.preventDefault();
        setTool(match[0]);
        focusPanel("properties");
        setDraftRect(null);
      }
    }
    const keyup = (event) => {
      if (event.key === " ") space.current = false;
    };
    const blur = () => {
      space.current = false;
      if (gesture.current) cancelGesture();
    };
    const paste = (event) => {
      if (modal || ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      const images = [...(event.clipboardData?.files || [])].filter((f) =>
        f.type.startsWith("image/"),
      );
      if (images.length) {
        event.preventDefault();
        processFiles(images);
      }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      window.removeEventListener("paste", paste);
    };
  });

  useEffect(() => {
    if (modal?.type === "export")
      exportImage(false).catch((e) => setToast(e.message));
  }, [exportOptions]);

  function layerRows(parentId = null, depth = 0, targetId = null) {
    return [...doc.layers]
      .reverse()
      .filter((l) => targetId ? l.targetId === targetId : l.parentId === parentId && !l.targetId)
      .flatMap((item) => {
        const Icon = {
          text: Type,
          group: Folder,
          adjustment: SlidersHorizontal,
          gradient: Blend,
          rect: Shapes,
          roundRect: Shapes,
          triangle: Shapes,
          diamond: Shapes,
          pentagon: Shapes,
          hexagon: Shapes,
          star: Shapes,
          arrow: Shapes,
          heart: Shapes,
          ellipse: Circle,
          line: Minus,
          raster: ImageIcon,
        }[item.type];
        const linkedChildren = doc.layers.filter((entry) => entry.targetId === item.id);
        const row = (
          <div
            role="option"
            aria-selected={selected.includes(item.id)}
            aria-label={`图层 ${item.name}`}
            key={item.id}
            className={`layer-row ${item.targetId ? "linked-adjustment" : ""} ${selected.includes(item.id) ? "selected" : ""} ${!item.visible ? "hidden-layer" : ""}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            draggable
            onDragStart={(event) => {
              dragLayer.current = item.id;
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              reorder(dragLayer.current, item.id);
            }}
            onClick={(event) => {
              finishPreview();
              setSelected(
                event.ctrlKey || event.metaKey || event.shiftKey
                  ? selected.includes(item.id)
                    ? selected.filter((id) => id !== item.id)
                    : [...selected, item.id]
                  : [item.id],
              );
              setMaskEditing(false);
              if (item.type === "adjustment") focusPanel("adjustments");
            }}
            onDoubleClick={() =>
              setModal({ type: "rename", id: item.id, name: item.name })
            }
            onContextMenu={(event) => {
              event.preventDefault();
              setSelected([item.id]);
              setMenu("图层");
            }}
          >
            <IconButton
              icon={item.visible ? Eye : EyeOff}
              label={`${item.visible ? "隐藏" : "显示"} ${item.name}`}
              onClick={(event) => {
                event.stopPropagation();
                commit(
                  {
                    ...doc,
                    layers: doc.layers.map((l) =>
                      l.id === item.id ? { ...l, visible: !l.visible } : l,
                    ),
                  },
                  "切换可见性",
                );
              }}
            />
            {item.type === "group" || linkedChildren.length ? (
              <button
                className="group-toggle"
                aria-label={`${collapsed.includes(item.id) ? "展开" : "折叠"} ${item.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsed((ids) =>
                    ids.includes(item.id)
                      ? ids.filter((id) => id !== item.id)
                      : [...ids, item.id],
                  );
                }}
              >
                {collapsed.includes(item.id) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
              </button>
            ) : item.targetId ? (
              <Link2 size={12} className="linked-adjustment-icon" aria-label={labelText("链接到图像")} />
            ) : item.clipped ? (
              <span className="clipped-mark">↳</span>
            ) : null}
            <span
              className={`layer-thumb ${item.type === "raster" ? "checkerboard" : ""}`}
              style={
                ["rect", "ellipse"].includes(item.type)
                  ? { background: item.fill }
                  : undefined
              }
            >
              {item.src ? <img src={item.src} alt="" /> : <Icon size={17} />}
            </span>
            {item.mask && (
              <button
                className={`mask-thumb ${selected.includes(item.id) && maskEditing ? "selected" : ""}`}
                title={labelText("编辑蒙版")}
                aria-label={`编辑 ${item.name} 蒙版`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected([item.id]);
                  setMaskEditing(true);
                  setTool("brush");
                }}
              >
                <img src={item.mask} alt={labelText("蒙版")} />
              </button>
            )}
            <span className="layer-name">
              {item.name}
              <small>
                {item.type === "group"
                  ? "文件夹"
                  : item.type === "adjustment"
                    ? item.targetId ? "链接调整 · 仅影响所属图层" : "调整下方图层"
                    : `${Math.round(item.width)} × ${Math.round(item.height)}`}
              </small>
            </span>
            {item.targetId && (
              <IconButton icon={Trash2} label={`删除链接调整 ${item.name}`} disabled={item.locked}
                onClick={(event) => {
                  event.stopPropagation();
                  commit({ ...doc, layers: doc.layers.filter((entry) => entry.id !== item.id) }, "删除链接调整");
                  setSelected((ids) => ids.filter((id) => id !== item.id));
                }} />
            )}
            <button
              className={`layer-lock ${item.locked ? "locked" : ""}`}
              aria-label={`${item.locked ? "解锁" : "锁定"} ${item.name}`}
              title={item.locked ? "解锁图层" : "锁定图层"}
              onClick={(event) => {
                event.stopPropagation();
                commit(
                  {
                    ...doc,
                    layers: doc.layers.map((l) =>
                      l.id === item.id ? { ...l, locked: !l.locked } : l,
                    ),
                  },
                  "切换锁定",
                );
              }}
            >
              {item.locked ? (
                <LockKeyhole size={12} />
              ) : (
                <UnlockKeyhole size={12} />
              )}
            </button>
          </div>
        );
        if (collapsed.includes(item.id)) return [row];
        if (item.type === "group") return [row, ...layerRows(item.id, depth + 1)];
        return linkedChildren.length ? [row, ...layerRows(null, depth + 1, item.id)] : [row];
      });
  }
  if (!doc)
    return (
      <main className="loading-screen">
        <div className="brand-mark">
          <Layers size={26} />
        </div>
        <h1>{english ? "Image Processing" : "图像处理"}</h1>
        <p>{english ? "Preparing your workspace…" : "正在准备你的工作台…"}</p>
      </main>
    );

  const editorPanels = [
    ...[["properties", "属性"], ["adjustments", "调整"]].map(([id, title]) => ({ id, title, content: (
            <Inspector
              toolProperties={id === "properties" && ["brush", "eraser", "clone", "blur", "mosaic", "shape", "text", "gradient", "marquee", "lasso", "wand", "crop", "fill", "eyedropper"].includes(tool) ? (
                <ToolProperties
                  tool={tool} brush={brush} setBrush={setBrush}
                  openBrushSettings={() => setModal({ type: "brush" })}
                  mosaicSize={mosaicSize} setMosaicSize={setMosaicSize}
                  shape={shape} setShape={setShape}
                  shapeOptions={shapeOptions} setShapeOptions={setShapeOptions}
                  textOptions={textOptions} setTextOptions={setTextOptions}
                  selectionShape={selectionShape} setSelectionShape={setSelectionShape}
                  selectionMode={selectionMode} setSelectionMode={setSelectionMode}
                  tolerance={tolerance} setTolerance={setTolerance}
                  cropRatio={cropRatio} setCropRatio={setCropRatio}
                  color={color} setColor={setColor} backColor={backColor} setBackColor={setBackColor}
                  layer={layer} updateLayer={updateLayer}
                />
              ) : null}
              doc={doc}
              layer={layer}
              adjustmentTargetName={doc.layers.find((item) => item.id === layer?.targetId)?.name}
              adjustmentTargets={doc.layers.filter((item) => !["group", "adjustment"].includes(item.type)).map(({ id, name }) => ({ id, name }))}
              onAdjustmentTargetChange={(targetId) => {
                const target = doc.layers.find((item) => item.id === targetId);
                updateLayer({ targetId: targetId || null, parentId: target ? target.parentId : layer.parentId }, targetId ? "链接调整到图层" : "解除调整链接");
                if (targetId) setCollapsed((ids) => ids.filter((id) => id !== targetId));
              }}
              tab={id}
              update={updateLayer}
              preview={previewLayer}
              finishPreview={finishPreview}
              addAdjustment={addAdjustment}
              openResize={() =>
                setModal({
                  type: "resize",
                  width: doc.width,
                  height: doc.height,
                  mode: "canvas",
                })
              }
              maskEditing={maskEditing}
              setMaskEditing={setMaskEditing}
              maskAction={(action) => execute(() => maskAction(action))}
            />
    ) })),
    { id: "layers", title: "图层", content: (
            <div className="layers-panel">
              <header>
                <h2>
                  {labelText("图层")} <span>{doc.layers.length}</span>
                </h2>
                <IconButton
                  icon={History}
                  label="历史记录"
                  onClick={() => setModal({ type: "history" })}
                />
              </header>
              <div className="layer-controls">
                <select
                  aria-label={labelText("混合模式")}
                  value={layer?.blend || "source-over"}
                  disabled={!layer || layer.type === "adjustment"}
                  onChange={(e) =>
                    updateLayer({ blend: e.target.value }, "混合模式")
                  }
                >
                  {BLENDS.map(([value, name]) => (
                    <option key={value} value={value}>
                      {english ? value.replace("source-over", "normal").replaceAll("-", " ") : name}
                    </option>
                  ))}
                </select>
                <NumberField
                  label="不透明度"
                  value={Math.round((layer?.opacity ?? 1) * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  disabled={!layer}
                  onChange={(value) =>
                    updateLayer({ opacity: value / 100 }, "图层透明度")
                  }
                />
              </div>
              <div
                className="layer-list"
                role="listbox"
                aria-label={labelText("图层列表")}
                aria-multiselectable="true"
              >
                {layerRows()}
                {!doc.layers.length && (
                  <div className="panel-empty">
                    {labelText("尚无图层")}
                    <br />
                    <small>{labelText("导入图像或新建空白图层")}</small>
                  </div>
                )}
              </div>
              <div className="layer-footer">
                <IconButton
                  icon={SquarePlus}
                  label="新建空白图层"
                  onClick={() =>
                    addLayer(
                      makeLayer("raster", {
                        name: "空白图层",
                        width: doc.width,
                        height: doc.height,
                      }),
                    )
                  }
                />
                <IconButton
                  icon={FolderPlus}
                  label="编组所选图层"
                  disabled={!selected.length}
                  onClick={groupLayers}
                />
                <IconButton
                  icon={Circle}
                  label="添加图层蒙版"
                  disabled={
                    !layer ||
                    layer.locked ||
                    ["group", "adjustment"].includes(layer.type)
                  }
                  onClick={() => execute(() => maskAction("add"))}
                />
                <IconButton
                  icon={Blend}
                  label="新建调整图层"
                  onClick={() => addAdjustment("色彩", {})}
                />
                <IconButton
                  icon={Copy}
                  label="复制所选图层"
                  disabled={!selected.length}
                  onClick={duplicateLayers}
                />
                <div className="rail-spacer" />
                <IconButton
                  icon={Trash2}
                  label={maskEditing && layer?.mask ? "删除所选蒙版" : "删除所选图层"}
                  disabled={!selected.length}
                  onClick={removeLayers}
                />
              </div>
            </div>

    ) },
    { id: "palette", title: "色板", content: (
            <PalettePanel
              doc={doc}
              layer={layer}
              color={color}
              onColor={setColor}
              notify={setToast}
            />
    ) },
  ];

  return (
    <main
      className={`editor ${fullscreen ? "focus-mode" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          processFiles([...event.dataTransfer.files]);
        }
      }}
    >
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="image/*,.psd,.compweb,.json,.zip"
        onChange={(event) => {
          processFiles([...event.target.files]);
          event.target.value = "";
        }}
      />
      <header className="app-header">
        <nav className="menu-bar" aria-label={labelText("主菜单")}>
          {Object.keys(menus).map((name) => (
            <div className="menu-container" key={name}>
              <button
                className={
                  menu === name ? "menu-trigger opened" : "menu-trigger"
                }
                aria-haspopup="menu"
                aria-expanded={menu === name}
                onClick={() => setMenu(menu === name ? null : name)}
              >
                {name === "面板" && english ? "Panels" : labelText(name)}
              </button>
              {menu === name && (
                <div className="menu-dropdown" role="menu">
                  {menus[name].map((item, index) =>
                    item ? (
                      <button
                        role="menuitem"
                        key={item[0]}
                        disabled={item[3]}
                        onClick={() => execute(item[1])}
                      >
                        <span>{labelText(item[0])}</span>
                        <kbd>{item[2]}</kbd>
                      </button>
                    ) : (
                      <hr key={index} />
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="header-spacer" />
        <button className="import-button" title={english ? "Import from gallery" : "从画廊导入图像"} aria-label={english ? "Import from gallery" : "从画廊导入图像"} onClick={onOpenGallery}>
          <ImageIcon size={15} />
          <span>{english ? "Gallery" : "画廊导入"}</span>
        </button>
        <button className="import-button" title={english ? "Import comic project" : "导入漫画项目"} aria-label={english ? "Import comic project" : "导入漫画项目"} onClick={onOpenComic}>
          <Layers size={15} />
          <span>{english ? "Comic Project" : "漫画项目"}</span>
        </button>
        <button
          className="search-button"
          title={labelText("查找命令 (Ctrl K)")}
          aria-label={labelText("查找命令")}
          onClick={() => setModal({ type: "commands" })}
        >
          <Search size={15} />
          <kbd>Ctrl K</kbd>
        </button>
        <span className={`save-status ${status}`} title={labelText("自动保存到当前浏览器")}>
          <span />
          {labelText(status === "saving"
            ? "保存中"
            : status === "error"
              ? "未保存"
              : "已存于本地")}
        </span>
        <button
          className="export-button"
          onClick={() =>
            execute(() => {
              setModal({ type: "export" });
              return exportImage(false);
            })
          }
        >
          <Download size={14} />
          {labelText("导出")}
          <ChevronDown size={12} />
        </button>
      </header>
      <div className="tool-options">
        <div className="current-tool">
          <ToolIcon size={16} />
          <span>{labelText(currentTool[2])}</span>
        </div>
        <span className="option-divider" />
        {tool === "move" && (
          <>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={autoSelect}
                onChange={(e) => setAutoSelect(e.target.checked)}
              />
              {labelText("自动选择")}
            </label>
            <select aria-label={labelText("选择模式")} value="layer" onChange={() => {}}>
              <option value="layer">{labelText("图层")}</option>
            </select>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              {labelText("吸附")}
            </label>
            <span className="option-note">{labelText("拖动边角缩放，顶部圆点旋转")}</span>
          </>
        )}
        {["brush", "eraser", "clone", "blur", "mosaic"].includes(tool) && (
          <>
            <NumberField
              label="大小"
              value={brush.size}
              min={1}
              max={1000}
              onChange={(size) => setBrush({ ...brush, size })}
              suffix="px"
            />
            <NumberField
              label="硬度"
              value={brush.hardness}
              min={0}
              max={100}
              disabled={!!brush.tip}
              onChange={(hardness) => setBrush({ ...brush, hardness })}
              suffix="%"
            />
            <NumberField
              label="画笔不透明度"
              value={brush.opacity}
              min={1}
              max={100}
              onChange={(opacity) => setBrush({ ...brush, opacity })}
              suffix="%"
            />
            <button className="tool-action" onClick={() => setModal({ type: "brush" })}>
              <SlidersHorizontal size={14} /> {labelText("笔刷设置")}
            </button>
            {tool === "mosaic" && <NumberField label="马赛克块" value={mosaicSize} min={2} max={128} onChange={(value) => setMosaicSize(Math.round(value))} suffix="px" />}
            {layer?.mask && (
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={maskEditing}
                  onChange={(e) => setMaskEditing(e.target.checked)}
                />
                {labelText("编辑蒙版")}
              </label>
            )}
            {tool === "clone" && (
              <span className="option-note">{labelText("Alt 点击设置仿制源")}</span>
            )}
          </>
        )}
        {["marquee", "lasso", "wand"].includes(tool) && (
          <>
            {tool === "marquee" && (
              <select
                aria-label={labelText("选区形状")}
                value={selectionShape}
                onChange={(e) => setSelectionShape(e.target.value)}
              >
                <option value="rect">{labelText("矩形")}</option>
                <option value="ellipse">{labelText("椭圆")}</option>
              </select>
            )}
            <div className="segmented">
              {[
                ["replace", "新选区"],
                ["add", "添加"],
                ["subtract", "减去"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={selectionMode === value ? "selected" : ""}
                  onClick={() => setSelectionMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tool === "wand" && (
              <NumberField
                label="容差"
                value={tolerance}
                min={0}
                max={255}
                onChange={setTolerance}
              />
            )}
            <button
              className="text-button"
              onClick={() => setSelection(null)}
              disabled={!selection}
            >
              取消选择
            </button>
          </>
        )}
        {tool === "shape" && (
          <>
            <select
              aria-label={labelText("形状类型")}
              value={shape}
              onChange={(e) => {
                setShape(e.target.value);
                if (["rect", "roundRect"].includes(e.target.value))
                  setShapeOptions({ ...shapeOptions, radius: e.target.value === "rect" ? 0 : shapeOptions.radius || 24 });
              }}
            >
              {SHAPES.map(([type, name]) => <option key={type} value={type}>{labelText(name)}</option>)}
            </select>
            <span className="option-note">{labelText("拖动绘制 · Shift 约束比例")}</span>
          </>
        )}
        {tool === "crop" && (
          <>
            <span>{labelText("比例")}</span>
            <select
              aria-label={labelText("裁剪比例")}
              value={cropRatio}
              onChange={(e) => setCropRatio(e.target.value)}
            >
              {["free", "1:1", "3:2", "4:3", "16:9", "3:4", "9:16"].map((r) => (
                <option key={r} value={r}>
                  {r === "free" ? labelText("自由") : r}
                </option>
              ))}
            </select>
            <span className="option-note">{labelText("裁剪保留画布外的原始图层像素")}</span>
          </>
        )}
        {["text", "gradient", "fill", "eyedropper"].includes(tool) && (
          <>
            <label className="inline-color">
              {labelText("前景色")}
              <input
                type="color"
                aria-label={labelText("工具颜色")}
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <span className="option-note">
              {tool === "text"
                ? "拖出任意文字框 · 单击使用默认大小 · 双击文字编辑"
                : tool === "gradient"
                  ? "拖动绘制渐变，在属性面板调整颜色"
                  : tool === "eyedropper"
                    ? "点击画布采样合成颜色"
                    : "点击画布填充选区或整个图层"}
            </span>
          </>
        )}
        {["hand", "zoom"].includes(tool) && (
          <>
            <button className="text-button" onClick={() => fitCanvas()}>
              {labelText("适合窗口")}
            </button>
            <button className="text-button" onClick={() => setZoom(1)}>
              100%
            </button>
            <span className="option-note">
              {labelText("Ctrl + 滚轮缩放 · 空格 + 拖动平移")}
            </span>
          </>
        )}
        <div className="header-spacer" />
        <div className="undo-actions">
          <IconButton
            icon={Undo2}
            label="撤销 (Ctrl Z)"
            disabled={!history.past.length}
            onClick={() => undo()}
          />
          <IconButton
            icon={Redo2}
            label="重做 (Ctrl Shift Z)"
            disabled={!history.future.length}
            onClick={() => undo(true)}
          />
        </div>
        <span className="option-divider" />
        <IconButton
          icon={Upload}
          label="导入图像"
          onClick={() => fileRef.current.click()}
        />
        <IconButton icon={Save} label="保存项目" onClick={saveProject} />
      </div>
      <div className="workspace">
        <aside className="tool-rail" aria-label={labelText("绘图工具")}>
          {TOOLS.map(([id, Icon, name, key]) => (
            <div
              key={id}
              className={["brush", "gradient", "hand"].includes(id) ? "tool-divider" : ""}
            >
              <IconButton
                icon={Icon}
                label={`${labelText(name)} (${key})`}
                active={tool === id}
                onClick={() => {
                  setTool(id);
                  focusPanel("properties");
                  setDraftRect(null);
                }}
              />
            </div>
          ))}
          <div className="rail-spacer" />
          <div className="color-pair">
            <input
              type="color"
              title={labelText("背景色")}
              aria-label={labelText("背景色")}
              className="back-color"
              value={backColor}
              onChange={(e) => setBackColor(e.target.value)}
            />
            <input
              type="color"
              title={labelText("前景色")}
              aria-label={labelText("前景色")}
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <button
              title={labelText("交换前景与背景色 (X)")}
              aria-label={labelText("交换前景与背景色")}
              onClick={() => {
                setColor(backColor);
                setBackColor(color);
              }}
            >
              ↔
            </button>
          </div>
          <IconButton
            icon={CircleHelp}
            label="帮助与快捷键"
            onClick={() => setModal({ type: "shortcuts" })}
          />
        </aside>
        <WorkspacePanels panels={editorPanels} layout={panelLayout.layout} onChange={panelLayout.setLayout} visible={panel && !fullscreen} active={active}>
        <section className="canvas-workspace">
          <div className="document-tabs">
            {docs.map((item) => (
              <div
                className={`document-tab ${item.id === activeId ? "active" : ""}`}
                key={item.id}
              >
                <button onClick={() => switchDocument(item.id)}>
                  <ImageIcon size={13} />
                  <span>{item.name}</span>
                  <small>{Math.round(zoom * 100)}%</small>
                </button>
                <button
                  aria-label={`关闭 ${item.name}`}
                  className="tab-close"
                  onClick={() =>
                    setModal({ type: "close", id: item.id, name: item.name })
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <IconButton
              icon={Plus}
              label="新建文档"
              onClick={() => setModal({ type: "new" })}
            />
            <div className="tabs-spacer" />
            <IconButton
              icon={panel ? PanelRightClose : PanelRightOpen}
              label={panel ? "隐藏全部面板" : "显示全部面板"}
              onClick={() => setPanel(!panel)}
            />
          </div>
          <div
            className={`canvas-stage tool-${tool} ${space.current ? "panning" : ""}`}
            ref={stageRef}
            onPointerDown={(event) =>
              pointerDown(event).catch((error) => {
                cancelGesture();
                setToast(error.message);
              })
            }
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={cancelGesture}
            onDoubleClick={(event) => {
              if (!["move", "text"].includes(tool)) return;
              const point = canvasPoint(event);
              hitLayer(docRef.current, point).then((hit) => {
                if (hit?.type === "text" && !hit.locked) editTextLayer(hit);
              }).catch((error) => setToast(error.message));
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {rulers && (
              <>
                <div className="ruler-corner">
                  <Ruler size={11} />
                </div>
                <div
                  className="ruler-horizontal"
                  data-ruler="y"
                  title={labelText("从标尺拖入水平参考线")}
                >
                  {Array.from(
                    { length: Math.ceil(doc.width / 100) + 1 },
                    (_, i) => (
                      <span
                        key={i}
                        style={{
                          left: `calc(50% + ${pan.x + (i * 100 - doc.width / 2) * zoom}px)`,
                        }}
                      >
                        {i * 100}
                      </span>
                    ),
                  )}
                </div>
                <div
                  className="ruler-vertical"
                  data-ruler="x"
                  title={labelText("从标尺拖入垂直参考线")}
                >
                  {Array.from(
                    { length: Math.ceil(doc.height / 100) + 1 },
                    (_, i) => (
                      <span
                        key={i}
                        style={{
                          top: `calc(50% + ${pan.y + (i * 100 - doc.height / 2) * zoom}px)`,
                        }}
                      >
                        {i * 100}
                      </span>
                    ),
                  )}
                </div>
              </>
            )}
            <div
              className="artboard-label"
              style={{
                left: `calc(50% + ${pan.x - (doc.width * zoom) / 2}px)`,
                top: `calc(50% + ${pan.y - (doc.height * zoom) / 2 - 24}px)`,
              }}
            >
              <span>{doc.name}</span>
              <small>
                {doc.width} × {doc.height}
              </small>
            </div>
            <div
              className="artboard checkerboard"
              ref={boardRef}
              style={{
                width: doc.width * zoom,
                height: doc.height * zoom,
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
              }}
            >
              <canvas ref={canvasRef} aria-label={labelText("图像编辑画布")} role="img" />
              {grid && (
                <div
                  className="grid-overlay"
                  style={{ backgroundSize: `${50 * zoom}px ${50 * zoom}px` }}
                />
              )}
              {doc.guides.map((guide, index) => (
                <div
                  key={index}
                  className={`guide-line ${guide.axis}`}
                  style={
                    guide.axis === "x"
                      ? { left: guide.position * zoom }
                      : { top: guide.position * zoom }
                  }
                />
              ))}
              {snapped.map((guide, index) => (
                <div
                  key={index}
                  className={`guide-line snap-line ${guide.axis}`}
                  style={
                    guide.axis === "x"
                      ? { left: guide.position * zoom }
                      : { top: guide.position * zoom }
                  }
                />
              ))}
              {selectionImage && (
                <img
                  className="selection-outline"
                  src={selectionImage}
                  alt={labelText("选区边界")}
                />
              )}
              {draftRect && ["marquee", "lasso", "crop", "text"].includes(tool) && (
                <svg
                  className="drawing-overlay"
                  viewBox={`0 0 ${doc.width} ${doc.height}`}
                >
                  <defs>
                    <mask id="crop-shade">
                      <rect
                        width={doc.width}
                        height={doc.height}
                        fill="white"
                      />
                      <rect {...draftRect} fill="black" />
                    </mask>
                  </defs>
                  {tool === "crop" && (
                    <rect
                      width={doc.width}
                      height={doc.height}
                      fill="#0008"
                      mask="url(#crop-shade)"
                    />
                  )}
                  {tool === "lasso" ? (
                    <polyline
                      points={draftPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={1 / zoom}
                    />
                  ) : tool === "marquee" && selectionShape === "ellipse" ? (
                    <ellipse
                      cx={draftRect.x + draftRect.width / 2}
                      cy={draftRect.y + draftRect.height / 2}
                      rx={draftRect.width / 2}
                      ry={draftRect.height / 2}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={1 / zoom}
                      strokeDasharray={`${5 / zoom} ${5 / zoom}`}
                    />
                  ) : (
                    <rect
                      {...draftRect}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={1 / zoom}
                      strokeDasharray={
                        tool === "crop" ? undefined : `${5 / zoom} ${5 / zoom}`
                      }
                    />
                  )}
                </svg>
              )}
              {tool === "move" &&
                layer &&
                !layer.locked &&
                !["group", "adjustment"].includes(layer.type) && (
                  <div
                    className="transform-box"
                    style={{
                      left: layer.x * zoom,
                      top: layer.y * zoom,
                      width: layer.width * zoom,
                      height: layer.height * zoom,
                      transform: `rotate(${layer.rotation}deg)`,
                    }}
                  >
                    <span className="size-label">
                      {Math.round(layer.width)} × {Math.round(layer.height)}
                    </span>
                    {["nw", "ne", "sw", "se"].map((handle) => (
                      <button
                        key={handle}
                        data-handle={handle}
                        className={`transform-handle ${handle}`}
                        aria-label={`缩放图层 ${handle}`}
                        tabIndex={-1}
                      />
                    ))}
                    <span className="rotation-stem" />
                    <button
                      data-handle="rotate"
                      className="rotation-handle"
                      aria-label={labelText("旋转图层")}
                      tabIndex={-1}
                    />
                  </div>
                )}
            </div>
            {zoom >= 2 && thumb && (
              <div
                className="navigator"
                title={labelText("点击导航视图定位")}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setPan({
                    x:
                      (0.5 - (e.clientX - r.left) / r.width) * doc.width * zoom,
                    y:
                      (0.5 - (e.clientY - r.top) / r.height) *
                      doc.height *
                      zoom,
                  });
                }}
              >
                <img src={thumb} alt={labelText("导航缩略图")} />
              </div>
            )}
            {tool === "crop" && draftRect?.width > 1 && (
              <div
                className="crop-actions"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span>
                  {Math.round(draftRect.width)} × {Math.round(draftRect.height)}{" "}
                  px
                </span>
                <button onClick={() => setDraftRect(null)}>
                  <X size={14} />
                  {labelText("取消")}
                </button>
                <button className="primary" onClick={() => applyCrop()}>
                  <Check size={14} />
                  {labelText("应用裁剪")}
                </button>
              </div>
            )}
            {busy && <div className="busy-indicator">{labelText("正在读取文件…")}</div>}
            {fullscreen && (
              <button
                className="exit-focus"
                onClick={() => setFullscreen(false)}
              >
                退出专注模式 <kbd>Esc</kbd>
              </button>
            )}
            {!doc.layers.length && (
              <div className="empty-canvas-hint">
                <ImageIcon size={30} />
                <p>{labelText("把图像拖进来，开始创作")}</p>
                <span>{labelText("也可以使用左侧工具绘画、添加文字或形状")}</span>
                <button onClick={() => fileRef.current.click()}>
                  <Upload size={14} />
                  {labelText("导入图像")}
                </button>
              </div>
            )}
          </div>
          <footer className="canvas-footer">
            <div className="zoom-controls">
              <IconButton
                icon={Minus}
                label="缩小"
                onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}
              />
              <button className="zoom-value" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%<ChevronDown size={10} />
              </button>
              <IconButton
                icon={Plus}
                label="放大"
                onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
              />
              <button className="fit-button" onClick={() => fitCanvas()}>
                {labelText("适合窗口")}
              </button>
            </div>
            <span className="canvas-size">
              {doc.width} × {doc.height} px
              <span className="status-separator">|</span>RGB / 8
            </span>
            <span className="tool-hint">
              {labelText(tool === "move"
                ? "拖动移动 · Shift 多选 / 等比缩放 · 空格平移"
                : tool === "clone"
                  ? "Alt 点击取样 · 拖动仿制"
                  : maskEditing
                    ? "正在编辑蒙版 · 画笔显示 / 橡皮擦隐藏"
                    : tool === "crop"
                      ? "拖出裁剪框 · Enter 应用 · Esc 取消"
                      : tool === "brush" || tool === "eraser"
                        ? "[ ] 调整画笔大小 · Ctrl Z 撤销"
                        : `${labelText(currentTool[2])} · ${english ? "Ctrl + wheel to zoom" : "Ctrl + 滚轮缩放"}`)}
            </span>
            <span className="coordinates">
              {position.x}, {position.y}
            </span>
          </footer>
        </section>
        </WorkspacePanels>
      </div>
      {menu && (
        <div className="menu-dismiss" onPointerDown={() => setMenu(null)} />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button aria-label={labelText("关闭通知")} onClick={() => setToast("")}>
            <X size={13} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              new: "新建画布",
              export: "导出图像",
              resize: modal.mode === "image" ? "调整图像尺寸" : "调整画布尺寸",
              rename: "重命名图层",
              guide: "添加参考线",
              close: "关闭文档",
              import: "导入转换说明",
              commands: "查找命令",
              shortcuts: "快捷键",
              about: "关于 Compositor Web",
              history: "历史记录",
              brush: "笔刷设置",
              panels: "面板与布局预设",
            }[modal.type]
          }
          onClose={closeModal}
          wide={["export", "about", "shortcuts", "brush", "panels"].includes(modal.type)}
        >
          {modal.type === "panels" && <PanelLayoutMenu controller={panelLayout} panels={editorPanels} />}
          {modal.type === "brush" && <BrushSettings brush={brush} color={color} onChange={setBrush} />}
          {modal.type === "new" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                execute(() => {
                  const next = makeDocument(newOptions);
                  validateDocument(next);
                  openDocument(next);
                });
              }}
            >
              <p className="dialog-description">
                {labelText("从一张空白画布开始，给灵感留点空间。")}
              </p>
              <label className="form-field">
                {labelText("文档名称")}
                <input
                  value={newOptions.name}
                  onChange={(e) =>
                    setNewOptions({ ...newOptions, name: e.target.value })
                  }
                  required
                  autoFocus
                />
              </label>
              <div className="preset-grid">
                {[
                  ["横向画布", 1600, 1000],
                  ["社交方图", 1080, 1080],
                  ["竖版海报", 1080, 1440],
                  ["高清屏幕", 1920, 1080],
                ].map(([name, width, height]) => (
                  <button
                    type="button"
                    key={name}
                    className={
                      newOptions.width === width && newOptions.height === height
                        ? "selected"
                        : ""
                    }
                    onClick={() =>
                      setNewOptions({ ...newOptions, width, height })
                    }
                  >
                    <span
                      className="preset-shape"
                      style={{
                        width: (24 * width) / Math.max(width, height),
                        height: (24 * height) / Math.max(width, height),
                      }}
                    />
                    <strong>{labelText(name)}</strong>
                    <small>
                      {width} × {height}
                    </small>
                  </button>
                ))}
              </div>
              <div className="fields-grid">
                <label className="form-field">
                  {labelText("宽度 (px)")}
                  <input
                    aria-label={labelText("新画布宽度")}
                    type="number"
                    min="1"
                    max="8192"
                    required
                    value={newOptions.width}
                    onChange={(e) =>
                      setNewOptions({
                        ...newOptions,
                        width: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="form-field">
                  {labelText("高度 (px)")}
                  <input
                    aria-label={labelText("新画布高度")}
                    type="number"
                    min="1"
                    max="8192"
                    required
                    value={newOptions.height}
                    onChange={(e) =>
                      setNewOptions({
                        ...newOptions,
                        height: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label className="form-field">
                {labelText("背景")}
                <select
                  value={newOptions.background}
                  onChange={(e) =>
                    setNewOptions({ ...newOptions, background: e.target.value })
                  }
                >
                  <option value="#ffffff">{labelText("白色")}</option>
                  <option value="transparent">{labelText("透明")}</option>
                  <option value="#151515">{labelText("深色")}</option>
                </select>
              </label>
              <div className="modal-footer">
                <button type="button" onClick={closeModal}>
                  {labelText("取消")}
                </button>
                <button className="primary" type="submit">
                  {labelText("创建画布")}
                </button>
              </div>
            </form>
          )}
          {modal.type === "export" && (
            <div className="export-layout">
              <div className="export-preview checkerboard">
                {exportPreview ? (
                  <img src={exportPreview.src} alt={labelText("导出预览")} />
                ) : (
                  <span>{labelText("生成预览…")}</span>
                )}
              </div>
              <div className="export-settings">
                <p className="dialog-description">{labelText("将你的作品带到任何地方。")}</p>
                <label className="form-field">
                  {labelText("格式")}
                  <select
                    aria-label={labelText("导出格式")}
                    value={exportOptions.format}
                    onChange={(e) =>
                      setExportOptions({
                        ...exportOptions,
                        format: e.target.value,
                      })
                    }
                  >
                    <option value="png">{labelText("PNG · 无损，支持透明")}</option>
                    <option value="jpeg">{labelText("JPEG · 白色背景")}</option>
                    <option value="webp">{labelText("WebP · 支持透明")}</option>
                    <option value="pdf">{labelText("PDF · 单页，白色背景")}</option>
                  </select>
                </label>
                <label className="form-field">
                  {labelText("尺寸")}
                  <select
                    aria-label={labelText("导出缩放")}
                    value={exportOptions.scale}
                    onChange={(e) =>
                      setExportOptions({
                        ...exportOptions,
                        scale: Number(e.target.value),
                      })
                    }
                  >
                    {[0.25, 0.5, 1, 2].map((scale) => (
                      <option key={scale} value={scale}>
                        {scale * 100}%
                      </option>
                    ))}
                  </select>
                </label>
                {exportOptions.format === "pdf" && (
                  <label className="form-field">
                    {labelText("打印分辨率")}
                    <select
                      aria-label={labelText("PDF 分辨率")}
                      value={exportOptions.dpi}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          dpi: Number(e.target.value),
                        })
                      }
                    >
                      {[72, 150, 300].map((dpi) => (
                        <option key={dpi} value={dpi}>
                          {dpi} DPI
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {exportOptions.format !== "png" && (
                  <label className="form-field">
                    {labelText("质量")}：{Math.round(exportOptions.quality * 100)}%
                    <input
                      aria-label={labelText("导出质量")}
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.01"
                      value={exportOptions.quality}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          quality: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
                {exportPreview && (
                  <div className="export-details">
                    <span>
                      {exportPreview.width} × {exportPreview.height} px
                    </span>
                    <span>
                      {labelText("预计")} {(exportPreview.size / 1024).toFixed(0)} KB
                    </span>
                    <small>{labelText("使用文档原始像素渲染")}</small>
                  </div>
                )}
                <button
                  className="primary full-width"
                  onClick={() => execute(() => exportImage())}
                >
                  <Download size={15} />
                  {labelText("导出")} {exportOptions.format.toUpperCase()}
                </button>
                <button
                  className="text-button full-width"
                  onClick={saveProject}
                >
                  {labelText("或保存可编辑的 .compweb 项目")}
                </button>
              </div>
            </div>
          )}
          {modal.type === "resize" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                execute(() => {
                  const width = Number(modal.width),
                    height = Number(modal.height);
                  validateDocument({ width, height, layers: [] });
                  const sx = width / doc.width,
                    sy = height / doc.height;
                  const layers = doc.layers.map((l) =>
                    modal.mode === "image"
                      ? {
                          ...l,
                          x: l.x * sx,
                          y: l.y * sy,
                          width: l.width * sx,
                          height: l.height * sy,
                          fontSize: l.fontSize ? l.fontSize * sy : undefined,
                          strokeWidth: (l.strokeWidth * (sx + sy)) / 2,
                          radius: (l.radius * (sx + sy)) / 2,
                        }
                      : {
                          ...l,
                          x: l.x + (width - doc.width) / 2,
                          y: l.y + (height - doc.height) / 2,
                        },
                  );
                  commit(
                    {
                      ...doc,
                      width,
                      height,
                      layers,
                      guides: doc.guides.map((g) => ({
                        ...g,
                        position:
                          modal.mode === "image"
                            ? g.position * (g.axis === "x" ? sx : sy)
                            : g.position +
                              (g.axis === "x"
                                ? width - doc.width
                                : height - doc.height) /
                                2,
                      })),
                    },
                    modal.mode === "image" ? "缩放图像" : "调整画布",
                  );
                  setSelection(null);
                  closeModal();
                  setTimeout(() => fitCanvas(), 0);
                });
              }}
            >
              <p className="dialog-description">
                {modal.mode === "image"
                  ? "所有图层将随文档按比例缩放。"
                  : "以画布中心扩展或缩小边界，保留原有图层像素。"}
              </p>
              <div className="fields-grid">
                <label className="form-field">
                  宽度
                  <input
                    aria-label={labelText("尺寸宽度")}
                    type="number"
                    min="1"
                    max="8192"
                    required
                    value={modal.width}
                    onChange={(e) => {
                      const width = Number(e.target.value);
                      setModal({
                        ...modal,
                        width,
                        height:
                          modal.mode === "image" && modal.linked !== false
                            ? Math.max(
                                1,
                                Math.round((width * doc.height) / doc.width),
                              )
                            : modal.height,
                      });
                    }}
                  />
                </label>
                <label className="form-field">
                  高度
                  <input
                    aria-label={labelText("尺寸高度")}
                    type="number"
                    min="1"
                    max="8192"
                    required
                    value={modal.height}
                    onChange={(e) => {
                      const height = Number(e.target.value);
                      setModal({
                        ...modal,
                        height,
                        width:
                          modal.mode === "image" && modal.linked !== false
                            ? Math.max(
                                1,
                                Math.round((height * doc.width) / doc.height),
                              )
                            : modal.width,
                      });
                    }}
                  />
                </label>
              </div>
              {modal.mode === "image" && (
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={modal.linked !== false}
                    onChange={(e) =>
                      setModal({ ...modal, linked: e.target.checked })
                    }
                  />
                  保持纵横比
                </label>
              )}
              <div className="modal-footer">
                <button type="button" onClick={closeModal}>
                  {labelText("取消")}
                </button>
                <button className="primary">{labelText("应用尺寸")}</button>
              </div>
            </form>
          )}
          {modal.type === "rename" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                commit(
                  {
                    ...doc,
                    layers: doc.layers.map((l) =>
                      l.id === modal.id ? { ...l, name: modal.name } : l,
                    ),
                  },
                  "重命名图层",
                );
                closeModal();
              }}
            >
              <label className="form-field">
                图层名称
                <input
                  aria-label={labelText("图层名称")}
                  value={modal.name}
                  onChange={(e) => setModal({ ...modal, name: e.target.value })}
                  required
                />
              </label>
              <div className="modal-footer">
                <button type="button" onClick={closeModal}>
                  {labelText("取消")}
                </button>
                <button className="primary">{labelText("保存名称")}</button>
              </div>
            </form>
          )}
          {modal.type === "guide" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                commit(
                  {
                    ...doc,
                    guides: [
                      ...doc.guides,
                      { axis: modal.axis, position: Number(modal.position) },
                    ],
                  },
                  "添加参考线",
                );
                closeModal();
              }}
            >
              <label className="form-field">
                方向
                <select
                  value={modal.axis}
                  onChange={(e) => setModal({ ...modal, axis: e.target.value })}
                >
                  <option value="x">{labelText("垂直")}</option>
                  <option value="y">{labelText("水平")}</option>
                </select>
              </label>
              <label className="form-field">
                位置 (px)
                <input
                  type="number"
                  required
                  value={modal.position}
                  onChange={(e) =>
                    setModal({ ...modal, position: e.target.value })
                  }
                />
              </label>
              <p className="dialog-description">{labelText("也可以直接从标尺拖出参考线。")}</p>
              <div className="modal-footer">
                <button type="button" onClick={closeModal}>
                  {labelText("取消")}
                </button>
                <button className="primary">{labelText("添加")}</button>
              </div>
            </form>
          )}
          {modal.type === "close" && (
            <>
              <p className="dialog-description">
                关闭“{modal.name}
                ”后，本地工作区将不再保留此文档。请先下载项目以便以后继续编辑。
              </p>
              <div className="modal-footer">
                <button onClick={closeModal}>{labelText("取消")}</button>
                <button
                  onClick={() => {
                    const target = docs.find((d) => d.id === modal.id);
                    downloadBlob(
                      new Blob(
                        [
                          JSON.stringify({
                            format: "compositor.web",
                            version: 1,
                            document: target,
                          }),
                        ],
                        { type: "application/json" },
                      ),
                      `${target.name}.compweb`,
                    );
                  }}
                >
                  下载项目
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    const remaining = docs.filter((d) => d.id !== modal.id);
                    if (!remaining.length) remaining.push(makeDocument({ name: english ? "Untitled" : "未命名", width: 1600, height: 1000, background: "transparent" }));
                    setDocs(remaining);
                    if (modal.id === activeId) {
                      setActiveId(remaining[0].id);
                      setSelected([]);
                      setSelection(null);
                    }
                    histories.current.delete(modal.id);
                    closeModal();
                  }}
                >
                  关闭文档
                </button>
              </div>
            </>
          )}
          {modal.type === "import" && (
            <>
              <p className="dialog-description">
                {modal.result.doc.name} · {modal.result.doc.width} ×{" "}
                {modal.result.doc.height} · {modal.result.doc.layers.length}{" "}
                个图层
              </p>
              <ul className="conversion-report">
                {modal.result.report.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
              <div className="modal-footer">
                <button
                  onClick={() => {
                    pendingFiles.current = [];
                    closeModal();
                  }}
                >
                  {labelText("取消")}
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    const result = pendingFiles.current.shift();
                    openDocument(result.doc);
                    if (pendingFiles.current.length)
                      setModal({
                        type: "import",
                        result: pendingFiles.current[0],
                      });
                  }}
                >
                  导入为新文档
                </button>
              </div>
            </>
          )}
          {modal.type === "commands" && (
            <>
              <div className="command-search">
                <Search size={18} />
                <input
                  aria-label={labelText("搜索命令")}
                  placeholder={labelText("搜索工具、图层、滤镜…")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const item = filteredCommands.find((c) => !c.disabled);
                      if (item) {
                        closeModal();
                        execute(item.action);
                      }
                    }
                  }}
                />
              </div>
              <div className="command-results">
                {filteredCommands.length ? (
                  filteredCommands.map((command, index) => (
                    <button
                      key={index}
                      disabled={command.disabled}
                      onClick={() => {
                        closeModal();
                        execute(command.action);
                      }}
                    >
                      <span>
                        <small>{command.section}</small>
                        {command.label}
                      </span>
                      <kbd>{command.shortcut}</kbd>
                    </button>
                  ))
                ) : (
                  <p className="panel-empty">{labelText("没有找到这个命令")}</p>
                )}
              </div>
            </>
          )}
          {modal.type === "shortcuts" && (
            <>
              <p className="dialog-description">
                熟悉的操作，让创作不被打断。Mac 使用 ⌘ 替代 Ctrl，Option 替代
                Alt。
              </p>
              <div className="shortcuts-grid">
                {[
                  ["撤销 / 重做", "Ctrl Z / Ctrl Shift Z"],
                  ["打开 / 保存项目", "Ctrl O / Ctrl S"],
                  ["导出图像", "Ctrl Shift E"],
                  ["复制 / 粘贴", "Ctrl C / Ctrl V"],
                  ["复制图层", "Ctrl J"],
                  ["编组 / 取消编组", "Ctrl G / Ctrl Shift G"],
                  ["合并图层", "Ctrl E"],
                  ["全选 / 取消选区", "Ctrl A / Ctrl D"],
                  ["适合画布 / 100%", "Ctrl 0 / Ctrl 1"],
                  ["查找命令", "Ctrl K / Ctrl F"],
                  ["平移画布", "空格 + 拖动"],
                  ["缩放画布", "Ctrl + 滚轮"],
                  ["调整画笔大小", "[ / ]"],
                  ["等比变换 / 直线移动", "Shift + 拖动"],
                  ["设置仿制源", "Alt + 点击"],
                  ["隐藏面板 / 专注模式", "Tab / F"],
                ].map(([name, key]) => (
                  <div key={name}>
                    <span>{labelText(name)}</span>
                    <kbd>{key}</kbd>
                  </div>
                ))}
              </div>
              <div className="tool-shortcuts">
                {TOOLS.map(([id, Icon, name, key]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setTool(id);
                      closeModal();
                    }}
                  >
                    <Icon size={15} />
                    {labelText(name)}
                    <kbd>{key}</kbd>
                  </button>
                ))}
              </div>
            </>
          )}
          {modal.type === "about" && (
            <div className="about-content">
              <div className="about-brand">
                <span className="brand-mark">
                  <Layers size={30} />
                </span>
                <div>
                  <h3>
                    Compositor <em>Web</em>
                  </h3>
                  <span>{labelText("为浏览器重新实现的创作工作台")}</span>
                </div>
              </div>
              <p>
                基于 Robbie Tilton 的开源 Compositor 功能与交互设计，使用
                React、Next.js 和 JavaScript
                独立实现。图片只在当前浏览器处理，项目自动保存在本机；下载
                .compweb 可完整保留编辑状态。
              </p>
              <div className="about-features">
                <div>
                  <Check size={16} />
                  <span>{labelText("图层、分组、混合、蒙版与变换")}</span>
                </div>
                <div>
                  <Check size={16} />
                  <span>{labelText("选区、绘画、仿制、文字和形状")}</span>
                </div>
                <div>
                  <Check size={16} />
                  <span>{labelText("非破坏调色、滤镜与图像导出")}</span>
                </div>
              </div>
              <p className="about-limits">
                浏览器版不含 AI 主体识别、内容感知修复、Camera RAW、CMYK / ICC
                打样、自由透视变形和原生系统集成。PSD / 原版 .comp
                为有限导入，导入前会显示转换说明。画布最多 8192 px / 3200
                万像素，200 个图层。历史记录默认 60 步，可在历史面板调整。
              </p>
              <div className="about-links">
                <a
                  href="https://github.com/robbietilton/compositor"
                  target="_blank"
                  rel="noreferrer"
                >
                  原开源项目 ↗
                </a>
                <span>{labelText("MIT License · 非官方浏览器实现")}</span>
              </div>
            </div>
          )}
          {modal.type === "history" && (
            <div className="history-list">
              <p className="dialog-description">
                每个文档最多保留 {historyLimit} 步操作（撤销与重做合计）。选区和视图状态不计入历史。
              </p>
              <NumberField
                label="历史记录上限"
                value={historyLimit}
                min={1}
                max={MAX_HISTORY_LIMIT}
                suffix="步"
                onChange={changeHistoryLimit}
              />
              <p className="dialog-description">
                默认 60 步，可设为 1–{MAX_HISTORY_LIMIT} 步，自动记住设置。缩小上限会立即裁剪所有文档，优先保留最近的撤销记录。历史越多，内存占用越高。
              </p>
              <div className="toggle-row">
                <button disabled={!history.past.length} onClick={() => undo()}>
                  <Undo2 size={14} />
                  撤销
                </button>
                <button
                  disabled={!history.future.length}
                  onClick={() => undo(true)}
                >
                  <Redo2 size={14} />
                  重做
                </button>
              </div>
              <div className="history-current">
                <Check size={14} />
                当前位置
              </div>
              {[...history.past].reverse().map((item, index) => (
                <div key={index}>
                  <History size={13} />
                  {item.label}
                  <small>{history.past.length - index}</small>
                </div>
              ))}
              {!history.past.length && (
                <p className="panel-empty">{labelText("开始编辑后，操作会显示在这里。")}</p>
              )}
            </div>
          )}
        </Modal>
      )}
    </main>
  );
}
