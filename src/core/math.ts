import * as THREE from 'three';
import type { Rect } from '../config';

export const UP = new THREE.Vector3(0, 1, 0);
export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential smoothing toward `target` (lambda ≈ 1/time-constant). */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export function dampVec3(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): THREE.Vector3 {
  return current.lerp(target, 1 - Math.exp(-lambda * dt));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export const approach = (current: number, target: number, maxDelta: number): number =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Exponential smoothing for angles (shortest way round). */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = wrapAngle(target - current);
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export const randRange = (min: number, max: number): number => min + Math.random() * (max - min);
export const randInt = (min: number, maxInclusive: number): number =>
  Math.floor(min + Math.random() * (maxInclusive - min + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/**
 * Point on a parabolic arc from `a` to `b` with apex `height` above the straight line, t ∈ [0,1].
 * Horizontal motion is linear in t; vertical adds 4·h·t·(1-t).
 */
export function arcPoint(a: THREE.Vector3, b: THREE.Vector3, height: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  out.lerpVectors(a, b, t);
  out.y += 4 * height * t * (1 - t);
  return out;
}

export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

export function rectCenter(r: Rect, out: THREE.Vector3, y = 0): THREE.Vector3 {
  return out.set((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
}

/** Yaw (rotation.y) that makes a +Z-facing object face along (dx, dz). */
export const yawFromDir = (dx: number, dz: number): number => Math.atan2(dx, dz);
