#!/usr/bin/env node
/**
 * Guide-follower bot: plays the real game headless, walks ONLY where the guide arrow says, and checks the arrow in
 * motion (does it point somewhere reachable, does the walk get shorter, does it flip-flop, churn, go blind or replan).
 *
 *   node scripts/guide-walk.mjs [--minutes N] [--only name,name] [--out file.json] [--list]
 *   npm run guide-walk
 *   npm run guide-walk -- --only era2-entry --minutes 2   (every scenario's follow time capped at 2 sim-minutes)
 *   WL_CHROMIUM=/path/to/chrome npm run guide-walk        (use an installed Chromium instead of the Playwright download)
 *
 * Starts a Vite dev server, opens the game in headless Chromium (software WebGL), pauses the real-time loop and, in a
 * fresh browser context per scenario, every 0.25 simulated seconds reads window.__WINTERLAND__.guide(), walks toward
 * its `steer` point (autopilot) and simulates 0.25 s. Findings: unreachable, stuck (walk length did not drop 1 m in 8 s),
 * flipflop (A -> B -> A within 3 s), churn (over 24 objective changes in 60 s), flash (a goal up for under 1.5 s, not within 3 s of a map jump), blind (target but no steer for over 2 s),
 * replan (route planned over ~20 times a minute for one objective), stall (the same objective for 60 s while the player
 * already stands at its target: the guide gives a step nothing completes). On a "Build a quarry in ..." BUILD tile the
 * bot picks that machine (Region.choose, what the choose card does). Recorded but not failures: offpath (how often the
 * edge arrow shows) and slow (wall-clock ms of each guide()+simulate step, max and p95).
 *
 * Scenarios: first-minutes, market-town, era2-ready, era2-entry, map-jumps, save-reload. Prints a plain summary and
 * writes the full JSON report (default: guide-walk-report.json) including every objective change. Exit code 1 when any
 * finding of type unreachable/stuck/flipflop/churn/blind/replan exists.
 * Never touches a real save: every page runs on its own throwaway browser profile.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const capMinutes = Number(opt('--minutes', '0')) || 0;
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const outFile = opt('--out', 'guide-walk-report.json');
const FAIL = new Set(['unreachable', 'stuck', 'flipflop', 'churn', 'flash', 'blind', 'replan', 'stall', 'error']);
const secs = (s) => (capMinutes > 0 ? Math.min(s, capMinutes * 60) : s);
const TICK = 0.25;
const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => (p ? `(${r1(p.x)}, ${r1(p.z)})` : 'none');

// ---- world builders (run in the page) --------------------------------------------------------------------------------
const SETUP = {
  fresh: `async () => { __WINTERLAND__.skipIntro(); }`,
  /** Mid Survival: pads unlocked, climb open, town revealed, plenty of money, player in the yard. */
  market: `async () => {
    const W = __WINTERLAND__;
    W.skipIntro();
    for (const id of Object.keys(W.config.PADS)) W.unlock(id);
    W.addMoney(5e5);
    W.climb();
    W.revealTown();
    W.travel('yard');
    W.simulate(1);
  }`,
  /** Era 1 gate met: every era-1 row at Lv 10, settlement 5, money in hand. */
  era2Ready: `async () => {
    const W = __WINTERLAND__;
    W.skipIntro();
    for (const id of Object.keys(W.config.PADS)) W.unlock(id);
    W.addMoney(1e7);
    W.buildQuarters(W.config.QUARTERS.tiers.length - 1);
    W.climb();
    W.revealTown();
    const ids = Object.keys(W.config.BUSINESSES);
    for (let lot = 0; lot < W.config.LAYOUT.town.lots.length; lot++) W.buildTown(lot, ids[lot % ids.length]);
    for (const id of Object.keys(W.config.AMENITIES)) W.buildAmenity(id);
    W.setAllUpgrades(10);
    W.setSettlement(5);
    W.simulate(1);
  }`,
  /** Era 2 unlocked, no machine built, player in the era-2 region. */
  era2Entry: `async () => {
    const W = __WINTERLAND__;
    await window.__gw.era2Ready();
    W.unlockEra(2);
    W.simulate(1);
    W.travel('region:2');
    W.simulate(3);
  }`,
  era5: `async () => {
    const W = __WINTERLAND__;
    await window.__gw.era2Ready();
    W.unlockEra(5);
    W.simulate(1);
  }`,
};

/** Page-side step: read the guide, steer, simulate one tick, report both. */
const STEP = `(tick) => {
  const W = __WINTERLAND__;
  const t0 = performance.now();
  const g = W.guide();
  const pl = W.ctx.player;
  const p = pl.object.position;
  if (g.steer && g.remaining > 0.6) W.moveTo(g.steer.x, g.steer.z); else pl.autopilot = null;
  // a player standing on a BUILD tile picks the machine the banner names (the choose card: Region.choose)
  const build = g.objective && /^Build (?:an? |the )?(.+?)(?: in .+| first)$/.exec(g.objective);
  if (build && !g.target) {
    const M = window.__gwMachines;
    const id = M && Object.keys(M).find((k) => M[k].label.toLowerCase() === build[1].toLowerCase());
    const n = id ? M[id].era : 0;
    const region = n ? W.level.eras.region(n) : null;
    if (region && region.choose) {
      const slots = region.layout.slots;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < slots.length; i++) { const d = Math.hypot(slots[i].x - p.x, slots[i].z - p.z); if (d < bd) { bd = d; best = i; } }
      if (best >= 0 && bd < 3) region.choose(best, id);
    }
  }
  // "Hire the X at the cabin": the bot can't use the shop sheet, so it buys straight away (W.buy)
  const hire = g.objective && /^Hire (?:an? |the )?(.+?) at /.exec(g.objective);
  if (hire && W.buy && window.__gwUpgrades) {
    const U = window.__gwUpgrades;
    const id = Object.keys(U).find((k) => U[k].toLowerCase() === hire[1].toLowerCase());
    if (id) W.buy(id);
  }
  const before = { x: p.x, z: p.z };
  W.simulate(tick, 1 / 30);
  const ms = performance.now() - t0;
  const { walk, ...rest } = g;
  return { g: rest, pos: before, ms };
}`;

// ---- scenario runner -------------------------------------------------------------------------------------------------
const log = (...m) => console.log(`[guide-walk ${new Date().toISOString().slice(11, 19)}]`, ...m);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  executablePath: process.env.WL_CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function openGame(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`  page error: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__WINTERLAND__, null, { timeout: 120000 });
  await page.evaluate(() => window.__WINTERLAND__.pause());
  await page.evaluate(async () => { window.__gwMachines = (await import('/src/eras/data.ts')).MACHINES; const U = (await import('/src/config.ts')).UPGRADES; window.__gwUpgrades = Object.fromEntries(Object.entries(U).map(([k, v]) => [k, v.label])); });
  await page.evaluate(`window.__gw = { ${Object.entries(SETUP).map(([k, v]) => `${k}: ${v}`).join(', ')} }; window.__gwStep = ${STEP};`);
  return page;
}

/** A run: shared trace state across the follow stretches of one scenario. */
function newRun(name) {
  return { scenario: name, t: 0, trace: [], changes: [], findings: [], ms: [], edge: 0, ticks: 0, plansLog: [], extra: {} };
}

function find(run, type, message, extra = {}) {
  // one finding per type+message-prefix per 30 s so a stuck bot doesn't write thousands
  const key = type + message.slice(0, 40);
  const last = (run.lastFind ??= {})[key];
  if (last !== undefined && run.t - last < 30) return;
  run.lastFind[key] = run.t;
  run.findings.push({ type, scenario: run.scenario, t: r1(run.t), message, ...extra });
}

/** Follow the guide for `sim` simulated seconds, running every check. */
async function follow(page, run, sim, label) {
  const end = run.t + sim;
  const hist = []; // {t, obj, tx, tz}
  let cur = null; // current objective record
  let curObj = undefined;
  let stuckRef = null; // {t, remaining, target}
  let blindSince = null;
  let tgtKey = null;
  const recent = []; // {t, obj, key} target switches
  const changeTimes = [];
  let planStart = null;
  while (run.t < end - 1e-9) {
    const w0 = Date.now();
    const s = await page.evaluate((k) => window.__gwStep(k), TICK);
    run.ticks++;
    const { g, pos, ms } = s;
    run.ms.push(ms);
    const t = run.t;
    run.t += TICK;
    if (g.edgeAngle !== null) run.edge++;
    run.trace.length < 4000 && run.trace.push([r1(t), r1(pos.x), r1(pos.z), g.objective, g.target ? r1(g.target.x) : null, g.target ? r1(g.target.z) : null, r1(g.remaining)]);

    // objective changes
    if (g.objective !== curObj) {
      run.changes.push({ t: r1(t), label, text: g.objective, target: g.target ? { x: r1(g.target.x), z: r1(g.target.z) } : null, remaining: r1(g.remaining), player: { x: r1(pos.x), z: r1(pos.z) } });
      // flipflop: A -> B -> A within 3 s
      recent.push({ t, obj: g.objective });
      while (recent.length && t - recent[0].t > 3) recent.shift();
      if (recent.length >= 3) {
        const n = recent.length;
        if (recent[n - 1].obj === recent[n - 3].obj && recent[n - 1].obj !== recent[n - 2].obj) {
          find(run, 'flipflop', `objective flipped "${recent[n - 3].obj}" -> "${recent[n - 2].obj}" -> back within 3 s`, { player: pos });
        }
      }
      changeTimes.push(t);
      while (changeTimes.length && t - changeTimes[0] > 60) changeTimes.shift();
      // the first loop (chop, pick up, sell, bank) really is a step every few seconds; flicker is faster than that
      if (changeTimes.length > 24) find(run, 'churn', `${changeTimes.length} objective changes in 60 s (latest "${g.objective}")`, {});
      // flash: a goal (text) that was up for under 1.5 s
      const prev = run.changes[run.changes.length - 2];
      if (prev && prev.text && t - prev.t < 1.5 && !(run.jumpAt != null && t - run.jumpAt < 3)) find(run, 'flash', `"${prev.text}" showed for only ${r1(t - prev.t)} s`, { player: pos });
      curObj = g.objective;
      run.stallSince = null;
      stuckRef = null;
      blindSince = null;
      tgtKey = null;
      hist.length = 0;
      planStart = { t, plans: g.plans };
    }

    // target flip-flop for the same objective
    if (g.target) {
      const key = `${Math.round(g.target.x)},${Math.round(g.target.z)}`;
      hist.push({ t, key });
      while (hist.length && t - hist[0].t > 3) hist.shift();
      const ks = [];
      for (const h of hist) if (ks[ks.length - 1] !== h.key) ks.push(h.key);
      if (ks.length >= 3 && ks[ks.length - 1] === ks[ks.length - 3]) find(run, 'flipflop', `target jumped ${ks[ks.length - 3]} -> ${ks[ks.length - 2]} -> back within 3 s for "${g.objective}"`, { player: pos });
      tgtKey = key;
    }

    // stall: arrived (no arrow, or under 1.5 m to go) and the same objective for 60 s
    if (g.objective && (!g.target || g.remaining < 1.5)) {
      run.stallSince ??= t;
      if (t - run.stallSince >= 60) find(run, 'stall', `"${g.objective}" unchanged for 60 s with the player at its target`, { player: { x: r1(pos.x), z: r1(pos.z) } });
    } else run.stallSince = null;
    if (g.target) {
      if (!g.reachable) find(run, 'unreachable', `target ${pt(g.target)} not reachable for "${g.objective}"`, { player: { x: r1(pos.x), z: r1(pos.z) }, target: g.target, steer: g.steer });

      // blind
      if (!g.steer && g.remaining > 0.6) {
        blindSince ??= t;
        if (t - blindSince > 2) find(run, 'blind', `no steer for ${r1(t - blindSince)} s for "${g.objective}" target ${pt(g.target)}`, { player: { x: r1(pos.x), z: r1(pos.z) }, target: g.target });
      } else blindSince = null;

      // stuck
      if (!stuckRef || stuckRef.key !== tgtKey) stuckRef = { t, remaining: g.remaining, key: tgtKey, min: g.remaining };
      else {
        // a walk that got longer by a lot (the real walk replacing the straight line while it was worked out) starts over
        if (g.remaining < stuckRef.remaining - 1 || g.remaining > stuckRef.remaining + 5) stuckRef = { t, remaining: g.remaining, key: tgtKey };
        else if (t - stuckRef.t >= 8 && g.remaining > 1.5) {
          find(run, 'stuck', `walk to ${pt(g.target)} for "${g.objective}" did not shorten by 1 m in 8 s (remaining ${r1(g.remaining)})`, { player: { x: r1(pos.x), z: r1(pos.z) }, target: g.target, steer: g.steer });
          stuckRef = { t, remaining: g.remaining, key: tgtKey };
        }
      }
    } else {
      stuckRef = null;
      blindSince = null;
    }

    // replans per minute for one objective
    if (planStart && t - planStart.t >= 60) {
      const rate = g.plans - planStart.plans;
      run.plansLog.push({ t: r1(t), objective: g.objective, perMinute: rate });
      if (rate > 20) find(run, 'replan', `"${g.objective}" replanned ${rate} times in a minute`, {});
      planStart = { t, plans: g.plans };
    }
  }
}

const grab = (page) => page.evaluate(() => { const p = __WINTERLAND__.ctx.player.object.position; return { x: p.x, z: p.z }; });
const snap = (page) => page.evaluate(() => { const g = __WINTERLAND__.guide(); const { walk, ...r } = g; return r; });

/** After a jump: steer must exist within 2 s. */
async function steerWithin2s(page, run, what) {
  for (let i = 0; i < 8; i++) {
    const g = await snap(page);
    if (g.steer || !g.target) {
      if (!g.target) find(run, 'blind', `${what}: no guide target after the jump`, {});
      return;
    }
    await page.evaluate(`__WINTERLAND__.simulate(${TICK})`);
    run.t += TICK;
  }
  find(run, 'blind', `${what}: steer still null 2 s after the jump`, { player: await grab(page) });
}

const SCENARIOS = [
  {
    name: 'first-minutes',
    async run(page, run) {
      await page.evaluate(`(${SETUP.fresh})()`);
      await follow(page, run, secs(360), 'follow');
      const st = await page.evaluate(() => { const s = __WINTERLAND__.state(); return { unlocked: s.unlocked, money: s.money }; });
      run.extra.harvesterUnlocked = !!st.unlocked?.harvester;
      run.extra.unlocked = st.unlocked;
      run.extra.money = st.money;
    },
  },
  {
    name: 'market-town',
    async run(page, run) {
      await page.evaluate(`(${SETUP.market})()`);
      await follow(page, run, secs(180), 'follow');
    },
  },
  {
    name: 'era2-ready',
    async run(page, run) {
      await page.evaluate(`(${SETUP.era2Ready})()`);
      run.extra.gate = await page.evaluate(() => { try { return JSON.parse(JSON.stringify(__WINTERLAND__.gate(2))); } catch { return null; } });
      await follow(page, run, secs(180), 'follow');
      run.extra.firstObjectives = run.changes.slice(0, 3).map((c) => c.text);
      const first = run.changes[0]?.text ?? '';
      if (!/Expand to|Bring .* to Granite Hollow/i.test(first)) run.findings.push({ type: 'note', scenario: run.scenario, t: 0, message: `first objective does not mention the expansion: "${first}"` });
    },
  },
  {
    name: 'era2-entry',
    async run(page, run) {
      await page.evaluate(`(${SETUP.era2Entry})()`);
      run.extra.startPos = await grab(page);
      await follow(page, run, secs(240), 'follow');
      for (const c of run.changes) if (/^Build /i.test(c.text ?? '') && !c.target) find(run, 'blind', `"Build" goal without a target: "${c.text}"`, {});
    },
  },
  {
    name: 'map-jumps',
    async run(page, run) {
      await page.evaluate(`(${SETUP.era5})()`);
      const jumps = [
        ['region:3', 40],
        ['yard', 40],
        ['region:5', 40],
      ];
      run.extra.jumps = [];
      for (const [id, s] of jumps) {
        const ok = await page.evaluate((i) => __WINTERLAND__.travel(i), id);
        run.jumpAt = run.t;
        await page.evaluate(`__WINTERLAND__.simulate(0.25)`);
        run.t += 0.25;
        const landed = await grab(page);
        run.extra.jumps.push({ id, ok, landed: { x: r1(landed.x), z: r1(landed.z) } });
        await steerWithin2s(page, run, `travel ${id}`);
        await follow(page, run, secs(s), `after ${id}`);
      }
      // a random spot on open ground: just off the yard, a seeded spread
      const spot = await page.evaluate(() => { const p = __WINTERLAND__.ctx.player.object.position; return { x: p.x + 14, z: p.z + 9 }; });
      await page.evaluate(({ x, z }) => __WINTERLAND__.teleport(x, z), spot);
      run.jumpAt = run.t;
      await page.evaluate(`__WINTERLAND__.simulate(0.25)`);
      run.t += 0.25;
      run.extra.jumps.push({ id: 'teleport', landed: spot });
      await steerWithin2s(page, run, 'teleport');
      await follow(page, run, secs(30), 'after teleport');
    },
  },
  {
    name: 'save-reload',
    async run(page, run, ctx) {
      await page.evaluate(`(${SETUP.era2Entry})()`);
      await follow(page, run, secs(40), 'before save');
      const before = await grab(page);
      await page.evaluate(() => __WINTERLAND__.save());
      const era = await page.evaluate(() => __WINTERLAND__.state().eras?.age ?? null);
      await page.close();
      const p2 = await openGame(ctx);
      const after = await grab(p2);
      run.extra.saveReload = { before: { x: r1(before.x), z: r1(before.z) }, after: { x: r1(after.x), z: r1(after.z) }, moved: r1(Math.hypot(before.x - after.x, before.z - after.z)), eraAge: era };
      await p2.evaluate(`__WINTERLAND__.simulate(1)`);
      const g = await snap(p2);
      run.extra.saveReload.guideAfter = { objective: g.objective, target: g.target, steer: g.steer };
      run.page = p2;
    },
  },
];

if (args.includes('--list')) {
  for (const s of SCENARIOS) console.log(s.name);
  await browser.close();
  await server.close();
  process.exit(0);
}

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const reports = [];
const t0 = Date.now();
for (const sc of SCENARIOS) {
  if (only.length && !only.some((o) => sc.name.includes(o))) continue;
  log(`scenario ${sc.name}`);
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const run = newRun(sc.name);
  const w0 = Date.now();
  try {
    const page = await openGame(context);
    await sc.run(page, run, context);
  } catch (e) {
    run.findings.push({ type: 'error', scenario: sc.name, t: r1(run.t), message: String(e).slice(0, 600) });
  }
  await context.close();
  const ms = run.ms;
  reports.push({
    scenario: sc.name,
    simSeconds: r1(run.t),
    wallSeconds: r1((Date.now() - w0) / 1000),
    findings: run.findings,
    objectiveChanges: run.changes,
    edgeArrowShare: run.ticks ? Math.round((100 * run.edge) / run.ticks) : 0,
    replansPerMinute: run.plansLog,
    stepMs: { max: r1(Math.max(0, ...ms)), p95: r1(pct(ms, 0.95)), mean: r1(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)), count: ms.length },
    extra: run.extra,
    trace: run.trace,
  });
  const bad = run.findings.filter((f) => FAIL.has(f.type));
  log(`  ${bad.length ? 'PROBLEMS' : 'ok'}: ${bad.length} failing findings, ${run.changes.length} objective changes, ${r1(run.t)} s sim in ${r1((Date.now() - w0) / 1000)} s`);
}
await browser.close();
await server.close();

fs.writeFileSync(path.resolve(outFile), JSON.stringify({ when: new Date().toISOString(), minutesCap: capMinutes || null, reports }, null, 2));

// ---- plain summary ---------------------------------------------------------------------------------------------------
console.log('\nGuide walk summary');
let failed = false;
for (const r of reports) {
  const bad = r.findings.filter((f) => FAIL.has(f.type));
  if (bad.length) failed = true;
  console.log(`\n${bad.length ? 'x' : 'ok'} ${r.scenario}: ${r.simSeconds} s sim (${r.wallSeconds} s wall), ${r.objectiveChanges.length} objective changes, edge arrow shown ${r.edgeArrowShare}% of the time`);
  console.log(`   step ms: max ${r.stepMs.max}, p95 ${r.stepMs.p95}, mean ${r.stepMs.mean} (${r.stepMs.count} steps)`);
  const maxPlans = Math.max(0, ...r.replansPerMinute.map((x) => x.perMinute));
  console.log(`   max replans/minute: ${maxPlans}`);
  console.log('   objectives:');
  for (const c of r.objectiveChanges.slice(0, 40)) console.log(`     t=${c.t}s [${c.label}] ${c.text ?? '(none)'} target ${pt(c.target)} remaining ${c.remaining} player ${pt(c.player)}`);
  if (r.objectiveChanges.length > 40) console.log(`     ... ${r.objectiveChanges.length - 40} more in the JSON report`);
  const groups = new Map();
  for (const f of r.findings) (groups.get(f.type) ?? groups.set(f.type, []).get(f.type)).push(f);
  for (const [k, list] of groups) {
    console.log(`   ${k}: ${list.length}`);
    for (const f of list.slice(0, 4)) console.log(`      t=${f.t}s ${f.message}${f.player ? ` player ${pt(f.player)}` : ''}${f.steer ? ` steer ${pt(f.steer)}` : ''}`);
  }
  if (Object.keys(r.extra).length) console.log(`   extra: ${JSON.stringify(r.extra)}`);
}
console.log(`\n  total ${((Date.now() - t0) / 60000).toFixed(1)} min; full report: ${outFile}`);
process.exit(failed ? 1 : 0);
