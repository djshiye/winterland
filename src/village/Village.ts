/**
 * [B3 — world/village] The winter village south of the yard (LAYOUT.village, VILLAGE): a gate in the south
 * fence, a street, 8 plots whose shelters grow Tent → Hut → Cabin → Lodge, and the Great Lodge (the finale).
 *
 * CONTRACT (keep every public signature; B3 owns the implementation):
 * - State: ctx.state.village is the truth. The constructor builds everything from it AT ONCE and silently (a
 *   restored save: open gate + walkable bounds, built shelters, pads re-armed with partial progress). Afterwards
 *   the village writes it as progress happens (plot tier / logs / cash through the pads' onProgress).
 * - reveal(instant): opens the gate, adds LAYOUT.village.walk to ctx.colliders (addBounds), offers the plots
 *   allowed at the current level, emits 'village:revealed' (not when instant). Idempotent. Progression calls it.
 * - One ConstructionPad (stations/ConstructionPad.ts) per plot in the street + one for the Great Lodge; a plot
 *   is offered when its VILLAGE.plotLevels entry ≤ the village level; the next tier is offered when its
 *   requiresLevel ≤ the level; the Great Lodge pad needs VILLAGE.greatLodge.requiresLevel.
 * - On a completed tier: build / swap the shelter model, stats.sheltersBuilt++, emit 'shelter:built', then
 *   recompute population + level (core/demand.ts villagePopulation / villageLevelFor), write
 *   state.village.population / level, emit 'village:changed' and, when the level rose, 'village:levelUp'; offer
 *   whatever the new level unlocks.
 * - The Great Lodge completing sets greatLodge.tier = 0 (level becomes the last one, Winterland). Progression
 *   reacts to 'shelter:built' with plot −1 for the finale.
 *
 * STUB (main session): state bookkeeping + walkable area only; no models, no pads.
 */
import * as THREE from 'three';
import { LAYOUT, type XZ } from '../config';
import { villageLevelFor, villagePopulation } from '../core/demand';
import type { GameContext } from '../core/types';

export class Village {
  /** Everything the village draws hangs under this group. */
  readonly root = new THREE.Group();
  private gateOpen = false;

  constructor(readonly ctx: GameContext) {
    this.root.name = 'village';
    ctx.scene.add(this.root);
    this.recompute(false);
    if (ctx.state.village.revealed) this.openGate(true);
  }

  get revealed(): boolean {
    return this.ctx.state.village.revealed;
  }

  get population(): number {
    return this.ctx.state.village.population;
  }

  get level(): number {
    return this.ctx.state.village.level;
  }

  /** Open the gate and offer the first plots. Idempotent. */
  reveal(instant = false): void {
    if (this.ctx.state.village.revealed) return;
    this.ctx.state.village.revealed = true;
    this.openGate(instant);
    if (!instant) {
      const g = LAYOUT.village.gate;
      this.ctx.events.emit('village:revealed', { position: new THREE.Vector3((g.minX + g.maxX) / 2, 0, 10.4) });
    }
    this.recompute(!instant);
  }

  /** Debug / bot: set plot `plot` (−1 = the Great Lodge) to `tier` at once (progress toward the next tier reset). */
  debugBuild(plot: number, tier: number): void {
    const v = this.ctx.state.village;
    const p = plot < 0 ? v.greatLodge : v.plots[plot];
    if (!p) return;
    p.tier = tier;
    p.logs = 0;
    p.cash = 0;
    this.recompute(true);
  }

  /**
   * Where the player stands to pay plot `plot`'s current pad (−1 = the Great Lodge), or null when no pad is
   * offered there right now (bots / guide).
   */
  padSpot(_plot: number): XZ | null {
    return null;
  }

  update(_dt: number): void {}

  private openGate(_instant: boolean): void {
    if (this.gateOpen) return;
    this.gateOpen = true;
    for (const r of LAYOUT.village.walk) this.ctx.colliders.addBounds(r);
  }

  /** Population + level from the plots; events when `emit` and something changed. */
  private recompute(emit: boolean): void {
    const v = this.ctx.state.village;
    const population = villagePopulation(this.ctx.state);
    const level = villageLevelFor(population, v.greatLodge.tier >= 0);
    const changed = population !== v.population || level !== v.level;
    const rose = level > v.level;
    v.population = population;
    v.level = level;
    if (!emit || !changed) return;
    this.ctx.events.emit('village:changed', { population, level });
    if (rose) {
      const s = LAYOUT.village.street;
      this.ctx.events.emit('village:levelUp', { level, position: new THREE.Vector3((s.minX + s.maxX) / 2, 0, 18) });
    }
  }
}
