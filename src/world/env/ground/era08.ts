/**
 * [0.9.8 — 10c] Era 8 Computer: silicon. The base board is a 1980s campus in the snow: beige terrazzo with brass
 * strips under the machines, a sand-pale forecourt by the gate, pale concrete walks with teal edges and screen-mint
 * lamps. The tree belt is a tidy row of sculpted cypresses in cream planters; the harvest ground has neat rows of teal
 * solar panels, silicon boules resting in cradles beside the field and soft sand dunes along its far edge.
 */
import type { EraGroundModule } from '../eraGround';
import { SNOW, mixHex, palette } from '../../../render/palette';
import { plotPlaces } from '../../../eras/layout';
import { regionPaths } from '../frontier';
import { geo } from '../../../render/materials';
import { placeWarmSpot, warmSpotRect } from './warmSpots';
import { yardSignatureRects } from './yardSignature';
import { landmarkDiscs, landmarkRect89, placeLandmark89 } from './landmarks8to9';
import { beltSpots, greenBorder, boule, cellMarks, cypress, dune, harvestFree, inset, pathLamp, pathLampSpots, slab, solarRow, terrazzo, FLOOR_Y, beltSnow, harvestDrifts, snowVerge } from './lateKit';

const N = 8;

export const era08: EraGroundModule = {
  keepOut: (l) => [...landmarkRect89(l, 8), ...warmSpotRect(l, 8), ...yardSignatureRects(l)],
  wild(k, l, rng) {
    const P = plotPlaces(N);
    // 0.9.13: no belt cypress stands on (or crowds) the showroom deck (ground/yardSignature.ts)
    const deck = yardSignatureRects(l);
    const belt = beltSpots(l, 4.6, rng).filter((t) => !deck.some((q) => t.x > q.minX - 1.3 && t.x < q.maxX + 1.3 && t.z > q.minZ - 1.3 && t.z < q.maxZ + 1.3));
    for (const t of belt) cypress(k.solid, t.x, t.z, t.s, rng);
    beltSnow(k.solid, belt, rng);
    const H = l.zones.harvest;
    const placed: { x: number; z: number; r: number }[] = [];
    // the signature landmark (a little lighthouse on a frozen shore) first; nothing else lands on it
    placeLandmark89(k, l, rng, 8);
    placed.push(...landmarkDiscs(l, 8));
    const w8 = placeWarmSpot(k, l, rng, 8);
    if (w8) placed.push({ x: w8.x, z: w8.z, r: 1.9 });
    // solar rows: a tidy array on the harvest ground, rows 3.4 m apart
    for (let z = H.minZ + 3; z < H.maxZ - 2.5; z += 3.2) {
      for (let x = l.rect.minX + 7.8; x < H.maxX - 3; x += 6.6) {
        // a row is 6 m long: both of its ends must be free ground
        if (![-2.6, 0, 2.6].every((dx) => harvestFree(l, P, x + dx, z, 1.2, placed))) continue;
        for (const dx of [-2.6, 0, 2.6]) placed.push({ x: x + dx, z, r: 1.2 });
        solarRow(k.solid, k.glow, x, z, 1);
      }
    }
    // boules in pairs along the field's west edge, dunes along the harvest's far edge
    for (let z = P.field.minZ + 2; z < P.field.maxZ - 1; z += 5.5) {
      const x = P.field.minX - 2.2;
      if (!harvestFree(l, P, x, z, 1.2, placed)) continue;
      placed.push({ x, z, r: 1.2 });
      boule(k.solid, x, z, 0.9, 0.2);
      boule(k.solid, x - 0.9, z + 0.6, 0.75, -0.3);
    }
    const farZ = l.inward > 0 ? H.maxZ - 3.4 : H.minZ + 3.4; // 0.9.12: a dune (r 2) keeps FENCE_CLEAR off the far fence
    for (let x = H.minX + 5; x < H.maxX - 3; x += rng.range(5.5, 7.5)) {
      if (!harvestFree(l, P, x, farZ, 2.0, placed)) continue;
      placed.push({ x, z: farZ, r: 2.0 });
      dune(k.solid, x, farZ, rng.range(0.7, 1.0), rng.range(-0.3, 0.3));
    }
    // snow drifts in the gaps, so the harvest ground stays a snowfield between the props
    harvestDrifts(k.solid, l, P, rng, placed, 12);
  },

  open(k, l, P, rng) {
    const p = palette(N);
    const Z = l.zones;
    // the forecourt by the gate: big pale slabs with joints; the campus terrazzo under the machine grid
    const yard = inset(Z.yard, 0.6);
    if (yard) {
      slab(k.floor, yard, mixHex(p.floor.processing, SNOW, 0.2));
      for (let x = yard.minX + 4; x < yard.maxX; x += 4) k.floor.add(geo.box(0.08, 0.004, yard.maxZ - yard.minZ), mixHex(p.floor.processing, 0x8a7a62, 0.3), x, FLOOR_Y + 0.004, (yard.minZ + yard.maxZ) / 2);
    }
    const proc = inset(Z.processing, 0.6);
    if (proc) terrazzo(k.floor, proc, rng);
    cellMarks(k.floor, l, P, mixHex(mixHex(p.accent, p.floor.yard, 0.35), p.floor.yard, 0.7)); // 0.9.12 (T3): ~30% contrast
    // the market and the huts: a warm snow lawn so the shops and huts sit on their own ground
    for (const [q, t] of [[Z.market, 0.35], [Z.huts, 0.45]] as const) {
      const r = inset(q, 0.8);
      if (r) slab(k.floor, r, mixHex(p.floor.board, SNOW, t));
    }
    // walks: pale concrete with teal kerbs; screen-mint lamps along them
    for (const q of regionPaths(l)) {
      slab(k.floor, q, mixHex(p.city!.trim, p.floor.yard, 0.35), FLOOR_Y + 0.002);
      const alongX = q.maxX - q.minX > q.maxZ - q.minZ;
      for (const s of [-1, 1]) {
        if (alongX) k.floor.add(geo.box(q.maxX - q.minX, 0.004, 0.14), p.accent, (q.minX + q.maxX) / 2, FLOOR_Y + 0.006, s < 0 ? q.minZ + 0.07 : q.maxZ - 0.07);
        else k.floor.add(geo.box(0.14, 0.004, q.maxZ - q.minZ), p.accent, s < 0 ? q.minX + 0.07 : q.maxX - 0.07, FLOOR_Y + 0.006, (q.minZ + q.maxZ) / 2);
      }
    }
    // every floor sits in the snow: white verges with soft drifts heaped along them
    for (const q of [inset(Z.yard, 0.6), inset(Z.processing, 0.6), inset(Z.market, 0.8), inset(Z.huts, 0.8)]) if (q) snowVerge(k.solid, l, q, rng);
    greenBorder(k.solid, k.glow, N, P);
    for (const s of pathLampSpots(l, 10)) {
      pathLamp(k.solid, k.glow, N, s.x, s.z);
      k.lamps.push({ x: s.x, y: 1.66, z: s.z });
    }
  },
};
