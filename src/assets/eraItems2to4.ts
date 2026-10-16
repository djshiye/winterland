/**
 * [items builder] 0.9.5: item shapes of the new era 2-4 materials (eras/data.ts MATERIALS: clay and charcoal use the
 * shared lump, scrap the nugget; roof tiles, hearths, tools, rails, boilers and steam engines are drawn here). Same
 * contract as assets/eraItems.ts: each builder works in the item's own box (width X, height Y, depth Z, front +Z,
 * y0 = the floor) from the material's colour and accent; eraItems.ts merges, centres and fits the result, so one item
 * is ONE draw call.
 */
import * as THREE from 'three';
import type { MaterialDef } from '../eras/data';
import type { Batch } from '../render/batch';

type Builder = (b: Batch, m: MaterialDef) => void;

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (rTop: number, rBottom: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
const ball = (r: number, w = 8, h = 6): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);
const rock = (r: number, detail = 0): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, detail);

const _c = new THREE.Color();
/** `c` toward black (k < 1) or toward white (k > 1). */
function shade(c: number, k: number): THREE.Color {
  _c.set(c);
  if (k <= 1) return new THREE.Color().copy(_c).multiplyScalar(k);
  return new THREE.Color().copy(_c).lerp(new THREE.Color(0xffffff), Math.min(1, k - 1));
}

/** Roof tiles: a tied bundle of curved terracotta pantiles, overlapping in two rows, with a pale string band. */
const buildTile: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const n = 4;
  const tw = w / n;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + tw * (i + 0.5);
      const y = y0 + h * (0.3 + row * 0.42);
      const z = (row === 0 ? -1 : 1) * d * 0.2;
      // half pipe: a squashed open cylinder lying along Z
      b.add(cyl(tw * 0.5, tw * 0.5, d * 0.56, 8), shade(m.color, 0.9 + ((i + row) % 3) * 0.08), x, y, z, { rx: Math.PI / 2, sy: 1, sx: 1, sz: 0.55 });
    }
  }
  b.add(box(w * 1.0, h * 0.08, 0.03), m.accent, 0, y0 + h * 0.52, 0);
  b.add(box(w * 1.0, h * 0.08, 0.03), m.accent, 0, y0 + h * 0.52, d * 0.4);
};

/** Hearth: a little fieldstone fireplace with a brick arch, a glowing ember mouth and a short chimney. */
const buildHearth: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  b.add(box(w, h * 0.12, d), shade(m.color, 0.85), 0, y0 + h * 0.06, 0);
  b.add(box(w * 0.9, h * 0.56, d * 0.8), m.color, 0, y0 + h * 0.4, -d * 0.04);
  b.add(box(w * 1.0, h * 0.08, d * 0.9), shade(m.color, 1.2), 0, y0 + h * 0.72, 0);
  b.add(box(w * 0.36, h * 0.28, d * 0.6), shade(m.color, 1.08), w * 0.12, y0 + h * 0.86, -d * 0.12);
  // brick arch and ember mouth
  b.add(box(w * 0.56, h * 0.08, 0.05), 0xb5543c, 0, y0 + h * 0.56, d * 0.37);
  for (const s of [-1, 1]) b.add(box(w * 0.08, h * 0.38, 0.05), 0xb5543c, s * w * 0.24, y0 + h * 0.33, d * 0.37);
  b.add(box(w * 0.4, h * 0.3, 0.04), 0x3a2a24, 0, y0 + h * 0.3, d * 0.36);
  b.add(rock(0.5), m.accent, 0, y0 + h * 0.2, d * 0.38, { sx: w * 0.3, sy: h * 0.1, sz: 0.06 });
  b.add(rock(0.5), shade(m.accent, 1.3), w * 0.04, y0 + h * 0.26, d * 0.39, { sx: w * 0.12, sy: h * 0.08, sz: 0.04 });
};

/** Tools: a pick and a hammer lying crossed on a little plank, iron heads on wooden handles. */
const buildTools: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  b.add(box(w, h * 0.28, d * 0.9), shade(m.accent, 1.2), 0, y0 + h * 0.14, 0);
  // pick: handle along +X, head across
  b.add(box(w * 0.9, h * 0.22, 0.05), m.accent, 0, y0 + h * 0.4, -d * 0.12, { ry: 0.35 });
  b.add(box(0.06, h * 0.3, d * 0.62), m.color, w * 0.32, y0 + h * 0.48, -d * 0.04, { ry: 0.35 });
  b.add(box(0.03, h * 0.18, d * 0.12), shade(m.color, 1.3), w * 0.3, y0 + h * 0.48, d * 0.26, { ry: 0.35 });
  // hammer: handle across the other way, square head
  b.add(box(w * 0.86, h * 0.22, 0.05), shade(m.accent, 0.9), 0, y0 + h * 0.62, d * 0.12, { ry: -0.35 });
  b.add(box(0.12, h * 0.36, 0.14), shade(m.color, 0.9), -w * 0.34, y0 + h * 0.66, d * 0.26, { ry: -0.35 });
  b.add(box(0.13, 0.02, 0.15), shade(m.color, 1.4), -w * 0.34, y0 + h * 0.86, d * 0.26, { ry: -0.35 });
};

/** Rail: a short length of flat-bottomed rail on two timber sleepers, with a polished running head. */
const buildRail: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  for (const x of [-w * 0.3, w * 0.3]) b.add(box(w * 0.18, h * 0.34, d), m.accent, x, y0 + h * 0.17, 0);
  for (const z of [-d * 0.24, d * 0.24]) {
    b.add(box(w, h * 0.1, d * 0.2), shade(m.color, 0.85), 0, y0 + h * 0.39, z);
    b.add(box(w, h * 0.34, d * 0.05), m.color, 0, y0 + h * 0.6, z);
    b.add(box(w, h * 0.16, d * 0.13), shade(m.color, 1.45), 0, y0 + h * 0.86, z);
  }
  for (const x of [-w * 0.3, w * 0.3]) for (const z of [-d * 0.24, d * 0.24]) b.add(box(0.05, 0.03, 0.05), shade(m.color, 0.6), x, y0 + h * 0.46, z + 0.07);
};

/** Boiler: a riveted red drum on brass bands with a dome, a pressure gauge and a little stack. */
const buildBoiler: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  b.add(cyl(R * 0.94, R * 0.94, h * 0.7, 14), m.color, 0, y0 + h * 0.37, 0);
  for (const f of [0.08, 0.37, 0.66]) b.add(cyl(R, R, h * 0.07, 14), m.accent, 0, y0 + h * f + h * 0.03, 0);
  b.add(ball(R * 0.94, 14, 6), shade(m.color, 1.1), 0, y0 + h * 0.72, 0, { sy: 0.32 });
  b.add(cyl(R * 0.16, R * 0.2, h * 0.24, 8), shade(m.accent, 0.6), R * 0.38, y0 + h * 0.86, 0);
  b.add(cyl(R * 0.2, R * 0.2, 0.03, 10), 0xf2ead8, 0, y0 + h * 0.5, R * 0.94, { rx: Math.PI / 2 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(ball(0.016, 4, 3), shade(m.accent, 1.3), Math.cos(a) * R * 0.97, y0 + h * 0.24, Math.sin(a) * R * 0.97);
  }
};

/** Steam engine: a dark cylinder block on a base with a brass flywheel, a piston rod and a chimney. */
const buildEngine: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  b.add(box(w, h * 0.14, d), shade(m.color, 1.3), 0, y0 + h * 0.07, 0);
  b.add(cyl(d * 0.22, d * 0.22, w * 0.5, 12), m.color, -w * 0.12, y0 + h * 0.34, -d * 0.1, { rz: Math.PI / 2 });
  b.add(box(w * 0.08, h * 0.06, 0.04), m.accent, -w * 0.12, y0 + h * 0.34, d * 0.14);
  // flywheel: rim, hub, spokes
  b.add(cyl(h * 0.36, h * 0.36, 0.06, 16), m.accent, w * 0.3, y0 + h * 0.5, d * 0.1, { rx: Math.PI / 2 });
  b.add(cyl(h * 0.27, h * 0.27, 0.07, 16), shade(m.color, 0.9), w * 0.3, y0 + h * 0.5, d * 0.1, { rx: Math.PI / 2 });
  for (let i = 0; i < 3; i++) b.add(box(h * 0.56, 0.035, 0.08), m.accent, w * 0.3, y0 + h * 0.5, d * 0.1, { rz: (i / 3) * Math.PI });
  b.add(cyl(0.05, 0.05, 0.09, 8), shade(m.accent, 1.3), w * 0.3, y0 + h * 0.5, d * 0.1, { rx: Math.PI / 2 });
  b.add(box(w * 0.4, 0.03, 0.03), shade(m.accent, 1.2), w * 0.08, y0 + h * 0.38, d * 0.14, { rz: 0.25 });
  b.add(cyl(0.05, 0.06, h * 0.4, 8), m.color, -w * 0.36, y0 + h * 0.7, -d * 0.24);
  b.add(cyl(0.07, 0.07, 0.04, 8), m.accent, -w * 0.36, y0 + h * 0.9, -d * 0.24);
};

/** Builders for the new era 2-4 shapes (eras/data.ts MaterialShape). */
export const ERA2_4_ITEM_BUILDERS = {
  tile: buildTile,
  hearth: buildHearth,
  tools: buildTools,
  rail: buildRail,
  boiler: buildBoiler,
  engine: buildEngine,
} as const satisfies Record<string, Builder>;
