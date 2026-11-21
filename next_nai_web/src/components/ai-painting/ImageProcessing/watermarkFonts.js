export const signatureFonts = [
  { family: 'Allison', file: 'allison.woff2', sample: 'Signature' },
  { family: 'Sacramento', file: 'sacramento.woff2', sample: 'Signature' },
  { family: 'Caveat', file: 'caveat.woff2', sample: 'Signature' },
  { family: 'Mrs Saint Delafield', file: 'mrssaintdelafield.woff2', sample: 'Signature' },
  { family: 'Ma Shan Zheng', file: 'mashanzheng.woff2', previewFile: 'mashanzheng-sample.woff2', previewFamily: 'Ma Shan Zheng Sample', label: 'maShanZheng', sample: '落款' },
  { family: 'Long Cang', file: 'longcang.woff2', previewFile: 'longcang-sample.woff2', previewFamily: 'Long Cang Sample', label: 'longCang', sample: '落款' },
];

const loaded = new Map();

/** 按需注册水印字体，供浏览器预览、PNG 导出和自动水印共用。
 * @param {string} family 水印字体名。
 * @param {boolean} preview 中文字体卡片只读取两个示例字，实际绘制再加载完整字体。
 * @returns {Promise<void>} 本地字体可用于 Canvas 后完成。
 */
export async function loadSignatureFont(family, preview = false) {
  const font = signatureFonts.find((option) => option.family === family);
  if (!font) return;
  const faceName = (preview && font.previewFamily) || family;
  const file = (preview && font.previewFile) || font.file;
  if (!loaded.has(faceName)) {
    const face = new FontFace(faceName, `url(/fonts/watermark/${file})`, family === 'Caveat' ? { weight: '400 700' } : {});
    loaded.set(faceName, face.load().then((ready) => { document.fonts.add(ready); }).catch((error) => {
      loaded.delete(faceName);
      throw error;
    }));
  }
  await loaded.get(faceName);
}
