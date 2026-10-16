/**
 * [eras] 0.9.5: the player's own upgrades in every era 2..10 (docs/EXPANSION.md section D "player" group), the era
 * versions of Strong Arms, Snow Boots, Sharp Axe and the Sled Dog. Labels come from eras/template.ts ERA_CONTENT[n].
 * They work while the player stands in era n's region (eras/data.ts REGIONS[n].rect), so every era has its own
 * hands-on grind:
 * - `${key}Carry`: extra items in the arms;
 * - `${key}Boots`: walk speed ×value;
 * - `${key}Tool`: seconds per swing at the era's hand node (eras/HandNode.ts);
 * - `${key}Pal`: the era's companion carries extra items (0 = not adopted).
 * Eleven authored values each (Lv 0..10; 0.9.6: Lv 10 is authored and the biggest step). No cost tables: every step is
 * priced on the era's band curve (core/ladder.ts costAt), like the other era upgrades. Pure data + pure helpers (no THREE, no GameContext).
 */
import type { UpgradeDef } from '../config';
import { ERA_KEYS, ERA_NAMES, REGIONS, type EraKey } from './data';
import { eraContent } from './template';

export const ERA_PLAYER_KINDS = ['Carry', 'Boots', 'Tool', 'Pal'] as const;
export type EraPlayerKind = (typeof ERA_PLAYER_KINDS)[number];
export type EraPlayerUpgradeId = `${EraKey}${EraPlayerKind}`;

/** Extra arms capacity per Carry level (Strong Arms adds about 3 a level in Survival). */
export const ERA_CARRY_VALUES: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 14, 17, 20, 24];
/** Walk speed multiplier per Boots level. */
export const ERA_BOOTS_VALUES: readonly number[] = [1, 1.04, 1.08, 1.12, 1.16, 1.2, 1.25, 1.3, 1.35, 1.4, 1.5];
/** Seconds per swing per Tool level (eras/HandNode.ts NODE_BASE_INTERVAL at level 0, ×0.92 a level). */
export const ERA_TOOL_VALUES: readonly number[] = [0.5, 0.46, 0.42, 0.39, 0.36, 0.33, 0.3, 0.27, 0.25, 0.22, 0.19];
/** Extra items the pal carries per Pal level (0 = not adopted; 12 at Lv 10, the count cap, so Lv 10 adds two). */
export const ERA_PAL_VALUES: readonly number[] = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];

export function eraPlayerUpgrades(): Record<EraPlayerUpgradeId, UpgradeDef> {
  const out = {} as Record<EraPlayerUpgradeId, UpgradeDef>;
  ERA_KEYS.forEach((key, i) => {
    const n = i + 2;
    const name = ERA_NAMES[n]!;
    const p = eraContent(n).player;
    const base = { group: 'lumberjack' as const, era: n, costs: [] as number[], requires: { era: n } };
    out[`${key}Carry`] = { ...base, id: `${key}Carry`, label: p.carry, blurb: `Carry more while you work in the ${name}`, values: ERA_CARRY_VALUES, display: 'count', unit: 'extra items' };
    out[`${key}Boots`] = { ...base, id: `${key}Boots`, label: p.boots, blurb: `Walk faster through the ${name}`, values: ERA_BOOTS_VALUES, display: 'boost' };
    out[`${key}Tool`] = { ...base, id: `${key}Tool`, label: p.tool, blurb: `Work the ${eraContent(n).node.label} faster`, values: ERA_TOOL_VALUES, display: 'rate', unit: 'strikes/s' };
    out[`${key}Pal`] = { ...base, id: `${key}Pal`, label: p.pal, blurb: `A ${name} companion who carries for you`, values: ERA_PAL_VALUES, display: 'count', unit: 'extra items' };
  });
  return out;
}

/** The era (2..10) whose region contains (x, z), or 0 outside every region. */
export function regionAt(x: number, z: number): number {
  for (let n = 2; n < REGIONS.length; n++) {
    const r = REGIONS[n]?.rect;
    if (r && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return n;
  }
  return 0;
}

/** The player upgrade id of era n (2..10). */
export const eraPlayerId = (n: number, kind: EraPlayerKind): EraPlayerUpgradeId => `${ERA_KEYS[n - 2]!}${kind}`;
