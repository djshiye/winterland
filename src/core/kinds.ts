/**
 * [MAIN] Leaf module (no imports): the 0.9.0 era material item kinds and era keys, shared by core/types.ts and
 * eras/data.ts without a runtime import cycle.
 */

/** Era materials (eras/data.ts MATERIALS). All are carriable. */
export const MATERIAL_KINDS = [
  'stone',
  'brick',
  'ore',
  'iron',
  'coal',
  'gear',
  'steel',
  'copper',
  'wire',
  'crude',
  'plastic',
  'silicon',
  'chip',
  'uranium',
  'fuelRod',
  'power',
  'aiCore',
  'robot',
  // 0.9.5 era 2-4 content (docs/ERA_RESOURCES.md): appended so older kinds keep their index
  'clay',
  'roofTile',
  'hearth',
  'charcoal',
  'tools',
  'rail',
  'scrap',
  'boiler',
  'steamEngine',
  // 0.9.5 era 5-7 content
  'girder',
  'snowplow',
  'quartz',
  'bulb',
  'radio',
  'gas',
  'fuel',
  'snowmobile',
  // 0.9.5 eras 8-10 (Era 8 to 10 content): second extractors, second processors and premium goods
  'gold',
  'board',
  'computer',
  'graphite',
  'battery',
  'quantumCore',
  // 0.9.6 (decision 15): eras 5 and 10 get a main resource of their own
  'pigIron',
  'dataShard',
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** ERA_KEYS[n - 2] is era n (2..10). Era 1 (Survival) has no key. */
export const ERA_KEYS = ['frontier', 'iron', 'steam', 'industrial', 'electric', 'oil', 'computer', 'nuclear', 'ai'] as const;
export type EraKey = (typeof ERA_KEYS)[number];
