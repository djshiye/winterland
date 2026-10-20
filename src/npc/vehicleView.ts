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
import type { KerbVehicle } from '../city/roadRoute';

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

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Each vehicle's last sampled place and the speed measured since (m/s; NaN until a second sample). */
const seen = new Map<string, { x: number; z: number; t: number; speed: number }>();
/** Shortest gap between two speed samples of one vehicle (s). */
const SAMPLE_GAP = 0.15;

/**
 * Every live vehicle's place, heading and speed, for the kerb check (read lazily: only once a walker stands at a kerb; npc/EraWorker.ts, npc/EraShoppers.ts).
 * The speed is measured from its own movement, so a cart stopped in a queue or at a depot reads 0.
 */
export function* trafficNow(now: number): Generator<KerbVehicle> {
  if (seen.size > 256) seen.clear(); // ids are per spawn: forget the long gone now and then
  for (const v of liveVehicles()) {
    v.facing(_f);
    v.root.getWorldPosition(_v);
    let s = seen.get(v.id);
    if (!s) seen.set(v.id, (s = { x: _v.x, z: _v.z, t: now, speed: NaN }));
    else if (now - s.t >= SAMPLE_GAP) {
      s.speed = Math.hypot(_v.x - s.x, _v.z - s.z) / (now - s.t);
      s.x = _v.x;
      s.z = _v.z;
      s.t = now;
    }
    yield { x: _v.x, z: _v.z, fx: _f.x, fz: _f.z, speed: s.speed, yields: v.kind.startsWith('eraBuyer') };
  }
}
