/**
 * [0.9.8 — world 10b] Era 7, the Oil Age: everything here is about CRUDE, drawn as warm honey, never black (R36, R37;
 * DIRECTION: "honey barrels, not black").
 *
 * Wild (from the start, under the snow wash while the plot is for sale):
 * - The landmark: a FLARE STACK in the harvest zone's south-west corner, a cream-and-red banded stack with a ladder
 *   ring and guy wires, its gentle peach flame swaying on top (still with Reduce motion / calmer effects), beside two
 *   round honey storage tanks with snowy domes (the era's crown silhouette: round tanks + flare).
 * - The west belt: honey lattice derricks between snowy pines.
 * - Honey barrel racks, nodding-donkey pumpjack stubs and amber crude seeps in the harvest zone.
 * Open (once bought):
 * - The processing floor in WARM ASPHALT with HONEY LANES (double honey lines along every row, chevrons pointing to
 *   the gate) and cream cell lines; the front yard a forecourt with a honey zebra at the gate; the paths in asphalt
 *   edged honey (palette(7).floor).
 * - Peach forecourt lamps along the yard path (the DIRECTION night light, #ffaa5a) with warm halos at night.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import { plotPlaces, type PlotPlaces, type RegionLayout } from '../../../eras/layout';
import { mixHex, MACHINE_TONES, palette, SNOW } from '../../../render/palette';
import { geo } from '../../../render/materials';
import { glowScale, steadyHighlights } from '../../../fx/comfort';
import { glowMaterial } from '../../../render/paletteMaterials';
import { Rng } from '../common';
import { pineGeo, pineTallGeo } from '../props';
import { nodePatch, regionPaths } from '../frontier';
import type { EraGroundModule, GroundKit } from '../eraGround';
import { around, beltSpots, cellMarks, harvestSpots, Kit, pathPoles, yardBand, type GroundSolid, clip } from './kit4to7';

const T = MACHINE_TONES[7];
const P7 = palette(7);
const HONEY = T.body;
const HONEY_L = T.bodyL;
const HONEY_D = T.bodyD;
const RED = T.accent;
const CREAM = T.cream;
const CONCRETE = T.concrete;
const STEEL = mixHex(T.steel, CREAM, 0.2);
const STEEL_D = T.steel;
const ASPHALT = P7.floor.yard;
const LANE = P7.floor.processing;
const PEACH = P7.light;
/** Crude: deep amber, glossy (never black). */
const CRUDE = mixHex(HONEY_D, RED, 0.3);

/** Where the flare stack and its two tanks stand (pure). */
export function flarePlace(l: RegionLayout): { flare: { x: number; z: number }; tanks: { x: number; z: number; r: number }[] } {
  const H = l.zones.harvest;
  const flare = { x: l.rect.minX + 4.2, z: H.maxZ - 4.4 };
  return { flare, tanks: [{ x: flare.x + 4.6, z: flare.z + 1.2, r: 1.8 }, { x: flare.x + 1.0, z: flare.z - 5.0, r: 1.5 }] };
}

export const FLARE_H = 10.2;

/** Every solid era 7 adds that stands taller than a kerb (tests: nothing hides a pad, counter or the hand node). */
export function era07Solids(l: RegionLayout): GroundSolid[] {
  const p = flarePlace(l);
  return [
    { what: 'flare stack', r: around(p.flare.x, p.flare.z, 1.6), h: FLARE_H + 1.4 },
    ...p.tanks.map((t) => ({ what: 'honey tank', r: around(t.x, t.z, t.r + 0.2), h: 3.6 })),
    ...pathPoles(l).map((q) => ({ what: 'forecourt lamp', r: around(q.x, q.z, 0.3), h: 3.6 })),
  ];
}

function keepOut(l: RegionLayout): Rect[] {
  const p = flarePlace(l);
  return [around(p.flare.x, p.flare.z, 2.6), ...p.tanks.map((t) => around(t.x, t.z, t.r + 1))].map((r) => clip(r, l.rect));
}

// ---------------------------------------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------------------------------------

/** A honey lattice derrick with cream bracing, a red crown block and a snowy top (≈5.6 m). */
function derrickGeo(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(2.4, 0.28, 2.4, CONCRETE, 0, 0, 0).cap(2.4, 2.4, 0, 0.28, 0);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) k.beam([x, 0.3, z], [x * 0.25, 5.0, z * 0.25], 0.14, HONEY);
  for (const y of [1.3, 2.5, 3.7]) {
    const s = 1 - (y / 5.0) * 0.75;
    k.beam([-s, y, -s], [s, y, -s], 0.07, CREAM).beam([-s, y, s], [s, y, s], 0.07, CREAM).beam([-s, y, -s], [-s, y, s], 0.07, CREAM).beam([s, y, -s], [s, y, s], 0.07, CREAM);
    k.beam([-s, y, s], [s * 0.7, y + 1.2, s * 0.7], 0.05, HONEY_L);
  }
  k.box(0.6, 0.45, 0.6, RED, 0, 5.0, 0).cap(0.62, 0.62, 0, 5.45, 0);
  k.cyl(0.07, 4.2, STEEL_D, 0, 0.3, 0, 0.07, 6);
  k.box(1.0, 0.7, 0.8, CREAM, 1.5, 0, 0.6).cap(1.0, 0.8, 1.5, 0.7, 0.6);
  return k.geometry();
}

/** A rack of honey barrels with cream bands and red lids, snow on the top row. */
function barrelsGeo(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(2.0, 0.14, 1.3, mixHex(HONEY_D, CONCRETE, 0.5), 0, 0, 0);
  const barrel = (x: number, y0: number, z: number): void => {
    k.cyl(0.31, 0.86, HONEY, x, y0, z, 0.31, 12);
    for (const y of [0.2, 0.62]) k.cyl(0.325, 0.07, CREAM, x, y0 + y, z, 0.325, 12);
    k.cyl(0.26, 0.04, RED, x, y0 + 0.86, z, 0.26, 12);
  };
  for (const x of [-0.62, 0, 0.62]) for (const z of [-0.32, 0.32]) barrel(x, 0.14, z);
  barrel(-0.31, 1.0, 0);
  barrel(0.31, 1.0, 0);
  k.cap(1.2, 0.55, 0, 1.9, 0);
  return k.geometry();
}

/** A small nodding-donkey pumpjack (static): honey beam, red horsehead, cream frame. */
function pumpjackGeo(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(3.0, 0.22, 1.2, CONCRETE, 0, 0, 0).cap(3.0, 1.2, 0, 0.22, 0);
  k.beam([-0.35, 0.22, -0.45], [0, 1.9, 0], 0.12, CREAM).beam([-0.35, 0.22, 0.45], [0, 1.9, 0], 0.12, CREAM).beam([0.5, 0.22, 0], [0, 1.9, 0], 0.12, CREAM);
  k.put(geo.box(2.8, 0.2, 0.22), HONEY, 0.1, 2.0, 0, { rz: 0.12 });
  k.put(geo.box(0.35, 0.8, 0.26), RED, 1.45, 1.86, 0, { rz: 0.12 });
  k.lying('z', 0.45, 0.16, HONEY_D, -1.0, 0.9, 0.22, 12).lying('z', 0.12, 0.2, CREAM, -1.0, 0.9, 0.22, 8);
  k.box(0.6, 0.6, 0.6, HONEY_D, -1.0, 0.22, -0.35);
  k.cyl(0.07, 1.1, STEEL_D, 1.55, 0.22, 0, 0.07, 6).cyl(0.22, 0.3, STEEL, 1.55, 0.22, 0, 0.26, 8);
  k.cap(2.6, 0.22, 0.1, 2.12, 0);
  return k.geometry();
}

function flareStack(k: Kit, g: Kit, x: number, z: number): void {
  k.box(3.0, 0.3, 3.0, CONCRETE, x, 0, z).cap(3.0, 3.0, x, 0.3, z);
  k.cyl(0.62, 0.7, STEEL_D, x, 0.3, z, 0.75, 14);
  // the banded stack
  const bands = 9;
  for (let i = 0; i < bands; i++) {
    const y0 = 1.0 + (i * (FLARE_H - 1.6)) / bands;
    const h = (FLARE_H - 1.6) / bands;
    k.cyl(0.42 - i * 0.012, h, i % 2 ? RED : CREAM, x, y0, z, 0.44 - i * 0.012, 14);
  }
  k.cyl(0.5, 0.35, STEEL, x, FLARE_H - 0.6, z, 0.36, 14).cyl(0.42, 0.12, STEEL_D, x, FLARE_H - 0.25, z, 0.5, 14);
  // a ladder up the camera side and a ring platform two-thirds up
  k.box(0.32, FLARE_H - 2.0, 0.05, STEEL_D, x + 0.36, 1.0, z + 0.36, Math.PI / 4);
  k.ring(0.95, 0.06, STEEL, x, FLARE_H * 0.66, z, 24).cyl(0.95, 0.05, STEEL_D, x, FLARE_H * 0.66 - 0.06, z, 0.95, 20).cyl(0.9, 0.05, SNOW, x, FLARE_H * 0.66, z, 0.9, 20);
  // guy wires to three anchors
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const ax = x + Math.cos(a) * 3.2;
    const az = z + Math.sin(a) * 3.2;
    k.beam([x, FLARE_H * 0.8, z], [ax, 0.3, az], 0.035, STEEL_D);
    k.box(0.4, 0.3, 0.4, CONCRETE, ax, 0, az).cap(0.4, 0.4, ax, 0.3, az);
  }
  // the pilot lights round the tip (glow)
  for (let i = 0; i < 4; i++) g.ball(0.08, PEACH, x + Math.cos(i * 1.57) * 0.45, FLARE_H - 0.1, z + Math.sin(i * 1.57) * 0.45, 6);
}

function tank(k: Kit, x: number, z: number, r: number): void {
  k.cyl(r + 0.25, 0.22, CONCRETE, x, 0, z, r + 0.3, 20);
  k.cyl(r, 2.6, HONEY, x, 0.22, z, r, 20);
  for (const y of [0.9, 1.8]) k.cyl(r + 0.02, 0.1, CREAM, x, 0.22 + y, z, r + 0.02, 20);
  k.cyl(r + 0.04, 0.22, RED, x, 2.72, z, r + 0.04, 20);
  k.put(geo.sphere(r, 20, 8), SNOW, x, 2.94, z, { sy: 0.32 });
  // a spiral-ish stair on the camera side
  for (let i = 0; i < 6; i++) {
    const a = 0.3 + i * 0.22;
    k.box(0.5, 0.06, 0.3, STEEL, x + Math.cos(a) * (r + 0.2), 0.4 + i * 0.42, z + Math.sin(a) * (r + 0.2), -a);
  }
  k.box(0.6, 0.45, 0.06, CREAM, x + 0.1, 1.4, z + r + 0.03);
}

/** The flame: two nested soft cones that sway (one mesh, onBeforeRender; still with Reduce motion / calmer effects). */
function flame(x: number, z: number): THREE.Mesh {
  const k = new Kit();
  k.cone(0.5, 1.4, mixHex(PEACH, HONEY_L, 0.3), 0, 0, 0, 10).cone(0.3, 0.95, mixHex(PEACH, CREAM, 0.55), 0, 0.05, 0, 10);
  k.ball(0.42, PEACH, 0, 0.12, 0, 10, 0.6);
  const mesh = new THREE.Mesh(k.geometry(), glowMaterial(0xffffff, { vertexColors: true, boost: 2.4 }));
  mesh.name = 'era7:flame';
  mesh.position.set(x, FLARE_H - 0.15, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const t0 = performance.now() / 1000;
  mesh.onBeforeRender = (): void => {
    if (steadyHighlights()) {
      mesh.scale.set(1, 1, 1);
      mesh.rotation.set(0, 0, 0);
    } else {
      const t = performance.now() / 1000 - t0;
      // a slow sway and breathe (well under 1 Hz), never a flicker
      const s = 1 + 0.07 * Math.sin(t * 2.1) + 0.04 * Math.sin(t * 3.3 + 1.1);
      mesh.scale.set(1 + 0.04 * Math.sin(t * 1.7), s * (0.85 + 0.15 * glowScale()), 1 + 0.04 * Math.sin(t * 1.9 + 0.6));
      mesh.rotation.set(0.05 * Math.sin(t * 1.3), 0, 0.07 * Math.sin(t * 1.1 + 0.4));
    }
    mesh.updateMatrixWorld();
  };
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------------
// wild
// ---------------------------------------------------------------------------------------------------------------------

function wild(kit: GroundKit, l: RegionLayout, rng: Rng): void {
  const k = new Kit(kit.solid);
  const f = new Kit(kit.floor);
  const g = new Kit(kit.glow);
  const P = plotPlaces(l.n);
  const fp = flarePlace(l);
  f.disc(4.2, mixHex(CONCRETE, SNOW, 0.35), fp.flare.x + 1.6, 0.025, fp.flare.z - 1.2, 1.25, 0.4);
  flareStack(k, g, fp.flare.x, fp.flare.z);
  for (const t of fp.tanks) tank(k, t.x, t.z, t.r);
  kit.extra.push(flame(fp.flare.x, fp.flare.z));
  kit.lamps.push({ x: fp.flare.x, y: FLARE_H + 0.4, z: fp.flare.z, size: 3.2, pool: 6.5 });

  // the west belt: a derrick every third spot, snowy pines between
  const paths = regionPaths(l);
  const keep = keepOut(l);
  const spots = beltSpots(l, paths, keep, 4.4);
  spots.forEach((s, i) => {
    if (i % 3 === 1) kit.put('derrick', derrickGeo, { x: s.x + 0.3, z: s.z });
    else {
      const tall = i % 2 === 1;
      kit.put(tall ? 'pineTall' : 'pine', tall ? pineTallGeo : pineGeo, { x: s.x + rng.range(-0.3, 0.3), z: s.z, ry: rng.range(0, 6.28), sx: rng.range(0.9, 1.1), tint: rng.range(0.92, 1.0) });
    }
  });

  // the harvest zone: barrel racks, pumpjacks, amber crude seeps in the snow
  const avoid = [nodePatch(l), ...keep, ...paths, ...spots.map((s) => around(s.x, s.z, 1.6))];
  const taken: { x: number; z: number; r: number }[] = [];
  for (const p of harvestSpots(l, P, avoid, rng, 2, 1.7, taken)) kit.put('pumpjack', pumpjackGeo, { x: p.x, z: p.z, ry: rng.pick([0, Math.PI]) });
  for (const p of harvestSpots(l, P, avoid, rng, 4, 1.2, taken)) kit.put('barrels', barrelsGeo, { x: p.x, z: p.z, ry: rng.range(-0.4, 0.4) });
  for (const p of harvestSpots(l, P, avoid, rng, 8, 0.9, taken)) {
    const ry = rng.range(0, 3);
    f.disc(rng.range(0.7, 1.1), mixHex(CRUDE, SNOW, 0.45), p.x, 0.025, p.z, rng.range(0.55, 0.8), ry);
    f.disc(rng.range(0.4, 0.6), CRUDE, p.x + 0.1, 0.027, p.z, rng.range(0.55, 0.8), ry);
    f.disc(0.12, HONEY_L, p.x - 0.1, 0.029, p.z - 0.08, 0.6, ry);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------------------------------------------------

function open(kit: GroundKit, l: RegionLayout, P: PlotPlaces, rng: Rng): void {
  const f = new Kit(kit.floor);
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  // processing floor: warm asphalt patches, honey lanes along every row with chevrons toward the gate, cream cells
  const Y = P.yardPave;
  f.tile(Y.maxX - Y.minX, Y.maxZ - Y.minZ, ASPHALT, (Y.minX + Y.maxX) / 2, 0.026, (Y.minZ + Y.maxZ) / 2);
  for (let i = 0; i < Math.round(((Y.maxX - Y.minX) * (Y.maxZ - Y.minZ)) / 22); i++) {
    f.tile(rng.range(1.5, 3.5), rng.range(1.0, 2.4), mixHex(ASPHALT, rng.next() < 0.5 ? CONCRETE : HONEY_D, rng.range(0.06, 0.14)), rng.range(Y.minX + 2, Y.maxX - 2), 0.029, rng.range(Y.minZ + 1.5, Y.maxZ - 1.5), rng.range(-0.1, 0.1));
  }
  for (let z = Y.minZ + 0.5; z <= Y.maxZ + 0.01; z += l.rowPitch) {
    const zz = Math.min(z, Y.maxZ - 0.4);
    for (const dz of [-0.16, 0.16]) f.tile(Y.maxX - Y.minX - 0.6, 0.12, LANE, (Y.minX + Y.maxX) / 2, 0.034, zz + dz);
  }
  // chevrons down the middle of each cell column, pointing toward the gate
  const toGate = -l.inward;
  for (let x = Y.minX + l.cell / 2; x < Y.maxX; x += l.cell) {
    for (let z = Y.minZ + 2.5; z < Y.maxZ - 2; z += 3.2) {
      for (const s of [-1, 1]) f.tile(0.8, 0.14, mixHex(LANE, CREAM, 0.25), x + s * 0.26, 0.034, z, s * toGate * 0.7);
    }
  }
  cellMarks(f, l, P, mixHex(CREAM, ASPHALT, 0.2), 0.0335, 0.08);
  // front yard: a forecourt of lighter asphalt, a honey zebra at the gate, honey edge lines
  const B = yardBand(l);
  f.tile(B.maxX - B.minX, B.maxZ - B.minZ, mixHex(ASPHALT, CONCRETE, 0.28), (B.minX + B.maxX) / 2, 0.022, (B.minZ + B.maxZ) / 2);
  for (let i = -3; i <= 3; i++) f.tile(0.45, B.maxZ - B.minZ - 0.6, i % 2 ? CREAM : LANE, l.gate.x + i * 0.62, 0.025, (B.minZ + B.maxZ) / 2);
  for (const z of [B.minZ + 0.25, B.maxZ - 0.25]) f.tile(B.maxX - B.minX - 0.4, 0.12, LANE, (B.minX + B.maxX) / 2, 0.025, z);
  // paths: asphalt walkways edged honey
  for (const q of regionPaths(l)) {
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    f.tile(w, d, mixHex(ASPHALT, CONCRETE, 0.18), (q.minX + q.maxX) / 2, 0.024, (q.minZ + q.maxZ) / 2);
    const alongX = w > d;
    for (const s of [-1, 1]) {
      if (alongX) f.tile(w, 0.12, LANE, (q.minX + q.maxX) / 2, 0.028, (q.minZ + q.maxZ) / 2 + s * (d / 2 - 0.12));
      else f.tile(0.12, d, LANE, (q.minX + q.maxX) / 2 + s * (w / 2 - 0.12), 0.028, (q.minZ + q.maxZ) / 2);
    }
  }
  // forecourt lamps: cream posts with a red cap and a peach globe; halos at night
  for (const p of pathPoles(l)) {
    k.cyl(0.2, 0.3, CONCRETE, p.x, 0, p.z, 0.25, 10);
    k.cyl(0.07, 2.9, CREAM, p.x, 0.3, p.z, 0.09, 8);
    k.cyl(0.11, 0.1, RED, p.x, 1.2, p.z, 0.11, 8);
    g.ball(0.26, PEACH, p.x, 3.42, p.z, 12);
    k.cyl(0.3, 0.12, RED, p.x, 3.66, p.z, 0.18, 12).cyl(0.22, 0.05, SNOW, p.x, 3.78, p.z, 0.22, 10);
    kit.lamps.push({ x: p.x, y: 3.4, z: p.z });
  }
}

export const era07: EraGroundModule = {
  wild,
  open,
  keepOut,
  props: { tall: derrickGeo, mid: pumpjackGeo, low: barrelsGeo },
};
