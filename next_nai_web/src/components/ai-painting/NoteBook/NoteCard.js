import React, { useState } from 'react';
import {
  Card, CardMedia, CardContent, CardActions, Typography, Box, Button,
  IconButton, Tooltip, Checkbox, Chip,
} from '@mui/material';
import {
  Edit as EditIcon, MoreVert as MoreVertIcon, Visibility as VisibilityIcon,
  NotesOutlined as NotesIcon, FolderOutlined as FolderIcon, FaceOutlined as FaceIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import notebookMessages from './notebookMessages';

/** 显示笔记摘要、角色数量与所属分组，批量管理时提供独立的勾选入口。 */
const NoteCard = ({ note, onUse, onEdit, onOpenMenu, onView, selecting, selected, onSelect, groupLabel }) => {
  const { locale, t, formatDate } = useI18n();
  const copy = notebookMessages[locale];
  const [failedImageUrl, setFailedImageUrl] = useState(null);
  const characterTabsCount = Array.isArray(note.character_tabs) ? note.character_tabs.length : 0;

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 2.5,
      borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : 'background.paper',
      transition: 'border-color 0.2s, box-shadow 0.2s', '&:hover': { boxShadow: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, pt: 1.5, minWidth: 0 }}>
        {selecting
          ? <Checkbox checked={selected} onChange={() => onSelect(note)} inputProps={{ 'aria-label': `${copy.selectNote} ${note.title}` }} size="small" sx={{ p: 0.5 }} />
          : <Box sx={{ display: 'flex', p: 0.75, borderRadius: 1.25, bgcolor: 'action.hover', color: 'primary.main' }}><NotesIcon fontSize="small" /></Box>}
        <Chip size="small" variant="outlined" icon={<FolderIcon />} label={groupLabel || copy.ungrouped} title={groupLabel || copy.ungrouped} sx={{ maxWidth: 'calc(100% - 40px)', fontSize: '0.7rem', '& .MuiChip-label': { overflow: 'hidden' } }} />
      </Box>
      {note.image_url && failedImageUrl !== note.image_url && (
        <CardMedia component="img" image={note.image_url} alt={note.title} onError={() => setFailedImageUrl(note.image_url)} sx={{ height: 156, objectFit: 'contain', mt: 1.5, bgcolor: 'action.hover' }} />
      )}
      <CardContent sx={{ flexGrow: 1, px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="subtitle1" component="h4" sx={{ mb: 1.25, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={note.title}>{note.title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{t('painting.tools.notebook.positive')}</Typography>
        <Typography variant="body2" sx={{ mb: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.65, minHeight: '3.3em' }}>
          {note.text_content1 || t('painting.tools.notebook.emptyValue')}
        </Typography>
        {note.text_content2 && <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {t('painting.tools.notebook.negative')}: {note.text_content2}
        </Typography>}
        {characterTabsCount > 0 && <Chip size="small" icon={<FaceIcon />} label={`${t('painting.tools.notebook.characterCards')} · ${characterTabsCount}`} sx={{ mb: 0.75, bgcolor: 'action.hover' }} />}
        {note.created_at && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>{formatDate(Number(note.created_at) * 1000, { dateStyle: 'medium' })}</Typography>}
      </CardContent>
      <CardActions sx={{ px: 2, py: 1.5, justifyContent: 'space-between' }}>
        <Button size="small" variant="outlined" onClick={() => onUse(note)}>{t('painting.tools.notebook.use')}</Button>
        <Box sx={{ display: 'flex' }}>
          <Tooltip title={t('painting.tools.notebook.viewDetails')}><IconButton aria-label={`${t('painting.tools.notebook.viewDetails')} ${note.title}`} size="small" onClick={() => onView(note)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={t('painting.tools.common.edit')}><IconButton aria-label={`${t('painting.tools.common.edit')} ${note.title}`} size="small" onClick={() => onEdit(note)}><EditIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={t('painting.tools.notebook.moreActions')}><IconButton aria-label={`${t('painting.tools.notebook.moreActions')} ${note.title}`} size="small" onClick={(event) => onOpenMenu(event, note)}><MoreVertIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
      </CardActions>
    </Card>
  );
};

export default NoteCard;
