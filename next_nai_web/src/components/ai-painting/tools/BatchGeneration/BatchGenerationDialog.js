// BatchGenerationDialog.js
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  LinearProgress,
  CircularProgress, // 已包含在这里
  Alert,
  Divider,
  Paper,
} from '@mui/material';
import {
  CancelOutlined as CancelIcon,
  AccessTime as TimeIcon,
  CheckCircleOutline as CheckCircleIcon,
  ErrorOutline as ErrorIcon,
} from '@mui/icons-material';
import { useGeneration } from '../../Generation/GenerationContext';
import { GENERATION_ERROR_MESSAGE_KEYS } from '../../Generation/errors';
import { useI18n } from '@/i18n/I18nProvider';

const BATCH_CATEGORY_KEYS = Object.freeze({
  parameter: 'painting.tools.batch.errors.categories.parameter',
  rate_limit: 'painting.tools.batch.errors.categories.rate_limit',
  network: 'painting.tools.batch.errors.categories.network',
  timeout: 'painting.tools.batch.errors.categories.timeout',
  unknown: 'painting.tools.batch.errors.categories.unknown',
});

const BatchGenerationDialog = ({ 
  open, 
  onClose, 
  onCancel,
  embedded = false // 新增参数，表示是否作为嵌入式组件使用，不显示对话框框架
}) => {
  const { t, formatDate } = useI18n();
  const { 
    batchStatus, 
    isGenerating, 
    generationStatus,
  } = useGeneration();

  // 格式化时间显示
  const formatTime = (seconds) => {
    if (seconds <= 0) return t('painting.tools.batch.startingSoon');
    return t('painting.tools.batch.seconds', { seconds });
  };

  const getErrorMessage = (error) => {
    const explicitKey = GENERATION_ERROR_MESSAGE_KEYS[error.code];
    if (explicitKey) return t(explicitKey);
    return t(BATCH_CATEGORY_KEYS[error.category] || BATCH_CATEGORY_KEYS.unknown);
  };

  // 防止在生成过程中关闭对话框
  const handleClose = (event, reason) => {
    if ((reason === 'backdropClick' || reason === 'escapeKeyDown') && batchStatus.active) {
      return;
    }
    onClose();
  };

  // 如果为嵌入式模式，直接渲染内容而不使用Dialog
  const renderContent = () => (
    <>
      {/* 进度指示器 */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" fontWeight="medium">
            {t('painting.tools.batch.overallProgress')}
          </Typography>
          <Typography variant="body2" color="primary">
            {Math.round((batchStatus.current - 1 + (isGenerating ? 0.5 : 0)) / Math.max(1, batchStatus.total) * 100)}%
          </Typography>
        </Box>
        <LinearProgress 
          variant="determinate" 
          value={(batchStatus.current - 1 + (isGenerating ? 0.5 : 0)) / Math.max(1, batchStatus.total) * 100} 
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Box>

      {/* 状态摘要 */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>{t('painting.tools.batch.completed')}</Typography>
            <Typography variant="h6" color="success.main" sx={{ display: 'flex', alignItems: 'center' }}>
              <CheckCircleIcon fontSize="small" sx={{ mr: 0.5 }} />
              {batchStatus.completed}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>{t('painting.tools.batch.failed')}</Typography>
            <Typography variant="h6" color="error.main" sx={{ display: 'flex', alignItems: 'center' }}>
              <ErrorIcon fontSize="small" sx={{ mr: 0.5 }} />
              {batchStatus.failed}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>{t('painting.tools.batch.remaining')}</Typography>
            <Typography variant="h6" color="text.primary">
              {Math.max(0, batchStatus.total - batchStatus.current + 1)}
            </Typography>
          </Box>
          {batchStatus.waitingTime > 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>{t('painting.tools.batch.waitTime')}</Typography>
              <Typography variant="h6" color="primary" sx={{ display: 'flex', alignItems: 'center' }}>
                <TimeIcon fontSize="small" sx={{ mr: 0.5 }} />
                {formatTime(batchStatus.waitingTime)}
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {/* 当前状态信息 */}
      {isGenerating && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('painting.tools.batch.generatingImage', {
            current: batchStatus.current,
            status: t(`painting.tools.batch.status.${generationStatus.status}`),
          })}
          {generationStatus.queuePosition && generationStatus.status === 'queued' && (
            <span> — {t('painting.tools.batch.queuePosition', { position: generationStatus.queuePosition })}</span>
          )}
          {generationStatus.progress > 0 && (
            <LinearProgress 
              variant="determinate" 
              value={generationStatus.progress} 
              sx={{ mt: 1, borderRadius: 4, height: 4 }}
            />
          )}
        </Alert>
      )}

      {/* 等待信息 */}
      {!isGenerating && batchStatus.active && batchStatus.waitingTime > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('painting.tools.batch.waitBeforeNext', { time: formatTime(batchStatus.waitingTime) })}</span>
            <CircularProgress size={16} thickness={6} />
          </Box>
        </Alert>
      )}

      {/* 错误记录 - 简化版本，只显示最近的几条错误 */}
      {batchStatus.errors.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('painting.tools.batch.recentErrors', { count: batchStatus.errors.length })}
            </Typography>
          </Divider>
          <Paper 
            variant="outlined" 
            sx={{ 
              p: 1.5, 
              maxHeight: 120, // 减小高度
              overflowY: 'auto', 
              borderRadius: 2,
              bgcolor: 'rgba(244, 67, 54, 0.03)',
              border: '1px solid rgba(244, 67, 54, 0.15)'
            }}
          >
            {/* 只显示最近3条错误 */}
            {batchStatus.errors.slice(-3).map((error, index) => (
              <Box key={index} sx={{ 
                py: 0.5, 
                borderBottom: index < Math.min(batchStatus.errors.length, 3) - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                display: 'flex',
                alignItems: 'flex-start'
              }}>
                <ErrorIcon fontSize="small" sx={{ color: 'error.main', mr: 1, mt: 0.3, opacity: 0.7, fontSize: '0.9rem' }} />
                <Box>
                  <Typography variant="caption" color="error" display="block" sx={{ fontWeight: 500 }}>
                    {getErrorMessage(error)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    {formatDate(error.timestamp, { timeStyle: 'medium' })}
                    {index === 0 && batchStatus.active && ` (${t('painting.tools.batch.latest')})`}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* 操作按钮区域 */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        mt: 3,
        gap: 2
      }}>
        {batchStatus.active && (
          <Button 
            onClick={onCancel} 
            startIcon={<CancelIcon />}
            color="error"
            variant="outlined"
            fullWidth
          >
            {t('painting.tools.batch.cancelGeneration')}
          </Button>
        )}
        
        {!batchStatus.active && (
          <Button 
            onClick={onClose} 
            color="primary"
            variant="contained"
            fullWidth
          >
            {t('painting.tools.common.close')}
          </Button>
        )}
      </Box>
    </>
  );

  // 如果是嵌入式模式，直接返回内容
  if (embedded) {
    return renderContent();
  }

  // 标准模式使用Dialog包装
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown={batchStatus.active}
      PaperProps={{
        sx: {
          borderRadius: 2,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        }
      }}
    >
      <DialogTitle sx={{ 
        pb: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        bgcolor: 'rgba(124, 77, 255, 0.05)',
        borderBottom: '1px solid rgba(124, 77, 255, 0.1)',
      }}>
        <Typography variant="h6" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
          {t('painting.tools.batch.title')}
          {batchStatus.active && <CircularProgress size={20} sx={{ ml: 2 }} />}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {batchStatus.current}/{batchStatus.total}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 3, pb: 2 }}>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
};

export default BatchGenerationDialog;
