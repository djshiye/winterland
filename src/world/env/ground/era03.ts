/**
 * [0.9.8 — 10a] Era 3 Iron Age: ore (iron ore + charcoal, audit-1.0/era-resources-v2.md).
 *
 * The board is rust-tinted earth under snow. The yard band is rust-ore gravel glinting with ore; the processing floor
 * is tamped ochre clay framed cell by cell with timber sleepers, like a mine yard. A mine-cart track runs along the
 * path between the machines and the harvest field, with a cart parked at its end. A belt of dark firs stands outside
 * the west fence; ore mounds, charcoal clamps and stacks of pit props dress the wild ground, drifts lie along the
 * fences. At night iron cage lanterns glow forge orange.
 */
import * as THREE from 'three';
import { Batch } from '../../../render/batch';
import { geo } from '../../../render/materials';
import { GOLD, mixHex, palette, PINE, SNOW } from '../../../render/palette';
import { plotPlaces, type RegionLayout } from '../../../eras/layout';
import type { Rect } from '../../../config';
import { blockedNewLand, occludesNewLand, type Rng } from '../common';
import type { EraGroundModule, GroundKit } from '../eraGround';
import { nodePatch, regionPaths } from '../frontier';
import { landmarkRect, placeLandmark } from './landmarks2to5';
import { placeWarmSpot, warmSpotRect } from './warmSpots';
import { clearOf, fenceDrifts, lantern, near, shade, slab, snowPatch, snowVerge } from './kit1to3';

const P3 = palette(3);
/** Era 3's tones, all from its palette row (warm: never near-black, DIRECTION). */
const C = {
  gravel: P3.floor.yard,
  clay: mixHex(P3.floor.processing, P3.floor.board, 0.35),
  ore: P3.body,
  oreGlint: mixHex(P3.body, GOLD, 0.45),
  iron: mixHex(P3.accent, 0xffffff, 0.12),
  ironDark: mixHex(P3.trim, P3.body, 0.25),
  timber: mixHex(P3.fence, P3.body, 0.45),
  timberLight: mixHex(P3.fence, P3.floor.processing, 0.55),
  charcoal: mixHex(P3.trim, P3.body, 0.4),
  fir: mixHex(PINE, P3.accent, 0.2),
  firLight: mixHex(PINE, P3.floor.processing, 0.18),
  light: P3.light,
};

const BOX = (): THREE.BufferGeometry => geo.box(1, 1, 1);

let fir: THREE.BufferGeometry | null = null;
/** A slim dark fir (≈ 4.8 m) with three rounded tiers and thick snow on each. */
function firGeo(): THREE.BufferGeometry {
  if (!fir) {
    const b = new Batch();
    b.add(geo.cylinder(0.14, 0.2, 1.0, 6), C.timber, 0, 0.5, 0);
    for (const [r, h, y, col] of [[1.15, 1.7, 0.6, C.fir], [0.9, 1.55, 1.75, C.firLight], [0.62, 1.4, 2.85, C.fir]] as const) {
      b.add(geo.cone(r, h, 8), col, 0, y + h / 2, 0);
      b.add(geo.cone(r * 0.62, h * 0.4, 8), SNOW, 0, y + h * 0.82, 0);
    }
    b.add(geo.sphere(0.16, 8, 6), SNOW, 0, 4.3, 0);
    fir = b.geometry();
  }
  return fir;
}

let mound: THREE.BufferGeometry | null = null;
/** An ore mound: rust lumps heaped round, a few glinting, snow on the crown (≈ 1.1 m). */
function oreMoundGeo(): THREE.BufferGeometry {
  if (!mound) {
    const b = new Batch();
    b.add(geo.sphere(1.1, 12, 7), shade(C.ore, 0.92), 0, 0, 0, { sy: 0.85 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const rr = i % 3 === 0 ? 0.55 : 0.85;
      b.add(geo.dodecahedron(0.28, 0), i % 4 === 0 ? C.oreGlint : shade(C.ore, 0.9 + (i % 3) * 0.08), Math.cos(a) * rr, 0.35 + (i % 2) * 0.25, Math.sin(a) * rr, { ry: a });
    }
    b.add(geo.sphere(0.62, 10, 6), SNOW, 0, 0.82, 0, { sy: 0.35 });
    mound = b.geometry();
  }
  return mound;
}

let clamp: THREE.BufferGeometry | null = null;
/** A charcoal clamp: a turf-brown dome with a vent and a ring of logs, snow on the shoulders (≈ 1.2 m). */
function clampGeo(): THREE.BufferGeometry {
  if (!clamp) {
    const b = new Batch();
    b.add(geo.sphere(1.05, 14, 8), C.charcoal, 0, 0, 0, { sy: 1.0 });
    b.add(geo.cylinder(0.16, 0.2, 0.3, 8), shade(C.charcoal, 0.8), 0, 1.08, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.add(geo.cylinder(0.09, 0.09, 0.9, 6), C.timber, Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0, { rx: Math.PI / 2, ry: -a });
    }
    b.add(geo.torus(0.62, 0.16, 6, 16), SNOW, 0, 0.82, 0, { rx: Math.PI / 2 });
    clamp = b.geometry();
  }
  return clamp;
}

let props: THREE.BufferGeometry | null = null;
/** A stack of pit props (mine timbers) on two sleepers, snow along the top (≈ 0.9 m). */
function pitPropsGeo(): THREE.BufferGeometry {
  if (!props) {
    const b = new Batch();
    for (const x of [-0.7, 0.7]) b.add(BOX(), C.timber, x, 0.06, 0, { sx: 0.2, sy: 0.12, sz: 1.4 });
    let y = 0.24;
    for (const n of [4, 3, 2]) {
      for (let i = 0; i < n; i++) b.add(geo.cylinder(0.13, 0.13, 2.0, 7), i % 2 ? C.timberLight : C.timber, 0, y, (i - (n - 1) / 2) * 0.27, { rz: Math.PI / 2 });
      y += 0.23;
    }
    b.add(BOX(), SNOW, 0, y - 0.06, 0, { sx: 1.9, sy: 0.08, sz: 0.4 });
    props = b.geometry();
  }
  return props;
}

let cart: THREE.BufferGeometry | null = null;
/** A mine cart heaped with ore (≈ 1.2 m), wheels on rails 0.9 m apart along local X. */
function cartGeo(): THREE.BufferGeometry {
  if (!cart) {
    const b = new Batch();
    b.add(BOX(), C.iron, 0, 0.6, 0, { sx: 1.3, sy: 0.6, sz: 0.95 });
    b.add(BOX(), C.ironDark, 0, 0.93, 0, { sx: 1.4, sy: 0.08, sz: 1.05 });
    for (const x of [-0.42, 0.42]) for (const z of [-0.45, 0.45]) b.add(geo.cylinder(0.2, 0.2, 0.1, 10), C.ironDark, x, 0.22, z, { rx: Math.PI / 2 });
    b.add(geo.sphere(0.6, 10, 6), C.ore, 0, 0.95, 0, { sx: 1.0, sy: 0.45, sz: 0.7 });
    for (const [x, z] of [[-0.3, 0.1], [0.25, -0.15], [0.1, 0.25]] as const) b.add(geo.dodecahedron(0.17, 0), C.oreGlint, x, 1.12, z);
    b.add(geo.sphere(0.36, 8, 5), SNOW, 0.05, 1.22, 0, { sy: 0.3 });
    cart = b.geometry();
  }
  return cart;
}

/** Rust-ore gravel over rect R: the base colour flecked with darker ore, lighter grit and a few glints. */
function oreGravel(k: GroundKit, R: Rect, rng: Rng, density = 1.4): void {
  slab(k.floor, C.gravel, (R.minX + R.maxX) / 2, (R.minZ + R.maxZ) / 2, R.maxX - R.minX, R.maxZ - R.minZ, 0.03, 0.016);
  const n = Math.round((R.maxX - R.minX) * (R.maxZ - R.minZ) * density);
  const tones = [shade(C.gravel, 0.8), shade(C.gravel, 1.18), mixHex(C.gravel, C.clay, 0.5), C.oreGlint];
  for (let i = 0; i < n; i++) {
    const t = rng.next();
    const col = tones[t < 0.4 ? 0 : t < 0.75 ? 1 : t < 0.95 ? 2 : 3]!;
    const r = rng.range(0.07, 0.17);
    k.floor.add(geo.circleGround(1, 6), col, rng.range(R.minX + 0.15, R.maxX - 0.15), 0.034 + (i % 7) * 0.0006, rng.range(R.minZ + 0.15, R.maxZ - 0.15), { sx: r, sz: r * rng.range(0.7, 1.0), ry: rng.range(0, 3) });
  }
}

/** A mine-cart track along rect q (sleepers across, two iron rails), on a gravel bed. */
function cartTrack(k: GroundKit, q: Rect, rng: Rng): void {
  const alongX = q.maxX - q.minX >= q.maxZ - q.minZ;
  const len = alongX ? q.maxX - q.minX : q.maxZ - q.minZ;
  const cx = (q.minX + q.maxX) / 2;
  const cz = (q.minZ + q.maxZ) / 2;
  oreGravel(k, q, rng, 0.9);
  for (let t = 0.4; t < len - 0.2; t += 0.75) {
    const x = alongX ? q.minX + t : cx;
    const z = alongX ? cz : q.minZ + t;
    k.solid.add(BOX(), shade(C.timber, rng.range(0.92, 1.06)), x, 0.05, z, alongX ? { sx: 0.24, sy: 0.06, sz: 1.5 } : { sx: 1.5, sy: 0.06, sz: 0.24 });
  }
  // 0.9.9: a buffer stop at the track's start (west for the era's cart track): two dark posts, a red beam with white stripes, a snow cap
  const bx = alongX ? q.minX + 0.12 : cx;
  const bz = alongX ? cz : q.minZ + 0.12;
  for (const s of [-0.45, 0.45]) k.solid.add(BOX(), C.ironDark, alongX ? bx : cx + s, 0.3, alongX ? cz + s : bz, { sx: 0.16, sy: 0.6, sz: 0.16 });
  k.solid.add(BOX(), 0xd0453a, bx, 0.52, bz, alongX ? { sx: 0.2, sy: 0.24, sz: 1.2 } : { sx: 1.2, sy: 0.24, sz: 0.2 });
  for (const s of [-0.36, 0, 0.36]) k.solid.add(BOX(), 0xffffff, alongX ? bx + 0.11 : cx + s, 0.52, alongX ? cz + s : bz + 0.11, alongX ? { sx: 0.03, sy: 0.2, sz: 0.14 } : { sx: 0.14, sy: 0.2, sz: 0.03 });
  k.solid.add(BOX(), SNOW, bx, 0.68, bz, alongX ? { sx: 0.26, sy: 0.05, sz: 1.3 } : { sx: 1.3, sy: 0.05, sz: 0.26 });
  for (const s of [-0.45, 0.45]) k.solid.add(BOX(), C.iron, alongX ? cx : cx + s, 0.11, alongX ? cz + s : cz, alongX ? { sx: len - 0.3, sy: 0.07, sz: 0.08 } : { sx: 0.08, sy: 0.07, sz: len - 0.3 });
}

function freeIn(l: RegionLayout, inside: Rect, x: number, z: number, r: number, h: number): boolean {
  if (!(x > inside.minX + r && x < inside.maxX - r && z > inside.minZ + r && z < inside.maxZ - r)) return false;
  if (!clearOf(nodePatch(l), x, z, r, h)) return false;
  if (near(plotPlaces(l.n).field, x, z, r + 0.4)) return false;
  return !regionPaths(l).some((q) => near(q, x, z, r + 0.3));
}

export const era03: EraGroundModule = {
  keepOut: (l) => [...landmarkRect(l, 3), ...warmSpotRect(l, 3)],
  wild(k: GroundKit, l: RegionLayout, rng: Rng): void {
    const r = l.rect;
    const H = l.zones.harvest;
    // ---- dark firs outside the west fence
    for (let z = r.minZ + 2.5; z < r.maxZ - 1; z += rng.range(2.4, 3.4)) {
      for (const dx of [1.6, 3.5]) {
        const x = r.minX - dx + rng.range(-0.3, 0.3);
        if (blockedNewLand(x, z, 0.8) || occludesNewLand(x, z, 4.8)) continue;
        if (dx > 2 && rng.next() < 0.4) continue;
        const s = rng.range(0.85, 1.15);
        k.put('fir', firGeo, { x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.9, 1.12), tint: rng.range(0.92, 1.04) });
      }
    }
    // ---- the wild ground: a few firs at the west end, ore mounds, charcoal clamps, pit props
    const placed: { x: number; z: number; r: number }[] = [];
    // the signature landmark (an ore cliff with a mine mouth) first; nothing else lands on it
    placeLandmark(k, l, rng, 3);
    placeWarmSpot(k, l, rng, 3);
    const lm = [...landmarkRect(l, 3), ...warmSpotRect(l, 3)];
    const take = (x: number, z: number, rad: number, h = 1.4): boolean => {
      if (!freeIn(l, H, x, z, rad, h) || lm.some((q) => near(q, x, z, rad + 0.3))) return false;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + rad)) return false;
      placed.push({ x, z, r: rad });
      return true;
    };
    const west: Rect = { minX: H.minX + 1, maxX: nodePatch(l).minX - 1, minZ: H.minZ + 4, maxZ: H.maxZ - 1 };
    for (let z = west.minZ + 1; z < west.maxZ; z += 3.8) {
      for (let x = west.minX + 1; x < west.maxX; x += 4.2) {
        const px = x + rng.range(-1, 1);
        const pz = z + rng.range(-1, 1);
        if (rng.next() < 0.35 || !take(px, pz, 1.2, 4.8)) continue;
        const s = rng.range(0.8, 1.0);
        k.put('fir', firGeo, { x: px, z: pz, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.9, 1.1), tint: rng.range(0.92, 1.04) });
      }
    }
    const scatter = (kind: string, geom: () => THREE.BufferGeometry, n: number, rad: number, area: Rect): void => {
      for (let t = 0, got = 0; t < 150 && got < n; t++) {
        const x = rng.range(area.minX, area.maxX);
        const z = rng.range(area.minZ, area.maxZ);
        const s = rng.range(0.85, 1.2);
        if (!take(x, z, rad * s)) continue;
        k.put(kind, geom, { x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.85, 1.1), sz: s * rng.range(0.9, 1.1), tint: rng.range(0.94, 1.04) });
        got++;
      }
    };
    scatter('oreMound', oreMoundGeo, 6, 1.2, H);
    scatter('clamp', clampGeo, 3, 1.2, { ...H, maxZ: H.maxZ - 3 });
    scatter('pitProps', pitPropsGeo, 3, 1.1, H);
    const gates: Rect[] = [
      { minX: l.gate.x - 3, maxX: l.gate.x + 3, minZ: l.gate.z - 2, maxZ: l.gate.z + 2 },
      { minX: l.marketGate.x - 2.5, maxX: l.marketGate.x + 2.5, minZ: l.marketGate.z - 2, maxZ: l.marketGate.z + 2 },
    ];
    const keep = [...gates, nodePatch(l), ...regionPaths(l)];
    fenceDrifts(k, { x: r.minX + 0.9, z: H.minZ }, { x: r.minX + 0.9, z: r.maxZ - 0.9 }, rng, keep);
    fenceDrifts(k, { x: r.minX + 0.9, z: r.maxZ - 0.9 }, { x: r.maxX - 0.9, z: r.maxZ - 0.9 }, rng, keep);
    fenceDrifts(k, { x: r.maxX - 0.9, z: l.zones.huts.minZ }, { x: r.maxX - 0.9, z: r.maxZ - 0.9 }, rng, keep);
    for (let t = 0, got = 0; t < 200 && got < 20; t++) {
      const x = rng.range(r.minX + 1.5, r.maxX - 1.5);
      const z = rng.range(H.minZ + 1, r.maxZ - 1.5);
      if (near(plotPlaces(l.n).field, x, z, 1)) continue;
      snowPatch(k, x, z, rng.range(0.7, 1.5), rng, P3.floor.board);
      got++;
    }
  },

  open(k: GroundKit, l: RegionLayout, P, rng: Rng): void {
    const Z = l.zones;
    // ---- the yard band: rust-ore gravel
    const band: Rect = { minX: Z.yard.minX + 0.5, maxX: Z.yard.maxX - 0.2, minZ: Z.yard.minZ + 0.5, maxZ: Z.yard.maxZ };
    oreGravel(k, band, rng);
    // snow banked against the fence along the band (gates kept clear), and a few patches out on the gravel
    const fenceZ = l.inward > 0 ? band.minZ + 0.35 : band.maxZ - 0.35;
    const gateGaps = [l.gate, l.marketGate].map((g) => ({ minX: g.x - 2.6, maxX: g.x + 2.6, minZ: g.z - 3, maxZ: g.z + 3 }));
    snowVerge(k, { minX: band.minX, maxX: band.maxX, minZ: fenceZ, maxZ: fenceZ }, rng, C.gravel, gateGaps, 0.0378);
    for (let i = 0, n = Math.round(((band.maxX - band.minX) * (band.maxZ - band.minZ)) / 45); i < n; i++) {
      snowPatch(k, rng.range(band.minX + 1, band.maxX - 1), rng.range(band.minZ + 1.2, band.maxZ - 1), rng.range(0.35, 0.75), rng, C.gravel, 0.0378);
    }
    // ---- the processing floor: tamped ochre clay, each machine cell framed by timber sleepers
    const Y = P.yardPave;
    slab(k.floor, C.clay, (Y.minX + Y.maxX) / 2, (Y.minZ + Y.maxZ) / 2, Y.maxX - Y.minX, Y.maxZ - Y.minZ, 0.03, 0.016);
    for (let i = 0; i < Math.round((Y.maxX - Y.minX) * (Y.maxZ - Y.minZ) * 0.35); i++) {
      const r = rng.range(0.1, 0.3);
      k.floor.add(geo.circleGround(1, 7), shade(C.clay, rng.next() < 0.5 ? 0.9 : 1.08), rng.range(Y.minX + 0.3, Y.maxX - 0.3), 0.034, rng.range(Y.minZ + 0.3, Y.maxZ - 0.3), { sx: r, sz: r * 0.8, ry: rng.range(0, 3) });
    }
    const z0 = Y.minZ + 0.5;
    for (let x = Y.minX; x <= Y.maxX + 0.01; x += l.cell) slab(k.floor, C.timber, Math.min(x, Y.maxX - 0.15), (Y.minZ + Y.maxZ) / 2, 0.3, Y.maxZ - Y.minZ - 0.2, 0.039, 0.006);
    for (let z = z0; z <= Y.maxZ + 0.01; z += l.rowPitch) slab(k.floor, C.timber, (Y.minX + Y.maxX) / 2, Math.min(z, Y.maxZ - 0.15), Y.maxX - Y.minX - 0.2, 0.3, 0.039, 0.006);
    // ---- snow banked into the sleeper crossings, a few drifted pockets on the clay (flat, under every pad)
    for (let x = Y.minX + l.cell; x < Y.maxX - 0.5; x += l.cell) {
      for (let z = z0 + l.rowPitch; z < Y.maxZ - 0.5; z += l.rowPitch) {
        if (rng.next() < 0.35) continue;
        snowPatch(k, x + rng.range(-0.15, 0.15), z + rng.range(-0.15, 0.15), rng.range(0.35, 0.6), rng, C.clay, 0.0378);
      }
    }
    for (let i = 0, n = Math.round(((Y.maxX - Y.minX) * (Y.maxZ - Y.minZ)) / 60); i < n; i++) {
      snowPatch(k, rng.range(Y.minX + 0.8, Y.maxX - 0.8), rng.range(Y.minZ + 0.8, Y.maxZ - 0.8), rng.range(0.3, 0.55), rng, C.clay, 0.0365);
    }
    // ---- the cart track between the machines and the field, a cart parked at its west end
    const paths = regionPaths(l);
    const track = paths[2]!;
    cartTrack(k, track, rng);
    const cz = (track.minZ + track.maxZ) / 2;
    k.put('cart', cartGeo, { x: track.minX + 1.4, z: cz });
    // the other paths: gravel with timber edging; the customers' walk in from the market gate
    const mg = l.marketGate;
    for (const q of [paths[1]!, { minX: mg.x - 0.8, maxX: mg.x + 0.8, minZ: Math.min(mg.z, mg.z + l.inward * 6), maxZ: Math.max(mg.z, mg.z + l.inward * 6) }]) {
      oreGravel(k, q, rng, 0.8);
      const alongX = q.maxX - q.minX >= q.maxZ - q.minZ;
      for (const s of [0, 1]) {
        const x = alongX ? (q.minX + q.maxX) / 2 : s ? q.maxX - 0.08 : q.minX + 0.08;
        const z = alongX ? (s ? q.maxZ - 0.08 : q.minZ + 0.08) : (q.minZ + q.maxZ) / 2;
        k.solid.add(BOX(), C.timber, x, 0.06, z, alongX ? { sx: q.maxX - q.minX, sy: 0.1, sz: 0.14 } : { sx: 0.14, sy: 0.1, sz: q.maxZ - q.minZ });
      }
    }
    // ---- snow verges: banked along the track, the gravel paths and the processing floor's edges
    const verged = [track, paths[1]!, { minX: mg.x - 0.8, maxX: mg.x + 0.8, minZ: Math.min(mg.z, mg.z + l.inward * 6), maxZ: Math.max(mg.z, mg.z + l.inward * 6) }];
    const noVerge = [...paths, Y, nodePatch(l), plotPlaces(l.n).field];
    for (const q of verged) snowVerge(k, q, rng, P3.floor.board, noVerge.filter((s) => s !== q));
    snowVerge(k, Y, rng, P3.floor.board, paths);
    // ---- forge-orange iron lanterns: at the gate, along the track, by the market walk
    const lc = { body: C.timber, dark: C.ironDark, light: C.light };
    lantern(k, l.gate.x - 2.6, l.gate.z + l.inward * 0.9, 'iron', lc);
    lantern(k, l.gate.x + 2.6, l.gate.z + l.inward * 0.9, 'iron', lc);
    const lz = l.inward > 0 ? track.maxZ + 0.6 : track.minZ - 0.6;
    for (let x = track.minX + 5; x < track.maxX - 2; x += 9) if (!near(nodePatch(l), x, lz, 0.6)) lantern(k, x, lz, 'iron', lc);
    const vp = paths[1]!;
    for (let z = Math.min(vp.minZ, vp.maxZ) + 6; z < Math.max(vp.minZ, vp.maxZ) - 3; z += 10) lantern(k, vp.maxX + 0.6, z, 'iron', lc);
  },
};
