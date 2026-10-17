/**
 * [0.9.8 — 10c] Era 9 Nuclear: uranium. The base board is mint-glazed concrete: big glossy slabs under the machines
 * with an aqua drain channel that glows at night, white glazed walks with mint kerbs and aqua lamps. The tree belt is
 * rounded mint conifers; the harvest ground holds rounded uranium crystal clusters in glazed dishes (soft lumps, never
 * points), round aqua cooling pools and tidy groups of lead casks with mint bands.
 */
import type { EraGroundModule } from '../eraGround';
import { SNOW, mixHex, palette } from '../../../render/palette';
import { plotPlaces } from '../../../eras/layout';
import { regionPaths } from '../frontier';
import { geo } from '../../../render/materials';
import { aquaPool, beltSpots, cask, cellMarks, crystalCluster, harvestFree, inset, mintGlaze, mintPine, pathLamp, pathLampSpots, slab, FLOOR_Y } from './lateKit';

const N = 9;

export const era09: EraGroundModule = {
  wild(k, l, rng) {
    const P = plotPlaces(N);
    for (const t of beltSpots(l, 4.2, rng)) mintPine(k.solid, t.x, t.z, t.s, rng);
    const H = l.zones.harvest;
    const placed: { x: number; z: number; r: number }[] = [];
    // a line of cooling pools down the middle of the harvest ground
    const midZ = (H.minZ + H.maxZ) / 2;
    for (let x = H.minX + 7; x < H.maxX - 4; x += 9) {
      if (!harvestFree(l, P, x, midZ, 1.9, placed)) continue;
      placed.push({ x, z: midZ, r: 1.9 });
      aquaPool(k.solid, k.glow, x, midZ, 1);
      k.lamps.push({ x, y: 0.4, z: midZ, size: 1.4, pool: 3.4 });
    }
    // crystal clusters on a staggered grid either side
    let row = 0;
    for (let z = H.minZ + 2.6; z < H.maxZ - 2; z += 4.2, row++) {
      for (let x = H.minX + 5 + (row % 2) * 3; x < H.maxX - 2.5; x += 6) {
        if (!harvestFree(l, P, x, z, 1.1, placed)) continue;
        placed.push({ x, z, r: 1.1 });
        crystalCluster(k.solid, k.glow, x, z, rng.range(0.75, 1.0), rng);
      }
    }
    // cask groups of three in the gaps that remain
    for (let t = 0; t < 60 && placed.length < 60; t++) {
      const x = rng.range(H.minX + 4, H.maxX - 2);
      const z = rng.range(H.minZ + 2, H.maxZ - 2);
      if (!harvestFree(l, P, x, z, 1.0, placed)) continue;
      placed.push({ x, z, r: 1.0 });
      cask(k.solid, x, z, 0.9);
      cask(k.solid, x + 0.8, z + 0.2, 0.8);
      cask(k.solid, x + 0.3, z + 0.8, 0.85);
    }
  },

  open(k, l, P, rng) {
    const p = palette(N);
    const Z = l.zones;
    const yard = inset(Z.yard, 0.6);
    if (yard) slab(k.floor, yard, mixHex(p.floor.processing, SNOW, 0.15));
    const proc = inset(Z.processing, 0.6);
    if (proc) mintGlaze(k.floor, k.glow, proc, rng);
    cellMarks(k.floor, l, P, mixHex(p.accent, p.floor.yard, 0.25));
    for (const [q, t] of [[Z.market, 0.4], [Z.huts, 0.5]] as const) {
      const r = inset(q, 0.8);
      if (r) slab(k.floor, r, mixHex(p.floor.board, SNOW, t));
    }
    for (const q of regionPaths(l)) {
      slab(k.floor, q, mixHex(p.floor.processing, SNOW, 0.45), FLOOR_Y + 0.002);
      const alongX = q.maxX - q.minX > q.maxZ - q.minZ;
      for (const s of [-1, 1]) {
        if (alongX) k.floor.add(geo.box(q.maxX - q.minX, 0.004, 0.16), p.accent, (q.minX + q.maxX) / 2, FLOOR_Y + 0.006, s < 0 ? q.minZ + 0.08 : q.maxZ - 0.08);
        else k.floor.add(geo.box(0.16, 0.004, q.maxZ - q.minZ), p.accent, s < 0 ? q.minX + 0.08 : q.maxX - 0.08, FLOOR_Y + 0.006, (q.minZ + q.maxZ) / 2);
      }
    }
    for (const s of pathLampSpots(l, 10)) {
      pathLamp(k.solid, k.glow, N, s.x, s.z);
      k.lamps.push({ x: s.x, y: 1.66, z: s.z });
    }
  },
};
