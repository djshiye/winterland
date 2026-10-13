/**
 * [B5 — commerce] Wooden sales counter with an item pile on top. Functional baseline (plain box
 * visual): replace/extend, keep the public API.
 *
 * - Model: AssetFactory counter table (art spec: wooden table 1.6 × 0.6 × 0.8 in FENCE_WOOD; sizes come
 *   from opts). Long axis along local X. Root at floor centre, rotated by opts.rotationY. Casts/receives
 *   shadows. Collider = footprint (account for rotation). Buyers stand on the far side from the player
 *   zone; the player zone rect and the NPC queue positions come from config.
 * - pile: Pile on the top surface (parent = this.object, so rotation applies and appear() scales it).
 *   Holds `display` items; NPCs buy from here.
 * - input: where deliveries go (player zone AND conveyors). It accepts `accepts` items. When `display`
 *   differs from `accepts` (walk-in counter: logs in, plank bundles out), every arriving item is
 *   CONVERTED ON LANDING: the flying log is released to the pool and a new `display` item pops into the
 *   very slot that was reserved for it (pile capacity stays honest the whole time). Without conversion
 *   `input === pile`.
 * - zone: player.arms → input transfer zone (kinds [accepts], TIMING.dropInterval, marker).
 * - appear(): scale-bounce in (ctx.tweens.popIn) + emit 'built' { what: opts.id, position, object }.
 *   Counters created at level start call nothing (they are simply there).
 */
import * as THREE from 'three';
import { COLORS, TIMING, rect, type PileGrid, type Rect } from '../config';
import { createCounterModel } from '../assets/shop';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { Pile } from '../items/Pile';
import type { Zone } from '../items/Zones';

export interface CounterOptions {
  /** Holder id of the top pile, e.g. 'counter:walkIn'. */
  id: string;
  x: number;
  z: number;
  length: number;
  depth: number;
  height: number;
  rotationY: number;
  /** Kind delivered by the player / conveyors. */
  accepts: ItemKind;
  /** Kind shown on the counter and bought by NPCs (default: `accepts`). */
  display?: ItemKind;
  grid: PileGrid;
  playerZone: Rect;
}

export class Counter {
  readonly object = new THREE.Group();
  /** The items on the table (kind = display). NPCs take from here. */
  readonly pile: Pile;
  /** Delivery target for the player zone and conveyors (kind = accepts). */
  readonly input: ItemHolder;
  readonly zone: Zone;
  /** What NPCs buy here. */
  readonly displayKind: ItemKind;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CounterOptions,
  ) {
    this.displayKind = opts.display ?? opts.accepts;
    this.object.position.set(opts.x, 0, opts.z);
    this.object.rotation.y = opts.rotationY;
    this.object.add(createCounterModel(opts.length, opts.depth, opts.height));
    ctx.scene.add(this.object);
    const alongZ = Math.abs(Math.sin(opts.rotationY)) > 0.5;
    ctx.colliders.addBox(
      rect(opts.x, opts.z, alongZ ? opts.depth : opts.length, alongZ ? opts.length : opts.depth),
      opts.id,
    );
    this.pile = new Pile(ctx, {
      id: opts.id,
      accepts: [this.displayKind],
      position: new THREE.Vector3(0, opts.height, 0),
      parent: this.object,
      grid: opts.grid,
    });
    this.input =
      this.displayKind === opts.accepts
        ? this.pile
        : new ConvertingInput(ctx, `${opts.id}:input`, this.pile, opts.accepts, this.displayKind);
    this.zone = ctx.zones.addTransfer({
      id: `${opts.id}:drop`,
      area: opts.playerZone,
      from: ctx.player.arms,
      to: this.input,
      kinds: [opts.accepts],
      interval: TIMING.dropInterval,
      marker: true,
    });
  }

  /** World position on top of the counter (for guide arrows / effects). */
  topWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.pile.topWorldPosition(out);
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  appear(instant = false): void {
    this.object.visible = true;
    if (instant) return;
    this.ctx.tweens.popIn(this.object);
    const position = this.object.getWorldPosition(new THREE.Vector3());
    this.ctx.events.emit('built', { what: this.opts.id, position, object: this.object });
  }
}

const tmpPos = new THREE.Vector3();
const CHIP_COLORS = [COLORS.LOG_CORE];

interface ConvertSlot extends Slot {
  readonly inner: Slot;
  readonly product: Item;
}

/**
 * Delivery holder that converts on landing: reserves a pile slot for a hidden `to` item, and when the
 * `from` item lands, releases it and drops the product into that slot.
 */
class ConvertingInput implements ItemHolder {
  constructor(
    readonly ctx: GameContext,
    readonly id: string,
    readonly pile: Pile,
    readonly from: ItemKind,
    readonly to: ItemKind,
  ) {}

  canAccept(kind: ItemKind): boolean {
    return kind === this.from && this.pile.canAccept(this.to);
  }

  reserve(_item: Item): Slot {
    const product = this.ctx.items.create(this.to);
    product.object.visible = false;
    const inner = this.pile.reserve(product);
    const slot: ConvertSlot = { holder: this, inner, product };
    return slot;
  }

  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return this.pile.getSlotWorldPosition((slot as ConvertSlot).inner, out);
  }

  getSlotWorldQuaternion(slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return this.pile.getSlotWorldQuaternion((slot as ConvertSlot).inner, out);
  }

  receive(item: Item, slot: Slot): void {
    const s = slot as ConvertSlot;
    // Where the product will rest: the juice (chip puff) happens right there.
    this.pile.getSlotWorldPosition(s.inner, tmpPos);
    this.ctx.items.release(item);
    s.product.object.visible = true;
    this.pile.receive(s.product, s.inner);
    // The pile's own landing punch is small; make the conversion read as a little "pop".
    this.ctx.tweens.punchScale(s.product.object, 0.42, 0.26);
    this.ctx.particles.burst(tmpPos, {
      colors: CHIP_COLORS,
      count: 7,
      size: 0.1,
      speed: 2.6,
      life: 0.45,
      spread: 1.2,
      shape: 'chip',
    });
  }

  cancel(slot: Slot): void {
    const s = slot as ConvertSlot;
    this.pile.cancel(s.inner);
    this.ctx.items.release(s.product);
  }

  /** The input never holds anything itself. */
  count(_kind?: ItemKind): number {
    return 0;
  }

  take(_kind?: ItemKind): Item | null {
    return null;
  }

  /** Lets transfer zones place the 'stack:full' hint on the counter top. */
  topWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.pile.topWorldPosition(out);
  }
}
