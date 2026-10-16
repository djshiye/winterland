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
 * - 0.9.0 climb: wears the Founder's Scarf (assets/characters.ts createFounderScarf) from Settlement 20 on (polled).
 */
import * as THREE from 'three';
import { LAYOUT, PLAYER } from '../config';
import { CARRY_KINDS, type GameContext } from '../core/types';
import { approach, clamp, dampAngle } from '../core/math';
import { createAxe, createFounderScarf } from '../assets/characters';
import { createNodeTool } from '../assets/eraNodes';
import { eraPlayerId, regionAt } from '../eras/playerUpgrades';
import { founderScarf, settlementLevel } from '../core/demand';
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
/**
 * 0.9.2 steering assist: walking into the Market Town's decor (the big fir, the amenities, stalls, benches, lamps, the
 * snowman, the Grand Market hall) bends the walk around it instead of stopping dead. Shop buildings and their counters
 * (tags 'town:<lot>…'), the boundary fence and everything outside the town keep plain sliding, so pushing into a
 * counter or a pile zone never drifts the player off it.
 */
const STEER_ANGLES = [0.4, 0.8, 1.2, 1.5, 1.75];
/** How far ahead (m) the assist looks, and how long it keeps going round the same side (no left-right dithering). */
const STEER_LOOK = 0.55;
const STEER_HOLD = 0.45;
const steerable = (tag: string): boolean => tag.startsWith('town:') && tag !== 'town:fence' && !/^town:\d/.test(tag);

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
  /** 0.9.5: the era region the player stands in (0 = none), refreshed every frame in syncUpgrades. */
  private eraHere = 0;
  /** 0.9.5: the era hand node being worked (null = the giant log, with the axe). */
  private chopNode: { era: number; interval: number; tier: number } | null = null;
  /** The era hand tool in the right hand (assets/eraNodes.ts createNodeTool), built for `toolKey`. */
  private nodeTool: THREE.Group | null = null;
  private toolKey = '';
  private swinging = false;
  /** Swing progress 0..1 (advances at 1 / current axe interval). */
  private chopClock = 0;
  private struck = false;
  /** 0..1 blend between normal arm animation and the scripted swing. */
  private chopBlend = 0;
  private blockedFor = 0;
  /** Steering assist: the side (+1 / -1) it is going round, and for how much longer it sticks to it. */
  private steerSide = 1;
  private steerHold = 0;
  private puffClock = 0;
  /** Fading footprints in the snow (fx/Footprints.ts). */
  private readonly footprints: Footprints;
  /** Wave 13: the husky companion (null until the Sled Dog is hired). */
  dog: Dog | null = null;
  /** 0.9.0 climb: the Founder's Scarf (the Settlement 20 perk), null until then. */
  private scarf: THREE.Mesh | null = null;

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
    const n = this.eraHere;
    const boots = n ? this.ctx.upgrades.value(eraPlayerId(n, 'Boots')) : 1;
    return this.ctx.upgrades.value('speed') * boots * this.ctx.worldEvents.walkSpeedMult;
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

  /**
   * Steering assist (see STEER_ANGLES): when the way ahead is blocked by town decor, turn the desired velocity `d` (in
   * place, same speed) to the nearest free heading, preferring the side it already chose. No-op when the way is clear,
   * when the blocker is anything else, or when no heading up to ~90° is free (plain sliding then applies).
   */
  private steer(pos: THREE.Vector3, d: THREE.Vector3, dt: number): void {
    this.steerHold = Math.max(0, this.steerHold - dt);
    const sp = Math.hypot(d.x, d.z);
    if (sp < 0.1) return;
    const col = this.ctx.colliders;
    const r = PLAYER.radius;
    const ux = d.x / sp;
    const uz = d.z / sp;
    const ax = pos.x + ux * STEER_LOOK;
    const az = pos.z + uz * STEER_LOOK;
    // in the Market Town, its edges count too (walking into the fence line or a lot's side bends round instead)
    const T = LAYOUT.town.area;
    const inTown = pos.x >= T.minX && pos.x <= T.maxX && pos.z >= T.minZ && pos.z <= T.maxZ;
    if (!col.overlapsWhere(ax, az, r, steerable) && !(inTown && !col.inBounds(ax, az, r))) return;
    // a shop, counter or fence right ahead too: the player means to walk up to it (a pad, a hopper), so no bending
    if (col.overlapsWhere(ax, az, r, (t) => !steerable(t))) return;
    // per side, the smallest turn whose heading is free a step ahead AND further on (so it doesn't dive into a pocket)
    const free = (vx: number, vz: number): boolean =>
      col.isFree(pos.x + vx * STEER_LOOK, pos.z + vz * STEER_LOOK, r) && col.isFree(pos.x + vx * STEER_LOOK * 2.2, pos.z + vz * STEER_LOOK * 2.2, r);
    let best = -1;
    let bestSide = 0;
    for (const side of [this.steerSide, -this.steerSide]) {
      for (let i = 0; i < STEER_ANGLES.length && (best < 0 || i < best); i++) {
        const a = STEER_ANGLES[i]! * side;
        if (!free(ux * Math.cos(a) - uz * Math.sin(a), ux * Math.sin(a) + uz * Math.cos(a))) continue;
        best = i;
        bestSide = side;
        break;
      }
      if (best >= 0 && this.steerHold > 0) break; // keep going round the same side while it still works
    }
    if (best < 0) return;
    const a = STEER_ANGLES[best]! * bestSide;
    d.set((ux * Math.cos(a) - uz * Math.sin(a)) * sp, 0, (ux * Math.sin(a) + uz * Math.cos(a)) * sp);
    this.steerSide = bestSide;
    this.steerHold = STEER_HOLD;
  }

  /**
   * Called every frame by the giant log's chop zone with the strike point; null leaves chopping. 0.9.5: an era hand
   * node (eras/HandNode.ts) passes `node`: the era's own tool replaces the axe, swings every `interval` seconds and
   * 'player:chopHit' carries the node's era so only that node reacts.
   */
  setChopTarget(p: THREE.Vector3 | null, node?: { era: number; interval: number; tier: number }): void {
    if (p) {
      this.chopTarget.copy(p);
      this.hasChopTarget = true;
      this.chopNode = node ?? null;
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

    this.steer(pos, d, dt);

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
    // 0.9.5: inside an era region its own Carry and Pal upgrades add to the arms (eras/playerUpgrades.ts)
    const n = (this.eraHere = regionAt(this.object.position.x, this.object.position.z));
    const pal = n ? up.value(eraPlayerId(n, 'Pal')) : 0;
    const cap = up.value('carry') + up.value('dog') + (n ? up.value(eraPlayerId(n, 'Carry')) + pal : 0);
    if (this.arms.capacity !== cap) this.arms.setCapacity(cap);
    // the Sled Dog appears (restored saves, debug setUpgrade) and disappears with its upgrade level; in an era region
    // with that era's pal adopted, the companion trots along too
    if (up.value('dog') > 0 || pal > 0) {
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
    // 0.9.0 climb: the Founder's Scarf from Settlement 20 on (the level never goes down; restored saves, debug too)
    if (!this.scarf && founderScarf(settlementLevel(this.ctx.state))) {
      this.scarf = createFounderScarf();
      this.rig.model.squash.add(this.scarf);
    }
  }

  private updateSwing(dt: number): void {
    const rig = this.rig;
    this.chopBlend = approach(this.chopBlend, this.swinging ? 1 : 0, dt * 10);

    if (this.swinging) {
      const interval = this.chopNode ? this.chopNode.interval : this.ctx.upgrades.value('axe');
      this.chopClock += dt / Math.max(0.05, interval);
      if (this.chopClock >= 1) {
        this.chopClock -= Math.floor(this.chopClock);
        this.struck = false;
      }
      const k = this.chopClock;
      if (!this.struck && k >= STRIKE_AT) {
        this.struck = true;
        this.chopPos.copy(this.chopTarget);
        this.ctx.events.emit('player:chopHit', this.chopNode ? { position: this.chopPos, node: this.chopNode.era } : { position: this.chopPos });
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
    const out = this.swinging || this.chopBlend > 0.05;
    this.syncNodeTool();
    this.axe.visible = out && !this.nodeTool?.visible;
    if (this.nodeTool) this.nodeTool.visible = out && !!this.chopNode;
  }

  /** 0.9.5: swap in the era hand tool while a node is the target (built once per era and tool band). */
  private syncNodeTool(): void {
    const node = this.chopNode;
    if (!node) {
      if (this.nodeTool) this.nodeTool.visible = false;
      return;
    }
    const key = `${node.era}|${node.tier}`;
    if (key === this.toolKey && this.nodeTool) return;
    if (this.nodeTool) this.rig.handR.remove(this.nodeTool);
    this.toolKey = key;
    this.nodeTool = createNodeTool(node.era, node.tier);
    this.nodeTool.visible = false;
    this.rig.handR.add(this.nodeTool);
  }
}

/** Right-arm angle through one swing period: a sine with its wind-up at k = 0 and its strike at k = STRIKE_AT. */
function swingAngle(k: number): number {
  return SWING_MID + SWING_AMP * Math.sin((k - STRIKE_AT / 2) * Math.PI * 2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
