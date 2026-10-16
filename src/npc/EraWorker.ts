/**
 * 0.9.0 era worker (one hauler of npc/EraCrew.ts) and its pure job logic.
 *
 * A worker repeats one trip at a time, picked greedily by `pickJob` (pure, tested in tests/eraCrew.test.ts):
 *   a) FEED: a processor wants an input kind that waits on a machine output pile or on the import dock -> carry up to
 *      the worker's capacity to that machine's feed spot and unload into machine.input;
 *   b) SHIP: otherwise finished goods (a processor output nobody in the region uses) -> export depot (it sells on arrival);
 *   c) SURPLUS: otherwise raw material nobody uses, or any output pile that is completely full -> export depot;
 *   d) idle in the front-yard band.
 * Peers never chase the same source pile or overfill the same hopper (`claim()`, like the porters). Machines are read
 * live: when the machine a trip was bound for is demolished the load goes to another processor that wants it, else to
 * the depot (or back to the dock when it came from there).
 *
 * Walking: no colliders, scripted waypoints. `planPath` routes along the aisles between the machine cells (cell
 * boundaries) and the front-yard band, so a worker never cuts through a machine.
 */
import * as THREE from 'three';
import { ERA_WORKER, PLAYER, type EraRole } from '../config';
import { approach, dampAngle, yawFromDir } from '../core/math';
import { MATERIAL_KINDS, type MaterialKind } from '../core/kinds';
import type { EraCrewId, GameContext, GameState, ItemHolder, ItemKind } from '../core/types';
import { CITY_BUILDINGS, ERAS, MACHINES } from '../eras/data';
import { expansionOffered } from '../eras/layout';
import { eraWorkerScale, createEraWorkerModel } from '../assets/eraWorkers';
import { CarryStack } from '../items/CarryStack';
import { transferOne } from '../items/transfer';
import type { MachineRuntime, RegionRuntime } from '../eras/runtime';
import type { RegionLayout, XZ } from '../eras/layout';
import { CharacterRig } from '../render/characters';

// --- tuning -------------------------------------------------------------------------------------------------------
const ACCEL = 12;
const TURN_LAMBDA = 12;
/** Base seconds between two item moves at work multiplier 1 (divided by the multiplier). */
const BASE_INTERVAL = 0.11;
/** Seconds a worker waits at a source that ran dry before leaving with a partial load. */
const PATIENCE = 1.1;
/** Seconds a worker waits at a full destination before looking for another one. */
const BLOCKED_GIVE_UP = 2.5;
/** Seconds between two job searches while idle. */
const PICK_EVERY = 0.4;
/** After this long without work every minimum load drops to 1 (so a lone item still ships). */
const LENIENT_AFTER = 3;
/** Minimum finished goods / surplus worth a trip (unless lenient). */
const MIN_SHIP = 3;
const FLY = { duration: 0.2, arcHeight: 1.4 } as const;

// --- pure job selection ---------------------------------------------------------------------------------------------
/** One built machine as the job picker sees it. */
export interface JobMachine {
  slot: number;
  extractor: boolean;
  /** Inputs of a processor: kind, units per cycle, how many more the hopper takes now, how many it holds. */
  inputs: readonly { kind: ItemKind; per: number; room: number; stock: number }[];
  output: ItemKind;
  /** Landed units on the output pile and whether the pile has no free slot left. */
  outCount: number;
  outFull: boolean;
  feed: XZ;
  take: XZ;
}

/** 0.9.5: a construction site wanting material (RegionRuntime.sites), as the job picker sees it. */
export interface JobSite {
  slot: number;
  kind: ItemKind;
  room: number;
  spot: XZ;
}

export interface JobView {
  machines: readonly JobMachine[];
  /** 0.9.5: construction sites wanting material (foremen). Absent = none. */
  sites?: readonly JobSite[];
  /** Landed units on the import dock by kind. */
  dock: Partial<Record<ItemKind, number>>;
  dockSpot: XZ;
  depotSpot: XZ;
  /** True when the export depot takes this kind. */
  depotAccepts: (kind: ItemKind) => boolean;
  /** True when the import dock has room for this kind. */
  dockAccepts: (kind: ItemKind) => boolean;
}

/** Where a load comes from: the import dock or a machine slot. */
export type JobSource = 'dock' | number;
/** Where it goes: the export depot, the import dock, a processor slot, or (0.9.5) a construction site on a slot. */
export type JobDest = 'depot' | 'dock' | number | `site${number}`;

/** 0.9.5: the construction-site destination of slot `slot`. */
export const siteDest = (slot: number): `site${number}` => `site${slot}`;
/** The slot of a construction-site destination, or null. */
export const siteSlot = (to: JobDest): number | null => (typeof to === 'string' && to.startsWith('site') ? Number(to.slice(4)) : null);

/**
 * 0.9.5: what a worker does (config ERA_ROLES): the hauler does everything (feed > ship > surplus, as in 0.9.0), the
 * others one job each: feeder feeds from machine piles, porter feeds from the dock, shipper ships, gatherer stocks raw
 * material on the dock from filling extractors (and feeds from them when nothing needs stocking), foreman builds,
 * clerk clears the fullest piles first.
 */
export type { EraRole };

/** Units of a raw material the gatherers keep on the import dock. */
export const DOCK_RESERVE = 12;
/** An extractor's output pile this full (of OUTPUT_CAPACITY) is worth a gatherer's trip. */
const GATHER_AT = 6;

export interface Job {
  type: 'feed' | 'ship' | 'surplus' | 'stock' | 'build';
  item: ItemKind;
  take: number;
  from: JobSource;
  to: JobDest;
}

/** What peers are already doing: units reserved at source piles (`srcId`) and promised to hoppers (`destId`). */
export interface Claims {
  sources: ReadonlyMap<string, number>;
  dests: ReadonlyMap<string, number>;
}

/** Units still owed per material kind (materialNeeds). */
export type Owed = ReadonlyMap<ItemKind, number>;
const NO_OWED: Owed = new Map();
export const NO_CLAIMS: Claims = { sources: new Map(), dests: new Map() };
export const srcId = (from: JobSource, kind: ItemKind): string => `${from === 'dock' ? 'dock' : `m${from}`}:${kind}`;
export const destId = (slot: number, kind: ItemKind, site = false): string => `${site ? 's' : 'm'}${slot}:${kind}`;

const dist = (a: XZ, b: XZ): number => Math.hypot(a.x - b.x, a.z - b.z);

const isMaterial = (kind: ItemKind): kind is MaterialKind => (MATERIAL_KINDS as readonly ItemKind[]).includes(kind);

/**
 * Units of each material the player still has to pay somewhere: the next expansion pad's extra, and the extra of every
 * machine slot / city lot that has been chosen (building set, tier < 0) but is not fully paid, summed per kind. Workers
 * hold that much of the kind back from the depot (pickJob); only the stock above it is shipped.
 */
export function materialNeeds(state: GameState): Map<MaterialKind, number> {
  const out = new Map<MaterialKind, number>();
  const owe = (kind: ItemKind, count: number, paid: number): void => {
    if (isMaterial(kind) && paid < count) out.set(kind, (out.get(kind) ?? 0) + count - paid);
  };
  const n = state.eras.age + 1;
  const next = ERAS[n];
  if (next && expansionOffered(state, n)) owe(next.unlock.extra.kind, next.unlock.extra.count, state.eras.regions[n]?.extra ?? 0);
  for (const region of state.eras.regions) {
    for (const slot of region.slots) {
      if (slot.machine === '' || slot.tier >= 0) continue;
      const x = MACHINES[slot.machine]?.extra;
      if (x) owe(x.kind, x.count, slot.extra);
    }
  }
  for (const district of state.city.districts) {
    for (const lot of district.lots) {
      if (lot.building === '' || lot.tier >= 0) continue;
      const x = CITY_BUILDINGS[lot.building]?.extra;
      if (x) owe(x.kind, x.count, lot.extra);
    }
  }
  return out;
}

/** The region's stock of `kind`: every machine output pile plus the import dock (landed units). */
export function stockOf(view: JobView, kind: ItemKind): number {
  let n = view.dock[kind] ?? 0;
  for (const m of view.machines) if (m.output === kind) n += m.outCount;
  return n;
}

/** True when some built processor of the region uses `kind` as an input. */
export function usedInRegion(machines: readonly JobMachine[], kind: ItemKind): boolean {
  return machines.some((m) => !m.extractor && m.inputs.some((i) => i.kind === kind));
}

interface Source {
  from: JobSource;
  kind: ItemKind;
  count: number;
  pos: XZ;
}

/**
 * The next trip for a worker standing at `at` with room for `capacity` items, or null. Strict order: feed > ship
 * finished goods > surplus; within a class the best score (load size, starving hoppers, short walks) wins.
 * `lenient`: accept loads of any size (a worker that has been idle for a while). `owed`: units the player still needs to pay
 * (materialNeeds): rules b / c ship a kind only from the region stock above its owed amount (feeding is unaffected).
 */
export function pickJob(view: JobView, capacity: number, claims: Claims, at: XZ, lenient = false, owed: Owed = NO_OWED, role: EraRole = 'hauler'): Job | null {
  const sources: Source[] = [];
  for (const m of view.machines) sources.push({ from: m.slot, kind: m.output, count: m.outCount, pos: m.take });
  for (const [kind, count] of Object.entries(view.dock) as [ItemKind, number][]) sources.push({ from: 'dock', kind, count, pos: view.dockSpot });
  const avail = (s: Source): number => s.count - (claims.sources.get(srcId(s.from, s.kind)) ?? 0);

  switch (role) {
    case 'feeder':
      return feedJob(view, sources, avail, capacity, claims, at, lenient, (s) => s.from !== 'dock');
    case 'porter':
      return feedJob(view, sources, avail, capacity, claims, at, lenient, (s) => s.from === 'dock');
    case 'shipper':
      return shipJob(view, avail, capacity, at, lenient, owed, 'ship') ?? shipJob(view, avail, capacity, at, lenient, owed, 'surplus');
    case 'clerk':
      return shipJob(view, avail, capacity, at, lenient, owed, 'surplus', true) ?? shipJob(view, avail, capacity, at, lenient, owed, 'ship', true);
    case 'gatherer': {
      const extractor = new Set(view.machines.filter((m) => m.extractor).map((m) => m.slot));
      return stockJob(view, avail, capacity, claims, at, lenient) ?? feedJob(view, sources, avail, capacity, claims, at, lenient, (s) => typeof s.from === 'number' && extractor.has(s.from));
    }
    case 'foreman':
      return buildJob(view, sources, avail, capacity, claims, at);
    case 'hauler':
      return (
        feedJob(view, sources, avail, capacity, claims, at, lenient, () => true) ??
        shipJob(view, avail, capacity, at, lenient, owed, 'ship') ??
        shipJob(view, avail, capacity, at, lenient, owed, 'surplus')
      );
  }
}

/** a) feed a processor from the sources `ok` allows. */
function feedJob(view: JobView, sources: readonly Source[], avail: (s: Source) => number, capacity: number, claims: Claims, at: XZ, lenient: boolean, ok: (s: Source) => boolean): Job | null {
  let best: Job | null = null;
  let bestScore = -Infinity;
  for (const p of view.machines) {
    if (p.extractor) continue;
    for (const inp of p.inputs) {
      const need = inp.room - (claims.dests.get(destId(p.slot, inp.kind)) ?? 0);
      if (need <= 0) continue;
      for (const s of sources) {
        if (s.kind !== inp.kind || s.from === p.slot || !ok(s)) continue;
        const have = avail(s);
        const take = Math.min(capacity, need, have);
        if (take < (lenient ? 1 : Math.min(capacity, need, inp.per))) continue;
        const score = take + (inp.stock === 0 ? 3 : 0) - 0.1 * (dist(at, s.pos) + dist(s.pos, p.feed));
        if (score > bestScore) {
          bestScore = score;
          best = { type: 'feed', item: inp.kind, take, from: s.from, to: p.slot };
        }
      }
    }
  }
  return best;
}

/**
 * b) finished goods ('ship'), c) surplus: machine outputs bound for the depot. `fullest`: the clerk's order (the
 * fullest pile first, walking barely matters).
 */
function shipJob(view: JobView, avail: (s: Source) => number, capacity: number, at: XZ, lenient: boolean, owed: Owed, type: 'ship' | 'surplus', fullest = false): Job | null {
  let pick: Job | null = null;
  let top = -Infinity;
  for (const m of view.machines) {
    if (!view.depotAccepts(m.output)) continue;
    const excess = Math.max(0, stockOf(view, m.output) - (owed.get(m.output) ?? 0));
    if (excess <= 0) continue;
    const used = usedInRegion(view.machines, m.output);
    const finished = !m.extractor && !used;
    // ship: finished goods; surplus: raw nobody uses, or any pile with no free slot left
    if (type === 'ship' ? !finished : finished || (used && !m.outFull)) continue;
    const s: Source = { from: m.slot, kind: m.output, count: m.outCount, pos: m.take };
    const take = Math.min(capacity, avail(s), excess);
    if (take < (lenient || m.outFull ? 1 : Math.min(capacity, MIN_SHIP))) continue;
    const walk = dist(at, m.take) + dist(m.take, view.depotSpot);
    const score = fullest ? m.outCount * 2 + (m.outFull ? 8 : 0) - 0.02 * walk : take + (m.outFull ? 4 : 0) - 0.1 * walk;
    if (score > top) {
      top = score;
      pick = { type, item: m.output, take, from: m.slot, to: 'depot' };
    }
  }
  return pick;
}

/**
 * 0.9.5 gatherer: raw material from an extractor whose pile is filling up (GATHER_AT, or full) to the import dock,
 * while the dock holds less than DOCK_RESERVE of it and some processor of the region uses it (the porters feed it on).
 */
function stockJob(view: JobView, avail: (s: Source) => number, capacity: number, claims: Claims, at: XZ, lenient: boolean): Job | null {
  let pick: Job | null = null;
  let top = -Infinity;
  for (const m of view.machines) {
    if (!m.extractor || !usedInRegion(view.machines, m.output) || !view.dockAccepts(m.output)) continue;
    if (m.outCount < (lenient ? 1 : GATHER_AT) && !m.outFull) continue;
    const onDock = (view.dock[m.output] ?? 0) + (claims.dests.get(`dock:${m.output}`) ?? 0);
    const room = DOCK_RESERVE - onDock;
    if (room <= 0) continue;
    const s: Source = { from: m.slot, kind: m.output, count: m.outCount, pos: m.take };
    const take = Math.min(capacity, avail(s), room);
    if (take < 1) continue;
    const score = take + (m.outFull ? 4 : 0) - 0.1 * (dist(at, m.take) + dist(m.take, view.dockSpot));
    if (score > top) {
      top = score;
      pick = { type: 'stock', item: m.output, take, from: m.slot, to: 'dock' };
    }
  }
  return pick;
}

/** 0.9.5 foreman: material for a construction site (any machine pile or the dock), nearest load first. */
function buildJob(view: JobView, sources: readonly Source[], avail: (s: Source) => number, capacity: number, claims: Claims, at: XZ): Job | null {
  let best: Job | null = null;
  let bestScore = -Infinity;
  for (const site of view.sites ?? []) {
    const need = site.room - (claims.dests.get(destId(site.slot, site.kind, true)) ?? 0);
    if (need <= 0) continue;
    for (const s of sources) {
      if (s.kind !== site.kind) continue;
      const take = Math.min(capacity, need, avail(s));
      if (take < 1) continue;
      const score = take - 0.1 * (dist(at, s.pos) + dist(s.pos, site.spot));
      if (score > bestScore) {
        bestScore = score;
        best = { type: 'build', item: site.kind, take, from: s.from, to: siteDest(site.slot) };
      }
    }
  }
  return best;
}

/** Where a load of `kind` should go when its planned destination is gone: another hungry processor, else depot / dock. */
export function fallbackDest(view: JobView, kind: ItemKind, claims: Claims, at: XZ, exclude: number | null, preferDock: boolean, owed: Owed = NO_OWED): JobDest | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const m of view.machines) {
    if (m.extractor || m.slot === exclude) continue;
    const inp = m.inputs.find((i) => i.kind === kind);
    if (!inp || inp.room - (claims.dests.get(destId(m.slot, kind)) ?? 0) <= 0) continue;
    const d = dist(at, m.feed);
    if (d < bestD) {
      bestD = d;
      best = m.slot;
    }
  }
  if (best !== null) return best;
  const owe = owed.get(kind) ?? 0;
  const held = owe > 0 && stockOf(view, kind) <= owe; // all of it is spoken for
  if ((preferDock || held) && view.dockAccepts(kind)) return 'dock';
  if (!held && view.depotAccepts(kind)) return 'depot';
  return view.dockAccepts(kind) ? 'dock' : null;
}

// --- routing --------------------------------------------------------------------------------------------------------
/**
 * Waypoints from `a` to `b` (both clear spots: machine feed / take spots, depot, dock, idle posts) that stay in the
 * aisles: step out to the aisle in front of the spot's row (the front-yard band for row 0), follow it, use a column
 * boundary corridor to change rows, and step in to `b`. `a` itself is not included, `b` is last.
 */
export function planPath(L: RegionLayout, a: XZ, b: XZ): XZ[] {
  const s0 = L.slots[0];
  if (!s0 || dist(a, b) < 0.05) return [b];
  const inward = L.inward;
  const cell = L.cell;
  const pitch = L.rowPitch; // 0.9.5: rows are rowPitch apart, columns `cell` wide
  const gridStart = s0.z - (inward * pitch) / 2;
  const rowOf = (p: XZ): number => Math.max(0, Math.floor(((p.z - gridStart) * inward) / pitch + 1e-6));
  const aisle = (r: number): number => (r === 0 ? gridStart - inward * 0.5 : gridStart + inward * r * pitch);
  const ra = rowOf(a);
  const rb = rowOf(b);
  const pts: XZ[] = [{ x: a.x, z: aisle(ra) }];
  if (ra === rb) {
    pts.push({ x: b.x, z: aisle(ra) });
  } else {
    // column boundaries of the (always full) first row; pick the one nearest the middle of the trip
    const cols = L.slots.filter((s) => Math.abs(s.z - s0.z) < 0.01).length;
    const mid = (a.x + b.x) / 2;
    const k = Math.min(cols, Math.max(0, Math.round((mid - (s0.x - cell / 2)) / cell)));
    const xc = s0.x - cell / 2 + k * cell;
    pts.push({ x: xc, z: aisle(ra) }, { x: xc, z: aisle(rb) }, { x: b.x, z: aisle(rb) });
  }
  pts.push(b);
  const out: XZ[] = [];
  let prev = a;
  for (const p of pts) {
    if (dist(prev, p) < 0.05) continue;
    out.push(p);
    prev = p;
  }
  if (out.length === 0) out.push(b);
  return out;
}

/** Spacing of the idle posts along the yard's inner edge (metres), and the gap kept clear around the gate's way in. */
const IDLE_STEP = 1.9;
const IDLE_GATE_GAP = 2.2;

/**
 * The idle post of worker `index`: a line along the yard's inner edge (between the yard's facilities and the first
 * machine row's belt lane), nearest the gate first but never on the way in, a second line just behind it when the
 * first is full. A full seven-role crew (up to 21) waits spread out like workers by their stations, not in a crowd.
 */
export function idleSpot(L: RegionLayout, index: number): XZ {
  const y = L.zones.yard;
  const innerZ = L.inward > 0 ? y.maxZ : y.minZ;
  const xs: number[] = [];
  for (let x = y.minX + 2; x <= y.maxX - 2 + 1e-9; x += IDLE_STEP) if (Math.abs(x - L.gate.x) >= IDLE_GATE_GAP) xs.push(x);
  xs.sort((a, b) => Math.abs(a - L.gate.x) - Math.abs(b - L.gate.x) || a - b);
  const per = Math.max(1, xs.length);
  const line = Math.floor(index / per) % 2;
  const x = xs[index % per]!;
  // the second line sits staggered, half a step further from the gate (and still inside the yard)
  const shift = line * (IDLE_STEP / 2) * (x >= L.gate.x ? 1 : -1);
  return { x: Math.min(y.maxX - 1, Math.max(y.minX + 1, x + shift)), z: innerZ - L.inward * (0.6 + line * 0.9) };
}

// --- the worker -----------------------------------------------------------------------------------------------------
type Phase = 'idle' | 'toSource' | 'load' | 'toDest' | 'unload' | 'toHome';

interface Ref {
  machine: MachineRuntime | null;
  holder: ItemHolder | null;
  spot: XZ;
  look: XZ | null;
}

/** What a peer worker must not chase (see EraWorker.claim). */
export interface WorkerClaim {
  src: string | null;
  dest: string | null;
  amount: number;
}

export class EraWorker {
  readonly group = new THREE.Group();
  readonly rig: CharacterRig;
  readonly stack: CarryStack;
  /** The crew's workers (the same array for all of them, includes this one). Set by EraCrew. */
  peers: readonly EraWorker[] = [];
  private readonly velocity = new THREE.Vector3();
  private yaw = 0;
  private speed = 0;
  private route: XZ[] = [];
  private routeIdx = 0;
  private look: XZ | null = null;
  private timer = 0;
  private idle = 0;
  private blocked = 0;
  private pickTimer: number;
  private idleFor = 0;
  private capacityNow = -1;
  private phase: Phase = 'idle';
  private job: Job | null = null;
  private src: Ref | null = null;
  private dest: (Ref & { slot: number | null }) | null = null;
  /** Where the worker stands (or is walking to): paths start here. */
  private at: XZ;
  private disposing = false;
  private gone = false;
  private readonly home: XZ;
  /** Units still owed per material, held back from the depot (EraCrew keeps it current). */
  owed: Owed = NO_OWED;

  constructor(
    readonly ctx: GameContext,
    readonly region: RegionRuntime,
    private readonly upgradeId: EraCrewId,
    readonly index: number,
    /** 0.9.5: which trips this worker takes (config ERA_ROLES; the hauler does everything). */
    readonly role: EraRole = 'hauler',
  ) {
    this.rig = new CharacterRig(createEraWorkerModel(region.era, index, role), { scale: eraWorkerScale(region.era, index) });
    this.group.add(this.rig.root);
    this.group.name = `era${region.era}:worker:${index}`;
    this.stack = new CarryStack(ctx, {
      id: `npc:era${region.era}:worker:${index}`,
      accepts: [...MATERIAL_KINDS],
      capacity: 1,
      anchor: this.rig.armsAnchor,
      columnSize: 6,
    });
    this.home = idleSpot(region.layout, index);
    this.at = this.home;
    this.pickTimer = 0.5 + index * 0.3;
    this.applyLevel();
    ctx.scene.add(this.group);
  }

  /** Work multiplier (0 = not hired). */
  get mult(): number {
    return this.ctx.upgrades.value(this.upgradeId);
  }

  /** Walk / capacity / cadence factors, each clamped past the authored table (Upgrades.crewStats). */
  private get stats(): { walk: number; capacity: number; cadence: number } {
    return this.ctx.upgrades.crewStats(this.upgradeId);
  }

  get capacity(): number {
    return Math.max(1, Math.floor(ERA_WORKER.capacity * this.stats.capacity));
  }

  private get interval(): number {
    return BASE_INTERVAL / this.stats.cadence;
  }

  get moving(): boolean {
    return this.routeIdx < this.route.length;
  }

  /** Nothing in flight in the hands: size counts reservations, count() only landed items. */
  private get settled(): boolean {
    return this.stack.size === this.stack.count();
  }

  /** Put the worker at `p` (instant), facing `look`. */
  placeAt(p: XZ, look: XZ | null): void {
    this.group.position.set(p.x, 0, p.z);
    this.at = { x: p.x, z: p.z };
    this.look = look;
    if (look) this.yaw = yawFromDir(look.x - p.x, look.z - p.z);
    this.rig.root.rotation.y = this.yaw;
  }

  /** Spawn at `p` and walk to the idle post. */
  arrive(p: XZ): void {
    this.placeAt(p, null);
    this.goTo(this.home, this.homeLook());
    this.phase = 'toHome';
  }

  private homeLook(): XZ {
    return { x: this.home.x, z: this.home.z + this.region.layout.inward * 3 };
  }

  /** What a peer must not chase: the source pile being loaded from and the hopper being fed. */
  claim(): WorkerClaim | null {
    const job = this.job;
    if (!job || this.phase === 'idle' || this.phase === 'toHome') return null;
    const loading = this.phase === 'toSource' || this.phase === 'load';
    const amount = loading ? Math.max(job.take, this.stack.size) : this.stack.size;
    if (amount <= 0) return null;
    const dest = this.dest?.slot ?? null;
    const site = siteSlot(job.to);
    return {
      src: loading ? srcId(job.from, job.item) : null,
      dest: site !== null ? destId(site, job.item, true) : dest !== null ? destId(dest, job.item) : job.type === 'stock' ? `dock:${job.item}` : null,
      amount,
    };
  }

  /** Add the units in the hands (flights in included) to `into`, by kind (for the save). */
  addCarried(into: Partial<Record<ItemKind, number>>): void {
    for (const kind of MATERIAL_KINDS) {
      const n = this.stack.count(kind) + this.ctx.flights.inFlightTo(this.stack, kind);
      if (n > 0) into[kind] = (into[kind] ?? 0) + n;
    }
  }

  update(dt: number): void {
    if (dt <= 0 || this.gone) return;
    if (this.disposing) {
      this.stack.update(dt, this.velocity);
      this.rig.animate(dt, 0);
      if (this.settled) this.finishDispose();
      return;
    }
    this.applyLevel();
    this.timer -= dt;
    this.think(dt);
    this.step(dt);
    this.rig.setCarrying(this.stack.size > 0);
    this.rig.animate(dt, this.speed / PLAYER.speed);
    this.stack.update(dt, this.velocity);
  }

  /** Leave the world: lingers until every item in flight to the hands has landed (see `disposed`). */
  dispose(): void {
    this.disposing = true;
    this.route = [];
    this.routeIdx = 0;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    if (this.settled) this.finishDispose();
  }

  get disposed(): boolean {
    return this.gone;
  }

  /** Remove at once (crew torn down): whatever is in the hands goes to the import dock. */
  forceDispose(): void {
    this.disposing = true;
    this.finishDispose();
  }

  private finishDispose(): void {
    if (this.gone) return;
    // hand the load back to the import dock (never lose goods: what a full dock refuses is sold at the depot quote)
    for (let item = this.stack.take(); item; item = this.stack.take()) {
      if (this.region.dock.addImmediate(item)) continue;
      this.ctx.economy.add(Math.round(this.ctx.market.quote(item.kind as MaterialKind, 'sell')));
      this.ctx.items.release(item);
    }
    this.stack.clear();
    this.group.removeFromParent();
    this.gone = true;
  }

  private applyLevel(): void {
    const cap = this.capacity;
    if (cap !== this.capacityNow) {
      this.capacityNow = cap;
      this.stack.setCapacity(cap);
    }
  }

  // --- world view ---------------------------------------------------------------------------------------------------
  private claims(): Claims {
    const sources = new Map<string, number>();
    const dests = new Map<string, number>();
    for (const o of this.peers) {
      if (o === this) continue;
      const c = o.claim();
      if (!c) continue;
      if (c.src) sources.set(c.src, (sources.get(c.src) ?? 0) + c.amount);
      if (c.dest) dests.set(c.dest, (dests.get(c.dest) ?? 0) + c.amount);
    }
    return { sources, dests };
  }

  /** Read the region now. */
  private view(): JobView {
    const r = this.region;
    const machines: JobMachine[] = [];
    r.machines.forEach((m, slot) => {
      if (!m) return;
      machines.push({
        slot,
        extractor: m.def.kind === 'extractor',
        inputs: m.def.inputs.map((i) => ({ kind: i.kind, per: i.per, room: m.wants(i.kind), stock: m.input?.count(i.kind) ?? 0 })),
        output: m.def.output,
        outCount: m.output.count(m.def.output),
        outFull: m.output.isFull(),
        feed: m.feedSpot,
        take: m.takeSpot,
      });
    });
    const dock: Partial<Record<ItemKind, number>> = {};
    for (const k of MATERIAL_KINDS) {
      const n = r.dock.count(k);
      if (n > 0) dock[k] = n;
    }
    const sites = this.role === 'foreman' ? r.sites().map((x) => ({ slot: x.slot, kind: x.kind, room: x.room, spot: x.spot })) : [];
    return { machines, sites, dock, dockSpot: r.dockSpot, depotSpot: r.depotSpot, depotAccepts: (k) => r.depot.canAccept(k), dockAccepts: (k) => r.dock.canAccept(k) };
  }

  private lookAtSlot(slot: number): XZ | null {
    const s = this.region.layout.slots[slot];
    return s ? { x: s.x, z: s.z } : null;
  }

  private sourceRef(from: JobSource): Ref {
    const r = this.region;
    if (from === 'dock') return { machine: null, holder: r.dock, spot: r.dockSpot, look: awayOrNull(r.dockSpot, r.layout.dock) };
    const m = r.machines[from] ?? null;
    return { machine: m, holder: m?.output ?? null, spot: m?.takeSpot ?? this.at, look: this.lookAtSlot(from) };
  }

  private destRef(to: JobDest): Ref & { slot: number | null } {
    const r = this.region;
    const site = siteSlot(to);
    if (site !== null) {
      // a construction pad: read live, gone (paid, demolished, choice changed) → the unload redirects
      const live = r.sites().find((x) => x.slot === site);
      const p = r.layout.slots[site];
      return { slot: null, machine: null, holder: live?.holder ?? null, spot: live?.spot ?? this.at, look: p ? { x: p.x, z: p.z } : null };
    }
    if (to === 'depot') return { slot: null, machine: null, holder: r.depot, spot: r.depotSpot, look: awayOrNull(r.depotSpot, r.layout.depot) };
    if (to === 'dock') return { slot: null, machine: null, holder: r.dock, spot: r.dockSpot, look: awayOrNull(r.dockSpot, r.layout.dock) };
    const slot = to as number;
    const m = r.machines[slot] ?? null;
    return { slot, machine: m, holder: m?.input ?? null, spot: m?.feedSpot ?? this.at, look: this.lookAtSlot(slot) };
  }

  /** The machine the ref was made for is still on its slot. */
  private alive(ref: Ref, slot: number | null): boolean {
    if (!ref.machine) return true; // dock / depot
    return slot !== null && this.region.machines[slot] === ref.machine;
  }

  private heldKind(): ItemKind | null {
    for (const k of MATERIAL_KINDS) if (this.stack.count(k) > 0) return k;
    return null;
  }

  // --- the job loop -------------------------------------------------------------------------------------------------
  private goTo(p: XZ, look: XZ | null): void {
    this.route = planPath(this.region.layout, this.at, p);
    this.routeIdx = 0;
    this.at = p;
    this.look = look;
  }

  private park(delay: number): void {
    this.job = null;
    this.src = null;
    this.dest = null;
    this.phase = 'idle';
    this.pickTimer = delay;
    this.blocked = 0;
  }

  /** Send the worker (holding `kind`) to a new destination chosen from the live region. */
  private redirect(kind: ItemKind, exclude: number | null): void {
    const target = fallbackDest(this.view(), kind, this.claims(), this.at, exclude, this.job?.from === 'dock', this.owed);
    if (target === null) return this.park(1);
    this.job = { type: 'feed', item: kind, take: this.stack.size, from: this.job?.from ?? 'dock', to: target };
    this.dest = this.destRef(target);
    this.goTo(this.dest.spot, this.dest.look);
    this.phase = 'toDest';
  }

  private startDelivery(): void {
    const job = this.job!;
    const kind = this.heldKind() ?? job.item;
    const dest = this.dest!;
    if (dest.machine && this.alive(dest, dest.slot) && dest.machine.wants(kind) > 0) {
      this.goTo(dest.spot, dest.look);
      this.phase = 'toDest';
    } else if (dest.slot === null && dest.holder) {
      this.goTo(dest.spot, dest.look);
      this.phase = 'toDest';
    } else {
      this.redirect(kind, dest.slot);
    }
  }

  private move(from: ItemHolder, to: ItemHolder, kind: ItemKind): boolean {
    if (this.timer > 0) return false;
    if (!transferOne(this.ctx, from, to, [kind], FLY)) return false;
    this.timer = this.interval;
    this.idle = 0;
    return true;
  }

  private think(dt: number): void {
    switch (this.phase) {
      case 'idle': {
        if (this.moving) return;
        this.pickTimer -= dt;
        if (this.pickTimer > 0) return;
        this.pickTimer = PICK_EVERY;
        if (this.stack.size > 0) {
          // leftovers (a hopper filled up under us, a machine was demolished): place them somewhere first
          const held = this.heldKind();
          if (!held || !this.settled) return;
          this.job = { type: 'feed', item: held, take: this.stack.size, from: 'dock', to: 'depot' };
          this.redirect(held, null);
          return;
        }
        const job = pickJob(this.view(), this.capacity, this.claims(), this.at, this.idleFor > LENIENT_AFTER, this.owed, this.role);
        if (job) {
          this.job = job;
          this.src = this.sourceRef(job.from);
          this.dest = this.destRef(job.to);
          this.idleFor = 0;
          this.goTo(this.src.spot, this.src.look);
          this.phase = 'toSource';
          return;
        }
        this.idleFor += PICK_EVERY;
        if (this.idleFor > 1.5 && this.at !== this.home) {
          this.goTo(this.home, this.homeLook());
          this.phase = 'toHome';
        }
        return;
      }
      case 'toHome':
        if (this.moving) return;
        this.phase = 'idle';
        return;
      case 'toSource':
        if (this.moving) return;
        this.phase = 'load';
        this.blocked = 0;
        this.idle = 0;
        return;
      case 'load': {
        const job = this.job!;
        const src = this.src!;
        const dest = this.dest!;
        const srcSlot = job.from === 'dock' ? null : job.from;
        const srcOk = src.holder !== null && (job.from === 'dock' || this.alive(src, srcSlot));
        const kind = job.item;
        // never take more than the hopper has room for (the arms are not counted in its room yet)
        let want = Math.min(job.take, this.capacity);
        if (job.type === 'feed' && dest.machine && this.alive(dest, dest.slot)) want = Math.min(want, dest.machine.wants(kind));
        if (srcOk && this.stack.size < want && src.holder!.count(kind) > 0 && this.move(src.holder!, this.stack, kind)) return;
        this.idle += dt;
        if (!this.settled) return;
        const full = this.stack.size >= want;
        if (!(full || !srcOk || this.idle > PATIENCE)) return;
        if (this.stack.count(kind) === 0) return this.park(1);
        this.startDelivery();
        return;
      }
      case 'toDest':
        if (this.moving) return;
        this.phase = 'unload';
        this.blocked = 0;
        return;
      case 'unload': {
        const job = this.job!;
        const dest = this.dest!;
        const kind = this.heldKind() ?? job.item;
        if (this.stack.size === 0) return this.park(0.1); // next job from here, no detour home
        if (!this.settled) return;
        if (dest.machine && !this.alive(dest, dest.slot)) return this.redirect(kind, dest.slot);
        const to = dest.holder;
        if (to && this.stack.count(kind) > 0 && to.canAccept(kind)) {
          this.blocked = 0;
          this.move(this.stack, to, kind);
          return;
        }
        this.blocked += dt;
        if (this.blocked > BLOCKED_GIVE_UP) {
          this.blocked = 0;
          this.redirect(kind, dest.slot);
        }
        return;
      }
    }
  }

  private step(dt: number): void {
    const p = this.group.position;
    this.velocity.set(0, 0, 0);
    if (this.moving) {
      const last = this.routeIdx === this.route.length - 1;
      const goal = this.route[this.routeIdx]!;
      const dx = goal.x - p.x;
      const dz = goal.z - p.z;
      const d = Math.hypot(dx, dz);
      const max = ERA_WORKER.walkSpeed * this.stats.walk;
      const target = last ? Math.min(max, 1.2 + d * 4) : max;
      this.speed = approach(this.speed, target, ACCEL * dt);
      const stepLen = this.speed * dt;
      if (d < 0.02 || stepLen >= d) {
        p.x = goal.x;
        p.z = goal.z;
        this.routeIdx++;
        if (last) this.speed = 0;
      } else {
        const nx = dx / d;
        const nz = dz / d;
        p.x += nx * stepLen;
        p.z += nz * stepLen;
        this.velocity.set(nx * this.speed, 0, nz * this.speed);
        this.yaw = dampAngle(this.yaw, yawFromDir(dx, dz), TURN_LAMBDA, dt);
      }
    } else {
      this.speed = 0;
      if (this.look) this.yaw = dampAngle(this.yaw, yawFromDir(this.look.x - p.x, this.look.z - p.z), TURN_LAMBDA, dt);
    }
    this.rig.root.rotation.y = this.yaw;
  }
}

/** `target` unless it is (almost) where one stands: then null (keep facing). */
function awayOrNull(spot: XZ, target: XZ): XZ | null {
  return dist(spot, target) < 0.3 ? null : target;
}
