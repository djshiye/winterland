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
 *
 * Several helpers of one role may work (core/crew.ts crewSlots): each has an `index`, a small lane offset on its
 * posts, a staggered start, and `peers` (the role's helpers) so cashiers do not pile onto the same cash pile.
 */
import * as THREE from 'three';
import { CREW, LAYOUT, PLAYER, type XZ } from '../config';
import { approach, dampAngle, yawFromDir } from '../core/math';
import type { CrewRole } from '../core/crew';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { CarryStack } from '../items/CarryStack';
import { transferOne } from '../items/transfer';
import { createCharacterRig, type CharacterRig } from '../render/characters';
import type { Level } from '../level/Level';
import type { CashPile } from '../stations/CashPile';

export type CrewId = CrewRole;
export const CREW_IDS: readonly CrewId[] = ['crateRunner', 'cashier', 'logHauler', 'pineHauler'];

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

/** Door → home post, used when a helper is hired. */
const HOME_ROUTE: Record<CrewId, XZ[]> = {
  crateRunner: [{ x: 7.4, z: -2.0 }, { x: 7.4, z: 0.85 }, BENCH_POST],
  cashier: [CASHIER_HOME],
  logHauler: [{ x: 4.8, z: -5.3 }, { x: -1.5, z: -4.6 }, DROP_POST],
  pineHauler: [...TO_RIDGE, PINE_JUNCTION, PINE_APPROACH, PINE_HOME],
};
const HOME: Record<CrewId, XZ> = {
  crateRunner: BENCH_POST,
  cashier: CASHIER_HOME,
  logHauler: DROP_POST,
  pineHauler: PINE_HOME,
};
const HOME_LOOK: Record<CrewId, XZ> = {
  crateRunner: BENCH_LOOK,
  cashier: DOOR_LOOK,
  logHauler: DROP_LOOK,
  pineHauler: PINE_HOME_LOOK,
};
/** Base character variant per role (the index shifts it so twins look different). */
const VARIANT: Record<CrewId, number> = { crateRunner: 0, cashier: 1, logHauler: 2, pineHauler: 1 };
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
registerPost(DECK_POST, DECK_LOOK);
registerPost(PLATFORM_POST, PLATFORM_LOOK);

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
    this.rig = createCharacterRig('worker', (VARIANT[id] + index) % 3);
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

  protected get interval(): number {
    return BASE_INTERVAL / Math.max(0.5, this.mult);
  }

  protected get capacity(): number {
    return Math.max(1, Math.floor(CREW[this.id].capacity * this.mult));
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
      const max = CREW[this.id].walkSpeed * Math.max(0.5, this.mult);
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
  route: XZ[];
  post: XZ;
  look: XZ;
  pile: () => CashPile | null;
}

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

  private leave(): void {
    this.goReverse(this.stop!.route, CASHIER_HOME);
    this.phase = 'back';
  }

  /** True while this cashier is on its way to / collecting from `s` (peers skip it). */
  stopOf(s: PileStop): boolean {
    if (!this.stop || (this.phase !== 'go' && this.phase !== 'collect')) return false;
    // every cashier builds its own stop table, so compare the piles, not the stop objects
    const mine = this.stop.pile();
    return mine !== null && mine === s.pile();
  }

  /** Richest pile (value, discounted by distance) holding at least two bundles' worth. */
  private pickStop(): PileStop | null {
    let best: PileStop | null = null;
    let bestScore = 0;
    const p = this.group.position;
    for (const s of this.stops) {
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
type HaulDest = 'truck' | 'walkIn';

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

  /** Truck counter when it has room, else the walk-in counter when it has room. */
  private pickDest(): HaulDest | null {
    if (this.holder('truck')?.canAccept('log')) return 'truck';
    if (this.holder('walkIn')?.canAccept('log')) return 'walkIn';
    return null;
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
          if (this.platform?.canAccept('log')) {
            this.go(DECK_TO_PLATFORM);
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
        this.look = PLATFORM_LOOK;
        this.phase = 'unload';
        this.blocked = 0;
        return;
      case 'unload': {
        if (this.stack.size === 0) return this.back();
        const to = this.platform;
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
    this.goReverse(DECK_TO_PLATFORM.slice(0, -1), DECK_POST);
    this.phase = 'return';
  }
}

export { HOME, HOME_LOOK, HOME_ROUTE };
