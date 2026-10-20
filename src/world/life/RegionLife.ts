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
 * Cheap: one small instanced crowd (npc/Crowd.ts, 5 draw calls + 5 in the shadow pass while anyone is out, none
 * otherwise), only for the region the player stands in; walking away releases everyone. Nothing is saved.
 */
import * as THREE from 'three';
import { ERA_CREW_COUNT, ERA_ROLES, eraRoleCount } from '../../config';
import { approach, clamp, dampAngle } from '../../core/math';
import type { GameContext, UpgradeId } from '../../core/types';
import { ERAS } from '../../eras/data';
import { greenActivities, greenWalk, plotPlaces, type GreenActivity, type PlotPlaces, type XZ } from '../../eras/layout';
import { regionAt } from '../../eras/playerUpgrades';
import { COAT_COLORS, Crowd, TRIM_COLORS, type CrowdPerson } from '../../npc/Crowd';
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
    out.push({ x: W.doors[i]!.x, z: W.doors[i]!.z, face: NaN, door: true, taken: false, via: -1 });
    hutOf.push(i);
  });
  const doors = out.length;
  for (const p of W.ring) out.push({ x: p.x, z: p.z, face: Math.atan2(W.c.x - p.x, W.c.z - p.z), door: false, taken: false, via: -1 });
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
    this.stepProps(dt);
    if (this.crowd) this.crowd.update(this.ctx.time.elapsed, dark, this.ctx.renderer?.quality === 'high');
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
    this.clear();
    this.builtKey = k;
    this.spots = greenSpots(P, built);
  }

  private crowdOf(): Crowd {
    if (!this.crowd) {
      this.crowd = new Crowd(MAX_OUT + 2);
      this.crowd.group.name = 'region-life';
      for (const m of this.crowd.meshes) m.frustumCulled = false;
      this.parent.add(this.crowd.group);
    }
    return this.crowd;
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
    const s = this.spots[d]!;
    const p = this.crowdOf().acquire(COAT_COLORS[Math.floor(Math.random() * COAT_COLORS.length)]!, TRIM_COLORS[Math.floor(Math.random() * TRIM_COLORS.length)]!);
    if (!p) return;
    p.kid = Math.random() < KID_CHANCE;
    p.appear = 0;
    const w: Walker = { p, spot: d, px: [], pz: [], n: 0, i: 0, x: s.x, z: s.z, yaw: 0, speed: 0, timer: 0.3, visits: 2 + Math.floor(Math.random() * 3), home: false, fading: false, chatty: Math.random() < 0.5, act: null, plan: -1, mode: 'stroll' };
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
        w.speed = approach(w.speed, last ? Math.min(1.25, 0.5 + d * 3) : 1.25, 6 * dt);
        if (d < 0.08) w.i++;
        else {
          const k = Math.min(d, w.speed * dt) / d;
          w.x += dx * k;
          w.z += dz * k;
          w.yaw = dampAngle(w.yaw, Math.atan2(dx, dz), 10, dt);
        }
      } else {
        w.speed = approach(w.speed, 0, 10 * dt);
        if (w.act) this.doAct(w, dt);
        else {
          const s = this.spots[w.spot];
          if (s && !Number.isNaN(s.face)) w.yaw = dampAngle(w.yaw, s.face, 6, dt);
          this.think(w, dt, target);
        }
      }
    } else w.speed = approach(w.speed, 0, 10 * dt);
    p.x = w.x;
    p.z = w.z;
    p.yaw = w.yaw;
    p.walk = approach(p.walk, clamp(w.speed / 1.3, 0, 1), dt * 6);
    p.phase += dt * w.speed * 3.4;
    const atRing = w.i >= w.n && !this.spots[w.spot]?.door && !w.act;
    p.talk = approach(p.talk, atRing && w.chatty ? 0.6 : 0, dt * 2);
    p.wave = approach(p.wave, 0, dt * 2);
    const doing = w.act?.stage === 'do' && w.i >= w.n ? w.act.kind : null;
    w.mode = doing === 'sit' ? 'sit' : 'stroll';
    p.sit = approach(p.sit, doing === 'sit' ? 1 : 0, dt * 3);
    p.work = approach(p.work, doing === 'snowman' || doing === 'sweep' ? 1 : 0, dt * 3);
    p.cheer = approach(p.cheer, 0, dt * 1.6);
    p.lantern = approach(p.lantern, dark > NIGHT_LANTERN && w.chatty && !p.kid ? 1 : 0, dt * 3);
    p.appear = w.fading ? Math.max(0, p.appear - dt * 2.5) : Math.min(1, p.appear + dt * 2.5);
    if (w.fading && p.appear <= 0.001) {
      const s = this.spots[w.spot];
      if (s && !s.door) s.taken = false;
      if (w.act && w.act.idx >= 0) this.actTaken[w.act.idx] = false;
      if (w.plan >= 0) this.actTaken[w.plan] = false;
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
      let best = -1;
      let bd = Infinity;
      this.spots.forEach((s, i) => {
        const d = (s.x - w.x) ** 2 + (s.z - w.z) ** 2;
        if (s.door && d < bd) {
          bd = d;
          best = i;
        }
      });
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
        if (o === w || !o.p.kid || o.act || o.plan >= 0 || o.home || o.fading || o.i < o.n || this.spots[o.spot]?.door) continue;
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
