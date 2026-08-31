import { Geist, Geist_Mono } from "next/font/google";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import "./globals.css";
import AppProviders from "@/providers/AppProviders";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "NovelAI Local",
  description: "Local NovelAI image generation interface",
  applicationName: "NovelAI Local",
};

export const viewport = {
  themeColor: "#ffffff",
  colorScheme: "light dark",
};

const bootstrapAppearance = `
  (function () {
    try {
      var storedLocale = window.localStorage.getItem('novelai-local.locale');
      var locale = storedLocale === 'zh-CN' || storedLocale === 'en-US'
        ? storedLocale
        : 'en-US';
      var theme = window.localStorage.getItem('themeMode') === 'light' ? 'light' : 'dark';
      document.documentElement.lang = locale;
      document.documentElement.dataset.locale = locale;
      document.documentElement.dataset.theme = theme;
      window.__NOVELAI_LOCAL_LOCALE__ = locale;
    } catch (error) {
      document.documentElement.lang = 'en-US';
      document.documentElement.dataset.locale = 'en-US';
      document.documentElement.dataset.theme = 'dark';
    }
  })();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en-US" data-i18n-ready="false" suppressHydrationWarning>
      <head>
        <style>{`html[data-i18n-ready="false"] body { visibility: hidden; }`}</style>
        <script dangerouslySetInnerHTML={{ __html: bootstrapAppearance }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 将 Emotion 样式收集到 head，避免 App Router 流式渲染产生 hydration 偏差。 */}
        <AppRouterCacheProvider>
          <AppProviders>
            {children}
          </AppProviders>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
