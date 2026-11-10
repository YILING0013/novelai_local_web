"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, ButtonBase,
  Chip, FormControlLabel, InputAdornment, Paper, Radio, RadioGroup, Slider,
  Snackbar, Stack, Switch, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup,
  Typography, useMediaQuery, useTheme, alpha,
} from '@mui/material';
import {
  Check, DarkModeOutlined, ExpandMore, FolderOpenOutlined, LightModeOutlined,
  PaletteOutlined, Refresh, SaveOutlined, SpeedOutlined, TuneOutlined,
} from '@mui/icons-material';
import { generateFileName, DOWNLOAD_NAMING_METHODS } from '@/components/ai-painting/tools/ImageTools/ImageSaveUtils';
import GallerySourceSelect from '@/components/gallery/GallerySourceSelect';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import { PAGE_COLOR_DEFAULTS, getPageColorStorageKey } from '@/i18n/pageConfig.mjs';
import { DEFAULT_THEME_SETTINGS, THEME_PRESETS } from '@/providers/themePresets.mjs';
import { useAppTheme } from '@/providers/AppThemeProvider';

const sections = [
  { id: 'appearance', icon: <PaletteOutlined /> },
  { id: 'pages', icon: <TuneOutlined /> },
  { id: 'interface', icon: <SpeedOutlined /> },
  { id: 'gallery', icon: <FolderOpenOutlined /> },
];

/** 判断输入能否被 MUI 调色函数处理，避免未输入完整的色值进入全站主题。 */
function isValidColor(value) {
  return /^(#|rgba?\(|hsla?\()/i.test(value) && CSS.supports('color', value);
}

/**
 * 主题与页面强调色共用的色值输入，文本框和取色器修改同一个值。
 * @param {object} props label 为字段名称，value 为色值，onChange 接收新色值。
 * @returns {React.ReactElement} 带颜色预览和错误提示的输入框。
 */
function ColorField({ label, value, onChange }) {
  const { t } = useI18n();
  const valid = isValidColor(value);
  return <TextField
    label={label} value={value} onChange={(event) => onChange(event.target.value)}
    size="small" fullWidth error={!valid}
    helperText={!valid ? t('settings.invalidColor') : undefined}
    InputProps={{ startAdornment: <InputAdornment position="start">
      <Box component="label" sx={{
        position: 'relative', width: 24, height: 24, borderRadius: 0.75,
        border: 1, borderColor: 'divider', bgcolor: valid ? value : 'transparent', overflow: 'hidden',
      }}>
        <input type="color" aria-label={t('settings.pickColor', { name: label })}
          value={/^#[\da-f]{6}$/i.test(value) ? value : '#58779A'}
          onChange={(event) => onChange(event.target.value)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
      </Box>
    </InputAdornment> }}
  />;
}

/**
 * 设置工作区：按分区编辑草稿，试色即时预览，保存后写入本地后端并更新浏览器缓存。
 * @param {object} props pages 为可见页面，active 表示标签是否可见，sectionRequest 指定从画廊跳入的分区。
 * @returns {React.ReactElement} 分类导航、设置内容与始终可见的保存栏。
 */
export default function SettingsPage({ pages = [], active = true, sectionRequest = null }) {
  const theme = useTheme();
  const { t, locale, setLocale } = useI18n();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { savedSettings, previewTheme, reloadFromStorage } = useAppTheme();
  const [section, setSection] = useState('appearance');
  const [themeDraft, setThemeDraft] = useState(null);
  const themeSettings = themeDraft || savedSettings;
  const { mode, primaryColors, backgroundColors, animationEnabled, animationSpeed } = themeSettings;
  const [pageColors, setPageColors] = useState(() => Object.fromEntries(pages.map((page) => [
    page.id, localStorage.getItem(getPageColorStorageKey(page.id)) || page.color,
  ])));
  const [imageSettings, setImageSettings] = useState(() => ({
    outputDirectory: '',
    inspirationSource: 'default',
    fileNamePrefix: localStorage.getItem('fileNamePrefix') || 'AI_Image',
    namingMethod: localStorage.getItem('namingMethod') || 'seed',
  }));
  const [savedImages, setSavedImages] = useState(imageSettings);
  const [savedPageColors, setSavedPageColors] = useState(pageColors);
  const [snackbar, setSnackbar] = useState(null);
  const contentRef = useRef(null);
  const initialState = useRef({ pageColors, imageSettings });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    apiClient.getLocalSettings().then((settings) => {
      if (cancelled) return;
      // 后端保存值是跨浏览器的持久配置；旧浏览器缓存只补没有保存过的字段。
      for (const [key, value] of Object.entries(settings)) {
        if (key.startsWith('theme') || ['animationEnabled', 'animationSpeed', 'fileNamePrefix', 'namingMethod'].includes(key)) {
          localStorage.setItem(key, String(value));
        }
      }
      const colors = { ...initialState.current.pageColors, ...settings.pageColors };
      for (const [id, color] of Object.entries(colors)) localStorage.setItem(getPageColorStorageKey(id), color);
      const images = { ...initialState.current.imageSettings };
      for (const key of Object.keys(images)) if (settings[key] !== undefined) images[key] = settings[key];
      if (images.namingMethod === 'datetime') images.namingMethod = 'localDateTime';
      setPageColors(colors); setSavedPageColors(colors);
      setImageSettings(images); setSavedImages(images);
      if (settings.locale) setLocale(settings.locale);
      reloadFromStorage();
      window.dispatchEvent(new CustomEvent('themeUpdate', { detail: { pageColors: colors } }));
      window.dispatchEvent(new CustomEvent('imageSettingsUpdate', { detail: images }));
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [reloadFromStorage, setLocale, loadAttempt]);

  useEffect(() => {
    const updateSource = (event) => {
      setImageSettings((current) => ({ ...current, inspirationSource: event.detail }));
      setSavedImages((current) => ({ ...current, inspirationSource: event.detail }));
    };
    window.addEventListener('novelai:gallery-source', updateSource);
    return () => window.removeEventListener('novelai:gallery-source', updateSource);
  }, []);

  const colorsValid = [
    ...Object.values(primaryColors),
    ...Object.values(backgroundColors).flatMap(Object.values),
    ...Object.values(pageColors),
  ].every(isValidColor);
  const dirty = JSON.stringify(themeSettings) !== JSON.stringify(savedSettings)
    || JSON.stringify(imageSettings) !== JSON.stringify(savedImages)
    || JSON.stringify(pageColors) !== JSON.stringify(savedPageColors);
  const selectedPreset = THEME_PRESETS.find((preset) => preset.mode === mode
    && preset.primary.toLowerCase() === primaryColors[mode].toLowerCase()
    && Object.entries(preset.background).every(([key, value]) => value.toLowerCase() === backgroundColors[mode][key].toLowerCase()));

  // 应用侧栏也能切换亮暗模式；同步模式，同时保留正在微调的颜色。
  useEffect(() => {
    setThemeDraft((current) => current ? { ...current, mode: savedSettings.mode } : null);
  }, [savedSettings]);

  // 无效的输入保留在表单里；用户打字途中仍显示上一次有效预览。
  useEffect(() => {
    if (active && colorsValid) previewTheme(themeDraft);
  }, [active, colorsValid, themeDraft, previewTheme]);

  // 主工作区保留隐藏标签的组件，因此切走标签也要撤掉未保存的预览。
  useEffect(() => {
    if (!active) previewTheme(null);
    return () => previewTheme(null);
  }, [active, previewTheme]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section]);

  useEffect(() => {
    if (sectionRequest) setSection(sectionRequest.section);
  }, [sectionRequest]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const settings = { themeMode: mode, pageColors, locale, animationEnabled, animationSpeed, ...imageSettings };
      for (const colorMode of ['light', 'dark']) {
        const suffix = colorMode === 'light' ? 'Light' : 'Dark';
        settings[`themePrimary${suffix}`] = primaryColors[colorMode];
        for (const [key, color] of Object.entries(backgroundColors[colorMode])) {
          settings[`themeBackground${key[0].toUpperCase()}${key.slice(1)}${suffix}`] = color;
        }
      }
      // 先确认后端保存成功，失败时保留草稿，避免页面误报已保存。
      await apiClient.saveLocalSettings(settings);
      localStorage.setItem('themeMode', mode);
      for (const colorMode of ['light', 'dark']) {
        const suffix = colorMode === 'light' ? 'Light' : 'Dark';
        localStorage.setItem(`themePrimary${suffix}`, primaryColors[colorMode]);
        for (const [key, color] of Object.entries(backgroundColors[colorMode])) {
          localStorage.setItem(`themeBackground${key[0].toUpperCase()}${key.slice(1)}${suffix}`, color);
        }
      }
      Object.entries(pageColors).forEach(([id, color]) => localStorage.setItem(getPageColorStorageKey(id), color));
      localStorage.setItem('animationEnabled', String(animationEnabled));
      localStorage.setItem('animationSpeed', String(animationSpeed));
      Object.entries(imageSettings).forEach(([key, value]) => localStorage.setItem(key, String(value)));
      // 后端输出和浏览器下载继续共用现有命名字段。
      const downloadSettings = { ...imageSettings, fileNameSuffix: '', randomStringLength: 8, includeDateInName: false, dateFormat: 'yyyyMMdd_HHmmss' };
      for (const key of ['fileNameSuffix', 'randomStringLength', 'includeDateInName', 'dateFormat']) {
        localStorage.setItem(key, String(downloadSettings[key]));
      }
      window.dispatchEvent(new CustomEvent('themeUpdate', { detail: { ...themeSettings, pageColors } }));
      window.dispatchEvent(new CustomEvent('imageSettingsUpdate', { detail: downloadSettings }));
      window.dispatchEvent(new CustomEvent('novelai:gallery-source', { detail: imageSettings.inspirationSource }));
      setThemeDraft(null);
      setSavedImages(imageSettings);
      setSavedPageColors(pageColors);
      setSnackbar({ severity: 'success', message: t('settings.savedMessage') });
    } catch {
      setSnackbar({ severity: 'error', message: t('settings.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = () => {
    setThemeDraft(DEFAULT_THEME_SETTINGS);
    setPageColors(Object.fromEntries(pages.map((page) => [page.id, PAGE_COLOR_DEFAULTS[page.id] || page.color])));
    setImageSettings({ ...imageSettings, fileNamePrefix: 'AI_Image', namingMethod: 'seed' });
    setSnackbar({ severity: 'info', message: t('settings.resetMessage') });
  };

  const fileNamePreview = generateFileName({
    seed: '1234567890', prompt: 'Golden Hour Portrait of a girl in a city garden', id: 'preview',
  }, imageSettings);

  return <Paper elevation={0} sx={{
    height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
    borderRadius: 0, overflow: 'hidden', bgcolor: 'background.default',
  }}>
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', sm: 'row' } }}>
      <Box component="nav" aria-label={t('settings.navigation')} sx={{
        width: { xs: '100%', sm: 210, lg: 232 }, flexShrink: 0, minHeight: 0,
        bgcolor: 'background.paper', borderRight: { sm: `1px solid ${theme.palette.divider}` },
        borderBottom: { xs: `1px solid ${theme.palette.divider}`, sm: 0 },
        display: 'flex', flexDirection: 'column', py: { xs: 0, sm: 3 },
      }}>
        <Box sx={{ px: 2.5, mb: 3, display: { xs: 'none', sm: 'block' } }}>
          <Typography variant="h6">{t('settings.title')}</Typography>
          <Typography variant="caption" color="text.secondary">{t('settings.localSettings')}</Typography>
        </Box>
        <Tabs value={section} onChange={(_, value) => setSection(value)}
          orientation={mobile ? 'horizontal' : 'vertical'} variant="scrollable" scrollButtons="auto"
          aria-label={t('settings.navigation')}
          sx={{
            px: { xs: 0.5, sm: 1.5 }, minHeight: 48,
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              minHeight: 48, minWidth: { xs: 112, sm: 0 }, maxWidth: 'none',
              justifyContent: { xs: 'center', sm: 'flex-start' }, borderRadius: 1.5,
              px: 1.5, mb: { xs: 0, sm: 0.75 }, gap: 1, color: 'text.secondary',
              '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', fontWeight: 650 },
              '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
              '& .MuiTab-iconWrapper': { mb: 0, mr: 0, fontSize: 20 },
            },
          }}>
          {sections.map((item) => <Tab key={item.id} value={item.id} icon={item.icon} iconPosition="start"
            id={`settings-tab-${item.id}`} aria-controls={`settings-panel-${item.id}`}
            label={t(`settings.sections.${item.id}.title`)} />)}
        </Tabs>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 'auto', px: 3, pt: 3, display: { xs: 'none', sm: 'block' } }}>
          {t('settings.sidebarHint')}
        </Typography>
      </Box>

      <Box ref={contentRef} role="tabpanel" id={`settings-panel-${section}`}
        aria-labelledby={`settings-tab-${section}`} tabIndex={0}
        sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', p: { xs: 2, md: 3.5, xl: 4 } }}>
        {loadError && <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => setLoadAttempt((n) => n + 1)}>{t('common.retry')}</Button>}>{t('settings.loadFailed')}</Alert>}
        <Box component="fieldset" disabled={!loaded || saving} sx={{ border: 0, m: 0, p: 0, minWidth: 0, maxWidth: 1080, mx: 'auto' }}>
          <Box sx={{ mb: 3 }}>
            <Typography variant="h5" sx={{ mb: 0.75 }}>{t(`settings.sections.${section}.title`)}</Typography>
            <Typography variant="body2" color="text.secondary">{t(`settings.sections.${section}.description`)}</Typography>
          </Box>

          {section === 'appearance' && <Stack spacing={2.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
              <Box>
                <Typography variant="subtitle2">{t('settings.colorSchemes')}</Typography>
                <Typography variant="caption" color="text.secondary">{t('settings.currentScheme', { name: selectedPreset?.name || t('common.custom') })}</Typography>
              </Box>
              <ToggleButtonGroup exclusive size="small" value={mode} aria-label={t('settings.themeMode')}
                onChange={(_, value) => { if (value) setThemeDraft({ ...themeSettings, mode: value }); }}>
                <ToggleButton value="dark" aria-label={t('main.darkMode')} sx={{ gap: 0.75 }}><DarkModeOutlined fontSize="small" />{t('main.darkMode')}</ToggleButton>
                <ToggleButton value="light" aria-label={t('main.lightMode')} sx={{ gap: 0.75 }}><LightModeOutlined fontSize="small" />{t('main.lightMode')}</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>
              {THEME_PRESETS.filter((preset) => preset.mode === mode).map((preset) => {
                const selected = selectedPreset?.id === preset.id;
                const textColor = theme.palette.text.primary;
                return <ButtonBase key={preset.id} aria-label={preset.name} aria-pressed={selected}
                  onClick={() => setThemeDraft({
                    ...themeSettings, mode: preset.mode,
                    primaryColors: { ...primaryColors, [preset.mode]: preset.primary },
                    backgroundColors: { ...backgroundColors, [preset.mode]: preset.background },
                  })}
                  sx={{
                    display: 'block', textAlign: 'left', borderRadius: 2, overflow: 'hidden',
                    color: textColor, bgcolor: preset.background.paper,
                    border: '2px solid', borderColor: selected ? preset.primary : 'transparent',
                    boxShadow: `0 0 0 1px ${alpha(textColor, 0.12)}`,
                    '&:hover': { borderColor: preset.primary },
                    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 3 },
                  }}>
                  <Box aria-hidden sx={{ p: 1.5, bgcolor: preset.background.default }}>
                    <Box sx={{ height: 54, display: 'flex', borderRadius: 0.75, overflow: 'hidden' }}>
                      <Stack spacing={0.6} sx={{ width: 27, p: 0.75, bgcolor: preset.background.drawer }}>
                        {[0, 1, 2].map((line) => <Box key={line} sx={{ height: 4, borderRadius: 0.5, bgcolor: alpha(textColor, line === 0 ? 0.7 : 0.16) }} />)}
                      </Stack>
                      <Box sx={{ flex: 1, bgcolor: preset.background.paper, p: 1 }}>
                        <Box sx={{ height: 4, width: '45%', bgcolor: alpha(textColor, 0.8), mb: 0.75 }} />
                        <Box sx={{ height: 4, width: '75%', bgcolor: alpha(textColor, 0.15), mb: 0.75 }} />
                        <Box sx={{ height: 11, width: 27, bgcolor: preset.primary, borderRadius: 0.5, ml: 'auto' }} />
                      </Box>
                    </Box>
                  </Box>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.25, py: 0.9, borderTop: `1px solid ${alpha(textColor, 0.1)}`, gap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 650, fontSize: { xs: 12, sm: 13 } }}>{preset.name}</Typography>
                    <Box sx={{ bgcolor: selected ? preset.primary : alpha(textColor, 0.15), width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                      {selected && <Check sx={{ fontSize: 14, color: theme.palette.getContrastText(preset.primary) }} />}
                    </Box>
                  </Stack>
                </ButtonBase>;
              })}
            </Box>
            <Accordion disableGutters sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important', bgcolor: 'background.paper' }}>
              <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="subtitle2">{t('settings.customizeScheme')}</Typography></AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('settings.customizeHint')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                  <ColorField label={t('settings.primaryColor')} value={primaryColors[mode]}
                    onChange={(color) => setThemeDraft({ ...themeSettings, primaryColors: { ...primaryColors, [mode]: color } })} />
                  {['default', 'paper', 'drawer'].map((key, index) => <ColorField key={key}
                    label={t(['settings.mainBackground', 'settings.cardBackground', 'settings.drawerBackground'][index])}
                    value={backgroundColors[mode][key]}
                    onChange={(color) => setThemeDraft({ ...themeSettings, backgroundColors: { ...backgroundColors, [mode]: { ...backgroundColors[mode], [key]: color } } })} />)}
                </Box>
              </AccordionDetails>
            </Accordion>
          </Stack>}

          {section === 'pages' && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            {pages.map((page) => <Paper key={page.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}>
                {page.icon}
                <Typography variant="subtitle2">{page.labelKey ? t(page.labelKey) : page.title}</Typography>
              </Stack>
              <ColorField label={t('settings.primaryColor')} value={pageColors[page.id] || page.color}
                onChange={(color) => setPageColors({ ...pageColors, [page.id]: color })} />
            </Paper>)}
          </Box>}

          {section === 'interface' && <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
              <Box><Typography variant="subtitle1">{t('settings.interfaceAnimation')}</Typography>
                <Typography variant="body2" color="text.secondary">{t('settings.animationDescription')}</Typography></Box>
              <Switch checked={animationEnabled} inputProps={{ 'aria-label': t('settings.interfaceAnimation') }}
                onChange={(event) => setThemeDraft({ ...themeSettings, animationEnabled: event.target.checked })} />
            </Stack>
            <Box sx={{ mt: 4, maxWidth: 520 }}>
              <Typography id="animation-duration-label" variant="body2">{t('settings.transitionSpeed', { speed: animationSpeed })}</Typography>
              <Slider value={animationSpeed} min={100} max={500} step={50} disabled={!animationEnabled}
                aria-labelledby="animation-duration-label" valueLabelDisplay="auto"
                onChange={(_, value) => setThemeDraft({ ...themeSettings, animationSpeed: value })}
                marks={[{ value: 100, label: t('common.fast') }, { value: 500, label: t('common.slow') }]}
                sx={{ width: 'calc(100% - 24px)', mx: 1.5, mt: 2 }} />
            </Box>
          </Paper>}

          {section === 'gallery' && <Stack spacing={2.5}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <TextField fullWidth size="small" label={t('librarySettings.outputDirectory')}
                value={imageSettings.outputDirectory}
                onChange={(event) => setImageSettings({ ...imageSettings, outputDirectory: event.target.value })}
                helperText={t('librarySettings.outputHint')} sx={{ mb: 2 }} />
              <GallerySourceSelect value={imageSettings.inspirationSource}
                onChange={(value) => setImageSettings({ ...imageSettings, inspirationSource: value })} />
              <Alert severity="info" sx={{ mt: 2 }}>{t('librarySettings.localOnly')}</Alert>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Typography variant="subtitle1">{t('settings.filenameRules')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{t('settings.downloadSharedRule')}</Typography>
              <TextField label={t('settings.customPrefix')} value={imageSettings.fileNamePrefix} fullWidth size="small"
                onChange={(event) => setImageSettings({ ...imageSettings, fileNamePrefix: event.target.value })}
                helperText={t('settings.prefixExample')} />
              <RadioGroup value={imageSettings.namingMethod} aria-label={t('settings.downloadPreset')}
                onChange={(event) => setImageSettings({ ...imageSettings, namingMethod: event.target.value })}
                sx={{ my: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                {DOWNLOAD_NAMING_METHODS.map((method) => <FormControlLabel key={method.value} value={method.value}
                  control={<Radio size="small" />} label={t(`settings.naming.${method.value}`)} />)}
              </RadioGroup>
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'background.default', border: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">{t('settings.filenamePreview')}</Typography>
                <Typography variant="body2" sx={{ mt: 0.5, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{fileNamePreview}</Typography>
              </Box>
            </Paper>
          </Stack>}
        </Box>
      </Box>
    </Box>

    {/* 底栏属于工作区自身，不再猜测应用侧栏宽度，也不会遮住滚动内容。 */}
    <Box component="footer" sx={{
      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 1.5, px: { xs: 2, sm: 3 }, py: 1.5, pb: 'max(12px, env(safe-area-inset-bottom))',
      borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper',
    }}>
      <Chip size="small" variant="outlined" label={t(dirty ? 'settings.unsaved' : 'settings.upToDate')}
        sx={{ display: { xs: 'none', sm: 'inline-flex' }, borderColor: 'divider', color: dirty ? 'primary.main' : 'text.secondary' }} />
      <Stack direction="row" gap={1} sx={{ ml: 'auto' }}>
        {dirty && <Button disabled={saving} onClick={() => {
          setThemeDraft(null); setPageColors(savedPageColors); setImageSettings(savedImages);
        }}>{t('settings.discard')}</Button>}
        <Button startIcon={<Refresh />} disabled={!loaded || saving} onClick={resetSettings} color="inherit">{t('settings.reset')}</Button>
        <Button variant="contained" startIcon={<SaveOutlined />} disabled={!loaded || saving || !dirty || !colorsValid} onClick={saveSettings}>{t('settings.save')}</Button>
      </Stack>
    </Box>
    <Snackbar open={Boolean(snackbar)} autoHideDuration={4000} onClose={() => setSnackbar(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      {snackbar && <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(null)} sx={{ mb: 8 }}>{snackbar.message}</Alert>}
    </Snackbar>
  </Paper>;
}
