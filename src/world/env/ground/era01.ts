/**
 * [0.9.8 — 10a] Era 1 Survival: the forest and the log. The old map keeps its layout, pads and gameplay exactly
 * (era1Frozen); only its look changes (decision 10):
 * - the yard is packed earth (palette(1).floor.yard): a tileable painted texture, mottled, with pebbles and pale wood
 *   chips from the logging, instead of one flat colour (`packedEarth`, used by world/env/ground.ts);
 * - the customers' fenced snow lane becomes a plank boardwalk (palette(1).floor.processing);
 * - cut stumps (one with the axe still in it) and log piles stand in the snow round the yard, where the old scatter's
 *   keep-out rules allow (low: they hide nothing).
 */
import * as THREE from 'three';
import { LAYOUT } from '../../../config';
import { Batch } from '../../../render/batch';
import { geo, makeCanvasTexture, toonUnique } from '../../../render/materials';
import { mixHex, palette, SNOW } from '../../../render/palette';
import { blocked, blockedNewLand, occludes, type Rng } from '../common';
import type { GroundKit } from '../eraGround';
import { shade } from './kit1to3';

const P1 = palette(1);
const C = {
  earth: P1.floor.yard,
  plank: P1.floor.processing,
  bark: P1.body,
  barkDark: P1.trim,
  ring: mixHex(P1.floor.processing, P1.light, 0.35),
  chip: mixHex(P1.floor.processing, 0xffffff, 0.3),
  pebble: mixHex(P1.floor.yard, 0xe8e2da, 0.55),
  axe: P1.accent,
};

/** Metres per texture tile. */
const TILE = 8;
const hexCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

let earthMat: THREE.MeshToonMaterial | null = null;

/** Shared packed-earth material (tileable map; UVs in metres / TILE, see `earthUV`). */
export function packedEarth(rng: Rng): THREE.MeshToonMaterial {
  if (earthMat) return earthMat;
  const px = 512;
  const { ctx: g, texture } = makeCanvasTexture(px, px);
  g.fillStyle = hexCss(C.earth);
  g.fillRect(0, 0, px, px);
  const s = px / TILE;
  // draw wrapped round the tile edges so it repeats without seams
  const wrap = (x: number, y: number, r: number, fn: (x: number, y: number) => void): void => {
    for (const dx of [-px, 0, px]) for (const dy of [-px, 0, px]) if (x + dx > -r && x + dx < px + r && y + dy > -r && y + dy < px + r) fn(x + dx, y + dy);
  };
  // soft mottling: lighter and darker trodden patches
  for (let i = 0; i < 46; i++) {
    const x = rng.range(0, px);
    const y = rng.range(0, px);
    const r = rng.range(0.4, 1.3) * s;
    const col = shade(C.earth, rng.next() < 0.5 ? 0.93 : 1.06);
    wrap(x, y, r, (cx, cy) => {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `${hexCss(col)}cc`);
      grad.addColorStop(1, `${hexCss(col)}00`);
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    });
  }
  // pebbles, each with a little shadow below it
  for (let i = 0; i < 150; i++) {
    const x = rng.range(0, px);
    const y = rng.range(0, px);
    const r = rng.range(0.035, 0.08) * s;
    const col = shade(C.pebble, rng.range(0.9, 1.08));
    wrap(x, y, r * 2, (cx, cy) => {
      g.fillStyle = `${hexCss(shade(C.earth, 0.78))}aa`;
      g.beginPath();
      g.ellipse(cx + r * 0.25, cy + r * 0.35, r, r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hexCss(col);
      g.beginPath();
      g.ellipse(cx, cy, r, r * 0.78, rng.range(0, 3), 0, Math.PI * 2);
      g.fill();
    });
  }
  // pale wood chips from the logging
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, px);
    const y = rng.range(0, px);
    const w = rng.range(0.08, 0.18) * s;
    const a = rng.range(0, Math.PI);
    wrap(x, y, w, (cx, cy) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      g.fillStyle = hexCss(shade(C.chip, rng.range(0.92, 1.05)));
      g.fillRect(-w / 2, -w * 0.18, w, w * 0.36);
      g.restore();
    });
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  earthMat = toonUnique(0xffffff, { map: texture });
  return earthMat;
}

/** A ground plane w × d (lying in XZ) with UVs in metres / TILE, offset by its world corner so tiles line up. */
export function earthPlane(w: number, d: number, x0: number, z0: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + x0) / TILE, -(pos.getZ(i) + z0) / TILE);
  uv.needsUpdate = true;
  return g;
}

let stump: THREE.BufferGeometry | null = null;
/** A fat cut stump with rings and a snow cap (≈ 0.55 m), roots splayed. */
function stumpGeo(): THREE.BufferGeometry {
  if (!stump) {
    const b = new Batch();
    b.add(geo.cylinder(0.36, 0.44, 0.5, 9), C.bark, 0, 0.25, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      b.add(geo.cylinder(0.08, 0.13, 0.5, 6), shade(C.bark, 0.9), Math.cos(a) * 0.4, 0.07, Math.sin(a) * 0.4, { rz: Math.cos(a) * 1.2, rx: -Math.sin(a) * 1.2 });
    }
    b.add(geo.cylinder(0.37, 0.37, 0.03, 9), C.ring, 0, 0.51, 0);
    b.add(geo.cylinder(0.2, 0.2, 0.035, 9), shade(C.ring, 0.88), 0, 0.515, 0);
    b.add(geo.sphere(0.3, 10, 6), SNOW, 0.04, 0.54, -0.02, { sy: 0.28 });
    stump = b.geometry();
  }
  return stump;
}

let axeStump: THREE.BufferGeometry | null = null;
/** The stump with the axe left in it. */
function axeStumpGeo(): THREE.BufferGeometry {
  if (!axeStump) {
    const b = new Batch();
    b.add(geo.cylinder(0.4, 0.48, 0.55, 9), C.bark, 0, 0.27, 0);
    b.add(geo.cylinder(0.41, 0.41, 0.03, 9), C.ring, 0, 0.56, 0);
    b.add(geo.box(0.05, 0.75, 0.07), shade(C.plank, 0.9), 0.12, 0.92, 0, { rz: -0.35 });
    b.add(geo.box(0.26, 0.16, 0.05), C.axe, -0.02, 0.6, 0, { rz: -0.35 });
    b.add(geo.sphere(0.2, 8, 5), SNOW, -0.18, 0.6, 0.12, { sy: 0.3 });
    axeStump = b.geometry();
  }
  return axeStump;
}

let logs: THREE.BufferGeometry | null = null;
/** A pile of six logs (3-2-1) with snow along the top (≈ 1 m). */
function logPileGeo(): THREE.BufferGeometry {
  if (!logs) {
    const b = new Batch();
    let y = 0.22;
    for (const n of [3, 2, 1]) {
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * 0.44;
        b.add(geo.cylinder(0.22, 0.22, 1.8, 9), shade(C.bark, 0.95 + (i % 2) * 0.08), 0, y, z, { rz: Math.PI / 2 });
        for (const x of [-0.905, 0.905]) b.add(geo.cylinder(0.2, 0.2, 0.02, 9), C.ring, x, y, z, { rz: Math.PI / 2 });
      }
      y += 0.38;
    }
    b.add(geo.box(1.7, 0.08, 0.3), SNOW, 0, y - 0.12, 0);
    logs = b.geometry();
  }
  return logs;
}

/** Era 1's dressing: the boardwalk, stumps and log piles. */
export function era01Dress(k: GroundKit, rng: Rng): void {
  // ---- the customers' lane: a plank boardwalk on two stringers
  const p = LAYOUT.customers.path;
  const w = p.maxX - p.minX;
  const cx = (p.minX + p.maxX) / 2;
  for (const x of [p.minX + 0.5, p.maxX - 0.5]) k.floor.add(geo.box(1, 1, 1), shade(C.plank, 0.7), x, 0.02, (p.minZ + p.maxZ) / 2, { sx: 0.2, sy: 0.03, sz: p.maxZ - p.minZ });
  for (let z = p.minZ + 0.2; z < p.maxZ - 0.1; z += 0.34) {
    const len = w - 0.25 + rng.range(-0.15, 0.1);
    k.floor.add(geo.box(1, 1, 1), shade(C.plank, rng.range(0.9, 1.06)), cx + rng.range(-0.06, 0.06), 0.034, z, { sx: len, sy: 0.012, sz: 0.3, ry: rng.range(-0.02, 0.02) });
    if (rng.next() < 0.35) k.floor.add(geo.box(1, 1, 1), SNOW, cx + rng.range(-1.4, 1.4), 0.041, z, { sx: rng.range(0.4, 1.2), sy: 0.004, sz: 0.22 });
  }

  // ---- stumps and log piles in the snow round the yard (low: never hide a pad, kept off every path)
  const spots: { x: number; z: number; r: number }[] = [];
  const fits = (x: number, z: number, r: number): boolean =>
    !blocked(x, z, r + 0.4) && !blockedNewLand(x, z, r) && !occludes(x, z, 1.0) && spots.every((s) => Math.hypot(s.x - x, s.z - z) > s.r + r + 1.5);
  const place = (kind: string, geom: () => THREE.BufferGeometry, n: number, r: number): void => {
    for (let t = 0, got = 0; t < 400 && got < n; t++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(13.5, 24);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d - 2;
      if (!fits(x, z, r)) continue;
      spots.push({ x, z, r });
      const s = rng.range(0.85, 1.15);
      k.put(kind, geom, { x, z, ry: rng.range(0, 6.28), sx: s, sy: s, sz: s, tint: rng.range(0.94, 1.04) });
      got++;
    }
  };
  place('stump', stumpGeo, 9, 0.6);
  place('axeStump', axeStumpGeo, 1, 0.6);
  place('logPile', logPileGeo, 3, 1.1);
}
