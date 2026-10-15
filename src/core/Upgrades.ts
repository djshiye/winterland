/**
 * [MAIN] Upgrade levels, their effects and purchases. The levels live in ctx.state.upgrades (0-based); the
 * tables live in config UPGRADES. Systems read effects live with value(id) every time they need them, so a
 * purchase (or a restored save) takes effect immediately without any event plumbing.
 *
 * Two ways to gain a level, both ending in levelUp() → 'upgrade:bought':
 * - buy(id): the shop panel (lumberjack + crew). Spends nextCost(id) at once. The climb's presses build on it:
 *   buyMany (Buy ×10), raiseTo (Buy to the gate's level) and raiseAll (the GateCard: cheapest first above a reserve).
 * - levelUp(id, position): a machine's level pad, after the pad collected nextCost(id) itself.
 *
 * Effects and prices come from core/ladder.ts: the authored tables up to their max, then the climb's curves. The
 * levels past the authored max can only be bought once the climb is open (the Great Lodge, eras/gate.ts).
 */
import type * as THREE from 'three';
import { CLIMB, QUARTERS, UPGRADES, VILLAGE, type UpgradeDef, type UpgradeGroup } from '../config';
import { ERA_NAMES } from '../eras/data';
import { climbOpen } from '../eras/gate';
import { introEra, maxStored, shown, stepCost, valueAt } from './ladder';
import { settlementLevel } from './demand';
import type { Economy } from './Economy';
import type { EventBus } from './EventBus';
import type { GameEvents, GameState, UpgradeId } from './types';

const IDS = Object.keys(UPGRADES) as UpgradeId[];

export class Upgrades {
  /** Inside a multi-level press (buyMany k > 1, raiseAll): 'upgrade:bought' carries batch: true. */
  private batch = false;

  constructor(
    private readonly state: GameState,
    private readonly economy: Economy,
    private readonly events: EventBus<GameEvents>,
  ) {}

  /** Every upgrade id, in table order. */
  get ids(): readonly UpgradeId[] {
    return IDS;
  }

  def(id: UpgradeId): UpgradeDef {
    return UPGRADES[id];
  }

  /** Ids of one group, in table order. */
  group(group: UpgradeGroup): UpgradeId[] {
    return IDS.filter((id) => UPGRADES[id].group === group);
  }

  level(id: UpgradeId): number {
    return this.state.upgrades[id];
  }

  /** Highest stored level for sale now: the authored max, or shown level 100 once the climb is open. */
  maxLevel(id: UpgradeId): number {
    return maxStored(UPGRADES[id], climbOpen(this.state));
  }

  /** The level the player sees (stored + the id's era offset, docs/EXPANSION.md R4). */
  shownLevel(id: UpgradeId): number {
    return shown(UPGRADES[id], this.level(id));
  }

  isMax(id: UpgradeId): boolean {
    return this.level(id) >= this.maxLevel(id);
  }

  /** Current effect (see UpgradeDef.values). Crew not hired → 0. */
  value(id: UpgradeId): number {
    return valueAt(UPGRADES[id], this.level(id));
  }

  /** Effect after the next purchase, or null at max level. */
  nextValue(id: UpgradeId): number | null {
    return this.isMax(id) ? null : valueAt(UPGRADES[id], this.level(id) + 1);
  }

  /** Price of the next level, or null at max level. */
  nextCost(id: UpgradeId): number | null {
    return this.isMax(id) ? null : stepCost(UPGRADES[id], this.level(id));
  }

  /**
   * Crew work factors on the role's base stats (docs/EXPANSION.md §A1): walk ×walk, capacity ⌊base × capacity⌋,
   * cadence base ÷ cadence. Each clamps on its own, so a crew past its table speeds up without carrying meshes it
   * cannot draw; up to v = 2.8 all three equal today's linear reads (0.5 floor on walk and cadence as before).
   */
  crewStats(id: UpgradeId): { mult: number; walk: number; capacity: number; cadence: number } {
    const v = this.value(id);
    const c = CLIMB.crew;
    const capMax = introEra(UPGRADES[id]) === 1 ? c.capMaxSurvival : c.capMaxEra;
    return { mult: v, walk: Math.max(0.5, Math.min(v, c.walkMax)), capacity: Math.min(v, capMax), cadence: Math.max(0.5, Math.min(v, c.cadenceMax)) };
  }

  /** Crew: hired at all. */
  isHired(id: UpgradeId): boolean {
    return this.level(id) > 0;
  }

  /** Human-readable unmet requirement ("Needs Hamlet", "Build the Processor first"), or null when available. */
  requirement(id: UpgradeId): string | null {
    return upgradeRequirement(this.state, id);
  }

  /** Not maxed, requirement met, affordable. */
  canBuy(id: UpgradeId): boolean {
    const cost = this.nextCost(id);
    return cost !== null && this.requirement(id) === null && this.economy.canAfford(cost);
  }

  /** Shop purchase: spend the next cost and gain the level. Returns false (and changes nothing) if not possible. */
  buy(id: UpgradeId): boolean {
    if (!this.canBuy(id)) return false;
    if (!this.economy.spend(this.nextCost(id)!)) return false;
    this.levelUp(id, null);
    return true;
  }

  /** Buy up to `k` levels in a row (Buy ×10), stopping at the first one that cannot be bought. Returns the levels bought. */
  buyMany(id: UpgradeId, k: number): number {
    const was = this.batch;
    this.batch = was || k > 1;
    let n = 0;
    while (n < k && this.buy(id)) n++;
    this.batch = was;
    return n;
  }

  /** Buy levels until the shown level reaches `target` (Buy to target) or the money runs out. Returns the levels bought. */
  raiseTo(id: UpgradeId, target: number): number {
    return this.buyMany(id, Math.max(0, target - this.shownLevel(id)));
  }

  /**
   * Raise all (docs/EXPANSION.md §A2): buy the cheapest next level among `rows` (each up to its shown `need`) again and
   * again while the wallet stays above `reserve`. Rows with an unmet requirement are skipped. Returns the levels bought.
   */
  raiseAll(rows: ReadonlyArray<{ id: UpgradeId; need: number }>, reserve: number): number {
    const was = this.batch;
    this.batch = true;
    try {
      return this.raiseLoop(rows, reserve);
    } finally {
      this.batch = was;
    }
  }

  private raiseLoop(rows: ReadonlyArray<{ id: UpgradeId; need: number }>, reserve: number): number {
    let bought = 0;
    for (;;) {
      let best: UpgradeId | null = null;
      let bestCost = Infinity;
      for (const r of rows) {
        if (this.shownLevel(r.id) >= r.need || this.requirement(r.id) !== null) continue;
        const c = this.nextCost(r.id);
        if (c !== null && c < bestCost) {
          best = r.id;
          bestCost = c;
        }
      }
      if (best === null || this.economy.money - bestCost < reserve || !this.buy(best)) return bought;
      bought++;
    }
  }

  /** Gain one level that has already been paid for (level pads). Ignored at max level. */
  levelUp(id: UpgradeId, position: THREE.Vector3 | null): void {
    if (this.isMax(id)) return;
    this.state.upgrades[id]++;
    this.state.stats.upgradesBought++;
    this.events.emit('upgrade:bought', this.batch ? { id, level: this.state.upgrades[id], position, batch: true } : { id, level: this.state.upgrades[id], position });
  }

  /** Debug / tests: jump to a level silently (clamped to shown level 100, climb open or not). Systems pick it up on their next read. */
  setLevel(id: UpgradeId, level: number): void {
    this.state.upgrades[id] = Math.max(0, Math.min(maxStored(UPGRADES[id], true), Math.round(level)));
  }

  /** Short effect text for a level (default: current), e.g. "16 items", "7.4 m/s", "2.9 chops/s", "×1.3". */
  describe(id: UpgradeId, level = this.level(id)): string {
    const d = UPGRADES[id];
    const v = valueAt(d, level);
    switch (d.display) {
      case 'count':
        return `${v} ${d.unit ?? ''}`.trim();
      case 'speed':
        return `${v.toFixed(1)} m/s`;
      case 'rate':
        return `${((d.perCycle ?? 1) / v).toFixed(1)} ${d.unit ?? '/s'}`;
      case 'crew':
        return v <= 0 ? 'Not hired' : `×${Math.round(v * 100) / 100} speed`;
      case 'mult':
        return `×${Math.round(v * 100) / 100} price`;
      case 'boost':
        return `×${Math.round(v * 100) / 100} speed`;
      case 'income':
        return `×${Math.round(v * 100) / 100} income`;
      case 'factor':
        return `×${Math.round(v * 100) / 100}`;
      case 'share':
        return `${Math.round(v * 100)}% of value`;
    }
  }
}

/**
 * Pure form of Upgrades.requirement (the era gate's prereq rows read it without a GameContext): the first unmet
 * requirement of an upgrade as one line ("Needs Hamlet", "Build the Processor first"), or null when available.
 */
export function upgradeRequirement(state: Pick<GameState, 'unlocked' | 'village' | 'quarters' | 'eras'>, id: UpgradeId): string | null {
  const r = UPGRADES[id].requires;
  if (!r) return null;
  const needQuarters = r.quarters !== undefined && state.quarters.tier < r.quarters;
  if (r.unlocked && !state.unlocked[r.unlocked]) {
    return needQuarters
      ? `Needs the ${unlockName(r.unlocked)} and a ${QUARTERS.tiers[r.quarters!]!.label}`
      : `Build the ${unlockName(r.unlocked)} first`;
  }
  if (r.villageLevel !== undefined && state.village.level < r.villageLevel) {
    return `Needs ${VILLAGE.levels[r.villageLevel]!.name}`;
  }
  if (needQuarters) {
    return `Build the ${QUARTERS.tiers[r.quarters!]!.label} first`;
  }
  if (r.era !== undefined && state.eras.age < r.era) {
    return `Needs the ${ERA_NAMES[r.era] ?? 'next'} era`;
  }
  if (r.settlement !== undefined && settlementLevel(state) < r.settlement) {
    return `Reach Settlement ${r.settlement}`;
  }
  return null;
}

function unlockName(id: string): string {
  switch (id) {
    case 'harvester':
      return 'Harvester';
    case 'processor':
      return 'Processor';
    case 'megaSaw':
      return 'Mega Sawmill';
    case 'treeFeller':
      return 'Tree Feller';
    case 'cashTubes':
      return 'Cash Tubes';
    case 'ridge':
      return 'Timber Ridge gate';
    case 'truckLoader':
      return 'Truck Loader';
    case 'workshop':
      return 'Workshop';
    default:
      return 'Conveyor';
  }
}
