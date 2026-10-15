/**
 * [Wave 11] Sled Loader: carries chairs from the workshop bench (level.workshop.output) to the dog-sled counter
 * (level.sledCounter.pile) and, when the hopper is low (PRIORITIES.workshopLow), fetches logs for the workshop
 * hopper (level.workshop.input) from the pine deck (level.treeFeller.deck) or else the yard drop zone pile.
 * Home: SLED_LOADER_HOME in crewHelpers.ts.
 *
 * Jobs (pure choice in chooseJob): chairs first when >= CHAIR_BATCH chairs wait on the bench or the counter is empty
 * (and the counter has room); else firewood when the hopper holds fewer than PRIORITIES.workshopLow logs and a source
 * has some; else rest at home. A peer already on one job leaves it to the other helper (`job` getter).
 *
 * State machine (like LogHauler, plus the walk to the source): 'rest' -> 'toSource' -> 'load' -> 'go' -> 'unload' ->
 * 'return' -> 'rest'. 'load' sets off when full or after PATIENCE; 'unload' gives up after BLOCKED_GIVE_UP and walks
 * home with what is left (the next 'rest' delivers leftovers first). Always returns home between jobs.
 *
 * Work posts (clear of the bench zone rect(28.2,3.2,1.2,1.8) = x 27.6-28.8 z 2.3-4.1, the hopper zone x 21.3-22.5
 * z 2.3-4.1, the sled counter zone x 23.8-26.2 z 5.4-6.4, the platform cash zone x 29.4-31.4 z 2.7-4.5, the sled
 * cash zone x 20.6-22.6 z 5.1-6.9, the workshop body x 23.4-26.6 z 2.2-4.2 and the bunkhouse x <= 20.7); see
 * tests/sledLoader.test.ts for the margins. Sleds pass at z 7.9: every post stays north of z 7.4.
 */
import { LAYOUT, PRIORITIES, type XZ } from '../config';
import type { GameContext, ItemHolder } from '../core/types';
import type { Level } from '../level/Level';
import { Helper, SLED_LOADER_HOME, SLED_LOADER_LOOK } from './crewHelpers';

export type SledLoaderJob = 'chairs' | 'firewood';
type Phase = 'rest' | 'toSource' | 'load' | 'go' | 'unload' | 'return';
type Source = 'bench' | 'deck' | 'yard';
type Place = Source | 'counter' | 'hopper';

const PATIENCE = 1.1; // mirrors crewHelpers PATIENCE (seconds before a partly loaded helper sets off)
const BLOCKED_GIVE_UP = 3; // mirrors crewHelpers BLOCKED_GIVE_UP
/** Chairs waiting on the bench that justify a trip even while the counter still has stock. */
export const CHAIR_BATCH = 3;
const HOPPER_MAX = 15;

// --- posts (post + the point faced there) ----------------------------------------------------------------------
/** South of the bench zone (the east side is the platform cash zone, 0.6 m gap only). */
export const BENCH_POST: XZ = { x: 28.2, z: 4.8 };
export const BENCH_LOOK: XZ = { x: 27.3, z: 3.2 };
/** North of the sled counter's player zone, south of the workshop body. */
export const COUNTER_POST: XZ = { x: 25.0, z: 5.0 };
export const COUNTER_LOOK: XZ = { x: 25.0, z: 6.9 };
/** North of the hopper zone (the west side is the pine hauler's rest lane, the south side the sled cash zone). */
export const HOPPER_POST: XZ = { x: 21.9, z: 1.8 };
export const HOPPER_LOOK: XZ = { x: 21.9, z: 3.2 };
/** Pine deck post: mirrors crewHelpers DECK_POST / DECK_LOOK. */
const RIDGE = LAYOUT.ridge;
export const DECK_POST: XZ = { x: RIDGE.deck.x, z: RIDGE.deck.z + 1.4 };
const DECK_LOOK: XZ = { x: RIDGE.deck.x, z: RIDGE.deck.z };
/** East of the drop zone pile (collider x -6.25..-4.15), clear of the log hauler's post at (-3.0, 1.4). */
export const YARD_POST: XZ = { x: -3.2, z: -0.4 };
const YARD_LOOK: XZ = { x: LAYOUT.dropZone.x, z: LAYOUT.dropZone.z };

// --- routes (copied from crewHelpers; module-private there) -----------------------------------------------------
/** Mirrors crewHelpers PINE_JUNCTION. */
const PINE_JUNCTION: XZ = { x: 21.4, z: -1.2 };
/** Mirrors crewHelpers PAD_BYPASS (north of the workshop pad). */
const PAD_BYPASS: XZ = { x: 27.0, z: -1.2 };
/** Mirrors the tail of crewHelpers SLED_LOADER_ROUTE: the ridge corridor east of the bypass down to home. */
const EAST_LEG: XZ = { x: 29.6, z: 1.0 };
/** Mirrors crewHelpers TO_RIDGE (cabin door -> east gate -> crossing -> ridge), in walking order. */
const GATE_Z = (RIDGE.gate.minZ + RIDGE.gate.maxZ) / 2;
const CROSS = RIDGE.walk[0]!;
const CROSS_Z = (CROSS.minZ + CROSS.maxZ) / 2;
const TO_RIDGE: XZ[] = [
  { x: 8.6, z: -3.4 },
  { x: LAYOUT.yard.maxX - 0.8, z: GATE_Z },
  { x: CROSS.maxX - 0.2, z: CROSS_Z },
  { x: RIDGE.walk[1]!.minX + 1.4, z: CROSS_Z },
];
/** Mirrors the first legs of crewHelpers HOME_ROUTE.logHauler (cabin side -> drop zone). */
const YARD_LEG: XZ[] = [{ x: 4.8, z: -5.3 }, { x: -1.5, z: -4.6 }];

/** Waypoints from home to just before each source / destination (the post itself is appended, lane-shifted). */
export const ROUTES = {
  /** Home <-> bench and counter are direct (the posts lie south of the workshop). */
  bench: [] as XZ[],
  counter: [] as XZ[],
  /** Home -> north of the workshop -> PINE_JUNCTION. */
  north: [EAST_LEG, PAD_BYPASS, PINE_JUNCTION] as XZ[],
  /** PINE_JUNCTION -> yard (ridge corridor, east gate, back along the logs hauler's legs). */
  yardFromJunction: [...TO_RIDGE].reverse().concat(YARD_LEG) as XZ[],
};

export interface JobView {
  /** Chairs on the bench / on the sled counter / room left on the counter. */
  bench: number;
  counterCount: number;
  counterRoom: number;
  /** Logs in the hopper (in-flight ones included) and logs available at the pine deck / yard pile. */
  hopperCount: number;
  sourceLogs: number;
  /** Jobs a peer is already on. */
  peerJobs: readonly SledLoaderJob[];
}

/** Pure job choice: chairs first, then firewood, else null (rest). */
export function chooseJob(v: JobView): SledLoaderJob | null {
  if (!v.peerJobs.includes('chairs') && v.bench > 0 && v.counterRoom > 0 && (v.bench >= CHAIR_BATCH || v.counterCount === 0)) return 'chairs';
  if (!v.peerJobs.includes('firewood') && v.hopperCount < PRIORITIES.workshopLow && v.sourceLogs > 0) return 'firewood';
  return null;
}

export class SledLoader extends Helper {
  private phase: Phase = 'rest';
  private current: SledLoaderJob | null = null;
  private source: Source = 'bench';
  /** How many items this trip takes. */
  private want = 0;
  private pickTimer = 0;
  /** The place the helper stands at / walks to (for the look direction). */
  private at: Place = 'bench';

  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'sledLoader', index, ['furniture', 'log']);
    this.pickTimer = 0.5 + index * 0.3;
  }

  /** The job being worked (a peer takes the other one); null while resting or walking home. */
  get job(): SledLoaderJob | null {
    return this.phase === 'rest' || this.phase === 'return' ? null : this.current;
  }

  // --- world views ------------------------------------------------------------------------------------------
  private get bench(): ItemHolder | null {
    return this.level.workshop?.output ?? null;
  }
  private get counter(): ItemHolder | null {
    return this.level.sledCounter?.input ?? null;
  }
  private get hopper(): ItemHolder | null {
    return this.level.workshop?.input ?? null;
  }

  private hopperLogs(): number {
    const h = this.hopper;
    return h ? h.count('log') + this.ctx.flights.inFlightTo(h, 'log') : 0;
  }

  /** The pine deck when it holds logs, else the yard pile when it does. */
  private logSource(): Source | null {
    if ((this.level.treeFeller?.deck.count('log') ?? 0) > 0) return 'deck';
    if (this.level.dropZone.pile.count('log') > 0) return 'yard';
    return null;
  }

  private holder(s: Source): ItemHolder | null {
    switch (s) {
      case 'bench':
        return this.bench;
      case 'deck':
        return this.level.treeFeller?.deck ?? null;
      case 'yard':
        return this.level.dropZone.pile;
    }
  }

  private get kind(): 'furniture' | 'log' {
    return this.current === 'chairs' ? 'furniture' : 'log';
  }

  private get dest(): ItemHolder | null {
    return this.current === 'chairs' ? this.counter : this.hopper;
  }

  /** Chairs the sled counter still takes (landed + in flight counted). */
  private counterRoom(): number {
    const c = this.level.sledCounter?.pile;
    if (!c) return 0;
    const g = LAYOUT.ridge.sledCounter.grid;
    return Math.max(0, g.cols * g.rows * g.layers - c.total - this.ctx.flights.inFlightTo(c, 'furniture'));
  }

  // --- movement ----------------------------------------------------------------------------------------------
  private post(p: XZ, look: XZ): XZ {
    return this.lanePoint(p, look);
  }

  private homePoint(): XZ {
    return this.post(SLED_LOADER_HOME, SLED_LOADER_LOOK);
  }

  /** Legs between home and the source / destination posts (excluding the post). */
  private legTo(place: Place): XZ[] {
    switch (place) {
      case 'bench':
        return ROUTES.bench;
      case 'counter':
        return ROUTES.counter;
      case 'hopper':
      case 'deck':
        return ROUTES.north;
      case 'yard':
        return [...ROUTES.north, ...ROUTES.yardFromJunction];
    }
  }

  private postOf(place: Place): { p: XZ; look: XZ } {
    switch (place) {
      case 'bench':
        return { p: BENCH_POST, look: BENCH_LOOK };
      case 'counter':
        return { p: COUNTER_POST, look: COUNTER_LOOK };
      case 'hopper':
        return { p: HOPPER_POST, look: HOPPER_LOOK };
      case 'deck':
        return { p: DECK_POST, look: DECK_LOOK };
      case 'yard':
        return { p: YARD_POST, look: YARD_LOOK };
    }
  }

  private walkTo(place: Place): void {
    const { p, look } = this.postOf(place);
    this.go([...this.legTo(place), this.post(p, look)]);
  }

  /** Back to the home post along the legs of `place` (reversed). */
  private walkHome(place: Place): void {
    this.goReverse(this.legTo(place), this.homePoint());
    this.phase = 'return';
  }

  /** Where this trip's destination is. */
  private get destPlace(): 'counter' | 'hopper' {
    return this.current === 'chairs' ? 'counter' : 'hopper';
  }

  // --- thinking ----------------------------------------------------------------------------------------------
  protected think(dt: number): void {
    switch (this.phase) {
      case 'rest': {
        this.look = SLED_LOADER_LOOK;
        if (this.moving) return;
        this.pickTimer -= dt;
        if (this.pickTimer > 0 || !this.settled) return;
        this.pickTimer = 0.4;
        this.choose();
        return;
      }
      case 'toSource':
        if (this.moving) return;
        this.phase = 'load';
        this.idle = Math.min(this.idle, 0);
        return;
      case 'load': {
        this.look = this.postOf(this.at).look;
        if (this.moving) return;
        const src = this.holder(this.source);
        if (src && this.stack.size < this.want && src.count(this.kind) > 0 && this.move(src, this.stack, this.kind)) return;
        this.idle += dt;
        if (!this.settled) return;
        const has = this.stack.count(this.kind) > 0;
        if (has && (this.stack.size >= this.want || this.idle > PATIENCE)) {
          if (this.dest?.canAccept(this.kind)) this.depart();
        } else if (!has && this.stack.size === 0 && this.idle > PATIENCE) {
          this.walkHome(this.source);
        }
        return;
      }
      case 'go':
        if (this.moving) return;
        this.phase = 'unload';
        this.blocked = 0;
        return;
      case 'unload': {
        this.look = this.postOf(this.destPlace).look;
        if (this.moving) return;
        if (this.stack.size === 0) return this.walkHome(this.destPlace);
        const to = this.dest;
        if (to && this.stack.count(this.kind) > 0 && to.canAccept(this.kind)) {
          this.blocked = 0;
          this.move(this.stack, to, this.kind);
        } else if (this.settled) {
          this.blocked += dt;
          if (this.blocked > BLOCKED_GIVE_UP) {
            this.pickTimer = 2;
            this.walkHome(this.destPlace);
          }
        }
        return;
      }
      case 'return':
        if (this.moving) return;
        this.phase = 'rest';
        this.idle = 0;
        return;
    }
  }

  /** Walk from the source to the destination. Chairs go bench -> counter directly; logs come back via the north legs. */
  private depart(): void {
    if (this.current === 'chairs') {
      this.go([this.post(COUNTER_POST, COUNTER_LOOK)]);
    } else if (this.source === 'yard') {
      this.go([...[...ROUTES.yardFromJunction].reverse(), PINE_JUNCTION, this.post(HOPPER_POST, HOPPER_LOOK)]);
    } else {
      this.go([PINE_JUNCTION, this.post(HOPPER_POST, HOPPER_LOOK)]);
    }
    this.at = this.destPlace;
    this.phase = 'go';
  }

  private choose(): void {
    // leftovers in the arms (an unload gave up): deliver them before starting anything new
    if (this.stack.size > 0) {
      const chairs = this.stack.count('furniture') > 0;
      this.current = chairs ? 'chairs' : 'firewood';
      if (this.dest?.canAccept(this.kind)) {
        this.walkTo(this.destPlace);
        this.at = this.destPlace;
        this.phase = 'go';
      }
      return;
    }
    const bench = this.bench;
    const counter = this.counter;
    const source = this.logSource();
    const job = chooseJob({
      bench: bench?.count('furniture') ?? 0,
      counterCount: counter?.count('furniture') ?? 0,
      counterRoom: this.counterRoom(),
      hopperCount: this.hopper ? this.hopperLogs() : HOPPER_MAX,
      sourceLogs: source ? 1 : 0,
      peerJobs: this.peers.flatMap((o) => (o !== this && o instanceof SledLoader && o.job ? [o.job] : [])),
    });
    if (!job) return;
    this.current = job;
    if (job === 'chairs') {
      this.source = 'bench';
      this.want = Math.min(this.capacity, bench?.count('furniture') ?? 0, this.counterRoom());
    } else {
      this.source = source!;
      this.want = Math.min(this.capacity, HOPPER_MAX - this.hopperLogs());
    }
    if (this.want <= 0) {
      this.current = null;
      return;
    }
    this.walkTo(this.source);
    this.at = this.source;
    this.phase = 'toSource';
  }
}
