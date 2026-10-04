import { useLayoutEffect, useRef, useState } from 'react';
import { Box, TextareaAutosize } from '@mui/material';
import { alpha } from '@mui/material/styles';
import EnhancedPreview from './EnhancedPreview';
import { PROMPT_TEXT_STYLE } from './previewTags.mjs';

const INLINE_TEXT_STYLE = { fontSize: '1rem', lineHeight: 1.65 };

/**
 * 为外部正向、负向输入框叠加提示词预览，保留原生输入和 5–8 行自动高度。
 * @param {object} props 文本、输入事件、原生输入引用、预览开关及随机词配置。
 * @returns {React.ReactElement} 可编辑的提示词输入框。
 */
export default function InlinePromptInput({ value, onChange, inputRef, inputProps, placeholder, previewEnabled, randomPromptConfig }) {
  const previewRef = useRef(null);
  const [isComposing, setIsComposing] = useState(false);

  useLayoutEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = inputRef.current.scrollTop;
  }, [value, previewEnabled, inputRef]);

  return (
    <Box sx={{
      position: 'relative', border: '1px solid', borderColor: 'divider', borderRadius: 1.5,
      overflow: 'hidden',
      '&:hover': { borderColor: 'text.secondary' },
      '&:focus-within': { borderColor: 'primary.main', boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` },
    }}>
      {previewEnabled && (
        <Box sx={{ position: 'absolute', inset: 0, visibility: isComposing ? 'hidden' : 'visible' }}>
          <EnhancedPreview text={value} randomPromptConfig={randomPromptConfig} scrollRef={previewRef} overlay textStyle={INLINE_TEXT_STYLE} />
        </Box>
      )}
      <Box
        component={TextareaAutosize}
        {...inputProps}
        ref={inputRef}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={placeholder}
        minRows={5}
        maxRows={8}
        spellCheck={false}
        onScroll={(event) => {
          if (previewRef.current) previewRef.current.scrollTop = event.currentTarget.scrollTop;
          inputProps.onScroll?.(event);
        }}
        onCompositionStart={(event) => { setIsComposing(true); inputProps.onCompositionStart(event); }}
        onCompositionEnd={(event) => { setIsComposing(false); inputProps.onCompositionEnd(event); }}
        onMouseMove={(event) => {
          if (!previewEnabled || isComposing) return;
          // 释义来自可见文字的位置，输入框始终接收点击、拖选和键盘事件。
          const hit = [...previewRef.current.querySelectorAll('[data-preview-translation]')].find((tag) => (
            [...tag.getClientRects()].some((rect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)
          ));
          event.currentTarget.title = hit?.dataset.previewTranslation || '';
        }}
        onMouseLeave={(event) => { event.currentTarget.title = ''; }}
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
    </Box>
  );
}
