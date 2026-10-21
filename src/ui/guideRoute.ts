/**
 * [0.9.12 — guide arrow] The walk behind the guide arrow (full review section 2): the edge arrow and the trail of
 * guide dots follow the shortest walk to the target (world/navGrid.ts), not the straight line through fences, rivers
 * and buildings, and they never flip-flop.
 *
 * - A new target starts a NavField (the walk to it from everywhere), grown FIELD_BUDGET cells per frame: a trip across
 *   every era is known within a few frames and never stalls one. Until the player's spot is known the edge arrow and
 *   the dots wait (steer null); nothing ever points the wrong way meanwhile.
 * - After that the walk from wherever the player is (a detour, a teleport, a map jump) is read off the same field, so
 *   it never needs a new search and the walks from neighbouring spots agree.
 * - The world changing (a machine built in the way, a road opening) is checked every REVISION_EVERY seconds; the grid
 *   and the field are then rebuilt, and the last walk stays on show until the new one is known.
 * - steer: where to walk now: the first corner of the walk (in a straight line from the player by construction), at
 *   most STEER_MAX ahead.
 * - A target no walk reaches falls back to the straight line (reachable false), as the arrow always did.
 * Pure apart from the ColliderWorld it reads (tests/guideRoute.test.ts).
 */
import type { Rect } from '../config';
import type { ColliderWorld } from '../world/Colliders';
import { NavField, NavGrid, type NavPath, type XZ } from '../world/navGrid';

/** A target this far (m) from the last one is a new target. */
const RETARGET = 0.5;
/** Check the world for changes this often (s). */
const REVISION_EVERY = 1.5;
/** Cells settled per update (about a millisecond). */
export const FIELD_BUDGET = 8000;
/** The steer point is at most this far ahead (m). */
const STEER_MAX = 18;
/** The walk read off the field reaches this far ahead (m): enough for the steer point and the dots. */
const LOCAL = 30;
/** A corner this close (m) is as good as reached: steer at the one after it. */
const CORNER_REACHED = 0.8;

export class GuideRoute {
  private grid: NavGrid | null = null;
  private rev = Number.NaN;
  private revAt = -Infinity;
  private field: NavField | null = null;
  private target: XZ | null = null;
  private area: Rect | null = null;
  private local: NavPath | null = null;
  private steerPt: XZ | null = null;
  private reachableFlag = true;
  private remainingM = 0;
  /** Fields started (new targets and world changes): the guide check counts them. */
  plans = 0;

  /** `avoid`: the pads and piles to step round (ZoneSystem.smallAreas), read when the world is checked. */
  constructor(
    private readonly colliders: ColliderWorld,
    private readonly radius: number,
    private readonly avoid: () => readonly Rect[] = () => [],
  ) {}

  /** Follow the player toward `target` (null clears the walk). `area`: the zone to step into, if any. */
  update(now: number, player: XZ, target: XZ | null, area: Rect | null = null): void {
    if (!target) {
      this.target = null;
      this.area = null;
      this.local = null;
      this.steerPt = null;
      this.reachableFlag = true;
      this.remainingM = 0;
      return;
    }
    const moved = !this.target || Math.hypot(target.x - this.target.x, target.z - this.target.z) > RETARGET || !sameRect(area, this.area);
    if (moved) {
      this.target = { x: target.x, z: target.z };
      this.area = area ? { ...area } : null;
      this.local = null; // the old walk leads somewhere else
      this.steerPt = null;
      this.startField(now);
    } else if (now - this.revAt >= REVISION_EVERY && this.field?.done) {
      // 0.9.13 (review P5): a field still growing finishes first (in a busy late game a pile or pad changes every few
      // seconds, and restarting each time kept the search running forever, about a millisecond every frame)
      this.revAt = now;
      if (this.revision() !== this.rev) this.startField(now); // keeps the last walk on show meanwhile
    }
    const f = this.field!;
    if (!f.done) f.step(FIELD_BUDGET);
    const t = this.target!;
    if (!f.valid || (f.done && !Number.isFinite(f.distanceFrom(player)))) {
      // nothing walkable reaches it: point straight at it, as before 0.9.12
      this.reachableFlag = false;
      this.local = null;
      this.steerPt = { x: t.x, z: t.z };
      this.remainingM = Math.hypot(t.x - player.x, t.z - player.z);
      return;
    }
    this.reachableFlag = true;
    const walk = f.pathFrom(player, LOCAL);
    if (walk) {
      this.local = walk;
      this.remainingM = f.distanceFrom(player);
    } else if (this.local) {
      this.remainingM = Math.hypot(t.x - player.x, t.z - player.z);
    }
    this.steerPt = this.local ? steerOf(this.local, player) : null;
  }

  /** Where to walk now (null: no target, or the walk is still being worked out). */
  get steer(): XZ | null {
    return this.steerPt;
  }

  /** The next stretch of the walk from the player (null: none known, or the straight-line fallback). */
  get walk(): NavPath | null {
    return this.reachableFlag ? this.local : null;
  }

  /** False when no walk reaches the target (the arrows then point straight at it). */
  get reachable(): boolean {
    return this.reachableFlag;
  }

  /** Metres left to walk (the straight distance in the fallback or while the walk is worked out). */
  get remaining(): number {
    return this.remainingM;
  }

  /** The whole walk from `from` (the guide check; null until known). */
  fullWalk(from: XZ): NavPath | null {
    return this.reachableFlag && this.field ? this.field.pathFrom(from) : null;
  }

  /** The colliders' revision folded with the pads and piles to step round. */
  private revision(): number {
    let h = this.colliders.navRevision();
    for (const r of this.avoid()) h = (h * 31 + Math.round(r.minX * 4) * 7 + Math.round(r.minZ * 4) * 13 + Math.round((r.maxX - r.minX) * 4)) | 0;
    return h;
  }

  private startField(now: number): void {
    this.revAt = now;
    const rev = this.revision();
    if (!this.grid || rev !== this.rev) {
      this.grid = new NavGrid({ ...this.colliders.navSource(), avoid: this.avoid() }, this.radius);
      this.rev = rev;
    }
    this.field = new NavField(this.grid, this.target!, this.area, this.field);
    this.plans++;
  }
}

/** The first corner of the walk not yet reached, at most STEER_MAX away. */
function steerOf(walk: NavPath, player: XZ): XZ {
  const pts = walk.points;
  let p = pts[1] ?? pts[0]!;
  if (Math.hypot(p.x - player.x, p.z - player.z) < CORNER_REACHED && pts[2]) p = pts[2];
  const d = Math.hypot(p.x - player.x, p.z - player.z);
  if (d <= STEER_MAX) return { x: p.x, z: p.z };
  const k = STEER_MAX / d;
  return { x: player.x + (p.x - player.x) * k, z: player.z + (p.z - player.z) * k };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.minX - b.minX) < 0.01 && Math.abs(a.maxX - b.maxX) < 0.01 && Math.abs(a.minZ - b.minZ) < 0.01 && Math.abs(a.maxZ - b.maxZ) < 0.01;
}
