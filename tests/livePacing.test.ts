/**
 * 0.9.9 (Dino: "each era's stuff needs to be SIGNIFICANTLY more expensive, I'm earning way too much money"): era
 * pacing against the LIVE game's income, not only the pure model (core/pacing.ts). tests/fixtures/econ-curve.json
 * holds what each era 2..10 really earns per second, every source counted (sales, cash machines, crews, the city,
 * contracts, era 1 still running), with its own upgrades at Lv 0, 2 … 10; scripts/econ-curve.mjs measures it.
 *
 * A buyer starts each era with no money and buys the cheapest of the era's own upgrades below Lv 10 whenever it can
 * afford it, at most one buy per PACING.walkPerBuy seconds (the walk to the pad), then saves up for the next era's
 * expansion pad. Income follows the era's mean level along the measured curve. The measuring player banks every pile
 * at once, so a real player is slower than these minutes, never faster.
 *
 * `PACING_REPORT=1 npx vitest run tests/livePacing.test.ts` prints minutes, buys and the share of time spent waiting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Console } from 'node:console';
import { beforeAll, describe, expect, it } from 'vitest';
import { UPGRADES, type UpgradeDef } from '../src/config';
import { costAt, introEra } from '../src/core/ladder';
import { PACING } from '../src/core/pacing';
import { ERAS, MARKET, MATERIALS, MAX_ERA, SURVIVAL_VALUE, isMaterial } from '../src/eras/data';

interface Sample {
  L: number;
  perSec: number;
}
const CURVE = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/econ-curve.json'), 'utf8')) as Record<string, { samples: Sample[] }>;

/** Live income of era n at mean own level L ($/s), linear between the measured levels. */
function income(n: number, L: number): number {
  const s = CURVE[n]!.samples;
  for (let i = 1; i < s.length; i++) {
    if (L <= s[i]!.L) return s[i - 1]!.perSec + ((s[i]!.perSec - s[i - 1]!.perSec) * (L - s[i - 1]!.L)) / (s[i]!.L - s[i - 1]!.L);
  }
  return s.at(-1)!.perSec;
}

interface LiveEra {
  n: number;
  minutes: number;
  buys: number;
  /** Share of the era spent waiting for money rather than walking to the next pad. */
  waitShare: number;
  spent: number;
}

function liveEra(n: number): LiveEra {
  const own = (Object.values(UPGRADES) as UpgradeDef[]).filter((d) => introEra(d) === n);
  // the crew starts hired (Lv 1), as in the measured curve
  const lv = new Map(own.map((d) => [d.id, d.id.endsWith('Crew') ? 1 : 0]));
  const mean = (): number => [...lv.values()].reduce((a, b) => a + b, 0) / own.length;
  const next = ERAS[n + 1]?.unlock;
  const extra = next ? next.extra.count * (isMaterial(next.extra.kind) ? MATERIALS[next.extra.kind].value : SURVIVAL_VALUE[next.extra.kind as keyof typeof SURVIVAL_VALUE]) * (1 + MARKET.delivery) : 0;
  let t = 0;
  let money = 0;
  let wait = 0;
  let buys = 0;
  let spent = 0;
  for (;;) {
    let best: UpgradeDef | null = null;
    let cost = Infinity;
    for (const d of own) {
      const s = lv.get(d.id)!;
      if (s < 10 && costAt(d, s) < cost) {
        cost = costAt(d, s);
        best = d;
      }
    }
    if (!best) {
      if (!next) break;
      cost = next.cash + extra;
    }
    const step = Math.max(PACING.walkPerBuy, (cost - money) / income(n, mean()));
    wait += step - PACING.walkPerBuy;
    t += step;
    money += income(n, mean()) * step - cost;
    spent += cost;
    buys++;
    if (!best) break;
    lv.set(best.id, lv.get(best.id)! + 1);
  }
  return { n, minutes: t / 60, buys, waitShare: wait / t, spent };
}

let eras: LiveEra[];
beforeAll(() => {
  eras = [];
  for (let n = 2; n <= MAX_ERA; n++) eras.push(liveEra(n));
  if (process.env.PACING_REPORT) {
    const fmt = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : `${(v / 1e6).toFixed(1)}M`);
    new Console(process.stdout).table(eras.map((e) => ({ era: e.n, minutes: Math.round(e.minutes), buys: e.buys, 'waiting %': Math.round(100 * e.waitShare), spent: fmt(e.spent) })));
  }
});

describe('live pacing (measured income curves)', () => {
  it('has a measured curve for every era 2..10', () => {
    for (let n = 2; n <= MAX_ERA; n++) expect(CURVE[n]?.samples.map((s) => s.L), `era ${n}`).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('every era takes 110-170 minutes even for a player who banks every pile at once', () => {
    for (const e of eras) {
      expect(e.minutes, `era ${e.n}`).toBeGreaterThanOrEqual(110);
      expect(e.minutes, `era ${e.n}`).toBeLessThanOrEqual(170);
    }
  });

  it('every era runs longer than the one before it', () => {
    for (let i = 1; i < eras.length; i++) expect(eras[i]!.minutes, `era ${eras[i]!.n}`).toBeGreaterThan(eras[i - 1]!.minutes);
  });

  // the "cash-constrained" rule: the player mostly waits for money, as in era 1, rather than walking from pad to pad
  // with money to spare (0.9.8: era 3 waited 42 % of the time and the late levels of every era cost pocket change)
  it('the player waits for money at least two thirds of every era', () => {
    for (const e of eras) expect(e.waitShare, `era ${e.n}`).toBeGreaterThanOrEqual(2 / 3);
  });
});
