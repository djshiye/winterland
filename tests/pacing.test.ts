/**
 * Pacing of the ten-era climb (docs/EXPANSION.md §E) through the pure model core/pacing.ts: every era takes 60–240
 * model minutes (0.9.5 'literal' gate: each era's own upgrades to Lv 10; 0.9.9: the live curves in tests/livePacing.test.ts set the era lengths), and the era-1 climb about 80 (0.9.6), prices never go down, the settlement anchors fit the city, Jack never
 * pays a full price and no effect passes its hard cap. The buyer walks: one purchase at a time, each at least
 * PACING.walkPerBuy seconds (upgrades are hands-on, bought standing on pads and shop mats). The era economy ×10 and the
 * retuned CITY_RANKS ride along.
 *
 * `PACING_REPORT=1 npx vitest run tests/pacing.test.ts` prints minutes per era and per settlement level.
 */
import { Console } from 'node:console';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIMB, UPGRADES, type UpgradeDef } from '../src/config';
import { settlementAnchors, machineStaff } from '../src/core/demand';
import { hardCapStored, LEGACY_LEVEL_CAP, maxStored, stepCost, valueAt } from '../src/core/ladder';
import { PACING, pacingIncome, pacingStart, runPacing, type PacingResult } from '../src/core/pacing';
import { QUEST_DEFS } from '../src/core/quests';
import { FINAL_GATE, gateNeed, settlementNeed } from '../src/eras/gate';
import { CITY_BUILDINGS, CITY_RANKS, DISTRICTS, ERA_SCALE, MATERIALS, MAX_ERA, REGIONS, unlockCash } from '../src/eras/data';

const DEFS = Object.values(UPGRADES) as UpgradeDef[];

let run: PacingResult;
beforeAll(() => {
  run = runPacing();
  if (process.env.PACING_REPORT) report(run);
});

/** Straight to stdout: vitest hides console output of passing tests. */
function report(r: PacingResult): void {
  const out = new Console(process.stdout);
  const fmt = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(1)}k`);
  const rows = r.eras.map((e) => ({
    stretch: e.n === 1 ? 'era-1 climb + era-2 pad' : e.n === MAX_ERA ? 'era 10 → finale' : `era ${e.n}`,
    minutes: Math.round(e.minutes),
    buys: e.buys,
    'sec/buy': Math.round((e.minutes * 60) / e.buys),
    gate$: fmt(e.gateCost),
    'other$': fmt(e.otherCost),
    'income/s': fmt(e.income),
  }));
  out.table(rows);
  out.log(`total ${Math.round(r.minutes)} min (${(r.minutes / 60).toFixed(1)} h) after the Great Lodge`);
  out.log('settlement level → minute: ' + r.settlement.map((m, L) => (m === null ? '' : `${L}:${Math.round(m)}`)).filter(Boolean).join(' '));
}

describe('pacing model', () => {
  it('reaches the finale: ten stretches, settlement 50', () => {
    expect(run.eras.map((e) => e.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(run.settlement[50]).not.toBeNull();
  });

  // 0.9.6 (CODE_AUDIT P1-9): was 129 model minutes, the slowest stretch of the game; now about 80 (legacyStep 1.01 and
  // +0.5 a level on the five Survival price upgrades past their tables), shorter than era 2
  it('the era-1 climb (every era-1 id to Lv 10 + the era-2 pad) takes about 80 model minutes, less than era 2', () => {
    expect(run.eras[0]!.minutes).toBeLessThanOrEqual(90);
    expect(run.eras[0]!.minutes).toBeGreaterThanOrEqual(70);
    expect(run.eras[0]!.minutes).toBeLessThan(run.eras[1]!.minutes);
    expect(run.eras[0]!.gateSteps).toBe(102);
  });

  // 0.9.9: era prices are tuned on the live game's measured income (tests/livePacing.test.ts, each era 110-170 min and
  // longer than the last); this model under-reads era 3's start income (era 3: 204 model minutes, 125 live), so
  // it only keeps sanity bounds here
  it('every era takes 60–240 model minutes', () => {
    for (const e of run.eras.slice(1)) {
      expect(e.minutes, `era ${e.n}`).toBeGreaterThanOrEqual(60);
      expect(e.minutes, `era ${e.n}`).toBeLessThanOrEqual(240);
    }
  });

  // 0.9.10: prices are solved on the live curves with contracts counted (tests/livePacing.test.ts), which the model
  // leaves out, so it reads era 2 a little long (about 138)
  it('era 2 takes about 100–150 model minutes and era 10 runs longer than era 2', () => {
    const eras = run.eras.slice(1);
    expect(eras[0]!.minutes).toBeGreaterThanOrEqual(100);
    expect(eras[0]!.minutes).toBeLessThanOrEqual(150);
    expect(eras.at(-1)!.minutes).toBeGreaterThan(eras[0]!.minutes);
  });

  it('buys by walking: one purchase at a time, never faster than one per walkPerBuy seconds', () => {
    expect(PACING.walkPerBuy).toBeGreaterThanOrEqual(6);
    expect(PACING.walkPerBuy).toBeLessThanOrEqual(10);
    for (const e of run.eras) expect((e.minutes * 60) / e.buys, `era ${e.n}`).toBeGreaterThanOrEqual(PACING.walkPerBuy);
  });

  // 0.9.5: an era's gate is its own ~14 upgrades × 10 levels (not every older id), so fewer, bigger buys; still a
  // quicker cadence than the era-1 climb (about 75 s)
  it('a purchase every 65 s or less on average in every era (reward cadence)', () => {
    for (const e of run.eras.slice(1)) expect((e.minutes * 60) / e.buys, `era ${e.n}`).toBeLessThanOrEqual(65);
  });

  it('stays in range for a Survival rate anywhere in 1.2–2k/s from era 2 on', () => {
    for (const survivalLateRate of [1200, 2000]) {
      for (const e of runPacing({ survivalLateRate }).eras.slice(1)) {
        expect(e.minutes).toBeGreaterThanOrEqual(60);
        expect(e.minutes).toBeLessThanOrEqual(260);
      }
    }
  });

  it('starts at the Great Lodge with Survival income only', () => {
    const s = pacingStart();
    expect(s.village.greatLodge.tier).toBe(0);
    expect(pacingIncome(s)).toBeCloseTo(PACING.survivalLateRate, 6);
  });
});

describe('ladder invariants', () => {
  it('prices never go down, for every id to shown level 100', () => {
    for (const d of DEFS) {
      let prev = 0;
      for (let s = 0; s < maxStored(d, true); s++) {
        const c = stepCost(d, s);
        expect(c, `${d.id} @${s}`).toBeGreaterThan(prev);
        prev = c;
      }
    }
  });

  it('Jack pays less than an item is worth at every level', () => {
    for (let s = 0; s <= maxStored(UPGRADES.jack, true); s++) expect(valueAt(UPGRADES.jack, s)).toBeLessThan(1);
  });

  it('no effect passes its hard cap', () => {
    const cap: Partial<Record<UpgradeDef['display'], number>> = { speed: 13.5, crew: 8, boost: 6, factor: 10, share: 0.9 };
    for (const d of DEFS) {
      const top = maxStored(d, true);
      const limit = d.display === 'count' ? (d.id === 'carry' || d.id.endsWith('Carry') ? 50 : 12) : cap[d.display];
      const hc = hardCapStored(d);
      for (let s = 0; s <= top; s++) {
        const v = valueAt(d, s);
        if (limit !== undefined) expect(v, `${d.id} @${s}`).toBeLessThanOrEqual(limit + 1e-9);
        if (d.display === 'rate') expect(v, `${d.id} @${s}`).toBeGreaterThan(0);
        if (hc !== null && s >= hc) expect(v, `${d.id} @${s}`).toBe(valueAt(d, hc));
      }
    }
  });

  it('every settlement anchor A_k stays at or under 0.8 × the city capacity through era k', () => {
    const A = settlementAnchors();
    let cap = 0;
    for (let k = 2; k <= MAX_ERA; k++) {
      const home = Object.values(CITY_BUILDINGS).find((d) => d.era === k && d.kind === 'home')!.people;
      cap += (DISTRICTS[k]!.lots - 2) * home + REGIONS[k]!.slots * machineStaff(k);
      expect(A[k]!).toBeLessThanOrEqual(0.8 * cap);
    }
  });
});

describe('era economy ×10 (R11) and city ranks (R13)', () => {
  it('scales the expansion pads, materials and city prices; Survival untouched', () => {
    expect(CLIMB.eraScale).toBe(ERA_SCALE);
    expect(ERA_SCALE).toBe(10);
    expect(unlockCash(2)).toBe(1_500_000);
    expect(MATERIALS.stone.value).toBe(1_800);
    expect(MATERIALS.brick.value).toBe(7_000);
    expect(CITY_BUILDINGS.frontierHome.cash).toBe(400_000);
    expect(CITY_BUILDINGS.frontierHome.income).toBe(40);
    expect(UPGRADES.carry.costs[0]).toBe(100);
    // era quest rewards ride along; Jack's tip and every Survival quest stay as they were
    const reward = (id: string): number => QUEST_DEFS.find((q) => q.id === id)!.reward;
    expect(reward('machine1')).toBe(250_000);
    expect(reward('era2')).toBe(150_000);
    expect(reward('jack1')).toBe(5_000);
    expect(reward('greatLodge')).toBe(10_000);
  });

  it('a rank is offered from the first era whose city can hold its population', () => {
    // cumulative capacity: every lot a home, every slot a staffed machine
    const through = (k: number): number => {
      let n = 0;
      for (let e = 2; e <= k; e++) n += DISTRICTS[e]!.lots * Object.values(CITY_BUILDINGS).find((d) => d.era === e && d.kind === 'home')!.people + REGIONS[e]!.slots * machineStaff(e);
      return n;
    };
    for (const name of ['Big City', 'Megacity']) {
      const r = CITY_RANKS.find((x) => x.name === name)!;
      expect(through(r.minEra - 1), name).toBeLessThan(r.minPopulation);
      expect(through(r.minEra), name).toBeGreaterThanOrEqual(r.minPopulation);
    }
    expect(CITY_RANKS.map((r) => r.minEra)).toEqual([1, 2, 5, 8, 10]);
  });

  it('the finale is Lv 10 (0.9.7: the final gate is era 10 own things at Lv 10 + Settlement 50; Lv 100 is legacy only)', () => {
    expect(gateNeed(FINAL_GATE)).toBe(10);
    expect(settlementNeed(FINAL_GATE)).toBe(50);
    expect(LEGACY_LEVEL_CAP).toBe(100);
  });
});
