/**
 * [B1 — engine] Isometric orthographic camera rig. STUB: replace bodies, keep the public API.
 *
 * Requirements:
 * - Camera looks at `target` from direction (yaw CAMERA.yawDeg around Y, elevation CAMERA.pitchDeg),
 *   i.e. it sits toward +X/+Z of the target at CAMERA.distance.
 * - Frustum: visible height = CAMERA.viewHeight / zoom; on narrow screens widen so at least
 *   CAMERA.minViewWidth / zoom units are visible across.
 * - follow(obj): target smoothly follows obj.position with exponential damping (CAMERA.followLambda);
 *   slight damping, never jittery. snapToTarget() jumps there instantly.
 * - focus(point, {duration, hold}): cinematic pan to a point (or follow an Object3D while focused),
 *   then after `hold` seconds return to the follow target (used by the intro and pad unlocks).
 * - setZoom(mult, duration): smooth zoom (phase 5 zooms out to CAMERA.expansionZoom).
 * - shake(intensity, duration): additive screen shake with decay (crash, unlocks, chops ≈ 0.05).
 * - screenToWorldDir: maps screen-space input (x right, y up) to a normalised world XZ direction
 *   using the camera yaw — "up" on screen moves the player away from the camera.
 */
import * as THREE from 'three';

export class CameraRig {
  /** Current (smoothed) look-at point on the ground. */
  readonly target = new THREE.Vector3();
  zoom = 1;

  constructor(readonly camera: THREE.OrthographicCamera) {}

  follow(_obj: THREE.Object3D | null): void {}

  snapToTarget(): void {}

  focus(
    _point: THREE.Vector3 | THREE.Object3D,
    _opts?: { duration?: number; hold?: number; onArrive?: () => void; onReturn?: () => void },
  ): void {}

  releaseFocus(): void {}

  setZoom(_mult: number, _duration = 1): void {}

  shake(_intensity = 0.3, _duration = 0.3): void {}

  resize(_width: number, _height: number): void {}

  update(_dt: number): void {}

  /** Screen-space vector (x right, y up) → normalised world XZ direction (y = 0) scaled by input length. */
  screenToWorldDir(v: THREE.Vector2, out: THREE.Vector3): THREE.Vector3 {
    return out.set(v.x, 0, -v.y);
  }

  /** World point → CSS pixel coordinates relative to the canvas. Returns false if not projectable. */
  worldToScreen(_p: THREE.Vector3, out: THREE.Vector2): boolean {
    out.set(0, 0);
    return false;
  }

  /** True if the world point projects inside the viewport shrunk by `marginPx`. */
  isOnScreen(_p: THREE.Vector3, _marginPx = 0): boolean {
    return true;
  }
}
