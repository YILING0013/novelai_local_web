"use client";

import { useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonBase, CircularProgress, Collapse, Drawer, IconButton, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import TutorialDemoWorkspace from './TutorialDemoWorkspace';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CollectionsOutlinedIcon from '@mui/icons-material/CollectionsOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useI18n } from '@/i18n/I18nProvider';
import { DRAWING_TUTORIALS, RESTRICTED_GUIDES, TUTORIAL_CATALOG, TUTORIAL_TOPICS } from '@/content/tutorials.mjs';

const MODULE_ICONS = { promptEditor: EditNoteOutlinedIcon, promptNotebook: MenuBookOutlinedIcon,
  drawingImages: CollectionsOutlinedIcon, drawingJobs: TuneOutlinedIcon, drawingWorks: AccountTreeOutlinedIcon };

// 每篇教程单独打包；只有打开的一篇会下载并挂载，切换后上一篇随之卸载。
const TOPIC_LOADERS = {
  collapse: () => import('./topics/CollapseTopic'),
  preview: () => import('./topics/PreviewTopic'),
  translation: () => import('./topics/TranslationTopic'),
  comments: () => import('./topics/CommentsTopic'),
  weights: () => import('./topics/WeightsTopic'),
  suggestions: () => import('./topics/SuggestionsTopic'),
  random: () => import('./topics/RandomTopic'),
  notebook: () => import('./topics/NotebookTopic'),
};

function TutorialNav({ current, onSelect, folded, onFold }) {
  const { t } = useI18n();
  return <Box component="nav" aria-label={t('tutorials.contents')} sx={{ py: 2 }}>
    {TUTORIAL_CATALOG.map((page) => <Box key={page.id} sx={{ mb: 2 }}>
      <ButtonBase aria-expanded={!folded[page.id]} aria-controls={`tutorial-page-${page.id}`} onClick={() => onFold(page.id)}
        sx={{ width: '100%', px: 2, py: 1, justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 650, color: 'text.secondary' }}>
        {t(`tutorials.nav.${page.id}`)}
        <ChevronRightIcon sx={{ fontSize: 16, transform: folded[page.id] ? undefined : 'rotate(90deg)' }} />
      </ButtonBase>
      <Collapse in={!folded[page.id]} id={`tutorial-page-${page.id}`}>
      {page.modules.map((group) => {
        const Icon = MODULE_ICONS[group.id];
        return <Box key={group.id} sx={{ mb: 1.25 }}>
          <ButtonBase id={`tutorial-module-${group.id}`} aria-expanded={!folded[group.id]}
            aria-controls={`tutorial-topics-${group.id}`} onClick={() => onFold(group.id)}
            sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, px: 2, py: 0.75, fontSize: '0.875rem', fontWeight: 600 }}>
            <Icon sx={{ fontSize: 18, color: 'primary.main' }} />{t(`tutorials.nav.${group.id}`)}
            <ChevronRightIcon sx={{ ml: 'auto', fontSize: 16, transform: folded[group.id] ? undefined : 'rotate(90deg)' }} />
          </ButtonBase>
          <Collapse in={!folded[group.id]} id={`tutorial-topics-${group.id}`}>
          <Box component="ul" aria-labelledby={`tutorial-module-${group.id}`} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {group.topics.map((topic) => {
              const selected = topic.id === current;
              return <li key={topic.id}>
                <ButtonBase data-tutorial-topic={topic.id} onClick={() => onSelect(topic.id)} aria-current={selected ? 'page' : undefined}
                  sx={{ display: 'block', width: '100%', textAlign: 'left', py: 0.75, pl: 5.25, pr: 2, fontSize: '0.875rem', lineHeight: 1.5,
                    position: 'relative', color: selected ? 'primary.main' : 'text.secondary', fontWeight: selected ? 600 : 400,
                    bgcolor: selected ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                    '&::before': { content: '""', position: 'absolute', left: 25, top: 6, bottom: 6, width: 2, borderRadius: 1,
                      bgcolor: selected ? 'primary.main' : 'divider' },
                    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
                  {t(`tutorials.topics.${topic.id}`)}
                </ButtonBase>
              </li>;
            })}
          </Box>
          </Collapse>
        </Box>;
      })}
      </Collapse>
    </Box>)}
  </Box>;
}

/**
 * 文档式教程页：左侧按页面、模块、篇目列出目录，右侧只加载当前一篇。
 * @param {object} props onStartGuide 打开工作台并开始指定引导；restrictedAccount 表示账号没有笔记、翻译页签和随机提示词。
 * @returns {React.ReactElement} 教程目录和正文。
 */
export default function TutorialsPage({ active = true, restrictedAccount }) {
  const { t } = useI18n();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const [current, setCurrent] = useState(TUTORIAL_TOPICS[0].id);
  const [loaded, setLoaded] = useState({ id: null, Topic: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [folded, setFolded] = useState({});
  const contentRef = useRef(null);
  const [practice, setPractice] = useState(null);
  const returnOffset = useRef(null);

  useEffect(() => {
    if (!active || practice || !contentRef.current || returnOffset.current === null) return;
    contentRef.current.scrollTop = returnOffset.current;
    returnOffset.current = null;
  }, [active, practice]);

  useEffect(() => {
    let active = true;
    setLoaded({ id: current, Topic: null, failed: false });
    const load = DRAWING_TUTORIALS.includes(current) ? () => import('./topics/DrawingTopic') : TOPIC_LOADERS[current];
    load()
      .then((chunk) => { if (active) setLoaded({ id: current, Topic: chunk.default, failed: false }); })
      .catch((error) => {
        // 发布后旧页面可能取不到新版本的分包，提示用户重新加载。
        console.error('Tutorial chunk failed to load:', error);
        if (active) setLoaded({ id: current, Topic: null, failed: true });
      });
    return () => { active = false; };
  }, [current, attempt]);

  const select = (id) => {
    const selected = TUTORIAL_TOPICS.find((item) => item.id === id);
    setFolded((old) => ({ ...old, [selected.page]: false, [selected.module]: false }));
    setCurrent(id);
    setNavOpen(false);
    contentRef.current.scrollTop = 0;
  };
  const position = TUTORIAL_TOPICS.findIndex((topic) => topic.id === current);
  const topic = TUTORIAL_TOPICS[position];
  const previous = TUTORIAL_TOPICS[position - 1];
  const next = TUTORIAL_TOPICS[position + 1];
  const { Topic } = loaded;
  const nav = <TutorialNav current={current} onSelect={select} folded={folded}
    onFold={(id) => setFolded((old) => ({ ...old, [id]: !old[id] }))} />;

  if (practice) return <TutorialDemoWorkspace key={practice} topic={practice} demonstration={false} onClose={() => setPractice(null)} />;
  return <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
    {wide ? <Box sx={{ width: 248, flexShrink: 0, overflowY: 'auto', borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 2.5, fontSize: '1.125rem', fontWeight: 650, color: 'primary.main' }}>
        <SchoolOutlinedIcon />{t('pages.tutorials')}
      </Typography>
      {nav}
    </Box> : <Drawer open={navOpen} onClose={() => setNavOpen(false)} PaperProps={{ sx: { width: 'min(300px, 86vw)' } }}>{nav}</Drawer>}

    <Box ref={contentRef} sx={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <Box component="article" aria-labelledby="tutorial-title" sx={{ width: '100%', maxWidth: 1440, mx: 'auto',
        boxSizing: 'border-box', px: { xs: 2, sm: 4, xl: 6 }, pt: { xs: 1.5, sm: 3 }, pb: 6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5, minHeight: 32, color: 'text.secondary', fontSize: '0.8125rem' }}>
          {!wide && <IconButton edge="start" size="small" aria-label={t('tutorials.contents')} onClick={() => setNavOpen(true)}><MenuOpenIcon /></IconButton>}
          <span>{t(`tutorials.nav.${topic.page}`)}</span>
          <ChevronRightIcon sx={{ fontSize: 16 }} />
          <span>{t(`tutorials.nav.${topic.module}`)}</span>
        </Box>
        <Typography id="tutorial-title" component="h1" sx={{ mb: 1.5, fontSize: { xs: '1.5rem', sm: '1.75rem' }, fontWeight: 700, lineHeight: 1.3 }}>
          {t(`tutorials.topics.${current}`)}
        </Typography>

        {loaded.failed ? <Box role="alert" sx={{ py: 4 }}>
          <Typography color="text.secondary">{t('tutorials.loadFailed')}</Typography>
          <Button sx={{ mt: 1 }} onClick={() => setAttempt((value) => value + 1)}>{t('tutorials.retry')}</Button>
        </Box> : Topic && loaded.id === current
          ? <Topic key={current} topic={current} onStartGuide={(id) => {
            returnOffset.current = contentRef.current.scrollTop;
            setPractice(id);
          }} unavailable={restrictedAccount && RESTRICTED_GUIDES.includes(topic.guide)} />
          : <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 6, color: 'text.secondary' }}>
            <CircularProgress size={20} />{t('tutorials.loading')}
          </Box>}

        <Box component="nav" aria-label={t('tutorials.contents')} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 6, pt: 2.5, borderTop: 1, borderColor: 'divider' }}>
          {[previous, next].map((item, index) => item ? <ButtonBase key={item.id} onClick={() => select(item.id)}
            sx={{ gridColumn: index + 1, display: 'flex', flexDirection: 'column', alignItems: index ? 'flex-end' : 'flex-start', gap: 0.25,
              p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5, textAlign: index ? 'right' : 'left',
              '&:hover': { borderColor: 'primary.main' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
              {!index && <ChevronLeftIcon sx={{ fontSize: 16 }} />}{t(index ? 'tutorials.next' : 'tutorials.previous')}{index ? <ChevronRightIcon sx={{ fontSize: 16 }} /> : null}
            </Typography>
            <Typography variant="body2" fontWeight={600}>{t(`tutorials.topics.${item.id}`)}</Typography>
          </ButtonBase> : <span key={index} />)}
        </Box>
      </Box>
    </Box>
  </Box>;
}
