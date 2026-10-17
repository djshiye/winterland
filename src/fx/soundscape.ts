/**
 * 0.9.8 [17] Where the player is, for the ears: picks the era theme (fx/Music.ts) and the ambient bed
 * (fx/Ambience.ts) from the player's position, a few times a second, and passes on the sky's darkness, the comfort
 * Effects setting and the ending's hush (core/quiet.ts).
 *
 * - placeAt (pure, tested): inside era n's plot -> era n's theme and bed; inside an open city district -> its era's
 *   theme and the city bed (the streets between districts keep it); north of the first era road -> era 1 (home);
 *   anywhere else (the roads between plots) -> the open-road bed, and the music stays on the last era's theme, so the
 *   walk from one plot to the next never dips back to era 1.
 * - A new place only counts after the player has been in it for SETTLE seconds, so walking along a border or cutting
 *   a corner never flips the music back and forth.
 */
import type { GameContext, Updatable } from '../core/types';
import { finaleQuiet } from '../core/quiet';
import { DISTRICTS } from '../eras/data';
import { regionAt } from '../eras/playerUpgrades';
import { eraBed, type BedId } from './ambience/beds';
import { comfort, type EffectsLevel } from './comfort';

export interface Place {
  bed: BedId;
  /** Era whose theme plays (1..10). */
  era: number;
}

export const HOME: Place = { bed: 'home', era: 1 };

/** Seconds a new place must hold before the sound follows. */
export const SETTLE = 1.2;
const POLL = 0.25;
/** North of the first era road (z 62..66) is era 1's land: the yard, the village and the Market Town. */
const HOME_MAX_Z = 62;
/** The city's streets: the box around every district (eras/data.ts DISTRICTS), with a little margin. */
const CITY_BOX = (() => {
  const rects = DISTRICTS.filter((d) => !!d).map((d) => d!.rect);
  return {
    minX: Math.min(...rects.map((r) => r.minX)) - 4,
    maxX: Math.max(...rects.map((r) => r.maxX)) + 4,
    minZ: Math.min(...rects.map((r) => r.minZ)) - 4,
    maxZ: Math.max(...rects.map((r) => r.maxZ)) + 4,
  };
})();

const inRect = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number): boolean =>
  x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/** The place at (x, z). `open(n)`: city district n is built (era n reached). `prev`: the place before. Pure. */
export function placeAt(x: number, z: number, open: (era: number) => boolean, prev: Place): Place {
  const r = regionAt(x, z);
  if (r) return { bed: eraBed(r), era: r };
  for (let n = 2; n < DISTRICTS.length; n++) {
    const d = DISTRICTS[n];
    if (d && open(n) && inRect(d.rect, x, z)) return { bed: 'city', era: n };
  }
  if (prev.bed === 'city' && inRect(CITY_BOX, x, z)) return prev;
  if (z < HOME_MAX_Z) return HOME;
  return { bed: 'road', era: prev.era };
}

/** Share of ambient events the comfort Effects setting lets through. */
export const EVENT_RATE: Record<EffectsLevel, number> = { full: 1, calm: 0.6, minimal: 0.35 };

export class Soundscape implements Updatable {
  private place: Place = HOME;
  private pending: Place = HOME;
  private pendingFor = 0;
  private clock = 0;
  private first = true;

  constructor(private readonly ctx: GameContext) {
    ctx.addUpdatable(this);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock < POLL) return;
    const step = this.clock;
    this.clock = 0;
    try {
      const ctx = this.ctx;
      const p = ctx.player?.object.position;
      const age = ctx.state.eras.age;
      if (p) {
        const here = placeAt(p.x, p.z, (n) => n <= age, this.place);
        if (here.bed === this.pending.bed && here.era === this.pending.era) this.pendingFor += step;
        else {
          this.pending = here;
          this.pendingFor = 0;
        }
        // the first reading (a loaded save standing in era 7) applies at once, before the sound even starts
        if (this.first || (this.pendingFor >= SETTLE && (here.bed !== this.place.bed || here.era !== this.place.era))) {
          this.first = false;
          this.place = here;
          ctx.audio.setPlace(here.bed, here.era);
        }
      }
      ctx.audio.setDarkness(ctx.dayNight ? ctx.dayNight.darkness : 0);
      ctx.audio.setAmbienceHush(finaleQuiet());
      ctx.audio.setAmbienceRate(EVENT_RATE[comfort().effects] ?? 1);
    } catch {
      /* sound must never break the game */
    }
  }
}
