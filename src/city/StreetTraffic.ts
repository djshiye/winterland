/**
 * 0.9.13 (review idea 4): the city's own street traffic. Each district with a built lot sends its era vehicle (the
 * same model the era buyers drive, assets/eraVehicles.ts) round its block's loop (city/streetLoops.ts), in the lane on
 * the block side, on the right-hand side of the street.
 *
 * The vehicle rules are the era buyers' (npc/EraBuyers.ts): they cruise at CRUISE, speed up and brake smoothly, keep
 * FOLLOW_STOP behind the next vehicle on the loop (easing off from FOLLOW_SLOW), and stop short of anyone on the road
 * ahead (CROSSERS: the era foremen crossing; the player). They never appear or vanish in view: a vehicle is made only at
 * a loop spot off screen and clear of the others (tried again a second later when every spot is on screen), and once alive
 * it stays, unless its district loses every building or its loop closes, and then it goes only while off screen. The
 * district list is checked about once a second, not every frame. Each is tracked (npc/vehicleView.ts) as `street:${n}`
 * and yields at kerbs like a buyer, so walkers wait only when one is too close to stop.
 */
import * as THREE from 'three';
import { approach, dampAngle } from '../core/math';
import type { GameContext } from '../core/types';
import { createEraVehicleWithDriver, type EraVehicleModel } from '../assets/eraVehicles';
import type { CharacterRig } from '../render/characters';
import { era } from '../eras/data';
import { inView, trackVehicle, untrackVehicle } from '../npc/vehicleView';
import { CROSSERS } from './roadRoute';
import { lotBuilt } from './rules';
import { loopHeading, loopPoint, streetLoops, type StreetLoop } from './streetLoops';

/** Cruise speed (m/s) and the rates it changes at. */
const CRUISE = 3.2;
const ACCEL = 2.4;
const DECEL = 5;
/** Behind the next vehicle: stop at FOLLOW_STOP (m, centre to centre), ease off from FOLLOW_SLOW. */
const FOLLOW_STOP = 6;
const FOLLOW_SLOW = 12;
/** Anyone on the road ahead within WALK_AHEAD (m) and WALK_SIDE sideways: stop WALK_STOP short of them. */
const WALK_AHEAD = 9;
const WALK_SIDE = 1.2; // half a vehicle and a person: one on the kerb beside the lane is not in the way
const WALK_STOP = 3;
/** Size of a vehicle for the view test (length, shadow, camera moving this frame). */
const VIEW_R = 6;
/** A new vehicle is at least this far (m) from every other on its loop. */
const SPAWN_GAP = 12;
const SPAWN_TRIES = 16;
/** Seconds between looks at which districts have a vehicle. */
const CHECK = 1;

class Car {
  s = 0;
  speed = 0;
  /** Model yaw, eased round the loop's corners (its segments turn in 15° steps). */
  yaw = NaN;
  /** The district lost its buildings / the loop closed: goes once off screen. */
  retire = false;
  constructor(
    readonly n: number,
    readonly loop: StreetLoop,
    readonly model: EraVehicleModel,
    readonly rig: CharacterRig,
  ) {}
}

const tmp: { x: number; z: number } = { x: 0, z: 0 };
const tmpH: { x: number; z: number } = { x: 0, z: 0 };
const tmpP: { x: number; z: number } = { x: 0, z: 0 };

export class StreetTraffic {
  readonly group = new THREE.Group();
  private readonly cars: Car[] = [];
  private timer = 0;

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'street-traffic';
  }

  /** Vehicles on the streets now (tests / debug). */
  get count(): number {
    return this.cars.length;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = CHECK;
      this.check();
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]!;
      this.drive(c, dt);
      if (c.retire && !this.seen(c.loop, c.s)) this.remove(i);
    }
  }

  private seen(loop: StreetLoop, s: number): boolean {
    const p = loopPoint(loop, s, tmp);
    return inView(this.ctx, p.x, p.z, VIEW_R);
  }

  /** Does district n have at least one built lot? */
  private built(n: number): boolean {
    const lots = this.ctx.state.city.districts[n]?.lots;
    if (!lots) return false;
    for (const l of lots) if (lotBuilt(l)) return true;
    return false;
  }

  /** Once a second: make the vehicles that are due (off screen), mark the ones whose district or loop is gone. */
  private check(): void {
    const loops = streetLoops(this.ctx.state.eras.age);
    for (const c of this.cars) c.retire = !loops.includes(c.loop) || !this.built(c.n);
    for (const loop of loops) {
      for (const n of loop.districts) {
        if (!this.built(n) || this.cars.some((c) => c.n === n)) continue;
        const s = this.spawnS(loop, n);
        if (s !== null) this.spawn(loop, n, s);
      }
    }
  }

  /** An off-screen loop spot at least SPAWN_GAP from the loop's other vehicles (null: none right now). */
  private spawnS(loop: StreetLoop, n: number): number | null {
    for (let k = 0; k < SPAWN_TRIES; k++) {
      const s = ((k + (n % 5) * 0.31) / SPAWN_TRIES) * loop.length;
      if (this.seen(loop, s)) continue;
      let clear = true;
      for (const o of this.cars) {
        if (o.loop !== loop) continue;
        const d = Math.abs(o.s - s) % loop.length;
        if (Math.min(d, loop.length - d) < SPAWN_GAP) {
          clear = false;
          break;
        }
      }
      if (clear) return s;
    }
    return null;
  }

  private spawn(loop: StreetLoop, n: number, s: number): void {
    const { model, rig } = createEraVehicleWithDriver(n, era(n).colors.accent, 0);
    const c = new Car(n, loop, model, rig);
    c.s = s;
    c.speed = CRUISE * 0.6;
    this.pose(c);
    this.group.add(model.root);
    this.cars.push(c);
    trackVehicle({ id: `street:${n}`, kind: `street:${n}`, root: model.root, facing: (out) => this.facing(c, out) });
  }

  private remove(i: number): void {
    const c = this.cars[i]!;
    this.cars.splice(i, 1);
    untrackVehicle(`street:${c.n}`);
    c.model.root.removeFromParent();
  }

  /** Top speed that keeps clear of the next vehicle on the loop and of anyone on the road ahead. */
  private cap(c: Car): number {
    let cap = CRUISE;
    const p = loopPoint(c.loop, c.s, tmpP);
    const h = loopHeading(c.loop, c.s, tmpH);
    for (const o of this.cars) {
      if (o === c || o.loop !== c.loop) continue;
      const gap = (((o.s - c.s) % c.loop.length) + c.loop.length) % c.loop.length;
      if (gap > FOLLOW_SLOW) continue;
      cap = Math.min(cap, gap <= FOLLOW_STOP ? 0 : ((gap - FOLLOW_STOP) / (FOLLOW_SLOW - FOLLOW_STOP)) * CRUISE);
    }
    for (const w of CROSSERS) cap = Math.min(cap, this.walkerCap(p.x, p.z, h.x, h.z, w.x, w.z));
    const pl = this.ctx.player.position;
    return Math.min(cap, this.walkerCap(p.x, p.z, h.x, h.z, pl.x, pl.z));
  }

  /** Speed cap for someone at (wx, wz): 0 within WALK_STOP, easing up to CRUISE at WALK_AHEAD. */
  private walkerCap(px: number, pz: number, hx: number, hz: number, wx: number, wz: number): number {
    const dx = wx - px;
    const dz = wz - pz;
    const along = dx * hx + dz * hz;
    if (along <= 0 || along > WALK_AHEAD || Math.abs(dx * hz - dz * hx) > WALK_SIDE) return Infinity;
    return along <= WALK_STOP ? 0 : ((along - WALK_STOP) / (WALK_AHEAD - WALK_STOP)) * CRUISE;
  }

  private drive(c: Car, dt: number): void {
    const vmax = this.cap(c);
    c.speed = approach(c.speed, vmax, (c.speed > vmax ? DECEL : ACCEL) * dt);
    c.s = (c.s + c.speed * dt) % c.loop.length;
    this.pose(c, dt);
    c.model.animate(dt, c.speed, Math.min(1, c.speed / (CRUISE * 0.5)));
    c.rig.animate(dt, 0);
  }

  private pose(c: Car, dt = 0): void {
    const p = loopPoint(c.loop, c.s, tmp);
    c.model.root.position.set(p.x, 0, p.z);
    const h = loopHeading(c.loop, c.s, tmpH);
    // a model facing −X turned by yaw y points at (−cos y, sin y); eased so a corner is one smooth turn
    const y = Math.atan2(h.z, -h.x);
    c.yaw = Number.isNaN(c.yaw) || dt <= 0 ? y : dampAngle(c.yaw, y, 14, dt);
    c.model.root.rotation.y = c.yaw;
  }

  private facing(c: Car, out: THREE.Vector3): THREE.Vector3 {
    const y = c.model.root.rotation.y;
    return out.set(-Math.cos(y), 0, Math.sin(y));
  }
}
