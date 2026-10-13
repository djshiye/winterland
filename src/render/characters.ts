/**
 * [B1 — engine] Capsule-people model + procedural animation, shared by the player and NPCs
 * (walk-in customers, tricycle riders, truck drivers).
 *
 * Look: chunky low-poly toy style — capsule body (bodyColor), sphere head (skin) with two tiny dark
 * eyes, optional hat (beanie with pom-pom for the lumberjack, cap for NPCs), short capsule arms,
 * stubby legs/feet. ~1.7 units tall. Built only from materials.ts helpers (toon + geo cache).
 *
 * Conventions:
 * - root origin at the feet, character faces local +Z.
 * - armsAnchor: in front of the chest (~y 0.95, z +0.45) — carried goods stack upward from here.
 * - backAnchor: behind the back (~y 0.9, z -0.4) — cash bundles stack upward from here.
 * - handR: right-hand attach point (the player's axe is parented here). It sits at the tip of the +X arm
 *   and its local -Y axis points along the arm, away from the shoulder.
 * - The anchors live on the animated torso (they bob and lean with it) but are never scaled by the
 *   walk squash, so carried items keep their proportions.
 *
 * animate(dt, speed01): walk cycle (bob, foot shuffle, arm swing, slight forward lean, tiny
 * squash on each step); idle breathing when speed01≈0. setCarrying(true) holds both arms forward
 * (under the stack) instead of swinging. setSeated(true) bends legs forward (trike/truck rider).
 * cheer(): little hop + arms up (customer happy after buying).
 *
 * Extra hooks for scripted poses (e.g. the player's axe swing): armRAngle / armLAngle (radians about X,
 * 0 = hanging, negative = forward/up, ±π = straight up), torsoLean and torsoTwist.
 */
import * as THREE from 'three';
import { PALETTE } from '../config';
import { damp } from '../core/math';
import { geo, mesh, toon } from './materials';

export interface CharacterOptions {
  body: number;
  skin?: number;
  pants?: number;
  hat?: 'beanie' | 'cap' | 'none';
  hatColor?: number;
  scarf?: number;
  scale?: number;
}

// Skeleton measurements (unscaled units; feet at y = 0).
const HIP_Y = 0.46;
const SHOULDER_Y = 0.93;
const SHOULDER_X = 0.37;
const HEAD_Y = 1.31;
const HEAD_R = 0.27;
const ARM_LEN = 0.36;
const CARRY_ARM = -1.22;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class CharacterRig {
  readonly root = new THREE.Group();
  readonly armsAnchor = new THREE.Object3D();
  readonly backAnchor = new THREE.Object3D();
  readonly handR = new THREE.Object3D();

  /** Pivot of the whole upper body (bob / lean / twist). Child of root at hip height. */
  readonly torso = new THREE.Group();
  /** Pivot at the +X shoulder (the axe arm). */
  readonly armR = new THREE.Group();
  /** Pivot at the -X shoulder. */
  readonly armL = new THREE.Group();
  readonly head = new THREE.Group();

  /** Scripted override (radians about X) for the +X arm; null = automatic. */
  armRAngle: number | null = null;
  /** Scripted override (radians about X) for the -X arm; null = automatic. */
  armLAngle: number | null = null;
  /** Extra forward lean (radians) added on top of the walk lean. */
  torsoLean = 0;
  /** Extra torso yaw twist (radians). */
  torsoTwist = 0;

  private readonly squashGroup = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly hat = new THREE.Group();

  private carrying = false;
  private seated = false;
  private carryBlend = 0;
  private seatBlend = 0;
  private speed = 0;
  private phase = 0;
  private time = Math.random() * 10;
  private cheerT = -1;

  constructor(readonly opts: CharacterOptions) {
    const bodyMat = toon(opts.body);
    const skinMat = toon(opts.skin ?? PALETTE.skin);
    const pantsMat = toon(opts.pants ?? PALETTE.playerPants);
    const eyeMat = toon(0x1c2230);
    const bootMat = toon(0x3a2a22);

    // --- legs (pivot at hip, hang down) --------------------------------------
    for (const [leg, sx] of [
      [this.legL, -0.17],
      [this.legR, 0.17],
    ] as const) {
      leg.position.set(sx, HIP_Y, 0);
      const l = mesh(geo.capsule(0.125, 0.14, 4, 10), pantsMat);
      l.position.y = -0.2;
      const foot = mesh(geo.box(0.24, 0.12, 0.34), bootMat);
      foot.position.set(0, -0.4, 0.06);
      leg.add(l, foot);
      this.root.add(leg);
    }

    // --- torso pivot ---------------------------------------------------------
    this.torso.position.y = HIP_Y;
    this.root.add(this.torso);
    this.torso.add(this.squashGroup);

    const chest = mesh(geo.capsule(0.33, 0.2, 5, 14), bodyMat);
    chest.position.y = 0.26;
    this.squashGroup.add(chest);

    if (opts.scarf !== undefined) {
      const scarf = mesh(geo.torus(0.27, 0.075, 8, 16), toon(opts.scarf));
      scarf.rotation.x = Math.PI / 2;
      scarf.position.y = 0.72;
      this.squashGroup.add(scarf);
    }

    // --- head ----------------------------------------------------------------
    this.head.position.y = HEAD_Y - HIP_Y;
    this.squashGroup.add(this.head);
    this.head.add(mesh(geo.sphere(HEAD_R, 18, 14), skinMat));
    for (const sx of [-0.1, 0.1]) {
      const eye = mesh(geo.sphere(0.045, 8, 6), eyeMat, { cast: false });
      eye.position.set(sx, 0.0, 0.235);
      eye.scale.set(1, 1.25, 0.7);
      this.head.add(eye);
    }
    const nose = mesh(geo.sphere(0.045, 8, 6), toon(0xe9a98a), { cast: false });
    nose.position.set(0, -0.06, 0.262);
    this.head.add(nose);

    const hatKind = opts.hat ?? 'none';
    if (hatKind !== 'none') {
      const hc = toon(opts.hatColor ?? PALETTE.playerHat);
      this.head.add(this.hat);
      if (hatKind === 'beanie') {
        const dome = mesh(geo.sphere(0.292, 16, 12), hc);
        dome.scale.set(1, 0.82, 1);
        dome.position.y = 0.2;
        const cuff = mesh(geo.cylinder(0.295, 0.295, 0.1, 16), toon(0xffffff));
        cuff.position.y = 0.15;
        const pom = mesh(geo.sphere(0.1, 10, 8), toon(0xffffff));
        pom.position.y = 0.46;
        this.hat.add(dome, cuff, pom);
        // little beard
        const beard = mesh(geo.sphere(0.2, 12, 10), toon(0x7a4a2a));
        beard.scale.set(1, 0.6, 0.6);
        beard.position.set(0, -0.2, 0.13);
        this.head.add(beard);
      } else {
        const dome = mesh(geo.sphere(0.285, 16, 12), hc);
        dome.scale.set(1, 0.7, 1);
        dome.position.y = 0.16;
        const brim = mesh(geo.box(0.36, 0.045, 0.22), hc);
        brim.position.set(0, 0.12, 0.27);
        brim.rotation.x = 0.12;
        this.hat.add(dome, brim);
      }
    }

    // --- arms (pivot at shoulder, hang down) ---------------------------------
    const armGeo = geo.capsule(0.095, 0.2, 4, 10);
    for (const [arm, sx] of [
      [this.armL, -SHOULDER_X],
      [this.armR, SHOULDER_X],
    ] as const) {
      arm.position.set(sx, SHOULDER_Y - HIP_Y, 0);
      const a = mesh(armGeo, bodyMat);
      a.position.y = -0.2;
      const hand = mesh(geo.sphere(0.1, 10, 8), skinMat);
      hand.position.y = -ARM_LEN;
      arm.add(a, hand);
      this.squashGroup.add(arm);
    }
    this.handR.position.set(0, -ARM_LEN, 0);
    this.armR.add(this.handR);

    // --- anchors (on the torso so they bob/lean, outside the squash group) ----
    this.armsAnchor.position.set(0, 0.95 - HIP_Y, 0.45);
    this.backAnchor.position.set(0, 0.9 - HIP_Y, -0.4);
    this.torso.add(this.armsAnchor, this.backAnchor);

    this.root.scale.setScalar(opts.scale ?? 1);
  }

  /** Hold both arms forward under a carried stack (instead of swinging them). */
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

    const moving = s > 0.03;
    if (moving) this.phase += dt * (7.5 + 5.5 * s);
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
        hop = Math.abs(Math.sin(k * Math.PI * 2)) * 0.3 * (1 - k);
      }
    }

    // legs
    const legAmp = 0.85 * a;
    this.legL.rotation.x = lerp(sinP * legAmp, -1.45, seat);
    this.legR.rotation.x = lerp(-sinP * legAmp, -1.45, seat);
    const hipDrop = 0.17 * seat;
    this.legL.position.y = this.legR.position.y = HIP_Y - hipDrop + hop * 0.5;

    // torso: bob, lean, sway, twist
    const breathe = Math.sin(this.time * 2.4) * (1 - Math.min(1, s * 4));
    this.torso.position.y = HIP_Y - hipDrop + q * 0.11 * a + hop;
    this.torso.rotation.x = 0.2 * s * (1 - seat) + this.torsoLean;
    this.torso.rotation.z = sinP * 0.06 * a;
    this.torso.rotation.y = -sinP * 0.14 * a + this.torsoTwist;
    const stepSquash = (1 - q) * a;
    this.squashGroup.scale.set(
      1 + 0.03 * stepSquash + 0.012 * breathe,
      1 - 0.05 * stepSquash - 0.018 * breathe,
      1 + 0.03 * stepSquash + 0.012 * breathe,
    );
    this.head.rotation.x = -0.1 * s - this.torsoLean * 0.4;
    this.head.rotation.z = Math.sin(this.time * 1.3) * 0.03 * (1 - s);
    this.hat.rotation.x = -sinP * 0.04 * a;
    this.hat.rotation.z = Math.cos(this.phase * 2) * 0.04 * a;

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
    const splay = lerp(0.12 + 0.03 * breathe, -0.1, carry) + cheerW * 0.35;
    this.armL.rotation.z = -splay;
    this.armR.rotation.z = splay;
  }
}
