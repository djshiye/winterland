/**
 * Shared contracts. Every module codes against these; do not change them without the main session.
 */
import type * as THREE from 'three';
import type { BusinessId as BusinessIdConst, PadIdConst, UpgradeIdConst } from '../config';
import type { EventBus } from './EventBus';
import type { TweenManager } from './Tween';
import type { Economy } from './Economy';
import type { DayNight } from './DayNight';
import type { RushHours } from './Rush';
import type { Quests } from './quests';
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

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** log: raw small log · plank: plank bundle (made from a log at the walk-in counter) · crate · cash. */
export type ItemKind = 'log' | 'plank' | 'crate' | 'cash' | 'furniture' | 'wheat' | 'bread' | 'meat' | 'sausage' | 'toy';
/** Wave 9: kinds the player's arms (and the save's arms record) may hold. */
export const CARRY_KINDS = ['log', 'crate', 'furniture', 'wheat', 'meat'] as const;
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
}

/** Must match LAYOUT.town.lots.length. */
export const LOT_COUNT = 8;

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
      treeFeller: 0,
      cashTubes: 0,
      pineHauler: 0,
      pineContracts: 0,
      workshop: 0,
      furnitureQuality: 0,
      porter: 0,
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
    clock: 24, // DAYNIGHT.startAt × cycleSeconds (literal: this file imports only types from config)
    quests: {},
    town: { revealed: false, lots: Array.from({ length: LOT_COUNT }, () => ({ building: '', tier: -1, logs: 0, cash: 0 })) },
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type Buyer = 'customer' | 'tricycle' | 'truck' | 'train' | 'sled' | 'townsfolk';
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
  'player:chopHit': { position: THREE.Vector3 };
  /** A raw log piece was produced from the giant log. */
  'log:chopped': { position: THREE.Vector3; source: LogSource };
  /** A crate came out of the processor. */
  'crate:made': { position: THREE.Vector3 };
  /** An NPC finished buying and paid. */
  /** `tip` (wave 8): extra dollars a VIP paid on top of `amount` (already in the cash pile). */
  sale: { buyer: Buyer; kind: ItemKind; count: number; amount: number; position: THREE.Vector3; vip?: boolean; tip?: number };
  'pad:shown': { id: PadId; position: THREE.Vector3 };
  'pad:paid': { id: PadId; remaining: number; cost: number; position: THREE.Vector3 };
  'pad:unlocked': { id: PadId; position: THREE.Vector3 };
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
  'shop:open': Record<string, never>;
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
  'rush:start': { seconds: number };
  'rush:end': Record<string, never>;
  /** Wave 8: darkness crossed 0.5 (core/DayNight.ts). Not emitted while day/night is off. */
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
  /** Simulation clock (seconds since start, advanced by fixed/variable steps). */
  readonly time: { elapsed: number; frame: number };
  /** Register something to be updated every step (after zones, before flights). */
  addUpdatable(u: Updatable): void;
  removeUpdatable(u: Updatable): void;
}
