"use client";

import { createClientId } from '@/utils/browserCapabilities.mjs';

import { useEditorText } from "./messages";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical,
  Maximize2, PanelLeft, PanelRight, RotateCcw, Save, Trash2, X,
} from "lucide-react";
import {
  defaultPanelLayout, fitPanelRect, movePanels, normalizePanelLayout,
} from "../lib/panel-layout";
import styles from "./WorkspacePanels.module.css";

const STORAGE_KEY = "novelai-image-processing-panel-layouts-v1";

/** 管理面板布局和命名预设，并在浏览器中保存。
 * @param {(message: string) => void} notify 编辑器通知回调。
 * @returns {object} 布局、预设以及更新、重置、保存、应用、删除方法。
 */
export function usePanelLayout(notify) {
  const text = useEditorText();
  const [layout, setLayout] = useState(defaultPanelLayout);
  const [presets, setPresets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved) {
        setLayout(normalizePanelLayout(saved.layout));
        setPresets(Array.isArray(saved.presets) ? saved.presets
          .filter((item) => typeof item.id === "string" && typeof item.name === "string")
          .map((item) => ({ id: item.id, name: item.name.slice(0, 60), layout: normalizePanelLayout(item.layout) })) : []);
      }
    } catch {
      notify?.(text("无法读取面板布局，已使用默认布局。"));
    }
    setLoaded(true);
  }, [notify, text]);
  useEffect(() => {
    if (!loaded) return;
    // 拖动只在松开时提交，立即保存可避免用户随即刷新时丢失最后一次变更。
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, layout, presets }));
    } catch {
      notify?.(text("布局已更新，但浏览器无法保存此设置。"));
    }
  }, [layout, presets, loaded, notify, text]);

  const selectPanel = useCallback((id) => {
    setLayout((current) => ({ ...current, front: current.groups.find((group) => group.tabs.includes(id)).id, groups: current.groups.map((group) =>
      group.tabs.includes(id) ? { ...group, active: id } : group) }));
  }, []);

  return {
    layout, setLayout, presets, selectPanel,
    updatePanel(id, changes) {
      setLayout((current) => ({ ...current, front: changes.hidden === false ? current.groups.find((group) => group.tabs.includes(id)).id : current.front, panels: {
        ...current.panels, [id]: { ...current.panels[id], ...changes },
      }, groups: current.groups.map((group) => group.tabs.includes(id) && changes.hidden === false
        ? { ...group, active: id, collapsed: false } : group) }));
    },
    resetLayout() {
      setLayout(defaultPanelLayout());
      notify?.(text("已恢复默认面板布局。"));
    },
    savePreset(name) {
      const title = name.trim().slice(0, 60);
      if (!title) return false;
      setPresets((items) => {
        const existing = items.find((item) => item.name === title);
        const next = { id: existing?.id || createClientId(), name: title, layout: normalizePanelLayout(layout) };
        return existing ? items.map((item) => item.id === existing.id ? next : item) : [...items, next];
      });
      notify?.(`布局「${title}」已保存；同名预设会更新。`);
      return true;
    },
    applyPreset(id) {
      const preset = presets.find((item) => item.id === id);
      if (preset) {
        setLayout(normalizePanelLayout(preset.layout));
        notify?.(`已应用布局「${preset.name}」。`);
      }
    },
    deletePreset(id) {
      setPresets((items) => items.filter((item) => item.id !== id));
    },
  };
}

/** 在画布两侧停靠标签组，拖单个标签可拆分，拖标题可整体移动。
 * @param {object} props 面板列表、布局、更新回调、显示开关和画布内容。
 * @returns {JSX.Element} 含画布、停靠栏和应用内浮窗的工作区。
 */
export default function WorkspacePanels({ panels, layout, onChange, children, visible = true, active = true }) {
  const text = useEditorText();
  const host = useRef(null);
  const dockNodes = useRef({});
  const panelNodes = useRef({});
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const drag = useRef(null);
  const previewRef = useRef(null);
  const [interaction, setInteraction] = useState(null);
  const [preview, setPreview] = useState(null);
  const [bounds, setBounds] = useState({ width: 1200, height: 700 });
  const front = layout.front;
  const setFront = (id) => onChange((current) => current.front === id ? current : { ...current, front: id });

  useEffect(() => {
    const node = host.current;
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      setBounds({ width: rect.width, height: rect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) {
      drag.current = null;
      previewRef.current = null;
      setInteraction(null);
      setPreview(null);
      return;
    }
    if (!interaction) return;
    const cancel = () => {
      drag.current = null;
      previewRef.current = null;
      setInteraction(null);
      setPreview(null);
    };
    const move = (event) => {
      const start = drag.current;
      if (!start) return;
      event.preventDefault();
      const area = host.current.getBoundingClientRect();
      const dx = event.clientX - start.clientX, dy = event.clientY - start.clientY;
      let next;
      if (start.type === "move") {
        if (!start.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        start.moved = true;
        const x = event.clientX - area.left, y = event.clientY - area.top;
        const candidates = start.layout.groups.filter((group) =>
          group.tabs.some((id) => !start.layout.panels[id].hidden && !start.panelIds.includes(id)))
          .sort((a, b) => Number(b.id === front) - Number(a.id === front) || Number(b.side === "floating") - Number(a.side === "floating"));
        const target = candidates.find((group) => {
          const rect = panelNodes.current[group.id]?.getBoundingClientRect();
          return rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        });
        const targetRect = target && panelNodes.current[target.id].getBoundingClientRect();
        const tabRect = target && panelNodes.current[target.id].querySelector('[role="tablist"]')?.getBoundingClientRect();
        const overTabs = tabRect && event.clientY >= tabRect.top && event.clientY <= tabRect.bottom;
        const edge = targetRect ? Math.min(18, targetRect.height * .2) : 0;
        // 中间区域合组，上下边缘拆成独立面板；最外侧留出左右停靠入口。
        const merge = target && (overTabs || (x > 24 && x < area.width - 24 && (target.side === "floating" || (event.clientY > targetRect.top + edge && event.clientY < targetRect.bottom - edge))));
        const leftEdge = dockNodes.current.left?.getBoundingClientRect().right - area.left || 52;
        const rightEdge = area.right - dockNodes.current.right?.getBoundingClientRect().left || 52;
        const side = merge ? null : x < Math.min(leftEdge, area.width / 2) ? "left"
          : x > area.width - Math.min(rightEdge, area.width / 2) ? "right" : null;
        const peers = start.layout.groups.filter((group) => group.side === side && group.tabs.some((id) => !start.layout.panels[id].hidden && !start.panelIds.includes(id)));
        const insert = peers.findIndex((group) => {
          const rect = panelNodes.current[group.id]?.getBoundingClientRect();
          return rect && event.clientY < rect.top + rect.height / 2;
        });
        const index = insert < 0 ? peers.length : insert;
        let line = y;
        if (side) {
          const before = panelNodes.current[peers[index]?.id]?.getBoundingClientRect();
          const last = panelNodes.current[peers.at(-1)?.id]?.getBoundingClientRect();
          line = before ? before.top - area.top : last ? last.bottom - area.top : 0;
        }
        let tabIndex;
        if (merge) {
          const tabs = target.tabs.filter((id) => !start.panelIds.includes(id));
          tabIndex = tabs.findIndex((id) => {
            const tab = panelNodes.current[target.id].querySelector(`[data-panel-tab="${id}"]`);
            const rect = tab?.getBoundingClientRect();
            return rect && event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2;
          });
          if (tabIndex < 0) tabIndex = tabs.length;
        }
        next = {
          type: start.type, id: start.id, side, index, line,
          groupId: merge ? target.id : null, tabIndex,
          targetRect: merge ? { x: targetRect.left - area.left, y: targetRect.top - area.top, width: targetRect.width, height: targetRect.height } : null,
          rect: fitPanelRect({ ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }, area),
        };
      } else if (start.type === "floatSize") {
        next = { type: start.type, id: start.id, rect: fitPanelRect({
          ...start.rect,
          width: Math.min(area.width - start.rect.x, start.rect.width + (start.axis === "y" ? 0 : dx)),
          height: Math.min(area.height - start.rect.y, start.rect.height + (start.axis === "x" ? 0 : dy)),
        }, area) };
      } else if (start.type === "dockWidth") {
        const other = start.side === "left" ? "right" : "left";
        const occupied = dockNodes.current[other]?.getBoundingClientRect().width || 0;
        const max = Math.max(220, Math.min(640, area.width - occupied - 180));
        next = { type: start.type, side: start.side, width: Math.max(220, Math.min(max, start.width + (start.side === "left" ? dx : -dx))) };
      } else {
        const delta = Math.max(105 - start.heights[start.id], Math.min(dy, start.heights[start.nextId] - 105));
        next = { type: start.type, heights: {
          ...start.heights,
          [start.id]: start.heights[start.id] + delta,
          [start.nextId]: start.heights[start.nextId] - delta,
        } };
      }
      previewRef.current = next;
      setPreview(next);
    };
    const finish = () => {
      const value = previewRef.current, start = drag.current;
      if (value && start) {
        onChange((current) => {
          if (value.type === "dockWidth") return { ...current, dockWidths: { ...current.dockWidths, [value.side]: value.width } };
          if (value.type === "dockHeight") return { ...current, groups: current.groups.map((group) => ({ ...group, height: value.heights[group.id] ?? group.height })) };
          if (value.type === "floatSize") return { ...current, groups: current.groups.map((group) => group.id === value.id ? { ...group, x: value.rect.x, y: value.rect.y, width: value.rect.width, floatHeight: value.rect.height } : group) };
          return movePanels(current, start.panelIds, value.groupId
            ? { groupId: value.groupId, index: value.tabIndex }
            : { side: value.side || "floating", index: value.index, rect: value.side ? undefined : value.rect });
        });
      }
      cancel();
    };
    const key = (event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [active, interaction, onChange, front]);

  /** 从拖动栏或尺寸手柄开始操作，共用窗口事件以允许指针离开原面板。
   * @param {PointerEvent} event 手柄的指针事件。
   * @param {object} operation 本次移动或尺寸调整的数据。
   * @returns {void} 开始预览，松开指针后才保存布局。
   */
  function begin(event, operation) {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { ...operation, clientX: event.clientX, clientY: event.clientY, layout: layoutRef.current };
    previewRef.current = null;
    setPreview(null);
    setInteraction({ type: operation.type, id: operation.id });
    if (operation.id) setFront(operation.id);
  }

  function renderPanel(group, nextId) {
    const id = group.id, side = group.side, floating = side === "floating";
    const tabs = group.tabs.filter((key) => !layout.panels[key].hidden);
    const active = tabs.includes(group.active) ? group.active : tabs[0];
    const title = tabs.map((key) => panels.find((item) => item.id === key).title).join(" / ");
    const activeTitle = panels.find((item) => item.id === active).title;
    let rect = fitPanelRect({ x: group.x, y: group.y, width: group.width, height: group.floatHeight }, bounds);
    if (preview?.type === "floatSize" && preview.id === id) rect = preview.rect;
    const size = floating
      ? { left: rect.x, top: rect.y, width: rect.width, height: group.collapsed ? 30 : rect.height, zIndex: front === id ? 42 : 40 }
      : { flex: group.collapsed ? "0 0 30px" : `${preview?.heights?.[id] ?? group.height} 1 0px` };
    return <section key={id} ref={(node) => { panelNodes.current[id] = node; }}
      className={`${styles.frame} ${floating ? styles.floating : ""} ${group.collapsed ? styles.collapsed : ""} ${preview?.type === "move" && preview.id === id ? styles.dragOrigin : ""}`}
      style={size} aria-label={`${title} ${text("面板")}${tabs.length > 1 ? ` ${text("组")}` : ""}`} data-panel-group={id} data-panel-side={side}
      onPointerDown={() => { if (floating) setFront(id); }}>
      <header className={styles.panelHeader}>
        <button type="button" title={group.collapsed ? text("展开面板组") : text("折叠面板组")} aria-label={`${group.collapsed ? text("展开") : text("折叠")}${title}`} aria-expanded={!group.collapsed}
          onClick={() => onChange((current) => ({ ...current, groups: current.groups.map((item) => item.id === id ? { ...item, collapsed: !item.collapsed } : item) }))}>
          {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <button type="button" className={styles.dragHandle} title={text("拖动整组；中间合组，上下边缘分开停靠；Esc 取消")} aria-label={`${text("拖动")} ${title}`}
          onPointerDown={(event) => {
            const area = host.current.getBoundingClientRect(), measured = panelNodes.current[id].getBoundingClientRect();
            begin(event, { type: "move", id, panelIds: group.tabs, rect: { x: measured.left - area.left, y: measured.top - area.top, width: measured.width, height: group.collapsed ? group.floatHeight : measured.height } });
          }}><GripVertical size={12} /><span>{title}</span></button>
        <button type="button" title={text("整组停靠左侧")} aria-label={`${text("停靠左侧")}: ${title}`} onClick={() => onChange((current) => movePanels(current, group.tabs, { side: "left" }))}><PanelLeft size={12} /></button>
        <button type="button" title={text("整组停靠右侧")} aria-label={`${text("停靠右侧")}: ${title}`} onClick={() => onChange((current) => movePanels(current, group.tabs, { side: "right" }))}><PanelRight size={12} /></button>
        <button type="button" title={text("将当前标签拆为独立浮窗")} aria-label={`${text("拆为独立浮窗")}: ${activeTitle}`} disabled={floating && group.tabs.length === 1}
          onClick={() => onChange((current) => movePanels(current, [active], { side: "floating", rect: { ...rect, x: Math.min(bounds.width - rect.width, rect.x + 35), y: rect.y + 35 } }))}><Maximize2 size={11} /></button>
        <button type="button" title={text("隐藏当前标签（从面板菜单恢复）")} aria-label={`${text("隐藏")}: ${activeTitle}`}
          onClick={() => onChange((current) => ({ ...current, panels: { ...current.panels, [active]: { ...current.panels[active], hidden: true } } }))}><X size={12} /></button>
      </header>
      {!group.collapsed && <>
        <div className={styles.tabs} role="tablist" aria-label={`${title} ${text("面板标签")}`}>
          {tabs.map((key) => {
            const label = panels.find((item) => item.id === key).title;
            return <button key={key} type="button" role="tab" id={`panel-tab-${key}`} aria-controls={`panel-content-${key}`} aria-selected={key === active} tabIndex={key === active ? 0 : -1}
              data-panel-tab={key} title={text("拖动标签可单独拆出或并入其他面板")} onPointerDown={(event) => {
                if (event.button !== 0) return;
                const area = host.current.getBoundingClientRect(), measured = panelNodes.current[id].getBoundingClientRect();
                begin(event, { type: "move", id, panelIds: [key], rect: { x: measured.left - area.left, y: measured.top - area.top, width: measured.width, height: measured.height } });
                onChange((current) => ({ ...current, groups: current.groups.map((item) => item.id === id ? { ...item, active: key } : item) }));
                event.currentTarget.focus();
              }} onClick={(event) => {
                if (event.detail === 0) onChange((current) => ({ ...current, groups: current.groups.map((item) => item.id === id ? { ...item, active: key } : item) }));
              }} onKeyDown={(event) => {
                if (["Tab", " ", "Enter"].includes(event.key)) {
                  event.stopPropagation();
                  if (event.key === "Tab") return;
                  event.preventDefault();
                  onChange((current) => ({ ...current, groups: current.groups.map((item) => item.id === id ? { ...item, active: key } : item) }));
                  return;
                }
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(key) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
                onChange((current) => ({ ...current, groups: current.groups.map((item) => item.id === id ? { ...item, active: tabs[index] } : item) }));
                event.currentTarget.parentElement.querySelector(`[data-panel-tab="${tabs[index]}"]`).focus();
              }}>{label}</button>;
          })}
        </div>
        {group.tabs.map((key) => <div key={key} id={`panel-content-${key}`} role="tabpanel" aria-labelledby={`panel-tab-${key}`} hidden={key !== active} className={styles.body}>
          {panels.find((item) => item.id === key).content}
        </div>)}
      </>}
      {floating && !group.collapsed && <>
        <div role="separator" aria-orientation="vertical" aria-label={`${text("调整浮窗宽度")}: ${title}`} className={styles.floatWidthHandle} onPointerDown={(event) => begin(event, { type: "floatSize", axis: "x", id, rect })} />
        <div role="separator" aria-orientation="horizontal" aria-label={`${text("调整浮窗高度")}: ${title}`} className={styles.floatHeightHandle} onPointerDown={(event) => begin(event, { type: "floatSize", axis: "y", id, rect })} />
        <div role="separator" aria-label={`${text("调整浮窗尺寸")}: ${title}`} className={styles.cornerHandle} onPointerDown={(event) => begin(event, { type: "floatSize", id, rect })} />
      </>}
      {!floating && !group.collapsed && nextId && <div role="separator" aria-orientation="horizontal" aria-label={`${text("调整面板高度")}: ${title}`} className={styles.heightHandle}
        onPointerDown={(event) => {
          const heights = Object.fromEntries(layout.groups.filter((item) => item.side === side && !item.collapsed && item.tabs.some((key) => !layout.panels[key].hidden))
            .map((item) => [item.id, panelNodes.current[item.id].getBoundingClientRect().height]));
          begin(event, { type: "dockHeight", id, nextId, heights });
        }} />}
    </section>;
  }

  function renderDock(side) {
    const items = layout.groups.filter((group) => group.side === side && group.tabs.some((id) => !layout.panels[id].hidden));
    if (!visible || !items.length) return null;
    const width = preview?.type === "dockWidth" && preview.side === side ? preview.width : layout.dockWidths[side];
    return <aside ref={(node) => { dockNodes.current[side] = node; }} className={`${styles.dock} ${side === "left" ? styles.leftDock : styles.rightDock}`} style={{ width }} aria-label={`${side === "left" ? text("左") : text("右")} ${text("停靠面板")}`}>
      {items.map((item, index) => renderPanel(item, items.slice(index + 1).find((next) => !next.collapsed)?.id))}
      <div role="separator" aria-orientation="vertical" aria-label={`${text("调整面板宽度")}: ${side === "left" ? text("左") : text("右")}`} className={styles.widthHandle}
        onPointerDown={(event) => begin(event, { type: "dockWidth", side, width: dockNodes.current[side].getBoundingClientRect().width })} />
    </aside>;
  }

  return <div ref={host} className={`${styles.workspace} ${interaction ? styles.interacting : ""}`}>
    {renderDock("left")}
    <div className={styles.canvas}>{children}</div>
    {renderDock("right")}
    {visible && layout.groups.filter((group) => group.side === "floating" && group.tabs.some((id) => !layout.panels[id].hidden)).map((group) => renderPanel(group))}
    {preview?.type === "move" && <>
      <div className={styles.ghost} style={{ left: preview.rect.x, top: preview.rect.y, width: preview.rect.width, height: Math.min(preview.rect.height, bounds.height) }}>
        <GripVertical size={15} />{drag.current.panelIds.map((id) => panels.find((item) => item.id === id).title).join(" / ")}<small>{preview.groupId ? text("松开后合并为标签组") : preview.side ? text("松开后独立停靠") : text("松开后分离为浮窗")}</small>
      </div>
      <div className={`${styles.dropZone} ${styles.dropLeft} ${preview.side === "left" ? styles.dropActive : ""}`}><span>{text("停靠左侧")}</span></div>
      <div className={`${styles.dropZone} ${styles.dropRight} ${preview.side === "right" ? styles.dropActive : ""}`}><span>{text("停靠右侧")}</span></div>
      {preview.targetRect && <div className={styles.mergeZone} style={{ left: preview.targetRect.x, top: preview.targetRect.y, width: preview.targetRect.width, height: preview.targetRect.height }}>{text("合并为标签组")}</div>}
      {preview.side && <div className={styles.insertLine} style={{ top: Math.max(2, Math.min(bounds.height - 3, preview.line)), [preview.side]: 0, width: dockNodes.current[preview.side]?.getBoundingClientRect().width || layout.dockWidths[preview.side] }}>{text("独立停靠")}</div>}
    </>}
  </div>;
}
/** 在窗口菜单打开的管理面板中显示位置、可见性和命名布局预设。
 * @param {object} props usePanelLayout 返回值及面板名称列表。
 * @returns {JSX.Element} 面板管理界面。
 */
export function PanelLayoutMenu({ controller, panels }) {
  const text = useEditorText();
  const [name, setName] = useState("");
  const { layout, setLayout, updatePanel, resetLayout, presets, savePreset, applyPreset, deletePreset } = controller;
  return <div className={styles.manager}>
    <p className={styles.description}>{text("拖动标签可单独拆出，拖动标题栏移动整组。放到另一面板中间可合并为标签组，放到上下边缘可分开停靠；边缘可调整尺寸。布局会自动保存。")}</p>
    <div className={styles.panelList}>
      {panels.map(({ id, title }) => {
        const panel = layout.panels[id];
        const group = layout.groups.find((item) => item.tabs.includes(id));
        const peers = layout.groups.filter((item) => item.side === group.side && item.tabs.some((key) => !layout.panels[key].hidden));
        const index = peers.indexOf(group);
        return <div key={id} className={styles.managerRow}>
          <label><input type="checkbox" checked={!panel.hidden} onChange={(event) => updatePanel(id, { hidden: !event.target.checked })} />{title}</label>
          <select aria-label={`${title} ${text("位置")}`} value={group.side} onChange={(event) => setLayout((current) => movePanels(current, [id], { side: event.target.value }))}>
            <option value="left">{text("停靠左侧")}</option><option value="right">{text("停靠右侧")}</option><option value="floating">{text("独立浮窗")}</option>
          </select>
          <select aria-label={`${title} ${text("分组")}`} value={group.tabs.length > 1 ? group.id : ""} onChange={(event) => setLayout((current) => movePanels(current, [id], event.target.value ? { groupId: event.target.value } : { side: group.side, index: index + 1 }))}>
            <option value="">{text("独立面板")}</option>
            {layout.groups.filter((item) => item.id !== group.id || item.tabs.length > 1).map((item) => <option key={item.id} value={item.id}>{item.id === group.id ? text("同组：") : text("并入：")}{item.tabs.map((key) => panels.find((entry) => entry.id === key).title).join(" / ")}</option>)}
          </select>
          <label className={styles.collapseOption}><input type="checkbox" checked={group.collapsed} onChange={(event) => setLayout((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, collapsed: event.target.checked } : item) }))} />{text("折叠组")}</label>
          <button type="button" aria-label={`${text("整组上移")}: ${title}`} title={text("整组上移")} disabled={group.side === "floating" || index <= 0} onClick={() => setLayout((current) => movePanels(current, group.tabs, { side: group.side, index: index - 1 }))}><ArrowUp size={13} /></button>
          <button type="button" aria-label={`${text("整组下移")}: ${title}`} title={text("整组下移")} disabled={group.side === "floating" || index < 0 || index === peers.length - 1} onClick={() => setLayout((current) => movePanels(current, group.tabs, { side: group.side, index: index + 1 }))}><ArrowDown size={13} /></button>
        </div>;
      })}
    </div>
    <div className={styles.managerActions}>
      <button type="button" onClick={() => setLayout((current) => ({ ...current, panels: Object.fromEntries(Object.entries(current.panels).map(([id, panel]) => [id, { ...panel, hidden: false }])) }))}>{text("显示全部面板")}</button>
      <button type="button" onClick={resetLayout}><RotateCcw size={13} />{text("重置默认布局")}</button>
    </div>
    <h3>{text("布局预设")}</h3>
    <form className={styles.presetForm} onSubmit={(event) => { event.preventDefault(); if (savePreset(name)) setName(""); }}>
      <input aria-label={text("布局预设名称")} placeholder={text("例如：修图工作区")} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
      <button type="submit" disabled={!name.trim()}><Save size={13} />{text("保存当前布局")}</button>
    </form>
    <p className={styles.description}>{text("同名保存会更新该预设，重置默认布局不会删除预设。")}</p>
    <div className={styles.presetList}>
      {presets.map((preset) => <div key={preset.id}><span title={preset.name}>{preset.name}</span><button type="button" onClick={() => applyPreset(preset.id)}>{text("应用")}</button><button type="button" aria-label={`${text("删除布局预设")}: ${preset.name}`} onClick={() => deletePreset(preset.id)}><Trash2 size={13} /></button></div>)}
      {!presets.length && <p className={styles.description}>{text("还没有保存布局预设。")}</p>}
    </div>
  </div>;
}
