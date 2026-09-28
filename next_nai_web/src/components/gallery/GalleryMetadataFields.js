"use client";

import React, { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, IconButton, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Add, DeleteOutline, ExpandMore } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const translatedFields = new Set(['model', 'seed', 'steps', 'guidanceScale', 'sampler', 'width', 'height', 'positivePrompt', 'negativePrompt', 'prompt', 'negative_prompt', 'name', 'uc', 'center', 'position', 'characterTabs', 'use_coords', 'noiseSchedule', 'promptGuidanceRescale']);
const initialValues = { string: '', number: 0, boolean: false, null: null, object: {}, array: [] };

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
 * 递归呈现或编辑元数据对象、数组和标量；隐藏的合并字段保留在原树中。
 * @param {object} props value 为当前树，onChange 接收新树和改动路径；只读时省略回调。
 * @returns {React.ReactElement} 带类型输入、层级分组和字段增删的可视表单。
 */
export default function GalleryMetadataFields({ value, onChange, hiddenPaths = [], path = [], disabled = false, allowStructure = true }) {
  const { t } = useI18n();
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState('string');
  const isArray = Array.isArray(value);
  const entries = Object.entries(value);
  let visible = entries.filter(([key]) => !hiddenPaths.some((hidden) => JSON.stringify(hidden) === JSON.stringify([...path, isArray ? Number(key) : key])));
  if (path.length === 2 && path[0] === 'characterTabs' && typeof path[1] === 'number') {
    // 只整理合并后的角色表单；原始元数据仍保持文件中的键顺序和字段。
    const order = ['name', 'prompt', 'uc', 'center', 'position'];
    visible = visible.filter(([key, item]) => key !== 'colorId' && (key !== 'name' || item || onChange));
    visible.sort(([a], [b]) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length));
  }
  const update = (key, next, changedPath) => {
    const copy = isArray ? value.map((item, index) => index === Number(key) ? next : item) : { ...value, [key]: next };
    if (isArray && Number(key) === value.length) copy.push(next);
    onChange(copy, changedPath);
  };

  return <Stack spacing={1.25} sx={{ minWidth: 0 }}>
    {visible.map(([key, item]) => {
      const fieldPath = [...path, isArray ? Number(key) : key];
      const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
      const nested = type === 'object' || type === 'array';
      const label = isArray ? `#${Number(key) + 1}${item?.name ? ` · ${item.name}` : ''}` : translatedFields.has(key) ? t(`gallery.${key}`) : key;
      const remove = onChange && allowStructure ? <Tooltip title={t('gallery.removeField')}><IconButton size="small" aria-label={`${t('gallery.removeField')}: ${label}`} disabled={disabled} onClick={(event) => {
        event.stopPropagation();
        const next = isArray ? value.filter((_, index) => index !== Number(key)) : Object.fromEntries(entries.filter(([name]) => name !== key));
        onChange(next, fieldPath);
      }}><DeleteOutline sx={{ fontSize: 16 }} /></IconButton></Tooltip> : null;
      if (nested) return <Box key={key} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25, minWidth: 0 }}>
        <Accordion disableGutters elevation={0} defaultExpanded={path.length < 2} sx={{ flex: 1, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMore fontSize="small" />} sx={{ minHeight: 38, px: 1.25, '& .MuiAccordionSummary-content': { my: 0.75, minWidth: 0 } }}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{label}</Typography>
            <Chip size="small" variant="outlined" label={`${type === 'array' ? '[]' : '{}'} ${Object.keys(item).length}`} sx={{ ml: 1, height: 20, fontSize: 10 }} />
          </AccordionSummary>
          <AccordionDetails sx={{ px: { xs: 1, sm: 1.5 }, pb: 1.25 }}>
            <GalleryMetadataFields value={item} path={fieldPath} hiddenPaths={hiddenPaths} disabled={disabled} allowStructure={allowStructure}
              onChange={onChange ? (next, changedPath) => update(key, next, changedPath) : undefined} />
          </AccordionDetails>
        </Accordion>{remove}
      </Box>;
      return <Box key={key} sx={{ minWidth: 0, p: onChange ? 0 : 1, bgcolor: onChange ? undefined : 'action.hover', borderRadius: 1 }}>
        {onChange ? <Stack direction="row" alignItems="flex-start" spacing={0.5}>
          {type === 'boolean' ? <Stack direction="row" alignItems="center" sx={{ flex: 1, minWidth: 0 }}><Switch size="small" checked={item} disabled={disabled} inputProps={{ 'aria-label': label }} onChange={(_, checked) => update(key, checked, fieldPath)} /><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{label}</Typography></Stack>
            : <TextField fullWidth size="small" label={label} disabled={disabled} value={item ?? ''} type={type === 'number' ? 'number' : 'text'}
              multiline={type === 'string'} minRows={type === 'string' && (item.length > 100 || item.includes('\n')) ? 3 : 1} maxRows={10}
              inputProps={type === 'number' ? { step: 'any' } : undefined}
              onChange={(event) => update(key, type === 'number' ? Number(event.target.value) : event.target.value, fieldPath)} />}
          {type === 'null' && <Chip label="null" size="small" sx={{ mt: 0.75 }} />}{remove}
        </Stack> : <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere', mb: 0.25 }}>{label}</Typography>
          <Typography variant="body2" data-gallery-style-source={path.length === 2 && path[0] === 'characterTabs' && key === 'prompt' ? 'true' : undefined} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, userSelect: 'text', maxHeight: 240, overflowY: 'auto' }}>{item === null ? 'null' : typeof item === 'boolean' ? t(item ? 'gallery.enabled' : 'gallery.disabled') : String(item) || t('gallery.emptyValue')}</Typography>
        </>}
      </Box>;
    })}
    {!visible.length && <Typography variant="caption" color="text.secondary">{t(entries.length ? 'gallery.sharedFieldsOnly' : 'gallery.emptyFields')}</Typography>}
    {onChange && allowStructure && <Stack direction="row" spacing={0.75} sx={{ pt: 0.5 }}>
      {!isArray && <TextField size="small" label={t('gallery.fieldName')} value={newKey} disabled={disabled} onChange={(event) => setNewKey(event.target.value)} sx={{ minWidth: 0, flex: 1 }} />}
      <TextField select size="small" label={t('gallery.fieldType')} value={newType} disabled={disabled} onChange={(event) => setNewType(event.target.value)} sx={{ width: 105 }}>
        {Object.keys(initialValues).map((type) => <MenuItem key={type} value={type}>{t(`gallery.type_${type}`)}</MenuItem>)}
      </TextField>
      <Tooltip title={t(isArray ? 'gallery.addItem' : 'gallery.addField')}><span><Button variant="outlined" size="small" aria-label={t(isArray ? 'gallery.addItem' : 'gallery.addField')} disabled={disabled || (!isArray && (!newKey.trim() || Object.hasOwn(value, newKey.trim())))} sx={{ minWidth: 36, height: 40 }} onClick={() => {
        const key = isArray ? value.length : newKey.trim();
        update(key, initialValues[newType], [...path, key]); setNewKey('');
      }}><Add fontSize="small" /></Button></span></Tooltip>
    </Stack>}
  </Stack>;
}
