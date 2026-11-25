import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import { useMediaQuery, useTheme } from '@mui/material';
import { getDrawingLesson } from '@/content/tutorials/drawing.mjs';
import { GuideBlock, TopicLayout } from '../TutorialKit';

/** 展示生成页的当前篇目、相关控件和练习入口。 */
export default function DrawingTopic({ topic, onStartGuide }) {
  const { t, locale } = useI18n();
  const lesson = getDrawingLesson(topic, useMediaQuery(useTheme().breakpoints.down('md')));
  const copy = lesson[locale];
  return (
    <TopicLayout
      copy={copy}
      demo={<LessonReplay topic={topic} />}
      guide={<GuideBlock guide={topic} text={t('tutorials.drawingPracticeIntro')} onStartGuide={onStartGuide} />}
    />
  );
}
