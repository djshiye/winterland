/**
 * [B3 — world] AssetFactory: spec'd scenery pieces. world/env/fences.ts instances the palisade post
 * (fence runs are built there as InstancedMesh for performance).
 *
 * Art spec:
 * - FENCE: a PALISADE of vertical cylinders r 0.12, h 0.9 in FENCE_WOOD with conical tops, set side by
 *   side along the fence line.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../config';
import { toonUnique } from '../render/materials';

/** Palisade post dimensions (art spec: r 0.12, h 0.9 + conical top). */
export const PALISADE = {
  radius: 0.12,
  height: 0.9,
  /** Height of the conical tip on top of the 0.9 cylinder. */
  tipHeight: 0.22,
  /** Centre-to-centre spacing of posts in a run ("side by side"). */
  spacing: 0.25,
} as const;

let postGeometry: THREE.BufferGeometry | null = null;
let postMaterial: THREE.MeshToonMaterial | null = null;

function painted(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const n = out.getAttribute('position').count;
  const c = new THREE.Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

/**
 * One palisade post as a single merged, cached geometry (origin at its base centre): FENCE_WOOD
 * cylinder r 0.12 × h 0.9, FENCE_WOOD cone top, and a small snow cap on the very tip.
 * Vertex-coloured: render it with `palisadeMaterial()`.
 */
export function palisadePostGeometry(): THREE.BufferGeometry {
  if (!postGeometry) {
    const { radius: r, height: h, tipHeight: t } = PALISADE;
    const body = new THREE.CylinderGeometry(r, r, h, 8, 1, true).translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, t, 8, 1, true).translate(0, h + t / 2, 0);
    const capH = t * 0.4;
    const cap = new THREE.ConeGeometry(r * 0.4 * 1.1, capH, 8, 1, true).translate(0, h + t - capH / 2 + 0.01, 0);
    postGeometry = mergeGeometries([painted(body, COLORS.FENCE_WOOD), painted(tip, COLORS.FENCE_WOOD), painted(cap, COLORS.SNOW_WHITE)], false);
    postGeometry.computeBoundingSphere();
  }
  return postGeometry;
}

/** Shared vertex-colour toon material for palisade posts. */
export function palisadeMaterial(): THREE.MeshToonMaterial {
  if (!postMaterial) {
    postMaterial = toonUnique(0xffffff);
    postMaterial.vertexColors = true;
  }
  return postMaterial;
}

/** A single palisade post mesh (origin at its base centre). */
export function createPalisadePost(): THREE.Mesh {
  const m = new THREE.Mesh(palisadePostGeometry(), palisadeMaterial());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const sceneryCatalog: Record<string, () => THREE.Object3D> = {
  palisadePost: () => createPalisadePost(),
  palisadeRun: () => {
    const g = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const p = createPalisadePost();
      p.position.x = i * PALISADE.spacing;
      g.add(p);
    }
    return g;
  },
};
