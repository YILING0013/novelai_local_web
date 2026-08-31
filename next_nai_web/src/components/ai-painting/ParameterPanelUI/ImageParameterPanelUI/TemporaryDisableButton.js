"use client";

import React from 'react';
import { Button, IconButton, Tooltip } from '@mui/material';
import {
  RestartAlt as RestartAltIcon,
  VisibilityOffOutlined as VisibilityOffOutlinedIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const actionButtonSx = {
  minWidth: 96,
  height: 28,
  px: 1.25,
  borderRadius: 999,
  fontSize: '0.75rem',
  lineHeight: 1,
  flexShrink: 0,
  textTransform: 'none',
  boxShadow: 'none',
  '& .MuiButton-startIcon': {
    mr: 0.5,
  },
};

const iconButtonSx = {
  p: 0.5,
  color: 'inherit',
};

const TemporaryDisableButton = ({ isDisabled, onToggle, iconOnly = false, sx = {} }) => {
  const { t } = useI18n();
  const tooltip = isDisabled
    ? t('painting.workspace.parameters.reenableHelp')
    : t('painting.workspace.parameters.temporaryDisableHelp');

  const icon = isDisabled
    ? <RestartAltIcon sx={{ fontSize: 16 }} />
    : <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} />;

  const handleClick = (event) => {
    event.stopPropagation();
    onToggle?.();
  };

  return (
    <Tooltip title={tooltip}>
      {iconOnly ? (
        <IconButton
          size="small"
          onClick={handleClick}
          color={isDisabled ? 'warning' : 'default'}
          sx={{ ...iconButtonSx, ...sx }}
        >
          {icon}
        </IconButton>
      ) : (
        <Button
          size="small"
          variant={isDisabled ? 'contained' : 'outlined'}
          color={isDisabled ? 'warning' : 'inherit'}
          startIcon={icon}
          onClick={handleClick}
          sx={{ ...actionButtonSx, ...sx }}
        >
          {isDisabled
            ? t('painting.workspace.parameters.reenable')
            : t('painting.workspace.parameters.temporaryDisable')}
        </Button>
      )}
    </Tooltip>
  );
};

export default TemporaryDisableButton;
