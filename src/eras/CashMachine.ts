/**
 * 0.9.5: an era's cash machine (Strongbox, Mint Chute … Quantum Bank; config eraCashMachine), era 1's Cash Tubes for
 * the region market: it banks the market's cash pile by itself, one bundle at a time.
 *
 * - Its LEVEL PAD (eras/LevelPad.ts, the same pad as the era machines') stands east of the cash pile from the moment the
 *   region opens. Lv 1 builds the machine (it pops in south of the pile), every level after banks faster
 *   (`${key}Cash`: bundles a second). Group 'machine': bought only on the pad, never in a shop, never automatically.
 * - Banking: a bundle hops from the pile into the machine's hopper and the door wheel spins. The money is banked the
 *   moment the bundle leaves the pile (like the Cash Tubes), so a save mid-flight loses and doubles nothing.
 * - Nothing extra is saved: the level is in state.upgrades, pad progress in state.padPaid.
 */
import * as THREE from 'three';
import { eraCashMachine, rect } from '../config';
import { createCashMachineModel, CASH_MACHINE_SIZE, type CashMachineModel } from '../assets/cashMachine';
import type { GameContext, Item, ItemHolder, ItemKind, Slot, UpgradeId } from '../core/types';
import { transferOne } from '../items/transfer';
import type { CashPile } from '../stations/CashPile';
import { ERAS } from './data';
import type { XZ } from './layout';
import { EraLevelPad } from './LevelPad';
import { LEVEL_PAD_SIZE } from './rules';

/** The hopper the bundles fly into: takes them out of the world (their money was banked at send time). */
class Hopper implements ItemHolder {
  readonly id: string;
  constructor(
    private readonly ctx: GameContext,
    era: number,
    private readonly at: THREE.Vector3,
  ) {
    this.id = `bank:era${era}Machine`;
  }
  canAccept(kind: ItemKind): boolean {
    return kind === 'cash';
  }
  reserve(_item: Item): Slot {
    return { holder: this };
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.at);
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }
  receive(item: Item, _slot: Slot): void {
    // the money was banked when the bundle left the pile (CashMachine.update), whenever this landing happens
    this.ctx.items.release(item);
  }
  cancel(_slot: Slot): void {}
  count(_kind?: ItemKind): number {
    return 0;
  }
  take(_kind?: ItemKind): Item | null {
    return null;
  }
}

const FLIGHT = { duration: 0.4, arcHeight: 1.2 } as const;
/** Seconds the door wheel spins after a bundle. */
const SPIN = 0.5;

export class CashMachine {
  readonly id: UpgradeId;
  readonly pad: EraLevelPad;
  /** The model, once Lv 1 is bought (null before). */
  model: CashMachineModel | null = null;
  private readonly hopper: Hopper;
  private timer = 0;
  private spin = 0;

  constructor(
    private readonly ctx: GameContext,
    readonly era: number,
    private readonly at: XZ,
    padAt: XZ,
    private readonly cash: CashPile,
    private readonly parent: THREE.Object3D,
  ) {
    const def = ERAS[era]!;
    this.id = `${def.key}Cash`;
    this.pad = new EraLevelPad(ctx, this.id, padAt, LEVEL_PAD_SIZE, (eraCashMachine(era)?.label ?? 'Cash Machine').toUpperCase(), parent, true);
    this.hopper = new Hopper(ctx, era, new THREE.Vector3(at.x + 0.15, 1.8, at.z));
    this.sync(true);
  }

  /** Bundles banked a second (0 = not built). */
  get rate(): number {
    return Math.max(0, this.ctx.upgrades.value(this.id));
  }

  get built(): boolean {
    return this.model !== null;
  }

  /** Build the model once Lv 1 is bought; `instant` (a load) skips the pop. */
  private sync(instant: boolean): void {
    if (this.model || this.ctx.upgrades.level(this.id) <= 0) return;
    const c = ERAS[this.era]!.colors;
    const m = createCashMachineModel(c.accent, c.body, c.trim);
    m.root.position.set(this.at.x, 0, this.at.z);
    this.parent.add(m.root);
    this.model = m;
    const { w, d } = CASH_MACHINE_SIZE;
    this.ctx.colliders.addBox(rect(this.at.x, this.at.z, w, d), `era:${this.era}:cashMachine`);
    if (!instant) {
      this.ctx.tweens.popIn(m.root, { duration: 0.45 });
      this.ctx.particles.puff(new THREE.Vector3(this.at.x, 0.4, this.at.z), { count: 8, size: 0.9, life: 0.9 });
    }
  }

  update(dt: number): void {
    this.pad.update(dt);
    this.sync(false);
    const m = this.model;
    if (!m) return;
    if (this.spin > 0) {
      this.spin -= dt;
      m.wheel.rotation.z -= dt * 9;
    }
    const rate = this.rate;
    if (rate <= 0) return;
    const pile = this.cash.pile;
    if (pile.count('cash') <= 0) {
      this.timer = 0;
      return;
    }
    this.timer += dt * rate;
    while (this.timer >= 1) {
      this.timer -= 1;
      const item = transferOne(this.ctx, pile, this.hopper, ['cash'], FLIGHT);
      if (!item) {
        this.timer = 0;
        break;
      }
      this.ctx.economy.add(item.value);
      item.value = 0;
      this.spin = SPIN;
    }
  }
}
