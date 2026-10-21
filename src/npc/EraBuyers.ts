/**
 * 0.9.5: buyer trucks at an era region's loading dock (eras/RegionMarket.ts). Era 1's VehicleQueue for the eras, with
 * two differences: a truck buys ONE material kind but picks it at the counter (the most plentiful there, so a mixed
 * counter never blocks the line), and it pops in and out on the road in front of its own market (eras/market.ts lane),
 * so it never drives through another region's queue. It pays into the market's cash pile like era 1's trucks.
 *
 * Trucks drive −X along `lane.z` from `lane.fromX`, stop with the bed at the counter (the queue grows toward +X), load
 * one unit per TIMING.dockTakeInterval ÷ Dock, pay, cheer and drive on to `lane.toX`. A truck that loads nothing for
 * TRADE_POST.patience seconds pays for what it has (or, still empty, re-picks its kind). Trucks only come while the
 * counter has something on it or the line is empty, so one truck always waits and a quiet region shows no traffic jam.
 * Pooled per variant: spawning is free after warm-up and the cargo goes back to the item pool on despawn.
 * 0.9.6 (F6): later eras and bigger docks bring buyers more often and with bigger orders (buyerScale), so the counters
 * keep up with a levelled region and little is left to sell cheaply at the depot.
 * 0.9.7: each era sends its own vehicle (assets/eraVehicles.ts: a pony cart, an ox wagon … a hover pod), tinted by the
 * variant's colour; the model animates its own wheels, bounce and draught animal.
 * 0.9.12: vehicles no longer pop in and out on the road in front of the market. Each one drives a ROUTE over the road
 * network (eras/traffic.ts: in from the city or the next link road, along the drive lane, into the stop lane's queue,
 * back out and on down the road), turns its nose along it, and only appears or disappears where the camera can't see
 * it (npc/vehicleView.ts). On the drive lane a vehicle keeps its distance behind any other buyer (of any era).
 * 0.9.13 (review B5): each vehicle keeps the route it was given until it is gone. A new era opening a link road
 * rebuilds the route for new vehicles only: before, every vehicle on the road kept its distance along the route, which
 * on the new (longer) route was a point up to 80 m away, so all of them jumped in one frame.
 */
import * as THREE from 'three';
import { TIMING, TRADE_POST } from '../config';
import { approach, randRange } from '../core/math';
import type { GameContext, ItemKind } from '../core/types';
import { TRUCK_BED_X } from '../assets/vehicles';
import { createEraVehicleWithDriver, type EraVehicleModel } from '../assets/eraVehicles';
import { createSpeechBubble, type SpeechBubble } from '../assets/shop';
import type { CharacterRig } from '../render/characters';
import { Pile } from '../items/Pile';
import { transferOne } from '../items/transfer';
import { MATERIAL_KINDS, type MaterialKind } from '../eras/data';
import { buyerRoute, headingAt, pointAt, queueSlots, roadOpenAt, type BuyerRoute } from '../eras/traffic';
import { CROSSERS } from '../city/roadRoute';
import type { XZ } from '../eras/layout';
import { inView, trackVehicle, untrackVehicle } from './vehicleView';

/** What the queue needs from its loading dock (eras/RegionMarket.ts). */
export interface BuyerPost {
  readonly era: number;
  /** Goods on the counter. */
  readonly pile: Pile;
  /** Counter centre (world x) the beds line up with. */
  readonly x: number;
  /** The road in front of the market (regionLayout(n).road): the vehicles' route runs along it. */
  readonly road: string;
  /** 0.9.13: the market gate's x (the shoppers' walk across the road): no vehicle in line parks across it. */
  readonly gateX?: number;
  /** Vehicle paints (2 variants). */
  readonly colors: readonly [number, number];
  /** What a truck asks for at an empty counter (the era's main product). */
  readonly fallback: MaterialKind;
  /** The Dock value (≥ 1). */
  boost(): number;
  /** The order is complete: the market takes the money (cash pile, stats, 'sale'). */
  pay(kind: MaterialKind, count: number, at: THREE.Vector3): void;
}

type Mode = 'queue' | 'paid' | 'leave';

class Truck {
  readonly bubble: SpeechBubble;
  readonly cargo: Pile;
  mode: Mode = 'queue';
  /** Distance along the route. */
  s = 0;
  speed = 0;
  want = 0;
  kind: MaterialKind | null = null;
  atSlot = false;
  bubbleOn = false;
  takeTimer = 0;
  idle = 0;
  timer = 0;
  /** Waiting in view at the route's end (it vanishes once the camera looks away). */
  parked = false;
  /** 0.9.13: the route this vehicle drives (the one current when it appeared). */
  route!: BuyerRoute;
  readonly id: string;
  /** This trip's id for the traffic checks (pooled vehicles get a new one every spawn). */
  trip = '';

  constructor(
    ctx: GameContext,
    readonly model: EraVehicleModel,
    readonly rig: CharacterRig,
    readonly variant: number,
    id: string,
  ) {
    this.id = id;
    this.bubble = createSpeechBubble(1.3);
    this.bubble.sprite.visible = false;
    this.bubble.sprite.position.set(0, model.bubbleY, 0);
    model.root.add(this.bubble.sprite);
    this.cargo = new Pile(ctx, { id, accepts: MATERIAL_KINDS, position: new THREE.Vector3(0, 0, 0), parent: model.bedPivot, grid: BED_GRID });
  }
}

const tmp = new THREE.Vector3();
const tmpXZ: XZ = { x: 0, z: 0 };
const tmpH: XZ = { x: 0, z: 0 };
/** How big a vehicle is for the view test: its length, its shadow and a margin for the camera moving this frame. */
const VIEW_R = 6;
/** On the drive lane a vehicle stops this far behind the one ahead, and slows within FOLLOW_SLOW of it. */
const FOLLOW_STOP = 5.2;
const FOLLOW_SLOW = 9;
/** Every era's vehicles out on the roads (they share the drive lanes), for keeping distance. */
const ROAD_TRUCKS = new Set<Truck>();
/**
 * A vehicle stops this far (centre to walker) behind someone crossing in its path, that wide either side of it.
 * 0.9.13: 3.6 (was 2.8, which left a pony's nose 15 cm from the walker; npc/EraShoppers.ts).
 */
const CROSS_STOP = 3.6;
const CROSS_SIDE = 1.6;
/** 0.9.13: the line rolls up behind a front vehicle this many units short of its order (rollUp). */
const ROLL_UP = 2;
const ACCEL = 6;
const DECEL = 8;

/** 0.9.6 (F6): a later era's buyers come this much more often per era past the Frontier (on top of the Dock value). */
const ERA_RATE = 0.1;
/** 0.9.6 (F6): and buy this much more per era past the Frontier … */
const ERA_SIZE = 0.12;
/** … and this much more per Dock / Stall value past ×1 (a bigger dock draws bigger trucks). */
const BOOST_SIZE = 0.4;
/** 0.9.6: a truck bed holds up to 3 × 3 × 3 = 27 (TRADE_POST.bedGrid with a third layer). */
export const BED_GRID = { ...TRADE_POST.bedGrid, layers: 3 };
export const BED_MAX = BED_GRID.cols * BED_GRID.rows * BED_GRID.layers;

/**
 * 0.9.6 (F6): how era `era`'s buyers scale with the era and their counter's upgrade value (`boost`, the Dock or Stall
 * value ≥ 1): `rate` multiplies how often they come, `size` how much each one buys. Era 2 at ×1 is 0.9.5 exactly.
 */
export function buyerScale(era: number, boost: number): { rate: number; size: number } {
  const past = Math.max(0, era - 2);
  const b = Math.max(1, boost);
  return { rate: b * (1 + ERA_RATE * past), size: (1 + ERA_SIZE * past) * (1 + BOOST_SIZE * (b - 1)) };
}

export class EraBuyers {
  /** Trucks in line, front first (including ones still driving in). */
  private readonly queue: Truck[] = [];
  private readonly leaving: Truck[] = [];
  private readonly pools: Truck[][] = [[], []];
  private spawnTimer = 1.2;
  private spawned = 0;
  private route: BuyerRoute | null = null;
  private routeAge = -1;

  constructor(
    private readonly ctx: GameContext,
    private readonly post: BuyerPost,
  ) {}

  /** Trucks in line (the one loading included). */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * 0.9.13: the line is moving up to the counter (rolling up behind a front one that is about done, or one in the stop
   * lane driving to its slot). Shoppers wait at the kerb for it (npc/EraShoppers.ts), so the line keeps the pace it had
   * before its second place moved back behind the market gate.
   */
  get settling(): boolean {
    if (this.rollUp()) return true;
    for (const t of this.queue) if (!t.atSlot && t.s >= t.route.sMerge) return true;
    return false;
  }

  /**
   * True while the front vehicle is about done: paid, or ROLL_UP units short of its order with that much on the counter.
   * Then the ones behind it roll up a plain queue spacing apart (the second one across the market gate, while shoppers
   * hold back), so the next one is at the counter as quickly as when its place was there all along.
   */
  private rollUp(): boolean {
    const f = this.queue[0];
    if (!f || !f.atSlot) return false;
    if (f.mode === 'paid') return true;
    if (f.mode !== 'queue' || f.kind === null) return false;
    const short = f.want - f.cargo.total;
    return short <= ROLL_UP && this.post.pile.count(f.kind) + this.ctx.flights.inFlightTo(f.cargo, f.kind) >= short;
  }

  /** Goods on unpaid trucks (landed or still flying into the bed) by kind: the save puts them back on the counter. */
  unpaid(out: Partial<Record<ItemKind, number>>): void {
    const fl = this.ctx.flights;
    for (const t of this.queue) {
      if (t.mode !== 'queue') continue;
      for (const k of MATERIAL_KINDS) {
        const n = t.cargo.count(k) + fl.inFlightTo(t.cargo, k);
        if (n > 0) out[k] = (out[k] ?? 0) + n;
      }
    }
  }

  /** The route for the roads open now (rebuilt when a new era opens a link road). */
  private currentRoute(): BuyerRoute {
    const age = this.ctx.state?.eras?.age ?? this.post.era;
    if (!this.route || this.routeAge !== age) {
      this.routeAge = age;
      const slots = queueSlots(this.post.x - TRUCK_BED_X, TRADE_POST.maxQueue, TRADE_POST.spacing, this.post.gateX);
      this.route = buyerRoute(this.post.road, slots, (id) => roadOpenAt(Math.max(age, this.post.era), id));
    }
    return this.route;
  }

  private slotS(t: Truck, i: number): number {
    return t.route.slots[i]!;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.spawnStep(dt);
    for (let i = 0; i < this.queue.length; i++) this.stepQueued(this.queue[i]!, i, dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const t = this.leaving[i]!;
      this.stepLeaving(t, dt);
      // gone only where nobody sees it go: past the pull-out and off screen (or at the route's end, once off screen)
      if (t.s >= t.route.sOut && !this.seen(t.route, t.s)) this.despawn(i);
    }
  }

  /** True when a vehicle at distance `s` along route `r` would show on screen. */
  private seen(r: BuyerRoute, s: number): boolean {
    const p = pointAt(r, s, tmpXZ);
    return inView(this.ctx, p.x, p.z, VIEW_R);
  }

  /**
   * Where a new vehicle may appear: the nearest point up the route from the queue that is off screen and clear of other
   * vehicles (null: none right now, try again shortly).
   */
  private spawnS(): number | null {
    const r = this.currentRoute();
    for (let s = r.sMerge - 2; s >= 0; s -= 1.5) {
      if (this.seen(r, s)) continue;
      const p = pointAt(r, s, tmpXZ);
      let clear = true;
      for (const o of ROAD_TRUCKS) {
        o.model.root.getWorldPosition(tmp);
        if (Math.hypot(tmp.x - p.x, tmp.z - p.z) < FOLLOW_SLOW) {
          clear = false;
          break;
        }
      }
      if (clear) return s;
    }
    return null;
  }

  // ---- spawning -------------------------------------------------------------------------------------------------
  private spawnStep(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const busy = this.queue.length >= TRADE_POST.maxQueue || (this.queue.length > 0 && this.post.pile.total === 0);
    if (busy) {
      this.spawnTimer = 0.5;
      return;
    }
    const at = this.spawnS();
    if (at === null) {
      this.spawnTimer = 0.4;
      return;
    }
    const scale = buyerScale(this.post.era, this.post.boost());
    this.spawnTimer = randRange(TRADE_POST.gap[0], TRADE_POST.gap[1]) / scale.rate;
    const variant = this.spawned++ % 2;
    let t = this.pools[variant]!.pop();
    if (!t) {
      const { model, rig } = createEraVehicleWithDriver(this.post.era, this.post.colors[variant]!, variant + 2);
      t = new Truck(this.ctx, model, rig, variant, `npc:trader${this.post.era}:${this.spawned}`);
    }
    t.mode = 'queue';
    t.route = this.currentRoute();
    t.s = at;
    t.speed = TRADE_POST.driveSpeed * 0.8;
    t.want = Math.min(BED_MAX, Math.round(Math.min(TRADE_POST.maxWant, randRange(TRADE_POST.want[0] - 0.49, TRADE_POST.want[1] + 0.49)) * scale.size));
    t.kind = null;
    t.atSlot = false;
    t.bubbleOn = false;
    t.takeTimer = 0;
    t.idle = 0;
    t.timer = 0;
    t.parked = false;
    t.bubble.sprite.visible = false;
    t.rig.setSeated(true);
    t.model.root.visible = true;
    t.model.root.scale.setScalar(1);
    this.ctx.scene.add(t.model.root);
    this.pose(t);
    this.queue.push(t);
    ROAD_TRUCKS.add(t);
    t.trip = `${t.id}#${this.spawned}`;
    trackVehicle({ id: t.trip, kind: `eraBuyer:${this.post.era}`, root: t.model.root, facing: (out) => this.facing(t, out) });
  }

  private despawn(i: number): void {
    const t = this.leaving[i]!;
    this.leaving.splice(i, 1);
    ROAD_TRUCKS.delete(t);
    untrackVehicle(t.trip);
    t.cargo.clear();
    this.ctx.tweens.killTweensOf(t.bubble.sprite);
    this.ctx.tweens.killTweensOf(t.model.root);
    t.bubble.sprite.visible = false;
    t.model.root.removeFromParent();
    t.model.root.visible = false;
    t.model.root.scale.setScalar(1);
    this.pools[t.variant]!.push(t);
  }

  /** Every truck back to the pool (the region is disposed / a test resets). Unpaid cargo is released. */
  clear(): void {
    while (this.queue.length) this.leaving.push(this.queue.pop()!);
    for (let i = this.leaving.length - 1; i >= 0; i--) this.despawn(i);
  }

  // ---- driving --------------------------------------------------------------------------------------------------
  private driveTo(t: Truck, target: number, dt: number): boolean {
    const dist = target - t.s;
    if (dist <= 0.01 && t.speed < 0.2) {
      t.s = target;
      t.speed = 0;
      return true;
    }
    const boost = Math.min(1.5, Math.max(1, this.post.boost()));
    const vmax = Math.min(TRADE_POST.driveSpeed * boost, Math.sqrt(2 * DECEL * Math.max(0, dist)) + 0.35, this.follow(t));
    t.speed = approach(t.speed, vmax, (t.speed > vmax ? DECEL : ACCEL * boost) * dt);
    const step = t.speed * dt;
    if (step >= dist) {
      t.s = target;
      t.speed = 0;
      return true;
    }
    t.s += step;
    return false;
  }

  /**
   * Top speed that keeps a safe gap on the drive lane: 0 right behind another vehicle heading the same way, easing
   * off within FOLLOW_SLOW. Parked queues sit in the other lane, so only traffic on the move ahead counts. Infinity
   * when the way is clear (or once in this market's own stop lane, where the queue slots space vehicles).
   */
  private follow(t: Truck): number {
    const r = t.route;
    const p = pointAt(r, t.s, tmpXZ);
    const h = headingAt(r, t.s, tmpH);
    let cap = Infinity;
    // 0.9.12: brake for anyone crossing the road ahead (city/roadRoute.ts CROSSERS), even in the stop lane
    for (const c of CROSSERS) {
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      const along = dx * h.x + dz * h.z;
      if (along <= 0 || along > FOLLOW_SLOW || Math.abs(dx * h.z - dz * h.x) > CROSS_SIDE) continue;
      cap = Math.min(cap, along <= CROSS_STOP ? 0 : ((along - CROSS_STOP) / (FOLLOW_SLOW - CROSS_STOP)) * TRADE_POST.driveSpeed);
    }
    if (t.s >= r.sMerge && t.s <= r.sOut) return cap;
    for (const o of ROAD_TRUCKS) {
      if (o === t) continue;
      o.model.root.getWorldPosition(tmp);
      const dx = tmp.x - p.x;
      const dz = tmp.z - p.z;
      const along = dx * h.x + dz * h.z;
      const side = Math.abs(dx * h.z - dz * h.x);
      if (along <= 0 || along > FOLLOW_SLOW || side > 1.3) continue;
      cap = Math.min(cap, along <= FOLLOW_STOP ? 0 : ((along - FOLLOW_STOP) / (FOLLOW_SLOW - FOLLOW_STOP)) * TRADE_POST.driveSpeed + o.speed * 0.5);
    }
    return cap;
  }

  private stepQueued(t: Truck, index: number, dt: number): void {
    // behind a front one that is about done: roll up a plain spacing behind it (never back once past the slot)
    const slot = this.slotS(t, index);
    const target = index > 0 && this.rollUp() ? Math.max(slot, t.route.sFront - index * TRADE_POST.spacing) : Math.max(slot, Math.min(t.s, t.route.sFront - index * TRADE_POST.spacing));
    t.atSlot = this.driveTo(t, target, dt) && target === slot;
    this.animate(t, dt);
    if (index !== 0 || !t.atSlot) return;
    if (t.mode === 'queue') this.serve(t, dt);
    else if (t.mode === 'paid') {
      t.timer -= dt;
      if (t.timer <= 0) this.sendAway(t);
    }
  }

  /** The most plentiful kind on the counter (null when it is empty). */
  private plentiful(): MaterialKind | null {
    const pile = this.post.pile;
    let best: MaterialKind | null = null;
    let n = 0;
    for (const k of MATERIAL_KINDS) {
      const c = pile.count(k);
      if (c > n) {
        n = c;
        best = k;
      }
    }
    return best;
  }

  private serve(t: Truck, dt: number): void {
    const pile = this.post.pile;
    // an empty truck picks (or re-picks) what the counter has most of
    if (t.cargo.total === 0) {
      const k = this.plentiful();
      if (k && (t.kind === null || pile.count(t.kind) === 0)) {
        t.kind = k;
        t.idle = 0;
      }
      if (t.kind === null) t.kind = this.post.fallback;
    }
    const kind = t.kind!;
    if (!t.bubbleOn) {
      t.bubbleOn = true;
      t.bubble.sprite.visible = true;
      this.ctx.tweens.popIn(t.bubble.sprite);
    }
    const have = t.cargo.total;
    t.bubble.show(kind, `${have}/${t.want}`);
    t.takeTimer -= dt;
    t.idle += dt;
    if (t.takeTimer <= 0 && have < t.want && pile.count(kind) > 0) {
      t.takeTimer = TIMING.dockTakeInterval / Math.min(TIMING.dockLoadMax, Math.max(1, this.post.boost()));
      if (transferOne(this.ctx, pile, t.cargo, [kind], { duration: 0.32, arcHeight: 1.8 })) t.idle = 0;
    }
    const landed = t.cargo.count(kind);
    // paid once everything has landed: the full order, or what it has after waiting `patience` for more
    if (landed >= t.want || (landed > 0 && landed === have && t.idle >= TRADE_POST.patience)) this.pay(t, landed);
  }

  private pay(t: Truck, count: number): void {
    const kind = t.kind!;
    t.cargo.root.getWorldPosition(tmp);
    tmp.y += 0.7;
    this.post.pay(kind, count, tmp);
    t.mode = 'paid';
    t.timer = 0.4;
    t.rig.cheer();
    t.bubble.show('check');
    this.ctx.tweens.popIn(t.bubble.sprite, { duration: 0.35 });
    this.ctx.tweens.squash(t.model.body, 0.12, 0.4);
  }

  private sendAway(t: Truck): void {
    const i = this.queue.indexOf(t);
    if (i >= 0) this.queue.splice(i, 1);
    this.leaving.push(t);
    t.mode = 'leave';
    t.timer = 1.0;
    t.model.bedPivot.getWorldPosition(tmp);
    this.ctx.particles.puff(tmp, { color: 0xffffff, count: 3, size: 0.45, life: 0.8 });
  }

  private stepLeaving(t: Truck, dt: number): void {
    const end = t.route.length;
    // on down the road; at the route's end (a road end) it waits until the camera looks away
    const vmax = Math.min(TRADE_POST.driveSpeed * 1.15, this.follow(t), Math.sqrt(2 * DECEL * Math.max(0, end - t.s)));
    t.speed = approach(t.speed, vmax, (t.speed > vmax ? DECEL : ACCEL) * dt);
    t.s = Math.min(end, t.s + t.speed * dt);
    t.parked = t.s >= end - 0.05;
    if (t.bubbleOn) {
      t.timer -= dt;
      if (t.timer <= 0) {
        t.bubbleOn = false;
        this.ctx.tweens.popOut(t.bubble.sprite, { duration: 0.25 });
      }
    }
    this.animate(t, dt);
  }

  /** The vehicle's nose: models face −X, turned to the route's heading. */
  private facing(t: Truck, out: THREE.Vector3): THREE.Vector3 {
    const y = t.model.root.rotation.y;
    return out.set(-Math.cos(y), 0, Math.sin(y));
  }

  private pose(t: Truck): void {
    const r = t.route;
    const p = pointAt(r, t.s, tmpXZ);
    t.model.root.position.set(p.x, 0, p.z);
    const h = headingAt(r, t.s, tmpH);
    // a model facing −X turned by yaw y points at (−cos y, sin y)
    t.model.root.rotation.y = Math.atan2(h.z, -h.x);
  }

  private animate(t: Truck, dt: number): void {
    const m = t.model;
    this.pose(t);
    const moving = Math.min(1, t.speed / (TRADE_POST.driveSpeed * 0.5));
    m.animate(dt, t.speed, moving);
    t.rig.animate(dt, 0);
    if (t.bubble.sprite.visible) t.bubble.sprite.position.y = m.bubbleY + Math.sin((this.ctx.time.elapsed + t.s) * 4.5) * 0.04;
  }
}
