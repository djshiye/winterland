/**
 * [MAIN] Gameplay composition root: creates every station / NPC system at its layout position and
 * builds what each upgrade pad unlocks. Owned by the main session.
 *
 * Split of responsibilities:
 * - Level (this file): construction + the *effects* of unlocks (applyUnlock, idempotent).
 * - UpgradePad: payment + the unlock moment; emits 'pad:unlocked'.
 * - Progression: *when* pads appear, phases, intro cinematic, tutorial guide, camera moments.
 */
import * as THREE from 'three';
import { CAMERA, LAYOUT, PADS, type PadIdConst, type XZ } from '../config';
import type { GameContext, PadId } from '../core/types';
import { Crew } from '../npc/Crew';
import { CustomerQueue } from '../npc/CustomerQueue';
import { TricycleQueue } from '../npc/TricycleQueue';
import { TruckQueue } from '../npc/TruckQueue';
import { Progression } from '../progression/Progression';
import { CashPile } from '../stations/CashPile';
import { Conveyor } from '../stations/Conveyor';
import { Counter } from '../stations/Counter';
import { DropZone } from '../stations/DropZone';
import { GiantLog } from '../stations/GiantLog';
import { Harvester } from '../stations/Harvester';
import { MegaSaw } from '../stations/MegaSaw';
import { Processor } from '../stations/Processor';
import { ShopMat } from '../stations/ShopMat';
import { UpgradePad } from '../stations/UpgradePad';
import { Village } from '../village/Village';

export class Level {
  readonly dropZone: DropZone;
  readonly giantLog: GiantLog;
  readonly walkInCounter: Counter;
  readonly walkInCash: CashPile;
  readonly customers: CustomerQueue;
  readonly pads: Record<PadId, UpgradePad>;
  /** Cabin doormat that opens the upgrade shop. */
  readonly shopMat: ShopMat;
  readonly village: Village;
  readonly crew: Crew;
  readonly progression: Progression;

  harvester: Harvester | null = null;
  processor: Processor | null = null;
  seCounter: Counter | null = null;
  seCash: CashPile | null = null;
  tricycles: TricycleQueue | null = null;
  westConveyor: Conveyor | null = null;
  eastConveyor: Conveyor | null = null;
  megaSaw: MegaSaw | null = null;
  truckCounter: Counter | null = null;
  truckCash: CashPile | null = null;
  trucks: TruckQueue | null = null;

  /** Pads whose station exists (built live, or at once from a restored state). */
  private readonly built = new Set<PadId>();

  constructor(readonly ctx: GameContext) {
    // Level reacts to unlocks before Progression does (Progression reads ctx.state.unlocked).
    ctx.events.on('pad:unlocked', ({ id }) => this.applyUnlock(id));

    this.dropZone = new DropZone(ctx);
    this.giantLog = new GiantLog(ctx, { dropZone: this.dropZone });

    const wc = LAYOUT.walkInCounter;
    this.walkInCounter = new Counter(ctx, {
      id: 'counter:walkIn',
      x: wc.x,
      z: wc.z,
      length: wc.length,
      depth: wc.depth,
      height: wc.height,
      rotationY: wc.rotationY,
      // Logs are delivered; each one becomes a plank bundle on landing. Customers buy planks.
      accepts: 'log',
      display: 'plank',
      grid: wc.grid,
      playerZone: wc.playerZone,
    });
    const wcash = LAYOUT.walkInCash;
    this.walkInCash = new CashPile(ctx, { id: 'pile:walkInCash', x: wcash.x, z: wcash.z, grid: wcash.grid, zone: wcash.zone });
    this.customers = new CustomerQueue(ctx, { counter: this.walkInCounter, cash: this.walkInCash });

    const pads = {} as Record<PadId, UpgradePad>;
    for (const id of Object.keys(PADS) as PadIdConst[]) pads[id] = new UpgradePad(ctx, PADS[id]);
    this.pads = pads;

    // A restored game: every unlocked station at once, silently, in unlock order.
    for (const id of Object.keys(PADS) as PadIdConst[]) if (ctx.state.unlocked[id]) this.buildStation(id, true);

    this.shopMat = new ShopMat(ctx);
    this.village = new Village(ctx);
    this.crew = new Crew(ctx, this);
    this.progression = new Progression(ctx, this);
  }

  start(): void {
    this.progression.start();
  }

  update(dt: number): void {
    this.dropZone.update(dt);
    this.giantLog.update(dt);
    this.customers.update(dt);
    for (const id in this.pads) this.pads[id as PadId].update(dt);
    this.harvester?.update(dt);
    this.processor?.update(dt);
    this.tricycles?.update(dt);
    this.westConveyor?.update(dt);
    this.eastConveyor?.update(dt);
    this.megaSaw?.update(dt);
    this.trucks?.update(dt);
    this.shopMat.update(dt);
    this.village.update(dt);
    this.crew.update(dt);
    this.progression.update(dt);
  }

  /** Build whatever pad `id` unlocks. Idempotent; called from the 'pad:unlocked' event. */
  applyUnlock(id: PadId): void {
    this.ctx.state.unlocked[id] = true;
    this.buildStation(id, false);
  }

  /** Station(s) of pad `id`. instant (restore): final state at once, no animation / events / camera. */
  private buildStation(id: PadId, instant: boolean): void {
    if (this.built.has(id)) return;
    this.built.add(id);
    switch (id) {
      case 'harvester':
        this.harvester = new Harvester(this.ctx, { log: this.giantLog });
        this.harvester.build(instant);
        break;
      case 'processor':
        this.ensureProcessor(instant);
        break;
      case 'westConveyor':
        this.westConveyor = new Conveyor(this.ctx, {
          id: 'conveyor:west',
          ...LAYOUT.westConveyor,
          from: this.dropZone.pile,
          to: this.walkInCounter.input,
          kind: 'log',
          itemYaw: 0,
        });
        this.westConveyor.build(instant);
        break;
      case 'eastConveyor': {
        const processor = this.ensureProcessor(instant);
        this.eastConveyor = new Conveyor(this.ctx, {
          id: 'conveyor:east',
          ...LAYOUT.eastConveyor,
          from: this.dropZone.pile,
          to: processor.input,
          kind: 'log',
          itemYaw: Math.PI / 2,
        });
        this.eastConveyor.build(instant);
        break;
      }
      case 'megaSaw':
        this.buildExpansion(instant);
        break;
    }
  }

  /** Processor + SE counter + SE cash pile + tricycle queue (built together by the processor pad). */
  private ensureProcessor(instant: boolean): Processor {
    if (this.processor) return this.processor;
    if (!this.ctx.state.unlocked.processor) {
      // Unlocking the pad re-enters applyUnlock('processor') synchronously, which builds it.
      this.pads.processor.forceUnlock();
      if (this.processor) return this.processor;
    }
    this.built.add('processor');
    const ctx = this.ctx;
    const processor = new Processor(ctx);
    processor.build(instant);
    this.processor = processor;
    const se = LAYOUT.seCounter;
    this.seCounter = new Counter(ctx, {
      id: 'counter:se',
      x: se.x,
      z: se.z,
      length: se.length,
      depth: se.depth,
      height: se.height,
      rotationY: se.rotationY,
      accepts: 'crate',
      grid: se.grid,
      playerZone: se.playerZone,
    });
    this.seCounter.appear(instant);
    const sc = LAYOUT.seCash;
    this.seCash = new CashPile(ctx, { id: 'pile:seCash', x: sc.x, z: sc.z, grid: sc.grid, zone: sc.zone });
    this.tricycles = new TricycleQueue(ctx, { counter: this.seCounter, cash: this.seCash });
    return processor;
  }

  /** Phase 5: mega saw, yard expansion north, trucks on the highway, camera zooms out. */
  private buildExpansion(instant: boolean): void {
    const ctx = this.ctx;
    this.megaSaw = new MegaSaw(ctx, { log: this.giantLog });
    this.megaSaw.build(instant);
    ctx.state.expanded = true;
    if (!instant) ctx.events.emit('expansion:start', {});
    ctx.environment.expand(instant);
    ctx.cameraRig.setZoom(CAMERA.expansionZoom, instant ? 0 : 1.6);
    const ex = LAYOUT.expansion;
    const tc = ex.truckCounter;
    this.truckCounter = new Counter(ctx, {
      id: 'counter:truck',
      x: tc.x,
      z: tc.z,
      length: tc.length,
      depth: tc.depth,
      height: tc.height,
      rotationY: tc.rotationY,
      accepts: 'log',
      grid: tc.grid,
      playerZone: tc.playerZone,
    });
    this.truckCounter.appear(instant);
    const tcash = ex.truckCash;
    this.truckCash = new CashPile(ctx, { id: 'pile:truckCash', x: tcash.x, z: tcash.z, grid: tcash.grid, zone: tcash.zone });
    this.trucks = new TruckQueue(ctx, { counter: this.truckCounter, cash: this.truckCash });
  }

  /** Where the thing pad `id` builds stands (camera moments, guide arrows). */
  anchorOf(id: PadId, out = new THREE.Vector3()): THREE.Vector3 {
    switch (id) {
      case 'harvester':
        return out.set(LAYOUT.harvester.railX, 0, (LAYOUT.harvester.minTravelZ + LAYOUT.harvester.maxTravelZ) / 2);
      case 'processor':
        return out.set(LAYOUT.processor.x, 0, LAYOUT.processor.z);
      case 'westConveyor':
        return pathMidpoint(LAYOUT.westConveyor.path, out);
      case 'eastConveyor':
        return pathMidpoint(LAYOUT.eastConveyor.path, out);
      case 'megaSaw':
        return out.set(LAYOUT.megaSaw.x, 0, LAYOUT.megaSaw.z);
    }
  }

  skipIntro(): void {
    this.progression.skipIntro();
  }

  forceUnlock(id: PadId): void {
    this.pads[id].forceUnlock();
  }

  snapshot(): Record<string, unknown> {
    const remaining: Partial<Record<PadId, number>> = {};
    for (const id in this.pads) remaining[id as PadId] = this.pads[id as PadId].remaining;
    return {
      dropZone: this.dropZone.pile.count(),
      walkInCounter: this.walkInCounter.pile.count(),
      walkInCash: this.walkInCash.value,
      customersWaiting: this.customers.waiting,
      hopper: this.processor?.input.count() ?? null,
      processorOut: this.processor?.output.count() ?? null,
      seCounter: this.seCounter?.pile.count() ?? null,
      seCash: this.seCash?.value ?? null,
      tricyclesWaiting: this.tricycles?.waiting ?? null,
      westBelt: this.westConveyor?.load ?? null,
      eastBelt: this.eastConveyor?.load ?? null,
      truckCounter: this.truckCounter?.pile.count() ?? null,
      truckCash: this.truckCash?.value ?? null,
      padsRemaining: remaining,
    };
  }
}

/** Midpoint between a path's first and last points. */
function pathMidpoint(path: readonly XZ[], out: THREE.Vector3): THREE.Vector3 {
  const a = path[0]!;
  const b = path[path.length - 1]!;
  return out.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
}
