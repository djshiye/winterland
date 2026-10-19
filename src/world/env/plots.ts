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
import { MACHINE_TONES, mixHex, palette } from '../../render/palette';
import { addChimney } from '../sky/smoke';
import { eraOwnsFloor } from './eraGround';

/** Tallest a hut gets (loft + pennant) and the tallest shopfront (sign included), metres. */
export const HUT_MAX_H = 4.6;
export const SHOP_MAX_H = 4.4;

type HutKind = 'cabin' | 'cottage' | 'row' | 'bunk' | 'deco' | 'trailer' | 'modular' | 'quonset' | 'pod';
type BedKind = 'slabs' | 'pools' | 'heaps' | 'ridges' | 'crystals' | 'dunes' | 'vents' | 'outcrop' | 'jack' | 'tank' | 'cleanroom' | 'pit' | 'geode' | 'pad';
/** The yard floor's pattern under the machine grid. */
type YardKind = 'cells' | 'flags' | 'asphalt' | 'tiles' | 'hazard' | 'rings';
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
  /** The resource beds of the harvest field (bed k 0 and 1): shape and colour; `glow` lists the lit ones. */
  beds: [BedKind, number, BedKind, number];
  glow?: readonly number[];
  /** Bed k 2, where the era has one (era 8's clean room). */
  special?: [BedKind, number];
  yard: YardKind;
}

/**
 * Per era, themed on its resource (audit-1.0/era-resources-v2.md): 2 granite + clay, 3 ore + charcoal, 4 scrap + coal,
 * 5 iron pellets + coke, 6 copper + quartz, 7 crude + gas, 8 silica + gold, 9 uranium + graphite, 10 rare earth +
 * helium-3. Warm, never near-black (DIRECTION.md).
 */
/** Era 8's gold pools (the beds' colour picks their look). */
const GOLD_POOL = 0xe5c05a;

const STYLE: readonly (PlotStyle | null)[] = [
  null,
  null,
  { hut: 'cabin', wall: 0x9a7350, roof: 0x7a5a48, shop: 0xc9b9a0, shopRoof: 0x8e6a52, street: 0xb7aea0, pave: 0xc3bcb0, line: 0xa69c8e, green: 'fire', beds: ['slabs', 0xbab4aa, 'pools', 0xc27a56], yard: 'cells' },
  // 3 ore + charcoal (0.9.8 10a): ochre-plaster cottages under iron-grey roofs, rust-brick shops, a rust-gravel street
  { hut: 'cottage', wall: mixHex(palette(3).floor.processing, 0xffffff, 0.4), roof: mixHex(palette(3).accent, 0xffffff, 0.22), shop: palette(3).body, shopRoof: mixHex(palette(3).accent, 0xffffff, 0.22), street: mixHex(palette(3).floor.yard, palette(3).floor.board, 0.45), pave: 0xb8afa6, line: 0x978b80, green: 'well', beds: ['heaps', 0xa65a3e, 'heaps', 0x7a6c64], yard: 'cells' },
  // 4 scrap + coal (0.9.11): brick rows on a misty sage street, scrap stacks and coal heaps in the field
  { hut: 'row', wall: 0xa85a43, roof: 0x5e6266, shop: 0xb5664c, shopRoof: 0x585d61, street: 0x919a8e, pave: 0xa4ab9f, line: 0x848c80, green: 'brazier', beds: ['slabs', 0x8e949a, 'heaps', 0x675d58], yard: 'cells' },
  { hut: 'bunk', wall: 0x7d8c96, roof: 0xb4553a, shop: 0x8a98a2, shopRoof: 0xc0673e, street: 0x8d9095, pave: 0x9fa3a8, line: 0x7f8388, green: 'brazier', beds: ['ridges', 0xb4553a, 'heaps', 0x6f6460], glow: [1], yard: 'cells' },
  // 6 copper + quartz: patina-green deco arcades, flagstone yard, a grove of copper outcrops and quartz clumps
  { hut: 'deco', wall: 0xd8cbb2, roof: 0x4c7a74, shop: 0xe0d2b8, shopRoof: 0x3f706a, street: 0xa7b3a9, pave: 0xb9c2b6, line: 0x8a9490, green: 'lamps', beds: ['outcrop', 0xc0784a, 'crystals', 0xe4eef2], glow: [1], yard: 'flags' },
  // 7 crude + gas: honey trailers and a roadside strip on cold slate asphalt (0.9.11 tundra), pumpjacks and a tank farm
  { hut: 'trailer', wall: 0xe3c07a, roof: 0xc44536, shop: 0xe6d3a8, shopRoof: 0xc44536, street: 0x6c7684, pave: 0x8592a0, line: 0xe8d27a, green: 'brazier', beds: ['jack', 0x7a5236, 'tank', 0xd99b26], yard: 'asphalt' },
  // 8 silica + gold: white modular blocks on clean tiles, glass pavilions, sand dunes with gold pans and a clean room
  { hut: 'modular', wall: 0xeee8d8, roof: 0x5c9aa0, shop: 0xf0eadb, shopRoof: 0x45858c, street: 0xd8d6cf, pave: 0xe2e0d8, line: 0xc4c2ba, green: 'kiosk', beds: ['dunes', 0xdfc28c, 'pools', GOLD_POOL], special: ['cleanroom', 0xf3f4f6], glow: [1], yard: 'tiles' },
  // 9 uranium + graphite: quonset barracks, a hazard-striped yard, a fenced grid of glowing pits
  { hut: 'quonset', wall: 0xdfe6e8, roof: 0x5bb391, shop: 0xe4eaec, shopRoof: 0x4ea885, street: 0xa9b3b6, pave: 0xbcc5c8, line: 0xe8c547, green: 'fountain', beds: ['pit', 0x86e8c4, 'slabs', 0x6f6c6b], glow: [0], yard: 'hazard' },
  // 10 rare earth + helium-3: pods and domes on lavender regolith, a geode crater with skimmer pads
  { hut: 'pod', wall: 0xf6f1e7, roof: 0xb9a3e8, shop: 0xf3eee6, shopRoof: 0xa58fd6, street: 0xc9c6dc, pave: 0xd6d2e6, line: 0xb9b2d8, green: 'orb', beds: ['geode', 0xb9a3e8, 'pad', 0xe6f2ff], glow: [0, 1], yard: 'rings' },
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
  // a shop fronting east (a courtyard's west side) lies the other way round
  return Math.abs(Math.sin(s.yaw)) > 0.5 ? box(s.x, s.z, s.d / 2, s.w / 2) : box(s.x, s.z, s.w / 2, s.d / 2);
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
  const st = STYLE[n]!;
  for (const b of P.beds) out.push({ what: `bed ${bedKind(st, b.k)}`, r: b, h: BED_H[bedKind(st, b.k)] });
  if (P.plan.field === 'pits') for (const r of fenceSides(P.field, regionLayout(n).node.z)) out.push({ what: 'hazard fence', r, h: FENCE_H });
  return out;
}

/** Tallest part of each bed kind (pumpjack heads, tank tops, the clean room's roof vents), metres. */
const BED_H: Record<BedKind, number> = { slabs: 1, pools: 1, heaps: 1, ridges: 1, crystals: 1, dunes: 1, vents: 1, outcrop: 1.5, jack: 2.5, tank: 2.6, cleanroom: 2.6, pit: 1.1, geode: 1.6, pad: 1.5 };
const FENCE_H = 1.2;
const FENCE_GAP = 3;

function bedKind(st: PlotStyle, k: 0 | 1 | 2): BedKind {
  return k === 2 ? (st.special?.[0] ?? st.beds[2]) : k === 1 ? st.beds[2] : st.beds[0];
}

function bedColor(st: PlotStyle, k: 0 | 1 | 2): number {
  return k === 2 ? (st.special?.[1] ?? st.beds[3]) : k === 1 ? st.beds[3] : st.beds[1];
}

/** The four thin sides of the hazard fence round a field (inset 0.3 from its edge). */
function fenceSides(F: Rect, gapZ: number): Rect[] {
  const a = { minX: F.minX + 0.3, maxX: F.maxX - 0.3, minZ: F.minZ + 0.3, maxZ: F.maxZ - 0.3 };
  const t = 0.1;
  // 0.9.9: a 3 m gate gap in the west side, facing the hand node, so the field can be walked into
  const g0 = Math.max(a.minZ + 0.5, Math.min(a.maxZ - 3.5, gapZ - FENCE_GAP / 2));
  return [
    { minX: a.minX, maxX: a.maxX, minZ: a.minZ - t, maxZ: a.minZ + t },
    { minX: a.minX, maxX: a.maxX, minZ: a.maxZ - t, maxZ: a.maxZ + t },
    { minX: a.minX - t, maxX: a.minX + t, minZ: a.minZ, maxZ: g0 },
    { minX: a.minX - t, maxX: a.minX + t, minZ: g0 + FENCE_GAP, maxZ: a.maxZ },
    { minX: a.maxX - t, maxX: a.maxX + t, minZ: a.minZ, maxZ: a.maxZ },
  ];
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

/**
 * 0.9.8 (brief 16): the world position of a built hut's chimney mouth (the cabin / cottage / row / bunk huts have one,
 * see buildHut), or null. World threads that move a chimney keep this in step so its smoke rises from the right spot.
 */
export function hutChimney(st: PlotStyle, h: HutPlace, out = new THREE.Vector3()): THREE.Vector3 | null {
  if (st.hut !== 'cabin' && st.hut !== 'cottage' && st.hut !== 'row' && st.hut !== 'bunk') return null;
  const lx = h.w / 2 - 0.7;
  const lz = -h.d / 4;
  const c = Math.cos(h.yaw);
  const sn = Math.sin(h.yaw);
  return out.set(h.x + lx * c + lz * sn, 0.22 + 2.1 + (st.hut === 'bunk' ? 1.25 : 1.6), h.z - lx * sn + lz * c);
}

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
  if (s.stall && st.hut === 'trailer') {
    // the strip's fuel canopy: a flat lit canopy on four posts over two pumps and a kiosk counter
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) for (const z of [-d / 2 + 0.3, d / 2 - 0.3]) f.put(geo.boxBase(0.18, s.h, 0.18), 0xdedad2, x, 0, z);
    f.put(geo.box(w + 0.4, 0.35, d + 0.4), st.shopRoof, 0, s.h + 0.17, 0);
    f.put(geo.box(w + 0.42, 0.06, d + 0.42), SNOW, 0, s.h + 0.37, 0);
    g.put(geo.box(w + 0.2, 0.1, 0.05), WINDOW, 0, s.h + 0.05, d / 2 + 0.21);
    for (const x of [-w / 4, w / 4]) f.put(geo.boxBase(0.5, 1.2, 0.4), CREAM, x, 0, d / 2 - 0.9).put(geo.box(0.36, 0.3, 0.05), accent, x, 0.95, d / 2 - 0.68);
    f.put(geo.boxBase(w - 0.6, 0.95, 0.7), st.shop, 0, 0, -d / 2 + 0.8);
    for (let k = 0; k < 3; k++) f.put(geo.boxBase(0.5, 0.32, 0.45), goods[k % 2]!, -w / 2 + 1.0 + k * 0.9, 0.95, -d / 2 + 0.8);
    return;
  }
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
  const goodsOut = (): void => {
    f.put(geo.boxBase(0.5, 0.45, 0.45), goods[i % 2]!, -w / 2 + 0.4, 0, d / 2 + 0.45);
    f.put(geo.cylinder(0.22, 0.22, 0.6, 10), goods[(i + 1) % 2]!, -w / 2 + 0.95, 0.3, d / 2 + 0.4);
  };
  const sign = (y: number, z: number): void => {
    f.put(geo.box(w * 0.7, 0.5, 0.1), CREAM, 0, y, z);
    f.put(geo.box(w * 0.5, 0.14, 0.04), accent, 0, y, z + 0.06);
  };
  switch (st.hut) {
    case 'deco': {
      // an arcaded deco terrace: a stepped parapet, tall lit windows, a colonnade in front under a shared arcade roof
      f.put(geo.boxBase(w, h, d), wall, 0, 0, 0);
      f.put(geo.box(w + 0.1, 0.22, d + 0.1), st.shopRoof, 0, h + 0.11, 0);
      f.put(geo.boxBase(w * 0.4, 0.45, 0.3), st.shopRoof, 0, h + 0.22, d / 2 - 0.15);
      f.put(geo.box(w + 0.12, 0.05, d + 0.12), SNOW, 0, h + 0.25, 0);
      g.put(geo.box(w - 1.6, 1.5, 0.06), WINDOW, -0.4, 1.3, d / 2 + 0.03);
      f.put(geo.box(0.8, 1.7, 0.1), shade(st.shopRoof, 0.95), w / 2 - 0.7, 0.85, d / 2 + 0.01);
      sign(h - 0.5, d / 2 + 0.03);
      // the arcade: two columns per shop and a roof slab joining the terrace
      f.put(geo.box(w + 0.12, 0.18, 1.3), st.shopRoof, 0, 2.55, d / 2 + 0.65);
      f.put(geo.box(w + 0.12, 0.05, 1.3), SNOW, 0, 2.67, d / 2 + 0.65);
      for (const x of [-w / 2 + 0.2, w / 4]) f.put(geo.cylinder(0.13, 0.15, 2.45, 10), CREAM, x, 1.22, d / 2 + 1.15);
      break;
    }
    case 'trailer': {
      // a low roadside store: a long flat roof with a big lit sign, a wide window and a bench by the door
      f.put(geo.boxBase(w, h, d), wall, 0, 0, 0);
      f.put(geo.box(w + 0.6, 0.22, d + 0.9), st.shopRoof, 0, h + 0.11, 0.3);
      f.put(geo.box(w + 0.6, 0.05, d + 0.9), SNOW, 0, h + 0.24, 0.3);
      f.put(geo.box(w * 0.8, 0.7, 0.12), CREAM, 0, h + 0.6, d / 2 - 0.2);
      g.put(geo.box(w * 0.65, 0.35, 0.05), mix(WINDOW, accent, 0.35), 0, h + 0.6, d / 2 - 0.12);
      g.put(geo.box(w - 2.2, 1.1, 0.06), WINDOW, -0.6, 1.2, d / 2 + 0.03);
      f.put(geo.box(0.9, 1.7, 0.1), 0xdedad2, w / 2 - 0.8, 0.85, d / 2 + 0.01);
      f.put(geo.boxBase(1.4, 0.45, 0.45), shade(st.shopRoof, 0.85), -w / 2 + 1.0, 0, d / 2 + 0.5);
      break;
    }
    case 'modular': {
      // a glass pavilion: thin white frame, a glazed front, a canopy blade
      f.put(geo.boxBase(w, 0.2, d), 0xd6d4cc, 0, 0, 0);
      f.put(geo.boxBase(w - 0.2, h - 0.3, d - 0.4), shade(wall, 0.96), 0, 0.2, -0.2);
      f.put(geo.box(w + 0.3, 0.18, d + 0.2), wall, 0, h, 0);
      f.put(geo.box(w + 0.32, 0.05, d + 0.22), SNOW, 0, h + 0.11, 0);
      g.put(geo.box(w - 0.5, h - 0.8, 0.05), 0xbfeff0, 0, (h - 0.1) / 2 + 0.2, d / 2 - 0.15);
      for (const x of [-w / 2 + 0.15, -w / 6, w / 6, w / 2 - 0.15]) f.put(geo.box(0.08, h - 0.3, 0.1), wall, x, 0.2 + (h - 0.3) / 2, d / 2 - 0.12);
      f.put(geo.box(w * 0.55, 0.08, 1.0), st.shopRoof, -w * 0.15, 2.3, d / 2 + 0.35);
      f.put(geo.box(w * 0.4, 0.3, 0.06), accent, -w * 0.15, h - 0.35, d / 2 - 0.08);
      goodsOut();
      break;
    }
    case 'quonset': {
      // an arched quonset store with a flat glazed front wall and a sign over the door
      const r = Math.min(w / 2, h - 0.2);
      f.put(geo.boxBase(w + 0.2, 0.18, d + 0.2), 0xb5bfc3, 0, 0, 0);
      f.put(geo.cylinder(r, r, d, 18), wall, 0, 0.18, 0, { rx: Math.PI / 2, sx: w / 2 / r });
      for (let z = -d / 2 + 0.3; z < d / 2; z += 0.6) f.put(geo.torus(r + 0.01, 0.03, 6, 20), shade(wall, 0.86), 0, 0.18, z, { sx: w / 2 / r });
      f.put(geo.box(w * 0.5, 0.06, d), SNOW, 0, 0.18 + r + 0.02, 0);
      f.put(geo.box(w * 0.8, Math.min(2.2, r), 0.1), shade(wall, 0.92), 0, 0.18 + Math.min(2.2, r) / 2, d / 2);
      g.put(geo.box(w * 0.45, 1.0, 0.05), WINDOW, -w * 0.12, 1.1, d / 2 + 0.06);
      f.put(geo.box(0.7, 1.5, 0.08), st.shopRoof, w * 0.25, 0.93, d / 2 + 0.06);
      f.put(geo.box(w * 0.5, 0.3, 0.06), accent, 0, Math.min(2.2, r) + 0.35, d / 2 + 0.05);
      goodsOut();
      break;
    }
    case 'pod': {
      // a dome shop: a drum with a glowing band of windows under a lavender dome and a ring at its crown
      const r = Math.min(w, d) / 2;
      f.put(geo.cylinder(r + 0.15, r + 0.25, 0.2, 22), 0xd9dae6, 0, 0.1, 0);
      f.put(geo.cylinder(r, r, h - r * 0.55, 22), wall, 0, 0.2 + (h - r * 0.55) / 2, 0);
      f.put(geo.sphere(r, 22, 10), st.shopRoof, 0, 0.2 + h - r * 0.55, 0, { sy: 0.55 });
      f.put(geo.sphere(r * 0.6, 14, 6), SNOW, 0, 0.2 + h - r * 0.1, 0, { sy: 0.18 });
      g.put(geo.torus(r + 0.01, 0.09, 6, 30), 0xe6dcff, 0, 1.5, 0, { rx: Math.PI / 2 });
      f.put(geo.box(1.0, 1.6, 0.4), shade(wall, 0.92), 0, 0.8, r - 0.1);
      f.put(geo.box(0.7, 1.4, 0.06), st.shopRoof, 0, 0.72, r + 0.12);
      goodsOut();
      break;
    }
    default: {
      f.put(geo.boxBase(w, h, d), wall, 0, 0, 0);
      // roof: a shallow gable (eras 2-5)
      f.gable(w, d, h, 0.7, st.shopRoof);
      // shop window + door, a sign board, a striped awning over the window
      f.put(geo.box(w - 0.5, 1.4, 0.08), shade(wall, 0.72), -0.35, 1.25, d / 2);
      g.put(geo.box(w - 1.7, 1.15, 0.06), WINDOW, -0.85, 1.25, d / 2 + 0.03);
      f.put(geo.box(0.8, 1.6, 0.1), shade(st.shopRoof, 0.95), w / 2 - 0.75, 0.8, d / 2 + 0.01);
      sign(h - 0.45, d / 2 + 0.03);
      stripe(2.25, d / 2 + 0.45, 0.95, 0.38);
      // goods outside: a crate and a barrel in the era's resource colours
      goodsOut();
    }
  }
}

/** A rounded heap / ridge / crystal / pool along a bed rect (rows along X). */
function buildBed(body: Batch, glow: Batch, kind: BedKind, color: number, r: Rect, rng: Rng, lit: boolean): void {
  const cz = (r.minZ + r.maxZ) / 2;
  const dz = r.maxZ - r.minZ;
  const len = r.maxX - r.minX;
  // a raked strip under every bed (0.9.12, T4: under an ore node or a quartz cluster it is a soft round worn patch, not a pale square)
  if (kind === 'outcrop' || kind === 'crystals') body.add(geo.circleGround(1, 28), mix(color, SNOW, 0.6), (r.minX + r.maxX) / 2, 0.02, cz, { sx: len / 2 + 0.55, sz: dz / 2 + 0.7 });
  else body.add(geo.box(len, 0.02, dz + 0.3), mix(color, SNOW, 0.72), (r.minX + r.maxX) / 2, 0.02, cz);
  const glowTo = lit ? glow : body;
  switch (kind) {
    case 'dunes': {
      // 0.9.10: rows of small wind-sculpted silica dunes: a low skirt, a tall crest leaning downwind with snow on its
      // top, so the sand field reads in 3D instead of flat ovals
      const seg = Math.max(1, Math.round(len / 3.4));
      for (let k = 0; k < seg; k++) {
        const x = r.minX + ((k + 0.5) * len) / seg + rng.range(-0.3, 0.3);
        const sx = len / seg / 2 - 0.2;
        const h = rng.range(0.85, 1.2);
        body.add(geo.sphere(1, 14, 8), color, x, 0, cz, { sx, sy: 0.4 * h, sz: dz / 2 + 0.15 });
        body.add(geo.sphere(1, 14, 8), shade(color, 1.05), x - sx * 0.15, 0, cz - dz * 0.08, { sx: sx * 0.7, sy: 0.95 * h, sz: dz * 0.26 });
        body.add(geo.sphere(1, 12, 6), SNOW, x - sx * 0.15, 0.16, cz - dz * 0.08, { sx: sx * 0.42, sy: 0.86 * h, sz: dz * 0.15 });
      }
      break;
    }
    case 'ridges': {
      const seg = Math.max(1, Math.round(len / 6));
      for (let k = 0; k < seg; k++) {
        const x = r.minX + ((k + 0.5) * len) / seg;
        const sx = len / seg / 2 - 0.2;
        body.add(geo.sphere(1, 14, 8), color, x, 0, cz, { sx, sy: 0.7, sz: dz / 2 });
        body.add(geo.sphere(1, 12, 6), mix(color, SNOW, 0.75), x, 0.12, cz - dz * 0.05, { sx: sx * 0.6, sy: 0.6, sz: dz * 0.25 });
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
      if (color === GOLD_POOL) {
        // 0.9.10 era 8: gold-panning pools: a timber rim round clear water, gold flakes glinting on the bottom and a
        // little sluice box beside each
        const T8 = MACHINE_TONES[8]!;
        for (let x = r.minX + 1.3; x < r.maxX - 1.1; x += rng.range(2.8, 3.4)) {
          const s = rng.range(0.85, 1.0);
          body.add(geo.cylinder(1, 1.05, 0.16, 20), mix(T8.trim, T8.body, 0.55), x, 0.08, cz, { sx: s * 1.15, sz: (dz / 2) * 0.95 });
          body.add(geo.cylinder(1, 1, 0.04, 20), mix(T8.glow, SNOW, 0.62), x, 0.15, cz, { sx: s * 0.98, sz: (dz / 2) * 0.78 });
          for (let f = 0; f < 5; f++) glowTo.add(geo.sphere(0.08, 6, 4), color, x + rng.range(-0.5, 0.5) * s, 0.17, cz + rng.range(-0.3, 0.3) * dz, { sy: 0.4 });
          body.add(geo.boxBase(0.9, 0.22, 0.32), mix(T8.trim, T8.body, 0.4), x + s * 0.9, 0.12, cz + dz * 0.42, { rz: -0.18 });
          body.add(geo.box(0.86, 0.03, 0.26), mix(T8.glow, SNOW, 0.5), x + s * 0.9, 0.36, cz + dz * 0.42, { rz: -0.18 });
        }
        break;
      }
      for (let x = r.minX + 1.2; x < r.maxX - 1; x += rng.range(2.6, 3.4)) {
        const s = rng.range(0.8, 1.05);
        body.add(geo.cylinder(1, 1.05, 0.12, 18), mix(color, SNOW, 0.45), x, 0.06, cz, { sx: s * 1.15, sz: (dz / 2) * 0.95 });
        glowTo.add(geo.cylinder(1, 1, 0.04, 18), color, x, 0.13, cz, { sx: s * 0.95, sz: (dz / 2) * 0.72 });
      }
      break;
    }
    case 'crystals': {
      // 0.9.10: clusters of rounded quartz prisms (soft dome tips, never spikes) on a little stone, leaning out
      const zs = dz > 1.6 ? [r.minZ + dz * 0.3, r.minZ + dz * 0.7] : [cz];
      for (const z of zs) {
        for (let x = r.minX + 0.7; x < r.maxX - 0.6; x += rng.range(1.1, 1.6)) {
          const zc = z + rng.range(-0.2, 0.2);
          body.add(geo.dodecahedron(0.3), mix(color, 0x8a8684, 0.45), x, 0.08, zc, { sy: 0.55 });
          for (let c = 0; c < 3; c++) {
            const a = rng.range(0, Math.PI * 2);
            const lean = c === 0 ? 0.08 : 0.38;
            const hgt = c === 0 ? rng.range(0.95, 1.25) : rng.range(0.55, 0.8);
            const ox = c === 0 ? 0 : Math.cos(a) * 0.28;
            const oz = c === 0 ? 0 : Math.sin(a) * 0.28;
            const rot = { rz: -Math.cos(a) * lean, rx: Math.sin(a) * lean };
            glowTo.add(geo.cylinder(0.18, 0.21, hgt, 6), color, x + ox, 0.1 + hgt / 2, zc + oz, rot);
            glowTo.add(geo.sphere(0.18, 6, 4), mix(color, SNOW, 0.4), x + ox - Math.sin(rot.rz) * hgt * 0.5, 0.1 + hgt * Math.cos(lean), zc + oz + Math.sin(rot.rx) * hgt * 0.5, { sy: 0.8 });
          }
          body.add(geo.sphere(0.32, 8, 4), SNOW, x - 0.15, 0.04, zc + 0.15, { sy: 0.2 });
        }
      }
      break;
    }
    case 'outcrop': {
      // 0.9.10: a clump of warm stone shot through with bright copper veins, verdigris on its shoulders, a little heap
      // of nuggets at its foot and a snow cap (era 6 runs on copper)
      const cx = (r.minX + r.maxX) / 2;
      const s = Math.min(len, dz) / 2;
      const T6 = MACHINE_TONES[6]!;
      const stone = mix(T6.cream, T6.body, 0.42);
      const patina = mix(T6.bodyL, T6.cream, 0.32);
      body.add(geo.dodecahedron(1), mix(color, stone, 0.5), cx, s * 0.35, cz, { sx: s * 0.75, sy: 0.95, sz: s * 0.7, ry: 0.4 });
      body.add(geo.dodecahedron(0.62), shade(stone, 1.08), cx + s * 0.5, 0.32, cz + s * 0.25, { sy: 0.8 });
      body.add(geo.dodecahedron(0.48), shade(stone, 0.94), cx - s * 0.55, 0.26, cz + s * 0.2, { ry: 0.9 });
      // copper veins across the camera-side faces
      for (const [vx, vy, vz, rz] of [[-0.25, 0.75, 0.62, 0.6], [0.2, 0.55, 0.66, -0.4], [0.62, 0.35, 0.7, 0.9]] as const) {
        body.add(geo.box(0.8, 0.11, 0.07), shade(color, 1.12), cx + vx * s, vy + s * 0.2, cz + vz * s, { rz });
      }
      for (let k = 0; k < 5; k++) body.add(geo.dodecahedron(0.13), shade(color, rng.range(1, 1.18)), cx + rng.range(-0.9, 0.9), 0.08, cz + s * 0.75 + rng.range(-0.15, 0.25));
      body.add(geo.sphere(0.5, 8, 5), patina, cx - s * 0.1, s * 0.35 + 0.7, cz - 0.1, { sx: s * 0.62, sy: 0.25, sz: s * 0.5 });
      body.add(geo.sphere(0.5, 8, 5), SNOW, cx + 0.1, s * 0.35 + 0.88, cz, { sx: s * 0.42, sy: 0.16, sz: s * 0.34 });
      // two copper glints that catch the lamplight at night
      for (const [gx, gz] of [[-0.3, 0.68], [0.55, 0.72]] as const) glow.add(geo.sphere(0.07, 6, 4), mix(color, T6.cream, 0.35), cx + gx * s, 0.7, cz + gz * s);
      break;
    }
    case 'jack': {
      // 0.9.10: a honey-painted pumpjack (DIRECTION: warm, never black) on a gravel pad: cream samson posts, a crimson
      // counterweight, a wellhead with a little warm lamp, and a pair of snow-capped honey barrels by the pad
      const cx = (r.minX + r.maxX) / 2;
      const T7 = MACHINE_TONES[7]!;
      const honey = T7.body;
      body.add(geo.box(len, 0.06, dz), mix(T7.concrete, SNOW, 0.25), cx, 0.04, cz);
      body.add(geo.boxBase(1.6, 0.25, 0.9), T7.concrete, cx, 0, cz);
      for (const s of [-0.3, 0.3]) body.add(geo.box(0.13, 1.9, 0.13), T7.cream, cx, 1.15, cz + s, { rx: -s * 0.35 });
      body.add(geo.box(2.4, 0.24, 0.26), honey, cx + 0.2, 2.05, cz, { rz: 0.12 });
      body.add(geo.box(0.38, 0.85, 0.32), T7.bodyD, cx + 1.45, 1.75, cz, { rz: 0.12 });
      body.add(geo.cylinder(0.45, 0.45, 0.26, 14), T7.accent, cx - 1.0, 1.0, cz, { rx: Math.PI / 2 });
      body.add(geo.cylinder(0.12, 0.12, 0.3, 8), T7.cream, cx - 1.0, 1.0, cz, { rx: Math.PI / 2 });
      body.add(geo.cylinder(0.14, 0.18, 0.7, 8), T7.steel, cx + 1.45, 0.35, cz);
      body.add(geo.box(2.4, 0.07, 0.28), SNOW, cx + 0.2, 2.2, cz, { rz: 0.12 });
      glow.add(geo.sphere(0.1, 8, 6), T7.glow, cx + 1.45, 0.82, cz + 0.12);
      // the barrels (honey, cream bands), standing on the pad's camera side
      for (const [bx, bz] of [[-1.25, 0.28], [-0.72, 0.36]] as const) {
        const x = cx + bx, z = cz + dz * bz;
        body.add(geo.cylinder(0.26, 0.26, 0.62, 12), mix(honey, T7.bodyL, 0.4), x, 0.33, z);
        for (const y of [0.18, 0.48]) body.add(geo.torus(0.265, 0.025, 4, 16), T7.cream, x, y, z, { rx: Math.PI / 2 });
        body.add(geo.cylinder(0.24, 0.27, 0.06, 12), SNOW, x, 0.66, z);
      }
      // a crude-oil seep beside the wellhead (warm brown, not black)
      body.add(geo.cylinder(1, 1, 0.03, 14), mix(color, honey, 0.25), cx + 0.6, 0.06, cz + dz * 0.32, { sx: 0.55, sz: 0.3 });
      break;
    }
    case 'tank': {
      // a gas storage sphere on legs, a stair and a glowing valve band
      const cx = (r.minX + r.maxX) / 2;
      const rad = Math.min(len, dz) / 2 - 0.35;
      body.add(geo.box(len, 0.06, dz), 0xa9a49c, cx, 0.04, cz);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) body.add(geo.box(0.14, 0.9, 0.14), 0x8f8a84, cx + lx * rad * 0.6, 0.45, cz + lz * rad * 0.6);
      body.add(geo.sphere(rad, 18, 12), 0xeee8de, cx, 0.5 + rad * 0.55, cz, { sy: 0.55 });
      body.add(geo.torus(rad * 0.98, 0.07, 6, 28), color, cx, 0.5 + rad * 0.55, cz, { rx: Math.PI / 2 });
      body.add(geo.sphere(rad * 0.7, 12, 6), SNOW, cx, 0.5 + rad * 1.0, cz, { sy: 0.15 });
      // 0.9.10: a stair up the camera side and a warm valve lamp at its foot (the tank farm glows a little at night)
      for (let k = 0; k < 4; k++) body.add(geo.box(0.5, 0.06, 0.22), MACHINE_TONES[7]!.steel, cx + rad * 0.55, 0.15 + k * 0.28, cz + rad * 0.62 - k * 0.12);
      glow.add(geo.sphere(0.09, 8, 6), MACHINE_TONES[7]!.glow, cx + rad * 0.85, 0.55, cz + rad * 0.62);
      break;
    }
    case 'cleanroom': {
      // a white clean-room block where the silicon is pulled: glazed front, roof vents
      const cx = (r.minX + r.maxX) / 2;
      body.add(geo.boxBase(len - 0.2, 2.0, dz - 0.2), color, cx, 0, cz);
      body.add(geo.box(len, 0.14, dz), 0xc9ccd2, cx, 2.07, cz);
      body.add(geo.box(len - 0.1, 0.05, dz - 0.1), SNOW, cx, 2.17, cz);
      for (const dx of [-len / 4, len / 4]) body.add(geo.cylinder(0.3, 0.3, 0.4, 10), 0xb8bec4, cx + dx, 2.4, cz - dz / 4);
      glow.add(geo.box(len - 1.2, 0.9, 0.05), 0xbfeff0, cx, 1.15, r.maxZ - 0.07);
      body.add(geo.box(0.9, 1.6, 0.08), 0x9fb0b8, cx + len / 2 - 0.9, 0.8, r.maxZ - 0.05);
      break;
    }
    case 'pit': {
      // a square pit with a concrete rim, glowing ore inside
      const cx = (r.minX + r.maxX) / 2;
      body.add(geo.boxBase(len, 0.35, 0.25), 0xb8bdbf, cx, 0, r.minZ + 0.12).add(geo.boxBase(len, 0.35, 0.25), 0xb8bdbf, cx, 0, r.maxZ - 0.12);
      body.add(geo.boxBase(0.25, 0.35, dz), 0xb8bdbf, r.minX + 0.12, 0, cz).add(geo.boxBase(0.25, 0.35, dz), 0xb8bdbf, r.maxX - 0.12, 0, cz);
      body.add(geo.box(len - 0.5, 0.02, dz - 0.5), shade(color, 0.45), cx, 0.03, cz);
      for (let k = 0; k < 4; k++) glowTo.add(geo.dodecahedron(0.22), color, cx + rng.range(-0.6, 0.6), 0.2, cz + rng.range(-0.6, 0.6));
      // a hazard flag on the rim
      body.add(geo.box(0.05, 0.7, 0.05), 0x6f6c6b, r.maxX - 0.15, 0.35 + 0.35, r.minZ + 0.15).add(geo.box(0.04, 0.2, 0.3), 0xe8c547, r.maxX - 0.15, 0.62, r.minZ + 0.32);
      break;
    }
    case 'geode': {
      // a split geode: a rough shell with a ring of glowing crystals in its heart
      const cx = (r.minX + r.maxX) / 2;
      const s = Math.min(len, dz) / 2;
      body.add(geo.sphere(1, 12, 8), 0x9a93a8, cx, 0, cz, { sx: s * 0.95, sy: s * 0.55, sz: s * 0.95 });
      body.add(geo.cylinder(s * 0.6, s * 0.7, 0.06, 14), shade(color, 0.6), cx, s * 0.5, cz);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        glowTo.add(geo.cylinder(0.02, 0.12, s * 0.55, 6), color, cx + Math.cos(a) * s * 0.35, s * 0.5 + s * 0.2, cz + Math.sin(a) * s * 0.35, { rz: Math.cos(a) * 0.4, rx: -Math.sin(a) * 0.4 });
      }
      body.add(geo.sphere(1, 10, 5), SNOW, cx - s * 0.3, s * 0.42, cz - s * 0.3, { sx: s * 0.35, sy: 0.12, sz: s * 0.3 });
      break;
    }
    case 'pad': {
      // a helium-3 skimmer pad: a round deck, a glowing landing ring and a little beacon mast
      const cx = (r.minX + r.maxX) / 2;
      const s = Math.min(len, dz) / 2;
      body.add(geo.cylinder(s, s + 0.1, 0.3, 22), 0xd9dae6, cx, 0.15, cz);
      glowTo.add(geo.torus(s * 0.7, 0.05, 6, 28), color, cx, 0.32, cz, { rx: Math.PI / 2 });
      body.add(geo.cylinder(0.05, 0.05, 1.0, 6), 0xa9a6b8, cx + s - 0.3, 0.8, cz - s + 0.3);
      glowTo.add(geo.sphere(0.12, 8, 6), 0xb9a3e8, cx + s - 0.3, 1.32, cz - s + 0.3);
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

/** The yard floor's era pattern on top of its paving (the machine cells stay marked over it). */
function buildYardPattern(body: Batch, glow: Batch, st: PlotStyle, Y: Rect, rng: Rng): void {
  const w = Y.maxX - Y.minX;
  const d = Y.maxZ - Y.minZ;
  const cx = (Y.minX + Y.maxX) / 2;
  const cz = (Y.minZ + Y.maxZ) / 2;
  switch (st.yard) {
    case 'flags':
      // big two-tone flagstones, offset every other course
      for (let j = 0, z = Y.minZ + 0.1; z < Y.maxZ - 0.5; j++, z += 1.8) {
        for (let x = Y.minX + 0.1 + (j % 2) * 1.1; x < Y.maxX - 0.5; x += 2.2) {
          const fw = Math.min(2.0, Y.maxX - 0.1 - x);
          const fd = Math.min(1.6, Y.maxZ - 0.1 - z);
          if (fw > 0.4 && fd > 0.4) body.add(geo.box(fw, 0.008, fd), shade(st.pave, rng.range(0.93, 1.05)), x + fw / 2, 0.028, z + fd / 2);
        }
      }
      break;
    case 'asphalt':
      // dark tarmac with oil stains and a painted edge line
      body.add(geo.box(w - 0.4, 0.008, d - 0.4), shade(st.pave, 0.82), cx, 0.027, cz);
      for (let k = 0; k < Math.round((w * d) / 30); k++) body.add(geo.circleGround(1, 12), 0x55504e, rng.range(Y.minX + 1, Y.maxX - 1), 0.03 + (k % 8) * 0.0003, rng.range(Y.minZ + 1, Y.maxZ - 1), { sx: rng.range(0.3, 0.9), sz: rng.range(0.2, 0.6), ry: rng.range(0, 3) });
      for (const z of [Y.minZ + 0.35, Y.maxZ - 0.35]) body.add(geo.box(w - 0.6, 0.01, 0.12), st.line, cx, 0.036, z);
      break;
    case 'tiles':
      // a fine clean-room tile grid
      for (let x = Y.minX + 1.25; x < Y.maxX; x += 1.25) body.add(geo.box(0.04, 0.008, d - 0.3), shade(st.pave, 0.9), x, 0.03, cz);
      for (let z = Y.minZ + 1.25; z < Y.maxZ; z += 1.25) body.add(geo.box(w - 0.3, 0.008, 0.04), shade(st.pave, 0.9), cx, 0.03, z);
      break;
    case 'hazard':
      // a yellow-and-grey hazard border round the yard
      for (let x = Y.minX + 0.4; x < Y.maxX - 0.4; x += 1.0) {
        const c = Math.round((x - Y.minX) / 1.0) % 2 ? st.line : 0x6f6c6b;
        for (const z of [Y.minZ + 0.3, Y.maxZ - 0.3]) body.add(geo.box(0.98, 0.01, 0.4), c, x + 0.5, 0.034, z, { ry: 0 });
      }
      for (let z = Y.minZ + 0.6; z < Y.maxZ - 0.6; z += 1.0) {
        const c = Math.round((z - Y.minZ) / 1.0) % 2 ? st.line : 0x6f6c6b;
        for (const x of [Y.minX + 0.3, Y.maxX - 0.3]) body.add(geo.box(0.4, 0.01, 0.98), c, x, 0.034, z + 0.5);
      }
      break;
    case 'rings':
      // lavender regolith marked with soft landing rings
      for (let k = 0; k < Math.max(2, Math.round(w / 14)); k++) {
        const x = Y.minX + ((k + 0.5) * w) / Math.max(2, Math.round(w / 14));
        body.add(geo.ringGround(2.4, 2.7, 32), st.line, x, 0.03, cz);
        glow.add(geo.ringGround(0.5, 0.62, 18), 0xe6dcff, x, 0.032, cz);
      }
      break;
    default:
  }
}

/** One market street / forecourt / plaza in the era's style. */
function buildStreet(body: Batch, st: PlotStyle, P: PlotPlaces, S: Rect, rng: Rng): void {
  const w = S.maxX - S.minX;
  const d = S.maxZ - S.minZ;
  const cx = (S.minX + S.maxX) / 2;
  const cz = (S.minZ + S.maxZ) / 2;
  body.add(geo.box(w, 0.03, d), st.street, cx, 0.03, cz);
  switch (P.plan.street) {
    case 'strip':
      // the forecourt: parking bays and a white kerb on the road side
      for (let x = S.minX + 3; x < S.maxX - 1; x += 3) body.add(geo.box(0.1, 0.01, d * 0.42), 0xf2efe8, x, 0.05, S.maxZ - d * 0.25);
      body.add(geo.box(w, 0.12, 0.22), shade(st.street, 1.3), cx, 0.06, S.maxZ);
      break;
    case 'court':
    case 'crescent':
      // a paved plaza: a border of lighter setts and a round centrepiece
      body.add(geo.box(w - 0.8, 0.01, d - 0.8), shade(st.street, 1.08), cx, 0.045, cz);
      body.add(geo.ringGround(Math.min(w, d) * 0.22, Math.min(w, d) * 0.28, 36), shade(st.street, 0.86), cx, 0.055, cz);
      body.add(geo.cylinder(0.9, 1.0, 0.45, 18), shade(st.shop, 0.92), cx, 0.22, cz);
      body.add(geo.sphere(0.7, 12, 8), 0xf4f8ff, cx, 0.45, cz, { sy: 0.5 });
      break;
    case 'campus':
      // a walkway of pale slabs with lawn strips either side
      for (let x = S.minX + 0.6; x < S.maxX - 0.6; x += 1.6) body.add(geo.box(1.3, 0.01, d - 0.5), shade(st.street, rng.range(1.02, 1.08)), x + 0.65, 0.045, cz);
      break;
    default:
      for (const z of [S.minZ, S.maxZ]) body.add(geo.box(w, 0.12, 0.22), shade(st.street, 1.12), cx, 0.06, z);
  }
}

/** The field's own dressing beyond its beds: the hazard fence, the crater bowl, the pipelines, the dune ripples. */
function buildFieldDressing(body: Batch, glow: Batch, st: PlotStyle, P: PlotPlaces, rng: Rng, nodeZ: number): void {
  const F = P.field;
  const cx = (F.minX + F.maxX) / 2;
  const cz = (F.minZ + F.maxZ) / 2;
  switch (P.plan.field) {
    case 'pits': {
      const sides = fenceSides(F, nodeZ);
      for (const r of sides) {
        const along = r.maxX - r.minX > r.maxZ - r.minZ;
        const len = along ? r.maxX - r.minX : r.maxZ - r.minZ;
        const mx = (r.minX + r.maxX) / 2;
        const mz = (r.minZ + r.maxZ) / 2;
        for (const y of [0.55, 1.05]) body.add(geo.box(along ? len : 0.06, 0.07, along ? 0.06 : len), 0xb8bdbf, mx, y, mz);
        for (let t = 0; t <= len + 0.01; t += 2.4) {
          const x = along ? r.minX + Math.min(t, len) : mx;
          const z = along ? mz : r.minZ + Math.min(t, len);
          body.add(geo.boxBase(0.1, FENCE_H, 0.1), 0x8a8f92, x, 0, z);
        }
      }
      // 0.9.9: two taller gate posts at the west gap
      const gate = sides[3]!;
      for (const z of [sides[2]!.maxZ, gate.minZ]) body.add(geo.boxBase(0.16, FENCE_H + 0.3, 0.16), 0xd9a441, gate.minX + 0.1, 0, z);
      // hazard signs on the fence's camera sides
      for (let x = F.minX + 4; x < F.maxX - 3; x += 9) body.add(geo.box(0.7, 0.5, 0.04), st.line, x, 0.85, F.maxZ - 0.22).add(geo.box(0.3, 0.3, 0.05), 0x3d3a39, x, 0.85, F.maxZ - 0.2);
      break;
    }
    case 'crater': {
      const R = Math.min(F.maxX - F.minX, F.maxZ - F.minZ) / 2 - 1.8;
      body.add(geo.circleGround(R, 40), mix(st.beds[1], 0x8a8684, 0.55), cx, 0.02, cz);
      body.add(geo.circleGround(R * 0.8, 40), mix(st.beds[1], 0x6f6a7c, 0.6), cx, 0.025, cz);
      body.add(geo.torus(R, 0.35, 6, 48), mix(st.beds[1], SNOW, 0.6), cx, 0.05, cz, { rx: Math.PI / 2, sz: 0.6 });
      glow.add(geo.ringGround(R * 0.4, R * 0.43, 40), st.beds[1], cx, 0.03, cz);
      break;
    }
    case 'rigs': {
      // a low pipeline per row of pumpjack pads, from the row's easternmost pad east to the tank farm
      // (0.9.9: one pipe per row, so none runs through the neighbouring pads)
      const tanksX = Math.min(...P.beds.filter((b) => b.k === 1).map((b) => b.minX), F.maxX);
      const rows = new Map<number, number>();
      for (const b of P.beds) {
        if (b.k !== 0) continue;
        const key = Math.round(((b.minZ + b.maxZ) / 2) * 10);
        rows.set(key, Math.max(rows.get(key) ?? -Infinity, b.maxX));
      }
      for (const [key, x0] of rows) {
        const z = key / 10 + 0.9;
        if (tanksX - x0 > 0.3) {
          body.add(geo.box(tanksX - x0, 0.14, 0.14), 0x8a8580, (x0 + tanksX) / 2, 0.2, z);
          // 0.9.12 (C4): both ends turn down into the ground: an elbow stub, a flange collar and a little valve cap, never mid-air
          for (const [ex, ew] of [[x0, 1], [tanksX, -1]] as const) {
            body.add(geo.box(0.14, 0.2, 0.14), 0x8a8580, ex + ew * 0.07, 0.1, z);
            body.add(geo.circleGround(0.3, 12), 0x6f6a66, ex + ew * 0.07, 0.03, z);
            body.add(geo.cylinder(0.11, 0.11, 0.06, 10), 0xd9a441, ex + ew * 0.07, 0.31, z);
          }
        }
      }
      break;
    }
    case 'dunes':
      // wind ripples in the sand between the dunes
      for (let k = 0; k < 18; k++) body.add(geo.box(rng.range(1.5, 3.5), 0.01, 0.08), mix(st.beds[1], SNOW, 0.45), rng.range(F.minX + 2, F.maxX - 2), 0.03, rng.range(F.minZ + 1, F.maxZ - 1), { ry: rng.range(-0.25, 0.25) });
      break;
    case 'grove':
      // stepping stones winding through the grove
      for (let k = 0, x = F.minX + 1; x < F.maxX - 1; k++, x += 1.3) body.add(geo.circleGround(0.4, 10), shade(st.pave, 0.95), x, 0.03, cz + Math.sin(k * 0.7) * 2.5);
      break;
    default:
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
  // 0.9.8: an era with its own base board (world/env/eraGround.ts) lays its own processing floor and cell marks
  if (!eraOwnsFloor(n)) {
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
  buildYardPattern(body, glow, st, Y, rng);
  }
  for (const S of P.streets) buildStreet(body, st, P, S, rng);
  P.shops.forEach((s, i) => buildShop(body, glow, st, s, i, e.colors.accent, goods));
  const bulbs = new Batch();
  for (const l of P.lamps) {
    body.add(geo.cylinder(0.07, 0.1, 3.0, 8), shade(st.shopRoof, 0.85), l.x, 1.5, l.z);
    body.add(geo.box(0.5, 0.08, 0.12), shade(st.shopRoof, 0.85), l.x, 2.95, l.z + L.inward * 0.18);
    bulbs.add(geo.sphere(0.17, 10, 8), 0xffffff, l.x, 2.82, l.z + L.inward * 0.38);
  }
  for (const b of P.beds) buildBed(body, glow, bedKind(st, b.k), bedColor(st, b.k), b, rng, !!st.glow?.includes(b.k));
  buildFieldDressing(body, glow, st, P, rng, L.node.z);
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
  const chimneys: (() => void)[] = [];

  const rebuild = (): void => {
    for (const c of [...huts.children]) {
      huts.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    const hb = new Batch();
    const hg = new Batch();
    P.huts.forEach((h, i) => buildHut(hb, hg, st, h, stages[i]!, e.colors.accent));
    // 0.9.8: built huts with a chimney smoke (world/sky/smoke.ts)
    for (const off of chimneys.splice(0)) off();
    P.huts.forEach((h, i) => {
      const c = stages[i]! >= 1 ? hutChimney(st, h) : null;
      if (c) chimneys.push(addChimney(c, h.role === 0 ? 0.45 : 0.38));
    });
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
