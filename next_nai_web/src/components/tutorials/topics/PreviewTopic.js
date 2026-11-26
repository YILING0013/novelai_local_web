"use client";

import { useMemo, useState } from 'react';
import { Box, FormControlLabel, Switch } from '@mui/material';
import InlinePromptInput from '@/components/ai-painting/PromptEditor/InlinePromptInput';
import PublicDemoContext from '@/components/ai-painting/PublicDemoContext';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/preview.mjs';
import { GuideBlock, TopicLayout } from '../TutorialKit';

export default function PreviewTopic({ onStartGuide }) {
  const { locale } = useI18n();
  const copy = content[locale];
  // 示例类别让随机标记的悬停预览有内容可看，只在本页内存中使用。
  const randomPromptConfig = useMemo(() => ({ categories: [{ id: 'tutorial-hair', name: copy.category, extractCount: 1,
    extractMode: 'random', weightConfig: { type: 'none' }, items: ['silver hair', 'pink hair', 'black hair'] }], collections: [] }), [copy.category]);
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'preview'} />}
    tryIt={<PreviewSandbox copy={copy} randomPromptConfig={randomPromptConfig} />}
    guide={<GuideBlock guide="preview" text={copy.guide} onStartGuide={onStartGuide} />} />;
}

function PreviewSandbox({ copy, randomPromptConfig }) {
  const { t } = useI18n();
  const [text, setText] = useState(copy.sample);
  const [preview, setPreview] = useState(true);
  return <PublicDemoContext.Provider value>
    <Box sx={{ maxWidth: 620 }}>
      <FormControlLabel control={<Switch checked={preview} onChange={(event) => setPreview(event.target.checked)} />} label={copy.previewLabel} />
      <InlinePromptInput value={text} onChange={(event) => setText(event.target.value)} previewEnabled={preview}
        placeholder={t('painting.workspace.prompt.positivePlaceholder')} randomPromptConfig={randomPromptConfig} minRows={3} />
    </Box>
  </PublicDemoContext.Provider>;
}
