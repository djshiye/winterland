/**
 * [B1 — engine] CharacterRig: procedural animation for any CharacterModel (assets/characters.ts), shared
 * by the player and NPCs (walk-in customers, tricycle couriers, truck drivers).
 *
 * Conventions:
 * - root origin at the feet, character faces local +Z.
 * - armsAnchor = model.carryPivot: carried goods stack upward from it (player: (0, 0.5, 0.45)).
 * - backAnchor = model.backPivot: cash bundles stack upward from it.
 * - handR: right-hand attach point (the player's axe). Its local -Y axis points along the arm.
 * - The anchors live on the animated torso pivot (they bob and lean with it) but are never scaled by
 *   the walk squash, so carried items keep their proportions.
 *
 * animate(dt, speed01): walk cycle (bob, waddle, boot shuffle, arm swing, forward lean, tiny squash on
 * each step); idle breathing when speed01≈0. setCarrying(true) holds both arms forward around the
 * stack instead of swinging. setSeated(true) bends the legs forward and drops the body (courier /
 * driver). cheer(): little hop + arms up (customer happy after buying).
 *
 * setWorking(true) blends in the model's role work loop (model.motion: shovel, flag, heave, gather, hammer, ledger,
 * dust) while standing still; idle characters fidget now and then; model.tail (the player's scarf) swings behind.
 * Reduced motion (fx/comfort) slows fidgets and damps the scarf.
 *
 * Extra hooks for scripted poses (e.g. the player's axe swing): armRAngle / armLAngle (radians about X,
 * 0 = hanging, negative = forward/up, ±π = straight up), torsoLean and torsoTwist.
 */
import * as THREE from 'three';
import {
  CHARACTER_HIP_Y as HIP,
  characterScale,
  createCourierModel,
  createCustomerModel,
  createDriverModel,
  createPlayerModel,
  type CharacterKind,
  type CharacterModel,
  type WorkMotion,
} from '../assets/characters';
import { createWorkerModel } from '../assets/eraWorkers';
import { damp } from '../core/math';
import { reducedMotion } from '../fx/comfort';
import { instanceAcrossScene } from './instancer';

const CARRY_ARM = -1.15;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface CharacterRigOptions {
  /** Uniform scale applied to the root (crowd variety). */
  scale?: number;
}

export class CharacterRig {
  readonly root: THREE.Group;
  readonly armsAnchor: THREE.Object3D;
  readonly backAnchor: THREE.Object3D;
  readonly handR: THREE.Object3D;

  /** Pivot of the whole upper body (bob / lean / twist). Child of root at hip height. */
  readonly torso: THREE.Group;
  /** Pivot at the +X shoulder (the axe arm). */
  readonly armR: THREE.Group;
  /** Pivot at the -X shoulder. */
  readonly armL: THREE.Group;
  readonly head: THREE.Group;

  /** Scripted override (radians about X) for the +X arm; null = automatic. */
  armRAngle: number | null = null;
  /** Scripted override (radians about X) for the -X arm; null = automatic. */
  armLAngle: number | null = null;
  /** Extra forward lean (radians) added on top of the walk lean. */
  torsoLean = 0;
  /** Extra torso yaw twist (radians). */
  torsoTwist = 0;

  private readonly squashGroup: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly hat: THREE.Object3D | null;
  private readonly tool: THREE.Object3D | null;
  private readonly tail: THREE.Object3D | null;
  private readonly motion: WorkMotion;
  private readonly scale: number;

  private carrying = false;
  private seated = false;
  private carryBlend = 0;
  private seatBlend = 0;
  private speed = 0;
  private phase = 0;
  private time = Math.random() * 10;
  private cheerT = -1;
  /** 0.9.8: station work (the role motion on a loop) and the idle fidget (one motion now and then). */
  private working = false;
  private workBlend = 0;
  private workPhase = Math.random();
  private fidgetT = -1;
  private fidgetWait = 3 + Math.random() * 6;
  private readonly seed = Math.random() * 100;

  constructor(
    readonly model: CharacterModel,
    readonly opts: CharacterRigOptions = {},
  ) {
    this.root = model.root;
    this.armsAnchor = model.carryPivot;
    this.backAnchor = model.backPivot;
    this.handR = model.handR;
    this.torso = model.body;
    this.armR = model.armR;
    this.armL = model.armL;
    this.head = model.head;
    this.squashGroup = model.squash;
    this.legL = model.legL;
    this.legR = model.legR;
    this.hat = model.hat;
    this.tool = model.tool ?? null;
    this.tail = model.tail ?? null;
    this.motion = model.motion ?? 'none';
    this.scale = opts.scale ?? 1;
    this.root.scale.setScalar(this.scale);
    // the same part on every pawn (a boot, an arm) draws as ONE instanced mesh across the scene
    instanceAcrossScene(this.root);
  }

  /** Top of the head/hat above the feet, in world units (speech bubbles float above it). */
  get height(): number {
    return this.model.height * this.scale;
  }

  /** Hold both arms forward around a carried stack (instead of swinging them). */
  setCarrying(carrying: boolean): void {
    this.carrying = carrying;
  }

  /** Bend the legs forward and drop the body (trike / truck rider). */
  setSeated(seated: boolean): void {
    this.seated = seated;
  }

  /** Little hop with both arms up. */
  cheer(): void {
    this.cheerT = 0;
  }

  /**
   * 0.9.8: at a station (loading / unloading / serving): plays the role's work motion on a loop (CharacterModel.motion:
   * scoop, wave, tap, write ...) while the hands are free, and a steady heave-and-bow while they carry.
   */
  setWorking(working: boolean): void {
    this.working = working;
  }

  /** The role's work motion pose at cycle position `t` (0..1): arm angles and lean (radians), or null. */
  private workPose(t: number): { r: number; l: number; lean: number; splay: number; nod: number } | null {
    const TAU = Math.PI * 2;
    const up = Math.max(0, Math.sin(t * TAU));
    switch (this.motion) {
      case 'shovel':
        return { r: -0.5 - 0.9 * up, l: -0.45 - 0.8 * up, lean: 0.38 * (1 - up) + 0.05, splay: -0.12, nod: 0.15 };
      case 'flag':
        return { r: -2.7 + 0.35 * Math.sin(t * TAU * 2), l: 0.05, lean: -0.05, splay: 0.25, nod: -0.12 };
      case 'heave':
        return { r: -0.25 - 0.35 * up, l: -0.25 - 0.35 * up, lean: -0.12 * up, splay: 0.1, nod: -0.08 * up };
      case 'gather':
        return { r: -0.95 + 0.45 * up, l: -0.3, lean: 0.55 - 0.4 * up, splay: -0.05, nod: 0.25 };
      case 'hammer': {
        // raise slowly, strike fast
        const k = t < 0.7 ? t / 0.7 : 1 - (t - 0.7) / 0.3;
        return { r: -0.9 - 1.5 * k, l: -0.35, lean: 0.12 + 0.12 * (1 - k), splay: 0, nod: 0.18 };
      }
      case 'ledger':
        return { r: -1.15, l: -1.0 + 0.1 * Math.sin(t * TAU * 6), lean: 0.06, splay: -0.18, nod: 0.3 };
      case 'dust':
        return { r: -1.05, l: -1.05, lean: 0.04, splay: -0.32 + 0.22 * Math.abs(Math.sin(t * TAU * 3)), nod: 0.06 };
      case 'none':
        return null;
    }
  }

  /** Advance the procedural animation. `speed01`: 0 idle … 1 full run. */
  animate(dt: number, speed01: number): void {
    this.time += dt;
    this.speed = damp(this.speed, speed01, 16, dt);
    const s = this.speed;
    this.carryBlend = damp(this.carryBlend, this.carrying ? 1 : 0, 18, dt);
    this.seatBlend = damp(this.seatBlend, this.seated ? 1 : 0, 14, dt);
    const seat = this.seatBlend;

    if (s > 0.03) this.phase += dt * (7.5 + 5.5 * s);
    // walk amplitude saturates quickly so slow NPC strolls still read as steps
    const a = Math.min(1, s * 2.2) * (1 - seat);
    const sinP = Math.sin(this.phase);
    const q = Math.abs(sinP);

    // cheer envelope
    let cheerW = 0;
    let hop = 0;
    if (this.cheerT >= 0) {
      this.cheerT += dt;
      const k = this.cheerT / 0.9;
      if (k >= 1) this.cheerT = -1;
      else {
        cheerW = Math.min(1, Math.sin(k * Math.PI) * 2.2);
        hop = Math.abs(Math.sin(k * Math.PI * 2)) * 0.28 * (1 - k);
      }
    }

    // boots
    const legAmp = 0.95 * a;
    this.legL.rotation.x = lerp(sinP * legAmp, -1.25, seat);
    this.legR.rotation.x = lerp(-sinP * legAmp, -1.25, seat);
    const hipDrop = 0.09 * seat;
    this.legL.position.y = this.legR.position.y = HIP - hipDrop + hop * 0.5;

    // torso: bob, lean, waddle, twist
    const breathe = Math.sin(this.time * 2.4) * (1 - Math.min(1, s * 4));
    this.torso.position.y = HIP - hipDrop + q * 0.09 * a + hop;
    this.torso.rotation.x = 0.17 * s * (1 - seat) + this.torsoLean;
    this.torso.rotation.z = sinP * 0.1 * a;
    this.torso.rotation.y = -sinP * 0.12 * a + this.torsoTwist;
    const stepSquash = (1 - q) * a;
    this.squashGroup.scale.set(
      1 + 0.04 * stepSquash + 0.014 * breathe,
      1 - 0.06 * stepSquash - 0.02 * breathe,
      1 + 0.04 * stepSquash + 0.014 * breathe,
    );
    this.head.rotation.x = -0.1 * s - this.torsoLean * 0.4;
    this.head.rotation.z = Math.sin(this.time * 1.3) * 0.03 * (1 - s);
    if (this.hat) {
      this.hat.rotation.x = -sinP * 0.04 * a;
      this.hat.rotation.z = Math.cos(this.phase * 2) * 0.04 * a;
    }

    // arms
    const swing = sinP * 0.95 * a;
    const idle = Math.sin(this.time * 2.4 + 1) * 0.04;
    const carry = Math.max(this.carryBlend, seat * 0.85);
    let armL = lerp(-swing + idle, CARRY_ARM + Math.sin(this.time * 6) * 0.02 * a, carry);
    let armR = lerp(swing - idle, CARRY_ARM + Math.sin(this.time * 6) * 0.02 * a, carry);
    if (cheerW > 0) {
      const wave = Math.sin(this.time * 22) * 0.22;
      armL = lerp(armL, -Math.PI + wave, cheerW);
      armR = lerp(armR, -Math.PI - wave, cheerW);
    }
    // splay outward at rest, tuck in while carrying
    let splay = lerp(0.14 + 0.03 * breathe, -0.1, carry) + cheerW * 0.35;

    // 0.9.8: station work and idle fidgets (gentler and rarer with Reduce motion)
    const calm = reducedMotion();
    const still = s < 0.06 && seat < 0.1;
    this.workBlend = damp(this.workBlend, this.working && still ? 1 : 0, 8, dt);
    let act = this.workBlend;
    if (still && !this.working && this.carryBlend < 0.1 && this.motion !== 'none') {
      if (this.fidgetT < 0) {
        this.fidgetWait -= dt;
        if (this.fidgetWait <= 0) this.fidgetT = 0;
      }
    } else if (this.fidgetT >= 0 && !still) {
      this.fidgetT = -1;
    }
    if (this.fidgetT >= 0) {
      this.fidgetT += dt;
      const len = 2.4;
      if (this.fidgetT >= len) {
        this.fidgetT = -1;
        this.fidgetWait = (calm ? 14 : 5) + Math.random() * 7;
      } else {
        act = Math.max(act, Math.min(1, Math.sin((this.fidgetT / len) * Math.PI) * 2.5));
      }
    }
    if (act > 0.001) {
      this.workPhase = (this.workPhase + dt * (calm ? 0.5 : 0.85)) % 1;
      const amp = calm ? 0.55 : 1;
      if (this.carryBlend > 0.5) {
        // hands full: a steady heave-and-bow over the load
        const bow = Math.max(0, Math.sin(this.workPhase * Math.PI * 4)) * 0.16 * amp;
        this.torso.rotation.x += bow * act;
        this.head.rotation.x += bow * 0.5 * act;
      } else {
        const pose = this.workPose(this.workPhase);
        if (pose) {
          const w = act * amp;
          armR = lerp(armR, pose.r, w);
          armL = lerp(armL, pose.l, w);
          splay = lerp(splay, pose.splay, w);
          this.torso.rotation.x += pose.lean * w;
          this.head.rotation.x += pose.nod * w;
        }
      }
    } else {
      // idle: look around now and then
      this.head.rotation.y = Math.sin(this.time * 0.45 + this.seed) * Math.sin(this.time * 0.21 + this.seed * 0.5) * 0.35 * (1 - Math.min(1, s * 4)) * (calm ? 0.4 : 1);
    }
    if (act > 0.001) this.head.rotation.y = damp(this.head.rotation.y, 0, 6, dt);

    if (this.armLAngle !== null) armL = this.armLAngle;
    if (this.armRAngle !== null) armR = this.armRAngle;
    this.armL.rotation.x = armL;
    this.armR.rotation.x = armR;
    this.armL.rotation.z = -splay;
    this.armR.rotation.z = splay;

    // the role tool rests in the hand; it is put away while the arms carry or the character rides
    if (this.tool) this.tool.visible = this.carryBlend < 0.5 && seat < 0.5;
    // the scarf tail swings with each step and flies out behind on the run
    if (this.tail) {
      const flutter = calm ? 0.3 : 1;
      this.tail.rotation.x = 0.12 + 1.05 * s * (1 - seat) + Math.sin(this.time * 11 + this.seed) * 0.12 * s * flutter + hop * 0.6;
      this.tail.rotation.z = sinP * 0.18 * a * flutter;
    }
  }
}

export type { CharacterKind };

/**
 * Entry point for the player and NPC code: the animated rig for a character kind (the meshes come
 * from AssetFactory assets/characters.ts). `variant` varies shade / scarf / scale (±6%) across a crowd; `era` dresses a
 * customer for its region (assets/characters.ts ERA_HATS).
 */
export function createCharacterRig(kind: CharacterKind, variant = 0, era = 1): CharacterRig {
  switch (kind) {
    case 'player':
      return new CharacterRig(createPlayerModel());
    case 'customer':
      return new CharacterRig(createCustomerModel(variant, era), { scale: characterScale(variant) });
    case 'courier':
      return new CharacterRig(createCourierModel(), { scale: characterScale(variant + 101) });
    case 'driver':
      return new CharacterRig(createDriverModel(variant), { scale: characterScale(variant + 211) });
    case 'worker':
      return new CharacterRig(createWorkerModel(variant), { scale: characterScale(variant + 307) });
  }
}
