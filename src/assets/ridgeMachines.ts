/**
 * [B6 — machines] AssetFactory: the wave-7 automation machines.
 *
 * - TREE FELLER: a tracked forestry harvester (COURIER_YELLOW body, dark tracks) with a turret that carries a 2-link
 *   boom ending in a horizontal circular felling saw, and a log rack at the rear. Forward is local +Z.
 * - CASH TOWER: the pneumatic receiver beside the cabin (blue control cabinet + steel column with one yellow collar
 *   per tube port, a glowing lamp that pulses when a capsule arrives).
 * - TRUCK LOADER extras: the hopper at the belt's start and the buffer at its end (the belt itself is the shared
 *   roller conveyor model).
 *
 * - WORKSHOP: the wave-8 furniture workshop, a log cabin with an open front, a table saw inside, a hopper trough on
 *   the west side and a bench on the east side (chimney on the roof).
 *
 * Draw-call notes: the feller is 8 meshes (chassis, turret, upper arm, forearm, blade, beacon, log bundle, badge),
 * the tower 3 (body, lamp, badge), the loader extras 1, the workshop 3 (building + hopper + bench in one mesh, saw
 * blade, badge) = 5 with shadows.
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE, UPGRADES, type XZ } from '../config';
import { Batch } from '../render/batch';
import { geo, mesh, toonUnique } from '../render/materials';
import { createLevelBadge, createSawBlade, type LevelBadge } from './machines';
import { MACHINE_SHADES } from '../render/palette';

/** 0.9.8: era 1 machine shades (timber and red lacquer instead of the ad's royal blue). */
const T1 = MACHINE_SHADES[1];

const box = (b: Batch, color: number, w: number, h: number, d: number, x: number, y: number, z: number, o?: { ry?: number; rx?: number; rz?: number }): void => {
  b.add(geo.box(1, 1, 1), color, x, y, z, { sx: w, sy: h, sz: d, ...o });
};
const cylX = (b: Batch, color: number, r: number, len: number, x: number, y: number, z: number, seg = 12): void => {
  b.add(geo.cylinder(1, 1, 1, seg), color, x, y, z, { sx: r, sy: len, sz: r, rz: Math.PI / 2 });
};
const cylY = (b: Batch, color: number, r: number, len: number, x: number, y: number, z: number, seg = 12): void => {
  b.add(geo.cylinder(1, 1, 1, seg), color, x, y, z, { sx: r, sy: len, sz: r });
};

// ---------------------------------------------------------------------------
// TREE FELLER
// ---------------------------------------------------------------------------

export interface TreeFellerModel {
  root: THREE.Group;
  /** Yaws the boom (slews the saw across the trunk). */
  turret: THREE.Group;
  /** Boom end: the felling saw's centre (world position via getWorldPosition). */
  head: THREE.Group;
  /** Spin with rotation.z (the blade lies flat, so this spins about the vertical). */
  blade: THREE.Group;
  beacon: THREE.Group;
  /** The four felled logs on the rack (toggle visible). */
  bundle: THREE.Mesh;
  badge: LevelBadge;
  /** Boom end target relative to the shoulder: `reach` along +Z, `height` above the shoulder's floor level. */
  setBoom(reach: number, height: number): void;
  /** Where the turret's shoulder sits (model space), for aiming. */
  shoulder: { z: number; y: number };
  /** Rack centre (model space), where logs are picked up and dropped from. */
  rack: THREE.Vector3;
}

const FL_UPPER = 1.05;
const FL_FORE = 1.05;
const SHOULDER = { z: 0.95, y: 1.2 };

export function createTreeFeller(): TreeFellerModel {
  const root = new THREE.Group();

  // --- chassis (one mesh): tracks, frame, cab, engine, rack ---
  const c = new Batch();
  for (const sx of [-1, 1]) {
    const x = sx * 0.84;
    box(c, T1.timberD, 0.5, 0.46, 2.7, x, 0.3, -0.05);
    box(c, T1.iron, 0.34, 0.1, 2.5, x, 0.58, -0.05);
    // sprocket + idler wheels with yellow hubs
    for (const z of [-1.25, 1.15]) {
      cylX(c, T1.iron, 0.27, 0.54, x, 0.3, z, 12);
      cylX(c, PALETTE.accent, 0.12, 0.58, x, 0.3, z, 8);
    }
    // cleats
    for (let i = 0; i < 9; i++) box(c, COLORS.MACHINE_STEEL, 0.54, 0.05, 0.1, x, 0.04, -1.3 + i * 0.3);
    box(c, T1.iron, 0.4, 0.14, 2.9, x, 0.14, -0.05);
  }
  // frame + deck
  box(c, T1.iron, 1.8, 0.24, 2.9, 0, 0.55, -0.05);
  box(c, PALETTE.accent, 1.5, 0.3, 2.8, 0, 0.78, -0.05);
  box(c, T1.timberD, 1.52, 0.06, 2.82, 0, 0.64, -0.05);
  // cab (front-left), dark windows
  box(c, PALETTE.accent, 0.85, 0.9, 1.0, -0.42, 1.38, 0.1);
  box(c, T1.iron, 0.95, 0.08, 1.1, -0.42, 1.86, 0.1);
  box(c, T1.timberD, 0.7, 0.42, 0.04, -0.42, 1.5, 0.62);
  box(c, T1.timberD, 0.04, 0.42, 0.7, -0.86, 1.5, 0.1);
  box(c, T1.timberD, 0.04, 0.42, 0.7, 0.01, 1.5, 0.1);
  // engine hood + exhaust behind the cab
  box(c, PALETTE.accent, 1.2, 0.52, 0.7, 0, 1.2, -0.62);
  box(c, T1.timberD, 1.0, 0.05, 0.5, 0, 1.48, -0.62);
  cylY(c, COLORS.MACHINE_STEEL, 0.07, 0.6, 0.45, 1.75, -0.55, 8);
  // hazard stripes along the deck edge
  for (let i = 0; i < 8; i++) box(c, i % 2 ? T1.timberD : COLORS.SAW_GLOW, 0.03, 0.2, 0.22, 0.76, 0.78, -1.15 + i * 0.32);
  // log rack at the rear: floor, four stakes
  box(c, PALETTE.fenceDark, 1.5, 0.08, 1.0, 0, 0.88, -1.0);
  for (const sx of [-1, 1]) for (const sz of [-1.44, -0.56]) box(c, T1.iron, 0.08, 0.7, 0.08, sx * 0.72, 1.2, sz);
  // turret ring (static base)
  cylY(c, T1.iron, 0.42, 0.16, 0, 1.0, SHOULDER.z, 14);
  const chassis = c.mesh();
  root.add(chassis);

  // beacon on the cab roof
  const beacon = new THREE.Group();
  beacon.position.set(-0.42, 1.9, 0.1);
  const bs = new Batch();
  bs.add(geo.sphere(0.13, 10, 8), COLORS.SAW_GLOW, 0, 0.1, 0);
  box(bs, COLORS.COURIER_YELLOW, 0.34, 0.04, 0.05, 0, 0.1, 0);
  beacon.add(bs.mesh());
  root.add(beacon);

  // --- turret + boom ---
  const turret = new THREE.Group();
  turret.position.set(0, SHOULDER.y, SHOULDER.z);
  root.add(turret);
  const tb = new Batch();
  box(tb, PALETTE.accent, 0.6, 0.34, 0.6, 0, -0.1, -0.05);
  cylY(tb, T1.iron, 0.34, 0.1, 0, -0.26, 0, 12);
  cylX(tb, COLORS.MACHINE_STEEL, 0.17, 0.4, 0, 0, 0, 12);
  turret.add(tb.mesh());

  const upper = new THREE.Group();
  turret.add(upper);
  const ub = new Batch();
  box(ub, PALETTE.accent, 0.24, 0.26, FL_UPPER, 0, 0, FL_UPPER / 2);
  box(ub, COLORS.SAW_GLOW, 0.26, 0.06, FL_UPPER * 0.6, 0, 0.14, FL_UPPER * 0.5);
  upper.add(ub.mesh());
  const fore = new THREE.Group();
  fore.position.set(0, 0, FL_UPPER);
  upper.add(fore);
  const fb = new Batch();
  cylX(fb, COLORS.MACHINE_STEEL, 0.15, 0.3, 0, 0, 0, 12);
  box(fb, PALETTE.accent, 0.2, 0.22, FL_FORE, 0, 0, FL_FORE / 2);
  fore.add(fb.mesh());

  // saw head at the forearm TIP (setBoom keeps it level): housing + hanging flat blade
  const head = new THREE.Group();
  head.position.set(0, 0, FL_FORE);
  const hb = new Batch();
  box(hb, T1.iron, 0.36, 0.36, 0.34, 0, 0, 0);
  box(hb, PALETTE.accent, 0.5, 0.14, 0.5, 0, -0.16, 0.05);
  head.add(hb.mesh());
  const bladePivot = new THREE.Group();
  bladePivot.rotation.x = Math.PI / 2; // blade lies flat (axis vertical)
  bladePivot.position.set(0, -0.3, 0.2);
  const blade = createSawBlade(0.62, 16, 0.07);
  bladePivot.add(blade);
  head.add(bladePivot);
  fore.add(head);

  const setBoom = (reach: number, height: number): void => {
    const dx = reach;
    const dy = height - SHOULDER.y;
    let d = Math.hypot(dx, dy);
    const dMax = FL_UPPER + FL_FORE - 0.02;
    const dMin = Math.abs(FL_UPPER - FL_FORE) + 0.05;
    const k = d > dMax ? dMax / d : d < dMin ? dMin / Math.max(d, 1e-4) : 1;
    d *= k;
    const hx = dx * k;
    const hy = dy * k;
    const alpha = Math.atan2(hy, hx);
    const cosB = (FL_UPPER * FL_UPPER + d * d - FL_FORE * FL_FORE) / (2 * FL_UPPER * d);
    const beta = Math.acos(Math.max(-1, Math.min(1, cosB)));
    const phi1 = alpha + beta; // elbow up
    const ex = Math.cos(phi1) * FL_UPPER;
    const ey = Math.sin(phi1) * FL_UPPER;
    const phi2 = Math.atan2(hy - ey, hx - ex);
    // rotation.x = -phi pitches +Z up
    upper.rotation.x = -phi1;
    fore.rotation.x = -(phi2 - phi1);
    // the forearm's total pitch is -phi2: undo it so the head hangs level and the blade stays flat
    head.rotation.x = phi2;
  };
  setBoom(1.1, 0.9);

  // --- felled logs on the rack (one mesh) ---
  const lb = new Batch();
  const logs: Array<[number, number]> = [
    [-1.28, 1.04],
    [-1.0, 1.04],
    [-0.72, 1.04],
    [-1.0, 1.28],
  ];
  const r = 0.14;
  for (const [z, y] of logs) {
    cylX(lb, COLORS.LOG_BARK, r, 1.2, 0, y, z, 10);
    for (const s of [-1, 1]) cylX(lb, COLORS.LOG_CORE, r * 0.8, 0.02, s * 0.6, y, z, 10);
  }
  const bundle = lb.mesh();
  bundle.visible = false;
  root.add(bundle);

  const badge = createLevelBadge(UPGRADES.treeFeller.values.length - 1);
  badge.mesh.position.set(0.76, 0.78, 0.2);
  badge.mesh.rotation.y = Math.PI / 2;
  badge.mesh.scale.setScalar(1.15);
  root.add(badge.mesh);

  return {
    root,
    turret,
    head,
    blade,
    beacon,
    bundle,
    badge,
    setBoom,
    shoulder: SHOULDER,
    rack: new THREE.Vector3(0, 1.15, -1.0),
  };
}

// ---------------------------------------------------------------------------
// WORKSHOP (furniture)
// ---------------------------------------------------------------------------

export interface WorkshopModel {
  /** Origin = floor under the cabin centre (LAYOUT.ridge.workshop x/z). Holds the building, hopper, bench, blade, badge. */
  root: THREE.Group;
  /** Static shell (squash / shudder target). */
  body: THREE.Group;
  /** Circular saw: spin with rotation.z (vertical disc, axis along Z, its plane contains the X travel line). */
  blade: THREE.Group;
  badge: LevelBadge;
  /** Local points (relative to the cabin centre): hatch mouth, saw cut point, chair exit and chimney mouth. */
  mouth: THREE.Vector3;
  saw: THREE.Vector3;
  exit: THREE.Vector3;
  chimney: THREE.Vector3;
}

/** Heights the stations rely on: pile base planes of the hopper tray and the bench, and the saw table top. */
export const WORKSHOP_HOPPER_Y = 0.45;
export const WORKSHOP_BENCH_Y = 0.6;
export const WORKSHOP_TABLE_Y = 0.6;

export function createWorkshop(): WorkshopModel {
  const W = LAYOUT.ridge.workshop;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const b = new Batch();

  const HW = W.w / 2;
  const HD = W.d / 2;
  const FLOOR = 0.1;
  const R = 0.125; // wall log radius
  const PITCH = 0.245;
  const courseY = (i: number): number => FLOOR + R + i * PITCH;
  const courseTop = (i: number): number => courseY(i) + R;
  const BARK_A = COLORS.LOG_BARK;
  const BARK_B = 0xb35f22;
  const CORE = COLORS.LOG_CORE;
  const logX = (i: number, z: number, len: number, x: number): void => {
    cylX(b, i % 2 ? BARK_B : BARK_A, R, len, x, courseY(i), z, 10);
    for (const s of [-1, 1]) cylX(b, CORE, R * 0.82, 0.03, x + (s * len) / 2, courseY(i), z, 10);
  };
  const logZ = (i: number, x: number, z0: number, z1: number): void => {
    const len = z1 - z0;
    b.add(geo.cylinder(1, 1, 1, 10), i % 2 ? BARK_B : BARK_A, x, courseY(i), (z0 + z1) / 2, { sx: R, sy: len, sz: R, rx: Math.PI / 2 });
    for (const s of [-1, 1]) b.add(geo.cylinder(1, 1, 1, 10), CORE, x, courseY(i), s > 0 ? z1 : z0, { sx: R * 0.82, sy: 0.03, sz: R * 0.82, rx: Math.PI / 2 });
  };

  // --- floor deck ---
  box(b, COLORS.FENCE_WOOD, W.w, FLOOR, W.d, 0, FLOOR / 2, 0);
  for (let i = 1; i < 6; i++) box(b, PALETTE.fenceDark, 0.03, 0.012, W.d - 0.04, -HW + (i * W.w) / 6, FLOOR + 0.002, 0);

  // --- roof geometry (shed roof over the rear 60 % (its front edge stays well behind the saw, so the camera sees the blade under the eave), sloping down toward the open front) ---
  const SLOPE = 0.26;
  const THETA = Math.atan(SLOPE);
  const underside = (z: number): number => 3.0 - SLOPE * (z + 1.15);
  const FRONT_POST_Z = 0.45;

  // --- walls ---
  const nBack = 11;
  for (let i = 0; i < nBack; i++) logX(i, -HD + R, W.w + 0.06, 0);
  // side walls: courses 2 and 3 are the hatches for z > -0.4 (log in on the west, chair out on the east)
  for (const sx of [-1, 1]) {
    const x = sx * (HW - R);
    for (let i = 0; i < 12; i++) {
      const top = courseTop(i);
      const zEnd = Math.min(FRONT_POST_Z, (3.0 - top) / SLOPE - 1.15);
      if (zEnd < -0.55) continue;
      if (i === 2 || i === 3) logZ(i, x, -HD + 2 * R, -0.4);
      else logZ(i, x, -HD + 2 * R, zEnd);
    }
  }
  // top plate under the roof at the back
  box(b, PALETTE.barkDark, W.w - 0.1, 0.14, 0.3, 0, underside(-0.85) - 0.07, -0.85);
  // door-frame style posts at the open front and a header log
  for (const sx of [-1, 1]) {
    box(b, PALETTE.barkDark, 0.24, underside(FRONT_POST_Z) - FLOOR, 0.24, sx * (HW - 0.12), FLOOR + (underside(FRONT_POST_Z) - FLOOR) / 2, FRONT_POST_Z);
    // jamb braces
    box(b, PALETTE.fenceDark, 0.1, 0.5, 0.1, sx * (HW - 0.45), underside(FRONT_POST_Z) - 0.38, FRONT_POST_Z, { rz: -sx * 0.7 });
  }
  cylX(b, BARK_A, 0.11, W.w - 0.1, 0, underside(FRONT_POST_Z) - 0.14, FRONT_POST_Z + 0.02, 10);
  for (const s of [-1, 1]) cylX(b, CORE, 0.09, 0.03, (s * (W.w - 0.1)) / 2, underside(FRONT_POST_Z) - 0.14, FRONT_POST_Z + 0.02, 10);
  // chair plaque on the header: dark board with a yellow chair icon
  const PZ = FRONT_POST_Z + 0.15;
  const PY = underside(FRONT_POST_Z) - 0.14;
  box(b, T1.timberD, 0.62, 0.24, 0.04, 0, PY, PZ);
  box(b, COLORS.COURIER_YELLOW, 0.03, 0.17, 0.02, -0.07, PY + 0.01, PZ + 0.03);
  box(b, COLORS.COURIER_YELLOW, 0.03, 0.17, 0.02, 0.07, PY + 0.01, PZ + 0.03);
  box(b, COLORS.COURIER_YELLOW, 0.17, 0.035, 0.02, 0, PY + 0.07, PZ + 0.03);
  box(b, COLORS.COURIER_YELLOW, 0.17, 0.035, 0.02, 0, PY - 0.015, PZ + 0.03);

  // --- roof: red slab + snow ---
  const mid = -0.35;
  const roofLen = 1.8 / Math.cos(THETA);
  const roofY = underside(mid) + 0.075;
  box(b, 0xc4472f, W.w + 0.5, 0.15, roofLen, 0, roofY, mid, { rx: THETA });
  // darker edge strip along the front eave
  const eaveZ = mid + (roofLen / 2) * Math.cos(THETA);
  box(b, 0x9e3524, W.w + 0.5, 0.2, 0.08, 0, roofY - (roofLen / 2) * Math.sin(THETA) - 0.01, eaveZ, { rx: THETA });
  const snowOff = 0.13;
  box(b, COLORS.SNOW_WHITE, W.w + 0.34, 0.13, roofLen - 0.26, 0, roofY + snowOff * Math.cos(THETA), mid - 0.03, { rx: THETA });
  box(b, PALETTE.snowShade, W.w + 0.3, 0.07, 0.34, 0, roofY + 0.04 - (roofLen / 2 - 0.22) * Math.sin(THETA) + snowOff, mid + (roofLen / 2 - 0.22) * Math.cos(THETA) - 0.03, { rx: THETA * 0.6 });
  // rafter ends under the front eave
  for (let i = 0; i < 6; i++) {
    const x = -HW + 0.1 + (i * (W.w - 0.2)) / 5;
    box(b, PALETTE.barkDark, 0.1, 0.1, 0.26, x, underside(0.62) - 0.04, 0.62, { rx: THETA });
  }

  // --- chimney (stone) on the back-right ---
  const CHX = 0.95;
  const CHZ = -0.62;
  box(b, PALETTE.rock, 0.5, 1.7, 0.5, CHX, 3.0, CHZ);
  for (let i = 0; i < 5; i++) box(b, PALETTE.rockDark, 0.52, 0.045, 0.52, CHX, 2.3 + i * 0.32, CHZ);
  box(b, PALETTE.rockDark, 0.62, 0.12, 0.62, CHX, 3.9, CHZ);
  box(b, COLORS.SNOW_WHITE, 0.6, 0.06, 0.6, CHX, 3.99, CHZ);

  // --- saw table with a slot for the blade ---
  const TABLE = WORKSHOP_TABLE_Y;
  for (const s of [-1, 1]) box(b, COLORS.FENCE_WOOD, W.w - 0.2, 0.1, 0.27, 0, TABLE - 0.05, s * 0.175);
  for (const s of [-1, 1]) box(b, PALETTE.fenceDark, W.w - 0.2, 0.12, 0.06, 0, TABLE - 0.14, s * 0.3);
  for (const x of [-1.35, 0, 1.35]) for (const s of [-1, 1]) box(b, PALETTE.barkDark, 0.1, TABLE - FLOOR - 0.1, 0.1, x, FLOOR + (TABLE - FLOOR - 0.1) / 2, s * 0.26);
  // steel rails on the table edge to guide the logs
  for (const s of [-1, 1]) box(b, COLORS.MACHINE_STEEL, W.w - 0.3, 0.04, 0.035, 0, TABLE + 0.02, s * 0.3);
  // motor housing behind the blade + belt guard
  box(b, T1.lacquer, 0.62, 0.52, 0.3, 0, TABLE + 0.2, -0.31);
  box(b, T1.lacquerD, 0.7, 0.07, 0.36, 0, TABLE + 0.48, -0.31);
  box(b, COLORS.MACHINE_STEEL, 0.34, 0.08, 0.02, 0, TABLE + 0.24, -0.15);
  for (let i = 0; i < 3; i++) box(b, COLORS.COURIER_YELLOW, 0.5, 0.045, 0.01, 0, TABLE + 0.32 + i * 0.1, -0.155);
  // blade guard arching over the back of the disc
  box(b, COLORS.COURIER_YELLOW, 0.1, 0.06, 0.1, 0.0, TABLE + 0.75, 0.0);

  // --- hanging lantern on the front-left post ---
  const LX = -HW + 0.28;
  const LY = underside(FRONT_POST_Z) - 0.5;
  box(b, T1.timberD, 0.03, 0.34, 0.03, LX, LY + 0.3, FRONT_POST_Z + 0.2);
  box(b, T1.timberD, 0.2, 0.05, 0.2, LX, LY + 0.13, FRONT_POST_Z + 0.4);
  box(b, COLORS.SAW_GLOW, 0.15, 0.2, 0.15, LX, LY, FRONT_POST_Z + 0.4);
  box(b, T1.timberD, 0.2, 0.05, 0.2, LX, LY - 0.12, FRONT_POST_Z + 0.4);
  box(b, T1.timberD, 0.03, 0.34, 0.03, LX, LY + 0.3, FRONT_POST_Z + 0.4);
  box(b, T1.timberD, 0.03, 0.03, 0.2, LX, LY + 0.47, FRONT_POST_Z + 0.3);

  // --- hopper trough on the west side (logs lie along X, pile base plane at WORKSHOP_HOPPER_Y) ---
  const hx = W.hopper.x - W.x;
  const hz = W.hopper.z - W.z;
  const HY = WORKSHOP_HOPPER_Y;
  box(b, COLORS.FENCE_WOOD, 0.9, 0.1, 1.1, hx, HY - 0.05, hz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(b, PALETTE.barkDark, 0.12, HY - FLOOR - 0.1, 0.12, hx + sx * 0.36, FLOOR + (HY - FLOOR - 0.1) / 2, hz + sz * 0.46);
    box(b, PALETTE.barkDark, 0.1, 0.95, 0.1, hx + sx * 0.4, HY + 0.43, hz + sz * 0.5);
  }
  for (const sz of [-1, 1]) {
    box(b, PALETTE.fenceDark, 0.9, 0.08, 0.06, hx, HY + 0.22, hz + sz * 0.5);
    box(b, PALETTE.fenceDark, 0.9, 0.08, 0.06, hx, HY + 0.6, hz + sz * 0.5);
    box(b, COLORS.FENCE_WOOD, 0.92, 0.07, 0.09, hx, HY + 0.93, hz + sz * 0.5);
  }
  box(b, PALETTE.fenceDark, 0.07, 0.08, 1.0, hx - 0.4, HY + 0.18, hz); // west lip (the hopper opens east to the hatch)
  // loading ramp: steel plate from the tray lip up to the hatch sill
  box(b, COLORS.MACHINE_STEEL, 0.32, 0.04, 0.7, hx + 0.58, HY + 0.07, hz, { rz: -0.35 });

  // --- bench on the east side ---
  const bx = W.bench.x - W.x;
  const bz = W.bench.z - W.z;
  const BY = WORKSHOP_BENCH_Y;
  box(b, COLORS.FENCE_WOOD, 1.3, 0.12, 1.1, bx, BY - 0.06, bz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, PALETTE.fenceDark, 0.13, BY - FLOOR - 0.12, 0.13, bx + sx * 0.5, FLOOR + (BY - FLOOR - 0.12) / 2, bz + sz * 0.44);
  for (const sz of [-1, 1]) box(b, PALETTE.fenceDark, 1.15, 0.1, 0.06, bx, BY - 0.2, bz + sz * 0.44);
  box(b, PALETTE.fenceDark, 0.06, 0.1, 0.9, bx + 0.5, BY - 0.2, bz);
  for (const sz of [-1, 1]) box(b, PALETTE.fenceDark, 1.3, 0.05, 0.06, bx, BY + 0.025, bz + sz * 0.52, undefined);
  box(b, PALETTE.fenceDark, 0.06, 0.05, 1.1, bx + 0.62, BY + 0.025, bz);

  // --- open-front yard: stacked boards, a chopping stump with an axe, a sawhorse ---
  for (let i = 0; i < 4; i++) box(b, i % 2 ? COLORS.PLANK_WOOD : COLORS.LOG_CORE, 0.9, 0.09, 0.4, -0.85, FLOOR + 0.05 + i * 0.1, 0.76 + (i % 2) * 0.02);
  for (const sx of [-1, 1]) box(b, COLORS.CRATE_STRIP, 0.05, 0.42, 0.44, -0.85 + sx * 0.24, FLOOR + 0.21, 0.76);
  cylY(b, BARK_B, 0.2, 0.34, 0.85, FLOOR + 0.17, 0.74, 12);
  cylY(b, CORE, 0.17, 0.02, 0.85, FLOOR + 0.345, 0.74, 12);
  box(b, PALETTE.barkDark, 0.05, 0.42, 0.05, 0.85, FLOOR + 0.5, 0.74, { rz: 0.25 });
  box(b, COLORS.MACHINE_STEEL, 0.2, 0.12, 0.05, 0.93, FLOOR + 0.62, 0.74, { rz: 0.25 });
  // small snow drift on the front-left corner
  b.add(geo.sphere(0.5, 10, 8), COLORS.SNOW_WHITE, -HW + 0.1, FLOOR - 0.12, HD - 0.05, { sx: 1.1, sy: 0.4, sz: 0.8 });

  const shell = b.mesh();
  body.add(shell);

  // --- the circular saw ---
  const blade = new THREE.Group();
  blade.position.set(0, TABLE + 0.2, 0);
  blade.add(createSawBlade(0.52, 18, 0.05));
  body.add(blade);

  const badge = createLevelBadge(UPGRADES.workshop.values.length - 1);
  badge.mesh.position.set(-0.85, TABLE - 0.14, 0.325);
  badge.mesh.scale.setScalar(0.8);
  root.add(badge.mesh);

  return {
    root,
    body,
    blade,
    badge,
    mouth: new THREE.Vector3(-HW - 0.05, TABLE + 0.13, 0),
    saw: new THREE.Vector3(0, TABLE + 0.13, 0),
    exit: new THREE.Vector3(HW - 0.05, TABLE + 0.3, 0),
    chimney: new THREE.Vector3(CHX, 4.1, CHZ),
  };
}

// ---------------------------------------------------------------------------
// CASH TOWER (pneumatic receiver)
// ---------------------------------------------------------------------------

export interface CashTowerModel {
  root: THREE.Group;
  /** Glowing top lamp (own material; pulse emissiveIntensity). */
  lamp: THREE.Mesh;
  lampMaterial: THREE.MeshToonMaterial;
  badge: LevelBadge;
}

/** Height of the tower's column top (tubes end at it, at their own port heights). */
export const TOWER_HEIGHT = 4.9;

export function createCashTower(portHeights: readonly number[]): CashTowerModel {
  const root = new THREE.Group();
  const b = new Batch();
  // control cabinet
  box(b, T1.lacquerD, 1.2, 0.18, 1.0, 0, 0.09, 0);
  box(b, T1.lacquer, 1.0, 1.15, 0.8, 0, 0.75, 0);
  box(b, T1.iron, 1.08, 0.08, 0.88, 0, 1.36, 0);
  box(b, T1.timberD, 0.5, 0.5, 0.04, -0.2, 0.7, 0.4);
  // column
  cylY(b, COLORS.MACHINE_STEEL, 0.3, TOWER_HEIGHT - 1.3, 0, 1.4 + (TOWER_HEIGHT - 1.3) / 2, 0, 14);
  cylY(b, T1.iron, 0.4, 0.16, 0, 1.46, 0, 14);
  // collars at every port height
  for (const h of portHeights) {
    cylY(b, COLORS.COURIER_YELLOW, 0.4, 0.14, 0, h, 0, 14);
    cylY(b, T1.iron, 0.36, 0.06, 0, h - 0.1, 0, 14);
  }
  // cap
  cylY(b, T1.iron, 0.42, 0.14, 0, TOWER_HEIGHT - 0.05, 0, 14);
  b.add(geo.cone(0.34, 0.4, 12), T1.lacquer, 0, TOWER_HEIGHT + 0.22, 0);
  root.add(b.mesh());
  const lampMaterial = toonUnique(COLORS.SAW_GLOW, { emissive: COLORS.SAW_GLOW, emissiveIntensity: 0.4 });
  const lamp = mesh(geo.sphere(0.2, 10, 8), lampMaterial, { cast: false });
  lamp.position.y = TOWER_HEIGHT + 0.6;
  root.add(lamp);
  const badge = createLevelBadge(UPGRADES.cashTubes.values.length - 1);
  badge.mesh.position.set(0, 0.78, 0.43);
  badge.mesh.scale.setScalar(0.95);
  root.add(badge.mesh);
  return { root, lamp, lampMaterial, badge };
}

// ---------------------------------------------------------------------------
// CASH CAPSULE (instanced by the station)
// ---------------------------------------------------------------------------

let capsuleGeometry: THREE.BufferGeometry | null = null;
/** Pneumatic carrier: green capsule with a white band, long axis along Y. */
export function cashCapsuleGeometry(): THREE.BufferGeometry {
  if (!capsuleGeometry) {
    const b = new Batch();
    b.add(geo.capsule(0.1, 0.34, 4, 8), COLORS.CASH_GREEN, 0, 0, 0);
    b.add(geo.cylinder(0.106, 0.106, 0.07, 8), COLORS.CASH_BAND, 0, 0, 0);
    capsuleGeometry = b.geometry();
  }
  return capsuleGeometry;
}

// ---------------------------------------------------------------------------
// TRUCK LOADER extras
// ---------------------------------------------------------------------------

export interface LoaderExtras {
  root: THREE.Group;
}

/**
 * Hopper at the belt start and a buffer + chute at its end. `start`/`end` are the belt's end points and
 * `startDir`/`endDir` unit travel directions (XZ). The group sits at the world origin.
 */
export function createLoaderExtras(start: XZ, startDir: XZ, end: XZ, endDir: XZ, width: number): LoaderExtras {
  const root = new THREE.Group();
  const b = new Batch();
  const half = width / 2 + 0.12;
  const place = (p: XZ, d: XZ, along: number, side: number, y: number, w: number, h: number, len: number, color: number): void => {
    // local frame: +Z along the belt, +X to the belt's right
    const rx = d.z; // right = (dz, -dx)
    const rz = -d.x;
    const x = p.x + d.x * along + rx * side;
    const z = p.z + d.z * along + rz * side;
    b.add(geo.box(1, 1, 1), color, x, y, z, { sx: w, sy: h, sz: len, ry: Math.atan2(d.x, d.z) });
  };
  // start: side boards that funnel logs onto the belt + a lamp-post style marker
  for (const s of [-1, 1]) {
    place(start, startDir, 0.35, s * (half + 0.04), 0.82, 0.08, 0.42, 1.1, T1.lacquer);
    place(start, startDir, -0.05, s * (half + 0.2), 0.6, 0.08, 0.1, 0.5, T1.iron);
  }
  place(start, startDir, -0.3, 0, 0.62, width + 0.5, 0.08, 0.08, COLORS.COURIER_YELLOW);
  // end: buffer bar + yellow frame the logs hop over
  place(end, endDir, 0.12, 0, 0.78, width + 0.3, 0.1, 0.1, T1.timberD);
  for (const s of [-1, 1]) place(end, endDir, 0.12, s * (half + 0.02), 0.74, 0.1, 0.6, 0.1, COLORS.COURIER_YELLOW);
  const m = b.mesh();
  root.add(m);
  return { root };
}

export const ridgeMachineCatalog: Record<string, () => THREE.Object3D> = {
  treeFeller: () => createTreeFeller().root,
  cashTower: () => createCashTower([3.3, 3.6, 3.9, 4.2]).root,
  workshop: () => createWorkshop().root,
};
