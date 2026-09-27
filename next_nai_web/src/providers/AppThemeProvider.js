"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CssBaseline } from '@mui/material';
import { alpha, createTheme, ThemeProvider } from '@mui/material/styles';
import { DEFAULT_THEME_SETTINGS } from './themePresets.mjs';

const THEME_STORAGE_KEYS = new Set([
  'themeMode',
  'themePrimaryLight',
  'themePrimaryDark',
  'themeBackgroundDefaultLight',
  'themeBackgroundPaperLight',
  'themeBackgroundDrawerLight',
  'themeBackgroundDefaultDark',
  'themeBackgroundPaperDark',
  'themeBackgroundDrawerDark',
  'animationEnabled',
  'animationSpeed',
]);

const AppThemeContext = createContext(null);

/**
 * 从本地存储读取完整主题设置。
 *
 * Args:
 *   storage: localStorage 风格的存储对象。
 *
 * Returns:
 *   object: 归一化后的主题配置。
 */
function readThemeSettings(storage) {
  const storedMode = storage?.getItem('themeMode');
  const speed = Number.parseInt(storage?.getItem('animationSpeed') || '300', 10);
  return {
    mode: storedMode === 'light' ? 'light' : 'dark',
    primaryColors: {
      light: storage?.getItem('themePrimaryLight') || DEFAULT_THEME_SETTINGS.primaryColors.light,
      dark: storage?.getItem('themePrimaryDark') || DEFAULT_THEME_SETTINGS.primaryColors.dark,
    },
    backgroundColors: {
      light: {
        default: storage?.getItem('themeBackgroundDefaultLight') || DEFAULT_THEME_SETTINGS.backgroundColors.light.default,
        paper: storage?.getItem('themeBackgroundPaperLight') || DEFAULT_THEME_SETTINGS.backgroundColors.light.paper,
        drawer: storage?.getItem('themeBackgroundDrawerLight') || DEFAULT_THEME_SETTINGS.backgroundColors.light.drawer,
      },
      dark: {
        default: storage?.getItem('themeBackgroundDefaultDark') || DEFAULT_THEME_SETTINGS.backgroundColors.dark.default,
        paper: storage?.getItem('themeBackgroundPaperDark') || DEFAULT_THEME_SETTINGS.backgroundColors.dark.paper,
        drawer: storage?.getItem('themeBackgroundDrawerDark') || DEFAULT_THEME_SETTINGS.backgroundColors.dark.drawer,
      },
    },
    animationEnabled: storage?.getItem('animationEnabled') !== 'false',
    animationSpeed: Number.isFinite(speed) ? speed : DEFAULT_THEME_SETTINGS.animationSpeed,
  };
}

/**
 * 提供全站一致的 MUI 主题与主题切换状态。
 *
 * Args:
 *   children: 需要消费主题的 React 子树。
 *
 * Returns:
 *   React.ReactElement: 主题上下文与 MUI ThemeProvider。
 */
export function AppThemeProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_THEME_SETTINGS);
  const [ready, setReady] = useState(false);

  const reloadFromStorage = useCallback(() => {
    try {
      setSettings(readThemeSettings(window.localStorage));
    } catch (error) {
      console.warn('Unable to load theme settings:', error);
      setSettings(DEFAULT_THEME_SETTINGS);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    reloadFromStorage();

    const handleThemeUpdate = (event) => {
      const detail = event.detail || {};
      setSettings((current) => ({
        ...current,
        ...(detail.mode ? { mode: detail.mode } : {}),
        ...(detail.primaryColors ? { primaryColors: detail.primaryColors } : {}),
        ...(detail.backgroundColors ? { backgroundColors: detail.backgroundColors } : {}),
        ...(detail.animationEnabled !== undefined ? { animationEnabled: detail.animationEnabled } : {}),
        ...(detail.animationSpeed ? { animationSpeed: detail.animationSpeed } : {}),
      }));
    };
    const handleStorage = (event) => {
      if (event.key === null || THEME_STORAGE_KEYS.has(event.key)) {
        reloadFromStorage();
      }
    };

    window.addEventListener('themeUpdate', handleThemeUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('themeUpdate', handleThemeUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, [reloadFromStorage]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.mode;
  }, [settings.mode]);

  const setMode = useCallback((mode) => {
    const normalized = mode === 'light' ? 'light' : 'dark';
    setSettings((current) => ({ ...current, mode: normalized }));
    try {
      window.localStorage.setItem('themeMode', normalized);
    } catch (error) {
      console.warn('Unable to persist theme mode:', error);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings((current) => {
      const nextMode = current.mode === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem('themeMode', nextMode);
      } catch (error) {
        console.warn('Unable to persist theme mode:', error);
      }
      return { ...current, mode: nextMode };
    });
  }, []);

  const theme = useMemo(() => createTheme({
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: 'var(--font-geist-sans), "Microsoft YaHei", sans-serif',
      h4: { fontWeight: 650, letterSpacing: '-0.035em' },
      h5: { fontWeight: 650, letterSpacing: '-0.025em' },
      h6: { fontWeight: 600, letterSpacing: '-0.015em' },
      subtitle1: { fontWeight: 600, fontSize: '0.9375rem' },
      subtitle2: { fontWeight: 600 },
      body1: { fontSize: '0.9375rem', lineHeight: 1.65 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.6 },
      button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    },
    palette: {
      mode: settings.mode,
      primary: {
        main: settings.mode === 'light'
          ? settings.primaryColors.light
          : settings.primaryColors.dark,
      },
      secondary: { main: settings.mode === 'light' ? '#746A85' : '#AFA3BE' },
      success: { main: settings.mode === 'light' ? '#4C7A62' : '#8FB29B' },
      warning: { main: settings.mode === 'light' ? '#9A713B' : '#D0AD78' },
      error: { main: settings.mode === 'light' ? '#B55455' : '#DB9292' },
      info: { main: settings.mode === 'light' ? '#58779A' : '#8EAAC8' },
      text: {
        primary: settings.mode === 'light' ? '#272B32' : '#E7E9EE',
        secondary: settings.mode === 'light' ? '#58616D' : '#A2A8B2',
      },
      divider: settings.mode === 'light' ? 'rgba(39,43,50,0.12)' : 'rgba(231,233,238,0.12)',
      background: settings.backgroundColors[settings.mode],
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          ':root': {
            '--background': theme.palette.background.default,
            '--foreground': theme.palette.text.primary,
            '--scrollbar-thumb': alpha(theme.palette.text.primary, 0.22),
            colorScheme: theme.palette.mode,
          },
          body: { WebkitFontSmoothing: 'antialiased' },
          '::selection': { backgroundColor: alpha(theme.palette.primary.main, 0.24) },
          ':focus-visible': { outlineOffset: 3 },
        }),
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 8,
            transition: `background-color ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease, border-color ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease`,
          },
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
          outlined: ({ theme }) => ({ borderColor: alpha(theme.palette.text.primary, 0.2) }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
          }),
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            transition: `background-color ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease, color ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease`,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            transition: `background-color ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease, border-color ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease`,
          },
          outlined: ({ theme }) => ({ borderColor: theme.palette.divider }),
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRadius: 12,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 20px 64px rgba(0,0,0,0.35)'
              : '0 20px 64px rgba(39,43,50,0.12)',
          }),
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 600, fontSize: '1.125rem' } } },
      MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgba(12,15,20,0.5)' } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: alpha(theme.palette.text.primary, 0.025),
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha(theme.palette.text.primary, 0.32) },
          }),
          notchedOutline: ({ theme }) => ({ borderColor: theme.palette.divider }),
        },
      },
      MuiAccordion: {
        styleOverrides: {
          root: { boxShadow: 'none', backgroundImage: 'none', '&::before': { display: 'none' } },
        },
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: theme.palette.text.primary,
            '&:hover': { backgroundColor: theme.palette.action.hover },
          }),
        },
      },
      MuiTabs: { styleOverrides: { indicator: { height: 2, borderRadius: 2 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } } },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 6, fontWeight: 500 },
          sizeSmall: { height: 24 },
        },
      },
      MuiSlider: {
        styleOverrides: {
          root: { height: 3 },
          thumb: ({ theme }) => ({
            width: 12,
            height: 12,
            boxShadow: 'none',
            '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 5px ${alpha(theme.palette.primary.main, 0.12)}` },
          }),
          rail: { opacity: 0.15 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 400 },
          standardInfo: ({ theme }) => ({ backgroundColor: alpha(theme.palette.info.main, 0.08) }),
          standardWarning: ({ theme }) => ({ backgroundColor: alpha(theme.palette.warning.main, 0.08) }),
          standardError: ({ theme }) => ({ backgroundColor: alpha(theme.palette.error.main, 0.08) }),
          standardSuccess: ({ theme }) => ({ backgroundColor: alpha(theme.palette.success.main, 0.08) }),
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 6, fontSize: '0.75rem', fontWeight: 400 },
        },
      },
    },
  }), [settings]);

  const contextValue = useMemo(() => ({
    ...settings,
    setMode,
    toggleTheme,
    reloadFromStorage,
    ready,
  }), [settings, setMode, toggleTheme, reloadFromStorage, ready]);

  return (
    <AppThemeContext.Provider value={contextValue}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppThemeContext.Provider>
  );
}

/**
 * 获取全站主题状态和操作函数。
 *
 * Args:
 *   无。
 *
 * Returns:
 *   object: 当前主题配置、切换函数与初始化状态。
 */
export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used within AppThemeProvider.');
  }
  return context;
}
