/**
 * [T4 — wave 9] Props of the Market Town square, appended to Batches (statics = toon vertex colours, glow = the
 * emissive night material, bulbs = unlit fairy lights). Local frame of every prop: floor-centre origin, FRONT = +Z;
 * `Placer` turns that into world space for a yaw (0 = +Z, same convention as town/spots.ts).
 */
import * as THREE from 'three';
import { PALETTE } from '../../config';
import { Batch, type PartOpts } from './common';
import { BULB_COLORS, WARM_BULBS } from './festive';

const SNOW = PALETTE.snow;
const WOOD = PALETTE.fence;
const WOOD_DARK = PALETTE.fenceDark;
const IRON = 0x30353d;

const _m = new THREE.Matrix4();
const _yaw = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Adds parts to a Batch in a prop's local frame (yaw about Y, then translated to (cx, cz)). */
export class Placer {
  constructor(
    readonly batch: Batch,
    readonly cx: number,
    readonly cz: number,
    readonly yaw: number,
  ) {}

  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, lx: number, ly: number, lz: number, o?: PartOpts): this {
    _e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(lx, ly, lz);
    _s.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    _local.compose(_p, _q, _s);
    _yaw.makeRotationY(this.yaw).setPosition(this.cx, 0, this.cz);
    _m.multiplyMatrices(_yaw, _local);
    this.batch.addMatrix(g, color, _m);
    return this;
  }

  /** World position of a local point. */
  world(lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return { x: this.cx + lx * c + lz * s, y: ly, z: this.cz - lx * s + lz * c };
  }
}

// cached primitives -------------------------------------------------------------------------------------------
const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}
export const box = (w: number, h: number, d: number): THREE.BufferGeometry => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cyl = (rt: number, rb: number, h: number, seg = 8): THREE.BufferGeometry =>
  cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
export const sph = (r: number, ws = 8, hs = 6): THREE.BufferGeometry => cached(`s${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const cone = (r: number, h: number, seg = 7): THREE.BufferGeometry => cached(`n${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));

// ---- bench ------------------------------------------------------------------------------------------------------
/** A park bench for two (1.7 m wide), seat facing +Z, with a snowy backrest. */
export function addBench(b: Batch, x: number, z: number, yaw: number): void {
  const p = new Placer(b, x, z, yaw);
  for (const dz of [-0.12, 0.12]) p.add(box(1.7, 0.05, 0.2), WOOD, 0, 0.46, dz);
  for (const [y, dz] of [[0.7, -0.24], [0.86, -0.25]] as const) p.add(box(1.7, 0.11, 0.04), WOOD, 0, y, dz, { rx: -0.18 });
  for (const sx of [-0.78, 0.78]) {
    p.add(box(0.07, 0.46, 0.46), IRON, sx, 0.23, 0);
    p.add(box(0.07, 0.07, 0.34), IRON, sx, 0.63, 0.02);
    p.add(box(0.07, 0.5, 0.07), IRON, sx, 0.72, -0.26, { rx: -0.18 });
  }
  p.add(box(1.62, 0.045, 0.09), SNOW, 0, 0.945, -0.26, { rx: -0.18 });
  p.add(box(1.5, 0.03, 0.16), SNOW, 0, 0.5, 0.0); // a dusting on the seat
}

// ---- stall ------------------------------------------------------------------------------------------------------
export interface StallOpts {
  /** Awning stripe colours. */
  awning: [number, number];
  /** 0 = produce and bread, 1 = winter crafts. */
  goods: 0 | 1;
}

/** A striped market stall (1.8 × 1.0 m), counter on the +Z side. Lights/lanterns go to `glow` and `bulbs`. */
export function addStall(b: Batch, glow: Batch, bulbs: Batch, x: number, z: number, yaw: number, o: StallOpts): void {
  const p = new Placer(b, x, z, yaw);
  // counter with a lit-wood top and a painted front
  p.add(box(1.8, 0.82, 0.55), WOOD, 0, 0.41, 0.2);
  p.add(box(1.92, 0.07, 0.68), 0xe3b278, 0, 0.855, 0.2);
  p.add(box(1.5, 0.5, 0.03), o.awning[0], 0, 0.42, 0.485);
  // corner posts (front lower, back taller) and a back rail
  for (const sx of [-0.88, 0.88]) {
    p.add(box(0.08, 1.95, 0.08), WOOD_DARK, sx, 0.975, 0.5);
    p.add(box(0.08, 2.25, 0.08), WOOD_DARK, sx, 1.125, -0.45);
  }
  p.add(box(1.8, 0.07, 0.07), WOOD_DARK, 0, 1.55, -0.45);
  // sloping striped canopy
  const tilt = 0.27;
  const strips = 8;
  const w = 1.96 / strips;
  for (let i = 0; i < strips; i++) {
    const sx = -0.98 + w * (i + 0.5);
    const col = o.awning[i % 2]!;
    p.add(box(w, 0.05, 1.38), col, sx, 2.08, 0.04, { rx: tilt });
    // scalloped front edge
    p.add(cone(w * 0.55, 0.17, 4), col, sx, 1.84, 0.7, { rx: Math.PI, ry: Math.PI / 4 });
  }
  p.add(box(1.8, 0.05, 0.9), SNOW, 0, 2.145, -0.14, { rx: tilt });
  p.add(sph(0.2, 7, 5), SNOW, -0.5, 2.13, -0.1, { sy: 0.35, sx: 1.6 });
  p.add(sph(0.17, 7, 5), SNOW, 0.45, 2.12, 0.05, { sy: 0.35, sx: 1.5 });
  // chalk board
  p.add(box(0.46, 0.34, 0.03), 0x3a3f48, -0.55, 0.86 + 0.19, 0.55, { rx: -0.35 });
  p.add(box(0.3, 0.025, 0.01), 0xffffff, -0.55, 1.1, 0.565, { rx: -0.35 });
  p.add(box(0.22, 0.025, 0.01), 0xffe9a8, -0.55, 1.03, 0.58, { rx: -0.35 });

  if (o.goods === 0) {
    // crate of apples, loaves in a basket, a pumpkin and jam jars
    p.add(box(0.5, 0.14, 0.36), PALETTE.plank, -0.55, 0.96, 0.15);
    for (let i = 0; i < 7; i++) p.add(sph(0.075, 6, 5), i % 3 ? 0xe2453c : 0xb9302a, -0.7 + (i % 4) * 0.095, 1.06 + (i > 3 ? 0.02 : 0), 0.08 + Math.floor(i / 4) * 0.12);
    p.add(cyl(0.2, 0.16, 0.12, 9), 0xb98a52, 0.15, 0.95, 0.15);
    for (let i = 0; i < 4; i++) p.add(sph(0.075, 7, 5), 0xd49a4c, 0.04 + (i % 2) * 0.17, 1.03, 0.08 + Math.floor(i / 2) * 0.13, { sx: 1.9, sy: 0.95 });
    p.add(sph(0.15, 8, 6), 0xf08a24, 0.62, 1.03, 0.2, { sy: 0.8 });
    p.add(box(0.03, 0.06, 0.03), 0x3d8f4d, 0.62, 1.15, 0.2);
    for (let i = 0; i < 3; i++) {
      p.add(cyl(0.05, 0.05, 0.11, 7), i === 1 ? 0xe2453c : 0x9a3fb0, 0.35 + i * 0.12, 0.95, 0.38);
      p.add(cyl(0.052, 0.052, 0.025, 7), 0xffffff, 0.35 + i * 0.12, 1.02, 0.38);
    }
  } else {
    // scarves and mittens stacked, candles, wrapped presents
    for (let i = 0; i < 4; i++) p.add(box(0.46, 0.055, 0.28), [0xe2453c, 0x3fa7ff, 0x5ee07a, 0xffd34d][i]!, -0.55, 0.92 + i * 0.058, 0.15);
    for (let i = 0; i < 3; i++) {
      p.add(cyl(0.045, 0.045, 0.2 - i * 0.04, 7), 0xfff3d6, -0.05 + i * 0.12, 1.01 - i * 0.02, 0.1);
      glow.add(cone(0.026, 0.07, 5), 0xffc860, p.world(-0.05 + i * 0.12, 0, 0.1).x, 1.14 - i * 0.04, p.world(-0.05 + i * 0.12, 0, 0.1).z);
    }
    p.add(box(0.22, 0.2, 0.22), 0xe2453c, 0.45, 0.99, 0.12);
    p.add(box(0.22, 0.03, 0.04), 0xffd34d, 0.45, 1.095, 0.12);
    p.add(box(0.04, 0.2, 0.22), 0xffd34d, 0.45, 0.99, 0.12);
    p.add(box(0.17, 0.15, 0.17), 0x3fa7ff, 0.68, 0.965, 0.3, { ry: 0.5 });
    p.add(box(0.03, 0.15, 0.17), 0xffffff, 0.68, 0.965, 0.3, { ry: 0.5 });
    // wreath hanging on the front post
    p.add(new THREE.TorusGeometry(0.17, 0.06, 5, 12), 0x2f7a55, 0.88, 1.5, 0.58);
    p.add(box(0.14, 0.09, 0.05), 0xe2453c, 0.88, 1.32, 0.62);
  }
  // hanging lantern on each front post + a string of bulbs along the awning edge
  for (const sx of [-0.88, 0.88]) {
    const pw = p.world(sx, 0, 0.72);
    glow.add(box(0.14, 0.18, 0.14), 0xffd978, pw.x, 1.66, pw.z);
    p.add(box(0.02, 0.18, 0.02), IRON, sx, 1.82, 0.72);
    p.add(box(0.2, 0.04, 0.2), IRON, sx, 1.74, 0.72);
  }
  for (let i = 0; i <= 8; i++) {
    const lx = -0.88 + i * 0.22;
    const pw = p.world(lx, 0, 0.74);
    const sag = Math.sin((i / 8) * Math.PI) * 0.08;
    bulbs.add(cached('bulb', () => new THREE.IcosahedronGeometry(0.05, 0)), WARM_BULBS[i % 3]!, pw.x, 1.72 - sag, pw.z);
  }
}

// ---- snowman ----------------------------------------------------------------------------------------------------
export function addSnowman(b: Batch, x: number, z: number, yaw: number): void {
  const p = new Placer(b, x, z, yaw);
  p.add(sph(0.5, 10, 8), SNOW, 0, 0.44, 0, { sy: 0.9 });
  p.add(sph(0.36, 10, 8), SNOW, 0, 1.12, 0);
  p.add(sph(0.26, 10, 8), SNOW, 0, 1.63, 0);
  // face + buttons
  p.add(cone(0.05, 0.28, 6), 0xf08a24, 0, 1.62, 0.34, { rx: Math.PI / 2 });
  for (const sx of [-0.09, 0.09]) p.add(sph(0.032, 5, 4), 0x2b2f36, sx, 1.7, 0.235);
  for (let i = 0; i < 5; i++) p.add(sph(0.022, 5, 4), 0x2b2f36, (i - 2) * 0.045, 1.55 - Math.abs(i - 2) * 0.012, 0.245);
  for (let i = 0; i < 3; i++) p.add(sph(0.04, 5, 4), 0x2b2f36, 0, 1.2 - i * 0.2, 0.355 + i * 0.07);
  // top hat
  p.add(cyl(0.3, 0.3, 0.04, 10), 0x2b2f36, 0, 1.86, 0);
  p.add(cyl(0.17, 0.19, 0.26, 10), 0x2b2f36, 0, 2.0, 0);
  p.add(cyl(0.192, 0.192, 0.06, 10), 0xe2453c, 0, 1.92, 0);
  // scarf + tail
  p.add(new THREE.TorusGeometry(0.28, 0.07, 5, 12), 0xe2453c, 0, 1.4, 0, { rx: Math.PI / 2 });
  p.add(box(0.12, 0.34, 0.05), 0xe2453c, 0.14, 1.25, 0.26, { rz: 0.1 });
  p.add(box(0.12, 0.06, 0.055), 0xffd34d, 0.14, 1.12, 0.26, { rz: 0.1 });
  // stick arms
  for (const s of [-1, 1]) {
    p.add(box(0.62, 0.035, 0.035), PALETTE.barkDark, s * 0.55, 1.28, 0, { rz: s * 0.5 });
    p.add(box(0.2, 0.025, 0.025), PALETTE.barkDark, s * 0.78, 1.46, 0, { rz: -s * 0.6 });
  }
}

// ---- big fir ----------------------------------------------------------------------------------------------------
export const FIR_HEIGHT = 7.1;
export const FIR_STAR_Y = FIR_HEIGHT + 0.3;

const FIR_TIERS: ReadonlyArray<readonly [number, number, number]> = [
  // radius, height, base y
  [1.9, 1.75, 0.75],
  [1.62, 1.7, 1.7],
  [1.33, 1.65, 2.65],
  [1.04, 1.6, 3.6],
  [0.76, 1.5, 4.5],
  [0.48, 1.4, 5.4],
];

/**
 * The market's big fir: snowy tiers, red / gold baubles (toon) and a spiral of fairy lights (bulbs); a gold star
 * goes to `glow`. Presents sit under it. Returns the world positions of the lights' anchor (top).
 */
export function addFir(b: Batch, glow: Batch, bulbs: Batch, x: number, z: number): void {
  b.add(cyl(0.22, 0.34, 1.2, 8), PALETTE.trunk, x, 0.55, z);
  FIR_TIERS.forEach(([r, h, y0], i) => {
    const col = i % 2 ? PALETTE.pine : PALETTE.pineDark;
    b.add(cone(r, h, 9), col, x, y0 + h / 2, z, { ry: i * 0.45 });
    b.add(cone(r * 0.62, h * 0.5, 9), 0x3a8c63, x, y0 + h * 0.55, z, { ry: i * 0.45 + 0.2 });
    // snow on the tier, a little below the tip, and a rim of snow lumps
    b.add(cone(r * 0.42, h * 0.42, 9), SNOW, x, y0 + h - h * 0.21 + 0.02, z, { ry: i * 0.45 });
    for (let k = 0; k < 4 + i; k++) {
      const a = k * 2.4 + i;
      b.add(sph(0.11, 6, 4), SNOW, x + Math.sin(a) * r * 0.78, y0 + 0.2 + (k % 2) * 0.06, z + Math.cos(a) * r * 0.78, { sy: 0.55, sx: 1.4 });
    }
    // baubles
    for (let k = 0; k < 3 + (i > 3 ? 0 : 2); k++) {
      const a = k * 1.25 + i * 0.9;
      const rr = r * (0.6 - (k % 2) * 0.1);
      b.add(sph(0.095, 6, 5), (i + k) % 3 === 0 ? 0xe2453c : (i + k) % 3 === 1 ? 0xffd34d : 0x3fa7ff, x + Math.sin(a) * rr, y0 + 0.28 + (k % 3) * 0.17, z + Math.cos(a) * rr);
    }
    // fairy lights: a ring just above each tier's lower rim
    const n = 7 + Math.round(r * 7);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.7;
      const rr = r * 0.8;
      bulbs.add(cached('bulb', () => new THREE.IcosahedronGeometry(0.05, 0)), (k + i) % 5 === 0 ? BULB_COLORS[2 + ((k + i) % 3)]! : WARM_BULBS[k % 3]!, x + Math.sin(a) * rr, y0 + 0.22 + 0.22 * Math.sin(a * 2 + i), z + Math.cos(a) * rr);
    }
  });
  // star
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.17 : 0.4;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  const starGeo = cached('star', () => new THREE.ExtrudeGeometry(star, { depth: 0.14, bevelEnabled: false }).translate(0, 0, -0.07));
  glow.add(starGeo, 0xffe27a, x, FIR_STAR_Y, z, { ry: Math.PI / 4 });
  // presents
  const gifts: Array<[number, number, number, number, number, number]> = [
    // dx, dz, size, colour, ribbon, yaw
    [-1.0, 0.7, 0.42, 0xe2453c, 0xffd34d, 0.3],
    [0.9, 0.9, 0.5, 0x3fa7ff, 0xffffff, -0.4],
    [1.15, -0.4, 0.36, 0x5ee07a, 0xe2453c, 0.8],
    [-0.5, 1.2, 0.34, 0xffd34d, 0xe2453c, 1.1],
    [-1.2, -0.5, 0.46, 0xb066ff, 0xffd34d, -0.2],
  ];
  for (const [dx, dz, s, c, rb, ry] of gifts) {
    b.add(box(s, s, s), c, x + dx, s / 2, z + dz, { ry });
    b.add(box(s + 0.02, s + 0.02, s * 0.2), rb, x + dx, s / 2, z + dz, { ry });
    b.add(box(s * 0.2, s + 0.02, s + 0.02), rb, x + dx, s / 2, z + dz, { ry });
    b.add(box(s * 0.3, s * 0.18, s * 0.3), rb, x + dx, s + 0.07, z + dz, { ry: ry + 0.8 });
  }
}

// ---- market arch ------------------------------------------------------------------------------------------------
export const ARCH_H = 3.2;

/** The wooden entrance arch at the corridor mouth: posts + beam + snowy gable roof, lights along the beam. */
export function addArch(b: Batch, bulbs: Batch, x: number, zMin: number, zMax: number): void {
  const zc = (zMin + zMax) / 2;
  const w = zMax - zMin;
  for (const z of [zMin, zMax]) {
    b.add(box(0.3, ARCH_H, 0.3), WOOD_DARK, x, ARCH_H / 2, z);
    b.add(box(0.46, 0.12, 0.46), SNOW, x, ARCH_H + 0.04, z);
    b.add(box(0.4, 0.14, 0.4), 0x8a5a2b, x, 0.07, z);
  }
  b.add(box(0.34, 0.22, w + 0.5), WOOD, x, ARCH_H - 0.12, zc);
  // gable roof over the beam
  for (const s of [-1, 1]) {
    b.add(box(0.5, 0.08, w + 0.7), 0x8a5a2b, x + s * 0.22, ARCH_H + 0.2, zc, { rz: -s * 0.55 });
    b.add(box(0.42, 0.07, w + 0.6), SNOW, x + s * 0.2, ARCH_H + 0.27, zc, { rz: -s * 0.55 });
  }
  // fir garland draped along the BACK of the beam (the sign hangs in front), fairy lights on both sides
  for (let i = 0; i < 9; i++) {
    const z = zMin - 0.15 + ((w + 0.3) * i) / 8;
    const sagY = Math.sin((i / 8) * Math.PI) * 0.12;
    b.add(sph(0.14, 6, 5), i % 2 ? PALETTE.pine : PALETTE.pineDark, x - 0.22, ARCH_H - 0.4 - sagY, z);
    if (i % 3 === 1) b.add(sph(0.06, 5, 4), 0xe2453c, x - 0.3, ARCH_H - 0.47 - sagY, z + 0.05);
    const bulb = cached('bulb', () => new THREE.IcosahedronGeometry(0.05, 0));
    bulbs.add(bulb, WARM_BULBS[i % 3]!, x + 0.2, ARCH_H - 0.3 - sagY, z - 0.1);
    bulbs.add(bulb, WARM_BULBS[(i + 1) % 3]!, x - 0.2, ARCH_H - 0.3 - sagY, z - 0.1);
  }
  // two short chains for the hanging sign (the board itself is a textured mesh in env/town.ts)
  for (const z of [zMin + 0.25, zMax - 0.25]) b.add(box(0.03, 0.3, 0.03), IRON, x + 0.26, ARCH_H - 0.34, z);
}
