/**
 * [B6 — machines] Tree feller on Timber Ridge: a tracked forestry machine that drives to the nearest standing pine
 * (ridge.nearestStanding), cuts it (ridge.fell → topples), and drops RIDGE.logsPerTree pine logs ('log' items)
 * onto the log deck (LAYOUT.ridge.deck). One tree every ctx.upgrades.value('treeFeller') seconds (read live).
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - deck: Pile of logs at LAYOUT.ridge.deck; a transfer zone (deck.zone) lets the player pick logs up into the arms.
 *   The pine hauler (crew) and the player take logs from it to the rail platform.
 * - build(instant): visible + running; instant (restore) = final state, no animation / 'built' event / sound.
 * - The deck stops the feller when full (it idles).
 *
 * STUB (main session): no model; logs appear on the deck on a timer.
 */
import * as THREE from 'three';
import { LAYOUT, RIDGE } from '../config';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Ridge } from '../ridge/Ridge';

export class TreeFeller {
  readonly root = new THREE.Group();
  readonly deck: Pile;
  private timer = 0;
  private running = false;

  constructor(
    readonly ctx: GameContext,
    readonly ridge: Ridge,
  ) {
    const d = LAYOUT.ridge.deck;
    this.deck = new Pile(ctx, { id: 'pile:deck', accepts: ['log'], position: new THREE.Vector3(d.x, 0, d.z), grid: d.grid });
    ctx.zones.addTransfer({ id: 'pile:deck:pickup', area: d.zone, from: this.deck, to: ctx.player.arms, kinds: ['log'] });
    ctx.scene.add(this.root);
  }

  build(_instant = false): void {
    this.running = true;
  }

  update(dt: number): void {
    if (!this.running) return;
    this.timer += dt;
    const interval = this.ctx.upgrades.value('treeFeller');
    if (this.timer < interval) return;
    if (this.deck.capacity - this.deck.total < RIDGE.logsPerTree) return;
    const d = LAYOUT.ridge.deck;
    const tree = this.ridge.nearestStanding(d.x, d.z);
    if (!tree) return;
    this.timer = 0;
    this.ridge.fell(tree.index);
    const from = new THREE.Vector3(tree.x, 1, tree.z);
    for (let i = 0; i < RIDGE.logsPerTree; i++) launchNew(this.ctx, 'log', from, this.deck, { duration: 0.6, arcHeight: 2 });
  }
}
