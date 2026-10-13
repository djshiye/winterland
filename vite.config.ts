import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Overridable so parallel tooling runs (scripts/shot.mjs) never share a cache directory.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
