"use client";

import { memo, useEffect, useMemo, useState } from 'react';
import { comicElementMatrix, comicElementSvg, loadComicFonts } from './comicElements.mjs';

const EMPTY_FONTS = [];

/**
 * 使用与导出相同的局部 SVG 绘制元素；页面位置变化只更新外层矩阵，不重复解码素材。
 * @param {{element:object,fonts?:Array}} props 元素及页面字体。
 * @returns {React.ReactNode} 可直接放入页面 SVG 的图形组。
 */
function ComicElementArt({ element, fonts = EMPTY_FONTS }) {
  const { kind, width, height, presetId, balloonContours, dataUrl, text, fontFamily, fontSize, textAlign, writingMode, lineHeight, color, fill, stroke, strokeWidth, feather, opacity, mask } = element;
  const font = fonts.find((item) => item.family === fontFamily);
  const [readyFont, setReadyFont] = useState(null);
  const [fontError, setFontError] = useState('');
  useEffect(() => {
    if (!font) return;
    let active = true;
    setFontError('');
    loadComicFonts([font]).then(() => { if (active) setReadyFont(font); }, (error) => { if (active) setFontError(error.message); });
    return () => { active = false; };
  }, [font]);
  const href = useMemo(() => {
    if (font && readyFont !== font) return null;
    const svg = comicElementSvg({ kind, width, height, presetId, balloonContours, dataUrl, text, fontFamily, fontSize, textAlign, writingMode, lineHeight, color, fill, stroke, strokeWidth, feather, opacity, mask }, { fonts });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [font, readyFont, kind, width, height, presetId, balloonContours, dataUrl, text, fontFamily, fontSize, textAlign, writingMode, lineHeight, color, fill, stroke, strokeWidth, feather, opacity, mask, fonts]);
  return <g transform={`matrix(${comicElementMatrix(element).join(' ')})`} pointerEvents="none" data-element-art={element.id}>
    {href ? <image href={href} width={width} height={height} preserveAspectRatio="none" /> : <>
      <title>{fontError || 'Loading font'}</title>
      <rect width={width} height={height} fill="none" stroke={fontError ? '#c62828' : '#8a8a8a'} strokeDasharray="6 4" />
      {fontError && <path d={`M ${width / 2} ${height / 2 - 10} l 11 20 h -22 Z`} fill="#c62828" />}
    </>}
  </g>;
}

export default memo(ComicElementArt);
