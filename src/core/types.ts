/**
 * Shared contracts. Every module codes against these; do not change them without the main session.
 */
import type * as THREE from 'three';
import type { PadIdConst } from '../config';
import type { EventBus } from './EventBus';
import type { TweenManager } from './Tween';
import type { Economy } from './Economy';
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

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemKind = 'log' | 'crate' | 'cash';

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

export type Phase =
  | 'intro' // giant log floating in, input locked
  | 'manual' // phase 1: chop, carry, sell by hand
  | 'harvester' // phase 2: harvester bought
  | 'processor' // phase 3: processor + tricycles
  | 'automation' // phase 4: conveyors (one or both bought)
  | 'expansion'; // phase 5: mega sawmill + trucks

export interface GameStats {
  logsChopped: number;
  logsSold: number;
  cratesMade: number;
  cratesSold: number;
  moneyEarned: number;
  customersServed: number;
  tricyclesServed: number;
  trucksServed: number;
}

/** Written by Progression; read by anyone. */
export interface GameState {
  phase: Phase;
  unlocked: Record<PadId, boolean>;
  padsVisible: Record<PadId, boolean>;
  expanded: boolean;
  stats: GameStats;
}

export function createGameState(): GameState {
  const pads = (): Record<PadId, boolean> => ({
    harvester: false,
    processor: false,
    westConveyor: false,
    eastConveyor: false,
    megaSaw: false,
  });
  return {
    phase: 'intro',
    unlocked: pads(),
    padsVisible: pads(),
    expanded: false,
    stats: {
      logsChopped: 0,
      logsSold: 0,
      cratesMade: 0,
      cratesSold: 0,
      moneyEarned: 0,
      customersServed: 0,
      tricyclesServed: 0,
      trucksServed: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type Buyer = 'customer' | 'tricycle' | 'truck';
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
  sale: { buyer: Buyer; kind: ItemKind; count: number; amount: number; position: THREE.Vector3 };
  'pad:shown': { id: PadId; position: THREE.Vector3 };
  'pad:paid': { id: PadId; remaining: number; cost: number; position: THREE.Vector3 };
  'pad:unlocked': { id: PadId; position: THREE.Vector3 };
  /** Something new was constructed (pad effect). `object` (if given) is its root, for extra squash/pop effects. */
  built: { what: string; position: THREE.Vector3; object?: THREE.Object3D };
  'phase:changed': { phase: Phase };
  'intro:crash': { position: THREE.Vector3 };
  'intro:done': Record<string, never>;
  'expansion:start': Record<string, never>;
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
 *   scene/camera/renderer → events → tweens → state → economy → colliders → input → cameraRig →
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
  /** Simulation clock (seconds since start, advanced by fixed/variable steps). */
  readonly time: { elapsed: number; frame: number };
  /** Register something to be updated every step (after zones, before flights). */
  addUpdatable(u: Updatable): void;
  removeUpdatable(u: Updatable): void;
}
