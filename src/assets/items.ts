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
import { createEraItemModel } from './eraItems';
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
    default:
      return createEraItemModel(kind);
  }
}

// ---------------------------------------------------------------------------
// Wave 9 town goods. One cached merged mesh per kind, each inside its ITEM_SIZE box (origin = centre, so a stack of
// them sits exactly stackHeight apart). Warm, chunky and readable from the iso camera.
// ---------------------------------------------------------------------------

const ball = (r: number): THREE.BufferGeometry => new THREE.SphereGeometry(r, 10, 7);

/** Burlap grain sack (0.4 × 0.3 × 0.3): a plump sack tied at the neck with a few wheat ears sticking out. */
const wheatGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.wheat;
  const BURLAP = 0xcfa66a;
  const BURLAP_D = 0xb98a4e;
  const y0 = -h / 2;
  const b = new Batch();
  // body: squashed sphere filling the lower two thirds, flat bottom slab so it stacks nicely
  b.add(ball(0.5), BURLAP, 0, y0 + 0.14, 0, { sx: (w - 0.02) / 1.0, sy: 0.26, sz: (d - 0.02) / 1.0 });
  b.add(ball(0.5), BURLAP_D, 0, y0 + 0.07, 0, { sx: w * 0.8, sy: 0.14, sz: d * 0.8 });
  // gathered neck + tie
  b.add(new THREE.CylinderGeometry(0.07, 0.11, 0.08, 8), BURLAP, 0, y0 + 0.24, 0);
  b.add(new THREE.CylinderGeometry(0.085, 0.085, 0.025, 8), 0x7a4a2a, 0, y0 + 0.23, 0);
  // wheat ears (golden) poking out of the neck
  for (const [x, z, rz] of [[-0.04, 0.0, 0.35], [0.04, 0.01, -0.3], [0, -0.04, 0.05]] as const) {
    b.add(cyl(0.006, 0.05, 6), 0xd9a441, x, y0 + 0.25, z, { rz });
    b.add(ball(0.016), 0xf0c860, x * 1.9, y0 + 0.268, z * 1.9, { sy: 2 });
  }
  // a darker seam and a green label
  b.add(box(0.14, 0.09, 0.012), 0x4fa64f, 0, y0 + 0.14, d / 2 - 0.02);
  b.add(box(0.1, 0.012, 0.014), 0xf6e8c0, 0, y0 + 0.14, d / 2 - 0.016);
  return b.geometry();
});

/** Round loaf (0.36 × 0.18 × 0.26): golden crust, pale slashes, a warm shaded base. */
const breadGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.bread;
  const y0 = -h / 2;
  const b = new Batch();
  b.add(ball(0.5), 0xb26d2c, 0, y0 + 0.085, 0, { sx: w - 0.01, sy: 0.17, sz: d - 0.01 });
  b.add(ball(0.5), 0xd9954b, 0, y0 + 0.09, 0, { sx: w * 0.8, sy: 0.15, sz: d * 0.8 });
    for (const x of [-0.08, 0.0, 0.08]) b.add(box(0.025, 0.012, 0.15), 0xf4d08a, x, y0 + 0.157, 0, { ry: 0.0, rz: 0, rx: 0, sy: 1 });
  return b.geometry();
});

/** Wrapped ham cut (0.38 × 0.24 × 0.3): pink ham, white fat cap, bone knob, butcher-paper band tied with red string. */
const meatGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.meat;
  const y0 = -h / 2;
  const b = new Batch();
  b.add(ball(0.5), 0xd9707a, -0.02, y0 + 0.12, 0, { sx: w * 0.8, sy: 0.22, sz: d - 0.01 });
  b.add(ball(0.5), 0xf2c9c4, -0.08, y0 + 0.17, 0.0, { sx: w * 0.4, sy: 0.12, sz: d * 0.7 });
  // bone knob
  b.add(cyl(0.032, 0.1, 8), 0xf5ecd9, w / 2 - 0.05, y0 + 0.12, 0, { rz: HALF_PI });
  for (const s of [-1, 1]) b.add(ball(0.04), 0xf5ecd9, w / 2 - 0.0, y0 + 0.12 + s * 0.025, 0);
  // paper wrap band + string
  b.add(box(0.05, 0.236, d + 0.006), 0xf0e4cc, 0.07, y0 + 0.118, 0);
  b.add(box(0.02, 0.238, d + 0.012), 0xd2413a, 0.07, y0 + 0.119, 0);
  return b.geometry();
});

/** Sausage coil (0.36 × 0.14 × 0.36): two stacked rings of links on a little wooden board, tied end with string. */
const sausageGeo = lazy(() => {
  const { w, h } = ITEM_SIZE.sausage;
  const y0 = -h / 2;
  const b = new Batch();
  b.add(cyl(w / 2 - 0.005, 0.025, 20), 0xc9a06a, 0, y0 + 0.0125, 0);
  const SAUS = 0xa5503a;
  const SAUS_D = 0x7a3528;
  const ring = (r: number, y: number, c: number): void => {
    b.add(new THREE.TorusGeometry(r, 0.042, 7, 20).rotateX(HALF_PI), c, 0, y, 0);
  };
  ring(0.125, y0 + 0.07, SAUS);
  ring(0.052, y0 + 0.07, SAUS_D);
  ring(0.09, y0 + 0.108, SAUS);
  // link pinches (string ties) around the outer ring and the loose end
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    b.add(box(0.012, 0.09, 0.012), 0xe6d8b0, Math.cos(a) * 0.125, y0 + 0.07, Math.sin(a) * 0.125, { ry: -a });
  }
  b.add(cyl(0.012, 0.06, 5), 0xe6d8b0, 0.0, y0 + 0.12, 0.14, { rx: HALF_PI });
  return b.geometry();
});

/** Wooden toy train (0.4 × 0.26 × 0.22): red cab, yellow boiler, smokestack, four wheels, long axis along X. */
const toyGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.toy;
  const y0 = -h / 2;
  const b = new Batch();
  const wheelY = y0 + 0.065;
  // chassis
  b.add(box(w - 0.02, 0.05, d - 0.07), 0xe29547, 0, y0 + 0.11, 0);
  // cab (back, -X) with a dark roof and a little window
  b.add(box(0.14, 0.13, d - 0.06), 0xd94b3d, -0.12, y0 + 0.19, 0);
  b.add(box(0.17, 0.035, d - 0.03), 0x3b3f47, -0.12, y0 + 0.265, 0);
  b.add(box(0.016, 0.07, 0.07), 0xfff0b0, -0.04, y0 + 0.215, 0.0);
  // boiler (front) with a blue band and a brass nose
  b.add(cyl(0.065, 0.2, 12), 0xffd026, 0.07, y0 + 0.195, 0, { rz: HALF_PI });
  b.add(cyl(0.067, 0.03, 12), 0x2f79c9, 0.04, y0 + 0.195, 0, { rz: HALF_PI });
  b.add(cyl(0.067, 0.03, 12), 0x2f79c9, 0.12, y0 + 0.195, 0, { rz: HALF_PI });
  b.add(cyl(0.05, 0.03, 10), 0xe0a93a, 0.18, y0 + 0.195, 0, { rz: HALF_PI });
  // stack + dome
  b.add(new THREE.CylinderGeometry(0.03, 0.022, 0.07, 8), 0x3b3f47, 0.12, y0 + 0.25, 0);
  b.add(ball(0.03), 0xe0a93a, 0.02, y0 + 0.25, 0, { sy: 0.8 });
  // cow-catcher wedge
  b.add(box(0.04, 0.03, d - 0.1), 0x3b3f47, 0.175, y0 + 0.1, 0);
  // wheels (axis along Z)
  for (const x of [-0.14, -0.02, 0.1, 0.17]) {
    for (const s of [-1, 1]) b.add(cyl(x > 0.15 ? 0.04 : 0.055, 0.03, 10), 0x8a5a36, x, x > 0.15 ? y0 + 0.045 : wheelY, s * (d / 2 - 0.02), { rx: HALF_PI });
  }
  return b.geometry();
});

export function createTownGood(kind: 'wheat' | 'bread' | 'meat' | 'sausage' | 'toy'): THREE.Mesh {
  switch (kind) {
    case 'wheat':
      return itemMesh(wheatGeo(), 'item:wheat');
    case 'bread':
      return itemMesh(breadGeo(), 'item:bread');
    case 'meat':
      return itemMesh(meatGeo(), 'item:meat');
    case 'sausage':
      return itemMesh(sausageGeo(), 'item:sausage');
    case 'toy':
      return itemMesh(toyGeo(), 'item:toy');
  }
}

export const itemCatalog: Record<string, () => THREE.Object3D> = {
  log: createSmallLog,
  plank: createPlankBundle,
  crate: createCrate,
  cash: createCash,
  furniture: createFurniture,
  wheat: () => createTownGood('wheat'),
  bread: () => createTownGood('bread'),
  meat: () => createTownGood('meat'),
  sausage: () => createTownGood('sausage'),
  toy: () => createTownGood('toy'),
};
