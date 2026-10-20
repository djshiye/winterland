/**
 * [T4 — wave 9] Festive decoration builders for the eras: flag bunting, strings of bulbs, wreaths. Everything is
 * appended to a Batch (one merged mesh per set), nothing is created per frame.
 */
import * as THREE from 'three';
import { Batch } from './common';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const BUNTING_COLORS = [0xe2453c, 0xffd34d, 0x3fa7ff, 0x5ee07a, 0xffffff, 0xff8fb3] as const;
export const BULB_COLORS = [0xffd978, 0xfff0c2, 0xff6b6b, 0x7ad7ff, 0x8dff9a, 0xffb347] as const;
export const WARM_BULBS = [0xffd978, 0xfff0c2, 0xffc060] as const;

const rope = new THREE.BoxGeometry(1, 0.03, 0.03);
let flag: THREE.BufferGeometry | null = null;
let bulb: THREE.BufferGeometry | null = null;

function flagGeo(): THREE.BufferGeometry {
  if (!flag) {
    const s = new THREE.Shape();
    s.moveTo(-0.12, 0);
    s.lineTo(0.12, 0);
    s.lineTo(0, -0.27);
    s.closePath();
    flag = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false }).translate(0, 0, -0.0125);
  }
  return flag;
}

function bulbGeo(): THREE.BufferGeometry {
  bulb ??= new THREE.IcosahedronGeometry(0.075, 0);
  return bulb;
}

/** Point `t` (0..1) along a sagging rope from `a` to `b`. */
export function ropePoint(a: V3, b: V3, sag: number, t: number, out: V3): V3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * sag;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

const p0: V3 = { x: 0, y: 0, z: 0 };
const p1: V3 = { x: 0, y: 0, z: 0 };

function segment(batch: Batch, geometry: THREE.BufferGeometry, color: number, a: V3, b: V3, thickness = 1): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const horiz = Math.hypot(dx, dz);
  const len = Math.hypot(horiz, dy);
  batch.add(geometry, color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, {
    rz: Math.atan2(dy, horiz),
    ry: Math.atan2(-dz, dx),
    sx: len + 0.02,
    sy: thickness,
    sz: thickness,
  });
}

/** A rope from a to b (sagging `sag` m in the middle) with a triangular flag every ~0.42 m. */
export function addBunting(batch: Batch, a: V3, b: V3, sag: number, seed = 0, colors: readonly number[] = BUNTING_COLORS): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(4, Math.round(len / 0.45));
  for (let i = 0; i < steps; i++) {
    ropePoint(a, b, sag, i / steps, p0);
    ropePoint(a, b, sag, (i + 1) / steps, p1);
    segment(batch, rope, 0x5a4636, p0, p1);
    // flag in the middle of the step, hanging from the rope
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const mz = (p0.z + p1.z) / 2;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const horiz = Math.hypot(dx, dz);
    batch.add(flagGeo(), colors[(i + seed) % colors.length]!, mx, my - 0.015, mz, {
      rz: Math.atan2(dy, horiz) * 0.6,
      ry: Math.atan2(-dz, dx),
    });
  }
}

/** A wire from a to b with a bulb every ~0.34 m. Goes into a Batch painted for the unlit bulb material. */
export function addLightString(batch: Batch, a: V3, b: V3, sag: number, seed = 0, colors: readonly number[] = BULB_COLORS): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(4, Math.round(len / 0.34));
  for (let i = 0; i < steps; i++) {
    ropePoint(a, b, sag, i / steps, p0);
    ropePoint(a, b, sag, (i + 1) / steps, p1);
    segment(batch, rope, 0x1f4a38, p0, p1, 0.7);
    batch.add(bulbGeo(), colors[(i * 7 + seed) % colors.length]!, p0.x, p0.y - 0.05, p0.z);
  }
  batch.add(bulbGeo(), colors[(steps * 7 + seed) % colors.length]!, b.x, b.y - 0.05, b.z);
}

let lantern: THREE.BufferGeometry | null = null;
let lanternCap: THREE.BufferGeometry | null = null;

/**
 * 0.9.12 (Dino: lantern garlands): a wire from a to b with a round paper lantern hanging every ~0.62 m, each with a dark
 * cap and foot. Goes into a Batch painted for the bulb material, so the lanterns glow warm at night.
 */
export function addLanternGarland(batch: Batch, a: V3, b: V3, sag: number, seed = 0, colors: readonly number[] = WARM_BULBS): void {
  lantern ??= new THREE.SphereGeometry(0.085, 9, 6).scale(1, 1.25, 1);
  lanternCap ??= new THREE.CylinderGeometry(0.045, 0.05, 0.035, 6);
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(4, Math.round(len / 0.31));
  for (let i = 0; i < steps; i++) {
    ropePoint(a, b, sag, i / steps, p0);
    ropePoint(a, b, sag, (i + 1) / steps, p1);
    segment(batch, rope, 0x3a2c24, p0, p1, 0.6);
    if (i % 2 === 0) continue;
    const y = p0.y - 0.15;
    segment(batch, rope, 0x3a2c24, p0, { x: p0.x, y: y + 0.12, z: p0.z }, 0.4);
    batch.add(lantern, colors[(i * 5 + seed) % colors.length]!, p0.x, y, p0.z);
    batch.add(lanternCap, 0x4a3426, p0.x, y + 0.115, p0.z);
    batch.add(lanternCap, 0x4a3426, p0.x, y - 0.115, p0.z);
  }
}

/** A wreath (green ring, red berries, a bow) hung on a post, turned to face the iso camera. */
export function addWreath(batch: Batch, x: number, y: number, z: number, scale = 1): void {
  const face = Math.PI / 4;
  batch.add(new THREE.TorusGeometry(0.2 * scale, 0.07 * scale, 5, 12), 0x2f7a55, x + 0.1 * scale, y, z + 0.1 * scale, { ry: face });
  const cx = x + 0.1 * scale + Math.sin(face) * 0.08 * scale;
  const cz = z + 0.1 * scale + Math.cos(face) * 0.08 * scale;
  for (let i = 0; i < 5; i++) {
    const a = i * 1.37;
    batch.add(
      bulbGeo(),
      0xe2453c,
      cx + Math.cos(a) * Math.cos(face) * 0.2 * scale,
      y + Math.sin(a) * 0.2 * scale,
      cz - Math.cos(a) * Math.sin(face) * 0.2 * scale,
      { sx: 0.7 * scale, sy: 0.7 * scale, sz: 0.7 * scale },
    );
  }
  batch.add(new THREE.BoxGeometry(0.2 * scale, 0.1 * scale, 0.05 * scale), 0xe2453c, cx, y - 0.2 * scale, cz, { ry: face });
}
