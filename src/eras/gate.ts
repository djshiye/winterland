/**
 * [PURE] The era gate (docs/EXPANSION.md §C). No THREE, no GameContext.
 *
 * The climb (upgrade levels past their authored max, the era checklist, the new land) opens with the Great Lodge,
 * the point where 0.8.0 shows its finale. Below it era 1 plays exactly like 0.8.0 (R1).
 *
 * Era n's gate (the checklist that makes its expansion pad payable):
 * - rows: EVERY upgrade introduced before era n (introEra ≤ n − 1: 23 for era 2, then 23 + 2 + 3·(n − 2) in 0.9),
 *   each at shown level 10·(n − 1). Unbuilt machines and unhired crews count too (R7): a row that cannot be bought yet
 *   says why ('prereq'), an unhired crew shows no level (null, "Not hired").
 * - settlement: level ≥ 5·(n − 1).
 * eraGate() is the full checklist for the UI; gateMet() is the cheap yes/no layout.expansionOffered asks every frame.
 */
import { PRIORITIES, UPGRADES, type UpgradeDef } from '../config';
import { base, introEra, shown, stepCost } from '../core/ladder';
import { upgradeRequirement } from '../core/Upgrades';
import type { GameState, UpgradeId } from '../core/types';
import { cityPopulation, settlementLevel, settlementPop } from '../core/demand';
import { CITY_BUILDINGS, DISTRICTS, ERAS } from './data';
import { formatMoney } from '../ui/format';

/** The slice of the game state `climbOpen` reads (the frontier tests pass a plain object). */
export interface ClimbState {
  village: { greatLodge: { tier: number } };
}

/**
 * The Great Lodge is built: upgrade ladders run past their authored max towards shown level 100, and the new land,
 * its roads and the era-2 pad show (R2; 0.9 used to reveal them at Winter City).
 */
export function climbOpen(s: ClimbState): boolean {
  return s.village.greatLodge.tier >= 0;
}

/** Where a row's level is bought: the shop panel, the machine's level pad, or the era region's shop mat (Industry). */
export type GateWhere = 'shop' | 'pad' | 'eraShop';

export interface GateRow {
  id: UpgradeId;
  /** Shown level now; null for a crew that is not hired (stored 0, R5). */
  shown: number | null;
  /** Shown level the gate needs (10 · (n − 1)). */
  need: number;
  /** ok: at need; low: buyable towards it; prereq: an unmet requirement comes first (`prereq` says which). */
  state: 'ok' | 'low' | 'prereq';
  prereq?: string;
  /** Dollars of the remaining steps to `need` at today's prices (0 when ok). */
  costToNeed: number;
  where: GateWhere;
  /** Level pads count the built machine as LV 1 (R6): "pad LV 8 → LV 11". Pad rows only. */
  padLabel?: string;
}

export interface EraGate {
  n: number;
  /** Shown level every row needs. */
  need: number;
  settlementNeed: number;
  rows: GateRow[];
  /** Rows at need, of `total`. */
  ok: number;
  total: number;
  /** cityPop: district residents + machine staff; nextPop: what the next level needs (null below Winterland / at 50). */
  settlement: { level: number; need: number; cityPop: number; nextPop: number | null };
  /** Every row ok and the settlement reached: the expansion pad takes payment. */
  ready: boolean;
  /** The expansion pad's price once ready (cash + the previous era's material). */
  padCash: number;
  padExtra: { kind: string; count: number };
}

/** Shown level era n's gate asks of every row. */
export function gateNeed(n: number): number {
  return 10 * (n - 1);
}

/** Settlement level era n's gate asks. */
export function settlementNeed(n: number): number {
  return 5 * (n - 1);
}

/** Settlement level (docs/EXPANSION.md §B): the village level until Winterland, then state.eras.settlement (6..50). */
export { settlementLevel };

const idsCache = new Map<number, readonly UpgradeId[]>();

/** Era n's gate rows, in table order: every id introduced before era n (cached: gateMet runs every frame). */
function gateIds(n: number): readonly UpgradeId[] {
  let ids = idsCache.get(n);
  if (!ids) {
    ids = (Object.keys(UPGRADES) as UpgradeId[]).filter((id) => introEra(UPGRADES[id]) <= n - 1);
    idsCache.set(n, ids);
  }
  return ids;
}

/** Stored level that reaches the gate's shown need (offset or literal mode). */
const storedNeed = (def: UpgradeDef, n: number): number => gateNeed(n) - base(def);

/** Rows in era n's gate (0 past the last era). */
export function gateSize(n: number): number {
  return ERAS[n] ? gateIds(n).length : 0;
}

/** Anything paid into era n's expansion pad yet (dollars + material units). > 0 keeps the pad offered (grandfathered). */
export function padPaid(s: Pick<GameState, 'eras'>, n: number): number {
  const r = s.eras.regions[n];
  return r ? r.cash + r.extra : 0;
}

/** Cheap counts of era n's gate for per-event readers (no prices, no row objects): rows at need and the settlement. */
export interface GateCount {
  ok: number;
  total: number;
  settlement: number;
  settlementNeed: number;
  ready: boolean;
}

export function gateCount(s: GameState, n: number): GateCount {
  const ids = ERAS[n] ? gateIds(n) : [];
  let ok = 0;
  for (const id of ids) if (s.upgrades[id] >= storedNeed(UPGRADES[id], n)) ok++;
  const settlement = settlementLevel(s);
  const need = settlementNeed(n);
  return { ok, total: ids.length, settlement, settlementNeed: need, ready: !!ERAS[n] && ok === ids.length && settlement >= need };
}

/** Cheap form of eraGate(s, n).ready for per-frame readers (no prices, no row objects). */
export function gateMet(s: GameState, n: number): boolean {
  if (!ERAS[n]) return false;
  if (settlementLevel(s) < settlementNeed(n)) return false;
  for (const id of gateIds(n)) if (s.upgrades[id] < storedNeed(UPGRADES[id], n)) return false;
  return true;
}

function whereOf(def: UpgradeDef): GateWhere {
  return def.group === 'machine' ? 'pad' : def.group === 'industry' ? 'eraShop' : 'shop';
}

function rowOf(s: GameState, id: UpgradeId, n: number): GateRow {
  const def = UPGRADES[id];
  const stored = s.upgrades[id];
  const target = storedNeed(def, n);
  const where = whereOf(def);
  const row: GateRow = {
    id,
    shown: def.display === 'crew' && stored <= 0 ? null : shown(def, stored),
    need: gateNeed(n),
    state: 'ok',
    costToNeed: 0,
    where,
  };
  if (stored >= target) return row;
  if (where === 'pad') row.padLabel = `pad LV ${stored + 2} → LV ${target + 1}`;
  for (let k = stored; k < target; k++) row.costToNeed += stepCost(def, k);
  const req = upgradeRequirement(s, id);
  if (req) {
    row.state = 'prereq';
    row.prereq = req;
  } else {
    row.state = 'low';
  }
  return row;
}

/** Era n's full checklist (n = 2..10; rows are empty for an era that does not exist). */
export function eraGate(s: GameState, n: number): EraGate {
  const rows = ERAS[n] ? gateIds(n).map((id) => rowOf(s, id, n)) : [];
  const ok = rows.filter((r) => r.state === 'ok').length;
  const level = settlementLevel(s);
  const need = settlementNeed(n);
  const unlock = ERAS[n]?.unlock;
  return {
    n,
    need: gateNeed(n),
    settlementNeed: need,
    rows,
    ok,
    total: rows.length,
    settlement: { level, need, cityPop: cityPopulation(s), nextPop: s.village.level < 5 ? null : settlementPop(level + 1) },
    ready: !!ERAS[n] && ok === rows.length && level >= need,
    padCash: unlock?.cash ?? 0,
    padExtra: { kind: unlock?.extra.kind ?? '', count: unlock?.extra.count ?? 0 },
  };
}

/**
 * The open rows in the GateCard's order (docs/EXPANSION.md §C): unmet prereqs first (they block everything after them),
 * then the cheapest to finish. Done rows are left out (the card folds them into "✓ 37 done").
 */
export function openRows(g: EraGate): GateRow[] {
  const rank = (r: GateRow): number => (r.state === 'prereq' ? 0 : 1);
  return g.rows.filter((r) => r.state !== 'ok').sort((a, b) => rank(a) - rank(b) || a.costToNeed - b.costToNeed);
}

/** A row the shop sells from anywhere (shop and Industry rows). Pad rows are paid at the machine's level pad (R6). */
export function rowBuyable(r: GateRow): boolean {
  return r.state === 'low' && r.where !== 'pad';
}

/** What Raise all leaves in the wallet: max($500, 20 %), the foreman's reserve (PRIORITIES), so it never empties it. */
export function raiseReserve(money: number): number {
  return Math.max(PRIORITIES.reserveMin, PRIORITIES.reserveShare * money);
}

/** The locked pad's note and the chip's count: "37/48 · S8/10". */
export function gateNote(g: Pick<EraGate, 'ok' | 'total' | 'settlementNeed'> & { settlement: { level: number } }): string {
  return `${g.ok}/${g.total} · S${Math.min(g.settlement.level, g.settlementNeed)}/${g.settlementNeed}`;
}

export interface NextGoal {
  text: string;
  /** The same goal without a number that moves every frame ("$12K to go"), for the guide banner; absent = text. */
  hint?: string;
  /**
   * buy: an upgrade id (shop / era shop) to press; go: a place to travel to ('pad:<id>' level pad, 'region:<n>' the
   * expansion pad); build: what unlocks a prereq ('pad:<id>', 'village', 'quarters') or raises the settlement.
   */
  action: { kind: 'buy' | 'go' | 'build'; target: string };
}

/** What a prereq row asks for first, as a build target (nextGoal, the GateCard's Go). */
export function prereqTarget(id: UpgradeId, s: GameState): string {
  const r = UPGRADES[id].requires;
  if (r?.unlocked && !s.unlocked[r.unlocked]) return `pad:${r.unlocked}`;
  if (r?.villageLevel !== undefined && s.village.level < r.villageLevel) return 'village';
  return 'quarters';
}

/** Buy at the shop, or walk to the machine's level pad. */
function buyAction(r: GateRow): NextGoal['action'] {
  return r.where === 'pad' ? { kind: 'go', target: `pad:${r.id}` } : { kind: 'buy', target: r.id };
}

/** "Sharp Axe → Lv 10" (an unhired crew: "Hire the Cashier"). */
function rowText(r: GateRow): string {
  const label = UPGRADES[r.id].label;
  return r.shown === null ? `Hire the ${label}` : `${label} → Lv ${r.need}`;
}

/**
 * The gate's settlement step (the GateCard's settlement row, nextGoal): "Build a home in Brickside (+40) → Settlement 6",
 * or "Grow the village → Settlement 5" below Winterland. Only meaningful while the settlement is short of the need.
 */
export function settlementGoal(s: GameState, g: EraGate): NextGoal {
  // below Winterland the village itself is the settlement (levels 0..5)
  if (s.village.level < 5) return { text: `Grow the village → Settlement ${g.settlementNeed}`, action: { kind: 'build', target: 'village' } };
  // the next level is in the current era's band: one more home of that era is about one level (§B)
  const age = s.eras.age;
  const home = Object.values(CITY_BUILDINGS).find((d) => d.era === age && d.kind === 'home');
  const where = DISTRICTS[age]?.name;
  const text = home && where ? `Build a home in ${where} (+${home.people}) → Settlement ${g.settlement.level + 1}` : `Grow the city → Settlement ${g.settlementNeed}`;
  return { text, action: { kind: 'build', target: `district:${age}` } };
}

/**
 * The single next goal of the climb (docs/EXPANSION.md §C, ADHD-friendly: one line, one action), or null before the
 * Great Lodge and after the last era. Priority: an unmet prereq → the cheapest affordable row → the settlement →
 * saving for the cheapest row ("$12K to go") → the expansion pad. `money` is the player's cash (Economy).
 */
export function nextGoal(s: GameState, money: number): NextGoal | null {
  const n = s.eras.age + 1;
  if (!climbOpen(s) || !ERAS[n]) return null;
  const g = eraGate(s, n);
  const open = g.rows.filter((r) => r.state !== 'ok');
  const prereq = open.find((r) => r.state === 'prereq');
  if (prereq) return { text: `${UPGRADES[prereq.id].label}: ${prereq.prereq}`, action: { kind: 'build', target: prereqTarget(prereq.id, s) } };
  const next = (r: GateRow): number => stepCost(UPGRADES[r.id], s.upgrades[r.id]);
  const low = open.slice().sort((a, b) => next(a) - next(b) || a.costToNeed - b.costToNeed);
  const cheapest = low[0];
  if (cheapest && next(cheapest) <= money) {
    return { text: `${rowText(cheapest)} (${formatMoney(next(cheapest))})`, action: buyAction(cheapest) };
  }
  if (g.settlement.level < g.settlementNeed) return settlementGoal(s, g);
  if (cheapest) {
    return { text: `${rowText(cheapest)}: ${formatMoney(next(cheapest) - money)} to go`, hint: `Save up: ${rowText(cheapest)}`, action: buyAction(cheapest) };
  }
  return { text: `${ERAS[n]!.region} is for sale!`, action: { kind: 'go', target: `region:${n}` } };
}
