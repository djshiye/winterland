/**
 * [B2 — items] AssetFactory: stackable resource items. STUB — replace the placeholder bodies (move the
 * ItemPool visuals here and make ItemPool call createItemModel).
 *
 * Items are pooled and spawned constantly: build from shared cached / merged geometry + cached
 * materials, ≤ 3 meshes per item, never allocate geometry per instance. Centred on the origin;
 * dimensions = ITEM_SIZE in config.ts. All meshes cast + receive shadows.
 *
 * Art spec:
 * - SMALL LOG: r 0.12, length 0.6 in LOG_BARK, lying along local X, with LOG_CORE end caps.
 * - PLANK BUNDLE (counter item): 0.5 × 0.12 × 0.3 in PLANK_WOOD (reads best as 3–4 boards with a
 *   strap or two; keep the outer box size).
 * - CRATE: 0.45 cube in CRATE_BOX with crossbar strips in CRATE_STRIP (#8A5A36).
 * - CASH bundle: 0.35 × 0.12 × 0.2 in CASH_GREEN with a white band 0.1 × 0.125 × 0.21 (CASH_BAND).
 */
import * as THREE from 'three';
import { COLORS, ITEM_SIZE } from '../config';
import type { ItemKind } from '../core/types';
import { geo, mesh, toon } from '../render/materials';

export function createSmallLog(): THREE.Group {
  const { radius, length } = ITEM_SIZE.log;
  const body = mesh(geo.cylinder(radius, radius, length, 10), toon(COLORS.LOG_BARK));
  body.rotation.z = Math.PI / 2;
  return new THREE.Group().add(body);
}

export function createPlankBundle(): THREE.Group {
  const { w, h, d } = ITEM_SIZE.plank;
  return new THREE.Group().add(mesh(geo.box(w, h, d), toon(COLORS.PLANK_WOOD)));
}

export function createCrate(): THREE.Group {
  const s = ITEM_SIZE.crate.size;
  return new THREE.Group().add(mesh(geo.box(s, s, s), toon(COLORS.CRATE_BOX)));
}

export function createCash(): THREE.Group {
  const { w, h, d } = ITEM_SIZE.cash;
  return new THREE.Group().add(mesh(geo.box(w, h, d), toon(COLORS.CASH_GREEN)));
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
