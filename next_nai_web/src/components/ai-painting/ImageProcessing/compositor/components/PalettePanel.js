"use client";

import { useEditorText } from "./messages";

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { canvasOf, layerSurface, renderDocument } from "../lib/renderer";
import { extractPalette } from "../lib/palette";
import styles from "./PalettePanel.module.css";

const STORAGE_KEY = "novelai-image-processing-custom-colors-v1";

/** 从当前画布或图像图层提取代表色，并管理保存在本机的自定义颜色。
 * @param {object} props 当前文档、选中图层、前景色与颜色/通知回调。
 * @returns {JSX.Element} 色板面板。
 */
export default function PalettePanel({ doc, layer, color, onColor, notify }) {
  const text = useEditorText();
  const [source, setSource] = useState("canvas");
  const [count, setCount] = useState(8);
  const [result, setResult] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [customColors, setCustomColors] = useState([]);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(color);
  const [message, setMessage] = useState("");
  const imageSelected = layer?.type === "raster";
  const sourceKey = `${doc.id}:${source}:${source === "layer" ? layer?.id : ""}`;
  const currentResult = result?.key === sourceKey ? result : null;
  const changed = currentResult && currentResult.snapshot !== (source === "canvas" ? doc : layer);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) throw new Error("色板数据无效");
      setCustomColors([...new Set(saved.filter((value) =>
        typeof value === "string" && /^#[\da-f]{6}$/i.test(value),
      ).map((value) => value.toLowerCase()))]);
    } catch {
      notify("无法读取自定义色板，请重新添加颜色。");
    }
  }, [notify]);

  useEffect(() => {
    if (editing === null) setDraft(color);
  }, [color, editing]);

  /** 同时更新当前色板和浏览器保存值，添加、修改和删除使用相同存储流程。
   * @param {string[]} colors 完整的自定义颜色列表。
   * @returns {void} 更新本次会话及本机保存值。
   */
  function saveCustomColors(colors) {
    setCustomColors(colors);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
    } catch {
      notify("色板已更新，但浏览器无法保存；本次会话内仍可使用。");
    }
  }

  async function extract() {
    setExtracting(true);
    try {
      const surface = source === "canvas"
        ? await renderDocument(doc)
        : await layerSurface(layer, doc.layers.filter((item) => item.type === "adjustment" && item.targetId === layer.id));
      // 只缩小取样副本，既控制聚类成本，也不改变原始图像。
      const scale = Math.min(1, 160 / Math.max(surface.width, surface.height));
      const sample = canvasOf(surface.width * scale, surface.height * scale);
      const context = sample.getContext("2d", { willReadFrequently: true });
      context.drawImage(surface, 0, 0, sample.width, sample.height);
      const colors = extractPalette(context.getImageData(0, 0, sample.width, sample.height).data, count);
      setResult({
        key: sourceKey,
        name: source === "canvas" ? doc.name : layer.name,
        snapshot: source === "canvas" ? doc : layer,
        colors,
      });
      if (!colors.length) notify("取色来源是全透明图像，没有可提取的颜色。");
    } catch (error) {
      notify(`提取色板失败：${error.message}`);
    } finally {
      setExtracting(false);
    }
  }

  return (
    <section className={styles.panel} aria-label={text("色板")}>
      <header className={styles.heading}>
        <h2>{text("色板")}</h2>
        <button
          type="button"
          className={styles.manageButton}
          aria-expanded={manage}
          onClick={() => { setManage(!manage); setMessage(""); }}
        >
          <Plus size={12} /> {text("自定义")}
        </button>
      </header>
      <div className={styles.controls}>
        <select aria-label={text("色板取色来源")} value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="canvas">{text("当前画布")}</option>
          <option value="layer" disabled={!imageSelected}>{text("所选图像图层")}</option>
        </select>
        <select aria-label={text("提取颜色数量")} value={count} onChange={(event) => setCount(Number(event.target.value))}>
          {[4, 6, 8, 12].map((value) => <option key={value} value={value}>{value} {text("色")}</option>)}
        </select>
        <button
          type="button"
          className={styles.extractButton}
          disabled={extracting || (source === "layer" && !imageSelected)}
          onClick={extract}
        >{extracting ? text("提取中") : text("提取")}</button>
      </div>
      <p className={styles.source} title={currentResult?.name}>
        {currentResult
          ? `${source === "canvas" ? text("画布") : text("图层")} · ${currentResult.name}${changed ? text("（已变化，请重新提取）") : ""}`
          : source === "layer" && !imageSelected ? text("请先选中一个图像图层") : text("点击提取，生成所选来源的代表色")}
      </p>
      <div className={styles.swatches} aria-label={text("提取的颜色")}>
        {currentResult?.colors.map((swatch) => (
          <button
            type="button"
            key={swatch.color}
            style={{ background: swatch.color }}
            aria-label={`前景色 ${swatch.color}，约 ${swatch.percent}%`}
            title={`${swatch.color.toUpperCase()} · 约 ${swatch.percent}%`}
            aria-pressed={color.toLowerCase() === swatch.color}
            onClick={() => onColor(swatch.color)}
          />
        ))}
        {currentResult && !currentResult.colors.length && <span className={styles.empty}>{text("来源全透明")}</span>}
      </div>
      {customColors.length > 0 && (
        <div className={styles.saved}>
          <span>{text("自定义")}</span>
          <div className={styles.swatches} aria-label={text("自定义颜色")}>
            {customColors.map((swatch) => (
              <button
                type="button"
                key={swatch}
                style={{ background: swatch }}
                aria-label={`自定义前景色 ${swatch}`}
                title={swatch.toUpperCase()}
                aria-pressed={color.toLowerCase() === swatch}
                onClick={() => onColor(swatch)}
              />
            ))}
          </div>
        </div>
      )}
      {manage && (
        <div className={styles.manager}>
          <form
            className={styles.colorForm}
            onSubmit={(event) => {
              event.preventDefault();
              let next = draft.trim().toLowerCase();
              if (/^#[\da-f]{3}$/i.test(next)) next = `#${[...next.slice(1)].map((value) => value.repeat(2)).join("")}`;
              if (!/^#[\da-f]{6}$/i.test(next)) {
                setMessage("请输入有效 HEX 色值，例如 #A8C7B5。");
                return;
              }
              if (customColors.some((value) => value === next && value !== editing)) {
                setMessage("此颜色已在自定义色板中。");
                return;
              }
              saveCustomColors(editing
                ? customColors.map((value) => value === editing ? next : value)
                : [...customColors, next]);
              onColor(next);
              setEditing(null);
              setDraft(next);
              setMessage(editing ? "颜色已更新" : "颜色已添加");
            }}
          >
            <input
              type="color"
              aria-label={text("自定义颜色选择器")}
              value={/^#[\da-f]{6}$/i.test(draft) ? draft : color}
              onChange={(event) => { setDraft(event.target.value); setMessage(""); }}
            />
            <input
              aria-label={text("自定义颜色 HEX")}
              value={draft}
              placeholder="#A8C7B5"
              maxLength={7}
              onChange={(event) => { setDraft(event.target.value); setMessage(""); }}
            />
            <button type="submit" title={editing ? "保存颜色修改" : "添加自定义颜色"}>
              {editing ? <Check size={13} /> : <Plus size={13} />}
              {editing ? text("保存") : text("添加")}
            </button>
            {editing && <button type="button" aria-label={text("取消颜色修改")} onClick={() => setEditing(null)}><X size={13} /></button>}
          </form>
          <div className={styles.customList}>
            {customColors.map((swatch) => (
              <div key={swatch}>
                <span className={styles.colorChip} style={{ background: swatch }} />
                <button type="button" className={styles.colorName} onClick={() => onColor(swatch)}>{swatch.toUpperCase()}</button>
                <button type="button" aria-label={`编辑颜色 ${swatch}`} title={text("编辑颜色")} onClick={() => {
                  setEditing(swatch); setDraft(swatch); setMessage("");
                }}><Pencil size={12} /></button>
                <button type="button" aria-label={`删除颜色 ${swatch}`} title={text("删除颜色")} onClick={() => {
                  saveCustomColors(customColors.filter((value) => value !== swatch));
                  if (editing === swatch) setEditing(null);
                  setMessage("颜色已删除");
                }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <p className={styles.hint} role="status">{message || "自定义颜色保存在此浏览器中，所有文档共用。"}</p>
        </div>
      )}
    </section>
  );
}
