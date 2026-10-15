/**
 * [T4 — wave 9] Canvas-painted ground surfaces (cosy, hand-laid look; one plane + one texture each):
 * gravel (the Village era's street) and cobbles (Town era street, the corridor and the market square).
 * Textures are painted lazily and cached by their parameters. World size → pixels at `ppm` px per metre.
 */
import * as THREE from 'three';
import { makeCanvasTexture } from '../../render/materials';
import { Rng } from './common';

export interface CobbleOptions {
  ppm?: number;
  seed?: number;
  /** Plaza ring: centre in metres from the texture's top-left corner, inner / outer radius (accent stones). */
  ring?: { x: number; z: number; r0: number; r1: number };
  /** Accent runner: a band of accent stones from the left edge to the ring (z = centre line from the top, width). */
  runner?: { z: number; w: number; toX: number };
  /** Dark kerb stones around the edge (metres). */
  kerb?: number;
  /** Snow dusting amount 0..1. */
  snow?: number;
}

const cache = new Map<string, THREE.CanvasTexture>();

const STONES = ['#b4c0d0', '#a9b6c8', '#bfc9d6', '#b0b9c9', '#c3c7d0', '#a4b1c4'];
const ACCENT = ['#d9c4a0', '#cdb68f', '#e0cfae', '#c9ae86'];

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function finish(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Rounded stones laid in staggered rows over a grout colour, with snow dusted in the joints. */
export function cobbleTexture(w: number, d: number, o: CobbleOptions = {}): THREE.CanvasTexture {
  const ppm = o.ppm ?? 56;
  const key = `cobble|${w}|${d}|${JSON.stringify(o)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = Math.round(w * ppm);
  const H = Math.round(d * ppm);
  const { ctx: g, texture } = makeCanvasTexture(W, H);
  const rng = new Rng(o.seed ?? 11);
  g.fillStyle = '#8f9db1';
  g.fillRect(0, 0, W, H);
  const kerb = (o.kerb ?? 0) * ppm;
  const rowH = 0.3 * ppm;
  let row = 0;
  for (let y = 0; y < H; y += rowH, row++) {
    let x = row % 2 ? -0.22 * ppm : 0;
    const h = Math.min(rowH, H - y);
    while (x < W) {
      const sw = (0.4 + rng.next() * 0.2) * ppm;
      const cx = x + sw / 2;
      const cy = y + h / 2;
      const px = cx / ppm;
      const pz = cy / ppm;
      let col = rng.pick(STONES);
      if (kerb > 0 && (cx < kerb || cx > W - kerb || cy < kerb || cy > H - kerb)) col = shade('#8a96a8', 0.9 + rng.next() * 0.2);
      else if (o.ring && Math.abs(Math.hypot(px - o.ring.x, pz - o.ring.z) - (o.ring.r0 + o.ring.r1) / 2) < (o.ring.r1 - o.ring.r0) / 2) col = rng.pick(ACCENT);
      else if (o.runner && Math.abs(pz - o.runner.z) < o.runner.w / 2 && px < o.runner.toX) col = rng.pick(ACCENT);
      col = shade(col, 0.94 + rng.next() * 0.12);
      const r = Math.min(sw, h) * 0.28;
      const ix = x + 1.5;
      const iy = y + 1.5;
      const iw = sw - 3;
      const ih = h - 3;
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(ix, iy, iw, ih, r);
      g.fill();
      // top-left lit edge + bottom-right shade: a chunky toy-block feel
      g.lineWidth = 1.4;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.moveTo(ix + r, iy + 0.7);
      g.lineTo(ix + iw - r, iy + 0.7);
      g.stroke();
      g.strokeStyle = 'rgba(40,55,85,0.22)';
      g.beginPath();
      g.moveTo(ix + r, iy + ih - 0.7);
      g.lineTo(ix + iw - r, iy + ih - 0.7);
      g.stroke();
      x += sw;
    }
  }
  // snow dusting: soft white blobs, thicker toward the edges
  const blobs = Math.round(W * H * (o.snow ?? 0.5) * 0.00035);
  for (let i = 0; i < blobs; i++) {
    const bx = rng.next() * W;
    const by = rng.next() * H;
    const edge = Math.min(bx, by, W - bx, H - by) / Math.max(W, H);
    if (rng.next() > 0.55 + (1 - Math.min(1, edge * 6)) * 0.45) continue;
    const br = (0.1 + rng.next() * 0.28) * ppm;
    const grad = g.createRadialGradient(bx, by, 0, bx, by, br);
    grad.addColorStop(0, 'rgba(250,253,255,0.7)');
    grad.addColorStop(1, 'rgba(250,253,255,0)');
    g.fillStyle = grad;
    g.fillRect(bx - br, by - br, br * 2, br * 2);
  }
  const t = finish(texture);
  cache.set(key, t);
  return t;
}

/** Packed gravel: warm grey speckle, two darker wheel tracks, snow at the edges. */
export function gravelTexture(w: number, d: number, ppm = 48): THREE.CanvasTexture {
  const key = `gravel|${w}|${d}|${ppm}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = Math.round(w * ppm);
  const H = Math.round(d * ppm);
  const { ctx: g, texture } = makeCanvasTexture(W, H);
  const rng = new Rng(5);
  g.fillStyle = '#c8c4bc';
  g.fillRect(0, 0, W, H);
  // wheel tracks
  for (const f of [0.3, 0.7]) {
    const grad = g.createLinearGradient((f - 0.09) * W, 0, (f + 0.09) * W, 0);
    grad.addColorStop(0, 'rgba(120,112,104,0)');
    grad.addColorStop(0.5, 'rgba(120,112,104,0.35)');
    grad.addColorStop(1, 'rgba(120,112,104,0)');
    g.fillStyle = grad;
    g.fillRect((f - 0.09) * W, 0, 0.18 * W, H);
  }
  const specks = Math.round(W * H * 0.05);
  const cols = ['#a39d93', '#b9b4aa', '#d9d5cc', '#8f8a82', '#e6e2d8', '#b3a79a'];
  for (let i = 0; i < specks; i++) {
    g.fillStyle = rng.pick(cols);
    const s = 1 + rng.next() * 2.4;
    g.fillRect(rng.next() * W, rng.next() * H, s, s * (0.6 + rng.next() * 0.6));
  }
  // snow along both edges
  for (const side of [0, 1]) {
    const grad = g.createLinearGradient(side ? W : 0, 0, side ? W - 0.5 * ppm : 0.5 * ppm, 0);
    grad.addColorStop(0, 'rgba(244,249,253,0.95)');
    grad.addColorStop(1, 'rgba(244,249,253,0)');
    g.fillStyle = grad;
    g.fillRect(side ? W - 0.5 * ppm : 0, 0, 0.5 * ppm, H);
  }
  const t = finish(texture);
  cache.set(key, t);
  return t;
}
