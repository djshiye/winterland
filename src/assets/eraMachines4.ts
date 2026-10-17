/**
 * 1.0 expansion: the era 8, 9 and 10 cash machines (ATM network, atomic vault, quantum bank). Since 0.9.8 the
 * production machines of those eras live in assets/eraMachines6to10.ts.
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
import { MACHINE_TONES } from '../render/palette';
import { SNOW, SNOW_SH, Kit, eraGlowMaterial, hcyl, wheel, type V3 } from './eraKit';
import type { MachineModel } from './eraMachines';

/** 0.9.8: only the era 8-10 cash machines stay here; the production machines moved to assets/eraMachines6to10.ts. */
export type Era4MachineId = 'atmNetwork' | 'atomicVault' | 'quantumBank';

/** Era and role of every machine in this file (roles as in the art spec). */
export const ERA4_MACHINES: Record<Era4MachineId, { era: 8 | 9 | 10; role: 'extractor' | 'processor' | 'premium' | 'cash' }> = {
  atmNetwork: { era: 8, role: 'cash' },
  atomicVault: { era: 9, role: 'cash' },
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

const tones = (n: 8 | 9 | 10, body: number = MACHINE_TONES[n].body): Pal => {
  const t = MACHINE_TONES[n];
  return pal(t.ground, body, t.accent, t.trim, t.glow);
};
const E8 = tones(8);
const E9 = tones(9, mix(MACHINE_TONES[9].body, WARM, 0.25));
const E10 = tones(10);

// secondary glow tints (multiplied into the shared emissive material)
const G_AMBER = 0xffc070;
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
  atmNetwork, atomicVault, quantumBank,
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
