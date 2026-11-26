import { tutorialImages } from '@/content/tutorialImages.mjs';
import { SUGGESTION_EXERCISES } from '@/content/tutorials.mjs';

/**
 * 在示例窗口内移动指针，并通过真实表单的输入、点击、拖放和键盘事件播放教程。
 * 每一步都等待练习组件确认操作。停止或切换篇目时由调用方中止。
 * @param {Window} win 独立示例窗口。
 * @param {object} playback 前台播放状态、字幕回调及指针元素。
 */
export async function playLessonDemo(win, { signal, state, cursor, onStep, onFinish, locale, chapters }) {
  const doc = win.document;
  const zh = locale === 'zh-CN';
  const fields = {
    categoryName: zh ? '发色' : 'Hair',
    categoryItems: 'silver hair, black hair',
    collectionName: zh ? '人物' : 'Portrait',
    noteTitle: zh ? '灯笼' : 'Lantern',
    groupName: zh ? '角色' : 'Characters',
    workTitle: zh ? '花园' : 'Garden',
    translationSource: zh ? '蓝发，红瞳' : 'blue hair, red eyes',
  };
  let x = win.innerWidth / 2,
    y = win.innerHeight / 2,
    last = '',
    retries = 0,
    suggestion = 0;
  let chapter = 0;
  const rebuilding = () => state.current.seekChapter !== null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function delay(duration) {
    let remaining = duration;
    do {
      signal.throwIfAborted();
      if (rebuilding() && state.current.visible) {
        await sleep(12);
        return;
      }
      const rate = state.current.speed;
      const interval = Math.max(1, Math.min(65, remaining / rate));
      if (!state.current.playing || !state.current.visible) await sleep(75);
      else {
        await sleep(interval);
        remaining -= interval * rate;
      }
    } while (remaining > 0);
    signal.throwIfAborted();
  }
  const mouse = (el, type, props = {}) =>
    el.dispatchEvent(
      new win.MouseEvent(type, { view: win, bubbles: true, cancelable: true, clientX: x, clientY: y, ...props })
    );
  const transform = (px, py) => 'translate3d(' + px + 'px,' + py + 'px,0)';
  async function glide(endX, endY) {
    const distance = Math.hypot(endX - x, endY - y);
    if (distance < 1) return;
    const startX = x,
      startY = y;
    const bend = state.current.reduced ? 0 : Math.min(32, distance * 0.09);
    const points = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12,
        curve = Math.sin(Math.PI * t) * bend;
      return {
        offset: t,
        transform: transform(
          Math.max(
            2,
            Math.min(win.innerWidth - 2, startX + (endX - startX) * t - ((endY - startY) / distance) * curve)
          ),
          Math.max(
            2,
            Math.min(win.innerHeight - 2, startY + (endY - startY) * t + ((endX - startX) / distance) * curve)
          )
        ),
      };
    });
    // 让浏览器合成器连续插值。弹窗挂载、React 渲染或主线程计时延迟都不会省略中间的移动。
    // 定位章节时在不可见的画面里重建表单，正常播放跟随用户选择的倍速。
    const motion = cursor.animate(points, {
      duration: rebuilding() ? 1 : Math.min(1850, 780 + distance * 1.3),
      easing: 'cubic-bezier(.42,0,.24,1)',
      fill: 'forwards',
    });
    motion.updatePlaybackRate(state.current.speed);
    state.current.motion = motion;
    const cancel = () => motion.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    if (!state.current.visible || (!state.current.playing && !rebuilding())) motion.pause();
    try {
      await motion.finished;
      signal.throwIfAborted();
      x = endX;
      y = endY;
      cursor.style.transform = transform(x, y);
    } finally {
      signal.removeEventListener('abort', cancel);
      if (state.current.motion === motion) state.current.motion = null;
      motion.cancel();
    }
  }
  async function move(el) {
    // 只滚动示例内部面板。目标可能在参数栏、滚动列表或弹窗中，指针须落在实际可见的部分。
    const panels = [];
    for (let parent = el.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent);
      const clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
      const clipX = /auto|scroll|hidden|clip/.test(style.overflowX);
      if (!clipY && !clipX) continue;
      const r = el.getBoundingClientRect(),
        bounds = parent.getBoundingClientRect();
      if (clipY && /auto|scroll/.test(style.overflowY)) {
        if (r.top < bounds.top) parent.scrollTop += r.top - bounds.top;
        else if (r.bottom > bounds.bottom)
          parent.scrollTop += Math.min(r.top - bounds.top, r.bottom - bounds.bottom);
      }
      if (clipX && /auto|scroll/.test(style.overflowX)) {
        if (r.left < bounds.left) parent.scrollLeft += r.left - bounds.left;
        else if (r.right > bounds.right)
          parent.scrollLeft += Math.min(r.left - bounds.left, r.right - bounds.right);
      }
      panels.push({ parent, clipX, clipY });
    }
    for (let pass = 0; pass < 2 && el.isConnected; pass++) {
      const r = el.getBoundingClientRect();
      let left = Math.max(0, r.left),
        right = Math.min(win.innerWidth, r.right),
        top = Math.max(0, r.top),
        bottom = Math.min(win.innerHeight, r.bottom);
      for (const { parent, clipX, clipY } of panels) {
        const rect = parent.getBoundingClientRect();
        if (clipX) {
          left = Math.max(left, rect.left);
          right = Math.min(right, rect.right);
        }
        if (clipY) {
          top = Math.max(top, rect.top);
          bottom = Math.min(bottom, rect.bottom);
        }
      }
      if (right <= left || bottom <= top) continue;
      await glide(left + (right - left) * 0.48, top + Math.min((bottom - top) / 2, 75));
    }
    mouse(el, 'mouseover');
    mouse(el, 'mousemove');
  }
  async function click(el) {
    const control = el.querySelector('[role=combobox], input[type=checkbox]');
    if (control && !el.matches('button, [role=option]')) el = control;
    await move(el);
    cursor.querySelector('circle').animate(
      [
        { opacity: 0.9, transform: 'scale(.35)' },
        { opacity: 0, transform: 'scale(1.4)' },
      ],
      { duration: 430 / state.current.speed }
    );
    await delay(360);
    const focusAllowed = mouse(el, 'mousedown', { buttons: 1 });
    if (focusAllowed && el.matches('input,textarea,button')) el.focus({ preventScroll: true });
    mouse(el, 'mouseup');
    mouse(el, 'click');
  }
  async function fill(el, value, incremental = true) {
    await move(el);
    el.focus({ preventScroll: true });
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
    const values = incremental ? Array.from(value, (_, i) => value.slice(0, i + 1)) : [value];
    for (const text of values) {
      set.call(el, text);
      el.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.at(-1) }));
      await delay(incremental ? 165 : 30);
    }
  }
  const keypress = (el, type, key, code, modifiers = {}) =>
    el.dispatchEvent(new win.KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, ...modifiers }));
  let idle = 0;
  while (!signal.aborted) {
    await delay(100);
    const coach = doc.querySelector('[data-lesson-coach]'),
      intro = doc.querySelector('[data-workspace-guide]');
    const action = coach?.dataset.lessonAction;
    if (action === 'done' || doc.querySelector('[data-demo-finished=true]')) {
      onFinish();
      return;
    }
    let el = doc.querySelector('[data-tour-current]'),
      target = el?.dataset.tourCurrent;
    const next = coach?.querySelector('button.MuiButton-contained:not(:disabled)');
    let caption = coach?.querySelector('[role=status]')?.textContent || '';
    caption += ' ' + (coach?.querySelector('p.MuiTypography-body2:not([role])')?.textContent || '');
    if (intro && !coach) {
      const status = intro.querySelector('[role=status]');
      const anchor = status && doc.querySelector('[aria-describedby~="' + CSS.escape(status.id) + '"]');
      if (anchor) {
        el = anchor.querySelector('button.MuiButton-contained') || anchor;
        target = 'settings:' + anchor.dataset.releaseTarget;
        caption = status.textContent;
      }
    } else if (next) {
      el = next;
      target = 'advance';
    }
    if (!el || !target || (action === 'suggestionPick' && !next && !el.matches('[data-suggestion-name]'))) {
      // SQL 词库和懒加载对话框首次打开可能需要时间；等待真实候选出现。
      await sleep(80);
      if (++idle > 300) throw Error('Missing control: ' + action);
      continue;
    }
    if (fields[target] && el.dataset.tour !== target) {
      // 输入后表单会先更新，再由引导切换目标。定位更新前不重复填写。
      await sleep(85);
      continue;
    }
    idle = 0;
    const id = [action, target, suggestion].join('/');
    const chapterStart =
      intro && !coach ? 'settings' : action?.startsWith('suggestion') ? 'query' + suggestion : action;
    const newChapter = chapters.findIndex((entry) => entry.start === chapterStart);
    const chapterChanged = newChapter >= 0 && (!last || chapter !== newChapter);
    if (newChapter >= 0) chapter = newChapter;
    if (id !== last) {
      last = id;
      retries = 0;
      if (state.current.seekChapter === chapter) state.current.seekChapter = null;
      onStep(caption.trim(), chapter);
    } else if (++retries > 5) throw Error('Control did not advance: ' + id);
    await delay(chapterChanged ? 3000 : 2000);
    if (!el.isConnected) continue;
    const input = el.matches('textarea,input')
      ? el
      : el.querySelector('textarea:not([aria-hidden]),input:not([type=hidden])');
    if (intro && !coach) {
      const nextButton = intro.querySelector('button.MuiButton-contained');
      if (nextButton) {
        await move(el);
        await delay(550);
        nextButton.click();
      } else await click(el);
    } else if (target === 'chooseImportFile') {
      // 自动演示不能操纵系统相册。点真实菜单后，把示例文件送入同一个 file input 的 change 流程。
      const picker = doc.querySelector('input[data-mobile-import-file]');
      picker.addEventListener('click', (event) => event.preventDefault(), { once: true, signal });
      await click(el);
      const response = await win.fetch(tutorialImages[0].src, { signal });
      if (!response.ok) throw new Error('Sample image could not be loaded');
      const blob = await response.blob();
      const transfer = new win.DataTransfer();
      transfer.items.add(new win.File([blob], 'sample-1.png', { type: blob.type }));
      await delay(700);
      picker.files = transfer.files;
      picker.dispatchEvent(new win.Event('change', { bubbles: true }));
    } else if (next) {
      await click(next);
      suggestion++;
    } else if (fields[target]) {
      await fill(input, fields[target]);
      await delay(600);
    } else if (action === 'suggestionInput') {
      const sample = SUGGESTION_EXERCISES[suggestion];
      await fill(input, !zh && sample.id === 'scoped' ? '+genshin_impact=fu' : sample.query);
    } else if (action === 'commentButton' || action === 'weightButton') {
      const editor = doc.querySelector('[role=dialog] textarea:not([aria-hidden])');
      await move(editor);
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(0, 9);
      await delay(400);
      await click(el);
    } else if (['wheelWeight', 'keyWeight', 'commentKey', 'uncommentKey'].includes(action)) {
      await move(input);
      input.focus({ preventScroll: true });
      if (action === 'wheelWeight') {
        input.setSelectionRange(3, 3);
        input.dispatchEvent(
          new win.WheelEvent('wheel', { bubbles: true, cancelable: true, shiftKey: true, deltaY: -100 })
        );
      } else if (action === 'keyWeight') keypress(input, 'keydown', 'ArrowDown', 'ArrowDown', { altKey: true });
      else keypress(input, 'keydown', '/', 'Slash', { ctrlKey: true });
    } else if (action === 'translationHint') {
      await move(el);
      const area = el.closest('[data-release-target=promptInput]')?.querySelector('textarea:not([aria-hidden])');
      if (area) mouse(area, 'mousemove');
      else mouse(el, 'click');
      await delay(700);
    } else if (el.hasAttribute('data-blueprint-node')) {
      await move(el);
      el.focus({ preventScroll: true });
      keypress(el, 'keydown', 'Enter', 'Enter');
    } else if (target === 'adjustReadout') {
      await fill(input, '18', false);
      input.blur();
    } else if (target.includes('type=range')) {
      await move(input);
      input.focus({ preventScroll: true });
      keypress(input, 'keydown', 'ArrowRight', 'ArrowRight');
      if (doc.querySelector('[data-lesson-coach]')?.dataset.lessonAction === action) {
        await fill(input, String(Number(input.value) + Number(input.step || 1)), false);
        input.dispatchEvent(new win.Event('change', { bubbles: true }));
      }
    } else if (target.startsWith('[data-tour-editor=seed] input')) await fill(input, '42187', false);
    else if (action === 'panImage') {
      await move(el);
      mouse(el, 'mousedown', { buttons: 1 });
      for (let i = 0; i < 14; i++) {
        x += 4;
        y += 1;
        cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        mouse(el, 'mousemove', { buttons: 1 });
        await delay(20);
      }
      mouse(el, 'mouseup');
    } else if (target === 'compareAdjustment') {
      await move(el);
      keypress(el, 'keydown', ' ', 'Space');
      await delay(650);
      keypress(el, 'keyup', ' ', 'Space');
    } else if (target === 'sampleDisplay' || target === 'sampleHistory') {
      const zone = doc.querySelector(
        target === 'sampleDisplay'
          ? '[data-tutorial-drop=display]'
          : '[data-tutorial-drop=history] [data-drop-zone]'
      );
      const ghost = cursor.querySelector('[data-demo-drag-preview]');
      const dataTransfer = new win.DataTransfer();
      await move(el);
      mouse(el, 'mousedown', { buttons: 1 });
      el.dispatchEvent(new win.DragEvent('dragstart', { bubbles: true, dataTransfer }));
      ghost.querySelector('image').setAttribute('href', el.dataset.sampleSrc);
      ghost.setAttribute('transform', x > win.innerWidth - 86 ? 'translate(-88 0)' : '');
      ghost.setAttribute('visibility', 'visible');
      try {
        await delay(500);
        await move(zone);
        const options = { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y };
        zone.dispatchEvent(new win.DragEvent('dragenter', options));
        zone.dispatchEvent(new win.DragEvent('dragover', options));
        await delay(700);
        zone.dispatchEvent(new win.DragEvent('drop', options));
        mouse(zone, 'mouseup');
      } finally {
        ghost.setAttribute('visibility', 'hidden');
        el.dispatchEvent(new win.DragEvent('dragend', { bubbles: true, dataTransfer }));
      }
    } else await click(el);
    await delay(1900);
  }
}
