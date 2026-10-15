/**
 * Footprints in the snow. A pool of 64 small flat dark blue-grey rounded prints (ONE InstancedMesh = 1 draw call, hidden
 * when none is alive) laid under the player's feet every STEP_DISTANCE metres of travel, alternating left / right of the
 * heading (+-SIDE_OFFSET), rotated to the heading. Each print fades out over FADE_SECONDS, then returns to the pool (the
 * oldest print is recycled when all 64 are in use). No per-frame allocation.
 *
 * WHERE (rule, `footprintAllowed`): only on bare snow. Prints sit at y = PRINT_Y (0.013), just above the snow ground
 * (y = 0), so anything built higher hides them anyway and they are skipped there:
 *  - the dirt yard (LAYOUT.yard, grown to LAYOUT.expandedMinZ; dirt at y 0.01),
 *  - the tricycle road + bridge (LAYOUT.tricycles.road, asphalt y 0.04),
 *  - the village footprint (LAYOUT.village.area: packed-snow street / forecourt slabs up to y 0.016, and the street
 *    surface of the era, gravel or cobbles, at y 0.05),
 *  - the Market Town district (LAYOUT.town.area: trampled slab, cobbled square y 0.05, lots up to 0.036, flagstones).
 * The customer path (y 0.008) and open snow (ridge, highway verge, outside the fences) get prints. The Player calls
 * `step()` every frame; nothing is laid at Low quality.
 *
 * The fade is a per-instance alpha (an InstancedBufferAttribute read by a tiny patch on the unlit material), so every
 * print shares the one material and the one draw call.
 */
import * as THREE from 'three';
import { LAYOUT, type Rect } from '../config';
import { inRect } from '../core/math';
import type { GameContext } from '../core/types';

export const FOOTPRINT_POOL = 64;
/** Metres of travel between two prints. */
export const STEP_DISTANCE = 0.42;
/** Lateral offset of each print from the path (left / right alternate). */
export const SIDE_OFFSET = 0.12;
/** Seconds from laid to gone. */
export const FADE_SECONDS = 7;
/** Height above the ground (the Particles ring decal sits at +0.07; the customer path prints at 0.012). */
export const PRINT_Y = 0.013;
/** Strongest opacity of a fresh print. */
export const MAX_ALPHA = 0.55;

const PRINT_W = 0.12;
const PRINT_L = 0.22;
const COLOR = 0x5d7391;

/** Hard-ground / built-up areas where a print would be hidden or look wrong (see the file header). */
export function noPrintAreas(): readonly Rect[] {
  const y = LAYOUT.yard;
  return [
    { minX: y.minX - 0.6, maxX: y.maxX + 0.6, minZ: LAYOUT.expandedMinZ - 0.6, maxZ: y.maxZ + 0.6 },
    LAYOUT.tricycles.road,
    LAYOUT.village.area,
    LAYOUT.town.area,
  ];
}

/** True where footprints may be laid (bare snow). Pure. */
export function footprintAllowed(x: number, z: number, areas: readonly Rect[] = noPrintAreas()): boolean {
  for (const a of areas) if (inRect(a, x, z)) return false;
  return true;
}

/**
 * World position of the next print: `side` +1 = right of the heading, -1 = left. `yaw` is the heading (0 = +Z, the
 * model's forward; atan2(vx, vz)). Writes into `out` and returns it. Pure.
 */
export function printPlacement(x: number, z: number, yaw: number, side: 1 | -1, out: { x: number; z: number }): { x: number; z: number } {
  out.x = x + Math.cos(yaw) * SIDE_OFFSET * side;
  out.z = z - Math.sin(yaw) * SIDE_OFFSET * side;
  return out;
}

/** Opacity of a print `age` seconds old (a short ease-in so it does not pop, then a linear fade to 0). Pure. */
export function printAlpha(age: number): number {
  if (age < 0 || age >= FADE_SECONDS) return 0;
  const k = 1 - age / FADE_SECONDS;
  return MAX_ALPHA * k * Math.min(1, age / 0.08 + 0.35);
}

/** A rounded rectangle lying flat, long axis along +Z (so rotation.y = heading yaw points it the right way). */
function printGeometry(): THREE.BufferGeometry {
  const w = PRINT_W / 2;
  const l = PRINT_L / 2;
  const r = Math.min(w, l) * 0.85;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -l);
  s.lineTo(w - r, -l);
  s.quadraticCurveTo(w, -l, w, -l + r);
  s.lineTo(w, l - r);
  s.quadraticCurveTo(w, l, w - r, l);
  s.lineTo(-w + r, l);
  s.quadraticCurveTo(-w, l, -w, l - r);
  s.lineTo(-w, -l + r);
  s.quadraticCurveTo(-w, -l, -w + r, -l);
  // ShapeGeometry lies in XY facing +Z; rotateX(-90deg) lays it on the ground facing +Y (shape Y becomes world -Z;
  // the outline is symmetric, so the long axis simply runs along Z).
  return new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2);
}

export class Footprints {
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly alpha = new Float32Array(FOOTPRINT_POOL);
  private readonly born = new Float32Array(FOOTPRINT_POOL);
  private readonly alive = new Uint8Array(FOOTPRINT_POOL);
  private cursor = 0;
  private liveCount = 0;
  private clock = 0;
  private travelled = 0;
  private side: 1 | -1 = 1;
  private lastX = 0;
  private lastZ = 0;
  private hasLast = false;
  private lastDark = -1;
  private readonly areas = noPrintAreas();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly at = { x: 0, z: 0 };

  constructor(private readonly ctx: GameContext) {
    this.alphaAttr = new THREE.InstancedBufferAttribute(this.alpha, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    const geometry = printGeometry();
    geometry.setAttribute('aAlpha', this.alphaAttr);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.material.color.setHex(COLOR);
    this.material.onBeforeCompile = (shader): void => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vPrintAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPrintAlpha = aAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPrintAlpha;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= vPrintAlpha;\n#include <opaque_fragment>');
    };
    this.mesh = new THREE.InstancedMesh(geometry, this.material, FOOTPRINT_POOL);
    this.mesh.name = 'footprints';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = FOOTPRINT_POOL;
    this.mesh.visible = false;
    ctx.scene.add(this.mesh);
  }

  /** Prints currently alive (tests / debug). */
  get active(): number {
    return this.liveCount;
  }

  /**
   * Every frame. (x, z) is where the feet are, (vx, vz) the real velocity: travel since the last call is
   * accumulated and a print is laid every STEP_DISTANCE. Also ages and fades the live prints.
   */
  step(dt: number, x: number, z: number, vx: number, vz: number): void {
    this.clock += dt;
    if (this.liveCount > 0) this.age();
    if (this.ctx.renderer?.quality === 'low') {
      this.hasLast = false;
      return;
    }
    if (!this.hasLast) {
      this.lastX = x;
      this.lastZ = z;
      this.hasLast = true;
      return;
    }
    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    this.lastX = x;
    this.lastZ = z;
    const d = Math.hypot(dx, dz);
    // a teleport (or a respawn) is not travel
    if (d > 3) {
      this.travelled = 0;
      return;
    }
    this.travelled += d;
    if (this.travelled < STEP_DISTANCE) return;
    this.travelled = this.travelled % STEP_DISTANCE;
    if (!footprintAllowed(x, z, this.areas)) return;
    const sp = Math.hypot(vx, vz);
    const yaw = sp > 0.05 ? Math.atan2(vx, vz) : Math.atan2(dx, dz);
    this.lay(x, z, yaw);
  }

  /** Lay one print at the feet (x, z) heading `yaw`; alternates left / right. */
  lay(x: number, z: number, yaw: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % FOOTPRINT_POOL;
    printPlacement(x, z, yaw, this.side, this.at);
    this.side = this.side === 1 ? -1 : 1;
    this.q.setFromAxisAngle(this.up, yaw);
    this.pos.set(this.at.x, PRINT_Y, this.at.z);
    this.m.compose(this.pos, this.q, this.scale);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.alive[i]) this.liveCount++;
    this.alive[i] = 1;
    this.born[i] = this.clock;
    this.alpha[i] = printAlpha(0);
    this.alphaAttr.needsUpdate = true;
    this.mesh.visible = true;
  }

  /** Remove every print. */
  clear(): void {
    this.alive.fill(0);
    this.alpha.fill(0);
    this.liveCount = 0;
    this.alphaAttr.needsUpdate = true;
    this.mesh.visible = false;
  }

  private age(): void {
    let live = 0;
    for (let i = 0; i < FOOTPRINT_POOL; i++) {
      if (!this.alive[i]) continue;
      const age = this.clock - this.born[i]!;
      if (age >= FADE_SECONDS) {
        this.alive[i] = 0;
        this.alpha[i] = 0;
      } else {
        this.alpha[i] = printAlpha(age);
        live++;
      }
    }
    this.liveCount = live;
    this.alphaAttr.needsUpdate = true;
    if (live === 0) this.mesh.visible = false;
    // unlit, so dim with the night (cheap: one number, only when the darkness changed)
    const dark = this.ctx.dayNight?.darkness ?? 0;
    if (dark !== this.lastDark) {
      this.lastDark = dark;
      this.material.color.setHex(COLOR).multiplyScalar(1 - 0.55 * dark);
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
