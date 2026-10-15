/**
 * [MAIN] Save / resume / offline earnings.
 *
 * A save is GameState (all progress) + money + what lies in the world (pile counts, cash-pile dollars, the
 * player's arms) + the recent sales rate + the wall-clock time it was written. It is LOADED BEFORE any system is
 * built: Game merges it into a fresh createGameState() and hands the money to Economy, every system then builds
 * itself from state (instantly, silently) and Level.restoreWorld() refills the piles.
 *
 * Storage can be missing, full or blocked (private windows, embedded pages): every access is wrapped and the game
 * simply runs without saving. `?fresh` in the URL ignores (but does not delete) the save.
 */
import { AMENITIES, AMENITY_IDS, BUSINESSES, CONTRACTS, DAYNIGHT, ECONOMY, OFFLINE, PRESTIGE, PRIORITIES, QUARTERS, SAVE, UPGRADES, VILLAGE, type BusinessId } from '../config';
import { CARRY_KINDS, createGameState, LOT_COUNT, MATERIAL_KINDS, REGION_SLOTS, type CarryKind, type FlagId, type GameContext, type GameState, type InvestmentState, type ItemKind } from './types';
import { CITY_BUILDINGS, ERAS, INVEST, INVEST_IDS, INVEST_MAX_POSITIONS, MACHINES, MARKET, MAX_ERA, type CityBuildingId, type MachineId } from '../eras/data';

/** Items lying in the world, by station (counts include items still flying toward it). */
export interface WorldSnapshot {
  piles: {
    dropZone: number;
    walkIn: number;
    hopper: number;
    bench: number;
    se: number;
    truck: number;
    /** Timber Ridge log deck and rail platform (wave 7; 0 in older saves). */
    deck: number;
    platform: number;
    /** Wave 8 furniture workshop (hopper logs, bench furniture) and sled counter (0 in older saves). */
    workshopIn: number;
    workshopOut: number;
    sled: number;
  };
  /** Dollars in each cash pile. */
  cash: {
    walkIn: number;
    se: number;
    truck: number;
    platform: number;
    sled: number;
  };
  /** Items in the player's arms by kind (every CARRY_KINDS entry; 0.9.0 added the era materials). */
  arms: Record<CarryKind, number>;
  /**
   * Wave 9 Market Town, one entry per LAYOUT.town.lots (absent in older saves): items in the business's input
   * hopper by kind, items on its out pile / shop counter (its output kind), dollars in its till. Counts include
   * items in flight toward it, items being processed, and goods already handed to an unpaid buyer.
   */
  town: { in: Partial<Record<ItemKind, number>>; out: number; cash: number }[];
  /**
   * 0.9.0, index = era (0 and 1 empty): per machine slot the items in its input pile (by kind) and on its out pile
   * (its output kind), and the region import dock's contents by kind. Absent in older saves (→ empty).
   */
  eras: { slots: { in: Partial<Record<ItemKind, number>>; out: number }[]; dock: Partial<Record<ItemKind, number>> }[];
}

export interface SaveData {
  v: number;
  /** Date.now() when written. */
  savedAt: number;
  money: number;
  state: GameState;
  world: WorldSnapshot;
  /** Recent sales, dollars per simulated second (offline earnings). */
  salesRate: number;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when the page asked to ignore the save (tests: `?fresh`). */
export function freshRequested(): boolean {
  try {
    return new URLSearchParams(location.search).has('fresh');
  } catch {
    return false;
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = storage()?.getItem(SAVE.key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (!data || data.v !== SAVE.version || typeof data.state !== 'object' || !data.state) return null;
    if (!isNum(data.money) || !isNum(data.savedAt)) return null;
    return {
      v: data.v,
      savedAt: data.savedAt,
      money: Math.max(0, Math.floor(data.money)),
      state: data.state,
      world: sanitizeWorld(data.world),
      salesRate: isNum(data.salesRate) ? Math.max(0, data.salesRate) : 0,
    };
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(SAVE.key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE.key);
  } catch {
    // nothing to clear
  }
}

/**
 * Copy saved progress into a fresh state, keeping the fresh defaults for anything missing or malformed (fields
 * added in later versions, a truncated save). Arrays of objects (village plots) are merged element by element
 * with the fresh array's length.
 */
export function mergeState(target: GameState, saved: unknown): void {
  mergeInto(target as unknown as Record<string, unknown>, saved);
  // 0.9.0: open-ended arrays (the fresh one is empty, so mergeInto keeps nothing): copied here, sanitized later.
  const inv = isObj(saved) && isObj(saved.market) ? saved.market.investments : undefined;
  if (Array.isArray(inv)) {
    target.market.investments = inv.filter(isObj).slice(0, INVEST_MAX_POSITIONS).map((o) => ({
      id: isNum(o.id) ? o.id : 0,
      product: (typeof o.product === 'string' ? o.product : '') as InvestmentState['product'],
      era: isNum(o.era) ? o.era : 0,
      principal: isNum(o.principal) ? o.principal : 0,
      value: isNum(o.value) ? o.value : 0,
      age: isNum(o.age) ? o.age : 0,
    }));
  }
}

function mergeInto(target: Record<string, unknown>, saved: unknown): void {
  if (!isObj(saved)) return;
  for (const key of Object.keys(target)) {
    const t = target[key];
    const s = saved[key];
    if (s === undefined) continue;
    if (Array.isArray(t)) {
      if (!Array.isArray(s)) continue;
      for (let i = 0; i < t.length; i++) {
        if (isObj(t[i])) mergeInto(t[i] as Record<string, unknown>, s[i]);
        else if (typeof s[i] === typeof t[i]) t[i] = s[i];
      }
    } else if (isObj(t)) {
      // Open records (flags, padPaid) take every saved entry of the right type; fixed records only known keys.
      if (Object.keys(t).length === 0) {
        if (isObj(s)) for (const k of Object.keys(s)) if (typeof s[k] === 'boolean' || isNum(s[k])) t[k] = s[k];
      } else {
        mergeInto(t, s);
      }
    } else if (typeof s === typeof t && (typeof s !== 'number' || Number.isFinite(s))) {
      target[key] = s;
    }
  }
}

const PHASES: readonly string[] = ['intro', 'manual', 'harvester', 'processor', 'automation', 'expansion'];

/**
 * Make a merged state safe to build from. mergeState only checks types, so a hand-edited / corrupted save can hold
 * out-of-range indices (a plot tier of 99, an upgrade level of 99) that crash the constructors and brick the game on
 * every reload. Clamps every index-like and counter field into its valid range; a state that is already valid is
 * left untouched (both save fixtures round-trip unchanged, see tests/save.test.ts).
 */
export function sanitizeState(state: GameState): void {
  const int = (v: unknown, lo: number, hi: number): number => (isNum(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo);
  const nonNeg = (v: unknown): number => (isNum(v) ? Math.max(0, v) : 0);

  if (!PHASES.includes(state.phase)) state.phase = state.flags.introDone ? 'manual' : 'intro';

  for (const def of Object.values(UPGRADES)) {
    state.upgrades[def.id] = int(state.upgrades[def.id], 0, def.values.length - 1);
  }

  // A construction site: tier in [-1, lastTier]; paid progress toward the NEXT tier never above its cost.
  const site = (p: { tier: number; logs: number; cash: number }, lastTier: number, next: ((tier: number) => { logs: number; cash: number } | undefined)): void => {
    p.tier = int(p.tier, -1, lastTier);
    // int() floors at its lower bound for non-numbers, which for tier means -1: right ("not built").
    const cost = next(p.tier);
    p.logs = cost ? int(p.logs, 0, cost.logs) : 0;
    p.cash = cost ? int(p.cash, 0, cost.cash) : 0;
  };
  const v = state.village;
  for (const p of v.plots) site(p, VILLAGE.tiers.length - 1, (t) => VILLAGE.tiers[t + 1]);
  site(v.greatLodge, 0, (t) => (t < 0 ? VILLAGE.greatLodge : undefined));
  site(state.quarters, QUARTERS.tiers.length - 1, (t) => QUARTERS.tiers[t + 1]);
  // Town lots: an unknown building id (a removed / renamed business) frees the lot; one building tier (0 = built).
  for (const lot of state.town.lots) {
    if (lot.building !== '' && !(lot.building in BUSINESSES)) lot.building = '';
    const def = lot.building === '' ? undefined : BUSINESSES[lot.building as BusinessId];
    site(lot, def ? 0 : -1, (t) => (t < 0 && def ? def : undefined));
  }
  // wave 12: amenities, one tier each (0 = built)
  for (const id of AMENITY_IDS) site(state.town.amenities[id], 0, (t) => (t < 0 ? AMENITIES[id] : undefined));
  // wave 13: the Grand Market (one tier) and the contract
  site(state.town.grandMarket, 0, (t) => (t < 0 ? VILLAGE.grandMarket : undefined));
  state.town.grandMarket.toys = int(state.town.grandMarket.toys, 0, state.town.grandMarket.tier < 0 ? VILLAGE.grandMarket.toys : 0);
  {
    const c = state.contract;
    const offer = CONTRACTS.offers.find((o) => o.kind === c.kind);
    if (!offer) {
      c.kind = '';
      c.target = c.progress = c.left = c.bonus = 0;
    } else {
      c.target = int(c.target, 1, 100000);
      c.progress = int(c.progress, 0, c.target);
      c.left = Math.max(0, Math.min(isNum(c.left) ? c.left : 0, CONTRACTS.seconds));
      c.bonus = int(c.bonus, 0, 1_000_000);
    }
  }
  // wave 11: priorities are enums
  if (!PRIORITIES.wood.includes(state.priorities.wood)) state.priorities.wood = 'balanced';
  if (!PRIORITIES.town.includes(state.priorities.town)) state.priorities.town = 'balanced';
  v.level = int(v.level, 0, VILLAGE.levels.length - 1);
  v.population = int(v.population, 0, Number.MAX_SAFE_INTEGER);

  // 0.9.0 Ages. A paid site: tier in [-1, 0]; paid cash / extra never above the price of what is being built.
  const paidSite = (p: { tier: number; cash: number; extra: number }, price: { cash: number; extra?: { count: number } } | undefined): void => {
    p.tier = price ? int(p.tier, -1, 0) : -1;
    p.cash = price && p.tier < 0 ? int(p.cash, 0, price.cash) : 0;
    p.extra = price && p.tier < 0 ? int(p.extra, 0, price.extra?.count ?? 0) : 0;
  };
  const e = state.eras;
  e.age = int(e.age, 1, MAX_ERA);
  for (let n = 0; n < e.regions.length; n++) {
    const r = e.regions[n]!;
    const def = ERAS[n];
    // a region is unlocked exactly when its era was reached (the age is the source of truth)
    r.unlocked = !!def && n <= e.age;
    r.cash = def && !r.unlocked ? int(r.cash, 0, def.unlock.cash) : 0;
    r.extra = def && !r.unlocked ? int(r.extra, 0, def.unlock.extra.count) : 0;
    for (const slot of r.slots) {
      if (slot.machine !== '' && (!(slot.machine in MACHINES) || MACHINES[slot.machine as MachineId].era !== n)) slot.machine = '';
      if (!r.unlocked) slot.machine = '';
      paidSite(slot, slot.machine === '' ? undefined : MACHINES[slot.machine as MachineId]);
    }
  }
  for (let n = 0; n < state.city.districts.length; n++) {
    for (const lot of state.city.districts[n]!.lots) {
      if (lot.building !== '' && (!(lot.building in CITY_BUILDINGS) || CITY_BUILDINGS[lot.building as CityBuildingId].era !== n || n > e.age)) lot.building = '';
      paidSite(lot, lot.building === '' ? undefined : CITY_BUILDINGS[lot.building as CityBuildingId]);
    }
  }
  {
    const m = state.market;
    for (const k of Object.keys(m.index) as (keyof typeof m.index)[]) {
      if (!(MATERIAL_KINDS as readonly string[]).includes(k)) delete m.index[k];
      else m.index[k] = Math.max(MARKET.min, Math.min(MARKET.max, isNum(m.index[k]) ? m.index[k]! : 1));
    }
    for (const k of Object.keys(m.pressure) as (keyof typeof m.pressure)[]) {
      if (!(MATERIAL_KINDS as readonly string[]).includes(k)) delete m.pressure[k];
      else m.pressure[k] = Math.max(0, Math.min(MARKET.pressureMax, isNum(m.pressure[k]) ? m.pressure[k]! : 0));
    }
    for (const k of Object.keys(m.holdings) as (keyof typeof m.holdings)[]) {
      if (!(MATERIAL_KINDS as readonly string[]).includes(k)) delete m.holdings[k];
      else m.holdings[k] = int(m.holdings[k], 0, 1_000_000_000);
    }
    for (const k of Object.keys(m.basis) as (keyof typeof m.basis)[]) {
      if (!(MATERIAL_KINDS as readonly string[]).includes(k)) delete m.basis[k];
      else m.basis[k] = nonNeg(m.basis[k]);
    }
    m.investments = m.investments.filter((p) => (INVEST_IDS as readonly string[]).includes(p.product) && INVEST[p.product].era <= e.age && p.principal > 0);
    for (const p of m.investments) {
      p.id = int(p.id, 0, Number.MAX_SAFE_INTEGER);
      p.era = p.product === 'venture' ? int(p.era, 2, e.age) : 0;
      p.principal = nonNeg(p.principal);
      p.value = nonNeg(p.value);
      p.age = nonNeg(p.age);
    }
    m.fund = isNum(m.fund) && m.fund > 0 ? m.fund : 1;
    m.nextId = int(m.nextId, 1, Number.MAX_SAFE_INTEGER);
    for (const p of m.investments) if (p.id >= m.nextId) m.nextId = p.id + 1;
  }

  state.prestige.season = int(state.prestige.season, 0, 1_000_000);
  const C = DAYNIGHT.cycleSeconds;
  if (!isNum(state.clock)) state.clock = 0;
  else if (state.clock < 0 || state.clock >= C) state.clock = ((state.clock % C) + C) % C; // in range: untouched (no float drift)
  state.playTime = nonNeg(state.playTime);
  for (const k of Object.keys(state.stats) as (keyof typeof state.stats)[]) state.stats[k] = nonNeg(state.stats[k]);
  for (const k of Object.keys(state.padPaid)) state.padPaid[k] = nonNeg(state.padPaid[k]);
}

/** Dollars earned while away, or 0 when the absence is too short / the amount too small. */
export function offlineEarnings(save: SaveData, now: number): { amount: number; seconds: number } {
  const away = (now - save.savedAt) / 1000;
  if (!(away >= OFFLINE.minSeconds)) return { amount: 0, seconds: 0 };
  const seconds = Math.min(away, OFFLINE.maxSeconds);
  const b = ECONOMY.cashBundleValue;
  const cap = (save.state.stats?.moneyEarned ?? 0) * OFFLINE.maxShareOfEarned;
  const amount = Math.floor(Math.min(save.salesRate * seconds * OFFLINE.efficiency, cap) / b) * b;
  return amount >= OFFLINE.minAmount ? { amount, seconds } : { amount: 0, seconds: 0 };
}

/**
 * Rolling sales rate ($ per simulated second) over the last OFFLINE.window seconds of play. Until a full window
 * has been played this session, the rate carried over from the save fills the rest of the window.
 */
export class SalesMeter {
  private readonly times: number[] = [];
  private readonly amounts: number[] = [];
  private sum = 0;
  private readonly start: number;

  constructor(
    private readonly ctx: GameContext,
    private readonly carried: number,
  ) {
    this.start = ctx.time.elapsed;
    ctx.events.on('sale', ({ buyer, amount: sale, tip }) => {
      if (buyer === 'jack') return; // a discard at Jack's cart is not a steady income
      const amount = sale + (tip ?? 0); // VIP tips are income too
      this.times.push(ctx.time.elapsed);
      this.amounts.push(amount);
      this.sum += amount;
    });
  }

  get rate(): number {
    const now = this.ctx.time.elapsed;
    const cutoff = now - OFFLINE.window;
    while (this.times.length > 0 && this.times[0]! < cutoff) {
      this.times.shift();
      this.sum -= this.amounts.shift()!;
    }
    const observed = Math.min(OFFLINE.window, now - this.start);
    const rest = OFFLINE.window - observed;
    return Math.max(0, (this.sum + this.carried * rest) / OFFLINE.window);
  }
}

const EMPTY_WORLD: WorldSnapshot = {
  piles: { dropZone: 0, walkIn: 0, hopper: 0, bench: 0, se: 0, truck: 0, deck: 0, platform: 0, workshopIn: 0, workshopOut: 0, sled: 0 },
  cash: { walkIn: 0, se: 0, truck: 0, platform: 0, sled: 0 },
  arms: Object.fromEntries(CARRY_KINDS.map((k) => [k, 0])) as Record<CarryKind, number>,
  town: Array.from({ length: LOT_COUNT }, () => ({ in: {}, out: 0, cash: 0 })),
  eras: REGION_SLOTS.map((n) => ({ slots: Array.from({ length: n }, () => ({ in: {}, out: 0 })), dock: {} })),
};

/**
 * Prestige: the save that starts the next season after the finale. Everything resets except the season count
 * (+1, a permanent price bonus, PRESTIGE.bonusPerSeason) and the one-shot UI hints (`seen:*`, introDone: no intro
 * replay). Stats and play time start over too: reveal rules read them, and the finale card shows that season's run. Starting money PRESTIGE.startMoneyPerSeason × season.
 */
export function newSeasonSave(prev: GameState, now: number): SaveData {
  const state = createGameState();
  state.prestige.season = prev.prestige.season + 1;
  for (const [flag, on] of Object.entries(prev.flags)) {
    if (on && (flag === 'introDone' || flag.startsWith('seen:'))) state.flags[flag as FlagId] = true;
  }
  return {
    v: SAVE.version,
    savedAt: now,
    money: PRESTIGE.startMoneyPerSeason * state.prestige.season,
    state,
    world: structuredClone(EMPTY_WORLD),
    salesRate: 0,
  };
}

export function sanitizeWorld(w: unknown): WorldSnapshot {
  const o = isObj(w) ? w : {};
  const piles = isObj(o.piles) ? o.piles : {};
  const cash = isObj(o.cash) ? o.cash : {};
  const arms = isObj(o.arms) ? o.arms : {};
  const n = (v: unknown) => (isNum(v) ? Math.max(0, Math.floor(v)) : 0);
  return {
    piles: {
      dropZone: n(piles.dropZone),
      walkIn: n(piles.walkIn),
      hopper: n(piles.hopper),
      bench: n(piles.bench),
      se: n(piles.se),
      truck: n(piles.truck),
      deck: n(piles.deck),
      platform: n(piles.platform),
      workshopIn: n(piles.workshopIn),
      workshopOut: n(piles.workshopOut),
      sled: n(piles.sled),
    },
    cash: { walkIn: n(cash.walkIn), se: n(cash.se), truck: n(cash.truck), platform: n(cash.platform), sled: n(cash.sled) },
    arms: Object.fromEntries(CARRY_KINDS.map((k) => [k, n(arms[k])])) as Record<CarryKind, number>,
    town: Array.from({ length: LOT_COUNT }, (_, i) => {
      const lot = Array.isArray(o.town) && isObj(o.town[i]) ? (o.town[i] as Record<string, unknown>) : {};
      const inp = isObj(lot.in) ? lot.in : {};
      const ins: Partial<Record<ItemKind, number>> = {};
      for (const k of Object.keys(inp)) if (n(inp[k]) > 0) ins[k as ItemKind] = n(inp[k]);
      return { in: ins, out: n(lot.out), cash: n(lot.cash) };
    }),
    eras: REGION_SLOTS.map((count, era) => {
      const r = Array.isArray(o.eras) && isObj(o.eras[era]) ? (o.eras[era] as Record<string, unknown>) : {};
      const kinds = (rec: unknown): Partial<Record<ItemKind, number>> => {
        const out: Partial<Record<ItemKind, number>> = {};
        if (isObj(rec)) for (const k of Object.keys(rec)) if (n(rec[k]) > 0) out[k as ItemKind] = n(rec[k]);
        return out;
      };
      return {
        slots: Array.from({ length: count }, (_, i) => {
          const sl = Array.isArray(r.slots) && isObj(r.slots[i]) ? (r.slots[i] as Record<string, unknown>) : {};
          return { in: kinds(sl.in), out: n(sl.out) };
        }),
        dock: kinds(r.dock),
      };
    }),
  };
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
