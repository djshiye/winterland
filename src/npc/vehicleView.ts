/**
 * 0.9.12: two rules every vehicle in the world keeps (trains, trucks, tricycles, sleds, era buyers):
 *
 * 1. It only appears or disappears where the player can't see it (off screen) or at a depot (the trucks' tunnel,
 *    the train's tunnel). `inView` is the test: the camera's real frustum, so it holds at every zoom and screen shape.
 * 2. It faces the way it travels. Every live vehicle registers here with a `facing` callback (the way its nose
 *    points), so the debug API (`__WINTERLAND__.vehicles()`) and scripts/traffic-check.mjs can compare it with how it
 *    actually moves, and catch a vehicle that pops in or out in view.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';

export interface TrackedVehicle {
  /** Unique while alive ("eraBuyer:3:12"). */
  readonly id: string;
  /** What it is ("train", "truck", "trike", "sled", "eraBuyer:5"). */
  readonly kind: string;
  /** Its world object (position = where it is). */
  readonly root: THREE.Object3D;
  /** Unit world XZ direction the vehicle's nose points (the leading engine for the push-pull train). */
  facing(out: THREE.Vector3): THREE.Vector3;
}

const live = new Map<string, TrackedVehicle>();

export function trackVehicle(v: TrackedVehicle): void {
  live.set(v.id, v);
}

export function untrackVehicle(id: string): void {
  live.delete(id);
}

export function liveVehicles(): IterableIterator<TrackedVehicle> {
  return live.values();
}

const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere();

/**
 * True when a sphere of radius `r` at (x, y, z) shows on screen (the camera's frustum, grown by `r`). A vehicle passes
 * its own size plus its shadow as `r`. False without a camera (test stubs): headless logic treats everything as off
 * screen, as before.
 */
export function inView(ctx: Pick<GameContext, 'camera'>, x: number, z: number, r = 4, y = 1): boolean {
  const cam = ctx.camera as THREE.Camera | undefined;
  if (!cam || !(cam as THREE.OrthographicCamera).isOrthographicCamera) return false;
  cam.updateMatrixWorld();
  projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  sphere.center.set(x, y, z);
  sphere.radius = r;
  return frustum.intersectsSphere(sphere);
}
