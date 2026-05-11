import { defineConfig } from 'vite';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const manifest = {
  manifest_version: 3,
  name: 'Kaboom — Screen recorder',
  version: '0.1.0',
  description: 'Record, trim, transcribe and share screen captures without leaving the browser.',
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Kaboom',
  },
  background: {
    service_worker: 'src/background/service-worker.js',
    type: 'module' as const,
  },
  permissions: ['offscreen', 'storage', 'tabs', 'scripting', 'activeTab', 'downloads'],
  host_permissions: ['<all_urls>'],
  commands: {
    'toggle-recording': {
      suggested_key: { default: 'Ctrl+Shift+L', mac: 'Command+Shift+L' },
      description: 'Start or stop recording',
    },
    'toggle-annotation': {
      suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
      description: 'Toggle on-screen annotation',
    },
  },
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  web_accessible_resources: [
    {
      resources: ['src/offscreen/offscreen.html', 'src/preview/preview.html', 'assets/*'],
      matches: ['<all_urls>'],
    },
  ],
};

function manifestPlugin() {
  return {
    name: 'kaboom-manifest',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        preview: resolve(__dirname, 'src/preview/preview.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/content.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'src/background/service-worker.js';
          if (chunk.name === 'content') return 'src/content/content.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [manifestPlugin()],
});
