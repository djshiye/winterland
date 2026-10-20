/**
 * [0.9.0 Ages — UI] Pure helpers behind the Ages panels (no DOM, no THREE, no GameContext): era labels, cost lines,
 * which shop tabs / era groups are on show, the income ticker's aggregation, the map's travel groups and notes.
 * Unit-tested in tests/agesUi.test.ts; the panels (ShopPanel, MapPanel, EraChip, AgeCard, HUD) only render what these say.
 */
import { CITY_RANKS, ERA_NAMES, ERAS, eraNoun, MATERIALS, MAX_ERA, isMaterial, unlockCash } from '../eras/data';
import type { TravelPoint } from '../eras/layout';
import type { GameState, IncomeSource, ItemKind, UpgradeId } from '../core/types';
import { UPGRADES, eraRoleCount } from '../config';
import { cityTotals, rankFor } from '../city/rules';
import { formatMoney } from './format';
import { romanNumeral } from '../world/env/eras';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Roman numeral for 1..10 (empty string outside that range). */
export function eraRoman(n: number): string {
  return ROMAN[Math.floor(n)] ?? '';
}

/** "ERA IV · STEAM AGE". */
export function eraTitle(n: number): string {
  return `ERA ${eraRoman(n)} · ${(ERA_NAMES[n] ?? '').toUpperCase()}`;
}

/** The unlock banner's name for a village level: "SETTLEMENT · WINTER CITY" (the old village levels are not eras). */
export function settlementTitle(level: number): string {
  return level > 0 ? `SETTLEMENT ${romanNumeral(level)}` : 'SETTLEMENT';
}

const SURVIVAL_LABELS: Record<string, string> = {
  log: 'Logs',
  plank: 'Planks',
  crate: 'Crates',
  cash: 'Cash',
  furniture: 'Chairs',
  wheat: 'Wheat',
  bread: 'Bread',
  meat: 'Meat',
  sausage: 'Sausages',
  toy: 'Toys',
};

/** Plural display label of an item kind ("Crates", "Bricks", "Iron Ore"). */
export function itemLabel(kind: ItemKind): string {
  if (isMaterial(kind)) return MATERIALS[kind].label;
  return SURVIVAL_LABELS[kind] ?? kind;
}

/** "$27,000 + 12 Stone" (the extra part only when there is one). */
export function costText(cash: number, extra?: { kind: ItemKind; count: number } | null): string {
  const base = formatMoney(cash);
  return extra && extra.count > 0 ? `${base} + ${extra.count} ${itemLabel(extra.kind)}` : base;
}

/** "Expansion: $150K + 40 Crates" for era n's pad. */
export function expansionCostText(n: number): string {
  const e = ERAS[n];
  if (!e) return '';
  return `Expansion: ${costText(unlockCash(n), e.unlock.extra)}`;
}

/**
 * 0.9.12 (E1): the gate card's money line leads with the real cost. The upgrades left cost far more than the pad
 * ($17.55M of Survival upgrades against a $1.5M expansion), so: "Upgrades left: 12 (about $4.2M), then the expansion:
 * $1.5M + 40 crates". `left` open rows costing `cost` in all at today's prices.
 */
export function gateMoneyLine(n: number, left: number, cost: number): string {
  const exp = expansionCostText(n).replace(/^Expansion/, 'expansion');
  if (left <= 0) return `Then the ${exp}`;
  return `<b>Upgrades left: ${left}</b> (about ${formatMoney(cost)}), then the ${exp}`;
}

/** What a locked era region needs first: "Reach the Iron Age first" (era 2: the Great Lodge opens the climb). */
export function reachNote(n: number): string {
  return n <= 2 ? 'Build the Great Lodge first' : `Reach the ${eraNoun(n - 1)} first`;
}

// ---------------------------------------------------------------------------
// Shop tabs
// ---------------------------------------------------------------------------

export type ShopTab = 'lumberjack' | 'crew' | 'sales' | 'industry' | 'finance';

/** Every shop tab in display order. */
export const SHOP_TABS: readonly ShopTab[] = ['lumberjack', 'crew', 'sales', 'industry', 'finance'];

/**
 * The tabs on show: Industry appears once the climb opens (the Great Lodge, eras/gate.ts) or era 2 is reached; Finance is there from
 * the start (Jack's Swap Cart is available at once).
 */
export function shopTabs(age: number, climbOpen: boolean): ShopTab[] {
  return SHOP_TABS.filter((t) => t !== 'industry' || age >= 2 || climbOpen);
}

/** Industry eras listed in the shop: every era up to the one after the current age (the next one is shown locked). */
export function industryErasShown(age: number): number[] {
  const out: number[] = [];
  for (let n = 2; n <= Math.min(MAX_ERA, Math.max(1, Math.floor(age)) + 1); n++) out.push(n);
  return out;
}

/** True when era n's industry upgrades are listed at this age. */
export function industryEraShown(n: number, age: number): boolean {
  return n >= 2 && n <= Math.min(MAX_ERA, Math.floor(age) + 1);
}

/** "Needs the Iron Age era" for a listed-but-locked era (null when reached). */
export function industryEraNote(n: number, age: number): string | null {
  return age >= n ? null : `Needs the ${eraNoun(n)}`;
}

// ---------------------------------------------------------------------------
// 0.9.0 climb: the shop's band view and the checklist rows (docs/EXPANSION.md R5, R6, §C)
// ---------------------------------------------------------------------------

/** Pips per band: the bar always reads 0..10 of this era. */
export const BAND_PIPS = 10;

export interface BandView {
  /** Pips lit (0..10) of the band that ends at the gate's level. */
  fill: number;
  /** "Lv 7 · need 10", "Lv 10 ✓", "Not hired", "Lv 10". */
  text: string;
  /** 'low' below the gate's level, 'ok' at it, '' with no gate ahead. */
  tone: 'low' | 'ok' | '';
}

/**
 * One shop card's band view. `shown` is the shown level; `hired` is false for a crew at stored 0; `need` is the next
 * gate's level for an id in that gate, else null. (0.9.7: the old climb's band star and "era standard" are gone: every
 * upgrade goes Lv 1 → 10 once, R17.)
 */
export function bandView(shown: number, hired: boolean, need: number | null, unhired = 'Not hired'): BandView {
  const top = need ?? Math.max(BAND_PIPS, Math.ceil(shown / BAND_PIPS) * BAND_PIPS);
  const fill = Math.max(0, Math.min(BAND_PIPS, shown - (top - BAND_PIPS)));
  const below = need !== null && shown < need;
  let text = hired ? `Lv ${shown}` : unhired;
  if (below) text += ` \u00b7 need ${need}`;
  else if (need !== null && hired) text += ' \u2713';
  return { fill, text, tone: below ? 'low' : need !== null && hired ? 'ok' : '' };
}

/** The checklist row's second line: the prereq, "pad LV 8 → LV 10 · $X" (R6) or "Lv 7 → 10 · $X in all". */
export function gateRowLine(row: { id?: string; shown: number | null; need: number; state: string; prereq?: string; costToNeed: number; where: string; padLabel?: string }): string {
  if (row.state === 'prereq') return row.prereq ?? '';
  if (row.where === 'pad') return `${row.padLabel ?? ''} \u00b7 ${formatMoney(row.costToNeed)}`;
  const lv = row.shown === null ? (UPGRADES[row.id as UpgradeId]?.display === 'belt' ? 'Not built' : 'Not hired') : `Lv ${row.shown}`;
  return `${lv} \u2192 ${row.need} \u00b7 ${formatMoney(row.costToNeed)} in all`;
}

// ---------------------------------------------------------------------------
// City chip / income ticker
// ---------------------------------------------------------------------------

/** The era chip shows once the climb opens (the Great Lodge) or era 2 was reached. */
export function eraChipVisible(age: number, climbOpen: boolean): boolean {
  return age >= 2 || climbOpen;
}

/** The era chip's seed on load (village + district residents, rank), the same numbers 'city:changed' carries. */
export function cityStanding(state: Pick<GameState, 'village' | 'city' | 'eras'>): { population: number; rank: number } {
  const population = state.village.population + cityTotals(state.city).residents;
  return { population, rank: rankFor(population, state.eras.age) };
}

/** "1,234" below 10,000; "12.3K" / "1.2M" above. */
export function formatPopulation(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (v < 10_000) return v.toLocaleString('en-US');
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 100_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(v / 1_000_000).toFixed(v < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '')}M`;
}

/** City rank name for a CITY_RANKS index (clamped). */
export function rankName(rank: number): string {
  const r = CITY_RANKS[Math.max(0, Math.min(CITY_RANKS.length - 1, Math.floor(rank)))]!;
  return r.name;
}

const INCOME_LABEL: Record<IncomeSource, string> = {
  rent: 'city',
  business: 'city',
  interest: 'interest',
  trade: 'trade',
  jack: 'Jack',
  harvest: 'harvest',
};

/** A flushed batch of income. */
export interface IncomeBatch {
  amount: number;
  /** "+$12.5K city". */
  text: string;
}

/**
 * Aggregates 'income' events into one "+$12.5K city" line every `interval` seconds (not one per event): add() on each
 * event, update(dt) each frame; update() returns a batch when the interval has passed and something is pending.
 */
export class IncomeTicker {
  private readonly totals: Record<string, number> = {};
  private pending = 0;
  private timer = 0;

  constructor(readonly interval = 3) {}

  /** Record one income event (non-positive amounts are ignored). */
  add(source: IncomeSource, amount: number): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    const label = INCOME_LABEL[source];
    this.totals[label] = (this.totals[label] ?? 0) + amount;
    this.pending += amount;
  }

  /** Money waiting for the next flush. */
  get waiting(): number {
    return this.pending;
  }

  /** Advance time; returns the batch to show when one is due. */
  update(dt: number): IncomeBatch | null {
    this.timer += dt;
    if (this.timer < this.interval || this.pending <= 0) return null;
    let label = 'city';
    let best = -1;
    for (const [k, v] of Object.entries(this.totals)) {
      if (v > best) {
        best = v;
        label = k;
      }
    }
    const batch = { amount: this.pending, text: `+${formatMoney(this.pending)} ${label}` };
    this.pending = 0;
    this.timer = 0;
    for (const k of Object.keys(this.totals)) delete this.totals[k];
    return batch;
  }
}

// ---------------------------------------------------------------------------
// Map / fast travel
// ---------------------------------------------------------------------------

export interface TravelGroup {
  title: string;
  points: TravelPoint[];
}

/** Travel points grouped for the map list: Home / Regions / City (empty groups dropped, order kept). */
export function groupTravelPoints(points: readonly TravelPoint[]): TravelGroup[] {
  const defs: Array<[TravelPoint['kind'], string]> = [
    ['home', 'Home'],
    ['region', 'Regions'],
    ['district', 'City'],
  ];
  return defs
    .map(([kind, title]) => ({ title, points: points.filter((p) => p.kind === kind) }))
    .filter((g) => g.points.length > 0);
}

export interface TravelNote {
  /** Expansion price line of a region that is not bought yet. */
  cost: string | null;
  /** Why it is not reachable / what to do next. */
  need: string | null;
}

/** The sub-lines of a travel point's row: price of a locked region's expansion and what it needs. */
export function travelNote(p: TravelPoint, age: number): TravelNote {
  if (p.kind === 'home') return { cost: null, need: p.open ? null : 'Not found yet' };
  if (p.kind === 'district') return { cost: null, need: age >= p.era ? null : `Needs the ${eraNoun(p.era)}` };
  if (age >= p.era) return { cost: null, need: null };
  return { cost: expansionCostText(p.era), need: p.open ? 'Pad is open: buy it to enter' : reachNote(p.era) };
}

/**
 * 0.9.5: an era crew card's effect line, short enough for the card: "Hires 1 worker", "2 → 3 workers · ×1.6" on the
 * levels that hire, "×1.6 → ×1.7 speed" otherwise, "3 workers · ×2.4 (max)" at the top. `v` is the work multiplier
 * at `level` / `level + 1` (null at max).
 */
export function eraCrewDelta(level: number, v: number, vNext: number | null): string {
  const x = (k: number): string => `×${Math.round(k * 100) / 100}`;
  const n = eraRoleCount(level);
  const workers = (k: number): string => `${k} worker${k === 1 ? '' : 's'}`;
  if (vNext === null) return `${workers(n)} · ${x(v)} (max)`;
  if (level <= 0 || v <= 0) return `Hires ${workers(eraRoleCount(level + 1))}`;
  const m = eraRoleCount(level + 1);
  return m !== n ? `${n} → ${workers(m)} · ${x(vNext)}` : `${x(v)} → ${x(vNext)} speed`;
}

/**
 * A card's effect line: "50 items → 60 items", "50 items (max)" at the top. 0.9.6: the old "(max) · +1 Mastery" line
 * is gone: it showed on levels that earned no Mastery, and no level for sale leaves its effect unchanged any more
 * (tests/ladderLevels.test.ts). `climb` is kept for the callers.
 */
export function shopDelta(now: string, next: string | null, _climb: boolean): string {
  if (next === null) return `${now} (max)`;
  return `${now} → ${next}`;
}
