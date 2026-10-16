/**
 * [MAIN] Runtime contracts between the era region world (eras/EraWorld.ts), its machines (eras/Machine.ts), the era
 * workers (npc/EraCrew.ts) and Jack's carts. Types only.
 */
import type { Item, ItemHolder, ItemKind } from '../core/types';
import type { Pile } from '../items/Pile';
import type { MachineDef } from './data';
import type { RegionLayout, XZ } from './layout';

/** A BUILT machine on a region slot. */
export interface MachineRuntime {
  readonly era: number;
  readonly slot: number;
  readonly def: MachineDef;
  /** Input hopper (accepts def.inputs kinds); null for extractors. */
  readonly input: Pile | null;
  /** Output pile (def.output only). */
  readonly output: Pile;
  /** Where a worker / the player stands to feed the input, and to take from the output (world XZ, clear of colliders). */
  readonly feedSpot: XZ;
  readonly takeSpot: XZ;
  /** How many more units of `kind` the input would take right now (0 if not an input, extractor, or full). */
  wants(kind: ItemKind): number;
  /** True while a cycle is running. */
  readonly working: boolean;
}

/**
 * 0.9.5: a machine slot the player has started paying for (its construction pad shows, some cash is in) that still
 * wants its extra material: era foremen carry that material in (never cash).
 */
export interface SiteRuntime {
  readonly slot: number;
  readonly kind: ItemKind;
  /** Units still to send (left minus those in flight). */
  readonly room: number;
  /** The construction pad (accepts `kind`). */
  readonly holder: ItemHolder;
  /** Where a worker stands to unload (beside the tile, clear of it). */
  readonly spot: XZ;
}

/** An UNLOCKED era region. */
export interface RegionRuntime {
  readonly era: number;
  readonly layout: RegionLayout;
  /** Index = slot; null while empty / under construction. Read live (machines appear and get demolished). */
  readonly machines: readonly (MachineRuntime | null)[];
  /** Export depot: every material that lands in it goes to the market counters, or is sold at once when that is full. */
  readonly depot: ItemHolder;
  readonly depotSpot: XZ;
  /** Import dock: market orders arrive here; workers take inputs from it; the player may drop materials into it. */
  readonly dock: Pile;
  readonly dockSpot: XZ;
  /** 0.9.5: construction sites wanting material right now (read live). */
  sites(): readonly SiteRuntime[];
  /**
   * 0.9.5 market: the depot hands what it receives to the loading dock (raw) or market stall (refined) while they have
   * room; buyer trucks take from the dock, walk-in shoppers from the stall, both pay into `cash`.
   * `forward` is the depot's hand-off (false when both counters are full).
   */
  readonly market: {
    readonly dockPile: Pile;
    readonly stallPile: Pile;
    /** The cash pile buyers pay into (`value` dollars, bundles in `pile`). */
    readonly cash: { readonly pile: Pile; readonly value: number };
    /** Era clerks: where they stand to collect the cash, and where they hand it in (at the depot). */
    readonly clerkSpot: XZ;
    readonly cashSpot: XZ;
    readonly bank: ItemHolder;
    forward(item: Item): boolean;
  };
}
