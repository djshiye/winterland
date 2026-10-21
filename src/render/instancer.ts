/**
 * Draw-call reduction for many copies of the same mesh. Every mesh costs one draw call (plus one in the shadow pass
 * when it casts); N copies of one geometry + material drawn through one InstancedMesh cost ONE (+1), with the same
 * look: same geometry, same material, the same transform for every copy every frame.
 *
 * Two ways in, both invisible to game code (objects keep their own Object3D, transform, tweens and visibility):
 * - `instanceChildren(group)`: for groups whose DIRECT children repeat — item piles, carried stacks, cash stacks.
 *   Instance matrix = the child's local matrix; the InstancedMesh lives in the group, so culling stays per pile.
 * - `instanceAcrossScene(root)`: registers the meshes under `root` (an NPC, a vehicle) into one scene-wide pool per
 *   geometry + material, so twenty customers' boots are one draw call. Instance matrix = the mesh's world matrix.
 *   A copy outside both the camera view and the shadow box is left as a normal mesh, so three culls it as before.
 *
 * Per frame, the Renderer calls `prepareInstances()` before rendering (groups) and `prepareSharedInstances()` from
 * the scene's onBeforeRender (world matrices are fresh there); every run of 2+ visible copies is copied into its
 * InstancedMesh and the originals are hidden for that one frame. `restoreInstances()` (right after) shows them again.
 *
 * Only simple meshes qualify: a Mesh (not instanced / skinned / morphed), no children of its own, one opaque material,
 * render order 0, frustum culling on, no custom onBeforeRender, not opted out with `userData.noInstance`. Anything
 * else renders as usual. No per-frame allocations once the buckets exist. Registrations are weak: a dropped object
 * that never called stopInstancing() is simply forgotten.
 */
import * as THREE from 'three';

/** Smallest run worth instancing (one mesh is already one draw call). */
const MIN_RUN = 2;
/** Safety margin (world units) on the view tests of the scene-wide pool. */
const VIEW_MARGIN = 0.5;

interface Bucket {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  mesh: THREE.InstancedMesh | null;
  members: THREE.Mesh[];
}

interface Entry {
  root: THREE.Object3D;
  buckets: Bucket[];
}

const noop = THREE.Object3D.prototype.onBeforeRender;
const hidden: THREE.Mesh[] = [];

function eligible(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  return (
    m.isMesh === true &&
    m.visible &&
    !(m as THREE.InstancedMesh).isInstancedMesh &&
    !(m as THREE.SkinnedMesh).isSkinnedMesh &&
    m.userData.instancerOwned !== true &&
    m.children.length === 0 &&
    !Array.isArray(m.material) &&
    !(m.material as THREE.Material).transparent && // transparent copies need their own depth sorting
    m.renderOrder === 0 &&
    m.frustumCulled &&
    m.onBeforeRender === noop &&
    m.userData.noInstance !== true &&
    !m.morphTargetInfluences
  );
}

/** The bucket in `list` matching `m` (created when missing). */
function bucketIn(list: Bucket[], m: THREE.Mesh): Bucket {
  const mat = m.material as THREE.Material;
  for (const b of list) {
    if (b.geometry === m.geometry && b.material === mat && b.cast === m.castShadow && b.receive === m.receiveShadow) return b;
  }
  const b: Bucket = { geometry: m.geometry, material: mat, cast: m.castShadow, receive: m.receiveShadow, mesh: null, members: [] };
  list.push(b);
  return b;
}

function dropMesh(b: Bucket): void {
  if (!b.mesh) return;
  b.mesh.removeFromParent();
  b.mesh.dispose(); // frees the instance buffers only; geometry and material are shared and stay
  b.mesh = null;
}

function ensureMesh(b: Bucket, n: number, parent: THREE.Object3D, name: string): THREE.InstancedMesh {
  let im = b.mesh;
  if (im && im.instanceMatrix.count >= n) return im;
  let cap = 8;
  while (cap < n) cap *= 2;
  dropMesh(b);
  im = new THREE.InstancedMesh(b.geometry, b.material, cap);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.castShadow = b.cast;
  im.receiveShadow = b.receive;
  im.name = name;
  im.userData.instancerOwned = true;
  im.matrixAutoUpdate = false; // identity in the parent's space
  parent.add(im);
  b.mesh = im;
  return im;
}

/** Copy the members of `b` into its InstancedMesh (local or world matrices) and hide them; or hide the mesh. */
function flush(b: Bucket, parent: THREE.Object3D, name: string, world: boolean): void {
  const n = b.members.length;
  if (n < MIN_RUN) {
    if (b.mesh) b.mesh.visible = false;
    b.members.length = 0;
    return;
  }
  const im = ensureMesh(b, n, parent, name);
  for (let i = 0; i < n; i++) {
    const c = b.members[i]!;
    if (world) {
      im.setMatrixAt(i, c.matrixWorld);
    } else {
      if (c.matrixAutoUpdate) c.updateMatrix();
      im.setMatrixAt(i, c.matrix);
    }
    c.visible = false;
    hidden.push(c);
  }
  im.count = n;
  im.visible = true;
  im.instanceMatrix.clearUpdateRanges();
  im.instanceMatrix.addUpdateRange(0, n * 16);
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  b.members.length = 0;
}

/** True when `o` is attached under `scene` with every ancestor visible. */
function shown(o: THREE.Object3D, scene: THREE.Object3D): boolean {
  for (let a: THREE.Object3D | null = o; a; a = a.parent) {
    if (!a.visible) return false;
    if (a === scene) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Groups (direct children, local matrices)
// ---------------------------------------------------------------------------

const entries = new WeakMap<THREE.Object3D, Entry>();
const roots = new Set<WeakRef<THREE.Object3D>>();
const refOf = new WeakMap<THREE.Object3D, WeakRef<THREE.Object3D>>();

/** Draw the repeated plain-mesh children of `root` instanced (see the file comment). Idempotent. */
export function instanceChildren(root: THREE.Object3D): void {
  if (entries.has(root)) return;
  const ref = new WeakRef(root);
  entries.set(root, { root, buckets: [] });
  refOf.set(root, ref);
  roots.add(ref);
}

/** Stop instancing `root`'s children and free its instanced meshes (call when the group is disposed). */
export function stopInstancing(root: THREE.Object3D): void {
  const e = entries.get(root);
  if (!e) return;
  for (const b of e.buckets) dropMesh(b);
  entries.delete(root);
  const ref = refOf.get(root);
  if (ref) roots.delete(ref);
  refOf.delete(root);
}

/** Number of registered groups (tests / debugging). */
export function instancedGroupCount(): number {
  return roots.size;
}

/** Before a frame: fold repeated children of every shown registered group into its instanced meshes. */
export function prepareInstances(scene: THREE.Object3D): void {
  for (const ref of roots) {
    const root = ref.deref();
    const e = root && entries.get(root);
    if (!e) {
      roots.delete(ref);
      continue;
    }
    if (shown(e.root, scene)) {
      for (const c of e.root.children) if (eligible(c)) bucketIn(e.buckets, c).members.push(c);
    }
    for (const b of e.buckets) flush(b, e.root, `${e.root.name || 'group'}:instanced`, false);
  }
}

// ---------------------------------------------------------------------------
// Scene-wide pool (world matrices)
// ---------------------------------------------------------------------------

const pooled = new Set<WeakRef<THREE.Mesh>>();
const pooledSet = new WeakSet<THREE.Mesh>();
/** Buckets of the scene-wide pool, by geometry (then material / shadow flags). */
const shared = new Map<THREE.BufferGeometry, Bucket[]>();
const sharedRoot = new THREE.Group();
sharedRoot.name = 'instancer:shared';
sharedRoot.matrixAutoUpdate = false;
const frustum = new THREE.Frustum();
const shadowFrustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere();

/** Pool every mesh under `root` (now) with the same meshes elsewhere in the scene (see the file comment). */
export function instanceAcrossScene(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || pooledSet.has(m)) return;
    pooledSet.add(m);
    pooled.add(new WeakRef(m));
  });
}

/** True for a mesh in the scene-wide pool or a group whose children are instanced (render/snowCover.ts leaves them be). */
export function instancerManaged(o: THREE.Object3D): boolean {
  return pooledSet.has(o as THREE.Mesh) || entries.has(o);
}

/** Number of pooled meshes (tests / debugging). */
export function pooledMeshCount(): number {
  return pooled.size;
}

/**
 * During a frame (scene.onBeforeRender: world matrices are up to date, nothing is culled yet): fold the visible
 * pooled meshes that this frame draws (inside the camera view, or inside `shadowCamera`'s box when one is given) into
 * one InstancedMesh per geometry + material.
 */
export function prepareSharedInstances(scene: THREE.Object3D, camera: THREE.Camera, shadowCamera: THREE.Camera | null): void {
  if (pooled.size === 0) return;
  if (sharedRoot.parent !== scene) scene.add(sharedRoot);
  frustum.setFromProjectionMatrix(projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  if (shadowCamera) shadowFrustum.setFromProjectionMatrix(projView.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse));
  for (const ref of pooled) {
    const m = ref.deref();
    if (!m) {
      pooled.delete(ref);
      continue;
    }
    if (!eligible(m) || !shown(m, scene)) continue;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
    sphere.radius += VIEW_MARGIN;
    // drawn by neither pass: stays a plain mesh, three culls it as before
    if (!frustum.intersectsSphere(sphere) && !(shadowCamera && m.castShadow && shadowFrustum.intersectsSphere(sphere))) continue;
    let list = shared.get(g);
    if (!list) {
      list = [];
      shared.set(g, list);
    }
    bucketIn(list, m).members.push(m);
  }
  for (const list of shared.values()) for (const b of list) flush(b, sharedRoot, 'instancer:shared', true);
}

/** After a frame: show every mesh the prepare calls hid. */
export function restoreInstances(): void {
  for (const c of hidden) c.visible = true;
  hidden.length = 0;
}

/** Hide every instanced mesh (instancing switched off: the originals draw themselves). */
export function hideInstanced(): void {
  for (const ref of roots) {
    const root = ref.deref();
    const e = root && entries.get(root);
    if (e) for (const b of e.buckets) if (b.mesh) b.mesh.visible = false;
  }
  for (const list of shared.values()) for (const b of list) if (b.mesh) b.mesh.visible = false;
}
