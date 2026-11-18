import { local, withTransfer } from './transport';

/** 通过 Android 的保存对话框导出图片、漫画项目或 ZIP。 */
export async function saveAs(source, name = 'image.png') {
  try {
    const response = source instanceof Blob ? null : await fetch(source);
    if (response && !response.ok) throw new Error('LOCAL_ASSET_READ_FAILED');
    const file = response ? await response.blob() : source;
    return await withTransfer(file, async (id) => {
      const { saved } = await local.save({ id, name, mime: file.type.split(';')[0] || 'application/octet-stream' });
      return saved;
    });
  } catch (error) {
    window.dispatchEvent(new CustomEvent('desktop-window-error', { detail: error }));
    return false;
  }
}
export default saveAs;
