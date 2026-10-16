/**
 * [B6 — machines] Truck loader: a belt in the expanded north yard that carries logs from the drop zone to the truck
 * counter (LAYOUT.expansion.truckCounter), so the trucks no longer need the player or the log hauler. No levels
 * (like the other belts).
 *
 * Path (BELT_PATH): starts just north of the drop-zone slab (x = -4.2, the slab's NE corner, clear of the harvester
 * pad, the east belt and the pads), runs straight north along x = -4.2 and turns east along z = -19.3 to end beside
 * the truck counter's west end. It crosses no pad, no collider and none of the NPC routes (log hauler, cashier), it
 * stays clear of the counter's player zone, and the fence line (z = -20) is 0.7 m away. Checked by
 * tests/ridgeMachines.test.ts.
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - build(instant): visible + running; instant (restore) = final state, no animation / 'built' event / sound.
 *   (The 'built' event is the conveyor's own: 'conveyor:truck', emitted when its segments have popped in.)
 * - load: logs riding the belt right now (the save puts them back on the drop zone).
 * - Takes only from `from` (drop-zone pile) when `to` (truck counter input) can accept; moves items only via
 *   items/transfer.ts. The belt never carries more logs than the counter has room for, so nothing queues up on it
 *   and the drop zone is not hoarded.
 */
import * as THREE from 'three';
import type { XZ } from '../config';
import { createLoaderExtras } from '../assets/ridgeMachines';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { Ease } from '../core/Tween';
import type { Pile } from '../items/Pile';
import { Conveyor } from './Conveyor';

export interface TruckLoaderOptions {
  from: ItemHolder;
  to: ItemHolder;
}

/** Waypoints of the loader belt (world XZ). */
export const TRUCK_BELT_PATH: readonly XZ[] = [
  { x: -4.2, z: -2.35 },
  { x: -4.2, z: -19.3 },
  { x: -0.35, z: -19.3 },
];
const BELT = { width: 0.8, beltY: 0.5, speed: 3.6, spacing: 0.7 } as const;

/** The drop zone as the belt sees it: empty while the counter has no room for one more log. */
class GatedSource implements ItemHolder {
  readonly id: string;
  constructor(
    private readonly src: ItemHolder,
    private readonly open: () => boolean,
  ) {
    this.id = src.id;
  }
  canAccept(kind: ItemKind): boolean {
    return this.src.canAccept(kind);
  }
  reserve(item: Item): Slot {
    return this.src.reserve(item);
  }
  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return this.src.getSlotWorldPosition(slot, out);
  }
  getSlotWorldQuaternion(slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return this.src.getSlotWorldQuaternion(slot, out);
  }
  receive(item: Item, slot: Slot): void {
    this.src.receive(item, slot);
  }
  cancel(slot: Slot): void {
    this.src.cancel(slot);
  }
  count(kind?: ItemKind): number {
    return this.open() ? this.src.count(kind) : 0;
  }
  take(kind?: ItemKind): Item | null {
    return this.open() ? this.src.take(kind) : null;
  }
}

export class TruckLoader {
  readonly belt: Conveyor;
  private readonly extras: THREE.Group;
  private running = false;

  constructor(
    readonly ctx: GameContext,
    readonly opts: TruckLoaderOptions,
  ) {
    const to = opts.to;
    const pile = (to as Partial<Pile>).capacity !== undefined ? (to as Pile) : null;
    const gate = (): boolean => {
      if (!to.canAccept('log')) return false;
      // keep every log on the belt matched by a free slot at the counter
      return !pile || pile.room - pile.total > this.belt.load;
    };
    this.belt = new Conveyor(ctx, {
      id: 'conveyor:truck',
      path: TRUCK_BELT_PATH,
      ...BELT,
      from: new GatedSource(opts.from, gate),
      to,
      kind: 'log',
      itemYaw: 0,
    });
    const p0 = TRUCK_BELT_PATH[0]!;
    const p1 = TRUCK_BELT_PATH[1]!;
    const pe = TRUCK_BELT_PATH[TRUCK_BELT_PATH.length - 1]!;
    const pf = TRUCK_BELT_PATH[TRUCK_BELT_PATH.length - 2]!;
    const dir = (a: XZ, b: XZ): XZ => {
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
    };
    this.extras = createLoaderExtras(p0, dir(p0, p1), pe, dir(pf, pe), BELT.width).root;
    this.extras.visible = false;
    ctx.scene.add(this.extras);
  }

  /** Logs riding the belt (or hopping onto it) right now. */
  get load(): number {
    return this.belt.load;
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  build(instant = false): void {
    if (this.running) return;
    this.running = true;
    this.belt.build(instant);
    this.extras.visible = true;
    if (instant) return;
    // the group sits at the world origin: grow it upward from the ground only
    this.extras.scale.y = 0.001;
    this.ctx.tweens.run({
      duration: 0.4,
      delay: 0.15,
      ease: Ease.backOut,
      onUpdate: (k) => (this.extras.scale.y = Math.max(0.001, k)),
      onComplete: () => (this.extras.scale.y = 1),
    });
  }

  update(dt: number): void {
    if (!this.running) return;
    this.belt.update(dt);
  }
}
