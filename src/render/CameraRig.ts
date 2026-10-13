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
import { CAMERA } from '../config';

export class CameraRig {
  /** Current (smoothed) look-at point on the ground. */
  readonly target = new THREE.Vector3();
  zoom = 1;
  private followed: THREE.Object3D | null = null;
  private aspect = 16 / 9;
  private viewW = 1280;
  private viewH = 720;
  private readonly ndc = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector2();

  constructor(readonly camera: THREE.OrthographicCamera) {}

  follow(obj: THREE.Object3D | null): void {
    this.followed = obj;
  }

  snapToTarget(): void {
    if (this.followed) this.target.copy(this.followed.position);
    this.place();
  }

  focus(
    _point: THREE.Vector3 | THREE.Object3D,
    _opts?: { duration?: number; hold?: number; onArrive?: () => void; onReturn?: () => void },
  ): void {}

  releaseFocus(): void {}

  setZoom(_mult: number, _duration = 1): void {}

  shake(_intensity = 0.3, _duration = 0.3): void {}

  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.aspect = width / Math.max(1, height);
    let h = CAMERA.viewHeight / this.zoom;
    if (h * this.aspect < CAMERA.minViewWidth / this.zoom) h = CAMERA.minViewWidth / this.zoom / this.aspect;
    const w = h * this.aspect;
    Object.assign(this.camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    if (this.followed) this.target.lerp(this.followed.position, 1 - Math.exp(-CAMERA.followLambda * dt));
    this.place();
  }

  private place(): void {
    const yaw = THREE.MathUtils.degToRad(CAMERA.yawDeg);
    const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    const d = CAMERA.distance;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * d,
      this.target.y + Math.sin(pitch) * d,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * d,
    );
    this.camera.lookAt(this.target);
  }

  /** Screen-space vector (x right, y up) → world XZ direction (y = 0) scaled by input length. */
  screenToWorldDir(v: THREE.Vector2, out: THREE.Vector3): THREE.Vector3 {
    const yaw = THREE.MathUtils.degToRad(CAMERA.yawDeg);
    // forward (screen up) = (-sin, 0, -cos); right = (cos, 0, -sin)
    return out.set(Math.cos(yaw) * v.x - Math.sin(yaw) * v.y, 0, -Math.sin(yaw) * v.x - Math.cos(yaw) * v.y);
  }

  /** World point → CSS pixel coordinates relative to the canvas. Returns false if not projectable. */
  worldToScreen(p: THREE.Vector3, out: THREE.Vector2): boolean {
    this.ndc.copy(p).project(this.camera);
    out.set((this.ndc.x * 0.5 + 0.5) * this.viewW, (-this.ndc.y * 0.5 + 0.5) * this.viewH);
    return this.ndc.z > -1 && this.ndc.z < 1;
  }

  /** True if the world point projects inside the viewport shrunk by `marginPx`. */
  isOnScreen(p: THREE.Vector3, marginPx = 0): boolean {
    if (!this.worldToScreen(p, this.tmp2)) return false;
    return this.tmp2.x >= marginPx && this.tmp2.x <= this.viewW - marginPx && this.tmp2.y >= marginPx && this.tmp2.y <= this.viewH - marginPx;
  }
}
