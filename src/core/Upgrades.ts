/**
 * [MAIN] Upgrade levels, their effects and purchases. The levels live in ctx.state.upgrades (0-based); the
 * tables live in config UPGRADES. Systems read effects live with value(id) every time they need them, so a
 * purchase (or a restored save) takes effect immediately without any event plumbing.
 *
 * Two ways to gain a level, both ending in levelUp() → 'upgrade:bought':
 * - buy(id): the shop panel (lumberjack + crew), open only while the player stands on a shop mat. Spends nextCost(id)
 *   at once, one level per press: upgrades are hands-on, nothing buys levels from afar or on its own.
 * - levelUp(id, position): a machine's level pad, after the pad collected nextCost(id) itself.
 *
 * Effects and prices come from core/ladder.ts: the authored tables up to their max, then the climb's curves. The
 * levels past the authored max can only be bought once the climb is open (the Great Lodge, eras/gate.ts), and only up
 * to the era cap: shown level 10 · age, so era 1 stops at 10 until the era-2 expansion is bought.
 */
import type * as THREE from 'three';
import { CLIMB, GATE, QUARTERS, UPGRADES, VILLAGE, type UpgradeDef, type UpgradeGroup } from '../config';
import { eraNoun, ERAS } from '../eras/data';
import { climbOpen } from '../eras/gate';
import { capStored, introEra, maxStored, shown, stepCost, valueAt } from './ladder';
import { settlementLevel } from './demand';
import type { Economy } from './Economy';
import { article } from '../ui/format';
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

  /**
   * The level every system reads. 0.9.5 'literal' gate: Lv 10 is the top of every upgrade, so a level an older save
   * owns above it (the 0.9.0–0.9.4 climb) is read as 10 for display and effect; the stored level is kept, never lost.
   */
  level(id: UpgradeId): number {
    const s = this.state.upgrades[id];
    return GATE.mode === 'literal' ? Math.min(s, CLIMB.bandSize) : s;
  }

  /**
   * Highest stored level for sale now: the authored max before the climb, then the era cap (shown 10 · age, ladder.ts
   * capStored). Nothing passes the cap until the next era's expansion is bought.
   */
  maxLevel(id: UpgradeId): number {
    return capStored(UPGRADES[id], climbOpen(this.state), this.state.eras.age);
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

  /** Gain one level that has already been paid for (level pads). Ignored at max level. */
  levelUp(id: UpgradeId, position: THREE.Vector3 | null): void {
    if (this.isMax(id)) return;
    this.state.upgrades[id] = this.level(id) + 1;
    this.state.stats.upgradesBought++;
    this.events.emit('upgrade:bought', { id, level: this.state.upgrades[id], position });
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
      case 'belt':
        return v <= 0 ? 'Not built' : `×${Math.round(v * 100) / 100} belt speed`;
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
    return `Needs the ${eraNoun(r.era)}`;
  }
  if (r.settlement !== undefined && settlementLevel(state) < r.settlement) {
    return `Reach Settlement ${r.settlement}`;
  }
  // 0.9.5: an era machine's level is bought on the level pad beside a built one
  const def = UPGRADES[id];
  // (the era cash machine `${key}Cash` is the exception: its pad builds it at Lv 1, eras/CashMachine.ts)
  if (def.group === 'machine' && def.era !== undefined && def.era >= 2 && id !== `${ERAS[def.era]?.key}Cash` && !machineBuilt(state, id)) {
    return `Build ${article(def.label)} ${def.label} first`;
  }
  return null;
}

/** 0.9.5: true when era machine `id` stands fully built on some slot of its region. */
export function machineBuilt(state: Pick<GameState, 'eras'>, id: UpgradeId): boolean {
  const era = UPGRADES[id].era;
  const slots = era !== undefined ? state.eras.regions[era]?.slots : undefined;
  return !!slots && slots.some((sl) => sl.machine === id && sl.tier >= 0);
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
