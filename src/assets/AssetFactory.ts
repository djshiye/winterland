/**
 * AssetFactory — every game object in Winterland is constructed here from compound Three.js primitives
 * (no .glb / .png files anywhere), and every 2D texture is drawn at runtime on an offscreen <canvas>.
 *
 *   import * as AssetFactory from '../assets/AssetFactory';
 *   const crate = AssetFactory.createCrate();
 *
 * House rules for every factory (all domain modules below):
 * - Colours come only from COLORS / PALETTE in config.ts (COLORS = the exact art-direction palette).
 *   Materials only via render/materials.ts toon() / basic() (cached MeshToonMaterial with a 3-step cel
 *   ramp — the art spec allows toon or standard r 0.7 / m 0.1; we use toon everywhere for one look).
 * - Geometry via geo.* (cached) or module-level caches/merged geometry: anything spawned repeatedly
 *   (items, NPCs, vehicles) must share geometry + materials, never allocate per instance.
 * - A factory returns a THREE.Group (origin documented per factory: floor centre or item centre) or a
 *   typed handle exposing the parts that animate. Factories never add to the scene, never touch
 *   GameContext and never start animations — behaviour lives in stations/, npc/, entities/.
 * - Meshes cast + receive shadows unless they are thin decals.
 * - Each domain module exports a `<domain>Catalog` (name → () => Object3D) for the ?gallery page.
 *
 * Boundary: background scenery (ground, river, mountains, roads, trees, fence runs) is assembled in
 * world/env/ as merged / instanced geometry for performance. It uses the same palette, and its spec'd
 * piece — the palisade fence post — comes from scenery.ts here.
 *
 * Domain modules (one owner each):
 *   characters.ts — player, customer, courier, driver, axe
 *   items.ts      — small log, plank bundle, crate, cash bundle
 *   vehicles.ts   — cargo tricycle, pickup truck
 *   shop.ts       — counter table, speech bubble
 *   machines.ts   — giant log, drop-zone slab, harvester, processor, roller conveyor, mega saw
 *   pads.ts       — createPadTexture, upgrade-pad tile
 *   scenery.ts    — palisade fence post
 */
import type * as THREE from 'three';
import { characterCatalog } from './characters';
import { itemCatalog } from './items';
import { machineCatalog } from './machines';
import { padCatalog } from './pads';
import { sceneryCatalog } from './scenery';
import { shopCatalog } from './shop';
import { vehicleCatalog } from './vehicles';

export * from './characters';
export * from './items';
export * from './vehicles';
export * from './shop';
export * from './machines';
export * from './pads';
export * from './scenery';

export type AssetBuilder = () => THREE.Object3D;

/** Every catalogued asset, grouped by domain (used by the ?gallery page). */
export const ASSET_CATALOG: Record<string, Record<string, AssetBuilder>> = {
  characters: characterCatalog,
  items: itemCatalog,
  vehicles: vehicleCatalog,
  shop: shopCatalog,
  machines: machineCatalog,
  pads: padCatalog,
  scenery: sceneryCatalog,
};
