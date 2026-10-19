#!/usr/bin/env node
/**
 * Late-game renderer cost, measured the same way every time (before / after a rendering change).
 *
 *   node scripts/perf-scenario.mjs [--eras N] [--day] [--frames 40] [--tiers low,medium,high] [--gate 950] [--shots dir] [--json out.json]
 *
 * One scripts/shot.mjs run: skips the intro, unlocks every yard pad, builds every village plot, the lodge, the crew
 * quarters, every town lot, amenity and the Grand Market, opens eras 2..N (default 10) with every machine slot and
 * city lot filled, lets the world run for 150 s (crowds, piles, workers), then switches to night and, at each view
 * (yard, village, town, every region and district), renders `frames` frames and prints the draw calls, triangles and
 * the mean / p95 CPU time of renderer.render() and (0.9.11) of one 1/60 s simulation step (software WebGL in headless Chromium, so the times are only
 * comparable with each other on the same machine). With --shots, saves one screenshot per view.
 *
 * --tiers: measure every view on each of these graphics tiers (render/Renderer.ts TIERS; default: the stored tier,
 * High on a fresh profile). Draw calls count the shadow pass, the scene and the post passes.
 * --gate N: exit 1 when any view on any tier draws more than N calls (the 0.9.8 perf gate in CI uses 950 at night).
 * --ab: each view is also rendered with instancing off and on (renderer.instancing): draw calls, a pixel diff and the
 * median render() time of both. --breakdown: the 30 biggest draw-call owners per view.
 * --tris: the 30 biggest triangle owners per view (scene + shadow pass). --views a,b: only those views.
 * --look dir: after measuring, a day and a night screenshot of every era (the yard for era 1, beside each region's
 * market for eras 2..10, HUD hidden) plus the village, town and the era-10 district, as dir/<view>-day.png and dir/<view>-night.png
 * (the before / after proof of a visual change). 0.9.12: also dir/eraNN-yard-day/night.png, each region's machine yard.
 * 0.9.10: also prints the first frame drawn in each era region against the next one (the walk-in stutter, G1), and the
 * slowest of the warm-up frames that get each opened region ready ahead of time (render/Renderer.ts warm()).
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
const look = opt('--look', null);
const tiers = opt('--tiers', '');
const gate = Number(opt('--gate', '0'));
const night = !argv.includes('--day');
const breakdown = argv.includes('--breakdown');
const trisTop = argv.includes('--tris');
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
// Region views for --look: next to the region's market zone, at a close play zoom (the player stands on a walkable spot).
const regionView = (n) =>
  `(() => { const W = ${W}; const L = W.game.level.eras.region(${n}).layout; const M = L.zones.market; W.teleport(M.minX - 1.2, M.maxZ); W.cameraZoom(0.6); })()`;
// 0.9.12: the machine yard of a region (on the workers' aisle in front of its middle front-row machine, a wider zoom):
// the belts, pipes and chutes between its machines (assets/yardLinks.ts)
const yardView = (n) =>
  `(() => { const W = ${W}; const L = W.game.level.eras.region(${n}).layout; const s0 = L.slots[0]; const row = L.slots.filter((s) => Math.abs(s.z - s0.z) < 0.01); const s = row[Math.floor(row.length / 2)]; W.teleport(s.x - L.cell / 2, s.z - L.inward * (L.rowPitch / 2)); W.cameraZoom(0.9); })()`;
const lookSteps = look
  ? [
      // the HUD hides so the shots show only the world; each view settles its era look at once (the look fade runs on
      // real time, which a paused harness doesn't have, so a shot would otherwise show part of the previous era's grade)
      `eval:(() => { const s = document.createElement('style'); s.textContent = 'body *:not(canvas){visibility:hidden !important} canvas{visibility:visible !important}'; document.head.appendChild(s); return 'hud hidden'; })()`,
      ...[
        ['era01', `(${W}.teleport(0, 2), ${W}.cameraZoom(0.8))`],
        ['village', `(${W}.travel('village'), ${W}.cameraZoom(0.6))`],
        ['town', `(${W}.travel('town'), ${W}.cameraZoom(0.6))`],
        ...Array.from({ length: Math.max(0, eras - 1) }, (_, i) => [`era${String(i + 2).padStart(2, '0')}`, regionView(i + 2)]),
        ...Array.from({ length: Math.max(0, eras - 1) }, (_, i) => [`era${String(i + 2).padStart(2, '0')}-yard`, yardView(i + 2)]),
        ['district10', `(${W}.travel('district:10'), ${W}.cameraZoom(0.5))`],
      ].flatMap(([id, go]) =>
        [['day', 0.25], ['night', 0.75]].flatMap(([when, t]) => [
          `eval:(${go}, ${W}.setTimeOfDay(${t}), ${W}.simulate(3, 1/60), ${W}.ctx.renderer.render(), ${W}.ctx.renderer.setEra(${W}.ctx.renderer.era, true), '${id} ${when}')`,
          `shot:${path.join(look, `${id}-${when}.png`)}`,
        ]),
      ),
    ]
  : [];
const DISTRICT_LOTS = [0, 0, 6, 6, 6, 8, 8, 8, 9, 9, 12];

const fillEras = `(() => {
  const W = ${W};
  const N = ${eras};
  if (N < 2) return 'eras skipped';
  W.unlockEra(N);
  // 0.9.5: every crew role hired and every belt built (full era automation: the late game's worst case)
  W.setAllUpgrades(10);
  W.setSettlement(5 * N);
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
  // tris = true: counts triangles drawn instead of draw calls.
  const drawsByOwner = (tris = false) => {
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
      const n = () => {
        if (!tris) return 1;
        const g = o.geometry;
        const v = Math.min(g.index ? g.index.count : g.attributes.position?.count ?? 0, g.drawRange.count);
        return Math.round((v / 3) * (o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1));
      };
      o.onAfterRender = function (...a) { const c = counts.get(l) ?? [0, 0]; c[0] += n(); counts.set(l, c); return before.apply(this, a); };
      o.onAfterShadow = function (...a) { const c = counts.get(l) ?? [0, 0]; c[1] += n(); counts.set(l, c); return shadow.apply(this, a); };
      hooked.push([o, before, shadow]);
    });
    W.render();
    for (const [o, b, s] of hooked) { o.onAfterRender = b; o.onAfterShadow = s; }
    return [...counts].sort((x, y) => y[1][0] + y[1][1] - x[1][0] - x[1][1]).slice(0, 30).map(([k, [m, s]]) => String(m + s).padStart(4) + ' (' + m + '+' + s + ' shadow) ' + k);
  };
  const out = [];
  const tiers = ${JSON.stringify(tiers)}.split(',').filter(Boolean);
  for (const tier of tiers.length ? tiers : [ctx.renderer.quality]) {
  if (tier !== ctx.renderer.quality) ctx.renderer.setQuality(tier);
  for (const p of pts) {
    if (p.id === 'yard') W.teleport(p.x, p.z); else if (!W.travel(p.id)) continue;
    W.simulate(0.5, 1 / 60);
    const times = [];
    let calls = 0, tris = 0;
    let simMs = 0;
    for (let i = 0; i < ${frames}; i++) {
      const s0 = performance.now();
      W.game.step(1 / 60);
      simMs += performance.now() - s0;
      const t0 = performance.now();
      W.render();
      times.push(performance.now() - t0);
      calls = Math.max(calls, ctx.renderer.stats.calls);
      tris = Math.max(tris, ctx.renderer.stats.triangles);
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((s, v) => s + v, 0) / times.length;
    const row = { tier, view: p.id, calls, tris, ms: +mean.toFixed(2), p95: +times[Math.floor(times.length * 0.95)].toFixed(2), sim: +(simMs / ${frames}).toFixed(2) };
    if (${breakdown}) row.top = drawsByOwner();
    if (${trisTop}) row.topTris = drawsByOwner(true);
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
  }
  let meshes = 0;
  ctx.scene.traverse((o) => { if (o.isMesh || o.isSprite || o.isPoints || o.isLine) meshes++; });
  return JSON.stringify({ meshesInScene: meshes, views: out });
})()`;

// 0.9.10 (G1): the first frame drawn in each era region vs the next one (the walk-in stutter: shader programs, buffer and
// texture uploads that happen the first time an era is in view). Runs before anything else visits the regions.
const firstFrame = `(() => {
  const W = ${W};
  const gl = W.ctx.renderer.renderer.getContext();
  // GPU work the first frame starts (hardware-independent): shader programs linked, vertex / index bytes and texture
  // pixels uploaded. Software WebGL times swing a lot (its own per-draw JIT), so these counts are the real proof.
  const work = { programs: 0, bufferMB: 0, textureMB: 0 };
  const wrap = (name, add) => { const f = gl[name].bind(gl); gl[name] = (...a) => { add(a); return f(...a); }; return () => { gl[name] = f; }; };
  const undo = [
    wrap('linkProgram', () => { work.programs++; }),
    wrap('bufferData', (a) => { work.bufferMB += (a[1]?.byteLength ?? 0) / 1048576; }),
    wrap('texImage2D', (a) => { const src = a[a.length - 1]; work.textureMB += (src && src.width ? src.width * src.height * 4 : (a[3] * a[4] * 4 || 0)) / 1048576; }),
  ];
  const time = () => { const t0 = performance.now(); W.render(); gl.finish(); return +(performance.now() - t0).toFixed(1); };
  const out = [];
  try {
    for (let n = 2; n <= ${eras}; n++) {
      if (!W.travel('region:' + n)) continue;
      work.programs = 0; work.bufferMB = 0; work.textureMB = 0;
      const first = time();
      const row = { era: n, first, programs: work.programs, bufferMB: +work.bufferMB.toFixed(2), textureMB: +work.textureMB.toFixed(2) };
      work.bufferMB = 0;
      row.next = time();
      // what any frame uploads anyway (instance matrices, particles): the first frame's extra is the difference
      row.nextBufferMB = +work.bufferMB.toFixed(2);
      out.push(row);
    }
  } finally {
    for (const u of undo) u();
  }
  return JSON.stringify({ firstFrame: out });
})()`;

// The game keeps drawing frames after an era opens; the queued warm-up draws (render/Renderer.ts warm()) run in those
// frames. One frame starts the background shader compile, then the rest draw one queued area each (the slowest is reported).
const warmKick = `(${W}.render(), 'warm-up started: ' + (${W}.ctx.renderer.warmPending ?? 'n/a') + ' areas')`;
const warmDrain = `(() => {
  const W = ${W};
  const r = W.ctx.renderer;
  const gl = r.renderer.getContext();
  let frames = 0, worst = 0;
  while ((r.warmPending ?? 0) > 0 && frames < 60) {
    const t0 = performance.now();
    W.render();
    gl.finish();
    worst = Math.max(worst, performance.now() - t0);
    frames++;
  }
  return JSON.stringify({ warmFrames: frames, warmWorstMs: +worst.toFixed(1), left: r.warmPending ?? 'n/a' });
})()`;

const steps = [
  'sim:1',
  `eval:${setup}`,
  'sim:2',
  `eval:${fillEras}`,
  `eval:${warmKick}`,
  'wait:500',
  `eval:${warmDrain}`,
  'sim:150',
  `eval:(${W}.setTimeOfDay(${night ? 0.75 : 0.25}), ${W}.simulate(2, 1/60), 'time set')`,
  `eval:${firstFrame}`,
  `eval:${measure}`,
  ...(shots ? shotSteps : []),
  ...lookSteps,
];
const r = spawnSync(process.execPath, [path.join(here, 'shot.mjs'), '--timeout', '180000', '--allow-errors', ...steps], { encoding: 'utf8', maxBuffer: 64 << 20 });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
// readable summary of the first-frame and measure steps (shot.mjs prints eval results as JSON strings)
const ffLine = r.stdout.split('\n').find((l) => l.includes('firstFrame'));
const ff = ffLine ? JSON.parse(JSON.parse(ffLine.slice(ffLine.indexOf('→ ') + 2))).firstFrame : [];
if (ff.length) {
  console.log('\nfirst frame into each era (ms are software WebGL; the GPU work is what stutters on real hardware):');
  for (const f of ff) console.log(`  era ${String(f.era).padStart(2)}  first ${String(f.first).padStart(7)} ms  next ${String(f.next).padStart(6)} ms  programs ${String(f.programs).padStart(3)}  buffers ${String(f.bufferMB).padStart(6)} MB (next ${String(f.nextBufferMB).padStart(5)})  textures ${String(f.textureMB).padStart(6)} MB`);
  const sum = (k) => +ff.reduce((s, f) => s + f[k], 0).toFixed(2);
  console.log(`  all eras: programs ${sum('programs')}, buffers ${sum('bufferMB')} MB, textures ${sum('textureMB')} MB; worst first frame ${Math.max(...ff.map((f) => f.first))} ms`);
}
const wLine = r.stdout.split('\n').find((l) => l.includes('warmFrames'));
if (wLine) console.log(`warm-up after the eras opened: ${wLine.slice(wLine.indexOf('→ ') + 2)}`);
const line = r.stdout.split('\n').find((l) => l.includes('meshesInScene'));
if (line) {
  const result = JSON.parse(JSON.parse(line.slice(line.indexOf('→ ') + 2)));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
  console.log(`\nmeshes in scene: ${result.meshesInScene}`);
  const pad = (v, n) => String(v ?? '').padStart(n);
  console.log(`${'tier'.padEnd(8)}${'view'.padEnd(12)}${pad('calls', 7)}${pad('tris', 9)}${pad('ms', 8)}${pad('sim ms', 8)}${ab ? `${pad('off', 7)}${pad('on', 7)}${pad('ms off', 8)}${pad('ms on', 8)}${pad('px diff', 9)}` : ''}`);
  for (const v of result.views) {
    console.log(`${String(v.tier).padEnd(8)}${v.view.padEnd(12)}${pad(v.calls, 7)}${pad(v.tris, 9)}${pad(v.ms, 8)}${pad(v.sim, 8)}${ab ? `${pad(v.callsOff, 7)}${pad(v.callsOn, 7)}${pad(v.msOff, 8)}${pad(v.msOn, 8)}${pad(v.pixelsDiff, 9)}` : ''}`);
    for (const t of v.top ?? []) console.log(`    ${t}`);
    for (const t of v.topTris ?? []) console.log(`    ${t}`);
  }
  if (gate > 0) {
    const over = result.views.filter((v) => v.calls > gate);
    const worst = result.views.reduce((m, v) => Math.max(m, v.calls), 0);
    if (result.views.length === 0 || over.length) {
      console.log(`\nPERF GATE FAILED: ${over.length ? over.map((v) => `${v.tier} ${v.view} ${v.calls}`).join(', ') : 'no views measured'} (limit ${gate})`);
      process.exit(1);
    }
    console.log(`\nperf gate ok: worst view ${worst} draw calls (limit ${gate})`);
  }
} else if (gate > 0) {
  console.log('\nPERF GATE FAILED: the measure step printed nothing');
  process.exit(1);
}
process.exit(r.status ?? 1);
