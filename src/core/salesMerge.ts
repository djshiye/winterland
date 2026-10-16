/**
 * [PURE] 0.9.6 (decision 9): each era's Trade upgrade (`${key}Trade`, every material of the era sells for more) and
 * each material's Fine upgrade (`${kind}Quality`) raised the same price, so they are one sales upgrade per material
 * now, `${kind}Quality`. An older save keeps what it paid for (core/Save.ts migration '0.9.6-trade-merge'):
 * - every material of era n takes max(its Fine level, era n's old Trade level), at most Lv 10;
 * - the Trade levels no material carries over are refunded at what they cost (core/refund.ts refundPrice, like the
 *   Lv 10 refund): the first min(Trade, the era's lowest Fine) levels (every material already had them as Fine), and
 *   every Trade level past 10.
 * So a save with Trade and every Fine at Lv 10 keeps Lv 10 on each material and gets all ten Trade levels back as cash;
 * a save with Trade 10 and no Fine gets Lv 10 on every material and no cash.
 */
import type { UpgradeDef } from '../config';
import { ERAS, MATERIAL_KINDS, MATERIALS, MAX_ERA } from '../eras/data';
import { refundPrice } from './refund';

/** Lv 10, the top of every upgrade. */
const TOP = 10;

/** The removed `${key}Trade` upgrade of era n, as refundPrice needs it (an era 'industry' id, priced on its band). */
export function legacyTradeDef(n: number): UpgradeDef {
  const key = ERAS[n]!.key;
  return { id: `${key}Trade`, group: 'industry', era: n, label: `${ERAS[n]!.name} Trade`, blurb: '', values: [1, 1.1, 1.2, 1.32, 1.45, 1.6, 1.75, 1.9, 2.1, 2.4], costs: [], display: 'mult', requires: { era: n } } as unknown as UpgradeDef;
}

export interface TradeMergeResult {
  /** Dollars refunded for Trade levels no material carried over. */
  refund: number;
  /** How many Trade levels were refunded. */
  levels: number;
}

/** Fold the saved `${key}Trade` levels (`saved`: the raw saved upgrades record) into `upgrades` (the merged state's). */
export function mergeTradeIntoSales(upgrades: Record<string, number>, saved: unknown): TradeMergeResult {
  const out: TradeMergeResult = { refund: 0, levels: 0 };
  if (typeof saved !== 'object' || saved === null) return out;
  const old = saved as Record<string, unknown>;
  for (let n = 2; n <= MAX_ERA; n++) {
    const raw = old[`${ERAS[n]!.key}Trade`];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) continue;
    const trade = Math.floor(raw);
    const kinds = MATERIAL_KINDS.filter((k) => MATERIALS[k].era === n);
    let lowest = TOP;
    for (const k of kinds) lowest = Math.min(lowest, upgrades[`${k}Quality`] ?? 0);
    for (const k of kinds) upgrades[`${k}Quality`] = Math.max(upgrades[`${k}Quality`] ?? 0, Math.min(TOP, trade));
    const def = legacyTradeDef(n);
    for (let s = 0; s < trade; s++) {
      if (s < Math.min(TOP, lowest) || s >= TOP) {
        out.refund += refundPrice(def, s);
        out.levels++;
      }
    }
  }
  out.refund = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(out.refund));
  return out;
}
