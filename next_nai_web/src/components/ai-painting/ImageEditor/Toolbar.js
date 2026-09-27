// ImageEditor/Toolbar.js
import React from 'react';
import {
  Box,
  Button,
  Tooltip,
  ToggleButton,
  Typography,
  Paper
} from '@mui/material';
import {
  Brush as BrushIcon,
  FormatColorFill as ColorFillIcon,
  FilterTiltShift as FilterIcon,
  Transform as TransformIcon,
  Mood as MoodIcon
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const Toolbar = ({ 
  activeMainTool, 
  onMainToolClick, 
  activeRadioTool, 
  onRadioToolClick, 
  theme,
}) => {
  const { t } = useI18n();
  const radioTools = [
    { value: 'lineart', labelKey: 'lineart', icon: <TransformIcon fontSize="small" /> },
    { value: 'sketch', labelKey: 'sketch', icon: <FilterIcon fontSize="small" /> },
    { value: 'declutter', labelKey: 'declutter', icon: <FilterIcon fontSize="small" /> },
    { value: 'emotion', labelKey: 'emotion', icon: <MoodIcon fontSize="small" /> },
    { value: 'colorize', labelKey: 'colorize', icon: <ColorFillIcon fontSize="small" /> }
  ];

  return (
    <Paper
      elevation={0}
      sx={{
        display: 'flex',
        p: 1.5,
        px: { xs: 2, sm: 3 },
        borderRadius: 0,
        borderBottom: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.background.paper,
        overflowX: 'auto',
        flexShrink: 0,
        alignItems: 'center',
        gap: 1.5,
        position: 'relative',
        zIndex: 5,
      }}
    >
      {/* 第一组：主模式按钮 */}
      <Box sx={{ 
        display: 'flex', 
        flexShrink: 0,
        borderRight: `1px solid ${theme.palette.divider}`,
        pr: 1.5
      }}>
        <Tooltip title={t('painting.tools.imageEditor.toolbar.drawTooltip')} arrow placement="bottom">
          <Button
            variant="text"
            aria-pressed={activeMainTool === 'draw'}
            onClick={() => onMainToolClick('draw')}
            startIcon={<BrushIcon />}
            sx={{
              borderRadius: 1,
              textTransform: 'none',
              px: 1.5,
              minHeight: 40,
              fontSize: 14,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              color: 'text.primary',
              bgcolor: activeMainTool === 'draw' ? 'action.selected' : 'transparent'
            }}
          >
            {t('painting.tools.imageEditor.toolbar.draw')}
          </Button>
        </Tooltip>
      </Box>
      
      {/* 第二组：Radio按钮组（互斥，可取消选中） */}
      <Box sx={{
          display: 'flex',
          flexShrink: 0,
          gap: 0.75,
        }}>
          {radioTools.map((tool) => {
            return (
              <Tooltip key={tool.value} title={t(`painting.tools.imageEditor.toolbar.${tool.labelKey}Tooltip`)} arrow placement="bottom">
                <ToggleButton
                  value={tool.value}
                  selected={activeRadioTool === tool.value}
                  onChange={() => onRadioToolClick(tool.value)}
                  size="small"
                  sx={{ 
                    borderRadius: 1,
                    px: 1.5,
                    minHeight: 40,
                    display: 'flex',
                    gap: 0.75,
                    whiteSpace: 'nowrap',
                    border: 0,
                    textTransform: 'none',
                    color: 'text.secondary',
                    '&.Mui-selected': {
                      backgroundColor: 'action.selected',
                      color: 'text.primary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      }
                    }
                  }}
                >
                  {tool.icon}
                  <Typography component="span" sx={{ fontSize: 14, fontWeight: 500 }}>
                    {t(`painting.tools.imageEditor.toolbar.${tool.labelKey}`)}
                  </Typography>
                </ToggleButton>
              </Tooltip>
            );
          })}
      </Box>
    </Paper>
  );
};

export default Toolbar;
