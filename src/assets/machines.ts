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
import { COLORS, LAYOUT, PALETTE, UPGRADES, type XZ } from '../config';
import { Batch, bake, vcMat } from '../render/batch';
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
  const s = new THREE.Group();
  s.add(mesh(sawDiscGeometry(radius, teeth, thickness), toon(COLORS.MACHINE_STEEL)));
  // dark flange both sides
  addCyl(s, radius * 0.56, thickness + 0.04, PALETTE.metalDark, 'z', 0, 0, 0, 20);
  // glowing accent ring on the disc
  const ring = mesh(geo.torus(radius * 0.74, radius * 0.03, 5, 36), toon(COLORS.SAW_GLOW));
  ring.scale.z = 0.8;
  s.add(ring);
  // hub
  addCyl(s, radius * 0.22, thickness + 0.1, COLORS.SAW_GLOW, 'z', 0, 0, 0, 14);
  // bolts
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    addCyl(s, radius * 0.06, thickness + 0.08, PALETTE.rubber, 'z', Math.cos(a) * radius * 0.4, Math.sin(a) * radius * 0.4, 0, 8);
  }
  g.add(bake(s));
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
  /** Everything static on the trunk, baked into one mesh at the end. */
  const stat = new THREE.Group();

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
  stat.add(piece(-half, cutZ - BAND_HALF, R, R, barkMat));
  stat.add(piece(cutZ + BAND_HALF, half, R, R, barkMat));

  // the cut band: a recessed yellow groove with chamfered flanks (the axe bites into it), one mesh on the
  // flashable unique material
  const cutBand = new THREE.Group();
  {
    const cb = new Batch();
    const addPiece = (z0: number, z1: number, rA: number, rB: number): void => {
      cb.add(geo.cylinder(rB, rA, z1 - z0, SEG), COLORS.LOG_CUT_BAND, 0, 0, (z0 + z1) / 2, { rx: Math.PI / 2 });
    };
    addPiece(cutZ - BAND_HALF, cutZ - BAND_HALF + 0.2, R, GROOVE_R);
    addPiece(cutZ - BAND_HALF + 0.2, cutZ + BAND_HALF - 0.2, GROOVE_R, GROOVE_R);
    addPiece(cutZ + BAND_HALF - 0.2, cutZ + BAND_HALF, GROOVE_R, R);
    cutBand.add(cb.mesh({ material: cutMaterial }));
  }
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
    stat.add(cap);
    const zf = sgn * (half + 0.035);
    for (const rr of [1.36, 0.9, 0.46]) {
      const ring = mesh(geo.torus(rr, 0.04, 5, 40), ringMat, { receive: false });
      ring.scale.z = 0.5;
      ring.position.z = zf;
      stat.add(ring);
    }
    const pith = mesh(geo.cylinder(0.11, 0.11, 0.05, 12), ringMat);
    pith.rotation.x = Math.PI / 2;
    pith.position.z = zf;
    stat.add(pith);
    for (let i = 0; i < 3; i++) {
      const a = 0.7 + i * 2.1;
      const crack = mesh(geo.box(0.05, 0.62, 0.03), ringMat, { cast: false });
      crack.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, zf);
      crack.rotation.z = a - Math.PI / 2;
      stat.add(crack);
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
    stat.add(pivot);
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
    stat.add(pivot);
  }
  for (const [zc, ang] of [[-3.4, 0.15], [-0.6, 0.55], [1.4, 0.1]] as const) {
    const pivot = new THREE.Group();
    pivot.rotation.z = ang;
    const stub = mesh(geo.cone(0.2, 0.45, 8), barkMat);
    stub.rotation.z = -Math.PI / 2;
    stub.position.set(R + 0.14, 0, zc);
    pivot.add(stub);
    stat.add(pivot);
  }
  const snowMat = toon(COLORS.SNOW_WHITE);
  for (const [zc, len, w] of [[-4.6, 1.5, 0.6], [-2.2, 2.0, 0.7], [0.4, 1.4, 0.5], [-5.5, 0.8, 0.45]] as const) {
    const s = mesh(geo.sphere(1, 12, 6), snowMat);
    s.scale.set(w, 0.16, len);
    s.position.set(0.1, R - 0.02, zc);
    stat.add(s);
  }

  body.add(bake(stat));

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
  const s = new THREE.Group();
  const rim = 0.16;
  // light base plate (shows as a thin bevel around the grey top)
  addBox(s, w, 0.05, d, COLORS.DROP_ZONE_BORDER, 0, 0.025, 0, false);
  // grey top
  addBox(s, w - rim * 2, SLAB_TOP - 0.02, d - rim * 2, COLORS.DROP_ZONE_GREY, 0, (SLAB_TOP + 0.02) / 2 + 0.005, 0, false);
  // raised rim
  const rimH = 0.13;
  addBox(s, w, rimH, rim, COLORS.DROP_ZONE_BORDER, 0, rimH / 2, d / 2 - rim / 2);
  addBox(s, w, rimH, rim, COLORS.DROP_ZONE_BORDER, 0, rimH / 2, -d / 2 + rim / 2);
  addBox(s, rim, rimH, d - rim * 2, COLORS.DROP_ZONE_BORDER, w / 2 - rim / 2, rimH / 2, 0);
  addBox(s, rim, rimH, d - rim * 2, COLORS.DROP_ZONE_BORDER, -w / 2 + rim / 2, rimH / 2, 0);
  // corner bolts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addCyl(s, 0.06, 0.03, PALETTE.metalDark, 'y', sx * (w / 2 - rim / 2), rimH + 0.012, sz * (d / 2 - rim / 2), 8);
    }
  }
  // painted log-stack hint: three little bars on the +Z rim
  for (let i = -1; i <= 1; i++) {
    addBox(s, 0.34, 0.012, 0.05, COLORS.DROP_ZONE_BORDER, i * 0.5, SLAB_TOP + 0.002, d / 2 - rim - 0.12, false);
  }
  g.add(bake(s));
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
  /** Level plate on the cab (rides with the chassis). */
  badge: LevelBadge;
}

const HV_UPPER = 1.3;
const HV_FORE = 1.5;
const HV_SHOULDER = { x: -0.45, y: 1.05 };
const HV_FORK_Z = 0.72;
const HV_SAW_R = 0.98;

export function createHarvester(railLength: number): HarvesterModel {
  const root = new THREE.Group();
  const railX = 0.68;

  // --- rails + sleepers + buffers (static, baked) ---
  const rs = new THREE.Group();
  for (const sx of [-1, 1]) {
    addBox(rs, 0.14, 0.14, railLength + 0.2, PALETTE.metalDark, sx * railX, 0.21, 0);
    addBox(rs, 0.08, 0.04, railLength + 0.2, COLORS.MACHINE_STEEL, sx * railX, 0.29, 0, false);
  }
  const sleeperPartsLen = Math.floor(railLength / 0.5);
  for (let i = 0; i <= sleeperPartsLen; i++) {
    const z = -railLength / 2 + 0.1 + i * ((railLength - 0.2) / sleeperPartsLen);
    addBox(rs, 1.9, 0.1, 0.22, PALETTE.trunk, 0, 0.05, z);
  }
  for (const sz of [-1, 1]) {
    addBox(rs, 1.5, 0.4, 0.18, PALETTE.accent, 0, 0.3, sz * (railLength / 2 + 0.2));
    addBox(rs, 1.5, 0.1, 0.2, PALETTE.rubber, 0, 0.16, sz * (railLength / 2 + 0.2), false);
  }

  root.add(bake(rs));

  // --- chassis (static parts baked into one mesh) ---
  const chassis = new THREE.Group();
  root.add(chassis);
  const cs = new THREE.Group();
  // wheels + bogie bars
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addCyl(cs, 0.2, 0.16, PALETTE.metalDark, 'x', sx * railX, 0.4, sz * 0.52, 14);
      addCyl(cs, 0.08, 0.2, PALETTE.accent, 'x', sx * railX, 0.4, sz * 0.52, 8);
    }
    addBox(cs, 0.22, 0.14, 1.45, PALETTE.metalDark, sx * railX, 0.6, 0);
  }
  // deck + underframe
  addBox(cs, 1.9, 0.14, 1.7, PALETTE.machineDark, 0, 0.7, 0);
  addBox(cs, 1.8, 0.4, 1.6, COLORS.MACHINE_BLUE, 0, 0.97, 0);
  // front hood (toward the log) between the boom mounts
  addBox(cs, 0.7, 0.34, 1.0, COLORS.MACHINE_BLUE, -0.45, 1.34, 0);
  // cab at the rear (+X)
  addBox(cs, 0.9, 0.78, 1.15, COLORS.MACHINE_BLUE, 0.4, 1.57, 0);
  addBox(cs, 1.0, 0.08, 1.25, PALETTE.machineDark, 0.4, 2.0, 0);
  // windows (dark glass) on the +X and ±Z faces
  addBox(cs, 0.04, 0.4, 0.8, PALETTE.rubber, 0.86, 1.67, 0, false);
  addBox(cs, 0.6, 0.38, 0.04, PALETTE.rubber, 0.35, 1.67, 0.59, false);
  addBox(cs, 0.6, 0.38, 0.04, PALETTE.rubber, 0.35, 1.67, -0.59, false);
  // exhaust + beacon
  addCyl(cs, 0.07, 0.5, COLORS.MACHINE_STEEL, 'y', 0.7, 2.3, -0.42, 10);
  const beacon = new THREE.Group();
  beacon.position.set(0.4, 2.09, 0);
  const bs = new THREE.Group();
  const lamp = mesh(geo.sphere(0.14, 10, 8), toon(COLORS.SAW_GLOW));
  lamp.position.y = 0.1;
  bs.add(lamp);
  addBox(bs, 0.34, 0.04, 0.05, COLORS.COURIER_YELLOW, 0, 0.1, 0, false);
  beacon.add(bake(bs));
  chassis.add(beacon);
  // ladder-ish side detail: hazard strip on the deck edge
  for (let i = 0; i < 6; i++) {
    addBox(cs, 0.2, 0.2, 0.03, i % 2 === 0 ? PALETTE.accent : PALETTE.rubber, -0.7 + i * 0.28, 0.97, 0.82, false);
  }
  // shoulder mounts (steel brackets) + the two boom forks. Both forks flex identically, so one upper-arm
  // pivot and one forearm pivot each carry BOTH sides (one mesh per pivot).
  const upper = new THREE.Group();
  upper.position.set(HV_SHOULDER.x, HV_SHOULDER.y, 0);
  const fore = new THREE.Group();
  fore.position.set(HV_UPPER, 0, 0);
  const us = new THREE.Group();
  const fs = new THREE.Group();
  for (const sz of [-1, 1]) {
    const z = sz * HV_FORK_Z;
    addBox(cs, 0.4, 0.5, 0.2, PALETTE.metalDark, HV_SHOULDER.x, HV_SHOULDER.y - 0.2, z);
    addBox(us, HV_UPPER, 0.26, 0.2, COLORS.MACHINE_BLUE, HV_UPPER / 2, 0, z);
    addCyl(us, 0.17, 0.26, COLORS.MACHINE_STEEL, 'z', 0, 0, z, 12);
    addBox(fs, HV_FORE, 0.22, 0.18, COLORS.MACHINE_BLUE, HV_FORE / 2, 0, z);
    addCyl(fs, 0.15, 0.3, COLORS.MACHINE_STEEL, 'z', 0, 0, z, 12);
    // glowing accent stripe along the forearm
    addBox(fs, HV_FORE * 0.6, 0.05, 0.2, COLORS.SAW_GLOW, HV_FORE * 0.45, 0.1, z, false);
  }
  upper.add(bake(us));
  fore.add(bake(fs));
  upper.add(fore);
  chassis.add(upper);
  chassis.add(bake(cs));

  // --- saw head ---
  const sawHead = new THREE.Group();
  chassis.add(sawHead);
  const hs = new THREE.Group();
  addCyl(hs, 0.1, HV_FORK_Z * 2 + 0.3, COLORS.MACHINE_STEEL, 'z', 0, 0, 0, 10);
  for (const sz of [-1, 1]) addBox(hs, 0.34, 0.34, 0.16, PALETTE.machineDark, 0, 0, sz * HV_FORK_Z);
  sawHead.add(bake(hs));
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
    upper.rotation.z = phi1;
    fore.rotation.z = phi2 - phi1;
    sawHead.position.set(hx, hy, 0);
  };
  setBoom(restReach.x, restReach.y);

  const badge = createLevelBadge(UPGRADES.harvester.values.length - 1);
  badge.mesh.position.set(0.88, 1.3, 0);
  badge.mesh.rotation.y = Math.PI / 2;
  chassis.add(badge.mesh);
  return { root, chassis, saw, beacon, sawHead, setBoom, restReach, badge };
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
  /** Level plate on the front (+Z) of the body. */
  badge: LevelBadge;
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

  const ps = new THREE.Group();
  // skid plate
  addBox(ps, W + 0.14, 0.08, D + 0.14, PALETTE.metalDark, 0, 0.04, 0);
  // shell around the tunnel: floor, ceiling, two side walls
  addBox(ps, W, FLOOR - 0.08, D, blue, 0, 0.08 + (FLOOR - 0.08) / 2, 0);
  addBox(ps, W, H - CEIL, D, blue, 0, CEIL + (H - CEIL) / 2, 0);
  for (const sz of [-1, 1]) addBox(ps, W, CEIL - FLOOR, WALL, blue, 0, (CEIL + FLOOR) / 2, sz * (D / 2 - WALL / 2));
  // dark liner seen through the two openings
  const liner = mesh(geo.box(W - 0.04, CEIL - FLOOR - 0.02, D - WALL * 2 - 0.02), toon(PALETTE.rubber, { side: THREE.BackSide }), {
    cast: false,
  });
  liner.position.y = (CEIL + FLOOR) / 2;
  body.add(liner);
  // portal frames (darker blue) around both openings
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.012);
    addBox(ps, 0.05, 0.1, D - WALL * 2 + 0.2, PALETTE.machineDark, x, CEIL - 0.05, 0, false);
    addBox(ps, 0.05, 0.1, D - WALL * 2 + 0.2, PALETTE.machineDark, x, FLOOR + 0.05, 0, false);
    for (const sz of [-1, 1]) addBox(ps, 0.05, CEIL - FLOOR, 0.1, PALETTE.machineDark, x, (CEIL + FLOOR) / 2, sz * (D / 2 - WALL - 0.05), false);
  }
  // hazard stripes along the lower +Z/-Z faces
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const s = addBox(ps, 0.13, 0.3, 0.025, i % 2 === 0 ? PALETTE.accent : PALETTE.rubber, -0.66 + i * 0.19, 0.2, sz * (D / 2 + 0.012), false);
      s.rotation.z = 0.55;
    }
  }
  // louver slats on the side walls
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      addBox(ps, 1.1, 0.06, 0.06, PALETTE.machineDark, 0, 0.55 + i * 0.16, sz * (D / 2 + 0.02), false);
    }
  }
  // roof louvers + chimney + status lamp
  for (let i = 0; i < 5; i++) addBox(ps, 0.7, 0.04, 0.07, PALETTE.machineDark, 0.25, H + 0.02, -0.4 + i * 0.2, false);
  const chimneyX = -0.45;
  const chimneyZ = -0.42;
  addCyl(ps, 0.11, 0.5, COLORS.MACHINE_STEEL, 'y', chimneyX, H + 0.25, chimneyZ, 12);
  addCyl(ps, 0.15, 0.08, PALETTE.metalDark, 'y', chimneyX, H + 0.52, chimneyZ, 12);
  addBox(ps, 0.34, 0.2, 0.34, PALETTE.machineDark, 0.5, H + 0.1, 0.4);
  const lampMaterial = toonUnique(COLORS.SAW_GLOW, { emissive: COLORS.SAW_GLOW, emissiveIntensity: 0 });
  const lamp = mesh(geo.sphere(0.12, 10, 8), lampMaterial);
  lamp.position.set(0.5, H + 0.28, 0.4);
  body.add(lamp);
  // control panel on the +Z wall
  addBox(ps, 0.34, 0.22, 0.05, PALETTE.rubber, 0.55, 1.2, D / 2 + 0.035, false);
  addBox(ps, 0.1, 0.1, 0.04, COLORS.SAW_GLOW, 0.5, 1.2, D / 2 + 0.07, false);
  addBox(ps, 0.1, 0.1, 0.04, COLORS.CASH_GREEN, 0.64, 1.2, D / 2 + 0.07, false);

  body.add(bake(ps));
  const badge = createLevelBadge(UPGRADES.processor.values.length - 1);
  badge.mesh.position.set(-0.2, 1.33, D / 2 + 0.03);
  body.add(badge.mesh);

  // --- infeed tray (steel) ---
  const hp = P.hopper;
  const tray = new THREE.Group();
  const ts = new THREE.Group();
  tray.position.set(hp.x - P.x, 0, hp.z - P.z);
  addBox(ts, hp.w, hp.h - 0.1, hp.d, COLORS.MACHINE_STEEL, 0, (hp.h - 0.1) / 2, 0);
  addBox(ts, hp.w, 0.1, hp.d, PALETTE.metalDark, 0, hp.h - 0.05, 0);
  for (const sz of [-1, 1]) addBox(ts, hp.w, 0.2, 0.07, COLORS.MACHINE_STEEL, 0, hp.h + 0.1, sz * (hp.d / 2 - 0.035));
  addBox(ts, 0.07, 0.2, hp.d, COLORS.MACHINE_STEEL, -hp.w / 2 + 0.035, hp.h + 0.1, 0);
  // ramp plate bridging tray and tunnel
  addBox(ts, 0.3, 0.05, hp.d - 0.2, PALETTE.metalDark, hp.w / 2 + 0.05, hp.h - 0.06, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(ts, 0.16, 0.06, 0.16, PALETTE.rubber, sx * (hp.w / 2 - 0.1), 0.03, sz * (hp.d / 2 - 0.1), false);
  tray.add(bake(ts));
  root.add(tray);

  // --- output workbench (FENCE_WOOD) ---
  const ot = P.outputTable;
  const bench = new THREE.Group();
  const bs = new THREE.Group();
  bench.position.set(ot.x - P.x, 0, ot.z - P.z);
  addBox(bs, ot.w, 0.12, ot.d, COLORS.FENCE_WOOD, 0, ot.h - 0.06, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(bs, 0.13, ot.h - 0.12, 0.13, PALETTE.fenceDark, sx * (ot.w / 2 - 0.1), (ot.h - 0.12) / 2, sz * (ot.d / 2 - 0.1));
  for (const sz of [-1, 1]) addBox(bs, ot.w - 0.3, 0.1, 0.07, PALETTE.fenceDark, 0, ot.h - 0.2, sz * (ot.d / 2 - 0.1));
  for (const sx of [-1, 1]) addBox(bs, 0.07, 0.1, ot.d - 0.3, PALETTE.fenceDark, sx * (ot.w / 2 - 0.1), ot.h - 0.2, 0);
  // low rim so crates don't look like they are sliding off
  for (const sz of [-1, 1]) addBox(bs, ot.w, 0.05, 0.06, PALETTE.fenceDark, 0, ot.h + 0.025, sz * (ot.d / 2 - 0.03), false);
  addBox(bs, 0.06, 0.05, ot.d, PALETTE.fenceDark, ot.w / 2 - 0.03, ot.h + 0.025, 0, false);
  bench.add(bake(bs));
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
    badge,
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
  /**
   * Call once the pop-in is over: merges every segment mesh into ONE mesh (the segment groups are removed,
   * so `segments` must not be used afterwards). Idempotent.
   */
  finalize(): void;
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
  const railH = 0.24;
  const legH = beltY - 0.2;
  const unit = geo.box(1, 1, 1);
  /** Add a (rotated) box to a segment batch. */
  const part = (bt: Batch, color: number, w: number, h: number, d: number, x: number, y: number, z: number, yaw: number): void => {
    bt.add(unit, color, x, y, z, { ry: yaw, sx: w, sy: h, sz: d });
  };

  const segments: THREE.Group[] = [];
  const batches: Batch[] = [];
  for (let i = 0; i < nSeg; i++) {
    const s0 = i * segLen;
    const s1 = (i + 1) * segLen;
    path.sample((s0 + s1) / 2, sm);
    const ox = sm.x;
    const oz = sm.z;
    const seg = new THREE.Group();
    seg.position.set(ox, 0, oz);
    const bt = new Batch();
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
      part(bt, PALETTE.rubber, width, 0.04, chordLen, mx, beltY - 0.17, mz, yaw);
      for (const side of [-1, 1]) {
        a.set(ax + nax * half * side - ox, az + naz * half * side - oz);
        b.set(bx + nbx * half * side - ox, bz + nbz * half * side - oz);
        part(bt, COLORS.MACHINE_STEEL, 0.09, railH, a.distanceTo(b) + 0.03, (a.x + b.x) / 2, beltY - railH / 2 + 0.03, (a.y + b.y) / 2, Math.atan2(b.x - a.x, b.y - a.y));
      }
    }
    // legs: one pair near the middle of every second segment, plus the very ends
    if (i % 2 === 0 || i === nSeg - 1) {
      path.sample((s0 + s1) / 2, sm);
      for (const side of [-1, 1]) {
        const lx = sm.x + sm.dz * half * side - ox;
        const lz = sm.z - sm.dx * half * side - oz;
        part(bt, PALETTE.metalDark, 0.09, legH, 0.09, lx, legH / 2, lz, sm.yaw);
        part(bt, PALETTE.metalDark, 0.24, 0.04, 0.24, lx, 0.02, lz, sm.yaw);
      }
      part(bt, PALETTE.metalDark, width + 0.2, 0.06, 0.07, 0, beltY - 0.27, 0, sm.yaw);
    }
    segments.push(seg);
    batches.push(bt);
  }

  // drive motor at the start (blue housing + glow light) on the left side of the first segment
  {
    path.sample(0.35, sm);
    const seg0 = segments[0]!;
    const off = half + 0.28;
    const mx = sm.x + sm.dz * off - seg0.position.x;
    const mz = sm.z - sm.dx * off - seg0.position.z;
    const yaw = sm.yaw;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const motorPart = (color: number, w: number, h: number, d: number, lx: number, ly: number, lz: number): void => {
      part(batches[0]!, color, w, h, d, mx + lx * c + lz * sn, ly, mz - lx * sn + lz * c, yaw);
    };
    motorPart(COLORS.MACHINE_BLUE, 0.36, 0.34, 0.5, 0, beltY - 0.3, 0);
    motorPart(PALETTE.machineDark, 0.2, 0.06, 0.4, 0, beltY - 0.09, 0);
    motorPart(COLORS.SAW_GLOW, 0.1, 0.1, 0.1, 0, beltY - 0.04, 0.12);
    motorPart(PALETTE.metalDark, 0.1, 0.34, 0.1, 0, (beltY - 0.3) / 2 - 0.02, -0.12);
  }
  for (let i = 0; i < nSeg; i++) segments[i]!.add(batches[i]!.mesh());

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
  let finalized = false;
  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    const parts: THREE.BufferGeometry[] = [];
    for (const seg of segments) {
      seg.updateMatrix();
      for (const child of seg.children) {
        const m = child as THREE.Mesh;
        if (m.isMesh) parts.push(m.geometry.clone().applyMatrix4(seg.matrix));
      }
      root.remove(seg);
      for (const child of seg.children) (child as THREE.Mesh).geometry.dispose();
    }
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    const mesh1 = new THREE.Mesh(merged, vcMat());
    mesh1.castShadow = true;
    mesh1.receiveShadow = true;
    root.add(mesh1);
  };
  return { root, path, segments, rollers, rollerRadius: ROLLER_R, setRollers, finalize };
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
  /** Level plate on the yard-side base. */
  badge: LevelBadge;
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

  const ms = new THREE.Group();
  // yard-side base (solid) + column
  addBox(ms, M.base.maxX - M.base.minX, 1.3, M.base.maxZ - M.base.minZ, blue, yardX, 0.65, baseZ);
  addBox(ms, M.base.maxX - M.base.minX + 0.2, 0.18, M.base.maxZ - M.base.minZ + 0.2, PALETTE.metalDark, yardX, 0.09, baseZ);
  addBox(ms, 1.85, 0.12, 1.85, PALETTE.machineDark, yardX, 1.36, baseZ, false);
  addBox(ms, 0.7, beamY - 1.3, 0.7, COLORS.MACHINE_STEEL, yardX, 1.3 + (beamY - 1.3) / 2, POST_Z);
  // far-bank leg
  addBox(ms, 1.3, 0.18, 1.3, PALETTE.metalDark, farX, 0.09, POST_Z);
  addBox(ms, 0.9, 0.9, 0.9, blue, farX, 0.63, POST_Z);
  addBox(ms, 0.6, beamY - 1.0, 0.6, COLORS.MACHINE_STEEL, farX, 1.0 + (beamY - 1.0) / 2, POST_Z);
  // diagonal braces
  for (const [bx, dir] of [[yardX, -1], [farX, 1]] as const) {
    const len = Math.hypot(1.8, 2.6);
    const brace = addBox(ms, 0.2, len, 0.2, PALETTE.metalDark, bx + dir * 0.9, beamY - 1.55, POST_Z);
    brace.rotation.z = -dir * Math.atan2(1.8, 2.6);
  }
  // beam + end housings
  const beamLen = yardX - farX + 0.9;
  addBox(ms, beamLen, 0.55, 0.9, COLORS.MACHINE_STEEL, (yardX + farX) / 2, beamY, POST_Z);
  addBox(ms, beamLen, 0.1, 1.0, PALETTE.metalDark, (yardX + farX) / 2, beamY + 0.32, POST_Z);
  addBox(ms, 1.3, 0.8, 1.2, blue, yardX, beamY + 0.1, POST_Z);
  addBox(ms, 1.1, 0.8, 1.2, blue, farX, beamY + 0.1, POST_Z);
  const beacons: THREE.Object3D[] = [];
  for (const bx of [yardX, farX]) {
    const b = new THREE.Group();
    b.position.set(bx, beamY + 0.65, POST_Z);
    const bs = new THREE.Group();
    bs.add(mesh(geo.sphere(0.2, 10, 8), toon(COLORS.SAW_GLOW)));
    addBox(bs, 0.5, 0.05, 0.06, COLORS.COURIER_YELLOW, 0, 0, 0, false);
    b.add(bake(bs));
    root.add(b);
    beacons.push(b);
  }
  // trolley under the beam (blue) with glow stripe
  addBox(ms, 1.8, 0.7, 1.1, blue, 0, beamY - 0.62, POST_Z);
  addBox(ms, 1.84, 0.1, 1.14, COLORS.SAW_GLOW, 0, beamY - 0.5, POST_Z, false);
  addBox(ms, 1.6, 0.14, 1.0, PALETTE.machineDark, 0, beamY - 1.0, POST_Z);
  // vertical guide rails
  for (const sx of [-1, 1]) {
    addBox(ms, 0.14, beamY - 1.0 - 0.25, 0.14, PALETTE.metalDark, sx * 0.85, 0.25 + (beamY - 1.25) / 2, POST_Z + 0.55);
    addBox(ms, 0.14, beamY - 1.0 - 0.25, 0.14, PALETTE.metalDark, sx * 0.85, 0.25 + (beamY - 1.25) / 2, POST_Z - 0.55);
  }
  addBox(ms, 2.1, 0.14, 1.4, PALETTE.metalDark, 0, 0.2, POST_Z, false);
  root.add(bake(ms));

  // carriage: motor housing + yoke + blade
  const carriage = new THREE.Group();
  carriage.position.set(0, restY, 0);
  const cs = new THREE.Group();
  addBox(cs, 1.4, 1.2, 0.9, blue, 0, 0, POST_Z);
  addBox(cs, 1.44, 0.14, 0.94, COLORS.SAW_GLOW, 0, 0.3, POST_Z, false);
  addBox(cs, 1.2, 0.2, 1.0, PALETTE.machineDark, 0, 0.7, POST_Z);
  for (const sx of [-1, 1]) {
    addBox(cs, 0.18, 0.7, 1.4, COLORS.MACHINE_STEEL, sx * 0.8, 0, POST_Z);
  }
  addCyl(cs, 0.22, BLADE_Z - POST_Z + 0.3, COLORS.MACHINE_STEEL, 'z', 0, 0, (BLADE_Z + POST_Z) / 2 - 0.1, 14);
  carriage.add(bake(cs));
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

  const badge = createLevelBadge(UPGRADES.megaSaw.values.length - 1);
  badge.mesh.position.set(yardX + 0.93, 0.75, baseZ);
  badge.mesh.rotation.y = Math.PI / 2;
  badge.mesh.scale.setScalar(1.7);
  root.add(badge.mesh);
  return { root, carriage, blade, bladeZ: BLADE_Z, restY, cutY, updateRods, beacons, badge };
}

// ---------------------------------------------------------------------------
// Gallery catalog
// ---------------------------------------------------------------------------

export const machineCatalog: Record<string, () => THREE.Object3D> = {
  giantLog: () => createGiantLog().root,
  dropZoneSlab: () => createDropZoneSlab(LAYOUT.dropZone.slab.w, LAYOUT.dropZone.slab.d),
  harvester: () => createHarvester(LAYOUT.harvester.railMaxZ - LAYOUT.harvester.railMinZ).root,
  processor: () => createProcessor().root,
  conveyor: () => {
    const model = createRollerConveyor(
      [
        { x: 0, z: 0 },
        { x: 0, z: 3.4 },
        { x: 3.2, z: 3.4 },
      ],
      0.8,
      0.5,
    );
    model.finalize();
    return model.root;
  },
  megaSaw: () => createMegaSaw(LAYOUT.megaSaw.bladeRadius).root,
};

// ---------------------------------------------------------------------------
// Level badge (harvester / processor / mega saw)
// ---------------------------------------------------------------------------

export interface LevelBadge {
  /** ONE vertex-coloured mesh; its geometry is swapped by setLevel. Faces +Z, origin = plate centre. */
  mesh: THREE.Mesh;
  /** Show `level` (0-based): level + 1 lit pips out of maxLevel + 1. No-op when unchanged. */
  setLevel(level: number): void;
}

/** A small dark plate with one pip per level (lit = COURIER_YELLOW, unlit = dim steel); the trim turns SAW_GLOW at max. */
export function createLevelBadge(maxLevel: number): LevelBadge {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), vcMat());
  m.castShadow = false;
  m.receiveShadow = true;
  let shown = -1;
  const pips = maxLevel + 1;
  const pitch = 0.13;
  const w = pips * pitch + 0.1;
  const setLevel = (level: number): void => {
    if (level === shown) return;
    shown = level;
    const b = new Batch();
    const maxed = level >= maxLevel;
    b.add(geo.box(1, 1, 1), PALETTE.rubber, 0, 0, 0, { sx: w, sy: 0.24, sz: 0.05 });
    b.add(geo.box(1, 1, 1), maxed ? COLORS.SAW_GLOW : PALETTE.metalDark, 0, 0.125, 0.004, { sx: w + 0.03, sy: 0.03, sz: 0.052 });
    for (let i = 0; i < pips; i++) {
      const lit = i <= level;
      b.add(geo.box(1, 1, 1), lit ? COLORS.COURIER_YELLOW : PALETTE.metalDark, (i - (pips - 1) / 2) * pitch, 0, 0.03, {
        sx: 0.09,
        sy: 0.12,
        sz: lit ? 0.04 : 0.02,
      });
    }
    const old = m.geometry;
    m.geometry = b.geometry();
    old.dispose();
  };
  setLevel(0);
  return { mesh: m, setLevel };
}
