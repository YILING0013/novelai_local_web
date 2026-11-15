import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { confirm } from '@tauri-apps/plugin-dialog';

const DesktopHistory = createContext(null);

/**
 * 记录当前窗口的路由历史边界，模块和子页面都使用同一套前进、后退。
 * @param {object} props 当前窗口的页面内容。
 * @returns {React.ReactElement} 提供历史操作的页面树。
 */
export function DesktopHistoryProvider({ children }) {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const paths = useRef(new Map());
  const [bounds, setBounds] = useState(() => ({ index: window.history.state?.idx || 0, end: window.history.state?.idx || 0 }));
  useEffect(() => {
    const index = window.history.state?.idx || 0;
    paths.current.set(index, location.pathname);
    if (action === 'PUSH') for (const key of paths.current.keys()) if (key > index) paths.current.delete(key);
    setBounds((previous) => ({ index, end: action === 'PUSH' ? index : Math.max(previous.end, index) }));
  }, [location.key, location.pathname, action]);
  const go = useCallback(async (offset, leaveMessage) => {
    try {
      if (['/main', '/local'].includes(location.pathname) && paths.current.get(bounds.index + offset) !== location.pathname
        && !await confirmWorkspaceLeave(leaveMessage)) return;
      navigate(offset);
    } catch (error) { window.dispatchEvent(new CustomEvent('desktop-window-error', { detail: error })); }
  }, [bounds.index, location.pathname, navigate]);
  const value = useMemo(() => ({ canBack: bounds.index > 0, canForward: bounds.index < bounds.end, go }), [bounds, go]);
  return createElement(DesktopHistory.Provider, { value }, children);
}

/** 返回本窗口路由的前进、后退状态和导航操作。 */
export function useDesktopHistory() { return useContext(DesktopHistory); }

/**
 * 关闭窗口和离开本机工具前询问各页面是否有在途处理或未保存结果。
 * @param {string} message 当前界面语言的离开提示。
 * @returns {Promise<boolean>} 没有待保存内容或用户明确选择离开时返回 true。
 */
export async function confirmWorkspaceLeave(message) {
  const unsaved = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unsaved);
  return !unsaved.defaultPrevented || await confirm(message, { title: 'NovelAI Local', kind: 'warning' });
}

/** 将现有页面跳转保持为桌面内部路由，禁止后端跳转把主窗口带到外站。 */
export function desktopNavigate(path, replace = false) {
  const target = new URL(path, 'https://desktop.invalid');
  if (target.origin !== 'https://desktop.invalid') throw new Error('DESKTOP_ROUTE_NOT_ALLOWED');
  const route = `#${target.pathname}${target.search}`;
  if (replace) window.location.replace(`${window.location.pathname}${route}`);
  else window.location.hash = route;
}

/** 为多个迁入页面提供一致的客户端 push/replace/back 操作。 */
export function useRouter() {
  const navigate = useNavigate();
  return useMemo(() => ({
    push: (path) => navigate(path),
    replace: (path) => navigate(path, { replace: true }),
    back: () => navigate(-1),
    refresh: () => window.location.reload(),
  }), [navigate]);
}

/** 读取当前业务路径；窗口自身的资源 URL 不参与业务路由。 */
export function usePathname() { return useLocation().pathname; }
