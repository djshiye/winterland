/**
 * 0.9.5: an era region's market (layout zone `market`, places from eras/market.ts): era 1's customers for the eras.
 *
 * - LOADING DOCK against the fence west of the market gate: buyer trucks in the era's colours (npc/EraBuyers.ts) stop
 *   on the road outside and load from it, like era 1's trucks.
 * - MARKET STALL inside: walk-in shoppers (npc/EraShoppers.ts) come through the market gate and queue at it, like
 *   era 1's walk-in counter.
 * - One CASH PILE (era 1's stations/CashPile.ts) south of the stall: both pay into it, and the player (or a crew)
 *   walks over it to bank the money.
 *
 * Feeding needs no new chore: everything the export depot receives (the player's drops, the era crew's deliveries)
 * goes to the dock if it is a raw material or the stall if it is refined, to the other one when that is full, and is
 * sold at once only when both are full (ExportDepot.forward). The player can also drop goods straight on either
 * counter. Buyers pay Market.marketPrice: the export price × the material's Quality upgrade. `${key}Dock` and
 * `${key}Stall` grow the counters and bring buyers more often, loading faster.
 *
 * Saved: both counters' goods, goods flying onto them, goods held by unpaid buyers (WorldSnapshot eras[n].market) and
 * the cash pile's dollars. Absent in older saves → empty.
 */
import * as THREE from 'three';
import { CASH_GRID, TRADE_POST, TIMING, rect } from '../config';
import { createMarketCounterModel, COUNTER_SIZE } from '../assets/marketCounter';
import type { GameContext, Item, ItemHolder, ItemKind, Slot, UpgradeId } from '../core/types';
import { Pile } from '../items/Pile';
import { CashPile } from '../stations/CashPile';
import { EraBuyers } from '../npc/EraBuyers';
import { EraShoppers } from '../npc/EraShoppers';
import { CashMachine } from './CashMachine';
import { ERAS, MACHINES, MATERIALS, MATERIAL_KINDS, isMaterial, machinesOfEra, type MaterialKind } from './data';
import type { RegionLayout } from './layout';
import { DOCK_BODY, DOCK_GIVE, STALL_BODY, STALL_GIVE, marketPlaces, type MarketPlaces } from './market';
import { worldRect } from './rules';

/**
 * What an empty counter's first buyer asks for: the era's own raw (dock) or refined (stall) product, else the first
 * product of that grade its machines make (era 5 mines era 3/4 ore and coal), else any of them.
 */
export function eraFallback(era: number, grade: 'raw' | 'refined'): MaterialKind {
  const outs = machinesOfEra(era)
    .map((id) => MACHINES[id].output)
    .filter(isMaterial);
  return (
    outs.find((k) => MATERIALS[k].grade === grade && MATERIALS[k].era === era) ??
    outs.find((k) => MATERIALS[k].grade === grade) ??
    outs.find((k) => MATERIALS[k].era === era) ??
    outs[0] ??
    'stone'
  );
}

/** Room on a counter for a dock / stall value: TRADE_POST.room × value, at least the base and at most the grid. */
export function counterRoom(value: number): number {
  const g = TRADE_POST.grid;
  return Math.max(TRADE_POST.room, Math.min(g.cols * g.rows * g.layers, Math.floor(TRADE_POST.room * Math.max(1, value))));
}

/** Snapshot of a market: goods per counter by kind, dollars on the cash pile. */
export interface MarketSnapshot {
  dock: Partial<Record<ItemKind, number>>;
  stall: Partial<Record<ItemKind, number>>;
  cash: number;
}

/**
 * Where an era clerk hands in the market's cash (at the export depot). The bundles were already banked when they left
 * the pile (npc/EraWorker.ts move), so this only takes them out of the world.
 */
class BankSink implements ItemHolder {
  readonly id: string;
  constructor(
    private readonly ctx: GameContext,
    era: number,
    private readonly at: { x: number; z: number },
  ) {
    this.id = `bank:era${era}`;
  }
  canAccept(kind: ItemKind): boolean {
    return kind === 'cash';
  }
  reserve(_item: Item): Slot {
    return { holder: this };
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.at.x, 1.1, this.at.z);
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }
  receive(item: Item, _slot: Slot): void {
    this.ctx.economy.add(item.value); // 0 for a clerk's bundle; anything else that lands here is still money
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

export class RegionMarket {
  readonly places: MarketPlaces;
  readonly dockPile: Pile;
  readonly stallPile: Pile;
  readonly cash: CashPile;
  readonly buyers: EraBuyers;
  readonly shoppers: EraShoppers;
  /** The era's cash machine: banks `cash` once built on its level pad. */
  readonly vault: CashMachine;
  /** Where era clerks hand the cash in (at the export depot) and stand to collect it. */
  readonly bank: ItemHolder;
  readonly clerkSpot: { x: number; z: number };
  readonly cashSpot: { x: number; z: number };
  /** Counter models (the region pops them in on a live unlock). */
  readonly models: THREE.Object3D[] = [];
  private readonly dockId: UpgradeId;
  private readonly stallId: UpgradeId;

  constructor(
    private readonly ctx: GameContext,
    readonly era: number,
    layout: RegionLayout,
    parent: THREE.Object3D,
  ) {
    const def = ERAS[era]!;
    this.dockId = `${def.key}Dock`;
    this.stallId = `${def.key}Stall`;
    const P = marketPlaces(layout);
    this.places = P;

    this.dockPile = this.counter(P.dock, P.yaw, def.colors.accent, ['LOADING', 'DOCK'], `counter:era${era}Dock`, () => this.dockValue(), parent);
    ctx.colliders.addBox(worldRect(P.dock, P.yaw, DOCK_BODY), `era:${era}:loadingDock`);
    this.stallPile = this.counter(P.stall, P.yaw, def.colors.accent, ['MARKET', 'STALL'], `counter:era${era}Stall`, () => this.stallValue(), parent);
    ctx.colliders.addBox(worldRect(P.stall, P.yaw, STALL_BODY), `era:${era}:stall`);
    // the player may also drop goods straight on either counter (yard side)
    ctx.zones.addTransfer({ id: `counter:era${era}Dock:drop`, area: worldRect(P.dock, P.yaw, DOCK_GIVE), from: ctx.player.arms, to: this.dockPile, kinds: MATERIAL_KINDS, interval: TIMING.dropInterval, marker: true });
    ctx.zones.addTransfer({ id: `counter:era${era}Stall:drop`, area: worldRect(P.stall, P.yaw, STALL_GIVE), from: ctx.player.arms, to: this.stallPile, kinds: MATERIAL_KINDS, interval: TIMING.dropInterval, marker: true });

    this.cash = new CashPile(ctx, { id: `pile:era${era}Cash`, x: P.cash.x, z: P.cash.z, grid: CASH_GRID, zone: rect(P.cash.x, P.cash.z, 2.0, 1.8) });
    this.bank = new BankSink(ctx, era, layout.depot);
    this.vault = new CashMachine(ctx, era, P.vault, P.vaultPad, this.cash, parent);
    this.clerkSpot = P.clerk;
    this.cashSpot = P.cash;

    const pay = (kind: MaterialKind, count: number, at: THREE.Vector3): void => this.pay(kind, count, at);
    this.buyers = new EraBuyers(ctx, {
      era,
      pile: this.dockPile,
      x: P.dock.x,
      road: layout.road,
      colors: [def.colors.accent, def.colors.body],
      fallback: eraFallback(era, 'raw'),
      boost: () => this.dockValue(),
      pay,
    });
    this.shoppers = new EraShoppers(ctx, {
      era,
      pile: this.stallPile,
      door: P.door,
      entry: P.entry,
      front: P.front,
      step: P.step,
      // shoppers stand on the road side of the stall and face it
      faceYaw: layout.inward > 0 ? 0 : Math.PI,
      inward: layout.inward,
      road: layout.road,
      fallback: eraFallback(era, 'refined'),
      boost: () => this.stallValue(),
      pay,
    });
  }

  private counter(at: { x: number; z: number }, yaw: number, accent: number, lines: [string, string], id: string, value: () => number, parent: THREE.Object3D): Pile {
    const model = createMarketCounterModel(accent, yaw, lines);
    model.position.set(at.x, 0, at.z);
    model.rotation.y = yaw;
    parent.add(model);
    this.models.push(model);
    return new Pile(this.ctx, { id, accepts: MATERIAL_KINDS, position: new THREE.Vector3(0, COUNTER_SIZE.height, 0), parent: model, grid: TRADE_POST.grid, limit: () => counterRoom(value()) });
  }

  dockValue(): number {
    return Math.max(1, this.ctx.upgrades.value(this.dockId));
  }

  stallValue(): number {
    return Math.max(1, this.ctx.upgrades.value(this.stallId));
  }

  /** A buyer paid: the price into the cash pile, the stats and the usual 'sale' juice. */
  private pay(kind: MaterialKind, count: number, at: THREE.Vector3): void {
    const m = this.ctx.market;
    const amount = m.marketPrice(kind, count);
    this.cash.pay(amount, at);
    m.noteMarketSale(kind, count);
    this.ctx.events.emit('sale', { buyer: 'trader', kind, count, amount, position: at });
  }

  /**
   * The export depot received `item`: hop it onto the dock (raw) or the stall (refined), else the other one; false when
   * both are full (the depot sells it). The item is already off its old holder, at the depot's door.
   */
  forward(item: Item): boolean {
    if (!isMaterial(item.kind)) return false;
    const raw = MATERIALS[item.kind].grade === 'raw';
    const first = raw ? this.dockPile : this.stallPile;
    const second = raw ? this.stallPile : this.dockPile;
    const to = first.canAccept(item.kind) ? first : second.canAccept(item.kind) ? second : null;
    if (!to) return false;
    const slot = to.reserve(item);
    this.ctx.flights.launch(item, to, slot, { duration: 0.55, arcHeight: 1.6 });
    return true;
  }

  /** 0.9.6 (F6): both counters are full, so the export depot sells what it receives at once, at the plain price. */
  countersFull(): boolean {
    return this.dockPile.isFull() && this.stallPile.isFull();
  }

  update(dt: number): void {
    this.buyers.update(dt);
    this.shoppers.update(dt);
    this.vault.update(dt);
  }

  snapshot(): MarketSnapshot {
    const fl = this.ctx.flights;
    const goods = (pile: Pile): Partial<Record<ItemKind, number>> => {
      const out: Partial<Record<ItemKind, number>> = {};
      for (const k of MATERIAL_KINDS) {
        const n = pile.count(k) + fl.inFlightTo(pile, k);
        if (n > 0) out[k] = n;
      }
      return out;
    };
    const dock = goods(this.dockPile);
    this.buyers.unpaid(dock);
    const stall = goods(this.stallPile);
    this.shoppers.unpaid(stall);
    return { dock, stall, cash: this.cash.value };
  }

  /** Refill from a save. Goods that no longer fit are credited at the depot quote instead of lost; returns those dollars. */
  restore(s: Partial<MarketSnapshot> | undefined): number {
    this.buyers.clear();
    this.shoppers.clear();
    let credited = this.fill(this.dockPile, s?.dock ?? {});
    credited += this.fill(this.stallPile, s?.stall ?? {});
    const cash = Math.max(0, Math.floor(s?.cash ?? 0));
    if (cash > 0) this.cash.restoreValue(cash);
    return credited;
  }

  private fill(pile: Pile, goods: Partial<Record<ItemKind, number>>): number {
    pile.clear();
    let credited = 0;
    for (const k of MATERIAL_KINDS) {
      const n = Math.max(0, Math.floor(goods[k] ?? 0));
      if (n <= 0) continue;
      const before = pile.count(k);
      pile.fill(k, n);
      const over = n - (pile.count(k) - before);
      if (over > 0) {
        const v = Math.round(this.ctx.market.quote(k, 'sell') * over);
        this.ctx.economy.add(v);
        credited += v;
      }
    }
    return credited;
  }
}
