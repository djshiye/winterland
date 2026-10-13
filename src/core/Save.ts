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
import { ECONOMY, OFFLINE, SAVE } from '../config';
import type { GameContext, GameState } from './types';

/** Items lying in the world, by station (counts include items still flying toward it). */
export interface WorldSnapshot {
  piles: {
    dropZone: number;
    walkIn: number;
    hopper: number;
    bench: number;
    se: number;
    truck: number;
  };
  /** Dollars in each cash pile. */
  cash: {
    walkIn: number;
    se: number;
    truck: number;
  };
  arms: { log: number; crate: number };
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

/** Dollars earned while away, or 0 when the absence is too short / the amount too small. */
export function offlineEarnings(save: SaveData, now: number): { amount: number; seconds: number } {
  const away = (now - save.savedAt) / 1000;
  if (!(away >= OFFLINE.minSeconds)) return { amount: 0, seconds: 0 };
  const seconds = Math.min(away, OFFLINE.maxSeconds);
  const b = ECONOMY.cashBundleValue;
  const amount = Math.floor((save.salesRate * seconds * OFFLINE.efficiency) / b) * b;
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
    ctx.events.on('sale', ({ amount }) => {
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

function sanitizeWorld(w: unknown): WorldSnapshot {
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
    },
    cash: { walkIn: n(cash.walkIn), se: n(cash.se), truck: n(cash.truck) },
    arms: { log: n(arms.log), crate: n(arms.crate) },
  };
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
