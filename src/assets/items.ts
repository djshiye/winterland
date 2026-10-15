/**
 * [B2 — items] AssetFactory: stackable resource items.
 *
 * Items are pooled and spawned constantly (hundreds sit in piles), so every item is exactly ONE mesh: a cached
 * merged vertex-coloured geometry per kind rendered with the shared vcMat() toon material. All models are centred on their origin, dimensions =
 * ITEM_SIZE in config.ts, and every mesh casts + receives shadows.
 *
 * Art spec:
 * - SMALL LOG: r 0.12, length 0.6 in LOG_BARK, lying along local X, with LOG_CORE end caps.
 * - PLANK BUNDLE (counter item): 0.5 × 0.12 × 0.3 in PLANK_WOOD — four boards held by two straps.
 * - CRATE: 0.45 cube in CRATE_BOX with a CRATE_STRIP frame and one diagonal crossbar per face.
 * - CASH bundle: 0.35 × 0.12 × 0.2 in CASH_GREEN with a white band 0.1 × 0.125 × 0.21 (CASH_BAND).
 */
import * as THREE from 'three';
import { COLORS, ITEM_SIZE, PALETTE } from '../config';
import type { ItemKind } from '../core/types';
import { Batch, vcMat } from '../render/batch';

// ---------------------------------------------------------------------------
// Geometry (built once per kind, lazily; never disposed). Parts are painted per vertex.
// ---------------------------------------------------------------------------

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);

/** Cylinder lying along X: add with rz = PI/2. */
const cyl = (radius: number, length: number, seg = 12): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(radius, radius, length, seg);

const HALF_PI = Math.PI / 2;

function lazy<T>(make: () => T): () => T {
  let v: T | null = null;
  return () => (v ??= make());
}

/** Small log: bark cylinder along X, darker ring + LOG_CORE heart on both ends. */
const logGeo = lazy(() => {
  const { length, radius } = ITEM_SIZE.log;
  const e = length / 2;
  const b = new Batch().add(cyl(radius, length), COLORS.LOG_BARK, 0, 0, 0, { rz: HALF_PI });
  for (const s of [-1, 1]) {
    b.add(cyl(radius * 0.94, 0.012, 16), PALETTE.woodRing, s * (e + 0.001), 0, 0, { rz: HALF_PI });
    b.add(cyl(radius * 0.62, 0.02, 16), COLORS.LOG_CORE, s * (e + 0.003), 0, 0, { rz: HALF_PI });
  }
  return b.geometry();
});

/** Plank bundle: four boards over a dark core, two straps. */
const plankGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.plank;
  const n = 4;
  const pitch = d / n;
  const b = new Batch();
  for (let i = 0; i < n; i++) b.add(box(w, h, pitch - 0.012), COLORS.PLANK_WOOD, 0, 0, (i - (n - 1) / 2) * pitch);
  b.add(box(w - 0.01, h - 0.02, d - 0.02), COLORS.CRATE_STRIP, 0, 0, 0);
  for (const sx of [-1, 1]) b.add(box(0.04, h + 0.008, d + 0.008), COLORS.CRATE_STRIP, sx * w * 0.28, 0, 0);
  return b.geometry();
});

/** Crate: CRATE_BOX cube, CRATE_STRIP edge frame + one diagonal crossbar per face. */
const crateGeo = lazy(() => {
  const s = ITEM_SIZE.crate.size;
  const t = 0.05; // frame bar thickness
  const o = s / 2 - t / 2;
  const b = new Batch().add(box(s - 0.012, s - 0.012, s - 0.012), COLORS.CRATE_BOX, 0, 0, 0);
  const barX = box(s, t, t);
  const barY = box(t, s, t);
  const barZ = box(t, t, s);
  for (const a of [-o, o]) {
    for (const c of [-o, o]) {
      b.add(barX, COLORS.CRATE_STRIP, 0, a, c);
      b.add(barY, COLORS.CRATE_STRIP, a, 0, c);
      b.add(barZ, COLORS.CRATE_STRIP, a, c, 0);
    }
  }
  const diag = box((s - 2 * t) * Math.SQRT2 - 0.02, 0.045, 0.014);
  const face = s / 2 - 0.006;
  const q = Math.PI / 4;
  b.add(diag, COLORS.CRATE_STRIP, 0, 0, face, { rz: q });
  b.add(diag, COLORS.CRATE_STRIP, 0, 0, -face, { rz: -q });
  b.add(diag, COLORS.CRATE_STRIP, face, 0, 0, { ry: HALF_PI, rz: q });
  b.add(diag, COLORS.CRATE_STRIP, -face, 0, 0, { ry: HALF_PI, rz: -q });
  b.add(diag, COLORS.CRATE_STRIP, 0, face, 0, { rx: HALF_PI, rz: q });
  b.add(diag, COLORS.CRATE_STRIP, 0, -face, 0, { rx: HALF_PI, rz: -q });
  return b.geometry();
});

/** Cash bundle: CASH_GREEN body, darker ends, white band. */
const cashGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.cash;
  const eo = w / 2 - 0.01;
  const b = new Batch().add(box(w, h, d), COLORS.CASH_GREEN, 0, 0, 0);
  for (const s of [-1, 1]) b.add(box(0.022, h + 0.004, d + 0.004), PALETTE.cashDark, s * eo, 0, 0);
  b.add(box(0.1, h + 0.005, d + 0.01), COLORS.CASH_BAND, 0, 0, 0);
  return b.geometry();
});

/**
 * Wave 8 chair (the workshop's product): a cosy ladder-back chair in the ITEM_SIZE.furniture box (0.42 × 0.5 × 0.42,
 * origin = centre, back toward -Z). Warm PLANK_WOOD seat and back slats, darker turned legs with a stretcher rail, and
 * a festive red cushion so a pile of chairs reads at a glance. Everything stays inside the box, so chairs stack
 * exactly stackHeight (= h) apart without interpenetrating.
 */
const furnitureGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.furniture;
  const y0 = -h / 2;
  const seatTop = y0 + 0.27;
  const seatT = 0.045;
  const lx = w / 2 - 0.035; // leg centre offset
  const lzF = d / 2 - 0.04;
  const lzB = -d / 2 + 0.04;
  const b = new Batch();
  // legs: front pair stops under the seat, the rear pair runs up into the back posts
  for (const sx of [-1, 1]) {
    b.add(cyl(0.028, seatTop - seatT - y0, 8), PALETTE.barkDark, sx * lx, (y0 + seatTop - seatT) / 2, lzF);
    b.add(cyl(0.026, h, 8), PALETTE.barkDark, sx * lx, 0, lzB);
    b.add(cyl(0.034, 0.03, 8), PALETTE.fenceDark, sx * lx, y0 + 0.015, lzF); // little foot rings
    b.add(cyl(0.034, 0.03, 8), PALETTE.fenceDark, sx * lx, y0 + 0.015, lzB);
    // rail between the front and rear leg on each side
    b.add(box(0.024, 0.024, lzF - lzB), PALETTE.fenceDark, sx * lx, y0 + 0.11, (lzF + lzB) / 2);
  }
  // rail between the front legs and between the rear legs
  b.add(box(2 * lx, 0.024, 0.024), PALETTE.fenceDark, 0, y0 + 0.11, lzF);
  b.add(box(2 * lx, 0.024, 0.024), PALETTE.fenceDark, 0, y0 + 0.11, lzB);
  // seat board + red cushion
  b.add(box(w - 0.02, seatT, d - 0.02), COLORS.PLANK_WOOD, 0, seatTop - seatT / 2, 0);
  b.add(box(w - 0.1, 0.045, d - 0.1), 0xd9453d, 0, seatTop + 0.0225, 0.01);
  b.add(box(w - 0.14, 0.012, d - 0.14), 0xf06a5f, 0, seatTop + 0.051, 0.01);
  // back: two slats between the posts + a capped top rail
  const backZ = lzB;
  b.add(box(2 * lx, 0.07, 0.035), COLORS.PLANK_WOOD, 0, seatTop + 0.1, backZ);
  b.add(box(2 * lx, 0.055, 0.03), COLORS.PLANK_WOOD, 0, seatTop + 0.17, backZ);
  b.add(box(w - 0.02, 0.06, 0.05), COLORS.LOG_CORE, 0, h / 2 - 0.03, backZ);
  return b.geometry();
});

export function createFurniture(): THREE.Mesh {
  return itemMesh(furnitureGeo(), 'furniture');
}

function itemMesh(geometry: THREE.BufferGeometry, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geometry, vcMat());
  // No shadow casting: hundreds of items sit in piles late game and each caster costs a second draw call
  // (wave-7 draw-call ceiling). They still receive shadows.
  m.castShadow = false;
  m.receiveShadow = true;
  m.name = name;
  return m;
}

// ---------------------------------------------------------------------------
// Factories (origin = item centre; each returns ONE mesh)
// ---------------------------------------------------------------------------

/** Small log: bark cylinder along local X with light end-grain caps. */
export function createSmallLog(): THREE.Mesh {
  return itemMesh(logGeo(), 'item:log');
}

/** Plank bundle: four boards + two straps, long side along local X. */
export function createPlankBundle(): THREE.Mesh {
  return itemMesh(plankGeo(), 'item:plank');
}

/** Wooden crate cube with a darker frame and diagonal crossbars. */
export function createCrate(): THREE.Mesh {
  return itemMesh(crateGeo(), 'item:crate');
}

/** Green cash bundle with a white paper band. */
export function createCash(): THREE.Mesh {
  return itemMesh(cashGeo(), 'item:cash');
}

export function createItemModel(kind: ItemKind): THREE.Mesh {
  switch (kind) {
    case 'log':
      return createSmallLog();
    case 'plank':
      return createPlankBundle();
    case 'crate':
      return createCrate();
    case 'cash':
      return createCash();
    case 'furniture':
      return createFurniture();
    case 'wheat':
    case 'bread':
    case 'meat':
    case 'sausage':
    case 'toy':
      return createTownGood(kind);
  }
}

/** [T1 — wave 9] Town goods (ITEM_SIZE[kind]); placeholder box until the assets builder lands the real models. */
export function createTownGood(kind: 'wheat' | 'bread' | 'meat' | 'sausage' | 'toy'): THREE.Mesh {
  const z = ITEM_SIZE[kind];
  const colors = { wheat: 0xc9a46a, bread: 0xb5733a, meat: 0xd98a8a, sausage: 0xa2523a, toy: 0xd94b3d };
  return new THREE.Mesh(new THREE.BoxGeometry(z.w, z.h, z.d), new THREE.MeshLambertMaterial({ color: colors[kind] }));
}

export const itemCatalog: Record<string, () => THREE.Object3D> = {
  log: createSmallLog,
  plank: createPlankBundle,
  crate: createCrate,
  cash: createCash,
  furniture: createFurniture,
};
