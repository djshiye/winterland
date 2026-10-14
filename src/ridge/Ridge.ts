/**
 * [B3 — world/ridge] Timber Ridge: the snowy land east of the tricycle road (LAYOUT.ridge), opened by the 'ridge'
 * pad. A gate in the yard's east fence and a crossing over the road lead to a pine forest (the tree feller's work
 * area), the log deck, the rail line + platform (freight trains) and the crew bunkhouse site.
 *
 * CONTRACT (keep every public signature; B3 owns the implementation):
 * - State: ctx.state.unlocked.ridge is the truth. The constructor builds everything; when already unlocked it
 *   reveals at once and silently (restored save). Level calls reveal(false) on the live unlock.
 * - reveal(instant): opens the gate, adds LAYOUT.ridge.walk to ctx.colliders (addBounds), shows the ridge.
 *   Idempotent. No events of its own (the pad's unlock moment is the event).
 * - trees: every pine the feller can cut (index, x, z, standing). fell(i) topples a standing tree (animation unless
 *   hidden), marks it not standing, emits 'tree:felled', and it regrows after RIDGE.regrowSeconds. Trees are not
 *   saved: a reload starts with a full forest.
 * - nearestStanding(x, z): the closest standing pine, or null.
 *
 * Implementation: the forest is two InstancedMeshes (a round and a tall pine model) plus one for the stumps; every
 * tree has a slot in one of the pine meshes and in the stump mesh. A fell tilts the instance about its base, then
 * shrinks it away and pops its stump in; regrowth pops the pine back with a back-out grow-in. Only the instances that
 * are animating are re-composed each frame. Pines with a trunk collider are solid while standing.
 */
import * as THREE from 'three';
import { LAYOUT, RIDGE } from '../config';
import { vcMat } from '../render/batch';
import { stumpGeo, pineGeo, pineTallGeo } from '../world/env/props';
import { Rng } from '../world/env/common';
import { buildRidgeScenery } from '../assets/ridgeScenery';
import type { ColliderHandle } from '../world/Colliders';
import type { GameContext } from '../core/types';

export interface PineTree {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  standing: boolean;
}

type Phase = 'stand' | 'fall' | 'lie' | 'sink' | 'gone' | 'grow';

interface Slot {
  mesh: 0 | 1;
  /** Instance index in its pine mesh. */
  slot: number;
  yaw: number;
  scale: number;
  /** Fall axis (horizontal, perpendicular to the fall direction). */
  axisX: number;
  axisZ: number;
  phase: Phase;
  /** Seconds in the current phase (negative = waiting for the reveal stagger). */
  t: number;
  collider: ColliderHandle | null;
  /** The stump is showing (the tree was felled and has not finished growing back). */
  stumpShown: boolean;
}

const FALL_TIME = 0.8;
const LIE_TIME = 0.45;
const SINK_TIME = 0.25;
const GROW_TIME = 0.9;
const HIDDEN = 0.0001;
const TRUNK_RADIUS = 0.4;
const TREE_COUNT = 30;

const backOut = (t: number): number => {
  const c1 = 1.7;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class Ridge {
  /** Everything the ridge draws hangs under this group. */
  readonly root = new THREE.Group();
  readonly trees: PineTree[] = [];
  private open = false;
  private readonly regrow = new Map<number, number>();

  private readonly ground: THREE.Group;
  private readonly props: THREE.Group;
  private readonly pines: [THREE.InstancedMesh, THREE.InstancedMesh];
  private readonly stumps: THREE.InstancedMesh;
  private readonly slots: Slot[] = [];
  /** Indices of trees with a running animation. */
  private readonly active = new Set<number>();
  /** Reveal wipe: 0…1 progress, null when idle. */
  private revealT: number | null = null;
  private readonly tmpPos = new THREE.Vector3();
  private readonly qYaw = new THREE.Quaternion();
  private readonly qTilt = new THREE.Quaternion();
  private readonly mat = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly axis = new THREE.Vector3();

  constructor(readonly ctx: GameContext) {
    this.root.name = 'ridge';
    this.root.visible = false;
    ctx.scene.add(this.root);

    const scenery = buildRidgeScenery();
    this.ground = scenery.ground;
    this.props = scenery.props;
    this.root.add(this.ground, this.props);

    // ---- forest: seeded dart throwing inside LAYOUT.ridge.forest, kept off the rail side ----------------------
    const f = LAYOUT.ridge.forest;
    const rng = new Rng(7071);
    const minX = f.minX + 0.9;
    const maxX = Math.min(f.maxX - 1.6, LAYOUT.ridge.rail.x - 2.6);
    const minZ = f.minZ + 0.9;
    const maxZ = f.maxZ - 0.9;
    const placed: Array<{ x: number; z: number; scale: number; tall: boolean }> = [];
    for (let dist = 2.1; placed.length < TREE_COUNT && dist > 1.4; dist -= 0.1) {
      for (let tries = 0; tries < 800 && placed.length < TREE_COUNT; tries++) {
        const x = rng.range(minX, maxX);
        const z = rng.range(minZ, maxZ);
        if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < dist * dist)) continue;
        placed.push({ x, z, scale: rng.range(0.85, 1.2), tall: rng.next() < 0.4 });
      }
    }
    // Front rows first: the reveal grows trees from the road side, and the feller picks the nearest anyway.
    placed.sort((a, b) => a.x + a.z * 0.2 - (b.x + b.z * 0.2));

    const counts = [0, 0];
    placed.forEach((p, i) => {
      const mesh = p.tall ? 1 : 0;
      const dir = rng.range(0, Math.PI * 2);
      const slot: Slot = {
        mesh,
        slot: counts[mesh]!++,
        yaw: rng.range(0, Math.PI * 2),
        scale: p.scale,
        // fall direction d = (cos dir, sin dir) in XZ; tilt axis = up × d
        axisX: Math.sin(dir),
        axisZ: -Math.cos(dir),
        phase: 'stand',
        t: 0,
        collider: ctx.colliders.addCircle(p.x, p.z, TRUNK_RADIUS, 'pine'),
        stumpShown: false,
      };
      this.slots.push(slot);
      this.trees.push({ index: i, x: p.x, z: p.z, standing: true });
    });

    const mat = vcMat();
    const mk = (geo: THREE.BufferGeometry, n: number, name: string): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      im.name = name;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false; // toppling trees leave the static bounding sphere
      im.count = n;
      return im;
    };
    this.pines = [mk(pineGeo(), counts[0]!, 'ridgePines'), mk(pineTallGeo(), counts[1]!, 'ridgePinesTall')];
    this.stumps = mk(stumpGeo(), this.trees.length, 'ridgeStumps');
    this.root.add(this.pines[0], this.pines[1], this.stumps);
    for (let i = 0; i < this.slots.length; i++) this.compose(i);
    this.flush(true);

    if (ctx.state.unlocked.ridge) this.reveal(true);
  }

  get revealed(): boolean {
    return this.open;
  }

  reveal(instant = false): void {
    if (this.open) return;
    this.open = true;
    this.root.visible = true;
    for (const r of LAYOUT.ridge.walk) this.ctx.colliders.addBounds(r);
    this.ctx.environment.openRidgeGate(instant);
    if (instant) {
      this.setWipe(1);
      return;
    }
    // The moment: the gate swings, the snow rolls out from the road, props pop up, pines grow in front to back.
    this.revealT = 0;
    this.setWipe(0);
    const gz = (LAYOUT.ridge.gate.minZ + LAYOUT.ridge.gate.maxZ) / 2;
    this.slots.forEach((s, i) => {
      const t = this.trees[i]!;
      if (!t.standing) return;
      s.phase = 'grow';
      s.t = -(0.5 + (t.x - LAYOUT.ridge.forest.minX) * 0.05 + Math.abs(t.z - gz) * 0.01);
      this.active.add(i);
      this.compose(i);
    });
    this.flush(false);
    this.tmpPos.set(LAYOUT.yard.maxX + 1.2, 0.5, gz);
    this.ctx.particles.puff(this.tmpPos, { color: 0xffffff, count: 8, size: 1.2, life: 1.0 });
    this.ctx.audio.play('whoosh', { volume: 0.5 });
  }

  nearestStanding(x: number, z: number): PineTree | null {
    let best: PineTree | null = null;
    let bd = Infinity;
    for (const t of this.trees) {
      if (!t.standing) continue;
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  fell(index: number): boolean {
    const t = this.trees[index];
    if (!t || !t.standing) return false;
    t.standing = false;
    const s = this.slots[index]!;
    if (s.collider) s.collider.enabled = false;
    s.stumpShown = true;
    this.regrow.set(index, RIDGE.regrowSeconds);
    if (this.open) {
      s.phase = 'fall';
      s.t = 0;
      this.active.add(index);
    } else {
      s.phase = 'gone';
      this.active.delete(index);
    }
    this.compose(index);
    this.flush(false);
    this.ctx.events.emit('tree:felled', { index, position: new THREE.Vector3(t.x, 0, t.z) });
    return true;
  }

  update(dt: number): void {
    for (const [i, left] of this.regrow) {
      if (left - dt > 0) this.regrow.set(i, left - dt);
      else {
        this.regrow.delete(i);
        this.grow(i);
      }
    }
    if (this.revealT !== null) {
      this.revealT = Math.min(1, this.revealT + dt / 1.5);
      this.setWipe(this.revealT);
      if (this.revealT >= 1) this.revealT = null;
    }
    if (this.active.size === 0) return;
    for (const i of this.active) {
      const s = this.slots[i]!;
      s.t += dt;
      switch (s.phase) {
        case 'fall':
          if (s.t >= FALL_TIME) {
            s.phase = 'lie';
            s.t = 0;
            const t = this.trees[i]!;
            this.tmpPos.set(t.x - s.axisZ * 1.6, 0.3, t.z + s.axisX * 1.6);
            this.ctx.particles.puff(this.tmpPos, { color: 0xffffff, count: 4, size: 0.9, life: 0.7 });
          }
          break;
        case 'lie':
          if (s.t >= LIE_TIME) {
            s.phase = 'sink';
            s.t = 0;
          }
          break;
        case 'sink':
          if (s.t >= SINK_TIME) {
            s.phase = 'gone';
            this.active.delete(i);
          }
          break;
        case 'grow':
          if (s.t >= GROW_TIME) {
            s.phase = 'stand';
            s.stumpShown = false;
            this.active.delete(i);
          }
          break;
        default:
          this.active.delete(i);
      }
      this.compose(i);
    }
    this.flush(false);
  }

  // ---- regrowth / reveal ------------------------------------------------------------------------------
  private grow(i: number): void {
    const t = this.trees[i]!;
    const s = this.slots[i]!;
    t.standing = true;
    if (s.collider) s.collider.enabled = true;
    if (this.open) {
      s.phase = 'grow';
      s.t = 0;
      this.active.add(i);
    } else {
      s.phase = 'stand';
      s.stumpShown = false;
    }
    this.compose(i);
    this.flush(false);
  }

  /** Reveal wipe: snow rolls out from the road (scale X about the road side), props pop up. */
  private setWipe(k: number): void {
    const x0 = LAYOUT.tricycles.road.maxX;
    const sx = Math.max(0.001, k);
    this.ground.scale.x = sx;
    this.ground.position.x = x0 * (1 - sx);
    const pk = Math.max(0, Math.min(1, (k - 0.25) / 0.75));
    this.props.scale.y = Math.max(0.001, backOut(pk));
    this.props.visible = pk > 0;
  }

  // ---- instance matrices ------------------------------------------------------------------------------
  /** Write tree i's pine and stump matrices from its phase. */
  private compose(i: number): void {
    const s = this.slots[i]!;
    const t = this.trees[i]!;
    let k = 1; // pine scale factor
    let tilt = 0;
    let stump = HIDDEN;
    switch (s.phase) {
      case 'stand':
        break;
      case 'fall': {
        const u = Math.min(1, s.t / FALL_TIME);
        tilt = u * u * 1.5 + Math.sin(u * Math.PI) * 0.03;
        stump = 1;
        break;
      }
      case 'lie':
        tilt = 1.5;
        stump = 1;
        break;
      case 'sink': {
        const u = Math.min(1, s.t / SINK_TIME);
        tilt = 1.5;
        k = Math.max(HIDDEN, 1 - u * u);
        stump = 1;
        break;
      }
      case 'gone':
        k = HIDDEN;
        stump = 1;
        break;
      case 'grow': {
        const u = Math.max(0, Math.min(1, s.t / GROW_TIME));
        k = s.t < 0 ? HIDDEN : Math.max(HIDDEN, backOut(u));
        // the stump (if any) shrinks away while the pine grows over it
        stump = s.stumpShown ? Math.max(HIDDEN, 1 - u / 0.35) : HIDDEN;
        break;
      }
    }
    // pine
    this.qYaw.setFromAxisAngle(this.up, s.yaw);
    if (tilt !== 0) {
      this.axis.set(s.axisX, 0, s.axisZ);
      this.qTilt.setFromAxisAngle(this.axis, tilt);
      this.qTilt.multiply(this.qYaw);
    } else {
      this.qTilt.copy(this.qYaw);
    }
    const sc = s.scale * k;
    this.pos.set(t.x, 0, t.z);
    this.scl.set(sc, sc, sc);
    this.mat.compose(this.pos, this.qTilt, this.scl);
    this.pines[s.mesh].setMatrixAt(s.slot, this.mat);
    // stump
    const ss = s.scale * stump;
    this.scl.set(ss, ss, ss);
    this.mat.compose(this.pos, this.qYaw, this.scl);
    this.stumps.setMatrixAt(i, this.mat);
  }

  private flush(all: boolean): void {
    this.pines[0].instanceMatrix.needsUpdate = true;
    this.pines[1].instanceMatrix.needsUpdate = true;
    this.stumps.instanceMatrix.needsUpdate = true;
    if (all) this.root.updateMatrixWorld(true);
  }
}
