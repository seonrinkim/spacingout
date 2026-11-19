import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const mp = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8')
);

export default defineConfig({
  base: '/spacingout/',
  define: { __MP_VERSION__: JSON.stringify(mp.version) },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
