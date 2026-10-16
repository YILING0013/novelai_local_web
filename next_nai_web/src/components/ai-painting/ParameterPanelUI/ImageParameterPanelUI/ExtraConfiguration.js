"use client";

import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, FormControlLabel, FormGroup, Tooltip, Typography } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Info as InfoIcon, Refresh as RefreshIcon, Tune as TuneIcon } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const optionLabelSx = {
  m: 0,
  minHeight: 36,
  alignItems: 'flex-start',
  '& .MuiCheckbox-root': { p: 0.75 },
  '& .MuiCheckbox-root .MuiSvgIcon-root': { fontSize: 20 },
  '& .MuiFormControlLabel-label': { py: 0.75 },
};

const optionTextSx = {
  fontSize: '0.875rem',
  lineHeight: 1.5,
};

const infoIconSx = {
  ml: 0.75,
  fontSize: 16,
  flexShrink: 0,
  opacity: 0.7,
};


/**
 * 显示其它设置中的额外配置，恢复默认值也在这里统一操作。
 * @param {object} props 当前参数、参数修改回调和恢复默认值回调。
 * @returns {React.ReactElement} 其它设置浮层内默认收起的额外配置区域。
 */
export default function ExtraConfiguration({ params, handleParamChange, handleSmeaChange, handleDynChange, handleResetParamsConfirm }) {
  const { t } = useI18n();
  const isSmeaUnsupported = params.isV4Model;
  // V4 及以上模型官方不支持 SMEA / SMEA DYN，UI 必须显示为关闭且不可交互。
  const smeaChecked = isSmeaUnsupported ? false : Boolean(params.smea);
  const dynChecked = isSmeaUnsupported ? false : Boolean(params.dyn);
  const autoSmeaChecked = isSmeaUnsupported ? false : Boolean(params.autoSmea);
  const smeaTooltip = isSmeaUnsupported
    ? t('painting.workspace.parameters.smeaUnsupported')
    : t('painting.workspace.parameters.smeaHelp');
  const dynTooltip = isSmeaUnsupported
    ? t('painting.workspace.parameters.smeaDynUnsupported')
    : t('painting.workspace.parameters.smeaDynHelp');

  return (
    <Accordion
      disableGutters
      sx={{
        boxShadow: 'none',
        background: 'transparent',
        border: 0,
        borderTop: '1px solid',
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:before': { display: 'none' },
        borderRadius: '0 !important',
        '&.Mui-expanded': { m: 0 },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
        sx={{
          minHeight: 44,
          height: 44,
          p: 0,
          '&:hover': { backgroundColor: 'transparent' },
          '&.Mui-expanded': { minHeight: 44 },
          '& .MuiAccordionSummary-content': { margin: 0 },
          '& .MuiAccordionSummary-content.Mui-expanded': { margin: 0 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <TuneIcon sx={{ mr: 1, fontSize: 18, color: 'text.secondary' }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.5 }}>
            {t('painting.workspace.parameters.extraConfiguration')}
          </Typography>
          <Tooltip title={t('painting.workspace.parameters.extraConfigurationWarning')} arrow placement="right">
            <InfoIcon sx={{ ml: 0.75, fontSize: 16, opacity: 0.6 }} />
          </Tooltip>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pb: 2, pt: 1 }}>
        <Typography color="text.secondary" sx={{ display: 'block', mb: 2, fontSize: '0.875rem', lineHeight: 1.6 }}>
          {t('painting.workspace.parameters.experimentalWarning')}
        </Typography>

        <Box sx={{ mb: 2 }}>
          <Typography color="text.secondary" fontWeight="medium" sx={{ mb: 0.75, display: 'block', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('painting.workspace.parameters.compatibilitySettings')}
          </Typography>
          <FormGroup>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={params.legacy}
                    onChange={(e) => handleParamChange('legacy', e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.legacyCompatibility')}</Typography>
                    <Tooltip title={t('painting.workspace.parameters.legacyCompatibilityHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={params.legacy_uc}
                    onChange={(e) => handleParamChange('legacy_uc', e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.legacyPromptConditioning')}</Typography>
                    <Tooltip title={t('painting.workspace.parameters.legacyPromptConditioningHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={params.legacy_v3_extend}
                    onChange={(e) => handleParamChange('legacy_v3_extend', e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.legacyV3Extend')}</Typography>
                    <Tooltip title={t('painting.workspace.parameters.legacyV3ExtendHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />
            </Box>
          </FormGroup>
        </Box>

        <Box>
          <Typography color="text.secondary" fontWeight="medium" sx={{ mb: 0.75, display: 'block', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('painting.workspace.parameters.specialFeatures')}
          </Typography>
          <FormGroup>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={smeaChecked}
                    onChange={handleSmeaChange}
                    disabled={isSmeaUnsupported}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>SMEA</Typography>
                    <Tooltip title={smeaTooltip} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={dynChecked}
                    onChange={handleDynChange}
                    disabled={isSmeaUnsupported || !smeaChecked}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>DYN</Typography>
                    <Tooltip title={dynTooltip} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={params.variety}
                    onChange={(e) => handleParamChange('variety', e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.variety')}</Typography>
                    <Tooltip title={t('painting.workspace.parameters.varietyHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={params.decrisp}
                    onChange={(e) => handleParamChange('decrisp', e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.decrisp')}</Typography>
                    <Tooltip title={t('painting.workspace.parameters.decrispHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={autoSmeaChecked}
                    onChange={(e) => handleParamChange('autoSmea', e.target.checked)}
                    disabled={isSmeaUnsupported}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.autoSmea')}</Typography>
                    <Tooltip title={isSmeaUnsupported
                      ? t('painting.workspace.parameters.autoSmeaUnsupported')
                      : t('painting.workspace.parameters.autoSmeaHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={params.prefer_brownian}
                    onChange={(e) => handleParamChange('prefer_brownian', e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.brownianMotion')}</Typography>
                    <Tooltip title={t('painting.workspace.parameters.brownianMotionHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={params.deliberate_euler_ancestral_bug}
                    onChange={(e) => handleParamChange('deliberate_euler_ancestral_bug', e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={optionTextSx}>{t('painting.workspace.parameters.preserveSamplerBug')}</Typography>
                    <Tooltip title={t('painting.workspace.parameters.preserveSamplerBugHelp')} arrow>
                      <InfoIcon sx={infoIconSx} />
                    </Tooltip>
                  </Box>
                }
                sx={optionLabelSx}
              />
            </Box>
          </FormGroup>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            startIcon={<RefreshIcon fontSize="small" />}
            onClick={handleResetParamsConfirm}
            sx={{
              minHeight: 40,
              fontSize: '0.875rem',
              opacity: 0.8,
              '&:hover': { opacity: 1 }
            }}
          >
            {t('painting.workspace.parameters.resetAllDefaults')}
          </Button>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
