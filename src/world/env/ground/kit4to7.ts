/**
 * [0.9.8 — world 10b] A small modelling kit for the era 4-7 grounds and landmarks (world/env/ground/era04..era07.ts):
 * base-anchored boxes / cylinders / cones, lumps, rings and slanted beams merged into ONE vertex-coloured geometry
 * (render/batch.ts), plus the flat ground tiles the era floors are made of (a quad, not a box: a floor of a few
 * thousand cobbles stays light). Colours come from render/palette.ts; the kit only places them.
 */
import * as THREE from 'three';
import { Batch } from '../../../render/batch';
import { geo } from '../../../render/materials';
import { SNOW } from '../../../render/palette';
import type { Rect } from '../../../config';
import type { PlotPlaces, RegionLayout } from '../../../eras/layout';
import type { Rng } from '../common';

const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _e = new THREE.Euler();

/** Flat 1 × 1 quad lying in XZ, facing up (a floor tile: scale it with sx / sz). */
const tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
/** Flat unit disc / hexagon lying in XZ, facing up. */
const discGeo = new THREE.CircleGeometry(0.5, 10).rotateX(-Math.PI / 2);
const hexGeo = new THREE.CircleGeometry(0.5, 6).rotateX(-Math.PI / 2);

export interface Rot {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

/** Modelling kit over Batch. Every position is world (or model) metres; `y0` = the bottom of the part. */
export class Kit {
  /** `b`: the batch parts go into (a GroundKit's floor / solid / glow batch, or a fresh one). */
  constructor(readonly b: Batch = new Batch()) {}

  get empty(): boolean {
    return this.b.empty;
  }

  /** Any cached geometry, centred at (x, y, z). */
  put(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o?: Rot): this {
    this.b.add(g, color, x, y, z, o);
    return this;
  }

  /** Box of w × h × d whose bottom face centre is (x, y0, z). */
  box(w: number, h: number, d: number, color: number, x: number, y0: number, z: number, ry = 0): this {
    this.b.add(geo.box(w, h, d), color, x, y0 + h / 2, z, { ry });
    return this;
  }

  /** Upright cylinder (r at the top, rb at the bottom). */
  cyl(r: number, h: number, color: number, x: number, y0: number, z: number, rb = r, seg = 10): this {
    this.b.add(geo.cylinder(r, rb, h, seg), color, x, y0 + h / 2, z);
    return this;
  }

  /** Cylinder lying along X or Z, centred at (x, y, z). */
  lying(axis: 'x' | 'z', r: number, len: number, color: number, x: number, y: number, z: number, seg = 10): this {
    this.b.add(geo.cylinder(r, r, len, seg), color, x, y, z, axis === 'x' ? { rz: Math.PI / 2 } : { rx: Math.PI / 2 });
    return this;
  }

  cone(r: number, h: number, color: number, x: number, y0: number, z: number, seg = 10, ry = 0): this {
    this.b.add(geo.cone(r, h, seg), color, x, y0 + h / 2, z, { ry });
    return this;
  }

  /** A soft low-poly lump (a rounded stone, a heap), scaled per axis. */
  lump(r: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): this {
    this.b.add(geo.dodecahedron(r, 0), color, x, y, z, { sx, sy, sz, ry });
    return this;
  }

  /** A round ball (pellets, globes, rivets). */
  ball(r: number, color: number, x: number, y: number, z: number, seg = 8, sy = 1): this {
    this.b.add(geo.sphere(r, seg, Math.max(4, Math.round(seg * 0.6))), color, x, y, z, { sy });
    return this;
  }

  /** A flat ring lying in XZ (a torus seen from above), centred at (x, y, z). */
  ring(r: number, tube: number, color: number, x: number, y: number, z: number, seg = 24, sy = 1): this {
    this.b.add(geo.torus(r, tube, 6, seg), color, x, y, z, { rx: Math.PI / 2, sz: sy });
    return this;
  }

  /** Snow on a surface of w × d at height y (a soft rounded slab). */
  cap(w: number, d: number, x: number, y: number, z: number, ry = 0): this {
    return this.box(w, 0.08, d, SNOW, x, y, z, ry);
  }

  /** Square-section beam from a to c. */
  beam(a: readonly [number, number, number], c: readonly [number, number, number], thick: number, color: number): this {
    _a.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const len = _a.length();
    if (len < 1e-4) return this;
    _q.setFromUnitVectors(Y, _a.normalize());
    _v.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
    _s.set(1, 1, 1);
    this.b.addMatrix(geo.box(thick, len, thick), color, _m.compose(_v, _q, _s));
    return this;
  }

  /** A flat floor tile w × d at height y (turned by ry). */
  tile(w: number, d: number, color: number, x: number, y: number, z: number, ry = 0): this {
    _e.set(0, ry, 0);
    _q.setFromEuler(_e);
    _v.set(x, y, z);
    _s.set(w, 1, d);
    this.b.addMatrix(tileGeo, color, _m.compose(_v, _q, _s));
    return this;
  }

  /** A flat disc (r) or hexagon at height y. */
  disc(r: number, color: number, x: number, y: number, z: number, sz = 1, ry = 0, hex = false): this {
    _e.set(0, ry, 0);
    _q.setFromEuler(_e);
    _v.set(x, y, z);
    _s.set(r * 2, 1, r * 2 * sz);
    this.b.addMatrix(hex ? hexGeo : discGeo, color, _m.compose(_v, _q, _s));
    return this;
  }

  /** A sagging cable from a to c (sag metres at the middle), as `seg` thin beams. */
  cable(a: readonly [number, number, number], c: readonly [number, number, number], sag: number, thick: number, color: number, seg = 6): this {
    let prev: [number, number, number] = [a[0], a[1], a[2]];
    for (let s = 1; s <= seg; s++) {
      const u = s / seg;
      const cur: [number, number, number] = [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (c[2] - a[2]) * u];
      this.beam(prev, cur, thick, color);
      prev = cur;
    }
    return this;
  }

  geometry(): THREE.BufferGeometry {
    return this.b.geometry();
  }

  mesh(opts: { cast?: boolean; receive?: boolean; material?: THREE.Material } = {}): THREE.Mesh {
    return this.b.mesh({ cast: opts.cast ?? true, receive: opts.receive ?? true, ...(opts.material ? { material: opts.material } : {}) });
  }
}

/** Points along a sagging cable (for bulbs hung on it). */
export function cablePoints(a: readonly [number, number, number], c: readonly [number, number, number], sag: number, n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 1; i < n; i++) {
    const u = i / n;
    out.push([a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (c[2] - a[2]) * u]);
  }
  return out;
}


// ---------------------------------------------------------------------------------------------------------------------
// layout helpers shared by the era 4-7 grounds (pure; positions come from eras/layout.ts, never hard-coded)
// ---------------------------------------------------------------------------------------------------------------------

/** A solid an era ground adds (footprint + height), for the R22 "hides nothing from the camera" test. */
export interface GroundSolid {
  what: string;
  r: Rect;
  h: number;
}

export const inRect = (q: Rect, x: number, z: number, m = 0): boolean => x > q.minX - m && x < q.maxX + m && z > q.minZ - m && z < q.maxZ + m;
export const hitAny = (rs: readonly Rect[], x: number, z: number, m = 0): boolean => rs.some((q) => inRect(q, x, z, m));
export const around = (x: number, z: number, hx: number, hz = hx): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
export const grown = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
/** A rect trimmed to fit inside another (keep-outs never claim ground outside their region). */
export const clip = (r: Rect, o: Rect): Rect => ({ minX: Math.max(r.minX, o.minX), maxX: Math.min(r.maxX, o.maxX), minZ: Math.max(r.minZ, o.minZ), maxZ: Math.min(r.maxZ, o.maxZ) });

/** The front-yard band between the gate edge and the yard path (where the depot, dock, Jack and shop mat stand). */
export function yardBand(l: RegionLayout): Rect {
  const Y = l.zones.yard;
  const north = l.inward > 0;
  const edge = north ? Y.minZ : Y.maxZ;
  const pathEdge = (north ? Y.maxZ : Y.minZ) - l.inward * 1.15;
  const a = edge + l.inward * 0.5;
  return { minX: Y.minX + 0.6, maxX: Y.maxX - 0.6, minZ: Math.min(a, pathEdge), maxZ: Math.max(a, pathEdge) };
}

/** Lamp / pole spots: on the processing side of the yard path, on the machine-cell boundaries, clear of the gate. */
export function pathPoles(l: RegionLayout): { x: number; z: number }[] {
  const Y = l.zones.yard;
  const z = (l.inward > 0 ? Y.maxZ : Y.minZ) + l.inward * 1.65;
  const out: { x: number; z: number }[] = [];
  for (let k = -4; k <= 4; k++) {
    const x = l.gate.x + (k + 0.5) * l.cell;
    if (x > Y.minX + 1.5 && x < Y.maxX - 1.5 && Math.abs(x - l.gate.x) > 3) out.push({ x, z });
  }
  return out;
}

/** The machine cells marked on a processing floor (thin lines on the room grid, as plots.ts drew them). */
export function cellMarks(k: Kit, l: RegionLayout, P: PlotPlaces, color: number, y = 0.036, w = 0.1): void {
  const Y = P.yardPave;
  for (let x = Y.minX; x <= Y.maxX + 0.01; x += l.cell) k.tile(w, Y.maxZ - Y.minZ - 0.6, color, Math.min(x, Y.maxX - 0.05), y, (Y.minZ + Y.maxZ) / 2);
  for (let z = Y.minZ + 0.5; z <= Y.maxZ + 0.01; z += l.rowPitch) k.tile(Y.maxX - Y.minX - 0.6, w, color, (Y.minX + Y.maxX) / 2, y, Math.min(z, Y.maxZ - 0.05));
}

/** Spots along the west fence for the tree belt (step metres apart), off the paths and the keep-out rects. */
export function beltSpots(l: RegionLayout, paths: readonly Rect[], keep: readonly Rect[], step = 4.2, inset = 1.7): { x: number; z: number }[] {
  const r = l.rect;
  const out: { x: number; z: number }[] = [];
  for (let z = r.minZ + 2.4; z < r.maxZ - 1.8; z += step) {
    const x = r.minX + inset;
    if (hitAny(paths, x, z, 1.4) || hitAny(keep, x, z, 1.2)) continue;
    out.push({ x, z });
  }
  return out;
}

/** Seeded spots inside the harvest zone, clear of the field, the hand node, the paths, the keep-outs and each other. */
export function harvestSpots(l: RegionLayout, P: PlotPlaces, avoid: readonly Rect[], rng: Rng, count: number, rad: number, taken: { x: number; z: number; r: number }[] = []): { x: number; z: number }[] {
  const H = l.zones.harvest;
  const out: { x: number; z: number }[] = [];
  for (let t = 0; t < 600 && out.length < count; t++) {
    const x = rng.range(H.minX + rad + 1.4, H.maxX - rad - 1);
    const z = rng.range(H.minZ + rad + 1.4, H.maxZ - rad - 1);
    if (inRect(P.field, x, z, rad + 0.4) || hitAny(avoid, x, z, rad + 0.3)) continue;
    if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + rad + 0.3)) continue;
    taken.push({ x, z, r: rad });
    out.push({ x, z });
  }
  return out;
}
