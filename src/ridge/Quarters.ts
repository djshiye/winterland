/**
 * [B3 — world/ridge] Crew bunkhouse ("living quarters") on Timber Ridge (LAYOUT.ridge.quarters, QUARTERS tiers).
 *
 * CONTRACT (keep every public signature; B3 owns the implementation):
 * - State: ctx.state.quarters (tier −1 = none, logs / cash paid toward the next tier) is the truth. The constructor
 *   builds from it at once and silently (model of the current tier, pad re-armed with partial progress).
 * - Once the ridge is open (ctx.state.unlocked.ridge; poll it or be told by Level via offer()), a ConstructionPad
 *   (stations/ConstructionPad.ts, key 'quarters') at LAYOUT.ridge.quarters.pad offers the next tier; onProgress
 *   mirrors logs / cash into state. On completion: state.quarters.tier = tier, swap the model, emit
 *   'quarters:built' {tier, position}. More crew may then work (core/crew.ts crewSlots; npc/Crew reads it live).
 * - padSpot(): where to stand to pay the current pad, or null when none is offered (bot / guide).
 * - debugBuild(tier): set the tier at once (same bookkeeping + event when it rises).
 *
 * STUB (main session): state only, no model, no pad.
 */
import * as THREE from 'three';
import { LAYOUT, type XZ } from '../config';
import type { GameContext } from '../core/types';

export class Quarters {
  readonly root = new THREE.Group();

  constructor(readonly ctx: GameContext) {
    this.root.name = 'quarters';
    ctx.scene.add(this.root);
  }

  get tier(): number {
    return this.ctx.state.quarters.tier;
  }

  /** The ridge just opened: offer the first tier. */
  offer(): void {}

  padSpot(): XZ | null {
    return null;
  }

  debugBuild(tier: number): void {
    const q = this.ctx.state.quarters;
    const rose = tier > q.tier;
    q.tier = tier;
    q.logs = 0;
    q.cash = 0;
    const p = LAYOUT.ridge.quarters;
    if (rose) this.ctx.events.emit('quarters:built', { tier, position: new THREE.Vector3(p.x, 0, p.z) });
  }

  update(_dt: number): void {}
}
