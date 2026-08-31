import React from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Tooltip, Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  ErrorOutline as ErrorIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { GENERATION_ERROR_MESSAGE_KEYS } from '../../Generation/errors';

const BATCH_CATEGORY_KEYS = Object.freeze({
  parameter: 'painting.tools.batch.errors.categories.parameter',
  rate_limit: 'painting.tools.batch.errors.categories.rate_limit',
  network: 'painting.tools.batch.errors.categories.network',
  timeout: 'painting.tools.batch.errors.categories.timeout',
  unknown: 'painting.tools.batch.errors.categories.unknown',
});

const ErrorSummaryDialog = ({ open, onClose, onClear, errors = [] }) => {
  const { t, formatDate } = useI18n();

  const getErrorMessage = React.useCallback((error) => {
    if (error.messageKey) return t(error.messageKey);
    const explicitKey = GENERATION_ERROR_MESSAGE_KEYS[error.code];
    if (explicitKey) return t(explicitKey);
    return t(BATCH_CATEGORY_KEYS[error.category] || BATCH_CATEGORY_KEYS.unknown);
  }, [t]);

  const getErrorText = React.useCallback((error) => {
    const details = [
      `[${formatDate(error.occurredAt || error.timestamp, { dateStyle: 'medium', timeStyle: 'medium' })}] ${getErrorMessage(error)}`,
      `${t('painting.workspace.errorRecords.code')}: ${error.code}`,
      `${t('painting.workspace.errorRecords.source')}: ${error.source || 'workspace'}`,
    ];
    if (error.errorId) details.push(`${t('painting.workspace.errorRecords.errorId')}: ${error.errorId}`);
    if (error.statusCode) details.push(`${t('painting.workspace.errorRecords.statusCode')}: ${error.statusCode}`);
    return details.join(' · ');
  }, [formatDate, getErrorMessage, t]);

  const copyText = async (value) => {
    await navigator.clipboard.writeText(value);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'rgba(244, 67, 54, 0.05)' }}>
        <Typography component="span" variant="h6" color="error.main" sx={{ display: 'flex', alignItems: 'center' }}>
          <ErrorIcon sx={{ mr: 1 }} />
          {t('painting.workspace.errorRecords.title', { count: errors.length })}
        </Typography>
        <IconButton aria-label={t('painting.workspace.actions.close')} onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ py: 3 }}>
        {errors.length === 0 ? (
          <Typography align="center" color="text.secondary" sx={{ py: 3 }}>
            {t('painting.workspace.errorRecords.noRecords')}
          </Typography>
        ) : (
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            {errors.map((error, index) => (
              <Box key={`${error.occurredAt || error.timestamp}-${index}`} sx={{ p: 2, borderBottom: index < errors.length - 1 ? '1px solid' : 0, borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography color="error.main" sx={{ fontWeight: 500 }}>{getErrorMessage(error)}</Typography>
                  <Tooltip title={t('painting.workspace.errorRecords.copyOne')}>
                    <IconButton size="small" onClick={() => copyText(getErrorText(error))}><CopyIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                  {getErrorText(error)}
                </Typography>
              </Box>
            ))}
          </Paper>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="error" disabled={!errors.length} onClick={onClear}>{t('painting.workspace.errorRecords.clear')}</Button>
        <Button startIcon={<CopyIcon />} disabled={!errors.length} onClick={() => copyText(errors.map(getErrorText).join('\n'))}>
          {t('painting.workspace.errorRecords.copyAll')}
        </Button>
        <Button variant="contained" onClick={onClose}>{t('painting.workspace.actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ErrorSummaryDialog;
