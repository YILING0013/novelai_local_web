"use client";

import { useEditorText } from "./messages";

import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, Save, Trash2 } from "lucide-react";
import { IconButton } from "./Controls";
import { downloadBlob } from "../lib/files";
import {
  makeAdjustmentPreset,
  validateAdjustmentPreset,
  PRESET_EXTENSION,
  PRESET_STORAGE_KEY,
  presetStorage,
} from "../lib/adjustment-presets";
import styles from "./AdjustmentPresets.module.css";

/** 管理独立后处理预设；应用通过图层事务回调完成，可正常撤销。
 * @param {object} props 当前图层的后处理参数及应用回调。
 * @returns {JSX.Element} 命名、保存、应用和文件导入导出面板。
 */
export default function AdjustmentPresets({ adjustments, onApply, disabledApply = false }) {
  const text = useEditorText();
  const [presets, setPresets] = useState([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const selectedPreset = presets.find((preset) => preset.name === selected);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        let saved = await presetStorage();
        if (disposed) return;
        // 首次使用新库时搬入原有预设，保留旧数据供旧版本读取。
        const migrate = saved === undefined;
        if (migrate) saved = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "[]");
        if (!Array.isArray(saved)) throw new Error("预设列表格式无效。");
        const validated = saved.map(validateAdjustmentPreset);
        if (migrate) await presetStorage(validated);
        if (disposed) return;
        setPresets(validated);
        setReady(true);
      } catch (failure) {
        if (disposed) return;
        setMessage(`${failure.message} 可先导出当前效果为文件。`);
        setError(true);
      }
    })();
    return () => { disposed = true; };
  }, []);

  // 只有存储成功后才更新列表，浏览器空间不足时不会误报保存成功。
  const persist = async (next) => {
    await presetStorage(next);
    setPresets(next);
  };

  return (
    <section className={styles.panel} aria-label={text("后处理预设")}>
      <div className="section-heading"><span>{text("后处理预设")}</span><small>{PRESET_EXTENSION}</small></div>
      <div className={styles.nameRow}>
        <input
          aria-label={text("预设名称")}
          placeholder={text("为当前效果命名")}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <IconButton icon={Save} label={text("保存当前后处理预设")} disabled={!name.trim() || !ready || busy} onClick={async () => {
          setBusy(true);
          try {
            const preset = makeAdjustmentPreset(name, adjustments);
            if (presets.some((item) => item.name === preset.name))
              throw new Error("此名称已存在，请更换名称或先删除旧预设。");
            await persist([...presets, preset]);
            setSelected(preset.name);
            setName("");
            setMessage(`已保存“${preset.name}”到此浏览器。`);
            setError(false);
          } catch (failure) {
            setMessage(failure.message);
            setError(true);
          } finally {
            setBusy(false);
          }
        }} />
      </div>
      <div className={styles.nameRow}>
        <select aria-label={text("已保存的后处理预设")} value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">{presets.length ? text("选择已保存的预设") : text("还没有自定义预设")}</option>
          {presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
        </select>
        <button disabled={!selectedPreset || disabledApply} title={disabledApply ? text("先解锁图层再应用预设") : text("应用选中的后处理预设")} onClick={() => {
          const preset = validateAdjustmentPreset(selectedPreset);
          onApply(preset.adjustments, `应用预设 · ${preset.name}`);
          setMessage(`已应用“${preset.name}”，可撤销。`);
          setError(false);
        }}>{text("应用")}</button>
      </div>
      <div className={styles.actions}>
        <button disabled={!ready || busy} onClick={() => input.current.click()}><FolderOpen size={13} />{text("导入文件")}</button>
        <button disabled={!selectedPreset} onClick={() => {
          const fileName = selectedPreset.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
          downloadBlob(new Blob([JSON.stringify(selectedPreset, null, 2)], { type: "application/json" }), `${fileName}${PRESET_EXTENSION}`);
          setMessage(`已导出“${selectedPreset.name}”。`);
          setError(false);
        }}><Download size={13} />{text("导出所选")}</button>
        <IconButton icon={Trash2} label={text("删除选中的后处理预设")} disabled={!selectedPreset || !ready || busy} onClick={async () => {
          setBusy(true);
          try {
            await persist(presets.filter((preset) => preset.name !== selected));
            setSelected("");
            setMessage("已删除选中的预设，图层效果保持不变。");
            setError(false);
          } catch (failure) {
            setMessage(failure.message);
            setError(true);
          } finally {
            setBusy(false);
          }
        }} />
      </div>
      <button className={styles.exportCurrent} onClick={() => {
        try {
          const preset = makeAdjustmentPreset(name.trim() || text("当前后处理"), adjustments);
          const fileName = preset.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
          downloadBlob(new Blob([JSON.stringify(preset)], { type: "application/json" }), `${fileName}${PRESET_EXTENSION}`);
          setMessage(`已导出当前效果“${preset.name}”。`);
          setError(false);
        } catch (failure) {
          setMessage(failure.message);
          setError(true);
        }
      }}><Download size={13} />{text("直接导出当前效果")}</button>
      <input ref={input} type="file" accept={PRESET_EXTENSION} hidden aria-label={text("导入后处理预设文件")} onChange={async (event) => {
        const file = event.target.files[0];
        event.target.value = "";
        if (!file) return;
        setBusy(true);
        try {
          if (file.size > 32 * 1024 * 1024) throw new Error("预设文件不能超过 32 MB。");
          const preset = validateAdjustmentPreset(JSON.parse(await file.text()));
          const originalName = preset.name;
          for (let suffix = 2; presets.some((item) => item.name === preset.name); suffix++)
            preset.name = `${originalName.slice(0, 70)} (${suffix})`;
          await persist([...presets, preset]);
          setSelected(preset.name);
          setMessage(`已导入“${preset.name}”，点击应用使用。`);
          setError(false);
        } catch (failure) {
          setMessage(failure instanceof SyntaxError ? "预设文件不是有效的 JSON。" : failure.message);
          setError(true);
        } finally {
          setBusy(false);
        }
      }} />
      <p className={styles.help}>{text("保存全部调色参数与完整 LUT，可复用或作为独立文件携带。")}</p>
      {message && <p className={`${styles.message} ${error ? styles.error : ""}`} role={error ? "alert" : "status"}>{message}</p>}
    </section>
  );
}
