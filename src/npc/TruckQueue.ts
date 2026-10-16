/**
 * [B5 — commerce] Phase 5: red/blue pickup trucks queueing on the north highway for bulk log orders.
 *
 * Spec: "expands the yard northward toward the highway with pickup trucks waiting for bulk orders."
 *
 * Model: AssetFactory createPickupTruck (assets/vehicles.ts, red / blue alternating) with a seated
 * createCharacterRig('driver') in the open cab. Behaviour (LAYOUT.expansion.trucks, DEMAND truckGap / truckWant,
 * ECONOMY.truckLogPrice) lives in npc/VehicleQueue.ts: trucks spawn at (spawnX, laneZ) on the tunnel side, drive −X
 * (y from ctx.environment.highwayY every frame, pitched along the bridge ramps) to slot i (the front
 * truck's bed lines up with the truck counter), show a log bubble ("0/10"), load RAW LOGS from counter.pile
 * into the bed, pay want · truckLogPrice, emit 'sale' { buyer: 'truck', kind: 'log' }, honk-bounce, drive
 * off −X to exitX and return to the pool.
 */
import { ECONOMY, LAYOUT, PALETTE, TIMING } from '../config';
import type { GameContext } from '../core/types';
import { createPickupTruckWithDriver, TRUCK_BED_X, TRUCK_WHEEL_RADIUS } from '../assets/vehicles';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';
import { Vehicle, VehicleQueue, type VehicleParts } from './VehicleQueue';

export interface TruckQueueOptions {
  counter: Counter;
  cash: CashPile;
}

/** Wheel contact points along the truck (local X) used to pitch it on the bridge ramps. */
const FRONT_WHEEL_X = -1.05;
const REAR_WHEEL_X = 1.2;

export class TruckQueue extends VehicleQueue {
  constructor(
    ctx: GameContext,
    readonly opts: TruckQueueOptions,
  ) {
    const T = LAYOUT.expansion.trucks;
    super(ctx, opts.counter, opts.cash, {
      kind: 'log',
      buyer: 'truck',
      icon: 'log',
      product: 'log',
      unitPrice: ECONOMY.truckLogPrice,
      demand: (d) => ({ gap: d.truckGap, want: d.truckWant }),
      maxWant: 20,
      maxQueue: T.maxQueue,
      driveSpeed: T.driveSpeed,
      // travel coordinate u = −x (trucks drive −X)
      spawnU: -T.spawnX,
      exitU: -T.exitX,
      slotU: (i) => -(T.frontX - TRUCK_BED_X + i * T.spacing),
      takeInterval: TIMING.dockTakeInterval,
      boost: () => ctx.upgrades.value('truckDock'),
      accel: 6,
      decel: 8,
      variants: 2,
      idPrefix: 'npc:truck',
      cargoGrid: LAYOUT.expansion.trucks.bedGrid,
      bubbleScale: 1.3,
    });
  }

  protected buildParts(variant: number): VehicleParts {
    const { model, rig } = createPickupTruckWithDriver(variant % 2 === 0 ? PALETTE.truckRed : PALETTE.truckBlue, variant);
    return {
      root: model.root,
      body: model.body,
      wheels: model.wheels,
      wheelRadius: TRUCK_WHEEL_RADIUS,
      spinAxis: 'z',
      pitchAxis: 'z',
      cargoParent: model.bedPivot,
      bubbleY: model.bubbleY,
      rig,
    };
  }

  protected pose(v: Vehicle): void {
    const env = this.ctx.environment;
    const x = -v.u;
    const yFront = env.highwayY(x + FRONT_WHEEL_X);
    const yRear = env.highwayY(x + REAR_WHEEL_X);
    const k = -FRONT_WHEEL_X / (REAR_WHEEL_X - FRONT_WHEEL_X);
    const root = v.parts.root;
    root.position.set(x, yFront + (yRear - yFront) * k, LAYOUT.expansion.trucks.laneZ);
    root.rotation.z = Math.atan2(yRear - yFront, REAR_WHEEL_X - FRONT_WHEEL_X);
  }

  protected recordSale(v: Vehicle): void {
    const stats = this.ctx.state.stats;
    stats.logsSold += v.want;
    stats.trucksServed++;
    // honk-ish bounce
    this.ctx.tweens.squash(v.parts.body, 0.12, 0.4);
  }
}

