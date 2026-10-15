/**
 * [B7 — progression] Construction pad for village plots and the Great Lodge: takes LOGS from the player's arms
 * AND CASH from the player's back (chunked) until both totals are paid, then calls onComplete(). The Village
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
 *
 * B7 implementation: the tile shows the shelter icon (tent / hut / cabin / lodge / great lodge drawn on the canvas),
 * a log icon + logs left and a bill icon + cash left (a finished requirement shows a check mark), a floating sign
 * with the label, a pulse while the player can pay something, a punch per landing, pop-in / pop-out (instant =
 * silent). Each kind's zone turns off as soon as that requirement is met (landed + in flight).
 */
import * as THREE from 'three';
import { PALETTE, TIMING, rect } from '../config';
import { Ease } from '../core/Tween';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import type { Zone } from '../items/Zones';
import { createConstructionTexture, createPadModel, createPadSign, setPadSignLabel, type ShelterIcon } from '../assets/pads';

export type ConstructionIcon = ShelterIcon;

const SIGN_HEIGHT = 1.7;
const SIGN_SCALE = 0.72;

export interface ConstructionTarget {
  /** Floating sign text, e.g. 'HUT'. */
  label: string;
  icon: ConstructionIcon;
  /** Total logs and dollars for this target. */
  logs: number;
  cash: number;
  /** Already paid (restoring a save / partial progress). */
  paidLogs?: number;
  paidCash?: number;
}

export interface ConstructionPadOptions extends ConstructionTarget {
  /** 'plot:<i>' | 'greatLodge' (holder id 'pad:<key>'). */
  key: string;
  x: number;
  z: number;
  /** Tile size in metres. */
  size: number;
  /** After every landed log / bundle (the village mirrors it into state.village). */
  onProgress?: (paidLogs: number, paidCash: number) => void;
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

  private target: Required<ConstructionTarget>;
  private pendingLogs = 0;
  private pendingCash = 0;
  private shown = false;
  private completed = false;
  private readonly texture: THREE.CanvasTexture;
  private readonly logZone: Zone;
  private readonly cashZone: Zone;
  private readonly pulse = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sign: THREE.Mesh;
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
    this.pulse.add(this.model);
    this.object.add(this.pulse);
    this.sign = createPadSign(this.target.label);
    this.sign.scale.setScalar(SIGN_SCALE);
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
    this.object.position.set(opts.x, 0, opts.z);
    this.object.visible = false;
    ctx.scene.add(this.object);
    // The Village may not tick its pads: register ourselves (billboard sign, pulse). Calling update twice is harmless.
    ctx.addUpdatable(this);
    const area = rect(opts.x, opts.z, opts.size * 1.2, opts.size * 1.2);
    this.logZone = ctx.zones.addTransfer({
      id: `${this.id}:logs`,
      area,
      from: ctx.player.arms,
      to: this,
      kinds: ['log'],
      interval: TIMING.dropInterval,
      delay: TIMING.padHoldDelay,
      enabled: false,
    });
    this.cashZone = ctx.zones.addTransfer({
      id: `${this.id}:cash`,
      area,
      from: ctx.player.back,
      to: this,
      interval: TIMING.payInterval,
      delay: TIMING.padHoldDelay,
      enabled: false,
      cashAmount: () => this.cashChunk(),
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

  hide(): void {
    const was = this.shown;
    this.shown = false;
    this.syncZones();
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    if (!was || !this.object.visible) {
      this.object.visible = false;
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

  /** Switch to a new target (the next tier). Keeps the shown / hidden state. */
  rearm(target: ConstructionTarget): void {
    this.target = fill(target);
    this.pendingLogs = 0;
    this.pendingCash = 0;
    this.completed = false;
    setPadSignLabel(this.sign, this.target.label);
    this.redraw();
    this.syncZones();
    this.completeIfPaid();
  }

  update(_dt: number): void {
    if (!this.shown) return;
    const t = this.ctx.time.elapsed;
    const arms = this.ctx.player.arms;
    const eager =
      (this.logsLeft - this.pendingLogs > 0 && arms.count('log') > 0) ||
      (this.cashLeft - this.pendingCash > 0 && this.ctx.economy.money >= 5);
    const amp = eager ? 0.05 : 0.02;
    const s = 1 + amp * Math.sin(t * (eager ? 5.5 : 3));
    this.pulse.scale.set(s, 1 + (s - 1) * 0.5, s);
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    this.sign.position.y = SIGN_HEIGHT + Math.sin(t * 2.2 + this.opts.x) * 0.05;
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    if (!this.shown || this.completed) return false;
    if (kind === 'log') return this.logsLeft - this.pendingLogs > 0;
    if (kind === 'cash') return this.cashLeft - this.pendingCash > 0;
    return false;
  }

  reserve(item: Item): Slot {
    if (item.kind === 'log') this.pendingLogs++;
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
      if (kind === 'log') this.pendingLogs = Math.max(0, this.pendingLogs - 1);
      else this.pendingCash = Math.max(0, this.pendingCash - s.value);
    }
    if (kind === 'log') this.target.paidLogs++;
    else this.target.paidCash += item.value;
    this.ctx.items.release(item);
    this.redraw();
    this.syncZones();
    if (this.shown) this.ctx.tweens.punchScale(this.model, 0.08, 0.14);
    this.ctx.events.emit('construction:paid', {
      key: this.key,
      kind: kind === 'log' ? 'log' : 'cash',
      logsLeft: this.logsLeft,
      cashLeft: this.cashLeft,
      position: this.tmpPos.copy(this.object.position),
    });
    this.reportProgress();
    if (!this.completed && this.logsLeft <= 0 && this.cashLeft <= 0) {
      this.completed = true;
      this.hide();
      this.opts.onComplete();
    }
  }

  cancel(slot: Slot): void {
    const s = slot as ConstructionSlot;
    if (!s.live) return;
    s.live = false;
    if (s.kind === 'log') this.pendingLogs = Math.max(0, this.pendingLogs - 1);
    else this.pendingCash = Math.max(0, this.pendingCash - s.value);
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
  /**
   * Mirror landed + in-flight amounts into onProgress (the owner writes them to the save state). Money leaves the
   * player's wallet the moment a bundle is taken, so a save made while it is still flying must already count it as
   * paid (same idea as UpgradePad.writePaid). Restoring such a save re-arms the pad with those amounts.
   */
  private reportProgress(): void {
    this.opts.onProgress?.(this.target.paidLogs + this.pendingLogs, this.target.paidCash + this.pendingCash);
  }

  /**
   * A restored save can hold a fully paid target (the last bundle was still flying when it was written): nothing
   * will ever land, so complete the tier now (deferred a tick so the owner is not re-entered from show()/rearm()).
   */
  private completeIfPaid(): void {
    if (!this.shown || this.completed || this.logsLeft > 0 || this.cashLeft > 0) return;
    if (this.pendingLogs > 0 || this.pendingCash > 0) return;
    this.completed = true;
    this.ctx.tweens.delay(0, () => {
      this.hide();
      this.opts.onComplete();
    });
  }

  private cashChunk(): number {
    const left = this.cashLeft - this.pendingCash;
    if (left <= 0) return 0;
    const chunk = Math.max(5, Math.ceil(this.target.cash / TIMING.padFlights / 5) * 5);
    return Math.min(chunk, left);
  }

  /** A requirement's zone is on only while something of it is still missing (landed + in flight). */
  private syncZones(): void {
    this.logZone.setEnabled(this.shown && this.logsLeft - this.pendingLogs > 0);
    this.cashZone.setEnabled(this.shown && this.cashLeft - this.pendingCash > 0);
  }

  private makeTexture(target?: THREE.CanvasTexture): THREE.CanvasTexture {
    const t = this.target;
    return createConstructionTexture(
      t.icon,
      { left: this.logsLeft, total: t.logs },
      { left: this.cashLeft, total: t.cash },
      target,
    );
  }

  private redraw(): void {
    this.makeTexture(this.texture);
  }
}

function fill(t: ConstructionTarget): Required<ConstructionTarget> {
  return { label: t.label, icon: t.icon, logs: t.logs, cash: t.cash, paidLogs: t.paidLogs ?? 0, paidCash: t.paidCash ?? 0 };
}
