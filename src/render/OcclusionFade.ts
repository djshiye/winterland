/**
 * 0.9.3: buildings that stand between the camera and the player or a pad fade to a soft see-through, so a pad's
 * price (and the player walking behind a tower) can always be read. The fixed isometric camera looks down from
 * +X/+Z; the city districts' towers (up to ~22 m) used to hide whole rows of BUILD pads behind them.
 *
 * - Occluders: building roots registered by their owners (city district lots, Market Town businesses). Their world
 *   box is measured from the model (cached, re-measured now and then while they pop in).
 * - Targets: the player and every pad tile (UpgradePad, ConstructionPad, LotPad register themselves; a pad only
 *   counts while it is shown).
 * - Every CHECK_INTERVAL: for the targets near the camera, a ray from each sample point toward the camera; an
 *   occluder whose box the ray passes through fades toward GHOST, the others come back to 1. The opacity eases every
 *   frame (EASE per second), so nothing pops. Faded meshes wear cloned transparent materials (made once per occluder,
 *   kept for reuse); at full opacity the shared originals go back on.
 *
 * Visual only: colliders, zones and gameplay never read it. `faded(root)` is for tests and the debug API.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';

/** Opacity of a building that hides a target. */
export const GHOST = 0.3;
/** Seconds between two occlusion checks. */
const CHECK_INTERVAL = 0.1;
/** Opacity change per second. */
const EASE = 4;
/** Targets farther than this from the camera's look-at point are not checked (metres). */
const TARGET_RANGE = 30;
/** Occluders farther than this from the look-at point are not checked (a 22 m tower reaches ~25 m along the view). */
const OCCLUDER_RANGE = 60;
/** How often a cached box is re-measured (seconds), so pop-in scaling and late model swaps settle. */
const REMEASURE = 3;

interface Target {
  object: THREE.Object3D;
  /** Half the tile size (the player: its body radius). */
  half: number;
  /** Sample heights above the floor. */
  heights: readonly number[];
  active: () => boolean;
}

interface Occluder {
  root: THREE.Object3D;
  box: THREE.Box3;
  measuredAt: number;
  alpha: number;
  want: number;
  /** mesh -> its original material(s), while the ghost materials are on. */
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]> | null;
  /** original material -> its transparent clone (kept for reuse). */
  clones: Map<THREE.Material, THREE.Material>;
}

const PAD_HEIGHTS = [0.06] as const;
const PLAYER_HEIGHTS = [0.3, 1.5] as const;

function worldVisible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export class OcclusionFade {
  private readonly targets: Target[] = [];
  private readonly occluders = new Map<THREE.Object3D, Occluder>();
  private acc = CHECK_INTERVAL;
  private readonly ray = new THREE.Ray();
  private readonly toCamera = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  private readonly samples: THREE.Vector3[] = [];

  constructor(private readonly ctx: GameContext) {
    ctx.addUpdatable(this);
  }

  /** A pad tile (or any floor thing that must stay readable), counted while `active()`. */
  addTarget(object: THREE.Object3D, size: number, active: () => boolean): void {
    this.targets.push({ object, half: size / 2, heights: PAD_HEIGHTS, active });
  }

  /** Forget a target (its pad was disposed). */
  removeTarget(object: THREE.Object3D): void {
    const i = this.targets.findIndex((t) => t.object === object);
    if (i >= 0) this.targets.splice(i, 1);
  }

  /** A building that may stand in the camera's way. Returns the unregister function (restores its materials). */
  addOccluder(root: THREE.Object3D): () => void {
    if (!this.occluders.has(root)) {
      this.occluders.set(root, { root, box: new THREE.Box3(), measuredAt: -Infinity, alpha: 1, want: 1, originals: null, clones: new Map() });
    }
    return () => this.removeOccluder(root);
  }

  removeOccluder(root: THREE.Object3D): void {
    const o = this.occluders.get(root);
    if (!o) return;
    this.restore(o);
    for (const c of o.clones.values()) c.dispose();
    this.occluders.delete(root);
  }

  /** Current opacity of a registered building (1 = solid; undefined = not registered). */
  faded(root: THREE.Object3D): number | undefined {
    return this.occluders.get(root)?.alpha;
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc >= CHECK_INTERVAL) {
      this.acc = 0;
      this.check();
    }
    const step = EASE * dt;
    for (const o of this.occluders.values()) {
      if (o.alpha === o.want) continue;
      o.alpha = o.want < o.alpha ? Math.max(o.want, o.alpha - step) : Math.min(o.want, o.alpha + step);
      this.apply(o);
    }
  }

  /** Decide which occluders hide a target right now. */
  private check(): void {
    if (this.occluders.size === 0) return;
    const ctx = this.ctx;
    const centre = ctx.cameraRig.target;
    ctx.camera.getWorldDirection(this.toCamera).negate();
    // sample points of the targets near the camera
    let n = 0;
    const push = (x: number, y: number, z: number): void => {
      const v = this.samples[n] ?? (this.samples[n] = new THREE.Vector3());
      v.set(x, y, z);
      n++;
    };
    const player = ctx.player?.object;
    if (player) for (const y of PLAYER_HEIGHTS) push(player.position.x, y, player.position.z);
    for (const t of this.targets) {
      if (!t.active()) continue;
      const p = t.object.getWorldPosition(this.tmp);
      if (Math.abs(p.x - centre.x) > TARGET_RANGE || Math.abs(p.z - centre.z) > TARGET_RANGE) continue;
      const h = t.half * 0.7;
      for (const y of t.heights) {
        push(p.x, y, p.z);
        push(p.x - h, y, p.z - h);
        push(p.x + h, y, p.z - h);
        push(p.x - h, y, p.z + h);
        push(p.x + h, y, p.z + h);
      }
    }
    const now = ctx.time.elapsed;
    for (const o of this.occluders.values()) {
      o.want = 1;
      if (n === 0) continue;
      if (now - o.measuredAt > REMEASURE) {
        o.box.setFromObject(o.root);
        o.measuredAt = now;
      }
      if (o.box.isEmpty() || !worldVisible(o.root)) continue;
      const b = o.box;
      if (b.max.x < centre.x - OCCLUDER_RANGE || b.min.x > centre.x + OCCLUDER_RANGE) continue;
      if (b.max.z < centre.z - OCCLUDER_RANGE || b.min.z > centre.z + OCCLUDER_RANGE) continue;
      for (let i = 0; i < n; i++) {
        const s = this.samples[i]!;
        // a point inside the footprint (standing in the doorway, a pad under an awning) does not fade it
        if (s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z) continue;
        this.ray.set(s, this.toCamera);
        if (this.ray.intersectBox(b, this.hit)) {
          o.want = GHOST;
          break;
        }
      }
    }
  }

  /** Put the ghost materials on (opacity = alpha) or the originals back (alpha 1). */
  private apply(o: Occluder): void {
    if (o.alpha >= 1) {
      this.restore(o);
      return;
    }
    if (!o.originals) {
      o.originals = new Map();
      o.root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        o.originals!.set(mesh, mesh.material);
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => this.ghost(o, m)) : this.ghost(o, mesh.material);
      });
    }
    for (const [m, c] of o.clones) c.opacity = m.opacity * o.alpha;
  }

  private ghost(o: Occluder, m: THREE.Material): THREE.Material {
    let c = o.clones.get(m);
    if (!c) {
      c = m.clone();
      c.transparent = true;
      c.depthWrite = false;
      o.clones.set(m, c);
    }
    return c;
  }

  private restore(o: Occluder): void {
    if (!o.originals) return;
    for (const [mesh, orig] of o.originals) mesh.material = orig;
    o.originals = null;
  }
}
