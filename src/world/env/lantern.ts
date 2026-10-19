/**
 * [T4] 0.9.12 Lantern Lane's scenery (town/lane.ts): the Market Town's new street south of its fence, along the south
 * avenue down to road R1. Built once, when the lane opens (Town.refreshLane): a cobbled walk the width of LANE_WALK, the
 * four lot outlines, a low picket fence down either side (open to R1 at the south end), lamps of the town's lamp
 * generation, benches between the lot rows, little lit firs at the corners and snow banked along the fences.
 *
 * Every solid prop is in LANE_PROPS with its radius, so tests/townLane.test.ts can prove none of them stands in the walk,
 * on a lot, on a pad or in front of a lot. Draw calls: walk 1, ground 1, statics 1, bulbs 1, fence 1, lamps 1 (the shown
 * generation), halos 1.
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE, rect } from '../../config';
import { palisadeMaterial, palisadePostGeometry } from '../../assets/scenery';
import { Batch, instanced, Rng, type Placement } from './common';
import { addSparkleSpot, registerEra } from './eras';
import { addPalisade, type FenceLine } from './fences';
import { bulbMaterial, buildHalos } from './glow';
import { cobbleTexture } from './groundTex';
import { buildLampVariants, type LampSpot } from './lamps';
import { addBench, box, cone, cyl } from './townProps';
import { LANE, LANE_WALK, TOWN_SOUTH } from '../../town/lane';
import { TOWN_SQUARE_LOTS, type GameContext } from '../../core/types';
import { toon } from '../../render/materials';

const T = LAYOUT.town;

/** One solid prop of the lane: where it stands and how far its collider reaches. */
export interface LaneProp {
  kind: 'lamp' | 'bench' | 'fir';
  x: number;
  z: number;
  /** Collider radius (a bench: half its depth). */
  r: number;
  /** A bench's half length along x (it runs along x; its colliders are two circles along it). */
  hx?: number;
  yaw?: number;
}

/** The z between the two rows of lots (benches and the middle lamps stand there). */
const MID_Z = (T.lots[TOWN_SQUARE_LOTS]!.z + T.lots[TOWN_SQUARE_LOTS + 2]!.z) / 2;
const NORTH_Z = TOWN_SOUTH + 0.9;
const SOUTH_Z = LANE.maxZ - 0.7;
/** Lamps stand just outside the walk, in line with the lot pads' outer edge. */
const LAMP_W = LANE_WALK.minX - 0.6;
const LAMP_E = LANE_WALK.maxX + 0.6;

export const LANE_PROPS: readonly LaneProp[] = [
  { kind: 'lamp', x: LAMP_W, z: NORTH_Z, r: 0.17 },
  { kind: 'lamp', x: LAMP_E, z: NORTH_Z, r: 0.17 },
  { kind: 'lamp', x: LAMP_W, z: MID_Z, r: 0.17 },
  { kind: 'lamp', x: LAMP_E, z: MID_Z, r: 0.17 },
  { kind: 'lamp', x: LAMP_W, z: SOUTH_Z, r: 0.17 },
  { kind: 'lamp', x: LAMP_E, z: SOUTH_Z, r: 0.17 },
  // benches in the little yards between the lot rows, looking south down the lane
  { kind: 'bench', x: T.lots[TOWN_SQUARE_LOTS]!.x + 0.6, z: MID_Z, r: 0.3, hx: 0.9, yaw: 0 },
  { kind: 'bench', x: T.lots[TOWN_SQUARE_LOTS + 1]!.x - 0.6, z: MID_Z, r: 0.3, hx: 0.9, yaw: 0 },
  // little lit firs in the four corners, clear of the lots
  { kind: 'fir', x: LANE.minX + 0.9, z: NORTH_Z, r: 0.5 },
  { kind: 'fir', x: LANE.maxX - 0.9, z: NORTH_Z, r: 0.5 },
  { kind: 'fir', x: LANE.minX + 0.9, z: SOUTH_Z, r: 0.5 },
  // 2.2 m in from the east fence: the R1 / city road signpost stands in that corner (world/env/wayfinding.ts)
  { kind: 'fir', x: LANE.maxX - 2.2, z: SOUTH_Z, r: 0.5 },
];

const LIGHTS = [0xffd36b, 0xff8a7a, 0x9be0ff, 0xfff1c2, 0xb8f0a0];

/** A small snowy fir (about 2.2 m) with a few warm fairy lights. */
function addLittleFir(b: Batch, bulbs: Batch, x: number, z: number, seed: number): void {
  b.add(cyl(0.09, 0.12, 0.5, 6), PALETTE.trunk, x, 0.25, z);
  const tiers: Array<[number, number, number]> = [
    [0.78, 0.95, 0.85],
    [0.6, 0.8, 1.35],
    [0.4, 0.66, 1.8],
  ];
  tiers.forEach(([r, h, y], i) => {
    b.add(cone(r, h, 8), i % 2 ? 0x2f6b4a : 0x2a5f43, x, y, z);
    b.add(cone(r * 0.82, h * 0.32, 8), PALETTE.snow, x, y + h * 0.3, z);
  });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + seed;
    const y = 0.75 + (i % 3) * 0.4;
    const rr = 0.68 - (i % 3) * 0.17;
    bulbs.add(box(0.07, 0.07, 0.07), LIGHTS[(i + seed) % LIGHTS.length]!, x + Math.cos(a) * rr, y, z + Math.sin(a) * rr);
  }
  bulbs.add(box(0.12, 0.12, 0.12), 0xffe27a, x, 2.28, z);
}

/** Build the lane's scenery into `parent` and its colliders into ctx.colliders. Call once. */
export function buildLanternLane(ctx: GameContext, parent: THREE.Object3D): THREE.Group {
  const rng = new Rng(4712);
  const root = new THREE.Group();
  root.name = 'lanternLane';
  parent.add(root);

  // ---- ground: trampled snow over the lane, packed lot outlines, soft drifts outside the walk
  const flat = new Batch();
  const slab = (w: number, d: number, x: number, z: number, y: number, color: number, t = 0.02): void => {
    flat.add(box(w, t, d), color, x, y - t / 2, z);
  };
  const lots = T.lots.slice(TOWN_SQUARE_LOTS);
  for (const l of lots) {
    slab(T.lotSize, T.lotSize, l.x, l.z, 0.026, 0xd6e1ee);
    slab(T.lotSize - 0.5, T.lotSize - 0.5, l.x, l.z, 0.031, 0xdfe9f3, 0.01);
    const h = T.lotSize / 2;
    for (const s of [-1, 1]) {
      slab(T.lotSize + 0.1, 0.12, l.x, l.z + s * h, 0.036, 0xb9c8da, 0.012);
      slab(0.12, T.lotSize + 0.1, l.x + s * h, l.z, 0.036, 0xb9c8da, 0.012);
    }
  }
  // each lot's front path: flagstones from the walk to its pad
  for (const l of lots) {
    const from = l.x + l.face.x * (T.lotSize / 2);
    const to = l.face.x > 0 ? LANE_WALK.minX : LANE_WALK.maxX;
    for (let x = Math.min(from, to) + 0.3, i = 0; x < Math.max(from, to) - 0.1; x += 0.62, i++) {
      flat.add(box(0.5, 0.025, 0.62), i % 2 ? 0xb4c0d0 : 0xc3ccd9, x, 0.035, l.z + (i % 2 ? 0.25 : -0.25), { ry: (i % 3) * 0.05 - 0.05 });
    }
  }
  const disc = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const keep = [LANE_WALK, ...lots.map((l) => rect(l.x, l.z, T.lotSize + 0.8, T.lotSize + 0.8))];
  for (let tries = 0, layer = 0; tries < 160 && layer < 14; tries++) {
    const x = rng.range(LANE.minX + 0.6, LANE.maxX - 0.6);
    const z = rng.range(LANE.minZ + 0.6, LANE.maxZ - 0.4);
    const r = rng.range(0.8, 1.8);
    if (keep.some((k) => x + r * 0.7 > k.minX && x - r * 0.7 < k.maxX && z + r * 0.7 > k.minZ && z - r * 0.7 < k.maxZ)) continue;
    flat.add(disc, layer % 2 ? 0xf8fbff : 0xdde8f3, x, 0.009 + layer * 0.00035, z, { sx: r, sz: r * rng.range(0.6, 1), ry: rng.range(0, 3) });
    layer++;
  }
  root.add(flat.mesh({ cast: false, receive: true }));

  // ---- the cobbled walk (the square's stones, so the lane reads as part of the town)
  const w = LANE_WALK.maxX - LANE_WALK.minX;
  const d = LANE.maxZ - TOWN_SOUTH;
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), toon(0xffffff, { map: cobbleTexture(w, d, { seed: 33, ppm: 44, kerb: 0.3, snow: 0.55 }) }));
  walk.position.set((LANE_WALK.minX + LANE_WALK.maxX) / 2, 0.055, TOWN_SOUTH + d / 2);
  walk.receiveShadow = true;
  root.add(walk);

  // ---- props
  const statics = new Batch();
  const bulbs = new Batch();
  const halos: Array<{ x: number; y: number; z: number; size: number; pool: number }> = [];
  LANE_PROPS.forEach((p, i) => {
    if (p.kind === 'bench') {
      addBench(statics, p.x, p.z, p.yaw ?? 0);
      for (const k of [-0.5, 0.5]) ctx.colliders.addCircle(p.x + k, p.z, 0.4, `town:laneBench${i}`);
    } else if (p.kind === 'fir') {
      addLittleFir(statics, bulbs, p.x, p.z, i);
      ctx.colliders.addCircle(p.x, p.z, p.r, 'town:laneFir');
      halos.push({ x: p.x, y: 1.4, z: p.z, size: 1.6, pool: 3.4 });
    } else {
      ctx.colliders.addCircle(p.x, p.z, p.r, 'town:lamp');
      addSparkleSpot(p.x, 3, p.z);
    }
  });
  // a barrel against each fence between the lot rows
  for (const [bx, bz] of [
    [LANE.minX + 0.55, MID_Z - 0.2],
    [LANE.maxX - 0.55, MID_Z + 0.2],
  ] as const) {
    statics.add(cyl(0.24, 0.26, 0.56, 9), 0x8a5a2b, bx, 0.28, bz);
    statics.add(cyl(0.26, 0.26, 0.05, 9), 0x30353d, bx, 0.16, bz);
    statics.add(cyl(0.26, 0.26, 0.05, 9), 0x30353d, bx, 0.42, bz);
    statics.add(cyl(0.2, 0.2, 0.04, 9), PALETTE.snow, bx, 0.58, bz);
  }
  // snow banked along both fences, clear of the lots' backs
  const mound = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < 10; i++) {
    const west = i % 2 === 0;
    const z = rng.range(LANE.minZ + 0.8, LANE.maxZ - 0.8);
    const r = rng.range(0.45, 0.8);
    statics.add(mound, PALETTE.snow, west ? LANE.minX + 0.4 : LANE.maxX - 0.4, -0.02, z, { sx: r * 0.7, sy: r * 0.45, sz: r * 1.4, ry: rng.range(-0.2, 0.2) });
  }
  root.add(statics.mesh({ cast: true, receive: true }));
  root.add(bulbs.mesh({ cast: false, receive: false, material: bulbMaterial() }));
  if (halos.length) root.add(buildHalos(halos));

  // ---- lamps of the town's generation
  const lampSpots: LampSpot[] = LANE_PROPS.filter((p) => p.kind === 'lamp').map((p) => ({ x: p.x, z: p.z }));
  const lamps = buildLampVariants(lampSpots);
  root.add(lamps.group);
  registerEra((look) => lamps.show(look.lamp));

  // ---- the fence: a low picket down either side, joining the town's fence; open to R1 at the south end
  const lines: FenceLine[] = [
    { axis: 'z', at: LANE.minX, from: TOWN_SOUTH, to: LANE.maxZ },
    { axis: 'z', at: LANE.maxX, from: TOWN_SOUTH, to: LANE.maxZ },
    { axis: 'x', at: TOWN_SOUTH, from: T.area.maxX, to: LANE.maxX },
  ];
  const pickets: Placement[] = [];
  for (const l of lines) addPalisade(pickets, l, rng);
  for (const p of pickets) {
    p.sx = (p.sx ?? 1) * 0.8;
    p.sz = p.sx;
    p.sy = (p.sy ?? 1) * 0.5;
  }
  root.add(instanced(palisadePostGeometry(), palisadeMaterial(), pickets, { cast: false }));
  return root;
}
