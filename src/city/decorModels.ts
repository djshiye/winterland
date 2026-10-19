/**
 * [city] 1.0 the street furniture of a city district drawn into Batches (city/decor.ts says where it stands): era-dressed
 * trees in round planters, hedges, benches, flower boxes / barrels, post boxes, snowmen, bins and bike racks, each with a
 * little snow cap. Everything is built from the cached primitives with a handful of vertices (a district holds ~100
 * items), merged into ONE vertex-coloured mesh by the caller; the few lit bits (fairy lights on trees and hedges) go into
 * the lamps' bulb batch, so decoration costs one extra draw call per district.
 *
 * Models are authored in a local frame at scale 1 (front = +Z, y up) and placed by `part`, which applies the item's
 * yaw, scale and position, so a model's code reads like a tiny scene description.
 */
import * as THREE from 'three';
import { SNOW, SNOW_SHADE, mixHex } from '../render/palette';
import { geo } from '../render/materials';
import type { Batch } from '../render/batch';
import type { DecorItem } from './decor';

/** How one era dresses its furniture (colours only; the shapes are shared and switch on the era number). */
interface Look {
  /** Bench slats, crates, barrels, mailbox posts. */
  wood: number;
  /** Frames, hoops, rack loops, bin bodies. */
  metal: number;
  /** Planter / pot body. */
  planter: number;
  leaf: number;
  leaf2: number;
  /** Flowers, berries, scarves, bike frames. */
  accent: number;
  accent2: number;
  /** The post box. */
  mail: number;
}

const LOOK: readonly (Look | null)[] = [
  null,
  null,
  { wood: 0x9a6a3e, metal: 0x4a4038, planter: 0x8a5a33, leaf: 0x2f6b4a, leaf2: 0x3f8058, accent: 0xc44a3a, accent2: 0xe9dfcc, mail: 0x8a5a36 }, // frontier: timber, hoops, pines
  { wood: 0x7a5236, metal: 0x3b3f47, planter: 0x4a4f58, leaf: 0x3d6b52, leaf2: 0x4f8060, accent: 0xe0a040, accent2: 0xb85239, mail: 0xa83232 }, // iron: gas-lamp black, brick red
  { wood: 0x6a4a30, metal: 0xc99a3a, planter: 0xa5703f, leaf: 0x3a6a50, leaf2: 0x4e8460, accent: 0xd49a35, accent2: 0xc0603a, mail: 0x2f6b4a }, // steam: brass and copper
  { wood: 0x6a4a3a, metal: 0x5c666d, planter: 0x6f7880, leaf: 0x3a6a58, leaf2: 0x4c8268, accent: 0xe08a2b, accent2: 0xf0e8d6, mail: 0x2c4a6a }, // industrial: steel, safety orange
  { wood: 0xb39d7a, metal: 0x3f5a56, planter: 0xe3d8bc, leaf: 0x3f7a64, leaf2: 0x58946e, accent: 0xd97f38, accent2: 0xfaf6ec, mail: 0xc0392b }, // electric art deco: cream and teal
  { wood: 0xd99b26, metal: 0xb8c0c4, planter: 0xd6c4a2, leaf: 0x4a7a5a, leaf2: 0x62946c, accent: 0xc44536, accent2: 0xf0e8d6, mail: 0x2b5fa8 }, // oil / gas: honey, chrome, diner red
  { wood: 0xd8c9a8, metal: 0xd9a030, planter: 0xa9cfcb, leaf: 0x4f8f78, leaf2: 0x6aa88a, accent: 0xe8a848, accent2: 0x45858c, mail: 0x45858c }, // silicon: glass teal and gold
  { wood: 0xe8f2ee, metal: 0x4ea885, planter: 0xbfe0d3, leaf: 0x5aa888, leaf2: 0x7cc4a4, accent: 0x7ee0b8, accent2: 0xfbfdfb, mail: 0xdff3ea }, // atomic: mint glaze and white
  { wood: 0xfbf4e6, metal: 0xe8a848, planter: 0xf5d7e0, leaf: 0x84c9a4, leaf2: 0xa8dcc0, accent: 0xf29ab8, accent2: 0xc8b8e8, mail: 0xf2b8c6 }, // AI: soft pastels, gold seams
];

const BOX = geo.boxBase(1, 1, 1);
const CYL = (taper: number, seg: number): THREE.BufferGeometry => geo.cylinder(taper, 1, 1, seg);
const SPH = geo.sphere(1, 8, 6);
const SPH_S = geo.sphere(1, 6, 4);
const CONE = geo.cone(1, 1, 7);
/** A carrot nose: a cone lying along +Z. */
const NOSE = new THREE.ConeGeometry(1, 1, 6).rotateX(Math.PI / 2);
const WHEEL = geo.torus(0.2, 0.03, 4, 12);
const DARK = 0x2b2b33;

/** Add the decoration of district n (2..10) to `solid`; lit bits (fairy lights) go to `glow` painted `glowColor`. */
export function drawDecor(n: number, items: readonly DecorItem[], solid: Batch, glow: Batch, glowColor: number): void {
  const L = LOOK[n]!;
  const snowShade = mixHex(SNOW_SHADE, L.accent2, 0.15);
  for (const it of items) {
    const k = it.scale;
    const cs = Math.cos(it.yaw);
    const sn = Math.sin(it.yaw);
    /** Place a primitive: local centre (lx, y, lz), local size (sx, sy, sz), extra local yaw ry. */
    const put = (b: Batch, g: THREE.BufferGeometry, color: number, lx: number, y: number, lz: number, sx: number, sy: number, sz: number, ry = 0): void => {
      b.add(g, color, it.x + (lx * cs + lz * sn) * k, y * k, it.z + (-lx * sn + lz * cs) * k, { sx: sx * k, sy: sy * k, sz: sz * k, ry: it.yaw + ry });
    };
    /** Box standing on y0 (width, height, depth). */
    const box = (color: number, lx: number, y0: number, lz: number, w: number, h: number, d: number, ry = 0): void => put(solid, BOX, color, lx, y0, lz, w, h, d, ry);
    /** Cylinder standing on y0 (radius, height; `taper` = top radius / bottom radius). */
    const cyl = (color: number, lx: number, y0: number, lz: number, r: number, h: number, taper = 1, seg = 8): void => put(solid, CYL(taper, seg), color, lx, y0 + h / 2, lz, r, h, r);
    /** Cone standing on y0. */
    const cone = (color: number, lx: number, y0: number, lz: number, r: number, h: number): void => put(solid, CONE, color, lx, y0 + h / 2, lz, r, h, r);
    /** Ellipsoid centred at y. */
    const sph = (color: number, lx: number, y: number, lz: number, rx: number, ry: number, rz: number): void => put(solid, SPH, color, lx, y, lz, rx, ry, rz);
    /** A little snow cap: a flat ellipsoid sitting on y0. */
    const cap = (lx: number, y0: number, lz: number, rx: number, rz: number, h = 0.07): void => sph(SNOW, lx, y0 + h * 0.4, lz, rx, h, rz);
    const bulb = (lx: number, y: number, lz: number): void => put(glow, SPH_S, glowColor, lx, y, lz, 0.045, 0.045, 0.045);

    switch (it.kind) {
      case 'tree': {
        // a round planter (stone / era colour with a snow lip), a trunk, then a pine stack, a round crown or blossom
        cyl(L.planter, 0, 0, 0, 0.42, 0.3, 0.88);
        cyl(SNOW, 0, 0.3, 0, 0.36, 0.05);
        cyl(0x6b4a33, 0, 0.3, 0, 0.065, 0.55);
        if (n <= 5) {
          cone(L.leaf, 0, 0.55, 0, 0.5, 0.7);
          cone(L.leaf2, 0, 0.95, 0, 0.4, 0.62);
          cone(L.leaf, 0, 1.32, 0, 0.29, 0.55);
          cone(SNOW, 0, 0.95, 0, 0.33, 0.3);
          cone(SNOW, 0, 1.32, 0, 0.23, 0.26);
          cone(SNOW, 0, 1.62, 0, 0.1, 0.18);
          for (let i = 0; i < 5; i++) bulb(Math.cos(i * 1.7) * (0.42 - i * 0.05), 0.75 + i * 0.22, Math.sin(i * 1.7) * (0.42 - i * 0.05));
        } else {
          const crown = n === 10 ? L.accent : n === 9 ? L.leaf2 : L.leaf;
          sph(crown, 0, 1.15, 0, 0.5, 0.45, 0.5);
          sph(n === 10 ? mixHex(L.accent, 0xffffff, 0.4) : L.leaf2, 0.22, 1.5, 0.05, 0.34, 0.3, 0.34);
          sph(crown, -0.2, 1.45, -0.1, 0.3, 0.28, 0.3);
          cap(0.1, 1.72, 0, 0.3, 0.26, 0.1);
          for (let i = 0; i < 5; i++) bulb(Math.cos(i * 1.7) * 0.5, 0.95 + (i % 3) * 0.25, Math.sin(i * 1.7) * 0.5);
        }
        break;
      }
      case 'hedge': {
        // a pillow of leaves with a snow cover and a few berries on the front
        box(L.planter, 0, 0, 0, 0.9, 0.12, 0.38);
        sph(L.leaf, 0, 0.3, 0, 0.45, 0.24, 0.2);
        sph(L.leaf2, -0.2, 0.34, 0.02, 0.26, 0.2, 0.19);
        cap(0.1, 0.5, 0, 0.34, 0.15, 0.08);
        for (let i = 0; i < 3; i++) put(solid, SPH_S, L.accent, -0.25 + i * 0.25, 0.3 + (i % 2) * 0.08, 0.19, 0.045, 0.045, 0.045);
        if ((it.x * 7 + it.z * 3) % 2 < 1) for (let i = 0; i < 3; i++) bulb(-0.3 + i * 0.3, 0.52, 0.12);
        break;
      }
      case 'bench': {
        const frame = n === 2 ? mixHex(L.wood, 0x000000, 0.3) : L.metal;
        const seat = n === 8 ? L.planter : L.wood;
        box(frame, -0.36, 0, 0, 0.06, 0.4, 0.34);
        box(frame, 0.36, 0, 0, 0.06, 0.4, 0.34);
        box(frame, -0.36, 0.4, -0.15, 0.06, 0.34, 0.05);
        box(frame, 0.36, 0.4, -0.15, 0.06, 0.34, 0.05);
        box(seat, 0, 0.4, 0.02, 0.9, 0.06, 0.34);
        box(seat, 0, 0.58, -0.16, 0.86, 0.2, 0.05);
        box(SNOW, 0, 0.46, 0.02, 0.8, 0.05, 0.28);
        box(SNOW, 0, 0.78, -0.16, 0.84, 0.04, 0.06);
        if (n >= 6) cyl(L.accent, 0.22, 0.5, 0.05, 0.07, 0.1); // a forgotten thermos / cup
        break;
      }
      case 'planter': {
        if (n === 2) {
          // a barrel with two hoops and a pine sprig
          cyl(L.planter, 0, 0, 0, 0.3, 0.46, 0.85);
          cyl(L.metal, 0, 0.08, 0, 0.292, 0.04, 1, 8);
          cyl(L.metal, 0, 0.32, 0, 0.268, 0.04, 1, 8);
          cyl(SNOW, 0, 0.46, 0, 0.25, 0.05);
          cone(L.leaf, 0, 0.5, 0, 0.17, 0.4);
          cone(SNOW, 0, 0.74, 0, 0.1, 0.12);
        } else {
          const round = n === 3 || n === 4 || n === 8 || n === 9;
          if (round) {
            cyl(L.planter, 0, 0, 0, 0.3, 0.36, n === 3 ? 1.35 : 1.1);
            cyl(n === 3 || n === 4 ? L.metal : L.accent2, 0, 0.32, 0, n === 3 ? 0.33 : 0.31, 0.06);
          } else {
            box(L.planter, 0, 0, 0, 0.62, 0.34, 0.3);
            box(n === 6 ? L.metal : L.accent2, 0, 0.3, 0, 0.66, 0.05, 0.34);
          }
          sph(L.leaf2, 0, 0.45, 0, round ? 0.26 : 0.3, 0.14, round ? 0.26 : 0.13);
          for (let i = 0; i < 3; i++) put(solid, SPH, i % 2 ? L.accent : L.accent2, -0.14 + i * 0.14, 0.58 + (i % 2) * 0.05, 0.02, 0.07, 0.07, 0.07);
          cap(0.0, 0.52, 0.0, round ? 0.2 : 0.26, round ? 0.2 : 0.1, 0.06);
        }
        break;
      }
      case 'postbox': {
        if (n === 2) {
          // a mailbox on a post, flag up
          box(L.wood, 0, 0, 0, 0.09, 0.6, 0.09);
          box(L.mail, 0, 0.6, 0, 0.3, 0.2, 0.2);
          sph(L.mail, 0, 0.8, 0, 0.15, 0.08, 0.1);
          box(L.accent, 0.18, 0.68, 0.02, 0.03, 0.15, 0.03);
          box(L.accent, 0.19, 0.78, 0.02, 0.09, 0.05, 0.03);
          cap(0, 0.84, 0, 0.14, 0.1, 0.05);
        } else {
          // a pillar box with a dome, a slot and a brass or white band
          cyl(L.mail, 0, 0, 0, 0.17, 0.8, 1, 8);
          cyl(n === 10 || n === 9 ? L.accent : L.metal, 0, 0.12, 0, 0.18, 0.05, 1, 8);
          sph(L.mail, 0, 0.8, 0, 0.17, 0.12, 0.17);
          box(DARK, 0, 0.56, 0.165, 0.14, 0.04, 0.02);
          cap(0, 0.9, 0, 0.14, 0.14, 0.06);
        }
        break;
      }
      case 'snowman': {
        sph(SNOW, 0, 0.2, 0, 0.27, 0.22, 0.27);
        sph(SNOW, 0, 0.55, 0, 0.2, 0.18, 0.2);
        sph(SNOW, 0, 0.82, 0, 0.15, 0.15, 0.15);
        sph(snowShade, 0, 0.02, 0, 0.27, 0.05, 0.27);
        put(solid, SPH_S, DARK, -0.055, 0.86, 0.13, 0.022, 0.022, 0.022);
        put(solid, SPH_S, DARK, 0.055, 0.86, 0.13, 0.022, 0.022, 0.022);
        put(solid, NOSE, 0xf08a2c, 0, 0.82, 0.2, 0.03, 0.03, 0.14);
        cyl(L.accent, 0, 0.66, 0, 0.17, 0.06, 1, 8); // scarf
        box(L.accent, 0.08, 0.5, 0.17, 0.06, 0.18, 0.03);
        box(0x6b4a33, -0.28, 0.5, 0, 0.22, 0.02, 0.02, 0.4);
        box(0x6b4a33, 0.28, 0.5, 0, 0.22, 0.02, 0.02, -0.4);
        if (n <= 4) {
          cyl(DARK, 0, 0.94, 0, 0.12, 0.17, 0.85); // top hat
          cyl(DARK, 0, 0.94, 0, 0.19, 0.02, 1);
        } else {
          cyl(L.accent2, 0, 0.94, 0, 0.14, 0.07, 0.85); // bobble hat
          sph(L.accent, 0, 1.05, 0, 0.05, 0.05, 0.05);
        }
        break;
      }
      case 'bin': {
        if (n <= 3) {
          // a pair of stacked crates
          box(L.wood, 0, 0, 0, 0.5, 0.34, 0.4);
          box(mixHex(L.wood, 0x000000, 0.18), 0.02, 0.34, 0, 0.36, 0.26, 0.3, 0.3);
          box(L.metal, 0, 0.14, 0.2, 0.5, 0.04, 0.02);
          cap(0.02, 0.6, 0, 0.18, 0.15, 0.06);
        } else {
          cyl(L.metal, 0, 0, 0, 0.2, 0.5, 0.92);
          cyl(mixHex(L.metal, 0xffffff, 0.25), 0, 0.5, 0, 0.22, 0.06, 0.9);
          cyl(mixHex(L.metal, 0xffffff, 0.45), 0, 0.12, 0, 0.206, 0.04);
          cap(0, 0.55, 0, 0.17, 0.17, 0.07);
        }
        break;
      }
      case 'bikeRack': {
        if (n === 2) {
          // a hitching rail
          box(L.wood, -0.38, 0, 0, 0.09, 0.62, 0.09);
          box(L.wood, 0.38, 0, 0, 0.09, 0.62, 0.09);
          box(L.wood, 0, 0.4, 0, 0.9, 0.09, 0.07);
          box(L.wood, 0, 0.22, 0, 0.8, 0.06, 0.06);
          box(SNOW, 0, 0.49, 0, 0.86, 0.04, 0.08);
          box(L.accent, 0.22, 0.34, 0.06, 0.06, 0.1, 0.03); // a red ribbon
        } else {
          for (let i = -1; i <= 1; i++) {
            box(L.metal, i * 0.3, 0, 0.12, 0.04, 0.5, 0.04);
            box(L.metal, i * 0.3, 0, -0.12, 0.04, 0.5, 0.04);
            box(L.metal, i * 0.3, 0.46, 0, 0.04, 0.04, 0.28);
          }
          if (n >= 5) {
            // a parked bike with a snowy saddle
            put(solid, WHEEL, DARK, -0.24, 0.23, 0.0, 1, 1, 1, 0);
            put(solid, WHEEL, DARK, 0.24, 0.23, 0.0, 1, 1, 1, 0);
            box(L.accent, 0, 0.23, 0, 0.5, 0.03, 0.03);
            box(L.accent, -0.05, 0.23, 0, 0.03, 0.2, 0.03);
            box(L.accent, 0.2, 0.23, 0, 0.03, 0.26, 0.03);
            box(L.accent, 0.2, 0.47, 0, 0.03, 0.03, 0.16);
            box(DARK, -0.06, 0.43, 0, 0.12, 0.04, 0.06);
            box(SNOW, -0.06, 0.47, 0, 0.11, 0.03, 0.05);
          }
        }
        break;
      }
    }
  }
}
