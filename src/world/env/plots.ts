/**
 * 0.9.7 era plots (R34, R31): the era-1-style places of every era 2..10 region, built from eras/layout.ts plotPlaces
 * once the region is bought (world/env/frontier.ts calls buildPlots on unlock), each themed on the era's resource
 * (R36) so the 0.9.8 look threads can dress them (R37). Blockout shapes in the era's colours, no textures.
 *
 * - CREW HUTS around a little green in the huts zone, one per crew role (hauler first, then config ERA_ROLES). A hut
 *   grows with its role: no worker hired = a staked foundation; 1 worker = the hut; 2 = an annex behind it; 3 = a loft
 *   and a pennant in the role's scarf colour. The huts are re-read twice a second (a debug / restored level needs no
 *   event) and re-baked only when a stage changes; a stage that grows live pops in with a puff.
 * - The MARKET STREET across the back of the market: paving, shopfronts with lit windows and striped awnings, one open
 *   stall with crates of the era's goods, lamps along the kerb.
 * - The PROCESSING YARD gets a paved floor with the machine cells marked (the whole room grid, so later slots too).
 * - The HARVEST FIELD gets beds of the era's raw resource east of the hand node (pellet ridges, copper outcrops, pale
 *   dunes, lavender geodes ...).
 *
 * Draw calls per bought region: statics 1 + glow 1 + huts 1 (+ glow 1) + lamp bulbs 1. Nothing tall stands between
 * a pad and the camera (tests/plotPlaces.test.ts checks every solid's camera shadow against every pad and counter).
 */
import * as THREE from 'three';
import { ERA_CREW_COUNT, ERA_ROLES, eraRoleCount, PALETTE, type Rect } from '../../config';
import { ERAS } from '../../eras/data';
import { HUT_ANNEX, plotPlaces, regionLayout, type HutPlace, type PlotPlaces, type ShopPlace } from '../../eras/layout';
import type { GameContext, UpgradeId } from '../../core/types';
import type { ColliderHandle } from '../Colliders';
import { Batch } from '../../render/batch';
import { geo } from '../../render/materials';
import { bulbMaterial } from './glow';
import { Rng } from './common';

/** Tallest a hut gets (loft + pennant) and the tallest shopfront (sign included), metres. */
export const HUT_MAX_H = 4.6;
export const SHOP_MAX_H = 4.4;

type HutKind = 'cabin' | 'cottage' | 'row' | 'bunk' | 'deco' | 'trailer' | 'modular' | 'quonset' | 'pod';
type BedKind = 'slabs' | 'pools' | 'heaps' | 'ridges' | 'crystals' | 'dunes' | 'vents';
type GreenKind = 'fire' | 'well' | 'brazier' | 'lamps' | 'kiosk' | 'fountain' | 'orb';

interface PlotStyle {
  hut: HutKind;
  wall: number;
  roof: number;
  /** Shopfront walls and roofs. */
  shop: number;
  shopRoof: number;
  /** Street paving, yard paving, cell lines. */
  street: number;
  pave: number;
  line: number;
  green: GreenKind;
  /** The two resource beds of the harvest field (alternating rows): shape and colour; `glow` lights the second. */
  beds: [BedKind, number, BedKind, number];
  glow?: boolean;
}

/**
 * Per era, themed on its resource (audit-1.0/era-resources-v2.md): 2 granite + clay, 3 ore + charcoal, 4 scrap + coal,
 * 5 iron pellets + coke, 6 copper + quartz, 7 crude + gas, 8 silica + gold, 9 uranium + graphite, 10 rare earth +
 * helium-3. Warm, never near-black (DIRECTION.md).
 */
const STYLE: readonly (PlotStyle | null)[] = [
  null,
  null,
  { hut: 'cabin', wall: 0x9a7350, roof: 0x7a5a48, shop: 0xc9b9a0, shopRoof: 0x8e6a52, street: 0xb7aea0, pave: 0xc3bcb0, line: 0xa69c8e, green: 'fire', beds: ['slabs', 0xbab4aa, 'pools', 0xc27a56] },
  { hut: 'cottage', wall: 0xb3aa9c, roof: 0x6d7378, shop: 0xa8836a, shopRoof: 0x5f6870, street: 0xa89c92, pave: 0xb8afa6, line: 0x978b80, green: 'well', beds: ['heaps', 0xa65a3e, 'heaps', 0x7a6c64] },
  { hut: 'row', wall: 0xa85a43, roof: 0x5e6266, shop: 0xb5664c, shopRoof: 0x585d61, street: 0x9c948d, pave: 0xaaa39c, line: 0x8a827b, green: 'brazier', beds: ['heaps', 0x9c8b7b, 'heaps', 0x675d58] },
  { hut: 'bunk', wall: 0x7d8c96, roof: 0xb4553a, shop: 0x8a98a2, shopRoof: 0xc0673e, street: 0x8d9095, pave: 0x9fa3a8, line: 0x7f8388, green: 'brazier', beds: ['ridges', 0xb4553a, 'heaps', 0x6f6460], glow: true },
  { hut: 'deco', wall: 0xd8cbb2, roof: 0x4c7a74, shop: 0xe0d2b8, shopRoof: 0x3f706a, street: 0x96a09c, pave: 0xa8b0ac, line: 0x8a9490, green: 'lamps', beds: ['crystals', 0x5fae96, 'crystals', 0xe4eef2] },
  { hut: 'trailer', wall: 0xe3c07a, roof: 0xc44536, shop: 0xe6d3a8, shopRoof: 0xc44536, street: 0x8e8e8e, pave: 0xa3a19c, line: 0x86847f, green: 'brazier', beds: ['pools', 0x5a4c45, 'vents', 0xd99b26], glow: true },
  { hut: 'modular', wall: 0xeee8d8, roof: 0x5c9aa0, shop: 0xf0eadb, shopRoof: 0x45858c, street: 0xc9c8c2, pave: 0xd6d4cc, line: 0xb8b6ae, green: 'kiosk', beds: ['dunes', 0xeee2c2, 'pools', 0xe5c05a] },
  { hut: 'quonset', wall: 0xdfe6e8, roof: 0x5bb391, shop: 0xe4eaec, shopRoof: 0x4ea885, street: 0xb7c2c6, pave: 0xc6d0d3, line: 0xa5b1b5, green: 'fountain', beds: ['crystals', 0x86e8c4, 'slabs', 0x8a8684], glow: true },
  { hut: 'pod', wall: 0xf6f1e7, roof: 0xb9a3e8, shop: 0xf3eee6, shopRoof: 0xa58fd6, street: 0xd4d6e0, pave: 0xe0e1ea, line: 0xc4c6d4, green: 'orb', beds: ['crystals', 0xb9a3e8, 'vents', 0xe6f2ff], glow: true },
];

const SNOW = PALETTE.snow;
const CREAM = 0xfff3dc;
const WINDOW = 0xffd88a;
const DOOR_D = 0.08;

const mix = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const shade = (c: number, k: number): number => {
  const col = new THREE.Color(c);
  col.r = Math.min(1, col.r * k);
  col.g = Math.min(1, col.g * k);
  col.b = Math.min(1, col.b * k);
  return col.getHex();
};

// ---------------------------------------------------------------------------------------------------------------------
// pure: the solids (footprint + height) the tests check against every pad
// ---------------------------------------------------------------------------------------------------------------------

export interface PlaceSolid {
  what: string;
  r: Rect;
  h: number;
}

const box = (x: number, z: number, hx: number, hz: number): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });

/** World footprint of a hut at its biggest (body + annex behind it). */
export function hutFootprint(h: HutPlace, annex: boolean): Rect {
  // the body is w across its door side and d deep; a hut turned to face ±X lies the other way round
  const r = h.backX !== 0 ? box(h.x, h.z, h.d / 2, h.w / 2) : box(h.x, h.z, h.w / 2, h.d / 2);
  if (!annex) return r;
  return annexRect(h, r);
}

/** The strip the annex adds behind a hut's body rect `r`. Added to `r` (the union), not on its own. */
function annexRect(h: HutPlace, r: Rect): Rect {
  if (h.backX < 0) return { ...r, minX: r.minX - HUT_ANNEX };
  if (h.backX > 0) return { ...r, maxX: r.maxX + HUT_ANNEX };
  if (h.backZ < 0) return { ...r, minZ: r.minZ - HUT_ANNEX };
  return { ...r, maxZ: r.maxZ + HUT_ANNEX };
}

/** Only the annex strip behind a hut (its own collider). */
function annexOnly(h: HutPlace): Rect {
  const r = hutFootprint(h, false);
  if (h.backX < 0) return { ...r, maxX: r.minX, minX: r.minX - HUT_ANNEX };
  if (h.backX > 0) return { ...r, minX: r.maxX, maxX: r.maxX + HUT_ANNEX };
  if (h.backZ < 0) return { ...r, maxZ: r.minZ, minZ: r.minZ - HUT_ANNEX };
  return { ...r, minZ: r.maxZ, maxZ: r.maxZ + HUT_ANNEX };
}

/** Footprint of a shopfront (or the stall's counter + awning posts). */
export function shopFootprint(s: ShopPlace): Rect {
  return box(s.x, s.z, s.w / 2, s.d / 2);
}

/** Centre piece of the crew green. */
function greenCentre(P: PlotPlaces): { x: number; z: number } {
  return { x: (P.green.minX + P.green.maxX) / 2, z: (P.green.minZ + P.green.maxZ) / 2 };
}

/** Every solid a region's places add at full growth (pure; tests/plotPlaces.test.ts). */
export function placeSolids(n: number): PlaceSolid[] {
  const P = plotPlaces(n);
  const out: PlaceSolid[] = [];
  for (const h of P.huts) out.push({ what: `hut ${h.role}`, r: hutFootprint(h, true), h: HUT_MAX_H });
  for (const s of P.shops) out.push({ what: s.stall ? 'street stall' : 'shop', r: shopFootprint(s), h: s.h + 0.9 });
  for (const l of P.lamps) out.push({ what: 'lamp', r: box(l.x, l.z, 0.2, 0.2), h: 3.2 });
  const g = greenCentre(P);
  out.push({ what: 'green centre', r: box(g.x, g.z, 0.9, 0.9), h: 2.2 });
  for (const b of P.beds) out.push({ what: 'bed', r: b, h: 1.0 });
  return out;
}

/** Workers a crew role has (0..3): the hauler crew from ERA_CREW_COUNT, the six roles from eraRoleCount. */
export function hutStage(role: number, level: number): number {
  if (role === 0) return Math.min(3, ERA_CREW_COUNT[Math.min(level, ERA_CREW_COUNT.length - 1)] ?? 0);
  return Math.min(3, eraRoleCount(level));
}

// ---------------------------------------------------------------------------------------------------------------------
// building helpers
// ---------------------------------------------------------------------------------------------------------------------

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _f = new THREE.Matrix4();

/** Adds parts in a local frame (origin on the floor, local +Z = front) placed at (x, z) turned by `yaw`. */
class Frame {
  private readonly frame = new THREE.Matrix4();
  constructor(
    readonly batch: Batch,
    x: number,
    z: number,
    yaw: number,
  ) {
    this.frame.makeRotationY(yaw).setPosition(x, 0, z);
  }
  put(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o?: { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }): this {
    _e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0);
    _q.setFromEuler(_e);
    _s.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    _f.multiplyMatrices(this.frame, _m);
    this.batch.addMatrix(g, color, _f);
    return this;
  }
  /** A gable roof over a w × d box whose walls end at `y`: ridge along local X, slopes toward ±Z. */
  gable(w: number, d: number, y: number, rise: number, color: number, snow = true): this {
    const half = d / 2 + 0.22;
    const slope = Math.hypot(half, rise);
    const a = Math.atan2(rise, half);
    for (const s of [1, -1]) {
      this.put(geo.box(w + 0.4, 0.14, slope), color, 0, y + rise / 2, (s * half) / 2, { rx: s * a });
      if (snow) this.put(geo.box(w + 0.42, 0.06, slope * 0.8), SNOW, 0, y + rise / 2 + 0.1, (s * half) / 2 - s * 0.05, { rx: s * a });
    }
    // gable ends
    this.put(geo.box(0.12, rise * 0.9, d * 0.7), color, w / 2 - 0.02, y + rise * 0.35, 0);
    this.put(geo.box(0.12, rise * 0.9, d * 0.7), color, -w / 2 + 0.02, y + rise * 0.35, 0);
    return this;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// crew huts
// ---------------------------------------------------------------------------------------------------------------------

/** One hut at `stage` (1..3) into `body` (solid) and `glow` (lit windows). Stage 0 draws the foundation only. */
function buildHut(body: Batch, glow: Batch, st: PlotStyle, h: HutPlace, stage: number, accent: number): void {
  const f = new Frame(body, h.x, h.z, h.yaw);
  const g = new Frame(glow, h.x, h.z, h.yaw);
  const w = h.w;
  const d = h.d;
  const scarf = h.role === 0 ? accent : ERA_ROLES[h.role - 1]!.scarf;
  if (stage <= 0) {
    // staked foundation: a low sill frame and four stakes with ribbons in the role's colour
    const sill = shade(st.wall, 0.8);
    f.put(geo.box(w, 0.14, 0.18), sill, 0, 0.07, d / 2).put(geo.box(w, 0.14, 0.18), sill, 0, 0.07, -d / 2);
    f.put(geo.box(0.18, 0.14, d), sill, w / 2, 0.07, 0).put(geo.box(0.18, 0.14, d), sill, -w / 2, 0.07, 0);
    for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]] as const) {
      f.put(geo.box(0.08, 0.8, 0.08), 0x8a6a46, x, 0.4, z).put(geo.box(0.26, 0.14, 0.03), scarf, x + 0.12, 0.7, z);
    }
    return;
  }
  const wall = st.wall;
  const roof = st.roof;
  const wh = 2.1; // wall height
  const door = (y0: number, z: number): void => {
    f.put(geo.box(0.8, 1.45, DOOR_D), scarf, 0, y0 + 0.72, z);
    f.put(geo.box(1.0, 0.1, 0.25), shade(wall, 0.75), 0, y0 + 1.5, z + 0.08);
  };
  const windows = (y: number, z: number, xs: number[], s = 0.62): void => {
    for (const x of xs) {
      f.put(geo.box(s + 0.14, s + 0.14, 0.06), shade(wall, 0.7), x, y, z);
      g.put(geo.box(s, s, 0.05), WINDOW, x, y, z + 0.03);
    }
  };
  // ---- the hut body
  switch (st.hut) {
    case 'cabin':
    case 'cottage':
    case 'row':
    case 'bunk': {
      const pitch = st.hut === 'bunk' ? 0.55 : st.hut === 'row' ? 0.95 : 1.15;
      f.put(geo.boxBase(w + 0.2, 0.22, d + 0.2), st.hut === 'cabin' ? 0x8e8a82 : shade(wall, 0.8), 0, 0, 0);
      f.put(geo.boxBase(w, wh, d), wall, 0, 0.22, 0);
      if (st.hut === 'cabin') for (let y = 0.5; y < wh; y += 0.42) f.put(geo.box(w + 0.06, 0.07, d + 0.06), shade(wall, 0.82), 0, 0.22 + y, 0);
      if (st.hut === 'bunk') for (let x = -w / 2 + 0.3; x < w / 2; x += 0.45) f.put(geo.box(0.06, wh, 0.04), shade(wall, 0.86), x, 0.22 + wh / 2, d / 2 + 0.01);
      f.gable(w, d, 0.22 + wh, pitch, roof);
      door(0.22, d / 2);
      windows(1.45, d / 2, [-w / 2 + 0.75, w / 2 - 0.75]);
      // chimney (the bunkhouse has a stove pipe)
      if (st.hut === 'bunk') f.put(geo.cylinder(0.12, 0.12, 1.2, 8), 0x9aa3aa, w / 2 - 0.7, 0.22 + wh + 0.6, -d / 4);
      else f.put(geo.boxBase(0.5, 1.5, 0.5), st.hut === 'row' ? shade(wall, 0.85) : 0x9a948a, w / 2 - 0.7, 0.22 + wh, -d / 4).put(geo.box(0.6, 0.08, 0.6), SNOW, w / 2 - 0.7, 0.22 + wh + 1.52, -d / 4);
      break;
    }
    case 'deco': {
      f.put(geo.boxBase(w + 0.2, 0.2, d + 0.2), shade(wall, 0.85), 0, 0, 0);
      f.put(geo.boxBase(w - 0.9, wh + 0.2, d), wall, -0.45, 0.2, 0);
      f.put(geo.cylinder(0.9, 0.9, wh + 0.2, 16), wall, w / 2 - 0.9, 0.2 + (wh + 0.2) / 2, d / 2 - 0.9);
      f.put(geo.boxBase(w - 0.9, 0.2, d), wall, -0.45, 0.2, 0);
      f.put(geo.boxBase(w + 0.1, 0.24, d + 0.1), roof, 0, 0.4 + wh, 0);
      f.put(geo.boxBase(w * 0.5, 0.4, 0.3), roof, -w * 0.1, 0.64 + wh, d / 2 - 0.15);
      f.put(geo.box(w + 0.12, 0.06, d + 0.12), SNOW, 0, 0.67 + wh, 0);
      door(0.2, d / 2);
      windows(1.4, d / 2, [-w / 2 + 0.7]);
      g.put(geo.cylinder(0.45, 0.45, 0.6, 12), WINDOW, w / 2 - 0.9, 1.4, d / 2 - 0.9, { sx: 1.0 });
      break;
    }
    case 'trailer': {
      for (const x of [-w / 2 + 0.6, w / 2 - 0.6]) f.put(geo.box(0.3, 0.3, d - 0.4), 0x9b8f84, x, 0.15, 0);
      f.put(geo.boxBase(w - 0.6, wh, d - 0.2), wall, 0, 0.3, 0);
      for (const x of [-(w - 0.6) / 2, (w - 0.6) / 2]) f.put(geo.cylinder((d - 0.2) / 2, (d - 0.2) / 2, wh, 14), wall, x, 0.3 + wh / 2, 0, { sx: 0.35 });
      f.put(geo.box(w - 0.4, 0.18, d - 0.1), roof, 0, 0.3 + wh + 0.09, 0);
      f.put(geo.box(w - 0.4, 0.06, d - 0.15), SNOW, 0, 0.3 + wh + 0.21, 0);
      f.put(geo.box(w - 0.5, 0.18, 0.04), roof, 0, 1.2, d / 2 - 0.08);
      door(0.3, d / 2 - 0.1);
      windows(1.55, d / 2 - 0.1, [-w / 2 + 1.0, w / 2 - 1.0], 0.5);
      f.put(geo.boxBase(0.9, 0.3, 0.5), 0x9b8f84, 0, 0, d / 2 + 0.2);
      break;
    }
    case 'modular': {
      f.put(geo.boxBase(w + 0.2, 0.18, d + 0.2), 0xc9c8c2, 0, 0, 0);
      f.put(geo.boxBase(w, wh + 0.2, d), wall, 0, 0.18, 0);
      f.put(geo.box(w + 0.1, 0.16, d + 0.1), roof, 0, 0.18 + wh + 0.28, 0);
      f.put(geo.box(w + 0.1, 0.05, d + 0.1), SNOW, 0, 0.18 + wh + 0.39, 0);
      f.put(geo.boxBase(0.9, 0.5, 0.7), 0xb8bec4, -w / 4, 0.18 + wh + 0.36, -d / 4);
      door(0.18, d / 2);
      f.put(geo.box(1.9, 0.9, 0.06), shade(roof, 0.9), w / 2 - 1.3, 1.45, d / 2);
      g.put(geo.box(1.75, 0.76, 0.05), 0xbfeff0, w / 2 - 1.3, 1.45, d / 2 + 0.03);
      break;
    }
    case 'quonset': {
      f.put(geo.boxBase(w + 0.2, 0.18, d + 0.2), 0xb5bfc3, 0, 0, 0);
      f.put(geo.cylinder(d / 2, d / 2, w, 18), wall, 0, 0.18, 0, { rz: Math.PI / 2 });
      for (let x = -w / 2 + 0.4; x < w / 2; x += 0.7) f.put(geo.torus(d / 2 + 0.01, 0.03, 6, 20), shade(wall, 0.86), x, 0.18, 0, { ry: Math.PI / 2 });
      f.put(geo.box(w * 0.8, 0.08, 0.5), roof, 0, 0.18 + d / 2 + 0.02, 0);
      f.put(geo.box(1.2, 1.5, 0.12), wall, 0, 0.18 + 0.75, d / 2 - 0.2);
      door(0.18, d / 2 - 0.12);
      windows(1.15, d / 2 - 0.4, [-w / 2 + 0.9, w / 2 - 0.9], 0.45);
      break;
    }
    case 'pod': {
      const r = Math.min(w, d) / 2 + 0.2;
      f.put(geo.cylinder(r + 0.25, r + 0.35, 0.22, 20), 0xd9dae6, 0, 0.11, 0);
      f.put(geo.cylinder(r, r, 0.8, 20), wall, 0, 0.62, 0);
      f.put(geo.sphere(r, 20, 10), wall, 0, 1.02, 0, { sy: 0.85 });
      f.put(geo.torus(r + 0.02, 0.07, 8, 28), roof, 0, 1.02, 0, { rx: Math.PI / 2 });
      f.put(geo.box(0.9, 1.5, 0.3), wall, 0, 0.97, r - 0.05);
      door(0.22, r + 0.1);
      g.put(geo.cylinder(0.32, 0.32, 0.06, 14), 0xe6dcff, -r * 0.62, 1.35, r * 0.62, { rx: Math.PI / 2, ry: -Math.PI / 4 });
      g.put(geo.cylinder(0.32, 0.32, 0.06, 14), 0xe6dcff, r * 0.62, 1.35, r * 0.62, { rx: Math.PI / 2, ry: Math.PI / 4 });
      break;
    }
  }
  // ---- stage 2: the annex behind the hut (a lean-to shed / extra unit)
  if (stage >= 2) {
    const aw = w * 0.7;
    const az = -d / 2 - HUT_ANNEX / 2 + 0.05;
    f.put(geo.boxBase(aw, 1.6, HUT_ANNEX - 0.1), shade(wall, 0.92), -w / 2 + aw / 2 + 0.1, 0.1, az);
    f.put(geo.box(aw + 0.3, 0.12, HUT_ANNEX + 0.2), roof, -w / 2 + aw / 2 + 0.1, 1.78, az, { rx: -0.22 });
    f.put(geo.box(aw + 0.3, 0.05, HUT_ANNEX), SNOW, -w / 2 + aw / 2 + 0.1, 1.86, az, { rx: -0.22 });
    // a woodpile / supply crates by the annex, in the era's resource colour
    f.put(geo.boxBase(0.7, 0.55, 0.6), st.beds[1], w / 2 - 0.5, 0, az).put(geo.boxBase(0.5, 0.4, 0.5), st.beds[3], w / 2 - 0.5, 0.55, az);
  }
  // ---- stage 3: a loft / roof extra and the role's pennant
  if (stage >= 3) {
    const top = st.hut === 'pod' ? 2.0 : st.hut === 'quonset' ? h.d / 2 + 0.2 : st.hut === 'bunk' ? 2.9 : st.hut === 'trailer' || st.hut === 'modular' || st.hut === 'deco' ? 2.7 : 3.2;
    if (st.hut === 'modular' || st.hut === 'deco' || st.hut === 'trailer') {
      // a roof room
      f.put(geo.boxBase(w * 0.45, 0.9, d * 0.55), shade(wall, 0.96), -w / 4, top - 0.1, -d / 8);
      f.put(geo.box(w * 0.5, 0.1, d * 0.6), roof, -w / 4, top + 0.85, -d / 8);
      g.put(geo.box(0.5, 0.4, 0.05), WINDOW, -w / 4, top + 0.35, -d / 8 + d * 0.275 + 0.03);
    } else if (st.hut !== 'pod' && st.hut !== 'quonset') {
      // a dormer
      f.put(geo.boxBase(1.0, 0.7, 0.9), wall, -w / 4, top - 0.75, d / 4);
      f.put(geo.box(1.2, 0.1, 1.05), roof, -w / 4, top, d / 4);
      g.put(geo.box(0.45, 0.36, 0.05), WINDOW, -w / 4, top - 0.4, d / 4 + 0.46);
    } else {
      // a dish / antenna
      f.put(geo.cylinder(0.05, 0.05, 0.8, 6), 0x9aa3aa, w / 4, top + 0.3, 0).put(geo.sphere(0.35, 12, 6), 0xe0e4ea, w / 4, top + 0.75, 0, { sy: 0.4 });
    }
    // pennant pole with the role's scarf colour
    const px = st.hut === 'pod' ? 0 : w / 2 - 0.25;
    const base = st.hut === 'pod' ? 1.9 : top;
    f.put(geo.cylinder(0.04, 0.04, HUT_MAX_H - 0.2 - base, 6), 0xd6cbb6, px, base + (HUT_MAX_H - 0.2 - base) / 2, 0);
    f.put(geo.box(0.04, 0.32, 0.5), scarf, px, HUT_MAX_H - 0.42, 0.27);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// market street, yard, field, green
// ---------------------------------------------------------------------------------------------------------------------

function buildShop(body: Batch, glow: Batch, st: PlotStyle, s: ShopPlace, i: number, accent: number, goods: [number, number]): void {
  const f = new Frame(body, s.x, s.z, s.yaw);
  const g = new Frame(glow, s.x, s.z, s.yaw);
  const w = s.w;
  const d = s.d;
  const stripe = (y: number, z: number, depth: number, tilt: number): void => {
    const n = Math.max(4, Math.round(w / 0.55));
    for (let k = 0; k < n; k++) f.put(geo.box(w / n, 0.06, depth), k % 2 ? CREAM : accent, -w / 2 + ((k + 0.5) * w) / n, y, z, { rx: tilt });
  };
  if (s.stall) {
    // open-air stall: four posts, a striped awning, a counter with crates of the era's goods
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) for (const z of [-d / 2 + 0.3, d / 2 - 0.3]) f.put(geo.boxBase(0.14, s.h, 0.14), shade(st.shopRoof, 0.9), x, 0, z);
    stripe(s.h + 0.05, 0, d + 0.3, 0.12);
    f.put(geo.box(w + 0.1, 0.05, d + 0.2), SNOW, 0, s.h + 0.16, -0.02, { rx: 0.12 });
    f.put(geo.boxBase(w - 0.5, 0.95, 0.8), st.shop, 0, 0, d / 2 - 0.7);
    f.put(geo.box(w - 0.4, 0.08, 0.95), shade(st.shopRoof, 1.1), 0, 0.99, d / 2 - 0.7);
    for (let k = 0; k < 4; k++) f.put(geo.boxBase(0.5, 0.32, 0.45), goods[k % 2]!, -w / 2 + 0.7 + k * ((w - 1.4) / 3), 1.03, d / 2 - 0.7);
    for (let k = 0; k < 3; k++) f.put(geo.boxBase(0.6, 0.55, 0.55), shade(goods[(k + 1) % 2]!, 0.95), -w / 2 + 0.8 + k * 0.75, 0, -d / 2 + 0.6);
    return;
  }
  const h = s.h;
  const wall = i % 2 ? st.shop : mix(st.shop, accent, 0.18);
  f.put(geo.boxBase(w, h, d), wall, 0, 0, 0);
  // roof: flat with a cornice (later eras) or a shallow gable (eras 2-5)
  if (st.hut === 'cabin' || st.hut === 'cottage' || st.hut === 'row' || st.hut === 'bunk') f.gable(w, d, h, 0.7, st.shopRoof);
  else {
    f.put(geo.box(w + 0.2, 0.2, d + 0.2), st.shopRoof, 0, h + 0.1, 0);
    f.put(geo.box(w + 0.22, 0.05, d + 0.22), SNOW, 0, h + 0.22, 0);
  }
  // shop window + door, a sign board, a striped awning over the window
  f.put(geo.box(w - 0.5, 1.4, 0.08), shade(wall, 0.72), -0.35, 1.25, d / 2);
  g.put(geo.box(w - 1.7, 1.15, 0.06), WINDOW, -0.85, 1.25, d / 2 + 0.03);
  f.put(geo.box(0.8, 1.6, 0.1), shade(st.shopRoof, 0.95), w / 2 - 0.75, 0.8, d / 2 + 0.01);
  f.put(geo.box(w * 0.7, 0.5, 0.1), CREAM, 0, h - 0.45, d / 2 + 0.03);
  f.put(geo.box(w * 0.5, 0.14, 0.04), accent, 0, h - 0.45, d / 2 + 0.09);
  stripe(2.25, d / 2 + 0.45, 0.95, 0.38);
  // goods outside: a crate and a barrel in the era's resource colours
  f.put(geo.boxBase(0.5, 0.45, 0.45), goods[i % 2]!, -w / 2 + 0.4, 0, d / 2 + 0.45);
  f.put(geo.cylinder(0.22, 0.22, 0.6, 10), goods[(i + 1) % 2]!, -w / 2 + 0.95, 0.3, d / 2 + 0.4);
}

/** A rounded heap / ridge / crystal / pool along a bed rect (rows along X). */
function buildBed(body: Batch, glow: Batch, kind: BedKind, color: number, r: Rect, rng: Rng, lit: boolean): void {
  const cz = (r.minZ + r.maxZ) / 2;
  const dz = r.maxZ - r.minZ;
  const len = r.maxX - r.minX;
  // a raked strip under every bed
  body.add(geo.box(len, 0.02, dz + 0.3), mix(color, SNOW, 0.72), (r.minX + r.maxX) / 2, 0.02, cz);
  const glowTo = lit ? glow : body;
  switch (kind) {
    case 'ridges':
    case 'dunes': {
      const seg = Math.max(1, Math.round(len / 6));
      for (let k = 0; k < seg; k++) {
        const x = r.minX + ((k + 0.5) * len) / seg;
        const sx = len / seg / 2 - 0.2;
        body.add(geo.sphere(1, 14, 8), color, x, 0, cz, { sx, sy: kind === 'dunes' ? 0.55 : 0.7, sz: dz / 2 + (kind === 'dunes' ? 0.3 : 0) });
        body.add(geo.sphere(1, 12, 6), mix(color, SNOW, 0.75), x, 0.12, cz - dz * 0.05, { sx: sx * 0.6, sy: kind === 'dunes' ? 0.42 : 0.6, sz: dz * 0.25 });
      }
      if (lit) for (let x = r.minX + 1; x < r.maxX - 1; x += rng.range(1.5, 2.6)) glow.add(geo.sphere(0.09, 6, 4), 0xffa45a, x, 0.55, cz + dz * 0.35);
      break;
    }
    case 'heaps': {
      for (let x = r.minX + 0.9; x < r.maxX - 0.8; x += rng.range(1.6, 2.4)) {
        const s = rng.range(0.6, 0.85);
        body.add(geo.sphere(1, 12, 7), color, x, 0, cz + rng.range(-0.15, 0.15), { sx: s, sy: s * 0.85, sz: Math.min(s, dz / 2 + 0.1) });
        body.add(geo.sphere(0.6, 10, 5), mix(color, SNOW, 0.8), x, s * 0.5, cz, { sx: s * 0.7, sy: 0.4, sz: s * 0.7 });
      }
      break;
    }
    case 'slabs': {
      for (let x = r.minX + 0.7; x < r.maxX - 0.6; x += rng.range(1.2, 1.7)) body.add(geo.boxBase(rng.range(0.8, 1.1), rng.range(0.14, 0.3), dz * 0.85), shade(color, rng.range(0.92, 1.06)), x, 0, cz, { ry: rng.range(-0.2, 0.2) });
      break;
    }
    case 'pools': {
      for (let x = r.minX + 1.2; x < r.maxX - 1; x += rng.range(2.6, 3.4)) {
        const s = rng.range(0.8, 1.05);
        body.add(geo.cylinder(1, 1.05, 0.12, 18), mix(color, SNOW, 0.45), x, 0.06, cz, { sx: s * 1.15, sz: (dz / 2) * 0.95 });
        glowTo.add(geo.cylinder(1, 1, 0.04, 18), color, x, 0.13, cz, { sx: s * 0.95, sz: (dz / 2) * 0.72 });
      }
      break;
    }
    case 'crystals': {
      for (let x = r.minX + 0.6; x < r.maxX - 0.5; x += rng.range(0.9, 1.5)) {
        const hgt = rng.range(0.5, 0.95);
        glowTo.add(geo.cylinder(0.02, 0.2, hgt, 6), color, x, hgt / 2, cz + rng.range(-0.25, 0.25), { rz: rng.range(-0.3, 0.3), rx: rng.range(-0.3, 0.3) });
        body.add(geo.dodecahedron(0.18), mix(color, 0x8a8684, 0.35), x + 0.2, 0.08, cz + 0.2);
      }
      break;
    }
    case 'vents': {
      for (let x = r.minX + 1; x < r.maxX - 0.9; x += rng.range(2.2, 3.0)) {
        body.add(geo.cylinder(0.42, 0.55, 0.35, 12), mix(color, 0x8a8684, 0.35), x, 0.17, cz);
        glowTo.add(geo.cylinder(0.3, 0.3, 0.04, 12), color, x, 0.37, cz);
        body.add(geo.boxBase(0.12, 0.7, 0.12), shade(color, 0.7), x + 0.55, 0, cz - 0.2);
      }
      break;
    }
  }
}

function buildGreen(body: Batch, glow: Batch, st: PlotStyle, P: PlotPlaces, accent: number, glowColor: number): void {
  const G = P.green;
  const c = greenCentre(P);
  // a soft lawn of trodden snow with a ring path round the centre
  body.add(geo.box(G.maxX - G.minX, 0.015, G.maxZ - G.minZ), mix(st.pave, 0xf4f8ff, 0.55), c.x, 0.025, c.z);
  body.add(geo.ringGround(1.5, 2.2, 28), st.pave, c.x, 0.035, c.z);
  // benches either side
  for (const s of [-1, 1]) {
    body.add(geo.boxBase(1.6, 0.1, 0.45), shade(st.wall, 0.85), c.x + s * 3.2, 0.42, c.z);
    for (const x of [-0.6, 0.6]) body.add(geo.boxBase(0.1, 0.42, 0.4), shade(st.wall, 0.7), c.x + s * 3.2 + x, 0, c.z);
  }
  switch (st.green) {
    case 'fire':
      for (let k = 0; k < 8; k++) body.add(geo.dodecahedron(0.22), 0x9a948a, c.x + Math.cos((k / 8) * 6.28) * 0.7, 0.12, c.z + Math.sin((k / 8) * 6.28) * 0.7);
      for (let k = 0; k < 3; k++) body.add(geo.cylinder(0.08, 0.08, 0.9, 6), 0x8a6a46, c.x, 0.25, c.z, { rz: 1.2, ry: (k / 3) * 3.14 });
      glow.add(geo.cone(0.35, 0.7, 8), glowColor, c.x, 0.5, c.z);
      break;
    case 'well':
      body.add(geo.cylinder(0.8, 0.85, 0.8, 14), 0xa69c90, c.x, 0.4, c.z);
      for (const x of [-0.7, 0.7]) body.add(geo.boxBase(0.12, 1.7, 0.12), 0x7a5a48, c.x + x, 0.8, c.z);
      body.add(geo.box(1.7, 0.12, 0.8), st.roof, c.x, 2.15, c.z, { rx: 0.2 });
      break;
    case 'brazier':
      body.add(geo.cylinder(0.45, 0.32, 0.8, 12), shade(accent, 0.8), c.x, 0.4, c.z);
      glow.add(geo.cone(0.38, 0.6, 8), glowColor, c.x, 1.05, c.z);
      break;
    case 'lamps':
      for (const [dx, dz] of [[-0.8, 0], [0.8, 0], [0, 0.8]] as const) {
        body.add(geo.cylinder(0.05, 0.07, 1.9, 6), 0x3f706a, c.x + dx, 0.95, c.z + dz);
        glow.add(geo.sphere(0.2, 10, 8), glowColor, c.x + dx, 2.0, c.z + dz);
      }
      break;
    case 'kiosk':
      body.add(geo.boxBase(1.3, 1.6, 1.0), st.wall, c.x, 0, c.z);
      glow.add(geo.box(0.9, 0.6, 0.05), 0x9fe8d8, c.x, 1.1, c.z + 0.52);
      body.add(geo.box(1.5, 0.12, 1.2), st.roof, c.x, 1.66, c.z);
      break;
    case 'fountain':
      body.add(geo.cylinder(1.1, 1.2, 0.4, 18), 0xc6d0d3, c.x, 0.2, c.z);
      glow.add(geo.cylinder(0.95, 0.95, 0.05, 18), glowColor, c.x, 0.41, c.z);
      body.add(geo.cylinder(0.15, 0.2, 1.3, 8), 0xdfe6e8, c.x, 0.65, c.z);
      glow.add(geo.sphere(0.25, 10, 8), glowColor, c.x, 1.4, c.z);
      break;
    case 'orb':
      body.add(geo.cylinder(0.6, 0.75, 0.35, 16), 0xd9dae6, c.x, 0.17, c.z);
      body.add(geo.torus(0.7, 0.06, 6, 24), accent, c.x, 1.3, c.z, { rx: Math.PI / 2 });
      glow.add(geo.sphere(0.45, 14, 10), mix(glowColor, 0xb9a3e8, 0.5), c.x, 1.3, c.z);
      break;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// the runtime part
// ---------------------------------------------------------------------------------------------------------------------

const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const POLL = 0.5;

export interface PlotsPart {
  readonly group: THREE.Group;
  update(dt: number): void;
}

/**
 * Build era n's places into `parent` (call once, when the region is bought). `instant`: a restored game, no pops.
 * Colliders: huts (as they grow), shopfronts, the stall's counter and the green's centre piece.
 */
export function buildPlots(ctx: GameContext, n: number, parent: THREE.Object3D): PlotsPart {
  const e = ERAS[n]!;
  const st = STYLE[n]!;
  const P = plotPlaces(n);
  const L = regionLayout(n);
  const group = new THREE.Group();
  group.name = `region${n}:places`;
  parent.add(group);
  const rng = new Rng(9100 + n * 37);
  const goods: [number, number] = [st.beds[1], st.beds[3]];

  // ---- statics: yard floor, street, shops, lamps, field, green
  const body = new Batch();
  const glow = new Batch();
  const Y = P.yardPave;
  body.add(geo.box(Y.maxX - Y.minX, 0.02, Y.maxZ - Y.minZ), st.pave, (Y.minX + Y.maxX) / 2, 0.022, (Y.minZ + Y.maxZ) / 2);
  // machine cells (room grid): thin lines on the paving, one cell per slot
  {
    const def = L.slots[0];
    if (def) {
      const z0 = Math.min(Y.minZ, Y.maxZ);
      for (let x = Y.minX; x <= Y.maxX + 0.01; x += L.cell) body.add(geo.box(0.1, 0.01, Y.maxZ - Y.minZ - 0.6), st.line, Math.min(x, Y.maxX - 0.05), 0.034, (Y.minZ + Y.maxZ) / 2);
      for (let z = z0 + 0.5; z <= Y.maxZ + 0.01; z += L.rowPitch) body.add(geo.box(Y.maxX - Y.minX - 0.6, 0.01, 0.1), st.line, (Y.minX + Y.maxX) / 2, 0.034, Math.min(z, Y.maxZ - 0.05));
    }
  }
  for (const S of P.streets) {
    body.add(geo.box(S.maxX - S.minX, 0.03, S.maxZ - S.minZ), st.street, (S.minX + S.maxX) / 2, 0.03, (S.minZ + S.maxZ) / 2);
    for (const z of [S.minZ, S.maxZ]) body.add(geo.box(S.maxX - S.minX, 0.12, 0.22), shade(st.street, 1.12), (S.minX + S.maxX) / 2, 0.06, z);
  }
  P.shops.forEach((s, i) => buildShop(body, glow, st, s, i, e.colors.accent, goods));
  const bulbs = new Batch();
  for (const l of P.lamps) {
    body.add(geo.cylinder(0.07, 0.1, 3.0, 8), shade(st.shopRoof, 0.85), l.x, 1.5, l.z);
    body.add(geo.box(0.5, 0.08, 0.12), shade(st.shopRoof, 0.85), l.x, 2.95, l.z + L.inward * 0.18);
    bulbs.add(geo.sphere(0.17, 10, 8), 0xffffff, l.x, 2.82, l.z + L.inward * 0.38);
  }
  P.beds.forEach((b, i) => {
    const second = i % 2 === 1;
    buildBed(body, glow, second ? st.beds[2] : st.beds[0], second ? st.beds[3] : st.beds[1], b, rng, !!st.glow && second);
  });
  buildGreen(body, glow, st, P, e.colors.accent, e.colors.glow);

  const statics = body.mesh({ cast: true, receive: true });
  statics.name = 'places';
  group.add(statics);
  if (!glow.empty) group.add(glow.mesh({ cast: false, receive: false, material: GLOW_MAT }));
  if (!bulbs.empty) group.add(bulbs.mesh({ cast: false, receive: false, material: bulbMaterial() }));

  // colliders for the statics (the player walks round the shops and the green's centre)
  for (const s of P.shops) {
    if (s.stall) ctx.colliders.addBox(box(s.x, s.z - L.inward * (s.d / 2 - 0.7), s.w / 2 - 0.25, 0.45), `era:${n}:places`);
    else ctx.colliders.addBox(shopFootprint(s), `era:${n}:places`);
  }
  const gc = greenCentre(P);
  ctx.colliders.addBox(box(gc.x, gc.z, 0.8, 0.8), `era:${n}:places`);

  // ---- huts: one baked mesh (+ glow), re-baked when a hut's stage changes
  const key = e.key;
  const crewIds: UpgradeId[] = [`${key}Crew` as UpgradeId, ...ERA_ROLES.map((r) => `${key}${r.key}` as UpgradeId)];
  const stages = P.huts.map(() => -1);
  const colliders: (ColliderHandle | null)[][] = P.huts.map(() => [null, null]);
  const huts = new THREE.Group();
  huts.name = 'huts';
  group.add(huts);
  ctx.occlusion?.addOccluder(huts); // fades when it hides the player
  let first = true;
  let timer = 0;

  const rebuild = (): void => {
    for (const c of [...huts.children]) {
      huts.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    const hb = new Batch();
    const hg = new Batch();
    P.huts.forEach((h, i) => buildHut(hb, hg, st, h, stages[i]!, e.colors.accent));
    const m = hb.mesh({ cast: true, receive: true });
    m.name = 'hutBodies';
    huts.add(m);
    if (!hg.empty) huts.add(hg.mesh({ cast: false, receive: false, material: GLOW_MAT }));
  };

  const setCollider = (i: number, which: 0 | 1, on: boolean): void => {
    const h = P.huts[i]!;
    const cur = colliders[i]![which];
    if (on && !cur) {
      colliders[i]![which] = ctx.colliders.addBox(which === 0 ? hutFootprint(h, false) : annexOnly(h), `era:${n}:hut`);
    } else if (!on && cur) {
      ctx.colliders.remove(cur);
      colliders[i]![which] = null;
    }
  };

  const sync = (): void => {
    let changed = false;
    const grew: number[] = [];
    crewIds.forEach((id, i) => {
      const s = hutStage(i, ctx.upgrades.level(id));
      if (s === stages[i]) return;
      if (!first && s > stages[i]!) grew.push(i);
      stages[i] = s;
      changed = true;
      setCollider(i, 0, s >= 1);
      setCollider(i, 1, s >= 2);
    });
    if (!changed) return;
    rebuild();
    for (const i of grew) {
      const h = P.huts[i]!;
      ctx.particles.puff(new THREE.Vector3(h.x, 0.6, h.z), { color: e.colors.accent, count: 8, size: 1.1, life: 1.0 });
    }
    first = false;
  };
  sync();

  return {
    group,
    update(dt: number): void {
      timer -= dt;
      if (timer > 0) return;
      timer = POLL;
      sync();
    },
  };
}
