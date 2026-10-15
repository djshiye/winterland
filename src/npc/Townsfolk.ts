/**
 * [T3 — townsfolk] Wave 9 cosy crowd: wanderers on the village street and the market square, staff at their jobs, and
 * buyers at the town's shops. Rendered by npc/Crowd.ts (instanced: a fixed handful of draw calls for every person).
 *
 * CONTRACT (keep every public signature; T3 owns the implementation; Level constructs + updates it):
 * - Buyers: per open shop (town.shops(), read live), spawn one every TOWN.buyerGap[level] s (± jitter, ×
 *   ctx.rush.spawnMult while a rush runs) up to TOWN.queuePerShop queued; walk in from a LAYOUT.town.entrances
 *   point, queue at shop.queueSpot(i), at the front take want ∈ def.want items from shop.counter (transfer.ts, one
 *   per TIMING.npcTakeInterval; goods land in the buyer's basket and are released), pay
 *   salePrice(state, def.output, def.price, n) into shop.till.pay(amount, from), stats.goodsSold += n, emit 'sale'
 *   { buyer: 'townsfolk', kind }, cheer, walk out. A shop that closes (none in 9a) sends its queue away.
 * - Wanderers: TOWN.wanderers[level] (halved on Low quality / ctx.renderer quality) people stroll between spots
 *   (town/spots.ts benches / stalls / snowman / tree ring, the village street) once the village / town are revealed;
 *   they sit, chat, look at the tree; never walk through solids (stay in the walk rects + go around the tree).
 * - loadedByLot(lot): goods already handed to buyers of that lot who haven't paid yet (the save puts them back).
 *
 * Implementation notes
 * - Everyone is a pooled `Agent` (TOWN.crowdMax of them, created once) bound to a CrowdPerson of the instanced Crowd.
 *   Staff (town.staffSpots() + one stallholder per stall) and buyers take instances first; wanderers fill the rest.
 * - Navigation is npc/CrowdNav.ts: straight legs between the street / corridor / square joints, bent around the tree,
 *   snowman, benches and stalls. A little separation keeps walkers from stacking.
 * - A buyer's basket is an ItemHolder: goods fly into it, are released on landing, and stay counted in `size` until the
 *   buyer pays (that is what loadedByLot reports, like CustomerQueue.loadedUnits).
 * - Night (ctx.dayNight.darkness): fewer wanderers, some carry an emissive lantern (+ a halo).
 * - Debug: `forceWanderers` (number | null) overrides the level-based wanderer target; `seedWanderers()` fills it at once.
 */
import * as THREE from 'three';
import { AMENITY_IDS, LAYOUT, TIMING, TOWN, type AmenityId, type ProductId, type XZ } from '../config';
import { approach, clamp, dampAngle, randInt, randRange } from '../core/math';
import { salePrice } from '../core/demand';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { transferOne } from '../items/transfer';
import type { ShopSpot } from '../town/types';
import type { Town } from '../town/Town';
import { BENCHES, SNOWMAN, STALLS, TREE_RING, type Spot, AMENITY_SPOTS } from '../town/spots';
import { amenityFrame } from '../town/rules';
import { Crowd, COAT_COLORS, GOODS_COLORS, TRIM_COLORS, type CrowdPerson } from './Crowd';
import { NAV, OWNER_SNOWMAN, Path, insideObstacle, lotDoor, nearestHome, planPath, planTownPath, seatPoint, zoneOf } from './CrowdNav';

// --- tuning --------------------------------------------------------------------
const BUYER_SPEED = 2.1;
const STROLL_SPEED: readonly [number, number] = [0.95, 1.35];
const KID_SPEED = 2.5;
const KID_CHANCE = 0.18;
const RUSH_HURRY = 1.25;
const SPAWN_GAP = 0.9;
const LIFETIME: readonly [number, number] = [70, 160];
const CHEER_TIME = 0.9;
/** Seconds a buyer waits at the front of an empty counter before giving up. */
const PATIENCE = 45;
const WAVE_RANGE = 3.4;
const SNOWMAN_SLOTS = 6;
const SNOWMAN_RING = 1.05;
/** Snowman ring slot indices (of SNOWMAN_SLOTS) whose point stays clear of the snowman park (rect + 0.3 m). */
const SNOW_SLOT_KEPT: readonly number[] = (() => {
  const r = amenityFrame('snowmanPark').rect;
  const m = 0.3;
  return Array.from({ length: SNOWMAN_SLOTS }, (_, i) => i).filter((i) => {
    const ang = (i / SNOWMAN_SLOTS) * Math.PI * 2 + 0.5;
    const x = SNOWMAN.x + Math.sin(ang) * SNOWMAN_RING;
    const z = SNOWMAN.z + Math.cos(ang) * SNOWMAN_RING;
    return !(x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m);
  });
})();
const STAFF_REFRESH = 0.3;
const NIGHT_LANTERN_FROM = 0.35;
const NIGHT_FEWER = 0.55;
const STROLL_STREET_X: readonly [number, number] = [3.35, 5.85];
const STROLL_STREET_Z: readonly [number, number] = [12.0, 26.0];

// --- wave 13 "more life" tuning -------------------------------------------------
/** Staff walk home when it gets this dark and come back when it is lighter than the second value (hysteresis). */
const HOME_DARK = 0.6;
const WORK_DARK = 0.45;
const COMMUTE_SPEED = 1.25;
const NIGHT_MARKET_LEVEL = 4;
const NIGHT_MARKET_BONUS = 6;
const CAROL_LEVEL = 3;
const CAROL_DARK = 0.5;
const CAROL_STOP_DARK = 0.45;
const CAROL_SIZE = 3;
const CAROL_BEAT = 1.6;
const CAROL_VOLUME = 0.35;
const CAROL_HEAR = 14;
const SKATE_SPEED = 1.6;
const SKATERS_MAX = 3;
/** The soft major-key motif the carolers hum (pitch multipliers of the 'chime' sound). */
export const CAROL_MOTIF: readonly number[] = [1, 1.25, 1.5, 1.25, 1.125, 1];

/** Pitch of carol note number `step` (the motif loops). */
export function carolPitch(step: number): number {
  const n = CAROL_MOTIF.length;
  return CAROL_MOTIF[((Math.floor(step) % n) + n) % n]!;
}

/** Index of the carol beat at group-singing time `t` (one note every CAROL_BEAT seconds). */
export function carolBeat(t: number): number {
  return Math.floor(t / CAROL_BEAT);
}

/** Night market: Winter City and above, after dark. */
export function nightMarket(level: number, darkness: number): boolean {
  return level >= NIGHT_MARKET_LEVEL && darkness > 0.5;
}

/** A caroler trio may form (`active` = one already sings: it keeps going until it is clearly day again). */
export function carolersEligible(level: number, darkness: number, active = false): boolean {
  return level >= CAROL_LEVEL && (active ? darkness > CAROL_STOP_DARK : darkness > CAROL_DARK);
}

/** Staff are home for the night: leave above HOME_DARK, return below WORK_DARK, otherwise keep `wasHome`. */
export function staffAtHome(darkness: number, wasHome: boolean): boolean {
  if (darkness > HOME_DARK) return true;
  if (darkness < WORK_DARK) return false;
  return wasHome;
}

/** Stall browsing weight: doubled while the night market runs. */
export function stallWeight(base: number, market: boolean): number {
  return market ? base * 2 : base;
}

/**
 * How many wanderers the town wants. Day: TOWN.wanderers[level] (halved on Low quality). Night: NIGHT_FEWER fewer,
 * except at the night market (level >= 4, dark) where it is +6 instead. Never above `cap`.
 */
export function wandererTargetFor(level: number, darkness: number, low: boolean, cap: number): number {
  const lvl = Math.max(0, Math.min(level, TOWN.wanderers.length - 1));
  const base = TOWN.wanderers[lvl]!;
  const q = low ? 0.5 : 1;
  const n = nightMarket(level, darkness) ? (base + NIGHT_MARKET_BONUS) * q : base * q * (1 - NIGHT_FEWER * darkness);
  return Math.max(0, Math.min(Math.round(n), cap));
}

const amenitySpotsOf = (id: AmenityId): readonly Spot[] => AMENITY_SPOTS[id] ?? [];

const tmpV = new THREE.Vector3();
const tmpXZ: XZ = { x: 0, z: 0 };
const tmpSeat = { x: 0, z: 0, yaw: 0, ax: 0, az: 0 };

type Kind = 'none' | 'buyer' | 'wanderer' | 'staff';
type Mode =
  | 'in' // buyer: walking to its queue place
  | 'wait' // buyer: queued
  | 'paid' // buyer: cheering
  | 'out' // buyer / wanderer: walking to an exit
  | 'walk' // wanderer: following a path to an activity
  | 'idle' // wanderer: standing around (timer)
  | 'sit'
  | 'standup'
  | 'chat'
  | 'ring' // standing at the tree / snowman / a stall / the bandstand / the snowman park
  | 'carol' // wanderer: singing at the tree
  | 'work'; // staff
type Act = 'stroll' | 'sit' | 'tree' | 'snow' | 'stall' | 'chat' | 'leave' | 'carol' | 'cafe' | 'pond' | 'band' | 'park';

/** A buyer's hands: goods fly in, are released on landing, and count until the buyer pays. */
class Basket implements ItemHolder {
  readonly id: string;
  landed = 0;
  pending = 0;
  kind: ItemKind = 'bread';
  capacity = 8;
  /** Bumped whenever the agent is reused: flights still in the air for the previous visitor must not count. */
  private epoch = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly agent: Agent,
    n: number,
  ) {
    this.id = `npc:townsfolk:${n}`;
  }

  /** Landed + in flight: the unpaid goods. */
  get size(): number {
    return this.landed + this.pending;
  }

  /** New visitor: forget everything (stale flights still land and are released, but are not counted). */
  reset(kind: ItemKind, capacity: number): void {
    this.kind = kind;
    this.capacity = capacity;
    this.landed = 0;
    this.pending = 0;
    this.epoch++;
  }

  canAccept(kind: ItemKind): boolean {
    return kind === this.kind && this.size < this.capacity;
  }

  reserve(_item: Item): Slot {
    this.pending++;
    return { holder: this, epoch: this.epoch } as Slot;
  }

  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    const a = this.agent;
    const s = a.p ? a.p.scale * (a.p.kid ? 0.72 : 1) : 1;
    return out.set(a.x + Math.sin(a.yaw) * 0.5 * s, 0.62 * s, a.z + Math.cos(a.yaw) * 0.5 * s);
  }

  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }

  receive(item: Item, slot: Slot): void {
    if ((slot as { epoch?: number }).epoch !== this.epoch) {
      this.ctx.items.release(item); // a previous visitor's goods
      return;
    }
    this.pending = Math.max(0, this.pending - 1);
    this.landed++;
    this.ctx.items.release(item);
    if (this.agent.p) this.agent.p.basket = true;
  }

  cancel(slot: Slot): void {
    if ((slot as { epoch?: number }).epoch !== this.epoch) return;
    this.pending = Math.max(0, this.pending - 1);
  }

  count(kind?: ItemKind): number {
    return kind === undefined || kind === this.kind ? this.landed : 0;
  }

  take(_kind?: ItemKind): Item | null {
    return null;
  }
}

class Agent {
  p: CrowdPerson | null = null;
  kind: Kind = 'none';
  mode: Mode = 'idle';
  readonly path = new Path();
  readonly basket: Basket;
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  maxSpeed = 1.2;
  /** Heading to settle on when stopped (NaN = keep). */
  faceYaw = Number.NaN;
  timer = 0;
  rnd = 0;
  fading = false;
  // wanderer
  act: Act = 'stroll';
  life = 0;
  /** Seconds a wanderer stays before heading home. */
  limit = 100;
  partner: Agent | null = null;
  arrived = false;
  /** Seat / slot reservation: 'bench:<i*2+seat>' style numeric index in the matching table, -1 none. */
  seatIdx = -1;
  ringIdx = -1;
  snowIdx = -1;
  standYaw = 0;
  approachX = 0;
  approachZ = 0;
  waveT = 0;
  waveCool = 0;
  talkT = 0;
  hopT = 0;
  lantern = false;
  /** Amenity spot reservation (cafe / bandstand / park) and the pond loop's current rim index. */
  amenId: AmenityId | null = null;
  amenIdx = -1;
  baseSpeed = 1.2;
  // staff: 0 at work, 1 walking home / gone, 2 walking back to the spot
  commute: 0 | 1 | 2 = 0;
  lot = -1;
  // buyer
  shop: ShopSpot | null = null;
  want = 3;
  takeT = 0;
  patience = 0;
  tx = Number.NaN;
  tz = Number.NaN;
  exitX = 0;
  exitZ = 0;

  constructor(
    ctx: GameContext,
    readonly id: number,
  ) {
    this.basket = new Basket(ctx, this, id);
  }
}

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;

export class Townsfolk {
  /** Debug: override the level-based wanderer target (null = use TOWN.wanderers). */
  forceWanderers: number | null = null;

  readonly crowd: Crowd;
  private readonly agents: Agent[] = [];
  private readonly freeAgents: Agent[] = [];
  private readonly live: Agent[] = [];
  /** One slot per town staff spot: null while the person is home for the night (no crowd instance used). */
  private readonly staff: (Agent | null)[] = [];
  private readonly staffAway: boolean[] = [];
  /** Staff of a demolished building, walking home before they leave the crowd. */
  private readonly staffLeaving: Agent[] = [];
  private staffHome = false;
  private readonly carolers: Agent[] = [];
  private carolOn = false;
  private carolT = 0;
  private carolBeatNo = -1;
  private carolCheerT = 0;
  private carolCheerCool = 8;
  private carolFormT = 0;
  private readonly amenSlots: Partial<Record<AmenityId, (Agent | null)[]>> = {};
  private readonly queues = new Map<number, Agent[]>();
  private readonly buyTimers = new Map<number, number>();
  private readonly seats: (Agent | null)[] = new Array(BENCHES.length * 2).fill(null);
  private readonly ring: (Agent | null)[] = new Array(TREE_RING.length).fill(null);
  private readonly snow: (Agent | null)[] = new Array(SNOW_SLOT_KEPT.length).fill(null);
  private readonly stallSpots: { x: number; z: number; yaw: number; stall: number; taken: Agent | null }[] = [];
  private t = 0;
  private spawnT = 1;
  private staffT = 0;
  private seeded = false;
  private stallholders: Agent[] = [];
  private nBuyers = 0;
  private nWanderers = 0;

  constructor(
    readonly ctx: GameContext,
    readonly town: Town,
  ) {
    this.crowd = new Crowd(TOWN.crowdMax);
    ctx.scene.add(this.crowd.group);
    for (let i = 0; i < this.crowd.capacity; i++) {
      const a = new Agent(ctx, i);
      this.agents.push(a);
    }
    for (let i = this.agents.length - 1; i >= 0; i--) this.freeAgents.push(this.agents[i]!);
    // browse spots in front of each stall (the stallholder is behind it)
    STALLS.forEach((s, i) => {
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      const px = Math.cos(s.yaw);
      const pz = -Math.sin(s.yaw);
      for (const k of [-0.5, 0.5]) {
        this.stallSpots.push({ x: s.x + fx * 1.2 + px * k, z: s.z + fz * 1.2 + pz * k, yaw: s.yaw + Math.PI, stall: i, taken: null });
      }
    });
  }

  /** Live people (buyers + wanderers). */
  get count(): number {
    return this.nBuyers + this.nWanderers;
  }

  /** Buyers currently in town (queueing, cheering or leaving). */
  get buyers(): number {
    return this.nBuyers;
  }

  get wanderers(): number {
    return this.nWanderers;
  }

  /** Staff + stallholders on show. */
  get staffCount(): number {
    let n = this.stallholders.length;
    for (const a of this.staff) if (a) n++;
    return n;
  }

  /** Everyone drawn by the instanced crowd. */
  get visible(): number {
    return this.crowd.count;
  }

  /** Draw calls the crowd costs right now (shadow pass excluded). */
  get drawCalls(): number {
    return this.crowd.drawCalls;
  }

  /**
   * Goods already handed to buyers of `lot` who haven't paid yet (landed or still flying). The save puts them back on the
   * shop's counter; paid / leaving buyers are excluded (already counted as sold).
   */
  loadedByLot(lot: number): number {
    const q = this.queues.get(lot);
    if (!q) return 0;
    let n = 0;
    for (const a of q) if (a.mode === 'in' || a.mode === 'wait') n += a.basket.size;
    return n;
  }

  /** Debug: fill the wanderer target at once, scattered over the open areas (people pop in). */
  seedWanderers(): void {
    const target = this.wandererTarget();
    for (let i = this.nWanderers; i < target; i++) if (!this.spawnWanderer(true)) break;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.t += dt;
    const ctx = this.ctx;
    const town = this.town;
    const shops = town.revealed ? town.shops() : EMPTY_SHOPS;

    this.refreshStaff(dt);
    this.buyerSpawns(dt, shops);
    this.manageWanderers(dt);
    this.manageCarolers(dt);

    // step everybody (backwards: agents may despawn)
    for (let i = this.live.length - 1; i >= 0; i--) {
      const a = this.live[i]!;
      switch (a.kind) {
        case 'buyer':
          this.stepBuyer(a, dt);
          break;
        case 'wanderer':
          this.stepWanderer(a, dt);
          break;
        default:
          break;
      }
    }
    // buyer queues (after steps so that targets follow the queue shuffles at once)
    this.serveQueues(dt, shops);
    this.separate(dt);

    for (const a of this.live) this.sync(a, dt);
    const dark = ctx.dayNight ? ctx.dayNight.darkness : 0;
    this.crowd.update(this.t, dark, ctx.renderer.quality === 'high');
  }

  // =========================================================================
  // Pool
  // =========================================================================
  private acquire(kind: Kind, coat: number, trim: number, goods = GOODS_COLORS.default!): Agent | null {
    const a = this.freeAgents.pop();
    if (!a) return null;
    const p = this.crowd.acquire(coat, trim, goods);
    if (!p) {
      this.freeAgents.push(a);
      return null;
    }
    a.p = p;
    a.kind = kind;
    a.mode = 'idle';
    a.path.clear();
    a.speed = 0;
    a.faceYaw = Number.NaN;
    a.timer = 0;
    a.rnd = Math.random();
    a.fading = false;
    a.act = 'stroll';
    a.life = 0;
    a.partner = null;
    a.arrived = false;
    a.seatIdx = a.ringIdx = a.snowIdx = -1;
    a.waveT = 0;
    a.waveCool = randRange(1, 6);
    a.talkT = 0;
    a.hopT = 0;
    a.lantern = false;
    a.amenId = null;
    a.amenIdx = -1;
    a.baseSpeed = 1.2;
    a.commute = 0;
    a.lot = -1;
    a.shop = null;
    a.tx = a.tz = Number.NaN;
    a.basket.reset('bread', 8);
    this.live.push(a);
    if (kind === 'buyer') this.nBuyers++;
    else if (kind === 'wanderer') this.nWanderers++;
    return a;
  }

  private release(a: Agent): void {
    if (!a.p) return;
    if (a.kind === 'buyer') this.nBuyers--;
    else if (a.kind === 'wanderer') this.nWanderers--;
    this.freeSpots(a);
    const ci = this.carolers.indexOf(a);
    if (ci >= 0) this.carolers.splice(ci, 1);
    if (a.partner && a.partner.partner === a) a.partner.partner = null;
    a.partner = null;
    this.crowd.release(a.p);
    a.p = null;
    a.kind = 'none';
    const i = this.live.indexOf(a);
    if (i >= 0) this.live.splice(i, 1);
    this.freeAgents.push(a);
  }

  private freeSpots(a: Agent): void {
    if (a.seatIdx >= 0) this.seats[a.seatIdx] = null;
    if (a.ringIdx >= 0) this.ring[a.ringIdx] = null;
    if (a.snowIdx >= 0) this.snow[a.snowIdx] = null;
    for (const s of this.stallSpots) if (s.taken === a) s.taken = null;
    if (a.amenId) {
      const sl = this.amenSlots[a.amenId];
      if (sl && sl[a.amenIdx] === a) sl[a.amenIdx] = null;
    }
    if (a.act === 'pond') a.maxSpeed = a.baseSpeed; // back to a stroll after skating
    a.amenId = null;
    a.amenIdx = -1;
    a.seatIdx = a.ringIdx = a.snowIdx = -1;
  }

  // =========================================================================
  // Sync to the crowd (animation channels)
  // =========================================================================
  private sync(a: Agent, dt: number): void {
    const p = a.p!;
    p.x = a.x;
    p.z = a.z;
    p.yaw = a.yaw;
    const sp = a.speed;
    const walk = clamp(sp / 1.4, 0, 1);
    p.walk = approach(p.walk, walk, dt * 6);
    p.phase += dt * sp * 3.4;
    // pop-in / pop-out
    p.appear = a.fading ? Math.max(0, p.appear - dt * 2.5) : Math.min(1, p.appear + dt * 2.5);
    // hops of a happy kid
    if (a.hopT > 0) {
      a.hopT -= dt;
      p.cheer = Math.max(p.cheer, clamp(a.hopT * 3, 0, a.act === 'band' ? 1 : 0.6));
    } else if (a.kind === 'wanderer' && a.mode !== 'carol') {
      p.cheer = approach(p.cheer, 0, dt * 4); // the hop is over (the carolers drive their own cheer)
    }
    // sitting eases
    const wantSit = a.mode === 'sit' ? 1 : 0;
    p.sit = approach(p.sit, wantSit, dt * 3.2);
    // lantern in hand at night
    p.lantern = approach(p.lantern, a.lantern ? 1 : 0, dt * 3);
    if (a.fading && p.appear <= 0.001 && a.kind !== 'staff') this.release(a);
  }

  // =========================================================================
  // Movement
  // =========================================================================
  /** Follow the path; returns true while moving. */
  private walkPath(a: Agent, dt: number): boolean {
    const path = a.path;
    if (path.i >= path.n) {
      a.speed = approach(a.speed, 0, 14 * dt);
      if (!Number.isNaN(a.faceYaw)) a.yaw = dampAngle(a.yaw, a.faceYaw, 9, dt);
      return false;
    }
    const last = path.i === path.n - 1;
    const tx = path.x[path.i]!;
    const tz = path.z[path.i]!;
    const dx = tx - a.x;
    const dz = tz - a.z;
    const dist = Math.hypot(dx, dz);
    const rush = a.kind === 'buyer' && this.ctx.rush.active ? RUSH_HURRY : 1;
    const top = a.maxSpeed * rush;
    const want = last ? Math.min(top, 0.55 + dist * 3.5) : top;
    a.speed = approach(a.speed, want, 9 * dt);
    const step = a.speed * dt;
    if (dist <= step + (last ? 0.01 : 0.2)) {
      if (last) {
        a.x = tx;
        a.z = tz;
        a.speed = 0;
      } else {
        a.x += (dx / Math.max(dist, 1e-4)) * Math.min(step, dist);
        a.z += (dz / Math.max(dist, 1e-4)) * Math.min(step, dist);
      }
      path.i++;
    } else {
      a.x += (dx / dist) * step;
      a.z += (dz / dist) * step;
    }
    if (dist > 0.04) a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 12, dt);
    return true;
  }

  private goTo(a: Agent, x: number, z: number, ignore = 0): void {
    planPath(a.path, a.x, a.z, x, z, ignore);
  }

  /** Push walkers that overlap apart (cheap O(n²) over ≤ 48 people). */
  private separate(dt: number): void {
    const L = this.live;
    const k = Math.min(1, 6 * dt) * 0.5;
    for (let i = 0; i < L.length; i++) {
      const a = L[i]!;
      if (a.speed < 0.3 || (a.kind === 'staff' && a.commute === 0)) continue;
      for (let j = 0; j < L.length; j++) {
        if (i === j) continue;
        const b = L[j]!;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.3 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (0.55 - d) * k * (b.speed < 0.3 ? 2 : 1);
        a.x += (dx / d) * push;
        a.z += (dz / d) * push;
      }
    }
  }

  // =========================================================================
  // Staff + stallholders
  // =========================================================================
  private darkness(): number {
    return this.ctx.dayNight ? this.ctx.dayNight.darkness : 0;
  }

  /** Doorsteps of the built townhouses (state is the truth; the Town object is not asked). */
  private homeDoors(out: XZ[]): XZ[] {
    out.length = 0;
    const lots = this.ctx.state.town.lots;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i]!;
      if (l.building === 'townhouse' && l.tier >= 0) out.push(lotDoor(i, { x: 0, z: 0 }));
    }
    return out;
  }

  private refreshStaff(dt: number): void {
    this.staffT -= dt;
    // staff animate every frame (cheap); the list is re-read a few times a second
    if (this.staffT <= 0) {
      this.staffT = STAFF_REFRESH;
      const revealed = this.town.revealed;
      this.staffHome = staffAtHome(this.darkness(), this.staffHome);
      const home = this.staffHome && revealed;
      const spots = revealed ? this.town.staffSpots() : EMPTY_STAFF;
      this.realignStaff(spots);
      while (this.staff.length < spots.length) this.staff.push(null);
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]!;
        let a = this.staff[i] ?? null;
        if (!a) {
          if (home) {
            this.staffAway[i] = true; // shops keep working; their people are home for the night
            continue;
          }
          const h = s.lot * 7 + i * 3;
          a = this.acquire('staff', COAT_COLORS[h % COAT_COLORS.length]!, i % 2 ? 0xffffff : TRIM_COLORS[(h + 2) % TRIM_COLORS.length]!);
          if (!a) break;
          a.mode = 'work';
          a.p!.hatH = i % 3 === 0 ? 1.45 : 1;
          this.staff[i] = a;
          a.lot = s.lot;
          if (this.staffAway[i]) {
            // dawn: they step out of their home and walk back to the counter
            this.staffAway[i] = false;
            nearestHome(s.x, s.z, this.homeDoors(tmpDoors), tmpXZ);
            a.x = tmpXZ.x;
            a.z = tmpXZ.z;
            a.p!.appear = 0;
            this.beginCommute(a, s, 2);
          } else {
            a.x = s.x;
            a.z = s.z;
          }
        }
        a.lot = s.lot;
        a.timer = s.working ? 1 : 0;
        a.standYaw = s.yaw;
        a.tx = s.x;
        a.tz = s.z;
        if (home && a.commute !== 1) this.beginCommute(a, s, 1);
        else if (!home && a.commute === 1) this.beginCommute(a, s, 2);
        else if (a.commute === 0) {
          a.x = s.x;
          a.z = s.z;
          a.faceYaw = s.yaw;
          a.yaw = s.yaw;
        }
      }
      while (this.staff.length > spots.length) {
        const a = this.staff.pop();
        if (a) this.release(a);
      }
      this.staffAway.length = spots.length;
      // stallholders stand behind each stall once the square is open
      if (revealed && this.stallholders.length === 0) {
        STALLS.forEach((s, i) => {
          const a = this.acquire('staff', COAT_COLORS[(i * 3 + 4) % COAT_COLORS.length]!, TRIM_COLORS[(i * 2 + 1) % TRIM_COLORS.length]!);
          if (!a) return;
          a.mode = 'work';
          a.x = s.x - Math.sin(s.yaw) * 0.3;
          a.z = s.z - Math.cos(s.yaw) * 0.3;
          a.yaw = a.faceYaw = s.yaw;
          a.timer = 0.5;
          this.stallholders.push(a);
        });
      } else if (!revealed && this.stallholders.length > 0) {
        while (this.stallholders.length) this.release(this.stallholders.pop()!);
      }
    }
    for (let i = this.staffLeaving.length - 1; i >= 0; i--) {
      if (this.stepCommute(this.staffLeaving[i]!, dt)) this.staffLeaving.splice(i, 1);
    }
    for (let i = 0; i < this.staff.length; i++) {
      const a = this.staff[i];
      if (!a) continue;
      if (a.commute === 0) this.animateStaff(a, dt);
      else if (this.stepCommute(a, dt)) this.staff[i] = null; // reached home and faded out: the instance goes back to the pool
    }
    for (const a of this.stallholders) this.animateStaff(a, dt);
  }

  /**
   * The staff list is one slot per spot, in lot order: when a building is demolished (or one appears between two others)
   * the spots shift. Re-pair every person with a spot of their own lot; the ones whose lot lost spots walk home and go.
   */
  private realignStaff(spots: readonly { lot: number }[]): void {
    let shifted = false;
    for (let i = 0; i < this.staff.length && !shifted; i++) {
      const a = this.staff[i];
      if (a && spots[i]?.lot !== a.lot) shifted = true;
    }
    if (!shifted) return;
    const byLot = new Map<number, Agent[]>();
    for (const a of this.staff) {
      if (!a) continue;
      const list = byLot.get(a.lot);
      if (list) list.push(a);
      else byLot.set(a.lot, [a]);
    }
    const next: (Agent | null)[] = spots.map((s) => byLot.get(s.lot)?.shift() ?? null);
    for (const rest of byLot.values()) {
      for (const a of rest) {
        this.beginCommute(a, a, 1);
        this.staffLeaving.push(a);
      }
    }
    this.staff.length = 0;
    for (const a of next) this.staff.push(a);
    this.staffAway.fill(this.staffHome);
  }

  /** Start walking home (`kind` 1, to the nearest townhouse door / corridor entrance) or back to the spot (2). */
  private beginCommute(a: Agent, s: { x: number; z: number; yaw: number }, kind: 1 | 2): void {
    a.commute = kind;
    a.mode = 'work';
    a.fading = false;
    a.faceYaw = Number.NaN;
    a.maxSpeed = COMMUTE_SPEED;
    if (kind === 1) {
      nearestHome(a.x, a.z, this.homeDoors(tmpDoors), tmpXZ);
      a.exitX = tmpXZ.x;
      a.exitZ = tmpXZ.z;
      planTownPath(a.path, a.x, a.z, tmpXZ.x, tmpXZ.z);
    } else {
      planTownPath(a.path, a.x, a.z, s.x, s.z);
    }
  }

  /** Walk a commuting staff person; true when they are gone (released) for the night. */
  private stepCommute(a: Agent, dt: number): boolean {
    const p = a.p!;
    const moving = this.walkPath(a, dt);
    p.work = approach(p.work, 0, dt * 3);
    p.talk = approach(p.talk, 0, dt * 3);
    if (moving) return false;
    if (a.commute === 2) {
      a.commute = 0;
      a.x = a.tx;
      a.z = a.tz;
      a.faceYaw = a.yaw = a.standYaw;
      return false;
    }
    a.fading = true; // sync() fades the instance out
    if (p.appear > 0.001) return false;
    const i = this.staff.indexOf(a);
    if (i >= 0) this.staffAway[i] = true;
    this.release(a);
    return true;
  }

  private animateStaff(a: Agent, dt: number): void {
    const p = a.p!;
    a.speed = 0;
    // working = busy arm; otherwise an occasional chat nod / wave at the shopper nearby
    p.work = approach(p.work, a.timer, dt * 2);
    const talky = Math.sin(this.t * 0.35 + p.seed) > 0.5 ? 1 : 0;
    p.talk = approach(p.talk, p.work > 0.5 ? 0 : talky, dt * 2);
  }

  // =========================================================================
  // Buyers
  // =========================================================================
  private buyerSpawns(dt: number, shops: readonly ShopSpot[]): void {
    // drop queues of shops that are gone (a demolished lot, or a different shop built on it since the buyers joined)
    if (this.queues.size > 0) {
      for (const [lot, q] of this.queues) {
        const now = shops.find((s) => s.lot === lot);
        if (now && q.every((a) => a.shop === now)) continue;
        for (let i = q.length - 1; i >= 0; i--) {
          const a = q[i]!;
          this.sendOut(a);
          a.shop = null; // never walk to (or pay at) the dead shop
        }
        this.queues.delete(lot);
        this.buyTimers.delete(lot);
      }
    }
    if (shops.length === 0) return;
    const level = this.ctx.state.village.level;
    const gap = TOWN.buyerGap[Math.min(level, TOWN.buyerGap.length - 1)]!;
    const rush = this.ctx.rush;
    for (const shop of shops) {
      let q = this.queues.get(shop.lot);
      if (!q) {
        q = [];
        this.queues.set(shop.lot, q);
        this.buyTimers.set(shop.lot, randRange(0.8, 2.5));
      }
      let t = this.buyTimers.get(shop.lot)! - dt;
      if (t <= 0) {
        const cap = TOWN.queuePerShop + (rush.active ? 1 : 0);
        const kind = shop.def.output;
        if (q.length < cap && kind && shop.counter.count(kind) > 0 && this.crowd.count < this.crowd.capacity) {
          this.spawnBuyer(shop, q);
          t = (gap * randRange(0.75, 1.3)) / (rush.spawnMult * (this.ctx.worldEvents?.townBuyMult ?? 1)); // rush hour × festival (?. : unit-test fakes)
        } else {
          t = 0.5; // nothing to buy yet / queue full: look again soon
        }
      }
      this.buyTimers.set(shop.lot, t);
    }
  }

  private spawnBuyer(shop: ShopSpot, q: Agent[]): void {
    const kind = shop.def.output!;
    const goods = GOODS_COLORS[kind] ?? GOODS_COLORS.default!;
    const a = this.acquire('buyer', pick(COAT_COLORS), pick(TRIM_COLORS), goods);
    if (!a) return;
    a.shop = shop;
    a.mode = 'in';
    a.maxSpeed = BUYER_SPEED * randRange(0.92, 1.08);
    a.want = randInt(shop.def.want[0], shop.def.want[1]);
    a.takeT = 0;
    a.patience = PATIENCE;
    a.basket.reset(kind, Math.max(a.want, 1));
    const ent = LAYOUT.town.entrances;
    const e = pick(ent);
    a.x = e.x;
    a.z = e.z;
    a.yaw = Math.atan2(shop.queueSpot(q.length, tmpXZ).x - a.x, tmpXZ.z - a.z);
    a.p!.kid = false;
    a.p!.scale = randRange(0.95, 1.06);
    a.p!.hatH = randRange(0.9, 1.15);
    a.p!.hatRoll = randRange(-0.12, 0.12);
    q.push(a);
  }

  /** Walk a buyer out of town (nearest entrance) and forget its place in line. */
  private sendOut(a: Agent): void {
    if (a.shop) {
      const q = this.queues.get(a.shop.lot);
      const i = q ? q.indexOf(a) : -1;
      if (i >= 0) q!.splice(i, 1);
    }
    a.mode = 'out';
    a.faceYaw = Number.NaN;
    let best = LAYOUT.town.entrances[0]!;
    let bd = Infinity;
    for (const e of LAYOUT.town.entrances) {
      const d = Math.hypot(e.x - a.x, e.z - a.z) + randRange(0, 4);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    a.exitX = best.x;
    a.exitZ = best.z;
    this.goTo(a, best.x, best.z);
    a.maxSpeed = BUYER_SPEED * 0.9;
    if (a.basket.landed > 0) a.p!.carry = 1;
  }

  private stepBuyer(a: Agent, dt: number): void {
    const p = a.p!;
    switch (a.mode) {
      case 'in':
      case 'wait': {
        this.walkPath(a, dt);
        p.carry = approach(p.carry, a.basket.landed > 0 ? 1 : 0, dt * 4);
        break;
      }
      case 'paid': {
        this.walkPath(a, dt);
        a.timer -= dt;
        p.cheer = clamp(a.timer / CHEER_TIME * 2, 0, 1);
        p.carry = approach(p.carry, 0, dt * 6);
        if (a.timer <= 0) {
          p.cheer = 0;
          p.carry = 1;
          this.sendOut(a);
        }
        break;
      }
      case 'out': {
        const moving = this.walkPath(a, dt);
        p.carry = approach(p.carry, a.basket.landed > 0 ? 1 : 0, dt * 4);
        p.cheer = approach(p.cheer, 0, dt * 4);
        if (!moving) a.fading = true;
        break;
      }
      default:
        break;
    }
  }

  private serveQueues(dt: number, shops: readonly ShopSpot[]): void {
    for (const shop of shops) {
      const q = this.queues.get(shop.lot);
      if (!q) continue;
      for (let i = 0; i < q.length; i++) {
        const a = q[i]!;
        shop.queueSpot(i, tmpXZ);
        if (!(Math.abs(a.tx - tmpXZ.x) < 0.05 && Math.abs(a.tz - tmpXZ.z) < 0.05)) {
          a.tx = tmpXZ.x;
          a.tz = tmpXZ.z;
          this.goTo(a, a.tx, a.tz);
          a.mode = 'in';
        }
        const here = a.path.i >= a.path.n && Math.hypot(a.x - a.tx, a.z - a.tz) < 0.12;
        if (here) {
          a.faceYaw = shop.facing;
          if (a.mode === 'in') a.mode = 'wait';
        }
        if (i === 0 && here && a.mode === 'wait') this.serve(a, shop, dt);
      }
    }
  }

  private serve(a: Agent, shop: ShopSpot, dt: number): void {
    const kind = shop.def.output!;
    const b = a.basket;
    a.takeT -= dt;
    const before = b.size;
    if (a.takeT <= 0 && b.size < a.want && shop.counter.count(kind) > 0) {
      a.takeT = TIMING.npcTakeInterval;
      transferOne(this.ctx, shop.counter, b, [kind]);
    }
    if (b.size > before) a.patience = PATIENCE;
    else a.patience -= dt;
    if (b.landed >= a.want && b.pending === 0) this.pay(a, shop, a.want);
    else if (a.patience <= 0) {
      // the counter ran dry: pay for what is in the basket, or give up
      if (b.landed > 0) this.pay(a, shop, b.landed);
      else this.sendOut(a);
    }
  }

  private pay(a: Agent, shop: ShopSpot, n: number): void {
    const kind = shop.def.output!;
    const amount = salePrice(this.ctx.state, kind as ProductId, shop.def.price, n);
    tmpV.copy(shop.counterTop);
    shop.till.pay(amount, tmpV);
    this.ctx.state.stats.goodsSold += n;
    this.ctx.events.emit('sale', { buyer: 'townsfolk', kind, count: n, amount, position: tmpV });
    const q = this.queues.get(shop.lot);
    const i = q ? q.indexOf(a) : -1;
    if (i >= 0) q!.splice(i, 1);
    a.mode = 'paid';
    a.timer = CHEER_TIME;
    a.path.clear();
    a.faceYaw = shop.facing;
    a.p!.cheer = 1;
  }

  // =========================================================================
  // Wanderers
  // =========================================================================
  private wandererTarget(): number {
    if (this.forceWanderers !== null) return Math.max(0, Math.min(this.forceWanderers, this.crowd.capacity));
    const st = this.ctx.state;
    if (!st.village.revealed) return 0;
    return wandererTargetFor(st.village.level, this.darkness(), this.ctx.renderer.quality === 'low', this.crowd.capacity);
  }

  private manageWanderers(dt: number): void {
    const target = this.wandererTarget();
    if (!this.seeded && target > 0) {
      this.seeded = true;
      this.seedWanderers();
    }
    this.spawnT -= dt;
    const free = this.crowd.capacity - this.crowd.count;
    if (this.nWanderers < target && free > 0) {
      if (this.spawnT <= 0) {
        this.spawnWanderer(false);
        this.spawnT = target - this.nWanderers > 4 ? 0.3 : SPAWN_GAP * randRange(0.8, 1.4);
      }
    } else if (this.nWanderers > target || free < 0) {
      if (this.spawnT <= 0) {
        this.spawnT = 1.2;
        // the one that has been out longest heads home
        let pickA: Agent | null = null;
        for (const a of this.live) {
          if (a.kind !== 'wanderer' || a.act === 'leave' || a.act === 'carol' || a.fading) continue;
          if (!pickA || a.life > pickA.life) pickA = a;
        }
        if (pickA) this.beginLeave(pickA);
      }
    }
  }

  /** Make a wanderer. `scatter`: appear somewhere inside instead of walking in. */
  private spawnWanderer(scatter: boolean): boolean {
    const st = this.ctx.state;
    const townOpen = this.town.revealed;
    if (!st.village.revealed && this.forceWanderers === null) return false;
    const kid = Math.random() < KID_CHANCE;
    const coat = pick(COAT_COLORS);
    let trim = pick(TRIM_COLORS);
    if (Math.abs(trim - coat) < 0x101010) trim = 0xffffff;
    const a = this.acquire('wanderer', coat, trim);
    if (!a) return false;
    const p = a.p!;
    p.kid = kid;
    p.scale = randRange(0.94, 1.07);
    p.hatH = randRange(0.85, 1.3);
    p.hatRoll = randRange(-0.14, 0.14);
    a.maxSpeed = kid ? KID_SPEED : randRange(STROLL_SPEED[0], STROLL_SPEED[1]);
    a.life = 0;
    a.limit = randRange(LIFETIME[0], LIFETIME[1]);
    a.lantern = false;
    if (scatter) {
      const inTown = townOpen && Math.random() < 0.6;
      if (inTown) this.randomSquarePoint(tmpXZ);
      else this.randomStreetPoint(tmpXZ);
      a.x = tmpXZ.x;
      a.z = tmpXZ.z;
      a.yaw = Math.random() * 6.28;
      a.mode = 'idle';
      a.act = 'stroll';
      a.faceYaw = Number.NaN;
      a.hopT = 0;
      p.appear = -Math.random() * 1.2; // staggered pop-in
      this.idleFor(a, randRange(0.2, 2.5));
    } else {
      // walk in: the yard gate (village side) or one of the town's entrances
      if (townOpen && Math.random() < 0.55) {
        const e = pick(LAYOUT.town.entrances);
        a.x = e.x;
        a.z = e.z;
      } else {
        a.x = NAV.streetEntry.x + randRange(-0.5, 0.5);
        a.z = NAV.streetEntry.z;
      }
      a.yaw = Math.atan2(NAV.streetEntry.x - a.x, 1);
      this.chooseActivity(a);
    }
    return true;
  }

  private idleFor(a: Agent, seconds: number): void {
    a.mode = 'idle';
    a.act = 'stroll';
    a.timer = seconds;
    a.path.clear();
  }

  private randomStreetPoint(out: XZ): void {
    out.x = randRange(STROLL_STREET_X[0], STROLL_STREET_X[1]);
    out.z = randRange(STROLL_STREET_Z[0], STROLL_STREET_Z[1]);
  }

  private randomSquarePoint(out: XZ): void {
    const s = NAV.square;
    for (let i = 0; i < 12; i++) {
      out.x = randRange(s.minX + 1.4, s.maxX - 1.4);
      out.z = randRange(s.minZ + 1.2, s.maxZ - 1.2);
      if (!insideObstacle(out.x, out.z, 0, 0.35) && !this.nearQueue(out.x, out.z)) return;
    }
  }

  private nearQueue(x: number, z: number): boolean {
    for (const shop of this.town.shops()) {
      for (let i = 0; i < TOWN.queuePerShop; i++) {
        shop.queueSpot(i, tmpQ);
        if (Math.abs(tmpQ.x - x) < 0.9 && Math.abs(tmpQ.z - z) < 0.9) return true;
      }
    }
    return false;
  }

  private stepWanderer(a: Agent, dt: number): void {
    const p = a.p!;
    a.life += dt;
    // time to go home (never in the middle of a seat or a chat)
    if (a.life > a.limit && a.act !== 'leave' && a.act !== 'carol' && a.mode !== 'sit' && a.mode !== 'chat' && a.mode !== 'standup') this.beginLeave(a);

    // night lanterns
    const dark = this.ctx.dayNight ? this.ctx.dayNight.darkness : 0;
    a.lantern = (dark > NIGHT_LANTERN_FROM && a.rnd < 0.5 && !p.kid) || a.act === 'carol';

    // wave at the player passing by
    this.waveStep(a, dt);

    switch (a.mode) {
      case 'walk':
      case 'out': {
        if (a.act === 'pond') a.timer -= dt; // skating time runs while gliding along the rim
        if (!this.walkPath(a, dt)) this.arrive(a);
        break;
      }
      case 'standup': {
        if (!this.walkPath(a, dt)) this.chooseActivity(a);
        break;
      }
      case 'idle': {
        this.walkPath(a, dt);
        a.timer -= dt;
        p.talk = approach(p.talk, 0, dt * 3);
        if (a.timer <= 0) this.chooseActivity(a);
        break;
      }
      case 'sit': {
        this.walkPath(a, dt);
        a.yaw = dampAngle(a.yaw, a.standYaw, 8, dt);
        a.timer -= dt;
        a.talkT -= dt;
        p.talk = a.partner ? p.talk : 0;
        if (a.act === 'cafe') {
          // glance around the café now and then
          const look = Math.sin(this.t * 0.45 + a.rnd * 20) > 0.55 ? Math.sign(Math.sin(this.t * 0.17 + a.rnd * 9) || 1) * 0.65 : 0;
          p.headYaw = approach(p.headYaw, look, dt * 2.2);
        }
        if (a.timer <= 0) {
          // stand up and step back from the bench first
          this.freeSpots(a);
          a.mode = 'standup';
          a.path.clear();
          a.path.push(a.approachX, a.approachZ);
        }
        break;
      }
      case 'ring': {
        this.walkPath(a, dt);
        a.timer -= dt;
        if (a.act === 'band') {
          // at night the band plays: cheer every few seconds; by day just stand about and chat
          a.talkT -= dt;
          if (a.talkT <= 0) {
            a.talkT = randRange(3, 6);
            if (this.darkness() > 0.5) a.hopT = 1;
          }
          if (this.darkness() > 0.5) {
            p.talk = approach(p.talk, 0, dt * 3);
          } else {
            p.talk = approach(p.talk, Math.sin(this.t * 0.8 + a.rnd * 12) > 0 ? 0.8 : 0, dt * 3);
          }
        }
        if ((a.snowIdx >= 0 || a.act === 'park') && p.kid) {
          // kids bounce around the snowman
          a.talkT -= dt;
          if (a.talkT <= 0) {
            a.talkT = randRange(1.2, 3);
            a.hopT = 0.6;
          }
        }
        if (a.timer <= 0) this.chooseActivity(a);
        break;
      }
      case 'carol': {
        this.walkPath(a, dt);
        a.yaw = dampAngle(a.yaw, a.standYaw, 6, dt);
        const singing = this.carolersSinging();
        const beat = (this.carolT % CAROL_BEAT) / CAROL_BEAT;
        // every caroler shares the beat: open mouths on the strong part of it
        p.talk = approach(p.talk, singing ? (beat < 0.72 ? 1 : 0.2) : 0, dt * 8);
        p.cheer = approach(p.cheer, this.carolCheerT > 0 ? 1 : 0, dt * 5);
        break;
      }
      case 'chat': {
        this.walkPath(a, dt);
        const pa = a.partner;
        if (!pa || pa.partner !== a || pa.mode !== 'chat') {
          p.talk = 0;
          a.partner = null;
          this.chooseActivity(a);
          break;
        }
        a.timer -= dt;
        // take turns
        p.talk = approach(p.talk, Math.sin(this.t * 0.9 + a.rnd * 6.28 * 2) > -0.1 ? 1 : 0.1, dt * 4);
        a.yaw = dampAngle(a.yaw, a.faceYaw, 8, dt);
        if (a.timer <= 0) {
          p.talk = 0;
          pa.timer = Math.min(pa.timer, 0);
          a.partner = null;
          this.chooseActivity(a);
        }
        break;
      }
      default:
        break;
    }
    // standing still looking up at the tree
    let pitch = a.mode === 'ring' && a.ringIdx >= 0 ? -0.4 : 0;
    if (a.mode === 'carol') pitch = -0.2;
    else if (a.act === 'pond' && a.mode === 'walk') pitch = 0.26 + Math.sin(this.t * 1.7 + p.seed) * 0.08; // a gentle skating lean
    p.headPitch = approach(p.headPitch, pitch, dt * 2);
    if (a.act !== 'cafe' || a.mode !== 'sit') p.headYaw = approach(p.headYaw, 0, dt * 3);
  }

  /** A short wave at the player when they walk by. */
  private waveStep(a: Agent, dt: number): void {
    const p = a.p!;
    a.waveCool -= dt;
    if (a.waveT > 0) {
      a.waveT -= dt;
      p.wave = approach(p.wave, 1, dt * 7);
      if (a.waveT <= 0) a.waveCool = randRange(14, 30);
    } else {
      p.wave = approach(p.wave, 0, dt * 6);
    }
    if (a.waveCool > 0 || a.waveT > 0 || a.mode === 'sit' || a.mode === 'chat' || a.mode === 'out' || a.mode === 'carol') return;
    const pl = this.ctx.player?.position;
    if (!pl) return;
    const dx = pl.x - a.x;
    const dz = pl.z - a.z;
    if (dx * dx + dz * dz < WAVE_RANGE * WAVE_RANGE && a.rnd > 0.35) {
      a.waveT = randRange(1.3, 2.1);
      if (a.mode === 'idle' || a.mode === 'ring') a.faceYaw = Math.atan2(dx, dz);
    } else {
      a.waveCool = 0.5;
    }
  }

  /** Path finished: start what the wanderer came for. */
  private arrive(a: Agent): void {
    const p = a.p!;
    switch (a.act) {
      case 'leave':
        a.fading = true;
        break;
      case 'sit':
        a.mode = 'sit';
        a.timer = randRange(9, 24);
        a.talkT = 0;
        break;
      case 'carol':
        a.mode = 'carol';
        a.faceYaw = a.standYaw;
        break;
      case 'cafe':
        a.mode = 'sit';
        a.timer = randRange(10, 26);
        a.talkT = 0;
        break;
      case 'pond': {
        // glide on to the next rim spot until the skating time is up
        const rim = amenitySpotsOf('pond');
        if (a.timer > 0 && rim.length > 1) {
          a.amenIdx = (a.amenIdx + 1) % rim.length;
          const r = rim[a.amenIdx]!;
          a.path.clear();
          a.path.push(r.x, r.z);
          a.mode = 'walk';
        } else {
          this.chooseActivity(a);
        }
        break;
      }
      case 'tree':
      case 'snow':
      case 'stall':
      case 'band':
      case 'park':
        a.mode = 'ring';
        a.timer = a.act === 'stall' ? randRange(4, 9) : randRange(6, 15);
        if (a.act === 'band' || a.act === 'park') a.talkT = randRange(0.5, 2.5);
        a.talkT = randRange(0.3, 1.5);
        a.faceYaw = a.standYaw;
        break;
      case 'chat': {
        a.arrived = true;
        const pa = a.partner;
        if (pa && pa.partner === a && pa.arrived) {
          a.mode = 'chat';
          pa.mode = 'chat';
          a.timer = pa.timer = randRange(7, 14);
          p.talk = 0;
        } else {
          // wait for the partner to arrive (face them)
          a.mode = 'idle';
          a.timer = 8;
          a.act = 'chat';
        }
        break;
      }
      default: {
        // arrived at a stroll point: pause, maybe admire a house
        a.mode = 'idle';
        a.timer = randRange(0.6, 3.2);
        if (zoneOf(a.x, a.z) === 'street' && Math.random() < 0.5) {
          a.faceYaw = a.x > (NAV.street.minX + NAV.street.maxX) / 2 ? Math.PI / 2 : -Math.PI / 2;
        }
        break;
      }
    }
  }

  private chooseActivity(a: Agent): void {
    const p = a.p!;
    this.freeSpots(a);
    a.arrived = false;
    a.faceYaw = Number.NaN;
    const townOpen = this.town.revealed;
    if (a.partner) {
      if (a.partner.partner === a) a.partner.partner = null;
      a.partner = null;
    }
    // weighted pick
    const w = tmpW;
    const dark = this.darkness();
    const market = nightMarket(this.ctx.state.village.level, dark);
    const kid = p.kid;
    const parkOpen = townOpen && this.amenityOpen('snowmanPark');
    w[0] = 3 + (townOpen ? 2 : 0); // stroll
    w[1] = townOpen ? 2 : 0; // sit
    w[2] = townOpen ? 1.6 : 0; // tree
    w[3] = townOpen ? (kid ? (parkOpen ? 2 : 4.5) : 0.35) : 0; // snowman (kids split with the park when it is built)
    w[4] = stallWeight(townOpen ? 1.3 : 0, market); // stall (night market: doubled)
    w[5] = 1.7; // chat
    w[6] = townOpen && this.amenityOpen('cafe') ? (kid ? 0.4 : 1.6) : 0; // café stool
    w[7] = townOpen && this.amenityOpen('pond') ? (kid ? 2.2 : 1.4) : 0; // skate on the pond
    w[8] = townOpen && this.amenityOpen('bandstand') ? (dark > 0.5 ? 2.4 : 1) : 0; // bandstand (plays at night)
    w[9] = parkOpen ? (kid ? 3.5 : 0.35) : 0; // snowman park
    let sum = 0;
    for (let i = 0; i < W_N; i++) sum += w[i]!;
    let r = Math.random() * sum;
    let pickI = 0;
    for (; pickI < W_N; pickI++) {
      r -= w[pickI]!;
      if (r <= 0) break;
    }
    let ok = false;
    switch (pickI) {
      case 1:
        ok = this.beginSit(a);
        break;
      case 2:
        ok = this.beginRing(a, 'tree');
        break;
      case 3:
        ok = this.beginRing(a, 'snow');
        break;
      case 4:
        ok = this.beginStall(a);
        break;
      case 5:
        ok = this.beginChat(a);
        break;
      case 6:
        ok = this.beginAmenity(a, 'cafe');
        break;
      case 7:
        ok = this.beginAmenity(a, 'pond');
        break;
      case 8:
        ok = this.beginAmenity(a, 'bandstand');
        break;
      case 9:
        ok = this.beginAmenity(a, 'snowmanPark');
        break;
      default:
        break;
    }
    if (!ok) this.beginStroll(a);
  }

  private beginStroll(a: Agent): void {
    const townOpen = this.town.revealed;
    // someone in the square mostly stays there; villagers mostly stay on the street
    const here = zoneOf(a.x, a.z);
    const inSquare = here === 'square' || here === 'lane';
    const wantTown = townOpen && (inSquare ? Math.random() < 0.8 : Math.random() < 0.3);
    if (wantTown) this.randomSquarePoint(tmpXZ);
    else this.randomStreetPoint(tmpXZ);
    a.act = 'stroll';
    a.mode = 'walk';
    this.goTo(a, tmpXZ.x, tmpXZ.z);
    a.faceYaw = Number.NaN;
  }

  private beginSit(a: Agent): boolean {
    const free: number[] = [];
    for (let i = 0; i < this.seats.length; i++) if (!this.seats[i]) free.push(i);
    if (free.length === 0) return false;
    const idx = pick(free);
    const bench = idx >> 1;
    this.seats[idx] = a;
    a.seatIdx = idx;
    seatPoint(bench, idx & 1, tmpSeat);
    a.approachX = tmpSeat.ax;
    a.approachZ = tmpSeat.az;
    a.standYaw = tmpSeat.yaw;
    a.act = 'sit';
    a.mode = 'walk';
    this.goTo(a, tmpSeat.ax, tmpSeat.az);
    a.path.push(tmpSeat.x, tmpSeat.z);
    return true;
  }

  private beginRing(a: Agent, what: 'tree' | 'snow'): boolean {
    if (what === 'tree') {
      const free: number[] = [];
      for (let i = 0; i < this.ring.length; i++) if (!this.ring[i]) free.push(i);
      if (free.length === 0) return false;
      const idx = pick(free);
      this.ring[idx] = a;
      a.ringIdx = idx;
      const s = TREE_RING[idx]!;
      a.standYaw = s.yaw;
      a.act = 'tree';
      a.mode = 'walk';
      this.goTo(a, s.x, s.z);
      return true;
    }
    const free: number[] = [];
    for (let i = 0; i < this.snow.length; i++) if (!this.snow[i]) free.push(i);
    if (free.length === 0) return false;
    const idx = pick(free);
    this.snow[idx] = a;
    a.snowIdx = idx;
    const ang = (SNOW_SLOT_KEPT[idx]! / SNOWMAN_SLOTS) * Math.PI * 2 + 0.5;
    const x = SNOWMAN.x + Math.sin(ang) * SNOWMAN_RING;
    const z = SNOWMAN.z + Math.cos(ang) * SNOWMAN_RING;
    a.standYaw = Math.atan2(SNOWMAN.x - x, SNOWMAN.z - z);
    a.act = 'snow';
    a.mode = 'walk';
    planPath(a.path, a.x, a.z, x, z, OWNER_SNOWMAN);
    return true;
  }

  private beginStall(a: Agent): boolean {
    const free = this.stallSpots.filter((s) => !s.taken);
    if (free.length === 0) return false;
    const s = pick(free);
    s.taken = a;
    a.standYaw = s.yaw;
    a.act = 'stall';
    a.mode = 'walk';
    this.goTo(a, s.x, s.z);
    return true;
  }

  private beginChat(a: Agent): boolean {
    // find a free partner nearby
    let best = null as Agent | null;
    let bd = 12 * 12;
    for (const b of this.live) {
      if (b === a || b.kind !== 'wanderer' || b.partner || b.fading) continue;
      if (b.mode !== 'walk' && b.mode !== 'idle') continue;
      if (b.act === 'leave' || b.act === 'sit' || b.act === 'carol' || b.act === 'pond' || b.act === 'cafe' || b.p!.kid !== a.p!.kid) continue;
      const d = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
      if (d < bd && Math.random() < 0.7) {
        bd = d;
        best = b;
      }
    }
    if (!best) return false;
    const b: Agent = best;
    // meet near the initiator, in the open
    const here = zoneOf(a.x, a.z);
    if ((here === 'square' || here === 'lane') && this.town.revealed) this.randomSquarePoint(tmpXZ);
    else this.randomStreetPoint(tmpXZ);
    const mx = tmpXZ.x;
    const mz = tmpXZ.z;
    // line them up along the street (x) / randomly in the square
    const ang = zoneOf(mx, mz) === 'street' ? 0 : Math.random() * Math.PI;
    const ox = Math.cos(ang) * 0.42;
    const oz = Math.sin(ang) * 0.42;
    this.freeSpots(b);
    a.act = b.act = 'chat';
    a.partner = b;
    b.partner = a;
    a.arrived = b.arrived = false;
    a.mode = b.mode = 'walk';
    this.goTo(a, mx - ox, mz - oz);
    this.goTo(b, mx + ox, mz + oz);
    a.faceYaw = Math.atan2(2 * ox, 2 * oz);
    b.faceYaw = Math.atan2(-2 * ox, -2 * oz);
    return true;
  }

  // -------------------------------------------------------------------------
  // Amenities (cafe stools, pond rim, bandstand front, snowman park)
  // -------------------------------------------------------------------------
  /** Built (state) and with spots to use (town/spots.ts AMENITY_SPOTS). */
  private amenityOpen(id: AmenityId): boolean {
    if (!AMENITY_IDS.includes(id)) return false;
    if ((this.ctx.state.town.amenities?.[id]?.tier ?? -1) < 0) return false;
    return amenitySpotsOf(id).length > (id === 'pond' ? 1 : 0);
  }

  private beginAmenity(a: Agent, id: AmenityId): boolean {
    if (!this.amenityOpen(id)) return false;
    const list = amenitySpotsOf(id);
    if (id === 'pond') {
      let n = 0;
      for (const b of this.live) if (b.act === 'pond' && b !== a) n++;
      if (n >= SKATERS_MAX) return false;
      const idx = Math.floor(Math.random() * list.length);
      const r = list[idx]!;
      a.baseSpeed = a.maxSpeed;
      a.maxSpeed = a.maxSpeed * SKATE_SPEED;
      a.amenIdx = idx;
      a.timer = randRange(10, 20);
      a.act = 'pond';
      a.mode = 'walk';
      planTownPath(a.path, a.x, a.z, r.x, r.z);
      return true;
    }
    let slots = this.amenSlots[id];
    if (!slots || slots.length !== list.length) slots = this.amenSlots[id] = new Array<Agent | null>(list.length).fill(null);
    const free: number[] = [];
    for (let i = 0; i < slots.length; i++) if (!slots[i]) free.push(i);
    if (free.length === 0) return false;
    const idx = pick(free);
    const s = list[idx]!;
    slots[idx] = a;
    a.amenId = id;
    a.amenIdx = idx;
    a.standYaw = s.yaw;
    if (id === 'cafe') {
      // approach the stool from behind, then sit facing the table
      a.approachX = s.x - Math.sin(s.yaw) * 0.9;
      a.approachZ = s.z - Math.cos(s.yaw) * 0.9;
      a.act = 'cafe';
      a.mode = 'walk';
      planTownPath(a.path, a.x, a.z, a.approachX, a.approachZ);
      a.path.push(s.x, s.z);
    } else {
      a.act = id === 'bandstand' ? 'band' : 'park';
      a.mode = 'walk';
      planTownPath(a.path, a.x, a.z, s.x, s.z);
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Carolers: three wanderers around the tree at night, lanterns up, singing in step
  // -------------------------------------------------------------------------
  private carolersSinging(): boolean {
    let n = 0;
    for (const c of this.carolers) if (c.mode === 'carol') n++;
    return n >= 2;
  }

  private disbandCarolers(): void {
    const list = this.carolers.splice(0, this.carolers.length);
    for (const c of list) {
      if (!c.p || c.act !== 'carol') continue;
      c.p.cheer = 0;
      c.p.talk = 0;
      this.chooseActivity(c); // frees the tree spot and sends them on their way
    }
    this.carolBeatNo = -1;
  }

  private manageCarolers(dt: number): void {
    const st = this.ctx.state;
    const want = this.town.revealed && st.village.revealed && carolersEligible(st.village.level, this.darkness(), this.carolOn);
    if (!want) {
      this.carolOn = false;
      if (this.carolers.length > 0) this.disbandCarolers();
      return;
    }
    this.carolOn = true;
    if (this.carolers.length === 0) {
      this.carolFormT -= dt;
      if (this.carolFormT <= 0) {
        this.carolFormT = 2;
        this.formCarolers();
      }
      return;
    }
    if (this.carolers.length < CAROL_SIZE - 1) {
      this.disbandCarolers(); // somebody left: the rest go back to the crowd
      return;
    }
    this.carolT += dt;
    this.carolCheerT -= dt;
    this.carolCheerCool -= dt;
    if (this.carolCheerCool <= 0) {
      this.carolCheerCool = randRange(9, 16);
      if (this.carolersSinging()) this.carolCheerT = 0.9;
    }
    const beat = carolBeat(this.carolT);
    if (beat !== this.carolBeatNo) {
      this.carolBeatNo = beat;
      const pl = this.ctx.player?.position;
      const T = LAYOUT.town.tree;
      if (this.carolersSinging() && pl && Math.hypot(pl.x - T.x, pl.z - T.z) < CAROL_HEAR) {
        this.ctx.audio?.play('chime', { pitch: carolPitch(beat), volume: CAROL_VOLUME });
      }
    }
  }

  private formCarolers(): void {
    const n = this.ring.length;
    // three neighbouring free spots around the tree
    const starts: number[] = [];
    for (let i = 0; i < n; i++) {
      let ok = true;
      for (let k = 0; k < CAROL_SIZE; k++) if (this.ring[(i + k) % n]) ok = false;
      if (ok) starts.push(i);
    }
    if (starts.length === 0) return;
    const start = pick(starts);
    const T = LAYOUT.town.tree;
    const cands: Agent[] = [];
    for (const b of this.live) {
      if (b.kind !== 'wanderer' || b.fading || b.partner || b.p!.kid) continue;
      if (b.act === 'leave' || b.act === 'chat' || b.act === 'carol' || b.act === 'pond' || b.mode === 'sit' || b.mode === 'standup' || b.mode === 'chat') continue;
      if (b.p!.appear < 0.5) continue;
      cands.push(b);
    }
    if (cands.length < CAROL_SIZE) return;
    cands.sort((u, v) => Math.hypot(u.x - T.x, u.z - T.z) - Math.hypot(v.x - T.x, v.z - T.z));
    this.carolT = 0;
    this.carolBeatNo = -1;
    this.carolCheerCool = randRange(5, 9);
    this.carolCheerT = 0;
    for (let k = 0; k < CAROL_SIZE; k++) {
      const c = cands[k]!;
      this.freeSpots(c);
      const idx = (start + k) % n;
      const s = TREE_RING[idx]!;
      this.ring[idx] = c;
      c.ringIdx = idx;
      c.standYaw = s.yaw;
      c.act = 'carol';
      c.mode = 'walk';
      c.faceYaw = Number.NaN;
      this.goTo(c, s.x, s.z);
      this.carolers.push(c);
    }
  }

  private beginLeave(a: Agent): void {
    this.freeSpots(a);
    if (a.partner && a.partner.partner === a) a.partner.partner = null;
    a.partner = null;
    a.act = 'leave';
    a.mode = 'out';
    a.faceYaw = Number.NaN;
    const here = zoneOf(a.x, a.z);
    let ex: XZ = NAV.streetEntry;
    if ((here === 'square' || here === 'lane' || here === 'corridor') && this.town.revealed && Math.random() < 0.65) {
      let bd = Infinity;
      for (const e of LAYOUT.town.entrances) {
        const d = Math.hypot(e.x - a.x, e.z - a.z);
        if (d < bd) {
          bd = d;
          ex = e;
        }
      }
    }
    this.goTo(a, ex.x, ex.z);
  }

}

const EMPTY_SHOPS: readonly ShopSpot[] = [];
const EMPTY_STAFF: readonly { lot: number; x: number; z: number; yaw: number; working: boolean }[] = [];
const W_N = 10;
const tmpW: number[] = new Array(W_N).fill(0);
const tmpDoors: XZ[] = [];
const tmpQ: XZ = { x: 0, z: 0 };
