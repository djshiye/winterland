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
 * STUB (main session): a functional baseline (plain tile, no juice) so the village can be built end to end.
 */
import * as THREE from 'three';
import { TIMING, rect } from '../config';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import type { Zone } from '../items/Zones';
import { createPadModel, createPadTexture } from '../assets/pads';

export type ConstructionIcon = 'tent' | 'hut' | 'cabin' | 'lodge' | 'greatLodge';

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

  constructor(
    readonly ctx: GameContext,
    readonly opts: ConstructionPadOptions,
  ) {
    this.id = `pad:${opts.key}`;
    this.key = opts.key;
    this.target = fill(opts);
    this.texture = createPadTexture('factory', this.text(), 0);
    this.object.add(createPadModel(opts.size, this.texture));
    this.object.position.set(opts.x, 0, opts.z);
    this.object.visible = false;
    ctx.scene.add(this.object);
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

  show(_instant = false): void {
    if (this.shown) return;
    this.shown = true;
    this.object.visible = true;
    this.syncZones();
  }

  hide(): void {
    this.shown = false;
    this.object.visible = false;
    this.syncZones();
  }

  /** Switch to a new target (the next tier). Keeps the shown / hidden state. */
  rearm(target: ConstructionTarget): void {
    this.target = fill(target);
    this.pendingLogs = 0;
    this.pendingCash = 0;
    this.completed = false;
    this.redraw();
    this.syncZones();
  }

  update(_dt: number): void {}

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
    this.ctx.events.emit('construction:paid', {
      key: this.key,
      kind: kind === 'log' ? 'log' : 'cash',
      logsLeft: this.logsLeft,
      cashLeft: this.cashLeft,
      position: this.object.position.clone(),
    });
    this.opts.onProgress?.(this.target.paidLogs, this.target.paidCash);
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
  }

  count(_kind?: ItemKind): number {
    return 0;
  }

  take(_kind?: ItemKind): Item | null {
    return null;
  }

  // --- internals ------------------------------------------------------------
  private cashChunk(): number {
    const left = this.cashLeft - this.pendingCash;
    if (left <= 0) return 0;
    const chunk = Math.max(5, Math.ceil(this.target.cash / TIMING.padFlights / 5) * 5);
    return Math.min(chunk, left);
  }

  private syncZones(): void {
    this.logZone.setEnabled(this.shown && this.logsLeft > 0);
    this.cashZone.setEnabled(this.shown && this.cashLeft > 0);
  }

  private text(): string {
    return `${this.logsLeft} logs $${this.cashLeft}`;
  }

  private redraw(): void {
    const total = this.target.logs + this.target.cash / 50;
    const done = this.target.paidLogs + this.target.paidCash / 50;
    createPadTexture('factory', this.text(), total > 0 ? done / total : 1, this.texture);
  }
}

function fill(t: ConstructionTarget): Required<ConstructionTarget> {
  return { label: t.label, icon: t.icon, logs: t.logs, cash: t.cash, paidLogs: t.paidLogs ?? 0, paidCash: t.paidCash ?? 0 };
}
