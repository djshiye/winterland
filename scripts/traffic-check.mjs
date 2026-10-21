#!/usr/bin/env node
/**
 * 0.9.12 traffic check: every vehicle (train, trucks, trikes, sleds, the era buyers, and from 0.9.13 the city's street vehicles on the block loops) must
 *
 *   1. face the way it moves      (its nose vs its motion between two samples: "the train drives backwards")
 *   2. never pop in or out in view (a vehicle appearing or vanishing while on screen, away from a depot:
 *                                   "customers vanish in the middle of the road")
 *   3. never jump                   (more than JUMP_M in one sample step: a teleport mid-road)
 *
 * and every fast-travel point must land the player where it says (eras/layout.ts travelPoints; which place each one
 * is in is tests/teleports.test.ts).
 *
 *   node scripts/traffic-check.mjs [--seconds 40] [--mobile] [--only <name,...>] [--json out.json]
 *
 * Builds the game (like scripts/shot.mjs), opens a fresh world with every era open and every era-1 station built and a lot built in every
 * city district (so the street vehicles are out),
 * keeps every counter stocked (debug stockDocks) and stands the player at each viewpoint below for `--seconds`,
 * sampling every vehicle (debug vehicles(): position, facing, on screen) every SAMPLE seconds. Exit 1 on any finding.
 * Needs WL_CHROMIUM=/opt/pw-browsers/chromium in the cloud.
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
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const SECONDS = Number(opt('--seconds', '40'));
const MOBILE = args.includes('--mobile');
const ONLY = opt('--only', '');
const JSON_OUT = opt('--json', '');
/** Seconds between samples: every frame, so a pop-in or vanish is judged against the camera of that very frame. */
const SAMPLE = 1 / 60;
/** A vehicle moving at least this fast (m/s) must face its motion within FACING_COS. */
const MIN_SPEED = 0.8;
const FACING_COS = 0.7; // ~45°: lane changes and corners stay well inside it
/** More than this in one frame is a jump (the fastest vehicle, ~17 m/s, moves 0.3 m). */
const JUMP_M = 1.5;

/** Where vehicles may appear and vanish in plain view: the tunnels they come out of. */
const DEPOTS = [
  { name: 'train tunnel', x: 33.6, z: -60, r: 14 },
  { name: 'truck tunnel', x: 42, z: -22.6, r: 9 },
];

/** Where the player stands: every market, road corner and link, and era 1's roads. */
const VIEWS = [
  ['yard', 0, 2],
  ['trike road', 12, 20],
  ['trike road end', 12, 58],
  ['highway west', -40, -22.6],
  ['truck tunnel', 36, -22.6],
  ['rail platform', 31, 0],
  ['sled lane', 55, 8],
  ['market town', 17, 26.7],
  ['city west street', 42, 40],
  ['city west north end', 42, 15],
  ['city block 5 north (H1 kerb)', 66, 47.2],
  ['city V1 / H2 corner (kerb)', 87.2, 85.2],
  ['city block 6 east (V2 kerb)', 135.2, 70],
  ['era 2 market', 25.5, 64],
  ['between eras 2 and 3', -10, 64],
  ['era 3 market', -46.5, 64],
  ['between eras 3 and 4', -85, 64],
  ['era 4 market', -122, 64],
  ['R1 / west link corner', -182, 64],
  ['west link', -182, 100],
  ['west link / R2 corner', -182, 130],
  ['era 5 market', -119, 130],
  ['era 6 market', -30.5, 130],
  ['city streets on R2', 76, 130],
  ['era 7 market', 64.5, 130],
  ['era 8 market', 165.5, 130],
  ['R2 / east link corner', 196, 130],
  ['east link', 196, 170],
  ['east link / R3 corner', 196, 216],
  ['era 9 market', 168, 216],
  ['era 10 market', 59, 216],
  ['R3 west end', -11, 216],
].filter(([name]) => !ONLY || ONLY.split(',').some((o) => name.includes(o)));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'winterland-traffic-'));
const outDir = path.join(tmp, 'dist');
const t0 = Date.now();
const log = (...m) => console.log(`[traffic +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...m);

let server;
let browser;
let failed = false;
try {
  await build({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(tmp, 'cache'), logLevel: 'error', build: { outDir, emptyOutDir: true, minify: false, sourcemap: false } });
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
  browser = await chromium.launch({ executablePath: process.env.WL_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (err) => {
    console.log(`[page exception] ${err.message}`);
    failed = true;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?fresh&debug`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__WINTERLAND__, null, { timeout: 90000 });
  await page.evaluate(() => {
    const W = window.__WINTERLAND__;
    W.pause();
    W.skipIntro();
    W.climb();
    W.advance(1);
  });
  // teleports first, era by era (what is open and walkable changes as eras open: the Validator's era-4 district jump
  // landed 53 m short in a world at era 4, fine at era 10): every open fast-travel point, the player must stand where it lands
  const hops = [];
  for (let n = 2; n <= 10; n++) {
    hops.push(
      ...(await page.evaluate((n) => {
        const W = window.__WINTERLAND__;
        W.unlockEra(n);
        W.advance(1);
        const out = [];
        for (const p of W.travelPoints()) {
          if (!p.open) continue;
          W.travel(p.id);
          W.advance(0.5);
          const at = W.playerPos();
          out.push({ era: n, id: p.id, x: p.x, z: p.z, ax: at.x, az: at.z, off: Math.hypot(at.x - p.x, at.z - p.z) });
        }
        return out;
      }, n)),
    );
  }
  await page.evaluate(() => {
    const W = window.__WINTERLAND__;
    for (const id of Object.keys(W.config.PADS)) W.unlock(id);
    // 0.9.13: one lot in every district, so each district's street vehicle (city/StreetTraffic.ts) is out
    const KEYS = { 2: 'frontier', 3: 'iron', 4: 'steam', 5: 'industrial', 6: 'electric', 7: 'oil', 8: 'computer', 9: 'nuclear', 10: 'ai' };
    for (const n in KEYS) W.buildCity(Number(n), 0, KEYS[n] + 'Home');
    W.advance(2);
  });
  log(`world ready, ${VIEWS.length} viewpoints × ${SECONDS}s${MOBILE ? ' (phone)' : ''}`);

  const findings = [];
  const seen = {};
  for (const h of hops) if (h.off > 0.6) findings.push({ view: `teleports at era ${h.era}`, kind: 'teleport', id: h.id, what: `landed ${h.off.toFixed(1)} m off its point, at (${h.ax.toFixed(1)}, ${h.az.toFixed(1)})`, x: h.x, z: h.z, t: 0, samples: 1 });
  log(`teleports: ${hops.length} jumps over eras 2-10, ${hops.filter((h) => h.off > 0.6).length} off`);
  for (const [name, x, z] of VIEWS) {
    const r = await page.evaluate(
      ({ x, z, seconds, SAMPLE, MIN_SPEED, FACING_COS, JUMP_M, DEPOTS }) => {
        const W = window.__WINTERLAND__;
        W.teleport(x, z);
        W.stockDocks();
        // settle: vehicles already about when the camera arrives are not pop-ins
        W.advance(1);
        const atDepot = (v) => DEPOTS.some((d) => Math.hypot(v.x - d.x, v.z - d.z) <= d.r);
        const out = [];
        const kinds = {};
        let prev = new Map(W.vehicles().map((v) => [v.id, v]));
        for (let t = 0; t < seconds; t += SAMPLE) {
          if (Math.round(t / SAMPLE) % 300 === 0) W.stockDocks();
          // the player stays put (the camera with them)
          W.teleport(x, z);
          W.advance(SAMPLE, SAMPLE);
          const cur = new Map(W.vehicles().map((v) => [v.id, v]));
          for (const [id, v] of cur) {
            kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
            const p = prev.get(id);
            if (!p) {
              if (v.inView && !atDepot(v)) out.push({ t: +t.toFixed(1), id, kind: v.kind, what: 'appeared in view', x: +v.x.toFixed(1), z: +v.z.toFixed(1) });
              continue;
            }
            const dx = v.x - p.x;
            const dz = v.z - p.z;
            const d = Math.hypot(dx, dz);
            if (d > JUMP_M) out.push({ t: +t.toFixed(1), id, kind: v.kind, what: `jumped ${d.toFixed(1)} m`, x: +v.x.toFixed(1), z: +v.z.toFixed(1) });
            else if (d / SAMPLE >= MIN_SPEED) {
              const cos = (v.fx * dx + v.fz * dz) / d;
              if (cos < FACING_COS) out.push({ t: +t.toFixed(1), id, kind: v.kind, what: `faces ${Math.round((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI)}° off its motion`, x: +v.x.toFixed(1), z: +v.z.toFixed(1) });
            }
          }
          for (const [id, p] of prev) {
            // on screen last frame and its spot still on screen now (a camera cut in between is not a visible vanish)
            if (!cur.has(id) && p.inView && W.inView(p.x, p.z, 4) && !atDepot(p)) out.push({ t: +t.toFixed(1), id, kind: p.kind, what: 'vanished in view', x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
          }
          prev = cur;
        }
        return { out, kinds };
      },
      { x, z, seconds: SECONDS, SAMPLE, MIN_SPEED, FACING_COS, JUMP_M, DEPOTS },
    );
    for (const k in r.kinds) seen[k] = (seen[k] ?? 0) + r.kinds[k];
    // one line per vehicle and kind of problem (a backwards train is one finding, not 300 samples)
    const uniq = new Map();
    for (const f of r.out) {
      const key = `${f.id}|${f.what.replace(/[\d.]+/g, '#')}`;
      if (!uniq.has(key)) uniq.set(key, { view: name, ...f, samples: 0 });
      uniq.get(key).samples++;
    }
    findings.push(...uniq.values());
    log(`${name.padEnd(24)} ${uniq.size ? `${uniq.size} finding(s)` : 'ok'}  (${Object.keys(r.kinds).join(', ') || 'no vehicles'})`);
  }
  const kinds = Object.keys(seen).sort();
  log(`vehicle kinds sampled: ${kinds.join(', ')}`);
  for (const f of findings) log(`FINDING ${f.view}: ${f.kind} ${f.id} ${f.what} at (${f.x}, ${f.z}), t ${f.t}s, ${f.samples} sample(s)`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ findings, kinds: seen }, null, 1));
  log(findings.length ? `${findings.length} finding(s)` : 'PASS: every vehicle faces its way, nothing pops in or out in view, nothing jumps');
  if (findings.length) failed = true;
} catch (err) {
  console.error('[traffic] FAILED:', err?.stack ?? err);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
