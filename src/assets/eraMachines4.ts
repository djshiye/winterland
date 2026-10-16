/**
 * 1.0 expansion: the NEW machines of eras 8, 9 and 10 (docs/art/era-08..10.json on art/ages-spec), as standalone
 * builders. Nothing in the game uses them yet: the era wiring picks them up later through `createEraMachine4(id)`.
 *
 * Art rules (docs/art/guide.md, the ARGON chat guide, whose palettes override guide.json):
 * - Era palettes are the guide's: 8 Computer Age = retro beige + teal + pewter, mint glow; 9 Nuclear = cream ceramic
 *   + sea green + slate, soft teal glow; 10 AI = warm cream + sun gold + slate blue, gold glow. The JSON's cold whites,
 *   lime greens and violets are deliberately NOT used: high-tech stays cozy (warm metals, soft glows, no neon).
 * - Same contract as assets/eraMachines.ts: origin at the floor centre, +Z = front. Exactly three meshes: 'body'
 *   (merged, vertex-coloured), 'glow' (the shared night-registered `eraGlowMaterial()`) and ONE animated 'pivot'
 *   placed at its rotation centre. Footprint ≤ 5.2 × 5.2 m (the bevelled plinth is 4.8 × 4.8), height ≤ 6 m.
 * - The front strip (z > 1.2) is kept clear for the input / output pallets at (∓1.6, +1.8) and the worker at (0, +2.2).
 * - Every pivot moves at least 0.35 m (slides) or turns at a radius of at least 0.6 m (spins and swings).
 */
import * as THREE from 'three';
import { vcMat } from '../render/batch';
import { SNOW, SNOW_SH, Kit, eraGlowMaterial, hcyl, wheel, type V3 } from './eraKit';
import type { MachineModel } from './eraMachines';

export type Era4MachineId =
  | 'goldPanner' | 'boardShop' | 'pcAssembly' | 'atmNetwork'
  | 'graphitePit' | 'batteryPlant' | 'atomicVault'
  | 'quantumLab' | 'quantumBank';

/** Era and role of every machine in this file (roles as in the art spec). */
export const ERA4_MACHINES: Record<Era4MachineId, { era: 8 | 9 | 10; role: 'extractor' | 'processor' | 'premium' | 'cash' }> = {
  goldPanner: { era: 8, role: 'extractor' },
  boardShop: { era: 8, role: 'processor' },
  pcAssembly: { era: 8, role: 'premium' },
  atmNetwork: { era: 8, role: 'cash' },
  graphitePit: { era: 9, role: 'extractor' },
  batteryPlant: { era: 9, role: 'premium' },
  atomicVault: { era: 9, role: 'cash' },
  quantumLab: { era: 10, role: 'premium' },
  quantumBank: { era: 10, role: 'cash' },
};
export const ERA4_MACHINE_IDS = Object.keys(ERA4_MACHINES) as Era4MachineId[];

// ---------------------------------------------------------------------------
// palette (guide table, plus a few warm shades derived from it)
// ---------------------------------------------------------------------------

/** Mix two hex colours (t = 0 → a, 1 → b). */
function mix(a: number, b: number, t: number): number {
  const ca = new THREE.Color(a);
  return ca.lerp(new THREE.Color(b), t).getHex();
}
/** Lighten (f > 1) or darken (f < 1) a hex colour. */
function shade(c: number, f: number): number {
  const col = new THREE.Color(c);
  return new THREE.Color(Math.min(1, col.r * f), Math.min(1, col.g * f), Math.min(1, col.b * f)).getHex();
}

const WARM = 0xe8dcc8; // warm stone used to take the chill off cool grounds
const GOLD = 0xe8b341;
const GOLD_L = 0xf2cd6a;
const GOLD_D = 0xb8862e;
const HONEY = 0xe0a83a; // hazard stripes: honey, never safety neon
const GRAPHITE = 0x3b3a3e;
const PCB = 0x2f6f4e;
const BRASS = 0xc39a52;

interface Pal {
  ground: number;
  body: number;
  bodyD: number;
  accent: number;
  accentL: number;
  trim: number;
  trimL: number;
  glow: number;
}

function pal(ground: number, body: number, accent: number, trim: number, glow: number): Pal {
  return {
    ground: mix(ground, WARM, 0.35),
    body,
    bodyD: shade(body, 0.86),
    accent,
    accentL: shade(accent, 1.25),
    trim,
    trimL: mix(trim, WARM, 0.3),
    glow,
  };
}

const E8 = pal(0xc2ccd6, 0xe6dec8, 0x45858c, 0x4a5259, 0x66e0a3);
const E9 = pal(0xcbd6e0, mix(0xdce3e6, WARM, 0.25), 0x4ea885, 0x3d5259, 0x70f5d9);
const E10 = pal(0xdae3ed, 0xf5f0e6, 0xe8a848, 0x526475, 0xffe082);

// secondary glow tints (multiplied into the shared emissive material)
const G_AMBER = 0xffc070;
const G_PEACH = 0xffb27a;
const G_GOLD = 0xffd56b;

// ---------------------------------------------------------------------------
// framework (mirrors assets/eraMachines.ts so the 0.9 wiring can treat both alike)
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
  /** spin = turn continuously; swing = sine rotation (±amp rad); slide = sine translation (±amp m). */
  mode: 'spin' | 'swing' | 'slide';
  speed: number;
  amp?: number;
  /** Paint the pivot with the shared glow material instead of the toon vertex-colour one. */
  glow?: boolean;
}

type Recipe = (p: Parts) => PivotSpec;

/** Plinth top: everything stands on y = P. */
const P = 0.25;

/** The guide's 4.8 × 4.8 × 0.25 m bevelled plinth, with soft snow drifts at the corners. */
function plinth(k: Kit, color: number): void {
  k.box(shade(color, 0.9), 4.8, 0.17, 4.8, 0, 0, 0);
  k.box(color, 4.64, 0.08, 4.64, 0, 0.17, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) k.sph(SNOW, 0.36, sx * 2.05, P, sz * 2.05, { sy: 0.4 });
}

/** Snow-capped roof slab (0.12 m rounded cap, as the guide asks for every upward face wider than 0.4 m). */
function roof(k: Kit, color: number, w: number, d: number, x: number, y: number, z: number): void {
  k.box(color, w + 0.16, 0.14, d + 0.16, x, y, z);
  k.box(SNOW, w + 0.02, 0.12, d + 0.02, x, y + 0.14, z);
  k.box(SNOW_SH, w + 0.06, 0.04, d + 0.06, x, y + 0.14, z);
}

/** Alternating honey / dark stripes as short slabs along X on a wall facing +Z. */
function stripes(k: Kit, x: number, y: number, z: number, w: number, h: number, dark: number): void {
  const n = Math.max(2, Math.round(w / 0.3));
  for (let i = 0; i < n; i++) k.box(i % 2 ? dark : HONEY, w / n, h, 0.05, x - w / 2 + (i + 0.5) * (w / n), y, z);
}

/** Window: frame in the body kit, pane in the glow kit, on a wall facing +Z. */
function pane(b: Kit, g: Kit, frame: number, glow: number, x: number, y: number, z: number, w: number, h: number): void {
  b.box(frame, w + 0.12, h + 0.12, 0.06, x, y - 0.06, z);
  g.box(glow, w, h, 0.05, x, y, z + 0.04);
}

// ---------------------------------------------------------------------------
// era 8 — Computer Age: retro beige plastics, brushed pewter, teal, mint glow
// ---------------------------------------------------------------------------

/** goldPanner: a terraced sluice where a big spiral panning bowl spins out gold flecks. */
const goldPanner: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E8;
  plinth(b, c.ground);
  // back terrace with a beige control hut and a water tank
  b.box(c.bodyD, 4.5, 0.5, 1.4, 0, P, -1.55);
  b.box(SNOW, 4.4, 0.12, 1.3, 0, P + 0.5, -1.55);
  const tY = P + 0.5;
  b.cyl(c.body, 0.55, 1.6, -1.55, tY, -1.6, 14, 0.5);
  for (const y of [0.35, 1.15]) b.cyl(c.accent, 0.57, 0.12, -1.55, tY + y, -1.6, 14);
  b.dome(c.trimL, 0.52, -1.55, tY + 1.6, -1.6);
  b.sph(SNOW, 0.42, -1.55, tY + 1.86, -1.6, { sy: 0.4 });
  b.box(c.body, 1.3, 1.2, 1.1, 1.5, tY, -1.6);
  b.box(c.accent, 1.34, 0.12, 1.14, 1.5, tY + 0.8, -1.6);
  pane(b, g, c.trim, c.glow, 1.5, tY + 0.35, -1.05, 0.7, 0.36);
  roof(b, c.trim, 1.3, 1.1, 1.5, tY + 1.2, -1.6);
  // floodlamp mast on the hut (the crown)
  b.beam(c.trim, [1.85, tY + 1.45, -1.8], [1.85, 3.9, -1.8], 0.12);
  b.box(c.trimL, 0.5, 0.3, 0.36, 1.85, 3.85, -1.75, { rx: 0.35 });
  g.sph(c.glow, 0.15, 1.85, 3.95, -1.55);
  // water feed: tank → pipe → sluice
  b.beam(c.accent, [-1.55, tY + 0.3, -1.05], [-1.0, P + 1.45, -0.6], 0.18);
  // sluice table on pewter legs, sloping into the bowl
  for (const [x, z] of [[-1.15, -0.85], [-0.45, -0.85], [-1.15, -0.25], [-0.45, -0.25]] as const) b.beam(c.trimL, [x, P, z], [x, P + 1.2, z], 0.1);
  b.box(c.trim, 0.8, 0.12, 1.4, -0.8, P + 1.2, -0.45, { rx: -0.25 });
  b.box(0x8fd0cf, 0.6, 0.04, 1.3, -0.8, P + 1.31, -0.45, { rx: -0.25 });
  // panning basin: a pewter bowl on a beige drum
  b.cyl(c.body, 1.1, 0.7, 0, P, 0.25, 18, 1.05);
  b.cyl(c.accent, 1.12, 0.12, 0, P + 0.2, 0.25, 18);
  b.lathe(c.trim, [[0.0, 0], [0.9, 0.08], [1.15, 0.38], [1.2, 0.42]], 0, P + 0.7, 0.25, 18);
  b.torus(GOLD_D, 1.18, 0.06, 0, P + 1.12, 0.25, { rx: Math.PI / 2 }, 22);
  // gold collection hopper (right) with a pile of nuggets that catches the light
  b.box(GOLD_D, 0.9, 0.55, 0.8, 1.75, P, 0.15);
  b.box(GOLD, 1.0, 0.1, 0.9, 1.75, P + 0.55, 0.15);
  for (const [x, z] of [[1.6, 0.05], [1.85, 0.25], [1.75, -0.05], [1.95, 0.0]] as const) b.sph(GOLD_L, 0.12, x, P + 0.7, z, { sy: 0.7 });
  g.sph(G_GOLD, 0.1, 1.72, P + 0.78, 0.18);
  b.beam(c.trimL, [1.1, P + 1.0, 0.2], [1.5, P + 0.65, 0.15], 0.1);
  // the spinning pan: shallow beige dish with spiral riffles and gold flecks
  p.lathe(c.body, [[0.0, 0], [0.75, 0.04], [0.98, 0.22], [1.0, 0.26]], 0, 0, 0, 18);
  p.cone(c.trimL, 0.18, 0.3, 0, 0.02, 0, 10);
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 5; i++) {
      const r = 0.25 + i * 0.15;
      const a = arm * ((Math.PI * 2) / 3) + i * 0.45;
      p.box(c.accent, 0.2, 0.07, 0.06, Math.cos(a) * r, 0.06 + r * 0.12, Math.sin(a) * r, { ry: -a + Math.PI / 2 });
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1 + 0.4;
    const r = 0.35 + (i % 3) * 0.18;
    p.sph(GOLD_L, 0.06, Math.cos(a) * r, 0.1 + r * 0.1, Math.sin(a) * r);
  }
  return { at: [0, P + 0.78, 0.25], axis: 'y', mode: 'spin', speed: 0.5 };
};

/** boardShop: a two-tier beige hall, a warm solder tunnel and a pick-and-place head bobbing over the belt. */
const boardShop: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E8;
  plinth(b, c.ground);
  // hall: lower tier and a stepped-back upper tier
  b.box(c.body, 4.2, 1.6, 2.4, 0, P, -1.0);
  b.box(c.trim, 4.24, 0.14, 2.44, 0, P, -1.0);
  b.box(c.accent, 4.24, 0.16, 2.44, 0, P + 1.05, -1.0);
  for (const x of [-1.4, -0.45, 0.5, 1.45]) pane(b, g, c.trim, c.glow, x, P + 0.45, 0.2, 0.6, 0.42);
  roof(b, c.trim, 4.2, 2.4, 0, P + 1.6, -1.0);
  const uY = P + 1.86;
  b.box(c.body, 2.4, 0.9, 1.7, 0.75, uY, -1.25);
  b.box(c.accent, 2.44, 0.12, 1.74, 0.75, uY + 0.55, -1.25);
  pane(b, g, c.trim, c.glow, 0.75, uY + 0.2, -0.4, 1.4, 0.26);
  roof(b, c.trim, 2.4, 1.7, 0.75, uY + 0.9, -1.25);
  // nitrogen dewar on the lower roof, scrubber stack on the upper (the crown)
  b.cyl(c.trimL, 0.36, 1.2, -1.35, uY, -1.3, 14, 0.36);
  b.dome(c.trimL, 0.36, -1.35, uY + 1.2, -1.3);
  b.cyl(c.accent, 0.38, 0.1, -1.35, uY + 0.8, -1.3, 14);
  b.sph(SNOW, 0.3, -1.35, uY + 1.5, -1.3, { sy: 0.35 });
  const sY = uY + 1.16;
  b.cyl(c.accent, 0.26, 1.5, 1.5, sY, -1.6, 12, 0.22);
  b.cyl(c.trim, 0.3, 0.14, 1.5, sY + 1.4, -1.6, 12);
  b.cyl(SNOW, 0.2, 0.08, 1.5, sY + 1.54, -1.6, 12);
  // wave-solder chamber with a warm tunnel mouth
  b.box(c.trim, 1.9, 0.85, 0.85, -1.05, P, 0.62);
  b.box(c.accent, 1.94, 0.1, 0.89, -1.05, P + 0.85, 0.62);
  b.box(SNOW, 1.8, 0.12, 0.75, -1.05, P + 0.95, 0.62);
  g.box(G_PEACH, 0.9, 0.34, 0.05, -1.05, P + 0.22, 1.06);
  // conveyor carrying green boards out to the right
  b.box(c.trimL, 2.2, 0.42, 0.62, 1.05, P, 0.72);
  b.box(c.accent, 2.24, 0.06, 0.5, 1.05, P + 0.42, 0.72);
  for (const x of [0.3, 1.0, 1.7]) {
    b.box(PCB, 0.4, 0.05, 0.34, x, P + 0.48, 0.72);
    b.box(GOLD, 0.1, 0.04, 0.08, x - 0.08, P + 0.53, 0.72);
  }
  // gantry frame over the belt
  for (const x of [0.25, 1.85]) b.beam(c.accent, [x, P + 0.42, 0.72], [x, P + 2.25, 0.72], 0.14);
  b.box(c.trim, 1.8, 0.18, 0.24, 1.05, P + 2.18, 0.72);
  g.sph(c.glow, 0.11, 1.85, P + 2.42, 0.72);
  // pick-and-place head: carriage, nozzle and a held chip
  p.box(c.body, 0.5, 0.42, 0.42, 0, -0.21, 0);
  p.box(c.accent, 0.54, 0.08, 0.46, 0, 0.0, 0);
  p.beam(c.trimL, [0, 0.0, 0], [0, 0.55, 0], 0.08);
  p.cone(c.trim, 0.12, 0.22, 0, -0.43, 0, 8, { rx: Math.PI });
  p.box(PCB, 0.2, 0.05, 0.2, 0, -0.5, 0);
  return { at: [1.05, P + 1.45, 0.72], axis: 'y', mode: 'slide', speed: 1.1, amp: 0.38 };
};

/** pcAssembly: a modular assembly bay; a burn-in carousel of little beige PCs turns out front. */
const pcAssembly: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E8;
  plinth(b, c.ground);
  b.box(c.body, 4.3, 2.2, 1.8, 0, P, -1.38);
  b.box(c.trim, 4.34, 0.14, 1.84, 0, P, -1.38);
  b.box(c.accent, 4.34, 0.16, 1.84, 0, P + 1.75, -1.38);
  // test-screen bank: a 3 × 2 wall of soft mint monitors
  for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) pane(b, g, c.trim, c.glow, 0.45 + i * 0.6, P + 0.6 + r * 0.55, -0.47, 0.44, 0.34);
  // big door on the left of the facade
  b.box(c.trim, 1.2, 1.35, 0.06, -1.3, P, -0.46);
  b.box(c.accent, 1.06, 1.22, 0.05, -1.3, P, -0.43);
  roof(b, c.trim, 4.3, 1.8, 0, P + 2.2, -1.38);
  const rY = P + 2.46;
  // HVAC cube with a fan grille, antenna mast with an amber status lamp (the crown)
  b.box(c.trim, 1.2, 0.85, 1.1, -1.2, rY, -1.35);
  b.box(c.trimL, 1.24, 0.1, 1.14, -1.2, rY + 0.5, -1.35);
  b.cyl(c.accent, 0.4, 0.06, -1.2, rY + 0.85, -1.35, 16);
  b.torus(c.trimL, 0.4, 0.05, -1.2, rY + 0.92, -1.35, { rx: Math.PI / 2 }, 16);
  for (let i = 0; i < 4; i++) b.box(c.trim, 0.72, 0.03, 0.06, -1.2, rY + 0.93, -1.35, { ry: (i * Math.PI) / 4 });
  b.beam(c.trimL, [1.4, rY, -1.7], [1.4, rY + 1.9, -1.7], 0.1);
  for (const y of [0.7, 1.3]) b.beam(c.trimL, [1.15, rY + y, -1.7], [1.65, rY + y, -1.7], 0.06);
  b.box(c.body, 0.5, 0.36, 0.36, 0.6, rY, -1.6);
  b.box(SNOW, 0.46, 0.1, 0.32, 0.6, rY + 0.36, -1.6);
  g.sph(G_AMBER, 0.13, 1.4, rY + 2.0, -1.7);
  // packaging conveyor (front right) with boxed computers
  b.box(c.trimL, 2.0, 0.5, 0.7, 1.05, P, 0.55);
  b.box(c.accent, 2.04, 0.06, 0.58, 1.05, P + 0.5, 0.55);
  for (const x of [0.5, 1.3]) {
    b.box(0xcbb894, 0.46, 0.4, 0.42, x, P + 0.56, 0.55);
    b.box(c.accent, 0.48, 0.07, 0.44, x, P + 0.72, 0.55);
  }
  b.box(c.body, 0.4, 0.95, 0.4, 2.05, P, 0.55);
  g.box(c.glow, 0.26, 0.18, 0.05, 2.05, P + 0.65, 0.77);
  // carousel base (static)
  b.cyl(c.trim, 0.88, 0.22, -1.1, P, 0.38, 20);
  b.cyl(c.accent, 0.9, 0.06, -1.1, P + 0.16, 0.38, 20);
  // burn-in carousel: two round shelves of tiny CRT computers around a pewter column
  p.cyl(c.trimL, 0.14, 1.55, 0, 0, 0, 10);
  for (const [y, n, off] of [[0.0, 5, 0], [0.75, 5, 0.6]] as const) {
    p.cyl(c.body, 0.85, 0.08, 0, y, 0, 20);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + off;
      const x = Math.sin(a) * 0.6;
      const z = Math.cos(a) * 0.6;
      p.box(0xeee4cc, 0.32, 0.28, 0.28, x, y + 0.08, z, { ry: a });
      p.box(0x9fe0c0, 0.22, 0.17, 0.03, x + Math.sin(a) * 0.15, y + 0.15, z + Math.cos(a) * 0.15, { ry: a });
    }
  }
  p.cyl(c.accent, 0.3, 0.12, 0, 1.55, 0, 12);
  return { at: [-1.1, P + 0.22, 0.38], axis: 'y', mode: 'spin', speed: 0.33 };
};

/** atmNetwork: a cozy cash kiosk with two satellite ATMs; a big gold coin sign turns on the roof. */
const atmNetwork: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E8;
  plinth(b, c.ground);
  // central kiosk
  b.box(c.body, 2.4, 2.2, 1.8, 0, P, -0.6);
  b.box(c.trim, 2.44, 0.16, 1.84, 0, P, -0.6);
  b.box(c.accent, 2.7, 0.45, 0.75, 0, P + 1.85, 0.05);
  b.box(SNOW, 2.6, 0.12, 0.65, 0, P + 2.3, 0.05);
  pane(b, g, c.trim, c.glow, 0, P + 1.0, 0.31, 1.2, 0.68);
  b.box(c.trimL, 1.0, 0.12, 0.42, 0, P + 0.78, 0.48, { rx: 0.25 });
  g.box(G_AMBER, 0.7, 0.04, 0.26, 0, P + 0.86, 0.5, { rx: 0.25 });
  b.box(c.trim, 0.9, 0.12, 0.08, 0, P + 0.5, 0.33);
  b.box(GOLD, 0.6, 0.04, 0.05, 0, P + 0.54, 0.37);
  roof(b, c.trim, 2.4, 1.8, 0, P + 2.2, -0.6);
  // coin sign post
  b.beam(c.trimL, [0, P + 2.46, -0.6], [0, P + 2.9, -0.6], 0.16);
  // two satellite ATMs linked by low cable conduits
  for (const s of [-1, 1]) {
    const x = s * 1.8;
    b.box(c.body, 0.7, 1.55, 0.6, x, P, -0.5);
    b.box(c.accent, 0.74, 0.18, 0.64, x, P + 1.55, -0.5);
    b.box(SNOW, 0.66, 0.1, 0.56, x, P + 1.73, -0.5);
    pane(b, g, c.trim, c.glow, x, P + 0.85, -0.19, 0.4, 0.3);
    b.box(c.trim, 0.4, 0.06, 0.05, x, P + 0.55, -0.18);
    b.box(c.trimL, 0.35, 0.12, 0.12, s * 1.3, P, -0.5);
  }
  // data antenna (back right)
  b.cyl(c.trimL, 0.07, 1.6, 0.85, P + 2.46, -1.25, 8);
  b.cyl(c.accent, 0.12, 0.1, 0.85, P + 3.2, -1.25, 8);
  g.sph(c.glow, 0.11, 0.85, P + 4.12, -1.25);
  // the turning coin: a fat gold disc with a raised rim and an embossed centre
  hcyl(p, GOLD, 0.66, 0.16, 0, 0, 0, 'z', 22);
  p.torus(GOLD_D, 0.62, 0.06, 0, 0, 0.08, undefined, 22);
  p.torus(GOLD_D, 0.62, 0.06, 0, 0, -0.08, undefined, 22);
  hcyl(p, GOLD_L, 0.36, 0.22, 0, 0, 0, 'z', 16);
  p.box(GOLD_D, 0.1, 0.42, 0.26, 0, 0, 0);
  return { at: [0, P + 3.58, -0.6], axis: 'y', mode: 'spin', speed: 0.35 };
};

// ---------------------------------------------------------------------------
// era 9 — Nuclear Power: cream ceramic, sea green, slate, soft teal glow
// ---------------------------------------------------------------------------

/** graphitePit: a reinforced pit of graphite blocks; a diamond wire saw rises and falls on a gantry. */
const graphitePit: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E9;
  plinth(b, c.ground);
  // reinforced basin: cream rim walls round a dark graphite floor
  b.box(GRAPHITE, 3.0, 0.04, 2.2, 0, P, -0.1);
  for (const [x, z, w, d] of [[0, -1.3, 3.4, 0.25], [-1.6, -0.1, 0.25, 2.6], [1.6, -0.1, 0.25, 2.6]] as const) {
    b.box(c.body, w, 0.45, d, x, P, z);
    b.box(SNOW, w, 0.1, d, x, P + 0.45, z);
  }
  // graphite blocks, stepped
  for (const [x, z, h] of [[-0.9, -0.7, 0.5], [-0.3, -0.75, 0.4], [0.35, -0.7, 0.55], [0.95, -0.65, 0.35], [-0.6, 0.0, 0.3], [0.6, 0.05, 0.28]] as const) {
    b.box(GRAPHITE, 0.52, h, 0.5, x, P + 0.04, z);
    b.box(0x55545a, 0.44, 0.03, 0.42, x, P + 0.04 + h, z);
  }
  // portal gantry spanning the pit
  for (const x of [-1.6, 1.6]) {
    b.box(c.trim, 0.3, 2.5, 0.3, x, P + 0.45, -0.25);
    b.box(c.accent, 0.34, 0.14, 0.34, x, P + 1.2, -0.25);
  }
  b.box(c.trim, 3.6, 0.3, 0.4, 0, P + 2.95, -0.25);
  b.box(c.accent, 3.64, 0.08, 0.44, 0, P + 3.1, -0.25);
  b.box(SNOW, 3.5, 0.12, 0.36, 0, P + 3.25, -0.25);
  // honey hazard railing along the front of the pit, and a soft laser guide line
  for (const x of [-1.3, -0.45, 0.45, 1.3]) b.beam(c.trimL, [x, P, 0.95], [x, P + 0.75, 0.95], 0.07);
  stripes(b, 0, P + 0.62, 0.95, 2.7, 0.14, c.trim);
  g.box(c.glow, 2.4, 0.05, 0.05, 0, P + 0.32, 0.85);
  // dust cyclone on legs (back left), with a duct to the gantry (the crown)
  const cx = -1.75;
  const cz = -1.75;
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]] as const) b.beam(c.trim, [cx + dx, P, cz + dz], [cx + dx * 0.8, P + 1.0, cz + dz * 0.8], 0.08);
  b.cone(c.accent, 0.45, 0.6, cx, P + 0.7, cz, 14, { rx: Math.PI });
  b.cyl(c.body, 0.45, 1.3, cx, P + 1.3, cz, 14);
  b.cyl(c.accent, 0.47, 0.1, cx, P + 1.7, cz, 14);
  b.cyl(c.trim, 0.2, 0.8, cx, P + 2.6, cz, 10);
  b.sph(SNOW, 0.36, cx, P + 2.6, cz, { sy: 0.35 });
  b.beam(c.trimL, [cx + 0.3, P + 2.2, cz + 0.3], [-1.45, P + 2.95, -0.25], 0.14);
  g.sph(c.glow, 0.13, cx, P + 3.5, cz);
  // graphite stack cradle (back right)
  b.box(c.trim, 1.2, 0.2, 0.9, 1.75, P + 0.45, -1.85);
  for (let i = 0; i < 3; i++) b.box(GRAPHITE, 0.95, 0.18, 0.7, 1.75, P + 0.65 + i * 0.19, -1.85);
  b.box(SNOW, 0.9, 0.1, 0.66, 1.75, P + 1.22, -1.85);
  // the saw: carriage, two arms and a taut diamond wire between pulley wheels
  p.box(c.body, 0.8, 0.45, 0.55, 0, -0.1, 0);
  p.box(c.accent, 0.84, 0.1, 0.59, 0, 0.2, 0);
  for (const x of [-0.75, 0.75]) p.beam(c.trimL, [x * 0.5, -0.1, 0], [x, -1.2, 0], 0.1);
  for (const x of [-0.75, 0.75]) wheel(p, 'z', c.trim, c.trimL, x, -1.25, 0, 0.16, 0.04, 4);
  p.beam(GOLD_D, [-0.75, -1.4, 0], [0.75, -1.4, 0], 0.035);
  return { at: [0, P + 2.55, -0.25], axis: 'y', mode: 'slide', speed: 0.7, amp: 0.4 };
};

/** batteryPlant: a cream cell hall with glowing charging racks; a loading arm swings a fat battery cell. */
const batteryPlant: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E9;
  plinth(b, c.ground);
  // hall
  b.box(c.body, 3.5, 2.0, 2.0, -0.45, P, -1.25);
  b.box(c.trim, 3.54, 0.14, 2.04, -0.45, P, -1.25);
  b.box(c.accent, 3.54, 0.16, 2.04, -0.45, P + 1.5, -1.25);
  pane(b, g, c.trim, c.glow, 0.55, P + 0.7, -0.25, 1.0, 0.45);
  roof(b, c.trim, 3.5, 2.0, -0.45, P + 2.0, -1.25);
  // two giant battery cells on the roof (the crown): sea-green jackets, cream bands, brass caps
  const rY = P + 2.26;
  for (const x of [-1.4, -0.35]) {
    b.cyl(c.accent, 0.42, 1.5, x, rY, -1.35, 16);
    b.cyl(c.body, 0.43, 0.22, x, rY + 0.95, -1.35, 16);
    b.cyl(BRASS, 0.18, 0.18, x, rY + 1.5, -1.35, 12);
    b.sph(SNOW, 0.34, x, rY + 1.52, -1.35, { sy: 0.3 });
  }
  b.box(c.body, 0.42, 0.12, 0.15, -0.88, rY + 0.98, -1.35);
  // substation transformer (back right) with fins and ceramic insulators, busway to the roof
  b.box(c.trim, 1.0, 1.4, 0.95, 1.75, P, -1.55);
  for (let i = 0; i < 4; i++) b.box(c.trimL, 0.06, 1.1, 1.0, 1.32 + i * 0.29, P + 0.15, -1.55);
  b.box(SNOW, 0.9, 0.12, 0.85, 1.75, P + 1.4, -1.55);
  for (const z of [-1.85, -1.55, -1.25]) {
    for (let i = 0; i < 3; i++) b.cyl(c.body, 0.1, 0.08, 1.85, P + 1.52 + i * 0.12, z, 8);
    b.sph(BRASS, 0.07, 1.85, P + 1.9, z);
  }
  b.beam(c.accent, [1.85, P + 1.9, -1.25], [1.3, P + 2.05, -0.9], 0.16);
  g.sph(c.glow, 0.12, 1.3, P + 1.55, -1.05);
  // charging racks (front left) with six softly glowing cells
  b.box(c.trim, 2.1, 1.25, 0.8, -1.0, P, 0.45);
  b.box(c.accent, 2.14, 0.1, 0.84, -1.0, P + 1.25, 0.45);
  b.box(SNOW, 2.0, 0.12, 0.74, -1.0, P + 1.35, 0.45);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) pane(b, g, c.trimL, c.glow, -1.65 + i * 0.65, P + 0.25 + r * 0.5, 0.86, 0.38, 0.28);
  // armature post (front right)
  b.cyl(c.trim, 0.3, 0.2, 0.75, P, 0.45, 12);
  b.cyl(c.body, 0.16, 2.1, 0.75, P + 0.2, 0.45, 10);
  b.cyl(c.accent, 0.2, 0.12, 0.75, P + 1.2, 0.45, 10);
  // the swinging armature: an arm, a cable and a fat battery cell in a claw
  p.cyl(c.trim, 0.22, 0.2, 0, -0.05, 0, 12);
  p.beam(c.body, [0, 0.05, 0], [-1.15, 0.15, 0], 0.18);
  p.beam(c.accent, [-0.4, 0.05, 0], [-0.4, 0.35, 0], 0.08);
  p.beam(c.trimL, [-1.15, 0.1, 0], [-1.15, -0.45, 0], 0.05);
  p.box(c.trim, 0.42, 0.08, 0.3, -1.15, -0.53, 0);
  p.cyl(c.accent, 0.17, 0.5, -1.15, -1.05, 0, 12);
  p.cyl(c.body, 0.175, 0.1, -1.15, -0.75, 0, 12);
  p.cyl(BRASS, 0.07, 0.07, -1.15, -0.55, 0, 8);
  return { at: [0.75, P + 2.32, 0.45], axis: 'y', mode: 'swing', speed: 0.42, amp: 0.75 };
};

/** atomicVault: a cream bunker with a round blast door; its big brass wheel handle turns. */
const atomicVault: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E9;
  plinth(b, c.ground);
  // bunker: chamfered by trim edge strips, stepped top
  b.box(c.body, 3.6, 2.5, 2.3, 0, P, -0.85);
  b.box(c.trim, 3.64, 0.16, 2.34, 0, P, -0.85);
  for (const x of [-1.8, 1.8]) b.box(c.bodyD, 0.14, 2.5, 2.34, x, P, -0.85);
  b.box(c.bodyD, 3.0, 0.3, 1.9, 0, P + 2.5, -0.95);
  roof(b, c.trim, 3.0, 1.9, 0, P + 2.8, -0.95);
  stripes(b, 0, P + 2.25, 0.32, 3.0, 0.18, c.trim);
  // round blast door in a slate frame, ringed by a soft teal halo
  const dy = P + 1.15;
  b.torus(c.trim, 1.0, 0.13, 0, dy, 0.38, undefined, 24);
  hcyl(b, BRASS, 0.9, 0.24, 0, dy, 0.42, 'z', 24);
  hcyl(b, shade(BRASS, 0.85), 0.55, 0.06, 0, dy, 0.56, 'z', 20);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.sph(c.trimL, 0.06, Math.cos(a) * 0.78, dy + Math.sin(a) * 0.78, 0.55);
  }
  g.torus(c.glow, 1.16, 0.045, 0, dy, 0.36, undefined, 28);
  // hinges and a dial lamp
  for (const y of [-0.5, 0.5]) b.box(c.trim, 0.2, 0.3, 0.3, -1.0, dy + y, 0.4);
  b.box(c.trim, 0.3, 0.42, 0.12, 1.4, P + 1.5, 0.33);
  g.sph(G_AMBER, 0.1, 1.4, P + 1.78, 0.42);
  // roof vent dome with a sea-green chute (the crown)
  const rY = P + 3.06;
  b.cyl(c.trim, 0.55, 0.3, 0, rY - 0.1, -0.95, 14);
  b.dome(c.body, 0.5, 0, rY + 0.2, -0.95);
  b.cone(c.accent, 0.32, 0.65, 0, rY + 0.6, -0.95, 12);
  b.cyl(c.trim, 0.1, 0.25, 0, rY + 1.2, -0.95, 8);
  g.sph(c.glow, 0.1, 0, rY + 1.5, -0.95);
  b.box(c.trimL, 0.6, 0.3, 0.5, 1.1, rY - 0.1, -1.4);
  b.box(SNOW, 0.56, 0.1, 0.46, 1.1, rY + 0.2, -1.4);
  // gold bar stack by the door (what the vault pays out)
  for (const [x, y] of [[-1.55, 0], [-1.25, 0], [-1.4, 0.16]] as const) b.box(GOLD, 0.28, 0.15, 0.42, x, P + y, 0.75);
  // the wheel handle: rim, hub and spokes in polished brass
  wheel(p, 'z', GOLD_D, c.trim, 0, 0, 0, 0.62, 0.06, 6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    p.sph(GOLD, 0.09, Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.06);
  }
  return { at: [0, dy, 0.68], axis: 'z', mode: 'spin', speed: 0.3 };
};

// ---------------------------------------------------------------------------
// era 10 — AI Era: warm cream ceramic, sun gold, slate blue, gold glow
// ---------------------------------------------------------------------------

/** quantumLab: a tiered ceramic cryostat like a gold chandelier; a tilted harmonic ring spins over it. */
const quantumLab: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E10;
  plinth(b, c.ground);
  b.box(c.trim, 3.8, 0.35, 3.0, 0, P, -0.85);
  b.box(c.trimL, 3.84, 0.06, 3.04, 0, P + 0.3, -0.85);
  const y0 = P + 0.35;
  // cryostat: stacked ceramic tiers with gold filigree rings, a dome on top
  b.lathe(c.body, [[1.15, 0], [1.15, 0.7], [0.98, 0.78], [0.98, 1.4], [0.8, 1.5], [0.8, 2.05], [0.6, 2.15], [0.6, 2.5], [0.0, 2.5]], 0, y0, -0.9, 20);
  for (const [y, r] of [[0.72, 1.07], [1.45, 0.9], [2.1, 0.7]] as const) b.torus(c.accent, r, 0.07, 0, y0 + y, -0.9, { rx: Math.PI / 2 }, 24);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box(GOLD_L, 0.05, 0.5, 0.05, Math.cos(a) * 0.99, y0 + 0.78, -0.9 + Math.sin(a) * 0.99);
  }
  b.dome(c.body, 0.6, 0, y0 + 2.5, -0.9);
  b.sph(SNOW, 0.5, 0, y0 + 2.88, -0.9, { sy: 0.4 });
  b.cyl(c.trim, 0.08, 0.6, 0, y0 + 3.0, -0.9, 8);
  // entanglement core window on the front of the middle tier
  b.torus(c.accent, 0.36, 0.06, 0, y0 + 1.1, 0.06, undefined, 18);
  g.sph(c.glow, 0.32, 0, y0 + 1.1, -0.02);
  // waveguide pillars with gold beacons
  for (const x of [-1.65, 1.65]) {
    b.cyl(c.trim, 0.2, 0.2, x, y0, -1.9, 10);
    b.cyl(c.accent, 0.12, 2.3, x, y0 + 0.2, -1.9, 10);
    b.torus(c.trimL, 0.16, 0.04, x, y0 + 1.4, -1.9, { rx: Math.PI / 2 }, 12);
    g.sph(c.glow, 0.15, x, y0 + 2.6, -1.9);
  }
  // laser interferometer bay (front right) with a warm laser line
  b.box(c.body, 1.6, 0.55, 0.8, 1.35, P, 0.75);
  b.box(c.accent, 1.64, 0.08, 0.84, 1.35, P + 0.55, 0.75);
  g.box(G_GOLD, 1.3, 0.05, 0.08, 1.35, P + 0.66, 0.75);
  b.box(c.trim, 0.2, 0.25, 0.2, 0.65, P + 0.63, 0.75);
  b.box(c.trim, 0.2, 0.25, 0.2, 2.05, P + 0.63, 0.75);
  // little operator console (front left)
  b.box(c.trim, 0.9, 0.75, 0.55, -1.5, P, 0.8);
  b.box(c.body, 0.94, 0.08, 0.6, -1.5, P + 0.75, 0.8, { rx: 0.25 });
  g.box(c.glow, 0.6, 0.03, 0.34, -1.5, P + 0.81, 0.82, { rx: 0.25 });
  // the harmonic ring: gold, tilted, carrying three cream orbs
  p.torus(c.accent, 1.0, 0.08, 0, 0, 0, { rx: Math.PI / 2 + 0.38 }, 28);
  p.torus(GOLD_L, 0.82, 0.03, 0, 0, 0, { rx: Math.PI / 2 + 0.38 }, 24);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x = Math.cos(a);
    const z0 = Math.sin(a);
    p.sph(c.body, 0.14, x, -z0 * Math.sin(0.38), z0 * Math.cos(0.38));
  }
  return { at: [0, y0 + 3.75, -0.9], axis: 'y', mode: 'spin', speed: 0.42 };
};

/** quantumBank: an arched cream ledger hall with gold columns; holographic coin rings swirl above the funnel. */
const quantumBank: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const c = E10;
  plinth(b, c.ground);
  // ledger hall with an arched roof
  b.box(c.body, 3.0, 2.0, 2.0, 0, P, -1.0);
  b.box(c.trim, 3.04, 0.16, 2.04, 0, P, -1.0);
  b.box(c.accent, 3.04, 0.12, 2.04, 0, P + 1.88, -1.0);
  hcyl(b, c.body, 1.0, 3.0, 0, P + 2.0, -1.0, 'x', 20);
  for (const x of [-1.44, 1.44]) b.torus(c.accent, 0.98, 0.07, x, P + 2.0, -1.0, { ry: Math.PI / 2 }, 22);
  b.box(SNOW, 2.6, 0.12, 0.7, 0, P + 2.94, -1.0);
  // portico: two gold-capped columns and a lintel
  for (const x of [-1.2, 1.2]) {
    b.cyl(c.trim, 0.24, 0.15, x, P, 0.25, 12);
    b.cyl(c.body, 0.17, 1.75, x, P + 0.15, 0.25, 12);
    b.cyl(c.accent, 0.24, 0.14, x, P + 1.9, 0.25, 12);
  }
  b.box(c.body, 2.9, 0.26, 0.6, 0, P + 2.0, 0.15);
  b.box(c.accent, 2.94, 0.06, 0.64, 0, P + 2.0, 0.15);
  b.box(SNOW, 2.8, 0.12, 0.5, 0, P + 2.26, 0.15);
  // ledger screen and the biometric deposit pedestal
  pane(b, g, c.trim, c.glow, 0, P + 0.85, 0.01, 1.4, 0.8);
  b.box(c.trim, 0.7, 0.85, 0.42, 0, P, 0.7);
  b.box(c.accent, 0.74, 0.08, 0.46, 0, P + 0.85, 0.7);
  g.box(G_GOLD, 0.36, 0.03, 0.22, 0, P + 0.93, 0.7);
  // ledger spire (back left)
  b.cyl(c.trim, 0.22, 0.2, -1.75, P, -1.75, 10);
  b.cyl(c.trimL, 0.1, 3.8, -1.75, P + 0.2, -1.75, 8);
  for (const y of [1.2, 2.4, 3.4]) b.torus(c.accent, 0.16, 0.035, -1.75, P + y, -1.75, { rx: Math.PI / 2 }, 12);
  g.sph(c.glow, 0.15, -1.75, P + 4.1, -1.75);
  // gold coin funnel on the arch (the crown)
  b.cyl(c.trim, 0.2, 0.2, 0, P + 2.9, -1.0, 10);
  b.cone(c.accent, 0.62, 0.75, 0, P + 3.1, -1.0, 16, { rx: Math.PI });
  b.torus(GOLD_L, 0.6, 0.05, 0, P + 3.85, -1.0, { rx: Math.PI / 2 }, 20);
  // the vortex: three tilted glowing rings with coins riding on them
  for (const [r, tilt, ry] of [[0.95, 0.35, 0], [0.72, -0.3, 1.0], [0.5, 0.5, 2.1]] as const) {
    p.torus(G_GOLD, r, 0.04, 0, 0, 0, { rx: Math.PI / 2 + tilt, ry }, 26);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const r = i % 2 ? 0.72 : 0.95;
    hcyl(p, G_AMBER, 0.09, 0.03, Math.cos(a) * r, (i % 2 ? -0.18 : 0.22) * Math.sin(a), Math.sin(a) * r, 'z', 10);
  }
  return { at: [0, P + 4.5, -1.0], axis: 'y', mode: 'spin', speed: 0.55, glow: true };
};

const RECIPES: Record<Era4MachineId, Recipe> = {
  goldPanner, boardShop, pcAssembly, atmNetwork, graphitePit, batteryPlant, atomicVault, quantumLab, quantumBank,
};

// ---------------------------------------------------------------------------
// building models from recipes
// ---------------------------------------------------------------------------

interface Built {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  pivot: THREE.BufferGeometry;
  spec: PivotSpec;
  w: number;
  d: number;
}

const builtCache = new Map<Era4MachineId, Built>();

function build(id: Era4MachineId): Built {
  let built = builtCache.get(id);
  if (built) return built;
  const parts: Parts = { body: new Kit(), glow: new Kit(), pivot: new Kit() };
  const spec = RECIPES[id](parts);
  const body = parts.body.geometry();
  const glow = parts.glow.geometry();
  const pivot = parts.pivot.geometry();
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

/** One era 8–10 machine: body + glow + one animated 'pivot' (see the file header for the contract). */
export function createEraMachine4(id: Era4MachineId): MachineModel {
  const built = build(id);
  const spec = built.spec;
  const root = new THREE.Group();
  root.name = `machine:${id}:${ERA4_MACHINES[id].era}`;
  const bodyMesh = new THREE.Mesh(built.body, vcMat());
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.name = 'body';
  const glowMesh = new THREE.Mesh(built.glow, eraGlowMaterial());
  glowMesh.name = 'glow';
  const pivotMesh = new THREE.Mesh(built.pivot, spec.glow ? eraGlowMaterial() : vcMat());
  pivotMesh.name = 'pivot';
  pivotMesh.castShadow = !spec.glow;
  pivotMesh.position.set(...spec.at);
  root.add(bodyMesh, glowMesh, pivotMesh);
  const axisIndex = spec.axis === 'x' ? 0 : spec.axis === 'y' ? 1 : 2;
  let phase = 0;
  let drive = IDLE;
  const animate = (dt: number, working: boolean): void => {
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
        pivotMesh.position[spec.axis] = spec.at[axisIndex] + Math.sin(phase * Math.PI * 2) * amp;
        break;
    }
  };
  return { root, w: built.w, d: built.d, animate };
}

// ---------------------------------------------------------------------------
// gallery (--query gallery=eraMachines4)
// ---------------------------------------------------------------------------

const catalog: Record<string, () => THREE.Object3D> = {};
for (const id of ERA4_MACHINE_IDS) catalog[id] = () => createEraMachine4(id).root;
// one sheet with every era 8–10 machine, a row per era: `?gallery=eras8to10`
catalog.eras8to10 = () => {
  const sheet = new THREE.Group();
  sheet.name = 'eras8to10';
  for (const era of [8, 9, 10] as const) {
    let x = 0;
    for (const id of ERA4_MACHINE_IDS) {
      if (ERA4_MACHINES[id].era !== era) continue;
      const m = createEraMachine4(id);
      m.root.position.set(x, 0, (era - 8) * 6.4);
      x += 6.4;
      sheet.add(m.root);
    }
  }
  return sheet;
};
export const eraMachine4Catalog: Record<string, () => THREE.Object3D> = catalog;
