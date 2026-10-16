/**
 * Shared contracts. Every module codes against these; do not change them without the main session.
 */
import type { OcclusionFade } from '../render/OcclusionFade';
import type * as THREE from 'three';
import type { AmenityId as AmenityIdConst, BusinessId as BusinessIdConst, EventKind, PadIdConst, TownPriority, UpgradeIdConst, WoodPriority } from '../config';
import type { EventBus } from './EventBus';
import type { TweenManager } from './Tween';
import type { Economy } from './Economy';
import type { DayNight } from './DayNight';
import type { RushHours } from './Rush';
import type { Quests } from './quests';
import type { WorldEvents } from './WorldEvents';
import type { Contracts } from './Contracts';
import type { Renderer } from '../render/Renderer';
import type { CameraRig } from '../render/CameraRig';
import type { Input } from '../input/Input';
import type { ColliderWorld } from '../world/Colliders';
import type { Environment } from '../world/Environment';
import type { Player } from '../entities/Player';
import type { ItemPool } from '../items/ItemPool';
import type { FlightSystem } from '../items/FlightSystem';
import type { ZoneSystem } from '../items/Zones';
import type { Particles } from '../fx/Particles';
import type { AudioFX } from '../fx/Audio';
import type { HUD } from '../ui/HUD';
import type { Upgrades } from './Upgrades';
import type { Market } from './Market';
import { MACHINE_IDS, type CityBuildingId, type InvestProductId, type MachineId } from '../eras/data';
import { ERA_KEYS, MATERIAL_KINDS, type MaterialKind } from './kinds';

export { MATERIAL_KINDS, type MaterialKind };

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** log: raw small log · plank: plank bundle (made from a log at the walk-in counter) · crate · cash. */
export type ItemKind = 'log' | 'plank' | 'crate' | 'cash' | 'furniture' | 'wheat' | 'bread' | 'meat' | 'sausage' | 'toy' | MaterialKind;
/** Every item kind, in a fixed order (pools, piles, zones and transfers iterate this; never keep a private copy). */
export const ALL_ITEM_KINDS: readonly ItemKind[] = ['log', 'plank', 'crate', 'cash', 'furniture', 'wheat', 'bread', 'meat', 'sausage', 'toy', ...MATERIAL_KINDS];
/** Wave 9: kinds the player's arms (and the save's arms record) may hold. 0.9.0: plus every era material. */
export const CARRY_KINDS = ['log', 'crate', 'furniture', 'wheat', 'meat', 'toy', ...MATERIAL_KINDS] as const;
export type CarryKind = (typeof CARRY_KINDS)[number];

/** A physical, visible item. Created/recycled only through ItemPool. */
export interface Item {
  readonly id: number;
  readonly kind: ItemKind;
  /** Root visual. Its parent changes as it moves between holders (scene root while flying). */
  readonly object: THREE.Object3D;
  /** Dollar value (cash bundles); 0 for goods. */
  value: number;
}

/**
 * Opaque landing reservation handed out by an ItemHolder. Holders may subclass/extend it
 * with private data; callers only ever pass it back to the same holder.
 */
export interface Slot {
  readonly holder: ItemHolder;
}

/**
 * Anything that can hold items: world piles, counters, hoppers, conveyor belts, the player's
 * arms/back, NPCs, upgrade pads (sinks).
 *
 * Transfer lifecycle (implemented once in items/transfer.ts — the ONLY code that moves items
 * between holders):
 *   1. if from.count(kind) > 0 && to.canAccept(kind)
 *   2. item = from.take(kind)          → item.object re-parented to the scene root, same world transform
 *   3. slot = to.reserve(item)         → destination counts it immediately (capacity is honest)
 *   4. ctx.flights.launch(item, to, slot)  → parabolic arc toward to.getSlotWorldPosition(slot) (re-evaluated
 *                                         every frame, so moving holders work)
 *   5. on arrival: to.receive(item, slot)  → holder re-parents and places the item
 */
export interface ItemHolder {
  /**
   * Stable id. Convention: 'player.arms', 'player.back', 'pad:<padId>', 'pile:<name>',
   * 'counter:<name>', 'conveyor:<name>', 'npc:<kind>:<n>'. To tell holders apart prefer identity
   * (holder === ctx.player.arms); the prefix is a fallback.
   */
  readonly id: string;
  /** True if one more item of `kind` fits right now (counting in-flight reservations). */
  canAccept(kind: ItemKind): boolean;
  /** Reserve a landing slot for `item`. Only call after canAccept(item.kind) returned true. */
  reserve(item: Item): Slot;
  /** Current world position the item in `slot` should fly toward / rest at. */
  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3;
  /** Current world orientation for the item in `slot`. */
  getSlotWorldQuaternion(slot: Slot, out: THREE.Quaternion): THREE.Quaternion;
  /** Flight finished: the item now belongs to this holder. */
  receive(item: Item, slot: Slot): void;
  /** Release a reservation that will never land. */
  cancel(slot: Slot): void;
  /** Landed items (optionally only of `kind`). Reservations are NOT counted. */
  count(kind?: ItemKind): number;
  /**
   * Remove and return the most recently stacked landed item (optionally only of `kind`), or null.
   * The returned item.object must be re-parented to the scene root keeping its world transform.
   */
  take(kind?: ItemKind): Item | null;
}

// ---------------------------------------------------------------------------
// Game state / progression
// ---------------------------------------------------------------------------

export type PadId = PadIdConst;
export type UpgradeId = UpgradeIdConst;

export type Phase =
  | 'intro' // giant log floating in, input locked
  | 'manual' // phase 1: chop, carry, sell by hand
  | 'harvester' // phase 2: harvester bought
  | 'processor' // phase 3: processor + tricycles
  | 'automation' // phase 4: conveyors (one or both bought)
  | 'expansion'; // phase 5: mega sawmill + trucks

export interface GameStats {
  logsChopped: number;
  /** Raw logs sold to trucks. */
  logsSold: number;
  /** Plank bundles sold to walk-in customers. */
  planksSold: number;
  cratesMade: number;
  cratesSold: number;
  moneyEarned: number;
  customersServed: number;
  tricyclesServed: number;
  trucksServed: number;
  /** Shelter tiers + the Great Lodge completed. */
  sheltersBuilt: number;
  /** Upgrade levels gained (shop, level pads, crew). */
  upgradesBought: number;
  /** Wave 8: chairs built in the workshop / sold to dog sleds. */
  furnitureMade: number;
  furnitureSold: number;
  /** Wave 9: town buildings completed / goods made by town producers + shops / goods sold to townsfolk. */
  townBuilt: number;
  goodsMade: number;
  goodsSold: number;
  /** 0.9.0 Ages: era materials made by machines / sold at export depots; machines and city buildings completed. */
  materialsMade: number;
  materialsSold: number;
  machinesBuilt: number;
  cityBuilt: number;
  /** Buildings / machines demolished (any kind). */
  demolished: number;
  /** Dollars from city rent + business income, Jack's swap cart, closed trades (profit only, may be < 0 → 0) and investments (gains). */
  cityEarned: number;
  jackEarned: number;
  tradeProfit: number;
  investEarned: number;
}

/**
 * One-shot progression flags. Fixed names, plus `reveal:<ruleId>` for Progression's reveal table and
 * `seen:<anything>` for UI hints shown once. Never keep one-shots in private fields: the save restores state only.
 */
export type FlagId =
  | 'introDone'
  | 'firstCustomerSale'
  | 'firstTrikeSale'
  | 'conveyorsRevealed'
  | 'shopRevealed'
  | 'shopVisited'
  | 'finale'
  | 'grandMarket'
  | `reveal:${string}`
  | `seen:${string}`;

export interface PlotState {
  /** Built tier: index into VILLAGE.tiers, −1 = empty lot. For the Great Lodge: −1 = not built, 0 = built. */
  tier: number;
  /** Logs and dollars already paid toward the NEXT tier (in-flight payments included). */
  logs: number;
  cash: number;
}

/**
 * Wave 9: one Market Town lot (LAYOUT.town.lots[i]). building '' = for sale (nothing chosen yet). A chosen building
 * is paid like a shelter: tier −1 while being paid (logs / cash = paid so far, in-flight included), 0 once built.
 * The choice can change only while nothing is paid (logs = cash = 0).
 */
export interface LotState {
  building: BusinessIdConst | '';
  tier: number;
  logs: number;
  cash: number;
}

export interface TownState {
  /** The corridor is open and lots can be built. */
  revealed: boolean;
  lots: LotState[];
  /** Wave 12: fixed amenity sites (tier -1 = not built, 0 = built), paid like the Great Lodge. */
  amenities: Record<AmenityIdConst, { tier: number; logs: number; cash: number }>;
  /** Wave 13: the Grand Market (Winterland era finale): logs + cash + toys. */
  grandMarket: { tier: number; logs: number; cash: number; toys: number };
}

/** Wave 13: the current delivery contract ('' kind = none). `left` counts down in play seconds. */
export interface ContractState {
  kind: ItemKind | '';
  target: number;
  progress: number;
  left: number;
  bonus: number;
}

/** Must match LAYOUT.town.lots.length. */
export const LOT_COUNT = 8;

// ---------------------------------------------------------------------------
// 0.9.0 Ages: eras, regions, machines, city districts, market
// ---------------------------------------------------------------------------

/** One machine slot in an era region. machine '' = empty; tier −1 = being paid (cash / extra paid so far), 0 = built. */
export interface SlotState {
  machine: MachineId | '';
  tier: number;
  cash: number;
  extra: number;
}

/** An era region (eras/data.ts REGIONS[n]). `cash` / `extra` = paid toward its expansion pad while locked. */
export interface RegionState {
  unlocked: boolean;
  cash: number;
  extra: number;
  slots: SlotState[];
}

export interface ErasState {
  /** Highest era reached: 1 = Survival … 10 = AI Era. */
  age: number;
  /** regions[n] for eras 2..10 (indices 0 and 1 are unused placeholders with no slots). */
  regions: RegionState[];
  /**
   * Best settlement level ever reached past Winterland (6..50; 0 = none yet). Recomputed after every city / machine
   * build, demolish, era and load as max(saved, level of the city population), so it never goes down
   * (core/demand.ts refreshSettlement; settlementLevel reads it once the village is Winterland).
   */
  settlement: number;
}

/** One city lot (a district of eras/data.ts DISTRICTS[n]); same payment shape as a machine slot. */
export interface CityLotState {
  building: CityBuildingId | '';
  tier: number;
  cash: number;
  extra: number;
}

export interface CityState {
  /** districts[n].lots for eras 2..10 (0 and 1 unused, no lots). A district opens with its era. */
  districts: { lots: CityLotState[] }[];
}

/** An open investment position (core/Market.ts). */
export interface InvestmentState {
  id: number;
  product: InvestProductId;
  /** Venture: the era it backs (2..10); 0 for bond / index. */
  era: number;
  /** Dollars deposited. */
  principal: number;
  /** Current value in dollars (bond: principal until it matures). */
  value: number;
  /** Seconds held. */
  age: number;
}

export interface MarketState {
  /** Price index per era material (missing = 1). Survival goods have no index (always 1). */
  index: Partial<Record<MaterialKind, number>>;
  /** Supply pressure per material (0..MARKET.pressureMax), lowers its export price; decays over time. */
  pressure: Partial<Record<MaterialKind, number>>;
  /** Trading: units held per material and their average buy price per unit. */
  holdings: Partial<Record<MaterialKind, number>>;
  basis: Partial<Record<MaterialKind, number>>;
  investments: InvestmentState[];
  /** Index fund level (1 at the start; the fund's positions scale with it). */
  fund: number;
  nextId: number;
}

/** Where money that is not a sale came from ('income' event). */
export type IncomeSource = 'rent' | 'business' | 'interest' | 'trade' | 'jack';

/** 'manage:open': the info / demolish card for something already built (ui/ManagePanel.ts renders it). */
export interface ManageRequest {
  /** Stable key of the thing ('town:3', 'slot:4:2', 'city:5:7'); the panel closes on 'manage:close' or when another opens. */
  key: string;
  title: string;
  subtitle?: string;
  /** Inline SVG string (ui/icons style), optional. */
  icon?: string;
  /** Rows shown on the card ("Makes", "2 stone → bricks"). */
  stats?: readonly { label: string; value: string }[];
  /** Price to demolish, or null when it cannot be demolished (the button is hidden). */
  demolishCost: number | null;
  /** Called after the player confirms; returns false (and nothing changes) if it could not be done (money, state). */
  onDemolish: () => boolean;
}

/** One option of a 'choose:open' card. */
export interface ChooseOption {
  id: string;
  label: string;
  blurb: string;
  icon?: string;
  /** Price line, e.g. "$27,000 + 12 Stone". */
  costText: string;
  /** Why it can't be chosen right now (shown greyed out); undefined = available. */
  locked?: string;
}

/** 'choose:open': pick what to build on an empty slot / lot (ui/ChoosePanel.ts renders it). */
export interface ChooseRequest {
  key: string;
  title: string;
  options: readonly ChooseOption[];
  /** Returns false if the choice was refused (nothing changes, the card stays). */
  onChoose: (id: string) => boolean;
}

export interface VillageState {
  /** The gate is open and the village can be built. */
  revealed: boolean;
  /** One entry per LAYOUT.village.plots. */
  plots: PlotState[];
  greatLodge: PlotState;
  /** Derived (core/demand.ts villagePopulation), cached for HUD / demand. */
  population: number;
  /** Derived index into VILLAGE.levels (5 = Winterland after the finale). Drives DEMAND. */
  level: number;
}

/**
 * The whole progress of a game: the save file is this object + money + pile contents. Systems initialise
 * themselves FROM it at construction (a restored game builds everything instantly, silently) and write it as
 * progress happens. Read by anyone.
 */
export interface GameState {
  phase: Phase;
  unlocked: Record<PadId, boolean>;
  padsVisible: Record<PadId, boolean>;
  expanded: boolean;
  stats: GameStats;
  /** Upgrade levels (0-based; crew level 0 = not hired). */
  upgrades: Record<UpgradeId, number>;
  village: VillageState;
  flags: Partial<Record<FlagId, boolean>>;
  /**
   * Dollars paid toward the CURRENT target of each upgrade pad, by holder id ('pad:harvester'): the unlock cost,
   * then each level cost. Includes value still in flight. Reset to 0 when a target completes.
   */
  padPaid: Record<string, number>;
  /** Simulation seconds played, across sessions. */
  playTime: number;
  /** Crew bunkhouse on Timber Ridge (wave 7): tier −1 = not built, plus progress toward the next tier. */
  quarters: PlotState;
  /** New Season prestige: survives a season reset (core/Save.ts newSeason). season 0 = the first run. */
  prestige: { season: number };
  /** Wave 8: seconds into the day/night cycle (core/DayNight.ts). */
  clock: number;
  /** Wave 8: quests completed (core/quests.ts ids → true). Rewards are paid on completion. */
  quests: Partial<Record<string, boolean>>;
  /** Wave 9: the Market Town. */
  town: TownState;
  /** Wave 11: what the crew favours when wood or deliveries are short (config PRIORITIES). */
  priorities: { wood: WoodPriority; town: TownPriority };
  /** Wave 13: the delivery contract on the notice board. */
  contract: ContractState;
  /** 0.9.0: the era ladder and its regions. */
  eras: ErasState;
  /** 0.9.0: city districts beyond the Market Town. */
  city: CityState;
  /** 0.9.0: market prices, trading holdings and investments. */
  market: MarketState;
  /**
   * 0.9.6: save migrations already applied to this game (core/Save.ts MIGRATIONS ids → true). A fresh game marks them
   * all at its first load, so each one runs at most once per save.
   */
  migrations: Partial<Record<string, boolean>>;
  /** 0.9.6: what a migrated older save keeps. masteryMult: the Mastery bonus frozen when levels past 10 were refunded (1 = none). */
  legacy: { masteryMult: number };
}

/** Must match LAYOUT.village.plots.length (kept literal so this file only imports types from config). */
export const PLOT_COUNT = 8;

export function createGameState(): GameState {
  const pads = (): Record<PadId, boolean> => ({
    harvester: false,
    processor: false,
    westConveyor: false,
    eastConveyor: false,
    megaSaw: false,
    ridge: false,
    treeFeller: false,
    truckLoader: false,
    cashTubes: false,
    workshop: false,
  });
  return {
    phase: 'intro',
    unlocked: pads(),
    padsVisible: pads(),
    expanded: false,
    stats: {
      logsChopped: 0,
      logsSold: 0,
      planksSold: 0,
      cratesMade: 0,
      cratesSold: 0,
      moneyEarned: 0,
      customersServed: 0,
      tricyclesServed: 0,
      trucksServed: 0,
      sheltersBuilt: 0,
      upgradesBought: 0,
      furnitureMade: 0,
      furnitureSold: 0,
      townBuilt: 0,
      goodsMade: 0,
      goodsSold: 0,
      materialsMade: 0,
      materialsSold: 0,
      machinesBuilt: 0,
      cityBuilt: 0,
      demolished: 0,
      cityEarned: 0,
      jackEarned: 0,
      tradeProfit: 0,
      investEarned: 0,
    },
    upgrades: {
      carry: 0,
      speed: 0,
      axe: 0,
      harvester: 0,
      processor: 0,
      megaSaw: 0,
      crateRunner: 0,
      cashier: 0,
      logHauler: 0,
      plankQuality: 0,
      crateQuality: 0,
      bulkDeals: 0,
      trikeDock: 0,
      truckDock: 0,
      shopDock: 0,
      sledDock: 0,
      railDock: 0,
      treeFeller: 0,
      cashTubes: 0,
      pineHauler: 0,
      pineContracts: 0,
      workshop: 0,
      furnitureQuality: 0,
      porter: 0,
      sledLoader: 0,
      foreman: 0,
      dog: 0,
      jack: 0,
      taxOffice: 0,
      broker: 0,
      ...eraUpgradeLevels(),
      ...eraPlayerLevels(),
      ...qualityLevels(),
    },
    village: {
      revealed: false,
      plots: Array.from({ length: PLOT_COUNT }, () => ({ tier: -1, logs: 0, cash: 0 })),
      greatLodge: { tier: -1, logs: 0, cash: 0 },
      population: 0,
      level: 0,
    },
    flags: {},
    padPaid: {},
    playTime: 0,
    quarters: { tier: -1, logs: 0, cash: 0 },
    prestige: { season: 0 },
    migrations: {},
    legacy: { masteryMult: 1 },
    clock: 24, // DAYNIGHT.startAt × cycleSeconds (literal: this file imports only types from config)
    quests: {},
    town: {
      revealed: false,
      lots: Array.from({ length: LOT_COUNT }, () => ({ building: '', tier: -1, logs: 0, cash: 0 })),
      amenities: {
        cafe: { tier: -1, logs: 0, cash: 0 },
        pond: { tier: -1, logs: 0, cash: 0 },
        bandstand: { tier: -1, logs: 0, cash: 0 },
        snowmanPark: { tier: -1, logs: 0, cash: 0 },
      },
      grandMarket: { tier: -1, logs: 0, cash: 0, toys: 0 },
    },
    priorities: { wood: 'balanced', town: 'balanced' },
    contract: { kind: '', target: 0, progress: 0, left: 0, bonus: 0 },
    eras: {
      age: 1,
      settlement: 0,
      regions: REGION_SLOTS.map((n) => ({ unlocked: false, cash: 0, extra: 0, slots: Array.from({ length: n }, () => ({ machine: '' as const, tier: -1, cash: 0, extra: 0 })) })),
    },
    city: {
      districts: DISTRICT_LOTS.map((n) => ({ lots: Array.from({ length: n }, () => ({ building: '' as const, tier: -1, cash: 0, extra: 0 })) })),
    },
    market: { index: {}, pressure: {}, holdings: {}, basis: {}, investments: [], fund: 1, nextId: 1 },
  };
}

/** Machine slots per region, index = era (must match eras/data.ts REGIONS[n].slots; tests/eras.test.ts checks). */
export const REGION_SLOTS: readonly number[] = [0, 0, 6, 6, 6, 6, 6, 6, 7, 7, 8];
/** Lots per city district, index = era (must match eras/data.ts DISTRICTS[n].lots). */
export const DISTRICT_LOTS: readonly number[] = [0, 0, 6, 6, 6, 8, 8, 8, 9, 9, 12];

/** 0.9.5: level 0 for every era player upgrade (`${key}Carry` / `Boots` / `Tool` / `Pal`, eras/playerUpgrades.ts). */
function eraPlayerLevels(): Record<`${(typeof ERA_KEYS)[number]}${'Carry' | 'Boots' | 'Tool' | 'Pal'}`, number> {
  const out = {} as Record<`${(typeof ERA_KEYS)[number]}${'Carry' | 'Boots' | 'Tool' | 'Pal'}`, number>;
  for (const k of ERA_KEYS) for (const p of ['Carry', 'Boots', 'Tool', 'Pal'] as const) out[`${k}${p}`] = 0;
  return out;
}

/** Era crew role suffixes (config ERA_ROLES; kept here as data so this file needs no runtime config import). */
const ERA_ROLE_SUFFIX = ['Feeder', 'Shipper', 'Porter', 'Gatherer', 'Foreman', 'Clerk'] as const;

/** Level 0 for every era upgrade (`${key}Rigs` / `Crew` / `Belts` / the six roles, and each era machine; 0.9.6: Trade merged into `${kind}Quality`). */
function eraUpgradeLevels(): Record<EraUpgradeId | MachineId, number> {
  const out = {} as Record<EraUpgradeId | MachineId, number>;
  for (const k of ERA_KEYS) {
    out[`${k}Rigs`] = 0;
    out[`${k}Crew`] = 0;
    out[`${k}Belts`] = 0;
    for (const r of ERA_ROLE_SUFFIX) out[`${k}${r}`] = 0;
    out[`${k}Dock`] = 0;
    out[`${k}Stall`] = 0;
    out[`${k}Cash`] = 0;
  }
  for (const m of MACHINE_IDS) out[m] = 0;
  return out;
}
/** 0.9.5: level 0 for every material's Quality upgrade (`${kind}Quality`). */
function qualityLevels(): Record<`${MaterialKind}Quality`, number> {
  const out = {} as Record<`${MaterialKind}Quality`, number>;
  for (const k of MATERIAL_KINDS) out[`${k}Quality`] = 0;
  return out;
}
export type EraUpgradeId = `${(typeof ERA_KEYS)[number]}${'Rigs' | 'Crew' | 'Belts' | 'Dock' | 'Stall' | 'Cash' | (typeof ERA_ROLE_SUFFIX)[number]}`;
/** An era crew upgrade: the hauler (`${key}Crew`) or one of the six roles. */
export type EraCrewId = `${(typeof ERA_KEYS)[number]}${'Crew' | (typeof ERA_ROLE_SUFFIX)[number]}`;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type Buyer = 'customer' | 'tricycle' | 'truck' | 'train' | 'sled' | 'townsfolk' | 'export' | 'jack' | 'trader';
export type LogSource = 'player' | 'harvester' | 'megaSaw';

/** Event name → payload. Emitted via ctx.events. Vectors in payloads are transient: copy if kept. */
export interface GameEvents {
  'money:changed': { money: number; delta: number };
  /** An item finished its flight into `holder`. */
  'item:landed': { item: Item; holder: ItemHolder; position: THREE.Vector3 };
  /** An item was taken from `from` and launched toward `to`. */
  'item:launched': { item: Item; from: ItemHolder | null; to: ItemHolder };
  /** A carried stack refused an item because it is full (fire at most ~2×/s per holder). */
  'stack:full': { holder: ItemHolder; position: THREE.Vector3 };
  /** Player's axe connected (emitted by Player at the impact frame of each swing). */
  /** `node`: the era whose hand node was struck (0.9.5, eras/HandNode.ts); absent = the giant log. */
  'player:chopHit': { position: THREE.Vector3; node?: number };
  /** A raw log piece was produced from the giant log. */
  'log:chopped': { position: THREE.Vector3; source: LogSource };
  /** A crate came out of the processor. */
  'crate:made': { position: THREE.Vector3 };
  /** An NPC finished buying and paid. */
  /** `tip` (wave 8): extra dollars a VIP paid on top of `amount` (already in the cash pile). */
  sale: { buyer: Buyer; kind: ItemKind; count: number; amount: number; position: THREE.Vector3; vip?: boolean; tip?: number };
  'pad:shown': { id: PadId; position: THREE.Vector3 };
  /** id: a Survival pad, or (0.9.5) the era machine whose level pad was paid. */
  'pad:paid': { id: PadId | UpgradeId; remaining: number; cost: number; position: THREE.Vector3 };
  'pad:unlocked': { id: PadId; position: THREE.Vector3 };
  /**
   * A pad the player stood on finished its target (juice only: fx/JuiceDirector.ts, fx/Haptics.ts). id is the holder id
   * ('pad:<id>'); kind 'unlock' / 'level' (UpgradePad) or 'build' (ConstructionPad). Emitted after the logic events.
   */
  'pad:complete': { id: string; kind: 'unlock' | 'level' | 'build'; position: THREE.Vector3 };
  /** Something new was constructed (pad effect). `object` (if given) is its root, for extra squash/pop effects. */
  built: { what: string; position: THREE.Vector3; object?: THREE.Object3D };
  'phase:changed': { phase: Phase };
  'intro:crash': { position: THREE.Vector3 };
  'intro:done': Record<string, never>;
  'expansion:start': Record<string, never>;

  // --- full game -------------------------------------------------------------
  /**
   * An upgrade level was gained (shop purchase, level pad fully paid, crew hire = level 0 → 1).
   * position: the pad / machine, or null for a shop purchase (effects go to the player).
   */
  'upgrade:bought': { id: UpgradeId; level: number; position: THREE.Vector3 | null };
  /** The player stepped onto / off the cabin doormat (the HUD opens / closes the shop panel). */
  /** Wave 10 (desktop comfort): keyboard shortcuts from Input, dispatched by Game. */
  'ui:escape': Record<string, never>;
  'ui:mute': Record<string, never>;
  'ui:fullscreen': Record<string, never>;
  /** Mouse wheel / pinch / +- keys: `delta` > 0 zooms in (about 0.1 per notch). */
  'camera:zoom': { delta: number };
  /** Settings → Display picked a frame cap (0 = uncapped); Game applies and persists it (core/fps.ts). */
  'settings:fps': { cap: 0 | 30 | 60 };
  /** Settings → Restore save: validated save text. Game stops autosaving, writes it and reloads. */
  'save:restore': { text: string };
  /** 0.9.6 Settings → Game → Earlier saves: restore the backup stored under `key` (core/saveVault.ts). */
  'save:restoreBackup': { key: string };
  /** The player stands in a gated zone (hold to interact is on) with something to take or pay; `on` false when they leave or hold. */
  'interact:prompt': { on: boolean; kind: 'take' | 'pay' };
  /** Settings → Game toggled hold-to-interact (Input re-reads it). */
  'settings:hold': { on: boolean };
  /** `tab` (0.9.0): open on that shop tab (an UpgradeGroup, e.g. 'industry' from a region's shop mat). */
  /** era: the era region whose shop mat opened it (2..10; absent = the cabin's doormat). */
  'shop:open': { tab?: string; era?: number };
  'shop:close': Record<string, never>;
  /** A construction pad received a log or a cash bundle. key: 'plot:<i>' | 'greatLodge'. */
  'construction:paid': { key: string; kind: 'log' | 'cash'; logsLeft: number; cashLeft: number; position: THREE.Vector3 };
  /** A shelter tier (plot ≥ 0, tier = VILLAGE.tiers index) or the Great Lodge (plot −1, tier 0) finished building. */
  'shelter:built': { plot: number; tier: number; position: THREE.Vector3; object: THREE.Object3D };
  /** The village gate opened. */
  'village:revealed': { position: THREE.Vector3 };
  /** Population or level changed (state.village already updated). */
  'village:changed': { population: number; level: number };
  /** A new village level was reached (after 'village:changed'). position: the village square. */
  'village:levelUp': { level: number; position: THREE.Vector3 };
  /** A crew member walked out of the cabin for the first time. */
  'helper:hired': { id: UpgradeId; position: THREE.Vector3 };
  /** Progression revealed something new that is not a pad ('shop', 'village', 'levelPad:harvester', 'greatLodge'…). */
  reveal: { what: string; position: THREE.Vector3 | null };
  /** The Great Lodge is complete: celebration, then the stats card. */
  'finale:start': { position: THREE.Vector3 };
  /** The welcome-back card's Collect was pressed (money already added). */
  'offline:collected': { amount: number };
  /** Settings → Reset progress → confirmed. Game wipes the save and reloads the page. */
  'game:reset': Record<string, never>;
  /** 0.9.6 Settings → Game → Save & quit (desktop app): Game writes the save, then closes the app. */
  'game:quit': Record<string, never>;
  // --- wave 7 ---
  /** The tree feller toppled pine `index` (its logs follow onto the deck). */
  'tree:felled': { index: number; position: THREE.Vector3 };
  /** A crew bunkhouse tier finished (state.quarters already updated). */
  'quarters:built': { tier: number; position: THREE.Vector3 };
  /** New Season confirmed (finale card / settings). Game writes the next season's fresh save and reloads. */
  'season:new': Record<string, never>;
  /** Wave 8: a quest's goal was met; its reward is already added to the money. */
  'quest:done': { id: string; title: string; reward: number };
  /** Wave 8: rush hour (core/Rush.ts) began / ended. */
  /** Wave 13: world events (core/WorldEvents.ts). */
  'event:start': { kind: EventKind; seconds: number };
  'event:end': { kind: EventKind };
  /** Wave 13: delivery contracts (core/Contracts.ts). */
  'contract:offered': { kind: ItemKind; count: number; seconds: number; bonus: number };
  'contract:done': { kind: ItemKind; bonus: number };
  'contract:failed': { kind: ItemKind };
  /** Wave 13: the Grand Market stands (town/Town.ts); the second finale. */
  'finale2:start': { position: THREE.Vector3 };
  'rush:start': { seconds: number };
  'rush:end': Record<string, never>;
  /** Wave 8: darkness crossed 0.5 (core/DayNight.ts). Not emitted while day/night is off. */
  /** Wave 12: an amenity finished (town/Town.ts); happiness changed. */
  'amenity:built': { id: AmenityIdConst; position: THREE.Vector3 };
  'night:start': Record<string, never>;
  'day:start': Record<string, never>;
  // --- wave 9 ---
  /** The town corridor opened (Progression's reveal moment). */
  'town:revealed': { position: THREE.Vector3 };
  /** The player stepped onto / off an empty lot's pad: the HUD opens / closes the build panel for `lot`. */
  'build:open': { lot: number };
  'build:close': Record<string, never>;
  /** A building was chosen for an empty lot (state.town.lots[lot].building already set). */
  'build:chosen': { lot: number; building: BusinessIdConst };
  /** A town building finished (state already updated). Village recomputes population / level on it. */
  'town:built': { lot: number; building: BusinessIdConst; position: THREE.Vector3; object: THREE.Object3D };
  /** A town producer / shop made one item. */
  'goods:made': { lot: number; kind: ItemKind; position: THREE.Vector3 };

  // --- 0.9.0 Ages ---
  /** Era n's expansion pad appeared at its region gate. */
  'expansion:offered': { era: number; position: THREE.Vector3 };
  /** Era n's expansion was paid: state.eras.age = n, its region and city district are open. */
  'era:unlocked': { era: number; position: THREE.Vector3 };
  /** A machine finished building on a region slot / was demolished (state already updated). */
  'machine:built': { era: number; slot: number; machine: MachineId; position: THREE.Vector3; object: THREE.Object3D };
  'machine:demolished': { era: number; slot: number; machine: MachineId; position: THREE.Vector3 };
  /** A machine cycle finished: `count` items of `kind` popped onto its out pile. */
  'material:made': { era: number; kind: ItemKind; count: number; position: THREE.Vector3 };
  /** A city building finished / was demolished (district = era n). */
  'city:built': { era: number; lot: number; building: CityBuildingId; position: THREE.Vector3; object: THREE.Object3D };
  'city:demolished': { era: number; lot: number; building: CityBuildingId; position: THREE.Vector3 };
  /** City population (whole settlement) or rank (eras/data.ts CITY_RANKS index) changed; rankUp after a new rank. */
  'city:changed': { population: number; rank: number };
  'city:rankUp': { rank: number; name: string; position: THREE.Vector3 | null };
  /** The settlement level (core/demand.ts settlementLevel) changed; emitted by City after a build, demolish or era. */
  'settlement:changed': { level: number; cityPopulation: number };
  /**
   * A settlement level ≥ 6 was reached (never while loading). `from` = the level before (several can be crossed at
   * once), `gift` = dollars paid into the city gift pile, `charter` = a band was completed (j = 5). position: the
   * district of the level's era.
   */
  'settlement:levelUp': { level: number; from: number; gift: number; charter: boolean; position: THREE.Vector3 };
  /**
   * The next era's gate moved (eras/GateTracker.ts, computed, nothing saved; never while loading): `ok` of `total` rows
   * at need, `gained` rows finished since the last one (a city build that also meets the settlement can finish several), `readyNow` = it just became ready.
   */
  'gate:progress': { era: number; ok: number; total: number; gained: number; settlement: number; settlementNeed: number; ready: boolean; readyNow: boolean };
  /** Open the era checklist (ui/GateCard.ts; the era chip). */
  'gate:open': Record<string, never>;
  /** A Market Town business was demolished (the lot is for sale again). */
  'town:demolished': { lot: number; building: BusinessIdConst; position: THREE.Vector3 };
  /** Money credited that is not a buyer's sale (already added to the wallet). */
  income: { source: IncomeSource; amount: number; position: THREE.Vector3 | null };
  /** Market panel (HUD button / exchange mat) and the map / fast-travel panel. */
  'market:open': Record<string, never>;
  'market:close': Record<string, never>;
  'map:open': Record<string, never>;
  'map:close': Record<string, never>;
  /** Info / demolish card and the build chooser for slots and city lots (ui/ManagePanel.ts, ui/ChoosePanel.ts). */
  'manage:open': ManageRequest;
  'manage:close': { key: string };
  'choose:open': ChooseRequest;
  'choose:close': { key: string };
  /** Fast travel: the map asks Level to move the player; Level answers with travel:done after the teleport. */
  'travel:request': { x: number; z: number; label: string };
  'travel:done': { x: number; z: number; label: string };
  /** The market bought `count` physical units for era n's import dock (`amount` dollars already spent); the region spawns them. */
  'market:order': { kind: MaterialKind; count: number; era: number; amount: number };
  /** A trade of virtual holdings closed (`amount` dollars moved; profit for sells, 0 for buys). */
  'market:trade': { kind: MaterialKind; units: number; side: 'buy' | 'sell'; amount: number; profit: number };
  /** Positions opened / closed / matured. */
  'invest:changed': Record<string, never>;
}

// ---------------------------------------------------------------------------
// Context (service locator handed to every system)
// ---------------------------------------------------------------------------

export interface Updatable {
  update(dt: number): void;
}

/**
 * Shared services. Built by game/Game.ts in this order (a constructor may only use services
 * listed before its own; use later ones lazily, e.g. inside update()):
 *   scene/camera/renderer → events → tweens → state → economy → upgrades → colliders → input → cameraRig →
 *   particles → audio → hud → items → flights → zones → environment → player → (JuiceDirector) → level
 */
export interface GameContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: Renderer;
  readonly events: EventBus<GameEvents>;
  readonly tweens: TweenManager;
  readonly state: GameState;
  readonly economy: Economy;
  /** Upgrade levels / values / purchases (reads and writes state.upgrades). */
  readonly upgrades: Upgrades;
  readonly colliders: ColliderWorld;
  readonly input: Input;
  readonly cameraRig: CameraRig;
  readonly particles: Particles;
  readonly audio: AudioFX;
  readonly hud: HUD;
  readonly items: ItemPool;
  readonly flights: FlightSystem;
  readonly zones: ZoneSystem;
  readonly environment: Environment;
  readonly player: Player;
  /** Wave 8: day/night clock (visual only). */
  readonly dayNight: DayNight;
  /** Wave 8: rush hours (customers / tricycles arrive faster). */
  readonly rush: RushHours;
  /** Wave 8: quests (short goals with cash rewards). */
  readonly quests: Quests;
  /** Wave 13: world events (snowstorm, festival, aurora). */
  readonly worldEvents: WorldEvents;
  /** Wave 13: delivery contracts. */
  readonly contracts: Contracts;
  /** 0.9.0: material prices, trading, investments (core/Market.ts). */
  readonly market: Market;
  /** 0.9.3: buildings between the camera and the player / a pad fade see-through (absent in stub test contexts). */
  readonly occlusion?: OcclusionFade;
  /** Simulation clock (seconds since start, advanced by fixed/variable steps). */
  readonly time: { elapsed: number; frame: number };
  /** Register something to be updated every step (after zones, before flights). */
  addUpdatable(u: Updatable): void;
  removeUpdatable(u: Updatable): void;
}
