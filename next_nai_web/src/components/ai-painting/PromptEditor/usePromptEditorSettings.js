'use client';

import { useEffect, useSyncExternalStore } from 'react';

const defaults = {
  inlinePreview: true,
  expandedPreview: null,
  overlayPreview: false,
  suggestionsEnabled: true,
};
const storageKey = 'prompt-editor-settings';
const listeners = new Set();
let settings = defaults;
let hydrated = false;

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => settings;
const getServerSnapshot = () => defaults;

/** 更新一个编辑选项并通知所有已打开的编辑器；浏览器禁止存储时仍在当前页面生效。 */
const setSetting = (name, enabled) => {
  settings = { ...settings, [name]: enabled };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // 隐私模式可能禁用浏览器存储，当前会话仍可切换编辑选项。
  }
  listeners.forEach((listener) => listener());
};

/**
 * 读取并保存提示词编辑偏好；不同编辑入口共用同一份设置。
 * @returns {object} 预览方式、联想开关及设置更新函数。
 */
export default function usePromptEditorSettings() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (hydrated) return;
    hydrated = true;
    // 首屏使用相同默认值，挂载后再读偏好，避免服务端与浏览器首屏不一致。
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey));
      settings = { ...defaults, ...saved };
    } catch {
      // 旧存储损坏或无法读取时使用默认值，用户可重新选择。
    }
    listeners.forEach((listener) => listener());
  }, []);
  return { ...snapshot, setSetting };
}
