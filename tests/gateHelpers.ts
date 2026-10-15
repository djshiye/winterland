/** Test helper: meet era n's gate (docs/EXPANSION.md §C) on a bare state, so its expansion pad is offered. */
import { UPGRADES, VILLAGE } from '../src/config';
import { base, introEra } from '../src/core/ladder';
import type { GameState, UpgradeId } from '../src/core/types';
import { gateNeed } from '../src/eras/gate';

/** Build the Great Lodge (Winterland) and raise every upgrade introduced before era n to the gate's shown level. */
export function meetGate(s: GameState, n: number): void {
  s.village.greatLodge.tier = 0;
  s.village.level = VILLAGE.levels.length - 1;
  for (const id of Object.keys(UPGRADES) as UpgradeId[]) {
    const def = UPGRADES[id];
    if (introEra(def) <= n - 1) s.upgrades[id] = Math.max(s.upgrades[id], gateNeed(n) - base(def));
  }
}
