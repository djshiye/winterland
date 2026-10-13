/**
 * [B1 — engine] Capsule-people model + procedural animation, shared by the player and NPCs
 * (walk-in customers, tricycle riders, truck drivers). STUB: replace bodies, keep the public API.
 *
 * Look: chunky low-poly toy style — capsule body (bodyColor), sphere head (skin) with two tiny dark
 * eyes, optional hat (beanie with pom-pom for the lumberjack, cap for NPCs), short capsule arms,
 * stubby legs/feet. ~1.7 units tall. Built only from materials.ts helpers (toon + geo cache).
 *
 * Conventions:
 * - root origin at the feet, character faces local +Z.
 * - armsAnchor: in front of the chest (~y 0.95, z +0.45) — carried goods stack upward from here.
 * - backAnchor: behind the back (~y 0.9, z -0.4) — cash bundles stack upward from here.
 * - handR: right-hand attach point (the player's axe is parented here).
 *
 * animate(dt, speed01): walk cycle (bob, foot shuffle, arm swing, slight forward lean, tiny
 * squash on each step); idle breathing when speed01≈0. setCarrying(true) holds both arms forward
 * (under the stack) instead of swinging. setSeated(true) bends legs forward (trike/truck rider).
 * cheer(): little hop + arms up (customer happy after buying).
 */
import * as THREE from 'three';

export interface CharacterOptions {
  body: number;
  skin?: number;
  pants?: number;
  hat?: 'beanie' | 'cap' | 'none';
  hatColor?: number;
  scarf?: number;
  scale?: number;
}

export class CharacterRig {
  readonly root = new THREE.Group();
  readonly armsAnchor = new THREE.Object3D();
  readonly backAnchor = new THREE.Object3D();
  readonly handR = new THREE.Object3D();

  constructor(readonly opts: CharacterOptions) {
    this.armsAnchor.position.set(0, 0.95, 0.45);
    this.backAnchor.position.set(0, 0.9, -0.4);
    this.handR.position.set(0.35, 0.9, 0.2);
    this.root.add(this.armsAnchor, this.backAnchor, this.handR);
  }

  setCarrying(_carrying: boolean): void {}

  setSeated(_seated: boolean): void {}

  cheer(): void {}

  animate(_dt: number, _speed01: number): void {}
}
