/**
 * [B3 — world/ridge] AssetFactory: the crew bunkhouse of Timber Ridge (3 tiers: bunkhouse, crew lodge, crew hall)
 * and the small props of the ridge. Same cosy log-cabin look as assets/shelters.ts: every model is ONE
 * vertex-coloured mesh (+ one emissive window mesh), geometry cached.
 *
 * Conventions: origin = floor centre, the DOOR faces local +Z, footprint ≈ LAYOUT.ridge.quarters (5.0 × 3.2).
 *
 *   createQuarters(tier)   0 bunkhouse, 1 crew lodge, 2 crew hall
 *   QUARTERS_CHIMNEY[tier] chimney mouth (local, y-up)
 *   createQuartersSite()   staked outline of the empty site (shown until the first payment)
 *   bushGeo()              snowy shrub (instanced by ridge/Ridge.ts)
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../config';
import { Batch, vcMat } from '../render/batch';
import { toon } from '../render/materials';

const ROOF_RED = 0xc4472f;
const ROOF_RED_DARK = 0x9e3524;
const ROOF_BROWN = 0x7a4a2a;
const ROOF_BROWN_DARK = 0x5f3a20;
const DOOR = 0x5a3820;
const WARM = 0xffd978;
const STONE = PALETTE.rock;
const SNOW = COLORS.SNOW_WHITE;

/** Chimney mouths (local), per tier. */
export const QUARTERS_CHIMNEY: readonly THREE.Vector3[] = [
  new THREE.Vector3(-1.4, 2.4, -0.6),
  new THREE.Vector3(-1.5, 4.2, -0.4),
  new THREE.Vector3(-1.7, 4.5, -0.5),
];

const box = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------------------
// building blocks (same vocabulary as assets/shelters.ts)
// ---------------------------------------------------------------------------

function logWalls(b: Batch, w: number, d: number, rows: number, y0: number, colA: number, colB: number, r = 0.14): void {
  const pitch = r * 2;
  const alongX = new THREE.CylinderGeometry(r, r, w, 8).rotateZ(Math.PI / 2);
  const alongZ = new THREE.CylinderGeometry(r, r, d, 8).rotateX(Math.PI / 2);
  for (let i = 0; i < rows; i++) {
    const y = y0 + r + i * pitch;
    const odd = i % 2 === 1;
    for (const s of [-1, 1]) {
      b.add(alongX, odd ? colA : colB, 0, y, (s * (d - pitch)) / 2);
      b.add(alongZ, odd ? colB : colA, (s * (w - pitch)) / 2, y, 0);
    }
  }
  b.add(box(w - pitch * 1.1, rows * pitch, d - pitch * 1.1), PALETTE.barkDark, 0, y0 + (rows * pitch) / 2, 0);
}

/** Gable roof (ridge along X) centred at z; slabs, snow, ridge snow and both gable triangles. */
function roofAt(b: Batch, w: number, d: number, z: number, eaveY: number, rise: number, c1: number, c2: number, gableColor: number, overhang = 0.25): void {
  const run = d / 2 + overhang;
  const ang = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise) + 0.08;
  const len = w + overhang * 2;
  const slab = box(len, 0.14, slope);
  const snow = box(len - 0.3, 0.16, slope - 0.5);
  for (const s of [-1, 1]) {
    const cz = z + (s * run) / 2;
    const cy = eaveY + rise / 2;
    b.add(slab, s > 0 ? c1 : c2, 0, cy, cz, { rx: s * ang });
    b.add(snow, SNOW, 0, cy + 0.15 + 0.1 * Math.cos(ang), cz - s * 0.22 * Math.cos(ang), { rx: s * ang });
  }
  b.add(box(len, 0.12, 0.26), SNOW, 0, eaveY + rise + 0.12, z);
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2 + 0.05, 0), new THREE.Vector2(d / 2 - 0.05, 0), new THREE.Vector2(0, rise - 0.04)]);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.22, bevelEnabled: false }).rotateY(Math.PI / 2);
  for (const s of [-1, 1]) b.add(gable, gableColor, (s * (w - 0.3)) / 2 - 0.11, eaveY, z);
}

function chimney(b: Batch, x: number, z: number, baseY: number, topY: number): void {
  const h = topY - baseY;
  b.add(box(0.46, h, 0.46), STONE, x, baseY + h / 2, z);
  b.add(box(0.6, 0.12, 0.6), PALETTE.rockDark, x, topY - 0.02, z);
  b.add(box(0.52, 0.09, 0.52), SNOW, x, topY + 0.08, z);
}

function windowAt(body: Batch, glow: Batch, x: number, y: number, z: number, ry: number, w = 0.46, h = 0.4): void {
  body.add(box(w + 0.16, h + 0.16, 0.08), PALETTE.fenceDark, x, y, z, { ry });
  const off = 0.04;
  glow.add(box(w, h, 0.06), WARM, x + Math.sin(ry) * off, y, z + Math.cos(ry) * off, { ry });
}

function door(b: Batch, x: number, z: number, w = 0.55, h = 0.95): void {
  b.add(box(w + 0.14, h + 0.1, 0.1), PALETTE.fenceDark, x, (h + 0.1) / 2, z);
  b.add(box(w, h, 0.12), DOOR, x, h / 2, z + 0.01);
  b.add(new THREE.SphereGeometry(0.05, 6, 4), COLORS.COURIER_YELLOW, x + w * 0.3, h * 0.5, z + 0.08);
}

/** A neat stack of firewood lying along Z (3 + 2 + 1 logs). */
function woodpile(b: Batch, x: number, z: number, len = 0.8): void {
  const lg = new THREE.CylinderGeometry(0.1, 0.1, len, 6).rotateX(Math.PI / 2);
  let n = 0;
  for (const [count, y] of [[3, 0.1], [2, 0.29], [1, 0.46]] as const) {
    for (let i = 0; i < count; i++) b.add(lg, n++ % 2 ? PALETTE.plank : PALETTE.bark, x + (i - (count - 1) / 2) * 0.21, y, z);
  }
  b.add(box(0.7, 0.06, len + 0.1), SNOW, x, 0.56, z);
}

/** Lantern post with a glowing lamp. */
function lantern(body: Batch, glow: Batch, x: number, z: number, h = 1.7): void {
  body.add(box(0.08, h, 0.08), PALETTE.fenceDark, x, h / 2, z);
  body.add(box(0.3, 0.05, 0.3), PALETTE.metalDark, x, h + 0.1, z);
  glow.add(box(0.2, 0.24, 0.2), WARM, x, h - 0.04, z);
}

interface Baked {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
}

let glowMaterial: THREE.MeshToonMaterial | null = null;
function glowMat(): THREE.MeshToonMaterial {
  glowMaterial ??= toon(WARM, { emissive: 0xffb347, emissiveIntensity: 0.65 });
  return glowMaterial;
}

function modelOf(baked: Baked, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const body = new THREE.Mesh(baked.body, vcMat());
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const glow = new THREE.Mesh(baked.glow, glowMat());
  glow.castShadow = false;
  glow.receiveShadow = false;
  g.add(glow);
  return g;
}

// ---------------------------------------------------------------------------
// tier 0 — bunkhouse: one long low log hut, porch, firewood
// ---------------------------------------------------------------------------

function bakeBunkhouse(W: number, D: number): Baked {
  const b = new Batch();
  const glow = new Batch();
  const w = W - 0.5;
  const d = D - 0.9;
  b.add(box(w + 0.15, 0.12, d + 0.15), STONE, 0, 0.06, 0);
  logWalls(b, w, d, 5, 0.1, PALETTE.fence, PALETTE.plank);
  const eave = 1.5;
  roofAt(b, w, d, 0, eave, 0.95, ROOF_BROWN, ROOF_BROWN_DARK, PALETTE.fence, 0.34);
  chimney(b, -1.4, -0.6, eave + 0.2, 2.4);
  // door in the middle, a window pair each side (a row of bunks behind them)
  door(b, 0.0, d / 2 - 0.02, 0.62, 1.05);
  for (const x of [-1.5, -0.8, 0.8, 1.5]) windowAt(b, glow, x, 0.85, d / 2 + 0.02, 0, 0.4, 0.36);
  for (const s of [-1, 1]) windowAt(b, glow, (s * w) / 2 + s * 0.02, 0.85, 0, (s * Math.PI) / 2, 0.44, 0.38);
  // porch: two posts, a small roof and a bench
  for (const x of [-0.75, 0.75]) b.add(box(0.12, 1.3, 0.12), PALETTE.fenceDark, x, 0.65, d / 2 + 0.62);
  b.add(box(1.9, 0.1, 0.85), PALETTE.plank, 0, 1.33, d / 2 + 0.38, { rx: 0.18 });
  b.add(box(1.7, 0.08, 0.6), SNOW, 0, 1.43, d / 2 + 0.38, { rx: 0.18 });
  b.add(box(1.5, 0.06, 0.55), PALETTE.plank, 0, 0.03, d / 2 + 0.55);
  b.add(box(0.8, 0.08, 0.26), PALETTE.plank, -1.35, 0.42, d / 2 + 0.3);
  for (const x of [-1.7, -1.0]) b.add(box(0.07, 0.4, 0.2), PALETTE.fenceDark, x, 0.2, d / 2 + 0.3);
  woodpile(b, w / 2 + 0.55, -0.1, 1.1);
  woodpile(b, w / 2 + 0.55, -1.0, 0.8);
  lantern(b, glow, 1.35, d / 2 + 0.75, 1.3);
  return { body: b.geometry(), glow: glow.geometry() };
}

// ---------------------------------------------------------------------------
// tier 1 — crew lodge: two storeys, balcony, two chimneys
// ---------------------------------------------------------------------------

function bakeLodge(W: number, D: number): Baked {
  const b = new Batch();
  const glow = new Batch();
  const w = W - 0.4;
  const d = D - 0.7;
  b.add(box(w + 0.15, 0.12, d + 0.15), STONE, 0, 0.06, 0);
  logWalls(b, w, d, 5, 0.1, PALETTE.fence, PALETTE.plank, 0.14);
  const floorY = 1.55;
  // balcony across the front
  b.add(box(w + 0.1, 0.12, 0.2), PALETTE.fenceDark, 0, floorY, d / 2 - 0.1);
  b.add(box(w, 0.1, 0.9), PALETTE.plank, 0, floorY + 0.02, d / 2 - 0.4);
  for (let i = 0; i <= 10; i++) b.add(box(0.07, 0.5, 0.07), PALETTE.fenceDark, -w / 2 + 0.05 + (i * (w - 0.1)) / 10, floorY + 0.35, d / 2);
  b.add(box(w, 0.07, 0.08), PALETTE.fenceDark, 0, floorY + 0.6, d / 2);
  // upper storey set back
  const upD = d - 0.9;
  const upZ = -0.45;
  b.add(box(w + 0.02, 1.2, upD), PALETTE.plank, 0, floorY + 0.6, upZ);
  for (const s of [-1, 1]) {
    b.add(box(0.12, 1.2, 0.12), PALETTE.fenceDark, (s * w) / 2, floorY + 0.6, upZ + upD / 2);
    b.add(box(0.12, 1.2, 0.12), PALETTE.fenceDark, (s * w) / 2, floorY + 0.6, upZ - upD / 2);
  }
  const eave = floorY + 1.2;
  roofAt(b, w, upD, upZ, eave, 1.0, ROOF_RED, ROOF_RED_DARK, PALETTE.plank, 0.3);
  chimney(b, -1.5, -0.4, eave + 0.2, 4.2);
  chimney(b, 1.5, -0.4, eave + 0.2, 3.8);
  // ground floor: central door, windows
  door(b, 0.0, d / 2 - 0.02, 0.66, 1.15);
  for (const x of [-1.6, -0.9, 0.9, 1.6]) windowAt(b, glow, x, 0.9, d / 2 + 0.02, 0, 0.44, 0.42);
  for (const x of [-1.5, -0.5, 0.5, 1.5]) windowAt(b, glow, x, floorY + 0.7, upZ + upD / 2 + 0.02, 0, 0.44, 0.42);
  for (const s of [-1, 1]) {
    windowAt(b, glow, (s * w) / 2 + s * 0.02, 0.9, 0, (s * Math.PI) / 2, 0.5, 0.45);
    windowAt(b, glow, (s * w) / 2 + s * 0.08, floorY + 0.7, upZ, (s * Math.PI) / 2, 0.5, 0.45);
  }
  // stoop + woodpile + lantern
  b.add(box(1.4, 0.08, 0.6), STONE, 0, 0.04, d / 2 + 0.3);
  woodpile(b, w / 2 + 0.55, 0.0, 1.2);
  woodpile(b, -w / 2 - 0.55, 0.2, 1.2);
  lantern(b, glow, 0.95, d / 2 + 0.55, 1.4);
  lantern(b, glow, -0.95, d / 2 + 0.55, 1.4);
  return { body: b.geometry(), glow: glow.geometry() };
}

// ---------------------------------------------------------------------------
// tier 2 — crew hall: a long timber hall with a gabled porch, chimneys and flags
// ---------------------------------------------------------------------------

function bakeHall(W: number, D: number): Baked {
  const b = new Batch();
  const glow = new Batch();
  const w = W - 0.3;
  const d = D - 0.5;
  b.add(box(W, 0.14, D), STONE, 0, 0.07, 0);
  logWalls(b, w, d, 8, 0.12, PALETTE.fence, PALETTE.plank, 0.15);
  const eave = 2.45;
  roofAt(b, w, d, 0, eave, 1.55, ROOF_RED, ROOF_RED_DARK, PALETTE.fence, 0.36);
  // corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(box(0.26, eave, 0.26), PALETTE.fenceDark, (sx * w) / 2, eave / 2, (sz * d) / 2);
  // entrance porch: gabled block on the front, ridge along Z
  const pw = 1.9;
  b.add(box(pw, 2.2, 0.7), PALETTE.plank, 0, 1.22, d / 2 + 0.2);
  const pr = 0.95;
  const pang = Math.atan2(pr, pw / 2 + 0.2);
  const pslope = Math.hypot(pw / 2 + 0.2, pr) + 0.05;
  for (const s of [-1, 1]) {
    b.add(box(pslope, 0.14, 1.0), s > 0 ? ROOF_RED : ROOF_RED_DARK, (s * (pw / 2 + 0.2)) / 2, 2.32 + pr / 2, d / 2 + 0.25, { rz: -s * pang });
    b.add(box(pslope - 0.4, 0.14, 0.8), SNOW, (s * (pw / 2 + 0.2)) / 2 - s * 0.1, 2.32 + pr / 2 + 0.2, d / 2 + 0.25, { rz: -s * pang });
  }
  door(b, 0, d / 2 + 0.58, 0.95, 1.5);
  // chimneys + dormers
  chimney(b, -1.7, -0.5, eave + 0.3, 4.5);
  chimney(b, 1.7, -0.5, eave + 0.3, 4.2);
  for (const x of [-1.2, 1.2]) {
    b.add(box(0.8, 0.55, 0.5), PALETTE.plank, x, eave + 0.7, d / 2 - 0.45, { rx: 0 });
    b.add(box(1.0, 0.08, 0.7), ROOF_BROWN, x, eave + 1.0, d / 2 - 0.4, { rx: 0.25 });
    windowAt(b, glow, x, eave + 0.7, d / 2 - 0.19, 0, 0.4, 0.3);
  }
  // window rows
  for (const x of [-1.9, -1.3, 1.3, 1.9]) windowAt(b, glow, x, 1.3, d / 2 + 0.02, 0, 0.46, 0.5);
  for (const s of [-1, 1]) {
    windowAt(b, glow, (s * w) / 2 + s * 0.02, 1.3, 0.55, (s * Math.PI) / 2, 0.5, 0.5);
    windowAt(b, glow, (s * w) / 2 + s * 0.02, 1.3, -0.55, (s * Math.PI) / 2, 0.5, 0.5);
  }
  // flags on both ridge ends
  for (const s of [-1, 1]) {
    const x = (s * (w + 0.5)) / 2;
    b.add(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), PALETTE.fenceDark, x, eave + 1.55 + 0.45, 0);
    const flag = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 0.5), new THREE.Vector2(0.8, 0.25)]);
    b.add(new THREE.ExtrudeGeometry(flag, { depth: 0.03, bevelEnabled: false }).rotateY(-Math.PI / 2), s > 0 ? PALETTE.truckRed : COLORS.COURIER_YELLOW, x, eave + 2.5, 0);
  }
  // firewood on both sides, lanterns by the door
  woodpile(b, w / 2 + 0.55, 0.1, 1.3);
  woodpile(b, -w / 2 - 0.55, 0.1, 1.3);
  lantern(b, glow, 1.25, d / 2 + 0.75, 1.7);
  lantern(b, glow, -1.25, d / 2 + 0.75, 1.7);
  b.add(box(1.8, 0.08, 0.7), STONE, 0, 0.04, d / 2 + 0.6);
  return { body: b.geometry(), glow: glow.geometry() };
}

// ---------------------------------------------------------------------------
// site marker
// ---------------------------------------------------------------------------

function bakeSite(W: number, D: number): Baked {
  const b = new Batch();
  const hx = W / 2 - 0.1;
  const hz = D / 2 - 0.1;
  const stake = new THREE.CylinderGeometry(0.05, 0.07, 0.55, 6);
  const rope = 0xe0cfa8;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(stake, PALETTE.fence, sx * hx, 0.27, sz * hz);
      b.add(new THREE.SphereGeometry(0.07, 6, 4), COLORS.COURIER_YELLOW, sx * hx, 0.57, sz * hz);
    }
  }
  for (const s of [-1, 1]) {
    b.add(box(2 * hx, 0.03, 0.03), rope, 0, 0.4, s * hz);
    b.add(box(0.03, 0.03, 2 * hz), rope, s * hx, 0.4, 0);
  }
  // foundation sleepers + a stack of boards
  for (const x of [-1.4, 0, 1.4]) b.add(box(0.2, 0.1, 2 * hz - 0.4), PALETTE.barkDark, x, 0.05, 0);
  for (let i = 0; i < 4; i++) b.add(box(0.9, 0.08, 0.3), i % 2 ? PALETTE.plank : PALETTE.crate, hx - 0.8, 0.12 + i * 0.09, -hz + 0.5);
  // little "site" sign by the front-left stake
  b.add(box(0.07, 0.8, 0.07), PALETTE.fenceDark, -hx + 0.35, 0.4, hz + 0.18);
  b.add(box(0.55, 0.3, 0.05), COLORS.PLANK_WOOD, -hx + 0.35, 0.8, hz + 0.18);
  return { body: b.geometry(), glow: new THREE.BufferGeometry() };
}

// ---------------------------------------------------------------------------
// bush
// ---------------------------------------------------------------------------

let bush: THREE.BufferGeometry | null = null;
/** Snow-dusted shrub (≈0.7 m), vertex-coloured: render with vcMat(). */
export function bushGeo(): THREE.BufferGeometry {
  if (!bush) {
    const b = new Batch();
    const leaf = new THREE.IcosahedronGeometry(0.4, 1);
    b.add(leaf, 0x3a8c63, 0, 0.3, 0, { sy: 0.8 });
    b.add(leaf, PALETTE.pine, 0.32, 0.22, 0.12, { sx: 0.75, sy: 0.65, sz: 0.75 });
    b.add(leaf, 0x4aa06f, -0.28, 0.22, -0.1, { sx: 0.7, sy: 0.6, sz: 0.7 });
    b.add(new THREE.IcosahedronGeometry(0.34, 1), SNOW, 0.02, 0.5, 0, { sy: 0.4 });
    b.add(new THREE.SphereGeometry(0.06, 5, 4), PALETTE.truckRed, 0.34, 0.4, 0.3);
    b.add(new THREE.SphereGeometry(0.06, 5, 4), PALETTE.truckRed, -0.2, 0.42, 0.34);
    bush = b.geometry();
  }
  return bush;
}

// ---------------------------------------------------------------------------
// public factories
// ---------------------------------------------------------------------------

const cache: Partial<Record<'b0' | 'b1' | 'b2' | 'site', Baked>> = {};
const dims = (): { w: number; d: number } => ({ w: LAYOUT.ridge.quarters.w, d: LAYOUT.ridge.quarters.d });

/** tier = index into QUARTERS.tiers (0 bunkhouse, 1 crew lodge, 2 crew hall). */
export function createQuarters(tier: number): THREE.Group {
  const t = Math.max(0, Math.min(2, tier));
  const { w, d } = dims();
  const key = (['b0', 'b1', 'b2'] as const)[t]!;
  cache[key] ??= [bakeBunkhouse, bakeLodge, bakeHall][t]!(w, d);
  return modelOf(cache[key]!, ['bunkhouse', 'crewLodge', 'crewHall'][t]!);
}

/** Staked, empty building site (one non-shadow mesh pair). */
export function createQuartersSite(): THREE.Group {
  const { w, d } = dims();
  cache.site ??= bakeSite(w, d);
  const g = new THREE.Group();
  g.name = 'quartersSite';
  const m = new THREE.Mesh(cache.site.body, vcMat());
  m.receiveShadow = true;
  g.add(m);
  return g;
}

export const ridgeCatalog: Record<string, () => THREE.Object3D> = {
  bunkhouse: () => createQuarters(0),
  crewLodge: () => createQuarters(1),
  crewHall: () => createQuarters(2),
  quartersSite: () => createQuartersSite(),
};
