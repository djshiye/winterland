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
 * Draw-call notes: the feller is 8 meshes (chassis, turret, upper arm, forearm, blade, beacon, log bundle, badge),
 * the tower 3 (body, lamp, badge), the loader extras 1.
 */
import * as THREE from 'three';
import { COLORS, PALETTE, UPGRADES, type XZ } from '../config';
import { Batch } from '../render/batch';
import { geo, mesh, toonUnique } from '../render/materials';
import { createLevelBadge, createSawBlade, type LevelBadge } from './machines';

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
    box(c, PALETTE.rubber, 0.5, 0.46, 2.7, x, 0.3, -0.05);
    box(c, PALETTE.metalDark, 0.34, 0.1, 2.5, x, 0.58, -0.05);
    // sprocket + idler wheels with yellow hubs
    for (const z of [-1.25, 1.15]) {
      cylX(c, PALETTE.metalDark, 0.27, 0.54, x, 0.3, z, 12);
      cylX(c, PALETTE.accent, 0.12, 0.58, x, 0.3, z, 8);
    }
    // cleats
    for (let i = 0; i < 9; i++) box(c, COLORS.MACHINE_STEEL, 0.54, 0.05, 0.1, x, 0.04, -1.3 + i * 0.3);
    box(c, PALETTE.metalDark, 0.4, 0.14, 2.9, x, 0.14, -0.05);
  }
  // frame + deck
  box(c, PALETTE.metalDark, 1.8, 0.24, 2.9, 0, 0.55, -0.05);
  box(c, PALETTE.accent, 1.5, 0.3, 2.8, 0, 0.78, -0.05);
  box(c, PALETTE.rubber, 1.52, 0.06, 2.82, 0, 0.64, -0.05);
  // cab (front-left), dark windows
  box(c, PALETTE.accent, 0.85, 0.9, 1.0, -0.42, 1.38, 0.1);
  box(c, PALETTE.metalDark, 0.95, 0.08, 1.1, -0.42, 1.86, 0.1);
  box(c, PALETTE.rubber, 0.7, 0.42, 0.04, -0.42, 1.5, 0.62);
  box(c, PALETTE.rubber, 0.04, 0.42, 0.7, -0.86, 1.5, 0.1);
  box(c, PALETTE.rubber, 0.04, 0.42, 0.7, 0.01, 1.5, 0.1);
  // engine hood + exhaust behind the cab
  box(c, PALETTE.accent, 1.2, 0.52, 0.7, 0, 1.2, -0.62);
  box(c, PALETTE.rubber, 1.0, 0.05, 0.5, 0, 1.48, -0.62);
  cylY(c, COLORS.MACHINE_STEEL, 0.07, 0.6, 0.45, 1.75, -0.55, 8);
  // hazard stripes along the deck edge
  for (let i = 0; i < 8; i++) box(c, i % 2 ? PALETTE.rubber : COLORS.SAW_GLOW, 0.03, 0.2, 0.22, 0.76, 0.78, -1.15 + i * 0.32);
  // log rack at the rear: floor, four stakes
  box(c, PALETTE.fenceDark, 1.5, 0.08, 1.0, 0, 0.88, -1.0);
  for (const sx of [-1, 1]) for (const sz of [-1.44, -0.56]) box(c, PALETTE.metalDark, 0.08, 0.7, 0.08, sx * 0.72, 1.2, sz);
  // turret ring (static base)
  cylY(c, PALETTE.metalDark, 0.42, 0.16, 0, 1.0, SHOULDER.z, 14);
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
  cylY(tb, PALETTE.metalDark, 0.34, 0.1, 0, -0.26, 0, 12);
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

  // saw head: housing + hanging flat blade
  const head = new THREE.Group();
  const hb = new Batch();
  box(hb, PALETTE.metalDark, 0.36, 0.36, 0.34, 0, 0, 0);
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
  box(b, PALETTE.machineDark, 1.2, 0.18, 1.0, 0, 0.09, 0);
  box(b, COLORS.MACHINE_BLUE, 1.0, 1.15, 0.8, 0, 0.75, 0);
  box(b, PALETTE.metalDark, 1.08, 0.08, 0.88, 0, 1.36, 0);
  box(b, PALETTE.rubber, 0.5, 0.5, 0.04, -0.2, 0.7, 0.4);
  // column
  cylY(b, COLORS.MACHINE_STEEL, 0.3, TOWER_HEIGHT - 1.3, 0, 1.4 + (TOWER_HEIGHT - 1.3) / 2, 0, 14);
  cylY(b, PALETTE.metalDark, 0.4, 0.16, 0, 1.46, 0, 14);
  // collars at every port height
  for (const h of portHeights) {
    cylY(b, COLORS.COURIER_YELLOW, 0.4, 0.14, 0, h, 0, 14);
    cylY(b, PALETTE.metalDark, 0.36, 0.06, 0, h - 0.1, 0, 14);
  }
  // cap
  cylY(b, PALETTE.metalDark, 0.42, 0.14, 0, TOWER_HEIGHT - 0.05, 0, 14);
  b.add(geo.cone(0.34, 0.4, 12), COLORS.MACHINE_BLUE, 0, TOWER_HEIGHT + 0.22, 0);
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
    place(start, startDir, 0.35, s * (half + 0.04), 0.82, 0.08, 0.42, 1.1, COLORS.MACHINE_BLUE);
    place(start, startDir, -0.05, s * (half + 0.2), 0.6, 0.08, 0.1, 0.5, PALETTE.metalDark);
  }
  place(start, startDir, -0.3, 0, 0.62, width + 0.5, 0.08, 0.08, COLORS.COURIER_YELLOW);
  // end: buffer bar + yellow frame the logs hop over
  place(end, endDir, 0.12, 0, 0.78, width + 0.3, 0.1, 0.1, PALETTE.rubber);
  for (const s of [-1, 1]) place(end, endDir, 0.12, s * (half + 0.02), 0.74, 0.1, 0.6, 0.1, COLORS.COURIER_YELLOW);
  const m = b.mesh();
  root.add(m);
  return { root };
}

export const ridgeMachineCatalog: Record<string, () => THREE.Object3D> = {
  treeFeller: () => createTreeFeller().root,
  cashTower: () => createCashTower([3.3, 3.6, 3.9, 4.2]).root,
};
