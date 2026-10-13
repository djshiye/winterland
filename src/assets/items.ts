/**
 * [B2 — items] AssetFactory: stackable resource items.
 *
 * Items are pooled and spawned constantly, so every model shares module-level cached (merged) geometry
 * and cached toon materials; ≤ 3 meshes per item. All models are centred on their origin, dimensions =
 * ITEM_SIZE in config.ts, and every mesh casts + receives shadows.
 *
 * Art spec:
 * - SMALL LOG: r 0.12, length 0.6 in LOG_BARK, lying along local X, with LOG_CORE end caps.
 * - PLANK BUNDLE (counter item): 0.5 × 0.12 × 0.3 in PLANK_WOOD — four boards held by two straps.
 * - CRATE: 0.45 cube in CRATE_BOX with a CRATE_STRIP frame and one diagonal crossbar per face.
 * - CASH bundle: 0.35 × 0.12 × 0.2 in CASH_GREEN with a white band 0.1 × 0.125 × 0.21 (CASH_BAND).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, ITEM_SIZE, PALETTE } from '../config';
import type { ItemKind } from '../core/types';
import { toon } from '../render/materials';

// ---------------------------------------------------------------------------
// Geometry helpers + lazy caches (built once, never disposed)
// ---------------------------------------------------------------------------

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Cylinder lying along X, centred at x = `cx`. */
const disc = (radius: number, thickness: number, cx: number): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(radius, radius, thickness, 16).rotateZ(Math.PI / 2).translate(cx, 0, 0);

function merged(parts: THREE.BufferGeometry[], groups = false): THREE.BufferGeometry {
  const g = mergeGeometries(parts, groups);
  for (const p of parts) p.dispose();
  return g;
}

function lazy<T>(make: () => T): () => T {
  let v: T | null = null;
  return () => (v ??= make());
}

function shadowed(m: THREE.Mesh): THREE.Mesh {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// --- small log ---------------------------------------------------------------
const logGeo = lazy(() => {
  const { length, radius } = ITEM_SIZE.log;
  const e = length / 2;
  const body = new THREE.CylinderGeometry(radius, radius, length, 12).rotateZ(Math.PI / 2);
  // Group order = material order: ring, core, ring, core (darker ring around the LOG_CORE heart).
  const caps = merged(
    [
      disc(radius * 0.94, 0.012, -e - 0.001),
      disc(radius * 0.62, 0.02, -e - 0.003),
      disc(radius * 0.94, 0.012, e + 0.001),
      disc(radius * 0.62, 0.02, e + 0.003),
    ],
    true,
  );
  return { body, caps };
});

// --- plank bundle ------------------------------------------------------------
const plankGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.plank;
  const n = 4;
  const pitch = d / n;
  const boards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) boards.push(box(w, h, pitch - 0.012, 0, 0, (i - (n - 1) / 2) * pitch));
  // Dark core fills the gaps between boards; two straps wrap the bundle.
  const trim: THREE.BufferGeometry[] = [box(w - 0.01, h - 0.02, d - 0.02)];
  for (const sx of [-1, 1]) trim.push(box(0.04, h + 0.008, d + 0.008, sx * w * 0.28, 0, 0));
  return { boards: merged(boards), trim: merged(trim) };
});

// --- crate -------------------------------------------------------------------
const crateGeo = lazy(() => {
  const s = ITEM_SIZE.crate.size;
  const t = 0.05; // frame bar thickness
  const o = s / 2 - t / 2;
  const body = box(s - 0.012, s - 0.012, s - 0.012);
  const strips: THREE.BufferGeometry[] = [];
  for (const a of [-o, o]) {
    for (const b of [-o, o]) {
      strips.push(box(s, t, t, 0, a, b)); // along X
      strips.push(box(t, s, t, a, 0, b)); // along Y
      strips.push(box(t, t, s, a, b, 0)); // along Z
    }
  }
  // One diagonal crossbar per face.
  const diag = (s - 2 * t) * Math.SQRT2 - 0.02;
  const face = s / 2 - 0.006;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const faces: [number, number, number, number, number, number][] = [
    // rotation (x, y, z) of the strip's frame, offset (x, y, z)
    [0, 0, Math.PI / 4, 0, 0, face],
    [0, 0, -Math.PI / 4, 0, 0, -face],
    [0, Math.PI / 2, Math.PI / 4, face, 0, 0],
    [0, Math.PI / 2, -Math.PI / 4, -face, 0, 0],
    [Math.PI / 2, 0, Math.PI / 4, 0, face, 0],
    [Math.PI / 2, 0, -Math.PI / 4, 0, -face, 0],
  ];
  for (const [rx, ry, rz, x, y, z] of faces) {
    // Strip lies along local X, thin along Z (the face normal after the base rotation).
    const g = new THREE.BoxGeometry(diag, 0.045, 0.014);
    q.setFromEuler(e.set(rx, ry, 0, 'XYZ'));
    const qz = new THREE.Quaternion().setFromEuler(e.set(0, 0, rz));
    q.multiply(qz);
    m.compose(pos.set(x, y, z), q, one);
    g.applyMatrix4(m);
    strips.push(g);
  }
  return { body, strips: merged(strips) };
});

// --- cash bundle -------------------------------------------------------------
const cashGeo = lazy(() => {
  const { w, h, d } = ITEM_SIZE.cash;
  const eo = w / 2 - 0.01;
  return {
    body: box(w, h, d),
    edges: merged([box(0.022, h + 0.004, d + 0.004, -eo), box(0.022, h + 0.004, d + 0.004, eo)]),
    band: box(0.1, h + 0.005, d + 0.01),
  };
});

// ---------------------------------------------------------------------------
// Factories (origin = item centre)
// ---------------------------------------------------------------------------

/** Small log: bark cylinder along local X with light end-grain caps. */
export function createSmallLog(): THREE.Group {
  const p = logGeo();
  const ring = toon(PALETTE.woodRing);
  const core = toon(COLORS.LOG_CORE);
  return new THREE.Group().add(
    shadowed(new THREE.Mesh(p.body, toon(COLORS.LOG_BARK))),
    shadowed(new THREE.Mesh(p.caps, [ring, core, ring, core])),
  );
}

/** Plank bundle: four boards + two straps, long side along local X. */
export function createPlankBundle(): THREE.Group {
  const p = plankGeo();
  return new THREE.Group().add(
    shadowed(new THREE.Mesh(p.boards, toon(COLORS.PLANK_WOOD))),
    shadowed(new THREE.Mesh(p.trim, toon(COLORS.CRATE_STRIP))),
  );
}

/** Wooden crate cube with a darker frame and diagonal crossbars. */
export function createCrate(): THREE.Group {
  const p = crateGeo();
  return new THREE.Group().add(
    shadowed(new THREE.Mesh(p.body, toon(COLORS.CRATE_BOX))),
    shadowed(new THREE.Mesh(p.strips, toon(COLORS.CRATE_STRIP))),
  );
}

/** Green cash bundle with a white paper band. */
export function createCash(): THREE.Group {
  const p = cashGeo();
  return new THREE.Group().add(
    shadowed(new THREE.Mesh(p.body, toon(COLORS.CASH_GREEN))),
    shadowed(new THREE.Mesh(p.edges, toon(PALETTE.cashDark))),
    shadowed(new THREE.Mesh(p.band, toon(COLORS.CASH_BAND))),
  );
}

export function createItemModel(kind: ItemKind): THREE.Group {
  switch (kind) {
    case 'log':
      return createSmallLog();
    case 'plank':
      return createPlankBundle();
    case 'crate':
      return createCrate();
    case 'cash':
      return createCash();
  }
}

export const itemCatalog: Record<string, () => THREE.Object3D> = {
  log: createSmallLog,
  plank: createPlankBundle,
  crate: createCrate,
  cash: createCash,
};
