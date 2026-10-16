"use client";

import { useEditorText } from "./messages";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_BRUSH, BRUSH_FIELDS, brushStrokeMarks, createBrushStamp, drawBrushStamp, importBrushFile, parseBrushPresets, serializeBrushPresets } from "../lib/brushes";
import { downloadBlob } from "../lib/files";
import styles from "./BrushSettings.module.css";

const STORAGE_KEY = "novelai-image-processing-brush-presets-v1";

/** 编辑笔刷形状、动态和本地预设，导入文件始终由用户主动选择。
 * @param {object} props 当前笔刷、颜色与修改回调。
 * @returns {JSX.Element} 笔刷设置对话框内容。
 */
export default function BrushSettings({ brush, color, onChange }) {
  const text = useEditorText();
  const [presets, setPresets] = useState([]), [name, setName] = useState(text("我的笔刷"));
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const preview = useRef(null), input = useRef(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setPresets(parseBrushPresets(saved));
    } catch (err) { setError(`笔刷库读取失败：${err.message}`); }
  }, []);
  useEffect(() => {
    let disposed = false;
    const settings = { ...brush, size: Math.min(64, brush.size) };
    createBrushStamp(settings, color).then((stamp) => {
      if (disposed) return;
      const target = preview.current, ctx = target.getContext("2d"), paint = document.createElement("canvas");
      paint.width = target.width; paint.height = target.height;
      const pctx = paint.getContext("2d"), stroke = { brush: settings };
      pctx.globalAlpha = settings.flow / 100;
      for (let x = 32; x <= 588; x += 2) {
        const point = { x, y: 60 + Math.sin((x - 32) / 556 * Math.PI * 2) * 20, pressure: 0.2 + 0.8 * Math.sin((x - 32) / 556 * Math.PI) };
        for (const mark of brushStrokeMarks(stroke, point)) drawBrushStamp(pctx, stamp, mark, settings);
      }
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.globalAlpha = settings.opacity / 100;
      ctx.drawImage(paint, 0, 0);
    }).catch((err) => { if (!disposed) setError(`笔尖预览失败：${err.message}`); });
    return () => { disposed = true; };
  }, [brush, color]);

  // 先写入存储，确认成功后再更新列表；容量不足时明确保留当前笔刷供导出。
  function saveLibrary(next) {
    if (next.length > 100) throw new Error("本地笔刷库最多 100 支，请先导出并移除不需要的笔刷。");
    if (next.length) localStorage.setItem(STORAGE_KEY, serializeBrushPresets(next));
    else localStorage.removeItem(STORAGE_KEY);
    setPresets(next);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.preview}>
        <canvas ref={preview} width={620} height={120} aria-label={text("笔刷笔迹预览")} />
        <span>{text("笔迹预览 · 预览尺寸最高 64 px")}</span>
      </div>
      <div className={styles.actions}>
        <button onClick={() => onChange({ ...DEFAULT_BRUSH, hardness: 100 })}>{text("硬圆笔")}</button>
        <button onClick={() => onChange({ ...DEFAULT_BRUSH, hardness: 0, flow: 35 })}>{text("柔圆笔")}</button>
        <button onClick={() => input.current.click()} disabled={busy}>{busy ? text("正在导入…") : text("导入图片 / ABR / 预设")}</button>
        <input ref={input} hidden type="file" accept=".png,.jpg,.jpeg,.webp,.bmp,.abr,.compbrush" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true); setError(""); setMessage("");
          try {
            const imported = await importBrushFile(file);
            onChange(imported.presets[0].brush);
            setName(imported.presets[0].name);
            try {
              saveLibrary([...presets, ...imported.presets]);
              setMessage(imported.notice);
            } catch (err) { setError(`已应用第一支笔刷，但未保存笔刷库：${err.message}。可导出当前笔刷保留。`); }
          } catch (err) { setError(err.message); }
          finally { setBusy(false); }
        }} />
      </div>
      <p className={styles.note}>{text("当前笔尖：")}{brush.tip?.name || text("圆形")}{text("。透明图片按轮廓取样；不透明图片以深色为墨、白色为透明。图片与 ABR 笔尖最长边为 1024 px。")}</p>
      <div className={styles.fields}>
        {BRUSH_FIELDS.map(([key, label, min, max, unit]) => (
          <label key={key} className={styles.field}>
            <span>{text(label)}<output>{brush[key]}{unit}</output></span>
            <input type="range" aria-label={text(label)} min={min} max={max} value={brush[key]}
              disabled={key === "hardness" && !!brush.tip}
              onChange={(event) => onChange({ ...brush, [key]: Number(event.target.value) })} />
          </label>
        ))}
        <div className={styles.checks}>
          <label><input type="checkbox" checked={brush.pressureSize} onChange={(event) => onChange({ ...brush, pressureSize: event.target.checked })} />{text("压感控制大小")}</label>
          <label><input type="checkbox" checked={brush.flipX} onChange={(event) => onChange({ ...brush, flipX: event.target.checked })} />{text("水平翻转笔尖")}</label>
          <label><input type="checkbox" checked={brush.flipY} onChange={(event) => onChange({ ...brush, flipY: event.target.checked })} />{text("垂直翻转笔尖")}</label>
        </div>
      </div>
      <p className={styles.note}>{text("流量控制每次盖章的积墨；不透明度限制整笔浓度。压感仅对支持的触控笔生效。间距与散布按笔刷直径计算。")}</p>
      <div className={styles.library}>
        <h3>{text("我的笔刷库")}</h3>
        <div className={styles.saveRow}>
          <input aria-label={text("笔刷预设名称")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={text("输入笔刷名称")} />
          <button disabled={!name.trim() || busy} onClick={() => {
            try {
              saveLibrary([...presets.filter((item) => item.name !== name.trim()), { name: name.trim(), brush }]);
              setError(""); setMessage("笔刷已保存到此浏览器，同名预设已更新。");
            } catch (err) { setError(`保存失败：${err.message}。请导出当前笔刷保留。`); }
          }}>{text("保存笔刷")}</button>
          <button onClick={() => downloadBlob(new Blob([serializeBrushPresets([{ name: name.trim() || text("我的笔刷"), brush }])], { type: "application/json" }), `${name.trim() || text("我的笔刷")}.compbrush`)}>{text("导出当前")}</button>
          <button disabled={!presets.length} onClick={() => downloadBlob(new Blob([serializeBrushPresets(presets)], { type: "application/json" }), "我的笔刷库.compbrush")}>{text("导出笔刷库")}</button>
        </div>
        <div className={styles.presetList}>
          {presets.map((preset, index) => (
            <div key={`${index}-${preset.name}`} className={styles.preset}>
              <button onClick={() => { onChange(preset.brush); setName(preset.name); setError(""); setMessage(`已应用“${preset.name}”。`); }} title={`应用 ${preset.name}`}>
                {preset.brush.tip ? <img src={preset.brush.tip.src} alt="" /> : <span className={styles.roundTip} />}
                <span>{preset.name}</span>
              </button>
              <button aria-label={`移除笔刷 ${preset.name}`} onClick={() => {
                try { saveLibrary(presets.filter((_, i) => i !== index)); setError(""); }
                catch (err) { setError(`移除失败：${err.message}`); }
              }}>×</button>
            </div>
          ))}
          {!presets.length && <p className={styles.note}>{text("保存或导入后，笔刷会出现在这里。")}</p>}
        </div>
      </div>
      <p className={styles.note}>{text("ABR 支持 v6 / 7 / 9 / 10 中的采样型和计算圆形笔刷。旧版 v1 / 2、16 位 RLE、PS 纹理、双重画笔、湿边、混色与高级动态效果不支持；导入时保留可用笔尖和基础参数。")}</p>
      {message && <p className={styles.message} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
