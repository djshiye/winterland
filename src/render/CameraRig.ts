/**
 * [B1 — engine] Isometric orthographic camera rig.
 *
 * - Camera looks at `target` from direction (yaw CAMERA.yawDeg around Y, elevation CAMERA.pitchDeg),
 *   i.e. it sits toward +X/+Z of the target at CAMERA.distance.
 * - Frustum: visible height = CAMERA.viewHeight / zoom; on narrow screens widen so at least
 *   CAMERA.minViewWidth / zoom units are visible across.
 * - follow(obj): target smoothly follows obj.position with exponential damping (CAMERA.followLambda).
 *   snapToTarget() jumps there instantly.
 * - focus(point | object, {duration, hold}): cinematic pan to a point (or track an Object3D while focused),
 *   then after `hold` seconds return to the follow target.
 * - setZoom(mult, duration): smooth zoom (phase 5 zooms out to CAMERA.expansionZoom).
 * - shake(intensity, duration): additive screen shake with decay. `target` stays the pure look-at point.
 * - screenToWorldDir: maps screen-space input (x right, y up) to world XZ using the camera yaw.
 *
 * Timing is internal (dt accumulation) so debug simulate() fast-forward works.
 */
import * as THREE from 'three';
import { CAMERA } from '../config';
import { Ease } from '../core/Tween';
import { clamp } from '../core/math';

type FocusPhase = 'none' | 'in' | 'hold' | 'out';

const DEFAULT_FOCUS_DURATION = 0.9;
const DEFAULT_FOCUS_HOLD = 0.8;

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

  // focus state machine
  private focusPhase: FocusPhase = 'none';
  private focusObj: THREE.Object3D | null = null;
  private readonly focusPoint = new THREE.Vector3();
  private readonly focusFrom = new THREE.Vector3();
  private focusDuration = DEFAULT_FOCUS_DURATION;
  private focusHold = DEFAULT_FOCUS_HOLD;
  private focusT = 0;
  private onArrive: (() => void) | undefined;
  private onReturn: (() => void) | undefined;

  // zoom tween
  private zoomFrom = 1;
  private zoomTo = 1;
  private zoomT = 0;
  private zoomDuration = 0;

  // shake
  private shakeAmp = 0;
  private shakeDur = 0;
  private shakeT = 0;
  private shakeClock = 0;
  private readonly right = new THREE.Vector3();
  private readonly upv = new THREE.Vector3();

  constructor(readonly camera: THREE.OrthographicCamera) {}

  /** Follow `obj` (its world position is read every frame; keep it parented to the scene root). */
  follow(obj: THREE.Object3D | null): void {
    this.followed = obj;
  }

  /** Jump the look-at point to the follow target immediately (cancels focus + shake). */
  snapToTarget(): void {
    this.focusPhase = 'none';
    this.shakeAmp = 0;
    if (this.followed) this.target.copy(this.followed.position);
    this.place();
  }

  /**
   * Cinematic pan to a world point, or track an Object3D (re-read every frame, e.g. the floating giant log),
   * hold there, then return to the follow target. `hold: Infinity` stays until releaseFocus().
   */
  focus(
    point: THREE.Vector3 | THREE.Object3D,
    opts?: { duration?: number; hold?: number; onArrive?: () => void; onReturn?: () => void },
  ): void {
    if ((point as THREE.Object3D).isObject3D) {
      this.focusObj = point as THREE.Object3D;
      this.focusPoint.copy(this.focusObj.position);
    } else {
      this.focusObj = null;
      this.focusPoint.copy(point as THREE.Vector3);
    }
    this.focusPoint.y = 0;
    this.focusFrom.copy(this.target);
    this.focusDuration = Math.max(0, opts?.duration ?? DEFAULT_FOCUS_DURATION);
    this.focusHold = opts?.hold ?? DEFAULT_FOCUS_HOLD;
    this.onArrive = opts?.onArrive;
    this.onReturn = opts?.onReturn;
    this.focusT = 0;
    this.focusPhase = 'in';
  }

  /** End a focus early: pan back to the follow target now. */
  releaseFocus(): void {
    if (this.focusPhase === 'none' || this.focusPhase === 'out') return;
    this.focusFrom.copy(this.target);
    this.focusT = 0;
    this.focusPhase = 'out';
  }

  /** Smoothly change zoom (1 = default, <1 shows more of the world). */
  setZoom(mult: number, duration = 1): void {
    this.zoomFrom = this.zoom;
    this.zoomTo = mult;
    this.zoomT = 0;
    this.zoomDuration = Math.max(0, duration);
    if (this.zoomDuration === 0) {
      this.zoom = mult;
      this.applyFrustum();
    }
  }

  /** Additive screen shake: `intensity` in world units (0.05 subtle … 0.5 heavy), decays over `duration`. */
  shake(intensity = 0.3, duration = 0.3): void {
    const remaining = this.shakeDur > 0 ? this.shakeAmp * Math.pow(1 - clamp(this.shakeT / this.shakeDur, 0, 1), 2) : 0;
    if (intensity < remaining) return;
    this.shakeAmp = intensity;
    this.shakeDur = Math.max(0.01, duration);
    this.shakeT = 0;
  }

  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.aspect = width / Math.max(1, height);
    this.applyFrustum();
  }

  update(dt: number): void {
    this.updateZoom(dt);
    this.updateTarget(dt);
    if (this.shakeAmp > 0) {
      this.shakeT += dt;
      this.shakeClock += dt;
      if (this.shakeT >= this.shakeDur) this.shakeAmp = 0;
    }
    this.place();
  }

  private updateZoom(dt: number): void {
    if (this.zoom === this.zoomTo) return;
    this.zoomT += dt;
    const k = this.zoomDuration <= 0 ? 1 : Math.min(1, this.zoomT / this.zoomDuration);
    this.zoom = k >= 1 ? this.zoomTo : this.zoomFrom + (this.zoomTo - this.zoomFrom) * Ease.sineInOut(k);
    this.applyFrustum();
  }

  private updateTarget(dt: number): void {
    const f = this.followed;
    switch (this.focusPhase) {
      case 'none':
        if (f) {
          const k = 1 - Math.exp(-CAMERA.followLambda * dt);
          this.target.x += (f.position.x - this.target.x) * k;
          this.target.y += (f.position.y - this.target.y) * k;
          this.target.z += (f.position.z - this.target.z) * k;
        }
        break;
      case 'in': {
        if (this.focusObj) this.focusPoint.copy(this.focusObj.position).setY(0);
        this.focusT += dt;
        const k = this.focusDuration <= 0 ? 1 : Math.min(1, this.focusT / this.focusDuration);
        this.target.lerpVectors(this.focusFrom, this.focusPoint, Ease.cubicInOut(k));
        if (k >= 1) {
          this.focusPhase = 'hold';
          this.focusT = 0;
          const cb = this.onArrive;
          this.onArrive = undefined;
          cb?.();
        }
        break;
      }
      case 'hold':
        if (this.focusObj) this.focusPoint.copy(this.focusObj.position).setY(0);
        this.target.copy(this.focusPoint);
        this.focusT += dt;
        if (this.focusT >= this.focusHold) this.releaseFocus();
        break;
      case 'out': {
        this.focusT += dt;
        const k = this.focusDuration <= 0 ? 1 : Math.min(1, this.focusT / this.focusDuration);
        if (f) this.target.lerpVectors(this.focusFrom, f.position, Ease.cubicInOut(k));
        if (k >= 1 || !f) {
          this.focusPhase = 'none';
          this.focusObj = null;
          const cb = this.onReturn;
          this.onReturn = undefined;
          cb?.();
        }
        break;
      }
    }
  }

  private applyFrustum(): void {
    const z = Math.max(0.05, this.zoom);
    let h = CAMERA.viewHeight / z;
    if (h * this.aspect < CAMERA.minViewWidth / z) h = CAMERA.minViewWidth / z / this.aspect;
    const w = h * this.aspect;
    const c = this.camera;
    c.left = -w / 2;
    c.right = w / 2;
    c.top = h / 2;
    c.bottom = -h / 2;
    c.updateProjectionMatrix();
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
    if (this.shakeAmp > 0) {
      const life = 1 - clamp(this.shakeT / this.shakeDur, 0, 1);
      const a = this.shakeAmp * life * life;
      const t = this.shakeClock;
      // camera-space right/up from the camera quaternion (no allocation)
      this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.upv.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const sx = (Math.sin(t * 71.3) + 0.6 * Math.sin(t * 43.1 + 1.7)) * 0.625 * a;
      const sy = (Math.sin(t * 59.7 + 0.9) + 0.6 * Math.sin(t * 37.9 + 2.3)) * 0.625 * a;
      this.camera.position.addScaledVector(this.right, sx).addScaledVector(this.upv, sy);
    }
    // HUD projects world anchors before render: keep the view matrix current.
    this.camera.updateMatrixWorld();
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
