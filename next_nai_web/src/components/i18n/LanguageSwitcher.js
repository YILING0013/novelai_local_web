"use client";

import React, { useState } from 'react';
import {
  Box,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Tooltip,
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import { useI18n } from '@/i18n/I18nProvider';

const LANGUAGE_OPTIONS = Object.freeze([
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '中文' },
]);

/**
 * 渲染全站统一语言切换控件。
 *
 * Args:
 *   compact: 是否使用适合折叠侧栏的图标菜单。
 *   fullWidth: 下拉选择器是否占满父容器宽度。
 *   showLabel: 是否显示“语言”浮动标签。
 *   disabled: 是否暂时禁止切换语言。
 *   sx: 传给控件容器的 MUI 样式。
 *
 * Returns:
 *   React.ReactElement: 中文与 English 切换控件。
 */
export function LanguageSwitcher({
  compact = false,
  fullWidth = false,
  showLabel = false,
  disabled = false,
  sx = {},
}) {
  const { locale, setLocale, t, ready } = useI18n();
  const [anchorEl, setAnchorEl] = useState(null);

  if (compact) {
    return (
      <Box sx={sx}>
        <Tooltip title={t('common.language')} placement="right" arrow>
          <span>
            <IconButton
              aria-label={t('login.languageAria')}
              onClick={(event) => setAnchorEl(event.currentTarget)}
              disabled={!ready || disabled}
              color="primary"
            >
              <LanguageIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          {LANGUAGE_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              selected={locale === option.value}
              onClick={() => {
                setLocale(option.value);
                setAnchorEl(null);
              }}
            >
              {option.label}
            </MenuItem>
          ))}
        </Menu>
      </Box>
    );
  }

  const labelId = showLabel ? 'novelai-local-language-switcher-label' : undefined;
  return (
    <FormControl size="small" fullWidth={fullWidth} sx={{ minWidth: 132, ...sx }}>
      {showLabel && <InputLabel id={labelId}>{t('common.language')}</InputLabel>}
      <Select
        labelId={labelId}
        value={locale}
        label={showLabel ? t('common.language') : undefined}
        onChange={(event) => setLocale(event.target.value)}
        disabled={!ready || disabled}
        inputProps={{ 'aria-label': t('login.languageAria') }}
        startAdornment={<LanguageIcon sx={{ mr: 1, fontSize: 19 }} />}
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default LanguageSwitcher;
