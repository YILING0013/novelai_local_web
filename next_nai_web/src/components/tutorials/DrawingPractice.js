'use client';

import { createClientId } from '@/utils/browserCapabilities.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, LinearProgress, Paper, Stack, TextField, useMediaQuery, useTheme } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useI18n } from '@/i18n/I18nProvider';
import { tutorialImages } from '@/content/tutorialImages.mjs';
import MobileGenerationTools from '@/components/ai-painting/MobileGenerationTools';
import { getDrawingLesson } from '@/content/tutorials/drawing.mjs';
import ItemDisplay from '@/components/ai-painting/ItemDisplay';
import ItemPreview from '@/components/ai-painting/ItemPreview';
import ParameterPanel from '@/components/ai-painting/ParameterPanel';
import WorkVersionBar from '@/components/ai-painting/WorkVersionBar';
import { GenerationProvider, useGeneration } from '@/components/ai-painting/Generation/GenerationContext';
import QuickImageAdjustment from '@/components/ai-painting/ImageProcessing/QuickImageAdjustment';
import ErrorSummaryDialog from '@/components/ai-painting/tools/BatchGeneration/ErrorSummaryDialog';
import MetadataDialog from '@/components/ai-painting/tools/ImageTools/MetadataDialog';
import { defaultImagePreviewSettings } from '@/components/ai-painting/tools/ImageTools/previewImageExport';
import { hasFileDrag, readDroppedFiles } from '@/components/ai-painting/tools/ImageTools/previewImageDragData.mjs';
import { extractMetadataFromFile } from '@/components/ai-painting/utils/metadataUtils';
import { createPracticeWorks } from './practiceWorks.mjs';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';
import LessonCoach from './LessonCoach';
import TutorialFileManager from './TutorialFileManager';
import EditorExerciseContext from './EditorExerciseContext';

const MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-5-full'];
const initialParameters = { model: MODELS[0], width: 1024, height: 1024, steps: 23, sampler: 'k_euler', guidanceScale: 5, seed: '' };
const practiceImages = tutorialImages.map((image) => ({
  ...image, metadataStatus: 'ready', metadataSource: image.src, metadata: { ...image, positivePrompt: 'moonlit garden, lanterns' },
}));

/** 用独立的生成上下文在绘图页挂载真实主图、历史、参数和作品控件。 */
export default function DrawingPractice({ topic, onClose, demonstration = false }) {
  const mobile = useMediaQuery(useTheme().breakpoints.down('md'));
  const [settings, setSettings] = useState({ translationEnabled: false });
  const updateSettings = (patch) => setSettings((old) => ({ ...old, ...patch }));
  return <EditorExerciseContext.Provider value={{ topic: 'drawing', settings, updateSettings, notify: () => {} }}>
    <GenerationProvider localUiPreview demoImages={practiceImages} allowedModels={MODELS}>
      <DrawingPracticeContent key={topic === 'imageDrop' ? String(mobile) : topic} mobile={mobile} topic={topic} onClose={onClose} demonstration={demonstration} />
    </GenerationProvider>
  </EditorExerciseContext.Provider>;
}

function DrawingPracticeContent({ topic, mobile, onClose, demonstration = false }) {
  const { t, locale } = useI18n();
  const lesson = getDrawingLesson(topic,mobile);
  const text = lesson[locale];
  const actions = lesson.actions;
  const zh = locale === 'zh-CN';
  const { currentItem, generatedItems, selectItem, appendGeneratedItem, deleteItem } = useGeneration();
  const [step, setStep] = useState(0);

  const [parameters, setParameters] = useState(initialParameters);
  const [prompt, setPrompt] = useState('moonlit garden, lanterns');
  const [expandedPanels, setExpandedPanels] = useState({
    basic: false, otherSettings: false, img2img: false, vibe: false, reference: false, character: false,
  });
  const [inputImage, setInputImage] = useState(null);
  const [previewSettings, setPreviewSettings] = useState(defaultImagePreviewSettings);
  const [metadata, setMetadata] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [keyboardFile, setKeyboardFile] = useState(null);
  const mobileImport = topic === 'imageDrop' && mobile;
  const fileLesson = topic === 'imageDrop' && !mobile;
  const fit = demonstration || topic === 'imageDrop';
  const [adjustment, setAdjustment] = useState(null);
  const [adjustmentPanel, setAdjustmentPanel] = useState(null);
  const [presets, setPresets] = useState([]);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errors, setErrors] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [versionContext, setVersionContext] = useState(null);
  const [versionTarget] = useState(createPracticeWorks);
  const [versionError, setVersionError] = useState(false);
  const fileInputRef = useRef(null);
  const timer = useRef(null);
  const characterPositions = useRef(new Map());
  const done = step >= actions.length;
  const notify = useCallback((event) => {
    if (actions[step] === event) setStep((index) => index === step ? index + 1 : index);
  }, [actions, step]);
  const handleCharacters = useCallback((tabs) => {
    const old = characterPositions.current;
    const positions = new Map(tabs.map((tab, index) => [tab.id ?? index, `${tab.position}:${tab.center?.x}:${tab.center?.y}`]));
    if (positions.size > old.size) notify('addCharacter');
    else if ([...positions].some(([id, position]) => old.has(id) && old.get(id) !== position)) notify('placeCharacter');
    characterPositions.current = positions;
  }, [notify]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (topic !== 'workHistory') return;
    let active = true;
    const seed = async () => {
      const images = tutorialImages.slice(0, 2);
      if (!active) return;
      const first = await versionTarget.createWork({ title: zh ? '月下花园（示例作品）' : 'Moonlit garden (sample)',
        images: [images[0]], parameters: { ...initialParameters, positivePrompt: 'moonlit garden', seed: images[0].seed } });
      await versionTarget.createWorkVersion(first.work.id, {
        parent_id: first.version.id, images: [images[1]], parameters: { ...initialParameters, positivePrompt: 'moonlit garden, lantern', seed: images[1].seed },
      });
    };
    seed().catch(() => { if (active) setVersionError(true); });
    return () => { active = false; };
  }, [topic, versionTarget, zh]);

  const sampleFile = async (item = currentItem ?? tutorialImages[0]) => {
    if (item.cachedBlob instanceof File) return item.cachedBlob;
    const blob = item.cachedBlob || await fetchUrlAsBlob(item.src);
    return new File([blob], 'tutorial.png', { type: blob.type });
  };
  const importToHistory = async (files, action = 'dropHistory') => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const bitmap = await createImageBitmap(file);
      const src = URL.createObjectURL(file);
      appendGeneratedItem({ type: 'image', src, objectUrlToRevoke: src, cachedBlob: file, width: bitmap.width, height: bitmap.height });
      bitmap.close();
      notify(action);
    }
  };
  const openMetadata = async (file, item, importing = false) => {
    const parsed = await extractMetadataFromFile(file);
    const fallback = item && { ...initialParameters, ...item, positivePrompt: prompt };
    setMetadata({ file, value: parsed || fallback, importing });
    notify(importing ? (mobileImport ? 'chooseImportFile' : 'dropDisplay') : 'viewMetadata');
  };
  const updateParameter = (key, value) => {
    setParameters((old) => Object.is(old[key], value) ? old : { ...old, [key]: value });
    const action = { model: 'changeModel', width: 'changeSize', height: 'changeSize', steps: 'changeSteps',
      guidanceScale: 'changeGuidance', seed: 'changeSeed', sampler: 'changeSampler' }[key];
    if (action && parameters[key] !== value && (key !== 'seed' || value !== '')) notify(action);
  };
  const applyParameters = (data, action = 'applyMetadata') => {
    setParameters((old) => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, data[key] ?? value])));
    if (data.positivePrompt !== undefined) setPrompt(data.positivePrompt);
    setMetadata(null);
    notify(action);
  };
  const move = (direction) => {
    if (generatedItems.length < 2) return;
    const index = generatedItems.findIndex((item) => item.id === currentItem?.id);
    selectItem(generatedItems[(index + direction + generatedItems.length) % generatedItems.length].id);
    notify('nextImage');
  };
  const startAdjustment = () => {
    setAdjustment(currentItem);
    if (currentItem) notify('openAdjustment');
  };
  const startSimulation = () => {
    setGenerating(true);
    timer.current = setTimeout(() => {
      setGenerating(false);
      if (topic === 'generationErrors') {
        setErrors([{ errorId: 'a1b2c3d4', jobId: 'tutorial-job', model: MODELS[1], occurredAt: new Date().toISOString(),
          code: 'NETWORK_ERROR', category: 'network', source: 'generation' }]);
        notify('simulateFailure');
      } else {
        appendGeneratedItem({ ...tutorialImages[0], id: createClientId(), seed: parameters.seed || tutorialImages[0].seed });
        notify('simulateGeneration');
      }
    }, 640);
  };
  const keyboardDrop = (event) => {
    if (!keyboardFile || event.target !== event.currentTarget || !['Enter',' '].includes(event.key)) return;
    event.preventDefault();
    const zone=event.currentTarget.querySelector('[data-drop-zone]') || event.currentTarget;
    const transfer=new DataTransfer();
    transfer.items.add(keyboardFile);
    zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    setKeyboardFile(null);
  };
  return <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: fit ? 'hidden' : 'auto' }}>
    <LessonCoach action={actions[step]} title={text.title} status={done ? t('tutorials.editorPractice.done') : step === 0 ? text.lead + ' ' + text.demo[step] : text.demo[step]}
      index={step} total={actions.length} onClose={onClose} />
    <Box sx={{ flex: 1, minHeight:0, minWidth:0, display: 'grid', gap: 1, p:0.5,
      gridTemplateColumns: { xs:'minmax(0,1fr)', md:'minmax(0,1fr) minmax(310px,34%)' },
      gridTemplateAreas: { xs:'"images" "params"', md:fileLesson?'"images files" "images params"':'"images params"' },
      gridTemplateRows:fit ? {xs:'minmax(0,3fr) minmax(0,2fr)',md:fileLesson?'auto minmax(0,1fr)':'minmax(0,1fr)'} : undefined }}>
      {fileLesson && <TutorialFileManager onKeyboardPick={file=>{
        setKeyboardFile(file);
        requestAnimationFrame(()=>document.querySelector('[data-tutorial-drop="display"]')?.focus({preventScroll:true}));
      }}/>}
      <Stack sx={{gridArea:'images', minWidth:0, minHeight:fit?0:460, '& > :not([data-tutorial-drop="display"])':{flexShrink:0}}} spacing={0.5}>
        <WorkVersionBar context={versionContext} disabled={topic !== 'workHistory' || versionError}
          practice={{ store: versionTarget, notify }}
          onChange={setVersionContext} getParameters={() => ({ ...parameters, positivePrompt: prompt })}
          onApply={(version) => applyParameters(version.parameters, 'applyVersion')}
          onContinue={(version, work) => {
            setVersionContext({ work_id: work.id, work_title: work.title, number: version.number, parent_version_id: version.id });
            applyParameters(version.parameters, 'continueVersion');
          }} />
        <Paper variant="outlined" data-tutorial-drop="display" tabIndex={keyboardFile ? 0 : undefined} onKeyDown={keyboardDrop}
          aria-label={fileLesson ? (zh?'主图':'Main preview') : undefined}
          sx={{ position: 'relative', flex: 1, minHeight: fit?0:300, outline: dropActive ? '2px solid' : undefined, outlineColor: 'primary.main' }}
          onDragOver={(event) => { if (hasFileDrag(event.dataTransfer)) { event.preventDefault(); setDropActive(true); } }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault(); setDropActive(false);
            const file = readDroppedFiles(event.dataTransfer).find((entry) => entry.type.startsWith('image/'));
            if (file) void openMetadata(file, null, true);
          }}>
          <ItemDisplay item={currentItem} privacyMode={previewSettings.privacyMode && previewSettings.privacyScope !== 'history'} localUiPreview previewSettings={previewSettings}
            generatedItemsCount={generatedItems.length} onNextItem={() => move(1)} onPreviousItem={() => move(-1)}
            onDeleteItem={currentItem ? () => deleteItem(currentItem.id) : undefined}
            onExerciseAction={notify} imageToolsDisabled hideVideoAction hideRestrictedActions
            onApplyImageParameters={async () => openMetadata(await sampleFile(), currentItem)}
            onActionButtonClick={async () => { await openMetadata(await sampleFile(), currentItem, true); return true; }}
            onAdjustImage={startAdjustment} adjustmentActive={Boolean(adjustment)}
            onUploadAdjustmentImage={(file) => setAdjustment({ id: createClientId(), cachedBlob: file })}
            adjustmentPreview={adjustment && <QuickImageAdjustment key={adjustment.id}
              item={adjustment} panel={adjustmentPanel} previewSettings={previewSettings} presets={presets} onPresetsChange={setPresets}
              onExerciseAction={notify} onClose={() => setAdjustment(null)} onApply={(blob, width, height) => {
                const src = URL.createObjectURL(blob);
                appendGeneratedItem({ type: 'image', src, cachedBlob: blob, objectUrlToRevoke: src, width, height, isComposited: true });
                setAdjustment(null); notify('applyAdjustment');
              }} />}
          />
        </Paper>
        <Box data-tutorial-drop="history" tabIndex={keyboardFile ? 0 : undefined} onKeyDown={keyboardDrop}
          aria-label={fileLesson ? (zh?'图像历史':'Image history') : undefined}>
        <ItemPreview items={generatedItems} currentItemId={currentItem?.id} previewSettings={previewSettings}
          onSelectItem={(id) => { selectItem(id); notify('historySelect'); }} onDeleteItem={deleteItem}
          onSeedCopyAndApply={async (seed) => { if (!demonstration) await navigator.clipboard.writeText(String(seed)); setParameters((old) => ({ ...old, seed })); notify('applySeed'); }}
          onUseItemMetadata={async (item) => openMetadata(await sampleFile(item), item)}
          onImportImages={importToHistory} onExerciseAction={notify} onAdjustImage={startAdjustment} adjustmentActive={Boolean(adjustment)}
          getPreviewFile={() => sampleFile()} getItemPreviewFile={(item) => sampleFile(item)}
          onPreviewSettingsChange={(patch) => {
            setPreviewSettings((old) => ({ ...old, ...patch }));
            if (patch.privacyMode) notify('privacyOn');
            if (patch.privacyScope === 'display') notify('privacyScope');
            if (patch.privacyReveal === 'toggle') notify('privacyReveal');
          }} quickImagePresets={presets}
        />
        </Box>
      </Stack>
      <Stack spacing={1} sx={{ gridArea:'params',minWidth:0,minHeight:0,pb:1,overflow:fit?'hidden':undefined }}>
        <Stack spacing={1} sx={{flex:fit?1:undefined,minHeight:0,overflowY:fit?'auto':undefined,overflowX:fit?'hidden':undefined, '& > *':fit?{flexShrink:0}:undefined}}>
        {adjustment && <Box ref={setAdjustmentPanel} />}
        {!adjustment && <ParameterPanel isolated loadAccountSettings={false} allowedModels={MODELS} disableVideo
          params={parameters} onParamChange={updateParameter} onCharacterTabsChange={handleCharacters} expandedPanels={expandedPanels}
          onExpandedPanelsChange={(panel, expanded) => setExpandedPanels((old) => ({ ...old, [panel]: expanded }))}
          positivePrompt={prompt} fileInputRef={fileInputRef}
          imageImportRequest={inputImage} onImageImportHandled={() => setInputImage(null)}
          renderPromptPanel={(summary, content) => <Stack spacing={1}>
            <TextField multiline minRows={3} fullWidth label={t('painting.workspace.prompt.positiveTab')}
              value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            {summary}
            {content}
          </Stack>} />}
        </Stack>
        {generating && <LinearProgress />}
        <Stack direction="row" spacing={1} sx={{flexShrink:0}}>
          {mobileImport ? <MobileGenerationTools onOpen={()=>notify('openImportTools')}
            onImportFile={file=>openMetadata(file,null,true)} onErrors={()=>setErrorOpen(true)} errorCount={errors.length}/> :
          <IconButton data-tour="openErrors" aria-label={t('painting.workspace.actions.viewErrorDetails')} onClick={() => { setErrorOpen(true); notify('openErrors'); }}>
            <ErrorOutlineIcon fontSize="small" />
          </IconButton>}
          <Button variant="contained" fullWidth disabled={generating} data-tour="simulate" onClick={startSimulation}>
            {topic === 'generationErrors' ? (zh ? '模拟失败' : 'Simulate failure') : (zh ? '模拟生成' : 'Simulate generation')}
          </Button>
        </Stack>
      </Stack>
    </Box>
    <MetadataDialog onExerciseAction={notify} open={Boolean(metadata)} onClose={() => setMetadata(null)} metadata={metadata?.value} imageFile={metadata?.file}
      params={parameters} allowedModels={MODELS} imageActions={metadata?.importing ? ['img2img'] : []} onApply={(data) => applyParameters(data)}
      onUseImage={(target, file) => {
        setMetadata(null); setExpandedPanels((old) => ({ ...old, img2img: true }));
        setInputImage({ id: createClientId(), target, file }); notify('sendImage');
      }} />
    <ErrorSummaryDialog demonstration={demonstration} open={errorOpen} onClose={() => setErrorOpen(false)} errors={errors} onClear={() => setErrors([])}

      onExerciseAction={notify} onReadJob={() => {
        appendGeneratedItem({ ...tutorialImages[1], id: createClientId() });
        notify('recoverSample'); setErrorOpen(false);
      }} />
  </Box>;
}
