/* eslint-disable @next/next/no-img-element */
// ./NoteBook/NoteEditDialog.js
import React, { useState, useEffect } from 'react'; // 移除了未使用的 useCallback
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Button,
  Grid,
  Box,
  Paper,
  CircularProgress,
  InputAdornment,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Image as ImageIcon,
  BrokenImage as BrokenImageIcon,
  Save as SaveIcon,
  ExpandMore as ExpandMoreIcon,
  Face as FaceIcon, // 用于角色卡图标
} from '@mui/icons-material';
import { getNoteTitleError } from '../../../utils/noteTitle.mjs';
import { useI18n } from '@/i18n/I18nProvider';

// 简单的角色卡预览组件 (基本保持不变)
const CharacterTabPreview = ({ tab, index, t }) => (
  <Paper elevation={1} sx={{ p: 1, mb: 1, bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 1 }}>
    <Typography variant="caption" display="block" fontWeight="medium">
      {t('painting.tools.notebook.character')} {index + 1}: {tab.prompt ? (tab.prompt.substring(0, 20) + (tab.prompt.length > 20 ? '...' : '')) : t('painting.tools.notebook.untitled')}
    </Typography>
    <Typography variant="caption" display="block">
      {t('painting.tools.notebook.position')}: {tab.position || t('painting.tools.common.notAvailable')}
    </Typography>
    {tab.uc && (
      <Typography variant="caption" display="block" sx={{ color: 'text.secondary' }}>
        {t('painting.tools.notebook.exclude')}: {tab.uc.substring(0, 30) + (tab.uc.length > 30 ? '...' : '')}
      </Typography>
    )}
  </Paper>
);


const NoteEditDialog = ({ open, onClose, note, onSave }) => {
  const { t } = useI18n();
  // 组件内部状态
  const [editedNote, setEditedNote] = useState({
    title: '',
    text_content1: '',
    text_content2: '',
    image_url: '',
    character_tabs: [], // 始终初始化为数组，用于预览
  });
  const [originalTitle, setOriginalTitle] = useState(''); // 保存笔记原始标题，用于更新API
  const [imageError, setImageError] = useState(false); // 图片加载错误状态
  const [loading, setLoading] = useState(false); // 保存操作的加载状态
  const [characterTabsJson, setCharacterTabsJson] = useState('[]'); // 角色卡JSON编辑区的内容，初始化为 "[]"
  const [jsonError, setJsonError] = useState(''); // JSON格式错误信息
  const titleErrorCode = getNoteTitleError(editedNote.title);
  const titleError = titleErrorCode
    ? t(`painting.tools.notebook.errors.${titleErrorCode}`)
    : '';
  const localizedJsonError = jsonError
    ? t(`painting.tools.notebook.errors.${jsonError}`)
    : '';

  // 当 note prop 或 open 状态改变时，初始化/重置组件状态
  useEffect(() => {
    if (open && note) { // 对话框打开且有笔记数据传入（编辑模式）
      const currentCharacterTabs = Array.isArray(note.character_tabs) ? note.character_tabs : [];
      setEditedNote({
        title: note.title || '',
        text_content1: note.text_content1 || '',
        text_content2: note.text_content2 || '',
        image_url: note.image_url || '',
        character_tabs: [...currentCharacterTabs], // 使用展开运算符创建新数组副本，用于预览
      });
      setOriginalTitle(note.title || ''); // 保存原始标题
      try {
        // 将角色卡数据转换为格式化的JSON字符串，用于JSON编辑区
        setCharacterTabsJson(JSON.stringify(currentCharacterTabs, null, 2));
        setJsonError(''); // 清除可能存在的旧JSON错误
      } catch (error) {
        setCharacterTabsJson("[]"); // 如果转换失败，默认为空数组的JSON字符串
        console.error('Failed to serialize note character cards:', error);
        setJsonError('NOTE_CHARACTER_JSON_INIT_FAILED');
      }
      setImageError(false); // 重置图片错误状态
      setLoading(false); // 重置加载状态
    } else if (open) { // 对话框打开但没有笔记数据传入（可能用于新建，虽然此组件主要用于编辑）
      setEditedNote({ title: '', text_content1: '', text_content2: '', image_url: '', character_tabs: [] });
      setCharacterTabsJson("[]");
      setOriginalTitle('');
      setJsonError('');
      setImageError(false);
      setLoading(false);
    }
    // 当对话框关闭时 (open 变为 false)，useEffect 不会执行此处的重置逻辑。
    // 状态的重置依赖于下一次 open 变为 true。
    // 如果需要在关闭时立即清除，可以考虑在 onClose 回调中处理，或使用 useEffect 的 cleanup 函数。
  }, [note, open]); // 依赖 note 和 open

  // 处理普通输入框变化的通用函数
  const handleChange = (field) => (e) => {
    setEditedNote((prev) => ({
      ...prev,
      [field]: e.target.value,
    }));
    if (field === 'image_url') {
      setImageError(false); // 如果图片链接变化，重置错误状态
    }
  };

  // 处理角色卡JSON编辑区内容变化的函数
  const handleCharacterTabsJsonChange = (e) => {
    const newJson = e.target.value;
    setCharacterTabsJson(newJson); // 更新JSON编辑区的状态

    // 尝试解析JSON以实时验证，并更新预览区使用的 editedNote.character_tabs
    try {
      const parsed = JSON.parse(newJson);
      if (!Array.isArray(parsed)) {
        setJsonError('NOTE_CHARACTER_JSON_ARRAY_REQUIRED');
        // 如果JSON无效或非数组，可以选择不清空预览或设置预览为空数组
        // setEditedNote(prev => ({ ...prev, character_tabs: [] })); 
      } else {
        setJsonError(''); // JSON有效且是数组，清除错误信息
        setEditedNote(prev => ({ ...prev, character_tabs: parsed })); // 更新预览数据
      }
    } catch (error) {
      // JSON格式无效，设置错误信息
      console.debug('Invalid character card JSON:', error);
      setJsonError('NOTE_CHARACTER_JSON_INVALID');
      // 如果JSON无效，可以选择不清空预览或设置预览为空数组
      // setEditedNote(prev => ({ ...prev, character_tabs: [] }));
    }
  };

  // 处理保存按钮点击事件的函数
  const handleSave = async () => {
    if (titleError) {
      alert(titleError);
      return;
    }

    let finalCharacterTabsToSave = []; // 最终要保存的角色卡数据，初始化为空数组

    // 步骤1: 从 characterTabsJson (用户编辑的JSON字符串) 解析数据
    try {
      if (characterTabsJson.trim() === "") { // 如果用户清空了编辑区
        finalCharacterTabsToSave = [];
      } else {
        finalCharacterTabsToSave = JSON.parse(characterTabsJson);
      }

      if (!Array.isArray(finalCharacterTabsToSave)) {
        // 如果解析成功但结果不是数组
        setJsonError('NOTE_CHARACTER_JSON_ARRAY_REQUIRED');
        alert(t('painting.tools.notebook.errors.NOTE_CHARACTER_JSON_ARRAY_REQUIRED'));
        return;
      }
    } catch (error) { // JSON.parse 失败
      console.debug('Unable to parse character card JSON before saving:', error);
      setJsonError('NOTE_CHARACTER_JSON_INVALID');
      alert(t('painting.tools.notebook.errors.NOTE_CHARACTER_JSON_INVALID'));
      return;
    }
    if (jsonError && characterTabsJson.trim() !== "[]" && characterTabsJson.trim() !== "") {
      alert(localizedJsonError);
      return;
    }

    setLoading(true); // 开始加载状态
    try {
      // 准备要传递给 onSave (父组件的更新函数) 的数据对象
      const noteDataToSave = {
        // 从 editedNote 获取其他字段
        title: editedNote.title,
        text_content1: editedNote.text_content1,
        text_content2: editedNote.text_content2,
        image_url: editedNote.image_url,
        // 使用从 characterTabsJson 解析得到的 finalCharacterTabsToSave
        character_tabs: finalCharacterTabsToSave,
      };

      // 用于调试：在控制台打印将要保存的数据
      // console.log('NoteEditDialog: Data being sent to onSave:', noteDataToSave);

      await onSave(noteDataToSave, originalTitle); // 调用父组件传入的 onSave 函数
      onClose(); // 保存成功后关闭对话框
    } catch (error) {
      console.error('保存笔记失败 (来自onSave回调):', error);
      alert(t('painting.tools.notebook.errors.NOTE_SAVE_FAILED'));
    } finally {
      setLoading(false); // 结束加载状态
    }
  };

  // 图片加载失败的处理函数
  const handleImageError = () => setImageError(true);
  // 图片加载成功的处理函数
  const handleImageLoad = () => setImageError(false);

  // 包装 onClose，确保调用父级的 onClose
  const handleCloseDialog = () => {
    onClose();
    // 注意：状态重置现在主要依赖于 useEffect [open, note]
  };

  // 渲染对话框UI
  return (
    <Dialog
      open={open}
      onClose={handleCloseDialog} // 使用包装后的关闭处理
      fullWidth
      maxWidth="md" // 对话框最大宽度
    >
      <DialogTitle>
        {t('painting.tools.notebook.editDialog.title')} {originalTitle && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>({t('painting.tools.notebook.editDialog.originalTitle')}: {originalTitle})</Typography>}
      </DialogTitle>
      <DialogContent dividers> {/* dividers 添加分割线 */}
        <Grid container spacing={3}> {/* Grid布局，分为左右两栏 */}
          {/* 左侧：主要编辑区域 */}
          <Grid item xs={12} md={7}>
            <TextField
              autoFocus // 自动聚焦
              margin="dense"
              label={t('painting.tools.notebook.noteTitle')}
              fullWidth
              value={editedNote.title}
              onChange={handleChange('title')}
              disabled={loading}
              sx={{ mb: 2 }}
              required // 标记为必填
              error={Boolean(titleError)}
              helperText={titleError || t('painting.tools.notebook.titleRule')}
            />

            <Typography variant="subtitle2" gutterBottom>{t('painting.tools.notebook.positivePrompt')}</Typography>
            <TextField
              multiline // 多行文本框
              fullWidth
              minRows={3} // 最小行数
              maxRows={6} // 最大行数
              value={editedNote.text_content1}
              onChange={handleChange('text_content1')}
              disabled={loading}
              placeholder={t('painting.tools.notebook.positivePlaceholder')}
              sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: '"Roboto Mono", monospace', fontSize: '0.9rem' } }}
            />

            <Typography variant="subtitle2" gutterBottom>{t('painting.tools.notebook.negativePrompt')}</Typography>
            <TextField
              multiline
              fullWidth
              minRows={2}
              maxRows={5}
              value={editedNote.text_content2}
              onChange={handleChange('text_content2')}
              disabled={loading}
              placeholder={t('painting.tools.notebook.negativePlaceholder')}
              sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: '"Roboto Mono", monospace', fontSize: '0.9rem' } }}
            />

            <Typography variant="subtitle2" gutterBottom>{t('painting.tools.notebook.previewImageUrl')}</Typography>
            <TextField
              fullWidth
              placeholder={t('painting.tools.notebook.imageUrlOptionalPlaceholder')}
              value={editedNote.image_url}
              onChange={handleChange('image_url')}
              disabled={loading}
              InputProps={{ // 输入框的附加属性
                endAdornment: ( //末尾的装饰元素
                  <InputAdornment position="end">
                    {/* 根据图片链接和加载状态显示不同图标 */}
                    {editedNote.image_url && (imageError ? <BrokenImageIcon color="error" /> : <ImageIcon color="action" />)}
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />

            {/* 角色卡编辑区域: 使用可折叠的 Accordion */}
            <Accordion defaultExpanded sx={{ boxShadow: 'none', border: '1px solid rgba(0,0,0,0.12)', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <FaceIcon sx={{ mr: 1, color: 'action.active' }} />
                <Typography variant="subtitle2">{t('painting.tools.notebook.editDialog.characterJsonTitle')}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <TextField
                  multiline
                  fullWidth
                  minRows={4} // JSON编辑区最小行数
                  maxRows={12} // JSON编辑区最大行数，增加以便编辑更多内容
                  label={t('painting.tools.notebook.editDialog.characterJsonLabel')}
                  value={characterTabsJson}
                  onChange={handleCharacterTabsJsonChange}
                  disabled={loading}
                  placeholder={t('painting.tools.notebook.editDialog.characterJsonPlaceholder')}
                  error={Boolean(jsonError)} // 如果jsonError有内容，则显示错误状态
                  helperText={localizedJsonError || t('painting.tools.notebook.editDialog.characterJsonHelp')}
                  sx={{
                    '& .MuiInputBase-input': { fontFamily: '"Roboto Mono", monospace', fontSize: '0.85rem' },
                    '& .MuiFormHelperText-root': { whiteSpace: 'pre-wrap', lineHeight: 1.3 } // 允许helperText换行并调整行高
                  }}
                />
              </AccordionDetails>
            </Accordion>

          </Grid>

          {/* 右侧：图片预览和角色卡预览 */}
          <Grid item xs={12} md={5}>
            <Paper // 使用Paper组件作为容器，美化视觉
              elevation={0} // 无阴影
              sx={{
                height: '100%', display: 'flex', flexDirection: 'column',
                p: 1.5,
                bgcolor: 'background.default', // 使用主题的背景色
                borderRadius: 2, // 圆角
                border: (theme) => `1px solid ${theme.palette.divider}` // 使用主题的分割线颜色作为边框
              }}
            >
              <Typography variant="subtitle2" gutterBottom align="center" sx={{ color: 'text.secondary', mb: 1 }}>{t('painting.tools.notebook.contentPreview')}</Typography>

              {/* 图片预览区 */}
              <Box sx={{
                width: '100%', mb: 2, display: 'flex', justifyContent: 'center', alignItems: 'center',
                minHeight: '150px', maxHeight: '200px', // 限制最大高度
                bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 1, p: 1, overflow: 'hidden'
              }}>
                {editedNote.image_url && !imageError ? ( // 有链接且无错误
                  <img
                    src={editedNote.image_url} alt={t('painting.tools.notebook.previewImageAlt')}
                    onError={handleImageError} onLoad={handleImageLoad}
                    style={{ width: 'auto', height: 'auto', maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', borderRadius: '4px' }}
                  />
                ) : editedNote.image_url && imageError ? ( // 有链接但加载错误
                  <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'text.secondary', textAlign: 'center', p: 1 }}>
                    <BrokenImageIcon fontSize="large" color="error" />
                    <Typography variant="body2" color="error" sx={{ mt: 1 }}>{t('painting.tools.notebook.invalidImageUrl')}</Typography>
                  </Box>
                ) : ( // 无图片链接
                  <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'text.disabled', textAlign: 'center', p: 1 }}>
                    <ImageIcon sx={{ fontSize: '3rem' }} />
                    <Typography variant="caption" sx={{ mt: 1 }}>{t('painting.tools.notebook.noPreviewImage')}</Typography>
                  </Box>
                )}
              </Box>

              {/* 角色卡预览区 */}
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 1, color: 'text.secondary' }}>
                {t('painting.tools.notebook.characterCardPreview')} ({t('painting.tools.notebook.count', { count: Array.isArray(editedNote.character_tabs) ? editedNote.character_tabs.length : 0 })})
              </Typography>
              <Box sx={{
                flexGrow: 1, // 占据剩余空间
                maxHeight: { xs: '150px', md: 'calc(100% - 250px)' }, // 响应式最大高度
                overflowY: 'auto', // 超出则显示滚动条
                pr: 0.5,
                border: (theme) => `1px dashed ${theme.palette.divider}`,
                borderRadius: 1, p: 1,
                bgcolor: Array.isArray(editedNote.character_tabs) && editedNote.character_tabs.length > 0 ? 'transparent' : 'rgba(0,0,0,0.01)'
              }}>
                {/* 确保 editedNote.character_tabs 是数组再 map */}
                {Array.isArray(editedNote.character_tabs) && editedNote.character_tabs.length > 0 ? (
                  editedNote.character_tabs.map((tab, index) => (
                    <CharacterTabPreview key={index} tab={tab} index={index} t={t} />
                  ))
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: { xs: 1, md: 2 }, p: 1 }}>
                    {t('painting.tools.notebook.noCharacterCards')}
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}> {/* 增加内边距 */}
        <Button onClick={handleCloseDialog} disabled={loading} color="inherit">{t('painting.tools.common.cancel')}</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          // 保存按钮的禁用条件：
          // 1. 正在加载中
          // 2. 笔记标题为空或包含中英文冒号
          // 3. JSON有错误 (jsonError为true) 且 用户输入的JSON不是表示空数组的有效形式 (即不是 "[]" 也不是空字符串)
          disabled={
            loading ||
            Boolean(titleError) ||
            (Boolean(jsonError) && characterTabsJson.trim() !== "[]" && characterTabsJson.trim() !== "")
          }
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
        >
          {loading ? t('painting.tools.common.saving') : t('painting.tools.notebook.saveChanges')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NoteEditDialog;
