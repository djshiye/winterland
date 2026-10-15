/**
 * [B1 — engine] The lumberjack.
 *
 * - Movement: desired velocity = cameraRig.screenToWorldDir(input.move) * the Snow Boots speed (ctx.upgrades.value('speed'), or toward
 *   `autopilot` when set); accelerate/decelerate (PLAYER.accel/decel) for responsive-but-smooth feel;
 *   resolve against ctx.colliders (radius PLAYER.radius); face movement direction with
 *   dampAngle(PLAYER.turnLambda). inputEnabled=false → decelerate to a stop.
 * - Visual: createCharacterRig('player') (blue coat pawn with white collars, white beard, blue beanie) + the
 *   AssetFactory axe (brown handle, silver wedge head)
 *   parented to rig.handR, visible only while chopping. rig.setCarrying(arms.size > 0).
 * - Stacks: `arms` = CarryStack(accepts log+crate, PLAYER.armsCapacity, anchor rig.armsAnchor);
 *   `back` = CashStack(anchor rig.backAnchor, PLAYER.cashVisualCap). Both are updated every frame with
 *   the actual (post-collision) world velocity, which drives their sway spring.
 * - Chopping: setChopTarget(p) (called every frame by the giant log while the player stands in its
 *   chop zone; null when leaving) → face p when not moving, loop an axe swing every
 *   the Sharp Axe interval (ctx.upgrades.value('axe')) (wind-up, fast strike, recoil); at the strike frame emit
 *   ctx.events 'player:chopHit' { position: p }. No target → axe hidden, swing stops.
 * - Small snow puffs at the feet while running (ctx.particles.puff, throttled).
 * - Wave 13: owns the Sled Dog companion (entities/Dog.ts). It exists while ctx.upgrades.value('dog') > 0 (polled, so saves and
 *   debug setUpgrade work), woofs when first hired ('upgrade:bought'), and its value adds to the arms capacity.
 */
import * as THREE from 'three';
import { PLAYER } from '../config';
import { CARRY_KINDS, type GameContext } from '../core/types';
import { approach, clamp, dampAngle } from '../core/math';
import { createAxe } from '../assets/characters';
import { createCharacterRig, type CharacterRig } from '../render/characters';
import { CarryStack } from '../items/CarryStack';
import { CashStack } from '../items/CashStack';
import { Footprints } from '../fx/Footprints';
import { Dog } from './Dog';

// Axe swing: right-arm angle about X (see CharacterRig: 0 hangs, ±π is straight up). A sine runs between the
// wind-up (behind/above the head) and the strike (forward-down); the blade connects at the sine's peak.
/** Hanging arm, expressed as a full turn so the raise runs forward and over the head. */
const REST_ANGLE = Math.PI * 2;
const SWING_WINDUP = 2.35;
const SWING_STRIKE = 5.35;
const SWING_MID = (SWING_WINDUP + SWING_STRIKE) / 2;
const SWING_AMP = (SWING_STRIKE - SWING_WINDUP) / 2;
/** Fraction of the swing period at which the blade connects (the sine's maximum). */
const STRIKE_AT = 0.5;
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

  private axe: THREE.Group;
  /** Axe level the current model was built for. */
  private axeTier = -1;
  private readonly chopTarget = new THREE.Vector3();
  private readonly chopPos = new THREE.Vector3();
  private hasChopTarget = false;
  private swinging = false;
  /** Swing progress 0..1 (advances at 1 / current axe interval). */
  private chopClock = 0;
  private struck = false;
  /** 0..1 blend between normal arm animation and the scripted swing. */
  private chopBlend = 0;
  private blockedFor = 0;
  private puffClock = 0;
  /** Fading footprints in the snow (fx/Footprints.ts). */
  private readonly footprints: Footprints;
  /** Wave 13: the husky companion (null until the Sled Dog is hired). */
  dog: Dog | null = null;

  private readonly desired = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly puffPos = new THREE.Vector3();
  private readonly puffOpts = { count: 2, size: 0.3, life: 0.55, color: 0xffffff };

  constructor(readonly ctx: GameContext) {
    this.rig = createCharacterRig('player');
    this.object.add(this.rig.root);
    this.object.position.set(PLAYER.spawn.x, 0, PLAYER.spawn.z);
    ctx.scene.add(this.object);
    this.axe = createAxe(0);
    this.rig.handR.add(this.axe);
    this.axe.visible = false;
    // Tall loads split into columns (25 logs → 2 columns, 25 crates → a 2×2 block) so the stack stays readable.
    this.arms = new CarryStack(ctx, {
      id: 'player.arms',
      accepts: [...CARRY_KINDS],
      capacity: ctx.upgrades.value('carry'),
      anchor: this.rig.armsAnchor,
      columnHeight: 3.4,
      castShadows: true,
      renderCap: PLAYER.armsRenderCap,
    });
    this.back = new CashStack(ctx, { id: 'player.back', anchor: this.rig.backAnchor, maxVisual: PLAYER.cashVisualCap });
    this.footprints = new Footprints(ctx);
    ctx.events.on('upgrade:bought', (e) => {
      if (e.id !== 'dog' || ctx.upgrades.value('dog') <= 0) return;
      const hired = !this.dog;
      this.syncUpgrades();
      if (hired && this.dog) {
        ctx.audio.play('woof');
        this.dog.wag(2);
      }
    });
    this.syncUpgrades();
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** 0 when idle, 1 at full speed. */
  get speed01(): number {
    return Math.min(1, this.velocity.length() / this.maxSpeed);
  }

  /** Current top walk speed (Snow Boots upgrade, × the snowstorm slowdown), m/s. */
  get maxSpeed(): number {
    return this.ctx.upgrades.value('speed') * this.ctx.worldEvents.walkSpeedMult;
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
        d.multiplyScalar(this.maxSpeed);
      } else if (this.autopilot) {
        const dx = this.autopilot.x - pos.x;
        const dz = this.autopilot.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < ARRIVE_RADIUS) {
          this.autopilot = null;
        } else {
          const sp = this.maxSpeed * Math.min(1, dist / 0.9 + 0.15);
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

    this.syncUpgrades();
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
    // stride rate follows real speed (PLAYER.speed is the walk-cycle normaliser), so a faster player strides faster
    this.rig.animate(dt, Math.min(1.45, Math.hypot(v.x, v.z) / PLAYER.speed));
    this.arms.update(dt, v);
    this.back.update(dt, v);

    // --- snow puffs while running ------------------------------------------------
    this.puffClock -= dt;
    if (speed01 > 0.55 && this.puffClock <= 0) {
      this.puffClock = PUFF_INTERVAL + Math.random() * 0.05;
      this.puffPos.set(pos.x - v.x * 0.03 + (Math.random() - 0.5) * 0.3, 0.08, pos.z - v.z * 0.03 + (Math.random() - 0.5) * 0.3);
      this.ctx.particles.puff(this.puffPos, this.puffOpts);
    }
    this.footprints.step(dt, pos.x, pos.z, v.x, v.z);
    this.dog?.update(dt);
  }

  // ---------------------------------------------------------------------------

  /** Apply live upgrade levels: carry capacity and axe model (polled, so restores and debug setUpgrade work too). */
  private syncUpgrades(): void {
    const up = this.ctx.upgrades;
    const cap = up.value('carry') + up.value('dog');
    if (this.arms.capacity !== cap) this.arms.setCapacity(cap);
    // the Sled Dog appears (restored saves, debug setUpgrade) and disappears with its upgrade level
    if (up.value('dog') > 0) {
      if (!this.dog) this.dog = new Dog(this.ctx, this);
    } else if (this.dog) {
      this.dog.dispose();
      this.dog = null;
    }
    const tier = up.level('axe');
    if (tier !== this.axeTier) {
      this.axeTier = tier;
      const old = this.axe;
      const next = createAxe(tier);
      next.visible = old.visible;
      this.rig.handR.remove(old);
      old.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose(); // baked axe geometry is unique per axe (the material is shared)
      });
      this.axe = next;
      this.rig.handR.add(next);
    }
  }

  private updateSwing(dt: number): void {
    const rig = this.rig;
    this.chopBlend = approach(this.chopBlend, this.swinging ? 1 : 0, dt * 10);

    if (this.swinging) {
      this.chopClock += dt / Math.max(0.05, this.ctx.upgrades.value('axe'));
      if (this.chopClock >= 1) {
        this.chopClock -= Math.floor(this.chopClock);
        this.struck = false;
      }
      const k = this.chopClock;
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
      rig.armRAngle = lerp(REST_ANGLE, SWING_STRIKE - 0.25, w);
      rig.armLAngle = -1.0 * w;
      rig.torsoLean = 0.3 * w;
    } else {
      rig.armRAngle = null;
      rig.armLAngle = null;
      rig.torsoLean = 0;
    }
    this.axe.visible = this.swinging || this.chopBlend > 0.05;
  }
}

/** Right-arm angle through one swing period: a sine with its wind-up at k = 0 and its strike at k = STRIKE_AT. */
function swingAngle(k: number): number {
  return SWING_MID + SWING_AMP * Math.sin((k - STRIKE_AT / 2) * Math.PI * 2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
