/**
 * [eras] 0.9.5: the conveyor belts of one unlocked region (eras/belts.ts decides which and where). From Lv 1 of the
 * era's Belts upgrade (`${key}Belts`, bought at the region's shop mat) every processor input gets a roller belt from
 * the nearest machine making that kind; each level speeds the belts up. Machines built or demolished re-plan the belts
 * (checked twice a second): a new belt pops in segment by segment ('built'), a belt whose machines are gone is taken
 * away and whatever rode on it goes to the import dock (never lost).
 *
 * The belts are stations/Conveyor.ts (Survival's roller conveyor): they pull from the producer's output pile and hand
 * over into the consumer's hopper only while it has room (the hopper's cap), so belts and workers share the work.
 */
import type { GameContext, Item, ItemKind } from '../core/types';
import type { EraUpgradeId } from '../core/types';
import { Conveyor } from '../stations/Conveyor';
import { beltKey, planBelts, type BeltLink } from './belts';
import { ERAS } from './data';
import type { Region } from './Region';

/** Belt speed (m/s) at Belts value 1 (Survival's conveyors run 2.6). */
export const ERA_BELT_SPEED = 2.2;
const BELT = { width: 0.7, beltY: 0.5, spacing: 0.45 } as const;
/** 0.9.6: how much higher a belt on each level (eras/belts.ts BELT_LEVELS) runs: raised ones pass over a head. */
export const BELT_LIFT: readonly number[] = [0, 1.6, 2.6];
/** Seconds between two re-plans. */
const PLAN_EVERY = 0.5;

export class EraBelts {
  readonly upgradeId: EraUpgradeId;
  private readonly belts = new Map<string, { link: BeltLink; belt: Conveyor }>();
  private timer = 0;
  private sig = '';

  constructor(
    private readonly ctx: GameContext,
    private readonly region: Region,
  ) {
    this.upgradeId = `${ERAS[region.era]!.key}Belts`;
  }

  /** Belt speed now (m/s). */
  speed(): number {
    return ERA_BELT_SPEED * Math.max(0, this.ctx.upgrades.value(this.upgradeId));
  }

  /** Re-plan now: instant (a restored game) builds without animation or events. */
  sync(instant: boolean): void {
    const on = this.ctx.upgrades.level(this.upgradeId) > 0;
    const machines = this.region.machines.map((m) => (m ? m.def : null));
    const sig = `${on}|${machines.map((d) => d?.id ?? '').join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const want = on ? planBelts(this.region.layout, machines) : [];
    const keep = new Set(want.map(beltKey));
    for (const [key, b] of this.belts) {
      if (keep.has(key)) continue;
      b.belt.dispose((item) => this.toDock(item));
      this.belts.delete(key);
    }
    for (const link of want) {
      const key = beltKey(link);
      if (this.belts.has(key)) continue;
      const from = this.region.machines[link.from];
      const to = this.region.machines[link.to];
      if (!from || !to?.input) continue;
      const belt = new Conveyor(this.ctx, {
        id: `conveyor:era${this.region.era}:${key}`,
        path: link.path,
        width: BELT.width,
        beltY: BELT.beltY + (BELT_LIFT[link.level] ?? 0),
        speed: this.speed(),
        spacing: BELT.spacing,
        from: from.output,
        to: to.input,
        kind: link.kind as ItemKind,
        itemYaw: 0,
      });
      belt.build(instant);
      this.belts.set(key, { link, belt });
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = PLAN_EVERY;
      this.sync(false);
    }
    const v = this.speed();
    for (const { belt } of this.belts.values()) {
      belt.opts.speed = v;
      belt.update(dt);
    }
  }

  /** Belts standing now (tests, debug). */
  get count(): number {
    return this.belts.size;
  }

  /** Items riding the belts or flying onto them, by kind (the save puts them on the import dock). */
  carried(into: Partial<Record<ItemKind, number>>): void {
    for (const { link, belt } of this.belts.values()) {
      const k = link.kind as ItemKind;
      const n = belt.riding(k) + this.ctx.flights.inFlightTo(belt, k);
      if (n > 0) into[k] = (into[k] ?? 0) + n;
    }
  }

  /** Remove every belt (their loads go to the import dock). */
  dispose(): void {
    for (const { belt } of this.belts.values()) belt.dispose((item) => this.toDock(item));
    this.belts.clear();
    this.sig = '';
  }

  /** A belt's load goes onto the import dock; what a full dock refuses is sold at the depot quote. */
  private toDock(item: Item): void {
    if (this.region.dock.addImmediate(item)) return;
    this.ctx.economy.add(Math.round(this.ctx.market.quote(item.kind as never, 'sell')));
    this.ctx.items.release(item);
  }
}
