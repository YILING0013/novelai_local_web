'use client';

import { useState } from 'react';
import { Box, Paper } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import { DRAWING_TUTORIALS } from '@/content/tutorials.mjs';
import PromptPanel from '@/components/ai-painting/PromptPanel';
import ReleaseGuide from '@/components/changelog/ReleaseGuide';
import DrawingPractice from './DrawingPractice';

/** 挂载绘图页的原组件，仅使用练习数据。所有 MUI 弹层均位于当前示例窗口。 */
export default function TutorialDemoWorkspace({ topic }) {
  const { ready } = useI18n();
  const [settings, setSettings] = useState(topic === 'suggestions');
  const [finished, setFinished] = useState(false);
  const [positive, setPositive] = useState('');
  const [negative, setNegative] = useState('');
  const finish = () => setFinished(true);
  if (!ready) return null;
  return (
    <Box
      data-tutorial-demo={topic}
      data-demo-finished={finished}
      sx={{
        height: '100dvh',
        overflow: 'auto',
        bgcolor: 'background.default',
        '& ~ nextjs-portal': { display: 'none' },
      }}
    >
      <style>{`[data-lesson-coach], [data-workspace-guide] { opacity:0; pointer-events:none !important; } nextjs-portal { display:none; }`}</style>
      {DRAWING_TUTORIALS.includes(topic) ? (
        <DrawingPractice topic={topic} demonstration onClose={finish} />
      ) : (
        <Box sx={{ minHeight: '100%', display: 'grid', alignItems: 'center', px: { xs: 1, sm: 3 } }}>
          <Paper variant="outlined" sx={{ width: '100%', maxWidth: 740, mx: 'auto', p: 1 }}>
            <PromptPanel
              demonstration
              loadAccountSettings={false}
              model="nai-diffusion-5-full"
              positivePrompt={positive}
              onPositivePromptChange={setPositive}
              negativePrompt={negative}
              onNegativePromptChange={setNegative}
              promptExerciseTopic={topic}
              promptExerciseActive={!settings}
              releaseGuideActive={settings}
              suggestionPractice={topic === 'suggestions' && !settings}
              onExitSuggestionPractice={finish}
            />
          </Paper>
          {settings && <ReleaseGuide guide="suggestions" onPractice={() => setSettings(false)} onClose={finish} />}
        </Box>
      )}
    </Box>
  );
}
