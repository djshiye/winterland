/**
 * [B6 — machines] AssetFactory: the giant log, the drop-zone slab and every machine.
 *
 * Art spec:
 * - GIANT LOG: cylinder r 1.8, length 12 in LOG_BARK along local Z; END CAPS r 1.65 in LOG_CORE with 3
 *   concentric darker rings; a lighter yellow CUT BAND (LOG_CUT_BAND #F7D070) around the trunk at the
 *   active chopping section (a fresh notch the axe is biting into).
 * - DROP-ZONE SLAB: DROP_ZONE_GREY (#8E969E) slab with a DROP_ZONE_BORDER (#D6DCDF) rim.
 * - HARVESTER: two dark-steel rails parallel to the log; a blue (MACHINE_BLUE) boxy chassis sliding on
 *   them; two hinged blue boom arms ending in a spinning circular saw with teeth (MACHINE_STEEL disc,
 *   SAW_GLOW accents); continuous LOG_CORE chip particles come from the station, not the model.
 * - PROCESSOR: blue tunnel box 1.6 (X) × 1.5 (high) × 1.4 (Z) with dark openings on both ends (−X in,
 *   +X out) and hazard stripes / louver slats; a wooden output workbench in FENCE_WOOD.
 * - ROLLER CONVEYOR: steel side rails with closely spaced dark grey roller cylinders (one InstancedMesh so
 *   they spin); follows a waypoint spline through `path` (rounded corners, see stations/beltPath.ts).
 * - MEGA SAW (phase 5): steel gantry over the river, giant toothed blade on a plunging carriage,
 *   MACHINE_BLUE housings, SAW_GLOW accents.
 *
 * Everything is built from compound primitives with toon() materials; geometry is cached (geo.* or
 * module-level maps), nothing here touches the scene or GameContext.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, LAYOUT, PALETTE, type XZ } from '../config';
import { geo, mesh, toon, toonUnique } from '../render/materials';
import { BeltPath, type BeltSample } from '../stations/beltPath';

// ---------------------------------------------------------------------------
// small construction helpers
// ---------------------------------------------------------------------------

type Color = number;

/** Add a box mesh centred at (x, y, z). */
function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: Color,
  x = 0,
  y = 0,
  z = 0,
  cast = true,
): THREE.Mesh {
  const m = mesh(geo.box(w, h, d), toon(color), { cast });
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Add a cylinder whose axis points along `axis` ('x' | 'y' | 'z'). */
function addCyl(
  parent: THREE.Object3D,
  r: number,
  len: number,
  color: Color,
  axis: 'x' | 'y' | 'z',
  x = 0,
  y = 0,
  z = 0,
  seg = 16,
): THREE.Mesh {
  const m = mesh(geo.cylinder(r, r, len, seg), toon(color));
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  else if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Deterministic pseudo random in [0,1) (so the log looks the same every run). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface BoxPart {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

/** Merge many boxes into one geometry (static, one draw call). */
function mergeBoxes(parts: readonly BoxPart[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    q.setFromAxisAngle(up, p.yaw ?? 0);
    m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m4);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

// ---------------------------------------------------------------------------
// Toothed saw blade (shared by the harvester and the mega saw)
// ---------------------------------------------------------------------------

const bladeGeoCache = new Map<string, THREE.BufferGeometry>();

/** Toothed disc profile in the XY plane, extruded `thickness` along Z (centred on z = 0). */
function sawDiscGeometry(radius: number, teeth: number, thickness: number): THREE.BufferGeometry {
  const key = `${radius}|${teeth}|${thickness}`;
  let g = bladeGeoCache.get(key);
  if (g) return g;
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  const rIn = radius * 0.86;
  let first = true;
  const pt = (r: number, a: number): void => {
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (first) {
      shape.moveTo(x, y);
      first = false;
    } else shape.lineTo(x, y);
  };
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    pt(rIn, a0);
    pt(radius, a0 + step * 0.7);
    pt(rIn * 0.98, a0 + step * 0.76);
  }
  shape.closePath();
  g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -thickness / 2);
  bladeGeoCache.set(key, g);
  return g;
}

/**
 * Circular saw: steel toothed disc, dark flange, bolts and a SAW_GLOW hub + accent ring.
 * Axis along local Z; spin it with `rotation.z`.
 */
export function createSawBlade(radius: number, teeth: number, thickness: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(sawDiscGeometry(radius, teeth, thickness), toon(COLORS.MACHINE_STEEL)));
  // dark flange both sides
  addCyl(g, radius * 0.56, thickness + 0.04, PALETTE.metalDark, 'z', 0, 0, 0, 20);
  // glowing accent ring on the disc
  const ring = mesh(geo.torus(radius * 0.74, radius * 0.03, 5, 36), toon(COLORS.SAW_GLOW));
  ring.scale.z = 0.8;
  g.add(ring);
  // hub
  addCyl(g, radius * 0.22, thickness + 0.1, COLORS.SAW_GLOW, 'z', 0, 0, 0, 14);
  // bolts
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    addCyl(g, radius * 0.06, thickness + 0.08, PALETTE.rubber, 'z', Math.cos(a) * radius * 0.4, Math.sin(a) * radius * 0.4, 0, 8);
  }
  return g;
}

// ---------------------------------------------------------------------------
// GIANT LOG
// ---------------------------------------------------------------------------

export interface GiantLogModel {
  /** Origin = log centre (placed at LAYOUT.giantLog x/y/z); the trunk lies along local Z. */
  root: THREE.Group;
  /** Bobbing / rolling / wobbling parts (everything except the foam). */
  body: THREE.Group;
  /** The LOG_CUT_BAND notch (groove + chamfers); local Z = chopping section. */
  cutBand: THREE.Group;
  /** Unique (flashable) material of the cut band: animate emissiveIntensity. */
  cutMaterial: THREE.MeshToonMaterial;
  /** Local Z of the chopping section (cutZ − log z). */
  cutLocalZ: number;
  /** A thin LOG_CUT_BAND ring the harvester drags along the trunk while it saws (hidden by default). */
  sawMark: THREE.Mesh;
  /** Foam outline at the waterline (a child of root, so it does not bob with the body). */
  foam: THREE.Group;
}

const BAND_HALF = 0.5;
const GROOVE_R = 1.66;

export function createGiantLog(): GiantLogModel {
  const g = LAYOUT.giantLog;
  const R = g.radius;
  const half = g.length / 2;
  const cutZ = g.cutZ - g.z;
  const SEG = 28;

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const barkMat = toon(COLORS.LOG_BARK);
  const cutMaterial = toonUnique(COLORS.LOG_CUT_BAND, { emissive: COLORS.SNOW_WHITE, emissiveIntensity: 0 });

  /** Cylinder piece along Z from z0 to z1, radius rA at z0 and rB at z1. */
  const piece = (z0: number, z1: number, rA: number, rB: number, mat: THREE.Material): THREE.Mesh => {
    const m = mesh(geo.cylinder(rB, rA, z1 - z0, SEG), mat);
    m.rotation.x = Math.PI / 2;
    m.position.z = (z0 + z1) / 2;
    return m;
  };

  // trunk in two halves around the notch
  body.add(piece(-half, cutZ - BAND_HALF, R, R, barkMat));
  body.add(piece(cutZ + BAND_HALF, half, R, R, barkMat));

  // the cut band: a recessed yellow groove with chamfered flanks (the axe bites into it)
  const cutBand = new THREE.Group();
  cutBand.add(
    piece(cutZ - BAND_HALF, cutZ - BAND_HALF + 0.2, R, GROOVE_R, cutMaterial),
    piece(cutZ - BAND_HALF + 0.2, cutZ + BAND_HALF - 0.2, GROOVE_R, GROOVE_R, cutMaterial),
    piece(cutZ + BAND_HALF - 0.2, cutZ + BAND_HALF, GROOVE_R, R, cutMaterial),
  );
  body.add(cutBand);

  // saw mark (harvester)
  const sawMark = mesh(geo.cylinder(R + 0.03, R + 0.03, 0.2, SEG), toon(COLORS.LOG_CUT_BAND));
  sawMark.rotation.x = Math.PI / 2;
  sawMark.visible = false;
  body.add(sawMark);

  // end caps r 1.65 in LOG_CORE with 3 darker rings + pith + cracks
  const capMat = toon(COLORS.LOG_CORE);
  const ringMat = toon(PALETTE.woodRing);
  for (const sgn of [1, -1]) {
    const cap = mesh(geo.cylinder(g.capRadius, g.capRadius, 0.04, 36), capMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = sgn * (half + 0.01);
    body.add(cap);
    const zf = sgn * (half + 0.035);
    for (const rr of [1.36, 0.9, 0.46]) {
      const ring = mesh(geo.torus(rr, 0.04, 5, 40), ringMat, { receive: false });
      ring.scale.z = 0.5;
      ring.position.z = zf;
      body.add(ring);
    }
    const pith = mesh(geo.cylinder(0.11, 0.11, 0.05, 12), ringMat);
    pith.rotation.x = Math.PI / 2;
    pith.position.z = zf;
    body.add(pith);
    for (let i = 0; i < 3; i++) {
      const a = 0.7 + i * 2.1;
      const crack = mesh(geo.box(0.05, 0.62, 0.03), ringMat, { cast: false });
      crack.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, zf);
      crack.rotation.z = a - Math.PI / 2;
      body.add(crack);
    }
  }

  // bark ridges (deterministic scatter), knots, branch stubs and snow patches
  const rnd = lcg(7);
  const ridgeMat = toon(PALETTE.barkDark);
  for (let i = 0; i < 16; i++) {
    const len = 1.8 + rnd() * 3.2;
    const zc = -half + 0.8 + rnd() * (g.length - 1.6);
    if (Math.abs(zc - cutZ) < len / 2 + BAND_HALF + 0.1) continue;
    const pivot = new THREE.Group();
    pivot.rotation.z = rnd() * Math.PI * 2;
    const ridge = mesh(geo.box(0.12, 0.34, len), ridgeMat);
    ridge.position.set(R, 0, zc);
    pivot.add(ridge);
    body.add(pivot);
  }
  for (let i = 0; i < 5; i++) {
    const zc = -half + 1 + rnd() * (g.length - 2);
    if (Math.abs(zc - cutZ) < 1.1) continue;
    const pivot = new THREE.Group();
    pivot.rotation.z = (rnd() * 0.6 - 0.1) * Math.PI;
    const knot = mesh(geo.dodecahedron(0.24, 0), ridgeMat);
    knot.scale.set(0.7, 1, 1);
    knot.position.set(R, 0, zc);
    pivot.add(knot);
    body.add(pivot);
  }
  for (const [zc, ang] of [[-3.4, 0.15], [-0.6, 0.55], [1.4, 0.1]] as const) {
    const pivot = new THREE.Group();
    pivot.rotation.z = ang;
    const stub = mesh(geo.cone(0.2, 0.45, 8), barkMat);
    stub.rotation.z = -Math.PI / 2;
    stub.position.set(R + 0.14, 0, zc);
    pivot.add(stub);
    body.add(pivot);
  }
  const snowMat = toon(COLORS.SNOW_WHITE);
  for (const [zc, len, w] of [[-4.6, 1.5, 0.6], [-2.2, 2.0, 0.7], [0.4, 1.4, 0.5], [-5.5, 0.8, 0.45]] as const) {
    const s = mesh(geo.sphere(1, 12, 6), snowMat);
    s.scale.set(w, 0.16, len);
    s.position.set(0.1, R - 0.02, zc);
    body.add(s);
  }

  // foam ring at the waterline (stadium outline hugging the trunk)
  const foam = new THREE.Group();
  const waterLocalY = LAYOUT.river.waterY - g.y + 0.025;
  const mkFoam = (outerW: number, outerD: number, innerW: number, innerD: number, color: Color, opacity: number, yOff: number): void => {
    const ringMesh = new THREE.Mesh(foamGeometry(outerW, outerD, innerW, innerD), foamMaterial(color, opacity));
    ringMesh.position.y = waterLocalY + yOff;
    ringMesh.receiveShadow = false;
    ringMesh.castShadow = false;
    ringMesh.renderOrder = 2;
    foam.add(ringMesh);
  };
  mkFoam(2 * R + 1.1, g.length + 1.1, 2 * R - 0.2, g.length - 0.2, COLORS.RIVER_FOAM, 0.8, 0);
  mkFoam(2 * R + 0.5, g.length + 0.5, 2 * R - 0.2, g.length - 0.2, COLORS.SNOW_WHITE, 0.65, 0.01);
  root.add(foam);

  return { root, body, cutBand, cutMaterial, cutLocalZ: cutZ, sawMark, foam };
}

const foamGeoCache = new Map<string, THREE.BufferGeometry>();
const foamMatCache = new Map<string, THREE.MeshBasicMaterial>();

function foamMaterial(color: Color, opacity: number): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}`;
  let m = foamMatCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    foamMatCache.set(key, m);
  }
  return m;
}

function roundedRect(p: THREE.Path, hw: number, hd: number, r: number): void {
  p.moveTo(-hw + r, -hd);
  p.lineTo(hw - r, -hd);
  p.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  p.lineTo(hw, hd - r);
  p.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  p.lineTo(-hw + r, hd);
  p.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(-hw, -hd + r);
  p.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
}

/** Flat rounded-rectangle ring in the XZ plane (facing up). */
function foamGeometry(outerW: number, outerD: number, innerW: number, innerD: number): THREE.BufferGeometry {
  const key = `${outerW}|${outerD}|${innerW}|${innerD}`;
  let g = foamGeoCache.get(key);
  if (g) return g;
  const shape = new THREE.Shape();
  roundedRect(shape, outerW / 2, outerD / 2, 0.7);
  const hole = new THREE.Path();
  roundedRect(hole, innerW / 2, innerD / 2, 0.1);
  shape.holes.push(hole);
  g = new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2);
  foamGeoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------
// DROP-ZONE SLAB
// ---------------------------------------------------------------------------

/** Slab top height; the log pile's base plane. */
const SLAB_TOP = 0.08;

/** Origin = floor centre. Grey slab (top at 0.08) with a raised light-grey rim. */
export function createDropZoneSlab(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const rim = 0.16;
  // light base plate (shows as a thin bevel around the grey top)
  addBox(g, w, 0.05, d, COLORS.DROP_ZONE_BORDER, 0, 0.025, 0, false);
  // grey top
  addBox(g, w - rim * 2, SLAB_TOP - 0.02, d - rim * 2, COLORS.DROP_ZONE_GREY, 0, (SLAB_TOP + 0.02) / 2 + 0.005, 0, false);
  // raised rim
  const rimH = 0.13;
  addBox(g, w, rimH, rim, COLORS.DROP_ZONE_BORDER, 0, rimH / 2, d / 2 - rim / 2);
  addBox(g, w, rimH, rim, COLORS.DROP_ZONE_BORDER, 0, rimH / 2, -d / 2 + rim / 2);
  addBox(g, rim, rimH, d - rim * 2, COLORS.DROP_ZONE_BORDER, w / 2 - rim / 2, rimH / 2, 0);
  addBox(g, rim, rimH, d - rim * 2, COLORS.DROP_ZONE_BORDER, -w / 2 + rim / 2, rimH / 2, 0);
  // corner bolts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addCyl(g, 0.06, 0.03, PALETTE.metalDark, 'y', sx * (w / 2 - rim / 2), rimH + 0.012, sz * (d / 2 - rim / 2), 8);
    }
  }
  // painted log-stack hint: three little bars on the +Z rim
  for (let i = -1; i <= 1; i++) {
    addBox(g, 0.34, 0.012, 0.05, COLORS.DROP_ZONE_BORDER, i * 0.5, SLAB_TOP + 0.002, d / 2 - rim - 0.12, false);
  }
  return g;
}

// ---------------------------------------------------------------------------
// HARVESTER
// ---------------------------------------------------------------------------

export interface HarvesterModel {
  /** Origin: floor, centred on the rail run (X = rail line, Z = middle of the rails). Rails + sleepers. */
  root: THREE.Group;
  /** Slides along the rails (local Z); contains cab, booms and saw. */
  chassis: THREE.Group;
  /** Spinning blade (spin about its local Z axis). */
  saw: THREE.Object3D;
  /** Rotating beacon on the cab roof. */
  beacon: THREE.Object3D;
  /** Chassis-space centre of the saw hub (set via setBoom). */
  sawHead: THREE.Group;
  /** Position the saw hub at (x, y) in chassis space (X negative = toward the log); poses both booms (2-link IK). */
  setBoom(x: number, y: number): void;
  /** Rest saw-hub position (chassis space). */
  readonly restReach: { x: number; y: number };
}

const HV_UPPER = 1.3;
const HV_FORE = 1.5;
const HV_SHOULDER = { x: -0.45, y: 1.05 };
const HV_FORK_Z = 0.72;
const HV_SAW_R = 0.98;

export function createHarvester(railLength: number): HarvesterModel {
  const root = new THREE.Group();
  const railX = 0.68;

  // --- rails + sleepers + buffers (static) ---
  for (const sx of [-1, 1]) {
    addBox(root, 0.14, 0.14, railLength + 0.2, PALETTE.metalDark, sx * railX, 0.21, 0);
    addBox(root, 0.08, 0.04, railLength + 0.2, COLORS.MACHINE_STEEL, sx * railX, 0.29, 0, false);
  }
  const sleeperPartsLen = Math.floor(railLength / 0.5);
  for (let i = 0; i <= sleeperPartsLen; i++) {
    const z = -railLength / 2 + 0.1 + i * ((railLength - 0.2) / sleeperPartsLen);
    addBox(root, 1.9, 0.1, 0.22, PALETTE.trunk, 0, 0.05, z);
  }
  for (const sz of [-1, 1]) {
    addBox(root, 1.5, 0.4, 0.18, PALETTE.accent, 0, 0.3, sz * (railLength / 2 + 0.2));
    addBox(root, 1.5, 0.1, 0.2, PALETTE.rubber, 0, 0.16, sz * (railLength / 2 + 0.2), false);
  }

  // --- chassis ---
  const chassis = new THREE.Group();
  root.add(chassis);
  // wheels + bogie bars
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = addCyl(chassis, 0.2, 0.16, PALETTE.metalDark, 'x', sx * railX, 0.4, sz * 0.52, 14);
      wheel.castShadow = true;
      addCyl(chassis, 0.08, 0.2, PALETTE.accent, 'x', sx * railX, 0.4, sz * 0.52, 8);
    }
    addBox(chassis, 0.22, 0.14, 1.45, PALETTE.metalDark, sx * railX, 0.6, 0);
  }
  // deck + underframe
  addBox(chassis, 1.9, 0.14, 1.7, PALETTE.machineDark, 0, 0.7, 0);
  addBox(chassis, 1.8, 0.4, 1.6, COLORS.MACHINE_BLUE, 0, 0.97, 0);
  // front hood (toward the log) between the boom mounts
  addBox(chassis, 0.7, 0.34, 1.0, COLORS.MACHINE_BLUE, -0.45, 1.34, 0);
  // cab at the rear (+X)
  addBox(chassis, 0.9, 0.78, 1.15, COLORS.MACHINE_BLUE, 0.4, 1.57, 0);
  addBox(chassis, 1.0, 0.08, 1.25, PALETTE.machineDark, 0.4, 2.0, 0);
  // windows (dark glass) on the +X and ±Z faces
  addBox(chassis, 0.04, 0.4, 0.8, PALETTE.rubber, 0.86, 1.67, 0, false);
  addBox(chassis, 0.6, 0.38, 0.04, PALETTE.rubber, 0.35, 1.67, 0.59, false);
  addBox(chassis, 0.6, 0.38, 0.04, PALETTE.rubber, 0.35, 1.67, -0.59, false);
  // exhaust + beacon
  addCyl(chassis, 0.07, 0.5, COLORS.MACHINE_STEEL, 'y', 0.7, 2.3, -0.42, 10);
  const beacon = new THREE.Group();
  beacon.position.set(0.4, 2.09, 0);
  const lamp = mesh(geo.sphere(0.14, 10, 8), toon(COLORS.SAW_GLOW));
  lamp.position.y = 0.1;
  beacon.add(lamp);
  addBox(beacon, 0.34, 0.04, 0.05, COLORS.COURIER_YELLOW, 0, 0.1, 0, false);
  chassis.add(beacon);
  // ladder-ish side detail: hazard strip on the deck edge
  for (let i = 0; i < 6; i++) {
    addBox(chassis, 0.2, 0.2, 0.03, i % 2 === 0 ? PALETTE.accent : PALETTE.rubber, -0.7 + i * 0.28, 0.97, 0.82, false);
  }
  // shoulder mounts (steel brackets)
  const upperGroups: THREE.Group[] = [];
  const foreGroups: THREE.Group[] = [];
  for (const sz of [-1, 1]) {
    const z = sz * HV_FORK_Z;
    addBox(chassis, 0.4, 0.5, 0.2, PALETTE.metalDark, HV_SHOULDER.x, HV_SHOULDER.y - 0.2, z);
    const upper = new THREE.Group();
    upper.position.set(HV_SHOULDER.x, HV_SHOULDER.y, z);
    addBox(upper, HV_UPPER, 0.26, 0.2, COLORS.MACHINE_BLUE, HV_UPPER / 2, 0, 0);
    addCyl(upper, 0.17, 0.26, COLORS.MACHINE_STEEL, 'z', 0, 0, 0, 12);
    const fore = new THREE.Group();
    fore.position.set(HV_UPPER, 0, 0);
    addBox(fore, HV_FORE, 0.22, 0.18, COLORS.MACHINE_BLUE, HV_FORE / 2, 0, 0);
    addCyl(fore, 0.15, 0.3, COLORS.MACHINE_STEEL, 'z', 0, 0, 0, 12);
    // glowing accent stripe along the forearm
    addBox(fore, HV_FORE * 0.6, 0.05, 0.2, COLORS.SAW_GLOW, HV_FORE * 0.45, 0.1, 0, false);
    upper.add(fore);
    chassis.add(upper);
    upperGroups.push(upper);
    foreGroups.push(fore);
  }

  // --- saw head ---
  const sawHead = new THREE.Group();
  chassis.add(sawHead);
  addCyl(sawHead, 0.1, HV_FORK_Z * 2 + 0.3, COLORS.MACHINE_STEEL, 'z', 0, 0, 0, 10);
  for (const sz of [-1, 1]) addBox(sawHead, 0.34, 0.34, 0.16, PALETTE.machineDark, 0, 0, sz * HV_FORK_Z);
  const saw = createSawBlade(HV_SAW_R, 14, 0.12);
  sawHead.add(saw);

  const restReach = { x: -2.42, y: 1.1 };
  const setBoom = (x: number, y: number): void => {
    const dx = x - HV_SHOULDER.x;
    const dy = y - HV_SHOULDER.y;
    let d = Math.hypot(dx, dy);
    const dMax = HV_UPPER + HV_FORE - 0.02;
    const dMin = Math.abs(HV_UPPER - HV_FORE) + 0.05;
    const k = d > dMax ? dMax / d : d < dMin ? dMin / Math.max(d, 1e-4) : 1;
    d *= k;
    const hx = HV_SHOULDER.x + dx * k;
    const hy = HV_SHOULDER.y + dy * k;
    const alpha = Math.atan2(dy, dx);
    const cosB = (HV_UPPER * HV_UPPER + d * d - HV_FORE * HV_FORE) / (2 * HV_UPPER * d);
    const beta = Math.acos(Math.max(-1, Math.min(1, cosB)));
    const phi1 = alpha - beta;
    const ex = HV_SHOULDER.x + Math.cos(phi1) * HV_UPPER;
    const ey = HV_SHOULDER.y + Math.sin(phi1) * HV_UPPER;
    const phi2 = Math.atan2(hy - ey, hx - ex);
    for (let i = 0; i < 2; i++) {
      upperGroups[i]!.rotation.z = phi1;
      foreGroups[i]!.rotation.z = phi2 - phi1;
    }
    sawHead.position.set(hx, hy, 0);
  };
  setBoom(restReach.x, restReach.y);

  return { root, chassis, saw, beacon, sawHead, setBoom, restReach };
}

// ---------------------------------------------------------------------------
// PROCESSOR
// ---------------------------------------------------------------------------

export interface ProcessorModel {
  /** Origin = floor under the machine body centre (LAYOUT.processor x/z). Holds body, tray, bench. */
  root: THREE.Group;
  /** The blue tunnel shell (squash target; origin at its floor centre). */
  body: THREE.Group;
  /** Infeed tray (steel). */
  tray: THREE.Group;
  /** Wooden output workbench. */
  bench: THREE.Group;
  /** Status lamp material (emissiveIntensity animates: lit while processing). */
  lampMaterial: THREE.MeshToonMaterial;
  /** Local points: tunnel intake / exit centres and the chimney mouth. */
  intake: THREE.Vector3;
  exit: THREE.Vector3;
  chimney: THREE.Vector3;
}

export function createProcessor(): ProcessorModel {
  const P = LAYOUT.processor;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const W = P.w;
  const H = P.h;
  const D = P.d;
  const FLOOR = 0.35;
  const CEIL = H - 0.35;
  const WALL = 0.16;
  const blue = COLORS.MACHINE_BLUE;

  // skid plate
  addBox(body, W + 0.14, 0.08, D + 0.14, PALETTE.metalDark, 0, 0.04, 0);
  // shell around the tunnel: floor, ceiling, two side walls
  addBox(body, W, FLOOR - 0.08, D, blue, 0, 0.08 + (FLOOR - 0.08) / 2, 0);
  addBox(body, W, H - CEIL, D, blue, 0, CEIL + (H - CEIL) / 2, 0);
  for (const sz of [-1, 1]) addBox(body, W, CEIL - FLOOR, WALL, blue, 0, (CEIL + FLOOR) / 2, sz * (D / 2 - WALL / 2));
  // dark liner seen through the two openings
  const liner = mesh(geo.box(W - 0.04, CEIL - FLOOR - 0.02, D - WALL * 2 - 0.02), toon(PALETTE.rubber, { side: THREE.BackSide }), {
    cast: false,
  });
  liner.position.y = (CEIL + FLOOR) / 2;
  body.add(liner);
  // portal frames (darker blue) around both openings
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.012);
    addBox(body, 0.05, 0.1, D - WALL * 2 + 0.2, PALETTE.machineDark, x, CEIL - 0.05, 0, false);
    addBox(body, 0.05, 0.1, D - WALL * 2 + 0.2, PALETTE.machineDark, x, FLOOR + 0.05, 0, false);
    for (const sz of [-1, 1]) addBox(body, 0.05, CEIL - FLOOR, 0.1, PALETTE.machineDark, x, (CEIL + FLOOR) / 2, sz * (D / 2 - WALL - 0.05), false);
  }
  // hazard stripes along the lower +Z/-Z faces
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const s = addBox(body, 0.13, 0.3, 0.025, i % 2 === 0 ? PALETTE.accent : PALETTE.rubber, -0.66 + i * 0.19, 0.2, sz * (D / 2 + 0.012), false);
      s.rotation.z = 0.55;
    }
  }
  // louver slats on the side walls
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      addBox(body, 1.1, 0.06, 0.06, PALETTE.machineDark, 0, 0.55 + i * 0.16, sz * (D / 2 + 0.02), false);
    }
  }
  // roof louvers + chimney + status lamp
  for (let i = 0; i < 5; i++) addBox(body, 0.7, 0.04, 0.07, PALETTE.machineDark, 0.25, H + 0.02, -0.4 + i * 0.2, false);
  const chimneyX = -0.45;
  const chimneyZ = -0.42;
  addCyl(body, 0.11, 0.5, COLORS.MACHINE_STEEL, 'y', chimneyX, H + 0.25, chimneyZ, 12);
  addCyl(body, 0.15, 0.08, PALETTE.metalDark, 'y', chimneyX, H + 0.52, chimneyZ, 12);
  addBox(body, 0.34, 0.2, 0.34, PALETTE.machineDark, 0.5, H + 0.1, 0.4);
  const lampMaterial = toonUnique(COLORS.SAW_GLOW, { emissive: COLORS.SAW_GLOW, emissiveIntensity: 0 });
  const lamp = mesh(geo.sphere(0.12, 10, 8), lampMaterial);
  lamp.position.set(0.5, H + 0.28, 0.4);
  body.add(lamp);
  // control panel on the +Z wall
  addBox(body, 0.34, 0.22, 0.05, PALETTE.rubber, 0.55, 1.2, D / 2 + 0.035, false);
  addBox(body, 0.1, 0.1, 0.04, COLORS.SAW_GLOW, 0.5, 1.2, D / 2 + 0.07, false);
  addBox(body, 0.1, 0.1, 0.04, COLORS.CASH_GREEN, 0.64, 1.2, D / 2 + 0.07, false);

  // --- infeed tray (steel) ---
  const hp = P.hopper;
  const tray = new THREE.Group();
  tray.position.set(hp.x - P.x, 0, hp.z - P.z);
  addBox(tray, hp.w, hp.h - 0.1, hp.d, COLORS.MACHINE_STEEL, 0, (hp.h - 0.1) / 2, 0);
  addBox(tray, hp.w, 0.1, hp.d, PALETTE.metalDark, 0, hp.h - 0.05, 0);
  for (const sz of [-1, 1]) addBox(tray, hp.w, 0.2, 0.07, COLORS.MACHINE_STEEL, 0, hp.h + 0.1, sz * (hp.d / 2 - 0.035));
  addBox(tray, 0.07, 0.2, hp.d, COLORS.MACHINE_STEEL, -hp.w / 2 + 0.035, hp.h + 0.1, 0);
  // ramp plate bridging tray and tunnel
  addBox(tray, 0.3, 0.05, hp.d - 0.2, PALETTE.metalDark, hp.w / 2 + 0.05, hp.h - 0.06, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(tray, 0.16, 0.06, 0.16, PALETTE.rubber, sx * (hp.w / 2 - 0.1), 0.03, sz * (hp.d / 2 - 0.1), false);
  root.add(tray);

  // --- output workbench (FENCE_WOOD) ---
  const ot = P.outputTable;
  const bench = new THREE.Group();
  bench.position.set(ot.x - P.x, 0, ot.z - P.z);
  addBox(bench, ot.w, 0.12, ot.d, COLORS.FENCE_WOOD, 0, ot.h - 0.06, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(bench, 0.13, ot.h - 0.12, 0.13, PALETTE.fenceDark, sx * (ot.w / 2 - 0.1), (ot.h - 0.12) / 2, sz * (ot.d / 2 - 0.1));
  for (const sz of [-1, 1]) addBox(bench, ot.w - 0.3, 0.1, 0.07, PALETTE.fenceDark, 0, ot.h - 0.2, sz * (ot.d / 2 - 0.1));
  for (const sx of [-1, 1]) addBox(bench, 0.07, 0.1, ot.d - 0.3, PALETTE.fenceDark, sx * (ot.w / 2 - 0.1), ot.h - 0.2, 0);
  // low rim so crates don't look like they are sliding off
  for (const sz of [-1, 1]) addBox(bench, ot.w, 0.05, 0.06, PALETTE.fenceDark, 0, ot.h + 0.025, sz * (ot.d / 2 - 0.03), false);
  addBox(bench, 0.06, 0.05, ot.d, PALETTE.fenceDark, ot.w / 2 - 0.03, ot.h + 0.025, 0, false);
  root.add(bench);

  return {
    root,
    body,
    tray,
    bench,
    lampMaterial,
    intake: new THREE.Vector3(-W / 2, 0.58, 0),
    exit: new THREE.Vector3(W / 2, 0.58, 0),
    chimney: new THREE.Vector3(chimneyX, H + 0.6, chimneyZ),
  };
}

// ---------------------------------------------------------------------------
// ROLLER CONVEYOR
// ---------------------------------------------------------------------------

export interface RollerConveyorModel {
  root: THREE.Group;
  /** The waypoint spline the rollers / rails follow. */
  path: BeltPath;
  /** Rails + legs per ~1 m segment, in travel order (pop in one after another). */
  segments: THREE.Group[];
  /** All rollers (one InstancedMesh). */
  rollers: THREE.InstancedMesh;
  /** Roller radius (spin speed = belt speed / radius). */
  rollerRadius: number;
  /**
   * Re-write the roller matrices: every roller rotated by `spin` radians about its axle; `segmentScale[i]`
   * (optional) scales the rollers of segment i (pop-in).
   */
  setRollers(spin: number, segmentScale?: ArrayLike<number>): void;
}

const ROLLER_R = 0.07;
const ROLLER_PITCH = 0.16;
const SEGMENT_LEN = 1.0;

const rollerGeoCache = new Map<number, THREE.BufferGeometry>();
function rollerGeometry(len: number): THREE.BufferGeometry {
  const cached = rollerGeoCache.get(len);
  if (cached) return cached;
  // 8-sided prism with a ridge so the spin is readable under cel shading
  const body = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, len, 8).rotateZ(Math.PI / 2);
  const ridge = new THREE.BoxGeometry(len, 0.035, 0.05).translate(0, ROLLER_R, 0);
  const axle = new THREE.CylinderGeometry(0.025, 0.025, len + 0.06, 6).rotateZ(Math.PI / 2);
  const merged = mergeGeometries([body, ridge, axle], false);
  body.dispose();
  ridge.dispose();
  axle.dispose();
  rollerGeoCache.set(len, merged);
  return merged;
}

export function createRollerConveyor(waypoints: readonly XZ[], width: number, beltY: number): RollerConveyorModel {
  const path = new BeltPath(waypoints);
  const root = new THREE.Group();
  const total = path.length;
  const nSeg = Math.max(1, Math.round(total / SEGMENT_LEN));
  const segLen = total / nSeg;
  const sm = BeltPath.makeSample();
  const half = width / 2 + 0.045;
  const railMat = toon(COLORS.MACHINE_STEEL);
  const legMat = toon(PALETTE.metalDark);
  const deckMat = toon(PALETTE.rubber);
  const railH = 0.24;
  const legH = beltY - 0.2;

  const segments: THREE.Group[] = [];
  for (let i = 0; i < nSeg; i++) {
    const s0 = i * segLen;
    const s1 = (i + 1) * segLen;
    path.sample((s0 + s1) / 2, sm);
    const ox = sm.x;
    const oz = sm.z;
    const seg = new THREE.Group();
    seg.position.set(ox, 0, oz);
    const rails: BoxPart[] = [];
    const legs: BoxPart[] = [];
    const deck: BoxPart[] = [];
    const steps = Math.max(1, Math.ceil(segLen / 0.4));
    const a = new THREE.Vector2();
    const b = new THREE.Vector2();
    for (let k = 0; k < steps; k++) {
      const sa = s0 + (k / steps) * segLen;
      const sb = s0 + ((k + 1) / steps) * segLen;
      path.sample(sa, sm);
      const ax = sm.x;
      const az = sm.z;
      const nax = sm.dz;
      const naz = -sm.dx;
      path.sample(sb, sm);
      const bx = sm.x;
      const bz = sm.z;
      const nbx = sm.dz;
      const nbz = -sm.dx;
      const mx = (ax + bx) / 2 - ox;
      const mz = (az + bz) / 2 - oz;
      const chordLen = Math.hypot(bx - ax, bz - az) + 0.03;
      const yaw = Math.atan2(bx - ax, bz - az);
      deck.push({ w: width, h: 0.04, d: chordLen, x: mx, y: beltY - 0.17, z: mz, yaw });
      for (const side of [-1, 1]) {
        a.set(ax + nax * half * side - ox, az + naz * half * side - oz);
        b.set(bx + nbx * half * side - ox, bz + nbz * half * side - oz);
        rails.push({
          w: 0.09,
          h: railH,
          d: a.distanceTo(b) + 0.03,
          x: (a.x + b.x) / 2,
          y: beltY - railH / 2 + 0.03,
          z: (a.y + b.y) / 2,
          yaw: Math.atan2(b.x - a.x, b.y - a.y),
        });
      }
    }
    // legs: one pair near the middle of every second segment, plus the very ends
    if (i % 2 === 0 || i === nSeg - 1) {
      path.sample((s0 + s1) / 2, sm);
      for (const side of [-1, 1]) {
        const lx = sm.x + sm.dz * half * side - ox;
        const lz = sm.z - sm.dx * half * side - oz;
        legs.push({ w: 0.09, h: legH, d: 0.09, x: lx, y: legH / 2, z: lz, yaw: sm.yaw });
        legs.push({ w: 0.24, h: 0.04, d: 0.24, x: lx, y: 0.02, z: lz, yaw: sm.yaw });
      }
      legs.push({ w: width + 0.2, h: 0.06, d: 0.07, x: 0, y: beltY - 0.27, z: 0, yaw: sm.yaw });
    }
    const addMerged = (parts: BoxPart[], mat: THREE.Material): void => {
      const g = mergeBoxes(parts);
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      seg.add(m);
    };
    addMerged(rails, railMat);
    addMerged(legs, legMat);
    addMerged(deck, deckMat);
    segments.push(seg);
  }

  // drive motor at the start (blue housing + glow light) on the left side of the first segment
  {
    path.sample(0.35, sm);
    const seg0 = segments[0]!;
    const off = half + 0.28;
    const mx = sm.x + sm.dz * off - seg0.position.x;
    const mz = sm.z - sm.dx * off - seg0.position.z;
    const motor = new THREE.Group();
    motor.position.set(mx, 0, mz);
    motor.rotation.y = sm.yaw;
    addBox(motor, 0.36, 0.34, 0.5, COLORS.MACHINE_BLUE, 0, beltY - 0.3, 0);
    addBox(motor, 0.2, 0.06, 0.4, PALETTE.machineDark, 0, beltY - 0.09, 0);
    addBox(motor, 0.1, 0.1, 0.1, COLORS.SAW_GLOW, 0, beltY - 0.04, 0.12, false);
    addBox(motor, 0.1, 0.34, 0.1, PALETTE.metalDark, 0, (beltY - 0.3) / 2 - 0.02, -0.12);
    seg0.add(motor);
  }

  // rollers
  const rollerLen = width - 0.02;
  const geometry = rollerGeometry(rollerLen);
  const count = Math.max(1, Math.floor(total / ROLLER_PITCH));
  const rollers = new THREE.InstancedMesh(geometry, toon(PALETTE.metalDark), count);
  rollers.castShadow = true;
  rollers.receiveShadow = true;
  rollers.frustumCulled = false;
  rollers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(rollers);
  const rx = new Float32Array(count);
  const rz = new Float32Array(count);
  const ryq = new Float32Array(count * 4);
  const rseg = new Uint16Array(count);
  const qy = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) * (total / count);
    path.sample(s, sm);
    rx[i] = sm.x;
    rz[i] = sm.z;
    qy.setFromAxisAngle(up, sm.yaw);
    ryq[i * 4] = qy.x;
    ryq[i * 4 + 1] = qy.y;
    ryq[i * 4 + 2] = qy.z;
    ryq[i * 4 + 3] = qy.w;
    rseg[i] = Math.min(nSeg - 1, Math.floor(s / segLen));
  }
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qs = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0);
  const rollerY = beltY - ROLLER_R;
  const setRollers = (spin: number, segmentScale?: ArrayLike<number>): void => {
    qs.setFromAxisAngle(axisX, spin);
    for (let i = 0; i < count; i++) {
      qa.set(ryq[i * 4]!, ryq[i * 4 + 1]!, ryq[i * 4 + 2]!, ryq[i * 4 + 3]!).multiply(qs);
      const k = segmentScale ? Math.max(0.0001, segmentScale[rseg[i]!] ?? 1) : 1;
      pos.set(rx[i]!, rollerY * k, rz[i]!);
      sc.set(k, k, k);
      m4.compose(pos, qa, sc);
      rollers.setMatrixAt(i, m4);
    }
    rollers.instanceMatrix.needsUpdate = true;
  };
  setRollers(0);

  for (const s of segments) root.add(s);
  return { root, path, segments, rollers, rollerRadius: ROLLER_R, setRollers };
}

export type { BeltSample };

// ---------------------------------------------------------------------------
// MEGA SAW
// ---------------------------------------------------------------------------

export interface MegaSawModel {
  /** Origin = (LAYOUT.megaSaw.x, 0, LAYOUT.megaSaw.z). */
  root: THREE.Group;
  /** Moves down/up each cycle (local Y = blade centre height). */
  carriage: THREE.Group;
  blade: THREE.Object3D;
  /** Local Z of the blade plane (inside the log's upstream end). */
  bladeZ: number;
  /** Carriage heights: raised (idle) and fully plunged. */
  restY: number;
  cutY: number;
  /** Re-fit the piston rods to the carriage height (call after moving the carriage). */
  updateRods(): void;
  /** Warning beacons (spin / pulse). */
  beacons: THREE.Object3D[];
}

export function createMegaSaw(bladeRadius: number): MegaSawModel {
  const M = LAYOUT.megaSaw;
  const root = new THREE.Group();
  const BLADE_Z = 0.9;
  const POST_Z = 0.1;
  const yardX = M.base.minX + (M.base.maxX - M.base.minX) / 2 - M.x;
  const baseZ = (M.base.minZ + M.base.maxZ) / 2 - M.z;
  const farX = -3.9;
  const beamY = 6.65;
  const restY = 3.95;
  const cutY = 1.15;
  const blue = COLORS.MACHINE_BLUE;

  // yard-side base (solid) + column
  addBox(root, M.base.maxX - M.base.minX, 1.3, M.base.maxZ - M.base.minZ, blue, yardX, 0.65, baseZ);
  addBox(root, M.base.maxX - M.base.minX + 0.2, 0.18, M.base.maxZ - M.base.minZ + 0.2, PALETTE.metalDark, yardX, 0.09, baseZ);
  addBox(root, 1.85, 0.12, 1.85, PALETTE.machineDark, yardX, 1.36, baseZ, false);
  addBox(root, 0.7, beamY - 1.3, 0.7, COLORS.MACHINE_STEEL, yardX, 1.3 + (beamY - 1.3) / 2, POST_Z);
  // far-bank leg
  addBox(root, 1.3, 0.18, 1.3, PALETTE.metalDark, farX, 0.09, POST_Z);
  addBox(root, 0.9, 0.9, 0.9, blue, farX, 0.63, POST_Z);
  addBox(root, 0.6, beamY - 1.0, 0.6, COLORS.MACHINE_STEEL, farX, 1.0 + (beamY - 1.0) / 2, POST_Z);
  // diagonal braces
  for (const [bx, dir] of [[yardX, -1], [farX, 1]] as const) {
    const len = Math.hypot(1.8, 2.6);
    const brace = addBox(root, 0.2, len, 0.2, PALETTE.metalDark, bx + dir * 0.9, beamY - 1.55, POST_Z);
    brace.rotation.z = -dir * Math.atan2(1.8, 2.6);
  }
  // beam + end housings
  const beamLen = yardX - farX + 0.9;
  addBox(root, beamLen, 0.55, 0.9, COLORS.MACHINE_STEEL, (yardX + farX) / 2, beamY, POST_Z);
  addBox(root, beamLen, 0.1, 1.0, PALETTE.metalDark, (yardX + farX) / 2, beamY + 0.32, POST_Z);
  addBox(root, 1.3, 0.8, 1.2, blue, yardX, beamY + 0.1, POST_Z);
  addBox(root, 1.1, 0.8, 1.2, blue, farX, beamY + 0.1, POST_Z);
  const beacons: THREE.Object3D[] = [];
  for (const bx of [yardX, farX]) {
    const b = new THREE.Group();
    b.position.set(bx, beamY + 0.65, POST_Z);
    const lamp = mesh(geo.sphere(0.2, 10, 8), toon(COLORS.SAW_GLOW));
    b.add(lamp);
    addBox(b, 0.5, 0.05, 0.06, COLORS.COURIER_YELLOW, 0, 0, 0, false);
    root.add(b);
    beacons.push(b);
  }
  // trolley under the beam (blue) with glow stripe
  addBox(root, 1.8, 0.7, 1.1, blue, 0, beamY - 0.62, POST_Z);
  addBox(root, 1.84, 0.1, 1.14, COLORS.SAW_GLOW, 0, beamY - 0.5, POST_Z, false);
  addBox(root, 1.6, 0.14, 1.0, PALETTE.machineDark, 0, beamY - 1.0, POST_Z);
  // vertical guide rails
  for (const sx of [-1, 1]) {
    addBox(root, 0.14, beamY - 1.0 - 0.25, 0.14, PALETTE.metalDark, sx * 0.85, 0.25 + (beamY - 1.25) / 2, POST_Z + 0.55);
    addBox(root, 0.14, beamY - 1.0 - 0.25, 0.14, PALETTE.metalDark, sx * 0.85, 0.25 + (beamY - 1.25) / 2, POST_Z - 0.55);
  }
  addBox(root, 2.1, 0.14, 1.4, PALETTE.metalDark, 0, 0.2, POST_Z, false);

  // carriage: motor housing + yoke + blade
  const carriage = new THREE.Group();
  carriage.position.set(0, restY, 0);
  addBox(carriage, 1.4, 1.2, 0.9, blue, 0, 0, POST_Z);
  addBox(carriage, 1.44, 0.14, 0.94, COLORS.SAW_GLOW, 0, 0.3, POST_Z, false);
  addBox(carriage, 1.2, 0.2, 1.0, PALETTE.machineDark, 0, 0.7, POST_Z);
  for (const sx of [-1, 1]) {
    addBox(carriage, 0.18, 0.7, 1.4, COLORS.MACHINE_STEEL, sx * 0.8, 0, POST_Z);
  }
  addCyl(carriage, 0.22, BLADE_Z - POST_Z + 0.3, COLORS.MACHINE_STEEL, 'z', 0, 0, (BLADE_Z + POST_Z) / 2 - 0.1, 14);
  const blade = createSawBlade(bladeRadius, 34, 0.14);
  blade.position.z = BLADE_Z;
  carriage.add(blade);
  root.add(carriage);

  // piston rods from the carriage top to the trolley bottom
  const rodTop = beamY - 1.07;
  const rods: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const rod = addCyl(root, 0.1, 1, COLORS.MACHINE_STEEL, 'y', sx * 0.4, 0, POST_Z, 10);
    rods.push(rod);
  }
  const updateRods = (): void => {
    const bottom = carriage.position.y + 0.7;
    const len = Math.max(0.05, rodTop - bottom);
    for (const r of rods) {
      r.scale.y = len;
      r.position.y = bottom + len / 2;
    }
  };
  updateRods();

  return { root, carriage, blade, bladeZ: BLADE_Z, restY, cutY, updateRods, beacons };
}

// ---------------------------------------------------------------------------
// Gallery catalog
// ---------------------------------------------------------------------------

export const machineCatalog: Record<string, () => THREE.Object3D> = {
  giantLog: () => createGiantLog().root,
  dropZoneSlab: () => createDropZoneSlab(LAYOUT.dropZone.slab.w, LAYOUT.dropZone.slab.d),
  harvester: () => createHarvester(LAYOUT.harvester.railMaxZ - LAYOUT.harvester.railMinZ).root,
  processor: () => createProcessor().root,
  conveyor: () =>
    createRollerConveyor(
      [
        { x: 0, z: 0 },
        { x: 0, z: 3.4 },
        { x: 3.2, z: 3.4 },
      ],
      0.8,
      0.5,
    ).root,
  megaSaw: () => createMegaSaw(LAYOUT.megaSaw.bladeRadius).root,
};
