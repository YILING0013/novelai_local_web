"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import ExploreOutlined from '@mui/icons-material/ExploreOutlined';
import { Book as BookIcon, Casino as CasinoIcon, Code as CodeIcon, ExpandMore as ExpandMoreIcon,
  FormatClear as FormatClearIcon, Save as SaveIcon, SettingsOutlined as SettingsIcon } from '@mui/icons-material';
import EnhancedPreview from '@/components/ai-painting/PromptEditor/EnhancedPreview';
import { PROMPT_TEXT_STYLE } from '@/components/ai-painting/PromptEditor/previewTags.mjs';
import { getCaretRect } from '@/components/ai-painting/PromptEditor/usePromptSuggestions';
import { useI18n } from '@/i18n/I18nProvider';

// 与工作台普通输入框相同的字号和行高，演示画面和真实输入框排版一致。
export const INLINE_TEXT_STYLE = { fontSize: '1rem', lineHeight: 1.65 };
const INLINE_MARKUP = /(`[^`]+`|\[\[[^\]]+\]\])/g;

/** 键帽样式；演示画面里按下的键会高亮。 */
export function Kbd({ children, pressed = false }) {
  return <Box component="kbd" sx={{
    display: 'inline-block', minWidth: '1.7em', px: 0.6, mx: 0.25, fontFamily: 'inherit', fontSize: '0.8em', lineHeight: 1.7,
    textAlign: 'center', verticalAlign: 'baseline', border: 1, borderBottomWidth: 2, borderRadius: 0.75,
    borderColor: pressed ? 'primary.main' : 'divider', color: pressed ? 'primary.main' : 'text.primary',
    bgcolor: pressed ? (theme) => alpha(theme.palette.primary.main, 0.12) : 'background.paper',
    transition: 'background-color 120ms, border-color 120ms',
  }}>{children}</Box>;
}

/**
 * 显示教程文案里的行内标记：`代码` 显示为等宽代码，[[Alt]] 显示为键帽。
 * @param {object} props text 为一段文案。
 * @returns {React.ReactNode} 拆好的文字片段。
 */
export function RichText({ text }) {
  return text.split(INLINE_MARKUP).map((part, index) => {
    if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
      return <Box key={index} component="code" sx={{
        px: 0.5, py: 0.125, borderRadius: 0.75, fontFamily: '"Roboto Mono", "Noto Sans Mono", monospace', fontSize: '0.86em',
        bgcolor: (theme) => alpha(theme.palette.text.primary, 0.07), overflowWrap: 'anywhere',
      }}>{part.slice(1, -1)}</Box>;
    }
    if (part.startsWith('[[') && part.endsWith(']]')) return <Kbd key={index}>{part.slice(2, -2)}</Kbd>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/**
 * 按教程内容数据渲染段落、步骤、列表、表格和提示。
 * @param {object} props blocks 为字符串或 { steps | list | table, head | note } 组成的数组。
 * @returns {React.ReactElement[]} 文档正文。
 */
export function DocBlocks({ blocks }) {
  return blocks.map((block, index) => {
    if (typeof block === 'string') {
      return <Typography key={index} sx={{ my: 1.25, lineHeight: 1.75, color: 'text.secondary' }}><RichText text={block} /></Typography>;
    }
    if (block.steps || block.list) {
      return <Box key={index} component={block.steps ? 'ol' : 'ul'} sx={{ my: 1.25, pl: 3, display: 'grid', gap: 0.75,
        color: 'text.secondary', lineHeight: 1.75, '& ::marker': { color: 'primary.main', fontWeight: 600 } }}>
        {(block.steps || block.list).map((item, itemIndex) => <li key={itemIndex}><RichText text={item} /></li>)}
      </Box>;
    }
    if (block.table) {
      return <Box key={index} sx={{ my: 1.75, overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', lineHeight: 1.65,
          '& th, & td': { px: 1.5, py: 1, textAlign: 'left', verticalAlign: 'top', borderBottom: 1, borderColor: 'divider' },
          '& tr:last-of-type td': { borderBottom: 0 },
          '& th': { fontWeight: 600, color: 'text.secondary', bgcolor: 'background.input', whiteSpace: 'nowrap' },
          '& td:first-of-type': { color: 'text.primary', fontWeight: 500, minWidth: 120 },
          '& td': { color: 'text.secondary' } }}>
          {block.head && <thead><tr>{block.head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>}
          <tbody>{block.table.map((row, rowIndex) => <tr key={rowIndex}>
            {row.map((cell, cellIndex) => <td key={cellIndex}><RichText text={cell} /></td>)}
          </tr>)}</tbody>
        </Box>
      </Box>;
    }
    return <Box key={index} role="note" sx={{ my: 1.75, px: 1.75, py: 1.25, borderLeft: 3, borderColor: 'primary.main', borderRadius: 1,
      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.07) }}>
      <Typography variant="body2" sx={{ lineHeight: 1.7 }}><RichText text={block.note} /></Typography>
    </Box>;
  });
}

function DocSection({ title, children }) {
  const id = useId();
  return <Box component="section" aria-labelledby={id} sx={{ mt: 4.5 }}>
    <Typography id={id} component="h2" sx={{ mb: 1.5, pb: 0.75, fontSize: '1.125rem', fontWeight: 650, borderBottom: 1, borderColor: 'divider' }}>
      {title}
    </Typography>
    {children}
  </Box>;
}

// 可交互示例在接近视口时才挂载，没读到的部分不创建编辑器和浮层。
function LazyMount({ children }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setShown(true); }, { rootMargin: '240px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shown]);
  return <Box ref={ref} sx={{ minHeight: shown ? 0 : 180 }}>{shown && children}</Box>;
}

/**
 * 每篇教程共用的版式：导语、演示、说明章节、可交互示例和工作台引导。
 * @param {object} props copy 为当前语言的教程内容；demo、tryIt、guide 为本篇的演示、示例和引导区。
 * @returns {React.ReactElement} 教程正文。
 */
export function TopicLayout({ copy, demo, tryIt, guide }) {
  const { t } = useI18n();
  return <>
    {guide}
    <Typography sx={{ maxWidth: '82ch', fontSize: '1.0625rem', lineHeight: 1.8, color: 'text.primary' }}><RichText text={copy.lead} /></Typography>
    <DocSection title={t('tutorials.sections.demo')}>{demo}</DocSection>
    {copy.sections.map((section) => <DocSection key={section.title} title={section.title}><DocBlocks blocks={section.blocks} /></DocSection>)}
    {tryIt && <DocSection title={t('tutorials.sections.tryIt')}>
      <DocBlocks blocks={[copy.tryIt]} />
      <LazyMount>{tryIt}</LazyMount>
    </DocSection>}
  </>;
}

/**
 * 进入真实工作台的引导入口；受限账号没有对应功能时只显示说明。
 * @param {object} props guide 为引导编号，text 为说明，unavailable 表示当前账号不能使用，children 为附加按钮。
 * @returns {React.ReactElement} 引导说明和按钮。
 */
export function GuideBlock({ guide, text, onStartGuide, unavailable = false }) {
  const { t } = useI18n();
  return <Box sx={{ display: 'flex', gap: 2, alignItems: { sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' },
    p: 2, mb: 2.5, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
    <ExploreOutlined color="primary" sx={{ display: { xs: 'none', sm: 'block' } }} />
    <Typography variant="body2" sx={{ flex: 1, lineHeight: 1.7 }}><RichText text={unavailable ? t('tutorials.guideUnavailable') : text} /></Typography>
    {!unavailable && <Stack direction="row" gap={1} flexWrap="wrap" sx={{ flexShrink: 0 }}>
      <Button variant="contained" startIcon={<PlayArrowRounded />} onClick={() => onStartGuide(guide)}>{t('tutorials.guidedPractice')}</Button>
    </Stack>}
  </Box>;
}

/**
 * 只读的提示词输入框画面：使用真实预览组件绘字，可显示模拟光标和选区。
 * @param {object} props text 文字；caret 光标位置；selection 为 [起点, 终点]；preview 为是否叠加预览；
 *   translations/activeTag 用于显示释义；inputRef 可取得内部 textarea 以定位浮层；actions 为右下角按钮。
 * @returns {React.ReactElement} 与普通输入框外观一致的画面。
 */
export function DemoPrompt({ text, caret, selection, preview = true, translations, activeTag, randomPromptConfig,
  rows = 4, focused = false, inputRef, actions, placeholder }) {
  const localRef = useRef(null);
  const input = inputRef || localRef;
  const [caretBox, setCaretBox] = useState(null);
  useLayoutEffect(() => {
    if (caret == null) { setCaretBox(null); return; }
    const rect = getCaretRect(input.current, caret);
    const box = input.current.getBoundingClientRect();
    setCaretBox({ left: rect.left - box.left, top: rect.top - box.top, height: rect.height });
  }, [text, caret, input]);
  // 选区借用预览的高亮片段显示，不需要让只读输入框获得焦点。
  const selected = selection && selection[0] < selection[1] && { start: selection[0], end: selection[1], key: '\u0000selection' };
  return <Box sx={{ position: 'relative', border: 1, borderColor: focused ? 'primary.main' : 'divider', borderRadius: 1.5, overflow: 'hidden',
    bgcolor: 'background.input', boxShadow: (theme) => focused ? `inset 0 0 0 1px ${theme.palette.primary.main}` : 'none',
    '& [data-prompt-preview] [data-preview-active="true"]': { bgcolor: (theme) => alpha(theme.palette.primary.main, selected ? 0.32 : 0.16) } }}>
    {preview && <Box sx={{ position: 'absolute', inset: 0 }}>
      <EnhancedPreview text={text} overlay textStyle={INLINE_TEXT_STYLE} randomPromptConfig={randomPromptConfig}
        tags={selected ? [selected] : undefined} translations={selected ? { [selected.key]: ' ' } : translations}
        underline={!selected} activeTag={selected || activeTag} />
    </Box>}
    <Box component="textarea" ref={input} readOnly tabIndex={-1} rows={rows} value={text} placeholder={placeholder}
      sx={{ ...PROMPT_TEXT_STYLE, ...INLINE_TEXT_STYLE, display: 'block', height: 'auto', resize: 'none', outline: 'none',
        background: 'transparent', color: preview ? 'transparent' : 'text.primary', '&::placeholder': { color: 'text.secondary', opacity: 1 } }} />
    {caretBox && <Box sx={{ position: 'absolute', left: caretBox.left, top: caretBox.top + 3, width: 1.5, height: caretBox.height - 6,
      bgcolor: 'text.primary', animation: 'tutorialCaret 1s steps(1) infinite', '@keyframes tutorialCaret': { '50%': { opacity: 0 } } }} />}
    {actions && <Stack direction="row" sx={{ position: 'absolute', right: 4, bottom: 4, borderRadius: 1, bgcolor: 'background.input',
      '& .MuiIconButton-root': { width: 30, height: 30 } }}>{actions}</Stack>}
  </Box>;
}

/**
 * 提示词区的标签栏和工具按钮，按钮带 data-demo-target 供演示指针定位。
 * @param {object} props tab 当前页签；collapsed 是否收起；randomOn 随机提示词是否启用；
 *   可交互示例传入 onTabChange/onToggle，并用 sandbox 停用会访问账号的按钮，gear 替换为真实设置菜单。
 * @returns {React.ReactElement} 与工作台相同的标签栏。
 */
export function DemoPromptHeader({ tab = 0, collapsed = false, randomOn = false, onTabChange, onToggle, sandbox = false, gear }) {
  const { t } = useI18n();
  const buttons = [
    ['random', 'painting.workspace.prompt.randomPrompt', CasinoIcon],
    ['notebook', 'painting.workspace.prompt.notebook', BookIcon],
    ['save', 'painting.workspace.prompt.saveToNotebook', SaveIcon],
    ...(gear ? [] : [['gear', 'painting.tools.promptEditor.settings', SettingsIcon]]),
  ];
  return <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 44, gap: 0.5, borderBottom: 1, borderColor: 'divider',
    '& .MuiIconButton-root': { width: 32, height: 36, p: 0.75, flexShrink: 0 }, '& .MuiIconButton-root .MuiSvgIcon-root': { fontSize: 20 } }}>
    <Tabs value={tab} onChange={(event, value) => onTabChange?.(value)} variant="scrollable" scrollButtons={false}
      sx={{ minHeight: 44, minWidth: 0, flex: 1, '& .MuiTabs-indicator': { height: 2 },
        '& .MuiTab-root': { minHeight: 44, minWidth: 48, px: 1, py: 0.5, fontSize: '0.9375rem', fontWeight: 500 } }}>
      {['positiveTab', 'negativeTab', 'translationTab'].map((key, index) => <Tab key={key} data-demo-target={`tab-${index}`}
        disabled={sandbox && index === 2} label={t(`painting.workspace.prompt.${key}`)} />)}
    </Tabs>
    {buttons.map(([name, label, Icon]) => <IconButton key={name} data-demo-target={name} aria-label={t(label)} disabled={sandbox}
      color={name === 'random' && randomOn ? 'primary' : 'default'}><Icon /></IconButton>)}
    {gear}
    <IconButton data-demo-target="chevron" aria-expanded={!collapsed} onClick={onToggle}
      aria-label={t(collapsed ? 'painting.workspace.prompt.expandSection' : 'painting.workspace.prompt.collapseSection')}>
      <ExpandMoreIcon sx={{ transform: collapsed ? 'none' : 'rotate(180deg)', transition: (theme) => theme.transitions.create('transform') }} />
    </IconButton>
  </Box>;
}

/**
 * 大窗口编辑器的工具栏：权重、注释和随机提示词。演示时只显示；可交互示例传入 onWeight/onComment。
 * @param {object} props onWeight(方向) 与 onComment(是否注释) 为点击回调，pressed 为演示中按下的按钮名；
 *   show 为 'weights' 或 'comments' 时只显示这一组按钮。
 * @returns {React.ReactElement} 与大窗口相同的工具栏。
 */
export function DemoEditorToolbar({ onWeight, onComment, pressed, show }) {
  const { t } = useI18n();
  const button = (name, label, content, onClick, color = 'primary') => <Tooltip title={onClick ? t(label) : ''}>
    <IconButton size="small" color={color} data-demo-target={name} aria-label={t(label)}
      onMouseDown={(event) => event.preventDefault()} onClick={onClick}
      sx={{ bgcolor: (theme) => pressed === name ? alpha(theme.palette.primary.main, 0.18) : 'transparent' }}>{content}</IconButton>
  </Tooltip>;
  const weight = (sign) => <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', fontWeight: 700, fontSize: '1rem', lineHeight: 1 }}>
    W{sign}</Box>;
  return <Stack direction="row" alignItems="center" gap={1} sx={{ p: 0.75, mb: 1.25, borderRadius: 2, bgcolor: 'background.input', width: 'fit-content' }}>
    {show !== 'comments' && <>
      {button('weightUp', 'painting.tools.promptEditor.weightUpTooltip', weight('+'), onWeight && (() => onWeight(1)))}
      {button('weightDown', 'painting.tools.promptEditor.weightDownTooltip', weight('−'), onWeight && (() => onWeight(-1)))}
    </>}
    {!show && <Box sx={{ alignSelf: 'stretch', width: '1px', bgcolor: 'divider' }} />}
    {show !== 'weights' && <>
      {button('comment', 'painting.tools.promptEditor.commentTooltip', <CodeIcon />, onComment && (() => onComment(true)), 'secondary')}
      {button('uncomment', 'painting.tools.promptEditor.uncommentTooltip', <FormatClearIcon />, onComment && (() => onComment(false)), 'secondary')}
    </>}
  </Stack>;
}
