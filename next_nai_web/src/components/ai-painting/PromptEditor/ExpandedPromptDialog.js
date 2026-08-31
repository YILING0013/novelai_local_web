// ExpandedPromptDialog.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  IconButton,
  Tooltip,
  Typography,
  Divider,
  Paper,
  Grid,
  useMediaQuery,
  useTheme,
  Snackbar,
  Alert
} from '@mui/material';
import {
  Close as CloseIcon,
  Check as CheckIcon,
  FormatBold as FormatBoldIcon,
  FormatSize as FormatSizeIcon,
  Code as CodeIcon,
  FormatClear as FormatClearIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Casino as CasinoIcon
} from '@mui/icons-material';
import {
  weightUpText,
  weightDownText,
  commentText,
  uncommentText,
  autoFormatText,
  extractActiveContent
} from './promptUtils';

// 引入增强的预览组件
import EnhancedPreview from './EnhancedPreview';
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

const HighlightedTextarea = ({
  value,
  onChange,
  onSelect,
  inputRef,
  isDesktop,
  tokenCount,
  totalTokenCount,
  tokenLimit,
  tokenizerStatus,
  isPositive,
}) => {
  const { t } = useI18n();
  const [cursorPosition, setCursorPosition] = useState({ start: 0, end: 0 });
  // 新增状态：跟踪输入法是否正在组字
  const [isComposing, setIsComposing] = useState(false);
  const theme = useTheme(); // 获取当前主题

  // UI修复：计算高对比度的选中背景色
  // 浅色模式下使用深色半透明背景，深色模式下使用浅色半透明背景
  const selectionBackgroundColor = theme.palette.mode === 'dark'
    ? 'rgba(255, 255, 255, 0.25)'
    : 'rgba(0, 0, 0, 0.20)';

  // 跟踪光标位置
  const handleSelect = (e) => {
    setCursorPosition({
      start: e.target.selectionStart,
      end: e.target.selectionEnd
    });
    if (onSelect) {
      onSelect(e);
    }
  };

  // 处理输入法组字开始事件
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  // 处理输入法组字结束事件
  const handleCompositionEnd = useCallback((e) => {
    setIsComposing(false);
    // 在组字结束后应用格式化
    const finalValue = e.target.value;
    const formattedValue = autoFormatText(finalValue);
    const cursorPos = e.target.selectionStart;

    // 只有当格式化确实改变了文本时才进行处理
    if (formattedValue !== finalValue) {
      if (onChange) {
        // 创建一个模拟事件对象，以符合 onChange 的预期
        const event = { target: { ...e.target, value: formattedValue } };
        onChange(event); // 将格式化后的值传递给父组件

        // 异步恢复光标位置
        setTimeout(() => {
          if (inputRef && inputRef.current) {
            // 根据格式化前后光标之前文本的差异来调整光标位置
            const textBeforeCursor = finalValue.substring(0, cursorPos);
            const formattedBeforeCursor = autoFormatText(textBeforeCursor);
            const adjustedCursorPos = formattedBeforeCursor.length;
            inputRef.current.selectionStart = adjustedCursorPos;
            inputRef.current.selectionEnd = adjustedCursorPos;
          }
        }, 0);
      }
    } else {
      // 如果格式化未改变文本，但组字过程中值可能已变，仍需通知父组件
      if (onChange && finalValue !== value) {
        const event = { target: { ...e.target, value: finalValue } };
        onChange(event);
      }
    }
  }, [onChange, inputRef, value]); // 添加依赖项

  // 处理文本变化事件
  const handleChange = (e) => {
    const newValue = e.target.value;

    // 如果不在组字过程中，或者需要立即处理（例如非IME输入）
    if (!isComposing && onChange) {
      // 对非输入法输入或组字后的最终输入应用格式化
      const formattedValue = autoFormatText(newValue);
      const cursorPos = e.target.selectionStart;

      // 如果格式化改变了文本
      if (formattedValue !== newValue) {
        const event = { ...e };
        event.target = { ...e.target, value: formattedValue };
        onChange(event); // 传递格式化后的值

        // 异步恢复光标位置
        setTimeout(() => {
          if (inputRef && inputRef.current) {
            const textBeforeCursor = newValue.substring(0, cursorPos);
            const formattedBeforeCursor = autoFormatText(textBeforeCursor);
            const adjustedCursorPos = formattedBeforeCursor.length;
            inputRef.current.selectionStart = adjustedCursorPos;
            inputRef.current.selectionEnd = adjustedCursorPos;
          }
        }, 0);
      } else {
        // 如果格式化未改变文本，直接传递原始事件
        onChange(e);
      }
    } else if (isComposing && onChange) {
      // 如果正在组字，传递原始未格式化的值，让输入法正常工作
      // 格式化将在 handleCompositionEnd 中进行
      const event = { target: { ...e.target, value: newValue } };
      onChange(event);
    }
  };

  return (
    <Box sx={{
      position: 'relative',
      width: '100%',
      height: '100%' // (修改: 98% -> 100%)
    }}>
      {/* 文本输入区域 */}
      <TextField
        inputRef={inputRef}
        multiline
        fullWidth
        value={value}
        onChange={handleChange} // 使用更新后的 handleChange
        onSelect={handleSelect}
        // 添加输入法组字事件处理器
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        variant="outlined"
        sx={{
          height: '100%',
          '& .MuiOutlinedInput-root': {
            fontFamily: '"Roboto Mono", monospace',
            fontSize: '14px',
            lineHeight: 1.5,
            borderRadius: 2,
            height: '100%',
            alignItems: 'flex-start', // 确保内容从顶部对齐
            overflow: 'hidden', // 问题修复：防止内容溢出边框
          },
          '& .MuiInputBase-input': {
            height: '100% !important', // 问题修复：强制高度以支持内部滚动
            overflowY: 'auto !important', // 问题修复：启用垂直滚动
            overflowX: 'hidden',
            // 使用主题的主色调作为真实的光标颜色
            caretColor: theme.palette.primary.main,
            caretWidth: '2px', // (新增: 加宽光标)
            '&::selection': {
              backgroundColor: selectionBackgroundColor, // UI修复：应用自定义选择背景色
            },
            verticalAlign: 'top', // 文本从顶部开始
            paddingTop: '12px', // 添加一些顶部内边距
            paddingBottom: '30px', // (新增: 为状态栏腾出空间)
            boxSizing: 'border-box', // 确保 padding 计算在高度内
          },
        }}
      />

      {/* 状态栏 (修改: 调整定位和内容) */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 8, // (修改: 1 -> 8px)
          right: 14, // (修改: 1 -> 14px)
          zIndex: 1, // (新增: 确保在 padding 区域可见)
          width: 'calc(100% - 28px)', // 确保宽度在 padding 内
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          fontSize: '0.75rem',
          pointerEvents: 'none', // 允许点击穿透（如果遮挡了滚动条）
        }}
      >
        {/* “编辑中”指示器 */}
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            mr: 'auto', // (新增: 推到左侧)
          }}
        >
          {/* 模拟光标的 Span 元素 (样式已存在) */}
          <span style={{
            width: '2px', // 光标宽度调整为 2px
            height: '16px',
            // 根据主题模式设置背景色，暗色模式使用主文本色，亮色模式使用主色调
            backgroundColor: theme.palette.mode === 'dark' ? theme.palette.text.primary : theme.palette.primary.main,
            opacity: 1, // 保证初始不透明
            display: 'inline-block',
            marginRight: '4px',
            animation: 'blink 1s step-end infinite', // 闪烁动画
          }}></span>
          {t('painting.tools.promptEditor.editing')}
        </Typography>

        {/* (新增: Token 计数显示) */}
        <Typography
          variant="caption"
          sx={{
            color: tokenizerStatus === 'loaded'
              ? (tokenLimit && totalTokenCount > tokenLimit ? 'error.main' : 'text.secondary')
              : (tokenizerStatus === 'error' ? 'error.main' : 'text.disabled'),
            backgroundColor: 'rgba(0, 0, 0, 0.05)',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '0.7rem',
            flexShrink: 0, // 防止收缩
          }}
        >
          {tokenizerStatus === 'loading' && t('painting.tools.promptEditor.tokensLoading')}
          {tokenizerStatus === 'loaded' && (tokenLimit
            ? t('painting.tools.promptEditor.tokenCountWithTotalAndLimit', {
              count: tokenCount,
              direction: t(isPositive
                ? 'painting.tools.promptEditor.positiveDirection'
                : 'painting.tools.promptEditor.negativeDirection'),
              total: totalTokenCount,
              limit: tokenLimit,
            })
            : t('painting.tools.promptEditor.tokenCount', { count: tokenCount }))}
          {tokenizerStatus === 'error' && t('painting.tools.promptEditor.tokenizerError')}
          {tokenizerStatus === 'unloaded' && t('painting.tools.promptEditor.tokensUnavailable')}
        </Typography>

        {/* 显示光标位置或选择范围 */}
        {cursorPosition.start === cursorPosition.end ? (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              backgroundColor: 'rgba(0, 0, 0, 0.05)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              flexShrink: 0, // 防止收缩
            }}
          >
            {t('painting.tools.promptEditor.cursor')}: {cursorPosition.start}
          </Typography>
        ) : (
          <Typography
            variant="caption"
            sx={{
              color: 'primary.main',
              backgroundColor: 'rgba(124, 77, 255, 0.1)', // 紫色背景高亮选择范围
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              flexShrink: 0, // 防止收缩
            }}
          >
            {t('painting.tools.promptEditor.selectedCharacters', { count: cursorPosition.end - cursorPosition.start })}
          </Typography>
        )}
      </Box>

      {/* 光标闪烁动画的 CSS 定义 */}
      <style>
        {`
          @keyframes blink {
            0% { opacity: 1; }
            50% { opacity: 0; }
            100% { opacity: 1; }
          }
        `}
      </style>
    </Box>
  );
};

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
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  // 移动端默认不显示预览，桌面端默认显示，但可以关闭
  const [showPreview, setShowPreview] = useState(isDesktop);

  // 添加随机提示词配置状态
  const [randomPromptConfig, setRandomPromptConfig] = useState(null);
  const [randomPromptEnabled, setRandomPromptEnabled] = useState(false);
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

  // UI修复：计算预览区域的选择背景色
  const selectionBackgroundColor = theme.palette.mode === 'dark'
    ? 'rgba(255, 255, 255, 0.25)'
    : 'rgba(0, 0, 0, 0.20)';

  useEffect(() => {
    // 只在组件初始化时根据设备类型设置默认预览状态
  }, []); // 空依赖数组，只在组件挂载时执行一次

  // 对话框打开时只请求一次随机提示词配置，避免 Tokenizer 状态变化重复记录同一失败。
  useEffect(() => {
    const fetchRandomPromptConfig = async () => {
      try {
        const config = await apiClient.getRandomPromptConfig();
        setRandomPromptConfig(config);
        setRandomPromptEnabled(config.enabled !== false);
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
    setText(e.target.value);
  };

  const handleSelectText = (e) => {
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
    const { selectionStart } = textarea;

    // 在光标位置插入语法
    const newText = text.substring(0, selectionStart) + syntax + text.substring(selectionStart);
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
          minHeight: isDesktop ? '80vh' : '90vh',
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
      </DialogTitle>

      <Divider />

      <DialogContent sx={{
        height: isDesktop ? 'calc(80vh - 130px)' : 'calc(100vh - 120px)',
        // 移动端减少内边距
        p: isDesktop ? undefined : 1
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
              onClick={() => handleFormatOperation(weightUpText)}
              color="primary"
              sx={{
                // 移动端缩小图标
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.1rem'
                }
              }}
            >
              <FormatBoldIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('painting.tools.promptEditor.weightDownTooltip')} arrow>
            <IconButton
              aria-label={t('painting.tools.promptEditor.weightDownTooltip')}
              size={isDesktop ? "small" : "medium"}
              onClick={() => handleFormatOperation(weightDownText)}
              color="primary"
              sx={{
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.1rem'
                }
              }}
            >
              <FormatSizeIcon />
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

          <Box sx={{ flex: 1 }} />

          {/* 显示随机提示词状态 */}
          {randomPromptEnabled && (
            <Tooltip title={t('painting.tools.promptEditor.randomPreviewEnabled')} arrow>
              <IconButton
                aria-label={t('painting.tools.promptEditor.randomPreviewEnabled')}
                size={isDesktop ? "small" : "medium"}
                color="secondary"
                sx={{
                  mr: isDesktop ? 1 : 0.5,
                  '& .MuiSvgIcon-root': {
                    fontSize: isDesktop ? undefined : '1.1rem'
                  }
                }}
              >
                <CasinoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {/* 修复：预览按钮改为眼睛图标，并且可以自由切换 */}
          <Tooltip title={showPreview
            ? t('painting.tools.promptEditor.hidePreview')
            : t('painting.tools.promptEditor.showPreview')} arrow>
            <IconButton
              aria-label={showPreview
                ? t('painting.tools.promptEditor.hidePreview')
                : t('painting.tools.promptEditor.showPreview')}
              size={isDesktop ? "small" : "medium"}
              color={showPreview ? "primary" : "default"}
              onClick={() => setShowPreview(!showPreview)}
              sx={{
                '& .MuiSvgIcon-root': {
                  fontSize: isDesktop ? undefined : '1.1rem'
                }
              }}
            >
              {showPreview ? <VisibilityIcon /> : <VisibilityOffIcon />}
            </IconButton>
          </Tooltip>
        </Paper>

        {/* 布局：桌面端左右结构，移动端上下结构 */}
        <Grid container spacing={isDesktop ? 2 : 1} sx={{ height: `calc(100% - ${isDesktop ? 50 : 30}px)` }}>
          {/* 编辑器区域 */}
          <Grid item xs={12} md={showPreview ? 6 : 12} sx={{ height: '100%' }}>
            <HighlightedTextarea
              value={text}
              onChange={handleTextChange}
              onSelect={handleSelectText}
              inputRef={textFieldRef}
              isDesktop={isDesktop}
              tokenCount={tokenCount}
              totalTokenCount={totalTokenCount}
              tokenLimit={tokenLimit}
              tokenizerStatus={tokenizerStatus}
              isPositive={isPositive}
            />
          </Grid>

          {/* 预览区域 - 桌面端在右侧，移动端在下方 */}
          {showPreview && (
            <Grid item xs={12} md={6} sx={{
              mt: isDesktop ? 0 : 1, // 移动端减少顶部间距
              height: isDesktop ? '100%' : '250px' // 移动端减少预览高度
            }}>
              {/* 修复：为预览区域添加文本换行样式 */}
              <Box sx={{
                height: '100%',
                overflow: 'auto',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
                backgroundColor: 'background.paper',
                // 确保文本可以自动换行
                wordWrap: 'break-word',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap', // 保持换行符并允许自动换行
                // UI修复：在预览区域也应用高对比度选择背景色
                '& ::selection': {
                  backgroundColor: selectionBackgroundColor
                }
              }}>
                {/* 使用增强的预览组件替换原来的CommentPreview */}
                <EnhancedPreview
                  text={text}
                  randomPromptConfig={randomPromptConfig}
                />
              </Box>
            </Grid>
          )}
        </Grid>
      </DialogContent>

      <Divider />

      <DialogActions sx={{
        // 移动端减少内边距
        p: isDesktop ? undefined : 1
      }}>
        {/* 桌面端显示解释性文本，移动端隐藏 */}
        {isDesktop && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ flex: 1, pl: 2 }}
          >
            {randomPromptEnabled
              ? t('painting.tools.promptEditor.randomPreviewHelp')
              : t('painting.tools.promptEditor.commentHelp')}
          </Typography>
        )}

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
