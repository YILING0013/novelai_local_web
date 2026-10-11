"use client";

import { useState } from 'react';
import { Box, ButtonBase, IconButton, MenuItem, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { Add, ArrowDownward, ArrowUpward, BrushOutlined, Check, ChevronRight, Close, CropFree, DeleteOutline, DriveFileRenameOutline, ExpandMore, ImageOutlined, LayersOutlined, LockOpenOutlined, LockOutlined, MergeType, TextFields, VisibilityOffOutlined, VisibilityOutlined } from '@mui/icons-material';
import { addComicLayer, mergeComicLayerDown, moveComicItemToLayer, reorderComicItem, reorderComicLayer } from './comicLayers.mjs';

const messages = {
  zh: {
    layers: '图层', add: '添加图层', newLayer: '新图层', close: '关闭图层', rename: '重命名图层', name: '图层名称', save: '保存名称', cancel: '取消',
    up: '图层上移', down: '图层下移', merge: '向下合并', mergeLocked: '合并前请解锁上下图层', mergeVisibility: '合并前请让上下两层同时显示或隐藏', remove: '删除空图层', nonempty: '图层有内容，请先移动内容或向下合并', lastLayer: '至少保留一个图层',
    show: '显示图层', hide: '隐藏图层', lock: '锁定图层', unlock: '解锁图层', expand: '展开内容', collapse: '收起内容', empty: '空图层',
    panel: '分镜', stroke: '笔迹', text: '文字', bubble: '气泡', sticker: '贴图', moveTo: '移到图层', itemUp: '内容上移', itemDown: '内容下移',
    panels: '分镜层', overlays: '叠加层', dialogue: '气泡与文字', custom: '图层', locked: '已锁定', hidden: '已隐藏',
  },
  en: {
    layers: 'Layers', add: 'Add layer', newLayer: 'New layer', close: 'Close layers', rename: 'Rename layer', name: 'Layer name', save: 'Save name', cancel: 'Cancel',
    up: 'Move layer up', down: 'Move layer down', merge: 'Merge down', mergeLocked: 'Unlock both layers before merging', mergeVisibility: 'Show or hide both layers before merging', remove: 'Delete empty layer', nonempty: 'Move the contents or merge down before deleting', lastLayer: 'Keep at least one layer',
    show: 'Show layer', hide: 'Hide layer', lock: 'Lock layer', unlock: 'Unlock layer', expand: 'Expand contents', collapse: 'Collapse contents', empty: 'Empty layer',
    panel: 'Panel', stroke: 'Stroke', text: 'Text', bubble: 'Bubble', sticker: 'Sticker', moveTo: 'Move to layer', itemUp: 'Move item up', itemDown: 'Move item down',
    panels: 'Panels', overlays: 'Overlays', dialogue: 'Bubbles and text', custom: 'Layer', locked: 'Locked', hidden: 'Hidden',
  },
};

/** 图层操作共用紧凑图标按钮，手机点击名称由工作区统一展示。 */
function LayerAction({ label, hint, children, ...props }) {
  return <Tooltip title={hint || label}>
    <span style={{ display: 'inline-flex' }} data-action-label={hint || label}>
      <IconButton {...props} size="small" aria-label={label} data-action-label={hint || label} sx={{ width: 30, height: 30, '& svg': { fontSize: 17 } }}>{children}</IconButton>
    </span>
  </Tooltip>;
}

/**
 * 显示漫画页的图层和内容，通过回调提交完整新页面，不直接改变画布或持久化数据。
 * @param {object} props 页面、当前图层及内容选择、中英文语言和选择/变更/关闭回调。
 * @returns {JSX.Element} 由工作区定位的图层浮层。
 */
export default function ComicLayerPanel({ page, activeLayerId, selectedItem, language, onSelectLayer, onSelectItem, onChange, onClose }) {
  const c = messages[language];
  const [collapsed, setCollapsed] = useState([]);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const items = [
    ...page.panels.map((item, index) => ({ kind: 'panel', item, label: `${c.panel} ${index + 1}`, Icon: CropFree })),
    ...page.strokes.map((item, index) => ({ kind: 'stroke', item, label: `${c.stroke} ${index + 1}`, Icon: BrushOutlined })),
    ...page.elements.map((item, index) => ({ kind: 'element', item, label: item.name || item.text?.trim() || `${c[item.kind]} ${index + 1}`, Icon: item.kind === 'sticker' ? ImageOutlined : TextFields })),
  ].sort((a, b) => b.item.order - a.item.order);
  const selection = selectedItem && items.find(({ kind, item }) => kind === selectedItem.kind && item.id === selectedItem.id);
  const selectedLayer = selection && page.layers.find((layer) => layer.id === selection.item.layerId);
  const selectedLayerItems = selection ? items.filter(({ item }) => item.layerId === selection.item.layerId) : [];
  const selectedItemIndex = selection ? selectedLayerItems.indexOf(selection) : -1;

  function renameLayer(event) {
    event.preventDefault();
    if (!name.trim()) return;
    onChange({ ...page, layers: page.layers.map((layer) => layer.id === renaming ? { ...layer, name: name.trim() } : layer), updatedAt: Date.now() });
    setRenaming(null);
  }

  return <Paper elevation={8} role="region" aria-label={c.layers} data-comic-layers
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (renaming) setRenaming(null); else onClose();
    }}
    sx={{ width: 260, maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(460px, 70dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.6, borderBottom: 1, borderColor: 'divider' }}>
      <LayersOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />
      <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{c.layers}</Typography>
      <LayerAction label={c.add} onClick={() => {
        const next = addComicLayer(page, `${c.newLayer} ${page.layers.length + 1}`);
        const layer = next.layers.at(-1);
        onChange(next);
        onSelectLayer(layer.id);
        setRenaming(layer.id);
        setName(layer.name);
      }}><Add /></LayerAction>
      <LayerAction label={c.close} onClick={onClose}><Close /></LayerAction>
    </Box>
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      {/* 数据按底到顶保存，图层列表从视觉最上方开始排列。 */}
      {[...page.layers].reverse().map((layer) => {
        const layerIndex = page.layers.indexOf(layer);
        const layerItems = items.filter(({ item }) => item.layerId === layer.id);
        const layerName = layer.name || c[layer.kind];
        const active = layer.id === activeLayerId;
        const open = !collapsed.includes(layer.id);
        const below = page.layers[layerIndex - 1];
        return <Box key={layer.id} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', px: 0.4, py: 0.3, bgcolor: active ? 'action.selected' : 'transparent', borderLeft: 3, borderLeftColor: active ? 'primary.main' : 'transparent' }}>
            <LayerAction label={`${open ? c.collapse : c.expand} · ${layerName}`} onClick={() => setCollapsed((previous) => open ? [...previous, layer.id] : previous.filter((id) => id !== layer.id))}>
              {open ? <ExpandMore /> : <ChevronRight />}
            </LayerAction>
            <ButtonBase aria-pressed={active} data-action-label={layerName} onClick={() => onSelectLayer(layer.id)} sx={{ flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'flex-start', gap: 0.5, textAlign: 'left', pr: 0.5 }}>
              <Typography noWrap sx={{ fontSize: 12, fontWeight: active ? 700 : 500, color: layer.visible ? 'text.primary' : 'text.secondary' }}>{layerName}</Typography>
              <Typography component="span" sx={{ ml: 'auto', fontSize: 10, color: 'text.secondary' }}>{layerItems.length}</Typography>
            </ButtonBase>
            <LayerAction label={`${layer.visible ? c.hide : c.show} · ${layerName}`} aria-pressed={layer.visible} onClick={() => onChange({ ...page, layers: page.layers.map((entry) => entry.id === layer.id ? { ...entry, visible: !entry.visible } : entry), updatedAt: Date.now() })}>
              {layer.visible ? <VisibilityOutlined /> : <VisibilityOffOutlined color="disabled" />}
            </LayerAction>
            <LayerAction label={`${layer.locked ? c.unlock : c.lock} · ${layerName}`} aria-pressed={layer.locked} onClick={() => onChange({ ...page, layers: page.layers.map((entry) => entry.id === layer.id ? { ...entry, locked: !entry.locked } : entry), updatedAt: Date.now() })}>
              {layer.locked ? <LockOutlined color="primary" /> : <LockOpenOutlined sx={{ color: 'text.disabled' }} />}
            </LayerAction>
          </Box>
          {renaming === layer.id ? <Box component="form" onSubmit={renameLayer} sx={{ display: 'flex', alignItems: 'center', pl: 1, pr: 0.5, py: 0.8 }}>
            <TextField autoFocus size="small" label={c.name} value={name} onChange={(event) => setName(event.target.value)} onFocus={(event) => event.target.select()} sx={{ flex: 1, '& input': { fontSize: 12, py: 0.9 } }} />
            <LayerAction label={c.save} type="submit" disabled={!name.trim()}><Check /></LayerAction>
            <LayerAction label={c.cancel} onClick={() => setRenaming(null)}><Close /></LayerAction>
          </Box> : active && <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', px: 0.5, bgcolor: 'action.hover' }}>
            {layer.locked && <Typography sx={{ mr: 'auto', pl: 0.8, fontSize: 10, color: 'text.secondary' }}>{c.locked}</Typography>}
            <LayerAction label={c.rename} onClick={() => { setRenaming(layer.id); setName(layerName); }}><DriveFileRenameOutline /></LayerAction>
            <LayerAction label={c.up} disabled={layerIndex === page.layers.length - 1} onClick={() => onChange(reorderComicLayer(page, layer.id, 1))}><ArrowUpward /></LayerAction>
            <LayerAction label={c.down} disabled={layerIndex === 0} onClick={() => onChange(reorderComicLayer(page, layer.id, -1))}><ArrowDownward /></LayerAction>
            <LayerAction label={c.merge} hint={layer.locked || below?.locked ? c.mergeLocked : below && layer.visible !== below.visible ? c.mergeVisibility : undefined} disabled={layer.locked || !below || below.locked || layer.visible !== below.visible} onClick={() => {
              onChange(mergeComicLayerDown(page, layer.id));
              onSelectLayer(below.id);
              if (selection?.item.layerId === layer.id) onSelectItem(selection.kind, selection.item.id);
            }}><MergeType sx={{ transform: 'rotate(180deg)' }} /></LayerAction>
            <LayerAction label={c.remove} hint={layerItems.length ? c.nonempty : page.layers.length === 1 ? c.lastLayer : undefined} disabled={layer.locked || layerItems.length > 0 || page.layers.length === 1} onClick={() => {
              const layers = page.layers.filter((entry) => entry.id !== layer.id);
              onChange({ ...page, layers, updatedAt: Date.now() });
              onSelectLayer(layers[Math.min(layerIndex, layers.length - 1)].id);
            }}><DeleteOutline /></LayerAction>
          </Box>}
          {open && <Box sx={{ py: 0.35, opacity: layer.visible ? 1 : 0.55 }}>
            {layerItems.length === 0 && <Typography sx={{ py: 0.5, pl: 4.5, fontSize: 11, color: 'text.secondary' }}>{c.empty}</Typography>}
            {layerItems.map(({ kind, item, label, Icon }) => <ButtonBase key={`${kind}-${item.id}`} aria-pressed={selection?.item.id === item.id && selection.kind === kind} aria-label={`${label} · ${layerName}`} data-action-label={label}
              onClick={() => { onSelectLayer(layer.id); onSelectItem(kind, item.id); }}
              sx={{ display: 'flex', width: '100%', minWidth: 0, minHeight: 31, gap: 0.8, pl: 4.5, pr: 1, justifyContent: 'flex-start', textAlign: 'left', bgcolor: selection?.item.id === item.id && selection.kind === kind ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
              <Icon sx={{ fontSize: 15, color: 'text.secondary', flexShrink: 0 }} />
              <Typography noWrap sx={{ fontSize: 11, minWidth: 0 }}>{label}</Typography>
            </ButtonBase>)}
          </Box>}
        </Box>;
      })}
    </Box>
    {selection && <Box sx={{ px: 1, py: 0.8, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.6, gap: 0.5 }}>
        <Typography noWrap sx={{ flex: 1, fontSize: 11, fontWeight: 600 }}>{selection.label}</Typography>
        <LayerAction label={c.itemUp} disabled={selectedLayer.locked || selectedItemIndex === 0} onClick={() => onChange(reorderComicItem(page, selection.kind, selection.item.id, 1))}><ArrowUpward /></LayerAction>
        <LayerAction label={c.itemDown} disabled={selectedLayer.locked || selectedItemIndex === selectedLayerItems.length - 1} onClick={() => onChange(reorderComicItem(page, selection.kind, selection.item.id, -1))}><ArrowDownward /></LayerAction>
      </Box>
      <TextField select fullWidth size="small" label={c.moveTo} value={selection.item.layerId} disabled={selectedLayer.locked}
        onChange={(event) => {
          onChange(moveComicItemToLayer(page, selection.kind, selection.item.id, event.target.value));
          onSelectLayer(event.target.value);
          onSelectItem(selection.kind, selection.item.id);
        }}
        sx={{ '& .MuiSelect-select': { fontSize: 12, py: 0.9 } }}>
        {[...page.layers].reverse().map((layer) => <MenuItem key={layer.id} value={layer.id} disabled={layer.locked} sx={{ fontSize: 12, gap: 0.75 }}>
          {layer.name || c[layer.kind]}
          {!layer.visible && <VisibilityOffOutlined sx={{ ml: 'auto', fontSize: 15 }} aria-label={c.hidden} />}
          {layer.locked && <LockOutlined sx={{ ml: 'auto', fontSize: 15 }} aria-label={c.locked} />}
        </MenuItem>)}
      </TextField>
    </Box>}
  </Paper>;
}
