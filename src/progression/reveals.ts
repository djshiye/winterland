/**
 * [B7 — progression] The reveal timeline as DATA: when each new thing (pad, shop, village, level pad) appears.
 *
 * Every rule is a pure function of the game state (plus a few "seconds since" clocks that restart after a
 * reload), so nothing here is a private one-shot: a fired rule is remembered as `state.flags[rule.flag]` (default
 * `reveal:<id>`) and a restored game re-applies it silently. Tune the numbers in this table only.
 *
 * A rule fires when `ready(q)` has been true for `delay` seconds of simulation time and its flag is not yet set.
 * Progression applies the `action` (show the pad, reveal the village, ...) and plays the camera moment.
 */
import type { FlagId, GameState, PadId } from '../core/types';

/** What a rule can ask about the game. */
export interface RevealQuery {
  readonly state: GameState;
  /** Seconds since pad `id` was unlocked (live), or since this session started when it was restored unlocked. */
  sinceUnlock(id: PadId): number;
  /** Seconds since rule `ruleId` fired (live), or since this session started when it was restored as fired. */
  sinceReveal(ruleId: string): number;
  /** Cash piles that exist right now (walk-in, SE, truck, platform): derived from built stations, so restore-safe. */
  cashPiles(): number;
}

export type RevealAction =
  | { kind: 'pad'; id: PadId }
  | { kind: 'conveyors' }
  | { kind: 'levelPad'; id: PadId }
  | { kind: 'shop' }
  | { kind: 'village' };

export interface RevealRule {
  id: string;
  /** State flag that records the reveal (default `reveal:<id>`). */
  flag?: FlagId;
  /** Seconds `ready` must hold before the reveal fires. */
  delay: number;
  ready(q: RevealQuery): boolean;
  /** Already true by other means (debug unlocks, restored state): treat as revealed. */
  satisfied?(q: RevealQuery): boolean;
  action: RevealAction;
}

/** Pause between a unlock's camera moment and the next pad appearing. */
const NEXT_PAD = 3.4;

/** Truck sales before the truck loader is offered. */
const TRUCK_LOADS_FOR_LOADER = 3;
/** VILLAGE.levels index of "Town": opens the ridge even without the truck loader. */
const TOWN_LEVEL = 3;
/** Seconds after the ridge opens before the first ridge pad appears (the ridge camera moment lasts ~5 s). */
const RIDGE_INTRO = 6;
/** Extra seconds between the feller pad and the cash tubes pad. */
const TUBES_AFTER_FELLER = 12;

export const REVEALS: readonly RevealRule[] = [
  // Phase 1 → 2: the first customer sale shows the harvester pad.
  {
    id: 'harvesterPad',
    delay: 1.6,
    ready: (q) => !!q.state.flags.firstCustomerSale,
    satisfied: (q) => q.state.unlocked.harvester,
    action: { kind: 'pad', id: 'harvester' },
  },
  // The cabin shop opens a few seconds after the harvester.
  {
    id: 'shop',
    flag: 'shopRevealed',
    delay: 6,
    ready: (q) => q.state.unlocked.harvester,
    action: { kind: 'shop' },
  },
  // The village gate opens once there is money to build with (or a while after the shop).
  {
    id: 'village',
    delay: 1,
    ready: (q) => q.state.unlocked.harvester && !!q.state.flags.shopRevealed && (q.state.stats.moneyEarned >= 250 || q.sinceReveal('shop') >= 45),
    satisfied: (q) => q.state.village.revealed,
    action: { kind: 'village' },
  },
  { id: 'processorPad', delay: NEXT_PAD, ready: (q) => q.state.unlocked.harvester, satisfied: (q) => q.state.unlocked.processor, action: { kind: 'pad', id: 'processor' } },
  // Both belts: after the first tricycle sale, or 25 s after the processor.
  {
    id: 'conveyors',
    flag: 'conveyorsRevealed',
    delay: 0,
    ready: (q) => q.state.unlocked.processor && q.sinceUnlock('processor') >= (q.state.flags.firstTrikeSale ? NEXT_PAD : 25),
    satisfied: (q) => q.state.unlocked.westConveyor && q.state.unlocked.eastConveyor,
    action: { kind: 'conveyors' },
  },
  {
    id: 'megaSawPad',
    delay: NEXT_PAD,
    ready: (q) => q.state.unlocked.westConveyor && q.state.unlocked.eastConveyor,
    satisfied: (q) => q.state.unlocked.megaSaw,
    action: { kind: 'pad', id: 'megaSaw' },
  },
  // Level pads: the machine's own pad comes back as "LV n".
  // Wave 7 (after the mega saw), in the order the player meets them:
  //   truck loader (a few truck sales) -> Timber Ridge (loader bought, or Town) -> tree feller -> cash tubes.
  {
    id: 'truckLoaderPad',
    delay: NEXT_PAD,
    ready: (q) => q.state.unlocked.megaSaw && q.state.stats.trucksServed >= TRUCK_LOADS_FOR_LOADER,
    satisfied: (q) => q.state.unlocked.truckLoader,
    action: { kind: 'pad', id: 'truckLoader' },
  },
  {
    id: 'ridgePad',
    delay: NEXT_PAD,
    ready: (q) => q.state.unlocked.megaSaw && (q.state.unlocked.truckLoader || q.state.village.level >= TOWN_LEVEL),
    satisfied: (q) => q.state.unlocked.ridge,
    action: { kind: 'pad', id: 'ridge' },
  },
  // Wait out the ridge camera moment (gate pan + ridge pan) before the feller pad's own pan.
  {
    id: 'treeFellerPad',
    delay: 0,
    ready: (q) => q.state.unlocked.ridge && q.sinceUnlock('ridge') >= RIDGE_INTRO,
    satisfied: (q) => q.state.unlocked.treeFeller,
    action: { kind: 'pad', id: 'treeFeller' },
  },
  // Staggered behind the feller so two pads never pop in together.
  {
    id: 'cashTubesPad',
    delay: 0,
    ready: (q) => q.state.unlocked.ridge && q.cashPiles() >= 3 && q.sinceUnlock('ridge') >= RIDGE_INTRO + TUBES_AFTER_FELLER,
    satisfied: (q) => q.state.unlocked.cashTubes,
    action: { kind: 'pad', id: 'cashTubes' },
  },
  // Wave 8: the furniture workshop, once the feller has been cutting for a while.
  {
    id: 'workshopPad',
    delay: NEXT_PAD,
    ready: (q) => q.state.unlocked.treeFeller && q.sinceUnlock('treeFeller') >= 60,
    satisfied: (q) => q.state.unlocked.workshop,
    action: { kind: 'pad', id: 'workshop' },
  },
  { id: 'levelPad:workshop', delay: 0, ready: (q) => q.state.unlocked.workshop && q.sinceUnlock('workshop') >= 30, action: { kind: 'levelPad', id: 'workshop' } },
  { id: 'levelPad:harvester', delay: NEXT_PAD, ready: (q) => q.state.unlocked.harvester && q.state.unlocked.processor, action: { kind: 'levelPad', id: 'harvester' } },
  {
    id: 'levelPad:processor',
    delay: NEXT_PAD,
    ready: (q) => q.state.unlocked.processor && q.state.unlocked.westConveyor && q.state.unlocked.eastConveyor,
    action: { kind: 'levelPad', id: 'processor' },
  },
  { id: 'levelPad:megaSaw', delay: 0, ready: (q) => q.state.unlocked.megaSaw && q.sinceUnlock('megaSaw') >= 30, action: { kind: 'levelPad', id: 'megaSaw' } },
  { id: 'levelPad:treeFeller', delay: 0, ready: (q) => q.state.unlocked.treeFeller && q.sinceUnlock('treeFeller') >= 30, action: { kind: 'levelPad', id: 'treeFeller' } },
  { id: 'levelPad:cashTubes', delay: 0, ready: (q) => q.state.unlocked.cashTubes && q.sinceUnlock('cashTubes') >= 30, action: { kind: 'levelPad', id: 'cashTubes' } },
];
