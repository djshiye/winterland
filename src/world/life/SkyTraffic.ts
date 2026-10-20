/**
 * 0.9.13 (review E4): every flier casts a soft ground shadow (one instanced blob mesh), so it reads as high above the town and not parked on it.
 * The heights keep a flier and its shadow on one screen at the default zoom (a height y shows 0.67 y above its shadow):
 * the sleigh 14 m, the airship 15 m (was 19, its shadow fell off screen), the drones 10 m.
 * 0.9.12 (Dino: "era street traffic"): something of each era's own up in the air over its town.
 * Every open era area has them: eras II-IV a reindeer sleigh circling high over the town, eras V-VII a slow airship in the era's colours with
 * lit gondola windows, eras VIII-X little delivery drones shuttling parcels between the market and the huts.
 *
 * The vehicle rules (npc/vehicleView.ts) hold without the road network: a flier keeps flying its loop all the time
 * and is only shown once it is somewhere off screen, and only put away once it is off screen again, so it never pops
 * in or out in view; its nose always points along its loop. Fliers stay out of the traffic registry on purpose:
 * nobody on the ground waits at a kerb for a sleigh in the sky. Cheap: at most 17 small meshes, culled off screen, plus one instanced shadow mesh.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import type { GameContext } from '../../core/types';
import { ERAS, REGIONS } from '../../eras/data';
import { regionLayout } from '../../eras/layout';
import { inView } from '../../npc/vehicleView';
import { Batch, vcMat } from '../../render/batch';
import { geo } from '../../render/materials';
import { bulbMaterial } from '../env/glow';

type Kind = 'sleigh' | 'airship' | 'drone';

/** How far (m per m of height) a loop is moved toward the camera so a flier shows over the town it circles. */
const SCREEN_LIFT = 0.5;

/** One closed loop: an ellipse round `c` with half-axes `a` along `u` and `b` across it, at height `y`. */
interface Loop {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  a: number;
  b: number;
  y: number;
}

interface Flier {
  readonly kind: Kind;
  readonly root: THREE.Group;
  readonly loop: Loop;
  readonly speed: number;
  readonly rotors: THREE.Object3D[];
  th: number;
  on: boolean;
}

export function kindFor(n: number): Kind | null {
  if (n >= 2 && n <= 4) return 'sleigh';
  if (n >= 5 && n <= 7) return 'airship';
  if (n >= 8 && n <= 10) return 'drone';
  return null;
}

/** Where on its loop a flier is at angle `th`, and which way it flies (unit XZ). */
export function loopAt(l: Loop, th: number, out = { x: 0, z: 0, fx: 0, fz: 0 }): { x: number; z: number; fx: number; fz: number } {
  const c = Math.cos(th);
  const s = Math.sin(th);
  out.x = l.cx + l.ux * l.a * c - l.uz * l.b * s;
  out.z = l.cz + l.uz * l.a * c + l.ux * l.b * s;
  const dx = -l.ux * l.a * s - l.uz * l.b * c;
  const dz = -l.uz * l.a * s + l.ux * l.b * c;
  const d = Math.hypot(dx, dz) || 1;
  out.fx = dx / d;
  out.fz = dz / d;
  return out;
}

/** The loops era `n`'s fliers keep to. */
export function loopsFor(n: number): Loop[] {
  const R = REGIONS[n]?.rect;
  const kind = kindFor(n);
  if (!R || !kind) return [];
  // the loops circle the town (the market and the huts); a flier high up shows on screen above a point further from
  // the camera, so its loop is nudged toward the camera (+X +Z) by its height to look as if it is over the town
  const Z = regionLayout(n).zones;
  const mx = (Z.market.minX + Z.market.maxX) / 2;
  const mz = (Z.market.minZ + Z.market.maxZ) / 2;
  const hx = (Z.huts.minX + Z.huts.maxX) / 2;
  const hz = (Z.huts.minZ + Z.huts.maxZ) / 2;
  const tx = (mx + hx) / 2;
  const tz = (mz + hz) / 2;
  const lift = (y: number): number => y * SCREEN_LIFT;
  // the big loops keep inside the area (a town by its fence is circled from the inside)
  const round = (a: number, b: number, y: number): Loop => ({
    cx: clamp(tx, R.minX + a + 2, R.maxX - a - 2) + lift(y),
    cz: clamp(tz, R.minZ + b + 2, R.maxZ - b - 2) + lift(y),
    ux: 1,
    uz: 0,
    a,
    b,
    y,
  });
  if (kind === 'sleigh') return [round(15, 10, 14)];
  if (kind === 'airship') return [round(14, 9, 15)];
  // drones: long thin loops from the market to the huts and back, side by side
  const L = Math.hypot(hx - mx, hz - mz) || 1;
  const ux = (hx - mx) / L;
  const uz = (hz - mz) / L;
  return [-3, 0, 3].map((o, i) => ({ cx: tx - uz * o + lift(10), cz: tz + ux * o + lift(10), ux, uz, a: L / 2 + 2, b: 1.6, y: 10 + i * 0.7 }));
}

// ---- models (built once per kind and era tint) ------------------------------------------------------------------------

function sleighModel(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const b = new Batch();
  const red = 0xc8352e;
  const gold = 0xe2b04a;
  // the sleigh: a curled box seat on two runners
  b.add(geo.box(1.0, 0.45, 1.5), red, 0, 0.45, 0);
  b.add(geo.box(1.0, 0.55, 0.3), red, 0, 0.75, -0.6);
  b.add(geo.cylinder(0.22, 0.22, 1.0, 10), red, 0, 0.62, 0.72, { rz: Math.PI / 2 });
  for (const x of [-0.45, 0.45]) {
    b.add(geo.box(0.07, 0.07, 1.9), gold, x, 0.08, 0.05);
    b.add(geo.cylinder(0.12, 0.12, 0.07, 10), gold, x, 0.2, 1.0, { rz: Math.PI / 2 });
  }
  b.add(geo.box(1.05, 0.06, 1.55), gold, 0, 0.7, 0);
  // the driver and a sack of parcels
  b.add(geo.capsule(0.22, 0.3, 4, 8), red, 0, 0.98, -0.25);
  b.add(geo.sphere(0.17, 10, 8), 0xf1d2b8, 0, 1.38, -0.25);
  b.add(geo.cone(0.17, 0.32, 10), red, 0, 1.6, -0.25);
  b.add(geo.sphere(0.06, 6, 4), 0xffffff, 0, 1.77, -0.25);
  b.add(geo.sphere(0.32, 10, 8), 0x8a5a36, 0, 0.88, -0.75, { sy: 1.2 });
  // two reindeer on a harness ahead (+Z is forward)
  for (const [x, z] of [
    [-0.32, 2.0],
    [0.32, 2.0],
    [-0.32, 3.2],
    [0.32, 3.2],
  ] as const) {
    b.add(geo.capsule(0.17, 0.55, 4, 8), 0x8b5a3c, x, 0.55, z, { rx: Math.PI / 2 });
    b.add(geo.box(0.07, 0.42, 0.07), 0x6b4128, x, 0.25, z + 0.28, { rx: -0.6 });
    b.add(geo.box(0.07, 0.42, 0.07), 0x6b4128, x, 0.25, z - 0.28, { rx: 0.6 });
    b.add(geo.capsule(0.1, 0.25, 4, 8), 0x8b5a3c, x, 0.82, z + 0.45, { rx: 0.5 });
    b.add(geo.sphere(0.12, 8, 6), 0x8b5a3c, x, 1.02, z + 0.62, { sz: 1.3 });
    for (const s of [-1, 1]) b.add(geo.box(0.03, 0.25, 0.03), 0xd9c09a, x + s * 0.07, 1.22, z + 0.56, { rz: s * 0.5 });
  }
  b.add(geo.box(0.05, 0.05, 2.4), gold, 0, 0.5, 2.0);
  const g = new Batch();
  g.add(geo.sphere(0.06, 8, 6), 0xff5040, -0.32, 1.02, 3.92);
  g.add(geo.sphere(0.09, 8, 6), 0xffd27a, 0.45, 0.95, 0.95);
  return { body: b.geometry(), glow: g.geometry() };
}

function airshipModel(body: number, trim: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const b = new Batch();
  b.add(geo.sphere(1, 20, 14), body, 0, 2.2, 0, { sx: 1.35, sy: 1.35, sz: 4.2 });
  for (const z of [-1.6, 0, 1.6]) b.add(geo.cylinder(1.38 * Math.sqrt(1 - (z / 4.2) ** 2) + 0.02, 1.38 * Math.sqrt(1 - (z / 4.2) ** 2) + 0.02, 0.16, 20), trim, 0, 2.2, z, { rx: Math.PI / 2 });
  // tail fins
  for (const [rz, x, y] of [
    [0, 0, 3.0],
    [0, 0, 1.4],
    [Math.PI / 2, 0.8, 2.2],
    [Math.PI / 2, -0.8, 2.2],
  ] as const) b.add(geo.box(0.08, 0.9, 1.2), trim, x, y, -3.6, { rz });
  // the gondola
  b.add(geo.box(0.7, 0.45, 1.8), 0x5a4636, 0, 0.55, 0.2);
  b.add(geo.box(0.76, 0.06, 1.86), trim, 0, 0.8, 0.2);
  for (const z of [-0.4, 0.8]) b.add(geo.box(0.04, 0.6, 0.04), 0x3a2e26, 0, 1.15, z);
  b.add(geo.cylinder(0.05, 0.05, 0.5, 6), 0x3a2e26, 0, 0.55, -0.85, { rx: Math.PI / 2 });
  const g = new Batch();
  for (const s of [-1, 1]) for (const z of [-0.3, 0.2, 0.7]) g.add(geo.box(0.02, 0.16, 0.22), 0xffd88a, s * 0.36, 0.6, z);
  g.add(geo.sphere(0.07, 8, 6), 0xff5a4a, 0, 0.3, -0.2);
  return { body: b.geometry(), glow: g.geometry() };
}

function droneModel(body: number, glow: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const b = new Batch();
  b.add(geo.box(0.42, 0.14, 0.42), body, 0, 0.5, 0);
  for (const r of [Math.PI / 4, -Math.PI / 4]) b.add(geo.box(1.1, 0.05, 0.07), 0x3b4048, 0, 0.52, 0, { ry: r });
  for (const [x, z] of [
    [-0.4, -0.4],
    [0.4, -0.4],
    [-0.4, 0.4],
    [0.4, 0.4],
  ] as const) b.add(geo.cylinder(0.05, 0.05, 0.1, 8), 0x3b4048, x, 0.58, z);
  // the parcel on a short line
  b.add(geo.box(0.02, 0.3, 0.02), 0x3b4048, 0, 0.3, 0);
  b.add(geo.box(0.34, 0.26, 0.34), 0xc89a62, 0, 0.05, 0);
  b.add(geo.box(0.35, 0.04, 0.08), 0xd8453c, 0, 0.05, 0);
  const g = new Batch();
  g.add(geo.sphere(0.06, 8, 6), glow, 0, 0.44, 0.2);
  g.add(geo.sphere(0.04, 6, 4), 0xff4a3a, 0, 0.44, -0.22);
  return { body: b.geometry(), glow: g.geometry() };
}

function rotorGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.box(0.5, 0.015, 0.06), 0x2c3036, 0, 0, 0);
  b.add(geo.box(0.06, 0.015, 0.5), 0x2c3036, 0, 0, 0);
  return b.geometry();
}

const _o = { x: 0, z: 0, fx: 0, fz: 0 };
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Most fliers at once (3 sleighs, 3 airships, 3 x 3 drones), with room to spare. */
const MAX_FLIERS = 24;
/** Shadow footprint (width x length, m) per kind, long along the heading. */
const SHADOW_SIZE: Record<Kind, readonly [number, number]> = { sleigh: [2.2, 4.4], airship: [3.2, 6.0], drone: [0.9, 0.9] };
/** How far (m) each kind bobs up and down, for shrinking its shadow as it rises. */
const BOB_AMP: Record<Kind, number> = { sleigh: 0.35, airship: 0.35, drone: 0.12 };

/** A soft round blob (white, fading to clear at the edge); null where there is no canvas (tests in node). */
function blobTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class SkyTraffic {
  readonly group = new THREE.Group();
  private readonly fliers: Flier[] = [];
  /** Era areas up to this one have their fliers. */
  private built = 1;
  private time = 0;
  /** One soft blob on the ground under each flier: a single draw call. */
  private readonly shadows: THREE.InstancedMesh;

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'sky-traffic';
    const disc = new THREE.CircleGeometry(1, 24);
    disc.rotateX(-Math.PI / 2);
    const tex = blobTexture();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2a2440,
      map: tex,
      transparent: true,
      opacity: tex ? 0.32 : 0.12,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.shadows = new THREE.InstancedMesh(disc, mat, MAX_FLIERS);
    this.shadows.name = 'sky-shadows';
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.castShadow = false;
    this.shadows.receiveShadow = false;
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows);
  }

  /** Fliers showing (tests). */
  get shown(): number {
    return this.fliers.filter((f) => f.on).length;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    // every open era area keeps its fliers in the air from then on (a dozen small meshes, culled off screen)
    const age = Math.min(10, this.ctx.state?.eras.age ?? 0);
    while (this.built < age) if (kindFor(++this.built)) this.build(this.built);
    for (let i = 0; i < this.fliers.length; i++) {
      const f = this.fliers[i]!;
      f.th += (f.speed / ((f.loop.a + f.loop.b) / 2)) * dt;
      loopAt(f.loop, f.th, _o);
      const bob = f.kind === 'drone' ? Math.sin(this.time * 3 + f.th * 2) * 0.12 : Math.sin(this.time * 0.8 + f.th) * 0.35;
      f.root.position.set(_o.x, f.loop.y + bob, _o.z);
      f.root.rotation.set(0, Math.atan2(_o.fx, _o.fz), f.kind === 'sleigh' ? -0.18 : f.kind === 'airship' ? -0.05 : -0.12, 'YXZ');
      for (const r of f.rotors) r.rotation.y = this.time * 40;
      // a new flier only shows once it is somewhere off screen, so it never pops into view
      if (!f.on && !this.seen(f)) {
        f.on = true;
        f.root.visible = true;
      }
      // the shadow lies directly below, yawed like the flier, a little smaller as the bob lifts it; none before the flier shows
      const [w, l] = SHADOW_SIZE[f.kind];
      const k = f.on ? 1 - 0.15 * clamp((bob / BOB_AMP[f.kind] + 1) / 2, 0, 1) : 0;
      _p.set(_o.x, 0.06, _o.z);
      _q.setFromAxisAngle(_up, f.root.rotation.y);
      _s.set((w / 2) * k, 1, (l / 2) * k);
      this.shadows.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.shadows.count = this.fliers.length;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  private seen(f: Flier): boolean {
    const p = f.root.position;
    return inView(this.ctx, p.x, p.z, f.kind === 'airship' ? 6 : 4, p.y);
  }

  private build(n: number): void {
    const kind = kindFor(n)!;
    const c = ERAS[n]!.colors;
    const loops = loopsFor(n);
    loops.forEach((loop, i) => {
      const m = kind === 'sleigh' ? sleighModel() : kind === 'airship' ? airshipModel(c.accent, c.trim) : droneModel(c.body, c.glow);
      const root = new THREE.Group();
      root.name = `sky-${kind}`;
      const body = new THREE.Mesh(m.body, vcMat());
      const glow = new THREE.Mesh(m.glow, bulbMaterial());
      root.add(body, glow);
      const rotors: THREE.Object3D[] = [];
      if (kind === 'drone') {
        const rg = rotorGeometry();
        for (const [x, z] of [
          [-0.4, -0.4],
          [0.4, -0.4],
          [-0.4, 0.4],
          [0.4, 0.4],
        ] as const) {
          const r = new THREE.Mesh(rg, vcMat());
          r.position.set(x, 0.64, z);
          root.add(r);
          rotors.push(r);
        }
      }
      if (kind === 'airship') root.scale.setScalar(0.6);
      root.visible = false;
      this.group.add(root);
      this.fliers.push({ kind, root, loop, speed: kind === 'sleigh' ? 6 : kind === 'airship' ? 2.2 : 4.5, rotors, th: (i / loops.length) * Math.PI * 2 + i * 0.7, on: false });
    });
  }
}
