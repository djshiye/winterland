/**
 * [B2 — items] Parabolic item flights.
 *
 * - Every item movement between holders flies along a fast parabola: horizontal linear in t,
 *   vertical + 4·h·t·(1−t) (see math.arcPoint). Default duration TIMING.arcTime (0.15 s, spec),
 *   default height TIMING.arcHeight (grows slightly with distance).
 * - The destination is re-evaluated EVERY frame via to.getSlotWorldPosition(slot) so items land
 *   correctly on moving holders (player stack, NPCs, vehicles).
 * - Orientation slerps from launch orientation to to.getSlotWorldQuaternion(slot); optional `spin`
 *   adds whole turns around a random horizontal axis (nice for chopped logs).
 * - Optional scaleFrom: item scales from that value to 1 during the flight.
 * - Optional squash (pads' cash bundles): the item stretches tall-and-thin through the arc and lands squashed flat,
 *   scaled by the reduced-motion preference (fx/padJuice.ts motionScale). Shape only: duration and path are unchanged.
 * - Arrival: to.receive(item, slot); emit 'item:landed' { item, holder: to, position }; then
 *   opts.onLand?.(item). No per-frame allocations (flight records and temp vectors are reused).
 */
import * as THREE from 'three';
import { TIMING } from '../config';
import { TAU, arcPoint, clamp } from '../core/math';
import { motionScale } from '../fx/padJuice';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';

export interface FlightOptions {
  /** Seconds (default TIMING.arcTime). */
  duration?: number;
  /** Apex height above the straight line (default TIMING.arcHeight). */
  arcHeight?: number;
  /** Extra full rotations during the flight (default 0). */
  spin?: number;
  /** Scale at launch, tweened to 1 on arrival (default: keep current scale). */
  scaleFrom?: number;
  /** Squash-and-stretch amount (0 = none, ~0.25 = gentle). */
  squash?: number;
  onLand?: (item: Item) => void;
}

interface Flight {
  item: Item;
  to: ItemHolder;
  slot: Slot;
  t: number;
  duration: number;
  height: number;
  spin: number;
  scaleFrom: number;
  squash: number;
  onLand: ((item: Item) => void) | undefined;
  readonly start: THREE.Vector3;
  readonly startQuat: THREE.Quaternion;
  readonly spinAxis: THREE.Vector3;
}

const tmpPos = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpSpin = new THREE.Quaternion();
const tmpLand = new THREE.Vector3();

export class FlightSystem {
  private readonly flights: Flight[] = [];
  private readonly spare: Flight[] = [];

  constructor(readonly ctx: GameContext) {}

  /**
   * Start a flight of `item` (already taken from its previous holder and re-parented to the scene root)
   * toward the reserved `slot` of `to`. On arrival `to.receive(item, slot)` is called.
   */
  launch(item: Item, to: ItemHolder, slot: Slot, opts?: FlightOptions): void {
    const obj = item.object;
    if (obj.parent !== this.ctx.scene) this.ctx.scene.attach(obj);
    const f = this.spare.pop() ?? this.createRecord(item, to, slot);
    f.item = item;
    f.to = to;
    f.slot = slot;
    f.t = 0;
    f.duration = Math.max(0.001, opts?.duration ?? TIMING.arcTime);
    f.spin = opts?.spin ?? 0;
    f.scaleFrom = opts?.scaleFrom ?? obj.scale.x;
    f.squash = opts?.squash ? opts.squash * motionScale() : 0;
    f.onLand = opts?.onLand;
    f.start.copy(obj.position);
    f.startQuat.copy(obj.quaternion);
    if (f.spin !== 0) {
      f.spinAxis.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      if (f.spinAxis.lengthSq() < 1e-4) f.spinAxis.set(1, 0, 0);
      f.spinAxis.normalize();
    }
    to.getSlotWorldPosition(slot, tmpTarget);
    const dist = Math.hypot(tmpTarget.x - f.start.x, tmpTarget.z - f.start.z);
    f.height = opts?.arcHeight ?? TIMING.arcHeight * clamp(0.55 + dist * 0.14, 0.55, 1.35);
    if (opts?.scaleFrom !== undefined) obj.scale.setScalar(opts.scaleFrom);
    this.flights.push(f);
  }

  /** Flights currently in the air. */
  get activeCount(): number {
    return this.flights.length;
  }

  /**
   * Live flights heading for `holder` (optionally only items of `kind`). Items in the air belong to neither the
   * source nor the destination yet, so a save snapshot must add this to the holder's own count.
   */
  inFlightTo(holder: ItemHolder, kind?: ItemKind): number {
    let n = 0;
    for (let i = 0; i < this.flights.length; i++) {
      const f = this.flights[i]!;
      if (f.to === holder && (kind === undefined || f.item.kind === kind)) n++;
    }
    return n;
  }

  /** Total cash value of the live flights heading for `holder`. */
  valueInFlightTo(holder: ItemHolder): number {
    let v = 0;
    for (let i = 0; i < this.flights.length; i++) {
      const f = this.flights[i]!;
      if (f.to === holder && f.item.kind === 'cash') v += f.item.value;
    }
    return v;
  }

  update(dt: number): void {
    const flights = this.flights;
    // Backwards so swap-removal and re-entrant launches (from receive/onLand) are safe.
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      if (!f) continue; // can shrink if a callback removed flights
      f.t += dt / f.duration;
      const obj = f.item.object;
      const k = f.t >= 1 ? 1 : f.t;
      f.to.getSlotWorldPosition(f.slot, tmpTarget);
      arcPoint(f.start, tmpTarget, f.height, k, tmpPos);
      obj.position.copy(tmpPos);
      f.to.getSlotWorldQuaternion(f.slot, tmpQuat);
      obj.quaternion.copy(f.startQuat).slerp(tmpQuat, k);
      if (f.spin !== 0 && k < 1) {
        tmpSpin.setFromAxisAngle(f.spinAxis, f.spin * TAU * k);
        obj.quaternion.premultiply(tmpSpin);
      }
      const s = f.scaleFrom + (1 - f.scaleFrom) * k;
      if (f.squash > 0) {
        // stretched through the arc, squashed flat over the last fifth (landing)
        const st = f.squash * Math.sin(Math.PI * Math.min(1, k / 0.8));
        const sq = k > 0.8 ? f.squash * Math.sin(Math.PI * ((k - 0.8) / 0.2) * 0.5) : 0;
        obj.scale.set(s * (1 - 0.4 * st + 0.6 * sq), s * (1 + st - 0.8 * sq), s * (1 - 0.4 * st + 0.6 * sq));
      } else obj.scale.set(s, s, s);
      if (f.t < 1) continue;

      // Landed. Free the record first: receive()/onLand may launch new flights or touch the economy.
      const item = f.item;
      const to = f.to;
      const slot = f.slot;
      const onLand = f.onLand;
      const last = flights.length - 1;
      if (i !== last) flights[i] = flights[last]!;
      flights.pop();
      f.onLand = undefined;
      this.spare.push(f);

      obj.scale.set(1, 1, 1);
      tmpLand.copy(tmpTarget);
      to.receive(item, slot);
      this.ctx.events.emit('item:landed', { item, holder: to, position: tmpLand });
      onLand?.(item);
    }
  }

  private createRecord(item: Item, to: ItemHolder, slot: Slot): Flight {
    return {
      item,
      to,
      slot,
      t: 0,
      duration: TIMING.arcTime,
      height: TIMING.arcHeight,
      spin: 0,
      scaleFrom: 1,
      squash: 0,
      onLand: undefined,
      start: new THREE.Vector3(),
      startQuat: new THREE.Quaternion(),
      spinAxis: new THREE.Vector3(1, 0, 0),
    };
  }
}
