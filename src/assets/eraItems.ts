/**
 * [STUB — items builder replaces] 0.9.0 era material item models (eras/data.ts MATERIALS). One cached merged mesh per
 * kind (like assets/items.ts town goods): centred on its origin inside MATERIALS[kind].size, so stacks sit exactly
 * stackHeight apart; ONE draw call per item (vertex colours on vcMat), shadow handled like other items.
 */
import * as THREE from 'three';
import type { MaterialKind } from '../core/types';
import { MATERIALS } from '../eras/data';
import { toon } from '../render/materials';

export function createEraItemModel(kind: MaterialKind): THREE.Mesh {
  const s = MATERIALS[kind].size;
  const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), toon(MATERIALS[kind].color));
  m.name = `item:${kind}`;
  return m;
}

export const eraItemCatalog: Record<string, () => THREE.Object3D> = {};
