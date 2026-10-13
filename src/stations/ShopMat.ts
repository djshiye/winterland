/**
 * [B7 — progression] The upgrade shop's doormat in front of the cabin door (LAYOUT.shop.mat). Standing on it
 * emits 'shop:open' (the HUD shows the shop panel); stepping off emits 'shop:close'.
 *
 * CONTRACT (keep every public signature; B7 owns the implementation):
 * - Hidden until show() (Progression reveals it; state.flags.shopRevealed). Built shown at once when the flag is
 *   already set (restored save).
 * - First time on the mat sets state.flags.shopVisited.
 * - show(instant): instant = no animation, no sound, no event.
 *
 * STUB (main session): a plain mat, no juice.
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import type { GameContext } from '../core/types';
import type { Zone } from '../items/Zones';
import { mesh, toon } from '../render/materials';

export class ShopMat {
  readonly object = new THREE.Group();
  private shown = false;
  private on = false;
  private readonly zone: Zone;

  constructor(readonly ctx: GameContext) {
    const r = LAYOUT.shop.mat;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const mat = mesh(new THREE.BoxGeometry(w * 0.9, 0.06, d * 0.85), toon(0xc0392b));
    mat.position.y = 0.03;
    mat.castShadow = false;
    this.object.add(mat);
    this.object.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
    this.object.visible = false;
    ctx.scene.add(this.object);
    this.zone = ctx.zones.add({
      id: 'shop:mat',
      area: r,
      enabled: false,
      onEnter: () => {
        this.on = true;
        ctx.state.flags.shopVisited = true;
        ctx.events.emit('shop:open', {});
      },
      onExit: () => {
        this.on = false;
        ctx.events.emit('shop:close', {});
      },
    });
    if (ctx.state.flags.shopRevealed) this.show(true);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** The player is standing on the mat (the shop panel is open). */
  get playerOn(): boolean {
    return this.on;
  }

  show(_instant = false): void {
    if (this.shown) return;
    this.shown = true;
    this.ctx.state.flags.shopRevealed = true;
    this.object.visible = true;
    this.zone.setEnabled(true);
  }

  update(_dt: number): void {}
}
