import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  // The game's own version (Settings, the save's build stamp: src/core/version.ts).
  define: { __GAME_VERSION__: JSON.stringify(pkg.version) },
  // Overridable so parallel tooling runs (scripts/shot.mjs) never share a cache directory.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
