#!/usr/bin/env node
/**
 * 0.9.13 motion check: the walkers and the moments scripts/traffic-check.mjs does not watch (review bundle 1).
 *
 *   shoppers   at the era II, VIII and IX markets (the roads end a few metres east of their gates): nobody stands in
 *              view for good, nobody piles up on one spot, the leaving list stays small, nobody pops in or out in
 *              view (a short fade at the verge's far end is allowed), nobody walks into a moving vehicle or
 *              through a standing one
 *   road ends  trikes, trucks and walk-in customers never stand inside each other where their road ends
 *   era 8      opening era VIII moves no buyer vehicle more than a step in one frame
 *   green      building a hut while people are out on the green makes nobody vanish
 *   sled       a sled ride slows down at the bottom of the hill (no stop dead)
 *
 *   node scripts/motion-check.mjs [--seconds 240] [--only shoppers,road,era8,green,sled] [--json out.json]
 *
 * Builds the game like scripts/traffic-check.mjs and drives it with the debug API, stepping 1/30 s. Exit 1 on any
 * finding. Needs WL_CHROMIUM=/opt/pw-browsers/chromium in the cloud.
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
/** Seconds at the era II market (the review's 240 s); the other markets and road ends get a quarter of it. */
const SECONDS = Number(opt('--seconds', '240'));
const ONLY = opt('--only', '');
const JSON_OUT = opt('--json', '');
const want = (name) => !ONLY || ONLY.split(',').some((o) => name.startsWith(o));
const STEP = 1 / 30;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'winterland-motion-'));
const outDir = path.join(tmp, 'dist');
const t0 = Date.now();
const log = (...m) => console.log(`[motion +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...m);

let server;
let browser;
let failed = false;
const findings = [];
const add = (scene, what, extra = {}) => findings.push({ scene, what, ...extra });

/** A fresh world in a new page, up to era `era` (with every pad unlocked when `pads`). */
async function world(era, pads) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (err) => {
    console.log(`[page exception] ${err.message}`);
    failed = true;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?fresh&debug`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__WINTERLAND__, null, { timeout: 90000 });
  await page.evaluate(
    ({ era, pads }) => {
      const W = window.__WINTERLAND__;
      W.pause();
      W.skipIntro();
      W.climb();
      W.advance(1);
      if (era >= 2) W.unlockEra(era);
      if (pads) for (const id of Object.keys(W.config.PADS)) W.unlock(id);
      W.advance(2);
    },
    { era, pads },
  );
  return page;
}

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

  // ---- shoppers at the markets whose road ends just east of the gate --------------------------------------------
  if (want('shoppers')) {
    const page = await world(10, true);
    for (const [era, x, z, seconds] of [
      [2, 25.5, 64, SECONDS],
      [8, 165.5, 130, SECONDS / 4],
      [9, 168, 216, SECONDS / 4],
    ]) {
      const r = await page.evaluate(
        ({ era, x, z, seconds, STEP }) => {
          const W = window.__WINTERLAND__;
          const market = W.level.eras.region(era).market;
          const S = market.shoppers;
          const stock = () => {
            W.stockDocks();
            const pile = market.stallPile;
            pile.fill(S.stall.fallback, Math.max(0, Math.min(pile.capacity, 20) - pile.total));
          };
          const out = [];
          const createdAt0 = S.created;
          let maxLeaving = 0;
          let prev = new Map();
          /** Where each shopper stood still since (for "stands in view for good"). */
          const still = new Map();
          let hits = 0;
          let vmPrev = new Map();
          for (let t = 0; t < seconds; t += STEP) {
            if (Math.round(t / STEP) % 90 === 0) stock();
            W.teleport(x, z);
            W.advance(STEP, STEP);
            const all = [...S.queue, ...S.leaving];
            maxLeaving = Math.max(maxLeaving, S.leaving.length);
            const cur = new Map(all.map((c) => [c, { x: c.group.position.x, z: c.group.position.z, s: c.group.scale.x, fade: c.fade }]));
            for (const [c, p] of cur) {
              if (!prev.has(c) && t > 1 && W.inView(p.x, p.z, 1)) out.push({ what: 'appeared in view', x: p.x, z: p.z, t });
              const q = prev.get(c);
              const st = still.get(c);
              if (q && Math.hypot(p.x - q.x, p.z - q.z) < 1e-4 && S.leaving.includes(c) && W.inView(p.x, p.z, 1)) {
                if (!st) still.set(c, { t, x: p.x, z: p.z });
                else if (t - st.t > 25) out.push({ what: 'stands in view on its way out for good', x: p.x, z: p.z, t });
              } else still.delete(c);
            }
            for (const [c, p] of prev) if (!cur.has(c) && p.s > 0.1 && W.inView(p.x, p.z, 1)) out.push({ what: 'vanished in view', x: p.x, z: p.z, t });
            // stacking: two standing shoppers on one spot (not in the line, whose slots are a step apart)
            const standing = [...cur].filter(([c, p]) => S.leaving.includes(c) && still.has(c) && !(p.fade > 0));
            for (let i = 0; i < standing.length; i++)
              for (let j = i + 1; j < standing.length; j++) {
                const a = standing[i][1];
                const b = standing[j][1];
                if (Math.hypot(a.x - b.x, a.z - b.z) < 0.3) out.push({ what: 'two shoppers stand on one spot', x: a.x, z: a.z, t });
              }
            // into traffic: a shopper inside a moving vehicle's body (2.4 m either way along it, 1.1 m either side)
            const vm = new Map(W.vehicles().map((v) => [v.id, v]));
            for (const [, p] of cur) {
              for (const [id, v] of vm) {
                const pv = vmPrev.get(id);
                if (!pv) continue;
                const sp = Math.hypot(v.x - pv.x, v.z - pv.z) / STEP;
                const along = (p.x - v.x) * v.fx + (p.z - v.z) * v.fz;
                const side = Math.abs((p.x - v.x) * v.fz - (p.z - v.z) * v.fx);
                if (sp > 0.8 && Math.abs(along) < 2.4 && side < 1.1) {
                  hits++;
                  out.push({ what: `walked into a moving ${v.kind}`, x: p.x, z: p.z, t });
                } else if (sp <= 0.8 && Math.abs(along) < 2.2 && side < 0.9) out.push({ what: `walked through a standing ${v.kind}`, x: p.x, z: p.z, t });
              }
            }
            vmPrev = vm;
            prev = cur;
          }
          return { out, created: S.created - createdAt0, maxLeaving, leaving: S.leaving.length, queue: S.queue.length, hits };
        },
        { era, x, z, seconds, STEP },
      );
      const uniq = new Map();
      for (const f of r.out) {
        const key = `${f.what}|${f.x.toFixed(0)},${f.z.toFixed(0)}`;
        if (!uniq.has(key)) uniq.set(key, { ...f, samples: 0 });
        uniq.get(key).samples++;
      }
      for (const f of uniq.values()) add(`era ${era} market`, f.what, { x: +f.x.toFixed(1), z: +f.z.toFixed(1), t: +f.t.toFixed(1), samples: f.samples });
      log(`era ${era} market ${seconds}s: ${r.created} shoppers came, at most ${r.maxLeaving} leaving at once (${r.leaving} at the end), ${r.queue} in line, ${uniq.size ? `${uniq.size} finding(s)` : 'ok'}`);
      if (r.maxLeaving > 12) add(`era ${era} market`, `${r.maxLeaving} shoppers leaving at once`);
    }
    await page.close();
  }

  // ---- road ends: trikes (by the mill), trucks (highway west end), walk-in customers (snow path end) -------------
  if (want('road')) {
    const page = await world(10, true);
    for (const [name, x, z] of [
      ['trike road end', 18, 64],
      ['highway west end', -90, -22.6],
      ['snow path end', -2.3, 40],
    ]) {
      const r = await page.evaluate(
        ({ x, z, seconds, STEP }) => {
          const W = window.__WINTERLAND__;
          const out = [];
          const cust = W.level.customers;
          for (let t = 0; t < seconds; t += STEP) {
            if (Math.round(t / STEP) % 90 === 0) W.stockDocks();
            W.teleport(x, z);
            W.advance(STEP, STEP);
            const v = W.vehicles();
            for (let i = 0; i < v.length; i++)
              for (let j = i + 1; j < v.length; j++)
                if (v[i].kind === v[j].kind && Math.hypot(v[i].x - v[j].x, v[i].z - v[j].z) < 1.5) out.push({ what: `two ${v[i].kind}s inside each other`, x: v[i].x, z: v[i].z, t });
            // (standing ones only: walkers in single file pass through a waiting one's spot)
            const c = cust.leaving.filter((q) => q.speed < 0.05).map((q) => q.group.position);
            for (let i = 0; i < c.length; i++)
              for (let j = i + 1; j < c.length; j++) if (Math.hypot(c[i].x - c[j].x, c[i].z - c[j].z) < 0.35) out.push({ what: 'two customers on one spot', x: c[i].x, z: c[i].z, t });
          }
          return out;
        },
        { x, z, seconds: SECONDS / 4, STEP },
      );
      const uniq = new Map();
      for (const f of r) {
        const key = `${f.what}|${f.x.toFixed(0)},${f.z.toFixed(0)}`;
        if (!uniq.has(key)) uniq.set(key, { ...f, samples: 0 });
        uniq.get(key).samples++;
      }
      for (const f of uniq.values()) add(name, f.what, { x: +f.x.toFixed(1), z: +f.z.toFixed(1), t: +f.t.toFixed(1), samples: f.samples });
      log(`${name.padEnd(18)} ${uniq.size ? `${uniq.size} finding(s)` : 'ok'}`);
    }
    await page.close();
  }

  // ---- era 8 opening: no buyer jumps ---------------------------------------------------------------------------
  if (want('era8')) {
    const page = await world(7, true);
    const r = await page.evaluate(
      ({ STEP }) => {
        const W = window.__WINTERLAND__;
        const out = [];
        const at = [-50, 130];
        for (let t = 0; t < 40; t += STEP) {
          if (Math.round(t / STEP) % 90 === 0) W.stockDocks();
          W.teleport(at[0], at[1]);
          W.advance(STEP, STEP);
        }
        let prev = new Map(W.vehicles().map((v) => [v.id, v]));
        const live = prev.size;
        for (let t = 0; t < 10; t += STEP) {
          if (Math.abs(t - 2) < STEP / 2) W.unlockEra(8);
          W.teleport(at[0], at[1]);
          W.advance(STEP, STEP);
          const cur = new Map(W.vehicles().map((v) => [v.id, v]));
          for (const [id, v] of cur) {
            const p = prev.get(id);
            if (p && Math.hypot(v.x - p.x, v.z - p.z) > 1.5) out.push({ what: `${v.kind} jumped ${Math.hypot(v.x - p.x, v.z - p.z).toFixed(1)} m`, x: v.x, z: v.z, t });
          }
          prev = cur;
        }
        return { out, live };
      },
      { STEP },
    );
    for (const f of r.out) add('era 8 opens', f.what, { x: +f.x.toFixed(1), z: +f.z.toFixed(1), t: +f.t.toFixed(1) });
    log(`era 8 opens: ${r.live} vehicles live, ${r.out.length ? `${r.out.length} jump(s)` : 'no jumps'}`);
    await page.close();
  }

  // ---- a hut built while people are out on the green ------------------------------------------------------------
  if (want('green')) {
    const page = await world(2, false);
    const r = await page.evaluate(
      ({ STEP }) => {
        const W = window.__WINTERLAND__;
        const life = W.ctx.environment.sky.life;
        // three huts stand (so a few people come out), then the fourth is built
        for (const id of ['frontierCrew', 'frontierFeeder', 'frontierShipper']) W.setUpgrade(id, 1);
        // stand in region 2 (its market gate), then on its green
        W.teleport(29, 70);
        W.advance(2);
        const G = life.places.green;
        const gx = (G.minX + G.maxX) / 2;
        const gz = (G.minZ + G.maxZ) / 2;
        for (let t = 0; t < 90 && life.count < 3; t += 1) {
          W.teleport(gx, gz + 6);
          W.advance(1, STEP);
        }
        const before = [...life.walkers];
        W.setUpgrade('frontierPorter', 1);
        let gone = 0;
        let minCount = life.count;
        for (let t = 0; t < 2; t += STEP) {
          W.teleport(gx, gz + 6);
          W.advance(STEP, STEP);
          minCount = Math.min(minCount, life.count);
        }
        for (const w of before) if (!life.walkers.includes(w) && !w.home) gone++;
        return { before: before.length, after: life.count, minCount, gone, key: life.builtKey };
      },
      { STEP },
    );
    if (r.gone > 0) add('green', `${r.gone} of ${r.before} people vanished when the hut was built`);
    if (r.before < 2) add('green', `only ${r.before} people came out on the green (check needs some)`);
    log(`green: ${r.before} out before the hut, ${r.after} 2 s after (min ${r.minCount}), ${r.gone} vanished, huts ${r.key}`);
    await page.close();
  }

  // ---- the sled's run-out --------------------------------------------------------------------------------------
  if (want('sled')) {
    const page = await world(0, false);
    const r = await page.evaluate(
      ({ STEP }) => {
        const W = window.__WINTERLAND__;
        const fun = W.ctx.environment.winterFun;
        let maxDecel = 0;
        let rides = 0;
        const prev = new Map();
        for (let t = 0; t < 90; t += STEP) {
          W.teleport(8, 52);
          W.advance(STEP, STEP);
          for (const s of fun.sledders) {
            const p = prev.get(s);
            if (p && p.stage === 'ride') {
              const dv = (p.speed - s.speed) / STEP;
              maxDecel = Math.max(maxDecel, dv);
              if (s.stage === 'rest') rides++;
            }
            prev.set(s, { stage: s.stage, speed: s.speed });
          }
        }
        return { maxDecel, rides };
      },
      { STEP },
    );
    if (r.rides === 0) add('sled', 'no sled ride finished in 90 s');
    if (r.maxDecel > 15) add('sled', `a sled stopped at ${r.maxDecel.toFixed(0)} m/s² (stop dead)`);
    log(`sled: ${r.rides} rides ended, hardest braking ${r.maxDecel.toFixed(1)} m/s²`);
    await page.close();
  }

  for (const f of findings) log(`FINDING ${f.scene}: ${f.what}${f.x !== undefined ? ` at (${f.x}, ${f.z}), t ${f.t}s, ${f.samples ?? 1} sample(s)` : ''}`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ findings }, null, 1));
  log(findings.length ? `${findings.length} finding(s)` : 'PASS: walkers leave out of sight, nothing stacks, nothing jumps, nobody vanishes, sleds slow down');
  if (findings.length) failed = true;
} catch (err) {
  console.error('[motion] FAILED:', err?.stack ?? err);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
