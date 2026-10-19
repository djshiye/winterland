/**
 * [0.9.8 — 10a] Era 2 Frontier: stone and clay (granite + clay, audit-1.0/era-resources-v2.md).
 *
 * The board is clay-dusted earth under soft snow patches. The yard band is laid with irregular fieldstones, the
 * processing floor with cut granite slabs, cell by cell, so the machine cells read without painted lines. Stepping
 * stones on a clay bed join the zones. A birch grove stands outside the west fence and in the harvest zone's west end,
 * with snow-capped boulders, granite block stacks and clay jars among them; drifts lie along the fences. At night squat
 * stone lanterns glow hearth amber along the paths and at the gate.
 */
import * as THREE from 'three';
import { Batch } from '../../../render/batch';
import { geo } from '../../../render/materials';
import { mixHex, palette, PINE, SNOW } from '../../../render/palette';
import { plotPlaces, type RegionLayout } from '../../../eras/layout';
import type { Rect } from '../../../config';
import { blockedNewLand, occludesNewLand, type Rng } from '../common';
import type { EraGroundModule, GroundKit } from '../eraGround';
import { regionPaths, nodePatch } from '../frontier';
import { landmarkRect, placeLandmark } from './landmarks2to5';
import { placeWarmSpot, warmSpotRect } from './warmSpots';
import { cellSlabs, clearOf, fenceDrifts, fieldstones, lantern, near, shade, snowPatch, steppingPath } from './kit1to3';

const P2 = palette(2);
/** Era 2's tones, all from its palette row. */
const C = {
  stone: P2.floor.yard,
  mortar: P2.floor.processing,
  granite: mixHex(P2.body, 0xffffff, 0.28),
  clay: P2.accent,
  clayBed: mixHex(shade(P2.floor.board, 0.86), P2.accent, 0.14),
  bark: mixHex(SNOW, P2.floor.board, 0.25),
  barkMark: P2.trim,
  leaf: mixHex(PINE, P2.light, 0.3),
  leafLight: mixHex(PINE, P2.light, 0.45),
  light: P2.light,
};

const BOX = (): THREE.BufferGeometry => geo.box(1, 1, 1);

let birch: THREE.BufferGeometry | null = null;
/** A snow-dusted birch (≈ 4.4 m): cream trunk with dark marks, two round sage crowns with snow on top. */
function birchGeo(): THREE.BufferGeometry {
  if (!birch) {
    const b = new Batch();
    b.add(geo.cylinder(0.12, 0.17, 2.6, 7), C.bark, 0, 1.3, 0);
    for (const [y, a] of [[0.6, 0], [1.1, 2.1], [1.55, 4.0], [2.0, 1.0]] as const) b.add(BOX(), C.barkMark, Math.cos(a) * 0.14, y, Math.sin(a) * 0.14, { sx: 0.12, sy: 0.05, sz: 0.12, ry: a });
    b.add(geo.cylinder(0.05, 0.07, 0.9, 5), C.bark, 0.35, 2.3, 0, { rz: -0.6 });
    b.add(geo.icosahedron(1, 1), C.leaf, 0, 2.95, 0, { sx: 1.05, sy: 0.95, sz: 1.05 });
    b.add(geo.icosahedron(1, 1), C.leafLight, 0.45, 3.65, 0.1, { sx: 0.75, sy: 0.7, sz: 0.75 });
    b.add(geo.icosahedron(1, 1), SNOW, 0.05, 3.55, 0, { sx: 0.82, sy: 0.32, sz: 0.82 });
    b.add(geo.icosahedron(1, 1), SNOW, 0.48, 4.1, 0.1, { sx: 0.55, sy: 0.24, sz: 0.55 });
    birch = b.geometry();
  }
  return birch;
}

let boulder: THREE.BufferGeometry | null = null;
/** A rounded granite boulder with a fat snow cap (≈ 0.9 m). */
function boulderGeo(): THREE.BufferGeometry {
  if (!boulder) {
    const b = new Batch();
    b.add(geo.dodecahedron(0.75, 1), C.granite, 0, 0.38, 0, { sx: 1.1, sy: 0.72, sz: 0.95 });
    b.add(geo.dodecahedron(0.42, 1), shade(C.granite, 0.88), 0.72, 0.2, 0.3, { sy: 0.75 });
    b.add(geo.dodecahedron(0.62, 1), SNOW, 0, 0.66, 0, { sx: 1.15, sy: 0.32, sz: 1.0 });
    boulder = b.geometry();
  }
  return boulder;
}

let blocks: THREE.BufferGeometry | null = null;
/** A stack of cut granite blocks, snow on each top (≈ 1.3 m). */
function blocksGeo(): THREE.BufferGeometry {
  if (!blocks) {
    const b = new Batch();
    const g = C.granite;
    b.add(BOX(), g, -0.5, 0.3, 0, { sx: 0.95, sy: 0.6, sz: 0.85 });
    b.add(BOX(), shade(g, 0.94), 0.5, 0.3, 0.05, { sx: 0.95, sy: 0.6, sz: 0.85 });
    b.add(BOX(), shade(g, 1.04), 0, 0.9, 0, { sx: 1.0, sy: 0.6, sz: 0.8, ry: 0.12 });
    b.add(BOX(), SNOW, 0, 1.24, 0, { sx: 0.96, sy: 0.08, sz: 0.76, ry: 0.12 });
    for (const x of [-0.5, 0.5]) b.add(BOX(), SNOW, x * 1.55, 0.64, 0.05, { sx: 0.36, sy: 0.07, sz: 0.8 });
    blocks = b.geometry();
  }
  return blocks;
}

let jars: THREE.BufferGeometry | null = null;
/** Three fired clay jars with snowy lids (≈ 0.9 m). */
function jarsGeo(): THREE.BufferGeometry {
  if (!jars) {
    const b = new Batch();
    for (const [x, z, s] of [[0, 0, 1], [0.6, 0.25, 0.8], [-0.45, 0.45, 0.7]] as const) {
      b.add(geo.sphere(0.42, 12, 8), shade(C.clay, 1 - (1 - s) * 0.4), x, 0.42 * s, z, { sx: s, sy: s * 1.05, sz: s });
      b.add(geo.cylinder(0.2, 0.24, 0.16, 10), shade(C.clay, 0.82), x, 0.82 * s, z, { sx: s, sz: s });
      b.add(geo.cylinder(0.22, 0.22, 0.05, 10), SNOW, x, 0.92 * s, z, { sx: s, sz: s });
    }
    jars = b.geometry();
  }
  return jars;
}

/** Free for a dressing piece of radius r: inside `inside`, off the paths, the node patch, the field and `extra`. */
function freeIn(l: RegionLayout, inside: Rect, x: number, z: number, r: number, h: number, extra: readonly Rect[] = []): boolean {
  if (!(x > inside.minX + r && x < inside.maxX - r && z > inside.minZ + r && z < inside.maxZ - r)) return false;
  if (!clearOf(nodePatch(l), x, z, r, h)) return false;
  if (near(plotPlaces(l.n).field, x, z, r + 0.4)) return false;
  if (regionPaths(l).some((q) => near(q, x, z, r + 0.3))) return false;
  return !extra.some((q) => near(q, x, z, r));
}

export const era02: EraGroundModule = {
  keepOut: (l) => [...landmarkRect(l, 2), ...warmSpotRect(l, 2)],
  wild(k: GroundKit, l: RegionLayout, rng: Rng): void {
    const r = l.rect;
    const H = l.zones.harvest;
    // ---- birch belt outside the west fence (hides nothing: the camera looks toward −X / −Z)
    for (let z = r.minZ + 3; z < r.maxZ - 1; z += rng.range(2.6, 3.6)) {
      for (const dx of [1.7, 3.6]) {
        const x = r.minX - dx + rng.range(-0.3, 0.3);
        if (blockedNewLand(x, z, 0.8) || occludesNewLand(x, z, 4.4)) continue;
        if (dx > 2 && rng.next() < 0.45) continue;
        const s = rng.range(0.85, 1.15);
        k.put('birch', birchGeo, { x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.92, 1.1), tint: rng.range(0.94, 1.03) });
      }
    }
    // ---- a grove in the harvest zone's west end, with boulders, granite stacks and clay jars
    const grove: Rect = { minX: H.minX + 0.8, maxX: nodePatch(l).minX - 1, minZ: H.minZ + 4, maxZ: H.maxZ - 1 };
    const placed: { x: number; z: number; r: number }[] = [];
    // the signature landmark (a kiln row) first; nothing else lands on it
    placeLandmark(k, l, rng, 2);
    placeWarmSpot(k, l, rng, 2);
    const lm = [...landmarkRect(l, 2), ...warmSpotRect(l, 2)];
    const take = (x: number, z: number, rad: number, h = 1.4): boolean => {
      if (!freeIn(l, H, x, z, rad, h, lm)) return false;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + rad)) return false;
      placed.push({ x, z, r: rad });
      return true;
    };
    for (let z = grove.minZ + 1; z < grove.maxZ; z += 3.4) {
      for (let x = grove.minX + 1; x < grove.maxX; x += 3.6) {
        const px = x + rng.range(-0.9, 0.9);
        const pz = z + rng.range(-0.9, 0.9);
        if (!take(px, pz, 1.1, 4.6)) continue;
        const s = rng.range(0.8, 1.05);
        k.put('birch', birchGeo, { x: px, z: pz, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.9, 1.08), tint: rng.range(0.94, 1.03) });
      }
    }
    const scatter = (kind: string, geom: () => THREE.BufferGeometry, n: number, rad: number, area: Rect): void => {
      for (let t = 0, got = 0; t < 120 && got < n; t++) {
        const x = rng.range(area.minX, area.maxX);
        const z = rng.range(area.minZ, area.maxZ);
        const s = rng.range(0.8, 1.2);
        if (!take(x, z, rad * s)) continue;
        k.put(kind, geom, { x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.85, 1.1), sz: s * rng.range(0.9, 1.1), tint: rng.range(0.94, 1.04) });
        got++;
      }
    };
    scatter('boulder', boulderGeo, 7, 0.9, H);
    scatter('blocks', blocksGeo, 2, 1.1, { ...H, minZ: H.minZ + 2 });
    scatter('jars', jarsGeo, 2, 0.8, { ...H, minZ: H.maxZ - 5 });
    // a few boulders and drifts along the far fence (low: nothing behind them is hidden)
    for (let x = r.minX + 3; x < r.maxX - 2; x += rng.range(6, 10)) {
      const z = r.maxZ - 1.1;
      if (!near(l.zones.huts, x, z, 0) && rng.next() < 0.7) {
        const s = rng.range(0.6, 0.9);
        if (take(x, z, 0.8 * s)) k.put('boulder', boulderGeo, { x, z, ry: rng.range(0, 6.28), sx: s, sy: s, sz: s });
      }
    }
    const gates: Rect[] = [
      { minX: l.gate.x - 3, maxX: l.gate.x + 3, minZ: l.gate.z - 2, maxZ: l.gate.z + 2 },
      { minX: l.marketGate.x - 2.5, maxX: l.marketGate.x + 2.5, minZ: l.marketGate.z - 2, maxZ: l.marketGate.z + 2 },
    ];
    const keep = [...gates, nodePatch(l), ...regionPaths(l)];
    fenceDrifts(k, { x: r.minX + 0.9, z: H.minZ }, { x: r.minX + 0.9, z: r.maxZ - 0.9 }, rng, keep);
    fenceDrifts(k, { x: r.minX + 0.9, z: r.maxZ - 0.9 }, { x: r.maxX - 0.9, z: r.maxZ - 0.9 }, rng, keep);
    fenceDrifts(k, { x: r.maxX - 0.9, z: l.zones.huts.minZ }, { x: r.maxX - 0.9, z: r.maxZ - 0.9 }, rng, keep);
    // ---- snow lying on the clay board: patches in the wild ground
    for (let t = 0, got = 0; t < 200 && got < 22; t++) {
      const x = rng.range(r.minX + 1.5, r.maxX - 1.5);
      const z = rng.range(H.minZ + 1, r.maxZ - 1.5);
      if (near(plotPlaces(l.n).field, x, z, 1)) continue;
      snowPatch(k, x, z, rng.range(0.7, 1.6), rng, P2.floor.board);
      got++;
    }
  },

  open(k: GroundKit, l: RegionLayout, P, rng: Rng): void {
    const Z = l.zones;
    // ---- the yard band: fieldstones (the gate, the depot and the dock all stand on them)
    fieldstones(k, { minX: Z.yard.minX + 0.5, maxX: Z.yard.maxX - 0.2, minZ: Z.yard.minZ + 0.5, maxZ: Z.yard.maxZ }, { mortar: C.mortar, stones: [C.stone, shade(C.stone, 1.08), mixHex(C.stone, C.clay, 0.18)] }, rng);
    // ---- the processing floor: granite slabs cell by cell
    cellSlabs(k, l, P.yardPave, { mortar: C.mortar, slab: mixHex(C.granite, C.stone, 0.4), joint: shade(C.mortar, 0.86) }, rng);
    // ---- stepping-stone paths on a clay bed (the yard-edge path already runs over the fieldstones)
    const paths = regionPaths(l);
    for (const q of paths.slice(1)) steppingPath(k, q, { bed: C.clayBed, stone: mixHex(C.granite, 0xffffff, 0.15) }, rng);
    // the customers' walk in from the market gate
    const mg = l.marketGate;
    steppingPath(k, { minX: mg.x - 0.8, maxX: mg.x + 0.8, minZ: Math.min(mg.z, mg.z + l.inward * 6), maxZ: Math.max(mg.z, mg.z + l.inward * 6) }, { bed: C.clayBed, stone: mixHex(C.granite, 0xffffff, 0.15) }, rng);
    // ---- stone lanterns: either side of the gate, along the harvest path, by the market walk
    const lc = { body: mixHex(C.granite, C.mortar, 0.3), dark: P2.trim, light: C.light };
    lantern(k, l.gate.x - 2.6, l.gate.z + l.inward * 0.9, 'stone', lc);
    lantern(k, l.gate.x + 2.6, l.gate.z + l.inward * 0.9, 'stone', lc);
    const hp = paths[2]!;
    const lz = l.inward > 0 ? hp.maxZ + 0.6 : hp.minZ - 0.6;
    for (let x = hp.minX + 3; x < hp.maxX - 2; x += 9) if (!near(nodePatch(l), x, lz, 0.6)) lantern(k, x, lz, 'stone', lc);
    const vp = paths[1]!;
    for (let z = Math.min(vp.minZ, vp.maxZ) + 6; z < Math.max(vp.minZ, vp.maxZ) - 3; z += 10) lantern(k, vp.maxX + 0.6, z, 'stone', lc);
  },
};
