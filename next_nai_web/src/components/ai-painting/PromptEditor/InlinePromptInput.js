import { useLayoutEffect, useRef, useState } from 'react';
import { Box, TextareaAutosize } from '@mui/material';
import { alpha } from '@mui/material/styles';
import EnhancedPreview from './EnhancedPreview';
import { PROMPT_TEXT_STYLE } from './previewTags.mjs';
import usePromptTranslationPreview, { PromptTranslationFeedback } from './usePromptTranslationPreview';
import usePromptEditorSettings from './usePromptEditorSettings';
import usePromptWeightShortcuts from './usePromptWeightShortcuts';

const INLINE_TEXT_STYLE = { fontSize: '1rem', lineHeight: 1.65 };

/**
 * 为外部正向、负向输入框叠加提示词预览，保留原生输入和 5–8 行自动高度。
 * @param {object} props 文本、输入事件、原生输入引用、预览开关及随机词配置。
 * @returns {React.ReactElement} 可编辑的提示词输入框。
 */
export default function InlinePromptInput({ value, onChange, inputRef, inputProps, placeholder, previewEnabled, randomPromptConfig, className }) {
  const previewRef = useRef(null);
  const [isComposing, setIsComposing] = useState(false);
  const translationPreview = usePromptTranslationPreview({ text: value, previewRef, overlay: previewEnabled && !isComposing, enabled: !isComposing });
  const { defaultWeightMode } = usePromptEditorSettings();
  const weightShortcuts = usePromptWeightShortcuts({
    inputRef, value, defaultWeightMode, enabled: !isComposing,
    onChange: (text, selection) => {
      const input = { value: text, selectionStart: selection.start, selectionEnd: selection.end };
      onChange({ target: input, currentTarget: input,
        nativeEvent: { type: 'change', inputType: 'formatSetBlockText', isComposing: false } });
    },
    onAdjust: translationPreview.close,
  });

  useLayoutEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = inputRef.current.scrollTop;
  }, [value, previewEnabled, inputRef]);

  return (
    <Box className={className} sx={{
      position: 'relative', border: '1px solid', borderColor: 'divider', borderRadius: 1.5,
      overflow: 'hidden',
      '&:hover': { borderColor: 'text.secondary' },
      '&:focus-within': { borderColor: 'primary.main', boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` },
    }}>
      {previewEnabled && (
        <Box sx={{ position: 'absolute', inset: 0, visibility: isComposing ? 'hidden' : 'visible' }}>
          <EnhancedPreview text={value} randomPromptConfig={randomPromptConfig} scrollRef={previewRef} overlay textStyle={INLINE_TEXT_STYLE}
            tags={translationPreview.tags} translations={translationPreview.translations} underline={translationPreview.underline}
            activeTag={translationPreview.active} />
        </Box>
      )}
      <Box
        component={TextareaAutosize}
        {...inputProps}
        {...translationPreview.inputProps}
        ref={inputRef}
        value={value}
        onChange={(event) => { translationPreview.inputProps.onChange(event); onChange(event); }}
        placeholder={placeholder}
        aria-label={placeholder}
        minRows={5}
        maxRows={8}
        spellCheck={false}
        onScroll={(event) => {
          if (previewRef.current) previewRef.current.scrollTop = event.currentTarget.scrollTop;
          inputProps.onScroll?.(event);
          translationPreview.close();
        }}
        onPointerDown={(event) => { inputProps.onPointerDown?.(event); translationPreview.inputProps.onPointerDown(event); }}
        onSelect={(event) => { inputProps.onSelect?.(event); translationPreview.inputProps.onSelect(event); }}
        onKeyDown={(event) => {
          if (weightShortcuts.onKeyDown(event)) return;
          inputProps.onKeyDown?.(event);
          translationPreview.inputProps.onKeyDown(event);
        }}
        onBlur={(event) => { inputProps.onBlur?.(event); translationPreview.close(); }}
        onCompositionStart={(event) => {
          setIsComposing(true);
          translationPreview.inputProps.onCompositionStart(event);
          inputProps.onCompositionStart(event);
        }}
        onCompositionEnd={(event) => { setIsComposing(false); inputProps.onCompositionEnd(event); }}
        sx={{
          ...PROMPT_TEXT_STYLE, ...INLINE_TEXT_STYLE,
          display: 'block', position: 'relative', height: 'auto', resize: 'none', outline: 'none',
          overscrollBehaviorY: 'contain',
          background: 'transparent', color: previewEnabled && !isComposing ? 'transparent' : 'text.primary',
          // caretColor 不解析 MUI 调色板别名；必须给实际颜色，避免跟随透明文字一起消失。
          caretColor: (theme) => theme.palette.text.primary,
          '&::placeholder': { color: 'text.secondary', opacity: 1 },
          '&::selection': {
            // 叠加时只标记选区，由预览唯一绘字，避免浏览器半透明选区把两层文字一起显示。
            backgroundColor: (theme) => previewEnabled && !isComposing ? alpha(theme.palette.primary.main, 0.32) : theme.palette.primary.main,
            color: (theme) => previewEnabled && !isComposing ? 'transparent' : theme.palette.primary.contrastText,
          },
        }}
      />
      <PromptTranslationFeedback preview={translationPreview} />
    </Box>
  );
}
