#!/usr/bin/env node
/**
 * AI soak run: plays the real game headless at full speed and watches every moving character for getting stuck,
 * walking through solid things, standing inside each other, idling with a load, or escaping the world.
 *
 *   node scripts/soak.mjs [--minutes N] [--only name,name] [--out file.json] [--list]
 *   npm run soak                       (all scenarios, default lengths)
 *   npm run soak -- --minutes 2        (quick pass: every scenario's measured stretch capped at 2 sim-minutes)
 *   WL_CHROMIUM=/path/to/chrome npm run soak   (use an installed Chromium instead of the Playwright download)
 *
 * Starts a Vite dev server, opens the game in headless Chromium (software WebGL), pauses the real-time loop and runs
 * each scenario in a fresh page with its own save: a fresh world built out to era 10, a step-by-step climb through the
 * eras, every saved-game fixture in tests/fixtures, and a save -> reload -> keep playing round trip. The in-page
 * watchdog is scripts/soak/probe.js (what each finding means is described there).
 *
 * 0.9.6 (F14): the `economy:eraN` scenarios also play each era 2..10 on its own (its machines built, its upgrades at
 * Lv 10) and check that its premium good is made AND sold; they report each processor's uptime and the share of goods
 * dumped at the export depot (targets: 60 % uptime, under 10 % dumped).
 *
 * Prints a plain summary and writes the full JSON report (default: soak-report.json). Exit code 1 when any scenario
 * has a failure (escaped, jammed, loaded, jumped, error, economy: an era sold none of its premium good). Minor findings
 * (solid: brushing a prop, stacked: two people briefly standing inside each other) and `idle` agents are listed but do
 * not fail.
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
const outFile = opt('--out', 'soak-report.json');
/** Findings that fail the run. `solid` and `stacked` are listed as minor: brief brushes and overlaps, worth a look. */
const FAIL = new Set(['escaped', 'jammed', 'loaded', 'jumped', 'error', 'economy']);
const MINOR = new Set(['solid', 'stacked']);

const probe = fs.readFileSync(path.join(root, 'scripts/soak/probe.js'), 'utf8');
const SAVE_KEY = 'winterland.save.v1';
const minutes = (m) => (capMinutes > 0 ? Math.min(m, capMinutes) : m) * 60;

// ---- economy probe (0.9.6, F14) ---------------------------------------------------------------------------------------
/**
 * Runs in the page after the Survival setup: open era n on its own (only its region built, its own upgrades and every
 * older one at Lv 10, settlement 5n), and count what it sells. Machines are sampled for uptime every simulated second
 * through a wrapped Region.update; sales are counted through the market's buyer and depot hooks.
 */
const ECONOMY_SETUP = `async (n) => {
  const W = __WINTERLAND__;
  const { MACHINES } = await import('/src/eras/data.ts');
  const { eraContent, fullBuild } = await import('/src/eras/template.ts');
  const { REGION_SLOTS } = await import('/src/core/types.ts');
  W.unlockEra(n);
  W.setAllUpgrades(10);
  W.setSettlement(5 * n);
  const ids = fullBuild(n, REGION_SLOTS[n]);
  for (let s = 0; s < REGION_SLOTS[n]; s++) W.buildMachine(n, s, ids[s]);
  const region = W.game.level.eras.region(n);
  const mk = W.ctx.market;
  const sold = {}, dumped = {};
  const sale = mk.noteMarketSale.bind(mk);
  mk.noteMarketSale = (k, c) => { sold[k] = (sold[k] || 0) + c; return sale(k, c); };
  const exp = mk.sellExport.bind(mk);
  mk.sellExport = (k, c, p) => { dumped[k] = (dumped[k] || 0) + c; return exp(k, c, p); };
  const up = { on: 0, all: 0 }, by = {};
  let acc = 0;
  const update = region.update.bind(region);
  region.update = (dt) => {
    update(dt);
    acc += dt;
    if (acc < 1) return;
    acc -= 1;
    for (const m of region.machines) if (m && m.def.kind === 'processor') { const b = (by[m.def.id] ??= { on: 0, all: 0, why: {} }); up.all++; b.all++; if (m.working) { up.on++; b.on++; } else { const w = m.state === 'blocked' ? 'full' : (m.def.inputs.find((i) => !m.input || m.input.count(i.kind) < i.per)?.kind ?? 'full'); b.why[w] = (b.why[w] || 0) + 1; } }
  };
  const premium = MACHINES[eraContent(n).machines.premium].output;
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  window.__econ = {
    sample: () => undefined,
    result: () => ({ era: n, premium, premiumSold: (sold[premium] || 0) + (dumped[premium] || 0), uptime: Math.round((100 * up.on) / Math.max(1, up.all)), dumped: Math.round((100 * sum(dumped)) / Math.max(1, sum(sold) + sum(dumped))), sold, depot: dumped, by: Object.fromEntries(Object.entries(by).map(([k, b]) => [k, Math.round((100 * b.on) / Math.max(1, b.all)) + '%' + Object.entries(b.why).map(([w, c]) => ' ' + w + ':' + Math.round((100 * c) / Math.max(1, b.all)) + '%').join('')])) }),
  };
}`;

// ---- world builders (run in the page; may import game modules from the dev server) ----------------------------------
const SETUP = {
  /** Era 1 fully staffed: every pad, crews at level 10, the bunkhouse, village, town, amenities. */
  survival: `async () => {
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
  }`,
  /** Everything built: eras 2..10 open, every machine slot and city lot filled, upgrades high, settlement 50. */
  allEras: `async () => {
    const W = __WINTERLAND__;
    await window.__soakSetup.survival();
    const { machinesOfEra, cityBuildingsOfEra, MACHINES } = await import('/src/eras/data.ts');
    const { REGION_SLOTS, DISTRICT_LOTS } = await import('/src/core/types.ts');
    W.unlockEra(10);
    for (let n = 2; n <= 10; n++) {
      // extractors first so every chain has raw material, then the processors
      const ids = machinesOfEra(n).sort((a, b) => Number(MACHINES[b].kind === 'extractor') - Number(MACHINES[a].kind === 'extractor'));
      for (let s = 0; s < REGION_SLOTS[n]; s++) W.buildMachine(n, s, ids[s % ids.length]);
      const cb = cityBuildingsOfEra(n);
      for (let l = 0; l < DISTRICT_LOTS[n]; l++) W.buildCity(n, l, cb[l % cb.length]);
    }
    // 0.9.5 literal gate: every upgrade caps at Lv 10
    W.setAllUpgrades(10);
    W.setSettlement(50);
  }`,
};

/** Scenarios: setup (page JS) + measured stretches. */
const SCENARIOS = [
  {
    name: 'survival-day-night',
    setup: 'survival',
    stretches: [
      { sim: minutes(6), before: 'W.setTimeOfDay(0.3)' },
      { sim: minutes(4), before: 'W.setTimeOfDay(0.75)' },
      { sim: minutes(3), before: 'W.startRush(120)' },
    ],
  },
  {
    name: 'all-eras',
    setup: 'allEras',
    stretches: [{ sim: minutes(20) }, { sim: minutes(5), before: 'W.setTimeOfDay(0.75)' }],
  },
  {
    name: 'era-climb',
    setup: 'survival',
    // open one era at a time, fill it, play a while
    stretches: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
      sim: minutes(2.5),
      before: `(async () => {
        const { machinesOfEra, MACHINES } = await import('/src/eras/data.ts');
        const { REGION_SLOTS } = await import('/src/core/types.ts');
        W.unlockEra(${n});
        const ids = machinesOfEra(${n}).sort((a, b) => Number(MACHINES[b].kind === 'extractor') - Number(MACHINES[a].kind === 'extractor'));
        for (let s = 0; s < REGION_SLOTS[${n}]; s++) W.buildMachine(${n}, s, ids[s % ids.length]);
        W.setAllUpgrades(10);
        W.setSettlement(${5 * n});
      })()`,
    })),
  },
  {
    name: 'save-reload',
    setup: 'allEras',
    stretches: [{ sim: minutes(5) }, { sim: minutes(5), reload: true }, { sim: minutes(3), reload: true }],
  },
  // 0.9.6 (F14): every era on its own sells its premium good (eras/template.ts machines.premium)
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ name: `economy:era${n}`, setup: 'survival', economy: n, stretches: [{ sim: minutes(4) }] })),
  ...fs
    .readdirSync(path.join(root, 'tests/fixtures'))
    .filter((f) => /^(save-|era1-).*\.json$/.test(f))
    .sort()
    .map((f) => ({ name: `fixture:${f.replace(/\.json$/, '')}`, fixture: f, stretches: [{ sim: minutes(5) }, { sim: minutes(3), reload: true }] })),
];

if (args.includes('--list')) {
  for (const s of SCENARIOS) console.log(s.name);
  process.exit(0);
}

const log = (...m) => console.log(`[soak ${new Date().toISOString().slice(11, 19)}]`, ...m);

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  executablePath: process.env.WL_CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function openGame(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`  page error: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__WINTERLAND__, null, { timeout: 120000 });
  await page.evaluate(() => window.__WINTERLAND__.pause());
  await page.addScriptTag({ content: probe });
  await page.evaluate(`window.__soakSetup = { ${Object.entries(SETUP).map(([k, v]) => `${k}: ${v}`).join(', ')} }`);
  return page;
}

const reports = [];
let failed = 0;
const t0 = Date.now();
for (const sc of SCENARIOS) {
  if (only.length && !only.some((o) => sc.name.includes(o))) continue;
  log(`scenario ${sc.name}`);
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  if (sc.fixture) {
    const raw = fs.readFileSync(path.join(root, 'tests/fixtures', sc.fixture), 'utf8');
    await context.addInitScript(
      ([key, data]) => {
        if (!sessionStorage.getItem('soak:seeded')) {
          localStorage.setItem(key, data);
          sessionStorage.setItem('soak:seeded', '1');
        }
      },
      [SAVE_KEY, raw],
    );
  }
  const merged = { scenario: sc.name, simSeconds: 0, findings: [], idle: [], stretches: [] };
  let page = null;
  try {
    // inside the try: a page that never loads (a busy machine, two soaks at once) is reported, not a crash
    page = await openGame(context, '');
    await page.evaluate((n) => window.__soak.reset(n), sc.name);
    if (sc.setup) await page.evaluate(`(async () => { const W = __WINTERLAND__; await window.__soakSetup.${sc.setup}(); })()`);
    else await page.evaluate(() => window.__WINTERLAND__.skipIntro());
    for (const [i, st] of sc.stretches.entries()) {
      if (st.reload) {
        await page.evaluate(() => window.__WINTERLAND__.save());
        await page.close();
        page = await openGame(context, '');
      }
      await page.evaluate((n) => window.__soak.reset(n), `${sc.name}#${i + 1}`);
      if (st.before) await page.evaluate(`(async () => { const W = __WINTERLAND__; await ${st.before}; })()`);
      if (sc.economy) await page.evaluate(`(${ECONOMY_SETUP})(${Number(sc.economy)})`);
      let done = 0;
      while (done < st.sim) {
        const chunk = Math.min(60, st.sim - done);
        const r = await page.evaluate((s) => window.__soak.run(s), chunk);
        if (sc.economy) await page.evaluate(() => window.__econ.sample());
        done += chunk;
        if (done % 300 === 0 || done >= st.sim) log(`  #${i + 1} ${r.sim}s sim, ${r.agents} agents live, ${r.findings} findings`);
      }
      if (sc.economy) {
        const e = await page.evaluate(() => window.__econ.result());
        merged.economy = e;
        log(`  economy era ${e.era}: ${e.premium} sold ${e.premiumSold}, processor uptime ${e.uptime}%, dumped at the depot ${e.dumped}% ${JSON.stringify(e.by)}`);
        if (e.premiumSold <= 0) merged.findings.push({ type: 'economy', scenario: sc.name, message: `era ${e.era} sold no ${e.premium} (uptime ${e.uptime}%, sold ${JSON.stringify(e.sold)})` });
      }
      const rep = await page.evaluate(() => window.__soak.report());
      merged.simSeconds += rep.simSeconds;
      merged.findings.push(...rep.findings);
      merged.idle.push(...rep.idle.map((x) => ({ ...x, stretch: i + 1 })));
      merged.stretches.push({ sim: rep.simSeconds, agentsSeen: rep.agentsSeen, maxLive: rep.maxLive, byKind: rep.byKind });
    }
  } catch (e) {
    merged.findings.push({ type: 'error', scenario: sc.name, message: String(e).slice(0, 600) });
  }
  await context.close();
  reports.push(merged);
  const bad = merged.findings.filter((f) => FAIL.has(f.type));
  if (bad.length) failed++;
  const counts = {};
  for (const f of merged.findings) counts[f.type] = (counts[f.type] ?? 0) + 1;
  log(`  ${bad.length ? 'PROBLEMS' : merged.findings.length ? 'minor only' : 'clean'}: ${JSON.stringify(counts)}, idle agents: ${merged.idle.length}`);
}

await browser.close();
await server.close();

fs.writeFileSync(path.resolve(outFile), JSON.stringify({ when: new Date().toISOString(), minutesCap: capMinutes || null, reports }, null, 2));

// ---- plain summary --------------------------------------------------------------------------------------------------
console.log('\nAI soak summary');
const totalSim = reports.reduce((s, r) => s + r.simSeconds, 0);
console.log(`  ${reports.length} scenarios, ${(totalSim / 3600).toFixed(1)} h of play simulated in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
for (const r of reports) {
  const groups = new Map();
  for (const f of r.findings) {
    const k = `${f.type} ${f.kind || ''}`.trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const head = [...groups.keys()].filter((k) => FAIL.has(k.split(' ')[0]));
  const minor = [...groups.keys()].some((k) => MINOR.has(k.split(' ')[0]));
  console.log(`  ${head.length ? 'x' : 'ok'} ${r.scenario}${head.length ? '' : minor ? ' (minor findings only)' : ' (clean)'}`);
  for (const [k, list] of groups) {
    const ex = list
      .slice(0, 3)
      .map((f) => `${f.agent || f.message || ''}${f.at ? ` at ${f.at}` : ''}${f.state ? ` [${f.state}]` : ''}${f.tags?.length ? ` in ${f.tags.join('/')}` : ''}`)
      .join('; ');
    console.log(`      ${k}: ${list.length}  e.g. ${ex}`);
  }
  if (r.idle.length) console.log(`      idle the whole stretch: ${r.idle.length} (${[...new Set(r.idle.map((i) => i.kind))].join(', ')})`);
}
console.log(`  full report: ${outFile}`);
process.exit(failed ? 1 : 0);
