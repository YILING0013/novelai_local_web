import { useEffect, useState } from 'react';
import { Snackbar } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import { shareImage } from './imageShare';

function shareSource(image) {
  if (!(image instanceof HTMLImageElement) || !image.naturalWidth || !image.isConnected) return '';
  const src = image.dataset.shareImageUrl || image.currentSrc;
  if (!src) return '';
  const url = new URL(src, window.location.href);
  if (url.protocol === 'blob:' || /^data:image\/(?!svg\+xml)/i.test(src)) return url.href;
  if (url.origin === window.location.origin) {
    return url.pathname.startsWith('/api/local/') ? url.href : '';
  }
  return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
}

/** 长按页面中的内容图片可唤起系统分享，滑动、缩放和普通点击仍交给原控件。 */
export default function ImageShareGesture() {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let press;
    let sharing = false;
    let suppressUntil = 0;
    const clear = () => {
      clearTimeout(press?.timer);
      press = null;
    };
    const share = (image) => {
      const source = shareSource(image);
      if (!source || sharing) return;
      sharing = true;
      suppressUntil = performance.now() + 1000;
      void shareImage(source, image.dataset.shareImageName, t('imageShare.title'))
        .catch(() => setFailed(true))
        .finally(() => { sharing = false; });
    };
    const start = (event) => {
      clear();
      if (!event.isPrimary || event.button !== 0 || !shareSource(event.target)) return;
      const { pointerId, clientX, clientY, target } = event;
      press = { pointerId, clientX, clientY, timer: setTimeout(() => share(target), 500) };
    };
    const move = (event) => {
      if (press?.pointerId === event.pointerId
          && Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > 12) clear();
    };
    const contextMenu = (event) => {
      if (!shareSource(event.target)) return;
      event.preventDefault();
      if (event.pointerType === 'mouse' || event.button === 2) {
        clear();
        share(event.target);
      }
    };
    const suppressClick = (event) => {
      if (performance.now() < suppressUntil && shareSource(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const listeners = [
      ['pointerdown', start], ['pointermove', move], ['pointerup', clear], ['pointercancel', clear],
      ['contextmenu', contextMenu], ['click', suppressClick], ['scroll', clear], ['visibilitychange', clear],
    ];
    for (const [event, handler] of listeners) document.addEventListener(event, handler, true);
    return () => {
      clear();
      for (const [event, handler] of listeners) document.removeEventListener(event, handler, true);
    };
  }, [t]);
  return <Snackbar open={failed} message={t('imageShare.sendFailed')} autoHideDuration={4500} onClose={() => setFailed(false)} />;
}
