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
  isMobile,
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
      elevation={3}
      sx={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'column' : 'row', 
        p: 1.5,
        m: 1,
        borderRadius: 2,
        bgcolor: theme.palette.background.paper,
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        zIndex: 5,
      }}
    >
      {/* 第一组：主模式按钮 */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        gap: 1.5,
        width: isMobile ? '100%' : 'auto',
        mb: isMobile ? 1.5 : 0,
        mr: isMobile ? 0 : 3,
        borderRight: isMobile ? 'none' : `1px solid ${theme.palette.divider}`,
        pr: isMobile ? 0 : 3
      }}>
        <Tooltip title={t('painting.tools.imageEditor.toolbar.drawTooltip')} arrow placement="bottom">
          <Button
            variant={activeMainTool === 'draw' ? 'contained' : 'outlined'}
            onClick={() => onMainToolClick('draw')}
            startIcon={<BrushIcon />}
            size={isMobile ? "small" : "medium"}
            color="primary"
            sx={{
              borderRadius: 1.5,
              textTransform: 'none',
              px: 2,
              py: 1,
              fontWeight: 'bold'
            }}
          >
            {t('painting.tools.imageEditor.toolbar.draw')}
          </Button>
        </Tooltip>
      </Box>
      
      {/* 第二组：Radio按钮组（互斥，可取消选中） */}
      <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 0.75,
          width: isMobile ? '100%' : 'auto',
          borderTop: isMobile ? `1px solid ${theme.palette.divider}` : 'none',
          pt: isMobile ? 1.5 : 0
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
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    borderColor: theme.palette.divider,
                    '&.Mui-selected': {
                      backgroundColor: theme.palette.primary.main,
                      color: theme.palette.primary.contrastText,
                      '&:hover': {
                        backgroundColor: theme.palette.primary.dark,
                      }
                    }
                  }}
                >
                  {tool.icon}
                  <Typography variant="caption" sx={{ fontSize: isMobile ? '0.65rem' : '0.7rem' }}>
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
