'use client';

import { useMemo } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Check, TextFields } from '@mui/icons-material';
import { matchComicDialogueLines } from './comicDialogueMatch.mjs';
import { comicTextEdits, comicTextLines } from './comicTextEdits.mjs';

/** 核对原图上的文字框，选择对白或去字方式，并将确认的修改写回画布。 */
export default function ComicTextReview({ state, dialogues, language, disabled, onEdit, onRecognize, onApply, onApplyPending }) {
  const w = (zh, en) => language === 'zh' ? zh : en;
  const { ocr, result } = state;
  const matches = useMemo(() => matchComicDialogueLines(comicTextLines({ ocr, result }), dialogues), [ocr, result, dialogues]);
  const edits = comicTextEdits(state, dialogues, matches);
  const presets = [...dialogues].filter((dialogue) => dialogue.text.trim()).sort((a, b) => a.order - b.order);
  const invalid = edits.some(({ choice, text }) => choice?.action === 'replace' && !text);
  const canApply = edits.some(({ choice, text, direction, dialogueId, previous }) => {
    if (!choice) return previous?.applied;
    return !previous?.applied || previous.text !== text || previous.direction !== direction || previous.dialogueId !== dialogueId;
  });
  const failed = edits.flatMap(({ choice, previous }, index) => choice && previous?.needsReview && !previous.applied ? [index + 1] : []);

  return <>
    <Box sx={{ position: 'relative', alignSelf: 'center', width: '100%', maxWidth: 640, overflow: 'hidden', borderRadius: 1 }}>
      <Box component="img" src={state.originalImage.dataUrl} alt={w('生成原图与文字区域', 'Original image and text regions')} sx={{ display: 'block', width: '100%', height: 'auto' }} />
      {edits.length > 0 && <svg aria-hidden="true" viewBox={`0 0 ${state.originalImage.width} ${state.originalImage.height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {edits.map(({ id, line: { bounds }, previous }, index) => {
          const color = previous?.applied ? '#25a36f' : '#e17a00';
          return <g key={id}>
            <rect {...bounds} fill="none" stroke={color} vectorEffect="non-scaling-stroke" />
            <text x={bounds.x} y={Math.max(18, bounds.y - 4)} fontSize={22} fontWeight={700} fill={color} stroke="black" strokeWidth={2} paintOrder="stroke">{index + 1}</text>
          </g>;
        })}
      </svg>}
    </Box>
    {state.ocrError && <Alert severity="warning">{w('文字识别未完成，可以从原图重试。', 'Text recognition did not finish. Retry using the original image.')} {state.ocrError}</Alert>}
    {edits.length > 0 ? <Stack spacing={1}>
      {edits.map(({ id, line, choice, text, suggestion }, index) => {
        const mode = typeof choice === 'string' ? `dialogue:${choice}` : choice?.action ?? 'keep';
        return <Stack key={id} data-comic-text-region={id} spacing={1} sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{index + 1}. {line.text || w('未读出文字', 'Unreadable text')}</Typography>
          <TextField select fullWidth size="small" label={w('处理方式', 'Text action')} value={mode} disabled={disabled}
            sx={{ '& .MuiSelect-select': { textOverflow: 'ellipsis' } }} onChange={(event) => {
              const value = event.target.value;
              onEdit(id, value === 'match' ? { action: 'auto' } : value === 'keep' ? null : value === 'erase' ? { action: 'erase' }
                : value === 'replace' ? { action: 'replace', text: text || line.text, direction: line.direction } : value.slice('dialogue:'.length));
            }}>
            {(suggestion || mode === 'match') && <MenuItem value="match" sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
              {w('匹配的 AI 对白', 'Matched AI dialogue')} · {(mode === 'match' ? text : suggestion.text)}
            </MenuItem>}
            <MenuItem value="keep">{w('保留原文', 'Keep original')}</MenuItem>
            <MenuItem value="erase">{w('仅抹除文字', 'Erase text only')}</MenuItem>
            <MenuItem value="replace">{w('自定义文字', 'Custom text')}</MenuItem>
            {presets.map((dialogue) => <MenuItem key={dialogue.id} value={`dialogue:${dialogue.id}`} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
              disabled={edits.some((other) => other.id !== id && other.choice === dialogue.id)}>
              {w(`AI 对白 ${dialogue.order} · `, `AI dialogue ${dialogue.order} · `)}{dialogue.text}
            </MenuItem>)}
          </TextField>
          {mode === 'replace' && <>
            <TextField multiline minRows={2} fullWidth size="small" label={w('替换文字', 'Replacement text')} value={choice.text} disabled={disabled}
              error={!choice.text.trim()} slotProps={{ htmlInput: { maxLength: 2000 } }}
              onChange={(event) => onEdit(id, { ...choice, text: event.target.value })} />
            <TextField select size="small" label={w('文字方向', 'Text direction')} value={choice.direction} disabled={disabled}
              onChange={(event) => onEdit(id, { ...choice, direction: event.target.value })}>
              <MenuItem value="horizontal-tb">{w('横排', 'Horizontal')}</MenuItem>
              <MenuItem value="vertical-rl">{w('竖排（从右到左）', 'Vertical (right to left)')}</MenuItem>
            </TextField>
          </>}
        </Stack>;
      })}
    </Stack> : state.ocr && <Typography variant="body2" color="text.secondary">{w('未识别到文字', 'No text detected')}</Typography>}
    {failed.length > 0 && <Alert severity="warning">{w('这些区域未能去字，已保留原文', 'Original text was kept in these regions')} · {failed.join(', ')}</Alert>}
    {state.pending && <Alert severity="info">{w('当前分区有待写入画布的结果。', 'This section has a result waiting to be applied to the canvas.')}</Alert>}
    <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="flex-end" sx={{ position: 'sticky', bottom: 0, zIndex: 1,
      bgcolor: 'background.paper', py: 1.25, borderTop: 1, borderColor: 'divider' }}>
      <Button size="small" startIcon={<TextFields />} disabled={disabled} onClick={onRecognize}>{state.ocr || edits.length ? w('重新识别', 'Recognize again') : w('识别文字', 'Recognize text')}</Button>
      {edits.length > 0 && <Button size="small" variant="contained" startIcon={<Check />} disabled={disabled || invalid || !canApply} onClick={onApply}>{w('应用文字替换', 'Apply text changes')}</Button>}
      {state.pending && <Button size="small" variant="outlined" disabled={disabled} onClick={onApplyPending}>{w('应用待写入结果', 'Apply saved result')}</Button>}
    </Stack>
  </>;
}
