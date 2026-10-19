/**
 * Era signature landmarks (eras 2-5): one chunky toy-diorama building per era, so each era's area reads as its own place.
 *   2 Frontier    a brick kiln row (three beehive clay kilns on a fieldstone plinth, a chimney, fired bricks, hay)
 *   3 Iron Age    an ore cliff with a timber mine mouth, a lantern, a rail stub and a little ore cart
 *   4 Steam Age   a water tower beside a short track with a coal wagon under its spout and a coal heap
 *   5 Industrial  a coke oven battery: five glowing oven doors, two banded smokestacks and a quench tower
 * Solids are one cached geometry per era (k.put, so one draw call and a shadow); the glow panes go into k.glow at the
 * landmark's spot and the lamps get night halos. Every colour is a mix of the era's palette rows (render/palette.ts).
 * Visual only: the spot is picked on the harvest zone's free ground, back (−X/−Z) first, off the paths, the field, the
 * hand node, the market and whatever the era already stands there.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import { plotPlaces, type RegionLayout } from '../../../eras/layout';
import { Batch, type PartOpts } from '../../../render/batch';
import { geo } from '../../../render/materials';
import { GOLD, MACHINE_SHADES, mixHex, palette, SNOW } from '../../../render/palette';
import type { Rng } from '../common';
import type { GroundKit } from '../eraGround';
import { nodePatch, regionPaths } from '../frontier';
import { clearOf } from './kit1to3';
import { sightKeep } from './kit4to7';

type Era = 2 | 3 | 4 | 5;
const BOX = (): THREE.BufferGeometry => geo.box(1, 1, 1);

/** A Batch seen from an offset, so one drawing routine serves both the cached solid geometry (0, 0) and the world glow. */
export class At {
  /** `s` scales the whole drawing about the origin (a landmark grown to read at the play camera, `scaled`). */
  constructor(readonly b: Batch, readonly ox = 0, readonly oz = 0, readonly s = 1) {}
  add(g: THREE.BufferGeometry, c: number, x: number, y: number, z: number, o?: PartOpts): this {
    const k = this.s;
    const opts = k === 1 ? o : { ...o, sx: (o?.sx ?? 1) * k, sy: (o?.sy ?? 1) * k, sz: (o?.sz ?? 1) * k };
    this.b.add(g, c, x * k + this.ox, y * k, z * k + this.oz, opts);
    return this;
  }
  /** A box w × h × d with its centre at (x, y, z). */
  box(c: number, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): this {
    return this.add(BOX(), c, x, y, z, { sx: w, sy: h, sz: d, ry });
  }
  /** A flat rounded snow cap (an ellipsoid) sitting on a top at y. */
  snow(x: number, y: number, z: number, rx: number, rz: number, t = 0.2): this {
    return this.add(geo.sphere(1, 14, 8), SNOW, x, y, z, { sx: rx, sy: t, sz: rz });
  }
}

// ---- tones (palette rows only)
const S2 = MACHINE_SHADES[2];
const S3 = MACHINE_SHADES[3];
const S4 = MACHINE_SHADES[4];
const S5 = MACHINE_SHADES[5];
const GLOW_WARM = (n: Era): number => mixHex(palette(n).light, GOLD, 0.35);

// ---------------------------------------------------------------------------------------------------------------------
// era 2: kiln row
// ---------------------------------------------------------------------------------------------------------------------

const K = {
  plinth: mixHex(S2.stone, S2.stoneL, 0.4),
  plinthTop: S2.stoneL,
  kiln: S2.clay,
  kilnL: S2.clayL,
  kilnD: S2.clayD,
  brick: mixHex(S2.clay, S2.clayD, 0.45),
  brickL: mixHex(S2.clayL, S2.stoneL, 0.2),
  hay: mixHex(GOLD, S2.plank, 0.5),
  rope: S2.rope,
  glow: GLOW_WARM(2),
};
const KILN_X = [-1.65, 0, 1.65] as const;

let kilnRow: THREE.BufferGeometry | null = null;
/** Three beehive kilns on a fieldstone plinth, a tall chimney, a stack of fired bricks, a hay bale (≈ 6.3 m, ±3.4 × ±1.8). */
export function kilnRowGeo(): THREE.BufferGeometry {
  if (!kilnRow) {
    const a = new At(new Batch());
    a.box(K.plinth, 0, 0.2, 0, 7.0, 0.4, 3.4);
    a.box(K.plinthTop, 0, 0.42, 0, 6.8, 0.06, 3.2);
    for (let i = 0; i < 9; i++) a.add(geo.dodecahedron(0.3, 0), i % 2 ? S2.stone : S2.stoneL, -3.2 + i * 0.8, 0.2, 1.7, { sx: 1.2, sy: 0.8, sz: 0.8 });
    for (const x of KILN_X) {
      a.add(geo.sphere(1, 18, 10), K.kiln, x, 0.4, 0.1, { sx: 0.95, sy: 1.5, sz: 0.95 });
      a.add(geo.torus(0.9, 0.12, 6, 18), K.kilnD, x, 0.62, 0.1, { rx: Math.PI / 2 });
      a.add(geo.torus(0.74, 0.1, 6, 18), K.kilnD, x, 1.25, 0.1, { rx: Math.PI / 2 });
      a.add(geo.cylinder(0.2, 0.26, 0.28, 8), K.kilnD, x, 1.95, 0.1);
      a.snow(x, 1.64, 0.1, 0.62, 0.62, 0.3);
      // the arched mouth: frame + arch now, the glow pane in the glow batch
      a.box(K.kilnD, x, 0.9, 0.98, 0.95, 0.9, 0.34);
      a.add(geo.cylinder(0.475, 0.475, 0.34, 10), K.kilnD, x, 1.35, 0.98, { rx: Math.PI / 2 });
    }
    // chimney behind the middle kiln
    a.add(geo.cylinder(0.34, 0.5, 5.4, 8), K.brick, 0, 3.1, -1.2);
    for (const y of [1.2, 2.6, 4.0]) a.add(geo.torus(0.46 - (y - 1.2) * 0.026, 0.07, 5, 10), K.brickL, 0, y, -1.2, { rx: Math.PI / 2 });
    a.add(geo.cylinder(0.46, 0.34, 0.3, 8), K.brickL, 0, 5.9, -1.2);
    a.add(geo.cylinder(0.4, 0.4, 0.06, 8), SNOW, 0, 6.08, -1.2);
    // fired bricks, stacked crosswise
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) a.box((r + c) % 2 ? K.kiln : K.brick, 3.0 + (c - 1) * 0.5, 0.58 + r * 0.17, 1.0, r % 2 ? 0.46 : 1.4, 0.15, r % 2 ? 1.4 : 0.46);
    a.snow(3.0, 1.28, 1.0, 0.85, 0.85, 0.12);
    // hay bale
    a.box(K.hay, -3.0, 0.75, 1.0, 1.1, 0.62, 0.7);
    for (const s of [-0.28, 0.28]) a.box(K.rope, -3.0 + s, 0.75, 1.0, 0.07, 0.66, 0.74);
    a.snow(-3.0, 1.07, 1.0, 0.55, 0.36, 0.1);
    kilnRow = a.b.geometry();
  }
  return kilnRow;
}
function kilnRowGlow(g: At): void {
  for (const x of KILN_X) {
    g.box(K.glow, x, 0.88, 1.17, 0.58, 0.62, 0.06);
    g.add(geo.cylinder(0.29, 0.29, 0.06, 10), K.glow, x, 1.19, 1.17, { rx: Math.PI / 2 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// era 3: ore cliff with a mine mouth
// ---------------------------------------------------------------------------------------------------------------------

const M = {
  rust: S3.rust,
  ore: S3.ore,
  oreD: S3.oreD,
  slate: S3.slate,
  stone: S3.stone,
  timber: S3.timber,
  timberD: S3.timberD,
  iron: S3.iron,
  ironL: S3.ironL,
  hole: mixHex(S3.timberD, S3.rustD, 0.5),
  glow: GLOW_WARM(3),
};

let mine: THREE.BufferGeometry | null = null;
/** A stepped rust / slate outcrop with a timber mine entrance and a rail stub with an ore cart (≈ 5 m, x ±2.5, z −1.8…3.8). */
export function mineCliffGeo(): THREE.BufferGeometry {
  if (!mine) {
    const a = new At(new Batch());
    // the outcrop: a chunky base block, two rounded steps above it, lumps at the shoulders
    a.box(M.rust, 0, 1.0, -0.5, 4.6, 2.0, 2.8);
    a.box(M.slate, 0, 0.55, -0.5, 4.66, 0.25, 2.86);
    a.box(M.oreD, 0, 1.55, -0.5, 4.64, 0.2, 2.84);
    a.snow(0, 2.0, -0.5, 2.5, 1.6, 0.26);
    a.add(geo.dodecahedron(1, 0), M.ore, -0.5, 2.9, -1.0, { sx: 2.0, sy: 1.0, sz: 1.3, ry: 0.3 });
    a.snow(-0.5, 3.75, -1.0, 1.6, 1.0, 0.3);
    a.add(geo.dodecahedron(1, 0), M.slate, 0.6, 4.2, -1.3, { sx: 1.3, sy: 0.95, sz: 1.0, ry: 0.8 });
    a.snow(0.6, 5.0, -1.3, 1.0, 0.8, 0.28);
    for (const [x, z, r, c] of [[-2.2, 0.7, 0.85, M.stone], [2.2, 0.8, 0.9, M.ore], [-2.0, -1.5, 0.9, M.slate], [2.1, -1.4, 1.0, M.rust]] as const) {
      a.add(geo.dodecahedron(r, 0), c, x, r * 0.62, z, { sy: 0.8, ry: x });
      a.snow(x, r * 1.2, z, r * 0.62, r * 0.6, 0.14);
    }
    // the timber-framed mouth
    a.box(M.hole, 0, 0.78, 0.98, 1.4, 1.56, 0.14);
    for (const x of [-0.8, 0.8]) a.box(M.timber, x, 0.9, 1.1, 0.3, 1.8, 0.36);
    a.box(M.timberD, 0, 1.92, 1.1, 2.1, 0.3, 0.46);
    a.box(M.timber, 0, 2.2, 1.0, 1.8, 0.2, 0.3);
    a.snow(0, 2.34, 1.0, 1.1, 0.34, 0.12);
    // a lantern post beside it
    a.add(geo.cylinder(0.07, 0.09, 1.5, 6), M.timberD, 1.55, 0.75, 1.6);
    a.box(M.timberD, 1.55, 1.52, 1.6, 0.4, 0.05, 0.4);
    for (const [dx, dz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]] as const) a.box(M.iron, 1.55 + dx, 1.74, 1.6 + dz, 0.04, 0.4, 0.04);
    a.add(geo.cone(0.3, 0.22, 4), M.iron, 1.55, 2.05, 1.6, { ry: Math.PI / 4 });
    a.add(geo.cone(0.22, 0.12, 4), SNOW, 1.55, 2.14, 1.6, { ry: Math.PI / 4 });
    // rail stub with sleepers, from the mouth out, ending in a little buffer
    for (let z = 1.5; z < 3.6; z += 0.55) a.box(M.timber, 0, 0.05, z, 1.3, 0.06, 0.2);
    for (const x of [-0.4, 0.4]) a.box(M.ironL, x, 0.11, 2.6, 0.08, 0.07, 2.3);
    a.box(M.timberD, 0, 0.2, 3.7, 1.2, 0.3, 0.2);
    // the ore cart (on the rails, nose to the mouth)
    a.box(M.iron, 0, 0.62, 2.6, 0.95, 0.5, 1.3);
    a.box(M.ironL, 0, 0.9, 2.6, 1.05, 0.08, 1.4);
    for (const x of [-0.44, 0.44]) for (const z of [-0.45, 0.45]) a.add(geo.cylinder(0.2, 0.2, 0.1, 10), M.timberD, x, 0.22, 2.6 + z, { rz: Math.PI / 2 });
    a.add(geo.sphere(1, 10, 6), M.ore, 0, 0.92, 2.6, { sx: 0.5, sy: 0.3, sz: 0.62 });
    for (const [x, z] of [[-0.18, -0.2], [0.2, 0.05], [0, 0.28]] as const) a.add(geo.dodecahedron(0.15, 0), M.oreD, x, 1.12, 2.6 + z);
    a.snow(0.05, 1.18, 2.55, 0.34, 0.4, 0.1);
    mine = a.b.geometry();
  }
  return mine;
}
function mineCliffGlow(g: At): void {
  g.box(M.glow, 1.55, 1.74, 1.6, 0.3, 0.34, 0.3);
  g.box(mixHex(M.glow, M.hole, 0.55), 0, 0.5, 1.07, 0.5, 0.18, 0.04);
}

// ---------------------------------------------------------------------------------------------------------------------
// era 4: water tower + coal wagon
// ---------------------------------------------------------------------------------------------------------------------

const W = {
  timber: S4.timber,
  stave: mixHex(S4.timber, S4.cream, 0.18),
  iron: S4.iron,
  ironD: S4.ironD,
  brick: S4.brick,
  brickD: S4.brickD,
  brickL: S4.brickL,
  roof: S4.roof,
  brass: S4.brass,
  brassL: S4.brassL,
  coal: S4.coal,
  coalL: S4.coalL,
  cream: S4.cream,
  glow: GLOW_WARM(4),
};
/** The wagon's centre and the track's z in the landmark's frame. */
const TRACK_Z = 1.5;
const LOCO_X = -0.9;

let tower: THREE.BufferGeometry | null = null;
/** A round timber water tower on legs with a spout, a short track, a coal wagon and a coal heap (≈ 6.4 m, x ±3.3). */
export function waterTowerLocoGeo(): THREE.BufferGeometry {
  if (!tower) {
    const a = new At(new Batch());
    // ---- tower at (1.4, -0.9)
    const tx = 1.4;
    const tz = -0.9;
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) {
      a.add(geo.cylinder(0.14, 0.18, 3.3, 7), W.timber, tx + x, 1.65, tz + z);
      a.box(W.ironD, tx + x, 0.08, tz + z, 0.46, 0.16, 0.46);
    }
    for (const y of [1.0, 2.2]) {
      for (const s of [-0.8, 0.8]) {
        a.box(W.timber, tx, y, tz + s, 1.7, 0.1, 0.1);
        a.box(W.timber, tx + s, y, tz, 0.1, 0.1, 1.7);
      }
    }
    a.add(geo.cylinder(1.25, 1.25, 0.2, 14), W.ironD, tx, 3.4, tz);
    a.add(geo.cylinder(1.15, 1.15, 1.7, 14), W.stave, tx, 4.3, tz);
    for (const y of [3.7, 4.3, 4.9]) a.add(geo.torus(1.17, 0.05, 5, 20), y === 4.3 ? W.brass : W.iron, tx, y, tz, { rx: Math.PI / 2 });
    a.add(geo.cone(1.45, 1.1, 14), W.brick, tx, 5.7, tz);
    a.add(geo.cone(1.0, 0.6, 14), SNOW, tx, 5.96, tz);
    a.add(geo.sphere(0.2, 8, 6), W.brass, tx, 6.35, tz);
    // spout: a pipe out of the tank's flank toward the track, with a drop
    a.add(geo.cylinder(0.1, 0.1, 1.5, 7), W.iron, tx, 3.25, tz + 1.6, { rx: Math.PI / 2 });
    a.add(geo.cylinder(0.09, 0.09, 0.9, 7), W.iron, tx, 2.8, tz + 2.3);
    a.add(geo.cylinder(0.16, 0.1, 0.22, 7), W.brass, tx, 2.28, tz + 2.3);
    // ---- the track
    for (let x = -3.1; x <= 3.1; x += 0.6) a.box(W.timber, x, 0.05, TRACK_Z, 0.2, 0.07, 1.5);
    for (const s of [-0.5, 0.5]) a.box(W.ironD, 0, 0.12, TRACK_Z + s, 6.3, 0.08, 0.09);
    for (const x of [-3.15, 3.15]) {
      a.box(W.brickD, x, 0.3, TRACK_Z, 0.24, 0.5, 1.3);
      a.snow(x, 0.57, TRACK_Z, 0.16, 0.6, 0.06);
    }
    // ---- a little coal wagon waiting under the spout (the era's siding already has its engine)
    const lx = LOCO_X;
    const lz = TRACK_Z;
    a.box(W.ironD, lx, 0.44, lz, 1.9, 0.18, 0.92);
    a.box(W.brick, lx, 0.86, lz, 1.8, 0.66, 0.96);
    a.box(W.brickL, lx, 1.22, lz, 1.9, 0.08, 1.04);
    for (const x of [-0.6, 0, 0.6]) a.box(W.brass, lx + x, 0.86, lz + 0.49, 0.06, 0.6, 0.02);
    for (const x of [-0.6, 0, 0.6]) a.box(W.brass, lx + x, 0.86, lz - 0.49, 0.06, 0.6, 0.02);
    a.add(geo.sphere(1, 10, 6), W.coal, lx, 1.26, lz, { sx: 0.82, sy: 0.32, sz: 0.42 });
    for (let i = 0; i < 5; i++) a.add(geo.dodecahedron(0.16, 0), i % 2 ? W.coalL : W.coal, lx - 0.5 + i * 0.25, 1.42 + (i % 2) * 0.06, lz + (i % 3 - 1) * 0.15, { ry: i });
    a.snow(lx, 1.5, lz, 0.5, 0.26, 0.06);
    for (const s of [-0.5, 0.5]) {
      for (const x of [-0.55, 0.55]) a.add(geo.cylinder(0.28, 0.28, 0.1, 12), W.brass, lx + x, 0.3, lz + s, { rx: Math.PI / 2 });
    }
    // ---- coal heap at the track's west end, behind the buffer
    a.add(geo.sphere(1, 12, 8), W.coal, -2.5, 0.3, -0.5, { sx: 1.1, sy: 0.7, sz: 0.9 });
    for (let i = 0; i < 7; i++) a.add(geo.dodecahedron(0.2, 0), i % 2 ? W.coalL : W.coal, -2.5 + Math.cos(i * 1.1) * 0.7, 0.4 + (i % 3) * 0.12, -0.5 + Math.sin(i * 1.1) * 0.55, { ry: i });
    a.snow(-2.5, 0.88, -0.5, 0.6, 0.5, 0.12);
    tower = a.b.geometry();
  }
  return tower;
}
function waterTowerLocoGlow(g: At): void {
  // a lantern hung on the tower's leg by the spout
  g.box(W.glow, 1.4 + 0.8, 1.6, -0.9 + 0.95, 0.22, 0.3, 0.22);
}

// ---------------------------------------------------------------------------------------------------------------------
// era 5: coke oven battery
// ---------------------------------------------------------------------------------------------------------------------

const B = {
  brick: S5.brick,
  brickD: S5.brickD,
  steel: S5.steel,
  steelL: S5.steelL,
  steelD: S5.steelD,
  orange: S5.orange,
  orangeD: S5.orangeD,
  concrete: S5.concrete,
  coke: S5.coke,
  cokeL: S5.cokeL,
  glow: GLOW_WARM(5),
  puff: mixHex(SNOW, S5.concrete, 0.25),
};
const OVEN_X = [-2.4, -1.2, 0, 1.2, 2.4] as const;

let battery: THREE.BufferGeometry | null = null;
/** A long low brick block with five oven doors, two banded smokestacks and a slatted quench tower (≈ 6.6 m, x ±3.6, z −2.8…2.4). */
export function cokeBatteryGeo(): THREE.BufferGeometry {
  if (!battery) {
    const a = new At(new Batch());
    a.box(B.concrete, 0, 0.18, 0, 7.4, 0.36, 2.8);
    a.box(B.brick, 0, 1.38, 0, 6.6, 2.1, 2.2);
    a.box(B.brickD, 0, 0.5, 0, 6.7, 0.28, 2.3);
    a.box(B.steelD, 0, 2.5, 0, 6.8, 0.16, 2.4);
    a.box(SNOW, 0, 2.66, 0, 6.7, 0.18, 2.3);
    for (const x of [-3.2, -1.8, -0.6, 0.6, 1.8, 3.2]) a.box(B.steel, x, 1.4, 1.17, 0.26, 2.1, 0.2);
    for (const x of OVEN_X) {
      a.box(B.steelD, x, 1.1, 1.14, 0.92, 1.14, 0.12);
      a.add(geo.cylinder(0.46, 0.46, 0.12, 10), B.steelD, x, 1.67, 1.14, { rx: Math.PI / 2 });
      a.box(B.steelL, x, 0.5, 1.2, 0.98, 0.1, 0.16);
      a.add(geo.cylinder(0.07, 0.07, 0.22, 6), B.steelL, x, 2.82, -0.3);
      a.add(geo.cylinder(0.2, 0.22, 0.12, 8), B.steel, x, 2.78, -0.3);
    }
    // two smokestacks with orange-red bands, at the block's back corners
    for (const sx of [-2.6, 2.6]) {
      a.add(geo.cylinder(0.52, 0.72, 0.7, 12), B.brickD, sx, 2.95, -1.5);
      let y = 3.3;
      for (let i = 0; i < 5; i++) {
        const r = 0.5 - i * 0.04;
        a.add(geo.cylinder(r - 0.02, r + 0.02, 0.78, 12), i % 2 ? B.orange : B.brick, sx, y + 0.39, -1.5);
        y += 0.78;
      }
      a.add(geo.torus(0.4, 0.07, 6, 14), B.steelL, sx, y + 0.06, -1.5, { rx: Math.PI / 2 });
      a.add(geo.cylinder(0.33, 0.33, 0.08, 12), SNOW, sx, y + 0.03, -1.5);
    }
    // the quench tower: a slatted steel box with a pitched roof, between the stacks, steam puffs on top
    a.box(B.steelL, 0, 2.2, -2.0, 1.5, 2.8, 1.3);
    for (let i = 0; i < 4; i++) a.box(B.steel, 0, 1.2 + i * 0.6, -1.35, 1.34, 0.12, 0.06);
    a.box(B.orangeD, 0, 3.7, -2.0, 1.7, 0.18, 1.5);
    a.add(geo.cone(1.25, 0.7, 4), B.orange, 0, 4.15, -2.0, { ry: Math.PI / 4 });
    a.add(geo.cone(0.9, 0.4, 4), SNOW, 0, 4.4, -2.0, { ry: Math.PI / 4 });
    a.add(geo.sphere(0.4, 8, 6), B.puff, 0.2, 5.1, -2.0);
    a.add(geo.sphere(0.3, 8, 6), B.puff, -0.2, 5.6, -2.05);
    a.add(geo.sphere(0.22, 8, 6), B.puff, 0.1, 6.0, -2.0);
    // a heap of coke and a wheelbarrow-ish bin at the front
    a.add(geo.sphere(1, 10, 7), B.coke, 3.3, 0.3, 1.9, { sx: 0.8, sy: 0.55, sz: 0.65 });
    for (let i = 0; i < 5; i++) a.add(geo.dodecahedron(0.16, 0), i % 2 ? B.cokeL : B.coke, 3.3 + Math.cos(i * 1.3) * 0.45, 0.42, 1.9 + Math.sin(i * 1.3) * 0.35, { ry: i });
    a.snow(3.3, 0.62, 1.9, 0.5, 0.4, 0.1);
    battery = a.b.geometry();
  }
  return battery;
}
function cokeBatteryGlow(g: At): void {
  for (const x of OVEN_X) {
    g.box(B.glow, x, 1.1, 1.22, 0.64, 0.82, 0.05);
    g.add(geo.cylinder(0.32, 0.32, 0.05, 10), B.glow, x, 1.51, 1.22, { rx: Math.PI / 2 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------------------------------------------------

export interface Def {
  geom: () => THREE.BufferGeometry;
  glow: (g: At) => void;
  /** Footprint relative to the origin, and the tallest point. */
  fp: Rect;
  h: number;
  /** Lamps (relative x, y, z, size, pool). */
  lamps: [number, number, number, number, number][];
  /** Flat pieces for the floor batch (ponds, kerbs), same frame. */
  floor?: (g: At) => void;
}

const DEFS: Record<Era, Def> = {
  2: { geom: kilnRowGeo, glow: kilnRowGlow, fp: { minX: -3.6, maxX: 3.6, minZ: -1.8, maxZ: 1.8 }, h: 6.2, lamps: [[-1.65, 1.0, 1.6, 2.0, 4.6], [1.65, 1.0, 1.6, 2.0, 4.6]] },
  3: { geom: mineCliffGeo, glow: mineCliffGlow, fp: { minX: -2.5, maxX: 2.5, minZ: -2.0, maxZ: 3.9 }, h: 5.2, lamps: [[1.55, 1.75, 1.6, 1.8, 4.8], [0, 0.7, 1.4, 1.4, 3.6]] },
  4: { geom: waterTowerLocoGeo, glow: waterTowerLocoGlow, fp: { minX: -3.4, maxX: 3.4, minZ: -2.2, maxZ: 2.4 }, h: 6.4, lamps: [[2.2, 1.6, 0.05, 1.6, 4.0]] },
  5: { geom: cokeBatteryGeo, glow: cokeBatteryGlow, fp: { minX: -3.8, maxX: 3.8, minZ: -2.9, maxZ: 2.4 }, h: 6.6, lamps: [[-1.2, 1.1, 1.5, 2.0, 4.8], [1.2, 1.1, 1.5, 2.0, 4.8]] },
};

/** Def `d` grown by `k` about its origin: geometry, glow, floor, footprint, height and lamps all scale together. */
export function scaled(d: Def, k: number): Def {
  let g: THREE.BufferGeometry | null = null;
  return {
    geom: () => (g ??= d.geom().clone().scale(k, k, k)),
    glow: (a) => d.glow(new At(a.b, a.ox, a.oz, a.s * k)),
    floor: d.floor ? (a) => d.floor!(new At(a.b, a.ox, a.oz, a.s * k)) : undefined,
    fp: { minX: d.fp.minX * k, maxX: d.fp.maxX * k, minZ: d.fp.minZ * k, maxZ: d.fp.maxZ * k },
    h: d.h * k,
    lamps: d.lamps.map(([x, y, z, size, pool]) => [x * k, y * k, z * k, size * k, pool * k]),
  };
}

export const world = (d: Def, x: number, z: number): Rect => ({ minX: x + d.fp.minX, maxX: x + d.fp.maxX, minZ: z + d.fp.minZ, maxZ: z + d.fp.maxZ });

/** The landmark's spot on region l (centre of its origin), or null when the harvest zone has no free ground for it. `avoid`: rects the era already fills. */
export function landmarkSpot(l: RegionLayout, n: Era, avoid: readonly Rect[] = []): { x: number; z: number } | null {
  return spotFor(DEFS[n], l, avoid);
}

/** The generic spot search for any landmark definition (eras 8-9 reuse it from landmarks8to9.ts). */
export function spotFor(d: Def, l: RegionLayout, avoid: readonly Rect[] = []): { x: number; z: number } | null {
  const H = l.zones.harvest;
  const paths = regionPaths(l);
  const node = nodePatch(l);
  const field = plotPlaces(l.n).field;
  const sight = sightKeep(l, d.h);
  const tests = (x: number, z: number, m: number): boolean => {
    const R = world(d, x, z);
    if (R.minX < H.minX + 0.8 || R.maxX > H.maxX - 0.8 || R.minZ < H.minZ + 0.8 || R.maxZ > H.maxZ - 0.8) return false;
    const grown: Rect = { minX: R.minX - m, maxX: R.maxX + m, minZ: R.minZ - m, maxZ: R.maxZ + m };
    const hit = (q: Rect): boolean => grown.minX < q.maxX && q.minX < grown.maxX && grown.minZ < q.maxZ && q.minZ < grown.maxZ;
    if (hit(node) || hit(field) || paths.some(hit) || avoid.some(hit) || sight.some(hit)) return false;
    // the camera shadow of the whole footprint (toward −X / −Z) must miss the node, the field's edge and the market keep-outs
    for (let px = R.minX; px <= R.maxX + 0.01; px += 1.2) for (let pz = R.minZ; pz <= R.maxZ + 0.01; pz += 1.2) {
      if (!clearOf(node, px, pz, 0.3, d.h)) return false;
    }
    return true;
  };
  let best: { x: number; z: number; score: number } | null = null;
  for (let x = H.minX; x <= H.maxX; x += 1) {
    for (let z = H.minZ; z <= H.maxZ; z += 1) {
      if (!tests(x, z, 0)) continue;
      let clear = 0;
      while (clear < 3 && tests(x, z, clear + 1)) clear++;
      // the camera sits toward +X/+Z, so a lower x + z is "back"
      const score = clear * 2 - (x + z) * 0.12;
      if (!best || score > best.score) best = { x, z, score };
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

/** The rect the landmark covers (for keepOut), or [] when it has no spot. */
export function landmarkRect(l: RegionLayout, n: Era, avoid: readonly Rect[] = []): Rect[] {
  const s = landmarkSpot(l, n, avoid);
  return s ? [world(DEFS[n], s.x, s.z)] : [];
}

/** Build the era's landmark into the kit. Returns its spot (null when nothing fits: skipped silently). `avoid`: rects the era already fills. */
export function placeLandmark(k: GroundKit, l: RegionLayout, rng: Rng, n: Era, avoid: readonly Rect[] = []): { x: number; z: number } | null {
  void rng;
  const s = landmarkSpot(l, n, avoid);
  return s ? placeDef(k, n, DEFS[n], s) : null;
}

/** Put a landmark definition into the kit at spot s. */
export function placeDef(k: GroundKit, n: number, d: Def, s: { x: number; z: number }): { x: number; z: number } {
  k.put(`landmark${n}`, d.geom, { x: s.x, z: s.z });
  d.glow(new At(k.glow, s.x, s.z));
  d.floor?.(new At(k.floor, s.x, s.z));
  for (const [x, y, z, size, pool] of d.lamps) k.lamps.push({ x: s.x + x, y, z: s.z + z, size, pool });
  return s;
}
