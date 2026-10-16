/**
 * [B7 — progression] Construction pad for village plots and the Great Lodge: takes LOGS from the player's arms
 * AND CASH from the player's back (chunked) until both totals are paid (logs may be 0 for era pads), then calls onComplete(). The Village
 * (village/Village.ts) owns these pads and the plot state; the pad itself only collects.
 *
 * CONTRACT (keep every public signature; B7 owns the implementation):
 * - ItemHolder id 'pad:<key>'. canAccept('log') while shown and logsLeft − pendingLogs > 0; canAccept('cash')
 *   while shown and cashLeft − pendingCash > 0. receive() releases the item to the pool, counts it, emits
 *   'construction:paid', calls onProgress(paidLogs, paidCash) and, once both are complete, hides itself and calls
 *   onComplete() exactly once per target.
 * - Two transfer zones over the tile: player.arms → pad (kinds ['log'], TIMING.dropInterval) and player.back → pad
 *   (cashAmount = chunk ≈ cash / TIMING.padFlights, a multiple of 5, capped at what is left), both with
 *   delay TIMING.padHoldDelay. Disable each zone as soon as its requirement is met (no 'stack:full' spam).
 * - rearm(target) switches to the next tier's totals (paidLogs/paidCash restore partial progress).
 * - show(instant) pops in (instant: no animation, no sound, no event); hide() pops out.
 * - setLocked(note) (0.9 era pads on preview, docs/EXPANSION.md §C): the tile stays shown but greyed under a padlock and
 *   `note`, takes nothing (zones off, canAccept / payDirect refuse) and never completes; setLocked(null) re-arms it.
 *
 * B7 implementation: the tile shows the shelter icon (tent / hut / cabin / lodge / great lodge drawn on the canvas),
 * a log icon + logs left and a bill icon + cash left (a finished requirement shows a check mark), a floating sign
 * with the label, a pulse while the player can pay something, a punch per landing, pop-in / pop-out (instant =
 * silent). Each kind's zone turns off as soon as that requirement is met (landed + in flight).
 *
 * Juice (fx/PadRing.ts, fx/padJuice.ts): a soft fill ring around the tile eases toward the paid share (logs + cash +
 * extra, by count of requirements) and flashes per landing, bundles arc in with a gentle squash, the tile squashes a
 * little per landing, an affordable pad (everything still missing is in the wallet / arms) breathes a warm glow, and a
 * completion played from a landing bounces (squash-and-stretch) before popping out and emits 'pad:complete' kind
 * 'build' after onComplete(). Bounces shrink under reduced motion. Visual only: zones, intervals and amounts unchanged.
 */
import * as THREE from 'three';
import { PALETTE, TIMING, rect } from '../config';
import { Ease } from '../core/Tween';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import type { Zone } from '../items/Zones';
import { createConstructionTexture, createPadModel, createPadSign, setPadSignLabel, type ShelterIcon } from '../assets/pads';
import { PadRing, playPadCelebrate } from '../fx/PadRing';
import { PAD_CASH_FLIGHT, motionScale } from '../fx/padJuice';

export type ConstructionIcon = ShelterIcon;

const SIGN_HEIGHT = 1.7;
const SIGN_SCALE = 0.72;

export interface ConstructionTarget {
  /** Floating sign text, e.g. 'HUT'. */
  label: string;
  icon: ConstructionIcon;
  /**
   * Total logs and dollars for this target. logs may be 0 (0.9.0 era machines / city lots / expansions cost cash + one
   * material only): the pad then shows no log row, its item zone takes only the extra kind, and it completes once
   * cash and extra are paid.
   */
  logs: number;
  cash: number;
  /** Already paid (restoring a save / partial progress). */
  paidLogs?: number;
  paidCash?: number;
  /**
   * Wave 13: an optional THIRD requirement (the Grand Market's toys). The player's arms feed it like logs (the pad's
   * item zone then accepts ['log', extra.kind]); completion needs logs, cash AND extra all paid. `paid` restores progress.
   */
  extra?: { kind: ItemKind; count: number; paid?: number };
}

export interface ConstructionPadOptions extends ConstructionTarget {
  /** 'plot:<i>' | 'greatLodge' (holder id 'pad:<key>'). */
  key: string;
  x: number;
  z: number;
  /** Tile size in metres. */
  size: number;
  /** After every landed log / bundle (the village mirrors it into state.village). */
  onProgress?: (paidLogs: number, paidCash: number, paidExtra: number) => void;
  /** Both requirements met (once per target). The pad has hidden itself; rearm() + show() for the next tier. */
  onComplete: () => void;
}

interface ConstructionSlot extends Slot {
  kind: ItemKind;
  value: number;
  live: boolean;
}

export class ConstructionPad implements ItemHolder {
  readonly id: string;
  readonly key: string;
  /** Root at the pad's floor centre. */
  readonly object = new THREE.Group();

  private target: Filled;
  private pendingLogs = 0;
  private pendingCash = 0;
  private pendingExtra = 0;
  private shown = false;
  private completed = false;
  /** Preview note while locked (greyed, refuses payment), null when payable. */
  private lockNote: string | null = null;
  private readonly texture: THREE.CanvasTexture;
  private readonly logZone: Zone;
  private readonly cashZone: Zone;
  private readonly pulse = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sign: THREE.Mesh;
  private readonly ring: PadRing;
  private readonly tmpPos = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: ConstructionPadOptions,
  ) {
    this.id = `pad:${opts.key}`;
    this.key = opts.key;
    this.target = fill(opts);
    this.texture = this.makeTexture();
    this.model = createPadModel(opts.size, this.texture);
    this.ring = new PadRing(opts.size, opts.size);
    this.ring.snap(this.paidRatio());
    this.model.add(this.ring.mesh);
    this.pulse.add(this.model);
    this.object.add(this.pulse);
    this.sign = createPadSign(this.target.label);
    this.sign.scale.setScalar(SIGN_SCALE);
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
    this.object.position.set(opts.x, 0, opts.z);
    ctx.occlusion?.addTarget(this.object, opts.size, () => this.shown);
    this.object.visible = false;
    ctx.scene.add(this.object);
    // The Village may not tick its pads: register ourselves (billboard sign, pulse). Calling update twice is harmless.
    ctx.addUpdatable(this);
    // the accept zone is the tile itself (was ×1.2): neighbouring village pads no longer overlap the street's lane
    const area = rect(opts.x, opts.z, opts.size, opts.size);
    this.logZone = ctx.zones.addTransfer({
      id: `${this.id}:logs`,
      area,
      from: ctx.player.arms,
      to: this,
      kinds: itemZoneKinds(opts),
      kind: 'pay',
      interval: TIMING.dropInterval,
      delay: TIMING.padHoldDelay,
      enabled: false,
    });
    this.cashZone = ctx.zones.addTransfer({
      id: `${this.id}:cash`,
      area,
      from: ctx.player.back,
      to: this,
      kind: 'pay',
      interval: TIMING.payInterval,
      delay: TIMING.padHoldDelay,
      enabled: false,
      cashAmount: () => this.cashChunk(),
      flight: PAD_CASH_FLIGHT,
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  get logsLeft(): number {
    return Math.max(0, this.target.logs - this.target.paidLogs);
  }

  get cashLeft(): number {
    return Math.max(0, this.target.cash - this.target.paidCash);
  }

  /** Third requirement left (0 when the pad has none). */
  get extraLeft(): number {
    const e = this.target.extra;
    return e ? Math.max(0, e.count - e.paid) : 0;
  }

  /** The third requirement's item kind, or null. */
  get extraKind(): ItemKind | null {
    return this.target.extra?.kind ?? null;
  }

  /** World centre of the tile. */
  get position(): THREE.Vector3 {
    return this.object.position;
  }

  show(instant = false): void {
    if (this.shown) return;
    this.shown = true;
    this.syncZones();
    this.completeIfPaid();
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    this.object.scale.setScalar(1);
    this.object.visible = true;
    if (instant) return;
    tw.popIn(this.object, { duration: 0.5 });
    this.ctx.particles.ring(this.object.position, { color: PALETTE.padFill, radius: 1.8, life: 0.5 });
    this.ctx.audio.play('whoosh', { volume: 0.4 });
  }

  hide(celebrate = false): void {
    const was = this.shown;
    this.shown = false;
    this.syncZones();
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    if (!was || !this.object.visible) {
      this.object.visible = false;
      return;
    }
    if (celebrate) {
      // squash-and-stretch hump, then pop out (a show() for the next tier kills it: the tween targets the object)
      tw.killTweensOf(this.model);
      this.model.scale.setScalar(1);
      playPadCelebrate(tw, this.object, 1.32, {
        bounce: 0.38,
        popOut: 0.25,
        onDone: () => {
          if (this.shown) return;
          this.object.visible = false;
          this.object.scale.setScalar(1);
        },
      }).target = this.object;
      return;
    }
    tw.run({
      duration: 0.25,
      ease: Ease.quadIn,
      onUpdate: (k) => this.object.scale.setScalar(Math.max(0.0001, 1 - k)),
      onComplete: () => {
        if (this.shown) return;
        this.object.visible = false;
        this.object.scale.setScalar(1);
      },
    });
  }

  /** True while the pad shows on preview and refuses payment. */
  get locked(): boolean {
    return this.lockNote !== null;
  }

  /**
   * Preview (note) or payable (null). A locked pad keeps its shown state and paid amounts but takes nothing; unlocking
   * re-enables the zones (and completes a fully paid target). No-op when unchanged.
   */
  setLocked(note: string | null): void {
    if (note === this.lockNote) return;
    this.lockNote = note;
    this.redraw();
    this.syncZones();
    this.completeIfPaid();
  }

  /** Switch to a new target (the next tier). Keeps the shown / hidden state. */
  rearm(target: ConstructionTarget): void {
    this.target = fill(target);
    this.pendingLogs = 0;
    this.pendingCash = 0;
    this.pendingExtra = 0;
    this.completed = false;
    setPadSignLabel(this.sign, this.target.label);
    this.redraw();
    this.ring.snap(this.paidRatio());
    this.syncZones();
    this.completeIfPaid();
  }

  update(dt: number): void {
    if (!this.shown) return;
    const t = this.ctx.time.elapsed;
    const arms = this.ctx.player.arms;
    const eager =
      this.lockNote === null &&
      ((this.logsLeft - this.pendingLogs > 0 && arms.count('log') > 0) ||
        (this.cashLeft - this.pendingCash > 0 && this.ctx.economy.money >= 5) ||
        (this.target.extra !== null && this.extraLeft - this.pendingExtra > 0 && arms.count(this.target.extra.kind) > 0));
    const amp = (eager ? 0.05 : 0.02) * motionScale();
    const s = 1 + amp * Math.sin(t * (eager ? 5.5 : 3));
    this.pulse.scale.set(s, 1 + (s - 1) * 0.5, s);
    this.ring.update(dt, t, eager && this.affordable());
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    this.sign.position.y = SIGN_HEIGHT + Math.sin(t * 2.2 + this.opts.x) * 0.05;
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    if (!this.shown || this.completed || this.lockNote !== null) return false;
    if (kind === 'log') return this.logsLeft - this.pendingLogs > 0;
    if (kind === 'cash') return this.cashLeft - this.pendingCash > 0;
    if (this.target.extra && kind === this.target.extra.kind) return this.extraLeft - this.pendingExtra > 0;
    return false;
  }

  reserve(item: Item): Slot {
    if (item.kind === 'log') this.pendingLogs++;
    else if (this.isExtra(item.kind)) this.pendingExtra++;
    else this.pendingCash += item.value;
    const slot: ConstructionSlot = { holder: this, kind: item.kind, value: item.value, live: true };
    this.syncZones();
    this.reportProgress();
    return slot;
  }

  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.opts.x, 0.3, this.opts.z);
  }

  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }

  receive(item: Item, slot: Slot): void {
    const s = slot as ConstructionSlot;
    const kind = s.kind;
    if (s.live) {
      s.live = false;
      this.unpend(s);
    }
    if (kind === 'log') this.target.paidLogs++;
    else if (this.isExtra(kind)) this.target.extra!.paid++;
    else this.target.paidCash += item.value;
    this.ctx.items.release(item);
    this.redraw();
    this.syncZones();
    if (this.shown) {
      this.ctx.tweens.squash(this.model, 0.08 * motionScale(), 0.24);
      this.ring.flash();
    }
    this.ctx.events.emit('construction:paid', {
      key: this.key,
      // the event's kind is a closed union: a landed extra item (wooden toys) counts as a 'log' (thunk + sawdust)
      kind: kind === 'log' || this.isExtra(kind) ? 'log' : 'cash',
      logsLeft: this.logsLeft,
      cashLeft: this.cashLeft,
      position: this.tmpPos.copy(this.object.position),
    });
    this.reportProgress();
    if (!this.completed && this.logsLeft <= 0 && this.cashLeft <= 0 && this.extraLeft <= 0) this.finish();
  }

  /**
   * Wave 11: pay cash without an item (the foreman pays from the wallet). The caller spends the money; this credits
   * the target like a landed bundle: progress is reported, 'construction:paid' fires, and a fully paid tier completes.
   * Returns the amount credited (capped at what is left; 0 when hidden or complete).
   */
  payDirect(amount: number): number {
    if (!this.shown || this.completed || this.lockNote !== null) return 0;
    const credit = Math.max(0, Math.min(amount, this.cashLeft));
    if (credit <= 0) return 0;
    this.target.paidCash += credit;
    this.redraw();
    this.syncZones();
    if (this.shown) {
      this.ctx.tweens.squash(this.model, 0.08 * motionScale(), 0.24);
      this.ring.flash();
    }
    this.ctx.events.emit('construction:paid', {
      key: this.key,
      kind: 'cash',
      logsLeft: this.logsLeft,
      cashLeft: this.cashLeft,
      position: this.tmpPos.copy(this.object.position),
    });
    this.reportProgress();
    if (!this.completed && this.logsLeft <= 0 && this.cashLeft <= 0 && this.extraLeft <= 0) this.finish();
    return credit;
  }

  cancel(slot: Slot): void {
    const s = slot as ConstructionSlot;
    if (!s.live) return;
    s.live = false;
    this.unpend(s);
    this.syncZones();
    this.reportProgress();
  }

  count(_kind?: ItemKind): number {
    return 0;
  }

  take(_kind?: ItemKind): Item | null {
    return null;
  }

  // --- internals ------------------------------------------------------------
  /** The target is paid in full from a landing / direct payment: celebrate, hand over, then tell the juice. */
  private finish(): void {
    const was = this.shown;
    const at = this.tmpPos.copy(this.object.position).clone();
    this.completed = true;
    this.hide(true);
    this.opts.onComplete();
    if (was) this.ctx.events.emit('pad:complete', { id: this.id, kind: 'build', position: at });
  }

  /** Share of the target paid (each requirement weighted by its share of the total count / dollars). */
  private paidRatio(): number {
    const t = this.target;
    let parts = 0;
    let sum = 0;
    if (t.logs > 0) {
      parts++;
      sum += t.paidLogs / t.logs;
    }
    if (t.cash > 0) {
      parts++;
      sum += t.paidCash / t.cash;
    }
    if (t.extra && t.extra.count > 0) {
      parts++;
      sum += t.extra.paid / t.extra.count;
    }
    return parts > 0 ? Math.min(1, sum / parts) : 1;
  }

  /** Everything still missing (beyond what is in flight) is in the wallet and the player's arms right now. */
  private affordable(): boolean {
    const cash = this.cashLeft - this.pendingCash;
    const logs = this.logsLeft - this.pendingLogs;
    const extra = this.extraLeft - this.pendingExtra;
    if (cash <= 0 && logs <= 0 && extra <= 0) return false;
    const arms = this.ctx.player.arms;
    return (
      (cash <= 0 || this.ctx.economy.money >= cash) &&
      (logs <= 0 || arms.count('log') >= logs) &&
      (extra <= 0 || (this.target.extra !== null && arms.count(this.target.extra.kind) >= extra))
    );
  }

  /**
   * Mirror landed + in-flight amounts into onProgress (the owner writes them to the save state). Money leaves the
   * player's wallet the moment a bundle is taken, so a save made while it is still flying must already count it as
   * paid (same idea as UpgradePad.writePaid). Restoring such a save re-arms the pad with those amounts.
   */
  private reportProgress(): void {
    this.opts.onProgress?.(
      this.target.paidLogs + this.pendingLogs,
      this.target.paidCash + this.pendingCash,
      (this.target.extra?.paid ?? 0) + this.pendingExtra,
    );
  }

  /**
   * A restored save can hold a fully paid target (the last bundle was still flying when it was written): nothing
   * will ever land, so complete the tier now (deferred a tick so the owner is not re-entered from show()/rearm()).
   */
  private completeIfPaid(): void {
    if (!this.shown || this.completed || this.lockNote !== null || this.logsLeft > 0 || this.cashLeft > 0 || this.extraLeft > 0) return;
    if (this.pendingLogs > 0 || this.pendingCash > 0 || this.pendingExtra > 0) return;
    this.completed = true;
    this.ctx.tweens.delay(0, () => {
      this.hide();
      this.opts.onComplete();
    });
  }

  private isExtra(kind: ItemKind): boolean {
    return this.target.extra !== null && kind === this.target.extra.kind;
  }

  private unpend(s: ConstructionSlot): void {
    if (s.kind === 'log') this.pendingLogs = Math.max(0, this.pendingLogs - 1);
    else if (this.isExtra(s.kind)) this.pendingExtra = Math.max(0, this.pendingExtra - 1);
    else this.pendingCash = Math.max(0, this.pendingCash - s.value);
  }

  private cashChunk(): number {
    const left = this.cashLeft - this.pendingCash;
    if (left <= 0) return 0;
    const chunk = Math.max(5, Math.ceil(this.target.cash / TIMING.padFlights / 5) * 5);
    return Math.min(chunk, left);
  }

  /** A requirement's zone is on only while something of it is still missing (landed + in flight). */
  private syncZones(): void {
    // the item zone serves logs and the extra kind: on while either still misses something (landed + in flight)
    const open = this.shown && this.lockNote === null;
    this.logZone.setEnabled(open && (this.logsLeft - this.pendingLogs > 0 || this.extraLeft - this.pendingExtra > 0));
    this.cashZone.setEnabled(open && this.cashLeft - this.pendingCash > 0);
  }

  private makeTexture(target?: THREE.CanvasTexture): THREE.CanvasTexture {
    const t = this.target;
    return createConstructionTexture(
      t.icon,
      { left: this.logsLeft, total: t.logs },
      { left: this.cashLeft, total: t.cash },
      target,
      t.extra ? { left: this.extraLeft, total: t.extra.count, kind: t.extra.kind } : undefined,
      this.lockNote ?? undefined,
    );
  }

  private redraw(): void {
    this.makeTexture(this.texture);
    this.ring.setProgress(this.paidRatio());
  }
}

/**
 * Kinds the item zone pulls from the player's arms. Logs + the optional extra kind; a 0.9.0 era pad costs no logs
 * (logs: 0), so its zone takes only the extra kind (or, with no extra, stays permanently disabled and keeps ['log']
 * only so the zone has a valid kind list). Fixed at construction: an era pad is always re-armed with the same shape.
 */
function itemZoneKinds(t: ConstructionTarget): readonly ItemKind[] {
  if (t.logs > 0) return t.extra ? ['log', t.extra.kind] : ['log'];
  return t.extra ? [t.extra.kind] : ['log'];
}

interface Filled {
  label: string;
  icon: ConstructionIcon;
  logs: number;
  cash: number;
  paidLogs: number;
  paidCash: number;
  extra: { kind: ItemKind; count: number; paid: number } | null;
}

function fill(t: ConstructionTarget): Filled {
  return {
    label: t.label,
    icon: t.icon,
    logs: t.logs,
    cash: t.cash,
    paidLogs: t.paidLogs ?? 0,
    paidCash: t.paidCash ?? 0,
    extra: t.extra ? { kind: t.extra.kind, count: t.extra.count, paid: t.extra.paid ?? 0 } : null,
  };
}
