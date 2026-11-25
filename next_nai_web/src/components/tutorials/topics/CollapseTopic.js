"use client";

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Collapse, IconButton, Stack, Tooltip } from '@mui/material';
import { OpenInFull as OpenInFullIcon } from '@mui/icons-material';
import InlinePromptInput from '@/components/ai-painting/PromptEditor/InlinePromptInput';
import PublicDemoContext from '@/components/ai-painting/PublicDemoContext';
import LessonReplay from '../LessonReplay';
import { useI18n } from '@/i18n/I18nProvider';
import content from '@/content/tutorials/collapse.mjs';
import { DemoPromptHeader, GuideBlock, TopicLayout } from '../TutorialKit';

// 大窗口编辑器较大，只在示例里点击展开时才下载。
const ExpandedPromptDialog = dynamic(() => import('@/components/ai-painting/PromptEditor/ExpandedPromptDialog'), { ssr: false });

function CollapseSandbox({ copy }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState(0);
  const [prompts, setPrompts] = useState([copy.sample, copy.sampleNegative]);
  const [editing, setEditing] = useState(false);
  const update = (text) => setPrompts((old) => old.map((value, index) => index === tab ? text : value));
  return <PublicDemoContext.Provider value>
    <Box sx={{ maxWidth: 560, p: { xs: 1.5, sm: 2 }, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
      <DemoPromptHeader sandbox tab={tab} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)}
        onTabChange={(value) => { setTab(value); setCollapsed(false); }} />
      <Collapse in={!collapsed}>
        <Box sx={{ pt: 1.5 }}>
          <InlinePromptInput key={tab} value={prompts[tab]} onChange={(event) => update(event.target.value)} previewEnabled minRows={4}
            placeholder={t(tab ? 'painting.workspace.prompt.negativePlaceholder' : 'painting.workspace.prompt.positivePlaceholder')} />
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 0.5 }}>
            <Tooltip title={t('painting.workspace.prompt.expandEditor')}>
              <IconButton size="small" aria-label={t(tab ? 'painting.workspace.prompt.expandNegativeEditor' : 'painting.workspace.prompt.expandPositiveEditor')}
                onClick={() => setEditing(true)}><OpenInFullIcon fontSize="small" /></IconButton>
            </Tooltip>
          </Stack>
        </Box>
      </Collapse>
    </Box>
    {editing && <ExpandedPromptDialog open onClose={() => setEditing(false)} initialText={prompts[tab]} onTextChange={update}
      title={t(tab ? 'painting.workspace.prompt.editNegative' : 'painting.workspace.prompt.editPositive')}
      isPositive={tab === 0} model="nai-diffusion-5-full" restrictedAccount />}
  </PublicDemoContext.Provider>;
}

/** 教程：提示词区的收起、展开和大窗口编辑器。 */
export default function CollapseTopic({ onStartGuide }) {
  const { locale } = useI18n();
  const copy = content[locale];
  return <TopicLayout copy={copy}
    demo={<LessonReplay topic={'collapse'} />}
    tryIt={<CollapseSandbox copy={copy} />}
    guide={<GuideBlock guide="collapse" text={copy.guide} onStartGuide={onStartGuide} />} />;
}
