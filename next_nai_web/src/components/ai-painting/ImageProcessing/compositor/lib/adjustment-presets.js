import { DEFAULT_ADJUSTMENTS, validateAdjustments } from "./model.js";

export const PRESET_STORAGE_KEY = "novelai-image-processing-postprocessing-presets-v1";
export const PRESET_EXTENSION = ".comppreset";

/** 校验独立后处理预设，补全参数并复制曲线、混色、分级和 LUT，避免预设随编辑变化。
 * @param {object} value 从文件或浏览器存储读取的预设。
 * @returns {object} 具有固定类型、版本、名称和完整参数的预设。
 */
export function validateAdjustmentPreset(value) {
  if (!value || value.type !== "compositor.postprocessing" || value.version !== 1)
    throw new Error("这不是支持的 .comppreset 后处理预设（需要版本 1）。");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 80)
    throw new Error("预设名称需为 1–80 个字符。");
  if (!value.adjustments || typeof value.adjustments !== "object" || Array.isArray(value.adjustments))
    throw new Error("预设缺少后处理参数。");
  const keys = Object.keys(value.adjustments);
  if (!keys.length || keys.some((key) => !Object.hasOwn(DEFAULT_ADJUSTMENTS, key)))
    throw new Error("预设包含空参数或不支持的参数。");
  return {
    type: "compositor.postprocessing",
    version: 1,
    name: value.name.trim(),
    adjustments: validateAdjustments(value.adjustments),
  };
}

/** 将当前图层参数保存为可独立携带的预设，不包含图像或文档内容。
 * @param {string} name 用户填写的预设名称。
 * @param {object} adjustments 当前图层的后处理参数。
 * @returns {object} 可写入浏览器或导出为文件的预设。
 */
export function makeAdjustmentPreset(name, adjustments) {
  return validateAdjustmentPreset({ type: "compositor.postprocessing", version: 1, name, adjustments });
}

/** 在浏览器独立预设库中读取或保存列表；LUT 较大，使用 IndexedDB 容纳完整表数据。
 * @param {object[]|undefined} presets 提供数组时保存，省略时读取。
 * @returns {Promise<object[]|undefined>} 读取所得列表，或保存成功后的 undefined。
 */
export function presetStorage(presets) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("novelai-image-processing-postprocessing", 1);
    let blocked = false;
    opening.onupgradeneeded = () => opening.result.createObjectStore("presets");
    opening.onerror = () => reject(new Error(`无法打开预设库：${opening.error?.message || "浏览器存储不可用"}`));
    opening.onblocked = () => {
      blocked = true;
      reject(new Error("预设库升级被其他页面阻止，请关闭其他 Compositor 页面后重试。"));
    };
    opening.onsuccess = () => {
      const database = opening.result;
      if (blocked) { database.close(); return; }
      const transaction = database.transaction("presets", presets === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("presets");
      const request = presets === undefined ? store.get("library") : store.put(presets, "library");
      transaction.oncomplete = () => {
        database.close();
        resolve(presets === undefined ? request.result : undefined);
      };
      transaction.onabort = () => {
        database.close();
        reject(new Error(`预设库读写失败：${transaction.error?.message || request.error?.message || "浏览器中止了存储事务"}`));
      };
    };
  });
}
