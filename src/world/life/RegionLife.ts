/**
 * [0.9.8 — life] The crew's families out on their green (brief 16, ambient townsfolk): in each era region the hired
 * crews' huts face a little green with a fire pit, well, brazier, lamps, kiosk, fountain or orb in its middle. Now
 * people step out of the built huts' doors, stroll to the green, stand round its centrepiece warming their hands or
 * chatting, wander to another spot, and go home again; at night some carry a lantern and fewer are out.
 *
 * Safe by construction: every spot lies inside the green (door spots are the door's point pulled onto the green's
 * edge), and the green is a rectangle, so a straight walk between two spots never leaves it and never crosses a hut,
 * a pad, a belt or a machine. Walks that would pass through the centrepiece bend round it. No colliders: they never
 * block the player.
 *
 * 1.0 (EM1): the walks keep to a small part of the green so the rest can hold decor (eras/layout.ts plotDecor): a door
 * opens onto ITS spoke (a straight line to the ring spot nearest it, `greenWalk`), people stroll the ring's chords, and
 * go home the same way. `greenLegs` is that rule, pure.
 *
 * 0.9.13 (review idea 2, E6): residents run errands. A grown-up stepping out now and then goes to the market stall on
 * the green instead (eras/layout.ts greenStalls: its line and the walks to it from every door), joins the back of the
 * line, steps up as the line moves, buys, and carries a basket of goods home round the line. In eras 6-8 a loader
 * works at the market's parked era vehicle by day, carrying crates from the stack behind it to its side door; they
 * step out of its cab in the morning and back in at dusk.
 *
 * Cheap: one small instanced crowd (npc/Crowd.ts, 5 draw calls + 5 in the shadow pass while anyone is out, none
 * otherwise), only for the region the player stands in; walking away releases everyone. Nothing is saved.
 */
import * as THREE from 'three';
import { ERA_CREW_COUNT, ERA_ROLES, eraRoleCount } from '../../config';
import { approach, clamp, dampAngle } from '../../core/math';
import type { GameContext, UpgradeId } from '../../core/types';
import { ERAS } from '../../eras/data';
import { greenActivities, greenPlaza, greenStalls, greenWalk, PLAZA_HALF, plotDecor, plotPlaces, QUEUE_PLACES, type DecorPlace, type GreenActivity, type PlotPlaces, type StallQueue, type XZ } from '../../eras/layout';
import { regionAt } from '../../eras/playerUpgrades';
import { COAT_COLORS, Crowd, GOODS_COLORS, TRIM_COLORS, type CrowdPerson } from '../../npc/Crowd';
import { GreenProps } from './greenProps';

/** People out at once on one green (a full crew), fewer at night. */
const MAX_OUT = 8;
/** Keep this far (m) from the green's centrepiece. */
const CLEAR = 1.7;
const NIGHT_LANTERN = 0.45;

// 0.9.12 (Dino: "people doing things"): what the people on a green get up to between strolls
/** Chance, at a ring spot, of going to sit on a bench or build a snowman instead of strolling on. */
const ACT_CHANCE = 0.4;
/** Chance a person stepping out of a door sweeps the doorstep first (daytime). */
const SWEEP_CHANCE = 0.3;
/** Kids on the green (they start snowball fights with each other). */
const KID_CHANCE = 0.5;
/** A snowball fight: two kids on ring spots this far apart (m), for this long (s). */
const FIGHT_RANGE: readonly [number, number] = [1.4, 5.5];
const FIGHT_TIME: readonly [number, number] = [9, 15];
const BALL_FLIGHT = 0.7;
/** A snowman takes this long to build (s) and stands this long once nobody is building it. */
const BUILD_TIME = 16;
const SNOWMAN_STAYS = 150;
/** Share of a green's snowman spots that already have one standing when you arrive (built before you came). */
const SNOWMEN_WAITING = 0.6;
/** A snowball bursts into a puff of snow on a hit, over this long (s). */
const PUFF_TIME = 0.45;
// 0.9.13 (review idea 2): errands to the green's market stall
/** Chance a grown-up stepping out goes to the stall (when its line has room). */
const ERRAND_CHANCE = 0.45;

/**
 * 1.0 polish: strollers on a big green's plaza ring walk (eras/layout.ts greenPlaza), so the square round the
 * centrepiece is used and not only its middle. They keep to the ring (decor stays 1 m off it), walk both ways round in
 * two lanes, stop for anyone a step ahead of them (the player, a resident crossing), and pause now and then to look at
 * the centrepiece. A pair walks side by side. Fewer at night, with lanterns; nobody in a snowstorm.
 */
const STROLLERS = 5;
const STROLL_NIGHT = 2;
/** Lane offset (m) from the ring walk's centre line: clockwise walkers on the outside, the others inside. */
const STROLL_LANE = 0.14;
/** Someone this near (m) ahead along the ring makes a stroller wait. */
const STROLL_YIELD = 0.85;

interface Stroller {
  p: CrowdPerson;
  /** Angle round the plaza centre, direction (+1 / -1) and walking speed (m/s). */
  a: number;
  dir: number;
  speed: number;
  /** Seconds left of a pause (looking at the centrepiece), and until the next pause. */
  pause: number;
  next: number;
  mate?: Stroller;
  leaving: boolean;
}
/** Seconds at the counter, buying. */
const BUY_TIME: readonly [number, number] = [2.5, 4.5];
/** What they carry home. */
const BASKET_GOODS = [GOODS_COLORS.bread!, GOODS_COLORS.wheat!, GOODS_COLORS.toy!, GOODS_COLORS.sausage!, GOODS_COLORS.default!];
/** 0.9.13 (review E6): the loader at the market's parked era vehicle: where (vehicle-local, nose +X) they lift a crate
 * off the stack behind it and where they put it in at its side, how long each takes (s), and darker than this they go home. */
export const LOAD_PICK = { x: -2.2, z: 0.5 };
export const LOAD_DROP = { x: -0.9, z: 1.3 };
const LOAD_LIFT = 2.2;
const LOAD_PUT = 1.1;
const LOADER_DARK = 0.55;
/** Passing: someone this close ahead (m) on the way makes a walker step this far to their right. */
const PASS_AHEAD = 1.4;
const PASS_SIDE = 0.3;

interface Spot {
  x: number;
  z: number;
  /** Face this way while there (NaN = keep walking yaw). */
  face: number;
  door: boolean;
  /** Ring spots round the centrepiece take one person each. */
  taken: boolean;
  /** A door spot: the index (in the spot list) of the ring spot its spoke ends on. */
  via: number;
  /** A door spot: its hut (P.huts index); −1 on the ring. */
  hut: number;
}

interface Walker {
  p: CrowdPerson;
  spot: number;
  /** The waypoints of the walk (spokes, bends round the centrepiece, then the spot). */
  px: number[];
  pz: number[];
  n: number;
  i: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  timer: number;
  visits: number;
  home: boolean;
  fading: boolean;
  chatty: boolean;
  /** 0.9.12: what they are doing (null: strolling). */
  act: Act | null;
  /** A free activity they are walking to the ring spot of (index into the region's activities), or −1. */
  plan: number;
  /** 'sit' while on a bench seat (the soak watchdog lets a seated person be inside the bench), else 'stroll'. */
  mode: 'sit' | 'stroll';
  /** 0.9.13: an errand to a stall (null: none). */
  errand: Errand | null;
  /** 0.9.13: how far (m) they step to their right to pass someone. */
  side: number;
}

interface Errand {
  /** The stall (index into the region's stall queues) and the hut they came from (and go home to). */
  q: number;
  hut: number;
  /** 'go': walking to the back of the line; 'line': in it; 'buy': at the counter; 'home': walking home with the basket. */
  stage: 'go' | 'line' | 'buy' | 'home';
  timer: number;
}

interface Loader {
  p: CrowdPerson;
  /** 'lift' at the stack, 'carry' to the side door, 'put' it in, 'back' to the stack. */
  stage: 'lift' | 'carry' | 'put' | 'back';
  timer: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  leaving: boolean;
}

interface Act {
  kind: 'sit' | 'snowman' | 'sweep' | 'fight';
  /** The activity's index (sit / snowman), or −1. */
  idx: number;
  /** 'go': stepping off the ring to it; 'do': at it; 'back': stepping back onto the ring spot. */
  stage: 'go' | 'do' | 'back';
  timer: number;
  /** Fight: the other kid, the next throw, and whose throw it is. */
  mate?: Walker;
  throwIn?: number;
}

interface Ball {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  t: number;
  to: Walker;
}

const _goal: XZ = { x: 0, z: 0 };

/** Is b a step in front of a, in a's path (0.9.13 RegionLife.closeAhead)? */
function ahead(a: { yaw: number; p: CrowdPerson }, b: { p: CrowdPerson }): boolean {
  const fx = Math.sin(a.yaw);
  const fz = Math.cos(a.yaw);
  const dx = b.p.x - a.p.x;
  const dz = b.p.z - a.p.z;
  const along = dx * fx + dz * fz;
  return along > 0 && along < 0.75 && Math.abs(dx * fz - dz * fx) < 0.4;
}

/** Built huts per crew role: the same rule the huts use (world/env/plots.ts hutStage ≥ 1). */
function hutBuilt(role: number, level: number): boolean {
  if (role === 0) return (ERA_CREW_COUNT[Math.min(level, ERA_CREW_COUNT.length - 1)] ?? 0) >= 1;
  return eraRoleCount(level) >= 1;
}

/**
 * The green's spots (pure): a door spot per built hut, then a ring round the centrepiece (eras/layout.ts greenWalk
 * has the numbers). Exported for tests. `built[i]` says whether hut i stands.
 */
export function greenSpots(P: PlotPlaces, built: readonly boolean[]): Spot[] {
  const W = greenWalk(P);
  const out: Spot[] = [];
  const hutOf: number[] = [];
  P.huts.forEach((_, i) => {
    if (!built[i]) return;
    out.push({ x: W.doors[i]!.x, z: W.doors[i]!.z, face: NaN, door: true, taken: false, via: -1, hut: i });
    hutOf.push(i);
  });
  const doors = out.length;
  for (const p of W.ring) out.push({ x: p.x, z: p.z, face: Math.atan2(W.c.x - p.x, W.c.z - p.z), door: false, taken: false, via: -1, hut: -1 });
  hutOf.forEach((hut, k) => (out[k]!.via = doors + W.spoke[hut]!));
  return out;
}

/**
 * The waypoints (after leaving spot `from`) of a walk to spot `to` (pure): out of a door along its spoke to the ring,
 * round the ring, and into a door along its spoke, so every straight leg is a spoke or a chord of the ring.
 */
export function greenLegs(spots: readonly Spot[], from: number, to: number): XZ[] {
  const a = spots[from]!;
  const b = spots[to]!;
  const out: XZ[] = [];
  if (a.door && a.via >= 0) out.push(spots[a.via]!);
  if (b.door && b.via >= 0 && !out.includes(spots[b.via]!)) out.push(spots[b.via]!);
  if (out[out.length - 1] !== b) out.push(b);
  return out;
}

export class RegionLife {
  private crowd: Crowd | null = null;
  private readonly walkers: Walker[] = [];
  private region = 0;
  private places: PlotPlaces | null = null;
  private spots: Spot[] = [];
  private builtKey = '';
  private check = 0;
  private spawnT = 0;
  private acts: GreenActivity[] = [];
  private actTaken: boolean[] = [];
  /** Snowmen standing or growing, per snowman activity index: growth 0 … 1 and how long it still stands. */
  private readonly snowmen = new Map<number, { g: number; stays: number }>();
  private readonly balls: Ball[] = [];
  /** Snow puffs where a snowball hit (t 0 … 1). */
  private readonly puffs: { x: number; z: number; t: number; seed: number }[] = [];
  private props: GreenProps | null = null;
  /** 0.9.13: the region's stall queues, who stands in each line (head first) and how many are on their way to it. */
  private stalls: StallQueue[] = [];
  private lines: Walker[][] = [];
  private coming: number[] = [];
  /** The market's parked era vehicle (eras 6-8) and the loader working at it. */
  private van: DecorPlace | null = null;
  private loader: Loader | null = null;
  private readonly strollers: Stroller[] = [];
  private plaza: { c: XZ; r: number } | null = null;
  private loaderCheck = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly parent: THREE.Object3D,
  ) {}

  /** People out right now (tests, debug). */
  get count(): number {
    return this.walkers.length;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const p = this.ctx.player?.position;
    const n = p ? regionAt(p.x, p.z) : 0;
    if (n !== this.region) {
      this.clear();
      this.region = n;
      this.places = n >= 2 ? plotPlaces(n) : null;
      this.acts = n >= 2 ? greenActivities(n) : [];
      this.actTaken = this.acts.map(() => false);
      this.stalls = n >= 2 ? greenStalls(n) : [];
      this.lines = this.stalls.map(() => []);
      this.coming = this.stalls.map(() => 0);
      this.van = n >= 2 ? (plotDecor(n).find((d) => d.kind === 'van') ?? null) : null;
      const pl = this.places ? greenPlaza(this.places) : null;
      this.plaza = pl ? { c: pl.c, r: pl.R - PLAZA_HALF } : null;
      this.snowmen.clear();
      // some snowmen are already standing when you arrive (at least one on a green that has a spot for one)
      const spots = this.acts.map((a, i) => (a.kind === 'snowman' ? i : -1)).filter((i) => i >= 0);
      spots.forEach((i, k) => {
        if (k === 0 || Math.random() < SNOWMEN_WAITING) this.snowmen.set(i, { g: 1, stays: SNOWMAN_STAYS * (0.5 + Math.random()) });
      });
      this.balls.length = 0;
      this.puffs.length = 0;
      this.builtKey = '';
      this.check = 0;
    }
    if (!this.places) return;
    this.check -= dt;
    if (this.check <= 0) {
      this.check = 1;
      this.refreshSpots();
    }
    const dark = this.ctx.dayNight.darkness;
    const storm = this.ctx.worldEvents.active === 'snowstorm';
    const doors = this.spots.filter((s) => s.door).length;
    const target = storm ? 0 : Math.min(MAX_OUT, Math.round(doors * (dark > 0.5 ? 0.5 : 1)));
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.walkers.filter((w) => !w.home).length < target) {
      this.spawnT = 1.5 + Math.random() * 2.5;
      this.spawn();
    }
    for (let i = this.walkers.length - 1; i >= 0; i--) this.step(this.walkers[i]!, dt, dark, target);
    this.stepLoader(dt, dark, storm);
    this.stepProps(dt);
    this.stepStrollers(dt, dark, storm);
    if (this.crowd) this.crowd.update(this.ctx.time.elapsed, dark, this.ctx.renderer?.quality === 'high');
  }

  /**
   * 0.9.13: someone right in front on the way (a step ahead, in their path): slow down behind them instead of walking
   * into them. Two walking at each other (or crossing) don't both stop: the one with the lower id gives way while both
   * step to their right.
   */
  private closeAhead(w: Walker): boolean {
    for (const o of this.walkers) {
      if (o === w || o.fading) continue;
      if (!ahead(w, o)) continue;
      if (o.speed > 0.1 && ahead(o, w) && w.p.id > o.p.id) continue;
      return true;
    }
    return false;
  }

  /** Snowmen, brooms and snowballs this frame (one instanced mesh each). */
  private stepProps(dt: number): void {
    for (const [i, sm] of this.snowmen) {
      const building = this.walkers.some((w) => w.act?.kind === 'snowman' && w.act.idx === i && w.act.stage === 'do');
      if (building) sm.g = Math.min(1, sm.g + dt / BUILD_TIME);
      else if ((sm.stays -= dt) <= 0) sm.g -= dt / 6; // it slumps away
      if (sm.g <= 0) this.snowmen.delete(i);
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i]!;
      b.t += dt / BALL_FLIGHT;
      if (b.t >= 1) {
        // a hit: the other kid hops and laughs
        if (this.walkers.includes(b.to)) b.to.p.cheer = 1;
        this.puffs.push({ x: b.bx, z: b.bz, t: 0, seed: Math.random() * 6.28 });
        this.balls.splice(i, 1);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) if ((this.puffs[i]!.t += dt / PUFF_TIME) >= 1) this.puffs.splice(i, 1);
    if (!this.snowmen.size && !this.balls.length && !this.puffs.length && !this.walkers.some((w) => w.act?.kind === 'sweep' && w.act.stage === 'do')) {
      if (this.props) this.props.group.visible = false;
      return;
    }
    if (!this.props) {
      this.props = new GreenProps();
      this.parent.add(this.props.group);
    }
    const P = this.props;
    P.group.visible = true;
    P.begin();
    for (const [i, sm] of this.snowmen) {
      const a = this.acts[i]!;
      P.snowman(a.sx!, a.sz!, a.yaw + Math.PI, Math.max(0, sm.g));
    }
    const t = this.ctx.time.elapsed;
    for (const w of this.walkers) if (w.act?.kind === 'sweep' && w.act.stage === 'do') P.broom(w.x, w.z, w.yaw, Math.sin(t * 5 + w.p.seed * 7));
    for (const b of this.balls) P.ball(b.ax + (b.bx - b.ax) * b.t, 0.9 + Math.sin(b.t * Math.PI) * 1.1, b.az + (b.bz - b.az) * b.t);
    for (const f of this.puffs) {
      for (let k = 0; k < 6; k++) {
        const a = f.seed + (k / 6) * Math.PI * 2;
        const r = 0.12 + f.t * 0.45;
        P.ball(f.x + Math.cos(a) * r, 1.0 + f.t * 0.25 - f.t * f.t * 0.7, f.z + Math.sin(a) * r, 0.55 * (1 - f.t));
      }
    }
    P.end();
  }

  /** Everyone goes at once (the player left the region). */
  clear(): void {
    for (const w of this.walkers) this.crowd?.release(w.p);
    this.walkers.length = 0;
    this.lines = this.stalls.map(() => []);
    this.coming = this.stalls.map(() => 0);
    if (this.loader) this.crowd?.release(this.loader.p);
    this.loader = null;
    for (const s of this.strollers) this.crowd?.release(s.p);
    this.strollers.length = 0;
    for (const s of this.spots) s.taken = false;
    this.actTaken = this.acts.map(() => false);
    this.balls.length = 0;
  }

  private refreshSpots(): void {
    const P = this.places!;
    const key = ERAS[this.region]?.key;
    if (!key) return;
    const ids: UpgradeId[] = [`${key}Crew` as UpgradeId, ...ERA_ROLES.map((r) => `${key}${r.key}` as UpgradeId)];
    const built = P.huts.map((_, i) => hutBuilt(i, this.ctx.upgrades.level(ids[i]!)));
    const k = built.map((b) => (b ? 1 : 0)).join('');
    if (k === this.builtKey) return;
    const first = this.builtKey === '';
    this.builtKey = k;
    const next = greenSpots(P, built);
    if (first) {
      this.spots = next;
      return;
    }
    // 0.9.13 (review B6): a hut built while people are out (the player just paid for it, right there) no longer clears
    // the green. The spots are the same points with the new hut's door added, so everyone keeps theirs (by place); one
    // whose door went (a reset) heads in through the nearest door left, or fades if there is none.
    const map = this.spots.map((o) => next.findIndex((n) => n.door === o.door && n.x === o.x && n.z === o.z));
    this.spots.forEach((o, i) => {
      const j = map[i]!;
      if (j >= 0) next[j]!.taken = o.taken;
    });
    this.spots = next;
    for (const w of this.walkers) {
      w.spot = map[w.spot] ?? -1;
      if (w.spot >= 0 || w.fading || w.errand) continue; // an errand ends at its own hut's door spot (hut index, not spot)
      const door = this.nearestDoor(w);
      if (door < 0) w.fading = true;
      else {
        w.home = true;
        if (w.act && w.act.idx >= 0) this.actTaken[w.act.idx] = false;
        if (w.plan >= 0) this.actTaken[w.plan] = false;
        w.act = null;
        w.plan = -1;
        this.walkTo(w, door);
      }
    }
  }

  /** The door spot nearest walker `w` (−1: no hut stands). */
  private nearestDoor(w: Walker): number {
    let best = -1;
    let bd = Infinity;
    this.spots.forEach((s, i) => {
      const d = (s.x - w.x) ** 2 + (s.z - w.z) ** 2;
      if (s.door && d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private crowdOf(): Crowd {
    if (!this.crowd) {
      this.crowd = new Crowd(MAX_OUT + 3 + STROLLERS);
      this.crowd.group.name = 'region-life';
      for (const m of this.crowd.meshes) m.frustumCulled = false;
      this.parent.add(this.crowd.group);
    }
    return this.crowd;
  }

  /** The plaza ring's strollers: bring them to the time of day's count (fading in / out where they are), then walk them. */
  private stepStrollers(dt: number, dark: number, storm: boolean): void {
    const pl = this.plaza;
    const want = !pl || storm ? 0 : dark > 0.5 ? STROLL_NIGHT : STROLLERS;
    let live = 0;
    for (const s of this.strollers) if (!s.leaving) live++;
    if (pl && live < want && this.strollers.length < STROLLERS) {
      const p = this.crowdOf().acquire(COAT_COLORS[Math.floor(Math.random() * COAT_COLORS.length)]!, TRIM_COLORS[Math.floor(Math.random() * TRIM_COLORS.length)]!);
      if (p) {
        p.kid = Math.random() < 0.25;
        p.appear = 0;
        // the second one walks beside the first, a pace behind on the inner lane
        const lead = this.strollers.length === 1 && !this.strollers[0]!.leaving ? this.strollers[0] : undefined;
        const s: Stroller = lead
          ? { p, a: lead.a - (lead.dir * 0.5) / pl.r, dir: lead.dir, speed: lead.speed, pause: 0, next: lead.next, mate: lead, leaving: false }
          : { p, a: Math.random() * Math.PI * 2, dir: Math.random() < 0.5 ? 1 : -1, speed: 0.75 + Math.random() * 0.35, pause: 0, next: 6 + Math.random() * 14, leaving: false };
        this.strollers.push(s);
      }
    } else if (live > want) {
      // the last ones out go first (never the lead of a pair before its partner)
      for (let i = this.strollers.length - 1; i >= 0; i--) {
        if (!this.strollers[i]!.leaving) {
          this.strollers[i]!.leaving = true;
          break;
        }
      }
    }
    const pp = this.ctx.player?.position;
    for (let i = this.strollers.length - 1; i >= 0; i--) {
      const s = this.strollers[i]!;
      const p = s.p;
      if (!pl) {
        this.crowd?.release(p);
        this.strollers.splice(i, 1);
        continue;
      }
      p.appear = approach(p.appear, s.leaving ? 0 : 1, dt * 1.5);
      if (s.leaving && p.appear <= 0.01) {
        this.crowd?.release(p);
        this.strollers.splice(i, 1);
        for (const o of this.strollers) if (o.mate === s) o.mate = undefined;
        continue;
      }
      const r = pl.r + (s.dir > 0 ? STROLL_LANE : -STROLL_LANE) - (s.mate ? 0.36 * s.dir : 0);
      // the point a step ahead: wait there for the player or anyone on the green
      const ta = s.a + (s.dir * STROLL_YIELD) / pl.r;
      const ax = pl.c.x + Math.cos(ta) * r;
      const az = pl.c.z + Math.sin(ta) * r;
      let blocked = !!pp && Math.hypot(pp.x - ax, pp.z - az) < STROLL_YIELD;
      for (let k = 0; k < this.walkers.length && !blocked; k++) blocked = Math.hypot(this.walkers[k]!.p.x - ax, this.walkers[k]!.p.z - az) < 0.6;
      for (let k = 0; k < this.strollers.length && !blocked; k++) {
        const o = this.strollers[k]!;
        if (o !== s && o.dir === s.dir && o !== s.mate && o.mate !== s) blocked = Math.hypot(o.p.x - ax, o.p.z - az) < 0.6;
      }
      if (s.mate) {
        // keep step with the partner: walk and stop together
        s.pause = s.mate.pause;
        if (s.mate.speed === 0 || s.mate.pause > 0) blocked = true;
      } else if (s.pause <= 0) {
        s.next -= dt;
        if (s.next <= 0) {
          s.pause = 3 + Math.random() * 4;
          s.next = 10 + Math.random() * 18;
        }
      }
      const moving = !blocked && s.pause <= 0;
      if (s.pause > 0) s.pause -= dt;
      const v = moving ? s.speed : 0;
      s.a += (s.dir * v * dt) / Math.max(1, r);
      p.x = pl.c.x + Math.cos(s.a) * r;
      p.z = pl.c.z + Math.sin(s.a) * r;
      p.y = 0;
      const face = s.pause > 0 ? Math.atan2(pl.c.x - p.x, pl.c.z - p.z) : Math.atan2(-Math.sin(s.a) * s.dir, Math.cos(s.a) * s.dir);
      p.yaw = dampAngle(p.yaw, face, 6, dt);
      p.walk = approach(p.walk, moving ? 1 : 0, dt * 4);
      if (moving) p.phase += dt * v * 3.4;
      p.talk = s.mate || this.strollers.some((o) => o.mate === s) ? 0.5 : 0;
      p.lantern = approach(p.lantern, dark > NIGHT_LANTERN && !p.kid ? 1 : 0, dt * 3);
    }
  }

  private freeSpot(door: boolean, not = -1): number {
    const ids: number[] = [];
    this.spots.forEach((s, i) => {
      if (i !== not && s.door === door && !s.taken) ids.push(i);
    });
    return ids.length ? ids[Math.floor(Math.random() * ids.length)]! : -1;
  }

  private spawn(): void {
    const d = this.freeSpot(true);
    if (d < 0) return;
    // 0.9.13: nobody steps out into someone on the doorstep (a sweeper, someone just home)
    if (this.walkers.some((o) => Math.hypot(o.p.x - this.spots[d]!.x, o.p.z - this.spots[d]!.z) < 0.9)) return;
    const s = this.spots[d]!;
    const p = this.crowdOf().acquire(COAT_COLORS[Math.floor(Math.random() * COAT_COLORS.length)]!, TRIM_COLORS[Math.floor(Math.random() * TRIM_COLORS.length)]!);
    if (!p) return;
    p.kid = Math.random() < KID_CHANCE;
    p.appear = 0;
    const w: Walker = { p, spot: d, px: [], pz: [], n: 0, i: 0, x: s.x, z: s.z, yaw: 0, speed: 0, timer: 0.3, visits: 2 + Math.floor(Math.random() * 3), home: false, fading: false, chatty: Math.random() < 0.5, act: null, plan: -1, mode: 'stroll', errand: null, side: 0 };
    // 0.9.13 (review idea 2): a grown-up goes to the stall now and then
    if (!p.kid && Math.random() < ERRAND_CHANCE && this.startErrand(w, s.hut)) {
      this.walkers.push(w);
      return;
    }
    // a grown-up sweeps the doorstep first now and then (facing out over the green, by day)
    if (!p.kid && this.ctx.dayNight.darkness < 0.4 && Math.random() < SWEEP_CHANCE) {
      w.yaw = Math.atan2(this.places!.green.minX + (this.places!.green.maxX - this.places!.green.minX) / 2 - s.x, this.places!.green.minZ + (this.places!.green.maxZ - this.places!.green.minZ) / 2 - s.z);
      w.act = { kind: 'sweep', idx: -1, stage: 'do', timer: 6 + Math.random() * 4 };
    }
    this.walkers.push(w);
  }

  /** Walk to spot `to` along its legs (greenLegs), bending round the centrepiece when a straight leg would cross it. */
  private walkTo(w: Walker, to: number): void {
    const from = this.spots[w.spot];
    if (from && !from.door) from.taken = false;
    const s = this.spots[to]!;
    if (!s.door) s.taken = true;
    const G = this.places!.green;
    const cx = (G.minX + G.maxX) / 2;
    const cz = (G.minZ + G.maxZ) / 2;
    const legs = greenLegs(this.spots, w.spot, to);
    w.spot = to;
    w.px.length = 0;
    w.pz.length = 0;
    w.i = 0;
    let x = w.x;
    let z = w.z;
    for (const p of legs) {
      // closest approach of the leg to the centre
      const dx = p.x - x;
      const dz = p.z - z;
      const len2 = dx * dx + dz * dz || 1;
      const t = clamp(((cx - x) * dx + (cz - z) * dz) / len2, 0, 1);
      const qx = x + dx * t - cx;
      const qz = z + dz * t - cz;
      const q = Math.hypot(qx, qz);
      if (q < CLEAR && t > 0 && t < 1) {
        // bend out round the centrepiece on the side the line already passes
        const ux = q > 1e-3 ? qx / q : -dz / Math.sqrt(len2);
        const uz = q > 1e-3 ? qz / q : dx / Math.sqrt(len2);
        w.px.push(clamp(cx + ux * (CLEAR + 0.4), G.minX + 0.4, G.maxX - 0.4));
        w.pz.push(clamp(cz + uz * (CLEAR + 0.4), G.minZ + 0.4, G.maxZ - 0.4));
      }
      w.px.push(p.x);
      w.pz.push(p.z);
      x = p.x;
      z = p.z;
    }
    w.n = w.px.length;
  }

  private step(w: Walker, dt: number, dark: number, target: number): void {
    const p = w.p;
    if (!w.fading) {
      if (w.i < w.n) {
        const tx = w.px[w.i]!;
        const tz = w.pz[w.i]!;
        const dx = tx - w.x;
        const dz = tz - w.z;
        const d = Math.hypot(dx, dz);
        const last = w.i === w.n - 1;
        const blocked = this.closeAhead(w);
        // on the last step home with someone on the doorstep: in through the door already
        if (blocked && last && d < 1.2 && (w.home || w.errand?.stage === 'home')) {
          this.dropErrand(w);
          w.home = true;
          w.fading = true;
        }
        w.speed = approach(w.speed, Math.min(last ? Math.min(1.25, 0.5 + d * 3) : 1.25, blocked ? 0.15 : Infinity), 6 * dt); // a shuffle, stepping aside
        if (d < 0.08) w.i++;
        else {
          const k = Math.min(d, w.speed * dt) / d;
          w.x += dx * k;
          w.z += dz * k;
          w.yaw = dampAngle(w.yaw, Math.atan2(dx, dz), 10, dt);
        }
      } else {
        w.speed = approach(w.speed, 0, 10 * dt);
        if (w.errand) this.doErrand(w, dt);
        else if (w.act) this.doAct(w, dt);
        else {
          const s = this.spots[w.spot];
          if (s && !Number.isNaN(s.face)) w.yaw = dampAngle(w.yaw, s.face, 6, dt);
          this.think(w, dt, target);
        }
      }
    } else w.speed = approach(w.speed, 0, 10 * dt);
    // 0.9.13: someone walking toward another person close ahead keeps to their right and passes (a sidestep of up to
    // PASS_SIDE, inside every walk's clearance), so two people on one walk never go through each other
    let side = 0;
    if (w.speed > 0.1 && w.errand?.stage !== 'line') {
      const fx = Math.sin(w.yaw);
      const fz = Math.cos(w.yaw);
      for (const o of this.walkers) {
        if (o === w || o.fading) continue;
        const dx = o.p.x - w.x;
        const dz = o.p.z - w.z;
        const along = dx * fx + dz * fz;
        if (along > 0 && along < PASS_AHEAD && Math.abs(dx * fz - dz * fx) < PASS_SIDE + 0.3) side = PASS_SIDE;
      }
    }
    if (w.speed > 0.1) w.side = approach(w.side, side, dt * 0.9); // only shifts while walking, never slides on the spot
    // right of the heading (yaw 0 = +Z): (−cos, sin)… as seen walking, the right hand is −X when facing +Z
    p.x = w.x - Math.cos(w.yaw) * w.side;
    p.z = w.z + Math.sin(w.yaw) * w.side;
    p.yaw = w.yaw;
    p.walk = approach(p.walk, clamp(w.speed / 1.3, 0, 1), dt * 6);
    p.phase += dt * w.speed * 3.4;
    const atRing = w.i >= w.n && !this.spots[w.spot]?.door && !w.act;
    const buying = w.errand?.stage === 'buy';
    p.talk = approach(p.talk, (atRing && w.chatty) || buying ? 0.6 : 0, dt * 2);
    p.carry = approach(p.carry, p.basket ? 1 : 0, dt * 4);
    p.wave = approach(p.wave, 0, dt * 2);
    const doing = w.act?.stage === 'do' && w.i >= w.n ? w.act.kind : null;
    w.mode = doing === 'sit' ? 'sit' : 'stroll';
    p.sit = approach(p.sit, doing === 'sit' ? 1 : 0, dt * 3);
    p.work = approach(p.work, doing === 'snowman' || doing === 'sweep' ? 1 : 0, dt * 3);
    p.cheer = approach(p.cheer, 0, dt * 1.6);
    // by night someone running an errand always takes a lantern
    p.lantern = approach(p.lantern, dark > NIGHT_LANTERN && (w.chatty || !!w.errand) && !p.kid ? 1 : 0, dt * 3);
    p.appear = w.fading ? Math.max(0, p.appear - dt * 2.5) : Math.min(1, p.appear + dt * 2.5);
    if (w.fading && p.appear <= 0.001) {
      const s = this.spots[w.spot];
      if (s && !s.door) s.taken = false;
      if (w.act && w.act.idx >= 0) this.actTaken[w.act.idx] = false;
      if (w.plan >= 0) this.actTaken[w.plan] = false;
      this.dropErrand(w);
      this.crowd?.release(p);
      this.walkers.splice(this.walkers.indexOf(w), 1);
    }
  }

  private think(w: Walker, dt: number, target: number): void {
    if (w.home) {
      w.fading = true; // in through the door
      return;
    }
    w.timer -= dt;
    if (w.timer > 0) return;
    const out = this.walkers.filter((x) => !x.home).length;
    w.visits--;
    if (w.visits <= 0 || out > target) {
      // home: the nearest door
      const best = this.nearestDoor(w);
      if (best < 0) {
        w.fading = true;
        return;
      }
      w.home = true;
      this.walkTo(w, best);
      return;
    }
    if (this.startAct(w)) return;
    const next = this.freeSpot(false, w.spot);
    if (next < 0) {
      w.timer = 1.5;
      return;
    }
    this.walkTo(w, next);
    w.timer = 5 + Math.random() * 9; // dwell at the next spot
  }

  /** Index (in the spot list) of ring spot k. */
  private ringSpot(k: number): number {
    return this.spots.filter((s) => s.door).length + k;
  }

  /**
   * At a ring spot: step off to the planned activity, start a snowball fight with another kid, or now and then plan
   * a bench or a snowman (walk to its ring spot first). True when something started.
   */
  private startAct(w: Walker): boolean {
    if (this.spots[w.spot]?.door) return false;
    if (w.plan >= 0) {
      const a = this.acts[w.plan]!;
      const idx = w.plan;
      w.plan = -1;
      if (this.ringSpot(a.ring) === w.spot) {
        this.legs(w, a.kind === 'sit' ? [{ x: a.ax, z: a.az }, { x: a.x, z: a.z }] : [{ x: a.x, z: a.z }]);
        w.act = { kind: a.kind, idx, stage: 'go', timer: 0 };
        return true;
      }
      this.actTaken[idx] = false;
    }
    if (w.p.kid && Math.random() < 0.6) {
      const G = this.places!.green;
      const cx = (G.minX + G.maxX) / 2;
      const cz = (G.minZ + G.maxZ) / 2;
      for (const o of this.walkers) {
        if (o === w || !o.p.kid || o.act || o.errand || o.plan >= 0 || o.home || o.fading || o.i < o.n || this.spots[o.spot]?.door) continue;
        const d = Math.hypot(o.x - w.x, o.z - w.z);
        if (d < FIGHT_RANGE[0] || d > FIGHT_RANGE[1]) continue;
        // the snowballs fly clear of the centrepiece
        const dx = o.x - w.x;
        const dz = o.z - w.z;
        const t = clamp(((cx - w.x) * dx + (cz - w.z) * dz) / (d * d), 0, 1);
        if (Math.hypot(w.x + dx * t - cx, w.z + dz * t - cz) < CLEAR) continue;
        const time = FIGHT_TIME[0] + Math.random() * (FIGHT_TIME[1] - FIGHT_TIME[0]);
        w.act = { kind: 'fight', idx: -1, stage: 'do', timer: time, mate: o, throwIn: 0.4 + Math.random() * 0.6 };
        o.act = { kind: 'fight', idx: -1, stage: 'do', timer: time, mate: w, throwIn: 1.2 + Math.random() * 0.8 };
        o.timer = 0;
        return true;
      }
      // nobody to throw at yet: hang about a little longer in case another kid comes by
      if (Math.random() < 0.5) {
        w.timer = 3 + Math.random() * 3;
        return true;
      }
    }
    if (Math.random() >= ACT_CHANCE) return false;
    const free: number[] = [];
    this.acts.forEach((a, i) => {
      if (this.actTaken[i]) return;
      if (a.kind === 'snowman' && (this.snowmen.get(i)?.g ?? 0) >= 1) return; // already standing
      if (a.kind === 'sit' && w.p.kid && Math.random() < 0.7) return;
      const rs = this.ringSpot(a.ring);
      if (rs !== w.spot && this.spots[rs]?.taken) return;
      free.push(i);
    });
    if (!free.length) return false;
    const idx = free[Math.floor(Math.random() * free.length)]!;
    this.actTaken[idx] = true;
    w.plan = idx;
    const rs = this.ringSpot(this.acts[idx]!.ring);
    if (rs !== w.spot) this.walkTo(w, rs);
    w.timer = 0;
    return true;
  }

  /** Straight legs from where the walker stands (each one checked clear by eras/layout.ts greenActivities). */
  private legs(w: Walker, pts: readonly XZ[]): void {
    w.px.length = 0;
    w.pz.length = 0;
    for (const q of pts) {
      w.px.push(q.x);
      w.pz.push(q.z);
    }
    w.i = 0;
    w.n = w.px.length;
  }

  /**
   * Send a walker who just stepped out of hut `hut`'s door to a stall whose line has room (counting those already on
   * their way). False when no stall has room or none can be walked to from this door.
   */
  private startErrand(w: Walker, hut: number): boolean {
    const free: number[] = [];
    this.stalls.forEach((q, i) => {
      if (q.to[hut] && this.lines[i]!.length + this.coming[i]! < QUEUE_PLACES) free.push(i);
    });
    if (!free.length) return false;
    const q = free[Math.floor(Math.random() * free.length)]!;
    this.coming[q]!++;
    w.errand = { q, hut, stage: 'go', timer: 0 };
    w.p.basket = false;
    this.crowd?.setColors(w.p.id, COAT_COLORS[Math.floor(Math.random() * COAT_COLORS.length)]!, TRIM_COLORS[Math.floor(Math.random() * TRIM_COLORS.length)]!, BASKET_GOODS[Math.floor(Math.random() * BASKET_GOODS.length)]!);
    this.legs(w, this.stalls[q]!.to[hut]!);
    return true;
  }

  /** Out of the line (and off the way to it) for good: fading, or everyone cleared. */
  private dropErrand(w: Walker): void {
    const e = w.errand;
    if (!e) return;
    if (e.stage === 'go') this.coming[e.q] = Math.max(0, this.coming[e.q]! - 1);
    const line = this.lines[e.q];
    const k = line ? line.indexOf(w) : -1;
    if (k >= 0) line!.splice(k, 1);
    w.errand = null;
  }

  /** Arrived somewhere on an errand: join the line, step up, buy, or go in at home. */
  private doErrand(w: Walker, dt: number): void {
    const e = w.errand!;
    const Q = this.stalls[e.q]!;
    const line = this.lines[e.q]!;
    if (e.stage === 'go') {
      // at the back of the line: take the last place (the line only moves toward the counter)
      this.coming[e.q] = Math.max(0, this.coming[e.q]! - 1);
      line.push(w);
      e.stage = 'line';
      this.legs(w, [Q.places[line.length - 1]!]);
      return;
    }
    if (e.stage === 'home') {
      w.errand = null;
      w.home = true;
      w.fading = true; // in through the door
      return;
    }
    w.yaw = dampAngle(w.yaw, Q.face, 6, dt);
    if (e.stage === 'line') {
      const k = line.indexOf(w);
      const at = Q.places[k]!;
      if (Math.hypot(at.x - w.x, at.z - w.z) > 0.1) this.legs(w, [at]); // the one ahead moved: step up
      else if (k === 0) {
        e.stage = 'buy';
        e.timer = BUY_TIME[0] + Math.random() * (BUY_TIME[1] - BUY_TIME[0]);
      }
      return;
    }
    e.timer -= dt;
    if (e.timer > 0) return;
    // served: a basket of goods, a little wave, and home round the line
    line.splice(line.indexOf(w), 1);
    w.p.basket = true;
    w.p.wave = 1;
    e.stage = 'home';
    this.legs(w, Q.from[e.hut]!);
  }

  /**
   * The loader at the market's parked era vehicle (eras 6-8), by day and out of a snowstorm: lifts a crate off the stack
   * behind it, carries it to the side and puts it in, and walks back for the next. Steps out of the cab (fading in, like
   * the families at their doors) and back in at dusk.
   */
  private stepLoader(dt: number, dark: number, storm: boolean): void {
    const v = this.van;
    if (!v) return;
    const want = dark < LOADER_DARK && !storm;
    const local = (q: XZ, out: XZ): XZ => {
      out.x = v.x + q.x * Math.cos(v.yaw) + q.z * Math.sin(v.yaw);
      out.z = v.z - q.x * Math.sin(v.yaw) + q.z * Math.cos(v.yaw);
      return out;
    };
    let L = this.loader;
    if (!L) {
      this.loaderCheck -= dt;
      if (!want || this.loaderCheck > 0) return;
      this.loaderCheck = 1;
      // steps out of the vehicle's cab at its side, like the families out of their doors
      const p = this.crowdOf().acquire(COAT_COLORS[3 % COAT_COLORS.length]!, TRIM_COLORS[1]!, 0xc79a62);
      if (!p) return;
      p.appear = 0;
      const at = local(LOAD_DROP, { x: 0, z: 0 });
      L = this.loader = { p, stage: 'back', timer: 0, x: at.x, z: at.z, yaw: v.yaw + Math.PI, speed: 0, leaving: false };
    }
    if (!want) L.leaving = true;
    // going home (dusk, a storm): back into the cab once the crate in hand is loaded
    const gone = L.leaving && L.stage === 'put' && L.timer <= 0;
    L.p.appear = gone ? Math.max(0, L.p.appear - dt * 2.5) : Math.min(1, L.p.appear + dt * 2.5);
    if (gone && L.p.appear <= 0.001) {
      this.crowd?.release(L.p);
      this.loader = null;
      return;
    }
    const goal = local(L.stage === 'carry' || L.stage === 'put' ? LOAD_DROP : LOAD_PICK, _goal);
    const dx = goal.x - L.x;
    const dz = goal.z - L.z;
    const d = Math.hypot(dx, dz);
    if (L.stage === 'carry' || L.stage === 'back') {
      L.speed = approach(L.speed, Math.min(1.1, 0.4 + d * 2.5), 6 * dt);
      if (d < 0.05) {
        L.stage = L.stage === 'carry' ? 'put' : 'lift';
        L.timer = L.stage === 'put' ? LOAD_PUT : LOAD_LIFT;
      } else {
        const k = Math.min(d, L.speed * dt) / d;
        L.x += dx * k;
        L.z += dz * k;
        L.yaw = dampAngle(L.yaw, Math.atan2(dx, dz), 10, dt);
      }
    } else {
      L.speed = approach(L.speed, 0, 10 * dt);
      // at the stack: face the crates (vehicle-local +X); at the side: face the vehicle (local −Z)
      L.yaw = dampAngle(L.yaw, L.stage === 'lift' ? v.yaw + Math.PI / 2 : v.yaw + Math.PI, 8, dt);
      L.timer -= dt;
      if (L.timer <= 0 && L.leaving && L.stage === 'lift') {
        L.stage = 'carry'; // empty-handed to the cab
        L.p.basket = false;
      } else if (L.timer <= 0 && !(L.leaving && L.stage === 'put')) {
        L.p.basket = L.stage === 'lift';
        L.stage = L.stage === 'lift' ? 'carry' : 'back';
      }
    }
    const p = L.p;
    p.x = L.x;
    p.z = L.z;
    p.yaw = L.yaw;
    p.walk = approach(p.walk, clamp(L.speed / 1.3, 0, 1), dt * 6);
    p.phase += dt * L.speed * 3.4;
    p.work = approach(p.work, L.stage === 'lift' || L.stage === 'put' ? 1 : 0, dt * 3);
    p.carry = approach(p.carry, p.basket ? 1 : 0, dt * 4);
    p.lantern = 0;
  }

  /** At (or done with) an activity. */
  private doAct(w: Walker, dt: number): void {
    const a = w.act!;
    const site = a.idx >= 0 ? this.acts[a.idx]! : null;
    if (a.stage === 'go') {
      a.stage = 'do';
      a.timer = a.kind === 'sit' ? 12 + Math.random() * 14 : BUILD_TIME + 2;
      if (a.kind === 'snowman' && !this.snowmen.has(a.idx)) this.snowmen.set(a.idx, { g: 0, stays: SNOWMAN_STAYS });
      return;
    }
    if (a.stage === 'back') {
      if (a.idx >= 0) this.actTaken[a.idx] = false;
      w.act = null;
      w.timer = 2 + Math.random() * 4;
      w.visits--;
      return;
    }
    a.timer -= dt;
    if (site) w.yaw = dampAngle(w.yaw, site.yaw, 6, dt);
    if (a.kind === 'snowman') {
      const sm = this.snowmen.get(a.idx);
      if (sm) sm.stays = SNOWMAN_STAYS;
      if (sm && sm.g >= 1 && a.timer > 1.2) {
        w.p.cheer = 1; // done: a happy hop
        a.timer = 1.2;
      }
    }
    if (a.kind === 'fight') {
      const m = a.mate;
      if (!m || m.act?.mate !== w || m.fading) a.timer = 0;
      else {
        w.yaw = dampAngle(w.yaw, Math.atan2(m.x - w.x, m.z - w.z), 8, dt);
        a.throwIn! -= dt;
        if (a.throwIn! <= 0) {
          a.throwIn = 1.3 + Math.random() * 1.2;
          w.p.wave = 1; // the throw
          if (this.balls.length < 6) this.balls.push({ ax: w.x, az: w.z, bx: m.x, bz: m.z, t: 0, to: m });
        }
      }
    }
    if (a.timer > 0) return;
    if (a.kind === 'sweep' || a.kind === 'fight') {
      w.act = null;
      w.timer = 0.5 + Math.random() * 2;
      return;
    }
    // step back onto the ring spot the way they came
    a.stage = 'back';
    const ring = this.spots[w.spot]!;
    this.legs(w, a.kind === 'sit' ? [{ x: site!.ax, z: site!.az }, ring] : [ring]);
  }
}
