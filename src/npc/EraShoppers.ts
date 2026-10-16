/**
 * 0.9.5: walk-in shoppers at an era region's market stall (eras/RegionMarket.ts), era 1's CustomerQueue for the eras.
 *
 * A shopper pops in at the market gate, walks to the entry point, then to its place in line (front + i · step). At the
 * front it picks the kind the stall has most of, takes one unit per TIMING.dockTakeInterval ÷ the Stall upgrade (up to
 * TIMING.dockLoadMax), shows "have/want" in its bubble, pays for its order into the market's cash pile, cheers and
 * walks back out through the gate, carrying what it bought, and fades on the road. A shopper that gets nothing for
 * TRADE_POST.patience seconds pays for what it holds (or, empty-handed, keeps waiting for the next delivery).
 * New shoppers only come while the stall has goods or the line is empty, so a quiet market shows one waiting shopper.
 * Entities (rig + carry stack + bubble) are pooled.
 */
import * as THREE from 'three';
import { PLAYER, TIMING, TRADE_POST } from '../config';
import { approach, dampAngle, randRange, yawFromDir } from '../core/math';
import type { GameContext, ItemKind } from '../core/types';
import { CarryStack } from '../items/CarryStack';
import type { Pile } from '../items/Pile';
import { transferOne } from '../items/transfer';
import { createCharacterRig, type CharacterRig } from '../render/characters';
import { createSpeechBubble, type SpeechBubble } from '../assets/shop';
import { MATERIAL_KINDS, type MaterialKind } from '../eras/data';
import type { XZ } from '../eras/layout';

/** What the line needs from its market stall. */
export interface ShopperStall {
  readonly era: number;
  readonly pile: Pile;
  /** Gate opening, entry point inside it, the front of the line and the step between two shoppers (world XZ). */
  readonly door: XZ;
  readonly entry: XZ;
  readonly front: XZ;
  readonly step: XZ;
  /** Yaw a shopper at the counter faces. */
  readonly faceYaw: number;
  /** Unit vector from the gate into the region (+1 / −1 along Z): shoppers leave this far out onto the road. */
  readonly inward: number;
  readonly fallback: MaterialKind;
  /** The Stall value (≥ 1). */
  boost(): number;
  pay(kind: MaterialKind, count: number, at: THREE.Vector3): void;
}

type Mode = 'in' | 'queue' | 'paid' | 'out';

const VARIANTS = 4;
const ACCEL = 12;
const TURN = 14;
const tmp = new THREE.Vector3();

class Shopper {
  readonly group = new THREE.Group();
  readonly rig: CharacterRig;
  readonly stack: CarryStack;
  readonly bubble: SpeechBubble;
  readonly velocity = new THREE.Vector3();
  readonly bubbleY: number;
  mode: Mode = 'in';
  kind: MaterialKind | null = null;
  want = 1;
  speed = 0;
  yaw = 0;
  /** Waypoints left (world XZ), walked in order. */
  path: XZ[] = [];
  takeTimer = 0;
  idle = 0;
  timer = 0;
  bubbleOn = false;
  bob = Math.random() * 10;

  constructor(ctx: GameContext, id: string, variant: number) {
    this.rig = createCharacterRig('customer', variant);
    this.group.add(this.rig.root);
    this.bubble = createSpeechBubble(1.05);
    this.bubble.sprite.visible = false;
    this.group.add(this.bubble.sprite);
    this.bubbleY = this.rig.height + 0.4;
    this.bubble.sprite.position.y = this.bubbleY;
    this.stack = new CarryStack(ctx, { id, accepts: MATERIAL_KINDS, capacity: TRADE_POST.shopWant[1] + 1, anchor: this.rig.armsAnchor });
  }
}

export class EraShoppers {
  private readonly queue: Shopper[] = [];
  private readonly leaving: Shopper[] = [];
  private readonly pool: Shopper[] = [];
  private created = 0;
  private spawnTimer = 0.8;

  constructor(
    private readonly ctx: GameContext,
    private readonly stall: ShopperStall,
  ) {}

  /** Shoppers in line (walking in included). */
  get waiting(): number {
    return this.queue.length;
  }

  /** Goods held by shoppers who have not paid yet, by kind (the save puts them back on the stall). */
  unpaid(out: Partial<Record<ItemKind, number>>): void {
    const fl = this.ctx.flights;
    for (const c of this.queue) {
      if (c.mode === 'paid') continue;
      for (const k of MATERIAL_KINDS) {
        const n = c.stack.count(k) + fl.inFlightTo(c.stack, k);
        if (n > 0) out[k] = (out[k] ?? 0) + n;
      }
    }
  }

  /** Everyone back to the pool (restore / tests). Unpaid goods are released. */
  clear(): void {
    while (this.queue.length) this.leaving.push(this.queue.pop()!);
    for (let i = this.leaving.length - 1; i >= 0; i--) this.despawn(i);
  }

  private slot(i: number): XZ {
    const s = this.stall;
    return { x: s.front.x + s.step.x * i, z: s.front.z + s.step.z * i };
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.spawnStep(dt);
    for (let i = 0; i < this.queue.length; i++) this.stepQueued(this.queue[i]!, i, dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const c = this.leaving[i]!;
      if (this.walk(c, dt, true)) {
        this.despawn(i);
        continue;
      }
      if (c.bubbleOn) {
        c.timer -= dt;
        if (c.timer <= 0) {
          c.bubbleOn = false;
          this.ctx.tweens.popOut(c.bubble.sprite, { duration: 0.25 });
        }
      }
      this.animate(c, dt);
    }
  }

  // ---- spawning -------------------------------------------------------------------------------------------------
  private spawnStep(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    if (this.queue.length >= TRADE_POST.shopQueue || (this.queue.length > 0 && this.stall.pile.total === 0)) {
      this.spawnTimer = 0.5;
      return;
    }
    this.spawnTimer = randRange(TRADE_POST.shopGap[0], TRADE_POST.shopGap[1]) / Math.max(1, this.stall.boost());
    const c = this.pool.pop() ?? new Shopper(this.ctx, `npc:shopper${this.stall.era}:${this.created}`, this.created % VARIANTS);
    this.created++;
    const s = this.stall;
    c.mode = 'in';
    c.kind = null;
    c.want = Math.round(randRange(TRADE_POST.shopWant[0] - 0.49, TRADE_POST.shopWant[1] + 0.49));
    c.speed = 0;
    c.takeTimer = 0;
    c.idle = 0;
    c.timer = 0;
    c.bubbleOn = false;
    c.bubble.sprite.visible = false;
    c.stack.clear();
    c.rig.setCarrying(false);
    c.rig.setSeated(false);
    c.yaw = yawFromDir(s.entry.x - s.door.x, s.entry.z - s.door.z);
    c.rig.root.rotation.y = c.yaw;
    c.group.position.set(s.door.x + randRange(-0.3, 0.3), 0, s.door.z);
    c.path = [s.entry];
    this.ctx.scene.add(c.group);
    this.ctx.tweens.popIn(c.group, { duration: 0.35 });
    this.queue.push(c);
  }

  private despawn(i: number): void {
    const c = this.leaving[i]!;
    this.leaving.splice(i, 1);
    c.stack.clear();
    this.ctx.tweens.killTweensOf(c.bubble.sprite);
    this.ctx.tweens.killTweensOf(c.group);
    c.bubble.sprite.visible = false;
    c.group.removeFromParent();
    c.group.scale.setScalar(1);
    this.pool.push(c);
  }

  // ---- queue ----------------------------------------------------------------------------------------------------
  private stepQueued(c: Shopper, index: number, dt: number): void {
    // walk the entry path first, then to the current place in line (it moves up as the line shortens)
    let there = false;
    if (c.path.length > 0) this.walk(c, dt, false);
    else {
      const t = this.slot(index);
      there = this.moveToward(c, t.x, t.z, dt, false);
    }
    if (there) c.yaw = dampAngle(c.yaw, this.stall.faceYaw, TURN, dt);
    c.rig.root.rotation.y = c.yaw;
    this.animate(c, dt);
    if (index !== 0 || !there) return;
    if (c.mode === 'in' || c.mode === 'queue') {
      c.mode = 'queue';
      this.serve(c, dt);
    } else if (c.mode === 'paid') {
      c.timer -= dt;
      if (c.timer <= 0) this.sendAway(c);
    }
  }

  private plentiful(): MaterialKind | null {
    let best: MaterialKind | null = null;
    let n = 0;
    for (const k of MATERIAL_KINDS) {
      const v = this.stall.pile.count(k);
      if (v > n) {
        n = v;
        best = k;
      }
    }
    return best;
  }

  private serve(c: Shopper, dt: number): void {
    const pile = this.stall.pile;
    if (c.stack.size === 0) {
      const k = this.plentiful();
      if (k && (c.kind === null || pile.count(c.kind) === 0)) {
        c.kind = k;
        c.idle = 0;
      }
      if (c.kind === null) c.kind = this.stall.fallback;
    }
    const kind = c.kind!;
    if (!c.bubbleOn) {
      c.bubbleOn = true;
      c.bubble.sprite.visible = true;
      this.ctx.tweens.popIn(c.bubble.sprite);
    }
    const have = c.stack.size;
    c.bubble.show(kind, `${have}/${c.want}`);
    c.takeTimer -= dt;
    c.idle += dt;
    if (c.takeTimer <= 0 && have < c.want && pile.count(kind) > 0) {
      c.takeTimer = TIMING.dockTakeInterval / Math.min(TIMING.dockLoadMax, Math.max(1, this.stall.boost()));
      if (transferOne(this.ctx, pile, c.stack, [kind])) {
        c.idle = 0;
        c.rig.setCarrying(true);
      }
    }
    const landed = c.stack.count(kind);
    if (landed >= c.want || (landed > 0 && landed === have && c.idle >= TRADE_POST.patience)) this.pay(c, landed);
  }

  private pay(c: Shopper, count: number): void {
    c.rig.armsAnchor.getWorldPosition(tmp);
    tmp.y += 0.4;
    this.stall.pay(c.kind!, count, tmp);
    c.mode = 'paid';
    c.timer = 0.6;
    c.rig.cheer();
    c.bubble.show('check');
    this.ctx.tweens.popIn(c.bubble.sprite, { duration: 0.35 });
  }

  private sendAway(c: Shopper): void {
    const i = this.queue.indexOf(c);
    if (i >= 0) this.queue.splice(i, 1);
    const s = this.stall;
    c.mode = 'out';
    c.timer = 1.0;
    c.path = [s.entry, s.door, { x: s.door.x, z: s.door.z - s.inward * 1.6 }];
    this.leaving.push(c);
  }

  // ---- movement -------------------------------------------------------------------------------------------------
  /** Walk the waypoint list; true once its last point is reached (fading out on the last stretch when leaving). */
  private walk(c: Shopper, dt: number, leaving: boolean): boolean {
    const p = c.path[0];
    if (!p) return true;
    const last = c.path.length === 1;
    if (this.moveToward(c, p.x, p.z, dt, !last || leaving)) {
      c.path.shift();
      if (leaving && c.path.length === 1) this.ctx.tweens.popOut(c.group, { duration: 0.45 });
      if (c.path.length === 0) return true;
    }
    if (leaving) c.rig.root.rotation.y = c.yaw;
    return false;
  }

  private moveToward(c: Shopper, tx: number, tz: number, dt: number, passThrough: boolean): boolean {
    const p = c.group.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.02) {
      p.x = tx;
      p.z = tz;
      if (!passThrough) c.speed = 0;
      c.velocity.set(0, 0, 0);
      return true;
    }
    const max = TRADE_POST.walkSpeed;
    c.speed = approach(c.speed, passThrough ? max : Math.min(max, 1.0 + dist * 4), ACCEL * dt);
    const step = c.speed * dt;
    const nx = dx / dist;
    const nz = dz / dist;
    c.yaw = dampAngle(c.yaw, yawFromDir(dx, dz), TURN, dt);
    c.velocity.set(nx * c.speed, 0, nz * c.speed);
    if (step >= dist) {
      p.x = tx;
      p.z = tz;
      if (!passThrough) c.speed = 0;
      return true;
    }
    p.x += nx * step;
    p.z += nz * step;
    return false;
  }

  private animate(c: Shopper, dt: number): void {
    c.rig.animate(dt, c.speed / PLAYER.speed);
    c.stack.update(dt, c.velocity);
    if (c.bubble.sprite.visible) c.bubble.sprite.position.y = c.bubbleY + Math.sin((this.ctx.time.elapsed + c.bob) * 4.5) * 0.04;
  }
}
