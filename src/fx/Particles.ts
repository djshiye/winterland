/**
 * [B4 — juice & HUD] Pooled particle effects. STUB: replace bodies, keep the public API.
 *
 * Cheap and juicy: pooled meshes or InstancedMesh (preferred) with per-particle velocity, gravity,
 * spin, life and scale-out; toon/basic materials; no allocations per spawn in steady state.
 * - burst: generic spray (chopping wood chips, sawdust, build debris).
 * - puff: soft white/grey spheres that expand + fade (footstep snow, chimney smoke, poof on despawn).
 * - confetti: colourful flat chips raining down (pad unlock celebration).
 * - splash: water droplets + white ring on the river (intro crash).
 * - sparkle: small twinkling stars (cash landing, crate made).
 * - ring: flat expanding ground ring/shockwave that fades (building spawn, pad unlock).
 */
import type * as THREE from 'three';
import type { GameContext } from '../core/types';

export interface BurstOptions {
  colors?: number[];
  count?: number;
  /** Initial speed (units/s). */
  speed?: number;
  size?: number;
  gravity?: number;
  /** Lifetime (s). */
  life?: number;
  /** Cone half-angle (rad) around `direction`; Math.PI = full sphere. */
  spread?: number;
  /** Main emission direction (default up). */
  direction?: THREE.Vector3;
  shape?: 'cube' | 'chip' | 'sphere';
}

export class Particles {
  constructor(readonly ctx: GameContext) {}

  burst(_pos: THREE.Vector3, _opts?: BurstOptions): void {}

  puff(_pos: THREE.Vector3, _opts?: { color?: number; count?: number; size?: number; life?: number }): void {}

  confetti(_pos: THREE.Vector3, _count?: number): void {}

  splash(_pos: THREE.Vector3, _scale?: number): void {}

  sparkle(_pos: THREE.Vector3, _color?: number): void {}

  ring(_pos: THREE.Vector3, _opts?: { color?: number; radius?: number; life?: number }): void {}

  update(_dt: number): void {}
}
