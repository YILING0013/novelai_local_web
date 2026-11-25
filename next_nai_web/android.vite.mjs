import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rename } from 'node:fs/promises';
import catalog from './src/components/ai-painting/PromptEditor/promptSearchAssets.json' with { type: 'json' };
import desktop from './desktop.vite.mjs';

const path = (name) => fileURLToPath(new URL(name, import.meta.url));
export default mergeConfig(desktop, {
  root: path('./android'),
  resolve: {
    alias: [
      { find: './promptSearchAssets.json', replacement: path('./android/promptSearchAssets.mjs') },
      { find: '@tauri-apps/plugin-dialog', replacement: path('./android/dialog.js') },
      { find: 'file-saver', replacement: path('./android/save-file.js') },
    ],
  },
  plugins: [{
    name: 'android-packaged-tag-catalog',
    apply: 'build',
    async writeBundle({ dir }) {
      const source = join(dir, 'tag-search', catalog.catalogFile);
      await rename(source, source.replace(/\.gz$/, '.ciyu'));
    },
  }],
  build: {
    outDir: join(process.env.NAI_ANDROID_ASSETS || path('../android/app/build/generated/nai/web-only'), 'public'),
    rolldownOptions: { input: { app: path('./android/index.html'), tutorial: path('./android/tutorial-demo.html') } },
    emptyOutDir: false,
    target: 'chrome120',
  },
});
