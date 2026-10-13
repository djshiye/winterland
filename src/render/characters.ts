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
  createWorkerModel,
  type CharacterKind,
  type CharacterModel,
} from '../assets/characters';
import { damp } from '../core/math';

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
  private readonly scale: number;

  private carrying = false;
  private seated = false;
  private carryBlend = 0;
  private seatBlend = 0;
  private speed = 0;
  private phase = 0;
  private time = Math.random() * 10;
  private cheerT = -1;

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
    this.scale = opts.scale ?? 1;
    this.root.scale.setScalar(this.scale);
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
    if (this.armLAngle !== null) armL = this.armLAngle;
    if (this.armRAngle !== null) armR = this.armRAngle;
    this.armL.rotation.x = armL;
    this.armR.rotation.x = armR;
    // splay outward at rest, tuck in while carrying
    const splay = lerp(0.14 + 0.03 * breathe, -0.1, carry) + cheerW * 0.35;
    this.armL.rotation.z = -splay;
    this.armR.rotation.z = splay;
  }
}

export type { CharacterKind };

/**
 * Entry point for the player and NPC code: the animated rig for a character kind (the meshes come
 * from AssetFactory assets/characters.ts). `variant` varies shade / scarf / scale (±6%) across a crowd.
 */
export function createCharacterRig(kind: CharacterKind, variant = 0): CharacterRig {
  switch (kind) {
    case 'player':
      return new CharacterRig(createPlayerModel());
    case 'customer':
      return new CharacterRig(createCustomerModel(variant), { scale: characterScale(variant) });
    case 'courier':
      return new CharacterRig(createCourierModel(), { scale: characterScale(variant + 101) });
    case 'driver':
      return new CharacterRig(createDriverModel(variant), { scale: characterScale(variant + 211) });
    case 'worker':
      return new CharacterRig(createWorkerModel(variant), { scale: characterScale(variant + 307) });
  }
}
