/**
 * [0.9.8 — world 10b] Era 4, the Steam Age: everything here is about COAL and the railway that hauls it (R36, R37).
 *
 * Wild (from the start, under the snow wash while the plot is for sale):
 * - The landmark: a RAIL SIDING along the harvest zone's south fence: a buffer stop, a little brick-red tank engine
 *   with brass bands and a glowing firebox, two coal hoppers heaped with snowy coal, a water crane and a signal lamp.
 * - The west belt: timber water towers with brass hoops between snowy pines.
 * - Coal seams streaking the snow, coal heaps and scrap piles in the harvest zone. Coal here is a warm plum charcoal
 *   with brass glints, never near-black (the 0.9.0 coal heaps were #2c2b2e).
 * Open (once bought):
 * - The processing floor in CINDER SLATE slabs with warm ember specks and brass cell lines; the front yard a cinder
 *   apron between red-brick kerbs; the paths in packed cinder with brick edging (palette(4).floor).
 * - Gas lamps along the yard path (the DIRECTION night light, #ffbe55) with warm halos at night.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import { plotPlaces, type PlotPlaces, type RegionLayout } from '../../../eras/layout';
import { mixHex, MACHINE_TONES, palette, SNOW } from '../../../render/palette';
import { geo } from '../../../render/materials';
import { Rng } from '../common';
import { pineGeo, pineTallGeo } from '../props';
import { nodePatch, regionPaths } from '../frontier';
import type { EraGroundModule, GroundKit } from '../eraGround';
import { landmarkRect, placeLandmark } from './landmarks2to5';
import { around, beltSpots, cellMarks, harvestSpots, Kit, pathPoles, yardBand, type GroundSolid, clip, sightKeep, snowAvoid, snowDrifts, snowVerges } from './kit4to7';

const T = MACHINE_TONES[4];
const P4 = palette(4);
const BRICK = T.body;
const BRICK_D = mixHex(T.body, T.trim, 0.3);
const BRASS = T.accent;
const BRASS_L = mixHex(T.accent, SNOW, 0.3);
const IRON = mixHex(T.trim, T.fence, 0.5);
const IRON_L = mixHex(T.fence, SNOW, 0.25);
/** Coal: a warm plum charcoal with brass glints (never near-black). */
const COAL = mixHex(T.trim, T.body, 0.3);
const COAL_L = mixHex(COAL, IRON_L, 0.35);
const TIMBER = palette(1).body;
const TIMBER_D = palette(1).trim;
const SLATE = P4.floor.yard;
const EMBER = P4.floor.processing;
const LAMP = P4.light;

/** The rail siding along the harvest zone's south fence (pure): track ends, track z, and where each piece stands. */
export function sidingPlace(l: RegionLayout): { x0: number; x1: number; z: number; engine: number; hoppers: number[]; crane: { x: number; z: number }; signal: { x: number; z: number } } {
  const H = l.zones.harvest;
  const F = plotPlaces(l.n).field;
  const z = H.maxZ - 1.4;
  const x0 = l.rect.minX + 3.2;
  const x1 = Math.min(F.minX - 1.2, x0 + 26);
  const engine = x0 + 3.6;
  return { x0, x1, z, engine, hoppers: [engine + 4.0, engine + 7.0], crane: { x: x0 + 1.2, z: z - 2.3 }, signal: { x: Math.max(engine + 9.5, x1 - 1.0), z: z + 0.95 } };
}

/** Every solid era 4 adds that stands taller than a kerb (tests: nothing hides a pad, counter or the hand node). */
export function era04Solids(l: RegionLayout): GroundSolid[] {
  const s = sidingPlace(l);
  return [
    { what: 'tank engine', r: around(s.engine, s.z, 1.7, 0.8), h: 2.7 },
    ...s.hoppers.map((x) => ({ what: 'coal hopper', r: around(x, s.z, 1.3, 0.75), h: 2.0 })),
    { what: 'buffer stop', r: around(s.x0 + 0.3, s.z, 0.4, 1.0), h: 1.2 },
    { what: 'buffer stop', r: around(s.x1 - 0.3, s.z, 0.4, 1.0), h: 1.2 },
    { what: 'water crane', r: around(s.crane.x, s.crane.z, 0.6), h: 3.6 },
    { what: 'signal lamp', r: around(s.signal.x, s.signal.z, 0.3), h: 3.2 },
    ...pathPoles(l).map((p) => ({ what: 'gas lamp', r: around(p.x, p.z, 0.3), h: 3.3 })),
  ];
}

function baseKeepOut(l: RegionLayout): Rect[] {
  const s = sidingPlace(l);
  return [{ minX: s.x0 - 0.6, maxX: s.x1 + 0.4, minZ: s.z - 1.5, maxZ: s.z + 1.5 }, around(s.crane.x, s.crane.z, 1.1), around(s.signal.x, s.signal.z, 0.8)].map((r) => clip(r, l.rect));
}

/** The era's own keep-outs plus the signature landmark's footprint. */
function keepOut(l: RegionLayout): Rect[] {
  return [...baseKeepOut(l), ...landmarkRect(l, 4, baseKeepOut(l))];
}

// ---------------------------------------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------------------------------------

/** A timber water tower on splayed legs with brass hoops and a brick-red cone roof (≈5.6 m). */
function waterTowerGeo(): THREE.BufferGeometry {
  const k = new Kit();
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) k.beam([x, 0, z], [x * 0.78, 3.3, z * 0.78], 0.22, TIMBER_D);
  k.beam([-0.9, 0.5, 0.9], [0.9, 2.1, 0.9], 0.08, TIMBER).beam([0.9, 0.5, -0.9], [-0.9, 2.1, -0.9], 0.08, TIMBER);
  k.box(1.9, 0.14, 1.9, TIMBER_D, 0, 3.3, 0);
  k.cyl(1.2, 1.5, TIMBER, 0, 3.44, 0, 1.2, 14);
  for (const y of [3.7, 4.35]) k.cyl(1.24, 0.1, BRASS, 0, y, 0, 1.24, 14);
  k.cone(1.42, 0.85, BRICK, 0, 4.94, 0, 14).cone(1.0, 0.36, SNOW, 0, 5.3, 0, 14);
  k.ball(0.12, BRASS, 0, 5.82, 0, 8);
  k.lying('x', 0.1, 1.2, IRON, 1.6, 3.8, 0, 6).cyl(0.11, 0.7, IRON, 2.15, 3.1, 0, 0.11, 6);
  return k.geometry();
}

/** A heap of warm coal with brass glints and a snow cap. */
function coalHeapGeo(): THREE.BufferGeometry {
  const k = new Kit();
  k.cone(1.25, 1.0, COAL, 0, 0, 0, 8).cone(0.8, 0.75, mixHex(COAL, BRICK, 0.15), 0.95, 0, 0.3, 7).cone(0.6, 0.55, COAL, -0.85, 0, 0.45, 7);
  for (const [x, y, z] of [[0.35, 0.55, 0.55], [-0.4, 0.4, 0.7], [0.9, 0.35, 0.75], [-0.1, 0.7, 0.3]] as const) k.lump(0.13, COAL_L, x, y, z, 1, 0.8, 1);
  for (const [x, y, z] of [[0.2, 0.6, 0.62], [-0.55, 0.32, 0.8]] as const) k.lump(0.06, BRASS_L, x, y, z);
  k.cone(0.48, 0.3, SNOW, 0, 0.78, 0, 8).cone(0.28, 0.16, SNOW, 0.95, 0.62, 0.3, 7);
  k.box(0.9, 0.08, 0.7, TIMBER, 1.25, 0, -0.85).box(0.12, 0.6, 0.08, TIMBER_D, 1.0, 0, -0.95);
  return k.geometry();
}

/** A scrap pile: rusty plates, a gear and a brass pipe, snow on top (the era's second resource). */
function scrapGeo(): THREE.BufferGeometry {
  const k = new Kit();
  k.put(geo.box(1.4, 0.12, 1.0), BRICK_D, 0, 0.3, 0, { rx: 0.25, ry: 0.3 });
  k.put(geo.box(1.1, 0.1, 0.8), IRON_L, 0.3, 0.5, 0.1, { rz: 0.35, ry: -0.4 });
  k.put(geo.cylinder(0.5, 0.5, 0.14, 10), BRASS, -0.35, 0.62, 0.15, { rx: 1.1, rz: 0.2 });
  k.put(geo.cylinder(0.18, 0.18, 0.16, 8), IRON, -0.35, 0.65, 0.22, { rx: 1.1, rz: 0.2 });
  k.lying('x', 0.12, 1.3, BRASS_L, 0.1, 0.18, 0.5, 8);
  k.lump(0.35, IRON, 0.4, 0.2, -0.3, 1.2, 0.6, 1);
  k.lump(0.4, SNOW, 0.05, 0.75, 0.05, 1.3, 0.3, 1.1);
  return k.geometry();
}

/** A run of cast-iron steam pipe on brick footings with brass flanges and a valve wheel. */
function steamPipeGeo(): THREE.BufferGeometry {
  const k = new Kit();
  for (const x of [-1.5, 0, 1.5]) k.box(0.3, 0.7, 0.45, BRICK, x, 0, 0).cap(0.3, 0.45, x, 0.7, 0);
  k.lying('x', 0.24, 4.2, IRON, 0, 0.95, 0, 10);
  for (const x of [-1.5, 0, 1.5]) k.lying('x', 0.29, 0.14, BRASS, x, 0.95, 0, 10);
  k.cyl(0.2, 1.3, IRON, 2.0, 0.95, 0, 0.2, 10).cyl(0.27, 0.12, BRASS, 2.0, 1.7, 0, 0.27, 10);
  k.cyl(0.1, 0.4, IRON, -0.6, 1.15, 0, 0.1, 6);
  k.put(geo.torus(0.22, 0.04, 5, 14), BRASS_L, -0.6, 1.6, 0, { rx: Math.PI / 2 });
  k.cap(4.0, 0.36, 0, 1.18, 0);
  return k.geometry();
}

/** The little tank engine (faces +X), its firebox glowing. */
function engine(k: Kit, g: Kit, x: number, z: number): void {
  const y = 0.62;
  for (const dx of [-1.0, 0, 1.0]) for (const s of [-1, 1]) k.lying('z', 0.36, 0.12, IRON, x + dx, 0.5, z + s * 0.6, 12).lying('z', 0.12, 0.14, BRASS, x + dx, 0.5, z + s * 0.62, 8);
  k.box(3.3, 0.24, 1.3, IRON, x, 0.38, z);
  k.box(0.22, 0.32, 1.5, BRICK, x + 1.75, 0.3, z).box(0.22, 0.32, 1.5, BRICK, x - 1.75, 0.3, z);
  // boiler, smokebox, brass bands, chimney and dome
  k.lying('x', 0.58, 2.1, BRICK, x + 0.35, y + 0.68, z, 16);
  for (const dx of [-0.35, 0.35, 1.0]) k.lying('x', 0.6, 0.08, BRASS, x + dx, y + 0.68, z, 16);
  k.lying('x', 0.6, 0.35, IRON, x + 1.55, y + 0.68, z, 16).lying('x', 0.24, 0.05, BRASS_L, x + 1.74, y + 0.72, z, 12);
  k.cyl(0.2, 0.75, IRON, x + 1.3, y + 1.15, z, 0.16, 10).cyl(0.27, 0.12, BRASS, x + 1.3, y + 1.88, z, 0.22, 10).cyl(0.2, 0.06, SNOW, x + 1.3, y + 2.0, z, 0.2, 10);
  k.ball(0.26, BRASS, x + 0.45, y + 1.28, z, 10, 0.8);
  // side tanks, cab and its roof
  for (const s of [-1, 1]) k.box(1.3, 0.62, 0.32, BRICK_D, x + 0.35, y + 0.3, z + s * 0.62);
  k.box(1.05, 1.5, 1.4, BRICK, x - 1.1, y + 0.1, z);
  k.box(1.25, 0.12, 1.6, IRON, x - 1.1, y + 1.62, z).cap(1.2, 1.5, x - 1.1, y + 1.74, z);
  k.box(0.5, 0.45, 0.06, BRASS_L, x - 1.05, y + 1.0, z + 0.71);
  g.box(0.42, 0.36, 0.05, LAMP, x - 1.05, y + 1.0, z + 0.74);
  // the firebox door's glow and the headlamp
  g.box(0.3, 0.22, 0.05, mixHex(LAMP, EMBER, 0.5), x - 0.55, y + 0.42, z + 0.71);
  k.cyl(0.14, 0.2, IRON, x + 1.78, y + 1.1, z, 0.14, 8);
  g.lying('x', 0.1, 0.04, LAMP, x + 1.89, y + 1.1, z, 8);
  // coal in the bunker behind the cab
  k.box(0.6, 0.55, 1.2, BRICK_D, x - 1.9, y + 0.1, z).lump(0.42, COAL, x - 1.9, y + 0.72, z, 1, 0.5, 1.3).lump(0.3, SNOW, x - 1.9, y + 0.86, z, 1, 0.3, 1.2);
}

/** A coal hopper wagon heaped with snowy coal. */
function hopper(k: Kit, x: number, z: number): void {
  for (const dx of [-0.75, 0.75]) for (const s of [-1, 1]) k.lying('z', 0.3, 0.1, IRON, x + dx, 0.42, z + s * 0.58, 10);
  k.box(2.5, 0.18, 1.2, IRON, x, 0.36, z);
  k.box(2.4, 0.95, 1.36, BRICK, x, 0.54, z);
  for (const dx of [-0.8, 0, 0.8]) k.box(0.08, 0.95, 1.42, BRICK_D, x + dx, 0.54, z);
  k.box(2.5, 0.08, 1.46, BRASS, x, 1.46, z);
  k.lump(0.75, COAL, x, 1.5, z, 1.55, 0.42, 0.85).lump(0.3, COAL_L, x + 0.5, 1.6, z + 0.3, 1, 0.6, 1);
  k.lump(0.55, SNOW, x - 0.1, 1.72, z, 1.6, 0.26, 0.9);
}

function siding(k: Kit, f: Kit, g: Kit, l: RegionLayout, kit: GroundKit): void {
  const s = sidingPlace(l);
  const len = s.x1 - s.x0;
  const cx = (s.x0 + s.x1) / 2;
  // ballast, sleepers, rails
  f.tile(len + 0.6, 2.0, mixHex(SLATE, SNOW, 0.35), cx, 0.026, s.z);
  for (let x = s.x0 + 0.3; x < s.x1; x += 0.62) k.box(0.26, 0.1, 1.7, TIMBER_D, x, 0.02, s.z);
  for (const dz of [-0.5, 0.5]) k.box(len, 0.1, 0.09, IRON_L, cx, 0.12, s.z + dz);
  // buffer stop: two red-and-white posts and a sprung beam, snow on top
  for (const dz of [-0.6, 0.6]) k.box(0.22, 0.9, 0.22, IRON, s.x0 + 0.3, 0, s.z + dz);
  k.box(0.3, 0.32, 1.7, BRICK, s.x0 + 0.3, 0.72, s.z).cap(0.3, 1.7, s.x0 + 0.3, 1.04, s.z);
  for (const dz of [-0.4, 0.4]) k.box(0.05, 0.2, 0.22, SNOW, s.x0 + 0.47, 0.78, s.z + dz);
  // 0.9.9: a matching buffer stop at the east end of the siding
  for (const dz of [-0.6, 0.6]) k.box(0.22, 0.9, 0.22, IRON, s.x1 - 0.3, 0, s.z + dz);
  k.box(0.3, 0.32, 1.7, BRICK, s.x1 - 0.3, 0.72, s.z).cap(0.3, 1.7, s.x1 - 0.3, 1.04, s.z);
  for (const dz of [-0.4, 0.4]) k.box(0.05, 0.2, 0.22, SNOW, s.x1 - 0.47, 0.78, s.z + dz);
  engine(k, g, s.engine, s.z);
  for (const x of s.hoppers) hopper(k, x, s.z);
  // the water crane: a brass-banded column with a swinging arm and a leather hose
  const c = s.crane;
  k.cyl(0.3, 0.3, IRON, c.x, 0, c.z, 0.36, 10).cyl(0.16, 2.8, IRON, c.x, 0.3, c.z, 0.18, 10);
  for (const y of [1.2, 2.2]) k.cyl(0.2, 0.08, BRASS, c.x, y, c.z, 0.2, 10);
  k.ball(0.22, BRASS, c.x, 3.2, c.z, 10).cap(0.3, 0.3, c.x, 3.38, c.z);
  k.beam([c.x, 3.0, c.z], [c.x + 1.3, 2.9, c.z + 1.4], 0.14, IRON).beam([c.x + 1.3, 2.9, c.z + 1.4], [c.x + 1.4, 2.0, c.z + 1.5], 0.12, TIMBER_D);
  // signal lamp on a post: a red arm and a warm lantern
  const q = s.signal;
  k.cyl(0.08, 3.0, IRON, q.x, 0, q.z, 0.1, 8).box(0.9, 0.18, 0.06, BRICK, q.x + 0.4, 2.55, q.z + 0.08).box(0.12, 0.18, 0.07, SNOW, q.x + 0.75, 2.55, q.z + 0.09);
  k.box(0.32, 0.36, 0.32, IRON, q.x, 2.9, q.z).cap(0.36, 0.36, q.x, 3.26, q.z);
  g.box(0.24, 0.24, 0.05, LAMP, q.x, 2.96, q.z + 0.17);
  kit.lamps.push({ x: q.x, y: 3.1, z: q.z, size: 1.4, pool: 3.4 });
}

// ---------------------------------------------------------------------------------------------------------------------
// wild
// ---------------------------------------------------------------------------------------------------------------------

function wild(kit: GroundKit, l: RegionLayout, rng: Rng): void {
  const k = new Kit(kit.solid);
  const f = new Kit(kit.floor);
  const g = new Kit(kit.glow);
  const P = plotPlaces(l.n);
  placeLandmark(kit, l, rng, 4, baseKeepOut(l));
  siding(k, f, g, l, kit);

  // the west belt: a water tower every third spot, snowy pines between
  const paths = regionPaths(l);
  const keep = keepOut(l);
  const spots = beltSpots(l, paths, keep, 4.4);
  spots.forEach((s, i) => {
    if (i % 3 === 1) kit.put('waterTower', waterTowerGeo, { x: s.x, z: s.z, ry: rng.range(0, 6.28) });
    else {
      const tall = i % 2 === 1;
      kit.put(tall ? 'pineTall' : 'pine', tall ? pineTallGeo : pineGeo, { x: s.x + rng.range(-0.3, 0.3), z: s.z, ry: rng.range(0, 6.28), sx: rng.range(0.9, 1.1), tint: rng.range(0.92, 1.0) });
    }
  });

  // the harvest zone: coal seams in the snow, coal heaps, scrap piles, a steam main
  const avoid = [nodePatch(l), ...keep, ...paths, ...spots.map((s) => around(s.x, s.z, 1.6)), ...sightKeep(l, 3)];
  const taken: { x: number; z: number; r: number }[] = [];
  for (const p of harvestSpots(l, P, avoid, rng, 1, 2.2, taken)) kit.put('steamPipe', steamPipeGeo, { x: p.x, z: p.z });
  for (const p of harvestSpots(l, P, avoid, rng, 4, 1.4, taken)) kit.put('coalHeap', coalHeapGeo, { x: p.x, z: p.z, ry: rng.range(0, 6.28), sx: rng.range(0.85, 1.1) });
  for (const p of harvestSpots(l, P, avoid, rng, 4, 1.0, taken)) kit.put('scrap', scrapGeo, { x: p.x, z: p.z, ry: rng.range(0, 6.28) });
  const H = l.zones.harvest;
  for (let i = 0; i < 9; i++) {
    const x = rng.range(H.minX + 4, H.maxX - 4);
    const z = rng.range(H.minZ + 2.5, H.maxZ - 3);
    if (avoid.some((q) => x > q.minX - 1.5 && x < q.maxX + 1.5 && z > q.minZ - 0.5 && z < q.maxZ + 0.5)) continue;
    if (x > P.field.minX - 2 && x < P.field.maxX + 2 && z > P.field.minZ - 1 && z < P.field.maxZ + 1) continue;
    const ry = rng.range(-0.25, 0.25);
    const len = rng.range(2.5, 4.5);
    f.tile(len, 0.34, COAL, x, 0.025, z, ry).tile(len * 0.7, 0.14, COAL_L, x + 0.2, 0.027, z + 0.24, ry);
    for (let j = 0; j < 3; j++) f.tile(0.12, 0.12, BRASS_L, x + rng.range(-len / 2, len / 2) * 0.8, 0.029, z + rng.range(-0.1, 0.1), rng.range(0, 3));
  }
  // snow banked on the fences and drifted in the open ground, so the era stays wintry at play zoom
  snowDrifts(f, l, P, snowAvoid(l, P, keep), rng, paths);
}

// ---------------------------------------------------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------------------------------------------------

function open(kit: GroundKit, l: RegionLayout, P: PlotPlaces, rng: Rng): void {
  const f = new Kit(kit.floor);
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  // processing floor: cinder slate slabs in running courses over dark grout, with warm ember specks
  const Y = P.yardPave;
  f.tile(Y.maxX - Y.minX, Y.maxZ - Y.minZ, mixHex(SLATE, COAL, 0.35), (Y.minX + Y.maxX) / 2, 0.026, (Y.minZ + Y.maxZ) / 2);
  const tones = [SLATE, mixHex(SLATE, SNOW, 0.12), mixHex(SLATE, BRICK, 0.12), mixHex(SLATE, IRON_L, 0.3)];
  for (let z = Y.minZ + 0.1; z < Y.maxZ - 0.3; ) {
    const dz = Math.min(rng.range(1.0, 1.4), Y.maxZ - 0.1 - z);
    for (let x = Y.minX + 0.1; x < Y.maxX - 0.3; ) {
      const dx = Math.min(rng.range(1.2, 2.3), Y.maxX - 0.1 - x);
      if (dx > 0.4 && dz > 0.4) f.tile(dx - 0.1, dz - 0.1, rng.pick(tones), x + dx / 2, 0.031, z + dz / 2);
      x += dx;
    }
    z += dz;
  }
  const specks = Math.round(((Y.maxX - Y.minX) * (Y.maxZ - Y.minZ)) / 3.2);
  for (let i = 0; i < specks; i++) f.tile(0.1, 0.1, rng.next() < 0.7 ? EMBER : BRASS_L, rng.range(Y.minX + 0.3, Y.maxX - 0.3), 0.0335, rng.range(Y.minZ + 0.3, Y.maxZ - 0.3), rng.range(0, 3));
  cellMarks(f, l, P, mixHex(BRASS, SLATE, 0.7), 0.035, 0.1); // 0.9.12 (T3): ~30% contrast
  // front yard: a cinder apron between red-brick kerbs
  const B = yardBand(l);
  f.tile(B.maxX - B.minX, B.maxZ - B.minZ, mixHex(SLATE, SNOW, 0.22), (B.minX + B.maxX) / 2, 0.022, (B.minZ + B.maxZ) / 2);
  for (let i = 0; i < Math.round(((B.maxX - B.minX) * (B.maxZ - B.minZ)) / 4); i++) f.tile(0.12, 0.12, EMBER, rng.range(B.minX, B.maxX), 0.024, rng.range(B.minZ, B.maxZ), rng.range(0, 3));
  // paths: packed cinder with brick edging
  for (const q of regionPaths(l)) {
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    f.tile(w, d, mixHex(SLATE, COAL, 0.15), (q.minX + q.maxX) / 2, 0.024, (q.minZ + q.maxZ) / 2);
    const alongX = w > d;
    const len = alongX ? w : d;
    for (const s of [-1, 1]) {
      for (let t = 0.35; t < len - 0.2; t += 0.62) {
        const x = alongX ? q.minX + t : (q.minX + q.maxX) / 2 + s * (w / 2 - 0.14);
        const z = alongX ? (q.minZ + q.maxZ) / 2 + s * (d / 2 - 0.14) : q.minZ + t;
        f.tile(alongX ? 0.54 : 0.24, alongX ? 0.24 : 0.54, (Math.round(t / 0.62) % 3 ? BRICK : BRICK_D), x, 0.029, z);
      }
    }
  }
  // gas lamps along the yard path: iron posts, brass collars, a warm lantern; halos at night
  for (const p of pathPoles(l)) {
    k.cyl(0.22, 0.3, IRON, p.x, 0, p.z, 0.28, 8).cyl(0.07, 2.6, IRON, p.x, 0.3, p.z, 0.09, 8);
    k.cyl(0.12, 0.1, BRASS, p.x, 1.4, p.z, 0.12, 8).cyl(0.18, 0.1, BRASS, p.x, 2.85, p.z, 0.12, 8);
    k.box(0.08, 0.5, 0.08, IRON, p.x - 0.2, 2.9, p.z).box(0.08, 0.5, 0.08, IRON, p.x + 0.2, 2.9, p.z);
    g.box(0.34, 0.42, 0.34, LAMP, p.x, 2.94, p.z);
    k.cone(0.34, 0.3, IRON, p.x, 3.38, p.z, 4, Math.PI / 4).cone(0.2, 0.14, SNOW, p.x, 3.5, p.z, 4, Math.PI / 4);
    kit.lamps.push({ x: p.x, y: 3.1, z: p.z });
  }
  // broken snowy verges along the inner paths
  snowVerges(f, l, regionPaths(l), snowAvoid(l, P, keepOut(l)), rng);
}

export const era04: EraGroundModule = {
  wild,
  open,
  keepOut,
  props: { tall: waterTowerGeo, mid: steamPipeGeo, low: coalHeapGeo },
};
