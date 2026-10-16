import { makeLayer, makeDocument, validateDocument } from "./model";
import { canvasOf, loadImage } from "./renderer";

const blendNames = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "linear dodge": "lighter",
  "soft light": "soft-light",
  "hard light": "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};
Object.assign(blendNames, {
  "linear burn": "linear-burn",
  "linear dodge (add)": "lighter",
  "vivid light": "vivid-light",
  "linear light": "linear-light",
  "pin light": "pin-light",
  "hard mix": "hard-mix",
  subtract: "subtract",
  divide: "divide",
});

/** 下载文件并及时释放临时地址。
 * @param {Blob} blob 文件数据。
 * @param {string} name 下载名称。
 */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 将 JPEG 图像封装为一页 PDF，按指定分辨率设置纸张大小。
 * @param {Uint8Array} jpeg 已编码的 JPEG 字节。
 * @param {number} width 像素宽度。
 * @param {number} height 像素高度。
 * @param {number} dpi 打印分辨率。
 * @returns {Blob} 可下载的 PDF 文件。
 */
export function imagePdf(jpeg, width, height, dpi) {
  const encoder = new TextEncoder(),
    parts = [],
    offsets = [0];
  let offset = 0;
  const append = (value) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    parts.push(bytes);
    offset += bytes.length;
  };
  const w = ((width / dpi) * 72).toFixed(3),
    h = ((height / dpi) * 72).toFixed(3);
  append("%PDF-1.4\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
  ];
  objects.forEach((body, i) => {
    offsets.push(offset);
    append(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const commands = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets.push(offset);
  append(
    `4 0 obj\n<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream\nendobj\n`,
  );
  offsets.push(offset);
  append(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  append(jpeg);
  append("\nendstream\nendobj\n");
  const xref = offset;
  append("xref\n0 6\n0000000000 65535 f \n");
  for (const position of offsets.slice(1))
    append(`${String(position).padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: "application/pdf" });
}

/** 将上传文件转为内嵌地址，保证项目离线可携带。
 * @param {File|Blob} file 图片文件。
 * @returns {Promise<string>} Data URL。
 */
export function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取文件失败。"));
    reader.readAsDataURL(file);
  });
}

/** 将灰度蒙版转换为 Canvas 合成使用的透明度蒙版。
 * @param {HTMLCanvasElement|HTMLImageElement} image 灰度图。
 * @returns {string} 白色、透明度编码的 PNG。
 */
function alphaMask(image) {
  const canvas = canvasOf(image.width, image.height),
    ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i + 3] = pixels.data[i];
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

/** 读取图片、Web 项目、PSD 或压缩后的原版 .comp 包。
 * @param {File} file 用户选择的本地文件。
 * @returns {Promise<object>} 新文档或图层，以及格式转换说明。
 */
export async function importFile(file) {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("单个文件请控制在 100 MB 以内。");
  const extension = file.name.split(".").pop().toLowerCase();
  if (["json", "compweb"].includes(extension)) {
    const data = JSON.parse(await file.text());
    if (data.format !== "compositor.web" || data.version !== 1)
      throw new Error("这不是支持的 Compositor Web 项目。");
    return { doc: validateDocument(data.document) };
  }
  if (extension === "psd") {
    const { readPsd } = await import("ag-psd");
    const buffer = await file.arrayBuffer();
    // 在分配图层像素之前检查文件头中的尺寸和位深。
    const view = new DataView(buffer);
    if (
      view.byteLength < 26 ||
      view.getUint16(4) !== 1 ||
      view.getUint16(22) !== 8 ||
      view.getUint16(24) !== 3
    )
      throw new Error("仅支持 8 位 RGB PSD；PSB、CMYK 和 16 位文件暂不支持。");
    validateDocument({
      width: view.getUint32(18),
      height: view.getUint32(14),
      layers: [],
    });
    const psd = readPsd(buffer, { skipThumbnail: true });
    const doc = makeDocument({
      name: file.name.replace(/\.psd$/i, ""),
      width: psd.width,
      height: psd.height,
      background: "transparent",
    });
    const report = [
      "保留像素图层、文件夹、位置、透明度与支持的混合模式。文字和矢量按 PSD 内嵌像素导入，不能再编辑原始文字或路径。",
      "智能对象、调整图层和 Photoshop 图层效果不保证还原；请在导入后与原稿核对。",
    ];
    function append(children, parentId = null) {
      for (const child of children || []) {
        const layer = makeLayer(child.children ? "group" : "raster", {
          name: child.name || "PSD 图层",
          parentId,
          visible: !child.hidden,
          opacity: child.opacity ?? 1,
          blend: blendNames[child.blendMode] || "source-over",
          x: child.left || 0,
          y: child.top || 0,
          width: child.canvas?.width || doc.width,
          height: child.canvas?.height || doc.height,
          clipped: !!child.clipping,
        });
        if (child.children) {
          doc.layers.push(layer);
          append(child.children, layer.id);
        } else if (child.canvas) {
          layer.src = child.canvas.toDataURL();
          if (child.mask?.canvas) {
            const mask = canvasOf(layer.width, layer.height),
              ctx = mask.getContext("2d");
            ctx.fillStyle = child.mask.defaultColor === 0 ? "#000" : "#fff";
            ctx.fillRect(0, 0, mask.width, mask.height);
            ctx.drawImage(
              child.mask.canvas,
              (child.mask.left || 0) - layer.x,
              (child.mask.top || 0) - layer.y,
            );
            layer.mask = alphaMask(mask);
            layer.maskEnabled = !child.mask.disabled;
          }
          doc.layers.push(layer);
        } else report.push(`跳过无像素预览的图层：${child.name || "未命名"}`);
      }
    }
    append(psd.children);
    if (!doc.layers.length && psd.canvas)
      doc.layers.push(
        makeLayer("raster", {
          name: "PSD 合成预览",
          src: psd.canvas.toDataURL(),
          width: psd.width,
          height: psd.height,
        }),
      );
    return { doc: validateDocument(doc), report };
  }
  if (extension === "zip") {
    const { unzipSync, strFromU8 } = await import("fflate");
    let bytes = 0;
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        bytes += entry.originalSize;
        if (bytes > 256 * 1024 * 1024)
          throw new Error("解压后项目超过 256 MB。");
        return /manifest\.json$|images\/[^/]+\.png$/i.test(entry.name);
      },
    });
    const manifestPath = Object.keys(archive).find((p) =>
      /(^|\/)manifest\.json$/.test(p),
    );
    if (!manifestPath) throw new Error("压缩包内没有 .comp 的 manifest.json。");
    const data = JSON.parse(strFromU8(archive[manifestPath]));
    if (data.format !== "com.compositor.project")
      throw new Error("不支持的 .comp 格式。");
    const base = manifestPath.slice(0, -"manifest.json".length);
    const doc = makeDocument({
      name: file.name.replace(/\.zip$/i, ""),
      width: data.width,
      height: data.height,
      background: "transparent",
    });
    validateDocument(doc);
    const report = [
      "导入原版 .comp 中的图像、分组、透明度、蒙版及基本变换。原版文字、矢量、调整与效果可能无法完整还原。",
    ];
    for (const item of data.layers) {
      if (!item.imageFile && !item.isGroup) {
        report.push(`跳过没有像素图的图层：${item.name}`);
        continue;
      }
      const transform = item.transform;
      const blend = blendNames[(item.blendMode || "Normal").toLowerCase()];
      if (!blend)
        report.push(`“${item.name}”的 ${item.blendMode} 混合模式转换为正常。`);
      const layer = makeLayer(item.isGroup ? "group" : "raster", {
        id: item.id,
        name: item.name,
        parentId: item.parentID || null,
        visible: item.isVisible,
        opacity: item.opacity,
        blend: blend || "source-over",
        x: transform.origin[0],
        y: transform.origin[1],
        width: transform.size[0],
        height: transform.size[1],
        rotation: transform.rotation || 0,
        flipX: !!transform.flipX,
        flipY: !!transform.flipY,
      });
      if (item.imageFile) {
        const content = archive[`${base}images/${item.imageFile}`];
        if (!content) throw new Error(`缺少图层图片：${item.imageFile}`);
        layer.src = await fileDataUrl(
          new Blob([content], { type: "image/png" }),
        );
      }
      if (item.maskFile) {
        const content = archive[`${base}images/${item.maskFile}`];
        if (!content) throw new Error(`缺少蒙版图片：${item.maskFile}`);
        layer.mask = alphaMask(
          await loadImage(
            await fileDataUrl(new Blob([content], { type: "image/png" })),
          ),
        );
        layer.maskEnabled = item.maskEnabled !== false;
      }
      doc.layers.push(layer);
    }
    return { doc: validateDocument(doc), report };
  }
  if (
    !["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"].includes(
      extension,
    )
  )
    throw new Error(
      "支持 PNG、JPEG、WebP、GIF 首帧、SVG、AVIF、BMP、PSD、.compweb 和 .comp.zip。",
    );
  // SVG 以图像解码，不插入页面 DOM，脚本不会执行。
  const src = await fileDataUrl(file),
    image = await loadImage(src);
  validateDocument({ width: image.width, height: image.height, layers: [] });
  return {
    layer: makeLayer("raster", {
      name: file.name.replace(/\.[^.]+$/, ""),
      src,
      width: image.width,
      height: image.height,
    }),
  };
}

/** 读写 IndexedDB 工作区；事务完成后才报告保存成功。
 * @param {'read'|'write'} operation 操作。
 * @param {object} value 要保存的全部文档。
 * @returns {Promise<object|undefined>} 读取结果或写入完成。
 */
export function workspaceStorage(operation, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("novelai-image-processing", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        transaction = db.transaction(
          "workspace",
          operation === "write" ? "readwrite" : "readonly",
        );
      const store = transaction.objectStore("workspace");
      const query =
        operation === "write"
          ? store.put(value, "current")
          : store.get("current");
      transaction.oncomplete = () => {
        db.close();
        resolve(query.result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}
