/**
 * [items builder] 0.9.5: item shapes of the new era 8-10 materials (eras/data.ts MATERIALS). Gold, boards, graphite,
 * batteries and quantum cores reuse the shared nugget / chip / block / cell / core shapes recoloured; only the home
 * computer needs its own. Same contract as assets/eraItems.ts: the builder works in the item's own box (width X,
 * height Y, depth Z, front +Z, y0 = the floor); eraItems.ts merges, centres and fits it, so one item is ONE draw call.
 */
import * as THREE from 'three';
import type { MaterialDef, MaterialShape } from '../eras/data';
import type { Batch } from '../render/batch';

type Builder = (b: Batch, m: MaterialDef) => void;

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (rTop: number, rBottom: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(rTop, rBottom, h, seg);

const _c = new THREE.Color();
/** `c` toward black (k < 1) or toward white (k > 1). */
function shade(c: number, k: number): THREE.Color {
  _c.set(c);
  if (k <= 1) return new THREE.Color().copy(_c).multiplyScalar(k);
  return new THREE.Color().copy(_c).lerp(new THREE.Color(0xffffff), Math.min(1, k - 1));
}

/** 0.9.5 home computer: a beige retro box with a teal-glass screen, a keyboard tray, a floppy slot and a power light. */
const buildComputer: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  // keyboard tray at the front
  b.add(box(w, h * 0.12, d * 0.34), shade(m.color, 0.9), 0, y0 + h * 0.06, d * 0.33);
  for (let i = 0; i < 4; i++) b.add(box(w * 0.8, h * 0.02, d * 0.04), shade(m.color, 0.7), 0, y0 + h * 0.13, d * (0.22 + i * 0.065));
  // monitor case, bezel and screen
  b.add(box(w * 0.86, h * 0.8, d * 0.62), m.color, 0, y0 + h * 0.52, -d * 0.18);
  b.add(box(w * 0.7, h * 0.52, 0.012), shade(m.color, 0.75), 0, y0 + h * 0.6, d * 0.13 + 0.004);
  b.add(box(w * 0.6, h * 0.42, 0.012), m.accent, 0, y0 + h * 0.6, d * 0.13 + 0.012);
  b.add(box(w * 0.42, h * 0.05, 0.006), shade(m.accent, 1.6), -w * 0.06, y0 + h * 0.68, d * 0.13 + 0.02);
  // floppy slot + power light
  b.add(box(w * 0.26, h * 0.025, 0.01), 0x3b3a3e, w * 0.18, y0 + h * 0.23, d * 0.13 + 0.004);
  b.add(box(0.03, 0.03, 0.01), 0x7ce8a3, -w * 0.32, y0 + h * 0.23, d * 0.13 + 0.006);
};

/**
 * 0.9.6 era 10 data shards (ARGON spec docs/art/10-data-shards.md): three flat-topped berry-violet quartz prisms
 * (rose-magenta glow baked on the top tables) in a gold circuit cradle, with a gold-traced circuit bus on the front.
 */
const buildShards: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const plum = 0x4a2574;
  const glow = 0xff7eb6;
  const gold = m.accent;
  const ch = h * 0.733; // crystal height above the cradle
  const cy = y0 + h * 0.267 + ch / 2 - h * 0.1;
  // gold cradle: a darker rim below, contact-pin notches down the sides
  b.add(box(w * 0.944, h * 0.267, d * 0.933), gold, 0, y0 + h * 0.133, 0);
  b.add(box(w * 0.96, h * 0.06, d * 0.95), shade(gold, 0.72), 0, y0 + h * 0.03, 0);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.add(box(0.012, h * 0.16, d * 0.06), shade(gold, 0.72), s * w * 0.478, y0 + h * 0.13, -d * 0.33 + i * d * 0.22);
  // centre prism (6-sided), flat top at h, a pink glow table on top and a plum back face
  b.add(cyl(w * 0.25, w * 0.306, ch, 6), m.color, 0, cy, -d * 0.067);
  b.add(cyl(w * 0.235, w * 0.235, h * 0.03, 6), glow, 0, y0 + h - h * 0.015, -d * 0.067);
  b.add(box(w * 0.3, ch * 0.7, 0.012), plum, 0, cy, -d * 0.067 - w * 0.27);
  // two leaning side shards (5-sided), tops trimmed to the same plane
  for (const s of [-1, 1]) {
    const x = s * w * 0.278;
    b.add(cyl(w * 0.18, w * 0.222, ch * 0.92, 5), shade(m.color, 0.88), x, cy - ch * 0.04, d * 0.1, { rz: -s * 0.14 });
    b.add(cyl(w * 0.16, w * 0.16, h * 0.03, 5), glow, x - s * w * 0.03, y0 + h - h * 0.015, d * 0.1);
  }
  // front circuit bus with three vertical gold traces
  b.add(box(w * 0.722, h * 0.4, d * 0.133), plum, 0, y0 + h * 0.4, d * 0.433);
  for (let i = -1; i <= 1; i++) b.add(box(w * 0.03, h * 0.32, 0.01), gold, i * w * 0.18, y0 + h * 0.42, d * 0.5 + 0.004);
};

export const ERA8_10_ITEM_BUILDERS: Record<Extract<MaterialShape, 'computer' | 'shards'>, Builder> = {
  computer: buildComputer,
  shards: buildShards,
};
