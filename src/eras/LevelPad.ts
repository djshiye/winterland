/**
 * [eras] 0.9.5: the LEVEL pad of an era machine type (Dino: "era 1 was done right"): the same floor tile, ring, sign,
 * bundle arcs, tick ladder and bounce as Survival's machine level pads (stations/UpgradePad.ts, level mode), beside
 * the first built machine of its type in the region (0.9.5: also the era cash machine's pad, eras/CashMachine.ts). Standing on it pays the next level of that type's upgrade
 * (UPGRADES[machineId], group 'machine'): "<LABEL> LV n" where n is the level the purchase reaches, so the last pad
 * reads LV 10. Fully paid → ctx.upgrades.levelUp(id, position) ('upgrade:bought': sparkles + "LV n!"), a bounce, then
 * the pad re-arms for the next level or pops out at the top level.
 *
 * Payment works exactly like UpgradePad: one bundle ≈ cost / TIMING.padFlights per flight after TIMING.padHoldDelay of
 * standing still (walking across pays nothing), a short rest after each level so a held stand never chain-buys.
 * Progress lives in state.padPaid['pad:<machineId>'] (one pad per type, so it is never shared), restored on load; if
 * the machine carrying the pad is demolished, the next one of its type gets the pad with the same progress.
 */
import * as THREE from 'three';
import { PALETTE, TIMING, rect } from '../config';
import { createPadModel, createPadSign, createPadTexture, formatCost, setPadSignLabel } from '../assets/pads';
import { PadRing, playPadCelebrate } from '../fx/PadRing';
import { PAD_CASH_FLIGHT, motionScale } from '../fx/padJuice';
import type { GameContext, Item, ItemHolder, ItemKind, Slot, UpgradeId } from '../core/types';
import type { Zone } from '../items/Zones';
import type { XZ } from './layout';

interface PadSlot extends Slot {
  value: number;
  live: boolean;
}

const SIGN_HEIGHT = 1.9;
/** The tile is drawn rotated 45° (upright on screen), so its corners reach past the size: widen the pay zone a bit. */
const ZONE_SCALE = 1.15;
/** After a level is bought the zone rests this long, so the next level needs a fresh hold (no accidental chain buys). */
const LEVEL_COOLDOWN = 0.9;
const SIGN_SCALE = 0.85;

export class EraLevelPad implements ItemHolder {
  readonly id: string;
  readonly object = new THREE.Group();
  readonly zone: Zone;
  readonly texture: THREE.CanvasTexture;
  remaining = 0;

  private total = 0;
  private pending = 0;
  private shown = false;
  private armedLevel = -1;
  private cooldownToken = 0;
  private dead = false;
  /** The first appearance is silent (a restored game, or the pad moving to another machine of its type). */
  private quiet: boolean;
  private readonly pulse = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sign: THREE.Mesh;
  private readonly ring: PadRing;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    readonly upgradeId: UpgradeId,
    readonly at: XZ,
    readonly size: number,
    private readonly label: string,
    parent: THREE.Object3D,
    instant: boolean,
  ) {
    this.quiet = instant;
    this.id = `pad:${upgradeId}`;
    this.texture = createPadTexture('factory', formatCost(0), 0);
    this.model = createPadModel(size, this.texture);
    this.ring = new PadRing(size, size);
    this.model.add(this.ring.mesh);
    this.pulse.add(this.model);
    this.object.add(this.pulse);
    this.sign = createPadSign(label, true);
    this.sign.scale.setScalar(SIGN_SCALE);
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
    this.object.position.set(at.x, 0, at.z);
    this.object.visible = false;
    this.object.name = this.id;
    parent.add(this.object);
    ctx.occlusion?.addTarget(this.object, size, () => this.shown);
    this.zone = ctx.zones.addTransfer({
      id: `${this.id}:pay`,
      area: rect(at.x, at.z, size * ZONE_SCALE, size * ZONE_SCALE),
      from: ctx.player.back,
      to: this,
      kind: 'pay',
      interval: TIMING.payInterval,
      delay: TIMING.padHoldDelay,
      enabled: false,
      cashAmount: () => this.chunk(),
      flight: PAD_CASH_FLIGHT,
    });
  }

  /** On the floor and taking cash. */
  get visible(): boolean {
    return this.shown;
  }

  /** The level the next purchase reaches ("LV n"): the first pad offers LV 1, the last LV 10. */
  get offeredLevel(): number {
    return this.ctx.upgrades.shownLevel(this.upgradeId) + 1;
  }

  /** Cost of the current level. */
  get cost(): number {
    return this.total;
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** Follow the upgrade: show while a level is for sale, re-arm when the level changed (debug, another pad, a load). */
  update(dt: number): void {
    if (this.dead) return;
    const up = this.ctx.upgrades;
    const forSale = !up.isMax(this.upgradeId) && up.requirement(this.upgradeId) === null;
    if (!this.shown) {
      if (forSale) {
        this.arm();
        this.appear(this.quiet);
      }
      this.quiet = false;
      return;
    }
    if (!forSale) {
      this.hide(true);
      return;
    }
    if (up.level(this.upgradeId) !== this.armedLevel) {
      this.ctx.state.padPaid[this.id] = 0;
      this.arm();
    }
    const t = this.ctx.time.elapsed;
    const eager = this.remaining > 0 && this.ctx.economy.money >= this.remaining;
    const amp = (eager ? 0.045 : 0.018) * motionScale();
    const s = 1 + amp * Math.sin(t * (eager ? 5.5 : 3) + this.at.x);
    this.pulse.scale.set(s, 1 + (s - 1) * 0.5, s);
    this.ring.update(dt, t, eager);
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    this.sign.position.y = SIGN_HEIGHT + Math.sin(t * 2.2 + this.at.z) * 0.06;
  }

  /** Remove for good (the machine went away): what was paid stays in state.padPaid for the next pad of this type. */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.shown = false;
    this.ctx.zones.remove(this.zone);
    this.ctx.occlusion?.removeTarget(this.object);
    this.ctx.tweens.killTweensOf(this.object);
    this.ctx.tweens.killTweensOf(this.model);
    this.object.removeFromParent();
    this.texture.dispose();
    const mat = this.sign.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    return kind === 'cash' && this.shown && !this.dead && this.remaining - this.pending > 0;
  }
  reserve(item: Item): Slot {
    this.pending += item.value;
    const slot: PadSlot = { holder: this, value: item.value, live: true };
    this.writePaid();
    return slot;
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.at.x, 0.3, this.at.z);
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }
  receive(item: Item, slot: Slot): void {
    const s = slot as PadSlot;
    if (s.live) {
      s.live = false;
      this.pending = Math.max(0, this.pending - s.value);
    }
    this.ctx.items.release(item);
    if (!this.shown || this.dead) {
      // landed after the pad went away: the money is not lost, it stays paid toward this level
      if (this.dead) this.ctx.state.padPaid[this.id] = (this.ctx.state.padPaid[this.id] ?? 0) + s.value;
      return;
    }
    this.remaining = Math.max(0, this.remaining - s.value);
    this.writePaid();
    this.redraw();
    if (this.remaining > 0) this.ctx.tweens.squash(this.model, 0.07 * motionScale(), 0.24);
    this.ring.flash();
    this.ctx.events.emit('pad:paid', { id: this.upgradeId, remaining: this.remaining, cost: this.total, position: this.tmp.copy(this.object.position) });
    if (this.remaining <= 0) this.completeLevel();
  }
  cancel(slot: Slot): void {
    const s = slot as PadSlot;
    if (!s.live) return;
    s.live = false;
    this.pending = Math.max(0, this.pending - s.value);
    this.writePaid();
  }
  count(_kind?: ItemKind): number {
    return 0;
  }
  take(_kind?: ItemKind): Item | null {
    return null;
  }

  // --- internals ------------------------------------------------------------
  private chunk(): number {
    const left = this.remaining - this.pending;
    if (left <= 0) return 0;
    const c = Math.max(5, Math.ceil(this.total / TIMING.padFlights / 5) * 5);
    return Math.min(c, left);
  }

  /** Price the next level and restore partial progress from state.padPaid. */
  private arm(): void {
    const up = this.ctx.upgrades;
    this.pending = 0;
    this.armedLevel = up.level(this.upgradeId);
    this.total = up.nextCost(this.upgradeId) ?? 0;
    const paid = Math.min(this.total, this.ctx.state.padPaid[this.id] ?? 0);
    this.remaining = Math.max(0, this.total - paid);
    setPadSignLabel(this.sign, `${this.label} LV ${this.offeredLevel}`);
    this.redraw();
    this.ring.snap(this.total > 0 ? paid / this.total : 0);
  }

  private writePaid(): void {
    this.ctx.state.padPaid[this.id] = Math.max(0, this.total - this.remaining + this.pending);
  }

  private redraw(): void {
    const ratio = this.total > 0 ? 1 - this.remaining / this.total : 1;
    createPadTexture('factory', formatCost(this.remaining), ratio, this.texture, `LV ${this.offeredLevel}`);
    this.ring.setProgress(ratio);
  }

  /** instant: a restored game or a machine that was already standing (no pop, no sound). */
  private appear(instant: boolean): void {
    this.shown = true;
    this.zone.setEnabled(true);
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    this.object.scale.setScalar(1);
    this.object.visible = true;
    if (instant) return;
    tw.popIn(this.object, { duration: 0.55 });
    this.ctx.particles.ring(this.object.position, { color: PALETTE.accent, radius: 2.0, life: 0.6 });
    this.ctx.audio.play('whoosh', { volume: 0.4 });
  }

  private hide(animate: boolean): void {
    this.shown = false;
    this.pending = 0;
    this.zone.setEnabled(false);
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    if (!animate || !this.object.visible) {
      this.object.visible = false;
      this.object.scale.setScalar(1);
      return;
    }
    playPadCelebrate(tw, this.object, 1.28, {
      bounce: 0.4,
      popOut: 0.26,
      onDone: () => {
        if (this.shown) return;
        this.object.visible = false;
        this.object.scale.setScalar(1);
      },
    });
  }

  /** Level paid: gain it, re-arm for the next one (or pop out at the top). */
  private completeLevel(): void {
    this.remaining = 0;
    this.pending = 0;
    this.ctx.state.padPaid[this.id] = 0;
    this.zone.setEnabled(false);
    const up = this.ctx.upgrades;
    up.levelUp(this.upgradeId, this.object.position.clone());
    this.ctx.events.emit('pad:complete', { id: this.id, kind: 'level', position: this.object.position.clone() });
    if (up.isMax(this.upgradeId)) {
      this.hide(true);
      return;
    }
    this.arm();
    this.ctx.tweens.killTweensOf(this.model);
    this.model.scale.setScalar(1);
    playPadCelebrate(this.ctx.tweens, this.object, 1.2, { bounce: 0.4 });
    const token = ++this.cooldownToken;
    this.ctx.tweens.delay(LEVEL_COOLDOWN, () => {
      if (token === this.cooldownToken && this.shown && !this.dead) this.zone.setEnabled(true);
    });
  }
}
