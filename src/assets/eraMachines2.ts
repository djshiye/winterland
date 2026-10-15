/**
 * 0.9.x expansion: the 12 new machine models for eras 2–4 (four per era: extractor, processor, premium, cash).
 * Standalone builders, not wired into eras/data.ts yet: the 0.9 climb work adds the ids and calls
 * `createEraMachine2Model(id)` where it needs one.
 *
 * Sources: docs/art/era-02..04.json on branch art/ages-spec (part layout) and the ARGON chat guide
 * (docs/art/guide.md), whose warmer palettes win over guide.json.
 *
 * CONTRACT (same as assets/eraMachines.ts, so eras/Machine.ts can use either):
 * - Local frame: origin at the floor centre, +Y up, +Z front, +X right. The input and output pallets at
 *   (±1.6, 0.12, +1.8) and the worker spot at (0, 0, +2.2) are kept clear; eras/Machine.ts supplies them.
 * - Footprint ≤ 5.2 × 5.2 m (on a 4.8 × 4.8 m bevelled plinth), height ≤ 6 m, with the animated part at any angle.
 * - Exactly 3 meshes: 'body' (merged, vertex-coloured, snow included), 'glow' (the shared night-registered
 *   `eraGlowMaterial()`) and 'pivot' (the one animated part, origin at its rotation centre).
 * - `animate(dt, working)` drives the pivot from one phase: full speed while working, a slow idle crawl otherwise.
 *   Motions follow the guide: Y or Z rotation (spin / swing) or a vertical bob. No allocation per frame.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { vcMat } from '../render/batch';
import type { MachineModel } from './eraMachines';
import { SNOW, Kit, eraGlowMaterial, hcyl, seeded, wheel, type Rot, type V3 } from './eraKit';

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

export type EraMachine2Id =
  | 'clayPit' | 'tileKiln' | 'masonYard' | 'strongbox'
  | 'charcoalClamp' | 'forge' | 'railMill' | 'mintChute'
  | 'scrapYard' | 'boilerShop' | 'engineWorks' | 'pneumaticTubes';

export type EraMachine2Role = 'extractor' | 'processor' | 'premium' | 'cash';

export interface EraMachine2Info {
  era: 2 | 3 | 4;
  role: EraMachine2Role;
}

export const ERA_MACHINES_2: Readonly<Record<EraMachine2Id, EraMachine2Info>> = {
  clayPit: { era: 2, role: 'extractor' },
  tileKiln: { era: 2, role: 'processor' },
  masonYard: { era: 2, role: 'premium' },
  strongbox: { era: 2, role: 'cash' },
  charcoalClamp: { era: 3, role: 'extractor' },
  forge: { era: 3, role: 'processor' },
  railMill: { era: 3, role: 'premium' },
  mintChute: { era: 3, role: 'cash' },
  scrapYard: { era: 4, role: 'extractor' },
  boilerShop: { era: 4, role: 'processor' },
  engineWorks: { era: 4, role: 'premium' },
  pneumaticTubes: { era: 4, role: 'cash' },
};

export const ERA_MACHINE_2_IDS = Object.keys(ERA_MACHINES_2) as readonly EraMachine2Id[];

// ---------------------------------------------------------------------------
// palette (ARGON chat guide rows for eras 2–4, plus warm material tones)
// ---------------------------------------------------------------------------

const E2 = { body: 0x8c857b, accent: 0xb85239, trim: 0x5c4028, glow: 0xffb347, fence: 0x6e5a4f };
const E3 = { body: 0xa65e46, accent: 0x4a5559, trim: 0x2f3538, glow: 0xff9233, fence: 0x4f4c49 };
const E4 = { body: 0x9e4737, accent: 0xd49a35, trim: 0x383d40, glow: 0xffbe55, fence: 0x464b4f };

// era 2: rough timber, fieldstone, terracotta clay
const TIMBER = 0x8a5a3b;
const TIMBER_D = 0x6d5a48;
const TIMBER_DD = 0x5c3b22;
const PLANK = 0xb4906a;
const STONE = 0xa7a39b;
const STONE_L = 0xc4bfb4;
const FLAG = 0xb9b2a6;
const CLAY = 0xb5543c;
const CLAY_D = 0x8e4030;
const CLAY_WET = 0x9c4836;
const EARTH = 0x7a6650;
const LEATHER = 0x7a4a2e;
const LEATHER_D = 0x5e3822;
const GOLD = 0xe8b341;
const GOLD_D = 0xc9952e;
const IRON_W = 0x4d4440;
const ROPE = 0xcbb08a;
// era 3: forged iron (warm-tinted), terracotta brick, charcoal earth
const IRON3 = 0x6a6058;
const IRON3_D = 0x4a423d;
const IRON3_L = 0x857a70;
const EARTH3 = 0x5e4c44;
const TURF = 0x6e6b48;
const TURF_D = 0x585636;
const CHAR = 0x2e2a2a;
const STONE3 = 0x7a6e66;
const COPPER = 0xa8603a;
const BRASS3 = 0xb08a3e;
const BRASS3_L = 0xcfa955;
const WATER = 0x7aa6b8;
// era 4: brick, polished brass, black iron (warm)
const IRON4 = 0x6a605b;
const IRON4_D = 0x4e4643;
const IRON4_L = 0x857a73;
const BRASS4 = 0xd49a35;
const BRASS4_L = 0xe8bb5e;
const ROOF4 = 0x5a4c4a;
const ROOF4_D = 0x4a3f3e;
const MAHOG = 0x7a3a2a;
const MAHOG_D = 0x5e2e22;
const RUST = 0x8a4a32;
const SMOKE = 0xe6e9ee;

// glow tints (multiplied into the shared emissive material by vertex colour)
const G_FIRE = 0xff8a30;
const G_WARM = 0xffd070;

const _c = new THREE.Color();
const _w = new THREE.Color(0xffffff);
/** Lighten (f > 0, towards white) or darken (f < 0) a colour. */
function tint(c: number, f: number): number {
  _c.setHex(c);
  if (f >= 0) _c.lerp(_w, f);
  else _c.multiplyScalar(1 + f);
  return _c.getHex();
}

// ---------------------------------------------------------------------------
// shared helpers
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

/** Bevelled box with its bottom face at `y` (the guide wants ≥ 0.08 m bevels on the big shapes). */
function rb(k: Kit, color: number, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.08, o?: Rot): void {
  const rr = Math.max(0.005, Math.min(r, Math.min(w, h, d) / 2 - 0.005));
  k.add(cached(`rb${w}|${h}|${d}|${rr.toFixed(3)}`, () => new RoundedBoxGeometry(w, h, d, 2, rr)), color, x, y + h / 2, z, o);
}

/** Rounded snow cap (bottom at `y`). */
function cap(k: Kit, w: number, d: number, x: number, y: number, z: number, h = 0.12, o?: Rot): void {
  rb(k, SNOW, w, h, d, x, y, z, 0.05, o);
}

/** Box centred at (x, y, z) (rotations pivot around the centre). */
function boxC(k: Kit, color: number, w: number, h: number, d: number, x: number, y: number, z: number, o?: Rot): void {
  k.box(color, w, h, d, x, y - h / 2, z, o);
}

/** The guide's 4.8 × 4.8 × 0.25 m bevelled plinth with snow drifts on the corners. */
function plinth(k: Kit, color: number): void {
  rb(k, color, 4.8, 0.25, 4.8, 0, 0, 0, 0.1);
  rb(k, tint(color, 0.1), 4.5, 0.03, 4.5, 0, 0.24, 0, 0.01);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) k.sph(SNOW, 0.36, sx * 2.02, 0.26, sz * 2.02, { sy: 0.38 });
}

/** Chimney: tapering stack, rim band, snow ring and a dark mouth. Top of the mouth at y + h + 0.05. */
function chimney(k: Kit, color: number, rim: number, x: number, y: number, z: number, r: number, h: number): void {
  k.cyl(color, r, h, x, y, z, 10, r * 0.86);
  k.cyl(rim, r * 0.96, 0.16, x, y + h - 0.12, z, 10);
  k.torus(SNOW, r * 0.78, 0.06, x, y + h + 0.04, z, { rx: Math.PI / 2 }, 12);
  k.cyl(CHAR, r * 0.66, 0.03, x, y + h + 0.02, z, 10);
}

/** Upper half of a torus (an arch) in the XY plane, centred at (x, y, z); `ry` turns it. */
function arch(k: Kit, color: number, r: number, tube: number, x: number, y: number, z: number, ry = 0): void {
  k.add(cached(`ar${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, 6, 14, Math.PI)), color, x, y, z, { ry });
}

/** Upper half disc facing +Z, centred at (x, y, z) (an arched window pane). */
function halfDisc(k: Kit, color: number, r: number, x: number, y: number, z: number): void {
  k.add(cached(`hd${r}`, () => new THREE.CircleGeometry(r, 10, 0, Math.PI)), color, x, y, z);
}

/** Curved snow shell over a cylinder lying along X (radius r, vertical squash `sq`), centred at (x, yc, z). */
function snowArc(k: Kit, r: number, len: number, x: number, yc: number, z: number, sq: number, spread = 0.95): void {
  const g = cached(`sa${r}|${len}|${spread}`, () => new THREE.CylinderGeometry(r, r, len, 16, 1, true, Math.PI / 2 - spread, spread * 2));
  k.add(g, SNOW, x, yc, z, { rz: Math.PI / 2, sx: sq });
}

/** A heap of squashed lumps in the given colours. */
function lumps(k: Kit, cols: readonly number[], cx: number, y0: number, cz: number, rad: number, n: number, seed: number, r = 0.17): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * rad;
    const rr = r * (0.7 + rnd() * 0.6);
    k.sph(cols[i % cols.length]!, rr, cx + Math.cos(a) * d, y0 + rr * 0.45 + (1 - d / rad) * rad * 0.25, cz + Math.sin(a) * d, { sy: 0.8 });
  }
}

/** Little lantern hanging at (x, y, z): cap, glowing globe, base ring. */
function lantern(b: Kit, g: Kit, color: number, x: number, y: number, z: number, r = 0.13): void {
  b.cone(IRON_W, r * 1.15, r, x, y + r * 0.7, z, 8);
  g.sph(color, r, x, y, z);
  b.cyl(IRON_W, r * 0.9, 0.05, x, y - r - 0.02, z, 8);
}

/** Stack of coins at (x, y, z). */
function coins(k: Kit, x: number, y: number, z: number, n: number, r = 0.14): void {
  for (let i = 0; i < n; i++) k.cyl(i % 2 ? GOLD_D : GOLD, r, 0.05, x + (i % 2) * 0.012, y + i * 0.052, z, 10);
}

// ---------------------------------------------------------------------------
// recipe framework
// ---------------------------------------------------------------------------

interface Parts {
  body: Kit;
  glow: Kit;
  anim: Kit;
}

/** The animated part: built around the origin of `anim`, placed at `at` (its rotation centre). */
interface AnimSpec {
  at: V3;
  /** spin = turn continuously; swing = bias + sin · amp radians; bob = rise by bias + sin · amp metres. */
  motion: 'spin' | 'swing' | 'bob';
  axis: 'y' | 'z';
  /** Seconds per cycle while working. */
  period: number;
  amp: number;
  bias?: number;
}

type Recipe = (p: Parts) => AnimSpec;

// ---------------------------------------------------------------------------
// era 2 — Frontier: rough timber, fieldstone, warm hearth firelight
// ---------------------------------------------------------------------------

/** clayPit: terraced clay dig under a timber derrick; the bucket arm swings over the pit. */
const clayPit: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, E2.trim);
  const cz = -0.1;
  // two earthen terraces, a snowy lip and the wet clay pit
  b.cyl(EARTH, 2.15, 0.35, 0, 0.25, cz, 20, 2.05);
  b.cyl(tint(EARTH, 0.14), 1.8, 0.3, 0, 0.6, cz, 20, 1.7);
  b.torus(SNOW, 1.62, 0.11, 0, 0.92, cz, { rx: Math.PI / 2 }, 28);
  b.cyl(CLAY_D, 1.5, 0.05, 0, 0.88, cz, 18);
  b.cyl(CLAY, 1.2, 0.04, 0, 0.9, cz, 16);
  b.cyl(CLAY_WET, 0.6, 0.03, 0.35, 0.93, cz + 0.3, 12, 0.6, { sz: 0.7 });
  lumps(b, [CLAY, CLAY_D, 0xc8664a], -0.45, 0.86, cz - 0.35, 0.7, 7, 21, 0.19);
  for (const t of [0.5, 2.2, 3.9, 5.3]) b.sph(SNOW, 0.3, Math.cos(t) * 1.95, 0.6, cz + Math.sin(t) * 1.95, { sy: 0.35 });
  // shovel stuck in the clay
  b.beam(TIMBER, [0.95, 0.9, -0.75], [1.2, 1.85, -0.9], 0.07);
  boxC(b, IRON_W, 0.26, 0.32, 0.05, 0.92, 0.98, -0.73, { rz: -0.26 });
  // timber derrick: two posts with back braces and a snowy cross beam
  for (const x of [-1.15, 1.15]) {
    b.beam(TIMBER, [x, 0.85, -0.95], [x, 2.85, -0.95], 0.24);
    b.beam(TIMBER_D, [x, 0.6, -1.75], [x, 2.2, -0.95], 0.13);
  }
  rb(b, TIMBER_D, 2.7, 0.26, 0.3, 0, 2.72, -0.95, 0.05);
  cap(b, 2.6, 0.34, 0, 2.97, -0.95, 0.1);
  // rope coil on the left post and a pennant on top
  hcyl(b, ROPE, 0.12, 0.3, -1.15, 1.5, -0.75, 'z', 10);
  b.beam(TIMBER, [-1.15, 3.0, -0.95], [-1.15, 3.4, -0.95], 0.07);
  b.prismXY(E2.accent, [[0, 0], [0.42, -0.11], [0, -0.22]], 0.03, -1.12, 3.38, -0.965);
  // two lanterns on brackets
  for (const x of [-1.15, 1.15]) {
    b.beam(IRON_W, [x, 2.42, -0.95], [x, 2.42, -0.62], 0.05);
    b.beam(IRON_W, [x, 2.42, -0.62], [x, 2.3, -0.62], 0.03);
    lantern(b, g, E2.glow, x, 2.14, -0.62, 0.14);
  }
  // sluice chute running clay out to the right
  const rz = -0.38;
  boxC(b, PLANK, 1.5, 0.08, 0.6, 1.6, 0.86, 0.35, { rz });
  for (const s of [-1, 1]) boxC(b, TIMBER_D, 1.5, 0.24, 0.07, 1.6, 0.95, 0.35 + s * 0.3, { rz });
  boxC(b, CLAY, 1.4, 0.03, 0.46, 1.6, 0.92, 0.35, { rz });
  b.beam(TIMBER_D, [2.1, 0.25, 0.35], [2.1, 0.66, 0.35], 0.1);
  // finished clay slabs, stacked at the back
  for (let i = 0; i < 3; i++) rb(b, i % 2 ? CLAY_D : CLAY, 0.42, 0.18, 0.32, 1.78, 0.25 + i * 0.19, -1.88, 0.05, { ry: i * 0.18 });
  cap(b, 0.4, 0.3, 1.78, 0.82, -1.88, 0.08);
  // ANIM: bucket arm under the cross beam; the bucket circles over the pit
  a.cyl(IRON_W, 0.14, 0.2, 0, -0.1, 0, 10);
  a.beam(TIMBER, [0, 0, -0.1], [0, -0.05, 1.5], 0.16);
  a.beam(TIMBER_D, [0, 0, 0], [0, 0, -0.5], 0.13);
  rb(a, STONE, 0.3, 0.3, 0.3, 0, -0.22, -0.55, 0.06);
  a.beam(ROPE, [0, -0.05, 1.42], [0, -0.95, 1.42], 0.035);
  a.cyl(TIMBER_D, 0.24, 0.42, 0, -1.4, 1.42, 10, 0.3);
  a.cyl(IRON_W, 0.27, 0.05, 0, -1.33, 1.42, 10);
  a.cyl(IRON_W, 0.305, 0.05, 0, -1.08, 1.42, 10);
  a.torus(IRON_W, 0.28, 0.025, 0, -0.98, 1.42, undefined, 12);
  a.sph(CLAY, 0.27, 0, -0.98, 1.42, { sy: 0.45 });
  return { at: [0, 2.62, -0.95], motion: 'swing', axis: 'y', period: 2.2, amp: 0.75 };
};

/** tileKiln: fieldstone oven with a domed brick chamber, twin chimneys, a tile drying rack and a pump-lever bellows. */
const tileKiln: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, E2.trim);
  const cz = -0.4;
  // fieldstone base with a darker course line and a snowy ledge
  rb(b, E2.body, 3.2, 1.2, 3.0, 0, 0.25, cz, 0.12);
  rb(b, tint(E2.body, -0.14), 3.26, 0.09, 3.06, 0, 0.82, cz, 0.04);
  cap(b, 3.1, 2.9, 0, 1.45, cz);
  // brick chamber + dome, with brick bands and a snow cap
  b.cyl(CLAY, 1.15, 1.05, 0, 1.5, cz, 18, 1.1, { sx: 1.15 });
  b.cyl(CLAY_D, 1.165, 0.09, 0, 1.8, cz, 18, 1.165, { sx: 1.15 });
  b.cyl(CLAY_D, 1.135, 0.09, 0, 2.22, cz, 18, 1.135, { sx: 1.15 });
  b.dome(CLAY, 1.1, 0, 2.55, cz, { sx: 1.15, sy: 0.72 });
  b.sph(SNOW, 0.95, 0, 3.0, cz, { sx: 1.15, sy: 0.4 });
  // peep hole on the chamber front
  g.sph(E2.glow, 0.13, 0, 2.05, cz + 1.13);
  b.torus(CLAY_D, 0.16, 0.05, 0, 2.05, cz + 1.15, undefined, 12);
  // twin chimneys with ember mouths
  for (const x of [-0.62, 0.62]) {
    chimney(b, CLAY_D, tint(CLAY_D, -0.25), x, 2.7, cz - 0.55, 0.22, 1.05);
    g.cyl(E2.glow, 0.13, 0.04, x, 3.775, cz - 0.55, 10);
  }
  // arched firebox on the front
  const fz = cz + 1.5;
  rb(b, tint(E2.body, -0.25), 1.1, 0.6, 0.16, 0, 0.25, fz + 0.02, 0.05);
  b.cyl(tint(E2.body, -0.25), 0.55, 0.16, 0, 0.85 - 0.08, fz + 0.02, 12, 0.55, { rx: Math.PI / 2 });
  g.box(G_FIRE, 0.7, 0.55, 0.05, 0, 0.3, fz + 0.12);
  g.cyl(G_FIRE, 0.35, 0.05, 0, 0.85 - 0.025, fz + 0.125, 12, 0.35, { rx: Math.PI / 2 });
  // drying rack with roof tiles, on the left
  for (const z of [-1.5, -0.6, 0.3]) for (const x of [-2.25, -1.8]) b.beam(TIMBER, [x, 0.25, z], [x, 1.75, z], 0.09);
  for (const [i, y] of [0.7, 1.15].entries()) {
    rb(b, PLANK, 0.55, 0.06, 1.95, -2.02, y, -0.6, 0.02);
    for (let t = 0; t < 4; t++) rb(b, (t + i) % 2 ? CLAY_D : CLAY, 0.36, 0.08, 0.3, -2.02, y + 0.06, -1.35 + t * 0.5, 0.03, { ry: 0.12 * (t % 2 ? 1 : -1) });
  }
  rb(b, TIMBER_D, 0.7, 0.07, 2.1, -2.02, 1.75, -0.6, 0.02);
  cap(b, 0.62, 2.0, -2.02, 1.82, -0.6, 0.1);
  // leather bellows on the right with a nozzle into the oven
  for (let i = 0; i < 3; i++) rb(b, i % 2 ? LEATHER_D : LEATHER, 0.5 - (i % 2) * 0.06, 0.16, 0.8, 2.0, 0.25 + i * 0.16, 0.35, 0.05);
  rb(b, TIMBER_D, 0.56, 0.06, 0.88, 2.0, 0.73, 0.35, 0.02);
  b.beam(IRON_W, [1.75, 0.5, 0.35], [1.55, 0.5, 0.35], 0.1);
  b.beam(TIMBER_D, [2.0, 0.25, -0.35], [2.0, 1.2, -0.35], 0.14);
  // ANIM: the pump lever rocks side to side
  a.cyl(IRON_W, 0.09, 0.22, 0, -0.11, 0, 8, 0.09, { rx: Math.PI / 2 });
  a.beam(TIMBER, [0, 0, 0], [0, 1.0, 0], 0.11);
  a.sph(E2.accent, 0.11, 0, 1.05, 0);
  a.beam(IRON_W, [0, 0.3, 0], [0, -0.36, 0.7], 0.05);
  return { at: [2.0, 1.15, -0.35], motion: 'swing', axis: 'z', period: 1.8, amp: 0.32 };
};

/** masonYard: flagstone yard with a lean-to of stone stock, a workbench under a saw gantry and a mini hearth on show. */
const masonYard: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, E2.trim);
  rb(b, FLAG, 4.4, 0.08, 4.2, 0, 0.25, 0, 0.03);
  const rnd = seeded(7);
  for (let i = 0; i < 14; i++) {
    const s = 0.45 + rnd() * 0.3;
    rb(b, [FLAG, STONE, STONE_L][i % 3]!, s, 0.04, s * (0.7 + rnd() * 0.4), -1.7 + rnd() * 3.4, 0.33, -1.7 + rnd() * 3.4, 0.015, { ry: rnd() });
  }
  // lean-to at the back, sloping away, sheltering the rough stone stock
  for (const x of [-1.8, 1.8]) {
    b.cyl(TIMBER_DD, 0.12, 2.35, x, 0.33, -0.75, 8);
    b.cyl(TIMBER_DD, 0.12, 1.75, x, 0.33, -1.9, 8);
  }
  rb(b, TIMBER_D, 3.8, 0.14, 0.18, 0, 2.56, -0.75, 0.04);
  rb(b, TIMBER_D, 3.9, 0.12, 1.5, 0, 2.32, -1.33, 0.03, { rx: -0.5 });
  cap(b, 3.8, 1.38, 0, 2.43, -1.33, 0.12, { rx: -0.5 });
  rb(b, STONE, 0.75, 0.45, 0.6, -1.2, 0.33, -1.45, 0.06);
  rb(b, tint(STONE, -0.1), 0.6, 0.42, 0.55, -1.15, 0.78, -1.4, 0.06, { ry: 0.25 });
  rb(b, STONE_L, 0.55, 0.4, 0.5, -0.45, 0.33, -1.5, 0.06, { ry: -0.2 });
  rb(b, STONE, 0.7, 0.5, 0.55, 0.45, 0.33, -1.45, 0.06, { ry: 0.1 });
  rb(b, tint(STONE, -0.08), 0.6, 0.38, 0.5, 1.25, 0.33, -1.5, 0.06, { ry: -0.15 });
  // workbench in the open
  const wz = 0.15;
  rb(b, TIMBER, 2.2, 0.12, 0.9, 0, 1.0, wz, 0.04);
  for (const x of [-0.95, 0.95]) for (const z of [wz - 0.35, wz + 0.35]) b.beam(TIMBER_D, [x, 0.33, z], [x, 1.0, z], 0.1);
  rb(b, TIMBER_D, 2.0, 0.06, 0.7, 0, 0.5, wz, 0.02);
  // the stone being sawn, with its cut groove
  rb(b, STONE_L, 0.9, 0.34, 0.6, -0.15, 1.12, wz, 0.05);
  b.box(tint(STONE, -0.35), 0.05, 0.14, 0.62, -0.15, 1.33, wz);
  // mallet and chisel
  b.beam(TIMBER, [0.55, 1.16, wz + 0.25], [0.85, 1.16, wz + 0.1], 0.05);
  rb(b, TIMBER_D, 0.16, 0.16, 0.24, 0.5, 1.12, wz + 0.27, 0.04, { ry: 0.45 });
  // saw gantry: two A-frames and a snowy top beam
  for (const x of [-1.3, 1.1]) {
    for (const s of [-1, 1]) b.beam(TIMBER, [x, 0.33, wz + s * 0.6], [x, 2.55, wz], 0.14);
    b.beam(TIMBER_D, [x, 1.2, wz - 0.37], [x, 1.2, wz + 0.37], 0.08);
  }
  rb(b, TIMBER_D, 2.7, 0.18, 0.22, -0.1, 2.5, wz, 0.04);
  cap(b, 2.6, 0.3, -0.1, 2.68, wz, 0.1);
  // mini hearth on show, on a pedestal at the right, with a glowing fire
  const hx = 1.75;
  const hz = 0.2;
  rb(b, STONE, 0.7, 0.5, 0.6, hx, 0.33, hz, 0.06);
  rb(b, STONE, 0.62, 0.52, 0.42, hx, 0.83, hz - 0.05, 0.05);
  b.box(CHAR, 0.34, 0.28, 0.05, hx, 0.87, hz + 0.17);
  rb(b, TIMBER_D, 0.76, 0.08, 0.52, hx, 1.35, hz - 0.05, 0.02);
  cap(b, 0.7, 0.46, hx, 1.43, hz - 0.05, 0.08);
  g.box(G_FIRE, 0.3, 0.22, 0.04, hx, 0.89, hz + 0.2);
  g.sph(E2.glow, 0.08, hx, 0.95, hz + 0.12);
  // finished hearthstones stacked at the left
  for (let i = 0; i < 3; i++) rb(b, i % 2 ? STONE : STONE_L, 0.5, 0.1, 0.4, -1.85, 0.33 + i * 0.11, 0.25, 0.03, { ry: i * 0.12 });
  // lantern on the left gantry frame
  b.beam(IRON_W, [-1.3, 2.2, wz], [-1.3, 2.2, wz + 0.35], 0.04);
  lantern(b, g, E2.glow, -1.3, 1.95, wz + 0.35, 0.13);
  // ANIM: a frame saw hangs from the gantry and rocks across the stone
  a.cyl(IRON_W, 0.08, 0.22, 0, -0.11, 0, 8, 0.08, { rx: Math.PI / 2 });
  a.beam(TIMBER_D, [0, 0, 0], [0, -0.82, 0], 0.09);
  a.beam(TIMBER, [-0.68, -0.82, 0], [0.68, -0.82, 0], 0.1);
  for (const s of [-1, 1]) {
    a.beam(TIMBER, [s * 0.6, -0.82, 0], [s * 0.6, -1.0, 0], 0.07);
    hcyl(a, TIMBER_D, 0.05, 0.25, s * 0.8, -0.82, 0, 'x', 6);
  }
  a.box(0xd8d2c4, 1.3, 0.1, 0.03, 0, -1.05, 0);
  return { at: [-0.15, 2.45, wz], motion: 'swing', axis: 'z', period: 2.4, amp: 0.3 };
};

/** strongbox: iron-banded treasure chest on a stone step; the hopper lid flips open to swallow coins. */
const strongbox: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, E2.trim);
  rb(b, STONE, 3.4, 0.3, 3.0, 0, 0.25, -0.2, 0.08);
  const cz = -0.3;
  // chest with a rounded lid
  rb(b, TIMBER, 2.6, 1.3, 2.0, 0, 0.55, cz, 0.1);
  b.cyl(tint(TIMBER, 0.06), 1.0, 2.6, 0, 0.55, cz, 18, 1.0, { rz: Math.PI / 2, sx: 0.55 });
  snowArc(b, 1.02, 2.3, 0, 1.85, cz, 0.56, 0.9);
  // iron bands round chest and lid
  for (const x of [-0.85, 0.85]) {
    rb(b, IRON_W, 0.22, 1.34, 2.06, x, 0.53, cz, 0.03);
    b.cyl(IRON_W, 1.03, 0.22, x, 1.85 - 0.11, cz, 18, 1.03, { rz: Math.PI / 2, sx: 0.565 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rb(b, GOLD_D, 0.18, 0.28, 0.18, sx * 1.25, 0.53, cz + sz * 0.95, 0.04);
  // padlock
  rb(b, GOLD_D, 0.16, 0.42, 0.06, 0, 1.45, cz + 1.02, 0.02);
  rb(b, GOLD, 0.38, 0.34, 0.16, 0, 1.08, cz + 1.04, 0.05);
  b.torus(GOLD_D, 0.12, 0.035, 0, 1.45, cz + 1.04, undefined, 12);
  b.box(CHAR, 0.06, 0.12, 0.02, 0, 1.17, cz + 1.12);
  // coin funnel on the lid, full of glowing coins
  b.cyl(E2.accent, 0.24, 0.62, 0, 2.28, cz, 12, 0.5);
  b.torus(GOLD_D, 0.5, 0.05, 0, 2.9, cz, { rx: Math.PI / 2 }, 16);
  g.sph(G_WARM, 0.4, 0, 2.9, cz, { sy: 0.22 });
  // counter lamp on a post
  b.beam(TIMBER_DD, [1.5, 0.55, 0.85], [1.5, 2.25, 0.85], 0.1);
  b.beam(IRON_W, [1.5, 2.2, 0.85], [1.5, 2.2, 1.1], 0.05);
  lantern(b, g, E2.glow, 1.5, 1.95, 1.1, 0.13);
  // coin stacks on the step
  coins(b, -1.48, 0.55, 0.95, 5);
  coins(b, -1.2, 0.55, 0.85, 3);
  coins(b, -1.5, 0.55, 0.6, 2);
  // ANIM: hopper lid hinged on its left edge, flipping open and shut
  hcyl(a, IRON_W, 0.05, 0.3, 0, 0.03, 0, 'z', 8);
  a.cyl(TIMBER_D, 0.55, 0.07, 0.52, 0, 0, 14);
  a.torus(GOLD_D, 0.55, 0.035, 0.52, 0.035, 0, { rx: Math.PI / 2 }, 16);
  a.cyl(GOLD, 0.17, 0.05, 0.5, 0.07, 0, 14);
  a.sph(GOLD, 0.08, 0.98, 0.1, 0);
  return { at: [-0.52, 2.93, cz], motion: 'swing', axis: 'z', period: 2.0, amp: 0.5, bias: 0.5 };
};

// ---------------------------------------------------------------------------
// era 3 — Iron Age: terracotta brick, forged iron, charcoal
// ---------------------------------------------------------------------------

/** charcoalClamp: turf-and-snow charcoal mound in a stake ring, glowing vents, a damper that lifts to puff smoke. */
const charcoalClamp: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E3.trim, 0.18));
  const cz = -0.1;
  // stake ring with an earth fill
  b.cyl(EARTH3, 2.0, 0.55, 0, 0.25, cz, 22);
  const rnd = seeded(31);
  for (let i = 0; i < 30; i++) {
    const t = (i / 30) * Math.PI * 2;
    rb(b, i % 2 ? TIMBER_D : tint(TIMBER_D, -0.12), 0.44, 0.6 + rnd() * 0.12, 0.16, Math.cos(t) * 2.08, 0.25, cz + Math.sin(t) * 2.08, 0.03, { ry: Math.PI / 2 - t });
  }
  b.torus(SNOW, 2.04, 0.11, 0, 0.9, cz, { rx: Math.PI / 2 }, 32);
  // the mound, patched with turf sods, a snow cap on top
  b.dome(EARTH3, 1.9, 0, 0.75, cz, { sy: 0.66 });
  for (let i = 0; i < 14; i++) {
    const t = rnd() * Math.PI * 2;
    const d = 0.35 + rnd() * 1.35;
    const y = 0.75 + 1.254 * Math.sqrt(Math.max(0, 1 - (d / 1.9) ** 2));
    b.sph(i % 2 ? TURF : TURF_D, 0.3, Math.cos(t) * d, y - 0.06, cz + Math.sin(t) * d, { sy: 0.32 });
  }
  b.sph(SNOW, 1.15, 0, 1.85, cz, { sy: 0.3 });
  // flue stack with a glowing draught and the damper rod
  b.cyl(IRON3, 0.3, 0.85, 0, 1.95, cz, 10, 0.26);
  b.cyl(BRASS3, 0.3, 0.1, 0, 2.7, cz, 10);
  b.cyl(CHAR, 0.22, 0.02, 0, 2.8, cz, 10);
  g.cyl(E3.glow, 0.19, 0.03, 0, 2.81, cz, 10);
  b.beam(IRON3_D, [0, 2.8, cz], [0, 3.4, cz], 0.06);
  // glowing boreholes round the foot, embers in the mound
  for (const t of [0.45, 1.25, 2.4, 5.6]) {
    b.box(CHAR, 0.4, 0.3, 0.06, Math.cos(t) * 2.15, 0.27, cz + Math.sin(t) * 2.15, { ry: Math.PI / 2 - t });
    g.box(G_FIRE, 0.3, 0.2, 0.06, Math.cos(t) * 2.19, 0.31, cz + Math.sin(t) * 2.19, { ry: Math.PI / 2 - t });
  }
  for (const [t, d] of [[0.7, 1.45], [1.6, 1.2], [5.9, 1.5]] as const) {
    const y = 0.75 + 1.254 * Math.sqrt(1 - (d / 1.9) ** 2);
    g.sph(G_FIRE, 0.11, Math.cos(t) * d, y, cz + Math.sin(t) * d);
  }
  // charcoal basket and a log stack in the back corners
  rb(b, TIMBER_D, 0.5, 0.35, 0.45, 1.9, 0.25, -1.95, 0.04);
  lumps(b, [CHAR, 0x3b3534], 1.9, 0.5, -1.95, 0.18, 5, 3, 0.1);
  for (const [x, y] of [[-2.05, 0.37], [-1.77, 0.37], [-1.91, 0.6]] as const) hcyl(b, TIMBER, 0.12, 0.7, x, y, -1.9, 'z', 8);
  cap(b, 0.5, 0.55, -1.91, 0.7, -1.9, 0.08);
  // ANIM: the damper lid lifts and drops on its rod, puffing smoke
  a.cyl(IRON3_D, 0.36, 0.06, 0, 0, 0, 12);
  a.cone(IRON3, 0.34, 0.28, 0, 0.06, 0, 12);
  a.sph(BRASS3, 0.06, 0, 0.38, 0);
  a.sph(SMOKE, 0.26, 0.05, 0.75, 0);
  a.sph(SMOKE, 0.18, -0.12, 1.05, 0.05);
  return { at: [0, 2.86, cz], motion: 'bob', axis: 'y', period: 2.4, amp: 0.2, bias: 0.2 };
};

/** forge: stone hearth with a brick hood and chimney, an anvil with a glowing bar and a trip hammer that pounds it. */
const forge: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E3.trim, 0.18));
  rb(b, STONE3, 4.0, 0.5, 3.2, 0, 0.25, -0.5, 0.12);
  // brick hood over the hearth
  rb(b, E3.body, 2.0, 1.3, 1.6, -0.85, 0.75, -1.25, 0.1);
  rb(b, tint(E3.body, -0.15), 2.06, 0.08, 1.66, -0.85, 1.35, -1.25, 0.03);
  cap(b, 2.04, 1.64, -0.85, 2.05, -1.25, 0.1);
  b.cyl(tint(E3.body, -0.08), 1.2, 0.75, -0.85, 2.05, -1.25, 4, 0.5, { ry: Math.PI / 4 });
  chimney(b, E3.body, IRON3, -0.85, 2.6, -1.25, 0.32, 1.45);
  g.cyl(E3.glow, 0.2, 0.04, -0.85, 4.075, -1.25, 10);
  // hearth mouth, coal tray and glowing coals
  rb(b, CHAR, 1.3, 0.62, 0.08, -0.85, 0.85, -0.44, 0.03);
  g.box(G_FIRE, 1.1, 0.42, 0.05, -0.85, 0.9, -0.38);
  rb(b, IRON3, 1.5, 0.14, 0.12, -0.85, 1.47, -0.42, 0.04);
  rb(b, IRON3_D, 1.3, 0.12, 0.45, -0.85, 0.75, -0.2, 0.04);
  g.box(G_FIRE, 1.1, 0.06, 0.35, -0.85, 0.86, -0.2);
  lumps(b, [CHAR, 0x3b3534], -0.85, 0.8, -0.2, 0.45, 6, 17, 0.09);
  // anvil on a stump, with the hot bar
  b.cyl(TIMBER_D, 0.32, 0.45, 0.45, 0.75, 0.35, 10, 0.3);
  rb(b, IRON3_D, 0.42, 0.16, 0.3, 0.45, 1.2, 0.35, 0.03);
  rb(b, IRON3, 0.8, 0.16, 0.36, 0.5, 1.36, 0.35, 0.04);
  b.cone(IRON3, 0.13, 0.34, -0.07, 1.44 - 0.17, 0.35, 8, { rz: Math.PI / 2 });
  g.box(G_WARM, 0.5, 0.06, 0.1, 0.48, 1.52, 0.35);
  // trip hammer frame
  for (const z of [0.05, 0.65]) b.beam(TIMBER, [1.95, 0.75, z], [1.95, 2.15, z], 0.2);
  rb(b, TIMBER_D, 0.3, 0.16, 0.86, 1.95, 2.12, 0.35, 0.04);
  cap(b, 0.3, 0.8, 1.95, 2.28, 0.35, 0.08);
  // quench trough
  rb(b, TIMBER_D, 0.7, 0.45, 1.25, -1.6, 0.75, 0.4, 0.05);
  b.box(WATER, 0.56, 0.02, 1.1, -1.6, 1.17, 0.4);
  for (const z of [-0.05, 0.85]) rb(b, IRON3_D, 0.74, 0.08, 0.08, -1.6, 0.95, z, 0.02);
  // coal bin at the back right
  rb(b, TIMBER_D, 1.1, 0.5, 0.8, 1.25, 0.75, -1.55, 0.05);
  lumps(b, [CHAR, 0x3b3534], 1.25, 1.12, -1.55, 0.4, 8, 5, 0.13);
  b.sph(SNOW, 0.3, 1.45, 1.28, -1.7, { sy: 0.35 });
  // ANIM: trip hammer arm on its axle, pounding the anvil
  hcyl(a, IRON3_D, 0.12, 0.3, 0, 0, 0, 'z', 10);
  a.beam(TIMBER, [0.3, 0, 0], [-1.55, 0, 0], 0.18);
  for (const x of [-0.6, -1.15]) rb(a, IRON3_D, 0.08, 0.22, 0.22, x, -0.11, 0, 0.02);
  rb(a, IRON3_D, 0.4, 0.4, 0.42, -1.48, -0.33, 0, 0.06);
  rb(a, IRON3_L, 0.3, 0.06, 0.32, -1.48, -0.36, 0, 0.02);
  rb(a, IRON3_D, 0.22, 0.22, 0.22, 0.25, -0.11, 0, 0.04);
  return { at: [1.95, 1.95, 0.35], motion: 'swing', axis: 'z', period: 1.4, amp: 0.22, bias: -0.22 };
};

/** railMill: two roller stands squeezing a glowing billet into rail, a reheat furnace and a big drive flywheel. */
const railMill: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E3.trim, 0.18));
  const lz = -0.25;
  // bed with runout rollers and the glowing billet line
  rb(b, IRON3_D, 4.3, 0.45, 1.4, 0, 0.25, lz, 0.08);
  for (let x = -1.95; x <= 1.96; x += 0.39) {
    if (Math.abs(Math.abs(x) - 0.8) < 0.32) continue;
    hcyl(b, IRON3_L, 0.09, 1.1, x, 0.81, lz, 'z', 8);
  }
  g.box(G_FIRE, 3.6, 0.12, 0.34, 0, 0.9, lz);
  // two roller stands
  for (const sx of [-0.8, 0.8]) {
    for (const pz of [lz - 0.6, lz + 0.6]) rb(b, IRON3, 0.42, 2.0, 0.3, sx, 0.7, pz, 0.06);
    rb(b, IRON3_D, 0.5, 0.3, 1.55, sx, 2.7, lz, 0.06);
    cap(b, 0.46, 1.5, sx, 3.0, lz, 0.1);
    hcyl(b, IRON3_L, 0.2, 0.95, sx, 0.7, lz, 'z', 12);
    hcyl(b, IRON3_L, 0.2, 0.95, sx, 1.22, lz, 'z', 12);
    b.cyl(BRASS3, 0.05, 0.28, sx, 3.08, lz, 6);
    b.torus(BRASS3, 0.22, 0.04, sx, 3.36, lz, { rx: Math.PI / 2 }, 12);
    for (const t of [0, Math.PI / 2]) b.beam(BRASS3, [sx - Math.cos(t) * 0.22, 3.36, lz - Math.sin(t) * 0.22], [sx + Math.cos(t) * 0.22, 3.36, lz + Math.sin(t) * 0.22], 0.04);
  }
  // indicator lamp on the left stand
  b.beam(IRON3_D, [-0.8, 2.3, lz + 0.75], [-0.8, 2.3, lz + 0.87], 0.05);
  g.sph(E3.glow, 0.12, -0.8, 2.3, lz + 0.95);
  // reheat furnace with a glowing door and a tall chimney
  rb(b, E3.body, 1.7, 1.5, 1.1, -1.25, 0.25, -1.7, 0.1);
  rb(b, tint(E3.body, -0.15), 1.76, 0.08, 1.16, -1.25, 1.1, -1.7, 0.03);
  cap(b, 1.6, 1.0, -1.25, 1.75, -1.7);
  rb(b, IRON3_D, 0.9, 0.62, 0.06, -1.25, 0.47, -1.15, 0.02);
  g.box(G_FIRE, 0.7, 0.45, 0.05, -1.25, 0.55, -1.11);
  chimney(b, E3.body, IRON3, -1.6, 1.75, -1.85, 0.28, 2.0);
  g.cyl(E3.glow, 0.17, 0.04, -1.6, 3.775, -1.85, 10);
  // flywheel pedestal, axle and drive shaft to the right stand
  rb(b, IRON3_D, 0.35, 1.2, 0.3, 1.35, 0.25, -2.05, 0.05);
  hcyl(b, IRON3_D, 0.1, 0.7, 1.35, 1.55, -1.85, 'z', 8);
  b.beam(IRON3_L, [1.35, 1.55, -1.55], [0.8, 1.22, -0.95], 0.1);
  // cooling rack with finished rails (front right)
  for (const x of [0.65, 2.05]) for (const z of [0.6, 1.1]) b.beam(IRON3_D, [x, 0.25, z], [x, 0.7, z], 0.08);
  rb(b, IRON3_D, 1.5, 0.06, 0.6, 1.35, 0.68, 0.85, 0.02);
  for (let i = 0; i < 4; i++) {
    rb(b, IRON3_L, 1.4, 0.05, 0.1, 1.35, 0.74, 0.62 + i * 0.15, 0.015);
    rb(b, IRON3_L, 1.4, 0.1, 0.04, 1.35, 0.79, 0.62 + i * 0.15, 0.015);
    rb(b, tint(IRON3_L, 0.2), 1.4, 0.05, 0.08, 1.35, 0.89, 0.62 + i * 0.15, 0.015);
  }
  // billet stock under snow (front left)
  for (const [y, z] of [[0.25, 0.65], [0.25, 0.9], [0.45, 0.78]] as const) rb(b, IRON3, 0.9, 0.2, 0.2, -1.45, y, z, 0.04);
  cap(b, 0.85, 0.3, -1.45, 0.65, 0.78, 0.08);
  // ANIM: heavy drive flywheel
  wheel(a, 'z', IRON3, IRON3_D, 0, 0, 0, 0.88, 0.11, 6);
  a.torus(BRASS3_L, 0.72, 0.04, 0, 0, 0.06, undefined, 18);
  a.cyl(BRASS3, 0.16, 0.24, 0, -0.12, 0, 10, 0.16, { rx: Math.PI / 2 });
  return { at: [1.35, 1.55, -1.62], motion: 'spin', axis: 'z', period: 1.6, amp: 0 };
};

/** mintChute: banded iron vault with a round door, a copper coin funnel, a glowing coin tray and a brass balance on top. */
const mintChute: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E3.trim, 0.18));
  rb(b, STONE3, 3.2, 0.3, 2.9, 0, 0.25, -0.25, 0.08);
  const cz = -0.35;
  // vault cabinet with ribs, terracotta corner posts and rivets
  rb(b, IRON3_L, 2.4, 1.6, 2.1, 0, 0.55, cz, 0.12);
  for (const y of [0.95, 1.75]) rb(b, E3.accent, 2.48, 0.12, 2.18, 0, y, cz, 0.04);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rb(b, E3.body, 0.2, 1.62, 0.2, sx * 1.15, 0.54, cz + sz * 1.0, 0.05);
  for (let i = 0; i < 6; i++) for (const y of [1.01, 1.81]) b.sph(BRASS3_L, 0.035, -0.9 + i * 0.36, y, cz + 1.1);
  cap(b, 2.36, 2.06, 0, 2.15, cz, 0.12);
  // round vault door with a dial and four handles
  const dz = cz + 1.05;
  b.cyl(BRASS3, 0.5, 0.1, 0, 1.35 - 0.05, dz + 0.05, 18, 0.5, { rx: Math.PI / 2 });
  b.torus(IRON3_D, 0.5, 0.05, 0, 1.35, dz + 0.1, undefined, 20);
  b.cyl(IRON3_D, 0.16, 0.08, 0, 1.35 - 0.04, dz + 0.14, 12, 0.16, { rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    const t = Math.PI / 4 + (i * Math.PI) / 2;
    b.beam(BRASS3_L, [0, 1.35, dz + 0.17], [Math.cos(t) * 0.34, 1.35 + Math.sin(t) * 0.34, dz + 0.17], 0.05);
    b.sph(BRASS3_L, 0.05, Math.cos(t) * 0.34, 1.35 + Math.sin(t) * 0.34, dz + 0.17);
  }
  // coin tray at the foot: the glow
  b.box(CHAR, 0.7, 0.12, 0.04, 0, 0.72, dz);
  rb(b, IRON3_D, 1.0, 0.18, 0.4, 0, 0.55, dz + 0.18, 0.04);
  g.box(G_WARM, 0.82, 0.07, 0.3, 0, 0.7, dz + 0.2);
  // copper coin funnel
  b.cyl(BRASS3, 0.38, 0.14, 0, 2.2, cz - 0.15, 14);
  b.cyl(COPPER, 0.28, 0.75, 0, 2.15, cz - 0.15, 14, 0.6);
  b.torus(BRASS3, 0.6, 0.05, 0, 2.9, cz - 0.15, { rx: Math.PI / 2 }, 18);
  g.sph(G_WARM, 0.5, 0, 2.9, cz - 0.15, { sy: 0.22 });
  // lamp post at the left
  b.beam(IRON3_D, [-1.42, 0.55, 0.5], [-1.42, 2.45, 0.5], 0.09);
  b.beam(IRON3_D, [-1.42, 2.4, 0.5], [-1.42, 2.4, 0.75], 0.05);
  lantern(b, g, E3.glow, -1.42, 2.15, 0.75, 0.13);
  // coin stacks on the step
  coins(b, 1.4, 0.55, 0.85, 4);
  coins(b, 1.12, 0.55, 0.95, 2);
  // balance post on the cabinet top
  b.beam(BRASS3, [0.85, 2.15, 0.35], [0.85, 2.74, 0.35], 0.09);
  // ANIM: brass balance rocking, coins against a weight
  a.sph(BRASS3_L, 0.08, 0, 0, 0);
  a.beam(BRASS3, [-0.66, 0, 0], [0.66, 0, 0], 0.07);
  for (const s of [-1, 1]) {
    a.beam(IRON3_D, [s * 0.62, 0, 0], [s * 0.62, -0.3, 0], 0.025);
    a.cyl(BRASS3_L, 0.2, 0.04, s * 0.62, -0.34, 0, 12);
  }
  coins(a, 0.62, -0.3, 0, 3, 0.09);
  rb(a, IRON3_D, 0.16, 0.16, 0.16, -0.62, -0.3, 0, 0.04);
  return { at: [0.85, 2.78, 0.35], motion: 'swing', axis: 'z', period: 1.8, amp: 0.3 };
};

// ---------------------------------------------------------------------------
// era 4 — Steam Age: brick, polished brass, black iron
// ---------------------------------------------------------------------------

/** One straight fence run (posts + two rails + snow on top) from (x0, z0) to (x1, z1). */
function fenceRun(k: Kit, post: number, rail: number, x0: number, z0: number, x1: number, z1: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.ceil(len / 0.55);
  const ry = -Math.atan2(z1 - z0, x1 - x0);
  for (let i = 0; i <= n; i++) rb(k, post, 0.14, 0.95, 0.14, x0 + ((x1 - x0) * i) / n, 0.25, z0 + ((z1 - z0) * i) / n, 0.03);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  for (const y of [0.45, 0.85]) rb(k, rail, len, 0.1, 0.08, cx, y, cz, 0.02, { ry });
  cap(k, len, 0.16, cx, 0.95, cz, 0.08, { ry });
}

/** scrapYard: fenced yard with a heap of scrap, a sorting table under a tin lean-to and a swinging crane jib. */
const scrapYard: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E4.trim, 0.18));
  rb(b, 0x6a625c, 3.9, 0.04, 3.2, 0, 0.25, -0.55, 0.02);
  fenceRun(b, E4.fence, TIMBER_D, -2.1, -2.1, 2.1, -2.1);
  fenceRun(b, E4.fence, TIMBER_D, -2.1, -2.1, -2.1, 0.9);
  fenceRun(b, E4.fence, TIMBER_D, 2.1, -2.1, 2.1, 0.6);
  // scrap heap: mixed metal lumps on a mound, a gear, a pipe and a barrel
  const mx = -0.6;
  const mz = -0.9;
  b.dome(IRON4, 1.25, mx, 0.29, mz, { sy: 0.7, sz: 0.85 });
  const rnd = seeded(9);
  const cols = [RUST, IRON4_D, BRASS4, COPPER, IRON4_L];
  for (let i = 0; i < 16; i++) {
    const t = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.95;
    const dx = Math.cos(t) * d * 1.25;
    const dz = Math.sin(t) * d * 1.06;
    const y = 0.29 + 0.875 * Math.sqrt(Math.max(0, 1 - d * d));
    const r = 0.16 + rnd() * 0.12;
    if (i % 3 === 0) rb(b, cols[i % 5]!, r * 2, r, r * 1.4, mx + dx, y - r * 0.4, mz + dz, 0.03, { ry: t, rz: 0.3 });
    else b.sph(cols[i % 5]!, r, mx + dx, y - 0.04, mz + dz, { sy: 0.75 });
  }
  b.torus(BRASS4, 0.3, 0.07, mx + 0.35, 1.0, mz + 0.35, { rx: 0.9, ry: 0.5 }, 16);
  b.sph(IRON4_D, 0.1, mx + 0.35, 1.0, mz + 0.35);
  hcyl(b, IRON4_L, 0.11, 1.1, mx - 0.5, 0.72, mz + 0.55, 'x', 10);
  b.cyl(RUST, 0.25, 0.55, -1.6, 0.25, -1.65, 10);
  for (const y of [0.37, 0.65]) b.cyl(IRON4_D, 0.265, 0.05, -1.6, y, -1.65, 10);
  b.sph(SNOW, 0.6, mx - 0.1, 1.0, mz - 0.1, { sy: 0.3 });
  b.sph(SNOW, 0.35, mx + 0.6, 0.75, mz - 0.5, { sy: 0.32 });
  // sorting table with bits on it
  for (const x of [0.85, 1.85]) for (const z of [-1.0, -0.2]) b.beam(TIMBER_D, [x, 0.25, z], [x, 0.95, z], 0.08);
  rb(b, PLANK, 1.2, 0.08, 0.9, 1.35, 0.95, -0.6, 0.02);
  b.torus(BRASS4, 0.13, 0.04, 1.1, 1.06, -0.75, { rx: Math.PI / 2 }, 12);
  b.sph(BRASS4_L, 0.14, 1.55, 1.13, -0.45, { sy: 0.85 });
  for (let i = 0; i < 4; i++) b.cyl(IRON4_L, 0.04, 0.12, 1.3 + i * 0.1, 1.03, -0.3 - (i % 2) * 0.12, 6);
  // tin lean-to over the table, with a lamp
  for (const x of [0.8, 1.95]) {
    b.beam(IRON4_D, [x, 0.25, -0.1], [x, 2.25, -0.1], 0.1);
    b.beam(IRON4_D, [x, 0.25, -1.15], [x, 2.45, -1.15], 0.1);
  }
  rb(b, E4.body, 1.6, 0.08, 1.4, 1.375, 2.31, -0.62, 0.02, { rx: 0.15 });
  cap(b, 1.5, 1.3, 1.375, 2.39, -0.62, 0.11, { rx: 0.15 });
  b.beam(IRON_W, [1.35, 2.2, -0.05], [1.35, 2.05, -0.05], 0.03);
  lantern(b, g, G_WARM, 1.35, 1.9, -0.05, 0.12);
  // warming brazier in the back right
  b.cyl(IRON4_D, 0.26, 0.5, 1.65, 0.25, -1.7, 10, 0.3);
  g.cyl(G_FIRE, 0.25, 0.04, 1.65, 0.72, -1.7, 10);
  lumps(b, [CHAR], 1.65, 0.7, -1.7, 0.18, 4, 2, 0.08);
  // derrick mast with guy struts
  rb(b, IRON4, 0.6, 0.3, 0.6, -1.5, 0.25, 0.75, 0.06);
  b.cyl(IRON4_D, 0.16, 2.8, -1.5, 0.25, 0.75, 10, 0.13);
  b.beam(IRON4_D, [-1.5, 2.3, 0.75], [-2.15, 0.25, 0.75], 0.07);
  b.beam(IRON4_D, [-1.5, 2.3, 0.75], [-1.5, 0.25, -0.05], 0.07);
  // ANIM: crane jib swinging over the heap, a magnet and a dangling gear on the line
  a.cyl(BRASS4, 0.2, 0.24, 0, -0.12, 0, 10);
  a.at(0, 0, 1.0, () => {
    a.beam(IRON4, [-0.1, 0.05, 0], [1.75, 0.2, 0], 0.15);
    a.beam(IRON4_D, [0, -0.45, 0], [1.2, 0.17, 0], 0.08);
    rb(a, IRON4_D, 0.42, 0.34, 0.36, -0.45, -0.1, 0, 0.05);
    a.beam(0x3b2d26, [1.65, 0.18, 0], [1.65, -1.05, 0], 0.03);
    a.cyl(BRASS4, 0.1, 0.08, 1.65, -1.12, 0, 8);
    a.cyl(IRON4_D, 0.22, 0.14, 1.65, -1.26, 0, 10);
    a.torus(BRASS4, 0.18, 0.06, 1.65, -1.5, 0, { ry: 0.6 }, 14);
  });
  return { at: [-1.5, 3.05, 0.75], motion: 'swing', axis: 'y', period: 2.4, amp: 0.6 };
};

/** boilerShop: brick shop with glowing windows and twin stacks; a steam hammer rivets the boiler on its cradle. */
const boilerShop: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E4.trim, 0.18));
  const hz = -1.15;
  // brick hall with base course, band and a snowy gable roof
  rb(b, E4.body, 4.2, 2.0, 1.9, 0, 0.25, hz, 0.1);
  rb(b, tint(E4.body, -0.25), 4.26, 0.3, 1.96, 0, 0.25, hz, 0.04);
  rb(b, tint(E4.body, -0.15), 4.26, 0.1, 1.96, 0, 1.6, hz, 0.03);
  b.gable(0, hz, 2.25, 4.2, 1.9, 0.8, ROOF4, ROOF4_D, E4.body, 0.18);
  for (const [x, h] of [[-1.35, 1.75], [-0.7, 1.55]] as const) {
    chimney(b, IRON4, BRASS4, x, 2.3, -1.65, 0.22, h);
    for (const y of [2.9, 3.4]) if (y < 2.3 + h - 0.2) b.cyl(BRASS4, 0.215, 0.08, x, y, -1.65, 10);
  }
  // arched door glowing from inside, two lit windows
  const fz = hz + 0.95;
  rb(b, CHAR, 1.3, 1.25, 0.06, 0.5, 0.25, fz + 0.02, 0.03);
  b.cyl(CHAR, 0.65, 0.06, 0.5, 1.5 - 0.03, fz + 0.02, 14, 0.65, { rx: Math.PI / 2 });
  arch(b, tint(E4.body, -0.3), 0.7, 0.07, 0.5, 1.5, fz + 0.05);
  g.box(E4.glow, 1.1, 0.95, 0.04, 0.5, 0.3, fz + 0.06);
  for (const x of [-1.55, -0.85]) b.window(g, E4.glow, IRON4_D, x, 1.0, fz + 0.02, 0.42, 0.6, 0);
  // the boiler on its cradle: brass bands, rivets, a steam dome and a glowing pressure dial
  const bz = 0.6;
  hcyl(b, IRON4, 0.55, 2.0, 0.1, 1.05, bz, 'x', 16);
  for (const x of [-0.9, 1.1]) b.sph(IRON4, 0.55, x, 1.05, bz, { sx: 0.35 });
  for (const x of [-0.55, 0.1, 0.75]) hcyl(b, BRASS4, 0.58, 0.1, x, 1.05, bz, 'x', 16);
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) b.sph(BRASS4_L, 0.04, -0.75 + i * 0.24, 1.56, bz + s * 0.2);
  b.dome(BRASS4, 0.22, -0.5, 1.52, bz);
  for (const x of [-0.5, 0.7]) rb(b, IRON4_D, 0.3, 0.45, 0.9, x, 0.25, bz, 0.04);
  b.torus(BRASS4_L, 0.13, 0.03, -0.3, 1.1, bz + 0.58, undefined, 12);
  g.cyl(G_WARM, 0.11, 0.04, -0.3, 1.1 - 0.02, bz + 0.56, 12, 0.11, { rx: Math.PI / 2 });
  // gantry with a brass rail and the hanging steam cylinder
  for (const x of [-1.25, 1.5]) b.beam(IRON4_D, [x, 0.25, bz], [x, 2.95, bz], 0.16);
  rb(b, BRASS4, 3.0, 0.2, 0.26, 0.125, 2.85, bz, 0.04);
  cap(b, 2.9, 0.3, 0.125, 3.05, bz, 0.08);
  b.cyl(BRASS4, 0.2, 0.55, 0.4, 2.3, bz, 12);
  b.cyl(IRON4_D, 0.22, 0.08, 0.4, 2.32, bz, 12);
  // rivet forge at the left
  rb(b, tint(E4.body, -0.15), 0.8, 0.75, 0.65, -1.7, 0.25, 0.2, 0.06);
  g.box(G_FIRE, 0.42, 0.28, 0.05, -1.7, 0.45, 0.53);
  cap(b, 0.7, 0.55, -1.7, 1.0, 0.2, 0.1);
  b.cyl(IRON4_D, 0.1, 0.9, -1.85, 1.0, 0.1, 8);
  // boiler plates leaning on the right
  for (let i = 0; i < 3; i++) rb(b, i % 2 ? IRON4_L : IRON4, 0.08, 0.9, 0.7, 2.1 - i * 0.1, 0.25, 0.3, 0.02, { rz: 0.15 });
  // ANIM: steam hammer head bobbing on its rod
  a.cyl(IRON4_L, 0.07, 0.6, 0, 0, 0, 8);
  a.cyl(BRASS4_L, 0.12, 0.08, 0, 0, 0, 10);
  rb(a, IRON4_D, 0.42, 0.3, 0.42, 0, -0.3, 0, 0.06);
  return { at: [0.4, 1.95, bz], motion: 'bob', axis: 'y', period: 1.2, amp: 0.2, bias: 0.2 };
};

/** engineWorks: foundry hall with tall glowing arched windows, a brass steam-dome chimney, an engine on its plinth and a huge flywheel. */
const engineWorks: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E4.trim, 0.18));
  const hz = -1.05;
  const fz = hz + 1.1;
  // brick hall with a steep snowy gable
  rb(b, E4.body, 4.4, 2.4, 2.2, 0, 0.25, hz, 0.1);
  rb(b, tint(E4.body, -0.25), 4.46, 0.3, 2.26, 0, 0.25, hz, 0.04);
  rb(b, tint(E4.body, -0.15), 4.46, 0.1, 2.26, 0, 2.2, hz, 0.03);
  b.gable(0, hz, 2.65, 4.4, 2.2, 1.05, ROOF4, ROOF4_D, E4.body, 0.18);
  // tall arched windows, glowing
  for (const x of [-1.3, -0.25, 0.75, 1.7]) {
    b.window(g, G_WARM, IRON4_D, x, 0.85, fz + 0.01, 0.6, 1.1, 0);
    arch(b, IRON4_D, 0.33, 0.05, x, 1.95, fz + 0.04);
    halfDisc(g, G_WARM, 0.3, x, 1.95, fz + 0.06);
  }
  // brass steam-dome chimney with whistle valves
  b.cyl(BRASS4, 0.32, 1.9, -1.45, 2.5, -1.65, 14, 0.3);
  for (const y of [3.0, 3.6]) b.cyl(IRON4_D, 0.33, 0.08, -1.45, y, -1.65, 14);
  b.dome(BRASS4_L, 0.3, -1.45, 4.4, -1.65, { sy: 0.6 });
  b.sph(SNOW, 0.22, -1.45, 4.53, -1.65, { sy: 0.4 });
  for (const [x, z] of [[-1.25, -1.5], [-1.62, -1.48]] as const) {
    b.cyl(BRASS4_L, 0.06, 0.3, x, 4.32, z, 8);
    b.cone(BRASS4, 0.08, 0.1, x, 4.62, z, 8);
  }
  // engine on its assembly plinth, with a glowing firebox breech
  rb(b, IRON4_D, 1.6, 0.4, 1.0, 0.9, 0.25, 0.7, 0.06);
  hcyl(b, BRASS4, 0.24, 0.8, 0.55, 0.92, 0.7, 'x', 12);
  for (const x of [0.2, 0.9]) hcyl(b, IRON4_D, 0.26, 0.06, x, 0.92, 0.7, 'x', 12);
  b.beam(IRON4_L, [0.95, 0.92, 0.7], [1.3, 0.92, 0.7], 0.06);
  hcyl(b, IRON4, 0.25, 0.08, 1.4, 0.95, 0.5, 'x', 12);
  b.cyl(IRON4_D, 0.07, 0.5, 0.35, 1.1, 0.7, 8);
  rb(b, IRON4_D, 0.45, 0.4, 0.3, 1.4, 0.65, 0.95, 0.05);
  g.sph(G_FIRE, 0.14, 1.4, 0.85, 1.1, { sz: 0.5 });
  // flywheel pedestal and axle
  rb(b, IRON4_D, 0.4, 1.25, 0.3, -1.3, 0.25, 0.22, 0.05);
  hcyl(b, IRON4_L, 0.09, 0.45, -1.3, 1.45, 0.45, 'z', 8);
  // ANIM: the big flywheel
  wheel(a, 'z', IRON4, BRASS4, 0, 0, 0, 0.98, 0.12, 8);
  a.torus(BRASS4_L, 0.82, 0.04, 0, 0, 0.05, undefined, 20);
  a.cyl(BRASS4_L, 0.15, 0.26, 0, -0.13, 0, 10, 0.15, { rx: Math.PI / 2 });
  return { at: [-1.3, 1.45, 0.62], motion: 'spin', axis: 'z', period: 1.5, amp: 0 };
};

/** pneumaticTubes: mahogany-and-brass terminal with arching brass tubes, a vacuum tank and a rocking pump beam. */
const pneumaticTubes: Recipe = ({ body: b, glow: g, anim: a }) => {
  plinth(b, tint(E4.trim, 0.18));
  rb(b, MAHOG, 3.6, 0.3, 3.0, 0, 0.25, -0.4, 0.08);
  // terminal console with brass bands, a sloped desk and three glowing gauges
  rb(b, MAHOG_D, 2.4, 1.3, 1.5, -0.35, 0.55, -0.55, 0.1);
  for (const y of [1.15, 1.78]) rb(b, BRASS4, 2.46, 0.08, 1.56, -0.35, y, -0.55, 0.03);
  cap(b, 2.36, 1.46, -0.35, 1.85, -0.55, 0.12);
  rb(b, MAHOG_D, 2.3, 0.85, 0.5, -0.35, 0.55, 0.42, 0.06);
  rb(b, MAHOG, 2.3, 0.1, 0.6, -0.35, 1.38, 0.38, 0.03, { rx: 0.5 });
  for (const x of [-1.1, -0.45, 0.2]) {
    g.cyl(G_WARM, 0.12, 0.03, x, 1.6 - 0.015, 0.22, 12, 0.12, { rx: Math.PI / 2 });
    b.torus(BRASS4_L, 0.14, 0.03, x, 1.6, 0.235, undefined, 14);
  }
  // vacuum tank with brass bands, a gauge and a snow cap
  b.cyl(IRON4, 0.42, 1.7, 1.45, 0.55, -1.0, 14);
  b.dome(IRON4, 0.42, 1.45, 2.25, -1.0);
  for (const y of [0.9, 1.9]) b.cyl(BRASS4, 0.44, 0.08, 1.45, y, -1.0, 14);
  b.sph(SNOW, 0.3, 1.45, 2.6, -1.0, { sy: 0.35 });
  g.cyl(G_WARM, 0.1, 0.03, 1.45, 1.4 - 0.015, -0.56, 12, 0.1, { rx: Math.PI / 2 });
  b.torus(BRASS4_L, 0.12, 0.03, 1.45, 1.4, -0.555, undefined, 12);
  // canister drop cage with a canister and a dispatch light
  rb(b, BRASS4, 0.7, 0.1, 0.55, 0.45, 0.55, 0.95, 0.03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.beam(BRASS4_L, [0.45 + sx * 0.3, 0.65, 0.95 + sz * 0.22], [0.45 + sx * 0.3, 1.5, 0.95 + sz * 0.22], 0.05);
  rb(b, BRASS4, 0.7, 0.08, 0.55, 0.45, 1.5, 0.95, 0.03);
  hcyl(b, BRASS4_L, 0.11, 0.38, 0.45, 0.8, 0.95, 'x', 10);
  for (const s of [-1, 1]) b.sph(IRON4_D, 0.11, 0.45 + s * 0.19, 0.8, 0.95, { sx: 0.5 });
  g.sph(G_FIRE, 0.09, 0.72, 1.67, 1.15);
  // brass tubes: cage riser arching back into the console, a console-to-tank arch, a loop and a tall riser
  b.cyl(BRASS4, 0.08, 0.85, 0.45, 1.5, 0.95, 10);
  arch(b, BRASS4, 0.6, 0.08, 0.45, 2.35, 0.35, Math.PI / 2);
  b.cyl(BRASS4, 0.08, 0.4, 0.45, 1.95, -0.25, 10);
  b.cyl(BRASS4, 0.08, 0.55, 0.5, 1.95, -1.0, 10);
  arch(b, BRASS4, 0.475, 0.08, 0.975, 2.5, -1.0);
  arch(b, BRASS4, 0.5, 0.08, -0.8, 1.95, -0.85);
  b.cyl(BRASS4, 0.1, 2.6, -1.2, 0.55, -1.6, 10);
  hcyl(b, BRASS4, 0.08, 0.35, -1.2, 1.4, -1.45, 'z', 8);
  b.torus(BRASS4_L, 0.12, 0.04, -1.2, 3.15, -1.6, { rx: Math.PI / 2 }, 12);
  b.dome(BRASS4_L, 0.14, -1.2, 3.15, -1.6);
  b.sph(SNOW, 0.12, -1.2, 3.28, -1.6, { sy: 0.5 });
  for (const [x, y, z] of [[0.45, 1.6, 0.95], [0.45, 2.0, -0.25], [0.5, 2.0, -1.0], [-1.2, 2.2, -1.6]] as const) b.torus(BRASS4_L, 0.1, 0.03, x, y, z, { rx: Math.PI / 2 }, 10);
  // pump post on the console with a brass pump cylinder
  b.beam(IRON4_D, [1.45, 0.55, -0.42], [1.45, 2.95, -0.42], 0.12);
  b.cyl(BRASS4, 0.1, 0.4, 0.78, 1.95, -0.42, 10);
  // ANIM: vacuum pump rocker beam
  hcyl(a, BRASS4_L, 0.08, 0.2, 0, 0, 0, 'z', 8);
  a.beam(IRON4_D, [-0.68, 0, 0], [0.68, 0, 0], 0.12);
  a.beam(BRASS4, [-0.62, 0, 0], [-0.62, -0.72, 0], 0.06);
  a.sph(BRASS4_L, 0.06, -0.62, 0, 0);
  rb(a, BRASS4_L, 0.24, 0.24, 0.24, 0.6, -0.12, 0, 0.06);
  return { at: [1.45, 3.0, -0.42], motion: 'swing', axis: 'z', period: 1.6, amp: 0.3 };
};

const RECIPES: Record<EraMachine2Id, Recipe> = {
  clayPit, tileKiln, masonYard, strongbox, charcoalClamp, forge, railMill, mintChute, scrapYard, boilerShop, engineWorks, pneumaticTubes,
};

// ---------------------------------------------------------------------------
// building models
// ---------------------------------------------------------------------------

interface Built {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  pivot: THREE.BufferGeometry;
  spec: AnimSpec;
  w: number;
  d: number;
}

const builtCache = new Map<EraMachine2Id, Built>();

function build(id: EraMachine2Id): Built {
  let built = builtCache.get(id);
  if (built) return built;
  const parts: Parts = { body: new Kit(), glow: new Kit(), anim: new Kit() };
  const spec = RECIPES[id](parts);
  const body = parts.body.geometry();
  const glow = parts.glow.geometry();
  const pivot = parts.anim.geometry();
  const box = new THREE.Box3().copy(body.boundingBox!);
  box.union(glow.boundingBox!);
  box.union(pivot.boundingBox!.clone().translate(new THREE.Vector3(...spec.at)));
  const size = box.getSize(new THREE.Vector3());
  built = { body, glow, pivot, spec, w: Math.ceil(size.x * 10 - 1e-6) / 10, d: Math.ceil(size.z * 10 - 1e-6) / 10 };
  builtCache.set(id, built);
  return built;
}

/** Idle crawl as a share of the working speed. */
const IDLE = 0.12;

/** The animation settings of a machine (for tests and the wiring code). */
export function eraMachine2Motion(id: EraMachine2Id): Readonly<AnimSpec> {
  return build(id).spec;
}

/** Build one of the 12 era 2–4 machines: body, glow and one 'pivot' mesh, sharing cached geometry per id. */
export function createEraMachine2Model(id: EraMachine2Id): MachineModel {
  const built = build(id);
  const spec = built.spec;
  const root = new THREE.Group();
  root.name = `machine:${id}:${ERA_MACHINES_2[id].era}`;
  const body = new THREE.Mesh(built.body, vcMat());
  body.name = 'body';
  body.castShadow = true;
  body.receiveShadow = true;
  const glow = new THREE.Mesh(built.glow, eraGlowMaterial());
  glow.name = 'glow';
  const pivot = new THREE.Mesh(built.pivot, vcMat());
  pivot.name = 'pivot';
  pivot.castShadow = true;
  pivot.position.set(...spec.at);
  root.add(body, glow, pivot);

  const bias = spec.bias ?? 0;
  let phase = 0;
  let drive = IDLE;
  const animate = (dt: number, working: boolean): void => {
    drive += ((working ? 1 : IDLE) - drive) * Math.min(1, dt * 3);
    phase += (dt / spec.period) * drive;
    phase -= Math.floor(phase);
    const s = Math.sin(phase * Math.PI * 2);
    switch (spec.motion) {
      case 'spin':
        pivot.rotation[spec.axis] = -phase * Math.PI * 2;
        break;
      case 'swing':
        pivot.rotation[spec.axis] = bias + s * spec.amp;
        break;
      case 'bob':
        pivot.position.y = spec.at[1] + bias + s * spec.amp;
        break;
    }
  };
  animate(0, false);
  return { root, w: built.w, d: built.d, animate };
}

// ---------------------------------------------------------------------------
// gallery catalog (?gallery=eraMachines2, or one era's row: ?gallery=newEra3)
// ---------------------------------------------------------------------------

/** Gallery hook: debug/Gallery.ts calls `userData.galleryAnimate(dt)` every frame, so the parts move. */
function forGallery(id: EraMachine2Id): THREE.Object3D {
  const m = createEraMachine2Model(id);
  m.root.userData.galleryAnimate = (dt: number): void => m.animate(dt, true);
  return m.root;
}

const catalog: Record<string, () => THREE.Object3D> = {};
for (const id of ERA_MACHINE_2_IDS) catalog[id] = () => forGallery(id);
for (const era of [2, 3, 4] as const) {
  catalog[`newEra${era}`] = () => {
    const sheet = new THREE.Group();
    sheet.name = `newEra${era}`;
    let x = 0;
    for (const id of ERA_MACHINE_2_IDS) {
      if (ERA_MACHINES_2[id].era !== era) continue;
      const o = forGallery(id);
      o.position.x = x;
      x += 6.0;
      sheet.add(o);
    }
    return sheet;
  };
}
export const eraMachine2Catalog: Record<string, () => THREE.Object3D> = catalog;
