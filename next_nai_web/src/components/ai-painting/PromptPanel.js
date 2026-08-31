// PromptPanel.js
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react'; // Added useCallback
import {
  Box,
  Tabs,
  Tab,
  TextField,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  Button,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ContentCopy as CopyIcon,
  Delete as ClearIcon,
  Lightbulb as LightbulbIcon,
  Add as AddIcon,
  Book as BookIcon,
  Save as SaveIcon,
  OpenInFull as OpenInFullIcon,
  Casino as CasinoIcon,
} from '@mui/icons-material';
import apiClient from '../../utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';

// 导入提示词编辑器组件
import {
  ExpandedPromptDialog,
  extractActiveContent,
  formatPromptWithHighlighting,
} from './PromptEditor';

// 导入笔记本相关组件
import {
  NoteBook,
  SaveNoteDialog
} from './NoteBook';

// 导入随机提示词组件
import RandomPromptConfig from './RandomPromptConfig/RandomPromptConfig';
import { forwardPaintingPanelError } from './Generation/errorRecords.mjs';
import { getEnabledNovelAICharacterPromptTexts } from './PromptEditor/novelAIImageTokenizer.mjs';
import { getPublicToolErrorMessageKey } from '@/utils/publicToolErrors.mjs';

const PromptPanel = ({
  positivePrompt,
  negativePrompt,
  onPositivePromptChange,
  onNegativePromptChange,
  onSaveCurrentNote,    // 新增: 从 AIPaintingPage 传递过来的保存函数
  onApplyNoteContent,   // 新增: 从 AIPaintingPage 传递过来的应用笔记函数
  onError = null,
  model,
  characterTabs = [],
}) => {
  const { t } = useI18n();
  const [tabValue, setTabValue] = useState(0);
  const effectiveTabValue = tabValue;
  const [expanded, setExpanded] = useState(true);
  const [suggestedTags, setSuggestedTags] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentInput, setCurrentInput] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const [randomPromptDialogOpen, setRandomPromptDialogOpen] = useState(false);
  const [randomPromptEnabled, setRandomPromptEnabled] = useState(false);
  const [randomPromptConfig, setRandomPromptConfig] = useState(null);

  const [expandedPromptDialogOpen, setExpandedPromptDialogOpen] = useState(false);
  const [activeTabForDialog, setActiveTabForDialog] = useState(0);

  const [lastCursorPosition, setLastCursorPosition] = useState(null);

  const textFieldRef = useRef(null);
  const debounceTimerRef = useRef(null);

  // Define checkRandomPromptStatus using useCallback
  const checkRandomPromptStatus = useCallback(async () => {
    try {
      const config = await apiClient.getRandomPromptConfig();
      setRandomPromptEnabled(config.enabled !== false);
      setRandomPromptConfig(config); // This state is used by getActualPromptContent
    } catch (error) {
      console.error('获取随机提示词配置失败:', error);
      const messageKey = getPublicToolErrorMessageKey(
        error,
        'painting.tools.randomPrompt.errors.loadFailed',
      );
      forwardPaintingPanelError(onError, error, {
        source: 'random-prompt-config',
        messageKey,
      });
    }
  }, [onError]);

  // Load random prompt config on mount
  useEffect(() => {
    checkRandomPromptStatus();
  }, [checkRandomPromptStatus]); // Call the memoized function

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    setSuggestedTags([]);
  };

  // 处理打开随机提示词配置对话框
  const handleOpenRandomPromptDialog = () => {
    setRandomPromptDialogOpen(true);
  };

  // 处理关闭随机提示词配置对话框
  const handleCloseRandomPromptDialog = () => {
    setRandomPromptDialogOpen(false);
    checkRandomPromptStatus(); // Re-fetch config when dialog closes
  };

  // 提取当前标签
  const extractCurrentTag = (text, position) => {
    if (!text || position === undefined || position === null) return '';
    const safePosition = Math.min(Math.max(0, position), text.length);
    const textBeforeCursor = text.substring(0, safePosition);
    const lastCommaIndex = Math.max(
      textBeforeCursor.lastIndexOf(','),
      textBeforeCursor.lastIndexOf('，')
    );
    return textBeforeCursor.substring(lastCommaIndex + 1).trim();
  };

  // 处理插入随机提示词标记
  const handleInsertRandomPrompt = (syntax) => {
    const isPositive = effectiveTabValue === 0;
    const prompt = isPositive ? positivePrompt : negativePrompt;
    const updateFn = isPositive ? onPositivePromptChange : onNegativePromptChange;

    if (typeof updateFn !== 'function') return;

    const insertPosition = lastCursorPosition !== null ? lastCursorPosition :
      (cursorPosition !== null ? cursorPosition : 0);

    const newText = prompt.substring(0, insertPosition) + syntax + prompt.substring(insertPosition);
    updateFn(newText);

    setTimeout(() => {
      if (textFieldRef.current) {
        const inputElement = textFieldRef.current.querySelector('textarea');
        if (inputElement) {
          const newCursorPos = insertPosition + syntax.length;
          inputElement.focus();
          inputElement.selectionStart = newCursorPos;
          inputElement.selectionEnd = newCursorPos;
          setLastCursorPosition(newCursorPos);
          setCursorPosition(newCursorPos);
        }
      }
    }, 0);
  };

  // 处理输入变化
  const handleTextFieldChange = (e, updateFn) => {
    const newValue = e.target.value;
    if (typeof updateFn === 'function') {
      updateFn(newValue);
    }

    const cursorPos = e.target.selectionStart !== null ? e.target.selectionStart : 0;
    setCursorPosition(cursorPos);
    setLastCursorPosition(cursorPos);

    try {
      if (newValue) {
        const currentTag = extractCurrentTag(newValue, cursorPos);
        if (currentTag !== currentInput) {
          setCurrentInput(currentTag);
        }
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        if (currentTag && currentTag.trim()) {
          debounceTimerRef.current = setTimeout(() => {
            fetchSuggestedTags(currentTag.trim());
          }, 1000);
        } else {
          setSuggestedTags([]);
        }
      } else {
        setCurrentInput('');
        setSuggestedTags([]);
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      }
    } catch (error) {
      console.error('Error in handleTextFieldChange:', error);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    }
  };

  const handleTextFieldClick = (e) => {
    const cursorPos = e.target.selectionStart !== null ? e.target.selectionStart : 0;
    setCursorPosition(cursorPos);
    setLastCursorPosition(cursorPos);
  };

  const fetchSuggestedTags = async (tagText) => {
    if (!tagText) return;
    setIsLoading(true);
    try {
      const data = await apiClient.getPrompt(tagText, model);
      if (data && data.tags && Array.isArray(data.tags)) {
        const topEightTags = data.tags.slice(0, 8).map(item => ({
          name: item.tag_name || item.tag,
          category: item.d_category || item.category || 'general'
        })).filter(item => item.name);
        setSuggestedTags(topEightTags);
      }
    } catch (error) {
      console.error("Error fetching tags:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReplaceSuggestion = (suggestion) => {
    const isPositive = effectiveTabValue === 0;
    const prompt = isPositive ? positivePrompt : negativePrompt;
    const updateFn = isPositive ? onPositivePromptChange : onNegativePromptChange;
    if (typeof updateFn !== 'function') return;

    if (!prompt) {
      updateFn(suggestion + ', ');
      setTimeout(() => {
        if (textFieldRef.current) {
          const inputElement = textFieldRef.current.querySelector('textarea');
          if (inputElement) {
            inputElement.focus();
            inputElement.selectionStart = suggestion.length + 2;
            inputElement.selectionEnd = suggestion.length + 2;
          }
        }
      }, 0);
      return;
    }

    const textBeforeCursor = prompt.substring(0, cursorPosition);
    const textAfterCursor = prompt.substring(cursorPosition);

    const lastCommaIndex = Math.max(
      textBeforeCursor.lastIndexOf(','),
      textBeforeCursor.lastIndexOf('，')
    );

    let newText;
    if (lastCommaIndex === -1) {
      newText = suggestion + ', ' + textAfterCursor;
    } else {
      const textBeforeTag = prompt.substring(0, lastCommaIndex + 1);
      newText = textBeforeTag + ' ' + suggestion + ', ' + textAfterCursor;
    }

    updateFn(newText);
    setSuggestedTags([]);

    const newCursorPos = newText.length - textAfterCursor.length;
    setTimeout(() => {
      if (textFieldRef.current) {
        const inputElement = textFieldRef.current.querySelector('textarea');
        if (inputElement) {
          inputElement.focus();
          inputElement.selectionStart = newCursorPos;
          inputElement.selectionEnd = newCursorPos;
        }
      }
    }, 0);
  };

  const handleClearPrompt = () => {
    if (effectiveTabValue === 0) {
      if (typeof onPositivePromptChange === 'function') {
        onPositivePromptChange('');
      }
    } else if (effectiveTabValue === 1) {
      if (typeof onNegativePromptChange === 'function') {
        onNegativePromptChange('');
      }
    } else if (effectiveTabValue === 2) {
    }
    setSuggestedTags([]);
  };

  const handleOpenExpandedDialog = (tabIndex) => {
    setActiveTabForDialog(tabIndex);
    setExpandedPromptDialogOpen(true);
  };

  const handleExpandedPromptChange = (newText) => {
    if (activeTabForDialog === 0) {
      if (typeof onPositivePromptChange === 'function') {
        onPositivePromptChange(newText);
      }
    } else {
      if (typeof onNegativePromptChange === 'function') {
        onNegativePromptChange(newText);
      }
    }
  };

  const getActualPromptContent = () => {
    if (!randomPromptEnabled || !randomPromptConfig) {
      return {
        positivePrompt: extractActiveContent(positivePrompt),
        negativePrompt: extractActiveContent(negativePrompt)
      };
    }

    return {
      positivePrompt: extractActiveContent(positivePrompt, {
        processRandomPrompts: true,
        randomPromptConfig
      }),
      negativePrompt: extractActiveContent(negativePrompt, {
        processRandomPrompts: true,
        randomPromptConfig
      })
    };
  };

  const handleOpenNotesDialog = async () => {
    setNotesDialogOpen(true);
    await fetchNotes();
  };

  const fetchNotes = async () => {
    setIsLoadingNotes(true);
    try {
      const response = await apiClient.getTexts();
      setNotes(response.texts || []);
    } catch (error) {
      console.error('Error fetching notes:', error);
      const reported = forwardPaintingPanelError(onError, error, {
        source: 'prompt-notes',
        messageKey: 'painting.workspace.prompt.fetchNotesFailed',
      });
      if (!reported) {
        setSnackbar({
          open: true,
          message: t('painting.workspace.prompt.fetchNotesFailed'),
          severity: 'error'
        });
      }
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const handleSaveNote = () => {
    setSaveDialogOpen(true);
  };

  const handleSaveNoteSubmit = async (title, imageUrl) => {
    if (onSaveCurrentNote) {
      const success = await onSaveCurrentNote(title, imageUrl);
      if (success) {
        setSaveDialogOpen(false); // 如果保存成功，关闭对话框
        if (notesDialogOpen) { // 如果笔记本是打开的，刷新它
          fetchNotes();
        }
      }
      // 失败时的提示由 onSaveCurrentNote 内部处理
      return success;
    }
    return false;
  };

  const handleUseNote = (note) => {
    // 调用从 AIPaintingPage 传递过来的函数来应用笔记内容
    if (onApplyNoteContent) {
      onApplyNoteContent(note);
    } else {
      // 旧的直接修改方式，如果 onApplyNoteContent 未提供，作为后备
      if (typeof onPositivePromptChange === 'function') {
        onPositivePromptChange(note.text_content1 || '');
      }
      if (typeof onNegativePromptChange === 'function') {
        onNegativePromptChange(note.text_content2 || '');
      }
      setSnackbar({ open: true, message: t('painting.workspace.prompt.noteApplied'), severity: 'success' });
    }
    setNotesDialogOpen(false); // 关闭笔记本对话框
  };

  const handleDeleteNote = async (note) => {
    try {
      await apiClient.deleteText(note.title);
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.noteDeleted'),
        severity: 'success'
      });
      await fetchNotes();
      return true;
    } catch (error) {
      forwardPaintingPanelError(onError, error, {
        source: 'note-delete',
        messageKey: 'painting.workspace.prompt.deleteNoteFailed',
      });
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.deleteNoteFailed'),
        severity: 'error'
      });
      return false;
    }
  };

  const handleUpdateNote = async (editedNote, originalTitle) => {
    try {
      // 确保 apiClient.updateText 调用时传递了 character_tabs
      // editedNote 对象应该直接包含了所有需要更新的字段，包括 character_tabs
      await apiClient.updateText(
        originalTitle,
        editedNote.title,
        editedNote.text_content1,
        editedNote.text_content2,
        editedNote.image_url,
        editedNote.character_tabs // <--- 修复：确保传递 character_tabs
      );

      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.noteUpdated'),
        severity: 'success'
      });

      await fetchNotes(); // 重新获取笔记列表以更新视图
      return true; // 指示更新成功
    } catch (error) {
      forwardPaintingPanelError(onError, error, {
        source: 'note-update',
        messageKey: 'painting.workspace.prompt.updateNoteFailed',
      });
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.updateNoteFailed'),
        severity: 'error'
      });
      return false; // 指示更新失败
    }
  };

  const handleExportNotes = async () => {
    try {
      const response = await apiClient.exportTexts();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(response.texts));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "notes_export.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.notesExported'),
        severity: 'success'
      });
    } catch (error) {
      forwardPaintingPanelError(onError, error, {
        source: 'note-export',
        messageKey: 'painting.workspace.prompt.exportNotesFailed',
      });
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.exportNotesFailed'),
        severity: 'error'
      });
    }
  };

  const handleImportNotes = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          let content;
          try {
            content = JSON.parse(e.target.result);
          } catch (error) {
            // 无效的本地 JSON 文件属于输入校验，不伪装成后端错误记录。
            console.error('解析导入笔记文件失败:', error);
            setSnackbar({
              open: true,
              message: t('painting.workspace.prompt.importNotesFailed'),
              severity: 'error'
            });
            return;
          }

          try {
            await apiClient.importTexts(content);
            setSnackbar({
              open: true,
              message: t('painting.workspace.prompt.notesImported'),
              severity: 'success'
            });
            await fetchNotes();
          } catch (error) {
            forwardPaintingPanelError(onError, error, {
              source: 'note-import',
              messageKey: 'painting.workspace.prompt.importNotesFailed',
            });
            setSnackbar({
              open: true,
              message: t('painting.workspace.prompt.importNotesFailed'),
              severity: 'error'
            });
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // The rest of the component's JSX remains the same, ensure that
  // <RandomPromptConfig open={randomPromptDialogOpen} onClose={handleCloseRandomPromptDialog} ... />
  // correctly uses the updated handleCloseRandomPromptDialog.

  return (
    <Accordion
      expanded={expanded}
      onChange={() => setExpanded(!expanded)}
      disableGutters
      sx={{
        boxShadow: 'none',
        borderRadius: 2,
        '&::before': {
          display: 'none',
        },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          minHeight: 42,
          backgroundColor: theme => expanded ? theme.palette.primary.main : 'background.paper',
          color: expanded ? 'white' : 'text.primary',
          borderRadius: expanded ? '8px 8px 0 0' : 2,
          transition: 'all 0.2s ease',
        }}
      >
        <Typography variant="subtitle1" fontWeight="medium">
          {t('painting.workspace.prompt.title')}
        </Typography>
      </AccordionSummary>

      <AccordionDetails sx={{ p: 0 }}>
        <Box sx={{ width: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Tabs
                value={effectiveTabValue}
                onChange={handleTabChange}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{
                  minHeight: 48,
                  flex: 1,
                  '& .MuiTabs-indicator': {
                    height: 3,
                  },
                  '& .MuiTab-root': {
                    minHeight: 48,
                    fontWeight: 500,
                  },
                }}
              >
                <Tab label={t('painting.workspace.prompt.positiveTab')} />
                <Tab label={t('painting.workspace.prompt.negativeTab')} />
            </Tabs>
            {(
              <Tooltip title={t('painting.workspace.prompt.randomPrompt')} arrow>
                <IconButton
                  aria-label={t('painting.workspace.prompt.randomPrompt')}
                  onClick={handleOpenRandomPromptDialog}
                  sx={{ mr: 1 }}
                  color={randomPromptEnabled ? "secondary" : "default"}
                >
                  <CasinoIcon />
                </IconButton>
              </Tooltip>
            )}
            {(
              <>
                <Tooltip title={t('painting.workspace.prompt.notebook')} arrow>
                  <IconButton
                    aria-label={t('painting.workspace.prompt.notebook')}
                    onClick={handleOpenNotesDialog}
                    sx={{ mr: 1 }}
                  >
                    <BookIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('painting.workspace.prompt.saveToNotebook')} arrow>
                  <IconButton
                    aria-label={t('painting.workspace.prompt.saveToNotebook')}
                    onClick={handleSaveNote}
                    sx={{ mr: 1 }}
                    disabled={!positivePrompt && !negativePrompt}
                  >
                    <SaveIcon />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Box>

          <Box sx={{ p: 0.5 }}>
            {effectiveTabValue === 0 ? (
              <>
                {
                  !expandedPromptDialogOpen && (
                    <Box sx={{ position: 'relative' }} ref={textFieldRef}>
                      <TextField
                        multiline
                        fullWidth
                        minRows={6}
                        maxRows={8}
                        placeholder={t('painting.workspace.prompt.positivePlaceholder')}
                        value={positivePrompt}
                        onChange={(e) => handleTextFieldChange(e, onPositivePromptChange)}
                        onClick={handleTextFieldClick}
                        onSelect={(e) => handleTextFieldChange(e, onPositivePromptChange)} // Corrected to ensure cursor updates
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            borderRadius: 2,
                          },
                          '& .MuiInputBase-input': {
                            fontFamily: '"Roboto Mono", monospace',
                            fontSize: '0.95rem',
                          }
                        }}
                      />
                      <Box
                        sx={{
                          position: 'absolute',
                          right: 1,
                          top: 1,
                          display: 'flex',
                          gap: 1,
                        }}
                      >
                        <Tooltip title={t('painting.workspace.prompt.expandEditor')} arrow>
                          <IconButton
                            aria-label={t('painting.workspace.prompt.expandPositiveEditor')}
                            size="small"
                            onClick={() => handleOpenExpandedDialog(0)}
                            sx={{ opacity: 1, '&:hover': { opacity: 1 } }} // Corrected from opacity: 0.6
                          >
                            <OpenInFullIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {positivePrompt && (
                          <Tooltip title={t('painting.workspace.prompt.clear')} arrow>
                            <IconButton
                              aria-label={t('painting.workspace.prompt.clearPositive')}
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClearPrompt();
                              }}
                              sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                            >
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title={t('painting.workspace.prompt.copy')} arrow>
                          <IconButton
                            aria-label={t('painting.workspace.prompt.copyPositive')}
                            size="small"
                            onClick={() => navigator.clipboard.writeText(positivePrompt || '')}
                            sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  )
                }

                {
                  (!expandedPromptDialogOpen && (suggestedTags.length > 0 || isLoading) && currentInput) ? (
                    <Box sx={{ mt: 1 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}
                      >
                        <LightbulbIcon fontSize="small" sx={{ mr: 0.5, fontSize: 16 }} />
                        {t('painting.workspace.prompt.matchingTagSuggestions')}
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, minHeight: 32 }}>
                        {isLoading ? (
                          <CircularProgress size={20} />
                        ) : (
                          suggestedTags.map((tag, index) => (
                            <Chip
                              key={index}
                              label={tag.name}
                              size="small"
                              onClick={() => handleReplaceSuggestion(tag.name)}
                              icon={<AddIcon fontSize="small" />}
                              variant="outlined"
                              sx={{
                                cursor: 'pointer',
                                '&:hover': {
                                  bgcolor: 'rgba(124, 77, 255, 0.1)',
                                  borderColor: 'primary.main',
                                },
                              }}
                            />
                          ))
                        )}
                      </Box>
                    </Box>
                  ) : null
                }
              </>
            ) : effectiveTabValue === 1 ? (
              <>
                {
                  !expandedPromptDialogOpen && (
                    <Box sx={{ position: 'relative' }} ref={textFieldRef}>
                      <TextField
                        multiline
                        fullWidth
                        minRows={6}
                        maxRows={8}
                        placeholder={t('painting.workspace.prompt.negativePlaceholder')}
                        value={negativePrompt}
                        onChange={(e) => handleTextFieldChange(e, onNegativePromptChange)}
                        onClick={handleTextFieldClick} // Added for consistency
                        onSelect={(e) => handleTextFieldChange(e, onNegativePromptChange)} // Added for consistency
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            borderRadius: 2,
                          },
                          '& .MuiInputBase-input': {
                            fontFamily: '"Roboto Mono", monospace',
                            fontSize: '0.95rem',
                          }
                        }}
                      />
                      <Box
                        sx={{
                          position: 'absolute',
                          right: 1,
                          top: 1,
                          display: 'flex',
                          gap: 1,
                        }}
                      >
                        <Tooltip title={t('painting.workspace.prompt.expandEditor')} arrow>
                          <IconButton
                            aria-label={t('painting.workspace.prompt.expandNegativeEditor')}
                            size="small"
                            onClick={() => handleOpenExpandedDialog(1)}
                            sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                          >
                            <OpenInFullIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {negativePrompt && (
                          <Tooltip title={t('painting.workspace.prompt.clear')} arrow>
                            <IconButton
                              aria-label={t('painting.workspace.prompt.clearNegative')}
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClearPrompt();
                              }}
                              sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                            >
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title={t('painting.workspace.prompt.copy')} arrow>
                          <IconButton
                            aria-label={t('painting.workspace.prompt.copyNegative')}
                            size="small"
                            onClick={() => navigator.clipboard.writeText(negativePrompt || '')}
                            sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  )
                }

                {
                  (!expandedPromptDialogOpen && (suggestedTags.length > 0 || isLoading) && currentInput) ? (
                    <Box sx={{ mt: 1 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}
                      >
                        <LightbulbIcon fontSize="small" sx={{ mr: 0.5, fontSize: 16 }} />
                        {t('painting.workspace.prompt.matchingTagSuggestions')}
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, minHeight: 32 }}>
                        {isLoading ? (
                          <CircularProgress size={20} />
                        ) : (
                          suggestedTags.map((tag, index) => (
                            <Chip
                              key={index}
                              label={tag.name}
                              size="small"
                              onClick={() => handleReplaceSuggestion(tag.name)}
                              icon={<AddIcon fontSize="small" />}
                              variant="outlined"
                              color="error"
                              sx={{
                                cursor: 'pointer',
                                '&:hover': {
                                  bgcolor: 'rgba(244, 67, 54, 0.1)',
                                  borderColor: 'error.main',
                                },
                              }}
                            />
                          ))
                        )}
                      </Box>
                    </Box>
                  ) : null
                }
              </>
            ) : null}
          </Box>
        </Box>
      </AccordionDetails>

      <ExpandedPromptDialog
        open={expandedPromptDialogOpen}
        onClose={() => setExpandedPromptDialogOpen(false)}
        initialText={activeTabForDialog === 0 ? positivePrompt : negativePrompt}
        onTextChange={handleExpandedPromptChange}
        title={activeTabForDialog === 0
          ? t('painting.workspace.prompt.editPositive')
          : t('painting.workspace.prompt.editNegative')}
        isPositive={activeTabForDialog === 0}
        model={model}
        relatedPromptTexts={getEnabledNovelAICharacterPromptTexts(
          characterTabs,
          activeTabForDialog === 0 ? 'prompt' : 'uc',
        )}
        randomPromptConfig={randomPromptConfig}
        randomPromptEnabled={randomPromptEnabled}
        onError={onError}
      />

      {(
        <>
          <NoteBook
            open={notesDialogOpen}
            onClose={() => setNotesDialogOpen(false)}
            notes={notes}
            isLoading={isLoadingNotes}
            positivePrompt={positivePrompt}
            negativePrompt={negativePrompt}
            onUseNote={handleUseNote}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
            onUpdateNote={handleUpdateNote}
            onExportNotes={handleExportNotes}
            onImportNotes={handleImportNotes}
            fetchNotes={fetchNotes}
          />

          <SaveNoteDialog
            open={saveDialogOpen}
            onClose={() => setSaveDialogOpen(false)}
            onSave={handleSaveNoteSubmit}
            positivePrompt={positivePrompt}
            negativePrompt={negativePrompt}
            extractActiveContent={extractActiveContent}
          />

          <RandomPromptConfig
            open={randomPromptDialogOpen}
            onClose={handleCloseRandomPromptDialog} // This now triggers the config refresh
            onInsert={handleInsertRandomPrompt}
            onError={onError}
          />
        </>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Accordion>
  );
};

export default PromptPanel;
