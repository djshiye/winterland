/**
 * [0.9.8 — world 10b] Era 5, the Industrial Age: everything here is about IRON PELLETS and COKE (resources v2; R36,
 * R37).
 *
 * Wild (from the start, under the snow wash while the plot is for sale):
 * - The landmark: a COKE OVEN BATTERY along the harvest zone's south fence: a long red-brick bank of ovens whose
 *   doors glow warm through their slits, steel buckstays between them, a charging rail on top with a little brass
 *   larry car, a tall brick chimney at its west end and heaps of fresh coke beside it.
 * - The west belt: steel gantry cranes (the era's crown silhouette) between snowy pines.
 * - Iron-pellet heaps (round blue-grey pellets with rust specks), coke heaps and girder stacks in the harvest zone.
 *   Nothing near-black (the 0.9.0 slag heaps were #3d3f44).
 * Open (once bought):
 * - The front yard in HERRINGBONE BRICK, the processing floor in pellet-grey steel plates with sodium-yellow safety
 *   walkways and cell lines, the paths in pale concrete slabs (palette(5).floor).
 * - Sodium lamps along the yard path (the DIRECTION night light, #ffd166) with warm halos at night.
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
import { around, beltSpots, cellMarks, harvestSpots, Kit, pathPoles, yardBand, type GroundSolid, clip } from './kit4to7';

const T = MACHINE_TONES[5];
const P5 = palette(5);
const BRICK = T.brick;
const BRICK_D = T.brickD;
const BRICK_L = mixHex(T.brick, SNOW, 0.18);
const STEEL = T.bodyL;
const STEEL_D = T.body;
const BRASS = T.brass;
const BRASS_L = T.brassL;
const CONCRETE = T.concrete;
const SODIUM = P5.light;
/** Iron pellets: blue-grey balls with a rust blush; coke: a warm grey-brown sponge. */
const PELLET = mixHex(T.bodyL, SNOW, 0.08);
const PELLET_R = mixHex(T.bodyL, T.brick, 0.35);
const COKE = mixHex(P5.floor.processing, T.body, 0.25);
const COKE_L = mixHex(COKE, T.concrete, 0.35);
const OVEN_GLOW = mixHex(T.glow, T.accent, 0.45);

/** The coke oven battery along the harvest zone's south fence (pure). */
export function batteryPlace(l: RegionLayout): { x0: number; x1: number; z: number; d: number; chimney: { x: number; z: number } } {
  const H = l.zones.harvest;
  const F = plotPlaces(l.n).field;
  const z = H.maxZ - 2.0;
  const x0 = l.rect.minX + 5.4;
  const x1 = Math.min(F.minX - 1.4, x0 + 20);
  return { x0, x1, z, d: 2.2, chimney: { x: l.rect.minX + 2.9, z } };
}

const BANK_H = 2.5;
const CHIMNEY_H = 9.6;

/** Every solid era 5 adds that stands taller than a kerb (tests: nothing hides a pad, counter or the hand node). */
export function era05Solids(l: RegionLayout): GroundSolid[] {
  const b = batteryPlace(l);
  return [
    { what: 'coke oven battery', r: { minX: b.x0, maxX: b.x1, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 }, h: BANK_H + 0.9 },
    { what: 'battery chimney', r: around(b.chimney.x, b.chimney.z, 1.3), h: CHIMNEY_H },
    ...pathPoles(l).map((p) => ({ what: 'sodium lamp', r: around(p.x, p.z, 0.5, 0.3), h: 4.2 })),
  ];
}

function keepOut(l: RegionLayout): Rect[] {
  const b = batteryPlace(l);
  return [{ minX: b.chimney.x - 1.5, maxX: b.x1 + 0.6, minZ: b.z - b.d / 2 - 1.2, maxZ: b.z + b.d / 2 + 1 }].map((r) => clip(r, l.rect));
}

// ---------------------------------------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------------------------------------

/** A steel gantry crane: two A-frame legs, a girder and a brass hook block (≈6 m). */
function gantryGeo(): THREE.BufferGeometry {
  const k = new Kit();
  for (const s of [-1, 1]) {
    k.box(0.5, 0.25, 2.2, CONCRETE, s * 1.6, 0, 0);
    k.beam([s * 1.6, 0.25, -0.9], [s * 1.6, 5.2, 0], 0.18, STEEL_D).beam([s * 1.6, 0.25, 0.9], [s * 1.6, 5.2, 0], 0.18, STEEL_D);
    k.beam([s * 1.6, 1.8, -0.62], [s * 1.6, 1.8, 0.62], 0.08, STEEL);
  }
  k.box(4.2, 0.4, 0.42, BRICK, 0, 5.2, 0).box(4.3, 0.08, 0.5, STEEL, 0, 5.6, 0).cap(4.2, 0.42, 0, 5.68, 0);
  k.box(0.7, 0.45, 0.6, BRASS, 0.5, 4.75, 0);
  k.box(0.03, 1.8, 0.03, STEEL_D, 0.5, 2.95, 0).box(0.32, 0.26, 0.2, BRASS_L, 0.5, 2.7, 0);
  k.put(geo.torus(0.14, 0.04, 5, 12), STEEL_D, 0.5, 2.55, 0, { rx: 0 });
  return k.geometry();
}

/** A heap of iron pellets: a soft cone dotted with round pellets, rust blush, snow on top. */
function pelletHeapGeo(): THREE.BufferGeometry {
  const k = new Kit();
  const rng = new Rng(5151);
  k.cone(1.3, 0.95, mixHex(PELLET, PELLET_R, 0.25), 0, 0, 0, 12);
  for (let i = 0; i < 46; i++) {
    const a = rng.range(0, Math.PI * 2);
    const u = Math.sqrt(rng.next());
    const r = 1.22 * u;
    const y = 0.95 * (1 - u) + 0.03;
    k.ball(0.11, rng.next() < 0.3 ? PELLET_R : PELLET, Math.cos(a) * r, y, Math.sin(a) * r, 6);
  }
  k.cone(0.42, 0.26, SNOW, 0, 0.74, 0, 10);
  return k.geometry();
}

/** A heap of coke: knobbly grey-brown lumps, a few still warm at the core, snow on top. */
function cokeHeapGeo(): THREE.BufferGeometry {
  const k = new Kit();
  const rng = new Rng(5252);
  k.cone(1.15, 0.85, COKE, 0, 0, 0, 9);
  for (let i = 0; i < 16; i++) {
    const a = rng.range(0, Math.PI * 2);
    const u = Math.sqrt(rng.next());
    k.lump(0.17, rng.next() < 0.5 ? COKE_L : COKE, Math.cos(a) * 1.05 * u, 0.85 * (1 - u) + 0.05, Math.sin(a) * 1.05 * u, 1, 0.8, 1, rng.range(0, 3));
  }
  k.cone(0.38, 0.22, SNOW, 0, 0.68, 0, 9);
  return k.geometry();
}

/** A stack of red-primed girders on timber bearers, snow on top. */
function girderGeo(): THREE.BufferGeometry {
  const k = new Kit();
  const wood = mixHex(BRASS, BRICK_D, 0.5);
  for (const x of [-0.9, 0.9]) k.box(0.22, 0.2, 1.4, wood, x, 0, 0);
  for (let i = 0; i < 3; i++) {
    for (const z of [-0.32, 0.32]) {
      k.box(2.8, 0.08, 0.36, i === 2 ? BRICK : STEEL, 0, 0.2 + i * 0.36, z);
      k.box(2.8, 0.2, 0.08, i === 2 ? BRICK_D : STEEL_D, 0, 0.28 + i * 0.36, z);
    }
    if (i < 2) k.box(0.14, 0.08, 1.2, wood, -0.8 + i * 1.6, 0.48 + i * 0.36, 0);
  }
  k.cap(2.7, 0.9, 0, 1.0, 0);
  return k.geometry();
}

function battery(k: Kit, g: Kit, f: Kit, l: RegionLayout, kit: GroundKit): void {
  const b = batteryPlace(l);
  const len = b.x1 - b.x0;
  const cx = (b.x0 + b.x1) / 2;
  const front = b.z + b.d / 2; // the camera side
  f.tile(len + 3.4, b.d + 2.0, mixHex(CONCRETE, SNOW, 0.3), cx - 1.5, 0.026, b.z);
  // the brick bank with a stone plinth and a coping
  k.box(len, 0.3, b.d + 0.2, CONCRETE, cx, 0, b.z);
  k.box(len, BANK_H - 0.3, b.d, BRICK, cx, 0.3, b.z);
  for (let y = 0.7; y < BANK_H - 0.2; y += 0.45) k.box(len + 0.02, 0.05, b.d + 0.02, BRICK_D, cx, y, b.z);
  k.box(len + 0.3, 0.2, b.d + 0.3, BRICK_L, cx, BANK_H, b.z).cap(len + 0.2, b.d + 0.2, cx, BANK_H + 0.2, b.z);
  // oven doors: an iron door, a glowing slit at its top, a brass latch; steel buckstays between
  const ovens = Math.max(4, Math.floor(len / 1.9));
  const pitch = len / ovens;
  for (let i = 0; i < ovens; i++) {
    const x = b.x0 + (i + 0.5) * pitch;
    k.box(pitch * 0.62, 1.75, 0.12, STEEL_D, x, 0.4, front + 0.04);
    k.box(pitch * 0.66, 0.1, 0.16, STEEL, x, 2.15, front + 0.05);
    g.box(pitch * 0.5, 0.16, 0.05, OVEN_GLOW, x, 1.85, front + 0.12);
    g.box(pitch * 0.12, 0.5, 0.05, OVEN_GLOW, x, 0.75, front + 0.12);
    k.box(0.18, 0.1, 0.06, BRASS, x + pitch * 0.2, 1.2, front + 0.13);
    if (i > 0) k.box(0.16, BANK_H + 0.45, 0.2, STEEL, b.x0 + i * pitch, 0, front + 0.1);
  }
  // the charging rail and the larry car on top
  for (const dz of [-0.45, 0.45]) k.box(len, 0.08, 0.08, STEEL, cx, BANK_H + 0.28, b.z + dz);
  const lx = b.x0 + len * 0.62;
  k.box(1.5, 0.22, 1.2, STEEL_D, lx, BANK_H + 0.36, b.z).box(1.3, 0.55, 1.0, BRASS, lx, BANK_H + 0.58, b.z);
  k.cone(0.55, 0.32, BRASS_L, lx, BANK_H + 1.13, b.z, 4, Math.PI / 4).cap(0.9, 0.7, lx, BANK_H + 1.13, b.z);
  // the chimney at the west end: a tall tapered brick shaft with a brass band and a snowy rim
  const c = b.chimney;
  k.box(2.0, 0.6, 2.0, CONCRETE, c.x, 0, c.z).cap(2.0, 2.0, c.x, 0.6, c.z);
  k.cyl(0.62, CHIMNEY_H - 1.0, BRICK, c.x, 0.6, c.z, 0.95, 14);
  for (const y of [3.0, 6.0]) k.cyl(0.84 - y * 0.03, 0.12, BRICK_D, c.x, y, c.z, 0.86 - y * 0.03, 14);
  k.cyl(0.68, 0.36, BRASS, c.x, CHIMNEY_H - 1.6, c.z, 0.7, 14);
  k.cyl(0.78, 0.4, BRICK_L, c.x, CHIMNEY_H - 0.4, c.z, 0.66, 14).cyl(0.66, 0.08, SNOW, c.x, CHIMNEY_H, c.z, 0.66, 14);
  k.box(0.9, 0.9, 1.1, BRICK, c.x + 1.0, 0.6, c.z); // the flue joining the bank
  // coke heaps beside the battery and a quench car of fresh coke
  kit.put('cokeHeap', cokeHeapGeo, { x: b.x1 + 0.2, z: b.z - b.d / 2 - 1.2, ry: 0.4, sx: 0.8 });
  kit.lamps.push({ x: cx, y: 1.6, z: front + 0.6, size: 2.6, pool: 4.5 });
}

// ---------------------------------------------------------------------------------------------------------------------
// wild
// ---------------------------------------------------------------------------------------------------------------------

function wild(kit: GroundKit, l: RegionLayout, rng: Rng): void {
  const k = new Kit(kit.solid);
  const f = new Kit(kit.floor);
  const g = new Kit(kit.glow);
  const P = plotPlaces(l.n);
  battery(k, g, f, l, kit);

  // the west belt: a gantry crane every third spot, snowy pines between
  const paths = regionPaths(l);
  const keep = keepOut(l);
  const spots = beltSpots(l, paths, keep, 4.4);
  spots.forEach((s, i) => {
    if (i % 3 === 1) kit.put('gantry', gantryGeo, { x: s.x + 0.2, z: s.z, ry: Math.PI / 2 });
    else {
      const tall = i % 2 === 1;
      kit.put(tall ? 'pineTall' : 'pine', tall ? pineTallGeo : pineGeo, { x: s.x + rng.range(-0.3, 0.3), z: s.z, ry: rng.range(0, 6.28), sx: rng.range(0.9, 1.1), tint: rng.range(0.92, 1.0) });
    }
  });

  // the harvest zone: pellet heaps, coke heaps, girder stacks, rust-blushed pellet spills in the snow
  const avoid = [nodePatch(l), ...keep, ...paths, ...spots.map((s) => around(s.x, s.z, 1.6))];
  const taken: { x: number; z: number; r: number }[] = [];
  for (const p of harvestSpots(l, P, avoid, rng, 5, 1.4, taken)) {
    kit.put('pelletHeap', pelletHeapGeo, { x: p.x, z: p.z, ry: rng.range(0, 6.28), sx: rng.range(0.85, 1.15) });
    f.disc(1.9, mixHex(PELLET, SNOW, 0.55), p.x, 0.025, p.z, rng.range(0.7, 0.95), rng.range(0, 3));
  }
  for (const p of harvestSpots(l, P, avoid, rng, 3, 1.3, taken)) kit.put('cokeHeap', cokeHeapGeo, { x: p.x, z: p.z, ry: rng.range(0, 6.28) });
  for (const p of harvestSpots(l, P, avoid, rng, 2, 1.6, taken)) kit.put('girders', girderGeo, { x: p.x, z: p.z, ry: rng.pick([0, Math.PI / 2]) + rng.range(-0.1, 0.1) });
}

// ---------------------------------------------------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------------------------------------------------

/** One herringbone course pattern over rect R: bricks w × h set at ±45°, in a few brick tones. */
function herringbone(f: Kit, R: Rect, y: number, rng: Rng): void {
  const tones = [BRICK, mixHex(BRICK, BRICK_D, 0.5), BRICK_L, mixHex(BRICK, BRASS, 0.12)];
  const bw = 0.5;
  const bh = 0.2;
  const step = (bw + 0.05) / Math.SQRT2;
  f.tile(R.maxX - R.minX, R.maxZ - R.minZ, mixHex(BRICK_D, CONCRETE, 0.35), (R.minX + R.maxX) / 2, y - 0.002, (R.minZ + R.maxZ) / 2);
  for (let j = 0, z = R.minZ + 0.25; z < R.maxZ - 0.2; j++, z += step) {
    for (let i = 0, x = R.minX + 0.25 + (j % 2) * step; x < R.maxX - 0.2; i++, x += step * 2) {
      f.tile(bw, bh, rng.pick(tones), x, y, z, Math.PI / 4);
      if (x + step < R.maxX - 0.2) f.tile(bw, bh, rng.pick(tones), x + step, y, z, -Math.PI / 4);
    }
  }
}

function open(kit: GroundKit, l: RegionLayout, P: PlotPlaces, rng: Rng): void {
  const f = new Kit(kit.floor);
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  // front yard: herringbone brick
  herringbone(f, yardBand(l), 0.022, rng);
  // processing floor: pellet-grey steel plates with lighter seams and tread marks, sodium-yellow walkways and cells
  const Y = P.yardPave;
  const plate = P5.floor.processing;
  f.tile(Y.maxX - Y.minX, Y.maxZ - Y.minZ, mixHex(plate, CONCRETE, 0.45), (Y.minX + Y.maxX) / 2, 0.026, (Y.minZ + Y.maxZ) / 2);
  const tones = [plate, mixHex(plate, STEEL, 0.2), mixHex(plate, CONCRETE, 0.15)];
  for (let z = Y.minZ + 0.1; z < Y.maxZ - 0.5; z += 2.4) {
    for (let x = Y.minX + 0.1; x < Y.maxX - 0.5; x += 2.4) {
      const w = Math.min(2.3, Y.maxX - 0.1 - x);
      const d = Math.min(2.3, Y.maxZ - 0.1 - z);
      if (w < 0.5 || d < 0.5) continue;
      f.tile(w, d, rng.pick(tones), x + w / 2, 0.031, z + d / 2);
      for (let t = 0; t < 3; t++) f.tile(0.34, 0.07, mixHex(plate, CONCRETE, 0.35), x + w * (0.3 + 0.2 * t), 0.0335, z + d * 0.35, t % 2 ? 0.6 : -0.6);
    }
  }
  const walk = mixHex(SODIUM, T.accent, 0.25);
  for (let z = Y.minZ + 0.5; z <= Y.maxZ + 0.01; z += l.rowPitch) f.tile(Y.maxX - Y.minX - 0.6, 0.3, walk, (Y.minX + Y.maxX) / 2, 0.035, Math.min(z, Y.maxZ - 0.2));
  cellMarks(f, l, P, mixHex(walk, plate, 0.35), 0.0345, 0.1);
  // paths: pale concrete slabs with a yellow edge line
  for (const q of regionPaths(l)) {
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    const alongX = w > d;
    const len = alongX ? w : d;
    f.tile(w, d, mixHex(CONCRETE, BRICK_D, 0.2), (q.minX + q.maxX) / 2, 0.024, (q.minZ + q.maxZ) / 2);
    for (let t = 0; t < len - 0.3; t += 1.6) {
      const s = Math.min(1.5, len - t - 0.05);
      const x = alongX ? q.minX + t + s / 2 : (q.minX + q.maxX) / 2;
      const z = alongX ? (q.minZ + q.maxZ) / 2 : q.minZ + t + s / 2;
      f.tile(alongX ? s : w - 0.5, alongX ? d - 0.5 : s, mixHex(CONCRETE, SNOW, rng.range(0.05, 0.2)), x, 0.027, z);
    }
    for (const sgn of [-1, 1]) {
      if (alongX) f.tile(w, 0.1, walk, (q.minX + q.maxX) / 2, 0.029, (q.minZ + q.maxZ) / 2 + sgn * (d / 2 - 0.12));
      else f.tile(0.1, d, walk, (q.minX + q.maxX) / 2 + sgn * (w / 2 - 0.12), 0.029, (q.minZ + q.maxZ) / 2);
    }
  }
  // sodium lamps: tall steel posts with a cobra head, glowing sodium yellow; halos at night
  for (const p of pathPoles(l)) {
    k.box(0.5, 0.25, 0.5, CONCRETE, p.x, 0, p.z);
    k.cyl(0.08, 3.9, STEEL_D, p.x, 0.25, p.z, 0.12, 8);
    k.beam([p.x, 4.05, p.z], [p.x, 4.15, p.z + l.inward * -0.5], 0.09, STEEL_D);
    k.box(0.36, 0.16, 0.6, STEEL, p.x, 4.0, p.z - l.inward * 0.55).cap(0.34, 0.56, p.x, 4.16, p.z - l.inward * 0.55);
    g.box(0.28, 0.06, 0.46, SODIUM, p.x, 3.96, p.z - l.inward * 0.55);
    kit.lamps.push({ x: p.x, y: 3.9, z: p.z - l.inward * 0.55 });
  }
}

export const era05: EraGroundModule = {
  wild,
  open,
  keepOut,
  props: { tall: gantryGeo, mid: pelletHeapGeo, low: girderGeo },
};
