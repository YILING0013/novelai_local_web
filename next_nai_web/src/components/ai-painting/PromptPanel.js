// PromptPanel.js
"use client";

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'; // Added useCallback
import {
  Box,
  Tabs,
  Tab,
  Typography,
  IconButton,
  Tooltip,
  CircularProgress,
  Button,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Delete as ClearIcon,
  Book as BookIcon,
  Save as SaveIcon,
  OpenInFull as OpenInFullIcon,
  Casino as CasinoIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material';
import apiClient from '../../utils/ApiClient';
import { copyTextToClipboard } from '@/utils/browserCapabilities.mjs';
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
import usePromptSuggestions from './PromptEditor/usePromptSuggestions';
import PromptSuggestions from './PromptEditor/PromptSuggestions';
import InlinePromptInput from './PromptEditor/InlinePromptInput';
import PromptEditorSettings from './PromptEditor/PromptEditorSettings';
import usePromptEditorSettings from './PromptEditor/usePromptEditorSettings';
import { NOVELAI_V5_MEDIUM_MODEL_ID } from './utils/novelAIV5Params.mjs';
import { downloadNotesExport } from './noteExport.mjs';

const promptInputFrameSx = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  '--prompt-outline': (theme) => theme.palette.divider,
  '&:hover': { '--prompt-outline': (theme) => theme.palette.text.secondary },
  '&:focus-within': { '--prompt-outline': (theme) => theme.palette.primary.main },
  '& > .prompt-editor-input': {
    gridColumn: '1 / -1',
    border: 0,
    '&:focus-within': { boxShadow: 'none' },
  },
};

const promptActionsSx = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  px: 0.5,
  minHeight: 38,
  '& .MuiIconButton-root': { width: 34, height: 34, p: 0.75 },
};

/**
 * 用一条连续圆角边界包住输入区和右下角按钮，左下角留给角色入口。
 * @param {object} props 输入框、角色入口、按钮，以及外部使用的容器引用。
 * @returns {React.ReactElement} 带阶梯轮廓的提示词编辑区。
 */
function PromptEditorFrame({ children, containerRef }) {
  const [outline, setOutline] = useState('');
  useLayoutEffect(() => {
    const frame = containerRef.current;
    const actions = frame.querySelector('.prompt-editor-actions');
    const updateOutline = () => {
      const frameRect = frame.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const right = frameRect.width - 0.5;
      const bottom = frameRect.height - 0.5;
      const stepX = actionsRect.left - frameRect.left + 0.5;
      const stepY = actionsRect.top - frameRect.top + 0.5;
      // 输入框和按钮共用一条路径，避免多个边框在转角处重叠。
      setOutline(`M 6.5 0.5 H ${right - 6} Q ${right} 0.5 ${right} 6.5 V ${bottom - 6} Q ${right} ${bottom} ${right - 6} ${bottom} H ${stepX + 6} Q ${stepX} ${bottom} ${stepX} ${bottom - 6} V ${stepY + 6} Q ${stepX} ${stepY} ${stepX - 6} ${stepY} H 6.5 Q 0.5 ${stepY} 0.5 ${stepY - 6} V 6.5 Q 0.5 0.5 6.5 0.5 Z`);
    };
    updateOutline();
    const observer = new ResizeObserver(updateOutline);
    observer.observe(frame);
    observer.observe(actions);
    return () => observer.disconnect();
  }, [containerRef]);

  return (
    <Box sx={promptInputFrameSx} ref={containerRef}>
      <Box component="svg" className="prompt-editor-outline" aria-hidden="true" focusable="false" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, fill: 'none', stroke: 'var(--prompt-outline)', strokeWidth: 1 }}>
        <path d={outline} />
      </Box>
      {children}
    </Box>
  );
}

/**
 * 编辑总提示词，并在输入框下方显示参数区提供的角色控件。
 * @param {object} props 总提示词、编辑回调及角色折叠入口和内容。
 * @returns {React.ReactElement} 提示词编辑区。
 */
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
  characterControlSummary = null,
  characterControlContent = null,
}) => {
  const { t } = useI18n();
  const [tabValue, setTabValue] = useState(0);
  const isV5Medium = model === NOVELAI_V5_MEDIUM_MODEL_ID;
  const effectiveTabValue = isV5Medium && tabValue === 1 ? 0 : tabValue;
  const [cursorPosition, setCursorPosition] = useState(0);

  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [noteGroups, setNoteGroups] = useState([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const copyPrompt = async (text) => {
    try {
      await copyTextToClipboard(text || '');
      setSnackbar({ open: true, message: t('common.copied'), severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: t('common.copyFailed'), severity: 'error' });
    }
  };

  const [randomPromptDialogOpen, setRandomPromptDialogOpen] = useState(false);
  const [randomPromptEnabled, setRandomPromptEnabled] = useState(false);
  const [randomPromptConfig, setRandomPromptConfig] = useState(null);

  const [expandedPromptDialogOpen, setExpandedPromptDialogOpen] = useState(false);
  const { inlinePreview: inlinePreviewEnabled, suggestionsEnabled, setSetting } = usePromptEditorSettings();
  const [activeTabForDialog, setActiveTabForDialog] = useState(0);

  const [lastCursorPosition, setLastCursorPosition] = useState(null);

  const textFieldRef = useRef(null);
  const promptInputRef = useRef(null);
  const suggestions = usePromptSuggestions({
    value: effectiveTabValue === 0 ? positivePrompt : negativePrompt,
    onChange: effectiveTabValue === 0 ? onPositivePromptChange : onNegativePromptChange,
    inputRef: promptInputRef,
    enabled: suggestionsEnabled && effectiveTabValue < 2 && !expandedPromptDialogOpen,
  });

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

  useEffect(() => {
    if (isV5Medium && tabValue === 1) {
      // 切换模型或账号时回到可用页签，避免继续编辑不会进入请求的字段。
      setTabValue(0);
      setActiveTabForDialog(0);
    }
  }, [isV5Medium, tabValue]);

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    suggestions.close();
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

  const handleTextFieldChange = (event, updateFn) => {
    updateFn(event.target.value);
    setCursorPosition(event.target.selectionStart);
    setLastCursorPosition(event.target.selectionStart);
    suggestions.updateFromInput(event.currentTarget, event.nativeEvent);
  };

  const handleTextFieldSelect = (event) => {
    setCursorPosition(event.target.selectionStart);
    setLastCursorPosition(event.target.selectionStart);
    suggestions.inputProps.onSelect(event);
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
    suggestions.close();
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
      setNoteGroups(response.groups || []);
      return true;
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
    fetchNotes();
  };

  const handleSaveNoteSubmit = async (title, imageUrl, savedCharacterTabs, groupId) => {
    if (onSaveCurrentNote) {
      const success = await onSaveCurrentNote(title, imageUrl, savedCharacterTabs, groupId);
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
      if (onApplyNoteContent(note) === false) return;
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
        editedNote.character_tabs,
        editedNote.group_id,
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
      await downloadNotesExport(response);
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

  return (
    <Box
      component="section"
      aria-label={t('painting.workspace.prompt.title')}
      sx={{ minWidth: 0 }}
    >
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            minHeight: 44,
            gap: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiIconButton-root': { width: 32, height: 36, p: 0.75, flexShrink: 0 },
            '& .MuiIconButton-root .MuiSvgIcon-root': { fontSize: 20 },
          }}>
            <Tabs
                value={effectiveTabValue}
                onChange={handleTabChange}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{
                  minHeight: 44,
                  minWidth: 0,
                  flex: 1,
                  '& .MuiTabs-indicator': {
                    height: 2,
                  },
                  '& .MuiTab-root': {
                    minHeight: 44,
                    minWidth: 48,
                    px: 1,
                    py: 0.5,
                    fontSize: '0.9375rem',
                    fontWeight: 500,
                  },
                }}
              >
                <Tab label={t('painting.workspace.prompt.positiveTab')} />
                <Tab label={t(isV5Medium ? 'painting.workspace.parameters.fixedNegativeTab' : 'painting.workspace.prompt.negativeTab')} disabled={isV5Medium} />
            </Tabs>
            {isV5Medium && <Tooltip title={t('painting.workspace.parameters.modelV5MediumNegativeHelp')}><InfoIcon fontSize="small" /></Tooltip>}
            {(
              <Tooltip title={t('painting.workspace.prompt.randomPrompt')} arrow>
                <IconButton
                  aria-label={t('painting.workspace.prompt.randomPrompt')}
                  onClick={handleOpenRandomPromptDialog}
                  color={randomPromptEnabled ? "primary" : "default"}
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
                  >
                    <BookIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('painting.workspace.prompt.saveToNotebook')} arrow>
                  <IconButton
                    aria-label={t('painting.workspace.prompt.saveToNotebook')}
                    onClick={handleSaveNote}
                    disabled={!positivePrompt && !negativePrompt && characterTabs.length === 0}
                  >
                    <SaveIcon />
                  </IconButton>
                </Tooltip>
              </>
            )}
            <PromptEditorSettings
                previewEnabled={inlinePreviewEnabled}
                onPreviewChange={(enabled) => setSetting('inlinePreview', enabled)}
                suggestionsEnabled={suggestionsEnabled}
                onSuggestionsChange={(enabled) => setSetting('suggestionsEnabled', enabled)}
            />
          </Box>

          <Box sx={{ pt: 1.5 }}>
            {effectiveTabValue === 0 ? (
              <>
                {
                  !expandedPromptDialogOpen && (
                    <PromptEditorFrame containerRef={textFieldRef}>
                      <InlinePromptInput
                        className="prompt-editor-input"
                        placeholder={t('painting.workspace.prompt.positivePlaceholder')}
                        value={positivePrompt}
                        inputRef={promptInputRef}
                        inputProps={{ ...suggestions.inputProps, onSelect: handleTextFieldSelect }}
                        onChange={(e) => handleTextFieldChange(e, onPositivePromptChange)}
                        previewEnabled={inlinePreviewEnabled}
                        randomPromptConfig={randomPromptConfig}
                      />
                      <Box sx={{ minWidth: 0, pr: 1, display: 'flex', alignItems: 'center' }}>{characterControlSummary}</Box>
                      <Box
                        className="prompt-editor-actions"
                        sx={promptActionsSx}
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
                            onClick={() => copyPrompt(positivePrompt)}
                            sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </PromptEditorFrame>
                  )
                }

              </>
            ) : effectiveTabValue === 1 ? (
              <>
                {
                  !expandedPromptDialogOpen && (
                    <PromptEditorFrame containerRef={textFieldRef}>
                      <InlinePromptInput
                        className="prompt-editor-input"
                        placeholder={t('painting.workspace.prompt.negativePlaceholder')}
                        value={negativePrompt}
                        inputRef={promptInputRef}
                        inputProps={{ ...suggestions.inputProps, onSelect: handleTextFieldSelect }}
                        onChange={(e) => handleTextFieldChange(e, onNegativePromptChange)}
                        previewEnabled={inlinePreviewEnabled}
                        randomPromptConfig={randomPromptConfig}
                      />
                      <Box sx={{ minWidth: 0, pr: 1, display: 'flex', alignItems: 'center' }}>{characterControlSummary}</Box>
                      <Box
                        className="prompt-editor-actions"
                        sx={promptActionsSx}
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
                            onClick={() => copyPrompt(negativePrompt)}
                            sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                          >
                            <CopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </PromptEditorFrame>
                  )
                }

              </>
            ) : null}
          </Box>

      {effectiveTabValue === 2 && characterControlSummary && (
        <Box sx={{ pt: 0.5 }}>{characterControlSummary}</Box>
      )}
      {characterControlContent}

      <PromptSuggestions suggestions={suggestions} />

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
            groups={noteGroups}
            currentCharacterTabs={characterTabs}
            onCreateGroup={async (data) => { await apiClient.createNoteGroup(data); await fetchNotes(); return true; }}
            onUpdateGroup={async (id, data) => { await apiClient.updateNoteGroup(id, data); await fetchNotes(); return true; }}
            onDeleteGroup={async (id) => { await apiClient.deleteNoteGroup(id); await fetchNotes(); return true; }}
            onBatchMoveNotes={async (titles, groupId) => { await apiClient.batchNotes('move', titles, groupId); await fetchNotes(); return true; }}
            onBatchDeleteNotes={async (titles) => { await apiClient.batchNotes('delete', titles); await fetchNotes(); return true; }}
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
            currentCharacterTabs={characterTabs}
            groups={noteGroups}
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
    </Box>
  );
};

export default PromptPanel;
