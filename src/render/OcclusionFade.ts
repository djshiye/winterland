/**
 * 0.9.3: buildings that stand between the camera and the player or a pad open up, so a pad's price (and the player
 * walking behind a tower) can always be read. The fixed isometric camera looks down from +X/+Z; the city districts'
 * towers (up to ~22 m) used to hide whole rows of BUILD pads behind them.
 *
 * 0.9.8 (DIRECTION V12): a soft cutaway instead of grey see-through ghosts. A hidden target gets a round hole cut through
 * the building along the view line (a cylinder toward the camera, around the target), with a dithered rim; the rest of
 * the building stays solid in its own colours, and its shadow stays put.
 *
 * - Occluders: building roots registered by their owners (city district lots, Market Town businesses). Their world
 *   box is measured from the model (cached, re-measured now and then while they pop in).
 * - Targets: the player and every pad tile (UpgradePad, ConstructionPad, LotPad register themselves; a pad only
 *   counts while it is shown).
 * - Every CHECK_INTERVAL: for the targets near the camera, a ray from each sample point toward the camera; an
 *   occluder whose box the ray passes through opens a hole around that target (up to MAX_HOLES per building), the
 *   others close. The opening eases every frame (EASE per second), so nothing pops, and holes follow a moving player
 *   every frame. Opened meshes wear cloned cutaway materials (made once per occluder, kept for reuse); once closed the
 *   shared originals go back on.
 *
 * Visual only: colliders, zones and gameplay never read it. `faded(root)` is for tests and the debug API.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';

/** `faded()` of a building whose cutaway is fully open (1 = solid). */
export const GHOST = 0;
/** Seconds between two occlusion checks. */
const CHECK_INTERVAL = 0.1;
/** Opening change per second. */
const EASE = 4;
/** Targets farther than this from the camera's look-at point are not checked (metres). */
const TARGET_RANGE = 30;
/** Occluders farther than this from the look-at point are not checked (a 22 m tower reaches ~25 m along the view). */
const OCCLUDER_RANGE = 60;
/** How often a cached box is re-measured (seconds), so pop-in scaling and late model swaps settle. */
const REMEASURE = 3;
/** Holes one building can show at once. */
export const MAX_HOLES = 4;
/** Hole radius around the player (metres). */
const PLAYER_HOLE = 1.6;

interface Target {
  object: THREE.Object3D;
  /** Half the tile size (the player: its body radius). */
  half: number;
  /** Sample heights above the floor. */
  heights: readonly number[];
  active: () => boolean;
}

/** What a hole is cut around: an object, the height of its centre and the radius. */
interface HoleSource {
  object: THREE.Object3D;
  y: number;
  r: number;
}

interface Occluder {
  root: THREE.Object3D;
  box: THREE.Box3;
  measuredAt: number;
  /** 1 = solid, GHOST = fully open (eases toward `want`). */
  alpha: number;
  want: number;
  /** The targets this building hides (kept while it closes, so the hole shrinks in place). */
  sources: HoleSource[];
  /** Shader uniforms shared by every cutaway clone of this building. */
  uniforms: { wlHoles: { value: THREE.Vector4[] }; wlView: { value: THREE.Vector3 }; wlOpen: { value: number } };
  /** mesh -> its original material(s), while the cutaway materials are on. */
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]> | null;
  /** original material -> its cutaway clone (kept for reuse). */
  clones: Map<THREE.Material, THREE.Material>;
}

const CUT_VERTEX_HEAD = 'varying vec3 vWlWorld;';
const CUT_VERTEX = `
{
  vec4 wlW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wlW = instanceMatrix * wlW;
  #endif
  vWlWorld = ( modelMatrix * wlW ).xyz;
}`;
const CUT_FRAGMENT_HEAD = `varying vec3 vWlWorld;
uniform vec4 wlHoles[ ${MAX_HOLES} ];
uniform vec3 wlView;
uniform float wlOpen;
float wlBayer( vec2 p ) {
  ivec2 q = ivec2( mod( p, 4.0 ) );
  int i = q.x + q.y * 4;
  float m[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  return ( m[ i ] + 0.5 ) / 16.0;
}`;
// keep a fragment unless it lies in a hole's view cylinder on the camera side of the target; the rim is dithered
const CUT_FRAGMENT = `
{
  float wlKeep = 1.0;
  for ( int i = 0; i < ${MAX_HOLES}; i ++ ) {
    vec4 h = wlHoles[ i ];
    float R = h.w * wlOpen;
    if ( R <= 0.0 ) continue;
    vec3 d = vWlWorld - h.xyz;
    float along = dot( d, wlView );
    if ( along < -0.4 ) continue;
    float r = length( d - wlView * along );
    wlKeep = min( wlKeep, smoothstep( R * 0.72, R, r ) );
  }
  if ( wlKeep < wlBayer( gl_FragCoord.xy ) ) discard;
}`;

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
  /** The target each sample belongs to (null = the player). */
  private readonly sampleOf: (Target | null)[] = [];

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
      this.occluders.set(root, {
        root,
        box: new THREE.Box3(),
        measuredAt: -Infinity,
        alpha: 1,
        want: 1,
        sources: [],
        uniforms: {
          wlHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) },
          wlView: { value: new THREE.Vector3(0, 1, 0) },
          wlOpen: { value: 0 },
        },
        originals: null,
        clones: new Map(),
      });
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
      if (o.alpha !== o.want) {
        o.alpha = o.want < o.alpha ? Math.max(o.want, o.alpha - step) : Math.min(o.want, o.alpha + step);
        this.apply(o);
      }
      if (o.originals) this.placeHoles(o);
    }
  }

  /** Move the holes onto their targets (a walking player) and set how far they are open. */
  private placeHoles(o: Occluder): void {
    const u = o.uniforms;
    this.ctx.camera.getWorldDirection(u.wlView.value).negate();
    const holes = u.wlHoles.value;
    for (let i = 0; i < MAX_HOLES; i++) {
      const src = o.sources[i];
      const h = holes[i]!;
      if (!src) {
        h.set(0, 0, 0, 0);
        continue;
      }
      src.object.getWorldPosition(this.tmp);
      h.set(this.tmp.x, src.y, this.tmp.z, src.r);
    }
    const open = 1 - o.alpha;
    u.wlOpen.value = open * open * (3 - 2 * open);
  }

  /** Decide which occluders hide a target right now. */
  private check(): void {
    if (this.occluders.size === 0) return;
    const ctx = this.ctx;
    const centre = ctx.cameraRig.target;
    ctx.camera.getWorldDirection(this.toCamera).negate();
    // sample points of the targets near the camera
    let n = 0;
    let owner: Target | null = null;
    const push = (x: number, y: number, z: number): void => {
      const v = this.samples[n] ?? (this.samples[n] = new THREE.Vector3());
      v.set(x, y, z);
      this.sampleOf[n] = owner;
      n++;
    };
    const player = ctx.player?.object;
    if (player) for (const y of PLAYER_HEIGHTS) push(player.position.x, y, player.position.z);
    for (const t of this.targets) {
      if (!t.active()) continue;
      const p = t.object.getWorldPosition(this.tmp);
      if (Math.abs(p.x - centre.x) > TARGET_RANGE || Math.abs(p.z - centre.z) > TARGET_RANGE) continue;
      const h = t.half * 0.7;
      owner = t;
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
      const found: HoleSource[] = [];
      if (n === 0) continue;
      if (now - o.measuredAt > REMEASURE) {
        o.box.setFromObject(o.root);
        o.measuredAt = now;
      }
      if (o.box.isEmpty() || !worldVisible(o.root)) continue;
      const b = o.box;
      if (b.max.x < centre.x - OCCLUDER_RANGE || b.min.x > centre.x + OCCLUDER_RANGE) continue;
      if (b.max.z < centre.z - OCCLUDER_RANGE || b.min.z > centre.z + OCCLUDER_RANGE) continue;
      let lastOwner: Target | null | undefined;
      for (let i = 0; i < n && found.length < MAX_HOLES; i++) {
        const s = this.samples[i]!;
        const t = this.sampleOf[i] ?? null;
        if (t === lastOwner) continue; // this target already has its hole
        // a point inside the footprint (standing in the doorway, a pad under an awning) does not open it
        if (s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z) continue;
        this.ray.set(s, this.toCamera);
        if (this.ray.intersectBox(b, this.hit)) {
          lastOwner = t;
          if (t) found.push({ object: t.object, y: 0.3, r: t.half * 1.25 + 0.6 });
          else if (player) found.push({ object: player, y: 0.9, r: PLAYER_HOLE });
        }
      }
      if (found.length > 0) {
        o.want = GHOST;
        o.sources = found;
      }
    }
  }

  /** Put the cutaway materials on (while open) or the originals back (closed). */
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
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => this.cutaway(o, m)) : this.cutaway(o, mesh.material);
      });
    }
    this.placeHoles(o);
  }

  /** The cutaway clone of `m` for this building (custom shader materials are left as they are). */
  private cutaway(o: Occluder, m: THREE.Material): THREE.Material {
    if ((m as THREE.ShaderMaterial).isShaderMaterial) return m;
    let c = o.clones.get(m);
    if (!c) {
      c = m.clone();
      c.userData.wlCutaway = true;
      // keep the original's own shader patch (window grids, vertex-colour glow), then cut
      const own = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') ? m.onBeforeCompile.bind(m) : null;
      const ownKey = m.customProgramCacheKey.bind(m);
      c.onBeforeCompile = (shader, renderer): void => {
        own?.(shader, renderer);
        Object.assign(shader.uniforms, o.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${CUT_VERTEX_HEAD}`)
          .replace('#include <project_vertex>', `#include <project_vertex>${CUT_VERTEX}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${CUT_FRAGMENT_HEAD}`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${CUT_FRAGMENT}`);
      };
      c.customProgramCacheKey = (): string => `${ownKey()}|wlCut`;
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
