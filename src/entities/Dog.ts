/**
 * [Wave 13] The Sled Dog: a husky companion that follows the lumberjack (owned and updated by entities/Player.ts).
 *
 * - Follow rule (pure, see `followStep`): target = player - heading * FOLLOW_DISTANCE (1.2 m behind); the dog closes on it with
 *   an exponential lag of FOLLOW_LAG (0.25 s) so it never overshoots, capped at a top speed. Heading = the player's last
 *   movement direction (frozen while the player stands still so the dog doesn't circle him).
 * - The dog turns toward its own velocity (dampAngle), runs with a leg / body bob when moving, and sits (nose up, rump down)
 *   once the player has stood still > SIT_AFTER seconds and the dog has arrived; while sitting it faces the player, wags its
 *   tail now and then and gives a quiet woof every 20-40 s.
 * - No colliders. If the player ends up > SNAP_DISTANCE away (debug teleport) the dog snaps to its spot.
 * - A small saddlebag with two mini logs shows while the player's arms hold more than the base carry capacity. The scarf
 *   colour follows the upgrade level (level 2+ differs from level 1).
 * - 3 draw calls (shadow pass included): body (one mesh, vertex colours incl. eyes, scarf and the saddlebag baked in, rebuilt only
 *   when the scarf colour or the bag toggles) casts a shadow = 2, limbs (one InstancedMesh: 4 legs + tail) = 1.
 */
import * as THREE from 'three';
import { createDog, type DogModel } from '../assets/sled';
import { dampAngle } from '../core/math';
import type { GameContext } from '../core/types';

/** How far behind the player (along his heading) the dog wants to be, metres. */
export const FOLLOW_DISTANCE = 1.2;
/** Time constant of the follow lag, seconds. */
export const FOLLOW_LAG = 0.25;
/** The dog never runs faster than this, m/s. */
export const FOLLOW_MAX_SPEED = 14;
/** Beyond this distance from the follow spot the dog snaps (debug teleport). */
export const SNAP_DISTANCE = 6;
/** The player must stand still this long before the dog sits, seconds. */
export const SIT_AFTER = 1.5;
/** The player counts as moving above this speed, m/s. */
const MOVING_SPEED = 0.5;

export interface XZ {
  x: number;
  z: number;
}

/**
 * One follow step (pure): move `dog` toward `player - heading * FOLLOW_DISTANCE` with a `lag`-second exponential
 * approach (never overshoots a still target), at most `maxSpeed` m/s. `heading` must be a unit vector. Returns `out`.
 */
export function followStep(
  dog: XZ,
  player: XZ,
  heading: XZ,
  dt: number,
  out: XZ = { x: 0, z: 0 },
  lag = FOLLOW_LAG,
  maxSpeed = FOLLOW_MAX_SPEED,
): XZ {
  const tx = player.x - heading.x * FOLLOW_DISTANCE;
  const tz = player.z - heading.z * FOLLOW_DISTANCE;
  const dx = tx - dog.x;
  const dz = tz - dog.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6 || dt <= 0) {
    out.x = dog.x;
    out.z = dog.z;
    return out;
  }
  const k = 1 - Math.exp(-dt / Math.max(1e-3, lag));
  const step = Math.min(dist * k, maxSpeed * dt, dist);
  out.x = dog.x + (dx / dist) * step;
  out.z = dog.z + (dz / dist) * step;
  return out;
}

/** What the dog needs from its owner (the Player): position, real velocity, and the carried count. */
export interface DogOwner {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly facing: number;
  readonly arms: { readonly size: number };
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Dog {
  readonly model: DogModel;
  get root(): THREE.Group {
    return this.model.root;
  }

  private readonly heading: XZ = { x: 0, z: 1 };
  private readonly next: XZ = { x: 0, z: 0 };
  private readonly pos: XZ = { x: 0, z: 0 };
  private yaw = 0;
  private speed = 0;
  private clock = 0;
  private idleFor = 0;
  private sitting = false;
  private wagLeft = 0;
  private nextWag = rand(2.5, 6);
  private nextWoof = rand(20, 40);

  constructor(
    private readonly ctx: GameContext,
    private readonly owner: DogOwner,
  ) {
    this.model = createDog();
    ctx.scene.add(this.model.root);
    this.heading.x = Math.sin(owner.facing);
    this.heading.z = Math.cos(owner.facing);
    this.snap();
    this.yaw = owner.facing;
    this.apply();
    this.model.setLevel(ctx.upgrades.level('dog'));
  }

  /** Put the dog on its follow spot right away. */
  snap(): void {
    this.pos.x = this.owner.position.x - this.heading.x * FOLLOW_DISTANCE;
    this.pos.z = this.owner.position.z - this.heading.z * FOLLOW_DISTANCE;
    this.speed = 0;
  }

  /** A short happy wag (hired, upgraded). */
  wag(seconds = 1.6): void {
    this.wagLeft = Math.max(this.wagLeft, seconds);
  }

  get isSitting(): boolean {
    return this.sitting;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const o = this.owner;
    const ctx = this.ctx;
    this.clock += dt;

    // --- heading + idle clock ------------------------------------------------------
    const pv = Math.hypot(o.velocity.x, o.velocity.z);
    if (pv > MOVING_SPEED) {
      this.heading.x = o.velocity.x / pv;
      this.heading.z = o.velocity.z / pv;
      this.idleFor = 0;
    } else {
      this.idleFor += dt;
    }

    // --- follow (debug teleports snap) -------------------------------------------------
    const tx = o.position.x - this.heading.x * FOLLOW_DISTANCE;
    const tz = o.position.z - this.heading.z * FOLLOW_DISTANCE;
    if (Math.hypot(tx - this.pos.x, tz - this.pos.z) > SNAP_DISTANCE) this.snap();
    followStep(this.pos, o.position, this.heading, dt, this.next);
    const vx = (this.next.x - this.pos.x) / dt;
    const vz = (this.next.z - this.pos.z) / dt;
    this.pos.x = this.next.x;
    this.pos.z = this.next.z;
    const sp = Math.hypot(vx, vz);
    this.speed += (sp - this.speed) * Math.min(1, dt * 14);

    // --- facing: toward the velocity, or toward the player while sitting ----------------
    if (sp > 0.6) {
      this.yaw = dampAngle(this.yaw, Math.atan2(vx, vz), 11, dt);
    } else if (this.sitting) {
      this.yaw = dampAngle(this.yaw, Math.atan2(o.position.x - this.pos.x, o.position.z - this.pos.z), 4, dt);
    }

    // --- sit / stand -------------------------------------------------------------------------
    const wantSit = pv <= MOVING_SPEED && this.idleFor > SIT_AFTER && sp < 0.3;
    if (wantSit !== this.sitting) {
      this.sitting = wantSit;
      if (wantSit) this.nextWoof = rand(20, 40);
    }
    const m = this.model;
    const sitTarget = this.sitting ? 1 : 0;
    m.sit += (sitTarget - m.sit) * Math.min(1, dt * 7);
    if (Math.abs(m.sit - sitTarget) < 0.004) m.sit = sitTarget;

    // --- wag + woof while sitting beside the player --------------------------------------------
    if (m.sit > 0.9) {
      this.nextWag -= dt;
      if (this.nextWag <= 0) {
        this.wag(rand(1.2, 2));
        this.nextWag = rand(3, 7);
      }
      const near = Math.hypot(o.position.x - this.pos.x, o.position.z - this.pos.z) < 3;
      if (near) {
        this.nextWoof -= dt;
        if (this.nextWoof <= 0) {
          ctx.audio.play('woof', { volume: 0.4 });
          this.wag(1.2);
          this.nextWoof = rand(20, 40);
        }
      }
    }
    if (this.wagLeft > 0) {
      this.wagLeft -= dt;
      m.tailYaw = Math.sin(this.clock * 22) * 0.6 * Math.min(1, Math.max(0, this.wagLeft) / 0.25);
    } else {
      m.tailYaw += (0 - m.tailYaw) * Math.min(1, dt * 10);
    }

    // --- looks: saddlebag while the arms are over the base capacity, scarf by level -----------------
    m.setBag(o.arms.size > ctx.upgrades.value('carry'));
    m.setLevel(ctx.upgrades.level('dog'));

    this.apply();
    m.animate(this.clock, this.sitting ? 0 : this.speed);
  }

  private apply(): void {
    const r = this.model.root;
    r.position.set(this.pos.x, 0, this.pos.z);
    r.rotation.y = this.yaw;
  }

  dispose(): void {
    this.model.dispose();
  }
}
