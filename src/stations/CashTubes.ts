/**
 * [B6 — machines] Cash tubes: pneumatic tubes from every cash pile to the cabin. Each pile loses one bundle every
 * ctx.upgrades.value('cashTubes') seconds (read live), which shoots into the tube and is banked (ctx.economy.add).
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - piles(): the cash piles that exist right now (Level passes a getter; new piles appear as stations unlock).
 * - build(instant): visible + running; instant (restore) = final state, no animation / 'built' event / sound.
 * - Nothing is ever in flight as MONEY: the bundle is taken from the pile and banked at send time, the capsule that
 *   zips through the tube is only a visual. A save mid-flight therefore loses and doubles nothing.
 *
 * Network (ROUTES): every pile gets a funnel hanging over it and a glass tube that rises to its own height, then runs
 * overhead on posts (never lower than 3.3 m, posts only on spots nobody walks) to the receiver tower
 * (TOWER, in front of the cabin's south-east end, where it is not hidden by the roof). The routes of the known piles
 * share one lane (x = 2.4) and one east-west run (z = -5.6) at different heights, like a pipe rack. A pile id without a route gets a plain L-shaped tube. When a new pile appears the
 * geometry is rebuilt and the new tube grows out of its pile.
 * Draw calls: glass tubes 1 · hardware 1 (+1 shadow) · capsules 1 (instanced) · tower 2 + badge.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, PALETTE, rect, type XZ } from '../config';
import { createCashTower, cashCapsuleGeometry, TOWER_HEIGHT, type CashTowerModel } from '../assets/ridgeMachines';
import type { GameContext } from '../core/types';
import { Batch, vcMat } from '../render/batch';
import { geo, toon } from '../render/materials';
import type { CashPile } from './CashPile';

export interface CashTubesOptions {
  piles: () => readonly CashPile[];
}

/** Receiver tower in front of the cabin's south-east end (clear of the doormat, the lamp and the NPC routes). */
export const TOWER: XZ = { x: 9.1, z: -5.6 };

interface RouteDef {
  /** Tube height above the ground on its overhead run. */
  height: number;
  /** Horizontal waypoints after the pile and before the tower (the tower is appended). */
  via: readonly XZ[];
  /** Support posts (explicit spots; checked against every walking route by tests/ridgeMachines.test.ts). */
  posts: readonly XZ[];
}

const LANE = 2.4;
const RUN_Z = TOWER.z;
export const ROUTES: Record<string, RouteDef> = {
  'pile:walkInCash': {
    height: 3.3,
    via: [{ x: LANE, z: 8.8 }, { x: LANE, z: RUN_Z }],
    posts: [{ x: -0.9, z: 8.8 }, { x: LANE, z: 8.8 }, { x: LANE, z: 3.0 }, { x: LANE, z: -1.9 }],
  },
  'pile:seCash': {
    height: 3.6,
    via: [{ x: LANE, z: 6.0 }, { x: LANE, z: RUN_Z }],
    posts: [{ x: 8.0, z: 6.0 }, { x: LANE, z: 6.0 }],
  },
  'pile:platformCash': {
    height: 3.9,
    via: [{ x: 30.4, z: 8.8 }, { x: LANE, z: 8.8 }, { x: LANE, z: RUN_Z }],
    posts: [{ x: 30.4, z: 4.8 }, { x: 30.4, z: 8.8 }, { x: 22.2, z: 8.8 }, { x: 14.3, z: 8.8 }, { x: 9.8, z: 8.8 }],
  },
  // Wave 8: the sled cash pile (21.6, 6.0). The tube climbs to its own height, runs WEST along z = 6.0 (north of the sled
  // lane z 8.0 and the sled counter, south of the quarters pad) and joins the shared lane at x = 2.4. Posts: one just off
  // the pile's zone, one beyond the ridge crossing, then the seCash post and the shared-lane posts.
  'pile:sledCash': {
    height: 4.5,
    via: [{ x: LANE, z: 6.0 }, { x: LANE, z: RUN_Z }],
    posts: [{ x: 20.4, z: 6.0 }, { x: 14.3, z: 6.0 }, { x: 8.0, z: 6.0 }, { x: LANE, z: 6.0 }, { x: LANE, z: 3.0 }, { x: LANE, z: -1.9 }],
  },
  'pile:truckCash': {
    height: 4.2,
    via: [{ x: 4.6, z: -18.6 }, { x: 4.6, z: RUN_Z }],
    posts: [{ x: 4.6, z: -18.6 }, { x: 4.6, z: -12.8 }],
  },
};
/** Port heights shown as collars on the tower. */
const PORT_HEIGHTS = Object.values(ROUTES).map((r) => r.height);

const MOUTH_Y = 2.45;
const TUBE_R = 0.085;
const CAPSULE_SPEED = 17;
const MAX_CAPSULES = 80;
const PRELUDE = 0.2;
const POST_R = 0.06;

interface Route {
  id: string;
  /** 3D polyline from the funnel mouth to the tower. */
  pts: THREE.Vector3[];
  cum: number[];
  length: number;
  height: number;
  posts: readonly XZ[];
  timer: number;
  /** Vertex counts of this route's slice of the glass (index) / hardware (position) geometry. */
  glassFrom: number;
  glassCount: number;
  hardFrom: number;
  hardCount: number;
}

interface Capsule {
  active: boolean;
  route: Route | null;
  s: number;
  pre: number;
  start: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);

/** Cylinder from a to b as an indexed geometry. */
function tubeBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  v1.subVectors(b, a).normalize();
  q.setFromUnitVectors(UP, v1);
  m4.compose(v2.addVectors(a, b).multiplyScalar(0.5), q, one);
  g.applyMatrix4(m4);
  return g;
}

export class CashTubes {
  private running = false;
  private startAt = 0;
  private readonly routes: Route[] = [];
  private readonly capsules: Capsule[] = [];
  private readonly tower: CashTowerModel;
  private readonly group = new THREE.Group();
  private glass: THREE.Mesh | null = null;
  private hardware: THREE.Mesh | null = null;
  private readonly capsuleMesh: THREE.InstancedMesh;
  private readonly glassMat = toon(0xbfe8ff, { transparent: true, opacity: 0.42, depthWrite: false });
  private pulse = 0;
  private sparkleClock = 0;
  private revealRoute = -1;
  private revealK = 1;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: CashTubesOptions,
  ) {
    this.tower = createCashTower(PORT_HEIGHTS);
    this.tower.root.position.set(TOWER.x, 0, TOWER.z);
    this.group.visible = false;
    this.group.add(this.tower.root);
    const cm = new THREE.InstancedMesh(cashCapsuleGeometry(), vcMat(), MAX_CAPSULES);
    cm.castShadow = false;
    cm.receiveShadow = false;
    cm.frustumCulled = false;
    cm.count = 0;
    this.capsuleMesh = cm;
    this.group.add(cm);
    for (let i = 0; i < MAX_CAPSULES; i++) this.capsules.push({ active: false, route: null, s: 0, pre: 1, start: new THREE.Vector3() });
    ctx.scene.add(this.group);
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  build(instant = false): void {
    if (this.running) return;
    const ctx = this.ctx;
    this.running = true;
    ctx.colliders.addBox(rect(TOWER.x, TOWER.z, 1.2, 1.0), 'cashTower');
    this.tower.badge.setLevel(ctx.upgrades.level('cashTubes'));
    ctx.events.on('upgrade:bought', ({ id }) => {
      if (id !== 'cashTubes') return;
      ctx.tweens.squash(this.tower.root, 0.06, 0.45);
      this.tmp.set(TOWER.x, 2.4, TOWER.z);
      ctx.particles.puff(this.tmp, { count: 6, size: 0.6, life: 0.8 });
    });
    this.sync(instant);
    this.group.visible = true;
    if (instant) {
      this.startAt = ctx.time.elapsed;
      return;
    }
    this.startAt = ctx.time.elapsed + 1.4;
    ctx.tweens.popIn(this.tower.root, { duration: 0.5 });
    ctx.tweens.delay(0.55, () => ctx.tweens.squash(this.tower.root, 0.08, 0.35));
    ctx.events.emit('built', { what: 'cashTubes', position: new THREE.Vector3(TOWER.x, 0, TOWER.z), object: this.tower.root });
  }

  update(dt: number): void {
    if (!this.running) return;
    const ctx = this.ctx;
    this.tower.badge.setLevel(ctx.upgrades.level('cashTubes'));
    const piles = this.opts.piles();
    if (piles.length !== this.routes.length || piles.some((p) => !this.routes.some((r) => r.id === p.opts.id))) this.sync(false);

    if (ctx.time.elapsed >= this.startAt) {
      const interval = ctx.upgrades.value('cashTubes');
      for (let i = 0; i < this.routes.length; i++) {
        const r = this.routes[i]!;
        r.timer -= dt;
        if (r.timer > 0) continue;
        r.timer += interval;
        if (r.timer < 0) r.timer = 0;
        const pile = piles.find((p) => p.opts.id === r.id);
        if (pile) this.send(r, pile);
      }
    }
    this.stepCapsules(dt);

    // tower lamp pulse
    this.pulse = Math.max(0, this.pulse - dt * 5);
    this.tower.lampMaterial.emissiveIntensity = 0.4 + 1.6 * this.pulse;
    this.sparkleClock -= dt;
  }

  // ---------------------------------------------------------------------------

  /** Take one bundle from the pile, bank it now, and shoot a visual capsule through the tube. */
  private send(route: Route, cp: CashPile): void {
    const item = cp.pile.take('cash');
    if (!item) return;
    item.object.getWorldPosition(this.tmp);
    this.ctx.economy.add(item.value);
    this.ctx.items.release(item);
    const c = this.capsules.find((k) => !k.active);
    if (!c) return;
    c.active = true;
    c.route = route;
    c.s = 0;
    c.pre = 0;
    c.start.copy(this.tmp);
  }

  private stepCapsules(dt: number): void {
    let n = 0;
    for (const c of this.capsules) {
      if (!c.active || !c.route) continue;
      const r = c.route;
      if (c.pre < 1) {
        c.pre = Math.min(1, c.pre + dt / PRELUDE);
        const e = c.pre * c.pre;
        v1.copy(c.start).lerp(r.pts[0]!, e);
        v2.set(0, 1, 0);
      } else {
        c.s += dt * CAPSULE_SPEED;
        if (c.s >= r.length) {
          c.active = false;
          this.arrive();
          continue;
        }
        this.sampleRoute(r, c.s, v1, v2);
      }
      q.setFromUnitVectors(UP, v2);
      m4.compose(v1, q, one);
      this.capsuleMesh.setMatrixAt(n++, m4);
    }
    this.capsuleMesh.count = n;
    this.capsuleMesh.instanceMatrix.needsUpdate = true;
  }

  private arrive(): void {
    this.pulse = 1;
    if (this.sparkleClock <= 0) {
      this.sparkleClock = 0.35;
      this.tmp.set(TOWER.x, TOWER_HEIGHT + 0.6, TOWER.z);
      this.ctx.particles.sparkle(this.tmp, COLORS.CASH_GREEN);
    }
  }

  private sampleRoute(r: Route, s: number, pos: THREE.Vector3, dir: THREE.Vector3): void {
    let i = 0;
    while (i < r.cum.length - 2 && r.cum[i + 1]! <= s) i++;
    const a = r.pts[i]!;
    const b = r.pts[i + 1]!;
    const seg = r.cum[i + 1]! - r.cum[i]!;
    const t = seg > 1e-6 ? (s - r.cum[i]!) / seg : 0;
    pos.lerpVectors(a, b, Math.min(1, Math.max(0, t)));
    dir.subVectors(b, a).normalize();
  }

  /** Make `routes` match the piles that exist (new tubes appended, geometry rebuilt). */
  private sync(instant: boolean): void {
    const piles = this.opts.piles();
    // keep the order stable: existing routes first, in their original order, then newcomers
    const have = new Map(this.routes.map((r) => [r.id, r]));
    const next: Route[] = [];
    for (const r of this.routes) if (piles.some((p) => p.opts.id === r.id)) next.push(r);
    let added = -1;
    for (const p of piles) {
      if (have.has(p.opts.id)) continue;
      next.push(this.makeRoute(p, next.length));
      added = next.length - 1;
    }
    this.routes.length = 0;
    this.routes.push(...next);
    // restart capsules whose route is gone
    for (const c of this.capsules) if (c.active && c.route && !this.routes.includes(c.route)) c.active = false;
    this.rebuildGeometry();
    if (instant || added < 0) {
      this.revealRoute = -1;
      this.applyDraw();
      return;
    }
    this.revealRoute = added;
    this.revealK = 0;
    this.applyDraw();
    this.ctx.tweens.run({
      duration: 0.9,
      onUpdate: (k) => {
        this.revealK = k;
        this.applyDraw();
      },
      onComplete: () => {
        this.revealRoute = -1;
        this.applyDraw();
      },
    });
  }

  private makeRoute(pile: CashPile, index: number): Route {
    const def = ROUTES[pile.opts.id];
    const px = pile.opts.x;
    const pz = pile.opts.z;
    const h = def?.height ?? 4.5;
    const via: readonly XZ[] = def?.via ?? [{ x: px, z: TOWER.z }];
    const pts: THREE.Vector3[] = [new THREE.Vector3(px, MOUTH_Y, pz), new THREE.Vector3(px, h, pz)];
    for (const w of via) pts.push(new THREE.Vector3(w.x, h, w.z));
    pts.push(new THREE.Vector3(TOWER.x, h, TOWER.z));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    return {
      id: pile.opts.id,
      pts,
      cum,
      length: cum[cum.length - 1]!,
      height: h,
      posts: def?.posts ?? [{ x: px, z: pz }, { x: px, z: TOWER.z }],
      timer: 0.25 + index * 0.17,
      glassFrom: 0,
      glassCount: 0,
      hardFrom: 0,
      hardCount: 0,
    };
  }

  private rebuildGeometry(): void {
    const glassParts: THREE.BufferGeometry[] = [];
    const hardParts: THREE.BufferGeometry[] = [];
    let glassTotal = 0;
    let hardTotal = 0;
    // tallest post per spot over every known route, owned by the first route that uses it
    const maxPost = new Map<string, number>();
    const key = (p: XZ): string => `${p.x.toFixed(2)}|${p.z.toFixed(2)}`;
    for (const r of this.routes) for (const p of r.posts) maxPost.set(key(p), Math.max(maxPost.get(key(p)) ?? 0, r.height));
    const owned = new Set<string>();

    for (const r of this.routes) {
      // --- glass: segments + elbow spheres
      const gs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < r.pts.length - 1; i++) gs.push(tubeBetween(r.pts[i]!, r.pts[i + 1]!, TUBE_R));
      for (let i = 1; i < r.pts.length - 1; i++) {
        const s = new THREE.SphereGeometry(TUBE_R * 1.02, 8, 6);
        s.translate(r.pts[i]!.x, r.pts[i]!.y, r.pts[i]!.z);
        gs.push(s);
      }
      const gm = mergeGeometries(gs, false);
      for (const g of gs) g.dispose();
      r.glassFrom = glassTotal;
      r.glassCount = gm.index!.count;
      glassTotal += r.glassCount;
      glassParts.push(gm);

      // --- hardware: funnel, couplings, posts + saddles
      const b = new Batch();
      const mouth = r.pts[0]!;
      b.add(geo.cone(0.55, 0.4, 14), COLORS.COURIER_YELLOW, mouth.x, MOUTH_Y - 0.3, mouth.z);
      b.add(geo.cylinder(0.13, 0.13, 0.12, 10), PALETTE.metalDark, mouth.x, MOUTH_Y + 0.08, mouth.z);
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i]!;
        const c = r.pts[i + 1]!;
        const len = a.distanceTo(c);
        v1.subVectors(c, a).normalize();
        q.setFromUnitVectors(UP, v1);
        const n = Math.floor(len / 3);
        for (let k = 1; k <= n; k++) {
          v2.copy(a).addScaledVector(v1, (len * k) / (n + 1));
          m4.compose(v2, q, one);
          b.addMatrix(geo.cylinder(TUBE_R * 1.35, TUBE_R * 1.35, 0.1, 8), PALETTE.metalDark, m4);
        }
      }
      for (const p of r.posts) {
        // saddle at this route's own height; the post itself (tallest of all routes) belongs to the first route using it
        b.add(geo.cylinder(0.13, 0.13, 0.14, 8), COLORS.MACHINE_STEEL, p.x, r.height - 0.02, p.z);
        const k = key(p);
        if (owned.has(k)) continue;
        owned.add(k);
        const top = (maxPost.get(k) ?? r.height) - 0.1;
        b.add(geo.cylinder(POST_R, POST_R, 1, 8), PALETTE.metalDark, p.x, top / 2, p.z, { sy: top });
        b.add(geo.box(0.34, 0.07, 0.34), PALETTE.metalDark, p.x, 0.035, p.z);
      }
      const hm = b.geometry();
      r.hardFrom = hardTotal;
      r.hardCount = hm.getAttribute('position').count;
      hardTotal += r.hardCount;
      hardParts.push(hm);
    }

    this.glass?.geometry.dispose();
    this.hardware?.geometry.dispose();
    if (glassParts.length > 0) {
      const gGeo = mergeGeometries(glassParts, false);
      const hGeo = mergeGeometries(hardParts, false);
      for (const g of glassParts) g.dispose();
      for (const g of hardParts) g.dispose();
      if (!this.glass) {
        this.glass = new THREE.Mesh(gGeo, this.glassMat);
        this.glass.castShadow = false;
        this.glass.receiveShadow = false;
        this.glass.renderOrder = 2;
        this.glass.frustumCulled = false;
        this.hardware = new THREE.Mesh(hGeo, vcMat());
        this.hardware.castShadow = true;
        this.hardware.receiveShadow = true;
        this.hardware.frustumCulled = false;
        this.group.add(this.glass, this.hardware);
      } else {
        this.glass.geometry = gGeo;
        this.hardware!.geometry = hGeo;
      }
    }
  }

  /** Draw everything, except the not-yet-grown part of the route being revealed. */
  private applyDraw(): void {
    if (!this.glass || !this.hardware) return;
    let g = this.glass.geometry.index!.count;
    let h = this.hardware.geometry.getAttribute('position').count;
    const r = this.routes[this.revealRoute];
    if (r) {
      g = r.glassFrom + Math.floor((r.glassCount * this.revealK) / 3) * 3;
      h = r.hardFrom + Math.floor((r.hardCount * this.revealK) / 3) * 3;
    }
    this.glass.geometry.setDrawRange(0, g);
    this.hardware.geometry.setDrawRange(0, h);
  }
}
