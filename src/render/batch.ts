/**
 * Draw-call reduction for static compound models. Every mesh costs one draw call, plus one more in the shadow
 * pass when it casts, so a model built from twenty primitives costs forty calls. Merging static parts into ONE
 * vertex-coloured mesh that shares ONE toon material (vcMat) makes it cost two, with the same look.
 *
 * Two ways in:
 * - `Batch`: add cached primitives with a colour and a transform, then `.mesh()` / `.geometry()`.
 * - `bake(group)`: build a static subtree the usual way (`mesh(geo.*, toon(c))` children, nested groups,
 *   rotations), then collapse it into one mesh. The subtree is consumed (never attach it anywhere).
 *
 * Only plain opaque toon colours merge: no map, no emissive, no transparency, no unique/animated material.
 * Merge only parts that never move relative to each other; anything that animates (a wheel, an arm, a blade),
 * flashes (a unique material) or is referenced by a handle stays its own mesh or pivot.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonUnique } from './materials';

let vertexColorMaterial: THREE.MeshToonMaterial | null = null;

/** Shared toon material that multiplies per-vertex colours (and instance colours). Never dispose it. */
export function vcMat(): THREE.MeshToonMaterial {
  if (!vertexColorMaterial) {
    vertexColorMaterial = toonUnique(0xffffff);
    vertexColorMaterial.vertexColors = true;
  }
  return vertexColorMaterial;
}

export interface PartOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Non-indexed copy of `g` transformed by `matrix`, painted with `color` (linear RGB), position/normal/color only. */
function paintedCopy(g: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(src.attributes)) {
    if (name !== 'position' && name !== 'normal') src.deleteAttribute(name);
  }
  if (!src.getAttribute('normal')) src.computeVertexNormals();
  src.applyMatrix4(matrix);
  const n = src.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  src.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return src;
}

/** Collects coloured primitives and merges them into one vertex-coloured BufferGeometry. */
export class Batch {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** Add a transformed copy of `g` painted `color`. `g` is never modified (safe for cached geometry). */
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, o?: PartOpts): this {
    _e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0);
    _q.setFromEuler(_e);
    _s.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    _p.set(x, y, z);
    this.parts.push(paintedCopy(g, _m.compose(_p, _q, _s), _c.set(color)));
    return this;
  }

  /** Add a copy of `g` with an arbitrary local matrix, painted `color`. */
  addMatrix(g: THREE.BufferGeometry, color: THREE.ColorRepresentation | THREE.Color, matrix: THREE.Matrix4): this {
    this.parts.push(paintedCopy(g, matrix, color instanceof THREE.Color ? color : _c.set(color)));
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Bounds of every part added so far, in the batch's coordinates (placement guards in tests read these; nothing is consumed). */
  bounds(): THREE.Box3[] {
    return this.parts.map((p) => new THREE.Box3().setFromBufferAttribute(p.getAttribute('position') as THREE.BufferAttribute));
  }

  /** Merge into a single geometry (the batch is consumed). */
  geometry(flat = false): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    // Parts are non-indexed, so recomputing normals gives crisp per-face (faceted) shading.
    if (flat) merged.computeVertexNormals();
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  /** Merge into a mesh. */
  mesh(opts?: { cast?: boolean; receive?: boolean; material?: THREE.Material; flat?: boolean }): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry(opts?.flat), opts?.material ?? vcMat());
    m.castShadow = opts?.cast ?? true;
    m.receiveShadow = opts?.receive ?? true;
    return m;
  }
}

const _rel = new THREE.Matrix4();

/** Matrix of `o` relative to `root` (walks up the local matrices; `root`'s own transform is excluded). */
function relativeMatrix(o: THREE.Object3D, root: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  for (let a: THREE.Object3D | null = o; a && a !== root; a = a.parent) {
    a.updateMatrix();
    out.premultiply(a.matrix);
  }
  return out;
}

function mergeableColor(m: THREE.Mesh): THREE.Color {
  const mat = m.material;
  const what = m.name || m.geometry.type;
  if (Array.isArray(mat)) throw new Error(`bake: '${what}' has a material array`);
  const t = mat as THREE.MeshToonMaterial;
  if (!t.isMeshToonMaterial) throw new Error(`bake: '${what}' is not a toon material (${mat.type})`);
  if (t.map || t.alphaMap || t.emissiveMap) throw new Error(`bake: '${what}' has a texture`);
  if (t.transparent || t.opacity < 1) throw new Error(`bake: '${what}' is transparent`);
  if (t.emissive.getHex() !== 0 && t.emissiveIntensity > 0) throw new Error(`bake: '${what}' is emissive`);
  return t.color;
}

/**
 * Collapse every mesh under `group` into ONE vertex-coloured mesh in `group`'s local space (the group's own
 * transform is NOT baked in; the returned mesh copies it, so it can replace the group one-for-one). Throws on
 * anything that cannot merge (textured, emissive, transparent, non-toon) so mistakes show up immediately.
 * The subtree is consumed: do not keep references into it.
 */
export function bake(group: THREE.Object3D, opts?: { cast?: boolean; receive?: boolean; name?: string }): THREE.Mesh {
  const batch = new Batch();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o === group) return;
    if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) {
      throw new Error(`bake: '${m.name || m.type}' is instanced/skinned`);
    }
    batch.addMatrix(m.geometry, mergeableColor(m), relativeMatrix(m, group, _rel));
  });
  if ((group as THREE.Mesh).isMesh) {
    const self = group as THREE.Mesh;
    batch.addMatrix(self.geometry, mergeableColor(self), _rel.identity());
  }
  const out = batch.mesh({ cast: opts?.cast, receive: opts?.receive });
  out.name = opts?.name ?? group.name;
  out.position.copy(group.position);
  out.quaternion.copy(group.quaternion);
  out.scale.copy(group.scale);
  return out;
}

const sharedBakes = new Map<string, THREE.BufferGeometry[]>();

function sameArrays(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  for (const name of ['position', 'normal', 'color']) {
    const x = a.getAttribute(name)?.array;
    const y = b.getAttribute(name)?.array;
    if (!x || !y || x.length !== y.length) return x === y;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

/**
 * Give `m` the cached copy of its baked geometry when an identical one was baked before (same vertices, normals and
 * colours), and dispose the duplicate. Pawns of one look then share their part geometry, which is what lets
 * render/instancer.ts draw every matching boot / arm / head in ONE call. Only for bake()/Batch output that nobody
 * edits or disposes afterwards. Returns `m`.
 */
export function shareBaked(m: THREE.Mesh): THREE.Mesh {
  const g = m.geometry;
  const pos = g.getAttribute('position');
  if (!pos || g.index) return m;
  // cheap key: vertex count + a few sampled values; equal keys are confirmed with a full compare
  const a = pos.array;
  const col = g.getAttribute('color')?.array;
  const step = Math.max(1, Math.floor(a.length / 24));
  let key = `${a.length}`;
  for (let i = 0; i < a.length; i += step) key += `,${a[i]!.toFixed(4)}`;
  if (col) for (let i = 0; i < col.length; i += Math.max(1, Math.floor(col.length / 8))) key += `|${col[i]!.toFixed(3)}`;
  const list = sharedBakes.get(key);
  if (list) {
    for (const s of list) {
      if (sameArrays(s, g)) {
        g.dispose();
        m.geometry = s;
        return m;
      }
    }
    list.push(g);
  } else {
    sharedBakes.set(key, [g]);
  }
  g.userData.sharedBake = true;
  return m;
}
