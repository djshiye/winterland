/**
 * [STUB — workers builder replaces the body, keeps the public API] 0.9.0 era workers of one unlocked region (Quarrymen
 * … Robots): `ERA_CREW_COUNT[level of ${key}Crew]` haulers that carry extractor output and import-dock goods to the
 * machines that want them, and finished goods (and surplus raw) to the export depot. Speed / capacity scale with the
 * `${key}Crew` upgrade value (config ERA_WORKER base). EraWorld creates one EraCrew per unlocked region.
 */
import type { GameContext, ItemKind } from '../core/types';
import type { RegionRuntime } from '../eras/runtime';

export class EraCrew {
  constructor(
    protected readonly ctx: GameContext,
    protected readonly region: RegionRuntime,
  ) {}

  /** Re-read the upgrade level (hire / dismiss workers); called by EraWorld on 'upgrade:bought' and at start. */
  reconcile(): void {}

  update(_dt: number): void {}

  /** Items in workers' hands right now, by kind (the save puts them back on the import dock). */
  carried(): Partial<Record<ItemKind, number>> {
    return {};
  }

  dispose(): void {}
}
