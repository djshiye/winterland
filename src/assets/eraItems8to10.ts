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

export const ERA8_10_ITEM_BUILDERS: Record<Extract<MaterialShape, 'computer'>, Builder> = {
  computer: buildComputer,
};
