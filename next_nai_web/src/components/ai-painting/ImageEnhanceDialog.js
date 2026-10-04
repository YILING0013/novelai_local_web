'use client';

import React, { useEffect, useId, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Collapse, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Slider, Stack, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import { AutoAwesome, Close, ExpandLess, ExpandMore } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import apiClient from '@/utils/ApiClient';
import { GENERATION_ERROR_MESSAGE_KEYS, normalizeGenerationErrorCode } from './Generation/errors';
import { isNovelAIV5Model } from './utils/novelAIV5Params.mjs';

const MAGNITUDE_PRESETS = [
  { strength: 0.2, noise: 0 },
  { strength: 0.4, noise: 0 },
  { strength: 0.5, noise: 0 },
  { strength: 0.6, noise: 0 },
  { strength: 0.7, noise: 0.1 },
];

/**
 * 配置当前图片的增强参数，并以服务端估价决定是否允许提交。
 * @param {object} props 源图尺寸、当前模型和步数，以及关闭和提交回调。
 * @returns {React.ReactElement} 使用工作区主题的增强对话框。
 */
export default function ImageEnhanceDialog({
  open, onClose, onSubmit, source, model, initialSteps = 28, disabled = false,
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [upscaleAmount, setUpscaleAmount] = useState(1);
  const [strength, setStrength] = useState(0.5);
  const [noise, setNoise] = useState(0);
  const [steps, setSteps] = useState(Math.min(50, Math.max(1, initialSteps)));
  const [advanced, setAdvanced] = useState(false);
  const [estimateState, setEstimateState] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setUpscaleAmount(1);
    setStrength(0.5);
    setNoise(0);
    setSteps(Math.min(50, Math.max(1, initialSteps)));
    setAdvanced(false);
    setEstimateState(null);
    setSubmitError(null);
  }, [open, source?.src, model, initialSteps]);

  const sourceReady = source?.width > 0 && source?.height > 0;
  const requestKey = JSON.stringify({
    image_tool: 'enhance', model,
    source_width: source?.width, source_height: source?.height,
    upscale_amount: upscaleAmount, strength, noise, steps,
  });

  useEffect(() => {
    if (!open || !sourceReady) return undefined;
    const controller = new AbortController();
    setEstimateState({ key: requestKey, status: 'loading' });
    // 连续拖动时只查询最后一组参数，过期请求也不能覆盖新点数。
    const timeout = setTimeout(async () => {
      try {
        const result = await apiClient.estimateImageTool(JSON.parse(requestKey), {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setEstimateState({ key: requestKey, status: 'ready', result });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setEstimateState({ key: requestKey, status: 'error', error });
        }
      }
    }, 200);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, requestKey, sourceReady, source?.src]);

  const currentEstimate = estimateState?.key === requestKey ? estimateState : null;
  const estimate = currentEstimate?.status === 'ready' ? currentEstimate.result : null;
  const estimating = sourceReady && (!currentEstimate || currentEstimate.status === 'loading');
  const error = submitError || currentEstimate?.error;
  const errorMessage = error
    ? t(GENERATION_ERROR_MESSAGE_KEYS[normalizeGenerationErrorCode(error)])
    : '';
  const magnitude = MAGNITUDE_PRESETS.findIndex((preset) => (
    preset.strength === strength && preset.noise === noise
  ));
  const controlsDisabled = disabled || submitting;
  const canSubmit = !controlsDisabled && Boolean(estimate) && estimate.affordable !== false;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        upscale_amount: upscaleAmount, strength, noise, steps,
        width: estimate.width, height: estimate.height, cost: estimate.cost,
      });
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={controlsDisabled ? undefined : onClose}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { borderRadius: 2.5, m: { xs: 1.5, sm: 4 }, width: '100%' } }}
    >
      <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <AutoAwesome color="primary" />
        <Box component="span" sx={{ flex: 1 }}>{t('painting.workspace.imageTools.title')}</Box>
        <IconButton onClick={onClose} disabled={controlsDisabled} aria-label={t('painting.workspace.actions.close')}>
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              {t('painting.workspace.imageTools.model', { model })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('painting.workspace.imageTools.promptHelp')}
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2.5, sm: 3 }}>
            <Box sx={{ flexShrink: 0 }}>
              <Typography id={`${titleId}-amount`} variant="subtitle2" gutterBottom>
                {t('painting.workspace.imageTools.upscaleAmount')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                value={upscaleAmount}
                disabled={controlsDisabled}
                aria-labelledby={`${titleId}-amount`}
                onChange={(_event, value) => { if (value !== null) setUpscaleAmount(value); }}
                size="small"
                sx={{ '& .MuiToggleButton-root': { px: 2, textTransform: 'none' } }}
              >
                <ToggleButton value={1}>1×</ToggleButton>
                <ToggleButton value={1.5}>1.5×</ToggleButton>
                {isNovelAIV5Model(model) && <ToggleButton value="max">Max ✨</ToggleButton>}
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography id={`${titleId}-magnitude`} variant="subtitle2" gutterBottom>
                {t('painting.workspace.imageTools.magnitude', {
                  value: magnitude < 0 ? t('painting.workspace.imageTools.custom') : magnitude,
                })}
              </Typography>
              <Slider
                aria-labelledby={`${titleId}-magnitude`}
                value={magnitude < 0 ? 2 : magnitude}
                min={0}
                max={4}
                step={1}
                marks
                valueLabelDisplay="auto"
                disabled={controlsDisabled}
                onChange={(_event, value) => {
                  setStrength(MAGNITUDE_PRESETS[value].strength);
                  setNoise(MAGNITUDE_PRESETS[value].noise);
                }}
              />
            </Box>
          </Stack>
          <Box>
            <Button
              onClick={() => setAdvanced((value) => !value)}
              startIcon={advanced ? <ExpandLess /> : <ExpandMore />}
              aria-expanded={advanced}
              aria-controls={`${titleId}-advanced`}
              sx={{ ml: -1 }}
            >
              {t(`painting.workspace.imageTools.${advanced ? 'hideAdvanced' : 'showAdvanced'}`)}
            </Button>
            <Collapse in={advanced} id={`${titleId}-advanced`}>
              <Stack spacing={1.5} sx={{ pt: 1.5 }}>
                {[
                  { name: 'strength', value: strength, setValue: setStrength, max: 1, min: 0, step: 0.01 },
                  { name: 'noise', value: noise, setValue: setNoise, max: 1, min: 0, step: 0.01 },
                  { name: 'steps', value: steps, setValue: setSteps, max: 50, min: 1, step: 1 },
                ].map((control) => (
                  <Box key={control.name}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography id={`${titleId}-${control.name}`} variant="body2">
                        {t(`painting.workspace.imageTools.${control.name}`)}
                      </Typography>
                      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {control.name === 'steps' ? control.value : control.value.toFixed(2)}
                      </Typography>
                    </Stack>
                    <Slider
                      aria-labelledby={`${titleId}-${control.name}`}
                      value={control.value}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      valueLabelDisplay="auto"
                      disabled={controlsDisabled}
                      onChange={(_event, value) => control.setValue(value)}
                    />
                  </Box>
                ))}
                <Typography variant="caption" color="text.secondary">
                  {t('painting.workspace.imageTools.strengthHelp')}
                </Typography>
              </Stack>
            </Collapse>
          </Box>
          <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }} aria-live="polite">
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={0.5}>
              <Typography variant="body2">{t('painting.workspace.imageTools.outputSize')}</Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {estimate ? `${source.width} × ${source.height} → ${estimate.width} × ${estimate.height}` : '—'}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{ mt: 1 }}>
              <Typography variant="body2">{t('painting.workspace.imageTools.estimatedCost')}</Typography>
              {estimating ? <CircularProgress size={16} aria-label={t('painting.workspace.imageTools.estimating')} /> : (
                <Typography variant="subtitle2">
                  {estimate ? t('painting.workspace.imageTools.cost', { cost: estimate.cost }) : '—'}
                </Typography>
              )}
            </Stack>
            {estimate && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {estimate.balance === null
                  ? t('painting.workspace.imageTools.balanceUnknown')
                  : t('painting.workspace.imageTools.balance', { credits: estimate.balance })}
              </Typography>
            )}
          </Box>
          {!sourceReady && <Alert severity="error">{t('painting.workspace.imageTools.sourceDimensionsUnavailable')}</Alert>}
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          {estimate?.affordable === false && (
            <Alert severity="warning">{t('painting.workspace.imageTools.insufficientBalance')}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={controlsDisabled}>{t('painting.workspace.actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!canSubmit}
          startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <AutoAwesome />}
          onClick={handleSubmit}
          sx={{ minWidth: 170 }}
        >
          {submitting
            ? t('painting.workspace.imageTools.processing')
            : estimate
              ? t('painting.workspace.imageTools.submitCost', { cost: estimate.cost })
              : t('painting.workspace.imageTools.enhance')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
