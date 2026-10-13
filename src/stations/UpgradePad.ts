/**
 * [B7 — progression] Floor upgrade pad (cash sink).
 *
 * Spec: "Upgrade Pad Mechanic: Rectangular floor tiles displaying an icon and remaining cash cost. When
 * the player stands on a pad while carrying Cash, cash bundles fly from the player's stack into the pad,
 * counting down the cost to 0 and triggering the unlock with a scale-bounce animation."
 *
 * - Visuals (assets/pads.ts): a chunky rounded tile whose top face is the canvas texture
 *   createPadTexture(icon, "$remaining", paidFraction). ONE texture per pad; every landed bundle redraws the
 *   same canvas. A floating label sign hovers above the tile and always faces the camera.
 * - Idle: soft pulse (stronger while the player can afford the rest); each landing bundle punches the tile.
 * - ItemHolder (id 'pad:<id>'): accepts 'cash' while visible, not unlocked and remaining − pending > 0.
 *   reserve() adds item.value to pending; receive() subtracts it from remaining, releases the bundle to the
 *   pool and emits 'pad:paid'. At 0 → unlock(): mark unlocked and emit 'pad:unlocked' SYNCHRONOUSLY (Level
 *   builds the station from that event), then a purely visual big scale-bounce and pop-out.
 * - zone: player.back → pad transfer zone over the tile (TIMING.payInterval), enabled only while shown.
 * - show(): pop in with a bounce + ground ring, enable the zone, set ctx.state.padsVisible[id], emit
 *   'pad:shown'.
 * - forceUnlock(): debug — unlock immediately (same path as being fully paid).
 */
import * as THREE from 'three';
import { PALETTE, TIMING, rect, type PadDef } from '../config';
import { Ease } from '../core/Tween';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import type { Zone } from '../items/Zones';
import { createPadModel, createPadSign, createPadTexture } from '../assets/pads';

interface PadSlot extends Slot {
  value: number;
}

const SIGN_HEIGHT = 2.1;
/** The tile is drawn rotated 45° (upright on screen), so its corners reach past def.size: widen the pay zone. */
const ZONE_SCALE = 1.2;
const BOUNCE_TIME = 0.42;
const POP_OUT_TIME = 0.26;

export class UpgradePad implements ItemHolder {
  readonly id: string;
  /** Root at the pad's floor centre (popped in / out). */
  readonly object = new THREE.Group();
  readonly zone: Zone;
  /** The tile's canvas texture (redrawn in place). */
  readonly texture: THREE.CanvasTexture;
  remaining: number;

  private pending = 0;
  private shown = false;
  private done = false;
  /** Idle pulse target (scaled every frame); the punch tween runs on `model`, never on this. */
  private readonly pulse = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sign: THREE.Mesh;
  private readonly tmpPos = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly def: PadDef,
  ) {
    this.id = `pad:${def.id}`;
    this.remaining = def.cost;
    this.texture = createPadTexture(def.icon, `$${def.cost}`, 0);
    this.model = createPadModel(def.size, this.texture);
    this.pulse.add(this.model);
    this.object.add(this.pulse);
    this.sign = createPadSign(def.label);
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
    this.object.position.set(def.x, 0, def.z);
    this.object.visible = false;
    ctx.scene.add(this.object);
    this.zone = ctx.zones.addTransfer({
      id: `${this.id}:pay`,
      area: rect(def.x, def.z, def.size * ZONE_SCALE, def.size * ZONE_SCALE),
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
    this.zone.setEnabled(true);
    this.ctx.state.padsVisible[this.def.id] = true;
    this.ctx.tweens.killTweensOf(this.object);
    this.ctx.tweens.popIn(this.object, { duration: 0.55 });
    this.ctx.particles.ring(this.object.position, { color: PALETTE.padFill, radius: 2.6, life: 0.6 });
    this.ctx.audio.play('whoosh', { volume: 0.5 });
    this.ctx.events.emit('pad:shown', { id: this.def.id, position: this.object.position.clone() });
  }

  forceUnlock(): void {
    if (this.done) return;
    this.remaining = 0;
    this.unlock();
  }

  update(_dt: number): void {
    if (!this.visible) return;
    const t = this.ctx.time.elapsed;
    const eager = this.remaining > 0 && this.ctx.economy.money >= this.remaining;
    const amp = eager ? 0.045 : 0.018;
    const s = 1 + amp * Math.sin(t * (eager ? 5.5 : 3));
    this.pulse.scale.set(s, 1 + (s - 1) * 0.5, s);
    // billboard the sign (plane faces +Z locally) and bob it a little
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    this.sign.position.y = SIGN_HEIGHT + Math.sin(t * 2.2 + this.def.x) * 0.06;
  }

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
    this.redraw();
    if (this.remaining > 0) this.ctx.tweens.punchScale(this.model, 0.07, 0.14);
    this.tmpPos.copy(this.object.position);
    this.ctx.events.emit('pad:paid', {
      id: this.def.id,
      remaining: this.remaining,
      cost: this.def.cost,
      position: this.tmpPos,
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

  // --- internals ------------------------------------------------------------
  private redraw(): void {
    const ratio = this.def.cost > 0 ? 1 - this.remaining / this.def.cost : 1;
    createPadTexture(this.def.icon, `$${Math.max(0, Math.round(this.remaining))}`, ratio, this.texture);
  }

  private unlock(): void {
    const wasVisible = this.visible;
    this.done = true;
    this.remaining = 0;
    this.pending = 0;
    this.redraw();
    this.zone.setEnabled(false);
    this.ctx.state.padsVisible[this.def.id] = false;
    // Logic first: Level builds the station from this event.
    this.ctx.events.emit('pad:unlocked', { id: this.def.id, position: this.object.position.clone() });
    if (wasVisible) this.playUnlockVisual();
    else this.object.visible = false;
  }

  /** Big scale-bounce (1 → 1.4 → 1), then pop out to nothing. Pure visuals. */
  private playUnlockVisual(): void {
    const o = this.object;
    const tw = this.ctx.tweens;
    tw.killTweensOf(o);
    tw.killTweensOf(this.model);
    this.model.scale.setScalar(1);
    this.pulse.scale.setScalar(1);
    tw.run({
      duration: BOUNCE_TIME + POP_OUT_TIME,
      onUpdate: (k) => {
        const t = k * (BOUNCE_TIME + POP_OUT_TIME);
        let s: number;
        if (t < BOUNCE_TIME) {
          const u = t / BOUNCE_TIME;
          s = 1 + 0.45 * Math.sin(u * Math.PI) * (1 - 0.2 * u);
        } else {
          const u = (t - BOUNCE_TIME) / POP_OUT_TIME;
          s = Math.max(0.0001, 1 - Ease.quadIn(u));
        }
        o.scale.set(s, s * (t < BOUNCE_TIME ? 1 : 1 + 0.3 * (1 - s)), s);
      },
      onComplete: () => {
        o.visible = false;
        o.scale.setScalar(1);
      },
    });
  }
}
