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
 *   characters.ts — player, customer, courier, driver, worker (crew), axe
 *   items.ts      — small log, plank bundle, crate, cash bundle
 *   vehicles.ts   — cargo tricycle, pickup truck
 *   shop.ts       — counter table, speech bubble
 *   machines.ts   — giant log, drop-zone slab, harvester, processor, roller conveyor, mega saw
 *   pads.ts       — createPadTexture, upgrade-pad tile
 *   scenery.ts    — palisade fence post
 *   shelters.ts   — village shelters (tent → hut → cabin → lodge), lot, scaffold, Great Lodge
 *   town.ts       — wave 9 Market Town: six business models, lot for sale, scaffold, hopper / counter / pallet props
 *   townAmenities.ts — wave 12: the four square amenities (cafe, snowman park, bandstand, skating pond)
 *   grandMarket.ts — wave 13: the Grand Market hall (the Winterland finale)
 */
import type * as THREE from 'three';
import { characterCatalog } from './characters';
import { itemCatalog } from './items';
import { machineCatalog } from './machines';
import { padCatalog } from './pads';
import { ridgeCatalog } from './ridge';
import { ridgeMachineCatalog } from './ridgeMachines';
import { sledCatalog } from './sled';
import { sceneryCatalog } from './scenery';
import { sheltersCatalog } from './shelters';
import { shopCatalog } from './shop';
import { townCatalog } from './town';
import { grandMarketCatalog } from './grandMarket';
import { townAmenityCatalog } from './townAmenities';
import { vehicleCatalog } from './vehicles';
import { eraItemCatalog } from './eraItems';
import { eraMachineCatalog, eraSheetCatalog } from './eraMachines';
import { eraWorkerCatalog } from './eraWorkers';
import { cityBuildingCatalog } from './cityBuildings';
import { jackCatalog } from './jack';
import { frontierCatalog } from './frontierProps';

export * from './characters';
export * from './items';
export * from './vehicles';
export * from './shop';
export * from './machines';
export * from './pads';
export * from './scenery';
export * from './shelters';
export * from './town';
export * from './townAmenities';
export * from './grandMarket';

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
  shelters: sheltersCatalog,
  ridge: ridgeCatalog,
  ridgeMachines: ridgeMachineCatalog,
  sled: sledCatalog,
  town: townCatalog,
  townAmenities: townAmenityCatalog,
  grandMarket: grandMarketCatalog,
  // 0.9.0 Ages (each file owns its catalog)
  eraItems: eraItemCatalog,
  eraMachines: eraMachineCatalog,
  eraSheets: eraSheetCatalog,
  eraWorkers: eraWorkerCatalog,
  cityBuildings: cityBuildingCatalog,
  jack: jackCatalog,
  frontierProps: frontierCatalog,
};
