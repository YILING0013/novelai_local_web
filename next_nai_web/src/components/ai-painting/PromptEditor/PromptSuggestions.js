import { useEffect, useRef } from 'react';
import { Box, CircularProgress, IconButton, List, ListItemButton, Paper, Popper, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 显示不占用页面高度的双语候选菜单，点击时保留编辑器的光标和选区。
 * @param {object} props 联想 Hook 返回的 suggestions 状态。
 * @returns {React.ReactElement} 跟随当前输入框的悬浮候选菜单。
 */
export default function PromptSuggestions({ suggestions }) {
  const { t } = useI18n();
  const listRef = useRef(null);
  const { open, anchor, tags, loading, error, upstreamUnavailable, listId, activeIndex, setActiveIndex, choose, close } = suggestions;
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <Popper
      open={open}
      anchorEl={anchor}
      placement="bottom-start"
      modifiers={[{ name: 'offset', options: { offset: [0, 6] } },
        { name: 'preventOverflow', options: { padding: 8 } }]}
      sx={{
        zIndex: (theme) => theme.zIndex.modal + 2,
        width: 'max-content',
        minWidth: 'min(168px, calc(100vw - 16px))',
        maxWidth: 'min(320px, calc(100vw - 16px))',
      }}
    >
      <Paper
        elevation={8}
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        // 阻止外围 Drawer 接管手势，但保留浏览器对候选列表的原生触摸滚动。
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        sx={{
          height: 200, maxHeight: 'calc(100dvh - 16px)', width: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: 1, borderColor: 'divider', borderRadius: 2, userSelect: 'none',
        }}
      >
        {/* 标题与状态文案不参与宽度计算，面板宽度由候选文字决定。 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.5, pr: 0.5, py: 0.25, flexShrink: 0, contain: 'inline-size' }}>
          <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {t('painting.workspace.prompt.matchingTagSuggestions')}
          </Typography>
          <IconButton size="small" aria-label={t('common.close')} title={t('common.close')} onClick={close} sx={{ flexShrink: 0 }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        {upstreamUnavailable && !loading && <Typography role="status" variant="caption" color="text.secondary" component="div" sx={{ px: 1.5, pb: 0.75, flexShrink: 0, contain: 'inline-size', overflowWrap: 'anywhere' }}>
          {t('painting.workspace.prompt.localSuggestionsOnly')}
        </Typography>}
        {loading ? <Box role="status" sx={{ p: 1.5, display: 'flex', alignItems: 'flex-start', gap: 1, minHeight: 0, contain: 'inline-size', overflowY: 'auto' }}>
          <CircularProgress size={16} sx={{ flexShrink: 0 }} />
          <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t('painting.workspace.prompt.suggestionsLoading')}</Typography>
        </Box> : error ? <Typography role="status" variant="body2" color="error" sx={{ p: 1.5, minHeight: 0, contain: 'inline-size', overflowWrap: 'anywhere', overflowY: 'auto' }}>
          {t('painting.workspace.prompt.suggestionsFailed')}
        </Typography> : <List ref={listRef} id={listId} role="listbox" aria-label={t('painting.workspace.prompt.matchingTagSuggestions')} disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', touchAction: 'pan-y', scrollbarGutter: 'stable' }}>
          {tags.map((tag, index) => (
            <ListItemButton key={tag.name} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
              selected={index === activeIndex} tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(tag)}
              sx={{ display: 'block', py: 0.75, px: 1.5 }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere', fontWeight: 500 }}>{tag.name}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {tag.translation || t('painting.workspace.prompt.noTagTranslation')}
              </Typography>
            </ListItemButton>
          ))}
        </List>}
      </Paper>
    </Popper>
  );
}
