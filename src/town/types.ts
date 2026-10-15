/**
 * [MAIN — wave 9 contract] Shared shapes between the Market Town (town/Town.ts, town/Business.ts) and the
 * townsfolk (npc/Townsfolk.ts). Owned by the main session: change only by agreement.
 */
import type * as THREE from 'three';
import type { BusinessDef, XZ } from '../config';
import type { Pile } from '../items/Pile';
import type { CashPile } from '../stations/CashPile';

/** A built, staffed shop that townsfolk can buy from (Town.shops()). */
export interface ShopSpot {
  readonly lot: number;
  readonly def: BusinessDef;
  /** Goods for sale (def.output items). Buyers take from it with transfer.ts (one item per TIMING.npcTakeInterval). */
  readonly counter: Pile;
  /** Where buyers pay: till.pay(amount, from). */
  readonly till: CashPile;
  /** Ground spot (world XZ) of queue place `i` (0 = at the counter); buyers face `facing` (yaw, radians) there. */
  queueSpot(i: number, out: XZ): XZ;
  readonly facing: number;
  /** World position just above the counter (sale juice, coin burst origin). */
  readonly counterTop: THREE.Vector3;
}
