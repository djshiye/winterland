/**
 * [T2 — town] The Market Town (wave 9): LAYOUT.town, BUSINESSES, TOWN. Eight lots around a market square east of
 * the village; the player chooses what to build on each (build panel), pays for it like a shelter, and the
 * building then runs as a business (town/Business.ts) that adds people to the population (eras = village levels).
 *
 * CONTRACT (keep every public signature; T2 owns the implementation, MAIN owns Level / Progression wiring):
 * - State: ctx.state.town is the truth. The constructor builds everything from it AT ONCE and silently: an
 *   unrevealed town shows nothing interactive; a revealed one has walk bounds added, every built lot's business
 *   built (instant), every chosen-but-unpaid lot's ConstructionPad armed with its partial progress, every empty
 *   lot's "for sale" sign + lot pad. A restored lot whose paid amounts already cover its cost is built silently
 *   (the same rule Village / Quarters follow; stats.townBuilt++ once).
 * - reveal(instant): adds LAYOUT.town.walk to ctx.colliders (addBounds), calls ctx.environment.openTownGate(instant),
 *   sets state.town.revealed, offers the lots. Idempotent. Not instant: emits 'town:revealed'. Progression calls it.
 * - Empty lot: a lot pad (a Zone over a pad tile at lot centre + face × padOffset, labelled "BUILD"). While the
 *   player stands on it: emit 'build:open' { lot } once; on leaving: 'build:close'. The HUD's BuildPanel shows
 *   the choices (choices(lot)) and calls choose(lot, id).
 * - choose(lot, id): only when the lot's paid amounts are 0 and id is in choices(lot) with available = true. Sets
 *   state.town.lots[lot].building, emits 'build:chosen', arms the lot's ConstructionPad (key 'lot:<i>', same spot)
 *   for BUSINESSES[id] (logs + cash). Returns false otherwise. While nothing is paid, standing on the pad opens the
 *   build panel again so the choice can be changed (the pad shows the building's icon + "tap to change").
 * - Completion: state lot.tier = 0 (paid reset to 0), stats.townBuilt++, the business is built (not instant: pop-in,
 *   dust, chimney smoke starts), emit 'built' { what: 'town:<id>' } and 'town:built'. Village recomputes the
 *   population on 'town:built' (core/demand.ts villagePopulation counts BUSINESSES[id].people of built lots).
 * - shops(): every built shop business (ShopSpot) — the townsfolk buy there. tills(): every till CashPile.
 * - snapshot() / restore(): the world part of the save (WorldSnapshot['town'], one entry per lot): hopper counts by
 *   kind (+ the item being processed), out pile / counter count, till value (CashPile.value already counts cash in
 *   flight). Level adds the townsfolk's unpaid goods (Townsfolk.loadedByLot) to `out` before saving.
 * - padSpot(lot): the lot's pad position (the bot and the guide walk there). business(lot): the built business.
 *
 * Choices (choices(lot)): every BUSINESSES entry not in TOWN.hidden, with available = era ≤ village level, and
 * a reason when not ("Needs Winter City").
 */
import * as THREE from 'three';
import type { BusinessDef, BusinessId, XZ } from '../config';
import type { GameContext } from '../core/types';
import type { WorldSnapshot } from '../core/Save';
import type { CashPile } from '../stations/CashPile';
import type { Business } from './Business';
import type { ShopSpot } from './types';

export interface BuildChoice {
  def: BusinessDef;
  available: boolean;
  /** Why it can't be chosen yet ('Needs Winter City'), when !available. */
  reason?: string;
}

export class Town {
  /** Everything the town draws hangs under this group. */
  readonly root = new THREE.Group();

  constructor(readonly ctx: GameContext) {}

  get revealed(): boolean {
    return this.ctx.state.town.revealed;
  }

  reveal(_instant = false): void {}

  choices(_lot: number): BuildChoice[] {
    return [];
  }

  choose(_lot: number, _id: BusinessId): boolean {
    return false;
  }

  business(_lot: number): Business | null {
    return null;
  }

  shops(): ShopSpot[] {
    return [];
  }

  tills(): CashPile[] {
    return [];
  }

  padSpot(_lot: number): XZ | null {
    return null;
  }

  snapshot(): WorldSnapshot['town'] {
    return [];
  }

  restore(_w: WorldSnapshot['town']): void {}

  /** Debug: choose + finish lot `lot` as `id` at once (not instant: plays the build moment). */
  debugBuild(_lot: number, _id: BusinessId): void {}

  update(_dt: number): void {}
}
