/**
 * [B1 — engine] The lumberjack.
 *
 * - Movement: desired velocity = cameraRig.screenToWorldDir(input.move) * PLAYER.speed (or toward
 *   `autopilot` when set); accelerate/decelerate (PLAYER.accel/decel) for responsive-but-smooth feel;
 *   resolve against ctx.colliders (radius PLAYER.radius); face movement direction with
 *   dampAngle(PLAYER.turnLambda). inputEnabled=false → decelerate to a stop.
 * - Visual: CharacterRig (red shirt, dark pants, yellow beanie) + an axe (wood handle, grey head)
 *   parented to rig.handR, visible only while chopping. rig.setCarrying(arms.size > 0).
 * - Stacks: `arms` = CarryStack(accepts log+crate, PLAYER.armsCapacity, anchor rig.armsAnchor);
 *   `back` = CashStack(anchor rig.backAnchor, PLAYER.cashVisualCap). Both are updated every frame with
 *   the actual (post-collision) world velocity, which drives their sway spring.
 * - Chopping: setChopTarget(p) (called every frame by the giant log while the player stands in its
 *   chop zone; null when leaving) → face p when not moving, loop an axe swing every
 *   TIMING.chopInterval (wind-up, fast strike, recoil); at the strike frame emit
 *   ctx.events 'player:chopHit' { position: p }. No target → axe hidden, swing stops.
 * - Small snow puffs at the feet while running (ctx.particles.puff, throttled).
 */
import * as THREE from 'three';
import { PALETTE, PLAYER, TIMING } from '../config';
import type { GameContext } from '../core/types';
import { Ease } from '../core/Tween';
import { approach, clamp, dampAngle } from '../core/math';
import { CharacterRig } from '../render/characters';
import { geo, mesh, toon } from '../render/materials';
import { CarryStack } from '../items/CarryStack';
import { CashStack } from '../items/CashStack';

// Axe swing keyframes: right-arm angle about X (see CharacterRig: 0 hangs, ±π is straight up,
// -π/2 ≡ 3π/2 is forward). The arc runs up and over the head: wind-up (behind) → strike (forward-down).
/** Hanging arm, expressed as a full turn so the raise runs forward and over the head. */
const REST_ANGLE = Math.PI * 2;
const SWING_START = 3.0;
const SWING_WINDUP = 2.35;
const SWING_STRIKE = 5.35;
const SWING_RECOIL = 5.1;
/** Fraction of the swing period at which the blade connects. */
const STRIKE_AT = 0.58;
const WINDUP_AT = 0.3;
const RECOIL_AT = 0.72;
/** Above this fraction of full speed the player is "running", not chopping. */
const CHOP_MAX_SPEED01 = 0.35;
const PUFF_INTERVAL = 0.13;
const ARRIVE_RADIUS = 0.2;
const BLOCKED_TIME = 0.3;

export class Player {
  readonly object = new THREE.Group();
  readonly rig: CharacterRig;
  readonly velocity = new THREE.Vector3();
  readonly arms: CarryStack;
  readonly back: CashStack;
  /** Yaw (rotation.y); the model faces local +Z. */
  facing = 0;
  inputEnabled = true;
  /** Debug/test autopilot: walk toward this XZ point (y ignored); cleared on arrival. */
  autopilot: THREE.Vector3 | null = null;

  private readonly axe = new THREE.Group();
  private readonly chopTarget = new THREE.Vector3();
  private readonly chopPos = new THREE.Vector3();
  private hasChopTarget = false;
  private swinging = false;
  private chopClock = 0;
  private struck = false;
  /** 0..1 blend between normal arm animation and the scripted swing. */
  private chopBlend = 0;
  private blockedFor = 0;
  private puffClock = 0;

  private readonly desired = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly puffPos = new THREE.Vector3();
  private readonly puffOpts = { count: 2, size: 0.3, life: 0.55, color: 0xffffff };

  constructor(readonly ctx: GameContext) {
    this.rig = new CharacterRig({ body: PALETTE.playerShirt, pants: PALETTE.playerPants, hat: 'beanie', hatColor: PALETTE.playerHat });
    this.object.add(this.rig.root);
    this.object.position.set(PLAYER.spawn.x, 0, PLAYER.spawn.z);
    ctx.scene.add(this.object);
    this.buildAxe();
    this.rig.handR.add(this.axe);
    this.axe.visible = false;
    this.arms = new CarryStack(ctx, { id: 'player.arms', accepts: ['log', 'crate'], capacity: PLAYER.armsCapacity, anchor: this.rig.armsAnchor });
    this.back = new CashStack(ctx, { id: 'player.back', anchor: this.rig.backAnchor, maxVisual: PLAYER.cashVisualCap });
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** 0 when idle, 1 at full speed. */
  get speed01(): number {
    return Math.min(1, this.velocity.length() / PLAYER.speed);
  }

  /** True while the axe is out and swinging. */
  get isChopping(): boolean {
    return this.swinging;
  }

  teleport(x: number, z: number): void {
    this.object.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.autopilot = null;
  }

  /** Called every frame by the giant log's chop zone with the strike point; null leaves chopping. */
  setChopTarget(p: THREE.Vector3 | null): void {
    if (p) {
      this.chopTarget.copy(p);
      this.hasChopTarget = true;
    } else {
      this.hasChopTarget = false;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const pos = this.object.position;
    const input = this.ctx.input;

    // --- desired velocity ----------------------------------------------------
    const d = this.desired.set(0, 0, 0);
    if (this.inputEnabled) {
      if (input.active) {
        this.autopilot = null;
        this.ctx.cameraRig.screenToWorldDir(input.move, d);
        d.multiplyScalar(PLAYER.speed);
      } else if (this.autopilot) {
        const dx = this.autopilot.x - pos.x;
        const dz = this.autopilot.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < ARRIVE_RADIUS) {
          this.autopilot = null;
        } else {
          const sp = PLAYER.speed * Math.min(1, dist / 0.9 + 0.15);
          d.set((dx / dist) * sp, 0, (dz / dist) * sp);
        }
      }
    } else {
      this.autopilot = null;
    }

    // --- accelerate toward it ------------------------------------------------
    const v = this.velocity;
    const ex = d.x - v.x;
    const ez = d.z - v.z;
    const elen = Math.hypot(ex, ez);
    const maxDelta = (d.lengthSq() > 0.01 ? PLAYER.accel : PLAYER.decel) * dt;
    if (elen <= maxDelta || elen < 1e-6) {
      v.x = d.x;
      v.z = d.z;
    } else {
      v.x += (ex / elen) * maxDelta;
      v.z += (ez / elen) * maxDelta;
    }

    // --- move + collide --------------------------------------------------------
    this.prev.copy(pos);
    pos.x += v.x * dt;
    pos.z += v.z * dt;
    pos.y = 0;
    this.ctx.colliders.resolveCircle(pos, PLAYER.radius);
    // The real (post-collision) velocity: sliding along a wall reads as slower, a pinned player as stopped.
    const ivx = (pos.x - this.prev.x) / dt;
    const ivz = (pos.z - this.prev.z) / dt;
    const intended = Math.hypot(v.x, v.z);
    v.x = ivx;
    v.z = ivz;
    v.y = 0;

    // autopilot toward an unreachable point (inside a collider): give up once we stop making progress
    if (this.autopilot) {
      if (intended > 0.5 && Math.hypot(ivx, ivz) < 0.15 * intended) {
        this.blockedFor += dt;
        if (this.blockedFor > BLOCKED_TIME) this.autopilot = null;
      } else {
        this.blockedFor = 0;
      }
    } else {
      this.blockedFor = 0;
    }

    const speed01 = this.speed01;

    // --- chop state ------------------------------------------------------------
    const wantsSwing = this.hasChopTarget && speed01 < CHOP_MAX_SPEED01 && this.inputEnabled;
    if (wantsSwing && !this.swinging) {
      this.swinging = true;
      this.chopClock = 0;
      this.struck = false;
    } else if (!wantsSwing && this.swinging) {
      this.swinging = false;
    }

    // --- facing ----------------------------------------------------------------
    let targetYaw = this.facing;
    let hasYaw = false;
    if (speed01 > 0.08) {
      targetYaw = Math.atan2(v.x, v.z);
      hasYaw = true;
    } else if (this.hasChopTarget) {
      const fx = this.chopTarget.x - pos.x;
      const fz = this.chopTarget.z - pos.z;
      if (fx * fx + fz * fz > 1e-4) {
        targetYaw = Math.atan2(fx, fz);
        hasYaw = true;
      }
    }
    if (hasYaw) this.facing = dampAngle(this.facing, targetYaw, PLAYER.turnLambda, dt);
    this.object.rotation.y = this.facing;

    // --- axe swing -------------------------------------------------------------
    this.updateSwing(dt);

    // --- visuals ---------------------------------------------------------------
    this.rig.setCarrying(this.arms.size > 0);
    this.rig.animate(dt, speed01);
    this.arms.update(dt, v);
    this.back.update(dt, v);

    // --- snow puffs while running ------------------------------------------------
    this.puffClock -= dt;
    if (speed01 > 0.55 && this.puffClock <= 0) {
      this.puffClock = PUFF_INTERVAL + Math.random() * 0.05;
      this.puffPos.set(pos.x - v.x * 0.03 + (Math.random() - 0.5) * 0.3, 0.08, pos.z - v.z * 0.03 + (Math.random() - 0.5) * 0.3);
      this.ctx.particles.puff(this.puffPos, this.puffOpts);
    }
  }

  // ---------------------------------------------------------------------------

  private updateSwing(dt: number): void {
    const rig = this.rig;
    this.chopBlend = approach(this.chopBlend, this.swinging ? 1 : 0, dt * 10);

    if (this.swinging) {
      const period = TIMING.chopInterval;
      this.chopClock += dt;
      if (this.chopClock >= period) {
        this.chopClock -= period;
        this.struck = false;
      }
      const k = this.chopClock / period;
      if (!this.struck && k >= STRIKE_AT) {
        this.struck = true;
        this.chopPos.copy(this.chopTarget);
        this.ctx.events.emit('player:chopHit', { position: this.chopPos });
      }
      const angle = swingAngle(k);
      const u = clamp((angle - SWING_WINDUP) / (SWING_STRIKE - SWING_WINDUP), 0, 1);
      const w = this.chopBlend;
      rig.armRAngle = lerp(REST_ANGLE, angle, w);
      rig.armLAngle = (-0.5 - 0.7 * u) * w;
      rig.torsoLean = (-0.14 + 0.5 * u) * w;
      rig.torsoTwist = 0;
    } else if (this.chopBlend > 0.02) {
      // eased exit: relax the scripted pose back to rest
      const w = this.chopBlend;
      rig.armRAngle = lerp(REST_ANGLE, SWING_RECOIL, w);
      rig.armLAngle = -1.0 * w;
      rig.torsoLean = 0.3 * w;
    } else {
      rig.armRAngle = null;
      rig.armLAngle = null;
      rig.torsoLean = 0;
    }
    this.axe.visible = this.swinging || this.chopBlend > 0.05;
  }

  private buildAxe(): void {
    // handR's local -Y runs along the arm, away from the shoulder; the blade leads the swing (local -Z).
    const wood = toon(PALETTE.plank);
    const steel = toon(PALETTE.metal);
    const handle = mesh(geo.cylinder(0.035, 0.04, 0.95, 8), wood);
    handle.position.y = -0.38;
    const head = mesh(geo.box(0.07, 0.3, 0.24), steel);
    head.position.set(0, -0.78, -0.1);
    const edge = mesh(geo.box(0.045, 0.36, 0.05), toon(PALETTE.metalDark));
    edge.position.set(0, -0.78, -0.24);
    const knob = mesh(geo.sphere(0.05, 8, 6), wood);
    knob.position.y = 0.1;
    this.axe.add(handle, head, edge, knob);
  }
}

/** Right-arm angle through one swing period, k ∈ [0,1): raise → wind-up → strike → recoil → lift. */
function swingAngle(k: number): number {
  if (k < WINDUP_AT) return lerp(SWING_START, SWING_WINDUP, Ease.quadOut(k / WINDUP_AT));
  if (k < STRIKE_AT) return lerp(SWING_WINDUP, SWING_STRIKE, Ease.quadIn((k - WINDUP_AT) / (STRIKE_AT - WINDUP_AT)));
  if (k < RECOIL_AT) return lerp(SWING_STRIKE, SWING_RECOIL, Ease.quadOut((k - STRIKE_AT) / (RECOIL_AT - STRIKE_AT)));
  return lerp(SWING_RECOIL, SWING_START, Ease.sineInOut((k - RECOIL_AT) / (1 - RECOIL_AT)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
