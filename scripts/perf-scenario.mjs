#!/usr/bin/env node
/**
 * Late-game renderer cost, measured the same way every time (before / after a rendering change).
 *
 *   node scripts/perf-scenario.mjs [--eras N] [--day] [--frames 40] [--shots dir] [--json out.json]
 *
 * One scripts/shot.mjs run: skips the intro, unlocks every yard pad, builds every village plot, the lodge, the crew
 * quarters, every town lot, amenity and the Grand Market, opens eras 2..N (default 10) with every machine slot and
 * city lot filled, lets the world run for 150 s (crowds, piles, workers), then switches to night and, at each view
 * (yard, village, town, every region and district), renders `frames` frames and prints the draw calls, triangles and
 * the mean / p95 CPU time of renderer.render() (software WebGL in headless Chromium, so the times are only
 * comparable with each other on the same machine). With --shots, saves one screenshot per view.
 *
 * --ab: each view is also rendered with instancing off and on (renderer.instancing): draw calls, a pixel diff and the
 * median render() time of both. --breakdown: the 30 biggest draw-call owners per view. --views a,b: only those views.
 * WL_CHROMIUM=/path/to/chrome uses an installed Chromium (scripts/shot.mjs).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const eras = Number(opt('--eras', '10'));
const frames = Number(opt('--frames', '40'));
const only = opt('--views', null);
const shots = opt('--shots', null);
const jsonOut = opt('--json', null);
const night = !argv.includes('--day');
const breakdown = argv.includes('--breakdown');
const ab = argv.includes('--ab');

const W = '__WINTERLAND__';
const shotSteps = shots
  ? ['village', 'town', 'region:10', 'district:10'].flatMap((id) => [`eval:${W}.travel('${id}')`, 'sim:0.5', `shot:${path.join(shots, id.replace(':', '-') + '.png')}`])
  : [];
const setup = `(() => {
  const W = ${W};
  const C = W.config;
  const log = [];
  const tryDo = (what, fn) => { try { fn(); } catch (e) { log.push(what + ': ' + e.message); } };
  tryDo('intro', () => W.skipIntro());
  W.addMoney(1e12);
  for (const id of Object.keys(C.PADS)) tryDo('pad ' + id, () => W.unlock(id));
  tryDo('village', () => W.revealVillage());
  const vt = C.VILLAGE.tiers.length - 1;
  for (let p = 0; p < 8; p++) tryDo('plot ' + p, () => W.buildPlot(p, vt));
  tryDo('lodge', () => W.buildPlot(-1, 0));
  tryDo('quarters', () => W.buildQuarters(C.QUARTERS.tiers.length - 1));
  tryDo('town', () => W.revealTown());
  const biz = Object.keys(C.BUSINESSES);
  for (let l = 0; l < 8; l++) tryDo('lot ' + l, () => W.buildTown(l, biz[l % biz.length]));
  for (const a of Object.keys(C.AMENITIES)) tryDo('amenity ' + a, () => W.buildAmenity(a));
  tryDo('grand market', () => W.level.town.debugBuildGrandMarket());
  return JSON.stringify(log);
})()`;

// Machine / city ids straight from the data file (the debug API takes ids but does not list them).
const dataSrc = fs.readFileSync(path.join(here, '..', 'src', 'eras', 'data.ts'), 'utf8');
const machinesByEra = {};
for (const m of dataSrc.matchAll(/^\s+\w+: machine\('(\w+)', (\d+),/gm)) (machinesByEra[m[2]] ??= []).push(m[1]);
const ERA_KEYS = ['frontier', 'iron', 'steam', 'industrial', 'electric', 'oil', 'computer', 'nuclear', 'ai'];
const DISTRICT_LOTS = [0, 0, 6, 6, 6, 8, 8, 8, 9, 9, 12];

const fillEras = `(() => {
  const W = ${W};
  const N = ${eras};
  if (N < 2) return 'eras skipped';
  W.unlockEra(N);
  const M = ${JSON.stringify(machinesByEra)};
  const K = ${JSON.stringify(ERA_KEYS)};
  const L = ${JSON.stringify(DISTRICT_LOTS)};
  let machines = 0, city = 0;
  for (let n = 2; n <= N; n++) {
    const ids = M[n] ?? [];
    for (let s = 0; s < 12; s++) if (ids.length && W.buildMachine(n, s, ids[s % ids.length])) machines++;
    const key = K[n - 2];
    // one landmark per district, then homes / work / parks
    const roles = ['Landmark', 'Home', 'Work', 'Park', 'Home', 'Work', 'Home', 'Work', 'Park', 'Home', 'Work', 'Home'];
    for (let l = 0; l < L[n]; l++) if (W.buildCity(n, l, key + roles[l])) city++;
  }
  return JSON.stringify({ machines, city });
})()`;

const measure = `(() => {
  const W = ${W};
  const ctx = W.ctx;
  const pts = [{ id: 'yard', x: 0, z: 2 }];
  for (const id of ['village', 'town', ...Array.from({ length: 9 }, (_, i) => 'region:' + (i + 2)), ...Array.from({ length: 9 }, (_, i) => 'district:' + (i + 2))]) pts.push({ id });
  const keep = ${JSON.stringify(only)};
  if (keep) pts.splice(0, pts.length, ...pts.filter((p) => keep.split(',').includes(p.id)));
  // Counts every draw of one render (main + shadow pass) per owner: the nearest named ancestor path.
  const drawsByOwner = () => {
    const counts = new Map();
    const label = (o) => {
      const names = [];
      for (let a = o; a && a !== ctx.scene && names.length < 3; a = a.parent) if (a.name) names.push(a.name);
      return names.reverse().join(' > ') || '(unnamed ' + o.type + ' ' + (o.geometry?.type ?? '') + ' ' + (o.material?.type ?? '') + ' v' + (o.geometry?.attributes?.position?.count ?? 0) + (o.isInstancedMesh ? ' x' + o.count : '') + ')';
    };
    const hooked = [];
    ctx.scene.traverse((o) => {
      if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return;
      const l = label(o);
      const before = o.onAfterRender, shadow = o.onAfterShadow;
      o.onAfterRender = function (...a) { const c = counts.get(l) ?? [0, 0]; c[0]++; counts.set(l, c); return before.apply(this, a); };
      o.onAfterShadow = function (...a) { const c = counts.get(l) ?? [0, 0]; c[1]++; counts.set(l, c); return shadow.apply(this, a); };
      hooked.push([o, before, shadow]);
    });
    W.render();
    for (const [o, b, s] of hooked) { o.onAfterRender = b; o.onAfterShadow = s; }
    return [...counts].sort((x, y) => y[1][0] + y[1][1] - x[1][0] - x[1][1]).slice(0, 30).map(([k, [m, s]]) => String(m + s).padStart(4) + ' (' + m + '+' + s + ' shadow) ' + k);
  };
  const out = [];
  for (const p of pts) {
    if (p.id === 'yard') W.teleport(p.x, p.z); else if (!W.travel(p.id)) continue;
    W.simulate(0.5, 1 / 60);
    const times = [];
    let calls = 0, tris = 0;
    for (let i = 0; i < ${frames}; i++) {
      W.simulate(1 / 60, 1 / 60);
      const t0 = performance.now();
      W.render();
      times.push(performance.now() - t0);
      calls = Math.max(calls, ctx.renderer.stats.calls);
      tris = Math.max(tris, ctx.renderer.stats.triangles);
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((s, v) => s + v, 0) / times.length;
    const row = { view: p.id, calls, tris, ms: +mean.toFixed(2), p95: +times[Math.floor(times.length * 0.95)].toFixed(2) };
    if (${breakdown}) row.top = drawsByOwner();
    if (${ab}) {
      // same frame with instancing off (every mesh draws itself) vs on: draw calls and a pixel diff
      const r = ctx.renderer;
      const gl = r.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const grab = () => { W.render(); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      r.instancing = false;
      grab();
      const off = grab();
      row.callsOff = r.stats.calls;
      r.instancing = true;
      grab();
      const on = grab();
      row.callsOn = r.stats.calls;
      let diff = 0, max = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d = Math.max(Math.abs(off[i] - on[i]), Math.abs(off[i + 1] - on[i + 1]), Math.abs(off[i + 2] - on[i + 2]));
        if (d > max) max = d;
        if (d > 8) diff++;
      }
      row.pixelsDiff = diff;
      row.maxChannelDiff = max;
      row.pixels = w * h;
      // CPU time of renderer.render(), interleaved off / on so drift hits both alike
      const t = { off: [], on: [] };
      for (let i = 0; i < ${frames}; i++) {
        for (const mode of ['off', 'on']) {
          r.instancing = mode === 'on';
          const t0 = performance.now();
          W.render();
          gl.finish();
          t[mode].push(performance.now() - t0);
        }
      }
      const med = (a) => { a.sort((x, y) => x - y); return +a[Math.floor(a.length / 2)].toFixed(2); };
      row.msOff = med(t.off);
      row.msOn = med(t.on);
      r.instancing = true;
    }
    out.push(row);
  }
  let meshes = 0;
  ctx.scene.traverse((o) => { if (o.isMesh || o.isSprite || o.isPoints || o.isLine) meshes++; });
  return JSON.stringify({ meshesInScene: meshes, views: out });
})()`;

const steps = [
  'sim:1',
  `eval:${setup}`,
  'sim:2',
  `eval:${fillEras}`,
  'sim:150',
  `eval:(${W}.setTimeOfDay(${night ? 0.75 : 0.25}), ${W}.simulate(2, 1/60), 'time set')`,
  `eval:${measure}`,
  ...(shots ? shotSteps : []),
];
const r = spawnSync(process.execPath, [path.join(here, 'shot.mjs'), '--timeout', '180000', '--allow-errors', ...steps], { encoding: 'utf8', maxBuffer: 64 << 20 });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
// readable summary of the measure step (shot.mjs prints eval results as JSON strings)
const line = r.stdout.split('\n').find((l) => l.includes('meshesInScene'));
if (line) {
  const result = JSON.parse(JSON.parse(line.slice(line.indexOf('→ ') + 2)));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
  console.log(`\nmeshes in scene: ${result.meshesInScene}`);
  const pad = (v, n) => String(v ?? '').padStart(n);
  console.log(`${'view'.padEnd(12)}${pad('calls', 7)}${pad('tris', 9)}${pad('ms', 8)}${ab ? `${pad('off', 7)}${pad('on', 7)}${pad('ms off', 8)}${pad('ms on', 8)}${pad('px diff', 9)}` : ''}`);
  for (const v of result.views) {
    console.log(`${v.view.padEnd(12)}${pad(v.calls, 7)}${pad(v.tris, 9)}${pad(v.ms, 8)}${ab ? `${pad(v.callsOff, 7)}${pad(v.callsOn, 7)}${pad(v.msOff, 8)}${pad(v.msOn, 8)}${pad(v.pixelsDiff, 9)}` : ''}`);
    for (const t of v.top ?? []) console.log(`    ${t}`);
  }
}
process.exit(r.status ?? 1);
