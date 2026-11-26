"use client";

import { useRef, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import InlinePromptInput from '@/components/ai-painting/PromptEditor/InlinePromptInput';
import { adjustPromptWeight } from '@/components/ai-painting/PromptEditor/promptWeights.mjs';
import usePromptEditorSettings from '@/components/ai-painting/PromptEditor/usePromptEditorSettings';
import PublicDemoContext from '@/components/ai-painting/PublicDemoContext';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/weights.mjs';
import { DemoEditorToolbar, GuideBlock, TopicLayout } from '../TutorialKit';

// 每一帧都由工作台的调权函数算出，演示与真实快捷键结果一致。
const BASE = '1girl, blue hair, smile';
function WeightsEditor({ copy }) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const [text, setText] = useState(BASE);
  const { defaultWeightMode, weightStep, keepWeightSelection, setSetting } = usePromptEditorSettings();
  const adjust = (direction) => {
    const input = inputRef.current;
    const result = adjustPromptWeight(input.value, input.selectionStart, input.selectionEnd, direction, defaultWeightMode, weightStep);
    if (!keepWeightSelection) result.start = result.end;
    setText(result.text);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(result.start, result.end); });
  };
  return <Box sx={{ maxWidth: 620 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1.25 }}>
      <Typography variant="body2" color="text.secondary" id="tutorial-weight-format">{copy.format}</Typography>
      <ToggleButtonGroup size="small" exclusive value={defaultWeightMode} aria-labelledby="tutorial-weight-format"
        onChange={(event, value) => { if (value) setSetting('defaultWeightMode', value); }}>
        {['numeric', 'brackets'].map((mode) => <ToggleButton key={mode} value={mode} sx={{ textTransform: 'none', px: 1.25 }}>
          {t(`painting.tools.promptEditor.weightModes.${mode}`)}
        </ToggleButton>)}
      </ToggleButtonGroup>
    </Box>
    <DemoEditorToolbar show="weights" onWeight={adjust} />
    <InlinePromptInput inputRef={inputRef} value={text} onChange={(event) => setText(event.target.value)} previewEnabled minRows={3}
      placeholder={t('painting.workspace.prompt.positivePlaceholder')} />
  </Box>;
}

/** 教程：快捷键、按钮和两种权重格式。 */
export default function WeightsTopic({ onStartGuide }) {
  const { locale } = useI18n();
  const copy = content[locale];
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'weights'} />}
    tryIt={<PublicDemoContext.Provider value><WeightsEditor copy={copy} /></PublicDemoContext.Provider>}
    guide={<GuideBlock guide="weights" text={copy.guide} onStartGuide={onStartGuide} />} />;
}
