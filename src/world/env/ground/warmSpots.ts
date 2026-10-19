/**
 * Warm-up spots (eras 2-10): one low, cozy place to stand beside in each era's region, a little hearth-and-seat
 * diorama about 2.6 m across and never over 1.2 m tall, so it hides nothing and has NO collider (the player steps right
 * onto it; a pal sits there with them, fx/WarmUp.ts):
 *   2 Frontier    a log campfire in a stone ring with two stump stools
 *   3 Iron Age    a little cast-iron pot-belly stove with a stool and a stack of split logs
 *   4 Steam Age   a brass coal brazier and a bench
 *   5 Industrial  a steel drum fire with crate seats
 *   6 Electric    a copper-coil heater glowing orange and a tiny bench
 *   7 Oil         a tundra campfire on furs with a little sled seat
 *   8 Computer    a seaside cocoa cart with a lantern and two stools
 *   9 Nuclear     a warm heat-lamp bench
 *   10 AI         a soft pink-gold glowing hearth stone ring with cushions
 * Solids and the trodden snow disc are one routine per era (a cached merged geometry, drawn into the kit's solid batch so a
 * spot costs no extra draw call); embers and panes go into k.glow and a warm halo into k.lamps. Visual only. The spot follows the landmarks' placement rules (harvest zone, clear of the node patch,
 * the field, the region paths, sight keep, camera shadow) but prefers ground close to the hand node, where the player
 * walks, instead of the back corner.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import { plotPlaces, type RegionLayout } from '../../../eras/layout';
import { Batch } from '../../../render/batch';
import { geo } from '../../../render/materials';
import { CREAM, GOLD, MACHINE_SHADES, mixHex, palette, SNOW } from '../../../render/palette';
import type { Rng } from '../common';
import type { GroundKit } from '../eraGround';
import { nodePatch, regionPaths } from '../frontier';
import { clearOf } from './kit1to3';
import { sightKeep } from './kit4to7';
import { landmarkRect89 } from './landmarks8to9';
import { At, landmarkRect } from './landmarks2to5';

export type WarmEra = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const WARM_ERAS: readonly WarmEra[] = [2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Half the footprint (2.6 m square) and the tallest point. */
export const WARM_HALF = 1.3;
export const WARM_H = 1.2;

// ---- tones (palette rows and a few shared warm mixes)
const S2 = MACHINE_SHADES[2];
const S3 = MACHINE_SHADES[3];
const S4 = MACHINE_SHADES[4];
const S5 = MACHINE_SHADES[5];
const WOOD = S2.timber;
const WOOD_D = S2.timberD;
const WOOD_L = S2.plank;
const FLAME = 0xf2842c;
const FLAME_IN = 0xffc45a;
const EMBER = 0xd9531e;
const GLOW_AMBER = mixHex(0xf2a03a, GOLD, 0.4);
const PINK_GOLD = mixHex(0xf4a8a0, GOLD, 0.45);
const PINK_SOFT = mixHex(0xf4b9b4, CREAM, 0.35);

/** The trodden snow under each: a grey-tinted disc with a lighter packed rim. */
function tread(a: At, n: WarmEra): void {
  const g = palette(n).ground;
  a.add(geo.cylinder(1.24, 1.28, 0.05, 20), mixHex(SNOW, g, 0.18), 0, 0.025, 0);
  a.add(geo.cylinder(1.0, 1.04, 0.05, 18), mixHex(SNOW, g, 0.48), 0, 0.045, 0);
}

function stump(a: At, x: number, z: number, r: number, h: number, c: number = WOOD): void {
  a.add(geo.cylinder(r, r * 1.08, h, 8), c, x, h / 2, z);
  a.add(geo.cylinder(r * 0.9, r * 0.9, 0.03, 8), WOOD_L, x, h + 0.005, z);
}

/** A simple stool: round top on three legs. */
function stool(a: At, x: number, z: number, top: number, c: number, leg: number): void {
  a.add(geo.cylinder(0.27, 0.27, 0.07, 9), c, x, top, z);
  for (let i = 0; i < 3; i++) {
    const t = i * 2.094 + 0.5;
    a.box(leg, x + Math.cos(t) * 0.16, top / 2, z + Math.sin(t) * 0.16, 0.07, top, 0.07);
  }
}

function bench(a: At, x: number, z: number, len: number, seat: number, leg: number, h = 0.4, back = false, ry = 0): void {
  a.box(seat, x, h, z, len, 0.07, 0.38, ry);
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  for (const d of [-0.4, 0.4]) a.box(leg, x + c * d * len, h / 2, z - s * d * len, 0.08, h, 0.32, ry);
  if (back) a.box(seat, x - s * 0.17, h + 0.22, z - c * 0.17, len, 0.3, 0.05, ry);
}

function logRing(a: At, c: number, cl: number, r: number, n: number, y = 0.12): void {
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 + 0.3;
    a.add(geo.dodecahedron(0.16, 0), i % 2 ? c : cl, Math.cos(t) * r, y, Math.sin(t) * r, { sx: 1.1, sy: 0.75, sz: 0.9, ry: t });
  }
}

function crossedLogs(a: At, y = 0.13): void {
  a.box(WOOD_D, 0, y, 0, 0.9, 0.15, 0.15, 0.5);
  a.box(WOOD, 0, y, 0, 0.9, 0.15, 0.15, -0.55);
  a.box(WOOD_D, 0, y + 0.13, 0, 0.7, 0.14, 0.14, 1.6);
}

function flame(g: At, y: number, s = 1): void {
  g.add(geo.cone(0.3 * s, 0.62 * s, 6), FLAME, 0, y + 0.31 * s, 0);
  g.add(geo.cone(0.17 * s, 0.4 * s, 5), FLAME_IN, 0.02, y + 0.2 * s, 0.03);
  for (let i = 0; i < 4; i++) g.box(EMBER, Math.cos(i * 1.7) * 0.3 * s, y + 0.03, Math.sin(i * 1.7) * 0.3 * s, 0.08, 0.05, 0.08);
}

// ---------------------------------------------------------------------------------------------------------------------
// the nine
// ---------------------------------------------------------------------------------------------------------------------

interface Build {
  solid: (a: At) => void;
  glow: (g: At) => void;
  /** Lamp (relative x, y, z, size, pool). */
  lamp: [number, number, number, number, number];
}

const BUILD: Record<WarmEra, Build> = {
  2: {
    solid(a) {
      logRing(a, S2.stone, S2.stoneL, 0.55, 8);
      a.add(geo.cylinder(0.44, 0.44, 0.04, 10), S2.iron, 0, 0.07, 0);
      crossedLogs(a);
      stump(a, -0.95, 0.55, 0.28, 0.42);
      stump(a, 0.85, 0.75, 0.25, 0.36, WOOD_D);
      a.snow(-0.95, 0.46, 0.55, 0.26, 0.26, 0.05);
    },
    glow: (g) => flame(g, 0.2),
    lamp: [0, 0.55, 0, 2.2, 4.4],
  },
  3: {
    solid(a) {
      a.box(S3.ironD, 0, 0.09, 0, 0.78, 0.14, 0.78);
      a.add(geo.cylinder(0.3, 0.34, 0.5, 9), S3.iron, 0, 0.42, 0);
      a.add(geo.sphere(1, 12, 8), S3.iron, 0, 0.62, 0, { sx: 0.4, sy: 0.3, sz: 0.4 });
      a.add(geo.cylinder(0.34, 0.3, 0.06, 9), S3.ironL, 0, 0.7, 0);
      a.add(geo.cylinder(0.075, 0.075, 0.42, 7), S3.ironL, -0.05, 0.94, -0.05);
      a.add(geo.cylinder(0.11, 0.09, 0.07, 7), S3.ironD, -0.05, 1.16, -0.05);
      a.box(S3.ironL, 0, 0.34, 0.34, 0.36, 0.3, 0.05);
      for (const x of [-0.28, 0.28]) a.box(S3.ironD, x, 0.04, 0.32, 0.1, 0.08, 0.1);
      stool(a, 0.95, 0.55, 0.4, WOOD_L, WOOD_D);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3 - r; c++) a.add(geo.cylinder(0.1, 0.1, 0.5, 6), r ? WOOD : WOOD_D, -1.0 + (c + r * 0.5) * 0.23, 0.1 + r * 0.17, -0.6, { rz: Math.PI / 2 });
      a.snow(-0.9, 0.38, -0.6, 0.38, 0.2, 0.05);
    },
    glow(g) {
      g.box(FLAME, 0, 0.34, 0.375, 0.24, 0.18, 0.03);
      g.box(FLAME_IN, 0, 0.32, 0.385, 0.12, 0.08, 0.02);
    },
    lamp: [0, 0.4, 0.5, 1.7, 3.6],
  },
  4: {
    solid(a) {
      for (const t of [0.4, 2.5, 4.6]) a.box(S4.ironD, Math.cos(t) * 0.32, 0.22, Math.sin(t) * 0.32, 0.08, 0.44, 0.08);
      a.add(geo.cylinder(0.54, 0.34, 0.3, 11), S4.brass, 0, 0.58, 0);
      a.add(geo.torus(0.54, 0.05, 6, 14), S4.brassL, 0, 0.73, 0, { rx: Math.PI / 2 });
      a.add(geo.torus(0.44, 0.04, 6, 12), S4.iron, 0, 0.4, 0, { rx: Math.PI / 2 });
      for (const s of [-1, 1]) a.add(geo.torus(0.09, 0.03, 5, 8), S4.brassL, s * 0.58, 0.64, 0, { ry: Math.PI / 2 });
      a.add(geo.cylinder(0.46, 0.46, 0.03, 11), S4.coal, 0, 0.71, 0);
      for (let i = 0; i < 6; i++) a.add(geo.dodecahedron(0.1, 0), i % 2 ? S4.coalL : S4.coal, Math.cos(i * 1.05) * 0.26, 0.78, Math.sin(i * 1.05) * 0.26, { ry: i });
      bench(a, 0.1, 1.0, 1.5, mixHex(S4.timber, S4.cream, 0.2), S4.ironD, 0.4);
      a.snow(0.1, 0.45, 1.0, 0.5, 0.15, 0.04);
    },
    glow(g) {
      g.add(geo.sphere(1, 9, 6), FLAME, 0, 0.82, 0, { sx: 0.32, sy: 0.12, sz: 0.32 });
      for (let i = 0; i < 4; i++) g.box(FLAME_IN, Math.cos(i * 1.6) * 0.15, 0.9, Math.sin(i * 1.6) * 0.15, 0.1, 0.06, 0.1);
    },
    lamp: [0, 0.9, 0, 2.0, 4.2],
  },
  5: {
    solid(a) {
      a.add(geo.cylinder(0.44, 0.46, 0.84, 11), S5.steelD, 0, 0.44, 0);
      for (const y of [0.18, 0.7]) a.add(geo.torus(0.46, 0.035, 5, 14), S5.steelL, 0, y, 0, { rx: Math.PI / 2 });
      a.add(geo.torus(0.44, 0.045, 5, 14), S5.steel, 0, 0.87, 0, { rx: Math.PI / 2 });
      a.add(geo.cylinder(0.38, 0.38, 0.03, 11), S5.coke, 0, 0.8, 0);
      for (let i = 0; i < 5; i++) a.add(geo.dodecahedron(0.09, 0), i % 2 ? S5.cokeL : S5.coke, Math.cos(i * 1.3) * 0.22, 0.85, Math.sin(i * 1.3) * 0.22);
      for (const [x, z, r] of [[-0.9, 0.4, 0.2], [0.85, 0.65, -0.35]] as const) {
        a.box(mixHex(S5.brick, WOOD, 0.4), x, 0.24, z, 0.6, 0.48, 0.6, r);
        a.box(WOOD_D, x, 0.47, z, 0.64, 0.05, 0.64, r);
        a.box(WOOD_L, x, 0.24, z, 0.62, 0.06, 0.62, r);
      }
      a.box(mixHex(S5.brick, WOOD, 0.4), 0.2, 0.2, -0.95, 0.5, 0.4, 0.5, 0.6);
      a.snow(0.2, 0.42, -0.95, 0.27, 0.27, 0.05);
    },
    glow(g) {
      flame(g, 0.84, 0.8);
      for (const x of [-0.18, 0, 0.18]) g.box(FLAME, x, 0.5, 0.455, 0.08, 0.12, 0.03);
    },
    lamp: [0, 1.0, 0, 2.2, 4.4],
  },
  6: {
    solid(a) {
      const cu = 0xb86a3a;
      const cuL = 0xd9915a;
      a.box(palette(6).trim, 0, 0.06, 0, 1.0, 0.12, 1.0);
      a.add(geo.cylinder(0.1, 0.1, 0.8, 7), cu, 0, 0.5, 0);
      for (let i = 0; i < 6; i++) a.add(geo.torus(0.3 - (i % 2) * 0.02, 0.055, 6, 14), i % 2 ? cu : cuL, 0, 0.2 + i * 0.13, 0, { rx: Math.PI / 2 });
      a.add(geo.sphere(1, 9, 6), cuL, 0, 0.93, 0, { sx: 0.2, sy: 0.12, sz: 0.2 });
      for (const s of [-1, 1]) a.box(palette(6).accent, s * 0.42, 0.28, 0, 0.06, 0.32, 0.06);
      bench(a, 0, 1.05, 1.1, mixHex(palette(6).body, CREAM, 0.4), palette(6).accent, 0.36);
      a.snow(0, 0.4, 1.05, 0.38, 0.14, 0.04);
    },
    glow(g) {
      g.add(geo.cylinder(0.2, 0.2, 0.7, 8), FLAME, 0, 0.5, 0);
      for (let i = 0; i < 6; i++) g.add(geo.torus(0.3, 0.012, 4, 14), FLAME_IN, 0, 0.2 + i * 0.13, 0, { rx: Math.PI / 2 });
    },
    lamp: [0, 0.6, 0.2, 2.0, 4.2],
  },
  7: {
    solid(a) {
      const fur = mixHex(0xcdb79a, SNOW, 0.2);
      const furD = mixHex(0x8a6a4c, 0xb8946a, 0.5);
      a.add(geo.sphere(1, 12, 7), furD, -0.1, 0.07, 0.05, { sx: 1.15, sy: 0.07, sz: 0.95, ry: 0.3 });
      a.add(geo.sphere(1, 12, 7), fur, 0.15, 0.09, 0.25, { sx: 0.85, sy: 0.06, sz: 0.65, ry: -0.5 });
      logRing(a, S2.stone, S2.stoneL, 0.42, 7, 0.14);
      a.box(WOOD_D, 0, 0.17, 0, 0.7, 0.13, 0.13, 0.4);
      a.box(WOOD, 0, 0.17, 0, 0.7, 0.13, 0.13, -0.6);
      // the sled seat: two runners with upturned noses and a plank
      for (const z of [0.88, 1.18]) {
        a.box(WOOD_D, -0.05, 0.1, z, 1.3, 0.07, 0.07);
        a.add(geo.sphere(1, 7, 5), WOOD_D, 0.64, 0.14, z, { sx: 0.1, sy: 0.1, sz: 0.05 });
      }
      for (const x of [-0.5, 0.4]) a.box(WOOD, x, 0.2, 1.03, 0.1, 0.2, 0.42);
      a.box(WOOD_L, -0.05, 0.33, 1.03, 1.2, 0.07, 0.42);
      a.snow(-0.1, 0.38, 1.03, 0.4, 0.14, 0.04);
    },
    glow: (g) => flame(g, 0.2, 0.85),
    lamp: [0, 0.5, 0, 2.0, 4.2],
  },
  8: {
    solid(a) {
      const P8 = palette(8);
      const cream = mixHex(P8.body, SNOW, 0.3);
      const teal = P8.accent;
      a.box(cream, -0.15, 0.5, -0.45, 1.15, 0.5, 0.7);
      a.box(teal, -0.15, 0.26, -0.45, 1.2, 0.08, 0.76);
      a.box(mixHex(teal, SNOW, 0.35), -0.15, 0.78, -0.45, 1.25, 0.07, 0.78);
      for (const x of [-0.6, 0.3]) a.add(geo.cylinder(0.24, 0.24, 0.1, 10), WOOD_D, x, 0.25, -0.05, { rz: Math.PI / 2 });
      for (const x of [-0.7, 0.4]) a.box(WOOD, x, 0.95, -0.45, 0.05, 0.36, 0.05);
      for (let i = 0; i < 5; i++) a.box(i % 2 ? cream : teal, -0.15 + (i - 2) * 0.27, 1.14, -0.45, 0.27, 0.05, 0.9);
      a.add(geo.cylinder(0.1, 0.08, 0.14, 7), mixHex(SNOW, P8.ground, 0.2), 0.0, 0.88, -0.35);
      a.add(geo.cylinder(0.1, 0.08, 0.14, 7), cream, -0.35, 0.88, -0.5);
      a.box(WOOD, 0.62, 0.5, -0.05, 0.05, 1.0, 0.05);
      a.box(S2.iron, 0.62, 1.02, -0.05, 0.2, 0.04, 0.04);
      stool(a, 0.5, 1.0, 0.38, mixHex(teal, SNOW, 0.45), WOOD_D);
      stool(a, -0.5, 0.98, 0.34, cream, WOOD_D);
    },
    glow(g) {
      g.box(GLOW_AMBER, 0.62, 0.9, -0.05, 0.14, 0.2, 0.14);
      g.box(FLAME_IN, -0.15, 0.62, -0.08, 0.5, 0.2, 0.03);
    },
    lamp: [0.62, 1.0, -0.05, 1.8, 4.0],
  },
  9: {
    solid(a) {
      const P9 = palette(9);
      const mint = mixHex(P9.accent, SNOW, 0.5);
      const steel = mixHex(P9.trim, 0x8a9a98, 0.5);
      bench(a, 0, 0.4, 1.7, mixHex(P9.body, SNOW, 0.3), mint, 0.42, true);
      a.snow(0, 0.46, 0.42, 0.8, 0.17, 0.04);
      for (const s of [-1, 1]) {
        a.add(geo.cylinder(0.04, 0.05, 1.0, 6), steel, s * 0.95, 0.5, -0.1);
        a.add(geo.cylinder(0.13, 0.2, 0.14, 8), mint, s * 0.95, 1.08, -0.02);
        a.add(geo.cylinder(0.25, 0.25, 0.04, 9), steel, s * 0.95, 0.02, -0.1);
      }
      a.add(geo.cylinder(0.3, 0.3, 0.02, 9), mixHex(SNOW, P9.ground, 0.4), 0, 0.058, 0.55);
    },
    glow(g) {
      for (const s of [-1, 1]) {
        g.add(geo.cylinder(0.11, 0.11, 0.05, 8), FLAME_IN, s * 0.95, 1.0, -0.02);
        g.add(geo.cylinder(0.05, 0.05, 0.04, 6), FLAME, s * 0.95, 1.14, -0.02);
      }
    },
    lamp: [0, 1.0, 0.1, 2.4, 4.6],
  },
  10: {
    solid(a) {
      const stone = mixHex(PINK_SOFT, 0xe9dcc8, 0.5);
      const stoneD = mixHex(PINK_SOFT, 0xc9a8a0, 0.5);
      for (let i = 0; i < 9; i++) {
        const t = (i / 9) * Math.PI * 2 + 0.2;
        a.add(geo.dodecahedron(0.2, 0), i % 2 ? stone : stoneD, Math.cos(t) * 0.7, 0.15, Math.sin(t) * 0.7, { sx: 1.1, sy: 0.8, sz: 1.0, ry: t });
      }
      a.add(geo.cylinder(0.56, 0.56, 0.05, 14), mixHex(stoneD, 0x7a6a6a, 0.3), 0, 0.07, 0);
      const cush: [number, number, number, number][] = [[-0.45, 0.95, PINK_SOFT, 0.1], [0.6, 0.95, mixHex(GOLD, CREAM, 0.5), -0.3], [-0.95, 0.3, mixHex(PINK_SOFT, CREAM, 0.5), 0.7]];
      for (const [x, z, c, ry] of cush) {
        a.add(geo.sphere(1, 10, 6), c, x, 0.14, z, { sx: 0.32, sy: 0.14, sz: 0.28, ry });
      }
    },
    glow(g) {
      g.add(geo.cylinder(0.5, 0.5, 0.04, 14), PINK_GOLD, 0, 0.1, 0);
      for (let i = 0; i < 5; i++) {
        const t = i * 1.26;
        g.add(geo.cone(0.07, 0.26 + (i % 2) * 0.12, 5), i % 2 ? GOLD : PINK_SOFT, Math.cos(t) * 0.22, 0.25, Math.sin(t) * 0.22);
      }
    },
    lamp: [0, 0.4, 0, 2.4, 4.8],
  },
};

function drawSolid(a: At, n: WarmEra): void {
  tread(a, n);
  BUILD[n].solid(a);
}

const GEO = new Map<WarmEra, THREE.BufferGeometry>();
/** Era n's solid geometry, cached (about 2.6 m across, origin at the centre of its trodden snow disc). placeWarmSpot draws the same into the kit's solid batch. */
export function warmSpotGeo(n: WarmEra): THREE.BufferGeometry {
  let g = GEO.get(n);
  if (!g) {
    const a = new At(new Batch());
    drawSolid(a, n);
    g = a.b.geometry();
    GEO.set(n, g);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------------------------------------------------

const FP: Rect = { minX: -WARM_HALF, maxX: WARM_HALF, minZ: -WARM_HALF, maxZ: WARM_HALF };
const rectAt = (x: number, z: number): Rect => ({ minX: x + FP.minX, maxX: x + FP.maxX, minZ: z + FP.minZ, maxZ: z + FP.maxZ });

const CACHE = new WeakMap<RegionLayout, Map<number, { x: number; z: number } | null>>();

/** The landmark footprint the spot keeps off (eras 6, 7 and 10 have their own, passed in `extra`; 4 and 5 pass their base keep-outs). */
function landmarkAvoid(l: RegionLayout, n: WarmEra, extra: readonly Rect[]): Rect[] {
  if (n <= 5) return [...extra, ...landmarkRect(l, n as 2 | 3 | 4 | 5, extra)];
  if (n === 8 || n === 9) return [...extra, ...landmarkRect89(l, n)];
  return [...extra];
}

/**
 * Era n's warm spot on region l (the centre of its 2.6 m disc), or null when the harvest zone has no free ground. Pure and
 * deterministic. `extra`: rects the era already fills before the landmark (eras 4 / 5: their base keep-outs; 6 / 7 / 10:
 * their landmark keep-outs); the answer is cached per layout, so pass the same for an era every time.
 */
export function warmSpotFor(l: RegionLayout, n: WarmEra, extra: readonly Rect[] = []): { x: number; z: number } | null {
  let per = CACHE.get(l);
  if (!per) CACHE.set(l, (per = new Map()));
  if (per.has(n)) return per.get(n)!;
  const H = l.zones.harvest;
  const paths = regionPaths(l);
  const node = nodePatch(l);
  const field = plotPlaces(l.n).field;
  const sight = sightKeep(l, WARM_H);
  const avoid = landmarkAvoid(l, n, extra);
  const tests = (x: number, z: number, m: number): boolean => {
    const R = rectAt(x, z);
    if (R.minX < H.minX + 0.8 || R.maxX > H.maxX - 0.8 || R.minZ < H.minZ + 0.8 || R.maxZ > H.maxZ - 0.8) return false;
    const grown: Rect = { minX: R.minX - m, maxX: R.maxX + m, minZ: R.minZ - m, maxZ: R.maxZ + m };
    const hit = (q: Rect): boolean => grown.minX < q.maxX && q.minX < grown.maxX && grown.minZ < q.maxZ && q.minZ < grown.maxZ;
    if (hit(node) || hit(field) || paths.some(hit) || avoid.some(hit) || sight.some(hit)) return false;
    for (let px = R.minX; px <= R.maxX + 0.01; px += 1.2) for (let pz = R.minZ; pz <= R.maxZ + 0.01; pz += 1.2) {
      if (!clearOf(node, px, pz, 0.3, WARM_H)) return false;
    }
    return true;
  };
  let best: { x: number; z: number; score: number } | null = null;
  for (let x = Math.ceil(H.minX); x <= H.maxX; x += 1) {
    for (let z = Math.ceil(H.minZ); z <= H.maxZ; z += 1) {
      if (!tests(x, z, 0)) continue;
      let clear = 0;
      while (clear < 2 && tests(x, z, clear + 1)) clear++;
      // close to the hand node (where the player works and walks), not the back corner
      const score = clear * 1.2 - Math.hypot(x - l.node.x, z - l.node.z) * 0.3;
      if (!best || score > best.score) best = { x, z, score };
    }
  }
  const out = best ? { x: best.x, z: best.z } : null;
  per.set(n, out);
  return out;
}

/** The rect the spot covers (for keepOut), or [] when it has no spot. */
export function warmSpotRect(l: RegionLayout, n: WarmEra, extra: readonly Rect[] = []): Rect[] {
  const s = warmSpotFor(l, n, extra);
  return s ? [rectAt(s.x, s.z)] : [];
}

/** Build era n's warm spot into the kit. Returns its spot (null when nothing fits: skipped silently). */
export function placeWarmSpot(k: GroundKit, l: RegionLayout, rng: Rng, n: WarmEra, extra: readonly Rect[] = []): { x: number; z: number } | null {
  void rng;
  const s = warmSpotFor(l, n, extra);
  if (!s) return null;
  // drawn into the kit's shared solid batch (the same routine as the cached geometry), so a spot costs no draw call
  drawSolid(new At(k.solid, s.x, s.z), n);
  BUILD[n].glow(new At(k.glow, s.x, s.z));
  const [x, y, z, size, pool] = BUILD[n].lamp;
  k.lamps.push({ x: s.x + x, y, z: s.z + z, size, pool });
  return s;
}
