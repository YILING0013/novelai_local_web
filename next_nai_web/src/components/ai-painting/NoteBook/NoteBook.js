/* eslint-disable @next/next/no-img-element */
// ./NoteBook/NoteBook.js
import React, { useState, useEffect } from 'react';
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
  Image as ImageIcon, // 用于列表模式的图片占位
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  ExpandMore as ExpandMoreIconMaterial, // 防止与组件内部的 ExpandMore 冲突
  MoreVert as MoreVertIcon, // 修复：用于更多操作菜单
} from '@mui/icons-material';
import NoteCard from './NoteCard'; // 卡片视图组件
import NoteEditDialog from './NoteEditDialog';
import NoteViewDialog from './NoteViewDialog';
import { useI18n } from '@/i18n/I18nProvider';

// 列表项组件 (桌面端侧边预览，移动端点击展开)
const NoteListItem = ({ note, onUse, onEdit, onView, onOpenMenu, index, isMobile }) => {
  const { t, formatDate } = useI18n();
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
    <Paper elevation={1} sx={{ mb: 1.5, p: 1.5, borderRadius: 2, '&:hover': { boxShadow: 3 } }}>
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
                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<div style=\"display:flex; align-items:center; justify-content:center; width:100%; height:100%;\"><ImageIcon color=\"disabled\"/></div>'; }}
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
            {note.character_tabs && note.character_tabs.length > 0 && (
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


const NoteBook = ({
  open,
  onClose,
  notes, // 原始笔记列表
  isLoading,
  positivePrompt, // 用于“保存当前提示词”按钮的状态
  negativePrompt, // 同上
  onUseNote,
  onSaveNote, // 打开保存当前提示词的对话框
  onDeleteNote,
  onUpdateNote,
  onExportNotes,
  onImportNotes,
  fetchNotes
}) => {
  const theme = useTheme();
  const { locale, t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [noteMenuAnchor, setNoteMenuAnchor] = useState(null);
  // const [activeNoteIndex, setActiveNoteIndex] = useState(null); // 改为存储笔记对象
  const [activeNoteForMenu, setActiveNoteForMenu] = useState(null);
  const [noteEditDialogOpen, setNoteEditDialogOpen] = useState(false);
  const [activeEditNote, setActiveEditNote] = useState(null);
  const [noteViewDialogOpen, setNoteViewDialogOpen] = useState(false);
  const [activeViewNote, setActiveViewNote] = useState(null);

  // 新增状态
  const [viewMode, setViewMode] = useState('card'); // 'card' 或 'list'
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredNotes, setFilteredNotes] = useState([]);

  const [sortMode, setSortMode] = useState('time'); // 'time' 或 'alpha'

  // 当原始笔记或搜索词或排序模式变化时，更新过滤后的笔记
  useEffect(() => {
    if (!notes) {
      setFilteredNotes([]);
      return;
    }
    const lowerSearchTerm = searchTerm.toLowerCase();
    let result = notes.filter(note => {
      const titleMatch = note.title?.toLowerCase().includes(lowerSearchTerm);
      const content1Match = note.text_content1?.toLowerCase().includes(lowerSearchTerm);
      const content2Match = note.text_content2?.toLowerCase().includes(lowerSearchTerm);
      // 兼容旧数据，检查 character_tabs 是否存在
      const characterTabsMatch = note.character_tabs && Array.isArray(note.character_tabs) && note.character_tabs.some(tab =>
        tab.prompt?.toLowerCase().includes(lowerSearchTerm) ||
        tab.uc?.toLowerCase().includes(lowerSearchTerm)
      );
      return titleMatch || content1Match || content2Match || characterTabsMatch;
    });

    // 排序逻辑
    result.sort((a, b) => {
      if (sortMode === 'time') {
        const timeA = parseFloat(a.created_at) || 0;
        const timeB = parseFloat(b.created_at) || 0;
        return timeB - timeA; // 降序，最新的在前
      } else {
        const titleA = a.title || '';
        const titleB = b.title || '';
        return titleA.localeCompare(titleB, locale);
      }
    });

    setFilteredNotes(result);
  }, [locale, notes, searchTerm, sortMode]);

  const handleSortChange = (event, newSortMode) => {
    if (newSortMode !== null) {
      setSortMode(newSortMode);
    }
  };

  const handleOpenNoteMenu = (event, note) => { // 接收 note 对象
    setNoteMenuAnchor(event.currentTarget);
    setActiveNoteForMenu(note);
  };

  const handleCloseNoteMenu = () => {
    setNoteMenuAnchor(null);
    setActiveNoteForMenu(null);
  };

  const handleEditNote = (note) => {
    setActiveEditNote(note);
    setNoteEditDialogOpen(true);
    handleCloseNoteMenu(); // 如果是从菜单打开的，关闭菜单
  };

  const handleViewNote = (note) => {
    setActiveViewNote(note);
    setNoteViewDialogOpen(true);
  };

  const handleDeleteNoteFromMenu = async () => {
    if (activeNoteForMenu) {
      await onDeleteNote(activeNoteForMenu); // 使用 activeNoteForMenu
      handleCloseNoteMenu();
    }
  };

  const handleViewModeChange = (event, newViewMode) => {
    if (newViewMode !== null) {
      setViewMode(newViewMode);
    }
  };

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };


  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        sx={{ '& .MuiDialog-paper': { height: '90vh' } }} // 增加对话框高度
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 2, pb: 1 }}>
          <Typography variant="h6">{t('painting.tools.notebook.title')}</Typography>
          <Box>
            <Tooltip title={t('painting.tools.notebook.import')} arrow><IconButton aria-label={t('painting.tools.notebook.import')} onClick={onImportNotes} size="small"><DownloadIcon /></IconButton></Tooltip>
            <Tooltip title={t('painting.tools.notebook.export')} arrow><IconButton aria-label={t('painting.tools.notebook.export')} onClick={onExportNotes} size="small"><UploadIcon /></IconButton></Tooltip>
          </Box>
        </DialogTitle>

        {/* 搜索和视图切换 */}
        <Box sx={{ display: 'flex', alignItems: 'center', p: 2, pt: 1, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            fullWidth
            variant="outlined"
            size="small"
            placeholder={t('painting.tools.notebook.searchPlaceholder')}
            value={searchTerm}
            onChange={handleSearchChange}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ mr: 2 }}
          />
          <ToggleButtonGroup
            value={sortMode}
            exclusive
            onChange={handleSortChange}
            aria-label={t('painting.tools.notebook.sortMode')}
            size="small"
            sx={{ mr: 2 }}
          >
            <ToggleButton value="time" aria-label={t('painting.tools.notebook.sortByTime')}>
              <Tooltip title={t('painting.tools.notebook.sortByTime')}><AccessTimeIcon /></Tooltip>
            </ToggleButton>
            <ToggleButton value="alpha" aria-label={t('painting.tools.notebook.sortAlphabetically')}>
              <Tooltip title={t('painting.tools.notebook.sortAlphabetically')}><SortByAlphaIcon /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={handleViewModeChange}
            aria-label={t('painting.tools.notebook.viewMode')}
            size="small"
          >
            <ToggleButton value="card" aria-label={t('painting.tools.notebook.cardView')}>
              <Tooltip title={t('painting.tools.notebook.cardView')}><ViewModuleIcon /></Tooltip>
            </ToggleButton>
            <ToggleButton value="list" aria-label={t('painting.tools.notebook.listView')}>
              <Tooltip title={t('painting.tools.notebook.listView')}><ViewListIcon /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <DialogContent dividers sx={{ p: viewMode === 'list' ? { xs: 1, sm: 1.5 } : { xs: 1.5, sm: 2 } }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
          ) : filteredNotes.length > 0 ? (
            viewMode === 'card' ? (
              <Grid container spacing={isMobile ? 1.5 : 2}>
                {filteredNotes.map((note, index) => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={note.id || index}> {/* 最好使用 note.id 作为 key */}
                    <NoteCard
                      note={note}
                      index={index} // 传递原始索引或笔记对象本身给菜单操作
                      onUse={onUseNote}
                      onEdit={handleEditNote}
                      onOpenMenu={(e) => handleOpenNoteMenu(e, note)} // 传递笔记对象
                      onView={handleViewNote}
                    />
                  </Grid>
                ))}
              </Grid>
            ) : ( // 列表视图
              <Box>
                {filteredNotes.map((note, index) => (
                  <NoteListItem
                    key={note.id || index}
                    note={note}
                    index={index}
                    onUse={onUseNote}
                    onEdit={handleEditNote}
                    onView={handleViewNote}
                    onOpenMenu={(e) => handleOpenNoteMenu(e, note)}
                    isMobile={isMobile}
                  />
                ))}
              </Box>
            )
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
              <Typography variant="body1" color="text.secondary" gutterBottom>
                {searchTerm
                  ? t('painting.tools.notebook.noMatches')
                  : t('painting.tools.notebook.noNotes')}
              </Typography>
              <Button
                variant="outlined"
                startIcon={<SaveIcon />}
                onClick={onSaveNote} // 这个 onSaveNote 来自 PromptPanel，用于打开保存对话框
                disabled={!positivePrompt && !negativePrompt}
              >
                {t('painting.tools.notebook.saveCurrentPrompt')}
              </Button>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('painting.tools.common.close')}</Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<SaveIcon />}
            onClick={onSaveNote}
            disabled={!positivePrompt && !negativePrompt}
          >
            {t('painting.tools.notebook.saveCurrentPrompt')}
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        anchorEl={noteMenuAnchor}
        open={Boolean(noteMenuAnchor)}
        onClose={handleCloseNoteMenu}
      >
        <MenuItem onClick={handleDeleteNoteFromMenu} sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> {t('painting.tools.common.delete')}
        </MenuItem>
      </Menu>

      <NoteEditDialog
        open={noteEditDialogOpen}
        onClose={() => setNoteEditDialogOpen(false)}
        note={activeEditNote}
        onSave={onUpdateNote} // onUpdateNote 应该能处理 character_tabs
      />
      <NoteViewDialog
        open={noteViewDialogOpen}
        onClose={() => setNoteViewDialogOpen(false)}
        note={activeViewNote}
        onEdit={handleEditNote}
        onUse={onUseNote}
      />
    </>
  );
};

export default NoteBook;
