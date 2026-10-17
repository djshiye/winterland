/**
 * [T2 — town] The "BUILD" tile of an empty town lot: a chunky pad (same slab, snow rim and look as the construction
 * pads, assets/pads.ts createBuildTexture) showing a little house with a plus, with a floating BUILD sign. It only
 * shows; Town owns the zone that opens the build panel while the player stands on it. 0.9.8: it breathes slowly and
 * gives the pads' felt thump when stepped on (fx/PadRing.ts PadFeel).
 */
import * as THREE from 'three';
import { PALETTE, rect, type Rect } from '../config';
import { createBuildTexture, createPadModel, createPadSign } from '../assets/pads';
import type { GameContext } from '../core/types';
import { PadFeel } from '../fx/PadRing';
import { motionScale } from '../fx/padJuice';

const SIGN_HEIGHT = 1.7;
const SIGN_SCALE = 0.72;

export class LotPad {
  /** Root at the tile's floor centre. */
  readonly object = new THREE.Group();
  private shown = false;
  private readonly pulse = new THREE.Group();
  private readonly sign: THREE.Mesh;
  private readonly feel: PadFeel;
  private readonly area: Rect;

  constructor(
    readonly ctx: GameContext,
    x: number,
    z: number,
    size: number,
  ) {
    const model = createPadModel(size, createBuildTexture());
    this.pulse.add(model);
    this.feel = new PadFeel(ctx, model, x);
    this.area = rect(x, z, size, size);
    this.object.add(this.pulse);
    this.sign = createPadSign('BUILD', true);
    this.sign.scale.setScalar(SIGN_SCALE);
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
    this.object.position.set(x, 0, z);
    this.object.visible = false;
    ctx.occlusion?.addTarget(this.object, size, () => this.shown);
  }

  get visible(): boolean {
    return this.shown;
  }

  show(instant = false): void {
    if (this.shown) return;
    this.shown = true;
    this.feel.reset();
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    this.object.scale.setScalar(1);
    this.object.visible = true;
    if (instant) return;
    tw.popIn(this.object, { duration: 0.5 });
    this.ctx.particles.ring(this.object.position, { color: PALETTE.padFill, radius: 1.6, life: 0.5 });
  }

  hide(): void {
    const was = this.shown;
    this.shown = false;
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    if (!was || !this.object.visible) {
      this.object.visible = false;
      return;
    }
    tw.run({
      duration: 0.25,
      onUpdate: (k) => this.object.scale.setScalar(Math.max(0.0001, 1 - k)),
      onComplete: () => {
        if (this.shown) return;
        this.object.visible = false;
        this.object.scale.setScalar(1);
      },
    });
  }

  update(dt: number): void {
    if (!this.shown) return;
    const t = this.ctx.time.elapsed;
    const m = motionScale(); // 0.9.7: calmer with Reduce motion, like the other pads
    this.feel.update(dt, t, this.pulse, true, true, this.ctx.zones.isPlayerIn(this.area));
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    this.sign.position.y = SIGN_HEIGHT + Math.sin(t * 2.2 + this.object.position.x) * 0.05 * m;
  }
}
