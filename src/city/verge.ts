/**
 * [city] 0.9.12 (review EM3, "district edges stop in bare snow"): a soft finish just OUTSIDE the curb on every district edge
 * that faces open ground (not a street): a low rounded snowbank strip (0.25-0.4 m high, ~1.2-1.8 m wide) with small snowy
 * firs, round bushes, little clumps and (later eras) low hedges / topiary planted along it at irregular 3-5 m spacing.
 *
 * Pure planner (`districtVerge`, deterministic, no THREE) + one drawing function (`drawVerge`, into one Batch = ONE mesh
 * per district, built by District.ts). The strip lives only in the 0.4..1.9 m band past the district rect, which the
 * player can never walk (the district's walk bounds are its rect), so nothing here needs a collider. It is cut away from
 * every road that reaches the district edge (2.5 m clear on both sides) and never touches a road or another district.
 */
import { DISTRICTS, ROADS, districtDef, type ERect } from '../eras/data';
import { SNOW, SNOW_SHADE, mixHex } from '../render/palette';
import { geo } from '../render/materials';
import type { Batch } from '../render/batch';
import { eraLook } from './decorModels';

export type VergeKind = 'bank' | 'fir' | 'bush' | 'clump' | 'hedge' | 'topiary';

export interface VergePiece {
  kind: VergeKind;
  x: number;
  z: number;
  /** Axis-aligned half extents of the footprint (m). */
  hx: number;
  hz: number;
  /** Height (m) of the piece. */
  h: number;
  /** Variation 0..1 (colour / shape). */
  v: number;
}

/** Band past the curb the verge occupies. */
export const VERGE_NEAR = 0.4;
export const VERGE_FAR = 1.9;
/** Clear distance kept on both sides of a road that reaches the district edge. */
export const VERGE_ROAD_CLEAR = 2.5;

const rects = (): ERect[] => [...ROADS.map((r) => r.rect), ...DISTRICTS.filter((d) => d !== null).map((d) => d!.rect)];
const inRect = (r: ERect, x: number, z: number): boolean => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;

type Side = 'n' | 's' | 'e' | 'w';
/** The sides of district n whose far side is open ground (no street, no district). */
export function outerSides(n: number): Side[] {
  const r = districtDef(n).rect;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const probes: [Side, number, number][] = [
    ['n', cx, r.minZ - 2],
    ['s', cx, r.maxZ + 2],
    ['w', r.minX - 2, cz],
    ['e', r.maxX + 2, cz],
  ];
  const all = rects();
  return probes.filter(([, x, z]) => !all.some((a) => inRect(a, x, z))).map(([s]) => s);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<number, readonly VergePiece[]>();

/** Where district n's outer verge stands (empty when every edge faces a street). */
export function districtVerge(n: number): readonly VergePiece[] {
  const hit = cache.get(n);
  if (hit) return hit;
  const r = districtDef(n).rect;
  const rnd = rng(0x51ed270b ^ (n * 40503));
  const out: VergePiece[] = [];
  const sides = outerSides(n);
  const roads = ROADS.map((x) => x.rect);
  for (const side of sides) {
    const horiz = side === 'n' || side === 's'; // the edge runs along x
    const edge = side === 'n' ? r.minZ : side === 's' ? r.maxZ : side === 'w' ? r.minX : r.maxX;
    const dir = side === 'n' || side === 'w' ? -1 : 1; // outward
    const a0 = horiz ? r.minX : r.minZ;
    const a1 = horiz ? r.maxX : r.maxZ;
    // roads touching this edge's band (the strip's reach, a metre either side) cut it, with 2.5 m clear
    const cuts: [number, number][] = [];
    for (const q of roads) {
      const lo = Math.min(edge, edge + dir * (VERGE_FAR + 1)) - 0.01;
      const hi = Math.max(edge, edge + dir * (VERGE_FAR + 1)) + 0.01;
      const across0 = horiz ? q.minZ : q.minX;
      const across1 = horiz ? q.maxZ : q.maxX;
      if (across1 < lo || across0 > hi) continue;
      const along0 = horiz ? q.minX : q.minZ;
      const along1 = horiz ? q.maxX : q.maxZ;
      if (along1 < a0 - VERGE_ROAD_CLEAR || along0 > a1 + VERGE_ROAD_CLEAR) continue;
      cuts.push([along0 - VERGE_ROAD_CLEAR, along1 + VERGE_ROAD_CLEAR]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    // the north / south strips wrap the corner when the east / west side is open too
    const wrapLo = horiz && sides.includes('w');
    const wrapHi = horiz && sides.includes('e');
    const free: [number, number][] = [];
    let cur = a0 - (wrapLo ? VERGE_FAR : 0);
    const end = a1 + (wrapHi ? VERGE_FAR : 0);
    for (const [c0, c1] of cuts) {
      if (c0 > cur) free.push([cur, Math.min(c0, end)]);
      cur = Math.max(cur, c1);
    }
    if (cur < end) free.push([cur, end]);
    const put = (kind: VergeKind, t: number, d: number, ha: number, hd: number, h: number): void => {
      const o = edge + dir * d;
      out.push({ kind, x: horiz ? t : o, z: horiz ? o : t, hx: horiz ? ha : hd, hz: horiz ? hd : ha, h, v: rnd() });
    };
    for (const [t0, t1] of free) {
      if (t1 - t0 < 2.2) continue;
      // the snowbank: overlapping pillows, tapering to nothing at the ends
      for (let t = t0 + 0.5; t < t1 - 0.4; ) {
        const hd = 0.5 + rnd() * 0.25;
        const d = VERGE_NEAR + hd + rnd() * (VERGE_FAR - VERGE_NEAR - 2 * hd);
        let ha = 0.85 + rnd() * 0.5;
        const taper = Math.min(1, Math.max(0.35, Math.min(t - t0, t1 - t) / 1.4));
        ha = Math.min(ha, t - t0, t1 - t);
        if (ha >= 0.4) put('bank', t, d, ha, hd * (0.6 + 0.4 * taper), (0.3 + rnd() * 0.12) * (0.6 + 0.4 * taper));
        t += 0.9 + rnd() * 0.5;
      }
      // the planting, every 3-5 m (and never in the last metre before a road cut)
      for (let t = t0 + 1.3 + rnd() * 1.4; t < t1 - 1.2; t += 3 + rnd() * 2) {
        const pick = rnd();
        const d = 1.05 + rnd() * 0.25;
        let kind: VergeKind;
        if (n <= 5) kind = pick < 0.55 ? 'fir' : pick < 0.85 ? 'bush' : 'clump';
        else if (n <= 7) kind = pick < 0.4 ? 'fir' : pick < 0.65 ? 'bush' : pick < 0.85 ? 'hedge' : 'clump';
        else kind = pick < 0.15 ? 'fir' : pick < 0.4 ? 'topiary' : pick < 0.65 ? 'bush' : pick < 0.88 ? 'hedge' : 'clump';
        if (kind === 'fir') {
          const h = 1.6 + rnd() * 0.8;
          put(kind, t, d, 0.21 * h + 0.05, 0.21 * h + 0.05, h);
        } else if (kind === 'bush') {
          const rr = 0.4 + rnd() * 0.16;
          put(kind, t, d, rr, rr, rr * 1.5);
        } else if (kind === 'clump') {
          put(kind, t, d, 0.5, 0.4, 0.45);
        } else if (kind === 'hedge') {
          put(kind, t, d - 0.1, 0.85, 0.34, 0.45);
        } else {
          put(kind, t, d, 0.42, 0.42, 1.0);
        }
      }
    }
  }
  cache.set(n, out);
  return out;
}

const SPH = geo.sphere(1, 8, 5);
const SPH_S = geo.sphere(1, 6, 4);
const CONE = geo.cone(1, 1, 7);
const CYL = geo.cylinder(0.75, 1, 1, 6);

/** Draw district n's verge into `b` (one merged mesh). `n` picks the era's colours. */
export function drawVerge(n: number, b: Batch): void {
  const L = eraLook(n);
  const shade = mixHex(SNOW_SHADE, 0x9fb4d0, 0.55);
  const bark = 0x6b4a33;
  for (const p of districtVerge(n)) {
    const k = p.h;
    if (p.kind === 'bank') {
      b.add(SPH, p.v < 0.45 ? shade : SNOW, p.x, 0, p.z, { sx: p.hx, sy: p.h, sz: p.hz, ry: 0 });
    } else if (p.kind === 'fir') {
      const w = p.hx;
      b.add(CYL, bark, p.x, 0.15 + 0.12, p.z, { sx: 0.07, sy: 0.3, sz: 0.07 });
      const leaf = p.v < 0.5 ? L.leaf : L.leaf2;
      const tiers: [number, number, number][] = [
        [w, 0.42 * k, 0.12 + 0.18 * k],
        [w * 0.74, 0.38 * k, 0.12 + 0.42 * k],
        [w * 0.5, 0.34 * k, 0.12 + 0.66 * k],
      ];
      for (const [r, h, y0] of tiers) {
        b.add(CONE, leaf, p.x, y0 + h / 2, p.z, { sx: r, sy: h, sz: r });
        b.add(CONE, SNOW, p.x, y0 + h * 0.62, p.z, { sx: r * 0.72, sy: h * 0.5, sz: r * 0.72 });
      }
    } else if (p.kind === 'bush') {
      const rr = p.hx;
      b.add(SPH, p.v < 0.5 ? L.leaf : L.leaf2, p.x, 0.12 + rr * 0.6, p.z, { sx: rr, sy: rr * 0.8, sz: rr });
      b.add(SPH, SNOW, p.x + 0.03, 0.12 + rr * 1.15, p.z, { sx: rr * 0.78, sy: rr * 0.28, sz: rr * 0.78 });
      if (n >= 3 && p.v > 0.6) for (let i = 0; i < 3; i++) b.add(SPH_S, L.accent, p.x + Math.cos(i * 2.1 + p.v * 5) * rr * 0.8, 0.12 + rr * 0.7, p.z + Math.sin(i * 2.1 + p.v * 5) * rr * 0.8, { sx: 0.04, sy: 0.04, sz: 0.04 });
    } else if (p.kind === 'clump') {
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + p.v * 6;
        const rr = 0.2 + ((i + p.v * 3) % 1) * 0.1;
        const cx = p.x + Math.cos(a) * 0.28;
        const cz = p.z + Math.sin(a) * 0.2;
        b.add(SPH, i === 1 ? L.leaf2 : L.leaf, cx, 0.1 + rr * 0.6, cz, { sx: rr, sy: rr * 0.8, sz: rr });
        b.add(SPH, SNOW, cx, 0.1 + rr * 1.15, cz, { sx: rr * 0.75, sy: rr * 0.26, sz: rr * 0.75 });
      }
    } else if (p.kind === 'hedge') {
      b.add(SPH, L.planter, p.x, 0.1, p.z, { sx: p.hx * 0.95, sy: 0.14, sz: p.hz * 0.95 });
      b.add(SPH, mixHex(L.leaf, L.planter, 0.15), p.x, 0.12 + p.h * 0.45, p.z, { sx: p.hx, sy: p.h * 0.55, sz: p.hz });
      b.add(SPH, SNOW, p.x + 0.05, 0.12 + p.h * 0.95, p.z, { sx: p.hx * 0.8, sy: 0.1, sz: p.hz * 0.75 });
    } else {
      // topiary: a short trunk and a round crown, snow on top
      b.add(CYL, bark, p.x, 0.3, p.z, { sx: 0.07, sy: 0.5, sz: 0.07 });
      b.add(SPH, n === 10 ? L.accent : L.leaf2, p.x, 0.78, p.z, { sx: 0.4, sy: 0.38, sz: 0.4 });
      b.add(SPH, SNOW, p.x + 0.04, 1.08, p.z, { sx: 0.28, sy: 0.1, sz: 0.28 });
    }
  }
}
