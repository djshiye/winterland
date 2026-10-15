/**
 * [B3 — world/village] AssetFactory: village shelters. Every model is built once from primitives, baked into
 * ONE vertex-coloured mesh (plus, for the ones with lit windows, one extra emissive non-shadow mesh) and the
 * geometry is cached, so a village of any size costs a handful of draw calls.
 *
 * Conventions: origin = floor centre, the DOOR faces local +Z (the village rotates a model to face the street),
 * footprint ≤ 2.8 × 2.8 m (the Great Lodge: LAYOUT.village.greatLodge 6 × 3.6).
 *
 *   createLot()            empty staked lot (stakes + rope + sale sign)
 *   createScaffold()       timber frame shown while a tier is being paid (handle: setProgress 0…1)
 *   createTent/Hut/Cabin/Lodge()   the four tiers (VILLAGE.tiers order)
 *   createShelter(tier)    tier index → model
 *   createGreatLodge()     timber hall; built to be placed with rotation.y = π (door toward −Z, the street)
 *                          and carries a roof-top WINTERLAND banner turned toward the camera
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../config';
import { Batch, vcMat } from '../render/batch';
import { GAME_FONT, makeCanvasTexture, toon } from '../render/materials';
import { registerGlow } from '../world/env/glow';

const CLOTH = 0xe9503a;
const CLOTH_LIGHT = 0xfff0d8;
const ROOF_RED = 0xc4472f;
const ROOF_RED_DARK = 0x9e3524;
const ROOF_BROWN = 0x7a4a2a;
const DOOR = 0x5a3820;
const WARM = 0xffd978;
const STONE = PALETTE.rock;
const SNOW = COLORS.SNOW_WHITE;

/** Chimney mouth (local, y-up) of the models that smoke. */
export const SHELTER_CHIMNEY = {
  cabin: new THREE.Vector3(-0.8, 2.0, -0.5),
  lodge: new THREE.Vector3(-1.05, 3.85, -0.3),
  greatLodge: new THREE.Vector3(-1.9, 4.5, -0.5),
} as const;

interface Baked {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
}

let glowMaterial: THREE.MeshToonMaterial | null = null;
function glowMat(): THREE.MeshToonMaterial {
  glowMaterial ??= registerGlow(toon(WARM, { emissive: 0xffb347, emissiveIntensity: 0.65 }));
  return glowMaterial;
}

function modelOf(baked: Baked, name: string, cast = true): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const body = new THREE.Mesh(baked.body, vcMat());
  body.castShadow = cast;
  body.receiveShadow = true;
  g.add(body);
  if (baked.glow) {
    const glow = new THREE.Mesh(baked.glow, glowMat());
    glow.castShadow = false;
    glow.receiveShadow = false;
    g.add(glow);
  }
  return g;
}


// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

const box = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d);

/** Horizontal log courses on the four walls of a w × d footprint (centred on the origin), `rows` high. */
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
  // solid core so the gaps between logs never show daylight
  b.add(box(w - pitch * 1.1, rows * pitch, d - pitch * 1.1), PALETTE.barkDark, 0, y0 + (rows * pitch) / 2, 0);
}

/** Gable roof, ridge along X. Returns nothing; adds slabs, snow, ridge snow and the two gable triangles. */
function gableRoof(b: Batch, w: number, d: number, eaveY: number, rise: number, color: number, colorB: number, gableColor: number, overhang = 0.25): void {
  const run = d / 2 + overhang;
  const ang = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise) + 0.08;
  const len = w + overhang * 2;
  const slab = box(len, 0.14, slope);
  const snow = box(len - 0.3, 0.16, slope - 0.5);
  for (const s of [-1, 1]) {
    const cz = (s * run) / 2;
    const cy = eaveY + rise / 2;
    b.add(slab, s > 0 ? color : colorB, 0, cy, cz, { rx: s * ang });
    b.add(snow, SNOW, 0, cy + 0.15 + 0.1 * Math.cos(ang), cz - s * 0.22 * Math.cos(ang), { rx: s * ang });
  }
  b.add(box(len, 0.12, 0.26), SNOW, 0, eaveY + rise + 0.12, 0);
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2 + 0.05, 0), new THREE.Vector2(d / 2 - 0.05, 0), new THREE.Vector2(0, rise - 0.04)]);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.22, bevelEnabled: false }).rotateY(Math.PI / 2);
  for (const s of [-1, 1]) b.add(gable, gableColor, (s * (w - 0.3)) / 2 - 0.11, eaveY, 0);
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
  const dx = Math.sin(ry) * off;
  const dz = Math.cos(ry) * off;
  glow.add(box(w, h, 0.06), WARM, x + dx, y, z + dz, { ry });
}

function door(b: Batch, x: number, z: number, w = 0.55, h = 0.95): void {
  b.add(box(w + 0.14, h + 0.1, 0.1), PALETTE.fenceDark, x, (h + 0.1) / 2, z);
  b.add(box(w, h, 0.12), DOOR, x, h / 2, z + 0.01);
  b.add(new THREE.SphereGeometry(0.05, 6, 4), COLORS.COURIER_YELLOW, x + w * 0.3, h * 0.5, z + 0.08);
}

// ---------------------------------------------------------------------------
// tiers
// ---------------------------------------------------------------------------

function bakeTent(): Baked {
  const b = new Batch();
  const halfW = 1.0;
  const H = 1.55;
  const D = 2.2;
  const tri = new THREE.Shape([new THREE.Vector2(-halfW, 0), new THREE.Vector2(halfW, 0), new THREE.Vector2(0, H)]);
  const seg = D / 3;
  for (let i = 0; i < 3; i++) {
    const g = new THREE.ExtrudeGeometry(tri, { depth: seg - 0.005, bevelEnabled: false });
    b.add(g, i === 1 ? CLOTH_LIGHT : CLOTH, 0, 0.02, -D / 2 + i * seg);
  }
  // snow caps along both slopes
  const slope = Math.hypot(halfW, H);
  const ang = Math.atan2(H, halfW);
  for (const s of [-1, 1]) {
    b.add(box(0.14, 0.08, D - 0.2), SNOW, s * 0.22, H - 0.12 + 0.02, 0, { rz: s * (Math.PI / 2 - ang) - 0 });
    b.add(box(slope * 0.34, 0.06, D * 0.7), SNOW, s * (halfW / 2 - 0.12), H / 2 + 0.52, 0, { rz: -s * ang + 0 });
  }
  // door opening + flaps
  const door = new THREE.Shape([new THREE.Vector2(-0.34, 0), new THREE.Vector2(0.34, 0), new THREE.Vector2(0, 1.0)]);
  b.add(new THREE.ExtrudeGeometry(door, { depth: 0.04, bevelEnabled: false }), DOOR, 0, 0.02, D / 2 + 0.005);
  for (const s of [-1, 1]) {
    const flap = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(s * 0.3, 0), new THREE.Vector2(0, 1.0)]);
    b.add(new THREE.ExtrudeGeometry(flap, { depth: 0.03, bevelEnabled: false }), CLOTH_LIGHT, s * 0.34, 0.02, D / 2 + 0.03);
  }
  // pegs + ropes
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 5), PALETTE.bark, sx * 1.22, 0.1, sz * 0.95, { rz: -sx * 0.4 });
    }
  }
  // pole + pennant
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), PALETTE.bark, 0, H + 0.3, D / 2 - 0.05);
  const pennant = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 0.26), new THREE.Vector2(0.5, 0.13)]);
  b.add(new THREE.ExtrudeGeometry(pennant, { depth: 0.02, bevelEnabled: false }).rotateY(-Math.PI / 2), COLORS.COURIER_YELLOW, 0, H + 0.45, D / 2 - 0.05);
  return { body: b.geometry(), glow: null };
}

function bakeHut(): Baked {
  const b = new Batch();
  const w = 2.0;
  const d = 1.9;
  logWalls(b, w, d, 4, 0.04, PALETTE.fence, PALETTE.plank);
  gableRoof(b, w, d, 1.13, 0.75, 0xf2f6fb, 0xe3edf6, PALETTE.fence, 0.22);
  // the roof of a hut is thatch-and-snow: put a thin dark rim under the snow
  door(b, 0.0, d / 2 - 0.02);
  for (const s of [-1, 1]) b.add(box(0.14, 1.1, 0.14), PALETTE.fenceDark, (s * w) / 2, 0.55, d / 2 - 0.05);
  for (const s of [-1, 1]) b.add(box(0.14, 1.1, 0.14), PALETTE.fenceDark, (s * w) / 2, 0.55, -d / 2 + 0.05);
  // log pile by the wall
  const lg = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 6).rotateX(Math.PI / 2);
  for (let i = 0; i < 3; i++) b.add(lg, i % 2 ? PALETTE.plank : PALETTE.bark, w / 2 + 0.2, 0.1, -0.4 + i * 0.2);
  b.add(lg, PALETTE.bark, w / 2 + 0.2, 0.28, -0.3);
  b.add(lg, PALETTE.plank, w / 2 + 0.2, 0.28, -0.1);
  return { body: b.geometry(), glow: null };
}

function bakeCabin(): Baked {
  const b = new Batch();
  const glow = new Batch();
  const w = 2.6;
  const d = 2.2;
  b.add(box(w + 0.15, 0.12, d + 0.15), STONE, 0, 0.06, 0);
  logWalls(b, w, d, 5, 0.1, PALETTE.fence, PALETTE.plank);
  gableRoof(b, w, d, 1.5, 0.95, ROOF_RED, ROOF_RED_DARK, PALETTE.fence, 0.26);
  chimney(b, -0.8, -0.5, 1.7, 2.0);
  door(b, 0.45, d / 2 - 0.02, 0.6, 1.05);
  windowAt(b, glow, -0.7, 0.85, d / 2 + 0.02, 0);
  windowAt(b, glow, w / 2 + 0.02, 0.85, 0.0, Math.PI / 2);
  windowAt(b, glow, -w / 2 - 0.02, 0.85, 0.0, -Math.PI / 2);
  b.add(box(1.0, 0.1, 0.45), STONE, 0.45, 0.05, d / 2 + 0.3);
  return { body: b.geometry(), glow: glow.geometry() };
}

function bakeLodge(): Baked {
  const b = new Batch();
  const glow = new Batch();
  const w = 2.7;
  const d = 2.4;
  b.add(box(w + 0.15, 0.12, d + 0.15), STONE, 0, 0.06, 0);
  logWalls(b, w, d, 5, 0.1, PALETTE.fence, PALETTE.plank, 0.14);
  const upD = d - 0.8;
  const upZ = -0.4;
  const floorY = 1.55;
  b.add(box(w + 0.1, 0.12, 0.2), PALETTE.fenceDark, 0, floorY, d / 2 - 0.1);
  b.add(box(w, 0.1, 0.85), PALETTE.plank, 0, floorY + 0.02, d / 2 - 0.4);
  for (let i = 0; i <= 6; i++) b.add(box(0.07, 0.5, 0.07), PALETTE.fenceDark, -w / 2 + 0.05 + (i * (w - 0.1)) / 6, floorY + 0.35, d / 2);
  b.add(box(w, 0.07, 0.08), PALETTE.fenceDark, 0, floorY + 0.6, d / 2);
  b.add(box(w + 0.02, 1.2, upD), PALETTE.plank, 0, floorY + 0.6, upZ);
  for (const s of [-1, 1]) {
    b.add(box(0.12, 1.2, 0.12), PALETTE.fenceDark, (s * w) / 2, floorY + 0.6, upZ + upD / 2);
    b.add(box(0.12, 1.2, 0.12), PALETTE.fenceDark, (s * w) / 2, floorY + 0.6, upZ - upD / 2);
  }
  const eave = floorY + 1.2;
  roofAt(b, w, upD, upZ, eave, 1.0, ROOF_BROWN, 0x5f3a20, PALETTE.plank, 0.28);
  chimney(b, -1.05, -0.3, eave + 0.2, eave + 1.7);
  door(b, 0.55, d / 2 - 0.02, 0.62, 1.15);
  windowAt(b, glow, -0.75, 0.9, d / 2 + 0.02, 0, 0.5, 0.45);
  windowAt(b, glow, -0.6, floorY + 0.7, upZ + upD / 2 + 0.02, 0, 0.5, 0.45);
  windowAt(b, glow, 0.6, floorY + 0.7, upZ + upD / 2 + 0.02, 0, 0.5, 0.45);
  windowAt(b, glow, w / 2 + 0.02, 0.9, 0.2, Math.PI / 2, 0.5, 0.45);
  windowAt(b, glow, w / 2 + 0.07, floorY + 0.7, upZ, Math.PI / 2, 0.5, 0.45);
  return { body: b.geometry(), glow: glow.geometry() };
}

/** gableRoof shifted along Z (the batch API has no group transform, so duplicate the call with an offset). */
function roofAt(b: Batch, w: number, d: number, z: number, eaveY: number, rise: number, c1: number, c2: number, gc: number, overhang: number): void {
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
  for (const s of [-1, 1]) b.add(gable, gc, (s * (w - 0.3)) / 2 - 0.11, eaveY, z);
}

// ---------------------------------------------------------------------------
// lot + scaffold
// ---------------------------------------------------------------------------

function bakeLot(): Baked {
  const b = new Batch();
  const h = 1.25;
  const stake = new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6);
  const rope = 0xe0cfa8;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(stake, PALETTE.fence, sx * h, 0.25, sz * h);
      b.add(new THREE.SphereGeometry(0.07, 6, 4), COLORS.COURIER_YELLOW, sx * h, 0.52, sz * h);
    }
  }
  for (const s of [-1, 1]) {
    b.add(box(2 * h, 0.03, 0.03), rope, 0, 0.36, s * h);
    b.add(box(0.03, 0.03, 2 * h), rope, s * h, 0.36, 0);
  }
  // little "for sale" sign by the front-left stake
  b.add(box(0.07, 0.8, 0.07), PALETTE.fenceDark, -0.8, 0.4, h + 0.15);
  b.add(box(0.5, 0.3, 0.05), COLORS.PLANK_WOOD, -0.8, 0.8, h + 0.15);
  b.add(box(0.36, 0.05, 0.06), PALETTE.fenceDark, -0.8, 0.83, h + 0.15);
  b.add(box(0.36, 0.05, 0.06), PALETTE.fenceDark, -0.8, 0.74, h + 0.15);
  return { body: b.geometry(), glow: null };
}

function bakeScaffold(): Baked {
  const b = new Batch();
  const h = 1.15;
  const H = 2.0;
  const post = box(0.14, H, 0.14);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(post, PALETTE.fence, sx * h, H / 2, sz * h);
  for (const y of [0.55, 1.1, 1.65]) {
    for (const s of [-1, 1]) {
      b.add(box(2 * h + 0.14, 0.09, 0.09), PALETTE.plank, 0, y, s * h);
      b.add(box(0.09, 0.09, 2 * h + 0.14), PALETTE.plank, s * h, y, 0);
    }
  }
  // diagonal braces front and back
  const diag = Math.hypot(2 * h, 1.1);
  const a = Math.atan2(1.1, 2 * h);
  for (const s of [-1, 1]) {
    b.add(box(diag, 0.07, 0.07), PALETTE.fenceDark, 0, 0.55 + 0.55, s * h + s * 0.02, { rz: a });
    b.add(box(0.07, 0.07, diag), PALETTE.fenceDark, s * h + s * 0.02, 1.1, 0, { ry: Math.PI / 2, rz: -a });
  }
  // platform planks + a stack of boards and a ladder
  for (let i = 0; i < 5; i++) b.add(box(0.4, 0.05, 2 * h - 0.1), i % 2 ? PALETTE.plank : PALETTE.crate, -0.9 + i * 0.45, 1.13, 0);
  b.add(box(0.07, 1.4, 0.07), PALETTE.fenceDark, h + 0.2, 0.7, 0.5, { rz: -0.15 });
  b.add(box(0.07, 1.4, 0.07), PALETTE.fenceDark, h + 0.2, 0.7, 0.9, { rz: -0.15 });
  for (let i = 0; i < 4; i++) b.add(box(0.06, 0.05, 0.5), PALETTE.plank, h + 0.2 - (0.15 * (0.2 + i * 0.3)) / 1.4 * 1.4, 0.25 + i * 0.3, 0.7);
  return { body: b.geometry(), glow: null };
}

// ---------------------------------------------------------------------------
// Great Lodge
// ---------------------------------------------------------------------------

function bakeGreatLodge(): Baked {
  const g = LAYOUT.village.greatLodge;
  const b = new Batch();
  const glow = new Batch();
  const w = g.w - 0.4;
  const d = g.d - 0.5;
  b.add(box(g.w, 0.14, g.d), STONE, 0, 0.07, 0);
  logWalls(b, w, d, 8, 0.12, PALETTE.fence, PALETTE.plank, 0.15);
  const eave = 2.45;
  // main hall roof + a front cross-gable over the entrance
  gableRoof(b, w, d, eave, 1.55, ROOF_RED, ROOF_RED_DARK, PALETTE.fence, 0.35);
  // entrance porch: a smaller gabled block on the front (+Z) with its ridge along Z
  const pw = 2.0;
  b.add(box(pw, 2.2, 0.7), PALETTE.plank, 0, 1.1 + 0.12, d / 2 + 0.2);
  const pr = 1.0;
  const pang = Math.atan2(pr, pw / 2 + 0.2);
  const pslope = Math.hypot(pw / 2 + 0.2, pr) + 0.05;
  for (const s of [-1, 1]) {
    b.add(box(pslope, 0.14, 1.0), s > 0 ? ROOF_RED : ROOF_RED_DARK, (s * (pw / 2 + 0.2)) / 2, 2.32 + pr / 2, d / 2 + 0.25, { rz: -s * pang });
    b.add(box(pslope - 0.4, 0.14, 0.8), SNOW, (s * (pw / 2 + 0.2)) / 2 - s * 0.1, 2.32 + pr / 2 + 0.2, d / 2 + 0.25, { rz: -s * pang });
  }
  door(b, 0, d / 2 + 0.58, 1.0, 1.5);
  // timber trim posts on the corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(box(0.26, eave, 0.26), PALETTE.fenceDark, (sx * w) / 2, eave / 2, (sz * d) / 2);
  // chimneys
  chimney(b, -1.9, -0.5, eave + 0.3, 4.5);
  chimney(b, 1.9, -0.5, eave + 0.3, 4.2);
  // windows (front row + sides)
  for (const x of [-2.0, -1.3, 1.3, 2.0]) windowAt(b, glow, x, 1.3, d / 2 + 0.02, 0, 0.5, 0.55);
  for (const s of [-1, 1]) windowAt(b, glow, (s * w) / 2 + s * 0.02, 1.3, 0.0, (s * Math.PI) / 2, 0.55, 0.55);
  // flags on both ridge ends
  for (const s of [-1, 1]) {
    const x = (s * (w + 0.5)) / 2;
    b.add(new THREE.CylinderGeometry(0.04, 0.05, 1.5, 6), PALETTE.fenceDark, x, eave + 1.55 + 0.75, 0);
    const flag = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 0.5), new THREE.Vector2(0.8, 0.25)]);
    b.add(new THREE.ExtrudeGeometry(flag, { depth: 0.03, bevelEnabled: false }).rotateY(-Math.PI / 2), s > 0 ? PALETTE.truckRed : COLORS.COURIER_YELLOW, x, eave + 3.0, 0.0);
  }
  // lanterns by the door
  for (const s of [-1, 1]) {
    b.add(box(0.08, 1.6, 0.08), PALETTE.fenceDark, s * 1.35, 0.8, d / 2 + 0.7);
    glow.add(box(0.22, 0.26, 0.22), WARM, s * 1.35, 1.7, d / 2 + 0.7);
  }
  return { body: b.geometry(), glow: glow.geometry() };
}

let bannerTexture: THREE.CanvasTexture | null = null;
function bannerTex(): THREE.CanvasTexture {
  if (!bannerTexture) {
    const { canvas, ctx: g, texture } = makeCanvasTexture(1024, 256);
    const paint = (): void => {
      g.fillStyle = '#2d5d9a';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.strokeStyle = '#ffd026';
      g.lineWidth = 14;
      g.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold 150px ${GAME_FONT}`;
      g.lineJoin = 'round';
      g.lineWidth = 18;
      g.strokeStyle = '#143a66';
      g.strokeText('WINTERLAND', canvas.width / 2, canvas.height / 2 + 6);
      g.fillStyle = '#fff6e0';
      g.fillText('WINTERLAND', canvas.width / 2, canvas.height / 2 + 6);
      texture.needsUpdate = true;
    };
    paint();
    void document.fonts?.ready.then(paint);
    texture.anisotropy = 8;
    bannerTexture = texture;
  }
  return bannerTexture;
}

// ---------------------------------------------------------------------------
// public factories (cached geometry; every call returns a fresh Group of fresh meshes)
// ---------------------------------------------------------------------------

const cache: Partial<Record<'tent' | 'hut' | 'cabin' | 'lodge' | 'lot' | 'scaffold' | 'great', Baked>> = {};
function baked(k: keyof typeof cache, make: () => Baked): Baked {
  return (cache[k] ??= make());
}

/** Bright canvas A-frame tent with a pennant. 2.0 × 2.2 footprint. */
export function createTent(): THREE.Group {
  return modelOf(baked('tent', bakeTent), 'tent');
}

/** Small log hut with a snowy roof. */
export function createHut(): THREE.Group {
  return modelOf(baked('hut', bakeHut), 'hut');
}

/** Log cabin with chimney and lit windows. Chimney: SHELTER_CHIMNEY.cabin. */
export function createCabin(): THREE.Group {
  return modelOf(baked('cabin', bakeCabin), 'cabin');
}

/** Two-storey lodge with a balcony and a big chimney. Chimney: SHELTER_CHIMNEY.lodge. */
export function createLodge(): THREE.Group {
  return modelOf(baked('lodge', bakeLodge), 'lodge');
}

/** tier = index into VILLAGE.tiers (0 tent … 3 lodge). */
export function createShelter(tier: number): THREE.Group {
  return [createTent, createHut, createCabin, createLodge][Math.max(0, Math.min(3, tier))]!();
}

/** Empty staked lot (3 × 3 m plot, stakes + rope + sale sign). One non-shadow mesh. */
export function createLot(): THREE.Group {
  return modelOf(baked('lot', bakeLot), 'lot', false);
}

export interface Scaffold {
  readonly group: THREE.Group;
  /** 0 … 1: the frame grows from a third of its height to full as the tier gets paid. */
  setProgress(p: number): void;
}

/** Timber scaffold shown while a tier is under construction. */
export function createScaffold(): Scaffold {
  const group = modelOf(baked('scaffold', bakeScaffold), 'scaffold');
  const setProgress = (p: number): void => {
    group.scale.y = 0.35 + 0.65 * Math.max(0, Math.min(1, p));
  };
  setProgress(0);
  return { group, setProgress };
}

/**
 * The Great Lodge (LAYOUT.village.greatLodge 6 × 3.6): timber hall with a tall red roof, entrance porch, chimneys,
 * flags and a roof-top WINTERLAND banner. Door on local +Z: place it with rotation.y = π so the door faces the
 * street (−Z); the banner is already yawed toward the camera for that placement.
 */
export function createGreatLodge(): THREE.Group {
  const g = modelOf(baked('great', bakeGreatLodge), 'greatLodge');
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.85, 0.12), [
    toon(PALETTE.fenceDark),
    toon(PALETTE.fenceDark),
    toon(PALETTE.fenceDark),
    toon(PALETTE.fenceDark),
    toon(0xffffff, { map: bannerTex() }),
    toon(PALETTE.fenceDark),
  ]);
  board.castShadow = true;
  board.position.set(0, 4.35, 0.2);
  // lodge is rotated π in the world; the camera sits toward +X +Z (world yaw π/4)
  board.rotation.y = Math.PI / 4 - Math.PI;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), toon(PALETTE.fenceDark));
  legs.position.set(0, 3.75, 0.2);
  g.add(board, legs);
  return g;
}

export const sheltersCatalog: Record<string, () => THREE.Object3D> = {
  lot: () => createLot(),
  scaffold: () => createScaffold().group,
  tent: () => createTent(),
  hut: () => createHut(),
  cabin: () => createCabin(),
  lodge: () => createLodge(),
  greatLodge: () => {
    const g = createGreatLodge();
    g.rotation.y = Math.PI;
    return g;
  },
};
