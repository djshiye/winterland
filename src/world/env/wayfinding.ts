/**
 * 0.9.9: finding the way between the areas. Shown with the new land (a child of the frontier group).
 *
 * - Fingerposts at every junction of the era trail (the Market Town's avenue on R1, the link roads' corners, the city
 *   streets' T-junctions on R2). Each arm points down a road and names the regions that way, nearest first, so from
 *   any junction the next era is one sign away. Arms are worked out from the era trail (eras/layout.ts eraTrail): one
 *   way along the trail lists the later eras, the other the earlier ones. A post shows once the roads it stands on are
 *   open (frontier.ts roadOpen).
 * - The customers' fenced lane by the village used to stop in the snow north of the pond: a trodden footpath with edge
 *   stones carries it on to R1.
 *
 * Everything is merged: the posts are one vertex-coloured mesh per post, the arm boards one textured mesh in all
 * (a single canvas atlas), the footpath one flat mesh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYOUT, PALETTE } from '../../config';
import { ERAS, RIVER_POND, ROADS, cityCol, type ERect } from '../../eras/data';
import { eraTrail, type XZ } from '../../eras/layout';
import { Batch } from '../../render/batch';
import { GAME_FONT, geo, makeCanvasTexture, toonUnique } from '../../render/materials';
import { romanNumeral } from './eras';

/** One fingerpost: the junction it serves (on the road), where the post stands (off the road), extra arms. */
export interface Junction {
  id: string;
  at: XZ;
  post: XZ;
  /** Roads the post stands on (it shows once all are open). */
  roads: string[];
  /** Arms that do not follow the era trail (to the town, the city). */
  extra?: Arm[];
  /** 0.9.12: false = no trail arms (a neighbouring post, under 15 m away, already points the way along the trail). */
  trail?: boolean;
}

/** A sign arm: unit direction along a world axis and its text. */
export interface Arm {
  dir: XZ;
  text: string;
}

const LAST_ERA = 10;

export const JUNCTIONS: readonly Junction[] = [
  { id: 'avenue', at: { x: 28, z: 64 }, post: { x: 24.9, z: 60.7 }, roads: ['southAvenue', 'r1'], extra: [{ dir: { x: 0, z: -1 }, text: 'Market Town' }] },
  { id: 'cityCorner', at: { x: 42, z: 64 }, post: { x: 38.9, z: 60.7 }, roads: ['r1', 'cityWest'], trail: false, extra: [{ dir: { x: 0, z: -1 }, text: 'Market Town · City' }, { dir: { x: 0, z: 1 }, text: 'R2 · Eras V–VIII' }] },
  { id: 'westCorner', at: { x: -182, z: 64 }, post: { x: -178.4, z: 60.7 }, roads: ['r1', 'westLink'] },
  { id: 'westFoot', at: { x: -182, z: 130 }, post: { x: -178.4, z: 126.7 }, roads: ['westLink', 'r2'] },
  { id: 'cityWestFoot', at: { x: 42, z: 128.3 }, post: { x: 38.9, z: 126.7 }, roads: ['cityWest', 'r2'], extra: [{ dir: { x: 0, z: -1 }, text: 'City · Market Town' }] },
  { id: 'cityV1Foot', at: { x: cityCol(1) - 2, z: 128.3 }, post: { x: cityCol(1) - 5.1, z: 126.7 }, roads: ['cityV1', 'r2'], extra: [{ dir: { x: 0, z: -1 }, text: 'City' }] },
  { id: 'cityV2Foot', at: { x: cityCol(2) - 2, z: 128.3 }, post: { x: cityCol(2) - 5.1, z: 126.7 }, roads: ['cityV2', 'r2'], extra: [{ dir: { x: 0, z: -1 }, text: 'City' }] },
  { id: 'eastCorner', at: { x: 196, z: 130 }, post: { x: 192.4, z: 126.7 }, roads: ['r2', 'eastLink'] },
  { id: 'eastFoot', at: { x: 196, z: 216 }, post: { x: 192.4, z: 212.7 }, roads: ['eastLink', 'r3'] },
];

interface TrailStop {
  n: number;
  s: number;
}

/** Arc length along the polyline to the point of it nearest `p`, and the segment index there. Pure. */
function project(line: readonly XZ[], p: XZ): { s: number; seg: number } {
  let best = { d: Infinity, s: 0, seg: 0 };
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (len * len))) : 0;
    const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best.d - 1e-6) best = { d, s: acc + len * t, seg: i - 1 };
    acc += len;
  }
  return best;
}

const axis = (a: XZ, b: XZ): XZ => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
};

/** "VII Tundra Fields · VI–II": the nearest region by name, the rest as numerals (a range past two). Pure. */
export function armText(eras: readonly number[]): string {
  if (eras.length === 0) return '';
  const [first, ...rest] = eras;
  const head = `${romanNumeral(first!)} ${ERAS[first!]!.region}`;
  if (rest.length === 0) return head;
  if (rest.length <= 2) return [head, ...rest.map((n) => romanNumeral(n))].join(' · ');
  return `${head} · ${romanNumeral(rest[0]!)}–${romanNumeral(rest[rest.length - 1]!)}`;
}

/** The point `s` metres along the polyline (clamped to its ends). Pure. */
function pointAt(line: readonly XZ[], s: number): XZ {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + len >= s && len > 0) {
      const t = Math.max(0, (s - acc) / len);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    acc += len;
  }
  return s <= 0 ? line[0]! : line[line.length - 1]!;
}

/** How far down the trail an arm looks to find its direction (so an arm by a corner points round it). */
const LOOK = 4;

/**
 * The arms of a junction's post: down the era trail toward the later eras, back toward the earlier ones (each only
 * when there are eras that way), then the junction's extra arms. Directions are world axes. Pure.
 */
export function signArms(j: Junction): Arm[] {
  if (j.trail === false) return [...(j.extra ?? [])];
  const line = eraTrail(LAST_ERA);
  const stops: TrailStop[] = [];
  for (let n = 2; n <= LAST_ERA; n++) {
    // eraTrail(n) ends 1 m out on the road from era n's gate
    const own = eraTrail(n);
    stops.push({ n, s: project(line, own[own.length - 1]!).s });
  }
  const here = project(line, j.at).s;
  const at = pointAt(line, here);
  const later = stops.filter((q) => q.s > here + 0.5).sort((a, b) => a.s - b.s).map((q) => q.n);
  const earlier = stops.filter((q) => q.s < here - 0.5).sort((a, b) => b.s - a.s).map((q) => q.n);
  const arms: Arm[] = [];
  if (later.length) arms.push({ dir: axis(at, pointAt(line, here + LOOK)), text: armText(later) });
  if (earlier.length) arms.push({ dir: axis(at, pointAt(line, here - LOOK)), text: armText(earlier) });
  return [...arms, ...(j.extra ?? [])];
}

/**
 * 0.9.12: the plan-view footprint of each arm of a post (from the post along the arm's axis), for the tests that keep
 * posts apart and arms from crossing. Pure.
 */
export function armSegments(j: Junction): Array<{ x0: number; z0: number; x1: number; z1: number }> {
  return signArms(j).map((a) => ({ x0: j.post.x, z0: j.post.z, x1: j.post.x + a.dir.x * (ARM_W + 0.12), z1: j.post.z + a.dir.z * (ARM_W + 0.12) }));
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

export const ARM_W = 3.2;
const ARM_H = 0.66;
const ROW_PX = 80;
const ATLAS_W = 768;
const POST_H = 3.3;
const BOARD = 0x8a5a36;
const BOARD_DARK = 0x5e3d25;

/** The customers' footpath from the end of their fenced lane down to R1 (world rect). Pure. */
export function footpathRect(): ERect {
  const lane = LAYOUT.customers.path;
  const r1 = ROADS.find((r) => r.id === 'r1')!.rect;
  return { minX: Math.max(lane.minX + 0.9, RIVER_POND.maxX + 1.4), maxX: lane.maxX - 0.6, minZ: lane.maxZ - 0.2, maxZ: r1.minZ + 0.3 };
}

export interface WayfindingPart {
  group: THREE.Group;
  /** `open(roadId)`: frontier.ts roadOpen for that road. */
  refresh(open: (road: string) => boolean): void;
}

export function buildWayfinding(): WayfindingPart {
  const group = new THREE.Group();
  group.name = 'wayfinding';

  // ---- the arms' text atlas: one row per arm
  const all = JUNCTIONS.map((j) => ({ j, arms: signArms(j) }));
  const rows = all.reduce((k, a) => k + a.arms.length, 0);
  const { canvas, ctx: g, texture } = makeCanvasTexture(ATLAS_W, THREE.MathUtils.ceilPowerOfTwo(rows * ROW_PX));
  texture.anisotropy = 8;
  const paint = (): void => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    let row = 0;
    for (const { arms } of all) {
      for (const a of arms) {
        const y = row * ROW_PX;
        const pointsRight = a.dir.x !== 0 ? a.dir.x > 0 : a.dir.z < 0;
        g.fillStyle = '#5e3d25';
        g.fillRect(0, y, ATLAS_W, ROW_PX);
        g.fillStyle = '#f4e3c3';
        g.fillRect(6, y + 6, ATLAS_W - 12, ROW_PX - 12);
        g.fillStyle = '#5e3d25';
        g.textBaseline = 'middle';
        let size = 44;
        g.font = `bold ${size}px ${GAME_FONT}`;
        const room = ATLAS_W - 110;
        while (g.measureText(a.text).width > room && size > 24) {
          size -= 2;
          g.font = `bold ${size}px ${GAME_FONT}`;
        }
        // the arrow tip on the side the arm points to
        const tipX = pointsRight ? ATLAS_W - 22 : 22;
        const back = pointsRight ? -36 : 36;
        g.beginPath();
        g.moveTo(tipX, y + ROW_PX / 2);
        g.lineTo(tipX + back, y + 20);
        g.lineTo(tipX + back, y + ROW_PX - 20);
        g.closePath();
        g.fill();
        g.textAlign = pointsRight ? 'left' : 'right';
        g.fillText(a.text, pointsRight ? 26 : ATLAS_W - 26, y + ROW_PX / 2 + 2);
        row++;
      }
    }
    texture.needsUpdate = true;
  };
  paint();
  void document.fonts?.ready.then(paint);

  // ---- posts (one mesh each, so each can show on its own) + all text faces in one mesh per post
  const faceMat = toonUnique(0xffffff, { map: texture });
  const posts: { j: Junction; obj: THREE.Object3D }[] = [];
  let row = 0;
  for (const { j, arms } of all) {
    const holder = new THREE.Group();
    holder.position.set(j.post.x, 0, j.post.z);
    const b = new Batch();
    b.add(geo.box(0.2, POST_H, 0.2), BOARD_DARK, 0, POST_H / 2, 0);
    b.add(geo.box(0.3, 0.08, 0.3), PALETTE.snow, 0, POST_H + 0.04, 0);
    b.add(geo.box(0.5, 0.12, 0.5), PALETTE.rock, 0, 0.06, 0);
    b.add(geo.box(0.8, 0.1, 0.8), PALETTE.snow, 0, 0.02, 0);
    const faces: THREE.BufferGeometry[] = [];
    arms.forEach((a, i) => {
      const y = POST_H - 0.42 - i * (ARM_H + 0.12);
      const alongX = a.dir.x !== 0;
      const cx = a.dir.x * (ARM_W / 2 + 0.06);
      const cz = a.dir.z * (ARM_W / 2 + 0.06);
      // the board (wood, thin), a snow line on top
      b.add(geo.box(alongX ? ARM_W : 0.07, ARM_H, alongX ? 0.07 : ARM_W), BOARD, cx, y, cz);
      b.add(geo.box(alongX ? ARM_W : 0.1, 0.05, alongX ? 0.1 : ARM_W), PALETTE.snow, cx, y + ARM_H / 2 + 0.02, cz);
      // the painted face toward the camera (+Z for an arm along X, +X for one along Z)
      const face = new THREE.PlaneGeometry(ARM_W - 0.04, ARM_H - 0.04);
      const v0 = 1 - (row + 1) / (canvas.height / ROW_PX);
      const v1 = 1 - row / (canvas.height / ROW_PX);
      const uv = face.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) > 0.5 ? v1 : v0);
      if (!alongX) face.rotateY(Math.PI / 2);
      face.translate(cx + (alongX ? 0 : 0.04), y, cz + (alongX ? 0.04 : 0));
      faces.push(face);
      row++;
    });
    holder.add(b.mesh({ cast: true }));
    const text = new THREE.Mesh(mergeGeometries(faces), faceMat);
    holder.add(text);
    holder.visible = false;
    group.add(holder);
    posts.push({ j, obj: holder });
  }

  // ---- the customers' footpath on to R1: trodden snow with a few edge stones
  const F = footpathRect();
  const fb = new Batch();
  const fw = F.maxX - F.minX;
  const fd = F.maxZ - F.minZ;
  fb.add(geo.box(fw, 0.02, fd), 0xd3deea, (F.minX + F.maxX) / 2, 0.011, (F.minZ + F.maxZ) / 2);
  fb.add(geo.box(fw * 0.42, 0.02, fd), 0xc7d3e2, (F.minX + F.maxX) / 2, 0.014, (F.minZ + F.maxZ) / 2);
  for (let z = F.minZ + 1.2; z < F.maxZ - 0.8; z += 2.1) {
    for (const x of [F.minX - 0.18, F.maxX + 0.18]) fb.add(geo.box(0.32, 0.16, 0.26), PALETTE.rock, x, 0.08, z + (x < 0 ? 0.3 : 0));
  }
  const foot = fb.mesh({ cast: false, receive: true });
  foot.visible = false;
  group.add(foot);

  const refresh = (open: (road: string) => boolean): void => {
    for (const p of posts) p.obj.visible = p.j.roads.every(open);
    foot.visible = open('r1');
  };
  return { group, refresh };
}
