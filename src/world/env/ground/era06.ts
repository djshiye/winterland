/**
 * [0.9.8 — world 10b] Era 6, the Electric Age: everything here is about COPPER (R36, R37).
 *
 * Wild (from the start, under the snow wash while the plot is for sale):
 * - The signature landmark (Validator, 0.9.7: era 6 was the plainest plot): the COPPER COIL TOWER in the harvest
 *   zone's south-west corner. A stepped cream plinth, a teal column wound in a copper coil, a stack of ceramic
 *   insulators and a fat copper toroid round a mint orb, with a verdigris-roofed switch house at its foot and a feeder
 *   cable between them.
 * - The west belt: copper-tipped pylons with sagging copper wires running down the fence into the tower, snowy pines
 *   between them.
 * - Copper outcrops, transformers and cable drums dressing the harvest zone (clear of the field and the hand node).
 * Open (once bought):
 * - The processing floor in rounded TEAL COBBLES with copper-inlay cell lines, the front yard in pale teal setts, the
 *   paths in cream setts (palette(6).floor).
 * - Mint bulbs strung on copper wires between poles along the yard path (the DIRECTION night light, #7ce8c8).
 * - The tower wakes up: soft mint ARCS crackle from the toroid now and then. Each fades in and out over half a second
 *   (never a hard flash); they hold still with Reduce motion / calmer effects and vanish with Glow 0.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import { plotPlaces, type PlotPlaces, type RegionLayout } from '../../../eras/layout';
import { mixHex, MACHINE_TONES, palette, SNOW } from '../../../render/palette';
import { additiveKeepAlpha, geo, markGlow } from '../../../render/materials';
import { glowScale, steadyHighlights } from '../../../fx/comfort';
import { Rng } from '../common';
import { pineGeo, pineTallGeo } from '../props';
import { nodePatch, regionPaths } from '../frontier';
import type { EraGroundModule, GroundKit } from '../eraGround';
import { placeWarmSpot, warmSpotRect } from './warmSpots';
import { around, beltSpots, cablePoints, cellMarks, harvestSpots, Kit, pathPoles, yardBand, type GroundSolid, clip, sightKeep, snowAvoid, snowDrifts, snowVerges } from './kit4to7';

const T = MACHINE_TONES[6];
const P6 = palette(6);
// copper, toned for the toon ramp (the raw accent reads as traffic-cone orange): a warm penny, its shine and its shade
const COPPER = mixHex(T.accent, T.crimson, 0.3);
const COPPER_L = mixHex(T.accent, T.cream, 0.28);
const COPPER_D = mixHex(T.accent, T.body, 0.42);
/** Verdigris: copper roofs weather to it. */
const PATINA = mixHex(T.bodyL, T.cream, 0.32);
const CREAM = T.cream;
const CREAM_D = T.creamD;
const TEAL = T.body;
const TEAL_L = T.bodyL;
const MINT = P6.glow;

/** Coil tower height (finial top) and plinth radius, metres. */
export const COIL_TOWER_H = 11.7;
const PLINTH_R = 3.0;

/** Where the coil tower and its switch house stand (pure). */
export function coilTowerPlace(l: RegionLayout): { tower: { x: number; z: number }; house: { x: number; z: number; w: number; d: number } } {
  const H = l.zones.harvest;
  const tower = { x: l.rect.minX + 8, z: H.maxZ - 7 };
  return { tower, house: { x: tower.x - 1.2, z: tower.z - 5.6, w: 2.6, d: 2.2 } };
}

/** Every solid era 6 adds that stands taller than a kerb (tests: nothing hides a pad, counter or the hand node). */
export function era06Solids(l: RegionLayout): GroundSolid[] {
  const { tower, house } = coilTowerPlace(l);
  return [
    { what: 'coil tower', r: around(tower.x, tower.z, PLINTH_R), h: COIL_TOWER_H },
    { what: 'switch house', r: around(house.x, house.z, house.w / 2, house.d / 2), h: 3.4 },
    ...pathPoles(l).map((p) => ({ what: 'bulb pole', r: around(p.x, p.z, 0.35, 0.2), h: 3.3 })),
  ];
}

export function landKeepOut(l: RegionLayout): Rect[] {
  const { tower, house } = coilTowerPlace(l);
  return [around(tower.x, tower.z, PLINTH_R + 1.2), around(house.x, house.z, house.w / 2 + 1, house.d / 2 + 1)].map((r) => clip(r, l.rect));
}

/** The landmark's keep-outs plus the warm-up spot's. */
function keepOut(l: RegionLayout): Rect[] {
  return [...landKeepOut(l), ...warmSpotRect(l, 6, landKeepOut(l))];
}

// ---------------------------------------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------------------------------------

/** Local wire points of the pylon's four insulators (ry = 0). */
const PYLON_TIPS: readonly (readonly [number, number, number])[] = [
  [-1.15, 5.55, 0],
  [1.15, 5.55, 0],
  [-1.6, 4.45, 0],
  [1.6, 4.45, 0],
];

/** A teal lattice pylon with cream insulators capped in copper and a snowy crown (≈6.5 m). */
function pylonGeo(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(2.2, 0.28, 2.2, CREAM_D, 0, 0, 0).cap(2.2, 2.2, 0, 0.28, 0);
  const legs: [number, number][] = [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]];
  for (const [x, z] of legs) k.beam([x, 0.3, z], [x * 0.2, 5.7, z * 0.2], 0.14, TEAL);
  for (const y of [1.4, 2.7, 4.0]) {
    const s = 0.85 * (1 - ((y - 0.3) / 5.4) * 0.8);
    k.beam([-s, y, -s], [s, y, -s], 0.07, TEAL_L).beam([-s, y, s], [s, y, s], 0.07, TEAL_L).beam([-s, y, -s], [-s, y, s], 0.07, TEAL_L).beam([s, y, -s], [s, y, s], 0.07, TEAL_L);
    k.beam([-s, y, s], [s * 0.8, y + 1.3, s * 0.8], 0.05, TEAL_L);
  }
  k.box(2.5, 0.16, 0.18, TEAL, 0, 5.62, 0).box(3.4, 0.16, 0.18, TEAL, 0, 4.52, 0);
  k.cap(2.5, 0.2, 0, 5.78, 0).cap(3.4, 0.2, 0, 4.68, 0);
  k.cone(0.32, 0.7, TEAL, 0, 5.7, 0, 6).ball(0.14, COPPER, 0, 6.45, 0, 8);
  for (const [x, y, z] of PYLON_TIPS) {
    k.cyl(0.08, 0.36, CREAM, x, y - 0.36, z, 0.1, 6);
    k.cyl(0.13, 0.05, CREAM_D, x, y - 0.22, z, 0.13, 8);
    k.ball(0.09, COPPER, x, y + 0.02, z, 6);
  }
  return k.geometry();
}

/** A teal transformer with cream bushings and a copper plate. */
function transformerGeo(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.9, 0.2, 1.5, CREAM_D, 0, 0, 0);
  k.box(1.35, 1.35, 1.05, TEAL, 0, 0.2, 0);
  for (let i = 0; i < 5; i++) k.box(0.09, 1.0, 0.2, TEAL_L, -0.55 + i * 0.275, 0.32, 0.6);
  for (const x of [-0.42, 0, 0.42]) {
    k.cyl(0.08, 0.42, CREAM, x, 1.55, 0, 0.12, 8);
    for (const y of [1.65, 1.8]) k.cyl(0.14, 0.04, CREAM_D, x, y, 0, 0.14, 8);
    k.ball(0.1, COPPER, x, 2.0, 0, 8);
  }
  k.box(0.46, 0.46, 0.05, COPPER_L, 0, 0.62, -0.55);
  k.cap(1.38, 1.08, 0, 1.55, 0);
  return k.geometry();
}

/** A wooden cable drum wound with copper cable. */
function cableDrumGeo(): THREE.BufferGeometry {
  const k = new Kit();
  const wood = mixHex(T.honey, T.creamD, 0.45);
  k.lying('x', 0.72, 0.12, wood, -0.46, 0.74, 0, 14).lying('x', 0.72, 0.12, wood, 0.46, 0.74, 0, 14);
  k.lying('x', 0.55, 0.8, COPPER, 0, 0.74, 0, 14);
  for (const x of [-0.24, 0, 0.24]) k.lying('x', 0.57, 0.06, COPPER_L, x, 0.74, 0, 14);
  k.lying('x', 0.18, 1.06, mixHex(wood, TEAL, 0.3), 0, 0.74, 0, 8);
  k.put(geo.torus(0.6, 0.12, 6, 18), SNOW, 0, 1.33, 0, { ry: Math.PI / 2, sx: 0.55, sy: 0.35 });
  return k.geometry();
}

function tower(k: Kit, g: Kit, x: number, z: number): void {
  // stepped plinth with snow on every step
  k.cyl(PLINTH_R, 0.36, CREAM_D, x, 0, z, PLINTH_R + 0.1, 24).cyl(PLINTH_R + 0.02, 0.06, SNOW, x, 0.36, z, PLINTH_R + 0.02, 24);
  k.cyl(2.45, 0.36, CREAM, x, 0.42, z, 2.5, 24).cyl(2.47, 0.06, SNOW, x, 0.78, z, 2.47, 24);
  k.cyl(1.9, 0.32, TEAL, x, 0.84, z, 1.95, 20).ring(1.92, 0.07, COPPER, x, 1.0, z, 28);
  // four insulator bollards at the plinth's corners
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const bx = x + Math.cos(a) * 2.7;
    const bz = z + Math.sin(a) * 2.7;
    k.cyl(0.16, 0.7, CREAM, bx, 0.36, bz, 0.2, 8);
    for (const y of [0.55, 0.8]) k.cyl(0.24, 0.07, CREAM_D, bx, 0.36 + y, bz, 0.24, 10);
    k.ball(0.17, COPPER, bx, 1.2, bz, 10);
    k.cyl(0.12, 0.05, SNOW, bx, 1.33, bz, 0.12, 8);
  }
  // the column and its copper coil (stacked rings, every other one a little lighter and tipped: reads as a winding)
  k.cyl(0.95, 6.6, TEAL, x, 1.16, z, 1.0, 16);
  k.cyl(1.4, 0.32, CREAM, x, 1.16, z, 1.45, 18);
  for (let i = 0; i < 17; i++) {
    const y = 1.66 + i * 0.33;
    k.put(geo.torus(1.24, 0.14, 6, 22), i % 2 ? COPPER_L : COPPER, x, y, z, { rx: Math.PI / 2 + (i % 2 ? 0.05 : -0.05) });
  }
  k.cyl(1.45, 0.34, CREAM, x, 7.4, z, 1.4, 18).cyl(1.47, 0.06, SNOW, x, 7.74, z, 1.47, 18);
  // ceramic insulator stack
  k.cyl(0.34, 1.7, TEAL, x, 7.8, z, 0.38, 10);
  for (let i = 0; i < 5; i++) k.cyl(0.78 - i * 0.05, 0.14, i % 2 ? CREAM_D : CREAM, x, 7.95 + i * 0.3, z, 0.82 - i * 0.05, 14);
  // the toroid: a fat copper donut round the orb with a shine ring, snow on its crown, a cream finial
  k.ring(1.75, 0.56, COPPER, x, 10.0, z, 28).ring(2.05, 0.16, COPPER_L, x, 10.05, z, 28);
  k.put(geo.torus(1.75, 0.34, 6, 28), SNOW, x, 10.42, z, { rx: Math.PI / 2, sz: 0.45 });
  k.ring(1.75, 0.2, COPPER_L, x, 9.62, z, 28);
  k.cyl(0.14, 0.9, CREAM, x, 10.5, z, 0.2, 8).ball(0.26, COPPER, x, 11.45, z, 12);
  k.cyl(0.18, 0.06, SNOW, x, 11.66, z, 0.18, 8);
  // the orb (glows mint, blooms at night) and little mint eyes round the plinth's teal step
  g.ball(0.78, MINT, x, 10.0, z, 16);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    g.ball(0.08, MINT, x + Math.cos(a) * 1.93, 1.0, z + Math.sin(a) * 1.93, 6);
  }
}

/** The verdigris-roofed switch house and the feeder cable up to the coil's collar. */
function switchHouse(k: Kit, g: Kit, h: { x: number; z: number; w: number; d: number }, tx: number, tz: number): void {
  const { x, z, w, d } = h;
  k.box(w + 0.3, 0.22, d + 0.3, CREAM_D, x, 0, z);
  k.box(w, 1.9, d, CREAM, x, 0.22, z);
  const y = 2.12;
  for (const s of [-1, 1]) {
    k.put(geo.box(w + 0.5, 0.14, d / 2 + 0.45), PATINA, x, y + 0.42, z + (s * (d / 2 + 0.45)) / 2 - s * 0.05, { rx: s * 0.62 });
    k.put(geo.box(w + 0.52, 0.06, d / 2 + 0.2), SNOW, x, y + 0.56, z + (s * (d / 2 + 0.1)) / 2 - s * 0.12, { rx: s * 0.62 });
  }
  k.box(w + 0.5, 0.16, 0.18, COPPER_L, x, y + 0.82, z);
  for (const s of [-1, 1]) k.box(0.1, 0.8, d * 0.8, COPPER_D, x + s * (w / 2 + 0.02), y, z);
  // a mint-lit window and a teal door on the camera sides
  k.box(0.7, 1.4, 0.06, TEAL, x - w * 0.18, 0.22, z + d / 2 + 0.02);
  k.box(0.8, 0.62, 0.06, CREAM_D, x + w * 0.24, 1.0, z + d / 2 + 0.02);
  g.box(0.66, 0.5, 0.05, MINT, x + w * 0.24, 1.06, z + d / 2 + 0.05);
  k.box(0.06, 0.6, 0.6, CREAM_D, x + w / 2 + 0.02, 1.0, z);
  g.box(0.05, 0.48, 0.48, MINT, x + w / 2 + 0.05, 1.06, z);
  k.box(0.5, 0.5, 0.05, COPPER_L, x - w * 0.18, 1.75, z + d / 2 + 0.05);
  k.cyl(0.08, 0.5, CREAM, x + w / 2 - 0.3, y + 0.6, z, 0.1, 8).ball(0.1, COPPER, x + w / 2 - 0.3, y + 1.12, z, 8);
  k.cable([x + w / 2 - 0.3, y + 1.12, z], [tx - 0.6, 7.55, tz - 1.2], 0.6, 0.06, COPPER_D, 8);
}

// ---------------------------------------------------------------------------------------------------------------------
// wild: the tower, the west belt of pylons and pines, the harvest zone's copper dressing
// ---------------------------------------------------------------------------------------------------------------------

function wild(kit: GroundKit, l: RegionLayout, rng: Rng): void {
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  const f = new Kit(kit.floor);
  const P = plotPlaces(l.n);
  const { tower: tp, house } = coilTowerPlace(l);
  tower(k, g, tp.x, tp.z);
  switchHouse(k, g, house, tp.x, tp.z);
  placeWarmSpot(kit, l, rng, 6, landKeepOut(l));

  // the west belt: a pylon every third spot, pines between; copper wires run pylon to pylon and into the tower
  const paths = regionPaths(l);
  const keep = keepOut(l);
  const spots = beltSpots(l, paths, keep, 4.4);
  const pylons: { x: number; z: number }[] = [];
  spots.forEach((s, i) => {
    if (i % 3 === 1) {
      pylons.push(s);
      kit.put('pylon', pylonGeo, { x: s.x, z: s.z });
    } else {
      const tall = i % 2 === 1;
      kit.put(tall ? 'pineTall' : 'pine', tall ? pineTallGeo : pineGeo, { x: s.x + rng.range(-0.3, 0.3), z: s.z, ry: rng.range(0, 6.28), sx: rng.range(0.9, 1.1), tint: rng.range(0.94, 1.03) });
    }
  });
  for (let i = 0; i + 1 < pylons.length; i++) {
    const p = pylons[i]!;
    const q = pylons[i + 1]!;
    for (const [tx, ty, tz] of PYLON_TIPS) k.cable([p.x + tx, ty - 0.02, p.z + tz], [q.x + tx, ty - 0.02, q.z + tz], 0.75, 0.045, COPPER_D, 6);
  }
  const last = pylons[pylons.length - 1];
  if (last) for (const s of [-1, 1]) k.cable([last.x + 1.15 * s, 5.53, last.z], [tp.x - 1.2, 7.6, tp.z + s * 0.9], 0.6, 0.05, COPPER_D, 8);

  // the harvest zone: transformers, cable drums and copper outcrops (clear of the field, the node and the belt)
  const avoid = [nodePatch(l), ...keep, ...paths, ...spots.map((s) => around(s.x, s.z, 1.6)), ...sightKeep(l, 3)];
  const taken: { x: number; z: number; r: number }[] = [];
  for (const p of harvestSpots(l, P, avoid, rng, 3, 1.1, taken)) kit.put('transformer', transformerGeo, { x: p.x, z: p.z, ry: rng.pick([0, Math.PI / 2]) });
  for (const p of harvestSpots(l, P, avoid, rng, 4, 0.9, taken)) kit.put('cableDrum', cableDrumGeo, { x: p.x, z: p.z, ry: rng.range(-0.5, 0.5) });
  const rock = mixHex(T.gravel, T.bodyL, 0.35);
  for (const p of harvestSpots(l, P, avoid, rng, 12, 0.9, taken)) {
    const ry = rng.range(0, 3);
    f.disc(rng.range(0.9, 1.3), mixHex(rock, SNOW, 0.35), p.x, 0.024, p.z, rng.range(0.6, 0.9), ry);
    k.lump(0.5, rock, p.x, 0.12, p.z, 1.3, 0.45, 1.0, ry);
    for (let j = 0; j < 3; j++) k.lump(0.17, j % 2 ? COPPER_L : COPPER, p.x + rng.range(-0.55, 0.55), 0.2, p.z + rng.range(-0.4, 0.4), 1, 0.8, 1, rng.range(0, 3));
    k.lump(0.3, SNOW, p.x - 0.1, 0.3, p.z, 1.2, 0.35, 0.9, ry);
  }
  // snow banked on the fences and drifted in the open ground, so the era stays wintry at play zoom
  snowDrifts(f, l, P, snowAvoid(l, P, keep), rng, paths);
}

// ---------------------------------------------------------------------------------------------------------------------
// open: floors, paths, string lights, the tower's arcs
// ---------------------------------------------------------------------------------------------------------------------

function open(kit: GroundKit, l: RegionLayout, P: PlotPlaces, rng: Rng): void {
  const f = new Kit(kit.floor);
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  // processing floor: rounded teal cobbles in courses (every other one offset) over mint grout, copper-inlay cell lines
  const Y = P.yardPave;
  f.tile(Y.maxX - Y.minX, Y.maxZ - Y.minZ, mixHex(P6.floor.processing, CREAM, 0.2), (Y.minX + Y.maxX) / 2, 0.026, (Y.minZ + Y.maxZ) / 2);
  const tones = [P6.floor.yard, mixHex(P6.floor.yard, P6.floor.processing, 0.18), mixHex(P6.floor.yard, TEAL, 0.22), mixHex(P6.floor.yard, P6.floor.processing, 0.32)];
  const pitch = 0.74;
  for (let j = 0, z = Y.minZ + 0.45; z < Y.maxZ - 0.3; j++, z += pitch) {
    for (let x = Y.minX + 0.45 + (j % 2) * (pitch / 2); x < Y.maxX - 0.3; x += pitch) f.tile(0.62, 0.6, rng.pick(tones), x + rng.range(-0.03, 0.03), 0.031, z + rng.range(-0.03, 0.03), rng.range(-0.06, 0.06));
  }
  cellMarks(f, l, P, COPPER_D, 0.035, 0.12);
  // front yard: big pale teal setts, so the facilities read on them
  const B = yardBand(l);
  const setts = [P6.floor.processing, mixHex(P6.floor.processing, CREAM, 0.25), mixHex(P6.floor.processing, P6.floor.yard, 0.2)];
  for (let j = 0, z = B.minZ + 0.5; z < B.maxZ - 0.3; j++, z += 1.0) {
    for (let x = B.minX + 0.6 + (j % 2) * 0.6; x < B.maxX - 0.5; x += 1.2) f.tile(1.08, 0.88, rng.pick(setts), x, 0.022, z);
  }
  // paths: cream setts with a teal kerb line either side
  for (const q of regionPaths(l)) {
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    f.tile(w, d, mixHex(CREAM_D, P6.floor.processing, 0.25), (q.minX + q.maxX) / 2, 0.024, (q.minZ + q.maxZ) / 2);
    const alongX = w > d;
    for (const s of [-1, 1]) {
      if (alongX) f.tile(w, 0.14, TEAL_L, (q.minX + q.maxX) / 2, 0.028, (q.minZ + q.maxZ) / 2 + s * (d / 2 - 0.07));
      else f.tile(0.14, d, TEAL_L, (q.minX + q.maxX) / 2 + s * (w / 2 - 0.07), 0.028, (q.minZ + q.maxZ) / 2);
    }
  }

  // mint bulbs on copper wires between poles along the yard path
  const poles = pathPoles(l);
  for (const p of poles) {
    k.cyl(0.18, 0.12, CREAM_D, p.x, 0, p.z, 0.22, 8);
    k.cyl(0.07, 3.0, COPPER_D, p.x, 0, p.z, 0.1, 8).box(0.6, 0.08, 0.1, COPPER_D, p.x, 2.9, p.z);
    k.cyl(0.06, 0.22, CREAM, p.x - 0.25, 2.98, p.z, 0.06, 6).cyl(0.06, 0.22, CREAM, p.x + 0.25, 2.98, p.z, 0.06, 6);
    k.cap(0.66, 0.16, p.x, 2.98, p.z);
  }
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i]!;
    const b = poles[i + 1]!;
    if (b.x - a.x > l.cell * 1.5) continue;
    const from: [number, number, number] = [a.x + 0.25, 3.18, a.z];
    const to: [number, number, number] = [b.x - 0.25, 3.18, b.z];
    k.cable(from, to, 0.55, 0.035, COPPER_D, 8);
    for (const q of cablePoints(from, to, 0.55, 9)) g.ball(0.13, MINT, q[0], q[1] - 0.15, q[2], 8);
  }

  // the tower wakes up: its arcs
  const { tower: tp } = coilTowerPlace(l);
  kit.extra.push(arcs(tp.x, tp.z, new Rng(616)));
  // broken snowy verges along the inner paths
  snowVerges(f, l, regionPaths(l), snowAvoid(l, P, keepOut(l)), rng);
}

/** All bolts in one mesh; onBeforeRender picks the drawn one (drawRange) and fades it (comfort-aware). */
function arcs(x: number, z: number, rng: Rng): THREE.Mesh {
  const k = new Kit();
  const ranges: [number, number][] = [];
  const SEG = 5;
  const PER = SEG * 36; // a beam is a non-indexed box: 36 vertices
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const down = i % 3 === 2;
    const r0 = 2.2;
    let p: [number, number, number] = [x + Math.cos(a) * r0, 10.0, z + Math.sin(a) * r0];
    for (let s = 1; s <= SEG; s++) {
      const u = s / SEG;
      const aa = a + rng.range(-0.2, 0.2);
      const rr = r0 + (down ? 0.5 : 1.7) * u;
      const q: [number, number, number] = [x + Math.cos(aa) * rr, down ? 10.0 - u * 2.2 : 10.0 + rng.range(-0.45, 0.45) - u * 0.4, z + Math.sin(aa) * rr];
      k.beam(p, q, 0.07, MINT);
      p = q;
    }
    ranges.push([i * PER, PER]);
  }
  const mat = markGlow(additiveKeepAlpha(new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false })), 1);
  const geom = k.geometry();
  geom.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'era6:arcs';
  mesh.renderOrder = 6;
  const pick = new Rng(6161);
  let cur = -1;
  let t = 0;
  let wait = 1.2;
  let last = -1;
  const FADE = 0.55;
  mesh.onBeforeRender = (): void => {
    const now = performance.now() / 1000;
    const dt = last < 0 ? 0 : Math.min(0.1, now - last);
    last = now;
    if (steadyHighlights() || glowScale() <= 0) {
      cur = -1;
      wait = 0.8;
      geom.setDrawRange(0, 0);
      return;
    }
    if (cur < 0) {
      wait -= dt;
      if (wait > 0) {
        geom.setDrawRange(0, 0);
        return;
      }
      cur = Math.floor(pick.next() * ranges.length);
      t = 0;
    }
    t += dt;
    // a soft triangle: in over FADE/2, out over FADE/2 (one bolt at a time, at most about twice a second)
    const u = Math.min(1, t / FADE);
    mat.opacity = (u < 0.5 ? u * 2 : (1 - u) * 2) * 0.85 * glowScale();
    const [start, count] = ranges[cur]!;
    geom.setDrawRange(start, count);
    if (u >= 1) {
      cur = -1;
      wait = pick.range(1.4, 3.6);
    }
  };
  return mesh;
}

export const era06: EraGroundModule = {
  wild,
  open,
  keepOut,
  props: { tall: pylonGeo, mid: transformerGeo, low: cableDrumGeo },
};
