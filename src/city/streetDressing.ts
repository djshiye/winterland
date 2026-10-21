/**
 * [city] Festive street dressing of a district's sidewalk ring: a sagging string of bulbs between neighbouring street lamps
 * on the same side (eras 2-4 add flag bunting), a slim era banner on every second lamp post and a wreath on the others.
 * `districtSpans` / `districtPosts` are pure; `drawStreetDressing` appends everything to the district's existing lamp
 * (ropes, banners, wreaths) and bulb batches, so it adds no draw call. Visual only: no colliders.
 */
import * as THREE from 'three';
import type { Batch } from '../render/batch';
import { mixHex, palette } from '../render/palette';
import { BUNTING_COLORS, WARM_BULBS, addBunting, addWreath, ropePoint, type V3 } from '../world/env/festive';
import { districtDecor, districtLamps, type Lamp } from './decor';

/** Where a rope is tied on the 3.3 m lamp posts. */
export const ROPE_Y = 3.0;
/** Sag (m) of the bulb string; the lowest point stays above ROPE_Y - SAG = 2.55 m. */
export const SAG = 0.45;
/** A span keeps this far (m) from a tree's trunk circle. */
const TREE_GAP = 0.3;
/** Trees (taller than 2 m) block a span; low furniture does not. */
const TALL = new Set(['tree']);

export interface Span {
  a: V3;
  b: V3;
  sag: number;
  side: Lamp['side'];
  /** Colour offset so neighbouring strings do not repeat. */
  seed: number;
}

export interface Post {
  x: number;
  z: number;
  side: Lamp['side'];
  /** Every second post on a side carries a banner, the others a wreath. */
  kind: 'banner' | 'wreath';
}

/** Lamps of one side in walking order (along x for n / s, along z for e / w). */
function bySide(n: number): Map<Lamp['side'], Lamp[]> {
  const out = new Map<Lamp['side'], Lamp[]>();
  for (const l of districtLamps(n)) {
    const list = out.get(l.side) ?? [];
    list.push(l);
    out.set(l.side, list);
  }
  for (const [side, list] of out) list.sort((p, q) => (side === 'n' || side === 's' ? p.x - q.x : p.z - q.z));
  return out;
}

/** Distance in the ground plane from (px, pz) to the segment a-b. */
function distToSpan(a: V3, b: V3, px: number, pz: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(a.x + dx * t - px, a.z + dz * t - pz);
}

const spanCache = new Map<number, readonly Span[]>();

/** The rope spans of district n: between consecutive lamps of a side (never round a corner), skipping any a tree would touch. */
export function districtSpans(n: number): readonly Span[] {
  const hit = spanCache.get(n);
  if (hit) return hit;
  const trees = districtDecor(n).filter((it) => TALL.has(it.kind));
  const out: Span[] = [];
  let seed = 0;
  for (const [side, list] of bySide(n)) {
    for (let i = 0; i + 1 < list.length; i++) {
      const p = list[i]!;
      const q = list[i + 1]!;
      const a = { x: p.x, y: ROPE_Y, z: p.z };
      const b = { x: q.x, y: ROPE_Y, z: q.z };
      const blocked = trees.some((t) => distToSpan(a, b, t.x, t.z) < TREE_GAP);
      seed += 2;
      if (!blocked) out.push({ a, b, sag: SAG, side, seed });
    }
  }
  spanCache.set(n, out);
  return out;
}

/** Banner / wreath assignment per lamp post of district n. */
export function districtPosts(n: number): readonly Post[] {
  const out: Post[] = [];
  for (const [side, list] of bySide(n)) list.forEach((l, i) => out.push({ x: l.x, z: l.z, side, kind: i % 2 === 0 ? 'banner' : 'wreath' }));
  return out;
}

/** The bulb colours of an era: warm for 2-7, cooler white-blue plus the era accent for 8-10. */
export function bulbColors(n: number): readonly number[] {
  if (n < 8) return WARM_BULBS;
  const accent = mixHex(palette(n).accent, 0xffffff, 0.35);
  return [0xd8f2ff, 0xa8e4ff, 0xfff4d6, accent];
}

const wire = new THREE.BoxGeometry(1, 0.025, 0.025);
const bulbG = new THREE.IcosahedronGeometry(0.09, 0);
const post = new THREE.BoxGeometry(1, 1, 1);
const a0: V3 = { x: 0, y: 0, z: 0 };
const a1: V3 = { x: 0, y: 0, z: 0 };

/** Append the dressing of district n: ropes, bunting, banners and wreaths to `poles`, the bulbs to `bulbs`. */
export function drawStreetDressing(n: number, poles: Batch, bulbs: Batch): void {
  const colors = bulbColors(n);
  for (const s of districtSpans(n)) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
    const steps = Math.max(6, Math.round(len / 0.5));
    for (let i = 0; i < steps; i++) {
      ropePoint(s.a, s.b, s.sag, i / steps, a0);
      ropePoint(s.a, s.b, s.sag, (i + 1) / steps, a1);
      const dx = a1.x - a0.x;
      const dy = a1.y - a0.y;
      const dz = a1.z - a0.z;
      const horiz = Math.hypot(dx, dz);
      poles.add(wire, 0x2a2622, (a0.x + a1.x) / 2, (a0.y + a1.y) / 2, (a0.z + a1.z) / 2, {
        rz: Math.atan2(dy, horiz),
        ry: Math.atan2(-dz, dx),
        sx: Math.hypot(horiz, dy) + 0.02,
      });
    }
    const count = Math.max(6, Math.round(len / 0.42));
    for (let i = 1; i < count; i++) {
      ropePoint(s.a, s.b, s.sag, i / count, a0);
      bulbs.add(bulbG, colors[(i + s.seed) % colors.length]!, a0.x, a0.y - 0.07, a0.z);
    }
    if (n <= 4) {
      // little flags on a second, slightly higher-hung rope
      addBunting(poles, { x: s.a.x, y: s.a.y - 0.2, z: s.a.z }, { x: s.b.x, y: s.b.y - 0.2, z: s.b.z }, s.sag - 0.07, s.seed, BUNTING_COLORS);
    }
  }
  const p = palette(n);
  const cloth = p.city?.accent ?? p.accent;
  const stripe = mixHex(p.city?.trim ?? 0xfff0c8, 0xffffff, 0.5);
  for (const q of districtPosts(n)) {
    // inward (towards the street) is where the lamp arm leans
    const ix = q.side === 'w' ? 1 : q.side === 'e' ? -1 : 0;
    const iz = q.side === 'n' ? 1 : q.side === 's' ? -1 : 0;
    if (q.kind === 'wreath') {
      addWreath(poles, q.x, 2.45, q.z, 0.8);
      continue;
    }
    // a short arm out to the street, then a slim banner with a contrasting centre stripe
    const arm = 0.3;
    const rot = ix !== 0 ? 0 : Math.PI / 2;
    poles.add(post, 0x3a342e, q.x + (ix * arm) / 2, 2.9, q.z + (iz * arm) / 2, { sx: ix !== 0 ? arm : 0.04, sy: 0.04, sz: iz !== 0 ? arm : 0.04 });
    const bx = q.x + ix * arm;
    const bz = q.z + iz * arm;
    poles.add(post, cloth, bx, 2.5, bz, { ry: rot, sx: 0.03, sy: 0.78, sz: 0.36 });
    poles.add(post, stripe, bx, 2.5, bz, { ry: rot, sx: 0.045, sy: 0.78, sz: 0.09 });
    poles.add(post, cloth, bx, 2.08, bz, { ry: rot, sx: 0.03, sy: 0.1, sz: 0.24 });
  }
}
