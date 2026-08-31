"use client";

import React, { useEffect } from 'react';
import { LanguageProvider, useI18n } from '@/i18n/I18nProvider';
import { AppThemeProvider, useAppTheme } from './AppThemeProvider';

/**
 * 在语言与主题都初始化后显示页面，避免首次渲染闪现错误语言或主题。
 * @param {{children: React.ReactNode}} props 页面内容。
 * @returns {React.ReactNode} 原样返回的应用内容。
 */
function ProviderReadiness({ children }) {
  const { ready: localeReady } = useI18n();
  const { ready: themeReady } = useAppTheme();

  useEffect(() => {
    if (localeReady && themeReady) {
      document.documentElement.dataset.i18nReady = 'true';
    }
  }, [localeReady, themeReady]);

  return children;
}

/**
 * 组合全站语言与主题 Provider。
 * @param {{children: React.ReactNode}} props 根布局下的页面内容。
 * @returns {React.ReactElement} 已注入语言和主题能力的应用内容。
 */
export function AppProviders({ children }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          const workerUrls = [
            registration.installing?.scriptURL,
            registration.waiting?.scriptURL,
            registration.active?.scriptURL,
          ].filter(Boolean);
          const isLegacyRegistration = workerUrls.some((scriptUrl) => {
            return new URL(scriptUrl, window.location.href).pathname === '/sw.js';
          }) || new URL(registration.scope, window.location.href).pathname === '/sw.js';

          if (isLegacyRegistration) {
            void registration.unregister();
          }
        });
      });
    }

    if ('caches' in window) {
      void caches.keys().then((cacheNames) => {
        cacheNames
          .filter((cacheName) => cacheName.startsWith('idlecloud-pwa-'))
          .forEach((cacheName) => void caches.delete(cacheName));
      });
    }
  }, []);

  return (
    <LanguageProvider>
      <AppThemeProvider>
        <ProviderReadiness>{children}</ProviderReadiness>
      </AppThemeProvider>
    </LanguageProvider>
  );
}

export default AppProviders;
