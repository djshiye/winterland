/**
 * 0.9.12: the paving that is not the plain dirt trail, appended to a road's Batch (frontier.ts buildRoad): the 10 m in
 * front of each region gate in that era's own paving (timber, brick, iron plate, steel, concrete, panels, hazard-edged
 * concrete, glowing tiles; flat and low, its ends blended into the trail) and the south avenue's cobbled apron through
 * the Market Town's fence gap. The layout of a road's joins is in roadJoins.ts.
 */
import * as THREE from 'three';
import type { Rect } from '../../config';
import { ERAS } from '../../eras/data';
import type { Batch } from '../../render/batch';
import { geo } from '../../render/materials';
import type { Rng } from './common';
import type { GatePaving } from './roadJoins';

export const TRAIL_COLOR = 0xc9c0b0;

export const mixColor = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
export const shadeColor = (c: number, k: number): number => {
  const col = new THREE.Color(c);
  col.r = Math.min(1, col.r * k);
  col.g = Math.min(1, col.g * k);
  col.b = Math.min(1, col.b * k);
  return col.getHex();
};

type Kind = 'planks' | 'brick' | 'plates' | 'steel' | 'slabs' | 'panels' | 'hazard' | 'tiles';

interface Style {
  kind: Kind;
  /** Slab under the pieces (joints, mortar, grout). */
  base: number;
  a: number;
  b: number;
  /** Small accents (rivets, edge dashes, panel lines). */
  accent: number;
  /** Glowing seams (era X). */
  glow?: number;
}

/** The paving of era n, from ERAS[n].colors. */
export function pavingStyle(n: number): Style {
  const c = ERAS[n]!.colors;
  switch (n) {
    case 2:
      return { kind: 'planks', base: shadeColor(c.trim, 1.1), a: mixColor(c.fence, 0xb48a58, 0.55), b: mixColor(c.fence, 0x9a7348, 0.5), accent: c.trim };
    case 3:
      return { kind: 'brick', base: mixColor(c.accent, 0xcdbfae, 0.7), a: mixColor(c.body, 0xb86a4e, 0.5), b: shadeColor(c.body, 0.84), accent: c.trim };
    case 4:
      return { kind: 'plates', base: c.trim, a: shadeColor(c.fence, 1.85), b: shadeColor(c.fence, 1.6), accent: c.accent };
    case 5:
      return { kind: 'steel', base: c.trim, a: shadeColor(c.body, 1.4), b: shadeColor(c.body, 1.25), accent: c.accent };
    case 6:
      return { kind: 'slabs', base: mixColor(c.trim, 0x9aa4a8, 0.55), a: mixColor(c.fence, 0xc2c8ca, 0.6), b: mixColor(c.fence, 0xb4bcc0, 0.6), accent: c.accent };
    case 7:
      return { kind: 'slabs', base: mixColor(c.trim, 0xa09a90, 0.55), a: mixColor(c.fence, 0xc8c2b6, 0.6), b: mixColor(c.fence, 0xb9b3a6, 0.6), accent: c.accent };
    case 8:
      return { kind: 'panels', base: mixColor(c.trim, 0xb8c0c6, 0.4), a: c.body, b: shadeColor(c.body, 0.93), accent: c.accent };
    case 9:
      return { kind: 'hazard', base: mixColor(c.trim, 0xb0bcc0, 0.5), a: mixColor(c.fence, 0xd0dadc, 0.6), b: mixColor(c.fence, 0xc2ced1, 0.6), accent: c.accent };
    default:
      return { kind: 'tiles', base: shadeColor(c.trim, 0.55), a: shadeColor(c.trim, 0.8), b: shadeColor(c.trim, 0.68), accent: c.accent, glow: c.glow };
  }
}

const TOP = 0.022;
const PIECE = 0.008;

/**
 * 10 m of road in `gp.era`'s paving, flat: a slab over the trail (and its ruts) with the era's pieces on it, the last
 * 0.7 m at each end stepping back to the trail colour. `y` = the road's surface height. Roads at gates run along X.
 */
export function addGatePaving(b: Batch, glow: Batch, gp: GatePaving, y: number, rng: Rng): void {
  const s = pavingStyle(gp.era);
  const r = gp.rect;
  const W = r.maxZ - r.minZ - 0.12;
  const cz = (r.minZ + r.maxZ) / 2;
  const z0 = cz - W / 2;
  const END = 0.7;
  const x0 = r.minX + END;
  const x1 = r.maxX - END;
  const top = y + TOP;
  // the slab (hides the trail's ruts) and the stepped, blended ends
  b.add(geo.box(x1 - x0, TOP, W), s.base, (x0 + x1) / 2, y + TOP / 2 - 0.0005, cz);
  for (const [ex, dir] of [[r.minX, 1], [r.maxX, -1]] as const) {
    b.add(geo.box(END / 2, TOP - 0.006, W), mixColor(s.a, TRAIL_COLOR, 0.72), ex + (dir * END) / 4, y + (TOP - 0.006) / 2, cz);
    b.add(geo.box(END / 2, TOP - 0.003, W), mixColor(s.a, TRAIL_COLOR, 0.38), ex + dir * (END * 0.75), y + (TOP - 0.003) / 2, cz);
  }
  const piece = (w: number, d: number, x: number, z: number, color: number, h = PIECE): void => {
    b.add(geo.box(w, h, d), color, x, top + h / 2 - 0.0005, z);
  };
  const tint = (c: number, k = 0.07): number => shadeColor(c, 1 - k / 2 + rng.next() * k);
  const grid = (cellX: number, cellZ: number, gap: number, f: (cx: number, cz: number, w: number, d: number, i: number, j: number) => void): void => {
    const nx = Math.max(1, Math.round((x1 - x0) / cellX));
    const nz = Math.max(1, Math.round(W / cellZ));
    const sx = (x1 - x0) / nx;
    const sz = W / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) f(x0 + (i + 0.5) * sx, z0 + (j + 0.5) * sz, sx - gap, sz - gap, i, j);
  };
  switch (s.kind) {
    case 'planks':
      // boards across the road, alternating shades, a nail line along each edge
      grid(0.46, W, 0.05, (cx, cz2, w, d, i) => {
        piece(w, d - 0.1, cx, cz2, tint(i % 2 ? s.a : s.b, 0.1));
      });
      for (const e of [-1, 1]) b.add(geo.box(x1 - x0, 0.012, 0.1), s.accent, (x0 + x1) / 2, top + 0.004, cz + e * (W / 2 - 0.12));
      break;
    case 'brick': {
      const rows = Math.max(1, Math.round(W / 0.3));
      const rh = W / rows;
      for (let j = 0; j < rows; j++) {
        let x = x0 - (j % 2) * 0.3;
        while (x < x1) {
          const w = 0.62 + rng.next() * 0.16;
          const a = Math.max(x, x0);
          const e = Math.min(x + w, x1);
          if (e - a > 0.2) piece(e - a - 0.04, rh - 0.045, (a + e) / 2, z0 + (j + 0.5) * rh, tint(rng.next() < 0.3 ? s.b : s.a, 0.16));
          x += w;
        }
      }
      break;
    }
    case 'plates':
      grid(1.0, 1.0, 0.06, (cx, cz2, w, d, i, j) => {
        piece(w, d, cx, cz2, tint((i + j) % 2 ? s.a : s.b));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) piece(0.08, 0.08, cx + sx * (w / 2 - 0.1), cz2 + sz * (d / 2 - 0.1), s.accent, PIECE + 0.006);
      });
      break;
    case 'steel':
      grid(2.0, 1.0, 0.07, (cx, cz2, w, d, i, j) => {
        piece(w, d, cx, cz2, tint((i + j) % 2 ? s.a : s.b));
        piece(w - 0.5, 0.06, cx, cz2, s.accent, PIECE + 0.004);
      });
      break;
    case 'slabs':
    case 'hazard': {
      grid(2.4, 2.0, 0.07, (cx, cz2, w, d) => piece(w, d, cx, cz2, tint(rng.next() < 0.5 ? s.a : s.b, 0.08)));
      // edge dashes: an accent line (slabs) or alternating hazard stripes (hazard)
      const hazard = s.kind === 'hazard';
      const step = hazard ? 0.5 : 1.2;
      for (let x = x0 + 0.1, k = 0; x < x1 - 0.4; x += step, k++) {
        for (const e of [-1, 1]) {
          piece(step - (hazard ? 0.02 : 0.5), 0.2, x + step / 2, cz + e * (W / 2 - 0.22), hazard && k % 2 ? shadeColor(ERAS[gp.era]!.colors.trim, 1) : s.accent, PIECE + 0.004);
        }
      }
      break;
    }
    case 'panels':
      grid(2.0, 1.0, 0.07, (cx, cz2, w, d, i, j) => {
        piece(w, d, cx, cz2, tint((i + j) % 2 ? s.a : s.b, 0.05));
        piece(w - 0.4, 0.05, cx, cz2, s.accent, PIECE + 0.004);
      });
      break;
    default:
      // glassy dark tiles with glowing joints
      grid(1.0, 1.0, 0.1, (cx, cz2, w, d, i, j) => {
        piece(w, d, cx, cz2, tint((i + j) % 2 ? s.a : s.b, 0.12));
      });
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.max(1, Math.round(x1 - x0))) glow.add(geo.box(0.05, 0.004, W), s.glow ?? 0xffe082, x, top + 0.003, cz);
      for (let j = 0; j <= Math.max(1, Math.round(W)); j++) glow.add(geo.box(x1 - x0, 0.004, 0.05), s.glow ?? 0xffe082, (x0 + x1) / 2, top + 0.003, z0 + (j * W) / Math.max(1, Math.round(W)));
      break;
  }
}

const STONES = [0xb4c0d0, 0xa9b6c8, 0xbfc9d6, 0xb0b9c9, 0xc3c7d0, 0xa4b1c4];

/**
 * The south avenue's apron: the Market Town's square cobbles carried through the fence gap to the avenue. A slab at the
 * square's height with staggered stones and dark kerb stones, its trail end blended (the avenue itself does that).
 */
export function addApron(b: Batch, r: Rect, rng: Rng): void {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const cx = (r.minX + r.maxX) / 2;
  const top = 0.056;
  b.add(geo.box(w, 0.012, d), 0x8f9db1, cx, top - 0.006, (r.minZ + r.maxZ) / 2);
  let row = 0;
  for (let z = r.minZ + 0.05; z < r.maxZ - 0.1; z += 0.3, row++) {
    let x = r.minX + 0.3 + (row % 2 ? -0.22 : 0);
    while (x < r.maxX - 0.3) {
      const sw = 0.4 + rng.next() * 0.2;
      const a = Math.max(x, r.minX + 0.3);
      const e = Math.min(x + sw, r.maxX - 0.3);
      if (e - a > 0.15) b.add(geo.box(e - a - 0.04, 0.014, 0.26), shadeColor(STONES[Math.floor(rng.next() * STONES.length)]!, 0.94 + rng.next() * 0.12), (a + e) / 2, top + 0.002, Math.min(z + 0.15, r.maxZ - 0.15));
      x += sw;
    }
  }
  for (const side of [-1, 1]) {
    for (let z = r.minZ + 0.2; z < r.maxZ - 0.2; z += 0.34) {
      b.add(geo.box(0.3, 0.02, 0.3), shadeColor(0x8a96a8, 0.9 + rng.next() * 0.2), cx + side * (w / 2 - 0.17), top + 0.004, z);
    }
  }
}
