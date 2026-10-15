/**
 * [B6 — machines] Furniture workshop on Timber Ridge (wave 8, pad 'workshop', LAYOUT.ridge.workshop). A cosy
 * log-cabin workshop: logs dropped in the west hopper become chairs ('furniture' items) on the east bench, one
 * every ctx.upgrades.value('workshop') seconds (read live). Dog sleds (npc/SledQueue) buy them at the sled
 * counter; the player carries them over.
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - input: hopper Pile (logs); a transfer zone (hopper.zone) takes logs from the player's arms.
 * - output: bench Pile (furniture); a transfer zone (bench.zone) gives furniture to the player's arms.
 * - Each piece: take a log, animate it into the workshop (saw sound / sawdust), launchNew('furniture') onto the
 *   bench; emit 'built'-style juice as the other machines do; stats.furnitureMade++. Idles when starved / full.
 * - build(instant): visible + running; instant (restore) = final state, no animation / event / sound.
 * - Machine level badge like the other machines (upgrade 'workshop').
 *
 * STUB (main session): no model; piles, zones and a timer.
 */
import * as THREE from 'three';
import { LAYOUT, TIMING } from '../config';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';

export class Workshop {
  readonly root = new THREE.Group();
  readonly input: Pile;
  readonly output: Pile;
  private timer = 0;
  private running = false;

  constructor(readonly ctx: GameContext) {
    const W = LAYOUT.ridge.workshop;
    this.input = new Pile(ctx, { id: 'pile:workshopIn', accepts: ['log'], position: new THREE.Vector3(W.hopper.x, 0.3, W.hopper.z), grid: W.hopper.grid });
    this.output = new Pile(ctx, { id: 'pile:workshopOut', accepts: ['furniture'], position: new THREE.Vector3(W.bench.x, 0.6, W.bench.z), grid: W.bench.grid });
    ctx.zones.addTransfer({ id: 'pile:workshopIn:feed', area: W.hopper.zone, from: ctx.player.arms, to: this.input, kinds: ['log'], interval: TIMING.dropInterval, marker: true });
    ctx.zones.addTransfer({ id: 'pile:workshopOut:pickup', area: W.bench.zone, from: this.output, to: ctx.player.arms, kinds: ['furniture'], interval: TIMING.pickupInterval, marker: true });
    ctx.scene.add(this.root);
  }

  build(_instant = false): void {
    this.running = true;
  }

  update(dt: number): void {
    if (!this.running) return;
    this.timer += dt;
    if (this.timer < this.ctx.upgrades.value('workshop')) return;
    if (!this.output.canAccept('furniture')) return;
    const log = this.input.take('log');
    if (!log) return;
    this.timer = 0;
    this.ctx.items.release(log);
    const W = LAYOUT.ridge.workshop;
    launchNew(this.ctx, 'furniture', new THREE.Vector3(W.x, 1, W.z), this.output, { duration: 0.5, arcHeight: 1 });
    this.ctx.state.stats.furnitureMade++;
  }
}
