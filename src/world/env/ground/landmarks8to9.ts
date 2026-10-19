/**
 * Era signature landmarks (eras 8-9), built like landmarks2to5.ts (shared At / Def / spot search):
 *   8 Computer  a little lighthouse on a frozen shore: an icy oval, a cream-and-teal striped lighthouse on a rounded rock,
 *               a glowing lamp room, a short timber jetty with a gold-pan sieve and a rowboat pulled up on the ice
 *   9 Nuclear   twin rounded cooling towers (mint-white with a mint band, soft steam puffs), a glazed control hut with an
 *               aqua-lit window and a mint-kerbed path between the towers
 * Solids are one cached geometry per era; the ice, the path and the kerbs go into the floor batch, the lamp room and the
 * window into the glow batch. Colours come only from palette.ts rows.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import type { RegionLayout } from '../../../eras/layout';
import { Batch } from '../../../render/batch';
import { geo } from '../../../render/materials';
import { GOLD, MACHINE_SHADES, mixHex, palette, SNOW } from '../../../render/palette';
import type { Rng } from '../common';
import type { GroundKit } from '../eraGround';
import { At, placeDef, spotFor, world, type Def } from './landmarks2to5';
import { FLOOR_Y } from './lateKit';

type Era = 8 | 9;

const P8 = palette(8);
const P9 = palette(9);
const S1 = MACHINE_SHADES[1];

// ---------------------------------------------------------------------------------------------------------------------
// era 8: lighthouse on a frozen shore
// ---------------------------------------------------------------------------------------------------------------------

const L = {
  cream: mixHex(P8.body, SNOW, 0.25),
  teal: P8.accent,
  tealD: mixHex(P8.accent, P8.trim, 0.25),
  tealL: mixHex(P8.accent, SNOW, 0.35),
  rock: mixHex(P8.ground, P8.trim, 0.28),
  rockL: mixHex(P8.ground, SNOW, 0.3),
  iceRim: mixHex(P8.ground, SNOW, 0.55),
  ice: mixHex(mixHex(P8.ground, P8.accent, 0.14), SNOW, 0.3),
  iceD: mixHex(mixHex(P8.ground, P8.accent, 0.22), SNOW, 0.12),
  timber: S1.timber,
  plank: S1.plank,
  hull: S1.lacquer,
  gold: GOLD,
  glow: mixHex(P8.light, GOLD, 0.35),
};
/** The tower's foot in the landmark's frame. */
const TX = -1.1;
const TZ = -0.5;

let lighthouse: THREE.BufferGeometry | null = null;
/** Lighthouse on a rock, jetty with a gold-pan sieve, rowboat, shore stones (≈ 6.5 m, x −4…4.6, z −3…3). */
export function lighthouseGeo(): THREE.BufferGeometry {
  if (!lighthouse) {
    const a = new At(new Batch());
    // the rounded rock and its snow
    a.add(geo.dodecahedron(1, 1), L.rock, TX, 0.45, TZ, { sx: 1.55, sy: 0.7, sz: 1.4, ry: 0.4 });
    a.add(geo.dodecahedron(1, 1), L.rockL, TX + 1.2, 0.3, TZ + 0.5, { sx: 0.7, sy: 0.45, sz: 0.6, ry: 1.1 });
    a.add(geo.dodecahedron(1, 1), L.rock, TX - 1.25, 0.28, TZ + 0.35, { sx: 0.6, sy: 0.4, sz: 0.55, ry: 0.2 });
    a.snow(TX, 0.98, TZ, 1.15, 1.0, 0.24);
    // striped tower: four tapering bands, cream / teal
    const r0 = 0.98;
    const r1 = 0.62;
    const y0 = 0.85;
    const bh = 1.05;
    for (let i = 0; i < 4; i++) {
      const rb = r0 + (r1 - r0) * (i / 4);
      const rt = r0 + (r1 - r0) * ((i + 1) / 4);
      a.add(geo.cylinder(rt + 0.005, rb + 0.005, bh, 18), i % 2 ? L.teal : L.cream, TX, y0 + bh * (i + 0.5), TZ);
    }
    const top = y0 + bh * 4;
    // door and windows facing the camera side (+x +z)
    const dir = Math.PI / 4;
    const at = (r: number): [number, number] => [TX + Math.sin(dir) * r, TZ + Math.cos(dir) * r];
    const [dx, dz] = at(0.93);
    a.box(L.timber, dx, y0 + 0.4, dz, 0.42, 0.7, 0.14, dir);
    a.add(geo.cylinder(0.21, 0.21, 0.14, 10), L.timber, dx, y0 + 0.75, dz, { rx: Math.PI / 2, ry: dir });
    for (const [y, r] of [[2.35, 0.8], [3.5, 0.7]] as const) {
      const [wx, wz] = at(r);
      a.box(L.tealD, wx, y, wz, 0.24, 0.36, 0.1, dir);
      a.snow(wx, y + 0.2, wz, 0.18, 0.1, 0.05);
    }
    // gallery: a round deck, a gold rail, four little posts
    a.add(geo.cylinder(0.86, 0.7, 0.16, 18), L.tealD, TX, top + 0.04, TZ);
    a.add(geo.torus(0.8, 0.04, 6, 22), L.gold, TX, top + 0.34, TZ, { rx: Math.PI / 2 });
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      a.add(geo.cylinder(0.025, 0.025, 0.3, 5), L.gold, TX + Math.cos(t) * 0.8, top + 0.2, TZ + Math.sin(t) * 0.8);
    }
    // lamp room: glass is in the glow batch; here the frame posts and the dome
    const ly = top + 0.12;
    for (let i = 0; i < 4; i++) {
      const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
      a.add(geo.cylinder(0.05, 0.05, 0.62, 6), L.gold, TX + Math.cos(t) * 0.46, ly + 0.4, TZ + Math.sin(t) * 0.46);
    }
    a.add(geo.cylinder(0.52, 0.5, 0.1, 14), L.gold, TX, ly + 0.05, TZ);
    a.add(geo.sphere(1, 16, 10), L.teal, TX, ly + 0.74, TZ, { sx: 0.62, sy: 0.5, sz: 0.62 });
    a.snow(TX, ly + 1.05, TZ, 0.4, 0.4, 0.16);
    a.add(geo.sphere(0.09, 8, 6), L.gold, TX, ly + 1.3, TZ);
    // jetty: planks over the water from the east shore, with posts
    for (let i = 0; i < 6; i++) a.box(i % 2 ? L.plank : L.timber, 2.55 + i * 0.5, 0.36, 0.9, 0.46, 0.08, 1.0);
    for (const z of [0.4, 1.4]) a.box(L.timber, 3.7, 0.28, z, 3.1, 0.1, 0.1);
    for (const x of [1.4, 2.6, 3.8]) for (const z of [0.4, 1.4]) {
      a.add(geo.cylinder(0.07, 0.08, 0.7, 6), L.timber, x, 0.2, z);
      a.add(geo.sphere(0.085, 6, 4), L.plank, x, 0.56, z);
    }
    a.snow(3.8, 0.42, 0.9, 1.2, 0.4, 0.06);
    // the gold-pan sieve at the jetty's tip: a timber A-frame holding a tilted ring with a gold-flecked pan
    const sx = 1.55;
    const sz = 0.9;
    for (const z of [-0.32, 0.32]) {
      a.add(geo.cylinder(0.04, 0.05, 0.9, 5), L.timber, sx, 0.8, sz + z, { rx: z > 0 ? -0.25 : 0.25 });
    }
    a.box(L.timber, sx, 1.22, sz, 0.08, 0.08, 0.7);
    a.add(geo.torus(0.3, 0.05, 6, 16), L.plank, sx, 0.95, sz, { rx: Math.PI / 2 - 0.5 });
    a.add(geo.cylinder(0.27, 0.27, 0.04, 14), L.gold, sx, 0.95, sz, { rx: -0.5 });
    a.add(geo.sphere(0.08, 6, 5), mixHex(L.gold, SNOW, 0.35), sx, 0.82, sz + 0.12);
    // a little bucket and a gold heap at the jetty's root
    a.add(geo.cylinder(0.17, 0.13, 0.26, 10), L.tealD, 4.35, 0.52, 0.55);
    a.add(geo.sphere(1, 8, 5), L.gold, 4.4, 0.42, 1.4, { sx: 0.3, sy: 0.14, sz: 0.26 });
    // rowboat pulled up on the ice (south-west of the rock), bow up on the shore
    const bx = -1.9;
    const bz = 1.85;
    a.add(geo.sphere(1, 14, 8), L.hull, bx, 0.22, bz, { sx: 1.0, sy: 0.3, sz: 0.46, ry: 0.35 });
    a.add(geo.sphere(1, 14, 8), L.cream, bx, 0.34, bz, { sx: 0.88, sy: 0.16, sz: 0.36, ry: 0.35 });
    a.add(geo.torus(0.45, 0.03, 5, 16), L.teal, bx, 0.35, bz, { rx: Math.PI / 2, sx: 2.0, sy: 0.9, sz: 1, ry: 0.35 });
    a.box(L.plank, bx, 0.4, bz, 0.12, 0.05, 0.66, 0.35);
    a.add(geo.cylinder(0.025, 0.025, 1.1, 5), L.timber, bx + 0.1, 0.55, bz - 0.5, { rz: 1.0, ry: 0.35 });
    a.snow(bx + 0.5, 0.46, bz - 0.2, 0.2, 0.12, 0.05);
    // shore stones round the ice
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2 + 0.3;
      const x = Math.cos(t) * 3.95;
      const z = Math.sin(t) * 2.85;
      if (x > 1.2 && z > -0.4 && z < 1.9) continue; // the jetty's root
      const r = 0.26 + (i % 3) * 0.08;
      a.add(geo.dodecahedron(r, 0), i % 2 ? L.rock : L.rockL, x, r * 0.5, z, { sy: 0.7, ry: i });
      a.snow(x, r * 0.95, z, r * 0.7, r * 0.7, 0.08);
    }
    lighthouse = a.b.geometry();
  }
  return lighthouse;
}
function lighthouseGlow(g: At): void {
  const top = 0.85 + 1.05 * 4;
  g.add(geo.cylinder(0.43, 0.43, 0.62, 14), L.glow, TX, top + 0.45, TZ);
}
function lighthouseFloor(g: At): void {
  const y = FLOOR_Y;
  g.add(geo.circleGround(1, 36), L.iceRim, 0, y + 0.004, 0, { sx: 4.25, sz: 3.15 });
  g.add(geo.circleGround(1, 36), L.ice, 0, y + 0.007, 0, { sx: 3.8, sz: 2.8 });
  g.add(geo.circleGround(1, 28), L.iceD, 0.6, y + 0.01, -0.2, { sx: 2.4, sz: 1.6 });
  g.add(geo.circleGround(1, 20), mixHex(L.ice, SNOW, 0.5), -2.0, y + 0.012, -0.9, { sx: 0.8, sz: 0.4, ry: 0.4 });
  g.add(geo.circleGround(1, 20), mixHex(L.ice, SNOW, 0.5), 1.9, y + 0.012, -1.5, { sx: 0.6, sz: 0.3, ry: -0.3 });
}

// ---------------------------------------------------------------------------------------------------------------------
// era 9: twin cooling towers
// ---------------------------------------------------------------------------------------------------------------------

const C = {
  wall: mixHex(SNOW, P9.accent, 0.1),
  wallD: mixHex(SNOW, P9.accent, 0.24),
  band: P9.accent,
  bandL: mixHex(P9.accent, SNOW, 0.35),
  inner: mixHex(P9.accent, P9.ground, 0.45),
  plinth: mixHex(P9.ground, SNOW, 0.4),
  puff: mixHex(SNOW, P9.ground, 0.1),
  roof: mixHex(P9.accent, SNOW, 0.2),
  kerb: P9.accent,
  walk: mixHex(SNOW, P9.accent, 0.12),
  glow: mixHex(P9.glow, SNOW, 0.2),
};
const TOWER_X = [-2.7, 2.7] as const;
const TOWER_Z = [0.9, -0.9] as const;
const TOWER_H = 6;
const HUT_Z = 3.4;

/** Hyperboloid-ish radius at height t (0..1): wide base, a waist about 62% up, a slightly flared mouth. */
const towerR = (t: number): number => Math.sqrt(1.15 * 1.15 + 3.0 * (t - 0.62) * (t - 0.62)) ;

let towers: THREE.BufferGeometry | null = null;
/** Two cooling towers with steam puffs, a control hut at the end of the path between them (≈ 7.4 m, x ±4.4, z −2…4.4). */
export function coolingTowersGeo(): THREE.BufferGeometry {
  if (!towers) {
    const a = new At(new Batch());
    const seg = 8;
    for (const [ti, x] of TOWER_X.entries()) {
      const z = TOWER_Z[ti]!;
      a.add(geo.cylinder(1.85, 1.95, 0.2, 24), C.plinth, x, 0.1, z);
      a.snow(x, 0.2, z, 1.75, 1.75, 0.05);
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg;
        const t1 = (i + 1) / seg;
        const h = (TOWER_H - 0.2) / seg;
        a.add(geo.cylinder(towerR(t1), towerR(t0), h + 0.01, 24), i % 2 ? C.wall : C.wallD, x, 0.2 + h * (i + 0.5), z);
      }
      // the mint band near the mouth, and the rounded rim
      a.add(geo.cylinder(towerR(0.93) + 0.04, towerR(0.8) + 0.04, 0.62, 24), C.band, x, 0.2 + 0.865 * (TOWER_H - 0.2), z);
      a.add(geo.torus(towerR(1) + 0.02, 0.1, 8, 28), C.bandL, x, TOWER_H, z, { rx: Math.PI / 2 });
      a.add(geo.cylinder(towerR(1) - 0.1, towerR(1) - 0.1, 0.05, 24), C.inner, x, TOWER_H - 0.18, z);
      a.add(geo.torus(towerR(1) + 0.02, 0.07, 6, 28), SNOW, x, TOWER_H + 0.07, z, { rx: Math.PI / 2 });
      // soft round steam puffs rising from the mouth
      const px = ti ? -1 : 1;
      a.add(geo.sphere(0.8, 14, 10), C.puff, x + px * 0.1, TOWER_H + 0.55, z);
      a.add(geo.sphere(0.6, 12, 8), C.puff, x - px * 0.55, TOWER_H + 1.25, z + 0.3);
      a.add(geo.sphere(0.46, 12, 8), C.puff, x + px * 0.6, TOWER_H + 1.7, z - 0.25);
      a.add(geo.sphere(0.3, 10, 6), C.puff, x + px * 1.2, TOWER_H + 2.2, z);
      // a tidy access door at the foot, facing the path
      a.box(C.bandL, x + (ti ? -1.52 : 1.52), 0.55, z, 0.14, 0.7, 0.5);
    }
    // control hut at the end of the path: a rounded glazed cabin with a mint roof and snow
    const hz = HUT_Z;
    a.box(C.plinth, 0, 0.1, hz, 2.2, 0.2, 1.7);
    a.box(C.wall, 0, 0.75, hz, 1.9, 1.1, 1.4);
    a.box(C.band, 0, 0.35, hz, 1.96, 0.12, 1.46);
    a.add(geo.sphere(1, 18, 10), C.roof, 0, 1.3, hz, { sx: 1.08, sy: 0.55, sz: 0.88 });
    a.snow(0, 1.78, hz, 0.9, 0.6, 0.17);
    a.box(C.bandL, 0.2, 0.62, hz - 0.72, 0.5, 0.82, 0.1);
    // window frames (the aqua panes are in the glow batch)
    a.box(C.band, 0.0, 0.85, hz + 0.72, 1.2, 0.62, 0.05);
    a.box(C.band, 0.97, 0.85, hz, 0.05, 0.62, 0.9);
    a.add(geo.cylinder(0.04, 0.04, 0.8, 5), C.band, 0.75, 2.2, hz - 0.45);
    a.add(geo.sphere(0.1, 8, 6), C.bandL, 0.75, 2.62, hz - 0.45);
    towers = a.b.geometry();
  }
  return towers;
}
function coolingTowersGlow(g: At): void {
  g.box(C.glow, 0.0, 0.85, HUT_Z + 0.75, 1.0, 0.46, 0.04);
  g.box(C.glow, 1.0, 0.85, HUT_Z, 0.04, 0.46, 0.7);
  for (const [i, x] of TOWER_X.entries()) g.add(geo.cylinder(towerR(1) - 0.3, towerR(1) - 0.3, 0.04, 20), C.glow, x, TOWER_H - 0.14, TOWER_Z[i]!);
}
function coolingTowersFloor(g: At): void {
  const y = FLOOR_Y;
  const z0 = -1.8;
  const z1 = HUT_Z - 0.9;
  const w = 1.5;
  g.box(C.walk, 0, y + 0.004, (z0 + z1) / 2, w, 0.008, z1 - z0);
  for (const s of [-1, 1]) g.box(C.kerb, s * (w / 2), y + 0.007, (z0 + z1) / 2, 0.16, 0.014, z1 - z0);
  g.box(C.kerb, 0, y + 0.007, z0, w + 0.16, 0.014, 0.16);
  for (const [i, x] of TOWER_X.entries()) g.add(geo.circleGround(1, 28), C.plinth, x, y + 0.004, TOWER_Z[i]!, { sx: 1.95, sz: 1.95 });
}

// ---------------------------------------------------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------------------------------------------------

const DEFS: Record<Era, Def> = {
  8: { geom: lighthouseGeo, glow: lighthouseGlow, floor: lighthouseFloor, fp: { minX: -4.3, maxX: 4.7, minZ: -3.2, maxZ: 3.2 }, h: 6.6, lamps: [[TX, 5.5, TZ, 3.0, 7.0]] },
  9: { geom: coolingTowersGeo, glow: coolingTowersGlow, floor: coolingTowersFloor, fp: { minX: -4.7, maxX: 4.7, minZ: -3.0, maxZ: 4.4 }, h: 8.4, lamps: [[1.0, 1.0, HUT_Z + 0.3, 2.0, 4.4], [-2.7, 6.1, 0.9, 2.2, 4.0], [2.7, 6.1, -0.9, 2.2, 4.0]] },
};

export function landmarkSpot89(l: RegionLayout, n: Era, avoid: readonly Rect[] = []): { x: number; z: number } | null {
  return spotFor(DEFS[n], l, avoid);
}

/** The rect the landmark covers (for keepOut), or [] when it has no spot. */
export function landmarkRect89(l: RegionLayout, n: Era, avoid: readonly Rect[] = []): Rect[] {
  const s = landmarkSpot89(l, n, avoid);
  return s ? [world(DEFS[n], s.x, s.z)] : [];
}

/** Build era n's landmark into the kit; null when nothing fits. */
export function placeLandmark89(k: GroundKit, l: RegionLayout, rng: Rng, n: Era, avoid: readonly Rect[] = []): { x: number; z: number } | null {
  void rng;
  const s = landmarkSpot89(l, n, avoid);
  return s ? placeDef(k, n, DEFS[n], s) : null;
}

/** The landmark's footprint as a few discs (for the modules' `placed` lists): grid of circles covering the rect. */
export function landmarkDiscs(l: RegionLayout, n: Era): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const q of landmarkRect89(l, n)) {
    const cols = Math.ceil((q.maxX - q.minX) / 2.4);
    const rows = Math.ceil((q.maxZ - q.minZ) / 2.4);
    const w = (q.maxX - q.minX) / cols;
    const d = (q.maxZ - q.minZ) / rows;
    const r = Math.hypot(w, d) / 2;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) out.push({ x: q.minX + w * (i + 0.5), z: q.minZ + d * (j + 0.5), r });
  }
  return out;
}
