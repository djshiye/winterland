/**
 * [city] 0.9.0 pure rules of the city districts: lot layout inside a district, what a lot may build, construction
 * progress, demolition, and the economy (population, jobs, employment, happiness, income per second, city rank).
 * No THREE, no GameContext: tests run without WebGL and City / District only wire these numbers to the world.
 *
 * Economy (all derived from state.city, nothing is cached in the save):
 *   residents  = Σ people of built homes          jobs       = Σ jobs of built work + landmark buildings
 *   employment = jobs ? min(1, residents / jobs) : 1
 *   happiness  = min(1, Σ happiness of built parks + landmarks)
 *   income/s   = (Σ home rent + Σ (work + landmark income) × employment) × (1 + CITY_HAPPINESS_BONUS × happiness) × City Hall
 */
import {
  CITY_BUILDINGS,
  CITY_HAPPINESS_BONUS,
  CITY_RANKS,
  DEMOLISH_MIN,
  DEMOLISH_SHARE,
  MATERIALS,
  districtDef,
  cityBuildingsOfEra,
  isMaterial,
  type CityBuildingDef,
  type CityBuildingId,
  type ERect,
} from '../eras/data';
import type { CityLotState, CityState, GameState } from '../core/types';

export interface XZ {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Lot layout
// ---------------------------------------------------------------------------

/** Sidewalk ring between the district edge and the lots (metres). */
export const DISTRICT_MARGIN = 1.8;
/** Side of a lot's pad tile (the construction pad / "BUILD" tile / manage zone). */
export const LOT_PAD = 2;
/** Depth of the lane in front of a lot: the pad plus a walking strip. */
const FRONT_LANE = 3.2;

/** One lot of a district. Every front faces +Z (toward the camera side), so the pad stays visible in front of its building. */
export interface LotFrame {
  index: number;
  /** Footprint centre and size (metres). */
  x: number;
  z: number;
  w: number;
  d: number;
  /** The footprint (collider / model slot). */
  rect: ERect;
  /** Pad / manage zone centre and its tile size. */
  pad: XZ;
  padSize: number;
  /** The pad tile as a rect (the choose / manage zone). */
  zone: ERect;
  /** The whole cell the lot owns (lane included). */
  cell: ERect;
}

/** Grid of a district with `lots` lots: 2 rows up to 8 lots, else 3. */
export function districtGrid(lots: number): { cols: number; rows: number } {
  const rows = lots <= 8 ? 2 : 3;
  return { cols: Math.ceil(lots / rows), rows };
}

/** Widest / deepest footprint a lot of era n may have: lots shrink and buildings grow taller as the eras rise. */
export function maxFootprint(n: number): { w: number; d: number } {
  return { w: 8.2 - 0.4 * (n - 2), d: 7.2 - 0.45 * (n - 2) };
}

/** The walkable inner area of district n (inside the sidewalk ring). */
export function districtInner(n: number): ERect {
  const r = districtDef(n).rect;
  return { minX: r.minX + DISTRICT_MARGIN, maxX: r.maxX - DISTRICT_MARGIN, minZ: r.minZ + DISTRICT_MARGIN, maxZ: r.maxZ - DISTRICT_MARGIN };
}

/** Pure layout of district n: DISTRICTS[n].lots lots on a grid (row-major, north row first), fronts facing +Z. */
export function districtLots(n: number): LotFrame[] {
  const def = districtDef(n);
  const inner = districtInner(n);
  const { cols, rows } = districtGrid(def.lots);
  const cw = (inner.maxX - inner.minX) / cols;
  const ch = (inner.maxZ - inner.minZ) / rows;
  const max = maxFootprint(n);
  const w = Math.min(cw - 1.2, max.w);
  const d = Math.min(ch - FRONT_LANE - 0.8, max.d);
  const out: LotFrame[] = [];
  for (let i = 0; i < def.lots; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const cell: ERect = { minX: inner.minX + c * cw, maxX: inner.minX + (c + 1) * cw, minZ: inner.minZ + r * ch, maxZ: inner.minZ + (r + 1) * ch };
    const cx = (cell.minX + cell.maxX) / 2;
    const front = cell.maxZ - FRONT_LANE;
    const rect: ERect = { minX: cx - w / 2, maxX: cx + w / 2, minZ: front - d, maxZ: front };
    const pz = front + 0.6 + LOT_PAD / 2;
    out.push({
      index: i,
      x: cx,
      z: front - d / 2,
      w,
      d,
      rect,
      pad: { x: cx, z: pz },
      padSize: LOT_PAD,
      zone: { minX: cx - LOT_PAD / 2, maxX: cx + LOT_PAD / 2, minZ: pz - LOT_PAD / 2, maxZ: pz + LOT_PAD / 2 },
      cell,
    });
  }
  return out;
}

/** True when two rects overlap (touching edges do not count). */
export function rectsOverlap(a: ERect, b: ERect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/**
 * Soft-compress a building's data height (5 … 111 m) into the height the model is drawn with (5 … ~31 m): the
 * isometric camera only shows ~13 m of ground vertically, and a 100 m slab would hide half the district behind it.
 */
export function visualHeight(h: number): number {
  return h <= 8 ? h : 8 + 9 * Math.log(1 + (h - 8) / 9);
}

// ---------------------------------------------------------------------------
// Lot state
// ---------------------------------------------------------------------------

export const lotBuilt = (l: CityLotState): boolean => l.building !== '' && l.tier >= 0;
/** Nothing paid yet: the player may still (re)choose the building. */
export const lotOpen = (l: CityLotState): boolean => l.tier < 0 && l.cash <= 0 && l.extra <= 0;
export const emptyLot = (): CityLotState => ({ building: '', tier: -1, cash: 0, extra: 0 });

/** Is there already a landmark in this district (other than on lot `except`)? Built or being paid. */
export function landmarkTaken(lots: readonly CityLotState[], except = -1): boolean {
  return lots.some((l, i) => i !== except && l.building !== '' && CITY_BUILDINGS[l.building].kind === 'landmark');
}

/** "$400,000 + 15 Bricks" */
export function costText(def: CityBuildingDef): string {
  const k = def.extra.kind;
  const label = isMaterial(k) ? MATERIALS[k].label : String(k);
  return `$${def.cash.toLocaleString('en-US')} + ${def.extra.count} ${label}`;
}

/** Why `id` can't be built on lot `lot` of district n right now, or undefined when it can. */
export function lockReason(city: CityState, n: number, lot: number, id: CityBuildingId): string | undefined {
  const def = CITY_BUILDINGS[id];
  const lots = city.districts[n]?.lots;
  if (!def || !lots || !lots[lot]) return 'Not available';
  if (def.era !== n) return 'Not for this district';
  if (def.kind === 'landmark' && landmarkTaken(lots, lot)) return 'One landmark per district';
  return undefined;
}

/** The buildings offered on a lot of district n (every id of the era), with their lock reason. */
export function chooseOptions(city: CityState, n: number, lot: number): { id: CityBuildingId; def: CityBuildingDef; locked?: string }[] {
  return cityBuildingsOfEra(n).map((id) => {
    const locked = lockReason(city, n, lot, id);
    return locked ? { id, def: CITY_BUILDINGS[id], locked } : { id, def: CITY_BUILDINGS[id] };
  });
}

/** A lot may be (re)chosen while nothing is paid on it and the choice is allowed. */
export function canChoose(state: GameState, n: number, lot: number, id: CityBuildingId): boolean {
  const l = state.city.districts[n]?.lots[lot];
  if (!l || state.eras.age < n || !lotOpen(l)) return false;
  return lockReason(state.city, n, lot, id) === undefined;
}

/** Share of the chosen building's price already paid (0..1; a built lot is 1). */
export function paidFraction(l: CityLotState): number {
  if (l.building === '') return 0;
  if (l.tier >= 0) return 1;
  const def = CITY_BUILDINGS[l.building];
  const cash = def.cash > 0 ? Math.min(1, l.cash / def.cash) : 1;
  const extra = def.extra.count > 0 ? Math.min(1, l.extra / def.extra.count) : 1;
  return (cash + extra) / 2;
}

/**
 * A save written while a lot's last bundle was still flying holds a fully paid, never-completed building (progress
 * counts in-flight payments). Finish those lots now (tier 0, paid reset). Returns how many were settled.
 */
export function settlePaidCity(state: GameState): number {
  let n = 0;
  for (const d of state.city.districts) {
    for (const l of d.lots) {
      if (l.building === '' || l.tier >= 0) continue;
      const def = CITY_BUILDINGS[l.building];
      if (l.cash < def.cash || l.extra < def.extra.count) continue;
      l.tier = 0;
      l.cash = 0;
      l.extra = 0;
      n++;
    }
  }
  return n;
}

/** Price to demolish a building: DEMOLISH_SHARE of its cash price, at least DEMOLISH_MIN. */
export function demolishCost(def: CityBuildingDef): number {
  return Math.max(DEMOLISH_MIN, Math.round(def.cash * DEMOLISH_SHARE));
}

/** Clear a built lot (no refund): returns the demolished building id, or '' when there was nothing built. */
export function demolishLot(state: GameState, n: number, lot: number): CityBuildingId | '' {
  const l = state.city.districts[n]?.lots[lot];
  if (!l || !lotBuilt(l)) return '';
  const id = l.building;
  l.building = '';
  l.tier = -1;
  l.cash = 0;
  l.extra = 0;
  state.stats.demolished++;
  return id;
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export interface CityTotals {
  /** Residents of the districts (Σ people of built homes). */
  residents: number;
  /** Jobs (Σ work + landmark jobs, built). */
  jobs: number;
  /** Σ rent of built homes ($/s, independent of jobs). */
  rent: number;
  /** Σ income of built work + landmark buildings ($/s at full employment). */
  business: number;
  /** Σ happiness of built parks + landmarks, capped at 1. */
  happiness: number;
  /** Built buildings. */
  buildings: number;
}

/** Totals of every built building of every district (optionally only district `only`). */
export function cityTotals(city: CityState, only = 0): CityTotals {
  const t: CityTotals = { residents: 0, jobs: 0, rent: 0, business: 0, happiness: 0, buildings: 0 };
  city.districts.forEach((d, n) => {
    if (only > 0 && n !== only) return;
    for (const l of d.lots) {
      if (!lotBuilt(l)) continue;
      const def = CITY_BUILDINGS[l.building as CityBuildingId];
      if (!def) continue;
      t.buildings++;
      t.happiness += def.happiness;
      if (def.kind === 'home') {
        t.residents += def.people;
        t.rent += def.income;
      } else if (def.kind === 'work' || def.kind === 'landmark') {
        t.jobs += def.jobs;
        t.business += def.income;
      }
    }
  });
  t.happiness = Math.min(1, t.happiness);
  return t;
}

/** Share of the jobs that are filled by residents (1 when there are no jobs). */
export function employment(residents: number, jobs: number): number {
  return jobs > 0 ? Math.min(1, residents / jobs) : 1;
}

/** Income per second split into rent and business, both already multiplied by happiness and City Hall (`taxMult`). */
export function incomeSplit(t: CityTotals, taxMult = 1): { rent: number; business: number; total: number } {
  const k = (1 + CITY_HAPPINESS_BONUS * t.happiness) * taxMult;
  const rent = t.rent * k;
  const business = t.business * employment(t.residents, t.jobs) * k;
  return { rent, business, total: rent + business };
}

/** City income per second. */
export function incomePerSecond(t: CityTotals, taxMult = 1): number {
  return incomeSplit(t, taxMult).total;
}

/** Index into CITY_RANKS: the highest rank whose population and era are both reached. */
export function rankFor(totalPopulation: number, age: number): number {
  let best = 0;
  CITY_RANKS.forEach((r, i) => {
    if (totalPopulation >= r.minPopulation && age >= r.minEra) best = i;
  });
  return best;
}

/** Skyline towers at this total population: none below 500 people, up to `max` at Metropolis size. */
export function skylineCount(totalPopulation: number, max = 220): number {
  const lo = CITY_RANKS[1]?.minPopulation ?? 500;
  const hi = CITY_RANKS[CITY_RANKS.length - 1]?.minPopulation ?? 100_000;
  if (totalPopulation < lo) return 0;
  const k = Math.min(1, (totalPopulation - lo) / (hi - lo));
  return Math.max(1, Math.round(max * Math.sqrt(k)));
}
