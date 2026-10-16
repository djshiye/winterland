/**
 * AssetFactory helper for the art guide's model contract: at most THREE meshes per object.
 *
 *   body  one merged, vertex-coloured, shadow-casting mesh (shared vcMat)
 *   glow  optional: one mesh for windows / lamps / screens (a shared glow material, no shadows)
 *   anim  optional: one mesh inside its own pivot (a wheel, a fan, a beam) that the owner spins or swings
 *
 * The parts are built ONCE per `key` (the geometry is cached), and every copy is pooled with render/instancer.ts,
 * so ten identical towers or machines on screen cost the same 3 draw calls (+1 shadow for the body) as one.
 * Copies must not edit or dispose the cached geometry; to vary a look, use a different key.
 *
 *   const tower = artModel('cityTower:steam', () => {
 *     const body = new Batch().add(geo.box(1, 4, 1), 0xb5653e, 0, 2, 0);
 *     const glow = new Batch().add(geo.box(0.3, 0.3, 0.02), 0xffd978, 0, 3, 0.51);
 *     const anim = new Batch().add(geo.box(1.2, 0.08, 0.08), 0x6b4a3a, 0, 0, 0);
 *     return { body, glow, anim: { batch: anim, x: 0, y: 4.2, z: 0 } };
 *   });
 *   tower.anim!.rotation.z += dt; // in the owner's update
 */
import * as THREE from 'three';
import { Batch, vcMat } from '../render/batch';
import { instanceAcrossScene } from '../render/instancer';
import { toon } from '../render/materials';
import { registerGlow } from '../world/env/glow';

export interface ArtParts {
  body: Batch;
  glow?: Batch;
  /** The moving part, modelled around its own pivot, and where that pivot sits in the model. */
  anim?: { batch: Batch; x: number; y: number; z: number };
}

export interface ArtModel {
  root: THREE.Group;
  body: THREE.Mesh;
  glow: THREE.Mesh | null;
  /** Pivot of the moving part (rotate / move this), or null. */
  anim: THREE.Group | null;
}

interface Baked {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  anim: { geometry: THREE.BufferGeometry; x: number; y: number; z: number } | null;
}

const cache = new Map<string, Baked>();
let warmGlow: THREE.MeshToonMaterial | null = null;

/** The default glow: warm window light, brighter at night (world/env/glow.ts). Shared; never dispose it. */
export function artGlowMaterial(): THREE.MeshToonMaterial {
  warmGlow ??= registerGlow(toon(0xffd978, { emissive: 0xffb347, emissiveIntensity: 0.65 }));
  return warmGlow;
}

/** A model following the 3-mesh contract (see the file comment). `build` runs once per key. */
export function artModel(key: string, build: () => ArtParts, opts?: { glowMaterial?: THREE.Material }): ArtModel {
  let baked = cache.get(key);
  if (!baked) {
    const p = build();
    baked = {
      body: p.body.geometry(),
      glow: p.glow && !p.glow.empty ? p.glow.geometry() : null,
      anim: p.anim && !p.anim.batch.empty ? { geometry: p.anim.batch.geometry(), x: p.anim.x, y: p.anim.y, z: p.anim.z } : null,
    };
    cache.set(key, baked);
  }
  const root = new THREE.Group();
  root.name = key;
  const body = new THREE.Mesh(baked.body, vcMat());
  body.name = `${key}:body`;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  let glow: THREE.Mesh | null = null;
  if (baked.glow) {
    glow = new THREE.Mesh(baked.glow, opts?.glowMaterial ?? artGlowMaterial());
    glow.name = `${key}:glow`;
    glow.castShadow = false;
    glow.receiveShadow = false;
    root.add(glow);
  }
  let anim: THREE.Group | null = null;
  if (baked.anim) {
    anim = new THREE.Group();
    anim.name = `${key}:pivot`;
    anim.position.set(baked.anim.x, baked.anim.y, baked.anim.z);
    const m = new THREE.Mesh(baked.anim.geometry, vcMat());
    m.name = `${key}:anim`;
    m.castShadow = true;
    m.receiveShadow = true;
    anim.add(m);
    root.add(anim);
  }
  instanceAcrossScene(root);
  return { root, body, glow, anim };
}
