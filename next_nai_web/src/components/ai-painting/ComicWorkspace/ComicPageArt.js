"use client";

import ComicElementArt from './ComicElementArt';
import { getComicRenderItems } from './comicLayers.mjs';

const polygonPoints = (points) => points.map(({ x, y }) => `${x},${y}`).join(' ');

/**
 * 按漫画画布的层序绘制页面，供编辑器、页面库和导入预览共用。
 * @param {{page: object, prefix: string}} props 完整漫画页和当前预览独有的裁切标识前缀。
 * @returns {React.ReactNode} 保留图片、文字字体和笔迹的 SVG 图形组。
 */
export default function ComicPageArt({ page, prefix }) {
  function panelArt(panel) {
    const image = panel.image;
    return <g key={panel.id}>
      <defs><clipPath id={`${prefix}-${panel.id}`}><polygon points={polygonPoints(panel.points)} /></clipPath></defs>
      {image && <g clipPath={`url(#${prefix}-${panel.id})`}><image href={image.dataUrl} x={image.x} y={image.y} width={image.width * image.scale} height={image.height * image.scale} transform={`rotate(${image.rotation || 0} ${image.x + image.width * image.scale / 2} ${image.y + image.height * image.scale / 2})`} /></g>}
      <polygon points={polygonPoints(panel.points)} fill="none" stroke="#111111" strokeWidth={panel.borderWidth} strokeLinejoin="round" />
    </g>;
  }
  return <g pointerEvents="none">
    <rect width={page.width} height={page.height} fill="white" />
    {getComicRenderItems(page).map(({ kind, item }) => {
      if (kind === 'panel') return panelArt(item);
      if (kind === 'element') return <ComicElementArt key={item.id} element={item} fonts={page.fonts} />;
      return item.points.length === 1
        ? <circle key={item.id} cx={item.points[0].x} cy={item.points[0].y} r={item.width / 2} fill={item.kind === 'erase' ? '#ffffff' : item.color} />
        : <polyline key={item.id} points={polygonPoints(item.points)} fill="none" stroke={item.kind === 'erase' ? '#ffffff' : item.color} strokeWidth={item.width} strokeLinecap="round" strokeLinejoin="round" />;
    })}
  </g>;
}
