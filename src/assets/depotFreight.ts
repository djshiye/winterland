/**
 * [eras] Cosmetic freight props for an era's export depot (eras/DepotFreight.ts): a lift hatch with a platform, and a
 * loader that shuttles crates from the depot to it. Built from the era kit (assets/eraKit.ts), merged, cached per
 * era; the lift is 2 static meshes (frame + glow) and a moving platform, the loader 1-2 meshes, the crates one
 * InstancedMesh. Lift model frame: origin floor centre of the hatch, +Z = inward (the yard), the light frame stands
 * on the −Z (fence) side. Loader model frame: origin on the floor, +Z = front (where the crate rides).
 * Eras 2-4 timber hoist + hand cart, 5-7 steel lift + forklift, 8-10 white pad + hovering bot.
 */
import * as THREE from 'three';
import { ERAS } from '../eras/data';
import { vcMat } from '../render/batch';
import { Kit, eraGlowMaterial, hcyl, wheel } from './eraKit';

export const LIFT_HALF = 0.8; // platform is 1.6 x 1.6
export const LIFT_FRAME_Z = -0.95; // frame centre, local (fence side)
export const LIFT_REST_Y = 0.1; // platform mesh origin at rest (its top is at +0.1 above this)
export const LIFT_TOP = 0.2; // platform top at rest, above the floor
export const CRATE = 0.4;

export type FreightTier = 0 | 1 | 2;
export const freightTier = (era: number): FreightTier => (era <= 4 ? 0 : era <= 7 ? 1 : 2);

const PLANK = 0xb4906a;
const TIMBER = 0x8a6a46;
const TIMBER_D = 0x6d5a48;
const BRASS = 0xb08a3e;
const COPPER = 0xc9773a;
const STEEL_D = 0x4b5562;
const STEEL_L = 0xb4bdc8;
const IRON = 0x3d3a3a;
const YELLOW = 0xe8b82a;
const BLACK = 0x222426;
const WELL = 0x12151a;
const WARM = 0xffd070;

interface Pal {
  crate: number;
  crate2: number;
  trim: number;
  body: number;
  glow: number;
}
function pal(era: number): Pal {
  const c = ERAS[era]!.colors;
  switch (freightTier(era)) {
    case 0: return { crate: PLANK, crate2: TIMBER, trim: c.accent, body: TIMBER_D, glow: WARM };
    case 1: return { crate: era === 6 ? COPPER : BRASS, crate2: STEEL_D, trim: c.accent, body: c.body, glow: era === 6 ? 0xfff2c0 : 0xffd98a };
    default: return { crate: era >= 9 ? c.accent : c.accent, crate2: c.body, trim: c.trim, body: c.trim, glow: c.glow };
  }
}

export interface LiftModel {
  root: THREE.Group;
  platform: THREE.Mesh;
}

const liftGeo = new Map<number, { frame: THREE.BufferGeometry; glow: THREE.BufferGeometry; plat: THREE.BufferGeometry }>();

export function createLiftModel(era: number): LiftModel {
  let geos = liftGeo.get(era);
  if (!geos) {
    const f = new Kit();
    const g = new Kit();
    const p = new Kit();
    buildLift(era, f, g, p);
    geos = { frame: f.geometry(), glow: g.geometry(), plat: p.geometry() };
    liftGeo.set(era, geos);
  }
  const root = new THREE.Group();
  root.name = `depotLift:${era}`;
  const frame = new THREE.Mesh(geos.frame, vcMat());
  frame.castShadow = true;
  frame.receiveShadow = true;
  const glow = new THREE.Mesh(geos.glow, eraGlowMaterial());
  const platform = new THREE.Mesh(geos.plat, vcMat());
  platform.castShadow = true;
  platform.position.y = LIFT_REST_Y;
  root.add(frame, glow, platform);
  return { root, platform };
}

function buildLift(era: number, f: Kit, g: Kit, p: Kit): void {
  const t = freightTier(era);
  const P = pal(era);
  const H = LIFT_HALF;
  const wallW = 0.22;
  const curbH = 0.22;
  // hatch: the dark well sits just above the ground so the sinking platform vanishes into it
  f.box(WELL, H * 2, 0.02, H * 2, 0, 0.005, 0);
  const curbCol = t === 0 ? TIMBER_D : t === 1 ? 0x7d8288 : 0xdfe6e8;
  f.box(curbCol, H * 2 + wallW * 2, curbH, wallW, 0, 0, -(H + wallW / 2));
  f.box(curbCol, H * 2 + wallW * 2, curbH, wallW, 0, 0, H + wallW / 2);
  f.box(curbCol, wallW, curbH, H * 2, -(H + wallW / 2), 0, 0);
  f.box(curbCol, wallW, curbH, H * 2, H + wallW / 2, 0, 0);
  const fz = LIFT_FRAME_Z;
  if (t === 0) {
    // timber hoist: two posts, a cross beam, a boom over the hatch, a rope wheel and a hanging rope
    for (const x of [-0.78, 0.78]) f.box(TIMBER, 0.14, 2.1, 0.14, x, 0, fz);
    f.box(TIMBER, 1.7, 0.14, 0.16, 0, 2.0, fz);
    f.beam(TIMBER_D, [-0.78, 0.2, fz], [-0.3, 1.1, fz], 0.08);
    f.beam(TIMBER_D, [0.78, 0.2, fz], [0.3, 1.1, fz], 0.08);
    f.box(TIMBER, 0.14, 0.14, 0.95, 0, 1.92, fz + 0.45);
    f.snow(0, 2.14, fz, 1.7, 0.2, 0.07);
    f.beam(IRON, [0.78, 1.95, fz + 0.08], [0.78, 1.8, fz + 0.2], 0.03);
    g.sph(P.glow, 0.07, 0.78, 1.74, fz + 0.2); // hanging lantern
    wheel(f, 'x', IRON, BRASS, 0.0, 1.62, fz + 0.62, 0.2, 0.05, 6);
    f.beam(0x7c6244, [0, 1.42, fz + 0.62], [0, 0.85, fz + 0.62], 0.04);
    f.box(IRON, 0.12, 0.1, 0.12, 0, 0.75, fz + 0.62);
    for (let i = 0; i < 4; i++) f.box(P.crate, 0.2, 0.05, 0.2, -0.5 + i * 0.33, curbH, -(H + 0.1));
    p.box(PLANK, H * 2 - 0.04, 0.1, H * 2 - 0.04, 0, 0, 0);
    for (let i = 0; i < 4; i++) p.box(TIMBER, H * 2 - 0.04, 0.012, 0.07, 0, 0.1, -0.56 + i * 0.375);
  } else if (t === 1) {
    // steel lift frame: yellow/black edge, two uprights, a head beam and an orange beacon
    for (let i = 0; i < 8; i++) {
      const x = -H + 0.1 + i * 0.2;
      f.box(i % 2 ? BLACK : YELLOW, 0.2, 0.02, wallW, x, curbH, H + wallW / 2);
      f.box(i % 2 ? BLACK : YELLOW, 0.2, 0.02, wallW, x, curbH, -(H + wallW / 2));
    }
    for (const x of [-0.78, 0.78]) {
      f.box(STEEL_D, 0.16, 2.1, 0.16, x, 0, fz);
      for (let i = 0; i < 4; i++) f.box(i % 2 ? BLACK : YELLOW, 0.17, 0.16, 0.17, x, 0.05 + i * 0.16, fz);
    }
    f.box(STEEL_D, 1.7, 0.18, 0.2, 0, 1.92, fz);
    f.beam(STEEL_L, [-0.78, 0.2, fz], [0.78, 1.9, fz], 0.06);
    f.beam(STEEL_L, [0.78, 0.2, fz], [-0.78, 1.9, fz], 0.06);
    f.box(IRON, 0.3, 0.16, 0.3, 0, 2.06, fz);
    g.sph(0xff9a3a, 0.11, 0, 2.2, fz);
    f.box(STEEL_L, 0.1, 0.06, 0.45, 0.55, 1.95, fz + 0.3);
    g.box(P.glow, 0.5, 0.04, 0.04, 0.55, 1.9, fz + 0.52);
    p.box(0x6e757c, H * 2 - 0.04, 0.1, H * 2 - 0.04, 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      p.box(i % 2 ? BLACK : YELLOW, 0.2, 0.012, 0.09, -H + 0.12 + i * 0.2, 0.1, H - 0.1);
      p.box(i % 2 ? BLACK : YELLOW, 0.2, 0.012, 0.09, -H + 0.12 + i * 0.2, 0.1, -H + 0.1);
    }
  } else {
    // white pad with a glowing ring; a slim lintel frame on the fence side
    for (const x of [-0.78, 0.78]) f.box(P.body, 0.1, 2.0, 0.1, x, 0, fz);
    f.box(P.body, 1.66, 0.1, 0.14, 0, 1.95, fz);
    f.box(0xdfe6e8, 1.2, 0.14, 0.2, 0, 2.05, fz);
    g.box(P.glow, 1.1, 0.04, 0.04, 0, 1.9, fz + 0.1);
    g.box(P.glow, 0.05, 1.5, 0.03, -0.78, 0.35, fz + 0.06);
    g.box(P.glow, 0.05, 1.5, 0.03, 0.78, 0.35, fz + 0.06);
    g.add(new THREE.TorusGeometry(1.32, 0.035, 6, 36), P.glow, 0, 0.03, 0, { rx: Math.PI / 2 });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.box(P.glow, 0.12, 0.03, 0.12, x * (H + 0.11), curbH, z * (H + 0.11));
    p.box(0xeef1f0, H * 2 - 0.04, 0.1, H * 2 - 0.04, 0, 0, 0);
    p.box(P.trim, H * 2 - 0.04, 0.012, 0.06, 0, 0.1, H - 0.1);
    p.box(P.trim, H * 2 - 0.04, 0.012, 0.06, 0, 0.1, -H + 0.1);
    p.box(P.trim, 0.06, 0.012, H * 2 - 0.04, H - 0.1, 0.1, 0);
    p.box(P.trim, 0.06, 0.012, H * 2 - 0.04, -H + 0.1, 0.1, 0);
  }
}

// ---------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------

export interface LoaderSpec {
  /** Distance from the loader origin to the crate centre along its facing. */
  reach: number;
  /** Crate centre height above the floor while carried. */
  carryY: number;
  speed: number;
  /** Idle bob amplitude (hovering bot only). */
  bob: number;
  hover: number;
}
export const LOADER_SPECS: Record<FreightTier, LoaderSpec> = {
  0: { reach: 0.12, carryY: 0.45, speed: 0.85, bob: 0, hover: 0 },
  1: { reach: 0.95, carryY: 0.3, speed: 1.1, bob: 0, hover: 0 },
  2: { reach: 0.6, carryY: 0.62, speed: 1.4, bob: 0.03, hover: 0.14 },
};

export interface LoaderModel {
  root: THREE.Group;
}
const loaderGeo = new Map<number, { body: THREE.BufferGeometry; glow: THREE.BufferGeometry | null }>();

export function createLoaderModel(era: number): LoaderModel {
  let geos = loaderGeo.get(era);
  if (!geos) {
    const b = new Kit();
    const g = new Kit();
    buildLoader(era, b, g);
    const glow = freightTier(era) === 0 ? null : g.geometry();
    geos = { body: b.geometry(), glow };
    loaderGeo.set(era, geos);
  }
  const root = new THREE.Group();
  root.name = `depotLoader:${era}`;
  const body = new THREE.Mesh(geos.body, vcMat());
  body.castShadow = true;
  root.add(body);
  if (geos.glow) root.add(new THREE.Mesh(geos.glow, eraGlowMaterial()));
  return { root };
}

function buildLoader(era: number, b: Kit, g: Kit): void {
  const t = freightTier(era);
  const P = pal(era);
  const c = ERAS[era]!.colors;
  if (t === 0) {
    // hand cart: a bed on one axle with two big wheels, two handles trailing behind, a little prop lantern
    const col = era === 2 ? TIMBER : era === 3 ? 0x7a6a58 : 0x8a5a3e;
    b.box(col, 0.56, 0.06, 0.62, 0, 0.26, 0.1);
    b.box(TIMBER_D, 0.56, 0.12, 0.05, 0, 0.32, 0.4);
    b.box(TIMBER_D, 0.05, 0.12, 0.62, -0.28, 0.32, 0.1);
    b.box(TIMBER_D, 0.05, 0.12, 0.62, 0.28, 0.32, 0.1);
    hcyl(b, IRON, 0.05, 0.7, 0, 0.22, 0.1, 'x', 6);
    for (const x of [-0.37, 0.37]) {
      hcyl(b, TIMBER_D, 0.22, 0.07, x, 0.22, 0.1, 'x', 12);
      hcyl(b, IRON, 0.05, 0.1, x, 0.22, 0.1, 'x', 6);
    }
    b.beam(TIMBER, [-0.22, 0.28, -0.2], [-0.2, 0.5, -0.75], 0.05);
    b.beam(TIMBER, [0.22, 0.28, -0.2], [0.2, 0.5, -0.75], 0.05);
    b.box(c.accent, 0.46, 0.04, 0.05, 0, 0.5, -0.75);
  } else if (t === 1) {
    // forklift: chassis, cab with a roof, mast with two forks, a beacon
    const paint = era === 5 ? 0xe8892c : era === 6 ? 0x3f8a86 : YELLOW;
    b.box(paint, 0.62, 0.26, 0.9, 0, 0.16, -0.05);
    b.box(IRON, 0.5, 0.1, 0.3, 0, 0.42, -0.35);
    b.box(STEEL_D, 0.5, 0.05, 0.5, 0, 0.78, -0.12);
    for (const x of [-0.22, 0.22]) {
      b.box(IRON, 0.04, 0.42, 0.04, x, 0.4, 0.1);
      b.box(IRON, 0.04, 0.42, 0.04, x, 0.4, -0.34);
    }
    b.box(0x2a2e33, 0.3, 0.12, 0.3, 0, 0.42, -0.14);
    for (const x of [-0.36, 0.36]) {
      b.cyl(IRON, 0.17, 0.12, x - 0.0, 0.0, -0.3, 10, 0.17, { rz: Math.PI / 2 });
      b.cyl(IRON, 0.13, 0.12, x, 0.0, 0.3, 10, 0.13, { rz: Math.PI / 2 });
    }
    for (const x of [-0.2, 0.2]) b.box(STEEL_L, 0.05, 0.9, 0.05, x, 0.0, 0.48);
    b.box(STEEL_D, 0.5, 0.06, 0.06, 0, 0.7, 0.48);
    b.box(STEEL_D, 0.5, 0.06, 0.06, 0, 0.2, 0.48);
    for (const x of [-0.14, 0.14]) b.box(STEEL_L, 0.07, 0.04, 0.9, x, 0.08, 0.95);
    b.box(IRON, 0.14, 0.1, 0.14, 0, 0.83, -0.3);
    g.sph(0xff9a3a, 0.07, 0, 0.94, -0.3);
    g.box(P.glow, 0.1, 0.06, 0.03, -0.2, 0.3, 0.41);
    g.box(P.glow, 0.1, 0.06, 0.03, 0.2, 0.3, 0.41);
  } else {
    // hover bot: rounded body, a glowing eye strip, two arms holding the crate, a glow ring underneath
    const shell = era === 8 ? 0xe6dfcc : 0xf0f3f1;
    b.sph(shell, 0.3, 0, 0.5, -0.1, { sy: 0.85, sz: 1.1 });
    b.dome(c.trim, 0.2, 0, 0.66, -0.12);
    b.box(c.trim, 0.12, 0.2, 0.06, 0, 0.36, -0.42);
    for (const s of [-1, 1]) {
      b.beam(shell, [s * 0.26, 0.5, 0.0], [s * 0.26, 0.45, 0.42], 0.07);
      b.box(c.trim, 0.06, 0.1, 0.2, s * 0.26, 0.4, 0.48);
    }
    g.box(P.glow, 0.26, 0.06, 0.04, 0, 0.58, 0.19);
    g.add(new THREE.TorusGeometry(0.27, 0.03, 6, 20), P.glow, 0, 0.17, -0.1, { rx: Math.PI / 2 });
    g.sph(P.glow, 0.04, 0, 0.75, -0.12);
  }
}

// ---------------------------------------------------------------------------
// crates
// ---------------------------------------------------------------------------

export function createCrates(era: number, count: number): THREE.InstancedMesh {
  const P = pal(era);
  const k = new Kit();
  k.box(P.crate, CRATE, CRATE, CRATE, 0, -CRATE / 2, 0);
  k.box(P.crate2, CRATE + 0.03, 0.07, CRATE + 0.03, 0, -0.1, 0);
  k.box(P.crate2, 0.07, CRATE + 0.03, CRATE + 0.03, 0, -CRATE / 2, 0);
  const m = new THREE.InstancedMesh(k.geometry(), vcMat(), count);
  m.name = `depotCrates:${era}`;
  m.castShadow = true;
  m.frustumCulled = false;
  return m;
}
