"use client";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, MenuItem, Slider, Stack, Switch, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import {
  AddPhotoAlternateOutlined, AutoAwesomeOutlined, BlurOn, BrushOutlined, Check, Close, Compare, ControlCamera,
  GridOn, LayersOutlined, PanToolOutlined, Redo, RestartAlt, TextFields, Tune, Undo,
  ViewHeadline, ViewWeekOutlined, WaterDropOutlined,
} from '@mui/icons-material';
import { Eraser } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { downloadBlobToFile, fetchUrlAsBlob } from '@/utils/mediaAssets';
import { readDroppedFiles } from '../tools/ImageTools/previewImageDragData.mjs';
import { transparencyBackgroundSx } from '../tools/ImageTools/previewImageExport';
import ImagePrivacyCover, { imagePrivacySx } from '../ImagePrivacyCover';
import Curves from './compositor/components/Curves';
import { ADJUSTMENT_RANGES, DEFAULT_ADJUSTMENTS, GRADING_CHANNELS, HSL_CHANNELS } from './compositor/lib/model';
import { parseCubeLut } from './compositor/lib/lut';
import { canvasOf } from './compositor/lib/renderer';
import { imageLooks } from './quickImageLooks';
import { loadSignatureFont, signatureFonts } from './watermarkFonts';
import ui from './QuickImageAdjustment.module.css';
import {
  defaultImageAdjustments, hasImageWatermark, imageAdjustmentSource, imageColorStatistics, publishAdjustedImage,
  renderQuickImage, renderWatermarkLayer, saveQuickImagePreset,
} from './quickImageAdjustments';

const toneGroups = [
  ['light', ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']],
  ['color', ['temperature', 'tint', 'hue', 'vibrance', 'saturation']],
];
const detailGroups = [
  ['texture', ['sharpen', 'dehaze', 'blur']],
  ['effects', ['vignette', 'noise', 'bloom', 'aberration']],
];
const curveKeys = ['curve', 'curveRed', 'curveGreen', 'curveBlue'];
const curveColors = ['#c4dcea', '#ee8887', '#86ce95', '#8db4ff'];
const anchors = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const modes = [['tone', Tune], ['style', AutoAwesomeOutlined], ['details', WaterDropOutlined], ['mosaic', GridOn], ['watermark', LayersOutlined]];
const lightRamp = 'linear-gradient(90deg,#283246,#697888,#f8ecd3)';
const warmRamp = 'linear-gradient(90deg,#5499ec,#91a5a8,#f1a553)';
const tintRamp = 'linear-gradient(90deg,#5bab82,#989aaf,#c877ac)';
const hueRamp = 'linear-gradient(90deg,#ea6868,#dfc654,#64bc82,#66c9d1,#787de5,#d46ac8,#ea6868)';
const initialEdit = { settings: defaultImageAdjustments, strokes: [], overlay: null };

function Section({ title, children }) {
  return <section className={ui.section}>
    <h3 className={ui.sectionTitle}>{title}</h3>
    <div className={ui.sectionBody}>{children}</div>
  </section>;
}

function NumberControl({ label, value, min, max, step = 1, onCommit, guideTarget }) {
  const [input, setInput] = useState(null);
  return <label className={ui.numberRow}><span>{label}</span>
    <input data-tour={guideTarget} className={ui.readout} type="number" aria-label={label} min={min} max={max} step={step} value={input ?? Number(value.toFixed(2))}
      onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }} onBlur={() => {
        if (input !== null && input.trim() && Number.isFinite(Number(input))) {
          const next = Math.max(min, Math.min(max, Number(input)));
          if (next !== value) onCommit(next);
        }
        setInput(null);
      }} />
  </label>;
}

function ControlSlider({ label, value, min, max, step = 1, onPreview, onCommit, ramp = lightRamp }) {
  return <div>
    <NumberControl {...{ label, value, min, max, step, onCommit }} />
    <Slider size="small" aria-label={label} value={value} min={min} max={max} step={step} track={false}
      onChange={(_, next) => onPreview(next)} onChangeCommitted={(_, next) => onCommit(next)} sx={{
        py: 0.75, height: 6, display: 'block', '& .MuiSlider-rail': { opacity: 1, background: ramp, borderRadius: 8 },
        '& .MuiSlider-thumb': { width: 12, height: 12, borderRadius: '50%', bgcolor: 'background.paper', border: '2px solid currentColor', transition: 'box-shadow 120ms' },
      }} />
  </div>;
}

function Segmented({ label, value, onChange, options }) {
  return <ToggleButtonGroup className={ui.segments} exclusive size="small" aria-label={label} value={value}
    onChange={(_, next) => { if (next !== null) onChange(next); }}>
    {options.map(([key, name, Icon, color]) => <ToggleButton key={key} value={key} sx={{ ...(color && { color }) }}>
      {Icon && <Icon />}{name}
    </ToggleButton>)}
  </ToggleButtonGroup>;
}

function ColorControl({ label, value, onChange }) {
  return <Stack component="label" direction="row" spacing={0.75} alignItems="center" sx={{ width: 'fit-content' }}>
    <Box component="input" type="color" value={value} onChange={(event) => onChange(event.target.value)} sx={{
      bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, width: 32, height: 28, p: 0.375, cursor: 'pointer',
      '&::-webkit-color-swatch-wrapper': { p: 0 }, '&::-webkit-color-swatch': { border: 0, borderRadius: 0.5 },
    }} />
    <Typography variant="body2">{label}</Typography>
  </Stack>;
}

/**
 * 用当前图像提供实时单图预览，把控制面板放在绘画工作台的参数区域。
 * @param {object} props 当前图像、参数区挂载点、快捷预设和保存回调。
 * @returns {React.ReactElement} 支持马赛克画笔和水印摆放的预览及调整面板。
 */
export default function QuickImageAdjustment({ item, panel, privacyMode, privacyReveal, previewSettings, presets, onPresetsChange, onClose, onApply, onExerciseAction }) {
  const { t } = useI18n();
  const text = (key) => t(`painting.workspace.adjustment.${key}`);
  const canvasRef = useRef(null);
  const brushRing = useRef(null);
  const mounted = useRef(false);
  const draftRef = useRef(initialEdit);
  const drawingRef = useRef(null);
  const referenceInput = useRef(null);
  const lutInput = useRef(null);
  const watermarkInput = useRef(null);
  const overlayInput = useRef(null);
  const [history, setHistory] = useState({ past: [], current: initialEdit, future: [] });
  const [draft, setDraft] = useState(null);
  const [source, setSource] = useState(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [tab, setTab] = useState('tone');
  const [toneSection, setToneSection] = useState('light');
  const [lookGroup, setLookGroup] = useState('allLooks');
  const [lookSamples, setLookSamples] = useState({});
  const [curveKey, setCurveKey] = useState('curve');
  const [hslKey, setHslKey] = useState('red');
  const [gradeKey, setGradeKey] = useState('midtones');
  const [brush, setBrush] = useState('off');
  const [watermarkId, setWatermarkId] = useState('');
  const [watermarkSection, setWatermarkSection] = useState('typography');
  const [placementTool, setPlacementTool] = useState(null);
  const [compare, setCompare] = useState(false);
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const edits = draft ?? history.current;
  const { settings, strokes, overlay } = edits;
  const watermark = settings.watermarks.find((layer) => layer.id === watermarkId) ?? settings.watermarks[0];
  const activeWatermarkSection = watermark?.image && watermarkSection === 'typography' ? 'placement' : watermarkSection;
  const draggingOverlay = tab === 'mosaic' && placementTool === 'overlay' && overlay;
  const activeBrush = tab === 'mosaic' && brush !== 'off' && !draggingOverlay && !privacyMode && !compare;
  const draggingWatermark = tab === 'watermark' && placementTool === 'watermark' && watermark && !watermark.hidden;
  const canvasTool = !privacyMode && !compare && (activeBrush || draggingOverlay || draggingWatermark);
  const changed = edits !== initialEdit;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const change = (next, save = true) => {
    draftRef.current = next;
    setDraft(save ? null : next);
    if (save) setHistory((state) => ({ past: [...state.past.slice(-39), state.current], current: next, future: [] }));
  };
  const setSetting = (patch, save = true) => {
    const current = draftRef.current;
    change({ ...current, settings: { ...current.settings, ...patch } }, save);
  };
  const setAdjustment = (patch, save = true) => {
    setSetting({ adjustments: { ...draftRef.current.settings.adjustments, ...patch } }, save);
    onExerciseAction?.('changeAdjustment');
  };
  const updateWatermark = (id, patch, save = true) => {
    setSetting({ watermarks: draftRef.current.settings.watermarks.map((layer) => layer.id === id ? { ...layer, ...patch } : layer) }, save);
  };
  const navigateHistory = (back) => {
    setDraft(null);
    setHistory(({ past, current, future }) => {
      const next = back
        ? { past: past.slice(0, -1), current: past.at(-1), future: [current, ...future] }
        : { past: [...past, current], current: future[0], future: future.slice(1) };
      draftRef.current = next.current;
      return next;
    });
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const blob = item.cachedBlob || await fetchUrlAsBlob(item.downloadSrc || item.originalSrc || item.src);
        const preview = await imageAdjustmentSource(blob, 840);
        if (active) setSource({ blob, preview });
      } catch {
        if (active) setNotice('openFailed');
      }
    })();
    return () => { active = false; };
  }, [item.cachedBlob, item.downloadSrc, item.originalSrc, item.src]);

  useEffect(() => {
    if (!source) return;
    let active = true;
    const frame = requestAnimationFrame(() => {
      const rendered = compare ? Promise.resolve(source.preview) : renderQuickImage(source.preview, settings, strokes, overlay);
      void rendered.then((result) => {
        const canvas = canvasRef.current;
        if (!active || !canvas) return;
        canvas.width = result.width;
        canvas.height = result.height;
        canvas.getContext('2d').drawImage(result, 0, 0);
        setPreviewReady(true);
      }).catch(() => { if (active) setNotice('previewFailed'); });
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [source, settings, strokes, overlay, compare]);

  useEffect(() => {
    if (tab !== 'style' || privacyMode || !source || Object.keys(lookSamples).length) return;
    let active = true;
    const frame = requestAnimationFrame(async () => {
      const base = canvasOf(148, 75);
      const { preview } = source;
      const scale = Math.max(base.width / preview.width, base.height / preview.height);
      const width = preview.width * scale;
      const height = preview.height * scale;
      base.getContext('2d').drawImage(preview, (base.width - width) / 2, (base.height - height) / 2, width, height);
      try {
        const entries = await Promise.all(Object.keys(imageLooks).map(async (look) => {
          const canvas = await renderQuickImage(base, { ...defaultImageAdjustments, look });
          return [look, canvas.toDataURL()];
        }));
        if (active) setLookSamples(Object.fromEntries(entries));
      } catch { if (active) setNotice('previewFailed'); }
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [tab, source, privacyMode, lookSamples]);

  useEffect(() => {
    if (tab !== 'watermark') return;
    let active = true;
    void Promise.all(signatureFonts.map(({ family }) => loadSignatureFont(family, true)))
      .catch(() => { if (active) setNotice('fontFailed'); });
    return () => { active = false; };
  }, [tab]);

  const addWatermark = (image = null) => {
    const id = crypto.randomUUID();
    const layer = {
      id, image, text: image ? '' : text('exampleWatermark'),
      font: 'Allison', direction: 'horizontal', weight: '400', italic: false, spacing: 0, color: '#ffffff',
      outline: false, outlineColor: '#000000', outlineSize: 8, shadow: false, shadowColor: '#000000',
      position: 'bottom-right', x: 0.5, y: 0.5, offsetX: 3, offsetY: 3,
      size: image ? 12 : 6, rotation: 0, opacity: 85, tile: false, hidden: false,
    };
    setSetting({ watermarks: [...draftRef.current.settings.watermarks, layer] });
    setWatermarkId(id);
    setWatermarkSection(image ? 'placement' : 'typography');
  };

  const getPoint = (event) => {
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - left) / width)),
      y: Math.min(1, Math.max(0, (event.clientY - top) / height)),
    };
  };
  const movePointer = (point) => {
    const drawing = drawingRef.current;
    if (drawing.overlay) {
      const current = draftRef.current;
      change({ ...current, overlay: { ...current.overlay, ...point } }, false);
    } else if (drawing.layer) updateWatermark(drawing.layer, { ...point, position: 'custom', tile: false }, false);
    else {
      const { points } = drawing.stroke;
      drawing.stroke = { ...drawing.stroke, points: [...points, point] };
      const current = draftRef.current;
      change({ ...current, strokes: [...drawing.previous, drawing.stroke] }, false);
    }
  };

  const showBrushPointer = (canvas, point) => {
    const ring = brushRing.current;
    if (!ring || !activeBrush) return;
    const diameter = Math.min(canvas.clientWidth, canvas.clientHeight) * settings.mosaic.size / 100;
    ring.style.cssText = `display:block;left:${canvas.offsetLeft + point.x * canvas.clientWidth}px;top:${canvas.offsetTop + point.y * canvas.clientHeight}px;width:${diameter}px;height:${diameter}px`;
  };
  const changeAdjustment = (key, ramp) => {
    const Control = ramp ? ControlSlider : NumberControl;
    return <Control key={key} guideTarget={key === 'brightness' ? 'adjustReadout' : undefined} ramp={ramp} label={text(key)} value={settings.adjustments[key]} min={ADJUSTMENT_RANGES[key][0]}
      max={ADJUSTMENT_RANGES[key][1]} step={key === 'exposure' ? 0.05 : 1}
      onPreview={(value) => setAdjustment({ [key]: value }, false)} onCommit={(value) => setAdjustment({ [key]: value })} />;
  };
  const layerNumber = (key, min, max) => <NumberControl key={key} label={text(key)} value={watermark[key]} min={min} max={max}
    onCommit={(value) => updateWatermark(watermark.id, { [key]: value })} />;
  const layerSwitch = (key) => (
    <FormControlLabel className={ui.switchRow} labelPlacement="start" label={text(key)} control={<Switch size="small" checked={watermark[key]}
      onChange={(_, value) => updateWatermark(watermark.id, { [key]: value })} />} />
  );
  const loadFile = async (file, action, error) => {
    if (!file || busy) return;
    setNotice('');
    setBusy(true);
    try { await action(file); } catch { setNotice(error); } finally { setBusy(false); }
  };
  const onFileSelected = (event, action, error) => {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = '';
    void loadFile(file, action, error);
  };
  const useColorReference = async (file) => {
    setSetting({ colorMatch: imageColorStatistics(await imageAdjustmentSource(file, 512)) });
  };
  const loadOverlay = async (file) => {
    const image = await imageAdjustmentSource(file, 2048);
    change({ ...draftRef.current, overlay: { image, name: file.name, thumbnail: image.toDataURL('image/png'), x: 0.5, y: 0.5, size: 22, rotation: 0 } });
    setPlacementTool(privacyMode ? null : 'overlay');
  };

  const grade = settings.adjustments.grading[gradeKey];
  const hsl = HSL_CHANNELS.find(({ key }) => key === hslKey);
  const updateBand = (group, key, patch, commit = true) => {
    const bands = draftRef.current.settings.adjustments[group];
    setAdjustment({ [group]: { ...bands, [key]: { ...bands[key], ...patch } } }, commit);
  };
  const updateWheel = (event, commit) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left - box.width / 2) / (box.width / 2 - 5);
    const y = (event.clientY - box.top - box.height / 2) / (box.height / 2 - 5);
    updateBand('grading', gradeKey, {
      hue: Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360),
      saturation: Math.min(100, Math.round(Math.hypot(x, y) * 100)),
    }, commit);
  };

  const controls = <Stack className={ui.panel} sx={(theme) => ({
    '--edit-bg': theme.palette.background.default, '--edit-panel': theme.palette.background.paper,
    '--edit-border': theme.palette.divider, '--edit-accent': theme.palette.primary.main,
    '--edit-text': theme.palette.text.primary, '--edit-muted': theme.palette.text.secondary,
  })}>
    <header className={ui.header}>
      <Tune fontSize="small" color="primary" />
      <Typography className={ui.heading} variant="subtitle2">{text('title')}</Typography>
      <Tooltip title={text('compare')}><span><IconButton size="small" data-tour="compareAdjustment" aria-label={text('compare')} disabled={!source}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setCompare(true); onExerciseAction?.('compareAdjustment'); }}
        onPointerUp={() => setCompare(false)} onLostPointerCapture={() => setCompare(false)} onPointerCancel={() => setCompare(false)}
        onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setCompare(true); onExerciseAction?.('compareAdjustment'); } }}
        onKeyUp={() => setCompare(false)} onBlur={() => setCompare(false)}><Compare fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title={text('undo')}><span><IconButton size="small" aria-label={text('undo')} disabled={!history.past.length || busy}
        onClick={() => navigateHistory(true)}><Undo fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title={text('redo')}><span><IconButton size="small" aria-label={text('redo')} disabled={!history.future.length || busy}
        onClick={() => navigateHistory(false)}><Redo fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title={text('reset')}><span><IconButton size="small" aria-label={text('reset')} disabled={!changed || busy}
        onClick={() => { setPresetId(''); change(initialEdit); }}><RestartAlt fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title={text('close')}><IconButton size="small" aria-label={text('close')} onClick={onClose} disabled={busy}><Close fontSize="small" /></IconButton></Tooltip>
    </header>
    <div className={ui.presetBar}>
      <TextField select fullWidth size="small" label={text('preset')} value={presetId} disabled={busy}
        onChange={(event) => {
          const id = event.target.value;
          setPresetId(id);
          const preset = presets.find((entry) => entry.id === id);
          if (preset) setSetting({ ...defaultImageAdjustments, ...preset.settings });
        }}>
        <MenuItem value="">{text('choosePreset')}</MenuItem>
        {presets.map((preset) => <MenuItem value={preset.id} key={preset.id}>{preset.name}</MenuItem>)}
      </TextField>
    </div>
    <Tabs className={ui.modeTabs} value={tab} onChange={(_, next) => setTab(next)} variant="fullWidth" aria-label={text('title')}>
      {modes.map(([key, Icon]) => <Tab value={key} key={key} icon={<Icon />} label={text(key)} />)}
    </Tabs>
    <div className={ui.body}>
      {notice && <Alert severity="warning" onClose={() => setNotice('')}>{text(notice)}</Alert>}
      {tab === 'tone' && <>
        <Segmented label={text('tone')} value={toneSection} onChange={setToneSection}
          options={['light', 'color', 'curves', 'hsl', 'grading'].map((key) => [key, text(key === 'hsl' ? 'mix' : key === 'grading' ? 'grade' : key)])} />
        {toneGroups.filter(([section]) => section === toneSection).map(([section, keys]) => {
          const ramps = section === 'light' ? { exposure: lightRamp, contrast: lightRamp, highlights: lightRamp, shadows: lightRamp }
            : { temperature: warmRamp, tint: tintRamp, hue: hueRamp, saturation: 'linear-gradient(90deg,#737783,#6d93af,#e8749f)' };
          return <Section key={section} title={text(section)}>
            {keys.filter((key) => ramps[key]).map((key) => changeAdjustment(key, ramps[key]))}
            <div className={ui.measureGrid}>{keys.filter((key) => !ramps[key]).map((key) => changeAdjustment(key))}</div>
          </Section>;
        })}
        {toneSection === 'curves' && <Section title={text('curves')}>
          <Segmented label={text('channel')} value={curveKey} onChange={setCurveKey}
            options={curveKeys.map((key, index) => [key, text(key), null, curveColors[index]])} />
          <div className={ui.curves}><Curves points={settings.adjustments[curveKey]} smooth channel={text(curveKey)}
            color={curveColors[curveKeys.indexOf(curveKey)]}
            onPreview={(points) => setAdjustment({ [curveKey]: points }, false)}
            onCommit={() => { if (draftRef.current !== history.current) change(draftRef.current); }}
            onReset={() => setAdjustment({ [curveKey]: DEFAULT_ADJUSTMENTS[curveKey] })} /></div>
        </Section>}
        {toneSection === 'hsl' && <Section title={text('hsl')}>
          <div className={ui.swatches} role="group" aria-label={text('channel')}>
            {HSL_CHANNELS.map(({ key, color }) => <Tooltip title={text(key)} key={key}>
              <button type="button" className={ui.swatch} aria-label={text(key)} aria-pressed={hslKey === key}
                style={{ background: color }} onClick={() => setHslKey(key)} />
            </Tooltip>)}
          </div>
          {[
            ['hue', -60, 60, `linear-gradient(90deg,hsl(${hsl.hue - 60} 64% 56%),${hsl.color},hsl(${hsl.hue + 60} 64% 56%))`],
            ['saturation', -100, 100, `linear-gradient(90deg,#888,${hsl.color},hsl(${hsl.hue} 95% 45%))`],
            ['lightness', -100, 100, `linear-gradient(90deg,#1e2130,${hsl.color},#fff)`],
          ].map(([name, min, max, ramp]) => <ControlSlider key={name} label={text(name)} value={settings.adjustments.hsl[hslKey][name]}
            min={min} max={max} ramp={ramp} onPreview={(value) => updateBand('hsl', hslKey, { [name]: value }, false)}
            onCommit={(value) => updateBand('hsl', hslKey, { [name]: value })} />)}
        </Section>}
        {toneSection === 'grading' && <Section title={text('grading')}>
          <Segmented label={text('channel')} value={gradeKey} onChange={setGradeKey} options={GRADING_CHANNELS.map(({ key }) => [key, text(key)])} />
          <div className={ui.wheel} role="img" aria-label={text('gradeWheel')}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              updateWheel(event, false);
            }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateWheel(event, false); }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateWheel(event, true); }}
            onPointerCancel={() => { if (draftRef.current !== history.current) change(draftRef.current); }}>
            <span className={ui.wheelDot} style={{
              left: `${50 + Math.cos(grade.hue * Math.PI / 180) * grade.saturation / 2}%`,
              top: `${50 + Math.sin(grade.hue * Math.PI / 180) * grade.saturation / 2}%`,
            }} />
          </div>
          <div className={ui.measureGrid}>
            {[['hue', 0, 360], ['saturation', 0, 100], ['lightness', -100, 100]].map(([key, min, max]) => (
              <NumberControl key={key} label={text(key)} value={grade[key]} min={min} max={max}
                onCommit={(value) => updateBand('grading', gradeKey, { [key]: value })} />
            ))}
            {['gradingBlending', 'gradingBalance'].map((key) => changeAdjustment(key))}
          </div>
        </Section>}
      </>}
      {tab === 'style' && <>
        <Section title={text('looks')}>
          <Segmented label={text('looks')} value={lookGroup} onChange={setLookGroup}
            options={['allLooks', 'filmLooks', 'illustrationLooks'].map((key) => [key, text(key)])} />
          {settings.look !== 'neutral' && <ControlSlider label={text('lookStrength')} value={settings.lookStrength} min={0} max={100}
            ramp={`linear-gradient(90deg,#727c8b,${imageLooks[settings.look].colors.join(',')})`}
            onPreview={(lookStrength) => setSetting({ lookStrength }, false)} onCommit={(lookStrength) => setSetting({ lookStrength })} />}
          <div className={ui.tileGrid}>
            {Object.entries(imageLooks).filter(([, recipe]) => lookGroup === 'allLooks' || recipe.group === lookGroup).map(([name, { colors }]) => {
              const selected = settings.look === name;
              const sample = !privacyMode && lookSamples[name];
              return <button type="button" className={ui.tile} aria-pressed={selected} key={name} onClick={() => setSetting({ look: name })}>
                {sample ? <Box component="img" alt="" draggable={false} className={ui.lookSample} src={sample} /> :
                  <span className={ui.lookSample} style={{ background: `linear-gradient(120deg,${colors[0]},${colors[1]})` }} />}
                <span className={ui.tileLabel}>{text(name)}{selected && <Check />}</span>
              </button>;
            })}
          </div>
        </Section>
        <Section title={text('colorMatch')}>
          <div className={ui.drop} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file?.type.startsWith('image/')) void loadFile(file, useColorReference, 'fileFailed');
          }}>
            <Button size="small" startIcon={<AddPhotoAlternateOutlined />} disabled={busy} onClick={() => referenceInput.current.click()}>{text('loadReference')}</Button>
          </div>
          <div className={ui.row}>
            <Button size="small" disabled={!source || busy} onClick={() => setSetting({ colorMatch: imageColorStatistics(source.preview) })}>{text('currentReference')}</Button>
            {settings.colorMatch && <Button size="small" onClick={() => setSetting({ colorMatch: null })}>{text('clearReference')}</Button>}
          </div>
          {settings.colorMatch && <ControlSlider label={text('strength')} value={settings.matchStrength} min={0} max={100} ramp={warmRamp}
            onPreview={(matchStrength) => setSetting({ matchStrength }, false)} onCommit={(matchStrength) => setSetting({ matchStrength })} />}
        </Section>
        <Section title={text('lut')}>
          <div className={ui.row}>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => lutInput.current.click()}>{text('loadLut')}</Button>
            {settings.adjustments.lut && <Button size="small" onClick={() => setAdjustment({ lut: null })}>{text('clearReference')}</Button>}
          </div>
          {settings.adjustments.lut && <><Typography variant="caption">{settings.adjustments.lut.name}</Typography>{changeAdjustment('lutStrength', tintRamp)}</>}
        </Section>
      </>}
      {tab === 'details' && <>
        {detailGroups.map(([section, keys]) => <Section key={section} title={text(section)}>
          {changeAdjustment(keys[0], section === 'texture' ? lightRamp : 'linear-gradient(90deg,#9ba7bb,#59647b,#1f2131)')}
          <div className={ui.measureGrid}>{keys.slice(1).map((key) => changeAdjustment(key))}</div>
        </Section>)}
        <Section title={text('motion')}>
          <div className={ui.measureGrid}>{['motion', 'motionAngle'].map((key) => changeAdjustment(key))}</div>
        </Section>
        <Section title={text('duotone')}>
          <FormControlLabel className={ui.switchRow} labelPlacement="start" label={text('duotone')}
            control={<Switch size="small" checked={settings.adjustments.duotone} onChange={(_, duotone) => setAdjustment({ duotone })} />} />
          {settings.adjustments.duotone && <>
            <div className={ui.lookSample} style={{ height: 18, borderRadius: 5,
              background: `linear-gradient(90deg,${settings.adjustments.shadowColor},${settings.adjustments.highlightColor})` }} />
            <div className={ui.row}>
              <ColorControl label={text('shadows')} value={settings.adjustments.shadowColor} onChange={(shadowColor) => setAdjustment({ shadowColor })} />
              <ColorControl label={text('highlights')} value={settings.adjustments.highlightColor} onChange={(highlightColor) => setAdjustment({ highlightColor })} />
            </div>
          </>}
        </Section>
      </>}
      {tab === 'mosaic' && <>
        <Section title={text('brushTools')}>
          <Segmented label={text('brushTools')} value={draggingOverlay ? 'off' : brush} onChange={(value) => { setBrush(value); setPlacementTool(null); }}
            options={[[ 'off', text('off'), PanToolOutlined], ['paint', text('paint'), BrushOutlined], ['erase', text('erase'), Eraser]]} />
          <Segmented label={text('mosaicStyle')} value={settings.mosaic.style} onChange={(style) => setSetting({ mosaic: { ...settings.mosaic, style } })}
            options={[[ 'pixel', text('pixel'), GridOn], ['blur', text('blurred'), BlurOn]]} />
          <div className={ui.brushWell}>
            <div className={ui.brushSample} aria-hidden>
              <span style={{
                width: `${Math.max(3, settings.mosaic.size)}px`, aspectRatio: '1', borderRadius: '50%',
                border: brush === 'erase' ? '1px dashed #d4e3ee' : '1px solid #d4e3ee',
                background: brush === 'erase' ? 'transparent' : `radial-gradient(circle,#bfd3e5 ${settings.mosaic.hardness / 2}%,#bfd3e51a 72%)`,
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ControlSlider label={text('brushSize')} value={settings.mosaic.size} min={1} max={50}
                onPreview={(size) => setSetting({ mosaic: { ...settings.mosaic, size } }, false)}
                onCommit={(size) => setSetting({ mosaic: { ...settings.mosaic, size } })} />
            </div>
          </div>
          <div className={ui.measureGrid}>
            {[['hardness', 0, 100, 'hardness'], ['block', 0.5, 15, 'block']].map(([key, min, max, label]) => (
              <NumberControl key={key} label={text(label)} value={settings.mosaic[key]} min={min} max={max} step={key === 'block' ? 0.5 : 1}
                onCommit={(value) => setSetting({ mosaic: { ...settings.mosaic, [key]: value } })} />
            ))}
          </div>
          <div className={ui.row}>
            <Button size="small" disabled={!strokes.length} onClick={() => change({ ...edits, strokes: strokes.slice(0, -1) })}>{text('undoStroke')}</Button>
            <Button size="small" disabled={!strokes.length} onClick={() => change({ ...edits, strokes: [] })}>{text('clearStrokes')}</Button>
          </div>
          {privacyMode && <Alert severity="info">{text('privacyEditHelp')}</Alert>}
        </Section>
        <Section title={text('overlay')}>
          <div className={ui.drop} data-drop-zone="quick-overlay" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            void loadFile(readDroppedFiles(event.dataTransfer)[0], loadOverlay, 'fileFailed');
          }}>
            <Button size="small" startIcon={<AddPhotoAlternateOutlined />} disabled={busy} onClick={() => overlayInput.current.click()}>
              {text(overlay ? 'replaceOverlay' : 'addOverlay')}
            </Button>
          </div>
          {overlay && <>
            <div className={ui.row}>
              {!privacyMode && <Box component="img" className={ui.overlayThumb} src={overlay.thumbnail} alt="" />}
              <Typography noWrap variant="caption" sx={{ flex: 1 }}>{overlay.name}</Typography>
              <Tooltip title={text('clearReference')}><IconButton size="small" aria-label={text('clearReference')} onClick={() => {
                change({ ...edits, overlay: null });
                setPlacementTool(null);
              }}><Close fontSize="small" /></IconButton></Tooltip>
            </div>
            <Button size="small" variant={draggingOverlay ? 'contained' : 'outlined'} startIcon={<ControlCamera />} aria-pressed={Boolean(draggingOverlay)}
              disabled={privacyMode} onClick={() => setPlacementTool(draggingOverlay ? null : 'overlay')}>{text('moveOnCanvas')}</Button>
            <div className={ui.measureGrid}>
              {[['size', 'overlaySize', 1, 100], ['rotation', 'rotation', -180, 180]].map(([key, label, min, max]) => (
                <NumberControl key={key} label={text(label)} value={overlay[key]} min={min} max={max}
                  onCommit={(value) => change({ ...draftRef.current, overlay: { ...draftRef.current.overlay, [key]: value } })} />
              ))}
            </div>
          </>}
        </Section>
      </>}
      {tab === 'watermark' && <>
        <div className={ui.row}>
          <Button size="small" variant="outlined" startIcon={<TextFields />} disabled={busy} onClick={() => addWatermark()}>{text('addText')}</Button>
          <Button size="small" variant="outlined" startIcon={<AddPhotoAlternateOutlined />} disabled={busy} onClick={() => watermarkInput.current.click()}>{text('addImage')}</Button>
        </div>
        {watermark && <>
          <Section title={text('layer')}>
            <div className={ui.row}>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ flex: 1, minWidth: 0 }}>
                {settings.watermarks.map((entry, index) => <Button size="small" variant={watermark.id === entry.id ? 'contained' : 'outlined'}
                  aria-pressed={watermark.id === entry.id} key={entry.id} onClick={() => setWatermarkId(entry.id)}
                  sx={{ minWidth: 0, maxWidth: '100%', textTransform: 'none' }}>
                  <Typography variant="caption" noWrap>{index + 1}. {entry.image ? text('imageLayer') : entry.text.slice(0, 19) || text('textLayer')}</Typography>
                </Button>)}
              </Stack>
              <Tooltip title={text('removeLayer')}><IconButton size="small" color="error" aria-label={text('removeLayer')} onClick={() => {
                setSetting({ watermarks: settings.watermarks.filter((layer) => layer.id !== watermark.id) });
                setWatermarkId('');
              }}><Close fontSize="small" /></IconButton></Tooltip>
            </div>
            {layerSwitch('hidden')}
          </Section>
          <Segmented label={text('watermark')} value={activeWatermarkSection} onChange={setWatermarkSection}
            options={(watermark.image ? ['placement', 'appearance'] : ['typography', 'placement', 'appearance']).map((key) => [key, text(key)])} />
          {activeWatermarkSection === 'typography' && <Section title={text('typography')}>
            <TextField multiline maxRows={4} size="small" label={text('textLayer')} value={watermark.text}
              onChange={(event) => updateWatermark(watermark.id, { text: event.target.value.slice(0, 512) }, false)}
              onBlur={() => { if (draftRef.current !== history.current) change(draftRef.current); }} />
            <Segmented label={text('direction')} value={watermark.direction || 'horizontal'}
              onChange={(direction) => updateWatermark(watermark.id, { direction })}
              options={[[ 'horizontal', text('horizontal'), ViewHeadline], ['vertical', text('vertical'), ViewWeekOutlined]]} />
            <div className={ui.tileGrid} role="group" aria-label={text('font')}>
              {signatureFonts.map(({ family, previewFamily, sample, label }) => <button type="button" key={family} className={ui.tile} aria-pressed={watermark.font === family}
                onClick={() => updateWatermark(watermark.id, { font: family })}>
                <span className={ui.signature} style={{ '--signature-family': `"${previewFamily || family}"` }} aria-hidden>{sample}</span>
                <span className={ui.tileLabel}>{label ? text(label) : family}{watermark.font === family && <Check />}</span>
              </button>)}
            </div>
            <Segmented label={text('weight')} value={watermark.weight} onChange={(weight) => updateWatermark(watermark.id, { weight })}
              options={['400', '600', '700'].map((weight) => [weight, text(`weight${weight}`)])} />
            <div className={ui.row}>
              <ColorControl label={text('textColor')} value={watermark.color} onChange={(color) => updateWatermark(watermark.id, { color })} />
              {layerNumber('spacing', -30, 100)}
            </div>
            {layerSwitch('italic')}
          </Section>}
          {activeWatermarkSection === 'placement' && <Section title={text('placement')}>
            <div className={ui.placement}>
              <div className={ui.anchorGrid} role="group" aria-label={text('position')}>
                {anchors.map((key) => <Tooltip key={key} title={text(key)}>
                  <button className={ui.anchor} type="button" aria-label={text(key)} aria-pressed={watermark.position === key} onClick={() => {
                    updateWatermark(watermark.id, { position: key, tile: false });
                    setPlacementTool(null);
                  }}><span /></button>
                </Tooltip>)}
              </div>
              <Stack spacing={0.5}>
                <Button size="small" variant={draggingWatermark ? 'contained' : 'outlined'} startIcon={<ControlCamera />} aria-pressed={Boolean(draggingWatermark)}
                  disabled={privacyMode || watermark.hidden} onClick={() => setPlacementTool(draggingWatermark ? null : 'watermark')}>{text('moveOnCanvas')}</Button>
                {watermark.position !== 'custom' && <>{layerNumber('offsetX', -30, 50)}{layerNumber('offsetY', -30, 50)}</>}
              </Stack>
            </div>
            <div className={ui.measureGrid}>{layerNumber('size', 1, 50)}{layerNumber('rotation', -180, 180)}</div>
          </Section>}
          {activeWatermarkSection === 'appearance' && <Section title={text('appearance')}>
            <ControlSlider label={text('opacity')} value={watermark.opacity} min={0} max={100} ramp="linear-gradient(90deg,#6c7582,#e8f1f5)"
              onPreview={(opacity) => updateWatermark(watermark.id, { opacity }, false)}
              onCommit={(opacity) => updateWatermark(watermark.id, { opacity })} />
            <Stack>{layerSwitch('tile')}{!watermark.image && layerSwitch('outline')}{layerSwitch('shadow')}</Stack>
            {!watermark.image && watermark.outline && <div className={ui.row}>
              <ColorControl label={text('outlineColor')} value={watermark.outlineColor}
                onChange={(outlineColor) => updateWatermark(watermark.id, { outlineColor })} />
              {layerNumber('outlineSize', 1, 20)}
            </div>}
            {watermark.shadow && <ColorControl label={text('shadowColor')} value={watermark.shadowColor}
              onChange={(shadowColor) => updateWatermark(watermark.id, { shadowColor })} />}
          </Section>}
          <Button size="small" disabled={!source || !hasImageWatermark(settings) || busy} onClick={async () => {
            setBusy(true);
            try {
              const original = await imageAdjustmentSource(source.blob);
              const layer = await renderWatermarkLayer(original.width, original.height, settings.watermarks);
              const png = await new Promise((resolve) => layer.toBlob(resolve, 'image/png'));
              await downloadBlobToFile(png, 'watermark.png');
            } catch { setNotice('applyFailed'); } finally { setBusy(false); }
          }}>{text('exportWatermark')}</Button>
        </>}
      </>}
      <input type="file" hidden ref={referenceInput} accept="image/*" onChange={(event) => onFileSelected(event, useColorReference, 'fileFailed')} />
      <input type="file" hidden ref={lutInput} accept=".cube" onChange={(event) => onFileSelected(event,
        async (file) => setAdjustment({ lut: parseCubeLut(await file.text(), file.name) }), 'lutFailed')} />
      <input type="file" hidden ref={watermarkInput} accept="image/png,image/jpeg,image/webp" onChange={(event) => onFileSelected(event,
        async (file) => addWatermark((await imageAdjustmentSource(file, 1600)).toDataURL('image/png')), 'fileFailed')} />
      <input type="file" hidden ref={overlayInput} accept="image/png,image/jpeg,image/webp"
        onChange={(event) => onFileSelected(event, loadOverlay, 'fileFailed')} />
    </div>
    <footer className={ui.footer}>
      <Button size="small" variant="outlined" disabled={settings === defaultImageAdjustments || busy} onClick={() => setPresetName('')}>{text('savePreset')}</Button>
      <Button size="small" variant="contained" data-tour="applyAdjustment" disabled={!source || !changed || busy} onClick={async () => {
        const snapshot = draftRef.current;
        setBusy(true);
        setNotice('');
        try {
          const original = await imageAdjustmentSource(source.blob);
          const output = await renderQuickImage(original, snapshot.settings, snapshot.strokes, snapshot.overlay);
          const blob = await publishAdjustedImage(output, source.blob, original);
          if (mounted.current) await onApply(blob, original.width, original.height);
        } catch { setNotice('applyFailed'); } finally { setBusy(false); }
      }}>{text('apply')}</Button>
    </footer>
    <Dialog open={presetName !== null} onClose={() => setPresetName(null)} fullWidth maxWidth="xs">
      <DialogTitle>{text('savePreset')}</DialogTitle>
      <DialogContent><TextField autoFocus fullWidth size="small" sx={{ mt: 0.75 }} label={text('presetName')} value={presetName ?? ''}
        onChange={(event) => setPresetName(event.target.value.slice(0, 60))} /></DialogContent>
      <DialogActions>
        <Button onClick={() => setPresetName(null)}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!presetName?.trim() || busy} onClick={async () => {
          setBusy(true);
          try {
            const name = presetName.trim();
            const entries = await saveQuickImagePreset(name, draftRef.current.settings);
            onPresetsChange(entries);
            setPresetId(entries.find((preset) => preset.name === name).id);
            setPresetName(null);
          } catch { setNotice('presetFailed'); setPresetName(null); } finally { setBusy(false); }
        }}>{text('savePreset')}</Button>
      </DialogActions>
    </Dialog>
  </Stack>;

  const ratio = source ? source.preview.width / source.preview.height : 1;
  return <>
    <Box sx={(theme) => ({
      position: 'relative', width: `min(${item.width || '100%'}${item.width ? 'px' : ''}, 100cqw, ${ratio * 100}cqh)`,
      aspectRatio: String(ratio), borderRadius: 1, boxShadow: theme.shadows[8],
      visibility: previewReady ? 'visible' : 'hidden', ...transparencyBackgroundSx(previewSettings, theme), ...imagePrivacySx,
    })}>
      <Box component="canvas" ref={canvasRef} className={canvasTool ? 'image-adjustment-canvas' : undefined}
        data-private-image aria-label={text('preview')}
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 'inherit', visibility: previewReady ? 'visible' : 'hidden',
          touchAction: canvasTool ? 'none' : 'auto', cursor: activeBrush ? 'none' : canvasTool ? 'move' : 'inherit' }}
        onPointerDown={(event) => {
          if (!source || busy || !canvasTool || !event.isPrimary || event.button !== 0) return;
          event.stopPropagation();
          const point = getPoint(event);
          showBrushPointer(event.currentTarget, point);
          if (activeBrush && brush === 'erase' && !strokes.some((stroke) => !stroke.erase)) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const gesture = draggingOverlay ? { overlay: true } : draggingWatermark ? { layer: watermark.id } : {
            previous: strokes, stroke: { size: settings.mosaic.size, hardness: settings.mosaic.hardness, erase: brush === 'erase', points: [] },
          };
          drawingRef.current = { ...gesture, pointerId: event.pointerId };
          movePointer(point);
        }}
        onPointerMove={(event) => {
          if (!event.isPrimary || !canvasTool) return;
          const point = getPoint(event);
          showBrushPointer(event.currentTarget, point);
          if (drawingRef.current?.pointerId === event.pointerId) movePointer(point);
        }}
        onPointerLeave={() => { if (brushRing.current) brushRing.current.style.display = 'none'; }}
        onPointerUp={(event) => {
          if (drawingRef.current?.pointerId !== event.pointerId) return;
          drawingRef.current = null;
          change(draftRef.current);
        }}
        onLostPointerCapture={(event) => {
          if (drawingRef.current?.pointerId !== event.pointerId) return;
          drawingRef.current = null;
          draftRef.current = history.current;
          setDraft(null);
        }} />
      {activeBrush && <span ref={brushRing} className={ui.brushRing} data-erase={brush === 'erase'} aria-hidden />}
      {privacyMode && <ImagePrivacyCover mode={privacyReveal} />}
    </Box>
    {panel && createPortal(controls, panel)}
  </>;
}
