"use client";

import React, { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, Chip, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { Add, ExpandMore, FolderOutlined } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const translatedFields = new Set(['model', 'seed', 'steps', 'guidanceScale', 'sampler', 'width', 'height', 'positivePrompt', 'negativePrompt', 'prompt', 'negative_prompt', 'name', 'uc', 'center', 'position', 'characterTabs', 'use_coords', 'noiseSchedule', 'promptGuidanceRescale']);
const newFieldValues = { string: '', number: 0, boolean: false, object: {}, array: [], null: null };

/**
 * 找出参数树中已在主提示词和角色区显示的副本，仅隐藏可对应的字段。
 * @param {object} parameters 已规范化的生成参数。
 * @returns {Array<Array<string|number>>} 仍保留在数据中、但不重复呈现的叶子路径。
 */
export function getParameterSharedPaths(parameters) {
  const paths = ['positivePrompt', 'negativePrompt', 'prompt', 'input', 'uc', 'negative_prompt', 'characterTabs'].filter((key) => key in parameters).map((key) => [key]);
  for (const key of ['v4_prompt', 'v4_negative_prompt']) {
    const container = parameters[key];
    if (!container) continue;
    if (container.caption?.base_caption !== undefined) paths.push([key, 'caption', 'base_caption']);
    if (parameters.use_coords !== undefined && container.use_coords !== undefined) paths.push([key, 'use_coords']);
    container.caption?.char_captions?.forEach((character, index) => {
      const tab = parameters.characterTabs?.[index];
      if (!tab) return;
      if (character.char_caption !== undefined) paths.push([key, 'caption', 'char_captions', index, 'char_caption']);
      if (tab.center) {
        for (const axis of ['x', 'y']) {
          if (character.centers?.[0]?.[axis] !== undefined) paths.push([key, 'caption', 'char_captions', index, 'centers', 0, axis]);
          if (character.center?.[axis] !== undefined) paths.push([key, 'caption', 'char_captions', index, 'center', axis]);
        }
      }
    });
  }
  return paths;
}

/**
 * 按层级展示或修改已有参数，重复的提示词字段由详情主区域呈现。
 * @param {object} props value 为参数树，onChange 接收修改后的树；editStructure 允许添加和删除字段。
 * @returns {React.ReactElement} 可展开的参数表单或可选择的只读元数据。
 */
export default function GalleryMetadataFields({ value, onChange, hiddenPaths = [], path = [], disabled = false, allowStructure = true, editStructure = allowStructure, validateRootField, selection = null }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('string');
  const isArray = Array.isArray(value);
  const canEditStructure = Boolean(onChange && editStructure);
  const selecting = canEditStructure && selection !== null;
  const Layout = canEditStructure ? Box : Stack;
  const entries = Object.entries(value);
  const keyToAdd = fieldName.trim();
  const duplicateKey = !isArray && Object.hasOwn(value, keyToAdd);
  const validKey = isArray || (keyToAdd && !duplicateKey && (path.length > 0 || !validateRootField || validateRootField(keyToAdd)));
  let visible = entries.filter(([key]) => !hiddenPaths.some((hidden) => JSON.stringify(hidden) === JSON.stringify([...path, isArray ? Number(key) : key])));
  if ((!editStructure || !selection) && path.length === 2 && path[0] === 'characterTabs' && typeof path[1] === 'number') {
    const order = ['name', 'prompt', 'uc', 'center', 'position'];
    visible = visible.filter(([key, item]) => key !== 'colorId' && (key !== 'name' || item || onChange));
    visible.sort(([a], [b]) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length));
  }
  const update = (key, next) => {
    onChange(isArray ? value.map((item, index) => index === Number(key) ? next : item) : { ...value, [key]: next });
  };
  const addField = () => {
    if (!validKey) return;
    const next = newFieldValues[fieldType];
    onChange(isArray ? [...value, next] : { ...value, [keyToAdd]: next });
    setFieldName('');
    setAdding(false);
  };

  return <Layout {...(canEditStructure ? {} : { spacing: 1.25 })} sx={{
    minWidth: 0,
    ...(canEditStructure && {
      display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5,
    }),
  }}>
    {visible.map(([key, item]) => {
      const fieldPath = [...path, isArray ? Number(key) : key];
      const nested = item !== null && typeof item === 'object';
      const label = isArray ? `#${Number(key) + 1}${item?.name ? ` · ${item.name}` : ''}` : translatedFields.has(key) ? t(`gallery.${key}`) : key;
      const longText = typeof item === 'string' && (item.length > 72 || item.includes('\n') || /prompt|caption|description|^uc$/i.test(key));
      let control;
      if (nested) control = <Accordion key={key} disableGutters elevation={0} defaultExpanded={canEditStructure ? path.length === 0 : path.length < 2}
        sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: '8px !important', overflow: canEditStructure ? 'hidden' : undefined, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMore fontSize="small" />} sx={{
          minHeight: canEditStructure ? 44 : 38, px: 1.25, bgcolor: canEditStructure ? 'action.hover' : undefined,
          '& .MuiAccordionSummary-content': { my: 0.75, minWidth: 0, alignItems: canEditStructure ? 'center' : undefined },
        }}>
          {canEditStructure && <FolderOutlined aria-hidden="true" sx={{ mr: 1, fontSize: 17, color: 'text.secondary' }} />}
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{label}</Typography>
          {canEditStructure
            ? <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', pr: 1, whiteSpace: 'nowrap' }}>{t('gallery.metadataEdit.fieldCount', { count: Object.keys(item).length })}</Typography>
            : <Chip size="small" variant="outlined" label={Object.keys(item).length} sx={{ ml: 1, height: 20, fontSize: 10 }} />}
        </AccordionSummary>
        <AccordionDetails sx={{ px: { xs: 1, sm: 1.5 }, pt: canEditStructure ? 1.75 : undefined, pb: canEditStructure ? 1.5 : 1.25 }}><GalleryMetadataFields value={item} path={fieldPath} hiddenPaths={hiddenPaths} disabled={disabled}
          editStructure={editStructure} validateRootField={validateRootField} selection={selection}
          onChange={onChange ? (next) => update(key, next) : undefined} /></AccordionDetails>
      </Accordion>;
      else if (onChange) control = typeof item === 'boolean'
        ? <Stack key={key} direction={canEditStructure ? 'row-reverse' : 'row'} alignItems="center"
          sx={canEditStructure ? { minHeight: 40, px: 1.25, gap: 0.75, justifyContent: 'space-between', border: 1, borderColor: 'divider', borderRadius: 1.25 } : undefined}>
          <Switch size="small" checked={item} disabled={disabled || selecting} inputProps={{ 'aria-label': label }} onChange={(_, checked) => update(key, checked)} />
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{label}</Typography>
        </Stack>
        : <TextField key={key} fullWidth size="small" label={label} disabled={disabled} value={item ?? ''} type={typeof item === 'number' ? 'number' : 'text'}
          multiline={canEditStructure ? longText : typeof item === 'string'}
          minRows={canEditStructure ? (longText ? 2 : 1) : (typeof item === 'string' && (item.length > 100 || item.includes('\n')) ? 3 : 1)}
          maxRows={canEditStructure ? 6 : 10}
          inputProps={{ ...(typeof item === 'number' && { step: 'any' }), ...(selecting && { readOnly: true }) }}
          onChange={(event) => update(key, typeof item === 'number' ? Number(event.target.value) : event.target.value)} />;
      else return <Box key={key} sx={{ minWidth: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere', mb: 0.25 }}>{label}</Typography>
        <Typography variant="body2" data-gallery-style-source={path.length === 2 && path[0] === 'characterTabs' && key === 'prompt' ? 'true' : undefined} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, userSelect: 'text', maxHeight: 240, overflowY: 'auto' }}>{item === null ? 'null' : typeof item === 'boolean' ? t(item ? 'gallery.enabled' : 'gallery.disabled') : String(item) || t('gallery.emptyValue')}</Typography>
      </Box>;
      if (!canEditStructure) return control;
      const selectedPath = selection?.paths.find((candidate) =>
        candidate.length <= fieldPath.length && candidate.every((name, index) => name === fieldPath[index]));
      const partiallySelected = nested && !selectedPath && selection?.paths.some((candidate) =>
        fieldPath.every((name, index) => name === candidate[index]));
      return <Stack key={key} direction="row" spacing={0.5} alignItems={nested || longText ? 'flex-start' : 'center'}
        sx={{ gridColumn: nested || longText ? '1 / -1' : undefined }}>
        {selecting && <Checkbox size="small" checked={Boolean(selectedPath)} indeterminate={Boolean(partiallySelected)}
          disabled={disabled || (selectedPath && selectedPath.length < fieldPath.length)}
          inputProps={{ 'aria-label': t('gallery.metadataEdit.selectField', { field: label }) }}
          onChange={() => selection.toggle(fieldPath)} sx={{ flexShrink: 0, mt: nested || longText ? 0.5 : 0, p: 0.75 }} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>{control}</Box>
      </Stack>;
    })}
    {!visible.length && <Typography variant={canEditStructure ? 'body2' : 'caption'} color="text.secondary"
      sx={canEditStructure ? { gridColumn: '1 / -1', p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1.5 } : undefined}>
      {t(entries.length ? 'gallery.sharedFieldsOnly' : 'gallery.emptyFields')}
    </Typography>}
    {canEditStructure && !selecting && (adding ? (
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'flex-start' }} spacing={1}
        sx={{ gridColumn: '1 / -1', border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.25, bgcolor: 'action.hover' }}>
        {!isArray && <TextField autoFocus size="small" label={t('gallery.metadataEdit.name')} value={fieldName}
          disabled={disabled} error={Boolean(fieldName && !validKey)}
          helperText={fieldName && !validKey ? t(duplicateKey ? 'gallery.metadataEdit.duplicate' : 'gallery.metadataEdit.invalidName') : undefined}
          onChange={(event) => setFieldName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); addField(); }
          }} sx={{ flex: 1 }} />}
        <TextField select autoFocus={isArray} size="small" label={t('gallery.metadataEdit.type')} value={fieldType}
          disabled={disabled} onChange={(event) => setFieldType(event.target.value)} sx={{ minWidth: 116 }}>
          {Object.keys(newFieldValues).map((type) => <MenuItem key={type} value={type}>{t(`gallery.metadataEdit.types.${type}`)}</MenuItem>)}
        </TextField>
        <Stack direction="row" spacing={0.5}>
          <Button size="small" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
          <Button size="small" variant="outlined" disabled={disabled || !validKey} onClick={addField}>{t('gallery.metadataEdit.add')}</Button>
        </Stack>
      </Stack>
    ) : <Button size="small" startIcon={<Add fontSize="small" />} disabled={disabled} onClick={() => setAdding(true)}
      sx={{ gridColumn: '1 / -1', justifySelf: 'start', px: 0.75 }}>
      {t(isArray ? 'gallery.metadataEdit.addItem' : 'gallery.metadataEdit.addField')}
    </Button>)}
  </Layout>;
}
