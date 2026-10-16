/** Test helper: meet era n's gate (docs/EXPANSION.md §C) on a bare state, so its expansion pad is offered. */
import { UPGRADES, VILLAGE } from '../src/config';
import { base, introEra } from '../src/core/ladder';
import type { GameState, UpgradeId } from '../src/core/types';
import { gateNeed, settlementNeed } from '../src/eras/gate';

/**
 * Build the Great Lodge (Winterland), raise every upgrade introduced before era n to the gate's shown level and set the
 * best settlement level to the gate's need (as if the city had reached it; tests/settlement.test.ts covers the scale).
 */
export function meetGate(s: GameState, n: number): void {
  s.village.greatLodge.tier = 0;
  s.village.level = VILLAGE.levels.length - 1;
  for (const id of Object.keys(UPGRADES) as UpgradeId[]) {
    const def = UPGRADES[id];
    if (introEra(def) <= n - 1) s.upgrades[id] = Math.max(s.upgrades[id], gateNeed(n) - base(def));
  }
  s.eras.settlement = Math.max(s.eras.settlement, settlementNeed(n));
}
