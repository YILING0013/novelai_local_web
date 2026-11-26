"use client";

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import InlinePromptInput from '@/components/ai-painting/PromptEditor/InlinePromptInput';
import PublicDemoContext from '@/components/ai-painting/PublicDemoContext';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/suggestions.mjs';
import { GuideBlock, RichText, TopicLayout } from '../TutorialKit';

const noop = () => {};
// 联想触发条件与编辑器相同：搜索符号开头、含汉字，或至少两个字母数字。
function SuggestionSandbox({ copy }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  return <PublicDemoContext.Provider value>
    <Box sx={{ maxWidth: 620 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 2 }}>
        {copy.tryQueries} {copy.queries.map((query) => <Box key={query} component="span" sx={{ mr: 0.75 }}><RichText text={`\`${query}\``} /></Box>)}
      </Typography>
      {/* 传入练习回调会固定使用默认搜索符号，与上表的写法一致。 */}
      <InlinePromptInput value={text} onChange={(event) => setText(event.target.value)} previewEnabled minRows={3} onPracticeChoose={noop}
        placeholder={t('painting.workspace.prompt.positivePlaceholder')} />
    </Box>
  </PublicDemoContext.Provider>;
}

/** 教程：标签联想的查找方式、按键和搜索语法。 */
export default function SuggestionsTopic({ onStartGuide }) {
  const { locale } = useI18n();
  const copy = content[locale];
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'suggestions'} />}
    tryIt={<SuggestionSandbox copy={copy} />}
    guide={<GuideBlock guide="suggestions" text={copy.guide} onStartGuide={onStartGuide} />} />;
}
