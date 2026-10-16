/**
 * [Wave 11] Foreman: the auto-builder. Picks the next construction that needs logs or cash, nearest first, among the
 * village plots (level.village.pad(i)), the town lots with a chosen building (level.town.pad(i)) and the crew
 * quarters (level.quarters.constructionPad()). NEVER the Great Lodge (the finale stays the player's press). Hauls logs
 * from the drop zone pile (or the pine deck when it is nearer) into the pad with move(), and pays cash in chunks with
 * ConstructionPad.payDirect() while the wallet keeps PRIORITIES.reserveShare / reserveMin. Home: FOREMAN_HOME.
 *
 * Selection (pickSite, pure): candidates are shown pads that still need logs (and logs exist somewhere) or cash (and
 * the wallet can pay a chunk); nearest first by straight-line distance, with a -3 m bonus for cash-only sites. A site
 * a peer foreman works is skipped. Re-picked only while standing still (a finished / hidden site is noticed on arrival).
 *
 * Routes are scripted waypoint lists (no colliders): every place is a path FROM HOME (a list of waypoints); a trip
 * between two places drops the shared prefix, walks the first path back and the second one forward.
 *   village plot  home -> gate (4.6, 10.4) -> street x 4.6 down to the pad's z -> sidestep onto the pad
 *   town lot      home -> gate -> street end (bending round the Great Lodge pad) -> corridor -> ENTRY -> planSquare (around props and other pads)
 *   quarters      home -> (4, 4) -> (7.4, -2) -> TO_RIDGE -> PINE_JUNCTION -> PINE_APPROACH -> pad
 *   drop pile     home -> (0.5, 7.5) -> DROP post;   pine deck: ridge route -> PINE_JUNCTION -> DECK post
 * Cash never sits in the foreman's hands (payDirect is instant); only logs are carried (Crew.carried('foreman','log')).
 */
import { LAYOUT, PRIORITIES, type XZ } from '../config';
import type { GameContext, ItemHolder } from '../core/types';
import { LOT_COUNT } from '../core/types';
import type { Level } from '../level/Level';
import type { ConstructionPad } from '../stations/ConstructionPad';
import { Helper, FOREMAN_HOME, FOREMAN_LOOK } from './crewHelpers';
import { CLEARANCE, ENTRY, planSquare } from './townRoutes';

// --- pure rules ------------------------------------------------------------------------------------
/** What the picker sees of a site. `logs` / `cash` mean "needs it AND it can be supplied right now". */
export interface SiteView {
  key: string;
  x: number;
  z: number;
  logs: boolean;
  cash: boolean;
}

/** Score bonus (metres) for a site that needs no hauling. */
export const CASH_ONLY_BONUS = 3;

/** The nearest workable site (cash-only sites count 3 m nearer); null when none needs anything. Ties keep the first. */
export function pickSite<T extends SiteView>(sites: readonly T[], from: XZ): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const s of sites) {
    if (!s.logs && !s.cash) continue;
    const score = Math.hypot(s.x - from.x, s.z - from.z) - (s.cash && !s.logs ? CASH_ONLY_BONUS : 0);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** Wallet the foreman may use: everything above max(reserveMin, reserveShare of the wallet). */
export function spendable(money: number): number {
  return Math.max(0, money - Math.max(PRIORITIES.reserveMin, PRIORITIES.reserveShare * money));
}

/** Smallest chunk worth paying (a nearly paid pad takes its last few dollars; otherwise no dribbles). */
const MIN_CHUNK = 25;

/** One payment: min(payChunk, cashLeft, spendable), whole dollars; 0 when that is below the smallest useful chunk. */
export function payAmount(cashLeft: number, money: number): number {
  const amount = Math.floor(Math.min(PRIORITIES.payChunk, cashLeft, spendable(money)));
  return amount >= 1 && amount >= Math.min(cashLeft, MIN_CHUNK) ? amount : 0;
}

// --- routes ------------------------------------------------------------------------------------------
const V = LAYOUT.village;
const T = LAYOUT.town;
const RIDGE = LAYOUT.ridge;
const STREET_X = (V.street.minX + V.street.maxX) / 2; // 4.6
/** Gate and the top of the street (mirrors townRoutes TRUNK's first point). */
const GATE: XZ = { x: STREET_X, z: 10.4 };
const STREET_TOP: XZ = { x: STREET_X, z: 12.0 };
/**
 * Street end -> corridor, bending around the Great Lodge pad (x 3.7-5.5, z 25.4-27.2) instead of crossing it like
 * townRoutes TRUNK: through the 0.55 m gap between it and the last east plot pad (z <= 24.85), then down the east
 * side (x 6.0 is 0.5 m off the lodge tile and inside the street walk x <= 6.25). The gap itself cannot give 0.4 m on
 * both sides, so the walk skims the plot pad's edge there.
 */
const LODGE_BYPASS: XZ[] = [{ x: STREET_X, z: 25.12 }, { x: 6.0, z: 25.12 }, { x: 6.0, z: 26.7 }];
/** Stand this far from a plot pad's centre toward the street (the tile is 1.3 m: still on it). */
const PLOT_STAND = 0.3;
/** The pad's sign floats over its centre and the camera looks from +Z: stand a little toward +Z so the foreman shows below it. */
const FRONT = 0.45;

// MIRRORS of the module-private ridge route constants in crewHelpers.ts (keep in sync): cabin door -> east-fence gate ->
// across the road -> onto the ridge, and the junction in front of the bunkhouse / deck.
const GATE_Z = (RIDGE.gate.minZ + RIDGE.gate.maxZ) / 2;
const CROSS = RIDGE.walk[0]!;
const CROSS_Z = (CROSS.minZ + CROSS.maxZ) / 2;
const TO_RIDGE: XZ[] = [
  { x: 8.6, z: -3.4 },
  { x: LAYOUT.yard.maxX - 0.8, z: GATE_Z },
  { x: CROSS.maxX - 0.2, z: CROSS_Z },
  { x: RIDGE.walk[1]!.minX + 1.4, z: CROSS_Z },
];
const PINE_JUNCTION: XZ = { x: 21.4, z: -1.2 };
const PINE_APPROACH: XZ = { x: 21.0, z: 3.0 };
const DECK_POST: XZ = { x: RIDGE.deck.x, z: RIDGE.deck.z + 1.4 };
const DECK_LOOK: XZ = { x: RIDGE.deck.x, z: RIDGE.deck.z };
/** Home -> the door side of the yard (reverse of crewHelpers FOREMAN_ROUTE) -> the ridge. */
const RIDGE_BASE: XZ[] = [{ x: 4.0, z: 4.0 }, { x: 7.4, z: -2.0 }, ...TO_RIDGE, PINE_JUNCTION];
const Q = RIDGE.quarters;
/** East of the bunkhouse pad (its tile spans x Q.pad.x +/- 0.9), clear of the workshop hopper zone. */
const Q_ENTER: XZ = { x: Q.pad.x + 2.0, z: Q.pad.z };
const Q_STAND: XZ = { x: Q.pad.x + 0.3, z: Q.pad.z + 0.7 };
const Q_LOOK: XZ = { x: Q.x, z: Q.z };

/** Drop zone pile post and what it faces (mirrors DROP_POST / DROP_LOOK in crewHelpers); the foreman stands 0.9 m off the log hauler. */
const DROP_POST: XZ = { x: -3.0, z: 1.4 };
const DROP_LOOK: XZ = { x: -5.2, z: -0.4 };
const DROP_STAND: XZ = (() => {
  const dx = DROP_LOOK.x - DROP_POST.x;
  const dz = DROP_LOOK.z - DROP_POST.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: DROP_POST.x + (dz / len) * 0.9, z: DROP_POST.z - (dx / len) * 0.9 };
})();

/** A place the foreman can stand: its waypoint path from home (last point = the stand). */
interface Place {
  path: XZ[];
}
const HOME_PLACE: Place = { path: [] };
const DROP_PLACE: Place = { path: [{ x: 0.5, z: 7.5 }, DROP_STAND] };
const DECK_PLACE: Place = { path: [...RIDGE_BASE, DECK_POST] };

const same = (a: XZ, b: XZ): boolean => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

/** Waypoints for a trip a -> b: a's tail walked back (without a's own stand), then b's tail, past the shared prefix. */
export function routeBetween(a: Place, b: Place): XZ[] {
  let k = 0;
  while (k < a.path.length && k < b.path.length && same(a.path[k]!, b.path[k]!)) k++;
  return [...a.path.slice(k, Math.max(k, a.path.length - 1)).reverse(), ...b.path.slice(k)];
}

// --- the foreman -------------------------------------------------------------------------------------
type Phase = 'idle' | 'toLoad' | 'load' | 'toSite' | 'work' | 'toHome' | 'toDump' | 'dump';

interface SiteRef extends SiteView {
  pad: ConstructionPad;
  stand: XZ;
  look: XZ;
  /** Path from home; the town ones plan around the square's props, so this is built only for the chosen site. */
  place: () => Place;
}

interface Source {
  holder: ItemHolder;
  place: Place;
  look: XZ;
  post: XZ;
}

/** Seconds with nothing to do at a site (no money / no logs) before the foreman gives it up for a while. */
const STALL_GIVE_UP = 6;
/** Seconds a given-up site is ignored. */
const COOLDOWN = 10;
/** Seconds a partly loaded foreman waits at an empty source before setting off anyway. */
const PATIENCE = 1.1;
const PICK_EVERY = 0.4;

export class Foreman extends Helper {
  private phase: Phase = 'idle';
  private current: SiteRef | null = null;
  private src: Source | null = null;
  private at: Place = HOME_PLACE;
  private pickTimer = 0;
  private idleFor = 0;
  private payTimer = 0;
  private stall = 0;
  private fx = 0;
  private readonly cooldown = new Map<string, number>();

  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'foreman', index, ['log']);
    this.pickTimer = 0.5 + index * 0.3;
  }

  /** Key of the site being worked (a peer foreman skips it), or null when not committed to one. */
  get site(): string | null {
    return this.current && this.phase !== 'idle' && this.phase !== 'toHome' ? this.current.key : null;
  }

  // --- candidates -----------------------------------------------------------------------------------
  private get deck(): ItemHolder | null {
    return this.level.treeFeller?.deck ?? null;
  }

  /** Logs the foreman could use right now: in the arms, on the drop pile or on the pine deck. */
  private logSupply(): number {
    return this.stack.count('log') + this.level.dropZone.pile.count('log') + (this.deck?.count('log') ?? 0);
  }

  private peerSites(): Set<string> {
    const out = new Set<string>();
    for (const o of this.peers) if (o !== this && o instanceof Foreman) {
      const s = o.site;
      if (s) out.add(s);
    }
    return out;
  }

  private makeRef(key: string, pad: ConstructionPad, stand: XZ, look: XZ, place: () => Place, supply: number, money: number): SiteRef {
    return {
      key,
      pad,
      stand,
      look,
      place,
      x: stand.x,
      z: stand.z,
      logs: pad.canAccept('log') && supply > 0,
      cash: pad.cashLeft > 0 && payAmount(pad.cashLeft, money) > 0,
    };
  }

  /** Every workable site right now (shown pads only; never the Great Lodge). */
  private sites(): SiteRef[] {
    const out: SiteRef[] = [];
    const supply = this.logSupply();
    const money = this.ctx.economy.money;
    const now = this.ctx.time.elapsed;
    const taken = this.peerSites();
    const add = (ref: SiteRef): void => {
      if (taken.has(ref.key) || (this.cooldown.get(ref.key) ?? 0) > now) return;
      if (ref.pad.logsLeft <= 0 && ref.pad.cashLeft <= 0) return;
      out.push(ref);
    };
    // village plots
    for (let i = 0; i < V.plots.length; i++) {
      const pad = this.level.village.pad(i);
      if (!pad || !pad.visible) continue;
      const p = pad.position;
      const dir = Math.sign(STREET_X - p.x) || 1;
      const stand: XZ = { x: p.x + dir * PLOT_STAND, z: p.z + FRONT };
      const path: XZ[] = [GATE, STREET_TOP, { x: STREET_X, z: p.z }, stand];
      add(this.makeRef(`plot:${i}`, pad, stand, { x: p.x - dir, z: p.z + FRONT }, () => ({ path }), supply, money));
    }
    // town lots with a chosen, unpaid building
    const lots = this.ctx.state.town.lots;
    for (let i = 0; i < LOT_COUNT; i++) {
      const st = lots[i];
      if (!st || st.building === '' || st.tier >= 0) continue;
      const pad = this.level.town.pad(i);
      if (!pad || !pad.visible) continue;
      const stand: XZ = { x: pad.position.x, z: pad.position.z + FRONT + 0.1 };
      const face = T.lots[i]!.face;
      const look: XZ = { x: stand.x - face.x * 2, z: stand.z - face.z * 2 };
      add(this.makeRef(`lot:${i}`, pad, stand, look, () => this.townPlace(i, stand), supply, money));
    }
    // crew quarters
    const qpad = this.level.quarters.constructionPad();
    if (qpad.visible) {
      const place: Place = { path: [...RIDGE_BASE, PINE_APPROACH, Q_ENTER, Q_STAND] };
      add(this.makeRef('quarters', qpad, Q_STAND, Q_LOOK, () => place, supply, money));
    }
    return out;
  }

  /** Home -> gate -> street -> corridor -> square, planned around the props and the other lots' pad tiles. */
  private townPlace(lot: number, stand: XZ): Place {
    const others: XZ[] = [];
    for (let j = 0; j < LOT_COUNT; j++) {
      if (j === lot) continue;
      const s = this.level.town.padSpot(j);
      if (s) others.push(s);
    }
    // pad tile half 0.8 + body clearance, so the walk keeps >= 0.4 m off every pad it is not working
    const reach = 0.8 + 0.4;
    const blocked = (x: number, z: number): boolean => {
      if (this.ctx.colliders.overlaps(x, z, CLEARANCE)) return true;
      for (const o of others) if (Math.abs(x - o.x) < reach && Math.abs(z - o.z) < reach) return true;
      return false;
    };
    const inside = planSquare(ENTRY, stand, blocked);
    return { path: [GATE, STREET_TOP, ...LODGE_BYPASS, ENTRY, ...inside] };
  }

  // --- sources --------------------------------------------------------------------------------------
  private pickSource(near: XZ): Source | null {
    const options: Source[] = [];
    const dz = this.level.dropZone.pile;
    if (dz.count('log') > 0) options.push({ holder: dz, place: DROP_PLACE, look: DROP_LOOK, post: DROP_POST });
    const deck = this.deck;
    if (deck && deck.count('log') > 0) options.push({ holder: deck, place: DECK_PLACE, look: DECK_LOOK, post: DECK_POST });
    let best: Source | null = null;
    let bestD = Infinity;
    for (const o of options) {
      const d = Math.hypot(o.post.x - near.x, o.post.z - near.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // --- movement helpers -----------------------------------------------------------------------------
  private walkTo(place: Place): void {
    const route = routeBetween(this.at, place);
    if (place === HOME_PLACE) route.push(FOREMAN_HOME);
    this.go(route);
    this.at = place;
  }

  // --- state machine --------------------------------------------------------------------------------
  protected think(dt: number): void {
    this.updateFx(dt);
    if (this.moving) return;
    switch (this.phase) {
      case 'idle':
        return this.thinkIdle(dt);
      case 'toLoad':
        this.look = this.src!.look;
        this.phase = 'load';
        this.idle = 0;
        return;
      case 'load':
        return this.thinkLoad(dt);
      case 'toSite':
        this.look = this.current!.look;
        this.phase = 'work';
        this.stall = 0;
        this.payTimer = 0.2;
        return;
      case 'work':
        return this.thinkWork(dt);
      case 'toHome':
        this.look = FOREMAN_LOOK;
        this.phase = 'idle';
        return;
      case 'toDump':
        this.look = DROP_LOOK;
        this.phase = 'dump';
        this.stall = 0;
        return;
      case 'dump':
        return this.thinkDump(dt);
    }
  }

  private resume(delay = 0): void {
    this.phase = 'idle';
    this.pickTimer = delay;
  }

  private thinkIdle(dt: number): void {
    if (this.at === HOME_PLACE) this.look = FOREMAN_LOOK;
    this.pickTimer -= dt;
    if (this.pickTimer > 0) return;
    this.pickTimer = PICK_EVERY;
    const choice = pickSite(this.sites(), this.group.position);
    if (!choice) {
      this.current = null;
      this.idleFor += PICK_EVERY;
      if (this.idleFor < 1.5) return;
      if (this.stack.count('log') > 0 && this.settled && this.level.dropZone.pile.canAccept('log')) {
        this.walkTo(DROP_PLACE);
        this.phase = 'toDump';
      } else if (this.at !== HOME_PLACE) {
        this.walkTo(HOME_PLACE);
        this.phase = 'toHome';
      }
      return;
    }
    this.idleFor = 0;
    this.current = choice;
    const needed = Math.min(this.capacity, choice.pad.logsLeft);
    // fetch logs first when the site wants them and the arms hold nothing
    if (choice.logs && this.stack.count('log') === 0 && needed > 0) {
      const src = this.pickSource(choice.stand);
      if (src) {
        this.src = src;
        this.walkTo(src.place);
        this.phase = 'toLoad';
        return;
      }
    }
    this.goToSite(choice);
  }

  private goToSite(site: SiteRef): void {
    this.current = site;
    this.walkTo(site.place());
    this.phase = 'toSite';
  }

  private thinkLoad(dt: number): void {
    const src = this.src!;
    const site = this.current;
    this.look = src.look;
    const want = site ? Math.min(this.capacity, Math.max(1, site.pad.logsLeft)) : this.capacity;
    if (this.stack.size < want && src.holder.count('log') > 0 && this.move(src.holder, this.stack, 'log')) return;
    this.idle += dt;
    if (!this.settled) return;
    const empty = src.holder.count('log') === 0;
    if (!(this.stack.size >= want || empty || this.idle > PATIENCE)) return;
    if (this.stack.count('log') === 0) return this.resume(1);
    // the site may have been finished by the player meanwhile: re-pick from here (the logs in the arms count as supply)
    if (!site || !site.pad.visible || (site.pad.logsLeft <= 0 && site.pad.cashLeft <= 0)) return this.resume(0);
    this.goToSite(site);
  }

  private thinkWork(dt: number): void {
    const site = this.current!;
    const pad = site.pad;
    if (!pad.visible || (pad.logsLeft <= 0 && pad.cashLeft <= 0)) return this.resume(0); // done (or hidden): next one
    let acted = false;
    // 1. logs from the arms
    if (this.stack.count('log') > 0 && pad.canAccept('log')) {
      if (this.move(this.stack, pad, 'log')) acted = true;
      else if (this.timer > 0) acted = true; // between two flights
    }
    // 2. cash from the wallet, in chunks
    this.payTimer -= dt;
    if (pad.cashLeft > 0 && this.payTimer <= 0) {
      const amount = payAmount(pad.cashLeft, this.ctx.economy.money);
      if (amount > 0 && this.ctx.economy.spend(amount)) {
        const credit = pad.payDirect(amount);
        if (credit < amount) this.ctx.economy.add(amount - credit); // the pad took less (cannot normally happen)
        this.payTimer = PRIORITIES.payInterval / this.stats.cadence;
        this.fx = 0.35;
        acted = true;
      } else {
        this.payTimer = 0.25; // the wallet is at its reserve: wait
      }
    }
    // 3. more logs wanted and the arms are empty: another trip (once the cash that can be paid now is paid)
    const payable = pad.cashLeft > 0 && payAmount(pad.cashLeft, this.ctx.economy.money) > 0;
    if (!payable && this.stack.size === 0 && pad.canAccept('log') && pad.logsLeft > 0) {
      const src = this.pickSource(site.stand);
      if (src) {
        this.src = src;
        this.walkTo(src.place);
        this.phase = 'toLoad';
        return;
      }
    }
    if (acted) {
      this.stall = 0;
      return;
    }
    this.stall += dt;
    if (this.stall > STALL_GIVE_UP && this.settled) {
      // nothing to pay with / nothing to haul: leave this site for a while
      this.cooldown.set(site.key, this.ctx.time.elapsed + COOLDOWN);
      this.resume(0);
    }
  }

  private thinkDump(dt: number): void {
    const pile = this.level.dropZone.pile;
    if (this.stack.count('log') > 0 && pile.canAccept('log') && this.move(this.stack, pile, 'log')) {
      this.stall = 0;
      return;
    }
    if (this.stack.size === 0) return this.resume(0);
    if (this.settled) {
      this.stall += dt;
      if (this.stall > 2) this.resume(2);
    }
  }

  /** A small hammering motion of the arms while paying (only with empty arms: carried logs sit in them). */
  private updateFx(dt: number): void {
    this.fx = Math.max(0, this.fx - dt);
    const rig = this.rig;
    if (this.fx > 0 && !this.moving && this.stack.size === 0) {
      const t = this.ctx.time.elapsed;
      rig.armRAngle = -0.9 + Math.sin(t * 16) * 0.45;
      rig.armLAngle = -0.6 + Math.sin(t * 16 + 1.6) * 0.3;
    } else {
      rig.armRAngle = null;
      rig.armLAngle = null;
    }
  }
}
