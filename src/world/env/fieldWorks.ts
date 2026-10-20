/**
 * 0.9.13 (review E1): the harvest field's earthworks and its working props, so a field reads as a place being worked
 * instead of a flat grid of blobs on a slab.
 *
 * - EARTHWORKS on the field's far edges (eras/layout.ts FIELD_BANK keeps that ground free of beds): eras 2-6 dig an
 *   open-cast pit, three terraced benches along its gate-side edge and a haul ramp down its hand-node edge, in the
 *   era's own rock (fieldstone, rust earth, plum shale, taconite red, copper stone); era 7 stands a row of oil derricks
 *   on a gravel strip; era 8 a two-step sand terrace with white kerbs; era 9 a concrete retaining wall striped in
 *   hazard yellow; era 10 a ring of rim rocks round its crater, tallest at the back. Everything tall stands on the
 *   camera's far side of the field, so nothing hides the beds, a pad or the hand node (tests/plotPlaces.test.ts).
 * - Two WORKING PROPS per era, moving slowly all the time: a crane swinging its load over the pit, an ore cart
 *   shuttling along the top bench, a headframe wheel turning (era 3), a flare flickering (era 7) and scanner drones
 *   drifting over the dunes, the pits and the crater (eras 8-10). Each is one small mesh (plus its glow) that moves as a
 *   whole; the fixed parts (masts, rails, frames) go into the field's static batch.
 * - Ground wear: a trodden track from the hand node's pile toward the yard (where the gatherers walk) and cart ruts
 *   from the ramp's foot to the node, flat on the ground.
 *
 * Pure parts (fieldWorkSolids) feed the camera-shadow tests; buildFieldWorks draws and returns the movers and the
 * collider rects (benches and ramps are solid ground; the movers are out of reach on top of them or in the air).
 */
import * as THREE from 'three';
import type { Rect } from '../../config';
import { FIELD_BANK, regionLayout, type PlotPlaces } from '../../eras/layout';
import { Batch } from '../../render/batch';
import { geo } from '../../render/materials';
import { mixHex, palette, SNOW } from '../../render/palette';
import type { Rng } from './common';

type Earth = 'benches' | 'derricks' | 'terrace' | 'wall' | 'rim';
type Prop = 'crane' | 'cart' | 'wheel' | 'flare' | 'drone';

interface WorksStyle {
  earth: Earth;
  /** Bench / terrace colour (the riser; treads are a little lighter, snow on top). */
  rock: number;
  props: [Prop, Prop];
}

const STYLE: Readonly<Record<number, WorksStyle>> = {
  2: { earth: 'benches', rock: 0xaca69c, props: ['crane', 'cart'] },
  3: { earth: 'benches', rock: 0x96664e, props: ['wheel', 'cart'] },
  4: { earth: 'benches', rock: 0x5e5560, props: ['crane', 'cart'] },
  5: { earth: 'benches', rock: 0x9a4a36, props: ['crane', 'cart'] },
  6: { earth: 'benches', rock: 0x9c8f7c, props: ['crane', 'cart'] },
  7: { earth: 'derricks', rock: 0xb9b3a8, props: ['crane', 'flare'] },
  8: { earth: 'terrace', rock: 0xdcc28e, props: ['drone', 'cart'] },
  9: { earth: 'wall', rock: 0xd2d8d9, props: ['drone', 'cart'] },
  10: { earth: 'rim', rock: 0xa89cc0, props: ['drone', 'drone'] },
};

/** Bench heights (back to front, m) and tread depth for eras 2-6; the top bench is where the cart runs. */
const BENCH_H = [1.2, 0.8, 0.4];
const TREAD = 0.9;
/** Era 8 terrace and era 9 wall steps (back to front, m). */
const TERRACE_H = [0.9, 0.45];
const WALL_H = [1.0, 0.5];
/** Where the era 9 wall starts inside its hazard fence (m). */
const WALL_IN = 0.5;
/** Crane mast tops out here (m), like the huts, so it never hides more than a hut would. */
const CRANE_TOP = 4.4;
const DERRICK_H = 4.4;

export interface FieldWorkSolid {
  what: string;
  r: Rect;
  h: number;
}

const box = (x: number, z: number, hx: number, hz: number): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });

/** The top of the earthworks the props stand on (y, m) and its depth band. */
function topOf(st: WorksStyle): number {
  return st.earth === 'benches' ? BENCH_H[0]! : st.earth === 'terrace' ? TERRACE_H[0]! : st.earth === 'wall' ? WALL_H[0]! : 0;
}

/** Where era n's fixed pieces stand (pure). */
function plan(n: number, P: PlotPlaces): { st: WorksStyle; F: Rect; back: number; side: number; crane: { x: number; z: number } | null; rail: { x0: number; x1: number; z: number } | null; derricks: number[]; flare: { x: number; z: number } | null; wheel: { x: number; z: number } | null } {
  const st = STYLE[n]!;
  const F = P.field;
  const { back, side } = FIELD_BANK[n] ?? { back: 0, side: 0 };
  const z0 = st.earth === 'wall' ? F.minZ + WALL_IN : F.minZ;
  const topZ = z0 + TREAD / 2;
  const corner = { x: F.minX + 1.1, z: topZ };
  const crane = st.props.includes('crane') ? (st.earth === 'derricks' ? { x: F.minX + 1.3, z: F.minZ + 1.2 } : corner) : null;
  const wheel = st.props.includes('wheel') ? corner : null;
  const rail = st.props.includes('cart') ? { x0: F.minX + (crane || wheel ? 2.8 : 1.2), x1: F.maxX - 1.0, z: topZ } : null;
  const derricks: number[] = [];
  let flare: { x: number; z: number } | null = null;
  if (st.earth === 'derricks') {
    const a = F.minX + 7.2; // clear of the crane's swing at the west end
    const b = F.maxX - 3.6;
    const k = Math.max(2, Math.min(4, Math.floor((b - a) / 6) + 1));
    for (let i = 0; i < k; i++) derricks.push(a + ((b - a) * i) / (k - 1));
    flare = { x: F.maxX - 1.0, z: F.minZ + 1.0 };
  }
  return { st, F, back, side, crane, rail, derricks, flare, wheel };
}

/** Every solid the earthworks and fixed props add (pure; tests/plotPlaces.test.ts checks their camera shadows). */
export function fieldWorkSolids(n: number, P: PlotPlaces): FieldWorkSolid[] {
  const p = plan(n, P);
  const { F, st } = p;
  const out: FieldWorkSolid[] = [];
  if (st.earth === 'benches') {
    out.push({ what: 'pit benches', r: { minX: F.minX, maxX: F.maxX - 0.3, minZ: F.minZ, maxZ: F.minZ + p.back }, h: BENCH_H[0]! });
    out.push({ what: 'haul ramp', r: { minX: F.minX, maxX: F.minX + p.side, minZ: F.minZ + p.back, maxZ: F.maxZ - 0.4 }, h: BENCH_H[0]! });
  } else if (st.earth === 'terrace') {
    out.push({ what: 'sand terrace', r: { minX: F.minX, maxX: F.maxX - 0.3, minZ: F.minZ, maxZ: F.minZ + TREAD * 2 }, h: TERRACE_H[0]! });
  } else if (st.earth === 'wall') {
    out.push({ what: 'retaining wall', r: { minX: F.minX + WALL_IN, maxX: F.maxX - WALL_IN, minZ: F.minZ + WALL_IN, maxZ: F.minZ + WALL_IN + TREAD * 2 }, h: WALL_H[0]! });
  } else if (st.earth === 'derricks') {
    for (const x of p.derricks) out.push({ what: 'derrick', r: box(x, F.minZ + 1.3, 1.0, 1.0), h: DERRICK_H });
  }
  if (p.flare) out.push({ what: 'flare', r: box(p.flare.x, p.flare.z, 0.35, 0.35), h: DERRICK_H });
  if (p.crane) out.push({ what: 'crane', r: box(p.crane.x, p.crane.z, 0.6, 0.6), h: CRANE_TOP });
  if (p.wheel) out.push({ what: 'headframe', r: box(p.wheel.x, p.wheel.z, 0.95, 0.95), h: CRANE_TOP });
  if (p.rail) out.push({ what: 'ore cart', r: { minX: p.rail.x0 - 0.6, maxX: p.rail.x1 + 0.6, minZ: p.rail.z - 0.45, maxZ: p.rail.z + 0.45 }, h: topOf(st) + 1.0 });
  return out;
}

/** Something in the field that moves; `update` takes the time since the field was built (s). */
export interface FieldMover {
  readonly object: THREE.Object3D;
  update(t: number): void;
}

export interface FieldWorks {
  movers: FieldMover[];
  /** Solid ground the player walks round (benches, the ramp's high end, the terrace, the wall, derrick feet). */
  colliders: Rect[];
}

const shadeHex = (c: number, k: number): number => {
  const col = new THREE.Color(c);
  col.r = Math.min(1, col.r * k);
  col.g = Math.min(1, col.g * k);
  col.b = Math.min(1, col.b * k);
  return col.getHex();
};

/** One step of rock along X, broken into chunks of a slightly different height and depth so the edge never reads ruled. */
function rockStep(body: Batch, rock: number, x0: number, x1: number, z0: number, depth: number, h: number, rng: Rng, chunky: boolean): void {
  let x = x0;
  while (x < x1 - 0.05) {
    const w = Math.min(x1 - x, chunky ? rng.range(1.6, 3.2) : x1 - x);
    const dh = chunky ? rng.range(-0.07, 0.07) : 0;
    const dd = chunky ? rng.range(-0.08, 0.06) : 0;
    const k = chunky ? rng.range(0.92, 1.06) : 1;
    body.add(geo.boxBase(w + 0.02, h + dh, depth + dd), shadeHex(rock, k), x + w / 2, 0, z0 + (depth + dd) / 2);
    // snow on the tread, a little back from the lip
    body.add(geo.box(w - 0.1, 0.05, (depth + dd) * 0.42), mixHex(SNOW, rock, 0.12), x + w / 2, h + dh + 0.02, z0 + (depth + dd) * 0.24);
    if (chunky) {
      // a block joint or two on the riser (the face the camera sees)
      for (let j = 0; j < 2; j++) if (rng.next() < 0.6) body.add(geo.box(0.05, h * 0.8, 0.03), shadeHex(rock, 0.72), x + rng.range(0.3, Math.max(0.35, w - 0.3)), (h + dh) * 0.45, z0 + depth + dd + 0.005);
      // a loose stone on the tread
      if (rng.next() < 0.45) body.add(geo.dodecahedron(rng.range(0.13, 0.24)), shadeHex(rock, rng.range(0.85, 1.1)), x + rng.range(0.2, w - 0.2), h + dh + 0.08, z0 + depth * rng.range(0.55, 0.8), { ry: rng.range(0, 6) });
    }
    x += w;
  }
}

function buildEarth(body: Batch, glow: Batch, n: number, p: ReturnType<typeof plan>, rng: Rng): Rect[] {
  const { F, st } = p;
  const cols: Rect[] = [];
  const pal = palette(n);
  switch (st.earth) {
    case 'benches': {
      // the pit floor: dug earth a shade darker than the snow round it
      body.add(geo.box(F.maxX - F.minX - p.side - 0.2, 0.012, F.maxZ - F.minZ - p.back - 0.2), mixHex(st.rock, SNOW, 0.62), (F.minX + p.side + F.maxX) / 2, 0.014, (F.minZ + p.back + F.maxZ) / 2);
      BENCH_H.forEach((h, i) => rockStep(body, st.rock, i === 0 ? F.minX : F.minX + p.side, F.maxX - 0.3, F.minZ + i * TREAD, TREAD + (i < BENCH_H.length - 1 ? 0.02 : 0), h, rng, true));
      // the landing at the ramp's head
      body.add(geo.boxBase(p.side, BENCH_H[0]!, p.back - TREAD), shadeHex(st.rock, 1.02), F.minX + p.side / 2, 0, F.minZ + TREAD + (p.back - TREAD) / 2);
      body.add(geo.box(p.side - 0.1, 0.05, p.back - TREAD - 0.1), SNOW, F.minX + p.side / 2, BENCH_H[0]! + 0.02, F.minZ + TREAD + (p.back - TREAD) / 2);
      // the haul ramp down the node side: a wedge from the top bench to the pit floor, kerb stones along its edge
      const za = F.minZ + p.back;
      const zb = F.maxZ - 0.4;
      const run = zb - za;
      const a = Math.atan2(BENCH_H[0]!, run);
      const hyp = Math.hypot(run, BENCH_H[0]!);
      const T = 1.6;
      body.add(geo.box(p.side, T, hyp), shadeHex(st.rock, 1.08), F.minX + p.side / 2, BENCH_H[0]! / 2 - (T / 2) * Math.cos(a), (za + zb) / 2 - (T / 2) * Math.sin(a), { rx: a });
      body.add(geo.box(p.side * 0.55, 0.012, hyp), mixHex(st.rock, SNOW, 0.4), F.minX + p.side * 0.45, BENCH_H[0]! / 2 + 0.01, (za + zb) / 2, { rx: a });
      for (let z = za + 0.4; z < zb - 0.3; z += rng.range(0.8, 1.3)) {
        const y = BENCH_H[0]! * (1 - (z - za) / run);
        body.add(geo.dodecahedron(rng.range(0.16, 0.26)), shadeHex(st.rock, rng.range(0.8, 0.95)), F.minX + p.side - 0.15, y + 0.06, z, { ry: rng.range(0, 6), sy: 0.8 });
      }
      cols.push({ minX: F.minX, maxX: F.maxX - 0.3, minZ: F.minZ, maxZ: F.minZ + p.back });
      // the ramp is solid where it stands higher than a step (its foot can be walked onto)
      cols.push({ minX: F.minX, maxX: F.minX + p.side, minZ: za, maxZ: za + run * 0.75 });
      break;
    }
    case 'terrace': {
      TERRACE_H.forEach((h, i) => {
        rockStep(body, st.rock, F.minX, F.maxX - 0.3, F.minZ + i * TREAD, TREAD + 0.02, h, rng, false);
        // a white clean-room kerb along each lip, and soft sand swells on the tread
        body.add(geo.box(F.maxX - 0.3 - F.minX, 0.08, 0.14), 0xf3f4f6, (F.minX + F.maxX - 0.3) / 2, h + 0.04, F.minZ + (i + 1) * TREAD - 0.05);
        for (let x = F.minX + 1; x < F.maxX - 1.2; x += rng.range(2.2, 3.6)) body.add(geo.sphere(1, 12, 6), shadeHex(st.rock, 1.04), x, h, F.minZ + i * TREAD + TREAD * 0.4, { sx: rng.range(0.7, 1.2), sy: rng.range(0.12, 0.22), sz: 0.3 });
      });
      cols.push({ minX: F.minX, maxX: F.maxX - 0.3, minZ: F.minZ, maxZ: F.minZ + TREAD * 2 });
      break;
    }
    case 'wall': {
      const x0 = F.minX + WALL_IN;
      const x1 = F.maxX - WALL_IN;
      WALL_H.forEach((h, i) => {
        const z0 = F.minZ + WALL_IN + i * TREAD;
        rockStep(body, st.rock, x0, x1, z0, TREAD + 0.02, h, rng, false);
        // hazard stripes along the lip: yellow and charcoal blocks
        for (let x = x0, k = 0; x < x1 - 0.1; x += 0.8, k++) {
          const w = Math.min(0.8, x1 - x);
          body.add(geo.box(w, 0.12, 0.03), k % 2 ? 0xe8c547 : 0x45484a, x + w / 2, h - 0.08, z0 + TREAD + 0.02);
        }
      });
      // a mint drain grate at the wall's foot, lit at night
      for (let x = x0 + 1.5; x < x1 - 1; x += 4) glow.add(geo.box(0.9, 0.02, 0.18), pal.glow, x, 0.03, F.minZ + WALL_IN + TREAD * 2 + 0.25);
      cols.push({ minX: x0, maxX: x1, minZ: F.minZ + WALL_IN, maxZ: F.minZ + WALL_IN + TREAD * 2 });
      break;
    }
    case 'derricks': {
      // a gravel strip along the back with a derrick skyline on it
      body.add(geo.box(F.maxX - F.minX - 0.4, 0.012, p.back - 0.2), mixHex(st.rock, SNOW, 0.3), (F.minX + F.maxX) / 2, 0.014, F.minZ + p.back / 2);
      const T7 = { honey: 0xd99b26, cream: 0xf0e4cb, red: 0xc44536, steel: 0x8a8580 };
      for (const x of p.derricks) {
        const z = F.minZ + 1.3;
        body.add(geo.boxBase(1.9, 0.2, 1.9), 0xb9b3a8, x, 0, z);
        // four legs leaning in to the crown, cross braces every metre, a crown block and a little shack at the foot
        const half = 0.8;
        const top = 0.22;
        const lean = Math.atan2(half - top, DERRICK_H);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          body.add(geo.box(0.09, DERRICK_H + 0.1, 0.09), T7.honey, x + sx * (half + top) / 2, DERRICK_H / 2, z + sz * (half + top) / 2, { rz: sx * lean, rx: -sz * lean });
        }
        for (let y = 0.9; y < DERRICK_H - 0.4; y += 1.0) {
          const w = 2 * (half - (half - top) * (y / DERRICK_H));
          body.add(geo.box(w, 0.06, 0.06), T7.cream, x, y, z + w / 2).add(geo.box(0.06, 0.06, w), T7.cream, x + w / 2, y, z);
          body.add(geo.box(w, 0.06, 0.06), T7.cream, x, y, z - w / 2).add(geo.box(0.06, 0.06, w), T7.cream, x - w / 2, y, z);
        }
        body.add(geo.boxBase(0.6, 0.35, 0.6), T7.red, x, DERRICK_H, z);
        body.add(geo.box(0.66, 0.06, 0.66), SNOW, x, DERRICK_H + 0.38, z);
        body.add(geo.boxBase(0.9, 0.8, 0.7), T7.cream, x + 0.2, 0.2, z + 0.75);
        body.add(geo.box(1.0, 0.08, 0.8), T7.red, x + 0.2, 1.04, z + 0.75);
        glow.add(geo.sphere(0.07, 6, 4), 0xff5a4a, x, DERRICK_H + 0.48, z);
        cols.push(box(x, z, 0.95, 0.95));
      }
      break;
    }
    case 'rim': {
      // rim rocks round the crater, tallest on its far side so the bowl reads as dug in
      const cx = (F.minX + F.maxX) / 2;
      const cz = (F.minZ + F.maxZ) / 2;
      const R = Math.min(F.maxX - F.minX, F.maxZ - F.minZ) / 2 - 1.8;
      const count = Math.round((Math.PI * 2 * R) / 1.3);
      for (let i = 0; i < count; i++) {
        const th = (i / count) * Math.PI * 2 + rng.range(-0.04, 0.04);
        const far = Math.max(0, -(Math.cos(th) + Math.sin(th)) / Math.SQRT2);
        const r = R + rng.range(-0.15, 0.25);
        const s = (0.35 + 0.45 * far) * rng.range(0.8, 1.2);
        const x = cx + Math.cos(th) * r;
        const z = cz + Math.sin(th) * r;
        body.add(geo.dodecahedron(1), shadeHex(st.rock, rng.range(0.88, 1.08)), x, s * 0.35, z, { sx: s * 1.3, sy: s * (0.8 + far * 0.7), sz: s * 1.1, ry: th });
        if (far > 0.3) body.add(geo.sphere(1, 8, 4), SNOW, x, s * 0.35 + s * (0.8 + far * 0.7) * 0.8, z, { sx: s * 0.8, sy: s * 0.18, sz: s * 0.7 });
      }
      break;
    }
  }
  return cols;
}

// ---- the working props ------------------------------------------------------------------------------------------

function crane(body: Batch, n: number, x: number, z: number, y0: number, ore: number, glowMat: THREE.Material): FieldMover {
  const pal = palette(n);
  const timber = n <= 3;
  const mastC = timber ? 0x7a5236 : pal.trim;
  const boomC = timber ? 0x8a5a3b : pal.accent;
  const mastH = CRANE_TOP - y0 - 0.2;
  body.add(geo.boxBase(1.0, 0.25, 1.0), timber ? 0x6a4a32 : pal.body, x, y0, z);
  body.add(geo.cylinder(0.12, 0.16, mastH, 8), mastC, x, y0 + 0.25 + mastH / 2, z);
  if (!timber) for (let y = y0 + 0.8; y < y0 + mastH; y += 0.8) body.add(geo.torus(0.15, 0.025, 4, 10), boomC, x, y, z, { rx: Math.PI / 2 });
  // the moving part: boom, counterweight, the hook line and its load, pivoting at the mast top
  const b = new Batch();
  b.add(geo.box(0.2, 0.2, 4.4), boomC, 0, 0.1, 1.9);
  b.add(geo.box(0.06, 0.06, 4.0), mastC, 0, 0.42, 1.8, { rx: -0.06 });
  b.add(geo.box(0.5, 0.42, 0.7), timber ? 0x6f6c6b : pal.body, 0, 0.05, -0.65);
  b.add(geo.box(0.04, 1.7, 0.04), 0x3b3a3c, 0, -0.85, 3.9);
  b.add(geo.cylinder(0.32, 0.24, 0.36, 10), timber ? 0x6a4a32 : pal.trim, 0, -1.85, 3.9);
  b.add(geo.sphere(0.3, 8, 5), ore, 0, -1.7, 3.9, { sy: 0.55 });
  b.add(geo.box(0.22, 0.05, 4.2), SNOW, 0, 0.23, 1.9);
  const g = new THREE.Group();
  g.position.set(x, y0 + 0.25 + mastH, z);
  const m = b.mesh({ cast: true, receive: false });
  g.add(m);
  const lamp = new Batch().add(geo.sphere(0.07, 6, 4), 0xff5a4a, 0, 0.3, 4.0);
  g.add(lamp.mesh({ cast: false, receive: false, material: glowMat }));
  // swing between pointing into the pit (+Z) and across it (+X), slow, easing at each end
  const yaw0 = Math.PI * 0.25;
  return { object: g, update: (t) => void (g.rotation.y = yaw0 + 0.62 * Math.sin(t * 0.26)) };
}

function cart(body: Batch, n: number, x0: number, x1: number, z: number, y0: number, ore: number): FieldMover {
  const pal = palette(n);
  const late = n >= 8;
  const len = x1 - x0;
  // rails on sleepers along the top bench
  for (const dz of [-0.3, 0.3]) body.add(geo.box(len, 0.05, 0.06), late ? 0xb8bec4 : 0x6f6c6b, (x0 + x1) / 2, y0 + 0.07, z + dz);
  for (let x = x0; x <= x1 + 0.01; x += 0.7) body.add(geo.box(0.14, 0.05, 0.86), late ? 0xd9dade : 0x6a4a32, x, y0 + 0.03, z);
  body.add(geo.boxBase(0.18, 0.4, 0.9), late ? pal.accent : 0x8a5a3b, x1 + 0.3, y0, z); // a buffer stop
  const b = new Batch();
  const tub = late ? pal.body : n <= 3 ? 0x7a5236 : pal.trim;
  b.add(geo.boxBase(0.95, 0.42, 0.68), tub, 0, 0.16, 0);
  b.add(geo.box(1.05, 0.07, 0.78), late ? pal.accent : shadeHex(tub, 1.25), 0, 0.6, 0);
  for (const [wx, wz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) b.add(geo.cylinder(0.11, 0.11, 0.06, 10), 0x3b3a3c, wx, 0.13, wz, { rx: Math.PI / 2 });
  const load = new Batch().add(geo.sphere(0.42, 10, 6), ore, 0, 0.58, 0, { sx: 1.05, sy: 0.5, sz: 0.75 }).add(geo.dodecahedron(0.14), shadeHex(ore, 1.15), 0.18, 0.78, 0.05);
  const g = new THREE.Group();
  g.add(b.mesh({ cast: true, receive: false }));
  const heap = load.mesh({ cast: false, receive: false });
  g.add(heap);
  g.position.set(x1, y0 + 0.05, z);
  // full from the far end to the ramp, empty back; a pause at each end to load and tip
  const speed = 1.1;
  const travel = len / speed;
  const rest = 3;
  const cycle = 2 * (travel + rest);
  const ease = (u: number): number => u * u * (3 - 2 * u);
  return {
    object: g,
    update: (t) => {
      const c = t % cycle;
      let x: number;
      if (c < rest) x = x1;
      else if (c < rest + travel) x = x1 - len * ease((c - rest) / travel);
      else if (c < 2 * rest + travel) x = x0;
      else x = x0 + len * ease((c - 2 * rest - travel) / travel);
      g.position.x = x;
      heap.visible = c < rest + travel + rest * 0.5;
    },
  };
}

function wheel(body: Batch, x: number, z: number, y0: number): FieldMover {
  // a timber headframe: four braced posts, a platform and a winding wheel turning at the top
  const H = CRANE_TOP - y0 - 0.5;
  const yaw = Math.PI / 4;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // four posts on the wheel's plane (turned to face the camera), braced halfway up
  for (const a of [-0.95, 0.95]) for (const b of [-0.3, 0.3]) body.add(geo.box(0.12, H, 0.12), 0x6a4a32, x + a * c + b * s, y0 + H / 2, z - a * s + b * c);
  for (const b of [-0.3, 0.3]) body.add(geo.box(2.0, 0.08, 0.08), 0x7a5236, x + b * s, y0 + H * 0.5, z + b * c, { ry: yaw });
  body.add(geo.box(2.1, 0.1, 0.7), 0x8a5a3b, x, y0 + H, z, { ry: yaw });
  const b = new Batch();
  b.add(geo.torus(0.75, 0.06, 6, 24), 0x5d6268, 0, 0, 0);
  for (let k = 0; k < 6; k++) b.add(geo.box(0.05, 1.45, 0.05), 0x5d6268, 0, 0, 0, { rz: (k / 6) * Math.PI });
  b.add(geo.cylinder(0.12, 0.12, 0.2, 10), 0xb0704e, 0, 0, 0, { rx: Math.PI / 2 });
  const pivot = new THREE.Group();
  pivot.position.set(x, y0 + H + 0.8, z);
  pivot.rotation.y = yaw;
  const m = b.mesh({ cast: true, receive: false });
  pivot.add(m);
  return { object: pivot, update: (t) => void (m.rotation.z = t * 0.9) };
}

function flare(body: Batch, glowMat: THREE.Material, x: number, z: number): FieldMover {
  body.add(geo.boxBase(0.9, 0.2, 0.9), 0xb9b3a8, x, 0, z);
  body.add(geo.cylinder(0.14, 0.2, DERRICK_H - 0.3, 10), 0xf0e4cb, x, (DERRICK_H - 0.3) / 2 + 0.2, z);
  for (const y of [1.2, 2.4, 3.6]) body.add(geo.cylinder(0.17, 0.17, 0.22, 10), 0xc44536, x, y, z);
  const f = new Batch();
  f.add(geo.cone(0.22, 0.75, 10), 0xffa04a, 0, 0.37, 0);
  f.add(geo.cone(0.12, 0.45, 8), 0xfff0a0, 0, 0.25, 0.02);
  const flame = f.mesh({ cast: false, receive: false, material: glowMat });
  flame.position.set(x, DERRICK_H - 0.08, z);
  return {
    object: flame,
    update: (t) => {
      flame.scale.set(1 + 0.08 * Math.sin(t * 9.1), 1 + 0.22 * Math.sin(t * 6.3) + 0.12 * Math.sin(t * 13.7), 1 + 0.08 * Math.sin(t * 7.7));
    },
  };
}

function drone(n: number, glowMat: THREE.Material, A: Rect, y: number, phase: number, ring: number | null): FieldMover {
  const pal = palette(n);
  const b = new Batch();
  b.add(geo.sphere(0.3, 12, 8), pal.body, 0, 0, 0, { sy: 0.55 });
  for (const r of [Math.PI / 4, -Math.PI / 4]) b.add(geo.box(1.1, 0.05, 0.07), pal.trim, 0, 0.04, 0, { ry: r });
  for (const [x, z] of [[-0.39, -0.39], [0.39, -0.39], [-0.39, 0.39], [0.39, 0.39]] as const) b.add(geo.cylinder(0.2, 0.2, 0.02, 12), 0xd8dde2, x, 0.1, z);
  const g = new THREE.Group();
  g.add(b.mesh({ cast: true, receive: false }));
  const lights = new Batch().add(geo.sphere(0.08, 8, 6), pal.glow, 0, -0.14, 0.18).add(geo.cylinder(0.02, 0.32, 0.9, 10), pal.glow, 0, -0.62, 0);
  g.add(lights.mesh({ cast: false, receive: false, material: glowMat }));
  const cx = ring !== null ? (A.minX + A.maxX) / 2 : 0;
  const cz = ring !== null ? (A.minZ + A.maxZ) / 2 : 0;
  const ax = (A.maxX - A.minX) / 2 - 1.5;
  const az = (A.maxZ - A.minZ) / 2 - 1.5;
  let px = 0;
  let pz = 0;
  return {
    object: g,
    update: (t) => {
      let x: number;
      let z: number;
      if (ring !== null) {
        const th = t * 0.12 + phase;
        x = cx + Math.cos(th) * ring;
        z = cz + Math.sin(th) * ring;
      } else {
        const w = 0.07;
        x = (A.minX + A.maxX) / 2 + ax * Math.sin(t * w + phase);
        z = (A.minZ + A.maxZ) / 2 + az * Math.sin(t * w * 1.7 + phase * 2);
      }
      g.position.set(x, y + Math.sin(t * 1.9 + phase) * 0.12, z);
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz > 1e-6) g.rotation.y = Math.atan2(dx, dz);
      px = x;
      pz = z;
    },
  };
}

/** Ground wear: the gatherers' trodden track from the node pile toward the yard, and cart ruts from the ramp's foot. */
function wear(body: Batch, n: number, P: PlotPlaces, p: ReturnType<typeof plan>, rng: Rng): void {
  const L = regionLayout(n);
  const H = L.zones.harvest;
  const trod = mixHex(SNOW, palette(n).ground, 0.32);
  // the pile sits 2.6 m beside the node (eras/HandNode.ts PILE_AT); the gatherers walk from it toward the gate side
  const px = L.node.x - 2.6 * Math.cos(L.node.yaw);
  const zTo = L.inward > 0 ? H.minZ + 0.4 : H.maxZ - 0.4;
  const z0 = L.node.z - L.inward * 1.6;
  for (let z = z0, k = 0; L.inward > 0 ? z > zTo : z < zTo; z -= L.inward * 0.55, k++) {
    body.add(geo.circleGround(1, 10), trod, px + Math.sin(k * 0.9) * 0.18 + rng.range(-0.1, 0.1), 0.016 + (k % 6) * 0.0004, z, { sx: rng.range(0.45, 0.6), sz: 0.4 });
  }
  if (p.st.earth !== 'benches') return;
  // two cart ruts from the ramp's foot west to the node's patch
  const zf = P.field.maxZ - 1.0;
  const xa = L.node.x + 6.2;
  const xb = P.field.minX + p.side * 0.5;
  if (xb - xa < 0.5) return;
  for (const dz of [-0.32, 0.32]) body.add(geo.box(xb - xa, 0.006, 0.12), mixHex(trod, p.st.rock, 0.3), (xa + xb) / 2, 0.018, zf + dz);
}

/** Build era n's field earthworks and working props (statics into `body` / `glow`, movers returned). */
export function buildFieldWorks(body: Batch, glow: Batch, n: number, P: PlotPlaces, rng: Rng, ore: number, glowMat: THREE.Material): FieldWorks {
  const p = plan(n, P);
  if (!STYLE[n]) return { movers: [], colliders: [] };
  const colliders = buildEarth(body, glow, n, p, rng);
  wear(body, n, P, p, rng);
  const movers: FieldMover[] = [];
  const top = topOf(p.st);
  if (p.crane) movers.push(crane(body, n, p.crane.x, p.crane.z, p.st.earth === 'derricks' ? 0 : top, ore, glowMat));
  if (p.wheel) movers.push(wheel(body, p.wheel.x, p.wheel.z, top));
  if (p.rail) movers.push(cart(body, n, p.rail.x0, p.rail.x1, p.rail.z, top, ore));
  if (p.flare) movers.push(flare(body, glowMat, p.flare.x, p.flare.z));
  const drones = p.st.props.filter((k) => k === 'drone').length;
  if (drones > 0) {
    const F = P.field;
    const A: Rect = { minX: F.minX + p.side, maxX: F.maxX, minZ: F.minZ + p.back, maxZ: F.maxZ };
    if (p.st.earth === 'rim') {
      const R = Math.min(F.maxX - F.minX, F.maxZ - F.minZ) / 2 - 1.8;
      movers.push(drone(n, glowMat, A, 3.4, 0, R * 0.35));
      movers.push(drone(n, glowMat, A, 4.0, Math.PI, R * 0.8));
    } else for (let i = 0; i < drones; i++) movers.push(drone(n, glowMat, A, 3.4 + i * 0.5, i * 2.1, null));
  }
  return { movers, colliders };
}
