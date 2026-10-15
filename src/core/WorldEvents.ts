/**
 * [Wave 13] World events, one at a time (EVENTS in config): a snowstorm (slower walking, porters keep shop hoppers
 * fuller of firewood, heavy snowfall), a festival day (townsfolk buy twice as often) and a strong aurora (better
 * prices, only at night). Transient like rush hours: a reload starts between events. Emits 'event:start' /
 * 'event:end' (never two starts in a row: starting over a running event ends it first).
 *
 * Scheduling: once the village is at EVENTS.minVillageLevel a gap timer (EVENTS.every) runs while no event is active;
 * when it fires, pickNextEvent() picks a random kind other than the last one, and never the aurora by day (the aurora
 * is simply not in the pool until it is dark, so it comes round again on a later night gap). Each event restarts the
 * gap when it ends.
 *
 * Readers: Player.maxSpeed × walkSpeedMult; Townsfolk buyer gap ÷ townBuyMult; the Porter's firewood thresholds
 * (townJobs.pickJob) × firewoodMult - NOTE the shops' own burn rate is unchanged, the porter just tops hoppers up
 * earlier; demand.setTransientPriceMult(priceMult) is written on every start / end; world/env snowfall + aurora read
 * `snowfall` / `active === 'aurora'` through Environment.
 */
import { EVENTS, type EventKind } from '../config';
import { setTransientPriceMult } from './demand';
import type { EventBus } from './EventBus';
import type { GameEvents, GameState } from './types';

export class WorldEvents {
  private left = 0;
  private current: EventKind | null = null;
  private last: EventKind | null = null;
  private timer: number;

  constructor(
    private readonly state: GameState,
    private readonly events: EventBus<GameEvents>,
    /** 0..1 darkness (the aurora only starts at night). */
    private readonly darkness: () => number,
  ) {
    this.timer = nextGap();
  }

  get active(): EventKind | null {
    return this.current;
  }

  get remaining(): number {
    return this.left;
  }

  get walkSpeedMult(): number {
    return this.current === 'snowstorm' ? EVENTS.kinds.snowstorm.walkSpeedMult : 1;
  }

  get firewoodMult(): number {
    return this.current === 'snowstorm' ? EVENTS.kinds.snowstorm.firewoodMult : 1;
  }

  get townBuyMult(): number {
    return this.current === 'festival' ? EVENTS.kinds.festival.townBuyMult : 1;
  }

  get priceMult(): number {
    return this.current === 'aurora' ? EVENTS.kinds.aurora.priceMult : 1;
  }

  /** Snowfall intensity multiplier (1 normal). */
  get snowfall(): number {
    return this.current === 'snowstorm' ? EVENTS.kinds.snowstorm.snowfall : 1;
  }

  /** Start an event now (debug / tests). Replaces a running event (ending it first). */
  start(kind: EventKind, seconds: number = EVENTS.kinds[kind].seconds): void {
    // A non-positive length would never count down and would re-fire 'event:start' every frame.
    if (!(seconds > 0)) return;
    if (this.current) this.end();
    this.current = kind;
    this.last = kind;
    this.left = seconds;
    setTransientPriceMult(this.priceMult);
    this.events.emit('event:start', { kind, seconds });
  }

  private end(): void {
    const kind = this.current;
    this.current = null;
    this.left = 0;
    this.timer = nextGap();
    setTransientPriceMult(1);
    if (kind) this.events.emit('event:end', { kind });
  }

  update(dt: number): void {
    if (this.current) {
      this.left -= dt;
      if (this.left <= 0) this.end();
      return;
    }
    if (this.state.village.level < EVENTS.minVillageLevel) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = nextGap(); // never re-enter while the start is refused
      this.start(pickNextEvent(this.last, this.darkness() > 0.5, Math.random));
    }
  }
}

function nextGap(): number {
  const [a, b] = EVENTS.every;
  return a + Math.random() * (b - a);
}

/**
 * The next event kind: random among the kinds other than `last` (no immediate repeat), and never the aurora by day.
 * `rng` returns [0, 1).
 */
export function pickNextEvent(last: EventKind | null, isNight: boolean, rng: () => number): EventKind {
  const pool = (Object.keys(EVENTS.kinds) as EventKind[]).filter(
    (k) => k !== last && (isNight || k !== 'aurora'),
  );
  // the pool is never empty (3 kinds, at most one is `last`, at most one needs night)
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
}
