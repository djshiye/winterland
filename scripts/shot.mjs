#!/usr/bin/env node
/**
 * Headless play-test + screenshot harness.
 *
 *   node scripts/shot.mjs [options] [steps...]
 *
 * Builds the game into a private temp dir (safe to run several in parallel), serves it, opens it
 * in headless Chromium (software WebGL), waits for window.__WINTERLAND__, PAUSES the real-time loop
 * (unless --live) and runs the steps in order:
 *
 *   sim:<seconds>      advance the simulation in fixed 1/60 s steps (fast, renders once at the end)
 *   wait:<ms>          real-time wait (only useful with --live or after eval:__WINTERLAND__.resume())
 *   eval:<js>          evaluate JS in the page (window.__WINTERLAND__ = debug API); prints the result
 *   state              print __WINTERLAND__.state()
 *   shot:<file.png>    render + save a screenshot (path relative to the current directory)
 *
 * Options:
 *   --size WxH         viewport (default 1280x720)
 *   --mobile           390x844 touch viewport
 *   --query "a=1&b"    URL query string
 *   --live             do not pause the real-time loop
 *   --timeout ms       load timeout (default 60000)
 *   --allow-errors     exit 0 even if the page logged errors
 *
 * Default steps when none are given: sim:1 shot:shots/shot.png
 * Exit code 1 when the page throws / logs console errors (unless --allow-errors).
 *
 * Examples:
 *   node scripts/shot.mjs sim:2 shot:shots/start.png
 *   node scripts/shot.mjs "eval:__WINTERLAND__.teleport(-5,3)" sim:1 state shot:shots/near-pile.png
 */
import { build } from 'vite';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opts = { size: '1280x720', mobile: false, query: '', live: false, timeout: 60000, allowErrors: false };
const steps = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--size') opts.size = args[++i];
  else if (a === '--mobile') opts.mobile = true;
  else if (a === '--query') opts.query = args[++i];
  else if (a === '--live') opts.live = true;
  else if (a === '--timeout') opts.timeout = Number(args[++i]);
  else if (a === '--allow-errors') opts.allowErrors = true;
  else steps.push(a);
}
if (steps.length === 0) steps.push('sim:1', 'shot:shots/shot.png');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'winterland-shot-'));
const outDir = path.join(tmp, 'dist');
const t0 = Date.now();
const log = (...m) => console.log(`[shot +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

let server;
let browser;
let failed = false;
try {
  await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    cacheDir: path.join(tmp, 'cache'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, minify: false, sourcemap: false },
  });
  log('built');

  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let file = path.join(outDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(outDir)) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const [w, h] = (opts.mobile ? '390x844' : opts.size).split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: opts.mobile, hasTouch: opts.mobile });
  const errors = [];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      const text = msg.text();
      // Web fonts are optional in headless/offline runs.
      if (/fonts\.(googleapis|gstatic)\.com/.test(`${text} ${msg.location()?.url ?? ''}`)) return;
      console.log(`[page ${t}] ${text}`);
      if (t === 'error') errors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    console.log(`[page exception] ${err.stack ?? err.message}`);
    errors.push(err.message);
  });

  const url = `http://127.0.0.1:${port}/index.html${opts.query ? `?${opts.query}` : ''}`;
  await page.goto(url, { waitUntil: 'load', timeout: opts.timeout });
  await page.waitForFunction(() => !!window.__WINTERLAND__, null, { timeout: opts.timeout });
  if (!opts.live) await page.evaluate(() => window.__WINTERLAND__.pause());
  log('game ready', opts.live ? '(live)' : '(paused)');

  for (const step of steps) {
    const i = step.indexOf(':');
    const kind = i < 0 ? step : step.slice(0, i);
    const arg = i < 0 ? '' : step.slice(i + 1);
    if (kind === 'sim') {
      await page.evaluate((s) => window.__WINTERLAND__.simulate(s), Number(arg));
      log(`sim ${arg}s`);
    } else if (kind === 'wait') {
      await page.waitForTimeout(Number(arg));
    } else if (kind === 'eval') {
      const result = await page.evaluate((code) => {
        // eslint-disable-next-line no-new-func
        const v = new Function(`return (${code});`)();
        try {
          return JSON.stringify(v, (_k, x) => (typeof x === 'object' && x && x.isObject3D ? '[Object3D]' : x));
        } catch {
          return String(v);
        }
      }, arg);
      log(`eval ${arg.length > 160 ? `${arg.slice(0, 120).replace(/\s+/g, ' ')}…` : arg} →`, result);
    } else if (kind === 'state') {
      const s = await page.evaluate(() => JSON.stringify(window.__WINTERLAND__.state(), null, 1));
      log('state', s.replace(/\n\s*/g, ' '));
    } else if (kind === 'shot') {
      const file = path.resolve(process.cwd(), arg || 'shots/shot.png');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.evaluate(() => window.__WINTERLAND__.render());
      await page.screenshot({ path: file });
      log('saved', path.relative(process.cwd(), file));
    } else {
      throw new Error(`unknown step "${step}"`);
    }
  }

  if (errors.length) {
    console.log(`[shot] ${errors.length} page error(s)`);
    failed = !opts.allowErrors;
  }
} catch (err) {
  console.error('[shot] FAILED:', err?.stack ?? err);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
