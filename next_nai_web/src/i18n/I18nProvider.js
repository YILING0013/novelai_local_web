"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import coreZhCN from './locales/core.zh-CN';
import coreEnUS from './locales/core.en-US';
import paintingZhCN from './locales/painting.zh-CN';
import paintingEnUS from './locales/painting.en-US';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getTranslationValue,
  interpolateTranslation,
  mergeLocaleDomains,
  normalizeLocale,
  resolveLocalePreference,
  resolveLocaleStorageEvent,
} from './utils.mjs';

const dictionaries = Object.freeze({
  'zh-CN': mergeLocaleDomains(coreZhCN, paintingZhCN),
  'en-US': mergeLocaleDomains(coreEnUS, paintingEnUS),
});

const I18nContext = createContext(null);
const warnedMissingKeys = new Set();

/**
 * 从浏览器环境读取已保存的语言；没有有效标记时使用英文。
 *
 * Args:
 *   storage: localStorage 风格的存储对象。
 *
 * Returns:
 *   string: 应用支持的 locale。
 */
function readInitialLocale(storage) {
  const storedLocale = storage?.getItem(LOCALE_STORAGE_KEY);
  return resolveLocalePreference(storedLocale);
}

/**
 * 提供全站语言状态、翻译与本地化格式化能力。
 *
 * Args:
 *   children: 需要消费国际化上下文的 React 子树。
 *
 * Returns:
 *   React.ReactElement: 国际化上下文 Provider。
 */
export function LanguageProvider({ children }) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let initialLocale = DEFAULT_LOCALE;
    try {
      initialLocale = readInitialLocale(window.localStorage);
      window.localStorage.setItem(LOCALE_STORAGE_KEY, initialLocale);
    } catch (error) {
      console.warn('Unable to initialize locale storage:', error);
      initialLocale = DEFAULT_LOCALE;
    }

    setLocaleState(initialLocale);
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  useEffect(() => {
    const handleStorage = (event) => {
      const nextLocale = resolveLocaleStorageEvent(event);
      if (nextLocale) {
        setLocaleState(nextLocale);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLocale = useCallback((nextLocale) => {
    const normalized = normalizeLocale(nextLocale, DEFAULT_LOCALE);
    setLocaleState(normalized);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch (error) {
      console.warn('Unable to persist locale:', error);
    }
  }, []);

  const t = useCallback((key, params = {}) => {
    const localizedValue = getTranslationValue(dictionaries[locale], key);
    const fallbackValue = getTranslationValue(dictionaries[DEFAULT_LOCALE], key);
    const value = typeof localizedValue === 'string' || typeof localizedValue === 'number'
      ? localizedValue
      : fallbackValue;

    if (typeof value !== 'string' && typeof value !== 'number') {
      if (process.env.NODE_ENV !== 'production' && !warnedMissingKeys.has(key)) {
        warnedMissingKeys.add(key);
        console.warn(`Missing translation key: ${key}`);
      }
      return key;
    }
    return interpolateTranslation(value, params);
  }, [locale]);

  const formatDate = useCallback((value, options = {}) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale, options).format(date);
  }, [locale]);

  const formatNumber = useCallback((value, options = {}) => (
    new Intl.NumberFormat(locale, options).format(value)
  ), [locale]);

  const contextValue = useMemo(() => ({
    locale,
    setLocale,
    t,
    formatDate,
    formatNumber,
    ready,
  }), [locale, setLocale, t, formatDate, formatNumber, ready]);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

/**
 * 获取全站国际化上下文。
 *
 * Args:
 *   无。
 *
 * Returns:
 *   object: locale、setLocale、t、formatDate、formatNumber 与 ready。
 */
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within LanguageProvider.');
  }
  return context;
}

export { dictionaries };
