// ExpandedPromptDialog.js
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  IconButton,
  Tooltip,
  Typography,
  Divider,
  Paper,
  useMediaQuery,
  useTheme,
  Snackbar,
  Alert
} from '@mui/material';
import {
  Close as CloseIcon,
  Check as CheckIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
  Code as CodeIcon,
  FormatClear as FormatClearIcon,
  Casino as CasinoIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material';
import {
  commentText,
  uncommentText,
  extractActiveContent
} from './promptUtils';

// 引入增强的预览组件
import EnhancedPreview from './EnhancedPreview';
import { PROMPT_TEXT_STYLE } from './previewTags.mjs';
import usePromptSuggestions from './usePromptSuggestions';
import PromptSuggestions from './PromptSuggestions';
import PromptEditorSettings from './PromptEditorSettings';
import usePromptEditorSettings from './usePromptEditorSettings';
import usePromptWeightShortcuts from './usePromptWeightShortcuts';
import usePromptTranslationPreview, { PromptTranslationFeedback } from './usePromptTranslationPreview';
// 引入随机提示词控件
import RandomPromptConfig from '../RandomPromptConfig/RandomPromptConfig';
import apiClient from '@/utils/ApiClient';
import { forwardPaintingPanelError } from '../Generation/errorRecords.mjs';
// 引入 NovelAI 图像模型对应的 Tokenizer
import {
  countNovelAIMultiPromptTokens,
  getNovelAIImageTokenizer,
} from './novelAIImageTokenizer.mjs';
import { useI18n } from '@/i18n/I18nProvider';

/** 展开编辑提示词，保留原生光标、输入法和选择行为，并同步预览与联想菜单。 */
const ExpandedPromptDialog = ({
  open,
  onClose,
  initialText,
  onTextChange,
  title,
  isPositive,
  model,
  relatedPromptTexts = [],
  includeCurrentInTokenTotal = true,
  onError = null,
}) => {
  const { t } = useI18n();
  const [text, setText] = useState(initialText || '');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const textFieldRef = useRef(null);
  const previewRef = useRef(null);
  const syncScrollRef = useRef(null);
  const { expandedPreview, overlayPreview, suggestionsEnabled, defaultWeightMode, setSetting } = usePromptEditorSettings();
  const suggestions = usePromptSuggestions({ value: text, onChange: setText, inputRef: textFieldRef, enabled: open && suggestionsEnabled });
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  // 移动端默认不显示预览，桌面端默认显示，但可以关闭
  const showPreview = expandedPreview ?? isDesktop;
  const [isComposing, setIsComposing] = useState(false);
  const previewIsOverlay = showPreview && overlayPreview;
  const translationPreview = usePromptTranslationPreview({ text, previewRef, overlay: previewIsOverlay && !isComposing, enabled: open && !isComposing });
  const weightShortcuts = usePromptWeightShortcuts({ inputRef: textFieldRef, value: text, onChange: setText, defaultWeightMode, onAdjust: translationPreview.close, enabled: !isComposing });

  // 添加随机提示词配置状态
  const [randomPromptConfig, setRandomPromptConfig] = useState(null);
  // 随机提示词对话框状态
  const [randomPromptDialogOpen, setRandomPromptDialogOpen] = useState(false);
  // 提示消息状态
  const [snackbar, setSnackbar] = useState({ open: false, messageKey: '', severity: 'info' });

  // (新增: Tokenizer 状态)
  const [tokenizer, setTokenizer] = useState(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [totalTokenCount, setTotalTokenCount] = useState(0);
  const [tokenLimit, setTokenLimit] = useState(null);
  const [tokenizerStatus, setTokenizerStatus] = useState('unloaded');

  const selectionBackgroundColor = theme.palette.primary.main;


  // 对话框打开时只请求一次随机提示词配置，避免 Tokenizer 状态变化重复记录同一失败。
  useEffect(() => {
    const fetchRandomPromptConfig = async () => {
      try {
        const config = await apiClient.getRandomPromptConfig();
        setRandomPromptConfig(config);
      } catch (error) {
        console.error('获取随机提示词配置失败:', error);
        forwardPaintingPanelError(onError, error, {
          source: 'random-prompt-config',
          messageKey: 'painting.tools.randomPrompt.errors.loadFailed',
        });
      }
    };

    if (open) {
      fetchRandomPromptConfig();
    }
  }, [onError, open]);

  useEffect(() => {
    let cancelled = false;

    // Tokenizer 使用独立生命周期，并在模型切换时选择正确的 V5 Qwen / V4 T5 资源。
    const loadTokenizer = async () => {
      setTokenizerStatus('loading');
      try {
        const tokenizerInfo = await getNovelAIImageTokenizer(model);
        if (!cancelled) {
          setTokenizer(tokenizerInfo.tokenizer);
          setTokenLimit(tokenizerInfo.limit);
          setTokenizerStatus('loaded');
        }
      } catch (err) {
        console.error('Tokenizer load error:', err);
        if (!cancelled) {
          setTokenizer(null);
          setTokenLimit(null);
          setTokenizerStatus('error');
        }
      }
    };

    if (open) {
      loadTokenizer();
    }

    return () => {
      cancelled = true;
    };
  }, [model, open]);

  // 同步外部文本变化
  useEffect(() => {
    setText(initialText || '');
  }, [initialText]);

  // (新增: 计算 Token 数量)
  useEffect(() => {
    if (tokenizer && tokenizerStatus === 'loaded' && text !== undefined && text !== null) {
      try {
        // 使用 extractActiveContent 移除注释，不处理随机提示词
        const activeText = extractActiveContent(text, { processRandomPrompts: false });
        const activeRelatedPromptTexts = relatedPromptTexts.map((promptText) => (
          extractActiveContent(promptText, { processRandomPrompts: false })
        ));
        const currentTokenCount = countNovelAIMultiPromptTokens(tokenizer, [activeText]);
        const totalPromptTexts = includeCurrentInTokenTotal
          ? [activeText, ...activeRelatedPromptTexts]
          : activeRelatedPromptTexts;
        setTokenCount(currentTokenCount);
        setTotalTokenCount(countNovelAIMultiPromptTokens(tokenizer, totalPromptTexts));
      } catch (err) {
        console.error("Tokenization error:", err);
        setTokenCount(0); // 出错时设为0
        setTotalTokenCount(0);
      }
    } else {
      setTokenCount(0); // Tokenizer 未加载或 text 为空时
      setTotalTokenCount(0);
    }
  }, [
    includeCurrentInTokenTotal,
    relatedPromptTexts,
    text,
    tokenizer,
    tokenizerStatus,
  ]);

  const handleTextChange = (e) => {
    // 输入期间不格式化整段文本；否则中文组字和已有光标位置会被异步改写。
    setText(e.currentTarget.value);
    translationPreview.inputProps.onChange(e);
    suggestions.updateFromInput(e.currentTarget, e.nativeEvent);
  };

  const syncScroll = (source, target) => {
    if (!target) return;
    if (syncScrollRef.current?.element === source && Math.abs(syncScrollRef.current.top - source.scrollTop) < 1) {
      syncScrollRef.current = null;
      return;
    }
    // 等宽时逐像素同步；移动端上下布局可能高度不同，按阅读进度同步到相应位置。
    const sameSize = Math.abs(source.clientWidth - target.clientWidth) < 2 && Math.abs(source.clientHeight - target.clientHeight) < 2;
    const top = sameSize ? source.scrollTop : source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight) * (target.scrollHeight - target.clientHeight);
    if (Math.abs(target.scrollTop - top) >= 1) {
      target.scrollTop = top;
      syncScrollRef.current = { element: target, top: target.scrollTop };
    }
  };

  useLayoutEffect(() => {
    const input = textFieldRef.current;
    const preview = previewRef.current;
    if (input && preview && Math.abs(input.scrollTop - preview.scrollTop) >= 1) {
      preview.scrollTop = input.scrollTop;
      syncScrollRef.current = { element: preview, top: preview.scrollTop };
    }
  }, [text, showPreview, previewIsOverlay, open]);

  const handleSelectText = (e) => {
    suggestions.inputProps.onSelect(e);
    translationPreview.inputProps.onSelect(e);
    setSelection({
      start: e.target.selectionStart,
      end: e.target.selectionEnd,
    });
  };

  const handleApplyChanges = () => {
    if (typeof onTextChange === 'function') {
      onTextChange(text);
    }
    onClose();
  };

  // 处理格式化操作
  const handleFormatOperation = (operation) => {
    if (!textFieldRef.current) return;

    const textarea = textFieldRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;

    // 应用操作
    const result = operation(text, selectionStart, selectionEnd);

    // 更新文本
    setText(result.text);

    // 更新选择
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(result.start, result.end);
    }, 0);
  };

  // 处理随机提示词的插入
  const handleInsertRandomPrompt = (syntax) => {
    if (!textFieldRef.current) return;

    const textarea = textFieldRef.current;
    const { selectionStart, selectionEnd } = textarea;

    // 在光标位置插入语法
    const newText = text.substring(0, selectionStart) + syntax + text.substring(selectionEnd);
    setText(newText);

    // 更新光标位置
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = selectionStart + syntax.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);

    // 关闭随机提示词对话框
    setRandomPromptDialogOpen(false);

    // 显示提示消息
    setSnackbar({
      open: true,
      messageKey: 'painting.tools.promptEditor.randomPromptInserted',
      severity: 'success'
    });
  };

  // 关闭提示消息
  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={isDesktop ? "lg" : false} // 移动端不限制最大宽度
      fullScreen={!isDesktop} // 移动端全屏显示
      PaperProps={{
        sx: {
          height: isDesktop ? '85vh' : '100dvh',
          maxHeight: isDesktop ? '90vh' : '100vh',
          // 移动端时取消圆角和边距
          borderRadius: isDesktop ? undefined : 0,
          margin: isDesktop ? undefined : 0,
        },
      }}
    >
      <DialogTitle sx={{
        // 移动端减少上下内边距
        py: isDesktop ? undefined : 1
      }}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{
            // 移动端缩小标题字体
            fontSize: isDesktop ? undefined : '1.1rem'
          }}>
            {title || t(isPositive
              ? 'painting.tools.promptEditor.editPositivePrompt'
              : 'painting.tools.promptEditor.editNegativePrompt')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <PromptEditorSettings
              previewEnabled={showPreview}
              onPreviewChange={(enabled) => setSetting('expandedPreview', enabled)}
              suggestionsEnabled={suggestionsEnabled}
              onSuggestionsChange={(enabled) => setSetting('suggestionsEnabled', enabled)}
              overlayPreview={overlayPreview}
              onOverlayChange={(enabled) => setSetting('overlayPreview', enabled)}
            />
            <IconButton
              aria-label={t('painting.tools.common.close')}
              onClick={onClose}
              size={isDesktop ? "small" : "medium"}
              sx={{
                // 移动端调整关闭按钮大小
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.2rem'
                }
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        p: isDesktop ? 2 : 1
      }}>
        {/* 工具栏 */}
        <Paper
          elevation={0}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: isDesktop ? 1 : 0.5, // 移动端减少间距
            mb: isDesktop ? 2 : 1, // 移动端减少下边距
            p: isDesktop ? 1 : 0.5, // 移动端减少内边距
            borderRadius: isDesktop ? 2 : 1, // 移动端减少圆角
            backgroundColor: 'rgba(0, 0, 0, 0.03)'
          }}
        >
          <Tooltip title={t('painting.tools.promptEditor.weightUpTooltip')} arrow>
            <IconButton
              aria-label={t('painting.tools.promptEditor.weightUpTooltip')}
              size={isDesktop ? "small" : "medium"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => weightShortcuts.adjustWeight(1)}
              color="primary"
              sx={{
                // 移动端缩小图标
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.1rem'
                }
              }}
            >
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', fontWeight: 700, fontSize: '1rem' }}>W<AddIcon sx={{ fontSize: '1rem' }} /></Box>
            </IconButton>
          </Tooltip>
          <Tooltip title={t('painting.tools.promptEditor.weightDownTooltip')} arrow>
            <IconButton
              aria-label={t('painting.tools.promptEditor.weightDownTooltip')}
              size={isDesktop ? "small" : "medium"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => weightShortcuts.adjustWeight(-1)}
              color="primary"
              sx={{
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.1rem'
                }
              }}
            >
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', fontWeight: 700, fontSize: '1rem' }}>W<RemoveIcon sx={{ fontSize: '1rem' }} /></Box>
            </IconButton>
          </Tooltip>
          <Divider orientation="vertical" flexItem />
          <Tooltip title={t('painting.tools.promptEditor.commentTooltip')} arrow>
            <IconButton
              aria-label={t('painting.tools.promptEditor.commentTooltip')}
              size={isDesktop ? "small" : "medium"}
              onClick={() => handleFormatOperation(commentText)}
              color="secondary"
              sx={{
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.1rem'
                }
              }}
            >
              <CodeIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('painting.tools.promptEditor.uncommentTooltip')} arrow>
            <IconButton
              aria-label={t('painting.tools.promptEditor.uncommentTooltip')}
              size={isDesktop ? "small" : "medium"}
              onClick={() => handleFormatOperation(uncommentText)}
              color="secondary"
              sx={{
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.1rem'
                }
              }}
            >
              <FormatClearIcon />
            </IconButton>
          </Tooltip>
          <Divider orientation="vertical" flexItem />

          {/* 随机提示词按钮 */}
          <Tooltip title={t('painting.tools.promptEditor.insertRandomPrompt')} arrow>
              <IconButton
                aria-label={t('painting.tools.promptEditor.insertRandomPrompt')}
                size={isDesktop ? "small" : "medium"}
                onClick={() => setRandomPromptDialogOpen(true)}
                color="secondary"
                sx={{
                  '& .MuiSvgIcon-root': {
                    fontSize: isDesktop ? undefined : '1.1rem'
                  }
                }}
              >
                <CasinoIcon />
              </IconButton>
          </Tooltip>

        </Paper>

        <Box sx={{
          display: 'grid',
          gridTemplateColumns: isDesktop && showPreview && !previewIsOverlay ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gridTemplateRows: !isDesktop && showPreview && !previewIsOverlay ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: 2,
          flex: 1,
          minHeight: 0,
        }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, minHeight: 28, mb: 0.5, flexShrink: 0 }}>
              <Typography component="label" htmlFor={`${suggestions.listId}-input`} variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {t(previewIsOverlay ? 'painting.tools.promptEditor.overlayPreview' : 'painting.tools.promptEditor.editing')}
              </Typography>
              <Typography variant="caption" sx={{ flex: 1, minWidth: 140, color: tokenizerStatus === 'error' || (tokenLimit && totalTokenCount > tokenLimit) ? 'error.main' : 'text.secondary' }}>
                {tokenizerStatus === 'loading' && t('painting.tools.promptEditor.tokensLoading')}
                {tokenizerStatus === 'loaded' && (tokenLimit
                  ? t('painting.tools.promptEditor.tokenCountWithTotalAndLimit', { count: tokenCount, direction: t(isPositive ? 'painting.tools.promptEditor.positiveDirection' : 'painting.tools.promptEditor.negativeDirection'), total: totalTokenCount, limit: tokenLimit })
                  : t('painting.tools.promptEditor.tokenCount', { count: tokenCount }))}
                {tokenizerStatus === 'error' && t('painting.tools.promptEditor.tokenizerError')}
                {tokenizerStatus === 'unloaded' && t('painting.tools.promptEditor.tokensUnavailable')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 'auto' }}>
                {selection.start === selection.end
                  ? `${t('painting.tools.promptEditor.cursor')}: ${selection.start}`
                  : t('painting.tools.promptEditor.selectedCharacters', { count: selection.end - selection.start })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', '&:focus-within': { borderColor: 'primary.main' } }}>
              <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
                {previewIsOverlay && (
                  <Box sx={{ position: 'absolute', inset: 0, visibility: isComposing ? 'hidden' : 'visible' }}>
                    <EnhancedPreview text={text} randomPromptConfig={randomPromptConfig} scrollRef={previewRef} overlay
                      tags={translationPreview.tags} translations={translationPreview.translations} underline={translationPreview.underline} activeTag={translationPreview.active} />
                  </Box>
                )}
                <Box
                  component="textarea"
                  {...suggestions.inputProps}
                  {...translationPreview.inputProps}
                  id={`${suggestions.listId}-input`}
                  ref={textFieldRef}
                  value={text}
                  aria-label={t('painting.tools.promptEditor.editing')}
                  spellCheck={false}
                  onChange={handleTextChange}
                  onSelect={handleSelectText}
                  onScroll={(event) => {
                    syncScroll(event.currentTarget, previewRef.current);
                    suggestions.inputProps.onScroll(event);
                    translationPreview.close();
                  }}
                  onPointerDown={(event) => { suggestions.inputProps.onPointerDown(event); translationPreview.inputProps.onPointerDown(event); }}
                  onKeyDown={(event) => {
                    if (weightShortcuts.onKeyDown(event)) return;
                    suggestions.inputProps.onKeyDown(event);
                    translationPreview.inputProps.onKeyDown(event);
                  }}
                  onBlur={(event) => { suggestions.inputProps.onBlur(event); translationPreview.close(); }}
                  onCompositionStart={(event) => {
                    setIsComposing(true);
                    translationPreview.inputProps.onCompositionStart(event);
                    suggestions.inputProps.onCompositionStart(event);
                  }}
                  onCompositionEnd={(event) => { setIsComposing(false); suggestions.inputProps.onCompositionEnd(event); }}
                  sx={{
                    ...PROMPT_TEXT_STYLE,
                    display: 'block',
                    position: 'relative',
                    resize: 'none',
                    overscrollBehaviorY: 'contain',
                    outline: 'none',
                    background: 'transparent',
                    color: previewIsOverlay && !isComposing ? 'transparent' : 'text.primary',
                    // caretColor 不解析 MUI 调色板别名，叠加时也必须保持原生光标不透明。
                    caretColor: theme.palette.text.primary,
                    '&::selection': {
                      // 叠加时文字只由预览绘制；组字时预览已隐藏，恢复正常文字选区。
                      backgroundColor: previewIsOverlay && !isComposing ? alpha(selectionBackgroundColor, 0.32) : selectionBackgroundColor,
                      color: previewIsOverlay && !isComposing ? 'transparent' : theme.palette.primary.contrastText,
                    },
                  }}
                />
                <PromptSuggestions suggestions={suggestions} />
              </Box>
            </Box>
          </Box>
          {showPreview && !previewIsOverlay && (
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 28, mb: 0.5, flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary">{t('painting.tools.promptEditor.preview.title')}</Typography>
                <Tooltip title={t('painting.tools.promptEditor.translationHelp')} arrow>
                  <IconButton size="small" aria-label={t('painting.tools.promptEditor.translationHelp')}><InfoIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ flex: 1, minHeight: 0, '& ::selection': { backgroundColor: selectionBackgroundColor, color: theme.palette.primary.contrastText } }}>
                  <EnhancedPreview text={text} randomPromptConfig={randomPromptConfig} scrollRef={previewRef}
                    onScroll={(event) => { syncScroll(event.currentTarget, textFieldRef.current); translationPreview.close(); }}
                    tags={translationPreview.tags} translations={translationPreview.translations}
                    underline={translationPreview.underline} previewProps={translationPreview.previewProps} activeTag={translationPreview.active} />
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>

      <Divider />

      <DialogActions sx={{
        // 移动端减少内边距
        p: isDesktop ? undefined : 1
      }}>
        <Button
          onClick={onClose}
          color="inherit"
          size={isDesktop ? "medium" : "small"}
        >
          {t('painting.tools.common.cancel')}
        </Button>
        <Button
          onClick={handleApplyChanges}
          color="primary"
          variant="contained"
          startIcon={<CheckIcon />}
          size={isDesktop ? "medium" : "small"}
        >
          {t('painting.tools.promptEditor.applyChanges')}
        </Button>
      </DialogActions>
      <PromptTranslationFeedback preview={translationPreview} />

      {/* 随机提示词对话框 */}
      <RandomPromptConfig
        open={randomPromptDialogOpen}
        onClose={() => setRandomPromptDialogOpen(false)}
        onInsert={handleInsertRandomPrompt}
        onError={onError}
      />

      {/* 提示消息 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.messageKey ? t(snackbar.messageKey) : ''}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default ExpandedPromptDialog;
