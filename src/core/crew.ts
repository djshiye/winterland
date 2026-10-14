/**
 * [MAIN] How many helpers of each crew role may work: 1 per hired role, more as the crew bunkhouse grows
 * (QUARTERS.crew, index = quarters tier + 1). 0 when the role isn't hired. Read live; never cache.
 */
import { QUARTERS } from '../config';
import type { GameState, UpgradeId } from './types';

export type CrewRole = keyof typeof QUARTERS.crew;
export const CREW_ROLES = Object.keys(QUARTERS.crew) as CrewRole[];

export function crewSlots(state: GameState, role: CrewRole): number {
  if ((state.upgrades[role as UpgradeId] ?? 0) <= 0) return 0;
  const row = QUARTERS.crew[role];
  return row[Math.max(0, Math.min(row.length - 1, state.quarters.tier + 1))]!;
}
