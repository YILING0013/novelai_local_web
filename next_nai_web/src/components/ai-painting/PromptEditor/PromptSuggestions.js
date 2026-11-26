import { useEffect, useRef } from 'react';
import { Box, ButtonBase, CircularProgress, IconButton, Paper, Popper, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { useI18n } from '@/i18n/I18nProvider';

const modifiers = [
  { name: 'offset', options: { offset: [0, 6] } },
  // 水平空间不够时只平移菜单，避免翻成右缘对齐。
  { name: 'flip', options: { altAxis: false, fallbackPlacements: ['top-start'] } },
  { name: 'preventOverflow', options: { padding: 8, tether: false } },
];

/**
 * 显示不占用页面高度的双语候选菜单，点击时保留编辑器的光标和选区。
 * @param {object} props 联想 Hook 返回的 suggestions 状态。
 * @returns {React.ReactElement} 跟随当前输入框的悬浮候选菜单。
 */
export default function PromptSuggestions({ suggestions }) {
  const { t } = useI18n();
  const listRef = useRef(null);
  const { open, anchor, tags, loading, error, suggestionLayout, suggestionTextLayout, listId, activeIndex, setActiveIndex, choose, close } = suggestions;
  const columns = suggestionLayout === 'columns';
  const stacked = suggestionTextLayout === 'vertical';
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <Popper data-suggestion-popup=""
      open={open}
      anchorEl={anchor}
      placement="bottom-start"
      modifiers={modifiers}
      sx={{
        zIndex: (theme) => theme.zIndex.modal + 2,
        width: 'max-content',
        minWidth: columns && tags.length > 0 ? `min(${Math.min(tags.length, 3) * 150 + 14}px, calc(100vw - 16px))` : undefined,
        maxWidth: 'min(500px, calc(100vw - 16px))',
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
          maxHeight: 'min(272px, 44dvh)', width: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: 1, borderColor: 'divider', borderRadius: 2, userSelect: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.25, pr: 0.5, py: 0.25, flexShrink: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {t('painting.workspace.prompt.matchingTagSuggestions')}
          </Typography>
          <IconButton size="small" aria-label={t('common.close')} title={t('common.close')} onClick={close} sx={{ flexShrink: 0 }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        {loading ? <Box role="status" sx={{ p: 1.5, display: 'flex', alignItems: 'flex-start', gap: 1, minHeight: 0, overflowY: 'auto' }}>
          <CircularProgress size={16} sx={{ flexShrink: 0 }} />
          <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t('painting.workspace.prompt.suggestionsLoading')}</Typography>
        </Box> : error ? <Typography role="status" variant="body2" color="error" sx={{ p: 1.5, minHeight: 0, overflowWrap: 'anywhere', overflowY: 'auto' }}>
          {t(`painting.workspace.prompt.${error}`)}
        </Typography> : tags.length === 0 ? <Typography role="status" variant="caption" color="text.secondary" sx={{ px: 1.25, pb: 1 }}>
          {t('painting.workspace.prompt.noMatchingTags')}
        </Typography> : <Box ref={listRef} id={listId} role="listbox" aria-label={t('painting.workspace.prompt.matchingTagSuggestions')} sx={{
          display: columns ? 'grid' : 'flex', gridTemplateColumns: 'repeat(auto-fill, minmax(min(145px, 100%), 1fr))',
          flexWrap: 'wrap', gap: 0.5, alignItems: 'start', alignContent: 'start', px: 1, pb: 1, minHeight: 0,
          overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', touchAction: 'pan-y',
        }}>
          {tags.map((tag, index) => (
            <ButtonBase key={tag.completion || tag.name} id={`${listId}-${index}`} data-suggestion-name={tag.name} data-suggestion-alias={tag.translation} role="option" aria-selected={index === activeIndex} tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(tag)}
              sx={{
                display: 'inline-flex', minWidth: 0, maxWidth: '100%', justifyContent: 'flex-start',
                px: 1, py: 0.375, minHeight: 26, gap: 0.5, textAlign: 'start', border: 1, borderRadius: '1rem',
                borderColor: index === activeIndex ? 'primary.main' : 'divider',
                bgcolor: index === activeIndex ? 'action.selected' : 'background.paper',
                '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
              }}>
              {tag.kind === 'category' && <FolderOutlinedIcon sx={{ fontSize: 14, flexShrink: 0, color: 'primary.main' }} />}
              <Box component="span" sx={{ display: 'inline-flex', flexDirection: stacked ? 'column' : 'row',
                alignItems: stacked ? 'flex-start' : 'baseline', flexWrap: 'wrap', columnGap: 0.75, minWidth: 0, overflowWrap: 'anywhere' }}>
                <Typography component="span" sx={{ fontWeight: 550, fontSize: 12, lineHeight: 1.35 }}>{tag.name}</Typography>
                {tag.translation && tag.translation !== tag.name && <Typography component="span" color="text.secondary"
                  sx={{ fontSize: 11, lineHeight: 1.35 }}>{tag.translation}</Typography>}
              </Box>
            </ButtonBase>
          ))}
        </Box>}
      </Paper>
    </Popper>
  );
}
