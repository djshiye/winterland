/**
 * [0.9.0 — npc] Jack of all trades: a cheerful trader with a swap cart who buys ANYTHING the player carries off their
 * hands for UPGRADES.jack share × ctx.market.unitValue (ctx.market.jackOffer): a discard for wrong pickups, or quick cash.
 * One cart in the yard (eras/data.ts JACK.yard, appears with the shop reveal) and one in every unlocked era region
 * (eras/layout.ts regionLayout.jack, visible at once).
 *
 * - The cart (assets/jack.ts) stands at `at`, front (counter) toward local +Z rotated by `yaw`, with a solid collider; Jack
 *   stands beside it (CharacterRig idle, turns to the player, waves hello, hops + rings the bell when he buys).
 * - A TRANSFER ZONE in front of the cart moves the player's carried goods (every CARRY kind but cash) into a JackSink. It is
 *   a 'give' zone with `delay: JACK.delay`, so walking past never discards: the player has to linger. Its `interval` shrinks
 *   with the jack upgrade (the zone is re-registered when the level changes: a zone's interval is fixed at creation).
 * - JackSink.receive pays through ctx.market.sellToJack (which credits the money and emits 'sale' {buyer 'jack'}: the juice
 *   director already adds the "+$" float, sparkle and sell sound) and recycles the item.
 * - While the player stands in the zone a floating tag over the cart reads "Jack pays $X for your <item>".
 * - The yard cart (id 'jack:yard') stays hidden, with its zone and collider off, until state.flags.shopRevealed.
 */
import * as THREE from 'three';
import { JACK, MATERIALS, isMaterial, lowerLabel } from '../eras/data';
import { TIMING, UPGRADES, type Rect } from '../config';
import { createJackCartModel, createJackModel, type JackCartModel } from '../assets/jack';
import { dampAngle, wrapAngle } from '../core/math';
import { CARRY_KINDS, type GameContext, type Item, type ItemHolder, type ItemKind, type Slot } from '../core/types';
import type { ColliderHandle } from '../world/Colliders';
import type { XZ } from '../eras/layout';
import type { Zone } from '../items/Zones';
import { CharacterRig } from '../render/characters';
import { GAME_FONT, makeCanvasTexture } from '../render/materials';
import { formatMoney } from '../ui/format';

/** What Jack takes: everything the player can carry except cash. */
export const JACK_KINDS: readonly ItemKind[] = (CARRY_KINDS as readonly ItemKind[]).filter((k) => k !== 'cash');

/** Local (cart frame) rectangle of the zone in front of the counter: x ±1.0, z 0.7 .. 2.1. */
const ZONE_LOCAL = { minX: -1.0, maxX: 1.0, minZ: 0.7, maxZ: 2.1 } as const;
/** Where Jack stands (cart frame) and the direction he faces by default (towards the customers' side). */
const JACK_AT = { x: 1.6, z: 0.5 } as const;
const JACK_FACE = -0.95;
/** Player closer than this (m): Jack turns to them and greets. */
const NOTICE = 6.5;
const WAVE_TIME = 1.5;
const WAVE_GAP = 7;
const CHEER_GAP = 0.9;
const COIN_COLORS = [0xffd84a, 0xffe58a, 0xe8b53a];

/** Seconds between two items at the cart for the current jack upgrade value (shrinks as Jack pays more). */
export function jackInterval(share: number): number {
  return Math.max(TIMING.minInterval, JACK.interval * (UPGRADES.jack.values[0]! / Math.max(share, 0.01)));
}

/** World-space AABB of the cart-frame rectangle `r` for a cart at `at` rotated by `yaw` (the rotation is a multiple of π/2 in practice). */
export function worldRect(at: XZ, yaw: number, r: Rect): Rect {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const lx of [r.minX, r.maxX]) {
    for (const lz of [r.minZ, r.maxZ]) {
      const x = at.x + lx * c + lz * s;
      const z = at.z - lx * s + lz * c;
      out.minX = Math.min(out.minX, x);
      out.maxX = Math.max(out.maxX, x);
      out.minZ = Math.min(out.minZ, z);
      out.maxZ = Math.max(out.maxZ, z);
    }
  }
  return out;
}

/** World rectangle of the swap zone of a cart at `at` facing `yaw`. */
export function jackZoneRect(at: XZ, yaw: number): Rect {
  return worldRect(at, yaw, ZONE_LOCAL);
}

/** World rectangle of the cart's solid collider. */
export function jackColliderRect(at: XZ, yaw: number, halfW = 1.06, halfD = 0.55): Rect {
  return worldRect(at, yaw, { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD });
}

/** Lower-case display name of an item kind ("log", "iron ore"). */
export function jackItemName(kind: ItemKind): string {
  return isMaterial(kind) ? lowerLabel(MATERIALS[kind].label) : kind;
}

/**
 * The swap cart's input: accepts every CARRY kind except cash while alive, counts in-flight reservations, and on landing
 * pays out through ctx.market.sellToJack and recycles the item. Holds nothing (count 0, take null).
 */
export class JackSink implements ItemHolder {
  readonly id: string;
  /** Items on their way (reserved, not yet landed). */
  pending = 0;
  disposed = false;

  /**
   * @param ctx    game context (market, items)
   * @param id     cart id ('jack:yard' …)
   * @param target world point the goods fly to (the cart's counter)
   * @param onSold called after each purchase (cart animation / particles)
   */
  constructor(
    private readonly ctx: GameContext,
    id: string,
    private readonly target: () => THREE.Vector3,
    private readonly onSold?: (amount: number, item: Item) => void,
  ) {
    this.id = `npc:${id}:swap`;
  }

  canAccept(kind: ItemKind): boolean {
    return !this.disposed && kind !== 'cash';
  }
  reserve(_item: Item): Slot {
    this.pending++;
    return { holder: this };
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.target());
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }
  receive(item: Item, _slot: Slot): void {
    this.pending = Math.max(0, this.pending - 1);
    const amount = this.ctx.market.sellToJack(item.kind, this.target());
    this.ctx.items.release(item);
    this.onSold?.(amount, item);
  }
  cancel(_slot: Slot): void {
    this.pending = Math.max(0, this.pending - 1);
  }
  count(_kind?: ItemKind): number {
    return 0;
  }
  take(_kind?: ItemKind): Item | null {
    return null;
  }
}

/** Jack's swap cart: model, collider, zone, sink and the little show he puts on. See the file header. */
export class JackCart {
  readonly object: THREE.Group;
  /** The sink the zone delivers into. */
  readonly sink: JackSink;
  /** World rectangle of the swap zone / of the cart's solid collider. */
  readonly zoneArea: Rect;
  readonly blockArea: Rect;

  private readonly model: JackCartModel;
  private readonly rig: CharacterRig;
  private readonly collider: ColliderHandle;
  private zone: Zone | null = null;
  private level = 0;
  private active = false;
  private disposed = false;
  /** Yard cart: hidden until the shop is revealed. */
  private readonly gated: boolean;

  private readonly heapWorld = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private time = Math.random() * 10;
  private waveT = -1;
  private waveCool = 0;
  private wasNear = false;
  private cheerCool = 0;
  private ringT = -1;
  private facing = JACK_FACE;
  private tag: PriceTag | null = null;

  /** `at`: cart centre (world); `yaw`: cart front (local +Z) direction about +Y. The cart registers its own zone + collider. */
  constructor(
    protected readonly ctx: GameContext,
    readonly at: XZ,
    readonly yaw: number,
    readonly id: string,
  ) {
    this.gated = id === 'jack:yard';
    this.model = createJackCartModel();
    this.rig = new CharacterRig(createJackModel());
    this.rig.root.position.set(JACK_AT.x, 0, JACK_AT.z);
    this.rig.root.rotation.y = JACK_FACE;
    // small character: only the torso keeps a shadow (draw-call budget)
    this.rig.root.traverse((o) => {
      if (o.name !== 'torso') o.castShadow = false;
    });

    this.object = new THREE.Group();
    this.object.name = id;
    this.object.position.set(at.x, 0, at.z);
    this.object.rotation.y = yaw;
    this.object.add(this.model.root, this.rig.root);
    ctx.scene.add(this.object);
    this.object.updateMatrixWorld(true);

    this.sink = new JackSink(ctx, id, () => this.heapPoint(), (amount) => this.onSold(amount));
    this.zoneArea = jackZoneRect(at, yaw);
    this.blockArea = jackColliderRect(at, yaw, this.model.halfW + 0.01, this.model.halfD);
    this.collider = ctx.colliders.addBox(this.blockArea, id);

    this.setActive(!this.gated || !!ctx.state.flags.shopRevealed);
    this.registerZone();
  }

  /** The cart is open for business (visible, zone + collider on). */
  get open(): boolean {
    return this.active;
  }

  /** World position of the counter spot the goods land on. */
  private heapPoint(): THREE.Vector3 {
    return this.heapWorld.copy(this.model.heap).applyMatrix4(this.object.matrixWorld);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const open = !this.gated || !!this.ctx.state.flags.shopRevealed;
    if (open !== this.active) this.setActive(open);
    if (!this.active) return;
    const lvl = this.ctx.upgrades.level('jack');
    if (lvl !== this.level) this.registerZone();

    this.time += dt;
    this.cheerCool -= dt;
    this.waveCool -= dt;
    this.animateJack(dt);
    this.animateBell(dt);
    this.updateTag();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sink.disposed = true;
    this.removeZone();
    this.ctx.colliders.remove(this.collider);
    this.tag?.dispose();
    this.tag = null;
    this.object.removeFromParent();
    // baked meshes own their (merged) geometry; primitives come from the shared geo cache and must stay
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.type === 'BufferGeometry') m.geometry.dispose();
    });
  }

  // --- internals ------------------------------------------------------------

  private setActive(on: boolean): void {
    this.active = on;
    this.object.visible = on;
    this.collider.enabled = on;
    this.zone?.setEnabled(on);
  }

  /** (Re)create the transfer zone: its interval follows the jack upgrade and cannot change after creation. */
  private registerZone(): void {
    this.removeZone();
    this.level = this.ctx.upgrades.level('jack');
    this.zone = this.ctx.zones.addTransfer({
      id: `${this.id}:swap`,
      area: this.zoneArea,
      from: this.ctx.player.arms,
      to: this.sink,
      kinds: JACK_KINDS,
      kind: 'give',
      reach: 'exact', // Jack buys at a discount: only a deliberate step onto his mat sells (no forgiving reach)
      delay: JACK.delay,
      interval: jackInterval(this.ctx.upgrades.value('jack')),
      marker: true,
      enabled: this.active,
    });
  }

  private removeZone(): void {
    if (!this.zone) return;
    this.ctx.zones.remove(this.zone);
    this.zone = null;
  }

  /** A purchase went through: Jack hops, the bell rings, a few coins pop off the counter. */
  private onSold(amount: number): void {
    if (this.disposed) return;
    this.ringT = 0;
    if (this.cheerCool <= 0) {
      this.cheerCool = CHEER_GAP;
      this.rig.cheer();
      this.ctx.audio.play('cash', { volume: 0.45 });
    }
    if (amount > 0) {
      this.tmp.copy(this.heapPoint());
      this.ctx.particles.burst(this.tmp, { colors: COIN_COLORS, count: 3, speed: 2.4, size: 0.14, spread: 0.7, life: 0.55, gravity: 9, shape: 'sphere' });
    }
  }

  /** Idle sway, turning to a nearby player and waving hello now and then. */
  private animateJack(dt: number): void {
    const p = this.ctx.player.position;
    const dx = p.x - this.at.x;
    const dz = p.z - this.at.z;
    const near = dx * dx + dz * dz < NOTICE * NOTICE;
    let face = JACK_FACE;
    if (near) {
      // direction from Jack (not the cart centre) to the player, in the cart frame
      const jx = this.at.x + JACK_AT.x * Math.cos(this.yaw) + JACK_AT.z * Math.sin(this.yaw);
      const jz = this.at.z - JACK_AT.x * Math.sin(this.yaw) + JACK_AT.z * Math.cos(this.yaw);
      face = wrapAngle(Math.atan2(p.x - jx, p.z - jz) - this.yaw);
      face = Math.max(-1.6, Math.min(1.1, face));
    }
    this.facing = dampAngle(this.facing, face, 6, dt);
    this.rig.root.rotation.y = this.facing;

    if (near && (!this.wasNear || this.waveCool <= 0) && this.waveT < 0) {
      this.waveT = 0;
      this.waveCool = WAVE_GAP;
    }
    this.wasNear = near;
    if (this.waveT >= 0) {
      this.waveT += dt;
      if (this.waveT > WAVE_TIME) {
        this.waveT = -1;
        this.rig.armRAngle = null;
      } else {
        const up = Math.min(1, Math.sin((this.waveT / WAVE_TIME) * Math.PI) * 3);
        this.rig.armRAngle = -2.3 * up + Math.sin(this.time * 11) * 0.3 * up;
      }
    }
    this.rig.animate(dt, 0);
  }

  private animateBell(dt: number): void {
    if (this.ringT < 0) return;
    this.ringT += dt;
    if (this.ringT > 1) {
      this.ringT = -1;
      this.model.bell.rotation.z = 0;
      return;
    }
    this.model.bell.rotation.z = Math.sin(this.ringT * 30) * 0.5 * Math.exp(-this.ringT * 5);
  }

  /** The floating "Jack pays $X for your <item>" tag, only while the player stands in the zone. */
  private updateTag(): void {
    const inside = !!this.zone?.playerInside;
    if (!inside) {
      if (this.tag) this.tag.sprite.visible = false;
      return;
    }
    if (typeof document === 'undefined') return;
    const arms = this.ctx.player.arms;
    let text: [string, string, string] = ['Jack buys anything you carry', '', ''];
    for (const k of JACK_KINDS) {
      if (arms.count(k) > 0) {
        text = ['Jack pays ', formatMoney(this.ctx.market.jackOffer(k)), ` for your ${jackItemName(k)}`];
        break;
      }
    }
    this.tag ??= new PriceTag(this.object);
    this.tag.set(text);
  }
}

/** Small canvas sprite above the cart; redraws only when its text changes. */
class PriceTag {
  readonly sprite: THREE.Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly c2d: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private key = '';

  constructor(parent: THREE.Object3D) {
    const { canvas, ctx, texture } = makeCanvasTexture(512, 96);
    this.canvas = canvas;
    this.c2d = ctx;
    this.texture = texture;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    this.sprite.scale.set(4.4, 0.825, 1);
    this.sprite.position.set(0, 3.3, 0.2);
    this.sprite.renderOrder = 20;
    parent.add(this.sprite);
  }

  set(parts: [string, string, string]): void {
    this.sprite.visible = true;
    const key = parts.join('|');
    if (key === this.key) return;
    this.key = key;
    const c = this.c2d;
    const w = this.canvas.width;
    const h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.font = `700 38px ${GAME_FONT}`;
    c.textBaseline = 'middle';
    const widths = parts.map((s) => c.measureText(s).width);
    const total = widths[0]! + widths[1]! + widths[2]!;
    const bw = Math.min(w - 8, total + 44);
    c.fillStyle = 'rgba(40, 28, 20, 0.82)';
    c.beginPath();
    c.roundRect((w - bw) / 2, 8, bw, h - 16, 22);
    c.fill();
    let x = (w - total) / 2;
    const colors = ['#ffffff', '#ffd84a', '#ffffff'];
    for (let i = 0; i < 3; i++) {
      c.fillStyle = colors[i]!;
      c.textAlign = 'left';
      c.fillText(parts[i]!, x, h / 2 + 2);
      x += widths[i]!;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    (this.sprite.material as THREE.SpriteMaterial).dispose();
  }
}
