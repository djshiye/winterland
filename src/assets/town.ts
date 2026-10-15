/**
 * [T1 — assets] Wave 9 Market Town models (procedural). Every building is built once per id from primitives,
 * baked into ONE vertex-coloured body mesh, ONE glow mesh (lit windows / oven, emissive material registered with
 * the night-glow registry) and at most ONE animated pivot mesh (windmill sails, swinging sign, spinning gear), and
 * the geometry is cached, so any number of buildings of one kind share GPU buffers.
 *
 * CONTRACT (T1 owns the implementation; town/Business.ts + town/Town.ts use it):
 * - Local frame: origin on the ground at the LOT CENTRE, the FRONT (door, shop window) faces local +Z. Town rotates
 *   the model so +Z points along the lot's `face`. The body sits toward the back of the lot: it spans
 *   z in [-1.9, +0.9] (a ~1 m strip in front stays clear for the hopper / counter / pallet) and x in [-1.9, +1.9],
 *   so `w` x `d` = 3.8 x 2.8 (footprint <= LAYOUT.town.lotSize - 0.6). Roof overhangs stay inside that box.
 * - BusinessModel.animate(dt, working): animated parts (farm windmill sails turn while working, bakery oven glow
 *   pulses + pretzel sign swings, butcher hams sway, toy factory gear spins); idle = slow / still. No allocation.
 * - chimney: local chimney-mouth position (smoke source) or null.
 * - glow: the mesh(es) that glow at night. NOTHING needs to be registered by the caller: this file registers its own
 *   emissive materials with world/env/glow.ts `registerGlow` (three of them: the shared warm window material, which is
 *   the same cached material the village shelters use; a vertex-coloured pale one for the greenhouse / skylights; and
 *   a vertex-coloured pulsing oven one for the bakery). `glow` is informational.
 * - Draw calls: a building <= 3 meshes (body + glow + pivot); props 1 mesh; lot 1 mesh; scaffold 1 mesh.
 */
import * as THREE from 'three';
import { COLORS, PALETTE, type BusinessId } from '../config';
import { Batch, vcMat } from '../render/batch';
import { toon, toonUnique } from '../render/materials';
import { registerGlow } from '../world/env/glow';

export interface BusinessModel {
  readonly root: THREE.Group;
  /** Footprint (local X × Z) in metres. */
  readonly w: number;
  readonly d: number;
  /** Local chimney mouth (smoke) or null. */
  readonly chimney: THREE.Vector3 | null;
  /** Meshes that glow at night (window panes, oven mouth). */
  readonly glow: THREE.Mesh[];
  animate(dt: number, working: boolean): void;
}

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

const SNOW = COLORS.SNOW_WHITE;
const SNOW_SH = PALETTE.snowShade;
const WARM = 0xffd978;
const CREAM = 0xf3e6c8;
const PLASTER = 0xf2e2bd;
const TIMBER = 0x6b4226;
const DOOR_DARK = 0x5a3820;
const BARN_RED = 0xb8372b;
const BARN_RED_D = 0x8e281f;
const SLATE = 0x5c6877;
const SLATE_D = 0x49535f;
const BRICK = 0xa8452f;
const BRICK_D = 0x853524;
const STONE = PALETTE.rock;
const STONE_D = PALETTE.rockDark;
const GLASS = 0x8fd4c4;
const LEAF = 0x3fbf4f;
const LEAF_L = 0x8be46f;
const HAY = 0xe4c46a;
const BRASS = 0xe0a93a;
const BRASS_D = 0xb07a2a;
const IRON = 0x3b3f47;

// ---------------------------------------------------------------------------
// materials (glow materials are registered once with the night-glow registry)
// ---------------------------------------------------------------------------

let warmGlow: THREE.MeshToonMaterial | null = null;
/** Same cached material (same colour + options, same key order) the shelters use for their windows. */
function glowMat(): THREE.MeshToonMaterial {
  warmGlow ??= registerGlow(toon(WARM, { emissive: 0xffb347, emissiveIntensity: 0.65 }));
  return warmGlow;
}

let paleGlow: THREE.MeshToonMaterial | null = null;
/** Glass-like panes (greenhouse, sawtooth skylights): pale by day, warm-bright at night. */
function paleMat(): THREE.MeshToonMaterial {
  if (!paleGlow) {
    // unique (not the shared cached material) so vertex colours can tint the panes / leaf rows
    const m = toonUnique(0xffffff, { emissive: 0xe8f0b8, emissiveIntensity: 0.22 });
    m.vertexColors = true;
    paleGlow = registerGlow(m);
  }
  return paleGlow;
}

let ovenGlow: THREE.MeshToonMaterial | null = null;
/** Bakery window + oven: its own material so the pulse (emissive colour) never touches the village windows. */
function ovenMat(): THREE.MeshToonMaterial {
  if (!ovenGlow) {
    const m = toonUnique(0xffffff, { emissive: 0xffa040, emissiveIntensity: 0.8 });
    m.vertexColors = true; // window panes (WARM) and the oven mouth (orange) differ by vertex colour
    ovenGlow = registerGlow(m);
    ovenGlow.emissive.setRGB(1, 0.62, 0.25);
  }
  return ovenGlow;
}

// ---------------------------------------------------------------------------
// Kit: a Batch with a transform stack and the handful of primitives the models need
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

interface Rot {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

class Kit {
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

  add(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o?: Rot): void {
    this.e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0);
    this.q.setFromEuler(this.e);
    this.s.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    this.p.set(x, y, z);
    this.L.compose(this.p, this.q, this.s);
    this.W.multiplyMatrices(this.base, this.L);
    this.batch.addMatrix(g, color, this.W);
  }

  box(color: number, w: number, h: number, d: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), color, x, y, z, o);
  }

  cyl(color: number, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 8, o?: Rot): void {
    this.add(cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), color, x, y, z, o);
  }

  cone(color: number, r: number, h: number, x: number, y: number, z: number, seg = 8, o?: Rot): void {
    this.add(cached(`k${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), color, x, y, z, o);
  }

  /** Sphere of radius r; squash / stretch with o.sx/sy/sz. */
  sph(color: number, r: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`s${r}`, () => new THREE.SphereGeometry(r, 10, 7)), color, x, y, z, o);
  }

  /** Torus in the XY plane (facing +Z); rotate with o. */
  torus(color: number, r: number, tube: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`t${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, 6, 14)), color, x, y, z, o);
  }

  /** Polygon in the XY plane extruded along +Z by `depth` (starts at z). */
  prismXY(color: number, pts: readonly (readonly [number, number])[], depth: number, x: number, y: number, z: number, o?: Rot): void {
    const key = `px${pts.join(',')}|${depth}`;
    this.add(
      cached(key, () => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth, bevelEnabled: false })),
      color,
      x,
      y,
      z,
      o,
    );
  }

  /** Polygon in the (z, y) plane extruded along X from x0 to x1. */
  prismZY(color: number, pts: readonly (readonly [number, number])[], x0: number, x1: number): void {
    const depth = x1 - x0;
    const key = `pz${pts.join(',')}|${depth}`;
    const g = cached(key, () =>
      new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth, bevelEnabled: false }).rotateY(-Math.PI / 2),
    );
    this.add(g, color, x1, 0, 0);
  }

  /**
   * Gable roof, ridge along local X, centred on (cx, cz) with yaw. `len` = ridge length of the walls, `wid` = wall
   * width across the slopes. Slabs + thick snow caps + ridge snow + two gable triangles flush with the wall ends.
   */
  roof(cx: number, cz: number, yaw: number, len: number, wid: number, eaveY: number, rise: number, cA: number, cB: number, gableC: number, over = 0.22): void {
    this.at(cx, cz, yaw, () => {
      const run = wid / 2 + over;
      const ang = Math.atan2(rise, run);
      const slope = Math.hypot(run, rise) + 0.08;
      const l = len + over * 2;
      for (const s of [-1, 1]) {
        const cy = eaveY + rise / 2;
        const z = (s * run) / 2;
        this.box(s > 0 ? cA : cB, l, 0.14, slope, 0, cy, z, { rx: s * ang });
        this.box(SNOW, l - 0.2, 0.16, slope - 0.45, 0, cy + 0.15 + 0.1 * Math.cos(ang), z - s * 0.2 * Math.cos(ang), { rx: s * ang });
        // drooping snow lip along the eave
        this.box(SNOW_SH, l - 0.1, 0.1, 0.12, 0, eaveY - 0.03, s * (run - 0.08), {});
      }
      this.box(SNOW, l + 0.02, 0.13, 0.28, 0, eaveY + rise + 0.12, 0);
      const t = 0.2;
      const pts: [number, number][] = [[-wid / 2, 0], [wid / 2, 0], [0, rise - 0.03]];
      for (const s of [-1, 1]) {
        // triangle in XY extruded along +Z, then turned so its thickness runs along X
        this.add(
          cached(`gb${wid}|${rise}|${t}`, () =>
            new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth: t, bevelEnabled: false }).rotateY(Math.PI / 2),
          ),
          gableC,
          s > 0 ? len / 2 - t : -len / 2,
          eaveY,
          0,
        );
      }
    });
  }

  geometry(): THREE.BufferGeometry {
    return this.batch.geometry();
  }
}

// ---------------------------------------------------------------------------
// shared building blocks
// ---------------------------------------------------------------------------

/** Framed window: frame + sill + snow cap in `k`, glowing pane in `g`. `ry` = outward yaw (0 = +Z, PI/2 = +X). */
function windowAt(k: Kit, g: Kit, x: number, y: number, z: number, ry: number, w = 0.46, h = 0.42, frame = CREAM, cross = true): void {
  k.box(frame, w + 0.16, h + 0.16, 0.08, x, y, z, { ry });
  const dx = Math.sin(ry);
  const dz = Math.cos(ry);
  g.box(WARM, w, h, 0.06, x + dx * 0.04, y, z + dz * 0.04, { ry });
  if (cross) {
    k.box(frame, 0.04, h, 0.03, x + dx * 0.075, y, z + dz * 0.075, { ry });
    k.box(frame, w, 0.04, 0.03, x + dx * 0.075, y, z + dz * 0.075, { ry });
  }
  // sill + snow
  k.box(SNOW, w + 0.2, 0.05, 0.14, x + dx * 0.08, y + h / 2 + 0.1, z + dz * 0.08, { ry });
}

function snowMound(k: Kit, x: number, z: number, r = 0.3, sy = 0.4): void {
  // keep the drift inside the 3.8 x 2.8 footprint
  const cx = Math.max(-1.9 + r, Math.min(1.9 - r, x));
  const cz = Math.max(-1.9 + r, Math.min(0.9 - r, z));
  k.sph(SNOW, r, cx, 0, cz, { sy });
}

/** Brick chimney with courses, cap and snow. Returns nothing; mouth is at (x, topY + 0.1, z). */
function brickChimney(k: Kit, x: number, z: number, baseY: number, topY: number, w = 0.5, c = BRICK, cd = BRICK_D): void {
  const h = topY - baseY;
  k.box(c, w, h, w, x, baseY + h / 2, z);
  for (let y = baseY + 0.25; y < topY - 0.1; y += 0.3) k.box(cd, w + 0.03, 0.05, w + 0.03, x, y, z);
  k.box(cd, w + 0.14, 0.14, w + 0.14, x, topY, z);
  k.box(SNOW, w + 0.06, 0.1, w + 0.06, x, topY + 0.11, z);
}

function plankDoor(k: Kit, x: number, z: number, w: number, h: number, color: number, frame = CREAM): void {
  k.box(frame, w + 0.16, h + 0.1, 0.1, x, (h + 0.1) / 2, z);
  k.box(color, w, h, 0.12, x, h / 2, z + 0.01);
  k.sph(COLORS.COURIER_YELLOW, 0.045, x + w * 0.32, h * 0.5, z + 0.08);
}

function stripedAwning(k: Kit, x: number, z: number, width: number, y: number, depth: number, drop: number, n: number, ca: number, cb: number): void {
  // slab strips sloping down away from the wall (z grows outward), plus a valance
  const ang = Math.atan2(drop, depth);
  const slope = Math.hypot(depth, drop);
  const sw = width / n;
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? cb : ca;
    const sxp = x - width / 2 + sw * (i + 0.5);
    k.box(c, sw - 0.005, 0.05, slope, sxp, y - drop / 2, z + depth / 2, { rx: ang });
    k.box(c, sw - 0.005, 0.14, 0.05, sxp, y - drop - 0.06, z + depth);
    // scallop
    k.cyl(c, sw / 2 - 0.005, sw / 2 - 0.005, 0.05, sxp, y - drop - 0.14, z + depth, 8, { rx: Math.PI / 2, sy: 1 });
  }
  k.box(SNOW, width - 0.1, 0.05, slope * 0.6, x, y - drop / 2 + 0.06, z + depth * 0.4, { rx: ang });
}

// ---------------------------------------------------------------------------
// baked geometry
// ---------------------------------------------------------------------------

interface Baked {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  /** Which emissive material the glow mesh uses. */
  glowKind: 'warm' | 'pale' | 'oven';
  /** Animated part (geometry in pivot-local space) and where its pivot sits. */
  pivot: THREE.BufferGeometry | null;
  pivotAt: THREE.Vector3;
  chimney: THREE.Vector3 | null;
}

/** Pretty wooden window box with red blooms (ground-floor planter). */
function flowerBox(k: Kit, x: number, y: number, z: number, w: number): void {
  k.box(PALETTE.fenceDark, w, 0.12, 0.14, x, y, z);
  const n = Math.round(w / 0.14);
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + 0.08 + (i * (w - 0.16)) / Math.max(1, n - 1);
    k.sph(i % 2 ? 0xe05a5a : 0xf2c14e, 0.055, px, y + 0.1, z + 0.01);
  }
  k.box(PALETTE.pine, w - 0.04, 0.05, 0.1, x, y + 0.07, z);
}

// --- FARM ------------------------------------------------------------------------------------------------------

function bakeFarm(): Baked {
  const k = new Kit();
  const g = new Kit();
  const p = new Kit();

  // red barn (left, tall)
  const bx = -0.93;
  const bz = -0.6;
  const bw = 1.5;
  const bd = 2.2;
  const bh = 1.2;
  k.box(STONE, bw + 0.08, 0.12, bd + 0.08, bx, 0.06, bz);
  k.box(BARN_RED, bw, bh, bd, bx, bh / 2 + 0.06, bz);
  for (let i = 1; i < 6; i++) k.box(BARN_RED_D, 0.025, bh - 0.1, bd + 0.02, bx - bw / 2 + (i * bw) / 6, bh / 2 + 0.06, bz); // board seams
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(CREAM, 0.1, bh + 0.02, 0.1, bx + (sx * bw) / 2, bh / 2 + 0.06, bz + (sz * bd) / 2);
  k.box(CREAM, bw + 0.04, 0.07, bd + 0.04, bx, bh + 0.04, bz);
  k.roof(bx, bz, Math.PI / 2, bd, bw, bh + 0.06, 0.9, SLATE, SLATE_D, BARN_RED, 0.16);
  const fz = bz + bd / 2; // front wall z = 0.5
  // big double door with white X braces
  k.box(CREAM, 0.94, 0.96, 0.05, bx, 0.54, fz + 0.01);
  k.box(0x7d2a22, 0.8, 0.86, 0.06, bx, 0.5, fz + 0.03);
  const dl = Math.hypot(0.8, 0.86);
  for (const s of [-1, 1]) k.box(CREAM, dl - 0.12, 0.06, 0.03, bx, 0.5, fz + 0.065, { rz: s * Math.atan2(0.86, 0.8) });
  k.box(CREAM, 0.05, 0.86, 0.03, bx, 0.5, fz + 0.065);
  // hay-loft window in the gable
  const ly = bh + 0.55;
  k.box(CREAM, 0.42, 0.42, 0.05, bx, ly, fz + 0.01);
  g.box(WARM, 0.3, 0.3, 0.05, bx, ly, fz + 0.03);
  k.box(CREAM, 0.34, 0.04, 0.03, bx, ly, fz + 0.06);
  k.box(CREAM, 0.04, 0.34, 0.03, bx, ly, fz + 0.06);
  k.box(PALETTE.fenceDark, 0.07, 0.07, 0.5, bx, ly + 0.5, fz + 0.18); // hoist beam
  // door lanterns
  for (const s of [-1, 1]) {
    k.box(IRON, 0.04, 0.04, 0.12, bx + s * 0.58, 1.0, fz + 0.06);
    g.box(WARM, 0.1, 0.15, 0.1, bx + s * 0.58, 0.93, fz + 0.14);
  }

  // greenhouse (right front, low so the barn and windmill stay readable behind it)
  const gx = 1.1;
  const gz = 0.05;
  const gw = 1.5;
  const gd = 1.3;
  const eave = 0.9;
  const rise = 0.38;
  k.box(0x8b5a33, gw + 0.04, 0.24, gd + 0.04, gx, 0.12, gz);
  k.box(SNOW_SH, gw + 0.1, 0.05, gd + 0.1, gx, 0.02, gz);
  const wallH = eave - 0.24;
  // glass above, glowing crop rows below (leafy bushes in a row along each wall)
  const bandY = 0.24 + 0.2;
  g.box(GLASS, gw - 0.1, wallH - 0.4, 0.04, gx, 0.24 + 0.4 + (wallH - 0.4) / 2, gz + gd / 2 - 0.02);
  g.box(GLASS, 0.04, wallH - 0.4, gd - 0.1, gx + gw / 2 - 0.02, 0.24 + 0.4 + (wallH - 0.4) / 2, gz);
  g.box(LEAF, gw - 0.1, 0.4, 0.04, gx, bandY, gz + gd / 2 - 0.02);
  g.box(LEAF, 0.04, 0.4, gd - 0.1, gx + gw / 2 - 0.02, bandY, gz);
  for (let i = 0; i < 6; i++) g.sph(i % 2 ? LEAF_L : 0x4fc25a, 0.11, gx - gw / 2 + 0.2 + (i * (gw - 0.4)) / 5, 0.5, gz + gd / 2 - 0.05, { sy: 0.8 });
  for (let i = 0; i < 4; i++) g.sph(i % 2 ? 0x4fc25a : LEAF_L, 0.11, gx + gw / 2 - 0.05, 0.5, gz - gd / 2 + 0.2 + (i * (gd - 0.4)) / 3, { sy: 0.8 });
  // frame: posts, rails
  for (let i = 0; i <= 3; i++) k.box(CREAM, 0.06, wallH + 0.03, 0.07, gx - gw / 2 + (i * gw) / 3, 0.24 + wallH / 2, gz + gd / 2);
  for (let i = 0; i <= 2; i++) k.box(CREAM, 0.07, wallH + 0.03, 0.06, gx + gw / 2, 0.24 + wallH / 2, gz - gd / 2 + (i * gd) / 2);
  for (const y of [0.25, eave]) {
    k.box(CREAM, gw + 0.08, 0.07, 0.08, gx, y, gz + gd / 2);
    k.box(CREAM, 0.08, 0.07, gd + 0.08, gx + gw / 2, y, gz);
  }
  k.box(CREAM, gw + 0.06, 0.05, 0.05, gx, 0.6, gz + gd / 2 + 0.01);
  // glass roof with green rows glowing through, ribs and a snowy ridge
  const run = gd / 2 + 0.04;
  const ang = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise) + 0.04;
  for (const s of [-1, 1]) {
    const th = s * ang;
    const cy = eave + rise / 2 + 0.02;
    const cz = gz + (s * run) / 2;
    g.box(GLASS, gw + 0.06, 0.04, slope, gx, cy, cz, { rx: th });
    for (const u of [-0.28, -0.08, 0.12, 0.3]) {
      const v = 0.035;
      g.box(u > 0 ? LEAF_L : LEAF, gw - 0.2, 0.035, 0.12, gx, cy + v * Math.cos(th) - u * Math.sin(th), cz + v * Math.sin(th) + u * Math.cos(th), { rx: th });
    }
    for (let i = 0; i <= 3; i++) k.box(CREAM, 0.05, 0.06, slope, gx - gw / 2 + (i * gw) / 3, cy + 0.03, cz, { rx: th });
  }
  k.box(CREAM, gw + 0.1, 0.07, 0.08, gx, eave + rise + 0.05, gz);
  k.box(SNOW, gw - 0.2, 0.08, 0.3, gx, eave + rise + 0.1, gz);
  g.prismXY(GLASS, [[-gd / 2 + 0.03, 0], [gd / 2 - 0.03, 0], [0, rise - 0.02]], 0.04, gx + gw / 2 - 0.04, eave, gz, { ry: Math.PI / 2 });

  // windmill (back right, tall)
  const wx = 1.0;
  const wz = -1.4;
  const th0 = 0.44;
  const th1 = 0.28;
  const twH = 2.1;
  k.cyl(STONE, 0.5, 0.52, 0.22, wx, 0.11, wz, 10);
  k.cyl(CREAM, th1, th0, twH, wx, 0.22 + twH / 2, wz, 10);
  for (const y of [0.6, 1.2, 1.8]) {
    const r = th0 - ((th0 - th1) * (y - 0.22)) / twH + 0.015;
    k.cyl(BARN_RED, r, r + 0.01, 0.1, wx, y, wz, 10);
  }
  k.cone(BARN_RED, 0.37, 0.5, wx, 0.22 + twH + 0.23, wz, 10);
  k.cone(SNOW, 0.28, 0.32, wx, 0.22 + twH + 0.31, wz, 10);
  const axleY = 0.22 + twH - 0.1;
  k.cyl(PALETTE.fenceDark, 0.07, 0.07, 0.28, wx, axleY, wz + 0.32, 8, { rx: Math.PI / 2 });
  plankDoor(k, wx, wz + th0 - 0.03, 0.2, 0.36, BARN_RED_D, CREAM);
  g.box(WARM, 0.14, 0.18, 0.05, wx, 1.3, wz + 0.36);
  k.box(CREAM, 0.22, 0.26, 0.04, wx, 1.3, wz + 0.335);

  // hay bales and snow mounds
  k.cyl(HAY, 0.2, 0.2, 0.36, 0.28, 0.2, -1.55, 10, { rz: Math.PI / 2 });
  k.cyl(HAY, 0.2, 0.2, 0.36, 0.28, 0.2, -1.15, 10, { rz: Math.PI / 2 });
  k.cyl(HAY, 0.2, 0.2, 0.36, 0.28, 0.58, -1.35, 10, { rz: Math.PI / 2 });
  for (const [x, z] of [[-1.85, -1.8], [1.8, 0.75], [-0.2, 0.72], [0.2, -0.75]] as const) snowMound(k, x, z, 0.3);

  // windmill sails (pivot): 4 lattice blades on a hub
  p.cyl(PALETTE.fenceDark, 0.1, 0.1, 0.12, 0, 0, 0, 8, { rx: Math.PI / 2 });
  p.sph(BARN_RED, 0.1, 0, 0, 0.06, { sz: 0.7 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const rad = (r: number, off = 0): [number, number] => [-sn * r + cs * off, cs * r + sn * off];
    const [sx, sy] = rad(0.43);
    p.box(PALETTE.fenceDark, 0.05, 0.86, 0.04, sx, sy, 0, { rz: a });
    const [bx2, by2] = rad(0.55, 0.13);
    p.box(CREAM, 0.2, 0.56, 0.025, bx2, by2, 0.015, { rz: a });
    for (const r of [0.33, 0.5, 0.67]) {
      const [rx2, ry2] = rad(r, 0.13);
      p.box(PALETTE.fenceDark, 0.22, 0.03, 0.035, rx2, ry2, 0.02, { rz: a });
    }
    const [tx, ty] = rad(0.55, 0.235);
    p.box(PALETTE.fenceDark, 0.03, 0.56, 0.035, tx, ty, 0.02, { rz: a });
  }
  return { body: k.geometry(), glow: g.geometry(), glowKind: 'pale', pivot: p.geometry(), pivotAt: new THREE.Vector3(wx, axleY, wz + 0.5), chimney: null };
}

// --- BAKERY ----------------------------------------------------------------------------------------------------

function bakeBakery(): Baked {
  const k = new Kit();
  const g = new Kit();
  const p = new Kit();
  const w = 3.1;
  const d = 2.1;
  const bz = -0.55;
  const fz = bz + d / 2; // 0.5
  const h1 = 1.5;
  const h2 = 0.95;
  // stone footing + ground floor (plaster) + jettied upper floor
  k.box(STONE, w + 0.1, 0.16, d + 0.1, 0, 0.08, bz);
  k.box(PLASTER, w, h1 - 0.16, d, 0, 0.16 + (h1 - 0.16) / 2, bz);
  k.box(TIMBER, w + 0.1, 0.14, d + 0.2, 0, h1 + 0.02, bz + 0.05); // jetty beam
  k.box(PLASTER, w, h2, d + 0.12, 0, h1 + 0.09 + h2 / 2, bz + 0.06);
  const uz = fz + 0.12; // upper front plane
  // half timbering: corner + mid posts, rails, diagonal braces (front)
  for (let i = 0; i <= 4; i++) k.box(TIMBER, 0.11, h2, 0.07, -w / 2 + 0.05 + (i * (w - 0.1)) / 4, h1 + 0.09 + h2 / 2, uz);
  k.box(TIMBER, w, 0.1, 0.07, 0, h1 + h2 + 0.04, uz);
  for (const [x0, s] of [[-w / 2 + 0.05, 1], [w / 2 - 0.05 - (w - 0.1) / 4, -1]] as const) {
    const bw = (w - 0.1) / 4;
    k.box(TIMBER, Math.hypot(bw, h2 - 0.15), 0.07, 0.06, x0 + bw / 2, h1 + 0.09 + h2 / 2, uz + 0.01, { rz: s * Math.atan2(h2 - 0.15, bw) });
  }
  // ground floor posts at the corners + door posts
  for (const sx of [-1, 1]) k.box(TIMBER, 0.12, h1 - 0.16, 0.12, (sx * w) / 2, 0.16 + (h1 - 0.16) / 2, fz);
  // side (+x) timbering
  for (let i = 0; i <= 3; i++) k.box(TIMBER, 0.07, h2, 0.11, w / 2 + 0.03, h1 + 0.09 + h2 / 2, uz - 0.05 - (i * (d + 0.1)) / 3);
  k.box(TIMBER, 0.07, 0.1, d + 0.2, w / 2 + 0.03, h1 + h2 + 0.04, bz + 0.06);
  // roof (terracotta) over the upper floor
  const eaveY = h1 + 0.09 + h2;
  k.roof(0, bz + 0.06, 0, w, d + 0.12, eaveY, 1.0, 0xb85a33, 0x9a4528, PLASTER, 0.2);
  // chimney: big brick, rises past the ridge
  brickChimney(k, 1.0, -1.15, eaveY + 0.2, 4.0, 0.68);
  k.box(BRICK_D, 0.8, 0.06, 0.8, 1.0, eaveY + 0.24, -1.15);
  // front: display window with oven glow, awning, door
  const wx = -0.6;
  k.box(TIMBER, 1.62, 0.8, 0.1, wx, 0.82, fz + 0.01);
  g.box(WARM, 1.46, 0.64, 0.06, wx, 0.82, fz + 0.05);
  for (const s of [-1, 0, 1]) k.box(TIMBER, 0.04, 0.64, 0.03, wx + s * 0.36, 0.82, fz + 0.09);
  k.box(TIMBER, 1.46, 0.04, 0.03, wx, 0.88, fz + 0.09);
  // loaves on the sill (in front of the glow)
  k.box(PALETTE.fenceDark, 1.62, 0.07, 0.3, wx, 0.4, fz + 0.15);
  for (let i = 0; i < 4; i++) k.sph(i % 2 ? 0xd18a45 : 0xc27a35, 0.1, wx - 0.55 + i * 0.37, 0.52, fz + 0.15, { sy: 0.65, sz: 0.85 });
  k.box(SNOW, 1.7, 0.05, 0.16, wx, 1.25, fz + 0.1);
  stripedAwning(k, wx, fz + 0.06, 1.8, 1.44, 0.24, 0.1, 7, BARN_RED, CREAM);
  // door (teal) with snow cap
  plankDoor(k, 0.95, fz + 0.01, 0.62, 1.15, 0x3f7a6a, TIMBER);
  k.box(SNOW, 0.9, 0.04, 0.2, 0.95, 1.29, fz + 0.08);
  k.box(STONE_D, 1.0, 0.08, 0.4, 0.95, 0.04, fz + 0.2);
  // upper windows (lit)
  windowAt(k, g, -0.85, h1 + 0.58, uz + 0.01, 0, 0.5, 0.44, TIMBER);
  windowAt(k, g, 0.15, h1 + 0.58, uz + 0.01, 0, 0.5, 0.44, TIMBER);
  flowerBox(k, -0.85, h1 + 0.28, uz + 0.1, 0.62);
  flowerBox(k, 0.15, h1 + 0.28, uz + 0.1, 0.62);
  windowAt(k, g, w / 2 + 0.07, h1 + 0.58, bz + 0.3, Math.PI / 2, 0.5, 0.44, TIMBER);
  // side oven glow: the brick oven bulging from the +x wall, mouth glowing
  k.box(BRICK, 0.36, 0.7, 0.8, w / 2 + 0.18, 0.5, -0.9);
  k.box(BRICK_D, 0.4, 0.07, 0.86, w / 2 + 0.18, 0.88, -0.9);
  k.box(SNOW, 0.4, 0.07, 0.86, w / 2 + 0.18, 0.95, -0.9);
  g.box(0xffb347, 0.05, 0.28, 0.4, w / 2 + 0.37, 0.4, -0.9);
  k.box(IRON, 0.05, 0.34, 0.5, w / 2 + 0.36, 0.4, -0.9, {});
  // bracket + bar for the hanging sign (sign faces +Z and swings about the bar)
  const barX = 1.2;
  const armY = 1.95;
  const barZ = uz + 0.18;
  for (const dx of [-0.3, 0.3]) k.box(IRON, 0.04, 0.04, 0.2, barX + dx, armY, uz + 0.09);
  k.box(IRON, 0.7, 0.04, 0.04, barX, armY, barZ);
  for (const [x, z] of [[-1.55, -1.75], [1.55, 0.6], [-1.6, 0.6]] as const) snowMound(k, x, z, 0.28);
  // pivot: swinging pretzel sign hanging from the bar (pivot on the bar, board hangs below)
  for (const dx of [-0.18, 0.18]) p.box(IRON, 0.03, 0.26, 0.03, dx, -0.13, 0);
  p.box(TIMBER, 0.58, 0.5, 0.07, 0, -0.5, 0);
  p.box(0xf6e0b0, 0.5, 0.42, 0.08, 0, -0.5, 0.01);
  p.torus(0xc27a35, 0.12, 0.035, 0, -0.46, 0.06, { sx: 1.15, sy: 0.85 });
  p.torus(0xc27a35, 0.07, 0.03, -0.12, -0.56, 0.06);
  p.torus(0xc27a35, 0.07, 0.03, 0.12, -0.56, 0.06);
  p.sph(0xd18a45, 0.075, 0, -0.66, 0.06, { sx: 1.35, sy: 0.55 });
  return {
    body: k.geometry(),
    glow: g.geometry(),
    glowKind: 'oven',
    pivot: p.geometry(),
    pivotAt: new THREE.Vector3(barX, armY - 0.04, barZ),
    chimney: new THREE.Vector3(1.0, 4.2, -1.15),
  };
}

// --- TOWNHOUSE -------------------------------------------------------------------------------------------------

function bakeTownhouse(): Baked {
  const k = new Kit();
  const g = new Kit();
  const w = 2.6;
  const d = 2.0;
  const bz = -0.7;
  const fz = bz + d / 2; // 0.3
  const hh = 2.55;
  const wall = 0x8fb0cf;
  const wallD = 0x7a9dbd;
  k.box(STONE, w + 0.1, 0.22, d + 0.1, 0, 0.11, bz);
  k.box(wall, w, hh - 0.22, d, 0, 0.22 + (hh - 0.22) / 2, bz);
  // horizontal clap-boards
  for (let y = 0.5; y < hh - 0.1; y += 0.22) {
    k.box(wallD, w + 0.02, 0.025, 0.02, 0, y, fz + 0.005);
    k.box(wallD, 0.02, 0.025, d + 0.02, w / 2 + 0.005, y, bz);
  }
  // string course between floors
  k.box(CREAM, w + 0.1, 0.1, d + 0.1, 0, 1.38, bz);
  // corner quoins
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) k.box(CREAM, 0.14, 0.34, i % 2 ? 0.14 : 0.2, (sx * (w - 0.1)) / 2, 0.45 + i * 0.4 + (i > 2 ? 0.1 : 0), fz - 0.02);
  }
  k.roof(0, bz, 0, w, d, hh, 1.15, 0x4f6f86, 0x3f5a6e, wall, 0.16);
  brickChimney(k, -0.8, -1.3, hh + 0.2, 4.15, 0.46);
  // dormer on the front slope: small gable with a lit window
  k.box(wall, 0.7, 0.55, 0.5, 0.55, hh + 0.35, bz + 0.9);
  k.roof(0.55, bz + 0.95, Math.PI / 2, 0.6, 0.7, hh + 0.62, 0.35, 0x4f6f86, 0x3f5a6e, wall, 0.12);
  windowAt(k, g, 0.55, hh + 0.42, bz + 1.17, 0, 0.3, 0.3, CREAM);
  // ground floor: door (red) with wreath, two windows
  k.box(CREAM, 0.74, 1.12, 0.1, 0, 0.56 + 0.06, fz + 0.01);
  k.box(0xb23a30, 0.58, 1.0, 0.1, 0, 0.56, fz + 0.04);
  k.box(0x8e2d25, 0.2, 0.34, 0.03, -0.15, 0.78, fz + 0.1);
  k.box(0x8e2d25, 0.2, 0.34, 0.03, 0.15, 0.78, fz + 0.1);
  k.sph(COLORS.COURIER_YELLOW, 0.04, 0.2, 0.52, fz + 0.12);
  // wreath: pine ring + red berries + bow
  k.torus(PALETTE.pine, 0.15, 0.05, 0, 0.82, fz + 0.12);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + 0.3;
    k.sph(0xe2453c, 0.03, Math.cos(a) * 0.15, 0.82 + Math.sin(a) * 0.15, fz + 0.17);
  }
  k.box(0xe2453c, 0.1, 0.06, 0.03, -0.06, 0.66, fz + 0.16, { rz: 0.5 });
  k.box(0xe2453c, 0.1, 0.06, 0.03, 0.06, 0.66, fz + 0.16, { rz: -0.5 });
  k.box(SNOW, 0.84, 0.05, 0.18, 0, 1.2, fz + 0.06);
  k.box(STONE_D, 0.95, 0.12, 0.42, 0, 0.06, fz + 0.2); // stoop
  k.box(SNOW, 0.9, 0.04, 0.38, 0, 0.13, fz + 0.2);
  for (const s of [-1, 1]) {
    windowAt(k, g, s * 0.88, 0.85, fz + 0.01, 0, 0.44, 0.5, CREAM);
    windowAt(k, g, s * 0.88, 1.95, fz + 0.01, 0, 0.44, 0.5, CREAM);
    flowerBox(k, s * 0.88, 0.5, fz + 0.1, 0.56);
    flowerBox(k, s * 0.88, 1.6, fz + 0.1, 0.56);
  }
  windowAt(k, g, 0, 1.95, fz + 0.01, 0, 0.3, 0.5, CREAM);
  // side windows
  windowAt(k, g, w / 2 + 0.01, 0.85, bz + 0.25, Math.PI / 2, 0.44, 0.5, CREAM);
  windowAt(k, g, w / 2 + 0.01, 1.95, bz + 0.25, Math.PI / 2, 0.44, 0.5, CREAM);
  windowAt(k, g, w / 2 + 0.01, 0.85, bz - 0.55, Math.PI / 2, 0.44, 0.5, CREAM);
  windowAt(k, g, w / 2 + 0.01, 1.95, bz - 0.55, Math.PI / 2, 0.44, 0.5, CREAM);
  // door lantern
  k.box(IRON, 0.04, 0.04, 0.12, 0.55, 1.1, fz + 0.1);
  g.box(WARM, 0.1, 0.15, 0.1, 0.55, 1.0, fz + 0.18);
  for (const [x, z] of [[-1.75, -1.8], [1.75, 0.55], [-1.45, 0.5]] as const) snowMound(k, x, z, 0.3);
  return { body: k.geometry(), glow: g.geometry(), glowKind: 'warm', pivot: null, pivotAt: new THREE.Vector3(), chimney: new THREE.Vector3(-0.8, 4.35, -1.3) };
}

// --- RANCH -----------------------------------------------------------------------------------------------------

function cow(k: Kit, x: number, z: number, yaw: number, patches: boolean): void {
  k.at(x, z, yaw, () => {
    const WHITE = 0xf6f1e6;
    const BLACK = 0x2b2f36;
    k.sph(WHITE, 0.2, 0, 0.36, 0, { sx: 1.45, sy: 0.95, sz: 1.0 });
    if (patches) {
      k.sph(BLACK, 0.12, -0.08, 0.5, 0.06, { sx: 1.3, sy: 0.6, sz: 1.1 });
      k.sph(BLACK, 0.1, 0.12, 0.34, -0.14, { sx: 1.1, sy: 0.9, sz: 0.7 });
    }
    // head (toward +X) with pink muzzle, horns, ears
    k.box(WHITE, 0.2, 0.2, 0.2, 0.34, 0.5, 0);
    k.box(0xf0a8a0, 0.08, 0.12, 0.2, 0.46, 0.45, 0);
    for (const s of [-1, 1]) {
      k.cone(0xf4e2b0, 0.03, 0.09, 0.3, 0.64, s * 0.1, 6, { rz: -s * 0.0 });
      k.box(BLACK, 0.05, 0.07, 0.06, 0.28, 0.58, s * 0.14);
      k.sph(BLACK, 0.02, 0.44, 0.54, s * 0.07);
    }
    // legs + tail
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(WHITE, 0.045, 0.045, 0.2, sx * 0.2, 0.1, sz * 0.1, 6);
    k.cyl(BLACK, 0.015, 0.015, 0.22, -0.34, 0.38, 0, 5, { rz: 0.25 });
    k.sph(0xf0a8a0, 0.04, 0.0, 0.2, 0, { sx: 0.8, sy: 0.7 }); // udder
  });
}

function pig(k: Kit, x: number, z: number, yaw: number): void {
  k.at(x, z, yaw, () => {
    const PINK = 0xf2a2a8;
    k.sph(PINK, 0.15, 0, 0.2, 0, { sx: 1.35, sy: 1.0, sz: 1.0 });
    k.sph(PINK, 0.1, 0.2, 0.24, 0);
    k.cyl(0xe58c93, 0.045, 0.045, 0.05, 0.3, 0.23, 0, 8, { rz: Math.PI / 2 });
    for (const s of [-1, 1]) {
      k.cone(0xe58c93, 0.04, 0.07, 0.19, 0.35, s * 0.07, 4);
      for (const sx of [-1, 1]) k.cyl(PINK, 0.03, 0.03, 0.1, sx * 0.1, 0.05, s * 0.07, 6);
    }
    k.torus(PINK, 0.03, 0.012, -0.21, 0.24, 0, { ry: Math.PI / 2 });
  });
}

function bakeRanch(): Baked {
  const k = new Kit();
  const g = new Kit();
  const w = 3.3;
  const d = 1.4;
  const bz = -1.0;
  const fz = bz + d / 2; // -0.3
  const bh = 1.05;
  const WOOD = 0xa87142;
  const WOOD_D = 0x8a5a33;
  k.box(STONE, w + 0.1, 0.12, d + 0.1, 0, 0.06, bz);
  k.box(WOOD, w, bh, d, 0, bh / 2 + 0.06, bz);
  for (let i = 1; i < 14; i++) k.box(WOOD_D, 0.025, bh - 0.08, d + 0.02, -w / 2 + (i * w) / 14, bh / 2 + 0.06, bz);
  for (let i = 0; i < 4; i++) k.box(CREAM, 0.1, bh + 0.04, 0.1, -w / 2 + (i * w) / 3, bh / 2 + 0.06, fz);
  k.box(CREAM, 0.1, bh + 0.04, 0.1, 0, bh / 2 + 0.06, bz - d / 2);
  k.roof(0, bz, 0, w, d, bh + 0.06, 0.78, 0x5f7c72, 0x4d665e, WOOD, 0.15);
  // central hay-loft door + stable doors
  k.box(CREAM, 0.7, 0.62, 0.05, 0, 1.52, fz + 0.02);
  g.box(WARM, 0.5, 0.42, 0.05, 0, 1.52, fz + 0.045);
  k.box(CREAM, 0.54, 0.04, 0.03, 0, 1.52, fz + 0.075);
  k.box(CREAM, 0.04, 0.46, 0.03, 0, 1.52, fz + 0.075);
  k.box(HAY, 0.6, 0.1, 0.1, 0, 1.2, fz + 0.04);
  for (const s of [-1, 1]) {
    const x = s * 0.75;
    k.box(CREAM, 0.7, 0.82, 0.05, x, 0.47, fz + 0.01);
    k.box(DOOR_DARK, 0.56, 0.7, 0.06, x, 0.43, fz + 0.03);
    const dl = Math.hypot(0.56, 0.7);
    for (const r of [-1, 1]) k.box(CREAM, dl - 0.1, 0.045, 0.03, x, 0.43, fz + 0.065, { rz: r * Math.atan2(0.7, 0.56) });
    // top half open window
    k.box(0x2b2f36, 0.34, 0.2, 0.03, x, 0.62, fz + 0.065);
  }
  // paddock: trodden snow, fence on three sides and the front with a gate gap, trough, hay
  const px0 = -1.8;
  const px1 = 1.8;
  const pz0 = -0.28;
  const pz1 = 0.85;
  k.box(0xe8dcc9, px1 - px0 - 0.1, 0.03, pz1 - pz0 - 0.1, 0, 0.015, (pz0 + pz1) / 2);
  const post = (x: number, z: number): void => {
    k.box(WOOD_D, 0.09, 0.5, 0.09, x, 0.25, z);
    k.box(SNOW, 0.12, 0.05, 0.12, x, 0.52, z);
  };
  const run = (xa: number, za: number, xb: number, zb: number): void => {
    const len = Math.hypot(xb - xa, zb - za);
    const n = Math.max(1, Math.round(len / 0.6));
    for (let i = 0; i <= n; i++) post(xa + ((xb - xa) * i) / n, za + ((zb - za) * i) / n);
    const yaw = -Math.atan2(zb - za, xb - xa);
    for (const y of [0.2, 0.38]) k.box(WOOD, len, 0.06, 0.04, (xa + xb) / 2, y, (za + zb) / 2, { ry: yaw });
  };
  run(px0, pz0, px0, pz1);
  run(px1, pz0, px1, pz1);
  run(px0, pz1, -0.5, pz1);
  run(0.5, pz1, px1, pz1);
  // gate posts with a hanging lantern
  k.box(WOOD_D, 0.12, 0.7, 0.12, -0.5, 0.35, pz1);
  k.box(WOOD_D, 0.12, 0.7, 0.12, 0.5, 0.35, pz1);
  g.box(WARM, 0.1, 0.13, 0.1, 0.5, 0.78, pz1);
  k.box(SNOW, 0.16, 0.05, 0.16, -0.5, 0.72, pz1);
  // animals
  cow(k, -1.0, 0.28, 0.5, true);
  cow(k, 0.35, 0.1, -0.2, false);
  pig(k, 1.2, 0.45, -0.7);
  // trough + hay
  k.box(WOOD_D, 0.7, 0.2, 0.25, 1.15, 0.1, -0.05);
  k.box(0x9ad4ee, 0.6, 0.03, 0.17, 1.15, 0.19, -0.05);
  k.cyl(HAY, 0.17, 0.17, 0.3, -1.55, 0.17, 0.0, 10, { rz: Math.PI / 2 });
  k.cyl(HAY, 0.17, 0.17, 0.3, -1.55, 0.17, 0.4, 10, { rz: Math.PI / 2 });
  for (const [x, z] of [[-1.8, -1.85], [1.8, -1.85], [-1.8, 0.85]] as const) snowMound(k, x, z, 0.3);
  return { body: k.geometry(), glow: g.geometry(), glowKind: 'warm', pivot: null, pivotAt: new THREE.Vector3(), chimney: null };
}

// --- BUTCHER ---------------------------------------------------------------------------------------------------

function ham(k: Kit, x: number, y: number, z: number, s = 1): void {
  k.sph(0xd9707a, 0.1 * s, x, y, z, { sy: 1.25, sx: 0.9, sz: 0.9 });
  k.sph(0xf1c5c0, 0.05 * s, x, y - 0.04 * s, z + 0.07 * s, { sy: 1.2 });
  k.cyl(0xf5ecd9, 0.018 * s, 0.018 * s, 0.1 * s, x, y - 0.14 * s, z, 6);
  k.cyl(0xb8a07a, 0.006 * s, 0.006 * s, 0.14 * s, x, y + 0.18 * s, z, 4);
}

function bakeButcher(): Baked {
  const k = new Kit();
  const g = new Kit();
  const p = new Kit();
  const w = 2.45;
  const d = 2.0;
  const sx0 = -0.55; // shop centre x
  const bz = -0.55;
  const fz = bz + d / 2; // 0.45
  const wall = 0xeee4d0;
  const green = 0x5c8a67;
  const h = 1.95;
  k.box(STONE, w + 0.1, 0.14, d + 0.1, sx0, 0.07, bz);
  k.box(wall, w, h, d, sx0, 0.14 + h / 2 - 0.07, bz);
  // tiled dado
  k.box(green, w + 0.03, 0.55, d + 0.03, sx0, 0.14 + 0.275, bz);
  for (let i = 1; i < 6; i++) k.box(0x4a7355, 0.02, 0.55, 0.01, sx0 - w / 2 + (i * w) / 6, 0.42, fz + 0.02);
  k.box(CREAM, w + 0.06, 0.07, d + 0.06, sx0, 0.7, bz);
  // low gable roof, rust tiles
  k.roof(sx0, bz, 0, w, d, h + 0.07, 0.55, 0x9a4a35, 0x823d2c, wall, 0.14);
  // painted sign board above the awning: two hams around a red band
  const cx = sx0 - 0.35;
  k.box(TIMBER, 1.7, 0.32, 0.07, cx, 1.64, fz + 0.04);
  k.box(0xf6e0b0, 1.6, 0.24, 0.05, cx, 1.64, fz + 0.075);
  ham(k, cx - 0.5, 1.66, fz + 0.12, 0.8);
  ham(k, cx + 0.5, 1.66, fz + 0.12, 0.8);
  k.box(BARN_RED, 0.55, 0.07, 0.03, cx, 1.64, fz + 0.11);
  // window with hams on display (under a shallow striped awning)
  const wx = sx0 - 0.5;
  k.box(green, 1.3, 0.7, 0.1, wx, 0.92, fz + 0.01);
  g.box(WARM, 1.14, 0.54, 0.06, wx, 0.92, fz + 0.05);
  k.box(CREAM, 0.04, 0.54, 0.03, wx, 0.92, fz + 0.09);
  for (let i = 0; i < 3; i++) ham(k, wx - 0.38 + i * 0.38, 0.9, fz + 0.12, 0.6);
  k.box(green, 1.3, 0.08, 0.2, wx, 0.54, fz + 0.12);
    plankDoor(k, sx0 + 0.82, fz + 0.01, 0.55, 1.1, green, CREAM);
  k.box(SNOW, 0.8, 0.04, 0.2, sx0 + 0.82, 1.24, fz + 0.08);
  stripedAwning(k, wx, fz + 0.06, 1.7, 1.4, 0.24, 0.1, 7, BARN_RED, 0xf6f0e4);
  // side window (+x)
  windowAt(k, g, sx0 + w / 2 + 0.01, 0.95, bz + 0.1, Math.PI / 2, 0.5, 0.44, green);
  // smokehouse (back right): dark brick tower with louvres, little hip roof, tall chimney pipe
  const mx = 1.3;
  const mz = -1.35;
  const mh = 1.85;
  k.box(0x6a3b2d, 0.95, mh, 0.95, mx, mh / 2, mz);
  for (let y = 0.2; y < mh; y += 0.25) k.box(0x57301f, 0.99, 0.04, 0.99, mx, y, mz);
  k.box(IRON, 0.5, 0.42, 0.04, mx - 0.1, 0.5, mz + 0.5);
  for (let i = 0; i < 4; i++) k.box(0x2b2f36, 0.5, 0.03, 0.045, mx - 0.1, 0.35 + i * 0.1, mz + 0.5);
  for (let i = 0; i < 5; i++) k.box(0x57301f, 0.5, 0.04, 0.05, mx + 0.51, 1.15 + i * 0.1, mz + 0.0, { ry: Math.PI / 2, rx: 0.4 });
  k.cone(0x4a2a1e, 0.78, 0.5, mx, mh + 0.25, mz, 4, { ry: Math.PI / 4 });
  k.cone(SNOW, 0.6, 0.36, mx, mh + 0.32, mz, 4, { ry: Math.PI / 4 });
  k.cyl(IRON, 0.12, 0.12, 0.8, mx, mh + 0.6, mz, 8);
  k.cyl(IRON, 0.17, 0.14, 0.08, mx, mh + 1.04, mz, 8);
  k.cyl(SNOW, 0.15, 0.15, 0.04, mx, mh + 1.1, mz, 8);
  // smokehouse door glow
  g.box(0xff8a3a, 0.2, 0.3, 0.05, mx + 0.25, 1.1, mz + 0.5);
  k.box(IRON, 0.3, 0.4, 0.04, mx + 0.25, 1.1, mz + 0.48);
  // barrel + log pile
  k.cyl(PALETTE.fenceDark, 0.2, 0.2, 0.4, 1.4, 0.2, -0.45, 10);
  k.cyl(IRON, 0.205, 0.205, 0.04, 1.4, 0.12, -0.45, 10);
  k.cyl(IRON, 0.205, 0.205, 0.04, 1.4, 0.3, -0.45, 10);
  k.cyl(SNOW, 0.2, 0.2, 0.03, 1.4, 0.41, -0.45, 10);
  for (let i = 0; i < 3; i++) k.cyl(i % 2 ? PALETTE.plank : PALETTE.bark, 0.1, 0.1, 0.5, 1.5, 0.1 + (i === 2 ? 0.17 : 0), 0.1 + (i === 2 ? 0.08 : i * 0.2), 7, { rz: Math.PI / 2 });
  for (const [x, z] of [[-1.8, -1.8], [-1.8, 0.62], [1.8, -0.3]] as const) snowMound(k, x, z, 0.3);
  // pivot: bracket + bar over the door, three hams hanging (sways)
  const ax = sx0 + 0.85;
  const ay = 1.85;
  const barZ = fz + 0.28;
  for (const dx of [-0.3, 0.3]) k.box(IRON, 0.04, 0.04, 0.3, ax + dx, ay, fz + 0.14);
  k.box(IRON, 0.7, 0.04, 0.04, ax, ay, barZ);
  for (const x of [-0.2, 0, 0.2]) {
    p.box(0xb8a07a, 0.012, 0.2, 0.012, x, -0.1, 0);
    ham(p, x, -0.34, 0, 0.8);
  }
  return {
    body: k.geometry(),
    glow: g.geometry(),
    glowKind: 'warm',
    pivot: p.geometry(),
    pivotAt: new THREE.Vector3(ax, ay - 0.02, barZ),
    chimney: new THREE.Vector3(mx, mh + 1.2, mz),
  };
}

// --- TOY FACTORY -----------------------------------------------------------------------------------------------

function toyTrainSign(k: Kit, x: number, y: number, z: number): void {
  k.box(TIMBER, 1.5, 0.56, 0.07, x, y, z);
  k.box(0xbfe4f6, 1.4, 0.46, 0.05, x, y, z + 0.03);
  k.box(IRON, 1.36, 0.03, 0.03, x, y - 0.2, z + 0.06);
  // chunky engine + two wagons (about 1.3x the size of the first draft so it reads from the iso camera)
  const z0 = z + 0.07;
  const WY = y - 0.15;
  k.box(BARN_RED, 0.26, 0.3, 0.05, x - 0.5, y - 0.02, z0);
  k.box(IRON, 0.32, 0.05, 0.06, x - 0.5, y + 0.15, z0);
  k.cyl(COLORS.COURIER_YELLOW, 0.11, 0.11, 0.38, x - 0.22, y - 0.06, z0, 10, { rz: Math.PI / 2 });
  k.cyl(IRON, 0.05, 0.06, 0.13, x - 0.12, y + 0.12, z0, 6);
  for (const dx of [-0.58, -0.4, -0.2]) k.cyl(IRON, 0.065, 0.065, 0.04, x + dx, WY, z0 + 0.01, 8, { rx: Math.PI / 2 });
  const cols = [0x2f79c9, 0x4cc660];
  for (let i = 0; i < 2; i++) {
    const cx = x + 0.2 + i * 0.5;
    k.box(cols[i]!, 0.42, 0.24, 0.05, cx, y - 0.05, z0);
    k.box(cols[(i + 1) % 2]!, 0.36, 0.07, 0.055, cx, y + 0.1, z0);
    for (const dx of [-0.11, 0.11]) k.cyl(IRON, 0.055, 0.055, 0.04, cx + dx, WY, z0 + 0.01, 8, { rx: Math.PI / 2 });
    k.box(IRON, 0.08, 0.03, 0.04, cx - 0.26, y - 0.1, z0);
  }
}

function bakeToyFactory(): Baked {
  const k = new Kit();
  const g = new Kit();
  const p = new Kit();
  const w = 3.5;
  const d = 2.3;
  const bz = -0.65;
  const fz = bz + d / 2; // 0.5
  const h = 1.85;
  const BR = 0xb9573f;
  const BRD = 0x8f3f2c;
  k.box(STONE, w + 0.1, 0.16, d + 0.1, 0, 0.08, bz);
  k.box(BR, w, h, d, 0, 0.14 + h / 2, bz);
  // brick courses on the front and +x faces
  for (let y = 0.3; y < h; y += 0.16) {
    k.box(BRD, w + 0.01, 0.018, 0.012, 0, y, fz + 0.004);
    k.box(BRD, 0.012, 0.018, d + 0.01, w / 2 + 0.004, y, bz);
  }
  // corner pilasters + cornice
  for (const sx of [-1, 1]) {
    k.box(BRD, 0.2, h, 0.2, (sx * w) / 2, 0.14 + h / 2, fz);
    k.box(BRD, 0.2, h, 0.2, (sx * w) / 2, 0.14 + h / 2, bz - d / 2);
  }
  k.box(CREAM, w + 0.14, 0.12, d + 0.14, 0, h + 0.2, bz);
  // sawtooth roof: 3 teeth along Z, slopes rising toward +Z, glazed vertical faces looking at the camera
  const topY = h + 0.26;
  const toothH = 0.78;
  const zs = [bz - d / 2 + 0.02, bz - d / 2 + 0.79, bz - d / 2 + 1.56, fz - 0.02];
  for (let i = 0; i < 3; i++) {
    const za = zs[i]!;
    const zb = zs[i + 1]!;
    k.prismZY(i % 2 ? 0x8a4a38 : 0x9a5240, [[za, topY], [zb, topY], [zb, topY + toothH]], -w / 2 + 0.02, w / 2 - 0.02);
    // snow on the slope (thin wedge a touch above it)
    k.prismZY(SNOW, [[za + 0.02, topY + 0.02], [zb - 0.04, topY + toothH * 0.97 - 0.04 - 0.02], [zb - 0.04, topY + toothH - 0.02 + 0.09], [za + 0.02, topY + 0.1]], -w / 2 + 0.0, w / 2 - 0.0);
    // glazed vertical face with muntins
    g.box(0xd6ebf5, w - 0.34, toothH - 0.18, 0.04, 0, topY + toothH / 2, zb + 0.015);
    for (let j = 0; j <= 6; j++) k.box(CREAM, 0.05, toothH - 0.1, 0.05, -w / 2 + 0.17 + (j * (w - 0.34)) / 6, topY + toothH / 2, zb + 0.04);
    k.box(CREAM, w - 0.28, 0.06, 0.06, 0, topY + 0.03, zb + 0.04);
    k.box(CREAM, w - 0.28, 0.06, 0.06, 0, topY + toothH - 0.02, zb + 0.04);
    k.box(SNOW, w - 0.2, 0.06, 0.12, 0, topY + toothH + 0.04, zb - 0.05);
  }
  // chimney (tall brick stack, back left)
  brickChimney(k, -1.35, -1.45, topY, 4.4, 0.56);
  // front: wide yellow double door with red trim, train sign above, big lit window left, big gear right
  const dx = -0.2;
  k.box(CREAM, 1.3, 1.3, 0.1, dx, 0.8, fz + 0.01);
  k.box(COLORS.COURIER_YELLOW, 1.1, 1.18, 0.1, dx, 0.74, fz + 0.04);
  k.box(BARN_RED, 0.05, 1.18, 0.12, dx, 0.74, fz + 0.045);
  for (const s of [-1, 1]) {
    k.box(BARN_RED, 0.34, 0.5, 0.12, dx + s * 0.27, 0.74, fz + 0.05);
    k.box(0xfff0b0, 0.26, 0.42, 0.13, dx + s * 0.27, 0.74, fz + 0.052);
  }
  k.box(SNOW, 1.4, 0.06, 0.18, dx, 1.5, fz + 0.06);
  toyTrainSign(k, dx, 1.75, fz + 0.05);
  windowAt(k, g, -1.3, 0.95, fz + 0.01, 0, 0.5, 0.62, CREAM);
  // +x wall windows
  for (const z of [bz + 0.5, bz - 0.5]) windowAt(k, g, w / 2 + 0.01, 1.0, z, Math.PI / 2, 0.5, 0.66, CREAM);
  // bunting along the eave line (front)
  const flags = [BARN_RED, COLORS.COURIER_YELLOW, 0x2f79c9, 0x4cc660];
  for (let i = 0; i < 11; i++) {
    const x = -1.5 + i * 0.3;
    k.prismXY(flags[i % 4]!, [[-0.09, 0], [0.09, 0], [0, -0.2]], 0.02, x, h + 0.1, fz + 0.1);
  }
  k.box(PALETTE.fenceDark, 3.3, 0.02, 0.02, 0, h + 0.1, fz + 0.1);
  // toy blocks and a rocking horse-ish crate by the corner
  const blocks = [[1.45, 0.15, 0.78, 0xe2453c], [1.7, 0.15, 0.68, 0x2f79c9], [1.52, 0.43, 0.74, 0xffd026]] as const;
  for (const [x, y, z, c] of blocks) k.box(c, 0.26, 0.26, 0.26, x, y, z, { ry: x * 0.7 });
  for (const [x, z] of [[-1.8, 0.65], [1.8, -1.8]] as const) snowMound(k, x, z, 0.3);
  // pivot: the big brass gear
  const gr = 0.46;
  p.cyl(BRASS, gr, gr, 0.09, 0, 0, 0, 20, { rx: Math.PI / 2 });
  p.cyl(BRASS_D, gr * 0.72, gr * 0.72, 0.11, 0, 0, 0, 16, { rx: Math.PI / 2 });
  p.cyl(BRASS, gr * 0.5, gr * 0.5, 0.12, 0, 0, 0, 14, { rx: Math.PI / 2 });
  p.cyl(IRON, 0.1, 0.1, 0.16, 0, 0, 0, 8, { rx: Math.PI / 2 });
  const teeth = 12;
  for (let i = 0; i < teeth; i++) {
    const a = (i * 2 * Math.PI) / teeth;
    p.box(BRASS, 0.16, 0.14, 0.09, -Math.sin(a) * (gr + 0.04), Math.cos(a) * (gr + 0.04), 0, { rz: a });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    p.box(BRASS, 0.07, gr * 0.5, 0.115, -Math.sin(a) * gr * 0.5, Math.cos(a) * gr * 0.5, 0, { rz: a });
  }
  return {
    body: k.geometry(),
    glow: g.geometry(),
    glowKind: 'pale',
    pivot: p.geometry(),
    pivotAt: new THREE.Vector3(1.15, 1.05, fz + 0.1),
    chimney: new THREE.Vector3(-1.35, 4.6, -1.45),
  };
}

// ---------------------------------------------------------------------------
// public factories
// ---------------------------------------------------------------------------

const BAKE: Record<BusinessId, () => Baked> = {
  farm: bakeFarm,
  bakery: bakeBakery,
  townhouse: bakeTownhouse,
  ranch: bakeRanch,
  butcher: bakeButcher,
  toyFactory: bakeToyFactory,
};
const bakedCache: Partial<Record<BusinessId, Baked>> = {};

/** Seconds → rad/s speeds of the animated pivot while idle / working, and how the pivot moves. */
type PivotKind = 'spin' | 'swing' | 'none';
const PIVOT: Record<BusinessId, { kind: PivotKind; idle: number; work: number }> = {
  farm: { kind: 'spin', idle: 0.35, work: 1.7 },
  bakery: { kind: 'swing', idle: 0.6, work: 2.6 },
  townhouse: { kind: 'none', idle: 0, work: 0 },
  ranch: { kind: 'none', idle: 0, work: 0 },
  butcher: { kind: 'swing', idle: 0.5, work: 2.2 },
  toyFactory: { kind: 'spin', idle: 0, work: 2.4 },
};

/** One town building (see the file header for the contract). */
export function createBusinessModel(id: BusinessId): BusinessModel {
  const baked = (bakedCache[id] ??= BAKE[id]());
  const root = new THREE.Group();
  root.name = `town:${id}`;
  const body = new THREE.Mesh(baked.body, vcMat());
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = `${id}:body`;
  root.add(body);
  const glow = new THREE.Mesh(baked.glow, baked.glowKind === 'oven' ? ovenMat() : baked.glowKind === 'pale' ? paleMat() : glowMat());
  glow.castShadow = false;
  glow.receiveShadow = false;
  glow.name = `${id}:glow`;
  root.add(glow);
  let pivot: THREE.Mesh | null = null;
  if (baked.pivot) {
    pivot = new THREE.Mesh(baked.pivot, vcMat());
    pivot.castShadow = true;
    pivot.receiveShadow = true;
    pivot.position.copy(baked.pivotAt);
    pivot.name = `${id}:pivot`;
    root.add(pivot);
  }
  const cfg = PIVOT[id];
  let speed = cfg.idle;
  let t = 0;
  let level = 0; // eased 0 (idle) … 1 (working)
  const mat = id === 'bakery' ? ovenMat() : null;
  const animate = (dt: number, working: boolean): void => {
    level += ((working ? 1 : 0) - level) * Math.min(1, dt * 3);
    speed = cfg.idle + (cfg.work - cfg.idle) * level;
    t += dt * speed;
    if (pivot) {
      if (cfg.kind === 'spin') pivot.rotation.z = -t;
      else if (cfg.kind === 'swing') pivot.rotation.x = Math.sin(t * 2.2) * (0.06 + 0.2 * level);
    }
    if (mat) {
      // pulsing oven glow: scale the emissive colour (the night registry scales the intensity)
      const k = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.4)) * (0.35 + 0.65 * level) + 0.05 * level;
      mat.emissive.setRGB(k, 0.62 * k, 0.25 * k);
    }
  };
  return { root, w: 3.8, d: 2.8, chimney: baked.chimney ? baked.chimney.clone() : null, glow: [glow], animate };
}

// ---------------------------------------------------------------------------
// lot for sale
// ---------------------------------------------------------------------------

/** 3x5 pixel font for the sign. */
const FONT: Record<string, readonly string[]> = {
  F: ['111', '100', '110', '100', '100'],
  O: ['111', '101', '101', '101', '111'],
  R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  E: ['111', '100', '110', '100', '111'],
};

function pixelText(k: Kit, text: string, cx: number, cy: number, z: number, px: number, color: number): void {
  const wTotal = text.length * 3 * px + (text.length - 1) * px;
  let x0 = cx - wTotal / 2 + px / 2;
  for (const ch of text) {
    const rows = FONT[ch]!;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (rows[r]![c] === '1') k.box(color, px * 0.96, px * 0.96, 0.03, x0 + c * px, cy + (2 - r) * px, z);
      }
    }
    x0 += 4 * px;
  }
}

let lotGeo: THREE.BufferGeometry | null = null;
function bakeLot(): THREE.BufferGeometry {
  const k = new Kit();
  const h = 1.7;
  // flattened snow plot with a darker trodden border
  k.box(SNOW_SH, 3.7, 0.05, 3.7, 0, 0.025, 0);
  k.box(SNOW, 3.4, 0.09, 3.4, 0, 0.045, 0);
  const stake = new THREE.CylinderGeometry(0.05, 0.07, 0.6, 6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.add(stake, PALETTE.fence, sx * h, 0.3, sz * h);
      k.sph(COLORS.COURIER_YELLOW, 0.08, sx * h, 0.62, sz * h);
      k.sph(SNOW, 0.28, sx * (h + 0.1), 0.03, sz * (h + 0.1), { sy: 0.4 });
    }
  }
  const rope = 0xe0cfa8;
  for (const s of [-1, 1]) {
    k.box(rope, 2 * h, 0.035, 0.035, 0, 0.45, s * h);
    k.box(rope, 0.035, 0.035, 2 * h, s * h, 0.45, 0);
  }
  // a few bumps and tufts so the plot reads as virgin ground
  for (const [x, z, r] of [[-0.8, -0.9, 0.35], [0.9, -0.3, 0.3], [-0.2, 0.5, 0.25], [1.0, 0.9, 0.3]] as const) k.sph(SNOW, r, x, 0.05, z, { sy: 0.35 });
  for (const [x, z] of [[-0.5, -1.2], [0.6, -1.0], [1.2, 0.2]] as const) {
    for (let i = 0; i < 3; i++) k.box(0x8aa56a, 0.025, 0.14, 0.025, x + i * 0.04, 0.17, z + (i % 2) * 0.03, { rz: (i - 1) * 0.3 });
  }
  // FOR SALE sign on two posts at the front-left
  const sx = -0.7;
  const sz = 1.95;
  k.box(PALETTE.fenceDark, 0.09, 1.2, 0.09, sx - 0.5, 0.6, sz);
  k.box(PALETTE.fenceDark, 0.09, 1.2, 0.09, sx + 0.5, 0.6, sz);
  k.box(BARN_RED, 1.3, 0.86, 0.06, sx, 1.1, sz + 0.04);
  k.box(0xf6e8c0, 1.2, 0.76, 0.05, sx, 1.1, sz + 0.07);
  pixelText(k, 'FOR', sx, 1.27, sz + 0.1, 0.075, BARN_RED);
  pixelText(k, 'SALE', sx, 0.97, sz + 0.1, 0.075, BARN_RED);
  k.box(SNOW, 1.34, 0.08, 0.14, sx, 1.57, sz + 0.04);
  return k.geometry();
}

/** An empty lot for sale: snowy staked plot + a little "FOR SALE" signboard near the front edge (local +Z). One mesh. */
export function createLotForSale(): THREE.Group {
  lotGeo ??= bakeLot();
  const g = new THREE.Group();
  g.name = 'town:lot';
  const m = new THREE.Mesh(lotGeo, vcMat());
  m.castShadow = false;
  m.receiveShadow = true;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// scaffold
// ---------------------------------------------------------------------------

/** Timber scaffold sized for a town lot, growing with the paid share (0…1). */
export interface TownScaffold {
  readonly group: THREE.Group;
  setProgress(p: number): void;
}

let scaffoldGeo: THREE.BufferGeometry | null = null;
function bakeScaffold(): THREE.BufferGeometry {
  const k = new Kit();
  const hx = 1.7;
  const hz = 1.35;
  const cz = -0.55;
  const H = 3.0;
  const post = new THREE.BoxGeometry(0.15, H, 0.15);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(post, PALETTE.fence, sx * hx, H / 2, cz + sz * hz);
  // intermediate posts on the long faces
  for (const sz of [-1, 1]) k.add(post, PALETTE.fence, 0, H / 2, cz + sz * hz);
  for (const y of [0.7, 1.4, 2.1, 2.8]) {
    for (const s of [-1, 1]) {
      k.box(PALETTE.plank, 2 * hx + 0.15, 0.1, 0.1, 0, y, cz + s * hz);
      k.box(PALETTE.plank, 0.1, 0.1, 2 * hz + 0.15, s * hx, y, cz);
    }
  }
  // diagonal braces on the front and +x faces
  const ang = Math.atan2(1.4, hx);
  for (const s of [-1, 1]) {
    k.box(PALETTE.fenceDark, Math.hypot(hx, 1.4), 0.08, 0.08, (-hx / 2) * s, 1.4, cz + hz + 0.06, { rz: s * ang });
    k.box(PALETTE.fenceDark, Math.hypot(hz, 1.4), 0.08, 0.08, hx + 0.06, 1.4, cz + (hz / 2) * s, { ry: Math.PI / 2, rz: -s * Math.atan2(1.4, hz) });
  }
  // platform decks at two heights, a ladder, a stack of boards and a sack of nails
  for (const y of [1.42, 2.12]) {
    for (let i = 0; i < 6; i++) k.box(i % 2 ? PALETTE.plank : PALETTE.crate, 0.5, 0.05, 2 * hz - 0.1, -hx + 0.35 + i * 0.6, y, cz);
  }
  k.box(PALETTE.fenceDark, 0.07, 2.2, 0.07, hx + 0.25, 1.1, 0.0, { rz: -0.12 });
  k.box(PALETTE.fenceDark, 0.07, 2.2, 0.07, hx + 0.25, 1.1, 0.4, { rz: -0.12 });
  for (let i = 0; i < 6; i++) k.box(PALETTE.plank, 0.05, 0.05, 0.45, hx + 0.25 - 0.12 * (0.2 + i * 0.3), 0.25 + i * 0.35, 0.2);
  for (let i = 0; i < 4; i++) k.box(COLORS.PLANK_WOOD, 1.0, 0.06, 0.3, -0.8, 0.04 + i * 0.07, hz + cz + 0.5);
  k.cyl(0xcfa66a, 0.17, 0.2, 0.34, 0.7, 0.17, cz + hz + 0.5, 8);
  // red pennant on top
  k.box(PALETTE.fenceDark, 0.05, 0.6, 0.05, -hx, H + 0.3, cz + hz);
  k.prismXY(BARN_RED, [[0, 0], [0, 0.26], [0.5, 0.13]], 0.02, -hx + 0.03, H + 0.3, cz + hz - 0.01, { ry: 0 });
  return k.geometry();
}

export function createTownScaffold(): TownScaffold {
  scaffoldGeo ??= bakeScaffold();
  const group = new THREE.Group();
  group.name = 'town:scaffold';
  const m = new THREE.Mesh(scaffoldGeo, vcMat());
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  const setProgress = (p: number): void => {
    group.scale.y = 0.35 + 0.65 * Math.max(0, Math.min(1, p));
  };
  setProgress(0);
  return { group, setProgress };
}

// ---------------------------------------------------------------------------
// station props
// ---------------------------------------------------------------------------

/** Station props in front of a business (local frames: +Z = toward the square). `topY` = where a pile's base sits. */
export interface StationProp {
  readonly root: THREE.Group;
  readonly topY: number;
}

function propOf(geo: THREE.BufferGeometry, name: string, topY: number): StationProp {
  const root = new THREE.Group();
  root.name = name;
  const m = new THREE.Mesh(geo, vcMat());
  m.castShadow = true;
  m.receiveShadow = true;
  root.add(m);
  return { root, topY };
}

let hopperGeo: THREE.BufferGeometry | null = null;
function bakeHopper(): THREE.BufferGeometry {
  const k = new Kit();
  const W = 1.1;
  const D = 1.0;
  const H = 0.5;
  const WOOD = 0x9a6a42;
  // skids + 4 boards + corner posts; the inner floor sits just under topY so a pile rests in the bin
  k.box(PALETTE.barkDark, W - 0.1, 0.07, 0.12, 0, 0.035, -D / 2 + 0.12);
  k.box(PALETTE.barkDark, W - 0.1, 0.07, 0.12, 0, 0.035, D / 2 - 0.12);
  k.box(0x4a3220, W - 0.1, 0.04, D - 0.1, 0, H - 0.05, 0);
  for (const s of [-1, 1]) {
    k.box(WOOD, W, H - 0.1, 0.08, 0, 0.07 + (H - 0.1) / 2 + 0.03, (s * (D - 0.08)) / 2);
    k.box(WOOD, 0.08, H - 0.1, D - 0.16, (s * (W - 0.08)) / 2, 0.07 + (H - 0.1) / 2 + 0.03, 0);
    k.box(IRON, W + 0.01, 0.04, 0.09, 0, 0.17, (s * (D - 0.08)) / 2);
    k.box(IRON, W + 0.01, 0.04, 0.09, 0, 0.36, (s * (D - 0.08)) / 2);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(PALETTE.barkDark, 0.12, H, 0.12, (sx * (W - 0.12)) / 2, H / 2, (sz * (D - 0.12)) / 2);
  k.box(SNOW, 0.14, 0.03, 0.14, (W - 0.12) / 2, H + 0.015, (D - 0.12) / 2);
  k.box(SNOW, 0.14, 0.03, 0.14, -(W - 0.12) / 2, H + 0.015, -(D - 0.12) / 2);
  // hanging scoop on the front-right
  k.box(PALETTE.fenceDark, 0.04, 0.04, 0.12, 0.4, 0.4, D / 2 + 0.05);
  return k.geometry();
}
/** Wooden hopper bin for a shop's inputs (≈1.1 × 1.0 m). */
export function createHopperBin(): StationProp {
  hopperGeo ??= bakeHopper();
  return propOf(hopperGeo, 'town:hopper', 0.5);
}

let counterGeo: THREE.BufferGeometry | null = null;
function bakeCounter(): THREE.BufferGeometry {
  const k = new Kit();
  const W = 1.6;
  const D = 0.8;
  const WOOD = 0xa87142;
  // cabinet with vertical planks, a cream cloth top and a red/white valance on the front
  k.box(WOOD, W, 0.78, D, 0, 0.39, 0);
  for (let i = 1; i < 8; i++) k.box(0x8a5a33, 0.02, 0.7, 0.01, -W / 2 + (i * W) / 8, 0.4, D / 2 + 0.003);
  k.box(0x6b4226, W + 0.06, 0.07, D + 0.06, 0, 0.865, 0);
  k.box(0xf6e8c0, W - 0.04, 0.035, D - 0.04, 0, 0.8825, 0);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? 0xf6f0e4 : BARN_RED;
    k.box(c, W / n - 0.005, 0.16, 0.03, -W / 2 + (i + 0.5) * (W / n), 0.78, D / 2 + 0.05);
    k.cyl(c, W / n / 2 - 0.005, W / n / 2 - 0.005, 0.03, -W / 2 + (i + 0.5) * (W / n), 0.7, D / 2 + 0.05, 8, { rx: Math.PI / 2 });
  }
  // awning: two back posts, a slanted striped canopy above and behind the goods
  for (const s of [-1, 1]) k.box(PALETTE.fenceDark, 0.07, 1.9, 0.07, s * 0.74, 0.95, -D / 2 + 0.04);
  const drop = 0.3;
  const depth = 0.95;
  const ang = Math.atan2(drop, depth);
  const slope = Math.hypot(depth, drop);
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    const c = i % 2 ? 0xf6f0e4 : BARN_RED;
    const x = -0.85 + (i + 0.5) * (1.7 / stripes);
    k.box(c, 1.7 / stripes - 0.005, 0.045, slope, x, 2.0 - drop / 2, -D / 2 + 0.04 + depth / 2, { rx: ang });
    k.box(c, 1.7 / stripes - 0.005, 0.12, 0.04, x, 2.0 - drop - 0.06, -D / 2 + 0.04 + depth);
  }
  k.box(SNOW, 1.55, 0.05, 0.6, 0, 2.02 - drop / 2 + 0.03, -D / 2 + 0.3, { rx: ang });
  return k.geometry();
}
/** Shop counter with an awning (≈1.6 × 0.8 m, top at ~0.9 m) where goods sit for sale. */
export function createShopCounter(): StationProp {
  counterGeo ??= bakeCounter();
  return propOf(counterGeo, 'town:counter', 0.9);
}

let palletGeo: THREE.BufferGeometry | null = null;
function bakePallet(): THREE.BufferGeometry {
  const k = new Kit();
  const W = 1.4;
  const D = 1.2;
  for (const x of [-0.6, 0, 0.6]) k.box(PALETTE.barkDark, 0.16, 0.06, D - 0.04, x, 0.03, 0);
  for (let i = 0; i < 7; i++) k.box(i % 2 ? 0xb0875c : 0x9b7653, (W - 0.12) / 7 - 0.02, 0.05, D, -W / 2 + 0.06 + (i + 0.5) * ((W - 0.12) / 7), 0.115, 0);
  k.box(0x8a6a48, W, 0.025, 0.12, 0, 0.1, D / 2 - 0.08);
  return k.geometry();
}
/** Low pallet a producer's goods pile up on (≈1.4 × 1.2 m). */
export function createOutPallet(): StationProp {
  palletGeo ??= bakePallet();
  return propOf(palletGeo, 'town:pallet', 0.14);
}

// ---------------------------------------------------------------------------
// gallery
// ---------------------------------------------------------------------------

export const townCatalog: Record<string, () => THREE.Object3D> = {
  farm: () => createBusinessModel('farm').root,
  bakery: () => createBusinessModel('bakery').root,
  townhouse: () => createBusinessModel('townhouse').root,
  ranch: () => createBusinessModel('ranch').root,
  butcher: () => createBusinessModel('butcher').root,
  toyFactory: () => createBusinessModel('toyFactory').root,
  lotForSale: () => createLotForSale(),
  townScaffold: () => createTownScaffold().group,
  hopperBin: () => createHopperBin().root,
  shopCounter: () => createShopCounter().root,
  outPallet: () => createOutPallet().root,
};
