/**
 * [0.9.12 — guide arrow] A walking map of the player's world, for the guide arrow: where the player's centre can stand
 * (ColliderWorld's yard bounds + extra walkable rects, clear of every enabled obstacle), on a 0.5 m grid, and the
 * shortest walk from anywhere to a goal.
 *
 * - NavGrid is built from ColliderWorld.navSource() (the same shapes and tests as resolveCircle, radius PLAYER.radius),
 *   so a cell is open exactly when the player could stand on its centre. Cells beside a wall cost a little more, so
 *   walks keep to the middle of a walkway instead of scraping the fences. Building it takes a few milliseconds.
 * - NavField is the walk TO one goal from everywhere at once (Dijkstra outward from the goal: every settled cell knows
 *   its distance and the next cell toward the goal). It grows a slice at a time (step), so a trip across all ten eras
 *   never stalls a frame, and once the player's cell is settled any position (a teleport, a detour, a map jump) has its
 *   walk at once with no new search: the walks from neighbouring cells agree, so the arrow never flip-flops.
 *   The goal is a rect (the zone the guide points into) plus a point: every open cell in the rect is a goal cell, else
 *   the open cell nearest the point within GOAL_SNAP.
 * - pathFrom(): the walk from a point as a few straight legs (the grid's steps pulled tight wherever the straight line
 *   stays on open cells).
 * - Pure: no three.js, no DOM (tests/navGrid.test.ts, the guide check in scripts/guide-walk.mjs).
 */
import type { Rect } from '../config';

export const NAV_CELL = 0.5;
/** A goal point inside a solid: the nearest open cell this close (m) still counts as arriving. */
const GOAL_SNAP = 6;
/** A start inside a solid (brushing a prop): the nearest open cell this close (m). */
const START_SNAP = 3;
/** Extra cost (in cells) of a step onto a cell that touches a blocked one. */
const WALL_COST = 0.6;
/** Extra cost (in cells) of a step onto a pad or a pile that is not the goal: ~4 m of detour per cell crossed. */
const AVOID_COST = 8;
/** Goal cells keep this far (m) inside the zone's edge (less on a small zone: never past its middle). */
const GOAL_INSET = 0.45;
/** A pulled-tight leg is at most this long (m): keeps each line-of-sight test short. */
const MAX_LEG = 40;

export interface NavSolid {
  /** 0 = box (minX..maxZ), 1 = circle (x, z, r). */
  kind: 0 | 1;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  x: number;
  z: number;
  r: number;
}

export interface NavSource {
  bounds: Rect;
  extra: readonly Rect[];
  solids: readonly NavSolid[];
  /**
   * Walkable but best stepped round: other pads and piles (walking over one in walk-over mode pays it, or picks up or
   * drops goods). A walk crosses one only when the way round is much longer.
   */
  avoid?: readonly Rect[];
}

export interface XZ {
  x: number;
  z: number;
}

export interface NavPath {
  /** Corners of the walk, start first, goal last (at least two points). */
  points: XZ[];
  /** Metres along the corners. */
  length: number;
}

/** Bounds wider than this (the "no bounds" default) are clipped to the extra rects. */
const HUGE = 1e6;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class NavGrid {
  readonly cell = NAV_CELL;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** 1 = open. */
  readonly open: Uint8Array;
  /** 1 = open but beside a blocked cell. */
  readonly edge: Uint8Array;
  /** 1 = open but on a pad or a pile (NavSource.avoid). */
  readonly avoid: Uint8Array;

  constructor(src: NavSource, radius: number) {
    const b = src.bounds;
    const bounded = b.maxX - b.minX < HUGE;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const grow = (r: Rect): void => {
      minX = Math.min(minX, r.minX);
      maxX = Math.max(maxX, r.maxX);
      minZ = Math.min(minZ, r.minZ);
      maxZ = Math.max(maxZ, r.maxZ);
    };
    if (bounded) grow(b);
    for (const r of src.extra) grow(r);
    if (!Number.isFinite(minX)) {
      minX = -10;
      maxX = 10;
      minZ = -10;
      maxZ = 10;
    }
    const c = NAV_CELL;
    this.x0 = Math.floor(minX / c) * c - c;
    this.z0 = Math.floor(minZ / c) * c - c;
    this.nx = Math.ceil((maxX - this.x0) / c) + 2;
    this.nz = Math.ceil((maxZ - this.z0) / c) + 2;
    const n = this.nx * this.nz;
    this.open = new Uint8Array(n);
    this.edge = new Uint8Array(n);
    this.avoid = new Uint8Array(n);

    // walkable: the yard shrunk by the radius, the extra rects as they are (centre space)
    if (bounded) this.fill({ minX: b.minX + radius, maxX: b.maxX - radius, minZ: b.minZ + radius, maxZ: b.maxZ - radius });
    for (const r of src.extra) this.fill(r);
    // solids, grown by the radius: a cell closes when its centre would overlap the shape
    for (const s of src.solids) {
      if (s.kind === 0) this.stampBox(s, radius);
      else this.stampCircle(s.x, s.z, s.r + radius);
    }
    for (const r of src.avoid ?? []) {
      const cr = this.cellRect(r);
      if (!cr) continue;
      for (let j = cr[2]; j <= cr[3]; j++) this.avoid.fill(1, j * this.nx + cr[0], j * this.nx + cr[1] + 1);
    }
    // cells touching a closed one (the border row / column is never open: fill stays one cell inside)
    const { nx, nz, open, edge } = this;
    for (let j = 1; j < nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (open[k] && (!open[k - 1] || !open[k + 1] || !open[k - nx] || !open[k + nx])) edge[k] = 1;
      }
    }
  }

  /** Cell column / row of a world point (may be outside the grid). */
  ci(x: number): number {
    return Math.floor((x - this.x0) / this.cell);
  }
  cj(z: number): number {
    return Math.floor((z - this.z0) / this.cell);
  }
  /** World centre of a cell column / row. */
  cx(i: number): number {
    return this.x0 + (i + 0.5) * this.cell;
  }
  cz(j: number): number {
    return this.z0 + (j + 0.5) * this.cell;
  }

  /** True when the player's centre may stand at (x, z) (to the grid's resolution). */
  isOpen(x: number, z: number): boolean {
    const i = this.ci(x);
    const j = this.cj(z);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    return this.open[j * this.nx + i] === 1;
  }

  /** True when a straight walk from a to b crosses only open cells. */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.isOpen(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** The open cell nearest (x, z) within `max` metres (rings outward), or -1. */
  nearestOpen(x: number, z: number, max = START_SNAP): number {
    const i0 = this.ci(x);
    const j0 = this.cj(z);
    const R = Math.ceil(max / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= R; r++) {
      for (let j = j0 - r; j <= j0 + r; j++) {
        for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          const k = j * this.nx + i;
          if (!this.open[k]) continue;
          const d = Math.hypot(this.cx(i) - x, this.cz(j) - z);
          if (d < bestD && d <= max) {
            bestD = d;
            best = k;
          }
        }
      }
      // a ring further out can't beat a hit closer than its inner edge
      if (best >= 0 && bestD <= r * this.cell) break;
    }
    return best;
  }

  /** Cell ranges [i0, i1, j0, j1] whose centres lie inside r, clipped to the grid; null when empty. */
  cellRect(r: Rect): [number, number, number, number] | null {
    const c = this.cell;
    const i0 = Math.max(1, Math.ceil((r.minX - this.x0) / c - 0.5));
    const i1 = Math.min(this.nx - 2, Math.floor((r.maxX - this.x0) / c - 0.5));
    const j0 = Math.max(1, Math.ceil((r.minZ - this.z0) / c - 0.5));
    const j1 = Math.min(this.nz - 2, Math.floor((r.maxZ - this.z0) / c - 0.5));
    return i0 > i1 || j0 > j1 ? null : [i0, i1, j0, j1];
  }

  /** The whole shortest walk from `from` to the goal (the field solved to the end); null when none exists. */
  findPath(from: XZ, point: XZ, area: Rect | null = null): NavPath | null {
    const f = new NavField(this, point, area);
    f.step(Infinity);
    return f.pathFrom(from);
  }

  private fill(r: Rect): void {
    const cr = this.cellRect(r);
    if (!cr) return;
    const [i0, i1, j0, j1] = cr;
    for (let j = j0; j <= j1; j++) this.open.fill(1, j * this.nx + i0, j * this.nx + i1 + 1);
  }

  private stampBox(s: NavSolid, radius: number): void {
    const cr = this.cellRect({ minX: s.minX - radius, maxX: s.maxX + radius, minZ: s.minZ - radius, maxZ: s.maxZ + radius });
    if (!cr) return;
    const [i0, i1, j0, j1] = cr;
    const r2 = radius * radius;
    for (let j = j0; j <= j1; j++) {
      const z = this.cz(j);
      const dz = z < s.minZ ? s.minZ - z : z > s.maxZ ? z - s.maxZ : 0;
      for (let i = i0; i <= i1; i++) {
        const x = this.cx(i);
        const dx = x < s.minX ? s.minX - x : x > s.maxX ? x - s.maxX : 0;
        if (dx * dx + dz * dz < r2) this.open[j * this.nx + i] = 0;
      }
    }
  }

  private stampCircle(x: number, z: number, r: number): void {
    const cr = this.cellRect({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
    if (!cr) return;
    const [i0, i1, j0, j1] = cr;
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const dz = this.cz(j) - z;
      for (let i = i0; i <= i1; i++) {
        const dx = this.cx(i) - x;
        if (dx * dx + dz * dz < r2) this.open[j * this.nx + i] = 0;
      }
    }
  }
}

/**
 * The walk to one goal from everywhere (Dijkstra outward from the goal cells), grown a slice at a time. A settled cell
 * holds its distance to the goal and the next cell toward it.
 */
export class NavField {
  /** Distance to the goal in cells (Infinity: not reached yet). */
  private readonly dist: Float32Array;
  /** Next cell toward the goal (-1 on a goal cell). */
  private readonly next: Int32Array;
  private readonly settled: Uint8Array;
  private heapIdx = new Int32Array(4096);
  private heapF = new Float32Array(4096);
  private heapN = 0;
  /** False when the goal has no open cell near it at all. */
  readonly valid: boolean;
  /** Cells settled so far (the guide check reads it). */
  expanded = 0;

  /** `reuse`: an old field on the same grid whose buffers this one takes over (no 4 MB of garbage per new target). */
  constructor(
    readonly grid: NavGrid,
    readonly point: XZ,
    readonly area: Rect | null = null,
    reuse: NavField | null = null,
  ) {
    const n = grid.nx * grid.nz;
    if (reuse && reuse.grid === grid) {
      this.dist = reuse.dist.fill(Infinity);
      this.next = reuse.next.fill(-1);
      this.settled = reuse.settled.fill(0);
      this.heapIdx = reuse.heapIdx;
      this.heapF = reuse.heapF;
      reuse.heapN = 0;
    } else {
      this.dist = new Float32Array(n).fill(Infinity);
      this.next = new Int32Array(n).fill(-1);
      this.settled = new Uint8Array(n);
    }
    const goals: number[] = [];
    // goal cells sit a step inside the zone (a walk ending on its very edge can stop just short of it)
    const cr = area ? grid.cellRect(insetRect(area, GOAL_INSET)) : null;
    if (cr) {
      const [i0, i1, j0, j1] = cr;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (grid.open[j * grid.nx + i]) goals.push(j * grid.nx + i);
    }
    if (goals.length === 0) {
      const k = grid.nearestOpen(point.x, point.z, GOAL_SNAP);
      if (k >= 0) goals.push(k);
    }
    for (const k of goals) {
      this.dist[k] = 0;
      this.push(k, 0);
    }
    this.valid = goals.length > 0;
  }

  /** True once every reachable cell is settled. */
  get done(): boolean {
    return this.heapN === 0;
  }

  /** Settle up to `budget` more cells (the nearest first). Returns true when the field is complete. */
  step(budget: number): boolean {
    const { grid, dist, next, settled } = this;
    const { nx, open, edge, avoid } = grid;
    const n = open.length;
    let left = budget;
    while (this.heapN > 0 && left > 0) {
      const k = this.pop();
      if (settled[k]) continue;
      settled[k] = 1;
      this.expanded++;
      left--;
      const dk = dist[k]!;
      const i = k % nx;
      for (let d = 0; d < 8; d++) {
        const ddx = DX[d]!;
        const ddz = DZ[d]!;
        const ni = i + ddx;
        const nk = k + ddx + ddz * nx;
        if (ni < 0 || ni >= nx || nk < 0 || nk >= n || !open[nk] || settled[nk]) continue;
        // diagonals only past two open sides (no squeezing between two corners)
        if (d >= 4 && (!open[k + ddx] || !open[k + ddz * nx])) continue;
        // the cost of walking from nk into k (the field is walked from nk toward the goal)
        // (goal cells, at distance 0, never count as in the way)
        const nd = dk + (d >= 4 ? 1.41421356 : 1) + (edge[k] ? WALL_COST : 0) + (avoid[nk] && dk > 0 ? AVOID_COST : 0);
        if (nd >= dist[nk]!) continue;
        dist[nk] = nd;
        next[nk] = k;
        this.push(nk, nd);
      }
    }
    return this.heapN === 0;
  }

  /** The cell a walk from (x, z) starts on (the open cell under it, or the nearest), or -1. */
  startCell(x: number, z: number): number {
    const g = this.grid;
    if (g.isOpen(x, z)) return g.cj(z) * g.nx + g.ci(x);
    return g.nearestOpen(x, z, START_SNAP);
  }

  /** True when the walk from (x, z) is known (its cell settled), or proven impossible (field done, never reached). */
  knows(from: XZ): boolean {
    const k = this.startCell(from.x, from.z);
    return k < 0 || this.settled[k] === 1 || this.done;
  }

  /** Metres from (x, z) to the goal along the walk (Infinity: no walk, or not known yet). */
  distanceFrom(from: XZ): number {
    const k = this.startCell(from.x, from.z);
    if (k < 0 || !this.settled[k]) return Infinity;
    const g = this.grid;
    const i = k % g.nx;
    return this.dist[k]! * g.cell + Math.hypot(g.cx(i) - from.x, g.cz((k - i) / g.nx) - from.z);
  }

  /**
   * The walk from `from` (null: not known yet, or none), as straight legs. `maxMetres` stops it early (the guide only
   * needs the next stretch); the last point is then a point on the way, not the goal.
   */
  pathFrom(from: XZ, maxMetres = Infinity): NavPath | null {
    const g = this.grid;
    const start = this.startCell(from.x, from.z);
    if (start < 0 || !this.settled[start]) return null;
    const nx = g.nx;
    const cells: XZ[] = [];
    const startOpen = g.isOpen(from.x, from.z);
    let walked = 0;
    let prev: XZ | null = startOpen ? { x: from.x, z: from.z } : null;
    if (prev) cells.push(prev);
    for (let k = start, guard = 0; k >= 0 && guard < 20_000; k = this.next[k]!, guard++) {
      const i = k % nx;
      const p = { x: g.cx(i), z: g.cz((k - i) / nx) };
      if (prev) walked += Math.hypot(p.x - prev.x, p.z - prev.z);
      cells.push(p);
      prev = p;
      if (walked > maxMetres) break;
    }
    if (cells.length === 1) cells.push({ ...cells[0]! });
    // pull tight: from each corner, go as far down the cells as the straight line stays on open ground
    const out: XZ[] = [cells[0]!];
    let a = 0;
    while (a < cells.length - 1) {
      let b = a + 1;
      const A = cells[a]!;
      while (b + 1 < cells.length) {
        const B = cells[b + 1]!;
        if (Math.hypot(B.x - A.x, B.z - A.z) > MAX_LEG || !g.lineOfSight(A.x, A.z, B.x, B.z)) break;
        b++;
      }
      out.push(cells[b]!);
      a = b;
    }
    let length = 0;
    for (let s = 1; s < out.length; s++) length += Math.hypot(out[s]!.x - out[s - 1]!.x, out[s]!.z - out[s - 1]!.z);
    return { points: out, length };
  }

  private push(k: number, f: number): void {
    if (this.heapN >= this.heapIdx.length) {
      const ni = new Int32Array(this.heapIdx.length * 2);
      ni.set(this.heapIdx);
      const nf = new Float32Array(this.heapF.length * 2);
      nf.set(this.heapF);
      this.heapIdx = ni;
      this.heapF = nf;
    }
    const hi = this.heapIdx;
    const hf = this.heapF;
    let p = this.heapN++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (hf[q]! <= f) break;
      hi[p] = hi[q]!;
      hf[p] = hf[q]!;
      p = q;
    }
    hi[p] = k;
    hf[p] = f;
  }

  private pop(): number {
    const hi = this.heapIdx;
    const hf = this.heapF;
    const top = hi[0]!;
    this.heapN--;
    const N = this.heapN;
    if (N > 0) {
      const k = hi[N]!;
      const f = hf[N]!;
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= N) break;
        if (c + 1 < N && hf[c + 1]! < hf[c]!) c++;
        if (hf[c]! >= f) break;
        hi[p] = hi[c]!;
        hf[p] = hf[c]!;
        p = c;
      }
      hi[p] = k;
      hf[p] = f;
    }
    return top;
  }
}

/** `r` shrunk by `m` on every side, but never past its centre line. */
function insetRect(r: Rect, m: number): Rect {
  const mx = Math.min(m, (r.maxX - r.minX) / 2 - 0.01);
  const mz = Math.min(m, (r.maxZ - r.minZ) / 2 - 0.01);
  return { minX: r.minX + Math.max(0, mx), maxX: r.maxX - Math.max(0, mx), minZ: r.minZ + Math.max(0, mz), maxZ: r.maxZ - Math.max(0, mz) };
}

/** Metres along a polyline from its start to the point on it nearest p, that point's distance from p, and its leg. */
export function projectOnPath(points: readonly XZ[], p: XZ): { along: number; off: number; seg: number } {
  let best = { along: 0, off: Infinity, seg: 0 };
  let acc = 0;
  for (let s = 1; s < points.length; s++) {
    const a = points[s - 1]!;
    const b = points[s]!;
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const L2 = vx * vx + vz * vz;
    const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L2)) : 0;
    const off = Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
    const L = Math.sqrt(L2);
    if (off < best.off) best = { along: acc + L * t, off, seg: s - 1 };
    acc += L;
  }
  return best;
}

/** The point `d` metres along a polyline (clamped to its ends). */
export function pointAlong(points: readonly XZ[], d: number): XZ {
  let acc = 0;
  for (let s = 1; s < points.length; s++) {
    const a = points[s - 1]!;
    const b = points[s]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + L >= d && L > 1e-9) {
      const t = Math.max(0, (d - acc) / L);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    acc += L;
  }
  const last = points[points.length - 1]!;
  return { x: last.x, z: last.z };
}
