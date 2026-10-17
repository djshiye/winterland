/**
 * [city] 1.0 district life: residents and shoppers walking a city district (R5 "the city must feel alive").
 *
 * - Who: city/lifePlan.ts lifeTarget (0 in an empty district, 2 + one per home's worth of residents + an era bonus,
 *   capped 10 … 14; halved on Low quality). People step out of a home's door (pop in), stroll the walkways between the
 *   district's spots (lifeSpots / lifeRoute: doors, shop fronts, park benches and paths, sidewalk corners), pause at a
 *   shop front, sit on a park bench, linger on a park path, and after a few visits walk home and go in (pop out).
 * - Cheap: drawn by the city's shared instanced crowd (npc/Crowd.ts, the townsfolk's pawn; one set of draw calls for
 *   every district). A district only runs while the player is near it (like District.activate); walking away releases
 *   its people, coming back seeds them on their spots again. Routes are planned per leg into a fixed buffer; the frame
 *   update allocates nothing. No colliders: they never block the player, and their routes keep out of every
 *   non-park footprint. At night some carry a lantern, as the townsfolk do.
 * - Nothing is saved: the people are derived from state.city each time.
 */
import { CITY_BUILDINGS, districtDef, type CityBuildingId } from '../eras/data';
import { approach, clamp, dampAngle } from '../core/math';
import type { CityLotState, GameContext } from '../core/types';
import { COAT_COLORS, TRIM_COLORS, type Crowd, type CrowdPerson } from '../npc/Crowd';
import { lifeRoute, lifeSpots, lifeTarget, type LifeSpot } from './lifePlan';
import { lotBuilt } from './rules';

/** Metres around the district within which its life runs (the iso camera sees ~15 m around the player). */
export const LIFE_NEAR = 22;
/** Waypoints a leg may hold (a leg is ~5 … 20). */
const MAX_PTS = 40;
/** Seconds between two looks at the district's lots. */
const CHECK_EVERY = 1;
/** Seconds between two people stepping out of a door while the district wants more. */
const SPAWN_EVERY = 2.2;
/** Visits before a person heads home. */
const VISITS_MIN = 3;
const VISITS_MAX = 6;
/** Spot choice weights by kind (a free spot of that kind must exist). */
const WEIGHT: Record<LifeSpot['kind'], number> = { shop: 4, bench: 2.5, park: 1.5, walk: 2, door: 1 };
/** Dwell seconds by kind: [min, max]. */
const DWELL: Record<LifeSpot['kind'], readonly [number, number]> = { shop: [2.5, 6], bench: [6, 14], park: [3, 7], walk: [0.4, 1.6], door: [1, 2.5] };
/** Spot kinds one person at a time (two shoppers never share a window, two people never one bench seat). */
const EXCLUSIVE: Record<LifeSpot['kind'], boolean> = { shop: true, bench: true, park: true, walk: false, door: false };
const NIGHT_LANTERN = 0.45;

interface Walker {
  p: CrowdPerson;
  /** Spot being walked to / dwelt at (index into spots), -1 none. */
  spot: number;
  mode: 'walk' | 'dwell' | 'home';
  x: number;
  z: number;
  yaw: number;
  speed: number;
  maxSpeed: number;
  timer: number;
  visits: number;
  fading: boolean;
  rnd: number;
  /** The leg: xs / zs, count and the next index. */
  px: Float32Array;
  pz: Float32Array;
  n: number;
  i: number;
  faceYaw: number;
  sitting: boolean;
}

export class DistrictLife {
  private readonly walkers: Walker[] = [];
  private spots: LifeSpot[] = [];
  /** Who holds each exclusive spot. */
  private taken: (Walker | null)[] = [];
  private signature = '';
  private target = 0;
  private checkT = 0;
  private spawnT = 0;
  private near = false;
  private readonly area: { minX: number; maxX: number; minZ: number; maxZ: number };

  /**
   * @param ctx    game services
   * @param n      the district (era 2..10)
   * @param crowd  the city's shared crowd (made on first use)
   */
  constructor(
    private readonly ctx: GameContext,
    readonly n: number,
    private readonly crowd: () => Crowd,
  ) {
    const r = districtDef(n).rect;
    this.area = { minX: r.minX - LIFE_NEAR, maxX: r.maxX + LIFE_NEAR, minZ: r.minZ - LIFE_NEAR, maxZ: r.maxZ + LIFE_NEAR };
  }

  /** People out in the district right now. */
  get count(): number {
    return this.walkers.length;
  }

  /** People the district wants now (0 while the player is away). */
  get wanted(): number {
    return this.near ? this.target : 0;
  }

  private lots(): readonly CityLotState[] {
    return this.ctx.state.city.districts[this.n]?.lots ?? [];
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const p = this.ctx.player?.position;
    const near = !!p && p.x > this.area.minX && p.x < this.area.maxX && p.z > this.area.minZ && p.z < this.area.maxZ;
    if (!near) {
      if (this.near) this.clear();
      this.near = false;
      return;
    }
    const arriving = !this.near;
    this.near = true;
    this.checkT -= dt;
    if (arriving || this.checkT <= 0) {
      this.checkT = CHECK_EVERY;
      this.refresh();
    }
    if (arriving) this.seed();
    this.spawnT -= dt;
    if (this.walkers.length < this.target && this.spawnT <= 0) {
      this.spawnT = SPAWN_EVERY * (0.6 + Math.random() * 0.8);
      this.spawnAtDoor();
    }
    // too many (a home was demolished): the extras head home
    let out = 0;
    for (const w of this.walkers) if (w.mode !== 'home' && !w.fading) out++;
    for (let i = 0; out > this.target && i < this.walkers.length; i++) {
      const w = this.walkers[i]!;
      if (w.mode === 'home' || w.fading) continue;
      this.goHome(w);
      out--;
    }
    const dark = this.ctx.dayNight ? this.ctx.dayNight.darkness : 0;
    for (let i = this.walkers.length - 1; i >= 0; i--) this.step(this.walkers[i]!, dt, dark);
  }

  /** Release everyone at once (the player walked away). */
  clear(): void {
    for (const w of this.walkers) this.crowdOf().release(w.p);
    this.walkers.length = 0;
    this.taken.fill(null);
  }

  // ---- plan -------------------------------------------------------------------------------------------------------
  /** Re-read the lots: new spots when a building appeared / went, and the head count. */
  private refresh(): void {
    const lots = this.lots();
    let sig = '';
    for (const l of lots) sig += lotBuilt(l) ? `${l.building},` : '-,';
    this.target = lifeTarget(this.n, lots, this.ctx.renderer?.quality === 'low');
    if (sig === this.signature) return;
    this.signature = sig;
    for (const w of this.walkers) {
      // whoever is in (or on the way into) a park leaves in place (pop out): the lot may hold a building next; the
      // rest pick a new spot from the new list once they arrive
      const old = w.spot >= 0 ? this.spots[w.spot] : undefined;
      if (old && (old.kind === 'bench' || old.kind === 'park')) w.fading = true;
      w.spot = -1;
      if (w.mode === 'dwell') w.timer = 0;
    }
    this.spots = lifeSpots(this.n, lots);
    this.taken = this.spots.map(() => null);
  }

  /** The player arrived: everybody the district wants pops in on a spot at once. */
  private seed(): void {
    for (let k = this.walkers.length; k < this.target; k++) {
      const s = this.freeSpot(-1, false);
      if (s < 0) break;
      const spot = this.spots[s]!;
      const w = this.spawn(spot.x, spot.z);
      if (!w) break;
      this.arrive(w, s);
    }
  }

  private spawnAtDoor(): void {
    const s = this.freeSpot(-1, true);
    if (s < 0) return;
    const spot = this.spots[s]!;
    const w = this.spawn(spot.x, spot.z);
    if (!w) return;
    w.yaw = 0; // stepping out, facing the street
    w.spot = s;
    w.mode = 'dwell';
    w.timer = 0.4;
  }

  private spawn(x: number, z: number): Walker | null {
    const coat = COAT_COLORS[Math.floor(Math.random() * COAT_COLORS.length)]!;
    const trim = TRIM_COLORS[Math.floor(Math.random() * TRIM_COLORS.length)]!;
    const p = this.crowdOf().acquire(coat, trim);
    if (!p) return null;
    p.kid = Math.random() < 0.18;
    const w: Walker = {
      p,
      spot: -1,
      mode: 'walk',
      x,
      z,
      yaw: Math.random() * Math.PI * 2,
      speed: 0,
      maxSpeed: 1.05 + Math.random() * 0.4,
      timer: 0,
      visits: VISITS_MIN + Math.floor(Math.random() * (VISITS_MAX - VISITS_MIN + 1)),
      fading: false,
      rnd: Math.random(),
      px: new Float32Array(MAX_PTS),
      pz: new Float32Array(MAX_PTS),
      n: 0,
      i: 0,
      faceYaw: Number.NaN,
      sitting: false,
    };
    p.x = x;
    p.z = z;
    this.walkers.push(w);
    return w;
  }

  private crowdOf(): Crowd {
    return this.crowd();
  }

  /**
   * A free spot index, chosen by kind weights (`doors`: a door only), never `except`; -1 when there is none.
   * Exclusive spots already held are skipped.
   */
  private freeSpot(except: number, doors: boolean): number {
    let total = 0;
    for (let i = 0; i < this.spots.length; i++) total += this.weightOf(i, except, doors);
    if (total <= 0) return -1;
    let r = Math.random() * total;
    for (let i = 0; i < this.spots.length; i++) {
      r -= this.weightOf(i, except, doors);
      if (r <= 0 && this.weightOf(i, except, doors) > 0) return i;
    }
    for (let i = this.spots.length - 1; i >= 0; i--) if (this.weightOf(i, except, doors) > 0) return i;
    return -1;
  }

  private weightOf(i: number, except: number, doors: boolean): number {
    const s = this.spots[i]!;
    if (i === except || (EXCLUSIVE[s.kind] && this.taken[i])) return 0;
    if (doors) return s.kind === 'door' ? 1 : 0;
    return WEIGHT[s.kind];
  }

  /** Put the walker on spot `s` (seeding) and start its dwell there. */
  private arrive(w: Walker, s: number): void {
    const spot = this.spots[s]!;
    w.spot = s;
    if (EXCLUSIVE[spot.kind]) this.taken[s] = w;
    w.x = spot.x;
    w.z = spot.z;
    w.yaw = spot.yaw;
    w.faceYaw = spot.yaw;
    w.mode = 'dwell';
    w.n = w.i = 0;
    const [lo, hi] = DWELL[spot.kind];
    w.timer = lo + Math.random() * (hi - lo);
    w.sitting = spot.kind === 'bench';
  }

  /** Walk from where the walker stands (spot `from`, or a free point) to spot `to`. */
  private walkTo(w: Walker, to: number): void {
    // from the spot it stands on; mid-walk (sent home on the way) from where it is
    const from = w.spot >= 0 && w.n <= w.i ? this.spots[w.spot] : undefined;
    if (w.spot >= 0 && this.taken[w.spot] === w) this.taken[w.spot] = null;
    const target = this.spots[to]!;
    if (EXCLUSIVE[target.kind]) this.taken[to] = w;
    const start: LifeSpot = from ?? { kind: 'walk', lot: -1, x: w.x, z: w.z, yaw: w.yaw, access: { x: w.x, z: w.z }, via: [] };
    const pts = lifeRoute(this.n, start, target);
    const n = Math.min(MAX_PTS, pts.length);
    for (let i = 0; i < n; i++) {
      w.px[i] = pts[i]!.x;
      w.pz[i] = pts[i]!.z;
    }
    w.n = n;
    w.i = 0;
    w.spot = to;
    w.mode = w.mode === 'home' ? 'home' : 'walk';
    w.faceYaw = target.yaw;
    w.sitting = false;
  }

  /** Head for a door and go in (no door left: pop out where one stands). */
  private goHome(w: Walker): void {
    if (w.spot >= 0 && this.taken[w.spot] === w) this.taken[w.spot] = null;
    const door = this.freeSpot(w.spot, true);
    w.mode = 'home';
    if (door < 0 || this.spots[door]!.kind !== 'door') {
      w.fading = true;
      return;
    }
    this.walkTo(w, door);
  }

  // ---- frame ------------------------------------------------------------------------------------------------------
  private step(w: Walker, dt: number, dark: number): void {
    const p = w.p;
    if (!w.fading) {
      if (w.n > w.i) this.walk(w, dt);
      else {
        w.speed = approach(w.speed, 0, 10 * dt);
        if (!Number.isNaN(w.faceYaw)) w.yaw = dampAngle(w.yaw, w.faceYaw, 8, dt);
        this.think(w, dt);
      }
    } else {
      w.speed = approach(w.speed, 0, 10 * dt);
    }
    // sync to the crowd (Townsfolk's channels)
    p.x = w.x;
    p.z = w.z;
    p.yaw = w.yaw;
    p.walk = approach(p.walk, clamp(w.speed / 1.4, 0, 1), dt * 6);
    p.phase += dt * w.speed * 3.4;
    p.sit = approach(p.sit, w.sitting && w.n <= w.i ? 1 : 0, dt * 3.2);
    const shop = w.mode === 'dwell' && w.spot >= 0 && this.spots[w.spot]?.kind === 'shop';
    p.talk = approach(p.talk, shop && w.rnd < 0.4 ? 0.6 : 0, dt * 2);
    p.headPitch = approach(p.headPitch, shop ? -0.12 : 0, dt * 2);
    p.lantern = approach(p.lantern, dark > NIGHT_LANTERN && w.rnd < 0.5 && !p.kid ? 1 : 0, dt * 3);
    p.appear = w.fading ? Math.max(0, p.appear - dt * 2.5) : Math.min(1, p.appear + dt * 2.5);
    if (w.fading && p.appear <= 0.001) this.release(w);
  }

  private think(w: Walker, dt: number): void {
    if (w.mode === 'walk') {
      // arrived
      const s = w.spot >= 0 ? this.spots[w.spot] : undefined;
      w.mode = 'dwell';
      const [lo, hi] = s ? DWELL[s.kind] : DWELL.walk;
      w.timer = lo + Math.random() * (hi - lo);
      w.sitting = s?.kind === 'bench';
      return;
    }
    if (w.mode === 'home') {
      w.fading = true; // in through the door
      return;
    }
    w.timer -= dt;
    if (w.timer > 0) return;
    w.visits--;
    if (w.visits <= 0) return this.goHome(w);
    const next = this.freeSpot(w.spot, false);
    if (next < 0) {
      w.timer = 1;
      return;
    }
    this.walkTo(w, next);
  }

  private walk(w: Walker, dt: number): void {
    const last = w.i === w.n - 1;
    const tx = w.px[w.i]!;
    const tz = w.pz[w.i]!;
    const dx = tx - w.x;
    const dz = tz - w.z;
    const d = Math.hypot(dx, dz);
    const want = last ? Math.min(w.maxSpeed, 0.5 + d * 3.5) : w.maxSpeed;
    w.speed = approach(w.speed, want, 8 * dt);
    const step = w.speed * dt;
    if (d <= step + 0.01) {
      w.x = tx;
      w.z = tz;
      w.i++;
    } else {
      w.x += (dx / d) * step;
      w.z += (dz / d) * step;
    }
    if (d > 0.04) w.yaw = dampAngle(w.yaw, Math.atan2(dx, dz), 12, dt);
  }

  private release(w: Walker): void {
    const i = this.walkers.indexOf(w);
    if (i >= 0) this.walkers.splice(i, 1);
    if (w.spot >= 0 && this.taken[w.spot] === w) this.taken[w.spot] = null;
    this.crowdOf().release(w.p);
  }

  /** Debug / tests: the spots of the district now. */
  get spotList(): readonly LifeSpot[] {
    return this.spots;
  }

  /** Debug / tests: the built buildings the life sees. */
  get buildings(): number {
    let n = 0;
    for (const l of this.lots()) if (lotBuilt(l) && CITY_BUILDINGS[l.building as CityBuildingId]) n++;
    return n;
  }
}
