/**
 * 0.9.7 AssetFactory: era buyer vehicles (npc/EraBuyers.ts), one per era 2..10, as cosy blockouts in the era's colours
 * (ERAS[n].colors). Final art comes later; these set the silhouette, the scale and the read of each era:
 *
 *   2 Frontier   pony cart: two big spoked wheels, plank bed, a little chestnut pony between the shafts
 *   3 Iron Age   ox wagon: four iron-rimmed wheels, slatted sides, a cream ox under a yoke
 *   4 Steam Age  steam lorry: brass-banded boiler, a tall chimney that puffs, an open canopy cab
 *   5 Industrial 1920s flatbed: long rounded hood, swoopy fenders, stake-side flatbed, lamps on stalks
 *   6 Electric   milk float: low rounded nose, bubble roof, crate rails and a glowing battery strip
 *   7 Oil        chunky tanker pickup: fat tyres, saddle tanks and a drum tank on the roof rack
 *   8 Computer   80s cab-over van: boxy cab, big windscreen, three side stripes and a roof light bar
 *   9 Nuclear    rounded utility truck: bubble hood and roof, hazard stripes, a green roof beacon
 *  10 AI         hover pod cart: a smooth floating hull, a halo roll hoop and four glowing hover discs
 *
 * Every vehicle keeps assets/vehicles.ts's PickupTruckModel contract: faces −X, origin on the ground under the
 * vehicle, the bed's floor centre at x = TRUCK_BED_X (eras/market.ts BED_X lines the bed up with the dock counter),
 * `wheels` are pivots (rolling wheels spin about Z, hover discs about Y), the driver's hips go on `driverSeat` (yawed
 * −π/2 to face −X, like the pickup's) and the cargo pile hangs off `bedPivot`. It adds `animate(dt, speed, moving)`
 * (wheel spin, body bounce or hover, the draught animal's walk, steam puffs), so EraBuyers needs no per-era code.
 *
 * Draw calls: every static part bakes into ONE vertex-coloured body mesh (shared across same-looking vehicles), lamps
 * and glow parts are one emissive mesh each, wheels / animal legs share cached geometry and instance across the scene.
 * Colours stay soft: no near-black (tyres are slate), dark era trims are lightened, edges are rounded where it reads.
 */
import * as THREE from 'three';
import { COLORS } from '../config';
import { ERAS } from '../eras/data';
import { Batch, shareBaked, vcMat, type PartOpts } from '../render/batch';
import { createCharacterRig, type CharacterRig } from '../render/characters';
import { instanceAcrossScene } from '../render/instancer';
import { geo, toon } from '../render/materials';
import { TRUCK_BED_X, type PickupTruckModel } from './vehicles';

export interface EraVehicleModel extends PickupTruckModel {
  /** The era it belongs to (2..10). */
  era: number;
  /** Radius of the rolling wheels (hover discs: the disc radius). */
  wheelRadius: number;
  /**
   * Advance the vehicle's own motion: wheels roll by `speed` (m/s), the body bounces (or floats) by `moving`
   * (0 parked … 1 driving), a draught animal walks, a chimney puffs.
   */
  animate(dt: number, speed: number, moving: number): void;
}

/** What each era's vehicle is (root names; tests check every era differs). */
export const ERA_VEHICLE_KINDS: Readonly<Record<number, string>> = {
  2: 'ponyCart',
  3: 'oxWagon',
  4: 'steamLorry',
  5: 'flatbed1920s',
  6: 'milkFloat',
  7: 'tankerPickup',
  8: 'boxyVan',
  9: 'hazardUtility',
  10: 'hoverPod',
};

// ---------------------------------------------------------------------------
// palette helpers
// ---------------------------------------------------------------------------

const _a = new THREE.Color();
const _b = new THREE.Color();
function mix(a: number, b: number, t: number): number {
  return _a.setHex(a).lerp(_b.setHex(b), t).getHex();
}
const lighten = (c: number, t: number): number => mix(c, 0xffffff, t);
const darken = (c: number, t: number): number => mix(c, 0x000000, t);

/** Soft slate for tyres and dark trims (never near-black). */
const TYRE = 0x51545e;
const GLASS = COLORS.RIVER_FOAM;
const WOOD = 0xc49a6c;
const WOOD_D = 0x8f6c4a;
const BRASS = 0xd4aa5c;
const CREAM = 0xf3e8d2;
const STEEL = 0x8e979c;
const HAZARD = 0xf2c84b;
const LAMP = COLORS.COURIER_YELLOW;
const TAIL = 0xe2453c;

interface Pal {
  /** Main panels (the buyer's variant colour). */
  paint: number;
  /** A contrasting era colour (the other variant colour). */
  alt: number;
  /** Era trim, lightened so it never reads as black. */
  trim: number;
  fence: number;
  glow: number;
  coat: number;
}

function palette(era: number, paint?: number): Pal {
  const c = ERAS[era]!.colors;
  const p = paint ?? c.accent;
  return {
    paint: p,
    alt: p === c.accent ? c.body : c.accent,
    trim: lighten(c.trim, 0.28),
    fence: lighten(c.fence, 0.15),
    glow: c.glow,
    coat: c.coat,
  };
}

// ---------------------------------------------------------------------------
// building kit
// ---------------------------------------------------------------------------

const HALF_PI = Math.PI / 2;

/** Static parts of one vehicle: body (vertex colours), lamps and glow (emissive, one mesh each). */
class Kit {
  readonly body = new Batch();
  readonly lamps = new Batch();
  readonly tails = new Batch();
  readonly glow = new Batch();

  /** Box standing on y (its bottom face). */
  box(w: number, h: number, d: number, c: number, x: number, y: number, z: number, o?: PartOpts, into: Batch = this.body): void {
    into.add(geo.boxBase(w, h, d), c, x, y, z, o);
  }
  /** Box centred on (x, y, z). */
  cbox(w: number, h: number, d: number, c: number, x: number, y: number, z: number, o?: PartOpts, into: Batch = this.body): void {
    into.add(geo.box(w, h, d), c, x, y, z, o);
  }
  /** Cylinder centred on (x, y, z), axis Y unless rotated. */
  cyl(rt: number, rb: number, h: number, c: number, x: number, y: number, z: number, o?: PartOpts, into: Batch = this.body): void {
    into.add(geo.cylinder(rt, rb, h, 14), c, x, y, z, o);
  }
  /** Rod along X from x0 to x1. */
  rodX(r: number, x0: number, x1: number, c: number, y: number, z: number, into: Batch = this.body): void {
    into.add(geo.cylinder(r, r, Math.abs(x1 - x0), 10), c, (x0 + x1) / 2, y, z, { rz: HALF_PI });
  }
  /** Rod along Z (axle / cross bar). */
  rodZ(r: number, len: number, c: number, x: number, y: number, z = 0, into: Batch = this.body): void {
    into.add(geo.cylinder(r, r, len, 10), c, x, y, z, { rx: HALF_PI });
  }
  /** Ellipsoid with semi-axes (sx, sy, sz). */
  ball(sx: number, sy: number, sz: number, c: number, x: number, y: number, z: number, into: Batch = this.body): void {
    into.add(geo.sphere(1, 18, 12), c, x, y, z, { sx, sy, sz });
  }
  /** Soft slab: a box whose long X edges are rounded by rods (cosy, no razor edges). */
  slab(w: number, h: number, d: number, c: number, x: number, y: number, z: number): void {
    const r = Math.min(h, d) * 0.5;
    this.box(w, h, d - 2 * r, c, x, y, z);
    for (const s of [-1, 1]) this.rodX(r, x - w / 2, x + w / 2, c, y + h / 2, z + s * (d / 2 - r));
  }
}

// ---------------------------------------------------------------------------
// wheels
// ---------------------------------------------------------------------------

type WheelStyle = 'spoked' | 'iron' | 'steam' | 'tyre' | 'artillery';

const wheelCache = new Map<string, THREE.BufferGeometry>();

/** Wheel geometry (axle along Z, centred on the hub), cached per look. */
function wheelGeometry(style: WheelStyle, r: number, w: number, a: number, b: number): THREE.BufferGeometry {
  const key = `${style}|${r}|${w}|${a}|${b}`;
  let g = wheelCache.get(key);
  if (g) return g;
  const k = new Batch();
  switch (style) {
    case 'spoked':
    case 'iron': {
      // wooden rim (iron-shod on the ox wagon), four crossed spokes and a round hub
      const tube = r * 0.13;
      k.add(geo.torus(r - tube, tube, 8, 22), style === 'iron' ? STEEL : a, 0, 0, 0, { sz: w / (tube * 2) });
      for (let i = 0; i < 4; i++) k.add(geo.box(r * 1.8, r * 0.1, w * 0.5), b, 0, 0, 0, { rz: (i * Math.PI) / 4 });
      k.add(geo.cylinder(r * 0.22, r * 0.22, w + 0.06, 12), a, 0, 0, 0, { rx: HALF_PI });
      break;
    }
    case 'steam': {
      // iron tyre, painted disc with six spokes, brass hub
      k.add(geo.cylinder(r, r, w, 18), TYRE, 0, 0, 0, { rx: HALF_PI });
      k.add(geo.cylinder(r * 0.82, r * 0.82, w + 0.02, 18), a, 0, 0, 0, { rx: HALF_PI });
      for (let i = 0; i < 3; i++) k.add(geo.box(r * 1.55, r * 0.12, w + 0.05), lighten(a, 0.25), 0, 0, 0, { rz: (i * Math.PI) / 3 });
      k.add(geo.cylinder(r * 0.22, r * 0.22, w + 0.1, 12), BRASS, 0, 0, 0, { rx: HALF_PI });
      break;
    }
    case 'artillery': {
      // 1920s: slate tyre, cream spoked disc, a little cap
      k.add(geo.cylinder(r, r, w, 18), TYRE, 0, 0, 0, { rx: HALF_PI });
      k.add(geo.cylinder(r * 0.66, r * 0.66, w + 0.02, 16), a, 0, 0, 0, { rx: HALF_PI });
      for (let i = 0; i < 4; i++) k.add(geo.box(r * 1.2, r * 0.1, w + 0.04), b, 0, 0, 0, { rz: (i * Math.PI) / 4 });
      k.add(geo.cylinder(r * 0.18, r * 0.18, w + 0.08, 12), b, 0, 0, 0, { rx: HALF_PI });
      break;
    }
    case 'tyre': {
      // rubber-look tyre, coloured hub, one bar so the spin reads
      k.add(geo.cylinder(r, r, w, 18), TYRE, 0, 0, 0, { rx: HALF_PI });
      k.add(geo.cylinder(r * 0.56, r * 0.56, w + 0.03, 14), a, 0, 0, 0, { rx: HALF_PI });
      k.add(geo.box(r * 1.4, r * 0.2, w + 0.05), b, 0, 0, 0);
      break;
    }
  }
  g = k.geometry();
  wheelCache.set(key, g);
  return g;
}

function wheel(style: WheelStyle, r: number, w: number, a: number, b: number, x: number, z: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = 'wheel';
  const m = new THREE.Mesh(wheelGeometry(style, r, w, a, b), vcMat());
  m.name = 'wheelMesh';
  m.castShadow = true;
  m.receiveShadow = true;
  pivot.add(m);
  pivot.position.set(x, r, z);
  return pivot;
}

/** A hover disc (era 10): pale saucer + glowing underside; spins about Y. */
function hoverDisc(r: number, pal: Pal, x: number, y: number, z: number): THREE.Group {
  const key = `hover|${r}|${pal.paint}`;
  let g = wheelCache.get(key);
  if (!g) {
    const k = new Batch();
    k.add(geo.cylinder(r, r * 0.8, 0.12, 18), lighten(pal.paint, 0.35), 0, 0.03, 0);
    k.add(geo.sphere(r * 0.4, 12, 8), pal.trim, 0, 0.1, 0, { sy: 0.45 });
    for (let i = 0; i < 2; i++) k.add(geo.box(r * 1.7, 0.05, 0.08), pal.trim, 0, 0.1, 0, { ry: (i * Math.PI) / 2 });
    g = k.geometry();
    wheelCache.set(key, g);
  }
  const pivot = new THREE.Group();
  pivot.name = 'wheel';
  const disc = new THREE.Mesh(g, vcMat());
  disc.name = 'hoverDisc';
  disc.castShadow = true;
  const glow = new THREE.Mesh(geo.cylinder(r * 0.7, r * 0.45, 0.05, 16), toon(pal.glow, { emissive: pal.glow, emissiveIntensity: 0.9 }));
  glow.name = 'hoverGlow';
  glow.position.y = -0.05;
  pivot.add(disc, glow);
  pivot.position.set(x, y, z);
  return pivot;
}

// ---------------------------------------------------------------------------
// draught animals (eras 2 and 3)
// ---------------------------------------------------------------------------

interface Animal {
  root: THREE.Group;
  legs: THREE.Object3D[];
  head: THREE.Object3D;
}

const legCache = new Map<string, THREE.BufferGeometry>();

function legGeometry(kind: 'pony' | 'ox', h: number, coat: number, hoof: number): THREE.BufferGeometry {
  const key = `${kind}|${h}|${coat}|${hoof}`;
  let g = legCache.get(key);
  if (g) return g;
  const k = new Batch();
  const r = kind === 'ox' ? 0.09 : 0.065;
  k.add(geo.capsule(r, h - 2 * r - 0.08, 4, 10), coat, 0, -h / 2 + 0.04, 0);
  k.add(geo.cylinder(r * 1.05, r * 1.2, 0.1, 10), hoof, 0, -h + 0.05, 0);
  g = k.geometry();
  legCache.set(key, g);
  return g;
}

/** A blockout pony (era 2) or ox (era 3), facing −X, origin on the ground under its middle. */
function createAnimal(kind: 'pony' | 'ox', pal: Pal): Animal {
  const root = new THREE.Group();
  root.name = kind;
  const k = new Batch();
  const headK = new Batch();
  const pony = kind === 'pony';
  const coat = pony ? 0xa8714a : 0xd8b88f;
  const coatL = pony ? 0xc48d62 : CREAM;
  const hoof = pony ? 0x6f5644 : 0x7d6a58;
  const legH = pony ? 0.7 : 0.62;
  const bodyY = legH + (pony ? 0.2 : 0.26);
  // barrel body
  k.add(geo.sphere(1, 18, 12), coat, 0, bodyY, 0, pony ? { sx: 0.6, sy: 0.3, sz: 0.27 } : { sx: 0.62, sy: 0.38, sz: 0.36 });
  k.add(geo.sphere(1, 14, 10), coatL, 0.05, bodyY - 0.1, 0, pony ? { sx: 0.45, sy: 0.18, sz: 0.24 } : { sx: 0.5, sy: 0.22, sz: 0.33 });
  if (pony) {
    // a blanket in the era's colour, a cream mane and a swishy tail
    k.add(geo.boxBase(0.5, 0.06, 0.58), pal.paint, 0.05, bodyY + 0.22, 0);
    k.add(geo.capsule(0.05, 0.3, 4, 8), CREAM, 0.64, bodyY - 0.14, 0, { rz: 0.5 });
  } else {
    // a hump, a tuft tail
    k.add(geo.sphere(0.2, 12, 8), coat, -0.3, bodyY + 0.25, 0, { sx: 1.2, sy: 0.6 });
    k.add(geo.capsule(0.04, 0.4, 4, 8), coat, 0.64, bodyY - 0.15, 0, { rz: 0.25 });
    k.add(geo.sphere(0.07, 8, 6), CREAM, 0.7, bodyY - 0.42, 0);
  }
  const body = shareBaked(k.mesh());
  body.name = `${kind}Body`;
  root.add(body);

  // head on its own pivot (nods while walking)
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(pony ? -0.45 : -0.55, bodyY + (pony ? 0.15 : 0.05), 0);
  if (pony) {
    headK.add(geo.capsule(0.12, 0.3, 4, 10), coat, -0.08, 0.2, 0, { rz: 0.6 });
    headK.add(geo.boxBase(0.06, 0.34, 0.05), CREAM, 0.04, 0.1, 0, { rz: 0.6 });
    headK.add(geo.sphere(1, 14, 10), coat, -0.28, 0.42, 0, { sx: 0.24, sy: 0.13, sz: 0.13 });
    headK.add(geo.sphere(1, 12, 8), coatL, -0.46, 0.38, 0, { sx: 0.1, sy: 0.09, sz: 0.11 });
    for (const s of [-1, 1]) headK.add(geo.cone(0.045, 0.12, 8), coat, -0.18, 0.58, s * 0.07);
    for (const s of [-1, 1]) headK.add(geo.sphere(0.03, 8, 6), 0x5a4a40, -0.36, 0.47, s * 0.11);
    // a little collar in the era colour
    headK.add(geo.torus(0.13, 0.04, 6, 16), pal.paint, 0.05, 0.12, 0, { ry: HALF_PI, rx: 0.4 });
  } else {
    headK.add(geo.sphere(1, 14, 10), coat, -0.12, 0.0, 0, { sx: 0.24, sy: 0.22, sz: 0.22 });
    headK.add(geo.sphere(1, 12, 8), 0xe3b2a0, -0.32, -0.08, 0, { sx: 0.12, sy: 0.12, sz: 0.15 });
    for (const s of [-1, 1]) {
      headK.add(geo.cone(0.05, 0.3, 8), CREAM, -0.08, 0.16, s * 0.24, { rx: s * 1.1 });
      headK.add(geo.sphere(1, 8, 6), coat, -0.02, 0.06, s * 0.24, { sx: 0.05, sy: 0.04, sz: 0.09 });
      headK.add(geo.sphere(0.03, 8, 6), 0x5a4a40, -0.28, 0.06, s * 0.13);
    }
    // the yoke rests on its neck
    headK.add(geo.cylinder(0.06, 0.06, 0.9, 10), WOOD_D, 0.12, 0.22, 0, { rx: HALF_PI });
    for (const s of [-1, 1]) headK.add(geo.torus(0.12, 0.03, 6, 14), WOOD_D, 0.12, 0.1, s * 0.3, { ry: HALF_PI });
  }
  const headMesh = shareBaked(headK.mesh());
  headMesh.name = `${kind}Head`;
  head.add(headMesh);
  root.add(head);

  // four legs on hip pivots (swing about Z)
  const lg = legGeometry(kind, legH, coat, hoof);
  const legs: THREE.Object3D[] = [];
  const lx = pony ? 0.36 : 0.38;
  const lz = pony ? 0.13 : 0.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Group();
      p.name = 'leg';
      p.position.set(sx * lx, legH, sz * lz);
      const m = new THREE.Mesh(lg, vcMat());
      m.castShadow = true;
      p.add(m);
      root.add(p);
      legs.push(p);
    }
  }
  return { root, legs, head };
}

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

/** Bed floor spans x 0.36 … 1.82 (centre TRUCK_BED_X), so a 3 × 3 cargo grid sits inside it. */
const BED_X0 = TRUCK_BED_X - 0.73;
const BED_X1 = TRUCK_BED_X + 0.73;
const BED_LEN = BED_X1 - BED_X0;

/** Open bed: floor (top at `floorY`), two side walls, a tail gate and rounded caps. */
function openBed(k: Kit, floorY: number, wallH: number, half: number, floorC: number, wallC: number, capC: number, front = false): void {
  k.box(BED_LEN, 0.08, half * 2, floorC, TRUCK_BED_X, floorY - 0.08, 0);
  for (const s of [-1, 1]) {
    k.box(BED_LEN, wallH, 0.09, wallC, TRUCK_BED_X, floorY - 0.04, s * half);
    k.rodX(0.06, BED_X0, BED_X1, capC, floorY + wallH - 0.02, s * half);
  }
  k.box(0.09, wallH, half * 2, wallC, BED_X1 - 0.04, floorY - 0.04, 0);
  k.rodZ(0.06, half * 2 + 0.1, capC, BED_X1 - 0.04, floorY + wallH - 0.02);
  if (front) {
    k.box(0.09, wallH, half * 2, wallC, BED_X0 + 0.04, floorY - 0.04, 0);
    k.rodZ(0.06, half * 2 + 0.1, capC, BED_X0 + 0.04, floorY + wallH - 0.02);
  }
}

/** Bench seat (top at `y`) with a back. */
function bench(k: Kit, x: number, y: number, w: number, c: number, back = true): void {
  k.slab(0.36, 0.14, w, c, x, y - 0.14, 0);
  if (back) k.slab(0.1, 0.5, w, c, x + 0.2, y - 0.06, 0);
}

/** Open cab frame: pillars, windscreen, a soft roof at `roofY`. Sides stay open above the doors so the driver shows. */
function roofedCab(k: Kit, x0: number, x1: number, beltY: number, roofY: number, half: number, pal: Pal, roofC = pal.paint): void {
  const len = x1 - x0;
  for (const s of [-1, 1]) {
    k.cbox(0.08, roofY - beltY, 0.08, roofC, x0 + 0.04, (beltY + roofY) / 2, s * (half - 0.05), { rz: -0.12 });
    k.cbox(0.08, roofY - beltY, 0.08, roofC, x1 - 0.04, (beltY + roofY) / 2, s * (half - 0.05));
  }
  k.cbox(0.05, (roofY - beltY) * 0.9, half * 2 - 0.2, GLASS, x0 + 0.06, (beltY + roofY) / 2, 0, { rz: -0.12 });
  k.slab(len + 0.12, 0.12, half * 2 + 0.06, roofC, (x0 + x1) / 2, roofY, 0);
}

interface Build {
  wheels: THREE.Object3D[];
  wheelRadius: number;
  floorY: number;
  seat: [number, number, number];
  bubbleY: number;
  /** Extra per-frame motion (animals, puffs, hover). */
  extra?: (dt: number, speed: number, moving: number, body: THREE.Group, t: number) => boolean | void;
}

// ---------------------------------------------------------------------------
// era recipes
// ---------------------------------------------------------------------------

/** Era 2: a plank pony cart on two big spoked wheels. */
function ponyCart(k: Kit, pal: Pal, root: THREE.Group): Build {
  const floorY = 0.74;
  const r = 0.52;
  // bed frame, plank floor, low rails with knobbed posts
  for (const s of [-1, 1]) k.rodX(0.05, -0.25, BED_X1, WOOD_D, floorY - 0.12, s * 0.55);
  k.rodZ(0.05, 1.75, WOOD_D, TRUCK_BED_X, r);
  openBed(k, floorY, 0.3, 0.76, WOOD, pal.paint, WOOD_D, true);
  for (const x of [BED_X0 + 0.05, BED_X1 - 0.05]) for (const s of [-1, 1]) k.ball(0.07, 0.07, 0.07, BRASS, x, floorY + 0.32, s * 0.76);
  // driver's footboard and bench in front of the bed
  k.box(0.7, 0.07, 1.3, WOOD, 0.0, floorY - 0.1, 0);
  k.box(0.32, 0.06, 1.1, WOOD_D, -0.42, 0.46, 0);
  bench(k, 0.12, floorY + 0.2, 1.15, pal.paint, false);
  for (const s of [-1, 1]) k.box(0.08, 0.2, 0.08, WOOD_D, 0.12, floorY - 0.04, s * 0.45);
  // shafts to the pony
  for (const s of [-1, 1]) {
    k.rodX(0.035, -2.05, 0.1, WOOD_D, 0.82, s * 0.36);
    k.ball(0.05, 0.05, 0.05, BRASS, -2.05, 0.82, s * 0.36);
  }
  const wheels = [-1, 1].map((s) => wheel('spoked', r, 0.12, WOOD_D, WOOD, TRUCK_BED_X, s * 0.9));
  const pony = createAnimal('pony', pal);
  pony.root.position.set(-1.42, 0, 0);
  root.add(pony.root);
  return { wheels, wheelRadius: r, floorY, seat: [0.12, floorY + 0.2, 0.38], bubbleY: 2.45, extra: walker(pony, 1.7) };
}

/** Era 3: a slatted ox wagon on four iron-shod wheels. */
function oxWagon(k: Kit, pal: Pal, root: THREE.Group): Build {
  const floorY = 0.86;
  const r = 0.42;
  // undercarriage
  for (const s of [-1, 1]) k.rodX(0.06, -0.4, BED_X1, WOOD_D, floorY - 0.16, s * 0.5);
  for (const x of [-0.02, 1.45]) k.rodZ(0.05, 1.7, STEEL, x, r);
  // slatted sides: posts + two rails, a solid floor
  k.box(BED_LEN + 0.7, 0.08, 1.56, WOOD, TRUCK_BED_X - 0.35, floorY - 0.08, 0);
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 4; i++) k.box(0.08, 0.46, 0.08, WOOD_D, BED_X0 + 0.04 + (i * (BED_LEN - 0.08)) / 4, floorY - 0.04, s * 0.78);
    for (const h of [0.18, 0.4]) k.rodX(0.045, BED_X0, BED_X1, pal.paint, floorY + h, s * 0.78);
  }
  k.box(0.09, 0.42, 1.56, pal.paint, BED_X1 - 0.04, floorY - 0.04, 0);
  k.rodZ(0.05, 1.66, STEEL, BED_X1 - 0.04, floorY + 0.4);
  // raised driver's box at the front
  k.slab(0.55, 0.32, 1.4, pal.paint, 0.05, floorY - 0.04, 0);
  k.box(0.08, 0.4, 1.4, WOOD_D, -0.25, floorY - 0.1, 0);
  bench(k, 0.1, floorY + 0.4, 1.1, WOOD, false);
  k.box(0.08, 0.36, 1.4, WOOD_D, 0.34, floorY - 0.04, 0);
  // the pole to the ox's yoke
  k.rodX(0.05, -2.0, -0.2, WOOD_D, 0.74, 0);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-0.02, 1.45]) for (const s of [-1, 1]) wheels.push(wheel('iron', r, 0.14, WOOD_D, WOOD, x, s * 0.88));
  const ox = createAnimal('ox', pal);
  ox.root.position.set(-1.6, 0, 0);
  root.add(ox.root);
  return { wheels, wheelRadius: r, floorY, seat: [0.1, floorY + 0.4, 0.38], bubbleY: 2.6, extra: walker(ox, 1.3) };
}

/** Era 4: a steam lorry with a banded boiler, a puffing chimney and an open canopy cab. */
function steamLorry(k: Kit, pal: Pal, body: THREE.Group): Build {
  const floorY = 0.8;
  const chassis = darken(pal.trim, 0.05);
  k.slab(3.4, 0.24, 1.2, chassis, 0.05, 0.42, 0);
  // boiler: a fat painted drum with brass bands and a round smokebox door
  k.rodX(0.42, -1.72, -0.45, pal.paint, 1.06, 0);
  for (const x of [-1.5, -1.05, -0.62]) k.rodX(0.445, x - 0.04, x + 0.04, BRASS, 1.06, 0);
  k.rodX(0.4, -1.84, -1.72, lighten(chassis, 0.1), 1.06, 0);
  k.rodX(0.28, -1.9, -1.84, pal.alt, 1.06, 0);
  k.ball(0.07, 0.07, 0.07, BRASS, -1.92, 1.06, 0);
  for (const s of [-1, 1]) k.box(0.3, 0.42, 0.12, chassis, -1.1, 0.5, s * 0.3);
  // chimney with a flared brass cap
  k.cyl(0.11, 0.13, 0.95, chassis, -1.45, 1.9, 0);
  k.cyl(0.2, 0.12, 0.18, BRASS, -1.45, 2.42, 0);
  // the lamp on the smokebox
  k.ball(0.11, 0.11, 0.11, LAMP, -1.82, 1.58, 0, k.lamps);
  k.box(0.1, 0.06, 0.1, BRASS, -1.82, 1.46, 0);
  // cab: floor, bench, brass posts and a scalloped canopy
  k.box(0.95, 0.08, 1.5, WOOD_D, -0.08, floorY - 0.12, 0);
  k.box(0.35, 0.6, 1.3, pal.alt, -0.35, 0.6, 0);
  bench(k, 0.12, floorY + 0.08, 1.2, pal.alt);
  for (const x of [-0.5, 0.32]) for (const s of [-1, 1]) k.cyl(0.035, 0.035, 1.35, BRASS, x, floorY + 0.6, s * 0.7);
  k.slab(1.15, 0.1, 1.62, pal.paint, -0.09, 2.0, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) k.ball(0.13, 0.07, 0.08, pal.paint, -0.52 + i * 0.29, 2.0, s * 0.78);
  // a wooden bed and mudguards over the big rear wheels
  openBed(k, floorY, 0.34, 0.74, WOOD, pal.alt, BRASS);
  for (const s of [-1, 1]) k.slab(1.0, 0.07, 0.3, pal.paint, 1.2, 1.08, s * 0.9);
  const wheels: THREE.Object3D[] = [];
  for (const s of [-1, 1]) wheels.push(wheel('steam', 0.4, 0.18, pal.paint, 0, -1.15, s * 0.82));
  for (const s of [-1, 1]) wheels.push(wheel('steam', 0.5, 0.22, pal.paint, 0, 1.2, s * 0.9));
  // two soft puffs that rise from the chimney and fade
  const puffs = [0, 0.5].map((off) => {
    const p = new THREE.Mesh(geo.sphere(0.2, 12, 8), toon(0xf6f3ee));
    p.name = 'puff';
    p.castShadow = false;
    p.userData.offset = off;
    body.add(p);
    return p;
  });
  return {
    wheels,
    wheelRadius: 0.5,
    floorY,
    seat: [0.12, floorY + 0.08, 0.38],
    bubbleY: 2.85,
    extra: (_dt, _speed, moving, _b, t) => {
      for (const p of puffs) {
        const u = (t * (0.7 + moving * 0.6) + (p.userData.offset as number)) % 1;
        p.position.set(-1.45 + u * 0.5 * (0.3 + moving), 2.55 + u * 0.8, 0);
        p.scale.setScalar(Math.sin(u * Math.PI) * (0.8 + u * 0.7));
      }
    },
  };
}

/** Era 5: a 1920s flatbed with a long rounded hood, swoopy fenders and stake sides. */
function flatbed1920s(k: Kit, pal: Pal): Build {
  const floorY = 0.76;
  const chassis = pal.trim;
  k.slab(3.5, 0.2, 1.1, chassis, 0.0, 0.42, 0);
  // long hood with a rounded top, a tall cream radiator and its cap
  k.box(1.15, 0.5, 1.0, pal.paint, -1.22, 0.6, 0);
  k.ball(0.58, 0.14, 0.5, pal.paint, -1.22, 1.1, 0);
  k.slab(0.14, 0.72, 1.0, CREAM, -1.84, 0.5, 0);
  k.cbox(0.06, 0.5, 0.7, lighten(chassis, 0.25), -1.92, 0.88, 0);
  k.ball(0.06, 0.06, 0.06, BRASS, -1.84, 1.28, 0);
  // swoopy fenders, running boards and lamps on stalks
  for (const s of [-1, 1]) {
    k.ball(0.55, 0.2, 0.2, chassis, -1.12, 0.8, s * 0.72);
    k.ball(0.5, 0.18, 0.2, chassis, 1.2, 0.84, s * 0.82);
    k.box(1.5, 0.06, 0.26, chassis, 0.06, 0.46, s * 0.66);
    k.cyl(0.03, 0.03, 0.3, chassis, -1.7, 1.0, s * 0.64);
    k.ball(0.12, 0.12, 0.1, CREAM, -1.72, 1.2, s * 0.64);
    k.ball(0.09, 0.09, 0.05, LAMP, -1.81, 1.2, s * 0.64, k.lamps);
  }
  // cab: doors, rear wall with a little oval window, a flat roof on pillars
  for (const s of [-1, 1]) k.box(0.95, 0.55, 0.08, pal.paint, -0.18, 0.6, s * 0.6);
  k.box(0.1, 1.38, 1.24, pal.paint, 0.33, 0.6, 0);
  k.ball(0.03, 0.16, 0.3, GLASS, 0.385, 1.55, 0);
  k.box(0.25, 0.55, 1.2, pal.paint, -0.62, 0.6, 0);
  bench(k, 0.08, floorY + 0.12, 1.1, darken(pal.alt, 0.1), false);
  roofedCab(k, -0.66, 0.38, 1.15, 1.98, 0.64, pal);
  // stake-side flatbed
  k.box(BED_LEN, 0.08, 1.56, WOOD, TRUCK_BED_X, floorY - 0.08, 0);
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 3; i++) k.box(0.07, 0.36, 0.07, pal.alt, BED_X0 + 0.04 + (i * (BED_LEN - 0.08)) / 3, floorY - 0.04, s * 0.76);
    k.rodX(0.045, BED_X0, BED_X1, pal.alt, floorY + 0.3, s * 0.76);
  }
  k.rodZ(0.045, 1.56, pal.alt, BED_X1 - 0.04, floorY + 0.3);
  k.box(0.06, 0.1, 0.16, TAIL, 1.82, 0.62, 0.5, undefined, k.tails);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-1.12, 1.2]) for (const s of [-1, 1]) wheels.push(wheel('artillery', 0.4, 0.2, CREAM, pal.alt, x, s * 0.72));
  return { wheels, wheelRadius: 0.4, floorY, seat: [0.08, floorY + 0.12, 0.34], bubbleY: 2.5 };
}

/** Era 6: a low electric milk float with a rounded nose, a bubble roof, crate rails and a glowing battery strip. */
function milkFloat(k: Kit, pal: Pal): Build {
  const floorY = 0.6;
  const white = lighten(pal.paint, 0.55);
  k.slab(3.5, 0.22, 1.4, pal.trim, 0.0, 0.24, 0);
  // rounded nose and cab sides
  k.box(1.25, 0.55, 1.36, pal.paint, -1.1, 0.4, 0);
  k.ball(0.38, 0.32, 0.68, pal.paint, -1.72, 0.68, 0);
  k.ball(0.12, 0.1, 0.06, LAMP, -2.05, 0.74, 0.42, k.lamps);
  k.ball(0.12, 0.1, 0.06, LAMP, -2.05, 0.74, -0.42, k.lamps);
  k.cbox(0.06, 0.12, 1.0, white, -2.06, 0.5, 0);
  // bubble roof on slim pillars over the driver
  k.ball(0.95, 0.16, 0.78, white, -0.75, 1.98, 0);
  for (const s of [-1, 1]) {
    k.cbox(0.07, 1.0, 0.07, white, -1.5, 1.45, s * 0.62, { rz: -0.25 });
    k.cbox(0.07, 1.05, 0.07, white, 0.08, 1.45, s * 0.62);
  }
  k.cbox(0.05, 0.75, 1.15, GLASS, -1.52, 1.4, 0, { rz: -0.25 });
  bench(k, -0.35, floorY + 0.24, 1.1, pal.alt);
  k.box(0.12, 0.62, 1.36, pal.paint, 0.26, 0.4, 0);
  // the glowing battery strip along both sides and a little roof lamp
  for (const s of [-1, 1]) k.cbox(1.4, 0.08, 0.04, pal.glow, -0.9, 0.62, s * 0.7, undefined, k.glow);
  k.ball(0.09, 0.09, 0.09, pal.glow, -0.75, 2.16, 0, k.glow);
  // open bed with crate rails
  k.box(BED_LEN, 0.08, 1.5, lighten(pal.trim, 0.3), TRUCK_BED_X, floorY - 0.08, 0);
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 4; i++) k.cyl(0.035, 0.035, 0.5, white, BED_X0 + 0.04 + (i * (BED_LEN - 0.08)) / 4, floorY + 0.25, s * 0.72);
    for (const h of [0.22, 0.48]) k.rodX(0.04, BED_X0, BED_X1, pal.paint, floorY + h, s * 0.72);
  }
  k.rodZ(0.04, 1.44, pal.paint, BED_X1 - 0.03, floorY + 0.48);
  k.rodZ(0.04, 1.44, pal.paint, BED_X1 - 0.03, floorY + 0.22);
  k.box(0.06, 0.1, 0.16, TAIL, 1.8, 0.38, 0.55, undefined, k.tails);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-1.15, 1.3]) for (const s of [-1, 1]) wheels.push(wheel('tyre', 0.3, 0.18, white, pal.paint, x, s * 0.7));
  return { wheels, wheelRadius: 0.3, floorY, seat: [-0.35, floorY + 0.24, 0.34], bubbleY: 2.6 };
}

/** Era 7: a chunky pickup on fat tyres with saddle tanks and a drum tank on the roof rack. */
function tankerPickup(k: Kit, pal: Pal): Build {
  const floorY = 0.98;
  const r = 0.48;
  k.slab(3.6, 0.28, 1.4, pal.trim, 0.0, 0.52, 0);
  // tall hood, a big rounded bumper, a grille in the other era colour
  k.slab(1.25, 0.6, 1.76, pal.paint, -1.2, 0.78, 0);
  k.cbox(0.08, 0.36, 1.2, lighten(pal.trim, 0.2), -1.84, 1.1, 0);
  k.rodZ(0.14, 1.9, STEEL, -1.9, 0.72);
  for (const s of [-1, 1]) k.ball(0.11, 0.11, 0.06, LAMP, -1.85, 1.2, s * 0.68, k.lamps);
  // cab: doors, rear wall, roof on pillars
  for (const s of [-1, 1]) k.box(0.95, 0.62, 0.09, pal.paint, -0.1, 0.8, s * 0.84);
  k.box(0.12, 1.32, 1.76, pal.paint, 0.36, 0.8, 0);
  k.box(0.24, 0.62, 1.6, pal.paint, -0.52, 0.8, 0);
  bench(k, 0.12, floorY + 0.12, 1.3, pal.trim);
  roofedCab(k, -0.6, 0.42, 1.42, 2.15, 0.86, pal);
  // the tank: a drum on the roof rack with banded ends, and two saddle tanks
  for (const s of [-1, 1]) k.box(0.08, 0.14, 0.08, STEEL, -0.1, 2.27, s * 0.6);
  k.rodZ(0.24, 1.36, pal.alt, -0.1, 2.62);
  for (const s of [-1, 1]) k.rodZ(0.26, 0.08, CREAM, -0.1, 2.62, s * 0.6);
  for (const s of [-1, 1]) {
    k.rodX(0.2, -0.55, 0.3, pal.alt, 0.62, s * 0.86);
    k.rodX(0.21, -0.18, -0.12, CREAM, 0.62, s * 0.86);
  }
  // deep bed with fat fenders
  openBed(k, floorY, 0.42, 0.82, lighten(pal.trim, 0.15), pal.paint, CREAM);
  for (const x of [-1.1, 1.25]) for (const s of [-1, 1]) k.slab(1.05, 0.1, 0.36, pal.trim, x, 1.04, s * 0.92);
  for (const s of [-1, 1]) k.box(0.06, 0.12, 0.2, TAIL, 1.86, 0.9, s * 0.62, undefined, k.tails);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-1.1, 1.25]) for (const s of [-1, 1]) wheels.push(wheel('tyre', r, 0.32, pal.alt, CREAM, x, s * 0.9));
  return { wheels, wheelRadius: r, floorY, seat: [0.12, floorY + 0.12, 0.38], bubbleY: 3.2 };
}

/** Era 8: an 80s cab-over delivery van: boxy cab, big windscreen, three side stripes and a roof light bar. */
function boxyVan(k: Kit, pal: Pal): Build {
  const floorY = 0.72;
  const stripes = [pal.paint, lighten(pal.glow, 0.15), mix(pal.paint, pal.alt, 0.5)];
  const shell = lighten(pal.alt, 0.25);
  k.slab(3.6, 0.22, 1.36, pal.trim, 0.0, 0.36, 0);
  // the boxy cab-over: lower box, stripes, open window band, flat roof with rounded edges
  k.box(2.2, 0.6, 1.66, shell, -0.75, 0.5, 0);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) k.box(2.2, 0.07, 0.03, stripes[i]!, -0.75, 0.72 + i * 0.11, s * 0.84);
  k.cbox(0.06, 0.24, 1.3, lighten(pal.trim, 0.2), -1.86, 0.72, 0);
  for (const s of [-1, 1]) {
    k.cbox(0.06, 0.14, 0.3, LAMP, -1.87, 0.98, s * 0.55, undefined, k.lamps);
    k.box(0.1, 0.94, 0.1, shell, -1.8, 1.1, s * 0.78);
    k.box(0.1, 0.94, 0.1, shell, 0.31, 1.1, s * 0.78);
  }
  k.cbox(0.05, 0.86, 1.46, GLASS, -1.83, 1.55, 0);
  k.box(0.1, 0.94, 1.66, shell, 0.31, 1.1, 0);
  k.slab(2.24, 0.2, 1.68, shell, -0.75, 2.04, 0);
  k.cbox(0.2, 0.08, 1.1, pal.glow, -1.45, 2.3, 0, undefined, k.glow);
  k.box(0.6, 0.04, 1.2, pal.trim, -1.45, 2.24, 0);
  bench(k, -0.55, floorY + 0.42, 1.2, pal.paint);
  // the open rear tray, boxy sides with the same stripes
  openBed(k, floorY, 0.46, 0.8, lighten(pal.trim, 0.25), shell, pal.paint);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.box(BED_LEN, 0.05, 0.03, stripes[i]!, TRUCK_BED_X, floorY + 0.06 + i * 0.1, s * 0.85);
  for (const s of [-1, 1]) k.cbox(0.05, 0.16, 0.16, TAIL, 1.86, 0.78, s * 0.62, undefined, k.tails);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-1.15, 1.25]) for (const s of [-1, 1]) wheels.push(wheel('tyre', 0.36, 0.24, lighten(pal.trim, 0.4), pal.paint, x, s * 0.8));
  return { wheels, wheelRadius: 0.36, floorY, seat: [-0.55, floorY + 0.42, 0.36], bubbleY: 2.85 };
}

/** Era 9: a rounded utility truck with hazard stripes and a green roof beacon. */
function hazardUtility(k: Kit, pal: Pal): Build {
  const floorY = 0.78;
  const shell = pal.paint;
  const band = pal.alt;
  const slate = lighten(TYRE, 0.08);
  k.slab(3.5, 0.24, 1.3, pal.trim, 0.0, 0.4, 0);
  // bubble hood and nose
  k.box(1.1, 0.48, 1.6, shell, -1.2, 0.58, 0);
  k.ball(0.6, 0.2, 0.8, shell, -1.2, 1.06, 0);
  k.ball(0.28, 0.32, 0.8, shell, -1.74, 0.84, 0);
  for (const s of [-1, 1]) k.ball(0.1, 0.1, 0.06, LAMP, -1.98, 0.92, s * 0.5, k.lamps);
  // hazard-striped bumper
  for (let i = 0; i < 9; i++) k.cbox(0.16, 0.2, 0.2, i % 2 ? slate : HAZARD, -2.0, 0.55, -0.8 + i * 0.2, { rx: 0.45 });
  // cab: green doors with a round badge, rounded roof
  for (const s of [-1, 1]) {
    k.box(0.95, 0.56, 0.08, band, -0.15, 0.62, s * 0.8);
    k.cyl(0.16, 0.16, 0.03, lighten(pal.glow, 0.3), -0.15, 0.9, s * 0.85, { rx: HALF_PI });
  }
  k.box(0.12, 1.3, 1.6, shell, 0.34, 0.62, 0);
  k.box(0.26, 0.56, 1.5, shell, -0.6, 0.62, 0);
  bench(k, 0.1, floorY + 0.12, 1.2, band);
  for (const s of [-1, 1]) {
    k.cbox(0.08, 0.8, 0.08, shell, -0.66, 1.58, s * 0.74, { rz: -0.2 });
    k.cbox(0.08, 0.8, 0.08, shell, 0.36, 1.58, s * 0.74);
  }
  k.cbox(0.05, 0.7, 1.4, GLASS, -0.66, 1.58, 0, { rz: -0.2 });
  k.ball(0.66, 0.2, 0.84, shell, -0.15, 2.0, 0);
  k.cyl(0.1, 0.12, 0.08, slate, -0.15, 2.2, 0);
  k.ball(0.13, 0.13, 0.13, pal.glow, -0.15, 2.32, 0, k.glow);
  // the bed with a hazard-striped tail gate
  openBed(k, floorY, 0.42, 0.78, lighten(pal.trim, 0.3), shell, band);
  for (let i = 0; i < 8; i++) k.cbox(0.06, 0.2, 0.19, i % 2 ? slate : HAZARD, BED_X1 + 0.02, floorY + 0.18, -0.67 + i * 0.19, { rx: 0.45 });
  for (const s of [-1, 1]) k.cbox(0.05, 0.14, 0.18, TAIL, 1.86, 0.72, s * 0.62, undefined, k.tails);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-1.1, 1.25]) for (const s of [-1, 1]) wheels.push(wheel('tyre', 0.4, 0.26, band, shell, x, s * 0.8));
  return { wheels, wheelRadius: 0.4, floorY, seat: [0.1, floorY + 0.12, 0.38], bubbleY: 2.85 };
}

/** Era 10: a floating pod cart: smooth hull, a halo roll hoop, four glowing hover discs. */
function hoverPod(k: Kit, pal: Pal): Build {
  const floorY = 0.98;
  const shell = lighten(pal.paint, 0.1);
  const band = pal.alt;
  // the hull: a long soft lozenge with a band round its waist
  k.ball(1.95, 0.34, 0.86, shell, 0.0, 0.66, 0);
  k.ball(1.9, 0.08, 0.88, band, 0.0, 0.62, 0);
  k.cbox(1.4, 0.06, 0.12, pal.glow, -0.6, 0.38, 0, undefined, k.glow);
  k.cbox(0.06, 0.08, 0.7, pal.glow, -1.92, 0.7, 0, undefined, k.glow);
  // cockpit: a padded seat, a low curved windscreen and the halo hoop behind the driver
  k.ball(0.3, 0.12, 0.55, band, -0.45, floorY - 0.04, 0);
  k.ball(0.12, 0.38, 0.5, band, -0.18, floorY + 0.3, 0);
  k.ball(0.12, 0.38, 0.72, GLASS, -1.28, 1.2, 0);
  k.body.add(geo.torus(0.7, 0.07, 8, 24), shell, 0.06, 1.12, 0, { ry: HALF_PI });
  k.ball(0.09, 0.09, 0.09, pal.glow, 0.06, 1.89, 0, k.glow);
  // the cargo tray: a floor and soft rails
  k.box(BED_LEN, 0.08, 1.4, lighten(pal.trim, 0.4), TRUCK_BED_X, floorY - 0.08, 0);
  for (const s of [-1, 1]) {
    k.rodX(0.06, BED_X0, BED_X1, band, floorY + 0.24, s * 0.7);
    for (const x of [BED_X0 + 0.1, TRUCK_BED_X, BED_X1 - 0.1]) k.cyl(0.035, 0.035, 0.26, shell, x, floorY + 0.12, s * 0.7);
  }
  k.rodZ(0.06, 1.4, band, BED_X1 - 0.04, floorY + 0.24);
  const discY = 0.24;
  const wheels: THREE.Object3D[] = [];
  for (const x of [-1.1, 1.25]) for (const s of [-1, 1]) wheels.push(hoverDisc(0.3, pal, x, discY, s * 0.72));
  return {
    wheels,
    wheelRadius: 0.3,
    floorY,
    seat: [-0.45, floorY + 0.08, 0.3],
    bubbleY: 2.6,
    extra: (dt, speed, moving, body, t) => {
      // the hull floats (the discs hover with it) and the discs spin
      const lift = 0.1 + Math.sin(t * 2.3) * 0.045 + moving * 0.03;
      body.position.y = lift;
      for (const w of wheels) {
        w.position.y = discY + lift * 0.6;
        w.rotation.y += dt * (2 + speed * 1.5);
      }
      body.rotation.z = -moving * 0.04;
      return true;
    },
  };
}

/** Walk cycle for a draught animal: legs swing in diagonal pairs, the body bobs, the head nods. */
function walker(a: Animal, stride: number): NonNullable<Build['extra']> {
  let phase = 0;
  return (dt, speed, moving, _body, t) => {
    phase += speed * dt * stride * 2;
    const amp = 0.5 * moving;
    a.legs.forEach((leg, i) => {
      const diag = i === 0 || i === 3 ? 0 : Math.PI;
      leg.rotation.z = Math.sin(phase + diag) * amp;
    });
    a.root.position.y = Math.abs(Math.sin(phase)) * 0.05 * moving;
    a.head.rotation.z = Math.sin(phase * 2) * 0.08 * moving + Math.sin(t * 1.3) * 0.04;
  };
}

const RECIPES: Record<number, (k: Kit, pal: Pal, root: THREE.Group, body: THREE.Group) => Build> = {
  2: (k, p, root) => ponyCart(k, p, root),
  3: (k, p, root) => oxWagon(k, p, root),
  4: (k, p, _root, body) => steamLorry(k, p, body),
  5: (k, p) => flatbed1920s(k, p),
  6: (k, p) => milkFloat(k, p),
  7: (k, p) => tankerPickup(k, p),
  8: (k, p) => boxyVan(k, p),
  9: (k, p) => hazardUtility(k, p),
  10: (k, p) => hoverPod(k, p),
};

// ---------------------------------------------------------------------------
// public factory
// ---------------------------------------------------------------------------

/** Era `era`'s buyer vehicle (2..10; other numbers clamp), painted `paint` (default the era accent). */
export function createEraVehicle(era: number, paint?: number): EraVehicleModel {
  const n = Math.min(10, Math.max(2, Math.round(era)));
  const pal = palette(n, paint);
  const root = new THREE.Group();
  root.name = `eraVehicle:${ERA_VEHICLE_KINDS[n]}`;
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const k = new Kit();
  const b = RECIPES[n]!(k, pal, root, body);

  const bodyMesh = shareBaked(k.body.mesh());
  bodyMesh.name = `${ERA_VEHICLE_KINDS[n]}Body`;
  body.add(bodyMesh);
  if (!k.lamps.empty) body.add(k.lamps.mesh({ material: toon(LAMP, { emissive: LAMP, emissiveIntensity: 0.7 }), cast: false }));
  if (!k.tails.empty) body.add(k.tails.mesh({ material: toon(TAIL, { emissive: TAIL, emissiveIntensity: 0.6 }), cast: false }));
  if (!k.glow.empty) body.add(k.glow.mesh({ material: toon(pal.glow, { emissive: pal.glow, emissiveIntensity: 0.9 }), cast: false }));
  for (const w of b.wheels) root.add(w);

  const bedPivot = new THREE.Object3D();
  bedPivot.name = 'bedPivot';
  bedPivot.position.set(TRUCK_BED_X - 0.02, b.floorY - 0.01, 0);
  body.add(bedPivot);
  const driverSeat = new THREE.Object3D();
  driverSeat.name = 'driverSeat';
  driverSeat.position.set(...b.seat);
  body.add(driverSeat);

  instanceAcrossScene(root);

  let bounce = 0;
  let time = 0;
  const r = b.wheelRadius;
  const animate = (dt: number, speed: number, moving: number): void => {
    time += dt;
    bounce += speed * dt * 5.2;
    if (b.extra?.(dt, speed, moving, body, time) === true) return; // the hover pod moves itself
    const spin = (speed * dt) / r;
    for (const w of b.wheels) w.rotation.z += spin;
    body.position.y = Math.abs(Math.sin(bounce)) * 0.045 * moving;
  };
  animate(0, 0, 0);
  return { root, body, wheels: b.wheels, bedPivot, driverSeat, bubbleY: b.bubbleY, era: n, wheelRadius: r, animate };
}

/** Driver hips sit on the seat: the rig's origin is at its feet (assets/vehicles.ts DRIVER_Y). */
const DRIVER_Y = -0.3;

/** Era `era`'s vehicle with its driver (createCharacterRig('driver')) seated facing −X. */
export function createEraVehicleWithDriver(era: number, paint?: number, variant = 0): { model: EraVehicleModel; rig: CharacterRig } {
  const model = createEraVehicle(era, paint);
  const rig = createCharacterRig('driver', variant);
  rig.setSeated(true);
  rig.root.rotation.y = -Math.PI / 2;
  rig.root.position.y = DRIVER_Y;
  model.driverSeat.add(rig.root);
  return { model, rig };
}
