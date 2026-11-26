import { useEffect, useId, useState } from 'react';
import { Button, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import LessonCoach from './LessonCoach';
import { SUGGESTION_EXERCISES } from '@/content/tutorials.mjs';

/**
 * 管理绘图输入框里的联想练习，练习文本只存在组件内，结束后直接显示原先的绘图草稿。
 * @param {boolean} active 是否正在进行联想练习。
 * @param {Function} onClose 完成或退出时结束当前引导。
 * @returns {object|null} 当前练习文本、输入回调和显示在输入框上方的操作提示。
 */
export default function useSuggestionPractice(active, onClose) {
  const { t, locale } = useI18n();
  const id = useId();
  const [step, setStep] = useState(0);
  const [value, setValue] = useState('');
  const [inserted, setInserted] = useState('');
  useEffect(() => {
    if (!active) {
      setStep(0);
      setValue('');
      setInserted('');
    }
  }, [active]);
  if (!active) return null;

  const exercise = SUGGESTION_EXERCISES[step];
  const last = step === SUGGESTION_EXERCISES.length - 1;
  const english = locale === 'en-US';
  const query = english && exercise.id === 'scoped' ? '+genshin_impact=fu' : exercise.query;
  const expectedTag = exercise.tag ?? exercise.choices?.at(-1);
  const completedTag = inserted;
  const categoryPath = exercise.choices && /^\+\s*(?:服装|clothing)\s*\+\s*(?:(?:下装|(?:clothing\/)?bottoms)\s*(=))?/i.exec(value.trimStart());
  const hint = exercise.choices
    ? (completedTag || categoryPath?.[1] ? 'within' : categoryPath ? 'children' : 'root')
    : exercise.id;
  const onChoose = (tag) => {
    if (tag.kind === 'tag' && (tag.name === expectedTag || (exercise.tagPrefix && tag.name.startsWith(exercise.tagPrefix)))) {
      setInserted(tag.name);
    }
  };
  const advance = () => {
    if (last) {
      onClose();
      return;
    }
    setStep(step + 1);
    setValue('');
    setInserted('');
  };
  const choice = hint === 'root' ? 'clothing' : hint === 'children' ? 'bottoms' : expectedTag ?? exercise.tagPrefix;
  const match = choice && value && !completedTag ? `[data-suggestion-name^="${choice}"],[data-suggestion-alias$="${choice}"]` : undefined;
  const instructions = <LessonCoach preferredTarget={match} title={t(`tutorials.exercises.${hint}.title`)} action={value && !completedTag ? 'suggestionPick' : 'suggestionInput'}
    status={t(`tutorials.exercises.${hint}.help`, { query })} index={step} total={SUGGESTION_EXERCISES.length} onClose={onClose}
    footer={<Button size="small" variant="contained" disabled={!completedTag} onClick={advance}>{t(last ? 'changelog.guide.finish' : 'changelog.guide.next')}</Button>}>
      <Typography id={`${id}-keys`} sx={{ display: { xs: 'none', md: 'block' } }} variant="caption" color="text.secondary">
        {t('tutorials.practiceKeys')}
      </Typography>
      <Typography display="block" variant="caption" color={completedTag ? 'success.main' : 'text.secondary'} role="status">
        {completedTag ? t('tutorials.inserted', { tag: completedTag }) : t('tutorials.practiceDefaults')}
      </Typography>
    </LessonCoach>;
  return { value, onChange: (event) => setValue(event.target.value), onChoose, instructions,
    descriptionId: `${id}-keys`, readOnly: Boolean(inserted) };
}
