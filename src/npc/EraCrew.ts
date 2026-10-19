/**
 * Era workers of one unlocked region (npc/EraWorker.ts), 0.9.5: seven roles, like Survival's crews. The hauler
 * (`${key}Crew`: Quarrymen ... Robots, `ERA_CREW_COUNT[level]` workers) does every trip; the six others (config ERA_ROLES:
 * Feeder, Shipper, Porter, Gatherer, Foreman, Clerk, each `eraRoleCount(level)` workers) do one job each. Speed /
 * capacity scale with each role's own upgrade value (config ERA_WORKER base). One crew per unlocked region; Region calls
 * `reconcile()` when a crew upgrade is bought, and the crew also re-reads the levels twice a second, so a restored /
 * debug-set level needs no event. Every worker of the region shares one peer list, so no two of them chase the same
 * pile or overfill the same hopper, whatever their roles.
 * 0.9.11 (Dino: "the builders are not bringing materials"): while the region has a foreman, what its chosen buildings
 * (machine slots and the era district's lots) still need is HELD on the piles and the dock (`hold`): feeders, porters,
 * haulers and the belts only take the stock above it, so a busy processor no longer eats every stone or brick before
 * a builder can carry it to the site.
 */
import { ERA_CREW_COUNT, ERA_ROLES, eraRoleCount, type EraRole } from '../config';
import { ERA_KEYS } from '../core/kinds';
import type { EraCrewId, GameContext, ItemKind } from '../core/types';
import type { RegionRuntime } from '../eras/runtime';
import { EraWorker, materialNeeds, type Owed } from './EraWorker';
import { cityLotAccess, lotNeeds } from '../city/lotAccess';

/** Seconds between two automatic level checks. */
const RECONCILE_EVERY = 0.5;

interface RoleCrew {
  id: EraCrewId;
  role: EraRole;
  workers: EraWorker[];
}

export class EraCrew {
  private readonly roles: RoleCrew[];
  /** Every working worker of the region, all roles (the shared peer list). */
  private all: EraWorker[] = [];
  /** Dismissed workers still waiting for their last flights to land. */
  private readonly leaving: EraWorker[] = [];
  private timer = RECONCILE_EVERY;
  /** Units of each material the player still has to pay (held back from the depot by the workers). */
  private owed: ReadonlyMap<ItemKind, number> = new Map();
  /** Units per kind the foremen still have to carry to this era's sites and lots (empty without a foreman). */
  private held: Owed = new Map();
  /** Next worker number (idle posts, outfit variety). */
  private serial = 0;

  constructor(
    protected readonly ctx: GameContext,
    protected readonly region: RegionRuntime,
  ) {
    const key = ERA_KEYS[region.era - 2] ?? ERA_KEYS[0];
    this.roles = [{ id: `${key}Crew`, role: 'hauler', workers: [] }, ...ERA_ROLES.map((r) => ({ id: `${key}${r.key}` as EraCrewId, role: r.role, workers: [] }))];
    this.reconcile();
  }

  /** The crew upgrade ids of this region (hauler first). */
  get ids(): readonly EraCrewId[] {
    return this.roles.map((r) => r.id);
  }

  /** Workers a role's current level pays for. */
  private wanted(r: RoleCrew): number {
    const level = this.ctx.upgrades.level(r.id);
    if (r.role === 'hauler') return ERA_CREW_COUNT[Math.min(level, ERA_CREW_COUNT.length - 1)] ?? 0;
    return eraRoleCount(level);
  }

  /** Re-read the upgrade levels (hire / dismiss workers); called on 'upgrade:bought' and at start. */
  reconcile(): void {
    let changed = false;
    for (const r of this.roles) {
      const want = this.wanted(r);
      while (r.workers.length < want) {
        const w = new EraWorker(this.ctx, this.region, r.id, this.serial++, r.role);
        r.workers.push(w);
        w.arrive(this.region.layout.inside);
        this.ctx.tweens.popIn(w.group, { duration: 0.35 });
        changed = true;
      }
      while (r.workers.length > want) {
        const w = r.workers.pop()!;
        w.dispose();
        if (!w.disposed) this.leaving.push(w);
        changed = true;
      }
    }
    if (changed) this.all = this.roles.flatMap((r) => r.workers);
    this.owed = materialNeeds(this.ctx.state);
    this.held = this.buildNeeds();
    for (const w of this.all) {
      w.peers = this.all;
      w.owed = this.owed;
      w.held = this.held;
    }
  }

  /** Units of `kind` held on the piles for the builders (EraBelts leaves them on the producer's pile). */
  hold(kind: ItemKind): number {
    return this.held.get(kind) ?? 0;
  }

  /** What this era's chosen machine slots and district lots still need carried, by kind (none without a foreman). */
  private buildNeeds(): Map<ItemKind, number> {
    const out = new Map<ItemKind, number>();
    if (this.count('foreman') === 0) return out;
    const add = (kind: ItemKind, n: number): void => {
      if (n > 0) out.set(kind, (out.get(kind) ?? 0) + n);
    };
    for (const s of this.region.sites()) add(s.kind, s.room);
    if (cityLotAccess(this.ctx)) for (const l of lotNeeds(this.ctx.state, this.region.era)) add(l.kind, l.room);
    return out;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = RECONCILE_EVERY;
      this.reconcile();
    }
    for (const w of this.all) w.update(dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const w = this.leaving[i]!;
      w.update(dt);
      if (w.disposed) this.leaving.splice(i, 1);
    }
  }

  /** Working workers by role (tests, debug). */
  count(role?: EraRole): number {
    return role ? (this.roles.find((r) => r.role === role)?.workers.length ?? 0) : this.all.length;
  }

  /** Items in workers' hands right now, by kind (the save puts them back on the import dock). */
  carried(): Partial<Record<ItemKind, number>> {
    const out: Partial<Record<ItemKind, number>> = {};
    for (const w of [...this.all, ...this.leaving]) w.addCarried(out);
    return out;
  }

  /** Remove every worker now (their loads go back to the import dock). */
  dispose(): void {
    for (const w of [...this.all, ...this.leaving]) w.forceDispose();
    for (const r of this.roles) r.workers.length = 0;
    this.all = [];
    this.leaving.length = 0;
  }
}
