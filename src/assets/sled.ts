/**
 * [B5 — commerce] AssetFactory: the Timber Ridge dog sled (npc/SledQueue.ts), its husky team and the packed-snow trail.
 *
 * - SLED: wooden sled with curled runners, a red blanket on the deck and a musher in a yellow parka and a fur hat
 *   standing on the rear runners. Everything rigid is baked into ONE mesh (2 draw calls with the shadow pass). The
 *   furniture cargo is a Pile (item meshes), added by the queue under `body`.
 * - TEAM: four huskies in two pairs. All dog bodies are ONE InstancedMesh (4 instances), all legs ONE InstancedMesh
 *   (16 instances, rewritten every frame for the trot / bound), the gang lines ONE InstancedMesh (6 stretched boxes).
 *   Per-dog fur variety comes from instance colours. 3 meshes, 5 draw calls with shadows.
 * - TRACK: the path the convoy follows (sampled polyline). Every unit sits on the SAME path at a fixed distance
 *   behind the head, so the swept area is exactly the path swept by the sled's width: it is validated once
 *   (tests/sled.test.ts) against the cash-tube posts, the counter and the cash pile. The path runs in along the lane
 *   (arriving from +X), stops with the sled at stopX, then carries on west, loops through a U-turn on the open snow
 *   SOUTH of the lane (never toward the counter) and leaves along a second line toward exitX.
 * - TRAIL: both lines + the loop as one flat packed-snow mesh (1 draw call).
 *
 * Draw calls (shadow pass included): sled 2 + dog bodies 2 + legs 2 + gang lines 1 (no shadow) + trail 1 = 8,
 * plus the speech bubble sprite and the chairs on the sled (items that came off the counter anyway).
 *
 * Frame: the sled's local +Z is forward; origin = ground under the middle of the deck. Chairs face forward.
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../config';
import { Batch, vcMat } from '../render/batch';
import { geo } from '../render/materials';

// ---------------------------------------------------------------------------
// Layout numbers (validated by tests/sled.test.ts)
// ---------------------------------------------------------------------------

/**
 * Lane z the sled really drives on. config says 8.0, but the sled is 0.94 wide (runners +/-0.47) and the cash-tube
 * posts stand at z 8.8 (base box edge 8.63): at 8.0 that leaves 0.16 m. 7.9 gives 0.26 m to the posts and 0.23 m to
 * the counter body (z 6.6-7.2). Takes the smaller of the two so a later config change to 7.9 is harmless.
 */
export const SLED_LANE_Z = Math.min(LAYOUT.ridge.sledLane.z, 7.9);
/** Return line of the U-turn (south of the lane, away from the counter). */
export const SLED_RETURN_Z = SLED_LANE_Z + 2.4;
const LOOP_R = 1.2;
/** Half the sled's width (outer runner edge). */
export const SLED_HALF_WIDTH = 0.47;
/** Centre-to-centre distances from the sled to each pair of dogs (the second pair is the head). */
export const TEAM_OFFSETS = [2.6, 4.1] as const;
/** Lateral offset of the two dogs of a pair. */
const DOG_SIDE = 0.3;
/** Where the cargo pile sits on the sled (local), and its grid: 2 across x 3 along x 2 layers = 12 chairs. */
export const SLED_CARGO_BASE = new THREE.Vector3(0, 0.35, 0.15);
export const SLED_CARGO_CAPACITY = 12;
const DECK_Y = 0.35;
const TRAIL_Y = 0.022;

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

export interface SledTrack {
  /** Sample spacing in metres. */
  readonly ds: number;
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly length: number;
  /** Sled arc-length where it stands at the counter (the head is TEAM_OFFSETS[1] further along). */
  readonly sStop: number;
  /** Sled arc-length where the sled starts at spawn (off to the east). */
  readonly sStart: number;
  /** Sled arc-length where it has left the world (past exitX). */
  readonly sExit: number;
  /** Arc-length span of the U-turn arc. */
  readonly sLoopStart: number;
  readonly sLoopEnd: number;
  /** World position of arc-length `s` (clamped). */
  at(s: number, out: THREE.Vector3): THREE.Vector3;
  /** Heading (rotation.y for a +Z-forward model) at arc-length `s`. */
  yawAt(s: number): number;
}

export function createSledTrack(): SledTrack {
  const L = LAYOUT.ridge.sledLane;
  const z0 = SLED_LANE_Z;
  const z1 = SLED_RETURN_Z;
  const ds = 0.05;
  const xs: number[] = [];
  const zs: number[] = [];
  const push = (x: number, z: number): void => {
    xs.push(x);
    zs.push(z);
  };
  const xStart = L.spawnX + 6;
  // loop centre x: far enough west of the stopped head that the arc is clear of it
  const headStopX = L.stopX - TEAM_OFFSETS[1];
  const xc = headStopX - 3.4;
  const xEnd = L.exitX + 10;
  // 1. lane, heading west
  for (let x = xStart; x > xc; x -= ds) push(x, z0);
  const sLoopHead = xs.length * ds;
  // 2. half circle bulging west and south, centre (xc, z0 + r)
  const arcLen = Math.PI * LOOP_R;
  const n = Math.ceil(arcLen / ds);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI;
    push(xc - LOOP_R * Math.sin(a), z0 + LOOP_R - LOOP_R * Math.cos(a));
  }
  const sLoopHeadEnd = xs.length * ds;
  // 3. return line, heading east
  for (let x = xc; x < xEnd; x += ds) push(x, z1);

  const xa = Float32Array.from(xs);
  const za = Float32Array.from(zs);
  const count = xa.length;
  const length = (count - 1) * ds;
  const stopIndex = xa.findIndex((x) => x <= L.stopX);
  const exitIndex = xa.findIndex((x, i) => i > n && x >= L.exitX && Math.abs(za[i]! - z1) < 1e-3);
  const sStop = stopIndex * ds;
  const sStart = (xa.findIndex((x) => x <= L.spawnX) + 1) * ds;
  const sExit = (exitIndex > 0 ? exitIndex : count - 1) * ds;
  const track: SledTrack = {
    ds,
    xs: xa,
    zs: za,
    length,
    sStop,
    sStart,
    sExit,
    // the head enters the arc TEAM_OFFSETS[1] before the sled does
    sLoopStart: sLoopHead - TEAM_OFFSETS[1],
    sLoopEnd: sLoopHeadEnd,
    at(s, out) {
      const f = Math.min(Math.max(s / ds, 0), count - 1.001);
      const i = Math.floor(f);
      const t = f - i;
      return out.set(xa[i]! + (xa[i + 1]! - xa[i]!) * t, 0, za[i]! + (za[i + 1]! - za[i]!) * t);
    },
    yawAt(s) {
      const i = Math.min(Math.max(Math.round(s / ds), 3), count - 4);
      return Math.atan2(xa[i + 3]! - xa[i - 3]!, za[i + 3]! - za[i - 3]!);
    },
  };
  return track;
}

// ---------------------------------------------------------------------------
// Rail crossing (npc/SledQueue.ts <-> npc/TrainQueue.ts mutual exclusion)
// ---------------------------------------------------------------------------

/** Half the train's width (wheel outer edges), with the buffer/step overhang. */
export const TRAIN_HALF_WIDTH = 0.9;
/** Extra clearance around the train corridor and along the convoy (metres). */
const CROSSING_MARGIN = 0.3;
/** Convoy extent along its heading from the SLED origin: musher/back of the sled to the head dogs' nose. */
export const CONVOY_BACK = 1.15;
export const CONVOY_FRONT = TEAM_OFFSETS[1] + 0.7;

/** Sled arc-length interval during which some part of the convoy is inside the train corridor. */
export interface CrossingBand {
  /** The first dog's nose enters the corridor. */
  start: number;
  /** The musher has left the corridor. */
  end: number;
}

/**
 * Where the sled convoy overlaps the corridor of a train running along Z at `railX`. The track crosses it twice: on
 * the arrival lane (heading west) and on the return line (heading east). A leaving train sweeps BOTH rows, so the
 * sled and the train must never be inside their crossing at the same time.
 */
export function sledCrossingBands(track: SledTrack, railX: number): { arrive: CrossingBand; leave: CrossingBand } {
  const halfX = TRAIN_HALF_WIDTH + SLED_HALF_WIDTH + CROSSING_MARGIN;
  const bands: CrossingBand[] = [];
  let first = -1;
  let last = -1;
  const flush = (): void => {
    if (first >= 0) {
      bands.push({
        start: first * track.ds - CONVOY_FRONT - CROSSING_MARGIN,
        end: last * track.ds + CONVOY_BACK + CROSSING_MARGIN,
      });
    }
    first = -1;
    last = -1;
  };
  for (let i = 0; i < track.xs.length; i++) {
    if (Math.abs(track.xs[i]! - railX) <= halfX) {
      if (first < 0) first = i;
      last = i;
    } else if (first >= 0) flush();
  }
  flush();
  if (bands.length < 2) throw new Error('sled track must cross the rail corridor twice');
  return { arrive: bands[0]!, leave: bands[bands.length - 1]! };
}

// ---------------------------------------------------------------------------
// Trail
// ---------------------------------------------------------------------------

/** One flat mesh: a packed band along the track with two darker runner ruts. Receives light only. */
export function createSledTrail(track: SledTrack): THREE.Mesh {
  const b = new Batch();
  const band = 0xe3edf6;
  const rut = 0xc6d6e6;
  const unit = geo.box(1, 1, 1);
  const stepLen = 2.5;
  const segs = Math.floor(track.length / stepLen);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const lane = LAYOUT.ridge.sledLane;
  for (let i = 0; i < segs; i++) {
    const s0 = i * stepLen;
    track.at(s0, p0);
    track.at(s0 + stepLen, p1);
    // only the ridge side of the world: skip the stretch the sleds never use (east of the exit, west of the loop)
    if (p0.x > lane.exitX + 4 || p1.x > lane.exitX + 4) continue;
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) + 0.06; // overlap so curves leave no gaps
    const yaw = Math.atan2(dx, dz);
    const mx = (p0.x + p1.x) / 2;
    const mz = (p0.z + p1.z) / 2;
    b.add(unit, band, mx, TRAIL_Y, mz, { ry: yaw, sx: 1.15, sy: 0.012, sz: len });
    // ruts: offset along the right-hand normal of the heading
    const nx = Math.cos(yaw);
    const nz = -Math.sin(yaw);
    for (const side of [-1, 1]) {
      b.add(unit, rut, mx + nx * side * 0.34, TRAIL_Y + 0.006, mz + nz * side * 0.34, { ry: yaw, sx: 0.13, sy: 0.012, sz: len });
    }
  }
  const m = b.mesh({ cast: false, receive: true });
  m.name = 'sledTrail';
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------------------
// Sled + team
// ---------------------------------------------------------------------------

export interface SledModel {
  /** World-origin container for everything (add to the scene). */
  root: THREE.Group;
  /** Moved + yawed by the queue to the sled's pose. */
  sled: THREE.Group;
  /** Bounces / pitches / squashes inside `sled`; the baked sled mesh and the cargo pile hang here. */
  body: THREE.Group;
  /** Height of the speech bubble above the ground (sled local). */
  bubbleY: number;
  /** Local top of the stowed cargo (where the pay effect starts). */
  payLocal: THREE.Vector3;
  /**
   * Pose the team: `heads[k]` = world position + yaw of pair k (index into TEAM_OFFSETS), `gait` = trot phase (rad),
   * `amp` = leg swing 0..1, `hop` = extra bounce in metres (celebration), `lean` = body pitch in rad.
   */
  poseTeam(pairs: readonly PairPose[], gait: number, amp: number, hop: number, lean: number): void;
}

export interface PairPose {
  x: number;
  z: number;
  yaw: number;
}

function sledGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  const runner = PALETTE.barkDark;
  const wood = COLORS.PLANK_WOOD;
  const woodDark = PALETTE.fenceDark;
  const red = 0xd8352a;
  const cream = 0xfff1d6;
  const parka = COLORS.COURIER_YELLOW;
  const fur = 0x7b4f2c;
  const dark = PALETTE.rubber;

  // runners with a curled nose, steel shoes
  for (const sx of [-1, 1]) {
    const x = sx * 0.42;
    b.add(geo.box(0.09, 0.1, 2.0), runner, x, 0.1, -0.1);
    b.add(geo.box(0.09, 0.1, 0.5), runner, x, 0.2, 1.08, { rx: -0.6 });
    b.add(geo.box(0.05, 0.03, 2.05), COLORS.MACHINE_STEEL, x, 0.035, -0.08);
    for (const z of [-0.5, 0.2, 0.85]) b.add(geo.box(0.06, 0.2, 0.07), woodDark, x, 0.22, z);
  }
  // deck, side rails, curved front board
  b.add(geo.box(0.9, 0.06, 1.6), wood, 0, DECK_Y - 0.03, 0.15);
  for (const sx of [-1, 1]) b.add(geo.box(0.05, 0.12, 1.6), woodDark, sx * 0.45, DECK_Y + 0.06, 0.15);
  b.add(geo.box(0.95, 0.3, 0.06), woodDark, 0, 0.5, 0.98, { rx: -0.25 });
  b.add(geo.box(0.95, 0.06, 0.2), wood, 0, 0.66, 1.04, { rx: 0.5 });
  // red blanket on the deck (stripes + tucked sides)
  b.add(geo.box(0.8, 0.035, 1.5), red, 0, DECK_Y + 0.0175, 0.15);
  for (const z of [-0.5, -0.38, 0.8, 0.68]) b.add(geo.box(0.8, 0.04, 0.07), cream, 0, DECK_Y + 0.02, z);
  for (const sx of [-1, 1]) b.add(geo.box(0.035, 0.2, 1.5), red, sx * 0.4875, DECK_Y - 0.05, 0.15);
  // handlebar
  for (const sx of [-1, 1]) b.add(geo.box(0.05, 0.75, 0.05), woodDark, sx * 0.32, 0.62, -0.78, { rx: 0.18 });
  b.add(geo.box(0.74, 0.05, 0.05), woodDark, 0, 1.0, -0.84);
  // musher: boots, legs, parka, scarf, head, fur hat with ear flaps, arms to the bar
  const mz = -1.0;
  for (const sx of [-1, 1]) {
    b.add(geo.box(0.13, 0.12, 0.2), dark, sx * 0.1, 0.2, mz + 0.03);
    b.add(geo.box(0.12, 0.42, 0.12), 0x2f4c8a, sx * 0.1, 0.44, mz);
    b.add(geo.box(0.1, 0.1, 0.36), parka, sx * 0.24, 0.98, mz + 0.18, { rx: 0.1 });
  }
  b.add(geo.box(0.4, 0.5, 0.26), parka, 0, 0.9, mz);
  b.add(geo.box(0.42, 0.06, 0.28), fur, 0, 0.66, mz);
  b.add(geo.box(0.3, 0.08, 0.2), red, 0, 1.17, mz + 0.02);
  b.add(geo.sphere(0.15, 12, 9), COLORS.PLAYER_SKIN, 0, 1.33, mz + 0.01);
  b.add(geo.cylinder(0.19, 0.2, 0.17, 12), fur, 0, 1.46, mz);
  b.add(geo.sphere(0.2, 12, 8), fur, 0, 1.55, mz, { sy: 0.55 });
  for (const sx of [-1, 1]) b.add(geo.sphere(0.07, 8, 6), fur, sx * 0.19, 1.36, mz);
  return b.geometry();
}

function dogGeometry(opts?: { tail?: boolean; scarf?: number; bag?: boolean }): THREE.BufferGeometry {
  const b = new Batch();
  const grey = 0x9aa4af;
  const white = 0xf4f7fa;
  const dark = 0x4c5560;
  const eye = 0x66c8ff;
  // torso + white belly + chest
  b.add(geo.box(0.3, 0.28, 0.62), grey, 0, 0.5, 0);
  b.add(geo.box(0.26, 0.1, 0.56), white, 0, 0.4, 0);
  b.add(geo.sphere(0.17, 10, 8), white, 0, 0.5, 0.26, { sz: 0.8 });
  b.add(geo.box(0.32, 0.08, 0.3), dark, 0, 0.66, -0.05); // saddle patch
  // head: grey cap, white muzzle, dark nose, blue eyes, ears
  b.add(geo.box(0.25, 0.23, 0.26), grey, 0, 0.68, 0.4);
  b.add(geo.box(0.15, 0.12, 0.16), white, 0, 0.62, 0.56);
  b.add(geo.box(0.06, 0.05, 0.05), dark, 0, 0.65, 0.65);
  b.add(geo.box(0.07, 0.02, 0.2), white, 0, 0.8, 0.42);
  for (const sx of [-1, 1]) {
    b.add(geo.sphere(0.028, 6, 5), eye, sx * 0.075, 0.71, 0.53);
    b.add(geo.cone(0.075, 0.17, 4), dark, sx * 0.09, 0.86, 0.36, { rz: -sx * 0.18 });
  }
  if (opts?.scarf !== undefined) {
    // a knitted scarf round the neck with a short tail down the chest (companion dog only)
    b.add(geo.box(0.31, 0.1, 0.12), opts.scarf, 0, 0.6, 0.25);
    b.add(geo.box(0.07, 0.17, 0.05), opts.scarf, 0.09, 0.5, 0.33);
  }
  if (opts?.bag) {
    // saddlebag: leather panniers, a strap over the back and two mini logs lying across the saddle patch
    for (const sx of [-1, 1]) b.add(geo.box(0.1, 0.2, 0.26), 0x8a5a32, sx * 0.2, 0.55, -0.04);
    b.add(geo.box(0.46, 0.04, 0.07), 0x5b3a1e, 0, 0.68, -0.04);
    for (const dz of [-0.1, 0.04]) {
      b.add(geo.cylinder(0.045, 0.045, 0.34, 8), 0xb98a56, 0, 0.74, dz, { rz: Math.PI / 2 });
      for (const sx of [-1, 1]) b.add(geo.cylinder(0.03, 0.03, 0.01, 8), 0xe6c690, sx * 0.171, 0.74, dz, { rz: Math.PI / 2 });
    }
  }
  if (opts?.tail ?? true) {
    // tail: curled up over the back, white tip
    b.add(geo.box(0.07, 0.07, 0.28), grey, 0, 0.7, -0.38, { rx: 0.7 });
    b.add(geo.box(0.075, 0.075, 0.1), white, 0, 0.85, -0.5, { rx: 0.7 });
  }
  return b.geometry();
}

function legGeometry(paw = 0x4c5560): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.box(0.075, 0.3, 0.09), 0xdfe5ea, 0, -0.15, 0);
  b.add(geo.box(0.085, 0.07, 0.13), paw, 0, -0.325, 0.02);
  return b.geometry();
}

const DOG_SCALE = 1.1;
const HIP_Y = 0.4;
const HIP_X = 0.1;
const HIP_Z = 0.2;
/** Fur tint per dog (instance colour multiplies the vertex colours): lead, 2nd, 3rd, 4th. */
const FUR = [0xffffff, 0xd9c0a4, 0xaeb8c8, 0xeeeef2] as const;

const _m = new THREE.Matrix4();
const _dog = new THREE.Matrix4();
const _hip = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function createSled(): SledModel {
  const root = new THREE.Group();
  root.name = 'dogSledTeam';
  const sled = new THREE.Group();
  sled.name = 'dogSled';
  const body = new THREE.Group();
  body.name = 'dogSledBody';
  sled.add(body);
  root.add(sled);

  const sledMesh = new THREE.Mesh(sledGeometry(), vcMat());
  sledMesh.castShadow = true;
  sledMesh.receiveShadow = true;
  sledMesh.name = 'sledMesh';
  body.add(sledMesh);

  // --- dogs -----------------------------------------------------------------------------------------
  const dogs = new THREE.InstancedMesh(dogGeometry(), vcMat(), 4);
  dogs.name = 'huskies';
  dogs.castShadow = true;
  dogs.receiveShadow = true;
  dogs.frustumCulled = false;
  const legs = new THREE.InstancedMesh(legGeometry(), vcMat(), 16);
  legs.name = 'huskyLegs';
  legs.castShadow = true;
  legs.receiveShadow = true;
  legs.frustumCulled = false;
  const lines = new THREE.InstancedMesh(
    new Batch().add(geo.box(1, 1, 1), 0x3a2a1c, 0, 0, 0).geometry(),
    vcMat(),
    6,
  );
  lines.name = 'sledGangLines';
  lines.castShadow = false;
  lines.frustumCulled = false;
  const c = new THREE.Color();
  for (let i = 0; i < 4; i++) dogs.setColorAt(i, c.set(FUR[i]!));
  for (let i = 0; i < 16; i++) legs.setColorAt(i, c.set(FUR[Math.floor(i / 4)]!));
  root.add(dogs, legs, lines);

  const rope = (i: number, from: THREE.Vector3, to: THREE.Vector3): void => {
    const len = from.distanceTo(to);
    _p.copy(from).add(to).multiplyScalar(0.5);
    _m.lookAt(from, to, _up);
    _q.setFromRotationMatrix(_m);
    _s.set(0.035, 0.035, len);
    lines.setMatrixAt(i, _m.compose(_p, _q, _s));
  };

  const model: SledModel = {
    root,
    sled,
    body,
    bubbleY: 2.0,
    payLocal: new THREE.Vector3(0, 1.0, 0.1),
    poseTeam(pairs, gait, amp, hop, lean) {
      let leg = 0;
      for (let k = 0; k < 2; k++) {
        const pp = pairs[k]!;
        const rx = Math.cos(pp.yaw);
        const rz = -Math.sin(pp.yaw);
        for (let side = 0; side < 2; side++) {
          const di = k * 2 + side;
          const sd = side === 0 ? -1 : 1;
          const ph = gait + di * 1.3; // a little out of step
          const bob = Math.abs(Math.sin(ph)) * 0.07 * amp + hop * (0.75 + 0.25 * Math.sin(di * 2.1));
          const pitch = Math.sin(ph * 2) * 0.06 * amp + lean;
          _p.set(pp.x + rx * sd * DOG_SIDE, bob, pp.z + rz * sd * DOG_SIDE);
          _e.set(-pitch, pp.yaw, 0, 'YXZ');
          _q.setFromEuler(_e);
          _s.setScalar(DOG_SCALE);
          _dog.compose(_p, _q, _s);
          dogs.setMatrixAt(di, _dog);
          // trot: diagonal pairs swing together
          for (let l = 0; l < 4; l++) {
            const front = l < 2;
            const left = l % 2 === 0;
            const diag = front === left ? 0 : Math.PI;
            const swing = Math.sin(ph + diag) * 0.75 * amp;
            _hip.makeTranslation((left ? -1 : 1) * HIP_X, HIP_Y, front ? HIP_Z : -HIP_Z);
            _hip.multiply(_m.makeRotationX(swing));
            legs.setMatrixAt(leg++, _m.multiplyMatrices(_dog, _hip));
          }
        }
      }
      // gang lines (world): sled front -> pair 0 rear, pair 0 -> pair 1 rear, plus a V into each dog's rump
      sled.updateMatrixWorld(true);
      _a.set(0, 0.3, 1.1);
      sled.localToWorld(_a);
      const rearPoint = (k: number, out: THREE.Vector3): THREE.Vector3 => {
        const pp = pairs[k]!;
        return out.set(pp.x - Math.sin(pp.yaw) * 0.55, 0.5, pp.z - Math.cos(pp.yaw) * 0.55);
      };
      rope(0, _a, rearPoint(0, _b));
      const c0 = pairs[0]!;
      _a.set(c0.x, 0.5, c0.z);
      rope(1, _a, rearPoint(1, _b));
      let ri = 2;
      for (let k = 0; k < 2; k++) {
        const pp = pairs[k]!;
        rearPoint(k, _a);
        for (const sd of [-1, 1]) {
          _b.set(
            pp.x + Math.cos(pp.yaw) * sd * DOG_SIDE - Math.sin(pp.yaw) * 0.3,
            0.55,
            pp.z - Math.sin(pp.yaw) * sd * DOG_SIDE - Math.cos(pp.yaw) * 0.3,
          );
          rope(ri++, _a, _b);
        }
      }
      dogs.instanceMatrix.needsUpdate = true;
      legs.instanceMatrix.needsUpdate = true;
      lines.instanceMatrix.needsUpdate = true;
    },
  };
  // neutral pose so the first frame is sane
  model.poseTeam(
    [
      { x: 0, z: 2.6, yaw: 0 },
      { x: 0, z: 4.1, yaw: 0 },
    ],
    0,
    0,
    0,
    0,
  );
  return model;
}

export const sledCatalog: Record<string, () => THREE.Object3D> = {
  dogSled: () => createSled().root,
  companionDog: () => createDog().root,
};


// ---------------------------------------------------------------------------
// Companion dog (entities/Dog.ts): ONE husky built from the same geometry as the sled team
// ---------------------------------------------------------------------------

/** Scarf colour per dog level (1 = first husky; 2+ get a new colour). */
const DOG_SCARF = [0xd94a3a, 0xd94a3a, 0x2f7de1, 0xf2b61f, 0x8a4fd0] as const;

export interface DogModel {
  /** Scale + root of the dog; position/yaw are set by the owner. Local +Z is forward. */
  readonly root: THREE.Group;
  /** Advance the pose: absolute time (s) and ground speed (m/s). Gait phase is integrated internally. */
  animate(t: number, speed: number): void;
  /** 0 standing .. 1 sitting (nose up, rump down, rear legs folded). */
  sit: number;
  /** Tail yaw (radians, side to side) for wagging. */
  tailYaw: number;
  /** Show / hide the saddlebag with two mini logs. */
  setBag(on: boolean): void;
  /** Scarf colour follows the upgrade level (rebuilds the body geometry only when the colour changes). */
  setLevel(level: number): void;
  dispose(): void;
}

const SIT_PITCH = -0.78;
const SIT_PIVOT = new THREE.Vector3(0, 0.36, -0.3);
const SIT_DROP = 0.3;
const LIMB_REACH = 0.37;
const TAIL_BASE = new THREE.Vector3(0, 0.66, -0.31);
const DOG_HIPS = [
  [HIP_X, HIP_Z, 0],
  [-HIP_X, HIP_Z, Math.PI],
  [HIP_X, -HIP_Z, Math.PI],
  [-HIP_X, -HIP_Z, 0],
] as const;

export function createDog(): DogModel {
  const root = new THREE.Group();
  root.name = 'companionDog';
  root.scale.setScalar(DOG_SCALE);
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  let scarf: number = DOG_SCARF[1]!;
  const bodyMesh = new THREE.Mesh(dogGeometry({ tail: false, scarf }), vcMat());
  bodyMesh.name = 'dogBody';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);
  let bagOn = false;
  const rebuildBody = (): void => {
    const old = bodyMesh.geometry;
    bodyMesh.geometry = dogGeometry({ tail: false, scarf, bag: bagOn });
    old.dispose();
  };

  // instances 0-3 = legs (FL, FR, RL, RR), 4 = the tail
  const limbs = new THREE.InstancedMesh(legGeometry(0xdfe5ea), vcMat(), 5); // white socks
  limbs.name = 'dogLimbs';
  limbs.castShadow = false; // the body's shadow is enough (keeps the dog at 3 draw calls)
  limbs.receiveShadow = true;
  limbs.frustumCulled = false;
  const c = new THREE.Color();
  for (let i = 0; i < 4; i++) limbs.setColorAt(i, c.set(0xffffff));
  limbs.setColorAt(4, c.set(0xb4bdc8));
  root.add(limbs);

  const body = new THREE.Matrix4();
  const hipM = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const scl = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const off = new THREE.Vector3();
  const offNeg = new THREE.Vector3();
  const pitchQ = new THREE.Quaternion();
  const unit = new THREE.Vector3(1, 1, 1);
  const identityQ = new THREE.Quaternion();
  const bodyPos = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);

  let phase = 0;
  let lastT = Number.NaN;
  let gaitW = 0;

  const model: DogModel = {
    root,
    sit: 0,
    tailYaw: 0,
    animate(t, speed) {
      const dt = Number.isNaN(lastT) ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const sit = model.sit;
      const target = Math.min(1, speed / 1.2) * (1 - sit);
      gaitW += (target - gaitW) * Math.min(1, dt * 12);
      phase += dt * Math.PI * 2 * (1.5 + speed * 0.42) * (speed > 0.3 ? 1 : 0.3);
      const w = gaitW;
      const bob = 0.045 * Math.abs(Math.sin(phase * 2)) * w;
      const breathe = 0.006 * Math.sin(t * 2.2);

      // body: bob + gallop pitch, or the sit pose (rotate about the rump, drop the rear)
      const pitch = SIT_PITCH * sit + 0.06 * Math.sin(phase * 2 + 1) * w;
      pitchQ.setFromAxisAngle(xAxis, pitch);
      off.copy(SIT_PIVOT);
      offNeg.copy(SIT_PIVOT).negate();
      bodyPos.set(0, bob + breathe - SIT_DROP * sit, 0);
      // body = T(bodyPos) * T(pivot) * R(pitch) * T(-pivot)
      body.compose(bodyPos, identityQ, unit);
      tmp.makeTranslation(off.x, off.y, off.z);
      body.multiply(tmp);
      rot.makeRotationFromQuaternion(pitchQ);
      body.multiply(rot);
      tmp.makeTranslation(offNeg.x, offNeg.y, offNeg.z);
      body.multiply(tmp);
      body.decompose(bodyGroup.position, bodyGroup.quaternion, bodyGroup.scale);

      for (let i = 0; i < 4; i++) {
        const [hx, hz, ph] = DOG_HIPS[i]!;
        const rear = hz < 0;
        const swing = 0.75 * Math.min(1, speed / 4 + 0.35) * Math.sin(phase + ph) * w;
        hipM.makeTranslation(hx, HIP_Y, hz);
        let ang = swing;
        let sy = 1;
        if (rear && sit > 0) {
          // rear legs fold forward under the haunch
          ang = swing * (1 - sit) + (-Math.PI / 2 - SIT_PITCH) * sit;
          sy = 1 - 0.45 * sit;
        }
        rot.makeRotationX(ang);
        scl.makeScale(1, sy, 1);
        tmp.multiplyMatrices(body, hipM).multiply(rot).multiply(scl);
        if (!rear && sit > 0) {
          // front legs stay planted: stretch them so the paws still reach the ground under the raised shoulders
          const hipY = tmp.elements[13]!;
          const k = Math.min(1.6, Math.max(0.6, hipY / (LIMB_REACH - 0.015)));
          scl.makeScale(1, 1 + (k - 1) * sit, 1);
          // cancel the body pitch so the leg hangs straight down in dog space
          rot.makeRotationX(swing - SIT_PITCH * sit);
          tmp.multiplyMatrices(body, hipM).multiply(rot).multiply(scl);
        }
        limbs.setMatrixAt(i, tmp);
      }

      // tail: yaw = the wag (about the dog's vertical axis)
      // up and back while standing; hangs down behind the rump while sitting
      const tailPitch = (2.75 + 0.25 * Math.sin(phase * 2) * w) * (1 - sit) + (0.7 - SIT_PITCH) * sit;
      hipM.makeTranslation(TAIL_BASE.x, TAIL_BASE.y, TAIL_BASE.z);
      rot.makeRotationAxis(yAxis, model.tailYaw);
      tmp.multiplyMatrices(body, hipM).multiply(rot);
      rot.makeRotationX(tailPitch);
      scl.makeScale(1.6, 1.0, 1.6);
      tmp.multiply(rot).multiply(scl);
      limbs.setMatrixAt(4, tmp);
      limbs.instanceMatrix.needsUpdate = true;
    },
    setBag(on) {
      if (on === bagOn) return;
      bagOn = on;
      rebuildBody();
    },
    setLevel(level) {
      const col = DOG_SCARF[Math.max(0, Math.min(DOG_SCARF.length - 1, Math.floor(level)))]!;
      if (col === scarf) return;
      scarf = col;
      rebuildBody();
    },
    dispose() {
      bodyMesh.geometry.dispose();
      limbs.geometry.dispose();
      limbs.dispose();
      root.removeFromParent();
    },
  };
  model.animate(0, 0);
  return model;
}
