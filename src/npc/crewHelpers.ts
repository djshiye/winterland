/**
 * [B5 — crew] The three hired helpers ('worker' characters) behind npc/Crew.ts. Each one is a small state machine
 * that walks scripted waypoint routes (no colliders; conveyors and pads are walkable) and moves items only through
 * items/transfer.ts. Speed, capacity and transfer cadence are read live from ctx.upgrades.value(id), so a level-up
 * applies at once.
 *
 * - CrateRunner: processor bench (level.processor.output) → SE counter (level.seCounter.input) → back.
 * - Cashier: the richest cash pile → cabin door, where the bundles fly into a DepositSink (money += value).
 * - LogHauler: drop-zone pile → truck counter (when it exists and has room) else the walk-in counter. It never
 *   touches the Timber Ridge log deck.
 * - PineHauler: Timber Ridge log deck (level.treeFeller.deck) → platform counter (level.platformCounter.input).
 *   Rests near the quarters while the deck is empty. It never touches the drop zone.
 * - Porter (wave 9): keeps the Market Town shops stocked: producer pallets (wheat, meat) → shop hoppers, drop-zone
 *   firewood → shops short of logs, bench crates → the toy factory. Pure job choice in npc/townJobs.ts, routes
 *   (yard → village gate → street → corridor → square, around the square's props) in npc/townRoutes.ts. The cashiers
 *   also collect the town tills along the same routes.
 *
 * Several helpers of one role may work (core/crew.ts crewSlots): each has an `index`, a small lane offset on its
 * posts, a staggered start, and `peers` (the role's helpers) so cashiers do not pile onto the same cash pile.
 */
import * as THREE from 'three';
import { CREW, LAYOUT, PLAYER, PRIORITIES, type Rect, type TownPriority, type WoodPriority, type XZ } from '../config';
import { approach, dampAngle, yawFromDir } from '../core/math';
import type { CrewRole } from '../core/crew';
import { PORTER_VARIANT, characterScale } from '../assets/characters';
import { createWorkerModel } from '../assets/eraWorkers';
import { LOT_COUNT, type GameContext, type Item, type ItemHolder, type ItemKind, type Slot } from '../core/types';
import { CarryStack } from '../items/CarryStack';
import { transferOne } from '../items/transfer';
import { CharacterRig } from '../render/characters';
import type { Level } from '../level/Level';
import type { CashPile } from '../stations/CashPile';
import type { Business } from '../town/Business';
import { hopperPerKind } from '../town/rules';
import { destKey, favouredShop, pickJob, pickShop, type Claims, type PorterJob, type ShopView, type SourceView } from './townJobs';
import {
  BENCH_LEG,
  CABIN_LEG,
  CLEARANCE,
  DROP_LEG,
  ENTRY,
  TRUNK,
  planSquare,
  TILL_SHIFT,
  travel,
  zoneStand,
  type Stop,
} from './townRoutes';

export type CrewId = CrewRole;
export const CREW_IDS: readonly CrewId[] = ['crateRunner', 'cashier', 'logHauler', 'pineHauler', 'porter', 'sledLoader', 'foreman'];

const ACCEL = 12;
const TURN_LAMBDA = 12;
/** Base seconds between two item moves at work multiplier 1 (divided by the multiplier). */
const BASE_INTERVAL = 0.11;
/** Seconds without new work before a partly loaded helper sets off anyway. */
const PATIENCE = 1.1;
/** Seconds a helper waits at a full destination before giving up and walking back. */
const BLOCKED_GIVE_UP = 3;
const FLY = { duration: 0.2, arcHeight: 1.4 } as const;

// --- scripted routes ------------------------------------------------------------------------
const DOOR = LAYOUT.shop.door;
/** Where each helper waits, plus the point it faces there. */
const BENCH_POST: XZ = { x: 5.95, z: 0.85 };
const BENCH_LOOK: XZ = { x: 5.95, z: -0.4 };
const SE_POST: XZ = { x: 9.0, z: 3.4 };
const SE_LOOK: XZ = { x: 9.9, z: 3.6 };
const CASHIER_HOME: XZ = { x: 7.0, z: -5.0 };
const DOOR_LOOK: XZ = { x: 7.0, z: -6.4 };
const DROP_POST: XZ = { x: -3.0, z: 1.4 };
const DROP_LOOK: XZ = { x: -5.2, z: -0.4 };
const WALKIN_POST: XZ = { x: -4.0, z: 8.6 };
const WALKIN_LOOK: XZ = { x: -4.0, z: 9.9 };
const TRUCK_POST: XZ = { x: 1.0, z: -18.8 };
const TRUCK_LOOK: XZ = { x: 1.0, z: -19.9 };

// --- Timber Ridge: the crossing / gate come from LAYOUT.ridge so a layout change moves the routes -----------------
const RIDGE = LAYOUT.ridge;
const GATE_Z = (RIDGE.gate.minZ + RIDGE.gate.maxZ) / 2;
const CROSS = RIDGE.walk[0]!;
const CROSS_Z = (CROSS.minZ + CROSS.maxZ) / 2;
/** Cabin door → through the east-fence gate → across the road → onto the ridge. */
const TO_RIDGE: XZ[] = [
  { x: 8.6, z: -3.4 },
  { x: LAYOUT.yard.maxX - 0.8, z: GATE_Z },
  { x: CROSS.maxX - 0.2, z: CROSS_Z },
  { x: RIDGE.walk[1]!.minX + 1.4, z: CROSS_Z },
];
/** Rest point beside the quarters, and where the deck / platform are worked from. */
const PINE_HOME: XZ = { x: 20.0, z: 3.5 };
const PINE_HOME_LOOK: XZ = { x: RIDGE.quarters.x + RIDGE.quarters.w / 2, z: RIDGE.quarters.z };
const PINE_JUNCTION: XZ = { x: 21.4, z: -1.2 };
/**
 * Wave 8: the pocket south of the bunkhouse, west of the workshop hopper zone (x 21.3-22.5, z 2.3-4.1), is the only
 * free spot. PINE_HOME with its +/-0.8 lane offsets (19.23, 3.27) / (20.77, 3.73) keeps >= 0.45 m off the workshop,
 * the hopper and bench zones, the sled counter + its zone, the sled cash pile, the workshop pad and the bunkhouse
 * pad. The approach point keeps the walk from the junction off the bunkhouse's south-east corner.
 */
const PINE_APPROACH: XZ = { x: 21.0, z: 3.0 };
const DECK_POST: XZ = { x: RIDGE.deck.x, z: RIDGE.deck.z + 1.4 };
const DECK_LOOK: XZ = { x: RIDGE.deck.x, z: RIDGE.deck.z };
const PLATFORM_POST: XZ = { x: RIDGE.platform.playerZone.minX + 0.4, z: RIDGE.platform.z };
const PLATFORM_LOOK: XZ = { x: RIDGE.platform.x, z: RIDGE.platform.z };
/** North of the workshop pad (x 24-26, z -0.1..1.9): the haul route keeps >= 0.25 m off the tile. */
const PAD_BYPASS: XZ = { x: 27.0, z: -1.2 };
const DECK_TO_PLATFORM: XZ[] = [PINE_JUNCTION, PAD_BYPASS, PLATFORM_POST];
/** Wave 11: the workshop route stops at the pocket west of the hopper zone (x 21.3-22.5) and faces the hopper. */
const DECK_TO_HOPPER: XZ[] = [PINE_JUNCTION, PINE_APPROACH];
const HOPPER_LOOK: XZ = { x: LAYOUT.ridge.workshop.hopper.x, z: PINE_APPROACH.z };

// --- Market Town: the porters' home on the square, beside the corridor mouth (clear of every zone and queue) ------
const TOWN = LAYOUT.town;
export const PORTER_HOME: XZ = { x: 18.2, z: 28.4 };
const PORTER_LOOK: XZ = { x: TOWN.tree.x, z: TOWN.tree.z };
/** Cabin door → gate → street → corridor → square → home. */
const PORTER_ROUTE: XZ[] = [...CABIN_LEG, ...TRUNK, PORTER_HOME];

// --- Wave 11: sled loader (east of the workshop bench, north of the sled lane) and foreman (yard, by the village gate)
/** Builders of the two roles verify these spots are clear of the bench / sled counter / sled cash zones and the fences. */
export const SLED_LOADER_HOME: XZ = { x: 29.6, z: 5.0 };
export const SLED_LOADER_LOOK: XZ = { x: 27.3, z: 3.2 };
const SLED_LOADER_ROUTE: XZ[] = [...TO_RIDGE, PINE_JUNCTION, PAD_BYPASS, { x: 29.6, z: 1.0 }, SLED_LOADER_HOME];
export const FOREMAN_HOME: XZ = { x: 2.4, z: 8.4 };
export const FOREMAN_LOOK: XZ = { x: 4.6, z: 10.4 };
const FOREMAN_ROUTE: XZ[] = [{ x: 7.4, z: -2.0 }, { x: 4.0, z: 4.0 }, FOREMAN_HOME];

/** Door → home post, used when a helper is hired. */
const HOME_ROUTE: Record<CrewId, XZ[]> = {
  crateRunner: [{ x: 7.4, z: -2.0 }, { x: 7.4, z: 0.85 }, BENCH_POST],
  cashier: [CASHIER_HOME],
  logHauler: [{ x: 4.8, z: -5.3 }, { x: -1.5, z: -4.6 }, DROP_POST],
  pineHauler: [...TO_RIDGE, PINE_JUNCTION, PINE_APPROACH, PINE_HOME],
  porter: PORTER_ROUTE,
  sledLoader: SLED_LOADER_ROUTE,
  foreman: FOREMAN_ROUTE,
};
const HOME: Record<CrewId, XZ> = {
  crateRunner: BENCH_POST,
  cashier: CASHIER_HOME,
  logHauler: DROP_POST,
  pineHauler: PINE_HOME,
  porter: PORTER_HOME,
  sledLoader: SLED_LOADER_HOME,
  foreman: FOREMAN_HOME,
};
const HOME_LOOK: Record<CrewId, XZ> = {
  crateRunner: BENCH_LOOK,
  cashier: DOOR_LOOK,
  logHauler: DROP_LOOK,
  pineHauler: PINE_HOME_LOOK,
  porter: PORTER_LOOK,
  sledLoader: SLED_LOADER_LOOK,
  foreman: FOREMAN_LOOK,
};
/** Base character variant per role (the index shifts it so twins look different). */
const VARIANT: Record<CrewId, number> = { crateRunner: 0, cashier: 1, logHauler: 2, pineHauler: 1, porter: PORTER_VARIANT, sledLoader: 2, foreman: 0 };
/**
 * Lane steps for the 1st…4th helper of a role (metres). Every post is registered with the point its worker faces;
 * the helper stands beside the post along the line perpendicular to that look direction, so a second helper
 * never ends up inside the counter it works at. Intermediate waypoints are shared.
 */
const LANE_STEP = [0, 0.8, -0.8, 1.6] as const;
const POST_LOOK = new WeakMap<XZ, XZ>();
function registerPost(post: XZ, look: XZ): void {
  POST_LOOK.set(post, look);
}
registerPost(BENCH_POST, BENCH_LOOK);
registerPost(SE_POST, SE_LOOK);
registerPost(CASHIER_HOME, DOOR_LOOK);
registerPost(DROP_POST, DROP_LOOK);
registerPost(WALKIN_POST, WALKIN_LOOK);
registerPost(TRUCK_POST, TRUCK_LOOK);
registerPost(PINE_HOME, PINE_HOME_LOOK);
registerPost(SLED_LOADER_HOME, SLED_LOADER_LOOK);
registerPost(FOREMAN_HOME, FOREMAN_LOOK);
registerPost(DECK_POST, DECK_LOOK);
registerPost(PLATFORM_POST, PLATFORM_LOOK);
registerPost(PORTER_HOME, PORTER_LOOK);

// --- the deposit sink ---------------------------------------------------------------------------
/** Where the cashier's bundles land: the cabin door. receive() banks the value and recycles the bundle. */
export class DepositSink implements ItemHolder {
  readonly id = 'npc:crew:deposit';
  constructor(readonly ctx: GameContext) {}
  canAccept(kind: ItemKind): boolean {
    return kind === 'cash';
  }
  reserve(_item: Item): Slot {
    return { holder: this };
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.set(DOOR.x, 1.1, DOOR.z - 0.2);
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }
  receive(item: Item, _slot: Slot): void {
    this.ctx.economy.add(item.value);
    this.ctx.items.release(item);
  }
  cancel(_slot: Slot): void {}
  count(_kind?: ItemKind): number {
    return 0;
  }
  take(_kind?: ItemKind): Item | null {
    return null;
  }
}

// --- base helper ---------------------------------------------------------------------------------
export abstract class Helper {
  readonly group = new THREE.Group();
  readonly rig: CharacterRig;
  readonly stack: CarryStack;
  protected readonly velocity = new THREE.Vector3();
  protected yaw = Math.PI;
  protected speed = 0;
  protected route: XZ[] = [];
  protected routeIdx = 0;
  protected look: XZ | null = null;
  /** Cadence timer between item moves. */
  protected timer = 0;
  /** Seconds since the last useful action (patience). */
  protected idle = 0;
  protected blocked = 0;
  private capacityNow = -1;
  /** The role's other helpers (the same array for all of them, includes this one). Set by Crew. */
  peers: readonly Helper[] = [];
  /** Walk-out delay: invisible and frozen until it runs out, then `onRelease` fires (staggered arrivals). */
  hold = 0;
  private disposing = false;
  /** 0.9.8: stack size last frame and seconds of work motion left (goods changed hands at a station). */
  private handled = 0;
  private workT = 0;
  private gone = false;
  onRelease: (() => void) | null = null;
  /** Metres along the lane line (perpendicular to the post's look direction) this helper stands off the post. */
  protected readonly laneStep: number;

  constructor(
    readonly ctx: GameContext,
    readonly level: Level,
    readonly id: CrewId,
    readonly index: number,
    accepts: readonly ItemKind[],
  ) {
    // 0.9.8: each crew wears its role kit (assets/characters.ts CREW_ROLE_KIT); the index varies skin, hair and face
    this.rig = new CharacterRig(createWorkerModel(index + VARIANT[id], id), { scale: characterScale(VARIANT[id] + index + 307) });
    this.laneStep = LANE_STEP[Math.min(index, LANE_STEP.length - 1)]!;
    this.group.add(this.rig.root);
    this.group.name = index === 0 ? `crew:${id}` : `crew:${id}:${index}`;
    this.stack = new CarryStack(ctx, {
      id: index === 0 ? `npc:crew:${id}` : `npc:crew:${id}:${index}`,
      accepts,
      capacity: 1,
      anchor: this.rig.armsAnchor,
    });
    // stagger: later helpers start their cadence and patience a little behind the first
    this.timer = index * 0.07;
    this.idle = -index * 0.45;
    this.applyLevel();
    ctx.scene.add(this.group);
  }

  /** Work multiplier (0 = not hired). */
  get mult(): number {
    return this.ctx.upgrades.value(this.id);
  }

  /** Walk / capacity / cadence factors, each clamped past the authored table (Upgrades.crewStats). */
  protected get stats(): { walk: number; capacity: number; cadence: number } {
    return this.ctx.upgrades.crewStats(this.id);
  }

  protected get interval(): number {
    return BASE_INTERVAL / this.stats.cadence;
  }

  protected get capacity(): number {
    return Math.max(1, Math.floor(CREW[this.id].capacity * this.stats.capacity));
  }

  get moving(): boolean {
    return this.routeIdx < this.route.length;
  }

  /** The post shifted along its lane line (unchanged for index 0 or an unregistered point). */
  protected lanePoint(p: XZ, look: XZ | null = POST_LOOK.get(p) ?? null): XZ {
    if (!look || this.laneStep === 0) return p;
    const dx = look.x - p.x;
    const dz = look.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dz / len) * this.laneStep, z: p.z - (dx / len) * this.laneStep };
  }

  placeAt(p: XZ, look: XZ | null, lane = true): void {
    const q = lane ? this.lanePoint(p, look) : p;
    this.group.position.set(q.x, 0, q.z);
    this.look = look;
    if (look) this.yaw = yawFromDir(look.x - this.group.position.x, look.z - this.group.position.z);
    this.rig.root.rotation.y = this.yaw;
  }

  /** Walk the given waypoints (the last one is an eased stop; a registered post is shifted onto this helper's lane). */
  go(points: readonly XZ[]): void {
    this.route = points.map((p) => this.lanePoint(p));
    this.routeIdx = 0;
    this.look = null;
  }

  goReverse(points: readonly XZ[], end: XZ): void {
    this.go([...points].reverse().concat([end]));
  }

  update(dt: number): void {
    if (dt <= 0 || this.gone) return;
    if (this.disposing) {
      this.stack.update(dt, this.velocity);
      this.rig.animate(dt, 0);
      if (this.settled) this.finishDispose();
      return;
    }
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.group.visible = true;
        this.onRelease?.();
        this.onRelease = null;
      }
      return;
    }
    this.applyLevel();
    this.timer -= dt;
    this.think(dt);
    this.step(dt);
    // 0.9.8: handing goods on or off at a station plays the role's work motion
    if (this.stack.size !== this.handled) this.workT = 0.8;
    this.handled = this.stack.size;
    this.workT -= dt;
    this.rig.setWorking(this.workT > 0 && !this.moving);
    this.rig.setCarrying(this.stack.size > 0);
    this.rig.animate(dt, this.speed / PLAYER.speed);
    this.stack.update(dt, this.velocity);
  }

  /**
   * Leave the world. Items still flying to the hands would re-add themselves to a detached stack (CarryStack.receive)
   * and leak, so the helper stops working and lingers until every inflight item has landed; the owner keeps calling
   * update() until `disposed`.
   */
  dispose(): void {
    this.disposing = true;
    this.route = [];
    this.routeIdx = 0;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    if (this.hold > 0 || this.settled) this.finishDispose();
  }

  /** True once a disposed helper is fully gone (nothing in flight, stack released, removed from the scene). */
  get disposed(): boolean {
    return this.gone;
  }

  private finishDispose(): void {
    this.stack.clear();
    this.group.removeFromParent();
    this.gone = true;
  }

  protected abstract think(dt: number): void;

  private applyLevel(): void {
    const cap = this.capacity;
    if (cap !== this.capacityNow) {
      this.capacityNow = cap;
      this.stack.setCapacity(cap);
    }
  }

  /** Fly one item between holders at this helper's pace; true if one moved. */
  protected move(from: ItemHolder, to: ItemHolder, kind: ItemKind): boolean {
    if (this.timer > 0) return false;
    if (!transferOne(this.ctx, from, to, [kind], FLY)) return false;
    this.timer = this.interval;
    this.idle = 0;
    return true;
  }

  /** Nothing in flight in the hands: size counts reservations, count() only landed items. */
  protected get settled(): boolean {
    return this.stack.size === this.stack.count();
  }

  private step(dt: number): void {
    const p = this.group.position;
    this.velocity.set(0, 0, 0);
    if (this.moving) {
      const last = this.routeIdx === this.route.length - 1;
      const goal = this.route[this.routeIdx]!;
      const dx = goal.x - p.x;
      const dz = goal.z - p.z;
      const dist = Math.hypot(dx, dz);
      const max = CREW[this.id].walkSpeed * this.stats.walk;
      const target = last ? Math.min(max, 1.2 + dist * 4) : max;
      this.speed = approach(this.speed, target, ACCEL * dt);
      const stepLen = this.speed * dt;
      if (dist < 0.02 || stepLen >= dist) {
        p.x = goal.x;
        p.z = goal.z;
        this.routeIdx++;
        if (last) this.speed = 0;
        this.velocity.set(0, 0, 0);
      } else {
        const nx = dx / dist;
        const nz = dz / dist;
        p.x += nx * stepLen;
        p.z += nz * stepLen;
        this.velocity.set(nx * this.speed, 0, nz * this.speed);
        this.yaw = dampAngle(this.yaw, yawFromDir(dx, dz), TURN_LAMBDA, dt);
      }
    } else {
      this.speed = 0;
      if (this.look) this.yaw = dampAngle(this.yaw, yawFromDir(this.look.x - p.x, this.look.z - p.z), TURN_LAMBDA, dt);
    }
    this.rig.root.rotation.y = this.yaw;
  }
}

// --- crate runner --------------------------------------------------------------------------------
type RunnerPhase = 'load' | 'go' | 'unload' | 'return';
const RUNNER_ROUTE: XZ[] = [SE_POST];

export class CrateRunner extends Helper {
  private phase: RunnerPhase = 'load';

  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'crateRunner', index, ['crate']);
  }

  protected think(dt: number): void {
    const counter = this.level.seCounter;
    switch (this.phase) {
      case 'load': {
        this.look = BENCH_LOOK;
        if (this.moving) return; // still walking to the bench
        const out = this.level.processor?.output;
        if (out && out.count('crate') > 0 && this.move(out, this.stack, 'crate')) return;
        this.idle += dt;
        const has = this.stack.count('crate') > 0;
        if (has && counter && counter.input.canAccept('crate') && this.settled && (this.stack.size >= this.capacity || this.idle > PATIENCE)) {
          this.go(RUNNER_ROUTE);
          this.phase = 'go';
        }
        return;
      }
      case 'go':
        if (this.moving) return;
        this.look = SE_LOOK;
        this.phase = 'unload';
        this.blocked = 0;
        return;
      case 'unload': {
        if (this.stack.size === 0) {
          this.goReverse([], BENCH_POST);
          this.phase = 'return';
          return;
        }
        if (counter && this.stack.count('crate') > 0 && counter.input.canAccept('crate')) {
          this.blocked = 0;
          this.move(this.stack, counter.input, 'crate');
        } else if (this.settled) {
          this.blocked += dt;
          if (this.blocked > BLOCKED_GIVE_UP) {
            this.goReverse([], BENCH_POST);
            this.phase = 'return';
            this.idle = -2; // do not set off again at once with the same crates
          }
        }
        return;
      }
      case 'return':
        if (!this.moving) this.phase = 'load';
        return;
    }
  }
}

// --- cashier --------------------------------------------------------------------------------------
type CashierPhase = 'idle' | 'go' | 'collect' | 'back' | 'deposit';

interface PileStop {
  /** Waypoints from the cabin to just before `post` (a getter for the town tills: planned only when chosen). */
  readonly route: XZ[];
  post: XZ;
  look: XZ;
  pile: () => CashPile | null;
}

/** A town till is worth the long walk once it holds at least this much. */
export const TILL_MIN_TRIP = 150;

export class Cashier extends Helper {
  private phase: CashierPhase = 'idle';
  private stop: PileStop | null = null;
  private pickTimer = 0;
  private readonly sink: DepositSink;
  private readonly stops: PileStop[];

  constructor(ctx: GameContext, level: Level, sink: DepositSink, index = 0) {
    super(ctx, level, 'cashier', index, ['cash']);
    this.sink = sink;
    this.stops = [
      {
        route: [{ x: 2.5, z: -4.6 }],
        post: { x: -2.0, z: 7.5 },
        look: { x: -2.0, z: 8.8 },
        pile: () => level.walkInCash,
      },
      {
        // approach from the west along the pile's own row: lane +0.8 stands at x 9.7, and the straight line from the
        // cabin would clip the SE counter's corner (counter box x 9.6-10.2, z 2.8-4.4)
        route: [{ x: 8.4, z: 4.8 }],
        post: { x: 8.9, z: 4.8 },
        look: { x: 8.9, z: 6.0 },
        pile: () => level.seCash,
      },
      {
        route: [{ x: 4.8, z: -5.3 }, { x: 3.4, z: -12 }],
        post: { x: 2.9, z: -17.3 },
        look: { x: 2.9, z: -18.6 },
        pile: () => level.truckCash,
      },
      {
        // Timber Ridge: out through the east gate, over the crossing, along the ridge to the platform.
        route: [...TO_RIDGE, PINE_JUNCTION, PAD_BYPASS],
        post: { x: 30.4, z: 2.3 },
        look: { x: 30.4, z: 3.6 },
        pile: () => level.platformCash,
      },
    ];
    for (const st of this.stops) registerPost(st.post, st.look);
  }

  protected think(dt: number): void {
    switch (this.phase) {
      case 'idle': {
        this.look = DOOR_LOOK;
        if (this.moving) return;
        this.pickTimer -= dt;
        if (this.pickTimer > 0) return;
        this.pickTimer = 0.4;
        const stop = this.pickStop();
        if (!stop) return;
        this.stop = stop;
        this.go([...stop.route, stop.post]);
        this.phase = 'go';
        return;
      }
      case 'go':
        // the pile went away under us (a demolished town till): turn back now, not after the walk
        if (!this.stop!.pile()) {
          this.leave(this.routeIdx);
          return;
        }
        if (this.moving) return;
        this.look = this.stop!.look;
        this.phase = 'collect';
        this.idle = 0;
        return;
      case 'collect': {
        const src = this.stop!.pile();
        if (src && src.pile.count('cash') > 0 && this.move(src.pile, this.stack, 'cash')) return;
        const empty = !src || src.pile.count('cash') === 0;
        if (this.settled && (this.stack.size >= this.capacity || empty)) this.leave();
        return;
      }
      case 'back':
        if (this.moving) return;
        this.look = DOOR_LOOK;
        this.phase = 'deposit';
        return;
      case 'deposit':
        if (this.stack.count('cash') > 0) this.move(this.stack, this.sink, 'cash');
        else if (this.stack.size === 0) this.phase = 'idle';
        return;
    }
  }

  /** Head home back along the stop's route: all of it from the post, only the `passed` waypoints when turning back mid-walk. */
  private leave(passed = this.stop!.route.length): void {
    this.goReverse(this.stop!.route.slice(0, passed), CASHIER_HOME);
    this.phase = 'back';
  }

  /** True while this cashier is on its way to / collecting from `s` (peers skip it). */
  stopOf(s: PileStop): boolean {
    if (!this.stop || (this.phase !== 'go' && this.phase !== 'collect')) return false;
    // every cashier builds its own stop table, so compare the piles, not the stop objects
    const mine = this.stop.pile();
    return mine !== null && mine === s.pile();
  }

  /** Stops for the town tills worth a trip right now (read live: shops are built and tills fill at any time). */
  private townStops(): PileStop[] {
    const out: PileStop[] = [];
    const town = this.level.town;
    for (let lot = 0; lot < LOT_COUNT; lot++) {
      const b = town.business(lot);
      const till = b?.till;
      if (!b || !till || till.value < TILL_MIN_TRIP) continue;
      // stand just in front of the till, toward the square
      const post = zoneStand(till.zone.area, { x: b.frame.fx, z: b.frame.fz }, 0, TILL_SHIFT).p;
      const look: XZ = { x: till.opts.x, z: till.opts.z };
      let route: XZ[] | null = null;
      const blocked = (x: number, z: number): boolean => this.ctx.colliders.overlaps(x, z, CLEARANCE);
      out.push({
        get route(): XZ[] {
          route ??= [...CABIN_LEG, ...TRUNK, ...planSquare(ENTRY, post, blocked).slice(0, -1)];
          return route;
        },
        post,
        look,
        pile: () => (b.dead ? null : till),
      });
    }
    return out;
  }

  /** Richest pile (value, discounted by distance) holding at least two bundles' worth. */
  private pickStop(): PileStop | null {
    let best: PileStop | null = null;
    let bestScore = 0;
    const p = this.group.position;
    for (const s of [...this.stops, ...this.townStops()]) {
      // a pile another cashier is already working is left to it
      if (this.peers.some((o) => o !== this && o instanceof Cashier && o.stopOf(s))) continue;
      const src = s.pile();
      if (!src || src.pile.count('cash') === 0 || src.value < 10) continue;
      const d = Math.hypot(s.post.x - p.x, s.post.z - p.z);
      const score = src.value / (1 + d * 0.04);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }
}

// --- log hauler -----------------------------------------------------------------------------------
type HaulerPhase = 'load' | 'go' | 'unload' | 'return';
export type HaulDest = 'truck' | 'walkIn';

/** A log counter as the hauler sees it: it takes a log now, and the share of its pile that is still free (0..1). */
export interface CounterFill {
  room: boolean;
  free: number;
}

/**
 * Where a log hauler takes a load (pure). 'trucks': the truck counter whenever it has room, else the walk-in counter.
 * 'balanced' (and 'trains' / 'workshop', which only steer the pine hauler): whichever counter has the larger free
 * share first, ties to the truck counter. Null = nowhere has room (a missing counter is null).
 */
export function woodDest(prio: WoodPriority, truck: CounterFill | null, walkIn: CounterFill | null): HaulDest | null {
  const t = truck?.room ? truck : null;
  const w = walkIn?.room ? walkIn : null;
  if (!t) return w ? 'walkIn' : null;
  if (!w) return 'truck';
  if (prio === 'trucks') return 'truck';
  return w.free > t.free ? 'walkIn' : 'truck';
}

/**
 * Where a pine hauler takes a load from the deck (pure). `hopperCount` = logs in the workshop hopper, null when there
 * is no workshop. The hopper gets it while it holds fewer than PRIORITIES.workshopLow logs and either the player
 * prioritises the workshop or no sled loader is hired to top it up; 'trains' never diverts.
 */
export function pineTarget(prio: WoodPriority, hopperCount: number | null, sledLoaderHired: boolean): 'platform' | 'hopper' {
  if (prio === 'trains' || hopperCount === null) return 'platform';
  if (hopperCount >= PRIORITIES.workshopLow) return 'platform';
  return prio === 'workshop' || !sledLoaderHired ? 'hopper' : 'platform';
}

const TRUCK_ROUTE: XZ[] = [{ x: -1.5, z: -3.0 }, { x: 0.5, z: -9 }, TRUCK_POST];
const WALKIN_ROUTE: XZ[] = [WALKIN_POST];

export class LogHauler extends Helper {
  private phase: HaulerPhase = 'load';
  private dest: HaulDest = 'walkIn';

  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'logHauler', index, ['log']);
  }

  private holder(d: HaulDest): ItemHolder | null {
    return d === 'truck' ? (this.level.truckCounter?.input ?? null) : this.level.walkInCounter.input;
  }

  private fill(d: HaulDest): CounterFill | null {
    const c = d === 'truck' ? this.level.truckCounter : this.level.walkInCounter;
    if (!c) return null;
    return { room: c.input.canAccept('log'), free: Math.max(0, c.pile.room - c.pile.total) / Math.max(1, c.pile.room) };
  }

  /** By the wood priority (see woodDest): the truck counter or the walk-in counter, whichever has room. */
  private pickDest(): HaulDest | null {
    return woodDest(this.ctx.state.priorities.wood, this.fill('truck'), this.fill('walkIn'));
  }

  protected think(dt: number): void {
    switch (this.phase) {
      case 'load': {
        this.look = DROP_LOOK;
        if (this.moving) return;
        const dz = this.level.dropZone.pile;
        if (dz.count('log') > 0 && this.move(dz, this.stack, 'log')) return;
        this.idle += dt;
        if (this.stack.count('log') > 0 && this.settled && (this.stack.size >= this.capacity || this.idle > PATIENCE)) {
          const d = this.pickDest();
          if (d) {
            this.dest = d;
            this.go(d === 'truck' ? TRUCK_ROUTE : WALKIN_ROUTE);
            this.phase = 'go';
          }
        }
        return;
      }
      case 'go':
        if (this.moving) return;
        this.look = this.dest === 'truck' ? TRUCK_LOOK : WALKIN_LOOK;
        this.phase = 'unload';
        this.blocked = 0;
        return;
      case 'unload': {
        if (this.stack.size === 0) return this.back();
        const to = this.holder(this.dest);
        if (to && this.stack.count('log') > 0 && to.canAccept('log')) {
          this.blocked = 0;
          this.move(this.stack, to, 'log');
        } else if (this.settled) {
          this.blocked += dt;
          if (this.blocked > BLOCKED_GIVE_UP) {
            this.idle = -2;
            this.back();
          }
        }
        return;
      }
      case 'return':
        if (!this.moving) this.phase = 'load';
        return;
    }
  }

  private back(): void {
    this.goReverse(this.dest === 'truck' ? TRUCK_ROUTE.slice(0, -1) : [], DROP_POST);
    this.phase = 'return';
  }
}

// --- pine hauler ------------------------------------------------------------------------------------
type PineHaulerPhase = 'rest' | 'toDeck' | 'load' | 'go' | 'unload' | 'return' | 'home';

/** Seconds at an empty deck (with nothing in the arms) before walking back to the quarters. */
const PINE_REST_AFTER = 5;

export class PineHauler extends Helper {
  private phase: PineHaulerPhase = 'rest';
  private restTimer = 0;
  private target: 'platform' | 'hopper' = 'platform';

  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'pineHauler', index, ['log']);
  }

  /** Timber Ridge log deck (exists once the tree feller pad is unlocked). Never the drop zone. */
  private get deck(): ItemHolder | null {
    return this.level.treeFeller?.deck ?? null;
  }

  private get platform(): ItemHolder | null {
    return this.level.platformCounter?.input ?? null;
  }

  private get hopper(): ItemHolder | null {
    return this.level.workshop?.input ?? null;
  }

  /** Platform (trains) or workshop hopper, by the wood priority and what the hopper holds now. */
  private pickTarget(): 'platform' | 'hopper' {
    const hop = this.hopper;
    const n = hop ? hop.count('log') + this.ctx.flights.inFlightTo(hop, 'log') : null;
    const t = pineTarget(this.ctx.state.priorities.wood, n, this.ctx.upgrades.value('sledLoader') > 0);
    return t === 'hopper' && hop?.canAccept('log') ? 'hopper' : 'platform';
  }

  protected think(dt: number): void {
    switch (this.phase) {
      case 'rest': {
        this.look = PINE_HOME_LOOK;
        if (this.moving) return;
        this.restTimer -= dt;
        if (this.restTimer > 0) return;
        this.restTimer = 0.4;
        if ((this.deck?.count('log') ?? 0) > 0 && this.platform) {
          this.go([PINE_APPROACH, PINE_JUNCTION, DECK_POST]);
          this.phase = 'toDeck';
        }
        return;
      }
      case 'toDeck':
        if (this.moving) return;
        this.phase = 'load';
        this.idle = Math.min(this.idle, 0);
        return;
      case 'load': {
        this.look = DECK_LOOK;
        if (this.moving) return;
        const deck = this.deck;
        if (deck && deck.count('log') > 0 && this.move(deck, this.stack, 'log')) return;
        this.idle += dt;
        const has = this.stack.count('log') > 0;
        if (has && this.settled && (this.stack.size >= this.capacity || this.idle > PATIENCE)) {
          const target = this.pickTarget();
          if ((target === 'hopper' ? this.hopper : this.platform)?.canAccept('log')) {
            this.target = target;
            this.go(target === 'hopper' ? DECK_TO_HOPPER : DECK_TO_PLATFORM);
            this.phase = 'go';
          }
        } else if (!has && this.stack.size === 0 && this.idle > PINE_REST_AFTER) {
          this.goReverse([PINE_APPROACH, PINE_JUNCTION], PINE_HOME);
          this.phase = 'home';
        }
        return;
      }
      case 'go':
        if (this.moving) return;
        this.look = this.target === 'hopper' ? HOPPER_LOOK : PLATFORM_LOOK;
        this.phase = 'unload';
        this.blocked = 0;
        return;
      case 'unload': {
        if (this.stack.size === 0) return this.back();
        const to = this.target === 'hopper' ? this.hopper : this.platform;
        if (to && this.stack.count('log') > 0 && to.canAccept('log')) {
          this.blocked = 0;
          this.move(this.stack, to, 'log');
        } else if (this.settled) {
          this.blocked += dt;
          if (this.blocked > BLOCKED_GIVE_UP) {
            this.idle = -2;
            this.back();
          }
        }
        return;
      }
      case 'return':
        if (!this.moving) this.phase = 'load';
        return;
      case 'home':
        if (this.moving) return;
        this.phase = 'rest';
        return;
    }
  }

  private back(): void {
    this.goReverse((this.target === 'hopper' ? DECK_TO_HOPPER : DECK_TO_PLATFORM).slice(0, -1), DECK_POST);
    this.phase = 'return';
  }
}

// --- porter -------------------------------------------------------------------------------------------
type PorterPhase = 'idle' | 'toSource' | 'load' | 'putBack' | 'toShop' | 'unload' | 'toHome';

/** Where a porter loads: a pile it takes from, the stop it stands at and the point it faces. */
interface SourceRef {
  key: string;
  holder: ItemHolder;
  stop: Stop;
  look: XZ;
  /** The producer lot (null for the drop zone / bench): wheat / meat in the arms go back there on a save. */
  lot: number | null;
}

interface ShopRef {
  key: string;
  business: Business;
  stop: Stop;
  look: XZ;
}

interface PorterRefs {
  sources: Map<string, SourceRef>;
  shops: Map<string, ShopRef>;
  sourceViews: SourceView[];
  shopViews: ShopView[];
}

const PORTER_KINDS: readonly ItemKind[] = ['wheat', 'meat', 'log', 'crate'];
/** The drop zone / bench trips need at least this many items waiting. */
const SHARED_MIN_TAKE = 2;
/** Seconds a porter whose shop / producer was demolished waits for another taker of its load before dropping it. */
const ORPHAN_WAIT = 4;

const DROP_STOP: Stop = { p: DROP_POST, leg: DROP_LEG };
const BENCH_STOP: Stop = { p: BENCH_POST, leg: BENCH_LEG };
const HOME_STOP: Stop = { p: PORTER_HOME, leg: null };

/** Items of `kind` the shop's hopper still takes (landed + in flight counted). */
function shopRoom(ctx: GameContext, b: Business, kind: ItemKind): number {
  const input = b.input;
  if (!input || !b.def.inputs.some((i) => i.kind === kind)) return 0;
  return Math.max(0, hopperPerKind(b.def) - input.count(kind) - ctx.flights.inFlightTo(input, kind));
}

/** Porters' loads for the save (Crew.townCarried): per town lot (arrays of LOT_COUNT) and loose (no lot to take it). */
export interface PorterCarried {
  /** Goods on their way into a shop's hopper, by lot and kind. */
  in: Partial<Record<ItemKind, number>>[];
  /** Producer goods (wheat / meat) to put back on the producer lot's pallet. */
  out: number[];
  /** Logs / crates with no shop to go to: back to the drop zone / bench. */
  loose: Partial<Record<ItemKind, number>>;
}

export class Porter extends Helper {
  private phase: PorterPhase = 'idle';
  private job: PorterJob | null = null;
  private src: SourceRef | null = null;
  private dest: ShopRef | null = null;
  /** Where the porter stands (or is walking to). */
  private at: Stop = HOME_STOP;
  private pickTimer = 0;
  private idleFor = 0;
  /** Producer lot the wheat / meat in the arms came from (for the save), or null. */
  private fromLot: number | null = null;
  /** The load's shop or producer was demolished: seconds spent looking for another taker (0.9.0 Demolish). */
  private orphaned = false;
  private orphanT = 0;
  private readonly blockedAt = (x: number, z: number): boolean => this.ctx.colliders.overlaps(x, z, CLEARANCE);

  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'porter', index, PORTER_KINDS);
    this.pickTimer = 0.5 + index * 0.3;
  }

  /** What a peer porter must not chase: the pallet it loads from and the (shop, kind) hopper it feeds. */
  claim(): { source: string | null; shop: string; kind: ItemKind; amount: number } | null {
    const job = this.job;
    if (!job) return null;
    const loading = this.phase === 'toSource' || this.phase === 'load';
    // before the load is in the arms the planned amount is reserved; afterwards what is held (a failed load is back at 0)
    const amount = loading ? Math.max(job.take, this.stack.size) : this.stack.size;
    if (this.phase === 'putBack' || amount <= 0) return null;
    return { source: loading ? job.source : null, shop: this.dest?.key ?? job.shop, kind: job.kind, amount };
  }

  /**
   * For the save: what the arms hold (flying in included) and where the save should put it. A porter walking to / at a
   * shop (or loading for one) hands it to that shop's hopper: the one place sure to have room (room was checked before
   * departing and peers' reservations keep the sum within it). Otherwise wheat / meat go back on their producer's
   * pallet and logs / crates are `loose` (drop zone / bench).
   */
  addCarried(into: PorterCarried): void {
    const flights = this.ctx.flights;
    const toShop = this.phase === 'load' || this.phase === 'toShop' || this.phase === 'unload';
    for (const kind of PORTER_KINDS) {
      const n = this.stack.count(kind) + flights.inFlightTo(this.stack, kind);
      if (n <= 0) continue;
      if (toShop && this.dest && !this.dest.business.dead) {
        const lot = this.dest.business.lot;
        const m = (into.in[lot] ??= {});
        m[kind] = (m[kind] ?? 0) + n;
      } else if ((kind === 'wheat' || kind === 'meat') && this.fromLot !== null && this.level.town.business(this.fromLot)?.def.output === kind) {
        into.out[this.fromLot] = (into.out[this.fromLot] ?? 0) + n;
      } else {
        into.loose[kind] = (into.loose[kind] ?? 0) + n;
      }
    }
  }

  private claims(): Claims {
    const sources = new Set<string>();
    const dests = new Map<string, number>();
    for (const o of this.peers) {
      if (o === this || !(o instanceof Porter)) continue;
      const c = o.claim();
      if (!c) continue;
      if (c.source) sources.add(c.source);
      dests.set(destKey(c.shop, c.kind), (dests.get(destKey(c.shop, c.kind)) ?? 0) + c.amount);
    }
    return { sources, dests, favour: favouredShop(this.ctx.state.priorities.town as TownPriority) };
  }

  /** Stand point in front of a zone (toward the square), shifted along the zone's lateral axis per porter. */
  private zoneStop(b: Business, zone: Rect): { stop: Stop; look: XZ } {
    const { p, look } = zoneStand(zone, { x: b.frame.fx, z: b.frame.fz }, this.index);
    return { stop: { p, leg: null }, look };
  }

  /** Read the town now: every producer pallet, shop hopper, the drop zone and the bench. */
  private refs(): PorterRefs {
    const sources = new Map<string, SourceRef>();
    const shops = new Map<string, ShopRef>();
    const sourceViews: SourceView[] = [];
    const shopViews: ShopView[] = [];
    const town = this.level.town;
    for (let lot = 0; lot < LOT_COUNT; lot++) {
      const b = town.business(lot);
      if (!b) continue;
      if (b.def.kind === 'producer' && b.output && b.def.output && b.pickupZone) {
        const { stop, look } = this.zoneStop(b, b.pickupZone);
        const key = `pallet:${lot}`;
        sources.set(key, { key, holder: b.output, stop, look, lot });
        sourceViews.push({ key, kind: b.def.output, count: b.output.count(b.def.output), minTake: 2, pos: stop.p, shared: false });
      } else if (b.def.kind === 'shop' && b.input && b.feedZone) {
        const { stop, look } = this.zoneStop(b, b.feedZone);
        const key = `shop:${lot}`;
        shops.set(key, { key, business: b, stop, look });
        const room: Partial<Record<ItemKind, number>> = {};
        const stock: Partial<Record<ItemKind, number>> = {};
        for (const i of b.def.inputs) {
          room[i.kind] = shopRoom(this.ctx, b, i.kind);
          stock[i.kind] = b.input.count(i.kind) + this.ctx.flights.inFlightTo(b.input, i.kind);
        }
        shopViews.push({ key, id: b.def.id, pos: stop.p, room, stock });
      }
    }
    const dz = this.level.dropZone.pile;
    sources.set('drop', { key: 'drop', holder: dz, stop: DROP_STOP, look: DROP_LOOK, lot: null });
    sourceViews.push({ key: 'drop', kind: 'log', count: dz.count('log'), minTake: SHARED_MIN_TAKE, pos: DROP_POST, shared: true });
    const bench = this.level.processor?.output;
    if (bench) {
      sources.set('bench', { key: 'bench', holder: bench, stop: BENCH_STOP, look: BENCH_LOOK, lot: null });
      sourceViews.push({ key: 'bench', kind: 'crate', count: bench.count('crate'), minTake: SHARED_MIN_TAKE, pos: BENCH_POST, shared: true });
    }
    return { sources, shops, sourceViews, shopViews };
  }

  private heldKind(): ItemKind | null {
    for (const k of PORTER_KINDS) if (this.stack.count(k) > 0) return k;
    return null;
  }

  /** Walk to a stop along walkable ground and remember it as the place the porter will be. */
  private goTo(stop: Stop): void {
    this.go(travel(this.at, stop, this.blockedAt));
    this.at = stop;
  }

  private startDelivery(shop: ShopRef): void {
    this.dest = shop;
    this.goTo(shop.stop);
    this.phase = 'toShop';
  }

  private park(delay: number): void {
    this.job = null;
    this.src = null;
    this.phase = 'idle';
    this.pickTimer = delay;
  }

  /** The producer lot the load was taken from no longer holds that pallet (demolished, or another building stands there). */
  private sourceGone(): boolean {
    const s = this.src;
    return !!s && s.lot !== null && this.level.town.business(s.lot)?.output !== s.holder;
  }

  /**
   * 0.9.0 Demolish: a job whose shop or producer was torn down is cancelled. The walk in progress finishes (the next
   * plan starts from the stop it was heading to); what the arms hold is offered to any other shop, else dropped.
   */
  private dropDead(): void {
    const destGone = !!this.dest && this.dest.business.dead;
    const srcGone = this.sourceGone();
    if (!destGone && !srcGone) return;
    const p = this.phase;
    const needSrc = p === 'toSource' || p === 'load' || p === 'putBack';
    const needDest = p === 'toSource' || p === 'load' || p === 'toShop' || p === 'unload';
    if (destGone) this.dest = null;
    if (srcGone) {
      this.src = null;
      this.fromLot = null;
    }
    if ((srcGone && needSrc) || (destGone && needDest)) {
      this.job = null;
      this.src = null;
      this.phase = 'idle';
      this.pickTimer = 0.2;
      this.orphaned = this.stack.size > 0;
      this.orphanT = 0;
    }
  }

  /** Put whatever the arms hold back into the item pool (its shop and its producer are gone). */
  private discardLoad(): void {
    for (let it = this.stack.take(); it; it = this.stack.take()) this.ctx.items.release(it);
    this.orphaned = false;
    this.orphanT = 0;
  }

  protected think(dt: number): void {
    this.dropDead();
    switch (this.phase) {
      case 'idle': {
        if (this.at === HOME_STOP) this.look = PORTER_LOOK;
        if (this.moving) return;
        this.pickTimer -= dt;
        if (this.pickTimer > 0) return;
        this.pickTimer = 0.4;
        const refs = this.refs();
        const held = this.heldKind();
        if (this.stack.size > 0) {
          // leftovers (a shop filled up under us): first try to place them anywhere that wants them
          if (!held || !this.settled) return;
          const shop = pickShop(refs.shopViews, held, this.claims(), this.at.p);
          const ref = shop ? refs.shops.get(shop.key) : undefined;
          if (ref) {
            this.job = { source: '', shop: ref.key, kind: held, take: this.stack.size, score: 0 };
            this.orphaned = false;
            this.startDelivery(ref);
          } else if (this.orphaned) {
            this.orphanT += 0.4;
            if (this.orphanT > ORPHAN_WAIT) this.discardLoad();
          }
          return;
        }
        this.orphaned = false;
        const job = pickJob(refs.sourceViews, refs.shopViews, this.capacity, this.claims(), this.at.p, this.ctx.worldEvents.firewoodMult);
        const src = job ? refs.sources.get(job.source) : undefined;
        const dest = job ? refs.shops.get(job.shop) : undefined;
        if (job && src && dest) {
          this.job = job;
          this.src = src;
          this.dest = dest;
          this.fromLot = src.lot;
          this.idleFor = 0;
          this.goTo(src.stop);
          this.phase = 'toSource';
          return;
        }
        this.idleFor += 0.4;
        if (this.idleFor > 2 && this.at !== HOME_STOP) {
          this.goTo(HOME_STOP);
          this.phase = 'toHome';
        }
        return;
      }
      case 'toHome':
        if (this.moving) return;
        this.phase = 'idle';
        return;
      case 'toSource':
        if (this.moving) return;
        this.look = this.src!.look;
        this.phase = 'load';
        this.blocked = 0;
        this.idle = 0;
        return;
      case 'load': {
        const job = this.job!;
        const src = this.src!;
        const dest = this.dest!;
        this.look = src.look;
        const kind = job.kind;
        const want = Math.min(job.take, this.capacity);
        // never take more than the hopper has room for (the arms are not counted in its room yet)
        const room = shopRoom(this.ctx, dest.business, kind);
        if (this.stack.size < want && this.stack.size < room && src.holder.count(kind) > 0 && this.move(src.holder, this.stack, kind)) return;
        this.idle += dt;
        if (!this.settled) return;
        const full = this.stack.size >= want || this.stack.size >= room;
        if (!(full || this.idle > PATIENCE)) return;
        if (this.stack.count(kind) === 0) return this.park(1.5); // somebody else emptied the pile
        // choose where to go now: the planned shop if it still has room, else the hungriest other one
        if (room > 0) return this.startDelivery(dest);
        const refs = this.refs();
        const other = pickShop(refs.shopViews, kind, this.claims(), this.at.p);
        const ref = other ? refs.shops.get(other.key) : undefined;
        if (ref) {
          this.job = { ...job, shop: ref.key };
          return this.startDelivery(ref);
        }
        // nowhere to take it: put it back rather than carry it around
        this.phase = 'putBack';
        return;
      }
      case 'putBack': {
        const src = this.src!;
        const kind = this.job!.kind;
        if (this.stack.count(kind) > 0 && this.move(this.stack, src.holder, kind)) return;
        if (this.stack.size === 0) this.park(2);
        return;
      }
      case 'toShop':
        if (this.moving) return;
        this.look = this.dest!.look;
        this.phase = 'unload';
        this.blocked = 0;
        return;
      case 'unload': {
        const dest = this.dest!;
        const kind = this.heldKind() ?? this.job!.kind;
        if (this.stack.size === 0) {
          this.park(0.1); // pick the next job from here, no detour home
          return;
        }
        const to = dest.business.input;
        if (to && this.stack.count(kind) > 0 && to.canAccept(kind)) {
          this.blocked = 0;
          this.move(this.stack, to, kind);
        } else if (this.settled) {
          this.blocked += dt;
          if (this.blocked > BLOCKED_GIVE_UP) {
            // the hopper filled up under us: try another shop, else wait with the load (idle retries; no ping-pong)
            const refs = this.refs();
            const other = pickShop(refs.shopViews, kind, this.claims(), this.at.p, dest.key);
            const ref = other ? refs.shops.get(other.key) : undefined;
            if (ref) this.startDelivery(ref);
            else this.park(2);
          }
        }
        return;
      }
    }
  }
}

export { HOME, HOME_LOOK, HOME_ROUTE };
