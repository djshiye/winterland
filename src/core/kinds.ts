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
  // 0.9.5 era 5-7 content
  'girder',
  'snowplow',
  'quartz',
  'bulb',
  'radio',
  'gas',
  'fuel',
  'snowmobile',
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** ERA_KEYS[n - 2] is era n (2..10). Era 1 (Survival) has no key. */
export const ERA_KEYS = ['frontier', 'iron', 'steam', 'industrial', 'electric', 'oil', 'computer', 'nuclear', 'ai'] as const;
export type EraKey = (typeof ERA_KEYS)[number];
