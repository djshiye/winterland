/**
 * [0.9.8 — machines, second half] The toy machines of eras 6 to 10: every production machine of the Electric, Oil,
 * Computer, Nuclear and AI eras (26 models), rebuilt as cozy snow-globe toys (DIRECTION "snow-globe toy diorama").
 * eras/Machine.ts reaches them through assets/eraMachines.ts createMachineModel (OWN_MODELS); the cash machines of these
 * eras stay in eraMachines3.ts / eraMachines4.ts (assets/eraCash.ts).
 *
 * Art rules:
 * - Each era's machines read as that era's resource loop (R36): copper coils, copper roofs and mint insulators (6);
 *   honey tanks, crimson pipes, amber crude in sight glasses and peach flares (7); beige plastics, sea-teal roofs,
 *   silicon boules, satellite dishes and mint screens (8); porcelain, jade bands, slate roofs, rounded aqua uranium
 *   and cotton steam (9); cream panels, slate roofs with gold seams, lavender rare-earth geodes, peach helium-3 and
 *   floating gold halos (10).
 * - A readable crown at 40 px on every machine (headframe wheel, coil tower, giant bulb, radio mast, pumpjack, flare,
 *   satellite dish, CRT, cooling tower, battery, halo ring, robot head...).
 * - Colours come only from render/palette.ts (palette(era), MACHINE_TONES) and the materials of eras/data.ts, shaded with
 *   mixHex: no palette of its own. No pure black, no spikes (crystals are rounded capsules), snow on every roof.
 * - Plinths, roofs and trims are kept darker or warmer than the era's floor, so pale eras (8-10) never melt into it.
 * - The game shows these from the model's back-left (regions open north: the slot yaw turns local −Z and −X toward the
 *   camera), so every machine has lit windows and detail on its back and left faces too, and its tall crown sits at the
 *   centre or back-right where it never hides the body.
 *
 * Contract (same as assets/eraMachines.ts):
 * - Origin at the floor centre, +Z = front (the yard side: input pallet at (−1.6, +1.8), output at (+1.6, +1.8), worker
 *   at (0, +2.2): nothing above 0.4 m stands there).
 * - Exactly three meshes: 'body' (merged, vertex-coloured), 'glow' (the shared night-registered `eraGlowMaterial()`,
 *   tinted per vertex, so windows, screens and flames bloom and brighten at night through the comfort Glow slider) and
 *   ONE animated 'pivot' placed at its rotation centre. `animate(dt, working)` runs it at full speed while working and
 *   at a slow idle crawl otherwise; no allocation per frame. Pivots move ≥ 0.35 m or turn at a radius ≥ 0.6 m.
 * - Footprint ≤ 5.2 × 5.2 m even with the pivot at any phase (the plinth is 4.8 × 4.8), height ≤ 6 m.
 * - Geometry is built once per id and shared by every instance (draw calls stay at three per machine).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MATERIALS } from '../eras/data';
import { vcMat } from '../render/batch';
import { CREAM, GOLD, INK, MACHINE_TONES, SNOW, SNOW_SHADE, mixHex, palette } from '../render/palette';
import { Kit, eraGlowMaterial, hcyl, lattice, seeded, wheel, type Rot, type V3 } from './eraKit';
import type { MachineModel } from './eraMachines';

/** The machines of this file, in era order (each era: extractors first, then its chain). */
export const TOY_MACHINES = {
  copperMine: 6, wireMill: 6, quartzPit: 6, bulbWorks: 6, radioWorks: 6,
  oilPump: 7, refinery: 7, gasWell: 7, cracker: 7, snowmobileWorks: 7,
  sandPit: 8, goldPanner: 8, chipFab: 8, boardShop: 8, pcAssembly: 8,
  uraniumMine: 9, graphitePit: 9, enricher: 9, reactor: 9, batteryPlant: 9,
  nanoFab: 10, heliumSkimmer: 10, fusionPlant: 10, dataCenter: 10, robotWorks: 10, quantumLab: 10,
} as const;
export type ToyMachineId = keyof typeof TOY_MACHINES;
export const TOY_MACHINE_IDS = Object.keys(TOY_MACHINES) as ToyMachineId[];

// ---------------------------------------------------------------------------
// tones (all derived from render/palette.ts and the era materials)
// ---------------------------------------------------------------------------

interface Tones {
  /** Main walls and their shade. */
  wall: number;
  wallD: number;
  /** The era body colour (bands, bases, machinery). */
  body: number;
  bodyL: number;
  bodyD: number;
  /** Roofs (darker or warmer than the floor). */
  roof: number;
  roofD: number;
  accent: number;
  accentL: number;
  trim: number;
  trimL: number;
  /** Plain machinery metal. */
  metal: number;
  metalL: number;
  /** Plinth top and its kick strip. */
  plinth: number;
  edge: number;
  /** The era's glow (screens, beacons) and the warm window light. */
  glow: number;
  warm: number;
  /** The era's main resource, its shade and its glow. */
  res: number;
  resD: number;
  resGlow: number;
}

const WARM_GLOW = mixHex(GOLD, CREAM, 0.45);
const FIRE_GLOW = mixHex(GOLD, palette(7).accent, 0.45);
const STEAM = mixHex(SNOW, CREAM, 0.35);
const lift = (c: number, t: number): number => mixHex(c, CREAM, t);
const deep = (c: number, t: number): number => mixHex(c, INK, t);

function tones(n: 6 | 7 | 8 | 9 | 10): Tones {
  const p = palette(n);
  switch (n) {
    case 6: {
      // Electric: cream enamel walls, copper roofs and windings, teal machinery, mint insulators
      const E = MACHINE_TONES[6];
      const cu = MATERIALS.copper;
      return {
        wall: E.cream, wallD: E.creamD, body: p.body, bodyL: E.bodyL, bodyD: deep(p.body, 0.25),
        roof: cu.color, roofD: cu.accent, accent: p.accent, accentL: lift(p.accent, 0.35), trim: p.trim, trimL: mixHex(p.trim, p.body, 0.5),
        metal: mixHex(p.fence, p.body, 0.4), metalL: lift(p.fence, 0.45), plinth: E.creamD, edge: deep(p.body, 0.1),
        glow: p.glow, warm: WARM_GLOW, res: cu.color, resD: cu.accent, resGlow: mixHex(p.glow, CREAM, 0.2),
      };
    }
    case 7: {
      // Oil: honey bodies, crimson pipes, warm charcoal, amber crude, peach flares
      const O = MACHINE_TONES[7];
      const crude = mixHex(MATERIALS.crude.accent, p.accent, 0.3);
      return {
        wall: O.cream, wallD: deep(O.cream, 0.12), body: p.body, bodyL: O.bodyL, bodyD: O.bodyD,
        roof: p.accent, roofD: deep(p.accent, 0.2), accent: p.accent, accentL: lift(p.accent, 0.3), trim: mixHex(p.trim, palette(7).floor.yard, 0.25), trimL: mixHex(p.trim, O.steel, 0.55),
        metal: O.steel, metalL: lift(O.steel, 0.45), plinth: O.concrete, edge: deep(O.concrete, 0.3),
        glow: p.glow, warm: WARM_GLOW, res: crude, resD: deep(crude, 0.25), resGlow: mixHex(p.glow, GOLD, 0.4),
      };
    }
    case 8: {
      // Computer: retro beige plastic, sea-teal roofs, pewter, silicon blue-grey, mint screens
      const si = MATERIALS.silicon;
      return {
        wall: p.body, wallD: deep(p.body, 0.1), body: p.accent, bodyL: lift(p.accent, 0.3), bodyD: deep(p.accent, 0.2),
        roof: p.accent, roofD: deep(p.accent, 0.25), accent: MATERIALS.gold.color, accentL: lift(MATERIALS.gold.color, 0.3), trim: p.trim, trimL: lift(p.trim, 0.35),
        metal: lift(p.trim, 0.45), metalL: lift(p.trim, 0.7), plinth: mixHex(p.trim, p.accent, 0.45), edge: deep(p.trim, 0.15),
        glow: p.glow, warm: WARM_GLOW, res: si.color, resD: deep(si.color, 0.25), resGlow: mixHex(si.accent, p.glow, 0.25),
      };
    }
    case 9: {
      // Nuclear: warm porcelain, jade bands, slate roofs, rounded aqua uranium, honey hazard bands
      const wall = mixHex(p.body, CREAM, 0.3);
      return {
        wall, wallD: deep(wall, 0.1), body: p.accent, bodyL: lift(p.accent, 0.3), bodyD: deep(p.accent, 0.2),
        roof: p.trim, roofD: deep(p.trim, 0.2), accent: GOLD, accentL: lift(GOLD, 0.3), trim: p.trim, trimL: lift(p.trim, 0.3),
        metal: lift(p.fence, 0.25), metalL: lift(p.fence, 0.6), plinth: mixHex(p.trim, p.fence, 0.5), edge: deep(p.trim, 0.15),
        glow: p.glow, warm: WARM_GLOW, res: MATERIALS.uranium.color, resD: deep(MATERIALS.uranium.color, 0.25), resGlow: mixHex(p.glow, MATERIALS.uranium.color, 0.2),
      };
    }
    case 10: {
      // AI: cream panels, slate-blue roofs with gold seams, lavender rare earth, peach helium-3, sun-gold fusion
      const re = MATERIALS.rareEarth;
      return {
        wall: p.body, wallD: deep(p.body, 0.1), body: p.trim, bodyL: lift(p.trim, 0.3), bodyD: deep(p.trim, 0.2),
        roof: p.trim, roofD: deep(p.trim, 0.2), accent: p.accent, accentL: lift(p.accent, 0.35), trim: p.trim, trimL: lift(p.trim, 0.35),
        metal: lift(p.fence, 0.2), metalL: lift(p.fence, 0.55), plinth: mixHex(p.trim, p.fence, 0.35), edge: deep(p.trim, 0.2),
        glow: p.glow, warm: WARM_GLOW, res: re.color, resD: deep(re.color, 0.25), resGlow: mixHex(re.color, CREAM, 0.35),
      };
    }
  }
}

const T6 = tones(6);
const T7 = tones(7);
const T8 = tones(8);
const T9 = tones(9);
const T10 = tones(10);

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

/** Plinth top: everything stands on y = P. */
const P = 0.25;

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Rounded (bevelled) box with its bottom at `y`. */
function rbox(k: Kit, color: number, w: number, h: number, d: number, x: number, y: number, z: number, o?: Rot, r = 0.08): void {
  const rr = Math.max(0.01, Math.min(r, Math.min(w, h, d) / 2 - 0.005));
  k.add(cached(`rb${w}|${h}|${d}|${rr}`, () => new RoundedBoxGeometry(w, h, d, 2, rr)), color, x, y + h / 2, z, o);
}

/** Rounded snow cap (0.12 m) with a cool shadow lip, on a flat top at `y`. */
function snowCap(k: Kit, w: number, d: number, x: number, y: number, z: number): void {
  rbox(k, SNOW_SHADE, w, 0.06, d, x, y, z, undefined, 0.03);
  rbox(k, SNOW, w - 0.08, 0.13, d - 0.08, x, y + 0.02, z, undefined, 0.06);
}

/** Round snow cap on a cylinder top at `y`. */
function snowDisc(k: Kit, r: number, x: number, y: number, z: number): void {
  k.cyl(SNOW_SHADE, r, 0.05, x, y, z, 16);
  k.cyl(SNOW, r * 0.92, 0.11, x, y + 0.03, z, 16, r * 0.8);
}

/** Roof slab with a soft snow cap on top (`h` thick). */
function roofSlab(k: Kit, color: number, w: number, d: number, x: number, y: number, z: number, h = 0.16): void {
  rbox(k, color, w + 0.18, h, d + 0.18, x, y, z, undefined, 0.05);
  snowCap(k, w, d, x, y + h, z);
}

/** Barrel-vault roof lying along X (flat side down at `y`), radius `r` (= half its depth), snow along the crown. */
function vault(k: Kit, color: number, len: number, r: number, x: number, y: number, z: number): void {
  k.add(cached(`va${r}`, () => new THREE.CylinderGeometry(r, r, 1, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)), color, x, y, z, { sx: len });
  k.add(cached(`vs${r}`, () => new THREE.CylinderGeometry(r + 0.07, r + 0.07, 1, 12, 1, false, Math.PI * 0.3, Math.PI * 0.4).rotateZ(Math.PI / 2)), SNOW, x, y, z, { sx: len - 0.08 });
  // gable discs
  for (const s of [-1, 1]) k.add(cached(`vg${r}`, () => new THREE.CylinderGeometry(r, r, 0.08, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)), color, x + s * (len / 2), y, z, { sx: 1 });
}

/** The bevelled 4.8 × 4.8 m plinth (0.25 m) with a kick strip and soft snow drifts at the back corners. */
function plinth(k: Kit, t: Tones, w = 4.8, d = 4.8): void {
  rbox(k, t.edge, w, 0.1, d, 0, 0, 0, undefined, 0.04);
  rbox(k, t.plinth, w - 0.12, 0.25, d - 0.12, 0, 0, 0, undefined, 0.1);
  for (const sx of [-1, 1]) k.sph(SNOW, 0.4, sx * (w / 2 - 0.42), 0.26, -(d / 2 - 0.42), { sy: 0.4 });
  k.sph(SNOW, 0.32, -(w / 2 - 0.36), 0.26, 0.2, { sy: 0.35 });
}

/** Chimney / stack: tapering cylinder, two bands and a snow cap. */
function chimney(k: Kit, color: number, band: number, x: number, y: number, z: number, r: number, h: number): void {
  k.cyl(color, r, h, x, y, z, 12, r * 0.84);
  k.cyl(band, r * 0.95, 0.14, x, y + h * 0.5, z, 12);
  k.cyl(band, r * 0.9, 0.16, x, y + h - 0.14, z, 12);
  snowDisc(k, r * 0.84, x, y + h + 0.02, z);
}

/** A cotton-wool steam puff (static: the diorama look), centred at (x, y, z), `s` = size. */
function puff(k: Kit, x: number, y: number, z: number, s = 1): void {
  k.sph(STEAM, 0.34 * s, x, y, z);
  k.sph(STEAM, 0.26 * s, x + 0.28 * s, y + 0.12 * s, z + 0.06 * s);
  k.sph(SNOW, 0.24 * s, x - 0.22 * s, y + 0.2 * s, z - 0.05 * s);
  k.sph(SNOW, 0.2 * s, x + 0.05 * s, y + 0.36 * s, z + 0.02 * s);
}

/** Lamp on a short cap: cap in `k`, bulb in `g`. */
function lamp(k: Kit, g: Kit, color: number, glow: number, x: number, y: number, z: number, r = 0.11): void {
  k.cyl(color, r * 1.15, 0.06, x, y + r * 0.85, z, 8);
  g.sph(glow, r, x, y, z);
}

/** Window with a rounded frame (frame in `k`, pane in `g`), centred on x, bottom at y, facing outward yaw `ry`. */
function win(k: Kit, g: Kit, glow: number, frame: number, x: number, y: number, z: number, w: number, h: number, ry = 0): void {
  const dx = Math.sin(ry);
  const dz = Math.cos(ry);
  rbox(k, frame, w + 0.16, h + 0.16, 0.08, x, y - 0.08, z, { ry }, 0.03);
  g.box(glow, w, h, 0.05, x + dx * 0.035, y, z + dz * 0.035, { ry });
  k.box(frame, w, 0.04, 0.06, x + dx * 0.05, y + h / 2 - 0.02, z + dz * 0.05, { ry });
}

/** Rounded crystal: a hex capsule (radius r, straight part h), base at (x, y, z), tilted by o. Never a spike. */
function crystal(k: Kit, color: number, x: number, y: number, z: number, r: number, h: number, o?: Rot): void {
  k.add(cached(`cr${r}|${h}`, () => new THREE.CapsuleGeometry(r, h, 2, 6).translate(0, h / 2 + r, 0)), color, x, y, z, o);
}

/** Vertical coil: a stack of `n` tori (radius r) from y up. */
function coil(k: Kit, color: number, x: number, y: number, z: number, r: number, n: number, tube = 0.07): void {
  for (let i = 0; i < n; i++) k.torus(color, r, tube, x, y + tube + i * tube * 1.9, z, { rx: Math.PI / 2 }, 16);
}

/** Electric insulator: a stack of cream discs on a teal stem, a glowing cap. */
function insulator(k: Kit, g: Kit, x: number, y: number, z: number, cream: number, stem: number, glow: number, s = 1): void {
  k.cyl(stem, 0.05 * s, 0.6 * s, x, y, z, 8);
  for (let i = 0; i < 4; i++) k.cyl(cream, (0.17 - i * 0.012) * s, 0.06 * s, x, y + (0.08 + i * 0.13) * s, z, 12);
  g.sph(glow, 0.09 * s, x, y + 0.68 * s, z);
}

/** Honey / dark hazard stripes along X on a face looking +Z (or along Z on a face looking ±X with alongZ). */
function stripes(k: Kit, x: number, y: number, z: number, len: number, h: number, a: number, bcol: number, alongZ = false): void {
  const n = Math.max(2, Math.round(len / 0.32));
  for (let i = 0; i < n; i++) {
    const o = -len / 2 + (i + 0.5) * (len / n);
    if (alongZ) k.box(i % 2 ? bcol : a, 0.05, h, len / n, x, y, z + o);
    else k.box(i % 2 ? bcol : a, len / n, h, 0.05, x + o, y, z);
  }
}

/** Ladder up a wall (rails + rungs) along Y at (x, z). */
function ladder(k: Kit, color: number, x: number, y0: number, y1: number, z: number, alongX = true): void {
  const dx = alongX ? 0.18 : 0;
  const dz = alongX ? 0 : 0.18;
  k.beam(color, [x - dx, y0, z - dz], [x - dx, y1, z - dz], 0.05);
  k.beam(color, [x + dx, y0, z + dz], [x + dx, y1, z + dz], 0.05);
  for (let y = y0 + 0.25; y < y1; y += 0.3) k.beam(color, [x - dx, y, z - dz], [x + dx, y, z + dz], 0.035);
}

/** Satellite dish centred at its rim centre, facing +Z tilted up by `tilt` (in the pivot kit for a turning dish). */
function dish(k: Kit, color: number, rim: number, feed: number, x: number, y: number, z: number, r: number, tilt = 0.6): void {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const u = i / 5;
    return [u * r, u * u * r * 0.38] as const;
  });
  k.add(cached(`dish${r}`, () => new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 18).rotateX(Math.PI / 2)), color, x, y, z, { rx: -tilt });
  k.add(cached(`dishr${r}`, () => new THREE.TorusGeometry(r, 0.05, 6, 22)), rim, x + 0, y + Math.sin(tilt) * r * 0.38, z + Math.cos(tilt) * r * 0.38, { rx: -tilt });
  const fx = Math.sin(tilt) * r * 0.9;
  const fz = Math.cos(tilt) * r * 0.9;
  k.beam(feed, [x, y, z], [x, y + fx, z + fz], 0.05);
  k.sph(feed, 0.09, x, y + fx, z + fz);
}

/** A rail track along Z at x. */
function rails(k: Kit, color: number, sleeper: number, x: number, z0: number, z1: number, gauge = 0.5): void {
  for (const s of [-1, 1]) k.box(color, 0.06, 0.06, z1 - z0, x + (s * gauge) / 2, P, (z0 + z1) / 2);
  for (let z = z0 + 0.15; z < z1; z += 0.34) k.box(sleeper, gauge + 0.3, 0.04, 0.12, x, P, z);
}

/** A heap of rounded lumps (deterministic). */
function lumps(k: Kit, colors: readonly number[], cx: number, cy: number, cz: number, rad: number, n: number, seed: number, r = 0.17): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * rad;
    const h = (1 - d / Math.max(rad, 0.01)) * r * 1.4;
    k.sph(colors[i % colors.length]!, r * (0.75 + rnd() * 0.5), cx + Math.cos(a) * d, cy + h, cz + Math.sin(a) * d, { sy: 0.75 });
  }
}

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
  /** spin = turn; swing = sine rotation (±amp rad); bob = vertical sine (±amp m); slide = sine along axis (±amp m); rise = loop upward (amp m) while shrinking. */
  mode: 'spin' | 'swing' | 'bob' | 'slide' | 'rise';
  speed: number;
  amp?: number;
  /** Paint the pivot with the shared glow material. */
  glow?: boolean;
}

type Recipe = (p: Parts) => PivotSpec;

// ---------------------------------------------------------------------------
// era 6 — Electric: copper is everything (copper roofs, copper coils, copper wire), cream enamel, mint insulators
// ---------------------------------------------------------------------------

/** copperMine: a cream hoist house under a copper barrel roof winds copper ore up a teal headframe; the big sheave turns. */
const copperMine: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T6;
  plinth(b, t);
  // hoist house (back left): teal base, cream walls, copper band and barrel roof, warm windows on every side
  const hx = -0.95;
  const hz = -0.85;
  rbox(b, t.body, 2.5, 0.42, 2.1, hx, P, hz);
  rbox(b, t.wall, 2.3, 1.5, 1.9, hx, P + 0.42, hz, undefined, 0.06);
  b.box(t.accent, 2.34, 0.08, 1.94, hx, P + 1.5, hz);
  rbox(b, t.trim, 2.5, 0.12, 2.1, hx, P + 1.92, hz, undefined, 0.04);
  vault(b, t.roof, 2.5, 1.0, hx, P + 2.04, hz);
  for (const x of [hx - 0.55, hx + 0.55]) win(b, g, t.warm, t.trim, x, P + 0.8, hz - 0.96, 0.46, 0.5, Math.PI);
  win(b, g, t.warm, t.trim, hx - 1.16, P + 0.8, hz, 0.5, 0.5, -Math.PI / 2);
  win(b, g, t.warm, t.trim, hx - 0.45, P + 0.8, hz + 0.96, 0.46, 0.5);
  rbox(b, t.trim, 0.6, 1.0, 0.1, hx + 0.5, P + 0.42, hz + 0.95, undefined, 0.03);
  g.box(t.glow, 0.36, 0.22, 0.05, hx + 0.5, P + 1.08, hz + 1.0);
  // two mint insulators on the roof ridge (the Electric Age signature)
  for (const x of [hx - 0.7, hx + 0.7]) insulator(b, g, x, P + 2.98, hz, t.wall, t.trim, t.glow);
  // headframe (right): teal lattice legs leaning in to a platform, copper sheave on top
  const fx = 1.25;
  const fz = -0.7;
  const top = P + 4.05;
  for (const [x, z] of [[0.5, -1.6], [2.0, -1.6], [0.5, 0.2], [2.0, 0.2]] as const) b.beam(t.body, [x, P, z], [fx + (x - fx) * 0.25, top, fz + (z - fz) * 0.25], 0.16);
  for (const y of [P + 1.2, P + 2.5]) {
    const k = (y - P) / (top - P);
    const hw = 0.75 * (1 - k * 0.75);
    const hd = 0.9 * (1 - k * 0.75);
    for (const [a, c] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]] as const) {
      b.beam(t.bodyL, [fx + a[0] * hw, y, fz + a[1] * hd], [fx + c[0] * hw, y, fz + c[1] * hd], 0.08);
    }
  }
  rbox(b, t.trim, 0.9, 0.12, 0.8, fx, top - 0.06, fz, undefined, 0.04);
  for (const z of [fz - 0.32, fz + 0.32]) b.beam(t.trimL, [fx, top, z], [fx, top + 0.42, z], 0.1);
  lamp(b, g, t.trim, t.glow, fx + 0.38, top + 0.2, fz - 0.36, 0.08);
  // shaft collar, copper skip and the hoist rope (up from the house, over the wheel, down the shaft)
  b.cyl(t.trim, 0.5, 0.2, fx + 0.65, P, fz, 14);
  rbox(b, t.accent, 0.5, 0.55, 0.5, fx + 0.65, P + 0.85, fz, undefined, 0.05);
  lumps(b, [t.res, t.resD], fx + 0.65, P + 1.38, fz, 0.18, 4, 61, 0.1);
  b.beam(t.roofD, [hx + 1.05, P + 2.2, hz], [fx - 0.62, top + 0.46, fz], 0.035);
  b.beam(t.roofD, [fx + 0.65, top + 0.42, fz], [fx + 0.65, P + 1.4, fz], 0.035);
  // ore cart on a short track (front middle) and a copper ore heap with verdigris by the shaft
  rails(b, t.metal, t.trimL, -0.35, -0.1, 1.25);
  rbox(b, t.body, 0.75, 0.42, 0.62, -0.35, P + 0.14, 0.75, undefined, 0.05);
  for (const s of [-1, 1]) hcyl(b, t.trim, 0.11, 0.08, -0.35 + s * 0.3, P + 0.13, 0.75, 'x', 8);
  lumps(b, [t.res, t.resD, t.accentL], -0.35, P + 0.56, 0.75, 0.22, 5, 62, 0.12);
  lumps(b, [t.res, t.resD, mixHex(t.glow, t.body, 0.55), t.accentL], 1.05, P, 0.75, 0.55, 9, 63, 0.2);
  b.sph(SNOW, 0.3, 1.0, P + 0.35, 0.7, { sy: 0.35 });
  // the sheave wheel: copper rim, teal hub, six spokes
  wheel(p, 'z', t.roof, t.body, 0, 0, 0, 0.66, 0.09, 6);
  p.torus(t.accentL, 0.55, 0.03, 0, 0, 0, undefined, 16);
  return { at: [fx, top + 0.46, fz], axis: 'z', mode: 'spin', speed: 0.55 };
};

/** wireMill: a cream sawtooth shed draws copper wire onto a big turning reel; a tall copper coil tower crowns it. */
const wireMill: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T6;
  plinth(b, t);
  // the shed (back): teal base, cream walls, sawtooth teal roof with mint-glass north lights
  const sz = -1.05;
  rbox(b, t.body, 4.4, 0.36, 2.3, 0.1, P, sz);
  rbox(b, t.wall, 4.2, 1.35, 2.1, 0.1, P + 0.36, sz, undefined, 0.06);
  b.box(t.accent, 4.24, 0.07, 2.14, 0.1, P + 1.3, sz);
  rbox(b, t.trim, 4.4, 0.12, 2.3, 0.1, P + 1.71, sz, undefined, 0.04);
  for (let i = 0; i < 3; i++) {
    const x0 = -2.0 + i * 1.4;
    b.prismXY(t.body, [[0, 0], [1.4, 0], [0, 0.8]], 2.1, x0, P + 1.83, sz - 1.05);
    g.box(t.resGlow, 0.05, 0.62, 1.86, x0 + 0.03, P + 1.9, sz);
    b.box(SNOW, 1.6, 0.1, 2.1, x0 + 0.72, P + 2.24, sz, { rz: -Math.atan2(0.8, 1.4) });
  }
  // windows all round
  for (const x of [-1.3, 0.1, 1.5]) win(b, g, t.warm, t.trim, x, P + 0.65, sz - 1.06, 0.55, 0.42, Math.PI);
  win(b, g, t.warm, t.trim, -2.01, P + 0.65, sz, 0.6, 0.42, -Math.PI / 2);
  win(b, g, t.warm, t.trim, 1.2, P + 0.65, sz + 1.06, 0.6, 0.42);
  rbox(b, t.trim, 0.8, 1.05, 0.1, 0.0, P + 0.36, sz + 1.06, undefined, 0.03);
  g.box(t.warm, 0.56, 0.75, 0.05, 0.0, P + 0.4, sz + 1.1);
  // copper coil tower (crown, back right): teal drum, a fat copper winding, a mint glass dome, an insulator on top
  const cx = 1.45;
  const cz = -1.25;
  b.cyl(t.body, 0.62, 0.5, cx, P + 2.1, cz, 16);
  coil(b, t.roof, cx, P + 2.6, cz, 0.5, 9, 0.09);
  b.cyl(t.roofD, 0.42, 1.64, cx, P + 2.6, cz, 14);
  b.cyl(t.wall, 0.6, 0.14, cx, P + 4.24, cz, 16);
  g.dome(t.glow, 0.42, cx, P + 4.38, cz);
  insulator(b, g, cx, P + 4.76, cz, t.wall, t.trim, t.glow, 0.8);
  // drawing bench (front left of the shed): copper wires run from little dies into the shed
  rbox(b, t.trim, 1.6, 0.5, 0.6, -0.85, P, 0.45, undefined, 0.05);
  for (let i = 0; i < 4; i++) {
    const x = -1.45 + i * 0.4;
    b.cyl(t.wall, 0.08, 0.16, x, P + 0.5, 0.45, 8);
    b.beam(t.res, [x, P + 0.6, 0.45], [x + 0.1, P + 0.75, sz + 1.05], 0.03);
  }
  // transformer (front right) with copper windings and two insulators
  rbox(b, t.body, 0.7, 0.75, 0.6, 1.15, P, 0.55, undefined, 0.06);
  coil(b, t.roof, 1.15, P + 0.75, 0.55, 0.22, 3);
  for (const x of [0.95, 1.35]) insulator(b, g, x, P + 0.75, 0.38, t.wall, t.trim, t.glow, 0.55);
  // reel stand (left end, facing the camera): two teal cheeks
  for (const z of [-0.05, 0.75]) rbox(b, t.trim, 0.16, 1.15, 0.16, -1.85, P, z, undefined, 0.04);
  // the reel: copper drum between two teal flanges with spokes
  hcyl(p, t.res, 0.42, 0.62, 0, 0, 0, 'z', 14);
  for (const z of [-0.33, 0.33]) {
    hcyl(p, t.body, 0.72, 0.06, 0, 0, z, 'z', 18);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      p.beam(t.wall, [-Math.cos(a) * 0.66, -Math.sin(a) * 0.66, z * 1.12], [Math.cos(a) * 0.66, Math.sin(a) * 0.66, z * 1.12], 0.06);
    }
  }
  for (let i = 0; i < 4; i++) p.torus(t.resD, 0.43, 0.025, 0, 0, -0.24 + i * 0.16, undefined, 14);
  return { at: [-1.85, P + 1.15, 0.35], axis: 'z', mode: 'spin', speed: 0.45 };
};

/** quartzPit: an electric shovel with a copper cab swings its dipper over a snowy pit of soft pink quartz. */
const quartzPit: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T6;
  const q = MATERIALS.quartz;
  plinth(b, t);
  // the pit (left): gravel rim, deep floor, snowy lip, pink quartz clusters with a few glowing ones
  const px = -0.75;
  const pz = -0.55;
  b.lathe(MACHINE_TONES[6].gravel, [[1.25, 0], [1.85, 0], [1.9, 0.3], [1.72, 0.46], [1.42, 0.42], [1.25, 0.1]], px, P, pz, 26);
  b.cyl(deep(MACHINE_TONES[6].gravel, 0.35), 1.3, 0.08, px, P, pz, 22);
  b.torus(SNOW, 1.68, 0.12, px, P + 0.45, pz, { rx: Math.PI / 2 }, 30);
  const clusters: [number, number, number][] = [[-0.6, 0.3, 1], [0.5, 0.5, 2], [-0.1, -0.7, 3], [0.6, -0.4, 4], [-0.75, -0.45, 5]];
  for (const [x, z, s] of clusters) {
    crystal(b, q.color, px + x, P + 0.06, pz + z, 0.1, 0.32, { rz: 0.25 * Math.sin(s * 2.3), rx: 0.2 * Math.cos(s) });
    crystal(b, lift(q.color, 0.3), px + x + 0.17, P + 0.06, pz + z + 0.06, 0.08, 0.22, { rz: -0.45 });
    if (s % 2) crystal(g, mixHex(q.color, t.glow, 0.35), px + x - 0.14, P + 0.06, pz + z - 0.08, 0.075, 0.2, { rx: -0.4 });
  }
  // shovel house base (right): teal crawler tracks and a slewing ring
  const sx = 1.3;
  const szz = -0.75;
  for (const z of [szz - 0.62, szz + 0.62]) {
    rbox(b, t.trim, 1.6, 0.36, 0.42, sx, P, z, undefined, 0.16);
    for (let i = 0; i < 4; i++) b.cyl(t.metal, 0.1, 0.44, sx - 0.6 + i * 0.4, P + 0.18, z - 0.22, 8, 0.1, { rx: Math.PI / 2 });
  }
  rbox(b, t.body, 1.3, 0.24, 1.0, sx, P + 0.36, szz, undefined, 0.06);
  b.cyl(t.accent, 0.62, 0.08, sx, P + 0.6, szz, 18);
  // power pole with insulators feeding the shovel's trailing cable (back right corner)
  b.cyl(MACHINE_TONES[6].honey, 0.1, 3.9, 1.95, P, -1.95, 8, 0.08);
  rbox(b, t.trim, 0.9, 0.1, 0.12, 1.95, P + 3.55, -1.95, undefined, 0.03);
  for (const x of [1.62, 2.28]) insulator(b, g, x, P + 3.62, -1.95, t.wall, t.trim, t.glow, 0.6);
  b.beam(t.trim, [1.95, P + 3.3, -1.95], [sx + 0.4, P + 0.5, szz - 0.3], 0.035);
  // quartz on a sorting tray at the front (it comes out of the pit on a little copper chute)
  b.box(t.accent, 0.5, 0.06, 1.1, -0.2, P + 0.3, 0.9, { rx: 0.3 });
  rbox(b, t.wall, 0.9, 0.3, 0.55, -0.2, P, 1.1, undefined, 0.05);
  for (const x of [-0.4, -0.15, 0.1]) crystal(b, q.color, x, P + 0.3, 1.1, 0.07, 0.14, { rz: x });
  // the slewing upper house (pivot): cream cab, copper roof, lit window, A-frame, boom and dipper over the pit
  rbox(p, t.wall, 1.2, 0.95, 1.0, 0.15, 0, 0, undefined, 0.07);
  rbox(p, t.roof, 1.36, 0.16, 1.12, 0.15, 0.95, 0, undefined, 0.05);
  rbox(p, SNOW, 1.22, 0.1, 0.98, 0.15, 1.1, 0, undefined, 0.04);
  rbox(p, t.trim, 0.06, 0.4, 0.5, -0.47, 0.42, 0, undefined, 0.02);
  rbox(p, t.body, 0.5, 0.36, 1.04, 0.55, 0.0, 0, undefined, 0.04);
  p.beam(t.body, [-0.3, 1.0, 0], [0.25, 1.75, 0], 0.1);
  p.beam(t.body, [0.6, 1.0, 0], [0.25, 1.75, 0], 0.1);
  p.beam(t.bodyL, [-0.35, 0.35, 0], [-1.85, 1.35, 0], 0.16);
  p.beam(t.trim, [0.25, 1.75, 0], [-1.85, 1.35, 0], 0.04);
  p.beam(t.trimL, [-1.0, 0.75, 0], [-1.5, 0.15, 0], 0.12);
  rbox(p, t.roof, 0.5, 0.42, 0.55, -1.6, -0.1, 0, { rz: 0.35 }, 0.08);
  crystal(p, q.color, -1.6, 0.28, 0.05, 0.07, 0.15, { rz: 0.5 });
  crystal(p, q.color, -1.7, 0.26, -0.1, 0.06, 0.12, { rz: -0.4 });
  return { at: [sx, P + 0.68, szz], axis: 'y', mode: 'swing', speed: 0.22, amp: 0.55 };
};

/** bulbWorks: a cream glass-oven drum under a copper dome, crowned by a giant glowing bulb; a carousel of bulbs turns round it. */
const bulbWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T6;
  const bulb = MATERIALS.bulb;
  plinth(b, t);
  // base deck
  rbox(b, t.body, 4.3, 0.4, 3.6, 0, P, -0.5);
  b.box(t.accent, 4.32, 0.07, 3.62, 0, P + 0.32, -0.5);
  const B = P + 0.4;
  // core drum (centre back): cream oven with teal bands and portholes, copper dome
  const dx = -0.15;
  const dz = -0.75;
  b.cyl(t.wall, 1.3, 1.55, dx, B, dz, 22, 1.24);
  for (const y of [0.18, 1.32]) b.torus(t.body, 1.28 - y * 0.04, 0.07, dx, B + y, dz, { rx: Math.PI / 2 }, 26);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * 0.55 + (i / 4) * Math.PI * 0.95;
    const x = dx + Math.cos(a) * 1.27;
    const z = dz - Math.sin(a) * 1.27;
    b.torus(t.accent, 0.2, 0.05, x, B + 0.8, z, { ry: Math.PI / 2 - a }, 14);
    g.sph(i % 2 ? t.warm : FIRE_GLOW, 0.17, x, B + 0.8, z, { sx: 0.5, sz: 0.5 });
  }
  b.dome(t.roof, 1.27, dx, B + 1.55, dz, { sy: 0.55 });
  b.dome(SNOW, 1.06, dx, B + 1.62, dz, { sy: 0.48 });
  // furnace mouth on the front
  rbox(b, t.trim, 0.9, 0.7, 0.14, dx, B + 0.3, dz + 1.25, undefined, 0.05);
  g.box(FIRE_GLOW, 0.7, 0.5, 0.06, dx, B + 0.4, dz + 1.31);
  // crown: copper neck and a giant bulb (glass glow, a coiled filament inside), its socket rings above the carousel
  b.cyl(t.roofD, 0.2, 0.7, dx, B + 2.15, dz, 12);
  b.cyl(t.roof, 0.3, 0.42, dx, B + 2.8, dz, 14, 0.27);
  for (let i = 0; i < 3; i++) b.torus(t.roofD, 0.29 - i * 0.012, 0.035, dx, B + 2.88 + i * 0.12, dz, { rx: Math.PI / 2 }, 14);
  g.sph(mixHex(bulb.color, GOLD, 0.3), 0.62, dx, B + 3.75, dz, { sy: 1.08 });
  g.cyl(lift(bulb.color, 0.1), 0.3, 0.3, dx, B + 3.18, dz, 14, 0.4);
  b.cyl(t.wall, 0.07, 0.04, dx, B + 4.42, dz, 8);
  // vacuum chimney (back right) with a cotton puff
  chimney(b, t.roof, t.body, 1.6, B, -1.75, 0.26, 2.2);
  puff(b, 1.65, B + 2.75, -1.75, 0.8);
  // test bench of glowing bulbs (left, toward the camera)
  rbox(b, t.wallD, 0.8, 0.55, 2.0, -1.65, B, -0.75, undefined, 0.05);
  b.box(t.accent, 0.84, 0.06, 2.04, -1.65, B + 0.5, -0.75);
  for (let i = 0; i < 5; i++) {
    const z = -1.55 + i * 0.4;
    b.cyl(t.accent, 0.07, 0.12, -1.65, B + 0.56, z, 8);
    g.sph(i % 2 ? t.glow : lift(bulb.color, 0.3), 0.14, -1.65, B + 0.82, z, { sy: 1.15 });
  }
  // crates of finished bulbs (front right)
  rbox(b, MACHINE_TONES[6].honey, 0.8, 0.38, 0.6, 1.2, B, 0.5, undefined, 0.05);
  for (const x of [0.98, 1.2, 1.42]) b.sph(bulb.color, 0.1, x, B + 0.46, 0.5, { sy: 1.2 });
  // the carousel (spins around the bulb's neck): copper ring, six arms, cream sockets with small glowing bulbs
  p.torus(t.roof, 0.95, 0.05, 0, 0, 0, { rx: Math.PI / 2 }, 28);
  p.cyl(t.trim, 0.26, 0.12, 0, -0.06, 0, 12);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.95;
    const z = Math.sin(a) * 0.95;
    p.beam(t.accent, [0, 0, 0], [x, 0, z], 0.05);
    p.cyl(t.wall, 0.08, 0.12, x, 0.0, z, 8);
    p.sph(lift(bulb.color, 0.15), 0.15, x, 0.25, z, { sy: 1.2 });
  }
  return { at: [dx, B + 2.5, dz], axis: 'y', mode: 'spin', speed: 0.28 };
};

/** radioWorks: a streamline art-deco radio hall with copper speed lines and a glowing dial; a dipole turns on the lattice mast. */
const radioWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T6;
  plinth(b, t);
  rbox(b, t.wallD, 4.5, 0.2, 3.8, 0, P, -0.5);
  const B = P + 0.2;
  // the hall: a box wing (right) and a rounded drum (left, toward the camera), teal enamel with cream speed lines
  rbox(b, t.wall, 2.9, 2.0, 2.6, 0.55, B, -0.95, undefined, 0.14);
  b.cyl(t.body, 1.3, 2.0, -0.95, B, -0.95, 26);
  for (const y of [0.75, 0.95, 1.15]) {
    b.box(t.roof, 2.92, 0.05, 2.62, 0.55, B + y, -0.95);
    b.cyl(t.wall, 1.32, 0.05, -0.95, B + y, -0.95, 26);
  }
  rbox(b, t.trim, 3.0, 0.2, 2.7, 0.55, B + 2.0, -0.95, undefined, 0.06);
  b.cyl(t.roof, 1.36, 0.2, -0.95, B + 2.0, -0.95, 26);
  snowCap(b, 2.8, 2.5, 0.6, B + 2.2, -0.95);
  snowDisc(b, 1.28, -0.95, B + 2.2, -0.95);
  // ribbon windows round the drum (they face the camera), dial and door on the wing front
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.45 + (i / 5) * Math.PI * 1.15;
    g.box(t.warm, 0.4, 0.3, 0.05, -0.95 + Math.cos(a) * 1.31, B + 1.38, -0.95 - Math.sin(a) * 1.31, { ry: Math.PI / 2 - a });
  }
  b.torus(t.roof, 0.42, 0.07, 1.2, B + 1.3, 0.36);
  g.cyl(t.warm, 0.36, 0.05, 1.2, B + 1.3 - 0.025, 0.36, 18, 0.36, { rx: Math.PI / 2 });
  b.box(MACHINE_TONES[6].crimson, 0.05, 0.3, 0.04, 1.2, B + 1.17, 0.41, { rz: 0.5 });
  rbox(b, t.trim, 0.8, 1.2, 0.12, 0.2, B, 0.36, undefined, 0.05);
  g.box(t.warm, 0.56, 0.32, 0.05, 0.2, B + 0.72, 0.42);
  // a giant radio-set facade on the back wall (faces the camera): grille, dial, two knobs
  rbox(b, MACHINE_TONES[6].honey, 1.5, 1.1, 0.12, 0.85, B + 0.45, -2.27, undefined, 0.06);
  for (let i = 0; i < 5; i++) b.box(t.roofD, 0.06, 0.62, 0.05, 0.4 + i * 0.16, B + 0.6, -2.35);
  g.cyl(t.warm, 0.2, 0.05, 1.3, B + 0.95, -2.35, 16, 0.2, { rx: Math.PI / 2 });
  for (const x of [1.15, 1.45]) b.sph(t.trim, 0.07, x, B + 0.65, -2.36);
  // gramophone horn on the wing roof
  b.cyl(t.trim, 0.1, 0.45, 1.5, B + 2.25, -0.45, 8);
  b.cone(t.roof, 0.42, 0.75, 1.5, B + 2.95, -0.2, 14, { rx: -Math.PI / 2 });
  // crown: copper lattice mast on the drum, beacon
  lattice(b, t.roof, -0.95, -0.95, B + 2.3, 2.0, 0.75, 0.24, 4, 0.08);
  b.cyl(t.trim, 0.06, 0.55, -0.95, B + 4.3, -0.95, 8);
  lamp(b, g, t.trim, FIRE_GLOW, -0.95, B + 5.02, -0.95, 0.12);
  // the turning dipole array
  p.cyl(t.trim, 0.14, 0.18, 0, -0.09, 0, 10);
  p.beam(t.wall, [-0.95, 0, 0], [0.95, 0, 0], 0.08);
  for (const s of [-1, 1]) {
    p.beam(MACHINE_TONES[6].honey, [s * 0.85, -0.36, 0], [s * 0.85, 0.36, 0], 0.05);
    p.sph(t.roof, 0.09, s * 0.85, 0.4, 0);
    p.sph(t.roof, 0.09, s * 0.85, -0.4, 0);
  }
  p.beam(t.wall, [0, 0, -0.42], [0, 0, 0.42], 0.06);
  return { at: [-0.95, B + 4.45, -0.95], axis: 'y', mode: 'spin', speed: 0.18 };
};

// ---------------------------------------------------------------------------
// era 7 — Oil: honey bodies, crimson pipes, amber crude in sight glasses, peach flares (crude is never black)
// ---------------------------------------------------------------------------

/** Amber sight glass: a glowing vertical strip in a charcoal frame on a cylinder of radius r, facing yaw `a`. */
function sightGlass(b: Kit, g: Kit, t: Tones, x: number, y: number, z: number, r: number, h: number, a: number): void {
  const sx = x + Math.sin(a) * r;
  const sz = z + Math.cos(a) * r;
  rbox(b, t.trim, 0.2, h + 0.12, 0.08, sx, y - 0.06, sz, { ry: a }, 0.03);
  g.box(t.resGlow, 0.11, h, 0.05, sx + Math.sin(a) * 0.04, y, sz + Math.cos(a) * 0.04, { ry: a });
}

/** A charcoal ring platform with a crimson guard rail round a column of radius r at height y. */
function ringDeck(k: Kit, t: Tones, x: number, y: number, z: number, r: number): void {
  k.cyl(t.trim, r + 0.28, 0.07, x, y, z, 16);
  k.torus(t.accent, r + 0.26, 0.03, x, y + 0.36, z, { rx: Math.PI / 2 }, 18);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.beam(t.accent, [x + Math.cos(a) * (r + 0.26), y, z + Math.sin(a) * (r + 0.26)], [x + Math.cos(a) * (r + 0.26), y + 0.36, z + Math.sin(a) * (r + 0.26)], 0.03);
  }
}

/** Flare stack with a soft peach flame (body + glow), top at y0 + h. */
function flare(b: Kit, g: Kit, t: Tones, x: number, y0: number, z: number, h: number): void {
  b.cyl(t.trim, 0.12, h, x, y0, z, 8, 0.09);
  for (let y = y0 + 0.8; y < y0 + h - 0.3; y += 1.1) b.cyl(t.accent, 0.13, 0.12, x, y, z, 8);
  b.cyl(t.trimL, 0.17, 0.2, x, y0 + h, z, 10);
  g.sph(FIRE_GLOW, 0.24, x, y0 + h + 0.35, z, { sy: 1.5 });
  g.sph(t.warm, 0.13, x, y0 + h + 0.3, z, { sy: 1.4 });
}

/** oilPump: a chunky honey pumpjack nods over a crimson wellhead; amber crude fills the tank's sight glass. */
const oilPump: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T7;
  plinth(b, t);
  rbox(b, t.plinth, 1.9, 0.22, 3.6, 0, P, -0.3, undefined, 0.06);
  stripes(b, 0, P + 0.11, 1.51, 1.9, 0.1, t.body, t.trim);
  // samson post: two charcoal A-frames up to the bearing
  const top = P + 2.6;
  for (const x of [-0.42, 0.42]) {
    b.beam(t.trim, [x, P + 0.22, 0.45], [x * 0.3, top, -0.3], 0.17);
    b.beam(t.trim, [x, P + 0.22, -1.05], [x * 0.3, top, -0.3], 0.17);
  }
  b.beam(t.body, [-0.38, P + 1.2, 0.1], [0.38, P + 1.2, 0.1], 0.09);
  hcyl(b, t.accent, 0.2, 0.42, 0, top, -0.3, 'x', 12);
  ladder(b, t.trimL, 0.55, P + 0.22, P + 2.1, -0.95, false);
  // gearbox and crank with crimson counterweights (back)
  rbox(b, t.accent, 0.9, 0.85, 0.8, 0, P + 0.22, -1.65, undefined, 0.08);
  rbox(b, t.trim, 0.94, 0.1, 0.84, 0, P + 1.07, -1.65, undefined, 0.03);
  snowCap(b, 0.8, 0.7, 0, P + 1.17, -1.65);
  for (const s of [-1, 1]) {
    b.beam(t.trim, [s * 0.52, P + 0.85, -1.65], [s * 0.52, P + 0.6, -1.2], 0.12);
    rbox(b, t.accent, 0.12, 0.55, 0.55, s * 0.55, P + 0.35, -1.05, undefined, 0.06);
  }
  // wellhead: crimson valve stack with a handwheel (front centre, low enough for the worker to stand by)
  b.cyl(t.metal, 0.17, 0.55, 0, P + 0.22, 1.05, 10);
  rbox(b, t.accent, 0.42, 0.26, 0.42, 0, P + 0.5, 1.05, undefined, 0.06);
  hcyl(b, t.accent, 0.09, 0.8, 0, P + 0.62, 1.05, 'x', 8);
  b.torus(t.body, 0.16, 0.035, 0.45, P + 0.62, 1.05, { ry: Math.PI / 2 }, 12);
  // the crude tank (back left, toward the camera): honey drum, crimson bands, amber sight glass, snow cap
  const tx = -1.55;
  const tz = -1.35;
  b.cyl(t.body, 0.75, 1.65, tx, P, tz, 18);
  for (const y of [0.3, 1.35]) b.cyl(t.accent, 0.77, 0.1, tx, P + y, tz, 18);
  sightGlass(b, g, t, tx, P + 0.45, tz, 0.76, 0.8, Math.PI * 1.25);
  sightGlass(b, g, t, tx, P + 0.45, tz, 0.76, 0.8, Math.PI * 0.6);
  b.cone(t.bodyD, 0.78, 0.3, tx, P + 1.65, tz, 18);
  snowDisc(b, 0.62, tx, P + 1.82, tz);
  ladder(b, t.trimL, tx + 0.78, P, P + 1.65, tz, false);
  // pump shed (back right) with a warm window and a crimson door
  rbox(b, t.wall, 1.0, 1.0, 0.9, 1.65, P, -1.6, undefined, 0.06);
  roofSlab(b, t.accent, 1.0, 0.9, 1.65, P + 1.0, -1.6);
  win(b, g, t.warm, t.trim, 1.65, P + 0.45, -2.06, 0.4, 0.36, Math.PI);
  win(b, g, t.warm, t.trim, 1.14, P + 0.45, -1.6, 0.4, 0.36, -Math.PI / 2);
  // flow line: wellhead → tank (crimson, on little trestles)
  b.beam(t.accent, [-0.2, P + 0.55, 1.05], [-1.2, P + 0.55, 0.6], 0.1);
  b.beam(t.accent, [-1.2, P + 0.55, 0.6], [-1.45, P + 0.55, -0.6], 0.1);
  for (const [x, z] of [[-0.75, 0.82], [-1.33, 0.0]] as const) b.beam(t.trim, [x, P, z], [x, P + 0.5, z], 0.06);
  // little barrels of amber crude (front right)
  for (const [x, z] of [[1.0, 0.75], [1.4, 0.95], [1.2, 0.45]] as const) {
    b.cyl(t.res, 0.2, 0.46, x, P, z, 12);
    b.cyl(t.body, 0.21, 0.05, x, P + 0.12, z, 12);
    b.cyl(t.body, 0.21, 0.05, x, P + 0.34, z, 12);
  }
  // the walking beam: honey girder, horsehead over the well, charcoal bridle, tail bearing
  rbox(p, t.body, 0.36, 0.38, 3.2, 0, -0.19, 0.0, undefined, 0.07);
  stripes(p, 0.19, 0, 0, 2.6, 0.12, t.bodyL, t.body, true);
  p.prismXY(t.bodyL, [[0, 0.2], [0, -1.0], [0.25, -0.85], [0.42, -0.35], [0.38, 0.15]], 0.34, -0.17, 0, 1.6, { ry: -Math.PI / 2 });
  p.beam(t.trimL, [0, -1.0, 1.98], [0, -1.65, 1.98], 0.05);
  rbox(p, t.trim, 0.44, 0.2, 0.44, 0, 0.16, 0, undefined, 0.05);
  rbox(p, t.trim, 0.3, 0.25, 0.3, 0, -0.45, -1.4, undefined, 0.05);
  return { at: [0, top + 0.22, -0.3], axis: 'x', mode: 'swing', speed: 0.32, amp: 0.2 };
};

/** refinery: cream distillation columns with crimson bands and amber sight glasses, a honey sphere, a peach flare; the cooler fan turns. */
const refinery: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T7;
  const plastic = MATERIALS.plastic;
  plinth(b, t);
  // columns (back right): tall and short, with ring decks and ladders
  const cols: readonly [number, number, number, number][] = [[1.15, -1.25, 0.55, 4.5], [0.0, -1.6, 0.42, 3.5]];
  for (const [x, z, r, h] of cols) {
    b.cyl(t.wall, r, h, x, P, z, 16);
    for (let y = 0.6; y < h - 0.3; y += 0.9) b.cyl(t.accent, r + 0.03, 0.1, x, P + y, z, 16);
    b.dome(t.wallD, r, x, P + h, z);
    b.sph(SNOW, r * 0.72, x, P + h + r * 0.62, z, { sy: 0.4 });
    sightGlass(b, g, t, x, P + 0.9, z, r + 0.02, h - 1.6, Math.PI * 1.25);
    ringDeck(b, t, x, P + h * 0.62, z, r);
    ladder(b, t.trimL, x - r - 0.05, P, P + h - 0.2, z, false);
  }
  // honey sphere tank on legs (left, toward the camera)
  const sx = -1.35;
  const sz = -1.15;
  for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.beam(t.trim, [sx + a * 0.62, P, sz + c * 0.62], [sx + a * 0.42, P + 1.1, sz + c * 0.42], 0.1);
  b.sph(t.body, 0.85, sx, P + 1.5, sz);
  b.torus(t.accent, 0.86, 0.05, sx, P + 1.5, sz, { rx: Math.PI / 2 }, 24);
  b.sph(SNOW, 0.55, sx, P + 2.22, sz, { sy: 0.32 });
  ladder(b, t.trimL, sx + 0.9, P, P + 1.5, sz, false);
  // pipe rack (crimson) joining sphere, columns and the pellet hopper
  for (const y of [1.1, 1.6]) b.beam(t.accent, [sx + 0.6, P + y, -0.35], [1.15, P + y, -0.35], 0.1);
  for (const x of [-0.6, 0.5]) b.beam(t.trim, [x, P, -0.35], [x, P + 1.7, -0.35], 0.09);
  // flare stack (back right corner)
  flare(b, g, t, 2.0, P, -2.05, 4.65);
  // control hut (left front) with warm windows
  rbox(b, t.wall, 1.1, 0.95, 0.8, -1.45, P, 0.35, undefined, 0.06);
  roofSlab(b, t.accent, 1.1, 0.8, -1.45, P + 0.95, 0.35);
  win(b, g, t.warm, t.trim, -2.01, P + 0.4, 0.35, 0.42, 0.34, -Math.PI / 2);
  win(b, g, t.warm, t.trim, -1.45, P + 0.4, -0.06, 0.5, 0.34, Math.PI);
  // plastic pellet hopper (front right) brimming with sky-blue pellets
  for (const [x, z] of [[0.75, 0.25], [1.45, 0.25], [0.75, 0.85], [1.45, 0.85]] as const) b.beam(t.trim, [x, P, z], [x, P + 0.75, z], 0.07);
  b.cyl(t.wall, 0.5, 0.45, 1.1, P + 0.7, 0.55, 14, 0.55);
  b.cone(t.wallD, 0.5, 0.4, 1.1, P + 0.3, 0.55, 14, { rx: Math.PI });
  lumps(b, [plastic.color, lift(plastic.color, 0.4)], 1.1, P + 1.08, 0.55, 0.38, 12, 71, 0.08);
  b.beam(t.accent, [1.1, P + 1.2, 0.2], [0.6, P + 1.6, -0.35], 0.08);
  // air cooler (middle front) on legs; its fan turns
  for (const [x, z] of [[-0.75, 0.25], [0.15, 0.25], [-0.75, 1.05], [0.15, 1.05]] as const) b.beam(t.trim, [x, P, z], [x, P + 0.75, z], 0.07);
  rbox(b, t.metal, 1.1, 0.3, 1.0, -0.3, P + 0.75, 0.65, undefined, 0.05);
  b.cyl(t.trim, 0.66, 0.12, -0.3, P + 1.05, 0.65, 18);
  p.cyl(t.trim, 0.1, 0.12, 0, -0.06, 0, 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    p.box(t.body, 0.5, 0.04, 0.2, Math.cos(a) * 0.32, 0, -Math.sin(a) * 0.32, { ry: a, rx: 0.25 });
  }
  p.torus(t.accent, 0.62, 0.025, 0, 0.0, 0, { rx: Math.PI / 2 }, 20);
  return { at: [-0.3, P + 1.22, 0.65], axis: 'y', mode: 'spin', speed: 0.9 };
};

/** gasWell: a crimson valve tree in a honey safety cage, a separator tank, blue gas bottles and a peach flare; the compressor flywheel turns. */
const gasWell: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T7;
  const gas = MATERIALS.gas;
  plinth(b, t);
  // wellhead tree (centre left) in a honey cage
  const wx = -0.45;
  const wz = -0.35;
  rbox(b, t.plinth, 1.5, 0.16, 1.5, wx, P, wz, undefined, 0.05);
  stripes(b, wx, P + 0.16, wz + 0.76, 1.5, 0.08, t.body, t.trim);
  b.cyl(t.metal, 0.2, 0.4, wx, P + 0.16, wz, 10);
  for (let i = 0; i < 3; i++) {
    const y = P + 0.56 + i * 0.5;
    rbox(b, t.accent, 0.46, 0.3, 0.46, wx, y, wz, undefined, 0.07);
    b.torus(t.body, 0.2, 0.04, wx + 0.38, y + 0.15, wz, { ry: Math.PI / 2 }, 12);
    if (i < 2) b.cyl(t.metal, 0.12, 0.2, wx, y + 0.3, wz, 10);
  }
  hcyl(b, t.accent, 0.1, 1.3, wx, P + 1.15, wz, 'z', 8);
  b.cyl(t.trimL, 0.14, 0.24, wx, P + 2.06, wz, 10);
  g.sph(t.glow, 0.09, wx, P + 2.4, wz);
  for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.beam(t.body, [wx + a * 0.65, P + 0.16, wz + c * 0.65], [wx + a * 0.65, P + 1.9, wz + c * 0.65], 0.08);
  for (const y of [P + 1.0, P + 1.9]) {
    b.beam(t.body, [wx - 0.65, y, wz - 0.65], [wx + 0.65, y, wz - 0.65], 0.07);
    b.beam(t.body, [wx - 0.65, y, wz + 0.65], [wx + 0.65, y, wz + 0.65], 0.07);
    b.beam(t.body, [wx - 0.65, y, wz - 0.65], [wx - 0.65, y, wz + 0.65], 0.07);
    b.beam(t.body, [wx + 0.65, y, wz - 0.65], [wx + 0.65, y, wz + 0.65], 0.07);
  }
  snowCap(b, 1.25, 1.25, wx, P + 1.94, wz);
  // separator: a honey drum lying on saddles (back), with sight glasses and a crimson line to the tree
  const tz = -1.75;
  for (const x of [-0.4, 1.0]) rbox(b, t.trim, 0.3, 0.45, 0.8, x, P, tz, undefined, 0.04);
  hcyl(b, t.body, 0.55, 2.4, 0.3, P + 0.95, tz, 'x', 18);
  for (const s of [-1, 1]) b.sph(t.body, 0.55, 0.3 + s * 1.2, P + 0.95, tz, { sx: 0.45 });
  for (const x of [-0.5, 1.1]) b.cyl(t.accent, 0.565, 0.08, x, P + 0.95 - 0.04, tz, 18, 0.565, { rz: Math.PI / 2 });
  g.box(t.resGlow, 1.2, 0.12, 0.05, 0.3, P + 0.9, tz - 0.56);
  b.sph(SNOW, 0.5, 0.3, P + 1.45, tz, { sx: 2.2, sy: 0.25 });
  b.beam(t.accent, [wx, P + 1.15, wz - 0.65], [wx + 0.2, P + 1.15, tz + 0.5], 0.09);
  // flare (back right corner)
  flare(b, g, t, 1.95, P, -0.75, 4.4);
  // gas bottle rack (front right): blue bottles with cream caps
  rbox(b, t.trim, 1.2, 0.1, 0.55, 1.2, P, 0.75, undefined, 0.03);
  for (let i = 0; i < 4; i++) {
    const x = 0.75 + i * 0.3;
    b.cyl(gas.color, 0.12, 0.62, x, P + 0.1, 0.75, 10);
    b.sph(gas.accent, 0.1, x, P + 0.74, 0.75);
  }
  b.beam(t.body, [0.6, P + 0.5, 0.48], [1.8, P + 0.5, 0.48], 0.05);
  // compressor skid (left) and its flywheel (pivot)
  rbox(b, t.accent, 0.7, 0.6, 0.9, -1.85, P, -0.15, undefined, 0.08);
  rbox(b, t.trim, 0.74, 0.08, 0.94, -1.85, P + 0.6, -0.15, undefined, 0.03);
  win(b, g, t.warm, t.trim, -2.21, P + 0.2, -0.15, 0.36, 0.22, -Math.PI / 2);
  hcyl(b, t.metal, 0.08, 0.4, -1.85, P + 0.95, 0.5, 'x', 8);
  wheel(p, 'x', t.body, t.trim, 0, 0, 0, 0.62, 0.08, 6);
  p.torus(t.accent, 0.5, 0.03, 0, 0, 0, { ry: Math.PI / 2 }, 16);
  return { at: [-1.85, P + 0.95, 0.55], axis: 'x', mode: 'spin', speed: 0.55 };
};

/** cracker: a honey cat-cracker vessel with a spinning mixer drive, a tall crimson-banded fractionator and red fuel cans. */
const cracker: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T7;
  const fuel = MATERIALS.fuel;
  plinth(b, t);
  // reactor vessel (centre right): honey, banded, sight glasses facing the camera, dome
  const rx = 0.55;
  const rz = -0.85;
  rbox(b, t.trim, 1.9, 0.3, 1.9, rx, P, rz, undefined, 0.06);
  b.cyl(t.body, 0.78, 2.7, rx, P + 0.3, rz, 20);
  for (const y of [0.35, 1.25, 2.15]) b.cyl(t.accent, 0.8, 0.12, rx, P + 0.3 + y, rz, 20);
  for (const a of [Math.PI * 1.25, Math.PI * 1.55, Math.PI * 0.95]) sightGlass(b, g, t, rx, P + 0.6, rz, 0.79, 1.9, a);
  b.dome(t.bodyD, 0.78, rx, P + 3.0, rz, { sy: 0.6 });
  b.sph(SNOW, 0.55, rx, P + 3.4, rz, { sy: 0.35 });
  ringDeck(b, t, rx, P + 2.2, rz, 0.78);
  b.cyl(t.trim, 0.22, 0.5, rx, P + 3.35, rz, 10);
  // fractionator (back right corner): slim cream tower, crimson bands, top lamp
  const fx = 1.8;
  const fz = -1.9;
  b.cyl(t.wall, 0.38, 4.6, fx, P, fz, 14);
  for (let y = 0.5; y < 4.3; y += 0.7) b.cyl(t.accent, 0.4, 0.09, fx, P + y, fz, 14);
  b.dome(t.wallD, 0.38, fx, P + 4.6, fz);
  lamp(b, g, t.trim, FIRE_GLOW, fx, P + 5.12, fz, 0.1);
  ladder(b, t.trimL, fx - 0.42, P, P + 4.4, fz, false);
  b.beam(t.accent, [fx - 0.3, P + 3.8, fz + 0.2], [rx + 0.3, P + 3.0, rz - 0.4], 0.1);
  // regenerator (left, toward the camera): squat cream drum and crimson risers into the reactor
  const gx = -1.35;
  const gz = -1.2;
  b.cyl(t.wall, 0.62, 1.7, gx, P, gz, 16);
  b.cyl(t.accent, 0.64, 0.1, gx, P + 0.5, gz, 16);
  b.cyl(t.accent, 0.64, 0.1, gx, P + 1.2, gz, 16);
  b.dome(t.wallD, 0.62, gx, P + 1.7, gz, { sy: 0.5 });
  b.sph(SNOW, 0.42, gx, P + 1.96, gz, { sy: 0.32 });
  win(b, g, t.resGlow, t.trim, gx - 0.45, P + 0.75, gz - 0.45, 0.24, 0.3, Math.PI * 1.25);
  for (const y of [1.0, 1.5]) b.beam(t.accent, [gx + 0.5, P + y, gz], [rx - 0.7, P + y + 0.5, rz], 0.11);
  // fuel cans (front left of centre)
  for (const [x, z, ry] of [[-0.75, 0.75, 0.2], [-0.35, 0.95, -0.1], [-0.55, 0.45, 0.4]] as const) {
    rbox(b, fuel.color, 0.32, 0.42, 0.18, x, P, z, { ry }, 0.05);
    b.cyl(fuel.accent, 0.04, 0.08, x + 0.08, P + 0.42, z, 6);
  }
  // pump (front right) with a warm gauge
  rbox(b, t.accent, 0.6, 0.55, 0.5, 1.25, P, 0.65, undefined, 0.07);
  g.cyl(t.warm, 0.12, 0.04, 1.25, P + 0.36, 0.91, 12, 0.12, { rx: Math.PI / 2 });
  b.beam(t.accent, [1.25, P + 0.45, 0.4], [rx + 0.5, P + 0.6, rz + 0.5], 0.09);
  // mixer drive on top of the reactor: crossbar paddles round a hub (spins)
  p.cyl(t.accent, 0.18, 0.3, 0, -0.1, 0, 12);
  p.dome(t.body, 0.16, 0, 0.2, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    p.beam(t.trimL, [0, 0.05, 0], [Math.cos(a) * 0.62, 0.05, Math.sin(a) * 0.62], 0.07);
    p.sph(t.accent, 0.11, Math.cos(a) * 0.66, 0.05, Math.sin(a) * 0.66);
  }
  return { at: [rx, P + 3.95, rz], axis: 'y', mode: 'spin', speed: 0.4 };
};

/** snowmobileWorks: a honey hangar under a crimson gable roof; a cute snowmobile turns on the showroom turntable. */
const snowmobileWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T7;
  plinth(b, t);
  // hangar (back right)
  const hx = 0.75;
  const hz = -1.05;
  rbox(b, t.trim, 3.2, 0.3, 2.5, hx, P, hz, undefined, 0.06);
  rbox(b, t.body, 3.0, 1.55, 2.3, hx, P + 0.3, hz, undefined, 0.06);
  for (let i = 0; i < 7; i++) b.box(t.bodyD, 0.05, 1.5, 2.32, hx - 1.35 + i * 0.45, P + 0.32, hz);
  b.gable(hx, hz, P + 1.85, 3.0, 2.3, 1.0, t.roof, t.roofD, t.wall, 0.16);
  // big lit hangar door on the camera-facing side, windows on the back
  rbox(b, t.trim, 0.1, 1.3, 1.5, hx - 1.52, P + 0.3, hz, undefined, 0.03);
  g.box(t.warm, 0.05, 1.12, 1.3, hx - 1.56, P + 0.38, hz);
  for (let i = 0; i < 3; i++) b.box(t.trim, 0.06, 0.04, 1.3, hx - 1.58, P + 0.65 + i * 0.3, hz);
  for (const x of [hx - 0.75, hx + 0.75]) win(b, g, t.warm, t.trim, x, P + 0.85, hz - 1.16, 0.5, 0.42, Math.PI);
  win(b, g, t.warm, t.trim, hx + 0.5, P + 0.85, hz + 1.16, 0.6, 0.42);
  // crown: a rooftop sign board on the ridge (honey frame, peach lights, a snowmobile silhouette in crimson)
  for (const x of [hx - 0.7, hx + 0.7]) b.beam(t.trim, [x, P + 2.75, hz], [x, P + 3.4, hz], 0.08);
  rbox(b, t.wall, 1.9, 0.75, 0.14, hx, P + 3.3, hz, undefined, 0.06);
  rbox(b, t.body, 2.0, 0.08, 0.18, hx, P + 4.04, hz, undefined, 0.03);
  for (let i = 0; i < 7; i++) g.sph(FIRE_GLOW, 0.05, hx - 0.84 + i * 0.28, P + 3.36, hz - 0.08);
  rbox(b, t.accent, 0.9, 0.24, 0.05, hx, P + 3.55, hz - 0.08, undefined, 0.05);
  b.box(t.trim, 1.1, 0.04, 0.05, hx, P + 3.47, hz - 0.08);
  snowCap(b, 1.9, 0.14, hx, P + 4.12, hz);
  // showroom turntable (front left, toward the camera): charcoal ring with honey lights
  const sx = -1.35;
  const sz = -0.55;
  b.cyl(t.trim, 0.98, 0.14, sx, P, sz, 24);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.sph(t.warm, 0.05, sx + Math.cos(a) * 0.92, P + 0.15, sz + Math.sin(a) * 0.92);
  }
  // fuel pump and a stack of plastic panels by the door (front right)
  rbox(b, t.accent, 0.4, 0.8, 0.3, 1.6, P, 0.55, undefined, 0.06);
  g.box(t.warm, 0.24, 0.16, 0.05, 1.6, P + 0.55, 0.71);
  for (let i = 0; i < 3; i++) rbox(b, MATERIALS.plastic.color, 0.7, 0.06, 0.45, 0.8, P + i * 0.07, 0.6, undefined, 0.02);
  // the turntable top and the snowmobile on it (spins)
  p.cyl(t.wall, 0.9, 0.08, 0, 0, 0, 24);
  for (const s of [-1, 1]) {
    rbox(p, t.trimL, 1.3, 0.05, 0.12, 0.0, 0.1, s * 0.3, undefined, 0.02);
    rbox(p, t.trimL, 0.12, 0.05, 0.12, 0.66, 0.15, s * 0.3, { rz: 0.5 }, 0.02);
    p.beam(t.trim, [0.15, 0.12, s * 0.3], [0.15, 0.32, s * 0.22], 0.04);
  }
  rbox(p, t.trim, 1.0, 0.18, 0.46, -0.15, 0.16, 0, undefined, 0.07);
  rbox(p, t.accent, 0.95, 0.3, 0.52, 0.0, 0.3, 0, undefined, 0.12);
  rbox(p, t.body, 0.5, 0.26, 0.54, 0.35, 0.36, 0, { rz: 0.35 }, 0.1);
  rbox(p, t.wall, 0.5, 0.16, 0.36, -0.25, 0.6, 0, undefined, 0.06);
  p.box(t.trimL, 0.06, 0.26, 0.4, 0.5, 0.66, 0, { rz: -0.4 });
  p.beam(t.trim, [0.32, 0.6, -0.22], [0.32, 0.6, 0.22], 0.04);
  p.sph(t.warm, 0.06, 0.62, 0.44, 0);
  return { at: [sx, P + 0.14, sz], axis: 'y', mode: 'spin', speed: 0.12 };
};

// ---------------------------------------------------------------------------
// era 8 — Computer: beige plastic, sea-teal roofs, silicon boules and wafers, gold traces, mint screens, dishes
// ---------------------------------------------------------------------------

/** A beige box building with rounded corners, a sea-teal base band and a teal roof slab with snow. */
function beigeHall(b: Kit, t: Tones, w: number, h: number, d: number, x: number, y: number, z: number): void {
  rbox(b, t.body, w + 0.12, 0.3, d + 0.12, x, y, z, undefined, 0.06);
  rbox(b, t.wall, w, h - 0.3, d, x, y + 0.3, z, undefined, 0.16);
  b.box(t.bodyL, w + 0.02, 0.06, d + 0.02, x, y + h - 0.45, z);
  roofSlab(b, t.roof, w, d, x, y + h, z);
}

/** A run of mint screen panes along a wall (faces yaw ry), centred at (x, z), `n` panes. */
function screens(b: Kit, g: Kit, t: Tones, x: number, y: number, z: number, n: number, pitch: number, w: number, h: number, ry: number): void {
  const ax = Math.cos(ry);
  const az = -Math.sin(ry);
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * pitch;
    win(b, g, i % 3 === 1 ? t.warm : t.glow, t.trim, x + ax * o, y, z + az * o, w, h, ry);
  }
}

/** sandPit: sand terraces feed a bucket-wheel dredge; two crystal pullers grow silicon boules under teal domes and a dish. */
const sandPit: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T8;
  const sand = palette(8).floor.processing;
  plinth(b, t);
  // sand terraces and a teal settling pond (left, low, toward the camera)
  rbox(b, mixHex(sand, GOLD, 0.25), 2.4, 0.45, 1.4, -1.0, P, -1.55, undefined, 0.2);
  rbox(b, mixHex(sand, GOLD, 0.12), 1.9, 0.25, 1.0, -1.1, P + 0.45, -1.7, undefined, 0.12);
  b.sph(SNOW, 0.45, -1.4, P + 0.72, -1.7, { sx: 1.6, sy: 0.25 });
  rbox(b, t.trim, 1.9, 0.14, 1.3, -1.15, P, 0.15, undefined, 0.06);
  g.box(mixHex(t.glow, palette(8).accent, 0.55), 1.7, 0.03, 1.1, -1.15, P + 0.12, 0.15);
  // the dredge cab (centre) on tracks with its boom out to the wheel
  for (const z of [-0.85, -0.05]) rbox(b, t.trim, 1.3, 0.3, 0.32, 0.3, P, z, undefined, 0.14);
  rbox(b, t.wall, 1.1, 0.85, 0.9, 0.3, P + 0.3, -0.45, undefined, 0.1);
  roofSlab(b, t.roof, 1.1, 0.9, 0.3, P + 1.15, -0.45, 0.12);
  win(b, g, t.glow, t.trim, -0.26, P + 0.6, -0.45, 0.5, 0.3, -Math.PI / 2);
  b.beam(t.metal, [-0.2, P + 0.9, -0.45], [-1.65, P + 1.15, -0.45], 0.14);
  // crystal pullers (back right): beige towers, teal domes, mint viewports with a silicon boule inside
  for (const [x, z, h] of [[0.85, -1.75, 2.9], [1.85, -1.15, 3.5]] as const) {
    b.cyl(t.body, 0.5, 0.35, x, P, z, 16);
    b.cyl(t.wall, 0.42, h, x, P + 0.35, z, 16);
    b.cyl(t.bodyL, 0.44, 0.07, x, P + 0.35 + h * 0.65, z, 16);
    g.box(t.resGlow, 0.24, 0.6, 0.05, x - 0.3, P + 0.9, z - 0.3, { ry: Math.PI * 1.25 });
    b.dome(t.roof, 0.44, x, P + 0.35 + h, z);
    b.sph(SNOW, 0.3, x, P + 0.66 + h, z, { sy: 0.4 });
  }
  // boules ready on a rack (front right)
  rbox(b, t.trim, 1.2, 0.1, 0.5, 1.25, P, 0.75, undefined, 0.03);
  for (const x of [0.85, 1.25, 1.65]) {
    hcyl(b, t.res, 0.15, 0.42, x, P + 0.25, 0.75, 'z', 12);
    b.sph(lift(t.res, 0.3), 0.15, x, P + 0.25, 0.97, { sz: 0.4 });
  }
  // crown: a satellite dish on the tall puller
  dish(b, t.wall, t.roof, t.trim, 1.85, P + 4.35, -1.15, 0.5, 0.7);
  b.cyl(t.trim, 0.06, 0.3, 1.85, P + 4.05, -1.15, 8);
  // the bucket wheel (left end of the boom): steel ring, teal buckets
  p.torus(t.metal, 0.75, 0.08, 0, 0, 0, { ry: Math.PI / 2 }, 18);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.box(t.roof, 0.34, 0.24, 0.3, 0, Math.sin(a) * 0.8, Math.cos(a) * 0.8, { rx: -a });
    p.beam(t.metalL, [0, 0, 0], [0, Math.sin(a) * 0.72, Math.cos(a) * 0.72], 0.05);
  }
  p.sph(t.trim, 0.12, 0, 0, 0);
  return { at: [-1.8, P + 1.15, -0.45], axis: 'x', mode: 'spin', speed: 0.3 };
};

/** goldPanner: a rocker sluice washes the shore; the big spiral pan spins out gold flecks into a glinting hopper. */
const goldPanner: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T8;
  const gold = MATERIALS.gold;
  plinth(b, t);
  // back terrace with a water tank and a beige control hut
  rbox(b, t.trim, 4.4, 0.45, 1.3, 0, P, -1.6, undefined, 0.08);
  snowCap(b, 4.3, 1.2, 0, P + 0.45, -1.6);
  const tY = P + 0.5;
  b.cyl(t.wall, 0.55, 1.5, -1.5, tY, -1.6, 16, 0.5);
  for (const y of [0.3, 1.1]) b.cyl(t.roof, 0.57, 0.12, -1.5, tY + y, -1.6, 16);
  b.dome(t.roof, 0.52, -1.5, tY + 1.5, -1.6);
  b.sph(SNOW, 0.4, -1.5, tY + 1.78, -1.6, { sy: 0.4 });
  beigeHall(b, t, 1.3, 1.25, 1.0, 1.4, tY, -1.6);
  screens(b, g, t, 1.4, tY + 0.55, -2.12, 2, 0.5, 0.36, 0.3, Math.PI);
  win(b, g, t.glow, t.trim, 1.4, tY + 0.55, -1.08, 0.6, 0.3);
  // crown: floodlamp mast with a dish
  b.cyl(t.trim, 0.07, 2.0, 1.85, tY + 1.45, -1.85, 8);
  dish(b, t.wall, t.roof, t.trim, 1.85, tY + 3.25, -1.85, 0.42, 0.6);
  lamp(b, g, t.trim, t.warm, 1.6, tY + 2.4, -1.75, 0.1);
  // water feed into a sloping sluice on pewter legs
  b.beam(t.roof, [-1.5, tY + 0.3, -1.05], [-1.0, P + 1.4, -0.6], 0.16);
  for (const [x, z] of [[-1.25, -0.85], [-0.55, -0.85], [-1.25, -0.2], [-0.55, -0.2]] as const) b.beam(t.metal, [x, P, z], [x, P + 1.15, z], 0.09);
  rbox(b, t.trim, 0.8, 0.12, 1.4, -0.9, P + 1.15, -0.45, { rx: -0.25 }, 0.04);
  g.box(mixHex(t.glow, palette(8).accent, 0.6), 0.6, 0.04, 1.3, -0.9, P + 1.25, -0.45, { rx: -0.25 });
  // panning basin on a beige drum
  b.cyl(t.wall, 1.05, 0.62, 0.3, P, 0.2, 20, 1.0);
  b.cyl(t.roof, 1.07, 0.12, 0.3, P + 0.18, 0.2, 20);
  b.torus(gold.accent, 1.04, 0.06, 0.3, P + 0.66, 0.2, { rx: Math.PI / 2 }, 24);
  // gold hopper (right) with glinting nuggets
  rbox(b, gold.accent, 0.8, 0.5, 0.7, 1.8, P, 0.2, undefined, 0.06);
  lumps(b, [gold.color, lift(gold.color, 0.35)], 1.8, P + 0.55, 0.2, 0.25, 6, 81, 0.1);
  g.sph(mixHex(gold.color, CREAM, 0.4), 0.07, 1.7, P + 0.7, 0.22);
  g.sph(mixHex(gold.color, CREAM, 0.4), 0.06, 1.9, P + 0.68, 0.12);
  // the spinning pan: beige dish with spiral riffles and gold flecks
  p.lathe(t.wall, [[0.0, 0], [0.7, 0.04], [0.92, 0.2], [0.95, 0.24]], 0, 0, 0, 20);
  p.cone(t.metal, 0.16, 0.26, 0, 0.02, 0, 10);
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 5; i++) {
      const a = arm * ((Math.PI * 2) / 3) + i * 0.32;
      const r = 0.22 + i * 0.14;
      p.box(t.roof, 0.16, 0.05, 0.05, Math.cos(a) * r, 0.06 + i * 0.02, Math.sin(a) * r, { ry: -a + Math.PI / 2 });
      if (i % 2) p.sph(gold.color, 0.05, Math.cos(a + 0.15) * r, 0.1 + i * 0.02, Math.sin(a + 0.15) * r);
    }
  }
  return { at: [0.3, P + 0.66, 0.2], axis: 'y', mode: 'spin', speed: 0.35 };
};

/** chipFab: a rounded beige clean room ringed by mint windows, a giant silicon wafer on its back wall; the roof dish sweeps. */
const chipFab: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T8;
  const chip = MATERIALS.chip;
  plinth(b, t);
  const hz = -0.8;
  beigeHall(b, t, 4.1, 2.3, 2.6, 0, P, hz);
  screens(b, g, t, -0.6, P + 1.2, hz - 1.31, 4, 0.6, 0.42, 0.42, Math.PI);
  screens(b, g, t, -2.06, P + 1.2, hz, 3, 0.65, 0.42, 0.42, -Math.PI / 2);
  screens(b, g, t, 0.6, P + 1.2, hz + 1.31, 3, 0.65, 0.42, 0.42, 0);
  // giant wafer on the back wall (faces the camera): silicon disc with a gold-edged grid of chips
  b.cyl(t.resD, 0.82, 0.06, 1.25, P + 1.25, hz - 1.33, 28, 0.82, { rx: Math.PI / 2 });
  b.cyl(lift(t.res, 0.35), 0.74, 0.06, 1.25, P + 1.25, hz - 1.37, 28, 0.74, { rx: Math.PI / 2 });
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (i * i + j * j > 5) continue;
      b.box((i + j) % 2 ? chip.color : mixHex(chip.color, t.res, 0.4), 0.2, 0.2, 0.03, 1.25 + i * 0.25, P + 1.15 + j * 0.25, hz - 1.4);
    }
  }
  g.box(chip.accent, 0.08, 0.08, 0.03, 1.25, P + 1.15, hz - 1.42);
  // airlock porch (front left) with a mint door
  rbox(b, t.wall, 1.1, 1.3, 0.6, -1.3, P, hz + 1.55, undefined, 0.1);
  roofSlab(b, t.roof, 1.1, 0.6, -1.3, P + 1.3, hz + 1.55, 0.1);
  g.box(t.glow, 0.6, 0.9, 0.05, -1.3, P + 0.1, hz + 1.87);
  // roof: air handlers with grilles and a little exhaust stack
  for (const [x, z] of [[-1.2, hz - 0.5], [-0.3, hz - 0.5]] as const) {
    rbox(b, t.metalL, 0.75, 0.45, 0.75, x, P + 2.46, z, undefined, 0.06);
    for (let i = 0; i < 3; i++) b.box(t.trim, 0.6, 0.04, 0.04, x, P + 2.56 + i * 0.12, z - 0.38);
    snowCap(b, 0.66, 0.66, x, P + 2.91, z);
  }
  chimney(b, t.metalL, t.roof, -1.6, P + 2.46, hz + 0.6, 0.18, 0.9);
  // dish mount (right of the roof)
  b.cyl(t.trim, 0.32, 0.25, 1.1, P + 2.46, hz + 0.1, 14);
  // the dish (sweeps left and right)
  p.cyl(t.trim, 0.1, 0.5, 0, 0, 0, 10);
  dish(p, t.wall, t.roof, t.trim, 0, 0.75, 0, 0.72, 0.65);
  return { at: [1.1, P + 2.71, hz + 0.1], axis: 'y', mode: 'swing', speed: 0.12, amp: 0.9 };
};

/** boardShop: a two-tier beige hall with a warm solder tunnel; the pick-and-place head bobs; a giant circuit board crowns the roof. */
const boardShop: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T8;
  const board = MATERIALS.board;
  plinth(b, t);
  // two tiers: a long low hall (back) and a taller block (right)
  beigeHall(b, t, 3.0, 1.4, 1.8, -0.6, P, -1.25);
  beigeHall(b, t, 1.5, 2.3, 1.8, 1.55, P, -1.25);
  screens(b, g, t, -0.6, P + 0.6, -2.16, 4, 0.65, 0.4, 0.34, Math.PI);
  win(b, g, t.glow, t.trim, -2.11, P + 0.6, -1.25, 0.6, 0.34, -Math.PI / 2);
  screens(b, g, t, 1.55, P + 1.3, -2.16, 2, 0.6, 0.4, 0.36, Math.PI);
  // solder tunnel along the front of the low hall: warm glow through its slot
  rbox(b, t.trim, 2.6, 0.55, 0.6, -0.5, P, 0.15, undefined, 0.08);
  g.box(FIRE_GLOW, 2.2, 0.12, 0.05, -0.5, P + 0.3, 0.46);
  rbox(b, t.roof, 2.7, 0.1, 0.7, -0.5, P + 0.55, 0.15, undefined, 0.03);
  // belt out to the pick-and-place cell (front right) with boards riding on it
  rbox(b, t.trim, 1.4, 0.4, 0.55, 1.25, P, 0.4, undefined, 0.05);
  for (const x of [0.85, 1.3, 1.75]) {
    b.box(board.color, 0.32, 0.03, 0.26, x, P + 0.41, 0.4);
    b.box(board.accent, 0.08, 0.035, 0.08, x - 0.06, P + 0.41, 0.36);
  }
  for (const x of [0.6, 1.95]) b.beam(t.metal, [x, P + 0.4, 0.4], [x, P + 1.65, 0.4], 0.08);
  b.beam(t.metal, [0.6, P + 1.65, 0.4], [1.95, P + 1.65, 0.4], 0.08);
  // crown: a giant green circuit board on the tall block, gold traces, glowing mint LEDs
  for (const x of [1.1, 2.0]) b.beam(t.trim, [x, P + 2.6, -1.25], [x, P + 2.95, -1.25], 0.07);
  rbox(b, board.color, 1.5, 1.05, 0.08, 1.55, P + 2.9, -1.25, undefined, 0.04);
  const rnd = seeded(83);
  for (let i = 0; i < 6; i++) {
    const y = P + 3.0 + i * 0.15;
    b.box(board.accent, 0.4 + rnd() * 0.7, 0.025, 0.03, 1.2 + rnd() * 0.5, y, -1.3);
  }
  for (const [x, y] of [[1.0, 3.75], [1.4, 3.3], [2.05, 3.65]] as const) b.box(t.trim, 0.2, 0.16, 0.05, x, P + y, -1.32);
  for (let i = 0; i < 4; i++) g.sph(i % 2 ? t.glow : t.warm, 0.045, 1.0 + i * 0.36, P + 3.15, -1.31);
  snowCap(b, 1.5, 0.08, 1.55, P + 3.95, -1.25);
  // pick-and-place head (bobs over the belt): teal carriage, nozzle, a chip in its grip
  rbox(p, t.roof, 0.7, 0.3, 0.4, 0, 0, 0, undefined, 0.06);
  p.cyl(t.metal, 0.05, 0.42, 0, -0.42, 0, 8);
  p.box(MATERIALS.chip.color, 0.18, 0.04, 0.18, 0, -0.46, 0);
  return { at: [1.3, P + 1.2, 0.4], axis: 'y', mode: 'bob', speed: 0.7, amp: 0.36 };
};

/** pcAssembly: a modular bay with a giant beige CRT on the roof smiling in mint; a burn-in carousel of little PCs turns. */
const pcAssembly: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T8;
  const pc = MATERIALS.computer;
  plinth(b, t);
  // the bay (back right)
  beigeHall(b, t, 3.0, 1.8, 2.2, 0.75, P, -1.05);
  screens(b, g, t, 0.75, P + 0.8, -2.16, 4, 0.65, 0.42, 0.38, Math.PI);
  win(b, g, t.glow, t.trim, 0.75, P + 0.8, 0.06, 1.0, 0.38);
  // ribbed roller door on the camera side
  rbox(b, t.trim, 0.08, 1.15, 1.1, -0.76, P + 0.3, -1.05, undefined, 0.02);
  for (let i = 0; i < 6; i++) b.box(t.metalL, 0.05, 0.12, 1.0, -0.8, P + 0.38 + i * 0.17, -1.05);
  // crown: a giant CRT on the roof facing the camera, a mint screen with a smile, a keyboard below it
  const cx = 0.95;
  const cz = -1.1;
  const cy = P + 2.05;
  rbox(b, t.wall, 1.25, 1.0, 1.0, cx, cy, cz, undefined, 0.16);
  rbox(b, t.wallD, 0.85, 0.7, 0.5, cx, cy + 0.15, cz + 0.55, undefined, 0.14);
  rbox(b, t.trim, 1.0, 0.78, 0.06, cx, cy + 0.1, cz - 0.5, undefined, 0.06);
  g.box(t.glow, 0.84, 0.62, 0.04, cx, cy + 0.18, cz - 0.53);
  for (const x of [cx - 0.18, cx + 0.18]) b.box(t.trim, 0.09, 0.14, 0.03, x, cy + 0.55, cz - 0.56);
  for (let i = 0; i < 5; i++) b.box(t.trim, 0.07, 0.06, 0.03, cx - 0.2 + i * 0.1, cy + 0.32 - Math.sin((i / 4) * Math.PI) * 0.08, cz - 0.56);
  b.sph(t.roof, 0.05, cx + 0.48, cy + 0.12, cz - 0.52);
  snowCap(b, 1.1, 0.85, cx, cy + 1.0, cz);
  rbox(b, t.wallD, 1.0, 0.1, 0.35, cx, cy, cz - 0.78, undefined, 0.04);
  // test bench (front right) with a little screen
  rbox(b, t.trim, 1.2, 0.5, 0.55, 1.2, P, 0.55, undefined, 0.05);
  rbox(b, pc.color, 0.42, 0.34, 0.34, 1.0, P + 0.5, 0.55, undefined, 0.06);
  g.box(t.glow, 0.28, 0.2, 0.04, 1.0, P + 0.58, 0.73);
  rbox(b, MATERIALS.board.color, 0.4, 0.04, 0.3, 1.55, P + 0.5, 0.55, undefined, 0.01);
  // carousel plinth (left, toward the camera)
  b.cyl(t.trim, 0.95, 0.14, -1.35, P, -0.85, 24);
  // the burn-in carousel: four little beige PCs with mint screens, facing out (spins)
  p.cyl(t.roof, 0.88, 0.08, 0, 0, 0, 24);
  p.cyl(t.trim, 0.12, 0.6, 0, 0.08, 0, 10);
  p.sph(t.warm, 0.1, 0, 0.72, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 0.6;
    const z = Math.sin(a) * 0.6;
    rbox(p, pc.color, 0.36, 0.3, 0.32, x, 0.08, z, { ry: -a + Math.PI / 2 }, 0.06);
    p.box(pc.accent, 0.24, 0.17, 0.03, x + Math.cos(a) * 0.17, 0.24, z + Math.sin(a) * 0.17, { ry: -a + Math.PI / 2 });
  }
  return { at: [-1.35, P + 0.14, -0.85], axis: 'y', mode: 'spin', speed: 0.15 };
};

// ---------------------------------------------------------------------------
// era 9 — Nuclear: warm porcelain, jade bands, slate roofs, rounded glowing uranium, honey hazard bands, cotton steam
// ---------------------------------------------------------------------------

/** A porcelain block with a jade base band, a honey hazard band and a slate roof slab. */
function porcelain(b: Kit, t: Tones, w: number, h: number, d: number, x: number, y: number, z: number, hazard = true): void {
  rbox(b, t.body, w + 0.1, 0.32, d + 0.1, x, y, z, undefined, 0.06);
  rbox(b, t.wall, w, h - 0.32, d, x, y + 0.32, z, undefined, 0.14);
  if (hazard) stripes(b, x, y + 0.4, z - d / 2 - 0.01, w - 0.3, 0.12, t.accent, t.trim);
  roofSlab(b, t.roof, w, d, x, y + h, z);
}

/** A cluster of rounded uranium crystals, some glowing, around (x, y, z). */
function uranium(b: Kit, g: Kit, t: Tones, x: number, y: number, z: number, s: number, seed: number): void {
  const rnd = seeded(seed);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 0.3 * s;
    const k = i % 2 ? g : b;
    crystal(k, i % 2 ? t.resGlow : i % 3 ? t.res : lift(t.res, 0.3), x + Math.cos(a) * d, y, z + Math.sin(a) * d, (0.07 + rnd() * 0.05) * s, (0.16 + rnd() * 0.22) * s, { rx: Math.sin(a) * 0.45, rz: Math.cos(a) * 0.45 });
  }
}

/** uraniumMine: a porcelain hoist tower with a honey A-frame and wheel; glowing aqua uranium waits in a lead-lined tray. */
const uraniumMine: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T9;
  plinth(b, t);
  // hoist tower (left back)
  const hx = -0.65;
  const hz = -0.75;
  porcelain(b, t, 1.9, 2.9, 1.9, hx, P, hz);
  for (const x of [hx - 0.45, hx + 0.45]) win(b, g, t.glow, t.trim, x, P + 1.5, hz - 0.96, 0.36, 0.5, Math.PI);
  win(b, g, t.glow, t.trim, hx - 0.96, P + 1.5, hz, 0.4, 0.5, -Math.PI / 2);
  win(b, g, t.warm, t.trim, hx, P + 1.5, hz + 0.96, 0.4, 0.5);
  rbox(b, t.trim, 0.7, 1.0, 0.1, hx, P + 0.32, hz + 0.95, undefined, 0.03);
  // honey A-frame on the roof
  const top = P + 3.1;
  for (const z of [hz - 0.55, hz + 0.55]) {
    b.beam(t.accent, [hx - 0.75, top, z], [hx, top + 1.05, z * 0 + hz + (z - hz) * 0.35], 0.14);
    b.beam(t.accent, [hx + 0.75, top, z], [hx, top + 1.05, hz + (z - hz) * 0.35], 0.14);
  }
  hcyl(b, t.trim, 0.08, 0.6, hx, top + 1.05, hz, 'z', 8);
  lamp(b, g, t.trim, t.glow, hx + 0.7, top + 0.35, hz - 0.7, 0.09);
  // the lead-lined tray of glowing uranium (front middle) and casks (front right)
  rbox(b, t.trim, 1.3, 0.3, 0.8, -0.15, P, 0.9, undefined, 0.08);
  stripes(b, -0.15, P + 0.08, 1.31, 1.2, 0.12, t.accent, t.trim);
  uranium(b, g, t, -0.15, P + 0.28, 0.9, 1.2, 91);
  for (const [x, z] of [[1.15, 0.7], [1.55, 0.95], [1.5, 0.45]] as const) {
    b.cyl(t.metal, 0.22, 0.6, x, P, z, 12);
    b.cyl(t.accent, 0.23, 0.08, x, P + 0.38, z, 12);
    g.cyl(t.glow, 0.15, 0.04, x, P + 0.6, z, 10);
  }
  // shield wall and beacon mast (back right)
  rbox(b, t.wall, 1.7, 1.1, 0.4, 1.3, P, -1.85, undefined, 0.1);
  stripes(b, 1.3, P + 0.55, -2.06, 1.5, 0.22, t.accent, t.trim);
  snowCap(b, 1.6, 0.32, 1.3, P + 1.1, -1.85);
  b.cyl(t.trim, 0.07, 3.6, 2.0, P, -1.2, 8);
  lamp(b, g, t.trim, t.glow, 2.0, P + 3.75, -1.2, 0.14);
  // ore cart track from the tower to the tray
  rails(b, t.metal, t.trimL, 0.75, -1.4, 0.45);
  rbox(b, t.body, 0.6, 0.36, 0.6, 0.75, P + 0.12, -0.6, undefined, 0.05);
  uranium(b, g, t, 0.75, P + 0.46, -0.6, 0.7, 92);
  // the hoist wheel (faces the camera side)
  wheel(p, 'x', t.accent, t.trim, 0, 0, 0, 0.62, 0.08, 6);
  p.torus(t.body, 0.5, 0.03, 0, 0, 0, { ry: Math.PI / 2 }, 16);
  return { at: [hx, top + 1.05, hz], axis: 'x', mode: 'spin', speed: 0.5 };
};

/** graphitePit: a porcelain-rimmed pit of soft graphite blocks; the diamond wire saw rises and falls on its gantry. */
const graphitePit: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T9;
  const gr = MATERIALS.graphite;
  plinth(b, t);
  // the pit: porcelain rim, stepped graphite inside
  const px = -0.45;
  const pz = -0.6;
  for (const [w, d, x, z] of [[3.2, 0.3, px, pz - 1.2], [3.2, 0.3, px, pz + 1.2], [0.3, 2.1, px - 1.45, pz], [0.3, 2.1, px + 1.45, pz]] as const) {
    rbox(b, t.wall, w, 0.45, d, x, P, z, undefined, 0.08);
    snowCap(b, w - 0.04, d - 0.04, x, P + 0.45, z);
  }
  stripes(b, px, P + 0.2, pz - 1.36, 3.0, 0.14, t.accent, t.trim);
  const rnd = seeded(93);
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 3; j++) {
      const h = 0.15 + ((i + j) % 3) * 0.12 + rnd() * 0.05;
      rbox(b, (i + j) % 2 ? gr.color : gr.accent, 0.5, h, 0.62, px - 1.0 + i * 0.5, P, pz - 0.65 + j * 0.65, undefined, 0.05);
    }
  }
  // gantry: two porcelain towers and a slate bridge
  for (const x of [px - 1.75, px + 1.75]) {
    rbox(b, t.wall, 0.45, 2.7, 0.45, x, P, pz, undefined, 0.08);
    b.box(t.body, 0.47, 0.12, 0.47, x, P + 0.6, pz);
    b.box(t.body, 0.47, 0.12, 0.47, x, P + 2.0, pz);
  }
  rbox(b, t.roof, 3.95, 0.28, 0.42, px, P + 2.7, pz, undefined, 0.06);
  snowCap(b, 3.8, 0.34, px, P + 2.98, pz);
  // control cab on the right tower (the crown): slate box, aqua windows, a beacon
  rbox(b, t.wall, 0.9, 0.75, 0.8, px + 1.75, P + 3.1, pz, undefined, 0.1);
  win(b, g, t.glow, t.trim, px + 1.75, P + 3.35, pz - 0.41, 0.5, 0.3, Math.PI);
  win(b, g, t.glow, t.trim, px + 1.29, P + 3.35, pz, 0.45, 0.3, -Math.PI / 2);
  roofSlab(b, t.roof, 0.9, 0.8, px + 1.75, P + 3.85, pz, 0.1);
  lamp(b, g, t.trim, t.accent, px + 1.75, P + 4.25, pz, 0.1);
  // a pallet of cut blocks (front right)
  rbox(b, t.trimL, 1.1, 0.1, 0.7, 1.4, P, 0.85, undefined, 0.03);
  for (const [x, y] of [[1.15, 0], [1.65, 0], [1.4, 0.25]] as const) rbox(b, gr.color, 0.45, 0.24, 0.55, x, P + 0.1 + y, 0.85, undefined, 0.04);
  // the saw carriage: slate trolley, honey wire frame, a glinting diamond wire
  rbox(p, t.roof, 0.7, 0.35, 0.5, 0, 0, 0, undefined, 0.06);
  for (const s of [-1, 1]) p.beam(t.accent, [s * 0.25, 0, 0], [s * 1.3, -0.7, 0], 0.07);
  p.beam(t.metalL, [-1.3, -0.7, 0], [1.3, -0.7, 0], 0.035);
  for (const s of [-1, 1]) p.torus(t.trim, 0.12, 0.04, s * 1.3, -0.7, 0, undefined, 12);
  return { at: [px, P + 2.3, pz], axis: 'y', mode: 'slide', speed: 0.3, amp: 0.38 };
};

/** enricher: a cascade of porcelain centrifuges with aqua rings; fuel rods glow in their rack; the turbine turns on the hall. */
const enricher: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T9;
  const rod = MATERIALS.fuelRod;
  plinth(b, t);
  // the cascade (back, facing the camera): two rows of tall centrifuges on a slate deck with a header pipe
  rbox(b, t.trim, 4.3, 0.15, 1.3, 0, P, -1.6, undefined, 0.05);
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 6; i++) {
      const x = -1.8 + i * 0.6 + r * 0.3;
      const z = -1.95 + r * 0.6;
      const h = 1.5 + r * 0.25;
      b.cyl(t.wall, 0.2, h, x, P + 0.15, z, 12);
      b.cyl(t.body, 0.215, 0.12, x, P + 0.45, z, 12);
      g.cyl(t.glow, 0.205, 0.06, x, P + 0.15 + h * 0.7, z, 12);
      b.dome(t.metalL, 0.2, x, P + 0.15 + h, z);
      b.sph(SNOW, 0.13, x, P + 0.3 + h, z, { sy: 0.45 });
    }
  }
  for (const z of [-1.95, -1.35]) b.beam(t.metal, [-2.0, P + 1.95 + (z + 1.95) * 0.4, z], [1.6, P + 1.95 + (z + 1.95) * 0.4, z], 0.08);
  // the hall (front middle), low so the cascade shows over it
  porcelain(b, t, 3.2, 1.4, 1.3, -0.25, P, -0.1, false);
  win(b, g, t.warm, t.trim, -0.95, P + 0.6, 0.56, 0.5, 0.36);
  win(b, g, t.glow, t.trim, -1.86, P + 0.6, -0.1, 0.5, 0.36, -Math.PI / 2);
  rbox(b, t.trim, 0.7, 1.0, 0.1, 0.35, P + 0.32, 0.55, undefined, 0.03);
  // a tall porcelain stack with jade bands and a cotton puff (back right corner, the crown)
  chimney(b, t.wall, t.body, 1.95, P, -1.95, 0.32, 3.9);
  puff(b, 2.0, P + 4.6, -1.95, 0.9);
  // fuel rod rack (right): slate frame, glowing mint rods
  rbox(b, t.trim, 0.65, 1.3, 0.75, 1.75, P, -0.2, undefined, 0.06);
  for (let i = 0; i < 4; i++) g.cyl(rod.color, 0.06, 1.05, 1.5 + (i % 2) * 0.12, P + 0.15, -0.45 + i * 0.16, 8);
  snowCap(b, 0.6, 0.7, 1.75, P + 1.3, -0.2);
  // turbine housing on the hall roof
  b.cyl(t.roof, 0.66, 0.25, -0.75, P + 1.56, -0.1, 18);
  b.torus(t.body, 0.66, 0.05, -0.75, P + 1.81, -0.1, { rx: Math.PI / 2 }, 20);
  p.cyl(t.trim, 0.12, 0.14, 0, -0.07, 0, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    p.box(t.body, 0.5, 0.04, 0.18, Math.cos(a) * 0.34, 0, -Math.sin(a) * 0.34, { ry: a, rx: 0.3 });
  }
  p.torus(t.accent, 0.6, 0.025, 0, 0.0, 0, { rx: Math.PI / 2 }, 20);
  return { at: [-0.75, P + 1.92, -0.1], axis: 'y', mode: 'spin', speed: 0.9 };
};

/** reactor: a porcelain cooling tower breathing cotton steam, a containment dome with an aqua band, a slate turbine hall. */
const reactor: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T9;
  plinth(b, t);
  // cooling tower (back right)
  const cx = 0.95;
  const cz = -1.0;
  b.lathe(t.wall, [[1.38, 0], [1.22, 1.0], [1.04, 2.0], [0.95, 3.0], [0.97, 3.8], [1.05, 4.35]], cx, P, cz, 22);
  b.lathe(t.body, [[1.4, 0], [1.39, 0.12], [1.38, 0.3]], cx, P, cz, 22);
  b.torus(t.body, 1.01, 0.05, cx, P + 3.55, cz, { rx: Math.PI / 2 }, 24);
  b.torus(t.trimL, 1.05, 0.06, cx, P + 4.35, cz, { rx: Math.PI / 2 }, 24);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.9 + (i / 5) * Math.PI * 0.9;
    b.box(t.trim, 0.32, 0.38, 0.06, cx + Math.cos(a) * 1.36, P + 0.0, cz - Math.sin(a) * 1.36, { ry: Math.PI / 2 - a });
  }
  puff(b, cx - 0.2, P + 4.5, cz, 0.85);
  // containment dome (left middle): porcelain drum, glowing aqua band, slate cap band, snowy dome
  const dx = -1.15;
  const dz = -0.05;
  b.cyl(t.wall, 1.05, 1.25, dx, P, dz, 20);
  b.cyl(t.body, 1.07, 0.18, dx, P, dz, 20);
  g.cyl(t.glow, 1.065, 0.12, dx, P + 0.75, dz, 20);
  b.cyl(t.trim, 1.07, 0.08, dx, P + 0.66, dz, 20);
  b.dome(t.wallD, 1.05, dx, P + 1.25, dz);
  b.sph(SNOW, 0.66, dx, P + 2.05, dz, { sy: 0.45 });
  rbox(b, t.trim, 0.6, 0.8, 0.3, dx, P, dz + 1.05, undefined, 0.05);
  g.box(t.warm, 0.36, 0.3, 0.04, dx, P + 0.4, dz + 1.21);
  // turbine hall (back left, toward the camera) with aqua windows
  porcelain(b, t, 1.7, 1.15, 0.9, -1.25, P, -1.75);
  for (const x of [-1.65, -0.85]) win(b, g, t.glow, t.trim, x, P + 0.55, -2.21, 0.4, 0.3, Math.PI);
  // pipes: dome → hall → tower
  b.beam(t.metal, [dx + 0.5, P + 0.9, dz - 0.6], [-0.7, P + 0.7, -1.35], 0.16);
  b.beam(t.metal, [-0.4, P + 0.6, -1.75], [cx - 1.2, P + 0.6, cz - 0.4], 0.16);
  // power cell crates (front right)
  for (const [x, z] of [[1.15, 0.85], [1.55, 0.85], [1.35, 0.55]] as const) {
    rbox(b, t.trim, 0.3, 0.34, 0.3, x, P, z, undefined, 0.05);
    g.box(t.glow, 0.2, 0.08, 0.04, x, P + 0.18, z + 0.16);
  }
  // steam rising out of the tower (loops up and fades smaller)
  p.sph(STEAM, 0.6, 0, 0, 0);
  p.sph(STEAM, 0.45, 0.32, 0.36, 0.15);
  p.sph(SNOW, 0.42, -0.3, 0.3, -0.12);
  p.sph(SNOW, 0.32, 0.05, 0.6, 0.0);
  return { at: [cx, P + 4.7, cz], axis: 'y', mode: 'rise', speed: 0.16, amp: 0.45 };
};

/** batteryPlant: a porcelain cell hall with aqua charge racks under a giant jade battery; the loading arm swings a fat cell. */
const batteryPlant: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T9;
  const bat = MATERIALS.battery;
  const gr = MATERIALS.graphite;
  plinth(b, t);
  // the hall (back)
  porcelain(b, t, 3.6, 1.9, 1.9, 0.3, P, -1.2);
  // charge racks on the camera-facing walls: rows of aqua bars
  for (let i = 0; i < 5; i++) {
    const x = -1.0 + i * 0.55;
    rbox(b, t.trim, 0.36, 0.95, 0.08, x, P + 0.65, -2.17, undefined, 0.03);
    for (let j = 0; j < 4; j++) g.box(j < 2 + (i % 3) ? t.glow : t.trimL, 0.24, 0.13, 0.04, x, P + 0.72 + j * 0.21, -2.22);
  }
  win(b, g, t.glow, t.trim, -1.51, P + 1.0, -1.2, 0.8, 0.5, -Math.PI / 2);
  win(b, g, t.warm, t.trim, 1.0, P + 0.9, -0.24, 0.8, 0.45);
  // crown: a giant battery on the roof (jade drum, gold cap and nub, aqua charge bars, a snow cap)
  const bx = 0.85;
  const bz = -1.2;
  const by = P + 2.07;
  b.cyl(t.body, 0.62, 1.55, bx, by, bz, 22);
  b.cyl(t.bodyD, 0.63, 0.12, bx, by + 0.05, bz, 22);
  b.cyl(t.accent, 0.62, 0.22, bx, by + 1.55, bz, 22);
  b.cyl(t.accentL, 0.22, 0.22, bx, by + 1.77, bz, 14);
  snowDisc(b, 0.52, bx, by + 1.77, bz);
  for (let j = 0; j < 4; j++) g.box(t.glow, 0.42, 0.18, 0.05, bx - 0.45, by + 0.3 + j * 0.28, bz - 0.45, { ry: Math.PI * 1.25 });
  b.box(t.wall, 0.12, 0.42, 0.05, bx - 0.47, by + 1.6 + 0.02, bz - 0.47, { ry: Math.PI * 1.25 });
  // graphite hopper (left, toward the camera)
  b.cyl(t.wall, 0.5, 0.9, -1.75, P + 0.7, -0.3, 14);
  b.cone(t.wallD, 0.5, 0.5, -1.75, P + 0.2, -0.3, 14, { rx: Math.PI });
  for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.beam(t.trim, [-1.75 + a * 0.4, P, -0.3 + c * 0.4], [-1.75 + a * 0.35, P + 0.75, -0.3 + c * 0.35], 0.07);
  lumps(b, [gr.color, gr.accent], -1.75, P + 1.6, -0.3, 0.36, 7, 95, 0.12);
  // stacking press base and finished batteries (front right)
  b.cyl(t.trim, 0.42, 0.45, -0.25, P, 0.5, 16);
  for (const [x, z] of [[1.2, 0.7], [1.6, 0.7], [1.4, 0.35]] as const) {
    b.cyl(bat.color, 0.15, 0.36, x, P, z, 12);
    b.cyl(bat.accent, 0.15, 0.06, x, P + 0.36, z, 12);
  }
  // the loading arm (swings): a porcelain boom with a jade grab holding a fat cell
  p.cyl(t.body, 0.2, 0.9, 0, 0, 0, 12);
  p.beam(t.wall, [0, 0.85, 0], [-0.95, 0.85, 0.0], 0.16);
  p.beam(t.trim, [-0.95, 0.85, 0], [-0.95, 0.35, 0], 0.07);
  p.cyl(bat.color, 0.2, 0.42, -0.95, -0.12, 0, 14);
  p.cyl(bat.accent, 0.2, 0.08, -0.95, 0.3, 0, 14);
  g.box(t.glow, 0.14, 0.2, 0.04, -0.95, 0.0, 0.2);
  return { at: [-0.25, P + 0.45, 0.5], axis: 'y', mode: 'swing', speed: 0.22, amp: 0.7 };
};

// ---------------------------------------------------------------------------
// era 10 — AI: cream panels, slate-blue roofs with gold seams, lavender rare earth, peach helium-3, sun-gold halos
// ---------------------------------------------------------------------------

/** A cream pod building: slate base, rounded cream walls, a gold seam, a slate roof with snow. */
function pod(b: Kit, t: Tones, w: number, h: number, d: number, x: number, y: number, z: number): void {
  rbox(b, t.body, w + 0.1, 0.28, d + 0.1, x, y, z, undefined, 0.08);
  rbox(b, t.wall, w, h - 0.28, d, x, y + 0.28, z, undefined, 0.22);
  b.box(t.accent, w + 0.02, 0.05, d + 0.02, x, y + h - 0.4, z);
  roofSlab(b, t.roof, w - 0.1, d - 0.1, x, y + h, z, 0.14);
}

/** A floating gold halo (crown): a ring with a thin inner ring and four little sun-gold beads in the glow kit. */
function halo(b: Kit, g: Kit, t: Tones, x: number, y: number, z: number, r: number): void {
  b.torus(t.accent, r, 0.07, x, y, z, { rx: Math.PI / 2 }, 28);
  b.torus(t.accentL, r * 0.82, 0.025, x, y, z, { rx: Math.PI / 2 }, 24);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    g.sph(t.glow, 0.07, x + Math.cos(a) * r, y, z + Math.sin(a) * r);
  }
}

/** A cracked rare-earth geode: a rounded slate-cream shell with lavender crystals inside, some glowing. */
function geode(b: Kit, g: Kit, t: Tones, x: number, y: number, z: number, r: number, seed: number): void {
  b.sph(t.metal, r, x, y + r * 0.55, z, { sy: 0.8 });
  b.sph(t.resD, r * 0.82, x, y + r * 0.62, z - r * 0.22, { sy: 0.72 });
  const rnd = seeded(seed);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * r * 0.5;
    const k = i % 3 === 0 ? g : b;
    crystal(k, i % 3 === 0 ? t.resGlow : i % 2 ? t.res : lift(t.res, 0.3), x + Math.cos(a) * d, y + r * 0.7, z - r * 0.35 + Math.sin(a) * d * 0.6, 0.06 + rnd() * 0.04 * r, 0.12 + rnd() * 0.18 * r, { rx: -0.5 + Math.sin(a) * 0.3, rz: Math.cos(a) * 0.4 });
  }
}

/** nanoFab (Geode Mine): a cream drill pod over a big cracked geode; the gold nano drill turns under a floating halo. */
const nanoFab: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T10;
  plinth(b, t);
  // the big geode (left, toward the camera) in a slate cradle with a gold seam
  b.cyl(t.body, 1.25, 0.2, -0.85, P, -0.75, 22);
  b.torus(t.accent, 1.22, 0.04, -0.85, P + 0.2, -0.75, { rx: Math.PI / 2 }, 26);
  geode(b, g, t, -0.85, P + 0.2, -0.75, 1.05, 101);
  b.sph(SNOW, 0.6, -1.05, P + 1.15, -0.4, { sy: 0.3 });
  // drill gantry: a cream arch over the geode with the drill head hanging from it
  for (const x of [-2.05, 0.35]) {
    rbox(b, t.wall, 0.35, 2.7, 0.5, x, P, -0.75, undefined, 0.14);
    b.box(t.accent, 0.37, 0.05, 0.52, x, P + 2.2, -0.75);
  }
  rbox(b, t.roof, 2.8, 0.3, 0.6, -0.85, P + 2.7, -0.75, undefined, 0.12);
  snowCap(b, 2.7, 0.5, -0.85, P + 3.0, -0.75);
  for (const x of [-1.6, -0.1]) g.box(t.glow, 0.3, 0.06, 0.05, x, P + 2.85, -1.06);
  // control pod (right) with windows, and the crown halo over it
  pod(b, t, 1.4, 1.9, 1.6, 1.45, P, -1.25);
  win(b, g, t.glow, t.trim, 1.45, P + 0.9, -2.06, 0.7, 0.45, Math.PI);
  win(b, g, t.warm, t.trim, 1.45, P + 0.9, -0.44, 0.7, 0.45);
  b.cyl(t.trim, 0.07, 1.0, 1.45, P + 2.04, -1.25, 8);
  halo(b, g, t, 1.45, P + 3.25, -1.25, 0.55);
  g.sph(t.glow, 0.13, 1.45, P + 3.25, -1.25);
  // trays of cut rare earth (front right) and a cream cart (front left of centre)
  rbox(b, t.trim, 1.1, 0.12, 0.6, 1.35, P, 0.75, undefined, 0.04);
  for (const x of [1.05, 1.35, 1.65]) crystal(b, t.res, x, P + 0.12, 0.75, 0.09, 0.14, { rz: x - 1.35 });
  rbox(b, t.wall, 0.7, 0.36, 0.55, -0.3, P, 0.8, undefined, 0.12);
  for (const x of [-0.45, -0.2]) crystal(b, t.res, x, P + 0.36, 0.8, 0.08, 0.12, { rx: 0.3 });
  // the nano drill (spins): gold collar, slate shaft, lavender-tipped bit and three little arms
  p.cyl(t.accent, 0.26, 0.2, 0, -0.1, 0, 16);
  p.cyl(t.body, 0.1, 0.9, 0, -1.0, 0, 10);
  p.cone(t.accentL, 0.14, 0.3, 0, -1.3, 0, 10, { rx: Math.PI });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    p.beam(t.wall, [0, -0.2, 0], [Math.cos(a) * 0.62, -0.45, Math.sin(a) * 0.62], 0.07);
    p.sph(t.accent, 0.08, Math.cos(a) * 0.64, -0.47, Math.sin(a) * 0.64);
  }
  return { at: [-0.85, P + 2.7, -0.75], axis: 'y', mode: 'spin', speed: 0.45 };
};

/** heliumSkimmer (0.9.7 design, restyled): a cream dome hood with gold bands over a peach-shimmering frost vent; the gold ring turns. */
const heliumSkimmer: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T10;
  const he = MATERIALS.helium3;
  plinth(b, t);
  // the vent: a frosted crater ring with a soft peach shimmer inside
  b.cyl(lift(SNOW_SHADE, 0.2), 1.45, 0.16, 0, P, -0.6, 20, 1.55);
  b.torus(SNOW_SHADE, 1.3, 0.14, 0, P + 0.16, -0.6, { rx: Math.PI / 2 }, 24);
  g.cyl(he.accent, 1.05, 0.04, 0, P + 0.14, -0.6, 20);
  // hood on four slate legs, two gold bands, a peach glow skirt under its rim
  for (const [x, z] of [[-1.05, -1.65], [1.05, -1.65], [-1.05, 0.45], [1.05, 0.45]] as const) b.beam(t.trim, [x, P, z], [x * 0.85, P + 1.1, -0.6 + (z + 0.6) * 0.85], 0.14);
  b.cyl(t.wall, 1.3, 0.35, 0, P + 1.0, -0.6, 20, 1.25);
  b.dome(t.wall, 1.25, 0, P + 1.35, -0.6);
  for (const [y, r] of [[1.1, 1.31], [1.85, 1.08]] as const) b.torus(t.accent, r, 0.07, 0, P + y, -0.6, { rx: Math.PI / 2 }, 24);
  g.torus(he.accent, 1.22, 0.05, 0, P + 0.98, -0.6, { rx: Math.PI / 2 }, 24);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 1.0 + (i / 3) * Math.PI * 0.6;
    g.sph(t.glow, 0.09, Math.cos(a) * 1.0, P + 1.75, -0.6 - Math.sin(a) * 1.0 * 0 + Math.sin(a) * 0.55);
  }
  b.sph(SNOW, 0.95, 0, P + 2.2, -0.6, { sy: 0.32 });
  // crown: slate mast with a sun-gold beacon; the ring turns round it
  b.cyl(t.trim, 0.12, 1.3, 0, P + 2.45, -0.6, 10);
  g.sph(t.glow, 0.18, 0, P + 3.85, -0.6);
  // filling pipe down to a rack of cream cryo flasks with peach windows (front right)
  b.beam(t.trimL, [0.9, P + 1.3, -0.1], [1.75, P + 0.9, 0.35], 0.12);
  rbox(b, t.trim, 1.3, 0.12, 0.7, 1.55, P, 0.25, undefined, 0.04);
  for (const x of [1.15, 1.55, 1.95]) {
    b.cyl(he.color, 0.16, 0.5, x, P + 0.12, 0.25, 12);
    b.cyl(t.accent, 0.17, 0.06, x, P + 0.42, 0.25, 12);
    b.sph(he.color, 0.15, x, P + 0.62, 0.25, { sy: 0.6 });
    g.sph(he.accent, 0.07, x, P + 0.32, 0.4);
  }
  // control post (left)
  rbox(b, t.trim, 0.5, 0.9, 0.4, -1.75, P, -0.1, undefined, 0.08);
  win(b, g, t.glow, t.trimL, -1.75, P + 0.55, -0.31, 0.3, 0.2, Math.PI);
  // the collector ring: gold with three cream catch-cups
  p.torus(t.accent, 1.0, 0.08, 0, 0, 0, { rx: Math.PI / 2 }, 28);
  p.torus(t.accentL, 0.86, 0.03, 0, 0, 0, { rx: Math.PI / 2 }, 24);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    p.sph(t.wall, 0.16, Math.cos(a), 0, Math.sin(a));
  }
  return { at: [0, P + 3.0, -0.6], axis: 'y', mode: 'spin', speed: 0.35 };
};

/** fusionPlant (Fusion Reactor, 0.9.7 design, restyled): a cream torus with slate coils on a gold-ringed base; the plasma ring spins. */
const fusionPlant: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T10;
  const he = MATERIALS.helium3;
  plinth(b, t);
  b.cyl(t.wall, 2.0, 0.22, 0, P, -0.42, 24);
  b.cyl(t.body, 1.86, 0.06, 0, P + 0.22, -0.42, 24);
  g.torus(t.glow, 1.66, 0.04, 0, P + 0.3, -0.42, { rx: Math.PI / 2 }, 30);
  // outer coils round the vertical torus, cream struts
  const R = 1.45;
  const cy = P + 2.15;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    rbox(b, i % 2 ? t.body : t.wall, 0.9, 0.24, 0.95, Math.cos(a) * R, cy + Math.sin(a) * R - 0.12, -0.25, { rz: a }, 0.06);
  }
  b.torus(t.wallD, R, 0.12, 0, cy, 0.25, undefined, 26);
  b.torus(t.wallD, R, 0.12, 0, cy, -0.75, undefined, 26);
  for (const s of [-1, 1]) b.beam(t.wall, [s * 0.9, P + 0.28, -0.15], [s * 0.45, P + 0.95, -0.25], 0.3);
  b.sph(SNOW, 0.5, 0, cy + R + 0.12, -0.25, { sx: 1.4, sy: 0.3 });
  // transformer blocks with sun-gold strips (back), helium feed tanks (left)
  for (const s of [-1, 1]) {
    rbox(b, t.body, 0.8, 1.2, 0.8, s * 1.8, P + 0.22, -1.85, undefined, 0.08);
    g.box(t.glow, 0.08, 0.8, 0.05, s * 1.8, P + 0.4, -2.27);
    snowCap(b, 0.72, 0.72, s * 1.8, P + 1.42, -1.85);
  }
  for (const z of [0.35, 0.85]) {
    b.cyl(he.color, 0.22, 0.6, -1.85, P, z, 12);
    b.cyl(t.accent, 0.23, 0.06, -1.85, P + 0.45, z, 12);
    g.sph(he.accent, 0.08, -1.85, P + 0.3, z - 0.22);
  }
  // plasma ring with bright beads (spins, glowing)
  p.torus(mixHex(t.glow, GOLD, 0.5), R, 0.2, 0, 0, 0, undefined, 30);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.sph(i % 2 ? CREAM : t.glow, 0.19, Math.cos(a) * R, Math.sin(a) * R, 0);
  }
  return { at: [0, cy, -0.25], axis: 'z', mode: 'spin', speed: 0.35, glow: true };
};

/** dataCenter (Neural Fab): terraced cream server halls with twinkling racks; the AI core turns inside a floating gold halo. */
const dataCenter: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T10;
  plinth(b, t);
  // two terraces: tall hall (back), low hall (front left)
  pod(b, t, 4.2, 2.1, 1.6, 0, P, -1.45);
  pod(b, t, 2.6, 1.3, 1.3, -0.75, P, 0.15);
  // rack lights on the camera-facing walls
  const rnd = seeded(107);
  const tints = [t.glow, t.glow, t.warm, t.resGlow, mixHex(t.glow, CREAM, 0.5)];
  const rack = (x0: number, y0: number, z: number, cols: number, rows: number, alongZ: boolean, ry: number): void => {
    for (let c = 0; c < cols; c++) {
      const x = alongZ ? x0 : x0 + c * 0.42;
      const zz = alongZ ? z + c * 0.42 : z;
      rbox(b, t.trim, 0.34, rows * 0.22 + 0.12, 0.06, x, y0 - 0.06, zz, { ry }, 0.02);
      for (let r = 0; r < rows; r++) if (rnd() > 0.15) g.box(tints[Math.floor(rnd() * tints.length)]!, 0.22, 0.08, 0.04, x + (alongZ ? -0.04 : 0), y0 + r * 0.22, zz + (alongZ ? 0 : -0.04), { ry });
    }
  };
  rack(-1.7, P + 0.55, -2.27, 9, 5, false, 0);
  rack(-2.07, P + 0.5, -0.25, 2, 3, true, Math.PI / 2);
  rack(-2.11, P + 0.55, -1.85, 2, 5, true, Math.PI / 2);
  win(b, g, t.warm, t.trim, 0.9, P + 0.6, 0.83, 0.6, 0.4);
  // rare-earth hopper (front right) feeding a slate chute
  b.cyl(t.wall, 0.45, 0.7, 1.35, P + 0.5, 0.45, 14, 0.5);
  b.cone(t.wallD, 0.45, 0.4, 1.35, P + 0.1, 0.45, 14, { rx: Math.PI });
  for (const x of [1.15, 1.35, 1.55]) crystal(b, t.res, x, P + 1.15, 0.45, 0.08, 0.12, { rz: (x - 1.35) * 2 });
  b.beam(t.trim, [1.0, P + 0.9, 0.3], [0.5, P + 1.3, -0.6], 0.08);
  // cooling fins on the low roof
  for (let i = 0; i < 4; i++) rbox(b, t.metalL, 0.12, 0.3, 0.9, -1.7 + i * 0.4, P + 1.44, 0.15, undefined, 0.03);
  // crown: a slate plinth on the tall roof, a floating gold halo, the core turns inside it
  b.cyl(t.body, 0.5, 0.3, 0.55, P + 2.25, -1.45, 16);
  b.torus(t.accent, 0.5, 0.04, 0.55, P + 2.55, -1.45, { rx: Math.PI / 2 }, 20);
  halo(b, g, t, 0.55, P + 3.35, -1.45, 0.82);
  p.sph(t.glow, 0.28, 0, 0, 0);
  p.torus(CREAM, 0.48, 0.04, 0, 0, 0, undefined, 18);
  p.torus(mixHex(t.glow, CREAM, 0.4), 0.48, 0.04, 0, 0, 0, { ry: Math.PI / 2 }, 18);
  p.sph(CREAM, 0.08, 0.62, 0.0, 0.0);
  return { at: [0.55, P + 3.35, -1.45], axis: 'y', mode: 'spin', speed: 0.3, glow: true };
};

/** robotWorks: a cream assembly hall with a big friendly robot head on its roof; a robot arm swings over the line. */
const robotWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T10;
  const robot = MATERIALS.robot;
  plinth(b, t);
  // the hall (back)
  pod(b, t, 4.2, 2.0, 1.9, 0, P, -1.35);
  rbox(b, t.trim, 1.6, 1.4, 0.1, -0.8, P + 0.28, -2.31, undefined, 0.05);
  g.box(t.warm, 1.35, 1.15, 0.05, -0.8, P + 0.38, -2.35);
  win(b, g, t.glow, t.trim, 1.1, P + 0.9, -2.31, 0.7, 0.45, Math.PI);
  win(b, g, t.glow, t.trim, -2.11, P + 0.9, -1.35, 0.8, 0.45, -Math.PI / 2);
  win(b, g, t.warm, t.trim, 0.9, P + 0.9, -0.39, 1.0, 0.45);
  // crown: a big friendly robot head (cream, slate face plate, sun-gold eyes, antenna with a bead) facing the camera
  const hx = 0.6;
  const hz = -1.4;
  const hy = P + 2.14;
  b.cyl(t.body, 0.35, 0.25, hx, hy, hz, 12);
  rbox(b, t.wall, 1.2, 0.95, 1.0, hx, hy + 0.25, hz, undefined, 0.3);
  rbox(b, t.body, 0.95, 0.55, 0.06, hx, hy + 0.45, hz - 0.5, undefined, 0.12);
  for (const s of [-1, 1]) {
    g.sph(t.glow, 0.11, hx + s * 0.22, hy + 0.78, hz - 0.54, { sz: 0.5 });
    b.cyl(t.accent, 0.13, 0.12, hx + s * 0.63, hy + 0.72, hz, 12, 0.13, { rz: Math.PI / 2 });
  }
  for (let i = 0; i < 5; i++) b.box(t.accentL, 0.08, 0.05, 0.03, hx - 0.2 + i * 0.1, hy + 0.56 - Math.sin((i / 4) * Math.PI) * 0.06, hz - 0.54);
  b.cyl(t.trim, 0.04, 0.4, hx, hy + 1.2, hz, 6);
  g.sph(t.glow, 0.09, hx, hy + 1.64, hz);
  snowCap(b, 0.9, 0.7, hx, hy + 1.2, hz);
  // the assembly line (front): slate bed, sun-gold guide strip, little robots riding it
  rbox(b, t.body, 3.0, 0.3, 0.7, -0.35, P, 0.4, undefined, 0.06);
  g.box(t.glow, 2.7, 0.03, 0.12, -0.35, P + 0.3, 0.4);
  for (const x of [-1.4, -0.6, 0.2]) {
    rbox(b, robot.color, 0.26, 0.3, 0.22, x, P + 0.32, 0.4, undefined, 0.08);
    b.sph(robot.color, 0.11, x, P + 0.72, 0.4);
    b.sph(robot.accent, 0.03, x - 0.05, P + 0.74, 0.3);
    b.sph(robot.accent, 0.03, x + 0.05, P + 0.74, 0.3);
  }
  // rare-earth magnet crate (right)
  rbox(b, t.wall, 0.6, 0.4, 0.55, 1.8, P, 0.4, undefined, 0.08);
  for (const x of [1.65, 1.95]) crystal(b, t.res, x, P + 0.4, 0.4, 0.08, 0.1);
  // the arm: turntable, two cream links with gold joints, a claw holding a robot head (swings)
  p.cyl(t.body, 0.36, 0.3, 0, 0, 0, 14);
  p.cyl(t.wall, 0.26, 0.2, 0, 0.3, 0, 12);
  p.beam(t.wall, [0, 0.4, 0], [-0.4, 1.35, 0], 0.2);
  p.sph(t.accent, 0.15, -0.4, 1.35, 0);
  p.beam(t.wall, [-0.4, 1.35, 0], [-1.3, 0.95, 0], 0.16);
  p.sph(t.accent, 0.12, -1.3, 0.95, 0);
  p.box(t.body, 0.12, 0.28, 0.3, -1.4, 0.68, 0);
  p.sph(robot.color, 0.13, -1.45, 0.48, 0);
  return { at: [1.5, P + 0.3, 0.45], axis: 'y', mode: 'swing', speed: 0.26, amp: 0.85 };
};

/** quantumLab (0.9.5 design, restyled): a tiered cream cryostat like a gold chandelier; a tilted harmonic ring spins over it. */
const quantumLab: Recipe = ({ body: b, glow: g, pivot: p }) => {
  const t = T10;
  const qc = MATERIALS.quantumCore;
  plinth(b, t);
  rbox(b, t.body, 3.8, 0.35, 3.0, 0, P, -0.85, undefined, 0.08);
  b.box(t.accent, 3.82, 0.05, 3.02, 0, P + 0.14, -0.85);
  const y0 = P + 0.35;
  b.lathe(t.wall, [[1.15, 0], [1.15, 0.7], [0.98, 0.78], [0.98, 1.4], [0.8, 1.5], [0.8, 2.05], [0.6, 2.15], [0.6, 2.5], [0.0, 2.5]], 0, y0, -0.9, 22);
  for (const [y, r] of [[0.72, 1.07], [1.45, 0.9], [2.1, 0.7]] as const) b.torus(t.accent, r, 0.07, 0, y0 + y, -0.9, { rx: Math.PI / 2 }, 26);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box(t.accentL, 0.05, 0.5, 0.05, Math.cos(a) * 0.99, y0 + 0.78, -0.9 + Math.sin(a) * 0.99);
  }
  b.dome(t.wall, 0.6, 0, y0 + 2.5, -0.9);
  b.sph(SNOW, 0.5, 0, y0 + 2.88, -0.9, { sy: 0.4 });
  b.cyl(t.trim, 0.08, 0.6, 0, y0 + 3.0, -0.9, 8);
  // core windows on the middle tier (front and the camera side): lavender quantum glow
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const x = Math.sin(a) * 0.99;
    const z = -0.9 + Math.cos(a) * 0.99;
    b.torus(t.accent, 0.3, 0.05, x, y0 + 1.1, z, { ry: a }, 16);
    g.sph(mixHex(qc.color, CREAM, 0.3), 0.26, x - Math.sin(a) * 0.06, y0 + 1.1, z - Math.cos(a) * 0.06);
  }
  // waveguide pillars with sun-gold beacons
  for (const x of [-1.65, 1.65]) {
    b.cyl(t.trim, 0.2, 0.2, x, y0, -1.9, 10);
    b.cyl(t.accent, 0.12, 2.3, x, y0 + 0.2, -1.9, 10);
    b.torus(t.trimL, 0.16, 0.04, x, y0 + 1.4, -1.9, { rx: Math.PI / 2 }, 12);
    g.sph(t.glow, 0.15, x, y0 + 2.6, -1.9);
  }
  // interferometer bay (front right) with a warm laser line
  rbox(b, t.wall, 1.6, 0.55, 0.8, 1.35, P, 0.75, undefined, 0.08);
  b.box(t.accent, 1.64, 0.06, 0.84, 1.35, P + 0.5, 0.75);
  g.box(t.glow, 1.3, 0.05, 0.08, 1.35, P + 0.62, 0.75);
  // operator console (front left)
  rbox(b, t.trim, 0.9, 0.75, 0.55, -1.5, P, 0.75, undefined, 0.08);
  g.box(t.glow, 0.6, 0.03, 0.34, -1.5, P + 0.78, 0.77, { rx: 0.25 });
  // the harmonic ring: gold, tilted, carrying three cream orbs
  p.torus(t.accent, 1.0, 0.08, 0, 0, 0, { rx: Math.PI / 2 + 0.38 }, 28);
  p.torus(t.accentL, 0.82, 0.03, 0, 0, 0, { rx: Math.PI / 2 + 0.38 }, 24);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const z0 = Math.sin(a);
    p.sph(i === 0 ? qc.color : t.wall, 0.14, Math.cos(a), -z0 * Math.sin(0.38), z0 * Math.cos(0.38));
  }
  return { at: [0, y0 + 3.75, -0.9], axis: 'y', mode: 'spin', speed: 0.42 };
};

// ---------------------------------------------------------------------------
// building models
// ---------------------------------------------------------------------------

const RECIPES: Record<ToyMachineId, Recipe> = {
  copperMine, wireMill, quartzPit, bulbWorks, radioWorks,
  oilPump, refinery, gasWell, cracker, snowmobileWorks,
  sandPit, goldPanner, chipFab, boardShop, pcAssembly,
  uraniumMine, graphitePit, enricher, reactor, batteryPlant,
  nanoFab, heliumSkimmer, fusionPlant, dataCenter, robotWorks, quantumLab,
};

interface Built {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  pivot: THREE.BufferGeometry;
  spec: PivotSpec;
  w: number;
  d: number;
}

const builtCache = new Map<ToyMachineId, Built>();

function build(id: ToyMachineId): Built {
  let built = builtCache.get(id);
  if (built) return built;
  const parts: Parts = { body: new Kit(), glow: new Kit(), pivot: new Kit() };
  const spec = RECIPES[id](parts);
  const body = parts.body.geometry();
  const glow = parts.glow.batch.empty ? null : parts.glow.geometry();
  const pivot = parts.pivot.geometry();
  const box = new THREE.Box3().copy(body.boundingBox!);
  if (glow) box.union(glow.boundingBox!);
  box.union(pivot.boundingBox!.clone().translate(new THREE.Vector3(...spec.at)));
  const size = box.getSize(new THREE.Vector3());
  built = { body, glow, pivot, spec, w: Math.ceil(size.x * 10 - 1e-6) / 10, d: Math.ceil(size.z * 10 - 1e-6) / 10 };
  builtCache.set(id, built);
  return built;
}

/** Idle crawl as a share of the working speed. */
const IDLE = 0.12;

/** Build one era 6-10 machine (geometry cached per id; every call returns a new root sharing it). */
export function createToyMachine(id: ToyMachineId): MachineModel {
  const built = build(id);
  const root = new THREE.Group();
  root.name = `machine:${id}:${TOY_MACHINES[id]}`;
  const bodyMesh = new THREE.Mesh(built.body, vcMat());
  bodyMesh.name = 'body';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  root.add(bodyMesh);
  if (built.glow) {
    const m = new THREE.Mesh(built.glow, eraGlowMaterial());
    m.name = 'glow';
    root.add(m);
  }
  const spec = built.spec;
  const pivotMesh = new THREE.Mesh(built.pivot, spec.glow ? eraGlowMaterial() : vcMat());
  pivotMesh.name = 'pivot';
  pivotMesh.castShadow = !spec.glow && spec.mode !== 'rise';
  pivotMesh.position.set(...spec.at);
  root.add(pivotMesh);
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
      case 'bob':
        pivotMesh.position.y = spec.at[1] + Math.sin(phase * Math.PI * 2) * amp;
        break;
      case 'slide':
        pivotMesh.position[spec.axis] = spec.at[axisIndex] + Math.sin(phase * Math.PI * 2) * amp;
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
// gallery (?gallery=eraMachines6to10, or one era as the game shows it: ?gallery=toys6 … toys10)
// ---------------------------------------------------------------------------

/** A working model for the gallery: it animates on its own (the gallery has no per-asset tick). */
function galleryModel(id: ToyMachineId): THREE.Object3D {
  const m = createToyMachine(id);
  m.animate(0.9, true);
  const pivot = m.root.getObjectByName('pivot')!;
  let last = performance.now() / 1000;
  pivot.onBeforeRender = (): void => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;
    if (dt > 0) m.animate(dt, true);
  };
  return m.root;
}

const catalog: Record<string, () => THREE.Object3D> = {};
for (const id of TOY_MACHINE_IDS) catalog[id] = () => galleryModel(id);
for (const era of [6, 7, 8, 9, 10] as const) {
  // the era's machines in a row, turned as the regions turn them (the camera sees their back and left faces)
  catalog[`toys${era}`] = () => {
    const sheet = new THREE.Group();
    sheet.name = `toys${era}`;
    let x = 0;
    for (const id of TOY_MACHINE_IDS) {
      if (TOY_MACHINES[id] !== era) continue;
      const m = galleryModel(id);
      m.rotation.y = Math.PI;
      m.position.x = x;
      x += 6.4;
      sheet.add(m);
    }
    return sheet;
  };
}
export const eraMachine6to10Catalog: Record<string, () => THREE.Object3D> = catalog;
