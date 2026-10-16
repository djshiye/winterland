/**
 * [PURE] 0.9.6 (decision 9): each era's Trade upgrade (`${key}Trade`, every material of the era sells for more) and
 * each material's Fine upgrade (`${kind}Quality`) raised the same price, so they are one sales upgrade per material
 * now, `${kind}Quality`. An older save keeps what it paid for: every material of era n takes max(its Fine level, era
 * n's old Trade level). Not capped here: sanitizeState clamps to the safe max and the Lv 10 refund migration
 * (core/Save.ts) refunds levels past 10 as cash. Called by core/Save.ts mergeState on the raw saved upgrades, before
 * the Trade ids are dropped as unknown.
 */
import { ERAS, MATERIAL_KINDS, MATERIALS } from '../eras/data';

export function carryTradeIntoSales(upgrades: Record<string, number>, saved: unknown): void {
  if (typeof saved !== 'object' || saved === null) return;
  const old = saved as Record<string, unknown>;
  for (const kind of MATERIAL_KINDS) {
    const key = ERAS[MATERIALS[kind].era]?.key;
    const trade = key ? old[`${key}Trade`] : undefined;
    if (typeof trade !== 'number' || !Number.isFinite(trade) || trade <= 0) continue;
    const id = `${kind}Quality`;
    upgrades[id] = Math.max(upgrades[id] ?? 0, Math.floor(trade));
  }
}
