'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/utils/ApiClient';
import { getCachedPromptTranslations, loadPromptTranslations, retryPromptTranslations } from './promptTranslation.mjs';

let warningShown = false;

/**
 * 用户停止输入三秒后查询翻译，正负提示词和展开编辑器共用缓存及进行中的请求。
 * @param {string} text 当前完整提示词。
 * @param {object} options enabled 控制启用，targetLanguage 为 auto、zh、en、ja 或 ko。
 * @returns {object} 当前原文的 tags/译文，以及整次浏览器会话只出现一次的警告状态和重试操作。
 */
export default function usePromptTranslations(text, { enabled = true, targetLanguage = 'auto' } = {}) {
  const [, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setShowError(false);
      return;
    }
    if (!text.trim()) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        await loadPromptTranslations(text, targetLanguage, (tags, options) => apiClient.translatePromptTags(tags, options), {
          signal: controller.signal,
          onDictionaryReady: () => { if (active) setRevision((value) => value + 1); },
        });
      } catch {
        if (active && !warningShown) {
          warningShown = true;
          // sessionStorage 保证刷新页面后也不会再次打扰；不可用时仍保留当前页面内的一次限制。
          let alreadyShown = false;
          try {
            alreadyShown = sessionStorage.getItem('prompt-translation-warning') === '1';
            sessionStorage.setItem('prompt-translation-warning', '1');
          } catch { /* 隐私模式可能拒绝浏览器存储。 */ }
          if (!alreadyShown) setShowError(true);
        }
      } finally {
        if (active) setRevision((value) => value + 1);
      }
    }, 3000);
    // 已经发出的请求由其他预览复用并填充缓存；只禁止旧响应更新本次界面。
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [text, enabled, targetLanguage, attempt]);

  // 每次缓存完成后用当前文字重新读取，不能复用旧请求的原文下标。
  const snapshot = enabled ? getCachedPromptTranslations(text, targetLanguage) : { tags: [], translations: {} };

  return {
    ...snapshot, showError: enabled && showError,
    dismissError: () => setShowError(false),
    retry: () => {
      setShowError(false);
      retryPromptTranslations();
      setAttempt((value) => value + 1);
    },
  };
}
