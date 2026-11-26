'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';

// 同一步可能需要先打开窗口或填表。前面的目标优先，已填好的字段会移除自己的标记。
const input = '[data-release-target="promptInput"] textarea:not([aria-hidden])';
const edit = '[role=dialog] textarea:not([aria-hidden])';
const targets = {
  collapse: ['collapse'],
  reopen: ['expandSection'],
  expandEditor: ['expandEditor'],
  applyEditor: ['applyEditor'],
  previewOff: ['previewEnabled', 'gear'],
  previewOn: ['previewEnabled', 'gear'],
  overlayPreview: ['overlayPreview', 'gear'],
  translationHint: ['[data-preview-translation]'],
  translationTab: ['translationTab'],
  translate: ['translationSource', 'translate'],
  applyTranslation: ['applyTranslation'],
  commentButton: ['commentButton'],
  uncommentButton: ['uncommentButton'],
  commentKey: [edit],
  uncommentKey: [edit],
  wheelWeight: [input],
  keyWeight: [input],
  weightButton: ['weightButton'],
  openRandom: ['random'],
  enableRandom: ['randomEnable', 'random'],
  addCategory: ['categoryName', 'categoryItems', 'categoryParse', 'categorySave', 'categoryAdd', 'random'],
  addCollection: [
    'collectionName',
    'collectionPick',
    'collectionSave',
    'collectionAdd',
    'collectionTab',
    'random',
  ],
  sampleRandom: ['collectionExample', 'collectionExpand', 'collectionTab', 'random'],
  saveRandom: ['exampleClose', 'configSave', 'random'],
  insertRandom: ['collectionInsert', 'collectionExpand', 'collectionTab', 'random'],
  resolveRandom: ['configClose', 'randomResolve'],
  saveNote: ['noteTitle', 'noteSave', 'noteSaveEntry'],
  openNotebook: ['notebook'],
  createGroup: ['groupName', 'groupSave', 'groupAdd', 'mobileGroups', 'notebook'],
  moveNote: ['[role=option]:not([data-value=""])', 'moveGroup', 'moveSave', 'moveEntry', 'noteMenu', 'notebook'],
  filterNotes: ['groupFilter', 'mobileGroups', 'notebook'],
  copyCharacter: ['characterCopy', 'note', 'notebook'],
  exportNotes: ['closePreview', 'exportNotes', 'notebook'],
  importNotes: ['importNotes', 'notebook'],
  applySameModel: ['noteUse', 'notebook'],
  applySavedModel: ['modelOff', 'noteUse', 'notebook'],
  zoomImage: ['zoomImage'],
  panImage: ['[data-tutorial-drop=display] .react-transform-wrapper', '[data-tutorial-drop=display]'],
  resetImage: ['resetImage'],
  nextImage: ['nextImage'],
  viewMetadata: ['use-params'],
  scramble: ['scramble', 'imageTools'],
  unscramble: ['unscramble', 'imageTools'],
  previewSettings: ['dialogClose', 'previewSettings'],
  privacyOn: ['privacyOn'],
  privacyScope: ['[role=option][data-value="display"]', 'privacyScope'],
  privacyReveal: ['[role=option][data-value="toggle"]', 'privacyReveal'],
  revealImage: ['closePreviewSettings', '[data-tutorial-drop=display] .image-privacy-cover'],
  historySelect: ['[data-tutorial-drop=history] img:last-of-type'],
  historyOpen: ['historyOpen'],
  applySeed: ['dialogClose', 'applySeed'],
  applyMetadata: ['metadataApply', 'use-params'],
  dropDisplay: ['sampleDisplay'],
  openImportTools: ['openImportTools'],
  chooseImportFile: ['chooseImportFile', 'openImportTools'],
  sendImage: ['img2img', 'chooseImportFile', 'openImportTools', 'sampleDisplay'],
  dropHistory: ['sampleHistory'],
  openAdjustment: ['openAdjustment'],
  changeAdjustment: ['adjustReadout'],
  compareAdjustment: ['compareAdjustment'],
  applyAdjustment: ['applyAdjustment'],
  changeModel: ['[role=option][data-value="nai-diffusion-5-full"]', '[role=combobox]'],
  changeSize: ['landscape'],
  changeSteps: ['[data-tour-editor=steps] input[type=range]', 'steps'],
  changeGuidance: ['[data-tour-editor=guidanceScale] input[type=range]', 'guidanceScale'],
  changeSeed: ['[data-tour-editor=seed] input:not([type=hidden])', 'seed'],
  changeSampler: ['[role=menuitem]:not(.Mui-selected)', 'sampler'],
  addCharacter: ['characterAdd', 'characterPanel'],
  placeCharacter: ['positionCanvas', 'editPosition', 'customPosition'],
  simulateGeneration: ['simulate'],
  simulateFailure: ['simulate'],
  openErrors: ['openErrors'],
  copyError: ['copyError'],
  recoverSample: ['recoverSample'],
  newWork: ['workTitle', 'workSave', 'workNew'],
  openSampleWork: ['sampleWork', 'workExit', 'workOpen'],
  compareVersion: [
    '[role=option]:not([data-value=""])',
    '[data-blueprint-node][aria-label$="v1"][aria-pressed=false]',
    '[data-tour=versionCompare] [role=combobox]',
    'versionDetails',
    '[data-blueprint-node]',
  ],
  applyVersion: ['applyVersion', 'fullSnapshot', 'versionDetails', '[data-blueprint-node]'],
  continueVersion: [
    '[data-blueprint-node][aria-label$="v1"][aria-pressed=false]',
    'continueVersion',
    'versionDetails',
    '[data-blueprint-node]',
    'sampleWork',
    'workOpen',
  ],
  saveVersion: ['workSave', 'versionSaveEntry'],
  suggestionInput: [input],
  suggestionPick: [input],
};
const hints = {
  adjustReadout: [
    '亮度可以先填 14，再轻点输入框外，观察主图的变化。',
    'Enter 14 for brightness, then tap outside the field to apply it and inspect the preview.',
  ],
  categoryAdd: [
    '点「添加类别」，建一个存放发色词条的类别。',
    'Choose Add category to create a list of hair colors.',
  ],
  categoryName: ['类别名称填「发色」。', 'Name the category Hair.'],
  categoryItems: ['在词条列表输入 silver hair, black hair。', 'Enter silver hair, black hair in the items field.'],
  categoryParse: [
    '点解析按钮，把逗号分隔的文字转成两个词条。',
    'Parse the list to turn the comma-separated text into two tags.',
  ],
  categorySave: ['看到两个词条后，点「保存」。', 'Check the two tags, then save the category.'],
  collectionTab: [
    '点「集合管理」。集合可以引用一个或多个类别。',
    'Open Collections. A collection draws from one or more categories.',
  ],
  collectionAdd: ['点「添加集合」。', 'Choose Add collection.'],
  collectionName: ['给集合起名，例如「人物」。', 'Name the collection, for example Portrait.'],
  collectionPick: [
    '勾选刚建的发色类别，作为这个集合的词条来源。',
    'Select the hair category as a source for this collection.',
  ],
  collectionSave: ['点「保存」，回到集合列表。', 'Save to return to the collection list.'],
  collectionExpand: [
    '点集合名称，展开它的示例和插入按钮。',
    'Expand the collection by its name to reveal Example and Insert.',
  ],
  collectionExample: ['点「示例」，查看本次抽到的发色。', 'Choose Example to draw and inspect a hair color.'],
  exampleClose: ['读完抽取结果后，关闭示例窗口。', 'Read the sampled tag, then close the example window.'],
  configSave: [
    '点「保存配置」，保留刚才建立的类别和集合。',
    'Save the configuration to keep the sample category and collection.',
  ],
  collectionInsert: [
    '点「插入」，把集合标记放进绘图提示词。',
    'Choose Insert to place the collection marker into the drawing prompt.',
  ],
  configClose: ['关闭配置窗口，回到提示词输入框。', 'Close the configuration to return to the prompt field.'],
  noteTitle: ['输入一个笔记名称，例如「灯笼」。', 'Enter a note title such as Lantern.'],
  groupName: ['输入分组名称，例如「角色」。', 'Enter a group name, for example Characters.'],
  moveGroup: ['打开分组下拉框，选择刚创建的分组。', 'Open the group selector and choose the group you created.'],
  noteMenu: ['点笔记右侧的更多操作。', 'Open the note’s More actions menu.'],
  mobileGroups: ['展开分组列表。', 'Expand the groups list.'],
  note: ['点笔记上的查看详情图标，找到角色卡。', 'Open the note details to find its character card.'],
  closePreview: ['关闭笔记详情，回到笔记列表。', 'Close note details to return to the notebook.'],
  modelOff: ['开启「应用笔记时切换模型」，再使用这条笔记。', 'Enable model switching, then apply the note.'],
  characterPanel: ['先展开角色控制面板。', 'Expand the character controls first.'],
  customPosition: ['选择自定义定位，打开坐标画布。', 'Choose custom positioning to open the coordinate canvas.'],
  workTitle: ['为作品输入一个名称。', 'Enter a title for the work.'],
  workExit: ['退出刚创建的作品，回到作品入口。', 'Leave the new work to return to the work picker.'],
  sampleWork: ['选择已有两个版本的月下花园示例作品。', 'Open the Moonlit garden sample with two revisions.'],
  versionDetails: ['展开节点详情，查看版本操作。', 'Expand node details to reveal the version actions.'],
  fullSnapshot: [
    '点「完整参数」，查看这个版本记录的绘图设置。',
    'Open Full snapshot to inspect the settings saved in this revision.',
  ],
  dialogClose: ['关闭当前窗口，继续下一项操作。', 'Close this window to continue with the next control.'],
};
function visible(node) {
  const bounds = node.getBoundingClientRect();
  return (
    bounds.width > 1 &&
    bounds.height > 1 &&
    !node.disabled &&
    !node.closest('.Mui-disabled') &&
    !node.closest('[hidden],[inert],[aria-hidden=true],[data-lesson-coach]') &&
    node.getClientRects().length &&
    getComputedStyle(node).visibility !== 'hidden' &&
    !node.closest('.MuiCollapse-hidden')
  );
}

/** 跟随真实练习事件指向当前控件，包括嵌套窗口、菜单和填表中的下一项。 */
export default function LessonCoach({
  action,
  title,
  status,
  index,
  total,
  onClose,
  children,
  footer,
  preferredTarget,
}) {
  const { t, locale } = useI18n();
  const card = useRef(null);
  const mask = useRef(null);
  const layer = useRef(null);
  const [target, setTarget] = useState(null);
  const [host, setHost] = useState(null);
  useLayoutEffect(() => {
    let tick = 0;
    let typingTimer = 0;
    const locate = () => {
      tick = 0;
      if (typingTimer) return;
      const modal = [...document.querySelectorAll('.MuiModal-root')].filter(visible).at(-1);
      const scope = modal || document;
      let next = null;
      for (const key of [
        ...(preferredTarget ? [preferredTarget] : []),
        ...(targets[action] || []),
        ...(['changeGuidance', 'changeSeed', 'changeSampler', 'simulateGeneration'].includes(action)
          ? ['dialogClose']
          : []),
        ...(action && !action.startsWith('suggestion') ? ['expandSection', 'panel'] : []),
      ]) {
        const selector = key.startsWith('[') ? key : `[data-tour="${key}"],[data-release-target="${key}"]`;
        const searchRoot = key === preferredTarget && action?.startsWith('suggestion') ? document : scope;
        const node = [...searchRoot.querySelectorAll(selector)].find((item) =>
          key === '[data-preview-translation]'
            ? item.getClientRects().length &&
              !item.closest('[hidden], [inert], .MuiCollapse-hidden') &&
              getComputedStyle(item).visibility !== 'hidden'
            : visible(item)
        );
        if (node) {
          next = { key, node };
          break;
        }
      }
      setHost(
        modal?.querySelector('[role=dialog], [role=menu], [role=listbox], .MuiDrawer-paper') || document.body
      );
      setTarget((old) => (old?.node === next?.node && old?.key === next?.key ? old : next));
    };
    const schedule = () => {
      if (!tick) tick = requestAnimationFrame(locate);
    };
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !record.target.closest?.('[data-lesson-coach]'))) schedule();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-tour',
        'aria-hidden',
        'aria-selected',
        'aria-expanded',
        'class',
        'disabled',
        'style',
      ],
    });
    const onInput = (event) => {
      if (!event.target.matches('textarea,input:not([type]),input[type=text]')) {
        schedule();
        return;
      }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        typingTimer = 0;
        schedule();
      }, 550);
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('transitionend', schedule, true);
    locate();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(tick);
      clearTimeout(typingTimer);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('transitionend', schedule, true);
    };
  }, [action, preferredTarget]);
  useLayoutEffect(() => {
    if (!host) return;
    const overlay = layer.current;
    overlay.showPopover?.();
    const node = target?.node;
    // 候选项在输入时会反复挂载。保持输入框与页面滚动位置，避免把视口拉向正在出现的列表。
    const suggesting = action?.startsWith('suggestion');
    const inDemo = Boolean(document.querySelector('[data-tutorial-demo]'));
    if (!inDemo && !suggesting) node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    if (node) node.dataset.tourCurrent = target.key;
    let raf, previous;
    const editorDialog =
      host.matches('[role=dialog]') && host.querySelector('[data-release-target=editorApply]') ? host : null;
    const layout = () => {
      raf = requestAnimationFrame(layout);
      const tip = card.current;
      const canvas = mask.current;
      const scope = host.closest('.MuiModal-root') || document;
      const editing = /^(?:un)?comment(?:Button|Key)$|^(?:weightButton|wheelWeight|keyWeight)$/.test(action);
      const field =
        suggesting || editing
          ? [...scope.querySelectorAll(scope === document ? input : 'textarea:not([aria-hidden])')].find(visible)
          : null;
      const list = suggesting ? [...document.querySelectorAll('[data-suggestion-popup]')].find(visible) : null;
      const dropZone =
        action === 'dropDisplay'
          ? document.querySelector('[data-tutorial-drop=display]')
          : action === 'dropHistory'
            ? document.querySelector('[data-tutorial-drop=history] [data-drop-zone]')
            : null;
      const nodes = [...new Set([field, list, node, dropZone].filter(Boolean))];
      const width = document.documentElement.clientWidth,
        height = innerHeight,
        gap = 10;
      const rects = nodes
        .map((el) => {
          const r = el.getBoundingClientRect();
          // 滚动列表只露出半行时，不把该行的选框画在列表外。
          const clip = el !== list && list?.contains(el) ? list.getBoundingClientRect() : null;
          return {
            l: Math.max(2, (clip?.left ?? 0) + 1, r.left - 3),
            r: Math.min(width - 2, (clip?.right ?? width) - 1, r.right + 3),
            t: Math.max(2, (clip?.top ?? 0) + 1, r.top - 3),
            b: Math.min(height - 2, (clip?.bottom ?? height) - 1, r.bottom + 3),
          };
        })
        .filter((r) => r.r - r.l > 1 && r.b - r.t > 1);
      const w = tip.offsetWidth,
        h = tip.offsetHeight;
      const dock = editing && editorDialog && width < 650 && !document.querySelector('[data-tutorial-demo]');
      if (dock) {
        // 全屏编辑器原本用满可用高度。给引导留出实际空间，让工具栏、正文与底栏都可操作。
        const reserved = h + gap * 2 + 'px';
        if (editorDialog.style.getPropertyValue('--tutorial-editor-footer') !== reserved)
          editorDialog.style.setProperty('--tutorial-editor-footer', reserved);
      } else editorDialog?.style.removeProperty('--tutorial-editor-footer');
      const key = JSON.stringify([width, height, w, h, rects]);
      if (previous === key) return;
      previous = key;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (rects.length) {
        ctx.fillStyle = 'rgba(12,18,28,.23)';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = getComputedStyle(canvas).color;
        ctx.lineWidth = 2;
        // 后出现的候选浮层盖住输入框；先清除它下面的线，再画浮层及其中的词条。
        for (const r of rects) {
          ctx.clearRect(r.l, r.t, r.r - r.l, r.b - r.t);
          ctx.strokeRect(r.l, r.t, r.r - r.l, r.b - r.t);
        }
      }
      // 面板避开输入区、工具按钮及候选列表。没有推荐词时仍以输入框定位。
      const anchor = rects[0];
      const clampX = (x) => Math.max(gap, Math.min(width - w - gap, x));
      const clampY = (y) => Math.max(gap, Math.min(height - h - gap, y));
      const xs = [width - w - gap, gap, ...rects.flatMap((r) => [r.l - w - gap, r.r + gap, r.l])].map(clampX);
      const ys = [height - h - gap, gap, ...rects.flatMap((r) => [r.t - h - gap, r.b + gap, r.t])].map(clampY);
      let best = Infinity,
        chosen = [clampX((width - w) / 2), clampY(height - h - gap)];
      if (anchor && !dock)
        for (const x of xs)
          for (const y of ys) {
            const overlap = rects.reduce(
              (sum, r) =>
                sum +
                Math.max(0, Math.min(x + w, r.r) - Math.max(x, r.l)) *
                  Math.max(0, Math.min(y + h, r.b) - Math.max(y, r.t)),
              0
            );
            const distance = Math.hypot(
              Math.max(0, anchor.l - x - w, x - anchor.r),
              Math.max(0, anchor.t - y - h, y - anchor.b)
            );
            const score =
              overlap * 10000 + distance + Math.abs(y - anchor.t) * 0.03 + Math.abs(x - anchor.l) * 0.01;
            if (score < best) {
              best = score;
              chosen = [x, y];
            }
          }
      tip.style.left = chosen[0] + 'px';
      tip.style.top = chosen[1] + 'px';
    };
    // 演示字幕在播放器中显示，嵌入页只需提供当前操作，不绘制整屏遮罩。
    if (!inDemo) layout();
    return () => {
      cancelAnimationFrame(raf);
      editorDialog?.style.removeProperty('--tutorial-editor-footer');
      if (node) delete node.dataset.tourCurrent;
      if (overlay.isConnected) overlay.hidePopover?.();
    };
  }, [action, target, host]);
  if (!host) return null;
  const hint = hints[target?.key]?.[locale === 'zh-CN' ? 0 : 1];
  return createPortal(
    <Box
      ref={layer}
      popover="manual"
      data-lesson-coach=""
      data-lesson-action={action || 'done'}
      sx={{
        position: 'fixed',
        inset: 0,
        m: 0,
        p: 0,
        width: '100%',
        height: '100%',
        border: 0,
        bgcolor: 'transparent',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 1900,
      }}
    >
      <Box
        component="canvas"
        ref={mask}
        aria-hidden
        sx={{ position: 'fixed', inset: 0, color: 'primary.main', pointerEvents: 'none' }}
      />
      <Paper
        ref={card}
        role="region"
        aria-label={title}
        elevation={8}
        sx={{
          position: 'fixed',
          width: 'min(304px, calc(100vw - 20px))',
          maxHeight: '40dvh',
          overflowY: 'auto',
          p: 1.5,
          boxSizing: 'border-box',
          borderRadius: 2,
          pointerEvents: 'auto',
        }}
      >
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1}>
          <Typography component="h2" variant="subtitle2">
            {title}
          </Typography>
          <Typography variant="caption">
            {Math.min(index + 1, total)} / {total}
          </Typography>
        </Stack>
        <Typography role="status" variant="body2" sx={{ my: 0.75 }}>
          {status}
        </Typography>
        {hint && (
          <Typography variant="body2" color="primary.main" sx={{ mb: 0.75 }}>
            {hint}
          </Typography>
        )}
        {children}
        <Stack direction="row" justifyContent="flex-end" gap={1}>
          <Button size="small" onClick={onClose}>
            {t(action ? 'changelog.guide.exit' : 'changelog.guide.finish')}
          </Button>
          {footer}
        </Stack>
      </Paper>
    </Box>,
    host
  );
}
