/**
 * [B5 — commerce] Blue cargo tricycles queueing on the SE road next to the SE counter.
 *
 * Spec: "delivery NPCs on blue 3-wheeled cargo bikes queue up next to a secondary counter ... Player
 * transfers crates to the South-East counter, where NPCs on blue cargo tricycles load them up, drive
 * off, and leave larger stacks of Green Cash Bundles."
 *
 * Model: AssetFactory createTricycle (assets/vehicles.ts) + createCharacterRig('courier') seated on it.
 * Behaviour (LAYOUT.tricycles, DEMAND trikeGap / trikeWant, ECONOMY.cratePrice) lives in npc/VehicleQueue.ts: trikes spawn
 * at (laneX, spawnZ), drive +Z with smooth accel / braking to slot i (z = frontZ − i·spacing; the front
 * trike's cargo tray parks beside the SE counter), the front one shows a crate bubble ("0/4") and loads
 * crates from counter.pile into its tray one every ~npcTakeInterval·1.3, then pays salePrice(want · cratePrice), emits
 * 'sale' { buyer: 'tricycle' }, cheers, drives off +Z to exitZ and returns to the pool.
 */
import { ECONOMY, LAYOUT, TIMING } from '../config';
import type { GameContext } from '../core/types';
import { createTricycleWithRider, TRIKE_WHEEL_RADIUS } from '../assets/vehicles';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';
import { Vehicle, VehicleQueue, type VehicleParts } from './VehicleQueue';

export interface TricycleQueueOptions {
  counter: Counter;
  cash: CashPile;
}

/** Tray-floor centre offset along the trike's length: root.z = (cargo z) + this. */
const TRAY_OFFSET = 0.6;

export class TricycleQueue extends VehicleQueue {
  constructor(
    ctx: GameContext,
    readonly opts: TricycleQueueOptions,
  ) {
    const T = LAYOUT.tricycles;
    super(ctx, opts.counter, opts.cash, {
      kind: 'crate',
      buyer: 'tricycle',
      icon: 'crate',
      product: 'crate',
      unitPrice: ECONOMY.cratePrice,
      demand: (d) => ({ gap: d.trikeGap, want: d.trikeWant }),
      maxWant: 8,
      maxQueue: T.maxQueue,
      driveSpeed: T.driveSpeed,
      spawnU: T.spawnZ,
      exitU: T.exitZ,
      slotU: (i) => T.frontZ + TRAY_OFFSET - i * T.spacing,
      takeInterval: TIMING.npcTakeInterval * 1.3,
      accel: 7,
      decel: 9,
      variants: 1,
      idPrefix: 'npc:tricycle',
      cargoGrid: T.cargoGrid,
      bubbleScale: 1.15,
      rushScaled: true,
    });
  }

  protected buildParts(variant: number): VehicleParts {
    const { model, rig } = createTricycleWithRider(variant);
    return {
      root: model.root,
      body: model.body,
      wheels: model.wheels,
      wheelRadius: TRIKE_WHEEL_RADIUS,
      spinAxis: 'x',
      pitchAxis: 'x',
      cargoParent: model.cargoPivot,
      bubbleY: model.bubbleY,
      rig,
    };
  }

  protected pose(v: Vehicle): void {
    v.parts.root.position.set(LAYOUT.tricycles.laneX, 0, v.u);
  }

  protected recordSale(v: Vehicle): void {
    const stats = this.ctx.state.stats;
    stats.cratesSold += v.want;
    stats.tricyclesServed++;
  }

  /** True while the front trike is parked at the counter wanting crates. */
  get frontLoading(): boolean {
    const v = this.queue[0];
    return !!v && v.mode === 'queue' && v.atSlot;
  }
}
