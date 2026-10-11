"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Slider, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Add, ChangeHistory, Check, Close, CropFree, Flip, FontDownloadOutlined, FormatAlignCenter, FormatAlignLeft, FormatAlignRight, FormatColorFill, HelpOutline, Link, LinkOff, Remove, RestartAlt, Timeline, UploadFile } from '@mui/icons-material';
import ComicElementArt from './ComicElementArt';
import { COMIC_BALLOON_PRESETS, comicElementMatrix, readComicAsset, readComicFont } from './comicElements.mjs';
import { comicBalloonContours, comicBalloonPath, moveComicBalloonPoint, splitComicBalloonCurve } from './comicBalloonPaths.mjs';

const LABELS = {
  zh: {
    curve: '曲线', curveNode: '曲线节点', curveIn: '入控制柄', curveOut: '出控制柄', addNode: '在下一段曲线加点', removeNode: '删除节点', smoothNode: '平滑节点', cornerNode: '尖角节点', resetCurve: '恢复预设轮廓', curveTip: '拖动锚点改变轮廓，拖动控制柄调节弧度；Alt 单独移动控制柄，方向键微调。',
    writingMode: '文字排版', horizontal: '横排', vertical: '竖排（从右到左）', columnGap: '列距', top: '顶部对齐', bottom: '底部对齐',
    bubble: '编辑对白框', sticker: '编辑贴纸', text: '编辑文字', preview: '元素预览', content: '内容', transform: '变形', mask: '蒙版', name: '名称', preset: '样式', textLabel: '文字', font: '字体', fontSize: '字号', lineHeight: '行距', uploadFont: '导入字体', replaceImage: '替换素材', color: '文字颜色', fill: '填充颜色', toggleFill: '显示 / 隐藏填充', stroke: '描边颜色', strokeWidth: '描边', left: '左对齐', center: '居中', right: '右对齐', width: '宽度', height: '高度', ratio: '锁定比例', scale: '缩放', rotation: '旋转', skewX: '水平倾斜', skewY: '垂直倾斜', flipX: '水平镜像', flipY: '垂直镜像', resetTransform: '重置变形', opacity: '不透明度', feather: '边缘羽化', resetMask: '重置蒙版', maskCorner: '蒙版角点', maskTip: '拖动四个圆点调整保留区域；聚焦圆点后也可用方向键微调', cancel: '取消', apply: '应用', sans: '无衬线', serif: '衬线', mono: '等宽', cursive: '手写', assetError: '无法导入素材。请选择 PNG、WebP、JPEG 或纯图形 SVG；SVG 不可包含脚本、外链或动画。', fontError: '无法加载字体。请选择有效的 TTF、OTF、WOFF 或 WOFF2 文件。',
  },
  en: {
    curve: 'Curve', curveNode: 'Curve node', curveIn: 'Incoming handle', curveOut: 'Outgoing handle', addNode: 'Add a node on the next segment', removeNode: 'Delete node', smoothNode: 'Smooth node', cornerNode: 'Corner node', resetCurve: 'Reset preset outline', curveTip: 'Drag anchors to reshape and handles to bend. Alt moves one handle independently; arrow keys nudge the focused point.',
    writingMode: 'Text direction', horizontal: 'Horizontal', vertical: 'Vertical (right to left)', columnGap: 'Column spacing', top: 'Align top', bottom: 'Align bottom',
    bubble: 'Edit balloon', sticker: 'Edit sticker', text: 'Edit text', preview: 'Element preview', content: 'Content', transform: 'Transform', mask: 'Mask', name: 'Name', preset: 'Style', textLabel: 'Text', font: 'Font', fontSize: 'Size', lineHeight: 'Line height', uploadFont: 'Import font', replaceImage: 'Replace image', color: 'Text color', fill: 'Fill color', toggleFill: 'Show / hide fill', stroke: 'Outline color', strokeWidth: 'Outline', left: 'Align left', center: 'Center', right: 'Align right', width: 'Width', height: 'Height', ratio: 'Lock aspect ratio', scale: 'Scale', rotation: 'Rotation', skewX: 'Horizontal skew', skewY: 'Vertical skew', flipX: 'Flip horizontal', flipY: 'Flip vertical', resetTransform: 'Reset transforms', opacity: 'Opacity', feather: 'Edge feather', resetMask: 'Reset mask', maskCorner: 'Mask corner', maskTip: 'Drag the four dots to crop; focus a dot and use arrow keys for small adjustments', cancel: 'Cancel', apply: 'Apply', sans: 'Sans serif', serif: 'Serif', mono: 'Monospace', cursive: 'Handwriting', assetError: 'Could not import the asset. Choose PNG, WebP, JPEG, or a graphics-only SVG without scripts, external resources, or animation.', fontError: 'Could not load the font. Choose a valid TTF, OTF, WOFF, or WOFF2 file.',
  },
};

const FULL_MASK = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const ALPHA_TABLE = `0 ${Array(255).fill(1).join(' ')}`;

/**
 * 在内部副本中编辑对白框、贴纸或文字；只有点击应用才将元素和新增字体交给页面。
 * @param {{element:object,fonts:Array,language:'zh'|'en',onClose:Function,onApply:Function}} props 编辑对象、页面字体和回调。
 * @returns {React.ReactNode} 支持鼠标、触摸和键盘蒙版调整的独立弹窗。
 */
export default function ComicElementDialog({ element, fonts = [], language = 'zh', onClose, onApply }) {
  const c = LABELS[language];
  const [draft, setDraft] = useState(() => structuredClone(element));
  const vertical = draft.writingMode === 'vertical-rl';
  const [draftFonts, setDraftFonts] = useState(() => [...fonts]);
  const [tab, setTab] = useState(element.dataUrl ? 'mask' : 'content');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lockedRatio, setLockedRatio] = useState(true);
  const [scale, setScale] = useState(100);
  const [previewSize, setPreviewSize] = useState({ width: 500, height: 400 });
  const [previewNode, setPreviewNode] = useState(null);
  const [selectedCurve, setSelectedCurve] = useState({ contour: 0, node: 0 });
  const latest = useRef(draft);
  const scaleBase = useRef({ width: element.width, height: element.height });
  const maskGroup = useRef(null);
  const curveGroup = useRef(null);
  const drag = useRef(null);
  const animationFrame = useRef(null);
  const assetInput = useRef(null);
  const fontInput = useRef(null);
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    // Dialog 的 Portal 会晚于编辑器首次 effect 挂载，等预览节点真正出现后再观察尺寸。
    if (!previewNode) return;
    const observer = new ResizeObserver(([entry]) => setPreviewSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(previewNode);
    return () => { observer.disconnect(); cancelAnimationFrame(animationFrame.current); };
  }, [previewNode]);
  useEffect(() => {
    if (latest.current.id === element.id) return;
    latest.current = structuredClone(element); setDraft(latest.current); setDraftFonts([...fonts]); setTab(element.dataUrl ? 'mask' : 'content');
    scaleBase.current = { width: element.width, height: element.height }; setScale(100); setError(''); setSelectedCurve({ contour: 0, node: 0 });
  }, [element, fonts]);

  function update(changes) {
    latest.current = { ...latest.current, ...changes }; setDraft(latest.current);
  }
  function resize(width, height) {
    const current = latest.current;
    update({ width, height, x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2 });
  }
  function finishPreviewDrag(event, cancel = false) {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(animationFrame.current); animationFrame.current = null;
    if (cancel) latest.current = { ...latest.current, [action.field]: action.before };
    setDraft(latest.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const localElement = { ...draft, x: 0, y: 0 };
  const matrix = comicElementMatrix(localElement);
  const corners = [[0, 0], [draft.width, 0], [draft.width, draft.height], [0, draft.height]].map(([x, y]) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }));
  const padding = Math.max(draft.width, draft.height) * 0.12;
  const view = { x: Math.min(...corners.map((point) => point.x)) - padding, y: Math.min(...corners.map((point) => point.y)) - padding, width: Math.max(...corners.map((point) => point.x)) - Math.min(...corners.map((point) => point.x)) + padding * 2, height: Math.max(...corners.map((point) => point.y)) - Math.min(...corners.map((point) => point.y)) + padding * 2 };
  const pixel = Math.max(view.width / previewSize.width, view.height / previewSize.height);
  const maskPoints = draft.mask.map((point) => `${point.x * draft.width},${point.y * draft.height}`).join(' ');
  const editingMask = tab === 'mask';
  const editingCurve = tab === 'curve';
  const contours = draft.kind === 'bubble' && !draft.dataUrl ? draft.balloonContours || comicBalloonContours(draft.presetId) : [];
  const selectedCurveNode = contours[selectedCurve.contour]?.[selectedCurve.node];
  const curveHandles = editingCurve ? contours.flatMap((contour, contourIndex) => contour.map((point, index) => ({ contour: contourIndex, node: index, handle: 'anchor', x: point.x, y: point.y }))) : [];
  if (editingCurve && selectedCurveNode) {
    for (const handle of ['in', 'out']) curveHandles.push({ ...selectedCurve, handle, x: selectedCurveNode[`${handle}X`], y: selectedCurveNode[`${handle}Y`] });
  }
  const directAssetPreview = Boolean(draft.dataUrl && !draft.text);

  return <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
    <DialogTitle sx={{ py: 1.5 }}>{c[draft.kind]}</DialogTitle>
    <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2 }, display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) 320px' }, gap: 2, alignItems: 'start', overflowX: 'hidden' }}>
      <Box sx={{ minWidth: 0, position: { md: 'sticky' }, top: 0 }}>
        <Box component="svg" ref={setPreviewNode} role="img" aria-label={c.preview} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          sx={{ width: '100%', height: { xs: 260, md: 'min(58vh, 580px)' }, display: 'block', borderRadius: 1, bgcolor: '#f6f6f6', backgroundImage: 'conic-gradient(#dedee3 25%, transparent 0 50%, #dedee3 0 75%, transparent 0)', backgroundSize: '20px 20px', touchAction: 'none', userSelect: 'none', '& [data-curve-handle]:focus-visible': { stroke: '#258acc', strokeWidth: pixel, strokeDasharray: `${pixel * 3} ${pixel * 2}` } }}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            const index = event.target.dataset.maskCorner, handle = event.target.dataset.curveHandle;
            if ((!editingMask || index === undefined) && (!editingCurve || !handle)) return;
            event.preventDefault();
            event.target.focus();
            if (editingMask) {
              drag.current = { field: 'mask', pointerId: event.pointerId, index: Number(index), matrix: maskGroup.current.getScreenCTM().inverse(), before: latest.current.mask };
            } else {
              const target = { contour: Number(event.target.dataset.curveContour), node: Number(event.target.dataset.curveNode), handle };
              const matrix = curveGroup.current.getScreenCTM().inverse();
              const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
              drag.current = { field: 'balloonContours', pointerId: event.pointerId, target, matrix, before: latest.current.balloonContours, contours, start: { x: point.x / draft.width * 100, y: point.y / draft.height * 100 } };
              setSelectedCurve({ contour: target.contour, node: target.node });
            }
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const action = drag.current;
            if (!action || action.pointerId !== event.pointerId) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(action.matrix);
            if (action.field === 'mask') {
              latest.current = { ...latest.current, mask: latest.current.mask.map((corner, index) => index === action.index ? { x: Math.max(0, Math.min(1, point.x / latest.current.width)), y: Math.max(0, Math.min(1, point.y / latest.current.height)) } : corner) };
            } else {
              const node = action.contours[action.target.contour][action.target.node];
              const x = action.target.handle === 'anchor' ? node.x : node[`${action.target.handle}X`];
              const y = action.target.handle === 'anchor' ? node.y : node[`${action.target.handle}Y`];
              latest.current = { ...latest.current, balloonContours: moveComicBalloonPoint(action.contours, action.target, { x: x + point.x / latest.current.width * 100 - action.start.x, y: y + point.y / latest.current.height * 100 - action.start.y }, event.altKey) };
            }
            if (animationFrame.current === null) animationFrame.current = requestAnimationFrame(() => { animationFrame.current = null; setDraft(latest.current); });
          }}
          onPointerUp={finishPreviewDrag} onPointerCancel={(event) => finishPreviewDrag(event, true)} onLostPointerCapture={(event) => finishPreviewDrag(event, true)}>
          {directAssetPreview ? <g transform={`matrix(${matrix.join(' ')})`} pointerEvents="none">
            <defs>
              <clipPath id={`${id}-crop`}><polygon points={maskPoints} /></clipPath>
              {draft.feather > 0 && <filter id={`${id}-feather`} x="0" y="0" width={draft.width} height={draft.height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feComponentTransfer in="SourceAlpha" result="shape"><feFuncA type="discrete" tableValues={ALPHA_TABLE} /></feComponentTransfer>
                <feMorphology in="shape" operator="erode" radius={draft.feather / 2} result="inner" />
                <feGaussianBlur in="inner" stdDeviation={draft.feather / 3} result="soft" />
                <feComposite in="SourceGraphic" in2="soft" operator="in" />
              </filter>}
            </defs>
            {editingMask && <image href={draft.dataUrl} width={draft.width} height={draft.height} preserveAspectRatio="none" opacity="0.16" />}
            <g opacity={draft.opacity} filter={draft.feather > 0 ? `url(#${id}-feather)` : undefined}><image href={draft.dataUrl} width={draft.width} height={draft.height} preserveAspectRatio="none" clipPath={`url(#${id}-crop)`} /></g>
          </g> : <ComicElementArt element={localElement} fonts={draftFonts} />}
          {editingMask && <g ref={maskGroup} transform={`matrix(${matrix.join(' ')})`}>
            <polygon points={maskPoints} fill="none" stroke="#1976d2" strokeWidth={pixel * 1.5} strokeDasharray={`${pixel * 5} ${pixel * 3}`} pointerEvents="none" />
            {draft.mask.map((point, index) => <g key={index}>
              <circle cx={point.x * draft.width} cy={point.y * draft.height} r={pixel * 22} fill="transparent" data-mask-corner={index} role="button" tabIndex="0" aria-label={`${c.maskCorner} ${index + 1}`} style={{ cursor: 'crosshair' }}
                onKeyDown={(event) => {
                  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
                  if (!direction) return;
                  event.preventDefault();
                  const amount = event.shiftKey ? 0.05 : 0.005;
                  update({ mask: latest.current.mask.map((corner, cornerIndex) => cornerIndex === index ? { x: Math.max(0, Math.min(1, corner.x + direction[0] * amount)), y: Math.max(0, Math.min(1, corner.y + direction[1] * amount)) } : corner) });
                }} />
              <circle cx={point.x * draft.width} cy={point.y * draft.height} r={pixel * 5} fill="white" stroke="#1976d2" strokeWidth={pixel * 2} pointerEvents="none" />
            </g>)}
          </g>}
          {editingCurve && <g ref={curveGroup} transform={`matrix(${matrix.join(' ')})`}>
            {contours.map((contour, index) => <path key={index} d={comicBalloonPath(contour)} transform={`scale(${draft.width / 100} ${draft.height / 100})`} fill="none" stroke="#ee7951" strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
            {selectedCurveNode && ['in', 'out'].map((handle) => <line key={handle} x1={selectedCurveNode.x * draft.width / 100} y1={selectedCurveNode.y * draft.height / 100} x2={selectedCurveNode[`${handle}X`] * draft.width / 100} y2={selectedCurveNode[`${handle}Y`] * draft.height / 100} stroke="#258acc" strokeWidth={pixel} pointerEvents="none" />)}
            {curveHandles.map((point) => {
              const anchor = point.handle === 'anchor';
              const selected = point.contour === selectedCurve.contour && point.node === selectedCurve.node;
              const label = `${anchor ? c.curveNode : point.handle === 'in' ? c.curveIn : c.curveOut} ${point.contour + 1}.${point.node + 1}`;
              // 尖角的两根柄收在锚点上，先选“平滑”展开，避免遮挡锚点命中区域。
              if (!anchor && point.x === selectedCurveNode.x && point.y === selectedCurveNode.y) return null;
              return <g key={`${point.contour}-${point.node}-${point.handle}`}>
                <circle cx={point.x * draft.width / 100} cy={point.y * draft.height / 100} r={pixel * 11} fill="transparent" role="button" tabIndex="0" aria-label={label} data-curve-contour={point.contour} data-curve-node={point.node} data-curve-handle={point.handle} style={{ cursor: 'move', outline: 'none' }}
                  onFocus={() => { if (anchor) setSelectedCurve({ contour: point.contour, node: point.node }); }}
                  onKeyDown={(event) => {
                    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
                    if (!direction) return;
                    event.preventDefault();
                    const current = latest.current.balloonContours || comicBalloonContours(latest.current.presetId);
                    const target = current[point.contour][point.node];
                    const x = anchor ? target.x : target[`${point.handle}X`], y = anchor ? target.y : target[`${point.handle}Y`];
                    const step = event.shiftKey ? 2 : 0.5;
                    update({ balloonContours: moveComicBalloonPoint(current, point, { x: x + direction[0] * step, y: y + direction[1] * step }, event.altKey) });
                  }}><title>{label}</title></circle>
                <circle cx={point.x * draft.width / 100} cy={point.y * draft.height / 100} r={pixel * (anchor ? 4.5 : 3.5)} fill={anchor && selected ? '#ee7951' : 'white'} stroke={anchor ? '#ee7951' : '#258acc'} strokeWidth={pixel * 1.5} pointerEvents="none" />
              </g>;
            })}
          </g>}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0, px: 1 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="fullWidth" sx={{ minHeight: 40, mb: 1.5, '& .MuiTab-root': { minWidth: 0, minHeight: 40, px: 1 } }}>
          <Tab value="content" label={c.content} />{contours.length > 0 && <Tab value="curve" label={c.curve} />}<Tab value="transform" label={c.transform} />{draft.dataUrl && <Tab value="mask" label={c.mask} />}
        </Tabs>
        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1.5 }}>{error}</Alert>}
        {tab === 'content' && <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField size="small" fullWidth label={c.name} value={draft.name} onChange={(event) => update({ name: event.target.value })} />
            {draft.dataUrl && <Tooltip title={c.replaceImage}><IconButton aria-label={c.replaceImage} disabled={busy} onClick={() => assetInput.current.click()} sx={{ width: 44, height: 44 }}><UploadFile /></IconButton></Tooltip>}
          </Box>
          {draft.kind === 'bubble' && !draft.dataUrl && <TextField select size="small" label={c.preset} value={draft.presetId} onChange={(event) => { update({ presetId: event.target.value, balloonContours: undefined }); setSelectedCurve({ contour: 0, node: 0 }); }}>{COMIC_BALLOON_PRESETS.map((preset) => <MenuItem key={preset.id} value={preset.id}>{preset.name[language]}</MenuItem>)}</TextField>}
          {draft.kind !== 'sticker' && <>
            <TextField size="small" multiline minRows={3} maxRows={6} label={c.textLabel} value={draft.text} onChange={(event) => update({ text: event.target.value })} />
            <TextField select size="small" label={c.writingMode} value={draft.writingMode || 'horizontal-tb'} onChange={(event) => update({ writingMode: event.target.value })}>
              <MenuItem value="horizontal-tb">{c.horizontal}</MenuItem>
              <MenuItem value="vertical-rl">{c.vertical}</MenuItem>
            </TextField>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField select size="small" fullWidth label={c.font} value={draft.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })}>
                {[['sans-serif', c.sans], ['serif', c.serif], ['monospace', c.mono], ['cursive', c.cursive]].map(([family, name]) => <MenuItem key={family} value={family}>{name}</MenuItem>)}
                {draftFonts.map((font) => <MenuItem key={font.id} value={font.family} sx={{ fontFamily: font.family }}>{font.name}</MenuItem>)}
              </TextField>
              <Tooltip title={c.uploadFont}><IconButton aria-label={c.uploadFont} disabled={busy} onClick={() => fontInput.current.click()} sx={{ width: 44, height: 44 }}><FontDownloadOutlined /></IconButton></Tooltip>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField size="small" type="number" label={c.fontSize} value={draft.fontSize} slotProps={{ htmlInput: { min: 6, max: 400, step: 1 } }} onChange={(event) => { const value = Number(event.target.value); if (value >= 6 && value <= 400) update({ fontSize: value }); }} />
              <TextField size="small" type="number" label={vertical ? c.columnGap : c.lineHeight} value={draft.lineHeight} slotProps={{ htmlInput: { min: 0.8, max: 3, step: 0.05 } }} onChange={(event) => { const value = Number(event.target.value); if (value >= 0.8 && value <= 3) update({ lineHeight: value }); }} />
            </Box>
            <ToggleButtonGroup exclusive value={draft.textAlign} onChange={(_, value) => { if (value) update({ textAlign: value }); }} size="small" sx={{ '& .MuiToggleButton-root': { flex: 1, height: 40 } }}>
              <Tooltip title={vertical ? c.top : c.left}><ToggleButton value="left" aria-label={vertical ? c.top : c.left}><FormatAlignLeft sx={{ transform: vertical ? 'rotate(90deg)' : undefined }} /></ToggleButton></Tooltip>
              <Tooltip title={c.center}><ToggleButton value="center" aria-label={c.center}><FormatAlignCenter sx={{ transform: vertical ? 'rotate(90deg)' : undefined }} /></ToggleButton></Tooltip>
              <Tooltip title={vertical ? c.bottom : c.right}><ToggleButton value="right" aria-label={vertical ? c.bottom : c.right}><FormatAlignRight sx={{ transform: vertical ? 'rotate(90deg)' : undefined }} /></ToggleButton></Tooltip>
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {['color', 'fill', 'stroke'].map((field) => <Tooltip key={field} title={c[field]}><Box component="input" type="color" aria-label={c[field]} value={draft[field] === 'none' ? '#ffffff' : draft[field]} onChange={(event) => update({ [field]: event.target.value })} sx={{ width: 38, height: 38, minWidth: 38, p: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }} /></Tooltip>)}
              <Tooltip title={c.toggleFill}><IconButton aria-label={c.toggleFill} aria-pressed={draft.fill !== 'none'} color={draft.fill !== 'none' ? 'primary' : 'default'} onClick={() => update({ fill: draft.fill === 'none' ? '#ffffff' : 'none' })} sx={{ width: 40, height: 40 }}><FormatColorFill /></IconButton></Tooltip>
              <TextField size="small" type="number" label={c.strokeWidth} value={draft.strokeWidth} slotProps={{ htmlInput: { min: 0, max: 20, step: 0.5 } }} onChange={(event) => { const value = Number(event.target.value); if (value >= 0 && value <= 20) update({ strokeWidth: value }); }} sx={{ minWidth: 70 }} />
            </Box>
          </>}
        </Box>}
        {editingCurve && selectedCurveNode && <Box sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption">{c.curveNode} {selectedCurve.contour + 1}.{selectedCurve.node + 1}</Typography>
            <Tooltip title={c.curveTip}><IconButton aria-label={c.curveTip} sx={{ width: 40, height: 40 }}><HelpOutline /></IconButton></Tooltip>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            <Tooltip title={c.addNode}><IconButton aria-label={c.addNode} onClick={() => {
              update({ balloonContours: contours.map((contour, index) => index === selectedCurve.contour ? splitComicBalloonCurve(contour, selectedCurve.node) : contour) });
              setSelectedCurve({ ...selectedCurve, node: selectedCurve.node + 1 });
            }} sx={{ width: 44, height: 44 }}><Add /></IconButton></Tooltip>
            <Tooltip title={c.removeNode}><span><IconButton aria-label={c.removeNode} disabled={contours[selectedCurve.contour].length <= 3} onClick={() => {
              const remaining = contours[selectedCurve.contour].filter((_, index) => index !== selectedCurve.node);
              update({ balloonContours: contours.map((contour, index) => index === selectedCurve.contour ? remaining : contour) });
              setSelectedCurve({ ...selectedCurve, node: Math.min(selectedCurve.node, remaining.length - 1) });
            }} sx={{ width: 44, height: 44 }}><Remove /></IconButton></span></Tooltip>
            {['smooth', 'corner'].map((kind) => <Tooltip key={kind} title={kind === 'smooth' ? c.smoothNode : c.cornerNode}><IconButton aria-label={kind === 'smooth' ? c.smoothNode : c.cornerNode} aria-pressed={kind === 'smooth' ? Boolean(selectedCurveNode.smooth) : !selectedCurveNode.smooth} color={(kind === 'smooth') === Boolean(selectedCurveNode.smooth) ? 'primary' : 'default'} onClick={() => {
              const contour = contours[selectedCurve.contour], point = selectedCurveNode;
              const previous = contour[(selectedCurve.node + contour.length - 1) % contour.length], next = contour[(selectedCurve.node + 1) % contour.length];
              const dx = kind === 'smooth' ? (next.x - previous.x) / 6 : 0, dy = kind === 'smooth' ? (next.y - previous.y) / 6 : 0;
              update({ balloonContours: contours.map((path, pathIndex) => pathIndex !== selectedCurve.contour ? path : path.map((node, index) => index === selectedCurve.node ? { ...node, smooth: kind === 'smooth', inX: point.x - dx, inY: point.y - dy, outX: point.x + dx, outY: point.y + dy } : node)) });
            }} sx={{ width: 44, height: 44 }}>{kind === 'smooth' ? <Timeline /> : <ChangeHistory />}</IconButton></Tooltip>)}
            <Tooltip title={c.resetCurve}><IconButton aria-label={c.resetCurve} onClick={() => { update({ balloonContours: undefined }); setSelectedCurve({ contour: 0, node: 0 }); }} sx={{ width: 44, height: 44 }}><RestartAlt /></IconButton></Tooltip>
          </Box>
        </Box>}
        {tab === 'transform' && <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {['width', 'height'].map((field) => <TextField key={field} size="small" type="number" label={c[field]} value={Number(draft[field].toFixed(1))} slotProps={{ htmlInput: { min: 4, step: 1 } }} onChange={(event) => {
              const value = Number(event.target.value); if (value < 4) return;
              const current = latest.current;
              const width = field === 'width' ? value : lockedRatio ? current.width * value / current.height : current.width;
              const height = field === 'height' ? value : lockedRatio ? current.height * value / current.width : current.height;
              resize(width, height); scaleBase.current = { width, height }; setScale(100);
            }} />)}
            <Tooltip title={c.ratio}><IconButton aria-label={c.ratio} aria-pressed={lockedRatio} color={lockedRatio ? 'primary' : 'default'} onClick={() => setLockedRatio((value) => !value)} sx={{ width: 40, height: 40 }}>{lockedRatio ? <Link /> : <LinkOff />}</IconButton></Tooltip>
          </Box>
          <Box><Typography variant="caption">{c.scale} · {scale}%</Typography><Slider aria-label={c.scale} value={scale} min={25} max={300} step={1} onChange={(_, value) => { setScale(value); resize(scaleBase.current.width * value / 100, scaleBase.current.height * value / 100); }} /></Box>
          {['rotation', 'skewX', 'skewY'].map((field) => <Box key={field}><Typography variant="caption">{c[field]} · {Math.round(draft[field])}°</Typography><Slider aria-label={c[field]} value={draft[field]} min={field === 'rotation' ? -180 : -75} max={field === 'rotation' ? 180 : 75} step={1} onChange={(_, value) => update({ [field]: value })} /></Box>)}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {['flipX', 'flipY'].map((field) => <Tooltip key={field} title={c[field]}><IconButton aria-label={c[field]} aria-pressed={draft[field]} color={draft[field] ? 'primary' : 'default'} onClick={() => update({ [field]: !draft[field] })} sx={{ width: 44, height: 44 }}><Flip sx={{ transform: field === 'flipY' ? 'rotate(90deg)' : undefined }} /></IconButton></Tooltip>)}
            <Tooltip title={c.resetTransform}><IconButton aria-label={c.resetTransform} onClick={() => { resize(element.width, element.height); scaleBase.current = { width: element.width, height: element.height }; setScale(100); update({ rotation: 0, skewX: 0, skewY: 0, flipX: false, flipY: false }); }} sx={{ width: 44, height: 44 }}><RestartAlt /></IconButton></Tooltip>
          </Box>
        </Box>}
        {tab === 'mask' && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tooltip title={c.maskTip}><IconButton aria-label={c.maskTip} sx={{ width: 44, height: 44 }}><HelpOutline /></IconButton></Tooltip>
          <Tooltip title={c.resetMask}><IconButton aria-label={c.resetMask} onClick={() => update({ mask: FULL_MASK.map((point) => ({ ...point })) })} sx={{ width: 44, height: 44 }}><CropFree /></IconButton></Tooltip>
        </Box>}
        {tab !== 'content' && <Box sx={{ display: 'grid', gap: 1.5, mt: 1.5 }}>
          <Box><Typography variant="caption">{c.opacity} · {Math.round(draft.opacity * 100)}%</Typography><Slider aria-label={c.opacity} value={draft.opacity * 100} min={0} max={100} step={1} onChange={(_, value) => update({ opacity: value / 100 })} /></Box>
          <Box><Typography variant="caption">{c.feather} · {draft.feather}px</Typography><Slider aria-label={c.feather} value={draft.feather} min={0} max={64} step={0.5} onChange={(_, value) => update({ feather: value })} /></Box>
        </Box>}
        <input ref={assetInput} type="file" hidden accept="image/png,image/webp,image/jpeg,image/svg+xml,.svg" onChange={async (event) => {
          const file = event.target.files[0]; event.target.value = ''; if (!file) return;
          setBusy(true); setError('');
          try {
            const asset = await readComicAsset(file);
            const width = latest.current.width, height = width * asset.height / asset.width;
            resize(width, height); update({ dataUrl: asset.dataUrl, name: asset.name, mask: FULL_MASK.map((point) => ({ ...point })) });
            scaleBase.current = { width, height }; setScale(100); setTab('mask');
          } catch { setError(c.assetError); }
          finally { setBusy(false); }
        }} />
        <input ref={fontInput} type="file" hidden accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={async (event) => {
          const file = event.target.files[0]; event.target.value = ''; if (!file) return;
          setBusy(true); setError('');
          try {
            const font = await readComicFont(file);
            const existing = draftFonts.find((item) => item.dataUrl === font.dataUrl);
            if (!existing) setDraftFonts((current) => [...current, font]);
            update({ fontFamily: (existing || font).family });
          } catch { setError(c.fontError); }
          finally { setBusy(false); }
        }} />
      </Box>
    </DialogContent>
    <DialogActions sx={{ px: 2, py: 1 }}>
      <Tooltip title={c.cancel}><IconButton aria-label={c.cancel} onClick={onClose} sx={{ width: 44, height: 44 }}><Close /></IconButton></Tooltip>
      <Tooltip title={c.apply}><span><IconButton aria-label={c.apply} disabled={busy} onClick={() => onApply(latest.current, draftFonts)} sx={{ width: 44, height: 44, bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}><Check /></IconButton></span></Tooltip>
    </DialogActions>
  </Dialog>;
}
