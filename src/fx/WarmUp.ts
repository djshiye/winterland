/**
 * Warm-up spots, the feel (world/env/ground/warmSpots.ts draws them): stand still beside the little fire / stove /
 * heater of the era region you are in and, after a second, "warming" turns on: the music eases down a little, a soft puff
 * or ember rises now and then, your pal sits at once and a quiet chime rings once. Walk away (> 1.8 m) and it all ends.
 * Visual and mood only: no gameplay effect, no money, nothing saved. Reduced motion skips the rising puffs.
 */
import * as THREE from 'three';
import type { GameContext, Updatable } from '../core/types';
import { regionAt } from '../eras/playerUpgrades';
import { regionLayout } from '../eras/layout';
import { warmSpot } from '../world/env/ground/warmSpotsAt';
import type { WarmEra } from '../world/env/ground/warmSpots';
import { reducedMotion } from './comfort';

/** Stand still (below SPEED m/s) within ENTER metres for DWELL seconds to start; moving beyond LEAVE metres ends it. */
export const WARM = { enter: 1.4, leave: 1.8, dwell: 1, speed: 0.5, puffEvery: 2 } as const;

export interface WarmState {
  on: boolean;
  /** Seconds the player has stood still near the spot while not yet warming. */
  held: number;
}

/** One step of the on / off rule (hysteresis: 1.4 m to start, 1.8 m to end). Mutates and returns `s.on`. */
export function stepWarm(s: WarmState, dist: number, speed: number, dt: number): boolean {
  if (s.on) {
    if (dist > WARM.leave) {
      s.on = false;
      s.held = 0;
    }
  } else if (dist <= WARM.enter && speed < WARM.speed) {
    s.held += dt;
    if (s.held >= WARM.dwell) s.on = true;
  } else {
    s.held = 0;
  }
  return s.on;
}

const EMBER = 0xffb04a;
const SMOKE = 0xf3e6d2;

export class WarmUp implements Updatable {
  readonly state: WarmState = { on: false, held: 0 };
  private puffIn = 0;
  private readonly spots = new Map<number, { x: number; z: number } | null>();
  private readonly at = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    ctx.addUpdatable?.(this);
  }

  private spotOf(n: number): { x: number; z: number } | null {
    if (n < 2 || n > 10) return null;
    if (!this.spots.has(n)) this.spots.set(n, warmSpot(regionLayout(n), n as WarmEra));
    return this.spots.get(n) ?? null;
  }

  update(dt: number): void {
    try {
      this.step(dt);
    } catch {
      /* a mood effect must never break the game */
    }
  }

  private step(dt: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    const p = pl?.object?.position;
    if (!p) return;
    const spot = this.spotOf(regionAt(p.x, p.z));
    const dist = spot ? Math.hypot(p.x - spot.x, p.z - spot.z) : Infinity;
    const speed = pl.velocity ? Math.hypot(pl.velocity.x, pl.velocity.z) : 0;
    const was = this.state.on;
    const on = stepWarm(this.state, dist, speed, dt);
    if (on !== was) {
      ctx.audio?.soften?.(on);
      if (on) ctx.audio?.play?.('chime', { volume: 0.25 });
      this.puffIn = 0.6;
    }
    if (!on || !spot) return;
    if (speed < WARM.speed) pl.dog?.rest?.(spot);
    this.puffIn -= dt;
    if (this.puffIn > 0) return;
    this.puffIn = WARM.puffEvery;
    const parts = ctx.particles;
    this.at.set(spot.x, 0.8, spot.z);
    if (!reducedMotion()) parts?.puff?.(this.at, { color: SMOKE, count: 2, size: 0.28, life: 1.1 });
    parts?.sparkle?.(this.at.set(spot.x, 0.9, spot.z), EMBER);
  }
}
