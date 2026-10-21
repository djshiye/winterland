/**
 * 0.9.5: walk-in shoppers at an era region's market stall (eras/RegionMarket.ts), era 1's CustomerQueue for the eras.
 *
 * A shopper pops in at the market gate, walks to the entry point, then to its place in line (front + i · step). At the
 * front it picks the kind the stall has most of, takes one unit per TIMING.dockTakeInterval ÷ the Stall upgrade (up to
 * TIMING.dockLoadMax), shows "have/want" in its bubble, pays for its order into the market's cash pile, cheers and
 * walks back out through the gate, carrying what it bought, and fades on the road. A shopper that gets nothing for
 * TRADE_POST.patience seconds pays for what it holds (or, empty-handed, keeps waiting for the next delivery).
 * New shoppers only come while the stall has goods or the line is empty, so a quiet market shows one waiting shopper.
 * Entities (rig + carry stack + bubble) are pooled.
 * 0.9.12: shoppers no longer pop in at the gate and fade out on the road in plain view. They walk in along the snowy
 * verge beside the road from a point the camera can't see, cross to the gate, and leave the same way, vanishing only
 * once out of sight (npc/vehicleView.ts).
 * 0.9.13 (review B1, B7): a shopper leaves toward the far side of the road (never a road end a few metres off, where it
 * stood in plain view for good while the next ones piled up on it), walks on until it is out of sight, waits at the kerb
 * while a vehicle comes, and the buyers brake for it on the road (city/roadRoute.ts CROSSERS). One still in view at the
 * far end after STAND_MAX seconds, or the oldest past LEAVE_MAX leaving, fades out, so the leaving list never grows.
 */
import * as THREE from 'three';
import { PLAYER, TIMING, TRADE_POST } from '../config';
import { approach, dampAngle, randRange, yawFromDir } from '../core/math';
import type { GameContext, ItemKind } from '../core/types';
import { CarryStack } from '../items/CarryStack';
import type { Pile } from '../items/Pile';
import { transferOne } from '../items/transfer';
import { createCharacterRig, type CharacterRig } from '../render/characters';
import { createSpeechBubble, type SpeechBubble } from '../assets/shop';
import { MATERIAL_KINDS, type MaterialKind } from '../eras/data';
import type { XZ } from '../eras/layout';
import { buyerScale } from './EraBuyers';
import { ROADS, type ERect } from '../eras/data';
import { CROSSERS, inRect, kerbWait, type KerbVehicle } from '../city/roadRoute';
import { inView, trafficNow } from './vehicleView';

/** Shoppers walk the snow this far outside the road's outer edge (parked buyers fill the road's outer lane). */
const VERGE = 0.7;
/** How far along the verge a shopper may come from. */
const WALK_FAR = 48;
/** 0.9.13 (B1): a leaving shopper walks on along the verge up to this far (it vanishes once out of sight on the way) … */
const LEAVE_FAR = 120;
/** … toward a side with at least this much road (era II, VIII, IX: the road ends a few metres east of the gate). */
const LEAVE_MIN = 30;
/** Seconds a shopper may stand in view at the verge's far end before it fades, and the most leaving at once. */
const STAND_MAX = 20;
const LEAVE_MAX = 12;
const FADE = 1;
/** Seconds a shopper waits at the kerb for traffic before it crosses anyway (npc/EraWorker.ts KERB_PATIENCE). */
const KERB_PATIENCE = 12;
/**
 * The kerb check treats the road as this much wider on both sides: a shopper waits on the verge itself, and a step back
 * inside the gate (which opens right on the road's edge), clear of a vehicle going by in the near lane.
 */
const KERB_GROW = 0.4;
/** The buyers see a crossing shopper this far ahead along its walk (m), so a vehicle in the far lane brakes in time. */
const CROSS_AHEAD = 1.5;
/** A shopper behind one waiting at the kerb stops this far back (m). */
const KERB_GAP = 0.75;
/** Waiting shoppers keep this far apart along the kerb (m): each takes its own wait spot a step from the next. */
export const KERB_SPACING = 0.7;
/** Speed (m/s) a waiting shopper shuffles along the kerb to its own spot. */
const KERB_SHUFFLE = 1.2;
/** Seconds a shopper rests in the pool before it walks in again. */
const REST = 2;

/** What the line needs from its market stall. */
export interface ShopperStall {
  readonly era: number;
  readonly pile: Pile;
  /** Gate opening, entry point inside it, the front of the line and the step between two shoppers (world XZ). */
  readonly door: XZ;
  readonly entry: XZ;
  readonly front: XZ;
  readonly step: XZ;
  /** Yaw a shopper at the counter faces. */
  readonly faceYaw: number;
  /** Unit vector from the gate into the region (+1 / −1 along Z): shoppers leave this far out onto the road. */
  readonly inward: number;
  /** 0.9.12: the road in front of the market (regionLayout(n).road): shoppers walk along its verge. */
  readonly road?: string;
  readonly fallback: MaterialKind;
  /** The Stall value (≥ 1). */
  boost(): number;
  pay(kind: MaterialKind, count: number, at: THREE.Vector3): void;
  /** 0.9.13: the market's buyer line is moving up to the counter (npc/EraBuyers.ts settling): wait at the kerb for it. */
  lineMoving?(): boolean;
}

type Mode = 'in' | 'queue' | 'paid' | 'out';

const VARIANTS = 4;
/** 0.9.6 (F6): the most one shopper buys (later eras and a bigger stall: EraBuyers buyerScale). */
const SHOP_MAX = 10;
const ACCEL = 12;
const TURN = 14;
const tmp = new THREE.Vector3();

/**
 * Traffic as a shopper sees it: every vehicle on the move counts, the buyers too (they brake for people on the road, but
 * one in the near lane only sees a shopper step out at the last moment, so shoppers let them pass), measured from the
 * front of the vehicle (a cart moving up its line has its pony a couple of metres ahead of its middle).
 */
function* carefully(vehicles: Iterable<KerbVehicle>): Generator<KerbVehicle> {
  for (const v of vehicles) yield { ...v, x: v.x + v.fx * NOSE_AHEAD, z: v.z + v.fz * NOSE_AHEAD, yields: false };
}
const NOSE_AHEAD = 1.6;

/**
 * How far (m, signed, along the unit kerb direction `axis`) a shopper standing at `at` should shuffle to clear the
 * waiters at `others` by `spacing`: away from the nearest one inside the spacing, moving along the kerb only (never
 * toward the road). `tie` breaks an exact overlap (+1 / −1: by queue slot), so two on one spot part ways.
 */
export function kerbShift(at: XZ, others: readonly XZ[], axis: XZ, spacing: number, tie: number): number {
  let best = 0;
  let nearest = spacing;
  for (const o of others) {
    const dx = at.x - o.x;
    const dz = at.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= nearest) continue;
    nearest = d;
    const side = dx * axis.x + dz * axis.z;
    const dir = Math.abs(side) > 0.01 ? Math.sign(side) : tie;
    // slide far enough along the kerb that the straight distance reaches the spacing
    const across = d * d - side * side;
    best = dir * (Math.sqrt(Math.max(0, spacing * spacing - Math.max(0, across))) - dir * side);
  }
  return best;
}

class Shopper {
  readonly group = new THREE.Group();
  readonly rig: CharacterRig;
  readonly stack: CarryStack;
  readonly bubble: SpeechBubble;
  readonly velocity = new THREE.Vector3();
  readonly bubbleY: number;
  mode: Mode = 'in';
  kind: MaterialKind | null = null;
  want = 1;
  speed = 0;
  yaw = 0;
  /** Waypoints left (world XZ), walked in order. */
  path: XZ[] = [];
  takeTimer = 0;
  idle = 0;
  timer = 0;
  bubbleOn = false;
  bob = Math.random() * 10;
  /** Seconds waited at the kerb, stood in view at the verge's end, and the fade-out left (0: not fading). */
  kerb = 0;
  stood = 0;
  fade = 0;
  /** Standing in line behind someone waiting at the kerb. */
  held = false;
  /** Where the buyers see this shopper while it crosses (CROSSERS): a step ahead, so they brake as it steps out. */
  readonly cross: XZ = { x: 0, z: 0 };

  constructor(ctx: GameContext, id: string, variant: number, era: number) {
    this.rig = createCharacterRig('customer', variant, era);
    this.group.add(this.rig.root);
    this.bubble = createSpeechBubble(1.05);
    this.bubble.sprite.visible = false;
    this.group.add(this.bubble.sprite);
    this.bubbleY = this.rig.height + 0.4;
    this.bubble.sprite.position.y = this.bubbleY;
    this.stack = new CarryStack(ctx, { id, accepts: MATERIAL_KINDS, capacity: SHOP_MAX + 1, anchor: this.rig.armsAnchor });
  }
}

export class EraShoppers {
  private readonly queue: Shopper[] = [];
  private readonly leaving: Shopper[] = [];
  private readonly pool: Shopper[] = [];
  /** 0.9.12: when each pooled shopper went back (clock seconds): one is reused only after REST, so nobody seems to hop from where one left to where the next one comes in. */
  private readonly freedAt = new Map<Shopper, number>();
  private clock = 0;
  private created = 0;
  private roadRect: ERect | null | undefined;
  /** The carriageway the kerb check looks at (the road, KERB_INSET in from its edges). */
  private lane: ERect | null = null;
  private spawnTimer = 0.8;

  constructor(
    private readonly ctx: GameContext,
    private readonly stall: ShopperStall,
  ) {}

  /** Shoppers in line (walking in included). */
  get waiting(): number {
    return this.queue.length;
  }

  /** Goods held by shoppers who have not paid yet, by kind (the save puts them back on the stall). */
  unpaid(out: Partial<Record<ItemKind, number>>): void {
    const fl = this.ctx.flights;
    for (const c of this.queue) {
      if (c.mode === 'paid') continue;
      for (const k of MATERIAL_KINDS) {
        const n = c.stack.count(k) + fl.inFlightTo(c.stack, k);
        if (n > 0) out[k] = (out[k] ?? 0) + n;
      }
    }
  }

  /** Everyone back to the pool (restore / tests). Unpaid goods are released. */
  clear(): void {
    while (this.queue.length) this.leaving.push(this.queue.pop()!);
    for (let i = this.leaving.length - 1; i >= 0; i--) this.despawn(i);
  }

  /** The road in front of the market (null without one: tests). */
  private road(): ERect | null {
    if (this.roadRect === undefined) {
      const r = (this.stall.road ? ROADS.find((q) => q.id === this.stall.road)?.rect : undefined) ?? null;
      this.roadRect = r;
      this.lane = r && { minX: r.minX, maxX: r.maxX, minZ: r.minZ - KERB_GROW, maxZ: r.maxZ + KERB_GROW };
    }
    return this.roadRect;
  }

  /** The verge line's z (the road's outer edge, VERGE beyond it), or the gate's z without a road. */
  private vergeZ(): number {
    const r = this.road();
    if (!r) return this.stall.door.z;
    return this.stall.inward > 0 ? r.minZ - VERGE : r.maxZ + VERGE;
  }

  /** The verge's x span (the road's length). */
  private vergeSpan(): [number, number] {
    const r = this.road();
    return r ? [r.minX + 1, r.maxX - 1] : [this.stall.door.x, this.stall.door.x];
  }

  /**
   * The nearest point along the verge in direction `dir` (then the other way) that the camera can't see: where a
   * shopper comes from. Null when every point is in view. Without a road (tests): the gate itself.
   */
  private offscreenVergeX(dir: 1 | -1): XZ | null {
    if (!this.stall.road) return { x: this.stall.door.x, z: this.stall.door.z };
    const z = this.vergeZ();
    const [lo, hi] = this.vergeSpan();
    for (const d of [dir, -dir]) {
      for (let k = 6; k <= WALK_FAR; k += 1.5) {
        const x = this.stall.door.x + d * k;
        if (x < lo || x > hi) break;
        if (!inView(this.ctx, x, z, 2.5)) return { x, z };
      }
    }
    return null;
  }

  private slot(i: number): XZ {
    const s = this.stall;
    return { x: s.front.x + s.step.x * i, z: s.front.z + s.step.z * i };
  }

  update(dt: number): void {
    this.clock += dt;
    if (dt <= 0) return;
    this.spawnStep(dt);
    for (let i = 0; i < this.queue.length; i++) this.stepQueued(this.queue[i]!, i, dt);
    // B1: never more than LEAVE_MAX on their way out (the oldest fades first)
    for (let i = 0, over = this.leaving.length - LEAVE_MAX; i < this.leaving.length && over > 0; i++) {
      const c = this.leaving[i]!;
      if (c.fade > 0) over--;
      else if (c.path.length <= 1) {
        c.fade = FADE;
        over--;
      }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const c = this.leaving[i]!;
      if (c.fade > 0) {
        c.fade -= dt;
        c.speed = approach(c.speed, 0, ACCEL * dt);
        c.group.scale.setScalar(Math.max(0.001, c.fade / FADE));
        if (c.fade <= 0) {
          this.despawn(i);
          continue;
        }
        this.animate(c, dt);
        continue;
      }
      const done = this.walk(c, dt, true);
      // gone only out of sight: on the verge walk away (or at its end, once the camera looks away)
      const p = c.group.position;
      if ((c.path.length <= 1 || done) && !inView(this.ctx, p.x, p.z, 2.5)) {
        this.despawn(i);
        continue;
      }
      if (done) {
        c.speed = 0;
        c.velocity.set(0, 0, 0);
        // B1: still in view at the far end after a while: a gentle fade (never a pile of shoppers there)
        if ((c.stood += dt) >= STAND_MAX) c.fade = FADE;
      }
      if (c.bubbleOn) {
        c.timer -= dt;
        if (c.timer <= 0) {
          c.bubbleOn = false;
          this.ctx.tweens.popOut(c.bubble.sprite, { duration: 0.25 });
        }
      }
      this.animate(c, dt);
    }
  }

  // ---- spawning -------------------------------------------------------------------------------------------------
  private spawnStep(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    if (this.queue.length >= TRADE_POST.shopQueue || (this.queue.length > 0 && this.stall.pile.total === 0)) {
      this.spawnTimer = 0.5;
      return;
    }
    const scale = buyerScale(this.stall.era, this.stall.boost());
    this.spawnTimer = randRange(TRADE_POST.shopGap[0], TRADE_POST.shopGap[1]) / scale.rate;
    const from = this.offscreenVergeX(Math.random() < 0.5 ? 1 : -1);
    if (from === null) {
      this.spawnTimer = 0.4;
      return;
    }
    const rested = this.pool.findIndex((q) => this.clock - (this.freedAt.get(q) ?? -Infinity) >= REST);
    const c = (rested >= 0 ? this.pool.splice(rested, 1)[0] : undefined) ?? new Shopper(this.ctx, `npc:shopper${this.stall.era}:${this.created}`, this.created % VARIANTS, this.stall.era);
    this.created++;
    const s = this.stall;
    c.mode = 'in';
    c.kind = null;
    c.want = Math.min(SHOP_MAX, Math.round(randRange(TRADE_POST.shopWant[0] - 0.49, TRADE_POST.shopWant[1] + 0.49) * scale.size));
    c.speed = 0;
    c.takeTimer = 0;
    c.idle = 0;
    c.timer = 0;
    c.kerb = 0;
    c.stood = 0;
    c.fade = 0;
    c.held = false;
    c.bubbleOn = false;
    c.bubble.sprite.visible = false;
    c.stack.clear();
    c.rig.setCarrying(false);
    c.rig.setSeated(false);
    const vz = this.vergeZ();
    const doorX = s.door.x + randRange(-0.3, 0.3);
    if (!s.road) {
      // no road (tests): in at the gate as before
      c.group.position.set(doorX, 0, s.door.z);
      c.path = [s.entry];
    } else {
      c.group.position.set(from.x, 0, vz);
      c.path = [{ x: doorX, z: vz }, { x: doorX, z: s.door.z }, s.entry];
    }
    c.yaw = yawFromDir(c.path[0]!.x - c.group.position.x, c.path[0]!.z - c.group.position.z);
    c.rig.root.rotation.y = c.yaw;
    this.ctx.scene.add(c.group);
    this.queue.push(c);
  }

  private despawn(i: number): void {
    const c = this.leaving[i]!;
    this.leaving.splice(i, 1);
    CROSSERS.delete(c.cross);
    c.stack.clear();
    this.ctx.tweens.killTweensOf(c.bubble.sprite);
    this.ctx.tweens.killTweensOf(c.group);
    c.bubble.sprite.visible = false;
    c.group.removeFromParent();
    c.group.scale.setScalar(1);
    this.pool.push(c);
    this.freedAt.set(c, this.clock);
  }

  // ---- queue ----------------------------------------------------------------------------------------------------
  private stepQueued(c: Shopper, index: number, dt: number): void {
    // walk the entry path first, then to the current place in line (it moves up as the line shortens)
    let there = false;
    if (c.path.length > 0) this.walk(c, dt, false);
    else {
      const t = this.slot(index);
      there = this.moveToward(c, t.x, t.z, dt, false);
    }
    if (there) c.yaw = dampAngle(c.yaw, this.stall.faceYaw, TURN, dt);
    c.rig.root.rotation.y = c.yaw;
    this.animate(c, dt);
    if (index !== 0 || !there) return;
    if (c.mode === 'in' || c.mode === 'queue') {
      c.mode = 'queue';
      this.serve(c, dt);
    } else if (c.mode === 'paid') {
      c.timer -= dt;
      if (c.timer <= 0) this.sendAway(c);
    }
  }

  private plentiful(): MaterialKind | null {
    let best: MaterialKind | null = null;
    let n = 0;
    for (const k of MATERIAL_KINDS) {
      const v = this.stall.pile.count(k);
      if (v > n) {
        n = v;
        best = k;
      }
    }
    return best;
  }

  private serve(c: Shopper, dt: number): void {
    const pile = this.stall.pile;
    if (c.stack.size === 0) {
      const k = this.plentiful();
      if (k && (c.kind === null || pile.count(c.kind) === 0)) {
        c.kind = k;
        c.idle = 0;
      }
      if (c.kind === null) c.kind = this.stall.fallback;
    }
    const kind = c.kind!;
    if (!c.bubbleOn) {
      c.bubbleOn = true;
      c.bubble.sprite.visible = true;
      this.ctx.tweens.popIn(c.bubble.sprite);
    }
    const have = c.stack.size;
    c.bubble.show(kind, `${have}/${c.want}`);
    c.takeTimer -= dt;
    c.idle += dt;
    if (c.takeTimer <= 0 && have < c.want && pile.count(kind) > 0) {
      c.takeTimer = TIMING.dockTakeInterval / Math.min(TIMING.dockLoadMax, Math.max(1, this.stall.boost()));
      if (transferOne(this.ctx, pile, c.stack, [kind])) {
        c.idle = 0;
        c.rig.setCarrying(true);
      }
    }
    const landed = c.stack.count(kind);
    if (landed >= c.want || (landed > 0 && landed === have && c.idle >= TRADE_POST.patience)) this.pay(c, landed);
  }

  private pay(c: Shopper, count: number): void {
    c.rig.armsAnchor.getWorldPosition(tmp);
    tmp.y += 0.4;
    this.stall.pay(c.kind!, count, tmp);
    c.mode = 'paid';
    c.timer = 0.6;
    c.rig.cheer();
    c.bubble.show('check');
    this.ctx.tweens.popIn(c.bubble.sprite, { duration: 0.35 });
  }

  private sendAway(c: Shopper): void {
    const i = this.queue.indexOf(c);
    if (i >= 0) this.queue.splice(i, 1);
    const s = this.stall;
    c.mode = 'out';
    c.timer = 1.0;
    if (!s.road) c.path = [s.entry, s.door, { x: s.door.x, z: s.door.z - s.inward * 1.6 }];
    else {
      const vz = this.vergeZ();
      const [lo, hi] = this.vergeSpan();
      // B1: either way along the road, but never toward a road end a few metres off (the shopper stood there in view)
      const room = (d: number): number => (d > 0 ? hi - s.door.x : s.door.x - lo);
      let dir = Math.random() < 0.5 ? 1 : -1;
      if (room(dir) < LEAVE_MIN && room(-dir) > room(dir)) dir = -dir;
      const far = Math.max(lo, Math.min(hi, s.door.x + dir * LEAVE_FAR));
      // onto the verge a step toward where it is going, clear of anyone waiting there to cross the other way
      c.path = [s.entry, s.door, { x: s.door.x + dir * 1.0, z: vz }, { x: far, z: vz }];
    }
    this.leaving.push(c);
  }

  // ---- movement -------------------------------------------------------------------------------------------------
  /** Walk the waypoint list; true once its last point is reached (fading out on the last stretch when leaving). */
  private walk(c: Shopper, dt: number, leaving: boolean): boolean {
    const p = c.path[0];
    if (!p) return true;
    const last = c.path.length === 1;
    const lane = this.road() && this.lane;
    if (lane) {
      // B7: wait at the kerb while a vehicle comes, and once out on the road the buyers brake for us
      const at = c.group.position;
      // one waiting at the kerb right ahead: wait behind them, not on their spot (never out on the road)
      c.held = !inRect(lane, at) && this.kerbQueue(c, p);
      if (c.held) {
        this.shuffle(c, dt);
        c.speed = 0;
        c.velocity.set(0, 0, 0);
        return false;
      }
      // the buyers' line moving up past the gate goes first (it would stop for us, and the counter waits)
      const wait = kerbWait(at, p, [lane], carefully(trafficNow(this.ctx.time.elapsed))) || (!inRect(lane, at) && this.lineBlocks(at, p));
      if (wait && c.kerb < KERB_PATIENCE) {
        c.kerb += dt;
        if (!inRect(lane, at)) this.shuffle(c, dt);
        c.speed = 0;
        c.velocity.set(0, 0, 0);
        c.yaw = dampAngle(c.yaw, yawFromDir(p.x - at.x, p.z - at.z), TURN, dt);
        c.rig.root.rotation.y = c.yaw;
        return false;
      }
      if (!wait) c.kerb = 0;
      if (inRect(lane, at)) {
        const d = Math.hypot(p.x - at.x, p.z - at.z) || 1;
        const k = Math.min(CROSS_AHEAD, d) / d;
        c.cross.x = at.x + (p.x - at.x) * k;
        c.cross.z = at.z + (p.z - at.z) * k;
        CROSSERS.add(c.cross);
      } else CROSSERS.delete(c.cross);
    }
    if (this.moveToward(c, p.x, p.z, dt, !last || leaving)) {
      c.path.shift();
      if (c.path.length === 0) return true;
    }
    if (leaving) c.rig.root.rotation.y = c.yaw;
    return false;
  }

  /** A waiting shopper shuffles along the kerb (never toward the road) until it stands KERB_SPACING from the other waiters. */
  private shuffle(c: Shopper, dt: number): void {
    const lane = this.lane!;
    const alongX = lane.maxX - lane.minX >= lane.maxZ - lane.minZ;
    const axis = alongX ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const others: XZ[] = [];
    for (const list of [this.queue, this.leaving]) for (const o of list) if (o !== c && (o.kerb > 0 || o.held) && !inRect(lane, o.group.position)) others.push({ x: o.group.position.x, z: o.group.position.z });
    const at = c.group.position;
    const shift = kerbShift({ x: at.x, z: at.z }, others, axis, KERB_SPACING, this.queue.indexOf(c) % 2 ? 1 : -1);
    if (!shift) return;
    const step = Math.sign(shift) * Math.min(Math.abs(shift), KERB_SHUFFLE * dt);
    at.x += axis.x * step;
    at.z += axis.z * step;
  }

  /** True while the buyer line moves up and `at` → `to` steps onto the road. */
  private lineBlocks(at: XZ, to: XZ): boolean {
    if (!this.stall.lineMoving?.()) return false;
    const d = Math.hypot(to.x - at.x, to.z - at.z);
    if (d < 0.05) return false;
    const k = Math.min(0.6, d) / d;
    return inRect(this.lane!, { x: at.x + (to.x - at.x) * k, z: at.z + (to.z - at.z) * k });
  }

  /** True while another shopper waits at the kerb (or in line behind one there) just ahead of `c`, going its way to `to`. */
  private kerbQueue(c: Shopper, to: XZ): boolean {
    const at = c.group.position;
    const dx = to.x - at.x;
    const dz = to.z - at.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return false;
    for (const list of [this.queue, this.leaving]) {
      for (const o of list) {
        if (o === c || (o.kerb <= 0 && !o.held)) continue;
        // only someone going the same way (not one coming the other way through the gate)
        const q = o.path[0];
        if (!q || (q.x - o.group.position.x) * dx + (q.z - o.group.position.z) * dz <= 0) continue;
        const ox = o.group.position.x - at.x;
        const oz = o.group.position.z - at.z;
        const along = (ox * dx + oz * dz) / len;
        if (along > 0 && along < KERB_GAP && Math.abs(ox * dz - oz * dx) / len < 0.45) return true;
      }
    }
    return false;
  }

  private moveToward(c: Shopper, tx: number, tz: number, dt: number, passThrough: boolean): boolean {
    const p = c.group.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.02) {
      p.x = tx;
      p.z = tz;
      if (!passThrough) c.speed = 0;
      c.velocity.set(0, 0, 0);
      return true;
    }
    const max = TRADE_POST.walkSpeed;
    c.speed = approach(c.speed, passThrough ? max : Math.min(max, 1.0 + dist * 4), ACCEL * dt);
    const step = c.speed * dt;
    const nx = dx / dist;
    const nz = dz / dist;
    c.yaw = dampAngle(c.yaw, yawFromDir(dx, dz), TURN, dt);
    c.velocity.set(nx * c.speed, 0, nz * c.speed);
    if (step >= dist) {
      p.x = tx;
      p.z = tz;
      if (!passThrough) c.speed = 0;
      return true;
    }
    p.x += nx * step;
    p.z += nz * step;
    return false;
  }

  private animate(c: Shopper, dt: number): void {
    c.rig.animate(dt, c.speed / PLAYER.speed);
    c.stack.update(dt, c.velocity);
    if (c.bubble.sprite.visible) c.bubble.sprite.position.y = c.bubbleY + Math.sin((this.ctx.time.elapsed + c.bob) * 4.5) * 0.04;
  }
}
