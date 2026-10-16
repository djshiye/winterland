/**
 * [B7 — progression] The upgrade shop's doormat in front of the cabin door (LAYOUT.shop.mat). Standing on it
 * emits 'shop:open' (the HUD shows the shop panel); stepping off emits 'shop:close'.
 *
 * - A cosy striped rug (assets/pads.ts createMatModel) with a floating "UPGRADES" + up-arrow sign.
 * - Hidden until show() (Progression reveals it; state.flags.shopRevealed). Built shown at once when the flag is
 *   already set (restored save). show(instant): instant = no animation, no sound, no event.
 * - Pulses (rug breathes, sign bounces) while something in the shop is affordable: ctx.upgrades.canBuy over the
 *   'lumberjack' and 'crew' groups (checked twice a second).
 * - First time on the mat sets state.flags.shopVisited.
 * - Juice (fx/PadRing.ts): while something is affordable and the player is off the mat, a warm glow breathes around
 *   the rug; a purchase made while standing on it ('upgrade:bought') flashes the glow, squash-bounces the mat and emits
 *   'pad:complete' (the JuiceDirector's chime and sparkle pop, a longer haptic). Bounces shrink under reduced motion.
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../config';
import type { GameContext } from '../core/types';
import type { Zone } from '../items/Zones';
import { createMatModel, createShopSign } from '../assets/pads';
import { PadRing } from '../fx/PadRing';
import { motionScale } from '../fx/padJuice';

const SIGN_HEIGHT = 2.0;
const CHECK_INTERVAL = 0.5;

export class ShopMat {
  readonly object = new THREE.Group();
  private shown = false;
  private on = false;
  private affordable = false;
  private checkTimer = 0;
  private readonly zone: Zone;
  private readonly rug: THREE.Group;
  private readonly sign: THREE.Mesh;
  private readonly ring: PadRing;

  constructor(readonly ctx: GameContext) {
    const r = LAYOUT.shop.mat;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    this.rug = createMatModel(w, d);
    this.object.add(this.rug);
    this.ring = new PadRing(w, d, { yaw: 0, gap: 0.1, radius: 0.22, y: 0.06 });
    this.object.add(this.ring.mesh);
    this.sign = createShopSign();
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
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
    ctx.events.on('upgrade:bought', () => {
      if (!this.on || !this.shown) return;
      this.ring.flash();
      ctx.tweens.squash(this.object, 0.12 * motionScale(), 0.42);
      ctx.events.emit('pad:complete', { id: 'shop:mat', kind: 'level', position: this.object.position.clone() });
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

  /** Something in the shop (lumberjack or crew) can be bought right now. */
  get hasAffordable(): boolean {
    return this.affordable;
  }

  show(instant = false): void {
    if (this.shown) return;
    this.shown = true;
    this.ctx.state.flags.shopRevealed = true;
    this.zone.setEnabled(true);
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    this.object.scale.setScalar(1);
    this.object.visible = true;
    this.refreshAffordable();
    if (instant) return;
    tw.popIn(this.object, { duration: 0.6 });
    this.ctx.particles.ring(this.object.position, { color: PALETTE.accent, radius: 2.4, life: 0.6 });
    this.ctx.audio.play('whoosh', { volume: 0.5 });
  }

  update(dt: number): void {
    if (!this.shown) return;
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = CHECK_INTERVAL;
      this.refreshAffordable();
    }
    const t = this.ctx.time.elapsed;
    const eager = this.affordable && !this.on;
    const amp = (eager ? 0.05 : 0.012) * motionScale();
    const s = 1 + amp * Math.sin(t * (eager ? 5.5 : 2.4));
    this.rug.scale.set(s, 1, s);
    this.ring.update(dt, t, eager);
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    // the sign hops when there is something to buy, drifts gently otherwise
    const hop = (eager ? Math.abs(Math.sin(t * 4.2)) * 0.28 : Math.sin(t * 2) * 0.05) * motionScale();
    this.sign.position.y = SIGN_HEIGHT + hop;
    this.sign.visible = !this.on;
  }

  private refreshAffordable(): void {
    const up = this.ctx.upgrades;
    this.affordable = up.group('lumberjack').some((id) => up.canBuy(id)) || up.group('crew').some((id) => up.canBuy(id));
  }
}
