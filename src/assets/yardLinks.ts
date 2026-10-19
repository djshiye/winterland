/**
 * 0.9.12: the overhead links between an era region's machines (eras/linkPlan.ts plans them, eras/YardLinks.ts owns
 * them), each era in its own materials (render/palette.ts YARD_LINKS): era 2 a timber chute with stone blocks sliding
 * along, 3 an ore ropeway with swinging buckets, 4 brass pneumatic tubes with capsules, 5 a covered steel gallery with
 * pellets riding through, 6 copper power lines with bright beads, 7 a banded oil pipeline with glowing flow rings,
 * 8 cable trays with data packets, 9 glass coolant tubes with glowing orbs, 10 golden light conduits with gems.
 *
 * Built cheap (the #80 lesson: never-culled belt rollers casting shadows were half the late game's triangles): ONE
 * merged structure mesh (casts), ONE glow mesh (riser lamps and glowing parts, night-registered), ONE glass mesh (tube
 * eras only, no shadow) and ONE instanced carrier mesh (no shadow) per region. The carriers' matrices are rebuilt only
 * when three is about to draw them (onBeforeRender: off screen they cost nothing) and the instanced mesh is culled by
 * a sphere around every span.
 *
 * Camera rule: the camera looks from +X / +Z, so riser lamps sit on the +X and +Z faces of each head.
 */
import * as THREE from 'three';
import type { XZ } from '../config';
import { vcMat } from '../render/batch';
import { toon } from '../render/materials';
import { SNOW, YARD_LINKS, mixHex, type YardLinkLook } from '../render/palette';
import { glowMaterial } from '../render/paletteMaterials';
import { SPAN_Y, type YardLinkPlan } from '../eras/linkPlan';
import { Kit, type V3 } from './eraKit';

/** Carriers move this fast (m/s) and ride this far apart (m). */
export const CARRIER_SPEED = 0.85;
const CARRIER_GAP = 1.15;
/** Carriers grow out of / shrink into the riser heads over this length (m). */
const FADE = 0.45;
/** Span shape per kind: centre-line height above SPAN_Y at the risers, sag at the middle. */
const SHAPE: Record<YardLinkLook['kind'], { lift: number; sag: number; ride: number }> = {
  // ride = carrier centre above the span's centre line
  flume: { lift: 0, sag: 0, ride: 0.02 },
  ropeway: { lift: 0.4, sag: 0.16, ride: -0.5 },
  tube: { lift: 0, sag: 0, ride: 0 },
  gallery: { lift: 0, sag: 0, ride: -0.2 },
  cable: { lift: 0.5, sag: 0.28, ride: 0.22 },
  pipe: { lift: 0, sag: 0, ride: 0 },
  tray: { lift: 0, sag: 0, ride: 0.06 },
};
/** Riser head top (above SPAN_Y) per kind. */
/** The ropeway's empty return rope runs this far beside the loaded one (world +Z: toward the camera). */
const ROPE_RETURN = 0.55;
const HEAD_TOP: Record<YardLinkLook['kind'], number> = { flume: 0.35, ropeway: 0.7, tube: 0.3, gallery: 0.62, cable: 0.5, pipe: 0.34, tray: 0.3 };

export interface YardLinksModel {
  root: THREE.Group;
  /** Advance the carriers (seconds). */
  update(dt: number): void;
  /** Carriers in the model (tests, debug). */
  readonly carriers: number;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const unitCyl = new Map<number, THREE.CylinderGeometry>();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Round rod of radius r from a to b (pipes, posts, cables). */
function rod(k: Kit, color: number, a: V3, b: V3, r: number, seg = 8): void {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  if (len < 1e-4) return;
  let g = unitCyl.get(seg);
  if (!g) unitCyl.set(seg, (g = new THREE.CylinderGeometry(1, 1, 1, seg)));
  _q.setFromUnitVectors(UP, _d.divideScalar(len));
  _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  _s.set(r, len, r);
  k.batch.addMatrix(g, color, _m.compose(_p, _q, _s));
}

/** Box of size (len along the span, h, w across) centred at c, turned to the span's yaw. */
function spanBox(k: Kit, color: number, c: V3, len: number, h: number, w: number, yaw: number, pitch = 0): void {
  k.add(boxGeo(), color, c[0], c[1], c[2], { ry: yaw, rz: pitch, sx: len, sy: h, sz: w });
}
let unitBox: THREE.BoxGeometry | null = null;
const boxGeo = (): THREE.BoxGeometry => (unitBox ??= new THREE.BoxGeometry(1, 1, 1));

/** A carrier route: points (world, at carrier height) and their running lengths. */
interface Route {
  pts: THREE.Vector3[];
  acc: number[];
  len: number;
}

function route(pts: THREE.Vector3[]): Route {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  return { pts, acc, len: acc[acc.length - 1]! };
}

/** The point `s` metres along a route (into `out`); returns the yaw of the piece it is on (local +X along travel). */
function sampleRoute(r: Route, s: number, out: THREE.Vector3): number {
  let i = 1;
  while (i < r.acc.length - 1 && r.acc[i]! < s) i++;
  const s0 = r.acc[i - 1]!;
  const a = r.pts[i - 1]!;
  const b = r.pts[i]!;
  const t = Math.min(1, Math.max(0, (s - s0) / Math.max(1e-6, r.acc[i]! - s0)));
  out.copy(a).lerp(b, t);
  return Math.atan2(-(b.z - a.z), b.x - a.x);
}

const v3 = (p: THREE.Vector3, dy = 0): V3 => [p.x, p.y + dy, p.z];

// ---------------------------------------------------------------------------
// carriers (built around the origin, travelling along local +X)
// ---------------------------------------------------------------------------

function carrierGeometry(look: YardLinkLook): THREE.BufferGeometry {
  const k = new Kit();
  const c = look.carrier;
  const b = look.carrierB;
  switch (look.carrierShape) {
    case 'block': // a dressed stone block or a clay brick on a little sled
      k.box(c, 0.36, 0.26, 0.3, 0, -0.1, 0);
      k.box(mixHex(c, SNOW, 0.35), 0.3, 0.04, 0.24, 0, 0.16, 0);
      break;
    case 'bucket': // hanger, a tipping ore bucket heaped with ore
      k.box(look.wire, 0.05, 0.42, 0.05, 0, 0.08, 0);
      k.box(look.band, 0.12, 0.08, 0.12, 0, 0.46, 0);
      k.cyl(c, 0.15, 0.32, 0, -0.26, 0, 8, 0.22);
      k.torus(look.band, 0.22, 0.025, 0, 0.06, 0, { rx: Math.PI / 2 }, 10);
      k.dome(b, 0.18, 0, 0.06, 0, { sy: 0.7 });
      break;
    case 'capsule': // a brass pneumatic capsule
      k.cyl(c, 0.12, 0.3, 0, -0.15, 0, 10, 0.12, { rz: Math.PI / 2 });
      k.sph(c, 0.12, 0.15, 0, 0);
      k.sph(b, 0.12, -0.15, 0, 0);
      k.torus(b, 0.125, 0.02, 0.04, 0, 0, { ry: Math.PI / 2 }, 10);
      break;
    case 'pellets': // a little heap of rust-red pellets
      for (const [x, y, z, r] of [[0, 0, 0, 0.14], [0.17, -0.03, 0.07, 0.11], [-0.15, -0.03, -0.06, 0.12], [0.03, 0.12, -0.04, 0.1], [-0.05, -0.02, 0.15, 0.1]] as const) k.sph(r > 0.11 ? c : b, r, x, y, z);
      break;
    case 'bead': // a bright bead of current
      k.sph(c, 0.11, 0, 0, 0, { sx: 1.6 });
      break;
    case 'ring': // a glowing flow ring round the pipe
      k.torus(c, 0.29, 0.045, 0, 0, 0, { ry: Math.PI / 2 }, 16);
      break;
    case 'packet': // a data packet
      k.box(c, 0.26, 0.12, 0.18, 0, -0.06, 0);
      break;
    case 'orb': // a glowing coolant orb
      k.sph(c, 0.13, 0, 0, 0);
      break;
    case 'gem': // a golden light gem
      k.cone(c, 0.13, 0.15, 0, 0, 0, 6);
      k.cone(c, 0.13, 0.15, 0, 0, 0, 6, { rx: Math.PI });
      break;
  }
  return k.geometry();
}

// ---------------------------------------------------------------------------
// risers
// ---------------------------------------------------------------------------

/** One riser: post from the ground to the head, the head itself, its lamp. */
function riser(body: Kit, glow: Kit, look: YardLinkLook, x: number, z: number, inward: number): void {
  const top = SPAN_Y + HEAD_TOP[look.kind];
  const lamp = (y: number, ox: number, oz: number): void => {
    glow.box(look.lamp, 0.16, 0.16, 0.05, x + oz * 0, y, z + oz, {});
    glow.box(look.lamp, 0.05, 0.16, 0.16, x + ox, y, z, {});
  };
  // foot plate (inside the machine body)
  body.box(look.foot, 0.6, 0.12, 0.6, x, 0, z);
  switch (look.kind) {
    case 'flume': {
      body.box(look.post, 0.26, SPAN_Y - 0.3, 0.26, x, 0.12, z);
      // a brace toward the machine's middle (the riser stands 0.35 m inside its side and back)
      body.beam(look.post, [x, 0.12, z + inward * 0.7], [x, SPAN_Y - 1.2, z], 0.12);
      body.box(look.main, 0.9, 0.5, 0.9, x, SPAN_Y - 0.3, z);
      body.box(look.band, 0.94, 0.08, 0.94, x, SPAN_Y - 0.02, z);
      body.box(SNOW, 0.96, 0.1, 0.96, x, SPAN_Y + 0.2, z);
      body.box(look.band, 0.96, 0.08, 0.96, x, SPAN_Y + 0.12, z);
      lamp(SPAN_Y - 0.55, 0.48, 0.48);
      break;
    }
    case 'ropeway': {
      // a timber headpost (its jib reaches back to the rope wheels: arm())
      body.box(look.post, 0.28, top - 0.12, 0.28, x, 0.12, z);
      body.beam(look.post, [x, 0.12, z + inward * 0.7], [x, SPAN_Y - 1.4, z], 0.12);
      body.box(SNOW, 0.32, 0.08, 0.32, x, top, z);
      lamp(SPAN_Y - 0.4, 0.17, 0.17);
      break;
    }
    case 'tube': {
      rod(body, look.main, [x, 0.12, z], [x, SPAN_Y, z], 0.17, 10);
      body.sph(look.main, 0.24, x, SPAN_Y, z);
      for (const y of [0.5, 1.6, 2.7, SPAN_Y - 0.5]) body.cyl(look.band, 0.22, 0.12, x, y, z, 10);
      body.cyl(look.band, 0.3, 0.12, x, SPAN_Y + 0.18, z, 10);
      body.box(SNOW, 0.36, 0.08, 0.36, x, SPAN_Y + 0.27, z);
      lamp(SPAN_Y - 0.9, 0.23, 0.23);
      break;
    }
    case 'gallery': {
      body.box(look.post, 0.32, SPAN_Y - 0.5, 0.32, x, 0.12, z);
      body.beam(look.post, [x, 1.0, z + inward * 0.7], [x, SPAN_Y - 0.6, z], 0.1);
      body.box(look.main, 1.2, 1.0, 1.25, x, SPAN_Y - 0.5, z);
      body.box(look.band, 1.26, 0.1, 1.31, x, SPAN_Y - 0.5, z);
      body.gable(x, z, SPAN_Y + 0.5, 1.2, 1.25, 0.32, look.band, mixHex(look.band, look.post, 0.3), look.main, 0.1);
      glow.box(look.lamp, 0.42, 0.3, 0.05, x, SPAN_Y - 0.15, z + 0.64, {});
      glow.box(look.lamp, 0.05, 0.3, 0.42, x + 0.61, SPAN_Y - 0.15, z, {});
      break;
    }
    case 'cable': {
      rod(body, look.post, [x, 0.12, z], [x, top, z], 0.12, 8);
      body.cyl(look.band, 0.16, 0.1, x, top, z, 8, 0.1);
      body.box(look.main, 0.5, 0.6, 0.36, x, SPAN_Y - 1.2, z);
      body.box(SNOW, 0.54, 0.08, 0.4, x, SPAN_Y - 0.6, z);
      glow.box(look.lamp, 0.22, 0.14, 0.04, x, SPAN_Y - 0.9, z + 0.19, {});
      glow.box(look.lamp, 0.04, 0.14, 0.18, x + 0.26, SPAN_Y - 0.9, z, {});
      break;
    }
    case 'pipe': {
      rod(body, look.main, [x, 0.12, z], [x, SPAN_Y, z], 0.24, 12);
      body.sph(look.main, 0.3, x, SPAN_Y, z);
      for (const y of [0.4, 2.0, SPAN_Y - 0.45]) body.cyl(look.band, 0.29, 0.14, x, y, z, 12);
      // a valve wheel up where it shows over the machine (on the body's side of the riser: never over the walkway)
      body.torus(look.band, 0.2, 0.04, x, SPAN_Y - 0.9, z + inward * 0.34, undefined, 12);
      body.cyl(look.wire, 0.05, 0.12, x, SPAN_Y - 0.9, z + inward * 0.22, 6, 0.05, { rx: Math.PI / 2 });
      body.box(SNOW, 0.42, 0.08, 0.42, x, SPAN_Y + 0.26, z);
      lamp(SPAN_Y - 0.9, 0.29, 0.29);
      break;
    }
    case 'tray': {
      body.box(look.post, 0.2, SPAN_Y - 0.1, 0.2, x, 0.12, z);
      body.box(look.main, 0.7, 0.5, 0.5, x, SPAN_Y - 0.25, z);
      body.box(look.band, 0.74, 0.06, 0.54, x, SPAN_Y + 0.22, z);
      body.box(SNOW, 0.74, 0.08, 0.54, x, SPAN_Y + 0.28, z);
      glow.box(look.lamp, 0.4, 0.06, 0.04, x, SPAN_Y, z + 0.26, {});
      glow.box(look.lamp, 0.04, 0.06, 0.3, x + 0.36, SPAN_Y, z, {});
      glow.box(look.lamp, 0.12, 0.12, 0.04, x, SPAN_Y - 0.9, z + 0.11, {});
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// spans: rigid pieces (chute, tube, gallery, pipe, tray) and their corner joints, wires (ropeway, power lines)
// ---------------------------------------------------------------------------

/** A straight rigid piece from a to b at the span height (the arms reaching back, and the span across the gap). */
function piece(body: Kit, glow: Kit, glass: Kit, look: YardLinkLook, a: XZ, b: XZ): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.05) return;
  const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  // across the piece (horizontal normal)
  const nx = -dz;
  const nz = dx;
  const along = (t: number, dy = 0, off = 0): V3 => [a.x + (b.x - a.x) * t + nx * off, SPAN_Y + dy, a.z + (b.z - a.z) * t + nz * off];
  const ribs = Math.max(1, Math.round(len / 0.9));
  switch (look.kind) {
    case 'flume': {
      spanBox(body, look.main, along(0.5, -0.12), len, 0.08, 0.72, yaw);
      for (const s of [-1, 1]) spanBox(body, look.main, along(0.5, 0.04, s * 0.36), len, 0.32, 0.07, yaw);
      for (const s of [-1, 1]) spanBox(body, SNOW, along(0.5, 0.23, s * 0.36), len, 0.06, 0.1, yaw);
      for (let i = 1; i < ribs; i++) spanBox(body, look.band, along(i / ribs, 0.05), 0.08, 0.38, 0.84, yaw);
      if (len > 2.5) {
        // a shallow king-post truss under a long chute
        body.beam(look.post, along(0.04, -0.18), along(0.5, -0.55), 0.09);
        body.beam(look.post, along(0.96, -0.18), along(0.5, -0.55), 0.09);
        body.beam(look.post, along(0.5, -0.16), along(0.5, -0.55), 0.09);
      }
      break;
    }
    case 'tube': {
      rod(glass, look.glass, along(0), along(1), 0.22, 12);
      for (let i = 0; i <= ribs; i++) body.cyl(look.band, 0.25, 0.1, ...along(i / ribs, -0.05), 12, 0.25, { ry: yaw, rz: Math.PI / 2 });
      if (look.glow) rod(glow, look.lamp, along(0, -0.26), along(1, -0.26), 0.025, 5);
      else rod(body, look.main, along(0, -0.3), along(1, -0.3), 0.04, 6);
      break;
    }
    case 'gallery': {
      // floor plate + belt, four chords, braced sides, a roof with snow
      spanBox(body, look.post, along(0.5, -0.42), len, 0.08, 0.92, yaw);
      spanBox(body, look.band, along(0.5, -0.36), len, 0.04, 0.6, yaw);
      for (const s of [-1, 1]) {
        spanBox(body, look.main, along(0.5, -0.42, s * 0.46), len, 0.12, 0.1, yaw);
        spanBox(body, look.main, along(0.5, 0.38, s * 0.46), len, 0.12, 0.1, yaw);
        for (let i = 0; i < ribs; i++) {
          body.beam(look.main, along(i / ribs, -0.4, s * 0.46), along((i + 1) / ribs, 0.36, s * 0.46), 0.07);
          body.beam(look.main, along(i / ribs, -0.4, s * 0.46), along(i / ribs, 0.36, s * 0.46), 0.07);
        }
        spanBox(body, look.band, along(0.5, 0.48, s * 0.25), len, 0.06, 0.56, yaw);
      }
      spanBox(body, SNOW, along(0.5, 0.54), len, 0.07, 0.4, yaw);
      break;
    }
    case 'pipe': {
      rod(body, look.main, along(0), along(1), 0.22, 12);
      for (let i = 0; i <= ribs; i += 2) body.cyl(look.band, 0.26, 0.12, ...along(i / ribs, -0.06), 12, 0.26, { ry: yaw, rz: Math.PI / 2 });
      body.box(SNOW, len * 0.9, 0.06, 0.2, ...along(0.5, 0.18), { ry: yaw });
      if (len > 2.5) {
        // a thin companion line underneath
        rod(body, look.wire, along(0.06, -0.38), along(0.94, -0.38), 0.06, 6);
        for (const t of [0.1, 0.9]) body.beam(look.wire, along(t, -0.2), along(t, -0.38), 0.05);
      }
      break;
    }
    case 'tray': {
      spanBox(body, look.main, along(0.5, -0.1), len, 0.05, 0.62, yaw);
      for (const s of [-1, 1]) spanBox(body, look.main, along(0.5, -0.02, s * 0.31), len, 0.16, 0.04, yaw);
      for (const [off, c] of [[-0.16, look.wire], [0, look.post], [0.16, look.band]] as const) rod(body, c, along(0, -0.04, off), along(1, -0.04, off), 0.045, 6);
      for (let i = 1; i < ribs; i++) spanBox(body, look.post, along(i / ribs, -0.1), 0.05, 0.08, 0.7, yaw);
      for (const s of [-1, 1]) rod(glow, look.lamp, along(0, 0.07, s * 0.31), along(1, 0.07, s * 0.31), 0.018, 4);
      break;
    }
    default:
      break;
  }
}

/** Where a rigid link turns its corner (the arm meets the span). */
function joint(body: Kit, look: YardLinkLook, p: XZ): void {
  const { x, z } = p;
  switch (look.kind) {
    case 'flume':
      body.box(look.main, 0.84, 0.42, 0.84, x, SPAN_Y - 0.16, z);
      body.box(look.band, 0.88, 0.07, 0.88, x, SPAN_Y + 0.1, z);
      body.box(SNOW, 0.86, 0.08, 0.86, x, SPAN_Y + 0.26, z);
      break;
    case 'tube':
      body.sph(look.main, 0.27, x, SPAN_Y, z);
      body.box(SNOW, 0.3, 0.06, 0.3, x, SPAN_Y + 0.25, z);
      break;
    case 'pipe':
      body.sph(look.main, 0.27, x, SPAN_Y, z);
      body.cyl(look.band, 0.3, 0.14, x, SPAN_Y - 0.07, z, 12);
      body.box(SNOW, 0.36, 0.07, 0.36, x, SPAN_Y + 0.25, z);
      break;
    case 'gallery':
      body.box(look.main, 1.1, 0.9, 1.1, x, SPAN_Y - 0.45, z);
      body.gable(x, z, SPAN_Y + 0.45, 1.1, 1.1, 0.3, look.band, mixHex(look.band, look.post, 0.3), look.main, 0.08);
      break;
    case 'tray':
      body.box(look.main, 0.7, 0.24, 0.7, x, SPAN_Y - 0.14, z);
      break;
    default:
      break;
  }
}

/** The ropeway's empty return rope and the power lines' outer wires run this far behind the arm's end (away from the pads). */
const WIRE_BACK = [0, 0.45, 0.9] as const;

/** A wire link's cantilever: the jib from the riser's head back to its end, with wheels (ropeway) or insulators (power). */
function arm(body: Kit, look: YardLinkLook, r: XZ, e: XZ): void {
  const len = Math.hypot(e.x - r.x, e.z - r.z) || 1;
  const dx = (e.x - r.x) / len;
  const dz = (e.z - r.z) / len;
  const at = (back: number, y: number): V3 => [e.x + dx * back, y, e.z + dz * back];
  if (look.kind === 'ropeway') {
    const y = SPAN_Y + 0.62;
    body.beam(look.post, [r.x, y, r.z], at(ROPE_RETURN + 0.3, y), 0.22);
    body.beam(SNOW, [r.x, y + 0.14, r.z], at(ROPE_RETURN + 0.3, y + 0.14), 0.18);
    body.beam(look.post, [r.x, SPAN_Y - 0.4, r.z], at(-0.2, y - 0.1), 0.12);
    for (const back of [0, ROPE_RETURN]) {
      const [x, , z] = at(back, 0);
      body.torus(look.main, 0.24, 0.05, x, SPAN_Y + 0.4, z, undefined, 12);
      body.box(look.band, 0.1, 0.26, 0.1, x, SPAN_Y + 0.4, z);
    }
  } else {
    // power: a bracket out to a crossarm along the arm with three insulators
    body.beam(look.post, [r.x, SPAN_Y + 0.3, r.z], at(0.45, SPAN_Y + 0.3), 0.14);
    body.beam(look.post, [r.x, SPAN_Y - 0.5, r.z], at(0, SPAN_Y + 0.25), 0.1);
    body.beam(look.post, at(-0.2, SPAN_Y + 0.19), at(1.1, SPAN_Y + 0.19), 0.14);
    WIRE_BACK.forEach((back, k) => {
      const [x, , z] = at(back, 0);
      const up = k === 1 ? 0.22 : 0;
      if (up) body.box(look.post, 0.1, up, 0.1, x, SPAN_Y + 0.26, z);
      body.cyl(look.band, 0.07, 0.24, x, SPAN_Y + 0.26 + up, z, 8, 0.05);
    });
  }
}

/** A wire link's lines from arm end a to arm end b, sagging; returns the loaded line (the carriers' route). */
function wires(body: Kit, look: YardLinkLook, a: XZ, b: XZ, back: XZ): THREE.Vector3[] {
  const sh = SHAPE[look.kind];
  const line = (off: number, dy: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + back.x * off, SPAN_Y + sh.lift + dy - sh.sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t + back.z * off));
    }
    return pts;
  };
  const draw = (pts: THREE.Vector3[], r: number): void => {
    for (let i = 1; i < pts.length; i++) rod(body, look.wire, v3(pts[i - 1]!), v3(pts[i]!), r, 5);
  };
  if (look.kind === 'ropeway') {
    const track = line(0, 0);
    draw(track, 0.035);
    draw(line(ROPE_RETURN, 0), 0.03);
    return track;
  }
  const lines = WIRE_BACK.map((off, k) => line(off, k === 1 ? 0.22 : 0));
  for (const l of lines) draw(l, 0.03);
  return lines[1]!;
}

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

/** The links of era `era`'s region for this plan (an empty plan gives an empty root). */
export function createYardLinksModel(era: number, plan: YardLinkPlan): YardLinksModel {
  const look = YARD_LINKS[era] ?? YARD_LINKS[2]!;
  const wire = look.kind === 'ropeway' || look.kind === 'cable';
  const sh = SHAPE[look.kind];
  const root = new THREE.Group();
  root.name = 'yardLinks';
  const body = new Kit();
  const glow = new Kit();
  const glass = new Kit();
  // risers: their brace leans toward the machine's middle (world Z toward the slot centre)
  for (const r of plan.risers) {
    if (wire && !plan.links.some((k) => !k.branch && [0, 3].some((e) => k.path[e]!.x === r.x && k.path[e]!.z === r.z))) continue;
    const l = plan.links.find((k) => k.path[0]!.x === r.x && k.path[0]!.z === r.z) ?? plan.links.find((k) => k.path[3]!.x === r.x && k.path[3]!.z === r.z);
    const end = l ? (l.path[0]!.x === r.x && l.path[0]!.z === r.z ? l.path[1]! : l.path[2]!) : { x: r.x, z: r.z + 1 };
    riser(body, glow, look, r.x, r.z, Math.sign(r.z - end.z) || 1);
  }
  const routes: Route[] = [];
  for (const l of plan.links) {
    const [p0, p1, p2, p3] = l.path as [XZ, XZ, XZ, XZ];
    if (l.branch && wire) {
      // the lone machine's branch needs a rigid run (wires would need a mast in the aisle): not drawn
      continue;
    } else if (wire) {
      arm(body, look, p0, p1);
      arm(body, look, p3, p2);
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
      const track = wires(body, look, p1, p2, { x: (p1.x - p0.x) / len, z: (p1.z - p0.z) / len });
      routes.push(route(track.map((p) => p.clone().setY(p.y + sh.ride))));
    } else {
      piece(body, glow, glass, look, p0, p1);
      piece(body, glow, glass, look, p1, p2);
      piece(body, glow, glass, look, p2, p3);
      joint(body, look, p1);
      joint(body, look, p2);
      routes.push(route([p0, p1, p2, p3].map((p) => new THREE.Vector3(p.x, SPAN_Y + sh.lift + sh.ride, p.z))));
    }
  }

  const meshes: THREE.Mesh[] = [];
  if (!body.batch.empty) {
    const m = body.batch.mesh({ cast: true, receive: true, material: vcMat() });
    m.name = 'yardLinks body';
    meshes.push(m);
  }
  if (!glow.batch.empty) {
    const m = glow.batch.mesh({ cast: false, receive: false, material: glowMaterial(look.lamp, { vertexColors: true }) });
    m.name = 'yardLinks glow';
    meshes.push(m);
  }
  if (!glass.batch.empty) {
    const m = glass.batch.mesh({ cast: false, receive: false, material: toon(look.glass, { transparent: true, opacity: look.glassOpacity ?? 0.4, depthWrite: false }) });
    m.name = 'yardLinks glass';
    m.renderOrder = 1;
    meshes.push(m);
  }
  for (const m of meshes) root.add(m);

  // carriers: evenly spaced on every route, all on one instanced mesh
  const carrierOf: { route: number; s0: number }[] = [];
  routes.forEach((r, i) => {
    const n = Math.max(1, Math.floor(r.len / CARRIER_GAP));
    for (let k = 0; k < n; k++) carrierOf.push({ route: i, s0: (k / n) * r.len });
  });
  let carriers: THREE.InstancedMesh | null = null;
  let time = 0;
  let dirty = false;
  if (carrierOf.length > 0) {
    const geometry = carrierGeometry(look);
    const material = look.glow ? glowMaterial(look.carrier, { vertexColors: true }) : vcMat();
    const inst = new THREE.InstancedMesh(geometry, material, carrierOf.length);
    carriers = inst;
    inst.name = 'yardLinks carriers';
    inst.castShadow = false;
    inst.receiveShadow = !look.glow;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const box = new THREE.Box3();
    for (const r of routes) for (const p of r.pts) box.expandByPoint(p);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius += 1;
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const place = (): void => {
      for (let i = 0; i < carrierOf.length; i++) {
        const c = carrierOf[i]!;
        const r = routes[c.route]!;
        const s = (((c.s0 + time * CARRIER_SPEED) % r.len) + r.len) % r.len;
        const yaw = sampleRoute(r, s, pos);
        const k = Math.max(0.0001, Math.min(1, s / FADE, (r.len - s) / FADE));
        // buckets swing a little under the rope; gems turn; everything else rides level
        const swing = look.carrierShape === 'bucket' ? Math.sin(time * 2.1 + i * 1.7) * 0.08 : 0;
        const spin = look.carrierShape === 'gem' ? time * 2 + i : 0;
        e.set(spin, yaw, swing, 'YXZ');
        q.setFromEuler(e);
        sc.set(k, k, k);
        inst.setMatrixAt(i, m4.compose(pos, q, sc));
      }
      inst.instanceMatrix.needsUpdate = true;
    };
    place();
    inst.boundingSphere = sphere;
    // rebuilt only when three is about to draw them (off screen they cost nothing)
    inst.onBeforeRender = (): void => {
      if (!dirty) return;
      dirty = false;
      place();
    };
    root.add(inst);
  }

  return {
    root,
    carriers: carrierOf.length,
    update(dt: number): void {
      if (!carriers) return;
      time += dt;
      dirty = true;
    },
    dispose(): void {
      for (const m of meshes) m.geometry.dispose();
      carriers?.geometry.dispose();
      carriers?.dispose();
      root.removeFromParent();
    },
  };
}
