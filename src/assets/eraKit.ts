/**
 * 0.9.0 era model kit: a small parametric helper shared by assets/eraMachines.ts (and usable by other era assets).
 *
 * - `Kit`: a `Batch` (render/batch.ts) with a transform stack and the primitives era models need. Conventions: boxes,
 *   cylinders and cones take the Y of their BOTTOM face (stack parts by passing the previous top); spheres, tori and
 *   `beam` are centred. Everything is merged into one vertex-coloured geometry.
 * - `eraGlowMaterial()`: ONE shared emissive material for every era window / lamp / neon strip. Its emissive colour is
 *   multiplied by the vertex colour (a tiny shader patch), so warm amber windows, mint holo panels and sun-gold AI cores
 *   all live on the same material and the night-glow registry (world/env/glow.ts) lifts all of them at once.
 *   Never write its `emissiveIntensity` per frame: `updateGlow` owns it.
 * - `pixelText()`: blocky 3 × 5 pixel letters (E X P O R T I M …) as boxes, for the EXPORT / IMPORT signs.
 */
import * as THREE from 'three';
import { Batch } from '../render/batch';
import { toonUnique } from '../render/materials';
import { SNOW as PALETTE_SNOW, SNOW_SHADE } from '../render/palette';
import { registerGlow } from '../world/env/glow';

/** Snow colours (render/palette.ts). */
export const SNOW = PALETTE_SNOW;
export const SNOW_SH = SNOW_SHADE;

// ---------------------------------------------------------------------------
// shared glow material
// ---------------------------------------------------------------------------

let glowMaterial: THREE.MeshToonMaterial | null = null;

/** The shared, night-registered, vertex-colour-tinted emissive material (see file header). */
export function eraGlowMaterial(): THREE.MeshToonMaterial {
  if (!glowMaterial) {
    const m = toonUnique(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.55 });
    m.vertexColors = true;
    m.onBeforeCompile = (shader): void => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
    };
    m.customProgramCacheKey = (): string => 'eraGlowVC';
    glowMaterial = registerGlow(m, 2.6);
  }
  return glowMaterial;
}

// ---------------------------------------------------------------------------
// geometry cache
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Optional rotation (radians, XYZ order) and scale for a part. */
export interface Rot {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export type V3 = readonly [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** A merge-batch with a nestable transform stack and primitives (see file header for the Y conventions). */
export class Kit {
  readonly batch = new Batch();
  private base = new THREE.Matrix4();
  private readonly L = new THREE.Matrix4();
  private readonly W = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();

  /** Run `fn` with everything translated to (x, 0, z) and yawed by `yaw` (nestable). */
  at(x: number, z: number, yaw: number, fn: () => void): void {
    const saved = this.base.clone();
    this.base.multiply(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z));
    fn();
    this.base.copy(saved);
  }

  /** Add any (cached) geometry at a position with optional rotation / scale. */
  add(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o?: Rot): void {
    this.e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0);
    this.q.setFromEuler(this.e);
    this.s.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    this.p.set(x, y, z);
    this.L.compose(this.p, this.q, this.s);
    this.W.multiplyMatrices(this.base, this.L);
    this.batch.addMatrix(g, color, this.W);
  }

  /** Box with its bottom face at `y` (rotations pivot around the box centre). */
  box(color: number, w: number, h: number, d: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), color, x, y + h / 2, z, o);
  }

  /** Cylinder (optionally tapered: top radius `rt`) with its bottom at `y`. */
  cyl(color: number, r: number, h: number, x: number, y: number, z: number, seg = 10, rt = r, o?: Rot): void {
    this.add(cached(`c${r}|${rt}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, r, h, seg)), color, x, y + h / 2, z, o);
  }

  /** Cone with its bottom at `y`. */
  cone(color: number, r: number, h: number, x: number, y: number, z: number, seg = 8, o?: Rot): void {
    this.add(cached(`k${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), color, x, y + h / 2, z, o);
  }

  /** Sphere centred at (x, y, z); squash / stretch with o.sx/sy/sz. */
  sph(color: number, r: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`s${r}`, () => new THREE.SphereGeometry(r, 12, 8)), color, x, y, z, o);
  }

  /** Upper half of a sphere (a dome) sitting on y. */
  dome(color: number, r: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`d${r}`, () => new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)), color, x, y, z, o);
  }

  /** Torus centred at (x, y, z) in the XY plane (axis +Z); rotate with o. */
  torus(color: number, r: number, tube: number, x: number, y: number, z: number, o?: Rot, seg = 18): void {
    this.add(cached(`t${r}|${tube}|${seg}`, () => new THREE.TorusGeometry(r, tube, 6, seg)), color, x, y, z, o);
  }

  /** Surface of revolution through (radius, height) points, bottom at `y`. */
  lathe(color: number, pts: readonly (readonly [number, number])[], x: number, y: number, z: number, seg = 14): void {
    this.add(cached(`l${pts.join(',')}|${seg}`, () => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg)), color, x, y, z);
  }

  /** Square-section strut from a to b, `t` thick (lattice legs, braces, pipes, crane booms, cables). */
  beam(color: number, a: V3, b: V3, t = 0.12): void {
    this.p.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = this.p.length();
    if (len < 1e-4) return;
    this.q.setFromUnitVectors(UP, this.p.divideScalar(len));
    this.p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.s.set(1, 1, 1);
    this.L.compose(this.p, this.q, this.s);
    this.W.multiplyMatrices(this.base, this.L);
    this.batch.addMatrix(cached(`m${t}|${len.toFixed(3)}`, () => new THREE.BoxGeometry(t, len, t)), color, this.W);
  }

  /** Polygon in the XY plane extruded along +Z from `z` by `depth`. */
  prismXY(color: number, pts: readonly (readonly [number, number])[], depth: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`px${pts.join(',')}|${depth}`, () => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth, bevelEnabled: false })), color, x, y, z, o);
  }

  /** Thin snow layer on a roof or ledge: top at y + h. */
  snow(x: number, y: number, z: number, w: number, d: number, h = 0.1): void {
    this.box(SNOW, w, h, d, x, y, z);
  }

  /**
   * Gable roof, ridge along X, centred at (cx, cz): slabs + snow caps + two gable triangles. `len` along X, `wid` across
   * the slopes, eave at `y`, `rise` high. Overhang `over` on every side.
   */
  gable(cx: number, cz: number, y: number, len: number, wid: number, rise: number, roofA: number, roofB: number, gableC: number, over = 0.18): void {
    this.at(cx, cz, 0, () => {
      const run = wid / 2 + over;
      const ang = Math.atan2(rise, run);
      const slope = Math.hypot(run, rise);
      const l = len + over * 2;
      for (const s of [-1, 1]) {
        const cy = y + rise / 2 + 0.02;
        this.add(cached(`b${l}|0.12|${slope.toFixed(3)}`, () => new THREE.BoxGeometry(l, 0.12, slope)), s > 0 ? roofA : roofB, 0, cy, (s * run) / 2, { rx: s * ang });
        this.add(cached(`b${l - 0.1}|0.14|${(slope - 0.35).toFixed(3)}`, () => new THREE.BoxGeometry(l - 0.1, 0.14, slope - 0.35)), SNOW, 0, cy + 0.13, (s * run) / 2 - s * 0.12, { rx: s * ang });
      }
      this.box(SNOW, l, 0.12, 0.26, 0, y + rise, 0);
      const t = 0.16;
      const pts: [number, number][] = [[-wid / 2, 0], [wid / 2, 0], [0, rise - 0.04]];
      for (const s of [-1, 1]) {
        this.add(
          cached(`gb${wid}|${rise}|${t}`, () =>
            new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth: t, bevelEnabled: false }).rotateY(Math.PI / 2),
          ),
          gableC,
          s > 0 ? len / 2 - t : -len / 2,
          y,
          0,
        );
      }
    });
  }

  /** Window: a glowing pane in the glow kit `g` and a frame in this kit. `ry` = outward yaw (0 = +Z, PI/2 = +X). */
  window(g: Kit, color: number, frame: number, x: number, y: number, z: number, w: number, h: number, ry = 0): void {
    const dx = Math.sin(ry);
    const dz = Math.cos(ry);
    this.box(frame, w + 0.14, h + 0.14, 0.06, x, y - 0.07, z, { ry });
    g.box(color, w, h, 0.05, x + dx * 0.04, y, z + dz * 0.04, { ry });
  }

  geometry(): THREE.BufferGeometry {
    return this.batch.geometry();
  }
}

// ---------------------------------------------------------------------------
// pixel text
// ---------------------------------------------------------------------------

const FONT: Record<string, readonly string[]> = {
  E: ['111', '100', '110', '100', '111'],
  X: ['101', '101', '010', '101', '101'],
  P: ['110', '101', '110', '100', '100'],
  O: ['111', '101', '101', '101', '111'],
  R: ['110', '101', '110', '101', '101'],
  T: ['111', '010', '010', '010', '010'],
  I: ['111', '010', '010', '010', '111'],
  M: ['101', '111', '111', '101', '101'],
};

/** Width in metres of `text` at pixel size `px`. */
export function pixelTextWidth(text: string, px: number): number {
  return (text.length * 4 - 1) * px;
}

/** Blocky pixel `text` in the XY plane facing +Z, centred on x, base at y, `depth` thick; into `k`. */
export function pixelText(k: Kit, text: string, color: number, px: number, x: number, y: number, z: number, depth = 0.05): void {
  const x0 = x - pixelTextWidth(text, px) / 2 + px / 2;
  for (let i = 0; i < text.length; i++) {
    const rows = FONT[text[i]!];
    if (!rows) continue;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (rows[r]![c] === '1') k.box(color, px * 0.96, px * 0.96, depth, x0 + (i * 4 + c) * px, y + (4 - r) * px, z);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// reusable structures
// ---------------------------------------------------------------------------

/** Cylinder lying along `axis`, centred at (x, yc, z). */
export function hcyl(k: Kit, color: number, r: number, len: number, x: number, yc: number, z: number, axis: 'x' | 'z' = 'x', seg = 10): void {
  k.cyl(color, r, len, x, yc - len / 2, z, seg, r, axis === 'x' ? { rz: Math.PI / 2 } : { rx: Math.PI / 2 });
}

/** Spoked wheel centred at (cx, cy, cz) whose disc faces `axis` (the axle direction): rim torus, hub and spokes. */
export function wheel(k: Kit, axis: 'x' | 'z', color: number, hub: number, cx: number, cy: number, cz: number, r: number, tube = 0.08, spokes = 6): void {
  k.torus(color, r, tube, cx, cy, cz, axis === 'x' ? { ry: Math.PI / 2 } : undefined, 16);
  hcyl(k, hub, tube * 1.6, tube * 3, cx, cy, cz, axis, 8);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    if (axis === 'z') k.beam(color, [cx - dx, cy - dy, cz], [cx + dx, cy + dy, cz], tube * 0.8);
    else k.beam(color, [cx, cy - dy, cz - dx], [cx, cy + dy, cz + dx], tube * 0.8);
  }
}

/** Horizontal rotor (fan / turbine / radar blades) centred at (cx, cy, cz). */
export function rotor(k: Kit, color: number, hub: number, cx: number, cy: number, cz: number, r: number, blades = 4): void {
  k.cyl(hub, r * 0.2, 0.14, cx, cy - 0.07, cz, 8);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    k.box(color, r * 0.85, 0.04, r * 0.32, cx + Math.cos(a) * r * 0.5, cy, cz - Math.sin(a) * r * 0.5, { ry: a });
  }
}

/** Four-legged tapering lattice tower (legs, rings and X-braces on every face). */
export function lattice(k: Kit, color: number, cx: number, cz: number, y0: number, h: number, wBase: number, wTop: number, panels = 4, t = 0.12): void {
  const hw = (i: number): number => (wBase + (wTop - wBase) * (i / panels)) / 2;
  const yAt = (i: number): number => y0 + (h * i) / panels;
  const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) k.beam(color, [cx + sx * hw(0), y0, cz + sz * hw(0)], [cx + sx * hw(panels), yAt(panels), cz + sz * hw(panels)], t * 1.5);
  for (let i = 0; i < panels; i++) {
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c]!;
      const [bx, bz] = corners[(c + 1) % 4]!;
      const a0: V3 = [cx + ax * hw(i), yAt(i), cz + az * hw(i)];
      const b0: V3 = [cx + bx * hw(i), yAt(i), cz + bz * hw(i)];
      const a1: V3 = [cx + ax * hw(i + 1), yAt(i + 1), cz + az * hw(i + 1)];
      const b1: V3 = [cx + bx * hw(i + 1), yAt(i + 1), cz + bz * hw(i + 1)];
      k.beam(color, a0, b0, t);
      if (i % 2 === 0) k.beam(color, a0, b1, t * 0.7);
      else k.beam(color, b0, a1, t * 0.7);
    }
  }
  const top = hw(panels);
  for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c]!;
    const [bx, bz] = corners[(c + 1) % 4]!;
    k.beam(color, [cx + ax * top, yAt(panels), cz + az * top], [cx + bx * top, yAt(panels), cz + bz * top], t);
  }
}

/** Tiny deterministic random numbers (mulberry32) so models are identical on every build. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
