/**
 * [MAIN] Upgrade levels, their effects and purchases. The levels live in ctx.state.upgrades (0-based); the
 * tables live in config UPGRADES. Systems read effects live with value(id) every time they need them, so a
 * purchase (or a restored save) takes effect immediately without any event plumbing.
 *
 * Two ways to gain a level, both ending in levelUp() → 'upgrade:bought':
 * - buy(id): the shop panel (lumberjack + crew). Spends nextCost(id) at once.
 * - levelUp(id, position): a machine's level pad, after the pad collected nextCost(id) itself.
 */
import type * as THREE from 'three';
import { UPGRADES, VILLAGE, type UpgradeDef, type UpgradeGroup } from '../config';
import type { Economy } from './Economy';
import type { EventBus } from './EventBus';
import type { GameEvents, GameState, UpgradeId } from './types';

const IDS = Object.keys(UPGRADES) as UpgradeId[];

export class Upgrades {
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

  maxLevel(id: UpgradeId): number {
    return UPGRADES[id].values.length - 1;
  }

  isMax(id: UpgradeId): boolean {
    return this.level(id) >= this.maxLevel(id);
  }

  /** Current effect (see UpgradeDef.values). Crew not hired → 0. */
  value(id: UpgradeId): number {
    const v = UPGRADES[id].values;
    return v[Math.min(this.level(id), v.length - 1)]!;
  }

  /** Effect after the next purchase, or null at max level. */
  nextValue(id: UpgradeId): number | null {
    return this.isMax(id) ? null : UPGRADES[id].values[this.level(id) + 1]!;
  }

  /** Price of the next level, or null at max level. */
  nextCost(id: UpgradeId): number | null {
    return this.isMax(id) ? null : UPGRADES[id].costs[this.level(id)]!;
  }

  /** Crew: hired at all. */
  isHired(id: UpgradeId): boolean {
    return this.level(id) > 0;
  }

  /** Human-readable unmet requirement ("Needs Hamlet", "Build the Processor first"), or null when available. */
  requirement(id: UpgradeId): string | null {
    const r = UPGRADES[id].requires;
    if (!r) return null;
    if (r.unlocked && !this.state.unlocked[r.unlocked]) return `Build the ${unlockName(r.unlocked)} first`;
    if (r.villageLevel !== undefined && this.state.village.level < r.villageLevel) {
      return `Needs ${VILLAGE.levels[r.villageLevel]!.name}`;
    }
    return null;
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

  /** Gain one level that has already been paid for (level pads). Ignored at max level. */
  levelUp(id: UpgradeId, position: THREE.Vector3 | null): void {
    if (this.isMax(id)) return;
    this.state.upgrades[id]++;
    this.state.stats.upgradesBought++;
    this.events.emit('upgrade:bought', { id, level: this.state.upgrades[id], position });
  }

  /** Debug / tests: jump to a level silently (clamped). Systems pick it up on their next read. */
  setLevel(id: UpgradeId, level: number): void {
    this.state.upgrades[id] = Math.max(0, Math.min(this.maxLevel(id), Math.round(level)));
  }

  /** Short effect text for a level (default: current), e.g. "16 items", "7.4 m/s", "2.9 chops/s", "×1.3". */
  describe(id: UpgradeId, level = this.level(id)): string {
    const d = UPGRADES[id];
    const v = d.values[Math.min(level, d.values.length - 1)]!;
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
    }
  }
}

function unlockName(id: string): string {
  switch (id) {
    case 'harvester':
      return 'Harvester';
    case 'processor':
      return 'Processor';
    case 'megaSaw':
      return 'Mega Sawmill';
    default:
      return 'Conveyor';
  }
}
