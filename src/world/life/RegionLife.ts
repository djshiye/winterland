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
import { greenWalk, plotPlaces, type PlotPlaces, type XZ } from '../../eras/layout';
import { regionAt } from '../../eras/playerUpgrades';
import { COAT_COLORS, Crowd, TRIM_COLORS, type CrowdPerson } from '../../npc/Crowd';

/** People out at once on one green (a full crew), fewer at night. */
const MAX_OUT = 8;
/** Keep this far (m) from the green's centrepiece. */
const CLEAR = 1.7;
const NIGHT_LANTERN = 0.45;

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
    if (this.crowd) this.crowd.update(this.ctx.time.elapsed, dark, this.ctx.renderer?.quality === 'high');
  }

  /** Everyone goes at once (the player left the region). */
  clear(): void {
    for (const w of this.walkers) this.crowd?.release(w.p);
    this.walkers.length = 0;
    for (const s of this.spots) s.taken = false;
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
    p.kid = Math.random() < 0.2;
    p.appear = 0;
    const w: Walker = { p, spot: d, px: [], pz: [], n: 0, i: 0, x: s.x, z: s.z, yaw: 0, speed: 0, timer: 0.3, visits: 2 + Math.floor(Math.random() * 3), home: false, fading: false, chatty: Math.random() < 0.5 };
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
        const s = this.spots[w.spot];
        if (s && !Number.isNaN(s.face)) w.yaw = dampAngle(w.yaw, s.face, 6, dt);
        this.think(w, dt, target);
      }
    } else w.speed = approach(w.speed, 0, 10 * dt);
    p.x = w.x;
    p.z = w.z;
    p.yaw = w.yaw;
    p.walk = approach(p.walk, clamp(w.speed / 1.3, 0, 1), dt * 6);
    p.phase += dt * w.speed * 3.4;
    const atRing = w.i >= w.n && !this.spots[w.spot]?.door;
    p.talk = approach(p.talk, atRing && w.chatty ? 0.6 : 0, dt * 2);
    p.wave = approach(p.wave, 0, dt * 2);
    p.lantern = approach(p.lantern, dark > NIGHT_LANTERN && w.chatty && !p.kid ? 1 : 0, dt * 3);
    p.appear = w.fading ? Math.max(0, p.appear - dt * 2.5) : Math.min(1, p.appear + dt * 2.5);
    if (w.fading && p.appear <= 0.001) {
      const s = this.spots[w.spot];
      if (s && !s.door) s.taken = false;
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
    const next = this.freeSpot(false, w.spot);
    if (next < 0) {
      w.timer = 1.5;
      return;
    }
    this.walkTo(w, next);
    w.timer = 5 + Math.random() * 9; // dwell at the next spot
  }
}
