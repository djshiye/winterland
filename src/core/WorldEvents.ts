/**
 * [Wave 13] World events, one at a time (EVENTS in config): a snowstorm (slower walking, shops burn firewood faster,
 * heavy snowfall), a festival day (townsfolk buy twice as often) and a strong aurora (better prices, only at night).
 * Transient like rush hours: a reload starts between events. Emits 'event:start' / 'event:end'.
 *
 * Readers: Player.maxSpeed × walkSpeedMult; Townsfolk buyer gap ÷ townBuyMult; townJobs firewood threshold ×
 * firewoodMult; demand.setTransientPriceMult(priceMult) is written by update(); world/env snowfall + aurora read
 * `snowfall` / `active === 'aurora'` through Environment.
 * TODO(events builder): implement update() scheduling, the aurora's night requirement, start() / end().
 */
import { EVENTS, type EventKind } from '../config';
import type { EventBus } from './EventBus';
import type { GameEvents, GameState } from './types';

export class WorldEvents {
  private left = 0;
  private current: EventKind | null = null;

  constructor(
    private readonly state: GameState,
    private readonly events: EventBus<GameEvents>,
    /** 0..1 darkness (the aurora only starts at night). */
    private readonly darkness: () => number,
  ) {}

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

  /** Start an event now (debug / tests). */
  start(kind: EventKind, seconds: number = EVENTS.kinds[kind].seconds): void {
    if (!(seconds > 0)) return;
    this.current = kind;
    this.left = seconds;
    this.events.emit('event:start', { kind, seconds });
  }

  update(_dt: number): void {
    void this.state;
    void this.darkness;
    // TODO(events builder)
  }
}
