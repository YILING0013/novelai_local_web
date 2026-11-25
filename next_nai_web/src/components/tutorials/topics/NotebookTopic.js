"use client";

import { useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import NoteCard from '@/components/ai-painting/NoteBook/NoteCard';
import NoteViewDialog from '@/components/ai-painting/NoteBook/NoteViewDialog';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/notebook.mjs';
import { DemoPrompt, GuideBlock, TopicLayout } from '../TutorialKit';

const DRAFT = 'moonlit garden, night, cherry blossoms, /* rain, */ lantern light';
const SAVED = 'moonlit garden, night, cherry blossoms, lantern light';

// 示例笔记只在本页内存中，不写入账号；字段与笔记接口返回的格式相同。
function exampleNote(copy) {
  return {
    title: copy.noteTitle, model: 'nai-diffusion-5-full', character_position_mode: 'custom',
    text_content1: SAVED, text_content2: 'lowres, blurry', created_at: 1795478400,
    character_tabs: [{ name: copy.character, prompt: 'silver hair, holding a lantern', uc: 'hat, glasses', center: { x: 0.317, y: 0.486 }, position: 'B3' }],
  };
}

// view 和 use 指向真实笔记卡片里的按钮；卡片没有为演示额外加标记。
function NotebookSandbox({ copy, note }) {
  const { t } = useI18n();
  const [viewing, setViewing] = useState(false);
  const [loaded, setLoaded] = useState('');
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 300px) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
    <NoteCard note={note} onUse={() => setLoaded(note.text_content1)} onView={() => setViewing(true)} />
    <Box>
      <Typography variant="caption" color="text.secondary">{copy.loaded}</Typography>
      <DemoPrompt text={loaded} rows={3} placeholder={t('painting.workspace.prompt.positivePlaceholder')} />
    </Box>
    <NoteViewDialog open={viewing} onClose={() => setViewing(false)} note={note} onUse={() => setLoaded(note.text_content1)} />
  </Box>;
}

/** 教程：保存、查看、使用和整理提示词笔记。 */
export default function NotebookTopic({ onStartGuide, unavailable }) {
  const { locale } = useI18n();
  const copy = content[locale];
  const note = useMemo(() => exampleNote(copy), [copy]);
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'notebook'} />}
    tryIt={<NotebookSandbox copy={copy} note={note} />}
    guide={<GuideBlock guide="notebook" text={copy.guide} onStartGuide={onStartGuide} unavailable={unavailable} />} />;
}
