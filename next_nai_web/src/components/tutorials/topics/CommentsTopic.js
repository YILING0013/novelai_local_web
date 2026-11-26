"use client";

import { useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import InlinePromptInput from '@/components/ai-painting/PromptEditor/InlinePromptInput';
import { commentText, extractActiveContent, uncommentText } from '@/components/ai-painting/PromptEditor/promptUtils';
import PublicDemoContext from '@/components/ai-painting/PublicDemoContext';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/comments.mjs';
import { DemoEditorToolbar, GuideBlock, TopicLayout } from '../TutorialKit';

// 演示结果直接由工作台的注释函数算出，与真实按钮行为一致。
const BASE = '1girl, blue hair, smile, red eyes';
function SentText({ label, text, highlight }) {
  return <Box sx={{ mt: 1.25, px: 1.5, py: 1, borderRadius: 1.5, border: 1, borderColor: highlight ? 'primary.main' : 'divider', bgcolor: 'background.paper',
    transition: 'border-color 200ms' }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography sx={{ fontFamily: '"Roboto Mono", "Noto Sans Mono", monospace', fontSize: '0.875rem', overflowWrap: 'anywhere', minHeight: '1.5em' }}>
      {extractActiveContent(text)}
    </Typography>
  </Box>;
}

function CommentsSandbox({ copy }) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const [text, setText] = useState(BASE);
  const apply = (comment) => {
    const input = inputRef.current;
    const result = (comment ? commentText : uncommentText)(input.value, input.selectionStart, input.selectionEnd);
    setText(result.text);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(result.start, result.end); });
  };
  return <PublicDemoContext.Provider value>
    <Box sx={{ maxWidth: 620 }}>
      <DemoEditorToolbar show="comments" onComment={apply} />
      <InlinePromptInput inputRef={inputRef} value={text} onChange={(event) => setText(event.target.value)} previewEnabled minRows={3}
        placeholder={t('painting.workspace.prompt.positivePlaceholder')} />
      <SentText label={copy.sent} text={text} />
    </Box>
  </PublicDemoContext.Provider>;
}

/** 教程：注释写法和大窗口里的注释按钮。 */
export default function CommentsTopic({ onStartGuide }) {
  const { locale } = useI18n();
  const copy = content[locale];
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'comments'} />}
    tryIt={<CommentsSandbox copy={copy} />}
    guide={<GuideBlock guide="comments" text={copy.guide} onStartGuide={onStartGuide} />} />;
}
