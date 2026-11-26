"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  Popover,
  Slider,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  InfoOutlined as InfoIcon,
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const stepDecimals = (step) => {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
};

/**
 * 滑块与右侧紧凑数值框。数值框可直接输入、用上下方向键或鼠标滚轮按步长调整（Shift 为十倍步长）；
 * 手机端滑块需先轻点解锁，避免滚动参数区时误触。
 * @param {object} props label、value、min、max、step、onChange 为必填；inline 让标签与滑块同一行；
 *   disabled 同时禁用滑块和数值框；valueLabelFormat 只改变数值框未聚焦时的显示文字；
 *   lockable=false 用于用户主动打开的浮层，手机上无需再解锁。
 * @returns {React.ReactElement} 带标签的滑块行。
 */
const LockableSlider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  tooltip,
  marks = false,
  valueLabelFormat = null,
  disabled = false,
  inline = false,
  lockable = true,
  sx,
}) => {
  const theme = useTheme();
  const { t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [isLocked, setIsLocked] = useState(true);
  const [labelAnchor, setLabelAnchor] = useState(null);
  const [draft, setDraft] = useState(null);
  const timeoutRef = useRef(null);
  const inputRef = useRef(null);
  const latestRef = useRef(null);
  // Enter/Esc 会立即让输入框失焦，失焦回调读取的必须是最新草稿，不能是上一轮渲染的值。
  const draftRef = useRef(null);
  const showLock = lockable && isMobile;
  const locked = showLock && isLocked;
  const decimals = stepDecimals(step);
  const numericValue = Number(value);
  const hasValue = value !== '' && value !== null && value !== undefined && Number.isFinite(numericValue);
  const display = hasValue ? (valueLabelFormat ? String(valueLabelFormat(value)) : numericValue.toFixed(decimals)) : '';
  // 数值框宽度只由上限决定，拖动时不会忽宽忽窄。
  const inputChars = Math.max(2, String(Math.trunc(Math.abs(max))).length + (decimals ? decimals + 1 : 0) + (min < 0 ? 1 : 0));

  const clampValue = (next) => {
    const snapped = Math.round((next - min) / step) * step + min;
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
  };
  latestRef.current = { value: numericValue, clampValue, onChange, step, disabled };

  const resetLockTimer = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsLocked(true), 3000);
  };

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  // 滚轮只在数值框上生效，滚动整个参数区时不会改到滑块。
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return undefined;
    const handleWheel = (event) => {
      const current = latestRef.current;
      if (current.disabled || !Number.isFinite(current.value)) return;
      const delta = event.deltaY || event.deltaX;
      if (!delta) return;
      event.preventDefault();
      const next = current.clampValue(current.value + (delta < 0 ? 1 : -1) * current.step * (event.shiftKey ? 10 : 1));
      if (next === current.value) return;
      // 快速连续滚动时父组件可能还没重渲染，先记下新值，下一格在此基础上累加。
      current.value = next;
      current.onChange(next);
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, []);

  const updateDraft = (next) => {
    draftRef.current = next;
    setDraft(next);
  };

  const commitDraft = () => {
    const text = draftRef.current;
    if (text === null) return;
    updateDraft(null);
    const parsed = Number(text);
    if (text.trim() === '' || !Number.isFinite(parsed)) return;
    const next = clampValue(parsed);
    if (next !== numericValue) onChange(next);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      updateDraft(null);
      event.currentTarget.blur();
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && hasValue) {
      event.preventDefault();
      updateDraft(null);
      const next = clampValue(numericValue + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
      if (next !== numericValue) onChange(next);
    }
  };

  const labelText = (
    <Typography component="span" noWrap sx={{ minWidth: 0, fontSize: '0.8125rem', lineHeight: 1.5, color: 'text.secondary', textAlign: 'left' }}>
      {label}
    </Typography>
  );

  return (
    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: inline ? 'row' : 'column', alignItems: inline ? 'center' : 'stretch', gap: inline ? 1 : 0, ...sx }}>
      {tooltip ? (
        <ButtonBase
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={Boolean(labelAnchor)}
          onClick={(event) => setLabelAnchor(event.currentTarget)}
          sx={{ alignSelf: inline ? 'center' : 'flex-start', maxWidth: '100%', minWidth: 0, flexShrink: inline ? 0 : 1, gap: 0.5, borderRadius: 0.5, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
        >
          {labelText}
          <InfoIcon sx={{ flexShrink: 0, fontSize: 14, opacity: 0.7 }} />
        </ButtonBase>
      ) : (
        <Box sx={{ display: 'flex', minWidth: 0, flexShrink: inline ? 0 : 1 }}>{labelText}</Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: inline ? '1 1 auto' : 'none' }}>
        <Box
          onClick={() => {
            if (!locked || disabled) return;
            setIsLocked(false);
            resetLockTimer();
          }}
          sx={{
            flex: 1,
            minWidth: 56,
            // 为圆点留出半径空间，避免两端被裁切。
            px: '7px',
            opacity: locked && !disabled ? 0.55 : 1,
            cursor: locked ? 'pointer' : 'auto',
            transition: theme.transitions.create('opacity', { duration: theme.transitions.duration.shorter }),
          }}
        >
          <Slider
            size="small"
            value={hasValue ? numericValue : min}
            min={min}
            max={max}
            step={step}
            marks={marks}
            disabled={disabled || locked}
            valueLabelDisplay="off"
            aria-label={label}
            onChange={(_, nextValue) => {
              if (locked) return;
              updateDraft(null);
              onChange(nextValue);
              if (showLock) resetLockTimer();
            }}
            sx={{ display: 'block' }}
          />
        </Box>
        <InputBase
          ref={inputRef}
          value={draft ?? display}
          disabled={disabled}
          onFocus={(event) => {
            updateDraft(hasValue ? String(numericValue) : '');
            event.target.select();
          }}
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={handleInputKeyDown}
          inputProps={{ inputMode: decimals ? 'decimal' : 'numeric', 'aria-label': label, spellCheck: false }}
          sx={{
            flexShrink: 0,
            width: `calc(${inputChars}ch + 14px)`,
            height: 24,
            borderRadius: 1,
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
            bgcolor: 'background.input',
            cursor: 'ns-resize',
            transition: theme.transitions.create(['background-color', 'box-shadow'], { duration: theme.transitions.duration.shorter }),
            '&:hover': { boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.24)}` },
            '&.Mui-focused': { boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}` },
            // 加倍选择器权重，避免外层工作区对输入框统一设置的内边距撑高数值框。
            '&& .MuiInputBase-input': { p: 0, height: '100%', textAlign: 'center', cursor: 'inherit' },
            '&&.Mui-focused .MuiInputBase-input': { cursor: 'text' },
          }}
        />
        {showLock && (
          <IconButton
            aria-label={t(isLocked ? 'painting.tools.lockableSlider.unlock' : 'painting.tools.lockableSlider.lock')}
            title={t(isLocked ? 'painting.tools.lockableSlider.tapToUnlock' : 'painting.tools.lockableSlider.lock')}
            size="small"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (isLocked) resetLockTimer();
              else clearTimeout(timeoutRef.current);
              setIsLocked(!isLocked);
            }}
            sx={{ p: 0.25, color: isLocked ? 'text.secondary' : 'primary.main' }}
          >
            {isLocked ? <LockIcon sx={{ fontSize: 16 }} /> : <LockOpenIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        )}
      </Box>

      {tooltip && (
        <Popover
          open={Boolean(labelAnchor)}
          anchorEl={labelAnchor}
          onClose={() => setLabelAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{ paper: { sx: { p: 1.5, width: 280, maxWidth: 'calc(100vw - 32px)' } } }}
        >
          <Box role="dialog" aria-label={label}>
            <Typography variant="body2" fontWeight="medium" sx={{ overflowWrap: 'anywhere' }}>{label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, overflowWrap: 'anywhere' }}>{tooltip}</Typography>
          </Box>
        </Popover>
      )}
    </Box>
  );
};

export default LockableSlider;
