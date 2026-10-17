/**
 * 1.0 expansion: the new machines of eras 5–7 (docs/art/era-05..07.json on art/ages-spec), as standalone builders.
 * Not wired into the game yet: eras/data.ts has no ids for them, so nothing outside the gallery calls this file.
 *
 * Same contract as assets/eraMachines.ts (eras/Machine.ts can use these models unchanged once they are wired in):
 * - Local frame: origin at floor centre, +Y up, +Z front, +X right. Piles and worker spots sit OUTSIDE the model, in
 *   front of it (eras/rules.ts machineFrame); the door the products hop out of is at the front centre, ~1 m up.
 * - At most 3 meshes: 'body' (merged, vertex-coloured, snow caps included), 'glow' (the shared night-registered
 *   `eraGlowMaterial()`, tinted per vertex) and ONE animated mesh named 'pivot' whose origin is its rotation centre.
 * - Footprint ≤ 5.2 × 5.2 m including the animated part at any phase; height ≤ 6 m.
 * - `animate(dt, working)` runs the pivot at full speed while working and at a slow idle crawl otherwise.
 *   No allocation per frame. Allowed motions (art guide): Y / Z rotation, vertical oscillation or Z rocking, with a
 *   rotation radius ≥ 0.6 m or an amplitude ≥ 0.35 m.
 *
 * Art direction: /mnt/project-files/argon/ARGON_GUIDE_CHAT.md (committed later as docs/art/guide.md); its warm
 * palettes override the colours in the JSON specs. Every machine stands on a bevelled 0.25 m plinth and reads as a
 * foundation, a characterful core and a vertical crown. Edges are soft (rounded boxes), metals warm, glows amber /
 * peach / soft mint.
 *   5 Industrial: riveted blue steel, terracotta brick, polished brass, safety orange.
 *   6 Electric:   enamel teal, copper windings, cream enamel, honey and crimson details, soft mint glow.
 *   7 Oil:        hazard honey-yellow bodies, crimson pipes, charcoal trim, peach-orange glow.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { vcMat } from '../render/batch';
import { MACHINE_TONES, SNOW } from '../render/palette';
import { Kit, eraGlowMaterial, hcyl, lattice, wheel, type Rot, type V3 } from './eraKit';
import type { MachineModel } from './eraMachines';

/** The new machine ids of eras 5–7, in era order (extractor, processor, premium, cash). */
export const ERA5_7_MACHINE_IDS = [
  'rollingMill', 'plowWorks', 'bankVault',
  'quartzPit', 'bulbWorks', 'radioWorks', 'tillLine',
  'gasWell', 'cracker', 'snowmobileWorks', 'driveThruVault',
] as const;
export type Era5to7MachineId = (typeof ERA5_7_MACHINE_IDS)[number];

/** Era of each new machine. */
export const ERA5_7_MACHINE_ERA: Record<Era5to7MachineId, 5 | 6 | 7> = {
  rollingMill: 5, plowWorks: 5, bankVault: 5,
  quartzPit: 6, bulbWorks: 6, radioWorks: 6, tillLine: 6,
  gasWell: 7, cracker: 7, snowmobileWorks: 7, driveThruVault: 7,
};

// ---------------------------------------------------------------------------
// palette (art guide, chat version)
// ---------------------------------------------------------------------------

const SNOW_SH = 0xd9e4f0;

/** Era 5 Industrial, 6 Electric and 7 Oil tones (render/palette.ts). */
const I = MACHINE_TONES[5];
const E = MACHINE_TONES[6];
const O = MACHINE_TONES[7];

/** Shared warm window / lamp tint. */
const G_WARM = 0xffd38a;
const G_FIRE = 0xff9a4a;

// ---------------------------------------------------------------------------
// helpers
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

/** Rounded (bevelled) box with its bottom at `y`. Bevel 0.08 m by default, clamped to the box. */
function rbox(k: Kit, color: number, w: number, h: number, d: number, x: number, y: number, z: number, o?: Rot, r = 0.08): void {
  const rr = Math.max(0.01, Math.min(r, Math.min(w, h, d) / 2 - 0.005));
  k.add(cached(`rb${w}|${h}|${d}|${rr}`, () => new RoundedBoxGeometry(w, h, d, 2, rr)), color, x, y + h / 2, z, o);
}

/** Box whose walls lean inward by `lean` (share of the half-size at the top, 0.06 ≈ 4°), bottom at `y`. Flat shaded. */
function taper(k: Kit, color: number, w: number, h: number, d: number, x: number, y: number, z: number, lean = 0.06): void {
  const key = `tp${lean}`;
  const g = cached(key, () => {
    const c = new THREE.CylinderGeometry(Math.SQRT1_2 * (1 - lean), Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
    c.computeVertexNormals();
    return c;
  });
  k.add(g, color, x, y + h / 2, z, { sx: w, sy: h, sz: d });
}

/** Rounded snow cap (0.12 m) with a cool shadow lip, on a surface whose top is at `y`. */
function snowCap(k: Kit, w: number, d: number, x: number, y: number, z: number): void {
  rbox(k, SNOW_SH, w, 0.06, d, x, y, z, undefined, 0.03);
  rbox(k, SNOW, w - 0.08, 0.12, d - 0.08, x, y + 0.02, z, undefined, 0.05);
}

/** Round snow cap on a cylinder top at `y`. */
function snowDisc(k: Kit, r: number, x: number, y: number, z: number): void {
  k.cyl(SNOW_SH, r, 0.05, x, y, z, 14);
  k.cyl(SNOW, r * 0.92, 0.1, x, y + 0.03, z, 14, r * 0.82);
}

/** The 0.25 m bevelled plinth every machine stands on, a kick strip in `edge` and soft drifts at the back corners. */
function plinth(k: Kit, w: number, d: number, color: number, edge: number): void {
  rbox(k, edge, w, 0.1, d, 0, 0, 0, undefined, 0.04);
  rbox(k, color, w - 0.12, 0.25, d - 0.12, 0, 0, 0, undefined, 0.1);
  for (const sx of [-1, 1]) k.sph(SNOW, 0.38, sx * (w / 2 - 0.4), 0.26, -(d / 2 - 0.4), { sy: 0.4 });
  k.sph(SNOW, 0.3, -(w / 2 - 0.34), 0.26, d / 2 - 0.34, { sy: 0.35 });
}

/** Chimney: tapering cylinder, band, rim and snow cap. */
function chimney(k: Kit, color: number, band: number, x: number, y: number, z: number, r: number, h: number): void {
  k.cyl(color, r, h, x, y, z, 12, r * 0.84);
  k.cyl(band, r * 0.96, 0.16, x, y + h * 0.55, z, 12);
  k.cyl(band, r * 0.92, 0.16, x, y + h - 0.14, z, 12);
  snowDisc(k, r * 0.86, x, y + h + 0.02, z);
}

/** Row of brass rivets along X on a face looking +Z. */
function rivets(k: Kit, color: number, x0: number, x1: number, y: number, z: number, step = 0.32): void {
  for (let x = x0; x <= x1 + 1e-6; x += step) k.sph(color, 0.045, x, y, z);
}

/** Glowing pane with a frame on a wall facing +Z (frame in `k`, pane in `g`), centred on (x, y) with bottom at y. */
function pane(k: Kit, g: Kit, glow: number, frame: number, x: number, y: number, z: number, w: number, h: number): void {
  rbox(k, frame, w + 0.16, h + 0.16, 0.08, x, y - 0.08, z, undefined, 0.03);
  g.box(glow, w, h, 0.06, x, y, z + 0.03);
}

/** Lamp on a short bracket: arm in `k`, bulb in `g`. */
function lamp(k: Kit, g: Kit, color: number, glow: number, x: number, y: number, z: number, r = 0.11): void {
  k.cyl(color, r * 1.1, 0.06, x, y + r * 0.9, z, 8);
  g.sph(glow, r, x, y, z);
}

// ---------------------------------------------------------------------------
// recipe framework (mirrors assets/eraMachines.ts)
// ---------------------------------------------------------------------------

interface Parts {
  body: Kit;
  glow: Kit;
  pivot: Kit;
}

/** The animated part: built around the pivot kit's origin, placed at `at`. `speed` is cycles per second. */
interface PivotSpec {
  at: V3;
  axis: 'y' | 'z';
  /** spin = turn continuously; swing = sine rotation (±amp rad); bob = vertical sine translation (±amp m). */
  mode: 'spin' | 'swing' | 'bob';
  speed: number;
  amp?: number;
  /** Paint the pivot with the shared glow material instead of the toon vertex-colour one. */
  glow?: boolean;
}

type Recipe = (p: Parts) => PivotSpec;

// ---------------------------------------------------------------------------
// era 5 — Industrial: riveted blue steel, terracotta brick, brass, safety orange
// ---------------------------------------------------------------------------

/** rollingMill: brick-and-steel mill hall, a glowing bar on the roller bed, and a big orange drive gear. */
const rollingMill: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 5.0, 4.8, I.ground, I.fence);
  const P = 0.25;
  // foundation
  rbox(b, I.concrete, 4.5, 0.4, 3.6, 0, P, -0.5);
  const F = P + 0.4;
  // core hall: brick base, tapered riveted steel upper, cornice, snow
  rbox(b, I.brick, 3.3, 0.9, 2.5, 0.45, F, -1.0);
  rbox(b, I.brickD, 3.36, 0.12, 2.56, 0.45, F + 0.9, -1.0, undefined, 0.04);
  taper(b, I.body, 3.1, 1.5, 2.3, 0.45, F + 1.02, -1.0, 0.05);
  rivets(b, I.brass, -0.85, 1.75, F + 1.2, 0.17);
  rbox(b, I.trim, 3.3, 0.2, 2.5, 0.45, F + 2.5, -1.0);
  snowCap(b, 3.2, 2.4, 0.45, F + 2.7, -1.0);
  // three warm arched windows and the door
  for (const x of [-0.55, 1.45]) {
    pane(b, g, I.glow, I.trim, x, F + 1.35, 0.15, 0.42, 0.6);
    b.cyl(I.trim, 0.29, 0.08, x, F + 1.93, 0.13, 10, 0.29, { rx: Math.PI / 2 });
  }
  rbox(b, I.trim, 1.0, 1.15, 0.12, 0.45, F, 0.23, undefined, 0.04);
  g.box(G_FIRE, 0.76, 0.9, 0.05, 0.45, F + 0.02, 0.3);
  // roller bed across the front with a red-hot bar running through
  rbox(b, I.trim, 4.4, 0.32, 0.95, 0, F, 0.95);
  for (let i = 0; i < 9; i++) hcyl(b, I.bodyL, 0.09, 0.85, -1.9 + i * 0.475, F + 0.38, 0.95, 'z', 8);
  g.box(G_FIRE, 3.4, 0.12, 0.26, 0.2, F + 0.47, 0.95);
  // orange roll stand straddling the bed
  for (const z of [0.42, 1.48]) {
    rbox(b, I.accent, 0.32, 1.5, 0.22, 0.9, F, z);
    b.sph(I.brass, 0.07, 0.9, F + 1.2, z + (z > 1 ? 0.12 : -0.12));
  }
  rbox(b, I.accent, 0.5, 0.26, 1.4, 0.9, F + 1.48, 0.95);
  hcyl(b, I.brass, 0.17, 1.1, 0.9, F + 0.82, 0.95, 'z', 12);
  hcyl(b, I.bodyL, 0.12, 1.1, 0.9, F + 1.22, 0.95, 'z', 10);
  b.cyl(I.trim, 0.12, 0.08, 0.9, F + 1.74, 0.95, 8);
  lamp(b, g, I.trim, I.glow, 0.9, F + 1.9, 0.95, 0.12);
  // motor housing and bearing block for the drive gear (left)
  b.cyl(I.trim, 0.55, 1.2, -1.7, F, -1.0, 14);
  b.cyl(I.accent, 0.57, 0.14, -1.7, F + 0.75, -1.0, 14);
  snowDisc(b, 0.5, -1.7, F + 1.2, -1.0);
  b.beam(I.trim, [-1.7, F + 1.2, -0.8], [-1.7, 2.35, -0.38], 0.2);
  rbox(b, I.trim, 0.36, 0.4, 0.3, -1.7, 2.15, -0.45);
  // crown: brick stack with brass bands
  chimney(b, I.brick, I.brass, 1.55, F + 2.7, -1.75, 0.32, 1.9);
  // drive gear (spins around Z): rim, 14 teeth, 4 spokes, brass hub
  const R = 0.62;
  p.torus(I.accent, R, 0.1, 0, 0, 0, undefined, 24);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    p.box(I.accent, 0.16, 0.18, 0.16, Math.cos(a) * (R + 0.14), Math.sin(a) * (R + 0.14) - 0.09, 0, { rz: a - Math.PI / 2 });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.beam(I.trim, [0, 0, 0], [Math.cos(a) * R, Math.sin(a) * R, 0], 0.1);
  }
  hcyl(p, I.brass, 0.16, 0.26, 0, 0, 0, 'z', 12);
  p.sph(I.brassL, 0.07, 0, 0, 0.14);
  return { at: [-1.7, 2.35, -0.2], axis: 'z', mode: 'spin', speed: 0.35 };
};

/** plowWorks: sawtooth-roofed works with an orange crane rocking a snowplow blade over the welding jig. */
const plowWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 5.0, 4.8, I.ground, I.fence);
  const P = 0.25;
  // hangar: brick base, tapered steel walls
  rbox(b, I.brick, 4.4, 0.75, 2.6, 0, P, -1.0);
  taper(b, I.body, 4.3, 1.55, 2.5, 0, P + 0.75, -1.0, 0.03);
  rbox(b, I.trim, 4.5, 0.14, 2.7, 0, P + 2.28, -1.0, undefined, 0.05);
  rivets(b, I.brass, -1.9, 1.9, P + 0.95, 0.24);
  // sawtooth roof: three teeth, glazing facing the front
  const top = P + 2.42;
  for (let i = 0; i < 3; i++) {
    const zb = -2.3 + i * 0.87;
    const ang = Math.atan2(0.5, 0.87);
    b.box(I.trim, 4.5, 0.1, 1.0, 0, top + 0.2, zb + 0.435, { rx: -ang });
    b.box(SNOW, 4.36, 0.12, 0.84, 0, top + 0.3, zb + 0.4, { rx: -ang });
    g.box(I.glow, 4.1, 0.4, 0.05, 0, top + 0.05, zb + 0.86);
    b.box(I.trim, 4.4, 0.08, 0.1, 0, top + 0.46, zb + 0.87);
  }
  // front: orange-striped roll-up gate with a warm crack of light, office window
  rbox(b, I.trim, 1.9, 1.75, 0.14, 0.5, P, 0.28, undefined, 0.04);
  for (let i = 0; i < 6; i++) b.box(i % 2 ? I.accent : I.bodyL, 1.6, 0.2, 0.06, 0.5, P + 0.42 + i * 0.2, 0.37);
  g.box(G_WARM, 1.6, 0.3, 0.05, 0.5, P + 0.06, 0.37);
  pane(b, g, I.glow, I.trim, -1.35, P + 1.0, 0.27, 0.9, 0.55);
  // crane: two orange columns and a beam across the front yard of the plinth
  for (const x of [-2.15, 2.15]) {
    rbox(b, I.accent, 0.26, 2.95, 0.26, x, P, 1.05);
    rbox(b, I.trim, 0.42, 0.14, 0.42, x, P, 1.05);
  }
  rbox(b, I.accent, 4.56, 0.3, 0.32, 0, P + 2.95, 1.05);
  b.box(SNOW, 4.4, 0.08, 0.24, 0, P + 3.25, 1.05);
  for (let x = -1.9; x <= 1.9; x += 0.6) b.box(I.trim, 0.32, 0.06, 0.34, x, P + 2.92, 1.05);
  // welding jig with a finished plow and a soft arc glow
  rbox(b, I.trim, 1.6, 0.45, 0.9, 1.15, P, 1.5);
  for (const s of [-1, 1]) rbox(b, I.accent, 0.68, 0.3, 0.1, 1.15 + s * 0.3, P + 0.5, 1.48, { ry: s * 0.45 }, 0.04);
  b.box(I.bodyL, 1.2, 0.05, 0.12, 1.15, P + 0.45, 1.68);
  g.sph(0xbfefff, 0.13, 0.55, P + 0.62, 1.55);
  // crown: orange exhaust filter tower and a brass vent
  chimney(b, I.accent, I.trim, -1.6, top, -1.9, 0.34, 2.3);
  b.cyl(I.brass, 0.16, 0.6, 1.4, top + 0.3, -1.95, 8);
  b.cone(I.brass, 0.26, 0.24, 1.4, top + 0.9, -1.95, 8);
  // hoist: trolley under the beam, chain, hook block, hanging plow blade (rocks around Z)
  rbox(p, I.trim, 0.55, 0.26, 0.42, 0, -0.26, 0, undefined, 0.05);
  p.cyl(I.brass, 0.1, 0.42, -0.18, -0.08, -0.21, 8, 0.1, { rx: Math.PI / 2 });
  p.beam(I.trim, [0, -0.26, 0], [0, -1.1, 0], 0.04);
  rbox(p, I.accent, 0.24, 0.24, 0.2, 0, -1.32, 0, undefined, 0.05);
  p.beam(I.trim, [0, -1.32, 0], [-0.4, -1.5, 0], 0.03);
  p.beam(I.trim, [0, -1.32, 0], [0.4, -1.5, 0], 0.03);
  for (const s of [-1, 1]) rbox(p, I.accent, 0.62, 0.38, 0.1, s * 0.27, -1.9, 0, { ry: s * 0.45 }, 0.04);
  p.box(I.bodyL, 1.08, 0.06, 0.14, 0, -1.94, 0.1);
  p.box(SNOW, 0.9, 0.06, 0.14, 0, -1.48, 0.05);
  return { at: [-0.7, P + 2.95, 1.05], axis: 'z', mode: 'swing', speed: 0.45, amp: 0.3 };
};

/** bankVault: riveted steel strongroom with a brass coin crown and a big spinning vault wheel. */
const bankVault: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 4.6, 4.4, I.ground, I.fence);
  const P = 0.25;
  // steps up to the door
  rbox(b, I.concrete, 2.2, 0.16, 0.5, 0, P, 1.55);
  rbox(b, I.concrete, 2.6, 0.32, 0.5, 0, P, 1.15);
  // brick base, tapered riveted steel cube, cornice, snow
  rbox(b, I.brick, 3.5, 0.45, 3.0, 0, P, -0.5);
  taper(b, I.body, 3.3, 2.0, 2.8, 0, P + 0.45, -0.5, 0.04);
  for (const y of [P + 0.62, P + 2.28]) rivets(b, I.brass, -1.45, 1.45, y, 0.92, 0.29);
  rbox(b, I.trim, 3.6, 0.22, 3.1, 0, P + 2.45, -0.5);
  snowCap(b, 3.5, 3.0, 0, P + 2.67, -0.5);
  // corner pilasters
  for (const x of [-1.55, 1.55]) {
    b.cyl(I.brass, 0.17, 2.0, x, P + 0.45, 0.85, 10);
    b.sph(I.brassL, 0.2, x, P + 2.5, 0.85, { sy: 0.6 });
  }
  // round vault door: frame ring, dark recess, door disc with bolts
  b.torus(I.trim, 0.86, 0.14, 0, 1.6, 0.96);
  hcyl(b, I.trim, 0.82, 0.08, 0, 1.6, 0.92, 'z', 20);
  hcyl(b, I.bodyL, 0.74, 0.16, 0, 1.6, 1.02, 'z', 20);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.sph(I.brass, 0.05, Math.cos(a) * 0.64, 1.6 + Math.sin(a) * 0.64, 1.1);
  }
  // warm lanterns either side of the door, a dial light above it
  for (const x of [-1.15, 1.15]) {
    b.beam(I.trim, [x, P + 1.5, 0.9], [x, P + 1.5, 1.08], 0.06);
    rbox(b, I.trim, 0.24, 0.06, 0.24, x, P + 1.72, 1.12, undefined, 0.02);
    g.box(I.glow, 0.18, 0.26, 0.18, x, P + 1.45, 1.12);
  }
  g.cyl(I.glow, 0.13, 0.05, 0, 2.58, 0.93, 12, 0.13, { rx: Math.PI / 2 });
  b.torus(I.brass, 0.15, 0.03, 0, 2.58, 0.97);
  // crown: brass coin hopper and a standing gold coin
  b.lathe(I.brass, [[0.18, 0], [0.24, 0.05], [0.62, 0.62], [0.68, 0.7], [0.6, 0.72]], 0, P + 2.79, -0.6, 16);
  b.cyl(I.trim, 0.3, 0.12, 0, P + 2.79, -0.6, 12);
  hcyl(b, I.brassL, 0.48, 0.14, 0, P + 4.0, -0.6, 'z', 20);
  b.torus(I.brass, 0.48, 0.05, 0, P + 4.0, -0.6);
  g.box(I.glow, 0.08, 0.42, 0.04, 0, P + 3.79, -0.52);
  g.box(I.glow, 0.24, 0.06, 0.04, 0, P + 4.08, -0.52);
  g.box(I.glow, 0.24, 0.06, 0.04, 0, P + 3.86, -0.52);
  // soft amber alarm beacon on the corner
  b.cyl(I.trim, 0.12, 0.14, 1.45, P + 2.67, 0.7, 8);
  g.dome(I.accent, 0.14, 1.45, P + 2.81, 0.7);
  // vault wheel: spoked handwheel with three grip knobs (spins around Z)
  wheel(p, 'z', I.brass, I.trim, 0, 0, 0, 0.6, 0.07, 6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    p.beam(I.brass, [Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0], [Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0], 0.08);
    p.sph(I.brassL, 0.09, Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0);
  }
  return { at: [0, 1.6, 1.2], axis: 'z', mode: 'spin', speed: 0.22 };
};

// ---------------------------------------------------------------------------
// era 6 — Electric: enamel teal, copper windings, cream enamel, soft mint glow
// ---------------------------------------------------------------------------

/** quartzPit: snowy gravel pit full of soft-glowing quartz, a shaker screen bouncing on posts, a floodlight pole. */
const quartzPit: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 4.8, 4.8, E.ground, E.fence);
  const P = 0.25;
  // round pit: raised gravel rim, dark floor, snowy lip
  b.lathe(E.gravel, [[1.5, 0], [2.15, 0], [2.18, 0.3], [2.0, 0.48], [1.7, 0.44], [1.5, 0.1]], 0, P, -0.1, 24);
  b.cyl(0x6f6a62, 1.55, 0.1, 0, P, -0.1, 20);
  b.torus(SNOW, 1.95, 0.12, 0, P + 0.46, -0.1, { rx: Math.PI / 2 }, 28);
  // quartz clusters in the pit: pale pink crystals in the body, soft mint ones glowing
  const clusters: [number, number, number][] = [[-0.9, 0.5, 0.3], [0.8, 0.7, -0.2], [-0.2, -1.1, 0.5], [1.1, -0.7, 1.1], [-1.1, -0.5, 2.0]];
  for (const [x, z, s] of clusters) {
    g.cone(E.glow, 0.11, 0.5, x, P + 0.08, z, 6, { rz: 0.25 * Math.sin(s * 3), rx: 0.2 });
    b.cone(E.quartz, 0.09, 0.38, x + 0.16, P + 0.08, z + 0.08, 6, { rz: -0.4 });
    b.cone(E.quartz, 0.08, 0.3, x - 0.14, P + 0.08, z - 0.06, 6, { rx: -0.35 });
  }
  // shaker frame: four cream guide posts (the screen bounces on them) and a copper chute to the front door
  const SX = 1.2;
  const SZ = 0.82;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    b.cyl(E.trim, 0.09, 2.45, 0.1 + sx * SX, P + 0.1, -0.5 + sz * SZ, 8);
    b.cyl(E.cream, 0.12, 0.1, 0.1 + sx * SX, P + 2.55, -0.5 + sz * SZ, 8);
  }
  b.box(E.accent, 0.9, 0.08, 1.5, 0.1, P + 0.75, 0.75, { rx: 0.38 });
  for (const s of [-1, 1]) b.box(E.accent, 0.06, 0.24, 1.5, 0.1 + s * 0.45, P + 0.82, 0.75, { rx: 0.38 });
  // electric vibrator motor with copper windings and a crimson feed pipe (right)
  rbox(b, E.body, 0.9, 0.6, 0.9, 1.7, P, 0.9);
  for (let i = 0; i < 3; i++) b.torus(E.accent, 0.3, 0.08, 1.7, P + 0.8 + i * 0.16, 0.9, { rx: Math.PI / 2 });
  b.cyl(E.cream, 0.32, 0.14, 1.7, P + 1.22, 0.9, 12);
  snowDisc(b, 0.28, 1.7, P + 1.36, 0.9);
  b.beam(E.crimson, [1.7, P + 1.0, 0.6], [1.3, P + 1.8, -0.5], 0.1);
  // crown: power pole with cream insulators and a warm floodlight, cable down to the motor
  b.cyl(0x6d5a48, 0.12, 4.6, -1.85, P, -1.85, 8, 0.09);
  rbox(b, E.trim, 1.2, 0.12, 0.14, -1.85, P + 4.2, -1.85, undefined, 0.04);
  for (const x of [-2.3, -1.4]) b.cyl(E.cream, 0.07, 0.18, x, P + 4.32, -1.85, 8);
  b.beam(E.trim, [-1.85, P + 3.9, -1.75], [-1.3, P + 3.7, -1.2], 0.06);
  rbox(b, E.trim, 0.36, 0.28, 0.24, -1.3, P + 3.5, -1.2, { rx: 0.35 }, 0.05);
  g.box(G_WARM, 0.28, 0.2, 0.05, -1.3, P + 3.5, -1.04, { rx: 0.35 });
  snowCap(b, 1.1, 0.26, -1.85, P + 4.32, -1.85);
  b.beam(0x2b2b2b, [-1.4, P + 4.35, -1.85], [1.7, P + 1.3, 0.9], 0.025);
  // vibrating screen deck (bobs up and down): teal enamel tray, cream rails, mesh bars and quartz on it
  rbox(p, E.body, 2.3, 0.16, 1.5, 0, -0.08, 0, undefined, 0.06);
  for (const s of [-1, 1]) rbox(p, E.cream, 2.3, 0.22, 0.1, 0, 0.0, s * 0.72, undefined, 0.04);
  for (let i = 0; i < 7; i++) p.box(E.trim, 0.05, 0.05, 1.36, -0.96 + i * 0.32, 0.08, 0);
  for (const [x, z] of [[-0.6, -0.2], [0.1, 0.35], [0.7, -0.3]] as const) {
    p.cone(E.quartz, 0.1, 0.36, x, 0.08, z, 6, { rz: 0.3 });
    p.cone(E.quartz, 0.08, 0.28, x + 0.13, 0.08, z + 0.05, 6, { rx: -0.3 });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) p.torus(E.accent, 0.15, 0.04, sx * SX, 0, sz * SZ, { rx: Math.PI / 2 }, 10);
  return { at: [0.1, P + 1.8, -0.5], axis: 'y', mode: 'bob', speed: 0.85, amp: 0.36 };
};

/** bulbWorks: round glass oven under a copper dome, a test bench of glowing bulbs, and a bulb carousel on top. */
const bulbWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 4.8, 4.6, E.ground, E.fence);
  const P = 0.25;
  // enamel base with a copper kick strip
  rbox(b, E.body, 4.3, 0.5, 3.7, 0, P, -0.4);
  b.box(E.accent, 4.32, 0.08, 3.72, 0, P + 0.06, -0.4);
  const B = P + 0.5;
  // core: cream oven drum with teal bands, copper dome, annealing window
  b.cyl(E.cream, 1.25, 1.6, -0.6, B, -0.8, 20, 1.18);
  for (const y of [0.2, 1.4]) b.torus(E.body, 1.24 - y * 0.04, 0.07, -0.6, B + y, -0.8, { rx: Math.PI / 2 }, 24);
  b.dome(E.accent, 1.24, -0.6, B + 1.6, -0.8, { sy: 0.58 });
  b.dome(SNOW, 1.02, -0.6, B + 1.66, -0.8, { sy: 0.5 });
  rbox(b, E.trim, 0.9, 0.7, 0.14, -0.6, B + 0.45, 0.38, undefined, 0.05);
  g.box(G_FIRE, 0.72, 0.52, 0.06, -0.6, B + 0.54, 0.44);
  // vacuum stack (copper chimney) with a crimson pipe into the drum
  chimney(b, E.accent, E.body, 1.45, B, -1.6, 0.3, 2.9);
  b.beam(E.crimson, [1.25, B + 1.8, -1.45], [0.4, B + 1.2, -0.95], 0.12);
  // test bench of glowing bulbs (front right)
  rbox(b, E.creamD, 1.6, 0.55, 0.9, 1.2, B, 0.75);
  b.box(E.accent, 1.64, 0.06, 0.94, 1.2, B + 0.5, 0.75);
  for (let i = 0; i < 4; i++) {
    const x = 0.66 + i * 0.36;
    b.cyl(E.accent, 0.07, 0.12, x, B + 0.56, 0.75, 8);
    g.sph(i % 2 ? G_WARM : E.glow, 0.13, x, B + 0.8, 0.75);
  }
  // transformer with copper windings (front left)
  rbox(b, E.trim, 0.9, 0.95, 0.75, -1.65, B, 0.85);
  for (let i = 0; i < 5; i++) b.box(E.body, 0.04, 0.8, 0.8, -2.1 + 0.0 * i, B + 0.06, 0.85 - 0.3 + i * 0.15);
  for (let i = 0; i < 3; i++) b.torus(E.accent, 0.2, 0.07, -1.65, B + 1.05 + i * 0.13, 0.85, { rx: Math.PI / 2 }, 12);
  for (const x of [-1.9, -1.4]) b.cyl(E.cream, 0.06, 0.3, x, B + 0.95, 0.65, 8);
  // brass post up through the dome for the carousel
  b.cyl(E.honey, 0.12, 0.6, -0.6, B + 2.25, -0.8, 10);
  // carousel (spins around Y): hub, six arms, cream glass bulbs on copper sockets
  p.cyl(E.trim, 0.26, 0.16, 0, -0.08, 0, 12);
  p.dome(E.honey, 0.2, 0, 0.08, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.85;
    const z = Math.sin(a) * 0.85;
    p.beam(E.accent, [0, 0, 0], [x, 0, z], 0.06);
    p.cyl(E.accent, 0.08, 0.12, x, 0.0, z, 8);
    p.sph(i % 2 ? E.cream : 0xfff4dc, 0.16, x, 0.26, z, { sy: 1.15 });
  }
  return { at: [-0.6, B + 2.85, -0.8], axis: 'y', mode: 'spin', speed: 0.3 };
};

/** radioWorks: streamline teal hall with copper speed lines, a big tuning dial, and a turning dipole on the mast. */
const radioWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 5.0, 4.8, E.ground, E.fence);
  const P = 0.25;
  rbox(b, E.creamD, 4.6, 0.22, 3.9, 0, P, -0.45);
  b.box(E.accent, 4.62, 0.05, 3.92, 0, P + 0.04, -0.45);
  const B = P + 0.22;
  // streamline hall: box wing on the right, rounded drum on the left
  rbox(b, E.body, 3.0, 2.2, 2.7, 0.45, B, -0.95, undefined, 0.15);
  b.cyl(E.body, 1.35, 2.2, -1.05, B, -0.95, 24);
  for (const y of [0.85, 1.1]) {
    b.box(E.accent, 3.02, 0.07, 2.72, 0.45, B + y, -0.95);
    b.cyl(E.accent, 1.37, 0.07, -1.05, B + y, -0.95, 24);
  }
  rbox(b, E.cream, 3.06, 0.24, 2.76, 0.45, B + 2.2, -0.95, undefined, 0.06);
  b.cyl(E.cream, 1.4, 0.24, -1.05, B + 2.2, -0.95, 24);
  snowCap(b, 2.9, 2.6, 0.6, B + 2.44, -0.95);
  snowDisc(b, 1.32, -1.05, B + 2.44, -0.95);
  // ribbon window on the drum, tuning dial and door on the wing
  g.box(E.glow, 1.3, 0.32, 0.06, -1.05, B + 1.4, 0.41);
  b.box(E.cream, 1.4, 0.06, 0.08, -1.05, B + 1.36, 0.42);
  b.box(E.cream, 1.4, 0.06, 0.08, -1.05, B + 1.74, 0.42);
  b.torus(E.accent, 0.42, 0.07, 1.1, B + 1.55, 0.42);
  g.cyl(G_WARM, 0.36, 0.05, 1.1, B + 1.55 - 0.025, 0.42, 16, 0.36, { rx: Math.PI / 2 });
  b.box(E.crimson, 0.05, 0.3, 0.04, 1.1, B + 1.42, 0.46, { rz: 0.5 });
  rbox(b, E.trim, 0.85, 1.25, 0.12, 0.05, B, 0.42, undefined, 0.05);
  g.box(G_WARM, 0.6, 0.35, 0.05, 0.05, B + 0.75, 0.48);
  b.box(E.accent, 0.95, 0.08, 0.16, 0.05, B + 1.25, 0.44);
  // gramophone horn on the roof (pointing out to the yard)
  b.cyl(E.trim, 0.12, 0.5, 1.4, B + 2.44, -1.2, 8);
  b.cone(E.accent, 0.42, 0.75, 1.4, B + 3.15, -0.95, 14, { rx: -Math.PI / 2 });
  b.cyl(E.honey, 0.1, 0.12, 1.4, B + 3.11, -1.4, 8, 0.1, { rx: Math.PI / 2 });
  // crown: lattice mast on the drum, beacon above the turning array
  lattice(b, E.accent, -1.05, -0.95, B + 2.5, 1.9, 0.7, 0.24, 4, 0.08);
  b.cyl(E.trim, 0.06, 0.6, -1.05, B + 4.5, -0.95, 8);
  g.sph(G_FIRE, 0.12, -1.05, B + 5.18, -0.95);
  // rotating dipole array (spins around Y): crossbar, two dipoles with copper balls
  p.cyl(E.trim, 0.14, 0.18, 0, -0.09, 0, 10);
  p.beam(E.cream, [-0.95, 0, 0], [0.95, 0, 0], 0.08);
  for (const s of [-1, 1]) {
    p.beam(E.honey, [s * 0.85, -0.35, 0], [s * 0.85, 0.35, 0], 0.05);
    p.sph(E.accent, 0.08, s * 0.85, 0.38, 0);
    p.sph(E.accent, 0.08, s * 0.85, -0.38, 0);
  }
  p.beam(E.cream, [0, 0, -0.4], [0, 0, 0.4], 0.06);
  return { at: [-1.05, B + 4.55, -0.95], axis: 'y', mode: 'spin', speed: 0.18 };
};

/** tillLine: marble counter with three brass cash registers whose price flags pop up and down. */
const tillLine: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 4.6, 4.4, E.ground, E.fence);
  const P = 0.25;
  // marble counter base with copper kick strip
  rbox(b, 0xdcd4c4, 4.1, 0.6, 3.1, 0, P, -0.5);
  b.box(E.accent, 4.12, 0.08, 3.12, 0, P + 0.06, -0.5);
  const C = P + 0.6;
  // teal till housing with brass drawers, cream counter top
  rbox(b, E.body, 3.3, 1.2, 1.9, 0, C, -0.85);
  for (const x of [-1.05, 0, 1.05]) {
    rbox(b, E.honey, 0.8, 0.3, 0.1, x, C + 0.3, 0.12, undefined, 0.04);
    b.box(E.trim, 0.24, 0.05, 0.06, x, C + 0.42, 0.19);
  }
  rbox(b, E.cream, 3.5, 0.14, 2.1, 0, C + 1.2, -0.85, undefined, 0.05);
  // coin slot in the counter front
  rbox(b, E.trim, 0.5, 0.26, 0.08, 0, P + 0.2, 1.06, undefined, 0.03);
  g.box(G_WARM, 0.36, 0.12, 0.05, 0, P + 0.27, 1.1);
  // three brass registers with sloped key panels and glowing tickers
  const R = C + 1.34;
  for (const x of [-1.05, 0, 1.05]) {
    rbox(b, E.honey, 0.82, 0.5, 0.62, x, R, -0.75, undefined, 0.07);
    b.box(E.accent, 0.72, 0.08, 0.45, x, R + 0.18, -0.3, { rx: 0.55 });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) b.box(E.cream, 0.1, 0.05, 0.08, x - 0.24 + c * 0.16, R + 0.25 - r * 0.07, -0.3 + r * 0.11, { rx: 0.55 });
    g.box(E.glow, 0.5, 0.14, 0.05, x, R + 0.32, -0.43);
    b.box(E.trim, 0.3, 0.1, 0.1, x, R + 0.5, -0.75);
  }
  snowCap(b, 3.3, 0.7, 0, C + 1.34, -1.55);
  // crown: copper pneumatic receipt tubes rising to a cone hopper
  b.cyl(E.trim, 0.1, 1.6, 0, C + 1.84, -1.6, 8);
  for (const x of [-1.05, 0, 1.05]) b.beam(E.accent, [x, R + 0.5, -0.9], [x * 0.25, C + 3.0, -1.6], 0.09);
  b.cone(E.accent, 0.5, 0.65, 0, C + 3.0, -1.6, 14, { rx: Math.PI });
  b.cyl(E.body, 0.52, 0.14, 0, C + 3.32, -1.6, 14);
  snowDisc(b, 0.48, 0, C + 3.46, -1.6);
  // price flags (bob up and down out of the registers)
  for (const x of [-1.05, 0, 1.05]) {
    p.cyl(E.trim, 0.03, 0.6, x, -0.6, 0, 6);
    rbox(p, x === 0 ? E.crimson : E.cream, 0.46, 0.28, 0.06, x, 0, 0, undefined, 0.03);
    p.box(x === 0 ? E.cream : E.crimson, 0.08, 0.2, 0.03, x, 0.04, 0.04);
    p.box(x === 0 ? E.cream : E.crimson, 0.2, 0.05, 0.03, x, 0.1, 0.04);
  }
  return { at: [0, R + 0.62, -0.75], axis: 'y', mode: 'bob', speed: 0.7, amp: 0.35 };
};

// ---------------------------------------------------------------------------
// era 7 — Oil: hazard honey-yellow, crimson pipes, charcoal trim, peach-orange glow
// ---------------------------------------------------------------------------

/** gasWell: wellhead valve tree in a hi-vis cage, a honey separator tank, a cosy hut, and a breathing flare. */
const gasWell: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 4.6, 4.6, O.ground, O.fence);
  const P = 0.25;
  rbox(b, O.concrete, 4.1, 0.2, 4.1, 0, P, 0);
  const W = P + 0.2;
  // wellhead "christmas tree": flange stack, crimson valve wheels, side outlets
  const wx = -0.4;
  const wz = -0.1;
  b.cyl(O.trim, 0.4, 0.2, wx, W, wz, 12);
  b.cyl(O.body, 0.26, 1.7, wx, W + 0.2, wz, 12);
  for (const y of [0.55, 1.05, 1.55]) b.cyl(O.trim, 0.34, 0.1, wx, W + y, wz, 12);
  for (const y of [0.8, 1.3]) {
    hcyl(b, O.body, 0.13, 0.9, wx, W + y, wz, 'x', 10);
    for (const s of [-1, 1]) wheel(b, 'x', O.accent, O.trim, wx + s * 0.48, W + y, wz, 0.18, 0.04, 4);
  }
  b.dome(O.accent, 0.28, wx, W + 1.9, wz);
  g.sph(G_WARM, 0.1, wx, W + 1.15, wz + 0.3);
  // hi-vis cage: four striped posts and two rails
  const cx = 1.0;
  const cz = 0.9;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const x = wx + sx * cx;
    const z = wz + sz * cz;
    for (let i = 0; i < 4; i++) b.cyl(i % 2 ? O.trim : O.body, 0.07, 0.3, x, W + i * 0.3, z, 8);
  }
  for (const y of [0.6, 1.15]) {
    for (const sz of [-1, 1]) b.beam(O.body, [wx - cx, W + y, wz + sz * cz], [wx + cx, W + y, wz + sz * cz], 0.07);
    for (const sx of [-1, 1]) b.beam(O.body, [wx + sx * cx, W + y, wz - cz], [wx + sx * cx, W + y, wz + cz], 0.07);
  }
  // separator tank on saddles (back right) with crimson bands and a snow ridge
  for (const x of [0.5, 1.6]) rbox(b, O.trim, 0.3, 0.6, 0.9, x, W, -1.4, undefined, 0.05);
  hcyl(b, O.body, 0.58, 1.6, 1.05, W + 1.1, -1.4, 'x', 18);
  for (const s of [-1, 1]) b.sph(O.body, 0.58, 1.05 + s * 0.8, W + 1.1, -1.4, { sx: 0.45 });
  for (const x of [0.6, 1.5]) b.torus(O.accent, 0.6, 0.05, x, W + 1.1, -1.4, { ry: Math.PI / 2 });
  rbox(b, SNOW, 1.8, 0.14, 0.5, 1.05, W + 1.64, -1.4, undefined, 0.06);
  b.beam(O.accent, [wx + 0.45, W + 1.3, wz], [0.5, W + 1.3, -1.1], 0.12);
  b.beam(O.accent, [0.5, W + 1.3, -1.1], [0.5, W + 1.1, -1.4], 0.12);
  // cosy control hut (front right)
  rbox(b, O.body, 1.1, 1.15, 0.95, 1.55, W, 0.95);
  pane(b, g, G_WARM, O.trim, 1.55, W + 0.5, 1.43, 0.55, 0.38);
  rbox(b, O.accent, 1.3, 0.14, 1.15, 1.55, W + 1.15, 0.95, undefined, 0.05);
  snowCap(b, 1.2, 1.05, 1.55, W + 1.29, 0.95);
  b.cyl(O.trim, 0.06, 0.3, 1.9, W + 1.3, 0.75, 6);
  // crown: flare stack with honey bands, guy wires and a wide tip cup
  const fx = -1.7;
  const fz = -1.7;
  b.cyl(O.trim, 0.36, 0.3, fx, W, fz, 10);
  b.cyl(O.steel, 0.17, 3.7, fx, W + 0.3, fz, 10, 0.15);
  for (const y of [1.0, 2.0, 3.0]) b.cyl(O.body, 0.19, 0.16, fx, W + y, fz, 10);
  b.cyl(O.accent, 0.15, 0.32, fx, W + 4.0, fz, 12, 0.3);
  for (const [dx, dz] of [[1.4, 0.2], [0.2, 1.4]] as const) b.beam(0x2b2b2b, [fx, W + 3.4, fz], [fx + dx, W, fz + dz], 0.025);
  // flare flame (breathes up and down out of the tip cup)
  p.sph(O.glow, 0.26, 0, 0.0, 0, { sy: 1.7 });
  p.sph(0xffd28a, 0.16, 0, -0.08, 0.12, { sy: 1.4 });
  p.cone(O.glow, 0.16, 0.36, 0, 0.36, 0, 8);
  return { at: [fx, W + 4.38, fz], axis: 'y', mode: 'bob', speed: 0.6, amp: 0.36, glow: true };
};

/** cracker: banded reactor with a spinning mixer drive on top, a tall fractionator tower and crimson pipework. */
const cracker: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 5.0, 4.8, O.ground, O.fence);
  const P = 0.25;
  rbox(b, O.concrete, 4.5, 0.3, 3.9, 0, P, -0.4);
  b.box(O.trim, 4.52, 0.08, 3.92, 0, P + 0.04, -0.4);
  const F = P + 0.3;
  // reactor: honey drum with crimson bands, dome, snow, sight glass
  const rx = -0.95;
  const rz = -0.6;
  b.cyl(O.body, 1.05, 2.5, rx, F, rz, 20, 1.0);
  for (const y of [0.4, 1.3, 2.2]) b.torus(O.accent, 1.04 - y * 0.02, 0.07, rx, F + y, rz, { rx: Math.PI / 2 }, 24);
  b.dome(O.bodyL, 1.0, rx, F + 2.5, rz, { sy: 0.4 });
  b.dome(SNOW, 0.86, rx, F + 2.55, rz, { sy: 0.36 });
  hcyl(b, O.trim, 0.26, 0.2, rx, F + 0.95, rz + 1.02, 'z', 14);
  g.cyl(G_FIRE, 0.2, 0.06, rx, F + 0.95 - 0.03, rz + 1.12, 14, 0.2, { rx: Math.PI / 2 });
  // round walkway ring with railing posts around the dome
  b.torus(O.trim, 1.18, 0.06, rx, F + 2.45, rz, { rx: Math.PI / 2 }, 24);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.cyl(O.body, 0.035, 0.4, rx + Math.cos(a) * 1.18, F + 2.45, rz + Math.sin(a) * 1.18, 6);
  }
  b.torus(O.body, 1.18, 0.035, rx, F + 2.85, rz, { rx: Math.PI / 2 }, 24);
  // fractionator tower (crown): tray bands, platform, ladder, floodlight
  const tx = 1.35;
  const tz = -1.25;
  b.cyl(O.bodyD, 0.62, 4.3, tx, F, tz, 16, 0.55);
  for (let y = 0.6; y < 4.2; y += 0.75) b.torus(O.accent, 0.62 - (y / 4.3) * 0.07, 0.06, tx, F + y, tz, { rx: Math.PI / 2 }, 20);
  b.dome(O.bodyL, 0.55, tx, F + 4.3, tz, { sy: 0.5 });
  b.dome(SNOW, 0.46, tx, F + 4.36, tz, { sy: 0.42 });
  for (const s of [-1, 1]) b.beam(O.trim, [tx + s * 0.18, F, tz + 0.66], [tx + s * 0.18, F + 3.6, tz + 0.6], 0.05);
  for (let y = 0.3; y < 3.6; y += 0.3) b.box(O.trim, 0.36, 0.04, 0.04, tx, F + y, tz + 0.65);
  b.beam(O.trim, [tx, F + 4.0, tz + 0.55], [tx, F + 4.1, tz + 0.9], 0.06);
  rbox(b, O.trim, 0.3, 0.2, 0.24, tx, F + 3.95, tz + 0.95, { rx: 0.4 }, 0.04);
  g.box(G_WARM, 0.22, 0.14, 0.05, tx, F + 3.97, tz + 1.08, { rx: 0.4 });
  // crimson pipe bridge between reactor and tower, on a little truss
  b.beam(O.accent, [rx + 0.6, F + 2.2, rz - 0.6], [tx - 0.5, F + 2.9, tz], 0.16);
  b.beam(O.accent, [rx + 0.9, F + 1.2, rz - 0.3], [tx - 0.55, F + 1.5, tz + 0.2], 0.14);
  b.beam(O.trim, [0.3, F, -1.0], [0.3, F + 2.55, -1.0], 0.1);
  // heat exchanger coil on saddles (front right)
  for (const x of [0.45, 1.55]) rbox(b, O.trim, 0.2, 0.45, 0.6, x, F, 0.95, undefined, 0.04);
  for (let i = 0; i < 4; i++) b.torus(O.accent, 0.36, 0.08, 0.6 + i * 0.27, F + 0.8, 0.95, { ry: Math.PI / 2 }, 14);
  hcyl(b, O.body, 0.12, 1.5, 1.0, F + 0.8, 0.95, 'x', 10);
  // front hatch
  rbox(b, O.trim, 0.8, 0.95, 0.12, rx, F, 0.42, undefined, 0.05);
  g.box(G_WARM, 0.55, 0.12, 0.05, rx, F + 0.75, 0.49);
  // mixer drive (spins around Y): gearbox, three crimson paddle arms
  rbox(p, O.trim, 0.4, 0.3, 0.4, 0, -0.05, 0, undefined, 0.06);
  p.cyl(O.bodyL, 0.12, 0.3, 0, 0.25, 0, 10);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x = Math.cos(a) * 0.72;
    const z = Math.sin(a) * 0.72;
    p.beam(O.trim, [0, 0.1, 0], [x, 0.1, z], 0.08);
    rbox(p, O.accent, 0.32, 0.22, 0.1, x, 0.0, z, { ry: -a + Math.PI / 2 }, 0.04);
  }
  return { at: [rx, F + 2.98, rz], axis: 'y', mode: 'spin', speed: 0.32 };
};

/** snowmobileWorks: honey hangar with a crimson gable roof and a showroom turntable carrying a cute snowmobile. */
const snowmobileWorks: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 5.0, 4.8, O.ground, O.fence);
  const P = 0.25;
  // hangar: honey walls, crimson stripe, charcoal plinth band
  rbox(b, O.trim, 4.3, 0.3, 2.5, 0, P, -1.1);
  taper(b, O.body, 4.2, 1.9, 2.4, 0, P + 0.3, -1.1, 0.03);
  b.box(O.accent, 4.16, 0.16, 2.36, 0, P + 1.55, -1.1);
  b.gable(0, -1.1, P + 2.2, 4.2, 2.4, 0.75, O.accent, O.accent, O.body, 0.16);
  // front: roll-up door half open onto a warm paint shop, side window
  rbox(b, O.trim, 1.9, 1.6, 0.14, 0.55, P + 0.3, 0.14, undefined, 0.04);
  for (let i = 0; i < 3; i++) b.box(i % 2 ? O.bodyD : O.cream, 1.66, 0.2, 0.06, 0.55, P + 1.22 + i * 0.2, 0.23);
  g.box(G_WARM, 1.66, 0.88, 0.05, 0.55, P + 0.34, 0.2);
  pane(b, g, G_WARM, O.trim, -1.35, P + 0.95, 0.12, 0.7, 0.5);
  // crown: fume stack behind the roof
  chimney(b, O.trim, O.body, -1.75, P, -2.0, 0.26, 4.4);
  // showroom turntable base (front centre) and two spotlights on poles
  b.cyl(O.trim, 1.0, 0.12, 0, P, 1.3, 24);
  b.torus(O.accent, 0.98, 0.04, 0, P + 0.12, 1.3, { rx: Math.PI / 2 }, 24);
  for (const s of [-1, 1]) {
    b.cyl(O.trim, 0.06, 1.7, s * 2.15, P, 1.9, 8);
    rbox(b, O.trim, 0.26, 0.22, 0.3, s * 2.15, P + 1.7, 1.8, { ry: s * 0.6 }, 0.05);
    g.box(G_WARM, 0.2, 0.16, 0.05, s * 2.0, P + 1.73, 1.7, { ry: s * 0.6 });
    snowCap(b, 0.26, 0.3, s * 2.15, P + 1.92, 1.8);
  }
  // turntable top and the snowmobile (spins around Y)
  p.cyl(O.cream, 0.94, 0.08, 0, 0, 0, 24);
  const y = 0.08;
  for (const s of [-1, 1]) {
    rbox(p, O.steel, 1.4, 0.05, 0.14, 0.05, y + 0.02, s * 0.3, undefined, 0.02);
    p.box(O.steel, 0.2, 0.05, 0.14, 0.78, y + 0.1, s * 0.3, { rz: 0.6 });
    p.beam(O.trim, [0.3, y + 0.05, s * 0.3], [0.3, y + 0.32, s * 0.2], 0.05);
  }
  rbox(p, O.trim, 0.7, 0.26, 0.42, -0.35, y + 0.1, 0, undefined, 0.06);
  rbox(p, O.accent, 1.05, 0.34, 0.56, 0.05, y + 0.3, 0, undefined, 0.12);
  rbox(p, O.accent, 0.5, 0.26, 0.5, 0.55, y + 0.26, 0, { rz: -0.35 }, 0.1);
  rbox(p, O.trim, 0.5, 0.14, 0.4, -0.25, y + 0.62, 0, undefined, 0.06);
  p.box(0xbfe0e8, 0.06, 0.24, 0.42, 0.32, y + 0.72, 0, { rz: -0.4 });
  p.beam(O.trim, [0.2, y + 0.64, -0.26], [0.2, y + 0.64, 0.26], 0.04);
  p.sph(O.cream, 0.08, 0.84, y + 0.42, 0);
  p.box(O.body, 0.9, 0.05, 0.58, 0.05, y + 0.48, 0);
  return { at: [0, P + 0.12, 1.3], axis: 'y', mode: 'spin', speed: 0.16 };
};

/** driveThruVault: honey teller kiosk under a crimson-trimmed canopy; a tube capsule zips up and down to the lane. */
const driveThruVault: Recipe = ({ body: b, glow: g, pivot: p }) => {
  plinth(b, 4.6, 4.4, O.ground, O.fence);
  const P = 0.25;
  // drive lane across the front with honey dashes
  rbox(b, O.asphalt, 4.3, 0.06, 1.5, 0, P, 1.05, undefined, 0.02);
  for (let x = -1.8; x <= 1.8; x += 0.6) b.box(O.body, 0.3, 0.02, 0.08, x, P + 0.06, 1.05);
  // kiosk (back left): honey body, crimson band, teller window
  rbox(b, O.trim, 2.5, 0.3, 1.9, -0.75, P, -1.1);
  taper(b, O.body, 2.4, 1.7, 1.8, -0.75, P + 0.3, -1.1, 0.04);
  b.box(O.accent, 2.36, 0.14, 1.76, -0.75, P + 1.62, -1.1);
  pane(b, g, G_WARM, O.trim, -0.75, P + 0.8, -0.18, 1.2, 0.65);
  rbox(b, O.steel, 1.0, 0.1, 0.3, -0.75, P + 0.75, -0.05, undefined, 0.03);
  rbox(b, O.trim, 2.6, 0.16, 2.0, -0.75, P + 2.0, -1.1, undefined, 0.05);
  snowCap(b, 2.5, 1.9, -0.75, P + 2.16, -1.1);
  // canopy over the lane on four posts
  for (const [x, z] of [[-1.95, -0.05], [1.95, -0.05], [-1.95, 1.75], [1.95, 1.75]] as const) {
    b.cyl(O.trim, 0.1, 2.5, x, P, z, 8);
    for (let i = 0; i < 2; i++) b.cyl(i ? O.accent : O.body, 0.13, 0.25, x, P + i * 0.25, z, 8);
  }
  rbox(b, O.body, 4.3, 0.3, 2.1, 0, P + 2.5, 0.85, undefined, 0.1);
  b.box(O.accent, 4.34, 0.1, 2.14, 0, P + 2.55, 0.85);
  snowCap(b, 4.2, 2.0, 0, P + 2.8, 0.85);
  g.box(G_WARM, 3.6, 0.04, 0.12, 0, P + 2.46, 1.5);
  g.box(G_WARM, 3.6, 0.04, 0.12, 0, P + 2.46, 0.2);
  // customer pedestal and pneumatic tube (front right): four rails and glass rings
  const tx = 1.1;
  const tz = 1.05;
  rbox(b, O.trim, 0.55, 1.0, 0.45, tx, P, tz + 0.3);
  rbox(b, O.accent, 0.5, 0.2, 0.36, tx, P + 0.75, tz + 0.45, { rx: 0.4 }, 0.05);
  g.box(G_WARM, 0.3, 0.1, 0.05, tx, P + 0.84, tz + 0.62, { rx: 0.4 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.beam(O.steel, [tx + dx * 0.2, P + 1.0, tz + dz * 0.2], [tx + dx * 0.2, P + 2.5, tz + dz * 0.2], 0.04);
  for (const y of [1.0, 1.5, 2.0, 2.45]) b.torus(0xbfe0e8, 0.26, 0.035, tx, P + y, tz, { rx: Math.PI / 2 }, 14);
  // crown: honey coin sign on a tall pylon (back right)
  b.cyl(O.trim, 0.1, 3.5, 1.65, P, -1.55, 8);
  hcyl(b, O.body, 0.62, 0.16, 1.65, P + 3.95, -1.55, 'z', 22);
  b.torus(O.accent, 0.62, 0.07, 1.65, P + 3.95, -1.55, undefined, 22);
  g.box(G_WARM, 0.1, 0.62, 0.04, 1.65, P + 3.64, -1.45);
  g.box(G_WARM, 0.36, 0.08, 0.04, 1.65, P + 4.04, -1.45);
  g.box(G_WARM, 0.36, 0.08, 0.04, 1.65, P + 3.78, -1.45);
  rbox(b, SNOW, 0.3, 0.1, 0.18, 1.65, P + 4.55, -1.55, undefined, 0.04);
  // bollards
  for (const x of [-2.1, 2.1]) {
    b.cyl(O.body, 0.13, 0.7, x, P, 2.0, 10);
    b.cyl(O.trim, 0.135, 0.1, x, P + 0.45, 2.0, 10);
    b.dome(SNOW, 0.13, x, P + 0.7, 2.0);
  }
  // tube capsule (zips up and down the tube)
  p.cyl(O.accent, 0.16, 0.5, 0, -0.25, 0, 12);
  for (const s of [-1, 1]) p.sph(O.bodyL, 0.16, 0, s * 0.25, 0, { sy: 0.5 });
  p.torus(O.cream, 0.165, 0.025, 0, 0, 0, { rx: Math.PI / 2 }, 12);
  return { at: [tx, P + 1.75, tz], axis: 'y', mode: 'bob', speed: 0.4, amp: 0.5 };
};

const RECIPES: Record<Era5to7MachineId, Recipe> = {
  rollingMill, plowWorks, bankVault, quartzPit, bulbWorks, radioWorks, tillLine, gasWell, cracker, snowmobileWorks, driveThruVault,
};

// ---------------------------------------------------------------------------
// building models
// ---------------------------------------------------------------------------

interface Built {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  pivot: THREE.BufferGeometry;
  spec: PivotSpec;
  w: number;
  d: number;
}

const builtCache = new Map<Era5to7MachineId, Built>();

function build(id: Era5to7MachineId): Built {
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

/** Build one era 5–7 machine (geometry cached per id; every call returns a new root sharing it). */
export function createEra5to7MachineModel(id: Era5to7MachineId): MachineModel {
  const built = build(id);
  const root = new THREE.Group();
  root.name = `machine:${id}:${ERA5_7_MACHINE_ERA[id]}`;
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
  pivotMesh.castShadow = !spec.glow;
  pivotMesh.position.set(...spec.at);
  root.add(pivotMesh);
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
    }
  };
  const v = VENTS[id];
  return { root, w: built.w, d: built.d, animate, ...(v ? { vents: v, ventColor: 0xf2ece6 } : {}) };
}

/** 0.9.8 (era 5): stack tops that puff while working (eras/Machine.ts). */
const VENTS: Partial<Record<Era5to7MachineId, V3[]>> = {
  rollingMill: [[1.55, 5.4, -1.75]],
  plowWorks: [[-1.6, 5.1, -1.9]],
};

// ---------------------------------------------------------------------------
// gallery catalog (?gallery=eraMachines3, or one era sheet: ?gallery=era5new)
// ---------------------------------------------------------------------------

/** A working model for the gallery: it animates on its own (the gallery has no per-asset tick). */
function galleryModel(id: Era5to7MachineId): THREE.Object3D {
  const m = createEra5to7MachineModel(id);
  // Pose the animated part mid-motion so a still shot shows it doing something.
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
for (const id of ERA5_7_MACHINE_IDS) catalog[id] = () => galleryModel(id);
for (const era of [5, 6, 7] as const) {
  catalog[`era${era}new`] = () => {
    const sheet = new THREE.Group();
    sheet.name = `era${era}new`;
    let x = 0;
    for (const id of ERA5_7_MACHINE_IDS) {
      if (ERA5_7_MACHINE_ERA[id] !== era) continue;
      const m = galleryModel(id);
      m.position.x = x + 2.8;
      x += 6.2;
      sheet.add(m);
    }
    return sheet;
  };
}
export const eraMachine3Catalog: Record<string, () => THREE.Object3D> = catalog;
