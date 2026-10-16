"use client";

import React, { useCallback, useId, useRef, useState } from 'react';
import {
  Box, ButtonBase, FormControl, IconButton, InputAdornment, InputLabel,
  MenuItem, MenuList, Popover, Select, Slider, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  ArrowRight as ArrowRightIcon, Check as CheckIcon, Close as CloseIcon,
  InfoOutlined as InfoIcon, Refresh as RefreshIcon, Shuffle as ShuffleIcon,
} from '@mui/icons-material';
import LockableSlider from '@/components/muiWrappers/LockableSlider';
import ExtraConfiguration from './ExtraConfiguration';
import { useI18n } from '@/i18n/I18nProvider';

const samplerOptions = [
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim_v3', label: 'DDIM' },
];

const noiseScheduleOptions = [
  { value: 'native', label: 'noiseNative' },
  { value: 'karras', label: 'noiseKarras' },
  { value: 'exponential', label: 'noiseExponential' },
  { value: 'polyexponential', label: 'noisePolyexponential' },
];

/**
 * 显示生成按钮上方的参数摘要，在对应项上方编辑同一份生成参数。
 * @param {object} props 当前参数、模型限制和现有参数修改回调。
 * @returns {React.ReactElement} 参数条及其编辑浮层。
 */
export default function GenerationParameterBar({ params, maxSteps, isV5Medium, handleParamChange, handleSeedChange, handleClearSeed, handleSmeaChange, handleDynChange, handleResetParamsConfirm }) {
  const { t } = useI18n();
  const id = useId();
  const [editor, setEditor] = useState(null);
  const popoverAction = useRef(null);
  const contentObserver = useRef(null);
  const observeContent = useCallback(node => {
    contentObserver.current?.disconnect();
    if (node) {
      // 额外配置展开时持续调整浮层位置，使内容增长后仍在参数条上方。
      contentObserver.current = new ResizeObserver(() => popoverAction.current?.updatePosition());
      contentObserver.current.observe(node);
    }
  }, []);
  const editorOpen = Boolean(editor?.open);
  // 关闭时保留内容完成淡出，避免浮层先变空再消失。
  const closeEditor = () => setEditor(previous => ({ ...previous, open: false }));
  const randomSeed = params.seed === '';
  const samplerLabel = samplerOptions.find(option => option.value === params.sampler)?.label;
  const items = [
    { key: 'steps', label: t('painting.workspace.parameters.stepsShort'), title: t('painting.workspace.parameters.samplingSteps'), value: params.steps },
    { key: 'guidanceScale', label: t('painting.workspace.parameters.guidanceShort'), title: t('painting.workspace.parameters.cfgScale'), value: params.guidanceScale.toFixed(1) },
    { key: 'seed', label: t('painting.workspace.parameters.seed'), title: t('painting.workspace.parameters.seed'), value: randomSeed ? t('painting.workspace.parameters.randomSeed') : params.seed },
    { key: 'sampler', label: t('painting.workspace.parameters.sampler'), title: t('painting.workspace.parameters.sampler'), value: samplerLabel },
  ];
  const activeItem = items.find(item => item.key === editor?.key);
  const title = activeItem?.title || t('painting.workspace.parameters.otherSettings');
  const sliderField = editor?.key === 'steps' ? {
    key: 'steps', min: 1, max: maxSteps, step: 1,
    help: isV5Medium ? 'modelV5MediumSettings' : 'samplingStepsHelp',
    readOnly: isV5Medium,
  } : editor?.key === 'guidanceScale' ? {
    key: 'guidanceScale', min: 1, max: 20, step: 0.1,
    help: 'cfgScaleCreativityHelp', readOnly: false,
  } : null;

  return (
    <>
      <Box component="section" aria-label={t('painting.workspace.parameters.quickGenerationSettings')} sx={{
        display: 'grid', gridTemplateColumns: '48px 70px minmax(44px, 1fr) minmax(0, 1.5fr) 24px',
        alignItems: 'stretch', p: 0.5, mb: 1, minWidth: 0,
        border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'action.hover',
      }}>
        {items.map(item => (
          <Tooltip key={item.key} title={`${item.title}: ${item.value}`} arrow>
            <ButtonBase
              onClick={event => setEditor({ key: item.key, anchor: event.currentTarget, open: true })}
              aria-label={`${item.title}: ${item.value}`}
              aria-haspopup="dialog"
              aria-expanded={editorOpen && editor?.key === item.key}
              aria-controls={editorOpen && editor?.key === item.key ? `${id}-editor` : undefined}
              sx={{
                minWidth: 0, px: 0.75, py: 1, borderRadius: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5,
                bgcolor: editorOpen && editor?.key === item.key ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
              }}
            >
              <Typography component="span" noWrap sx={{ width: '100%', fontSize: '0.75rem', color: 'text.secondary', textAlign: 'left' }}>{item.label}</Typography>
              <Typography component="span" noWrap sx={{ width: '100%', minHeight: 20, fontSize: item.key === 'seed' ? '0.75rem' : '0.8125rem', lineHeight: '20px', fontWeight: 600, textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>
                {item.key === 'seed' && randomSeed ? <ShuffleIcon sx={{ fontSize: 18, verticalAlign: 'middle', color: 'text.secondary' }} /> : item.value}
              </Typography>
            </ButtonBase>
          </Tooltip>
        ))}
        <Tooltip title={t('painting.workspace.parameters.otherSettings')} arrow>
          <IconButton
            aria-label={t('painting.workspace.parameters.otherSettings')}
            aria-haspopup="dialog"
            aria-expanded={editorOpen && editor?.key === 'other'}
            aria-controls={editorOpen && editor?.key === 'other' ? `${id}-editor` : undefined}
            onClick={event => setEditor({ key: 'other', anchor: event.currentTarget, open: true })}
            sx={{ borderRadius: 1, px: 0, alignSelf: 'stretch', color: 'text.primary' }}
          >
            <ArrowRightIcon sx={{ transform: editorOpen && editor?.key === 'other' ? 'rotate(-90deg)' : 'none', transition: 'transform 150ms' }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Popover
        action={popoverAction}
        open={editorOpen}
        anchorEl={editor?.anchor}
        onClose={closeEditor}
        anchorOrigin={{ vertical: -8, horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        marginThreshold={8}
        slotProps={{ backdrop: { sx: { backgroundColor: 'transparent' } }, paper: {
          id: `${id}-editor`, role: 'dialog', 'aria-labelledby': `${id}-title`,
          sx: { width: 320, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 176px)', p: 0, border: 1, borderColor: 'divider', borderRadius: 1.5, backgroundImage: 'none' },
        } }}
      >
        <Box sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography id={`${id}-title`} sx={{ fontSize: '0.9375rem', fontWeight: 600 }}>{title}</Typography>
          <IconButton size="small" onClick={closeEditor} aria-label={t('painting.workspace.actions.close')}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        <Box ref={observeContent} sx={{ p: 2 }}>
        {sliderField && (
          <>
            <TextField
              autoFocus fullWidth size="small" type="number" label={title}
              value={params[sliderField.key]}
              onChange={event => {
                if (event.target.value === '') return;
                const value = Number(Number(event.target.value).toFixed(sliderField.key === 'steps' ? 0 : 1));
                handleParamChange(sliderField.key, Math.min(sliderField.max, Math.max(sliderField.min, value)));
              }}
              slotProps={{
                htmlInput: { min: sliderField.min, max: sliderField.max, step: sliderField.step },
                input: { readOnly: sliderField.readOnly, endAdornment: <InputAdornment position="end"><Tooltip title={t(`painting.workspace.parameters.${sliderField.help}`)} arrow><InfoIcon sx={{ fontSize: 18 }} /></Tooltip></InputAdornment> },
              }}
            />
            {/* 主动打开浮层后直接编辑，避免手机上还要额外解锁滑块。 */}
            <Box sx={{ mx: 1, mt: 1 }}>
              <Slider
                aria-label={title} value={params[sliderField.key]} min={sliderField.min} max={sliderField.max} step={sliderField.step}
                disabled={sliderField.readOnly} valueLabelDisplay="auto"
                onChange={(_, value) => handleParamChange(sliderField.key, Number(value.toFixed(sliderField.key === 'steps' ? 0 : 1)))}
              />
            </Box>
          </>
        )}
        {editor?.key === 'seed' && (
          <TextField
            autoFocus fullWidth size="small" label={t('painting.workspace.parameters.seed')}
            value={params.seed} placeholder={t('painting.workspace.parameters.randomSeed')}
            onChange={event => handleSeedChange(event.target.value)}
            slotProps={{ htmlInput: { inputMode: 'numeric' }, input: {
              endAdornment: <InputAdornment position="end">
                <Tooltip title={t('painting.workspace.parameters.clearSeed')} arrow><span><IconButton size="small" aria-label={t('painting.workspace.parameters.clearSeed')} disabled={randomSeed} onClick={handleClearSeed}><CloseIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title={t('painting.workspace.parameters.randomSeed')} arrow><IconButton size="small" aria-label={t('painting.workspace.parameters.randomSeed')} onClick={() => handleSeedChange(null, true)}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
              </InputAdornment>,
            } }}
          />
        )}
        {editor?.key === 'sampler' && (
          <Tooltip title={isV5Medium ? t('painting.workspace.parameters.modelV5MediumSettings') : ''} arrow>
            <MenuList autoFocusItem dense aria-label={title} sx={{ p: 0 }}>
              {samplerOptions.map(option => (
                <MenuItem key={option.value} selected={params.sampler === option.value} disabled={isV5Medium} onClick={() => { handleParamChange('sampler', option.value); closeEditor(); }} sx={{ minHeight: 36, borderRadius: 1, gap: 1 }}>
                  <Box sx={{ width: 18, display: 'flex' }}>{params.sampler === option.value && <CheckIcon sx={{ fontSize: 18 }} />}</Box>{option.label}
                </MenuItem>
              ))}
            </MenuList>
          </Tooltip>
        )}
        {editor?.key === 'other' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {!isV5Medium && <LockableSlider
              label={t('painting.workspace.parameters.promptGuidanceRescale')} value={params.promptGuidanceRescale}
              min={0} max={1} step={0.02} onChange={value => handleParamChange('promptGuidanceRescale', value)}
              tooltip={t('painting.workspace.parameters.promptGuidanceRescaleHelp')} valueLabelFormat={value => value.toFixed(2)}
            />}
            {!isV5Medium && <FormControl fullWidth size="small">
              <InputLabel id={`${id}-noise-label`}>{t('painting.workspace.parameters.noiseSchedule')}</InputLabel>
              <Select labelId={`${id}-noise-label`} label={t('painting.workspace.parameters.noiseSchedule')} value={params.noiseSchedule} onChange={event => handleParamChange('noiseSchedule', event.target.value)}>
                {noiseScheduleOptions.map(option => <MenuItem key={option.value} value={option.value}>{t(`painting.workspace.parameters.${option.label}`)}</MenuItem>)}
              </Select>
            </FormControl>}
            <LockableSlider
              label={t('painting.workspace.parameters.batchSize')} value={params.batchSize} min={1} max={8} step={1}
              onChange={value => handleParamChange('batchSize', value)} tooltip={t('painting.workspace.parameters.batchSizeHelp')}
              marks={[{ value: 1, label: '1' }, { value: 4, label: '4' }, { value: 8, label: '8' }]}
            />
            <ExtraConfiguration
              params={params}
              handleParamChange={handleParamChange}
              handleSmeaChange={handleSmeaChange}
              handleDynChange={handleDynChange}
              handleResetParamsConfirm={() => { closeEditor(); handleResetParamsConfirm(); }}
            />
          </Box>
        )}
        </Box>
      </Popover>
    </>
  );
}
