/**
 * [T4 — wave 9] Era fireworks: a cheap, pooled rocket show over the market square / village when the village
 * reaches a new era (level >= 3), more of them at night. Built on Particles.rocket()/firework() (already pooled
 * InstancedMeshes), so it adds ZERO draw calls and no per-launch allocations: launches wait in a fixed pool of
 * slots, timed on simulation dt (never setTimeout), and fire one by one so the star pool is never overrun.
 *
 * Wiring (MAIN, game/Game.ts, after `ctx.particles` / `ctx.audio` exist, e.g. next to `new JuiceDirector(ctx)`):
 *   ctx.fireworks = new Fireworks(ctx);   // or just `new Fireworks(ctx)`: it registers itself with ctx.addUpdatable
 * Anyone can then `fireworks.launch(position, count)`.
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import type { GameContext, Updatable } from '../core/types';

/** Cosy shell colour pairs (outer, inner). */
const SHELLS: ReadonlyArray<readonly [number, number]> = [
  [0xffd84a, 0xffffff],
  [0xff6b6b, 0xffd84a],
  [0x7ad7ff, 0xffffff],
  [0xff8fb3, 0xffffff],
  [0x8dff9a, 0xffd84a],
  [0xffb347, 0xfff0c2],
];

export interface LaunchOptions {
  /** Radius around the position the rockets start in (default 5 m). */
  spread?: number;
  /** Seconds between rockets (default 0.45; jittered). */
  interval?: number;
  /** Seconds before the first rocket (default 0). */
  delay?: number;
  /** Burst height range above the launch point (default 7..11 m). */
  height?: readonly [number, number];
}

interface Slot {
  active: boolean;
  t: number;
  x: number;
  y: number;
  z: number;
  h: number;
  shell: number;
}

const MAX_QUEUED = 40;

export class Fireworks implements Updatable {
  private readonly slots: Slot[] = [];
  private readonly from = new THREE.Vector3();
  private readonly drift = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    for (let i = 0; i < MAX_QUEUED; i++) this.slots.push({ active: false, t: 0, x: 0, y: 0, z: 0, h: 8, shell: 0 });
    ctx.addUpdatable(this);
    ctx.events.on('village:levelUp', (e) => {
      if (e.level >= 3) this.celebrate(e.level, e.position);
    });
  }

  /** The era show: `4 + level` rockets by day, up to 80 % more when it is dark, over the square (or the village). */
  celebrate(level: number, villagePosition?: THREE.Vector3): void {
    const night = this.ctx.dayNight.darkness;
    const count = Math.round((3 + level) * (1 + 0.8 * night));
    const t = LAYOUT.town.tree;
    const over = this.ctx.state.town.revealed
      ? this.from.set(t.x, 0, t.z)
      : villagePosition
        ? this.from.copy(villagePosition)
        : this.from.set((LAYOUT.village.street.minX + LAYOUT.village.street.maxX) / 2, 0, 20);
    this.launch(over, count, { spread: this.ctx.state.town.revealed ? 7 : 4.5, delay: 0.5 });
  }

  /**
   * Queue `count` rockets that start around `position` (y is the ground level to launch from) and burst 7..11 m
   * above it. Extra rockets beyond the pool (40 queued) are dropped.
   */
  launch(position: THREE.Vector3, count: number, opts: LaunchOptions = {}): void {
    const spread = opts.spread ?? 5;
    const interval = opts.interval ?? 0.45;
    const [h0, h1] = opts.height ?? [7, 11];
    let at = opts.delay ?? 0;
    let made = 0;
    const px = position.x;
    const py = position.y;
    const pz = position.z;
    for (const s of this.slots) {
      if (made >= count) break;
      if (s.active) continue;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      s.active = true;
      s.t = at;
      s.x = px + Math.cos(a) * r;
      s.y = py;
      s.z = pz + Math.sin(a) * r;
      s.h = h0 + Math.random() * (h1 - h0);
      s.shell = (Math.random() * SHELLS.length) | 0;
      at += interval * (0.6 + Math.random() * 0.8);
      made++;
    }
  }

  /** Rockets still waiting to fire. */
  get pending(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t -= dt;
      if (s.t > 0) continue;
      s.active = false;
      const audio = this.ctx.audio;
      const [c1, c2] = SHELLS[s.shell]!;
      this.from.set(s.x, s.y, s.z);
      this.drift.set((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3);
      audio.play('whoosh', { volume: 0.3, pitch: 1.3 });
      this.ctx.particles.rocket(this.from, {
        height: s.h,
        color: c1,
        color2: c2,
        drift: this.drift,
        onBurst: () => audio.play('firework', { pitch: 0.85 + Math.random() * 0.4 }),
      });
    }
  }
}
