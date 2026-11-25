'use client';

import { useRef, useState } from 'react';
import { Badge, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { AddPhotoAlternateOutlined, BarChart, ErrorOutline, MoreHoriz } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

/** 手机生成栏的工具入口。绘图页和教程从同一个菜单打开系统选图器，将所选文件交给各自的工作台。 */
export default function MobileGenerationTools({
  disabled,
  errorCount = 0,
  recoveryCount = 0,
  batchStatus,
  onBatch,
  onErrors,
  onImportFile,
  onOpen,
  inputId,
}) {
  const { t } = useI18n();
  const input = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const total = errorCount + recoveryCount;
  return (
    <>
      <Tooltip title={t('painting.workspace.actions.generationTools')}>
        <IconButton
          data-tour="openImportTools"
          aria-label={t('painting.workspace.actions.generationTools')}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          disabled={disabled}
          onClick={(event) => {
            setAnchor(event.currentTarget);
            onOpen?.();
          }}
          color={errorCount ? 'error' : recoveryCount ? 'warning' : 'default'}
          sx={{ width: 40, height: 44, flexShrink: 0 }}
        >
          <Badge badgeContent={total} color={errorCount ? 'error' : 'warning'} max={99}>
            <MoreHoriz />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          data-tour="chooseImportFile"
          onClick={() => {
            setAnchor(null);
            input.current.click();
          }}
        >
          <AddPhotoAlternateOutlined sx={{ mr: 1.5, fontSize: 20 }} />
          {t('painting.tools.metadata.selectImage')}
        </MenuItem>
        {batchStatus?.active && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              onBatch();
            }}
          >
            <BarChart sx={{ mr: 1.5, fontSize: 20 }} />
            {t('painting.workspace.actions.viewBatchDetails')}
            <Typography variant="caption" sx={{ ml: 2 }}>
              {batchStatus.current}/{batchStatus.total}
            </Typography>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onErrors();
          }}
        >
          <ErrorOutline sx={{ mr: 1.5, fontSize: 20 }} />
          {t('painting.workspace.actions.viewErrorDetails')}
          <Typography variant="caption" sx={{ ml: 2 }}>
            {total}
          </Typography>
        </MenuItem>
      </Menu>
      <input
        ref={input}
        id={inputId}
        data-mobile-import-file=""
        aria-label={t('painting.tools.metadata.selectImage')}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files[0];
          event.currentTarget.value = '';
          if (file) void onImportFile(file);
        }}
      />
    </>
  );
}
