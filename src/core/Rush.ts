/**
 * [MAIN] Rush hours (wave 8): once the village reaches RUSH.minVillageLevel, a rush of RUSH.seconds starts every
 * RUSH.every seconds. While `active`, walk-in customers and tricycles spawn `spawnMult`× as often (their queues
 * divide their spawn gaps by it). Transient: a reload starts between rushes.
 */
import { RUSH } from '../config';
import { finaleQuiet } from './quiet';
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
    // A non-positive length would never count down (update() only ends a rush that has `left > 0`) and would
    // re-fire 'rush:start' every frame.
    if (!(seconds > 0)) return;
    this.left = seconds;
    this.events.emit('rush:start', { seconds });
  }

  update(dt: number): void {
    // 0.9.7: no rush during the ending (core/quiet.ts); one running ends now
    if (finaleQuiet()) {
      if (this.left > 0) this.left = dt;
      else return;
    }
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
    if (this.timer <= 0) {
      this.timer = this.nextGap(); // never re-enter while the start is refused
      this.start();
    }
  }

  private nextGap(): number {
    const [a, b] = RUSH.every;
    return a + Math.random() * (b - a);
  }
}
