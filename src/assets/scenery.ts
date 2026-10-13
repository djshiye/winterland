/**
 * [B3 — world] AssetFactory: spec'd scenery pieces. STUB — replace the placeholder bodies; world/env/
 * instances these (fence runs are built there as instanced / merged geometry for performance).
 *
 * Art spec:
 * - FENCE: a PALISADE of vertical cylinders r 0.12, h 0.9 in FENCE_WOOD with conical tops, set side by
 *   side along the fence line.
 */
import * as THREE from 'three';
import { COLORS } from '../config';
import { geo, mesh, toon } from '../render/materials';

/** One palisade post (cylinder r 0.12, h 0.9 + cone top) as a single geometry, origin at its base. */
export function palisadePostGeometry(): THREE.BufferGeometry {
  return geo.cylinder(0.12, 0.12, 0.9, 10);
}

export function createPalisadePost(): THREE.Mesh {
  const m = mesh(palisadePostGeometry(), toon(COLORS.FENCE_WOOD));
  m.position.y = 0.45;
  return m;
}

export const sceneryCatalog: Record<string, () => THREE.Object3D> = {
  palisadePost: () => new THREE.Group().add(createPalisadePost()),
};
