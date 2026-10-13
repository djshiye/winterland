/**
 * [B2 — items] Proximity zones: "player stands here → something happens". STUB: replace bodies,
 * keep the public API.
 *
 * - A zone is an XZ rectangle. Each update: inside = player position within area (and zone enabled).
 *   Fire onEnter / onExit on transitions and onStay(dt) every step while inside.
 * - Transfer zones (addTransfer) move items `from` → `to` while the player is inside: the first item
 *   moves immediately on entry, then one every `interval` seconds, the interval shrinking ×0.88 per
 *   item down to TIMING.minInterval (satisfying acceleration). Uses transferOne(). If items are
 *   available but `to` refuses because it is full, emit 'stack:full' (throttled ~0.6 s per zone).
 *   Leaving resets the interval.
 * - Optional ground marker: rounded-rectangle outline (white, ~0.06 thick, slightly inset, y≈0.02,
 *   unlit, transparent ~0.35) that brightens/pulses while the player is inside. Hidden when disabled.
 */
import type * as THREE from 'three';
import type { Rect } from '../config';
import type { GameContext, Item, ItemHolder, ItemKind } from '../core/types';
import type { FlightOptions } from './FlightSystem';

export interface ZoneOptions {
  id: string;
  area: Rect;
  enabled?: boolean;
  marker?: boolean;
  onEnter?: () => void;
  onExit?: () => void;
  onStay?: (dt: number) => void;
}

export interface TransferZoneOptions {
  id: string;
  area: Rect;
  from: ItemHolder;
  to: ItemHolder;
  kinds?: readonly ItemKind[];
  /** Seconds between items at the start of a visit (default TIMING.pickupInterval). */
  interval?: number;
  flight?: FlightOptions;
  marker?: boolean;
  enabled?: boolean;
  onTransfer?: (item: Item) => void;
}

export class Zone {
  readonly id: string;
  area: Rect;
  enabled: boolean;
  playerInside = false;
  marker: THREE.Object3D | null = null;

  constructor(opts: ZoneOptions) {
    this.id = opts.id;
    this.area = { ...opts.area };
    this.enabled = opts.enabled ?? true;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setArea(r: Rect): void {
    this.area = { ...r };
  }
}

export class ZoneSystem {
  constructor(readonly ctx: GameContext) {}

  add(opts: ZoneOptions): Zone {
    return new Zone(opts);
  }

  addTransfer(opts: TransferZoneOptions): Zone {
    return new Zone({ id: opts.id, area: opts.area, enabled: opts.enabled, marker: opts.marker });
  }

  remove(_zone: Zone): void {}

  isPlayerIn(_area: Rect): boolean {
    return false;
  }

  update(_dt: number): void {}
}
