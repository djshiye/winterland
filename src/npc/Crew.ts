/**
 * [B5 — commerce/NPC] Hired helpers ('worker' characters) that automate the manual loops.
 *
 * - A helper exists for every crew upgrade with level ≥ 1 (ctx.upgrades.isHired). The constructor (and a cheap
 *   reconcile in update(), which also covers debug setUpgrade) spawns already-hired ones AT ONCE at their posts,
 *   empty-handed and silently. On 'upgrade:bought' for a crew id at level 1 the helper walks out of the cabin door
 *   (LAYOUT.shop.door) and 'helper:hired' is emitted.
 * - Work speed / capacity = CREW[id] base × ctx.upgrades.value(id), read live (levels apply at once).
 * - crateRunner: processor output (bench) → SE counter. cashier: cash piles → the cabin door, where the bundles
 *   fly in and their value is added to the money. logHauler: drop zone → truck counter (or the walk-in counter
 *   when the trucks are full). Scripted waypoint routes, no colliders; all moves via items/transfer.ts.
 * The behaviours live in npc/crewHelpers.ts.
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import type { CrewRole } from '../core/crew';
import type { GameContext, ItemKind } from '../core/types';
import type { Level } from '../level/Level';
import {
  CREW_IDS,
  Cashier,
  CrateRunner,
  DepositSink,
  HOME,
  HOME_LOOK,
  HOME_ROUTE,
  Helper,
  LogHauler,
  type CrewId,
} from './crewHelpers';

export class Crew {
  private readonly helpers = new Map<CrewId, Helper>();
  private readonly sink: DepositSink;
  private reconcileTimer = 0;

  constructor(
    readonly ctx: GameContext,
    readonly level: Level,
  ) {
    this.sink = new DepositSink(ctx);
    ctx.events.on('upgrade:bought', ({ id, level: lv }) => {
      if (lv === 1 && (CREW_IDS as readonly string[]).includes(id)) this.hire(id as CrewId, true);
    });
    this.reconcile();
  }

  /** Helpers currently in the world. */
  get size(): number {
    return this.helpers.size;
  }

  get(id: CrewId): Helper | undefined {
    return this.helpers.get(id);
  }

  /**
   * CONTRACT (wave 7, used by the save): items of `kind` carried by every helper of `role` (several per role once
   * the bunkhouse allows it, core/crew.ts crewSlots), and the dollar value they carry.
   */
  carried(role: CrewRole, kind: ItemKind): number {
    return this.helpers.get(role as CrewId)?.stack.count(kind) ?? 0;
  }

  carriedValue(role: CrewRole): number {
    return this.helpers.get(role as CrewId)?.stack.totalValue() ?? 0;
  }

  update(dt: number): void {
    this.reconcileTimer -= dt;
    if (this.reconcileTimer <= 0) {
      this.reconcileTimer = 0.5;
      this.reconcile();
    }
    for (const h of this.helpers.values()) h.update(dt);
  }

  /** Spawn missing helpers (silently, at their posts) and remove ones that are no longer hired. */
  private reconcile(): void {
    for (const id of CREW_IDS) {
      const have = this.helpers.get(id);
      const hired = this.ctx.upgrades.isHired(id);
      if (hired && !have) this.hire(id, false);
      else if (!hired && have) {
        have.dispose();
        this.helpers.delete(id);
      }
    }
  }

  private hire(id: CrewId, walkOut: boolean): void {
    if (this.helpers.has(id)) return;
    const h = this.create(id);
    this.helpers.set(id, h);
    if (!walkOut) {
      h.placeAt(HOME[id], HOME_LOOK[id]);
      return;
    }
    h.placeAt(LAYOUT.shop.door, null);
    h.go([...HOME_ROUTE[id]]);
    this.ctx.tweens.popIn(h.group, { duration: 0.35 });
    const position = new THREE.Vector3(LAYOUT.shop.door.x, 0, LAYOUT.shop.door.z);
    this.ctx.events.emit('helper:hired', { id, position });
  }

  private create(id: CrewId): Helper {
    switch (id) {
      case 'crateRunner':
        return new CrateRunner(this.ctx, this.level);
      case 'cashier':
        return new Cashier(this.ctx, this.level, this.sink);
      case 'logHauler':
        return new LogHauler(this.ctx, this.level);
    }
  }
}
