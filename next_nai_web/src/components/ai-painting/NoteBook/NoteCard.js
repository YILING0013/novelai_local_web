// ./NoteBook/NoteCard.js
import React from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Typography,
  Box,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Edit as EditIcon,
  MoreVert as MoreVertIcon,
  Visibility as VisibilityIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const NoteCard = ({ note, onUse, onEdit, onOpenMenu, onView, index }) => {
  const { t, formatDate } = useI18n();
  // 兼容旧数据，确保 note.character_tabs 存在且为数组
  const characterTabsCount = (note.character_tabs && Array.isArray(note.character_tabs)) ? note.character_tabs.length : 0;

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: (theme) => theme.shadows[4],
        },
      }}
    >
      <Box sx={{ position: 'relative', paddingTop: '56.25%', bgcolor: 'rgba(0, 0, 0, 0.04)' }}>
        {note.image_url ? (
          <CardMedia
            component="img"
            image={note.image_url}
            alt={note.title}
            onError={(e) => {
              e.target.onerror = null; // 防止无限循环
              e.target.style.display = 'none';
              const parent = e.target.parentElement;
              if (parent) {
                const iconContainer = document.createElement('div');
                iconContainer.style.position = 'absolute';
                iconContainer.style.top = '0';
                iconContainer.style.left = '0';
                iconContainer.style.width = '100%';
                iconContainer.style.height = '100%';
                iconContainer.style.display = 'flex';
                iconContainer.style.alignItems = 'center';
                iconContainer.style.justifyContent = 'center';
                iconContainer.innerHTML = '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24" style="font-size: 40px; color: rgba(0, 0, 0, 0.26);"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"></path></svg>';
                parent.appendChild(iconContainer);
              }
            }}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain', // 改为 contain 以完整显示图片
            }}
          />
        ) : (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ImageIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
          </Box>
        )}
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            display: 'flex',
            gap: 0.5,
            p: 1,
          }}
        >
          <Tooltip title={t('painting.tools.notebook.viewDetails')} arrow>
            <IconButton
              aria-label={t('painting.tools.notebook.viewDetails')}
              size="small"
              onClick={() => onView(note)}
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.8)',
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.95)' },
              }}
            >
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <CardContent sx={{ flexGrow: 1, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={note.title}>
          {note.title}
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{
          mb: 0.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: '0.85rem',
        }}>
          <strong>{t('painting.tools.notebook.positive')}</strong>: {note.text_content1 || t('painting.tools.notebook.emptyValue')}
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{
          mb: 0.5, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: '0.85rem',
        }}>
          <strong>{t('painting.tools.notebook.negative')}</strong>: {note.text_content2 || t('painting.tools.notebook.emptyValue')}
        </Typography>

        {/* 显示角色卡片数量 */}
        {characterTabsCount > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
            {t('painting.tools.notebook.characterCards')}: {t('painting.tools.notebook.count', { count: characterTabsCount })}
          </Typography>
        )}
        {note.created_at && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.75rem', mt: 0.5 }}>
            {formatDate(parseFloat(note.created_at) * 1000, { dateStyle: 'medium', timeStyle: 'short' })}
          </Typography>
        )}
      </CardContent>

      <CardActions sx={{ px: 2, py: 1, justifyContent: 'space-between' }}>
        <Button
          size="small"
          variant="contained"
          onClick={() => onUse(note)}
          sx={{ borderRadius: 4, boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
        >
          {t('painting.tools.notebook.use')}
        </Button>
        <Box>
          <Tooltip title={t('painting.tools.common.edit')} arrow>
            <IconButton aria-label={t('painting.tools.common.edit')} size="small" onClick={() => onEdit(note)} sx={{ mr: 0.5 }}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('painting.tools.notebook.moreActions')} arrow>
            {/* 传递 note 对象给 onOpenMenu */}
            <IconButton aria-label={t('painting.tools.notebook.moreActions')} size="small" onClick={(e) => onOpenMenu(e, note)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </CardActions>
    </Card>
  );
};

export default NoteCard;
