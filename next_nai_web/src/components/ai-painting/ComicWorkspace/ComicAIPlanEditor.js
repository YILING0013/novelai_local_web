"use client";

import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Divider, MenuItem, Stack, TextField, Typography, useTheme } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';

const LABELS = {
  zh: {
    overview: '故事概览', page: '第', pageEnd: '页', panel: '分镜', scene: '场景', appearance: '角色外观',
    globalPrompt: '整页画面提示', negativePrompt: '负面提示', panelSummary: '分镜剧情', instancePrompt: '角色 / 场景画面提示',
    dialogue: '对白文字', narration: '旁白', sfx: '拟声词', horizontal: '横排', vertical: '竖排', direction: '文字方向',
    coordinate: '角色位置', coordinatePreview: '角色位置与参考分镜示意', coordinateError: '请输入 0 到 1 之间的数值',
    reference: '参考分镜', free: '自由编排', instance: '角色 / 场景控制', speaker: '说话人',
    promptHint: '角色固定外观会带入每次出场，画面提示可继续描述镜头、动作和场景。台词在下方统一编辑：入镜对白加入对应角色，画外音、旁白和拟声词加入整页提示。',
    completePromptHint: '下方每次出场提示是完整生图内容；角色外观供核对，换装、发型和动作请在对应出场提示中修改。台词在下方统一编辑。',
    previewHint: '位置示意用于编排参考，最终生成图会完整放回漫画页。', emptyDialogue: '此分镜没有对白。',
    storyDraft: '第一阶段故事原文（只读）', storyDraftHint: '保留第一阶段写出的故事，供核对后续人物与分镜。下方编排的修改不会改变此原文。',
    visualStyle: '画师与画风（提取结果）', writing: '故事', extracting: '画风与人物', formatting: '漫画分镜',
  },
  en: {
    overview: 'Story overview', page: 'Page ', pageEnd: '', panel: 'Panel', scene: 'Scene', appearance: 'Character appearance',
    globalPrompt: 'Page visual prompt', negativePrompt: 'Negative prompt', panelSummary: 'Panel story', instancePrompt: 'Character / scene visual prompt',
    dialogue: 'Dialogue text', narration: 'Narration', sfx: 'Sound effect', horizontal: 'Horizontal', vertical: 'Vertical', direction: 'Text direction',
    coordinate: 'Character position', coordinatePreview: 'Character positions and reference panels', coordinateError: 'Enter a value between 0 and 1',
    reference: 'Reference panels', free: 'Free composition', instance: 'Character / scene controls', speaker: 'Speaker',
    promptHint: 'Each appearance includes the character’s fixed visual description. Use visual prompts for framing, action, and scenery. Edit dialogue below: visible speakers use their character prompt; off-screen speech, narration, and sound effects use the page prompt.',
    completePromptHint: 'Each appearance prompt below is the complete image prompt. The character description is a reference; edit that appearance prompt to change clothing, hairstyle or action. Edit dialogue below.',
    previewHint: 'Positions guide composition. The complete generated image is placed back on the comic page.', emptyDialogue: 'This panel has no dialogue.',
    storyDraft: 'Stage 1 story (read-only)', storyDraftHint: 'The original story is retained for reviewing the characters and panels. Edits below do not change it.',
    visualStyle: 'Artists and style (extracted)', writing: 'Story', extracting: 'Style and characters', formatting: 'Comic panels',
  },
};

/**
 * 展示并编辑漫画编排，不提交模型请求或执行生成；对白仅修改独立的对白记录。
 * @param {{plan:object,onChange:Function,referenceSections?:Array,language?:'zh'|'en',disabled?:boolean}} props 完整编排、修改回调及参考分镜。
 * @returns {React.ReactNode} 可在桌面和手机查看故事、提示词、角色坐标及对白的编辑面板。
 */
export default function ComicAIPlanEditor({ plan, onChange, referenceSections = [], language = 'zh', disabled = false }) {
  const c = LABELS[language];
  const theme = useTheme();
  const [coordinateDrafts, setCoordinateDrafts] = useState({});
  if (!plan) return null;

  function updateSection(sectionId, changes) {
    onChange({ ...plan, sections: plan.sections.map((section) => section.id === sectionId ? { ...section, ...changes } : section) });
  }

  function updateItem(section, collection, id, changes) {
    updateSection(section.id, { [collection]: section[collection].map((item) => item.id === id ? { ...item, ...changes } : item) });
  }

  return <Stack spacing={1.5}>
    {plan.planningModels && <Typography variant="caption" color="text.secondary">{c.writing}: {plan.planningModels.story}{plan.planningModels.extract && <> → {c.extracting}: {plan.planningModels.extract}</>} → {c.formatting}: {plan.planningModels.format}</Typography>}
    {plan.storyDraft && <Accordion disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2">{c.storyDraft}</Typography></AccordionSummary>
      <AccordionDetails>
        <Typography variant="caption" color="text.secondary">{c.storyDraftHint}</Typography>
        <Typography component="div" variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto' }}>{plan.storyDraft}</Typography>
      </AccordionDetails>
    </Accordion>}
    {plan.visualStyle && <Accordion disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2">{c.visualStyle}</Typography></AccordionSummary>
      <AccordionDetails>
        <Typography component="div" variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{plan.visualStyle}</Typography>
      </AccordionDetails>
    </Accordion>}
    <TextField label={c.overview} value={plan.summary} onChange={(event) => onChange({ ...plan, summary: event.target.value })} disabled={disabled} multiline minRows={2} fullWidth size="small" />
    {plan.sections.map((section, sectionIndex) => {
      const references = referenceSections.find((reference) => reference.id === section.id)?.referencePanels || [];
      const pageLabel = `${c.page}${sectionIndex + 1}${c.pageEnd}`;
      const fontSize = Math.max(section.width, section.height) / 34;
      return <Accordion key={section.id} defaultExpanded disableGutters variant="outlined" sx={{ borderRadius: 1, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
            <Typography fontWeight={600}>{pageLabel}</Typography>
            <Typography variant="caption" color="text.secondary">{section.width} × {section.height}</Typography>
            <Chip size="small" variant="outlined" label={`${references.length ? c.reference : c.free} · ${section.panels.length}`} />
            <Chip size="small" variant="outlined" label={`${c.instance} · ${section.instances.length}`} />
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) 200px' }, alignItems: 'start', gap: 2 }}>
              <Stack spacing={1.5}>
                <TextField label={c.globalPrompt} value={section.globalPrompt} onChange={(event) => updateSection(section.id, { globalPrompt: event.target.value })} disabled={disabled} multiline minRows={4} fullWidth size="small" inputProps={{ 'aria-label': `${pageLabel} ${c.globalPrompt}` }} />
                <TextField label={c.negativePrompt} value={section.negativePrompt} onChange={(event) => updateSection(section.id, { negativePrompt: event.target.value })} disabled={disabled} multiline minRows={2} fullWidth size="small" inputProps={{ 'aria-label': `${pageLabel} ${c.negativePrompt}` }} />
                <Typography variant="caption" color="text.secondary">{section.characterPromptsComplete === true ? c.completePromptHint : c.promptHint}</Typography>
              </Stack>
              <Box>
                <Box component="svg" role="img" aria-label={`${pageLabel} ${c.coordinatePreview}`} viewBox={`0 0 ${section.width} ${section.height}`}
                  sx={{ width: '100%', maxHeight: 250, display: 'block', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  {references.map((reference) => <g key={reference.id}>
                    <rect x={(reference.center.x - reference.width / 2) * section.width} y={(reference.center.y - reference.height / 2) * section.height}
                      width={reference.width * section.width} height={reference.height * section.height} fill="none" stroke={theme.palette.text.disabled} strokeWidth={section.width / 300} />
                    <text x={(reference.center.x - reference.width / 2) * section.width + fontSize / 3} y={(reference.center.y - reference.height / 2) * section.height + fontSize}
                      fill={theme.palette.text.secondary} fontSize={fontSize}>{reference.number}</text>
                  </g>)}
                  {section.instances.map((instance, index) => {
                    const panel = section.panels.find((item) => item.id === instance.panelId);
                    const character = plan.characters.find((item) => item.id === instance.characterId);
                    const label = `${c.panel} ${panel?.number ?? ''} · ${character?.name || c.scene}`;
                    const x = instance.center.x * section.width, y = instance.center.y * section.height;
                    return <g key={instance.id}>
                      <title>{`${label}: ${instance.center.x}, ${instance.center.y}`}</title>
                      <circle cx={x} cy={y} r={fontSize * 0.65} fill={theme.palette.primary.main} stroke={theme.palette.background.paper} strokeWidth={section.width / 300} />
                      <text x={x} y={y + fontSize * 0.32} textAnchor="middle" fill={theme.palette.primary.contrastText} fontSize={fontSize}>{index + 1}</text>
                    </g>;
                  })}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{c.previewHint}</Typography>
              </Box>
            </Box>
            <Box>
              {section.panels.map((panel, panelIndex) => {
                const panelLabel = `${pageLabel} · ${c.panel} ${panel.number}`;
                const instances = section.instances.filter((instance) => instance.panelId === panel.id);
                const dialogues = section.dialogues.filter((dialogue) => dialogue.panelId === panel.id).sort((left, right) => left.order - right.order);
                return <Accordion key={panel.id} defaultExpanded={panelIndex === 0} disableGutters elevation={0} sx={{ bgcolor: 'transparent', borderTop: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600}>{c.panel} {panel.number}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{panel.summary}</Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    <Stack spacing={1.5}>
                      <TextField label={c.panelSummary} value={panel.summary} onChange={(event) => updateItem(section, 'panels', panel.id, { summary: event.target.value })} disabled={disabled} multiline minRows={2} fullWidth size="small" inputProps={{ 'aria-label': `${panelLabel} ${c.panelSummary}` }} />
                      {instances.map((instance) => {
                        const character = plan.characters.find((item) => item.id === instance.characterId);
                        const instanceNumber = section.instances.findIndex((item) => item.id === instance.id) + 1;
                        const instanceLabel = `${panelLabel} · ${character?.name || c.scene} ${instanceNumber}`;
                        return <Box key={instance.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                          <Stack spacing={1.25}>
                            <Typography variant="body2" fontWeight={600}>{instanceNumber} · {character?.name || c.scene}</Typography>
                            {character && <Typography variant="caption" color="text.secondary">{c.appearance}：{character.appearance}</Typography>}
                            <TextField label={c.instancePrompt} value={instance.prompt} onChange={(event) => updateItem(section, 'instances', instance.id, { prompt: event.target.value })} disabled={disabled} multiline minRows={3} fullWidth size="small" inputProps={{ 'aria-label': `${instanceLabel} ${c.instancePrompt}` }} />
                            <TextField label={c.negativePrompt} value={instance.negativePrompt} onChange={(event) => updateItem(section, 'instances', instance.id, { negativePrompt: event.target.value })} disabled={disabled} multiline fullWidth size="small" inputProps={{ 'aria-label': `${instanceLabel} ${c.negativePrompt}` }} />
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'start', gap: 1 }}>
                              {['x', 'y'].map((axis) => {
                                const key = `${section.id}:${instance.id}:${axis}`;
                                const draft = coordinateDrafts[key];
                                const invalid = draft !== undefined && (draft.trim() === '' || !Number.isFinite(Number(draft)) || Number(draft) < 0 || Number(draft) > 1);
                                return <TextField key={axis} type="number" label={`${c.coordinate} ${axis.toUpperCase()}`} value={draft ?? instance.center[axis]} disabled={disabled}
                                  error={invalid} helperText={invalid ? c.coordinateError : undefined} size="small" sx={{ flex: '1 1 110px', minWidth: 100 }}
                                  inputProps={{ min: 0, max: 1, step: 0.001, 'aria-label': `${instanceLabel} ${axis.toUpperCase()}` }}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setCoordinateDrafts((current) => ({ ...current, [key]: value }));
                                    if (value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1) updateItem(section, 'instances', instance.id, { center: { ...instance.center, [axis]: Number(value) } });
                                  }} onBlur={() => setCoordinateDrafts((current) => {
                                    const next = { ...current }; delete next[key]; return next;
                                  })} />;
                              })}
                            </Box>
                          </Stack>
                        </Box>;
                      })}
                      <Divider />
                      {dialogues.length ? dialogues.map((dialogue) => {
                        const speaker = plan.characters.find((character) => character.id === dialogue.speakerId);
                        const label = dialogue.type === 'narration' ? c.narration : dialogue.type === 'sfx' ? c.sfx : c.dialogue;
                        const dialogueLabel = `${panelLabel} · ${label} ${dialogue.order}`;
                        return <Stack key={dialogue.id} spacing={1}>
                          <Typography variant="body2" fontWeight={600}>{label} {dialogue.order}{speaker ? ` · ${speaker.name}` : ''}</Typography>
                          <TextField label={label} value={dialogue.text} onChange={(event) => updateItem(section, 'dialogues', dialogue.id, { text: event.target.value })} disabled={disabled} multiline minRows={2} fullWidth size="small" inputProps={{ 'aria-label': dialogueLabel }} />
                          <TextField select label={c.direction} value={dialogue.direction} onChange={(event) => updateItem(section, 'dialogues', dialogue.id, { direction: event.target.value })} disabled={disabled} size="small" sx={{ width: { xs: '100%', sm: 180 } }} inputProps={{ 'aria-label': `${dialogueLabel} ${c.direction}` }}>
                            <MenuItem value="horizontal">{c.horizontal}</MenuItem>
                            <MenuItem value="vertical">{c.vertical}</MenuItem>
                          </TextField>
                        </Stack>;
                      }) : <Typography variant="body2" color="text.secondary">{c.emptyDialogue}</Typography>}
                    </Stack>
                  </AccordionDetails>
                </Accordion>;
              })}
            </Box>
          </Stack>
        </AccordionDetails>
      </Accordion>;
    })}
  </Stack>;
}
