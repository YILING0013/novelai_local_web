"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Tooltip, createFilterOptions, Autocomplete, Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, ButtonBase,
  Chip, FormControlLabel, IconButton, InputAdornment, Paper, Radio, RadioGroup, Slider,
  Snackbar, Stack, Switch, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup,
  Typography, useMediaQuery, useTheme, alpha,
} from '@mui/material';
import {
  WebOutlined, ShortTextOutlined, KeyboardOutlined, TextFieldsOutlined, PhotoOutlined, HistoryOutlined, VisibilityOffOutlined, SearchOutlined, Clear, DownloadOutlined, ArrowBack, Check, DarkModeOutlined, ExpandMore, FolderOpenOutlined, InfoOutlined, LightModeOutlined,
  PaletteOutlined, Refresh, SaveOutlined, SpeedOutlined, TuneOutlined,
} from '@mui/icons-material';
import { generateFileName, DEFAULT_FILE_NAME_TEMPLATE, FILE_NAME_TEMPLATE_TOKENS, DOWNLOAD_NAMING_METHODS } from '@/components/ai-painting/tools/ImageTools/ImageSaveUtils';
import GallerySourceSelect from '@/components/gallery/GallerySourceSelect';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import { PAGE_COLOR_DEFAULTS, getPageColorStorageKey } from '@/i18n/pageConfig.mjs';
import { DEFAULT_THEME_SETTINGS, THEME_PRESETS } from '@/providers/themePresets.mjs';
import { useAppTheme } from '@/providers/AppThemeProvider';
import TagSuggestionSettings from './TagSuggestionSettings';
import usePromptEditorSettings from '@/components/ai-painting/PromptEditor/usePromptEditorSettings';
import { invalidPromptSyntaxSymbols } from '@/components/ai-painting/PromptEditor/promptTagCompletion.mjs';
import { readImagePreviewSettings, writeImagePreviewSettings, transparencyBackgroundSx, transparencyBackgrounds } from '@/components/ai-painting/tools/ImageTools/previewImageExport';
import { defaultWorkspaceShortcuts, formatWorkspaceShortcut, getWorkspaceShortcut } from '@/components/ai-painting/tools/ImageTools/workspaceShortcuts.mjs';
import { SettingsGroup, SettingsRow, SettingsSelect } from './SettingsRows';
import MobileSettingsList from './MobileSettingsList';

const sections = [
  { id: 'interface', icon: <WebOutlined />, search: ['display', 'expandedImageShortcuts', 'displayImageDrag', 'centerNewGeneration',
    'lockedGestureNavigation', 'transparencyBackground', 'history', 'historyImageDrag', 'historyFollowSelection', 'historyImageFit',
    'privacy', 'privacyMode', 'privacyScope', 'privacyReveal', 'bottomBar', 'showAdjustmentEntry', 'showGalleryEntry']
    .map((key) => `settings.interface.${key}`) },
  { id: 'appearance', icon: <PaletteOutlined />, search: ['settings.colorSchemes', 'settings.primaryColor', 'settings.customizeScheme',
    'settings.pageColors', 'settings.interfaceAnimation'] },
  { id: 'prompt', icon: <ShortTextOutlined />, search: ['suggestions', 'suggestionsEnabled', 'suggestionLimit', 'suggestionLayout',
    'suggestionTextLayout', 'suggestionSyntax', 'syntaxSymbols', 'preview', 'inlinePreview',
    'expandedPreview', 'overlayPreview', 'translationEnabled', 'translationUnderline', 'translationTarget', 'weighting',
    'weightShortcutsEnabled', 'keepWeightSelection', 'defaultWeightMode', 'weightStep', 'formatting', 'autoFormat',
    'normalizeCommas', 'replaceUnderscores', 'trailingComma'].map((key) => `settings.prompt.${key}`) },
  { id: 'shortcuts', icon: <KeyboardOutlined />, search: ['canvas', ...Object.keys(defaultWorkspaceShortcuts), 'restore']
    .map((key) => `settings.shortcuts.${key}`) },
  { id: 'gallery', icon: <FolderOpenOutlined />, search: ['librarySettings.outputDirectory','settings.showInspirationGallery','settings.filenameRules','settings.customPrefix','settings.downloadPreset','settings.fileNameTemplate','settings.filenamePreview'] },
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
export default function SettingsPage({ pages = [], active = true, sectionRequest = null, chooseDirectory, fixedOutputDirectory = false, desktopPreferences, onDirtyChange, mobileLayout: nativeMobile = false, onSectionChange, onBack, appVersion }) {
  const theme = useTheme();
  const { t, locale, setLocale } = useI18n();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const mobileLayout = nativeMobile || mobile;
  const { savedSettings, previewTheme, reloadFromStorage } = useAppTheme();
  const [selectedSection, setSection] = useState(null);
  const section = selectedSection || (mobileLayout ? null : desktopPreferences ? 'desktop' : 'appearance');
  const promptSettings = usePromptEditorSettings();
  const [interfaceDraft, setInterfaceDraft] = useState({});
  const [shortcutError, setShortcutError] = useState(null);
  const [recordingShortcut, setRecordingShortcut] = useState(null);
  const interfaceSettings = { ...readImagePreviewSettings(), ...interfaceDraft };
  const [promptDraft, setPromptDraft] = useState(null);
  const editedPrompt = { ...promptSettings, ...promptDraft };
  const invalidSymbols = invalidPromptSyntaxSymbols(editedPrompt.suggestionSyntax);
  const [themeDraft, setThemeDraft] = useState(null);
  const themeSettings = themeDraft || savedSettings;
  const { mode, primaryColors, backgroundColors, animationEnabled, animationSpeed } = themeSettings;
  const [pageColors, setPageColors] = useState(() => Object.fromEntries(pages.map((page) => [
    page.id, localStorage.getItem(getPageColorStorageKey(page.id)) || page.color,
  ])));
  const [inspirationVisible, setInspirationVisible] = useState(false);
  useEffect(() => { setInspirationVisible(localStorage.getItem('novelai:inspiration-visible') === 'true'); }, []);
  const [imageSettings, setImageSettings] = useState(() => ({
    outputDirectory: '',
    inspirationSource: 'default',
    fileNamePrefix: localStorage.getItem('fileNamePrefix') || 'AI_Image',
    keepImageHistory: localStorage.getItem('keepImageHistory') === 'true',
    fileNameTemplate: localStorage.getItem('fileNameTemplate') || DEFAULT_FILE_NAME_TEMPLATE,
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
        if (desktopPreferences && key === 'themeMode' && localStorage.getItem(key)) continue;
        if (key.startsWith('theme') || ['animationEnabled', 'animationSpeed', 'fileNamePrefix', 'namingMethod', 'fileNameTemplate', 'keepImageHistory'].includes(key)) {
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
      if (!desktopPreferences && settings.locale) setLocale(settings.locale);
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
  const dirty = Object.keys(interfaceDraft).length > 0 || Boolean(promptDraft) || JSON.stringify(themeSettings) !== JSON.stringify(savedSettings)
    || JSON.stringify(imageSettings) !== JSON.stringify(savedImages)
    || JSON.stringify(pageColors) !== JSON.stringify(savedPageColors);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
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

  const aboutTitle = locale === 'zh-CN' ? '关于' : 'About';
  const accessibleSectionTitle = section === 'about' ? aboutTitle
    : section === 'desktop' ? t('desktop.application') : section ? t(`settings.sections.${section}.title`) : '';

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
      if (Object.keys(interfaceDraft).length) writeImagePreviewSettings(interfaceDraft);
      setInterfaceDraft({});
      if (promptDraft) promptSettings.updateSettings(promptDraft);
      setPromptDraft(null);
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
    setImageSettings({ ...imageSettings, fileNamePrefix: 'AI_Image', namingMethod: 'seed', fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE });
    setSnackbar({ severity: 'info', message: t('settings.resetMessage') });
  };

  const [detail, setDetail] = useState(null);
  useEffect(() => { setDetail(null); }, [section]);
  const motion = (ms) => (animationEnabled ? `${ms}ms` : '0ms');
  const showDetail = (event) => {
    const target = event.target.closest?.('[data-setting-help]');
    if (target && target.dataset.setting !== detail?.label) {
      setDetail({ label: target.dataset.setting, help: target.dataset.settingHelp });
    }
  };

  const changedInterface = Object.keys(interfaceDraft);
  const changedPrompt = Object.keys(promptDraft || {});
  const [searchText, setSearchText] = useState('');
  const [highlight, setHighlight] = useState(null);
  const primary = theme.palette.primary.main;
  const sectionTitle = (id) => t(`settings.sections.${id}.title`);
  const searchOptions = sections.flatMap((item) => item.search.map((key) => ({ section: item.id, label: t(key) })));
  useEffect(() => {
    if (!highlight) return undefined;
    const frame = requestAnimationFrame(() => {
      const target = contentRef.current?.querySelector(`[data-setting="${CSS.escape(highlight.label)}"]`);
      setHighlight(null);
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: animationEnabled ? 'smooth' : 'auto' });
      target.animate([{ offset: 0, backgroundColor: alpha(primary, 0.2) }], { duration: animationEnabled ? 1800 : 1, easing: 'ease-out' });
      if (target.dataset.settingHelp) setDetail({ label: target.dataset.setting, help: target.dataset.settingHelp });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlight, animationEnabled, primary]);

  const updateInterface = (key, value) => {
    setInterfaceDraft((draft) => {
      const next = { ...draft };
      if (value === readImagePreviewSettings()[key]) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  const interfaceLabel = (key) => t(`settings.interface.${key}`);
  const interfaceSwitches = (keys) => keys.map((key) => <SettingsRow key={key} label={interfaceLabel(key)}
    description={interfaceLabel(`help.${key}`)} changed={changedInterface.includes(key)}>
    <Switch checked={interfaceSettings[key]} slotProps={{ input: { 'aria-label': interfaceLabel(key) } }}
      onChange={(_, checked) => updateInterface(key, checked)} />
  </SettingsRow>);
  const promptLabel = (key) => t(`settings.prompt.${key}`);
  const promptSwitches = (keys, disabled = false) => keys.map((key) => <SettingsRow key={key} label={promptLabel(key)}
    description={promptLabel(`help.${key}`)} changed={changedPrompt.includes(key)}>
    <Switch checked={prompt[key]} disabled={disabled} slotProps={{ input: { 'aria-label': promptLabel(key) } }}
      onChange={(_, checked) => setPromptDraft((draft) => ({ ...draft, [key]: checked }))} />
  </SettingsRow>);

  const recordShortcut = (event, key) => {
    // Esc 结束录入；焦点回到设置内容区，之后仍可用 Ctrl+S 保存。
    if (event.key === 'Escape') {
      contentRef.current?.focus({ preventScroll: true });
      return;
    }
    const shortcut = getWorkspaceShortcut(event);
    if (!shortcut || event.repeat || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    const duplicate = Object.keys(defaultWorkspaceShortcuts).find((action) => action !== key && interfaceSettings[action] === shortcut);
    if (duplicate) {
      setShortcutError({ key, duplicate });
      return;
    }
    setShortcutError(null);
    setRecordingShortcut({ key, recorded: true });
    updateInterface(key, shortcut);
  };

  const search = <Autocomplete
          size="small" options={searchOptions} value={null} inputValue={searchText} blurOnSelect
          onInputChange={(_, value, reason) => setSearchText(reason === 'reset' ? '' : value)}
          onChange={(_, option) => {
            if (!option) return;
            setSection(option.section); onSectionChange?.(option.section);
            setHighlight({ label: option.label });
          }}
          groupBy={(option) => sectionTitle(option.section)}
          getOptionLabel={(option) => option.label}
          // 同时匹配分区名，例如输入“快捷键”可列出该分区的全部设置。
          filterOptions={createFilterOptions({ stringify: (option) => `${option.label} ${sectionTitle(option.section)}` })}
          noOptionsText={t('settings.searchEmpty')}
          popupIcon={null}
          slotProps={{ paper: { sx: {
            mt: 0.5, borderRadius: 1.5, border: 1, borderColor: 'divider', boxShadow: 'none',
            '& .MuiAutocomplete-groupLabel': { lineHeight: '30px', fontSize: 12, fontWeight: 700, color: 'primary.main', bgcolor: 'background.paper' },
          } } }}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return <li key={`${option.section}:${option.label}:${key}`} {...optionProps}>{option.label}</li>;
          }}
          sx={{ px: { xs: 1.5, sm: 1.75 }, mb: { xs: 0.75, sm: 1.5 } }}
          renderInput={(params) => <TextField {...params} placeholder={t('settings.searchPlaceholder')}
            InputProps={{
              ...params.InputProps,
              startAdornment: <InputAdornment position="start"><SearchOutlined sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment>,
            }}
            inputProps={{ ...params.inputProps, 'aria-label': t('settings.searchPlaceholder') }} />}
        />;

  const fileNamePreview = generateFileName({
    seed: '1234567890', prompt: 'Golden Hour Portrait of a girl in a city garden', id: 'preview',
  }, imageSettings);

  return <Paper elevation={0} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
      event.preventDefault();
      if (dirty && loaded && !saving && colorsValid && !invalidSymbols.length) void saveSettings();
    }
  }} sx={{
    height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
    borderRadius: 0, overflow: 'hidden', bgcolor: 'background.default',
  }}>
    {mobileLayout && <Stack data-mobile-settings-header direction="row" alignItems="center" spacing={1}
      sx={{ px: 1, minHeight: section ? 56 : 48, borderBottom: 1, borderColor: 'divider', flexShrink: 0, bgcolor: section ? 'background.paper' : undefined }}>
      <IconButton aria-label={section ? (locale === 'zh-CN' ? '返回设置' : 'Back to settings') : t('common.back')}
        onClick={() => { if (section) { setSection(null); onSectionChange?.(null); } else void onBack?.(); }}><ArrowBack /></IconButton>
      <Typography id="settings-section-title" variant="h6">{section ? accessibleSectionTitle : t('settings.title')}</Typography>
    </Stack>}
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: mobileLayout ? 'column' : { xs: 'column', sm: 'row' } }}>
      {mobileLayout && !section && <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: 680, mx: 'auto' }}>
          <Typography color="text.secondary" sx={{ mb: 3 }}>{t('settings.localSettings')}</Typography>
          <Box sx={{ mb: 2 }}>{search}</Box>
          <MobileSettingsList label={t('settings.navigation')} items={[
            ...sections.map((item) => ({ ...item, label: t(`settings.sections.${item.id}.title`), description: t(`settings.sections.${item.id}.description`) })),
            { id: 'about', icon: <InfoOutlined />, label: aboutTitle, description: ['NovelAI Local', appVersion].filter(Boolean).join(' · ') },
          ]} onSelect={(value) => { setSection(value); onSectionChange?.(value); }} />
        </Box>
      </Box>}
      {!mobileLayout && <Box component="nav" aria-label={t('settings.navigation')} sx={{
        width: { xs: '100%', sm: 210, lg: 232 }, flexShrink: 0, minHeight: 0,
        bgcolor: 'background.paper', borderRight: { sm: `1px solid ${theme.palette.divider}` },
        borderBottom: { xs: `1px solid ${theme.palette.divider}`, sm: 0 },
        display: 'flex', flexDirection: 'column', py: { xs: 0, sm: 3 },
      }}>
        <Box sx={{ px: 2.5, mb: 3, display: { xs: 'none', sm: 'block' } }}>
          <Typography variant="h6">{t('settings.title')}</Typography>
          <Typography variant="caption" color="text.secondary">{t('settings.localSettings')}</Typography>
        </Box>
        <Box sx={{ px: 1.5, mb: 1 }}>{search}</Box>
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
          {desktopPreferences && <Tab value="desktop" id="settings-tab-desktop" aria-controls="settings-panel-desktop"
            icon={<TuneOutlined />} iconPosition="start" label={t('desktop.application')} />}
          {sections.map((item) => <Tab key={item.id} value={item.id} icon={item.icon} iconPosition="start"
            id={`settings-tab-${item.id}`} aria-controls={`settings-panel-${item.id}`}
            label={t(`settings.sections.${item.id}.title`)} />)}
        </Tabs>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 'auto', px: 3, pt: 3, display: { xs: 'none', sm: 'block' } }}>
          {t('settings.sidebarHint')}
        </Typography>
      </Box>}

      {(!mobileLayout || section) && <Box ref={contentRef} role={mobileLayout ? 'region' : 'tabpanel'} id={`settings-panel-${section}`}
        aria-labelledby={mobileLayout ? 'settings-section-title' : `settings-tab-${section}`} tabIndex={mobileLayout ? -1 : 0}
        sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', p: { xs: 2, md: 3.5, xl: 4 } }}>
        {loadError && <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => setLoadAttempt((n) => n + 1)}>{t('common.retry')}</Button>}>{t('settings.loadFailed')}</Alert>}
        {section === 'about' ? <Stack spacing={1} sx={{ maxWidth: 1080, mx: 'auto' }}>
          <Typography variant="h6">NovelAI Local</Typography>
          {appVersion && <Typography>{locale === 'zh-CN' ? '版本' : 'Version'} {appVersion}</Typography>}
          <Button component="a" href="https://github.com/YILING0013/novelai_local_web" sx={{ alignSelf: 'flex-start' }}>
            {locale === 'zh-CN' ? '开源仓库' : 'Source repository'}
          </Button>
        </Stack> : section === 'desktop' ? desktopPreferences : (
        <Box component="fieldset" disabled={!loaded || saving} sx={{ border: 0, m: 0, p: 0, minWidth: 0, maxWidth: 1080, mx: 'auto' }}>
        <Box key={section} sx={{
          maxWidth: 1100, mx: 'auto', display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 260px' }, columnGap: 5,
          animation: animationEnabled ? `settingsSectionEnter ${animationSpeed}ms ease-out` : 'none',
          '@keyframes settingsSectionEnter': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        }}>
          <Box sx={{ minWidth: 0 }} onMouseOver={showDetail} onFocus={showDetail}>
          <Box sx={{ mb: 3 }}>
            {!mobileLayout && <Typography variant="h5" sx={{ mb: 0.75 }}>{accessibleSectionTitle}</Typography>}
            <Typography variant="body2" color="text.secondary">{t(`settings.sections.${section}.description`)}</Typography>
          </Box>

            {section === 'interface' && <Stack spacing={4}>
              <SettingsGroup title={interfaceLabel('display')} icon={<PhotoOutlined />}>
                {interfaceSwitches(['expandedImageShortcuts', 'displayImageDrag', 'centerNewGeneration', 'lockedGestureNavigation'])}
                <SettingsRow label={interfaceLabel('transparencyBackground')} description={interfaceLabel('help.transparencyBackground')}
                  changed={changedInterface.includes('transparencyBackground')} wide>
                  <Stack direction="row" alignItems="stretch" gap={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <SettingsSelect label={interfaceLabel('transparencyBackground')} value={interfaceSettings.transparencyBackground}
                        onChange={(value) => updateInterface('transparencyBackground', value)}
                        options={transparencyBackgrounds.map((color) => [color, interfaceLabel(`backgrounds.${color}`)])} />
                    </Box>
                    <Box aria-hidden sx={{
                      width: 38, flexShrink: 0, border: 1, borderColor: 'divider', borderRadius: 1,
                      ...transparencyBackgroundSx(interfaceSettings, theme),
                    }} />
                  </Stack>
                </SettingsRow>
                {interfaceSettings.transparencyBackground === 'custom' && <SettingsRow label={interfaceLabel('customColor')}
                  description={interfaceLabel('help.customColor')} changed={changedInterface.includes('transparencyCustomColor')} wide>
                  <TextField size="small" fullWidth type="color" value={interfaceSettings.transparencyCustomColor}
                    slotProps={{ htmlInput: { 'aria-label': interfaceLabel('customColor') } }}
                    onChange={(event) => updateInterface('transparencyCustomColor', event.target.value)} />
                </SettingsRow>}
              </SettingsGroup>
              <SettingsGroup title={interfaceLabel('history')} icon={<HistoryOutlined />}>
                {interfaceSwitches(['historyImageDrag', 'historyFollowSelection'])}
                <SettingsRow label={interfaceLabel('historyImageFit')} description={interfaceLabel('help.historyImageFit')}
                  changed={changedInterface.includes('historyImageFit')} wide>
                  <SettingsSelect label={interfaceLabel('historyImageFit')} value={interfaceSettings.historyImageFit}
                    options={['contain', 'cover'].map((key) => [key, interfaceLabel(`fitOptions.${key}`)])}
                    onChange={(value) => updateInterface('historyImageFit', value)} />
                </SettingsRow>
              </SettingsGroup>
              <SettingsGroup title={interfaceLabel('privacy')} icon={<VisibilityOffOutlined />}>
                {interfaceSwitches(['privacyMode'])}
                {Object.entries({ privacyScope: ['both', 'display', 'history'], privacyReveal: ['hold', 'hover', 'toggle'] })
                  .map(([key, values]) => <SettingsRow key={key} label={interfaceLabel(key)} description={interfaceLabel(`help.${key}`)}
                    changed={changedInterface.includes(key)} wide>
                    <SettingsSelect label={interfaceLabel(key)} value={interfaceSettings[key]}
                      options={values.map((value) => [value, interfaceLabel(`${key}Options.${value}`)])}
                      onChange={(value) => updateInterface(key, value)} />
                  </SettingsRow>)}
              </SettingsGroup>
              <SettingsGroup title={interfaceLabel('bottomBar')} icon={<WebOutlined />}>
                {interfaceSwitches(['showAdjustmentEntry', 'showGalleryEntry'])}
              </SettingsGroup>
            </Stack>}

            {section === 'prompt' && <Stack spacing={4}>
              <SettingsGroup title={promptLabel('suggestions')} icon={<ShortTextOutlined />}>
                <TagSuggestionSettings settings={editedPrompt} saved={promptSettings} invalidSymbols={invalidSymbols}
                  onChange={(key, value) => setPromptDraft((draft) => ({ ...draft, [key]: value }))} />
              </SettingsGroup>
              <SettingsGroup title={promptLabel('preview')} icon={<PhotoOutlined />}>
                {promptSwitches(['inlinePreview'])}
                <SettingsRow label={promptLabel('expandedPreview')} description={promptLabel('help.expandedPreview')}
                  changed={changedPrompt.includes('expandedPreview')} wide>
                  <SettingsSelect label={promptLabel('expandedPreview')}
                    value={editedPrompt.expandedPreview === null ? 'auto' : editedPrompt.expandedPreview ? 'on' : 'off'}
                    options={['auto', 'on', 'off'].map((mode) => [mode, promptLabel(`expandedPreviewOptions.${mode}`)])}
                    onChange={(value) => setPromptDraft((draft) => ({ ...draft, expandedPreview: value === 'auto' ? null : value === 'on' }))} />
                </SettingsRow>
                {promptSwitches(['overlayPreview', 'translationEnabled'])}
                {promptSwitches(['translationUnderline'], !editedPrompt.translationEnabled)}
                <SettingsRow label={promptLabel('translationTarget')} description={promptLabel('help.translationTarget')}
                  changed={changedPrompt.includes('translationTarget')} wide>
                  <SettingsSelect label={promptLabel('translationTarget')} value={editedPrompt.translationTarget} disabled={!editedPrompt.translationEnabled}
                    options={['auto', 'zh', 'en', 'ja', 'ko'].map((language) => [language, t(`painting.tools.promptEditor.translationLanguages.${language}`)])}
                    onChange={(value) => setPromptDraft((draft) => ({ ...draft, translationTarget: value }))} />
                </SettingsRow>
              </SettingsGroup>
              <SettingsGroup title={promptLabel('weighting')} icon={<KeyboardOutlined />}>
                {promptSwitches(['weightShortcutsEnabled', 'keepWeightSelection'])}
                <SettingsRow label={promptLabel('defaultWeightMode')} description={promptLabel('help.defaultWeightMode')}
                  changed={changedPrompt.includes('defaultWeightMode')} wide>
                  <SettingsSelect label={promptLabel('defaultWeightMode')} value={editedPrompt.defaultWeightMode}
                    options={['numeric', 'brackets'].map((mode) => [mode, t(`painting.tools.promptEditor.weightModes.${mode}`)])}
                    onChange={(value) => setPromptDraft((draft) => ({ ...draft, defaultWeightMode: value }))} />
                </SettingsRow>
                <SettingsRow label={promptLabel('weightStep')} description={promptLabel('help.weightStep')}
                  changed={changedPrompt.includes('weightStep')} wide>
                  <SettingsSelect label={promptLabel('weightStep')} value={editedPrompt.weightStep}
                    options={[0.05, 0.1, 0.2, 0.25, 0.5].map((step) => [step, step])}
                    onChange={(value) => setPromptDraft((draft) => ({ ...draft, weightStep: value }))} />
                </SettingsRow>
              </SettingsGroup>
              <SettingsGroup title={promptLabel('formatting')} icon={<TextFieldsOutlined />}>
                {promptSwitches(['autoFormat'])}
                {promptSwitches(['normalizeCommas', 'replaceUnderscores'], !editedPrompt.autoFormat)}
                <SettingsRow label={promptLabel('trailingComma')} description={promptLabel('help.trailingComma')}
                  changed={changedPrompt.includes('trailingComma')} wide>
                  <SettingsSelect label={promptLabel('trailingComma')} value={editedPrompt.trailingComma} disabled={!editedPrompt.autoFormat}
                    options={['preserve', 'remove', 'append'].map((mode) => [mode, promptLabel(`trailingOptions.${mode}`)])}
                    onChange={(value) => setPromptDraft((draft) => ({ ...draft, trailingComma: value }))} />
                </SettingsRow>
              </SettingsGroup>
            </Stack>}

            {section === 'shortcuts' && <Stack spacing={4}>
              <SettingsGroup title={t('settings.shortcuts.canvas')} icon={<KeyboardOutlined />}>
                {Object.keys(defaultWorkspaceShortcuts).map((key) => {
                  const name = t(`settings.shortcuts.${key}`);
                  const recording = recordingShortcut?.key === key;
                  const conflict = shortcutError?.key === key;
                  const keys = interfaceSettings[key] ? formatWorkspaceShortcut(interfaceSettings[key]).split('+') : [];
                  return <SettingsRow key={key} wide label={name} description={t(`settings.shortcuts.help.${key}`)}
                    changed={changedInterface.includes(key)}>
                    <Stack direction="row" alignItems="center" gap={0.5}>
                      {/* 聚焦后直接按键录入，不需要打字；Esc 或 Tab 离开录入。 */}
                      <ButtonBase aria-label={name} aria-invalid={conflict}
                        onFocus={() => { setShortcutError(null); setRecordingShortcut({ key, recorded: false }); }}
                        onBlur={() => setRecordingShortcut(null)}
                        onKeyDown={(event) => recordShortcut(event, key)}
                        sx={{
                          flex: 1, minWidth: 0, minHeight: 40, px: 1, gap: 0.5, justifyContent: 'flex-start', borderRadius: 1,
                          border: 1, borderColor: conflict ? 'error.main' : recording ? 'primary.main' : 'divider',
                          bgcolor: recording ? alpha(conflict ? theme.palette.error.main : primary, 0.08) : 'transparent',
                          transition: `border-color ${motion(150)} linear, background-color ${motion(150)} linear`,
                          '&:hover': { borderColor: conflict ? 'error.main' : alpha(theme.palette.text.primary, 0.32) },
                        }}>
                        {recording && !recordingShortcut.recorded
                          ? <Typography variant="body2" color="primary" sx={{
                            fontWeight: 600,
                            animation: animationEnabled ? 'settingsRecordPulse 1.2s ease-in-out infinite' : 'none',
                            '@keyframes settingsRecordPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.45 } },
                          }}>{t('settings.shortcuts.recording')}</Typography>
                          : keys.length
                            ? keys.map((part, index) => <Box key={index} component="kbd" sx={{
                              minWidth: 24, height: 24, px: 0.75, display: 'inline-grid', placeItems: 'center',
                              borderRadius: 0.75, bgcolor: alpha(theme.palette.text.primary, 0.08), color: 'text.primary',
                              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: 12, fontWeight: 650,
                            }}>{part}</Box>)
                            : <Typography variant="body2" color="text.disabled">{t('settings.shortcuts.unassigned')}</Typography>}
                      </ButtonBase>
                      <IconButton size="small" disabled={!interfaceSettings[key]} aria-label={t('settings.shortcuts.clearShortcut', { action: name })}
                        onClick={() => { setShortcutError(null); updateInterface(key, ''); }}><Clear fontSize="small" /></IconButton>
                    </Stack>
                    {conflict && <Typography variant="caption" color="error" role="alert" sx={{ display: 'block', mt: 0.5 }}>
                      {t('settings.shortcuts.conflict', { action: t(`settings.shortcuts.${shortcutError.duplicate}`) })}
                    </Typography>}
                  </SettingsRow>;
                })}
                <SettingsRow label={t('settings.shortcuts.restore')} description={t('settings.shortcuts.help.restore')}>
                  <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={() => {
                    setShortcutError(null);
                    setInterfaceDraft((draft) => ({ ...draft, ...defaultWorkspaceShortcuts }));
                  }}>{t('settings.reset')}</Button>
                </SettingsRow>
              </SettingsGroup>
            </Stack>}


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
            <Accordion disableGutters sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important', bgcolor: 'background.paper' }}>
              <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="subtitle2">{t('settings.pageColors')}</Typography></AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                  {pages.map((page) => <Box key={page.id}>
                    <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
                      {page.icon}
                      <Typography variant="subtitle2">{page.labelKey ? t(page.labelKey) : page.title}</Typography>
                    </Stack>
                    <ColorField label={t('settings.primaryColor')} value={pageColors[page.id] || page.color}
                      onChange={(color) => setPageColors({ ...pageColors, [page.id]: color })} />
                  </Box>)}
                </Box>
              </AccordionDetails>
            </Accordion>
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
                <Box><Typography variant="subtitle1">{t('settings.interfaceAnimation')}</Typography>
                  <Typography variant="body2" color="text.secondary">{t('settings.animationDescription')}</Typography></Box>
                <Switch checked={animationEnabled} inputProps={{ 'aria-label': t('settings.interfaceAnimation') }}
                  onChange={(event) => setThemeDraft({ ...themeSettings, animationEnabled: event.target.checked })} />
              </Stack>
              <Box sx={{ mt: 2, maxWidth: 520 }}>
                <Typography id="animation-duration-label" variant="body2">{t('settings.transitionSpeed', { speed: animationSpeed })}</Typography>
                <Slider value={animationSpeed} min={100} max={500} step={50} disabled={!animationEnabled}
                  aria-labelledby="animation-duration-label" valueLabelDisplay="auto"
                  onChange={(_, value) => setThemeDraft({ ...themeSettings, animationSpeed: value })}
                  marks={[{ value: 100, label: t('common.fast') }, { value: 500, label: t('common.slow') }]}
                  sx={{ width: 'calc(100% - 24px)', mx: 1.5, mt: 2 }} />
              </Box>
            </Paper>
          </Stack>}

          {section === 'gallery' && <Stack spacing={2.5}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <FormControlLabel label={locale === 'zh-CN' ? '下次启动保留生成历史' : 'Keep generated images between sessions'} control={<Switch checked={imageSettings.keepImageHistory} onChange={(_, checked) => setImageSettings({ ...imageSettings, keepImageHistory: checked })} />} />
              {!fixedOutputDirectory && <TextField fullWidth size="small" label={t('librarySettings.outputDirectory')}
                value={imageSettings.outputDirectory}
                onChange={(event) => setImageSettings({ ...imageSettings, outputDirectory: event.target.value })}
                helperText={t('librarySettings.outputHint')} sx={{ mb: 2 }} />}
              {chooseDirectory && <Button startIcon={<FolderOpenOutlined />} onClick={async () => {
                const path = await chooseDirectory();
                if (path) setImageSettings(current => ({ ...current, outputDirectory: path }));
              }} sx={{ mb: 2 }}>{locale === 'zh-CN' ? '选择本机文件夹' : 'Choose folder on this PC'}</Button>}
              <FormControlLabel labelPlacement="start" sx={{ m: 0, justifyContent: 'space-between' }}
                label={t('settings.showInspirationGallery')} control={<Switch checked={inspirationVisible} onChange={(_, checked) => {
                  localStorage.setItem('novelai:inspiration-visible', String(checked));
                  window.dispatchEvent(new Event('novelai:inspiration-visibility'));
                  setInspirationVisible(checked);
                }} />} />
              <GallerySourceSelect value={imageSettings.inspirationSource}
                onChange={(value) => setImageSettings({ ...imageSettings, inspirationSource: value })} />
              <Alert severity="info" sx={{ mt: 2 }}>{t('librarySettings.localOnly')}</Alert>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Typography variant="subtitle1">{t('settings.filenameRules')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{t('settings.downloadSharedRule')}</Typography>
              <TextField data-setting={t('settings.customPrefix')} label={t('settings.customPrefix')} value={imageSettings.fileNamePrefix} fullWidth size="small"
                onChange={(event) => setImageSettings({ ...imageSettings, fileNamePrefix: event.target.value })}
                helperText={t('settings.prefixExample')} />
              <RadioGroup value={imageSettings.namingMethod} aria-label={t('settings.downloadPreset')}
                onChange={(event) => setImageSettings({ ...imageSettings, namingMethod: event.target.value })}
                sx={{ my: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                {DOWNLOAD_NAMING_METHODS.map((method) => <FormControlLabel key={method.value} value={method.value}
                  control={<Radio size="small" />} label={t(`settings.naming.${method.value}`)} />)}
              </RadioGroup>
              {imageSettings.namingMethod === 'custom' && <TextField fullWidth size="small" sx={{ my: 1 }}
                label={locale === 'zh-CN' ? '文件名模板' : 'Filename template'} value={imageSettings.fileNameTemplate}
                helperText={FILE_NAME_TEMPLATE_TOKENS.map(token => '{' + token + '}').join('  ')}
                onChange={event => setImageSettings({ ...imageSettings, fileNameTemplate: event.target.value })} />}
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'background.default', border: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">{t('settings.filenamePreview')}</Typography>
                <Typography variant="body2" sx={{ mt: 0.5, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{fileNamePreview}</Typography>
              </Box>
            </Paper>
          </Stack>}
          </Box>
          {/* 宽屏右侧说明栏：显示鼠标所在或键盘聚焦的设置说明，未指向任何设置时显示本分区简介。 */}
          <Box component="aside" aria-hidden sx={{
            display: { xs: 'none', lg: 'block' }, position: 'sticky', top: 0, alignSelf: 'start',
            pt: 0.5, pl: 3, borderLeft: 1, borderColor: 'divider', minHeight: 160,
          }}>
            <Typography variant="overline" color="primary" sx={{ fontWeight: 700, letterSpacing: '0.08em' }}>{t('settings.details')}</Typography>
            <Box key={detail?.label || section} sx={{
              animation: animationEnabled ? 'settingsDetailIn 160ms linear' : 'none',
              '@keyframes settingsDetailIn': { from: { opacity: 0 }, to: { opacity: 1 } },
            }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 0.5, lineHeight: 1.4 }}>{detail?.label || sectionTitle(section)}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.75 }}>
                {detail?.help || t(`settings.sections.${section}.description`)}
              </Typography>
            </Box>
          </Box>
        </Box>
        </Box>
        )}
      </Box>}
    </Box>

    {/* 底栏属于工作区自身，不再猜测应用侧栏宽度，也不会遮住滚动内容。 */}
    {(!mobileLayout || (section && section !== 'about') || dirty) && <Box component="footer" sx={{
      flexShrink: 0, display: section === 'desktop' && !dirty ? 'none' : 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 1.5, px: { xs: 2, sm: 3 }, py: 1.5, pb: mobileLayout ? 1.5 : 'max(12px, env(safe-area-inset-bottom))',
      borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper',
    }}>
      <Chip size="small" variant="outlined" label={t(dirty ? 'settings.unsaved' : 'settings.upToDate')}
        sx={{ display: { xs: 'none', sm: 'inline-flex' }, borderColor: 'divider', color: dirty ? 'primary.main' : 'text.secondary' }} />
      <Stack direction="row" gap={1} sx={{ ml: 'auto' }}>
        {dirty && <Button disabled={saving} onClick={() => {
          setInterfaceDraft({}); setPromptDraft(null); setThemeDraft(null); setPageColors(savedPageColors); setImageSettings(savedImages);
        }}>{t('settings.discard')}</Button>}
        <Button startIcon={<Refresh />} disabled={!loaded || saving} onClick={resetSettings} color="inherit">{t('settings.reset')}</Button>
        <Button variant="contained" startIcon={<SaveOutlined />} disabled={!loaded || saving || !dirty || !colorsValid || Boolean(invalidSymbols.length)} onClick={saveSettings}>{t('settings.save')}</Button>
      </Stack>
    </Box>}
    <Snackbar open={Boolean(snackbar)} autoHideDuration={4000} onClose={() => setSnackbar(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      {snackbar && <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(null)} sx={{ mb: 8 }}>{snackbar.message}</Alert>}
    </Snackbar>
  </Paper>;
}
