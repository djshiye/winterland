/**
 * 1.0 (review idea 7): festival day in the plaza. While the festival world event runs (core/WorldEvents.ts), warm paper
 * lantern garlands light up over the Market Town square (spokes from the fir's star to every lamp, a ring from lamp to
 * lamp) and zig-zag down the village street; they come on in a slow wave from the middle outward and go out the same
 * way when the festival ends (a soft dissolve, never a pop). If the square's bandstand is built, a little brass band (two
 * horns and a drummer, small townsfolk from the instanced crowd) walks in from the village corridor, plays on its deck
 * and walks back out afterwards. They join and leave out of sight when they can, and stop walking while the player is
 * in their way.
 *
 * Cheap: the garlands are one merged mesh per place (two draw calls while lit, none otherwise); the band is one small
 * instanced crowd (5 calls, + the horns 1) only while it is out. Nothing is saved; nothing here touches the economy.
 */
import * as THREE from 'three';
import { LAYOUT } from '../../config';
import type { GameContext } from '../../core/types';
import { Crowd, type CrowdPerson } from '../../npc/Crowd';
import { inView } from '../../npc/vehicleView';
import { Batch } from '../../render/batch';
import { markGlow, toon } from '../../render/materials';
import { amenityFrame } from '../../town/rules';
import { CLOTH } from '../../assets/characters';
import { ropePoint, type V3 } from './festive';
import { LAMP_TOP } from './lamps';
import { SQUARE_LAMPS } from './town';
import { FIR_STAR_Y } from './townProps';
import { villageLamps } from './village';

/** Paper lantern colours: honey, apricot, cream, a rosy red. */
const PAPER = [0xffcf6e, 0xffa95a, 0xfff0c2, 0xf0785a, 0xffd98a] as const;
/** Seconds for the garlands to light (the wave crosses the square) and to go out. */
const FADE_IN_S = 3.5;
const FADE_OUT_S = 5;

// ---------------------------------------------------------------------------------------------------------------------
// lantern garlands
// ---------------------------------------------------------------------------------------------------------------------

/** The garland material: the bulbs' unlit vertex colours, dissolving in from `centre` as `fade` goes 0 → 1. */
function garlandMaterial(cx: number, cz: number, range: number): { mat: THREE.MeshBasicMaterial; u: THREE.Vector4 } {
  // x: fade 0..1, y: brightness, z, w: unused
  const u = new THREE.Vector4(0, 1, 0, 0);
  const c = new THREE.Vector3(cx, cz, range);
  const mat = markGlow(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 0.5);
  mat.onBeforeCompile = (shader): void => {
    shader.uniforms.wlFest = { value: u };
    shader.uniforms.wlFestC = { value: c };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 wlFestC;\nvarying float vWlFest;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWlFest = length( ( modelMatrix * vec4( transformed, 1.0 ) ).xz - wlFestC.xy ) / wlFestC.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 wlFest;\nvarying float vWlFest;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  {
    // the wave: the middle lights first; a fine screen dither dissolves each lantern in (and out) instead of popping
    float k = clamp( ( wlFest.x * 1.4 - vWlFest * 1.0 ) / 0.4, 0.0, 1.0 );
    float h = fract( sin( dot( floor( gl_FragCoord.xy ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    if ( h >= k ) discard;
  }`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= wlFest.y;');
  };
  mat.customProgramCacheKey = (): string => 'wlFestival';
  return { mat, u };
}

interface Garlands {
  mesh: THREE.Mesh;
  u: THREE.Vector4;
  shown: () => boolean;
}

const top = (x: number, z: number, drop = 0): V3 => ({ x, y: LAMP_TOP.iron - 0.05 - drop, z });

let paperGeo: THREE.BufferGeometry | null = null;
let capGeo: THREE.BufferGeometry | null = null;
let cordGeo: THREE.BufferGeometry | null = null;
const q0: V3 = { x: 0, y: 0, z: 0 };
const q1: V3 = { x: 0, y: 0, z: 0 };

/**
 * A festival garland: a cord from a to b with a round paper lantern hanging every ~0.8 m (bigger than the era
 * garlands of env/festive.ts, so they read as the festival's own), each with a dark cap and a little tassel.
 */
function festivalGarland(b: Batch, a: V3, c: V3, sag: number, seed: number, clear?: { x: number; z: number; r: number }): void {
  paperGeo ??= new THREE.SphereGeometry(0.15, 10, 7).scale(1, 1.2, 1);
  capGeo ??= new THREE.CylinderGeometry(0.07, 0.08, 0.05, 7);
  cordGeo ??= new THREE.BoxGeometry(1, 0.025, 0.025);
  const len = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
  const steps = Math.max(3, Math.round(len / 0.4));
  for (let i = 0; i < steps; i++) {
    ropePoint(a, c, sag, i / steps, q0);
    ropePoint(a, c, sag, (i + 1) / steps, q1);
    const dx = q1.x - q0.x;
    const dy = q1.y - q0.y;
    const dz = q1.z - q0.z;
    const horiz = Math.hypot(dx, dz);
    b.add(cordGeo, 0x3a2c24, (q0.x + q1.x) / 2, (q0.y + q1.y) / 2, (q0.z + q1.z) / 2, { rz: Math.atan2(dy, horiz), ry: Math.atan2(-dz, dx), sx: Math.hypot(horiz, dy) + 0.02 });
    if (i % 2 === 0 || i === steps - 1) continue;
    const y = q1.y - 0.24;
    // no lantern hanging where, from the iso camera (+X / +Z, 48° down), it would hide the band on the bandstand's deck:
    // follow the line of sight from the lantern back down to the band's height (~1 m) and keep it off the stage
    if (clear) {
      const back = Math.max(0, y - 1) / Math.tan((48 * Math.PI) / 180) / Math.SQRT2;
      if (Math.hypot(q1.x - back - clear.x, q1.z - back - clear.z) < clear.r) continue;
    }
    b.add(cordGeo, 0x3a2c24, q1.x, q1.y - 0.04, q1.z, { rz: Math.PI / 2, sx: 0.08 });
    b.add(paperGeo, PAPER[(i * 3 + seed) % PAPER.length]!, q1.x, y, q1.z);
    b.add(capGeo, 0x4a3426, q1.x, y + 0.19, q1.z);
    b.add(capGeo, 0x4a3426, q1.x, y - 0.19, q1.z, { sx: 0.7, sz: 0.7 });
    b.add(cordGeo, 0xc23a2e, q1.x, y - 0.28, q1.z, { rz: Math.PI / 2, sx: 0.12, sy: 1.6, sz: 1.6 });
  }
}

/** Market Town square: spokes from the fir's star to every square lamp, and a ring of garlands from lamp to lamp. */
function squareGarlands(): Batch {
  const b = new Batch();
  const tree = LAYOUT.town.tree;
  const star: V3 = { x: tree.x, y: FIR_STAR_Y - 0.75, z: tree.z };
  const a = LAYOUT.town.amenities.bandstand;
  const stage = { x: a.x, z: a.z, r: 1.5 };
  SQUARE_LAMPS.forEach((l, i) => festivalGarland(b, star, top(l.x, l.z, 0.15), 0.5, i * 3, stage));
  const [m1, m2, n1, n2, s1, s2, e1] = SQUARE_LAMPS as readonly [(typeof SQUARE_LAMPS)[number], ...(typeof SQUARE_LAMPS)[number][]];
  const ring = [m1, n1!, n2!, e1!, s2!, s1!, m2!];
  for (let i = 0; i + 1 < ring.length; i++) festivalGarland(b, top(ring[i]!.x, ring[i]!.z, 0.45), top(ring[i + 1]!.x, ring[i + 1]!.z, 0.45), 0.6, i * 5 + 1, stage);
  return b;
}

/** Village street: garlands zig-zag across between the two lamp rows. */
function streetGarlands(): Batch {
  const b = new Batch();
  const spots = villageLamps();
  const cx = (LAYOUT.village.street.minX + LAYOUT.village.street.maxX) / 2;
  const west = spots.filter((s) => s.x < cx).sort((p, q) => p.z - q.z);
  const east = spots.filter((s) => s.x > cx).sort((p, q) => p.z - q.z);
  for (let i = 0; i < west.length; i++) {
    const w = west[i]!;
    const e = east[i];
    const e2 = east[i + 1];
    if (e) festivalGarland(b, top(w.x, w.z, 0.3), top(e.x, e.z, 0.3), 0.45, i * 2);
    if (e2) festivalGarland(b, top(w.x, w.z, 0.3), top(e2.x, e2.z, 0.3), 0.55, i * 2 + 1);
  }
  return b;
}

function garlands(group: THREE.Group, b: Batch, cx: number, cz: number, range: number, shown: () => boolean): Garlands {
  const { mat, u } = garlandMaterial(cx, cz, range);
  const mesh = b.mesh({ cast: false, receive: false, material: mat });
  mesh.visible = false;
  group.add(mesh);
  return { mesh, u, shown };
}

// ---------------------------------------------------------------------------------------------------------------------
// the band
// ---------------------------------------------------------------------------------------------------------------------

/** Band members' size (a touch smaller than a kid: the stage is small and low-roofed). */
const BAND_SCALE = 0.66;
const DECK_Y = 0.3;
const WALK_SPEED = 1.25;
/** Stop walking while the player is this close (m): the band yields. */
const YIELD_R = 1.3;

interface Member {
  p: CrowdPerson;
  horn: boolean;
  /** Waypoints in to the stage spot (world); walked backwards on the way out. */
  path: { x: number; z: number; y: number }[];
  /** Index of the waypoint being walked to (in: up the list, out: down it). */
  i: number;
  stage: 'in' | 'play' | 'out' | 'gone';
  /** The yaw it plays facing. */
  playYaw: number;
}

/**
 * Local (bandstand frame, +Z = front) spots on the deck. The conical roof hides the middle of the deck from the iso
 * camera, so the band plays along the rim on the camera's side (local -X / +Z, the world's +X / +Z): two horns by the
 * front steps and a drummer beside the drum kit, all turned out toward the square.
 */
const SPOTS = [
  { lx: -0.2, lz: 0.63, horn: true, faceX: -0.17, faceZ: 0.98 },
  { lx: -0.55, lz: 0.37, horn: true, faceX: -0.74, faceZ: 0.67 },
  { lx: -0.63, lz: -0.09, horn: false, faceX: -0.97, faceZ: 0.26 },
] as const;
const COATS = [CLOTH.brick, CLOTH.teal, CLOTH.mustard] as const;
const TRIMS = [CLOTH.mustard, CLOTH.cream, CLOTH.brick] as const;

/** A little brass horn (bell forward, local +Z), in one instanced mesh for both players. */
function hornGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8).rotateX(Math.PI / 2), 0xffffff, 0, 0, 0.02);
  b.add(new THREE.ConeGeometry(0.075, 0.13, 10, 1, true).rotateX(-Math.PI / 2), 0xffffff, 0, 0, 0.17);
  b.add(new THREE.TorusGeometry(0.06, 0.016, 5, 10), 0xffffff, 0, -0.06, -0.02, { ry: Math.PI / 2 });
  return b.geometry();
}

class Band {
  private crowd: Crowd | null = null;
  private horns: THREE.InstancedMesh | null = null;
  private readonly members: Member[] = [];
  private beat = 0;
  private readonly tmp = new THREE.Object3D();

  constructor(
    private readonly ctx: GameContext,
    private readonly group: THREE.Group,
  ) {}

  private built(): boolean {
    const s = this.ctx.state;
    return !!s.town?.revealed && (s.town.amenities?.bandstand?.tier ?? -1) >= 0;
  }

  get out(): boolean {
    return this.members.length > 0;
  }

  update(dt: number, festival: boolean): void {
    if (festival && !this.out && this.built()) this.start();
    if (!this.crowd) return;
    if (!festival) {
      for (const m of this.members) {
        // turn round where they are: an 'in' walker heads back to the waypoint it last passed
        if (m.stage === 'in') m.i = Math.max(0, m.i - 1);
        if (m.stage === 'in' || m.stage === 'play') m.stage = 'out';
      }
    }
    this.beat += dt;
    const pl = this.ctx.player?.object.position;
    for (const m of this.members) this.step(m, dt, pl);
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i]!;
      if (m.stage !== 'gone') continue;
      this.crowd?.release(m.p);
      this.members.splice(i, 1);
    }
    this.placeHorns();
    const dark = this.ctx.dayNight?.darkness ?? 0;
    this.crowd?.update(this.ctx.time?.elapsed ?? 0, dark, this.ctx.renderer?.quality === 'high');
  }

  private ensure(): Crowd {
    if (!this.crowd) {
      this.crowd = new Crowd(SPOTS.length);
      this.crowd.group.name = 'festival-band';
      this.group.add(this.crowd.group);
      this.horns = new THREE.InstancedMesh(hornGeometry(), toon(0xe0a83a, { emissive: 0x3a2200, emissiveIntensity: 0.4 }), 2);
      this.horns.name = 'festival-band-horns';
      this.horns.castShadow = false;
      this.horns.frustumCulled = false;
      this.group.add(this.horns);
    }
    return this.crowd;
  }

  /** The way in from the village corridor to each deck spot (world), starting at the first corridor point out of view. */
  private start(): void {
    const f = amenityFrame('bandstand');
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    const w = (lx: number, lz: number): { x: number; z: number } => ({ x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c });
    const walk = LAYOUT.town.walk[0]!;
    const cz = (walk.minZ + walk.maxZ) / 2;
    let sx = walk.minX + 0.6;
    for (let x = walk.maxX - 1; x >= walk.minX + 0.6; x -= 1) {
      if (!inView(this.ctx, x, cz, 1.2)) {
        sx = x;
        break;
      }
    }
    const crowd = this.ensure();
    const front = w(0, 1.75);
    const steps = w(0, 0.78);
    SPOTS.forEach((sp, k) => {
      const p = crowd.acquire(COATS[k]!, TRIMS[k]!);
      if (!p) return;
      const spot = w(sp.lx, sp.lz);
      // a single file: each a little further back along the way in
      const lag = k * 1.1;
      const path = [
        { x: sx - lag, z: cz + (k - 1) * 0.25, y: 0 },
        { x: walk.maxX - 0.6, z: cz + (k - 1) * 0.2, y: 0 },
        // across the square between the bandstand (z <= 24.9) and the fir (z >= 27.3), then round to its steps
        { x: 21.0, z: 26.25 + (k - 1) * 0.2, y: 0 },
        { x: front.x + 0.5, z: 25.6, y: 0 },
        { x: front.x, z: front.z, y: 0 },
        { x: steps.x, z: steps.z, y: DECK_Y },
        { x: spot.x, z: spot.z, y: DECK_Y },
      ];
      const fx = sp.faceX * c + sp.faceZ * s;
      const fz = -sp.faceX * s + sp.faceZ * c;
      p.x = path[0]!.x;
      p.z = path[0]!.z;
      p.y = 0;
      p.scale = BAND_SCALE;
      p.kid = false;
      p.hatH = sp.horn ? 1.15 : 1;
      p.seed = k * 1.7;
      // walked in from out of sight: no grow-in; at the corridor's far end only if all of it was in view
      p.appear = inView(this.ctx, p.x, p.z, 1.2) ? 0 : 1;
      this.members.push({ p, horn: sp.horn, path, i: 1, stage: 'in', playYaw: Math.atan2(fx, fz) });
    });
  }

  private step(m: Member, dt: number, pl: THREE.Vector3 | undefined): void {
    const p = m.p;
    p.appear = Math.min(1, p.appear + dt * 1.5);
    if (m.stage === 'play') {
      // play: horns up and a nod on the beat, the drummer's sticks going
      const yawK = 1 - Math.exp(-dt * 6);
      p.yaw += angleDelta(p.yaw, m.playYaw) * yawK;
      p.walk = Math.max(0, p.walk - dt * 4);
      p.carry = m.horn ? Math.min(1, p.carry + dt * 3) : 0;
      p.work = m.horn ? 0 : Math.min(1, p.work + dt * 3);
      p.talk = m.horn ? 0.8 : 0.4;
      p.y = DECK_Y + (m.horn ? Math.abs(Math.sin(this.beat * 3.4 + p.seed)) * 0.025 : 0);
      return;
    }
    p.carry = Math.max(0, p.carry - dt * 3);
    p.work = Math.max(0, p.work - dt * 3);
    p.talk = 0;
    const out = m.stage === 'out';
    const target = m.path[m.i]!;
    // yield: wait while the player stands in the way (on the ground; nobody walks through the player)
    if (pl && Math.hypot(pl.x - p.x, pl.z - p.z) < YIELD_R) {
      p.walk = Math.max(0, p.walk - dt * 4);
      return;
    }
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    const v = WALK_SPEED * dt;
    if (d > 1e-4) {
      const k = Math.min(1, v / d);
      p.x += dx * k;
      p.z += dz * k;
      p.yaw += angleDelta(p.yaw, Math.atan2(dx, dz)) * (1 - Math.exp(-dt * 8));
    }
    // up / down the steps
    const prev = m.path[out ? Math.min(m.path.length - 1, m.i + 1) : Math.max(0, m.i - 1)]!;
    const seg = Math.hypot(target.x - prev.x, target.z - prev.z);
    p.y = seg > 1e-4 ? prev.y + (target.y - prev.y) * (1 - Math.min(1, d / seg)) : target.y;
    p.walk = Math.min(1, p.walk + dt * 4);
    p.phase += dt * 9;
    if (d > v) return;
    if (!out) {
      if (m.i < m.path.length - 1) m.i++;
      else m.stage = 'play';
      return;
    }
    if (m.i > 0) {
      m.i--;
      return;
    }
    // at the corridor end: leave once out of sight (or fade at its far end)
    if (!inView(this.ctx, p.x, p.z, 1.2)) m.stage = 'gone';
    else {
      p.appear = Math.max(0, p.appear - dt * 3);
      if (p.appear <= 0.01) m.stage = 'gone';
    }
  }

  private placeHorns(): void {
    const h = this.horns;
    if (!h) return;
    let n = 0;
    for (const m of this.members) {
      if (!m.horn) continue;
      const p = m.p;
      const k = p.carry * p.appear;
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      const s = BAND_SCALE;
      const bob = Math.sin(this.beat * 3.4 + p.seed) * 0.06;
      this.tmp.position.set(p.x + fx * 0.25 * s, p.y + 0.62 * s, p.z + fz * 0.25 * s);
      this.tmp.rotation.set(-0.35 + bob, p.yaw, 0, 'YXZ');
      this.tmp.scale.setScalar(Math.max(0.001, k) * 1.35);
      this.tmp.updateMatrix();
      h.setMatrixAt(n++, this.tmp.matrix);
    }
    h.count = n;
    h.visible = n > 0;
    h.instanceMatrix.needsUpdate = true;
  }
}

const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ---------------------------------------------------------------------------------------------------------------------
// the part
// ---------------------------------------------------------------------------------------------------------------------

export class Festival {
  readonly group = new THREE.Group();
  private readonly sets: Garlands[];
  private readonly band: Band;
  /** 0 … 1 how lit the garlands are. */
  private lit = 0;

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'festival';
    const T = LAYOUT.town;
    const V = LAYOUT.village.street;
    this.sets = [
      garlands(this.group, squareGarlands(), T.tree.x, T.tree.z, 11, () => !!ctx.state.town?.revealed),
      garlands(this.group, streetGarlands(), (V.minX + V.maxX) / 2, (V.minZ + V.maxZ) / 2, 10, () => !!ctx.state.village?.revealed),
    ];
    this.band = new Band(ctx, this.group);
  }

  /** True while the lanterns show at all (tests, the soak). */
  get showing(): boolean {
    return this.lit > 0;
  }

  update(dt: number): void {
    const on = this.ctx.worldEvents?.active === 'festival';
    this.lit = on ? Math.min(1, this.lit + dt / FADE_IN_S) : Math.max(0, this.lit - dt / FADE_OUT_S);
    const d = this.ctx.dayNight?.darkness ?? 0;
    for (const s of this.sets) {
      const show = this.lit > 0 && s.shown();
      s.mesh.visible = show;
      if (!show) continue;
      s.u.x = this.lit;
      // unlit paper by day, a warm glow after dusk (like the bulbs, env/glow.ts)
      s.u.y = 0.88 + 0.22 * d;
    }
    this.band.update(dt, on);
  }
}
