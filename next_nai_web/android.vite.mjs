import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import desktop from './desktop.vite.mjs';

const path = (name) => fileURLToPath(new URL(name, import.meta.url));
export default mergeConfig(desktop, {
  root: path('./android'),
  resolve: {
    alias: [
      { find: '@tauri-apps/plugin-dialog', replacement: path('./android/dialog.js') },
      { find: 'file-saver', replacement: path('./android/save-file.js') },
    ],
  },
  build: {
    outDir: join(process.env.NAI_ANDROID_ASSETS || path('../android/app/build/generated/nai/web-only'), 'public'),
    emptyOutDir: false,
    target: 'chrome120',
  },
});
