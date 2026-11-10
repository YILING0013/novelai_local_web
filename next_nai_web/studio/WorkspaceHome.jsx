import { useEffect, useState } from 'react';
import { ArrowUpRight, FolderOpen, Images, Layers, ScanEye, Expand, Brush } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { PAGE_IDS as ID } from '@/i18n/pageConfig.mjs';
import api from '@/utils/ApiClient';

const covers = [
  [ID.LOCAL_GALLERY, 'outputs', FolderOpen, '7h2Qt7ECPjZoc9XNBCU82XkRey35LEEo.webp'],
  [ID.REFERENCE_GALLERY, 'references', Images, 'domDLxWSNyFHed4mB7fBm1ZQy7Tbmrll.webp'],
];

export default function WorkspaceHome({ local, active, labels, open }) {
  const zh = useI18n().locale === 'zh-CN';
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (!active) return;
    let live = true;
    covers.forEach(async ([id, source]) => {
      try { const result = await api.getGallery({ source, limit: 1 }); if (live) setCounts(c => ({ ...c, [id]: result.total })); }
      catch { if (live) setCounts(c => ({ ...c, [id]: null })); }
    });
    return () => { live = false; };
  }, [active]);
  const tools = [
    [local ? 'editor' : ID.AI_PAINTING, local ? Layers : Brush, zh ? (local ? '图层合成与图片编辑' : '提示词、参考图与生成') : (local ? 'Layers and compositing' : 'Prompts and generation')],
    [ID.IMAGE_TAGGING, ScanEye, zh ? '从图像提取标签' : 'Extract tags from an image'],
    [ID.LOCAL_UPSCALING, Expand, zh ? '使用本地模型放大图像' : 'Enlarge images with local models'],
  ];
  return <main className="studio-home"><h1>{zh ? '创作工作台' : 'Creative workspace'}</h1>
    <div className="library-covers">{covers.map(([id,,Icon,cover]) =>
      <button key={id} className="library-cover" onClick={() => open(id)}>
        <img src={'/reference_img/' + cover} alt="" /><div className="cover-shade"/>
        <span className="cover-icon"><Icon size={20}/></span><div className="cover-caption">
          <div><b>{labels[id]}</b>{Number.isFinite(counts[id]) && <small>{counts[id]} {zh ? '张图片' : counts[id] === 1 ? 'image' : 'images'}</small>}</div><ArrowUpRight/></div>
      </button>)}</div>
    <h2>{zh ? '创作工具' : 'Tools'}</h2>
    <div className="home-tools">{tools.map(([id,Icon,detail]) => <button key={id} onClick={() => open(id)}>
      <span className={'tool-tile tile-' + id}><Icon size={23}/></span><span><b>{labels[id]}</b><small>{detail}</small></span><ArrowUpRight size={15}/></button>)}</div>
  </main>;
}
