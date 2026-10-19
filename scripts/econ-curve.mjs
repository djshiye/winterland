#!/usr/bin/env node
/**
 * Era economy curve: measures the live income per second of era n at each level of its own upgrades, with every income
 * source counted (era 1 still running, every era's sales, cash machines, crews, the city, contracts; quest rewards are
 * one-off and switched off) and a perfectly diligent player who banks every cash pile every 8 simulated seconds.
 *
 * 0.9.10: contracts are averaged in rather than played. The board's own offers are random and arrive every 150-260 s,
 * so a 184 s stretch would catch zero or one of them; instead the board is paused and each sample adds the long-run
 * contract income of a player who takes every offer: for each good the era's built machines make and each count the
 * board can ask, the bonus (core/Contracts.ts eraBonus on the measured sales rate) if that many sell within the time
 * limit at the measured rate, over the mean gap plus the time it takes (renewal reward). `sales` is the sale-event
 * part of perSec alone (what scripts that count only 'sale' events see).
 *
 *   node scripts/econ-curve.mjs [--eras 2,3,...,10] [--out tests/fixtures/econ-curve.json] [--jobs 2]
 *   npm run econ-curve                 (eras 2..10, two pages at a time)
 *   npm run econ-curve -- --eras 4     (one era only; other eras already in the output file are kept)
 *   WL_CHROMIUM=/path/to/chrome npm run econ-curve   (use an installed Chromium instead of the Playwright download)
 *
 * Starts a Vite dev server and opens the game in headless Chromium (software WebGL). Each era runs in a fresh page:
 * every earlier era is built out at Lv 10 with its machines and city lots, settlement is 5(n-1), all quests are done
 * and era n has its slots built. Era n's own upgrades are then set to L (the crew to max(1, L)) for L in 0, 2, 4, 6, 8,
 * 10, with a 64 s warm-up and a 184 s measured stretch of simulated time at each level. The output file holds, per era,
 * { n, samples: [{ L, perSec, src }] }, where src splits perSec by the source of each money add. The file is merged
 * with what is already there and rewritten after every era.
 *
 * tests/livePacing.test.ts reads the output to check era lengths. Regenerate it after any economy change.
 * Never touches a real save: every page runs on its own throwaway browser profile.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const eras = opt('--eras', '2,3,4,5,6,7,8,9,10').split(',').filter(Boolean).map(Number);
const outFile = opt('--out', 'tests/fixtures/econ-curve.json');
const jobs = Math.max(1, Number(opt('--jobs', '2')) || 2);
const LEVELS = [0, 2, 4, 6, 8, 10];
const NOTE =
  'Live income per second of era n at each level L of its own upgrades (crew at max(1, L)), every income source ' +
  'counted, for a perfectly diligent player who banks every cash pile every 8 sim-s. Earlier eras are built out at ' +
  'Lv 10, settlement 5(n-1), all quests done, era n slots built; 64 s warm-up, then 184 s measured. src splits perSec ' +
  'by source; src.contracts is the averaged income of taking every contract; sales is the sale-event part alone. ' +
  'Read by tests/livePacing.test.ts. Regenerate with: npm run econ-curve';

const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  executablePath: process.env.WL_CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const measure = async (n) => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`era ${n} page error: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => !!window.__WINTERLAND__, null, { timeout: 180000 });
    await page.evaluate(async ({ n }) => {
      const W = window.__WINTERLAND__;
      W.pause(); W.skipIntro();
      for (const id of Object.keys(W.config.PADS)) W.unlock(id);
      W.buildQuarters(W.config.QUARTERS.tiers.length - 1);
      W.climb(); W.revealTown();
      const ids = Object.keys(W.config.BUSINESSES);
      for (let lot = 0; lot < W.config.LAYOUT.town.lots.length; lot++) W.buildTown(lot, ids[lot % ids.length]);
      for (const id of Object.keys(W.config.AMENITIES)) W.buildAmenity(id);
      const { MACHINES, ERAS, cityBuildingsOfEra } = await import('/src/eras/data.ts');
      const { fullBuild } = await import('/src/eras/template.ts');
      const { REGION_SLOTS, DISTRICT_LOTS } = await import('/src/core/types.ts');
      const { introEra } = await import('/src/core/ladder.ts');
      const { UPGRADES, CONTRACTS } = await import('/src/config.ts');
      const { eraOffers, eraBonus } = await import('/src/core/Contracts.ts');
      const { QUEST_DEFS, questEra } = await import('/src/core/quests.ts');
      const { CashPile } = await import('/src/stations/CashPile.ts');
      // remember every cash pile that ever pays out, so the diligent player can bank them all
      const piles = new Set();
      const pay0 = CashPile.prototype.pay;
      CashPile.prototype.pay = function (a, f) { piles.add(this); return pay0.call(this, a, f); };
      W.unlockEra(n);
      const ctx = W.ctx;
      for (const id of ctx.upgrades.ids) {
        const e = introEra(UPGRADES[id]);
        if (e < n) ctx.upgrades.setLevel(id, 10);
        else if (e === n) ctx.upgrades.setLevel(id, 0);
      }
      ctx.upgrades.setLevel(`${ERAS[n].key}Crew`, 1);
      W.setSettlement(5 * (n - 1));
      for (let k = 2; k < n; k++) {
        const ck = fullBuild(k, REGION_SLOTS[k]);
        for (let s = 0; s < REGION_SLOTS[k]; s++) W.buildMachine(k, s, ck[s]);
        const cb = cityBuildingsOfEra(k);
        for (let l = 0; l < DISTRICT_LOTS[k]; l++) W.buildCity(k, l, cb[l % cb.length]);
      }
      const cm = fullBuild(n, REGION_SLOTS[n]);
      for (let s = 0; s < REGION_SLOTS[n]; s++) W.buildMachine(n, s, cm[s]);
      for (const q of QUEST_DEFS) if (questEra(q.id) < n) ctx.state.quests[q.id] = true;
      ctx.events.emit('village:changed', { population: ctx.state.village.population, level: ctx.state.village.level });
      W.simulate(5);
      ctx.economy.spend(ctx.economy.money);
      // bucket every money add by the source file that made it
      const src = {};
      const add0 = ctx.economy.add.bind(ctx.economy);
      ctx.economy.add = (v, ...r) => {
        if (v > 0) {
          const st = (new Error().stack || '').split('\n').slice(2).map((l) => (/\/src\/([\w/]+)\.ts/.exec(l) || [])[1]).filter(Boolean);
          const k = window.__tag || st.find((f) => !/core\/Economy|items\/|core\/EventBus/.test(f)) || st[0] || '?';
          src[k] = (src[k] || 0) + v;
        }
        return add0(v, ...r);
      };
      const own = ctx.upgrades.ids.filter((id) => introEra(UPGRADES[id]) === n);
      const bank = () => {
        for (const p of piles) {
          let it;
          while ((it = p.pile.take('cash'))) {
            window.__tag = 'bank:' + p.opts.id.replace(/era\d+/, 'eraN');
            ctx.economy.add(it.value);
            window.__tag = null;
            ctx.items.release(it);
          }
        }
      };
      // contracts are averaged, not played: pause the board (and drop any offer it made while the era was set up)
      ctx.contracts.update = () => {};
      Object.assign(ctx.state.contract, { kind: '', target: 0, progress: 0, left: 0, bonus: 0 });
      const sales = { amount: 0, units: {} };
      ctx.events.on('sale', (x) => {
        if (x.buyer === 'jack') return; // the swap cart is not a delivery (Contracts ignores it too)
        sales.amount += x.amount;
        sales.units[x.kind] = (sales.units[x.kind] || 0) + x.count;
      });
      /** Long-run contract income ($/s) of a player who takes every offer, at the sales measured over `secs`. */
      const contractRate = (secs) => {
        const offers = eraOffers(ctx.state, n);
        if (offers.length === 0) return 0;
        const rate = sales.amount / secs;
        const [lo, hi] = CONTRACTS.era.count;
        const gap = (CONTRACTS.every[0] + CONTRACTS.every[1]) / 2;
        let bonus = 0, time = 0;
        for (const o of offers) {
          const perSec = (sales.units[o.kind] || 0) / secs;
          // the board's count: round((lo + U·(hi − lo)) / 5) · 5 for U uniform on [0, 1)
          for (let i = 0; i < 200; i++) {
            const count = Math.round((lo + ((i + 0.5) / 200) * (hi - lo)) / 5) * 5;
            const need = perSec > 0 ? count / perSec : Infinity;
            if (need <= CONTRACTS.seconds) {
              bonus += eraBonus(rate, count, o.value);
              time += gap + need;
            } else time += gap + CONTRACTS.seconds;
          }
        }
        return bonus / time;
      };
      window.__ec = { bank, own, src, QUEST_DEFS, sales, contractRate };
    }, { n });
    const samples = await page.evaluate((levels) => {
      const W = window.__WINTERLAND__, ctx = W.ctx, e = window.__ec;
      for (const id of Object.keys(ctx.state.quests)) ctx.state.quests[id] = true;
      for (const q of e.QUEST_DEFS) ctx.state.quests[q.id] = true;
      const out = [];
      for (const L of levels) {
        for (const id of e.own) ctx.upgrades.setLevel(id, id.endsWith('Crew') ? Math.max(1, L) : L);
        ctx.events.emit('village:changed', { population: ctx.state.village.population, level: ctx.state.village.level });
        for (let i = 0; i < 8; i++) { W.game.simulate(8); e.bank(); }
        for (const k of Object.keys(e.src)) delete e.src[k];
        e.sales.amount = 0;
        for (const k of Object.keys(e.sales.units)) delete e.sales.units[k];
        for (let i = 0; i < 23; i++) { W.game.simulate(8); e.bank(); }
        const secs = 23 * 8;
        const src = Object.fromEntries(Object.entries(e.src).map(([k, v]) => [k, Math.round(v / secs)]));
        src.contracts = Math.round(e.contractRate(secs));
        out.push({
          L,
          perSec: Math.round(Object.values(e.src).reduce((a, b) => a + b, 0) / secs) + src.contracts,
          sales: Math.round(e.sales.amount / secs),
          src,
        });
      }
      return out;
    }, LEVELS);
    return { n, samples };
  } finally {
    await context.close();
  }
};

let results = {};
try {
  results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
} catch {
  // no usable file yet: start fresh
}
results.note = NOTE;

let next = 0;
let failed = false;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < eras.length) {
    const n = eras[next++];
    const t0 = Date.now();
    try {
      results[n] = await measure(n);
    } catch (e) {
      failed = true;
      console.log(`era ${n} failed: ${String(e).slice(0, 300)}`);
      continue;
    }
    console.log(`era ${n}: ${JSON.stringify(results[n].samples.map((x) => [x.L, x.perSec]))} (${Math.round((Date.now() - t0) / 1000)}s)`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(results, null, 1) + '\n');
  }
}));
await browser.close();
await server.close();
if (failed) process.exitCode = 1;
