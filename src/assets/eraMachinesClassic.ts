/**
 * 0.9.8: the nine original (0.9.0) machines of eras 2-5, rebuilt as cosy toys in the 0.9.5 builder style
 * (assets/eraMachines2.ts): bevelled plinths, rounded shapes, fat snow caps, lanterns and glowing windows. Each one
 * reads as its era's resource loop and carries a crown that is recognisable at 40 px (DIRECTION silhouette language):
 *   2 Frontier (stone and clay):    quarry = timber treadwheel crane over a stepped quarry; kiln = beehive brick kiln
 *                                   with a fat chimney and a shaduf lifting bricks.
 *   3 Iron Age (rust ore):          ironMine = timber headframe with a spinning winding wheel; smelter = banded blast
 *                                   furnace glowing at the throat, a jib swinging ore baskets over it.
 *   4 Steam Age (coal and brass):   coalPit = red-and-brass steam shovel slewing over a striped coal seam;
 *                                   steamWorks = brick hall with twin stacks and a giant brass gear turning on its front.
 *   5 Industrial (pellets + coke):  deepMine = orange lattice headframe over a pellet ridge; cokeOven = oven battery with
 *                                   a charging car rolling along the top and a steaming quench tower; steelMill =
 *                                   sawtooth mill with a tilting converter pouring into a glowing ladle.
 * Colours come from render/palette.ts (MACHINE_SHADES for the materials, palette(era) for the lights).
 *
 * CONTRACT: the one of assets/eraMachines.ts (eras/Machine.ts uses these unchanged): origin at the floor centre, +Z
 * front, footprint ≤ 5.2 × 5.2 m and height ≤ 6 m with the animated part at any phase, exactly 3 meshes ('body',
 * 'glow' on the shared night-registered `eraGlowMaterial()`, 'pivot'), `animate(dt, working)` with no allocation per
 * frame, plus `vents` (stack tops that puff while working).
 */
import * as THREE from 'three';
import type { MachineId } from '../eras/data';
import { vcMat } from '../render/batch';
import { MACHINE_SHADES, palette } from '../render/palette';
import { SNOW, Kit, eraGlowMaterial, hcyl, lattice, seeded, wheel, type V3 } from './eraKit';
import type { MachineModel } from './eraMachines';
import { arch, boxC, cap, chimney, halfDisc, lantern, lumps, plinth, rb, tint } from './eraMachines2';

/** The machines this file builds (eras/data.ts ids), in era order. */
export const CLASSIC_MACHINE_IDS = ['quarry', 'kiln', 'ironMine', 'smelter', 'coalPit', 'steamWorks', 'deepMine', 'cokeOven', 'steelMill'] as const;
export type ClassicMachineId = (typeof CLASSIC_MACHINE_IDS)[number];

const S2 = MACHINE_SHADES[2];
const S3 = MACHINE_SHADES[3];
const S4 = MACHINE_SHADES[4];
const S5 = MACHINE_SHADES[5];

/** Lamp / window / fire tints (multiplied into the shared glow material by vertex colour). */
const G_FIRE = 0xff8a30;
const G_WARM = 0xffd070;
const G_MOLTEN = 0xffb03a;

/** Puff colours: warm wood smoke and clean steam. */
const SMOKE = 0xf2ece6;
const STEAM = 0xffffff;

// ---------------------------------------------------------------------------
// recipe framework
// ---------------------------------------------------------------------------

interface Parts {
  body: Kit;
  glow: Kit;
  anim: Kit;
}

/** The animated part: built around the origin of `anim`, placed at `at` (its rotation centre). */
interface AnimSpec {
  at: V3;
  /** spin = turn continuously; swing = bias + sin · amp radians; bob / slide = move by bias + sin · amp metres. */
  motion: 'spin' | 'swing' | 'bob' | 'slide';
  axis: 'x' | 'y' | 'z';
  /** Seconds per cycle while working. */
  period: number;
  amp: number;
  bias?: number;
  /** Stack tops that puff while working (model-local), and their colour. */
  vents?: V3[];
  ventColor?: number;
}

type Recipe = (p: Parts) => AnimSpec;

/** Gable-roofed little shed: walls, a darker base course, a snowy gable roof (ridge along X). Walls end at y + h. */
function shed(b: Kit, wall: number, roof: number, x: number, y: number, z: number, w: number, h: number, d: number, rise = 0.55): void {
  rb(b, wall, w, h, d, x, y, z, 0.08);
  rb(b, tint(wall, -0.2), w + 0.06, 0.18, d + 0.06, x, y, z, 0.04);
  b.gable(x, z, y + h, w, d, rise, roof, tint(roof, -0.12), wall, 0.16);
}

/** Sawtooth roof (era 5 crown): `n` teeth along Z over a w × d hall whose walls end at `y`; glazing faces −Z. */
function sawtooth(b: Kit, g: Kit, roof: number, x: number, y: number, z: number, w: number, d: number, n: number, h: number, glow: number): void {
  const step = d / n;
  for (let i = 0; i < n; i++) {
    const z0 = z - d / 2 + i * step;
    // the sloping roof plane rises from the front of the tooth (z0 + step) to the glazed back (z0)
    const ang = Math.atan2(h, step);
    const len = Math.hypot(h, step);
    b.add(cachedBox(w + 0.1, 0.12, len), roof, x, y + h / 2, z0 + step / 2, { rx: ang });
    b.add(cachedBox(w - 0.1, 0.1, len - 0.25), SNOW, x, y + h / 2 + 0.1, z0 + step / 2 + 0.02, { rx: ang });
    // glazing: a glowing band in a frame on the vertical face
    rb(b, tint(roof, -0.15), w, h, 0.08, x, y, z0 + 0.02, 0.02);
    g.box(glow, w - 0.3, h * 0.62, 0.05, x, y + h * 0.16, z0 - 0.03);
    for (let k = 0; k < 4; k++) b.box(tint(roof, -0.15), 0.06, h * 0.62, 0.07, x - (w - 0.3) / 2 + ((k + 0.5) * (w - 0.3)) / 4, y + h * 0.16, z0 - 0.03);
  }
}

const boxCache = new Map<string, THREE.BufferGeometry>();
function cachedBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxCache.set(key, g);
  }
  return g;
}

/** Spur gear lying in the XY plane (axle along Z) centred at (x, y, z): disc, rim, `teeth` teeth and a hub. */
function gear(k: Kit, color: number, hub: number, x: number, y: number, z: number, r: number, teeth: number, depth: number): void {
  k.cyl(color, r * 0.86, depth, x, y - depth / 2, z, 20, r * 0.86, { rx: Math.PI / 2 });
  k.torus(tint(color, -0.12), r * 0.6, r * 0.07, x, y, z + depth * 0.5, undefined, 18);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    k.box(color, r * 0.26, r * 0.24, depth, x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92 - r * 0.12, z - depth / 2, { rz: a - Math.PI / 2 });
  }
  hcyl(k, hub, r * 0.22, depth + 0.12, x, y, z, 'z', 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.sph(hub, r * 0.09, x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, z + depth / 2 + 0.01, { sz: 0.5 });
  }
}

/** Lamp post with a glowing head (sodium / gas lamp). */
function lampPost(b: Kit, g: Kit, post: number, glow: number, x: number, z: number, h: number, y = 0.25): void {
  b.cyl(post, 0.07, h, x, y, z, 8, 0.055);
  b.cyl(post, 0.13, 0.08, x, y, z, 8);
  b.cone(post, 0.2, 0.16, x, y + h + 0.18, z, 8);
  g.sph(glow, 0.13, x, y + h + 0.08, z, { sy: 1.2 });
  b.sph(SNOW, 0.12, x, y + h + 0.36, z, { sy: 0.45 });
}

// ---------------------------------------------------------------------------
// era 2 — Frontier: fieldstone and terracotta clay
// ---------------------------------------------------------------------------

/** quarry: stepped fieldstone quarry; a timber treadwheel turns the jib crane's winch, a block hangs over the pit. */
const quarry: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(2);
  plinth(b, S2.stoneD);
  // stepped quarry faces at the back and left, each ledge snowed over, with cut lines between the blocks
  rb(b, S2.stone, 4.4, 1.55, 1.0, 0, 0.25, -1.75, 0.1);
  cap(b, 4.3, 0.9, 0, 1.8, -1.75, 0.14);
  for (const x of [-1.5, -0.4, 0.75, 1.7]) b.box(S2.stoneD, 0.05, 1.1, 0.04, x, 0.55, -1.24);
  b.box(S2.stoneD, 4.2, 0.05, 0.04, 0, 1.1, -1.24);
  rb(b, S2.stoneL, 3.1, 0.95, 0.8, -0.55, 0.25, -0.9, 0.09);
  cap(b, 3.0, 0.7, -0.55, 1.2, -0.9, 0.12);
  for (const x of [-1.6, -0.6, 0.4]) b.box(tint(S2.stoneD, 0.1), 0.05, 0.6, 0.04, x, 0.4, -0.49);
  rb(b, S2.stone, 1.1, 0.5, 1.5, -1.7, 0.25, 0.3, 0.08);
  cap(b, 1.0, 1.4, -1.7, 0.75, 0.3, 0.1);
  // pit floor with chips, cut blocks waiting (one under snow) and a pick
  rb(b, tint(S2.stoneD, 0.12), 2.4, 0.04, 2.1, -0.15, 0.25, 0.75, 0.02);
  lumps(b, [S2.stoneL, S2.stone], -0.4, 0.29, 0.35, 0.5, 6, 41, 0.08);
  rb(b, S2.stoneL, 0.62, 0.42, 0.48, -0.75, 0.29, 1.35, 0.06, { ry: 0.12 });
  rb(b, S2.stone, 0.56, 0.38, 0.44, -0.72, 0.71, 1.33, 0.06, { ry: -0.18 });
  cap(b, 0.5, 0.4, -0.72, 1.09, 1.33, 0.08);
  rb(b, S2.stoneL, 0.55, 0.4, 0.45, 0.05, 0.29, 1.5, 0.06, { ry: 0.4 });
  b.beam(S2.timber, [-1.2, 0.29, 1.65], [-1.45, 1.05, 1.45], 0.06);
  boxC(b, S2.iron, 0.42, 0.07, 0.07, -1.45, 1.05, 1.45, { rz: 0.5 });
  // a warming brazier on the pit floor
  b.cyl(S2.iron, 0.22, 0.42, -0.9, 0.29, 0.25, 10, 0.26);
  g.cyl(G_FIRE, 0.22, 0.04, -0.9, 0.7, 0.25, 10);
  g.sph(E.glow, 0.12, -0.9, 0.78, 0.25, { sy: 1.3 });
  // treadwheel stand: two A-frames and a brass axle
  const wx = 1.55;
  const wy = 1.5;
  const wz = 0.45;
  for (const z of [wz - 0.48, wz + 0.48]) {
    for (const s of [-1, 1]) b.beam(S2.timber, [wx + s * 0.62, 0.25, z], [wx, wy, z], 0.15);
    b.beam(S2.timberD, [wx - 0.42, 0.75, z], [wx + 0.42, 0.75, z], 0.09);
  }
  hcyl(b, S2.iron, 0.07, 1.2, wx, wy, wz, 'z', 8);
  // jib crane: mast behind the wheel, a boom over the pit, a stone block on the rope, a lantern and a pennant
  const mz = -0.35;
  rb(b, S2.stoneD, 0.6, 0.35, 0.6, wx, 0.25, mz, 0.06);
  b.beam(S2.timber, [wx, 0.6, mz], [wx, 3.75, mz], 0.24);
  b.beam(S2.timberD, [wx, 0.6, mz - 0.75], [wx, 2.7, mz], 0.12);
  const tip: V3 = [-0.55, 3.3, 0.15];
  b.beam(S2.timber, [wx, 3.55, mz], tip, 0.17);
  b.beam(S2.timberD, [wx, 2.5, mz], [0.45, 3.42, -0.05], 0.1);
  cap(b, 0.34, 0.34, wx, 3.87, mz, 0.1);
  b.cyl(S2.iron, 0.13, 0.12, tip[0], tip[1] - 0.12, tip[2], 10);
  b.beam(S2.rope, [tip[0], tip[1] - 0.1, tip[2]], [tip[0], 2.05, tip[2]], 0.035);
  b.beam(S2.rope, [wx, wy, wz - 0.1], [wx - 0.05, 3.5, mz + 0.05], 0.035);
  b.beam(S2.iron, [tip[0] - 0.22, 2.05, tip[2]], [tip[0] + 0.22, 2.05, tip[2]], 0.05);
  rb(b, S2.stoneL, 0.6, 0.42, 0.46, tip[0], 1.62, tip[2], 0.06);
  cap(b, 0.54, 0.4, tip[0], 2.0, tip[2], 0.06);
  b.beam(S2.iron, [wx, 3.0, mz], [wx - 0.42, 3.0, mz + 0.05], 0.05);
  lantern(b, g, E.glow, wx - 0.42, 2.74, mz + 0.05, 0.14);
  b.beam(S2.timber, [wx, 3.92, mz], [wx, 4.3, mz], 0.06);
  b.prismXY(S2.clay, [[0, 0], [0.48, -0.12], [0, -0.25]], 0.03, wx + 0.03, 4.28, mz - 0.015);
  // ANIM: the treadwheel (two rims, tread boards, spokes and a brass hub)
  const r = 1.02;
  for (const z of [-0.36, 0.36]) wheel(a, 'z', S2.timber, S2.clay, 0, 0, z, r, 0.07, 6);
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    a.box(i % 2 ? S2.plank : tint(S2.plank, -0.1), 0.34, 0.05, 0.8, Math.cos(t) * (r - 0.02), Math.sin(t) * (r - 0.02) - 0.025, 0, { rz: t + Math.PI / 2 });
  }
  hcyl(a, S2.clay, 0.13, 0.86, 0, 0, 0, 'z', 10);
  return { at: [wx, wy, wz], motion: 'spin', axis: 'z', period: 3.4, amp: 0 };
};

/** kiln: a beehive brick kiln with a fat snowy dome, a chimney crown and a glowing firebox; a shaduf hoists bricks. */
const kiln: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(2);
  plinth(b, S2.timberD);
  const kx = -0.5;
  const kz = -0.45;
  // fieldstone footing and the brick drum, banded, with bricks proud of the wall here and there
  b.cyl(S2.stone, 1.75, 0.45, kx, 0.25, kz, 20, 1.68);
  b.torus(SNOW, 1.62, 0.1, kx, 0.72, kz, { rx: Math.PI / 2 }, 28);
  b.cyl(S2.clay, 1.45, 0.95, kx, 0.7, kz, 20, 1.4);
  for (const y of [0.95, 1.45]) b.cyl(S2.clayD, 1.46, 0.08, kx, y, kz, 20);
  const rnd = seeded(12);
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2 + rnd() * 0.2;
    const y = i % 2 ? 1.12 : 1.27;
    rb(b, i % 3 ? S2.clayL : S2.clayD, 0.26, 0.11, 0.12, kx + Math.cos(t) * 1.44, y, kz + Math.sin(t) * 1.44, 0.02, { ry: Math.PI / 2 - t });
  }
  // the dome and its fat snow cap
  b.dome(S2.clay, 1.42, kx, 1.62, kz, { sy: 0.82 });
  b.torus(S2.clayD, 1.12, 0.06, kx, 2.3, kz, { rx: Math.PI / 2 }, 24);
  b.sph(SNOW, 1.18, kx, 2.48, kz, { sy: 0.44 });
  // chimney crown on the dome (smoke puffs from its mouth)
  chimney(b, S2.clayD, S2.timberD, kx + 0.35, 2.55, kz - 0.35, 0.3, 1.25);
  g.cyl(E.glow, 0.18, 0.03, kx + 0.35, 3.84, kz - 0.35, 10);
  // the arched firebox mouth on the front, glowing, with a stone arch and a log pile
  const fz = kz + 1.42;
  rb(b, S2.stoneD, 1.1, 0.72, 0.3, kx, 0.7, fz, 0.06);
  arch(b, S2.stone, 0.48, 0.1, kx, 1.25, fz + 0.12);
  g.box(G_FIRE, 0.62, 0.5, 0.05, kx, 0.78, fz + 0.16);
  halfDisc(g, G_FIRE, 0.31, kx, 1.28, fz + 0.16);
  for (const [x, y] of [[-0.3, 0.37], [0.0, 0.37], [-0.15, 0.58]] as const) hcyl(b, S2.timber, 0.11, 0.6, kx - 0.95 + x, y, fz + 0.25, 'z', 8);
  // two little peep holes on the dome flank
  for (const t of [0.4, 1.2]) g.sph(E.glow, 0.08, kx + Math.cos(t) * 1.4, 1.75, kz + Math.sin(t) * 1.4);
  // stacks of fresh bricks drying under a little snow on the left
  for (const z of [0.75, 1.3]) {
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 2; i++) rb(b, (i + row) % 2 ? S2.clay : S2.clayL, 0.36, 0.16, 0.5, -2.05 + i * 0.38, 0.25 + row * 0.17, z, 0.03);
    }
    cap(b, 0.76, 0.5, -1.86, 0.76, z, 0.08);
  }
  // shaduf frame: two posts and a crossbar at the right
  const px = 1.7;
  const py = 2.35;
  const pz = -0.15;
  for (const x of [px - 0.32, px + 0.32]) b.beam(S2.timber, [x, 0.25, pz], [x, py + 0.1, pz], 0.15);
  hcyl(b, S2.iron, 0.06, 0.82, px, py, pz, 'x', 8);
  cap(b, 0.2, 0.2, px - 0.32, py + 0.1, pz, 0.06);
  cap(b, 0.2, 0.2, px + 0.32, py + 0.1, pz, 0.06);
  // brick pallet under the basket and a lantern on the post
  rb(b, S2.plank, 0.8, 0.1, 0.7, px, 0.25, 1.35, 0.02);
  for (let i = 0; i < 3; i++) rb(b, i % 2 ? S2.clay : S2.clayL, 0.32, 0.14, 0.62, px - 0.24 + i * 0.24, 0.35, 1.35, 0.03);
  b.beam(S2.iron, [px + 0.32, 1.7, pz], [px + 0.32, 1.7, pz + 0.3], 0.04);
  lantern(b, g, E.glow, px + 0.32, 1.45, pz + 0.3, 0.13);
  // ANIM: the shaduf pole, a stone counterweight at the back and a brick basket on a rope at the front
  a.beam(S2.timber, [0, 0, -1.0], [0, 0, 1.45], 0.13);
  rb(a, S2.stone, 0.38, 0.34, 0.38, 0, -0.3, -0.92, 0.07);
  a.beam(S2.rope, [0, -0.02, 1.38], [0, -0.62, 1.38], 0.03);
  a.cyl(S2.timberD, 0.22, 0.24, 0, -0.9, 1.38, 10, 0.27);
  for (let i = 0; i < 3; i++) rb(a, i % 2 ? S2.clayL : S2.clay, 0.26, 0.1, 0.14, (i - 1) * 0.12, -0.68, 1.38, 0.02, { ry: i * 0.6 });
  return { at: [px, py, pz], motion: 'swing', axis: 'x', period: 2.6, amp: 0.26, bias: -0.06, vents: [[kx + 0.35, 3.95, kz - 0.35]], ventColor: SMOKE };
};

// ---------------------------------------------------------------------------
// era 3 — Iron Age: rust ore, forged iron, timber
// ---------------------------------------------------------------------------

/** ironMine: a timber headframe over a lantern-lit shaft; the winding wheel turns, an ore cart waits on its rails. */
const ironMine: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(3);
  plinth(b, S3.stone);
  rb(b, tint(S3.oreD, 0.18), 4.4, 0.04, 4.3, 0, 0.25, 0, 0.02);
  const rnd = seeded(5);
  for (let i = 0; i < 18; i++) b.sph(i % 2 ? S3.ore : S3.oreD, 0.05 + rnd() * 0.04, -2 + rnd() * 4, 0.3, -2 + rnd() * 4, { sy: 0.5 });
  // shaft collar with a warm glow down the shaft
  const sx = -0.65;
  const sz = -0.45;
  rb(b, S3.stone, 1.7, 0.4, 1.7, sx, 0.25, sz, 0.08);
  b.box(S3.ironD, 1.05, 0.02, 1.05, sx, 0.64, sz);
  g.box(G_FIRE, 0.8, 0.02, 0.8, sx, 0.655, sz);
  cap(b, 1.6, 0.25, sx, 0.65, sz - 0.72, 0.08);
  // headframe: four splayed timber legs, cross braces, back struts and a snowy deck
  const top = 3.85;
  const legs: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [lx, lz] of legs) b.beam(S3.timber, [sx + lx * 0.72, 0.65, sz + lz * 0.72], [sx + lx * 0.34, top, sz + lz * 0.34], 0.16);
  for (const y of [1.6, 2.65]) {
    const h = 0.72 - (0.38 * (y - 0.65)) / (top - 0.65);
    for (let c = 0; c < 4; c++) {
      const [ax, az] = legs[c]!;
      const [bx, bz] = legs[(c + 1) % 4]!;
      b.beam(S3.timberD, [sx + ax * h, y, sz + az * h], [sx + bx * h, y, sz + bz * h], 0.09);
    }
  }
  for (const s of [-1, 1]) b.beam(S3.timberD, [sx + s * 0.34, top - 0.1, sz - 0.34], [sx + s * 0.6, 0.25, sz - 2.0], 0.12);
  rb(b, S3.timberD, 1.0, 0.14, 1.0, sx, top, sz, 0.03);
  cap(b, 0.95, 0.95, sx, top + 0.14, sz, 0.1);
  // wheel bearings on the deck
  for (const z of [sz - 0.32, sz + 0.32]) rb(b, S3.iron, 0.2, 0.42, 0.14, sx, top + 0.2, z, 0.03);
  // winding house at the back right: rust brick, slate roof, a glowing window, a stovepipe
  shed(b, S3.rust, S3.slate, 1.35, 0.25, -1.45, 1.8, 1.3, 1.4, 0.55);
  b.window(g, E.glow, S3.timberD, 1.35, 0.75, -0.73, 0.5, 0.45, 0);
  b.cyl(S3.iron, 0.1, 0.9, 1.9, 1.9, -1.6, 8);
  b.cyl(S3.ironD, 0.14, 0.1, 1.9, 2.8, -1.6, 8);
  b.beam(S3.timberD, [sx, top + 0.45, sz], [1.0, 1.4, -1.0], 0.04);
  // rails from the shaft to the front right, with a cart heaped with ore
  for (const z of [0.72, 1.18]) b.box(S3.ironL, 3.6, 0.08, 0.07, 0.35, 0.29, z);
  for (let x = -1.3; x <= 2.0; x += 0.42) rb(b, S3.timberD, 0.14, 0.05, 0.75, x, 0.26, 0.95, 0.01);
  rb(b, S3.rust, 0.95, 0.5, 0.62, 1.15, 0.48, 0.95, 0.06);
  rb(b, S3.rustD, 1.0, 0.08, 0.66, 1.15, 0.92, 0.95, 0.02);
  for (const x of [0.85, 1.45]) hcyl(b, S3.ironD, 0.14, 0.7, x, 0.44, 0.95, 'z', 10);
  lumps(b, [S3.ore, S3.oreL, S3.oreD], 1.15, 0.94, 0.95, 0.32, 7, 3, 0.13);
  // ore heap at the front left, snowed over at the top
  lumps(b, [S3.ore, S3.oreL, S3.oreD, S3.ore], -1.6, 0.25, 1.05, 0.62, 14, 17, 0.18);
  b.sph(SNOW, 0.32, -1.62, 0.62, 1.0, { sy: 0.35 });
  // lanterns: on a headframe leg and by the house door
  b.beam(S3.ironD, [sx + 0.56, 2.1, sz + 0.56], [sx + 0.85, 2.1, sz + 0.85], 0.04);
  lantern(b, g, E.glow, sx + 0.85, 1.85, sz + 0.85, 0.14);
  lantern(b, g, E.glow, 0.32, 1.35, -0.72, 0.11);
  // ANIM: the spoked winding wheel on top
  wheel(a, 'z', S3.rustD, S3.brass, 0, 0, 0, 0.92, 0.09, 8);
  a.torus(S3.rust, 0.78, 0.04, 0, 0, 0.05, undefined, 20);
  hcyl(a, S3.ironD, 0.1, 0.78, 0, 0, 0, 'z', 10);
  return { at: [sx, top + 1.08, sz], motion: 'spin', axis: 'z', period: 2.8, amp: 0, vents: [[1.9, 3.0, -1.6]], ventColor: SMOKE };
};

/** smelter: a banded blast furnace glowing at the throat and the tap hole, a jib swinging ore baskets over the top. */
const smelter: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(3);
  plinth(b, S3.stone);
  const fx = -0.45;
  const fz = -0.55;
  // stone footing, the tapering rust-brick stack with iron hoops, and a glowing throat ringed with snow
  rb(b, S3.stone, 2.6, 0.6, 2.6, fx, 0.25, fz, 0.12);
  cap(b, 2.5, 0.35, fx, 0.85, fz - 1.1, 0.08);
  b.cyl(S3.rust, 1.2, 2.75, fx, 0.85, fz, 14, 0.78);
  for (const [y, r] of [[1.3, 1.13], [2.1, 1.0], [2.9, 0.88]] as const) b.cyl(S3.ironL, r + 0.04, 0.12, fx, y, fz, 14);
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.beam(S3.iron, [fx + Math.cos(t) * 1.18, 0.85, fz + Math.sin(t) * 1.18], [fx + Math.cos(t) * 0.8, 3.55, fz + Math.sin(t) * 0.8], 0.1);
  }
  b.cyl(S3.ironD, 0.86, 0.18, fx, 3.6, fz, 14);
  b.torus(SNOW, 0.8, 0.09, fx, 3.8, fz, { rx: Math.PI / 2 }, 20);
  g.cyl(G_FIRE, 0.62, 0.05, fx, 3.74, fz, 14);
  g.sph(G_MOLTEN, 0.4, fx, 3.78, fz, { sy: 0.3 });
  // tap hole at the front: stone arch, glowing mouth, a molten runner into the ingot bed
  const tz = fz + 1.18;
  rb(b, S3.stone, 0.95, 0.75, 0.32, fx, 0.85, tz, 0.06);
  arch(b, S3.ironD, 0.3, 0.08, fx, 1.25, tz + 0.15);
  g.box(G_MOLTEN, 0.42, 0.38, 0.05, fx, 0.88, tz + 0.17);
  halfDisc(g, G_MOLTEN, 0.21, fx, 1.26, tz + 0.18);
  rb(b, 0xc9b493, 1.8, 0.12, 0.85, fx, 0.25, 1.45, 0.03);
  g.box(G_MOLTEN, 0.08, 0.04, 0.55, fx, 0.37, tz + 0.5);
  for (let i = 0; i < 4; i++) {
    const x = fx - 0.6 + i * 0.4;
    b.box(S3.ironD, 0.3, 0.05, 0.42, x, 0.36, 1.48);
    (i < 2 ? g : b).box(i < 2 ? G_MOLTEN : S3.ironL, 0.22, 0.05, 0.32, x, 0.38, 1.48);
  }
  // leather bellows at the left, nosing into the stack
  for (let i = 0; i < 3; i++) rb(b, i % 2 ? tint(S3.rustD, -0.15) : S3.rustD, 0.5 - (i % 2) * 0.06, 0.16, 0.85, -2.0, 0.85 + i * 0.16, fz, 0.05);
  rb(b, S3.timberD, 0.56, 0.06, 0.92, -2.0, 1.33, fz, 0.02);
  b.beam(S3.ironD, [-1.75, 1.05, fz], [-1.55, 1.05, fz], 0.1);
  // jib post at the right with an ore pile at its foot and a lantern
  const jx = 1.6;
  const jz = -0.75;
  rb(b, S3.stone, 0.6, 0.4, 0.6, jx, 0.25, jz, 0.06);
  b.beam(S3.timber, [jx, 0.65, jz], [jx, 4.3, jz], 0.24);
  b.beam(S3.timberD, [jx, 0.65, jz - 0.8], [jx, 2.4, jz], 0.12);
  cap(b, 0.32, 0.32, jx, 4.3, jz, 0.08);
  b.beam(S3.ironD, [jx, 2.0, jz], [jx + 0.32, 2.0, jz + 0.25], 0.04);
  lantern(b, g, E.glow, jx + 0.32, 1.75, jz + 0.25, 0.13);
  lumps(b, [S3.ore, S3.oreL, S3.oreD], 1.55, 0.25, 0.65, 0.55, 12, 23, 0.17);
  // iron pigs (the product) stacked at the front right
  for (const [y, z, r] of [[0.25, 1.35, 0], [0.25, 1.65, 0], [0.42, 1.5, 0.08]] as const) rb(b, S3.ironL, 0.85, 0.16, 0.22, 0.95, y, z, 0.05, { ry: r });
  // ANIM: the jib arm with a counterweight, swinging an ore basket over the throat
  const reach = jx - fx;
  a.beam(S3.timber, [0.3, 0, 0], [-reach - 0.1, 0, 0], 0.17);
  a.beam(S3.timberD, [0, -0.85, 0], [-reach * 0.55, -0.02, 0], 0.09);
  rb(a, S3.stone, 0.36, 0.3, 0.36, 0.38, -0.22, 0, 0.06);
  a.beam(0xcbb08a, [-reach, -0.05, 0], [-reach, -0.32, 0], 0.03);
  a.cyl(S3.timberD, 0.25, 0.26, -reach, -0.62, 0, 10, 0.3);
  lumps(a, [S3.ore, S3.oreL], -reach, -0.38, 0, 0.18, 4, 9, 0.11);
  return { at: [jx, 4.3, jz], motion: 'swing', axis: 'y', period: 3.0, amp: 0.55, vents: [[fx, 3.95, fz]], ventColor: SMOKE };
};

// ---------------------------------------------------------------------------
// era 4 — Steam Age: red brick, polished brass, coal
// ---------------------------------------------------------------------------

/** coalPit: a striped coal seam cut into the hill; a red-and-brass steam shovel slews to and fro on its tracks. */
const coalPit: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(4);
  plinth(b, tint(S4.ironD, 0.12));
  // the cutting: earth, coal seam, earth and snow layers on a face looking +Z, terraced at the left
  const layers: readonly (readonly [number, number])[] = [[0x8a7258, 0.35], [S4.coal, 0.42], [0x7d6650, 0.3], [S4.coalL, 0.28], [0x8a7258, 0.25]];
  let y = 0.25;
  for (const [c, h] of layers) {
    rb(b, c, 4.4, h, 1.3, 0, y, -1.65, 0.05);
    y += h;
  }
  cap(b, 4.3, 1.2, 0, y, -1.65, 0.16);
  y = 0.25;
  for (const [c, h] of layers.slice(0, 3)) {
    rb(b, c, 1.2, h, 1.2, -1.65, y, -0.45, 0.05);
    y += h;
  }
  cap(b, 1.1, 1.1, -1.65, y, -0.45, 0.12);
  // coal lumps fallen from the seam, a little coal heap and a timber coal tub
  lumps(b, [S4.coal, S4.coalL, S4.coal], -0.2, 0.25, -0.75, 0.75, 10, 7, 0.16);
  lumps(b, [S4.coal, S4.coalL], -1.4, 0.25, 1.15, 0.6, 12, 29, 0.18);
  b.sph(SNOW, 0.28, -1.45, 0.58, 1.1, { sy: 0.32 });
  rb(b, S4.timber, 0.8, 0.45, 0.6, -0.25, 0.4, 1.45, 0.06);
  for (const x of [-0.5, 0.0]) hcyl(b, S4.ironD, 0.13, 0.66, x, 0.38, 1.45, 'z', 10);
  lumps(b, [S4.coal, S4.coalL], -0.25, 0.82, 1.45, 0.25, 5, 13, 0.12);
  // gas lamp on a post at the back right
  lampPost(b, g, S4.ironD, E.glow, 2.05, -0.65, 2.0);
  // shovel tracks and turntable
  const cx = 1.0;
  const cz = 0.35;
  for (const x of [cx - 0.5, cx + 0.5]) {
    rb(b, S4.ironD, 0.36, 0.38, 1.7, x, 0.25, cz, 0.12);
    for (const z of [cz - 0.6, cz, cz + 0.6]) hcyl(b, S4.brass, 0.1, 0.4, x, 0.44, z, 'x', 8);
  }
  rb(b, S4.iron, 1.2, 0.2, 1.3, cx, 0.6, cz, 0.05);
  b.cyl(S4.brass, 0.6, 0.1, cx, 0.8, cz, 16);
  // ANIM: the upper works: cab, boiler and stack (on the slew axis), boom, stick and a dipper full of coal
  a.cyl(S4.ironD, 0.55, 0.12, 0, 0, 0, 16);
  rb(a, S4.brick, 1.15, 0.85, 1.05, 0.2, 0.12, 0, 0.1);
  a.gable(0.2, 0, 0.97, 1.15, 1.05, 0.38, S4.roof, tint(S4.roof, -0.12), S4.brick, 0.12);
  for (const z of [-0.53, 0.53]) a.box(S4.cream, 0.42, 0.32, 0.03, 0.35, 0.5, z);
  rb(a, S4.brass, 0.08, 0.3, 0.6, 0.79, 0.25, 0, 0.02);
  a.cyl(S4.ironD, 0.24, 0.9, 0, 0.6, 0, 12, 0.22);
  a.cyl(S4.brass, 0.25, 0.08, 0, 1.15, 0, 12);
  a.cyl(S4.ironD, 0.15, 0.85, 0, 1.4, 0, 10, 0.14);
  a.cyl(S4.brass, 0.18, 0.1, 0, 2.15, 0, 10);
  a.beam(S4.brick, [-0.3, 0.4, 0], [-1.45, 1.95, 0], 0.18);
  for (const z of [-0.07, 0.07]) a.beam(S4.brassL, [-0.3, 0.55, z], [-1.42, 2.05, z], 0.04);
  a.cyl(S4.brass, 0.12, 0.25, -1.45, 1.86, 0, 10, 0.12, { rx: Math.PI / 2 });
  a.beam(S4.ironD, [-1.45, 1.95, 0], [-1.25, 0.75, 0], 0.11);
  rb(a, S4.iron, 0.5, 0.42, 0.55, -1.2, 0.45, 0, 0.08);
  lumps(a, [S4.coal, S4.coalL], -1.2, 0.86, 0, 0.18, 4, 11, 0.1);
  for (let i = 0; i < 3; i++) a.cone(S4.ironL, 0.05, 0.14, -1.38 + i * 0.13, 0.36, 0.28, 6, { rx: Math.PI });
  return { at: [cx, 0.9, cz], motion: 'swing', axis: 'y', period: 3.2, amp: 0.55, bias: 0.15, vents: [[cx, 3.15, cz]], ventColor: STEAM };
};

/** steamWorks: a brick works with twin banded stacks and arched glowing windows; a giant brass gear turns on its front. */
const steamWorks: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(4);
  plinth(b, tint(S4.ironD, 0.12));
  const hz = -1.05;
  // brick hall with a base course, a brass band and a snowy gable roof
  rb(b, S4.brick, 4.2, 2.0, 2.0, 0, 0.25, hz, 0.1);
  rb(b, S4.brickD, 4.26, 0.32, 2.06, 0, 0.25, hz, 0.04);
  rb(b, S4.brass, 4.26, 0.08, 2.06, 0, 1.75, hz, 0.03);
  b.gable(0, hz, 2.25, 4.2, 2.0, 0.85, S4.roof, tint(S4.roof, -0.12), S4.brick, 0.18);
  // twin tall stacks with brass bands (the crown)
  for (const x of [-1.45, -0.55]) {
    chimney(b, S4.brickD, S4.brass, x, 2.4, -1.75, 0.28, 2.75 - (x + 1.45) * 0.4);
    for (const y of [3.1, 3.8]) b.cyl(S4.brass, 0.27, 0.08, x, y, -1.75, 12);
  }
  // arched windows glowing from inside, a door, a brass pressure dome on the roof ridge
  const fz = hz + 1.0;
  for (const x of [-1.5, -0.75, 0.0]) {
    b.window(g, G_WARM, S4.ironD, x, 0.75, fz + 0.01, 0.46, 0.75, 0);
    arch(b, S4.ironD, 0.26, 0.05, x, 1.5, fz + 0.04);
    halfDisc(g, G_WARM, 0.23, x, 1.5, fz + 0.06);
  }
  rb(b, S4.ironD, 0.06, 1.25, 0.06, 0.75, 0.25, fz + 0.03, 0.02);
  b.dome(S4.brassL, 0.28, 1.2, 3.0, hz, { sy: 0.8 });
  b.cyl(S4.brass, 0.3, 0.18, 1.2, 2.88, hz, 12);
  b.sph(SNOW, 0.2, 1.2, 3.2, hz, { sy: 0.45 });
  // gear pedestal, axle and a little meshing pinion
  const gx = 1.25;
  const gy = 1.42;
  const gz = 0.25;
  rb(b, S4.ironD, 0.5, 0.55, 0.4, gx, 0.25, gz - 0.3, 0.06);
  b.beam(S4.iron, [gx, 0.8, gz - 0.3], [gx, gy, gz - 0.3], 0.18);
  hcyl(b, S4.brassL, 0.1, 0.6, gx, gy, gz - 0.12, 'z', 10);
  gear(b, S4.iron, S4.brass, gx - 1.12, gy + 0.62, gz - 0.12, 0.32, 9, 0.16);
  // a pallet of finished gears and a coal bunker
  rb(b, S4.timber, 0.9, 0.12, 0.7, -1.6, 0.25, 0.75, 0.02);
  for (const [x, y] of [[-1.82, 0.42], [-1.4, 0.42], [-1.6, 0.6]] as const) gear(b, S4.brass, S4.ironD, x, y, 0.75, 0.2, 8, 0.1);
  rb(b, S4.brickD, 0.9, 0.5, 0.8, 0.05, 0.25, 1.35, 0.06);
  lumps(b, [S4.coal, S4.coalL], 0.05, 0.75, 1.35, 0.3, 7, 4, 0.12);
  lampPost(b, g, S4.ironD, E.glow, -2.1, 0.95, 1.7);
  // ANIM: the giant brass gear
  gear(a, S4.brass, S4.ironD, 0, 0, 0, 0.98, 14, 0.24);
  a.torus(S4.brassL, 0.86, 0.035, 0, 0, 0.13, undefined, 22);
  return {
    at: [gx, gy, gz],
    motion: 'spin',
    axis: 'z',
    period: 4.0,
    amp: 0,
    vents: [[-1.45, 5.25, -1.75], [-0.55, 4.9, -1.75]],
    ventColor: SMOKE,
  };
};

// ---------------------------------------------------------------------------
// era 5 — Industrial: iron pellets and coke, orange-painted steel, brick, sodium lamps
// ---------------------------------------------------------------------------

/** deepMine (Pellet Mine): an orange lattice headframe over a pellet ridge, a sawtooth engine house and a pellet bin. */
const deepMine: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(5);
  plinth(b, S5.concreteD);
  // the pellet ridge at the back left: a mound covered with rust-red pellets, snowed on top
  b.dome(S5.pellet, 1.45, -1.1, 0.25, -1.3, { sy: 0.62, sx: 1.05 });
  const rnd = seeded(51);
  for (let i = 0; i < 40; i++) {
    const t = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 1.38;
    const yy = 0.25 + 0.9 * Math.sqrt(Math.max(0, 1 - (d / 1.45) ** 2));
    b.sph(i % 3 ? S5.pellet : S5.pelletL, 0.09, -1.1 + Math.cos(t) * d * 1.05, yy, -1.3 + Math.sin(t) * d, { sy: 0.85 });
  }
  b.sph(SNOW, 0.85, -1.1, 0.95, -1.3, { sy: 0.32 });
  // shaft collar and the orange lattice headframe with a deck
  const hx = -0.15;
  const hz = 0.05;
  rb(b, S5.concrete, 1.6, 0.3, 1.6, hx, 0.25, hz, 0.06);
  g.box(E.glow, 0.7, 0.02, 0.7, hx, 0.56, hz);
  lattice(b, S5.orange, hx, hz, 0.55, 3.4, 1.4, 0.75, 4, 0.11);
  rb(b, S5.steelD, 1.05, 0.14, 1.05, hx, 3.95, hz, 0.03);
  cap(b, 1.0, 1.0, hx, 4.09, hz, 0.1);
  for (const z of [hz - 0.28, hz + 0.28]) rb(b, S5.steel, 0.18, 0.4, 0.12, hx, 4.15, z, 0.03);
  // engine house at the right: brick with a sawtooth roof, a chimney and lit windows
  rb(b, S5.brick, 1.7, 1.45, 2.3, 1.45, 0.25, -0.9, 0.08);
  rb(b, S5.brickD, 1.76, 0.25, 2.36, 1.45, 0.25, -0.9, 0.04);
  sawtooth(b, g, S5.steel, 1.45, 1.7, -0.9, 1.7, 2.3, 2, 0.55, E.glow);
  b.window(g, E.glow, S5.steelD, 1.45, 0.75, 0.27, 0.6, 0.5, 0);
  b.window(g, E.glow, S5.steelD, 2.31, 0.75, -1.3, 0.5, 0.5, Math.PI / 2);
  chimney(b, S5.brickD, S5.orange, 1.95, 2.0, -1.8, 0.2, 1.7);
  b.beam(S5.steelD, [hx + 0.05, 4.45, hz], [1.0, 1.75, -0.35], 0.035);
  // pellet conveyor from the ridge up to a bin on legs at the front left
  b.beam(S5.orangeD, [-1.6, 0.5, -0.4], [-1.55, 1.85, 0.75], 0.14);
  b.beam(S5.steelD, [-1.48, 0.6, -0.4], [-1.43, 1.95, 0.75], 0.05);
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    b.sph(S5.pelletL, 0.07, -1.6 + 0.05 * t, 0.62 + 1.35 * t, -0.4 + 1.15 * t);
  }
  for (const [x, z] of [[-1.95, 0.85], [-1.15, 0.85], [-1.95, 1.55], [-1.15, 1.55]] as const) b.beam(S5.steelD, [x, 0.25, z], [x, 1.3, z], 0.09);
  b.cyl(S5.steel, 0.55, 0.45, -1.55, 0.95, 1.2, 4, 0.2, { ry: Math.PI / 4, rx: Math.PI });
  rb(b, S5.steel, 1.0, 0.55, 1.0, -1.55, 1.3, 1.2, 0.06);
  rb(b, S5.orange, 1.04, 0.1, 1.04, -1.55, 1.8, 1.2, 0.03);
  b.dome(S5.pellet, 0.42, -1.55, 1.88, 1.2, { sy: 0.5 });
  for (let i = 0; i < 6; i++) b.sph(S5.pelletL, 0.07, -1.55 + Math.cos(i) * 0.25, 2.02, 1.2 + Math.sin(i) * 0.25);
  // sodium lamp on the front right
  lampPost(b, g, S5.steelD, E.glow, 0.95, 1.55, 1.9);
  // ANIM: the twin-rim sheave wheel at the top
  for (const z of [-0.1, 0.1]) wheel(a, 'z', S5.orange, S5.steelD, 0, 0, z, 0.72, 0.075, 8);
  hcyl(a, S5.brass, 0.1, 0.42, 0, 0, 0, 'z', 10);
  return { at: [hx, 4.85, hz], motion: 'spin', axis: 'z', period: 2.4, amp: 0, vents: [[1.95, 3.85, -1.8]], ventColor: SMOKE };
};

/** cokeOven: a brick battery of glowing oven doors, a charging car shuttling along the top and a steaming quench tower. */
const cokeOven: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(5);
  plinth(b, S5.concreteD);
  const bx = -0.45;
  const bz = -0.75;
  // the battery: a long brick block with a concrete deck and orange buckstays between the arched oven doors
  rb(b, S5.brick, 3.7, 1.65, 1.7, bx, 0.25, bz, 0.08);
  rb(b, S5.brickD, 3.76, 0.25, 1.76, bx, 0.25, bz, 0.04);
  rb(b, S5.concrete, 3.85, 0.2, 1.85, bx, 1.9, bz, 0.04);
  const front = bz + 0.86;
  for (let i = 0; i < 5; i++) {
    const x = bx - 1.44 + i * 0.72;
    rb(b, S5.steelD, 0.46, 0.95, 0.08, x, 0.5, front, 0.03);
    g.box(G_FIRE, 0.32, 0.7, 0.04, x, 0.6, front + 0.05);
    halfDisc(g, G_FIRE, 0.16, x, 1.3, front + 0.05);
    arch(b, S5.steelD, 0.2, 0.04, x, 1.3, front + 0.06);
  }
  for (let i = 0; i < 6; i++) rb(b, S5.orange, 0.09, 1.65, 0.1, bx - 1.8 + i * 0.72, 0.25, front + 0.02, 0.02);
  // charging rails, glowing lids and ascension pipes on the deck, with snow at the ends
  for (const z of [bz - 0.35, bz + 0.35]) b.box(S5.steelL, 3.6, 0.06, 0.07, bx, 2.1, z);
  for (let i = 0; i < 5; i++) {
    const x = bx - 1.44 + i * 0.72;
    g.cyl(G_FIRE, 0.1, 0.04, x, 2.1, bz, 10);
    b.cyl(S5.steelD, 0.07, 0.6, x + 0.2, 2.1, bz - 0.7, 8);
    hcyl(b, S5.steelD, 0.07, 0.32, x + 0.2, 2.68, bz - 0.55, 'z', 8);
  }
  hcyl(b, S5.steel, 0.16, 3.6, bx, 2.85, bz - 0.4, 'x', 12);
  cap(b, 0.5, 1.6, bx - 1.72, 2.1, bz, 0.12);
  cap(b, 0.4, 1.6, bx + 1.72, 2.1, bz, 0.12);
  // quench tower (the crown): a tall concrete tower with louvres, a hood and a snowy rim; the big steam puffs here
  const qx = 1.7;
  const qz = -1.25;
  rb(b, S5.concreteD, 1.15, 3.5, 1.15, qx, 0.25, qz, 0.08);
  for (const y of [1.0, 1.6, 2.2, 2.8]) rb(b, S5.concrete, 1.2, 0.12, 1.2, qx, y, qz, 0.03);
  rb(b, S5.concrete, 1.4, 0.55, 1.4, qx, 3.75, qz, 0.08);
  rb(b, S5.orange, 1.44, 0.1, 1.44, qx, 3.75, qz, 0.03);
  b.torus(SNOW, 0.55, 0.1, qx, 4.32, qz, { rx: Math.PI / 2 }, 16);
  // the coke wharf at the front: a sloped bed of coke with a few embers, and a quench car on its rails
  rb(b, S5.concrete, 2.6, 0.18, 1.0, bx, 0.25, 1.3, 0.04, { rx: -0.12 });
  lumps(b, [S5.coke, S5.cokeL, S5.coke], bx - 0.35, 0.38, 1.25, 0.75, 14, 33, 0.14);
  for (const [x, z] of [[-1.2, 1.4], [-0.5, 1.15], [0.1, 1.4]] as const) g.sph(G_FIRE, 0.06, x, 0.52, z);
  for (const z of [1.65, 1.95]) b.box(S5.steelL, 1.4, 0.06, 0.06, 1.55, 0.29, z);
  rb(b, S5.orange, 1.0, 0.45, 0.5, 1.55, 0.42, 1.8, 0.06);
  rb(b, S5.steelD, 1.04, 0.08, 0.54, 1.55, 0.86, 1.8, 0.02);
  for (const x of [1.25, 1.85]) hcyl(b, S5.steelD, 0.12, 0.6, x, 0.4, 1.8, 'z', 10);
  lumps(b, [S5.coke, S5.cokeL], 1.55, 0.9, 1.8, 0.28, 5, 41, 0.11);
  lampPost(b, g, S5.steelD, E.glow, 2.05, 0.35, 1.9);
  // ANIM: the larry (charging) car rolling along the deck rails
  rb(a, S5.orange, 0.8, 0.5, 0.95, 0, 0.15, 0, 0.08);
  rb(a, S5.steelD, 0.84, 0.08, 0.99, 0, 0.15, 0, 0.02);
  for (const x of [-0.25, 0.25]) hcyl(a, S5.steelD, 0.11, 1.0, x, 0.12, 0, 'z', 10);
  a.cyl(S5.steel, 0.32, 0.4, 0, 0.65, 0, 4, 0.42, { ry: Math.PI / 4 });
  lumps(a, [S5.coke, S5.cokeL], 0, 1.05, 0, 0.2, 5, 8, 0.1);
  rb(a, S5.steelD, 0.3, 0.3, 0.3, 0.25, 0.65, 0.3, 0.05);
  a.box(E.glow, 0.12, 0.1, 0.03, 0.25, 0.85, 0.46);
  return {
    at: [bx, 2.0, bz],
    motion: 'slide',
    axis: 'x',
    period: 5.0,
    amp: 1.25,
    vents: [[qx, 4.45, qz], [qx - 0.1, 4.5, qz + 0.1]],
    ventColor: STEAM,
  };
};

/** steelMill: a sawtooth mill hall with a tall stack; the converter tilts and pours glowing steel into a ladle. */
const steelMill: Recipe = ({ body: b, glow: g, anim: a }) => {
  const E = palette(5);
  plinth(b, S5.concreteD);
  const hz = -1.45;
  // mill hall: brick base, steel walls, a sawtooth roof glowing sodium yellow, lit windows on the front
  rb(b, S5.brick, 3.6, 0.6, 1.7, -0.35, 0.25, hz, 0.06);
  rb(b, S5.steel, 3.6, 1.3, 1.7, -0.35, 0.85, hz, 0.08);
  rb(b, S5.orange, 3.66, 0.08, 1.76, -0.35, 2.1, hz, 0.03);
  sawtooth(b, g, S5.steelD, -0.35, 2.15, hz, 3.6, 1.7, 2, 0.55, E.glow);
  for (const x of [-1.6, -0.9, -0.2, 0.5]) b.window(g, E.glow, S5.steelD, x, 1.05, hz + 0.86, 0.42, 0.55, 0);
  // the tall stack (the crown) with orange bands and a snowy rim
  chimney(b, S5.brickD, S5.orange, 1.8, 0.25, -1.75, 0.38, 5.15);
  for (const y of [1.6, 3.0, 4.2]) b.cyl(S5.orange, 0.35, 0.12, 1.8, y, -1.75, 12);
  // converter stands and trunnion axle
  const cx = -0.35;
  const cy = 1.85;
  const cz = 0.25;
  for (const z of [cz - 0.82, cz + 0.82]) {
    for (const s of [-1, 1]) b.beam(S5.orange, [cx + s * 0.5, 0.25, z], [cx, cy, z], 0.17);
    rb(b, S5.steelD, 0.3, 0.3, 0.2, cx, cy - 0.15, z, 0.04);
    cap(b, 0.24, 0.16, cx, cy + 0.15, z, 0.06);
  }
  // the ladle on its car, glowing molten steel, sparks, and the pour from the converter's lip
  const lx = 0.85;
  const lz = 0.55;
  for (const z of [lz - 0.3, lz + 0.3]) b.box(S5.steelL, 1.3, 0.06, 0.06, lx, 0.29, z);
  rb(b, S5.steelD, 0.95, 0.25, 0.8, lx, 0.32, lz, 0.05);
  b.cyl(S5.steel, 0.42, 0.75, lx, 0.55, lz, 14, 0.5);
  b.cyl(S5.orange, 0.52, 0.08, lx, 1.12, lz, 14);
  g.cyl(G_MOLTEN, 0.44, 0.05, lx, 1.27, lz, 14);
  g.beam(G_MOLTEN, [0.2, 2.45, cz], [0.55, 1.95, cz + 0.12], 0.12);
  g.beam(G_MOLTEN, [0.55, 1.95, cz + 0.12], [0.78, 1.3, lz - 0.05], 0.1);
  for (const [x, y, z] of [[1.25, 1.55, 0.35], [0.45, 1.45, 0.9], [1.2, 1.7, 0.85], [0.6, 1.75, 0.3]] as const) g.sph(G_WARM, 0.05, x, y, z);
  // steel beams (the product) stacked at the front left, and a sodium lamp
  for (let i = 0; i < 3; i++) {
    const y = 0.25 + i * 0.17;
    rb(b, i % 2 ? S5.steelL : S5.steel, 1.2, 0.07, 0.36, -1.65, y, 1.3, 0.02);
    rb(b, i % 2 ? S5.steelL : S5.steel, 1.2, 0.1, 0.07, -1.65, y + 0.07, 1.3, 0.02);
  }
  cap(b, 1.1, 0.34, -1.65, 0.76, 1.3, 0.07);
  lampPost(b, g, S5.steelD, E.glow, -2.05, 0.3, 1.9);
  // ANIM: the converter: an egg-shaped vessel with a trunnion ring, an orange band and a bright lip
  a.lathe(S5.steel, [[0.0, -0.78], [0.5, -0.72], [0.72, -0.35], [0.74, 0.05], [0.6, 0.45], [0.36, 0.72], [0.3, 0.8], [0.0, 0.8]], 0, 0, 0, 16);
  a.cyl(S5.orange, 0.76, 0.14, 0, -0.12, 0, 16);
  a.torus(S5.steelD, 0.33, 0.05, 0, 0.8, 0, { rx: Math.PI / 2 }, 14);
  a.cyl(0xffd27a, 0.26, 0.03, 0, 0.8, 0, 12);
  hcyl(a, S5.steelD, 0.11, 1.5, 0, 0, 0, 'z', 10);
  return {
    at: [cx, cy, cz],
    motion: 'swing',
    axis: 'z',
    period: 3.6,
    amp: 0.16,
    bias: -0.5,
    vents: [[1.8, 5.55, -1.75]],
    ventColor: SMOKE,
  };
};

const RECIPES: Record<ClassicMachineId, Recipe> = { quarry, kiln, ironMine, smelter, coalPit, steamWorks, deepMine, cokeOven, steelMill };

/** Era of each machine (for the root name). */
const ERA: Record<ClassicMachineId, number> = { quarry: 2, kiln: 2, ironMine: 3, smelter: 3, coalPit: 4, steamWorks: 4, deepMine: 5, cokeOven: 5, steelMill: 5 };

// ---------------------------------------------------------------------------
// building models
// ---------------------------------------------------------------------------

interface Built {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  pivot: THREE.BufferGeometry;
  spec: AnimSpec;
  w: number;
  d: number;
}

const builtCache = new Map<ClassicMachineId, Built>();

function build(id: ClassicMachineId): Built {
  let built = builtCache.get(id);
  if (built) return built;
  const parts: Parts = { body: new Kit(), glow: new Kit(), anim: new Kit() };
  const spec = RECIPES[id](parts);
  const body = parts.body.geometry();
  const glow = parts.glow.geometry();
  const pivot = parts.anim.geometry();
  const box = new THREE.Box3().copy(body.boundingBox!);
  box.union(glow.boundingBox!);
  box.union(pivot.boundingBox!.clone().translate(new THREE.Vector3(...spec.at)));
  const size = box.getSize(new THREE.Vector3());
  built = { body, glow, pivot, spec, w: Math.ceil(size.x * 10 - 1e-6) / 10, d: Math.ceil(size.z * 10 - 1e-6) / 10 };
  builtCache.set(id, built);
  return built;
}

/** Idle crawl as a share of the working speed. */
const IDLE = 0.12;

/** The animation settings of a machine (for tests). */
export function classicMachineMotion(id: ClassicMachineId): Readonly<AnimSpec> {
  return build(id).spec;
}

/** Build one of the nine machines: body, glow and one 'pivot' mesh, sharing cached geometry per id. */
export function createClassicMachineModel(id: ClassicMachineId): MachineModel {
  const built = build(id);
  const spec = built.spec;
  const root = new THREE.Group();
  root.name = `machine:${id}:${ERA[id]}`;
  const body = new THREE.Mesh(built.body, vcMat());
  body.name = 'body';
  body.castShadow = true;
  body.receiveShadow = true;
  const glow = new THREE.Mesh(built.glow, eraGlowMaterial());
  glow.name = 'glow';
  const pivot = new THREE.Mesh(built.pivot, vcMat());
  pivot.name = 'pivot';
  pivot.castShadow = true;
  pivot.position.set(...spec.at);
  root.add(body, glow, pivot);

  const bias = spec.bias ?? 0;
  const i = spec.axis === 'x' ? 0 : spec.axis === 'y' ? 1 : 2;
  let phase = 0;
  let drive = IDLE;
  const animate = (dt: number, working: boolean): void => {
    drive += ((working ? 1 : IDLE) - drive) * Math.min(1, dt * 3);
    phase += (dt / spec.period) * drive;
    phase -= Math.floor(phase);
    const s = Math.sin(phase * Math.PI * 2);
    switch (spec.motion) {
      case 'spin':
        pivot.rotation[spec.axis] = -phase * Math.PI * 2;
        break;
      case 'swing':
        pivot.rotation[spec.axis] = bias + s * spec.amp;
        break;
      case 'bob':
      case 'slide':
        pivot.position.setComponent(i, spec.at[i]! + bias + s * spec.amp);
        break;
    }
  };
  animate(0, false);
  return { root, w: built.w, d: built.d, animate, vents: spec.vents, ventColor: spec.ventColor };
}

/** Gallery hook: debug/Gallery.ts calls `userData.galleryAnimate(dt)` every frame, so the parts move. */
export function classicForGallery(id: ClassicMachineId): THREE.Object3D {
  const m = createClassicMachineModel(id);
  m.root.userData.galleryAnimate = (dt: number): void => m.animate(dt, true);
  return m.root;
}

/** True for the ids this file builds. */
export function isClassicMachine(id: MachineId): id is ClassicMachineId {
  return (CLASSIC_MACHINE_IDS as readonly string[]).includes(id);
}
