/**
 * [0.9.12 — guide arrow] A short trail of soft gold dots on the ground, from the player along the walk to the guide's
 * target (ui/guideRoute.ts): shown when the way bends round something (a fence, a building, the river) or the target
 * is off-screen, so the player sees where to walk, not only where to end up. The dots get smaller further ahead, and a
 * gentle pulse runs down the trail toward the target (Reduce motion: still).
 * Two instanced meshes (a cream rim under a gold dot): two draw calls whatever the length.
 */
import * as THREE from 'three';
import { basic, geo } from '../render/materials';
import { CREAM, GOLD } from '../render/palette';
import { pointAlong, projectOnPath, type NavPath, type XZ } from '../world/navGrid';

export const TRAIL_DOTS = 9;
/** First dot this far (m) ahead of the player, then one every SPACING. */
const START = 1.4;
const SPACING = 1.15;
/** The trail stops this short (m) of the target (the 3D arrow is there). */
const END_GAP = 1.6;
const DOT_R = 0.17;
const Y = 0.05;

export class GuideTrail {
  readonly object = new THREE.Group();
  private readonly dots: THREE.InstancedMesh;
  private readonly rims: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private shown = 0;
  /** Dots on show last frame (the guide check reads it). */
  count = 0;

  constructor() {
    const dotMat = basic(GOLD, { transparent: true, opacity: 0.92, depthWrite: false });
    const rimMat = basic(CREAM, { transparent: true, opacity: 0.85, depthWrite: false });
    this.rims = new THREE.InstancedMesh(geo.circleGround(DOT_R * 1.45, 20), rimMat, TRAIL_DOTS);
    this.dots = new THREE.InstancedMesh(geo.circleGround(DOT_R, 20), dotMat, TRAIL_DOTS);
    for (const im of [this.rims, this.dots]) {
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.renderOrder = 2;
      im.count = 0;
      this.object.add(im);
    }
    this.object.name = 'guideTrail';
  }

  /**
   * Lay the trail along `walk` from the player (null / !on: fade it out). `time` drives the pulse; `still` = Reduce
   * motion.
   */
  update(dt: number, walk: NavPath | null, player: XZ, on: boolean, time: number, still: boolean): void {
    this.shown += ((on && walk ? 1 : 0) - this.shown) * (1 - Math.exp(-10 * dt));
    if (this.shown < 0.02 || !walk) {
      this.shown = on && walk ? this.shown : Math.min(this.shown, 0.02);
      this.dots.count = 0;
      this.rims.count = 0;
      this.count = 0;
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    const pts = walk.points;
    const along = projectOnPath(pts, player).along;
    const end = walk.length - END_GAP;
    let n = 0;
    for (let i = 0; i < TRAIL_DOTS; i++) {
      const d = along + START + i * SPACING;
      if (d > end) break;
      const at = pointAlong(pts, d);
      const far = 1 - (i / TRAIL_DOTS) * 0.5;
      const pulse = still ? 1 : 1 + 0.28 * Math.max(0, Math.sin(time * 4.2 - i * 0.8));
      const k = this.shown * far * pulse;
      this.p.set(at.x, Y, at.z);
      this.s.set(k, 1, k);
      this.m.compose(this.p, this.q, this.s);
      this.dots.setMatrixAt(n, this.m);
      this.p.y = Y - 0.005;
      this.m.compose(this.p, this.q, this.s);
      this.rims.setMatrixAt(n, this.m);
      n++;
    }
    this.dots.count = n;
    this.rims.count = n;
    this.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
  }
}
