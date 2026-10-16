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
import { AMENITIES, AMENITY_IDS, BUSINESSES, CLIMB, CONTRACTS, DAYNIGHT, ECONOMY, GATE, OFFLINE, PRESTIGE, PRIORITIES, QUARTERS, SAVE, SETTLEMENT, UPGRADES, VILLAGE, type BusinessId } from '../config';
import { CARRY_KINDS, createGameState, LOT_COUNT, MATERIAL_KINDS, REGION_SLOTS, type CarryKind, type FlagId, type GameContext, type GameState, type InvestmentState, type ItemKind } from './types';
import { maxStored } from './ladder';
import { MASTERY_KEEP, masteryPayout, refundPrice } from './refund';
import { INVEST_POSITIONS_CAP, masteryOf } from './demand';
import { CITY_BUILDINGS, ERAS, INVEST, INVEST_IDS, MACHINES, MARKET, MAX_ERA, type CityBuildingId, type MachineId } from '../eras/data';
import { GAME_VERSION, isNewerVersion, parseVersion } from './version';

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
    /** 0.9.0 the city's settlement gift pile (absent in older saves → 0). */
    gift: number;
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
   * (its output kind), and the region import dock's contents by kind. Absent in older saves (→ empty). 0.9.5 `market`: the
   * loading dock and market stall goods (+ goods held by unpaid buyers) by kind and the market cash pile's dollars
   * (absent before 0.9.5 → empty).
   */
  eras: { slots: { in: Partial<Record<ItemKind, number>>; out: number }[]; dock: Partial<Record<ItemKind, number>>; market?: { dock: Partial<Record<ItemKind, number>>; stall: Partial<Record<ItemKind, number>>; cash: number } }[];
}

export interface SaveData {
  v: number;
  /** 0.9.6: the game version that wrote it (absent in older saves). */
  game?: string;
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

/**
 * What is on disk: nothing, a save that opens (`newer`: the version of a newer build that wrote it, else null), or a
 * save that cannot be opened (`raw` is its exact text, which the caller must keep before anything else is written).
 */
export type SaveRead =
  | { kind: 'none' }
  | { kind: 'ok'; data: SaveData; raw: string; newer: string | null }
  | { kind: 'unreadable'; raw: string; reason: 'corrupt' | 'newer-format' };

/** Parse a save text (the gate every load and every restore goes through). */
export function parseSave(raw: string): SaveRead {
  try {
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (!isObj(data)) return { kind: 'unreadable', raw, reason: 'corrupt' };
    if (isNum(data.v) && data.v > SAVE.version) return { kind: 'unreadable', raw, reason: 'newer-format' };
    if (data.v !== SAVE.version || !isObj(data.state)) return { kind: 'unreadable', raw, reason: 'corrupt' };
    if (!isNum(data.money) || !isNum(data.savedAt)) return { kind: 'unreadable', raw, reason: 'corrupt' };
    const game = typeof data.game === 'string' && parseVersion(data.game) ? data.game : undefined;
    return {
      kind: 'ok',
      raw,
      newer: game && isNewerVersion(game, GAME_VERSION) ? game : null,
      data: {
        v: data.v,
        game,
        savedAt: data.savedAt,
        money: Math.max(0, Math.floor(data.money)),
        state: data.state as GameState,
        world: sanitizeWorld(data.world),
        salesRate: isNum(data.salesRate) ? Math.max(0, data.salesRate) : 0,
      },
    };
  } catch {
    return { kind: 'unreadable', raw, reason: 'corrupt' };
  }
}

/** Read the save on disk (see SaveRead). Missing or blocked storage reads as no save. */
export function readSave(): SaveRead {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(SAVE.key) ?? null;
  } catch {
    raw = null;
  }
  return raw ? parseSave(raw) : { kind: 'none' };
}

/** The save on disk when it opens, else null (tools and tests; the game itself uses readSave). */
export function loadSave(): SaveData | null {
  const r = readSave();
  return r.kind === 'ok' ? r.data : null;
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
    target.market.investments = inv.filter(isObj).slice(0, INVEST_POSITIONS_CAP).map((o) => ({
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

  // Clamp to shown level 100 whether or not the climb is open, so levels bought past the authored max are never lost.
  for (const def of Object.values(UPGRADES)) {
    state.upgrades[def.id] = int(state.upgrades[def.id], 0, maxStored(def, true));
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
    // 0.9.6 (Clarity pass): contracts may also ask for an era's materials, with bonuses that scale per era
    const known = CONTRACTS.offers.some((o) => o.kind === c.kind) || (MATERIAL_KINDS as readonly string[]).includes(c.kind);
    if (!known) {
      c.kind = '';
      c.target = c.progress = c.left = c.bonus = 0;
    } else {
      c.target = int(c.target, 1, 100000);
      c.progress = int(c.progress, 0, c.target);
      c.left = Math.max(0, Math.min(isNum(c.left) ? c.left : 0, CONTRACTS.seconds));
      c.bonus = int(c.bonus, 0, Number.MAX_SAFE_INTEGER);
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
  // settlement 6..50: a best-ever level. Era 1 stays within its band; from era 2 it rises freely to SETTLEMENT.max
  // (0.9.6, decision: settlement stays in the gate but is no longer capped per era).
  e.settlement = int(e.settlement, 0, e.age >= 2 ? SETTLEMENT.max : Math.min(SETTLEMENT.max, SETTLEMENT.band * e.age));
  // 0.9.0 dev saves may still carry eras.steward (the auto-buyer, removed: upgrades are hands-on); mergeState copies
  // only the fields a fresh state has, so it is dropped on load and never written again.
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
    const seen = new Set<number>(); // repeated ids (tampered / id-less saves): withdraw would close the wrong one
    for (const p of m.investments) {
      if (seen.has(p.id)) p.id = m.nextId++;
      seen.add(p.id);
    }
  }

  state.prestige.season = int(state.prestige.season, 0, 1_000_000);
  // 0.9.6: a frozen Mastery bonus is a price multiplier (core/ladder.ts masteryMult is bounded far below 10)
  state.legacy.masteryMult = isNum(state.legacy.masteryMult) ? Math.max(1, Math.min(10, state.legacy.masteryMult)) : 1;
  for (const k of Object.keys(state.migrations)) if (state.migrations[k] !== true) delete state.migrations[k];
  const C = DAYNIGHT.cycleSeconds;
  if (!isNum(state.clock)) state.clock = 0;
  else if (state.clock < 0 || state.clock >= C) state.clock = ((state.clock % C) + C) % C; // in range: untouched (no float drift)
  state.playTime = nonNeg(state.playTime);
  for (const k of Object.keys(state.stats) as (keyof typeof state.stats)[]) state.stats[k] = nonNeg(state.stats[k]);
  for (const k of Object.keys(state.padPaid)) state.padPaid[k] = nonNeg(state.padPaid[k]);
}

/**
 * What the migrations did to a loaded save, for the "welcome to the new rule" card (Game shows it when anything
 * changed; the refund is already in `money`).
 */
export interface MigrationReport {
  /** Ids applied in this load (empty for a save that was already up to date, and for a fresh game). */
  applied: string[];
  /** Dollars refunded for levels bought past Lv 10 (0.9.0-0.9.4 climb). */
  refund: number;
  /** How many levels past Lv 10 were refunded. */
  refundedLevels: number;
  /** The Mastery bonus the save keeps for good (1 = none; core/refund.ts MASTERY_KEEP 'multiplier'). */
  masteryMult: number;
  /** The Mastery bonus the save had (1 = none), whatever form it is kept in. */
  masteryHad: number;
  /** Dollars paid once for that bonus (MASTERY_KEEP 'cash'), on top of the refund. */
  masteryPayout: number;
}

/** What a migration may know besides the state: the save's recent sales rate ($/s). */
export interface MigrationContext {
  salesRate: number;
}

export interface Migration {
  /** Stable id, stored in state.migrations once applied (never rename one that shipped). */
  id: string;
  /** Change the merged, sanitized state in place; add any refund to report.refund. */
  run(state: GameState, report: MigrationReport, ctx: MigrationContext): void;
}

/**
 * Save migrations, in order. Each runs once per save: on the first load by a build that has it, after mergeState and
 * sanitizeState and before any system is built. A fresh game marks them all applied without running them. Later
 * 0.9.6+ changes that move saved data (merged upgrades, new materials) add an entry here.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    // Decisions 2 and 6 (Dino, 2026-10-16): under the 0.9.5 rule every upgrade tops out at Lv 10, so levels an older
    // save bought past it (the 0.9.0-0.9.4 climb, read as 10 since 0.9.5) are refunded at what they cost back then
    // (core/refund.ts). Mastery is gone too: the bonus those levels earned is kept as a one-off (core/refund.ts
    // MASTERY_KEEP): paid once as cash (default), or frozen as the save's own multiplier.
    id: '0.9.6-lv10-refund',
    run(state, report, ctx) {
      if (GATE.mode !== 'literal') return;
      const mastery = masteryOf(state);
      report.masteryHad = Math.max(report.masteryHad, mastery);
      if (MASTERY_KEEP === 'multiplier') {
        if (mastery > state.legacy.masteryMult) state.legacy.masteryMult = mastery;
      } else if (mastery > 1) {
        // the save's recent sales rate; a save with none recorded falls back to its lifetime average
        const rate = ctx.salesRate > 0 ? ctx.salesRate : state.playTime > 0 ? state.stats.moneyEarned / state.playTime : 0;
        report.masteryPayout += masteryPayout(mastery, rate);
      }
      const top = CLIMB.bandSize;
      for (const def of Object.values(UPGRADES)) {
        const s = state.upgrades[def.id];
        if (!(s > top)) continue;
        for (let k = top; k < s; k++) report.refund += refundPrice(def, k);
        report.refundedLevels += s - top;
        state.upgrades[def.id] = top;
      }
      report.refund = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(report.refund));
    },
  },
];

/** Apply every migration this save has not had yet (see MIGRATIONS). `fresh`: a new game, nothing to migrate. */
export function migrateState(state: GameState, fresh: boolean, ctx: MigrationContext = { salesRate: 0 }, list: readonly Migration[] = MIGRATIONS): MigrationReport {
  const report: MigrationReport = { applied: [], refund: 0, refundedLevels: 0, masteryMult: 1, masteryHad: 1, masteryPayout: 0 };
  for (const m of list) {
    if (state.migrations[m.id]) continue;
    if (!fresh) {
      m.run(state, report, ctx);
      report.applied.push(m.id);
    }
    state.migrations[m.id] = true;
  }
  report.masteryMult = state.legacy.masteryMult;
  return report;
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
 * Rolling sales rate ($ per simulated second, net of market orders) over the last OFFLINE.window seconds of play.
 * Until a full window has been played this session, the rate carried over from the save fills the rest of the window.
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
    // market orders count against the rate, so buying goods just to export them adds nothing
    ctx.events.on('market:order', ({ amount }) => {
      this.times.push(ctx.time.elapsed);
      this.amounts.push(-amount);
      this.sum -= amount;
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
  cash: { walkIn: 0, se: 0, truck: 0, platform: 0, sled: 0, gift: 0 },
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
  // 0.9.6: migrations stay applied and a frozen Mastery bonus is kept for good (it belongs to the player, not the run)
  state.migrations = { ...prev.migrations };
  state.legacy = { ...prev.legacy };
  for (const [flag, on] of Object.entries(prev.flags)) {
    if (on && (flag === 'introDone' || flag.startsWith('seen:'))) state.flags[flag as FlagId] = true;
  }
  return {
    v: SAVE.version,
    game: GAME_VERSION,
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
    cash: { walkIn: n(cash.walkIn), se: n(cash.se), truck: n(cash.truck), platform: n(cash.platform), sled: n(cash.sled), gift: n(cash.gift) },
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
        market: isObj(r.market)
          ? { dock: kinds((r.market as Record<string, unknown>).dock), stall: kinds((r.market as Record<string, unknown>).stall), cash: n((r.market as Record<string, unknown>).cash) }
          : undefined,
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
