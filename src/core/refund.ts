/**
 * [PURE] 0.9.6: what an old save is paid back for each upgrade level it bought past Lv 10 (core/Save.ts migration
 * '0.9.6-lv10-refund', decision 2). Levels past 10 could only be bought in 0.9.0-0.9.4 (the climb), so the refund is
 * what each level cost there: the 0.9.1-0.9.4 price curve, frozen here so later retunes of config CLIMB never change it.
 * Paying back at today's 0.9.5+ prices would hand an era-10 save tens of times its money.
 *
 * `refundPrice` is the one switch: swap it (e.g. for core/ladder.ts costAt, today's prices) to change the rule.
 */
import { price3, UPGRADES, type UpgradeDef, type UpgradeGroup } from '../config';
import { authoredMax, hardCapStored, introEra } from './ladder';
import type { GameState } from './types';

/** The 0.9.1-0.9.4 CLIMB price constants (git show v0.9.4:src/config.ts). */
const CLIMB_094 = {
  bandSize: 10,
  unit: 190_000,
  bandGrowth: 4.3,
  stepGrowth: 1.08,
  legacyStep: 1.05,
  bandTilt: [1, 1, 1, 2.35, 2.75, 2.72, 2.68, 2.67, 2.45, 2.11, 1.78] as readonly number[],
  weights: { lumberjack: 0.5, machine: 0.8, crew: 0.8, sales: 0.9, industry: 0.9, finance: 1.0 } as Record<UpgradeGroup, number>,
};

/** The era crews were 'industry' upgrades until 0.9.5 moved them to 'crew'. */
function group094(def: UpgradeDef): UpgradeGroup {
  return introEra(def) >= 2 && def.id.endsWith('Crew') ? 'industry' : def.group;
}

function bandPrice094(def: UpgradeDef, A: number): number {
  const C = CLIMB_094;
  const b = Math.floor(A / C.bandSize) + 1;
  const j = A % C.bandSize;
  return (C.weights[group094(def)] ?? 1) * C.unit * C.bandGrowth ** (b - 2) * (C.bandTilt[b] ?? 1) * C.stepGrowth ** j;
}

/** What stored level s → s + 1 cost in 0.9.1-0.9.4 ('offset' gate: era n's ids start at shown level 10 · (n − 1)). */
export function originalCost(def: UpgradeDef, s: number): number {
  const A = CLIMB_094.bandSize * (introEra(def) - 1) + s;
  if (introEra(def) >= 2) return price3(bandPrice094(def, A));
  const m = authoredMax(def);
  if (s < m) return def.costs[s]!;
  const legacy = def.costs[m - 1]! * CLIMB_094.legacyStep ** (s - m + 1);
  return price3(A < CLIMB_094.bandSize ? legacy : Math.max(legacy, bandPrice094(def, A)));
}

/** The refund for one level (stored s → s + 1). */
export const refundPrice: (def: UpgradeDef, s: number) => number = originalCost;

/**
 * Decision 6: Mastery is removed and an old save keeps its bonus "as a one-off". 'cash' (default): the bonus is paid
 * once, as cash, when its levels are refunded, and nothing multiplies sales afterwards (every era stays the same grind).
 * 'multiplier': the bonus is frozen in state.legacy.masteryMult and keeps raising every sale for good. The one switch.
 */
export const MASTERY_KEEP: 'cash' | 'multiplier' = 'cash';

/** The 0.9.0-0.9.6 Mastery constants (git show v0.9.6:src/config.ts CLIMB.masteryScale / masteryPoints), frozen here. */
const MASTERY_096 = { scale: 0.12, points: 25 };

/** Mastery points an old save's levels earned: one per level bought while the effect already sat at its hard cap. */
export function legacyMasteryPoints(state: Pick<GameState, 'upgrades'>): number {
  let points = 0;
  for (const d of Object.values(UPGRADES)) {
    const hc = hardCapStored(d);
    if (hc !== null) points += Math.max(0, (state.upgrades[d.id] ?? 0) - hc);
  }
  return points;
}

/** The 0.9.0-0.9.6 Mastery multiplier for `points` (1 with none): bounded and logarithmic. */
export function legacyMasteryMult(points: number): number {
  return 1 + MASTERY_096.scale * Math.log2(1 + Math.max(0, points) / MASTERY_096.points);
}

/**
 * The Mastery bonus an old save had when it loads (1 = none): from its levels past the caps, or the bonus it already
 * keeps (state.legacy), whichever is higher. Only the '0.9.6-lv10-refund' migration reads it (core/Save.ts).
 */
export function legacyMastery(state: Pick<GameState, 'upgrades'> & { legacy?: GameState['legacy'] }): number {
  return Math.max(legacyMasteryMult(legacyMasteryPoints(state)), state.legacy?.masteryMult ?? 1);
}

/** About one era of play (tests/pacing.test.ts: eras run 90-160 model minutes): 2.5 h. */
export const MASTERY_PAYOUT_SECONDS = 9000;

/**
 * The one-off Mastery payout: the extra a +X% bonus would have earned over one era of play at the save's income rate
 * ($/s; Save.ts passes the recent sales rate, or the lifetime average when a save has none). Whole dollars, never negative.
 */
export function masteryPayout(mult: number, incomePerSecond: number): number {
  const v = Math.max(0, mult - 1) * Math.max(0, incomePerSecond) * MASTERY_PAYOUT_SECONDS;
  return Number.isFinite(v) ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(v)) : 0;
}
