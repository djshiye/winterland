/**
 * Pacing of the ten-era climb (docs/EXPANSION.md §E) through the pure model core/pacing.ts: every era takes 60–200
 * model minutes, each longer than the last, and the era-1 climb 80–130, prices never go down, the settlement anchors fit the city, Jack never
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
import { hardCapStored, LEVEL_CAP, maxStored, stepCost, valueAt } from '../src/core/ladder';
import { PACING, pacingIncome, pacingStart, runPacing, type PacingResult } from '../src/core/pacing';
import { QUEST_DEFS } from '../src/core/quests';
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

  // 0.9.2: the five delivery docks joined the era-2 gate (+15 steps, about 6 model minutes of walking and buying)
  it('the era-1 climb (every era-1 id to Lv 10 + the era-2 pad) takes at most 130 model minutes', () => {
    expect(run.eras[0]!.minutes).toBeLessThanOrEqual(130);
    expect(run.eras[0]!.minutes).toBeGreaterThanOrEqual(80);
    expect(run.eras[0]!.gateSteps).toBe(102);
  });

  it('every era takes 60–200 model minutes', () => {
    for (const e of run.eras.slice(1)) {
      expect(e.minutes, `era ${e.n}`).toBeGreaterThanOrEqual(60);
      expect(e.minutes, `era ${e.n}`).toBeLessThanOrEqual(200);
    }
  });

  it('every era runs longer than the one before it (era 2 about 95–115 min, era 10 about 170–200)', () => {
    const eras = run.eras.slice(1);
    for (let i = 1; i < eras.length; i++) expect(eras[i]!.minutes, `era ${eras[i]!.n}`).toBeGreaterThan(eras[i - 1]!.minutes);
    expect(eras[0]!.minutes).toBeGreaterThanOrEqual(95);
    expect(eras[0]!.minutes).toBeLessThanOrEqual(115);
    expect(eras.at(-1)!.minutes).toBeGreaterThanOrEqual(170);
    expect(eras.at(-1)!.minutes).toBeLessThanOrEqual(200);
  });

  it('buys by walking: one purchase at a time, never faster than one per walkPerBuy seconds', () => {
    expect(PACING.walkPerBuy).toBeGreaterThanOrEqual(6);
    expect(PACING.walkPerBuy).toBeLessThanOrEqual(10);
    for (const e of run.eras) expect((e.minutes * 60) / e.buys, `era ${e.n}`).toBeGreaterThanOrEqual(PACING.walkPerBuy);
  });

  it('a purchase every 45 s or less on average in every era (reward cadence)', () => {
    for (const e of run.eras.slice(1)) expect((e.minutes * 60) / e.buys, `era ${e.n}`).toBeLessThanOrEqual(45);
  });

  it('stays in range for a Survival rate anywhere in 1.2–2k/s from era 2 on', () => {
    for (const survivalLateRate of [1200, 2000]) {
      for (const e of runPacing({ survivalLateRate }).eras.slice(1)) {
        expect(e.minutes).toBeGreaterThanOrEqual(60);
        expect(e.minutes).toBeLessThanOrEqual(200);
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
      const limit = d.display === 'count' ? (d.id === 'carry' ? 50 : 12) : cap[d.display];
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

  it('LEVEL_CAP is the finale level', () => {
    expect(LEVEL_CAP).toBe(100);
  });
});
