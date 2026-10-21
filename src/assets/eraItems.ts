/**
 * [items builder] 0.9.0 era material item models (eras/data.ts MATERIALS). One cached merged mesh per kind (like
 * assets/items.ts town goods): centred on its origin and fitted to MATERIALS[kind].size, so stacks sit exactly
 * stackHeight apart; ONE draw call per item (pure vertex colours on the shared vcMat), no shadow casting (items
 * receive shadows only, like every other item).
 *
 * Cosy toy-diorama style, low poly. Each MaterialShape has one builder below; it works in the item's own box (width
 * along X, height along Y, depth along Z, front = +Z) from the material's colour / accent. Every geometry is finally
 * centred and scaled to the exact size box (fit), so a builder only has to be roughly right.
 */
import * as THREE from 'three';
import type { MaterialKind } from '../core/types';
import { MATERIALS, type MaterialDef, type MaterialShape } from '../eras/data';
import { Batch, vcMat } from '../render/batch';
import { ERA2_4_ITEM_BUILDERS } from './eraItems2to4';
import { ERA5_7_ITEM_BUILDERS } from './eraItems5to7';
import { ERA8_10_ITEM_BUILDERS } from './eraItems8to10';

const HALF_PI = Math.PI / 2;

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (rTop: number, rBottom: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
const ball = (r: number, w = 8, h = 6): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);
/** Low-poly rock (20 faces); detail 0 stays crisp with flat shading. */
const rock = (r: number, detail = 0): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, detail);
const cone = (r: number, h: number, seg = 6): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);

const _c = new THREE.Color();
/** `c` scaled toward black (k < 1) or toward white (k > 1, e.g. 1.3). */
function shade(c: number, k: number): THREE.Color {
  _c.set(c);
  if (k <= 1) return new THREE.Color().copy(_c).multiplyScalar(k);
  return new THREE.Color().copy(_c).lerp(new THREE.Color(0xffffff), Math.min(1, k - 1));
}

type Builder = (b: Batch, m: MaterialDef) => void;

// ---------------------------------------------------------------------------
// Shapes. y0 = the item's bottom, so everything below is written "from the floor up".
// ---------------------------------------------------------------------------

/** Rough-cut stone block: a chunky base, a smaller lighter top slab, a chipped corner and a dark crack. */
const buildBlock: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  b.add(box(w, h * 0.62, d), m.color, 0, y0 + h * 0.31, 0);
  b.add(box(w * 0.82, h * 0.4, d * 0.76), shade(m.color, 1.18), -w * 0.04, y0 + h * 0.62 + h * 0.19, 0, { ry: 0.12 });
  b.add(box(w * 0.26, h * 0.34, d * 0.3), shade(m.color, 0.86), w * 0.36, y0 + h * 0.17, d * 0.22, { ry: 0.4 });
  b.add(box(w * 0.3, h * 0.045, 0.012), m.accent, -w * 0.12, y0 + h * 0.4, d / 2 + 0.002, { rz: -0.35 });
  b.add(box(w * 0.18, h * 0.05, d * 0.2), m.accent, w * 0.1, y0 + h * 0.9, d * 0.1);
};

/** Stacked bricks in running bond with pale mortar between the courses. */
const buildBrick: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const t = (h - 0.03) / 2; // course height
  const g = 0.014; // mortar gap
  b.add(box(w - 0.01, 0.03, d - 0.01), m.accent, 0, y0 + 0.015, 0);
  b.add(box(w - 0.02, 0.012, d - 0.02), m.accent, 0, y0 + 0.03 + t, 0);
  const pw = w / 2 - g;
  const pd = d / 2 - g;
  for (let course = 0; course < 2; course++) {
    const y = y0 + 0.03 + t * course + t / 2;
    for (const z of [-1, 1]) {
      const zz = z * (pd / 2 + g / 2);
      if (course === 0) {
        for (const x of [-1, 1]) b.add(box(pw, t - 0.008, pd), shade(m.color, 0.96 + 0.06 * ((x + z + 2) % 3)), x * (pw / 2 + g / 2), y, zz);
      } else {
        // offset course: half brick, full brick, half brick
        b.add(box(pw / 2, t - 0.008, pd), shade(m.color, 1.08), -(w / 2 - pw / 4), y, zz);
        b.add(box(pw, t - 0.008, pd), shade(m.color, 0.94), 0, y, zz);
        b.add(box(pw / 2, t - 0.008, pd), shade(m.color, 1.08), w / 2 - pw / 4, y, zz);
      }
    }
  }
};

/** Ore nugget: a lumpy dark rock cluster with bright metal veins and glints poking out. */
const buildNugget: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  b.add(rock(0.5), m.color, 0, y0 + h * 0.4, 0, { sx: w * 0.9, sy: h * 0.72, sz: d * 0.9 });
  b.add(rock(0.5), shade(m.color, 0.82), -w * 0.26, y0 + h * 0.26, d * 0.12, { sx: w * 0.5, sy: h * 0.5, sz: d * 0.55, ry: 0.6 });
  b.add(rock(0.5), shade(m.color, 1.1), w * 0.24, y0 + h * 0.3, -d * 0.12, { sx: w * 0.48, sy: h * 0.55, sz: d * 0.5, ry: 1.1 });
  // veins: bright shards and a stripe
  b.add(rock(0.5), m.accent, w * 0.08, y0 + h * 0.76, d * 0.08, { sx: w * 0.26, sy: h * 0.3, sz: d * 0.24, ry: 0.5 });
  b.add(rock(0.5), shade(m.accent, 1.25), -w * 0.22, y0 + h * 0.52, d * 0.34, { sx: w * 0.22, sy: h * 0.22, sz: d * 0.16, ry: 0.3 });
  b.add(box(w * 0.34, 0.035, 0.03), shade(m.accent, 1.2), w * 0.14, y0 + h * 0.52, d * 0.36, { rz: 0.4, ry: -0.2 });
  b.add(rock(0.5), shade(m.accent, 1.35), w * 0.34, y0 + h * 0.5, -d * 0.02, { sx: w * 0.14, sy: h * 0.2, sz: d * 0.14 });
};

/**
 * 0.9.14: native copper: a cluster of smooth rounded nuggets with green patina spots and a bright polished knob, so
 * it never reads as era 3's iron ore (a craggy rock with specks, `nugget`).
 */
const PATINA = 0x5fc9a4;
const buildNative: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const blobs: [number, number, number, number, number][] = [
    [0, 0.42, 0, 0.5, 1],
    [-0.3, 0.3, 0.16, 0.34, 0.9],
    [0.3, 0.32, 0.1, 0.36, 1.08],
    [0.05, 0.3, -0.28, 0.32, 0.95],
    [-0.12, 0.74, 0.08, 0.26, 1.15],
  ];
  for (const [x, y, z, r, k] of blobs) b.add(ball(0.5, 10, 8), shade(m.color, k), x * w, y0 + y * h, z * d, { sx: r * w * 1.3, sy: r * h * 1.5, sz: r * d * 1.3 });
  b.add(ball(0.5, 8, 6), PATINA, -w * 0.3, y0 + h * 0.44, d * 0.3, { sx: w * 0.14, sy: h * 0.14, sz: d * 0.1 });
  b.add(ball(0.5, 8, 6), shade(PATINA, 0.85), w * 0.26, y0 + h * 0.62, -d * 0.04, { sx: w * 0.12, sy: h * 0.12, sz: d * 0.12 });
  b.add(ball(0.5, 8, 6), PATINA, w * 0.3, y0 + h * 0.3, d * 0.3, { sx: w * 0.1, sy: h * 0.1, sz: d * 0.08 });
  b.add(ball(0.5, 8, 6), shade(m.color, 1.5), -w * 0.06, y0 + h * 0.86, d * 0.16, { sx: w * 0.1, sy: h * 0.08, sz: d * 0.1 });
};

/** Ingot: a trapezoid bar with a lighter polished top, a stamped dip and a sheen stripe. */
const buildIngot: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const r = Math.SQRT1_2;
  // square frustum (radii are for the 45°-rotated square: side = r·√2)
  const frustum = (top: number, bot: number, hh: number): THREE.BufferGeometry => cyl(r * top, r * bot, hh, 4).rotateY(Math.PI / 4);
  b.add(frustum(0.84, 1, h), m.color, 0, 0, 0, { sx: w, sz: d });
  b.add(frustum(0.7, 0.8, 0.04 / h), shade(m.color, 1.3), 0, y0 + h - 0.012, 0, { sx: w, sy: h, sz: d });
  b.add(box(w * 0.46, 0.014, d * 0.3), m.accent, 0, y0 + h + 0.004, 0);
  b.add(box(w * 0.7, 0.02, 0.014), shade(m.color, 1.45), 0, y0 + h * 0.62, d * 0.42, { rx: 0.3 });
  b.add(box(w, h * 0.22, d), m.accent, 0, y0 + h * 0.11, 0, { sx: 0.96, sz: 0.96 });
};

/** Coal lump: a heap of black faceted chunks with a few shiny facets. */
const buildLump: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const lumps: [number, number, number, number, number, number][] = [
    [0, 0.32, 0, 0.58, 0.64, 0.6],
    [-0.28, 0.2, 0.18, 0.42, 0.4, 0.4],
    [0.28, 0.22, 0.12, 0.4, 0.42, 0.42],
    [0.06, 0.2, -0.28, 0.4, 0.4, 0.34],
    [-0.1, 0.62, 0.0, 0.34, 0.34, 0.32],
  ];
  lumps.forEach(([x, y, z, sx, sy, sz], i) => {
    b.add(rock(0.5), shade(m.color, 0.85 + (i % 3) * 0.2), x * w, y0 + y * h, z * d, { sx: sx * w * 1.5, sy: sy * h * 1.5, sz: sz * d * 1.5, ry: i * 0.9, rx: i * 0.2 });
  });
  // glints
  b.add(rock(0.5), m.accent, -w * 0.06, y0 + h * 0.8, d * 0.06, { sx: w * 0.16, sy: h * 0.14, sz: d * 0.16, ry: 0.5 });
  b.add(rock(0.5), shade(m.accent, 1.5), w * 0.24, y0 + h * 0.46, d * 0.34, { sx: w * 0.14, sy: h * 0.14, sz: d * 0.1 });
  b.add(rock(0.5), shade(m.accent, 1.4), -w * 0.3, y0 + h * 0.4, d * 0.34, { sx: w * 0.12, sy: h * 0.12, sz: d * 0.1 });
};

/** Gear: a flat brass cog with ten teeth, a dark rim ring, spoke holes and a hub with an axle hole. */
const buildGear: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  const body = R * 0.82;
  b.add(cyl(body, body, h, 20), m.color, 0, 0, 0);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.add(box(R * 0.3, h, R * 0.3), shade(m.color, 1.08), Math.cos(a) * (R * 0.88), 0, Math.sin(a) * (R * 0.88), { ry: -a });
  }
  // raised rim ring + recessed web, hub and axle hole on the top face
  b.add(cyl(body * 0.98, body * 0.98, 0.012, 20), shade(m.color, 1.25), 0, h / 2 + 0.002, 0);
  b.add(cyl(body * 0.74, body * 0.74, 0.016, 20), m.accent, 0, h / 2 + 0.004, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    b.add(cyl(R * 0.13, R * 0.13, 0.02, 8), shade(m.accent, 0.55), Math.cos(a) * R * 0.46, h / 2 + 0.006, Math.sin(a) * R * 0.46);
  }
  b.add(cyl(R * 0.26, R * 0.26, 0.02, 12), m.color, 0, h / 2 + 0.008, 0);
  b.add(cyl(R * 0.1, R * 0.1, 0.022, 8), shade(m.accent, 0.4), 0, y0 + h + 0.01, 0);
};

/** I-beam lying along X: two flanges, a web, rivets and bright end faces. */
const buildBeam: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const fl = h * 0.28;
  b.add(box(w, fl, d), m.color, 0, y0 + fl / 2, 0);
  b.add(box(w, fl, d), shade(m.color, 1.12), 0, y0 + h - fl / 2, 0);
  b.add(box(w - 0.004, h - 2 * fl + 0.01, d * 0.24), m.accent, 0, 0, 0);
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + w * (0.12 + i * 0.19);
    b.add(cyl(0.014, 0.014, 0.012, 6), shade(m.color, 1.4), x, y0 + h + 0.003, d * 0.28);
    b.add(cyl(0.014, 0.014, 0.012, 6), shade(m.color, 1.4), x, y0 + h + 0.003, -d * 0.28);
  }
  for (const s of [-1, 1]) b.add(box(0.008, h, d + 0.004), shade(m.color, 1.4), s * (w / 2 - 0.002), 0, 0);
  b.add(box(w * 0.5, 0.012, 0.012), shade(m.color, 1.5), -w * 0.1, y0 + h - 0.004, d / 2 + 0.002);
};

/** Wire spool: two dark flanges, a core wrapped in layered copper windings and a loose end. */
const buildCoil: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  const fh = 0.03;
  b.add(cyl(R, R, fh, 16), m.accent, 0, y0 + fh / 2, 0);
  b.add(cyl(R, R, fh, 16), m.accent, 0, y0 + h - fh / 2, 0);
  b.add(cyl(R * 0.4, R * 0.4, h, 10), shade(m.accent, 1.2), 0, 0, 0);
  const wh = h - 2 * fh;
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const y = y0 + fh + (wh * (i + 0.5)) / layers;
    b.add(cyl(R * 0.82, R * 0.82, wh / layers - 0.004, 16), shade(m.color, i % 2 === 0 ? 1 : 0.86), 0, y, 0);
  }
  b.add(cyl(R * 0.62, R * 0.62, wh + 0.002, 12), shade(m.color, 0.78), 0, 0, 0);
  b.add(cyl(R * 0.83, R * 0.83, 0.014, 16), shade(m.color, 1.3), 0, y0 + h - fh - 0.007, 0);
  // loose wire end poking out the front
  b.add(box(0.03, 0.025, R * 0.5), shade(m.color, 1.25), R * 0.3, y0 + h * 0.55, R * 0.88, { ry: -0.35 });
  b.add(cyl(R * 0.14, R * 0.14, fh + 0.002, 8), shade(m.accent, 0.5), 0, y0 + h - fh / 2, 0);
};

/** Oil drum: dark steel body, two yellow bands, rolled rims, a lid with a bung and a drip of crude. */
const buildBarrel: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  b.add(cyl(R * 0.97, R * 0.97, h * 0.92, 14), shade(m.color, 1.15), 0, 0, 0);
  b.add(cyl(R, R, h * 0.07, 14), shade(m.color, 1.6), 0, y0 + h * 0.035, 0);
  b.add(cyl(R, R, h * 0.07, 14), shade(m.color, 1.6), 0, y0 + h - h * 0.035, 0);
  for (const f of [0.3, 0.68]) b.add(cyl(R * 1.0, R * 1.0, h * 0.13, 14), m.accent, 0, y0 + h * f, 0);
  for (const f of [0.3, 0.68]) b.add(cyl(R * 1.01, R * 1.01, h * 0.025, 14), shade(m.accent, 0.7), 0, y0 + h * f + h * 0.08, 0);
  b.add(cyl(R * 0.8, R * 0.8, 0.012, 14), shade(m.color, 1.4), 0, y0 + h + 0.004, 0);
  b.add(cyl(R * 0.17, R * 0.17, 0.03, 8), m.accent, R * 0.32, y0 + h + 0.012, R * 0.1);
  b.add(cyl(R * 0.1, R * 0.1, 0.034, 6), shade(m.color, 0.5), -R * 0.28, y0 + h + 0.014, -R * 0.2);
};

/** Pellet tub: a tinted tub with a pale rim and a heap of round pellets on top. */
const buildPellet: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  const tubH = h * 0.55;
  b.add(cyl(R * 0.97, R * 0.82, tubH, 14), m.accent, 0, y0 + tubH / 2, 0, { sz: d / w });
  b.add(cyl(R, R, h * 0.07, 14), shade(m.accent, 1.5), 0, y0 + tubH, 0, { sz: d / w });
  // radiation-style hazard band on the dark tub (uranium); a plain label strip otherwise
  const hazard = m.kind === 'uranium';
  b.add(cyl(R * 0.99, R * 0.9, tubH * 0.22, 14), hazard ? 0xf2c230 : shade(m.accent, 0.8), 0, y0 + tubH * 0.45, 0, { sz: d / w });
  // heap of pellets (3 rings of spheres)
  const rings: [number, number, number][] = [
    [0, 0, 1],
    [0.14, 6, 0.72],
    [0.07, 4, 0.36],
  ];
  const py = y0 + tubH;
  const pr = 0.052;
  let i = 0;
  for (const [yy, n, rad] of rings) {
    for (let k = 0; k < Math.max(1, n); k++) {
      const a = (k / Math.max(1, n)) * Math.PI * 2 + rad;
      const rr = n === 0 ? 0 : R * 0.62 * rad;
      b.add(ball(pr, 7, 5), shade(m.color, 0.9 + (i++ % 3) * 0.12), Math.cos(a) * rr, py + 0.04 + yy * 0.8, Math.sin(a) * rr * (d / w), { sy: 0.9 });
    }
  }
  b.add(ball(pr, 7, 5), shade(m.color, 1.3), 0, py + 0.16, 0, { sy: 0.9 });
};

/** Crystal cluster: tilted six-sided crystals with pointed tips on a little rock bed. */
const buildCrystal: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  b.add(rock(0.5), shade(m.color, 0.55), 0, y0 + h * 0.05, 0, { sx: w * 0.9, sy: h * 0.14, sz: d * 0.9 });
  const spec: [number, number, number, number, number][] = [
    [0, 0, 0.95, 0.12, 0],
    [-0.24, 0.08, 0.66, 0.1, 0.3],
    [0.22, 0.06, 0.76, 0.105, -0.28],
    [0.04, -0.24, 0.5, 0.085, 0.12],
    [-0.1, 0.24, 0.44, 0.08, -0.14],
  ];
  spec.forEach(([x, z, hh, r, tilt], i) => {
    const bodyH = hh * h * 0.6;
    const tipH = hh * h * 0.4;
    const rr = r * w * 1.1;
    const col = i % 2 === 0 ? m.color : shade(m.color, 1.15);
    const px = x * w;
    const pz = z * d;
    const base = y0 + h * 0.05;
    b.add(cyl(rr, rr * 1.1, bodyH, 6), col, px, base + bodyH / 2, pz, { rz: tilt, rx: -tilt * 0.6 });
    b.add(cone(rr, tipH, 6), m.accent, px - Math.sin(tilt) * bodyH * 0.5, base + bodyH + tipH / 2 - 0.004, pz + Math.sin(tilt * 0.6) * bodyH * 0.3, { rz: tilt, rx: -tilt * 0.6 });
  });
};

/** Microchip: a green board, gold pin rows on all four sides, a black die package and gold traces. */
const buildChip: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const bw = w - 0.09;
  const bd = d - 0.09;
  b.add(box(bw, 0.036, bd), m.color, 0, y0 + 0.018, 0);
  b.add(box(bw - 0.03, 0.006, bd - 0.03), shade(m.color, 1.3), 0, y0 + 0.039, 0);
  // pins on every side
  const pins = 7;
  for (let i = 0; i < pins; i++) {
    const t = -0.5 + (i + 0.5) / pins;
    for (const s of [-1, 1]) {
      b.add(box(0.044, 0.016, 0.024), m.accent, s * (bw / 2 + 0.014), y0 + 0.016, t * (bd - 0.04));
      b.add(box(0.024, 0.016, 0.044), m.accent, t * (bw - 0.04), y0 + 0.016, s * (bd / 2 + 0.014));
    }
  }
  // package + glossy lid + notch
  b.add(box(bw * 0.58, h - 0.036, bd * 0.58), 0x1b1c22, 0, y0 + 0.036 + (h - 0.036) / 2, 0);
  b.add(box(bw * 0.5, 0.008, bd * 0.5), 0x34363f, 0, y0 + h - 0.004, 0);
  b.add(cyl(0.016, 0.016, 0.01, 8), m.accent, -bw * 0.18, y0 + h, -bd * 0.18);
  // gold traces fanning to the pins
  for (const o of [-0.09, 0, 0.09]) {
    b.add(box(0.05, 0.004, 0.01), m.accent, bw * 0.38, y0 + 0.041, o);
    b.add(box(0.05, 0.004, 0.01), m.accent, -bw * 0.38, y0 + 0.041, o);
  }
};

/** Fuel-rod bundle: three rods along X, grey end caps, glowing green fuel sections and tie bands. */
const buildRod: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const r = d * 0.26;
  const pos: [number, number][] = [
    [-d * 0.26, y0 + r],
    [d * 0.26, y0 + r],
    [0, y0 + r + r * 1.74],
  ];
  for (const [z, y] of pos) {
    b.add(cyl(r, r, w * 0.78, 8), m.color, 0, y, z, { rz: HALF_PI });
    for (const s of [-1, 1]) {
      b.add(cyl(r * 0.92, r * 0.92, w * 0.11, 8), m.accent, s * w * 0.445, y, z, { rz: HALF_PI });
      b.add(cyl(r * 0.5, r * 0.5, w * 0.03, 6), shade(m.accent, 1.4), s * (w / 2 - w * 0.015), y, z, { rz: HALF_PI });
    }
    b.add(cyl(r * 0.6, r * 0.6, w * 0.7, 6), shade(m.color, 1.4), 0, y + r * 0.35, z, { rz: HALF_PI });
  }
  for (const x of [-0.12, 0.12]) b.add(box(0.026, h * 0.82, d * 0.9), m.accent, x * w, y0 + h * 0.42, 0);
};

/** Battery cell: a dark body with a bright cyan band and bolt, a silver terminal cap and rim rings. */
const buildCell: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  const bodyH = h * 0.88;
  b.add(cyl(R * 0.97, R * 0.97, bodyH, 12), m.accent, 0, y0 + bodyH / 2, 0);
  b.add(cyl(R, R, h * 0.06, 12), shade(m.accent, 1.9), 0, y0 + h * 0.03, 0);
  b.add(cyl(R, R, h * 0.05, 12), shade(m.accent, 1.9), 0, y0 + bodyH - h * 0.025, 0);
  b.add(cyl(R * 1.0, R * 1.0, h * 0.34, 12), m.color, 0, y0 + h * 0.48, 0);
  b.add(cyl(R * 1.01, R * 1.01, h * 0.04, 12), shade(m.color, 1.5), 0, y0 + h * 0.66, 0);
  b.add(cyl(R * 0.36, R * 0.36, h * 0.12, 8), 0xdfe6ee, 0, y0 + h - h * 0.06, 0);
  b.add(cyl(R * 0.5, R * 0.5, 0.014, 10), 0xb8c0ca, 0, y0 + bodyH + 0.007, 0);
  // lightning bolt on the front of the band
  const z = R * 0.97;
  b.add(box(0.05, 0.1, 0.012), 0xffffff, -0.012, y0 + h * 0.49, z, { rz: 0.35 });
  b.add(box(0.05, 0.075, 0.012), 0xffffff, 0.012, y0 + h * 0.42, z, { rz: 0.35 });
};

/** AI core: a glowing gold cube floating inside a dark frame with corner posts and a bright heart. */
const buildCore: Builder = (b, m) => {
  const s = m.size.w;
  const t = s * 0.1;
  const o = s / 2 - t / 2;
  const frame = shade(m.accent, 2.1);
  // 12 edges
  for (const a of [-o, o]) {
    for (const c of [-o, o]) {
      b.add(box(s, t, t), m.accent, 0, a, c);
      b.add(box(t, s, t), m.accent, a, 0, c);
      b.add(box(t, t, s), m.accent, a, c, 0);
    }
  }
  // corner posts
  for (const x of [-o, o]) for (const y of [-o, o]) for (const z of [-o, o]) b.add(box(t * 1.5, t * 1.5, t * 1.5), frame, x, y, z);
  // glowing cube + hot heart + four side nodes
  b.add(box(s * 0.5, s * 0.5, s * 0.5), m.color, 0, 0, 0, { ry: Math.PI / 4, rx: 0.25 });
  b.add(box(s * 0.28, s * 0.28, s * 0.28), 0xfff0c8, 0, 0, 0, { ry: Math.PI / 4 + 0.4, rx: 0.25 });
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) b.add(box(t, t, t), m.color, x * (o + 0.0), 0, z * o);
};

/** Tiny boxy robot: cream body, gold chest panel with lights, visor head with sun-gold eyes, antenna, arms and feet. */
const buildRobot: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const bodyW = w * 0.62;
  // feet + legs
  for (const s of [-1, 1]) {
    b.add(box(w * 0.26, 0.03, d * 0.7), m.accent, s * bodyW * 0.28, y0 + 0.015, d * 0.03);
    b.add(box(w * 0.14, h * 0.14, d * 0.22), shade(m.color, 0.78), s * bodyW * 0.28, y0 + 0.03 + h * 0.07, 0);
  }
  // torso
  const ty = y0 + 0.03 + h * 0.14;
  const th = h * 0.32;
  b.add(box(bodyW, th, d * 0.78), m.color, 0, ty + th / 2, 0);
  b.add(box(bodyW * 0.7, th * 0.55, 0.02), m.accent, 0, ty + th * 0.55, d * 0.39);
  for (const [i, c] of [0xff7a6b, 0xffe066, 0x6be08f].entries()) b.add(box(0.026, 0.026, 0.014), c, (i - 1) * 0.055, ty + th * 0.62, d * 0.4);
  b.add(box(bodyW * 0.7, 0.02, 0.014), 0xd8cfbd, 0, ty + th * 0.2, d * 0.4);
  // arms with fists
  for (const s of [-1, 1]) {
    b.add(box(w * 0.14, th * 0.82, d * 0.24), shade(m.color, 0.88), s * (bodyW / 2 + w * 0.08), ty + th * 0.52, 0);
    b.add(box(w * 0.16, 0.06, d * 0.28), m.accent, s * (bodyW / 2 + w * 0.08), ty + th * 0.08, 0);
  }
  // neck + head
  const hy = ty + th;
  const hh = h * 0.28;
  b.add(box(bodyW * 0.3, 0.025, d * 0.3), shade(m.color, 0.7), 0, hy + 0.0125, 0);
  b.add(box(bodyW * 0.86, hh, d * 0.8), shade(m.color, 1.08), 0, hy + 0.025 + hh / 2, 0);
  b.add(box(bodyW * 0.7, hh * 0.5, 0.02), 0x3f4d5c, 0, hy + 0.025 + hh * 0.52, d * 0.4);
  for (const s of [-1, 1]) b.add(box(0.05, 0.034, 0.014), 0xffe082, s * 0.05, hy + 0.025 + hh * 0.52, d * 0.412);
  // ear nubs + antenna
  for (const s of [-1, 1]) b.add(box(0.02, hh * 0.4, d * 0.3), m.accent, s * (bodyW * 0.43 + 0.008), hy + 0.025 + hh * 0.5, 0);
  b.add(cyl(0.008, 0.008, h * 0.08, 5), shade(m.color, 0.7), 0, hy + 0.025 + hh + h * 0.04, 0);
  b.add(ball(0.022, 6, 5), m.accent, 0, hy + 0.025 + hh + h * 0.09, 0);
};

const BUILDERS: Record<MaterialShape, Builder> = {
  block: buildBlock,
  brick: buildBrick,
  nugget: buildNugget,
  native: buildNative,
  ingot: buildIngot,
  lump: buildLump,
  gear: buildGear,
  beam: buildBeam,
  coil: buildCoil,
  barrel: buildBarrel,
  pellet: buildPellet,
  crystal: buildCrystal,
  chip: buildChip,
  rod: buildRod,
  cell: buildCell,
  core: buildCore,
  robot: buildRobot,
  ...ERA2_4_ITEM_BUILDERS,
  ...ERA5_7_ITEM_BUILDERS,
  ...ERA8_10_ITEM_BUILDERS,
};

/** Shapes drawn from rough rocks / crystals / pellets: flat (per-face) normals keep their facets crisp. */
const FLAT: ReadonlySet<MaterialShape> = new Set<MaterialShape>(['block', 'nugget', 'native', 'lump', 'crystal', 'pellet', 'coke', 'geode']);

/** Centre `g` on the origin and scale it per axis to exactly the item's size box (so stacks sit stackHeight apart). */
function fit(g: THREE.BufferGeometry, size: MaterialDef['size']): THREE.BufferGeometry {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sz = bb.getSize(new THREE.Vector3());
  const c = bb.getCenter(new THREE.Vector3());
  const m = new THREE.Matrix4()
    .makeScale(size.w / Math.max(sz.x, 1e-6), size.h / Math.max(sz.y, 1e-6), size.d / Math.max(sz.z, 1e-6))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  g.applyMatrix4(m);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const geoCache = new Map<MaterialKind, THREE.BufferGeometry>();

function eraItemGeometry(kind: MaterialKind): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (!g) {
    const def = MATERIALS[kind];
    const b = new Batch();
    BUILDERS[def.shape](b, def);
    g = fit(b.geometry(FLAT.has(def.shape)), def.size);
    geoCache.set(kind, g);
  }
  return g;
}

/**
 * One merged vertex-coloured mesh for the material, centred on its origin and fitted to MATERIALS[kind].size.
 * Receives shadows but does not cast them (hundreds sit in piles; each caster would cost a second draw call).
 */
export function createEraItemModel(kind: MaterialKind): THREE.Mesh {
  const m = new THREE.Mesh(eraItemGeometry(kind), vcMat());
  m.castShadow = false;
  m.receiveShadow = true;
  m.name = `item:${kind}`;
  return m;
}

/** Gallery (--query gallery=eraItems): one entry per material. */
export const eraItemCatalog: Record<string, () => THREE.Object3D> = Object.fromEntries(
  (Object.keys(MATERIALS) as MaterialKind[]).map((kind) => [kind, () => createEraItemModel(kind)]),
);
