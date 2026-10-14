/**
 * [B3 — world/ridge] Timber Ridge: the snowy land east of the tricycle road (LAYOUT.ridge), opened by the 'ridge'
 * pad. A gate in the yard's east fence and a crossing over the road lead to a pine forest (the tree feller's work
 * area), the log deck, the rail line + platform (freight trains) and the crew bunkhouse site.
 *
 * CONTRACT (keep every public signature; B3 owns the implementation):
 * - State: ctx.state.unlocked.ridge is the truth. The constructor builds everything; when already unlocked it
 *   reveals at once and silently (restored save). Level calls reveal(false) on the live unlock.
 * - reveal(instant): opens the gate, adds LAYOUT.ridge.walk to ctx.colliders (addBounds), shows the ridge.
 *   Idempotent. No events of its own (the pad's unlock moment is the event).
 * - trees: every pine the feller can cut (index, x, z, standing). fell(i) topples a standing tree (animation unless
 *   hidden), marks it not standing, emits 'tree:felled', and it regrows after RIDGE.regrowSeconds. Trees are not
 *   saved: a reload starts with a full forest.
 * - nearestStanding(x, z): the closest standing pine, or null.
 *
 * STUB (main session): bookkeeping + walkable area only; trees on a grid, nothing drawn.
 */
import * as THREE from 'three';
import { LAYOUT, RIDGE } from '../config';
import type { GameContext } from '../core/types';

export interface PineTree {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  standing: boolean;
}

export class Ridge {
  /** Everything the ridge draws hangs under this group. */
  readonly root = new THREE.Group();
  readonly trees: PineTree[] = [];
  private open = false;
  private readonly regrow = new Map<number, number>();

  constructor(readonly ctx: GameContext) {
    this.root.name = 'ridge';
    this.root.visible = false;
    ctx.scene.add(this.root);
    const f = LAYOUT.ridge.forest;
    let i = 0;
    for (let x = f.minX + 1; x < f.maxX - 0.5; x += 2.2) {
      for (let z = f.minZ + 1; z < f.maxZ - 0.5; z += 2.2) this.trees.push({ index: i++, x, z, standing: true });
    }
    if (ctx.state.unlocked.ridge) this.reveal(true);
  }

  get revealed(): boolean {
    return this.open;
  }

  reveal(_instant = false): void {
    if (this.open) return;
    this.open = true;
    this.root.visible = true;
    for (const r of LAYOUT.ridge.walk) this.ctx.colliders.addBounds(r);
  }

  nearestStanding(x: number, z: number): PineTree | null {
    let best: PineTree | null = null;
    let bd = Infinity;
    for (const t of this.trees) {
      if (!t.standing) continue;
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  fell(index: number): boolean {
    const t = this.trees[index];
    if (!t || !t.standing) return false;
    t.standing = false;
    this.regrow.set(index, RIDGE.regrowSeconds);
    this.ctx.events.emit('tree:felled', { index, position: new THREE.Vector3(t.x, 0, t.z) });
    return true;
  }

  update(dt: number): void {
    for (const [i, left] of this.regrow) {
      if (left - dt > 0) this.regrow.set(i, left - dt);
      else {
        this.regrow.delete(i);
        this.trees[i]!.standing = true;
      }
    }
  }
}
