import catalog from '@/components/ai-painting/PromptEditor/promptSearchAssets.json';

// AAPT 会剥去 .gz 并解压，Android 专用名称让 WebView 和浏览器读取相同的压缩字节。
export default { ...catalog, catalogFile: catalog.catalogFile.replace(/\.gz$/, '.ciyu') };
