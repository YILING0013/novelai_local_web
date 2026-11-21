import { useEffect, useRef, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

const closedDrawerWidth = 64;
const minExpandedDrawerWidth = 160;
const maxDrawerWidth = 340;

// 图标栏按固定宽度吸附，给从边缘拉开和展开文字各留一段拖动距离。
function snapDrawerWidth(width) {
  if (width < 48) return 0;
  if (width < 112) return closedDrawerWidth;
  return Math.min(maxDrawerWidth, Math.max(minExpandedDrawerWidth, Math.round(width)));
}

/** 读取并保存桌面侧栏宽度，兼容之前的三档显示设置。 */
export function useNavigationWidth() {
  const [desktopDrawerWidth, setDesktopDrawerWidth] = useState(closedDrawerWidth);
  const drawerDrag = useRef(null);
  useEffect(() => {
    try {
      const savedWidth = localStorage.getItem('main.desktopDrawerWidth');
      if (savedWidth !== null && Number.isFinite(Number(savedWidth))) {
        setDesktopDrawerWidth(snapDrawerWidth(Number(savedWidth)));
      } else {
        const savedMode = localStorage.getItem('main.desktopDrawerMode');
        if (savedMode === 'hidden') setDesktopDrawerWidth(0);
        if (savedMode === 'expanded') setDesktopDrawerWidth(208);
      }
    } catch (error) {
      console.warn('无法读取侧栏显示偏好:', error);
    }
  }, []);
  const saveDesktopDrawerWidth = (width) => {
    setDesktopDrawerWidth(width);
    try {
      localStorage.setItem('main.desktopDrawerWidth', String(width));
    } catch (error) {
      console.warn('无法保存侧栏显示偏好:', error);
    }
  };
  return { desktopDrawerWidth, setDesktopDrawerWidth, saveDesktopDrawerWidth, drawerDrag };
}

/** 提供侧栏边缘的拖动手柄，支持方向键及 Home、End 调整宽度。 */
export function NavigationResizeHandle({ desktopDrawerWidth: sidebarWidth, setDesktopDrawerWidth, saveDesktopDrawerWidth, drawerDrag }) {
  const { t } = useI18n();
  const theme = useTheme();
  return <Box role="separator" tabIndex={0} aria-orientation="vertical" aria-controls="main-navigation"
              aria-label={t('main.resizeSidebar')} aria-valuemin={0} aria-valuemax={maxDrawerWidth} aria-valuenow={sidebarWidth}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                drawerDrag.current = { startX: event.clientX, startWidth: sidebarWidth, width: sidebarWidth };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = drawerDrag.current;
                if (!event.isPrimary || !drag) return;
                drag.width = snapDrawerWidth(drag.startWidth + event.clientX - drag.startX);
                setDesktopDrawerWidth(drag.width);
              }}
              onLostPointerCapture={() => {
                if (drawerDrag.current) saveDesktopDrawerWidth(drawerDrag.current.width);
                drawerDrag.current = null;
              }}
              onKeyDown={(event) => {
                let width;
                if (event.key === 'Home') width = 0;
                else if (event.key === 'End') width = maxDrawerWidth;
                else if (event.key === 'ArrowLeft') width = sidebarWidth <= closedDrawerWidth ? 0 : sidebarWidth === minExpandedDrawerWidth ? closedDrawerWidth : Math.max(minExpandedDrawerWidth, sidebarWidth - 16);
                else if (event.key === 'ArrowRight') width = sidebarWidth === 0 ? closedDrawerWidth : sidebarWidth === closedDrawerWidth ? minExpandedDrawerWidth : Math.min(maxDrawerWidth, sidebarWidth + 16);
                else return;
                event.preventDefault();
                saveDesktopDrawerWidth(width);
              }}
              sx={{
                position: 'fixed', left: Math.max(0, sidebarWidth - 4), top: '50%', transform: 'translateY(-50%)',
                zIndex: theme.zIndex.drawer + 1, width: 9, height: 64, display: 'grid', placeItems: 'center',
                cursor: 'col-resize', touchAction: 'none', userSelect: 'none',
                '&::after': { content: '""', width: 3, height: 42, borderRadius: 4, bgcolor: 'text.disabled' },
                '&:hover::after, &:focus-visible::after, &:active::after': { bgcolor: 'primary.main' },
              }} />;
}
