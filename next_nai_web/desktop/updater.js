import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { confirmWorkspaceLeave } from '@/desktop/navigation';

/** 订阅原生进程共享的更新状态，较旧的异步响应不能覆盖新进度。 */
export function useDesktopUpdater() {
  const [status, setStatus] = useState({ revision: -1, phase: 'idle' });
  useEffect(() => {
    let disposed = false;
    let stop;
    const apply = (next) => { if (!disposed) setStatus((current) => next.revision > current.revision ? next : current); };
    listen('desktop-update', ({ payload }) => apply(payload)).then((unlisten) => {
      if (disposed) unlisten();
      else { stop = unlisten; void invoke('updater_status').then(apply).catch(() => { if (!disposed) setStatus({ revision: 0, phase: 'error', error: 'UPDATE_CHECK_FAILED' }); }); }
    }).catch(() => { if (!disposed) setStatus({ revision: 0, phase: 'error', error: 'UPDATE_CHECK_FAILED' }); });
    return () => { disposed = true; stop?.(); };
  }, []);
  return status;
}

/** 在生成、上传、推理等真实任务期间阻止安装，下载更新仍然可用。 */
export function useUpdateBlocker(busy) {
  useEffect(() => {
    if (!busy) return undefined;
    const block = (event) => event.preventDefault();
    window.addEventListener('desktop-before-update', block);
    return () => window.removeEventListener('desktop-before-update', block);
  }, [busy]);
}

/**
 * 确认退出并等待持久化完成，最后才让原生安装器接管进程。
 * @param {boolean} zh 是否显示中文确认文案。
 * @returns {Promise<boolean>} 用户取消返回 false；安装失败抛出稳定错误码。
 */
export async function installDesktopUpdate(zh) {
  const available = new Event('desktop-before-update', { cancelable: true });
  window.dispatchEvent(available);
  if (available.defaultPrevented) throw new Error('UPDATE_WORKSPACE_BUSY');
  if (!await confirm(zh ? '应用将关闭并安装更新，完成后自动重新打开。现在安装？' : 'The app will close, install the update, then reopen. Install now?', { title: 'NovelAI Local', kind: 'info' })) return false;
  if (!await confirmWorkspaceLeave(zh ? '有尚未保存的内容。请先保存；继续安装将关闭当前工作区。仍要继续？' : 'There is unsaved work. Save it first; continuing will close this workspace. Continue?')) return false;
  // 原生确认窗期间任务可能变化，真正退出前再次检查，随后等待全部本机写入。
  const recheck = new Event('desktop-before-update', { cancelable: true });
  window.dispatchEvent(recheck);
  if (recheck.defaultPrevented) throw new Error('UPDATE_WORKSPACE_BUSY');
  const pending = [];
  window.dispatchEvent(new CustomEvent('desktop-flush-before-update', { detail: { waitUntil: (promise) => pending.push(Promise.resolve(promise)) } }));
  await Promise.all(pending);
  await invoke('updater_install');
  return true;
}
