import React from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 在保存和查看笔记时完整展示已解析的角色卡，避免名称或负向提示词被遗漏。
 * @param {object} props 已解析的 characters 数组。
 * @returns {React.ReactElement} 角色卡列表。
 */
export default function NoteCharacterCards({ characters }) {
  const { t } = useI18n();
  return characters.map((character, index) => (
    <Paper key={index} variant="outlined" sx={{ p: 1.5, mb: 1, borderRadius: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {character.name || `${t('painting.tools.notebook.character')} ${index + 1}`}
        </Typography>
        <Chip size="small" variant="outlined" label={character.center
          ? `(${character.center.x.toFixed(3)}, ${character.center.y.toFixed(3)})` : character.position} />
        {character.isTemporarilyDisabled && <Chip size="small" color="warning" label={t('painting.workspace.parameters.temporarilyDisabled')} />}
      </Box>
      <Typography variant="caption" color="text.secondary">{t('painting.tools.notebook.positivePrompt')}</Typography>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mb: 1 }}>
        {character.prompt || t('painting.tools.notebook.emptyValue')}
      </Typography>
      {character.uc && <>
        <Typography variant="caption" color="text.secondary">{t('painting.tools.notebook.negativePrompt')}</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{character.uc}</Typography>
      </>}
    </Paper>
  ));
}
