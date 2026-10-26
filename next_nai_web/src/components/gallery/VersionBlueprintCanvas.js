"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme } from '@mui/material';
import { Add, CenterFocusStrong, Close, EditOutlined, LayersOutlined, PanToolOutlined, Refresh, Remove, SelectAll, TextSnippetOutlined, UnfoldLess, UnfoldMore, VisibilityOffOutlined } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useI18n } from '@/i18n/I18nProvider';
import { createClientId } from '@/utils/browserCapabilities.mjs';
import { buildVersionBlueprint, getVersionPathCollapseIds } from './versionBlueprint.mjs';

const EMPTY_BLUEPRINT = { positions: {}, edge_notes: {}, hidden_node_ids: [], groups: [] };
const MIN_SCALE = 0.05;
const MAX_SCALE = 2.5;
const words = {
  'zh-CN': {
    canvas: '作品版本蓝图', pan: '平移', select: '多选 / 框选', zoomIn: '放大', zoomOut: '缩小', fit: '适应画布', arrange: '自动排布',
    group: '选中成组', groupHint: '将选中的版本放进命名组，只整理画布，不合并版本数据。', groupTitle: '组名称', newGroup: '版本组', editGroup: '重命名组', ungroup: '解散组',
    collapseGroup: '折叠组', expandGroup: '展开组', hide: '隐藏所选', collapsePath: '折叠路径', pathHint: '保留根节点与所选的中间或末端节点，折叠它们之间的祖先版本。',
    expandAll: '展开全部', hidden: '个隐藏', selected: '个已选', versions: '个版本', promptOnly: '纯提示词版本', noMessage: '未填写改动说明',
    hint: 'Shift 多选 · 滚轮缩放 · 右键操作',
    mobileHint: '双指缩放 · 多选模式可框选',
    empty: '此作品还没有版本。', allHidden: '节点已隐藏，版本历史仍然保留。', restore: '恢复全部节点',
    edge: '连线备注', edgeHint: '记录这一步为什么调整提示词、参数或图像。备注只属于这条版本连线。', note: '备注', save: '保存', cancel: '取消',
    expandPath: '展开折叠的版本', hiddenPath: '个已折叠', selectVersion: '选择版本', keyboard: '方向键移动视口；聚焦节点后按 Enter 选择。',
  },
  'en-US': {
    canvas: 'Work version blueprint', pan: 'Pan', select: 'Multi / box select', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit canvas', arrange: 'Auto arrange',
    group: 'Group selected', groupHint: 'Put selected versions in a named group. This only organizes the canvas; version data is not merged.', groupTitle: 'Group name', newGroup: 'Version group', editGroup: 'Rename group', ungroup: 'Ungroup',
    collapseGroup: 'Collapse group', expandGroup: 'Expand group', hide: 'Hide selected', collapsePath: 'Collapse path', pathHint: 'Keep roots and selected intermediate or final versions, and fold the ancestors between them.',
    expandAll: 'Expand all', hidden: 'hidden', selected: 'selected', versions: 'versions', promptOnly: 'Prompt-only version', noMessage: 'No change description',
    hint: 'Shift to select · Scroll to zoom · Right-click for actions',
    mobileHint: 'Pinch to zoom · Selection mode supports box selection',
    empty: 'This work has no versions yet.', allHidden: 'Nodes are hidden. The full version history is preserved.', restore: 'Restore all nodes',
    edge: 'Edge note', edgeHint: 'Record why prompts, parameters or images changed at this step. The note belongs to this version connection.', note: 'Note', save: 'Save', cancel: 'Cancel',
    expandPath: 'Expand folded versions', hiddenPath: 'folded', selectVersion: 'Select version', keyboard: 'Arrow keys pan the canvas. Focus a node and press Enter to select it.',
  },
};

/**
 * 用可拖动图片节点和连线呈现版本蓝图，布局编辑交给父组件持久化。
 * @param {object} props 版本、完整蓝图状态、保存回调、当前版本及选择回调。
 * @returns {React.ReactElement} 支持缩放、多选、分组和路径折叠的桌面与移动端画布。
 */
export default function VersionBlueprintCanvas({ versions, blueprint, onBlueprintChange, selectedId, activeVersionId, onSelect, onContinue, onApply, onEditMessage, disabled = false }) {
  const { locale } = useI18n();
  const w = words[locale] || words['en-US'];
  const theme = useTheme();
  const saved = blueprint || EMPTY_BLUEPRINT;
  const markerId = useId().replace(/:/g, '');
  const [viewport, setViewport] = useState({ x: 40, y: 40, scale: 0.8 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState('pan');
  const [selection, setSelection] = useState(selectedId ? [selectedId] : []);
  const [dragPositions, setDragPositions] = useState({});
  const [selectionRect, setSelectionRect] = useState(null);
  const [groupDraft, setGroupDraft] = useState(null);
  const [edgeDraft, setEdgeDraft] = useState(null);
  const [activeGesture, setActiveGesture] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const surfaceRef = useRef(null);
  const viewportRef = useRef(viewport);
  const selectionRef = useRef(selection);
  const gestureRef = useRef(null);
  const pointersRef = useRef(new Map());
  const dragPositionsRef = useRef({});
  const fittedWorkRef = useRef(null);
  const graph = useMemo(() => buildVersionBlueprint(versions, { ...saved, positions: { ...saved.positions, ...dragPositions } }), [versions, saved, dragPositions]);
  const nodesByKey = useMemo(() => new Map(graph.nodes.map((node) => [node.key, node])), [graph.nodes]);
  const versionsById = useMemo(() => new Map(versions.map((version) => [version.id, version])), [versions]);
  const workKey = versions[0]?.work_id || versions.find((version) => !version.parent_id)?.id || '';
  const hiddenCount = saved.hidden_node_ids.length;
  const collapsedCount = saved.groups.filter((group) => group.collapsed).length;
  const toolbarButtonSx = { minWidth: { xs: 32, sm: 0 }, px: { xs: 0.75, sm: 1 }, '& .MuiButton-startIcon': { ml: 0, mr: { xs: 0, sm: 0.75 } } };
  const toolbarLabelSx = { display: { xs: 'none', sm: 'inline' } };

  const changeViewport = useCallback((next) => {
    viewportRef.current = next;
    setViewport(next);
  }, []);

  const changeSelection = useCallback((next) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const bounds = graph.bounds;
    const scale = Math.max(MIN_SCALE, Math.min(1, (size.width - 72) / (bounds.right - bounds.left), (size.height - 72) / (bounds.bottom - bounds.top)));
    changeViewport({ scale, x: (size.width - (bounds.right + bounds.left) * scale) / 2, y: (size.height - (bounds.bottom + bounds.top) * scale) / 2 });
  }, [changeViewport, graph.bounds, size]);

  const zoom = useCallback((factor, point) => {
    const current = viewportRef.current;
    const rect = surfaceRef.current.getBoundingClientRect();
    const anchor = point || { x: rect.width / 2, y: rect.height / 2 };
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
    changeViewport({ scale, x: anchor.x - (anchor.x - current.x) * scale / current.scale, y: anchor.y - (anchor.y - current.y) * scale / current.scale });
  }, [changeViewport]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(surfaceRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (graph.nodes.length && size.width && fittedWorkRef.current !== workKey) {
      fittedWorkRef.current = workKey;
      fit();
    }
  }, [fit, graph.nodes.length, size.width, workKey]);

  useEffect(() => {
    const current = selectionRef.current.filter((id) => versionsById.has(id));
    if (selectedId && versionsById.has(selectedId) && !current.includes(selectedId)) changeSelection([selectedId]);
    else if (current.length !== selectionRef.current.length) changeSelection(current);
  }, [changeSelection, selectedId, versionsById]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const wheel = (event) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    // 原生非被动监听使滚轮缩放留在画布内，不把外层弹窗一起滚动。
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => surface.removeEventListener('wheel', wheel);
  }, [zoom]);

  const restoreNodes = (ids) => onBlueprintChange({ ...saved, hidden_node_ids: saved.hidden_node_ids.filter((id) => !ids.includes(id)) });

  const beginPointer = (event) => {
    if (event.target.closest('[data-blueprint-control]') || event.button > 1) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointersRef.current.set(event.pointerId, point);
    surfaceRef.current.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      gestureRef.current = { type: 'pinch', startView: viewportRef.current, center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.hypot(second.x - first.x, second.y - first.y) };
      dragPositionsRef.current = {}; setDragPositions({}); setSelectionRect(null); setActiveGesture('pan');
      return;
    }
    const nodeElement = event.target.closest('[data-blueprint-node]');
    const groupElement = event.target.closest('[data-blueprint-group]');
    const node = nodeElement ? nodesByKey.get(nodeElement.dataset.blueprintNode) : null;
    const group = groupElement ? graph.groups.find((item) => item.group.id === groupElement.dataset.blueprintGroup) : null;
    const members = node?.memberIds || group?.memberIds;
    if (members && event.button === 0) {
      nodeElement?.focus({ preventScroll: true });
      const multiple = event.shiftKey || mode === 'select';
      const current = selectionRef.current;
      const alreadySelected = members.every((id) => current.includes(id));
      const next = multiple ? (alreadySelected ? current.filter((id) => !members.includes(id)) : [...new Set([...current, ...members])]) : alreadySelected ? current : members;
      changeSelection(next);
      const selectId = node?.version?.id || members.at(-1);
      const notify = !multiple || !alreadySelected;
      gestureRef.current = multiple || disabled ? { type: 'tap', selectId, notify } : { type: 'drag', start: point, ids: next, members, positions: graph.positions, moved: false, selectId, notify };
      setActiveGesture(multiple || disabled ? '' : 'drag');
      return;
    }
    if ((event.shiftKey || mode === 'select') && event.button === 0) {
      const view = viewportRef.current;
      const start = { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
      gestureRef.current = { type: 'select', start, previous: event.shiftKey ? selectionRef.current : [] };
      setSelectionRect({ x: start.x, y: start.y, width: 0, height: 0 }); setActiveGesture('select');
    } else {
      gestureRef.current = { type: 'pan', start: point, startView: viewportRef.current, moved: false };
      setActiveGesture('pan');
    }
  };

  const movePointer = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, gesture.startView.scale * Math.hypot(second.x - first.x, second.y - first.y) / Math.max(1, gesture.distance)));
      changeViewport({ scale, x: center.x - (gesture.center.x - gesture.startView.x) * scale / gesture.startView.scale, y: center.y - (gesture.center.y - gesture.startView.y) * scale / gesture.startView.scale });
    } else if (gesture.type === 'pan') {
      const x = point.x - gesture.start.x;
      const y = point.y - gesture.start.y;
      gesture.moved ||= Math.hypot(x, y) > 4;
      changeViewport({ ...gesture.startView, x: gesture.startView.x + x, y: gesture.startView.y + y });
    } else if (gesture.type === 'drag') {
      const x = (point.x - gesture.start.x) / viewportRef.current.scale;
      const y = (point.y - gesture.start.y) / viewportRef.current.scale;
      gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4;
      if (!gesture.moved) return;
      const positions = Object.fromEntries(gesture.ids.map((id) => [id, { x: Math.round((gesture.positions[id].x + x) * 10) / 10, y: Math.round((gesture.positions[id].y + y) * 10) / 10 }]));
      dragPositionsRef.current = positions; setDragPositions(positions);
    } else if (gesture.type === 'select') {
      const view = viewportRef.current;
      const current = { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
      gesture.rect = { x: Math.min(gesture.start.x, current.x), y: Math.min(gesture.start.y, current.y), width: Math.abs(current.x - gesture.start.x), height: Math.abs(current.y - gesture.start.y) };
      setSelectionRect(gesture.rect);
    }
  };

  const endPointer = (event, cancelled = false) => {
    pointersRef.current.delete(event.pointerId);
    const gesture = gestureRef.current;
    if (surfaceRef.current.hasPointerCapture(event.pointerId)) surfaceRef.current.releasePointerCapture(event.pointerId);
    if (gesture?.type === 'pinch' && pointersRef.current.size) {
      gestureRef.current = { type: 'pan', start: [...pointersRef.current.values()][0], startView: viewportRef.current, moved: true };
      return;
    }
    if (!cancelled && gesture?.type === 'drag' && gesture.moved && !disabled) {
      // 只在拖动结束时持久化，移动过程留在本地预览。
      onBlueprintChange({ ...saved, positions: { ...saved.positions, ...dragPositionsRef.current } });
    } else if (!cancelled && (gesture?.type === 'tap' || (gesture?.type === 'drag' && !gesture.moved)) ) {
      // 拖动多选节点保持整组；单击已选节点则回到单节点及其父级对比。
      if (gesture.type === 'drag') changeSelection(gesture.members);
      onSelect(selectionRef.current.at(-1) || null, selectionRef.current);
    } else if (!cancelled && gesture?.type === 'select') {
      const rect = gesture.rect;
      const hits = rect ? graph.nodes.filter((node) => node.x + node.width >= rect.x && node.x <= rect.x + rect.width && node.y + node.height >= rect.y && node.y <= rect.y + rect.height).flatMap((node) => node.memberIds) : [];
      const next = [...new Set([...gesture.previous, ...hits])];
      changeSelection(next);
      onSelect(next.at(-1) || null, next);
    } else if (!cancelled && gesture?.type === 'pan' && !gesture.moved) { changeSelection([]); onSelect(null, []); }
    gestureRef.current = null; dragPositionsRef.current = {};
    setDragPositions({}); setSelectionRect(null); setActiveGesture('');
  };

  const groupSelected = () => setGroupDraft({ id: null, title: `${w.newGroup} ${saved.groups.length + 1}`, nodeIds: selection });

  const hideSelected = () => { onBlueprintChange({ ...saved, hidden_node_ids: [...new Set([...saved.hidden_node_ids, ...selection])] }); changeSelection([]); onSelect(null, []); };

  const collapseSelected = () => onBlueprintChange({ ...saved, hidden_node_ids: [...new Set([...saved.hidden_node_ids, ...getVersionPathCollapseIds(versions, selection)])] });

  const expandAll = () => { fittedWorkRef.current = null; onBlueprintChange({ ...saved, hidden_node_ids: [], groups: saved.groups.map((group) => ({ ...group, collapsed: false })) }); };

  const arrange = () => { fittedWorkRef.current = null; onBlueprintChange({ ...saved, positions: {} }); };

  const groupActions = (group) => <Stack direction="row" spacing={0.25} data-blueprint-control="true">
    <Tooltip title={w.editGroup}><IconButton size="small" aria-label={w.editGroup} disabled={disabled} onClick={() => setGroupDraft({ id: group.id, title: group.title, nodeIds: group.node_ids })}><EditOutlined sx={{ fontSize: 15 }} /></IconButton></Tooltip>
    <Tooltip title={group.collapsed ? w.expandGroup : w.collapseGroup}><IconButton size="small" aria-label={group.collapsed ? w.expandGroup : w.collapseGroup} disabled={disabled} onClick={() => onBlueprintChange({ ...saved, groups: saved.groups.map((item) => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item) })}>{group.collapsed ? <UnfoldMore sx={{ fontSize: 17 }} /> : <UnfoldLess sx={{ fontSize: 17 }} />}</IconButton></Tooltip>
    <Tooltip title={w.ungroup}><IconButton size="small" aria-label={w.ungroup} disabled={disabled} onClick={() => onBlueprintChange({ ...saved, groups: saved.groups.filter((item) => item.id !== group.id) })}><Close sx={{ fontSize: 16 }} /></IconButton></Tooltip>
  </Stack>;

  return <Stack spacing={1} sx={{ minWidth: 0, minHeight: 0, height: '100%' }}>
    <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap">
      <ToggleButtonGroup value={mode} exclusive size="small" onChange={(_, next) => { if (next) setMode(next); }} aria-label={w.canvas}>
        <Tooltip title={w.pan}><ToggleButton value="pan" aria-label={w.pan} sx={{ gap: 0.75 }}><PanToolOutlined sx={{ fontSize: 17 }} /><Box component="span" sx={toolbarLabelSx}>{w.pan}</Box></ToggleButton></Tooltip>
        <Tooltip title={w.select}><ToggleButton value="select" aria-label={w.select} sx={{ gap: 0.75 }}><SelectAll sx={{ fontSize: 18 }} /><Box component="span" sx={toolbarLabelSx}>{w.select}</Box></ToggleButton></Tooltip>
      </ToggleButtonGroup>
      <Tooltip title={w.zoomOut}><IconButton size="small" aria-label={w.zoomOut} onClick={() => zoom(1 / 1.25)}><Remove fontSize="small" /></IconButton></Tooltip>
      <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(viewport.scale * 100)}%</Typography>
      <Tooltip title={w.zoomIn}><IconButton size="small" aria-label={w.zoomIn} onClick={() => zoom(1.25)}><Add fontSize="small" /></IconButton></Tooltip>
      <Tooltip title={w.fit}><Button size="small" startIcon={<CenterFocusStrong />} sx={toolbarButtonSx} aria-label={w.fit} onClick={fit}><Box component="span" sx={toolbarLabelSx}>{w.fit}</Box></Button></Tooltip>
      <Tooltip title={w.arrange}><span><Button size="small" startIcon={<Refresh />} sx={toolbarButtonSx} aria-label={w.arrange} disabled={disabled || !versions.length} onClick={arrange}><Box component="span" sx={toolbarLabelSx}>{w.arrange}</Box></Button></span></Tooltip>
      <Box sx={{ flex: 1 }} />
      {selection.length > 0 && <Chip size="small" variant="outlined" label={`${selection.length} ${w.selected}`} />}
      <Tooltip title={w.groupHint}><span><Button size="small" startIcon={<LayersOutlined />} sx={toolbarButtonSx} aria-label={w.group} disabled={disabled || selection.length < 2} onClick={groupSelected}><Box component="span" sx={toolbarLabelSx}>{w.group}</Box></Button></span></Tooltip>
      <Tooltip title={w.pathHint}><span><Button size="small" startIcon={<UnfoldLess />} sx={toolbarButtonSx} aria-label={w.collapsePath} disabled={disabled || !selection.length} onClick={collapseSelected}><Box component="span" sx={toolbarLabelSx}>{w.collapsePath}</Box></Button></span></Tooltip>
      <Tooltip title={w.hide}><span><Button size="small" startIcon={<VisibilityOffOutlined />} sx={toolbarButtonSx} aria-label={w.hide} disabled={disabled || !selection.length} onClick={hideSelected}><Box component="span" sx={toolbarLabelSx}>{w.hide}</Box></Button></span></Tooltip>
      <Tooltip title={w.expandAll}><span><Button size="small" startIcon={<UnfoldMore />} sx={toolbarButtonSx} aria-label={w.expandAll} disabled={disabled || (!hiddenCount && !collapsedCount)} onClick={expandAll}><Box component="span" sx={toolbarLabelSx}>{w.expandAll}{hiddenCount ? ` (${hiddenCount})` : ''}</Box></Button></span></Tooltip>
    </Stack>
    <Box ref={surfaceRef} role="region" tabIndex={0} aria-label={w.canvas} aria-describedby={`${markerId}-help`}
      onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={(event) => endPointer(event)} onPointerCancel={(event) => endPointer(event, true)}
      onContextMenu={(event) => {
        event.preventDefault();
        const element = event.target.closest('[data-blueprint-node]');
        const node = element ? nodesByKey.get(element.dataset.blueprintNode) : null;
        if (node && !node.memberIds.every((id) => selectionRef.current.includes(id))) {
          changeSelection(node.memberIds); onSelect(node.memberIds.at(-1), node.memberIds);
        }
        setContextMenu({ x: event.clientX, y: event.clientY, version: node?.version });
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const directions = { ArrowLeft: [64, 0], ArrowRight: [-64, 0], ArrowUp: [0, 64], ArrowDown: [0, -64] };
        if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; changeViewport({ ...viewportRef.current, x: viewportRef.current.x + x, y: viewportRef.current.y + y }); }
        if (event.key === 'Escape') { changeSelection([]); onSelect(null, []); setMode('pan'); }
      }}
      sx={{ position: 'relative', overflow: 'hidden', flex: 1, minHeight: 300, border: 1, borderColor: 'divider', borderRadius: 2, touchAction: 'none', userSelect: 'none', bgcolor: 'background.default',
        backgroundImage: `radial-gradient(${alpha(theme.palette.text.secondary, 0.18)} 1px, transparent 1px)`, backgroundSize: `${24 * viewport.scale}px ${24 * viewport.scale}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        cursor: activeGesture === 'pan' ? 'grabbing' : mode === 'select' ? 'crosshair' : 'grab', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        '& .blueprint-edge:hover .blueprint-edge-line, & .blueprint-edge:focus-within .blueprint-edge-line': { stroke: theme.palette.primary.main, strokeWidth: 3 },
      }}>
      {!graph.nodes.length && <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ position: 'absolute', inset: 0, p: 3, textAlign: 'center' }}><LayersOutlined sx={{ fontSize: 36, color: 'text.disabled' }} /><Typography color="text.secondary">{versions.length ? w.allHidden : w.empty}</Typography>{versions.length > 0 && <Button data-blueprint-control="true" disabled={disabled} onClick={() => { fittedWorkRef.current = null; onBlueprintChange({ ...saved, hidden_node_ids: [] }); }}>{w.restore}</Button>}</Stack>}
      <Box sx={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0', transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
        {graph.groups.map((item) => <Box key={item.group.id} sx={{ position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height, border: '1px dashed', borderColor: 'primary.main', borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.045), pointerEvents: 'none' }}>
          <Stack direction="row" alignItems="center" spacing={0.75} data-blueprint-group={item.group.id} sx={{ height: 36, px: 1.25, pointerEvents: 'auto', cursor: disabled ? 'default' : 'move' }}>
            <LayersOutlined sx={{ fontSize: 16, color: 'primary.main' }} /><Typography variant="caption" noWrap sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{item.group.title}</Typography><Typography variant="caption" color="text.secondary">{item.memberIds.length}</Typography>{groupActions(item.group)}
          </Stack>
        </Box>)}
        <svg width={graph.bounds.right - graph.bounds.left + 600} height={graph.bounds.bottom - graph.bounds.top + 600}
          viewBox={`${graph.bounds.left - 300} ${graph.bounds.top - 300} ${graph.bounds.right - graph.bounds.left + 600} ${graph.bounds.bottom - graph.bounds.top + 600}`}
          style={{ position: 'absolute', left: graph.bounds.left - 300, top: graph.bounds.top - 300, overflow: 'visible', pointerEvents: 'none' }}>
          <defs><marker id={`${markerId}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={theme.palette.text.secondary} /></marker></defs>
          {graph.edges.map((edge) => {
            const from = nodesByKey.get(edge.from); const to = nodesByKey.get(edge.to);
            const x1 = from.x + from.width; const y1 = from.y + from.height / 2; const x2 = to.x; const y2 = to.y + to.height / 2;
            const bend = Math.max(60, Math.abs(x2 - x1) * 0.45);
            const path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
            const label = `v${versionsById.get(edge.parentId)?.number ?? '?'} → v${versionsById.get(edge.id).number}: ${edge.note || w.edge}`;
            return <g key={edge.id} className="blueprint-edge"><title>{label}</title><path className="blueprint-edge-line" d={path} fill="none" stroke={alpha(theme.palette.text.secondary, 0.65)} strokeWidth="2" strokeDasharray={edge.hiddenIds.length ? '6 5' : undefined} markerEnd={`url(#${markerId}-arrow)`} />
              <path d={path} fill="none" stroke="transparent" strokeWidth="20" tabIndex={disabled ? -1 : 0} role="button" aria-label={label} data-blueprint-control="true" style={{ pointerEvents: 'stroke', cursor: disabled ? 'default' : 'pointer', outline: 'none' }}
                onClick={() => { if (!disabled) setEdgeDraft({ id: edge.id, label, text: edge.note }); }} onKeyDown={(event) => { if (!disabled && ['Enter', ' '].includes(event.key)) { event.preventDefault(); setEdgeDraft({ id: edge.id, label, text: edge.note }); } }} />
            </g>;
          })}
        </svg>
        {graph.edges.filter((edge) => edge.note || edge.hiddenIds.length).map((edge) => {
          const from = nodesByKey.get(edge.from); const to = nodesByKey.get(edge.to);
          return <Stack key={edge.id} spacing={0.5} data-blueprint-control="true" sx={{ position: 'absolute', left: (from.x + from.width + to.x) / 2, top: (from.y + from.height / 2 + to.y + to.height / 2) / 2, transform: 'translate(-50%, -50%)', zIndex: 2, maxWidth: 180, alignItems: 'center' }}>
            {edge.note && <Tooltip title={edge.note}><Button size="small" disabled={disabled} onClick={() => setEdgeDraft({ id: edge.id, label: `v${versionsById.get(edge.parentId)?.number ?? '?'} → v${versionsById.get(edge.id).number}`, text: edge.note })} sx={{ minWidth: 0, maxWidth: 180, bgcolor: 'background.paper', border: 1, borderColor: 'divider', px: 1, py: 0.25, boxShadow: 1 }}><Typography variant="caption" noWrap>{edge.note.replace(/\s+/g, ' ')}</Typography></Button></Tooltip>}
            {edge.hiddenIds.length > 0 && <Tooltip title={w.expandPath}><Button size="small" variant="contained" disabled={disabled} onClick={() => restoreNodes(edge.hiddenIds)} sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 11 }}>+{edge.hiddenIds.length} {w.hiddenPath}</Button></Tooltip>}
          </Stack>;
        })}
        {graph.nodes.map((node) => {
          const selected = node.memberIds.some((id) => selection.includes(id));
          const active = node.memberIds.includes(activeVersionId);
          const images = node.type === 'version' ? node.version.images || [] : node.memberIds.flatMap((id) => versionsById.get(id).images || []).slice(0, 3);
          const title = node.type === 'version' ? `v${node.version.number}` : node.group.title;
          return <Box key={node.key} sx={{ position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height, zIndex: selected || active ? 3 : 1 }}>
            <Box role="button" tabIndex={0} data-blueprint-node={node.key} data-active-version={active || undefined} aria-label={`${w.selectVersion} ${title}`} aria-pressed={selected}
              onKeyDown={(event) => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); const multi = event.shiftKey || mode === 'select'; const already = node.memberIds.every((id) => selectionRef.current.includes(id)); changeSelection(multi ? already ? selectionRef.current.filter((id) => !node.memberIds.includes(id)) : [...new Set([...selectionRef.current, ...node.memberIds])] : node.memberIds); onSelect(selectionRef.current.at(-1) || null, selectionRef.current); } }}
              sx={{ width: '100%', height: '100%', overflow: 'hidden', border: selected || active ? '2px solid' : '1px solid', borderColor: active ? 'success.main' : selected ? 'primary.main' : 'divider', borderRadius: 2, bgcolor: 'background.paper', boxShadow: selected ? `0 0 0 3px ${alpha(theme.palette.primary.main, 0.13)}` : 1, cursor: disabled ? 'pointer' : activeGesture === 'drag' ? 'grabbing' : mode === 'select' ? 'pointer' : 'grab', '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 3 } }}>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ height: 34, px: 1, borderBottom: 1, borderColor: 'divider' }}>
                {node.type === 'group' && <LayersOutlined sx={{ fontSize: 15, color: 'primary.main' }} />}<Typography variant="caption" noWrap sx={{ fontWeight: 700, flex: 1 }}>{title}</Typography>
                {active && <Typography variant="caption" color="success.main" sx={{ fontWeight: 700 }}>{locale === 'zh-CN' ? '当前' : 'Active'}</Typography>}{node.type === 'group' ? groupActions(node.group) : <Typography variant="caption" color="text.secondary">{images.length ? `${images.length} IMG` : 'TXT'}</Typography>}
              </Stack>
              {images.length ? <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${node.type === 'group' ? images.length : 1}, minmax(0, 1fr))`, height: node.imageHeight ?? 124, gap: 0.5, bgcolor: 'action.hover' }}>{(node.type === 'group' ? images : images.slice(0, 1)).map((image, index) => <Box key={`${image.id}-${index}`} component="img" src={image.thumbnail_url || image.url} alt="" draggable={false} onDragStart={(event) => event.preventDefault()} sx={{ width: '100%', height: node.imageHeight ?? 124, objectFit: 'contain', pointerEvents: 'none' }} />)}</Box>
                : <Stack spacing={0.5} alignItems="center" justifyContent="center" sx={{ height: node.imageHeight ?? 124, bgcolor: 'action.hover', px: 1.5 }}><TextSnippetOutlined sx={{ color: 'text.disabled', fontSize: 30 }} /><Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>{w.promptOnly}</Typography></Stack>}
              <Typography variant="caption" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.35, px: 1, py: 0.75, overflowWrap: 'anywhere' }}>{node.type === 'group' ? `${node.memberIds.length} ${w.versions}` : node.version.message || w.noMessage}</Typography>
            </Box>
            {node.hiddenAncestorIds.length > 0 && <Button size="small" variant="contained" data-blueprint-control="true" disabled={disabled} aria-label={w.expandPath} onClick={() => restoreNodes(node.hiddenAncestorIds)} sx={{ position: 'absolute', left: -12, top: -14, minWidth: 0, px: 1, fontSize: 11 }}>+{node.hiddenAncestorIds.length}</Button>}
          </Box>;
        })}
        {selectionRect && <Box sx={{ position: 'absolute', left: selectionRect.x, top: selectionRect.y, width: selectionRect.width, height: selectionRect.height, border: '1px solid', borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.12), pointerEvents: 'none', zIndex: 5 }} />}
      </Box>
      <Typography variant="caption" sx={{ position: 'absolute', right: 10, bottom: 8, px: 0.75, borderRadius: 1, bgcolor: alpha(theme.palette.background.paper, 0.85), color: 'text.secondary', pointerEvents: 'none' }}>{versions.length} {w.versions}{hiddenCount ? ` · ${hiddenCount} ${w.hidden}` : ''}</Typography>
    </Box>
    <Typography id={`${markerId}-help`} variant="caption" color="text.secondary"><Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{w.mobileHint}</Box><Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{w.hint}</Box></Typography>

    <Menu open={Boolean(contextMenu)} onClose={() => setContextMenu(null)} anchorReference="anchorPosition"
      anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined} onClick={() => setContextMenu(null)}>
      {contextMenu?.version && <MenuItem disabled={disabled} onClick={() => onContinue(contextMenu.version)}>{locale === 'zh-CN' ? '从此节点继续' : 'Continue from this node'}</MenuItem>}
      {contextMenu?.version && <MenuItem disabled={disabled} onClick={() => onApply(contextMenu.version)}>{locale === 'zh-CN' ? '应用所有参数' : 'Apply all parameters'}</MenuItem>}
      {contextMenu?.version && <MenuItem disabled={disabled} onClick={() => onEditMessage(contextMenu.version)}>{locale === 'zh-CN' ? '编辑改动说明' : 'Edit change description'}</MenuItem>}
      <MenuItem disabled={disabled || selection.length < 2} onClick={groupSelected}>{w.group}</MenuItem>
      <MenuItem disabled={disabled || !selection.length} onClick={hideSelected}>{w.hide}</MenuItem>
      <MenuItem disabled={disabled || !selection.length} onClick={collapseSelected}>{w.collapsePath}</MenuItem>
      <MenuItem onClick={fit}>{w.fit}</MenuItem>
      <MenuItem disabled={disabled || !versions.length} onClick={arrange}>{w.arrange}</MenuItem>
      <MenuItem disabled={disabled || (!hiddenCount && !collapsedCount)} onClick={expandAll}>{w.expandAll}</MenuItem>
    </Menu>

    <Dialog open={Boolean(groupDraft)} onClose={() => setGroupDraft(null)} maxWidth="xs" fullWidth><DialogTitle>{groupDraft?.id ? w.editGroup : w.group}</DialogTitle><DialogContent sx={{ pt: '8px !important' }}><TextField autoFocus fullWidth size="small" label={w.groupTitle} value={groupDraft?.title || ''} inputProps={{ maxLength: 80 }} onChange={(event) => setGroupDraft({ ...groupDraft, title: event.target.value })} /><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{w.groupHint}</Typography></DialogContent><DialogActions><Button onClick={() => setGroupDraft(null)}>{w.cancel}</Button><Button variant="contained" disabled={disabled || !groupDraft?.title.trim()} onClick={() => {
      const draft = groupDraft;
      const nextGroup = { id: draft.id || createClientId(), title: draft.title.trim(), node_ids: draft.nodeIds, collapsed: saved.groups.find((group) => group.id === draft.id)?.collapsed || false };
      // 新组接管所选节点，避免同一个节点同时落在多个组框中。
      const groups = saved.groups.filter((group) => group.id !== draft.id).map((group) => ({ ...group, node_ids: group.node_ids.filter((id) => !draft.nodeIds.includes(id)) })).filter((group) => group.node_ids.length);
      onBlueprintChange({ ...saved, groups: [...groups, nextGroup] }); setGroupDraft(null);
    }}>{w.save}</Button></DialogActions></Dialog>
    <Dialog open={Boolean(edgeDraft)} onClose={() => setEdgeDraft(null)} maxWidth="sm" fullWidth><DialogTitle>{w.edge}{edgeDraft ? ` · ${edgeDraft.label}` : ''}</DialogTitle><DialogContent sx={{ pt: '8px !important' }}><TextField autoFocus fullWidth multiline minRows={3} maxRows={8} label={w.note} value={edgeDraft?.text || ''} inputProps={{ maxLength: 500 }} onChange={(event) => setEdgeDraft({ ...edgeDraft, text: event.target.value })} /><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{w.edgeHint}</Typography></DialogContent><DialogActions><Button onClick={() => setEdgeDraft(null)}>{w.cancel}</Button><Button variant="contained" disabled={disabled} onClick={() => {
      const edgeNotes = { ...saved.edge_notes };
      if (edgeDraft.text.trim()) edgeNotes[edgeDraft.id] = edgeDraft.text.trim(); else delete edgeNotes[edgeDraft.id];
      onBlueprintChange({ ...saved, edge_notes: edgeNotes }); setEdgeDraft(null);
    }}>{w.save}</Button></DialogActions></Dialog>
  </Stack>;
}
