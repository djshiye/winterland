/**
 * [wave 13 — assets] The Grand Market: the Winterland-era finale on the market square's south-east corner. A long
 * timber hall with a high gabled roof, a central clock gable, two rows of lit arched windows, a covered colonnade
 * along the front with hanging lanterns and bunting, two brick chimneys and a flagpole with a banner on the clock
 * gable. Baked once into THREE meshes (3 draw calls, +1 in the shadow pass for the body):
 *   body  — shared vertex-coloured toon material (render/batch vcMat)
 *   glow  — window panes, the door and the clock face: the shared warm window material (same cached, registered
 *           one the town buildings / amenities use, so it brightens at night with them)
 *   bulbs — lantern lights + the eave string of bulbs: the shared unlit string-light bulb material
 *           (world/env/glow.ts bulbMaterial)
 *
 * CONTRACT (town/Town.ts uses it):
 * - createGrandMarketModel(): { root, w, d, glow, chimney }. Local frame: origin on the ground at the SITE CENTRE,
 *   the FRONT (colonnade, door) faces local +Z. Town keeps +Z pointing south (rules.grandMarketFrame, yaw 0): the
 *   side the isometric camera sees.
 *   Footprint LAYOUT.town.grandMarket.w (x) × d (z); everything, overhangs included, stays inside it.
 * - chimney: two local chimney-mouth points (Town turns them into world smoke sources, round-robin with the rest).
 * - Geometry is cached, so any number of instances share GPU buffers.
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../config';
import { Batch, vcMat } from '../render/batch';
import { toon } from '../render/materials';
import { bulbMaterial, registerGlow } from '../world/env/glow';

export interface GrandMarketModel {
  readonly root: THREE.Group;
  /** Footprint (local X × Z) in metres. */
  readonly w: number;
  readonly d: number;
  /** Meshes that glow at night (windows + bulbs). */
  readonly glow: THREE.Mesh[];
  /** Local chimney mouths (smoke sources). */
  readonly chimney: THREE.Vector3[];
}

const SNOW = COLORS.SNOW_WHITE;
const SNOW_SH = PALETTE.snowShade;
const WARM = 0xffd978;
const BULB = 0xfff1b8;
const WOOD = 0xb98450;
const WOOD_L = 0xd9a86a;
const TIMBER = 0x6b4226;
const TIMBER_D = 0x3c2514;
const CREAM = 0xf3e6c8;
const RED = 0xd8432f;
const RED_D = 0xa8321f;
const GREEN = 0x2f9d6a;
const BLUE = 0x3f86c8;
const YELLOW = 0xf2c23a;
const BRICK = 0xa4533a;
const BRICK_D = 0x7e3d2a;
const IRON = 0x3b3f47;
const GOLD = 0xe8b53a;

let warmGlow: THREE.MeshToonMaterial | null = null;
/** Same cached material (same colour + options, same key order) the town buildings, shelters and amenities use. */
function glowMat(): THREE.MeshToonMaterial {
  warmGlow ??= registerGlow(toon(WARM, { emissive: 0xffb347, emissiveIntensity: 0.65 }));
  return warmGlow;
}

// ---------------------------------------------------------------------------
// Kit (a Batch plus the handful of primitives the hall needs)
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
  private readonly L = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();

  add(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o?: Rot): void {
    this.e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0);
    this.q.setFromEuler(this.e);
    this.s.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    this.p.set(x, y, z);
    this.L.compose(this.p, this.q, this.s);
    this.batch.addMatrix(g, color, this.L);
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

  sph(color: number, r: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`s${r}`, () => new THREE.SphereGeometry(r, 8, 6)), color, x, y, z, o);
  }

  /**
   * Triangular gable plate: base `bw` wide (x), `h` tall (y), `t` thick (z); base on y = 0, centred on x and z.
   * `side` true = the plate for a gable whose ridge runs along x (the triangle lies in the z-y plane).
   */
  gable(color: number, bw: number, h: number, t: number, x: number, y: number, z: number, side = false): void {
    const g = cached(`g${bw}|${h}|${t}|${side}`, () => {
      const sh = new THREE.Shape();
      sh.moveTo(-bw / 2, 0);
      sh.lineTo(bw / 2, 0);
      sh.lineTo(0, h);
      sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
      geo.translate(0, 0, -t / 2);
      if (side) geo.rotateY(Math.PI / 2);
      return geo;
    });
    this.add(g, color, x, y, z);
  }
}

// ---------------------------------------------------------------------------
// The hall
// ---------------------------------------------------------------------------

const BODY_X = 1.9; // half width of the walls
const WALL_Z0 = -1.4; // back wall
const WALL_Z1 = 0.55; // front wall
const WALL_H = 2.4;
const BASE = 0.06; // top of the plinth
const EAVE = BASE + WALL_H;
const RIDGE_Z = (WALL_Z0 + WALL_Z1) / 2;
const RUN = 1.05;
const RISE = 1.15;
const ROOF_X = 2.05;

/** Lit arched window: dark frame with an arched top, a warm pane (+ arched top) in front of it. */
function archWindow(k: Kit, g: Kit, x: number, y: number, z: number): void {
  k.box(TIMBER_D, 0.34, 0.42, 0.05, x, y - 0.04, z);
  k.cyl(TIMBER_D, 0.17, 0.17, 0.05, x, y + 0.17, z, 10, { rx: Math.PI / 2 });
  g.box(WARM, 0.25, 0.32, 0.03, x, y - 0.04, z + 0.025);
  g.cyl(WARM, 0.125, 0.125, 0.03, x, y + 0.12, z + 0.025, 10, { rx: Math.PI / 2 });
  // mullion cross + sill
  k.box(TIMBER, 0.02, 0.48, 0.01, x, y + 0.02, z + 0.045);
  k.box(TIMBER, 0.27, 0.02, 0.01, x, y + 0.0, z + 0.045);
  k.box(WOOD_L, 0.4, 0.04, 0.1, x, y - 0.26, z + 0.04);
}

function bakeHall(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry; bulbs: THREE.BufferGeometry; chimney: THREE.Vector3[] } {
  const w = LAYOUT.town.grandMarket.w;
  const d = LAYOUT.town.grandMarket.d;
  const k = new Kit();
  const g = new Kit();
  const b = new Kit();
  const midZ = (WALL_Z0 + WALL_Z1) / 2;
  const wallD = WALL_Z1 - WALL_Z0;

  // plinth (packed snow) + walls: plank base, cream plaster above, timber frame
  k.box(SNOW_SH, w - 0.04, 0.06, d - 0.04, 0, 0.03, 0);
  k.box(CREAM, BODY_X * 2, WALL_H, wallD, 0, BASE + WALL_H / 2, midZ);
  k.box(WOOD, BODY_X * 2 + 0.04, 0.46, wallD + 0.04, 0, BASE + 0.23, midZ);
  // corner posts, a horizontal beam between the two window rows, a top plate
  for (const sx of [-1, 1]) for (const sz of [WALL_Z0, WALL_Z1]) k.box(TIMBER, 0.14, WALL_H, 0.14, sx * (BODY_X - 0.02), BASE + WALL_H / 2, sz);
  k.box(TIMBER, BODY_X * 2 + 0.06, 0.09, 0.07, 0, 1.74, WALL_Z1 + 0.01);
  k.box(TIMBER, BODY_X * 2 + 0.06, 0.1, 0.08, 0, EAVE - 0.05, WALL_Z1 + 0.01);
  for (const sx of [-1, 1]) k.box(TIMBER, 0.1, WALL_H, 0.06, sx * 0.97, BASE + WALL_H / 2, WALL_Z1 + 0.02); // frame posts either side of the doorway bay

  // two rows of lit arched windows on the front: lower row (under the colonnade) and upper row
  const wz = WALL_Z1 + 0.03;
  for (const wx of [-1.45, -0.6, 0.6, 1.45]) {
    archWindow(k, g, wx, 0.74, wz);
    archWindow(k, g, wx, 2.0, wz);
  }
  // the doorway: a tall arched double door, lit, with a step
  k.box(TIMBER_D, 0.78, 0.98, 0.05, 0, BASE + 0.49, wz);
  k.cyl(TIMBER_D, 0.39, 0.39, 0.05, 0, BASE + 0.98, wz, 12, { rx: Math.PI / 2 });
  g.box(WARM, 0.64, 0.92, 0.03, 0, BASE + 0.46, wz + 0.025);
  g.cyl(WARM, 0.32, 0.32, 0.03, 0, BASE + 0.92, wz + 0.025, 12, { rx: Math.PI / 2 });
  k.box(TIMBER, 0.03, 1.2, 0.01, 0, BASE + 0.62, wz + 0.045);
  k.box(WOOD_L, 0.9, 0.05, 0.22, 0, 0.04, wz + 0.1);
  // upper centre bay: a timber cross-brace pattern under the clock gable
  k.box(TIMBER, 0.05, 0.62, 0.01, 0, 2.05, wz + 0.01, { rz: 0.9 });
  k.box(TIMBER, 0.05, 0.62, 0.01, 0, 2.05, wz + 0.01, { rz: -0.9 });
  // side windows (lit) on both end walls
  for (const sx of [-1, 1]) {
    for (const sz of [-0.9, 0.0]) {
      k.box(TIMBER_D, 0.05, 0.5, 0.34, sx * (BODY_X + 0.01), 1.45, sz);
      g.box(WARM, 0.03, 0.34, 0.24, sx * (BODY_X + 0.03), 1.43, sz);
    }
  }

  // main roof: two steep slabs (ridge along x), snow on top, end gable plates with a round lit window each
  const ang = Math.atan2(RISE, RUN);
  const slope = Math.hypot(RUN, RISE) + 0.06;
  for (const sg of [-1, 1]) {
    k.box(sg > 0 ? RED : RED_D, ROOF_X * 2, 0.1, slope, 0, EAVE + RISE / 2, RIDGE_Z + (sg * RUN) / 2, { rx: sg * ang });
    k.box(SNOW, ROOF_X * 2 - 0.12, 0.12, slope - 0.14, 0, EAVE + RISE / 2 + 0.1, RIDGE_Z + (sg * RUN) / 2 - sg * 0.05, { rx: sg * ang });
  }
  k.box(SNOW, ROOF_X * 2, 0.1, 0.2, 0, EAVE + RISE + 0.07, RIDGE_Z);
  for (const sx of [-1, 1]) {
    k.gable(CREAM, wallD + 0.1, RISE - 0.02, 0.08, sx * (BODY_X - 0.04), EAVE - 0.02, RIDGE_Z, true);
    g.cyl(WARM, 0.15, 0.15, 0.03, sx * (BODY_X + 0.01), EAVE + 0.52, RIDGE_Z, 10, { rz: Math.PI / 2 });
    k.cyl(TIMBER_D, 0.2, 0.2, 0.03, sx * (BODY_X + 0.0), EAVE + 0.52, RIDGE_Z, 10, { rz: Math.PI / 2 });
  }

  // central clock gable (cross gable, ridge along z) rising out of the front slope
  const cgW = 1.3;
  const cgZ1 = WALL_Z1 + 0.07;
  const cgZ0 = RIDGE_Z - 0.2;
  const cgBaseY = EAVE - 0.06;
  const cgWallTop = 3.55;
  k.box(CREAM, cgW, cgWallTop - cgBaseY, cgZ1 - cgZ0, 0, (cgBaseY + cgWallTop) / 2, (cgZ0 + cgZ1) / 2);
  for (const sx of [-1, 1]) k.box(TIMBER, 0.1, cgWallTop - cgBaseY, 0.08, sx * (cgW / 2 - 0.02), (cgBaseY + cgWallTop) / 2, cgZ1);
  const cgRise = 0.8;
  const cgRun = cgW / 2 + 0.08;
  const cgAng = Math.atan2(cgRise, cgRun);
  const cgSlope = Math.hypot(cgRun, cgRise) + 0.04;
  const cgLen = cgZ1 - cgZ0 + 0.2;
  for (const sg of [-1, 1]) {
    k.box(sg > 0 ? RED_D : RED, cgSlope, 0.09, cgLen, (sg * cgRun) / 2, cgWallTop + cgRise / 2, (cgZ0 + cgZ1) / 2 + 0.1, { rz: -sg * cgAng });
    k.box(SNOW, cgSlope - 0.1, 0.1, cgLen - 0.1, (sg * cgRun) / 2 - sg * 0.04, cgWallTop + cgRise / 2 + 0.09, (cgZ0 + cgZ1) / 2 + 0.1, { rz: -sg * cgAng });
  }
  k.box(SNOW, 0.2, 0.09, cgLen, 0, cgWallTop + cgRise + 0.06, (cgZ0 + cgZ1) / 2 + 0.1);
  k.gable(CREAM, cgW + 0.04, cgRise - 0.02, 0.06, 0, cgWallTop - 0.01, cgZ1 + 0.005);
  k.box(TIMBER, cgW + 0.14, 0.07, 0.09, 0, cgWallTop - 0.02, cgZ1 + 0.02);
  // clock: dark rim, lit face, two hands
  const cy = cgWallTop - 0.5;
  const cz = cgZ1 + 0.03;
  k.cyl(TIMBER_D, 0.3, 0.3, 0.05, 0, cy, cz, 16, { rx: Math.PI / 2 });
  g.cyl(WARM, 0.25, 0.25, 0.03, 0, cy, cz + 0.03, 16, { rx: Math.PI / 2 });
  k.box(TIMBER_D, 0.025, 0.14, 0.012, 0, cy + 0.06, cz + 0.055);
  k.box(TIMBER_D, 0.12, 0.025, 0.012, 0.05, cy, cz + 0.055);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    k.box(TIMBER_D, 0.02, 0.04, 0.012, Math.sin(a) * 0.2, cy + Math.cos(a) * 0.2, cz + 0.055);
  }
  // flagpole on the peak + a big banner (red, gold trim) streaming to the east, and a small pennant on top
  const peak = cgWallTop + cgRise + 0.1;
  const poleZ = (cgZ0 + cgZ1) / 2 + 0.05;
  k.cyl(IRON, 0.022, 0.03, 1.0, 0, peak + 0.5, poleZ, 6);
  k.sph(GOLD, 0.045, 0, peak + 1.03, poleZ);
  k.box(RED, 0.62, 0.34, 0.02, 0.33, peak + 0.76, poleZ);
  k.box(GOLD, 0.62, 0.04, 0.025, 0.33, peak + 0.9, poleZ);
  k.box(GOLD, 0.62, 0.04, 0.025, 0.33, peak + 0.62, poleZ);
  k.cone(RED, 0.17, 0.2, 0.7, peak + 0.76, poleZ, 4, { rz: -Math.PI / 2, sz: 0.12 }); // swallow-tail
  k.box(GOLD, 0.1, 0.1, 0.03, 0.12, peak + 0.76, poleZ + 0.001);

  // brick chimneys at the back of the roof (smoke from their mouths)
  const chimney: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    const cx = sx * 1.4;
    const cz2 = RIDGE_Z - 0.5;
    k.box(BRICK, 0.34, 1.5, 0.34, cx, 3.05, cz2);
    for (const yy of [2.7, 3.0, 3.3, 3.6]) k.box(BRICK_D, 0.36, 0.04, 0.36, cx, yy, cz2);
    k.box(IRON, 0.42, 0.06, 0.42, cx, 3.83, cz2);
    k.box(SNOW, 0.4, 0.07, 0.4, cx, 3.9, cz2);
    chimney.push(new THREE.Vector3(cx, 4.0, cz2));
  }

  // covered colonnade along the front: deck, posts, beam, braces, a lean-to roof with snow
  const colZ0 = WALL_Z1;
  const colZ1 = 1.46;
  const colMid = (colZ0 + colZ1) / 2;
  k.box(WOOD_L, BODY_X * 2 + 0.1, 0.05, colZ1 - colZ0 - 0.02, 0, BASE + 0.025, colMid);
  const postZ = colZ1 - 0.08;
  const postXs = [-1.8, -0.9, 0, 0.9, 1.8];
  for (const px of postXs) {
    k.cyl(TIMBER, 0.055, 0.065, 1.4, px, BASE + 0.7, postZ, 8);
    k.box(TIMBER_D, 0.14, 0.05, 0.14, px, BASE + 0.03, postZ);
  }
  k.box(TIMBER, BODY_X * 2 + 0.2, 0.12, 0.12, 0, 1.5, postZ);
  for (let i = 0; i < postXs.length; i++) {
    const px = postXs[i]!;
    if (i > 0) k.box(TIMBER, 0.24, 0.05, 0.05, px - 0.13, 1.38, postZ, { rz: -0.8 });
    if (i < postXs.length - 1) k.box(TIMBER, 0.24, 0.05, 0.05, px + 0.13, 1.38, postZ, { rz: 0.8 });
  }
  const lean = Math.atan2(0.12, colZ1 - colZ0);
  const leanLen = Math.hypot(colZ1 - colZ0, 0.12) + 0.04;
  k.box(RED_D, ROOF_X * 2 - 0.1, 0.07, leanLen, 0, 1.6, colMid, { rx: lean });
  k.box(SNOW, ROOF_X * 2 - 0.2, 0.09, leanLen - 0.1, 0, 1.67, colMid - 0.02, { rx: lean });

  // hanging lanterns under the beam (iron cage + a bulb each) and bunting along the beam
  for (const lx of [-1.35, -0.45, 0.45, 1.35]) {
    k.cyl(IRON, 0.008, 0.008, 0.2, lx, 1.34, postZ, 4);
    k.box(IRON, 0.13, 0.03, 0.13, lx, 1.23, postZ);
    k.box(IRON, 0.13, 0.03, 0.13, lx, 1.05, postZ);
    for (const cx of [-1, 1]) for (const cz3 of [-1, 1]) k.box(IRON, 0.02, 0.18, 0.02, lx + cx * 0.055, 1.14, postZ + cz3 * 0.055);
    b.box(BULB, 0.08, 0.12, 0.08, lx, 1.14, postZ);
  }
  const flags = [RED, YELLOW, BLUE, GREEN];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const fx = -1.9 + t * 3.8;
    const sag = Math.sin(t * Math.PI) * 0.1;
    k.cone(flags[i % flags.length]!, 0.075, 0.17, fx, 1.36 - sag, colZ1 + 0.02, 4, { rx: Math.PI, sz: 0.15 });
  }
  // string of bulbs along the main eave and up the clock gable
  const bulbGeoY = EAVE - 0.03;
  for (let i = 0; i < 12; i++) {
    const x = -1.9 + ((i + 0.5) / 12) * 3.8;
    if (Math.abs(x) < 0.68) continue;
    b.sph(BULB, 0.045, x, bulbGeoY, WALL_Z1 + 0.1);
  }
  for (const sg of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      b.sph(BULB, 0.04, sg * (cgW / 2 + 0.06) * (1 - t), cgWallTop + cgRise * t + 0.02, cgZ1 + 0.1);
    }
  }

  return { body: k.batch.geometry(), glow: g.batch.geometry(), bulbs: b.batch.geometry(), chimney };
}

let baked: ReturnType<typeof bakeHall> | null = null;

export function createGrandMarketModel(): GrandMarketModel {
  baked ??= bakeHall();
  const { w, d } = LAYOUT.town.grandMarket;
  const root = new THREE.Group();
  root.name = 'grandMarket';
  const body = new THREE.Mesh(baked.body, vcMat());
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = 'grandMarket:body';
  root.add(body);
  const win = new THREE.Mesh(baked.glow, glowMat());
  win.castShadow = false;
  win.receiveShadow = false;
  win.name = 'grandMarket:glow';
  root.add(win);
  const bulbs = new THREE.Mesh(baked.bulbs, bulbMaterial());
  bulbs.castShadow = false;
  bulbs.receiveShadow = false;
  bulbs.name = 'grandMarket:bulbs';
  root.add(bulbs);
  return { root, w, d, glow: [win, bulbs], chimney: baked.chimney.map((c) => c.clone()) };
}

export const grandMarketCatalog: Record<string, () => THREE.Object3D> = {
  grandMarket: () => createGrandMarketModel().root,
};
