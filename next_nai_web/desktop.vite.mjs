import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: path('./studio/'),
  base: '/studio/',
  publicDir: false,
  resolve: { alias: {
    '@': path('./src'),
    'next/image': path('./studio/Image.jsx'),
    'next/dynamic': path('./studio/dynamic.jsx'),
  } },
  css: { postcss: path('./') },
  build: {
    target: 'es2022', outDir: path('../desktop/build/ui'), emptyOutDir: true,
    rolldownOptions: {
      moduleTypes: { '.js': 'jsx' },
      onwarn(warning, report) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        report(warning);
      },
    },
  },
});
