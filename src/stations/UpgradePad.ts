/**
 * [B7 — progression] Floor upgrade pad (cash sink). STUB (functional baseline without visuals):
 * replace/extend, keep the public API.
 *
 * Spec: "Upgrade Pad Mechanic: Rectangular floor tiles displaying an icon and remaining cash cost. When
 * the player stands on a pad while carrying Cash, cash bundles fly from the player's stack into the pad,
 * counting down the cost to 0 and triggering the unlock with a scale-bounce animation."
 *
 * Art spec — the tile face is AssetFactory createPadTexture(iconType, costText, progressRatio) in
 * assets/pads.ts (yours): 256×256 offscreen canvas; dark grey #4A4A4A rounded rect with a white border
 * (lineWidth 10); a green #2ECC71 fill rising bottom-to-top with progressRatio (paid fraction); a white
 * silhouette icon in the upper half (chainsaw/claw for the harvester, factory box for the processor,
 * conveyor arrows for belts, giant blade for the mega saw — def.icon); a green bill icon bottom-left +
 * bold 56px white text with the remaining amount. RE-RENDER whenever the cost decrements (redraw the
 * same canvas, texture.needsUpdate = true — don't allocate a new texture per bundle).
 *
 * - Model: slightly raised tile (def.size²) carrying that texture on top; the label (def.label) on a
 *   small floating sign/billboard is nice. Idle: soft pulse; while being paid: each bundle landing
 *   punches the tile (ctx.tweens.punchScale small).
 * - ItemHolder (id 'pad:<id>'): accepts 'cash' while visible, not unlocked and remaining − pending > 0.
 *   reserve() adds item.value to pending; receive() subtracts it from remaining, releases the bundle to
 *   the pool, emits 'pad:paid'; at 0 → unlock: big scale-bounce, then pop out; mark unlocked and emit
 *   'pad:unlocked' { id, position } (Level listens to that and builds the station).
 * - zone: player.back → pad transfer zone over the tile (TIMING.payInterval), enabled only while shown.
 * - show(): pop in with a bounce + ring, enable the zone, set ctx.state.padsVisible[id], emit 'pad:shown'.
 * - forceUnlock(): debug — unlock immediately (same path as being fully paid).
 */
import * as THREE from 'three';
import { TIMING, rect, type PadDef } from '../config';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import type { Zone } from '../items/Zones';

interface PadSlot extends Slot {
  value: number;
}

export class UpgradePad implements ItemHolder {
  readonly id: string;
  readonly object = new THREE.Group();
  readonly zone: Zone;
  remaining: number;
  private pending = 0;
  private shown = false;
  private done = false;

  constructor(
    readonly ctx: GameContext,
    readonly def: PadDef,
  ) {
    this.id = `pad:${def.id}`;
    this.remaining = def.cost;
    this.object.position.set(def.x, 0, def.z);
    this.object.visible = false;
    ctx.scene.add(this.object);
    this.zone = ctx.zones.addTransfer({
      id: `${this.id}:pay`,
      area: rect(def.x, def.z, def.size, def.size),
      from: ctx.player.back,
      to: this,
      kinds: ['cash'],
      interval: TIMING.payInterval,
      enabled: false,
    });
  }

  get visible(): boolean {
    return this.shown && !this.done;
  }

  get unlocked(): boolean {
    return this.done;
  }

  /** World centre of the pad. */
  get position(): THREE.Vector3 {
    return this.object.position;
  }

  show(): void {
    if (this.shown || this.done) return;
    this.shown = true;
    this.object.visible = true;
    this.zone.setEnabled(true);
    this.ctx.state.padsVisible[this.def.id] = true;
    this.ctx.events.emit('pad:shown', { id: this.def.id, position: this.object.position.clone() });
  }

  forceUnlock(): void {
    if (this.done) return;
    this.remaining = 0;
    this.unlock();
  }

  update(_dt: number): void {}

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    return kind === 'cash' && this.visible && this.remaining - this.pending > 0;
  }
  reserve(item: Item): Slot {
    this.pending += item.value;
    const slot: PadSlot = { holder: this, value: item.value };
    return slot;
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.def.x, 0.3, this.def.z);
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }
  receive(item: Item, slot: Slot): void {
    const v = (slot as PadSlot).value;
    this.pending = Math.max(0, this.pending - v);
    this.ctx.items.release(item);
    if (this.done) return;
    this.remaining = Math.max(0, this.remaining - v);
    this.ctx.events.emit('pad:paid', {
      id: this.def.id,
      remaining: this.remaining,
      cost: this.def.cost,
      position: this.object.position,
    });
    if (this.remaining <= 0) this.unlock();
  }
  cancel(slot: Slot): void {
    this.pending = Math.max(0, this.pending - (slot as PadSlot).value);
  }
  count(_kind?: ItemKind): number {
    return 0;
  }
  take(_kind?: ItemKind): Item | null {
    return null;
  }

  private unlock(): void {
    this.done = true;
    this.zone.setEnabled(false);
    this.object.visible = false;
    this.ctx.state.padsVisible[this.def.id] = false;
    this.ctx.events.emit('pad:unlocked', { id: this.def.id, position: this.object.position.clone() });
  }
}
