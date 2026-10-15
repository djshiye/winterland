/**
 * [MAIN] Rush hours (wave 8): once the village reaches RUSH.minVillageLevel, a rush of RUSH.seconds starts every
 * RUSH.every seconds. While `active`, walk-in customers and tricycles spawn `spawnMult`× as often (their queues
 * divide their spawn gaps by it). Transient: a reload starts between rushes.
 */
import { RUSH } from '../config';
import type { EventBus } from './EventBus';
import type { GameEvents, GameState } from './types';

export class RushHours {
  private timer: number;
  private left = 0;

  constructor(
    private readonly state: GameState,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.timer = this.nextGap();
  }

  get active(): boolean {
    return this.left > 0;
  }

  /** Seconds left in the current rush (0 when none). */
  get remaining(): number {
    return this.left;
  }

  /** Divide spawn gaps by this (1 outside a rush). */
  get spawnMult(): number {
    return this.left > 0 ? RUSH.spawnMult : 1;
  }

  /** Start a rush now (debug / tests). */
  start(seconds: number = RUSH.seconds): void {
    this.left = seconds;
    this.events.emit('rush:start', { seconds });
  }

  update(dt: number): void {
    if (this.left > 0) {
      this.left -= dt;
      if (this.left <= 0) {
        this.left = 0;
        this.timer = this.nextGap();
        this.events.emit('rush:end', {});
      }
      return;
    }
    if (this.state.village.level < RUSH.minVillageLevel) return;
    this.timer -= dt;
    if (this.timer <= 0) this.start();
  }

  private nextGap(): number {
    const [a, b] = RUSH.every;
    return a + Math.random() * (b - a);
  }
}
