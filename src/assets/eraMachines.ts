/**
 * 0.9.0 era machine models (eras/data.ts MACHINES[id].style) plus the region's export depot and import dock.
 * Procedural, merged (render/batch.ts) and cached per id, so every slot of one machine shares GPU buffers.
 *
 * CONTRACT (eras/Machine.ts and eras/EraWorld.ts use it):
 * - Local frame: origin at floor centre, +Z = front (the side facing the front yard: the machine's input hopper sits
 *   front-left (−X), its output pile front-right (+X), both supplied by eras/Machine.ts, not part of the model).
 * - The solid part is centred on the origin and never exceeds 5.2 × 5.2 m, even with the animated part at any angle.
 *   `w` × `d` is the measured footprint of the model at rest (rounded up to 0.1 m). Height up to ~6 m.
 * - A machine is ≤ 3 meshes: the merged body, the merged glow (lit windows / furnace mouths / neon; the shared
 *   registered `eraGlowMaterial()`, so night lighting works with no caller code) and ONE animated pivot mesh named
 *   'pivot' (crane boom, flywheel, pumpjack beam, plasma ring, robot arm, smoke puff). `animate(dt, working)` runs the
 *   pivot at full speed while working and at a slow idle crawl otherwise. No allocation per frame.
 * - Depot / dock are plain Groups of ≤ 2 meshes (body + glow sign), ~3 × 2.4 m, static.
 * - Eras read distinct: timber + stone (2), rust iron (3), brick + brass (4), grey steel + orange (5), enamel teal +
 *   copper (6), honey yellow + crimson pipes (7), retro beige + sea teal + mint glow (8), porcelain + jade + sea-foam
 *   glow (9), cream + pewter slate + sun-gold (10). Eras 6–10 follow the palette table of docs/art/guide.md (ARGON).
 */
import * as THREE from 'three';
import type { MachineId } from '../eras/data';
import { ERAS, MACHINES, MACHINE_IDS } from '../eras/data';
import { vcMat } from '../render/batch';
import { ERA5_7_MACHINE_IDS, createEra5to7MachineModel } from './eraMachines3';
import { SNOW, SNOW_SH, Kit, eraGlowMaterial, hcyl, lattice, pixelText, pixelTextWidth, rotor, seeded, wheel, type V3 } from './eraKit';

export interface MachineModel {
  root: THREE.Group;
  /** Footprint (metres) of the solid part, centred on the origin; ≤ slot cell − 2. */
  w: number;
  d: number;
  /** Advance animations (smoke, wheels, glow pulse); `working` = a cycle is running. */
  animate(dt: number, working: boolean): void;
}

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

const STONE = 0xa7a39b;
const STONE_L = 0xc4c0b6;
const STONE_D = 0x7d786f;
const TIMBER = 0x8a6a46;
const TIMBER_D = 0x6d5a48;
const PLANK = 0xb4906a;
const BRICK = 0xb5543c;
const BRICK_D = 0x8e4030;
const IRON = 0x3d3a3a;
const IRON_L = 0x5d6268;
const RUST = 0x7c4a33;
const COAL = 0x232226;
const BRASS = 0xb08a3e;
const BRASS_L = 0xd9b25a;
const STEEL = 0x7f8b99;
const STEEL_L = 0xb4bdc8;
const STEEL_D = 0x4b5562;
const CONCRETE = 0xb5b8bb;
const CONCRETE_D = 0x8d9195;
const ORANGE = 0xd0702a;
const COPPER = 0xc9773a;
// eras 6–10: Machine body / Accent / Trim / Glow of docs/art/guide.md (eras/data.ts colors)
const TEAL = 0x4c6b68;
const TEAL_L = 0x6f918c;
const TEAL_D = 0x2b3b39;
const BLACK = 0x36383a;
const YELLOW = 0xd99b26;
const CRIMSON = 0xc44536;
const SILVER = 0xc9c6bf;
const BEIGE = 0xe6dec8;
const SEA = 0x45858c;
const PEWTER = 0x4a5259;
const SAND = 0xe2d3a0;
const PORCELAIN = 0xdce3e6;
const JADE = 0x4ea885;
const SLATE_D = 0x3d5259;
const CREAM = 0xf5f0e6;
const SLATE = 0x526475;
const GOLD = 0xe8a848;
const SMOKE = 0xdfe3e8;

// glow tints (multiplied into the shared emissive material by vertex colour)
const G_WARM = 0xffd070;
const G_FIRE = 0xff8a30;
const G_MINT = 0x66e0a3;
const G_FOAM = 0x70f5d9;
const G_SUN = 0xffe082;

const colors = (n: number) => ERAS[n]!.colors;

// ---------------------------------------------------------------------------
// recipe framework
// ---------------------------------------------------------------------------

interface Parts {
  body: Kit;
  glow: Kit;
  pivot: Kit;
}

/** The animated part: built around the origin of `pivot`, placed at `at`. Speeds are cycles per second. */
interface PivotSpec {
  at: V3;
  axis: 'x' | 'y' | 'z';
  /** spin = turn continuously; swing = sine rotation (±amp rad); slide = sine translation (±amp m); rise = loop upwards (amp m) while shrinking. */
  mode: 'spin' | 'swing' | 'slide' | 'rise';
  speed: number;
  amp?: number;
  /** Paint the pivot with the shared glow material instead of the toon vertex-colour one. */
  glow?: boolean;
}

type Recipe = (p: Parts) => PivotSpec | null;

interface Built {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  pivot: THREE.BufferGeometry | null;
  spec: PivotSpec | null;
  w: number;
  d: number;
}

/** Low slab the machine stands on, with a few snow drifts at the corners. */
function pad(k: Kit, w: number, d: number, color: number): void {
  k.box(color, w, 0.1, d, 0, 0, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) k.sph(SNOW, 0.34, sx * (w / 2 - 0.34), 0.06, sz * (d / 2 - 0.34), { sy: 0.42 });
}

/** Snow-capped flat roof slab. */
function flatRoof(k: Kit, color: number, w: number, d: number, x: number, y: number, z: number): void {
  k.box(color, w + 0.2, 0.16, d + 0.2, x, y, z);
  k.snow(x, y + 0.16, z, w + 0.1, d + 0.1);
}

/** Chimney / stack: tapering cylinder with a rim and a snow cap. */
function stack(k: Kit, color: number, rim: number, x: number, y: number, z: number, r: number, h: number): void {
  k.cyl(color, r, h, x, y, z, 10, r * 0.82);
  k.cyl(rim, r * 0.95, 0.14, x, y + h - 0.12, z, 10);
  k.cyl(SNOW, r * 0.8, 0.08, x, y + h + 0.02, z, 10);
}

/** Alternating hazard stripes (yellow / dark) as short slabs along X on a wall facing +Z. */
function hazard(k: Kit, x: number, y: number, z: number, w: number, h: number, yellow = YELLOW, dark = BLACK): void {
  const n = Math.max(2, Math.round(w / 0.3));
  for (let i = 0; i < n; i++) k.box(i % 2 ? dark : yellow, w / n, h, 0.05, x - w / 2 + (i + 0.5) * (w / n), y, z);
}

/** Rail line along Z with ties. */
function rails(k: Kit, color: number, x: number, z0: number, z1: number, gauge = 0.5): void {
  for (const s of [-1, 1]) k.box(color, 0.08, 0.1, z1 - z0, x + s * gauge / 2, 0.1, (z0 + z1) / 2);
  for (let z = z0 + 0.15; z < z1; z += 0.4) k.box(TIMBER_D, gauge + 0.3, 0.05, 0.12, x, 0.1, z);
}

/** Lump pile: n squashed spheres of `color`. */
function lumps(k: Kit, color: number, cx: number, cz: number, rad: number, n: number, seed: number, r = 0.17): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * rad;
    k.sph(color, r * (0.7 + rnd() * 0.6), cx + Math.cos(a) * d, 0.1 + r * 0.5 + (1 - d / rad) * 0.18, cz + Math.sin(a) * d, { sy: 0.8 });
  }
}

// ---------------------------------------------------------------------------
// era 2 — Frontier: timber, stone, brick
// ---------------------------------------------------------------------------

/** quarry: crane over a stepped pit. */
const quarry: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0x9c968a);
  // stepped terraces round the pit (back, left, right)
  b.box(STONE, 4.5, 1.3, 0.9, 0, 0.1, -1.95);
  b.snow(0, 1.4, -1.95, 4.3, 0.7);
  b.box(STONE_D, 3.6, 0.8, 0.7, 0, 0.1, -1.2);
  b.snow(0, 0.9, -1.2, 3.4, 0.5);
  b.box(STONE, 0.9, 0.9, 3.2, -1.95, 0.1, 0.0);
  b.snow(-1.95, 1.0, 0.0, 0.7, 3.0);
  b.box(STONE_D, 0.6, 0.5, 2.4, -1.3, 0.1, 0.3);
  b.box(STONE, 0.8, 0.65, 3.0, 1.95, 0.1, 0.0);
  b.snow(1.95, 0.75, 0.0, 0.6, 2.8);
  b.box(0x4a463f, 2.4, 0.04, 2.3, 0.1, 0.1, 0.5);
  // cut blocks waiting in the pit
  b.box(STONE_L, 0.55, 0.38, 0.45, -0.5, 0.14, 1.1);
  b.box(STONE_L, 0.5, 0.35, 0.4, -0.45, 0.52, 1.12, { ry: 0.3 });
  b.box(STONE_L, 0.5, 0.35, 0.4, 0.7, 0.14, 0.4, { ry: -0.2 });
  // timber mast + winch
  b.beam(TIMBER, [0.3, 0.1, -0.3], [0.3, 2.9, -0.3], 0.26);
  b.beam(TIMBER_D, [-0.25, 0.1, -0.9], [0.3, 2.5, -0.3], 0.14);
  b.beam(TIMBER_D, [0.85, 0.1, -0.9], [0.3, 2.5, -0.3], 0.14);
  b.box(TIMBER_D, 0.8, 0.6, 0.8, 0.3, 0.1, -0.9);
  b.snow(0.3, 0.7, -0.9, 0.8, 0.8, 0.08);
  b.cyl(IRON_L, 0.3, 0.12, 0.3, 2.85, -0.3, 8);
  g.box(G_WARM, 0.3, 0.2, 0.05, 0.3, 0.3, -0.48);
  // boom with a hanging stone block (swings over the pit)
  p.beam(TIMBER, [0, 0, 0], [-1.9, 0.5, 0], 0.18);
  p.beam(TIMBER_D, [0, 0, 0], [1.0, 0.15, 0], 0.14);
  p.box(STONE_D, 0.5, 0.45, 0.45, 1.0, -0.3, 0);
  p.beam(IRON_L, [-1.7, 0.45, 0], [-1.7, -1.4, 0], 0.04);
  p.box(STONE_L, 0.55, 0.38, 0.45, -1.7, -1.78, 0);
  return { at: [0.3, 2.95, -0.3], axis: 'y', mode: 'swing', speed: 0.25, amp: 0.95 };
};

/** kiln: domed beehive kiln with chimney. */
const kiln: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 4.6, 4.4, 0xa39c90);
  b.cyl(STONE, 1.85, 0.55, 0, 0.1, -0.2, 14);
  b.cyl(SNOW_SH, 1.88, 0.08, 0, 0.6, -0.2, 14);
  b.dome(BRICK, 1.65, 0, 0.65, -0.2, { sy: 1.0 });
  b.cyl(BRICK_D, 1.66, 0.1, 0, 0.95, -0.2, 14);
  b.cyl(BRICK_D, 1.4, 0.1, 0, 1.55, -0.2, 14);
  b.sph(SNOW, 1.1, 0, 2.0, -0.2, { sy: 0.32 });
  stack(b, STONE, STONE_D, 0, 2.2, -0.2, 0.34, 1.2);
  // arched mouth
  b.box(STONE_D, 1.2, 1.1, 0.35, 0, 0.1, 1.2);
  b.cyl(STONE_D, 0.6, 0.35, 0, 1.2, 1.2, 10, 0.6, { rx: Math.PI / 2 });
  g.box(G_FIRE, 0.7, 0.75, 0.08, 0, 0.2, 1.4);
  g.cyl(G_FIRE, 0.35, 0.08, 0, 0.95, 1.4, 10, 0.35, { rx: Math.PI / 2 });
  // woodpile and bricks
  for (const [x, y] of [[1.6, 0.22], [1.95, 0.22], [2.3, 0.22], [1.78, 0.5], [2.13, 0.5], [1.95, 0.78]] as const) hcyl(b, TIMBER, 0.15, 1.3, x, y + 0.1, 0.9, 'z', 8);
  b.snow(1.95, 0.95, 0.9, 1.0, 1.3, 0.08);
  for (let i = 0; i < 3; i++) b.box(BRICK, 0.5, 0.22, 0.28, -1.95, 0.1 + i * 0.22, 1.0 - i * 0.05, { ry: 0.1 * i });
  b.box(BRICK_D, 0.5, 0.22, 0.28, -1.95, 0.1 + 3 * 0.22, 0.95);
  // smoke puff above the chimney
  p.sph(SMOKE, 0.32, 0, 0, 0);
  p.sph(SMOKE, 0.22, 0.18, 0.4, 0.05);
  return { at: [0, 3.55, -0.2], axis: 'y', mode: 'rise', speed: 0.3, amp: 1.5 };
};

// ---------------------------------------------------------------------------
// era 3 — Iron Age: rust, dark iron, timber headframes
// ---------------------------------------------------------------------------

/** ironMine: wooden headframe + mine cart. */
const ironMine: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0x8f857d);
  // headframe: two A-frames in YZ planes
  for (const x of [-0.75, 0.75]) {
    b.beam(TIMBER, [x, 0.1, 1.7], [x, 4.2, 0.0], 0.24);
    b.beam(TIMBER, [x, 0.1, -1.7], [x, 4.2, 0.0], 0.24);
    for (const h of [1.1, 2.4]) {
      const f = 1 - (h - 0.1) / 4.1;
      b.beam(TIMBER_D, [x, h, 1.7 * f], [x, h, -1.7 * f], 0.14);
    }
  }
  for (const h of [1.1, 2.4]) {
    const f = 1 - (h - 0.1) / 4.1;
    for (const s of [-1, 1]) b.beam(TIMBER_D, [-0.75, h, s * 1.7 * f], [0.75, h, s * 1.7 * f], 0.14);
  }
  b.beam(IRON, [-0.95, 4.25, 0], [0.95, 4.25, 0], 0.16);
  b.box(TIMBER_D, 1.9, 0.14, 0.5, 0, 4.0, 0.0);
  b.snow(0, 4.14, 0, 1.8, 0.4, 0.08);
  // shaft collar with cage
  b.box(0x1d1b1b, 1.3, 0.04, 1.3, 0, 0.1, 0.75);
  for (const [x, z, w, d] of [[-0.7, 0.75, 0.14, 1.5], [0.7, 0.75, 0.14, 1.5], [0, 0.05, 1.5, 0.14], [0, 1.45, 1.5, 0.14]] as const) b.box(TIMBER, w, 0.3, d, x, 0.1, z);
  b.box(IRON_L, 0.6, 0.5, 0.5, 0, 0.5, 0.75);
  b.beam(IRON, [0, 3.6, 0.75], [0, 1.0, 0.75], 0.05);
  // winding shed
  b.box(PLANK, 1.3, 1.4, 1.9, 1.85, 0.1, -0.85);
  b.gable(1.85, -0.85, 1.5, 1.3, 1.9, 0.55, IRON_L, IRON, PLANK);
  b.window(g, G_WARM, TIMBER_D, 1.85, 0.7, 0.12, 0.45, 0.4, 0);
  b.beam(IRON_L, [0, 3.6, -0.0], [1.4, 1.1, -0.9], 0.04);
  // rails, cart, ore
  rails(b, IRON_L, -1.9, -1.6, 1.8);
  b.box(RUST, 0.8, 0.4, 1.0, -1.9, 0.3, 0.5);
  b.box(IRON, 0.9, 0.08, 1.1, -1.9, 0.62, 0.5);
  lumps(b, 0x5a463a, -1.9, 0.5, 0.25, 4, 3, 0.16);
  lumps(b, 0x6a5040, -1.8, -1.2, 0.7, 7, 5, 0.2);
  b.snow(-1.8, 0.5, -1.2, 0.8, 0.8, 0.06);
  // sheave wheel on top
  wheel(p, 'x', IRON_L, IRON, 0, 0, 0, 0.72, 0.1, 6);
  return { at: [0, 4.35, 0], axis: 'x', mode: 'spin', speed: 0.45 };
};

/** smelter: blast furnace tower with a glowing mouth. */
const smelter: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 4.8, 4.8, 0x8e847c);
  const tx = -0.5;
  const tz = -0.7;
  b.cyl(0x6e6862, 1.2, 3.1, tx, 0.1, tz, 12, 0.88);
  for (const [y, r] of [[0.8, 1.14], [1.8, 1.03], [2.7, 0.93]] as const) b.cyl(IRON, r + 0.05, 0.14, tx, y, tz, 12);
  b.cyl(IRON_L, 0.86, 0.6, tx, 3.2, tz, 12, 0.55);
  b.cyl(IRON, 0.52, 0.5, tx, 3.8, tz, 10, 0.4);
  b.cone(IRON, 0.5, 0.35, tx, 4.3, tz, 10);
  // tuyere arch + glowing mouth
  b.box(IRON, 1.0, 0.95, 0.35, tx, 0.1, tz + 1.0);
  g.box(G_FIRE, 0.62, 0.55, 0.08, tx, 0.22, tz + 1.2);
  g.box(G_WARM, 0.5, 0.3, 0.06, tx, 0.3, tz + 1.24);
  // hot-blast stove + pipe
  b.cyl(BRICK_D, 0.55, 2.8, 1.25, 0.1, -1.1, 10, 0.5);
  b.dome(BRICK, 0.5, 1.25, 2.9, -1.1);
  b.snow(1.25, 3.3, -1.1, 0.5, 0.5, 0.08);
  b.beam(IRON_L, [0.8, 2.4, -1.0], [tx + 0.7, 2.1, tz - 0.2], 0.2);
  // ingot casting bed under a snow-roofed canopy
  b.box(IRON, 1.9, 0.32, 1.3, 1.2, 0.1, 1.0);
  for (let i = 0; i < 4; i++) g.box(G_FIRE, 0.38, 0.1, 0.28, 0.65 + i * 0.42, 0.45, 1.0);
  for (const [x, z] of [[0.3, 0.4], [2.1, 0.4], [0.3, 1.6], [2.1, 1.6]] as const) b.beam(TIMBER, [x, 0.1, z], [x, 1.6, z], 0.12);
  b.box(TIMBER_D, 2.2, 0.12, 1.6, 1.2, 1.55, 1.0);
  b.snow(1.2, 1.67, 1.0, 2.1, 1.5);
  // embers / smoke rising from the throat
  p.sph(SMOKE, 0.28, 0, 0, 0);
  p.sph(0xb9bdc4, 0.2, -0.15, 0.35, 0.1);
  return { at: [tx, 4.85, tz], axis: 'y', mode: 'rise', speed: 0.35, amp: 0.9 };
};

// ---------------------------------------------------------------------------
// era 4 — Steam Age: brick, brass, black iron
// ---------------------------------------------------------------------------

/** coalPit: steam shovel over a black pit. */
const coalPit: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0x7e7a76);
  b.box(COAL, 3.3, 0.05, 2.7, -0.55, 0.1, 0.4);
  for (const [x, z, w, d] of [[-0.55, -1.0, 3.5, 0.25], [-2.25, 0.4, 0.25, 2.9], [-0.55, 1.8, 3.5, 0.25]] as const) {
    b.box(IRON_L, w, 0.35, d, x, 0.1, z);
    b.snow(x, 0.45, z, w, d, 0.06);
  }
  lumps(b, COAL, -0.9, 0.5, 1.2, 12, 11, 0.22);
  lumps(b, 0x3a393d, 0.0, 1.2, 0.5, 4, 13, 0.18);
  // shovel base: tracks, cab, boiler
  b.box(IRON, 1.9, 0.3, 1.1, 1.3, 0.1, -1.2);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.cyl(IRON_L, 0.13, 0.16, 0.7 + i * 0.6, 0.1, -1.2 + s * 0.55, 8, 0.13, { rx: Math.PI / 2 });
  b.box(IRON_L, 1.1, 0.95, 0.95, 1.45, 0.4, -1.2);
  b.box(BRASS, 1.2, 0.12, 1.05, 1.45, 1.35, -1.2);
  b.snow(1.45, 1.47, -1.2, 1.1, 0.95);
  g.box(G_WARM, 0.4, 0.35, 0.05, 1.45, 0.7, -1.05);
  hcyl(b, BRASS_L, 0.3, 0.9, 1.85, 0.85, -1.2, 'x', 10);
  stack(b, IRON, BRASS, 2.05, 1.1, -1.2, 0.15, 0.95);
  // boom + dipper + bucket (swings over the pit)
  p.cyl(IRON, 0.28, 0.25, 0, -0.12, 0, 10);
  p.beam(IRON_L, [0, 0, 0], [-1.7, 1.0, 0], 0.17);
  p.beam(BRASS, [-1.7, 1.0, 0], [-2.0, -0.35, 0], 0.13);
  p.box(BRASS_L, 0.55, 0.32, 0.45, -2.0, -0.7, 0);
  p.box(IRON, 0.55, 0.08, 0.45, -2.0, -0.4, 0);
  return { at: [1.1, 1.45, -1.2], axis: 'y', mode: 'swing', speed: 0.22, amp: 0.6 };
};

/** steamWorks: brick hall, big flywheel, steam stacks. */
const steamWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.6, 0x86817c);
  b.box(BRICK, 3.6, 2.2, 2.4, -0.3, 0.1, -0.4);
  b.box(BRICK_D, 3.7, 0.15, 2.5, -0.3, 0.1, -0.4);
  for (let i = 0; i < 4; i++) b.box(BRICK_D, 3.65, 0.06, 2.45, -0.3, 0.75 + i * 0.5, -0.4);
  b.gable(-0.3, -0.4, 2.3, 3.6, 2.4, 0.95, 0x4a4a52, 0x3c3c44, BRICK);
  for (const x of [-1.2, -0.3, 0.6]) {
    b.box(BRASS, 0.7, 1.35, 0.06, x, 0.65, 0.82);
    g.box(G_WARM, 0.5, 1.0, 0.06, x, 0.8, 0.85);
    g.cyl(G_WARM, 0.25, 0.06, x, 1.8, 0.85, 8, 0.25, { rx: Math.PI / 2 });
  }
  b.box(BRASS, 0.8, 0.7, 0.2, -0.3, 2.1, 0.8);
  stack(b, BRICK_D, BRASS, -1.35, 0.1, -1.95, 0.3, 3.5);
  stack(b, BRICK_D, BRASS, -0.55, 0.1, -1.95, 0.27, 3.1);
  b.cyl(BRASS, 0.34, 0.1, -1.35, 1.2, -1.95, 10);
  b.cyl(BRASS, 0.31, 0.1, -1.35, 2.2, -1.95, 10);
  // flywheel on the right wall, steam pipe from the hall
  hcyl(b, IRON_L, 0.12, 0.9, 1.85, 1.4, -0.2, 'x', 8);
  b.beam(BRASS, [1.5, 1.9, -0.9], [2.0, 2.7, -0.9], 0.12);
  b.cyl(BRASS_L, 0.18, 0.5, 2.0, 2.4, -0.9, 8);
  b.box(IRON_L, 0.4, 0.8, 0.5, 1.55, 0.1, -0.2);
  wheel(p, 'x', BRASS, IRON, 0, 0, 0, 1.15, 0.13, 8);
  p.box(IRON, 0.1, 0.5, 0.4, 0, 0.7, 0);
  p.box(IRON, 0.1, 0.5, 0.4, 0, -1.2, 0);
  return { at: [2.1, 1.4, -0.2], axis: 'x', mode: 'spin', speed: 0.5 };
};

// ---------------------------------------------------------------------------
// era 5 — Industrial: grey steel, orange, concrete
// ---------------------------------------------------------------------------

/** deepMine: steel lattice headframe + engine house. */
const deepMine: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0x8a8d90);
  lattice(b, STEEL_D, -0.4, 0.0, 0.1, 4.5, 2.3, 1.0, 4, 0.13);
  b.box(ORANGE, 1.5, 0.2, 1.2, -0.4, 4.6, 0.0);
  b.snow(-0.4, 4.8, 0.0, 1.4, 1.1, 0.08);
  for (const z of [-0.45, 0.45]) b.box(STEEL_D, 0.12, 0.5, 0.1, -0.4 + 0.0, 4.8, z);
  b.box(0x1c1d20, 1.3, 0.04, 1.3, -0.4, 0.1, 0.0);
  b.box(ORANGE, 0.7, 0.7, 0.7, -0.4, 0.4, 0.0);
  b.beam(STEEL_L, [-0.4, 4.2, 0.35], [-0.4, 1.1, 0.35], 0.05);
  // engine house
  b.box(CONCRETE, 1.9, 1.9, 1.7, 1.5, 0.1, -1.15);
  flatRoof(b, CONCRETE_D, 1.9, 1.7, 1.5, 2.0, -1.15);
  b.window(g, G_FIRE, CONCRETE_D, 1.15, 1.0, -0.28, 0.45, 0.5, 0);
  b.window(g, G_FIRE, CONCRETE_D, 1.85, 1.0, -0.28, 0.45, 0.5, 0);
  b.box(ORANGE, 1.95, 0.12, 0.05, 1.5, 0.7, -0.29);
  stack(b, STEEL, ORANGE, 2.1, 2.2, -1.5, 0.2, 1.3);
  b.beam(STEEL_L, [-0.4, 5.1, -0.55], [1.0, 2.1, -1.0], 0.05);
  // ore bin and skip cars
  b.box(STEEL_D, 1.0, 0.8, 1.0, -1.9, 0.1, -1.4);
  b.box(RUST, 1.1, 0.1, 1.1, -1.9, 0.9, -1.4);
  b.snow(-1.9, 1.0, -1.4, 1.0, 1.0, 0.08);
  lumps(b, 0x6a4a3c, -1.9, 1.2, 0.5, 5, 21, 0.2);
  // twin sheave wheels
  wheel(p, 'x', ORANGE, STEEL_D, -0.5, 0, -0.45, 0.62, 0.09, 6);
  wheel(p, 'x', ORANGE, STEEL_D, 0.5, 0, 0.45, 0.62, 0.09, 6);
  p.beam(STEEL_D, [-0.7, 0, -0.45], [0.7, 0, 0.45], 0.1);
  return { at: [-0.4, 5.15, 0], axis: 'x', mode: 'spin', speed: 0.55 };
};

/** cokeOven: row of brick ovens + quench tower. */
const cokeOven: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0x8a8d90);
  b.box(BRICK_D, 4.3, 1.5, 1.9, -0.1, 0.1, -0.1);
  b.box(STEEL_D, 4.4, 0.18, 2.0, -0.1, 1.6, -0.1);
  b.snow(-0.1, 1.78, -0.1, 4.2, 1.9, 0.1);
  for (let i = 0; i < 5; i++) {
    const x = -1.8 + i * 0.9;
    b.box(STEEL_D, 0.72, 1.1, 0.12, x, 0.2, 0.87);
    b.cyl(STEEL_D, 0.36, 0.12, x, 1.3, 0.87, 10, 0.36, { rx: Math.PI / 2 });
    g.box(G_FIRE, 0.42, 0.55, 0.06, x, 0.35, 0.95);
    g.cyl(G_FIRE, 0.21, 0.06, x, 0.9, 0.95, 8, 0.21, { rx: Math.PI / 2 });
    b.cyl(IRON, 0.13, 0.12, x, 1.72, -0.1, 8);
    b.box(ORANGE, 0.1, 1.5, 0.04, x + 0.45, 0.1, 0.88);
  }
  b.box(ORANGE, 4.35, 0.1, 0.06, -0.1, 1.5, 0.9);
  // rails on the roof for the larry car
  for (const s of [-1, 1]) b.box(IRON, 4.2, 0.08, 0.07, -0.1, 1.9, -0.1 + s * 0.3);
  // quench tower
  b.box(CONCRETE, 1.0, 4.0, 1.0, 1.85, 0.1, -1.85);
  for (let i = 0; i < 6; i++) b.box(CONCRETE_D, 1.12, 0.12, 1.12, 1.85, 0.5 + i * 0.6, -1.85, { rz: 0.0 });
  b.box(STEEL_D, 1.2, 0.14, 1.2, 1.85, 4.1, -1.85);
  b.snow(1.85, 4.24, -1.85, 1.1, 1.1);
  b.beam(STEEL, [1.35, 3.7, -1.3], [0.9, 1.9, -0.7], 0.14);
  stack(b, STEEL, ORANGE, -1.9, 0.1, -1.9, 0.25, 2.6);
  // larry car
  p.box(ORANGE, 1.0, 0.45, 0.8, 0, 0.0, 0);
  p.box(STEEL_D, 0.9, 0.3, 0.7, 0, 0.45, 0, { rz: 0 });
  p.cyl(STEEL, 0.17, 0.18, -0.3, 0.75, 0, 8, 0.1);
  p.cyl(STEEL, 0.17, 0.18, 0.3, 0.75, 0, 8, 0.1);
  for (const x of [-0.35, 0.35]) for (const z of [-0.3, 0.3]) p.cyl(IRON, 0.12, 0.1, x, -0.05, z, 8, 0.12, { rx: Math.PI / 2 });
  return { at: [0, 2.0, -0.1], axis: 'x', mode: 'slide', speed: 0.14, amp: 1.5 };
};

/** steelMill: converter vessel pouring sparks, tall stack. */
const steelMill: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0x888b90);
  // back hall
  b.box(STEEL, 4.2, 2.3, 0.9, 0, 0.1, -2.0);
  flatRoof(b, STEEL_D, 4.2, 0.9, 0, 2.4, -2.0);
  for (const x of [-1.3, 0, 1.3]) {
    b.box(STEEL_D, 0.9, 1.3, 0.06, x, 0.1, -1.53);
    g.box(G_FIRE, 0.7, 1.1, 0.05, x, 0.2, -1.5);
  }
  // gantry frame
  for (const x of [-1.4, 1.4]) for (const z of [-0.8, 0.8]) b.beam(ORANGE, [x, 0.1, z], [x, 3.5, z], 0.2);
  for (const z of [-0.8, 0.8]) b.beam(STEEL_D, [-1.4, 3.4, z], [1.4, 3.4, z], 0.2);
  for (const x of [-1.4, 1.4]) b.beam(STEEL_D, [x, 3.4, -0.8], [x, 3.4, 0.8], 0.2);
  b.beam(STEEL_L, [-1.4, 2.5, 0], [-0.6, 2.5, 0], 0.16);
  b.beam(STEEL_L, [0.6, 2.5, 0], [1.4, 2.5, 0], 0.16);
  for (const z of [-0.8, 0.8]) b.snow(0, 3.6, z, 2.8, 0.2, 0.08);
  // ladle on a car and the pour
  b.box(IRON, 1.2, 0.25, 0.9, 0, 0.1, 0.9);
  b.cyl(STEEL_D, 0.45, 0.6, 0, 0.35, 0.9, 10, 0.55);
  g.cyl(G_FIRE, 0.45, 0.06, 0, 0.93, 0.9, 10);
  g.box(G_FIRE, 0.12, 0.9, 0.12, 0, 1.0, 0.55);
  // tall stack
  stack(b, STEEL_L, ORANGE, -1.9, 0.1, -0.9, 0.38, 4.6);
  b.cyl(ORANGE, 0.42, 0.4, -1.9, 1.6, -0.9, 10, 0.42);
  b.cyl(ORANGE, 0.34, 0.4, -1.9, 3.4, -0.9, 10, 0.36);
  // converter vessel (tilts on its trunnion)
  p.cyl(STEEL_D, 0.62, 1.1, 0, -0.9, 0, 12);
  p.cyl(STEEL, 0.62, 0.55, 0, 0.2, 0, 12, 0.34);
  p.cyl(0xffa844, 0.34, 0.1, 0, 0.75, 0, 12, 0.3);
  p.box(ORANGE, 1.7, 0.12, 0.12, 0, -0.1, 0);
  p.beam(STEEL_L, [-1.4, 0, 0], [1.4, 0, 0], 0.18);
  return { at: [0, 2.5, 0], axis: 'x', mode: 'swing', speed: 0.2, amp: 0.55 };
};

// ---------------------------------------------------------------------------
// era 6 — Electric: enamel teal, copper windings, pylons
// ---------------------------------------------------------------------------

/** copperMine: electric hoist tower with pylons. */
const copperMine: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0x9ea39c);
  b.box(TEAL, 1.7, 3.4, 1.7, -0.7, 0.1, -0.7);
  for (const y of [0.9, 1.9, 2.7]) b.box(TEAL_L, 1.8, 0.1, 1.8, -0.7, y, -0.7);
  flatRoof(b, TEAL_D, 1.7, 1.7, -0.7, 3.5, -0.7);
  for (const [x, y] of [[-1.1, 1.3], [-0.3, 1.3], [-1.1, 2.2], [-0.3, 2.2]] as const) b.window(g, G_WARM, TEAL_L, x, y, 0.17, 0.4, 0.45, 0);
  b.box(COPPER, 0.5, 0.9, 0.06, -0.7, 0.1, 0.17);
  // hoist frame + wheel on top
  for (const x of [-1.2, -0.2]) b.beam(STEEL_D, [x, 3.8, -0.7], [x + (x < -0.7 ? 0.3 : -0.3), 4.5, -0.7], 0.12);
  b.beam(COPPER, [-1.3, 3.75, -0.7], [-0.1, 3.75, -0.7], 0.14);
  wheel(p, 'x', COPPER, TEAL, 0, 0, 0, 0.62, 0.09, 6);
  // pylons with insulators and wires
  for (const z of [-1.5, 1.5]) {
    lattice(b, STEEL, 1.95, z, 0.1, 3.6, 0.9, 0.35, 3, 0.07);
    b.beam(STEEL_D, [1.95 - 0.8, 3.0, z], [1.95 + 0.6, 3.0, z], 0.1);
    for (const x of [1.95 - 0.7, 1.95 + 0.5]) b.cyl(0xd7dfe0, 0.07, 0.32, x, 2.7, z, 6);
    b.cyl(0xd7dfe0, 0.07, 0.3, 1.95, 3.55, z, 6);
  }
  for (const x of [1.25, 2.45]) b.beam(0x1c1d20, [x, 2.7, -1.5], [x, 2.55, 1.5], 0.03);
  b.beam(0x1c1d20, [1.95, 3.55, -1.5], [1.95, 3.5, 1.5], 0.03);
  b.beam(COPPER, [-0.1, 3.4, -0.7], [1.3, 2.75, -1.5], 0.04);
  // ore cart, copper nuggets
  rails(b, STEEL_D, -1.7, -0.2, 2.0);
  b.box(TEAL_L, 0.8, 0.4, 1.0, -1.7, 0.3, 1.1);
  lumps(b, COPPER, -1.7, 1.1, 0.25, 4, 31, 0.18);
  lumps(b, 0x8f4f25, 0.0, 1.6, 0.7, 6, 33, 0.19);
  b.snow(0.0, 0.45, 1.6, 0.6, 0.6, 0.05);
  return { at: [-0.7, 4.65, -0.7], axis: 'x', mode: 'spin', speed: 0.6 };
};

/** wireMill: long shed with sawtooth skylights and spinning spools. */
const wireMill: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.6, 0x9ea39c);
  b.box(TEAL, 4.5, 1.6, 2.3, -0.1, 0.1, -0.9);
  for (let i = 0; i < 8; i++) b.box(TEAL_L, 0.1, 1.5, 2.34, -2.2 + i * 0.6, 0.1, -0.9);
  b.box(0x25394a, 4.6, 0.12, 2.4, -0.1, 1.7, -0.9);
  // sawtooth roof (vertical glazed faces look -X)
  for (let i = 0; i < 3; i++) {
    const x0 = -2.3 + i * 1.5;
    b.prismXY(0x3b5f70, [[0, 0], [1.5, 0], [0, 0.85]], 2.3, x0, 1.82, -2.05);
    b.box(SNOW, 1.72, 0.08, 2.3, x0 + 0.75, 2.16, -0.9, { rz: Math.atan2(0.85, 1.5) });
    g.box(0xcdeaff, 0.05, 0.65, 2.0, x0 + 0.02, 1.9, -0.9);
  }
  b.window(g, G_WARM, TEAL_L, -1.4, 0.7, 0.28, 0.5, 0.45, 0);
  b.window(g, G_WARM, TEAL_L, 0.5, 0.7, 0.28, 0.5, 0.45, 0);
  b.box(COPPER, 0.9, 1.1, 0.07, -0.45, 0.1, 0.27);
  // wire spools
  hcyl(b, COPPER, 0.4, 0.5, -1.7, 0.5, 1.0, 'z', 12);
  hcyl(b, COPPER, 0.4, 0.5, -1.0, 0.5, 1.2, 'z', 12);
  hcyl(b, TEAL, 0.5, 0.1, -1.7, 0.5, 0.73, 'z', 12);
  hcyl(b, TEAL, 0.5, 0.1, -1.7, 0.5, 1.27, 'z', 12);
  b.box(TIMBER_D, 1.5, 0.1, 1.0, -1.35, 0.1, 1.1);
  // pole + transformer
  b.beam(TIMBER, [-2.2, 0.1, 1.7], [-2.2, 3.0, 1.7], 0.14);
  b.beam(TIMBER_D, [-2.55, 2.8, 1.7], [-1.85, 2.8, 1.7], 0.1);
  b.cyl(STEEL, 0.2, 0.5, -2.2, 2.0, 1.7, 8);
  b.beam(0x1c1d20, [-2.2, 2.8, 1.7], [-1.1, 1.65, -0.3], 0.03);
  // the big reel on a stand (turns when working)
  b.box(STEEL_D, 0.14, 0.9, 0.14, 1.7, 0.1, 1.4);
  b.box(STEEL_D, 0.14, 0.9, 0.14, 1.7, 0.1, 0.6);
  hcyl(p, TEAL_L, 0.82, 0.08, 0, 0, 0.3, 'z', 14);
  hcyl(p, TEAL_L, 0.82, 0.08, 0, 0, -0.3, 'z', 14);
  hcyl(p, COPPER, 0.5, 0.55, 0, 0, 0, 'z', 14);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    p.beam(IRON, [-Math.cos(a) * 0.78, -Math.sin(a) * 0.78, 0.36], [Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0.36], 0.06);
  }
  return { at: [1.7, 1.0, 1.0], axis: 'z', mode: 'spin', speed: 0.5 };
};

// ---------------------------------------------------------------------------
// era 7 — Oil Age: honey yellow, crimson pipes, warm silver
// ---------------------------------------------------------------------------

/** oilPump: pumpjack with a walking beam. */
const oilPump: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 4.9, 4.8, 0x9a978f);
  b.box(CONCRETE, 2.1, 0.25, 4.0, 0, 0.1, 0);
  b.snow(0, 0.35, 0, 2.0, 3.9, 0.04);
  // samson post: two A legs
  for (const x of [-0.45, 0.45]) {
    b.beam(BLACK, [x, 0.3, 0.7], [0.0, 2.6, 0.0], 0.17);
    b.beam(BLACK, [x, 0.3, -0.7], [0.0, 2.6, 0.0], 0.17);
  }
  b.beam(YELLOW, [-0.45, 1.0, 0.45], [0.45, 1.0, 0.45], 0.1);
  b.cyl(YELLOW, 0.2, 0.3, 0.0, 2.5, 0.0, 10, 0.2, { rz: Math.PI / 2 });
  // motor + gearbox at the back
  b.box(BLACK, 0.9, 0.9, 0.8, 0, 0.35, -1.55);
  b.box(YELLOW, 0.92, 0.12, 0.82, 0, 0.9, -1.55);
  b.box(STEEL_D, 0.7, 0.5, 0.5, 0, 0.35, -0.9);
  b.snow(0, 1.02, -1.55, 0.8, 0.7, 0.06);
  // wellhead + tank + pump shed
  b.cyl(STEEL, 0.17, 0.7, 0, 0.35, 1.7, 8);
  b.box(YELLOW, 0.5, 0.12, 0.12, 0, 0.8, 1.7);
  b.cyl(YELLOW, 0.1, 0.18, 0.0, 1.05, 1.7, 8);
  b.cyl(SILVER, 0.75, 1.3, -1.8, 0.1, -1.3, 14);
  b.cone(0x9aa0a8, 0.8, 0.4, -1.8, 1.4, -1.3, 14);
  b.cone(SNOW, 0.7, 0.2, -1.8, 1.65, -1.3, 14);
  b.cyl(CRIMSON, 0.77, 0.14, -1.8, 0.7, -1.3, 14);
  b.box(CONCRETE, 1.0, 1.0, 0.9, 1.9, 0.1, -1.4);
  flatRoof(b, BLACK, 1.0, 0.9, 1.9, 1.1, -1.4);
  g.box(G_WARM, 0.4, 0.4, 0.05, 1.9, 0.5, -0.93);
  b.beam(CRIMSON, [-1.2, 0.3, -1.1], [-0.1, 0.5, 1.5], 0.1);
  b.beam(CRIMSON, [1.9, 0.3, -0.9], [0.1, 0.5, 1.6], 0.1);
  // walking beam with horsehead, counterweight, bridle
  p.box(YELLOW, 0.34, 0.34, 3.3, 0, -0.17, 0);
  p.box(BLACK, 0.4, 0.2, 0.4, 0, 0.16, 0);
  p.box(YELLOW, 0.3, 0.9, 0.5, 0, -0.8, 1.62);
  p.cyl(BLACK, 0.5, 0.3, 0, 0.0, 1.62, 10, 0.5, { rz: Math.PI / 2 });
  p.beam(IRON_L, [0, -0.2, 1.88], [0, -1.7, 1.88], 0.05);
  p.box(BLACK, 0.5, 0.9, 0.7, 0, -0.9, -1.5);
  p.box(YELLOW, 0.52, 0.1, 0.72, 0, -0.1, -1.5);
  return { at: [0, 2.6, 0], axis: 'x', mode: 'swing', speed: 0.35, amp: 0.2 };
};

/** refinery: distillation columns, spherical tank, flare stack. */
const refinery: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.9, 0x9a978f);
  const cols: readonly [number, number, number][] = [[-1.6, 0.58, 4.8], [-0.4, 0.5, 3.9], [0.75, 0.52, 3.1]];
  for (const [x, r, h] of cols) {
    b.cyl(SILVER, r, h, x, 0.1, -1.2, 12);
    for (let y = 0.9; y < h; y += 0.95) b.cyl(STEEL_D, r + 0.04, 0.1, x, y, -1.2, 12);
    b.dome(0x9aa0a8, r, x, 0.1 + h, -1.2);
    b.cyl(SNOW, r * 0.9, 0.08, x, 0.1 + h + r * 0.85, -1.2, 10);
    b.box(YELLOW, 0.06, h - 0.4, 0.06, x + r * 0.7, 0.3, -1.2 + r * 0.7);
  }
  // pipe rack
  for (const y of [1.0, 1.8, 2.6]) b.beam(CRIMSON, [-1.6, y, -0.5], [0.75, y, -0.5], 0.1);
  b.beam(BLACK, [-1.6, 0.1, -0.5], [-1.6, 3.0, -0.5], 0.1);
  b.beam(BLACK, [0.75, 0.1, -0.5], [0.75, 3.0, -0.5], 0.1);
  // spherical tank on legs
  b.sph(SILVER, 0.85, 1.7, 1.4, 0.5);
  b.cyl(CRIMSON, 0.86, 0.12, 1.7, 1.38, 0.5, 14);
  b.sph(SNOW, 0.5, 1.7, 2.1, 0.5, { sy: 0.35 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.beam(STEEL_D, [1.7 + sx * 0.55, 0.1, 0.5 + sz * 0.55], [1.7 + sx * 0.4, 1.0, 0.5 + sz * 0.4], 0.1);
  // flare stack with a flame
  b.cyl(STEEL_D, 0.1, 4.2, -2.1, 0.1, 1.6, 8, 0.07);
  b.cyl(BLACK, 0.16, 0.2, -2.1, 4.3, 1.6, 8);
  g.cone(G_FIRE, 0.2, 0.55, -2.1, 4.5, 1.6, 8);
  g.cone(G_WARM, 0.11, 0.4, -2.1, 4.5, 1.6, 6);
  b.beam(CRIMSON, [-2.1, 1.0, 1.6], [-1.6, 1.0, -0.5], 0.08);
  // air cooler with a fan
  for (const [x, z] of [[-0.5, 0.7], [0.9, 0.7], [-0.5, 1.5], [0.9, 1.5]] as const) b.beam(STEEL_D, [x, 0.1, z], [x, 0.9, z], 0.1);
  b.box(BLACK, 1.8, 0.45, 1.1, 0.2, 0.9, 1.1);
  b.cyl(STEEL_D, 0.5, 0.2, 0.2, 1.35, 1.1, 14);
  g.box(G_WARM, 0.25, 0.18, 0.05, -0.55, 1.0, 1.66);
  rotor(p, YELLOW, BLACK, 0, 0, 0, 0.48, 4);
  return { at: [0.2, 1.62, 1.1], axis: 'y', mode: 'spin', speed: 1.0 };
};

// ---------------------------------------------------------------------------
// era 8 — Computer Age: retro beige, sea teal, mint glow
// ---------------------------------------------------------------------------

/** sandPit: bucket-wheel dredge + crystal grower. */
const sandPit: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0xd6d2c6);
  // sand terraces and basin
  b.box(SAND, 3.4, 0.5, 1.2, -0.5, 0.1, -1.8);
  b.box(0xd4c48f, 2.6, 0.3, 1.1, -0.5, 0.1, -0.9);
  b.snow(-0.5, 0.6, -1.8, 3.0, 0.8, 0.06);
  b.box(0x9fb4c4, 2.4, 0.05, 1.6, -0.9, 0.1, 0.6);
  lumps(b, SAND, 1.0, 0.7, 0.6, 5, 41, 0.22);
  // dredger body on tracks + boom
  b.box(STEEL_L, 1.6, 0.3, 1.2, 0.7, 0.1, -0.2);
  b.box(BEIGE, 1.4, 1.0, 1.1, 0.7, 0.4, -0.2);
  b.box(SEA, 1.45, 0.16, 1.15, 0.7, 0.9, -0.2);
  flatRoof(b, BEIGE, 1.4, 1.1, 0.7, 1.4, -0.2);
  g.box(G_MINT, 0.6, 0.4, 0.05, 0.7, 0.6, 0.4);
  b.beam(STEEL_L, [0.2, 1.1, -0.2], [-1.25, 1.15, 0.55], 0.14);
  b.beam(STEEL_L, [0.2, 1.3, -0.2], [-1.25, 1.35, 0.55], 0.06);
  // conveyor to the silo
  b.beam(PEWTER, [1.3, 1.2, -0.8], [1.85, 2.9, -1.7], 0.2);
  b.cyl(BEIGE, 0.62, 3.0, 1.85, 0.1, -1.8, 14);
  b.cyl(SEA, 0.64, 0.25, 1.85, 1.2, -1.8, 14);
  b.dome(STEEL_L, 0.62, 1.85, 3.1, -1.8);
  b.sph(SNOW, 0.4, 1.85, 3.65, -1.8, { sy: 0.35 });
  // crystal grower
  b.cyl(STEEL_L, 0.5, 0.4, 1.7, 0.1, 1.2, 12);
  b.cyl(SEA, 0.52, 0.08, 1.7, 0.5, 1.2, 12);
  g.cone(0xd4f5e4, 0.22, 0.7, 1.7, 0.6, 1.2, 6);
  g.cone(G_MINT, 0.14, 0.55, 1.7, 0.45, 1.2, 6, { rx: Math.PI });
  b.dome(0xd8ece6, 0.5, 1.7, 0.5, 1.2);
  // bucket wheel
  p.torus(STEEL_L, 0.82, 0.09, 0, 0, 0, undefined, 16);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.box(SEA, 0.3, 0.24, 0.34, Math.cos(a) * 0.86 - 0.15, Math.sin(a) * 0.86 - 0.12, 0, { rz: a });
    p.beam(STEEL_L, [0, 0, 0], [Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0], 0.06);
  }
  p.cyl(STEEL_D, 0.14, 0.3, 0, -0.15, 0, 8, 0.14, { rx: Math.PI / 2 });
  return { at: [-1.4, 1.2, 0.55], axis: 'z', mode: 'spin', speed: 0.35 };
};

/** chipFab: white clean-room block with air vents. */
const chipFab: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.6, 0xd6d2c6);
  b.box(BEIGE, 4.4, 2.5, 3.0, 0, 0.1, -0.4);
  b.box(SEA, 4.46, 0.3, 3.06, 0, 0.9, -0.4);
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    b.box(STEEL_L, 0.76, 0.6, 0.06, x, 1.45, 1.1);
    g.box(G_MINT, 0.66, 0.5, 0.05, x, 1.5, 1.14);
  }
  b.box(0xeee8d8, 4.5, 0.16, 3.1, 0, 2.6, -0.4);
  b.snow(0, 2.76, -0.4, 4.3, 2.9, 0.1);
  // airlock porch
  b.box(STEEL_L, 1.2, 1.7, 0.6, -1.6, 0.1, 1.4);
  b.box(SEA, 1.25, 0.12, 0.65, -1.6, 1.8, 1.4);
  b.snow(-1.6, 1.92, 1.4, 1.3, 0.7, 0.08);
  g.box(G_MINT, 0.8, 1.2, 0.05, -1.6, 0.2, 1.72);
  // rooftop vents and exhaust stacks
  for (const [x, z] of [[-1.4, -1.2], [-0.4, -1.2], [-1.4, 0.0]] as const) {
    b.box(STEEL_L, 0.7, 0.5, 0.7, x, 2.86, z);
    b.box(STEEL, 0.62, 0.06, 0.62, x, 3.36, z);
    for (let i = 0; i < 3; i++) b.box(STEEL_D, 0.66, 0.04, 0.04, x, 2.95 + i * 0.12, z + 0.35);
  }
  b.cyl(STEEL_L, 0.2, 1.0, 1.7, 2.86, -1.5, 10);
  b.cyl(SEA, 0.22, 0.1, 1.7, 3.5, -1.5, 10);
  // side pipes
  b.beam(STEEL, [2.25, 0.5, -1.6], [2.25, 0.5, 0.6], 0.14);
  b.beam(STEEL, [2.25, 0.5, 0.6], [2.25, 2.4, 0.6], 0.14);
  // exhaust fan inside a shroud
  b.cyl(STEEL_L, 0.62, 0.3, 0.9, 2.86, -0.3, 14);
  b.cyl(SEA, 0.64, 0.08, 0.9, 3.16, -0.3, 14);
  rotor(p, SEA, STEEL_D, 0, 0, 0, 0.52, 4);
  return { at: [0.9, 3.12, -0.3], axis: 'y', mode: 'spin', speed: 1.1 };
};

// ---------------------------------------------------------------------------
// era 9 — Nuclear Power: porcelain, concrete, jade, sea-foam glow
// ---------------------------------------------------------------------------

/** uraniumMine: shielded headframe, hazard stripes. */
const uraniumMine: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0xbcc6cc);
  b.box(CONCRETE, 1.9, 3.0, 1.9, -0.3, 0.1, -0.5);
  b.box(CONCRETE_D, 2.1, 0.3, 2.1, -0.3, 3.1, -0.5);
  b.snow(-0.3, 3.4, -0.5, 2.0, 2.0, 0.1);
  hazard(b, -0.3, 0.1, 0.46, 1.9, 0.3);
  hazard(b, -0.3, 2.7, 0.46, 1.9, 0.3);
  b.window(g, G_FOAM, CONCRETE_D, -0.9, 1.4, 0.45, 0.4, 0.5, 0);
  b.window(g, G_FOAM, CONCRETE_D, 0.3, 1.4, 0.45, 0.4, 0.5, 0);
  b.box(SLATE_D, 0.7, 1.0, 0.1, -0.3, 0.4, 0.5);
  // hoist frame and wheel
  for (const z of [-1.0, 0.0]) {
    b.beam(YELLOW, [-0.9, 3.4, z], [-0.3, 4.4, z], 0.14);
    b.beam(YELLOW, [0.3, 3.4, z], [-0.3, 4.4, z], 0.14);
  }
  b.beam(IRON, [-0.3, 4.4, -1.1], [-0.3, 4.4, 0.1], 0.14);
  wheel(p, 'x', YELLOW, BLACK, 0, 0, 0, 0.55, 0.08, 6);
  // casks and shielded containers
  b.box(CONCRETE_D, 1.2, 0.2, 1.0, 1.8, 0.1, 0.9);
  for (const [x, z] of [[1.5, 0.7], [1.9, 0.9], [1.6, 1.15]] as const) {
    b.cyl(0x56606a, 0.24, 0.62, x, 0.3, z, 10);
    g.cyl(G_FOAM, 0.18, 0.05, x, 0.92, z, 8);
    b.cyl(YELLOW, 0.25, 0.1, x, 0.5, z, 10);
  }
  b.cyl(CONCRETE_D, 0.3, 0.8, 1.9, 0.1, -1.4, 10);
  // lead-lined shield wall with hazard sign, beacon mast
  b.box(CONCRETE_D, 2.0, 0.9, 0.35, -1.45, 0.1, 1.5);
  b.snow(-1.45, 1.0, 1.5, 1.9, 0.3, 0.08);
  hazard(b, -1.45, 0.5, 1.7, 1.6, 0.2);
  b.beam(STEEL_D, [2.1, 0.1, -0.3], [2.1, 3.2, -0.3], 0.1);
  g.sph(G_FOAM, 0.14, 2.1, 3.3, -0.3);
  rails(b, STEEL_D, 0.9, -1.8, 0.2);
  return { at: [-0.3, 4.55, -0.5], axis: 'x', mode: 'spin', speed: 0.5 };
};

/** enricher: centrifuge cascade hall. */
const enricher: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0xbcc6cc);
  b.box(CONCRETE, 4.4, 2.0, 1.9, 0, 0.1, -1.3);
  b.box(CONCRETE_D, 4.5, 0.2, 2.0, 0, 2.1, -1.3);
  b.snow(0, 2.3, -1.3, 4.3, 1.9, 0.1);
  hazard(b, 0, 0.1, -0.33, 4.4, 0.26);
  g.box(G_FOAM, 3.8, 0.55, 0.05, 0, 1.0, -0.32);
  b.box(SLATE_D, 3.95, 0.14, 0.07, 0, 0.9, -0.33);
  b.box(SLATE_D, 3.95, 0.14, 0.07, 0, 1.58, -0.33);
  // the cascade of centrifuges
  for (let i = 0; i < 6; i++) {
    const x = -1.9 + i * 0.76;
    b.cyl(PORCELAIN, 0.24, 1.7, x, 0.1, 0.9, 10);
    b.cyl(JADE, 0.26, 0.18, x, 0.5, 0.9, 10);
    b.cyl(STEEL_D, 0.27, 0.12, x, 1.7, 0.9, 10);
    b.dome(STEEL_L, 0.24, x, 1.82, 0.9);
    b.beam(STEEL, [x, 1.2, 0.9], [x, 1.2, -0.3], 0.08);
  }
  b.beam(STEEL, [-1.9, 1.95, 0.9], [1.9, 1.95, 0.9], 0.1);
  b.box(CONCRETE_D, 4.2, 0.12, 0.6, 0, 0.1, 0.9);
  // gas tanks at the back and a cooling stack
  hcyl(b, STEEL_L, 0.4, 1.4, -1.6, 2.7, -1.5, 'x', 12);
  b.snow(-1.6, 3.05, -1.5, 1.3, 0.5, 0.06);
  stack(b, PORCELAIN, JADE, 1.7, 2.3, -1.6, 0.3, 1.3);
  // rotating turbine on the roof
  b.cyl(CONCRETE_D, 0.62, 0.35, 0.3, 2.3, -1.3, 14);
  b.cyl(JADE, 0.64, 0.08, 0.3, 2.65, -1.3, 14);
  rotor(p, JADE, SLATE_D, 0, 0, 0, 0.55, 5);
  return { at: [0.3, 2.9, -1.3], axis: 'y', mode: 'spin', speed: 1.0 };
};

/** reactor: cooling tower + containment dome. */
const reactor: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.9, 0xbcc6cc);
  b.lathe(0xc9cdc6, [[1.35, 0], [1.2, 1.0], [1.03, 2.0], [0.94, 3.0], [0.95, 3.8], [1.02, 4.4]], -1.15, 0.1, -1.1, 18);
  b.cyl(0xa5aaa2, 1.04, 0.14, -1.15, 4.4, -1.1, 18);
  b.cyl(SNOW, 1.0, 0.07, -1.15, 4.54, -1.1, 18);
  for (let i = 0; i < 5; i++) b.box(CONCRETE_D, 0.5, 0.5, 0.06, -1.15 + Math.cos(i * 1.2) * 0.3, 0.1, -1.1 + 1.33);
  // containment building: drum + dome with a glowing band
  b.cyl(CONCRETE, 1.2, 1.4, 1.2, 0.1, 0.7, 16);
  b.dome(0xd2d6cf, 1.2, 1.2, 1.5, 0.7);
  g.cyl(G_FOAM, 1.215, 0.12, 1.2, 1.0, 0.7, 16);
  b.cyl(SLATE_D, 1.22, 0.1, 1.2, 0.9, 0.7, 16);
  b.sph(SNOW, 0.5, 1.2, 2.65, 0.7, { sy: 0.4 });
  // turbine hall + pipes
  b.box(CONCRETE_D, 1.9, 1.1, 1.0, 0.3, 0.1, -1.9);
  flatRoof(b, CONCRETE, 1.9, 1.0, 0.3, 1.2, -1.9);
  g.box(G_FOAM, 1.4, 0.2, 0.05, 0.3, 0.7, -1.38);
  hazard(b, 0.3, 0.1, -1.38, 1.9, 0.18);
  b.beam(STEEL, [-0.2, 1.0, -1.1], [0.5, 0.9, 0.0], 0.18);
  // steam plume from the tower
  p.sph(0xf2f5f8, 0.62, 0, 0, 0);
  p.sph(0xf2f5f8, 0.45, 0.3, 0.4, 0.15);
  p.sph(0xf2f5f8, 0.4, -0.3, 0.3, -0.1);
  return { at: [-1.15, 4.8, -1.1], axis: 'y', mode: 'rise', speed: 0.18, amp: 0.8 };
};

// ---------------------------------------------------------------------------
// era 10 — AI Era: cream panels, pewter slate, sun-gold glow
// ---------------------------------------------------------------------------

/** fusionPlant: torus ring reactor with glow. */
const fusionPlant: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0xe4ddcc);
  b.cyl(CREAM, 2.35, 0.22, 0, 0.1, 0, 20);
  b.cyl(SLATE, 2.2, 0.06, 0, 0.32, 0, 20);
  g.torus(G_SUN, 1.85, 0.04, 0, 0.4, 0, { rx: Math.PI / 2 }, 28);
  // outer coils round the vertical torus, supports
  const R = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box(i % 2 ? SLATE : CREAM, 0.95, 0.24, 1.0, Math.cos(a) * R, 2.4 + Math.sin(a) * R - 0.12, 0, { rz: a });
  }
  b.torus(0xe9e2d2, R, 0.12, 0, 2.4, 0.55, undefined, 24);
  b.torus(0xe9e2d2, R, 0.12, 0, 2.4, -0.55, undefined, 24);
  for (const s of [-1, 1]) b.beam(CREAM, [s * 0.9, 0.3, 0.1], [s * 0.45, 1.2, 0.0], 0.3);
  // transformer blocks with neon strips
  for (const s of [-1, 1]) {
    b.box(SLATE, 0.8, 1.2, 0.9, s * 1.85, 0.3, -1.45);
    g.box(G_SUN, 0.08, 0.8, 0.05, s * 1.85 - s * 0.1, 0.5, -0.98);
    b.snow(s * 1.85, 1.5, -1.45, 0.76, 0.86, 0.06);
  }
  // plasma ring with bright beads
  p.torus(0xf2b644, R, 0.22, 0, 0, 0, undefined, 28);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.sph(i % 2 ? 0xffffff : 0xfff0c8, 0.2, Math.cos(a) * R, Math.sin(a) * R, 0);
  }
  return { at: [0, 2.4, 0], axis: 'z', mode: 'spin', speed: 0.35, glow: true };
};

/** nanoFab: sleek block with holo panels. */
const nanoFab: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.6, 0xe4ddcc);
  b.box(CREAM, 4.4, 1.3, 3.0, 0, 0.1, -0.5);
  b.box(SLATE, 3.8, 0.55, 2.5, 0, 1.4, -0.5);
  b.box(0xfbf8f0, 3.9, 0.1, 2.6, 0, 1.95, -0.5);
  b.snow(0, 2.05, -0.5, 3.7, 2.4, 0.08);
  g.box(G_SUN, 4.46, 0.07, 0.05, 0, 1.28, 1.0);
  g.box(G_SUN, 0.05, 0.07, 3.06, 2.22, 1.28, -0.5);
  g.box(G_SUN, 0.05, 0.07, 3.06, -2.22, 1.28, -0.5);
  // holo panels on the front face
  for (const x of [-1.4, 0, 1.4]) {
    b.box(SLATE, 1.1, 0.8, 0.06, x, 0.3, 1.02);
    g.box(x === 0 ? G_MINT : G_SUN, 0.95, 0.62, 0.05, x, 0.4, 1.07);
  }
  // fabricator bays on the side: small pods
  for (const z of [-1.2, 0.2]) {
    b.sph(CREAM, 0.38, 2.1, 0.5, z, { sy: 0.8 });
    g.box(G_MINT, 0.06, 0.3, 0.3, 2.4, 0.4, z);
  }
  b.beam(CREAM, [-1.9, 2.0, -1.4], [-1.9, 3.3, -1.4], 0.08);
  g.sph(G_SUN, 0.1, -1.9, 3.4, -1.4);
  // floating hologram of two crossing rings and a core
  p.torus(0xffffff, 0.75, 0.05, 0, 0, 0, undefined, 20);
  p.torus(0xffe7b0, 0.75, 0.05, 0, 0, 0, { ry: Math.PI / 2 }, 20);
  p.torus(0xf2c46a, 0.5, 0.04, 0, 0, 0, { rx: Math.PI / 2 }, 16);
  p.sph(0xffffff, 0.22, 0, 0, 0);
  return { at: [0, 3.1, -0.5], axis: 'y', mode: 'spin', speed: 0.4, glow: true };
};

/** dataCenter: server halls with blinking racks. */
const dataCenter: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0xe4ddcc);
  b.box(CREAM, 4.6, 2.0, 1.8, 0, 0.1, -1.55);
  b.box(SLATE, 4.7, 0.18, 1.9, 0, 2.1, -1.55);
  b.snow(0, 2.28, -1.55, 4.5, 1.7, 0.1);
  b.box(CREAM, 3.4, 1.5, 1.6, -0.4, 0.1, 0.65);
  b.box(SLATE, 3.5, 0.16, 1.7, -0.4, 1.6, 0.65);
  b.snow(-0.4, 1.76, 0.65, 3.3, 1.5, 0.1);
  const rnd = seeded(77);
  const tints = [G_SUN, G_MINT, 0xffffff, G_SUN, G_SUN, 0xffb38a];
  const lights = (x0: number, y0: number, z: number, cols: number, rows: number, pitch: number): void => {
    for (let c = 0; c < cols; c++) {
      b.box(0x3f4d5c, pitch * 0.9, rows * 0.32 + 0.1, 0.05, x0 + c * pitch, y0 - 0.05, z - 0.02);
      for (let r = 0; r < rows; r++) if (rnd() > 0.2) g.box(tints[Math.floor(rnd() * tints.length)]!, pitch * 0.55, 0.12, 0.06, x0 + c * pitch, y0 + r * 0.32, z + 0.01);
    }
  };
  lights(-2.0, 0.5, -0.64, 9, 4, 0.5);
  lights(-1.6, 0.35, 1.46, 7, 3, 0.5);
  // rooftop cooling fins and the AI core mast
  for (let i = 0; i < 5; i++) b.box(STEEL_L, 0.5, 0.35, 0.2, -1.6 + i * 0.5, 1.78, 1.0);
  b.cyl(CREAM, 0.55, 0.5, 1.45, 1.76, 0.65, 12);
  g.cyl(G_SUN, 0.45, 0.04, 1.45, 2.26, 0.65, 12);
  b.beam(CREAM, [0, 2.3, -1.55], [0, 3.0, -1.55], 0.14);
  b.cyl(SLATE, 0.3, 0.12, 0, 2.95, -1.55, 10);
  // the AI core: a cage of rings round a bright orb
  p.torus(0xffffff, 0.6, 0.05, 0, 0, 0, undefined, 18);
  p.torus(0xffe7b0, 0.6, 0.05, 0, 0, 0, { ry: Math.PI / 2 }, 18);
  p.sph(0xfff0c8, 0.3, 0, 0, 0);
  p.sph(0xffffff, 0.12, 0.34, 0.1, 0.1);
  return { at: [0, 3.65, -1.55], axis: 'y', mode: 'spin', speed: 0.3, glow: true };
};

/** robotWorks: assembly hall with robot arms. */
const robotWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  pad(b, 5.0, 4.8, 0xe4ddcc);
  b.box(CREAM, 4.6, 2.3, 2.0, 0, 0.1, -1.4);
  b.box(GOLD, 4.66, 0.18, 2.06, 0, 1.7, -1.4);
  b.box(SLATE, 4.7, 0.2, 2.1, 0, 2.4, -1.4);
  b.snow(0, 2.6, -1.4, 4.5, 1.9, 0.1);
  // big gate, lit inside
  b.box(SLATE, 1.9, 1.7, 0.1, 0, 0.1, -0.38);
  g.box(G_SUN, 1.6, 1.4, 0.05, 0, 0.2, -0.33);
  for (const x of [-1.6, 1.6]) {
    b.window(g, G_MINT, SLATE, x, 0.9, -0.38, 0.5, 0.7, 0);
  }
  // assembly line in front: slab, conveyor, static robot
  b.box(SLATE, 3.4, 0.2, 1.4, 0, 0.1, 1.15);
  g.box(G_SUN, 3.0, 0.05, 0.22, 0, 0.3, 1.15);
  for (let i = 0; i < 4; i++) b.box(CREAM, 0.3, 0.2, 0.3, -1.1 + i * 0.7, 0.31, 1.15);
  b.cyl(SLATE, 0.28, 0.35, -1.45, 0.3, 0.75, 10);
  b.beam(CREAM, [-1.45, 0.6, 0.75], [-1.45, 1.4, 1.0], 0.15);
  b.beam(CREAM, [-1.45, 1.4, 1.0], [-0.9, 1.2, 1.5], 0.12);
  g.sph(G_SUN, 0.1, -0.85, 1.15, 1.55);
  b.box(CREAM, 0.4, 0.5, 0.35, 2.2, 0.1, -0.1);
  b.cyl(CREAM, 0.14, 0.35, 2.2, 0.6, -0.1, 8);
  g.sph(G_SUN, 0.13, 2.2, 1.05, -0.1);
  // working arm: turntable, two links, claw, held part
  p.cyl(SLATE, 0.36, 0.3, 0, 0, 0, 12);
  p.cyl(CREAM, 0.26, 0.2, 0, 0.3, 0, 10);
  p.beam(CREAM, [0, 0.4, 0], [-0.4, 1.35, 0], 0.2);
  p.sph(GOLD, 0.15, -0.4, 1.35, 0);
  p.beam(CREAM, [-0.4, 1.35, 0], [-1.35, 0.9, 0], 0.16);
  p.sph(GOLD, 0.12, -1.35, 0.9, 0);
  p.box(SLATE, 0.12, 0.3, 0.3, -1.45, 0.6, 0);
  p.box(0xfff0c8, 0.25, 0.22, 0.25, -1.55, 0.36, 0);
  return { at: [1.6, 0.4, 1.1], axis: 'y', mode: 'swing', speed: 0.28, amp: 0.85 };
};

/** 0.9.0 recipes (the 0.9.5 machines come from their own era files: OWN_MODELS below). */
const RECIPES: Partial<Record<MachineId, Recipe>> = {
  quarry, kiln, ironMine, smelter, coalPit, steamWorks, deepMine, cokeOven, steelMill, copperMine, wireMill, oilPump,
  refinery, sandPit, chipFab, uraniumMine, enricher, reactor, fusionPlant, nanoFab, dataCenter, robotWorks,
};

// ---------------------------------------------------------------------------
// building models from recipes
// ---------------------------------------------------------------------------

const builtCache = new Map<MachineId, Built>();

function build(id: MachineId): Built {
  let built = builtCache.get(id);
  if (built) return built;
  const parts: Parts = { body: new Kit(), glow: new Kit(), pivot: new Kit() };
  const spec = RECIPES[id]!(parts);
  const body = parts.body.geometry();
  const glow = parts.glow.batch.empty ? null : parts.glow.geometry();
  const pivot = spec && !parts.pivot.batch.empty ? parts.pivot.geometry() : null;
  const box = new THREE.Box3().copy(body.boundingBox!);
  if (glow) box.union(glow.boundingBox!);
  if (pivot && spec) box.union(pivot.boundingBox!.clone().translate(new THREE.Vector3(...spec.at)));
  const size = box.getSize(new THREE.Vector3());
  built = { body, glow, pivot, spec: pivot ? spec : null, w: Math.ceil(size.x * 10 - 1e-6) / 10, d: Math.ceil(size.z * 10 - 1e-6) / 10 };
  builtCache.set(id, built);
  return built;
}

/** Idle crawl as a share of the working speed. */
const IDLE = 0.12;

/** 0.9.5: machines whose models live in their era's own builder file. */
const OWN_MODELS: Partial<Record<MachineId, () => MachineModel>> = {
  // eras 5-7 (assets/eraMachines3.ts)
  ...Object.fromEntries(ERA5_7_MACHINE_IDS.map((id) => [id, () => createEra5to7MachineModel(id)])),
};

export function createMachineModel(id: MachineId): MachineModel {
  const own = OWN_MODELS[id];
  if (own) return own();
  const built = build(id);
  const root = new THREE.Group();
  root.name = `machine:${id}:${MACHINES[id].era}`;
  const bodyMesh = new THREE.Mesh(built.body, vcMat());
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.name = 'body';
  root.add(bodyMesh);
  if (built.glow) {
    const m = new THREE.Mesh(built.glow, eraGlowMaterial());
    m.name = 'glow';
    root.add(m);
  }
  let pivotMesh: THREE.Mesh | null = null;
  const spec = built.spec;
  if (built.pivot && spec) {
    pivotMesh = new THREE.Mesh(built.pivot, spec.glow ? eraGlowMaterial() : vcMat());
    pivotMesh.name = 'pivot';
    pivotMesh.castShadow = !spec.glow && spec.mode !== 'rise';
    pivotMesh.position.set(...spec.at);
    root.add(pivotMesh);
  }
  let phase = 0;
  let drive = IDLE;
  const animate = (dt: number, working: boolean): void => {
    if (!pivotMesh || !spec) return;
    drive += ((working ? 1 : IDLE) - drive) * Math.min(1, dt * 3);
    phase += dt * spec.speed * drive;
    const amp = spec.amp ?? 0;
    switch (spec.mode) {
      case 'spin':
        pivotMesh.rotation[spec.axis] = phase * Math.PI * 2;
        break;
      case 'swing':
        pivotMesh.rotation[spec.axis] = Math.sin(phase * Math.PI * 2) * amp;
        break;
      case 'slide':
        pivotMesh.position[spec.axis] = spec.at[spec.axis === 'x' ? 0 : spec.axis === 'y' ? 1 : 2] + Math.sin(phase * Math.PI * 2) * amp;
        break;
      case 'rise': {
        const f = phase - Math.floor(phase);
        pivotMesh.position.y = spec.at[1] + f * amp;
        pivotMesh.scale.setScalar(1 - 0.55 * f);
        break;
      }
    }
  };
  return { root, w: built.w, d: built.d, animate };
}

// ---------------------------------------------------------------------------
// depot + dock
// ---------------------------------------------------------------------------

/** Material tier of an era: 0 timber (2–3), 1 brick + iron (4–6), 2 steel + concrete (7–8), 3 white panel (9–10). */
function tier(era: number): 0 | 1 | 2 | 3 {
  return era <= 3 ? 0 : era <= 6 ? 1 : era <= 8 ? 2 : 3;
}

interface Skin {
  floor: number;
  post: number;
  board: number;
  trim: number;
  crate: number;
  crate2: number;
  sign: number;
}

function skin(era: number): Skin {
  const c = colors(era);
  switch (tier(era)) {
    case 0: return { floor: PLANK, post: TIMBER_D, board: era === 2 ? TIMBER : 0x4a403a, trim: c.accent, crate: PLANK, crate2: TIMBER, sign: 0xffe8b0 };
    case 1: return { floor: era === 4 ? 0x7a7672 : CONCRETE_D, post: IRON, board: era === 6 ? TEAL : c.trim, trim: c.accent, crate: era === 6 ? COPPER : BRASS, crate2: STEEL_D, sign: era === 6 ? 0xfff2c0 : 0xffd98a };
    case 2: return { floor: CONCRETE, post: c.trim, board: c.trim, trim: c.accent, crate: c.body, crate2: era === 7 ? STEEL_L : SEA, sign: era === 7 ? 0xffe08a : 0xc8f5dc };
    default: return { floor: era === 9 ? 0xd2d8d8 : 0xe9e3d4, post: c.trim, board: c.trim, trim: c.accent, crate: c.accent, crate2: c.body, sign: era === 9 ? 0xc8fbef : 0xfff0c0 };
  }
}

const groupCache = new Map<string, { body: THREE.BufferGeometry; glow: THREE.BufferGeometry }>();

function signGlowColor(era: number): number {
  return tier(era) >= 2 ? colors(era).glow : G_WARM;
}

function assemble(key: string, era: number, make: (b: Kit, g: Kit, s: Skin) => void): THREE.Group {
  let geos = groupCache.get(key);
  if (!geos) {
    const b = new Kit();
    const g = new Kit();
    make(b, g, skin(era));
    geos = { body: b.geometry(), glow: g.geometry() };
    groupCache.set(key, geos);
  }
  const root = new THREE.Group();
  root.name = key;
  const body = new THREE.Mesh(geos.body, vcMat());
  body.castShadow = true;
  body.receiveShadow = true;
  const glow = new THREE.Mesh(geos.glow, eraGlowMaterial());
  root.add(body, glow);
  return root;
}

/** Sign board on two posts at z, with glowing pixel text. */
function signBoard(b: Kit, g: Kit, s: Skin, text: string, era: number, z: number, y: number): void {
  const px = 0.085;
  const w = pixelTextWidth(text, px) + 0.5;
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) b.box(s.post, 0.14, y, 0.14, x, 0, z);
  b.box(s.board, w, 0.72, 0.1, 0, y - 0.1, z);
  b.box(s.trim, w + 0.1, 0.07, 0.14, 0, y + 0.62, z);
  b.box(s.trim, w + 0.1, 0.07, 0.14, 0, y - 0.15, z);
  b.snow(0, y + 0.69, z, w + 0.1, 0.2, 0.09);
  pixelText(g, text, s.sign, px, 0, y + 0.02, z + 0.07, 0.05);
}

/** Export depot (freight dock where materials are sold), era-styled. Origin floor centre, +Z front. ~3 × 2.4 m. */
export function createDepotModel(era: number): THREE.Group {
  return assemble(`depot:${era}`, era, (b, g, s) => {
    const t = tier(era);
    // loading platform with a ramp
    b.box(s.floor, 3.0, 0.3, 1.5, 0, 0, -0.55);
    b.box(s.trim, 3.04, 0.06, 0.06, 0, 0.3, 0.2);
    b.box(s.floor, 1.4, 0.08, 0.95, 0, 0.11, 0.75, { rx: -0.3 });
    b.snow(-0.9, 0.3, -0.55, 1.1, 1.4, 0.06);
    // wheel stops / bollards
    for (const x of [-1.35, 1.35]) b.cyl(s.trim, 0.09, 0.4, x, 0.3, 0.1, 8);
    // cargo waiting for export (themed per tier)
    if (t === 0) {
      b.box(s.crate, 0.7, 0.5, 0.6, 0.8, 0.3, -0.5);
      b.box(s.crate2, 0.5, 0.45, 0.5, 0.75, 0.8, -0.5, { ry: 0.3 });
      for (let i = 0; i < 3; i++) hcyl(b, s.crate2, 0.17, 0.6, -0.9 + i * 0.36, 0.47, -0.2, 'z', 8);
    } else if (t === 1) {
      b.box(s.crate, 0.7, 0.55, 0.65, 0.8, 0.3, -0.5);
      b.cyl(s.crate2, 0.22, 0.6, -0.8, 0.3, -0.3, 10);
      b.cyl(s.crate2, 0.22, 0.6, -0.4, 0.3, -0.5, 10);
    } else if (t === 2) {
      b.box(s.crate, 0.9, 0.7, 0.8, 0.7, 0.3, -0.5);
      b.box(s.crate2, 0.8, 0.12, 0.8, -0.8, 0.3, -0.4);
      b.box(s.crate, 0.7, 0.6, 0.7, -0.8, 0.42, -0.4);
    } else {
      b.box(s.crate2, 0.9, 0.7, 0.8, 0.7, 0.3, -0.5);
      g.box(signGlowColor(era), 0.9, 0.05, 0.05, 0.7, 0.55, -0.09);
      b.box(s.crate, 0.7, 0.6, 0.7, -0.8, 0.3, -0.4);
      g.box(signGlowColor(era), 0.7, 0.05, 0.05, -0.8, 0.5, -0.04);
    }
    signBoard(b, g, s, 'EXPORT', era, -1.0, 1.55);
    // lamp
    b.beam(s.post, [1.35, 0.3, -1.0], [1.35, 1.6, -1.0], 0.1);
    g.sph(signGlowColor(era), 0.1, 1.35, 1.7, -1.0);
  });
}

/** Import dock (pallet bay where market orders arrive), era-styled. Origin floor centre, +Z front. ~3 × 2.4 m. */
export function createDockModel(era: number): THREE.Group {
  return assemble(`dock:${era}`, era, (b, g, s) => {
    const t = tier(era);
    b.box(s.floor, 3.0, 0.1, 2.0, 0, 0, 0.1);
    b.box(s.trim, 3.0, 0.06, 0.06, 0, 0.1, 1.1);
    // pallets with parcels
    for (const x of [-0.7, 0.55]) {
      for (let i = 0; i < 3; i++) b.box(PLANK, 0.9, 0.05, 0.22, x, 0.1 + 0.0, 0.5 + (i - 1) * 0.32);
      b.box(TIMBER_D, 0.9, 0.06, 0.9, x, 0.15, 0.5);
    }
    b.box(s.crate, 0.5, 0.4, 0.4, -0.7, 0.21, 0.5);
    b.box(s.crate2, 0.4, 0.3, 0.35, -0.65, 0.61, 0.5, { ry: 0.2 });
    if (t >= 2) {
      // roller conveyor into the bay, with status strip
      for (let i = 0; i < 5; i++) hcyl(b, STEEL_L, 0.07, 0.8, 1.15, 0.28, -0.2 + i * 0.3, 'x', 8);
      b.box(s.post, 0.1, 0.3, 1.4, 0.7, 0.1, 0.2);
      b.box(s.post, 0.1, 0.3, 1.4, 1.6, 0.1, 0.2);
      g.box(signGlowColor(era), 0.05, 0.05, 1.3, 0.7, 0.4, 0.2);
    } else {
      // jib crane with a hook
      b.beam(s.post, [1.2, 0.1, -0.3], [1.2, 2.1, -0.3], 0.16);
      b.beam(t === 0 ? TIMBER : IRON_L, [1.2, 2.0, -0.3], [-0.1, 2.0, 0.3], 0.12);
      b.beam(s.trim, [1.2, 1.1, -0.3], [0.6, 1.95, 0.0], 0.08);
      b.beam(IRON_L, [-0.0, 2.0, 0.3], [-0.0, 0.9, 0.3], 0.025);
      b.box(IRON, 0.14, 0.2, 0.14, 0.0, 0.72, 0.3);
      b.box(s.post, 0.5, 0.2, 0.5, 1.2, 0.1, -0.3);
      b.snow(1.2, 2.12, -0.3, 0.3, 0.3, 0.06);
    }
    signBoard(b, g, s, 'IMPORT', era, -0.95, 1.6);
  });
}

// ---------------------------------------------------------------------------
// gallery catalog (?gallery=eraMachines)
// ---------------------------------------------------------------------------

const catalog: Record<string, () => THREE.Object3D> = {};
for (const id of MACHINE_IDS) catalog[id] = () => createMachineModel(id).root;
for (const era of [2, 4, 6, 8, 10]) {
  catalog[`depot${era}`] = () => createDepotModel(era);
  catalog[`dock${era}`] = () => createDockModel(era);
}
export const eraMachineCatalog: Record<string, () => THREE.Object3D> = catalog;

// one review sheet per era (its machines in a row, then depot and dock): `?gallery=era5` or `?gallery=eraSheets`.
// Its own gallery domain, so the eraMachines row stays one model per cell.
const sheets: Record<string, () => THREE.Object3D> = {};
for (let era = 2; era <= 10; era++) {
  sheets[`era${era}`] = () => {
    const sheet = new THREE.Group();
    sheet.name = `era${era}`;
    let x = 0;
    for (const id of Object.keys(RECIPES) as MachineId[]) {
      if (MACHINES[id].era !== era) continue;
      const m = createMachineModel(id);
      m.root.position.x = x + 3.1;
      x += 6.4;
      sheet.add(m.root);
    }
    const depot = createDepotModel(era);
    depot.position.set(x + 1.8, 0, -0.6);
    const dock = createDockModel(era);
    dock.position.set(x + 1.8, 0, 2.2);
    sheet.add(depot, dock);
    return sheet;
  };
}
export const eraSheetCatalog: Record<string, () => THREE.Object3D> = sheets;
