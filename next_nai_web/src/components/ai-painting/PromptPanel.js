// PromptPanel.js
"use client";

import React, { useContext, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'; // Added useCallback
import {
  Box,
  Tabs,
  Tab,
  TextField,
  Typography,
  IconButton,
  Tooltip,
  CircularProgress,
  Button,
  Snackbar,
  Alert,
  Collapse,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ContentCopy as CopyIcon,
  Delete as ClearIcon,
  Book as BookIcon,
  Save as SaveIcon,
  Translate as TranslateIcon,
  ArrowForward as ArrowForwardIcon,
  OpenInFull as OpenInFullIcon,
  Casino as CasinoIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material';
import apiClient from '../../utils/ApiClient';
import PublicDemoContext from './PublicDemoContext';
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
import { copyTextToClipboard } from '@/utils/browserCapabilities.mjs';
import { downloadNotesExport } from './noteExport.mjs';
import InlinePromptInput from './PromptEditor/InlinePromptInput';
import PromptEditorSettings from './PromptEditor/PromptEditorSettings';
import usePromptEditorSettings from './PromptEditor/usePromptEditorSettings';
import useSuggestionPractice from '@/components/tutorials/useSuggestionPractice';
import EditorExerciseContext from '@/components/tutorials/EditorExerciseContext';
import useEditorExercise, { NOTEBOOK_EXAMPLE_CHARACTERS, NOTEBOOK_EXAMPLE_MODEL } from '@/components/tutorials/useEditorExercise';
import { NOVELAI_V5_MEDIUM_MODEL_ID } from './utils/novelAIV5Params.mjs';

const promptInputFrameSx = {
  position: 'relative',
  // 让底色层只垫在本输入区下面，不会被外层面板背景盖住。
  isolation: 'isolate',
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
function PromptEditorFrame({ children, containerRef, guideTarget }) {
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
    <Box sx={promptInputFrameSx} ref={containerRef} data-release-target={guideTarget}>
      {/* 底色与其他输入框一致，沿同一条阶梯轮廓填充，左下角的角色入口保持面板底色。 */}
      <Box component="svg" aria-hidden="true" focusable="false" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: -1, fill: (theme) => theme.palette.background.input, stroke: 'none' }}>
        <path d={outline} />
      </Box>
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
const PromptPanelContent = ({
  loadAccountSettings = true,
  demonstration = false,
  releaseGuideActive = false,
  suggestionPractice = false,
  onExitSuggestionPractice,
  exercise,
  positivePrompt,
  negativePrompt,
  onPositivePromptChange,
  onNegativePromptChange,
  onSaveCurrentNote,    // 新增: 从 AIPaintingPage 传递过来的保存函数
  onApplyNoteContent,   // 新增: 从 AIPaintingPage 传递过来的应用笔记函数
  onError = null,
  instructionOnly = false,
  restrictedAccount = false,
  model,
  modelOptions,
  characterTabs = [],
  characterControlSummary = null,
  characterControlContent = null,
}) => {
  const { t } = useI18n();
  const practice = useSuggestionPractice(suggestionPractice, onExitSuggestionPractice);
  const publicDemo = useContext(PublicDemoContext);
  const [tabValue, setTabValue] = useState(0);
  const isV5Medium = model === NOVELAI_V5_MEDIUM_MODEL_ID;
  const effectiveTabValue = exercise ? exercise.tab : practice || instructionOnly || (restrictedAccount && tabValue === 2)
    || (isV5Medium && tabValue === 1) ? 0 : tabValue;
  const [cursorPosition, setCursorPosition] = useState(0);

  const [originalTranslationText, setOriginalTranslationText] = useState('');
  const [originalTranslationResult, setOriginalTranslationResult] = useState('');
  const translationText = exercise ? exercise.translationText : originalTranslationText;
  const translationResult = exercise ? exercise.translationResult : originalTranslationResult;
  const setTranslationText = exercise ? (text) => exercise.update({ translationText: text }) : setOriginalTranslationText;
  const setTranslationResult = exercise ? (result) => exercise.update({ translationResult: result }) : setOriginalTranslationResult;
  const [isTranslating, setIsTranslating] = useState(false);

  const [notesDialog, setNotesDialog] = useState(null);
  const notebookExercise = exercise?.topic === 'notebook' ? exercise : null;
  const notebookTopic = notebookExercise?.topic ?? null;
  const notesDialogOpen = notesDialog?.topic === notebookTopic;
  const [notes, setNotes] = useState([]);
  const [noteGroups, setNoteGroups] = useState([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [saveDialog, setSaveDialog] = useState(null);
  const saveDialogOpen = saveDialog?.topic === notebookTopic;
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const [randomPromptDialog, setRandomPromptDialog] = useState(null);
  const randomPromptDialogOpen = randomPromptDialog?.topic === (exercise?.topic ?? null);
  const [randomPromptEnabled, setRandomPromptEnabled] = useState(false);
  const [randomPromptConfig, setRandomPromptConfig] = useState(null);

  const [expandedPromptDialog, setExpandedPromptDialog] = useState(null);
  const expandedPromptDialogOpen = expandedPromptDialog?.topic === (exercise?.topic ?? null);
  const { inlinePreview: inlinePreviewEnabled, suggestionsEnabled, promptCollapsed, setSetting } = usePromptEditorSettings();
  const [activeTabForDialog, setActiveTabForDialog] = useState(0);

  const [lastCursorPosition, setLastCursorPosition] = useState(null);

  const textFieldRef = useRef(null);
  const exercising = Boolean(exercise);
  const exerciseTopic = exercise?.topic;
  useEffect(() => {
    if (notesDialog && notesDialog.topic !== notebookTopic) setNotesDialog(null);
    if (saveDialog && saveDialog.topic !== notebookTopic) setSaveDialog(null);
    if (randomPromptDialog && randomPromptDialog.topic !== (exerciseTopic ?? null)) setRandomPromptDialog(null);
    if (expandedPromptDialog && expandedPromptDialog.topic !== (exerciseTopic ?? null)) setExpandedPromptDialog(null);
  }, [notesDialog, saveDialog, randomPromptDialog, expandedPromptDialog, notebookTopic, exerciseTopic]);

  // Define checkRandomPromptStatus using useCallback
  const checkRandomPromptStatus = useCallback(async () => {
    if (!loadAccountSettings) return;
    if (restrictedAccount) {
      setRandomPromptEnabled(false);
      setRandomPromptConfig(null);
      return;
    }

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
  }, [onError, restrictedAccount, loadAccountSettings]);

  // Load random prompt config on mount
  useEffect(() => {
    checkRandomPromptStatus();
  }, [checkRandomPromptStatus]); // Call the memoized function

  useEffect(() => {
    if (instructionOnly || (restrictedAccount && tabValue === 2) || (isV5Medium && tabValue === 1)) {
      // 切换模型或账号时回到可用页签，避免继续编辑不会进入请求的字段。
      setTabValue(0);
      setActiveTabForDialog(0);
    }
  }, [instructionOnly, isV5Medium, restrictedAccount, tabValue]);

  const handleTabChange = (event, newValue) => {
    if (exercise) {
      exercise.update({ tab: newValue });
      if (newValue === 2) exercise.notify('translationTab');
    } else setTabValue(newValue);
    // 收起时点标签说明要看这一栏，直接展开。
    if (promptCollapsed) setSetting('promptCollapsed', false);
  };

  // 处理打开随机提示词配置对话框
  const handleOpenRandomPromptDialog = () => {
    setRandomPromptDialog({ topic: exercise?.topic ?? null });
    exercise?.notify('openRandom');
  };

  // 处理关闭随机提示词配置对话框
  const handleCloseRandomPromptDialog = () => {
    setRandomPromptDialog(null);
    if (!exercise) checkRandomPromptStatus(); // Re-fetch config when dialog closes
  };

  // 处理插入随机提示词标记
  const handleInsertRandomPrompt = (syntax) => {
    if (exercise) {
      exercise.update({ text: [exercise.text.replace(/[,\s]+$/, ''), syntax].filter(Boolean).join(', ') });
      exercise.notify('insertRandom');
      return;
    }
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
  };

  const handleTextFieldSelect = (event) => {
    setCursorPosition(event.target.selectionStart);
    setLastCursorPosition(event.target.selectionStart);
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
      setTranslationText('');
      setTranslationResult('');
    }
  };

  const handleTranslate = async () => {
    if (!translationText.trim()) {
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.translationTextRequired'),
        severity: 'warning'
      });
      return;
    }

    setIsTranslating(true);
    setTranslationResult('');

    try {
      const response = { translated_text: 'blue hair, red eyes' };

      if (response && response.translated_text) {
        setTranslationResult(response.translated_text);
        exercise?.notify('translate');
        setSnackbar({
          open: true,
          message: t('painting.workspace.prompt.translationSucceeded'),
          severity: 'success'
        });
      } else {
        throw new Error('EMPTY_TRANSLATION_RESULT');
      }
    } catch (error) {
      console.error('翻译失败:', error);
      const messageKey = getPublicToolErrorMessageKey(
        error,
        'painting.workspace.prompt.translationFailed',
      );
      const reported = forwardPaintingPanelError(onError, error, {
        source: 'prompt-translation',
        messageKey,
      });
      if (!reported) {
        setSnackbar({
          open: true,
          message: t(messageKey),
          severity: 'error'
        });
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const handleApplyTranslation = () => {
    if (translationResult && typeof onPositivePromptChange === 'function') {
      if (exercise) {
        exercise.update({ text: translationResult, tab: 0 });
        exercise.notify('applyTranslation');
      } else {
        onPositivePromptChange(translationResult);
        setTabValue(0);
      }
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.translationApplied'),
        severity: 'success'
      });
    }
  };

  const handleOpenExpandedDialog = (tabIndex) => {
    setActiveTabForDialog(tabIndex);
    setExpandedPromptDialog({ topic: exercise?.topic ?? null });
    exercise?.notify('expandEditor');
  };

  const handleExpandedPromptChange = (newText) => {
    if (exercise) {
      exercise.update({ text: newText });
      exercise.notify('applyEditor');
      return;
    }
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
    setNotesDialog({ topic: notebookTopic });
    if (notebookExercise) notebookExercise.notify('openNotebook');
    else if (loadAccountSettings) await fetchNotes();
  };

  const fetchNotes = async ({ reportError = true } = {}) => {
    if (notebookExercise) return true;
    setIsLoadingNotes(true);
    try {
      const response = await apiClient.getTexts();
      setNotes(response.texts || []);
      setNoteGroups(response.groups || []);
      return true;
    } catch (error) {
      console.error('Error fetching notes:', error);
      if (reportError) {
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
      }
      return false;
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const handleSaveNote = () => {
    setSaveDialog({ topic: notebookTopic });
    fetchNotes();
  };

  const handleSaveNoteSubmit = async (title, imageUrl, savedCharacterTabs, groupId) => {
    if (notebookExercise) {
      const note = { title, image_url: imageUrl, group_id: groupId, text_content1: notebookExercise.text,
        text_content2: notebookExercise.negativeText, character_tabs: savedCharacterTabs ?? NOTEBOOK_EXAMPLE_CHARACTERS,
        character_position_mode: 'custom', model: NOTEBOOK_EXAMPLE_MODEL, created_at: String(Math.round(Date.now() / 1000)) };
      if (notebookExercise.notes.some((item) => item.title === title)) return false;
      notebookExercise.update({ notes: [...notebookExercise.notes, note] });
      notebookExercise.notify('saveNote');
      setSaveDialog(null);
      return true;
    }
    if (onSaveCurrentNote) {
      const success = await onSaveCurrentNote(title, imageUrl, savedCharacterTabs, groupId);
      if (success) {
        setSaveDialog(null); // 如果保存成功，关闭对话框
        if (notesDialogOpen) { // 如果笔记本是打开的，刷新它
          fetchNotes();
        }
      }
      // 失败时的提示由 onSaveCurrentNote 内部处理
      return success;
    }
    return false;
  };

  const handleUseNote = (note, applyModel) => {
    if (notebookExercise) {
      notebookExercise.update({ text: note.text_content1, negativeText: note.text_content2,
        appliedModel: applyModel && note.model ? note.model : notebookExercise.appliedModel });
      notebookExercise.notify(applyModel && note.model ? 'applySavedModel' : 'applySameModel');
      setNotesDialog(null);
      return;
    }
    // 调用从 AIPaintingPage 传递过来的函数来应用笔记内容
    if (onApplyNoteContent) {
      if (onApplyNoteContent(note, applyModel) === false) return false;
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
    setNotesDialog(null); // 关闭笔记本对话框
  };

  const handleDeleteNote = async (note) => {
    if (notebookExercise) {
      notebookExercise.update({ notes: notebookExercise.notes.filter((item) => item.title !== note.title) });
      return true;
    }
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
    if (notebookExercise) {
      if (editedNote.title !== originalTitle && notebookExercise.notes.some((note) => note.title === editedNote.title)) return false;
      notebookExercise.update({ notes: notebookExercise.notes.map((note) => note.title === originalTitle ? { ...note, ...editedNote } : note) });
      return true;
    }
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
        editedNote.model,
        editedNote.character_position_mode,
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

  const sampleExport = useRef(null);
  const handleExportNotes = async () => {
    try {
      const response = notebookExercise
        ? { texts: notebookExercise.notes, groups: notebookExercise.groups }
        : await apiClient.exportTexts();
      if (demonstration) sampleExport.current = new File([JSON.stringify(response)], 'notes_export.json', { type: 'application/json' });
      else await downloadNotesExport(response);
      notebookExercise?.notify('exportNotes');
      setSnackbar({
        open: true,
        message: t('painting.workspace.prompt.notesExported'),
        severity: 'success'
      });
    } catch (error) {
      const messageKey = getPublicToolErrorMessageKey(
        error,
        'painting.workspace.prompt.exportNotesFailed',
      );
      const reported = forwardPaintingPanelError(onError, error, {
        source: 'note-export',
        messageKey,
      });
      if (!reported) {
        setSnackbar({
          open: true,
          message: t(messageKey),
          severity: 'error'
        });
      }
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
            if (notebookExercise) {
              const imported = Array.isArray(content) ? content : content.texts;
              if (!Array.isArray(imported) || !imported.length || imported.some((note) => !note || typeof note.title !== 'string')) {
                throw new Error('INVALID_NOTE_FILE');
              }
              const byTitle = new Map(notebookExercise.notes.map((note) => [note.title, note]));
              for (const note of imported) if (!byTitle.has(note.title)) byTitle.set(note.title, note);
              notebookExercise.update({ notes: [...byTitle.values()] });
              notebookExercise.notify('importNotes');
            } else await apiClient.importTexts(content);
            setSnackbar({
              open: true,
              message: t('painting.workspace.prompt.notesImported'),
              severity: 'success'
            });
            await fetchNotes();
          } catch (error) {
            const messageKey = getPublicToolErrorMessageKey(
              error,
              'painting.workspace.prompt.importNotesFailed',
            );
            const reported = forwardPaintingPanelError(onError, error, {
              source: 'note-import',
              messageKey,
            });
            if (!reported) {
              setSnackbar({
                open: true,
                message: t(messageKey, error?.params || {}),
                severity: 'error'
              });
            }
          }
        };
        reader.readAsText(file);
      }
    };
    if (demonstration) {
      if (sampleExport.current) void input.onchange({ target: { files: [sampleExport.current] } });
    } else input.click();
  };



  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  return (
    <Box
      component="section"
      aria-label={t(instructionOnly
        ? 'painting.workspace.prompt.editInstruction'
        : 'painting.workspace.prompt.title')}
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
            {instructionOnly && !exercise ? (
              <Tooltip title={t('painting.workspace.prompt.editInstructionHelp')}>
                <Typography variant="body2" sx={{ flex: 1, px: 1, fontWeight: 500 }}>
                  {t('painting.workspace.prompt.editInstruction')}
                </Typography>
              </Tooltip>
            ) : (
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
                <Tab
                  label={t(isV5Medium
                    ? 'painting.workspace.parameters.fixedNegativeTab'
                    : 'painting.workspace.prompt.negativeTab')}
                  disabled={isV5Medium || Boolean(practice) || exercising}
                />
                {exercise?.topic === 'translation' && (
                  <Tab data-release-target="translationTab" disabled={publicDemo || Boolean(practice) || (exercising && exercise.topic !== 'translation')} label={t('painting.workspace.prompt.translationTab')} />
                )}
              </Tabs>
            )}
            {isV5Medium && (
              <Tooltip title={t('painting.workspace.parameters.modelV5MediumNegativeHelp')} arrow>
                <IconButton size="small" aria-label={t('painting.workspace.parameters.fixedNegativeTab')}>
                  <InfoIcon />
                </IconButton>
              </Tooltip>
            )}
            {!practice && (!exercise || exercise.topic === 'random') && !instructionOnly && !restrictedAccount && (
              <Tooltip title={t('painting.workspace.prompt.randomPrompt')} arrow>
                <span style={{ display: 'inline-flex' }}><IconButton
                  data-release-target="random" aria-label={t('painting.workspace.prompt.randomPrompt')}
                  disabled={publicDemo} onClick={handleOpenRandomPromptDialog}
                  color={randomPromptEnabled ? "primary" : "default"}
                >
                  <CasinoIcon />
                </IconButton></span>
              </Tooltip>
            )}
            {!restrictedAccount && (
              <>
                <Tooltip title={t('painting.workspace.prompt.notebook')} arrow>
                  <span style={{ display: 'inline-flex' }}><IconButton
                    data-release-target="notebook" aria-label={t('painting.workspace.prompt.notebook')}
                    disabled={publicDemo || Boolean(practice) || (exercising && !notebookExercise)} onClick={handleOpenNotesDialog}
                  >
                    <BookIcon />
                  </IconButton></span>
                </Tooltip>
                <Tooltip title={t('painting.workspace.prompt.saveToNotebook')} arrow>
                  <span style={{ display: 'inline-flex' }}><IconButton
                    aria-label={t('painting.workspace.prompt.saveToNotebook')}
                    data-tour="noteSaveEntry" onClick={handleSaveNote}
                    disabled={Boolean(practice) || (exercising && !notebookExercise) || publicDemo ||
                      (!notebookExercise && (instructionOnly ? !positivePrompt : (!positivePrompt && !negativePrompt && characterTabs.length === 0)))}
                  >
                    <SaveIcon />
                  </IconButton></span>
                </Tooltip>
              </>
            )}
            {(!instructionOnly || exercising) && (
              <PromptEditorSettings guideEntry
                previewEnabled={inlinePreviewEnabled}
                onPreviewChange={(enabled) => setSetting('inlinePreview', enabled)}
                suggestionsEnabled={suggestionsEnabled}
                onSuggestionsChange={(enabled) => setSetting('suggestionsEnabled', enabled)}
              />
            )}
            {!practice && <Tooltip title={t(promptCollapsed ? 'painting.workspace.prompt.expandSection' : 'painting.workspace.prompt.collapseSection')} arrow>
              <IconButton
                data-release-target={promptCollapsed ? 'expandSection' : 'collapse'}
                aria-label={t(promptCollapsed ? 'painting.workspace.prompt.expandSection' : 'painting.workspace.prompt.collapseSection')}
                aria-expanded={!promptCollapsed}
                onClick={() => setSetting('promptCollapsed', !promptCollapsed)}
              >
                <ExpandMoreIcon sx={{ transform: promptCollapsed ? 'none' : 'rotate(180deg)', transition: (theme) => theme.transitions.create('transform') }} />
              </IconButton>
            </Tooltip>}
          </Box>

      {/* 收起后只保留标签栏；输入框保持挂载，插入笔记和光标位置等功能不受影响。 */}
      {exercise?.coach}
      {exercise?.action === 'resolveRandom' && !randomPromptDialogOpen && <Button data-tour="randomResolve" size="small" variant="outlined" sx={{ mb: 1 }}
        onClick={() => {
          const result = extractActiveContent(exercise.text, { processRandomPrompts: true,
            randomPromptConfig: exercise.randomConfig, randomCursorStorage: exercise.randomCursorStorage });
          exercise.update({ resolvedPrompt: result });
          if (result !== exercise.text) exercise.notify('resolveRandom');
        }}>{t('tutorials.editorPractice.sampleButton')}</Button>}
      <Collapse in={!promptCollapsed || Boolean(practice)}>
          <Box sx={{ pt: 1.5 }}>
            {practice?.instructions}
            {effectiveTabValue === 0 ? (
              <>
                {
                  !expandedPromptDialogOpen && (
                    <PromptEditorFrame containerRef={textFieldRef} guideTarget="promptInput">
                      <InlinePromptInput
                        className="prompt-editor-input"
                        placeholder={instructionOnly && !practice && !exercise
                          ? t('painting.workspace.prompt.editInstructionPlaceholder')
                          : t('painting.workspace.prompt.positivePlaceholder')}
                        value={exercise ? exercise.text : practice ? practice.value : positivePrompt}
                        suggestionsEnabled={Boolean(practice) || (!exercise && !instructionOnly && !promptCollapsed)}
                        inputProps={practice ? {
                          readOnly: practice.readOnly,
                          'aria-describedby': practice.descriptionId,
                          onKeyDown: (event) => {
                            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                              event.preventDefault();
                              event.stopPropagation();
                              onExitSuggestionPractice();
                            }
                          },
                        } : { onSelect: handleTextFieldSelect }}
                        onChange={exercise ? (e) => exercise.update({ text: e.target.value })
                          : practice ? practice.onChange : (e) => handleTextFieldChange(e, onPositivePromptChange)}
                        onPracticeChoose={practice?.onChoose}
                        previewEnabled={inlinePreviewEnabled && (!instructionOnly || exercising) && !practice}
                        formatEnabled={(!instructionOnly || exercising) && !practice}
                        randomPromptConfig={exercise?.randomConfig ?? randomPromptConfig}
                      />
                      <Box sx={{ minWidth: 0, pr: 1, display: 'flex', alignItems: 'center' }}>{characterControlSummary}</Box>
                      <Box
                        className="prompt-editor-actions"
                        sx={practice ? { ...promptActionsSx, visibility: 'hidden' } : promptActionsSx}
                      >
                        <Tooltip title={t('painting.workspace.prompt.expandEditor')} arrow>
                          <IconButton
                            data-release-target="expandEditor" aria-label={t('painting.workspace.prompt.expandPositiveEditor')}
                            size="small"
                            onClick={() => handleOpenExpandedDialog(0)}
                            sx={{ opacity: 1, '&:hover': { opacity: 1 } }} // Corrected from opacity: 0.6
                          >
                            <OpenInFullIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {positivePrompt && !exercise && (
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
                            onClick={() => copyTextToClipboard((exercise ? exercise.text : positivePrompt) || '')}
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
                        suggestionsEnabled={!promptCollapsed}
                        inputProps={{ onSelect: handleTextFieldSelect }}
                        onChange={(e) => handleTextFieldChange(e, onNegativePromptChange)}
                        previewEnabled={inlinePreviewEnabled && !instructionOnly}
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
                            onClick={() => copyTextToClipboard(negativePrompt || '')}
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
            ) : !restrictedAccount ? (
              // 翻译工具选项卡内容
              <Box>
                <Box data-release-target="translateSource">
                  <TextField
                    multiline
                    fullWidth
                    minRows={3}
                    maxRows={4}
                    data-tour={!translationText.trim() ? 'translationSource' : undefined} label={t('painting.workspace.prompt.sourceText')}
                    InputLabelProps={{ shrink: true }}
                    placeholder={t('painting.workspace.prompt.sourceTextPlaceholder')}
                    value={translationText}
                    onChange={(e) => setTranslationText(e.target.value)}
                    disabled={isTranslating}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 1,
                        p: 1,
                      },
                      '& .MuiInputBase-input': {
                        fontFamily: '"Roboto Mono", monospace',
                        fontSize: '0.95rem',
                      }
                    }}
                  />
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      my: 1,
                      '& .MuiIconButton-root': { width: 32, height: 32, p: 0.75 },
                    }}
                  >
                    <Button
                      variant="contained"
                      startIcon={isTranslating ? <CircularProgress size={18} color="inherit" /> : <TranslateIcon />}
                      data-tour="translate" onClick={handleTranslate}
                      disabled={!translationText || isTranslating}
                      sx={{ mr: 'auto', minHeight: 34, px: 1.5, py: 0.5, borderRadius: 1.5 }}
                    >
                      {isTranslating
                        ? t('painting.workspace.prompt.translating')
                        : t('painting.workspace.prompt.translate')}
                    </Button>
                    {translationText && (
                      <Tooltip title={t('painting.workspace.prompt.clear')} arrow>
                        <IconButton
                          aria-label={t('painting.workspace.prompt.clearSourceText')}
                          size="small"
                          onClick={() => setTranslationText('')}
                          sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                          disabled={isTranslating}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={t('painting.workspace.prompt.copy')} arrow>
                      <IconButton
                        aria-label={t('painting.workspace.prompt.copySourceText')}
                        size="small"
                        onClick={() => copyTextToClipboard(translationText || '')}
                        sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                        disabled={!translationText || isTranslating}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Box sx={{ position: 'relative' }}>
                  <TextField
                    multiline
                    fullWidth
                    minRows={3}
                    maxRows={4}
                    label={t('painting.workspace.prompt.translationResult')}
                    InputLabelProps={{ shrink: true }}
                    placeholder={t('painting.workspace.prompt.translationResultPlaceholder')}
                    value={translationResult}
                    InputProps={{ readOnly: true }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 1,
                        p: 1,
                        backgroundColor: translationResult ? 'action.hover' : 'inherit',
                      },
                      '& .MuiInputBase-input': {
                        fontFamily: '"Roboto Mono", monospace',
                        fontSize: '0.95rem',
                      }
                    }}
                  />
                  {translationResult && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        mt: 1,
                        '& .MuiIconButton-root': { width: 32, height: 32, p: 0.75 },
                      }}
                    >
                      <Button
                        variant="text"
                        data-tour="applyTranslation" onClick={handleApplyTranslation}
                        startIcon={<ArrowForwardIcon />}
                        sx={{ mr: 'auto', minHeight: 34, px: 1, py: 0.5 }}
                      >
                        {t('painting.workspace.prompt.applyToPositive')}
                      </Button>
                      <Tooltip title={t('painting.workspace.prompt.copyResult')} arrow>
                        <IconButton
                          aria-label={t('painting.workspace.prompt.copyResult')}
                          size="small"
                          onClick={() => copyTextToClipboard(translationResult || '')}
                          sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                        >
                          <CopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </Box>

              </Box>
            ) : null}
          </Box>

      {effectiveTabValue === 2 && characterControlSummary && (
        <Box sx={{ pt: 0.5 }}>{characterControlSummary}</Box>
      )}
      {characterControlContent}
      </Collapse>


      <ExpandedPromptDialog
        open={expandedPromptDialogOpen}
        onClose={() => setExpandedPromptDialog(null)}
        initialText={exercise ? exercise.text : activeTabForDialog === 0 ? positivePrompt : negativePrompt}
        formatEnabled={!instructionOnly || exercising}
        onTextChange={handleExpandedPromptChange}
        title={activeTabForDialog === 0
          ? (instructionOnly
            ? t('painting.workspace.prompt.editInstruction')
            : t('painting.workspace.prompt.editPositive'))
          : t('painting.workspace.prompt.editNegative')}
        isPositive={activeTabForDialog === 0}
        model={model}
        relatedPromptTexts={getEnabledNovelAICharacterPromptTexts(
          characterTabs,
          activeTabForDialog === 0 ? 'prompt' : 'uc',
        )}
        randomPromptConfig={exercise?.randomConfig ?? randomPromptConfig}
        randomPromptEnabled={randomPromptEnabled}
        restrictedAccount={restrictedAccount}
        onError={onError}
      />

      {!restrictedAccount && (
        <>
          <NoteBook
            key={notebookTopic || 'account-notebook'}
            releaseGuideActive={releaseGuideActive}
            open={notesDialogOpen}
            onClose={() => setNotesDialog(null)}
            notes={notebookExercise?.notes ?? notes}
            groups={notebookExercise?.groups ?? noteGroups}
            currentCharacterTabs={notebookExercise ? NOTEBOOK_EXAMPLE_CHARACTERS : characterTabs}
            modelOptions={notebookExercise ? undefined : modelOptions}
            onCreateGroup={async (data) => {
              if (notebookExercise) {
                notebookExercise.update({ groups: [...notebookExercise.groups, { ...data, id: crypto.randomUUID() }] });
                notebookExercise.notify('createGroup');
              } else { await apiClient.createNoteGroup(data); await fetchNotes(); }
              return true;
            }}
            onUpdateGroup={async (id, data) => {
              if (notebookExercise) notebookExercise.update({ groups: notebookExercise.groups.map((group) => group.id === id ? { ...group, ...data } : group) });
              else { await apiClient.updateNoteGroup(id, data); await fetchNotes(); }
              return true;
            }}
            onDeleteGroup={async (id) => {
              if (notebookExercise) notebookExercise.update({ groups: notebookExercise.groups.filter((group) => group.id !== id)
                .map((group) => group.parent_id === id ? { ...group, parent_id: null } : group),
              notes: notebookExercise.notes.map((note) => note.group_id === id ? { ...note, group_id: null } : note) });
              else { await apiClient.deleteNoteGroup(id); await fetchNotes(); }
              return true;
            }}
            onBatchMoveNotes={async (titles, groupId) => {
              if (notebookExercise) {
                notebookExercise.update({ notes: notebookExercise.notes.map((note) => titles.includes(note.title) ? { ...note, group_id: groupId } : note) });
                if (groupId) notebookExercise.notify('moveNote');
              } else { await apiClient.batchNotes('move', titles, groupId); await fetchNotes(); }
              return true;
            }}
            onBatchDeleteNotes={async (titles) => {
              if (notebookExercise) notebookExercise.update({ notes: notebookExercise.notes.filter((note) => !titles.includes(note.title)) });
              else { await apiClient.batchNotes('delete', titles); await fetchNotes(); }
              return true;
            }}
            isLoading={!notebookExercise && isLoadingNotes}
            positivePrompt={notebookExercise?.text ?? positivePrompt}
            negativePrompt={notebookExercise?.negativeText ?? negativePrompt}
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
            onClose={() => setSaveDialog(null)}
            onSave={handleSaveNoteSubmit}
            positivePrompt={notebookExercise?.text ?? positivePrompt}
            negativePrompt={notebookExercise?.negativeText ?? negativePrompt}
            extractActiveContent={extractActiveContent}
            model={notebookExercise ? NOTEBOOK_EXAMPLE_MODEL : model}
            currentCharacterTabs={notebookExercise ? NOTEBOOK_EXAMPLE_CHARACTERS : characterTabs}
            groups={notebookExercise?.groups ?? noteGroups}
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

/** 为提示词编辑器提供可随教程退出销毁的偏好和样例。 */
export default function PromptPanel({ promptExerciseTopic = null, promptExerciseActive = false, ...props }) {
  const exercise = useEditorExercise(promptExerciseTopic, props.onExitSuggestionPractice, promptExerciseActive);
  return <EditorExerciseContext.Provider value={exercise && props.demonstration ? { ...exercise, demonstration: true } : exercise}>
    <PromptPanelContent {...props} exercise={exercise?.topic === 'suggestions' ? null : exercise} />
  </EditorExerciseContext.Provider>;
}
