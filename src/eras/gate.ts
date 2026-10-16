/**
 * [PURE] The era gate (docs/EXPANSION.md §C). No THREE, no GameContext.
 *
 * The climb (upgrade levels past their authored max, the era checklist, the new land) opens with the Great Lodge,
 * the point where 0.8.0 shows its finale. Below it era 1 plays exactly like 0.8.0 (R1).
 *
 * Era n's gate (the checklist that makes its expansion pad payable):
 * - rows (0.9.5, Dino): every upgrade of the era before it (introEra = n − 1: Survival's 23 for era 2, then each era's
 *   own crew, machines, belts, rigs and trade), each at Lv 10, the top level. Earlier eras are already done (they
 *   stay at 10). Unbuilt machines and unhired crews count too (R7): a row that cannot be bought yet says why
 *   ('prereq'), an unhired crew shows no level (null, "Not hired").
 * - settlement: level ≥ 5·(n − 1).
 * eraGate() is the full checklist for the UI; gateMet() is the cheap yes/no layout.expansionOffered asks every frame.
 */
import { GATE, UPGRADES, type UpgradeDef } from '../config';
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
  /** The next level pad and the level the gate needs, in the pads' numbering (shown level): "pad LV 8 → LV 10". Pad rows only. */
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

/** Shown level era n's gate asks of every row: 10 · (n − 1) in 'offset' mode, Lv 10 (the top) in 'literal' mode. */
export function gateNeed(n: number): number {
  return GATE.mode === 'literal' ? 10 : 10 * (n - 1);
}

/** Settlement level era n's gate asks. */
export function settlementNeed(n: number): number {
  return 5 * (n - 1);
}

/** Settlement level (docs/EXPANSION.md §B): the village level until Winterland, then state.eras.settlement (6..50). */
export { settlementLevel };

const idsCache = new Map<string, readonly UpgradeId[]>();

/**
 * Era n's gate rows, in table order (cached: gateMet runs every frame): the previous era's own ids in 'literal' mode,
 * every id introduced before era n in 'offset' mode.
 */
function gateIds(n: number): readonly UpgradeId[] {
  const literal = GATE.mode === 'literal';
  const key = `${GATE.mode}:${n}`;
  let ids = idsCache.get(key);
  if (!ids) {
    ids = (Object.keys(UPGRADES) as UpgradeId[]).filter((id) => (literal ? introEra(UPGRADES[id]) === n - 1 : introEra(UPGRADES[id]) <= n - 1));
    idsCache.set(key, ids);
  }
  return ids;
}

/** True when `id` is one of era n's gate rows. */
export function inGate(id: UpgradeId, n: number): boolean {
  return gateIds(n).includes(id);
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

/**
 * Era whose region shop mat sells `def` (Industry upgrades, and 0.9.5's era crews), or null for the cabin's shop mat
 * (and for machine levels, which are bought on pads). Finance (Tax Office, Broker) stays at the cabin.
 */
export function eraMatOf(def: UpgradeDef): number | null {
  if (def.group === 'machine' || def.group === 'finance') return null;
  if (def.group === 'industry') return introEra(def);
  return def.era !== undefined && def.era >= 2 ? def.era : null;
}

function whereOf(def: UpgradeDef): GateWhere {
  return def.group === 'machine' ? 'pad' : eraMatOf(def) !== null ? 'eraShop' : 'shop';
}

function rowOf(s: GameState, id: UpgradeId, n: number): GateRow {
  const def = UPGRADES[id];
  const stored = s.upgrades[id];
  const target = storedNeed(def, n);
  const where = whereOf(def);
  const row: GateRow = {
    id,
    shown: (def.display === 'crew' || def.display === 'belt') && stored <= 0 ? null : shown(def, stored),
    need: gateNeed(n),
    state: 'ok',
    costToNeed: 0,
    where,
  };
  if (stored >= target) return row;
  if (where === 'pad') row.padLabel = `pad LV ${shown(def, stored) + 1} → LV ${gateNeed(n)}`;
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

/**
 * A row bought in the shop panel (shop and Industry rows), which opens only while the player stands on a shop mat (the
 * cabin's, or an era region's for Industry). Pad rows are paid at the machine's level pad (R6). Upgrades are hands-on:
 * nothing is bought from the checklist or from afar.
 */
export function rowBuyable(r: GateRow): boolean {
  return r.state === 'low' && r.where !== 'pad';
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
  const def = UPGRADES[id];
  // 0.9.5: an era machine that is not built yet, or an era crew waiting for the settlement: its region / district
  if (def.group === 'machine' && def.era !== undefined && def.era >= 2) return `region:${def.era}`;
  if (def.era !== undefined && def.era >= 2 && def.requires?.settlement !== undefined) return `district:${s.eras.age}`;
  const r = def.requires;
  if (r?.unlocked && !s.unlocked[r.unlocked]) return `pad:${r.unlocked}`;
  if (r?.villageLevel !== undefined && s.village.level < r.villageLevel) return 'village';
  return 'quarters';
}

/** Buy at the shop, or walk to the machine's level pad. */
function buyAction(r: GateRow): NextGoal['action'] {
  return r.where === 'pad' ? { kind: 'go', target: padTarget(r.id) } : { kind: 'buy', target: r.id };
}

/** Where a machine level is bought: 'pad:<id>' for a Survival machine, 'machine:<id>' for an era machine's level pad. */
export function padTarget(id: UpgradeId): string {
  const e = UPGRADES[id].era;
  return e !== undefined && e >= 2 ? `machine:${id}` : `pad:${id}`;
}

/** "Sharp Axe → Lv 10" (an unhired crew: "Hire the Cashier"). */
function rowText(r: GateRow): string {
  const def = UPGRADES[r.id];
  if (r.shown === null) return def.display === 'belt' ? `Build the ${def.label}` : `Hire the ${def.label}`;
  return `${def.label} → Lv ${r.need}`;
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
  // every lot taken (a chosen but unpaid lot counts): a home has to replace a park or shop (ManagePanel's demolish)
  const lots = s.city.districts[age]?.lots;
  const full = !!lots && lots.length > 0 && !lots.some((l) => l.building === '');
  const next = `Settlement ${g.settlement.level + 1}`;
  const text = !home || !where ? `Grow the city → Settlement ${g.settlementNeed}` : full ? `Swap a park or shop for a home in ${where} → ${next}` : `Build a home in ${where} (+${home.people}) → ${next}`;
  return { text, action: { kind: 'build', target: `district:${age}` } };
}

/** A prereq that only waits for the settlement ("Reach Settlement 37"): the settlement step answers it. */
function settlementPrereq(r: GateRow): boolean {
  return r.state === 'prereq' && UPGRADES[r.id].requires?.settlement !== undefined && /Settlement/.test(r.prereq ?? '');
}

/**
 * The single next goal of the climb (docs/EXPANSION.md §C, ADHD-friendly: one line, one action), or null before the
 * Great Lodge and after the last era. Priority (0.9.6, F7): something to build first (an unbuilt machine) → the
 * cheapest affordable row → the settlement step ("Build a home in Glass Heights", never a bare "Reach Settlement 37")
 * → saving for the cheapest row ("$12K to go") → the expansion pad. `money` is the player's cash (Economy).
 */
export function nextGoal(s: GameState, money: number): NextGoal | null {
  const n = s.eras.age + 1;
  if (!climbOpen(s) || !ERAS[n]) return null;
  // something already paid into the pad keeps it on sale (grandfathered, layout.expansionOffered): point there
  if (padPaid(s, n) > 0) return { text: `${ERAS[n]!.region} is for sale!`, action: { kind: 'go', target: `region:${n}` } };
  const g = eraGate(s, n);
  const open = g.rows.filter((r) => r.state !== 'ok');
  const prereq = open.find((r) => r.state === 'prereq' && !settlementPrereq(r));
  if (prereq) {
    // "Build the Harvester first", not "Harvester: Build the Harvester first" (the upgrade named after its machine)
    const label = UPGRADES[prereq.id].label;
    const text = prereq.prereq!.includes(label) ? prereq.prereq! : `${label}: ${prereq.prereq}`;
    return { text, action: { kind: 'build', target: prereqTarget(prereq.id, s) } };
  }
  const next = (r: GateRow): number => stepCost(UPGRADES[r.id], s.upgrades[r.id]);
  const low = open.filter((r) => r.state === 'low').sort((a, b) => next(a) - next(b) || a.costToNeed - b.costToNeed);
  const cheapest = low[0];
  if (cheapest && next(cheapest) <= money) {
    return { text: `${rowText(cheapest)} (${formatMoney(next(cheapest))})`, action: buyAction(cheapest) };
  }
  if (g.settlement.level < g.settlementNeed || open.some(settlementPrereq)) return settlementGoal(s, g);
  if (cheapest) {
    return { text: `${rowText(cheapest)}: ${formatMoney(next(cheapest) - money)} to go`, hint: `Save up: ${rowText(cheapest)}`, action: buyAction(cheapest) };
  }
  return { text: `${ERAS[n]!.region} is for sale!`, action: { kind: 'go', target: `region:${n}` } };
}

/** Who owns era n − 1's things in the rule line: "Survival's" for era 2, then the region ("Granite Hollow's"). */
function ownerOf(n: number): string {
  const prev = ERAS[n - 1];
  return prev ? `${prev.region}'s` : "Survival's";
}

/**
 * The per-era Lv 10 rule in one sentence (0.9.6, READINESS C1), for the era card and the gate card: "Raise Granite
 * Hollow's machines, crew and upgrades to Lv 10 and grow the city to Settlement 10, then buy Iron Ridge." Empty past
 * the last era.
 */
export function gateRuleText(n: number): string {
  const e = ERAS[n];
  if (!e) return '';
  return `Raise ${ownerOf(n)} machines, crew and upgrades to Lv ${gateNeed(n)} and grow to Settlement ${settlementNeed(n)}, then buy ${e.region}.`;
}

/** The short form for the era card after an expansion: "Next: Granite Hollow's things to Lv 10, then Iron Ridge." */
export function gateRuleShort(n: number): string {
  const e = ERAS[n];
  return e ? `Next: ${ownerOf(n)} things to Lv ${gateNeed(n)}, then ${e.region}` : '';
}

/** The gate card's row groups, in this order (0.9.6, finding 11: "Machines 5 · Crew 7 · Sales 7 · You 4 · Finance 2"). */
export const GATE_GROUPS: readonly { key: string; label: string; groups: readonly UpgradeDef['group'][] }[] = [
  { key: 'machines', label: 'Machines', groups: ['machine'] },
  { key: 'crew', label: 'Crew', groups: ['crew'] },
  { key: 'industry', label: 'Industry', groups: ['industry'] },
  { key: 'sales', label: 'Sales', groups: ['sales'] },
  { key: 'you', label: 'You', groups: ['lumberjack'] },
  { key: 'finance', label: 'Finance', groups: ['finance'] },
];

export interface GateGroupCount {
  key: string;
  label: string;
  ok: number;
  total: number;
}

/** Rows done per group (groups with no rows left out), so the card can show every row's group with a bar. */
export function gateGroups(g: Pick<EraGate, 'rows'>): GateGroupCount[] {
  const out: GateGroupCount[] = [];
  for (const grp of GATE_GROUPS) {
    const rows = g.rows.filter((r) => grp.groups.includes(UPGRADES[r.id].group));
    if (rows.length) out.push({ key: grp.key, label: grp.label, ok: rows.filter((r) => r.state === 'ok').length, total: rows.length });
  }
  return out;
}

/** True when a row only waits for the settlement (the card shows "Locked" in place of Go). */
export function waitsForSettlement(r: GateRow): boolean {
  return settlementPrereq(r);
}
