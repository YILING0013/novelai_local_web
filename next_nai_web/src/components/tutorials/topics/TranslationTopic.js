"use client";

import { useState } from 'react';
import { Box } from '@mui/material';
import EnhancedPreview from '@/components/ai-painting/PromptEditor/EnhancedPreview';
import { PromptTranslationFeedback } from '@/components/ai-painting/PromptEditor/usePromptTranslationPreview';
import { getPreviewTagRanges } from '@/components/ai-painting/PromptEditor/previewTags.mjs';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/translation.mjs';
import { GuideBlock, INLINE_TEXT_STYLE, TopicLayout } from '../TutorialKit';

// 固定的示例释义：英文标签译成中文，中文短语译成英文，与「自动」目标语言一致。
const SAMPLE = '1girl, silver hair, 提着灯笼, night sky, 樱花';
const MEANINGS = { '1girl': '一个女孩', 'silver hair': '银发', '提着灯笼': 'holding a lantern', 'night sky': '夜空', '樱花': 'cherry blossoms' };
const TAGS = getPreviewTagRanges(SAMPLE);
const noop = () => {};

function MeaningSandbox() {
  const [active, setActive] = useState(null);
  const show = (element, pinned) => {
    if (!element) { if (!active?.pinned) setActive(null); return; }
    const tag = TAGS.find((item) => item.start === Number(element.dataset.previewStart));
    setActive((old) => pinned && old?.pinned && old.start === tag.start ? null
      : { ...tag, original: SAMPLE.slice(tag.start, tag.end), anchor: element, pinned });
  };
  return <Box sx={{ maxWidth: 620, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.input' }}>
    <EnhancedPreview text={SAMPLE} tags={TAGS} translations={MEANINGS} activeTag={active} textStyle={INLINE_TEXT_STYLE}
      previewProps={{
        onClick: (event) => show(event.target.closest('[data-preview-translation]'), true),
        onMouseMove: (event) => { if (window.matchMedia('(hover: hover)').matches) show(event.target.closest('[data-preview-translation]'), false); },
        onMouseLeave: () => { if (!active?.pinned) setActive(null); },
        onKeyDown: (event) => {
          if (event.key === 'Escape') setActive(null);
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            show(event.target.closest('[data-preview-translation]'), true);
          }
        },
        onBlur: () => setActive(null),
      }} />
    <PromptTranslationFeedback preview={{ active, translations: MEANINGS, tooltipId: 'tutorial-translation-sandbox',
      showError: false, dismissError: noop, retry: noop, disable: noop }} />
  </Box>;
}

/** 教程：标签释义和整段翻译。 */
export default function TranslationTopic({ onStartGuide, unavailable }) {
  const { locale } = useI18n();
  const copy = content[locale];
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'translation'} />}
    tryIt={<MeaningSandbox />}
    guide={<GuideBlock guide="translation" text={copy.guide} onStartGuide={onStartGuide} unavailable={unavailable} />} />;
}
