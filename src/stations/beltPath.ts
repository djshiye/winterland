/**
 * [B6 — machines] Conveyor waypoint spline: a polyline through the waypoints with the corners
 * rounded by quadratic fillets. Pure math (no three.js scene objects) so both the conveyor model
 * (assets/machines.ts) and the belt station can sample the same curve.
 */
import type { XZ } from '../config';

export interface BeltSample {
  x: number;
  z: number;
  /** Travel direction as a yaw: atan2(dirX, dirZ) (rotation.y that makes +Z face along the belt). */
  yaw: number;
  /** Unit travel direction. */
  dx: number;
  dz: number;
}

/** Longest fillet radius at a corner (limited to half of the adjoining segments). */
const MAX_FILLET = 0.9;
const FILLET_STEPS = 8;

export class BeltPath {
  /** Dense polyline (x, z pairs). */
  private readonly px: number[] = [];
  private readonly pz: number[] = [];
  /** Cumulative arclength at every vertex. */
  private readonly cum: number[] = [];
  readonly length: number;

  constructor(waypoints: readonly XZ[], fillet = MAX_FILLET) {
    const pts: XZ[] = [];
    const n = waypoints.length;
    for (let i = 0; i < n; i++) {
      const p = waypoints[i]!;
      if (i === 0 || i === n - 1) {
        pts.push({ x: p.x, z: p.z });
        continue;
      }
      const a = waypoints[i - 1]!;
      const b = waypoints[i + 1]!;
      const la = Math.hypot(a.x - p.x, a.z - p.z);
      const lb = Math.hypot(b.x - p.x, b.z - p.z);
      const r = Math.min(fillet, la * 0.5, lb * 0.5);
      if (r < 1e-3 || la < 1e-6 || lb < 1e-6) {
        pts.push({ x: p.x, z: p.z });
        continue;
      }
      const ex = p.x + ((a.x - p.x) / la) * r;
      const ez = p.z + ((a.z - p.z) / la) * r;
      const fx = p.x + ((b.x - p.x) / lb) * r;
      const fz = p.z + ((b.z - p.z) / lb) * r;
      for (let k = 0; k <= FILLET_STEPS; k++) {
        const t = k / FILLET_STEPS;
        const u = 1 - t;
        pts.push({
          x: u * u * ex + 2 * u * t * p.x + t * t * fx,
          z: u * u * ez + 2 * u * t * p.z + t * t * fz,
        });
      }
    }
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i > 0) {
        const d = Math.hypot(p.x - this.px[this.px.length - 1]!, p.z - this.pz[this.pz.length - 1]!);
        if (d < 1e-6) continue;
        acc += d;
      }
      this.px.push(p.x);
      this.pz.push(p.z);
      this.cum.push(acc);
    }
    this.length = acc;
  }

  /** Number of polyline vertices. */
  get vertexCount(): number {
    return this.px.length;
  }

  /** Position, direction and yaw at arclength `s` (clamped to the path). */
  sample(s: number, out: BeltSample): BeltSample {
    const cum = this.cum;
    const last = cum.length - 1;
    const c = s < 0 ? 0 : s > this.length ? this.length : s;
    // binary search for the segment [i, i+1]
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= c) lo = mid;
      else hi = mid;
    }
    const i = Math.min(lo, last - 1);
    const segLen = cum[i + 1]! - cum[i]!;
    const t = segLen > 1e-9 ? (c - cum[i]!) / segLen : 0;
    const x0 = this.px[i]!;
    const z0 = this.pz[i]!;
    const x1 = this.px[i + 1]!;
    const z1 = this.pz[i + 1]!;
    const inv = segLen > 1e-9 ? 1 / segLen : 0;
    out.dx = (x1 - x0) * inv;
    out.dz = (z1 - z0) * inv;
    out.x = x0 + (x1 - x0) * t;
    out.z = z0 + (z1 - z0) * t;
    out.yaw = Math.atan2(out.dx, out.dz);
    return out;
  }

  /** New sample record. */
  static makeSample(): BeltSample {
    return { x: 0, z: 0, yaw: 0, dx: 0, dz: 1 };
  }
}
