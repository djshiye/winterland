/**
 * [MAIN] Day / night clock (wave 8). Advances state.clock (saved) and derives how dark it is; the visuals (sky,
 * sun / ambient colour, aurora, glowing windows and lamps) read `darkness` every frame (world/render, B3).
 * Purely cosmetic: nothing in the economy depends on it. Settings can turn it off (localStorage
 * `winterland:daynight`, default on); off = always full day.
 */
import { DAYNIGHT } from '../config';
import type { EventBus } from './EventBus';
import type { GameEvents, GameState } from './types';

const KEY = 'winterland:daynight';

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Darkness (0 day … 1 night) at cycle share `p` (0..1). */
export function darknessAt(p: number): number {
  const d = DAYNIGHT;
  if (p < d.duskStart) return 0;
  if (p < d.nightFull) return smooth(d.duskStart, d.nightFull, p);
  if (p < d.dawnStart) return 1;
  if (p < d.dayFull) return 1 - smooth(d.dawnStart, d.dayFull, p);
  return 0;
}

export class DayNight {
  private on = readEnabled();
  private night = false;

  constructor(
    private readonly state: GameState,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.night = this.darkness >= 0.5;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    try {
      window.localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // not persisted
    }
  }

  /** 0..1 share of the current day (0 = early morning). */
  get phase(): number {
    const c = DAYNIGHT.cycleSeconds;
    return (((this.state.clock % c) + c) % c) / c;
  }

  /** 0 full day … 1 full night (0 while day/night is off). */
  get darkness(): number {
    return this.on ? darknessAt(this.phase) : 0;
  }

  update(dt: number): void {
    this.state.clock = (this.state.clock + dt) % DAYNIGHT.cycleSeconds;
    const night = this.darkness >= 0.5;
    if (night !== this.night) {
      this.night = night;
      this.events.emit(night ? 'night:start' : 'day:start', {});
    }
  }
}
