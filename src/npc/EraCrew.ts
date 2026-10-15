/**
 * 0.9.0 era workers of one unlocked region (Quarrymen ... Robots): `ERA_CREW_COUNT[level of ${key}Crew]` haulers
 * (npc/EraWorker.ts) that carry extractor output and import-dock goods to the machines that want them, and finished
 * goods (and surplus raw) to the export depot. Speed / capacity scale with the `${key}Crew` upgrade value (config
 * ERA_WORKER base). EraWorld creates one EraCrew per unlocked region and calls `reconcile()` when the upgrade is
 * bought; the crew also re-reads the level twice a second, so a restored / debug-set level needs no event.
 */
import { ERA_CREW_COUNT } from '../config';
import { ERA_KEYS } from '../core/kinds';
import type { EraUpgradeId, GameContext, ItemKind } from '../core/types';
import type { RegionRuntime } from '../eras/runtime';
import { EraWorker, materialNeeds } from './EraWorker';

/** Seconds between two automatic level checks. */
const RECONCILE_EVERY = 0.5;

export class EraCrew {
  private readonly upgradeId: EraUpgradeId;
  private readonly workers: EraWorker[] = [];
  /** Dismissed workers still waiting for their last flights to land. */
  private readonly leaving: EraWorker[] = [];
  private timer = RECONCILE_EVERY;
  /** Units of each material the player still has to pay (held back from the depot by the workers). */
  private owed: ReadonlyMap<ItemKind, number> = new Map();

  constructor(
    protected readonly ctx: GameContext,
    protected readonly region: RegionRuntime,
  ) {
    this.upgradeId = `${ERA_KEYS[region.era - 2] ?? ERA_KEYS[0]}Crew` as EraUpgradeId;
    this.reconcile();
  }

  /** Workers the current `${key}Crew` level pays for. */
  private wanted(): number {
    const level = this.ctx.upgrades.level(this.upgradeId);
    return ERA_CREW_COUNT[Math.min(level, ERA_CREW_COUNT.length - 1)] ?? 0;
  }

  /** Re-read the upgrade level (hire / dismiss workers); called by EraWorld on 'upgrade:bought' and at start. */
  reconcile(): void {
    const want = this.wanted();
    while (this.workers.length < want) {
      const w = new EraWorker(this.ctx, this.region, this.upgradeId, this.workers.length);
      this.workers.push(w);
      w.arrive(this.region.layout.inside);
      this.ctx.tweens.popIn(w.group, { duration: 0.35 });
    }
    while (this.workers.length > want) {
      const w = this.workers.pop()!;
      w.dispose();
      if (!w.disposed) this.leaving.push(w);
    }
    this.owed = materialNeeds(this.ctx.state);
    for (const w of this.workers) {
      w.peers = this.workers;
      w.owed = this.owed;
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = RECONCILE_EVERY;
      this.reconcile();
    }
    for (const w of this.workers) w.update(dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const w = this.leaving[i]!;
      w.update(dt);
      if (w.disposed) this.leaving.splice(i, 1);
    }
  }

  /** Items in workers' hands right now, by kind (the save puts them back on the import dock). */
  carried(): Partial<Record<ItemKind, number>> {
    const out: Partial<Record<ItemKind, number>> = {};
    for (const w of [...this.workers, ...this.leaving]) w.addCarried(out);
    return out;
  }

  /** Remove every worker now (their loads go back to the import dock). */
  dispose(): void {
    for (const w of [...this.workers, ...this.leaving]) w.forceDispose();
    this.workers.length = 0;
    this.leaving.length = 0;
  }
}
