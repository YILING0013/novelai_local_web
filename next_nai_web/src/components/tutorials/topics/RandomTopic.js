"use client";

import { useMemo, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Casino as CasinoIcon } from '@mui/icons-material';
import InlinePromptInput from '@/components/ai-painting/PromptEditor/InlinePromptInput';
import { extractActiveContent } from '@/components/ai-painting/PromptEditor/promptUtils';
import PublicDemoContext from '@/components/ai-painting/PublicDemoContext';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/random.mjs';
import { GuideBlock, TopicLayout } from '../TutorialKit';

// 示例只用随机抽取：顺序轮询会把位置写进浏览器，教程页不应留下这类记录。
function demoConfig(copy) {
  return {
    categories: [
      { id: 'tutorial-hair', name: copy.hair, items: ['silver hair', 'pink hair', 'black hair', 'blonde hair'],
        extractCount: 1, extractMode: 'random', weightConfig: { type: 'none' } },
      { id: 'tutorial-weather', name: copy.weather, items: ['rain', 'snow', 'sunset', 'starry sky'],
        extractCount: 1, extractMode: 'random', weightConfig: { type: 'fixed', fixedValue: 1.2 } },
    ],
    collections: [{ id: 'tutorial-scene', name: copy.scene, categoryRefs: [{ categoryId: 'tutorial-hair' }, { categoryId: 'tutorial-weather' }],
      randomOrder: false, useFixedWeight: false }],
  };
}

function Rolls({ label, rolls }) {
  return <Box sx={{ mt: 1.25 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 3, display: 'grid', gap: 0.5, fontFamily: '"Roboto Mono", "Noto Sans Mono", monospace', fontSize: '0.875rem' }}>
      {rolls.map((roll, index) => <li key={index}>{roll}</li>)}
    </Box>
  </Box>;
}

function createCursorStorage() {
  const positions = new Map();
  return { getItem: (key) => positions.get(key), setItem: (key, value) => positions.set(key, value) };
}

function RandomSandbox({ copy, config, prompts }) {
  const { t } = useI18n();
  const [text, setText] = useState(prompts.scene);
  const [rolls, setRolls] = useState([]);
  const [randomCursorStorage] = useState(createCursorStorage);
  return <PublicDemoContext.Provider value>
    <Box sx={{ maxWidth: 620 }}>
      <InlinePromptInput value={text} onChange={(event) => setText(event.target.value)} previewEnabled minRows={2} randomPromptConfig={config}
        placeholder={t('painting.workspace.prompt.positivePlaceholder')} />
      <Button variant="outlined" startIcon={<CasinoIcon />} sx={{ mt: 1.25 }}
        onClick={() => {
          const result = extractActiveContent(text, { processRandomPrompts: true, randomPromptConfig: config, randomCursorStorage });
          setRolls((old) => [result, ...old].slice(0, 5));
        }}>
        {copy.roll}
      </Button>
      {rolls.length > 0 && <Rolls label={copy.rolls} rolls={rolls} />}
    </Box>
  </PublicDemoContext.Provider>;
}

/** 教程：随机提示词的类别、集合、插入和生成效果。 */
export default function RandomTopic({ onStartGuide, unavailable }) {
  const { locale } = useI18n();
  const copy = content[locale];
  const config = useMemo(() => demoConfig(copy), [copy]);
  const prompts = useMemo(() => ({
    hair: `1girl, <ran_id="${copy.hair}"/>, smile`,
    scene: `1girl, <ran_sorting_id="${copy.scene}"/>, smile`,
    weather: `1girl, <ran_id="${copy.weather}"/>, smile`,
  }), [copy]);
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'random'} />}
    tryIt={<RandomSandbox copy={copy} config={config} prompts={prompts} />}
    guide={<GuideBlock guide="random" text={copy.guide} onStartGuide={onStartGuide} unavailable={unavailable} />} />;
}
