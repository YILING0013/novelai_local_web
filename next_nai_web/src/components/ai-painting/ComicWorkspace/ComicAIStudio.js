/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, LinearProgress, MenuItem, Paper, Stack, Tooltip, TextField, Typography } from '@mui/material';
import { AutoAwesome, Download, ExpandMore, PlayArrow, Stop } from '@mui/icons-material';
import { createPortal } from 'react-dom';
import { replaceComicImageText } from './comicLettering.mjs';
import apiClient from '@/utils/ApiClient';
import { downloadUrlToFile, fetchUrlAsBlob } from '@/utils/mediaAssets';
import { createClientId } from '@/utils/browserCapabilities.mjs';
import { useGeneration } from '../Generation/GenerationContext';
import { buildComicAIParams, buildComicAISections, comicAISectionFingerprint, positionComicAIControls, validateComicAIPlan } from './comicAI.mjs';
import ComicAIPlanEditor from './ComicAIPlanEditor';

const initialInput = { model: 'glm-4-6', inputType: 'story', text: '', characters: '', style: '', language: 'zh', readingDirection: 'ltr' };
const terminal = new Set(['completed', 'failed', 'cancelled']);

/** 将生成或本地处理的图片永久嵌入漫画项目，避免刷新后临时地址失效。 */
async function readAIImage(source) {
  const blob = source instanceof Blob ? source : await fetchUrlAsBlob(source);
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
  const image = new Image(); image.src = dataUrl; await image.decode();
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * 统筹故事编排、逐区生成与本地文字重建，所有异步结果固定交付给发起页。
 * @param {object} props 当前页、持久保存及可撤销整页替换回调。
 * @returns {React.ReactElement} 可在桌面和手机操作的漫画制作面板。
 */
export default function ComicAIStudio({ open, actionContainer, onOpenResults, imageModels, page, compact = false, language = 'zh', llmSettings, selectedControl, getPage, onUpdatePage, onApplyResult, onBusyChange, generationBusy = false }) {
  const { generate, isGenerating } = useGeneration();
  const [input, setInput] = useState(initialInput);
  const [workflow, setWorkflow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [job, setJob] = useState(null);
  const resultsRef = useRef(null);
  const [showResults, setShowResults] = useState(false);
  useEffect(() => {
    if (!open || !showResults) return;
    resultsRef.current?.scrollIntoView({ block: 'start' });
    setShowResults(false);
  }, [open, showResults]);
  const [error, setError] = useState('');
  const [opus, setOpus] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const modelSelected = useRef(false);
  const flight = useRef(null);
  const displayedPageId = useRef(null);
  const workflowRef = useRef(null);
  const callbacks = useRef({ getPage, onUpdatePage, onApplyResult, onBusyChange });
  callbacks.current = { getPage, onUpdatePage, onApplyResult, onBusyChange };
  const w = (zh, en) => language === 'zh' ? zh : en;
  const errorMessage = (cause) => `${cause.data?.message || cause.data?.error || cause.message || String(cause)}${cause.errorId ? ` (${cause.errorId})` : ''}`;

  useEffect(() => {
    if (!open || flight.current) return;
    const currentPage = callbacks.current.getPage(page?.id);
    const stored = currentPage?.aiWorkflow || null;
    const savedInput = currentPage?.aiDraft || stored?.sourceInput;
    displayedPageId.current = page?.id;
    modelSelected.current = Boolean(savedInput?.model);
    workflowRef.current = stored; setWorkflow(stored); setInput(savedInput || initialInput); setError(''); setJob(null); setModelReady(false);
    let active = true;
    apiClient.getAccount().then((account) => {
      if (!active) return;
      const subscription = account.account_snapshot?.subscription;
      const activeOpus = subscription?.active === true && Number(subscription.tier) === 3;
      setOpus(activeOpus);
      // 已保存或手动选择的模型不随账户查询覆盖；只有新任务采用订阅默认值。
      if (!modelSelected.current) setInput((current) => ({ ...current, model: activeOpus ? 'xialong-v1' : 'glm-4-6' }));
      setModelReady(true);
    }).catch(() => { if (active) { setOpus(false); setModelReady(true); } });
    return () => { active = false; };
  }, [open, page?.id]);

  useEffect(() => {
    if (!open || busy || displayedPageId.current === page?.id) return;
    const currentPage = callbacks.current.getPage(page?.id);
    const stored = currentPage?.aiWorkflow || null;
    const savedInput = currentPage?.aiDraft || stored?.sourceInput;
    displayedPageId.current = page?.id;
    modelSelected.current = Boolean(savedInput?.model);
    workflowRef.current = stored; setWorkflow(stored); setInput(savedInput || { ...initialInput, model: opus ? 'xialong-v1' : 'glm-4-6' }); setError(''); setJob(null);
  }, [busy, open, page?.id, opus]);

  useEffect(() => {
    if (!open || busy || flight.current || displayedPageId.current !== page?.id) return;
    // 撤销/重做也会还原工作流，面板跟随当前页，避免继续使用撤销前的旧结果。
    const restored = page?.aiWorkflow || null;
    if (restored !== workflowRef.current) { workflowRef.current = restored; setWorkflow(restored); }
  }, [page?.aiWorkflow, page?.id, open, busy]);

  useEffect(() => {
    if (!open || busy || !displayedPageId.current) return;
    const pageId = displayedPageId.current;
    const timer = setTimeout(() => {
      void callbacks.current.onUpdatePage(pageId, (current) => current.aiDraft === input ? current : { ...current, aiDraft: input })
        .catch((cause) => setError(cause.message));
    }, 400);
    return () => clearTimeout(timer);
  }, [input, open, busy]);

  useEffect(() => () => {
    const current = flight.current;
    if (!current) return;
    current.cancelled = true;
    if (current.jobId) void apiClient.request(`/local/inference/jobs/${current.jobId}/cancel`, { method: 'POST', keepalive: true }).catch(() => {});
    if (current.batchId) void apiClient.cancelImageBatch(current.batchId, true).catch(() => {});
  }, []);

  async function persist(next, pageId = flight.current?.pageId || displayedPageId.current) {
    const updated = { ...next, updatedAt: Date.now() };
    workflowRef.current = updated; setWorkflow(updated);
    const saved = await callbacks.current.onUpdatePage(pageId, (current) => ({ ...current, aiWorkflow: updated }));
    if (!saved) throw new Error(w('目标页已被删除。已生成图片仍可从本次生成结果或本地图库取回。', 'The target page was deleted. Generated images remain in the session results or local gallery.'));
    return updated;
  }

  async function updateSection(id, changes) {
    const current = workflowRef.current;
    return persist({ ...current, sections: { ...current.sections, [id]: { ...current.sections[id], ...changes } } });
  }

  async function runLocal(body) {
    const current = flight.current;
    let task = await apiClient.request('/local/inference/jobs', { method: 'POST', body: { model_id: 'comic-lettering', device: 'cpu', ...body } });
    current.jobId = task.id; setJob(task);
    while (!terminal.has(task.status)) {
      if (current.cancelled) {
        await apiClient.request(`/local/inference/jobs/${task.id}/cancel`, { method: 'POST' });
        throw new Error(w('已取消；已生成图片仍保留。', 'Cancelled; generated images are retained.'));
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      task = await apiClient.request(`/local/inference/jobs/${task.id}`); setJob(task);
    }
    current.jobId = null;
    if (task.status !== 'completed') throw new Error(task.error?.message || task.error?.code || task.error || task.status);
    return task.result;
  }

  async function rebuild(section, state, record = true, undoToken = null) {
    const current = flight.current;
    if (current.cancelled) return;
    setProgress(w(`第 ${section.id + 1} 区：识别并重建文字`, `Section ${section.id + 1}: rebuilding text`));
    await updateSection(section.id, { status: 'lettering', error: null });
    // 始终从原图处理，人工重新指定对白不会在已经去字的图上重复识别。
    const result = await runLocal({ action: 'comic-lettering', image: state.originalImage.dataUrl,
      dialogues: section.dialogues.map((line) => ({ ...line, direction: line.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb' })),
      reading_direction: workflowRef.current.sourceInput.readingDirection, language: workflowRef.current.sourceInput.language,
      assignments: state.assignments || {} });
    const [cleanedImage, maskImage] = await Promise.all([readAIImage(result.image.url), readAIImage(result.mask.url)]);
    await updateSection(section.id, { result, cleanedImage, maskImage, status: 'pending', pending: true });
    const applied = await callbacks.current.onApplyResult({ pageId: current.pageId, sectionId: section.id, image: cleanedImage,
      originalImage: state.originalImage, result, taskId: state.taskId, expectedFingerprint: state.appliedFingerprint || state.fingerprint, record, undoToken });
    await updateSection(section.id, { pending: !applied.applied, appliedFingerprint: applied.applied ? applied.fingerprint : state.appliedFingerprint,
      status: !applied.applied ? 'pending' : result.blocks.some((block) => block.needsReview) || result.unmatchedDialogueIds.length ? 'needs-review' : 'completed' });
    window.dispatchEvent(new Event('novelai:gallery-updated'));
  }

  async function run(mode, sectionId = null, generationModel = input.imageModel) {
    if (flight.current || isGenerating || generationBusy || !page) return;
    const startingPage = callbacks.current.getPage(page.id);
    if (!startingPage) return;
    const current = { pageId: page.id, cancelled: false, batchId: null, jobId: null, sectionId: null,
      fingerprints: Object.fromEntries(buildComicAISections(startingPage).map((section) => [section.id, comicAISectionFingerprint(startingPage, section.id)])) };
    flight.current = current; setBusy(true); callbacks.current.onBusyChange(true); setError(''); setJob(null);
    try {
      let plan = workflowRef.current?.plan;
      if (mode === 'plan' || mode === 'full') {
        const referenceSnapshot = structuredClone(callbacks.current.getPage(current.pageId));
        delete referenceSnapshot.aiWorkflow;
        const sourceInput = { ...input, sections: buildComicAISections(referenceSnapshot, input.readingDirection) };
        if (!sourceInput.text.trim()) throw new Error(w('请先输入剧情或提示词。', 'Enter a story or prompt first.'));
        await persist({ version: 1, id: createClientId(), sourceInput, referenceSnapshot, plan: null, sections: {} });
        if (mode === 'full') {
          setProgress(w('检查本地文字模型（首次需下载约 303 MB）', 'Checking text models (about 303 MB on first use)'));
          await runLocal({ action: 'load' });
          if (current.cancelled) return;
        }
        const storyModel = llmSettings?.provider && llmSettings.provider !== 'novelai'
          ? `${llmSettings.provider} · ${llmSettings.storyModel || llmSettings.model}`
          : `${sourceInput.model === 'xialong-v1' ? 'Xialong' : 'GLM 4.6'} + GLM 4.6`;
        setProgress(w(`正在写故事、整理画风与人物并设计分镜（${storyModel}）`, `Writing the story, organizing style and characters, and planning panels (${storyModel})`));
        const response = await apiClient.request('/comic/plan', { method: 'POST', body: sourceInput });
        plan = positionComicAIControls(referenceSnapshot, validateComicAIPlan(response.plan, { drawDialogues: mode !== 'plan', model: generationModel }));
        await persist({ ...workflowRef.current, plan });
        if (mode === 'plan' || current.cancelled) return;
      } else {
        // 画框也可能在预览后被移动；生成前采用当前画布显示的约束坐标。
        plan = positionComicAIControls(startingPage, validateComicAIPlan(plan, { forGeneration: !['generate', 'retry', 'ocr', 'replace'].includes(mode), model: generationModel }));
        await persist({ ...workflowRef.current, plan });
        if (!['generate', 'retry', 'ocr', 'replace'].includes(mode)) {
          setProgress(w('检查本地文字模型', 'Checking local text models'));
          await runLocal({ action: 'load' });
          if (current.cancelled) return;
        }
      }
      // 一次固定计划，编辑器在任务结束后才重新开放，避免两张图使用不同版本的台词。
      const sections = plan.sections.filter((section) => sectionId === null || section.id === sectionId).sort((left, right) => left.id - right.id);
      const pendingImages = sections.filter((section) => mode === 'regenerate' || mode === 'retry' || !workflowRef.current.sections[section.id]?.originalImage);
      if (pendingImages.length > 1) current.batchId = createClientId();
      let imageIndex = 0;
      for (const section of sections) {
        if (current.cancelled) break;
        current.sectionId = section.id;
        let state = workflowRef.current.sections[section.id];
        if (mode === 'generate' && state?.originalImage) continue;
        if ((mode === 'ocr' || mode === 'replace') && !state?.originalImage) continue;
        if (mode === 'generate' && (state?.generationFailedWithoutImage || state?.status === 'generating')) {
          throw new Error(w('请检查生成记录，再手动重试该区。', 'Check generation results, then retry this section manually.'));
        }
        let generatedNow = false;
        let undoToken = null;
        if (mode === 'rebuild' && !state?.originalImage) throw new Error(w('尚无原图可重建。', 'Generate an image before rebuilding text.'));
        if (mode === 'regenerate' || mode === 'retry' || !state?.originalImage) {
          if (imageIndex > 0) {
            setProgress(w('等待下一张（15 秒间隔）', 'Waiting 15 seconds before the next image'));
            for (let tick = 0; tick < 30 && !current.cancelled; tick += 1) await new Promise((resolve) => setTimeout(resolve, 500));
            if (current.cancelled) break;
          }
          const target = callbacks.current.getPage(current.pageId);
          if (!target) throw new Error(w('目标页已被删除。', 'The target page was deleted.'));
          const params = { ...buildComicAIParams(section, { characters: plan.characters, model: generationModel }), ...(current.batchId ? { batch_id: current.batchId, index: imageIndex, batch_size: pendingImages.length } : {}) };
          const taskId = createClientId();
          const fingerprint = current.fingerprints[section.id];
          // 新图完整返回前保留旧图、参数和文字结果；请求失败仍可继续重建旧图文字。
          const next = workflowRef.current;
          await persist({ ...next, sections: { ...next.sections, [section.id]: { ...state, status: 'generating', error: null, generationFailedWithoutImage: false } } });
          setProgress(w(`第 ${section.id + 1} 区：生成完整漫画页`, `Section ${section.id + 1}: generating the full page`));
          const generated = await generate(params);
          if (!generated) throw new Error(w('已有生成任务在运行，请稍后重试。', 'Another generation is running. Retry after it finishes.'));
          const originalImage = await readAIImage(generated.cachedBlob || generated.downloadSrc || generated.src);
          // 即使此时取消，也先保存已计费的在途结果，再停止后续推理与生图。
          // 整体替换，避免把旧图的蒙版、对白对应关系或清理结果混入新图。
          const received = workflowRef.current;
          await persist({ ...received, sections: { ...received.sections, [section.id]: {
            params, taskId, fingerprint, originalImage, savedFile: generated.savedFile, seed: generated.seed, status: 'pending', pending: true,
          } } });
          const applied = await callbacks.current.onApplyResult({ pageId: current.pageId, sectionId: section.id, image: originalImage, originalImage,
            taskId, expectedFingerprint: fingerprint });
          await updateSection(section.id, { pending: !applied.applied, appliedFingerprint: applied.applied ? applied.fingerprint : null });
          generatedNow = applied.applied;
          undoToken = applied.undoToken;
          imageIndex += 1;
          state = workflowRef.current.sections[section.id];
          if (generated.saveError) throw new Error(w('原图已保存在漫画项目中，但画廊写入失败；已停止后续生图，请先检查磁盘空间。', 'The project retains the image, but gallery saving failed. Further generation stopped; check disk space.'));
        }
        if (current.cancelled) {
          await updateSection(section.id, { status: 'cancelled' }); break;
        }
        if (['generate', 'retry', 'ocr', 'replace'].includes(mode)) {
          if (mode === 'replace') {
            const lettering = await replaceComicImageText(state.originalImage, state.ocr.lines, state.assignments || {});
            if (current.cancelled) break;
            const applied = await callbacks.current.onApplyResult({ pageId: current.pageId, sectionId: section.id,
              image: lettering.cleanedImage, originalImage: state.originalImage, result: lettering.result,
              taskId: state.taskId, expectedFingerprint: state.appliedFingerprint || state.fingerprint });
            await updateSection(section.id, { ...lettering, pending: !applied.applied,
              appliedFingerprint: applied.fingerprint || state.appliedFingerprint, status: applied.applied ? 'completed' : 'pending' });
          } else {
            try {
              const result = await runLocal({ action: 'comic-lettering', image: state.originalImage.dataUrl,
                dialogues: [], assignments: {}, reading_direction: workflowRef.current.sourceInput.readingDirection,
                language: workflowRef.current.sourceInput.language });
              if (current.cancelled) break;
              // OCR 只读取原图，用户确认替换后才改动画布文字。
              const lines = result.blocks.map(({ ocrText, bounds, direction, confidence }) => ({ text: ocrText, bounds, direction, confidence }));
              await updateSection(section.id, { ocr: { backend: 'native', lines }, assignments: {}, ocrError: '', status: state.pending ? 'pending' : 'completed' });
            } catch (cause) {
              if (current.cancelled) break;
              await updateSection(section.id, { ocrError: cause.message, status: state.pending ? 'pending' : 'completed' });
            }
          }
          continue;
        }
        // 一键流程的原图与文字回填合成一次撤销；单独重建文字仍有自己的撤销记录。
        if (mode === 'rebuild' || mode === 'regenerate' || mode === 'retry' || !state.result) await rebuild(section, state, !generatedNow, undoToken);
      }
    } catch (cause) {
      const message = errorMessage(cause); setError(message);
      if (current.sectionId !== null && workflowRef.current?.sections[current.sectionId]) {
        const state = workflowRef.current.sections[current.sectionId];
        // 生图阶段失败时，服务端可能已经出图，先提醒用户检查画廊再重试。
        try { await updateSection(current.sectionId, { status: current.cancelled ? 'cancelled' : 'failed', error: message,
          generationFailedWithoutImage: state.status === 'generating' }); }
        catch { /* 图片仍保留在内存面板和生成画廊，持久化失败的原始错误已展示。 */ }
      }
    } finally {
      if (current.batchId) await apiClient.cancelImageBatch(current.batchId).catch(() => {});
      flight.current = null; setBusy(false); setProgress(''); callbacks.current.onBusyChange(false);
    }
  }

  async function cancel() {
    const current = flight.current;
    if (!current) return;
    current.cancelled = true; setProgress(w('正在停止后续步骤，在途图片返回后会保存。', 'Stopping subsequent steps; the in-flight image will still be saved.'));
    if (current.jobId) {
      try { await apiClient.request(`/local/inference/jobs/${current.jobId}/cancel`, { method: 'POST' }); }
      catch (cause) { setError(errorMessage(cause)); }
    }
  }

  async function applyPending(sectionId) {
    if (flight.current || isGenerating || generationBusy) return;
    const pageId = displayedPageId.current;
    const pendingWorkflow = workflowRef.current;
    const state = pendingWorkflow.sections[sectionId];
    // 应用也会等待磁盘保存；固定页面和工作流，期间切页或重复点击不能改变交付目标。
    flight.current = { pageId, cancelled: false, batchId: null, jobId: null };
    setBusy(true); callbacks.current.onBusyChange(true); setError('');
    setProgress(w('正在应用已保存结果', 'Applying the saved result'));
    try {
      const applied = await callbacks.current.onApplyResult({ pageId, sectionId, image: state.cleanedImage || state.originalImage,
        originalImage: state.originalImage, result: state.cleanedImage ? state.result : null, taskId: state.taskId, force: true });
      if (!applied.applied) throw new Error(w('请回到任务发起页后应用结果。', 'Return to the task page before applying the result.'));
      await persist({ ...pendingWorkflow, sections: { ...pendingWorkflow.sections, [sectionId]: {
        ...state, pending: false, appliedFingerprint: applied.fingerprint,
        status: state.result?.blocks.some((block) => block.needsReview) || state.result?.unmatchedDialogueIds.length ? 'needs-review' : state.result ? 'completed' : 'cancelled',
      } } }, pageId);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { flight.current = null; setBusy(false); setProgress(''); callbacks.current.onBusyChange(false); }
  }

  const references = workflow?.sourceInput?.sections || (page ? buildComicAISections(page, input.readingDirection) : []);
  const statusText = { generating: w('生图中', 'Generating'), lettering: w('文字处理中', 'Rebuilding'), completed: w('已完成', 'Complete'), 'needs-review': w('待核对文字', 'Review text'), pending: w('待应用', 'Pending'), failed: w('失败，可重试', 'Failed; retry available'), cancelled: w('已停止', 'Stopped') };
  const percentage = job?.total > 0 ? 100 * job.completed / job.total : null;
  const actionsBusy = busy || isGenerating || generationBusy || !modelReady;
  const imageModel = imageModels.find(({ value }) => value === input.imageModel)?.value || imageModels[0]?.value || '';
  const availableSections = workflow?.plan?.sections.filter(({ id }) => !workflow.sections[id]?.originalImage) || [];
  function editInput(changes) { setInput({ ...input, ...changes }); }
  function savePlan(plan) {
    void persist({ ...workflowRef.current, plan: positionComicAIControls(callbacks.current.getPage(displayedPageId.current), plan) })
      .catch((cause) => setError(errorMessage(cause)));
  }
  function editReplacement(sectionId, index, text, direction) {
    const state = workflowRef.current.sections[sectionId];
    void updateSection(sectionId, { assignments: { ...state.assignments, [index]: { action: 'replace', text, direction } } })
      .catch((cause) => setError(errorMessage(cause)));
  }
  const hasResults = Object.values(workflow?.sections || {}).some((state) => state.originalImage);
  const canvasActions = actionContainer && createPortal(<>
    {busy && <Button size="small" startIcon={<Stop />} color="warning" onClick={cancel}>{w('停止后续步骤', 'Stop subsequent steps')}</Button>}
    {availableSections.length > 0 && !busy && <Button size="small" variant="contained" startIcon={<PlayArrow />}
      disabled={actionsBusy || !imageModel} onClick={() => run('generate', null, imageModel)}>
      {availableSections.length > 1 ? w('按顺序生成全部', 'Generate all in order') : w('生成漫画', 'Generate comic')}
    </Button>}
    {hasResults && <Button size="small" onClick={() => { onOpenResults(); setShowResults(true); }}>{w('核对文字', 'Review text')}</Button>}
  </>, actionContainer);

  // 收起侧栏时保留正在运行的工作流，卸载自动伸缩的输入框。
  return <>{canvasActions}{open && <Box data-testid="comic-ai-dock" sx={{ p: compact ? 0 : 1.5, display: compact ? 'flex' : 'block', flexDirection: 'column', height: compact ? '100%' : 'auto', minHeight: 0 }}>
      <Stack spacing={1.5} sx={{ flex: compact ? 1 : undefined, minHeight: 0, overflowY: compact ? 'auto' : 'visible', p: compact ? 1 : 0 }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        {busy && <Box role="status"><Typography variant="body2">{progress}</Typography><LinearProgress sx={{ mt: 0.75 }} /></Box>}
        <TextField select size="small" fullWidth label={w('图像模型', 'Image model')} value={imageModel} disabled={actionsBusy || !imageModels.length}
          onChange={(event) => editInput({ imageModel: event.target.value })}>
          {imageModels.length ? imageModels.map(({ value, label }) => <MenuItem key={value} value={value}>{label}</MenuItem>)
            : <MenuItem value="">{w('当前账号无可用模型', 'No models available for this account')}</MenuItem>}
        </TextField>
        <TextField multiline minRows={compact ? 2 : 4} maxRows={compact ? 6 : 10} label={w('生图提示词或一句剧情', 'Image prompt or story idea')}
          placeholder={w('直接粘贴 NovelAI 原生 prompt，或写下你想画的故事。', 'Paste a NovelAI prompt, or describe the story you want to draw.')}
          value={input.text} disabled={busy} slotProps={{ htmlInput: { maxLength: 200000 } }} onChange={(event) => editInput({ text: event.target.value })} />
        <Accordion disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2">{w('高级补充（可选）', 'Advanced details (optional)')}</Typography></AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.5}>
              <TextField select size="small" fullWidth label={w('输入类型', 'Input type')} value={input.inputType} disabled={busy} onChange={(event) => editInput({ inputType: event.target.value })}><MenuItem value="prompt">{w('NovelAI 原生提示词', 'NovelAI prompt')}</MenuItem><MenuItem value="story">{w('剧情', 'Story')}</MenuItem></TextField>
              {(!llmSettings || llmSettings.provider === 'novelai') && <TextField select size="small" fullWidth label={w('故事模型', 'Story model')} value={input.model} disabled={busy || !modelReady}
                  onChange={(event) => { modelSelected.current = true; setInput({ ...input, model: event.target.value }); }}><MenuItem value="glm-4-6">GLM 4.6</MenuItem><MenuItem value="xialong-v1" disabled={!opus}>Xialong · Opus</MenuItem></TextField>}
              <TextField multiline minRows={2} label={w('人物补充（可选）', 'Character notes (optional)')}
                value={input.characters} disabled={busy} onChange={(event) => editInput({ characters: event.target.value })} />
              <TextField size="small" fullWidth label={w('画风补充（可选）', 'Style notes (optional)')}
                value={input.style} disabled={busy} onChange={(event) => editInput({ style: event.target.value })} />
              <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
                <TextField select size="small" fullWidth label={w('对白语言', 'Dialogue language')} value={input.language} disabled={busy} onChange={(event) => editInput({ language: event.target.value })}>{[['zh', '中文'], ['en', 'English'], ['ja', '日本語']].map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
                <TextField select size="small" fullWidth label={w('阅读方向', 'Reading direction')} value={input.readingDirection} disabled={busy} onChange={(event) => editInput({ readingDirection: event.target.value })}><MenuItem value="ltr">{w('从左到右', 'Left to right')}</MenuItem><MenuItem value="rtl">{w('从右到左', 'Right to left')}</MenuItem></TextField>
              </Stack>
            </Stack>
          </AccordionDetails>
        </Accordion>
        <Box data-comic-plan-actions sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Tooltip title="">
            <span><Button size="small" variant={workflow?.plan ? 'text' : 'contained'} startIcon={<AutoAwesome />}
              disabled={actionsBusy || !input.text.trim()} onClick={() => run('plan')}>
              {w(workflow?.plan ? '重新编排' : '开始编排', workflow?.plan ? 'Replan' : 'Plan comic')}
            </Button></span>
          </Tooltip>
        </Box>
        {workflow?.plan && selectedControl && <ComicAIPlanEditor plan={workflow.plan} selectedControl={selectedControl} selectedOnly language={language} disabled={actionsBusy}
          onChange={savePlan} />}
        {workflow?.plan && <Accordion disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2">{w('编排参数', 'Plan parameters')}</Typography></AccordionSummary>
          <AccordionDetails><ComicAIPlanEditor plan={workflow.plan} onChange={savePlan} referenceSections={references} language={language} disabled={actionsBusy} /></AccordionDetails>
        </Accordion>}
        {Object.keys(workflow?.sections || {}).length > 0 && <Stack ref={resultsRef} spacing={1.25}>
        {workflow.plan?.sections.map((section) => {
          const state = workflow.sections[section.id];
          if (!state) return null;
          const interrupted = !busy && state.status === 'generating';
          const pendingEdits = state.ocr?.lines.some((line, index) => {
            const edit = state.assignments?.[index]?.text?.trim() || '';
            const previous = state.result?.ocrReplacement ? state.result.blocks.find((block) => block.id === String(index))?.text : '';
            return (edit === line.text ? '' : edit) !== (previous || '');
          });
          return <Paper key={section.id} variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" gap={1} alignItems="center"><Typography fontWeight={600}>{w(`第 ${section.id + 1} 区`, `Section ${section.id + 1}`)}</Typography><Chip size="small" label={interrupted ? w('上次任务中断', 'Previous task interrupted') : statusText[state.status] || state.status} /></Stack>
              {interrupted && <Alert severity="warning">{w('刷新中断了任务。请先检查画廊是否已有结果；重新生图会再次消耗额度。', 'The task was interrupted by a reload. Check the gallery before regenerating, which incurs another generation charge.')}</Alert>}
              {state.generationFailedWithoutImage && <Alert severity="warning">{state.originalImage
                ? w('本次原图未返回，原有结果已保留。请先检查画廊是否已有新结果；重试会重新生图并消耗额度。', 'The new original image was not returned; the previous result is retained. Check the gallery for a new result first; retrying generates again and uses credits.')
                : w('本次原图未返回。请先检查画廊是否已有结果；重试会重新生图并消耗额度。', 'The original image for this request was not returned. Check the gallery for a result first; retrying starts a new generation and uses credits.')}</Alert>}
              {state.originalImage && <Box sx={{ maxWidth: 640, position: 'relative', alignSelf: 'center', width: '100%' }}>
                <Box component="img" src={state.originalImage.dataUrl} alt={w('生成原图', 'Original image')} sx={{ display: 'block', width: '100%', height: 'auto' }} />
                {state.ocr?.lines.length > 0 && <svg aria-hidden="true" viewBox={`0 0 ${state.originalImage.width} ${state.originalImage.height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {state.ocr.lines.map(({ bounds }, index) => <g key={index}>
                    <rect {...bounds} fill="none" stroke="#e17a00" strokeWidth={2} />
                    <text x={bounds.x} y={Math.max(14, bounds.y - 3)} fontSize={18} fill="#e17a00" stroke="black" strokeWidth={2} paintOrder="stroke">{index + 1}</text>
                  </g>)}
                </svg>}
              </Box>}
              {state.error && <Alert severity="warning">{state.error}</Alert>}
              {state.ocrError && <Alert severity="warning">{w('本地 OCR 未完成，可重新识别原图。', 'Local OCR did not complete. You can retry on the saved image.')}{' '}{state.ocrError}</Alert>}
              {state.ocr && (state.ocr.lines.length ? <Stack spacing={1.25}>
                {state.ocr.lines.map((line, index) => <Box key={index}>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere', mb: 0.5 }}>{index + 1}. {line.text}</Typography>
                  <TextField fullWidth size="small" label={w('替换文字（留空保留原文）', 'Replacement (blank keeps original)')}
                    disabled={actionsBusy} value={state.assignments?.[index]?.text || ''} slotProps={{ htmlInput: { maxLength: 2000 } }}
                    onChange={(event) => editReplacement(section.id, index, event.target.value, line.direction)} />
                </Box>)}
              </Stack> : <Typography variant="body2">{w('未识别到文字', 'No text detected')}</Typography>)}
              {state.result?.ocrReplacement && state.result.blocks.some((block) => block.needsReview) && <Alert severity="warning">
                {w('以下识别框背景复杂，已保留原文', 'Original text kept in regions with complex backgrounds')} · {state.result.blocks.filter((block) => block.needsReview).map((block) => Number(block.id) + 1).join(', ')}
              </Alert>}
              {state.pending && state.originalImage && <Button variant="contained" disabled={actionsBusy} onClick={() => applyPending(section.id)}>{w('替换画布中的当前分区', 'Replace current canvas section')}</Button>}
              {pendingEdits && !state.pending && <Button variant="contained" disabled={actionsBusy} onClick={() => run('replace', section.id)}>{w('应用文字替换', 'Apply text replacements')}</Button>}
              <Stack direction="row" flexWrap="wrap" gap={0.25}>
                {state.originalImage && <>
                  <Button size="small" disabled={actionsBusy} onClick={() => run('ocr', section.id)}>{state.ocr ? w('重新识别', 'Recognize again') : w('识别文字', 'Recognize text')}</Button>
                  <Button size="small" startIcon={<Download />} onClick={() => {
                    void downloadUrlToFile(state.originalImage.dataUrl, `comic-original-${section.id + 1}.png`)
                      .catch(() => setError(w('无法下载原图。', 'Could not download the original image.')));
                  }}>{w('下载原图', 'Download original')}</Button>
                </>}
                <Button size="small" disabled={actionsBusy || !imageModel} color={state.originalImage ? 'inherit' : 'primary'}
                  title={state.originalImage ? w('重新生图会消耗额度', 'Regenerating uses credits') : undefined}
                  onClick={() => run('retry', section.id, imageModel)}>{state.originalImage ? w('重新生成', 'Regenerate') : w('重试生成', 'Retry generation')}</Button>
              </Stack>
            </Stack>
          </Paper>;
        })}</Stack>}
      </Stack>
  </Box>}</>;
}
