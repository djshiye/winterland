/**
 * 0.9.13 (review E2): the machine yards of eras 6, 7 and 8 looked the same in the default yard framing (gate top right,
 * the IMPORT dock, Jack's stall and the red UPGRADES mat running left to right). Each of the three now gets ONE
 * signature structure in the free floor of the yard band EAST of the shop mat, built around the era's resource:
 *   6 Electric  a small art-deco POWER HOUSE (stepped teal-and-cream facade, tall lit windows, a verdigris dome, a glowing
 *               lightning-bolt sign) with three tall ceramic insulator stacks on a fenced pad beside it, mint glowing at their
 *               tops, copper wires from the roof to the stacks
 *   7 Oil       a GAS TANK FARM: two cream-and-red Horton spheres on leg rings with a ladder, red pipework joining them, and a
 *               slim FLARE STACK (about 6 m) with a small flame that sways gently (still with Reduce motion / calmer effects)
 *   8 Computer  a RAISED SHOWROOM DECK (0.8 m, steps down toward the region), a teal-glowing glass balustrade, a big white
 *               satellite dish on a mast and a retro home-computer kiosk with a glowing mint screen
 * Placement is derived from the RegionLayout, never from world numbers: the free rect lies between the shop mat (+3 m)
 * and the yard path along the split line (-1.7 m), 2.7-6.4 m in from the gate edge (the tree belt is near the fence, the
 * front aisle starts at 6.9). The camera looks from +X/+Z, so anything tall shows toward -X/-Z; the low parts therefore
 * start where `sightKeep` allows their height and the tall ones (insulators, flare, dish) stand at the east end.
 * Everything goes through the GroundKit batches (solid / floor / glow, halos), so it costs no draw call of its own; the
 * one exception is era 7's flame (one small mesh). Footprints (`yardSignatureRects`) are the colliders (frontier.ts
 * unlock) and the era modules' keep-outs. Code-built low-poly, no textures; colours from palette.ts rows.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import type { RegionLayout } from '../../../eras/layout';
import { glowScale, steadyHighlights } from '../../../fx/comfort';
import { geo } from '../../../render/materials';
import { glowMaterial } from '../../../render/paletteMaterials';
import { GOLD, MACHINE_TONES, mixHex, palette, SNOW } from '../../../render/palette';
import type { Rng } from '../common';
import type { GroundKit } from '../eraGround';
import type { Batch } from '../../../render/batch';
import { Kit, sightKeep, type GroundSolid } from './kit4to7';

/** Free rect limits: metres in from the gate edge, east of the shop mat, west of the split-line path. */
const DEPTH_MIN = 2.7;
const DEPTH_MAX = 6.4;
const EAST_OF_MAT = 3.0;
const WEST_OF_PATH = 1.7;
/** Height of the little floor pads (above the yard setts and the cell lines). */
const PAD_Y = 0.042;

const zAt = (l: RegionLayout, v: number): number => l.gate.z + l.inward * v;
/** World rect from x0..x1 and depths v0..v1 (metres in from the gate edge). */
const vr = (l: RegionLayout, x0: number, x1: number, v0: number, v1: number): Rect => {
  const a = zAt(l, v0);
  const b = zAt(l, v1);
  return { minX: x0, maxX: x1, minZ: Math.min(a, b), maxZ: Math.max(a, b) };
};

/** The ground the signature may use (eras 6-8 only). */
export function yardSignatureFree(l: RegionLayout): Rect {
  return vr(l, l.shopMat.x + EAST_OF_MAT, l.zones.yard.maxX - WEST_OF_PATH, DEPTH_MIN, DEPTH_MAX);
}

/** The first x at which a solid up to h metres tall may stand in the free band without hiding a pad (sightKeep). */
function minXFor(l: RegionLayout, h: number): number {
  const F = yardSignatureFree(l);
  let x = F.minX;
  // walk east past every keep that starts at or before x and overlaps the band (market stuff further east is no concern)
  const keeps = sightKeep(l, h).filter((r) => r.maxZ > F.minZ && r.minZ < F.maxZ).sort((a, b) => a.minX - b.minX);
  for (const r of keeps) if (r.minX <= x && r.maxX > x) x = r.maxX;
  return x + 0.08;
}

// ---------------------------------------------------------------------------------------------------------------------
// plans (pure): every number the footprints and the models share
// ---------------------------------------------------------------------------------------------------------------------

interface Plan {
  /** Colliders / keep-outs (hug the model). */
  rects: Rect[];
  /** Tall parts for the "hides nothing from the camera" test (each footprint with its own height). */
  solids: GroundSolid[];
}

interface Plan6 extends Plan {
  hall: { x: number; z: number; w: number; v: number };
  stacks: { x: number; z: number; h: number }[];
  pad: Rect;
}

function plan6(l: RegionLayout): Plan6 {
  const F = yardSignatureFree(l);
  const px = F.maxX - 1.0;
  const x0 = minXFor(l, 3.5);
  const w = Math.min(4.6, px - 0.85 - 0.05 - x0);
  const v = 4.5;
  const hallR = vr(l, x0, x0 + w, v - 1.55, v + 1.55);
  const pad = vr(l, px - 0.85, px + 0.85, 3.05, 5.95);
  const stacks = [
    { x: px, z: zAt(l, 3.5), h: 3.3 },
    { x: px, z: zAt(l, 4.5), h: 4.1 },
    { x: px, z: zAt(l, 5.5), h: 3.3 },
  ];
  return {
    hall: { x: x0 + w / 2, z: zAt(l, v), w, v },
    stacks,
    pad,
    rects: [hallR, pad],
    solids: [
      { what: 'power house', r: hallR, h: 3.5 },
      { what: 'insulator pad', r: pad, h: 4.4 },
    ],
  };
}

interface Plan7 extends Plan {
  tanks: { x: number; z: number }[];
  flare: { x: number; z: number };
}

const TANK_R = 1.2;
const TANK_Y = 2.2;

function plan7(l: RegionLayout): Plan7 {
  const F = yardSignatureFree(l);
  const flare = { x: F.maxX - 1.2, z: zAt(l, 4.5) };
  const c2 = flare.x - 2.7;
  const c1 = c2 - 2.9;
  const tanks = [{ x: c1, z: zAt(l, 4.5) }, { x: c2, z: zAt(l, 4.5) }];
  const tankR = (t: { x: number }): Rect => vr(l, t.x - 1.3, t.x + 1.3, 4.5 - 1.35, 4.5 + 1.35);
  const flareR = vr(l, flare.x - 0.95, flare.x + 0.95, 4.5 - 0.95, 4.5 + 0.95);
  return {
    tanks,
    flare,
    rects: [...tanks.map(tankR), flareR],
    solids: [
      ...tanks.map((t) => ({ what: 'gas sphere', r: tankR(t), h: 3.9 })),
      { what: 'flare stack', r: flareR, h: 6.8 },
    ],
  };
}

const DECK_H = 0.8;

interface Plan8 extends Plan {
  deck: Rect;
  v0: number;
  v1: number;
  steps: { x: number; w: number };
  kiosk: { x: number; v: number };
  dish: { x: number; v: number };
}

function plan8(l: RegionLayout): Plan8 {
  const F = yardSignatureFree(l);
  const x0 = minXFor(l, DECK_H + 0.95);
  const x1 = F.maxX - 0.3;
  const v0 = 2.9;
  const v1 = 5.4;
  const deck = vr(l, x0, x1, v0, v1);
  const steps = { x: (x0 + x1) / 2 - 0.8, w: 2.4 };
  const kiosk = { x: x0 + 1.9, v: 4.1 };
  const dish = { x: x1 - 2.0, v: 4.15 };
  const stepsR = vr(l, steps.x - steps.w / 2, steps.x + steps.w / 2, v1, v1 + 0.9);
  return {
    deck,
    v0,
    v1,
    steps,
    kiosk,
    dish,
    rects: [deck, stepsR],
    solids: [
      { what: 'showroom deck', r: deck, h: DECK_H + 0.95 },
      { what: 'deck steps', r: stepsR, h: 0.6 },
      { what: 'kiosk', r: vr(l, kiosk.x - 0.75, kiosk.x + 0.75, kiosk.v - 0.45, kiosk.v + 0.45), h: DECK_H + 1.3 },
      { what: 'satellite dish', r: vr(l, dish.x - 1.4, dish.x + 1.4, dish.v - 1.2, dish.v + 1.2), h: 5.2 },
    ],
  };
}

function plan(l: RegionLayout): Plan | null {
  return l.n === 6 ? plan6(l) : l.n === 7 ? plan7(l) : l.n === 8 ? plan8(l) : null;
}

/** The signature's footprints (colliders and keep-outs); [] for the other eras. */
export function yardSignatureRects(l: RegionLayout): Rect[] {
  return plan(l)?.rects ?? [];
}

/** Its tall parts with their heights (tests: nothing hides a pad, a counter or Jack from the camera). */
export function yardSignatureSolids(l: RegionLayout): GroundSolid[] {
  return plan(l)?.solids ?? [];
}

// ---------------------------------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------------------------------

/** A closed band of picket-style fence round a rect: posts at the corners and every ~1 m, two rails, a snow-capped top. */
function fence(k: Kit, r: Rect, post: number, rail: number, h: number): void {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  for (const y of [h * 0.45, h]) {
    k.box(w, 0.05, 0.05, rail, cx, y - 0.05, r.minZ).box(w, 0.05, 0.05, rail, cx, y - 0.05, r.maxZ);
    k.box(0.05, 0.05, d, rail, r.minX, y - 0.05, cz).box(0.05, 0.05, d, rail, r.maxX, y - 0.05, cz);
  }
  k.cap(w, 0.09, cx, h, r.minZ).cap(w, 0.09, cx, h, r.maxZ).cap(0.09, d, r.minX, h, cz).cap(0.09, d, r.maxX, h, cz);
  const nx = Math.max(1, Math.round(w / 1.0));
  const nz = Math.max(1, Math.round(d / 1.0));
  for (let i = 0; i <= nx; i++) for (const z of [r.minZ, r.maxZ]) k.cyl(0.045, h + 0.04, post, r.minX + (w * i) / nx, 0, z, 0.055, 6);
  for (let i = 1; i < nz; i++) for (const x of [r.minX, r.maxX]) k.cyl(0.045, h + 0.04, post, x, 0, r.minZ + (d * i) / nz, 0.055, 6);
}

// ---------------------------------------------------------------------------------------------------------------------
// era 6: the power house and the insulator pad
// ---------------------------------------------------------------------------------------------------------------------

const T6 = MACHINE_TONES[6];
const P6 = palette(6);
const COPPER6 = mixHex(T6.accent, T6.crimson, 0.3);
const COPPER6_L = mixHex(T6.accent, T6.cream, 0.28);
const COPPER6_D = mixHex(T6.accent, T6.body, 0.42);
const PATINA6 = mixHex(T6.bodyL, T6.cream, 0.32);
const CREAM6 = T6.cream;
const CREAM6_D = T6.creamD;
const TEAL6 = T6.body;
const TEAL6_L = T6.bodyL;
const MINT6 = P6.glow;
/** The lightning bolt glows honey: the one warm spark on the teal. */
const BOLT = T6.honey;

function insulator(k: Kit, g: Kit, x: number, z: number, h: number): void {
  k.box(0.62, 0.16, 0.62, CREAM6_D, x, 0, z).cap(0.62, 0.62, x, 0.16, z);
  k.cyl(0.2, 0.46, TEAL6, x, 0.16, z, 0.27, 10);
  k.cyl(0.11, h - 0.9, CREAM6, x, 0.62, z, 0.12, 8);
  const n = Math.floor((h - 1.3) / 0.27);
  for (let i = 0; i < n; i++) {
    const r = 0.4 - (0.2 * i) / Math.max(1, n - 1);
    const y = 0.86 + i * 0.27;
    k.cyl(r * 0.62, 0.1, i % 2 ? CREAM6 : CREAM6_D, x, y, z, r, 12);
  }
  k.cyl(0.07, 0.07, SNOW, x, 0.86 + (n - 1) * 0.27 + 0.1, z, 0.16, 8);
  k.cyl(0.16, 0.18, COPPER6, x, h - 0.34, z, 0.2, 8).ball(0.12, COPPER6_L, x, h - 0.14, z, 8);
  g.ball(0.15, MINT6, x, h + 0.02, z, 10);
}

function powerHouse(kit: GroundKit, l: RegionLayout, p: Plan6, rng: Rng): void {
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  const f = new Kit(kit.floor);
  const s = l.inward;
  const { x: cx, z: cz } = p.hall;
  const fz = cz + s * 1.35; // the front wall (the side facing the walkers)
  const ex = cx + 2.1; // the east wall
  // plinth, walls, teal frieze, verdigris roof with snow and a low dome
  k.box(4.5, 0.18, 3.0, CREAM6_D, cx, 0, cz);
  k.box(4.2, 2.4, 2.7, CREAM6, cx, 0.18, cz);
  k.box(4.26, 0.16, 2.76, TEAL6, cx, 2.42, cz);
  k.box(4.5, 0.12, 3.0, PATINA6, cx, 2.58, cz).cap(4.5, 3.0, cx, 2.7, cz);
  k.ball(1.05, PATINA6, cx, 2.7, cz, 14, 0.62);
  k.lump(0.5, SNOW, cx + rng.range(-0.05, 0.05), 3.22, cz, 1.1, 0.34, 1.0).ball(0.08, COPPER6_L, cx, 3.38, cz, 6);
  // stepped deco facade: fins of three heights either side of a centre pylon, copper-capped and snow-topped
  const fin = (x: number, w: number, top: number, color: number): void => {
    k.box(w, top - 0.18, 0.2, color, x, 0.18, fz + s * 0.08);
    k.box(w + 0.05, 0.06, 0.24, COPPER6_L, x, top, fz + s * 0.08).cap(w + 0.05, 0.24, x, top + 0.06, fz + s * 0.08);
  };
  fin(cx, 1.3, 3.3, TEAL6);
  for (const sx of [-1, 1]) {
    fin(cx + sx * 0.76 + sx * 0.05, 0.16, 3.0, TEAL6_L);
    fin(cx + sx * 1.38, 0.16, 2.8, TEAL6);
    fin(cx + sx * 2.02, 0.16, 2.6, TEAL6_L);
  }
  // tall lit windows between the fins (glow), copper sills
  for (const sx of [-1, 1]) {
    for (const o of [1.07, 1.7]) {
      g.box(0.34, 1.7, 0.05, MINT6, cx + sx * o, 0.55, fz + s * 0.03);
      k.box(0.44, 0.06, 0.1, COPPER6, cx + sx * o, 0.5, fz + s * 0.06);
    }
  }
  // the door and the bolt sign on the centre pylon
  k.box(0.7, 1.2, 0.08, COPPER6_D, cx, 0.18, fz + s * 0.2).box(0.56, 0.5, 0.04, CREAM6_D, cx, 0.78, fz + s * 0.24);
  g.box(0.5, 0.4, 0.04, MINT6, cx, 0.82, fz + s * 0.27);
  k.box(1.0, 1.5, 0.06, CREAM6, cx, 1.58, fz + s * 0.2).box(1.06, 0.07, 0.08, COPPER6, cx, 3.1, fz + s * 0.2).box(1.06, 0.07, 0.08, COPPER6, cx, 1.52, fz + s * 0.2);
  const bz = fz + s * 0.27;
  const bolt: [number, number, number][] = [[cx + 0.2, 3.0, bz], [cx - 0.12, 2.42, bz], [cx + 0.14, 2.36, bz], [cx - 0.2, 1.72, bz]];
  for (let i = 0; i + 1 < bolt.length; i++) g.beam(bolt[i]!, bolt[i + 1]!, 0.1, BOLT);
  g.ball(0.07, BOLT, cx - 0.2, 1.7, bz, 6);
  // the east wall: two tall windows and a copper cable duct; a roof bracket takes the lead-in to the insulators
  for (const dz of [-0.62, 0.62]) {
    g.box(0.05, 1.5, 0.36, MINT6, ex + 0.03, 0.62, cz + dz);
    k.box(0.1, 0.06, 0.46, COPPER6, ex + 0.03, 0.56, cz + dz);
  }
  k.cyl(0.05, 0.55, COPPER6_D, cx + 1.85, 2.72, cz, 0.06, 6).cyl(0.14, 0.05, CREAM6, cx + 1.85, 3.08, cz, 0.14, 8).ball(0.08, COPPER6, cx + 1.85, 3.2, cz, 6);
  // the pad: pale floor with a copper-and-mint edge, a low fence, then the three ceramic stacks and their wires
  const P = p.pad;
  const pw = P.maxX - P.minX;
  const pd = P.maxZ - P.minZ;
  const pcx = (P.minX + P.maxX) / 2;
  const pcz = (P.minZ + P.maxZ) / 2;
  f.tile(pw + 0.1, pd + 0.1, COPPER6_D, pcx, PAD_Y, pcz).tile(pw - 0.06, pd - 0.06, mixHex(CREAM6_D, SNOW, 0.35), pcx, PAD_Y + 0.004, pcz);
  f.tile(pw - 0.5, pd - 0.5, mixHex(P6.floor.processing, CREAM6, 0.3), pcx, PAD_Y + 0.008, pcz);
  fence(k, { minX: P.minX + 0.04, maxX: P.maxX - 0.04, minZ: P.minZ + 0.04, maxZ: P.maxZ - 0.04 }, CREAM6, COPPER6, 0.62);
  k.box(0.34, 0.26, 0.04, BOLT, P.minX + 0.5, 0.3, s > 0 ? P.maxZ + 0.03 : P.minZ - 0.03); // a little warning plate on the fence
  for (const st of p.stacks) insulator(k, g, st.x, st.z, st.h);
  const top = (i: number): [number, number, number] => [p.stacks[i]!.x, p.stacks[i]!.h - 0.1, p.stacks[i]!.z];
  k.cable([cx + 1.85, 3.2, cz], top(s > 0 ? 0 : 2), 0.4, 0.04, COPPER6_D, 8);
  k.cable(top(0), top(1), 0.35, 0.04, COPPER6_D, 6).cable(top(1), top(2), 0.35, 0.04, COPPER6_D, 6);
  // soft mint halos at the stack tops and the bolt (night)
  for (const st of p.stacks) kit.lamps.push({ x: st.x, y: st.h + 0.02, z: st.z, size: 1.3, pool: 2.2 });
  kit.lamps.push({ x: cx, y: 2.4, z: bz, size: 2.0, pool: 3.4 });
}

// ---------------------------------------------------------------------------------------------------------------------
// era 7: the gas tank farm and its flare
// ---------------------------------------------------------------------------------------------------------------------

const T7 = MACHINE_TONES[7];
const P7 = palette(7);
const HONEY7 = T7.body;
const HONEY7_L = T7.bodyL;
const HONEY7_D = T7.bodyD;
const RED7 = T7.accent;
const CREAM7 = T7.cream;
const CONCRETE7 = T7.concrete;
const STEEL7 = mixHex(T7.steel, CREAM7, 0.2);
const STEEL7_D = T7.steel;
const PEACH7 = P7.light;
const TANK7 = mixHex(CREAM7, HONEY7_L, 0.35);
const FLARE_BASE = 0.22;
const FLARE_TOP = 5.9;

function sphereTank(k: Kit, x: number, z: number, s: number): void {
  // leg ring: a concrete foot, six slanted legs, a bracing ring
  k.cyl(1.32, 0.14, CONCRETE7, x, 0, z, 1.38, 16).cap(2.7, 2.7, x, 0.14, z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    k.beam([x + Math.cos(a) * 1.18, 0.14, z + Math.sin(a) * 1.18], [x + Math.cos(a) * 0.95, 1.58, z + Math.sin(a) * 0.95], 0.1, STEEL7_D);
  }
  k.ring(1.06, 0.035, STEEL7, x, 0.78, z, 18);
  // the sphere: cream-honey, a red equator band, a snow crown, a manhole and a vent
  k.ball(TANK_R, TANK7, x, TANK_Y, z, 18);
  k.ring(TANK_R + 0.01, 0.06, RED7, x, TANK_Y, z, 24).ring(TANK_R - 0.5, 0.045, RED7, x, TANK_Y + 0.9, z, 18).ring(TANK_R - 0.5, 0.045, RED7, x, TANK_Y - 0.9, z, 18);
  k.lump(0.8, SNOW, x, 3.28, z, 1, 0.3, 1);
  k.cyl(0.26, 0.14, STEEL7, x, 3.36, z, 0.3, 10).cyl(0.04, 0.4, STEEL7_D, x + 0.4, 3.3, z - 0.1, 0.04, 6);
  // the ladder up the front to the equator
  const lz = z + s * 1.28;
  k.box(0.04, 2.15, 0.04, STEEL7, x - 0.15, 0.14, lz).box(0.04, 2.15, 0.04, STEEL7, x + 0.15, 0.14, lz);
  for (let i = 0; i < 8; i++) k.box(0.34, 0.035, 0.035, STEEL7, x, 0.4 + i * 0.27, lz);
  k.box(0.5, 0.06, 0.4, STEEL7_D, x, 2.26, z + s * 1.08);
  // a small red valve box on the leg ring
  k.box(0.36, 0.3, 0.2, RED7, x - 0.7, 0.14, z + s * 1.0).cap(0.36, 0.2, x - 0.7, 0.44, z + s * 1.0);
}

function pipe(k: Kit, a: [number, number, number], b: [number, number, number], r: number): void {
  k.beam(a, b, r * 2, RED7);
  for (const t of [0.05, 0.95]) k.cyl(r * 1.45, r * 0.9, CREAM7, a[0] + (b[0] - a[0]) * t - r * 0.45, a[1] - r * 1.45, a[2], r * 1.45, 8);
}

function flareStack(kit: GroundKit, l: RegionLayout, p: Plan7): void {
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  const f = new Kit(kit.floor);
  const s = l.inward;
  const { x, z } = p.flare;
  // the concrete apron under the whole farm, honey-edged, with a hazard-striped front
  const [t1, t2] = p.tanks as [{ x: number; z: number }, { x: number; z: number }];
  const ax0 = t1.x - 1.45;
  const ax1 = x + 1.05;
  const az0 = zAt(l, 3.0);
  const az1 = zAt(l, 6.0);
  const acx = (ax0 + ax1) / 2;
  const acz = (az0 + az1) / 2;
  f.tile(ax1 - ax0 + 0.12, Math.abs(az1 - az0) + 0.12, HONEY7_D, acx, PAD_Y, acz).tile(ax1 - ax0, Math.abs(az1 - az0), mixHex(CONCRETE7, SNOW, 0.32), acx, PAD_Y + 0.004, acz);
  for (let i = 0; ax0 + 0.25 + i * 0.5 < ax1 - 0.3; i++) f.tile(0.26, 0.1, i % 2 ? CREAM7 : RED7, ax0 + 0.3 + i * 0.5, PAD_Y + 0.008, az1 - s * 0.1);
  sphereTank(k, t1.x, t1.z, s);
  sphereTank(k, t2.x, t2.z, s);
  // pipework: a short equator pipe joining the spheres, a bottom manifold with stubs, a valve wheel, the line to the flare
  pipe(k, [t1.x + TANK_R - 0.05, TANK_Y, t1.z], [t2.x - TANK_R + 0.05, TANK_Y, t2.z], 0.07);
  for (const t of p.tanks) k.cyl(0.07, 0.5, RED7, t.x, 0.5, t.z, 0.07, 8);
  pipe(k, [t1.x, 0.5, t1.z], [t2.x, 0.5, t2.z], 0.09);
  pipe(k, [t2.x, 0.5, t2.z], [x - 0.25, 0.5, z], 0.09);
  k.cyl(0.07, 0.4, RED7, x, 0.22, z, 0.07, 8);
  k.ring(0.16, 0.025, HONEY7, (t1.x + t2.x) / 2, 0.75, t1.z, 10).cyl(0.025, 0.25, HONEY7, (t1.x + t2.x) / 2, 0.5, t1.z, 0.025, 6);
  k.box(0.24, 0.3, 0.24, STEEL7_D, (t2.x + x) / 2 + 0.4, 0, t2.z).box(0.24, 0.3, 0.24, STEEL7_D, (t1.x + t2.x) / 2 - 0.9, 0, t2.z);
  // the flare: concrete foot, cream-and-red banded stack, a ladder, a platform with a rail, the head, guy wires
  k.cyl(0.6, FLARE_BASE, CONCRETE7, x, 0, z, 0.66, 12).cap(1.2, 1.2, x, FLARE_BASE, z);
  const segs = 5;
  const sh = (FLARE_TOP - FLARE_BASE - 0.3) / segs;
  for (let i = 0; i < segs; i++) k.cyl(0.15, sh, i % 2 ? RED7 : CREAM7, x, FLARE_BASE + i * sh, z, 0.17, 10);
  const lz = z + s * 0.2;
  k.box(0.035, 4.2, 0.035, STEEL7, x - 0.08, FLARE_BASE, lz).box(0.035, 4.2, 0.035, STEEL7, x + 0.08, FLARE_BASE, lz);
  for (let i = 0; i < 13; i++) k.box(0.19, 0.03, 0.03, STEEL7, x, 0.5 + i * 0.3, lz);
  k.cyl(0.4, 0.06, STEEL7_D, x, 4.55, z, 0.4, 12).ring(0.4, 0.028, STEEL7, x, 5.05, z, 14).cap(0.7, 0.7, x, 4.61, z);
  for (let i = 0; i < 4; i++) k.cyl(0.015, 0.5, STEEL7, x + Math.cos(i * 1.57 + 0.4) * 0.4, 4.58, z + Math.sin(i * 1.57 + 0.4) * 0.4, 0.015, 4);
  k.cyl(0.27, 0.28, CREAM7, x, FLARE_TOP - 0.3, z, 0.16, 10).cyl(0.29, 0.05, STEEL7, x, FLARE_TOP - 0.02, z, 0.29, 10);
  for (let i = 0; i < 3; i++) {
    const a = 0.5 + (i * Math.PI * 2) / 3;
    k.beam([x, 4.6, z], [x + Math.cos(a) * 0.85, 0.1, z + Math.sin(a) * 0.85], 0.03, STEEL7_D);
    k.cyl(0.06, 0.12, STEEL7_D, x + Math.cos(a) * 0.85, 0, z + Math.sin(a) * 0.85, 0.07, 6);
  }
  // the flame glows peach and a small halo warms the snow around the farm at night
  kit.extra.push(flame(x, FLARE_TOP + 0.02, z));
  kit.lamps.push({ x, y: FLARE_TOP + 0.45, z, size: 2.6, pool: 5.2 });
  g.ball(0.1, PEACH7, x, FLARE_TOP + 0.01, z, 6);
  g.box(0.16, 0.05, 0.05, RED7, x + 0.7, 0.62, t2.z).box(0.16, 0.05, 0.05, RED7, (t1.x + t2.x) / 2, 0.8, t1.z);
}

/** A small flame: two nested soft cones that sway gently (one mesh; still with Reduce motion / calmer effects). */
function flame(x: number, y: number, z: number): THREE.Mesh {
  const k = new Kit();
  k.cone(0.3, 0.85, mixHex(PEACH7, HONEY7_L, 0.3), 0, 0, 0, 8).cone(0.17, 0.55, mixHex(PEACH7, CREAM7, 0.55), 0, 0.04, 0, 8);
  k.ball(0.24, PEACH7, 0, 0.08, 0, 8, 0.6);
  const mesh = new THREE.Mesh(k.geometry(), glowMaterial(0xffffff, { vertexColors: true, boost: 2.4 }));
  mesh.name = 'era7:gasFlare';
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const t0 = performance.now() / 1000;
  mesh.onBeforeRender = (): void => {
    if (steadyHighlights()) {
      mesh.scale.set(1, 1, 1);
      mesh.rotation.set(0, 0, 0);
    } else {
      const t = performance.now() / 1000 - t0;
      // a slow sway and breathe, a little livelier than a pilot light but still well under 1 Hz of change
      const sy = 1 + 0.1 * Math.sin(t * 2.6) + 0.05 * Math.sin(t * 4.1 + 1.3);
      mesh.scale.set(1 + 0.05 * Math.sin(t * 2.1), sy * (0.85 + 0.15 * glowScale()), 1 + 0.05 * Math.sin(t * 2.3 + 0.6));
      mesh.rotation.set(0.06 * Math.sin(t * 1.4), 0, 0.08 * Math.sin(t * 1.2 + 0.4));
    }
    mesh.updateMatrixWorld();
  };
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------------
// era 8: the raised showroom deck, the dish and the kiosk
// ---------------------------------------------------------------------------------------------------------------------

const P8 = palette(8);
const TEAL8 = P8.accent;
const TEAL8_D = mixHex(P8.accent, P8.trim, 0.25);
const TEAL8_L = mixHex(P8.accent, SNOW, 0.35);
const CREAM8 = mixHex(P8.body, SNOW, 0.25);
const CREAM8_D = mixHex(P8.body, P8.ground, 0.35);
const BEIGE8 = mixHex(P8.body, 0xd8c7a4, 0.45);
const GLASS8 = mixHex(P8.accent, SNOW, 0.72);
const WHITE8 = mixHex(SNOW, P8.ground, 0.12);
const MINT8 = P8.glow;
const TEAL_GLOW8 = mixHex(P8.accent, P8.glow, 0.55);

/** The dish bowl: a paraboloid shell (depth 0.4 at the rim) as a solid of revolution, axis +Y, pivot at the back. */
const DISH_R = 1.2;
const DISH_K = 0.4 / (DISH_R * DISH_R);
let dishShell: THREE.BufferGeometry | null = null;
let dishInner: THREE.BufferGeometry | null = null;

function dishGeometries(): { shell: THREE.BufferGeometry; inner: THREE.BufferGeometry } {
  if (!dishShell || !dishInner) {
    const t = 0.07; // shell thickness
    const outer: THREE.Vector2[] = [];
    const inn: THREE.Vector2[] = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const r = (DISH_R * i) / N;
      outer.push(new THREE.Vector2(r, DISH_K * r * r));
      inn.push(new THREE.Vector2(r, DISH_K * r * r + t));
    }
    // outside back to the rim, up, then the inside back to the axis (a closed profile: a solid shell)
    dishShell = new THREE.LatheGeometry([...outer, ...inn.slice().reverse()], 22);
    // the lining: the inside surface alone, a hair above it, drawn from the rim in so its faces look up
    dishInner = new THREE.LatheGeometry(inn.slice(0, -1).map((p) => new THREE.Vector2(p.x * 0.97, p.y + 0.012)).reverse(), 22);
    // faces must wind outward whichever way the profile ran: flip a geometry whose first face points the wrong way
    for (const [gm, up] of [[dishShell, false], [dishInner, true]] as const) fixWinding(gm, up);
  }
  return { shell: dishShell, inner: dishInner };
}

/** Flip a lathe whose winding came out inside-out. `up`: the lining, whose faces should look toward +Y. */
function fixWinding(gm: THREE.BufferGeometry, up: boolean): void {
  const pos = gm.getAttribute('position') as THREE.BufferAttribute;
  const idx = gm.index!;
  // signed volume of a closed mesh is positive when the faces wind outward; the open lining is judged by its up-facing area
  let score = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    if (up) {
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      score += n.y;
    } else {
      score += a.dot(b.clone().cross(c)) / 6;
    }
  }
  if (score < 0) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]!;
      arr[i + 1] = arr[i + 2]!;
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
}

const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _vec = new THREE.Vector3();

function satelliteDish(k: Kit, g: Kit, x: number, z: number, s: number): void {
  const base = DECK_H;
  // mast on a gold-ringed plinth, a collar, a neck up to the dish's back
  k.cyl(0.46, 0.16, CREAM8_D, x, base, z, 0.52, 12).cap(1.0, 1.0, x, base + 0.16, z);
  k.cyl(0.38, 0.05, GOLD, x, base + 0.16, z, 0.4, 12);
  const pivotY = base + 3.5;
  k.cyl(0.1, pivotY - base - 0.4, WHITE8, x, base + 0.2, z, 0.14, 10);
  k.cyl(0.2, 0.18, TEAL8_D, x, base + 0.72, z, 0.2, 10);
  k.ball(0.2, WHITE8, x, pivotY - 0.2, z, 10);
  // dish: tilted up toward the camera side (+X/+Z) so the bowl reads from the iso view
  _quat.setFromEuler(new THREE.Euler(0.9 * s, 0, -0.665));
  const pivot = new THREE.Vector3(x, pivotY, z);
  const { shell, inner } = dishGeometries();
  _mat.compose(pivot, _quat, _one);
  k.b.addMatrix(shell, WHITE8, _mat);
  k.b.addMatrix(inner, GLASS8, _mat);
  // rim ring in teal
  const q2 = _quat.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
  _vec.set(0, DISH_K * DISH_R * DISH_R + 0.035, 0).applyQuaternion(_quat).add(pivot);
  k.b.addMatrix(geo.torus(DISH_R, 0.04, 6, 24), TEAL8, _mat.compose(_vec, q2, _one));
  // three struts from the rim to the feed horn, a gold horn and a mint lamp at the focus
  const focus = new THREE.Vector3(0, 0.95, 0).applyQuaternion(_quat).add(pivot);
  for (let i = 0; i < 3; i++) {
    const a = 0.4 + (i * Math.PI * 2) / 3;
    const rim = new THREE.Vector3(Math.cos(a) * DISH_R * 0.97, DISH_K * DISH_R * DISH_R + 0.05, Math.sin(a) * DISH_R * 0.97).applyQuaternion(_quat).add(pivot);
    k.beam([rim.x, rim.y, rim.z], [focus.x, focus.y, focus.z], 0.04, WHITE8);
  }
  k.ball(0.11, GOLD, focus.x, focus.y, focus.z, 8);
  g.ball(0.07, MINT8, focus.x, focus.y + 0.1, focus.z, 6);
}

function homeComputer(k: Kit, g: Kit, x: number, z: number, s: number): void {
  const y = DECK_H;
  // a retro desk: teal-and-gold striped front, cream top, two legs
  k.box(1.4, 0.07, 0.8, CREAM8, x, y + 0.62, z).cap(1.4, 0.8, x, y + 0.69, z);
  for (const sx of [-1, 1]) k.box(0.1, 0.62, 0.7, TEAL8_D, x + sx * 0.6, y, z);
  k.box(1.3, 0.14, 0.04, TEAL8, x, y + 0.44, z + s * 0.3).box(1.3, 0.04, 0.045, GOLD, x, y + 0.5, z + s * 0.3).box(1.3, 0.04, 0.045, TEAL8_L, x, y + 0.38, z + s * 0.3);
  // the computer: a beige base unit with a keyboard, a CRT with a glowing mint screen, a floppy slot
  const top = y + 0.69;
  k.box(0.84, 0.14, 0.5, BEIGE8, x, top, z - s * 0.1);
  k.box(0.6, 0.04, 0.2, CREAM8_D, x, top, z + s * 0.2);
  for (let i = 0; i < 4; i++) k.box(0.1, 0.02, 0.1, BEIGE8, x - 0.2 + i * 0.13, top + 0.04, z + s * 0.2);
  k.box(0.6, 0.46, 0.46, BEIGE8, x, top + 0.14, z - s * 0.12);
  k.box(0.4, 0.32, 0.3, CREAM8_D, x, top + 0.2, z - s * 0.44);
  k.box(0.5, 0.38, 0.04, TEAL8_D, x, top + 0.18, z + s * 0.12);
  g.box(0.42, 0.3, 0.03, MINT8, x, top + 0.22, z + s * 0.14);
  k.box(0.2, 0.02, 0.04, TEAL8_D, x + 0.2, top + 0.06, z + s * 0.16);
  k.cap(0.6, 0.46, x, top + 0.6, z - s * 0.12);
}

function deckBalustrade(k: Kit, g: Kit, xa: number, xb: number, z: number, alongX: boolean): void {
  // posts every ~1.4 m, a pale glass panel between them, a teal rail with a glowing strip on top
  const len = Math.abs(xb - xa);
  if (len < 0.3) return;
  const n = Math.max(1, Math.round(len / 1.4));
  const lo = Math.min(xa, xb);
  const y = DECK_H;
  const mid = lo + len / 2;
  if (alongX) {
    k.box(len, 0.05, 0.08, TEAL8_L, mid, y + 0.9, z).box(len, 0.04, 0.05, TEAL8, mid, y + 0.1, z);
    g.box(len, 0.025, 0.025, TEAL_GLOW8, mid, y + 0.955, z);
  } else {
    k.box(0.08, 0.05, len, TEAL8_L, z, y + 0.9, mid).box(0.05, 0.04, len, TEAL8, z, y + 0.1, mid);
    g.box(0.025, 0.025, len, TEAL_GLOW8, z, y + 0.955, mid);
  }
  for (let i = 0; i <= n; i++) {
    const t = lo + (len * i) / n;
    if (alongX) k.box(0.07, 0.9, 0.07, GOLD, t, y, z);
    else k.box(0.07, 0.9, 0.07, GOLD, z, y, t);
    if (i < n) {
      const m = lo + (len * (i + 0.5)) / n;
      const pl = len / n - 0.12;
      if (alongX) k.box(pl, 0.7, 0.025, GLASS8, m, y + 0.15, z);
      else k.box(0.025, 0.7, pl, GLASS8, z, y + 0.15, m);
    }
  }
}

function showroomDeck(kit: GroundKit, l: RegionLayout, p: Plan8, rng: Rng): void {
  const k = new Kit(kit.solid);
  const g = new Kit(kit.glow);
  const s = l.inward;
  const { minX: x0, maxX: x1 } = p.deck;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const zb = zAt(l, p.v0); // back edge
  const zf = zAt(l, p.v1); // front edge (toward the region)
  const cz = (zb + zf) / 2;
  const d = Math.abs(zf - zb);
  // the body: cream fascia with a gold stripe, a teal under-glow line, a terrazzo top of two-tone squares with a gold edge
  k.box(w, DECK_H - 0.18, d, CREAM8, cx, 0, cz);
  k.box(w + 0.1, 0.18, d + 0.1, CREAM8_D, cx, DECK_H - 0.18, cz);
  k.box(w + 0.02, 0.05, 0.03, GOLD, cx, 0.4, zf + s * 0.02).box(0.03, 0.05, d + 0.02, GOLD, x1 + 0.02, 0.4, cz);
  g.box(w - 0.2, 0.03, 0.03, TEAL_GLOW8, cx, 0.16, zf + s * 0.025).box(0.03, 0.03, d - 0.2, TEAL_GLOW8, x1 + 0.025, 0.16, cz);
  const ty = DECK_H + 0.002;
  for (let i = 0, x = x0 + 0.35; x < x1 - 0.3; i++, x += 0.7) {
    for (let j = 0, z = zb + s * 0.35; j < Math.round(d / 0.7); j++, z += s * 0.7) k.tile(0.64, 0.64, (i + j) & 1 ? mixHex(P8.floor.processing, SNOW, 0.45) : mixHex(P8.floor.yard, SNOW, 0.5), x, ty, z);
  }
  k.box(w, 0.02, 0.06, GOLD, cx, DECK_H, zf - s * 0.03).box(0.06, 0.02, d, GOLD, x1 - 0.03, DECK_H, cz);
  // snow banked on the back edge
  for (let x = x0 + 1; x < x1 - 0.8; x += rng.range(2.2, 3.2)) k.lump(0.34, SNOW, x, DECK_H + 0.04, zb + s * 0.15, 1.7, 0.35, 0.7);
  // steps down toward the region: three risers, snow on the treads, a teal glow line at the foot
  const sx = p.steps.x;
  const sw = p.steps.w;
  for (let i = 0; i < 2; i++) {
    const h = DECK_H * ((2 - i) / 3);
    k.box(sw, h, 0.45, i ? CREAM8 : CREAM8_D, sx, 0, zf + s * (0.225 + i * 0.45)).cap(sw - 0.1, 0.34, sx, h, zf + s * (0.225 + i * 0.45));
    g.box(sw - 0.2, 0.025, 0.025, TEAL_GLOW8, sx, h - 0.06, zf + s * (0.45 + i * 0.45 + 0.012));
  }
  // the balustrade: the front either side of the steps, the east end, a short return on the west end
  const gapA = sx - sw / 2 - 0.1;
  const gapB = sx + sw / 2 + 0.1;
  deckBalustrade(k, g, x0 + 0.1, gapA, zf - s * 0.12, true);
  deckBalustrade(k, g, gapB, x1 - 0.1, zf - s * 0.12, true);
  deckBalustrade(k, g, zb + s * 0.2, zf - s * 0.12, x1 - 0.12, false);
  deckBalustrade(k, g, zb + s * 0.2, zf - s * 0.12, x0 + 0.12, false);
  // the kiosk and the dish
  homeComputer(k, g, p.kiosk.x, zAt(l, p.kiosk.v), s);
  satelliteDish(k, g, p.dish.x, zAt(l, p.dish.v), s);
  // night: screen mint, dish feed and the two ends of the glowing rail
  kit.lamps.push({ x: p.kiosk.x, y: DECK_H + 1.15, z: zAt(l, p.kiosk.v) + s * 0.3, size: 1.4, pool: 2.6 });
  kit.lamps.push({ x: p.dish.x + 0.7, y: DECK_H + 4.3, z: zAt(l, p.dish.v) + s * 0.6, size: 1.5, pool: 2.4 });
  kit.lamps.push({ x: x0 + 0.1, y: DECK_H + 1.0, z: zf - s * 0.12, size: 1.2, pool: 2.4 });
  kit.lamps.push({ x: x1 - 0.12, y: DECK_H + 1.0, z: zf - s * 0.12, size: 1.2, pool: 2.4 });
}

// ---------------------------------------------------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------------------------------------------------

/** Build era n's yard signature into the kit (eras 6-8; a no-op for the other eras). */
export function buildYardSignature(k: GroundKit, l: RegionLayout, rng: Rng): void {
  if (l.n === 6) powerHouse(k, l, plan6(l), rng);
  else if (l.n === 7) flareStack(k, l, plan7(l));
  else if (l.n === 8) showroomDeck(k, l, plan8(l), rng);
}

// ---------------------------------------------------------------------------------------------------------------------
// the region gate: an era-styled arch (eras 6-8) instead of the plain black posts and crossbeam
// ---------------------------------------------------------------------------------------------------------------------

/** Clear height under the arch inside the opening, metres (the opening itself stays the layout's 4 m wide). */
export const GATE_CLEAR = 2.6;

/**
 * Era 6 an art-deco copper-and-teal arch (stepped pylons, a crest with a glowing lightning-bolt roundel), era 7 a honey
 * pipe arch (pipe bends, red valve wheels, a small flame lamp on top), era 8 a white panel arch with a glowing teal
 * marquee and a little gold chip. Goes into the fence batch `fb` and the glow batch `gb` (no extra draw calls); the
 * posts stand at or outside the opening's edges and nothing hangs below GATE_CLEAR. Returns false for the other eras
 * (the caller then builds the plain gate).
 */
export function buildGateDressing(fb: Batch, gb: Batch, n: number, l: RegionLayout): boolean {
  if (n < 6 || n > 8) return false;
  const k = new Kit(fb);
  const g = new Kit(gb);
  const s = l.inward;
  const z = l.gate.z;
  const gx = l.gate.x;
  const a = gx - l.gate.width / 2; // opening edges
  const b = gx + l.gate.width / 2;
  const fz = z + s * 0.2; // the camera-facing (inward) side
  if (n === 6) {
    for (const [sx, edge] of [[-1, a], [1, b]] as const) {
      const c = edge + sx * 0.45;
      k.box(0.9, 1.5, 0.7, TEAL6, c, 0, z).box(0.98, 0.1, 0.78, COPPER6, c, 1.5, z);
      k.box(0.7, 1.15, 0.55, TEAL6_L, c, 1.6, z).box(0.78, 0.08, 0.63, COPPER6_L, c, 2.75, z);
      k.box(0.46, 0.65, 0.4, TEAL6, c, 2.83, z).box(0.54, 0.07, 0.48, COPPER6, c, 3.48, z).cap(0.54, 0.48, c, 3.55, z);
      k.ball(0.1, COPPER6_L, c, 3.7, z, 8);
      g.box(0.1, 2.2, 0.04, MINT6, c - sx * 0.05 + sx * 0.12, 0.3, fz + s * 0.12).box(0.08, 0.5, 0.04, MINT6, c, 2.9, z + s * 0.22);
    }
    // the lintel with a stepped crest and a roundel carrying the bolt
    const cx = gx;
    k.box(l.gate.width + 0.1, 0.34, 0.5, TEAL6, cx, GATE_CLEAR, z).box(l.gate.width + 0.16, 0.06, 0.56, COPPER6, cx, GATE_CLEAR + 0.34, z).box(l.gate.width + 0.16, 0.05, 0.56, COPPER6, cx, GATE_CLEAR - 0.04, z);
    k.box(2.0, 0.32, 0.42, CREAM6, cx, 2.99, z).box(1.2, 0.3, 0.36, TEAL6_L, cx, 3.31, z).box(1.26, 0.06, 0.4, COPPER6_L, cx, 3.61, z).cap(1.26, 0.4, cx, 3.67, z);
    k.cap(l.gate.width + 0.16, 0.56, cx, GATE_CLEAR + 0.4, z).cap(2.0, 0.42, cx, 3.31, z);
    k.lying('z', 0.46, 0.08, CREAM6, cx, 3.0, fz + s * 0.04, 14).lying('z', 0.5, 0.05, COPPER6, cx, 3.0, fz, 14);
    const bz = fz + s * 0.09;
    const bolt: [number, number, number][] = [[cx + 0.16, 3.36, bz], [cx - 0.1, 2.98, bz], [cx + 0.1, 2.94, bz], [cx - 0.16, 2.58, bz]];
    for (let i = 0; i + 1 < bolt.length; i++) g.beam(bolt[i]!, bolt[i + 1]!, 0.09, BOLT);
    // a row of mint bulbs along the lintel's front
    for (let i = 0; i < 7; i++) g.ball(0.06, MINT6, cx - 1.8 + i * 0.6, GATE_CLEAR + 0.17, fz + s * 0.12, 6);
    return true;
  }
  if (n === 7) {
    const PIPE = HONEY7;
    for (const [sx, edge] of [[-1, a], [1, b]] as const) {
      const c = edge + sx * 0.24;
      k.cyl(0.4, 0.14, CONCRETE7, c, 0, z, 0.44, 10).cap(0.8, 0.8, c, 0.14, z);
      k.cyl(0.2, 2.5, PIPE, c, 0.14, z, 0.22, 10);
      for (const y of [0.7, 1.7]) k.cyl(0.26, 0.1, RED7, c, y, z, 0.26, 10);
      k.cyl(0.28, 0.1, CREAM7, c, 2.55, z, 0.28, 10);
      k.ball(0.27, PIPE, c, 2.78, z, 10);
      // a red valve wheel on each leg, facing the camera
      k.cyl(0.04, 0.32, STEEL7_D, c, 1.1, fz + s * 0.12, 0.04, 6).put(geo.torus(0.2, 0.04, 6, 12), RED7, c, 1.28, fz + s * 0.28);
    }
    // two horizontal pipes across (the upper a size smaller), flanged joints, snow on top, a flame lamp
    const cx = gx;
    const len = l.gate.width + 0.5;
    k.lying('x', 0.19, len, PIPE, cx, 2.78, z, 10);
    for (const t of [-0.3, 0, 0.3]) k.cyl(0.24, 0.1, RED7, cx + t * l.gate.width, 2.62, z, 0.24, 10).lying('x', 0.24, 0.1, RED7, cx + t * l.gate.width, 2.78, z, 10);
    k.cap(len, 0.28, cx, 2.97, z);
    k.lying('x', 0.1, l.gate.width - 0.3, STEEL7, cx, 3.2, z, 8);
    for (const sx of [-1, 1]) k.beam([cx + sx * (l.gate.width / 2 - 0.15), 2.9, z], [cx + sx * 0.5, 3.2, z], 0.1, PIPE);
    k.cap(l.gate.width - 0.3, 0.2, cx, 3.3, z);
    k.cyl(0.09, 0.5, PIPE, cx, 3.25, z, 0.1, 8).cyl(0.17, 0.08, RED7, cx, 3.72, z, 0.12, 8);
    k.put(geo.torus(0.28, 0.04, 6, 14), RED7, cx, 3.2, fz + s * 0.05);
    g.cone(0.17, 0.5, mixHex(PEACH7, HONEY7_L, 0.3), cx, 3.8, z, 8).cone(0.1, 0.32, mixHex(PEACH7, CREAM7, 0.55), cx, 3.82, z, 8);
    return true;
  }
  // era 8: white panel arch, teal marquee screen, a gold chip on top
  for (const [sx, edge] of [[-1, a], [1, b]] as const) {
    const c = edge + sx * 0.3;
    k.box(0.6, 0.18, 0.6, CREAM8_D, c, 0, z);
    k.box(0.5, 2.7, 0.5, WHITE8, c, 0.18, z);
    k.box(0.54, 0.12, 0.54, TEAL8, c, 0.6, z).box(0.54, 0.12, 0.54, TEAL8, c, 1.9, z).box(0.56, 0.05, 0.56, GOLD, c, 1.2, z);
    k.box(0.6, 0.07, 0.6, TEAL8_D, c, 2.88, z).cap(0.6, 0.6, c, 2.95, z);
    g.box(0.08, 1.9, 0.04, TEAL_GLOW8, c, 0.7, fz + s * 0.07);
  }
  const cx = gx;
  const w = l.gate.width + 1.2;
  k.box(w, 0.74, 0.34, WHITE8, cx, GATE_CLEAR, z).box(w + 0.06, 0.07, 0.4, TEAL8, cx, GATE_CLEAR - 0.05, z).box(w + 0.06, 0.07, 0.4, TEAL8, cx, GATE_CLEAR + 0.72, z).cap(w + 0.06, 0.4, cx, GATE_CLEAR + 0.79, z);
  k.box(w - 0.4, 0.56, 0.05, TEAL8_D, cx, GATE_CLEAR + 0.09, fz + s * 0.02);
  g.box(w - 0.5, 0.46, 0.03, TEAL_GLOW8, cx, GATE_CLEAR + 0.14, fz + s * 0.06);
  // "pixel text" on the screen: a row of dark teal blocks of varied height, and a mint scan line
  for (let i = 0, x = cx - (w - 0.9) / 2; x < cx + (w - 0.9) / 2; i++, x += 0.2) k.box(0.12, 0.12 + ((i * 7) % 5) * 0.045, 0.02, TEAL8_D, x, GATE_CLEAR + 0.2, fz + s * 0.09);
  g.box(w - 0.5, 0.025, 0.02, MINT8, cx, GATE_CLEAR + 0.58, fz + s * 0.08);
  // the gold chip: a square die with pins on all four sides, set on the marquee
  const cy = GATE_CLEAR + 0.9;
  k.box(0.56, 0.12, 0.56, GOLD, cx, cy, z).box(0.34, 0.05, 0.34, mixHex(GOLD, SNOW, 0.45), cx, cy + 0.12, z);
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
    const o = -0.18 + i * 0.12;
    k.box(0.12, 0.04, 0.04, GOLD, cx + sd * 0.34, cy + 0.04, z + o).box(0.04, 0.04, 0.12, GOLD, cx + o, cy + 0.04, z + sd * 0.34);
  }
  g.box(0.1, 0.03, 0.1, MINT8, cx, cy + 0.175, z);
  return true;
}
