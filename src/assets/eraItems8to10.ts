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

const ball = (r: number, ws = 10, hs = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, ws, hs);
const cone = (r: number, h: number, seg = 6): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);
const ring = (r: number, tube: number): THREE.BufferGeometry => new THREE.TorusGeometry(r, tube, 6, 18);

/**
 * 0.9.7 era 10 rare earth (era resources v2): a cut-open half
 * geode, a pale warm stone rind round a bed of lavender crystal points with gold magnetic flecks, flat top and bottom.
 */
const buildGeode: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const rind = 0xd8cfc0;
  // rind: a squat rounded block, a darker band, the cut face (crystal bed) on top
  b.add(cyl(w * 0.5, w * 0.46, h * 0.7, 8), rind, 0, y0 + h * 0.35, 0, { sz: d / w });
  b.add(cyl(w * 0.51, w * 0.51, h * 0.1, 8), shade(rind, 0.8), 0, y0 + h * 0.4, 0, { sz: d / w });
  b.add(cyl(w * 0.4, w * 0.4, h * 0.04, 8), shade(m.color, 0.7), 0, y0 + h * 0.7, 0, { sz: d / w });
  // crystal points rising from the bed, all ending at the same height (stacking plane)
  const pts: [number, number, number, number][] = [
    [0, 0, 0.11, 1],
    [-0.2, 0.12, 0.08, 0.85],
    [0.2, -0.1, 0.09, 1.15],
    [0.12, 0.2, 0.07, 0.9],
    [-0.16, -0.18, 0.075, 1.1],
  ];
  for (const [x, z, r, tone] of pts) b.add(cone(r * w * 1.6, h * 0.3, 6), shade(m.color, tone), x * w, y0 + h * 0.85, z * d);
  for (const [x, z] of [[0.05, 0.3], [-0.3, -0.05], [0.32, 0.1]] as const) b.add(ball(w * 0.03, 6, 4), m.accent, x * w, y0 + h * 0.74, z * d);
};

/**
 * 0.9.7 era 10 helium-3: a chubby cream cryo flask with gold
 * bands, a round window glowing soft peach, and a little valve on a flat cap.
 */
const buildFlask: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  b.add(cyl(R * 0.92, R * 0.86, h * 0.08, 12), shade(m.color, 0.85), 0, y0 + h * 0.04, 0);
  b.add(ball(R, 14, 10), m.color, 0, y0 + h * 0.42, 0, { sy: (h * 0.36) / R });
  b.add(cyl(R * 0.98, R * 0.98, h * 0.4, 14), m.color, 0, y0 + h * 0.42, 0);
  for (const y of [0.25, 0.6]) b.add(cyl(R * 1.01, R * 1.01, h * 0.05, 14), 0xe8b341, 0, y0 + h * y, 0);
  // peach-glow window on the front
  b.add(cyl(R * 0.36, R * 0.36, 0.02, 12), 0xe8b341, 0, y0 + h * 0.43, R * 0.97, { rx: Math.PI / 2 });
  b.add(cyl(R * 0.28, R * 0.28, 0.024, 12), m.accent, 0, y0 + h * 0.43, R * 0.98, { rx: Math.PI / 2 });
  // neck, flat cap and valve wheel
  b.add(cyl(R * 0.36, R * 0.45, h * 0.12, 10), shade(m.color, 0.9), 0, y0 + h * 0.82, 0);
  b.add(cyl(R * 0.42, R * 0.42, h * 0.06, 10), 0xe8b341, 0, y0 + h * 0.91, 0);
  b.add(ring(R * 0.24, R * 0.05), 0x526475, 0, y0 + h * 0.97, 0, { rx: Math.PI / 2 });
};

/**
 * 0.9.7 era 10 fusion cell: a squat cream puck with a gold
 * rim and a tiny glowing torus set into its flat top, a mini copy of the Fusion Reactor's ring.
 */
const buildFusionCell: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  b.add(cyl(R * 0.94, R, h * 0.8, 16), m.color, 0, y0 + h * 0.4, 0);
  b.add(cyl(R * 1.01, R * 1.01, h * 0.12, 16), m.accent, 0, y0 + h * 0.18, 0);
  b.add(cyl(R * 0.98, R * 0.94, h * 0.2, 16), 0xe8b341, 0, y0 + h * 0.9, 0);
  // the glowing ring in a slate well on top
  b.add(cyl(R * 0.7, R * 0.7, 0.02, 16), 0x526475, 0, y0 + h * 0.995, 0);
  b.add(ring(R * 0.45, R * 0.1), 0xfff0c8, 0, y0 + h * 0.98, 0, { rx: Math.PI / 2 });
  b.add(ball(R * 0.14, 8, 6), 0xffffff, 0, y0 + h * 0.96, 0, { sy: 0.5 });
  // three slate vents round the side
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    b.add(box(R * 0.35, h * 0.3, 0.02), 0x526475, Math.cos(a) * R * 0.96, y0 + h * 0.5, Math.sin(a) * R * 0.96, { ry: -a + Math.PI / 2 });
  }
};

export const ERA8_10_ITEM_BUILDERS: Record<Extract<MaterialShape, 'computer' | 'geode' | 'flask' | 'fusion'>, Builder> = {
  computer: buildComputer,
  geode: buildGeode,
  flask: buildFlask,
  fusion: buildFusionCell,
};
