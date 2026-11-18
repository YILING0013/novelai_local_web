/** 在 Android WebView 中使用系统样式的原生确认框。 */
export async function confirm(text) { return window.confirm(text); }
export async function message(text) { window.alert(text); }
// Android 通过输入文件控件和系统文件选择器访问文档。
export async function open() { return null; }
