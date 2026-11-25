import React, { useContext, useState } from 'react';
import { copyTextToClipboard } from '@/utils/browserCapabilities.mjs';
import EditorExerciseContext from '@/components/tutorials/EditorExerciseContext';
import { Box, IconButton, Paper, Typography } from '@mui/material';
import { Check, ContentCopy } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 在笔记的保存、详情和角色卡预览中展示正负提示词，每个文本区均可单独选取和复制。
 * @param {object} props 正向、负向原文，以及用于区分各角色复制按钮的名称。
 * @returns {React.ReactElement} 随宽度换行的提示词预览。
 */
export default function NotePromptPreview({ positive, negative, characterName = '' }) {
  const { t } = useI18n();
  const exercise = useContext(EditorExerciseContext);
  const [feedback, setFeedback] = useState(null);
  const fields = [[positive, 'positivePrompt', 'copyPositive'], [negative, 'negativePrompt', 'copyNegative']].filter(([value]) => value);
  if (!fields.length) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: `repeat(${fields.length}, minmax(0, 1fr))` }, gap: 1 }}>
      {fields.map(([value, field, action]) => {
        const label = [characterName, t('painting.workspace.prompt.' + action)].filter(Boolean).join(' · ');
        const result = feedback?.field === field && feedback.value === value ? feedback.result : '';
        return (
          <Paper key={field} variant="outlined" sx={{ minWidth: 0, borderRadius: 2, bgcolor: 'background.default', px: 1.5, pt: 0.75, pb: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('painting.tools.notebook.' + field)}</Typography>
              <IconButton size="small" data-tour={characterName ? 'characterCopy' : undefined} title={label} aria-label={label} onClick={async () => {
                try {
                  if (!exercise?.demonstration) await copyTextToClipboard(value);
                  if (characterName) exercise?.notify('copyCharacter');
                  setFeedback({ field, value, result: 'copied' });
                } catch {
                  setFeedback({ field, value, result: 'copyFailed' });
                }
              }}>
                {result === 'copied' ? <Check fontSize="small" color="success" /> : <ContentCopy sx={{ fontSize: 16 }} />}
              </IconButton>
            </Box>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, maxHeight: '14rem', overflowY: 'auto', userSelect: 'text' }}>
              {value}
            </Typography>
            {result && <Typography role="status" variant="caption" color={result === 'copied' ? 'success.main' : 'error.main'}>{t('gallery.' + result)}</Typography>}
          </Paper>
        );
      })}
    </Box>
  );
}
