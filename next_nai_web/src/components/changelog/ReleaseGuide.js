"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import ExploreOutlined from '@mui/icons-material/ExploreOutlined';
import { useI18n } from '@/i18n/I18nProvider';
import { findGuideStep, WORKSPACE_GUIDES } from '@/content/tutorials.mjs';

/**
 * 在真实工作台上逐步高亮控件。当前步骤由页面上实际显示的控件决定，用户自己打开窗口、点击按钮就会推进。
 * @param {object} props guide 为 WORKSPACE_GUIDES 中的编号；onClose 退出；onPractice 进入联想练习。
 * @returns {React.ReactElement} 盖在当前窗口上的高亮框和说明。
 */
export default function ReleaseGuide({ guide, onClose, onPractice }) {
  const { t } = useI18n();
  const helpId = useId();
  const { steps, practice } = WORKSPACE_GUIDES[guide];
  // progress 之前的步骤已经完成，不再显示；窗口关闭后也不会退回去。
  const [progress, setProgress] = useState(0);
  const [anchor, setAnchor] = useState({ index: -1, node: null, hidden: false });
  const [rect, setRect] = useState(null);
  const [tipHeight, setTipHeight] = useState(132);
  const layer = useRef(null);
  const tip = useRef(null);
  // 看到过的步骤：控件随窗口一起消失时，视为用户已经看过并继续往后。
  const seen = useRef(new Set());
  const finish = practice ? onPractice : onClose;

  useEffect(() => {
    let frame = 0;
    let lastNode;
    const measure = () => {
      frame = 0;
      const visible = new Map();
      const present = new Set();
      for (const node of document.querySelectorAll('[data-release-target]')) {
        // 隐藏页面里的控件没有布局；被下拉菜单或子窗口遮住的控件仍在页面上，只是暂时不能操作。
        if (node.disabled || !node.getClientRects().length) continue;
        const name = node.dataset.releaseTarget;
        present.add(name);
        if (visible.has(name) || node.closest('[hidden], [inert], [aria-hidden="true"]')
          || getComputedStyle(node).visibility === 'hidden') continue;
        visible.set(name, node);
      }
      const { done, index, hidden } = findGuideStep(steps, progress, new Set(visible.keys()), present, seen.current);
      if (done >= steps.length) {
        finish();
        return;
      }
      if (done !== progress) {
        setProgress(done);
        return;
      }
      // 下拉选单会暂时遮住当前窗口，选完后回到原来的步骤。
      const node = index >= 0 ? visible.get(steps[index].target || steps[index].id) : null;
      setAnchor((old) => old.index === index && old.node === node && old.hidden === hidden ? old : { index, node, hidden });
      if (node !== lastNode) {
        lastNode = node;
        node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-hidden', 'hidden', 'inert', 'class', 'style', 'disabled', 'data-release-target'] });
    window.addEventListener('resize', schedule);
    document.addEventListener('transitionend', schedule, true);
    measure();
    return () => {
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('transitionend', schedule, true);
      cancelAnimationFrame(frame);
    };
  }, [finish, progress, steps]);

  const { index, node, hidden } = anchor;
  const step = steps[index];
  const advance = () => {
    if (index + 1 >= steps.length) finish();
    else setProgress(index + 1);
  };

  // 点击类步骤由用户点高亮控件完成；监听放在捕获阶段，控件自己的点击照常执行。
  useEffect(() => {
    if (!step?.click || !node) return;
    const handleClick = (event) => { if (node.contains(event.target)) advance(); };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  });

  useLayoutEffect(() => {
    if (!node) { setRect(null); return; }
    let frame;
    let previous;
    const track = () => {
      const bounds = node.getBoundingClientRect();
      // 角色卡可能比短屏还高，只勾勒当前正文滚动区实际可见的部分。
      const clip = node.closest('.MuiDialogContent-root')?.getBoundingClientRect();
      const next = {
        left: Math.max(3, Math.round(bounds.left) - 3),
        top: Math.max(3, Math.round(clip ? Math.max(bounds.top, clip.top) : bounds.top) - 3),
        right: Math.min(innerWidth - 3, Math.round(bounds.right) + 3),
        bottom: Math.min(innerHeight - 3, Math.round(clip ? Math.min(bounds.bottom, clip.bottom) : bounds.bottom) + 3),
        width: innerWidth, height: innerHeight,
      };
      if (!previous || Object.keys(next).some((key) => previous[key] !== next[key])) {
        previous = next;
        setRect(next);
      }
      // 抽屉和菜单通过 CSS transform 移动，尺寸不变；仅在引导显示时跟随当前一个控件。
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [node]);
  const host = node?.closest('[role="dialog"], .MuiMenu-paper, .MuiDrawer-paper') || document.body;
  useLayoutEffect(() => {
    // 提示进入浏览器顶层，同时留在当前 MUI 窗口的焦点范围内；点击高亮区仍由原控件处理。
    const floating = layer.current;
    if (floating.isConnected) floating.showPopover?.();
    const observer = new ResizeObserver(() => setTipHeight(tip.current?.offsetHeight || 132));
    observer.observe(tip.current);
    return () => { observer.disconnect(); if (floating.isConnected) floating.hidePopover?.(); };
  }, [host]);
  useEffect(() => {
    if (!node) return;
    const previous = node.getAttribute('aria-describedby');
    node.setAttribute('aria-describedby', [previous, helpId].filter(Boolean).join(' '));
    return () => { if (previous) node.setAttribute('aria-describedby', previous); else node.removeAttribute('aria-describedby'); };
  }, [node, helpId]);
  useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape' && !hidden) onClose(); };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [onClose, hidden]);

  const width = Math.min(310, (rect?.width ?? innerWidth) - 24);
  let left = 12;
  let top = 12;
  if (rect) {
    const maxLeft = rect.width - width - 12;
    const maxTop = Math.max(12, rect.height - tipHeight - 12);
    if (rect.right + 12 <= maxLeft || rect.left - width - 12 >= 12) {
      left = rect.right + 12 <= maxLeft ? rect.right + 12 : rect.left - width - 12;
      top = Math.min(maxTop, Math.max(12, rect.top));
    } else {
      left = Math.max(12, Math.min(maxLeft, (rect.left + rect.right - width) / 2));
      const below = rect.height - rect.bottom;
      top = below >= tipHeight + 24 || below >= rect.top ? rect.bottom + 12 : rect.top - tipHeight - 12;
      top = Math.max(12, Math.min(maxTop, top));
    }
  }
  const counted = steps.filter((item) => !item.extra);
  const position = step ? counted.indexOf(step) : -1;
  const name = step?.id || 'waiting';
  return createPortal(
    <Box popover="manual" ref={layer} data-workspace-guide="" sx={{ position: 'fixed', inset: 0, m: 0, p: 0, width: '100%', height: '100%',
      visibility: hidden ? 'hidden' : 'visible', border: 0, overflow: 'visible', bgcolor: 'transparent', color: 'text.primary', pointerEvents: 'none', zIndex: 1800 }}>
      {rect && <Box aria-hidden sx={{ position: 'absolute', left: rect.left, top: rect.top, width: Math.max(0, rect.right - rect.left),
        height: Math.max(0, rect.bottom - rect.top), border: '3px solid', borderColor: 'primary.main', borderRadius: 1.5,
        boxShadow: '0 0 0 110vmax rgba(8, 12, 20, 0.40)', boxSizing: 'border-box' }} />}
      <Paper ref={tip} role="region" aria-label={t(`tutorials.guides.${guide}`)} elevation={8}
        sx={{ position: 'absolute', left, top, width, p: 1.5, boxSizing: 'border-box', pointerEvents: 'auto',
          maxHeight: '48dvh', overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <ExploreOutlined fontSize="small" color="primary" />
          <Typography component="h2" variant="subtitle2" sx={{ flex: 1 }}>{t(`changelog.guide.${name}Title`)}</Typography>
          {position >= 0 && <Typography variant="caption" color="text.secondary">{position + 1} / {counted.length}</Typography>}
        </Stack>
        <Typography role="status" id={helpId} variant="body2" sx={{ my: 1 }}>{t(`changelog.guide.${name}Help`)}</Typography>
        <Stack direction="row" justifyContent="space-between">
          <Button size="small" color="inherit" onClick={onClose}>{t('changelog.guide.exit')}</Button>
          {step?.next && <Button size="small" variant="contained" onClick={advance}>
            {t(index + 1 >= steps.length ? 'changelog.guide.finish' : 'changelog.guide.next')}
          </Button>}
          {practice && !step && <Button size="small" onClick={onPractice}>{t('tutorials.openPractice')}</Button>}
        </Stack>
      </Paper>
    </Box>, host);
}
