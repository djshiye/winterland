/**
 * Era hand nodes: the "giant log" of eras 2..10. Each era's main resource is harvested by hand from its own node
 * (docs/EXPANSION.md section D, art spec docs/art/era-NN.json `node`, design notes in docs/ERA_RESOURCES.md):
 *
 *   2 Great Boulder · 3 Ore Vein · 4 Coal Seam · 5 Slag Heap · 6 Copper Vein · 7 Oil Seep · 8 Sand Dune ·
 *   9 Uranium Crystal · 10 Data Crystal
 *
 * Plus the matching hand tool the player swings at it (`createNodeTool`), the era analog of `createAxe`.
 *
 * CONTRACT (for the code that places a node in its region, like stations/GiantLog.ts does for the log):
 * - Local frame: origin at the floor centre, +Y up, +Z = the front (where the player stands to harvest).
 * - ≤ 3 meshes: 'body' (merged, vertex colours, snow caps included), 'glow' (the shared `eraGlowMaterial()`, so night
 *   lighting needs no caller code) and ONE animated mesh 'anim'. Body and glow sit in a 'shake' group that squashes
 *   and wobbles on a hit; the anim mesh plays the era's own harvest effect (a stone flake pops off, rust sparks spray,
 *   soot puffs, the slag crust thumps, copper crackles, the auger drills, silica glints swirl, the uranium halo
 *   pulses, the light ribbon spins up). Pop / spark / puff / crackle meshes are hidden while idle (no draw call).
 * - `hit()` starts one harvest reaction (call it on every tool strike, like GiantLog's chopPiece);
 *   `animate(dt)` runs the idle motion and any reaction. No allocation per frame.
 * - `strike` is the local point the tool bites (front face, about chest height); `radius` is the footprint radius
 *   for the harvest zone. Everything fits inside 3.2 × 3.2 m and 3.4 m height, the anim mesh included.
 * - Geometry is built once per era and shared by every instance.
 *
 * Every model is listed in `eraNodeCatalog` (gallery: --query gallery=eraNodes).
 */
import * as THREE from 'three';
import type { MaterialKind } from '../core/kinds';
import { vcMat } from '../render/batch';
import { SNOW, SNOW_SH, Kit, eraGlowMaterial, hcyl, seeded, type V3 } from './eraKit';

// ---------------------------------------------------------------------------
// what each node is (names match docs/EXPANSION.md section D and docs/art/era-NN.json)
// ---------------------------------------------------------------------------

export interface EraNodeDef {
  era: number;
  /** Display name (the art spec's node name). */
  name: string;
  /** The raw material one harvest yields (section D: the era's first raw material). */
  yields: MaterialKind;
  /** The interact verb shown instead of "Chop". */
  verb: string;
  /** The player's tool upgrade (`${key}Tool`) that swings at this node. */
  tool: string;
}

export const ERA_NODES: Readonly<Record<number, EraNodeDef>> = {
  2: { era: 2, name: 'Great Boulder', yields: 'stone', verb: 'Chip', tool: 'Stone Pick' },
  3: { era: 3, name: 'Ore Vein', yields: 'ore', verb: 'Pick', tool: 'Iron Pick' },
  4: { era: 4, name: 'Coal Seam', yields: 'coal', verb: 'Shovel', tool: 'Coal Shovel' },
  5: { era: 5, name: 'Slag Heap', yields: 'pigIron', verb: 'Break', tool: 'Rivet Hammer' },
  6: { era: 6, name: 'Copper Vein', yields: 'copper', verb: 'Drill', tool: 'Power Drill' },
  7: { era: 7, name: 'Oil Seep', yields: 'crude', verb: 'Drill', tool: 'Ice Auger' },
  8: { era: 8, name: 'Sand Dune', yields: 'silicon', verb: 'Sift', tool: 'Laser Sieve' },
  9: { era: 9, name: 'Uranium Crystal', yields: 'uranium', verb: 'Cut', tool: 'Geiger Tongs' },
  10: { era: 10, name: 'Data Crystal', yields: 'dataShard', verb: 'Tune', tool: 'Nano Wand' },
};

export const NODE_ERAS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10];

// ---------------------------------------------------------------------------
// palette (art spec node colours, warmed per docs/art/guide.md: no clinical white, warm darks, soft glows)
// ---------------------------------------------------------------------------

const STONE = 0xa7a39b;
const STONE_L = 0xc4c0b6;
const STONE_D = 0x8a857c;
const CLAY = 0xb5543c;
const TIMBER = 0x8a5a3b;
const TIMBER_D = 0x5c4028;
const BASALT = 0x57504c;
const HEMATITE = 0x7c4a33;
const ORE_BAND = 0xb0704e;
const IRON = 0x5d6268;
const SANDSTONE = 0x8a8580;
const COAL = 0x34323a;
const SHALE = 0x4a484d;
const BRASS = 0xd49a35;
const SLAG = 0x40444a;
const SLAG_L = 0x8f9296;
const CRUST = 0x5a5f66;
const STEEL = 0x7f8b99;
const MALACHITE = 0x4f7a8c;
const COPPER = 0xc9773a;
const QUARTZ = 0xa3a7a0;
const TAR = 0x3a3330;
const TAR_L = 0x4d4440;
const PERMAFROST = 0x9d9a93;
const HONEY = 0xd99b26;
const CRIMSON = 0xc44536;
const SILICA = 0xd9d4c4;
const SILICA_D = 0xb8b3a4;
const WAFER = 0x8ea2b8;
const PRISM = 0x6fb4d8;
const PITCHBLENDE = 0x3d4a38;
const URANIUM = 0x7bd04a;
const URANIUM_L = 0x9de070;
const PEWTER = 0x8fa1b3;
const CREAM = 0xf5f0e6;
const SLATE = 0x526475;
const LAVENDER = 0xb48cff;
const GOLD = 0xe8a848;

// glow tints (vertex colour × the shared emissive material)
const G_HEARTH = 0xffb347;
const G_EMBER = 0xff9233;
const G_STEAM = 0xffbe55;
const G_MOLTEN = 0xffd166;
const G_TEAL = 0x7ce8c8;
const G_OIL = 0xffaa5a;
const G_MINT = 0x66e0a3;
const G_NUCLEAR = 0x70f5d9;
const G_SUN = 0xffe082;

// ---------------------------------------------------------------------------
// recipe framework
// ---------------------------------------------------------------------------

/**
 * The harvest effect of the anim mesh. `f` below is the reaction progress 0..1 after a hit.
 * - pop: hidden idle; a chunk hops out toward the player (+Z, arc up then down) and shrinks away.
 * - burst: hidden idle; a cluster of sparks spreads outward (scale) on a short arc and fades.
 * - rise: hidden idle; a puff rises `amp` m and shrinks.
 * - thump: always shown; the part lifts `amp` m and drops back with a small bounce.
 * - crackle: hidden idle; an arc flickers on and off, jumping to a new angle each flicker.
 * - plunge: always shown; the part drives down `amp` m while spinning, then backs out.
 * - orbit: always shown; spins slowly (`idle` turns/s), fast on a hit while lifting `amp` m. `tilt` tips the ring.
 * - pulse: always shown; breathes gently, swells to (1 + amp) on a hit and settles.
 */
type AnimMode = 'pop' | 'burst' | 'rise' | 'thump' | 'crackle' | 'plunge' | 'orbit' | 'pulse';

interface AnimSpec {
  mode: AnimMode;
  /** Pivot position (local to the node root). */
  at: V3;
  amp: number;
  /** Reaction length in seconds. */
  dur: number;
  /** Idle turns per second (orbit) or breaths per second (pulse). */
  idle?: number;
  /** Ring tilt in radians (orbit). */
  tilt?: number;
  /** Paint the anim mesh with the shared glow material. */
  glow?: boolean;
}

interface NodeParts {
  body: Kit;
  glow: Kit;
  anim: Kit;
}

interface NodeRecipe {
  build(p: NodeParts): AnimSpec;
  /** Point the tool bites (front face). */
  strike: V3;
}

/** Soft snow drifts and pebbles round the foot of a node. */
function foot(k: Kit, r: number, pebble: number, seed: number): void {
  const rnd = seeded(seed);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.6;
    k.sph(i % 2 ? SNOW : SNOW_SH, 0.32 + rnd() * 0.12, Math.cos(a) * r, 0.04, Math.sin(a) * r, { sy: 0.4 });
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.85 + rnd() * 0.25);
    k.sph(pebble, 0.1 + rnd() * 0.06, Math.cos(a) * d, 0.06, Math.sin(a) * d, { sy: 0.7 });
  }
}

/** Rounded snow cap (squashed sphere) centred at y. */
function cap(k: Kit, w: number, d: number, x: number, y: number, z: number): void {
  k.sph(SNOW, 0.5, x, y, z, { sx: w, sy: 0.36, sz: d });
}

// ---------------------------------------------------------------------------
// era 2 — Great Boulder: fieldstone with a clay ledge; a stone flake pops off
// ---------------------------------------------------------------------------

const greatBoulder: NodeRecipe = {
  strike: [0.15, 0.85, 1.05],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.1, STONE_D, 2);
    b.sph(STONE, 1, 0, 0.88, 0, { sx: 1.2, sy: 0.92, sz: 1.08 });
    b.sph(STONE_D, 0.5, -0.8, 0.55, -0.35, { sx: 0.95, sy: 0.85, sz: 0.8, ry: 0.4 });
    b.box(CLAY, 1.3, 0.42, 1.0, 0.62, 0.12, 0.48, { ry: -0.25 });
    b.sph(0xc4674c, 0.36, 0.86, 0.6, 0.56, { sx: 1.2, sy: 0.4, sz: 1.0 });
    // chisel notch on the front face: lighter fresh stone where the pick bites
    b.box(STONE_L, 0.6, 0.42, 0.18, 0.12, 0.66, 0.96, { rx: -0.25 });
    b.box(0x6f6a62, 0.5, 0.05, 0.05, 0.12, 0.88, 1.0);
    cap(b, 1.9, 1.6, -0.08, 1.72, -0.06);
    cap(b, 0.7, 0.5, -0.8, 1.02, -0.4);
    // cosy stake lantern
    b.beam(TIMBER, [-1.2, 0, 0.75], [-1.2, 1.25, 0.75], 0.1);
    b.box(TIMBER_D, 0.26, 0.06, 0.26, -1.2, 1.25, 0.75);
    g.box(G_HEARTH, 0.18, 0.22, 0.18, -1.2, 1.31, 0.75);
    b.cone(TIMBER_D, 0.2, 0.16, -1.2, 1.53, 0.75, 4);
    // anim: the flake that pops off
    a.box(STONE_L, 0.38, 0.26, 0.3, 0, -0.13, 0, { rx: 0.3, ry: 0.5 });
    a.box(STONE, 0.2, 0.14, 0.16, 0.22, -0.02, 0.05, { ry: 0.9 });
    return { mode: 'pop', at: [0.15, 0.8, 1.05], amp: 0.55, dur: 0.6 };
  },
};

// ---------------------------------------------------------------------------
// era 3 — Ore Vein: basalt with a banded rust seam in a timber adit; rust sparks spray
// ---------------------------------------------------------------------------

const oreVein: NodeRecipe = {
  strike: [-0.1, 0.9, 1.0],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.1, BASALT, 3);
    b.sph(BASALT, 1, 0, 0.82, -0.05, { sx: 1.15, sy: 0.85, sz: 1.05 });
    b.sph(HEMATITE, 0.6, 0.62, 0.58, 0.42, { sx: 1.1, sy: 0.8, sz: 0.95 });
    // banded ore seam across the front, three warm stripes
    for (let i = 0; i < 3; i++) b.box(i === 1 ? HEMATITE : ORE_BAND, 1.5, 0.12, 0.35, -0.15, 0.62 + i * 0.16, 0.82, { rx: -0.35, rz: 0.12 });
    // little timber adit frame round the seam
    for (const x of [-0.95, 0.75]) b.beam(TIMBER, [x, 0, 1.0], [x, 1.35, 0.95], 0.16);
    b.box(TIMBER_D, 1.95, 0.18, 0.22, -0.1, 1.35, 0.95);
    b.snow(-0.1, 1.53, 0.95, 1.85, 0.2, 0.08);
    cap(b, 1.75, 1.5, -0.05, 1.6, -0.15);
    // glowing ember flecks in the seam
    for (const [x, y] of [[-0.6, 0.8], [0.05, 0.98], [0.42, 0.72]] as const) g.box(G_EMBER, 0.12, 0.08, 0.06, x, y, 0.97);
    // anim: a fan of rust sparks and iron nuggets, spread by scaling
    const rnd = seeded(31);
    for (let i = 0; i < 9; i++) {
      const ang = -Math.PI * 0.9 + (i / 8) * Math.PI * 0.8;
      const r = 0.35 + rnd() * 0.15;
      a.box(i % 3 ? G_EMBER : G_MOLTEN, 0.08, 0.08, 0.08, Math.cos(ang) * r, 0.1 + rnd() * 0.25, Math.abs(Math.sin(ang)) * 0.3 + 0.1, { ry: rnd() * 3 });
    }
    return { mode: 'burst', at: [-0.1, 0.85, 0.9], amp: 0.45, dur: 0.5, glow: true };
  },
};

// ---------------------------------------------------------------------------
// era 4 — Coal Seam: sandstone bank with a black anthracite ledge and a brass lamp; soot puffs up
// ---------------------------------------------------------------------------

const coalSeam: NodeRecipe = {
  strike: [0.35, 0.75, 1.0],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.1, COAL, 4);
    b.sph(SANDSTONE, 1, 0, 0.78, -0.1, { sx: 1.12, sy: 0.82, sz: 1.0 });
    // stepped anthracite ledge with glinting facets
    b.box(COAL, 1.45, 0.5, 1.0, 0.4, 0.1, 0.45, { ry: -0.15 });
    b.box(SHALE, 1.1, 0.36, 0.8, 0.35, 0.6, 0.35, { ry: -0.1 });
    b.box(0x55535a, 0.3, 0.12, 0.08, 0.6, 0.48, 0.95, { rz: 0.4 });
    b.box(0x55535a, 0.22, 0.1, 0.08, 0.1, 0.32, 0.97, { rz: -0.3 });
    b.box(SHALE, 0.9, 0.5, 0.7, -0.62, 0.45, -0.25, { ry: 0.5 });
    cap(b, 1.6, 1.35, -0.05, 1.5, -0.2);
    b.snow(0.35, 0.96, 0.35, 0.9, 0.6, 0.08);
    // coal lumps spilled in front
    for (const [x, z, r] of [[0.9, 1.05, 0.14], [1.15, 0.8, 0.11], [0.62, 1.2, 0.1]] as const) b.sph(COAL, r, x, r * 0.8, z, { sy: 0.8 });
    // brass miner's lamp on a hook post
    b.beam(TIMBER_D, [-1.15, 0, 0.6], [-1.15, 1.3, 0.6], 0.1);
    b.beam(TIMBER_D, [-1.15, 1.3, 0.6], [-0.85, 1.3, 0.6], 0.06);
    b.cyl(BRASS, 0.11, 0.06, -0.85, 1.0, 0.6, 8);
    g.cyl(G_STEAM, 0.08, 0.2, -0.85, 1.06, 0.6, 8);
    b.cone(BRASS, 0.12, 0.1, -0.85, 1.26, 0.6, 8);
    // anim: a soft soot puff
    a.sph(0x8f8a86, 0.28, 0, 0, 0);
    a.sph(0xa29d98, 0.2, 0.2, 0.15, 0.05);
    a.sph(0x7d7874, 0.18, -0.18, 0.1, -0.05);
    return { mode: 'rise', at: [0.35, 0.9, 0.95], amp: 1.1, dur: 0.9 };
  },
};

// ---------------------------------------------------------------------------
// era 5 — Slag Heap: cooled steel-mill slag with glowing seams; the crust lid thumps and drops
// ---------------------------------------------------------------------------

const slagHeap: NodeRecipe = {
  strike: [0.0, 0.7, 1.05],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.1, SLAG, 5);
    b.cone(SLAG, 1.3, 1.25, 0, 0, -0.05, 9);
    b.sph(SLAG, 1, 0, 0.55, -0.05, { sx: 1.2, sy: 0.55, sz: 1.1 });
    b.box(SLAG_L, 1.2, 0.6, 0.9, 0.5, 0.25, -0.35, { ry: 0.6 });
    // warm molten seams (glow) zigzagging down the front
    for (const [x, y, r] of [[-0.35, 0.45, 0.5], [0.1, 0.62, -0.4], [0.45, 0.4, 0.35], [-0.1, 0.25, -0.2]] as const) g.box(G_MOLTEN, 0.42, 0.07, 0.07, x, y, 1.0 - Math.abs(x) * 0.25, { rz: r });
    g.box(G_EMBER, 0.3, 0.07, 0.07, 0.3, 0.85, 0.75, { rz: 0.5 });
    // steel rake left leaning on the heap (the Slag Raker's tool)
    b.beam(STEEL, [-1.2, 0, 0.8], [-0.55, 1.1, 0.35], 0.07);
    b.box(STEEL, 0.5, 0.08, 0.1, -1.24, 0.04, 0.82, { ry: 0.6 });
    cap(b, 1.2, 1.0, 0, 1.24, -0.05);
    // anim: the calcined crust lid (snow-dusted) that lifts and slams
    a.box(CRUST, 1.1, 0.24, 0.8, 0, 0, 0, { rx: -0.3 });
    a.sph(SNOW, 0.42, 0, 0.26, -0.05, { sx: 1.1, sy: 0.3, sz: 0.85, rx: -0.3 });
    a.box(0x50555b, 0.4, 0.14, 0.3, 0.3, 0.18, 0.15, { rx: -0.3, ry: 0.3 });
    return { mode: 'thump', at: [-0.05, 0.62, 0.62], amp: 0.4, dur: 0.55 };
  },
};

// ---------------------------------------------------------------------------
// era 6 — Copper Vein: malachite rock with a native copper ribbon and a quartz ledge; a teal arc crackles
// ---------------------------------------------------------------------------

const copperVein: NodeRecipe = {
  strike: [0.35, 0.85, 1.0],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.1, QUARTZ, 6);
    b.sph(MALACHITE, 1, 0, 0.85, -0.05, { sx: 1.15, sy: 0.85, sz: 1.05 });
    b.sph(0x3d6a6e, 0.5, -0.7, 0.55, 0.3, { sx: 1, sy: 0.8, sz: 0.9 });
    // copper ribbon winding across the front, then a few native nuggets
    for (let i = 0; i < 5; i++) b.box(COPPER, 0.42, 0.16, 0.22, -0.55 + i * 0.32, 0.55 + Math.sin(i * 1.3) * 0.15 + i * 0.07, 0.88 - Math.abs(i - 2) * 0.05, { rz: 0.4 - i * 0.2, rx: -0.3 });
    for (const [x, y, z] of [[0.75, 0.42, 0.85], [0.55, 1.05, 0.7]] as const) b.sph(0xe08a45, 0.13, x, y, z);
    b.box(QUARTZ, 0.9, 0.62, 0.7, -0.62, 0.7, -0.45, { ry: 0.4 });
    b.cone(0xc4c8c0, 0.18, 0.45, -0.85, 1.3, -0.4, 6);
    b.cone(0xc4c8c0, 0.13, 0.32, -0.55, 1.3, -0.6, 6);
    cap(b, 1.7, 1.45, 0, 1.65, -0.1);
    // teal glints in the malachite
    for (const [x, y, z] of [[-0.4, 1.0, 0.85], [0.2, 1.25, 0.72], [0.85, 0.75, 0.62]] as const) g.sph(G_TEAL, 0.07, x, y, z);
    // anim: a zigzag spark arc (glow)
    const pts: V3[] = [[-0.5, 0, 0], [-0.3, 0.18, 0.02], [-0.12, -0.05, 0.04], [0.08, 0.2, 0.02], [0.28, 0.0, 0.0], [0.5, 0.15, 0]];
    for (let i = 0; i < pts.length - 1; i++) a.beam(G_TEAL, pts[i]!, pts[i + 1]!, 0.05);
    a.sph(G_TEAL, 0.09, 0.5, 0.15, 0);
    a.sph(G_TEAL, 0.09, -0.5, 0, 0);
    return { mode: 'crackle', at: [0.3, 0.9, 1.0], amp: 0.5, dur: 0.45, glow: true };
  },
};

// ---------------------------------------------------------------------------
// era 7 — Oil Seep: tar mound and a pitch pool in the permafrost, a little drill tripod; the auger drills in
// ---------------------------------------------------------------------------

const oilSeep: NodeRecipe = {
  strike: [0.2, 0.7, 1.05],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.1, PERMAFROST, 7);
    b.sph(TAR, 1, -0.2, 0.62, -0.35, { sx: 1.0, sy: 0.7, sz: 0.85 });
    b.box(PERMAFROST, 1.3, 0.5, 1.0, 0.55, 0.0, -0.45, { ry: 0.3 });
    cap(b, 1.2, 0.95, 0.55, 0.58, -0.45);
    cap(b, 1.4, 1.1, -0.25, 1.22, -0.4);
    // frozen crust ring and the glossy pitch pool in front
    b.cyl(PERMAFROST, 0.85, 0.22, 0.2, 0, 0.45, 12, 0.8);
    b.cyl(TAR_L, 0.66, 0.06, 0.2, 0.2, 0.45, 12);
    b.sph(0x5a4f49, 0.12, 0.45, 0.27, 0.6, { sy: 0.45 });
    b.sph(0x5a4f49, 0.08, -0.05, 0.27, 0.25, { sy: 0.45 });
    // honey-yellow drill tripod straddling the pool
    for (const ang of [0.3, 2.4, 4.4]) b.beam(HONEY, [0.2 + Math.cos(ang) * 0.95, 0, 0.45 + Math.sin(ang) * 0.95], [0.2, 2.0, 0.45], 0.1);
    b.cyl(CRIMSON, 0.16, 0.2, 0.2, 1.92, 0.45, 8);
    b.cyl(SNOW, 0.13, 0.06, 0.2, 2.12, 0.45, 8);
    // crimson pipe stub and a lantern
    hcyl(b, CRIMSON, 0.09, 0.8, 1.05, 0.3, -0.1, 'x', 8);
    b.box(TIMBER_D, 0.2, 0.06, 0.2, -1.05, 0.0, 0.85);
    b.beam(0x575552, [-1.05, 0, 0.85], [-1.05, 1.0, 0.85], 0.08);
    g.sph(G_OIL, 0.13, -1.05, 1.08, 0.85);
    g.torus(G_OIL, 0.62, 0.03, 0.2, 0.27, 0.45, { rx: Math.PI / 2 }, 20);
    // anim: the auger (shaft + spiral flights + crank), hanging from the tripod head
    a.cyl(0x6e7078, 0.05, 1.6, 0, -1.6, 0, 8);
    for (let i = 0; i < 4; i++) a.torus(HONEY, 0.13, 0.035, 0, -1.5 + i * 0.22, 0, { rx: Math.PI / 2 + 0.35, ry: i * 1.6 }, 10);
    a.cone(0x6e7078, 0.07, 0.16, 0, -1.76, 0, 6, { rx: Math.PI });
    a.beam(CRIMSON, [-0.32, 0.0, 0], [0.32, 0.0, 0], 0.07);
    a.sph(CRIMSON, 0.07, 0.32, 0.0, 0);
    return { mode: 'plunge', at: [0.2, 1.88, 0.45], amp: 0.4, dur: 0.7 };
  },
};

// ---------------------------------------------------------------------------
// era 8 — Sand Dune: a snowy silica dune with wafer ledges and quartz prisms; mint glints swirl up
// ---------------------------------------------------------------------------

const sandDune: NodeRecipe = {
  strike: [-0.2, 0.6, 1.1],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.12, SILICA_D, 8);
    b.sph(SILICA, 1, 0, 0.6, -0.1, { sx: 1.25, sy: 0.75, sz: 1.05 });
    b.sph(SILICA_D, 0.6, 0.6, 0.4, 0.4, { sx: 1.2, sy: 0.6, sz: 0.9 });
    // ripple lines on the dune face
    for (let i = 0; i < 3; i++) b.box(SILICA_D, 1.1 - i * 0.2, 0.05, 0.08, -0.25, 0.35 + i * 0.22, 0.98 - i * 0.12, { rx: -0.6 });
    // wafer-like monocrystal ledge and quartz prisms
    b.box(WAFER, 0.9, 0.12, 0.7, 0.65, 0.62, 0.15, { ry: 0.3, rz: -0.12 });
    b.box(0xa9b8c8, 0.7, 0.1, 0.55, 0.62, 0.74, 0.12, { ry: 0.5, rz: -0.12 });
    b.cone(PRISM, 0.24, 0.8, -0.65, 0.7, -0.3, 6);
    b.cone(0x8cc6e0, 0.16, 0.55, -0.4, 0.75, -0.55, 6);
    b.cone(PRISM, 0.12, 0.38, -0.88, 0.75, -0.6, 6);
    cap(b, 1.6, 1.3, 0.1, 1.2, -0.2);
    // mint lamp post (retro beige)
    b.cyl(0xe6dec8, 0.07, 1.2, 1.1, 0, 0.8, 8);
    g.sph(G_MINT, 0.14, 1.1, 1.3, 0.8);
    g.sph(G_MINT, 0.06, -0.62, 1.48, -0.3);
    // anim: a ring of glinting silica crystals orbiting the dune
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      a.cone(i % 2 ? G_MINT : 0xbff5dc, 0.07, 0.18, Math.cos(ang) * 0.95, -0.09 + (i % 2) * 0.12, Math.sin(ang) * 0.95, 4);
    }
    return { mode: 'orbit', at: [0, 0.9, -0.1], amp: 0.35, dur: 0.8, idle: 0.08, glow: true };
  },
};

// ---------------------------------------------------------------------------
// era 9 — Uranium Crystal: pitchblende with green autunite spires; a mint halo pulses out
// ---------------------------------------------------------------------------

const uraniumCrystal: NodeRecipe = {
  strike: [-0.25, 0.75, 1.0],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.12, PITCHBLENDE, 9);
    b.sph(PITCHBLENDE, 1, 0, 0.75, -0.05, { sx: 1.1, sy: 0.75, sz: 1.0 });
    // crystal spires (body) with glowing tips (glow)
    for (const [x, z, r, h, tilt] of [[0.35, 0.25, 0.4, 1.3, 0.15], [-0.55, -0.25, 0.28, 0.95, -0.25], [0.75, -0.35, 0.22, 0.7, 0.35], [-0.1, 0.62, 0.2, 0.55, 0.25]] as const) {
      b.cone(URANIUM, r, h, x, 0.75, z, 6, { rz: tilt });
      g.cone(G_NUCLEAR, r * 0.45, h * 0.35, x - Math.sin(tilt) * h * 0.62, 0.75 + h * 0.62, z, 6, { rz: tilt });
    }
    b.cone(URANIUM_L, 0.14, 0.4, -0.65, 0.35, 0.75, 6, { rz: 0.5 });
    // hazard-free cosy warning post: pewter post with a mint lamp
    b.beam(PEWTER, [1.15, 0, 0.75], [1.15, 1.1, 0.75], 0.09);
    b.box(0x3d5259, 0.3, 0.3, 0.06, 1.15, 0.75, 0.8);
    g.sph(G_NUCLEAR, 0.1, 1.15, 1.18, 0.75);
    cap(b, 1.3, 1.05, -0.25, 1.42, -0.2);
    cap(b, 0.5, 0.4, 0.6, 0.95, 0.5);
    // anim: the halo ring (glow), lying flat round the crystal
    a.torus(G_NUCLEAR, 1.15, 0.045, 0, 0, 0, { rx: Math.PI / 2 }, 28);
    return { mode: 'pulse', at: [0, 0.5, 0], amp: 0.18, dur: 0.7, idle: 0.35, glow: true };
  },
};

// ---------------------------------------------------------------------------
// era 10 — Data Crystal: a cream-and-slate monolith with a lavender quantum shard; a gold ribbon spins up
// ---------------------------------------------------------------------------

const dataCrystal: NodeRecipe = {
  strike: [0, 0.95, 0.95],
  build: ({ body: b, glow: g, anim: a }) => {
    foot(b, 1.12, PEWTER, 10);
    // stepped plinth and tapering monolith
    b.box(SLATE, 1.9, 0.25, 1.9, 0, 0, 0);
    b.box(PEWTER, 1.6, 0.2, 1.6, 0, 0.25, 0);
    b.cyl(CREAM, 0.95, 1.75, 0, 0.45, 0, 4, 0.7, { ry: Math.PI / 4 });
    b.cyl(SLATE, 0.98, 0.12, 0, 0.9, 0, 4, 0.94, { ry: Math.PI / 4 });
    b.cyl(SLATE, 0.86, 0.12, 0, 1.6, 0, 4, 0.82, { ry: Math.PI / 4 });
    cap(b, 1.1, 1.1, 0, 2.22, 0);
    // quantum shard rising out of the front face, gold collar
    b.cone(LAVENDER, 0.38, 1.3, 0.2, 1.25, 0.55, 6, { rx: 0.35 });
    b.torus(GOLD, 0.34, 0.06, 0.2, 1.3, 0.55, { rx: Math.PI / 2 + 0.35 }, 14);
    // gold filigree circuit lines (glow) on the faces
    for (const s of [-1, 1]) {
      g.box(G_SUN, 0.06, 0.6, 0.04, s * 0.45, 0.95, 0.6);
      g.box(G_SUN, 0.32, 0.06, 0.04, s * 0.3, 1.25, 0.6);
    }
    g.sph(G_SUN, 0.12, 0.2, 2.42, 0.86);
    // anim: the harmonic light ribbon (glow), tilted, spinning round the monolith
    a.torus(G_SUN, 1.2, 0.05, 0, 0, 0, { rx: Math.PI / 2 }, 28);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      a.sph(0xe4d4ff, 0.09, Math.cos(ang) * 1.2, 0, Math.sin(ang) * 1.2);
    }
    return { mode: 'orbit', at: [0, 1.45, 0], amp: 0.35, dur: 0.8, idle: 0.12, tilt: 0.3, glow: true };
  },
};

const RECIPES: Readonly<Record<number, NodeRecipe>> = {
  2: greatBoulder,
  3: oreVein,
  4: coalSeam,
  5: slagHeap,
  6: copperVein,
  7: oilSeep,
  8: sandDune,
  9: uraniumCrystal,
  10: dataCrystal,
};

// ---------------------------------------------------------------------------
// building + animating
// ---------------------------------------------------------------------------

interface BuiltNode {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  anim: THREE.BufferGeometry;
  spec: AnimSpec;
  radius: number;
}

const builtCache = new Map<number, BuiltNode>();

function buildNode(era: number): BuiltNode {
  let built = builtCache.get(era);
  if (built) return built;
  const recipe = RECIPES[era];
  if (!recipe) throw new Error(`no hand node for era ${era}`);
  const parts: NodeParts = { body: new Kit(), glow: new Kit(), anim: new Kit() };
  const spec = recipe.build(parts);
  const body = parts.body.geometry();
  const glow = parts.glow.batch.empty ? null : parts.glow.geometry();
  const anim = parts.anim.geometry();
  const box = new THREE.Box3().copy(body.boundingBox!);
  if (glow) box.union(glow.boundingBox!);
  const size = box.getSize(new THREE.Vector3());
  built = { body, glow, anim, spec, radius: Math.ceil(Math.max(size.x, size.z) * 5) / 10 };
  builtCache.set(era, built);
  return built;
}

export interface NodeModel {
  root: THREE.Group;
  def: EraNodeDef;
  /** Footprint radius (m) for the harvest zone. */
  radius: number;
  /** Local point the tool bites. */
  strike: THREE.Vector3;
  /** Start one harvest reaction (squash wobble + the era's effect). */
  hit(): void;
  /** Idle motion and any running reaction. */
  animate(dt: number): void;
}

const TAU = Math.PI * 2;

/** Build era n's hand node (n = 2..10). Geometry is shared between instances. */
export function createNodeModel(era: number): NodeModel {
  const built = buildNode(era);
  const spec = built.spec;
  const root = new THREE.Group();
  root.name = `node:${era}`;
  const shake = new THREE.Group();
  shake.name = 'shake';
  root.add(shake);
  const body = new THREE.Mesh(built.body, vcMat());
  body.name = 'body';
  body.castShadow = true;
  body.receiveShadow = true;
  shake.add(body);
  if (built.glow) {
    const g = new THREE.Mesh(built.glow, eraGlowMaterial());
    g.name = 'glow';
    shake.add(g);
  }
  const anim = new THREE.Mesh(built.anim, spec.glow ? eraGlowMaterial() : vcMat());
  anim.name = 'anim';
  anim.castShadow = !spec.glow && spec.mode !== 'rise';
  anim.position.set(...spec.at);
  const hiddenIdle = spec.mode === 'pop' || spec.mode === 'burst' || spec.mode === 'rise' || spec.mode === 'crackle';
  anim.visible = !hiddenIdle;
  if (spec.tilt) anim.rotation.x = spec.tilt;
  root.add(anim);

  // squash: a damped bounce after each hit (analytic, so any frame rate is stable)
  let sqT = Infinity;
  let hitT = Infinity;
  let time = 0;
  let spin = 0;
  let hits = 0;
  const [ax, ay, az] = spec.at;

  const hit = (): void => {
    sqT = 0;
    hitT = 0;
    hits++;
  };

  const animate = (dt: number): void => {
    time += dt;
    // body squash: down-and-out, damped
    let sq = 0;
    if (sqT !== Infinity) {
      sqT += dt;
      sq = sqT < 1.2 ? Math.exp(-6 * sqT) * Math.sin(16 * sqT + 0.3) : 0;
      if (sqT >= 1.2) sqT = Infinity;
    }
    shake.scale.set(1 + sq * 0.05, 1 - sq * 0.08, 1 + sq * 0.05);
    shake.rotation.z = sq * 0.04 * (hits % 2 ? 1 : -1);

    if (hitT !== Infinity) hitT += dt;
    const active = hitT < spec.dur;
    const f = active ? hitT / spec.dur : 1;
    const amp = spec.amp;
    switch (spec.mode) {
      case 'pop': {
        anim.visible = active;
        if (!active) break;
        anim.position.set(ax + f * 0.15, ay + Math.sin(f * Math.PI) * amp - f * 0.5, az + f * 0.65);
        anim.rotation.set(f * 3, f * 2, 0);
        anim.scale.setScalar(1 - f * f * 0.8);
        break;
      }
      case 'burst': {
        anim.visible = active;
        if (!active) break;
        anim.position.set(ax, ay + Math.sin(f * Math.PI) * amp * 0.6, az + f * 0.2);
        anim.scale.setScalar(0.5 + f * 1.1);
        anim.rotation.y = f * 0.6;
        break;
      }
      case 'rise': {
        anim.visible = active;
        if (!active) break;
        anim.position.set(ax, ay + f * amp, az);
        anim.scale.setScalar(0.6 + Math.sin(f * Math.PI) * 0.7 - f * 0.3);
        break;
      }
      case 'thump': {
        // lift, slam, a little bounce
        const h = active ? (f < 0.6 ? Math.sin((f / 0.6) * Math.PI) : Math.sin(((f - 0.6) / 0.4) * Math.PI) * 0.25) : 0;
        anim.position.y = ay + h * amp;
        anim.rotation.z = h * 0.12;
        break;
      }
      case 'crackle': {
        const on = active && Math.floor(hitT * 22) % 3 !== 2;
        anim.visible = on;
        if (!on) break;
        const k = Math.floor(hitT * 22);
        anim.rotation.set(Math.sin(k * 1.7) * 0.5, k * 2.4, Math.sin(k * 0.9) * 0.6);
        anim.scale.setScalar(0.8 + (k % 3) * 0.25 * (amp / 0.5));
        break;
      }
      case 'plunge': {
        const d = active ? Math.sin(f * Math.PI) : 0;
        anim.position.y = ay - d * amp;
        spin += dt * (active ? 2.5 : 0);
        anim.rotation.y = spin * TAU;
        break;
      }
      case 'orbit': {
        spin += dt * (spec.idle ?? 0.1) * (active ? 1 + 8 * Math.sin(f * Math.PI) : 1);
        anim.rotation.y = spin * TAU;
        anim.position.y = ay + (active ? Math.sin(f * Math.PI) * amp : 0);
        break;
      }
      case 'pulse': {
        const breathe = 1 + Math.sin(time * (spec.idle ?? 0.3) * TAU) * 0.04;
        anim.scale.setScalar(breathe + (active ? Math.sin(f * Math.PI) * amp : 0));
        anim.position.y = ay + (active ? Math.sin(f * Math.PI) * 0.5 : 0);
        break;
      }
    }
  };

  return { root, def: ERA_NODES[era]!, radius: built.radius, strike: new THREE.Vector3(...RECIPES[era]!.strike), hit, animate };
}

// ---------------------------------------------------------------------------
// hand tools (the era analog of createAxe)
// ---------------------------------------------------------------------------

type ToolRecipe = (k: Kit, grow: number, gold: boolean) => void;

const handle = (k: Kit, color: number, len = 0.8, r = 0.034): void => {
  k.cyl(color, r, len, 0, 0.1 - len, 0, 8, r * 0.9);
  k.sph(TIMBER_D, r * 1.4, 0, 0.1, 0);
};

const TOOLS: Readonly<Record<number, ToolRecipe>> = {
  // Stone Pick: timber handle, grey iron head with one point and one chisel
  2: (k, s, gold) => {
    handle(k, TIMBER);
    k.box(gold ? GOLD : 0x8d949c, 0.09 * s, 0.1 * s, 0.4 * s, 0, -0.66, 0);
    k.cone(gold ? GOLD : 0x8d949c, 0.05 * s, 0.18 * s, 0, -0.61, -0.29 * s, 6, { rx: -Math.PI / 2 });
    k.box(STONE_L, 0.12 * s, 0.05, 0.08, 0, -0.64, 0.22 * s);
  },
  // Iron Pick: dark double pick with a brass band
  3: (k, s, gold) => {
    handle(k, 0x6d5a48);
    k.cyl(BRASS, 0.045, 0.06, 0, -0.5, 0, 8);
    k.beam(gold ? GOLD : IRON, [0, -0.62, -0.3 * s], [0, -0.66, 0.3 * s], 0.08 * s);
    k.cone(gold ? GOLD : IRON, 0.045 * s, 0.14, 0, -0.56, -0.36 * s, 6, { rx: -Math.PI / 2 - 0.15 });
    k.cone(gold ? GOLD : IRON, 0.045 * s, 0.14, 0, -0.6, 0.36 * s, 6, { rx: Math.PI / 2 + 0.15 });
  },
  // Coal Shovel: long handle, D grip, wide dished blade facing the swing
  4: (k, s, gold) => {
    handle(k, TIMBER, 0.62);
    k.torus(TIMBER_D, 0.07, 0.022, 0, 0.18, 0, undefined, 10);
    k.cyl(BRASS, 0.045, 0.08, 0, -0.55, 0, 8);
    k.box(gold ? GOLD : 0x4a484d, 0.3 * s, 0.34 * s, 0.04, 0, -0.55 - 0.34 * s, -0.02, { rx: 0.2 });
    k.box(gold ? GOLD : 0x4a484d, 0.04, 0.28 * s, 0.1, -0.15 * s, -0.55 - 0.3 * s, -0.06);
    k.box(gold ? GOLD : 0x4a484d, 0.04, 0.28 * s, 0.1, 0.15 * s, -0.55 - 0.3 * s, -0.06);
  },
  // Rivet Hammer: orange-gripped steel hammer
  5: (k, s, gold) => {
    handle(k, 0x34383d, 0.7);
    k.cyl(0xe08a2b, 0.042, 0.28, 0, -0.18, 0, 8);
    k.box(gold ? GOLD : STEEL, 0.13 * s, 0.13 * s, 0.34 * s, 0, -0.66, 0);
    hcyl(k, gold ? GOLD : 0xb4bdc8, 0.08 * s, 0.06, 0, -0.6, -0.19 * s, 'z', 8);
  },
  // Power Drill: teal body, copper bit leading the swing
  6: (k, s, gold) => {
    handle(k, 0x2b3b39, 0.5, 0.045);
    k.box(0x4c6b68, 0.14, 0.2 * s, 0.34 * s, 0, -0.6, 0.04);
    k.cyl(0xd97f38, 0.06, 0.1, 0, -0.5, 0.2 * s, 8, 0.06, { rx: Math.PI / 2 });
    k.cyl(gold ? GOLD : COPPER, 0.035, 0.24 * s, 0, -0.5, -0.17 * s, 6, 0.02, { rx: -Math.PI / 2 });
    k.cone(gold ? GOLD : COPPER, 0.035, 0.08, 0, -0.5, -0.45 * s, 6, { rx: -Math.PI / 2 });
  },
  // Ice Auger: crimson T-crank, steel shaft, honey-yellow spiral flights at the business end
  7: (k, s, gold) => {
    k.beam(CRIMSON, [0, 0.12, -0.18], [0, 0.12, 0.18], 0.06);
    k.cyl(0x6e7078, 0.03, 0.85, 0, -0.73, 0, 8);
    for (let i = 0; i < 4; i++) k.torus(gold ? GOLD : HONEY, 0.075 * s, 0.022, 0, -0.5 - i * 0.09, 0, { rx: Math.PI / 2 + 0.35, ry: i * 1.6 }, 10);
    k.cone(0x6e7078, 0.04, 0.1, 0, -0.84, 0, 6, { rx: Math.PI });
  },
  // Laser Sieve: beige ring frame with a mint mesh disc
  8: (k, s, gold) => {
    handle(k, 0xe6dec8, 0.55, 0.035);
    k.torus(gold ? GOLD : 0x45858c, 0.2 * s, 0.03, 0, -0.62, -0.05, { rx: 0.25 }, 16);
    k.cyl(0xbff5dc, 0.19 * s, 0.015, 0, -0.63, -0.05, 14, 0.19 * s, { rx: Math.PI / 2 + 0.25 });
  },
  // Geiger Tongs: pewter tongs with a little meter box and a mint window
  9: (k, s, gold) => {
    k.beam(PEWTER, [-0.03, 0.08, 0], [-0.05, -0.75 * s, -0.04], 0.04);
    k.beam(PEWTER, [0.03, 0.08, 0], [0.05, -0.75 * s, -0.04], 0.04);
    k.box(0x3d5259, 0.14, 0.18, 0.1, 0, -0.25, 0.06);
    k.box(G_NUCLEAR, 0.08, 0.06, 0.02, 0, -0.18, 0.115);
    k.box(gold ? GOLD : URANIUM, 0.06, 0.06, 0.08, 0, -0.78 * s, -0.04);
  },
  // Nano Wand: cream wand, gold rings, lavender crystal tip
  10: (k, s, gold) => {
    k.cyl(CREAM, 0.03, 0.7, 0, -0.6, 0, 8, 0.024);
    for (const y of [0.0, -0.3]) k.cyl(GOLD, 0.036, 0.04, 0, y, 0, 8);
    k.cone(gold ? GOLD : LAVENDER, 0.06 * s, 0.22 * s, 0, -0.6 - 0.22 * s, 0, 6, { rx: Math.PI });
    k.torus(GOLD, 0.08 * s, 0.015, 0, -0.62, 0, { rx: Math.PI / 2 }, 12);
  },
};

const toolCache = new Map<string, THREE.BufferGeometry>();

/**
 * Era n's hand tool, same hand frame as `createAxe`: the handle runs along local −Y from the grip, the working end
 * sits at the bottom and leads the swing (local −Z). `tier` = the era's Tool upgrade band (0–5): the head grows a
 * little per band and turns gold from band 4. One mesh, vertex colours, geometry cached per era and band.
 */
export function createNodeTool(era: number, tier = 0): THREE.Group {
  const lv = Math.max(0, Math.min(5, Math.round(tier)));
  const key = `${era}|${lv}`;
  let geometry = toolCache.get(key);
  if (!geometry) {
    const recipe = TOOLS[era];
    if (!recipe) throw new Error(`no hand tool for era ${era}`);
    const k = new Kit();
    recipe(k, 1 + 0.06 * lv, lv >= 4);
    geometry = k.geometry();
    toolCache.set(key, geometry);
  }
  const g = new THREE.Group();
  const m = new THREE.Mesh(geometry, vcMat());
  m.name = 'tool';
  m.castShadow = true;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// gallery catalog (?gallery=eraNodes)
// ---------------------------------------------------------------------------

/** Gallery: a node, and its tool standing on the ground in front of it, mid-reaction so the effect is visible. */
function galleryNode(era: number): THREE.Object3D {
  const node = createNodeModel(era);
  node.hit();
  node.animate(0.25);
  const tool = createNodeTool(era, 0);
  tool.rotation.x = Math.PI;
  tool.position.set(1.0, 0.0, 1.35);
  node.root.add(tool);
  return node.root;
}

const catalog: Record<string, () => THREE.Object3D> = {};
for (const n of NODE_ERAS) catalog[`era${n} ${ERA_NODES[n]!.name}`] = () => galleryNode(n);
for (const n of NODE_ERAS) catalog[`era${n} ${ERA_NODES[n]!.tool} (gold)`] = () => createNodeTool(n, 5);
catalog['era nodes lineup'] = () => {
  const sheet = new THREE.Group();
  sheet.name = 'eraNodesLineup';
  NODE_ERAS.forEach((n, i) => {
    const m = createNodeModel(n);
    m.root.position.x = i * 3.6;
    sheet.add(m.root);
  });
  return sheet;
};
export const eraNodeCatalog: Record<string, () => THREE.Object3D> = catalog;
