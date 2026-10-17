/**
 * [0.9.8 — 10c] Era 10 AI: rare earths and helium-3 fusion. The base board is cream hex panels with gold seams, a
 * sun-gold light set into every seventh panel, gold-edged cream walks and sun-gold lamps. The tree belt is geode trees
 * (gold trunks, round lavender / rose / gold crowns with softly glowing hearts); the harvest ground holds split
 * rare-earth geodes, helium-3 flasks in rows of three and the era's crown at landscape scale, a floating fusion halo.
 * Everything rounded: the 0.9.0 gold spikes and dark server crates are gone (DIRECTION V4).
 */
import type { EraGroundModule } from '../eraGround';
import type { Rect } from '../../../config';
import type { RegionLayout } from '../../../eras/layout';
import { SNOW, mixHex, palette } from '../../../render/palette';
import { plotPlaces } from '../../../eras/layout';
import { regionPaths } from '../frontier';
import { geo } from '../../../render/materials';
import { beltSpots, cellMarks, flask, fusionHalo, geode, geodeTree, harvestFree, hexGold, inset, pathLamp, pathLampSpots, slab, FLOOR_Y } from './lateKit';

const N = 10;

/** Where the fusion halo stands: the middle of the free harvest ground west of the field, south of the hand node. */
function haloSpot(l: RegionLayout): { x: number; z: number } {
  const H = l.zones.harvest;
  const P = plotPlaces(N);
  const x = (l.rect.minX + 4 + Math.min(P.field.minX, l.node.x - 4)) / 2;
  const z = l.inward > 0 ? Math.max(l.node.z + 6, (H.minZ + H.maxZ) / 2 + 2) : Math.min(l.node.z - 6, (H.minZ + H.maxZ) / 2 - 2);
  return { x, z: Math.min(H.maxZ - 3, Math.max(H.minZ + 3, z)) };
}

const haloRect = (l: RegionLayout): Rect => {
  const h = haloSpot(l);
  return { minX: h.x - 2.4, maxX: h.x + 2.4, minZ: h.z - 2.4, maxZ: h.z + 2.4 };
};

export const era10: EraGroundModule = {
  keepOut: (l) => [haloRect(l)],

  wild(k, l, rng) {
    const P = plotPlaces(N);
    for (const t of beltSpots(l, 4.8, rng)) geodeTree(k.solid, k.glow, t.x, t.z, t.s, rng);
    const H = l.zones.harvest;
    const h = haloSpot(l);
    const placed: { x: number; z: number; r: number }[] = [{ x: h.x, z: h.z, r: 3.2 }];
    fusionHalo(k.solid, k.glow, h.x, h.z, 1);
    k.lamps.push({ x: h.x, y: 1.7, z: h.z, size: 2.6, pool: 5.5 });
    // geodes on a staggered grid
    let row = 0;
    for (let z = H.minZ + 2.8; z < H.maxZ - 2; z += 4.6, row++) {
      for (let x = H.minX + 5.5 + (row % 2) * 3.2; x < H.maxX - 2.5; x += 6.4) {
        if (!harvestFree(l, P, x, z, 1.1, placed)) continue;
        placed.push({ x, z, r: 1.1 });
        geode(k.solid, k.glow, x, z, rng.range(0.8, 1.05), rng);
      }
    }
    // helium-3 flasks in rows of three in the gaps
    for (let t = 0; t < 80 && placed.length < 70; t++) {
      const x = rng.range(H.minX + 4, H.maxX - 3);
      const z = rng.range(H.minZ + 2, H.maxZ - 2);
      if (!harvestFree(l, P, x, z, 1.3, placed)) continue;
      placed.push({ x, z, r: 1.3 });
      for (let i = -1; i <= 1; i++) flask(k.solid, k.glow, x + i * 0.85, z, 0.8);
    }
  },

  open(k, l, P, rng) {
    const p = palette(N);
    const Z = l.zones;
    const yard = inset(Z.yard, 0.6);
    if (yard) hexGold(k.floor, null, yard, rng, FLOOR_Y, 1.8);
    const proc = inset(Z.processing, 0.6);
    if (proc) hexGold(k.floor, k.glow, proc, rng);
    cellMarks(k.floor, l, P, mixHex(p.accent, p.floor.yard, 0.2));
    for (const [q, t] of [[Z.market, 0.45], [Z.huts, 0.55]] as const) {
      const r = inset(q, 0.8);
      if (r) slab(k.floor, r, mixHex(p.floor.board, SNOW, t));
    }
    for (const q of regionPaths(l)) {
      slab(k.floor, q, mixHex(p.floor.yard, SNOW, 0.3), FLOOR_Y + 0.002);
      const alongX = q.maxX - q.minX > q.maxZ - q.minZ;
      for (const s of [-1, 1]) {
        if (alongX) k.floor.add(geo.box(q.maxX - q.minX, 0.004, 0.14), p.accent, (q.minX + q.maxX) / 2, FLOOR_Y + 0.006, s < 0 ? q.minZ + 0.07 : q.maxZ - 0.07);
        else k.floor.add(geo.box(0.14, 0.004, q.maxZ - q.minZ), p.accent, s < 0 ? q.minX + 0.07 : q.maxX - 0.07, FLOOR_Y + 0.006, (q.minZ + q.maxZ) / 2);
      }
      // sun-gold studs down the middle of every walk
      if (alongX) for (let x = q.minX + 1.5; x < q.maxX - 1; x += 3) k.glow.add(geo.circleGround(0.12, 8), p.light, x, FLOOR_Y + 0.008, (q.minZ + q.maxZ) / 2);
      else for (let z = q.minZ + 1.5; z < q.maxZ - 1; z += 3) k.glow.add(geo.circleGround(0.12, 8), p.light, (q.minX + q.maxX) / 2, FLOOR_Y + 0.008, z);
    }
    for (const s of pathLampSpots(l, 10)) {
      pathLamp(k.solid, k.glow, N, s.x, s.z);
      k.lamps.push({ x: s.x, y: 1.66, z: s.z });
    }
  },
};
