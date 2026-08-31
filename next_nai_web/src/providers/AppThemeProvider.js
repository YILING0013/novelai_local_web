"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CssBaseline } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

const DEFAULT_THEME_SETTINGS = Object.freeze({
  mode: 'dark',
  primaryColors: { light: '#00796B', dark: '#4DB6AC' },
  backgroundColors: {
    light: { default: '#f0f4f8', paper: '#ffffff', drawer: '#eef2f6' },
    dark: { default: '#0d1117', paper: '#161b22', drawer: '#11161d' },
  },
  animationEnabled: true,
  animationSpeed: 300,
});

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
    palette: {
      mode: settings.mode,
      primary: {
        main: settings.mode === 'light'
          ? settings.primaryColors.light
          : settings.primaryColors.dark,
      },
      background: settings.backgroundColors[settings.mode],
    },
    components: {
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            transition: `all ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease-in-out`,
            '&:hover': {
              transform: settings.animationEnabled ? 'translateX(4px)' : 'none',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            transition: `all ${settings.animationEnabled ? settings.animationSpeed : 0}ms ease-in-out`,
          },
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
