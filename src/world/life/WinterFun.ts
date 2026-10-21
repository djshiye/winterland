/**
 * 0.9.12 (Dino: "skating ponds and sledding hills"): winter fun on the open snow by the village, seen from R1 and
 * Lantern Lane once the new land shows.
 *
 * - SKATERS glide round the frozen pond the river ends in (eras/data.ts RIVER_POND): loops of different sizes, both
 *   ways round, a pair skating hand in hand.
 * - SLEDDERS: kids drag their sleds up a snowy hill between the customers' footpath and the tricycle road, sit, whizz
 *   down the packed track and run out on the flat, then trudge back up. A grown-up watches from a bench at the bottom.
 *
 * Nobody here can be reached on foot (the hill and the pond are scenery outside every walk area), so they need no
 * colliders and no routes. Cheap: the hill, its track, a bench and two lamps are one static mesh (+ one bulb mesh);
 * the people are one small instanced crowd (npc/Crowd.ts) and the sleds one instanced mesh, both only while the player
 * is near. Fewer people at night, nobody in a snowstorm. Nothing is saved.
 */
import * as THREE from 'three';
import { PALETTE } from '../../config';
import { approach, clamp, dampAngle } from '../../core/math';
import type { GameContext } from '../../core/types';
import { RIVER_POND } from '../../eras/data';
import { COAT_COLORS, Crowd, TRIM_COLORS, type CrowdPerson } from '../../npc/Crowd';
import { Batch, vcMat } from '../../render/batch';
import { geo } from '../../render/materials';
import { bulbMaterial } from '../env/glow';

/** The sledding hill: an ellipsoid mound (centre, half sizes along X / Z, height), metres. */
export const SLED_HILL = { x: 4.6, z: 49.6, rx: 3.4, rz: 5.8, h: 2.7 } as const;
/** The packed track down the hill's +Z face (x), where a ride ends on the flat (z), and the way back up (x). */
export const TRACK_X = SLED_HILL.x - 0.7;
export const RUN_END_Z = SLED_HILL.z + SLED_HILL.rz + 3.8;
const CLIMB_X = SLED_HILL.x + 1.8;
/** The pond's ice ellipse. */
const POND = {
  x: (RIVER_POND.minX + RIVER_POND.maxX) / 2,
  z: (RIVER_POND.minZ + RIVER_POND.maxZ) / 2,
  rx: (RIVER_POND.maxX - RIVER_POND.minX) / 2,
  rz: (RIVER_POND.maxZ - RIVER_POND.minZ) / 2,
};
/** Where the bench stands (the watching grown-up sits facing the track) and the two lamps. */
const BENCH = { x: SLED_HILL.x + 3.9, z: RUN_END_Z - 1.2 };
const LAMPS: readonly { x: number; z: number }[] = [
  { x: SLED_HILL.x + 3.9, z: RUN_END_Z + 0.4 },
  { x: POND.x + POND.rx * 0.55, z: POND.z + POND.rz + 1.1 },
];
/** Within this of the middle of it all the people come out (metres). */
const NEAR = 55;
const NEAR_AT = { x: (POND.x + SLED_HILL.x) / 2, z: 50 };
const SKATERS = 6;
const SLEDDERS = 4;

/** Height of the hill's snow at (x, z) (0 off it). Pure. */
export function hillY(x: number, z: number): number {
  const u = (x - SLED_HILL.x) / SLED_HILL.rx;
  const v = (z - SLED_HILL.z) / SLED_HILL.rz;
  const q = 1 - u * u - v * v;
  return q > 0 ? SLED_HILL.h * Math.sqrt(q) : 0;
}

/** Ground (or hill) slope along +Z at (x, z): rise per metre. */
function slopeZ(x: number, z: number): number {
  return (hillY(x, z + 0.05) - hillY(x, z - 0.05)) / 0.1;
}

interface Skater {
  p: CrowdPerson;
  /** Fraction of the pond's half sizes it loops at, its angle round the loop, which way (±1) and speed (m/s). */
  k: number;
  a: number;
  dir: number;
  speed: number;
  /** 0.9.13 (review E11): the partner it skates hand in hand with; it takes that skater's angle so they never drift apart. */
  mate?: Skater;
}

type SledStage = 'climb' | 'ready' | 'ride' | 'rest';

interface Sledder {
  p: CrowdPerson;
  stage: SledStage;
  t: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** Next waypoint while climbing. */
  leg: number;
}

const CLIMB: readonly { x: number; z: number }[] = [
  { x: CLIMB_X, z: RUN_END_Z - 0.6 },
  { x: CLIMB_X, z: SLED_HILL.z + 1.2 },
  { x: TRACK_X, z: SLED_HILL.z - 0.2 },
];

function buildStatics(): { solid: THREE.Mesh; bulbs: THREE.Mesh } {
  const b = new Batch();
  const bulbs = new Batch();
  const H = SLED_HILL;
  // the hill: a snow dome, a slightly bluer packed track and run-out, footprints of trodden snow up its side
  b.add(geo.sphere(1, 28, 14), PALETTE.snow, H.x, 0, H.z, { sx: H.rx, sy: H.h, sz: H.rz });
  b.add(geo.sphere(1, 28, 14), 0xf6f9fd, H.x - 0.25, 0, H.z - 0.6, { sx: H.rx * 0.82, sy: H.h * 1.02, sz: H.rz * 0.8 });
  b.add(ribbon(TRACK_X, H.z - 0.3, RUN_END_Z, 0.95), 0xd9e6f2, 0, 0, 0);
  b.add(ribbon(CLIMB_X, H.z + 1.0, RUN_END_Z - 0.3, 0.6), 0xe6eef6, 0, 0, 0);
  // a start post with a little red flag at the top, a couple of small firs behind the crest
  const topY = hillY(TRACK_X + 0.75, H.z - 0.5);
  b.add(geo.cylinder(0.04, 0.05, 1.2, 6), 0x6e4a32, TRACK_X + 0.75, topY + 0.55, H.z - 0.5);
  b.add(geo.box(0.04, 0.22, 0.36), 0xd9453a, TRACK_X + 0.75, topY + 1.02, H.z - 0.32);
  for (const [dx, dz, k] of [[-1.6, -4.6, 0.9], [1.4, -5.2, 0.75]] as const) {
    const y = hillY(H.x + dx, H.z + dz);
    b.add(geo.cone(0.6 * k, 1.3 * k, 8), 0x2f6b4f, H.x + dx, y + 0.95 * k, H.z + dz);
    b.add(geo.cone(0.45 * k, 0.9 * k, 8), 0x3a7d5c, H.x + dx, y + 1.55 * k, H.z + dz);
    b.add(geo.cone(0.28 * k, 0.35 * k, 8), PALETTE.snow, H.x + dx, y + 1.95 * k, H.z + dz);
    b.add(geo.cylinder(0.08 * k, 0.1 * k, 0.5 * k, 6), 0x6e4a32, H.x + dx, y + 0.25 * k, H.z + dz);
  }
  // a little snow bank where the run-out ends
  b.add(geo.sphere(1, 16, 8), 0xf2f6fb, TRACK_X, 0, RUN_END_Z + 0.5, { sx: 1.2, sy: 0.35, sz: 0.45 });
  // the bench at the bottom (seat toward -X, the track)
  b.add(geo.boxBase(0.45, 0.08, 1.5), 0x8a5a3a, BENCH.x, 0.42, BENCH.z);
  b.add(geo.boxBase(0.08, 0.42, 1.5), 0x7a4e32, BENCH.x + 0.22, 0.5, BENCH.z);
  for (const dz of [-0.6, 0.6]) b.add(geo.boxBase(0.4, 0.42, 0.08), 0x5e3d28, BENCH.x, 0, BENCH.z + dz);
  b.add(geo.box(0.47, 0.05, 1.52), PALETTE.snow, BENCH.x + 0.1, 0.95, BENCH.z);
  // two lamp posts with warm lanterns
  for (const l of LAMPS) {
    b.add(geo.cylinder(0.06, 0.09, 2.6, 8), 0x3a3a40, l.x, 1.3, l.z);
    b.add(geo.box(0.32, 0.06, 0.32), 0x3a3a40, l.x, 2.62, l.z);
    bulbs.add(geo.sphere(0.16, 10, 8), 0xffd27a, l.x, 2.45, l.z);
  }
  const solid = b.mesh({ cast: true, receive: true });
  solid.name = 'winter-fun';
  const lit = bulbs.mesh({ cast: false, receive: false, material: bulbMaterial() });
  lit.name = 'winter-fun-lamps';
  return { solid, bulbs: lit };
}

/** A flat strip `w` wide along Z (z0 … z1) at x, laid on the hill's surface (a hair above it). */
function ribbon(x: number, z0: number, z1: number, w: number): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((z1 - z0) / 0.25));
  const g = new THREE.PlaneGeometry(w, z1 - z0, 2, n).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + x;
    const vz = pos.getZ(i) + (z0 + z1) / 2;
    pos.setXYZ(i, vx, hillY(vx, vz) + 0.025, vz);
  }
  g.computeVertexNormals();
  return g;
}

function sledGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.box(0.5, 0.05, 0.9), 0xc8452f, 0, 0.13, 0);
  for (const x of [-0.2, 0.2]) {
    b.add(geo.box(0.04, 0.04, 0.95), 0x5a4030, x, 0.03, 0);
    b.add(geo.box(0.04, 0.12, 0.04), 0x5a4030, x, 0.08, -0.3);
    b.add(geo.box(0.04, 0.12, 0.04), 0x5a4030, x, 0.08, 0.3);
    b.add(geo.cylinder(0.025, 0.025, 0.16, 5), 0x5a4030, x, 0.1, 0.46, { rx: 0.9 });
  }
  return b.geometry();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export class WinterFun {
  readonly group = new THREE.Group();
  private crowd: Crowd | null = null;
  private sleds: THREE.InstancedMesh | null = null;
  private readonly skaters: Skater[] = [];
  private readonly sledders: Sledder[] = [];
  private watcher: CrowdPerson | null = null;
  private active = false;

  constructor(
    private readonly ctx: GameContext,
    parent: THREE.Object3D,
  ) {
    this.group.name = 'winter-fun';
    const { solid, bulbs } = buildStatics();
    this.group.add(solid, bulbs);
    parent.add(this.group);
  }

  /** Ground (hill, track, bench) old scatter must clear once the new land shows. */
  static readonly FOOTPRINT = { minX: SLED_HILL.x - SLED_HILL.rx - 0.6, maxX: BENCH.x + 0.8, minZ: SLED_HILL.z - SLED_HILL.rz - 0.6, maxZ: RUN_END_Z + 1.2 };

  /** How many people are out (tests, the soak). */
  get count(): number {
    return this.skaters.length + this.sledders.length + (this.watcher ? 1 : 0);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const pl = this.ctx.player?.position;
    const shown = this.group.parent?.visible ?? false;
    const near = shown && !!pl && Math.hypot(pl.x - NEAR_AT.x, pl.z - NEAR_AT.z) < NEAR;
    if (!near) {
      if (this.active) this.clear();
      return;
    }
    this.active = true;
    const dark = this.ctx.dayNight.darkness;
    const storm = this.ctx.worldEvents.active === 'snowstorm';
    const night = dark > 0.5;
    this.fill(storm ? 0 : night ? 3 : SKATERS, storm ? 0 : night ? 2 : SLEDDERS, !storm && !night);
    for (const s of this.skaters) this.skate(s, dt);
    for (const s of this.sledders) this.sled(s, dt);
    if (this.watcher) {
      const w = this.watcher;
      w.appear = approach(w.appear, 1, dt * 3);
      w.sit = 1;
      w.walk = 0;
      // cheers the kids on now and then
      w.wave = Math.max(0, w.wave - dt * 0.8);
      if (Math.random() < dt * 0.08) w.wave = 1;
    }
    this.drawSleds();
    this.crowd?.update(this.ctx.time.elapsed, dark, this.ctx.renderer?.quality === 'high');
  }

  private crowdOf(): Crowd {
    if (!this.crowd) {
      this.crowd = new Crowd(SKATERS + SLEDDERS + 2);
      this.crowd.group.name = 'winter-fun-people';
      this.crowd.prints = false;
      for (const m of this.crowd.meshes) m.frustumCulled = false;
      this.group.add(this.crowd.group);
      this.sleds = new THREE.InstancedMesh(sledGeometry(), vcMat(), SLEDDERS);
      this.sleds.name = 'sleds';
      this.sleds.count = 0;
      this.sleds.castShadow = true;
      this.sleds.frustumCulled = false;
      this.sleds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.sleds);
    }
    return this.crowd;
  }

  private person(kid: boolean): CrowdPerson | null {
    const p = this.crowdOf().acquire(COAT_COLORS[Math.floor(Math.random() * COAT_COLORS.length)]!, TRIM_COLORS[Math.floor(Math.random() * TRIM_COLORS.length)]!);
    if (!p) return null;
    p.kid = kid;
    p.appear = 0;
    return p;
  }

  /** Bring the counts to their targets (newcomers fade in where they are; extras fade out between rides / loops). */
  private fill(skaters: number, sledders: number, watcher: boolean): void {
    while (this.skaters.length < skaters) {
      const p = this.person(Math.random() < 0.3);
      if (!p) break;
      const pair = this.skaters.length === 1; // the second one skates beside the first, hand in hand
      const lead = this.skaters[0];
      const k = pair && lead ? lead.k + 0.09 : 0.35 + Math.random() * 0.42;
      const s: Skater = { p, k, a: pair && lead ? lead.a : Math.random() * Math.PI * 2, dir: pair && lead ? lead.dir : Math.random() < 0.6 ? 1 : -1, speed: pair && lead ? lead.speed : 1.4 + Math.random() * 1.1, mate: pair ? lead : undefined };
      this.skaters.push(s);
    }
    while (this.skaters.length > skaters) this.crowd?.release(this.skaters.pop()!.p);
    while (this.sledders.length < sledders) {
      const p = this.person(true);
      if (!p) break;
      const first = CLIMB[0]!;
      this.sledders.push({ p, stage: 'climb', t: this.sledders.length * 2.5, x: first.x + (Math.random() - 0.5) * 0.4, z: first.z, yaw: Math.PI, speed: 0, leg: 1 });
    }
    while (this.sledders.length > sledders) this.crowd?.release(this.sledders.pop()!.p);
    if (watcher && !this.watcher) {
      const p = this.person(false);
      if (p) {
        p.x = BENCH.x - 0.05;
        p.z = BENCH.z;
        p.yaw = -Math.PI / 2;
        this.watcher = p;
      }
    } else if (!watcher && this.watcher) {
      this.crowd?.release(this.watcher);
      this.watcher = null;
    }
  }

  private skate(s: Skater, dt: number): void {
    const rx = POND.rx * s.k;
    const rz = POND.rz * s.k;
    // constant speed round the ellipse: angle step = distance / local radius
    const r = Math.hypot(rx * Math.sin(s.a), rz * Math.cos(s.a));
    // the second of a hand-in-hand pair keeps the partner's angle (the leader moves first: it is earlier in the list)
    if (s.mate) s.a = s.mate.a;
    else s.a += (s.dir * s.speed * dt) / Math.max(0.5, r);
    const p = s.p;
    p.x = POND.x + Math.cos(s.a) * rx;
    p.z = POND.z + Math.sin(s.a) * rz;
    p.y = 0.03;
    const tx = -Math.sin(s.a) * rx * s.dir;
    const tz = Math.cos(s.a) * rz * s.dir;
    p.yaw = dampAngle(p.yaw, Math.atan2(tx, tz), 10, dt);
    p.appear = approach(p.appear, 1, dt * 2.5);
    // long gliding strides, not a walk
    p.walk = 0.45;
    p.phase += dt * 2.2;
    p.talk = this.skaters.indexOf(s) < 2 ? 0.6 : 0;
  }

  private sled(s: Sledder, dt: number): void {
    const p = s.p;
    p.appear = approach(p.appear, 1, dt * 2.5);
    s.t -= dt;
    switch (s.stage) {
      case 'climb': {
        if (s.t > 0) break; // waiting their turn at the bottom
        const g = CLIMB[s.leg]!;
        const dx = g.x - s.x;
        const dz = g.z - s.z;
        const d = Math.hypot(dx, dz);
        s.speed = approach(s.speed, 0.85, dt * 4);
        const step = s.speed * dt;
        if (d <= step) {
          s.x = g.x;
          s.z = g.z;
          if (++s.leg >= CLIMB.length) {
            s.stage = 'ready';
            s.t = 0.9 + Math.random() * 1.2;
            s.speed = 0;
          }
        } else {
          s.x += (dx / d) * step;
          s.z += (dz / d) * step;
          s.yaw = dampAngle(s.yaw, Math.atan2(dx, dz), 8, dt);
        }
        p.walk = approach(p.walk, clamp(s.speed / 1.1, 0, 1), dt * 6);
        p.phase += dt * s.speed * 3.4;
        p.sit = approach(p.sit, 0, dt * 5);
        break;
      }
      case 'ready':
        // sat on the sled at the top, facing down the track
        s.yaw = dampAngle(s.yaw, 0, 8, dt);
        p.walk = approach(p.walk, 0, dt * 6);
        p.sit = approach(p.sit, 1, dt * 5);
        if (s.t <= 0) {
          s.stage = 'ride';
          s.speed = 0.6;
        }
        break;
      case 'ride': {
        // gravity down the slope, a little friction; the flat run-out brakes it
        const slope = slopeZ(TRACK_X, s.z);
        // 0.9.13 (review B8): on the flat the kid digs in their heels, so the sled slows to a stop right at the run's end
        // (it hit an invisible wall there at up to 7.5 m/s)
        const brake = slope === 0 ? Math.max(0, (s.speed * s.speed) / (2 * Math.max(0.02, RUN_END_Z - 0.2 - s.z)) - 0.5) : 0;
        s.speed = clamp(s.speed + (-slope * 7.5 - 0.5 - s.speed * 0.08 - brake) * dt, slope === 0 ? 0 : 0.4, 7.5);
        s.z = Math.min(RUN_END_Z, s.z + s.speed * dt);
        s.x = approach(s.x, TRACK_X, dt);
        s.yaw = 0;
        p.sit = 1;
        p.cheer = Math.max(p.cheer, s.speed > 4 ? 0.6 : 0);
        if (s.speed <= 0.12 || s.z >= RUN_END_Z) {
          s.stage = 'rest';
          s.t = 1.2 + Math.random();
          s.speed = 0;
        }
        break;
      }
      case 'rest':
        p.sit = approach(p.sit, 0, dt * 4);
        p.cheer = approach(p.cheer, 0, dt * 2);
        if (s.t <= 0) {
          s.stage = 'climb';
          s.leg = 0;
          s.t = 0;
        }
        break;
    }
    p.x = s.x;
    p.z = s.z;
    // sat on the sled: the crowd lifts a sitter to bench height, the sled's seat is far lower
    p.y = hillY(s.x, s.z) - (s.stage === 'ride' || s.stage === 'ready' ? 0.2 * p.sit : 0);
    p.yaw = s.yaw;
  }

  /** One sled per sledder: under them on a ride, pulled behind them on the climb. */
  private drawSleds(): void {
    const m = this.sleds;
    if (!m) return;
    let n = 0;
    for (const s of this.sledders) {
      const riding = s.stage === 'ride' || s.stage === 'ready';
      const back = riding ? 0.05 : 0.85;
      const x = s.x - Math.sin(s.yaw) * back;
      const z = s.z - Math.cos(s.yaw) * back;
      const tilt = -Math.atan(slopeZ(x, z) * Math.cos(s.yaw) + 0);
      _e.set(tilt, s.yaw, 0, 'YXZ');
      m.setMatrixAt(n++, _m.compose(_p.set(x, hillY(x, z), z), _q.setFromEuler(_e), _s));
    }
    m.count = n;
    m.visible = n > 0;
    if (n) m.instanceMatrix.needsUpdate = true;
  }

  /** Everyone goes (the player walked away). */
  private clear(): void {
    this.active = false;
    for (const s of this.skaters) this.crowd?.release(s.p);
    for (const s of this.sledders) this.crowd?.release(s.p);
    if (this.watcher) this.crowd?.release(this.watcher);
    this.skaters.length = 0;
    this.sledders.length = 0;
    this.watcher = null;
    if (this.sleds) {
      this.sleds.count = 0;
      this.sleds.visible = false;
    }
    this.crowd?.update(this.ctx.time.elapsed, 0, false);
  }
}
