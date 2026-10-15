/**
 * [wave 12 — assets] The four square amenities (procedural). Each is baked once into ONE vertex-coloured body mesh
 * (shared vcMat) plus at most ONE glow mesh, so a model costs 2 draw calls (+ 2 in the shadow pass for the body).
 *
 * CONTRACT (town/Town.ts uses it):
 * - createAmenityModel(id): { root, w, d, glow, steam, animate }. Local frame: origin on the ground at the SITE
 *   CENTRE, the FRONT (counter, stage, gate) faces local +Z; Town rotates it so +Z points at the pad (rules.amenityFrame).
 *   The footprint is LAYOUT.town.amenities[id].w (x) × d (z): everything, overhangs included, stays inside it.
 * - glow: the mesh that glows at night. Cafe / snowman park / bandstand use the shared warm window material (the same
 *   cached, registered one the town buildings use); the pond uses the shared string-light bulb material
 *   (world/env/glow.ts bulbMaterial: vertex-coloured, unlit, brightens at night).
 * - steam: local point of the cocoa mug sign (cafe only, else null): Town puffs white steam from it.
 * - animate: none (static models; the living crowd is npc/Townsfolk's job).
 * - Geometry is cached per id, so any number of instances share GPU buffers.
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE, type AmenityId } from '../config';
import { Batch, vcMat } from '../render/batch';
import { toon } from '../render/materials';
import { bulbMaterial, registerGlow } from '../world/env/glow';

export interface AmenityModel {
  readonly root: THREE.Group;
  /** Footprint (local X × Z) in metres. */
  readonly w: number;
  readonly d: number;
  /** Meshes that glow at night. */
  readonly glow: THREE.Mesh[];
  /** Local steam source (cafe) or null. */
  readonly steam: THREE.Vector3 | null;
  animate?(t: number): void;
}

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

const SNOW = COLORS.SNOW_WHITE;
const SNOW_SH = PALETTE.snowShade;
const WARM = 0xffd978;
const WOOD = 0xb98450;
const WOOD_L = 0xd9a86a;
const TIMBER = 0x6b4226;
const TIMBER_D = 0x4a2e19;
const CREAM = 0xf3e6c8;
const RED = 0xd8432f;
const RED_D = 0xa8321f;
const GREEN = 0x2f9d6a;
const BLUE = 0x3f86c8;
const YELLOW = 0xf2c23a;
const COCOA = 0x6b3b1e;
const COAL = 0x2a2a2e;
const CARROT = 0xf08a24;
const IRON = 0x3b3f47;
const BRASS = 0xe0a93a;
const ICE = 0x8fd0ee;
const ICE_D = 0x6fb4d8;
const ICE_L = 0xcdeefa;
const BULB = 0xfff1b8;

let warmGlow: THREE.MeshToonMaterial | null = null;
/** Same cached material (same colour + options, same key order) the town buildings and shelters use for windows. */
function glowMat(): THREE.MeshToonMaterial {
  warmGlow ??= registerGlow(toon(WARM, { emissive: 0xffb347, emissiveIntensity: 0.65 }));
  return warmGlow;
}

// ---------------------------------------------------------------------------
// Kit: a Batch with a transform stack and the few primitives the models need
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

  sph(color: number, r: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`s${r}`, () => new THREE.SphereGeometry(r, 10, 7)), color, x, y, z, o);
  }

  torus(color: number, r: number, tube: number, x: number, y: number, z: number, o?: Rot): void {
    this.add(cached(`t${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, 6, 14)), color, x, y, z, o);
  }
}

interface Baked {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  /** Glow mesh material: the shared warm window material or the shared bulb material. */
  glowKind: 'warm' | 'bulb';
  steam: THREE.Vector3 | null;
}

const dims = (id: AmenityId): { w: number; d: number } => {
  const a = LAYOUT.town.amenities[id];
  return { w: a.w, d: a.d };
};

// ---------------------------------------------------------------------------
// COCOA CAFE: a timber kiosk, striped awning, a mug sign on the roof, two tiny tables with stools in front
// ---------------------------------------------------------------------------

/** Local stool seats of the cafe (x, z) and which table (x) each faces. Exported for town/spots.ts. */
export const CAFE_STOOLS: readonly { x: number; z: number; tx: number }[] = [
  { x: -1.0, z: 0.42, tx: -0.62 },
  { x: -0.24, z: 0.42, tx: -0.62 },
  { x: 0.24, z: 0.42, tx: 0.62 },
  { x: 1.0, z: 0.42, tx: 0.62 },
];

function bakeCafe(): Baked {
  const { w, d } = dims('cafe');
  const k = new Kit();
  const g = new Kit();
  const hw = w / 2;
  const hd = d / 2;
  // packed-snow plinth
  k.box(SNOW_SH, w - 0.04, 0.05, d - 0.04, 0, 0.025, 0);
  // kiosk body at the back: z from -hd to -hd + 0.72
  const kd = 0.64;
  const kz = -hd + 0.1 + kd / 2;
  const kw = Math.min(1.8, w - 0.3);
  k.box(WOOD, kw, 1.25, kd, 0, 0.05 + 0.625, kz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(TIMBER, 0.1, 1.3, 0.1, sx * (kw / 2 - 0.02), 0.7, kz + sz * (kd / 2 - 0.02));
  // plank lines on the side walls and a dark band under the window
  k.box(TIMBER, kw + 0.02, 0.06, kd + 0.02, 0, 0.5, kz);
  // serving window (dark frame, warm pane behind) and the counter ledge
  const wz = kz + kd / 2;
  k.box(TIMBER_D, 1.28, 0.58, 0.05, 0, 1.0, wz + 0.005);
  g.box(WARM, 1.14, 0.44, 0.03, 0, 1.0, wz + 0.03);
  k.box(WOOD_L, kw - 0.1, 0.06, 0.28, 0, 0.74, wz + 0.12);
  // two mugs on the ledge
  for (const mx of [-0.3, 0.32]) {
    k.cyl(CREAM, 0.045, 0.04, 0.08, mx, 0.81, wz + 0.14);
    k.cyl(COCOA, 0.036, 0.036, 0.012, mx, 0.855, wz + 0.14);
  }
  // gable roof over the kiosk (ridge along x), snow on top
  const rz = kz;
  const run = kd / 2 + 0.08;
  const rise = 0.34;
  const ang = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise) + 0.05;
  const eave = 1.34;
  for (const sg of [-1, 1]) {
    k.box(sg > 0 ? RED : RED_D, kw + 0.28, 0.1, slope, 0, eave + rise / 2, rz + (sg * run) / 2, { rx: sg * ang });
    k.box(SNOW, kw + 0.16, 0.12, slope - 0.12, 0, eave + rise / 2 + 0.1, rz + (sg * run) / 2 - sg * 0.04, { rx: sg * ang });
  }
  k.box(SNOW, kw + 0.3, 0.1, 0.2, 0, eave + rise + 0.1, rz);
  // gable triangles are open; close with a back/front fascia strip
  k.box(TIMBER, kw + 0.04, 0.12, 0.04, 0, eave - 0.02, rz + run - 0.04);
  // striped awning over the window: five strips sloping out and down, a valance and two slim posts
  const n = 5;
  const aw = kw;
  const depth = 0.42;
  const drop = 0.2;
  const aAng = Math.atan2(drop, depth);
  const aSlope = Math.hypot(depth, drop);
  const sw = aw / n;
  const ay = 1.32;
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? CREAM : RED;
    const sx = -aw / 2 + sw * (i + 0.5);
    k.box(c, sw - 0.005, 0.04, aSlope, sx, ay - drop / 2, wz + depth / 2, { rx: aAng });
    k.box(c, sw - 0.005, 0.1, 0.04, sx, ay - drop - 0.04, wz + depth);
  }
  k.box(SNOW, aw - 0.1, 0.04, aSlope * 0.55, 0, ay - drop / 2 + 0.05, wz + depth * 0.4, { rx: aAng });
  // two slim braces from the wall to the awning's front edge (nothing stands in front, where the tables are)
  for (const sx of [-1, 1]) k.box(TIMBER, 0.035, 0.035, depth + 0.02, sx * (aw / 2 - 0.05), ay - 0.12, wz + depth / 2, { rx: aAng * 0.2 });
  // the cocoa mug sign on the roof: a board on two posts, a glowing face, a big mug with a handle and cream
  const sy = 2.18;
  const sz = rz - 0.02;
  k.box(TIMBER, 0.06, 0.5, 0.06, -0.3, eave + rise + 0.2, sz - 0.02);
  k.box(TIMBER, 0.06, 0.5, 0.06, 0.3, eave + rise + 0.2, sz - 0.02);
  k.box(TIMBER_D, 0.86, 0.62, 0.07, 0, sy, sz);
  g.box(WARM, 0.76, 0.52, 0.02, 0, sy, sz + 0.045);
  k.cyl(COCOA, 0.13, 0.115, 0.24, -0.04, sy - 0.04, sz + 0.075, 10);
  k.cyl(CREAM, 0.135, 0.135, 0.03, -0.04, sy + 0.095, sz + 0.075, 10);
  k.torus(COCOA, 0.07, 0.025, 0.12, sy - 0.04, sz + 0.075);
  k.sph(CREAM, 0.07, -0.04, sy + 0.14, sz + 0.075, { sy: 0.7 });
  k.box(SNOW, 0.9, 0.06, 0.12, 0, sy + 0.34, sz);
  // the sign reads from behind too (it is seen from every side of the square): glowing face, mug, handle on the other side
  g.box(WARM, 0.76, 0.52, 0.02, 0, sy, sz - 0.045);
  k.cyl(COCOA, 0.13, 0.115, 0.24, 0.04, sy - 0.04, sz - 0.075, 10);
  k.cyl(CREAM, 0.135, 0.135, 0.03, 0.04, sy + 0.095, sz - 0.075, 10);
  k.torus(COCOA, 0.07, 0.025, -0.12, sy - 0.04, sz - 0.075);
  k.sph(CREAM, 0.07, 0.04, sy + 0.14, sz - 0.075, { sy: 0.7 });
  // back wall: a plank door with a brass knob and a little lit window
  const bz = kz - kd / 2;
  k.box(TIMBER, 0.46, 0.92, 0.04, -0.45, 0.51, bz - 0.01);
  k.box(WOOD_L, 0.38, 0.84, 0.03, -0.45, 0.51, bz - 0.03);
  k.sph(BRASS, 0.025, -0.32, 0.5, bz - 0.06);
  k.box(TIMBER_D, 0.5, 0.4, 0.04, 0.4, 0.95, bz - 0.01);
  g.box(WARM, 0.38, 0.28, 0.02, 0.4, 0.95, bz - 0.03);
  k.box(TIMBER, 0.38, 0.03, 0.03, 0.4, 0.95, bz - 0.04);
  k.box(TIMBER, 0.03, 0.28, 0.03, 0.4, 0.95, bz - 0.04);
  // tables and stools in front
  for (const tx of [-0.62, 0.62]) {
    k.cyl(WOOD_L, 0.25, 0.25, 0.04, tx, 0.5, 0.4, 10);
    k.cyl(TIMBER, 0.03, 0.04, 0.46, tx, 0.27, 0.4, 6);
    k.cyl(TIMBER, 0.12, 0.14, 0.03, tx, 0.045, 0.4, 8);
    k.cyl(CREAM, 0.035, 0.03, 0.06, tx - 0.07, 0.55, 0.38);
    k.cyl(CREAM, 0.035, 0.03, 0.06, tx + 0.08, 0.55, 0.44);
    k.cyl(SNOW, 0.26, 0.26, 0.012, tx, 0.53, 0.4, 10, { sx: 0.5, sz: 0.5 });
  }
  for (const s of CAFE_STOOLS) {
    k.cyl(s.x < 0 ? GREEN : BLUE, 0.1, 0.1, 0.04, s.x, 0.34, s.z, 8);
    k.cyl(TIMBER, 0.025, 0.03, 0.3, s.x, 0.18, s.z, 6);
  }
  // a snow shovelled to the side
  k.sph(SNOW, 0.28, hw - 0.3, 0.04, kz - 0.05, { sy: 0.5 });
  k.sph(SNOW, 0.22, -hw + 0.28, 0.04, kz + 0.2, { sy: 0.5 });
  const steam = new THREE.Vector3(-0.04, sy + 0.4, sz + 0.075);
  return { body: k.batch.geometry(), glow: g.batch.geometry(), glowKind: 'warm', steam };
}

// ---------------------------------------------------------------------------
// SNOWMAN PARK: a snow mound, three snowmen (big, middle, small) with scarves and twig arms, a low picket fence
// ---------------------------------------------------------------------------

function snowman(k: Kit, x: number, z: number, yaw: number, s: number, scarf: number, hat: 'top' | 'beanie' | 'none', hatC: number): void {
  k.at(x, z, yaw, () => {
    const r0 = 0.3 * s;
    const r1 = 0.22 * s;
    const r2 = 0.15 * s;
    const y0 = r0 * 0.9;
    const y1 = y0 + r0 * 0.8 + r1 * 0.55;
    const y2 = y1 + r1 * 0.8 + r2 * 0.55;
    k.sph(SNOW, r0, 0, y0, 0, { sy: 0.92 });
    k.sph(SNOW, r1, 0, y1, 0);
    k.sph(SNOW, r2, 0, y2, 0);
    // face: coal eyes, carrot nose
    for (const sx of [-1, 1]) k.sph(COAL, 0.022 * s, sx * 0.055 * s, y2 + 0.04 * s, r2 * 0.92);
    k.cone(CARROT, 0.028 * s, 0.14 * s, 0, y2 - 0.005 * s, r2 + 0.06 * s, 6, { rx: Math.PI / 2 });
    // coal buttons
    for (let i = 0; i < 3; i++) k.sph(COAL, 0.02 * s, 0, y1 + (0.07 - i * 0.07) * s, r1 * 0.97);
    // scarf around the neck with a hanging tail
    k.torus(scarf, r2 * 0.95, 0.032 * s, 0, y2 - r2 * 0.88, 0, { rx: Math.PI / 2 });
    k.box(scarf, 0.05 * s, 0.17 * s, 0.03 * s, r2 * 0.55, y2 - r2 * 1.5, r2 * 0.75, { rz: 0.12 });
    // twig arms
    for (const sx of [-1, 1]) {
      k.cyl(TIMBER, 0.013 * s, 0.013 * s, 0.34 * s, sx * (r1 + 0.1 * s), y1 + 0.07 * s, 0.02, 4, { rz: -sx * 1.05 });
      k.cyl(TIMBER, 0.009 * s, 0.009 * s, 0.1 * s, sx * (r1 + 0.22 * s), y1 + 0.17 * s, 0.02, 4, { rz: sx * 0.5 });
    }
    // hat
    if (hat === 'top') {
      k.cyl(hatC, r2 * 1.1, r2 * 1.1, 0.025 * s, 0, y2 + r2 * 0.88, 0, 10);
      k.cyl(hatC, r2 * 0.72, r2 * 0.72, 0.2 * s, 0, y2 + r2 * 0.88 + 0.11 * s, 0, 10);
      k.cyl(RED, r2 * 0.74, r2 * 0.74, 0.04 * s, 0, y2 + r2 * 0.88 + 0.04 * s, 0, 10);
    } else if (hat === 'beanie') {
      k.sph(hatC, r2 * 0.98, 0, y2 + r2 * 0.28, 0, { sy: 0.85 });
      k.sph(SNOW, 0.035 * s, 0, y2 + r2 * 1.2, 0);
    }
  });
}

function bakeSnowmanPark(): Baked {
  const { w, d } = dims('snowmanPark');
  const k = new Kit();
  const g = new Kit();
  const hw = w / 2;
  const hd = d / 2;
  // the mound: two overlapping low domes, a darker ground ring
  k.sph(SNOW_SH, 1, 0, 0, 0, { sx: hw - 0.02, sy: 0.06, sz: hd - 0.02 });
  k.sph(SNOW, 1, 0, 0.01, 0.02, { sx: hw - 0.14, sy: 0.17, sz: hd - 0.14 });
  // snowmen: big (back left), middle (back right), small (front)
  snowman(k, -0.42, -0.1, 0.35, 1.25, RED, 'top', COAL);
  snowman(k, 0.46, -0.04, -0.4, 1.0, GREEN, 'beanie', BLUE);
  snowman(k, 0.02, 0.38, 0.1, 0.62, YELLOW, 'none', 0);
  // a few snowballs and a shovel stuck in the mound
  for (const [bx, bz, br] of [[-0.9, 0.35, 0.07], [0.85, 0.46, 0.06], [-0.25, 0.5, 0.05]] as const) k.sph(SNOW, br, bx, br * 0.8, bz);
  k.cyl(TIMBER, 0.015, 0.015, 0.5, 0.78, 0.3, -0.5, 5, { rz: 0.25 });
  k.box(IRON, 0.1, 0.12, 0.012, 0.72, 0.04 + 0.05, -0.5, { rz: 0.25 });
  // low picket fence round the back and sides (the front stays open): posts every 0.3, two rails
  const fh = 0.28;
  const fx = hw - 0.06;
  const fz0 = -hd + 0.06;
  const fz1 = hd - 0.4;
  const post = (px: number, pz: number, ry: number): void => {
    k.box(WOOD_L, 0.05, fh, 0.03, px, fh / 2, pz, { ry });
    k.box(SNOW, 0.055, 0.025, 0.035, px, fh + 0.01, pz, { ry });
  };
  for (let px = -fx; px <= fx + 1e-6; px += (2 * fx) / 8) post(px, fz0, 0);
  k.box(WOOD, 2 * fx, 0.03, 0.025, 0, 0.1, fz0);
  k.box(WOOD, 2 * fx, 0.03, 0.025, 0, 0.2, fz0);
  for (const sx of [-1, 1]) {
    const n = 4;
    for (let i = 1; i <= n; i++) post(sx * fx, fz0 + ((fz1 - fz0) * i) / n, Math.PI / 2);
    k.box(WOOD, 0.025, 0.03, fz1 - fz0, sx * fx, 0.1, (fz0 + fz1) / 2);
    k.box(WOOD, 0.025, 0.03, fz1 - fz0, sx * fx, 0.2, (fz0 + fz1) / 2);
  }
  // a tiny hanging lantern on the fence corner posts (glow)
  for (const sx of [-1, 1]) {
    k.cyl(TIMBER, 0.018, 0.018, 0.55, sx * fx, 0.28, fz0, 5);
    g.sph(WARM, 0.055, sx * fx, 0.6, fz0);
  }
  return { body: k.batch.geometry(), glow: g.batch.geometry(), glowKind: 'warm', steam: null };
}

// ---------------------------------------------------------------------------
// BANDSTAND: an octagonal raised deck, six posts, a conical roof, bunting, a drum and a double bass on the stage
// ---------------------------------------------------------------------------

function bakeBandstand(): Baked {
  const { w, d } = dims('bandstand');
  const k = new Kit();
  const g = new Kit();
  const R = Math.min(w, d) / 2 - 0.02;
  const deckY = 0.3;
  const o8 = { ry: Math.PI / 8 }; // flat faces toward the axes
  // deck: stone-and-timber plinth, wooden top, snow ring on the rim
  k.cyl(0x8a8f99, R, R, 0.16, 0, 0.08, 0, 8, o8);
  k.cyl(WOOD, R - 0.05, R - 0.05, 0.14, 0, deckY - 0.07, 0, 8, o8);
  k.cyl(WOOD_L, R - 0.12, R - 0.12, 0.02, 0, deckY + 0.005, 0, 8, o8);
  // front steps (toward +Z)
  k.box(WOOD, 0.8, 0.08, 0.2, 0, 0.04, R - 0.02);
  k.box(WOOD_L, 0.7, 0.08, 0.18, 0, 0.12, R - 0.16);
  // six posts: front gap kept open (angles from +Z)
  const pr = R - 0.17;
  const angles = [35, 90, 145, 215, 270, 325].map((a) => (a * Math.PI) / 180);
  const postTop = 1.55;
  const px = (a: number): number => Math.sin(a) * pr;
  const pz = (a: number): number => Math.cos(a) * pr;
  for (const a of angles) {
    k.box(WOOD_L, 0.1, postTop - deckY, 0.1, px(a), (postTop + deckY) / 2, pz(a), { ry: a });
    k.box(TIMBER, 0.15, 0.06, 0.15, px(a), deckY + 0.03, pz(a), { ry: a });
    g.sph(WARM, 0.05, px(a) * 0.82, postTop - 0.2, pz(a) * 0.82); // hanging lantern, inboard of the post
  }
  // railing between neighbouring posts (not across the open front gap between the two front corner posts)
  const railBetween = (a0: number, a1: number): void => {
    const x0 = px(a0);
    const z0 = pz(a0);
    const x1 = px(a1);
    const z1 = pz(a1);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    k.box(WOOD, 0.04, 0.05, len, (x0 + x1) / 2, deckY + 0.46, (z0 + z1) / 2, { ry: yaw });
    k.box(WOOD, 0.03, 0.04, len, (x0 + x1) / 2, deckY + 0.2, (z0 + z1) / 2, { ry: yaw });
  };
  // 35 -> 90 -> 145 -> 215 -> 270 -> 325 (35 and 325 are the front corners, left open between them)
  for (let i = 0; i + 1 < angles.length; i++) railBetween(angles[i]!, angles[i + 1]!);
  // beam ring under the roof + the roof: a red cone with a snow cone over it, a finial
  k.cyl(TIMBER, R, R, 0.1, 0, postTop + 0.03, 0, 8, o8);
  k.cone(RED, R, 0.62, 0, postTop + 0.36, 0, 8, o8);
  k.cone(SNOW, R * 0.7, 0.4, 0, postTop + 0.46, 0, 8, o8);
  k.cyl(BRASS, 0.02, 0.02, 0.2, 0, postTop + 0.76, 0, 5);
  k.sph(BRASS, 0.05, 0, postTop + 0.88, 0);
  // bunting along the beam between the back posts (and a short span across each front corner)
  const flagC = [RED, YELLOW, BLUE, GREEN];
  const bunting = (a0: number, a1: number): void => {
    const x0 = px(a0);
    const z0 = pz(a0);
    const x1 = px(a1);
    const z1 = pz(a1);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const sag = Math.sin(t * Math.PI) * 0.06;
      k.cone(flagC[(i + Math.round(a0 * 3)) % 4]!, 0.07, 0.15, x0 + (x1 - x0) * t, postTop - 0.1 - sag, z0 + (z1 - z0) * t, 3, { rx: Math.PI });
    }
  };
  for (let i = 0; i + 1 < angles.length; i++) bunting(angles[i]!, angles[i + 1]!);
  // on stage: a drum kit corner (back left) and a double bass (back right), static silhouettes
  k.at(-0.42, -0.42, 0.7, () => {
    k.cyl(RED_D, 0.19, 0.19, 0.24, 0, deckY + 0.14, 0, 12);
    k.cyl(CREAM, 0.195, 0.195, 0.05, 0, deckY + 0.14, 0, 12);
    k.cyl(CREAM, 0.17, 0.17, 0.02, 0, deckY + 0.275, 0, 12);
    k.cyl(IRON, 0.012, 0.012, 0.5, 0.3, deckY + 0.25, 0.05, 4);
    k.cyl(BRASS, 0.12, 0.12, 0.012, 0.3, deckY + 0.5, 0.05, 10, { rx: 0.15 });
    k.cyl(RED_D, 0.085, 0.085, 0.14, -0.28, deckY + 0.13, 0.12, 10);
    k.cyl(IRON, 0.012, 0.012, 0.3, -0.3, deckY + 0.2, -0.12, 4);
    k.cyl(BRASS, 0.1, 0.1, 0.012, -0.3, deckY + 0.35, -0.12, 10, { rx: -0.12 });
    k.cyl(WOOD_L, 0.17, 0.17, 0.04, 0, deckY + 0.07, 0.4, 8); // stool
    k.cyl(TIMBER, 0.02, 0.02, 0.08, 0, deckY + 0.02, 0.4, 5);
  });
  k.at(0.46, -0.4, -0.5, () => {
    const by = deckY;
    k.sph(0x7a4a24, 0.2, 0, by + 0.34, 0, { sy: 1.0, sz: 0.38 });
    k.sph(0x7a4a24, 0.15, 0, by + 0.66, 0, { sy: 0.95, sz: 0.38 });
    k.sph(0x8a5a30, 0.1, 0, by + 0.52, 0.0, { sy: 0.7, sz: 0.34 });
    k.cyl(0x3a2412, 0.022, 0.022, 0.52, 0, by + 1.0, 0.02, 5);
    k.sph(0x3a2412, 0.04, 0, by + 1.28, 0.02);
    k.cyl(IRON, 0.01, 0.01, 0.12, 0, by + 0.06, 0.02, 4);
    k.box(0x3a2412, 0.05, 0.015, 0.1, 0, by + 0.48, 0.14, { rx: 0.3 });
  });
  // a music stand at the front of the stage
  k.cyl(IRON, 0.012, 0.012, 0.5, 0.0, deckY + 0.25, 0.46, 4);
  k.box(CREAM, 0.26, 0.16, 0.012, 0, deckY + 0.55, 0.46, { rx: -0.35 });
  return { body: k.batch.geometry(), glow: g.batch.geometry(), glowKind: 'warm', steam: null };
}

// ---------------------------------------------------------------------------
// SKATING POND: a snow-rimmed ice ellipse, four lamp posts (bulbs) at the corners, two skaters mid-glide
// ---------------------------------------------------------------------------

function skater(k: Kit, x: number, z: number, yaw: number, y: number, coat: number, scarf: number): void {
  k.at(x, z, yaw, () => {
    // body leans into the glide (forward = local +Z), one leg back, arms out
    const s = 0.9;
    k.cyl(coat, 0.07 * s, 0.085 * s, 0.26 * s, 0, y + 0.3 * s, 0, 7, { rx: 0.25 });
    k.sph(0xf2c9a0, 0.065 * s, 0, y + 0.5 * s, 0.045 * s);
    k.sph(scarf, 0.07 * s, 0, y + 0.55 * s, 0.03 * s, { sy: 0.55 });
    k.cone(scarf, 0.062 * s, 0.1 * s, 0, y + 0.6 * s, 0.03 * s, 6);
    k.box(scarf, 0.04 * s, 0.03 * s, 0.14 * s, 0, y + 0.45 * s, -0.08 * s, { rx: 0.4 });
    // legs: one forward, one stretched back, with blades
    k.box(IRON, 0.045 * s, 0.2 * s, 0.045 * s, -0.035 * s, y + 0.1 * s, 0.07 * s, { rx: 0.4 });
    k.box(IRON, 0.045 * s, 0.2 * s, 0.045 * s, 0.035 * s, y + 0.12 * s, -0.12 * s, { rx: -0.9 });
    k.box(0xcfd8e4, 0.02 * s, 0.015 * s, 0.14 * s, -0.035 * s, y + 0.008, 0.13 * s);
    k.box(0xcfd8e4, 0.02 * s, 0.015 * s, 0.14 * s, 0.035 * s, y + 0.06 * s, -0.24 * s);
    // arms spread for balance
    k.box(coat, 0.2 * s, 0.035 * s, 0.035 * s, -0.13 * s, y + 0.37 * s, 0.01, { rz: 0.35 });
    k.box(coat, 0.2 * s, 0.035 * s, 0.035 * s, 0.13 * s, y + 0.4 * s, 0.01, { rz: -0.35 });
  });
}

function bakePond(): Baked {
  const { w, d } = dims('pond');
  const k = new Kit();
  const hw = w / 2;
  const hd = d / 2;
  // snow bank rim (a thick low ellipse), the ice inside it, a few frost scratches, a bluer centre sheen
  k.cyl(SNOW, 1, 1, 0.12, 0, 0.06, 0, 24, { sx: hw - 0.04, sz: hd - 0.04 });
  k.cyl(ICE, 1, 1, 0.03, 0, 0.118, 0, 24, { sx: hw - 0.24, sz: hd - 0.22 });
  k.cyl(ICE_L, 1, 1, 0.012, 0.0, 0.136, 0, 24, { sx: hw - 0.62, sz: hd - 0.5 });
  for (const [sx, sz, len, ry] of [[-0.35, 0.1, 0.55, 0.3], [0.45, -0.2, 0.5, -0.4], [0.05, 0.38, 0.4, 0.05], [-0.7, -0.25, 0.35, -0.7]] as const) {
    k.box(ICE_D, len, 0.006, 0.014, sx, 0.145, sz, { ry });
  }
  // two skate tracks (curved by two segments each) behind the skaters
  for (const [sx, sz, ry] of [[-0.8, 0.2, 0.5], [0.1, -0.3, -0.6]] as const) k.box(ICE_L, 0.5, 0.005, 0.012, sx, 0.146, sz, { ry });
  // skaters mid-glide
  skater(k, -0.3, 0.12, 1.0, 0.143, RED, YELLOW);
  skater(k, 0.55, -0.22, -2.2, 0.143, BLUE, CREAM);
  // four lamp posts at the corners of the footprint, little cap + bulb (bulbs go to the unlit bulb mesh)
  const lx = hw - 0.12;
  const lz = hd - 0.1;
  const bulbs = new Batch();
  const bulbGeo = new THREE.SphereGeometry(0.085, 8, 6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.cyl(IRON, 0.03, 0.04, 0.86, sx * lx, 0.43, sz * lz, 6);
      k.cyl(IRON, 0.065, 0.065, 0.03, sx * lx, 0.87, sz * lz, 8); // collar under the bulb
      bulbs.add(bulbGeo, BULB, sx * lx, 0.96, sz * lz);
      k.cone(IRON, 0.11, 0.1, sx * lx, 1.1, sz * lz, 8); // cap above it
      k.cone(SNOW, 0.08, 0.05, sx * lx, 1.16, sz * lz, 8);
    }
  }
  bulbGeo.dispose();
  return { body: k.batch.geometry(), glow: bulbs.geometry(), glowKind: 'bulb', steam: null };
}

// ---------------------------------------------------------------------------
// public factory
// ---------------------------------------------------------------------------

const BAKE: Record<AmenityId, () => Baked> = {
  cafe: bakeCafe,
  snowmanPark: bakeSnowmanPark,
  bandstand: bakeBandstand,
  pond: bakePond,
};
const bakedCache: Partial<Record<AmenityId, Baked>> = {};

/** One amenity model (see the file header for the contract). */
export function createAmenityModel(id: AmenityId): AmenityModel {
  const baked = (bakedCache[id] ??= BAKE[id]());
  const { w, d } = dims(id);
  const root = new THREE.Group();
  root.name = `amenity:${id}`;
  const body = new THREE.Mesh(baked.body, vcMat());
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = `${id}:body`;
  root.add(body);
  const glow = new THREE.Mesh(baked.glow, baked.glowKind === 'bulb' ? bulbMaterial() : glowMat());
  glow.castShadow = false;
  glow.receiveShadow = false;
  glow.name = `${id}:glow`;
  root.add(glow);
  return { root, w, d, glow: [glow], steam: baked.steam ? baked.steam.clone() : null };
}

export const townAmenityCatalog: Record<string, () => THREE.Object3D> = {
  cafe: () => createAmenityModel('cafe').root,
  snowmanPark: () => createAmenityModel('snowmanPark').root,
  bandstand: () => createAmenityModel('bandstand').root,
  pond: () => createAmenityModel('pond').root,
};
