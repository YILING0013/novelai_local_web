import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const path = name => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: path('./desktop'), base: '/', publicDir: path('./public'),
  resolve: { alias: { '@': path('./src'), 'next/navigation': path('./src/desktop/navigation.js'),
    'file-saver': path('./desktop/save-file.js'), 'next/image': path('./src/desktop/Image.jsx'), 'next/dynamic': path('./src/desktop/dynamic.jsx') } },
  css: { postcss: path('./') }, server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: path('./dist'), emptyOutDir: true, target: 'es2022',
    rolldownOptions: { moduleTypes: { '.js': 'jsx' }, onwarn(w, warn) {
      if (!(w.code === 'MODULE_LEVEL_DIRECTIVE' && w.message.includes('use client'))) warn(w);
    }} }
});
