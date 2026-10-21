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
 * - 1.0 (EM1): the free ground of the MARKET and HUTS zones is lived in: goods stacks, benches and lamps, notice boards,
 *   hand carts, snow piles and one clutter piece per era built from its resources (eras/layout.ts plotDecor places them
 *   off every walker route; buildDecor draws them into the same batches, so they add no draw calls).
 *
 * Draw calls per bought region: statics 1 + glow 1 + huts 1 (+ glow 1) + lamp bulbs 1. Nothing tall stands between
 * a pad and the camera (tests/plotPlaces.test.ts checks every solid's camera shadow against every pad and counter).
 */
import * as THREE from 'three';
import { ERA_CREW_COUNT, ERA_ROLES, eraRoleCount, PALETTE, type Rect } from '../../config';
import { ERAS } from '../../eras/data';
import { GREEN_PIECE_R, greenPlaza, HUT_ANNEX, hutBox, PLAZA_HALF, plotDecor, plotPlaces, plotRoutes, regionLayout, ROUTE_HALF, TALL_SHOP_TOP, type DecorPlace, type HutPlace, type PlotPlaces, type ShopPlace } from '../../eras/layout';
import type { GameContext, UpgradeId } from '../../core/types';
import type { ColliderHandle } from '../Colliders';
import { Batch } from '../../render/batch';
import { DuskBatch, duskBasic } from '../../render/duskWindows';
import { geo } from '../../render/materials';
import { bulbMaterial } from './glow';
import { addLanternGarland, type V3 } from './festive';
import { Rng } from './common';
import { MACHINE_TONES, mixHex, palette } from '../../render/palette';
import { addChimney } from '../sky/smoke';
import { eraOwnsFloor } from './eraGround';
import { buildFieldWorks, fieldWorkSolids } from './fieldWorks';

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
  /** 0.9.11 (review EM2): roof / wall colours the huts cycle through, so a row isn't one model repeated. */
  roofs?: readonly number[];
  walls?: readonly number[];
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
const COPPER_ROOF = 0x5f9a8c;

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
  { hut: 'modular', wall: 0xeee8d8, roof: 0x5c9aa0, shop: 0xf0eadb, shopRoof: 0x45858c, street: 0xd8d6cf, pave: 0xe2e0d8, line: 0xc4c2ba, green: 'kiosk', beds: ['dunes', 0xdfc28c, 'pools', GOLD_POOL], special: ['cleanroom', 0xf3f4f6], glow: [1], yard: 'tiles', roofs: [0x5c9aa0, 0xd9a441, 0x6f8fb8, 0xc9705a], walls: [0xeee8d8, 0xe6eef0, 0xf2e6d2] },
  // 9 uranium + graphite: quonset barracks, a hazard-striped yard, a fenced grid of glowing pits
  { hut: 'quonset', wall: 0xdfe6e8, roof: 0x5bb391, shop: 0xe4eaec, shopRoof: 0x4ea885, street: 0xa9b3b6, pave: 0xbcc5c8, line: 0xe8c547, green: 'fountain', beds: ['pit', 0x86e8c4, 'slabs', 0x6f6c6b], glow: [0], yard: 'hazard' },
  // 10 rare earth + helium-3: pods and domes on lavender regolith, a geode crater with skimmer pads
  { hut: 'pod', wall: 0xf6f1e7, roof: 0xb9a3e8, shop: 0xf3eee6, shopRoof: 0xa58fd6, street: 0xc9c6dc, pave: 0xd6d2e6, line: 0xb9b2d8, green: 'orb', beds: ['geode', 0xb9a3e8, 'pad', 0xe6f2ff], glow: [0, 1], yard: 'rings', roofs: [0xb9a3e8, 0xe8a8c0, 0xf2c46a, 0x9fc8e8], walls: [0xf6f1e7, 0xf3ebf6, 0xf6f0e2] },
];

const SNOW = PALETTE.snow;
const CREAM = 0xfff3dc;
/** Icicles: pale blue ice. */
const ICE = 0xd6eefa;
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

/** World footprint of a hut: the body, plus the annex behind it at its biggest (eras/layout.ts hutBox keeps it pure). */
export function hutFootprint(h: HutPlace, annex: boolean): Rect {
  return hutBox(h, annex);
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

/** Tallest a deco roof (era 6) may reach with its furniture (the R22 camera-shadow limit of the market street). */
const DECO_ROOF_TOP = 4.6;
const DECO_ROOF: readonly [number, number][] = [[0, 2.3], [1, 1.35], [2, 1.45], [3, 0.6]];
/** Era 6 shop i's roof piece (0 water tank, 1 deco crown, 2 lit sign frame, 3 skylight, -1 none) and its height over the roof: the shop's own pick, or the tallest that keeps under DECO_ROOF_TOP. */
function decoRoof(i: number, h: number): [number, number] {
  const own = DECO_ROOF[i % 4]!;
  if (h + own[1] <= DECO_ROOF_TOP) return own;
  return DECO_ROOF.filter((p) => h + p[1] <= DECO_ROOF_TOP).sort((a, b) => b[1] - a[1])[0] ?? [-1, 0];
}

/** Every solid a region's places add at full growth (pure; tests/plotPlaces.test.ts). */
export function placeSolids(n: number): PlaceSolid[] {
  const P = plotPlaces(n);
  const out: PlaceSolid[] = [];
  for (const h of P.huts) out.push({ what: `hut ${h.role}`, r: hutFootprint(h, true), h: HUT_MAX_H });
  // a two-storey shop (eras 6-7) is built up to TALL_SHOP_TOP at most; the low ones carry a sign and roof furniture to h + 0.9
  // 0.9.13: era 6's deco roofs carry a piece of roof furniture (decoRoof), never above DECO_ROOF_TOP
  const deco = P.plan.street === 'arcade';
  P.shops.forEach((s, i) => out.push({ what: s.stall ? 'street stall' : 'shop', r: shopFootprint(s), h: s.stall ? s.h + 0.9 : Math.max(s.h > 4 ? TALL_SHOP_TOP : s.h + 0.9, deco ? s.h + decoRoof(i, s.h)[1] : 0) }));
  for (const l of P.lamps) out.push({ what: 'lamp', r: box(l.x, l.z, 0.2, 0.2), h: 3.2 });
  // EM1: the lived-in market and huts (eras/layout.ts plotDecor)
  for (const d of plotDecor(n)) out.push({ what: `decor ${d.kind}`, r: box(d.x, d.z, d.hx, d.hz), h: d.h });
  const g = greenCentre(P);
  out.push({ what: 'green centre', r: box(g.x, g.z, n >= 6 ? GREEN_PIECE_R : 0.9, n >= 6 ? GREEN_PIECE_R : 0.9), h: n >= 6 ? GREEN_PIECE_H[n]! : 2.2 });
  const st = STYLE[n]!;
  for (const b of P.beds) out.push({ what: `bed ${bedKind(st, b.k)}`, r: b, h: BED_H[bedKind(st, b.k)] });
  if (P.plan.field === 'pits') for (const r of fenceSides(P.field, regionLayout(n).node.z)) out.push({ what: 'hazard fence', r, h: FENCE_H });
  // 0.9.13 (E1): the field's earthworks and working props
  out.push(...fieldWorkSolids(n, P));
  for (const c of forecourtCars(n)) out.push({ what: 'parked car', r: box(c.x, c.z, CAR_HX, CAR_HZ), h: CAR_H });
  return out;
}

/** 1.0 polish: a parked car's half width / half length and roof height (m). */
const CAR_HX = 0.62;
const CAR_HZ = 1.12;
const CAR_H = 1.25;
const CAR_PAINTS = [0xd9a83a, 0x8a9a4b, 0xc8642e, 0x3e8a8c, 0xeadfc4, 0x8c3b3b, 0x5a7fb0] as const;

/**
 * 1.0 polish: the cars parked in the bays of a roadside forecourt (era 7's 'strip' street), so the wide asphalt reads as
 * a busy filling-station car park. Deterministic; a bay is skipped (and some are left free) where a car would come within
 * a route's half width + 0.3 m of any walker route, or touch a shop, a lamp or a decor piece. Pure.
 */
export function forecourtCars(n: number): { x: number; z: number; yaw: number; paint: number }[] {
  const P = plotPlaces(n);
  if (P.plan.street !== 'strip') return [];
  const routes = plotRoutes(n);
  const blocks: Rect[] = [...P.shops.map((sh) => shopFootprint(sh)), ...P.lamps.map((l) => box(l.x, l.z, 0.3, 0.3)), ...plotDecor(n).map((d) => box(d.x, d.z, d.hx, d.hz))];
  const segDist = (x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
  };
  const out: { x: number; z: number; yaw: number; paint: number }[] = [];
  for (const S of P.streets) {
    const d = S.maxZ - S.minZ;
    const z = S.maxZ - d * 0.25;
    const shopsNorth = P.shops.length > 0 && P.shops[0]!.z < z;
    let k = 0;
    for (let x = S.minX + 3; x + 3 < S.maxX - 1; x += 3, k++) {
      // about two bays in three are taken, never the same pattern twice in a row
      if ((k * 7 + n) % 3 === 2) continue;
      const cx = x + 1.5;
      const r = box(cx, z, CAR_HX, CAR_HZ);
      if (blocks.some((b) => b.minX < r.maxX + 0.3 && b.maxX > r.minX - 0.3 && b.minZ < r.maxZ + 0.3 && b.maxZ > r.minZ - 0.3)) continue;
      const clear = routes.every((rt) => rt.pts.every((p, i) => i === 0 || [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([sx, sz]) => segDist(cx + sx! * CAR_HX, z + sz! * CAR_HZ, rt.pts[i - 1]!, p) > ROUTE_HALF + 0.3)));
      if (!clear) continue;
      out.push({ x: cx, z, yaw: shopsNorth ? Math.PI : 0, paint: CAR_PAINTS[(k * 5 + n) % CAR_PAINTS.length]! });
    }
  }
  return out;
}

/** A chunky 1970s saloon with snow on its roof, nose along local +Z (yaw turns it), into the statics batch. */
function buildParkedCar(body: Batch, c: { x: number; z: number; yaw: number; paint: number }): void {
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const put = (g: THREE.BufferGeometry, col: number, lx: number, y: number, lz: number, o: { rx?: number; rz?: number } = {}): void => {
    body.add(g, col, c.x + lx * cs + lz * sn, y, c.z - lx * sn + lz * cs, { ry: c.yaw, ...o });
  };
  const dark = 0x2f3236;
  const chrome = 0xd8dde2;
  // wheels first (under the body), then the long low body, the cabin with its glass band, bumpers, lights, snow
  for (const lx of [-0.56, 0.56]) for (const lz of [-0.72, 0.72]) put(geo.cylinder(0.24, 0.24, 0.18, 10), dark, lx, 0.24, lz, { rz: Math.PI / 2 });
  put(geo.box(1.18, 0.42, 2.2), c.paint, 0, 0.5, 0);
  put(geo.box(1.2, 0.08, 2.24), shade(c.paint, 0.78), 0, 0.33, 0);
  put(geo.box(1.0, 0.38, 1.1), shade(c.paint, 1.06), 0, 0.9, -0.12);
  put(geo.box(1.03, 0.22, 1.0), 0x9fc6dc, 0, 0.9, -0.12);
  put(geo.box(1.06, 0.06, 1.14), SNOW, 0, 1.12, -0.12);
  put(geo.box(0.9, 0.05, 0.6), SNOW, 0, 0.73, 0.72);
  for (const lz of [-1.13, 1.13]) put(geo.box(1.22, 0.1, 0.08), chrome, 0, 0.38, lz);
  for (const lx of [-0.4, 0.4]) {
    put(geo.box(0.2, 0.12, 0.04), 0xfff1c4, lx, 0.56, 1.11);
    put(geo.box(0.18, 0.1, 0.04), 0xd8443a, lx, 0.56, -1.11);
  }
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
    if (snow) this.winter(w, d, y, half);
    return this;
  }
  /**
   * 0.9.12 (Dino: "icicles and snowdrifts"): icicles of steady, varied lengths along both eaves, and soft drifts
   * banked against the side and back walls (never the front, where the door is). The drifts are low and hug the
   * walls: they stand in nobody's way.
   */
  winter(w: number, d: number, eaveY: number, half: number): this {
    const n = Math.max(4, Math.round((w + 0.3) / 0.27));
    for (const s of [1, -1]) {
      for (let k = 0; k < n; k++) {
        const len = 0.1 + (((k * 7 + (s > 0 ? 3 : 0)) % 5) / 4) * 0.26;
        if ((k * 5 + (s > 0 ? 1 : 2)) % 7 === 0) continue;
        this.put(geo.cone(0.045, len, 5), ICE, -(w + 0.3) / 2 + ((k + 0.5) * (w + 0.3)) / n, eaveY - 0.02 - len / 2, s * (half - 0.02), { rx: Math.PI });
      }
    }
    for (const s of [1, -1]) {
      this.put(geo.sphere(0.5, 10, 6), SNOW, s * (w / 2 + 0.12), 0, -d * 0.12, { sx: 0.5, sy: 0.42, sz: d * 0.7 });
      this.put(geo.sphere(0.4, 9, 5), 0xffffff, s * (w / 2 + 0.1), 0.02, -d * 0.3, { sx: 0.45, sy: 0.5, sz: 0.9 });
    }
    this.put(geo.sphere(0.5, 10, 6), SNOW, 0, 0, -(d / 2 + 0.12), { sx: w * 0.75, sy: 0.4, sz: 0.5 });
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
  // a steady pick per hut from its spot, so the same hut keeps its colours across rebuilds
  const pick = Math.abs(Math.round(h.x * 3 + h.z * 7));
  const wall = st.walls ? st.walls[pick % st.walls.length]! : st.wall;
  const roof = st.roofs ? st.roofs[Math.floor(pick / 2) % st.roofs.length]! : st.roof;
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

/** Lowest point of a shop's hanging sign (m): over every head. */
export const SIGN_BOTTOM = 1.95;
/** The default shop's striped awning: from the wall out this far (the hanging signs hang just past its edge). */
const AWNING_OUT = 0.95;

/**
 * 0.9.12 (Dino: "era signs"): the gabled shops of eras II-V hang out a sign over the street, just past the awning's
 * edge, in their era's own style: a carved wooden board on chains from a curled iron bracket in II-IV, an enamel plate
 * in the era's colours on a steel arm in V. Each carries an emblem in the colour of the goods the street trades in. The
 * shops of VI-X already carry their own lit signs. Nothing reaches below SIGN_BOTTOM.
 */
function buildShopSign(body: Batch, n: number, st: PlotStyle, s: ShopPlace, i: number, c: { accent: number }, goods: [number, number]): void {
  if (n > 5 || st.hut === 'deco' || st.hut === 'trailer' || st.hut === 'modular' || st.hut === 'quonset' || st.hut === 'pod') return;
  const f = new Frame(body, s.x, s.z, s.yaw);
  const front = s.d / 2;
  // near one corner (alternating along the street), in the plane across the front
  const x = (i % 2 ? -1 : 1) * (s.w / 2 - 0.3);
  const H = 0.48;
  const Wd = 0.62;
  const z0 = front + AWNING_OUT + 0.06;
  const zc = z0 + Wd / 2;
  const yb = SIGN_BOTTOM + 0.05;
  const yc = yb + H / 2;
  const arm = Math.min(s.h - 0.3, 2.62);
  const metal = n <= 4 ? 0x3a3634 : 0x8a9096;
  // the bracket: out from the wall over the awning, a stay under it, two hangers down to the board
  f.put(geo.box(0.05, 0.05, z0 + Wd + 0.12 - front), metal, x, arm, (front + z0 + Wd + 0.12) / 2);
  f.put(geo.box(0.035, 0.035, 0.55), metal, x, arm + 0.17, front + 0.22, { rx: -0.7 });
  for (const dz of [-Wd / 2 + 0.06, Wd / 2 - 0.06]) f.put(geo.box(0.015, arm - yb - H, 0.015), metal, x, (arm + yb + H) / 2, zc + dz);
  if (n <= 4) {
    f.put(geo.torus(0.06, 0.012, 5, 10), metal, x, arm + 0.05, z0 + Wd + 0.16, { ry: Math.PI / 2 });
    f.put(geo.box(0.07, H, Wd), 0x6b4a32, x, yc, zc);
    f.put(geo.box(0.08, H - 0.08, Wd - 0.08), 0xa47c55, x, yc, zc);
    for (const sx of [-1, 1]) f.put(geo.cylinder(0.14, 0.14, 0.02, 14), goods[0], x + sx * 0.045, yc, zc, { rz: Math.PI / 2 });
  } else {
    f.put(geo.box(0.05, H, Wd), CREAM, x, yc, zc);
    f.put(geo.box(0.06, H - 0.07, Wd - 0.07), c.accent, x, yc, zc);
    for (const sx of [-1, 1]) f.put(geo.cylinder(0.14, 0.14, 0.02, 14), CREAM, x + sx * 0.035, yc, zc, { rz: Math.PI / 2 });
    for (const sx of [-1, 1]) f.put(geo.cylinder(0.09, 0.09, 0.02, 12), goods[0], x + sx * 0.042, yc, zc, { rz: Math.PI / 2 });
  }
  f.put(geo.box(0.1, 0.05, Wd - 0.1), SNOW, x, yb + H + 0.03, zc);
}

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
      // an arcaded deco terrace: a stepped parapet, tall lit windows, a colonnade in front under a shared arcade roof.
      // 0.9.13 (review E6): every third shop is a two-storey one (lit upper windows, a belt course), the signs vary in
      // shape, every other shop carries a vertical blade sign, the odd ones a striped canvas awning past the arcade
      const tall = h > 4;
      f.put(geo.boxBase(w, h, d), wall, 0, 0, 0);
      f.put(geo.box(w + 0.1, 0.22, d + 0.1), st.shopRoof, 0, h + 0.11, 0);
      f.put(geo.boxBase(w * 0.4, tall ? 0.08 : 0.45, 0.3), st.shopRoof, 0, h + 0.22, d / 2 - 0.15);
      // 0.9.13 (review E6): the snow lies inside a patina parapet (so the roofs don't read as one white slab), and each
      // roof carries its own piece: a copper water tank, a stepped deco crown, a lit rooftop sign frame or a skylight
      for (const sx of [-1, 1]) f.put(geo.boxBase(0.16, 0.3, d + 0.1), st.shopRoof, sx * (w / 2 - 0.03), h + 0.22, 0);
      f.put(geo.boxBase(w + 0.1, 0.3, 0.16), st.shopRoof, 0, h + 0.22, -d / 2 + 0.03);
      f.put(geo.box(w - 0.3, 0.05, d - 0.3), SNOW, 0, h + 0.25, 0);
      const rx = (i % 2 ? 1 : -1) * w * 0.18;
      switch (decoRoof(i, h)[0]) {
        case 0:
          for (const [lx, lz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) f.put(geo.boxBase(0.08, 0.7, 0.08), 0x6b5a4a, rx + lx, h + 0.27, -0.3 + lz);
          f.put(geo.cylinder(0.62, 0.62, 0.95, 14), COPPER_ROOF, rx, h + 1.45, -0.3);
          f.put(geo.cone(0.68, 0.4, 14), shade(COPPER_ROOF, 0.85), rx, h + 2.12, -0.3);
          f.put(geo.sphere(0.4, 10, 6), SNOW, rx, h + 2.15, -0.3, { sy: 0.45 });
          break;
        case 1:
          f.put(geo.boxBase(w * 0.42, 0.55, 1.2), shade(wall, 0.95), rx, h + 0.27, -0.2);
          f.put(geo.boxBase(w * 0.26, 0.45, 0.8), st.shopRoof, rx, h + 0.82, -0.2);
          f.put(geo.box(w * 0.26 + 0.06, 0.05, 0.86), SNOW, rx, h + 1.3, -0.2);
          g.put(geo.box(w * 0.3, 0.1, 0.04), mix(WINDOW, accent, 0.3), rx, h + 0.6, 0.42);
          break;
        case 2:
          for (const lx of [-w * 0.3, w * 0.3]) f.put(geo.boxBase(0.07, 1.1, 0.07), 0x3a3d44, lx, h + 0.27, -0.6);
          f.put(geo.box(w * 0.66, 0.5, 0.08), shade(st.shopRoof, 0.8), 0, h + 1.15, -0.6);
          g.put(geo.box(w * 0.58, 0.14, 0.05), mix(WINDOW, accent, 0.4), 0, h + 1.15, -0.55);
          f.put(geo.box(w * 0.66 + 0.06, 0.05, 0.14), SNOW, 0, h + 1.42, -0.6);
          break;
        case 3:
          f.put(geo.box(w * 0.3, 0.3, 0.9), 0x8fb8c4, rx, h + 0.4, -0.2, { rx: -0.35 });
          f.put(geo.box(w * 0.3 + 0.1, 0.06, 0.2), SNOW, rx, h + 0.58, -0.45);
      }
      g.put(geo.box(w - 1.6, 1.5, 0.06), WINDOW, -0.4, 1.3, d / 2 + 0.03);
      f.put(geo.box(0.8, 1.7, 0.1), shade(st.shopRoof, 0.95), w / 2 - 0.7, 0.85, d / 2 + 0.01);
      const sy = tall ? h - 0.25 : h - 0.5;
      const sv = i % 3;
      if (sv === 0) {
        sign(sy, d / 2 + 0.03);
      } else if (sv === 1) {
        // a round medallion
        f.put(geo.cylinder(0.36, 0.36, 0.08, 18), CREAM, 0, sy, d / 2 + 0.05, { rx: Math.PI / 2 });
        f.put(geo.cylinder(0.24, 0.24, 0.06, 16), accent, 0, sy, d / 2 + 0.1, { rx: Math.PI / 2 });
        f.put(geo.box(w * 0.5, 0.08, 0.06), CREAM, 0, sy - 0.42, d / 2 + 0.04);
      } else {
        // a diamond
        f.put(geo.box(0.62, 0.62, 0.08), CREAM, 0, sy, d / 2 + 0.05, { rz: Math.PI / 4 });
        f.put(geo.box(0.4, 0.4, 0.06), accent, 0, sy, d / 2 + 0.09, { rz: Math.PI / 4 });
      }
      if (tall) {
        // the belt course between the storeys and two lit upper windows
        f.put(geo.box(w + 0.1, 0.16, 0.12), accent, 0, 2.95, d / 2 + 0.03);
        for (const x of [-w / 4, w / 4]) {
          f.put(geo.box(w * 0.3 + 0.12, 0.78, 0.05), shade(wall, 0.7), x, 3.4, d / 2 + 0.02);
          g.put(geo.box(w * 0.3, 0.66, 0.05), WINDOW, x, 3.4, d / 2 + 0.05);
          f.put(geo.box(w * 0.3 + 0.2, 0.05, 0.14), CREAM, x, 3.0, d / 2 + 0.07);
        }
      }
      // the arcade: two columns per shop and a roof slab joining the terrace
      f.put(geo.box(w + 0.12, 0.18, 1.3), st.shopRoof, 0, 2.55, d / 2 + 0.65);
      f.put(geo.box(w + 0.12, 0.05, 1.3), SNOW, 0, 2.67, d / 2 + 0.65);
      for (const x of [-w / 2 + 0.2, w / 4]) f.put(geo.cylinder(0.13, 0.15, 2.45, 10), CREAM, x, 1.22, d / 2 + 1.15);
      if (i % 2 === 0) {
        // the blade sign: a tall vertical board at one front corner with a lit strip of letters
        const bx = (i % 4 === 0 ? -1 : 1) * (w / 2 - 0.2);
        const yt = tall ? h + 0.15 : h + 0.7;
        const yb = 2.85;
        f.put(geo.box(0.34, yt - yb, 0.12), shade(st.shopRoof, 0.9), bx, (yt + yb) / 2, d / 2 + 0.07);
        g.put(geo.box(0.12, yt - yb - 0.3, 0.04), mix(WINDOW, accent, 0.3), bx, (yt + yb) / 2, d / 2 + 0.15);
        f.put(geo.box(0.4, 0.05, 0.18), SNOW, bx, yt + 0.025, d / 2 + 0.07);
        for (const y of [yb + 0.1, yt - 0.1]) f.put(geo.box(0.05, 0.05, 0.2), 0x3a3d44, bx, y, d / 2 + 0.1);
      } else {
        // a striped canvas awning on a slope from the arcade's edge, a valance on its lip
        const nA = Math.max(5, Math.round(w / 0.5));
        const z0 = d / 2 + 1.2;
        for (let k = 0; k < nA; k++) {
          const col = k % 2 ? CREAM : accent;
          const x = -w / 2 + ((k + 0.5) * w) / nA;
          f.put(geo.box(w / nA, 0.04, 0.82), col, x, 2.44, z0 + 0.4, { rx: 0.43 });
          f.put(geo.box(w / nA, 0.18, 0.04), col, x, 2.2, z0 + 0.8);
        }
        f.put(geo.box(w, 0.04, 0.78), SNOW, 0, 2.5, z0 + 0.4, { rx: 0.43 });
      }
      break;
    }
    case 'trailer': {
      // a low roadside store: a long flat roof with a big lit sign, a wide window and a bench by the door.
      // 0.9.13 (review E6): every third shop is a two-storey one (a set-back upper container with lit windows, the big sign
      // on its ground-floor fascia), the even ones carry a striped canvas awning over the window, one a roadside pole sign
      const tall = h > 4;
      const pole = i === 1 && !tall;
      const hl = tall ? 2.9 : h;
      f.put(geo.boxBase(w, hl, d), wall, 0, 0, 0);
      const rw = pole ? w + 0.2 : w + 0.6;
      f.put(geo.box(rw, 0.22, d + 0.9), st.shopRoof, 0, hl + 0.11, 0.3);
      f.put(geo.box(rw, 0.05, d + 0.9), SNOW, 0, hl + 0.24, 0.3);
      if (tall) {
        f.put(geo.boxBase(w - 0.8, h - hl - 0.22, d - 0.9), shade(wall, 0.96), 0, hl + 0.22, -0.35);
        f.put(geo.box(w - 0.7, 0.12, d - 0.8), shade(st.shopRoof, 0.9), 0, h + 0.06, -0.35);
        f.put(geo.box(w - 0.72, 0.05, d - 0.82), SNOW, 0, h + 0.14, -0.35);
        const fz = -0.35 + (d - 0.9) / 2;
        f.put(geo.box(w - 2.0, 0.66, 0.05), shade(wall, 0.65), 0, hl + 0.7, fz + 0.01);
        g.put(geo.box(w - 2.2, 0.52, 0.05), WINDOW, 0, hl + 0.7, fz + 0.04);
        f.put(geo.box(w * 0.8, 0.6, 0.12), CREAM, 0, hl - 0.5, d / 2 - 0.2);
        g.put(geo.box(w * 0.65, 0.34, 0.05), mix(WINDOW, accent, 0.35), 0, hl - 0.5, d / 2 - 0.12);
      } else {
        f.put(geo.box(w * 0.8, 0.7, 0.12), CREAM, 0, h + 0.6, d / 2 - 0.2);
        g.put(geo.box(w * 0.65, 0.35, 0.05), mix(WINDOW, accent, 0.35), 0, h + 0.6, d / 2 - 0.12);
      }
      g.put(geo.box(w - 2.2, 1.1, 0.06), WINDOW, -0.6, 1.2, d / 2 + 0.03);
      f.put(geo.box(0.9, 1.7, 0.1), 0xdedad2, w / 2 - 0.8, 0.85, d / 2 + 0.01);
      f.put(geo.boxBase(1.4, 0.45, 0.45), shade(st.shopRoof, 0.85), -w / 2 + 1.0, 0, d / 2 + 0.5);
      if (i % 2 === 0) {
        // a striped canvas awning over the window, its lip past the roof edge, never under head height
        const aw = w - 2.0;
        const nA = Math.max(5, Math.round(aw / 0.5));
        for (let k = 0; k < nA; k++) {
          const col = k % 2 ? CREAM : accent;
          const x = -0.6 + (-aw / 2 + ((k + 0.5) * aw) / nA);
          f.put(geo.box(aw / nA, 0.04, 1.3), col, x, 2.2, d / 2 + 0.55, { rx: 0.3 });
          f.put(geo.box(aw / nA, 0.16, 0.04), col, x, 1.99, d / 2 + 1.14);
        }
      }
      if (pole) {
        // the roadside pole sign: a steel pole at the front corner and a lit panel above the roof
        const px = w / 2 + 0.2;
        const pz = d / 2 + 0.2;
        f.put(geo.cylinder(0.05, 0.06, h + 0.75, 8), 0xdedad2, px, (h + 0.75) / 2, pz);
        f.put(geo.box(0.9, 0.75, 0.14), shade(st.shopRoof, 0.9), px - 0.2, h + 0.5, pz);
        g.put(geo.box(0.74, 0.58, 0.05), WINDOW, px - 0.2, h + 0.5, pz + 0.08);
        f.put(geo.box(0.5, 0.1, 0.06), accent, px - 0.2, h + 0.65, pz + 0.12);
        f.put(geo.box(0.92, 0.05, 0.16), SNOW, px - 0.2, h + 0.89, pz);
      }
      break;
    }
    case 'modular': {
      // 0.9.13 (review EM2): three silhouettes by index (pavilion with a canopy blade / two storeys with a rooftop sign /
      // a set-back upper storey with a planter strip), the canopy and accent colour cycling through the era's palette.
      const rf = st.roofs ?? [st.shopRoof];
      const acc = rf[i % rf.length]!;
      const v = i % 3;
      const glassY = (y0: number, y1: number): void => {
        g.put(geo.box(w - 0.5, y1 - y0, 0.05), 0xbfeff0, 0, (y0 + y1) / 2, d / 2 - 0.15);
        for (const x of [-w / 2 + 0.15, -w / 6, w / 6, w / 2 - 0.15]) f.put(geo.box(0.08, y1 - y0, 0.1), wall, x, (y0 + y1) / 2, d / 2 - 0.12);
      };
      f.put(geo.boxBase(w, 0.2, d), 0xd6d4cc, 0, 0, 0);
      if (v === 0) {
        f.put(geo.boxBase(w - 0.2, h - 0.3, d - 0.4), shade(wall, 0.96), 0, 0.2, -0.2);
        f.put(geo.box(w + 0.3, 0.18, d + 0.2), wall, 0, h, 0);
        f.put(geo.box(w + 0.32, 0.05, d + 0.22), SNOW, 0, h + 0.11, 0);
        glassY(0.2, h - 0.15);
        // the canopy blade, with a bright fascia
        f.put(geo.box(w * 0.55, 0.08, 1.0), acc, -w * 0.15, 2.3, d / 2 + 0.35);
        f.put(geo.box(w * 0.55, 0.16, 0.06), shade(acc, 0.85), -w * 0.15, 2.26, d / 2 + 0.85);
        f.put(geo.box(w * 0.4, 0.3, 0.06), acc, -w * 0.15, h - 0.35, d / 2 - 0.08);
      } else if (v === 1) {
        // lower glazed storey, a cantilevered upper storey with lit windows, a sign box on the roof
        f.put(geo.boxBase(w - 0.2, 1.8, d - 0.4), shade(wall, 0.96), 0, 0.2, -0.2);
        glassY(0.2, 1.95);
        f.put(geo.box(w, 0.14, d - 0.1), acc, 0, 2.03, -0.05);
        f.put(geo.boxBase(w - 0.1, h - 2.1, d - 0.1), wall, 0, 2.1, -0.05);
        for (const x of [-w / 3, 0, w / 3]) {
          f.put(geo.box(w * 0.22 + 0.1, 0.62, 0.05), shade(wall, 0.7), x, 2.1 + (h - 2.1) / 2, d / 2 - 0.1);
          g.put(geo.box(w * 0.22, 0.52, 0.05), 0xbfeff0, x, 2.1 + (h - 2.1) / 2, d / 2 - 0.08);
        }
        f.put(geo.box(w + 0.1, 0.16, d), wall, 0, h + 0.08, -0.05);
        f.put(geo.box(w + 0.12, 0.05, d + 0.02), SNOW, 0, h + 0.18, -0.05);
        f.put(geo.boxBase(w * 0.42, 0.6, 0.26), wall, -w * 0.2, h + 0.16, d / 2 - 0.45);
        g.put(geo.box(w * 0.34, 0.4, 0.05), mix(WINDOW, acc, 0.45), -w * 0.2, h + 0.46, d / 2 - 0.3);
      } else {
        // lower glazed storey under a flat slab edged with a planter, a smaller upper storey set back
        const lh = 2.45;
        f.put(geo.boxBase(w - 0.2, lh - 0.2, d - 0.4), shade(wall, 0.96), 0, 0.2, -0.2);
        glassY(0.2, lh - 0.2);
        f.put(geo.box(w + 0.1, 0.18, d - 0.05), wall, 0, lh, -0.02);
        f.put(geo.box(w + 0.12, 0.05, d - 0.03), SNOW, 0, lh + 0.11, -0.02);
        f.put(geo.boxBase(w - 0.3, 0.2, 0.34), shade(acc, 0.8), 0, lh + 0.1, d / 2 - 0.3);
        const nb = Math.max(5, Math.round(w / 0.5));
        for (let k = 0; k < nb; k++) {
          const x = -w / 2 + 0.3 + (k * (w - 0.6)) / (nb - 1);
          f.put(geo.sphere(0.17, 7, 5), k % 3 === 1 ? acc : 0x7fae6a, x, lh + 0.38, d / 2 - 0.3);
        }
        const uh = Math.max(0.95, h - lh + 0.25);
        f.put(geo.boxBase(w - 1.3, uh, d - 1.3), wall, 0, lh + 0.1, -0.5);
        f.put(geo.box(w - 1.1, 0.14, d - 1.1), acc, 0, lh + 0.1 + uh + 0.05, -0.5);
        g.put(geo.box(w - 1.9, uh - 0.4, 0.05), 0xbfeff0, 0, lh + 0.1 + uh / 2, d / 2 - 1.15 + 0.03);
        f.put(geo.box(w * 0.4, 0.07, 0.75), acc, w * 0.2, 2.2, d / 2 + 0.15);
      }
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
      // a dome shop: a drum with a glowing band of windows under a dome in the era's cycling colours; even shops add a
      // small side dome, odd ones a crown antenna ring (0.9.13, review EM2)
      const rc = st.roofs ? st.roofs[i % st.roofs.length]! : st.shopRoof;
      const r = Math.min(w, d) / 2;
      const top = 0.2 + h;
      f.put(geo.cylinder(r + 0.15, r + 0.25, 0.2, 22), 0xd9dae6, 0, 0.1, 0);
      f.put(geo.cylinder(r, r, h - r * 0.55, 22), wall, 0, 0.2 + (h - r * 0.55) / 2, 0);
      f.put(geo.sphere(r, 22, 10), rc, 0, 0.2 + h - r * 0.55, 0, { sy: 0.55 });
      f.put(geo.sphere(r * 0.6, 14, 6), SNOW, 0, 0.2 + h - r * 0.1, 0, { sy: 0.18 });
      g.put(geo.torus(r + 0.01, 0.09, 6, 30), mix(0xe6dcff, rc, 0.25), 0, 1.5, 0, { rx: Math.PI / 2 });
      f.put(geo.box(1.0, 1.6, 0.4), shade(wall, 0.92), 0, 0.8, r - 0.1);
      f.put(geo.box(0.7, 1.4, 0.06), rc, 0, 0.72, r + 0.12);
      if (i % 2 === 0) {
        const r2 = Math.min(0.55, r * 0.3);
        const x2 = (i % 4 === 0 ? 1 : -1) * (w / 2 - r2);
        const z2 = -(d / 2 - r2);
        const h2 = 1.5;
        f.put(geo.cylinder(r2, r2, h2, 14), shade(wall, 0.96), x2, 0.2 + h2 / 2, z2);
        f.put(geo.sphere(r2, 14, 8), shade(rc, 1.08), x2, 0.2 + h2, z2, { sy: 0.6 });
        f.put(geo.sphere(r2 * 0.55, 10, 5), SNOW, x2, 0.2 + h2 + r2 * 0.4, z2, { sy: 0.2 });
        g.put(geo.box(0.22, 0.4, 0.04), WINDOW, x2, 1.0, z2 + r2 + 0.005);
      } else {
        const mast = 0.55;
        f.put(geo.cylinder(0.03, 0.03, mast, 6), 0xb8b6c6, 0, top + r * 0.08 + mast / 2 - 0.05, 0);
        g.put(geo.torus(0.26, 0.04, 6, 18), mix(0xe6dcff, rc, 0.25), 0, top + r * 0.08 + mast * 0.6, 0, { rx: Math.PI / 2 });
        g.put(geo.sphere(0.07, 6, 5), WINDOW, 0, top + r * 0.08 + mast, 0);
      }
      goodsOut();
      break;
    }
    case 'cottage': {
      // era 3 (review EM2): a half-timbered forge-shop on a rubble plinth, a steep roof, a slatted wooden canopy on two
      // iron brackets and a lantern by the door
      const stone = i % 2 ? 0x9a948a : 0x8a8479;
      const timber = i % 2 ? 0x5a4130 : 0x6b4a32;
      const roofC = i % 2 ? st.shopRoof : shade(st.shopRoof, 0.84);
      const iron = 0x3a3634;
      const sb = 0.95;
      const doorX = w / 2 - 0.75;
      const zt = d / 2 - 0.03;
      f.put(geo.boxBase(w - 0.06, sb, d - 0.06), stone, 0, 0, 0);
      for (let k = 0; k < 9; k++) {
        f.put(geo.box(0.42, 0.24, 0.05), k % 2 ? shade(stone, 1.12) : shade(stone, 0.88), -w / 2 + 0.35 + k * ((w - 0.7) / 8), 0.2 + ((k * 5 + i) % 3) * 0.28, d / 2 - 0.03);
      }
      f.put(geo.box(w, 0.08, d), shade(stone, 0.78), 0, sb, 0);
      f.put(geo.boxBase(w - 0.1, h - sb, d - 0.1), wall, 0, sb, 0);
      // timber frame: posts, rails and two braces in the upper panels
      for (const x of [-w / 2 + 0.08, 0, doorX - 0.55, w / 2 - 0.08]) f.put(geo.box(0.13, h - sb, 0.06), timber, x, (sb + h) / 2, zt);
      for (const y of [sb + 0.06, 2.1, h - 0.06]) f.put(geo.box(w - 0.1, 0.12, 0.06), timber, 0, y, zt);
      const ph = h - 0.06 - 2.16 - 0.06;
      for (const [a, b, sg] of [[-w / 2 + 0.08, 0, 1], [doorX - 0.55, w / 2 - 0.08, -1]] as const) {
        const bw = b - a - 0.13;
        f.put(geo.box(Math.hypot(bw, ph), 0.09, 0.06), timber, (a + b) / 2, 2.16 + 0.06 + ph / 2, zt, { rz: sg * Math.atan2(ph, bw) });
      }
      f.put(geo.box(0.55, 0.22, 0.05), accent, (0 + doorX - 0.55) / 2, (2.16 + h) / 2, zt + 0.01);
      // window and door
      f.put(geo.box(1.5, 0.98, 0.05), shade(wall, 0.62), -0.8, 1.55, zt);
      g.put(geo.box(1.3, 0.78, 0.05), WINDOW, -0.8, 1.55, zt + 0.015);
      f.put(geo.box(0.04, 0.78, 0.03), timber, -0.8, 1.55, zt + 0.045);
      f.put(geo.box(1.3, 0.04, 0.03), timber, -0.8, 1.55, zt + 0.045);
      f.put(geo.box(0.8, 1.6, 0.1), shade(st.shopRoof, 0.95), doorX, 0.8, d / 2 + 0.01);
      f.put(geo.box(1.0, 0.12, 0.1), timber, doorX, 1.68, d / 2);
      // a lantern by the door
      f.put(geo.box(0.04, 0.04, 0.12), iron, w / 2 - 0.22, 1.98, d / 2 + 0.03);
      f.put(geo.box(0.12, 0.03, 0.12), iron, w / 2 - 0.22, 1.9, d / 2 + 0.09).put(geo.box(0.12, 0.03, 0.12), iron, w / 2 - 0.22, 1.74, d / 2 + 0.09);
      g.put(geo.box(0.08, 0.14, 0.08), WINDOW, w / 2 - 0.22, 1.82, d / 2 + 0.09);
      // steep roof and a stone chimney
      f.gable(w, d, h, 1.05, roofC);
      f.put(geo.boxBase(0.5, 1.25, 0.5), stone, -w / 2 + 0.75, h + 0.3, -d / 4);
      f.put(geo.box(0.62, 0.08, 0.62), shade(stone, 0.8), -w / 2 + 0.75, h + 1.55, -d / 4);
      // slatted wooden canopy on two iron brackets
      const n = Math.round((w - 0.2) / 0.28);
      for (let k = 0; k < n; k++) f.put(geo.box(0.2, 0.04, 0.88), k % 2 ? shade(timber, 1.25) : shade(timber, 1.45), -(w - 0.3) / 2 + (k * (w - 0.3)) / (n - 1), 2.32, d / 2 + 0.46, { rx: 0.3 });
      f.put(geo.box(w - 0.1, 0.07, 0.07), iron, 0, 2.16, d / 2 + 0.88).put(geo.box(w - 0.1, 0.07, 0.07), iron, 0, 2.45, d / 2 + 0.05);
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.65);
        f.put(geo.box(0.05, 0.05, 0.9), iron, x, 2.14, d / 2 + 0.46);
        f.put(geo.box(0.04, 0.04, 1.08), iron, x, 2.52, d / 2 + 0.455, { rx: 0.66 });
        f.put(geo.torus(0.07, 0.015, 5, 10), iron, x, 2.14, d / 2 + 0.92, { ry: Math.PI / 2 });
      }
      goodsOut();
      break;
    }
    case 'row': {
      // era 4 (review EM2): a brick shop front with a tall arched window, quoins, a chimney pot and a cast-iron and glass canopy
      const iron = 0x2f4a3c;
      const brass = 0xc9a24a;
      const stoneC = 0xcfc8ba;
      const roofC = i % 2 ? st.shopRoof : shade(st.shopRoof, 0.86);
      const doorX = w / 2 - 0.75;
      f.put(geo.boxBase(w, 0.5, d), 0x6b6f72, 0, 0, 0);
      f.put(geo.boxBase(w - 0.1, h - 0.5, d - 0.1), wall, 0, 0.5, 0);
      for (const sx of [-1, 1]) {
        for (let k = 0, y = 0.7; y < h - 0.25; k++, y += 0.4) {
          const qw = k % 2 ? 0.16 : 0.26;
          f.put(geo.box(qw, 0.2, 0.1), stoneC, sx * (w / 2 - qw / 2), y, d / 2 - 0.05);
        }
      }
      f.put(geo.box(w, 0.12, d), stoneC, 0, h - 0.06, 0);
      // the tall arched shop window
      f.put(geo.box(1.6, 1.2, 0.06), stoneC, -0.8, 1.35, d / 2 - 0.02).put(geo.cylinder(0.8, 0.8, 0.06, 18), stoneC, -0.8, 1.95, d / 2 - 0.02, { rx: Math.PI / 2 });
      g.put(geo.box(1.4, 1.1, 0.05), WINDOW, -0.8, 1.35, d / 2 + 0.005).put(geo.cylinder(0.7, 0.7, 0.05, 16), WINDOW, -0.8, 1.95, d / 2 + 0.005, { rx: Math.PI / 2 });
      f.put(geo.box(0.04, 1.85, 0.03), iron, -0.8, 1.72, d / 2 + 0.035);
      f.put(geo.box(1.4, 0.04, 0.03), iron, -0.8, 1.35, d / 2 + 0.035).put(geo.box(1.4, 0.04, 0.03), iron, -0.8, 1.95, d / 2 + 0.035);
      f.put(geo.box(1.8, 0.07, 0.14), stoneC, -0.8, 0.74, d / 2);
      // door, fanlight, brass plaque
      f.put(geo.box(0.8, 1.6, 0.1), iron, doorX, 0.8, d / 2 + 0.01);
      f.put(geo.sphere(0.04, 6, 4), brass, doorX + 0.28, 0.85, d / 2 + 0.07);
      g.put(geo.box(0.7, 0.2, 0.05), WINDOW, doorX, 1.74, d / 2 + 0.02);
      f.put(geo.box(0.9, 0.2, 0.05), brass, doorX, 2.02, d / 2 + 0.0);
      // roof and chimney with pots
      f.gable(w, d, h, 0.8, roofC);
      f.put(geo.boxBase(0.6, 1.0, 0.5), shade(wall, 0.85), -w / 2 + 0.8, h + 0.2, -d / 4);
      f.put(geo.box(0.7, 0.08, 0.6), stoneC, -w / 2 + 0.8, h + 1.2, -d / 4);
      for (const dx of [-0.14, 0.14]) f.put(geo.cylinder(0.09, 0.11, 0.3, 8), 0xb0623f, -w / 2 + 0.8 + dx, h + 1.39, -d / 4);
      // cast-iron and glass canopy: tension rods, ribs, pale panes, a scalloped valance
      const nr = 5;
      const span = w - 0.4;
      for (let k = 0; k < nr; k++) f.put(geo.box(0.05, 0.06, 0.9), iron, -span / 2 + (k * span) / (nr - 1), 2.4, d / 2 + 0.46, { rx: 0.3 });
      for (let k = 0; k < nr - 1; k++) f.put(geo.box(span / (nr - 1) - 0.07, 0.025, 0.82), 0xcfe3e0, -span / 2 + ((k + 0.5) * span) / (nr - 1), 2.42, d / 2 + 0.46, { rx: 0.3 });
      f.put(geo.box(w - 0.2, 0.07, 0.07), iron, 0, 2.27, d / 2 + 0.87).put(geo.box(w - 0.2, 0.07, 0.07), iron, 0, 2.53, d / 2 + 0.05);
      const nv = Math.round(w / 0.4);
      for (let k = 0; k < nv; k++) f.put(geo.cylinder(0.1, 0.1, 0.03, 8), iron, -(w - 0.5) / 2 + (k * (w - 0.5)) / (nv - 1), 2.2, d / 2 + 0.87, { rx: Math.PI / 2 });
      for (const sx of [-1, 1]) {
        f.put(geo.box(0.04, 0.04, 1.02), iron, sx * (w / 2 - 0.6), 2.535, d / 2 + 0.435, { rx: 0.545 });
        f.put(geo.sphere(0.05, 6, 4), brass, sx * (w / 2 - 0.1), 2.3, d / 2 + 0.87);
      }
      goodsOut();
      break;
    }
    case 'bunk': {
      // era 5 (review EM2): a corrugated works-store: ribbed steel cladding, a roller-shutter door, an enamel sign band,
      // a flat steel canopy and a parapet roof (a clerestory monitor on every other shop, a stack on the rest)
      const steel = 0x5c6670;
      const base = shade(wall, 0.82);
      const doorX = w / 2 - 0.95;
      f.put(geo.boxBase(w, 0.3, d), 0x77797c, 0, 0, 0);
      f.put(geo.boxBase(w - 0.08, h - 0.3, d - 0.08), base, 0, 0.3, 0);
      const stripH = h - 0.3 - 0.1;
      const nF = Math.round(w / 0.17);
      const pF = (w - 0.08) / nF;
      for (let k = 0; k < nF; k++) {
        const x = -(w - 0.08) / 2 + (k + 0.5) * pF;
        if ((x > doorX - 0.85 && x < doorX + 0.85) || (x > -w / 2 + 0.3 && x < -w / 2 + 2.0)) continue;
        f.put(geo.box(pF * 0.72, stripH, 0.04), k % 2 ? shade(wall, 1.08) : wall, x, 0.3 + stripH / 2, d / 2 - 0.02);
      }
      const nS = Math.round(d / 0.3);
      for (const sx of [-1, 1]) {
        for (let k = 0; k < nS; k++) f.put(geo.box(0.04, stripH, ((d - 0.08) / nS) * 0.72), k % 2 ? shade(wall, 1.08) : wall, sx * (w / 2 - 0.02), 0.3 + stripH / 2, -(d - 0.08) / 2 + ((k + 0.5) * (d - 0.08)) / nS);
      }
      // roller-shutter door: housing, panel, slats
      f.put(geo.box(1.56, 0.3, 0.14), steel, doorX, 2.05, d / 2);
      f.put(geo.boxBase(1.4, 1.9, 0.06), shade(steel, 1.15), doorX, 0, d / 2 - 0.01);
      for (let k = 0; k < 9; k++) f.put(geo.box(1.4, 0.035, 0.02), shade(steel, 0.8), doorX, 0.2 + k * 0.2, d / 2 + 0.03);
      // lit shop window
      f.put(geo.box(1.7, 1.0, 0.06), steel, -w / 2 + 1.2, 1.5, d / 2 - 0.01);
      g.put(geo.box(1.5, 0.8, 0.05), WINDOW, -w / 2 + 1.2, 1.5, d / 2 + 0.03);
      for (const dx of [-0.25, 0.25]) f.put(geo.box(0.04, 0.8, 0.03), steel, -w / 2 + 1.2 + dx, 1.5, d / 2 + 0.06);
      // enamel sign band
      const sy = h - 0.33;
      f.put(geo.box(w - 0.3, 0.46, 0.06), CREAM, 0, sy, d / 2 - 0.01);
      f.put(geo.box(w - 0.42, 0.34, 0.06), accent, 0, sy, d / 2 + 0.005);
      for (let k = 0; k < 5; k++) f.put(geo.box(0.22 + (k % 2) * 0.12, 0.14, 0.02), CREAM, (k - 2) * 0.55, sy, d / 2 + 0.04);
      // parapet roof
      f.put(geo.box(w, 0.16, d), shade(base, 0.8), 0, h + 0.08, 0);
      const pc = shade(wall, 0.9);
      f.put(geo.box(w, 0.32, 0.12), pc, 0, h + 0.3, d / 2 - 0.06).put(geo.box(w, 0.32, 0.12), pc, 0, h + 0.3, -d / 2 + 0.06);
      for (const sx of [-1, 1]) f.put(geo.box(0.12, 0.32, d - 0.24), pc, sx * (w / 2 - 0.06), h + 0.3, 0);
      f.put(geo.box(w - 0.24, 0.05, d - 0.24), SNOW, 0, h + 0.18, 0);
      if (i % 2) {
        f.put(geo.boxBase(w * 0.5, 0.55, d * 0.35), base, 0, h + 0.16, -0.3);
        f.put(geo.box(w * 0.54, 0.08, d * 0.39), steel, 0, h + 0.74, -0.3);
        g.put(geo.box(w * 0.44, 0.26, 0.05), WINDOW, 0, h + 0.46, -0.3 + d * 0.175 + 0.005);
      } else {
        f.put(geo.cylinder(0.15, 0.19, 1.3, 10), steel, -w / 2 + 0.6, h + 0.8, -d / 4);
        f.put(geo.cylinder(0.22, 0.17, 0.12, 10), shade(steel, 0.8), -w / 2 + 0.6, h + 1.5, -d / 4);
      }
      // flat steel canopy on two tie rods
      f.put(geo.box(w - 0.2, 0.07, 0.9), shade(steel, 1.2), 0, 2.25, d / 2 + 0.47, { rx: 0.08 });
      f.put(geo.box(w - 0.2, 0.14, 0.05), steel, 0, 2.19, d / 2 + 0.92);
      for (const sx of [-1, 1]) f.put(geo.box(0.04, 0.04, 1.05), steel, sx * (w / 2 - 0.55), 2.52, d / 2 + 0.45, { rx: 0.56 });
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
      stripe(2.25, d / 2 + AWNING_OUT / 2 - 0.025, AWNING_OUT, 0.38);
      // goods outside: a crate and a barrel in the era's resource colours
      goodsOut();
    }
  }
}

/** 0.9.13 (E1): one of three sizes (0.72, 1, 1.3), each with a little jitter, so no two blobs in a row match. */
const size = (rng: Rng): number => rng.pick([0.72, 1, 1.3]) * rng.range(0.92, 1.08);

/** A rounded heap / ridge / crystal / pool along a bed rect (rows along X). */
function buildBed(body: Batch, glow: Batch, kind: BedKind, color: number, r: Rect, rng: Rng, lit: boolean): void {
  const cz = (r.minZ + r.maxZ) / 2;
  const dz = r.maxZ - r.minZ;
  const len = r.maxX - r.minX;
  // a raked strip under every bed (0.9.12, T4: under an ore node or a quartz cluster it is a soft round worn patch, not a pale square)
  if (kind === 'outcrop' || kind === 'crystals') body.add(geo.circleGround(1, 28), mix(color, SNOW, 0.6), (r.minX + r.maxX) / 2, 0.02, cz, { sx: len / 2 + 0.55, sz: dz / 2 + 0.7 });
  else {
    // 0.9.13 (E1): a run of overlapping worked patches, each turned and sized its own way, so the beds stop reading as ruled stripes
    for (let x = r.minX + 0.6, k = 0; x < r.maxX - 0.3; x += rng.range(1.6, 2.6), k++) {
      body.add(geo.circleGround(1, 16), shade(mix(color, SNOW, 0.72), rng.range(0.96, 1.03)), x, 0.02 + (k % 5) * 0.0004, cz + rng.range(-0.2, 0.2), { sx: rng.range(1.2, 2.0), sz: dz / 2 + rng.range(0.15, 0.5), ry: rng.range(-0.35, 0.35) });
    }
  }
  const glowTo = lit ? glow : body;
  switch (kind) {
    case 'dunes': {
      // 0.9.10: rows of small wind-sculpted silica dunes: a low skirt, a tall crest leaning downwind with snow on its
      // top, so the sand field reads in 3D instead of flat ovals
      const seg = Math.max(1, Math.round(len / 3.4));
      for (let k = 0; k < seg; k++) {
        const x = r.minX + ((k + 0.5) * len) / seg + rng.range(-0.3, 0.3);
        const sx = len / seg / 2 - 0.2;
        const h = size(rng) * 1.05;
        body.add(geo.sphere(1, 14, 8), color, x, 0, cz, { sx, sy: 0.4 * h, sz: dz / 2 + 0.15, ry: rng.range(-0.15, 0.15) });
        body.add(geo.sphere(1, 14, 8), shade(color, 1.05), x - sx * 0.15, 0, cz - dz * 0.08, { sx: sx * 0.7, sy: 0.95 * h, sz: dz * 0.26 });
        body.add(geo.sphere(1, 12, 6), SNOW, x - sx * 0.15, 0.16, cz - dz * 0.08, { sx: sx * 0.42, sy: 0.86 * h, sz: dz * 0.15 });
      }
      break;
    }
    case 'ridges': {
      // 0.9.13 (E1): spoil ridges of different lengths and heights, a little off the line and turned, gaps between some
      for (let x0 = r.minX + 0.2; x0 < r.maxX - 1.2; ) {
        const seg = Math.min(rng.range(2.4, 6.5), r.maxX - 0.2 - x0);
        const v = size(rng);
        const sx = seg / 2 - 0.15;
        const x = x0 + seg / 2;
        const z = cz + rng.range(-0.25, 0.25);
        const ry = rng.range(-0.2, 0.2);
        body.add(geo.sphere(1, 14, 8), shade(color, rng.range(0.94, 1.05)), x, 0, z, { sx, sy: 0.62 * v, sz: (dz / 2) * Math.min(1.1, 0.8 + v * 0.25), ry });
        body.add(geo.sphere(1, 12, 6), mix(color, SNOW, 0.75), x, 0.12, z - dz * 0.05, { sx: sx * 0.6, sy: 0.55 * v, sz: dz * 0.25, ry });
        x0 += seg + (rng.next() < 0.3 ? rng.range(0.8, 1.8) : 0.1);
      }
      if (lit) for (let x = r.minX + 1; x < r.maxX - 1; x += rng.range(1.5, 2.6)) glow.add(geo.sphere(0.09, 6, 4), 0xffa45a, x, 0.55, cz + dz * 0.35);
      break;
    }
    case 'heaps': {
      for (let x = r.minX + 0.9; x < r.maxX - 0.8; x += rng.range(1.4, 2.6)) {
        if (rng.next() < 0.14) continue; // a clearing
        const s = 0.7 * size(rng);
        const z = cz + rng.range(-0.3, 0.3);
        const ry = rng.range(0, Math.PI);
        body.add(geo.sphere(1, 12, 7), shade(color, rng.range(0.92, 1.06)), x, 0, z, { sx: s * rng.range(0.95, 1.25), sy: s * rng.range(0.7, 0.9), sz: Math.min(s, dz / 2 + 0.1), ry });
        body.add(geo.sphere(0.6, 10, 5), mix(color, SNOW, 0.8), x, s * 0.5, z, { sx: s * 0.7, sy: 0.4, sz: s * 0.7, ry });
        // now and then a few loose lumps rolled off the heap
        if (rng.next() < 0.35) for (let j = 0; j < 3; j++) body.add(geo.dodecahedron(rng.range(0.1, 0.18)), shade(color, rng.range(0.9, 1.1)), x + rng.range(-1, 1) * s * 1.3, 0.06, z + rng.range(0.5, 1) * s, { ry: rng.range(0, 6) });
      }
      break;
    }
    case 'slabs': {
      for (let x = r.minX + 0.7; x < r.maxX - 0.6; x += rng.range(1.1, 1.9)) {
        if (rng.next() < 0.12) continue;
        const v = size(rng);
        const h = rng.range(0.14, 0.3) * v;
        const ry = rng.range(-0.45, 0.45);
        body.add(geo.boxBase(rng.range(0.7, 1.05) * v, h, dz * 0.8 * Math.min(1.1, v)), shade(color, rng.range(0.9, 1.07)), x, 0, cz + rng.range(-0.2, 0.2), { ry });
        // some slabs are stacked two high, the top one turned a little
        if (rng.next() < 0.3) body.add(geo.boxBase(0.7 * v, h * 0.8, dz * 0.55), shade(color, rng.range(0.95, 1.1)), x + rng.range(-0.1, 0.1), h, cz, { ry: ry + rng.range(-0.4, 0.4) });
      }
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
      for (let x = r.minX + 1.2; x < r.maxX - 1; x += rng.range(2.4, 3.6)) {
        const s = 0.9 * size(rng);
        const ry = rng.range(-0.5, 0.5);
        const sz = (dz / 2) * Math.min(1, 0.75 + s * 0.2);
        body.add(geo.cylinder(1, 1.05, 0.12, 18), mix(color, SNOW, 0.45), x, 0.06, cz, { sx: s * 1.15, sz: sz * 0.95, ry });
        glowTo.add(geo.cylinder(1, 1, 0.04, 18), color, x, 0.13, cz, { sx: s * 0.95, sz: sz * 0.72, ry });
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
      const ores = 3 + Math.floor(rng.next() * 4); // 0.9.13 (E1): 3-6 lumps of three sizes, not four alike
      for (let k = 0; k < ores; k++) glowTo.add(geo.dodecahedron(0.18 * size(rng)), color, cx + rng.range(-0.65, 0.65), 0.18, cz + rng.range(-0.65, 0.65), { ry: rng.range(0, 6) });
      // a hazard flag on the rim
      body.add(geo.box(0.05, 0.7, 0.05), 0x6f6c6b, r.maxX - 0.15, 0.35 + 0.35, r.minZ + 0.15).add(geo.box(0.04, 0.2, 0.3), 0xe8c547, r.maxX - 0.15, 0.62, r.minZ + 0.32);
      break;
    }
    case 'geode': {
      // a split geode: a rough shell with a ring of glowing crystals in its heart
      const cx = (r.minX + r.maxX) / 2;
      const s = (Math.min(len, dz) / 2) * rng.range(0.8, 1.12); // 0.9.13 (E1): geodes of different sizes
      body.add(geo.sphere(1, 12, 8), 0x9a93a8, cx, 0, cz, { sx: s * 0.95, sy: s * rng.range(0.48, 0.62), sz: s * 0.95 });
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

/**
 * 0.9.13 (review E5): eras 6-10 give the crew green a richer centrepiece of its own (the market has buildCentre). All of it
 * stands within GREEN_PIECE_R of the green's centre (the walkers circle it at 1.7 m) and under GREEN_PIECE_H[n] metres;
 * placeSolids and the collider use the same numbers. Lit parts go in the glow batch, snow sits on the horizontal tops.
 */
export const GREEN_PIECE_H: Readonly<Record<number, number>> = { 6: 3.0, 7: 2.0, 8: 3.6, 9: 3.0, 10: 3.3 };

function buildGreenPiece(body: Batch, glow: Batch, n: number, c: { x: number; z: number }, accent: number, glowC: number): void {
  const f = new Frame(body, c.x, c.z, 0);
  const g = new Frame(glow, c.x, c.z, 0);
  /** A flat ring of snow on a step: between radii r0 and r1 at height y. */
  const snowRing = (r0: number, r1: number, y: number): void => void f.put(geo.ringGround(r0, r1, 24), SNOW, 0, y + 0.006, 0);
  /** Cones standing in a ring, tilted outward by `t` radians. */
  const fan = (put: Frame, cnt: number, rad: number, y: number, r: number, h: number, t: number, cols: number[], a0 = 0): void => {
    for (let k = 0; k < cnt; k++) {
      const a = a0 + (k / cnt) * Math.PI * 2;
      put.put(geo.cone(r, h, 6), cols[k % cols.length]!, Math.cos(a) * rad, y + h / 2, Math.sin(a) * rad, { rz: -t * Math.cos(a), rx: t * Math.sin(a) });
    }
  };
  switch (n) {
    case 6: {
      // a stepped deco plinth, a copper coil column, a glowing quartz cluster and three lamp globes
      const copper = 0xc0784a;
      const teal = 0x3f706a;
      const stone = 0xd8cbb2;
      [[1.1, 0.1], [0.88, 0.3], [0.64, 0.5]].forEach(([r, y], k) => {
        f.put(geo.cylinder(r!, r!, 0.2, 20), k % 2 ? shade(stone, 0.94) : stone, 0, y!, 0);
        f.put(geo.cylinder(r! + 0.02, r! + 0.02, 0.035, 20), copper, 0, y! - 0.09, 0);
      });
      snowRing(0.9, 1.07, 0.2);
      snowRing(0.66, 0.86, 0.4);
      snowRing(0.32, 0.62, 0.6);
      f.put(geo.cylinder(0.14, 0.17, 1.35, 10), teal, 0, 1.275, 0);
      for (let k = 0; k < 8; k++) f.put(geo.torus(0.25, 0.05, 6, 14), copper, 0, 0.8 + k * 0.15, 0, { rx: Math.PI / 2 });
      f.put(geo.cylinder(0.32, 0.22, 0.12, 14), copper, 0, 2.0, 0);
      f.put(geo.cylinder(0.3, 0.3, 0.035, 14), SNOW, 0, 2.075, 0);
      const quartz = mix(glowC, 0xe4eef2, 0.55);
      g.put(geo.cone(0.21, 0.85, 6), quartz, 0, 2.5, 0);
      fan(g, 4, 0.2, 2.08, 0.12, 0.55, 0.5, [mix(glowC, 0xffffff, 0.7), quartz], 0.4);
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * Math.PI * 2) / 3;
        const x = Math.cos(a) * 0.95;
        const z = Math.sin(a) * 0.95;
        f.put(geo.cylinder(0.035, 0.045, 1.0, 6), copper, x, 0.7, z);
        f.put(geo.cylinder(0.08, 0.06, 0.06, 8), copper, x, 1.22, z);
        g.put(geo.sphere(0.13, 10, 8), mix(glowC, 0xfff0d0, 0.35), x, 1.35, z);
      }
      break;
    }
    case 7: {
      // a bronze miniature pumpjack on a plinth beside an eternal-flame brazier
      const bronze = 0x9a6a3a;
      const slate = 0x8b95a1;
      f.put(geo.cylinder(1.1, 1.15, 0.22, 20), slate, 0, 0.11, 0);
      snowRing(0.2, 1.08, 0.22);
      const x0 = -0.45;
      f.put(geo.boxBase(0.9, 0.3, 0.55), shade(slate, 0.9), x0, 0.22, 0);
      f.put(geo.box(0.92, 0.04, 0.57), SNOW, x0, 0.54, 0);
      f.put(geo.box(0.95, 0.06, 0.3), bronze, x0, 0.57, 0);
      for (const z of [-0.1, 0.1]) for (const s of [-1, 1]) f.put(geo.box(0.05, 0.8, 0.05), bronze, x0 + s * 0.07, 0.97, z, { rz: -s * 0.18 });
      f.put(geo.box(1.0, 0.07, 0.1), shade(bronze, 1.1), x0, 1.4, 0, { rz: -0.12 });
      f.put(geo.box(0.14, 0.28, 0.09), bronze, x0 + 0.5, 1.28, 0, { rz: 0.15 });
      f.put(geo.cylinder(0.14, 0.14, 0.08, 12), shade(bronze, 0.8), x0 - 0.5, 1.5, 0, { rx: Math.PI / 2 });
      f.put(geo.box(0.03, 0.6, 0.03), bronze, x0 - 0.38, 1.05, 0.04);
      f.put(geo.cylinder(0.12, 0.12, 0.05, 12), shade(bronze, 0.8), x0 - 0.38, 0.72, 0.18, { rx: Math.PI / 2 });
      f.put(geo.cylinder(0.018, 0.018, 0.7, 6), 0xc9ccd0, x0 + 0.5, 0.9, 0);
      // the brazier: a pedestal and a wide bowl with the eternal flame
      f.put(geo.cylinder(0.12, 0.17, 0.65, 8), bronze, 0.5, 0.545, 0);
      f.put(geo.cylinder(0.4, 0.2, 0.2, 14), shade(bronze, 0.9), 0.5, 0.97, 0);
      f.put(geo.torus(0.4, 0.035, 5, 16), shade(bronze, 1.15), 0.5, 1.07, 0, { rx: Math.PI / 2 });
      g.put(geo.cylinder(0.34, 0.34, 0.03, 14), mix(glowC, 0xc44536, 0.4), 0.5, 1.07, 0);
      g.put(geo.cone(0.3, 0.95, 8), glowC, 0.5, 1.55, 0);
      g.put(geo.cone(0.14, 0.6, 7), glowC, 0.66, 1.42, 0.08, { rz: -0.35 });
      g.put(geo.cone(0.17, 0.7, 8), mix(glowC, 0xfff0a0, 0.6), 0.5, 1.45, 0);
      break;
    }
    case 8: {
      // a holo-tree: a white stem, glowing teal and gold discs narrowing upward, a gold star on top
      const teal = 0x6fe0d4;
      const gold = 0xf2c85a;
      f.put(geo.cylinder(1.0, 1.1, 0.3, 24), 0xf0eadb, 0, 0.15, 0);
      snowRing(0.2, 0.92, 0.3);
      g.put(geo.torus(1.02, 0.03, 5, 36), teal, 0, 0.3, 0, { rx: Math.PI / 2 });
      f.put(geo.cylinder(0.07, 0.1, 2.9, 10), 0xf0eadb, 0, 1.75, 0);
      const rs = [1.0, 0.84, 0.68, 0.53, 0.4, 0.28];
      const ys = [0.78, 1.12, 1.45, 1.76, 2.05, 2.32];
      rs.forEach((r, k) => {
        // a holo ring: a flat annulus inside a thin bright rim, so the stem and the tiers below show through
        const col = k % 2 ? gold : teal;
        g.put(geo.ringGround(r * 0.78, r, 28), mix(col, 0xffffff, 0.15), 0, ys[k]!, 0);
        g.put(geo.torus(r, 0.04, 5, 32), col, 0, ys[k]!, 0, { rx: Math.PI / 2 });
        f.put(geo.cylinder(0.13, 0.13, 0.1, 10), 0xdfeeee, 0, ys[k]! - 0.06, 0);
        if (k < 4) for (let j = 0; j < 3; j++) g.put(geo.sphere(0.055, 6, 5), k % 2 ? teal : gold, Math.cos(j * 2.1 + k) * (r - 0.02), ys[k]! + 0.05, Math.sin(j * 2.1 + k) * (r - 0.02));
      });
      const star = new Frame(glow, c.x, c.z, Math.PI / 4);
      for (let k = 0; k < 4; k++) star.put(geo.box(k % 2 ? 0.34 : 0.56, 0.1, 0.06), gold, 0, 3.3, 0, { rz: (k * Math.PI) / 4 });
      g.put(geo.sphere(0.09, 8, 6), 0xfff0b0, 0, 3.3, 0);
      break;
    }
    case 9: {
      // an atom fountain: a basin of glowing aqua water, a column, a glowing nucleus ringed by three thin tori
      const aqua = 0x86e8c4;
      f.put(geo.cylinder(1.1, 1.15, 0.4, 24), 0xc6d0d3, 0, 0.2, 0);
      snowRing(0.95, 1.08, 0.4);
      g.put(geo.cylinder(0.95, 0.95, 0.04, 24), aqua, 0, 0.4, 0);
      f.put(geo.cylinder(0.3, 0.38, 0.25, 14), 0xdfe6e8, 0, 0.525, 0);
      f.put(geo.cylinder(0.09, 0.12, 1.2, 10), 0xdfe6e8, 0, 1.25, 0);
      const cy = 2.1;
      g.put(geo.sphere(0.2, 12, 9), 0xe8fff6, 0, cy, 0);
      for (const [x, y, z, col] of [[0.14, 0.06, 0.05, aqua], [-0.1, 0.14, -0.06, 0x5bd6b0], [0, 0.0, -0.15, aqua], [-0.06, -0.12, 0.12, 0x5bd6b0]] as const) g.put(geo.sphere(0.15, 10, 8), col, x, cy + y, z);
      const e = new THREE.Euler();
      const v = new THREE.Vector3();
      [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].forEach((ry, k) => {
        g.put(geo.torus(0.82, 0.025, 5, 40), k === 1 ? 0xb5f5dc : aqua, 0, cy, 0, { rx: 1.0, ry });
        e.set(1.0, ry, 0);
        v.set(Math.cos(k * 2.1 + 0.6) * 0.82, Math.sin(k * 2.1 + 0.6) * 0.82, 0).applyEuler(e);
        g.put(geo.sphere(0.07, 8, 6), 0xffffff, v.x, cy + v.y, v.z);
      });
      for (let k = 0; k < 8; k++) g.put(geo.sphere(0.035, 5, 4), aqua, Math.cos(k * 0.785) * (0.34 + (k % 3) * 0.1), 0.75 + (k % 4) * 0.2, Math.sin(k * 0.785) * (0.34 + (k % 3) * 0.1));
      break;
    }
    default: {
      // X: a crystal tree: tiers of lavender crystal cones round a tall trunk crystal, a floating orb and ring above
      const cols = [0xb9a3e8, 0xd2bff4, 0xe8a8c0, 0x9fc8e8];
      f.put(geo.cylinder(1.05, 1.15, 0.3, 18), 0xe3d9f6, 0, 0.15, 0);
      snowRing(0.35, 1.0, 0.3);
      f.put(geo.cone(0.32, 2.0, 6), 0xb9a3e8, 0, 1.3, 0);
      fan(f, 6, 0.62, 0.3, 0.19, 1.15, 0.42, cols);
      fan(f, 5, 0.42, 0.85, 0.15, 1.0, 0.3, [cols[1]!, cols[3]!, cols[2]!], 0.5);
      fan(f, 4, 0.26, 1.35, 0.12, 0.85, 0.22, [cols[0]!, cols[2]!, cols[1]!], 0.2);
      fan(f, 3, 0.9, 0.3, 0.1, 0.5, 0.65, [cols[2]!, cols[0]!], 0.9);
      fan(g, 4, 0.34, 1.9, 0.06, 0.34, 0.3, [0xe6dcff, 0xffd6ec], 0.5);
      g.put(geo.cone(0.1, 0.45, 6), 0xf0e8ff, 0, 2.45, 0);
      g.put(geo.sphere(0.2, 14, 10), 0xdccbff, 0, 2.95, 0);
      g.put(geo.sphere(0.12, 10, 8), 0xffffff, 0, 2.95, 0);
      g.put(geo.torus(0.42, 0.03, 5, 28), 0xc9b6ff, 0, 2.95, 0, { rx: Math.PI / 2 - 0.35 });
      for (let k = 0; k < 3; k++) g.put(geo.sphere(0.05, 6, 5), 0xffffff, Math.cos(k * 2.1) * 0.5, 2.7 + k * 0.2, Math.sin(k * 2.1) * 0.5);
      break;
    }
  }
}

function buildGreen(body: Batch, glow: Batch, n: number, st: PlotStyle, P: PlotPlaces, accent: number, glowColor: number): void {
  const G = P.green;
  const c = greenCentre(P);
  // a soft lawn of trodden snow with a ring path round the centre
  body.add(geo.box(G.maxX - G.minX, 0.015, G.maxZ - G.minZ), mix(st.pave, 0xf4f8ff, 0.55), c.x, 0.025, c.z);
  body.add(geo.ringGround(1.5, 2.2, 28), st.pave, c.x, 0.047, c.z);
  // 0.9.12 polish: a big green gets a little plaza pattern so its middle doesn't read empty: an outer ring walk and four
  // walks out toward its corners (flat, walked over like the rest of the green; eras/layout.ts keeps decor off them)
  const plaza = greenPlaza(P);
  if (plaza) {
    // 1.0 polish: a real paved square in the era's stone, flat so everyone still walks anywhere on it: a disc of setts
    // out to the ring walk with a darker kerb, a compass rose of lighter inlays round the centrepiece, an accent band,
    // and the four corner walks as paved paths with edge lines (eras/layout.ts keeps decor 1 m off their centre lines)
    const walk = shade(st.pave, 0.86);
    const setts = shade(st.pave, 0.95);
    const inlay = mix(st.pave, 0xffffff, 0.75);
    const kerb = shade(st.pave, 0.66);
    const R = plaza.R;
    body.add(geo.ringGround(0, R + 0.1, 56), setts, c.x, 0.036, c.z);
    body.add(geo.ringGround(R - 2 * PLAZA_HALF, R, 56), walk, c.x, 0.04, c.z);
    body.add(geo.ringGround(R, R + 0.3, 56), kerb, c.x, 0.042, c.z);
    // little lights set flush in the kerb, so the square shows its shape after dark
    for (let k = 0; k < 28; k++) {
      const a = ((k + 0.5) / 28) * Math.PI * 2;
      glow.add(geo.cylinder(0.08, 0.08, 0.02, 8), mix(glowColor, 0xfff0c2, 0.5), c.x + Math.cos(a) * (R + 0.15), 0.05, c.z + Math.sin(a) * (R + 0.15));
    }
    body.add(geo.ringGround(2.35, 2.75, 40), mix(accent, st.pave, 0.45), c.x, 0.043, c.z);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const long = k % 2 === 0;
      const r0 = 2.85;
      const r1 = long ? R - 2 * PLAZA_HALF - 0.25 : r0 + (R - r0) * 0.45;
      const m = (r0 + r1) / 2;
      body.add(geo.box(long ? 0.26 : 0.16, 0.008, r1 - r0), long ? inlay : walk, c.x + Math.cos(a) * m, 0.045, c.z + Math.sin(a) * m, { ry: Math.PI / 2 - a });
    }
    for (const [a, b] of plaza.corner) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ry = Math.atan2(b.x - a.x, b.z - a.z);
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      body.add(geo.box(1.0, 0.012, len), setts, mx, 0.038, mz, { ry });
      body.add(geo.box(2 * PLAZA_HALF, 0.014, len), walk, mx, 0.04, mz, { ry });
      for (const sd of [-0.5, 0.5]) body.add(geo.box(0.07, 0.016, len), kerb, mx + Math.cos(ry) * sd, 0.041, mz - Math.sin(ry) * sd, { ry });
    }
  }
  // benches either side
  for (const s of [-1, 1]) {
    body.add(geo.boxBase(1.6, 0.1, 0.45), shade(st.wall, 0.85), c.x + s * 3.2, 0.42, c.z);
    for (const x of [-0.6, 0.6]) body.add(geo.boxBase(0.1, 0.42, 0.4), shade(st.wall, 0.7), c.x + s * 3.2 + x, 0, c.z);
  }
  if (n >= 6) {
    buildGreenPiece(body, glow, n, c, accent, glowColor);
    return;
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
// 0.9.12 lantern garlands (Dino: "lantern garlands over the streets and along roof edges")
// ---------------------------------------------------------------------------------------------------------------------

export interface Garland {
  a: V3;
  b: V3;
  sag: number;
  seed: number;
  /** Under a shop's eave (against its front, over its doorstep) rather than across the street. */
  eave: boolean;
}

/** Lamp posts this far apart (or nearer) along the market street are strung together (metres). */
const GARLAND_SPAN = 10;
/** Where a garland ties on to a lamp post: just under its arm. */
const GARLAND_POST_Y = 2.88;

/** A shop's front eave edge in its own frame: [half width, height, depth out from the centre], or null (round shops). */
function shopEave(st: PlotStyle, s: ShopPlace): [number, number, number] | null {
  if (st.hut === 'deco') return [s.w / 2 + 0.04, 2.44, s.d / 2 + 1.31];
  if (st.hut === 'trailer') return [s.w / 2 + 0.28, s.h > 4 ? 2.88 : s.h - 0.02, s.d / 2 + 0.76];
  if (st.hut === 'modular') return [s.w / 2 + 0.13, s.h - 0.12, s.d / 2 + 0.12];
  if (st.hut === 'quonset' || st.hut === 'pod') return null;
  return [s.w / 2 + 0.12, s.h - 0.04, s.d / 2 + 0.25];
}

/** 0.9.12: icicles along the front eave of the flat-roofed shops of eras VI-VIII (the gabled ones get theirs in Frame.gable). */
function shopIcicles(body: Batch, st: PlotStyle, s: ShopPlace, i: number): void {
  if (st.hut !== 'deco' && st.hut !== 'trailer' && st.hut !== 'modular') return;
  const e = shopEave(st, s)!;
  const f = new Frame(body, s.x, s.z, s.yaw);
  const n = Math.max(4, Math.round((e[0] * 2) / 0.27));
  // the deco arcade's slab is 0.18 thick, the others' roof edges about as much
  const y = e[1] - 0.09;
  for (let k = 0; k < n; k++) {
    if ((k * 5 + i) % 7 === 0) continue;
    const len = 0.1 + (((k * 7 + i) % 5) / 4) * 0.24;
    f.put(geo.cone(0.045, len, 5), ICE, -e[0] + ((k + 0.5) * 2 * e[0]) / n, y - len / 2, e[2] - 0.03, { rx: Math.PI });
  }
}

/**
 * Pure: era n's garlands. Paper lanterns strung from lamp to lamp along the market street (their lowest point well
 * over everyone's heads), and scalloped under the front eave of every shop (stalls and the round quonset / dome
 * shops of eras 9 and 10 aside: their neon is their own).
 */
export function plotGarlands(n: number): Garland[] {
  const st = STYLE[n];
  if (!st) return [];
  const P = plotPlaces(n);
  const out: Garland[] = [];
  for (let i = 0; i + 1 < P.lamps.length; i++) {
    const a = P.lamps[i]!;
    const b = P.lamps[i + 1]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d < 1 || d > GARLAND_SPAN) continue;
    out.push({ a: { x: a.x, y: GARLAND_POST_Y, z: a.z }, b: { x: b.x, y: GARLAND_POST_Y, z: b.z }, sag: 0.12 + d * 0.02, seed: i, eave: false });
  }
  P.shops.forEach((s, i) => {
    if (s.stall) return;
    const e = shopEave(st, s);
    if (!e) return;
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const at = (lx: number): V3 => ({ x: s.x + lx * c + e[2] * sn, y: e[1], z: s.z - lx * sn + e[2] * c });
    const k = Math.max(2, Math.round((e[0] * 2) / 1.8));
    for (let j = 0; j < k; j++) out.push({ a: at(-e[0] + (j * 2 * e[0]) / k), b: at(-e[0] + ((j + 1) * 2 * e[0]) / k), sag: 0.09, seed: i * 3 + j, eave: true });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// lived-in market and huts (EM1): the decor eras/layout.ts plotDecor places
// ---------------------------------------------------------------------------------------------------------------------

/** One era's decor colours: crates, sacks, drums, the hand cart and the heap of its goods (audit-1.0/era-resources-v2.md). */
interface DecorStyle {
  crate: number;
  strap: number;
  sack: [number, number];
  /** Drum body colours (picked per drum), and its band. */
  drum: number[];
  band: number;
  cart: number;
  /** What a heap or a cart load is made of: bricks, lumps, a sand mound, crystals or ingots. */
  heap: 'bricks' | 'lumps' | 'mound' | 'crystals' | 'ingots';
  goods: [number, number];
  wood: number;
}

const DECOR: readonly (DecorStyle | null)[] = [
  null,
  null,
  // 2 stone + clay bricks: pale pine crates, grain sacks, clay-red bricks and granite
  { crate: 0xb68a5c, strap: 0x7a5a48, sack: [0xd8c9a6, 0xc7b48c], drum: [0x9a7350, 0x8a6446], band: 0x6e5a4a, cart: 0x9a7350, heap: 'bricks', goods: [0xc27a56, 0xbab4aa], wood: 0x9a7350 },
  // 3 iron + charcoal: dark timber with iron straps, charcoal sacks, ore
  { crate: 0x6e5646, strap: 0x3f3d3f, sack: [0x3c3a3b, 0x59514e], drum: [0x594a40, 0x4a3e36], band: 0x2f2e30, cart: 0x6e5646, heap: 'lumps', goods: [0xa65a3e, 0x3a3534], wood: 0x6e5646 },
  // 4 coal + scrap steam: brass drums, coal sacks, scrap steel
  { crate: 0x8d6f52, strap: 0x585d61, sack: [0x4a4644, 0x8e949a], drum: [0xb08a4e, 0x9a7a44], band: 0x585d61, cart: 0x585d61, heap: 'lumps', goods: [0x2f2c2b, 0x8e949a], wood: 0x8d6f52 },
  // 5 taconite + coke: steel crates, rust-red pellet drums, coke sacks
  { crate: 0x76818a, strap: 0xb4553a, sack: [0x4b4745, 0x8a8280], drum: [0xb4553a, 0x9c4a32], band: 0x4e4a48, cart: 0x6e7880, heap: 'lumps', goods: [0xb4553a, 0x4b4745], wood: 0x8a7258 },
  // 6 copper + quartz: cream crates with teal straps, quartz sand, copper drums
  { crate: 0xcdbd9f, strap: 0x3f706a, sack: [0xe4eef2, 0xc0784a], drum: [0x4c7a74, 0xc0784a], band: 0xc0784a, cart: 0x3f706a, heap: 'ingots', goods: [0xc0784a, 0xe4eef2], wood: 0xb59d7c },
  // 7 crude + gas: yellow plastic crates, bright oil drums, orange sacks
  { crate: 0xe6b84a, strap: 0xc44536, sack: [0xd8742f, 0xe8d27a], drum: [0xc44536, 0x3f6fa0, 0xe3b23a], band: 0x444a54, cart: 0x6c7684, heap: 'lumps', goods: [0x7a5236, 0xd99b26], wood: 0x8a6a46 },
  // 8 silica + gold: white crates, sand sacks, gold bars
  { crate: 0xf0eadb, strap: 0x5c9aa0, sack: [0xe8d8b0, 0xe5c05a], drum: [0xeee8d8, 0xdfeeee], band: 0x5c9aa0, cart: 0x45858c, heap: 'mound', goods: [0xdfc28c, 0xe5c05a], wood: 0xc9b99c },
  // 9 uranium + graphite: pale steel crates with hazard straps, graphite sacks, yellow drums
  { crate: 0xc9d1d3, strap: 0xe8c547, sack: [0x6f6c6b, 0x8fa0a4], drum: [0xd9c24a, 0xc9b03c], band: 0x3d3a39, cart: 0x5bb391, heap: 'lumps', goods: [0x86e8c4, 0x6f6c6b], wood: 0x9aa4a8 },
  // 10 rare earth + helium-3: white pods with lavender straps, lavender sacks, helium canisters
  { crate: 0xe3d9f6, strap: 0x8f74cf, sack: [0xcfc4ec, 0x9f86dc], drum: [0xc9dcf7, 0xd7c9f2], band: 0x8f74cf, cart: 0x8f74cf, heap: 'crystals', goods: [0x9d84e0, 0xd6e8ff], wood: 0xc6bce0 },
];

/** A thin snow cap over a w × d top at height y. */
const cap = (f: Frame, w: number, d: number, y: number, x = 0, z = 0): void => void f.put(geo.box(w, 0.06, d), SNOW, x, y + 0.03, z);

/** A heap of the era's goods (also a cart load), centred on (x, z), up to `r` metres across. */
function goodsHeap(f: Frame, S: DecorStyle, x: number, y: number, z: number, r: number, seed: number): void {
  const [a, b] = S.goods;
  switch (S.heap) {
    case 'bricks':
      // staggered courses of clay bricks, a granite block on top
      for (let layer = 0; layer < 3; layer++) {
        for (let i = 0; i < 3 - (layer > 1 ? 1 : 0); i++) f.put(geo.box(r * 0.42, 0.16, r * 0.28), shade(a, 0.92 + ((i + layer + seed) % 3) * 0.06), x - r * 0.28 + i * r * 0.28 + (layer % 2) * 0.1, y + 0.08 + layer * 0.17, z + ((layer + i) % 2) * 0.06);
      }
      f.put(geo.box(r * 0.4, 0.2, r * 0.3), b, x, y + 0.6, z);
      cap(f, r * 0.6, r * 0.36, y + 0.7, x, z);
      break;
    case 'mound':
      f.put(geo.sphere(0.5, 14, 8), a, x, y, z, { sx: r * 1.1, sy: 0.5, sz: r * 0.8 });
      f.put(geo.box(r * 0.5, 0.12, r * 0.26), b, x - r * 0.15, y + 0.18, z + r * 0.12, { ry: 0.3 }).put(geo.box(r * 0.5, 0.12, r * 0.26), shade(b, 0.9), x - r * 0.1, y + 0.3, z + r * 0.1, { ry: 0.25 });
      break;
    case 'crystals':
      for (let i = 0; i < 5; i++) {
        const cx = x + Math.cos(i * 1.9 + seed) * r * 0.32;
        const cz = z + Math.sin(i * 1.9 + seed) * r * 0.26;
        f.put(geo.cone(0.13 + (i % 2) * 0.05, 0.5 + (i % 3) * 0.18, 5), i % 2 ? b : a, cx, y + 0.3 + (i % 3) * 0.09, cz, { rz: (i - 2) * 0.1 });
      }
      break;
    case 'ingots':
      for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 3 - layer; i++) f.put(geo.box(r * 0.34, 0.14, r * 0.24), shade(a, 0.9 + ((i + layer) % 2) * 0.12), x - ((2 - layer) * r * 0.38) / 2 + i * r * 0.38, y + 0.07 + layer * 0.15, z);
      f.put(geo.cone(0.12, 0.42, 5), b, x + r * 0.45, y + 0.25, z + 0.18, { rz: -0.15 });
      f.put(geo.cone(0.1, 0.34, 5), b, x - r * 0.4, y + 0.2, z - 0.15, { rz: 0.2 });
      break;
    default: {
      for (let i = 0; i < 7; i++) {
        const k = i % 4;
        f.put(geo.dodecahedron(0.19 + (i % 3) * 0.035), i % 3 === 0 ? b : a, x + Math.cos(i * 2.4 + seed) * r * 0.3 * (k ? 1 : 0.2), y + 0.17 + (k === 3 ? 0.22 : 0), z + Math.sin(i * 2.4 + seed) * r * 0.22 * (k ? 1 : 0.2), { ry: i, sy: 0.85 });
      }
      f.put(geo.sphere(0.2, 8, 5), SNOW, x - 0.05, y + 0.52, z, { sy: 0.4, sx: 1.4 });
    }
  }
}

/** A little cart (also the ore / coke cart on rails): body, two wheels, a pull bar, a heap of goods. */
function cartPiece(f: Frame, S: DecorStyle, seed: number): void {
  f.put(geo.box(1.25, 0.34, 0.8), S.cart, 0, 0.55, 0);
  f.put(geo.box(1.33, 0.07, 0.88), shade(S.cart, 0.8), 0, 0.74, 0);
  for (const z of [-0.47, 0.47]) f.put(geo.cylinder(0.3, 0.3, 0.07, 14), shade(S.wood, 0.7), -0.05, 0.3, z, { rx: Math.PI / 2 }).put(geo.cylinder(0.07, 0.07, 0.1, 8), shade(S.strap, 1.1), -0.05, 0.3, z, { rx: Math.PI / 2 });
  f.put(geo.box(0.4, 0.05, 0.06), shade(S.wood, 0.8), 0.8, 0.5, -0.25, { rz: 0.1 }).put(geo.box(0.4, 0.05, 0.06), shade(S.wood, 0.8), 0.8, 0.5, 0.25, { rz: 0.1 });
  // a cart load stays low: bricks and crystals pile up as plain lumps
  goodsHeap(f, S.heap === 'bricks' || S.heap === 'crystals' ? { ...S, heap: 'lumps' } : S, -0.05, 0.72, 0, 1.0, seed);
}

/** The era's own clutter piece: variant v (0..2), built round its resources. `g`: the lit parts, `bulb`: lamps. */
function sigPiece(f: Frame, g: Frame, n: number, S: DecorStyle, v: number): void {
  const roundBase = (r: number, col: number): void => void f.put(geo.cylinder(r, r + 0.06, 0.1, 14), col, 0, 0.05, 0);
  switch (n) {
    case 2: {
      if (v === 0) {
        // a pallet of fired clay bricks with a granite sill block on top
        for (const z of [-0.3, 0, 0.3]) f.put(geo.box(1.5, 0.08, 0.16), 0x8a6446, 0, 0.06, z);
        for (let layer = 0; layer < 4; layer++) for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.put(geo.box(0.68, 0.15, 0.3), shade(0xc27a56, 0.9 + (((sx + 2) * (sz + 3) + layer) % 3) * 0.07), sx * 0.36 + (layer % 2) * 0.05, 0.19 + layer * 0.16, sz * 0.17);
        f.put(geo.box(0.9, 0.2, 0.5), 0xbab4aa, 0, 0.93, 0);
        cap(f, 1.5, 0.78, 0.84, 0, 0);
      } else if (v === 1) {
        // three clay pots of different sizes, snow on their lids
        for (const [x, z, s, c] of [[-0.35, -0.1, 1, 0xc27a56], [0.35, -0.15, 0.85, 0xa86446], [0.0, 0.35, 0.7, 0xd49872]] as const) {
          f.put(geo.sphere(0.3 * s, 12, 8), c, x, 0.3 * s, z, { sy: 0.95 }).put(geo.cylinder(0.2 * s, 0.17 * s, 0.14, 12), shade(c, 0.85), x, 0.64 * s, z);
          f.put(geo.cylinder(0.2 * s, 0.2 * s, 0.05, 12), SNOW, x, 0.72 * s, z);
        }
      } else {
        // a stack of granite slabs and an upright block with a mallet leaning on it
        f.put(geo.box(1.5, 0.18, 0.9), 0xbab4aa, 0, 0.09, 0, { ry: 0.05 }).put(geo.box(1.35, 0.16, 0.8), 0xa69c8e, 0.02, 0.26, 0, { ry: -0.08 }).put(geo.box(1.2, 0.16, 0.7), 0xc2bcb2, 0, 0.42, 0.02, { ry: 0.1 });
        f.put(geo.box(0.5, 1.1, 0.4), 0xb0aaa0, 0.4, 0.97, 0, { ry: 0.12 });
        cap(f, 0.55, 0.45, 1.52, 0.4, 0);
        f.put(geo.cylinder(0.04, 0.04, 0.7, 6), 0x8a6446, -0.35, 0.8, 0.1, { rz: 0.35 }).put(geo.box(0.26, 0.14, 0.14), 0x6e5a4a, -0.46, 1.12, 0.1, { rz: 0.35 });
        cap(f, 1.2, 0.7, 0.5, 0, 0.02);
      }
      break;
    }
    case 3: {
      if (v === 0) {
        // an anvil on a stump, a glowing ingot cooling on it
        f.put(geo.cylinder(0.36, 0.42, 0.62, 12), 0x6e5646, 0, 0.31, 0).put(geo.cylinder(0.37, 0.37, 0.06, 12), 0x3f3d3f, 0, 0.5, 0);
        f.put(geo.box(0.55, 0.16, 0.34), 0x3f3d3f, 0, 0.7, 0).put(geo.box(0.3, 0.22, 0.24), 0x3f3d3f, 0, 0.88, 0).put(geo.box(0.8, 0.14, 0.3), 0x4a4849, 0, 1.06, 0);
        f.put(geo.cone(0.13, 0.36, 8), 0x4a4849, 0.58, 1.06, 0, { rz: -Math.PI / 2 });
        g.put(geo.box(0.34, 0.06, 0.12), 0xff8a3d, -0.1, 1.16, 0);
        cap(f, 0.5, 0.26, 1.13, -0.3, 0);
        // iron ingots at its foot
        for (let k = 0; k < 3; k++) f.put(geo.box(0.34, 0.1, 0.16), 0x6a6668, -0.45 + (k % 2) * 0.1, 0.05 + k * 0.1, 0.6 - 0.02 * k);
      } else if (v === 1) {
        // an ore cart on a short run of rail
        for (const z of [-0.33, 0.33]) f.put(geo.box(1.7, 0.06, 0.08), 0x3f3d3f, 0, 0.04, z);
        for (let x = -0.75; x <= 0.8; x += 0.25) f.put(geo.box(0.1, 0.05, 0.9), 0x6e5646, x, 0.02, 0);
        f.put(geo.box(1.1, 0.5, 0.64), 0x8a5a44, 0, 0.55, 0).put(geo.box(1.2, 0.08, 0.74), 0x3f3d3f, 0, 0.82, 0);
        for (const [x, z] of [[-0.38, -0.36], [0.38, -0.36], [-0.38, 0.36], [0.38, 0.36]] as const) f.put(geo.cylinder(0.14, 0.14, 0.06, 10), 0x3f3d3f, x, 0.17, z, { rx: Math.PI / 2 });
        for (let i = 0; i < 6; i++) f.put(geo.dodecahedron(0.18 + (i % 2) * 0.03), i % 3 ? 0xa65a3e : 0x7a6c64, -0.35 + (i % 3) * 0.35, 0.95 + (i > 2 ? 0.14 : 0), (i % 2) * 0.12 - 0.05, { ry: i });
        f.put(geo.sphere(0.3, 8, 5), SNOW, 0.05, 1.18, 0, { sy: 0.3, sx: 1.6 });
      } else {
        // a charcoal burner's stack: logs piled in three courses between two stakes
        for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) f.put(geo.cylinder(0.17, 0.17, 1.35, 8), i % 2 ? 0x3a3534 : 0x2f2b2a, 0, 0.17 + row * 0.29, (i - (2 - row) / 2) * 0.35, { rz: Math.PI / 2 });
        for (const x of [-0.72, 0.72]) f.put(geo.box(0.08, 0.9, 0.08), 0x6e5646, x, 0.45, 0.35 - (x > 0 ? 0 : 0.7));
        cap(f, 1.35, 0.4, 0.78, 0, 0);
      }
      break;
    }
    case 4: {
      if (v === 0) {
        // a coal bin heaped with lumps, a scrap shovel leaning in
        f.put(geo.box(1.5, 0.1, 0.9), 0x6e5646, 0, 0.05, 0);
        f.put(geo.box(1.5, 0.62, 0.07), S.crate, 0, 0.4, 0.42).put(geo.box(1.5, 0.62, 0.07), S.crate, 0, 0.4, -0.42).put(geo.box(0.07, 0.62, 0.8), S.crate, -0.72, 0.4, 0).put(geo.box(0.07, 0.62, 0.8), S.crate, 0.72, 0.4, 0);
        for (const x of [-0.72, 0.72]) for (const z of [-0.42, 0.42]) f.put(geo.box(0.1, 0.7, 0.1), S.strap, x, 0.4, z);
        for (let i = 0; i < 8; i++) f.put(geo.dodecahedron(0.17 + (i % 3) * 0.02), i % 4 === 3 ? 0x3a3736 : 0x2a2829, -0.45 + (i % 4) * 0.3, 0.74 + (i > 3 ? 0.15 : 0), (i % 2) * 0.3 - 0.15, { ry: i });
        f.put(geo.sphere(0.22, 8, 5), SNOW, 0.1, 1.0, 0, { sy: 0.3, sx: 1.5 });
        f.put(geo.cylinder(0.035, 0.035, 1.1, 6), 0x8a6446, 0.5, 0.95, 0.2, { rz: 0.5 }).put(geo.box(0.22, 0.04, 0.2), 0x8e949a, 0.18, 0.52, 0.2, { rz: 0.5 });
      } else if (v === 1) {
        // a brass gear on a post, a smaller one meshed beside it
        f.put(geo.box(0.9, 0.14, 0.5), 0x585d61, -0.15, 0.07, 0).put(geo.cylinder(0.07, 0.08, 1.6, 8), 0x585d61, -0.15, 0.9, 0);
        for (const [x, y, r, tn] of [[-0.15, 1.3, 0.5, 12], [0.5, 0.78, 0.24, 8]] as const) {
          f.put(geo.cylinder(r, r, 0.1, 18), 0xb08a4e, x, y, 0.1, { rx: Math.PI / 2 });
          for (let k = 0; k < tn; k++) {
            const a = (k / tn) * Math.PI * 2;
            f.put(geo.box(0.13, 0.13, 0.1), 0xb08a4e, x + Math.cos(a) * (r + 0.05), y + Math.sin(a) * (r + 0.05), 0.1, { rz: a });
          }
          f.put(geo.cylinder(r * 0.28, r * 0.28, 0.14, 10), 0x585d61, x, y, 0.1, { rx: Math.PI / 2 });
        }
        cap(f, 0.5, 0.2, 1.88, -0.15, 0.1);
      } else {
        // a little boiler: brass drum, iron rings, a chimney, a valve wheel, a gauge with a warm hatch
        roundBase(0.5, 0x585d61);
        f.put(geo.cylinder(0.36, 0.38, 1.0, 14), 0xb08a4e, 0, 0.6, 0).put(geo.sphere(0.36, 14, 8), 0xb08a4e, 0, 1.1, 0, { sy: 0.7 });
        for (const y of [0.3, 0.7, 1.0]) f.put(geo.cylinder(0.385, 0.385, 0.06, 14), 0x585d61, 0, y, 0);
        f.put(geo.cylinder(0.07, 0.08, 0.55, 8), 0x585d61, 0.1, 1.5, 0).put(geo.cylinder(0.1, 0.1, 0.05, 8), SNOW, 0.1, 1.8, 0);
        f.put(geo.torus(0.13, 0.03, 6, 12), 0x585d61, 0.4, 0.75, 0, { ry: Math.PI / 2 });
        f.put(geo.cylinder(0.1, 0.1, 0.05, 12), 0xfff3dc, 0, 0.85, 0.37, { rx: Math.PI / 2 });
        g.put(geo.box(0.24, 0.2, 0.04), 0xff9a4d, 0, 0.3, 0.39);
      }
      break;
    }
    case 5: {
      if (v === 0) {
        // a rack of orange girders on timber sleepers, one stood up beside them
        for (const x of [-0.5, 0.5]) f.put(geo.box(0.12, 0.12, 0.8), S.wood, x, 0.06, 0);
        for (let i = 0; i < 3; i++) {
          const c = i % 2 ? 0xd9762f : 0xb4553a;
          f.put(geo.box(1.6, 0.07, 0.3), c, 0, 0.16 + i * 0.28, 0).put(geo.box(1.6, 0.2, 0.06), shade(c, 0.9), 0, 0.26 + i * 0.28, 0).put(geo.box(1.6, 0.07, 0.3), c, 0, 0.36 + i * 0.28, 0);
        }
        cap(f, 1.6, 0.3, 0.97, 0, 0);
      } else if (v === 1) {
        // a pellet hopper on four legs over a heap of rust-red pellets
        for (const [x, z] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]] as const) f.put(geo.box(0.09, 0.9, 0.09), 0x4e4a48, x, 0.45, z);
        f.put(geo.box(1.0, 0.45, 0.7), 0xb4553a, 0, 1.0, 0).put(geo.cone(0.28, 0.3, 8), 0xb4553a, 0, 0.62, 0, { rx: Math.PI });
        for (let i = 0; i < 6; i++) f.put(geo.sphere(0.1, 6, 5), i % 2 ? 0xb4553a : 0x9c4a32, -0.3 + (i % 3) * 0.3, 1.27, (i > 2 ? 0.14 : -0.1));
        cap(f, 1.0, 0.7, 1.22, 0, 0);
        f.put(geo.sphere(0.3, 8, 5), 0xb4553a, 0, 0.1, 0.5, { sy: 0.4, sx: 1.3 });
      } else {
        // a coke cart: dark lumps with two embers still glowing
        cartPiece(f, { ...S, cart: 0x6e7880, goods: [0x3a3736, 0x6f6c6b], heap: 'lumps' }, 2);
        g.put(geo.sphere(0.07, 6, 4), 0xff7a2f, -0.2, 1.0, 0.1).put(geo.sphere(0.06, 6, 4), 0xffa24d, 0.25, 0.98, -0.12);
      }
      break;
    }
    case 6: {
      if (v === 0) {
        // two cable spools on their sides: copper wound on timber flanges
        for (const [z, s] of [[-0.28, 1], [0.42, 0.78]] as const) {
          for (const x of [-0.28 * s, 0.28 * s]) f.put(geo.cylinder(0.5 * s, 0.5 * s, 0.06, 16), S.wood, x, 0.5 * s, z, { rz: Math.PI / 2 });
          f.put(geo.cylinder(0.36 * s, 0.36 * s, 0.5 * s, 14), 0xc0784a, 0, 0.5 * s, z, { rz: Math.PI / 2 }).put(geo.cylinder(0.37 * s, 0.37 * s, 0.1, 14), 0xdc9a68, 0, 0.5 * s, z, { rz: Math.PI / 2 });
          f.put(geo.cylinder(0.12 * s, 0.12 * s, 0.7 * s, 8), 0x6e5a4a, 0, 0.5 * s, z, { rz: Math.PI / 2 });
        }
        f.put(geo.torus(0.14, 0.03, 6, 12), 0xc0784a, 0.55, 0.08, 0.7, { rx: Math.PI / 2 });
        cap(f, 0.7, 0.1, 1.0, 0, -0.28);
      } else if (v === 1) {
        // a teal planter with a cluster of quartz crystals, two of them lit
        f.put(geo.cylinder(0.5, 0.38, 0.42, 14), 0x3f706a, 0, 0.21, 0).put(geo.cylinder(0.52, 0.52, 0.07, 14), 0xc0784a, 0, 0.4, 0).put(geo.cylinder(0.44, 0.44, 0.05, 14), SNOW, 0, 0.45, 0);
        for (const [x, z, h, r, tilt] of [[0, 0, 1.0, 0.16, 0], [-0.22, 0.1, 0.7, 0.12, 0.25], [0.2, -0.05, 0.8, 0.13, -0.2], [0.05, 0.22, 0.5, 0.1, -0.1]] as const) {
          f.put(geo.cone(r, h, 6), 0xe4eef2, x, 0.45 + h / 2, z, { rz: tilt, rx: tilt * 0.4 });
          if (h > 0.75) g.put(geo.cone(r * 0.55, h * 0.8, 6), 0xbfe9e4, x, 0.45 + h * 0.42, z, { rz: tilt, rx: tilt * 0.4 });
        }
      } else {
        // a pole with a crossarm, three porcelain insulators and a loop of copper wire
        f.put(geo.box(0.14, 2.0, 0.14), S.wood, 0, 1.0, 0).put(geo.box(1.3, 0.1, 0.1), S.wood, 0, 1.8, 0).put(geo.box(0.5, 0.06, 0.06), S.wood, 0, 1.45, 0, { rz: 0.5 });
        for (const x of [-0.55, 0, 0.55]) f.put(geo.cylinder(0.05, 0.07, 0.2, 8), 0xdfeeee, x, 1.95, 0).put(geo.sphere(0.07, 6, 4), 0xdfeeee, x, 2.07, 0);
        f.put(geo.torus(0.4, 0.015, 4, 20), 0xc0784a, 0, 1.75, 0.0, { rx: 0.2, sy: 1.3 });
        cap(f, 1.3, 0.12, 1.85, 0, 0);
        f.put(geo.box(0.7, 0.1, 0.4), 0x8a8c8c, 0, 0.05, 0);
      }
      break;
    }
    case 7: {
      if (v === 0) {
        // a rack of gas bottles, two by two
        for (const [x, z, c] of [[-0.3, -0.22, 0xd99b26], [0.3, -0.22, 0xc44536], [-0.3, 0.26, 0xc44536], [0.3, 0.26, 0xd99b26]] as const) {
          f.put(geo.cylinder(0.17, 0.17, 1.0, 10), c, x, 0.55, z).put(geo.sphere(0.17, 10, 6), c, x, 1.05, z, { sy: 0.8 }).put(geo.cylinder(0.04, 0.04, 0.16, 6), 0x444a54, x, 1.25, z).put(geo.sphere(0.12, 6, 4), SNOW, x, 1.18, z, { sy: 0.4 });
        }
        for (const y of [0.35, 0.9]) f.put(geo.box(1.25, 0.05, 0.05), 0x444a54, 0, y, 0.0).put(geo.box(0.05, 0.05, 0.9), 0x444a54, -0.52, y, 0).put(geo.box(0.05, 0.05, 0.9), 0x444a54, 0.52, y, 0);
        f.put(geo.box(1.3, 0.08, 0.95), 0x6c7684, 0, 0.04, 0.02);
      } else if (v === 1) {
        // a stack of drums: two standing, one lying across the top
        for (const [x, c] of [[-0.32, S.drum[0]!], [0.32, S.drum[1]!]] as const) {
          f.put(geo.cylinder(0.28, 0.3, 0.86, 12), c, x, 0.43, 0);
          for (const y of [0.2, 0.66]) f.put(geo.cylinder(0.305, 0.305, 0.06, 12), S.band, x, y, 0);
        }
        f.put(geo.cylinder(0.26, 0.26, 0.74, 12), S.drum[2]!, 0, 1.12, 0, { rz: Math.PI / 2 });
        for (const x of [-0.24, 0.24]) f.put(geo.cylinder(0.265, 0.265, 0.06, 12), S.band, x, 1.12, 0, { rz: Math.PI / 2 });
        cap(f, 0.7, 0.3, 1.36, 0, 0);
      } else {
        // a roadside fuel pump: yellow body, red stripe, a lit price board and a coiled hose
        f.put(geo.box(0.8, 0.1, 0.6), 0xb8bcc4, 0, 0.05, 0).put(geo.box(0.5, 1.3, 0.38), 0xe6c84a, 0, 0.75, 0).put(geo.box(0.52, 0.14, 0.4), 0xc44536, 0, 0.5, 0).put(geo.box(0.56, 0.1, 0.44), 0x444a54, 0, 1.45, 0);
        g.put(geo.box(0.34, 0.24, 0.04), 0xbff0d0, 0, 1.05, 0.2);
        f.put(geo.torus(0.2, 0.035, 6, 14), 0x2f3036, 0.42, 0.7, 0, { ry: Math.PI / 2 });
        cap(f, 0.56, 0.44, 1.5, 0, 0);
      }
      break;
    }
    case 8: {
      if (v === 0) {
        // a solar panel on a post, snow along its upper edge
        f.put(geo.cylinder(0.06, 0.08, 1.0, 8), 0xc4c2ba, 0, 0.5, 0).put(geo.box(0.7, 0.1, 0.5), 0xc4c2ba, 0, 0.05, 0);
        f.put(geo.box(1.5, 0.06, 0.95), 0xf0eadb, 0, 1.25, 0, { rx: -0.55 }).put(geo.box(1.36, 0.07, 0.82), 0x3a5f7a, 0, 1.26, 0.01, { rx: -0.55 });
        for (const x of [-0.45, 0, 0.45]) f.put(geo.box(0.03, 0.075, 0.82), 0x7fb0c4, x, 1.27, 0.01, { rx: -0.55 });
        f.put(geo.box(1.4, 0.05, 0.22), SNOW, 0, 1.52, -0.27, { rx: -0.55 });
      } else if (v === 1) {
        // a pallet of gold bars in a pyramid
        f.put(geo.box(1.6, 0.1, 0.8), 0xc9b99c, 0, 0.05, 0);
        for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 3 - layer; i++) for (const z of [-0.2, 0.2]) f.put(geo.box(0.5, 0.16, 0.3), shade(GOLD_POOL, 0.9 + ((i + layer + (z > 0 ? 1 : 0)) % 3) * 0.08), -((2 - layer) * 0.55) / 2 + i * 0.55, 0.18 + layer * 0.17, z);
        f.put(geo.box(0.3, 0.04, 0.12), 0xfff3b0, -0.1, 0.74, 0.2, { ry: 0.3 });
      } else {
        // a white server cabinet with rows of lit ports
        f.put(geo.box(0.72, 1.7, 0.62), 0xeee8d8, 0, 0.85, 0).put(geo.box(0.62, 1.55, 0.04), 0x5c9aa0, 0, 0.85, 0.32);
        for (let k = 0; k < 6; k++) g.put(geo.box(0.46, 0.05, 0.02), k % 2 ? 0x9fe8d8 : 0xbff0d0, 0, 0.3 + k * 0.22, 0.345);
        f.put(geo.box(0.8, 0.07, 0.7), 0xc4c2ba, 0, 1.73, 0);
        cap(f, 0.8, 0.7, 1.76, 0, 0);
      }
      break;
    }
    case 9: {
      if (v === 0) {
        // two hazard drums, a mint glow on their lids
        for (const [x, z] of [[-0.3, 0], [0.32, 0.15]] as const) {
          f.put(geo.cylinder(0.3, 0.32, 0.9, 12), S.drum[0]!, x, 0.45, z).put(geo.cylinder(0.325, 0.325, 0.12, 12), S.band, x, 0.3, z).put(geo.cylinder(0.325, 0.325, 0.12, 12), S.band, x, 0.62, z);
          g.put(geo.circleGround(0.18, 10), 0x86e8c4, x, 0.92, z);
        }
        f.put(geo.box(0.5, 0.35, 0.05), 0xe8c547, 0, 0.35, 0.55);
      } else if (v === 1) {
        // graphite blocks stacked in courses
        for (const [x, z, y, ry, c] of [[-0.4, 0, 0.16, 0, 0x5c5b5b], [0.4, 0.02, 0.16, 0.04, 0x4b4a4a], [0, 0, 0.49, 0.08, 0x4b4a4a], [0.1, 0.02, 0.82, -0.1, 0x5c5b5b]] as const) f.put(geo.box(0.8, 0.32, 0.55), c, x, y, z, { ry });
        cap(f, 0.8, 0.55, 0.98, 0.1, 0.02);
        f.put(geo.box(0.3, 0.2, 0.05), 0xe8c547, -0.4, 0.2, 0.3);
      } else {
        // a hazard warning sign on a post, a mint beacon above it
        f.put(geo.cylinder(0.05, 0.06, 1.9, 8), 0x8a8f92, 0, 0.95, 0).put(geo.cylinder(0.4, 0.4, 0.05, 3), 0xe8c547, 0, 1.45, 0.05, { rx: Math.PI / 2, ry: Math.PI / 6 }).put(geo.cylinder(0.24, 0.24, 0.06, 3), 0x3d3a39, 0, 1.43, 0.07, { rx: Math.PI / 2, ry: Math.PI / 6 });
        g.put(geo.sphere(0.14, 8, 6), 0x86e8c4, 0, 2.0, 0);
        f.put(geo.box(0.6, 0.1, 0.5), 0x8a8f92, 0, 0.05, 0);
      }
      break;
    }
    default: {
      if (v === 0) {
        // a pedestal of rare-earth crystals, three of them glowing
        f.put(geo.cylinder(0.45, 0.55, 0.45, 16), 0xd9dae6, 0, 0.22, 0).put(geo.torus(0.48, 0.05, 6, 20), 0xb9a3e8, 0, 0.45, 0, { rx: Math.PI / 2 });
        for (const [x, z, h, r, tilt] of [[0, 0, 1.1, 0.2, 0], [-0.25, 0.12, 0.75, 0.14, 0.3], [0.25, -0.05, 0.85, 0.15, -0.25], [0.08, 0.28, 0.55, 0.11, -0.12], [-0.12, -0.25, 0.6, 0.12, 0.2]] as const) {
          f.put(geo.cone(r, h, 6), 0xb9a3e8, x, 0.45 + h / 2, z, { rz: tilt, rx: tilt * 0.3 });
          if (h > 0.7) g.put(geo.cone(r * 0.5, h * 0.75, 6), 0xe6dcff, x, 0.45 + h * 0.4, z, { rz: tilt, rx: tilt * 0.3 });
        }
      } else if (v === 1) {
        // a helium-3 tank on a cradle: white shell, a lavender band, a valve and a lit gauge dot
        for (const x of [-0.4, 0.4]) f.put(geo.box(0.12, 0.3, 0.6), 0xd9dae6, x, 0.15, 0);
        f.put(geo.cylinder(0.34, 0.34, 1.0, 14), 0xe6f2ff, 0, 0.5, 0, { rz: Math.PI / 2 });
        for (const x of [-0.5, 0.5]) f.put(geo.sphere(0.34, 12, 8), 0xe6f2ff, x, 0.5, 0);
        f.put(geo.cylinder(0.35, 0.35, 0.14, 14), 0xb9a3e8, 0, 0.5, 0, { rz: Math.PI / 2 });
        f.put(geo.cylinder(0.05, 0.05, 0.16, 6), 0x9aa0b4, 0, 0.9, 0).put(geo.sphere(0.12, 8, 5), SNOW, 0, 0.88, 0, { sy: 0.35, sx: 3.2 });
        g.put(geo.sphere(0.05, 6, 4), 0xb9a3e8, 0.2, 0.62, 0.32);
      } else {
        // a floating-orb lamp: a slim white post, a ring and a softly glowing orb
        roundBase(0.4, 0xd9dae6);
        f.put(geo.cylinder(0.05, 0.07, 1.5, 8), 0xf6f1e7, 0, 0.8, 0).put(geo.torus(0.34, 0.04, 6, 24), 0xb9a3e8, 0, 1.7, 0, { rx: Math.PI / 2 });
        g.put(geo.sphere(0.22, 12, 8), 0xd9c8ff, 0, 1.7, 0);
      }
    }
  }
}

/** 0.9.12: each era's fir and bush green (warm pine early, cooler later, a soft mint in the AI era), and its berries. */
const FIR_GREEN: readonly (number | undefined)[] = [undefined, undefined, 0x356b45, 0x2f5f44, 0x3a6448, 0x2f5a4c, 0x2f6656, 0x3b6a4e, 0x2e6a5e, 0x2f7462, 0x5a8f7c];
const BERRY: readonly (number | undefined)[] = [undefined, undefined, 0xe0604a, 0xff8a4a, 0xffc04a, 0xff7a5a, 0x7ae8e0, 0xffd36b, 0x9be0ff, 0x86e8c4, 0xd9c8ff];

/** One drum body at (x, z): a barrel, a hazard drum or (era 10) a helium canister; `c` picks its colour. */
function drum(f: Frame, g: Frame, n: number, S: DecorStyle, x: number, z: number, c: number): void {
  const col = S.drum[c % S.drum.length]!;
  if (n === 10) {
    f.put(geo.cylinder(0.26, 0.26, 0.72, 12), col, x, 0.4, z).put(geo.sphere(0.26, 12, 8), col, x, 0.76, z, { sy: 0.8 }).put(geo.cylinder(0.27, 0.27, 0.1, 12), S.band, x, 0.45, z);
    f.put(geo.cylinder(0.04, 0.04, 0.12, 6), 0x9aa0b4, x, 1.03, z).put(geo.sphere(0.12, 8, 4), SNOW, x, 0.98, z, { sy: 0.35, sx: 1.2 });
    return;
  }
  f.put(geo.cylinder(0.27, 0.29, 0.85, 12), col, x, 0.425, z);
  for (const y of [0.2, 0.65]) f.put(geo.cylinder(0.295, 0.295, 0.06, 12), S.band, x, y, z);
  f.put(geo.cylinder(0.25, 0.25, 0.04, 12), shade(col, 1.15), x, 0.86, z).put(geo.cylinder(0.22, 0.22, 0.04, 12), SNOW, x, 0.9, z);
  if (n === 9) g.put(geo.circleGround(0.12, 8), 0x86e8c4, x, 0.93, z);
}

/** Draw every decor piece (statics: body, lit parts, lamp bulbs). No extra draw calls: it all joins the region's batches. */
/**
 * 0.9.12 (Dino: "plaza centrepieces"): the market's centrepiece, in its era's own style, on a round snowy kerb with
 * winter flowers. II-III a statue on a plinth (a lantern bearer, a smith with his hammer), IV a street clock, V a
 * girder sculpture, VI a lit deco fountain, VII a little oil derrick monument, VIII a glowing data pillar, IX a fountain
 * of glowing aqua water, X an orb floating over a ring. About 2.3 m across (DECOR_SIZE.centre), its collider the same.
 */
function buildCentre(f: Frame, g: Frame, b: Frame, n: number, S: DecorStyle, accent: number, glowC: number): void {
  const stone = n <= 4 ? 0xb4aca0 : n <= 7 ? 0xa9adb0 : 0xdcdfe4;
  const leaf = shade(FIR_GREEN[n] ?? 0x2f6b4a, 1.1);
  // the round kerb and its bed of winter flowers
  f.put(geo.cylinder(1.12, 1.15, 0.3, 24), stone, 0, 0.15, 0);
  f.put(geo.cylinder(1.0, 1.0, 0.04, 24), SNOW, 0, 0.31, 0);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    f.put(geo.sphere(0.17, 8, 6), leaf, Math.cos(a) * 0.8, 0.4, Math.sin(a) * 0.8, { sy: 0.7 });
    g.put(geo.sphere(0.07, 6, 4), k % 2 ? (BERRY[n] ?? 0xff6b6b) : 0xfff3f0, Math.cos(a + 0.2) * 0.84, 0.52, Math.sin(a + 0.2) * 0.84);
  }
  const plinth = (h: number): void => {
    f.put(geo.boxBase(0.75, h, 0.75), shade(stone, 0.92), 0, 0.3, 0).put(geo.box(0.85, 0.08, 0.85), shade(stone, 1.05), 0, 0.3 + h, 0);
    f.put(geo.box(0.8, 0.05, 0.8), SNOW, 0, 0.36 + h, 0);
  };
  // a stylised figure standing at height y, the arm raised with what it holds
  const figure = (y: number, bronze: number, hold: (x: number, y: number) => void): void => {
    const k = 1.35;
    const o = { sx: k, sy: k, sz: k };
    f.put(geo.capsule(0.2, 0.42, 4, 8), bronze, 0, y + 0.42 * k, 0, o).put(geo.sphere(0.17, 10, 8), bronze, 0, y + 0.95 * k, 0, o);
    f.put(geo.sphere(0.12, 8, 5), SNOW, 0, y + 1.07 * k, 0, { sx: k, sy: 0.45 * k, sz: k });
    f.put(geo.capsule(0.06, 0.38, 3, 6), bronze, 0.24 * k, y + 0.85 * k, 0, { rz: -0.5, ...o }).put(geo.capsule(0.06, 0.3, 3, 6), bronze, -0.22 * k, y + 0.45 * k, 0, { rz: 0.2, ...o });
    hold(0.38 * k, y + 1.12 * k);
  };
  const bronze = mix(0x6f6252, accent, 0.25);
  switch (n) {
    case 2:
      plinth(0.8);
      figure(1.12, bronze, (x, y) => {
        f.put(geo.box(0.16, 0.2, 0.16), 0x3a3634, x, y + 0.02, 0);
        b.put(geo.sphere(0.07, 8, 6), 0xffc067, x, y + 0.02, 0);
      });
      break;
    case 3:
      plinth(0.8);
      figure(1.12, mix(0x4a4848, accent, 0.2), (x, y) => {
        f.put(geo.box(0.04, 0.36, 0.04), 0x6e5646, x, y - 0.05, 0, { rz: -0.3 }).put(geo.box(0.2, 0.12, 0.12), 0x3f3d3f, x + 0.06, y + 0.14, 0, { rz: -0.3 });
      });
      f.put(geo.boxBase(0.4, 0.2, 0.22), 0x3f3d3f, -0.15, 1.12, 0.12);
      break;
    case 4: {
      // a street clock: a fluted iron post with a glowing four-faced clock
      f.put(geo.cylinder(0.12, 0.16, 1.9, 10), 0x2f3033, 0, 1.25, 0);
      f.put(geo.box(0.5, 0.5, 0.5), 0x2f3033, 0, 2.4, 0).put(geo.cone(0.34, 0.3, 4), 0x2f3033, 0, 2.8, 0, { ry: Math.PI / 4 });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        b.put(geo.cylinder(0.19, 0.19, 0.02, 16), 0xfff1c8, Math.sin(a) * 0.26, 2.4, Math.cos(a) * 0.26, { rx: Math.PI / 2, rz: 0, ry: a });
        f.put(geo.box(0.02, 0.14, 0.01), 0x2a2a2a, Math.sin(a) * 0.28, 2.43, Math.cos(a) * 0.28, { ry: a });
      }
      f.put(geo.sphere(0.24, 8, 5), SNOW, 0, 2.95, 0, { sy: 0.3 });
      break;
    }
    case 5:
      // a riveted girder arch, steel and the era's rust red
      for (const x of [-0.45, 0.45]) f.put(geo.boxBase(0.18, 1.8, 0.18), x < 0 ? S.drum[0]! : 0x76818a, x, 0.3, 0);
      f.put(geo.box(1.1, 0.2, 0.2), S.drum[0]!, 0, 2.2, 0).put(geo.box(0.12, 1.3, 0.06), 0x76818a, 0, 1.4, 0, { rz: 0.8 });
      f.put(geo.box(1.15, 0.05, 0.24), SNOW, 0, 2.33, 0);
      break;
    case 6:
    case 9: {
      // a two-tier fountain; in IX its water glows aqua
      const water = n === 9 ? 0x86e8c4 : 0xbfe6f2;
      const w = n === 9 ? b : f;
      w.put(geo.cylinder(0.92, 0.92, 0.04, 24), water, 0, 0.3, 0);
      f.put(geo.cylinder(0.12, 0.16, 1.1, 10), stone, 0, 0.85, 0).put(geo.cylinder(0.5, 0.36, 0.14, 18), stone, 0, 1.42, 0);
      w.put(geo.cylinder(0.44, 0.44, 0.03, 18), water, 0, 1.49, 0);
      f.put(geo.cylinder(0.06, 0.08, 0.5, 8), stone, 0, 1.75, 0);
      if (n === 6) b.put(geo.sphere(0.16, 12, 8), mix(glowC, 0xffffff, 0.4), 0, 2.08, 0);
      else for (let k = 0; k < 6; k++) b.put(geo.sphere(0.05, 6, 4), water, Math.cos(k) * 0.3, 1.62 + (k % 3) * 0.08, Math.sin(k) * 0.3);
      break;
    }
    case 7:
      // a little derrick monument with a lamp at its crown
      for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]] as const) f.put(geo.box(0.06, 2.2, 0.06), 0x444a54, x * 0.6, 1.4, z * 0.6, { rx: -z * 0.28, rz: x * 0.28 });
      for (const y of [0.9, 1.5]) f.put(geo.box(0.6 - (y - 0.9) * 0.3, 0.05, 0.05), 0xc44536, 0, y, 0.2 - (y - 0.9) * 0.08);
      b.put(geo.sphere(0.1, 8, 6), 0xffd36b, 0, 2.5, 0);
      break;
    case 8:
      // a glowing data pillar: a white column with lit bands
      f.put(geo.cylinder(0.3, 0.34, 2.0, 16), 0xf0eadb, 0, 1.3, 0);
      for (const y of [0.9, 1.4, 1.9]) b.put(geo.cylinder(0.31, 0.31, 0.06, 16), mix(glowC, 0xffffff, 0.3), 0, y, 0);
      f.put(geo.cylinder(0.32, 0.32, 0.05, 16), SNOW, 0, 2.33, 0);
      break;
    default:
      // X: an orb floating over a glowing ring
      f.put(geo.cylinder(0.35, 0.45, 0.4, 16), 0xe3d9f6, 0, 0.5, 0);
      b.put(geo.torus(0.5, 0.04, 6, 24), mix(glowC, 0xffffff, 0.3), 0, 1.25, 0, { rx: Math.PI / 2 });
      b.put(geo.sphere(0.34, 16, 12), mix(accent, 0xffffff, 0.35), 0, 1.75, 0);
      break;
  }
}

/** 0.9.13 (review E5): an open-air market stall (eras 6-10): four posts, an awning striped in the era's accent, a counter of the era's goods. */
function stallPiece(f: Frame, g: Frame, S: DecorStyle, accent: number, v: number, seed: number): void {
  const wood = shade(S.wood, 0.8);
  for (const x of [-0.82, 0.82]) for (const z of [-0.5, 0.5]) f.put(geo.boxBase(0.08, 2.3, 0.08), wood, x, 0, z);
  // the back board and a shelf of goods
  f.put(geo.box(1.64, 0.75, 0.05), shade(wood, 0.9), 0, 1.3, -0.5);
  f.put(geo.box(1.5, 0.05, 0.28), wood, 0, 1.05, -0.36);
  for (let k = 0; k < 4; k++) f.put(geo.boxBase(0.28, 0.2 + (k % 2) * 0.08, 0.2), S.goods[k % 2]!, -0.55 + k * 0.37, 1.08, -0.36);
  // the striped awning, high at the back and sloping to the front, and a scalloped valance
  const nS = 8;
  for (let k = 0; k < nS; k++) {
    const col = k % 2 ? CREAM : accent;
    const x = -0.95 + ((k + 0.5) * 1.9) / nS;
    f.put(geo.box(1.9 / nS, 0.05, 1.32), col, x, 2.26, 0.0, { rx: 0.23 });
    f.put(geo.box(1.9 / nS, 0.18, 0.04), col, x, 2.07, 0.66);
  }
  f.put(geo.box(1.92, 0.05, 1.3), SNOW, 0, 2.31, -0.02, { rx: 0.23 });
  // the counter with its goods; a price board on the front
  f.put(geo.boxBase(1.6, 0.85, 0.5), S.crate, 0, 0, 0.25);
  f.put(geo.box(1.7, 0.07, 0.6), shade(wood, 1.15), 0, 0.88, 0.25);
  f.put(geo.box(0.6, 0.22, 0.03), CREAM, 0, 0.55, 0.51).put(geo.box(0.45, 0.08, 0.03), accent, 0, 0.55, 0.53);
  if (v === 1) {
    for (let k = 0; k < 3; k++) f.put(geo.boxBase(0.4, 0.28, 0.34), k % 2 ? S.crate : shade(S.crate, 1.1), -0.55 + k * 0.55, 0.92, 0.25).put(geo.box(0.3, 0.07, 0.24), S.goods[k % 2]!, -0.55 + k * 0.55, 1.22, 0.25);
  } else if (v === 2) {
    for (let k = 0; k < 3; k++) f.put(geo.sphere(0.2, 8, 6), S.sack[k % 2]!, -0.5 + k * 0.5, 1.07, 0.25, { sy: 0.8 });
  } else {
    goodsHeap(f, S, -0.4, 0.92, 0.25, 0.75, seed);
    goodsHeap(f, S, 0.42, 0.92, 0.25, 0.75, seed + 1);
  }
  // a little lantern under the awning
  f.put(geo.cylinder(0.008, 0.008, 0.2, 4), 0x3a3634, 0.55, 2.05, 0.3);
  g.put(geo.sphere(0.08, 8, 6), WINDOW, 0.55, 1.9, 0.3);
}

/** 0.9.13 (review E5): a snowman in the era's scarf, topped with an era-flavoured hat. */
function snowmanPiece(f: Frame, g: Frame, n: number, accent: number): void {
  const coal = 0x2b2b2e;
  f.put(geo.sphere(0.36, 12, 9), SNOW, 0, 0.34, 0).put(geo.sphere(0.27, 12, 9), 0xffffff, 0, 0.84, 0).put(geo.sphere(0.2, 12, 9), SNOW, 0, 1.17, 0);
  for (const x of [-0.07, 0.07]) f.put(geo.sphere(0.03, 6, 4), coal, x, 1.22, 0.18);
  for (let k = 0; k < 5; k++) f.put(geo.sphere(0.018, 5, 4), coal, (k - 2) * 0.045, 1.09 + Math.abs(k - 2) * 0.015, 0.19);
  f.put(geo.cone(0.035, 0.2, 6), 0xf08a2a, 0, 1.16, 0.3, { rx: Math.PI / 2 });
  for (const y of [0.97, 0.84, 0.71]) f.put(geo.sphere(0.035, 6, 4), coal, 0, y, 0.26);
  f.put(geo.sphere(0.035, 6, 4), coal, 0, 0.42, 0.35);
  for (const s of [-1, 1]) f.put(geo.box(0.5, 0.03, 0.03), 0x6b4a36, s * 0.43, 0.98 + 0.05, 0, { rz: s * 0.5 });
  // the scarf in the era's accent colour, its tail hanging down the front
  f.put(geo.torus(0.2, 0.055, 5, 14), accent, 0, 1.0, 0, { rx: Math.PI / 2 });
  f.put(geo.box(0.1, 0.34, 0.03), accent, 0.12, 0.84, 0.24).put(geo.box(0.1, 0.05, 0.035), CREAM, 0.12, 0.7, 0.24);
  switch (n) {
    case 6:
      // a copper top hat with a teal band
      f.put(geo.cylinder(0.24, 0.24, 0.03, 14), 0xc0784a, 0, 1.34, 0).put(geo.cylinder(0.14, 0.14, 0.26, 12), 0xc0784a, 0, 1.47, 0).put(geo.cylinder(0.145, 0.145, 0.05, 12), 0x3f706a, 0, 1.4, 0);
      f.put(geo.cylinder(0.12, 0.12, 0.03, 12), SNOW, 0, 1.61, 0);
      break;
    case 7:
      // a yellow hard hat
      f.put(geo.sphere(0.2, 12, 7), 0xe6b84a, 0, 1.34, 0, { sy: 0.75 }).put(geo.cylinder(0.25, 0.25, 0.025, 14), 0xd9a53a, 0, 1.33, 0, { sz: 1.15 });
      f.put(geo.box(0.05, 0.04, 0.34), 0xd9a53a, 0, 1.5, 0);
      g.put(geo.sphere(0.035, 6, 4), 0xffe08a, 0, 1.4, 0.2);
      break;
    case 8:
      // a headset: a band over the head, teal ear cups and a mic boom with a gold tip
      for (let k = 0; k < 7; k++) {
        const a = (k * Math.PI) / 6;
        f.put(geo.box(0.05, 0.05, 0.05), 0xf0eadb, Math.cos(a) * 0.215, 1.17 + Math.sin(a) * 0.215, 0, { rz: a + Math.PI / 2 });
      }
      for (const s of [-1, 1]) g.put(geo.cylinder(0.075, 0.075, 0.06, 10), 0x6fe0d4, s * 0.215, 1.17, 0, { rz: Math.PI / 2 });
      f.put(geo.box(0.02, 0.02, 0.22), 0xdfeeee, -0.2, 1.1, 0.1);
      g.put(geo.sphere(0.03, 6, 4), 0xf2c85a, -0.2, 1.1, 0.22);
      break;
    case 9:
      // an aqua beanie with a glowing pom-pom
      f.put(geo.sphere(0.2, 12, 7), 0x5bb391, 0, 1.33, 0, { sy: 0.75 }).put(geo.cylinder(0.205, 0.205, 0.07, 12), shade(0x5bb391, 0.8), 0, 1.31, 0);
      g.put(geo.sphere(0.06, 8, 6), 0x86e8c4, 0, 1.5, 0);
      break;
    default:
      // a little crown of lavender crystals
      f.put(geo.cylinder(0.17, 0.18, 0.06, 12), 0xd2bff4, 0, 1.36, 0);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        g.put(geo.cone(0.04, 0.2, 5), k % 2 ? 0xe8a8c0 : 0xd9c8ff, Math.cos(a) * 0.13, 1.49, Math.sin(a) * 0.13);
      }
      break;
  }
}

/**
 * 0.9.13 (review E6): the market's parked era vehicle, nose toward local +X, its rear doors (or tailgate) open with two
 * crates stacked behind it, all inside DECOR_SIZE.van (3.6 × 1.8 m). VI a rounded 1930s delivery van in teal and cream,
 * VII a red pickup with oil drums in its bed, VIII a boxy 80s white van with a teal stripe and a gold logo.
 */
function vanPiece(f: Frame, g: Frame, n: number, S: DecorStyle): void {
  const rubber = 0x2c2f33;
  const wheel = (x: number, z: number, hub: number): void => void f.put(geo.cylinder(0.28, 0.28, 0.18, 14), rubber, x, 0.28, z, { rx: Math.PI / 2 }).put(geo.cylinder(0.13, 0.13, 0.2, 10), hub, x, 0.28, z, { rx: Math.PI / 2 });
  const crates = (x: number): void => {
    f.put(geo.boxBase(0.5, 0.42, 0.6), S.crate, x, 0, 0).put(geo.box(0.06, 0.42, 0.02), S.strap, x, 0.21, 0.31).put(geo.box(0.06, 0.42, 0.02), S.strap, x - 0.15, 0.21, 0.31);
    f.put(geo.boxBase(0.44, 0.38, 0.5), shade(S.crate, 1.08), x + 0.02, 0.42, 0.02, { ry: 0.12 });
    f.put(geo.box(0.46, 0.04, 0.52), SNOW, x + 0.02, 0.82, 0.02, { ry: 0.12 });
  };
  if (n === 6) {
    const teal = 0x3f9a8f;
    const cream = 0xf3e7cc;
    f.put(geo.box(2.7, 0.16, 1.2), 0x2f3b3a, 0.2, 0.34, 0);
    f.put(geo.capsule(0.66, 1.5, 6, 14), teal, 0.2, 0.98, 0, { rz: Math.PI / 2, sx: 0.88 });
    for (const s of [-1, 1]) {
      f.put(geo.box(2.0, 0.1, 0.04), cream, 0.2, 0.84, s * 0.645);
      f.put(geo.box(0.62, 0.3, 0.03), 0xcfe9ee, 0.95, 1.2, s * 0.62);
      f.put(geo.cylinder(0.2, 0.2, 0.03, 14), cream, -0.2, 1.05, s * 0.655, { rx: Math.PI / 2 });
      f.put(geo.cylinder(0.12, 0.12, 0.035, 12), 0xc0784a, -0.2, 1.05, s * 0.665, { rx: Math.PI / 2 });
      f.put(geo.sphere(0.36, 10, 7), shade(teal, 0.75), 1.0, 0.5, s * 0.6, { sy: 0.6, sz: 0.55 });
      f.put(geo.sphere(0.36, 10, 7), shade(teal, 0.75), -0.7, 0.5, s * 0.6, { sy: 0.6, sz: 0.55 });
      wheel(1.0, s * 0.62, cream);
      wheel(-0.7, s * 0.62, cream);
      f.put(geo.sphere(0.12, 8, 6), 0xd0d4d6, 1.55, 0.74, s * 0.38);
      g.put(geo.sphere(0.085, 8, 6), WINDOW, 1.62, 0.74, s * 0.38);
      // a rear door swung open against the side
      f.put(geo.box(0.5, 0.9, 0.04), shade(teal, 1.05), -1.5, 0.95, s * 0.72);
    }
    f.put(geo.box(0.04, 0.34, 0.9), 0xcfe9ee, 1.45, 1.22, 0, { rz: -0.35 });
    f.put(geo.box(0.12, 0.12, 1.2), cream, 1.68, 0.45, 0);
    f.put(geo.sphere(1, 12, 6), SNOW, 0.2, 1.55, 0, { sx: 1.15, sy: 0.07, sz: 0.5 });
    crates(-1.45);
  } else if (n === 7) {
    const red = 0xc44536;
    f.put(geo.box(2.7, 0.2, 1.2), 0x3a3d44, 0.15, 0.38, 0);
    f.put(geo.boxBase(0.95, 0.7, 1.3), red, 0.85, 0.45, 0);
    f.put(geo.boxBase(0.35, 0.4, 1.28), red, 1.5, 0.5, 0);
    f.put(geo.box(0.04, 0.24, 1.0), 0xc9ccd0, 1.69, 0.7, 0);
    f.put(geo.box(0.9, 0.36, 1.18), 0xcfe3ee, 0.8, 1.33, 0);
    for (const x of [0.38, 1.22]) for (const z of [-0.6, 0.6]) f.put(geo.box(0.06, 0.38, 0.06), red, x, 1.33, z);
    f.put(geo.box(1.0, 0.07, 1.34), red, 0.8, 1.54, 0);
    f.put(geo.box(0.96, 0.05, 1.3), SNOW, 0.8, 1.6, 0);
    // the bed: floor, sides, a front wall, the tailgate down, three oil drums standing in it
    f.put(geo.box(1.4, 0.08, 1.3), 0x3a3d44, -0.3, 0.54, 0);
    for (const s of [-1, 1]) f.put(geo.box(1.4, 0.4, 0.06), red, -0.3, 0.78, s * 0.62);
    f.put(geo.box(0.06, 0.4, 1.3), red, 0.38, 0.78, 0);
    f.put(geo.box(0.36, 0.05, 1.2), red, -1.18, 0.54, 0);
    for (const [x, z, c] of [[-0.7, -0.3, 0], [-0.7, 0.3, 1], [-0.25, 0, 2]] as const) {
      const col = S.drum[c % S.drum.length]!;
      f.put(geo.cylinder(0.2, 0.2, 0.55, 10), col, x, 0.86, z).put(geo.cylinder(0.205, 0.205, 0.05, 10), S.band, x, 0.78, z).put(geo.cylinder(0.18, 0.18, 0.03, 10), SNOW, x, 1.15, z);
    }
    for (const s of [-1, 1]) {
      wheel(1.05, s * 0.62, 0xc9ccd0);
      wheel(-0.7, s * 0.62, 0xc9ccd0);
      f.put(geo.cylinder(0.16, 0.16, 0.03, 12), 0xe6b84a, 0.85, 0.8, s * 0.66, { rx: Math.PI / 2 });
      g.put(geo.sphere(0.09, 8, 6), WINDOW, 1.69, 0.72, s * 0.45);
    }
    f.put(geo.box(0.1, 0.12, 1.3), 0xc9ccd0, 1.72, 0.4, 0);
    crates(-1.55);
  } else {
    const white = 0xf0eadb;
    const teal = 0x45858c;
    const gold = 0xe5c05a;
    f.put(geo.box(2.7, 0.16, 1.2), 0x3a3d44, 0.0, 0.36, 0);
    f.put(geo.boxBase(2.35, 1.15, 1.4), white, -0.1, 0.42, 0);
    f.put(geo.boxBase(0.55, 0.65, 1.4), white, 1.35, 0.42, 0);
    f.put(geo.box(0.04, 0.52, 1.25), 0x9fd8dc, 1.1, 1.33, 0, { rz: -0.25 });
    f.put(geo.box(2.4, 0.05, 1.4), SNOW, -0.1, 1.6, 0);
    f.put(geo.box(0.1, 0.14, 1.4), 0x4a4e55, 1.67, 0.45, 0);
    f.put(geo.box(0.03, 0.9, 1.2), 0x2a2f33, -1.28, 0.95, 0);
    for (const s of [-1, 1]) {
      f.put(geo.box(2.9, 0.16, 0.03), teal, 0.15, 0.9, s * 0.71);
      f.put(geo.box(2.9, 0.04, 0.03), gold, 0.15, 1.04, s * 0.71);
      f.put(geo.box(0.7, 0.4, 0.03), 0x9fd8dc, 0.7, 1.3, s * 0.71);
      g.put(geo.cylinder(0.17, 0.17, 0.03, 14), gold, -0.45, 1.3, s * 0.72, { rx: Math.PI / 2 });
      f.put(geo.box(0.16, 0.16, 0.03), teal, -0.45, 1.3, s * 0.745, { rz: Math.PI / 4 });
      g.put(geo.box(0.03, 0.12, 0.28), WINDOW, 1.64, 0.7, s * 0.45);
      wheel(1.0, s * 0.62, teal);
      wheel(-0.7, s * 0.62, teal);
      f.put(geo.box(0.5, 1.0, 0.04), white, -1.525, 0.95, s * 0.72);
    }
    f.put(geo.box(0.55, 0.03, 1.0), teal, 1.35, 1.08, 0);
    f.put(geo.box(1.2, 0.04, 0.03), gold, -0.1, 0.62, 0.71);
    crates(-1.52);
  }
}

function buildDecor(body: Batch, glow: Batch, bulbs: Batch, n: number, st: PlotStyle, items: readonly DecorPlace[]): void {
  const S = DECOR[n]!;
  const tilt = (k: number): number => ((k * 7 + n * 3) % 5 - 2) * 0.05;
  items.forEach((d, i) => {
    const f = new Frame(body, d.x, d.z, d.yaw);
    const g = new Frame(glow, d.x, d.z, d.yaw);
    switch (d.kind) {
      case 'centre':
        buildCentre(f, g, new Frame(bulbs, d.x, d.z, d.yaw), n, S, ERAS[n]!.colors.accent, ERAS[n]!.colors.glow);
        break;
      case 'crates': {
        if (d.v === 1) {
          // one open crate heaped with goods
          f.put(geo.boxBase(1.0, 0.55, 0.8), S.crate, 0, 0, 0).put(geo.box(0.07, 0.55, 0.02), S.strap, -0.3, 0.275, 0.41).put(geo.box(0.07, 0.55, 0.02), S.strap, 0.3, 0.275, 0.41);
          goodsHeap(f, S, 0, 0.55, 0, 0.9, i);
        } else {
          f.put(geo.boxBase(1.0, 0.55, 0.85), S.crate, 0, 0, 0).put(geo.box(0.07, 0.55, 0.02), S.strap, -0.3, 0.275, 0.43).put(geo.box(0.07, 0.55, 0.02), S.strap, 0.3, 0.275, 0.43);
          f.put(geo.boxBase(0.7, 0.5, 0.65), shade(S.crate, 1.08), -0.1, 0.55, 0.02, { ry: tilt(i) }).put(geo.box(0.06, 0.5, 0.02), S.strap, -0.3, 0.8, 0.36, { ry: tilt(i) });
          cap(f, 0.74, 0.69, 1.05, -0.1, 0.02);
        }
        break;
      }
      case 'sacks': {
        const [a, b] = S.sack;
        for (const [x, y, z, c] of [[-0.27, 0.25, 0.0, a], [0.27, 0.25, 0.02, b], [0.0, 0.6, 0.0, a]] as const) {
          f.put(geo.sphere(0.32, 10, 8), c, x, y, z, { sx: 1.0, sy: 0.78, sz: 0.85, ry: tilt(i + x * 3) });
          f.put(geo.cylinder(0.07, 0.09, 0.1, 6), shade(c, 0.78), x, y + 0.27, z);
        }
        f.put(geo.sphere(0.3, 8, 5), SNOW, 0, 0.82, 0, { sy: 0.28, sx: 1.2 });
        break;
      }
      case 'barrels':
        drum(f, g, n, S, -0.32, -0.15, d.v);
        drum(f, g, n, S, 0.32, -0.15, d.v + 1);
        drum(f, g, n, S, 0, 0.3, d.v + 2);
        break;
      case 'heap':
        goodsHeap(f, S, 0, 0, 0, 1.6, i);
        f.put(geo.sphere(0.5, 10, 5), SNOW, 0.35, 0.0, 0.15, { sx: 0.8, sy: 0.26, sz: 0.8 });
        break;
      case 'bench': {
        const wood = shade(S.wood, 0.9);
        f.put(geo.box(1.65, 0.08, 0.42), wood, 0, 0.5, 0.02).put(geo.box(1.65, 0.3, 0.06), shade(wood, 0.92), 0, 0.78, -0.2, { rx: -0.12 });
        for (const x of [-0.65, 0.65]) f.put(geo.boxBase(0.1, 0.5, 0.36), shade(wood, 0.7), x, 0, 0.02);
        f.put(geo.box(1.6, 0.05, 0.38), SNOW, 0, 0.56, 0.02).put(geo.box(1.6, 0.04, 0.07), SNOW, 0, 0.95, -0.22, { rx: -0.12 });
        break;
      }
      case 'lamp': {
        const post = shade(st.shopRoof, 0.85);
        f.put(geo.cylinder(0.06, 0.09, 3.0, 8), post, 0, 1.5, 0).put(geo.box(0.12, 0.08, 0.5), post, 0, 2.95, 0.18);
        new Frame(bulbs, d.x, d.z, d.yaw).put(geo.sphere(0.17, 10, 8), 0xffffff, 0, 2.82, 0.4);
        f.put(geo.cylinder(0.14, 0.14, 0.05, 8), SNOW, 0, 3.03, 0);
        break;
      }
      case 'fir': {
        // 0.9.12: a snowy fir in the era's own green (v 1: a touch taller), snow on every tier
        const leaf = FIR_GREEN[n] ?? 0x2f6b4a;
        const k = d.v === 1 ? 1.12 : 1;
        f.put(geo.cylinder(0.1, 0.14, 0.55, 6), 0x6b4a36, 0, 0.27, 0);
        for (const [r, h, y] of [[0.72, 0.95, 0.95], [0.56, 0.82, 1.5], [0.38, 0.7, 2.0]] as const) {
          f.put(geo.cone(r, h * k, 9), leaf, 0, y * k, 0).put(geo.cone(r * 0.8, h * 0.3 * k, 9), SNOW, 0, (y + h * 0.3) * k, 0);
        }
        f.put(geo.sphere(0.55, 10, 5), SNOW, 0.1, 0, 0.05, { sx: 1.3, sy: 0.25, sz: 1.1 });
        break;
      }
      case 'shrub': {
        // a round snow-capped bush with a few berries in the era's glow colour
        const leaf = shade(FIR_GREEN[n] ?? 0x2f6b4a, 1.15);
        f.put(geo.sphere(0.5, 10, 7), leaf, 0, 0.36, 0, { sx: 1.05, sy: 0.75, sz: 0.95 }).put(geo.sphere(0.32, 9, 6), shade(leaf, 0.9), 0.32, 0.26, 0.18, { sy: 0.8 });
        f.put(geo.sphere(0.44, 10, 5), SNOW, 0, 0.56, 0, { sx: 1.0, sy: 0.38, sz: 0.88 });
        for (let k = 0; k < 4; k++) g.put(geo.sphere(0.055, 6, 4), BERRY[n] ?? 0xff6b6b, Math.cos(k * 1.7 + i) * 0.42, 0.3 + (k % 2) * 0.12, Math.sin(k * 1.7 + i) * 0.38);
        break;
      }
      case 'snow':
        f.put(geo.sphere(0.5, 12, 6), SNOW, 0, 0, 0, { sx: 1.5, sy: 0.5, sz: 1.1 }).put(geo.sphere(0.5, 10, 5), 0xffffff, 0.12, 0.04, -0.05, { sx: 0.9, sy: 0.55, sz: 0.7 });
        if (d.v === 1) f.put(geo.dodecahedron(0.16), 0x9a948a, -0.3, 0.12, 0.1);
        break;
      case 'notice': {
        for (const x of [-0.55, 0.55]) f.put(geo.boxBase(0.1, 2.0, 0.1), shade(S.wood, 0.75), x, 0, 0);
        f.put(geo.box(1.4, 0.85, 0.05), S.wood, 0, 1.55, 0).put(geo.box(1.5, 0.07, 0.07), shade(S.wood, 0.7), 0, 1.99, 0).put(geo.box(1.5, 0.07, 0.07), shade(S.wood, 0.7), 0, 1.12, 0);
        for (let k = 0; k < 4; k++) f.put(geo.box(0.28, 0.34, 0.02), k % 2 ? CREAM : st.shopRoof, -0.48 + k * 0.32, 1.55 + (k % 2) * 0.12 - 0.05, 0.04, { rz: tilt(k + i) });
        f.put(geo.box(1.7, 0.08, 0.4), shade(st.shopRoof, 0.9), 0, 2.12, 0.0, { rx: 0.08 }).put(geo.box(1.72, 0.05, 0.36), SNOW, 0, 2.18, 0, { rx: 0.08 });
        break;
      }
      case 'cart':
        cartPiece(f, S, i);
        cap(f, 0.9, 0.5, 1.0, -0.05, 0);
        break;
      case 'sig':
        sigPiece(f, g, n, S, d.v);
        break;
      case 'stall':
        stallPiece(f, g, S, ERAS[n]!.colors.accent, d.v, i);
        break;
      case 'snowman':
        snowmanPiece(f, g, n, ERAS[n]!.colors.accent);
        break;
      case 'van':
        vanPiece(f, g, n, S);
        break;
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// the runtime part
// ---------------------------------------------------------------------------------------------------------------------

const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
// 0.9.13: the huts' and shops' windows come on one by one at dusk (render/duskWindows.ts); the rest of the lit parts
// (pools, lamps, centrepieces) keep GLOW_MAT
const WINDOW_MAT = duskBasic(new THREE.MeshBasicMaterial({ vertexColors: true }));
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
  const windows = new DuskBatch();
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
  const cars = forecourtCars(n);
  for (const c of cars) buildParkedCar(body, c);
  P.shops.forEach((s, i) => buildShop(body, windows, st, s, i, e.colors.accent, goods));
  const bulbs = new Batch();
  for (const l of P.lamps) {
    body.add(geo.cylinder(0.07, 0.1, 3.0, 8), shade(st.shopRoof, 0.85), l.x, 1.5, l.z);
    body.add(geo.box(0.5, 0.08, 0.12), shade(st.shopRoof, 0.85), l.x, 2.95, l.z + L.inward * 0.18);
    bulbs.add(geo.sphere(0.17, 10, 8), 0xffffff, l.x, 2.82, l.z + L.inward * 0.38);
  }
  for (const b of P.beds) buildBed(body, glow, bedKind(st, b.k), bedColor(st, b.k), b, rng, !!st.glow?.includes(b.k));
  buildFieldDressing(body, glow, st, P, rng, L.node.z);
  // 0.9.13 (E1): benches, ramps, derricks, walls and rims on the field's far edges, and the props working it
  const works = buildFieldWorks(body, glow, n, P, rng, st.beds[1], GLOW_MAT);
  buildGreen(body, glow, n, st, P, e.colors.accent, e.colors.glow);
  const decor = plotDecor(n);
  buildDecor(body, glow, bulbs, n, st, decor);
  // 0.9.12 lantern garlands: in the lamps' bulb batch (no extra draw call), warm paper tinted with the era's glow
  const paper = [mix(e.colors.glow, 0xffd27a, 0.55), 0xffc067, mix(e.colors.accent, 0xfff0d0, 0.45), 0xfff0c2];
  for (const g of plotGarlands(n)) addLanternGarland(bulbs, g.a, g.b, g.sag, g.seed, paper);
  P.shops.forEach((s, i) => {
    if (s.stall) return;
    buildShopSign(body, n, st, s, i, e.colors, goods);
    shopIcicles(body, st, s, i);
  });

  const statics = body.mesh({ cast: true, receive: true });
  statics.name = 'places';
  group.add(statics);
  if (!glow.empty) group.add(glow.mesh({ cast: false, receive: false, material: GLOW_MAT }));
  if (!windows.empty) group.add(windows.mesh({ cast: false, receive: false, material: WINDOW_MAT }));
  if (!bulbs.empty) group.add(bulbs.mesh({ cast: false, receive: false, material: bulbMaterial() }));
  for (const m of works.movers) group.add(m.object);
  for (const r of works.colliders) ctx.colliders.addBox(r, `era:${n}:field`);

  // colliders for the statics (the player walks round the shops and the green's centre)
  for (const s of P.shops) {
    if (s.stall) ctx.colliders.addBox(box(s.x, s.z - L.inward * (s.d / 2 - 0.7), s.w / 2 - 0.25, 0.45), `era:${n}:places`);
    else ctx.colliders.addBox(shopFootprint(s), `era:${n}:places`);
  }
  const gc = greenCentre(P);
  ctx.colliders.addBox(box(gc.x, gc.z, n >= 6 ? GREEN_PIECE_R - 0.1 : 0.8, n >= 6 ? GREEN_PIECE_R - 0.1 : 0.8), `era:${n}:places`);
  // the decor stands in the way like the shops do (snow piles and lamp posts are too low / slim to matter)
  for (const d of decor) if (d.kind !== 'snow' && d.kind !== 'lamp') ctx.colliders.addBox(box(d.x, d.z, d.hx * 0.92, d.hz * 0.92), `era:${n}:decor`);
  for (const c of cars) ctx.colliders.addBox(box(c.x, c.z, CAR_HX, CAR_HZ), `era:${n}:decor`);

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
  let clock = 0;
  const chimneys: (() => void)[] = [];

  const rebuild = (): void => {
    for (const c of [...huts.children]) {
      huts.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    const hb = new Batch();
    const hg = new DuskBatch();
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
    if (!hg.empty) huts.add(hg.mesh({ cast: false, receive: false, material: WINDOW_MAT }));
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
      clock += dt;
      for (const m of works.movers) m.update(clock);
      timer -= dt;
      if (timer > 0) return;
      timer = POLL;
      sync();
    },
  };
}
