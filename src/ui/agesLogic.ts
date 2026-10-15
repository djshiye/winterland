/**
 * [0.9.0 Ages — UI] Pure helpers behind the Ages panels (no DOM, no THREE, no GameContext): era labels, cost lines,
 * which shop tabs / era groups are on show, the income ticker's aggregation, the map's travel groups and notes.
 * Unit-tested in tests/agesUi.test.ts; the panels (ShopPanel, MapPanel, EraChip, AgeCard, HUD) only render what these say.
 */
import { CITY_RANKS, ERA_NAMES, ERAS, MATERIALS, MAX_ERA, isMaterial, unlockCash } from '../eras/data';
import type { TravelPoint } from '../eras/layout';
import type { GameState, IncomeSource, ItemKind } from '../core/types';
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

/** What a locked era region needs first: "Reach the Iron Age first" (era 2: the Great Lodge opens the climb). */
export function reachNote(n: number): string {
  return n <= 2 ? 'Build the Great Lodge first' : `Reach the ${ERA_NAMES[n - 1] ?? 'previous'} first`;
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
  return age >= n ? null : `Needs the ${ERA_NAMES[n] ?? 'next'} era`;
}

// ---------------------------------------------------------------------------
// 0.9.0 climb: the shop's band view and the checklist rows (docs/EXPANSION.md R5, R6, §C)
// ---------------------------------------------------------------------------

/** Pips per band: the bar always reads 0..10 of this era. */
export const BAND_PIPS = 10;

export interface BandView {
  /** Pips lit (0..10) of the band that ends at the gate's level. */
  fill: number;
  /** Whole bands done (the band star's number; 0 hides it). */
  bands: number;
  /** "Lv 23 · need 30", "Lv 30 ✓", "Not hired", "Lv 10 · era standard", "Lv 47". */
  text: string;
  /** 'low' below the gate's level, 'ok' at it, '' with no gate ahead. */
  tone: 'low' | 'ok' | '';
}

/**
 * One shop card's band view. `shown` is the shown level, `stored` the stored one and `base` the era offset (R4);
 * `hired` is false for a crew at stored 0; `need` is the next era's gate level for an id in that gate, else null.
 */
export function bandView(shown: number, stored: number, base: number, hired: boolean, need: number | null): BandView {
  const top = need ?? Math.max(BAND_PIPS, Math.ceil(shown / BAND_PIPS) * BAND_PIPS);
  const fill = Math.max(0, Math.min(BAND_PIPS, shown - (top - BAND_PIPS)));
  const below = need !== null && shown < need;
  let text = hired ? `Lv ${shown}` : 'Not hired';
  // R5: an era upgrade that just arrived at its offset says so (the tooltip explains; the tab dot still says "below")
  if (hired && stored === 0 && base > 0) text += ' \u00b7 era standard';
  else if (below) text += ` \u00b7 need ${need}`;
  else if (need !== null && hired) text += ' \u2713';
  return { fill, bands: Math.floor(shown / BAND_PIPS), text, tone: below ? 'low' : need !== null && hired ? 'ok' : '' };
}

/** The checklist row's second line: the prereq, "pad LV 8 → LV 11 · $X" (R6) or "Lv 7 → 10 · $X in all". */
export function gateRowLine(row: { shown: number | null; need: number; state: string; prereq?: string; costToNeed: number; where: string; padLabel?: string }): string {
  if (row.state === 'prereq') return row.prereq ?? '';
  if (row.where === 'pad') return `${row.padLabel ?? ''} \u00b7 ${formatMoney(row.costToNeed)}`;
  const lv = row.shown === null ? 'Not hired' : `Lv ${row.shown}`;
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
  if (p.kind === 'district') return { cost: null, need: age >= p.era ? null : `Needs the ${ERA_NAMES[p.era] ?? 'next'} era` };
  if (age >= p.era) return { cost: null, need: null };
  return { cost: expansionCostText(p.era), need: p.open ? 'Pad is open: buy it to enter' : reachNote(p.era) };
}
