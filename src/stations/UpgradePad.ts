/**
 * [B7 — progression] Floor upgrade pad (cash sink): unlocks a machine, then (machines with upgrade levels) comes
 * back at the same spot as a LEVEL pad.
 *
 * Spec: "Upgrade Pad Mechanic: Rectangular floor tiles displaying an icon and remaining cash cost. When
 * the player stands on a pad while carrying Cash, cash bundles fly from the player's stack into the pad,
 * counting down the cost to 0 and triggering the unlock with a scale-bounce animation."
 *
 * Modes
 * - 'unlock': target = def.cost. Fully paid → state.unlocked (Level builds the station from the synchronous
 *   'pad:unlocked' event), big scale-bounce, pop out.
 * - 'level' (UPGRADES[id].group === 'machine': harvester / processor / megaSaw): after the unlock and once
 *   Progression reveals it (flag `reveal:levelPad:<id>`, showLevel()), the pad reappears as "<LABEL> LV n" (gold
 *   border + "LV n" badge, n = the shown level it buys: the first level pad offers LV 1) priced ctx.upgrades.nextCost(id).
 *   Fully paid → ctx.upgrades.levelUp(id, position) ('upgrade:bought'), a smaller bounce, then re-armed for the
 *   next level, or hidden at max level. Conveyor pads hide after the unlock. Once the climb opens (Great Lodge,
 *   eras/gate.ts) the max moves to the era cap (shown 10 · age) and a hidden maxed level pad comes back on its own;
 *   at the cap it hides again until the next era's expansion is bought.
 *
 * Payment
 * - Chunked: the zone moves ONE bundle worth ≈ cost / TIMING.padFlights (a multiple of 5, ≥ 5, ≤ remaining − pending)
 *   per flight, after TIMING.padHoldDelay of standing on the tile (walking across pays nothing).
 * - ItemHolder id 'pad:<id>': accepts 'cash' while shown and remaining − pending > 0.
 *
 * Juice (fx/PadRing.ts, fx/padJuice.ts): a soft fill ring around the tile eases toward the paid ratio and flashes as
 * each bundle lands (the bundles arc in with a gentle squash, the tile squashes a little), an affordable pad breathes a
 * warm glow, completion plays a squash-and-stretch hump and emits 'pad:complete' (the JuiceDirector's sparkle pop,
 * chime and haptics). Every bounce is scaled down under reduced motion. Visual only: drain rate and costs unchanged.
 * 0.9.8 (brief 13): the price hangs on a tag under the sign (assets/pads.ts hangPriceTag), and PadFeel breathes the
 * tile slowly while affordable, dims it while nothing can be paid and gives a felt thump when the player steps on.
 *
 * State is the truth (restore): the constructor reads state.padsVisible / unlocked / padPaid['pad:<id>'] and the
 * level-pad reveal flag and appears at once, silently. Live play writes padPaid on every reserve / receive (value
 * in flight included); it is reset to 0 when a target completes.
 */
import * as THREE from 'three';
import { PALETTE, TIMING, UPGRADES, rect, type PadDef } from '../config';
import { Ease } from '../core/Tween';
import { climbOpen } from '../eras/gate';
import type { GameContext, Item, ItemHolder, ItemKind, Slot, UpgradeId } from '../core/types';
import type { Zone } from '../items/Zones';
import { createPadModel, createPadSign, createPadTexture, formatCost, hangPriceTag, setPadSignLabel } from '../assets/pads';
import { PadFeel, PadRing, playPadCelebrate } from '../fx/PadRing';
import { PAD_CASH_FLIGHT, motionScale } from '../fx/padJuice';

interface PadSlot extends Slot {
  value: number;
  live: boolean;
}

type Mode = 'unlock' | 'level';

const SIGN_HEIGHT = 2.1;
const BOUNCE_TIME = 0.42;
const POP_OUT_TIME = 0.26;
/** The tile is drawn rotated 45° (upright on screen), so its corners reach past def.size: widen the pay zone. */
const ZONE_SCALE = 1.2;
/** After a level is bought the zone rests this long, so the next level needs a fresh hold (no accidental chain buys). */
const LEVEL_COOLDOWN = 0.9;

export class UpgradePad implements ItemHolder {
  readonly id: string;
  /** Root at the pad's floor centre (popped in / out). */
  readonly object = new THREE.Group();
  readonly zone: Zone;
  /** The tile's canvas texture (redrawn in place). */
  readonly texture: THREE.CanvasTexture;
  /** Dollars still to pay for the CURRENT target (unlock cost, then each level cost). */
  remaining: number;

  private mode: Mode = 'unlock';
  /** Cost of the current target. */
  private total: number;
  private pending = 0;
  private shown = false;
  private done = false;
  private armedLevel = 0;
  private cooldownToken = 0;
  private readonly upgradeId: UpgradeId | null;
  /** Idle pulse target (scaled every frame); the punch tween runs on `model`, never on this. */
  private readonly pulse = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sign: THREE.Mesh;
  private readonly ring: PadRing;
  private readonly feel: PadFeel;
  private readonly tmpPos = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly def: PadDef,
  ) {
    this.id = `pad:${def.id}`;
    // Conveyor pads have no upgrade entry: they hide after the unlock.
    const upgrade = (UPGRADES as Partial<Record<string, { group: string }>>)[def.id];
    this.upgradeId = upgrade?.group === 'machine' ? (def.id as UpgradeId) : null;
    this.total = def.cost;
    this.remaining = def.cost;
    this.texture = createPadTexture(def.icon, formatCost(def.cost), 0);
    this.model = createPadModel(def.size, this.texture);
    this.ring = new PadRing(def.size, def.size);
    this.model.add(this.ring.mesh);
    this.pulse.add(this.model);
    this.object.add(this.pulse);
    this.sign = createPadSign(def.label);
    hangPriceTag(this.sign, this.texture);
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
    this.feel = new PadFeel(ctx, this.model, def.x);
    this.object.position.set(def.x, 0, def.z);
    this.object.visible = false;
    ctx.scene.add(this.object);
    ctx.occlusion?.addTarget(this.object, def.size, () => this.shown);
    this.zone = ctx.zones.addTransfer({
      id: `${this.id}:pay`,
      area: rect(def.x, def.z, def.size * ZONE_SCALE, def.size * ZONE_SCALE),
      from: ctx.player.back,
      to: this,
      kind: 'pay',
      interval: TIMING.payInterval,
      delay: TIMING.padHoldDelay,
      enabled: false,
      cashAmount: () => this.chunk(),
      flight: PAD_CASH_FLIGHT,
    });

    // Restored game: appear at once, silently.
    const s = ctx.state;
    this.done = !!s.unlocked[def.id];
    if (this.done) {
      if (this.levelReady()) {
        this.arm('level');
        this.appear(true);
      }
    } else {
      this.arm('unlock');
      if (s.padsVisible[def.id]) this.appear(true);
    }
  }

  /** The pad is on the floor and takes cash (unlock pad shown, or level pad shown). */
  get visible(): boolean {
    return this.shown;
  }

  get unlocked(): boolean {
    return this.done;
  }

  /** The pad is currently a level pad ("<LABEL> LV n"). */
  get levelMode(): boolean {
    return this.mode === 'level';
  }

  /**
   * Level this pad offers when in level mode, else 0: the shown level the purchase reaches (first level pad = LV 1), the
   * same number as the shop, the era checklist and the era cap, so the last era-1 pad reads LV 10.
   */
  get offeredLevel(): number {
    return this.mode === 'level' && this.upgradeId ? this.ctx.upgrades.shownLevel(this.upgradeId) + 1 : 0;
  }

  /** Cost of the current target. */
  get cost(): number {
    return this.total;
  }

  /** World centre of the pad. */
  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** Sign text of the current target ("HARVESTER", "HARVESTER LV 2"). */
  get label(): string {
    return this.mode === 'level' ? `${this.def.label} Lv ${this.offeredLevel}` : this.def.label;
  }

  /** Reveal the UNLOCK pad (pop-in + ring; instant = silent, restored state). */
  show(instant = false): void {
    if (this.shown || this.done) return;
    this.arm('unlock');
    this.appear(instant);
    if (!instant) {
      this.ctx.events.emit('pad:shown', { id: this.def.id, position: this.object.position.clone() });
    }
  }

  /** Reveal the LEVEL pad of an unlocked machine (Progression, flag `reveal:levelPad:<id>`). */
  showLevel(instant = false): void {
    if (this.shown || !this.levelReady(true)) return;
    this.arm('level');
    this.appear(instant);
  }

  forceUnlock(): void {
    if (this.done) return;
    this.remaining = 0;
    this.unlock();
  }

  update(dt: number): void {
    if (!this.shown) {
      // the climb opened (Great Lodge) or a new era lifted the cap over a maxed level pad: it comes back
      if (this.done && climbOpen(this.ctx.state) && this.levelReady()) this.showLevel();
      return;
    }
    const t = this.ctx.time.elapsed;
    // debug / restore: the level changed behind our back
    if (this.mode === 'level' && this.upgradeId && this.ctx.upgrades.level(this.upgradeId) !== this.armedLevel) this.syncLevel();
    const money = this.ctx.economy.money;
    const eager = this.remaining > 0 && money >= this.remaining;
    const canPay = this.pending > 0 || (this.remaining - this.pending > 0 && money >= 5);
    this.feel.update(dt, t, this.pulse, eager, canPay, this.ctx.zones.isPlayerIn(this.zone.area));
    this.ring.update(dt, t, eager);
    // billboard the sign (plane faces +Z locally) and bob it a little
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    this.sign.position.y = SIGN_HEIGHT + Math.sin(t * 2.2 + this.def.x) * 0.06 * motionScale();
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    return kind === 'cash' && this.shown && this.remaining - this.pending > 0;
  }
  reserve(item: Item): Slot {
    this.pending += item.value;
    const slot: PadSlot = { holder: this, value: item.value, live: true };
    this.writePaid();
    return slot;
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.def.x, 0.3, this.def.z);
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
    if (!this.shown) return;
    this.remaining = Math.max(0, this.remaining - s.value);
    this.writePaid();
    this.redraw();
    if (this.remaining > 0) this.ctx.tweens.squash(this.model, 0.07, 0.24);
    this.ring.flash();
    this.tmpPos.copy(this.object.position);
    this.ctx.events.emit('pad:paid', {
      id: this.def.id,
      remaining: this.remaining,
      cost: this.total,
      position: this.tmpPos,
    });
    if (this.remaining <= 0) this.complete();
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
  /** One bundle ≈ total / padFlights, a multiple of 5 (≥ 5), never more than what is still unpaid. */
  private chunk(): number {
    const left = this.remaining - this.pending;
    if (left <= 0) return 0;
    const c = Math.max(5, Math.ceil(this.total / TIMING.padFlights / 5) * 5);
    return Math.min(c, left);
  }

  /** Level pad possible: machine with levels, unlocked, not maxed (and, unless `ignoreFlag`, revealed). */
  private levelReady(ignoreFlag = false): boolean {
    const id = this.upgradeId;
    if (!id || !this.done || this.ctx.upgrades.isMax(id)) return false;
    return ignoreFlag || !!this.ctx.state.flags[`reveal:levelPad:${this.def.id}`];
  }

  /** Switch target (cost, label, badge) and restore partial progress from state.padPaid. */
  private arm(mode: Mode): void {
    this.mode = mode;
    this.pending = 0;
    if (mode === 'level' && this.upgradeId) {
      this.armedLevel = this.ctx.upgrades.level(this.upgradeId);
      this.total = this.ctx.upgrades.nextCost(this.upgradeId) ?? 0;
    } else {
      this.total = this.def.cost;
    }
    const paid = Math.min(this.total, this.ctx.state.padPaid[this.id] ?? 0);
    this.remaining = Math.max(0, this.total - paid);
    setPadSignLabel(this.sign, this.label);
    this.redraw();
    this.ring.snap(this.total > 0 ? paid / this.total : 0);
  }

  /** The level changed from outside (debug setUpgrade): re-arm silently, or hide at max. */
  private syncLevel(): void {
    this.ctx.state.padPaid[this.id] = 0;
    if (this.upgradeId && this.ctx.upgrades.isMax(this.upgradeId)) {
      this.hide(false);
      return;
    }
    this.arm('level');
  }

  private writePaid(): void {
    this.ctx.state.padPaid[this.id] = Math.max(0, this.total - this.remaining + this.pending);
  }

  private redraw(): void {
    const ratio = this.total > 0 ? 1 - this.remaining / this.total : 1;
    const badge = this.mode === 'level' ? `Lv ${this.offeredLevel}` : undefined;
    createPadTexture(this.def.icon, formatCost(this.remaining), ratio, this.texture, badge);
    this.ring.setProgress(ratio);
  }

  /** Put the pad on the floor (zone on, state written). instant: no animation / ring / sound. */
  private appear(instant: boolean): void {
    this.shown = true;
    this.zone.setEnabled(true);
    this.feel.reset();
    if (this.mode === 'unlock') this.ctx.state.padsVisible[this.def.id] = true;
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    this.object.scale.setScalar(1);
    this.object.visible = true;
    if (instant) return;
    tw.popIn(this.object, { duration: 0.55 });
    this.ctx.particles.ring(this.object.position, { color: this.mode === 'level' ? PALETTE.accent : PALETTE.padFill, radius: 2.6, life: 0.6 });
    this.ctx.audio.play('whoosh', { volume: 0.5 });
  }

  /** Take the pad away (pop-out unless instant). */
  private hide(animate: boolean): void {
    this.shown = false;
    this.pending = 0;
    this.zone.setEnabled(false);
    if (this.mode === 'unlock') this.ctx.state.padsVisible[this.def.id] = false;
    this.ctx.tweens.killTweensOf(this.object);
    if (!animate || !this.object.visible) {
      this.object.visible = false;
      this.object.scale.setScalar(1);
      return;
    }
    this.ctx.tweens.run({
      duration: POP_OUT_TIME,
      ease: Ease.quadIn,
      onUpdate: (k) => this.object.scale.setScalar(Math.max(0.0001, 1 - k)),
      onComplete: () => {
        if (this.shown) return;
        this.object.visible = false;
        this.object.scale.setScalar(1);
      },
    });
  }

  private complete(): void {
    if (this.mode === 'unlock') this.unlock();
    else this.completeLevel();
  }

  private unlock(): void {
    const wasVisible = this.shown;
    this.done = true;
    this.shown = false;
    this.remaining = 0;
    this.pending = 0;
    this.ctx.state.padPaid[this.id] = 0;
    this.redraw();
    this.zone.setEnabled(false);
    this.ctx.state.padsVisible[this.def.id] = false;
    // Logic first: Level builds the station from this event.
    this.ctx.events.emit('pad:unlocked', { id: this.def.id, position: this.object.position.clone() });
    if (wasVisible) {
      this.ctx.events.emit('pad:complete', { id: this.id, kind: 'unlock', position: this.object.position.clone() });
      this.playUnlockVisual();
    } else this.object.visible = false;
  }

  /** Level target paid: gain the level, re-arm for the next one (or hide at max). */
  private completeLevel(): void {
    const id = this.upgradeId;
    this.remaining = 0;
    this.pending = 0;
    this.ctx.state.padPaid[this.id] = 0;
    this.zone.setEnabled(false);
    if (!id) return;
    this.ctx.upgrades.levelUp(id, this.object.position.clone());
    this.ctx.events.emit('pad:complete', { id: this.id, kind: 'level', position: this.object.position.clone() });
    if (this.ctx.upgrades.isMax(id)) {
      this.playBounce(1.28, () => this.hide(true));
      return;
    }
    this.arm('level');
    this.playBounce(1.2);
    const token = ++this.cooldownToken;
    this.ctx.tweens.delay(LEVEL_COOLDOWN, () => {
      if (token === this.cooldownToken && this.shown) this.zone.setEnabled(true);
    });
  }

  /** Squash-and-stretch hump on the whole pad (level purchases: smaller than the unlock bounce). */
  private playBounce(peak: number, then?: () => void): void {
    this.ctx.tweens.killTweensOf(this.model);
    this.model.scale.setScalar(1);
    playPadCelebrate(this.ctx.tweens, this.object, peak, { bounce: 0.4, onDone: then });
  }

  /** Big squash-and-stretch bounce (1 → 1.45 → 1), then pop out to nothing. Pure visuals. */
  private playUnlockVisual(): void {
    const o = this.object;
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.model);
    this.model.scale.setScalar(1);
    this.pulse.scale.setScalar(1);
    playPadCelebrate(tw, o, 1.45, {
      bounce: BOUNCE_TIME,
      popOut: POP_OUT_TIME,
      onDone: () => {
        o.visible = false;
        o.scale.setScalar(1);
        // Debug / restored flag: the level pad may already be due.
        if (this.levelReady()) this.showLevel();
      },
    });
  }
}
