/**
 * [B5 — commerce/NPC] Hired helpers ('worker' characters) that automate the manual loops.
 *
 * - The number of helpers of a role is crewSlots(state, role) (core/crew.ts): 0 when not hired, 1+ once hired, more
 *   as the crew bunkhouse tier rises. It is read live: a cheap reconcile every 0.5 s spawns missing helpers (silently,
 *   AT ONCE at their posts, empty-handed: restore + debug setUpgrade) and removes surplus ones.
 * - On 'upgrade:bought' (a crew id) and 'quarters:built' the reconcile runs at once in "walk-out" mode: every new
 *   helper walks out of the cabin door (LAYOUT.shop.door) to its post (staggered when several arrive together) and
 *   'helper:hired' is emitted once per new helper.
 * - Work speed / capacity = CREW[id] base × ctx.upgrades.value(id), read live (levels apply at once).
 * - crateRunner: processor output (bench) → SE counter. cashier: cash piles → the cabin door, where the bundles
 *   fly in and their value is added to the money. logHauler: drop zone → truck counter (or the walk-in counter
 *   when the trucks are full). pineHauler: Timber Ridge log deck → platform counter. Scripted waypoint routes, no
 *   colliders; all moves via items/transfer.ts. Helpers of one role work from offset lanes and start staggered.
 * The behaviours live in npc/crewHelpers.ts.
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import { crewSlots, type CrewRole } from '../core/crew';
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
  PineHauler,
  type CrewId,
} from './crewHelpers';

/** Seconds between two helpers walking out of the door in one reconcile. */
const WALK_OUT_STAGGER = 0.6;

export class Crew {
  private readonly helpers = new Map<CrewId, Helper[]>();
  /** Removed helpers still waiting for their inflight items to land (Helper.dispose). */
  private readonly leaving: Helper[] = [];
  private readonly sink: DepositSink;
  private reconcileTimer = 0;
  /** Simulation time when the next walk-out may leave the door (staggers helpers across reconciles). */
  private releaseAt = 0;

  constructor(
    readonly ctx: GameContext,
    readonly level: Level,
  ) {
    this.sink = new DepositSink(ctx);
    for (const id of CREW_IDS) this.helpers.set(id, []);
    ctx.events.on('upgrade:bought', ({ id }) => {
      if ((CREW_IDS as readonly string[]).includes(id)) this.reconcile(true);
    });
    ctx.events.on('quarters:built', () => this.reconcile(true));
    this.reconcile(false);
  }

  /** Helpers currently in the world (all roles). */
  get size(): number {
    let n = 0;
    for (const list of this.helpers.values()) n += list.length;
    return n;
  }

  /** Helpers of one role currently in the world. */
  count(role: CrewRole): number {
    return this.helpers.get(role)?.length ?? 0;
  }

  /** The first helper of a role. */
  get(id: CrewId): Helper | undefined {
    return this.helpers.get(id)?.[0];
  }

  /**
   * CONTRACT (wave 7, used by the save): items of `kind` carried by every helper of `role` (several per role once
   * the bunkhouse allows it, core/crew.ts crewSlots), and the dollar value they carry.
   */
  carried(role: CrewRole, kind: ItemKind): number {
    let n = 0;
    const flights = this.ctx.flights;
    // Items still flying onto a helper's stack have left their pile but are not on the stack yet.
    for (const h of this.helpers.get(role) ?? []) n += h.stack.count(kind) + flights.inFlightTo(h.stack, kind);
    for (const h of this.leaving) if (h.id === role) n += h.stack.count(kind) + flights.inFlightTo(h.stack, kind);
    return n;
  }

  carriedValue(role: CrewRole): number {
    let v = 0;
    const flights = this.ctx.flights;
    // Cash flying pile -> cashier stack and cashier stack -> cabin door (deposit sink) is in neither holder yet.
    for (const h of this.helpers.get(role) ?? []) v += h.stack.totalValue() + flights.valueInFlightTo(h.stack);
    for (const h of this.leaving) if (h.id === role) v += h.stack.totalValue() + flights.valueInFlightTo(h.stack);
    if (role === 'cashier') v += flights.valueInFlightTo(this.sink);
    return v;
  }

  update(dt: number): void {
    this.reconcileTimer -= dt;
    if (this.reconcileTimer <= 0) {
      this.reconcileTimer = 0.5;
      this.reconcile(false);
    }
    for (const list of this.helpers.values()) for (const h of list) h.update(dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const h = this.leaving[i]!;
      h.update(dt);
      if (h.disposed) this.leaving.splice(i, 1);
    }
  }

  /**
   * Bring every role to crewSlots(): spawn missing helpers and remove surplus ones. `walkOut` = a live purchase
   * (they leave the cabin door and 'helper:hired' fires); otherwise they simply appear at their posts.
   */
  private reconcile(walkOut: boolean): void {
    for (const id of CREW_IDS) {
      const list = this.helpers.get(id)!;
      const want = crewSlots(this.ctx.state, id);
      while (list.length < want) {
        const h = this.create(id, list.length);
        list.push(h);
        for (const o of list) o.peers = list;
        if (walkOut) this.walkOut(h, id);
        else h.placeAt(HOME[id], HOME_LOOK[id]);
      }
      while (list.length > want) {
        const h = list.pop()!;
        h.dispose();
        if (!h.disposed) this.leaving.push(h);
      }
    }
  }

  /** The helper stays invisible and frozen for its stagger slot, then walks out of the cabin door. */
  private walkOut(h: Helper, id: CrewId): void {
    const now = this.ctx.time.elapsed;
    const at = Math.max(now, this.releaseAt);
    this.releaseAt = at + WALK_OUT_STAGGER;
    h.group.visible = false;
    h.placeAt(LAYOUT.shop.door, null, false);
    h.hold = 0.001 + (at - now);
    h.onRelease = () => {
      h.go([...HOME_ROUTE[id]]);
      this.ctx.tweens.popIn(h.group, { duration: 0.35 });
      const position = new THREE.Vector3(LAYOUT.shop.door.x, 0, LAYOUT.shop.door.z);
      this.ctx.events.emit('helper:hired', { id, position });
    };
  }

  private create(id: CrewId, index: number): Helper {
    switch (id) {
      case 'crateRunner':
        return new CrateRunner(this.ctx, this.level, index);
      case 'cashier':
        return new Cashier(this.ctx, this.level, this.sink, index);
      case 'logHauler':
        return new LogHauler(this.ctx, this.level, index);
      case 'pineHauler':
        return new PineHauler(this.ctx, this.level, index);
    }
  }
}
