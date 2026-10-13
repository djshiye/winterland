/**
 * [B2 — items] Shared damped-spring "lean" used by CarryStack and CashStack.
 *
 * The lean is a 2D offset in the ANCHOR's local XZ plane. It is driven by the carrier's velocity
 * (stack trails behind the motion) and acceleration (stack lags when speeding up / swings forward when
 * braking), then settles with a bouncy overshoot wobble when the carrier stops.
 */
import * as THREE from 'three';

const OMEGA = 15; // spring stiffness (rad/s)
const ZETA = 0.3; // damping ratio (< 1 → overshoot wobble)
const K_VEL = 0.02; // lean per m/s of velocity
const K_ACC = 0.003; // lean per m/s² of acceleration
const MAX_ACC = 140;
const MAX_LEAN = 0.34;
/** Height (m, anchor-local) at which a stack item moves by exactly the lean amount. */
export const SWAY_REF_HEIGHT = 3.6;

export class SwaySpring {
  /** Current lean (anchor-local X / Z). */
  x = 0;
  z = 0;
  private vx = 0;
  private vz = 0;
  private hasPrev = false;
  private readonly prev = new THREE.Vector3();
  private readonly acc = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly inv = new THREE.Quaternion();

  /** Step the spring. `worldVelocity` is the carrier's velocity in world space. */
  update(dt: number, worldVelocity: THREE.Vector3, anchor: THREE.Object3D): void {
    if (dt <= 0) return;
    anchor.getWorldQuaternion(this.inv).invert();
    if (!this.hasPrev) {
      this.prev.copy(worldVelocity);
      this.hasPrev = true;
    }
    this.acc.copy(worldVelocity).sub(this.prev).divideScalar(dt);
    this.prev.copy(worldVelocity);
    const accLen = this.acc.length();
    if (accLen > MAX_ACC) this.acc.multiplyScalar(MAX_ACC / accLen);
    this.acc.applyQuaternion(this.inv);
    this.vel.copy(worldVelocity).applyQuaternion(this.inv);

    const tx = -(this.acc.x * K_ACC + this.vel.x * K_VEL);
    const tz = -(this.acc.z * K_ACC + this.vel.z * K_VEL);

    // Sub-stepped semi-implicit Euler keeps the spring stable at dt = 1/20.
    const steps = Math.ceil(dt / 0.012);
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.vx += (OMEGA * OMEGA * (tx - this.x) - 2 * ZETA * OMEGA * this.vx) * h;
      this.vz += (OMEGA * OMEGA * (tz - this.z) - 2 * ZETA * OMEGA * this.vz) * h;
      this.x += this.vx * h;
      this.z += this.vz * h;
    }
    const len = Math.hypot(this.x, this.z);
    if (len > MAX_LEAN) {
      const k = MAX_LEAN / len;
      this.x *= k;
      this.z *= k;
    }
  }

  /** Horizontal bend profile at anchor-local height `y`: 0 at the base, 1 at SWAY_REF_HEIGHT. */
  static profile(y: number): number {
    const r = y / SWAY_REF_HEIGHT;
    return r <= 0 ? 0 : Math.pow(r, 1.5);
  }

  /** Slope of the profile (rad of tilt per unit lean) at height `y`. */
  static slope(y: number): number {
    const r = y / SWAY_REF_HEIGHT;
    return r <= 0 ? 0 : (1.5 * Math.sqrt(r)) / SWAY_REF_HEIGHT;
  }
}
