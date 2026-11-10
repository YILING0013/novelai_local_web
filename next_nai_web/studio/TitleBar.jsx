import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Minus, Square, Copy, X, PanelLeft } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';

export function native(action) { window.chrome.webview.postMessage(action); }

export function ToolButton({ label, children, ...props }) {
  return <button type="button" className="tool-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export default function TitleBar({ auth, title, children, back, forward, onRail }) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [max, setMax] = useState(false);
  useEffect(() => {
    const message = ({ data }) => { if (data === 'maximized' || data === 'normal') setMax(data === 'maximized'); };
    window.chrome.webview.addEventListener('message', message);
    return () => window.chrome.webview.removeEventListener('message', message);
  }, []);
  return <header className="studio-title">
    {!auth && <div className="title-navigation">
      <ToolButton label={zh ? '切换侧栏' : 'Toggle sidebar'} onClick={onRail}><PanelLeft /></ToolButton>
      <ToolButton label={zh ? '后退' : 'Back'} disabled={!back} onClick={back}><ArrowLeft /></ToolButton>
      <ToolButton label={zh ? '前进' : 'Forward'} disabled={!forward} onClick={forward}><ArrowRight /></ToolButton>
    </div>}
    <div className="title-drag">
      <img alt="" src="/logo.png" draggable="false" /><b>NovelAI Local</b>{title && <span>{title}</span>}</div>
    <div className="title-tools">{children}</div>
    <div className="window-buttons">
      <ToolButton label={zh ? '最小化' : 'Minimize'} onClick={() => native('minimize')}><Minus /></ToolButton>
      {!auth && <ToolButton label={max ? (zh ? '还原' : 'Restore') : (zh ? '最大化' : 'Maximize')} onClick={() => native('maximize')}>{max ? <Copy /> : <Square />}</ToolButton>}
      <ToolButton label={zh ? '关闭窗口' : 'Close window'} onClick={() => native('close')}><X /></ToolButton>
    </div>
  </header>;
}
