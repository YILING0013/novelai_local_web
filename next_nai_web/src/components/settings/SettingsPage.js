import React, { useState, useEffect, useRef } from 'react';
import {
  Paper,
  Typography,
  Box,
  Grid,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Alert,
  Snackbar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  Slider,
  useTheme,
  alpha,
  Card,
  CircularProgress,
  useMediaQuery,
  Radio,
  RadioGroup,
  InputAdornment, // 导入
} from '@mui/material';
import {
  ColorLens as ColorLensIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  Speed as SpeedIcon,
  Brush as BrushIcon,
  Settings as SettingsIcon,
  Check as CheckIcon,
  Palette as PaletteIcon,
  Lightbulb as LightbulbIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Visibility as VisibilityIcon,
  Image as ImageIcon,
  SaveAlt as SaveAltIcon,
  Label as LabelIcon,
  AutoFixHigh as AutoFixHighIcon,
} from '@mui/icons-material';
import { generateFileName, DOWNLOAD_NAMING_METHODS } from '@/components/ai-painting/tools/ImageTools/ImageSaveUtils';
import { useI18n } from '@/i18n/I18nProvider';
import { PAGE_IDS, getPageColorStorageKey, migrateLegacyPageColors } from '@/i18n/pageConfig.mjs';
import apiClient from '@/utils/ApiClient';

// 预设主题颜色 (将紫色改为青色)
const themePresets = {
  teal: '#00796B', // 新的默认色
  blue: '#448AFF',
  cyan: '#00BFA5',
  green: '#4CAF50',
  amber: '#FFC107',
  orange: '#FF5722',
  red: '#F44336',
  pink: '#E91E63',
};

// 背景色预设 (保持不变)
const backgroundPresets = {
  light: {
    classic: { default: '#BDDDE4', paper: '#FFF1D5', drawer: '#9EC6F3' },
    warm: { default: '#FFD1D1', paper: '#FFF5E4', drawer: '#FFE3E1' },
    cool: { default: '#f0f4f8', paper: '#ffffff', drawer: '#eef2f6' }, // 新的亮色默认
    minimal: { default: '#fdfdfd', paper: '#ffffff', drawer: '#fafafa' },
    cream: { default: '#fefcf8', paper: '#fffef9', drawer: '#fdf9f4' },
  },
  dark: {
    classic: { default: '#121212', paper: '#1e1e1e', drawer: '#1a1a1a' },
    deep: { default: '#0a0a0a', paper: '#1a1a1a', drawer: '#141414' },
    blue: { default: '#0d1117', paper: '#161b22', drawer: '#11161d' }, // 新的暗色默认
    purple: { default: '#130f1a', paper: '#1f1b26', drawer: '#181420' },
    green: { default: '#0f1b0f', paper: '#1a261a', drawer: '#152015' },
  }
};

const backgroundPresetNameKeys = {
  classic: 'settings.backgroundPresets.classic',
  warm: 'settings.backgroundPresets.warm',
  cool: 'settings.backgroundPresets.cool',
  minimal: 'settings.backgroundPresets.minimal',
  cream: 'settings.backgroundPresets.cream',
  deep: 'settings.backgroundPresets.deep',
  blue: 'settings.backgroundPresets.blue',
  purple: 'settings.backgroundPresets.purple',
  green: 'settings.backgroundPresets.green',
};

// 颜色名称映射 (更新)
const colorNameKeys = {
  '#00796B': 'settings.colorNames.teal',
  '#448AFF': 'settings.colorNames.blue',
  '#00BFA5': 'settings.colorNames.cyan',
  '#4CAF50': 'settings.colorNames.green',
  '#FFC107': 'settings.colorNames.amber',
  '#FF5722': 'settings.colorNames.orange',
  '#F44336': 'settings.colorNames.red',
  '#E91E63': 'settings.colorNames.pink',
};

// 页面图标映射 (保持在此处，因为 SettingsPage 需要它)
const pageIcons = {
  [PAGE_IDS.AI_PAINTING]: <BrushIcon />,
  [PAGE_IDS.SETTINGS]: <SettingsIcon />,
};

// 动态生成页面颜色的初始状态
const getInitialPageColors = (pages) => {
  const initialColors = {};
  migrateLegacyPageColors(localStorage);
  pages.forEach(page => {
    if (!pageIcons[page.id]) {
      // 如果没有图标，给一个默认图标
      pageIcons[page.id] = <LabelIcon />;
    }
    // 从 localStorage 或 page.js 的 props 中获取颜色，默认为新的青色
    initialColors[page.id] = localStorage.getItem(getPageColorStorageKey(page.id)) || page.color || '#00796B';
  });
  return initialColors;
};

// 动态生成默认页面颜色
const getDefaultPageColors = (pages) => {
  const defaultColors = {};
  pages.forEach(page => {
     // 从 page.js 的 props 中获取原始颜色，默认为新的青色
    defaultColors[page.id] = page.color || '#00796B';
  });
  return defaultColors;
};


const SettingsPage = ({ pages = [] }) => { // 接收来自 page.js 的 pages 数组
  const theme = useTheme();
  const { t, locale, setLocale } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const remoteSettingsLoaded = useRef(false);
  
  // 获取当前应用的主题模式
  const [mode, setMode] = useState(() => {
    return localStorage.getItem('themeMode') || 'dark';
  });
  
  // 状态变量
  const [primaryColors, setPrimaryColors] = useState({
    light: localStorage.getItem('themePrimaryLight') || '#00796B', // 更新默认色
    dark: localStorage.getItem('themePrimaryDark') || '#4DB6AC', // 更新默认色
  });
  
  // 使用新的默认背景
  const [customBackgroundColors, setCustomBackgroundColors] = useState({
    light: {
      default: localStorage.getItem('themeBackgroundDefaultLight') || backgroundPresets.light.cool.default,
      paper: localStorage.getItem('themeBackgroundPaperLight') || backgroundPresets.light.cool.paper,
      drawer: localStorage.getItem('themeBackgroundDrawerLight') || backgroundPresets.light.cool.drawer, 
    },
    dark: {
      default: localStorage.getItem('themeBackgroundDefaultDark') || backgroundPresets.dark.blue.default,
      paper: localStorage.getItem('themeBackgroundPaperDark') || backgroundPresets.dark.blue.paper,
      drawer: localStorage.getItem('themeBackgroundDrawerDark') || backgroundPresets.dark.blue.drawer, 
    },
  });
  
  const [customColors, setCustomColors] = useState({
    light: localStorage.getItem('themePrimaryLight') || '#00796B', // 更新默认色
    dark: localStorage.getItem('themePrimaryDark') || '#4DB6AC', // 更新默认色
  });
  
  // 动态初始化 pageColors
  const [pageColors, setPageColors] = useState(() => getInitialPageColors(pages));

  const [animationEnabled, setAnimationEnabled] = useState(
    localStorage.getItem('animationEnabled') !== 'false'
  );
  const [animationSpeed, setAnimationSpeed] = useState(
    parseInt(localStorage.getItem('animationSpeed') || '300')
  );
  
  // 图像下载设置状态，自动保存和手动下载共用同一套命名规则。
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(
    localStorage.getItem('autoSaveEnabled') === 'true'
  );
  const [fileNamePrefix, setFileNamePrefix] = useState(
    localStorage.getItem('fileNamePrefix') || 'AI_Image'
  );
  const [namingMethod, setNamingMethod] = useState(
    localStorage.getItem('namingMethod') || 'seed'
  );
  
  // 消息通知
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
  });
  
  // 保存状态
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // 保存所有设置
  const saveSettings = async () => {
    setIsSaving(true);

    try {
      // 保存主题设置
      localStorage.setItem('themePrimaryLight', customColors.light);
      localStorage.setItem('themePrimaryDark', customColors.dark);
      localStorage.setItem('themeMode', mode);
      
      // 保存背景色设置
      localStorage.setItem('themeBackgroundDefaultLight', customBackgroundColors.light.default);
      localStorage.setItem('themeBackgroundPaperLight', customBackgroundColors.light.paper);
      localStorage.setItem('themeBackgroundDrawerLight', customBackgroundColors.light.drawer);
      localStorage.setItem('themeBackgroundDefaultDark', customBackgroundColors.dark.default);
      localStorage.setItem('themeBackgroundPaperDark', customBackgroundColors.dark.paper);
      localStorage.setItem('themeBackgroundDrawerDark', customBackgroundColors.dark.drawer);
      
      // 保存页面颜色 (动态)
      Object.entries(pageColors).forEach(([page, color]) => {
        localStorage.setItem(getPageColorStorageKey(page), color);
      });
      
      // 保存界面设置
      localStorage.setItem('animationEnabled', animationEnabled.toString());
      localStorage.setItem('animationSpeed', animationSpeed.toString());
      
      // 保存图像下载设置，并清理旧版命名字段，避免隐藏设置继续影响文件名。
      localStorage.setItem('autoSaveEnabled', autoSaveEnabled.toString());
      localStorage.setItem('fileNamePrefix', fileNamePrefix);
      localStorage.setItem('namingMethod', namingMethod);
      localStorage.setItem('fileNameSuffix', '');
      localStorage.setItem('randomStringLength', '8');
      localStorage.setItem('includeDateInName', 'false');
      localStorage.setItem('dateFormat', 'yyyyMMdd_HHmmss');

      await apiClient.saveLocalSettings({
        themeMode: mode,
        themePrimaryLight: customColors.light,
        themePrimaryDark: customColors.dark,
        themeBackgroundDefaultLight: customBackgroundColors.light.default,
        themeBackgroundPaperLight: customBackgroundColors.light.paper,
        themeBackgroundDrawerLight: customBackgroundColors.light.drawer,
        themeBackgroundDefaultDark: customBackgroundColors.dark.default,
        themeBackgroundPaperDark: customBackgroundColors.dark.paper,
        themeBackgroundDrawerDark: customBackgroundColors.dark.drawer,
        pageColors,
        locale,
        animationEnabled,
        animationSpeed,
        autoSaveEnabled,
        fileNamePrefix,
        namingMethod,
      });
      
      setPrimaryColors({
        light: customColors.light,
        dark: customColors.dark,
      });
      
      setSnackbar({
        open: true,
        message: t('settings.savedMessage'),
        severity: 'success',
      });
      
      // 派发事件通知主应用更新主题和设置
      window.dispatchEvent(new CustomEvent('themeUpdate', {
        detail: {
          mode,
          primaryColors: {
            light: customColors.light,
            dark: customColors.dark,
          },
          backgroundColors: customBackgroundColors,
          pageColors,
          animationEnabled,
          animationSpeed
        }
      }));
      
      // 派发图像设置更新事件
      window.dispatchEvent(new CustomEvent('imageSettingsUpdate', {
        detail: {
          autoSaveEnabled,
          fileNamePrefix,
          namingMethod,
          fileNameSuffix: '',
          randomStringLength: 8,
          includeDateInName: false,
          dateFormat: 'yyyyMMdd_HHmmss'
        }
      }));
      
      setIsSaving(false);
      setSaveSuccess(true);
      
      setTimeout(() => {
        setSaveSuccess(false);
      }, 2000);
    } catch (error) {
      setSnackbar({
        open: true,
        message: error?.message || t('settings.saveFailed'),
        severity: 'error',
      });
      setIsSaving(false);
    }
  };
  
  // 重置所有设置
  const resetSettings = () => {
    // 更新默认色
    const defaultSettings = {
      light: '#00796B',
      dark: '#4DB6AC',
    };
    
    // 更新默认背景
    const defaultBackgroundColors = {
      light: backgroundPresets.light.cool,
      dark: backgroundPresets.dark.blue,
    };
    
    // 动态重置页面颜色
    const defaultPageColors = getDefaultPageColors(pages);
    
    setCustomColors(defaultSettings);
    setCustomBackgroundColors(defaultBackgroundColors);
    setPageColors(defaultPageColors);
    setMode('dark');
    setAnimationEnabled(true);
    setAnimationSpeed(300);
    
    // 重置图像设置
    setAutoSaveEnabled(false);
    setFileNamePrefix('AI_Image');
    setNamingMethod('seed');
    
    setSnackbar({
      open: true,
      message: t('settings.resetMessage'),
      severity: 'info',
    });
  };
  
  // 主题模式切换
  const handleModeChange = (event) => {
    setMode(event.target.checked ? 'dark' : 'light');
  };
  
  // 是否为有效的颜色代码
  const isValidColor = (color) => {
    if (!color) return false; // 处理空值
    const s = new Option().style;
    s.color = color;
    return s.color !== '';
  };
  
  // 当组件挂载时，从localStorage读取设置
  useEffect(() => {
    const themeMode = localStorage.getItem('themeMode');
    if (themeMode) {
      setMode(themeMode);
    }
    
    const themePrimaryLight = localStorage.getItem('themePrimaryLight');
    const themePrimaryDark = localStorage.getItem('themePrimaryDark');
    
    const colors = {
      light: themePrimaryLight || '#00796B', // 更新
      dark: themePrimaryDark || '#4DB6AC', // 更新
    };
    setPrimaryColors(colors);
    setCustomColors(colors);
    
    // 加载背景色设置
    const backgroundDefaultLight = localStorage.getItem('themeBackgroundDefaultLight');
    const backgroundPaperLight = localStorage.getItem('themeBackgroundPaperLight');
    const backgroundDrawerLight = localStorage.getItem('themeBackgroundDrawerLight');
    const backgroundDefaultDark = localStorage.getItem('themeBackgroundDefaultDark');
    const backgroundPaperDark = localStorage.getItem('themeBackgroundPaperDark');
    const backgroundDrawerDark = localStorage.getItem('themeBackgroundDrawerDark');
    
    setCustomBackgroundColors({
      light: {
        default: backgroundDefaultLight || backgroundPresets.light.cool.default, // 更新
        paper: backgroundPaperLight || backgroundPresets.light.cool.paper, // 更新
        drawer: backgroundDrawerLight || backgroundPresets.light.cool.drawer, // 更新
      },
      dark: {
        default: backgroundDefaultDark || backgroundPresets.dark.blue.default, // 更新
        paper: backgroundPaperDark || backgroundPresets.dark.blue.paper, // 更新
        drawer: backgroundDrawerDark || backgroundPresets.dark.blue.drawer, // 更新
      },
    });
    
    // 动态读取页面颜色
    const storedPageColors = getInitialPageColors(pages);
    setPageColors(storedPageColors);
    
    setAnimationEnabled(localStorage.getItem('animationEnabled') !== 'false');
    setAnimationSpeed(parseInt(localStorage.getItem('animationSpeed') || '300'));
    
    // 读取图像设置
    setAutoSaveEnabled(localStorage.getItem('autoSaveEnabled') === 'true');
    setFileNamePrefix(localStorage.getItem('fileNamePrefix') || 'AI_Image');
    setNamingMethod(localStorage.getItem('namingMethod') || 'seed');

    if (remoteSettingsLoaded.current) return undefined;
    remoteSettingsLoaded.current = true;

    let active = true;
    void apiClient.getLocalSettings().then((settings) => {
      if (!active || !settings || Object.keys(settings).length === 0) return;

      const remoteMode = settings.themeMode === 'light' || settings.themeMode === 'dark'
        ? settings.themeMode
        : (themeMode === 'light' ? 'light' : 'dark');
      const remotePrimaryColors = {
        light: settings.themePrimaryLight || colors.light,
        dark: settings.themePrimaryDark || colors.dark,
      };
      const remoteBackgroundColors = {
        light: {
          default: settings.themeBackgroundDefaultLight || backgroundDefaultLight || backgroundPresets.light.cool.default,
          paper: settings.themeBackgroundPaperLight || backgroundPaperLight || backgroundPresets.light.cool.paper,
          drawer: settings.themeBackgroundDrawerLight || backgroundDrawerLight || backgroundPresets.light.cool.drawer,
        },
        dark: {
          default: settings.themeBackgroundDefaultDark || backgroundDefaultDark || backgroundPresets.dark.blue.default,
          paper: settings.themeBackgroundPaperDark || backgroundPaperDark || backgroundPresets.dark.blue.paper,
          drawer: settings.themeBackgroundDrawerDark || backgroundDrawerDark || backgroundPresets.dark.blue.drawer,
        },
      };
      const remotePageColors = { ...storedPageColors, ...(settings.pageColors || {}) };
      const remoteAnimationEnabled = settings.animationEnabled ?? (localStorage.getItem('animationEnabled') !== 'false');
      const remoteAnimationSpeed = Number.isFinite(settings.animationSpeed)
        ? settings.animationSpeed
        : parseInt(localStorage.getItem('animationSpeed') || '300');
      const remoteAutoSaveEnabled = settings.autoSaveEnabled ?? (localStorage.getItem('autoSaveEnabled') === 'true');
      const remoteFileNamePrefix = settings.fileNamePrefix || localStorage.getItem('fileNamePrefix') || 'AI_Image';
      const remoteNamingMethod = settings.namingMethod || localStorage.getItem('namingMethod') || 'seed';

      localStorage.setItem('themeMode', remoteMode);
      localStorage.setItem('themePrimaryLight', remotePrimaryColors.light);
      localStorage.setItem('themePrimaryDark', remotePrimaryColors.dark);
      localStorage.setItem('themeBackgroundDefaultLight', remoteBackgroundColors.light.default);
      localStorage.setItem('themeBackgroundPaperLight', remoteBackgroundColors.light.paper);
      localStorage.setItem('themeBackgroundDrawerLight', remoteBackgroundColors.light.drawer);
      localStorage.setItem('themeBackgroundDefaultDark', remoteBackgroundColors.dark.default);
      localStorage.setItem('themeBackgroundPaperDark', remoteBackgroundColors.dark.paper);
      localStorage.setItem('themeBackgroundDrawerDark', remoteBackgroundColors.dark.drawer);
      Object.entries(remotePageColors).forEach(([page, color]) => {
        localStorage.setItem(getPageColorStorageKey(page), color);
      });
      localStorage.setItem('animationEnabled', String(remoteAnimationEnabled));
      localStorage.setItem('animationSpeed', String(remoteAnimationSpeed));
      localStorage.setItem('autoSaveEnabled', String(remoteAutoSaveEnabled));
      localStorage.setItem('fileNamePrefix', remoteFileNamePrefix);
      localStorage.setItem('namingMethod', remoteNamingMethod);

      setMode(remoteMode);
      setPrimaryColors(remotePrimaryColors);
      setCustomColors(remotePrimaryColors);
      setCustomBackgroundColors(remoteBackgroundColors);
      setPageColors(remotePageColors);
      setAnimationEnabled(remoteAnimationEnabled);
      setAnimationSpeed(remoteAnimationSpeed);
      setAutoSaveEnabled(remoteAutoSaveEnabled);
      setFileNamePrefix(remoteFileNamePrefix);
      setNamingMethod(remoteNamingMethod);
      if (settings.locale) setLocale(settings.locale);

      window.dispatchEvent(new CustomEvent('themeUpdate', {
        detail: {
          mode: remoteMode,
          primaryColors: remotePrimaryColors,
          backgroundColors: remoteBackgroundColors,
          pageColors: remotePageColors,
          animationEnabled: remoteAnimationEnabled,
          animationSpeed: remoteAnimationSpeed,
        },
      }));
      window.dispatchEvent(new CustomEvent('imageSettingsUpdate', {
        detail: {
          autoSaveEnabled: remoteAutoSaveEnabled,
          fileNamePrefix: remoteFileNamePrefix,
          namingMethod: remoteNamingMethod,
        },
      }));
    }).catch((error) => {
      console.warn('Unable to load local settings:', error);
    });

    return () => { active = false; };
  }, [pages, setLocale]); // 依赖 pages prop，以便在 pages 加载后正确初始化
  
  
  // 获取颜色名称函数
  const getColorName = (color) => {
    // 检查是否为预设颜色
    for (const key in themePresets) {
      if (themePresets[key].toLowerCase() === color.toLowerCase()) {
        return t(colorNameKeys[themePresets[key]]);
      }
    }
    return t('common.custom');
  };
  
  // 查找设置页面的颜色，如果 pages prop 还没加载，则使用 theme
  const settingsPageColor = pageColors[PAGE_IDS.SETTINGS] || theme.palette.primary.main;
  const fileNamePreview = generateFileName(
    {
      seed: '1234567890',
      prompt: 'Golden Hour Portrait of a girl in a city garden',
      id: 'preview',
    },
    {
      fileNamePrefix,
      namingMethod,
    }
  );

  return (
    <Paper elevation={0} sx={{ p: {xs: 1, sm: 2}, borderRadius: 2, height: '100%', overflow: 'auto', position: 'relative', pb: 9 }}>
      <Typography variant="h5" sx={{ 
        mb: 2, // 减小间距
        fontWeight: 'bold', 
        color: settingsPageColor, 
        display: 'flex', 
        alignItems: 'center',
      }}>
        <SettingsIcon sx={{ mr: 1 }} />
        {t('settings.title')}
      </Typography>
      
      <Box sx={{ mb: 2 }}>
        <Alert severity="info" sx={{ mb: 1.5 }}>
          {t('settings.intro')}
        </Alert>
      </Box>
      
      <Grid container spacing={2}> {/* 减小间距 */}
        {/* 主题设置部分 */}
        <Grid item xs={12}>
          <Accordion defaultExpanded sx={{
            mb: 1.5, // 减小间距
            backgroundColor: alpha(theme.palette.background.paper, 0.6),
            boxShadow: theme.shadows[1],
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}>
            <AccordionSummary 
              expandIcon={<ExpandMoreIcon />}
              sx={{
                '& .MuiAccordionSummary-content': {
                  alignItems: 'center',
                },
              }}
            >
              <ColorLensIcon sx={{ mr: 1, color: settingsPageColor }} /> 
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                {t('settings.themeSettings')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {/* 暗色/亮色模式切换 */}
              <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                  <LightbulbIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                  {t('settings.themeMode')}
                </Typography>
                <Card variant="outlined" sx={{ 
                  p: 1.5, // 减小间距
                  display: 'flex', 
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1.5
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    {mode === 'dark' ? 
                      <Box sx={{ 
                        p: 1.25, // 减小间距
                        bgcolor: '#121212', 
                        borderRadius: 1, 
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mr: 1.5
                      }}>
                        <DarkModeIcon />
                      </Box> :
                      <Box sx={{ 
                        p: 1.25, // 减小间距
                        bgcolor: '#f9fafc', 
                        borderRadius: 1, 
                        color: '#121212',
                        border: '1px solid #e0e0e0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mr: 1.5
                      }}>
                        <LightModeIcon />
                      </Box>
                    }
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                        {mode === 'dark' ? t('main.darkMode') : t('main.lightMode')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {mode === 'dark' ? t('settings.currentDark') : t('settings.currentLight')}
                      </Typography>
                    </Box>
                  </Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={mode === 'dark'}
                        onChange={handleModeChange}
                        color="primary"
                      />
                    }
                    label={mode === 'dark' ? t('settings.switchToLight') : t('settings.switchToDark')}
                    sx={{ m: 0 }}
                  />
                </Card>
              </Box>
              
              {/* 主色调选择 */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                  <PaletteIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                  {t('settings.primaryColor')}
                </Typography>
                
                <Box sx={{ mb: 1.5 }}>
                  <Grid container spacing={1} sx={{ mb: 1.5 }}>
                    {Object.entries(themePresets).map(([name, color]) => (
                      <Grid item key={name}>
                        <Tooltip title={colorNameKeys[color] ? t(colorNameKeys[color]) : name} arrow>
                          <Box
                            onClick={() => setCustomColors({
                              ...customColors,
                              [mode]: color
                            })}
                            sx={{
                              width: 34, // 减小
                              height: 34, // 减小
                              borderRadius: '50%',
                              backgroundColor: color,
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              border: customColors[mode] === color 
                                ? `3px solid ${theme.palette.background.paper}` 
                                : `1px solid ${theme.palette.divider}`,
                              boxShadow: customColors[mode] === color 
                                ? `0 0 0 2px ${color}` 
                                : 'none',
                              '&:hover': {
                                transform: 'scale(1.15)',
                                boxShadow: `0 0 0 2px ${color}`,
                              },
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {customColors[mode] === color && <CheckIcon sx={{ color: 'white', fontSize: '1rem' }} />}
                          </Box>
                        </Tooltip>
                      </Grid>
                    ))}
                  </Grid>
                  
                  {/* 自定义颜色输入 (包含新色盘) */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <TextField
                      label={t('settings.customColorCode')}
                      fullWidth
                      margin="dense"
                      value={customColors[mode]}
                      onChange={(e) => setCustomColors({
                        ...customColors,
                        [mode]: e.target.value
                      })}
                      error={!isValidColor(customColors[mode])}
                      helperText={!isValidColor(customColors[mode]) ? t('settings.invalidColor') : t('settings.colorExample')}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Box
                              sx={{
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                backgroundColor: isValidColor(customColors[mode]) ? customColors[mode] : '#ccc',
                                border: `1px solid ${theme.palette.divider}`,
                              }}
                            />
                          </InputAdornment>
                        ),
                      }}
                      size="small"
                      sx={{ flexGrow: 1 }}
                    />
                    
                    {/* HTML5 颜色选择器 */}
                    <Tooltip title={t('settings.colorPicker')} arrow>
                      <Box
                        sx={{
                          width: 38,
                          height: 38,
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: `1px solid ${theme.palette.divider}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          backgroundColor: isValidColor(customColors[mode]) ? customColors[mode] : '#ccc',
                        }}
                      >
                        <input
                          type="color"
                          value={isValidColor(customColors[mode]) ? customColors[mode] : '#00796B'}
                          onChange={(e) => setCustomColors({
                            ...customColors,
                            [mode]: e.target.value
                          })}
                          style={{
                            width: '50px',
                            height: '50px',
                            border: 'none',
                            padding: 0,
                            margin: 0,
                            cursor: 'pointer',
                            transform: 'scale(1.5)', // 放大色盘使其填满圆形
                          }}
                        />
                      </Box>
                    </Tooltip>
                  </Box>
                </Box>
              </Box>

              {/* 背景色设置 */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                  <AutoFixHighIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                  {t('settings.backgroundSettings')}
                </Typography>
                
                {/* 背景色预设 */}
                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="body2" sx={{ mb: 1, opacity: 0.8 }}>{t('settings.backgroundPreset')}</Typography>
                  <Grid container spacing={1} sx={{ mb: 1.5 }}>
                    {Object.entries(backgroundPresets[mode]).map(([presetName, colors]) => {
                      const isSelected = customBackgroundColors[mode].default === colors.default && 
                                      customBackgroundColors[mode].paper === colors.paper &&
                                      customBackgroundColors[mode].drawer === colors.drawer;
                      
                      return (
                        <Grid item key={presetName}>
                          <Tooltip title={t(backgroundPresetNameKeys[presetName])} arrow>
                            <Box
                              onClick={() => setCustomBackgroundColors({
                                ...customBackgroundColors,
                                [mode]: colors
                              })}
                              sx={{
                                width: 70, // 减小
                                height: 32, // 减小
                                borderRadius: 1,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                border: isSelected 
                                  ? `2px solid ${theme.palette.primary.main}` 
                                  : `1px solid ${theme.palette.divider}`,
                                overflow: 'hidden',
                                position: 'relative',
                                '&:hover': {
                                  transform: 'scale(1.05)',
                                  boxShadow: theme.shadows[2],
                                },
                                display: 'flex',
                              }}
                            >
                              <Box sx={{ width: '33.33%', height: '100%', backgroundColor: colors.default }} />
                              <Box sx={{ width: '33.33%', height: '100%', backgroundColor: colors.paper }} />
                              <Box sx={{ width: '33.33%', height: '100%', backgroundColor: colors.drawer }} />
                              
                              {isSelected && (
                                <Box sx={{
                                  position: 'absolute',
                                  top: '50%',
                                  left: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  backgroundColor: alpha(theme.palette.primary.main, 0.9),
                                  borderRadius: '50%',
                                  width: 18, // 减小
                                  height: 18, // 减小
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}>
                                  <CheckIcon sx={{ color: 'white', fontSize: '0.75rem' }} />
                                </Box>
                              )}
                            </Box>
                          </Tooltip>
                        </Grid>
                      );
                    })}
                  </Grid>
                </Box>
                
                {/* 自定义背景色输入 */}
                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="body2" sx={{ mb: 1, opacity: 0.8 }}>{t('settings.customBackground')}</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        label={t('settings.mainBackground')}
                        fullWidth
                        margin="dense"
                        value={customBackgroundColors[mode].default || ''}
                        onChange={(e) => setCustomBackgroundColors({
                          ...customBackgroundColors,
                          [mode]: { ...customBackgroundColors[mode], default: e.target.value }
                        })}
                        error={!isValidColor(customBackgroundColors[mode].default)}
                        helperText={t('settings.mainBackgroundHint')}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <Box
                                sx={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: '50%',
                                  backgroundColor: isValidColor(customBackgroundColors[mode].default) 
                                    ? customBackgroundColors[mode].default 
                                    : '#ccc',
                                  border: `1px solid ${theme.palette.divider}`,
                                }}
                              />
                            </InputAdornment>
                          ),
                        }}
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        label={t('settings.cardBackground')}
                        fullWidth
                        margin="dense"
                        value={customBackgroundColors[mode].paper || ''}
                        onChange={(e) => setCustomBackgroundColors({
                          ...customBackgroundColors,
                          [mode]: { ...customBackgroundColors[mode], paper: e.target.value }
                        })}
                        error={!isValidColor(customBackgroundColors[mode].paper)}
                        helperText={t('settings.cardBackgroundHint')}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <Box
                                sx={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: '50%',
                                  backgroundColor: isValidColor(customBackgroundColors[mode].paper) 
                                    ? customBackgroundColors[mode].paper 
                                    : '#ccc',
                                  border: `1px solid ${theme.palette.divider}`,
                                }}
                              />
                            </InputAdornment>
                          ),
                        }}
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        label={t('settings.drawerBackground')}
                        fullWidth
                        margin="dense"
                        value={customBackgroundColors[mode].drawer || ''}
                        onChange={(e) => setCustomBackgroundColors({
                          ...customBackgroundColors,
                          [mode]: { ...customBackgroundColors[mode], drawer: e.target.value }
                        })}
                        error={!isValidColor(customBackgroundColors[mode].drawer)}
                        helperText={t('settings.drawerBackgroundHint')}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <Box
                                sx={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: '50%',
                                  backgroundColor: isValidColor(customBackgroundColors[mode].drawer) 
                                    ? customBackgroundColors[mode].drawer 
                                    : '#ccc',
                                  border: `1px solid ${theme.palette.divider}`,
                                }}
                              />
                            </InputAdornment>
                          ),
                        }}
                        size="small"
                      />
                    </Grid>
                  </Grid>
                </Box>
              </Box>
              
              {/* 页面颜色设置 (动态) */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                  <BrushIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                  {t('settings.pageColors')}
                </Typography>
                
                <Grid container spacing={1.5}>
                  {Object.entries(pageColors).map(([page, color]) => (
                    <Grid item xs={12} sm={6} key={page}>
                      <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        p: 1.25, // 减小
                        borderRadius: 1,
                        border: `1px solid ${theme.palette.divider}`,
                        backgroundColor: alpha(theme.palette.background.paper, 0.4),
                      }}>
                        <Box sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          flexGrow: 1,
                        }}>
                          <Box sx={{ 
                            mr: 1.5, 
                            color, 
                            bgcolor: alpha(color, 0.1),
                            p: 0.75,
                            borderRadius: 1,
                            display: 'flex',
                            alignItems: 'center',
                          }}>
                            {/* 使用 pageIcons 映射 */}
                            {pageIcons[page] ? (
                              React.cloneElement(pageIcons[page], { fontSize: 'small' })
                            ) : (
                              <LabelIcon fontSize="small" /> // 默认图标
                            )}
                          </Box>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                              {pages.find(candidate => candidate.id === page)?.labelKey
                                ? t(pages.find(candidate => candidate.id === page).labelKey)
                                : pages.find(candidate => candidate.id === page)?.title || page}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">{getColorName(color)}</Typography>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Tooltip title={t('settings.cyclePreset')} arrow>
                            <Box
                              sx={{
                                width: 22, // 减小
                                height: 22, // 减小
                                borderRadius: '50%',
                                backgroundColor: color,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                border: `1px solid ${theme.palette.divider}`,
                                '&:hover': {
                                  transform: 'scale(1.15)',
                                },
                                ml: 1,
                              }}
                              onClick={() => {
                                // 在预设颜色中循环
                                const colorValues = Object.values(themePresets);
                                const currentIndex = colorValues.indexOf(pageColors[page]);
                                const nextIndex = (currentIndex + 1) % colorValues.length;
                                const nextColor = colorValues[nextIndex];
                                
                                setPageColors({
                                  ...pageColors,
                                  [page]: nextColor
                                });
                              }}
                            />
                          </Tooltip>
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Box>
              
              {/* 颜色预览 */}
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                  <VisibilityIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                  {t('settings.preview')}
                </Typography>
                <Box
                  sx={{
                    p: 1.5, // 减小
                    borderRadius: 2,
                    mb: 1.5, // 减小
                    backgroundColor: customBackgroundColors[mode].default,
                    color: mode === 'dark' ? '#ffffff' : '#000000',
                    boxShadow: theme.shadows[1],
                    border: `1px solid ${theme.palette.divider}`,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      p: 1.5, // 减小
                      borderRadius: 1,
                      backgroundColor: customBackgroundColors[mode].paper,
                      border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                      mb: 1.5, // 减小
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ mb: 1, color: customColors[mode] }}>
                      {t('settings.previewTitle')}
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.8, mb: 1.5 }}>
                      {t('settings.previewDescription')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="contained"
                        size="small"
                        sx={{ 
                          backgroundColor: customColors[mode], 
                          '&:hover': { backgroundColor: alpha(customColors[mode], 0.8) } 
                        }}
                      >
                        {t('settings.primaryButton')}
                      </Button>
                      <Button 
                        variant="outlined" 
                        size="small" 
                        sx={{ 
                          color: customColors[mode], 
                          borderColor: customColors[mode],
                          '&:hover': {
                            borderColor: customColors[mode],
                            backgroundColor: alpha(customColors[mode], 0.04),
                          }
                        }}
                      >
                        {t('settings.secondaryButton')}
                      </Button>
                    </Box>
                  </Box>
                  
                  <Box sx={{ 
                    display: 'flex', 
                    flexWrap: 'wrap', // 允许换行
                    gap: 1,
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.75rem',
                    opacity: 0.6,
                    fontFamily: 'monospace'
                  }}>
                    <span>{t('settings.backgroundValue', { value: customBackgroundColors[mode].default })}</span>
                    <span>{t('settings.paperValue', { value: customBackgroundColors[mode].paper })}</span>
                  </Box>
                </Box>
              </Box>
            </AccordionDetails>
          </Accordion>
          
          {/* 界面设置部分 */}
          <Accordion sx={{
            mb: 1.5, // 减小
            backgroundColor: alpha(theme.palette.background.paper, 0.6),
            boxShadow: theme.shadows[1],
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}>
            <AccordionSummary 
              expandIcon={<ExpandMoreIcon />}
              sx={{ '& .MuiAccordionSummary-content': { alignItems: 'center' } }}
            >
              <SpeedIcon sx={{ mr: 1, color: settingsPageColor }} /> 
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                {t('settings.interfaceSettings')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {/* 动画设置 */}
              <Card variant="outlined" sx={{ mb: 2, p: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box>
                    <Typography variant="subtitle2">{t('settings.interfaceAnimation')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('settings.animationDescription')}
                    </Typography>
                  </Box>
                  <Switch
                    checked={animationEnabled}
                    onChange={(e) => setAnimationEnabled(e.target.checked)}
                    color="primary"
                  />
                </Box>
                
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('settings.transitionSpeed', { speed: animationSpeed })}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">{t('common.slow')}</Typography>
                    <Slider
                      value={animationSpeed}
                      onChange={(e, newValue) => setAnimationSpeed(newValue)}
                      min={100}
                      max={500}
                      step={50}
                      sx={{ 
                        mx: 2, 
                        color: customColors[mode],
                        '& .MuiSlider-thumb': {
                          '&:hover, &.Mui-focusVisible': {
                            boxShadow: `0px 0px 0px 8px ${alpha(customColors[mode], 0.16)}`
                          },
                        },
                      }}
                      disabled={!animationEnabled}
                    />
                    <Typography variant="caption" color="text.secondary">{t('common.fast')}</Typography>
                  </Box>
                </Box>
              </Card>
            </AccordionDetails>
          </Accordion>
          
          {/* 图像设置部分 */}
          <Accordion defaultExpanded sx={{
            mb: 1.5, // 减小
            backgroundColor: alpha(theme.palette.background.paper, 0.6),
            boxShadow: theme.shadows[1],
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}>
            <AccordionSummary 
              expandIcon={<ExpandMoreIcon />}
              sx={{ '& .MuiAccordionSummary-content': { alignItems: 'center' } }}
            >
              <ImageIcon sx={{ mr: 1, color: pageColors[PAGE_IDS.AI_PAINTING] || theme.palette.primary.main }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                {t('settings.imageSettings')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {/* 下载命名设置 */}
              <Card variant="outlined" sx={{ mb: 2, p: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center' }}>
                      <SaveAltIcon sx={{ mr: 0.5, fontSize: '1.2rem', color: pageColors[PAGE_IDS.AI_PAINTING] || theme.palette.primary.main }} />
                      {t('settings.downloadImage')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('settings.downloadSharedRule')}
                    </Typography>
                  </Box>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2,
                    p: 1.25,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.background.default, 0.45),
                    border: `1px solid ${alpha(theme.palette.divider, 0.35)}`,
                  }}
                >
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {t('settings.autoDownload')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('settings.autoDownloadHint')}
                    </Typography>
                  </Box>
                  <Switch
                    checked={autoSaveEnabled}
                    onChange={(e) => setAutoSaveEnabled(e.target.checked)}
                    color="primary"
                  />
                </Box>

                <Box sx={{ mt: 1.5, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                    <LabelIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                    {t('settings.filenameRules')}
                  </Typography>
                  
                  <Box sx={{ pl: 1 }}>
                    <TextField
                      label={t('settings.customPrefix')}
                      value={fileNamePrefix}
                      onChange={(e) => setFileNamePrefix(e.target.value)}
                      fullWidth
                      margin="dense"
                      size="small"
                      helperText={t('settings.prefixExample')}
                    />
                    
                    <Box sx={{ mt: 1.5, mb: 1 }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>{t('settings.downloadPreset')}</Typography>
                      <RadioGroup
                        value={namingMethod}
                        onChange={(e) => setNamingMethod(e.target.value)}
                      >
                        {DOWNLOAD_NAMING_METHODS.map((method) => (
                          <FormControlLabel
                            key={method.value}
                            value={method.value}
                            control={<Radio size="small" />}
                            label={t(`settings.naming.${method.value}`)}
                          />
                        ))}
                      </RadioGroup>
                    </Box>
                  </Box>
                </Box>
                
                <Box sx={{ mt: 2, p: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 1, border: `1px dashed ${theme.palette.divider}` }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                    <VisibilityIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
                    {t('settings.filenamePreview')}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.8rem' }}>
                    {fileNamePreview}
                  </Typography>
                </Box>
              </Card>
            </AccordionDetails>
          </Accordion>
        </Grid>
      </Grid>
      
      {/* 固定在底部的操作栏 */}
      <Paper
        elevation={3}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: { xs: 0, sm: isMobile ? 0 : 80 },
          right: 0,
          p: 1.5, // 减小
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1.5, // 减小
          zIndex: 100,
          borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          backgroundColor: alpha(theme.palette.background.paper, 0.9),
          backdropFilter: 'blur(8px)',
        }}
      >
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={resetSettings}
          sx={{ 
            borderColor: alpha(settingsPageColor, 0.5),
            color: settingsPageColor,
            '&:hover': {
              borderColor: settingsPageColor,
              backgroundColor: alpha(settingsPageColor, 0.04),
            }
          }}
        >
          {t('settings.reset')}
        </Button>
        <Button
          variant="contained"
          startIcon={saveSuccess ? <CheckIcon /> : (isSaving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />)}
          onClick={saveSettings}
          disabled={isSaving}
          sx={{ 
            backgroundColor: settingsPageColor,
            '&:hover': {
              backgroundColor: alpha(settingsPageColor, 0.9),
            },
            transition: 'background-color 0.3s ease',
            minWidth: 110, // 减小
          }}
        >
          {saveSuccess ? t('settings.saved') : (isSaving ? t('settings.saving') : t('settings.save'))}
        </Button>
      </Paper>
      
      {/* 提示信息 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%', mb: 8 }} // 避免被底部操作栏遮挡
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default SettingsPage;
