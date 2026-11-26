/* eslint-disable @next/next/no-img-element */
// ./NoteBook/NoteBook.js
import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  IconButton,
  Tooltip,
  Grid,
  CircularProgress,
  Menu,
  MenuItem,
  TextField, // 新增：用于搜索框
  InputAdornment, // 新增
  ToggleButtonGroup, // 新增：用于视图切换
  ToggleButton, // 新增
  useTheme, // 新增：用于响应式设计
  useMediaQuery, // 新增
  Collapse, // 新增：用于移动端展开图片
  Paper, // 新增：用于列表项
  CardActions, // 修复：用于列表项按钮组
  Alert,
  Checkbox,
  Chip,
  FormControlLabel,
} from '@mui/material';
import {
  UploadFile as UploadIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Search as SearchIcon, // 新增
  SortByAlpha as SortByAlphaIcon, // 新增：用于排序
  AccessTime as AccessTimeIcon, // 新增：用于排序
  ViewModule as ViewModuleIcon, // 新增
  ViewList as ViewListIcon, // 新增
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  ExpandMore as ExpandMoreIcon,
  DriveFileMoveOutlined as MoveIcon,
  ChecklistOutlined as ChecklistIcon,
  FolderOutlined as FolderIcon,
  NotesOutlined as NotesIcon,
  MoreVert as MoreVertIcon, // 修复：用于更多操作菜单
} from '@mui/icons-material';
import NoteCard from './NoteCard'; // 卡片视图组件
import NoteEditDialog from './NoteEditDialog';
import NoteViewDialog from './NoteViewDialog';
import { useI18n } from '@/i18n/I18nProvider';
import NoteGroupSidebar from './NoteGroupSidebar';
import { getGroupOptions } from './noteGroups.mjs';
import notebookMessages from './notebookMessages';
import { normalizeNoteCharacters } from './noteCharacters.mjs';

// 列表项组件 (桌面端侧边预览，移动端点击展开)
const NoteListItem = ({ note, onUse, onEdit, onView, onOpenMenu, isMobile, selecting, selected, onSelect, groupLabel }) => {
  const { locale, t, formatDate } = useI18n();
  const copy = notebookMessages[locale];
  const [expandedImage, setExpandedImage] = useState(false);

  const handleImageToggle = () => {
    if (isMobile) {
      setExpandedImage(!expandedImage);
    }
  };

  const contentPreview = (text, maxLength = 100) => {
    if (!text) return t('painting.tools.notebook.emptyValue');
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <Paper variant="outlined" sx={{ mb: 1.5, p: 1.5, borderRadius: 2, borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        {selecting && <Checkbox checked={selected} onChange={() => onSelect(note)} inputProps={{ 'aria-label': `${copy.selectNote} ${note.title}` }} size="small" sx={{ p: 0.5 }} />}
        <Chip size="small" variant="outlined" icon={<FolderIcon />} label={groupLabel} sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden' } }} />
      </Box>
      <Grid container spacing={isMobile ? 1 : 2} alignItems="center">
        {!isMobile && note.image_url && (
          <Grid item xs={3} md={2}>
            <Box
              onClick={() => onView(note)} // 点击图片查看详情
              sx={{
                width: '100%',
                paddingTop: '100%', // 保持1:1的宽高比
                position: 'relative',
                bgcolor: 'rgba(0,0,0,0.04)',
                borderRadius: 1,
                overflow: 'hidden',
                cursor: 'pointer',
              }}
            >
              <img
                src={note.image_url}
                alt={note.title}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </Box>
          </Grid>
        )}

        <Grid item xs={isMobile ? 12 : (note.image_url ? 9 : 12)} md={note.image_url && !isMobile ? 10 : 12}>
          <Box onClick={isMobile ? handleImageToggle : () => onView(note)} sx={{ cursor: isMobile && note.image_url ? 'pointer' : 'default' }}>
            <Typography variant="subtitle1" fontWeight="medium" noWrap sx={{ mb: 0.5 }}>
              {note.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              {t('painting.tools.notebook.positive')}: {contentPreview(note.text_content1, isMobile ? 50 : 80)}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              {t('painting.tools.notebook.negative')}: {contentPreview(note.text_content2, isMobile ? 40 : 60)}
            </Typography>
            {Array.isArray(note.character_tabs) && note.character_tabs.length > 0 && (
              <Typography variant="caption" color="text.secondary" display="block">
                {t('painting.tools.notebook.characterCards')}: {t('painting.tools.notebook.count', { count: note.character_tabs.length })}
              </Typography>
            )}
            {note.created_at && (
              <Typography variant="caption" color="text.secondary" display="block">
                {formatDate(parseFloat(note.created_at) * 1000, { dateStyle: 'medium', timeStyle: 'short' })}
              </Typography>
            )}
          </Box>

          {isMobile && note.image_url && (
            <Collapse in={expandedImage} timeout="auto" unmountOnExit>
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 1, p: 1 }}>
                <img
                  src={note.image_url}
                  alt={note.title}
                  style={{ maxHeight: 150, maxWidth: '100%', objectFit: 'contain', borderRadius: '4px' }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </Box>
            </Collapse>
          )}
          <CardActions sx={{ pt: 1, px: 0, justifyContent: 'flex-start' }}>
            <Button size="small" variant="contained" onClick={() => onUse(note)} sx={{ mr: 1 }}>{t('painting.tools.notebook.use')}</Button>
            <Tooltip title={t('painting.tools.notebook.viewDetails')}><IconButton aria-label={t('painting.tools.notebook.viewDetails')} size="small" onClick={() => onView(note)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title={t('painting.tools.common.edit')}><IconButton aria-label={t('painting.tools.common.edit')} size="small" onClick={() => onEdit(note)}><EditIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title={t('painting.tools.notebook.more')}><IconButton aria-label={t('painting.tools.notebook.more')} size="small" onClick={(e) => onOpenMenu(e, note)}><MoreVertIcon fontSize="small" /></IconButton></Tooltip>
          </CardActions>
        </Grid>
      </Grid>
    </Paper>
  );
};


/**
 * 展示笔记、三级分组和批量管理；笔记使用标题作为后端唯一标识。
 * 批量回调接收标题数组，移动回调的第二个参数为分组 ID 或 null（未分组）。
 */
const NoteBook = ({
  open, onClose, notes = [], groups = [], isLoading, positivePrompt, negativePrompt,
  currentCharacterTabs = [], onUseNote, onSaveNote, onDeleteNote, onUpdateNote,
  onExportNotes, onImportNotes, onCreateGroup, onUpdateGroup,
  onDeleteGroup, onBatchMoveNotes, onBatchDeleteNotes,
}) => {
  const theme = useTheme();
  const { locale, t } = useI18n();
  const copy = notebookMessages[locale];
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [noteMenuAnchor, setNoteMenuAnchor] = useState(null);
  const [activeNoteForMenu, setActiveNoteForMenu] = useState(null);
  const [noteEditDialogOpen, setNoteEditDialogOpen] = useState(false);
  const [activeEditNote, setActiveEditNote] = useState(null);
  const [noteViewDialogOpen, setNoteViewDialogOpen] = useState(false);
  const [activeViewNote, setActiveViewNote] = useState(null);
  const [viewMode, setViewMode] = useState('card');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState('time');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [mobileGroupsOpen, setMobileGroupsOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedTitles, setSelectedTitles] = useState(new Set());
  const [batchDialog, setBatchDialog] = useState(null);
  const [moveGroupId, setMoveGroupId] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState('');
  const groupOptions = useMemo(() => getGroupOptions(groups), [groups]);
  const groupNames = new Map(groupOptions.map((group) => [group.id, group.label]));
  const activeGroup = groupOptions.find((group) => group.id === selectedGroup);
  const groupTitle = selectedGroup === null ? copy.allNotes : activeGroup?.label || copy.ungrouped;
  const canSaveCurrent = Boolean(positivePrompt || negativePrompt || currentCharacterTabs.length);
  const parsedNotes = useMemo(() => notes.map((note) => {
    try {
      return { ...note, character_tabs: normalizeNoteCharacters(note.character_tabs) };
    } catch {
      // 损坏的历史 JSON 仍交给编辑器展示原文，列表不因一条笔记而无法打开。
      return note;
    }
  }), [notes]);

  useEffect(() => {
    // 删除分组后，里面的笔记已回到未分组，筛选也跟随到同一位置。
    if (selectedGroup !== null && selectedGroup !== '' && !groups.some((group) => group.id === selectedGroup)) {
      setSelectedGroup('');
      setSelectedTitles(new Set());
    }
  }, [groups, selectedGroup]);

  useEffect(() => {
    setSelectedTitles((previous) => new Set([...previous].filter((title) => notes.some((note) => note.title === title))));
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const includedGroupIds = new Set([selectedGroup]);
    // 分组列表是父级在前，单次遍历即可包含所有子分组。
    for (const group of groupOptions) {
      if (includedGroupIds.has(group.parent_id)) includedGroupIds.add(group.id);
    }
    const term = searchTerm.toLocaleLowerCase(locale);
    return parsedNotes.filter((note) => {
      const inGroup = selectedGroup === null
        || (selectedGroup === '' ? !note.group_id : includedGroupIds.has(note.group_id));
      if (!inGroup) return false;
      const text = [note.title, note.text_content1, note.text_content2,
        ...(Array.isArray(note.character_tabs) ? note.character_tabs.flatMap((tab) => [tab.name, tab.prompt, tab.uc]) : [note.character_tabs])].join(' ');
      return text.toLocaleLowerCase(locale).includes(term);
    }).sort((a, b) => sortMode === 'time'
      ? (Number(b.created_at) || 0) - (Number(a.created_at) || 0)
      : (a.title || '').localeCompare(b.title || '', locale));
  }, [groupOptions, locale, parsedNotes, searchTerm, selectedGroup, sortMode]);

  const selectedCount = selectedTitles.size;
  const allResultsSelected = filteredNotes.length > 0 && filteredNotes.every((note) => selectedTitles.has(note.title));

  const handleCloseNoteMenu = () => {
    setNoteMenuAnchor(null);
    setActiveNoteForMenu(null);
  };
  const handleEditNote = (note) => {
    setActiveEditNote(note);
    setNoteEditDialogOpen(true);
    setNoteViewDialogOpen(false);
    handleCloseNoteMenu();
  };
  const handleViewNote = (note) => {
    setActiveViewNote(note);
    setNoteViewDialogOpen(true);
  };
  const handleSelectNote = (note) => {
    setSelectedTitles((previous) => {
      const next = new Set(previous);
      if (next.has(note.title)) next.delete(note.title); else next.add(note.title);
      return next;
    });
  };
  const handleSelectGroup = (groupId) => {
    setSelectedGroup(groupId);
    setSelectedTitles(new Set());
    if (isMobile) setMobileGroupsOpen(false);
  };
  const openBatchDialog = (type, titles) => {
    setBatchDialog({ type, titles });
    setMoveGroupId('');
    setBatchError('');
    handleCloseNoteMenu();
  };
  const handleBatchSubmit = async () => {
    setBatchBusy(true);
    setBatchError('');
    try {
      const result = batchDialog.type === 'move'
        ? await onBatchMoveNotes(batchDialog.titles, moveGroupId || null)
        : await onBatchDeleteNotes(batchDialog.titles);
      if (result === false) {
        setBatchError(copy.batchActionFailed);
        return;
      }
      setSelectedTitles(new Set());
      setBatchDialog(null);
    } catch {
      setBatchError(copy.batchActionFailed);
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth fullScreen={isMobile}
        sx={{ '& .MuiDialog-paper': { height: isMobile ? '100%' : '90vh', maxHeight: isMobile ? '100%' : '90vh' } }}>
        <DialogTitle component="div" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: { xs: 2, sm: 3 }, py: 2, gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h2" variant="h6" fontWeight={700}>{t('painting.tools.notebook.title')}</Typography>
            <Typography variant="caption" color="text.secondary">{copy.capacity} {notes.length}</Typography>
          </Box>
          <Box sx={{ display: 'flex' }}>
            <Tooltip title={t('painting.tools.notebook.import')}><IconButton aria-label={t('painting.tools.notebook.import')} onClick={onImportNotes}><DownloadIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title={t('painting.tools.notebook.export')}><IconButton aria-label={t('painting.tools.notebook.export')} onClick={onExportNotes}><UploadIcon fontSize="small" /></IconButton></Tooltip>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, overflow: 'hidden' }}>
          <Box sx={{ width: { xs: '100%', sm: 250 }, flexShrink: 0, borderRight: { sm: 1 }, borderBottom: { xs: 1, sm: 0 }, borderColor: 'divider', bgcolor: 'background.default', overflowY: 'auto' }}>
            {isMobile && <Button fullWidth startIcon={<FolderIcon />} endIcon={<ExpandMoreIcon sx={{ transform: mobileGroupsOpen ? 'rotate(180deg)' : 'none' }} />} onClick={() => setMobileGroupsOpen((value) => !value)} aria-expanded={mobileGroupsOpen} aria-label={mobileGroupsOpen ? copy.hideGroups : copy.showGroups} sx={{ justifyContent: 'flex-start', px: 2, py: 1.25 }}><Box component="span" sx={{ flexGrow: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{groupTitle}</Box></Button>}
            <Collapse in={!isMobile || mobileGroupsOpen} timeout="auto" sx={{ maxHeight: isMobile ? 280 : 'none', overflowY: isMobile ? 'auto' : 'visible' }}>
              <NoteGroupSidebar notes={notes} options={groupOptions} selectedGroup={selectedGroup} onSelectGroup={handleSelectGroup} onCreateGroup={onCreateGroup} onUpdateGroup={onUpdateGroup} onDeleteGroup={onDeleteGroup} />
            </Collapse>
          </Box>
          <Box sx={{ minWidth: 0, minHeight: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: { xs: 1.5, sm: 2.5 }, pb: { xs: 1.5, sm: 2 }, borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Typography component="h3" variant="subtitle1" fontWeight={700} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{groupTitle}</Typography>
                <Typography variant="caption" color="text.secondary">{filteredNotes.length} {copy.results}</Typography>
                {activeGroup && groups.some((group) => group.parent_id === activeGroup.id) && <Chip label={copy.includesChildren} size="small" variant="outlined" />}
                <Button size="small" startIcon={<ChecklistIcon />} variant={selecting ? 'contained' : 'outlined'} onClick={() => { setSelecting((value) => !value); setSelectedTitles(new Set()); }} sx={{ ml: 'auto', flexShrink: 0 }}>{selecting ? copy.finishManage : copy.manage}</Button>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                <TextField variant="outlined" size="small" placeholder={t('painting.tools.notebook.searchPlaceholder')} inputProps={{ 'aria-label': t('painting.tools.notebook.searchPlaceholder') }} value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setSelectedTitles(new Set()); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} sx={{ flex: '1 1 220px' }} />
                <ToggleButtonGroup value={sortMode} exclusive onChange={(_, value) => value && setSortMode(value)} aria-label={t('painting.tools.notebook.sortMode')} size="small">
                  <ToggleButton value="time" aria-label={t('painting.tools.notebook.sortByTime')}><Tooltip title={t('painting.tools.notebook.sortByTime')}><AccessTimeIcon fontSize="small" /></Tooltip></ToggleButton>
                  <ToggleButton value="alpha" aria-label={t('painting.tools.notebook.sortAlphabetically')}><Tooltip title={t('painting.tools.notebook.sortAlphabetically')}><SortByAlphaIcon fontSize="small" /></Tooltip></ToggleButton>
                </ToggleButtonGroup>
                <ToggleButtonGroup value={viewMode} exclusive onChange={(_, value) => value && setViewMode(value)} aria-label={t('painting.tools.notebook.viewMode')} size="small">
                  <ToggleButton value="card" aria-label={t('painting.tools.notebook.cardView')}><Tooltip title={t('painting.tools.notebook.cardView')}><ViewModuleIcon fontSize="small" /></Tooltip></ToggleButton>
                  <ToggleButton value="list" aria-label={t('painting.tools.notebook.listView')}><Tooltip title={t('painting.tools.notebook.listView')}><ViewListIcon fontSize="small" /></Tooltip></ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>
            {selecting && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 2, py: 1, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
              <FormControlLabel sx={{ mr: 0 }} control={<Checkbox size="small" checked={allResultsSelected} indeterminate={selectedCount > 0 && !allResultsSelected} disabled={!filteredNotes.length} onChange={() => setSelectedTitles(allResultsSelected ? new Set() : new Set(filteredNotes.map((note) => note.title)))} />} label={<Typography variant="body2">{copy.selectAll}</Typography>} />
              <Typography variant="caption" color="text.secondary" aria-live="polite">{copy.selected} {selectedCount} {copy.items}</Typography>
              <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                <Button size="small" startIcon={<MoveIcon />} disabled={!selectedCount} onClick={() => openBatchDialog('move', [...selectedTitles])}>{copy.moveTo}</Button>
                <Button size="small" color="error" startIcon={<DeleteIcon />} disabled={!selectedCount} onClick={() => openBatchDialog('delete', [...selectedTitles])}>{copy.deleteSelected}</Button>
              </Box>
            </Box>}
            <Box sx={{ overflowY: 'auto', flexGrow: 1, minHeight: 0, p: { xs: 1.5, sm: 2.5 }, bgcolor: 'background.default' }}>
              {isLoading ? <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                : filteredNotes.length ? viewMode === 'card' ? (
                  <Grid container spacing={2}>
                    {filteredNotes.map((note) => <Grid item xs={12} md={6} lg={4} key={note.title}>
                      <NoteCard note={note} onUse={onUseNote} onEdit={handleEditNote} onView={handleViewNote} onOpenMenu={(event) => { setNoteMenuAnchor(event.currentTarget); setActiveNoteForMenu(note); }} selecting={selecting} selected={selectedTitles.has(note.title)} onSelect={handleSelectNote} groupLabel={groupNames.get(note.group_id) || copy.ungrouped} />
                    </Grid>)}
                  </Grid>
                ) : filteredNotes.map((note) => <NoteListItem key={note.title} note={note} onUse={onUseNote} onEdit={handleEditNote} onView={handleViewNote} onOpenMenu={(event) => { setNoteMenuAnchor(event.currentTarget); setActiveNoteForMenu(note); }} isMobile={isMobile} selecting={selecting} selected={selectedTitles.has(note.title)} onSelect={handleSelectNote} groupLabel={groupNames.get(note.group_id) || copy.ungrouped} />)
                  : <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240, height: '100%', flexDirection: 'column', textAlign: 'center', px: 2, gap: 1 }}>
                    <NotesIcon sx={{ fontSize: 42, color: 'text.disabled', mb: 1 }} />
                    <Typography variant="subtitle1">{searchTerm ? t('painting.tools.notebook.noMatches') : selectedGroup === null ? t('painting.tools.notebook.noNotes') : copy.noGroupNotes}</Typography>
                    {selectedGroup !== null && !searchTerm && <><Typography variant="body2" color="text.secondary">{copy.noGroupNotesHelp}</Typography><Button onClick={() => handleSelectGroup(null)}>{copy.viewAll}</Button></>}
                    {selectedGroup === null && !searchTerm && <Button variant="outlined" startIcon={<SaveIcon />} onClick={onSaveNote} disabled={!canSaveCurrent}>{t('painting.tools.notebook.saveCurrentPrompt')}</Button>}
                  </Box>}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
          <Button onClick={onClose}>{t('painting.tools.common.close')}</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={onSaveNote} disabled={!canSaveCurrent}>{t('painting.tools.notebook.saveCurrentPrompt')}</Button>
        </DialogActions>
      </Dialog>
      <Menu anchorEl={noteMenuAnchor} open={Boolean(noteMenuAnchor)} onClose={handleCloseNoteMenu}>
        <MenuItem onClick={() => openBatchDialog('move', [activeNoteForMenu.title])}><MoveIcon fontSize="small" sx={{ mr: 1 }} />{copy.moveTo}</MenuItem>
        <MenuItem onClick={async () => { if (activeNoteForMenu) { await onDeleteNote(activeNoteForMenu); handleCloseNoteMenu(); } }} sx={{ color: 'error.main' }}><DeleteIcon fontSize="small" sx={{ mr: 1 }} />{t('painting.tools.common.delete')}</MenuItem>
      </Menu>
      <Dialog open={Boolean(batchDialog)} onClose={() => !batchBusy && setBatchDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{batchDialog?.type === 'move' ? copy.moveTo : copy.deleteSelected} · {batchDialog?.titles.length} {copy.items}</DialogTitle>
        <DialogContent>
          {batchError && <Alert severity="error" sx={{ mb: 2 }}>{batchError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{batchDialog?.type === 'move' ? copy.moveHelp : copy.deleteNotesHelp}</Typography>
          {batchDialog?.type === 'move' && <TextField select fullWidth label={copy.groups} value={moveGroupId} onChange={(event) => setMoveGroupId(event.target.value)} disabled={batchBusy} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
            <MenuItem value="">{copy.ungrouped}</MenuItem>
            {groupOptions.map((group) => <MenuItem key={group.id} value={group.id}>{group.label}</MenuItem>)}
          </TextField>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button disabled={batchBusy} onClick={() => setBatchDialog(null)}>{copy.cancel}</Button>
          <Button disabled={batchBusy} variant="contained" color={batchDialog?.type === 'delete' ? 'error' : 'primary'} onClick={handleBatchSubmit}>{batchDialog?.type === 'move' ? copy.move : copy.delete}</Button>
        </DialogActions>
      </Dialog>
      <NoteEditDialog open={noteEditDialogOpen} onClose={() => setNoteEditDialogOpen(false)} note={activeEditNote} onSave={onUpdateNote} groups={groups} />
      <NoteViewDialog open={noteViewDialogOpen} onClose={() => setNoteViewDialogOpen(false)} note={activeViewNote} onEdit={handleEditNote} onUse={onUseNote} />
    </>
  );
};

export default NoteBook;
