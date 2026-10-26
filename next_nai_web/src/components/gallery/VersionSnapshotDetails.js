"use client";

import React, { useState } from 'react';
import { Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import { diffParameters, diffPrompts, diffPromptText } from './versionDiff.mjs';
import { versionReferences, visibleVersionParameters } from './versionSnapshot.mjs';

const colors = {
  removed: { color: 'error.main', bgcolor: 'rgba(220, 55, 65, .13)', textDecoration: 'line-through' },
  added: { color: 'success.main', bgcolor: 'rgba(30, 170, 90, .14)', textDecoration: 'none' },
  changed: { color: 'info.main', bgcolor: 'rgba(40, 130, 235, .14)' },
};
const pre = { m: 0, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.9, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

function PromptDifference({ title, before, after, compare, split, zh }) {
  const parts = compare ? diffPromptText(before || '', after || '') : [{ kind: 'equal', text: after || '' }];
  const weights = compare ? diffPrompts(before || '', after || '').changed : [];
  const content = (side) => parts.filter((part) => side === 'both' || part.kind !== (side === 'before' ? 'added' : 'removed')).map((part, index) =>
    <Box component={part.kind === 'removed' ? 'del' : part.kind === 'added' ? 'ins' : 'span'} key={index}
      sx={{ ...colors[part.kind], borderRadius: 0.4, py: part.kind === 'equal' ? 0 : 0.15 }}>{part.text}</Box>);
  return <Box>
    <Typography variant="subtitle2" sx={{ mb: 0.6 }}>{title}</Typography>
    {compare && before === after && <Typography variant="caption" color="text.secondary">{zh ? '未修改' : 'Unchanged'}</Typography>}
    {weights.length > 0 && <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 0.75 }}>
      {weights.map((item, index) => <Chip key={index} size="small" color="info" variant="outlined"
        label={item.name + ': ' + item.before + ' → ' + item.after} />)}
    </Stack>}
    {split && compare ? <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      {['before', 'after'].map((side) => <Box key={side} sx={{ p: 1, minWidth: 0, bgcolor: side === 'before' ? 'rgba(220,55,65,.035)' : 'rgba(30,170,90,.035)', borderRight: side === 'before' ? 1 : 0, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">{side === 'before' ? (zh ? '修改前' : 'Before') : (zh ? '修改后' : 'After')}</Typography>
        <Box component="pre" sx={pre}>{content(side).length ? content(side) : '∅'}</Box>
      </Box>)}
    </Box> : <Box component="pre" sx={{ ...pre, p: 1.2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>{content('both').length ? content('both') : '∅'}</Box>}
  </Box>;
}

/**
 * 展示节点的彩色提示词差异、完整参数和可恢复参考输入，不向用户输出图像编码。
 * @param {object} props 当前节点与可选的父节点或任意对照节点。
 * @returns {React.ReactElement} 节点详情及修改关系。
 */
export default function VersionSnapshotDetails({ selected, compared, onApply, disabled = false }) {
  const { locale, t } = useI18n();
  const zh = locale !== 'en-US';
  const [mode, setMode] = useState(selected.images.length ? 'diff' : 'full');
  const [split, setSplit] = useState(false);
  const compare = selected.images.length > 0 && Boolean(compared) && mode === 'diff';
  const before = compared?.parameters || {};
  const after = selected.parameters || {};
  const oldCharacters = before.characterTabs || before.editor_state?.parameterState?.characterTabs || [];
  const newCharacters = after.characterTabs || after.editor_state?.parameterState?.characterTabs || [];
  const changes = diffParameters(compare ? visibleVersionParameters(before) : {}, visibleVersionParameters(after))
    .filter((item) => !/^characterTabs\.\d+\.(prompt|uc)$/.test(item.path));
  const oldReferences = compare ? versionReferences(before) : [];
  const newReferences = versionReferences(after);
  const referenceKeys = [...new Set([...oldReferences.map((item) => item.key), ...newReferences.map((item) => item.key)])];
  const labels = zh ? {
    model: '模型', seed: '种子', steps: '步数', guidanceScale: '提示词引导', sampler: '采样器', width: '宽度', height: '高度',
    noiseSchedule: '噪声调度', promptGuidanceRescale: '引导重标度', strength: '强度', noise: '噪声', name: '名称',
    characterTabs: '角色', center: '坐标', position: '网格位置', x: 'X', y: 'Y', isTemporarilyDisabled: '暂时禁用',
    use_coords: '使用角色坐标', use_order: '角色顺序', sm: 'SMEA', sm_dyn: '动态 SMEA', autoSmea: '自动 SMEA',
    use_upscale_credits: '允许付费增强', qualityPresetId: '质量预设', ucPresetId: '负向预设', disabled: '禁用',
    type: '类型', fidelity: '保真度', referenceStrength: '参考强度', informationExtracted: '信息提取',
    encoding: '已保存编码', status: '状态', inpaint_strength: '重绘强度', disabled_original_image: '忽略原图',
    color_correct: '色彩校正', directorToolParams: '导演工具', params: '参数', prompt: '提示词', intensity: '强度',
    reference: '角色 / 风格参考', vibe: 'Vibe', image: '图生图输入', mask: '重绘遮罩',
  } : {};
  const label = (path) => path.split('.').map((piece) => labels[piece] || (/^\d+$/.test(piece) ? '#' + (Number(piece) + 1) : piece)).join(' · ');
  const value = (item) => item === undefined ? '∅' : item === true ? (zh ? '是' : 'Yes') : item === false ? (zh ? '否' : 'No') : item === null ? 'null' : typeof item === 'object' ? JSON.stringify(item) : String(item);

  return <Stack spacing={1.8}>
    <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap">
      {selected.images.length > 0 && <Button size="small" variant={mode === 'diff' ? 'contained' : 'outlined'} onClick={() => setMode('diff')}>{zh ? '修改对比' : 'Changes'}</Button>}
      <Button size="small" variant={mode === 'full' ? 'contained' : 'outlined'} onClick={() => setMode('full')}>{zh ? '完整参数' : 'Full snapshot'}</Button>
      {compare && <Button size="small" sx={{ ml: 'auto' }} onClick={() => setSplit(!split)}>{split ? (zh ? '行内对比' : 'Inline diff') : (zh ? '左右对比' : 'Split diff')}</Button>}
      {mode === 'full' && <Button size="small" sx={{ ml: 'auto' }} disabled={disabled} onClick={onApply}>{zh ? '应用所有参数' : 'Apply all parameters'}</Button>}
    </Stack>
    {compare ? <Stack direction="row" gap={1.2} flexWrap="wrap" alignItems="center">
      <Typography variant="caption">v{compared.number} → v{selected.number}</Typography>
      <Box component="span" sx={{ ...colors.removed, fontSize: 12, px: 0.5 }}>{zh ? '− 删除' : '− Removed'}</Box>
      <Box component="span" sx={{ ...colors.added, fontSize: 12, px: 0.5 }}>{zh ? '+ 新增' : '+ Added'}</Box>
      <Box component="span" sx={{ ...colors.changed, fontSize: 12, px: 0.5 }}>{zh ? '~ 权重 / 参数修改' : '~ Weight / parameter change'}</Box>
    </Stack> : null}
    {['positivePrompt', 'negativePrompt'].map((field) => <PromptDifference key={field} title={t('gallery.' + field)} before={before[field]} after={after[field]} compare={compare} split={split} zh={zh} />)}
    {Array.from({ length: compare ? Math.max(oldCharacters.length, newCharacters.length) : newCharacters.length }, (_, index) => {
      const old = oldCharacters[index] || {}, current = newCharacters[index] || {};
      return <Box key={index} sx={{ borderLeft: 3, borderColor: 'info.main', pl: 1.25 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{current.name || old.name || (zh ? '角色 ' : 'Character ') + (index + 1)}{current.isTemporarilyDisabled ? (zh ? ' · 暂时禁用' : ' · Disabled') : ''}</Typography>
        <Stack spacing={1}><PromptDifference title={t('gallery.positivePrompt')} before={old.prompt} after={current.prompt} compare={compare} split={split} zh={zh} />
          <PromptDifference title={t('gallery.negativePrompt')} before={old.uc} after={current.uc} compare={compare} split={split} zh={zh} /></Stack>
      </Box>;
    })}
    <Divider />
    <Typography variant="subtitle2">{zh ? '生成参数与角色状态' : 'Generation parameters and character state'}</Typography>
    {changes.length ? <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      {changes.map((change) => <Box key={change.path} sx={{ px: 1, py: 0.7, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 }, bgcolor: compare ? colors[change.before === undefined ? 'added' : change.after === undefined ? 'removed' : 'changed'].bgcolor : 'transparent' }}>
        <Typography variant="caption" color="text.secondary">{label(change.path)}</Typography>
        <Box sx={{ ...pre, fontSize: 12 }}>{change.media ? (zh ? '图片输入已更改，见参考图。' : 'Image input changed; see references.') : compare ?
          <><Box component="del" sx={{ color: 'error.main' }}>{value(change.before)}</Box><Box component="span" sx={{ mx: 0.7, color: 'info.main' }}>→</Box><Box component="ins" sx={{ color: 'success.main', textDecoration: 'none' }}>{value(change.after)}</Box></> : value(change.after)}</Box>
      </Box>)}
    </Box> : <Typography variant="body2" color="text.secondary">{zh ? '没有参数变化' : 'No parameter changes'}</Typography>}
    <Divider />
    <Typography variant="subtitle2">{zh ? '参考图、Vibe 与图像输入' : 'References, Vibe and image inputs'}</Typography>
    {!referenceKeys.length && <Typography variant="body2" color="text.secondary">{zh ? '未使用参考图或图像输入' : 'No references or image inputs'}</Typography>}
    {referenceKeys.map((key) => {
      const old = oldReferences.find((item) => item.key === key), current = newReferences.find((item) => item.key === key);
      const changed = old && current && (old.content !== current.content || old.original !== current.original || old.name !== current.name || JSON.stringify(old.settings) !== JSON.stringify(current.settings));
      const kind = !compare ? null : !old ? 'added' : !current ? 'removed' : changed ? 'changed' : null;
      const settingsDiff = old && current ? diffParameters(old.settings, current.settings) : [];
      return <Box key={key} sx={{ p: 1, border: 1, borderColor: kind ? colors[kind].color : 'divider', borderRadius: 1, bgcolor: kind ? colors[kind].bgcolor : 'transparent' }}>
        <Stack direction="row" justifyContent="space-between" gap={1} sx={{ mb: 0.75 }}><Typography variant="subtitle2">{label((current || old).kind)}</Typography>
          {compare && <Typography variant="caption" sx={{ color: kind ? colors[kind].color : 'text.secondary' }}>{kind === 'added' ? (zh ? '+ 新增' : '+ Added') : kind === 'removed' ? (zh ? '− 删除' : '− Removed') : kind === 'changed' ? (zh ? '~ 修改' : '~ Changed') : (zh ? '未修改' : 'Unchanged')}</Typography>}</Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: compare && (changed || !current) ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 1 }}>
          {(compare && (changed || !current) ? [old, current] : [current]).map((item, index) => <Box key={index} sx={{ minWidth: 0 }}>
            {compare && (changed || !current) && <Typography variant="caption">{index ? (zh ? '修改后' : 'After') : (zh ? '修改前' : 'Before')}</Typography>}
            {item ? <><Typography variant="caption" sx={{ display: 'block', overflowWrap: 'anywhere', mb: 0.5 }}>{item.name}</Typography>
              {item.preview ? <Box component="a" href={item.preview} target="_blank" rel="noopener noreferrer"><Box component="img" src={item.preview} alt={item.name} sx={{ display: 'block', height: 112, width: '100%', objectFit: 'contain', bgcolor: 'action.hover', borderRadius: 1 }} /></Box> : <Box sx={{ height: 70, display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}><Typography variant="caption">{item.settings.encoding ? (zh ? 'Vibe 编码已保存' : 'Vibe encoding saved') : (zh ? '未保存预览' : 'No preview saved')}</Typography></Box>}
              {item.usedImage && item.usedImage !== item.preview && <Button component="a" href={item.usedImage} target="_blank" rel="noopener noreferrer" size="small">{zh ? '查看实际使用图' : 'View processed input'}</Button>}
              {item.originalUrl && item.originalUrl !== item.preview && <Button component="a" href={item.originalUrl} target="_blank" rel="noopener noreferrer" size="small">{zh ? '查看编辑源图' : 'View original input'}</Button>}
              <Stack spacing={0.2} sx={{ mt: 0.5 }}>{Object.entries(item.settings).filter(([, val]) => val !== undefined).map(([field, val]) => <Typography key={field} variant="caption">{label(field)}: {value(val)}</Typography>)}</Stack>
            </> : <Typography variant="caption">∅</Typography>}
          </Box>)}
        </Box>
        {changed && settingsDiff.map((change) => <Typography key={change.path} variant="caption" sx={{ display: 'block', mt: 0.5, color: 'info.main' }}>{label(change.path)}: {value(change.before)} → {value(change.after)}</Typography>)}
      </Box>;
    })}
  </Stack>;
}
