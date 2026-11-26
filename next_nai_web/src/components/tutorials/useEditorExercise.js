import { useCallback, useEffect, useState } from 'react';
import { Typography, useMediaQuery, useTheme } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

import { tutorialImages } from '@/content/tutorialImages.mjs';
import LessonCoach from './LessonCoach';

const tasks = {
  collapse: ['collapse', 'reopen', 'expandEditor', 'applyEditor'],
  preview: ['previewOff', 'previewOn', 'expandEditor', 'overlayPreview', 'applyEditor'],
  translation: ['translationHint', 'translationTab', 'translate', 'applyTranslation'],
  comments: ['expandEditor', 'commentButton', 'uncommentButton', 'commentKey', 'uncommentKey', 'applyEditor'],
  weights: ['wheelWeight', 'keyWeight', 'expandEditor', 'weightButton', 'applyEditor'],
  random: ['openRandom', 'enableRandom', 'addCategory', 'addCollection', 'sampleRandom', 'saveRandom', 'insertRandom', 'resolveRandom'],
  notebook: ['saveNote', 'openNotebook', 'createGroup', 'moveNote', 'filterNotes', 'copyCharacter', 'exportNotes', 'importNotes',
    'applySameModel', 'applySavedModel'],
  suggestions: [],
};
const desktopSteps = new Set(['commentKey', 'uncommentKey', 'wheelWeight', 'keyWeight']);
const touchTasks = Object.fromEntries(Object.entries(tasks).map(([topic, steps]) => [topic, steps.filter((step) => !desktopSteps.has(step))]));
const samples = {
  collapse: 'moonlight, blue hair',
  preview: '1.2::blue hair::, /*red eyes*/, <ran_id="hair"/>',
  translation: 'blue hair, red eyes',
  comments: 'blue hair, red eyes, moonlight',
  weights: 'blue hair, red eyes',
  random: '1girl, smile',
  notebook: 'moonlit garden, lanterns',
};

export const NOTEBOOK_EXAMPLE_CHARACTERS = [{ name: 'Lantern bearer', prompt: 'silver hair, holding a lantern',
  uc: 'hat', position: 'B3', center: { x: 0.317, y: 0.486 } }];
export const NOTEBOOK_EXAMPLE_MODEL = 'nai-diffusion-5-full';

/**
 * 管理绘图编辑器的样例和进度。工具完成真实操作后发出对应事件，练习数据随篇目退出清理。
 * @param {string|null} topic 当前练习编号。
 * @param {Function} close 结束练习的操作。
 * @returns {object|null} 编辑器用的临时状态与练习提示。
 */
export default function useEditorExercise(topic, close, practicing) {
  const { t } = useI18n();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [run, setRun] = useState(null);
  const steps = tasks[topic];
  const sequence = mobile ? touchTasks[topic] : steps;
  const current = run?.topic === topic ? run : null;
  useEffect(() => {
    const cursors = new Map();
    setRun(tasks[topic] ? { topic, text: samples[topic] ?? '', step: 0, tab: 0, translationText: '', translationResult: '', settings: {},
      ...(topic === 'notebook' && {
        notes: [{ title: t('changelog.guide.exampleNote'), image_url: tutorialImages[0].src, text_content1: samples.notebook, text_content2: 'blurry',
          model: NOTEBOOK_EXAMPLE_MODEL, character_position_mode: 'custom', character_tabs: NOTEBOOK_EXAMPLE_CHARACTERS,
          group_id: null, created_at: String(Math.round(Date.now() / 1000)) }],
        groups: [], appliedModel: 'nai-diffusion-4-full', applyModel: false, negativeText: 'blurry',
      }),
      randomConfig: { enabled: topic !== 'random', categories: topic === 'preview' ? [
        { id: 'sample-hair', name: 'hair', items: ['blue hair', 'black hair'], extractCount: 1, extractMode: 'random' },
      ] : [], collections: [] },
      randomCursorStorage: { getItem: (key) => cursors.get(key), setItem: (key, value) => cursors.set(key, value) },
    } : null);
  }, [topic, t]);

  useEffect(() => {
    if (!practicing || (topic !== 'collapse' && topic !== 'preview')) return;
    // 导览里可以随意切换开关。实操从确定的样例布局开始，用户能看到前后差别。
    setRun((old) => old?.topic === topic ? { ...old, settings: { ...old.settings,
      ...(topic === 'collapse' ? { promptCollapsed: false } : { inlinePreview: true, expandedPreview: true, overlayPreview: false }) } } : old);
  }, [practicing, topic]);

  const update = useCallback((patch) => {
    setRun((old) => old?.topic === topic ? { ...old, ...patch } : old);
  }, [topic]);
  const notify = useCallback((action) => {
    if (practicing) setRun((old) => old?.topic === topic && sequence[old.step] === action ? { ...old, step: old.step + 1 } : old);
  }, [topic, sequence, practicing]);
  const updateSettings = (patch) => {
    setRun((old) => {
      if (old?.topic !== topic) return old;
      const action = Object.hasOwn(patch, 'inlinePreview') ? (patch.inlinePreview ? 'previewOn' : 'previewOff')
        : Object.hasOwn(patch, 'promptCollapsed') ? (patch.promptCollapsed ? 'collapse' : 'reopen')
          : Object.hasOwn(patch, 'overlayPreview') ? 'overlayPreview' : null;
      return { ...old, settings: { ...old.settings, ...patch }, step: old.step + Number(practicing && sequence[old.step] === action) };
    });
  };

  if (!steps || !current) return null;
  const done = current.step >= sequence.length;
  const action = sequence[current.step];
  const status = t(done ? 'tutorials.editorPractice.done'
    : `tutorials.editorPractice.${action === 'translationHint' && mobile ? 'translationTap' : action}`);
  const coach = practicing && topic !== 'suggestions' && <LessonCoach action={action} title={t(`tutorials.guides.${topic}`)}
    status={status} index={current.step} total={sequence.length} onClose={close}>
    {current.resolvedPrompt && <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', my: 0.5 }}>{current.resolvedPrompt}</Typography>}
    {topic === 'notebook' && <Typography variant="caption" color="text.secondary">
      {t('tutorials.editorPractice.exerciseModel', { model: current.appliedModel })}
    </Typography>}
  </LessonCoach>;
  return { ...current, action, update, notify, updateSettings, coach };
}
